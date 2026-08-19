"""udin.py — the ICAI UDIN register: what has been signed and not yet numbered.

A practising Chartered Accountant must obtain a Unique Document Identification
Number for every certificate, every GST and tax audit report and every other
audit, assurance and attestation function they sign. There is a window to do it
in, it starts at signing, and it closes. A signed document with no UDIN past
that window cannot be fixed afterwards: ICAI notification No.1-CA(7)/192/2019
was issued under Item (1) of Part II of the Second Schedule to the Chartered
Accountants Act 1949, so a contravention is professional misconduct.

THE QUERY THIS MODULE EXISTS TO SERVE is `at_risk`: signed, no UDIN, day N of
the window, ordered by how little time is left. Everything else here supports
it or checks the other, much shorter clock.

── THE TWO CLOCKS ARE DIFFERENT KINDS OF THING ─────────────────────────────
GENERATION is counted in WHOLE DAYS from the DATE of signing, and BOTH END
DATES COUNT. ICAI, FAQs on UDIN (6th edn, January 2026), Q19: "UDIN is to be
generated at the time of signing the Documents. However, in alignment with
SQC-1 and SA 230, the same can be generated within 60 days ... from the signing
of the same (both the dates i.e signing of the document and date of generation
of UDIN are included in the time allowed)."
  https://udin.icai.org/assets/images/FAQs%20on%20UDIN.pdf
The Council raised it from 15 days to 60 at its 405th meeting on 17 September
2021 — which is the proof that this number moves and must not be a constant in
a source file. It is `staging.udin_window` (migration 161).

REVOCATION is counted in HOURS from the INSTANT of generation. ICAI
announcement of 23 June 2023 (Council, 420th meeting, 23-24 March 2023):
"revocation of UDINs would now be possible within 48 hours from the time of its
generation."
  https://udin.icai.org/announcement/udin_2023-06-23
FAQ Q124 completes it: a member who misses the 48 hours "has to generate a
fresh UDIN within the permissible time limit" — the 60 days, still running.

── THE OFF-BY-ONE THAT THIS WHOLE MODULE EXISTS TO GET RIGHT ───────────────
Because BOTH end dates count, sixty days from the 1st ends on the 29th of the
following month at day 60 — that is `signed_on + 59`, NOT `signed_on + 60`.
Writing the obvious `+ 60` hands a firm a day it does not have, and the day it
hands them is the last one, when somebody is finally looking. Every deadline in
this module comes from `generation_deadline()` and nowhere else; the SQL never
does date arithmetic (see WHY THE ARITHMETIC IS IN PYTHON below), and the
inverse — "which signing date has this deadline" — is `signed_on_for_deadline`,
so the two directions cannot drift apart.

── WHY THE ARITHMETIC IS IN PYTHON AND NOT IN THE SQL ──────────────────────
The same reason `services/statute.py` gives, and it applies harder here: the
test suite runs against a MagicMock pool (`tests/conftest.py`), so a mock pool
hides bad SQL. A `signed_on + 59` written into a WHERE clause would be asserted
by nothing at all, while a test built on invented fixture rows would still pass
green. So the SQL is given DATE BOUNDS as bind parameters, computed here, and
the tests assert the bound values that were bound. There is exactly one
implementation of the window, it is in this file, and it is reachable without a
database.

── NAMES, NOT IDS ──────────────────────────────────────────────────────────
No function here returns `client_id`, `org_id` or `signed_by_user_id`. The rows
carry `client_name` and `signed_by_member`, which are snapshots taken at
signing (migration 161 explains why they are snapshots and not joins). The only
identifier that comes back is the register row's own `id`, which a caller needs
in order to address the row it is looking at.

`signed_by_membership_no` (the ICAI MRN) IS returned — it is not a system
identifier, it is printed on the document and embedded in the UDIN itself. It
is optional everywhere and blocks nothing, exactly like GSTIN, PAN and TAN.

── INTEGRATION POINT: statute ──────────────────────────────────────────────
A sibling module, `services/statute.py`, is the general home for dated
statutory facts (`staging.statute_calendar`, migration 158 — NOT APPLIED as of
19 August 2026, verified by `to_regclass`). The two UDIN windows deliberately
do NOT live there, because this register has to work whether or not 158 is
applied. When it lands, seed `icai.udin.generate_window` and
`icai.udin.revoke_window` into it and change the BODY of `load_windows` to ask
`statute.obligation(pool, key, as_of=...)`. The signature does not change:
`load_windows` already takes `as_of` and already resolves the half-open window
[effective_from, effective_to) the same way `statute.py` does, on purpose.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import asyncpg

# ── the ICAI numbers, as read from the sources cited in the docstring ────────
# These are the FALLBACK. `staging.udin_window` is the source of record so that
# a Council decision is an INSERT rather than a deploy; these constants are what
# answers before that table is applied, and what answers if it is ever empty.
# They are NOT a default anybody should rely on staying right: the generation
# window has already changed once (15 -> 60 on 17 September 2021).
ICAI_GENERATE_WINDOW_DAYS = 60
ICAI_GENERATE_WINDOW_FROM = date(2021, 9, 17)
ICAI_GENERATE_WINDOW_URL = (
    "https://udin.icai.org/assets/images/FAQs%20on%20UDIN.pdf"
)

ICAI_REVOKE_WINDOW_HOURS = 48
ICAI_REVOKE_WINDOW_FROM = date(2023, 6, 23)
ICAI_REVOKE_WINDOW_URL = "https://udin.icai.org/announcement/udin_2023-06-23"

#: ICAI's own three mandatory categories, with the date each became mandatory
#: (FAQ Q5; notification No.1-CA(7)/192/2019, Gazette 2 August 2019). These are
#: the three the UDIN portal itself splits on, which is why the register stores
#: one of them rather than a free-text document type.
DOCUMENT_KINDS: dict[str, dict[str, Any]] = {
    "certificate": {
        "label": "Certificate",
        "mandatory_from": date(2019, 2, 1),
    },
    "gst_or_tax_audit_report": {
        "label": "GST or tax audit report",
        "mandatory_from": date(2019, 4, 1),
    },
    "audit_assurance_attestation": {
        "label": "Audit, assurance or attestation",
        "mandatory_from": date(2019, 7, 1),
    },
}

#: Statuses `staging.udin_register.status` may hold. There is no 'lapsed' and
#: there must never be one: whether the window has closed is a fact about TODAY,
#: derived here, and a stored copy would be wrong between midnight and whenever
#: a job got round to flipping it — which is exactly when somebody is looking.
STATUSES = ("signed", "generated", "revoked", "not_required")

#: Cap on rows the at-risk scan will return. Deliberately larger than the
#: 200-row truncation the list endpoints use, because this is a compliance
#: backlog and a firm with 400 unnumbered documents needs to see that it has
#: 400. `register_summary` counts WITHOUT a limit, so the total is never a lie
#: even when the list is capped.
DEFAULT_LIMIT = 500

_UTC = timezone.utc

#: The published syntax, FAQ Q4: "YY MMMMMM AAAAAANNNN", e.g. 19304576AKTSBN1359
#: — 2 digits of the year, 6 digits of ICAI membership number, 10 alphanumerics
#: generated at random. Used ONLY to describe a UDIN, never to reject one; see
#: `udin_syntax`.
_UDIN_RE = re.compile(r"^(?P<yy>[0-9]{2})(?P<mrn>[0-9]{6})(?P<rand>[0-9A-Z]{10})$")


class UdinError(ValueError):
    """A caller passed something this module cannot make sense of."""


@dataclass(frozen=True)
class UdinWindows:
    """The two windows in force on a given date, and where they came from.

    Frozen because a window is a fact, not a setting: a caller that wants a
    different one is describing a different `as_of`, and should say so.
    """

    generate_days: int = ICAI_GENERATE_WINDOW_DAYS
    revoke_hours: int = ICAI_REVOKE_WINDOW_HOURS
    #: 'table' when `staging.udin_window` answered, 'icai-default' when the
    #: constants above did. Surfaced rather than hidden: a firm reading a
    #: deadline is entitled to know whether it came from the register's own
    #: policy table or from a number compiled into the build.
    generate_source: str = "icai-default"
    revoke_source: str = "icai-default"

    @property
    def sources(self) -> dict[str, str]:
        return {"generate": self.generate_source, "revoke": self.revoke_source}


# ── coercion ────────────────────────────────────────────────────────────────

def _as_date(value: Any, *, field: str) -> date:
    """A `date`, from a date, a datetime or an ISO string.

    A `datetime` is narrowed with `.date()` and NOT with any timezone
    conversion, because the caller has already decided what day it is by
    handing us a datetime; converting here would silently move a signing across
    midnight. Callers who care should pass a `date`.
    """
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError as exc:
            raise UdinError(f"{field}: not an ISO date: {value!r}") from exc
    raise UdinError(f"{field}: expected a date, got {type(value).__name__}")


def _as_aware(value: Any, *, field: str) -> datetime:
    """An aware UTC datetime.

    A NAIVE datetime is READ AS UTC rather than rejected. Rejecting it is the
    purist answer and the wrong one here: `udin_generated_at` arrives from
    asyncpg as aware, but a caller computing "now" with `datetime.utcnow()` —
    which is naive, and which half this codebase still writes — would otherwise
    turn the whole revocation panel into a TypeError at 500. Reading it as UTC
    is right for `utcnow()` and is at worst 5h30m out for a caller who passed
    local IST, which cannot flip a 48-hour answer near either edge without also
    being wrong about the day.
    """
    if not isinstance(value, datetime):
        raise UdinError(f"{field}: expected a datetime, got {type(value).__name__}")
    if value.tzinfo is None:
        return value.replace(tzinfo=_UTC)
    return value.astimezone(_UTC)


# ── the window arithmetic. One implementation, no database. ─────────────────

def generation_deadline(
    signed_on: Any, *, window_days: int = ICAI_GENERATE_WINDOW_DAYS
) -> date:
    """The LAST DATE on which a UDIN may still be generated for this signing.

    `window_days - 1`, not `window_days`. FAQ Q19: both the date of signing and
    the date of generation are included in the time allowed, so the signing date
    is day 1 and a 60-day window ends on `signed_on + 59`. Every other function
    here calls this one; nothing recomputes it.
    """
    if window_days < 1:
        raise UdinError(f"window_days must be at least 1, got {window_days}")
    return _as_date(signed_on, field="signed_on") + timedelta(days=window_days - 1)


def signed_on_for_deadline(
    deadline: Any, *, window_days: int = ICAI_GENERATE_WINDOW_DAYS
) -> date:
    """The inverse of `generation_deadline`: which signing date ends on `deadline`.

    This exists so that the SQL can be given date bounds instead of doing
    arithmetic, and so that the forward and inverse forms cannot drift — a test
    asserts they round-trip.
    """
    if window_days < 1:
        raise UdinError(f"window_days must be at least 1, got {window_days}")
    return _as_date(deadline, field="deadline") - timedelta(days=window_days - 1)


def day_of_window(signed_on: Any, as_of: Any) -> int:
    """Which day of the window `as_of` is. The signing date itself is day 1.

    Can be 0 or negative, and deliberately does not raise if it is: a document
    dated in the future is a data-entry error, and a compliance list that dies
    on one bad row shows a firm nothing at all about the other four hundred.
    `at_risk` flags such a row as `not_started` instead.
    """
    return (_as_date(as_of, field="as_of") - _as_date(signed_on, field="signed_on")).days + 1


def days_left(
    signed_on: Any, as_of: Any, *, window_days: int = ICAI_GENERATE_WINDOW_DAYS
) -> int:
    """Days remaining, where 0 means TODAY IS THE LAST DAY and is not lapsed.

    Negative means lapsed by that many days. The zero is the whole point: an
    "expires in 0 days" that actually meant "expired" would be the same
    off-by-one wearing a different hat.
    """
    deadline = generation_deadline(signed_on, window_days=window_days)
    return (deadline - _as_date(as_of, field="as_of")).days


def is_lapsed(
    signed_on: Any, as_of: Any, *, window_days: int = ICAI_GENERATE_WINDOW_DAYS
) -> bool:
    """True once `as_of` is PAST the deadline. On the deadline itself: False."""
    return _as_date(as_of, field="as_of") > generation_deadline(
        signed_on, window_days=window_days
    )


def urgency(days_remaining: int, *, started: bool = True) -> str:
    """A coarse bucket for ordering and colour. The NUMBER is the truth.

    Deliberately not stored and not a database enum: a bucket boundary is a
    product opinion that will be argued about, and arguing about it must never
    require a migration.
    """
    if not started:
        return "not_started"
    if days_remaining < 0:
        return "lapsed"
    if days_remaining == 0:
        return "last_day"
    if days_remaining <= 3:
        return "critical"
    if days_remaining <= 14:
        return "due_soon"
    return "open"


# ── the 48-hour clock ───────────────────────────────────────────────────────

def revocable_until(
    generated_at: Any, *, window_hours: int = ICAI_REVOKE_WINDOW_HOURS
) -> datetime:
    """The instant after which the UDIN can never be revoked. Aware, UTC."""
    if window_hours < 1:
        raise UdinError(f"window_hours must be at least 1, got {window_hours}")
    return _as_aware(generated_at, field="udin_generated_at") + timedelta(
        hours=window_hours
    )


def is_revocable(
    generated_at: Any,
    *,
    now: Any,
    window_hours: int = ICAI_REVOKE_WINDOW_HOURS,
) -> bool:
    """Can this UDIN still be revoked?

    STRICTLY `now < generated_at + 48h`. "Within 48 hours from the time of its
    generation" excludes the instant 48 hours later — at exactly +48:00:00 the
    portal already answers "This UDIN can't be revoked any more" (FAQ Q125).
    The `<` rather than `<=` is the boundary, and it is tested from both sides.
    """
    return _as_aware(now, field="now") < revocable_until(
        generated_at, window_hours=window_hours
    )


def revocation_window(
    generated_at: Any,
    *,
    now: Any,
    window_hours: int = ICAI_REVOKE_WINDOW_HOURS,
) -> dict[str, Any]:
    """The 48-hour picture for one generated UDIN.

    `seconds_left` is clamped at 0 rather than going negative, because it is a
    countdown and a negative countdown reads as a very large one after any
    formatting. `is_revocable` carries the yes/no; do not infer it from the
    clamped number.
    """
    until = revocable_until(generated_at, window_hours=window_hours)
    moment = _as_aware(now, field="now")
    remaining = (until - moment).total_seconds()
    return {
        "revocable_until": until,
        "is_revocable": moment < until,
        "seconds_left": max(0, int(remaining)),
        "window_hours": window_hours,
    }


# ── the UDIN string itself: described, never rejected ───────────────────────

def udin_syntax(
    udin: Any,
    *,
    signed_on: Any = None,
    membership_no: str = "",
) -> dict[str, Any]:
    """Describe a UDIN string. ADVISORY ONLY — this never raises and never bars.

    A CHECK constraint or a validator that encoded the published syntax would
    refuse to record a REAL UDIN the day ICAI changes its generator, and a
    register that cannot record the truth is worse than one that records it with
    a note attached. This is the same rule that keeps GSTIN, PAN and TAN
    non-mandatory in this product, and that rule has regressed twice.

    `notes` is a list of plain sentences a person can read. An empty list means
    nothing looked odd; it does NOT mean the number is genuine, which only the
    ICAI portal can say.
    """
    text = ("" if udin is None else str(udin)).strip().upper()
    out: dict[str, Any] = {
        "udin": text,
        "is_present": bool(text),
        "matches_published_syntax": False,
        "year_2digit": "",
        "membership_no": "",
        "notes": [],
    }
    if not text:
        return out

    if len(text) != 18:
        out["notes"].append(
            f"A UDIN is 18 characters; this one is {len(text)}."
        )
    match = _UDIN_RE.match(text)
    if match is None:
        out["notes"].append(
            "This does not match the published UDIN syntax "
            "(2 digits of the year, 6-digit membership number, 10 alphanumerics). "
            "It has been recorded as entered."
        )
        return out

    out["matches_published_syntax"] = True
    out["year_2digit"] = match.group("yy")
    out["membership_no"] = match.group("mrn")

    wanted = re.sub(r"\D", "", str(membership_no or ""))
    if wanted and wanted.zfill(6) != match.group("mrn"):
        # Digits 3-8 of a UDIN ARE the generating member's ICAI membership
        # number, so this catches a UDIN pasted from the wrong member's portal
        # session — the realistic error in a firm with four partners, and one
        # that nothing else in the world would catch.
        out["notes"].append(
            f"The membership number inside this UDIN is {match.group('mrn')}, "
            f"but the register records the signing member as {wanted.zfill(6)}. "
            "Only the member who generated a UDIN can revoke it."
        )

    if signed_on is not None:
        try:
            signed = _as_date(signed_on, field="signed_on")
        except UdinError:
            signed = None
        if signed is not None:
            # The first two digits are the last two of the year of GENERATION,
            # not of signing — and the window is 60 days, so a December signing
            # legitimately carries the following year's digits. Only a value
            # that is neither year is worth mentioning.
            plausible = {f"{signed.year % 100:02d}", f"{(signed.year + 1) % 100:02d}"}
            if match.group("yy") not in plausible:
                out["notes"].append(
                    f"This UDIN begins {match.group('yy')}, which is neither "
                    f"{signed.year} nor {signed.year + 1}; the document is "
                    f"recorded as signed on {signed.isoformat()}."
                )
    return out


# ── the windows, read from the database ─────────────────────────────────────

# No parameters, and no date predicate. `staging.udin_window` holds one row per
# version of one window — two today, a handful ever — so the SQL fetches all of
# them and `_resolve_window` decides which is in force. That is the same
# division `services/statute.py` makes, for the same two reasons: there is then
# exactly ONE implementation of "which version applies", and it is testable
# without a database. A date predicate pushed into this SQL would be asserted by
# nothing, because the suite's pool is a MagicMock.
_SELECT_WINDOWS = (
    "SELECT window_key, window_amount, window_unit, effective_from, effective_to "
    "  FROM staging.udin_window "
    " ORDER BY window_key, effective_from"
)


def _covers(row: dict, as_of: date) -> bool:
    """Half-open [effective_from, effective_to). `effective_to` is the first day
    the fact is NOT true — identical to `services/statute.py`, deliberately, so
    two resolvers cannot disagree about an inclusive end date."""
    start = row.get("effective_from")
    end = row.get("effective_to")
    if start is None:
        return False
    start = _as_date(start, field="effective_from")
    if as_of < start:
        return False
    if end is None:
        return True
    return as_of < _as_date(end, field="effective_to")


def _resolve_window(
    rows: Iterable[dict], key: str, unit: str, as_of: date
) -> dict | None:
    """The row for `key` in force on `as_of`, latest `effective_from` wins.

    A row whose `window_unit` disagrees with what the caller asked for is
    SKIPPED, not used. Migration 161 stores the unit next to the amount
    precisely so that 48 hours can never be read as 48 days; honouring that
    means refusing the row rather than trusting the number.
    """
    best: dict | None = None
    for row in rows:
        if row.get("window_key") != key or row.get("window_unit") != unit:
            continue
        if not _covers(row, as_of):
            continue
        amount = row.get("window_amount")
        if not isinstance(amount, int) or amount < 1:
            continue
        if best is None or _as_date(row["effective_from"], field="effective_from") > _as_date(
            best["effective_from"], field="effective_from"
        ):
            best = row
    return best


async def load_windows(pool, *, as_of: Any) -> UdinWindows:
    """The two windows in force on `as_of`.

    `as_of` is keyword-only and has NO DEFAULT, for the reason
    `services/statute.py` spells out at length: a window read "as of today" is
    the wrong window for a document signed last November, and a default that
    silently means today reintroduces exactly the staleness the table exists to
    remove.

    Falls back to the ICAI constants — and says so in `generate_source` /
    `revoke_source` — when `staging.udin_window` does not exist (migration 161
    unapplied), is empty, or has no row covering `as_of`. The fallback is what
    makes the whole register usable before the migration is applied, which
    matters because applying it is a production change on a shared database and
    is not this module's decision to make.
    """
    stamp = _as_date(as_of, field="as_of")
    try:
        records = await pool.fetch(_SELECT_WINDOWS)
    except asyncpg.PostgresError:
        # UndefinedTableError is the expected one (161 not applied yet). Any
        # other Postgres error here is also survivable: the constants are right
        # today, and a compliance list that refuses to render because a policy
        # table hiccuped is worse than one that renders with the published
        # numbers and says where they came from. This read is never inside a
        # caller's transaction, so swallowing it cannot leave an aborted one.
        return UdinWindows()

    rows = [dict(r) for r in (records or [])]
    windows = UdinWindows()

    gen = _resolve_window(rows, "generate", "days", stamp)
    if gen is not None:
        windows = replace(
            windows, generate_days=gen["window_amount"], generate_source="table"
        )
    rev = _resolve_window(rows, "revoke", "hours", stamp)
    if rev is not None:
        windows = replace(
            windows, revoke_hours=rev["window_amount"], revoke_source="table"
        )
    return windows


# ── the at-risk list ────────────────────────────────────────────────────────

# `status = 'signed'` is exactly `idx_udin_register_open`'s predicate and
# (org_id, signed_on) is its key, so this is an index-only-ish scan of the open
# work rather than of the register.
#
# ORDER BY signed_on ASC IS least-time-left-first: every open row shares the
# same window, so the oldest signing has the nearest deadline. `document_title`
# breaks the tie, so two documents signed the same day come back in a stable
# order and a paged caller cannot see one twice and another never.
#
# THE TWO DATE BOUNDS ARE COMPUTED IN PYTHON AND BOUND AS PARAMETERS. That is
# what lets `LIMIT` be honest: no row is dropped after the limit is applied, so
# what comes back is genuinely the N most urgent. Both are cast — `$2::date`,
# not `$2` — because PgBouncer turns an untyped parameter in an `IS NULL`
# comparison into a parse error and an instant 500, which has cost this repo a
# real incident (untyped `$1 + $2` in the credits ledger).
_SELECT_OPEN = (
    "SELECT id, client_name, document_kind, document_title, document_ref, "
    "       financial_year, signed_on, signed_by_member, signed_by_membership_no, "
    "       source_module, notes "
    "  FROM staging.udin_register "
    " WHERE org_id = $1::uuid "
    "   AND status = 'signed' "
    "   AND ($2::date IS NULL OR signed_on >= $2::date) "
    "   AND ($3::date IS NULL OR signed_on <= $3::date) "
    " ORDER BY signed_on ASC, document_title ASC "
    " LIMIT $4::int"
)


def _describe(row: dict, *, as_of: date, window_days: int) -> dict[str, Any]:
    """One register row plus everything the window says about it.

    Returns a NEW dict listing its fields explicitly rather than mutating the
    row, so that adding a column to `staging.udin_register` cannot silently
    start leaking it — `client_id`, `org_id` and `signed_by_user_id` are on that
    table and must never reach a caller. See NAMES, NOT IDS in the docstring.
    """
    signed = _as_date(row["signed_on"], field="signed_on")
    day = day_of_window(signed, as_of)
    started = day >= 1
    remaining = days_left(signed, as_of, window_days=window_days)
    kind = row.get("document_kind") or ""
    return {
        "id": row.get("id"),
        "client_name": row.get("client_name") or "",
        "document_kind": kind,
        "document_kind_label": DOCUMENT_KINDS.get(kind, {}).get("label", kind),
        "document_title": row.get("document_title") or "",
        "document_ref": row.get("document_ref") or "",
        "financial_year": row.get("financial_year") or "",
        "signed_on": signed,
        "signed_by_member": row.get("signed_by_member") or "",
        "signed_by_membership_no": row.get("signed_by_membership_no") or "",
        "source_module": row.get("source_module") or "",
        "notes": row.get("notes") or "",
        # The window, all of it derived, none of it stored.
        "generate_by": generation_deadline(signed, window_days=window_days),
        "day_of_window": day,
        "window_days": window_days,
        "days_left": remaining,
        "is_lapsed": is_lapsed(signed, as_of, window_days=window_days),
        "urgency": urgency(remaining, started=started),
    }


async def at_risk(
    pool,
    org_id: Any,
    *,
    as_of: Any,
    windows: UdinWindows | None = None,
    within_days: int | None = None,
    include_lapsed: bool = True,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """Signed, no UDIN, day N of the window — most urgent first.

    THE QUERY THIS MODULE EXISTS FOR.

    `as_of` is keyword-only and has no default: the answer is a function of the
    date you are asking about, and a caller that has not decided what date that
    is has not decided what it is asking.

    `within_days` keeps only rows whose deadline falls on or before
    `as_of + within_days`; 0 means "due today or already lapsed".
    `include_lapsed=False` drops rows already past their deadline — those are
    the ones nothing can be done about, and a firm working a queue may want them
    out of the way. Both are turned into SIGNING-DATE BOUNDS here and applied in
    SQL, never after the LIMIT, so a capped list is still the most urgent N and
    not an arbitrary N.

    `windows` lets a caller that has already resolved the windows (a summary, a
    digest that renders several orgs) avoid re-reading them per call. Omit it
    and this reads them for `as_of`.
    """
    if windows is None:
        windows = await load_windows(pool, as_of=as_of)
    stamp = _as_date(as_of, field="as_of")
    window_days = windows.generate_days

    # Lapsed rows are the ones whose deadline is already behind `as_of`, so
    # excluding them is a LOWER bound on the signing date. Expressed through the
    # inverse of the one deadline function, so this bound and the `is_lapsed`
    # flag on each returned row cannot disagree.
    lower = None if include_lapsed else signed_on_for_deadline(
        stamp, window_days=window_days
    )
    upper = None
    if within_days is not None:
        if within_days < 0:
            raise UdinError(f"within_days must not be negative, got {within_days}")
        upper = signed_on_for_deadline(
            stamp + timedelta(days=within_days), window_days=window_days
        )

    if limit < 1:
        raise UdinError(f"limit must be at least 1, got {limit}")

    records = await pool.fetch(
        _SELECT_OPEN, str(org_id), lower, upper, int(limit)
    )
    rows = [
        _describe(dict(r), as_of=stamp, window_days=window_days)
        for r in (records or [])
    ]
    # The SQL order is already correct (see the comment on _SELECT_OPEN); this
    # re-sort is on the DERIVED deadline so that the ordering stays right even
    # if a future version ever resolves a per-row window. Stable, and it agrees
    # with the SQL today — a test asserts that it does not reshuffle.
    rows.sort(key=lambda r: (r["generate_by"], r["signed_on"], r["document_title"]))
    return rows


# ── the 48-hour list ────────────────────────────────────────────────────────

# `status = 'generated'` is `idx_udin_register_revocable`'s predicate.
#
# THE CUTOFF IS COMPUTED IN PYTHON AND BOUND, not written as `now() - interval
# '48 hours'`. Three reasons: the interval would hardcode a Council decision
# into SQL where `udin_window` could never override it; `now()` is the database
# server's clock rather than the one the caller is reasoning with; and a bound
# parameter is assertable by a test against a mock pool, which a literal is not.
# The cutoff is deliberately GENEROUS by one window — it only narrows the scan,
# and the yes/no is decided in Python by `is_revocable`, so a clock skew between
# the app and the database can never silently drop a row that is still revocable.
_SELECT_REVOCABLE = (
    "SELECT id, client_name, document_kind, document_title, document_ref, "
    "       financial_year, signed_on, signed_by_member, signed_by_membership_no, "
    "       udin, udin_generated_at "
    "  FROM staging.udin_register "
    " WHERE org_id = $1::uuid "
    "   AND status = 'generated' "
    "   AND udin_generated_at >= $2::timestamptz "
    " ORDER BY udin_generated_at DESC "
    " LIMIT $3::int"
)


async def revocable_now(
    pool,
    org_id: Any,
    *,
    now: Any,
    windows: UdinWindows | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """Every UDIN this firm can still revoke, soonest to expire first.

    A revocation is not an undo. FAQ Q127: a revoked UDIN cannot be regenerated
    on the old signature date beyond the 60 days, and FAQ Q124: a member who
    misses the 48 hours must generate a FRESH UDIN within the time still
    running. So this list is a genuine deadline, not a convenience — and it is
    ordered by `seconds_left` ascending because the only useful question is
    "what runs out first".

    Only the member who generated a UDIN can revoke it (FAQ Q151), which is why
    every row carries `signed_by_member` by name.
    """
    if windows is None:
        windows = await load_windows(pool, as_of=_as_aware(now, field="now").date())
    moment = _as_aware(now, field="now")
    if limit < 1:
        raise UdinError(f"limit must be at least 1, got {limit}")

    cutoff = moment - timedelta(hours=windows.revoke_hours)
    records = await pool.fetch(_SELECT_REVOCABLE, str(org_id), cutoff, int(limit))

    out: list[dict[str, Any]] = []
    for record in records or []:
        row = dict(record)
        generated_at = row.get("udin_generated_at")
        if generated_at is None:
            # The CHECK on `staging.udin_register` makes this impossible for a
            # 'generated' row. Skipping rather than raising, because a register
            # that will not render at all is a worse failure than one that omits
            # a row the schema says cannot exist.
            continue
        window = revocation_window(
            generated_at, now=moment, window_hours=windows.revoke_hours
        )
        if not window["is_revocable"]:
            continue
        out.append(
            {
                "id": row.get("id"),
                "client_name": row.get("client_name") or "",
                "document_kind": row.get("document_kind") or "",
                "document_title": row.get("document_title") or "",
                "document_ref": row.get("document_ref") or "",
                "financial_year": row.get("financial_year") or "",
                "signed_on": _as_date(row["signed_on"], field="signed_on"),
                "signed_by_member": row.get("signed_by_member") or "",
                "signed_by_membership_no": row.get("signed_by_membership_no") or "",
                "udin": row.get("udin") or "",
                "udin_generated_at": _as_aware(
                    generated_at, field="udin_generated_at"
                ),
                "revocable_until": window["revocable_until"],
                "seconds_left": window["seconds_left"],
                "window_hours": window["window_hours"],
            }
        )
    out.sort(key=lambda r: (r["seconds_left"], r["document_title"]))
    return out


# ── the summary ─────────────────────────────────────────────────────────────

_SELECT_STATUS_COUNTS = (
    "SELECT status, count(*) AS n "
    "  FROM staging.udin_register "
    " WHERE org_id = $1::uuid "
    " GROUP BY status"
)

# NO LIMIT, and that is deliberate: this feeds counts, and a count that silently
# caps is a lie of exactly the kind a compliance register must never tell. It
# selects `signed_on` alone so the row is tiny, and it rides
# `idx_udin_register_open`, whose predicate this WHERE clause is.
_SELECT_OPEN_DATES = (
    "SELECT signed_on "
    "  FROM staging.udin_register "
    " WHERE org_id = $1::uuid AND status = 'signed'"
)


async def register_summary(
    pool,
    org_id: Any,
    *,
    as_of: Any,
    windows: UdinWindows | None = None,
) -> dict[str, Any]:
    """Counts by status, and the open work bucketed by how much time is left.

    `lapsed` is the number that matters and the reason this is not just a status
    breakdown: it is not a status, it cannot be one (see STATUSES), and it is
    the only figure here that represents something already unfixable.
    """
    if windows is None:
        windows = await load_windows(pool, as_of=as_of)
    stamp = _as_date(as_of, field="as_of")
    window_days = windows.generate_days

    status_rows = await pool.fetch(_SELECT_STATUS_COUNTS, str(org_id))
    by_status = {s: 0 for s in STATUSES}
    for record in status_rows or []:
        row = dict(record)
        status = row.get("status")
        if status in by_status:
            by_status[status] = int(row.get("n") or 0)

    open_rows = await pool.fetch(_SELECT_OPEN_DATES, str(org_id))
    buckets = {"not_started": 0, "lapsed": 0, "last_day": 0, "critical": 0,
               "due_soon": 0, "open": 0}
    soonest: date | None = None
    for record in open_rows or []:
        signed = _as_date(dict(record)["signed_on"], field="signed_on")
        day = day_of_window(signed, stamp)
        remaining = days_left(signed, stamp, window_days=window_days)
        buckets[urgency(remaining, started=day >= 1)] += 1
        deadline = generation_deadline(signed, window_days=window_days)
        if remaining >= 0 and (soonest is None or deadline < soonest):
            soonest = deadline

    return {
        "as_of": stamp,
        "by_status": by_status,
        "open_by_urgency": buckets,
        "open_total": sum(buckets.values()),
        "lapsed": buckets["lapsed"],
        "next_deadline": soonest,
        "window_days": window_days,
        "revoke_window_hours": windows.revoke_hours,
        "window_sources": windows.sources,
    }
