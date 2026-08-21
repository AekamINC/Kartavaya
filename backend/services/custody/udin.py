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


# ══════════════════════════════════════════════════════════════════════════════
#  THE WRITE PATH
#
#  Added 2026-08-21. Until then this module read a table that nothing could
#  write, and `staging.udin_register` held 0 rows — so the at-risk list this
#  whole module exists to serve had nothing to be at risk about.
#
#  ── THE CLOCK COMES FROM THE SERVER, ALWAYS ─────────────────────────────────
#
#  Every function below takes `now` as a keyword with NO DEFAULT, and every
#  caller in this repo passes `datetime.now(timezone.utc)`. It is not a request
#  parameter and must never become one. Both windows are deadlines a firm would
#  rather had not closed, and a deadline a caller can move is not a deadline:
#  a browser with a wrong clock would be told it can still revoke something it
#  cannot, and a revocation is not an undo — past the window the member has to
#  generate a FRESH UDIN inside whatever is left of the sixty days (FAQ Q124).
#
#  `record_generation` accepts an OPTIONAL `generated_at`, and that is not a
#  hole in the rule. A UDIN generated on the portal on day 55 and typed into
#  this register on day 57 was generated on day 55, and a register that cannot
#  record that would push people to lie about the signing date instead. So:
#
#      · `now` — the server's, always — is the CEILING. A `generated_at` after
#        it is refused outright: a UDIN generated in the future is not a fact.
#      · A `generated_at` in the past can only SHORTEN the 48-hour revocation
#        window it starts. Nobody can buy time with it, which is the only
#        direction that matters.
#      · Omit it and the server stamps `now`, which is the ordinary case: "I
#        have just generated this, here is the number".
#
#  ── BOTH WINDOWS COME FROM `staging.udin_window`, NEVER FROM A CONSTANT ─────
#
#  `load_windows` is called by every write that has a deadline in it, and the
#  numbers it returns are what the arithmetic uses. The constants at the top of
#  this file are the FALLBACK for a database that has not been seeded, not a
#  default to reach for: the generation window has already moved once (15 days
#  to 60, Council's 405th meeting, 17 September 2021) and the next Council
#  decision must be an INSERT rather than a deploy.
#
#  ── WHAT EACH WRITE REFUSES ─────────────────────────────────────────────────
#
#   * `record_signing` refuses a signing dated in the future and NOTHING about
#     the window. A document signed ninety days ago with no UDIN is exactly
#     what `at_risk` and `lapsed` exist to show; refusing to record it would
#     make the backlog invisible, which is the failure the register prevents.
#   * `record_generation` refuses once the 60-day window has closed. That is the
#     one genuinely statutory refusal here — the portal itself will not issue a
#     number, so recording one would be recording something that did not happen.
#   * `record_revocation` refuses once the 48 hours are up, for the same reason,
#     and quotes FAQ Q124 on what to do instead.
#   * None of them touches `status` as an input. The status is a consequence of
#     which function was called, and the four CHECK constraints on the table
#     (`udin_register_signed_ck` and its three siblings) tie it to the facts.
# ══════════════════════════════════════════════════════════════════════════════

#: The COLUMN's own bar, from `udin_register_udin_shape_ck`: 18 alphanumerics,
#: or absent. DISTINCT FROM `_UDIN_RE`, which describes ICAI's published
#: internal syntax and is advisory only — a UDIN that does not match `_UDIN_RE`
#: is recorded as entered, with a note. This one has to be enforced before the
#: write, because a CheckViolation surfaces as a 500 with no useful message.
_UDIN_COLUMN_RE = re.compile(r"^[0-9A-Za-z]{18}$")

#: '' or '2025-26'. `udin_register_fy_ck`. Permissive on purpose; a
#: wrong-looking financial year must not stop a firm recording that a document
#: was signed.
_FY_RE = re.compile(r"^[0-9]{4}-[0-9]{2}$")

#: What a caller is told when the row is not in the state the call needs. Keyed
#: by the status the row is ACTUALLY in, because that is the thing the person
#: does not know — "this is not signed" is useless, "this already carries a
#: UDIN" is actionable.
_WRONG_STATE: dict[str, str] = {
    "generated": (
        "This document already carries a UDIN. A second number on one signature "
        "is what the register's unique index exists to prevent; nothing was "
        "changed."
    ),
    "revoked": (
        "This UDIN has been revoked. FAQ Q127: a revoked UDIN cannot be "
        "regenerated on the old signature date, and FAQ Q124 says the member "
        "must generate a fresh one inside whatever is left of the sixty days — "
        "record that as a new signing rather than reusing this row."
    ),
    "not_required": (
        "This document is recorded as not requiring a UDIN. If that was wrong, "
        "record the signing again rather than reviving this row — the register "
        "is a log, and a row that changes its mind is a row nobody can audit."
    ),
    "signed": (
        "This document has no UDIN yet, so there is nothing to act on. Generate "
        "one first."
    ),
}


def _required_text(value: Any, *, field: str, limit: int = 512) -> str:
    """A non-blank string, trimmed. `''` and `'   '` are refused alike.

    Three columns on this table carry a `length(btrim(...)) > 0` CHECK —
    `client_name`, `document_title`, `signed_by_member` — and a blank passes
    NOT NULL. The register's whole value is that a person can read those three
    off a row.
    """
    text = "" if value is None else str(value).strip()
    if not text:
        raise UdinError(f"{field} is required and must not be blank.")
    if len(text) > limit:
        raise UdinError(f"{field} is longer than {limit} characters.")
    return text


def _plain_text(value: Any, *, field: str, limit: int = 4000) -> str:
    """A trimmed string, or `''`.

    `''` and NOT None: every optional text column on this table is `NOT NULL
    DEFAULT ''` (migration 106's rule — one absent value, so no caller has to
    test for NULL and '' both).
    """
    text = "" if value is None else str(value).strip()
    if len(text) > limit:
        raise UdinError(f"{field} is longer than {limit} characters.")
    return text


def _note_line(text: Any, *, on: date, what: str) -> str:
    """One dated sentence to APPEND to `notes`. Empty when there is nothing to say."""
    body = "" if text is None else str(text).strip()
    if not body:
        return ""
    return f"[{on.isoformat()}] {what}: {body}"


def _clean_udin(value: Any, *, field: str = "udin") -> str:
    """The number as it will be stored: trimmed and UPPER-CASED.

    CASE-FOLDING IS NOT THE SYNTAX CHECK THIS MODULE REFUSES TO MAKE. A UDIN's
    alphabetic part is upper-case by construction (FAQ Q4: two digits of the
    year, six digits of the membership number, ten upper-case alphanumerics), so
    folding destroys nothing a real number carries. What it prevents is real:
    `uq_udin_register_udin` is on the raw text, so 'abc…' and 'ABC…' would be
    two rows, and one document would look numbered twice.

    The 18-character bar IS enforced, because the column's CHECK enforces it and
    a CheckViolation is a 500 with nothing readable in it. The INTERNAL syntax
    is not enforced and never will be — see `udin_syntax`.
    """
    text = _required_text(value, field=field, limit=64).upper()
    if not _UDIN_COLUMN_RE.match(text):
        raise UdinError(
            f"{field} must be 18 letters or digits — that is the column's own "
            f"bar, and this one is {len(text)} character"
            f"{'' if len(text) == 1 else 's'}. Nothing about the INTERNAL "
            "shape of the number is checked: a UDIN that does not match ICAI's "
            "published syntax is recorded exactly as entered, with a note."
        )
    return text


# ── the statements ───────────────────────────────────────────────────────────
#
# EVERY PARAMETER IS CAST, and no statement here does date arithmetic. Both
# rules are the ones the read API already keeps and both matter more on a write:
# an untyped parameter reaching PgBouncer is a parse error and an instant 500,
# and a window written into SQL would be a second implementation of ICAI's
# arithmetic that no test could reach, because this suite's pool is a mock.

#: The columns a write hands back. `_describe`'s inputs, plus the four that say
#: where in the lifecycle the row now is. `client_id`, `org_id` and
#: `signed_by_user_id` are NOT among them — see NAMES, NOT IDS.
_WRITE_RETURNING = (
    "id, client_name, document_kind, document_title, document_ref, "
    "financial_year, signed_on, signed_by_member, signed_by_membership_no, "
    "source_module, notes, "
    "status, udin, udin_generated_at, revoked_at, revocation_reason, "
    "replaced_by_udin"
)

#: THE TENANCY PROOF IS THE `WHERE`, which is why this is an INSERT … SELECT and
#: not an INSERT … VALUES: the statement itself proves the client being attached
#: belongs to the org doing the attaching, so there is no window between a check
#: and a write in which the answer could change.
#:
#: `client_name` is a SNAPSHOT and not a join — migration 161 says why: the name
#: on a signed document is the name as it was on the day it was signed, and a
#: company that renames itself must not retrospectively rename what the firm
#: certified. When the caller gives a client but no name, the snapshot is taken
#: from that org's own company row, in this statement, so the two cannot
#: disagree.
#:
#: `status` is the literal 'signed'. A register row is BORN UNNUMBERED; there is
#: no parameter for it, and `udin_register_signed_ck` says the same thing in the
#: database.
_INSERT_SIGNING = (
    "INSERT INTO staging.udin_register "
    "  (org_id, client_id, client_name, document_kind, document_title, "
    "   document_ref, financial_year, signed_on, signed_by_member, "
    "   signed_by_membership_no, signed_by_user_id, source_module, source_id, "
    "   notes, created_by, status) "
    "SELECT $1::uuid, $2::uuid, "
    "       COALESCE(NULLIF(btrim($3::text), ''), "
    "                (SELECT c.name FROM staging.graha_clients c "
    "                  WHERE c.id = $2::uuid AND c.org_id = $1::uuid)), "
    "       $4::text, $5::text, "
    "       $6::text, $7::text, $8::date, $9::text, "
    "       $10::text, $11::text, $12::text, $13::uuid, "
    "       $14::text, $15::text, 'signed' "
    " WHERE $2::uuid IS NULL "
    "    OR EXISTS (SELECT 1 FROM staging.graha_clients c "
    "                WHERE c.id = $2::uuid AND c.org_id = $1::uuid) "
    "RETURNING " + _WRITE_RETURNING
)

#: One row, by id, inside one org. Read before every lifecycle write so that a
#: refusal can name the state the row is actually in — `_WRONG_STATE` — rather
#: than reporting a missed `WHERE` as "nothing happened".
#:
#: Named `_SELECT_…` deliberately: `tests/test_udin_register.py` walks every
#: `_SELECT*` string in this module and asserts the tenant predicate, the casts,
#: the schema qualification, the absence of date arithmetic and the absence of
#: any client or user identifier in the select list. All five hold here, and
#: being inside that net is worth more than a name that ducks it.
_SELECT_ROW_FOR_WRITE = (
    "SELECT id, client_name, document_kind, document_title, document_ref, "
    "       financial_year, signed_on, signed_by_member, "
    "       signed_by_membership_no, source_module, notes, "
    "       status, udin, udin_generated_at, revoked_at "
    "  FROM staging.udin_register "
    " WHERE org_id = $1::uuid AND id = $2::uuid"
)

#: `AND status = 'signed'` in the WHERE, not only in Python. The Python check is
#: what produces the sentence; this is what stops two people generating two
#: numbers against one signature when they press the button at the same moment.
_UPDATE_GENERATION = (
    "UPDATE staging.udin_register "
    "   SET status = 'generated', "
    "       udin = $3::text, "
    "       udin_generated_at = $4::timestamptz, "
    "       notes = CASE WHEN $5::text = '' THEN notes "
    "                    ELSE btrim(concat_ws(chr(10), "
    "                                         NULLIF(btrim(notes), ''), "
    "                                         $5::text)) END "
    " WHERE org_id = $1::uuid AND id = $2::uuid AND status = 'signed' "
    "RETURNING " + _WRITE_RETURNING
)

#: `revocation_reason` is a column of its own and is REPLACED rather than
#: appended, because a row can only be revoked once — the WHERE says so — so
#: there is never a previous reason to lose.
_UPDATE_REVOCATION = (
    "UPDATE staging.udin_register "
    "   SET status = 'revoked', "
    "       revoked_at = $3::timestamptz, "
    "       revocation_reason = $4::text, "
    "       replaced_by_udin = $5::text, "
    "       notes = CASE WHEN $6::text = '' THEN notes "
    "                    ELSE btrim(concat_ws(chr(10), "
    "                                         NULLIF(btrim(notes), ''), "
    "                                         $6::text)) END "
    " WHERE org_id = $1::uuid AND id = $2::uuid AND status = 'generated' "
    "RETURNING " + _WRITE_RETURNING
)

#: 'not_required' is how a signing leaves the backlog HONESTLY. Without it the
#: only ways off the at-risk list are a real UDIN or a lapse, so a document that
#: never carried the duty in the first place would nag for ever — and a list
#: that nags about things nobody can fix is a list people stop reading.
_UPDATE_NOT_REQUIRED = (
    "UPDATE staging.udin_register "
    "   SET status = 'not_required', "
    "       notes = CASE WHEN $3::text = '' THEN notes "
    "                    ELSE btrim(concat_ws(chr(10), "
    "                                         NULLIF(btrim(notes), ''), "
    "                                         $3::text)) END "
    " WHERE org_id = $1::uuid AND id = $2::uuid AND status = 'signed' "
    "RETURNING " + _WRITE_RETURNING
)


def _describe_written(
    row: dict, *, as_of: date, now: datetime, window_days: int,
    window_hours: int,
) -> dict[str, Any]:
    """One written row, described the way a read describes it, plus its state.

    Built on `_describe` rather than beside it, so the deadline arithmetic a
    caller sees after a write is the same arithmetic it sees in the list — one
    implementation, in one place, exactly as the module docstring insists.
    """
    out = _describe(row, as_of=as_of, window_days=window_days)
    status = row.get("status") or ""
    number = row.get("udin") or ""
    generated_at = row.get("udin_generated_at")
    out["status"] = status
    out["udin"] = number
    out["udin_generated_at"] = (
        None if generated_at is None
        else _as_aware(generated_at, field="udin_generated_at")
    )
    out["revoked_at"] = (
        None if row.get("revoked_at") is None
        else _as_aware(row["revoked_at"], field="revoked_at")
    )
    out["revocation_reason"] = row.get("revocation_reason") or ""
    out["replaced_by_udin"] = row.get("replaced_by_udin") or ""
    # The 48-hour countdown, for a caller that has just generated a number and
    # is about to be asked whether it wants to take it back.
    out["revocation"] = (
        revocation_window(generated_at, now=now, window_hours=window_hours)
        if status == "generated" and generated_at is not None
        else None
    )
    # ADVISORY, as everywhere else. Catching a UDIN pasted from another
    # partner's portal session is the point — digits 3-8 ARE the generating
    # member's membership number, and only that member can revoke it.
    out["syntax"] = (
        udin_syntax(number, signed_on=out["signed_on"],
                    membership_no=out.get("signed_by_membership_no", ""))
        if number else None
    )
    return out


def _refuse_wrong_state(status: str, *, wanted: str) -> None:
    raise UdinError(
        _WRONG_STATE.get(
            status,
            f"This row is in state {status!r} and this call needs {wanted!r}.",
        )
    )


# ── the write API ────────────────────────────────────────────────────────────

async def record_signing(
    pool,
    org_id: Any,
    *,
    now: Any,
    document_kind: str,
    document_title: Any,
    signed_on: Any,
    signed_by_member: Any,
    client_name: Any = "",
    client_id: Any = None,
    document_ref: Any = "",
    financial_year: Any = "",
    signed_by_membership_no: Any = "",
    signed_by_user_id: Any = "",
    source_module: Any = "",
    source_id: Any = None,
    notes: Any = "",
    created_by: Any = "",
    windows: UdinWindows | None = None,
    status: Any = None,
    udin: Any = None,
) -> dict[str, Any] | None:
    """Record a document as signed and unnumbered. The row the backlog is made of.

    THE WINDOW IS NOT CHECKED HERE AND MUST NOT BE. A document signed ninety
    days ago with no UDIN is precisely what `at_risk` and the `lapsed` count
    exist to show, and a firm typing up its backlog is entering exactly those.
    Refusing them would make the unfixable part of the exposure invisible, which
    is the one failure a compliance register may not have.

    What IS refused is a signing dated in the FUTURE, measured against the
    server's clock. A document signed tomorrow is not signed, `day_of_window`
    would report day 0 or less, and the row would sit in the list as
    `not_started` — a real state, but not one anybody should be able to type
    into the register on purpose.

    `client_name` is a SNAPSHOT taken at signing, not a join. Give a name, or
    give a `client_id` and the org's own company row supplies it. Give neither
    and this refuses: `udin_register_client_name_ck` requires a non-blank name,
    and a certificate whose subject cannot be read off the row is not a record.

    Returns None when `client_id` names a company that is not this org's — a
    refusal, and not "already exists".
    """
    moment = _as_aware(now, field="now")
    today = moment.date()
    if windows is None:
        windows = await load_windows(pool, as_of=today)

    if status is not None:
        raise UdinError(
            "status is not an input. A register row is born unnumbered — the "
            "status follows from which call was made, and the table's four "
            "CHECK constraints tie it to the facts. Call record_generation to "
            "attach a number, or mark_not_required if the document never "
            "carried the duty."
        )
    if udin is not None:
        raise UdinError(
            "A signing is recorded without a number. If the UDIN already "
            "exists, record the signing first and then call record_generation "
            "with it — the 60-day window is measured from the signing date, and "
            "recording both in one step would leave nothing to measure."
        )

    kind = str(document_kind or "").strip().lower()
    if kind not in DOCUMENT_KINDS:
        raise UdinError(
            f"document_kind must be one of {list(DOCUMENT_KINDS)} "
            f"(got {document_kind!r}). Those are ICAI's own three mandatory "
            "categories and the three the portal itself splits on."
        )

    title = _required_text(document_title, field="document_title", limit=512)
    member = _required_text(signed_by_member, field="signed_by_member",
                            limit=256)
    signed = _as_date(signed_on, field="signed_on")
    if signed > today:
        raise UdinError(
            f"signed_on ({signed.isoformat()}) is in the future. A document "
            "signed tomorrow is not signed, and the generation window has "
            "nothing to run from."
        )

    name = _plain_text(client_name, field="client_name", limit=256)
    target = _plain_text(client_id, field="client_id", limit=64) or None
    if not name and target is None:
        raise UdinError(
            "client_name is required — it is the snapshot of whose document "
            "this is, taken on the day it was signed. Give a name, or give a "
            "client and the company row supplies one."
        )

    fy = _plain_text(financial_year, field="financial_year", limit=16)
    if fy and not _FY_RE.match(fy):
        raise UdinError(
            f"financial_year must look like '2026-27' (got {fy!r}). It is "
            "optional and blocks nothing when it is left empty."
        )

    record = await pool.fetchrow(
        _INSERT_SIGNING,
        str(org_id),
        target,
        name,
        kind,
        title,
        _plain_text(document_ref, field="document_ref", limit=256),
        fy,
        signed,
        member,
        # The ICAI membership number is printed on the document and embedded in
        # the UDIN itself. It is not a system identifier, it is optional, and it
        # blocks nothing — exactly like GSTIN, PAN and TAN.
        _plain_text(signed_by_membership_no, field="signed_by_membership_no",
                    limit=32),
        _plain_text(signed_by_user_id, field="signed_by_user_id", limit=128),
        _plain_text(source_module, field="source_module", limit=64),
        _plain_text(source_id, field="source_id", limit=64) or None,
        _plain_text(notes, field="notes", limit=4000),
        _plain_text(created_by, field="created_by", limit=128),
    )
    if record is None:
        return None
    return _describe_written(
        dict(record), as_of=today, now=moment,
        window_days=windows.generate_days, window_hours=windows.revoke_hours,
    )


async def record_generation(
    pool,
    org_id: Any,
    entry_id: Any,
    *,
    udin: Any,
    now: Any,
    generated_at: Any = None,
    note: Any = None,
    windows: UdinWindows | None = None,
) -> dict[str, Any] | None:
    """Attach a UDIN to a signed document, inside the 60-day window.

    THE ONE STATUTORY REFUSAL IN THIS MODULE. Past the window the ICAI portal
    itself will not issue a number, so a register that accepted one would be
    recording something that did not happen — and the row would leave the
    `lapsed` count, which is the only figure here representing something already
    unfixable.

    The window is `windows.generate_days`, read from `staging.udin_window`, and
    the deadline is `signed_on + (window_days - 1)`: FAQ Q19 counts BOTH the
    date of signing and the date of generation, so sixty days from the 1st ends
    on the 29th of the following month. `days_left == 0` is the last day and is
    NOT lapsed.

    `generated_at` is optional and bounded on both sides — see THE CLOCK COMES
    FROM THE SERVER above. It may not be later than the server's `now`, and it
    may not precede `signed_on` by more than a day (`udin_register_order_ck`
    allows exactly that much slack, because `signed_on` has no time and a
    document signed on the 5th in IST can carry a generation instant that is
    still the 4th in UTC).

    THE BOUNDARY IS MEASURED ON THE SERVER'S UTC DATE, which is the convention
    the whole module uses. Against IST that is generous by up to five and a half
    hours at the very end of the window — it can accept a number the portal
    would already have refused, and it can never refuse one the portal would
    have issued. That is the correct side to be wrong on: the second failure
    would block a real fact from being recorded.

    Returns None when the row is not this org's.
    """
    moment = _as_aware(now, field="now")
    today = moment.date()
    if windows is None:
        windows = await load_windows(pool, as_of=today)

    number = _clean_udin(udin)
    record = await pool.fetchrow(
        _SELECT_ROW_FOR_WRITE, str(org_id), str(entry_id)
    )
    if record is None:
        return None
    row = dict(record)
    if row.get("status") != "signed":
        _refuse_wrong_state(row.get("status") or "", wanted="signed")

    signed = _as_date(row["signed_on"], field="signed_on")
    stamped = moment if generated_at is None else _as_aware(
        generated_at, field="generated_at"
    )
    if stamped > moment:
        raise UdinError(
            "generated_at is in the future. The server's clock is the ceiling "
            "here: a UDIN generated later than now is not a fact, and a "
            "caller-supplied instant that could run ahead would hand somebody "
            "a 48-hour revocation window they do not have."
        )
    if stamped.date() < signed - timedelta(days=1):
        raise UdinError(
            f"generated_at ({stamped.date().isoformat()}) precedes the signing "
            f"date ({signed.isoformat()}). The window starts at signing; a UDIN "
            "cannot be generated before the document exists."
        )

    on = stamped.date()
    if is_lapsed(signed, on, window_days=windows.generate_days):
        deadline = generation_deadline(signed, window_days=windows.generate_days)
        late = -days_left(signed, on, window_days=windows.generate_days)
        raise UdinError(
            f"The {windows.generate_days}-day window for this signing closed on "
            f"{deadline.isoformat()} — {late} day{'' if late == 1 else 's'} ago. "
            "ICAI FAQ Q19: both the date of signing and the date of "
            "generation count, so the last permissible date is the signing date "
            f"plus {windows.generate_days - 1} days. The portal will not issue a "
            "number now, so nothing was recorded and this document stays in the "
            "lapsed count, which is where it belongs."
        )

    try:
        written = await pool.fetchrow(
            _UPDATE_GENERATION,
            str(org_id),
            str(entry_id),
            number,
            stamped,
            _note_line(note, on=today, what="UDIN generated"),
        )
    except asyncpg.UniqueViolationError as exc:
        # `uq_udin_register_udin` is (org_id, udin). Scoped to the org rather
        # than global even though a UDIN is globally unique, because a global
        # index would leak the existence of another firm's row through the
        # violation. The realistic error it catches is a copy-paste: one number
        # against two documents, which makes one of them look numbered when it
        # is not.
        raise UdinError(
            f"{number} is already recorded against another document in this "
            "practice's register. One UDIN belongs to one signature; nothing "
            "was changed."
        ) from exc

    if written is None:
        raise UdinError(
            "Somebody generated a number against this document while this one "
            "was being recorded. Nothing was changed; re-read the row first."
        )
    return _describe_written(
        dict(written), as_of=today, now=moment,
        window_days=windows.generate_days, window_hours=windows.revoke_hours,
    )


async def record_revocation(
    pool,
    org_id: Any,
    entry_id: Any,
    *,
    reason: Any,
    now: Any,
    replaced_by_udin: Any = "",
    windows: UdinWindows | None = None,
) -> dict[str, Any] | None:
    """Revoke a UDIN, inside the 48 hours that run from its generation.

    STRICTLY `now < generated_at + window_hours`. "Within 48 hours from the time
    of its generation" excludes the instant 48 hours later — at exactly +48:00:00
    the portal already answers that the UDIN can no longer be revoked (FAQ Q125)
    — and `is_revocable` is where that boundary lives, so this and the
    `revocable_now` list cannot disagree about it.

    `now` is the SERVER's clock. The window runs from an instant rather than a
    date, so a caller-supplied "now" would let a browser with a wrong clock be
    told it can still take back a number it cannot.

    `reason` is REQUIRED and non-blank. A revocation with no reason is not a
    record of anything, and this is the row an audit is read for.

    `replaced_by_udin` is optional and is only meaningful on a revoked row
    (`udin_register_replacement_status_ck`). FAQ Q124: a member who has revoked
    must generate a fresh UDIN inside whatever is left of the sixty days, and
    pointing the old row at the new number is how the two are ever reconciled.

    Returns None when the row is not this org's.
    """
    moment = _as_aware(now, field="now")
    today = moment.date()
    if windows is None:
        windows = await load_windows(pool, as_of=today)

    why = _required_text(reason, field="reason", limit=1000)
    replacement = _plain_text(replaced_by_udin, field="replaced_by_udin",
                              limit=64)
    if replacement:
        replacement = _clean_udin(replacement, field="replaced_by_udin")

    record = await pool.fetchrow(
        _SELECT_ROW_FOR_WRITE, str(org_id), str(entry_id)
    )
    if record is None:
        return None
    row = dict(record)
    if row.get("status") != "generated":
        _refuse_wrong_state(row.get("status") or "", wanted="generated")

    generated_at = row.get("udin_generated_at")
    if generated_at is None:
        # `udin_register_generated_ck` makes this impossible. Loud rather than
        # silent: a 'generated' row with no instant means the constraint is
        # gone, and the 48-hour window has nothing to run from.
        raise UdinError(
            "This row claims to carry a generated UDIN but records no "
            "generation instant, so the 48-hour window cannot be computed. "
            "Nothing was changed."
        )
    if not is_revocable(generated_at, now=moment,
                        window_hours=windows.revoke_hours):
        until = revocable_until(generated_at,
                               window_hours=windows.revoke_hours)
        raise UdinError(
            f"The {windows.revoke_hours}-hour revocation window closed at "
            f"{until.isoformat()}. ICAI FAQ Q124: a member who misses it has to "
            "generate a fresh UDIN within the time still running on the "
            "sixty-day window. Nothing was changed."
        )

    written = await pool.fetchrow(
        _UPDATE_REVOCATION,
        str(org_id),
        str(entry_id),
        moment,
        why,
        replacement,
        _note_line(why, on=today, what="UDIN revoked"),
    )
    if written is None:
        raise UdinError(
            "This UDIN was acted on by somebody else while the revocation was "
            "being recorded. Nothing was changed; re-read the row first."
        )
    return _describe_written(
        dict(written), as_of=today, now=moment,
        window_days=windows.generate_days, window_hours=windows.revoke_hours,
    )


async def mark_not_required(
    pool,
    org_id: Any,
    entry_id: Any,
    *,
    reason: Any,
    now: Any,
    windows: UdinWindows | None = None,
) -> dict[str, Any] | None:
    """Record that a signed document never carried a UDIN duty. Reason required.

    The honest way off the backlog. Without it the only exits from `at_risk` are
    a real number or a lapse, so a document that was never an audit, assurance
    or attestation function would nag for ever — and a compliance list that
    nags about things nobody can fix is a list people stop reading, which is
    exactly how the register dies.

    Only a `signed` row can take this. A row that already carries a number has
    one, and 'not_required' would contradict it — `udin_register_not_required_ck`
    says the same thing in the database.

    `reason` is required, because this status is a judgement rather than a fact
    and the register has to carry the judgement next to it.
    """
    moment = _as_aware(now, field="now")
    today = moment.date()
    if windows is None:
        windows = await load_windows(pool, as_of=today)

    why = _required_text(reason, field="reason", limit=1000)
    record = await pool.fetchrow(
        _SELECT_ROW_FOR_WRITE, str(org_id), str(entry_id)
    )
    if record is None:
        return None
    row = dict(record)
    if row.get("status") != "signed":
        _refuse_wrong_state(row.get("status") or "", wanted="signed")

    written = await pool.fetchrow(
        _UPDATE_NOT_REQUIRED,
        str(org_id),
        str(entry_id),
        _note_line(why, on=today, what="No UDIN required"),
    )
    if written is None:
        raise UdinError(
            "This document was acted on by somebody else while it was being "
            "marked as not requiring a UDIN. Nothing was changed."
        )
    return _describe_written(
        dict(written), as_of=today, now=moment,
        window_days=windows.generate_days, window_hours=windows.revoke_hours,
    )
