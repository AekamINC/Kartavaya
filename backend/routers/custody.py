"""custody.py — the four custody registers, finally reachable over HTTP.

── WHY THIS FILE DID NOT EXIST ──────────────────────────────────────────────

`services/custody/` holds four finished, tested modules — `dsc.py`, `udin.py`,
`notices.py`, `offboarding.py` — over four applied tables. `ls backend/routers/
| grep custody` returned nothing. Measured against the live database on
2026-08-21 (SELECT only):

    staging.dsc_register                0 rows
    staging.udin_register               0 rows
    staging.notice_register             0 rows
    staging.manav_offboarding_custody   0 rows
    staging.notice_type                 7 rows   (the seeded catalogue)
    staging.udin_window                 2 rows   (migration 161 IS applied)
    staging.manav_offboarding          11 rows

A register nobody can read is a compliance claim the firm cannot make. This
router is the read surface for all four and the write surface for the one
custody line the services actually implement.

── WHAT THIS ROUTER DELIBERATELY DOES NOT DO ────────────────────────────────

THREE OF THE FOUR REGISTERS STILL HAVE NO WRITER, AND NOT BECAUSE OF THIS FILE.
`services/custody/dsc.py`, `udin.py` and `notices.py` contain no INSERT at all —
`notices.py` says so in its own docstring ("WHY THERE IS NO WRITE PATH HERE")
and gives the reason: staging and production share one database, so an
unexercised write path is a production risk with no upside yet. The only INSERT
in the whole package is `offboarding.record_custody`.

So a router cannot make those three registers writable without inventing the
business rules the service modules refused to invent — which is precisely what
a compliance register must not have done to it by its transport layer. The
create/update paths belong in the service modules, next to the arithmetic that
already knows what a valid row is. Until they exist, these three registers
render honestly as empty and this file serves them.

── THE ACCESS RULE, AND THE ONE THAT HAD TO BE DECIDED HERE ─────────────────

Everything hangs off the `manav` module gate, because the four registers are
surfaced as Manav tabs and a gate that disagrees with where a screen lives
403s exactly the people looking at it.

`require_module_or_self` is used rather than `require_module` for one reason:
Manav is in `SELF_SCOPED_MODULES`, so `require_module` is not the gate that
file's siblings use, and using it here would diverge. But SELF SCOPE IS REFUSED
ON EVERY ROUTE IN THIS FILE — an empty level set means "read your own row", and
none of these registers is anybody's own row. `_viewer()` turns the empty set
into a 403, which is what `any_level_satisfies(frozenset(), …)` already answers.

THE NOTICE REGISTER IS GATED HIGHER, and this is a decision that had to be made
here because `services/custody/notices.py` explicitly declined to make it:

    "This module answers 'which of our clients are under assessment'. That is
     the most commercially sensitive question the product can answer and it is
     not protected by anything in this file. No access rule is implemented here
     because none was specified … Until one exists, DO NOT mount these functions
     behind a router."

The rule chosen is `require_org_role(*ORG_MANAGEMENT_ROLES)` — org_owner or
org_admin, the same bar `routers/manav.py` puts on reading an employee's Aadhaar
(`_pii_gate`). NOT `hr_admin`: an HR administrator has no business in a client's
assessment list, and `HR_ADMIN_ROLES` would reach it through the module gate
alone. This is a judgement, it is not the owner's, and it should be confirmed.

── NAMES, NEVER IDS ─────────────────────────────────────────────────────────

The service modules already drop `org_id` and `client_id`. Three columns they do
NOT drop are stripped here instead, because they are login ids wearing display
names: `recorded_by`, `revoked_by` and `reassigned_to_user_ref` on a ledger row.
`offboarding.py`'s own rule is "display the label, pass the ref", and a key that
does not read like a ref is how an id reaches a template. `reassigned_to_name`
is the one to show and it survives.

The `*_ref` values that DO cross the wire — `task_ref`, `client_ref`,
`follow_up_ref`, `access_ref` — are the handles a caller needs to record a
custody line against a specific item. They are arguments, never text;
`frontend/scripts/check-rendered-ids.mjs` is the ratchet on that.

── SQL ──────────────────────────────────────────────────────────────────────

There is none in this file, on purpose. Every statement is in a service module,
schema-qualified, bound and cast. Adding one here would put a second
implementation of a window or a tenancy predicate somewhere no test looks.
"""
from __future__ import annotations

import dataclasses
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from limiter import limiter
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import (
    EDITOR, ORG_MANAGEMENT_ROLES, VIEWER,
    any_level_satisfies, require_module_or_self,
)
from services.audit import emit as audit
from services.custody import dsc, notices, offboarding, udin

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/custody", tags=["custody"])

#: The four registers are Manav tabs, so they carry Manav's gate. See the
#: docstring for why self scope is admitted by the dependency and refused by
#: every route.
MODULE = "manav"

_gate = require_module_or_self(MODULE)

#: The extra bar on the notice register alone. Declared at module level rather
#: than inline so a test can override it, the same way `routers/manav.py`
#: declares `_pii_gate`.
_notice_gate = require_org_role(*ORG_MANAGEMENT_ROLES)

#: A list ceiling that is not a lie. `udin.at_risk` and `notices.*` cap
#: internally; this is the ceiling on what a caller may ASK for, so a query
#: string cannot turn a compliance list into a table scan.
MAX_LIMIT = 500


# ── argument coercion ────────────────────────────────────────────────────────

def _parse_as_of(raw: str | None) -> date:
    """`as_of`, or today in UTC. A malformed date is refused, never guessed.

    Same contract as `routers/statute.py`. Defaulting an ABSENT date to today is
    the honest reading of "what is the position now". Guessing at `31-03-2026`
    is not: the caller would be told something false about a deadline, and every
    one of these registers is a deadline.

    The service modules refuse a missing `as_of` outright (`dsc._coerce_as_of`
    explains why at length — a cron at 23:55 IST in a UTC container). That
    refusal is about a PROGRAM that forgot to decide. An HTTP caller who omits
    the parameter is a person asking about today, and the answer is echoed back
    on every response so the page can print the date it was true on.
    """
    if not raw:
        return datetime.now(timezone.utc).date()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(
            422, f"as_of must be an ISO date (YYYY-MM-DD); got {raw!r}"
        )


def _parse_limit(raw: int | None, default: int) -> int:
    if raw is None:
        return default
    if raw < 1:
        raise HTTPException(422, "limit must be at least 1")
    return min(int(raw), MAX_LIMIT)


def _viewer(levels) -> None:
    """Every read in this file. An empty set — Manav self scope — is refused.

    Self scope is "your own employee row". A client's DSC register, a UDIN
    backlog, a notice register and another person's exit are none of them the
    caller's own row, so the module's self-scope admission must stop at this
    router's door.
    """
    if not any_level_satisfies(levels, VIEWER, MODULE):
        raise HTTPException(
            403,
            "The custody registers need at least viewer access to Manav. "
            "Reading your own HR record does not reach them.",
        )


def _editor(levels) -> None:
    if not any_level_satisfies(levels, EDITOR, MODULE):
        raise HTTPException(
            403, "Recording a custody line needs editor access to Manav."
        )


def _refused(exc: Exception) -> HTTPException:
    """A service module's own refusal, in its own words, as a 422.

    `CrossOrgLeak` is NOT routed here and must not be: it means the SQL is wrong
    and a foreign row nearly reached a caller. It is left to propagate as a 500
    so it is loud, alerted on and impossible to read as a client error. Both
    leak classes subclass their module's error type, so the check is by type and
    the order matters.
    """
    return HTTPException(422, str(exc))


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, (dsc.CrossOrgLeak, notices.CrossOrgLeak)):
        raise exc
    return _refused(exc)


# ══════════════════════════════════════════════════════════════════════════════
#  DSC — staging.dsc_register (migration 160)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/dsc")
async def dsc_register(
    as_of: str | None = Query(None, description="ISO date. Defaults to today."),
    include_inactive: bool = Query(False),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The whole DSC register, soonest expiry first, with the status split.

    `summarise` rides along because every one of its keys is present even at
    zero — a dashboard that renders only the keys it was given shows nothing
    where "0 expired" is the reassuring thing the reader came for.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.register(
            pool, org_id, as_of=stamp, include_inactive=include_inactive
        )
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {
        "as_of": stamp.isoformat(),
        "data": rows,
        "count": len(rows),
        "summary": dsc.summarise(rows),
        # Said out loud because the two halves of the register do not add up to
        # it: `expiring` drops revoked certificates and `expired` drops nothing,
        # so a caller summing the two lists does not get this number.
        "note": (
            "This is the complete register. The expiring and expired lists are "
            "not a partition of it — a certificate revoked before its expiry "
            "date is in neither."
        ),
    }


@router.get("/dsc/expiring")
async def dsc_expiring(
    days: int = Query(30, ge=0, le=3650),
    as_of: str | None = Query(None),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Certificates dying inside [as_of, as_of + days]. INCLUSIVE AT BOTH ENDS.

    `days=0` is "dies today, still works today" and is not the same question as
    `expired`. Revoked certificates are absent by design — they are gone, not
    expiring, and putting them in a renewal list tells a firm to renew something
    the CA has already killed.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.expiring_within(pool, org_id, days=int(days), as_of=stamp)
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "days": int(days),
            "data": rows, "count": len(rows)}


@router.get("/dsc/expired")
async def dsc_expired(
    as_of: str | None = Query(None),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Already past `valid_to`, most recent death first."""
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.expired(pool, org_id, as_of=stamp)
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": rows, "count": len(rows)}


@router.get("/dsc/unusable")
async def dsc_unusable(
    as_of: str | None = Query(None),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The filing-day question: everything the firm cannot sign with today.

    Expired, revoked, not yet valid, OR not in this office. Read `status` on
    each row for which. This is the one endpoint a "can we file on the 30th?"
    check should call, because "we gave the token back in March" blocks a filing
    exactly as hard as an expiry and is written down nowhere else.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.unusable(pool, org_id, as_of=stamp)
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": rows, "count": len(rows)}


@router.get("/dsc/not-in-possession")
async def dsc_not_in_possession(
    as_of: str | None = Query(None),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Tokens the firm does not hold, whatever their dates say."""
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.not_in_possession(pool, org_id, as_of=stamp)
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": rows, "count": len(rows)}


# TWO ROUTES, NOT ONE WITH AN OPTIONAL PARAMETER, and that is the whole point.
# `dsc.for_client(client_id=None)` means THE PRACTICE'S OWN certificates — the
# partners' DSCs a firm holds for its own signing — and not "all clients". A
# single route with `client_id` optional would turn an omitted query parameter
# into that meaning by accident, which is the exact misreading the service
# docstring warns about three separate times.

@router.get("/dsc/by-client/{client_id}")
async def dsc_for_client(
    client_id: str,
    as_of: str | None = Query(None),
    include_inactive: bool = Query(True),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Every certificate held for one company, retired rows included.

    `include_inactive` defaults TRUE here and FALSE on the register: "we used to
    hold three of theirs" is a question clients ask, and a soft-deleted row is
    history rather than an error.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.for_client(
            pool, org_id, client_id, as_of=stamp, include_inactive=include_inactive
        )
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": rows, "count": len(rows)}


@router.get("/dsc/firm-own")
async def dsc_firm_own(
    as_of: str | None = Query(None),
    include_inactive: bool = Query(True),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The practice's OWN certificates — the ones with no client attached."""
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await dsc.for_client(
            pool, org_id, None, as_of=stamp, include_inactive=include_inactive
        )
    except dsc.CustodyError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": rows, "count": len(rows)}


# ══════════════════════════════════════════════════════════════════════════════
#  UDIN — staging.udin_register + staging.udin_window (migration 161)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/udin/windows")
async def udin_windows(
    as_of: str | None = Query(None),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The two ICAI windows in force on `as_of`, AND where each number came from.

    `generate_source` / `revoke_source` are 'table' when `staging.udin_window`
    answered and 'icai-default' when a constant compiled into the build did. A
    firm reading a deadline is entitled to know which, and the generation window
    has already moved once — 15 days to 60, at the Council's 405th meeting on
    17 September 2021.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        windows = await udin.load_windows(pool, as_of=stamp)
    except udin.UdinError as exc:
        raise _refused(exc)
    return {
        "as_of": stamp.isoformat(),
        "generate_days": windows.generate_days,
        "revoke_hours": windows.revoke_hours,
        "sources": windows.sources,
    }


@router.get("/udin/at-risk")
async def udin_at_risk(
    as_of: str | None = Query(None),
    within_days: int | None = Query(None, ge=0),
    include_lapsed: bool = Query(True),
    limit: int | None = Query(None, ge=1),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Signed, no UDIN, day N of the window — most urgent first.

    The query the UDIN module exists to serve. `days_left == 0` means TODAY IS
    THE LAST DAY and is not lapsed; the window runs from the signing date
    inclusive, so sixty days from the 1st ends on `signed_on + 59`.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await udin.at_risk(
            pool, org_id,
            as_of=stamp,
            within_days=within_days,
            include_lapsed=include_lapsed,
            limit=_parse_limit(limit, udin.DEFAULT_LIMIT),
        )
    except udin.UdinError as exc:
        raise _refused(exc)
    return {"as_of": stamp.isoformat(), "data": rows, "count": len(rows)}


@router.get("/udin/revocable")
async def udin_revocable(
    limit: int | None = Query(None, ge=1),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Every UDIN still inside its 48-hour revocation window, soonest out first.

    `now` is the SERVER's clock and is deliberately not a query parameter. The
    48 hours run from an instant, not a date, so a caller-supplied "now" would
    let a browser with a wrong clock be told it can still revoke something it
    cannot — and a revocation is not an undo: past the window the member has to
    generate a fresh UDIN inside whatever is left of the sixty days.
    """
    _viewer(levels)
    moment = datetime.now(timezone.utc)
    pool = await get_pool()
    try:
        rows = await udin.revocable_now(
            pool, org_id, now=moment, limit=_parse_limit(limit, udin.DEFAULT_LIMIT)
        )
    except udin.UdinError as exc:
        raise _refused(exc)
    return {"now": moment.isoformat(), "data": rows, "count": len(rows)}


@router.get("/udin/summary")
async def udin_summary(
    as_of: str | None = Query(None),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Counts by status, plus the open work bucketed by time left.

    `lapsed` is the figure that matters and the reason this is not a status
    breakdown: it is not a status and must never become one — whether the window
    has closed is a fact about today, and a stored copy is wrong between
    midnight and whenever a job gets round to flipping it.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        out = await udin.register_summary(pool, org_id, as_of=stamp)
    except udin.UdinError as exc:
        raise _refused(exc)
    return out


@router.get("/udin/syntax")
async def udin_syntax(
    udin_no: str = Query("", alias="udin", max_length=64),
    signed_on: str | None = Query(None),
    membership_no: str = Query("", max_length=32),
    levels=Depends(_gate),
):
    """Describe a UDIN string. ADVISORY ONLY — this never rejects one.

    Catching a UDIN pasted from another partner's portal session is the point:
    digits 3-8 of a UDIN ARE the generating member's ICAI membership number, and
    only the member who generated a UDIN can revoke it. Nothing here bars a
    value; a UDIN that does not match the published syntax comes back described
    and recorded as entered, exactly as GSTIN, PAN and TAN are.

    Not org-scoped, because there is no org data in it — the input is the
    caller's own string and the answer is a description of it.
    """
    _viewer(levels)
    stamp = _parse_as_of(signed_on) if signed_on else None
    return udin.udin_syntax(udin_no, signed_on=stamp, membership_no=membership_no)


# ══════════════════════════════════════════════════════════════════════════════
#  NOTICES — staging.notice_register + staging.notice_type (migration 162)
#
#  Gated at org_owner / org_admin. See the module docstring: the service module
#  declined to specify an access rule and warned against mounting it without
#  one, so the rule is stated here and is deliberately the same bar as reading
#  an employee's Aadhaar.
# ══════════════════════════════════════════════════════════════════════════════

def _notice_rows(rows: list[dict]) -> list[dict]:
    """`NoticeUrgency` -> a plain dict, so the wire shape is ours and not
    whatever a dataclass happens to serialise as.

    `urgency_note` is already a sentence a person can read and is left alone.
    """
    out = []
    for row in rows:
        item = dict(row)
        urgency = item.get("urgency")
        if dataclasses.is_dataclass(urgency):
            item["urgency"] = dataclasses.asdict(urgency)
        out.append(item)
    return out


@router.get("/notices")
async def notice_register(
    as_of: str | None = Query(None),
    limit: int | None = Query(None, ge=1),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
    _admin=Depends(_notice_gate),
):
    """Every live notice, worst first. `escalated` outranks merely overdue.

    A notice due TODAY has 0 days remaining and is NOT overdue — the reply is
    filed on the due date all the time, and a register that calls that late
    trains people to ignore it.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await notices.open_by_urgency(
            pool, org_id, as_of=stamp, limit=_parse_limit(limit, 200)
        )
    except notices.NoticeError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": _notice_rows(rows),
            "count": len(rows)}


@router.get("/notices/overdue")
async def notice_overdue(
    as_of: str | None = Query(None),
    limit: int | None = Query(None, ge=1),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
    _admin=Depends(_notice_gate),
):
    """Live notices whose reply date has already passed, worst first."""
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await notices.overdue(
            pool, org_id, as_of=stamp, limit=_parse_limit(limit, 200)
        )
    except notices.NoticeError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": _notice_rows(rows),
            "count": len(rows)}


@router.get("/notices/types")
async def notice_types(
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
    _admin=Depends(_notice_gate),
):
    """The catalogue this practice may file against: Aekam's types plus its own.

    7 system rows live today. `is_system` distinguishes them from a type the
    practice minted — whose LABEL can itself be revealing, which is why another
    org's private types are a `CrossOrgLeak` and not a filtered row.
    """
    _viewer(levels)
    pool = await get_pool()
    try:
        rows = await notices.notice_types(pool, org_id)
    except notices.NoticeError as exc:
        raise _guard(exc)
    return {"data": rows, "count": len(rows)}


@router.get("/notices/by-client/{client_id}")
async def notice_client_history(
    client_id: str,
    as_of: str | None = Query(None),
    limit: int | None = Query(None, ge=1),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
    _admin=Depends(_notice_gate),
):
    """Every notice one client has ever received, newest first.

    Deliberately NOT filtered by status: the value of a client history is the
    closed rows. "This is the fourth ASMT-10 on the same mismatch" is the
    sentence that changes how an engagement is run, and it is invisible in a
    list of open items.
    """
    _viewer(levels)
    stamp = _parse_as_of(as_of)
    pool = await get_pool()
    try:
        rows = await notices.client_history(
            pool, org_id, client_id, as_of=stamp, limit=_parse_limit(limit, 200)
        )
    except notices.NoticeError as exc:
        raise _guard(exc)
    return {"as_of": stamp.isoformat(), "data": _notice_rows(rows),
            "count": len(rows)}


# ══════════════════════════════════════════════════════════════════════════════
#  OFFBOARDING CUSTODY — staging.manav_offboarding_custody (migration 164)
#
#  The one register in this file with a real writer.
# ══════════════════════════════════════════════════════════════════════════════

#: Login ids wearing display names. `offboarding.py`'s own rule is "display the
#: label, pass the ref", and these three do not read like refs — which is how an
#: id ends up on a screen. `reassigned_to_name` is the field to show and it is
#: not in here.
_LEDGER_ID_COLUMNS = ("recorded_by", "revoked_by", "reassigned_to_user_ref")

#: Machine handles the browser has no use for. The caller addresses a leaver by
#: the employee id it already holds from the exits list; the exit's own id and
#: the resolved login id are looked up server-side on every call, so neither
#: needs to cross the wire.
_LEAVER_ID_COLUMNS = ("employee_ref", "offboarding_ref", "login_user_ref")


def _clean_ledger(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        item = {k: v for k, v in dict(row).items() if k not in _LEDGER_ID_COLUMNS}
        out.append(item)
    return out


def _clean_leaver(leaver: dict) -> dict:
    out = {k: v for k, v in dict(leaver).items() if k not in _LEAVER_ID_COLUMNS}
    # Stated rather than inferred from a missing key. An employee with no exit
    # record has no ledger and cannot be written against, and a caller that has
    # to notice an absent field to learn that will not notice it.
    out["has_exit_record"] = bool(leaver.get("offboarding_ref"))
    return out


class CustodyLine(BaseModel):
    """One line of the custody register. Upserted on (exit, action, type, ref).

    The vocabulary is NOT restated here — it is read off
    `offboarding._SUBJECT_TYPES` at validation time, so a subject type added to
    migration 164's CHECK and to the service cannot be silently refused by this
    file. Restating it is how the two drift.
    """

    action: str
    subject_type: str
    subject_label: str
    subject_ref: str | None = None
    #: A NAME, not a login id. See the note on the POST handler: every one of
    #: the 98 live `manav_employees` rows has `user_id` NULL, so a login-id
    #: destination is unreachable from the HR side today.
    reassigned_to_name: str | None = None
    status: str = "outstanding"
    waived_reason: str | None = None
    note: str | None = None


@router.get("/offboarding/{employee_id}")
@limiter.limit("60/minute")
async def offboarding_custody(
    request: Request,
    employee_id: str,
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Everything a leaver still holds: work, clients, follow-ups, live access.

    Rate-limited because this is the one read in the product that enumerates a
    person's live grants across three tables, and an unthrottled enumerator over
    a path parameter is a map of who can reach what.

    READ `unknown` BEFORE BELIEVING `clear`. `staging.manav_employees.user_id` is
    NULL on all 98 live rows and not one of the 98 employee emails matches a row
    in `public.users`, so today every real employee resolves to `login_link:
    'unresolved'` and the four lists come back empty BECAUSE NOBODY COULD BE
    LOOKED UP — not because the desk is empty. `clear` is already False in that
    case; `unknown` is why.

    404 when the employee does not exist IN THIS ORG. That is also how a leaver
    from another practice is refused, and it is the whole tenancy guard for this
    surface — every list below takes the login id resolved here.
    """
    _viewer(levels)
    pool = await get_pool()
    out = await offboarding.open_custody(pool, org_id, employee_id)
    if out is None:
        raise HTTPException(404, "No such employee in this organisation")

    out = dict(out)
    out["leaver"] = _clean_leaver(out["leaver"])
    out["ledger_outstanding"] = _clean_ledger(out.get("ledger_outstanding") or [])
    return out


@router.get("/offboarding/{employee_id}/ledger")
async def offboarding_ledger(
    employee_id: str,
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Everything already recorded against one exit — reassigned, revoked, waived.

    The full ledger, including settled lines, where `/offboarding/{id}` carries
    only the outstanding ones. A settled line is the evidence the exit was
    handled; hiding it once it is done leaves the firm with nothing to show.
    """
    _viewer(levels)
    pool = await get_pool()
    leaver = await offboarding.resolve_leaver(pool, org_id, employee_id)
    if leaver is None:
        raise HTTPException(404, "No such employee in this organisation")
    exit_ref = leaver.get("offboarding_ref")
    if not exit_ref:
        # Not a 404. The employee is real and simply has no exit record, so the
        # honest answer is an empty ledger with the reason attached.
        return {"data": [], "count": 0, "has_exit_record": False}
    rows = await offboarding.custody_ledger(pool, org_id, exit_ref)
    return {"data": _clean_ledger(rows), "count": len(rows),
            "has_exit_record": True}


@router.get("/offboarding/inherited/me")
async def inherited_by_me(
    org_id: str = Depends(get_org_id),
    user=Depends(require_user),
    levels=Depends(_gate),
):
    """What the CALLER has absorbed from other people's exits.

    Self-scoped on purpose and there is no route for anybody else's: the service
    function keys on a login id, and taking one from a path would be an
    enumeration over user ids in a product whose standing rule is that a user id
    never reaches a screen. A successor who has quietly absorbed four leavers'
    client lists is a capacity problem worth seeing; whose successor it is can
    be asked in person.
    """
    _viewer(levels)
    pool = await get_pool()
    rows = await offboarding.inherited_by(pool, org_id, user.get("user_id"))
    return {"data": _clean_ledger(rows), "count": len(rows)}


@router.post("/offboarding/{employee_id}/lines", status_code=201)
@limiter.limit("30/minute")
async def record_custody_line(
    request: Request,
    employee_id: str,
    body: CustodyLine,
    org_id: str = Depends(get_org_id),
    user=Depends(require_user),
    levels=Depends(_gate),
):
    """Record one custody line against a leaver's exit. Idempotent per subject.

    THE UPSERT IS WHAT MAKES A REPEATED SCAN SAFE. Without it, opening the exit
    screen twice writes the leaver's whole desk into the register twice, and by
    the fourth visit the count of outstanding items is four times the truth.

    The exit id is resolved SERVER-SIDE from the employee id: `record_custody`
    is an INSERT … SELECT whose WHERE proves (org, exit, employee) agree before
    any row exists to insert, and handing the browser an exit id to post back
    would be the transposed-argument failure that guard exists to catch, wearing
    a user's clothes.

    THREE CHECK CONSTRAINTS ARE PRE-EMPTED HERE, not left to the database. A
    CheckViolation arrives as an asyncpg error a router turns into a 500 with no
    useful message; each of these is a thing a person did and can fix:

      · reassign + done needs a destination  (…_destination_ck)
      · waived needs a reason                (…_waived_ck)
      · revoke + done needs a timestamp      (…_revoked_at_ck) — stamped with
        `now()` rather than refused, because the moment the button was pressed
        IS the revocation being recorded.

    `recorded_by` and `revoked_by` are taken from the verified token and never
    from the body, and neither is ever returned — see `_LEDGER_ID_COLUMNS`.
    """
    _editor(levels)

    action = (body.action or "").strip()
    if action not in ("reassign", "revoke"):
        raise HTTPException(422, "action must be 'reassign' or 'revoke'")
    if body.status not in ("outstanding", "done", "waived"):
        raise HTTPException(
            422, "status must be 'outstanding', 'done' or 'waived'"
        )
    # Read off the service's own tuple rather than restated. See CustodyLine.
    if body.subject_type not in offboarding._SUBJECT_TYPES:
        raise HTTPException(
            422,
            "subject_type must be one of "
            f"{list(offboarding._SUBJECT_TYPES)}",
        )
    label = (body.subject_label or "").strip()
    if not label:
        raise HTTPException(
            422, "subject_label is required — this row is displayed by it"
        )
    if body.status == "waived" and not (body.waived_reason or "").strip():
        raise HTTPException(
            422, "A waived line needs a reason. That is the whole value of it."
        )
    destination = (body.reassigned_to_name or "").strip()
    if action == "reassign" and body.status == "done" and not destination:
        raise HTTPException(
            422, "Say who the work was handed to before marking it done."
        )

    revoked_at = None
    revoked_by = None
    if action == "revoke" and body.status == "done":
        revoked_at = datetime.now(timezone.utc)
        revoked_by = user.get("user_id")

    pool = await get_pool()
    leaver = await offboarding.resolve_leaver(pool, org_id, employee_id)
    if leaver is None:
        raise HTTPException(404, "No such employee in this organisation")
    exit_ref = leaver.get("offboarding_ref")
    if not exit_ref:
        raise HTTPException(
            409,
            "This person has no exit record. Start their exit in the Exits tab "
            "first — a custody line hangs off the exit, not off the employee.",
        )

    try:
        row = await offboarding.record_custody(
            pool, org_id, exit_ref, str(leaver.get("employee_ref")),
            action=action,
            subject_type=body.subject_type,
            subject_label=label,
            subject_ref=body.subject_ref,
            reassigned_to_name=destination or None,
            revoked_at=revoked_at,
            revoked_by=revoked_by,
            status=body.status,
            waived_reason=(body.waived_reason or None),
            note=(body.note or None),
            recorded_by=user.get("user_id"),
        )
    except ValueError as exc:
        # `record_custody` validates its own vocabulary. Anything it refuses is
        # a malformed request, not a server fault.
        raise HTTPException(422, str(exc))

    if row is None:
        # The INSERT … SELECT matched no exit. A refusal, and explicitly NOT
        # "already recorded" — the service docstring is emphatic that a caller
        # must not read None as success.
        raise HTTPException(
            409,
            "That exit, employee and organisation do not describe one real "
            "exit. Nothing was recorded.",
        )

    audit(
        "custody.line_recorded",
        request,
        org_id=org_id,
        user_id=user.get("user_id"),
        resource_type="manav_offboarding_custody",
        resource_id=str(row.get("id")),
        detail={
            "action": action,
            "subject_type": body.subject_type,
            "status": body.status,
        },
        # A revoke line is a record that somebody's access was pulled. That is
        # the row an audit is read for.
        severity="warn" if action == "revoke" else "info",
    )
    out = {k: v for k, v in dict(row).items() if k not in _LEDGER_ID_COLUMNS}
    return out
