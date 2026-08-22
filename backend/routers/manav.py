"""
manav.py — Manav · मानव (HRMS) Router
Employee directory, departments, attendance, leave management, holidays.
"""
import json
import logging
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import is_org_admin, is_platform_staff, require_org_role
from middleware.role_tiers import (
    ADMIN, APPROVER, EDITOR, ORG_MANAGEMENT_ROLES, ORG_ROLES, VIEWER,
    any_level_satisfies, require_module_or_self,
)
from services.audit import emit as audit
# The commission rules live in ONE place and this router reaches for them
# rather than restating them: `commission.Scheme(...)` refuses exactly what
# migration 190 refuses — an eligible scheme with no terms, a ladder and a flat
# rate at once, two bands at one threshold — and refuses it with a sentence a
# person can read. Two copies of a money rule is how the two come to disagree.
from services import commission as C
from services.encryption import decrypt, encrypt, is_encrypted
from services.pii import decrypt_bank, encrypt_bank, mask_bank, mask_tail
# The ATTENDANCE seat counter. An active employee row in an org that runs Pahchan
# is a person on the attendance roster, and this is the only endpoint in the
# product that creates one — see the note on `assert_pahchan_seat_available` for
# why it is the single gate and which three neighbouring paths deliberately have
# none. Org seats are a separate count and are NOT touched from this file.
from services.seat_model import assert_pahchan_seat_available
# Niyam emitters, at module level ON PURPOSE (graha/vikray import theirs inside
# the handler): a test proves the wiring by monkeypatching
# `routers.manav.<emitter>`, and a function-local import would re-bind the real
# one on every call, making the wiring unprovable. Each is awaited on the SAME
# connection as the business write, inside its transaction — emit.py's one rule.
from services.niyam.subjects import (
    employee_exited, employee_joined, expense_claimed, expense_decided,
    leave_decided, leave_requested,
)
from services.statutory_ids import StatutoryValueError, clean_employee_identifiers
from utils import assert_file_url, assert_file_urls

router = APIRouter(prefix="/api/v1/manav", tags=["manav-hrms"])

MODULE = "manav"

#: The gate AND the answer: its value is the caller's Tier-4 level set, resolved
#: once per request. An EMPTY set is admitted deliberately — Manav is in
#: role_tiers.SELF_SCOPED_MODULES, so an employee with no grant at all still
#: reads their own profile, attendance, leave and claims.
_gate = require_module_or_self(MODULE)

# F4 (b) — shared, not re-implemented. See graha.py's docstring: two copies of a
# response contract is how one ends up reporting a total the other does not.
from routers.graha import _listed  # noqa: E402

# The ONE invitation machinery, reached rather than reimplemented. `org_invites`
# is the only place in the product that puts a person into an organisation, and
# it counts the org's seats while it does; a second INSERT into `invites` here
# would be a second seat counter, which is the exact defect that module was
# written to end. `preflight_org_invite` reaches the verdict with nothing
# written; `issue_invite` writes the row and sends the mail.
from routers.org_invites import (  # noqa: E402
    INVITABLE_ROLES, issue_invite, preflight_org_invite,
)

# Reading an identity document needs more than module membership. Declared here
# rather than inline so tests can override it, same as `_gate`. The role names
# come from role_tiers, not from two string literals written out here.
_pii_gate = require_org_role(*ORG_MANAGEMENT_ROLES)

# ── Who may see what in HR ────────────────────────────────────────────────────
#
# SELF SCOPE (role_tiers.SELF_SCOPED_MODULES): "every employee gets read access
# to THEIR OWN record with no grant at all — own payslip, own profile, own
# attendance. Anything beyond their own row needs a grant."
#
# So an empty level set reads the caller's own employee row, own attendance, own
# leave, own claims, own schedule, own assets — and nothing about anybody else.
# It is a query filter, not a grant row.
#
# Self scope is READ-ONLY over records the employer owns. It does NOT extend to
# editing a personnel file, marking attendance, or actioning anything. The one
# category of write it does reach is the employee's OWN SUBMISSIONS — their leave
# request, their expense claim, their availability, their shift-bid application —
# each of which resolves the employee id from the caller and never from the body.
# Those are the employee authoring their own request, not editing an HR record;
# submitting a leave request has never been an HR permission and requiring an
# editor grant for it would mean every employee also gets to edit everyone's
# attendance.
#
# Manav is NOT a separated-duty module (only vetana and ganit are), so admin does
# satisfy approver here. That is still resolved through
# `any_level_satisfies(...)` rather than assumed, so the day Manav is added to
# SEPARATED_DUTY_MODULES this file changes behaviour without changing code.
#
# Reference data with no employee in it — leave types, holidays, announcements,
# shift definitions, open shift bids — is readable at self scope. An employee has
# to know the holiday calendar and the leave types to make a request about their
# own record. Everything that names another person needs viewer.

from datetime import time as _dt_time

# ── Employee PII ──────────────────────────────────────────────────────────────
# `manav_employees` holds an identity kit: Aadhaar number, PAN, and bank
# details on the same row as the name. `require_module("manav")` grants on
# module membership with no role level, so a module *viewer* passes it — which
# means the full row must never be reachable through the ordinary detail
# endpoint. Two rules, both enforced below:
#
#   1. The detail endpoint selects an explicit column list and masks what it
#      returns. It never emits a full Aadhaar, PAN or account number.
#   2. Full values come only from GET /employees/{id}/sensitive, which requires
#      an org owner or admin and writes an audit row on every single read.
#
# `SELECT *` is banned on this table for exactly this reason: a column added
# later would start leaking the day it was added, with no code change to review.

# Everything on the row that is NOT part of the identity kit. Kept as one
# string so the detail and list endpoints cannot drift apart silently.
_EMP_SAFE_COLS = (
    "id, org_id, user_id, employee_code, name, email, phone, department, "
    "designation, date_of_joining, date_of_birth, gender, blood_group, "
    "emergency_contact, address, uan, esi_number, employment_type, status, "
    "reporting_to, shift, created_by, is_active, created_at, updated_at, "
    "hourly_rate"
)

_SENSITIVE_COLS = ("aadhaar", "pan", "bank_details")

#: Columns held as ciphertext in the database.
#:
#: `aadhaar` only, deliberately. It is the field that turns an employee record
#: into an identity kit, and the owner's decision was to keep the column rather
#: than drop it (see the header of PROPOSED_063_employee_pii.sql) — so the
#: remaining lever is what it costs when the row leaks.
#:
#: `pan` is masked on read like aadhaar but is NOT encrypted, for one reason:
#: Vetana reads it off this table when it builds a payslip, so encrypting it
#: means finding and fixing every reader. Aadhaar had no reader at all, which is
#: what made it safe to do alone and first.
#:
#: `bank_details` USED to be in that second group and no longer is. The blocker
#: was the enumeration, not the principle, and the enumeration is now done and
#: written out in `services/pii.py`: five sites in three files, four of which
#: read the value and now decrypt, one of which only tests it for emptiness in
#: SQL and is unaffected. The number itself is enciphered inside the jsonb by
#: `services.pii.encrypt_bank`; the IFSC and bank name beside it stay readable
#: because they identify a branch rather than a person.
#:
#: Adding a plain TEXT column here is one entry plus a backfill for it.
_ENCRYPTED_COLS = ("aadhaar",)


def _decrypt_cols(row: dict) -> dict:
    """Plaintext copy of a row read from the database.

    Called at the point of read so everything downstream — masking, the audited
    reveal, the payslip builder — keeps seeing plaintext and needs no knowledge
    of how the column is stored.

    A value that is still marked after `decrypt()` did not open: the key
    changed. Serving that to a caller would put `enc::gAAAA…` where an Aadhaar
    number belongs, and the masker would happily render its last four
    characters as though they meant something. Fail instead.
    """
    out = dict(row)
    for col in _ENCRYPTED_COLS:
        value = out.get(col)
        if not value:
            continue
        plain = decrypt(value)
        if is_encrypted(plain):
            raise HTTPException(
                500,
                f"Stored {col} could not be decrypted. FIELD_ENCRYPTION_KEY has "
                "changed or is not the key this row was written under.",
            )
        out[col] = plain

    # The account number lives INSIDE a jsonb rather than in a column of its
    # own, so it cannot join the loop above. Handled here, in the same function,
    # rather than at each call site — both readers in this file already go
    # through `_decrypt_cols`, and a decryption step a caller has to remember is
    # one a caller eventually forgets.
    #
    # Unlike the loop, this does NOT raise when the token will not open.
    # `mask_bank` refuses to render ciphertext as a plausible tail, so a bad key
    # costs the bank field and says so, where raising would cost the whole
    # employee record — including the name, the leave balances and the Aadhaar
    # that decrypted perfectly well.
    if "bank_details" in out:
        out["bank_details"] = decrypt_bank(out["bank_details"])
    return out


def _encrypt_cols(values: dict) -> dict:
    """Copy of a write payload with the encrypted columns enciphered.

    `encrypt()` is idempotent and returns empty/None untouched, so this is safe
    on partial updates and on rows that carry no aadhaar at all.
    """
    out = dict(values)
    for col in _ENCRYPTED_COLS:
        if out.get(col):
            out[col] = encrypt(out[col])
    return out


def _clean_identifiers(values: dict, *, aadhaar: str = "") -> dict:
    """Validated copy of a write payload, or a 422 naming every bad field.

    The HTTP shape deliberately mirrors `services/doc_validation.DocumentCheck`:
    a machine `field`, a human `label`, a `message` saying why the value cannot
    be stored, and an `example`. The payslip advisory that sends an admin here
    speaks that language already, so the correction they are being asked to make
    reads the same on both ends of the trip.
    """
    try:
        return clean_employee_identifiers(values, aadhaar=aadhaar)
    except StatutoryValueError as e:
        raise HTTPException(422, e.as_payload()) from e


# The masking rules now live in services/pii.py, because Vetana reads the same
# PAN / UAN / bank_details columns off this table when it builds a payslip and
# was returning them unmasked. Aliased here so the names used throughout this
# file — and asserted by test_manav.py — keep working.
_mask_tail = mask_tail
_mask_bank = mask_bank


def _mask_employee_pii(row: dict) -> dict:
    """Return a copy carrying masked identifiers. Aadhaar is grouped 4-4-4
    because that is how it is printed and how people check it."""
    out = dict(row)
    if "aadhaar" in out:
        out["aadhaar"] = _mask_tail(out["aadhaar"], 4, group=4)
    if "pan" in out:
        out["pan"] = _mask_tail(out["pan"], 4)
    if "bank_details" in out:
        out["bank_details"] = _mask_bank(out["bank_details"])
    out["_pii_masked"] = True
    return out


def _can(levels, required: str) -> bool:
    """Does this caller's level set satisfy `required` on Manav?

    Always through role_tiers — never `LEVELS.index(a) >= LEVELS.index(b)` at a
    call site, which is the comparison that quietly lets admin approve on a
    separated-duty module.
    """
    return any_level_satisfies(levels, required, MODULE)


def _require(levels, required: str) -> None:
    if _can(levels, required):
        return
    raise HTTPException(
        403,
        f"This action needs '{required}' on Manav. Without a grant you can see "
        "your own HR record and nothing else.",
    )


async def _employee_in_org(pool, employee_id, org_id: str) -> bool:
    """Does this employee id name a row in THIS organisation?

    ── WHY EVERY WRITE THAT TAKES AN EMPLOYEE ID CALLS THIS ─────────────────

    `POST /swaps` fifty lines below has carried the check since it was written
    and states the reason: "The schedule must also be in this org. Without that
    check a uuid from another tenant could be attached to a row here, and `GET
    /swaps` joins through it and would print that tenant's employee name."

    That argument was never specific to swaps. Four write paths took an
    `employee_id` from the body or the URL, paired it with the CALLER'S org_id
    and inserted the row — `POST /schedules`, `POST /schedules/bulk`, `POST
    /attendance` and `POST /shift-bids/{bid}/accept/{employee}`. `GET
    /schedules` and `GET /attendance` both join `manav_employees` on id alone
    with the org filter on the schedule or attendance row, so the foreign
    employee's name and code came straight back out.

    `assign_schedule` went further than a row: it looked the employee up with
    `WHERE id=$1::uuid`, no org, and mailed them their shift times.

    A false answer must be a 404 rather than a filtered write. Silently
    dropping the row would leave the caller believing a person is rostered.
    """
    if not employee_id:
        return False
    return bool(
        await pool.fetchval(
            "SELECT 1 FROM staging.manav_employees "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(employee_id), org_id,
        )
    )


async def _shift_in_org(pool, shift_id, org_id: str) -> bool:
    """The same question about a shift definition.

    A bid or a schedule row naming another tenant's shift is the same leak seen
    from the other side: `GET /schedules` joins `manav_shift_definitions` on id
    and prints the name, start and end times off it.
    """
    if not shift_id:
        return False
    return bool(
        await pool.fetchval(
            "SELECT 1 FROM staging.manav_shift_definitions "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(shift_id), org_id,
        )
    )


async def _own_employee_id(pool, user, org_id: str) -> str | None:
    """The caller's own employee row in this org, if they have one.

    None is a real answer and it means NO ACCESS, not unrestricted access: a
    caller with no grant and no employee row has no own-row to be scoped to.
    """
    return await pool.fetchval(
        "SELECT id::text FROM staging.manav_employees "
        "WHERE user_id=$1 AND org_id=$2::uuid AND is_active=TRUE LIMIT 1",
        user["user_id"], org_id,
    )


# ── The employee record ↔ login link ─────────────────────────────────────────
#
# `manav_employees.user_id` is the only thing joining a personnel file to an
# account that can sign in, and until this section was written NOTHING in the
# product could set it on an existing employee. `POST /employees` accepted a
# `user_id` in its body, but no screen has ever sent one and `EmployeeUpdate`
# had no such field at all — so once a record was saved, its link was fixed at
# NULL forever.
#
# Measured on the shared staging/production database before this shipped: 81
# employee rows across 3 organisations, 0 with a user_id. Not one employee email
# matched an account in `users` either, so there was no backfill-by-email to
# fall back on — the link has to be made by a person who knows which colleague
# is which.
#
# What a NULL here costs, all of it silent:
#   · `pahchan.create_punch` answers 409 "Your account is not linked to an
#     employee record" — the entire biometric clock-in is unreachable.
#   · `vetana` compares `e.user_id` against the caller in three places to decide
#     whether a payslip is the caller's own; a NULL is never the caller, so
#     nobody can open their own payslip.
#   · `_own_employee_id` below scopes every self-service read in this file, and
#     returns None, which means NO ACCESS — own profile, own attendance, own
#     leave, own claims, own schedule all come back empty.
#
# The link is made here, by hand, by HR, rather than at signup, because the two
# halves are created by different people at different times. HR types the
# personnel file. The account arrives separately — either the person accepts an
# org invitation (`POST /api/v1/org/invites` → `POST /auth/accept-invite`) or an
# org admin attaches an account that already exists (`POST /api/v1/org/members`).
# Neither of those paths knows an employee row exists, and neither should: an
# organisation has members who are not employees (the founder's accountant) and
# employees who will never have a login (a factory floor on a shared kiosk).
#
# There is deliberately NO invitation flow in this module. One exists and it
# lives in `org_invites`; a second one here would be a second seat counter.

#: The `linked` query parameter on the directory, and the WHERE fragment each
#: accepted value contributes. A dict rather than an if-chain so the accepted
#: vocabulary and the SQL are the same object — a value that is not a key cannot
#: reach the query at all, which is what makes concatenating the fragment safe.
_LINKED_FILTER_SQL = {
    "": "",
    "yes": "AND user_id IS NOT NULL ",
    "no": "AND user_id IS NULL ",
}


def linked_filter_sql(value: str | None) -> str | None:
    """WHERE fragment for `?linked=`, or None when the value is not accepted.

    None is a REFUSAL and `""` is "no filter" — the caller must tell them apart
    with `is None`, not with truthiness. The reason to refuse rather than ignore:
    a client that sends `linked=false` (which this does not accept) and gets the
    unfiltered directory back renders a screen claiming every employee has a
    login, which is the exact false statement this whole feature exists to stop.
    """
    if value is None:
        return ""
    return _LINKED_FILTER_SQL.get(value.strip().lower())


def link_refusal(
    employee: dict | None,
    member: dict | None,
    holder: dict | None,
) -> tuple[int, str] | None:
    """Why this employee must not be linked to this account, or None to proceed.

    Pure, and kept out of the endpoint on purpose. The connection pool is mocked
    in tests — `routers/messaging.py:30-41` records what that is worth: every
    read endpoint there once answered 500 against a real database with the whole
    suite green, because a mocked cursor resolves any table name it is handed.
    So the rules live here and are proven directly; the HTTP tests only prove the
    handler asks the right questions and honours the answer.

    `holder` is the OTHER employee row in this org already carrying this
    `user_id`, if there is one. One login belongs to one employee record, and the
    refusal matters in the direction people do not expect: two personnel files
    pointing at one account make `_own_employee_id` here and
    `pahchan._employee_for` return whichever row the planner reached first, so
    the same person's payslip and attendance change between requests with nothing
    in the data looking wrong. There is no unique index on (org_id, user_id)
    today, which is why this check has to exist in code;
    `migrations/101_employee_login_link_unique.sql` is the durable version and is
    NOT applied — nothing here depends on it.
    """
    if employee is None:
        return 404, "Employee not found"

    name = employee.get("name") or "This employee"

    # Checked before anything about the account, because it is true regardless of
    # which account was named. Linking a login to a terminated record would hand
    # someone self-service against a file the rest of Manav already filters out
    # (`_own_employee_id` and `pahchan._employee_for` both require is_active), so
    # the link would appear to succeed and change nothing.
    if not employee.get("is_active"):
        return 409, (
            f"{name} is not an active record. Reinstate it before linking a login."
        )

    if member is None:
        return 404, (
            "That account is not a member of this organisation. Invite them from "
            "Settings → Members first — the invitation is what creates the login."
        )

    # Already exactly this link. A no-op, not an error: the HR admin clicked
    # twice, or two of them did the same obvious thing.
    if employee.get("user_id") and employee["user_id"] == member.get("user_id"):
        return None

    if employee.get("user_id"):
        return 409, (
            f"{name} is already linked to a different login. Unlink that one first "
            "so the change is deliberate."
        )

    if holder is not None:
        return 409, (
            f"That login is already linked to {holder.get('name') or 'another employee'}. "
            "One login belongs to one employee record."
        )

    return None


def link_candidates(members: list[dict], links: list[dict]) -> list[dict]:
    """Every org member, each marked with the employee record already holding it.

    Accounts that are already taken are RETURNED rather than filtered out,
    carrying the name of the employee holding them. An HR admin who cannot find a
    colleague in a filtered list has no way to tell "they have no account" from
    "their account is already on somebody else's record" — and those two have
    opposite remedies: invite them, versus unlink the record that is wrong. Free
    accounts sort first because choosing one is what the list is for.
    """
    taken = {r["user_id"]: r for r in links if r.get("user_id")}
    out = []
    for m in members:
        held = taken.get(m["user_id"])
        out.append({
            "user_id": m["user_id"],
            "email": m.get("email") or "",
            "full_name": m.get("full_name") or "",
            "linked_employee_id": str(held["id"]) if held else None,
            "linked_employee_name": held.get("name") if held else None,
        })
    out.sort(key=lambda c: (
        c["linked_employee_id"] is not None,
        (c["full_name"] or c["email"] or "").lower(),
    ))
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Telling two people with the same name apart, without drawing an id
# ══════════════════════════════════════════════════════════════════════════════
#
# Measured read-only against the shared staging/production database on
# 2026-08-21: **98 employee rows, 0 carrying a user_id**, 32 accounts, and not
# one employee email equal to any address in `users`. There is no edge between
# the two halves and none that can be inferred.
#
# ── Why this is never solved by matching ─────────────────────────────────────
#
# Because the failure mode of a wrong link is that somebody else's commission is
# paid to the wrong person, and neither available signal is safe:
#
#   · Name. Six accounts in this database already share two display labels
#     between them. A name match on those is a coin toss wearing a tick.
#   · Email. Nothing to match on — the addresses HR types onto a personnel file
#     are not the addresses people sign in with, measured, zero overlap.
#
# So nothing here matches, ranks by similarity, or preselects. `account_options`
# is not even TOLD which employee is being linked, which is the strongest form
# of that promise: a function with no access to the employee's name cannot order
# by how much an account resembles it. Any similarity ordering is a view
# preference, offered in the UI, labelled a hint, defaulted off, and it never
# selects anything — a human clicks.
#
# ── What a human gets instead ────────────────────────────────────────────────
#
# Context, and it may not be a UUID: no user, member or org id is ever drawn
# (`frontend/scripts/check-rendered-ids.mjs`). These are what separate two
# "Amit Shah"s without one, and every one of them is a fact this organisation
# already knows about its own person:
#
#   · the address they sign in with        — unique by construction
#   · their role in THIS organisation      — owner / admin / member
#   · the day they joined THIS org         — `user_roles.granted_at`
#   · the modules they were granted        — what they actually do here
#   · the last four digits of their mobile — HR holds the full number already
#
# plus `name_is_shared`, so a screen can SAY that a label is ambiguous rather
# than leave it to be noticed. The org's own admin reading their own colleagues'
# details is the whole audience; this endpoint is admin-gated for that reason
# and Aekam is never shown another organisation's people through it.


def shared_labels(rows: list[dict], key: str = "name") -> set[str]:
    """The lower-cased display labels that MORE THAN ONE row in `rows` carries.

    Computed over the label the screen actually draws, not over the row, because
    ambiguity is a property of what a human reads. A blank label is not shared
    with anything — those rows fall back to the address, which is unique.
    """
    counts: dict[str, int] = {}
    for r in rows:
        label = (r.get(key) or "").strip().lower()
        if not label:
            continue
        counts[label] = counts.get(label, 0) + 1
    return {label for label, n in counts.items() if n > 1}


def _iso_day(value) -> str:
    """`YYYY-MM-DD` from a date, a datetime or a string; `""` from nothing.

    The screen prints a joining date next to a name to separate two people with
    one name, so the value has to survive the trip. A `date` renders itself; a
    string that is already a date is passed through rather than re-parsed.
    """
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def link_worklist(employees: list[dict]) -> list[dict]:
    """The personnel records with no login, each with what identifies it.

    Built key by key, like `link_candidates` and for the same reason: this table
    carries `aadhaar`, `pan` and `bank_details`, and a response shape assembled
    by spreading the row is how those leave the building the day somebody widens
    a SELECT. `id` is here as a KEY — the screen posts it back and never draws
    it; `employee_code` is what a person reads, and it is HR's own code, not a
    UUID this product minted.
    """
    ambiguous = shared_labels(employees, "name")
    out = []
    for e in employees:
        name = (e.get("name") or "").strip()
        out.append({
            "id": str(e["id"]),
            "employee_code": e.get("employee_code") or "",
            "name": name,
            "email": e.get("email") or "",
            "department": e.get("department") or "",
            "designation": e.get("designation") or "",
            "date_of_joining": _iso_day(e.get("date_of_joining")),
            "status": e.get("status") or "",
            "name_is_shared": name.lower() in ambiguous,
        })
    out.sort(key=lambda r: (r["name"].lower(), r["employee_code"]))
    return out


def account_options(
    accounts: list[dict],
    links: list[dict],
    module_grants: list[dict] | None = None,
) -> list[dict]:
    """Every account in this org, with the context that tells two of them apart.

    THE SIGNATURE IS THE POINT. There is no `employee` parameter and there will
    not be one: a function that cannot see the name being linked cannot rank by
    resemblance to it, so no ordering this returns can ever be mistaken for a
    suggested match. Ordering is free-accounts-first, then by name — the same
    rule as `link_candidates`, which also keeps two same-named accounts adjacent
    so they are read together rather than pages apart.

    Taken accounts are RETURNED, carrying the name of the employee holding them.
    "No account" and "their account is on somebody else's record" have opposite
    remedies and a filtered list cannot tell them apart.

    This is deliberately NOT `link_candidates` with more keys on it. That one
    feeds the picker inside a single employee's record and its shape is pinned
    by a test to five keys precisely so a widened SELECT upstream cannot carry
    `password_hash` into a response. This one answers a different question for a
    different screen, and it is built key by key for that same reason.
    """
    taken = {r["user_id"]: r for r in links if r.get("user_id")}
    modules: dict[str, set[str]] = {}
    for g in module_grants or []:
        if g.get("user_id") and g.get("module_code"):
            modules.setdefault(g["user_id"], set()).add(g["module_code"])

    rows = []
    for a in accounts:
        held = taken.get(a["user_id"])
        rows.append({
            "user_id": a["user_id"],
            "full_name": (a.get("full_name") or "").strip(),
            "email": a.get("email") or "",
            # Sorted so two accounts are compared on the same axis, and so the
            # order does not change between two reads of the same screen.
            "org_roles": sorted(a.get("role_codes") or []),
            "member_since": _iso_day(a.get("member_since")),
            # The last four only. HR holds the full number on the personnel file
            # already; this is here to separate two identical names, and four
            # digits does that without turning a linking screen into a directory
            # export.
            "mobile_tail": mask_tail(a.get("mobile_number")) or "",
            "modules": sorted(modules.get(a["user_id"], ())),
            "linked_employee_id": str(held["id"]) if held else None,
            "linked_employee_name": held.get("name") if held else None,
            "name_is_shared": False,
        })

    ambiguous = shared_labels(rows, "full_name")
    for r in rows:
        r["name_is_shared"] = r["full_name"].strip().lower() in ambiguous

    rows.sort(key=lambda c: (
        c["linked_employee_id"] is not None,
        (c["full_name"] or c["email"] or "").lower(),
        c["email"].lower(),
    ))
    return rows


#: One member of this org, by account. Selected rather than `SELECT *` for the
#: same reason the employee columns are: `users` carries `password_hash` and
#: `salt`, and a column list that widens by accident is how those travel.
_ORG_MEMBER_SQL = (
    "SELECT DISTINCT u.user_id, u.email, COALESCE(u.full_name, u.name) AS full_name "
    "FROM staging.user_roles ur "
    "JOIN users u ON u.user_id = ur.user_id "
    "WHERE ur.org_id=$1::uuid AND ur.role_code = ANY($2::text[]) "
)

#: The same members, with the four facts that separate two of them who share a
#: name. A SEPARATE string from `_ORG_MEMBER_SQL` on purpose: that one is a
#: `SELECT DISTINCT` whose tail is concatenated with `AND u.user_id=$3` by the
#: link endpoint, and widening it with `role_code` would turn one account
#: holding two roles into two rows — which `link_candidates` would render as two
#: identical people to choose between, on the one screen whose entire job is to
#: stop somebody choosing the wrong person.
#:
#: `ARRAY_AGG(DISTINCT ur.role_code)` and `MIN(ur.granted_at)` collapse those
#: rows back to one account: every role it holds here, and the day it first
#: joined THIS organisation. Both are org-scoped by the WHERE clause, so nothing
#: about this account's membership of any other org is reachable.
#:
#: Column list, never `SELECT *`: `users` carries `password_hash` and `salt`.
_ORG_ACCOUNT_SQL = (
    "SELECT ur.user_id, u.email, COALESCE(u.full_name, u.name) AS full_name, "
    "u.mobile_number, MIN(ur.granted_at) AS member_since, "
    "ARRAY_AGG(DISTINCT ur.role_code) AS role_codes "
    "FROM staging.user_roles ur "
    "JOIN users u ON u.user_id = ur.user_id "
    "WHERE ur.org_id=$1::uuid AND ur.role_code = ANY($2::text[]) "
    "GROUP BY ur.user_id, u.email, u.full_name, u.name, u.mobile_number "
    "ORDER BY 3, 2"
)


def _parse_date(s: str) -> date:
    return date.fromisoformat(s)


def _parse_time(s: str) -> _dt_time:
    parts = s.split(":")
    return _dt_time(int(parts[0]), int(parts[1]))


# ── Pydantic Models ──────────────────────────────────────────

class EmployeeCreate(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    employee_code: str = ""
    department: str = ""
    designation: str = ""
    date_of_joining: str = ""
    date_of_birth: str = ""
    gender: str = ""
    blood_group: str = ""
    emergency_contact: dict = {}
    address: dict = {}
    bank_details: dict = {}
    pan: str = ""
    aadhaar: str = ""
    uan: str = ""
    esi_number: str = ""
    employment_type: str = "full_time"
    reporting_to: str = ""
    shift: str = "general"
    user_id: str = ""

    # ── "This person needs a login" ──────────────────────────────────────────
    #
    # DEFAULT FALSE, and the default is the important half. The owner's
    # correction: "Not all employee will be sales user or will need full login
    # they will be only pachand [Pahchan] users."
    #
    # Measured on 2026-08-21: 98 employee rows, 3 organisations, 32 accounts —
    # and the largest org has 71 employees against 7 accounts. Most people on a
    # CA firm's payroll punch in on a shared device and never sign in to
    # anything. An employee record with no login is the ORDINARY case, not a
    # broken one, and nothing in the product should treat it as incomplete.
    #
    # When this is true the create path mints an org invitation carrying this
    # employee's id, so the account links itself on acceptance instead of
    # waiting for somebody to make the join by hand on the repair screen. When
    # it is false NOTHING about creating an employee changes — no extra query is
    # issued, no seat is counted, no mail is sent.
    create_login: bool = False

    #: The organisation role the invitation grants. Ignored entirely unless
    #: `create_login` is true. `org_member` is the floor and the default; an
    #: org_admin cannot mint an org_owner from here any more than from Settings
    #: — that rule lives in `org_invites._assert_may_grant_role` and is reached
    #: through the same preflight the Settings screen uses.
    login_role: str = "org_member"


class EmployeeUpdate(BaseModel):
    #: NO `user_id`, and that is deliberate rather than an omission — the same
    #: omission that made the link unsettable in the first place, kept for the
    #: opposite reason. The link decides whose payslip and whose attendance a
    #: person can read, so it moves through `POST /employees/{id}/link`, which
    #: refuses an account another record already holds and writes an audit row.
    #: A field here would put an authority change inside the same PATCH that
    #: edits a designation, unchecked and unrecorded. Pydantic ignores unknown
    #: keys, so a body carrying `user_id` is silently dropped rather than
    #: applied.
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    employee_code: str | None = None
    department: str | None = None
    designation: str | None = None
    date_of_joining: str | None = None
    date_of_birth: str | None = None
    gender: str | None = None
    blood_group: str | None = None
    emergency_contact: dict | None = None
    address: dict | None = None
    bank_details: dict | None = None
    pan: str | None = None
    aadhaar: str | None = None
    uan: str | None = None
    esi_number: str | None = None
    employment_type: str | None = None
    reporting_to: str | None = None
    shift: str | None = None
    status: str | None = None


class DepartmentCreate(BaseModel):
    name: str
    head_employee_id: str = ""


class AttendanceMark(BaseModel):
    employee_id: str
    date: str = ""
    check_in: str = ""
    check_out: str = ""
    status: str = "present"
    notes: str = ""


class LeaveTypeCreate(BaseModel):
    name: str
    code: str
    annual_quota: int = 0
    is_paid: bool = True
    carry_forward: bool = False
    max_carry_forward: int = 0


class LeaveRequest(BaseModel):
    employee_id: str = ""
    leave_type_id: str
    start_date: str
    end_date: str
    days: float = 1
    reason: str = ""


class LeaveAction(BaseModel):
    status: str
    rejection_reason: str = ""


class HolidayCreate(BaseModel):
    name: str
    date: str
    is_optional: bool = False


class AnnouncementCreate(BaseModel):
    title: str
    body: str = ""
    priority: str = "normal"
    pinned: bool = False
    expires_at: str = ""


class AnnouncementUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    priority: str | None = None
    pinned: bool | None = None
    expires_at: str | None = None


class ExpenseClaimCreate(BaseModel):
    employee_id: str = ""
    category: str = "other"
    expense_date: str
    amount: float
    description: str = ""
    receipt_urls: list[str] = []


class ExpenseClaimAction(BaseModel):
    status: str
    rejection_reason: str = ""


class JobOpeningCreate(BaseModel):
    title: str
    department_id: str = ""
    description: str = ""


class JobOpeningUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None


class CandidateCreate(BaseModel):
    job_opening_id: str
    full_name: str
    email: str = ""
    phone: str = ""
    resume_url: str = ""
    #: `manav_candidates.resume_key` has existed since migration 057 with no
    #: writer, so `list_candidates`'s `if d.get("resume_key")` branch has never
    #: fired. Accepting the key here is what gives that branch a producer at
    #: all: a résumé held as a presigned URL alone expires in nine hours and
    #: nothing can re-sign it, which is how five executed e-sign PDFs became
    #: permanently unservable.
    #:
    #: Nothing in the product sends it yet, and that is the remaining half of
    #: the gap rather than a caveat on this one. `RecruitmentTab.jsx` offers a
    #: free-text "Resume URL" box and no upload control, and every candidate row
    #: in the database has an empty `resume_url` — so no résumé has been filed
    #: through the product to lose, and the URL-only path is not a compatibility
    #: case but the only one exercised today. The key cannot be derived from the
    #: URL here either: that box invites `drive.google.com/…` links, and signing
    #: a key scraped out of one would replace a working external link with a
    #: signature over an object no bucket holds. It stays `''` until a caller
    #: uploads through `POST /api/upload` and sends back the `key` it answers
    #: with.
    resume_key: str = ""
    notes: str = ""


class CandidateStageUpdate(BaseModel):
    stage: str
    rejection_reason: str = ""


# ── Employees ────────────────────────────────────────────────

@router.get("/employees")
async def list_employees(
    department: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    linked: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # `user_id` is in this list so the directory can show which employees have a
    # login and which do not. It was absent, and that absence is the whole reason
    # nobody noticed that none of them did: an unlinked employee rendered
    # identically to a linked one, in a table that carried no column about it.
    # The column is already returned by the detail endpoint to the same audience
    # (`_EMP_SAFE_COLS`), so this widens no audience — it just stops the list and
    # the detail view disagreeing about what a record contains.
    query = (
        "SELECT id, employee_code, name, email, phone, department, designation, "
        "employment_type, status, date_of_joining, shift, created_at, user_id, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    # The employee directory is other people. Without a grant the "directory" is
    # one row long — the caller's own — and empty if they have no employee row.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            # Same envelope as the populated path below. A caller reading
            # `total` must not get `undefined` here just because the list is
            # empty for a permissions reason rather than a data one — that is
            # how a "showing N of M" strip ends up rendering "showing 0 of".
            return {"data": [], "total": 0, "limit": 500, "truncated": False}
        query += f"AND id=${idx}::uuid "
        params.append(own)
        idx += 1

    if department:
        query += f"AND department=${idx} "
        params.append(department)
        idx += 1
    if status:
        query += f"AND status=${idx} "
        params.append(status)
        idx += 1
    if search:
        query += f"AND (name ILIKE '%' || ${idx} || '%' OR email ILIKE '%' || ${idx} || '%' OR employee_code ILIKE '%' || ${idx} || '%') "
        params.append(search)
        idx += 1

    # Contributes no parameter, so it can go last without disturbing `idx`.
    linked_sql = linked_filter_sql(linked)
    if linked_sql is None:
        raise HTTPException(400, "linked must be 'yes' or 'no'")
    query += linked_sql

    query += "ORDER BY name LIMIT 500"
    rows = await pool.fetch(query, *params)
    return _listed(rows, limit=500)


async def _preflight_login_invite(pool, user, org_id: str, body: "EmployeeCreate") -> dict:
    """Decide whether this employee may be invited to sign in — writing nothing.

    Reached only when the "this person needs a login" box is ticked. Everything
    it can refuse is refused before `create_employee` writes the personnel file,
    because the file carries an Aadhaar, a PAN and a bank account and telling an
    admin the hire failed after committing one is worse than any of these
    refusals.

    ── WHY THE MANAV GRANT IS NOT ENOUGH ──────────────────────────────────────

    `create_employee` already required ADMIN on Manav, and that is a MODULE
    grant. Inviting somebody into the organisation is not a module act: the
    invitation creates an account, seats it, and hands it an org role. If a
    Manav admin could do that, "administer HR records" would silently become
    "add members to this company", and `role_tiers.SEPARATED_DUTY` would be one
    tick away from being routed around — the person who defines what people are
    paid would be able to create the person who releases the money.

    So the caller must independently hold org authority, exactly as they would
    to press Invite on Settings → Members. `is_org_admin` is True for platform
    staff and for org_owner / org_admin, and for nobody else.

    The remaining refusals — the role being invitable, an org_admin not minting
    an org_owner, the module grants, an address that already has an account,
    the seat ceiling, and migration 187 — are NOT re-implemented here. They come
    from `org_invites.preflight_org_invite`, the same function the Settings
    screen goes through, so the two doors cannot drift into different answers.
    """
    email = (body.email or "").strip().lower()
    if not email:
        raise HTTPException(
            400,
            "An email address is required to send this person an invitation to "
            "create an account. Add the address, or leave the login box "
            "unticked — the employee still exists and can still be marked "
            "present in Pahchan.",
        )
    if "@" not in email:
        raise HTTPException(400, f"{body.email!r} is not an email address.")

    if not await _is_org_admin(pool, user, org_id):
        raise HTTPException(
            403,
            "Creating a login for this employee adds a member to your "
            "organisation, which only an organisation owner or admin can do. "
            "Add the employee without a login, or ask an owner to invite them.",
        )

    org_role = (body.login_role or "org_member").strip() or "org_member"
    if org_role not in INVITABLE_ROLES:
        raise HTTPException(
            400,
            f"Invalid role: {org_role}. Valid: {', '.join(INVITABLE_ROLES)}",
        )

    # NO MODULE GRANTS FROM THIS FORM, deliberately. The employee-create screen
    # is a personnel form; a module picker on it would be an authority editor
    # wearing an HR field's clothing, and the person filling it in is thinking
    # about a joining date. The invitation seats them in the organisation and
    # nothing more — grants are given afterwards, on the screen that exists for
    # giving them, where the separated-duty rule is visible.
    preflight = await preflight_org_invite(
        pool, user, org_id,
        email=email, org_role=org_role, module_grants=[],
        # A boolean, not the id — the employee does not exist yet; it is created
        # from the verdict this returns. It asks only whether an invitation is
        # CAPABLE of carrying one, i.e. whether migration 187 has been applied.
        # Without it the tick is refused with a 503 naming the file, rather than
        # minting an invitation that could never link.
        employee_link=True,
    )
    return {"email": email, "org_role": org_role, "preflight": preflight}


@router.post("/employees")
async def create_employee(
    body: EmployeeCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # A personnel file carries Aadhaar, PAN and bank details.
    _require(levels, ADMIN)

    valid_types = ("full_time", "part_time", "contract", "intern", "consultant")
    if body.employment_type not in valid_types:
        raise HTTPException(400, f"employment_type must be one of: {', '.join(valid_types)}")

    # The statutory identifiers are checked, not merely accepted. Every one of
    # them is copied onto a filing made in the employer's name — the UAN onto an
    # EPFO ECR, the ESI number onto a contribution return, the account onto a
    # salary payment file — and a malformed value there attributes real money to
    # the wrong person. `clean_employee_identifiers` refuses rather than
    # coercing, for the reason set out in its module docstring: a missing
    # identifier is fixed by typing it in, a wrong one is not noticed.
    ids = _clean_identifiers({
        "uan": body.uan, "esi_number": body.esi_number, "pan": body.pan,
        "bank_details": body.bank_details,
    }, aadhaar=body.aadhaar)

    # ── "THIS PERSON NEEDS A LOGIN" ─────────────────────────────────────────
    #
    # The whole verdict on the invitation is reached HERE, before a single row
    # is written, and nothing at all happens when the box is unticked — no
    # query, no seat counted, no mail. See `_preflight_login_invite`.
    #
    # BEFORE the attendance-seat guard rather than after, deliberately. That
    # guard's own comment says it is the last thing before the INSERT and a test
    # pins the property it protects, so it keeps that position. Ordering the two
    # this way also puts the FIXABLE refusal first: an organisation out of org
    # seats is answered by unticking the box and adding the employee anyway,
    # while an organisation out of attendance seats cannot take the hire at all.
    login_invite = None
    if body.create_login:
        login_invite = await _preflight_login_invite(pool, user, org_id, body)

    # ── ATTENDANCE SEATS ────────────────────────────────────────────────────
    #
    # A new employee row is born `is_active=TRUE`, so in an org that runs Pahchan
    # the INSERT below is the moment somebody joins the attendance roster — and
    # it is the ONLY such moment, because nothing in this router sets `is_active`
    # back to TRUE on an existing record. One admission, one gate.
    #
    # LAST BEFORE THE INSERT, AND THAT POSITION IS ARGUED RATHER THAN INHERITED.
    # Two orderings are defensible and this is the better one:
    #
    #   · It is BEFORE the write, which is the requirement that actually matters.
    #     A personnel file carries an Aadhaar, a PAN and a bank account. A guard
    #     that ran after the INSERT would leave the org over its cap AND holding
    #     the row that put it there, while telling the caller the hire failed.
    #     `test_a_refused_hire_writes_no_personnel_file` pins this.
    #   · It is AFTER `_clean_identifiers`, which is pure and touches no database.
    #     A malformed UAN is a 422 whatever the seat count says, so checking
    #     seats first would spend a query to reach the same refusal — and would
    #     make `test_nothing_is_written_when_the_identifier_is_refused`, which
    #     asserts that a refused identifier asks the database NOTHING, false.
    #
    # This refuses NOBODY today. No organisation has `max_pahchan_seats` set —
    # the column does not exist until migration 109 is applied by hand — and a
    # NULL allowance is unlimited. It also never fires for an org that does not
    # have the `pahchan` module active, which is what stops a firm running Manav
    # for payroll alone from being refused a hire over a module it does not use.
    await assert_pahchan_seat_available(pool, org_id)

    # The INSERT and `employee.joined` share one transaction: the event exists
    # iff the personnel file does. RETURNING * because the emitter reads
    # department/designation/user_id off the row; the RESPONSE keeps the three
    # keys it always had — a personnel row also carries PAN, Aadhaar and bank
    # details, and RETURNING * must not widen what leaves the API.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "INSERT INTO staging.manav_employees "
                "(org_id, user_id, employee_code, name, email, phone, department, designation, "
                " date_of_joining, date_of_birth, gender, blood_group, emergency_contact, "
                " address, bank_details, pan, aadhaar, uan, esi_number, employment_type, "
                " reporting_to, shift, created_by) "
                "VALUES ($1::uuid, NULLIF($2,''), NULLIF($3,''), $4, $5, $6, $7, $8, "
                " NULLIF($9,'')::date, NULLIF($10,'')::date, NULLIF($11,''), $12, $13, $14, $15, "
                " $16, $17, $18, $19, $20, NULLIF($21,''), $22, $23) "
                "RETURNING *",
                org_id, body.user_id, body.employee_code, body.name, body.email, body.phone,
                body.department, body.designation, body.date_of_joining, body.date_of_birth,
                # `body.address` and `body.bank_details` are passed as DICTS, exactly
                # like `body.emergency_contact` beside them — NOT through `json.dumps`.
                #
                # `db.py` registers a jsonb codec whose encoder IS `json.dumps`, so
                # dumping first encodes twice and the column ends up holding a JSON
                # *string* rather than an object. This one INSERT is the cleanest proof
                # of it in the codebase: three jsonb columns, written side by side, and
                # the only one that stored correctly was the one passed as a dict —
                # measured live, `emergency_contact` came back `object` while `address`
                # and `bank_details` both came back `string`.
                #
                # The consequence was not cosmetic. `_mask_employee_pii` calls
                # `_mask_bank(row["bank_details"])`, which expects a mapping, so
                # **`GET /v1/manav/employees/{id}` returned 500 for every employee in
                # the org** — the whole employee detail view was dead, and the failure
                # reached the browser as a CORS error because the exception escaped
                # before `CORSMiddleware` attached its headers.
                body.gender or None, body.blood_group, body.emergency_contact, body.address,
                # `encrypt_bank`, not the raw dict: the account number is held as
                # ciphertext for the same reason the Aadhaar beside it is. See
                # `services/pii.py`. The IFSC and bank name inside the same jsonb stay
                # readable — they identify a branch, not a person.
                encrypt_bank(ids["bank_details"]), ids["pan"], encrypt(body.aadhaar),
                ids["uan"], ids["esi_number"],
                body.employment_type, body.reporting_to, body.shift, user["user_id"],
            )
            await employee_joined(
                _conn, org_id=org_id, actor_id=user["user_id"],
                employee_id=row["id"], row=dict(row),
            )

    # ── The invitation, AFTER the personnel file exists ─────────────────────
    #
    # It has to be after: the invite carries this employee's id, and the id does
    # not exist until the INSERT above returns. Everything that could refuse it
    # was already asked and answered before that INSERT ran.
    #
    # OUTSIDE the transaction, and that is the point. `invites` is a `public`
    # table read by the login path; the personnel row and its Niyam event share
    # one transaction because the event is true iff the file exists, and an
    # invitation is not that kind of fact. Holding the HR transaction open
    # across an SMTP call would also mean a slow mail server locking a personnel
    # table.
    #
    # A FAILURE HERE DOES NOT FAIL THE HIRE. The employee is committed; telling
    # the admin the request failed would send them to add the same person a
    # second time. `issue_invite` already takes this position for a mail that
    # will not send — the invite row is committed and the link is returned, so a
    # mail failure costs delivery, not the invitation. Same reasoning one level
    # out: a failed invitation costs the invitation, not the personnel file, and
    # the response says so plainly enough for the screen to raise it.
    invite_result = None
    if login_invite is not None:
        try:
            created = await issue_invite(
                pool, user, org_id,
                login_invite["email"], login_invite["org_role"], body.name,
                login_invite["preflight"].grants,
                login_invite["preflight"].caller_role,
                employee_id=str(row["id"]),
            )
            invite_result = {"sent": True, "email": created.email}
        except HTTPException as exc:
            invite_result = {"sent": False, "error": str(exc.detail)}
        except Exception as exc:
            logging.getLogger(__name__).warning(
                "employee created but the login invitation could not be sent: %s", exc,
            )
            invite_result = {
                "sent": False,
                "error": "The employee was added but the invitation could not be "
                         "sent. Invite them from Settings → Members.",
            }

    out = {
        "status": "created",
        "id": row["id"], "name": row["name"], "employee_code": row["employee_code"],
    }
    # Absent, not `null`, when nobody asked for a login. A key that is always
    # there and usually says nothing reads as a feature every employee has.
    if invite_result is not None:
        out["invite"] = invite_result
    return out


class EmployeeLinkBody(BaseModel):
    """Either identifier will do. `user_id` is what the picker sends; `email` is
    for the HR admin who knows the address and not the opaque id."""
    user_id: str = ""
    email: str = ""


@router.get("/employees/link-candidates")
async def list_link_candidates(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The accounts an employee record can be linked to, and who holds each.

    DECLARED BEFORE `/employees/{employee_id}`, and it has to stay there.
    FastAPI matches routes in declaration order, so below that route this literal
    path is swallowed by the UUID path parameter and answered 422 — a routing bug
    that reads in the browser as a malformed request from the client.

    Admin-gated like the rest of the personnel writes: this lists the email
    address of every member of the organisation, which is not something a module
    viewer is owed, and its only purpose is to feed a write only an admin may
    make.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    members = await pool.fetch(_ORG_MEMBER_SQL + "ORDER BY 3", org_id, list(ORG_ROLES))
    # Every link in the org, including the ones on inactive records. An account
    # held by a terminated employee is still held — offering it as free would
    # produce a second row pointing at the same login, which is the collision
    # `link_refusal` exists to prevent.
    links = await pool.fetch(
        "SELECT id, name, user_id FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND user_id IS NOT NULL",
        org_id,
    )
    data = link_candidates([dict(m) for m in members], [dict(r) for r in links])
    return {
        "data": data,
        "total": len(data),
        "unlinked_accounts": sum(1 for c in data if c["linked_employee_id"] is None),
    }


@router.get("/employees/awaiting-link")
async def list_employees_awaiting_link(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The personnel records with no login, and the ones that already have one.

    DECLARED BEFORE `/employees/{employee_id}`, and it has to stay there —
    FastAPI matches in declaration order and below that route this literal path
    is swallowed by the UUID parameter and answered 422.

    Both halves in one response because the screen shows both and they are one
    number: "12 of 98 done" is the only honest way to render a queue, and a
    second request for the denominator is a second chance for the two halves to
    disagree. The linked half is what makes a WRONG link fixable — it is where a
    human sees that Priya's record is pointing at Rahul's account, and it
    carries the employee id the DELETE needs.

    Admin-gated, like every other read on this file that names another person's
    account. `is_active=TRUE` on both halves: `link_refusal` will not link a
    terminated record, so offering one here would be offering an action that is
    refused on submit.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    waiting_rows = await pool.fetch(
        "SELECT id, employee_code, name, email, department, designation, "
        "date_of_joining, status "
        "FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND user_id IS NULL "
        "ORDER BY name",
        org_id,
    )
    # LEFT JOIN, not JOIN. A link whose account has since been deleted is the
    # state that most needs showing — an INNER JOIN drops that row and the queue
    # then claims the record is done, which is the same class of lie as an
    # unlinked employee rendering identically to a linked one.
    #
    # The join is on `user_id` alone, and that is safe HERE because `e.org_id`
    # has already scoped the left side: the only account reachable is the one
    # this organisation's own row points at. (`graha_clients` has a join on id
    # alone with no such scoping and it can surface another org's row — this is
    # not that shape.)
    held_rows = await pool.fetch(
        "SELECT e.id, e.employee_code, e.name, e.department, e.designation, "
        "u.email AS account_email, COALESCE(u.full_name, u.name) AS account_name "
        "FROM staging.manav_employees e "
        "LEFT JOIN users u ON u.user_id = e.user_id "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE AND e.user_id IS NOT NULL "
        "ORDER BY e.name",
        org_id,
    )

    waiting = link_worklist([dict(r) for r in waiting_rows])
    linked = []
    for r in held_rows:
        row = dict(r)
        linked.append({
            "id": str(row["id"]),
            "employee_code": row.get("employee_code") or "",
            "name": row.get("name") or "",
            "department": row.get("department") or "",
            "designation": row.get("designation") or "",
            "account_name": row.get("account_name") or "",
            "account_email": row.get("account_email") or "",
            # The account this record points at no longer exists. Reported as
            # its own state rather than as "linked", because the remedy is
            # different: unlink it and link a current account.
            "account_missing": not (row.get("account_email") or row.get("account_name")),
        })

    return {
        "data": waiting,
        "total": len(waiting),
        "linked": linked,
        "counts": {
            "employees": len(waiting) + len(linked),
            "awaiting_link": len(waiting),
            "linked": len(linked),
        },
    }


@router.get("/employees/link-options")
async def list_link_options(
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Every account in this organisation, with what tells two of them apart.

    DECLARED BEFORE `/employees/{employee_id}` — see the note above.

    This is `link-candidates` answered for a different screen. That one feeds
    the picker inside one employee's record and returns a shape pinned to five
    keys; this one feeds the review screen, where the whole queue is worked
    through at once and the deciding fact is often not the name. The two are
    separate endpoints rather than one with a flag because their shapes are
    pinned by different tests for different reasons, and because widening the
    older one is how `password_hash` would eventually travel.

    NOTHING HERE IS MATCHED. No employee id is accepted, no name is compared, no
    row is marked "probably this one". `account_options` is not given the
    employee at all.

    Audited. It discloses the address, the joining date and the last four digits
    of the mobile number of every member of the organisation — a small export,
    and one worth a row saying who took it.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    accounts = await pool.fetch(_ORG_ACCOUNT_SQL, org_id, list(ORG_ROLES))
    # Every link in the org, INCLUDING the ones on inactive records: an account
    # held by a terminated employee is still held, and offering it as free
    # produces the second row `link_refusal` exists to prevent.
    links = await pool.fetch(
        "SELECT id, name, user_id FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND user_id IS NOT NULL",
        org_id,
    )
    grants = await pool.fetch(
        "SELECT user_id, module_code FROM staging.org_member_modules "
        "WHERE org_id=$1::uuid",
        org_id,
    )

    data = account_options(
        [dict(a) for a in accounts],
        [dict(r) for r in links],
        [dict(g) for g in grants],
    )
    audit(
        "manav.link_options_read",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_employee",
        detail={"accounts": len(data)},
    )
    return {
        "data": data,
        "total": len(data),
        "free": sum(1 for c in data if c["linked_employee_id"] is None),
        "taken": sum(1 for c in data if c["linked_employee_id"] is not None),
        # The count the screen warns on. Stated by the server so the warning and
        # the list cannot disagree about how many labels repeat.
        "shared_names": len({c["full_name"].lower() for c in data if c["name_is_shared"]}),
    }


@router.post("/employees/{employee_id}/link")
async def link_employee_login(
    employee_id: UUID,
    body: EmployeeLinkBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Connect this personnel record to an account that already exists.

    It does NOT create the account, send an invitation, or grant anything. The
    account must already be a member of this organisation — `org_invites` is the
    one place in the product that puts a person into an org, and it counts seats
    while it does. A second door into that would be a second seat counter.

    Admin, not editor: the link decides whose payslip, whose attendance and whose
    leave a person can read, so it is an authority change wearing an HR field's
    clothing.
    """
    _require(levels, ADMIN)
    if not body.user_id and not body.email:
        raise HTTPException(400, "Give either a user_id or the account's email address.")

    pool = await get_pool()
    employee = await pool.fetchrow(
        "SELECT id, name, user_id, is_active FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    # All three reads run before any decision, so the refusal is worked out in
    # one place from one picture rather than raised from three points on the way
    # down. Two of them are wasted in the not-found case; a personnel record that
    # does not exist is not a hot path.
    if body.user_id:
        member = await pool.fetchrow(
            _ORG_MEMBER_SQL + "AND u.user_id=$3 LIMIT 1",
            org_id, list(ORG_ROLES), body.user_id,
        )
    else:
        member = await pool.fetchrow(
            _ORG_MEMBER_SQL + "AND LOWER(u.email)=LOWER($3) LIMIT 1",
            org_id, list(ORG_ROLES), body.email,
        )
    holder = None
    if member:
        holder = await pool.fetchrow(
            "SELECT id, name FROM staging.manav_employees "
            "WHERE org_id=$1::uuid AND user_id=$2 AND id <> $3::uuid",
            org_id, member["user_id"], str(employee_id),
        )

    refusal = link_refusal(
        dict(employee) if employee else None,
        dict(member) if member else None,
        dict(holder) if holder else None,
    )
    if refusal:
        raise HTTPException(refusal[0], refusal[1])

    await pool.execute(
        "UPDATE staging.manav_employees SET user_id=$1, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid",
        member["user_id"], str(employee_id), org_id,
    )
    # Audited like the identity-document read above. This is the row that decides
    # who may open a payslip; a change to it that leaves no trace is the kind of
    # thing that is only ever noticed by the person it was done to.
    audit(
        "manav.employee_login_linked",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_employee",
        resource_id=str(employee_id),
        detail={"linked_user_id": member["user_id"], "email": dict(member).get("email")},
        severity="warn",
    )
    m = dict(member)
    return {
        "status": "linked",
        "employee_id": str(employee_id),
        "user_id": m["user_id"],
        "email": m.get("email") or "",
        "full_name": m.get("full_name") or "",
    }


@router.delete("/employees/{employee_id}/link")
async def unlink_employee_login(
    employee_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Detach the login from this personnel record.

    This removes SELF-SERVICE, not access. The person keeps their account, their
    org membership and every module grant they hold; what they lose is the route
    from their session to this employee row — their own payslip, their own
    attendance, their own leave, and the ability to clock in. Undoing a link made
    against the wrong record is the reason it exists, and it is the only way to
    move an account from one record to another, since `link` refuses to
    overwrite one silently.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, user_id FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Employee not found")
    if not row["user_id"]:
        # Not an error. The record is already in the state that was asked for,
        # and answering 404/409 here makes a double-click look like a failure.
        return {"status": "not_linked", "employee_id": str(employee_id)}

    await pool.execute(
        "UPDATE staging.manav_employees SET user_id=NULL, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    audit(
        "manav.employee_login_unlinked",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_employee",
        resource_id=str(employee_id),
        detail={"unlinked_user_id": row["user_id"]},
        severity="warn",
    )
    return {
        "status": "unlinked",
        "employee_id": str(employee_id),
        "was_user_id": row["user_id"],
    }


@router.get("/employees/{employee_id}")
async def get_employee(
    employee_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Explicit column list, never SELECT *. The identity-kit columns are fetched
    # separately and masked, so a column added to the table later cannot start
    # leaking without someone editing this list.
    row = await pool.fetchrow(
        f"SELECT {_EMP_SAFE_COLS}, aadhaar, pan, bank_details "
        "FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Employee not found")

    # Own profile with no grant at all — the SELF_SCOPED_MODULES promise. Anyone
    # else's needs viewer. 404 rather than 403 so the answer does not confirm
    # that an employee with that id exists in this org.
    if row["user_id"] != user["user_id"] and not _can(levels, VIEWER):
        raise HTTPException(404, "Employee not found")

    leave_balances = await pool.fetch(
        "SELECT lb.*, lt.name as leave_name, lt.code as leave_code "
        "FROM staging.manav_leave_balances lb "
        "JOIN staging.manav_leave_types lt ON lt.id = lb.leave_type_id "
        "WHERE lb.employee_id=$1::uuid AND lb.year=EXTRACT(YEAR FROM CURRENT_DATE)::int",
        str(employee_id),
    )

    # Which account this record is linked to, in words rather than as an opaque
    # `user_549c9cac35aa`. Only looked up when there IS one, so the unlinked
    # case — which is currently every record in the database — costs nothing.
    #
    # Assembled key by key rather than `dict(acct)`: this is a `SELECT` against
    # `users`, the table that carries `password_hash` and `salt`, and building
    # the response from three names means a widened SELECT cannot widen the
    # response with it.
    login = None
    if row["user_id"]:
        acct = await pool.fetchrow(
            "SELECT user_id, email, COALESCE(full_name, name) AS full_name "
            "FROM users WHERE user_id=$1",
            row["user_id"],
        )
        a = dict(acct) if acct else {}
        login = {
            "user_id": row["user_id"],
            "email": a.get("email") or "",
            # An account that no longer exists is a real state — it is what a
            # deleted user leaves behind — and it must read as a broken link
            # rather than as no link at all.
            "full_name": a.get("full_name") or "",
            "missing": acct is None,
        }

    return {
        # Decrypt BEFORE masking. Masking ciphertext would render the last four
        # characters of a Fernet token and present them as the last four digits
        # of an Aadhaar number.
        "employee": _mask_employee_pii(_decrypt_cols(dict(row))),
        "leave_balances": [dict(lb) for lb in leave_balances],
        "login": login,
    }


@router.get("/employees/{employee_id}/sensitive")
async def get_employee_sensitive(
    employee_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
    _r=Depends(_pii_gate),
):
    """Full Aadhaar, PAN and bank account for one employee.

    Separate from the detail endpoint on purpose: module membership is not
    sufficient authority to read an identity document, so this requires an org
    owner or admin. Every read is audited, including reads by platform staff —
    `require_org_role` passes them unconditionally, so without the audit row
    below their access would be silent, which the project's standing rule
    forbids.

    BOTH gates, deliberately. `_pii_gate` is the org role and `admin` is the
    module level; an unmasked Aadhaar is the highest bar in this file and it
    keeps whichever of the two is stricter. There is no self-scoped path here on
    purpose — an employee reading their OWN Aadhaar back from the server is not
    a flow the product has, and adding it would make this endpoint reachable by
    everyone in the org.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, employee_code, aadhaar, pan, bank_details "
        "FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Employee not found")

    via_platform = await is_platform_staff(user["user_id"])
    audit(
        "manav.employee_pii_revealed",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_employee",
        resource_id=str(employee_id),
        detail={
            "fields": list(_SENSITIVE_COLS),
            "via": "platform_bypass" if via_platform else "org_admin",
        },
        severity="warn",
    )
    return {"employee": _decrypt_cols(dict(row)), "audited": True}


@router.patch("/employees/{employee_id}")
async def update_employee(
    employee_id: UUID,
    body: EmployeeUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Same row, same identity kit.
    _require(levels, ADMIN)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    # Same checks as the INSERT, and the Aadhaar comparison needs the value
    # already on the row — an edit that sets only the UAN carries no Aadhaar in
    # its body, and that is exactly the edit where pasting the wrong twelve
    # digits happens. One extra read on an admin-only path buys the check.
    if "uan" in updates:
        stored = await pool.fetchval(
            "SELECT aadhaar FROM staging.manav_employees "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(employee_id), org_id,
        )
        aadhaar = decrypt(stored) if stored else ""
        # Ciphertext that would not open is not an Aadhaar to compare against.
        # Skip the check rather than comparing a UAN to a Fernet token, which
        # would never match and would silently stop checking anything.
        updates = _clean_identifiers(updates, aadhaar="" if is_encrypted(aadhaar) else aadhaar)
    else:
        updates = _clean_identifiers(updates)

    # Before the SET list is built below, so the generic column loop never sees
    # a plaintext aadhaar and cannot write one simply by not knowing about it.
    updates = _encrypt_cols(updates)
    if "bank_details" in updates:
        updates["bank_details"] = encrypt_bank(updates["bank_details"])

    sets = []
    params = [str(employee_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k == "bank_details":
            # MERGE (`||`), not replace, and this is the difference between an
            # edit form that works and one that destroys data. The account
            # number comes back from the detail endpoint MASKED, so a form
            # cannot round-trip it; the only safe thing it can send is the
            # fields the admin actually retyped. Replacing the whole document
            # with those would wipe the account number every time somebody
            # corrected the IFSC — a successful-looking save that surfaces
            # months later as a failed salary credit. `||` is a shallow merge,
            # which is the right depth for a flat bag of bank fields, and
            # clearing a key is still possible by sending it as "".
            sets.append(f"{k}=COALESCE({k}, '{{}}'::jsonb) || ${idx}::text::jsonb")
            params.append(json.dumps(v))
        elif k == "address":
            # `::text::jsonb`, not `::jsonb` — see the INSERT above. Binding an
            # already-dumped string to a jsonb parameter runs it through the
            # codec's `json.dumps` a second time and stores a JSON string.
            sets.append(f"{k}=${idx}::text::jsonb")
            params.append(json.dumps(v))
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.manav_employees SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/employees/{employee_id}")
async def deactivate_employee(
    employee_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Terminating someone is not an editor's call.
    _require(levels, ADMIN)
    await pool.execute(
        "UPDATE staging.manav_employees SET is_active=FALSE, status='terminated', updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    return {"status": "deactivated"}



# ── Offboarding and exit interviews ──────────────────────────────────────────
#
# Before this, offboarding was `DELETE /employees/{id}` setting
# `is_active=FALSE, status='terminated'` and nothing else. No record of why
# someone left, when, what they had to return, or what they were owed — and
# because `process_payroll` joins on `e.is_active=TRUE`, an offboarded employee
# dropped out of payroll the same day, so an outstanding salary advance was
# never recovered.


class OffboardingCreate(BaseModel):
    employee_id: str
    exit_type: str = "resignation"
    reason: str = ""
    resignation_date: str = ""
    last_working_day: str = ""
    notice_period_days: int = 0
    notice_waived: bool = False
    clearance: list = []
    rehire_eligible: bool | None = None
    notes: str = ""


class OffboardingUpdate(BaseModel):
    exit_type: str | None = None
    reason: str | None = None
    resignation_date: str | None = None
    last_working_day: str | None = None
    notice_period_days: int | None = None
    notice_waived: bool | None = None
    clearance: list | None = None
    rehire_eligible: bool | None = None
    status: str | None = None
    notes: str | None = None


class ExitInterviewCreate(BaseModel):
    employee_id: str
    primary_reason: str = ""
    overall_rating: int | None = None
    would_recommend: bool | None = None
    would_return: bool | None = None
    responses: list = []
    notes: str = ""


#: The default clearance checklist. A firm can replace it wholesale — the
#: column is jsonb precisely so nobody needs a migration to add "return the
#: office key" — but an empty list on day one is a checklist nobody uses.
_DEFAULT_CLEARANCE = [
    {"item": "Laptop and accessories returned", "owner": "IT", "done": False},
    {"item": "ID card and access cards returned", "owner": "Admin", "done": False},
    {"item": "Client files and handover completed", "owner": "Reporting manager", "done": False},
    {"item": "Email and system access revoked", "owner": "IT", "done": False},
    {"item": "Company assets and advances cleared", "owner": "Finance", "done": False},
    {"item": "Knowledge transfer documented", "owner": "Reporting manager", "done": False},
]

_EXIT_TYPES = ("resignation", "termination", "retirement", "end_of_contract",
               "abandonment", "redundancy", "death")
_OFFBOARDING_STATUSES = ("initiated", "in_clearance", "interview_done", "settled",
                         "completed", "cancelled")


def _exit_date(value):
    """A date string, or None. Empty means 'not known yet', not today."""
    return date.fromisoformat(value) if value else None


@router.get("/offboarding")
async def list_offboarding(
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Every exit, newest first. Viewer-gated like the rest of the register."""
    pool = await get_pool()
    q = ("SELECT o.*, e.name AS employee_name, e.employee_code, e.department, e.designation, "
         "       (SELECT count(*) FROM staging.manav_exit_interviews i "
         "         WHERE i.employee_id = o.employee_id AND i.org_id = o.org_id) AS has_interview "
         "FROM staging.manav_offboarding o "
         "JOIN staging.manav_employees e ON e.id = o.employee_id "
         "WHERE o.org_id=$1::uuid")
    params = [org_id]
    if status:
        params.append(status)
        q += f" AND o.status=${len(params)}"
    q += " ORDER BY o.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/offboarding")
async def start_offboarding(
    body: OffboardingCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Begin an exit. Does NOT deactivate the employee.

    Deactivation happens at completion, not initiation, and the distinction is
    the point: someone serving notice is still on the payroll, still accrues
    leave, and still has a salary advance being recovered. Marking them inactive
    the moment they resign is what made the advance unrecoverable before.
    """
    _require(levels, ADMIN)
    if body.exit_type not in _EXIT_TYPES:
        raise HTTPException(400, f"exit_type must be one of: {', '.join(_EXIT_TYPES)}")

    pool = await get_pool()
    emp = await pool.fetchrow(
        "SELECT id, name, is_active FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        body.employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")

    existing = await pool.fetchval(
        "SELECT status FROM staging.manav_offboarding "
        "WHERE org_id=$1::uuid AND employee_id=$2::uuid AND status <> 'cancelled'",
        org_id, body.employee_id,
    )
    if existing:
        raise HTTPException(
            409,
            f"{emp['name']} already has an exit in progress ({existing}). "
            "Cancel it before starting another.",
        )

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_offboarding "
        "(org_id, employee_id, exit_type, reason, resignation_date, last_working_day, "
        " notice_period_days, notice_waived, clearance, rehire_eligible, notes, initiated_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12) "
        "RETURNING *",
        org_id, body.employee_id, body.exit_type, body.reason,
        _exit_date(body.resignation_date), _exit_date(body.last_working_day),
        body.notice_period_days, body.notice_waived,
        body.clearance or _DEFAULT_CLEARANCE,
        body.rehire_eligible, body.notes, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/offboarding/{offboarding_id}")
async def update_offboarding(
    offboarding_id: UUID,
    body: OffboardingUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Amend an exit — dates, notice, the clearance checklist, or its status."""
    _require(levels, ADMIN)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    if "exit_type" in updates and updates["exit_type"] not in _EXIT_TYPES:
        raise HTTPException(400, f"exit_type must be one of: {', '.join(_EXIT_TYPES)}")
    if "status" in updates and updates["status"] not in _OFFBOARDING_STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(_OFFBOARDING_STATUSES)}")

    pool = await get_pool()
    sets, params, idx = [], [str(offboarding_id), org_id], 3
    for k, v in updates.items():
        if k in ("resignation_date", "last_working_day"):
            sets.append(f"{k}=${idx}::date")
            params.append(_exit_date(v) if isinstance(v, str) else v)
        else:
            # `clearance` is bound as a LIST, never json.dumps'd. db.py's codec
            # encodes it once; dumping first is what produced JSON strings
            # across 38 columns.
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    row = await pool.fetchrow(
        f"UPDATE staging.manav_offboarding SET {', '.join(sets)} "
        "WHERE id=$1::uuid AND org_id=$2::uuid RETURNING *",
        *params,
    )
    if not row:
        raise HTTPException(404, "Offboarding record not found")
    return {"status": "updated", **dict(row)}


@router.post("/offboarding/{offboarding_id}/complete")
async def complete_offboarding(
    offboarding_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Close the exit and deactivate the employee — the LAST step, not the first.

    Refuses while clearance is outstanding. A firm that wants to close anyway
    can tick the remaining items or amend the checklist; what it cannot do is
    close silently and discover next quarter that a laptop was never returned.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT o.*, e.name AS employee_name FROM staging.manav_offboarding o "
        "JOIN staging.manav_employees e ON e.id = o.employee_id "
        "WHERE o.id=$1::uuid AND o.org_id=$2::uuid",
        str(offboarding_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Offboarding record not found")
    if row["status"] == "completed":
        raise HTTPException(409, "This exit is already completed")

    clearance = row["clearance"] or []
    if isinstance(clearance, str):
        try:
            clearance = json.loads(clearance)
        except (ValueError, TypeError):
            clearance = []
    pending = [c.get("item") for c in clearance if isinstance(c, dict) and not c.get("done")]
    if pending:
        shown = ", ".join(str(p) for p in pending[:4])
        more = " and more" if len(pending) > 4 else ""
        raise HTTPException(
            409,
            f"{len(pending)} clearance item(s) still outstanding: {shown}{more}. "
            "Tick them off, or amend the checklist.",
        )

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE staging.manav_offboarding SET status='completed', updated_at=NOW() "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                str(offboarding_id), org_id,
            )
            # RETURNING * because `employee.exited` reads department and
            # user_id off the employee row it is about. Same connection, same
            # transaction: the event exists iff the deactivation committed.
            emp_row = await conn.fetchrow(
                "UPDATE staging.manav_employees SET is_active=FALSE, status=$3, updated_at=NOW() "
                "WHERE id=$1::uuid AND org_id=$2::uuid RETURNING *",
                str(row["employee_id"]), org_id,
                "resigned" if row["exit_type"] == "resignation" else "terminated",
            )
            # `exit_type` comes from the offboarding row — manav_offboarding's
            # CHECK (_EXIT_TYPES) is the vocabulary. Emitted at COMPLETION, not
            # initiation: someone serving notice has not exited.
            if emp_row is not None:
                await employee_exited(
                    conn, org_id=org_id, actor_id=user["user_id"],
                    employee_id=row["employee_id"], row=dict(emp_row),
                    exit_type=row["exit_type"],
                )
    return {"status": "completed", "employee": row["employee_name"]}


@router.get("/exit-interviews")
async def list_exit_interviews(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Exit interviews, newest first, with the leaver's name attached."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT i.*, e.name AS employee_name, e.employee_code, e.department, e.designation "
        "FROM staging.manav_exit_interviews i "
        "JOIN staging.manav_employees e ON e.id = i.employee_id "
        "WHERE i.org_id=$1::uuid ORDER BY i.created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/exit-interviews/reasons")
async def exit_reason_summary(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Why people leave, counted. The reason the structured fields exist.

    A pile of free-text interviews cannot be counted, and 'why is everyone
    leaving' is the one question an exit interview is meant to answer.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT primary_reason, count(*) AS leavers, "
        "       round(avg(overall_rating)::numeric, 2) AS avg_rating, "
        "       count(*) FILTER (WHERE would_recommend) AS would_recommend "
        "FROM staging.manav_exit_interviews "
        "WHERE org_id=$1::uuid AND primary_reason IS NOT NULL "
        "GROUP BY primary_reason ORDER BY leavers DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/exit-interviews")
async def record_exit_interview(
    body: ExitInterviewCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Record the interview, and move the exit on to `interview_done`.

    Upserts on (org_id, employee_id): a second interview is a correction, and a
    correction belongs in the row rather than beside it.
    """
    _require(levels, ADMIN)
    if body.overall_rating is not None and not 1 <= body.overall_rating <= 5:
        raise HTTPException(400, "overall_rating must be between 1 and 5")

    pool = await get_pool()
    emp = await pool.fetchrow(
        "SELECT id, name FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        body.employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")

    off_id = await pool.fetchval(
        "SELECT id FROM staging.manav_offboarding "
        "WHERE org_id=$1::uuid AND employee_id=$2::uuid AND status <> 'cancelled'",
        org_id, body.employee_id,
    )

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_exit_interviews "
        "(org_id, employee_id, offboarding_id, conducted_by, conducted_at, primary_reason, "
        " overall_rating, would_recommend, would_return, responses, notes) "
        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, NOW(), NULLIF($5,''), $6, $7, $8, $9, $10) "
        "ON CONFLICT (org_id, employee_id) DO UPDATE SET "
        "  conducted_by=EXCLUDED.conducted_by, conducted_at=EXCLUDED.conducted_at, "
        "  primary_reason=EXCLUDED.primary_reason, overall_rating=EXCLUDED.overall_rating, "
        "  would_recommend=EXCLUDED.would_recommend, would_return=EXCLUDED.would_return, "
        "  responses=EXCLUDED.responses, notes=EXCLUDED.notes, updated_at=NOW() "
        "RETURNING *",
        org_id, body.employee_id, str(off_id) if off_id else "", user["user_id"],
        body.primary_reason, body.overall_rating, body.would_recommend,
        body.would_return, body.responses, body.notes,
    )

    # Only advance a live exit, and never backwards from settled/completed.
    if off_id:
        await pool.execute(
            "UPDATE staging.manav_offboarding SET status='interview_done', updated_at=NOW() "
            "WHERE id=$1::uuid AND status IN ('initiated','in_clearance')",
            str(off_id),
        )
    return {"status": "recorded", **dict(row)}


# ── Departments ──────────────────────────────────────────────

@router.get("/departments")
async def list_departments(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Names a department head, so it names a person.
    _require(levels, VIEWER)
    rows = await pool.fetch(
        "SELECT d.id, d.name, d.created_at, e.name as head_name, "
        "(SELECT COUNT(*) FROM staging.manav_employees WHERE department=d.name AND org_id=d.org_id AND is_active=TRUE) as employee_count "
        "FROM staging.manav_departments d "
        "LEFT JOIN staging.manav_employees e ON e.id = d.head_employee_id "
        "WHERE d.org_id=$1::uuid AND d.is_active=TRUE ORDER BY d.name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/departments")
async def create_department(
    body: DepartmentCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_departments (org_id, name, head_employee_id) "
        "VALUES ($1::uuid, $2, NULLIF($3,'')::uuid) RETURNING id, name",
        org_id, body.name, body.head_employee_id,
    )
    return {"status": "created", **dict(row)}


@router.patch("/departments/{dept_id}")
async def update_department(
    dept_id: str,
    body: DepartmentCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "UPDATE staging.manav_departments SET name=$3, head_employee_id=NULLIF($4,'')::uuid "
        "WHERE id=$1::uuid AND org_id=$2::uuid RETURNING id, name",
        dept_id, org_id, body.name, body.head_employee_id,
    )
    if not row:
        raise HTTPException(404, "Department not found")
    return {"status": "updated", **dict(row)}


@router.delete("/departments/{dept_id}")
async def delete_department(
    dept_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    emp_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees e "
        "JOIN staging.manav_departments d ON d.name = e.department AND d.org_id = e.org_id "
        "WHERE d.id=$1::uuid AND d.org_id=$2::uuid AND e.is_active=TRUE",
        dept_id, org_id,
    )
    if emp_count and emp_count > 0:
        raise HTTPException(400, f"Cannot delete — {emp_count} active employee(s) in this department")
    await pool.execute(
        "UPDATE staging.manav_departments SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        dept_id, org_id,
    )
    return {"status": "deleted"}


# ── Attendance ───────────────────────────────────────────────

@router.get("/attendance")
async def list_attendance(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    d_from = date.fromisoformat(date_from) if date_from else date.today()
    d_to = date.fromisoformat(date_to) if date_to else d_from

    query = (
        "SELECT a.id, a.date, a.check_in, a.check_out, a.status, "
        "a.work_hours, a.overtime_hours, a.marked_by, "
        "e.name as employee_name, e.employee_code "
        "FROM staging.manav_attendance a "
        "JOIN staging.manav_employees e ON e.id = a.employee_id "
        "WHERE a.org_id=$1::uuid AND a.date >= $2::date AND a.date <= $3::date "
    )
    params: list = [org_id, d_from, d_to]
    idx = 4

    # Own attendance with no grant; anyone else's needs viewer. Asking for a
    # colleague's employee_id from self scope is refused rather than silently
    # rewritten, so the caller is not told an empty list means "no records".
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own attendance")
        employee_id = own

    if employee_id:
        query += f"AND a.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1

    query += "ORDER BY a.date DESC, e.name"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/attendance")
async def mark_attendance(
    body: AttendanceMark,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Marks attendance for ANY employee — never reachable at self scope.
    _require(levels, EDITOR)
    att_date = date.fromisoformat(body.date) if body.date else date.today()

    valid_statuses = ("present", "absent", "half_day", "late", "on_leave", "holiday", "weekend")
    if body.status not in valid_statuses:
        raise HTTPException(400, f"status must be one of: {', '.join(valid_statuses)}")

    # ANY employee IN THIS ORG. `GET /attendance` filters on the attendance
    # row's org_id and joins `manav_employees` on id alone, so a row written
    # here for a foreign uuid comes back out carrying that tenant's name and
    # employee code. See `_employee_in_org`.
    #
    # AFTER the body checks, deliberately: a malformed status is the caller's
    # own mistake and should be named as one, not answered with "employee not
    # found" from a lookup that only ran because the status was never read.
    if not await _employee_in_org(pool, body.employee_id, org_id):
        raise HTTPException(404, "Employee not found")

    work_hours = None
    if body.check_in and body.check_out:
        ci = datetime.fromisoformat(body.check_in)
        co = datetime.fromisoformat(body.check_out)
        work_hours = round((co - ci).total_seconds() / 3600, 2)

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_attendance "
        "(org_id, employee_id, date, check_in, check_out, status, work_hours, notes, marked_by) "
        "VALUES ($1::uuid, $2::uuid, $3::date, NULLIF($4,'')::timestamptz, "
        " NULLIF($5,'')::timestamptz, $6, $7, $8, 'manual') "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "check_in=COALESCE(NULLIF($4,'')::timestamptz, staging.manav_attendance.check_in), "
        "check_out=COALESCE(NULLIF($5,'')::timestamptz, staging.manav_attendance.check_out), "
        "status=$6, work_hours=COALESCE($7, staging.manav_attendance.work_hours), "
        "notes=$8, marked_by='manual' "
        "RETURNING id, status",
        org_id, body.employee_id, att_date, body.check_in, body.check_out,
        body.status, work_hours, body.notes,
    )
    return {"status": "marked", **dict(row)}


@router.get("/attendance/summary")
async def attendance_summary(
    month: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    if month:
        year, mo = month.split("-")
    else:
        today = date.today()
        year, mo = str(today.year), f"{today.month:02d}"

    start = _parse_date(f"{year}-{mo}-01")
    if int(mo) < 12:
        end = _parse_date(f"{year}-{int(mo)+1:02d}-01")
    else:
        end = _parse_date(f"{int(year)+1}-01-01")

    query = (
        "SELECT e.id, e.name, e.employee_code, "
        "COUNT(*) FILTER (WHERE a.status='present') as present_days, "
        "COUNT(*) FILTER (WHERE a.status='absent') as absent_days, "
        "COUNT(*) FILTER (WHERE a.status='half_day') as half_days, "
        "COUNT(*) FILTER (WHERE a.status='late') as late_days, "
        "COUNT(*) FILTER (WHERE a.status='on_leave') as leave_days, "
        "COALESCE(SUM(a.work_hours),0) as total_hours, "
        "COALESCE(SUM(a.overtime_hours),0) as overtime_hours "
        "FROM staging.manav_employees e "
        "LEFT JOIN staging.manav_attendance a ON a.employee_id=e.id "
        "  AND a.date >= $2 AND a.date < $3 "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE "
    )
    params: list = [org_id, start, end]

    # The monthly summary is one row per employee. At self scope it is one row.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": [], "month": f"{year}-{mo}"}
        params.append(own)
        query += f"AND e.id=${len(params)}::uuid "

    query += "GROUP BY e.id, e.name, e.employee_code ORDER BY e.name"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows], "month": f"{year}-{mo}"}


# ── Leave Types ──────────────────────────────────────────────

@router.get("/leave-types")
async def list_leave_types(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Reference data with no employee in it. Readable at self scope: an employee
    # cannot request leave against their own record without knowing the types.
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_leave_types WHERE org_id=$1::uuid AND is_active=TRUE ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/leave-types")
async def create_leave_type(
    body: LeaveTypeCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Leave policy is org configuration.
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_leave_types "
        "(org_id, name, code, annual_quota, is_paid, carry_forward, max_carry_forward) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) RETURNING id, name, code",
        org_id, body.name, body.code, body.annual_quota,
        body.is_paid, body.carry_forward, body.max_carry_forward,
    )
    return {"status": "created", **dict(row)}


# ── Leave Requests ───────────────────────────────────────────

@router.get("/leaves")
async def list_leave_requests(
    status: Optional[str] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT lr.id, lr.start_date, lr.end_date, lr.days, lr.reason, lr.status, "
        "lr.rejection_reason, lr.created_at, "
        "e.name as employee_name, e.employee_code, "
        "lt.name as leave_type_name, lt.code as leave_type_code, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.manav_leave_requests lr "
        "JOIN staging.manav_employees e ON e.id = lr.employee_id "
        "JOIN staging.manav_leave_types lt ON lt.id = lr.leave_type_id "
        "WHERE lr.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2

    # A leave request carries a reason, which is routinely medical or personal.
    # Own only without a grant.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            # Same envelope as the populated path — a caller reading `total` must
            # not get `undefined` because the list is empty for a permissions
            # reason rather than a data one.
            return {"data": [], "total": 0, "limit": 200, "truncated": False}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own leave requests")
        employee_id = own

    if status:
        query += f"AND lr.status=${idx} "
        params.append(status)
        idx += 1
    if employee_id:
        query += f"AND lr.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1

    query += "ORDER BY lr.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return _listed(rows, limit=200)


@router.post("/leaves")
async def create_leave_request(
    body: LeaveRequest,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()

    # Submitting YOUR OWN leave request is reachable at self scope: the employee
    # id comes from the caller's own row, never from the body, so this is the
    # employee authoring their own request rather than editing an HR record.
    # Filing one FOR SOMEONE ELSE is an HR action and needs an editor grant.
    if body.employee_id:
        _require(levels, EDITOR)
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            body.employee_id, org_id,
        )
        if not emp:
            raise HTTPException(404, "Employee not found")
    else:
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees "
            "WHERE org_id=$1::uuid AND user_id=$2 AND is_active=TRUE",
            org_id, user["user_id"],
        )
        if not emp:
            raise HTTPException(403, "No employee record found for your account")

    bal = await pool.fetchrow(
        "SELECT allocated, used, carried_forward FROM staging.manav_leave_balances "
        "WHERE employee_id=$1::uuid AND leave_type_id=$2::uuid AND year=EXTRACT(YEAR FROM CURRENT_DATE)::int",
        str(emp["id"]), body.leave_type_id,
    )
    if bal:
        available = (bal["allocated"] + bal["carried_forward"]) - bal["used"]
        if body.days > available:
            raise HTTPException(400, f"Insufficient leave balance. Available: {available}, requested: {body.days}")

    # INSERT and `leave.requested` in one transaction. RETURNING * because the
    # emitter reads leave_type_id/days/start_date off the row (the free-text
    # `reason` never rides — subjects.py owns that discipline).
    # `employee_user_id` is manav_employees.user_id — the LOGIN of the person
    # the leave is about, distinct from the actor when HR files on behalf —
    # resolved here inside the same transaction; NULL is legal (not every
    # employee has a login).
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "INSERT INTO staging.manav_leave_requests "
                "(org_id, employee_id, leave_type_id, start_date, end_date, days, reason) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date, $6, $7) RETURNING *",
                org_id, str(emp["id"]), body.leave_type_id,
                date.fromisoformat(body.start_date), date.fromisoformat(body.end_date),
                body.days, body.reason,
            )
            _emp_user_id = await _conn.fetchval(
                "SELECT user_id FROM staging.manav_employees "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                str(emp["id"]), org_id,
            )
            await leave_requested(
                _conn, org_id=org_id, actor_id=user["user_id"],
                request_id=row["id"], row=dict(row),
                employee_user_id=_emp_user_id,
            )
    return {"status": "submitted", "id": str(row["id"])}


@router.patch("/leaves/{leave_id}/action")
async def action_leave_request(
    leave_id: UUID,
    body: LeaveAction,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Approving leave is the approver rung. Manav is hierarchical, so
    # admin satisfies it — decided by level_satisfies, not assumed here.
    _require(levels, APPROVER)
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "Status must be 'approved' or 'rejected'")

    lr = await pool.fetchrow(
        "SELECT employee_id, leave_type_id, days, status, start_date, end_date FROM staging.manav_leave_requests "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(leave_id), org_id,
    )
    if not lr:
        raise HTTPException(404, "Leave request not found")
    if lr["status"] != "pending":
        raise HTTPException(400, f"Cannot action: leave is already {lr['status']}")

    # The status write and `leave.decided` share one transaction — one event
    # for both outcomes, `decision` in the payload (the vocabulary is the
    # status CHECK's: 'approved' or 'rejected'; both were validated above, and
    # the refusal paths above raise before anything emits).
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # `AND status='pending'`: the pending check above read the pool
            # BEFORE this transaction, so two overlapping decisions both
            # passed it and both emitted. The transition in the WHERE makes
            # the loser match zero rows — no write, no event, a 409 saying
            # what happened.
            _decided = await _conn.fetchrow(
                "UPDATE staging.manav_leave_requests SET status=$1, approved_by=$2, "
                "approved_at=NOW(), rejection_reason=$3, updated_at=NOW() "
                "WHERE id=$4::uuid AND org_id=$5::uuid AND status='pending' "
                "RETURNING *",
                body.status, user["user_id"], body.rejection_reason or None,
                str(leave_id), org_id,
            )
            if _decided is None:
                raise HTTPException(
                    409, "This leave request was decided by someone else a moment ago.")
            if _decided is not None:
                # manav_employees.user_id — the login of the person the leave
                # is about (the actor is the decider), resolved in the same
                # transaction; NULL is legal.
                _emp_user_id = await _conn.fetchval(
                    "SELECT user_id FROM staging.manav_employees WHERE id=$1::uuid",
                    str(lr["employee_id"]),
                )
                await leave_decided(
                    _conn, org_id=org_id, actor_id=user["user_id"],
                    request_id=str(leave_id), row=dict(_decided),
                    decision=body.status, employee_user_id=_emp_user_id,
                )

    if body.status == "approved":
        year = date.today().year
        existing = await pool.fetchrow(
            "SELECT id FROM staging.manav_leave_balances "
            "WHERE employee_id=$1::uuid AND leave_type_id=$2::uuid AND year=$3",
            str(lr["employee_id"]), str(lr["leave_type_id"]), year,
        )
        if existing:
            await pool.execute(
                "UPDATE staging.manav_leave_balances SET used=used+$1 "
                "WHERE id=$2::uuid",
                int(lr["days"]), existing["id"],
            )
        else:
            lt = await pool.fetchrow(
                "SELECT annual_quota FROM staging.manav_leave_types WHERE id=$1::uuid",
                str(lr["leave_type_id"]),
            )
            await pool.execute(
                "INSERT INTO staging.manav_leave_balances "
                "(org_id, employee_id, leave_type_id, year, allocated, used) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)",
                org_id, str(lr["employee_id"]), str(lr["leave_type_id"]),
                year, lt["annual_quota"] if lt else 0, int(lr["days"]),
            )

    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", str(lr["employee_id"]),
    )
    if emp and emp.get("email"):
        lt_row = await pool.fetchrow(
            "SELECT name FROM staging.manav_leave_types WHERE id=$1::uuid", str(lr["leave_type_id"]),
        )
        from services.employee_email import send_leave_decision_email
        send_leave_decision_email(
            emp["email"], emp["name"],
            lt_row["name"] if lt_row else "Leave",
            str(lr["start_date"]), str(lr["end_date"]),
            body.status, user.get("name", "Admin"),
        )

    return {"status": body.status}


# ── Holidays ─────────────────────────────────────────────────

@router.get("/holidays")
async def list_holidays(
    year: Optional[int] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # The holiday calendar names nobody. Readable at self scope.
    y = year or date.today().year
    rows = await pool.fetch(
        "SELECT id, name, date, is_optional FROM staging.manav_holidays "
        "WHERE org_id=$1::uuid AND EXTRACT(YEAR FROM date)=$2 ORDER BY date",
        org_id, y,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/holidays")
async def create_holiday(
    body: HolidayCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_holidays (org_id, name, date, is_optional) "
        "VALUES ($1::uuid, $2, $3, $4) RETURNING id, name, date",
        org_id, body.name, _parse_date(body.date), body.is_optional,
    )
    return {"status": "created", **dict(row)}


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(
    holiday_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    await pool.execute(
        "DELETE FROM staging.manav_holidays WHERE id=$1::uuid AND org_id=$2::uuid",
        str(holiday_id), org_id,
    )
    return {"status": "deleted"}


# ── Dashboard Stats ──────────────────────────────────────────

@router.get("/stats")
async def hrms_stats(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Org-wide headcount and today's attendance.
    _require(levels, VIEWER)
    emp_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees WHERE org_id=$1::uuid AND is_active=TRUE AND status='active'",
        org_id,
    )
    dept_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_departments WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    pending_leaves = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_leave_requests WHERE org_id=$1::uuid AND status='pending'",
        org_id,
    )
    today_present = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_attendance "
        "WHERE org_id=$1::uuid AND date=CURRENT_DATE AND status IN ('present','late')",
        org_id,
    )
    announcements_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_announcements "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
        "AND (expires_at IS NULL OR expires_at > NOW())",
        org_id,
    )
    pending_leaves_today = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_leave_requests "
        "WHERE org_id=$1::uuid AND status='pending' "
        "AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE",
        org_id,
    )
    clocked_in_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_attendance "
        "WHERE org_id=$1::uuid AND date=CURRENT_DATE "
        "AND check_in IS NOT NULL AND check_out IS NULL",
        org_id,
    )
    on_leave_today = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_leave_requests "
        "WHERE org_id=$1::uuid AND status='approved' "
        "AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE",
        org_id,
    )
    return {
        "total_employees": emp_count,
        "departments": dept_count,
        "pending_leaves": pending_leaves,
        "today_present": today_present,
        "announcements_count": announcements_count,
        "pending_leaves_today": pending_leaves_today,
        "clocked_in_count": clocked_in_count,
        "on_leave_today": on_leave_today,
    }


# ── Announcements ───────────────────────────────────────────

@router.get("/announcements")
async def list_announcements(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Announcements are broadcast to the whole org by design — every employee is
    # already emailed one when it is posted. Readable at self scope.
    rows = await pool.fetch(
        "SELECT a.id, a.title, a.body, a.priority, a.pinned, "
        "a.published_at, a.expires_at, a.created_at, "
        "e.name as creator_name "
        "FROM staging.manav_announcements a "
        "LEFT JOIN staging.manav_employees e ON e.user_id = a.created_by AND e.org_id = a.org_id "
        "WHERE a.org_id=$1::uuid AND a.is_active=TRUE "
        "AND (a.expires_at IS NULL OR a.expires_at > NOW()) "
        "ORDER BY a.pinned DESC, a.published_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/announcements")
async def create_announcement(
    body: AnnouncementCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Emails every active employee in the org.
    _require(levels, EDITOR)

    valid_priorities = ("low", "normal", "high", "urgent")
    if body.priority not in valid_priorities:
        raise HTTPException(400, f"priority must be one of: {', '.join(valid_priorities)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_announcements "
        "(org_id, title, body, priority, pinned, expires_at, published_at, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, NULLIF($6,'')::timestamptz, NOW(), $7) "
        "RETURNING id, title",
        org_id, body.title, body.body, body.priority,
        body.pinned, body.expires_at, user["user_id"],
    )
    # ── Notify all active employees ──
    employees = await pool.fetch(
        "SELECT name, email FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND email IS NOT NULL AND email != ''",
        org_id,
    )
    if employees:
        from services.employee_email import send_announcement_email
        for e in employees:
            send_announcement_email(e["email"], e["name"], body.title, body.body)

    return {"status": "created", **dict(row)}


@router.patch("/announcements/{announcement_id}")
async def update_announcement(
    announcement_id: UUID,
    body: AnnouncementUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "priority" in updates:
        valid_priorities = ("low", "normal", "high", "urgent")
        if updates["priority"] not in valid_priorities:
            raise HTTPException(400, f"priority must be one of: {', '.join(valid_priorities)}")

    sets = []
    params = [str(announcement_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k == "expires_at":
            sets.append(f"expires_at=NULLIF(${idx},'')::timestamptz")
        else:
            sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1

    await pool.execute(
        f"UPDATE staging.manav_announcements SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        *params,
    )
    return {"status": "updated"}


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    await pool.execute(
        "UPDATE staging.manav_announcements SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(announcement_id), org_id,
    )
    return {"status": "deleted"}


# ── Leave Conflict Detection ────────────────────────────────

@router.get("/leaves/check-conflicts")
async def check_leave_conflicts(
    employee_id: str,
    start_date: str,
    end_date: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Returns colleagues' leave dates by department.
    _require(levels, VIEWER)

    emp = await pool.fetchrow(
        "SELECT id, department FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")
    if not emp["department"]:
        return {"conflicts": [], "conflict_count": 0, "department_size": 0, "exceeds_threshold": False}

    dept_size = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND department=$2 AND is_active=TRUE AND status='active'",
        org_id, emp["department"],
    )

    conflicts = await pool.fetch(
        "SELECT lr.id, lr.start_date, lr.end_date, lr.days, lr.status, "
        "e.name as employee_name, e.employee_code "
        "FROM staging.manav_leave_requests lr "
        "JOIN staging.manav_employees e ON e.id = lr.employee_id "
        "WHERE lr.org_id=$1::uuid AND lr.status IN ('approved','pending') "
        "AND e.department=$2 AND e.is_active=TRUE "
        "AND lr.employee_id != $3::uuid "
        "AND lr.start_date <= $5 AND lr.end_date >= $4 "
        "ORDER BY lr.start_date",
        org_id, emp["department"], employee_id, _parse_date(start_date), _parse_date(end_date),
    )

    conflict_count = len(conflicts)
    on_leave_count = conflict_count + 1
    exceeds_threshold = dept_size > 0 and (on_leave_count / dept_size) > 0.30

    return {
        "conflicts": [dict(r) for r in conflicts],
        "conflict_count": conflict_count,
        "department": emp["department"],
        "department_size": dept_size,
        "on_leave_count": on_leave_count,
        "exceeds_threshold": exceeds_threshold,
    }


# ── Team Performance Summary ────────────────────────────────

@router.get("/performance/summary")
async def performance_summary(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Per-employee attendance for the whole org.
    _require(levels, VIEWER)

    today = date.today()
    if not from_date:
        from_date = date(today.year, today.month, 1)
    else:
        from_date = date.fromisoformat(from_date)
    if not to_date:
        to_date = today
    else:
        to_date = date.fromisoformat(to_date)

    rows = await pool.fetch(
        "SELECT e.id, e.name, e.department, "
        "COUNT(*) FILTER (WHERE a.status='present') as days_present, "
        "COUNT(*) FILTER (WHERE a.status='absent') as days_absent, "
        "COUNT(*) FILTER (WHERE a.status='late') as days_late, "
        "COALESCE(SUM(a.work_hours),0) as total_work_hours, "
        "COALESCE(ROUND(AVG(a.work_hours)::numeric,2),0) as avg_work_hours, "
        "COALESCE(SUM(a.overtime_hours),0) as overtime_hours, "
        "COALESCE(("
        "  SELECT SUM(lr.days) FROM staging.manav_leave_requests lr "
        "  WHERE lr.employee_id=e.id AND lr.status='approved' "
        "  AND lr.start_date >= $2::date AND lr.end_date <= $3::date"
        "),0) as leaves_taken "
        "FROM staging.manav_employees e "
        "LEFT JOIN staging.manav_attendance a ON a.employee_id=e.id "
        "  AND a.date >= $2::date AND a.date <= $3::date "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE AND e.status='active' "
        "GROUP BY e.id, e.name, e.department ORDER BY e.name",
        org_id, from_date, to_date,
    )
    return {"data": [dict(r) for r in rows], "from_date": from_date, "to_date": to_date}


# ── Shift Definitions ───────────────────────────────────────

class ShiftCreate(BaseModel):
    name: str
    start_time: str
    end_time: str
    break_minutes: int = 0
    color: str = "#3B82F6"


class ShiftUpdate(BaseModel):
    name: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    break_minutes: int | None = None
    color: str | None = None
    is_active: bool | None = None


@router.get("/shifts")
async def list_shifts(user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Shift definitions name nobody — they are the org's shift catalogue, and an
    # employee needs them to read their own roster. Readable at self scope.
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_shift_definitions "
        "WHERE org_id=$1::uuid ORDER BY start_time",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/shifts")
async def create_shift(body: ShiftCreate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Shift definitions are org configuration.
    _require(levels, ADMIN)
    st, et = _parse_time(body.start_time), _parse_time(body.end_time)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_definitions "
        "(org_id, name, start_time, end_time, break_minutes, color) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6) "
        "ON CONFLICT (org_id, name) DO UPDATE SET "
        "start_time=$3, end_time=$4, break_minutes=$5, color=$6, is_active=TRUE "
        "RETURNING id, name",
        org_id, body.name, st, et, body.break_minutes, body.color,
    )
    return {"status": "created", **dict(row)}


@router.patch("/shifts/{shift_id}")
async def update_shift(shift_id: UUID, body: ShiftUpdate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    _require(levels, ADMIN)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets, params = [], [str(shift_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("start_time", "end_time"):
            sets.append(f"{k}=${idx}")
            v = _parse_time(v)
        else:
            sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    await pool.execute(
        f"UPDATE staging.manav_shift_definitions SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


# ── Schedules ───────────────────────────────────────────────

class ScheduleAssign(BaseModel):
    employee_id: str
    shift_id: str
    date: str
    notes: str = ""


class ScheduleBulkAssign(BaseModel):
    assignments: list[ScheduleAssign]


@router.get("/schedules")
async def list_schedules(
    date_from: str | None = None,
    date_to: str | None = None,
    employee_id: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT s.*, e.name AS employee_name, e.department, "
        "sd.name AS shift_name, sd.start_time, sd.end_time, sd.color, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.manav_schedules s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s.shift_id "
        "WHERE s.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2

    # Own roster at self scope; the whole rota needs viewer.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own schedule")
        employee_id = own

    if date_from:
        query += f"AND s.date >= ${idx} "
        params.append(_parse_date(date_from))
        idx += 1
    if date_to:
        query += f"AND s.date <= ${idx} "
        params.append(_parse_date(date_to))
        idx += 1
    if employee_id:
        query += f"AND s.employee_id = ${idx}::uuid "
        params.append(employee_id)
        idx += 1
    query += "ORDER BY s.date, sd.start_time LIMIT 500"
    rows = await pool.fetch(query, *params)
    return _listed(rows, limit=500)


@router.post("/schedules")
async def assign_schedule(body: ScheduleAssign, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Rosters someone else's day.
    _require(levels, EDITOR)
    # Both ids before any write. The employee lookup fifteen lines below carries
    # no org filter and MAILS whoever it finds their shift times, so an
    # unchecked uuid here was a roster row in this org plus an email to another
    # company's staff. See `_employee_in_org`.
    if not await _employee_in_org(pool, body.employee_id, org_id):
        raise HTTPException(404, "Employee not found")
    if not await _shift_in_org(pool, body.shift_id, org_id):
        raise HTTPException(404, "Shift not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_schedules "
        "(org_id, employee_id, shift_id, date, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "shift_id=$3::uuid, notes=$5, status='scheduled' "
        "RETURNING id",
        org_id, body.employee_id, body.shift_id, _parse_date(body.date), body.notes, user["user_id"],
    )
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", body.employee_id,
    )
    shift = await pool.fetchrow(
        "SELECT name, start_time, end_time FROM staging.manav_shift_definitions WHERE id=$1::uuid", body.shift_id,
    )
    if emp and emp.get("email") and shift:
        from services.employee_email import send_shift_schedule_email
        send_shift_schedule_email(
            emp["email"], emp["name"], shift["name"],
            body.date, str(shift["start_time"]), str(shift["end_time"]),
        )

    return {"status": "assigned", "id": str(row["id"])}


@router.post("/schedules/bulk")
async def bulk_assign(body: ScheduleBulkAssign, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    _require(levels, EDITOR)
    # EVERY id first, then every write. A batch that inserts the rows it likes
    # and 404s on the one it does not leaves a half-built roster and a caller
    # who cannot tell which half landed.
    for a in body.assignments:
        if not await _employee_in_org(pool, a.employee_id, org_id):
            raise HTTPException(404, "Employee not found")
        if not await _shift_in_org(pool, a.shift_id, org_id):
            raise HTTPException(404, "Shift not found")

    created = 0
    for a in body.assignments:
        await pool.execute(
            "INSERT INTO staging.manav_schedules "
            "(org_id, employee_id, shift_id, date, notes, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) "
            "ON CONFLICT (employee_id, date) DO UPDATE SET "
            "shift_id=$3::uuid, notes=$5, status='scheduled'",
            org_id, a.employee_id, a.shift_id, _parse_date(a.date), a.notes, user["user_id"],
        )
        created += 1
    return {"status": "assigned", "count": created}


@router.get("/schedules/coverage")
async def schedule_coverage(
    date_from: str,
    date_to: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, VIEWER)
    rows = await pool.fetch(
        "SELECT s.date, sd.name AS shift_name, sd.id AS shift_id, "
        "COUNT(s.id) AS assigned_count "
        "FROM staging.manav_schedules s "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s.shift_id "
        "WHERE s.org_id=$1::uuid AND s.date >= $2 AND s.date <= $3 "
        "GROUP BY s.date, sd.id, sd.name ORDER BY s.date, sd.name",
        org_id, _parse_date(date_from), _parse_date(date_to),
    )
    # Also get employee count for gap detection
    total_active = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND status='active'",
        org_id,
    )
    return {"coverage": [dict(r) for r in rows], "total_employees": total_active}


# ── Availability ────────────────────────────────────────────

class AvailabilitySet(BaseModel):
    date: str
    is_available: bool = True
    preferred_shift_id: str | None = None
    notes: str = ""


@router.get("/availability")
async def list_availability(
    employee_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    query = "SELECT a.*, e.name AS employee_name, COUNT(*) OVER() AS _total " \
            "FROM staging.manav_availability a " \
            "JOIN staging.manav_employees e ON e.id = a.employee_id " \
            "WHERE a.org_id=$1::uuid "
    params: list = [org_id]
    idx = 2

    # Own availability at self scope; everyone's needs viewer.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own availability")
        employee_id = own

    if employee_id:
        query += f"AND a.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1
    if date_from:
        query += f"AND a.date >= ${idx} "
        params.append(_parse_date(date_from))
        idx += 1
    if date_to:
        query += f"AND a.date <= ${idx} "
        params.append(_parse_date(date_to))
        idx += 1
    query += "ORDER BY a.date LIMIT 500"
    rows = await pool.fetch(query, *params)
    return _listed(rows, limit=500)


@router.post("/availability")
async def set_availability(body: AvailabilitySet, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Self-service, and only ever for yourself: the employee id comes from the
    # caller's own row and the body has no field to override it. Reachable at
    # self scope for that reason.
    emp = await pool.fetchval(
        "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(404, "Employee record not found for your account")
    await pool.execute(
        "INSERT INTO staging.manav_availability "
        "(org_id, employee_id, date, is_available, preferred_shift_id, notes) "
        "VALUES ($1::uuid, $2, $3, $4, NULLIF($5,'')::uuid, $6) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "is_available=$4, preferred_shift_id=NULLIF($5,'')::uuid, notes=$6",
        org_id, emp, _parse_date(body.date), body.is_available,
        body.preferred_shift_id or "", body.notes,
    )
    return {"status": "saved"}


# ── Shift Bids ──────────────────────────────────────────────

class ShiftBidCreate(BaseModel):
    shift_id: str
    date: str
    slots_needed: int = 1


@router.get("/shift-bids")
async def list_bids(
    status: str = "open",
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # An open bid is a shift offered to everyone; the row names no employee, only
    # a response count. Readable at self scope so an employee can apply.
    rows = await pool.fetch(
        "SELECT b.*, sd.name AS shift_name, sd.start_time, sd.end_time, sd.color, "
        "(SELECT COUNT(*) FROM staging.manav_shift_bid_responses WHERE bid_id=b.id) AS responses "
        "FROM staging.manav_shift_bids b "
        "JOIN staging.manav_shift_definitions sd ON sd.id = b.shift_id "
        "WHERE b.org_id=$1::uuid AND b.status=$2 ORDER BY b.date",
        org_id, status,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/shift-bids")
async def create_bid(body: ShiftBidCreate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Opens a shift to the whole org.
    _require(levels, EDITOR)
    # The shift has to be this org's. `GET /shift-bids` joins the definition and
    # prints its name and hours, so a foreign uuid here puts another tenant's
    # shift on this org's bid board.
    if not await _shift_in_org(pool, body.shift_id, org_id):
        raise HTTPException(404, "Shift not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_bids "
        "(org_id, shift_id, date, slots_needed, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id",
        org_id, body.shift_id, _parse_date(body.date), body.slots_needed, user["user_id"],
    )
    return {"status": "created", "id": str(row["id"])}


@router.get("/shift-bids/{bid_id}/responses")
async def list_bid_responses(
    bid_id: UUID,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    """Who volunteered for this shift, and how many slots are left.

    ── WHY THIS HAD TO EXIST BEFORE THE AWARD ROUTE MEANT ANYTHING ──────────

    `POST /shift-bids/{bid}/accept/{employee}` has existed since migration 027's
    endpoints were written and was unreachable in practice: `GET /shift-bids`
    answers a response COUNT, and nothing anywhere returned the applicants. A
    manager could see that four people had put their name down and had no way to
    learn which four, so there was no honest way to supply the `{employee_id}`
    the award route needs. The loop stopped at "employees apply".

    VIEWER, not self scope. `GET /shift-bids` is deliberately readable with no
    grant at all — an open bid names nobody, and an employee has to see it to
    apply. This answer is a list of colleagues, which is the line this file
    draws everywhere else: "Everything that names another person needs viewer."

    `slots_awarded` is counted here rather than in the browser so the roster,
    the bid list and the award response cannot disagree about whether a shift is
    covered.
    """
    pool = await get_pool()
    _require(levels, VIEWER)
    bid = await pool.fetchrow(
        "SELECT id, shift_id, date, slots_needed, status "
        "FROM staging.manav_shift_bids WHERE id=$1::uuid AND org_id=$2::uuid",
        str(bid_id), org_id,
    )
    if not bid:
        raise HTTPException(404, "Bid not found")

    rows = await pool.fetch(
        "SELECT r.id, r.employee_id, r.status, r.created_at, "
        "       e.name AS employee_name, e.employee_code "
        "FROM staging.manav_shift_bid_responses r "
        "JOIN staging.manav_employees e ON e.id = r.employee_id "
        "WHERE r.bid_id=$1::uuid AND e.org_id=$2::uuid "
        "ORDER BY r.created_at",
        str(bid_id), org_id,
    )
    responses = [dict(r) for r in rows]
    return {
        "data": responses,
        "slots_needed": int(bid["slots_needed"] or 1),
        "slots_awarded": sum(1 for r in responses if r["status"] == "accepted"),
        "bid_status": bid["status"],
    }


@router.post("/shift-bids/{bid_id}/apply")
async def apply_to_bid(bid_id: UUID, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Applying is the employee volunteering for themselves — employee id from the
    # caller's own row, never from the path. Reachable at self scope.
    emp = await pool.fetchval(
        "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(404, "Employee record not found")
    # The bid must belong to this org. Without it a response row could be
    # attached to another tenant's bid by guessing a uuid.
    bid = await pool.fetchrow(
        "SELECT status FROM staging.manav_shift_bids "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(bid_id), org_id,
    )
    if not bid:
        raise HTTPException(404, "Bid not found")
    if bid["status"] != "open":
        # A filled or cancelled shift accepted applications silently and counted
        # them. Volunteering for a shift that is already covered raises an
        # expectation the roster will not meet, and the applicant has no way to
        # discover that from a success message.
        raise HTTPException(
            409,
            "This shift is no longer open for bids."
            if bid["status"] == "cancelled"
            else "Every slot on this shift has already been awarded.",
        )
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_bid_responses (bid_id, employee_id) "
        "VALUES ($1::uuid, $2) "
        "ON CONFLICT (bid_id, employee_id) DO NOTHING RETURNING id",
        str(bid_id), emp,
    )
    return {"status": "applied" if row else "already_applied"}


@router.post("/shift-bids/{bid_id}/accept/{employee_id}")
async def accept_bid(bid_id: UUID, employee_id: UUID, request: Request, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    """Award one slot on a bid, and close the bid when the last one goes.

    Three things this did not do, each of which only became reachable once
    `GET /shift-bids/{id}/responses` made the applicants visible:

    IT AWARDED TO ANYONE. The UPDATE matched zero rows for someone who had never
    applied and the code wrote the schedule row regardless — so "accepted a bid"
    and "was rostered by a manager" became the same row with the same
    provenance, and the response table's own count of accepted slots stayed at
    zero while people were being rostered off it.

    THE BID NEVER CLOSED. 027's CHECK has allowed `filled` since the table was
    created and nothing ever wrote it, so a one-slot shift could be awarded six
    times and stayed at the top of the open list asking for a seventh.

    A SETTLED BID COULD BE AWARDED AGAIN, because nothing read `status`.
    """
    pool = await get_pool()
    # Awards the shift and writes the schedule row.
    _require(levels, EDITOR)
    bid = await pool.fetchrow(
        "SELECT id, shift_id, date, slots_needed, status "
        "FROM staging.manav_shift_bids WHERE id=$1::uuid AND org_id=$2::uuid",
        str(bid_id), org_id,
    )
    if not bid:
        raise HTTPException(404, "Bid not found")
    if bid["status"] != "open":
        raise HTTPException(
            409,
            f"This bid is {bid['status']}. Re-open or re-post it to award another slot.",
        )
    # The employee has to be this org's before anything is written — see
    # `_employee_in_org`. Without it this wrote a `manav_schedules` row carrying
    # this org's org_id and another tenant's employee_id.
    if not await _employee_in_org(pool, employee_id, org_id):
        raise HTTPException(404, "Employee not found")

    awarded = await pool.fetchrow(
        "UPDATE staging.manav_shift_bid_responses SET status='accepted' "
        "WHERE bid_id=$1::uuid AND employee_id=$2::uuid RETURNING id",
        str(bid_id), str(employee_id),
    )
    if not awarded:
        # A bid is a record that somebody volunteered. Awarding one to a
        # non-applicant is a roster assignment wearing a bid's clothes; the
        # route for that is `POST /schedules`, and it says so.
        raise HTTPException(
            404,
            "That employee has not applied to this bid. Roster them directly "
            "from Schedules instead.",
        )

    accepted = int(await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_shift_bid_responses "
        "WHERE bid_id=$1::uuid AND status='accepted'",
        str(bid_id),
    ) or 0)
    slots_needed = int(bid["slots_needed"] or 1)

    # Auto-create schedule
    await pool.execute(
        "INSERT INTO staging.manav_schedules "
        "(org_id, employee_id, shift_id, date, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET shift_id=$3, status='scheduled'",
        org_id, str(employee_id), bid["shift_id"], bid["date"], user["user_id"],
    )

    bid_status = bid["status"]
    if accepted >= slots_needed:
        await pool.execute(
            "UPDATE staging.manav_shift_bids SET status='filled' "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND status='open'",
            str(bid_id), org_id,
        )
        bid_status = "filled"

    audit(
        "manav.shift_bid_awarded",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_shift_bid",
        resource_id=str(bid_id),
        detail={
            "employee_id": str(employee_id),
            "slots_awarded": accepted,
            "slots_needed": slots_needed,
            "bid_status": bid_status,
        },
    )
    return {
        "status": "accepted",
        "slots_awarded": accepted,
        "slots_needed": slots_needed,
        "bid_status": bid_status,
    }


# ── Swap Requests ───────────────────────────────────────────

class SwapCreate(BaseModel):
    requester_schedule_id: str
    target_employee_id: str = ""
    reason: str = ""


@router.post("/swaps")
async def create_swap(body: SwapCreate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Asking to give away YOUR OWN shift is self-service, so it is reachable at
    # self scope — but only for a shift that is actually yours. Offering someone
    # else's shift is rostering, which is the editor's job.
    #
    # The schedule must also be in this org. Without that check a uuid from
    # another tenant could be attached to a row here, and `GET /swaps` joins
    # through it and would print that tenant's employee name.
    sched = await pool.fetchrow(
        "SELECT s.id, e.user_id FROM staging.manav_schedules s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "WHERE s.id=$1::uuid AND s.org_id=$2::uuid",
        body.requester_schedule_id, org_id,
    )
    if not sched:
        raise HTTPException(404, "Schedule not found")
    if sched["user_id"] != user["user_id"]:
        _require(levels, EDITOR)
    if body.target_employee_id and not await pool.fetchval(
        "SELECT 1 FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        body.target_employee_id, org_id,
    ):
        raise HTTPException(404, "Employee not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_swap_requests "
        "(org_id, requester_schedule_id, target_employee_id, reason) "
        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4) RETURNING id",
        org_id, body.requester_schedule_id,
        body.target_employee_id, body.reason,
    )
    return {"status": "requested", "id": str(row["id"])}


@router.get("/swaps")
async def list_swaps(status: str = "pending", user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Names both sides of every swap.
    _require(levels, VIEWER)
    rows = await pool.fetch(
        "SELECT sw.*, "
        "e1.name AS requester_name, e2.name AS target_name, "
        "s1.date AS schedule_date, sd.name AS shift_name "
        "FROM staging.manav_swap_requests sw "
        "JOIN staging.manav_schedules s1 ON s1.id = sw.requester_schedule_id "
        "JOIN staging.manav_employees e1 ON e1.id = s1.employee_id "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s1.shift_id "
        "LEFT JOIN staging.manav_employees e2 ON e2.id = sw.target_employee_id "
        "WHERE sw.org_id=$1::uuid AND sw.status=$2 ORDER BY sw.created_at DESC",
        org_id, status,
    )
    return {"data": [dict(r) for r in rows]}


@router.patch("/swaps/{swap_id}")
async def action_swap(swap_id: UUID, action: str, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    if action not in ("approved", "rejected"):
        raise HTTPException(400, "action must be 'approved' or 'rejected'")
    pool = await get_pool()
    # Approving a swap moves two people's shifts.
    _require(levels, APPROVER)
    await pool.execute(
        "UPDATE staging.manav_swap_requests SET status=$1, approved_by=$2 "
        "WHERE id=$3::uuid AND org_id=$4::uuid",
        action, user["user_id"], str(swap_id), org_id,
    )
    if action == "approved":
        swap = await pool.fetchrow(
            "SELECT * FROM staging.manav_swap_requests WHERE id=$1::uuid AND org_id=$2::uuid", str(swap_id), org_id
        )
        if swap and swap["target_employee_id"]:
            sched = await pool.fetchrow(
                "SELECT * FROM staging.manav_schedules WHERE id=$1",
                swap["requester_schedule_id"],
            )
            if sched:
                # Swap shifts between requester and target
                target_sched = await pool.fetchrow(
                    "SELECT * FROM staging.manav_schedules "
                    "WHERE employee_id=$1 AND date=$2",
                    swap["target_employee_id"], sched["date"],
                )
                if target_sched:
                    await pool.execute(
                        "UPDATE staging.manav_schedules SET shift_id=$1, status='swapped' WHERE id=$2",
                        target_sched["shift_id"], sched["id"],
                    )
                    await pool.execute(
                        "UPDATE staging.manav_schedules SET shift_id=$1, status='swapped' WHERE id=$2",
                        sched["shift_id"], target_sched["id"],
                    )
    return {"status": action}


# ── Expense Claims & Reimbursement ───────────────────────────

async def _is_org_admin(pool, user, org_id) -> bool:
    """Kept as a thin wrapper so the existing call sites don't all change.

    `pool` is now unused — middleware.roles owns the connection.
    """
    return await is_org_admin(user["user_id"], org_id)


@router.get("/expense-claims")
async def list_expense_claims(
    employee_id: str = "",
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    is_admin = await _is_org_admin(pool, user, org_id)
    q = (
        "SELECT c.*, e.name AS employee_name, e.employee_code, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.manav_expense_claims c "
        "JOIN staging.manav_employees e ON e.id = c.employee_id "
        "WHERE c.org_id=$1::uuid AND c.is_active=TRUE"
    )
    params: list = [org_id]
    if not is_admin:
        params.append(user["user_id"])
        q += f" AND e.user_id=${len(params)}"
    elif employee_id:
        params.append(employee_id)
        q += f" AND c.employee_id=${len(params)}::uuid"
    if status:
        params.append(status)
        q += f" AND c.status=${len(params)}"
    q += " ORDER BY c.created_at DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=200)


@router.get("/expense-claims/pending-count")
async def expense_claims_pending_count(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # An org-wide count.
    _require(levels, VIEWER)
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_expense_claims "
        "WHERE org_id=$1::uuid AND status='pending' AND is_active=TRUE",
        org_id,
    )
    return {"count": count}


@router.post("/expense-claims")
async def create_expense_claim(
    body: ExpenseClaimCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    # Every entry, before anything is opened. `receipt_urls` is `json.dumps`-ed
    # into a JSONB column further down, so a list of photographed receipts is
    # the widest mouth this router has for putting files in the database.
    assert_file_urls(body.receipt_urls, "receipt_urls")

    pool = await get_pool()
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    if body.employee_id:
        if not await _is_org_admin(pool, user, org_id):
            raise HTTPException(403, "Only admins can submit claims for other employees")
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            body.employee_id, org_id,
        )
    else:
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2 AND is_active=TRUE",
            org_id, user["user_id"],
        )
    if not emp:
        raise HTTPException(404, "Employee record not found")

    # INSERT and `expense.claimed` in one transaction. `employee_user_id` is
    # manav_employees.user_id — the claimant's login, distinct from the actor
    # when an admin files on behalf — resolved in the same transaction; NULL is
    # legal (not every employee has a login).
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "INSERT INTO staging.manav_expense_claims "
                "(org_id, employee_id, category, expense_date, amount, description, receipt_urls) "
                "VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $6, $7::jsonb) RETURNING *",
                org_id, str(emp["id"]), body.category,
                date.fromisoformat(body.expense_date), body.amount, body.description,
                json.dumps(body.receipt_urls),
            )
            _emp_user_id = await _conn.fetchval(
                "SELECT user_id FROM staging.manav_employees "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                str(emp["id"]), org_id,
            )
            await expense_claimed(
                _conn, org_id=org_id, actor_id=user["user_id"],
                claim_id=row["id"], row=dict(row),
                employee_user_id=_emp_user_id,
            )
    return dict(row)


@router.patch("/expense-claims/{claim_id}/approve")
async def approve_expense_claim(
    claim_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    if not await _is_org_admin(pool, user, org_id):
        raise HTTPException(403, "Only admins can approve expense claims")
    # The status write and `expense.decided` share one transaction. 'paid' is
    # NOT a decision — that is Vetana disbursing later — so only this approve
    # and the reject below emit. A raise before the emitter (no pending row)
    # unwinds the no-op transaction and nothing is announced.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "UPDATE staging.manav_expense_claims SET status='approved', approved_by=$1, approved_at=NOW() "
                "WHERE id=$2::uuid AND org_id=$3::uuid AND status='pending' RETURNING *",
                user["user_id"], str(claim_id), org_id,
            )
            if not row:
                raise HTTPException(404, "Pending claim not found")
            # The claimant's login (manav_employees.user_id), resolved in the
            # same transaction; NULL is legal. The actor is the decider.
            _emp_user_id = await _conn.fetchval(
                "SELECT user_id FROM staging.manav_employees WHERE id=$1::uuid",
                str(row["employee_id"]),
            )
            await expense_decided(
                _conn, org_id=org_id, actor_id=user["user_id"],
                claim_id=row["id"], row=dict(row), decision="approved",
                employee_user_id=_emp_user_id,
            )
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", str(row["employee_id"]),
    )
    if emp and emp.get("email"):
        from services.employee_email import send_expense_decision_email
        send_expense_decision_email(
            emp["email"], emp["name"], row.get("category", "Expense"),
            float(row["amount"]), "approved", user.get("name", "Admin"),
        )
    return dict(row)


@router.patch("/expense-claims/{claim_id}/reject")
async def reject_expense_claim(
    claim_id: UUID,
    body: ExpenseClaimAction,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    if not await _is_org_admin(pool, user, org_id):
        raise HTTPException(403, "Only admins can reject expense claims")
    # Mirror of the approve path: one transaction, one `expense.decided` with
    # decision='rejected'. The 404 raise precedes the emitter, so a miss
    # unwinds the no-op transaction and announces nothing.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "UPDATE staging.manav_expense_claims SET status='rejected', approved_by=$1, approved_at=NOW(), "
                "rejection_reason=$2 WHERE id=$3::uuid AND org_id=$4::uuid AND status='pending' RETURNING *",
                user["user_id"], body.rejection_reason, str(claim_id), org_id,
            )
            if not row:
                raise HTTPException(404, "Pending claim not found")
            _emp_user_id = await _conn.fetchval(
                "SELECT user_id FROM staging.manav_employees WHERE id=$1::uuid",
                str(row["employee_id"]),
            )
            await expense_decided(
                _conn, org_id=org_id, actor_id=user["user_id"],
                claim_id=row["id"], row=dict(row), decision="rejected",
                employee_user_id=_emp_user_id,
            )
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", str(row["employee_id"]),
    )
    if emp and emp.get("email"):
        from services.employee_email import send_expense_decision_email
        send_expense_decision_email(
            emp["email"], emp["name"], row.get("category", "Expense"),
            float(row["amount"]), "rejected", user.get("name", "Admin"),
        )
    return dict(row)


# ── Recruitment / Applicant Tracking ─────────────────────────

@router.get("/job-openings")
async def list_job_openings(
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Recruitment is not employee self-service.
    _require(levels, VIEWER)
    q = (
        "SELECT j.*, d.name AS department_name, "
        "(SELECT COUNT(*) FROM staging.manav_candidates c WHERE c.job_opening_id = j.id) AS candidate_count "
        "FROM staging.manav_job_openings j "
        "LEFT JOIN staging.manav_departments d ON d.id = j.department_id "
        "WHERE j.org_id=$1::uuid"
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND j.status=${len(params)}"
    q += " ORDER BY j.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/job-openings")
async def create_job_opening(
    body: JobOpeningCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_job_openings (org_id, title, department_id, description, created_by) "
        "VALUES ($1::uuid, $2, NULLIF($3,'')::uuid, $4, $5) RETURNING *",
        org_id, body.title, body.department_id, body.description, user["user_id"],
    )
    return dict(row)


@router.patch("/job-openings/{opening_id}")
async def update_job_opening(
    opening_id: UUID,
    body: JobOpeningUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    updates, vals = [], []
    for field in ("title", "description", "status"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            updates.append(f"{field}=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    vals += [str(opening_id), org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.manav_job_openings SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Job opening not found")
    return dict(row)


@router.get("/candidates")
async def list_candidates(
    job_opening_id: str = "",
    stage: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Candidate name, email, phone and resume — outsiders' PII.
    _require(levels, VIEWER)
    q = "SELECT * FROM staging.manav_candidates WHERE org_id=$1::uuid"
    params: list = [org_id]
    if job_opening_id:
        params.append(job_opening_id)
        q += f" AND job_opening_id=${len(params)}::uuid"
    if stage:
        params.append(stage)
        q += f" AND stage=${len(params)}"
    q += " ORDER BY created_at DESC"
    rows = await pool.fetch(q, *params)
    from services.storage import sign_key
    candidates = []
    for r in rows:
        d = dict(r)
        if d.get("resume_key"):
            d["resume_url"] = await sign_key(org_id, d["resume_key"]) or d.get("resume_url", "")
        candidates.append(d)
    return {"data": candidates}


@router.post("/candidates")
async def create_candidate(
    body: CandidateCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    # `RecruitmentTab.jsx` renders this straight into an `<a href>`, so the
    # refusal covers `javascript:` as well as the `data:` URI that would put an
    # outsider's résumé in the database.
    assert_file_url(body.resume_url, "resume_url")
    assert_file_url(body.resume_key, "resume_key")

    pool = await get_pool()
    _require(levels, EDITOR)
    opening = await pool.fetchrow(
        "SELECT id FROM staging.manav_job_openings WHERE id=$1::uuid AND org_id=$2::uuid",
        body.job_opening_id, org_id,
    )
    if not opening:
        raise HTTPException(404, "Job opening not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_candidates "
        "(org_id, job_opening_id, full_name, email, phone, resume_url, resume_key, notes) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8) RETURNING *",
        org_id, body.job_opening_id, body.full_name, body.email, body.phone,
        body.resume_url, body.resume_key, body.notes,
    )
    return dict(row)


@router.patch("/candidates/{candidate_id}/stage")
async def update_candidate_stage(
    candidate_id: UUID,
    body: CandidateStageUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    valid_stages = ("applied", "screening", "interview", "offer", "hired", "rejected")
    if body.stage not in valid_stages:
        raise HTTPException(400, f"stage must be one of: {', '.join(valid_stages)}")
    row = await pool.fetchrow(
        "UPDATE staging.manav_candidates SET stage=$1, rejection_reason=$2, updated_at=NOW() "
        "WHERE id=$3::uuid AND org_id=$4::uuid RETURNING *",
        body.stage, body.rejection_reason if body.stage == "rejected" else None,
        str(candidate_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Candidate not found")
    return dict(row)


@router.post("/candidates/{candidate_id}/hire")
async def hire_candidate(
    candidate_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Creates a personnel record.
    _require(levels, ADMIN)
    candidate = await pool.fetchrow(
        "SELECT * FROM staging.manav_candidates WHERE id=$1::uuid AND org_id=$2::uuid",
        str(candidate_id), org_id,
    )
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate["converted_employee_id"]:
        raise HTTPException(400, "Candidate has already been converted to an employee")

    # THE SECOND PLACE AN EMPLOYEE ROW IS BORN — create_employee is the other.
    # One `employee.joined` per actual row creation: this INSERT is a genuinely
    # new personnel record (the already-converted guard above forbids a second
    # one for the same candidate), so it emits exactly like create_employee
    # does, and never twice for one person. The candidate flip rides in the
    # same transaction so a hire cannot half-happen.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            emp = await _conn.fetchrow(
                "INSERT INTO staging.manav_employees "
                "(org_id, name, email, phone, date_of_joining, employment_type, created_by) "
                "VALUES ($1::uuid, $2, $3, $4, CURRENT_DATE, 'full_time', $5) "
                "RETURNING *",
                org_id, candidate["full_name"], candidate["email"], candidate["phone"], user["user_id"],
            )
            await _conn.execute(
                "UPDATE staging.manav_candidates SET stage='hired', converted_employee_id=$1, updated_at=NOW() "
                "WHERE id=$2::uuid",
                emp["id"], str(candidate_id),
            )
            await employee_joined(
                _conn, org_id=org_id, actor_id=user["user_id"],
                employee_id=emp["id"], row=dict(emp),
            )
    return {"ok": True, "employee_id": str(emp["id"])}


# ── Asset Tracking ──────────────────────────────────────────

class AssetCreate(BaseModel):
    asset_tag: str
    name: str
    category: str = "other"
    serial_number: str = ""
    purchase_date: str = ""
    purchase_cost: float = 0
    condition: str = "good"
    notes: str = ""


class AssetUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    serial_number: str | None = None
    purchase_date: str | None = None
    purchase_cost: float | None = None
    condition: str | None = None
    notes: str | None = None


class AssetAssign(BaseModel):
    employee_id: str


@router.get("/assets")
async def list_assets(
    category: str = "",
    assigned: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Names the employee each asset is issued to.
    _require(levels, VIEWER)
    q = (
        "SELECT a.*, e.name AS employee_name "
        "FROM staging.manav_assets a "
        "LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
        "WHERE a.org_id=$1::uuid AND a.is_active=TRUE"
    )
    params: list = [org_id]
    if category:
        params.append(category)
        q += f" AND a.category=${len(params)}"
    if assigned == "yes":
        q += " AND a.assigned_to IS NOT NULL"
    elif assigned == "no":
        q += " AND a.assigned_to IS NULL"
    q += " ORDER BY a.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/assets")
async def create_asset(
    body: AssetCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    valid_cats = ("laptop", "phone", "tablet", "vehicle", "furniture", "other")
    if body.category not in valid_cats:
        raise HTTPException(400, f"category must be one of: {', '.join(valid_cats)}")
    valid_cond = ("new", "good", "fair", "poor", "disposed")
    if body.condition not in valid_cond:
        raise HTTPException(400, f"condition must be one of: {', '.join(valid_cond)}")
    p_date = date.fromisoformat(body.purchase_date) if body.purchase_date else None
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_assets "
        "(org_id, asset_tag, name, category, serial_number, purchase_date, "
        "purchase_cost, condition, notes, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, $8, $9, $10) RETURNING *",
        org_id, body.asset_tag, body.name, body.category, body.serial_number,
        p_date, body.purchase_cost, body.condition, body.notes, user["user_id"],
    )
    return dict(row)


@router.get("/assets/{asset_id}")
async def get_asset(
    asset_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, VIEWER)
    row = await pool.fetchrow(
        "SELECT a.*, e.name AS employee_name "
        "FROM staging.manav_assets a "
        "LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
        "WHERE a.id=$1::uuid AND a.org_id=$2::uuid AND a.is_active=TRUE",
        asset_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    return dict(row)


@router.patch("/assets/{asset_id}")
async def update_asset(
    asset_id: str,
    body: AssetUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    updates, vals = [], []
    for field in ("name", "serial_number", "notes"):
        v = getattr(body, field)
        if v is not None:
            vals.append(v); updates.append(f"{field}=${len(vals)}")
    if body.category is not None:
        valid = ("laptop", "phone", "tablet", "vehicle", "furniture", "other")
        if body.category not in valid:
            raise HTTPException(400, "Invalid category")
        vals.append(body.category); updates.append(f"category=${len(vals)}")
    if body.condition is not None:
        valid = ("new", "good", "fair", "poor", "disposed")
        if body.condition not in valid:
            raise HTTPException(400, "Invalid condition")
        vals.append(body.condition); updates.append(f"condition=${len(vals)}")
    if body.purchase_cost is not None:
        vals.append(body.purchase_cost); updates.append(f"purchase_cost=${len(vals)}")
    if body.purchase_date is not None:
        vals.append(date.fromisoformat(body.purchase_date)); updates.append(f"purchase_date=${len(vals)}::date")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [asset_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.manav_assets SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid AND is_active=TRUE RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    return dict(row)


@router.delete("/assets/{asset_id}")
async def delete_asset(
    asset_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    result = await pool.execute(
        "UPDATE staging.manav_assets SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        asset_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Asset not found")
    return {"ok": True}


@router.post("/assets/{asset_id}/assign")
async def assign_asset(
    asset_id: str,
    body: AssetAssign,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    emp = await pool.fetchrow(
        "SELECT id FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        body.employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")
    row = await pool.fetchrow(
        "UPDATE staging.manav_assets SET assigned_to=$1::uuid, assigned_date=CURRENT_DATE, "
        "returned_date=NULL, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid AND is_active=TRUE RETURNING *",
        body.employee_id, asset_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    # ── Notify employee ──
    emp_info = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", body.employee_id,
    )
    if emp_info and emp_info.get("email"):
        from services.employee_email import send_asset_email
        send_asset_email(
            emp_info["email"], emp_info["name"],
            row.get("name", "Asset"), row.get("asset_type", ""), "assigned",
        )
    return dict(row)


@router.post("/assets/{asset_id}/return")
async def return_asset(
    asset_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    # Fetch current assignee before clearing
    prev = await pool.fetchrow(
        "SELECT a.assigned_to, a.name AS asset_name, a.asset_type, e.name, e.email "
        "FROM staging.manav_assets a LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
        "WHERE a.id=$1::uuid AND a.org_id=$2::uuid AND a.is_active=TRUE",
        asset_id, org_id,
    )
    row = await pool.fetchrow(
        "UPDATE staging.manav_assets SET assigned_to=NULL, returned_date=CURRENT_DATE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE RETURNING *",
        asset_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    # ── Notify employee ──
    if prev and prev.get("email"):
        from services.employee_email import send_asset_email
        send_asset_email(
            prev["email"], prev["name"],
            prev.get("asset_name", "Asset"), prev.get("asset_type", ""), "returned",
        )
    return dict(row)


@router.get("/employees/{employee_id}/assets")
async def employee_assets(
    employee_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Every other asset route requires viewer because the rows name the employee
    # they are issued to. This one takes the employee id in the path, so without
    # a filter it is the same disclosure with an extra step. Own kit at self
    # scope, anybody else's needs viewer.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own or str(employee_id) != own:
            raise HTTPException(403, "You can only view your own assets")
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_assets "
        "WHERE org_id=$1::uuid AND assigned_to=$2::uuid AND is_active=TRUE ORDER BY assigned_date DESC",
        org_id, employee_id,
    )
    return {"data": [dict(r) for r in rows]}


# ═════════════════════════════════════════════════════════════════════════════
# Commission schemes, their bands, and bonus awards
# ═════════════════════════════════════════════════════════════════════════════
#
# The owner asked for three things and they are three different kinds of fact:
#
#   · a LADDER — "3% from 1L to 5L ... 3.75% 5L to 7.5L and so on" — a scheme
#     plus a child table of bands, written in ONE transaction. Each band pays
#     on its own portion; that reading is decided, not configured;
#   · a SCOPE — "he gets his own of what he do but he gets yearly commission on
#     total GP of his team" ... "teams is department" — so a scheme measures
#     either the person's own revenue or their department's, stated explicitly
#     and never defaulted;
#   · MONTHLY *AND* YEARLY AT ONCE — "this month keval did 5Lakh plus then 3%
#     but also company had yearly commission as well that if you 20lakh plus
#     then 2%" — two schemes, both current, both paying, which migration 190
#     makes storable by keying uniqueness on (employee, PERIOD, ...);
#   · a BONUS — "HR or company can also give bonus ... employee eligible for
#     bonus yes or no" — a decision somebody makes, derived from nothing.
#
# EVERY ONE OF THESE WRITES IS VALIDATED BY BUILDING THE DOMAIN OBJECT FIRST.
# `commission.Scheme(...)` enforces the same rules migration 190 enforces — no
# eligible scheme without bands, none without a stated scope, no two bands at
# one threshold — and it enforces them with a sentence a person can read.
# Duplicating those rules as `if` statements here is how the two come to
# disagree, and the one that disagrees quietly is the one that pays somebody.
#
# THERE IS NO DEFAULT ANYWHERE BELOW. Not a rate, not a threshold, not a slab
# reading, not an amount. The owner's instruction — "no default commission
# percentage please org decide its own commission" — is a rule about who
# decides, and a default supplied here would be this product answering for a
# firm just as surely as a DEFAULT in the DDL would.


class CommissionBandIn(BaseModel):
    from_amount: float
    rate_percent: float


class CommissionSchemeCreate(BaseModel):
    employee_id: str
    eligible: bool = False          # a default that REFUSES — see migration 189
    #: NO DEFAULT, for the same reason `revenue_scope` below has none: both
    #: decide how much money is owed. `basis` chooses between turnover and
    #: gross profit, which are different numbers for the same sales; `period`
    #: decides whether the agreed rate is paid once a year or twelve times.
    #: They used to default to 'turnover' and 'monthly', so a firm that never
    #: said would be paid on terms this product invented for it.
    basis: str | None = None
    period: str | None = None
    effective_from: str = ""
    effective_to: str | None = None
    #: One of commission.REVENUE_SCOPES — 'own' or 'department'. NO DEFAULT:
    #: the person's own sales and their whole department's are different
    #: amounts of money, so this is as much a money decision as the rate.
    revenue_scope: str | None = None
    #: THE TERMS. A ladder of {from_amount, rate_percent}, as many rungs as the
    #: firm agreed — the owner said "and so on", so nothing caps it. Each band
    #: pays on its OWN PORTION: 3% on the slice from ₹1L to ₹5L, 3.75% from ₹5L
    #: to ₹7.5L, and so on. There is no setting for that reading; the owner
    #: decided it on 2026-08-21.
    #:
    #: Migration 185's flat `rate_percent` / `threshold_amount` /
    #: `threshold_mode` are SUPERSEDED and are deliberately NOT accepted here.
    #: A single rate over a single threshold is one band.
    bands: list[CommissionBandIn] = []
    notes: str = ""


class BonusEligibility(BaseModel):
    #: Required, and deliberately not defaulted: this endpoint exists to record
    #: an answer, so an absent answer is a 422 rather than a "no".
    bonus_eligible: bool


class BonusAwardCreate(BaseModel):
    employee_id: str
    amount: float
    reason: str
    pay_period: str                 # 'YYYY-MM' — the payroll month it is paid
    notes: str = ""


def _pg_code(exc) -> str:
    """The SQLSTATE behind an asyncpg error, without importing asyncpg here."""
    return str(getattr(exc, "sqlstate", "") or "")


def _scheme_payload(row, bands) -> dict:
    """One scheme as the API returns it. No employee uuid and no user id: the
    caller passed the employee in and gets back the arrangement, not an
    identifier to render (decision_names_not_ids)."""
    # The superseded columns — rate_percent, threshold_amount, threshold_mode —
    # are NOT returned. They are read by nothing, and putting them on the wire
    # would invite a screen to render one of two answers about somebody's pay.
    return {
        "id": str(row["id"]),
        "eligible": row["eligible"],
        "basis": row["basis"],
        "period": row["period"],
        "revenue_scope": row["revenue_scope"],
        "effective_from": row["effective_from"],
        "effective_to": row["effective_to"],
        "notes": row["notes"],
        "bands": [{"from_amount": float(b["from_amount"]),
                   "rate_percent": float(b["rate_percent"])}
                  for b in bands],
    }


async def _may_see_employee_pay(pool, user, org_id, levels, employee_id) -> bool:
    """Admin on Manav, or the person themselves.

    A commission ladder and a bonus award are facts about somebody's PAY. Manav
    is self-scoped, so a bare `_gate` read would hand one employee another
    employee's rate; and refusing a person their own arrangement would be a
    product that keeps somebody's own commission terms from them.
    """
    if _can(levels, ADMIN):
        return True
    own = await _own_employee_id(pool, user, org_id)
    return bool(own and str(employee_id) == own)


@router.get("/employees/{employee_id}/commission-schemes")
async def list_commission_schemes(
    employee_id: str,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Every version of this person's arrangements, with their ladders.

    Closed versions included and NEVER hidden: last quarter's commission has to
    stay reproducible on last quarter's terms, which is the entire reason
    migration 185 made a scheme a dated row rather than a column.
    """
    pool = await get_pool()
    if not await _may_see_employee_pay(pool, user, org_id, levels, employee_id):
        raise HTTPException(403, "You can only view your own commission terms")
    if not await _employee_in_org(pool, employee_id, org_id):
        raise HTTPException(404, "Employee not found")

    rows = await pool.fetch(
        "SELECT * FROM staging.manav_commission_schemes "
        " WHERE org_id=$1::uuid AND employee_id=$2::uuid "
        " ORDER BY period, effective_from DESC",
        org_id, employee_id,
    )
    out = []
    for r in rows:
        bands = await pool.fetch(
            "SELECT from_amount, rate_percent "
            "  FROM staging.manav_commission_bands "
            " WHERE org_id=$1::uuid AND scheme_id=$2::uuid "
            " ORDER BY from_amount",
            org_id, r["id"],
        )
        out.append(_scheme_payload(r, bands))
    audit(
        "manav.commission_schemes_read",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_commission_scheme",
        detail={"schemes": len(out)},
    )
    return {"data": out, "total": len(out)}


@router.post("/commission-schemes")
async def create_commission_scheme(
    body: CommissionSchemeCreate,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Record one arrangement and its ladder, in ONE transaction.

    A person may hold a monthly scheme on their OWN sales and an annual scheme
    on their DEPARTMENT'S gross profit at the same time, and be paid by both —
    the owner's own example. What is still refused is two current arrangements
    for the SAME (period, scope) pair.

    The scheme row and its bands are written together or not at all, and the
    deferred trigger `manav_commission_terms_stated()` checks at COMMIT that
    the pair is coherent. That ordering is why the trigger is DEFERRED: the
    scheme necessarily lands first, and an immediate check would refuse every
    correct ladder.

    A person may hold a monthly scheme AND an annual scheme at the same time
    and be paid by both. Two schemes on the SAME period, both open-ended, is
    still refused — one person cannot have two current monthly rates, because
    then their rate depends on which row is read first.
    """
    _require(levels, ADMIN)
    pool = await get_pool()

    if not await _employee_in_org(pool, body.employee_id, org_id):
        raise HTTPException(404, "Employee not found")
    if not body.effective_from:
        raise HTTPException(
            400,
            "effective_from is required. A commission arrangement with no "
            "start date cannot be resolved as of any period, and last "
            "quarter's commission has to keep computing on last quarter's "
            "terms.",
        )
    try:
        eff_from = date.fromisoformat(body.effective_from)
        eff_to = date.fromisoformat(body.effective_to) if body.effective_to else None
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")

    # THE VALIDATION, done once, by the same object that does the arithmetic.
    # Every rule migration 190 enforces is enforced here first, with a message
    # written for a person rather than a constraint name.
    try:
        scheme = C.Scheme(
            eligible=bool(body.eligible),
            basis=(body.basis or None),
            period=(body.period or None),
            effective_from=eff_from,
            effective_to=eff_to,
            revenue_scope=body.revenue_scope or None,
            bands=tuple((b.from_amount, b.rate_percent) for b in body.bands),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # The superseded columns are left entirely alone: no
                # rate_percent, no threshold_amount, no threshold_mode. The
                # terms are the bands and nothing else, which is also what
                # migration 190's trigger enforces at COMMIT.
                row = await conn.fetchrow(
                    "INSERT INTO staging.manav_commission_schemes "
                    "(org_id, employee_id, eligible, basis, revenue_scope, "
                    " period, effective_from, effective_to, notes, created_by) "
                    "VALUES ($1::uuid, $2::uuid, $3, $4, $5, "
                    "        $6, $7::date, $8::date, $9, $10) "
                    "RETURNING *",
                    org_id, body.employee_id, scheme.eligible, scheme.basis,
                    scheme.revenue_scope, scheme.period, eff_from, eff_to,
                    body.notes or None, user["user_id"],
                )
                # Bands as the SCHEME normalised them — sorted, de-duplicated —
                # not as the request happened to order them, so what is stored
                # is what was validated.
                for band in scheme.bands:
                    await conn.execute(
                        "INSERT INTO staging.manav_commission_bands "
                        "(org_id, scheme_id, from_amount, rate_percent, created_by) "
                        "VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5)",
                        org_id, row["id"], str(band.from_amount),
                        str(band.rate_percent), user["user_id"],
                    )
    except HTTPException:
        raise
    except Exception as exc:
        code = _pg_code(exc)
        if code == "23505":
            raise HTTPException(
                409,
                f"This person already has a {body.period} scheme on "
                f"{body.revenue_scope or 'that scope'} starting on "
                f"{body.effective_from}, or an open-ended one. Close the "
                f"existing version first — two current arrangements for one "
                f"period and scope would make their rate depend on which row "
                f"is read first. A DIFFERENT period or a different scope "
                f"(monthly on their own sales beside annual on their "
                f"department's) is allowed and is not what this is.",
            )
        if code in ("23514", "23P01"):
            raise HTTPException(400, f"The database refused these terms: {exc}")
        raise

    bands = await pool.fetch(
        "SELECT from_amount, rate_percent "
        "  FROM staging.manav_commission_bands "
        " WHERE org_id=$1::uuid AND scheme_id=$2::uuid ORDER BY from_amount",
        org_id, row["id"],
    )
    audit(
        "manav.commission_scheme_created",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_commission_scheme",
        resource_id=str(row["id"]),
        detail={"period": scheme.period, "eligible": scheme.eligible,
                "bands": len(scheme.bands),
                "revenue_scope": scheme.revenue_scope},
    )
    return _scheme_payload(row, bands)


@router.put("/employees/{employee_id}/bonus-eligibility")
async def set_bonus_eligibility(
    employee_id: str,
    body: BonusEligibility,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The owner's "employee eligible for bonus yes or no", and nothing else.

    Not a promise and not an amount: it says whether this person MAY be awarded
    a bonus at all. An award is a separate row with an amount, a reason and the
    name of whoever decided. Turning eligibility off does NOT withdraw an award
    already made — payroll pays what was awarded, and taking it back is an act
    somebody has to perform on the award itself.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE staging.manav_employees SET bonus_eligible=$3, updated_at=NOW() "
        " WHERE id=$1::uuid AND org_id=$2::uuid "
        "RETURNING name, bonus_eligible",
        employee_id, org_id, bool(body.bonus_eligible),
    )
    if not row:
        raise HTTPException(404, "Employee not found")
    audit(
        "manav.bonus_eligibility_set",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_employee",
        resource_id=str(employee_id),
        detail={"bonus_eligible": row["bonus_eligible"]},
    )
    return {"employee": row["name"], "bonus_eligible": row["bonus_eligible"]}


@router.get("/bonus-awards")
async def list_bonus_awards(
    request: Request,
    employee_id: str = "",
    pay_period: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Awards, newest first. Admin sees the org's; anybody sees their own."""
    pool = await get_pool()
    if not _can(levels, ADMIN):
        own = await _own_employee_id(pool, user, org_id)
        if not own or (employee_id and str(employee_id) != own):
            raise HTTPException(403, "You can only view your own bonus awards")
        employee_id = own

    params = [org_id]
    q = ("SELECT a.id, a.amount, a.reason, a.pay_period, a.awarded_at, "
         "       a.notes, e.name AS employee_name "
         "  FROM staging.manav_bonus_awards a "
         "  JOIN staging.manav_employees e "
         "    ON e.id = a.employee_id AND e.org_id = a.org_id "
         " WHERE a.org_id=$1::uuid")
    if employee_id:
        params.append(str(employee_id))
        q += f" AND a.employee_id=${len(params)}::uuid"
    if pay_period:
        params.append(pay_period)
        q += f" AND a.pay_period=${len(params)}"
    q += " ORDER BY a.awarded_at DESC, a.id DESC"
    rows = await pool.fetch(q, *params)
    audit(
        "manav.bonus_awards_read",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_bonus_award",
        detail={"awards": len(rows)},
    )
    # `id` here is the award's own id, for the row's own routes. No employee,
    # member or user identifier leaves this endpoint — the person is a NAME.
    return {"data": [{**dict(r), "id": str(r["id"]),
                      "amount": float(r["amount"])} for r in rows],
            "total": len(rows)}


@router.post("/bonus-awards")
async def create_bonus_award(
    body: BonusAwardCreate,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """"HR or company can also give bonus" — one award, one decision, one row.

    DISCRETIONARY. Nothing here reads turnover, a threshold, a rate or a band,
    and no amount is suggested: the person deciding types the number. It
    reaches pay as a line in `vetana_payslips.other_earnings` for the payroll
    month named here, and the payroll run picks it up BY THAT MONTH — so
    re-running the month produces the same payslip rather than paying twice or
    dropping it.
    """
    _require(levels, ADMIN)
    pool = await get_pool()

    emp = await pool.fetchrow(
        "SELECT name, bonus_eligible FROM staging.manav_employees "
        " WHERE id=$1::uuid AND org_id=$2::uuid",
        body.employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")
    # The yes/no the owner asked for, with teeth. Without this the flag would
    # be a label on a screen that stopped nothing.
    if not emp["bonus_eligible"]:
        raise HTTPException(
            409,
            f"{emp['name']} is not marked eligible for a bonus. Set bonus "
            f"eligibility for this person first — the answer is recorded "
            f"deliberately, so that awarding a bonus is never the moment "
            f"somebody discovers the question.",
        )

    try:
        award = C.BonusAward(amount=body.amount, reason=body.reason,
                             pay_period=body.pay_period)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    try:
        row = await pool.fetchrow(
            "INSERT INTO staging.manav_bonus_awards "
            "(org_id, employee_id, amount, reason, pay_period, awarded_by, notes) "
            "VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5, $6, $7) "
            "RETURNING id, amount, reason, pay_period, awarded_at",
            org_id, body.employee_id, str(award.amount), award.reason,
            award.pay_period, user["user_id"], body.notes or None,
        )
    except Exception as exc:
        if _pg_code(exc) == "23514":
            raise HTTPException(
                400,
                "The database refused this award. The payroll month must be "
                "YYYY-MM, the amount above zero, and the reason not blank.",
            )
        raise

    audit(
        "manav.bonus_awarded",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_bonus_award",
        resource_id=str(row["id"]),
        detail={"pay_period": row["pay_period"], "amount": float(row["amount"])},
    )
    return {
        "id": str(row["id"]),
        "employee": emp["name"],
        "amount": float(row["amount"]),
        "reason": row["reason"],
        "pay_period": row["pay_period"],
        "awarded_at": row["awarded_at"],
    }
