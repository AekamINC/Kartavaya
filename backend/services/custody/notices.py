"""
notices — the notice and assessment register, and the clock on it.

A department notice is not like anything else this product tracks. An invoice
that goes unpaid stays an unpaid invoice. A DSC that expires stays an expired
DSC. A GST ASMT-10 that goes unanswered is escalated BY SOMEBODY ELSE, on a
date nobody in the practice chose, into a s.73/74 determination. A DRC-01 that
goes unanswered becomes a DRC-07 demand order passed on whatever the record
happens to show. A DRC-07 that goes unpaid for three months becomes recovery
under s.79 -- a garnishee order to the client's bank. Nobody has to remember to
punish the practice. Missing the date is the punishment.

Table: `staging.notice_register` + `staging.notice_type` (migration 162, not
applied at time of writing).


== THE DUE DATE IS THE ONLY THING THAT MATTERS, SO IT IS COMPUTED ONCE ======

`due_on` is a STORED GENERATED column in Postgres. `compute_due_on` below is a
line-for-line mirror of that expression and exists so callers can predict a due
date before inserting, and so the arithmetic can be tested without a database.
The two must not drift, and there are exactly two ways they could:

  MONTH ENDS. 31 Jan + 30 days is 2 March, not "the end of February". 31 Jan +
  3 months is 30 April -- Postgres clamps to the last day of the target month
  and `_add_months` below clamps identically. A naive "add 3 to the month
  number" produces 31 April, which is not a date, and the usual fix (roll to
  1 May) is a day LATE on a statutory deadline. Late is the one direction an
  error in this module is not allowed to point.

  DAYS AND MONTHS TOGETHER. `date + interval` in Postgres applies the months
  before the days, and the orders disagree: 2026-01-30 + (1 month, 1 day) is
  2026-03-01 months-first and 2026-02-28 days-first. Migration 162 forbids a
  window from carrying both, so the ambiguity cannot arise -- but this module
  applies months first anyway, so that if the constraint is ever relaxed the
  two implementations still agree.


== URGENCY IS MEASURED AGAINST THE STATUTE, NOT AGAINST A GUESS =============

`days_remaining` is (due_on - as_of) in whole days, where `due_on` came from a
statutory window and `as_of` is the caller's single clock for the whole run.
Two consequences worth stating because both have been got wrong elsewhere:

  * A notice due TODAY has 0 days remaining and is NOT overdue. The reply is
    filed on the due date all the time; a register that calls that late trains
    people to ignore it.
  * `as_of` is a parameter, never `date.today()` read repeatedly. One run
    evaluates every notice against one clock, or a list sorted at 23:59:59.9
    changes its own order halfway down.

Statuses `replied`, `closed` and `withdrawn` have no urgency at all -- the
clock has stopped -- and `urgency_of` returns STOPPED for them regardless of
the date. `escalated` is the opposite: the deadline has already passed and the
consequence has already happened, so it ranks ABOVE every merely-overdue row.


== WHY THERE IS NO WRITE PATH HERE =========================================

Every function in this module reads. Staging and production share one database
and production writes to `staging` too, so a write path in a module that has
never been exercised is a production risk with no upside yet. Inserting a
notice needs a router with an access rule, and the access rule for this table
is not settled (see below). When it is, the insert goes in this file, uses bind
parameters, and casts every ambiguous expression -- `$1::int + $2::int`, never
`$1 + $2`, because PgBouncer turns an untyped parse error into an instant 500.


== TENANCY, IN THREE PLACES AND NOT ONE ====================================

`r.org_id = $1` in the WHERE clause is not enough here, and the reason is
written into migration 162 itself: the register's client FK points at
`graha_clients(id)` ALONE, not at `(org_id, id)`, because the composite version
would need a unique index on a hot shared table that migration had no business
touching. The database therefore does NOT guarantee that a register row's
client belongs to the same org as the row.

So a row carrying a foreign `client_id` is a row the schema permits, and on it
`r.org_id = $1` is satisfied while `c.name` is ANOTHER PRACTICE'S CLIENT
COMPANY. No predicate on `r` can catch that: the leaking value is on the joined
table. The join is therefore org-scoped too --
`ON c.id = r.client_id AND c.org_id = r.org_id` -- which is the same shape
`services/custody/dsc.py` uses on the same table for the same reason.

And `r.org_id` is read back and checked in Python before anything is returned.
That is the third place, and it is the one that survives an edit: a WHERE clause
deleted by a future refactor turns a silent tenancy leak into a loud
`CrossOrgLeak`. It raises rather than filtering, because a foreign row arriving
here is a defect in the statement, not a row to be tidied away -- filtering
would let a broken query serve twice the rows for months while looking correct.
`org_id` is dropped from every row before it is returned; no uuid leaves this
module.


== WHO MAY READ THIS =======================================================

This module answers "which of our clients are under assessment". That is the
most commercially sensitive question the product can answer and it is not
protected by anything in this file. No access rule is implemented here because
none was specified; the recommendation is in the handover. Until one exists,
DO NOT mount these functions behind a router.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable, Mapping, Sequence

__all__ = [
    "CRITICAL",
    "CrossOrgLeak",
    "ESCALATED",
    "LIVE_STATUSES",
    "NoticeUrgency",
    "OVERDUE",
    "SCHEDULED",
    "SOON",
    "STOPPED",
    "URGENT",
    "URGENCY_ORDER",
    "client_history",
    "compute_due_on",
    "days_remaining",
    "describe_urgency",
    "notice_types",
    "open_by_urgency",
    "overdue",
    "sort_by_urgency",
    "urgency_of",
    "urgency_rank",
]


class NoticeError(ValueError):
    """Base for every refusal this module makes."""


class CrossOrgLeak(NoticeError):
    """A row came back belonging to another practice. The SQL is wrong.

    Raised, never filtered, and never returned. A notice register is a list of
    which companies are under assessment; one row of it crossing a tenant
    boundary is the worst thing this module can do, and it must be impossible
    to do quietly. Mirrors `CrossOrgLeak` in services/custody/dsc.py.
    """


# == the vocabulary =========================================================
#
# Bands, not raw day counts, because the day count is what a machine sorts on
# and the band is what a person acts on. The thresholds are chosen against the
# shortest real window in the catalogue: rule 88C and rule 88D give SEVEN days
# for a DRC-01B / DRC-01C. If "urgent" started at 3 days, a seven-day notice
# would sit in the calm band for more than half its life.

ESCALATED = "escalated"   # the deadline passed AND the consequence happened
OVERDUE = "overdue"       # past due, still live
CRITICAL = "critical"     # 0-2 days left. 0 means due today, which is not late.
URGENT = "urgent"         # 3-7 days. The whole life of a rule 88C window.
SOON = "soon"             # 8-30 days. The whole life of an ASMT-10 window.
SCHEDULED = "scheduled"   # more than 30 days
STOPPED = "stopped"       # replied / closed / withdrawn -- no clock at all

#: Most urgent first. `urgency_rank` is this list's index, so it is also the
#: sort key, and a band that is not in it raises rather than sorting silently
#: to the end -- an unknown band sorting last would hide it, and hiding is the
#: failure this register exists to prevent.
URGENCY_ORDER: tuple[str, ...] = (
    ESCALATED, OVERDUE, CRITICAL, URGENT, SOON, SCHEDULED, STOPPED,
)

#: Statuses whose clock is still running. Mirrors the partial-index predicate
#: in migration 162 (`WHERE status IN ('open','escalated')`) -- if these two
#: ever disagree the queries below stop using their index and quietly get slow.
LIVE_STATUSES: tuple[str, ...] = ("open", "escalated")


@dataclass(frozen=True)
class NoticeUrgency:
    """The clock on one notice, evaluated against one caller-supplied `as_of`."""

    band: str
    days_remaining: int | None   # None only when the clock has stopped
    due_on: date | None
    #: True when the window was stated in WORKING days and computed in calendar
    #: days -- so the real deadline is LATER than `due_on` and this row is being
    #: reported as more urgent than it strictly is. Deliberate: see the module
    #: docstring. Callers must surface this rather than assert a false precision.
    conservative: bool = False


# == the arithmetic =========================================================

def _add_months(start: date, months: int) -> date:
    """Add whole calendar months, clamping to the last day of the target month.

    Matches PostgreSQL `date + make_interval(months => n)` exactly, verified on
    the live server 19 August 2026:

        2026-01-31 + 3 months  -> 2026-04-30   (clamped, not 1 May)
        2026-11-30 + 3 months  -> 2027-02-28   (clamped, and across a year end)
        2028-02-29 + 12 months -> 2029-02-28   (clamped off a leap day)

    Clamping DOWN rather than rolling forward is the whole point. A statutory
    deadline computed one day late is a missed deadline; one day early is a
    reply filed a day early.
    """
    if months == 0:
        return start
    total = (start.year * 12 + (start.month - 1)) + months
    year, month = divmod(total, 12)
    month += 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(start.day, last))


def compute_due_on(
    received_on: date,
    *,
    window_days: int = 0,
    window_months: int = 0,
    due_on_override: date | None = None,
) -> date:
    """The date a reply is due. Mirrors the generated column in migration 162.

    `due_on_override` wins outright -- it is the date the officer actually wrote
    on the notice, or an extension they granted, and both beat the statutory
    default. An ASMT-10 that says fifteen days is due in fifteen days even
    though rule 99(1) caps the officer at thirty.

    Raises ValueError when there is nothing to compute from. That is the
    'notice_specified' case -- rule 142 prescribes no reply period for a DRC-01
    -- and the alternative is returning `received_on` itself, which renders as
    "due today" the day it arrives and "overdue" every day after, for ever.
    Refusing is louder than being confidently wrong.
    """
    if due_on_override is not None:
        if due_on_override < received_on:
            raise ValueError(
                "due_on_override precedes received_on — a deadline cannot fall "
                "before the notice was served (usually a dd/mm swap)"
            )
        return due_on_override
    if window_days <= 0 and window_months <= 0:
        raise ValueError(
            "no statutory window and no due_on_override — this notice type's "
            "reply period is set by the notice itself, so the date must be read "
            "off the notice and supplied, not computed"
        )
    if window_days > 0 and window_months > 0:
        # Forbidden by notice_type_window_exclusive_ck / the register's copy of
        # it. Caught here too, because a caller building a window by hand never
        # sees that constraint until the INSERT fails.
        raise ValueError(
            "a window is days OR months, never both — the two orders of "
            "application disagree at month ends (see the module docstring)"
        )
    # Months first, then days. Matches Postgres. See the module docstring.
    out = _add_months(received_on, window_months)
    if window_days:
        out = date.fromordinal(out.toordinal() + window_days)
    return out


def days_remaining(due_on: date, as_of: date) -> int:
    """Whole days from `as_of` to `due_on`. Zero means due today, not late."""
    return (due_on - as_of).days


def urgency_of(
    due_on: date | None,
    as_of: date,
    *,
    status: str = "open",
    working_days: bool = False,
) -> NoticeUrgency:
    """Band one notice.

    `status` is consulted BEFORE the date, deliberately. A notice replied to
    last week has no clock, and a register that keeps counting down on it
    manufactures panic and gets ignored — which is how a compliance list dies.
    `escalated` is the mirror image: the consequence has already landed, so it
    outranks every merely-overdue row no matter how far past due they are.
    """
    if status == "escalated":
        rem = days_remaining(due_on, as_of) if due_on is not None else None
        return NoticeUrgency(ESCALATED, rem, due_on, working_days)
    if status not in LIVE_STATUSES:
        return NoticeUrgency(STOPPED, None, due_on, working_days)
    if due_on is None:
        # An open notice with no date at all cannot exist through migration
        # 162's notice_register_has_a_date_ck. If one appears it came from
        # somewhere that bypassed the schema, and the safe reading of "we do not
        # know when this is due" on a notice is that it is due now.
        return NoticeUrgency(OVERDUE, None, None, working_days)

    rem = days_remaining(due_on, as_of)
    if rem < 0:
        band = OVERDUE
    elif rem <= 2:
        band = CRITICAL
    elif rem <= 7:
        band = URGENT
    elif rem <= 30:
        band = SOON
    else:
        band = SCHEDULED
    return NoticeUrgency(band, rem, due_on, working_days)


def urgency_rank(band: str) -> int:
    """Sort key: 0 is the most urgent. Unknown bands raise rather than sort last."""
    try:
        return URGENCY_ORDER.index(band)
    except ValueError as exc:                     # pragma: no cover - guard
        raise ValueError(f"unknown urgency band {band!r}") from exc


def sort_by_urgency(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Order notices for a human: worst first, then soonest, then by client.

    Each row must already carry `urgency` (a NoticeUrgency). The tie-break on
    `due_on` inside a band matters more than it looks: an overdue list sorted
    only by band puts a notice 90 days past due next to one that lapsed
    yesterday in arbitrary order, and the 90-day one is the emergency.

    `client_name` is the final tie-break so the order is stable between runs.
    A row id would also be stable and is deliberately not used — ids are never
    rendered, and a sort key that cannot be shown is a sort nobody can verify.
    """
    def key(row: Mapping[str, Any]) -> tuple[int, int, str]:
        u: NoticeUrgency = row["urgency"]
        # date.max for a stopped/undated row: it sorts last within its band and
        # never crashes the comparison on None.
        due = u.due_on or date.max
        return (urgency_rank(u.band), due.toordinal(), str(row.get("client_name") or ""))

    return [dict(r) for r in sorted(rows, key=key)]


def describe_urgency(u: NoticeUrgency) -> str:
    """One plain sentence. No ids, no jargon, no false precision."""
    if u.band == STOPPED:
        return "The clock has stopped."
    if u.band == ESCALATED:
        return "Already escalated — the deadline passed and the consequence has landed."
    if u.days_remaining is None:
        return "No reply date recorded — treat as due now."
    hedge = (
        " The window is in working days, so the real deadline is a little later "
        "than this."
        if u.conservative else ""
    )
    if u.days_remaining < 0:
        n = -u.days_remaining
        return f"Overdue by {n} day{'s' if n != 1 else ''}.{hedge}"
    if u.days_remaining == 0:
        return f"Due today.{hedge}"
    n = u.days_remaining
    return f"{n} day{'s' if n != 1 else ''} left.{hedge}"


# == the reads ==============================================================
#
# Every query below is schema-qualified (`staging.`) -- migration 142 exists
# because a shadow table in another schema was picked up by search_path -- and
# binds every value. No mock pool appears in the tests for this module
# (`mock_pool_hides_bad_sql`): a faked pool would let this SQL pass while being
# wrong against the real schema, so the SQL is verified by probing the live
# catalogue and the judgement is verified in test_notice_register.py.
#
# NAMES, NOT IDS: none of these SELECT an id into the output shape. The client
# is its name, the owner is their name, the type is its label. `id` is selected
# only where a caller must be able to act on the row, and `check-rendered-ids`
# is positional, so nothing here may be handed straight to a template.

_SELECT = """
    SELECT r.org_id,
           r.reference_no,
           r.received_on,
           r.due_on,
           r.due_on_override IS NOT NULL      AS due_date_from_notice,
           r.window_in_working_days,
           r.status,
           r.replied_on,
           r.notes,
           c.name                             AS client_name,
           t.code                             AS notice_type,
           t.label                            AS notice_type_label,
           t.authority,
           t.form_no,
           t.reply_form_no,
           t.statute_ref,
           t.statute_key,
           t.window_basis,
           t.consequence,
           t.source_url,
           u.name                             AS owner_name
      FROM staging.notice_register r
      -- AND c.org_id = r.org_id is load-bearing, not belt-and-braces. Migration
      -- 162's client FK is on graha_clients(id) alone, so the database permits
      -- a register row pointing at another practice's company; on such a row
      -- `r.org_id = $1` passes and `c.name` is the other practice's client.
      -- The leaking value is on the JOINED table, so no WHERE clause on `r`
      -- can catch it. dsc.py joins this same table the same way.
      JOIN staging.graha_clients   c ON c.id = r.client_id
                                    AND c.org_id = r.org_id
      JOIN staging.notice_type     t ON t.id = r.notice_type_id
      -- No org predicate is possible on public.users: it is a global table and
      -- org membership lives in user_roles, not on the user row. owner_user_id
      -- is an assignment this product makes rather than a value a client
      -- supplies, so the exposure is a name the practice itself wrote down.
      LEFT JOIN public.users       u ON u.id = r.owner_user_id
"""


def _same_org(value: Any, org_id: Any) -> bool:
    """Compare two org identifiers without letting case decide tenancy.

    asyncpg hands a uuid column back as a `uuid.UUID`, whose str() is lower
    case, while an org id taken off a JWT claim is often upper case. Comparing
    them raw makes a correct query look like a leak; comparing them folded is
    the difference between a working page and a 500 that reads like a security
    incident. dsc.py folds the same way.
    """
    return str(value).lower() == str(org_id).lower()


def _decorate(rows: Sequence[Any], org_id: Any, as_of: date) -> list[dict[str, Any]]:
    """Attach a NoticeUrgency to every row, against ONE clock for the whole run.

    Also the tenancy guard, and it raises before it decorates: a foreign row is
    never touched, never banded and never returned. `org_id` is read for this
    check and dropped immediately after, so no uuid leaves this module.
    """
    out: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        if "org_id" not in row:
            # Not defensiveness: `row.pop("org_id", org_id)` would DEFAULT to
            # the org that was asked for, so a statement that quietly stopped
            # selecting org_id would disable the guard below and every test of
            # it would still pass. A missing column means the statement changed.
            raise CrossOrgLeak(
                "a notice_register row arrived without org_id, so the tenancy "
                "guard cannot run. The statement no longer selects r.org_id."
            )
        if not _same_org(row.pop("org_id"), org_id):
            raise CrossOrgLeak(
                "a notice_register row came back for a different practice than "
                "the one asked for. The statement is wrong and this row was NOT "
                "returned — a notice register is a list of which companies are "
                f"under assessment. (asked {org_id!r})"
            )
        row["urgency"] = urgency_of(
            row.get("due_on"),
            as_of,
            status=row.get("status") or "open",
            working_days=bool(row.get("window_in_working_days")),
        )
        row["urgency_note"] = describe_urgency(row["urgency"])
        out.append(row)
    return out


async def open_by_urgency(
    pool,
    org_id: str,
    *,
    as_of: date | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Every live notice for one org, worst first.

    Ordered in SQL by due date so that `limit` truncates the CALM end of the
    list and never the urgent end -- a LIMIT applied to an unordered read is
    how a "top 20" panel comes to omit the only notice that mattered. The final
    band ordering is applied in Python by `sort_by_urgency`, because
    `escalated` must outrank an overdue row and no ORDER BY on `due_on` can
    express that.

    `limit` is bound, not interpolated, and cast: PgBouncer turns an untyped
    parse error into an instant 500 (see the credits incident).
    """
    as_of = as_of or date.today()
    rows = await pool.fetch(
        _SELECT + """
         WHERE r.org_id = $1::uuid
           AND r.status = ANY($2::text[])
         ORDER BY r.due_on ASC
         LIMIT $3::int
        """,
        org_id, list(LIVE_STATUSES), int(limit),
    )
    return sort_by_urgency(_decorate(rows, org_id, as_of))


async def overdue(
    pool,
    org_id: str,
    *,
    as_of: date | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Live notices whose reply date has already passed, worst first.

    The `due_on < $3` comparison uses the CALLER's `as_of` rather than
    `CURRENT_DATE`, so this function agrees with `open_by_urgency` run in the
    same breath. `CURRENT_DATE` is evaluated in the database's timezone, which
    is UTC while every deadline in this table is an Indian statutory date --
    for five and a half hours each day the two disagree, and the disagreement
    lands exactly on the notices due today.
    """
    as_of = as_of or date.today()
    rows = await pool.fetch(
        _SELECT + """
         WHERE r.org_id  = $1::uuid
           AND r.status  = ANY($2::text[])
           AND r.due_on  < $3::date
         ORDER BY r.due_on ASC
         LIMIT $4::int
        """,
        org_id, list(LIVE_STATUSES), as_of, int(limit),
    )
    return sort_by_urgency(_decorate(rows, org_id, as_of))


async def client_history(
    pool,
    org_id: str,
    client_id: str,
    *,
    as_of: date | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Every notice one client has ever received, newest first.

    Deliberately NOT filtered by status. The value of a client history is the
    closed rows: "this is the fourth ASMT-10 on the same mismatch" is the
    sentence that changes how the engagement is run, and it is invisible in a
    list of open items.

    `client_id` is an argument because that is how a caller addresses a row;
    nothing in the RESULT is an id. `org_id` is in the WHERE clause and not
    merely implied by `client_id` -- migration 162 could not make the client FK
    composite (no unique index on graha_clients (org_id, id) to point at), so
    this predicate is the only thing standing between one practice and
    another's assessment list.
    """
    as_of = as_of or date.today()
    rows = await pool.fetch(
        _SELECT + """
         WHERE r.org_id    = $1::uuid
           AND r.client_id = $2::uuid
         ORDER BY r.received_on DESC, r.due_on DESC
         LIMIT $3::int
        """,
        org_id, client_id, int(limit),
    )
    return _decorate(rows, org_id, as_of)


async def notice_types(pool, org_id: str) -> list[dict[str, Any]]:
    """The catalogue this org may file against: Aekam's types plus its own.

    `org_id IS NULL OR org_id = $1` and not a UNION: one org must never see
    another's private notice types, and the name of a type a practice minted
    ("Sales-tax dept, Nashik — spot verification") can itself be commercially
    revealing.
    """
    rows = await pool.fetch(
        """
        SELECT org_id,
               code, label, authority, form_no, reply_form_no, statute_ref,
               statute_key, reply_window_days, reply_window_months,
               window_basis, window_in_working_days, consequence, source_url,
               org_id IS NULL AS is_system
          FROM staging.notice_type
         WHERE is_active
           AND (org_id IS NULL OR org_id = $1::uuid)
         ORDER BY authority, code
        """,
        org_id,
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        # Same guard as the register reads, with the one difference that makes
        # this table different: org_id NULL is a system type and belongs to
        # everybody. Anything else that is not this org is another practice's
        # private type, and its LABEL is the leak -- "Sales-tax dept, Nashik —
        # spot verification" names a department, a city and an exposure.
        owner = row.pop("org_id", None)
        if owner is not None and not _same_org(owner, org_id):
            raise CrossOrgLeak(
                "a notice_type row came back belonging to another practice. "
                f"The statement is wrong and it was NOT returned. (asked {org_id!r})"
            )
        out.append(row)
    return out
