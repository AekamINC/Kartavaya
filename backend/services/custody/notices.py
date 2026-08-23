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


== THERE IS NOW A WRITE PATH, AND HERE IS WHY THERE WAS NOT ================

This section used to read "WHY THERE IS NO WRITE PATH HERE", and the reason it
gave was: staging and production share one database and production writes to
`staging` too, so a write path in a module that has never been exercised is a
production risk with no upside yet -- and inserting a notice needs a router
with an access rule, which did not exist. It named the two conditions for
lifting that: an access rule, and an insert written IN THIS FILE with bind
parameters and every ambiguous expression cast.

Both are met as of 2026-08-21. `routers/custody.py` gates every notice route on
org_owner / org_admin -- the same bar `routers/manav.py` puts on reading an
employee's Aadhaar -- and gates the writes on that PLUS Manav editor. The
insert and the lifecycle updates are at the bottom of this file, bound and cast
throughout (`$1::uuid`, never `$1`, because PgBouncer turns an untyped parse
error into an instant 500 and this repo has lost a day to exactly that).

The original caution was right and is not withdrawn: the register held 0 rows
because nothing could write to it, and a register nobody can add to is a
compliance claim a firm cannot actually make. Read THE WRITE PATH at the foot
of this file before changing any of it.


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


== WHO MAY READ THIS, AND WHO MAY WRITE ====================================

This module answers "which of our clients are under assessment". That is the
most commercially sensitive question the product can answer and it is still not
protected by anything in this file -- nothing here checks a role, and nothing
here should. The rule lives one layer out, in `routers/custody.py`, and it is
`require_org_role(*ORG_MANAGEMENT_ROLES)`: org_owner or org_admin, the same bar
that file puts on reading an employee's Aadhaar, and deliberately NOT hr_admin,
which would reach it through the Manav module gate alone and has no business in
a client's assessment list. The writes carry that AND Manav editor, so a write
is never easier to reach than the read it changes.

That rule is a judgement rather than the owner's decision and it should be
confirmed. What has changed since this paragraph said "DO NOT mount these
functions behind a router" is that a rule now exists and is written down; what
has not changed is that it is not enforced HERE, so a second caller mounting
these functions without one would still be doing so with no protection at all.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Mapping, Sequence

from services.audit_actors import actor_joins, actor_select

import asyncpg

__all__ = [
    "CRITICAL",
    "CrossOrgLeak",
    "EARLIEST_RECEIVED_ON",
    "ESCALATED",
    "LIVE_STATUSES",
    "NOTICE_STATUSES",
    "NoticeUrgency",
    "OVERDUE",
    "SCHEDULED",
    "SOON",
    "STOPPED",
    "TERMINAL_STATUSES",
    "URGENT",
    "URGENCY_ORDER",
    "client_history",
    "compute_due_on",
    "days_remaining",
    "describe_urgency",
    "notice_type_for",
    "notice_types",
    "open_by_urgency",
    "overdue",
    "record_due_date",
    "record_notice",
    "record_status_change",
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
# NAMES, NOT IDS: no CLIENT, ORG or USER id reaches the output shape. The client
# is its name, the owner is their name, the type is its label. `id` is selected
# only where a caller must be able to act on the row, and `check-rendered-ids`
# is positional, so nothing here may be handed straight to a template.
#
# `r.id` -- the register row's OWN primary key -- IS in the projection, and it
# was not until the write path landed on 2026-08-21. It is there for exactly the
# reason the sentence above allows: a caller must be able to act on the row, and
# a notice you cannot address is a notice you cannot record a reply against. It
# is not a user, member, org or client identifier. `services/custody/dsc.py`
# publishes its own row id for the same reason and says so at the same length.

#: WHO filed the notice into the register and WHO last moved it along, as
#: NAMES. `created_by` and `updated_by` hold `users.user_id`, which may not be
#: rendered, so the resolution happens in SQL and the raw ids are not in this
#: projection at all — `services/audit_actors` owns the ladder for the whole
#: backend and stops at names, deliberately, where `routers/graha.py:1466`
#: falls back to the person's EMAIL.
#:
#: IT SITS SECOND IN THE LIST rather than last: `actor_select` is
#: comma-TERMINATED so it can be dropped into the middle of a column list, and
#: appending it would leave a dangling comma in front of `FROM`. `r.org_id`
#: stays first because `test_the_statement_reads_org_id_back_for_the_guard`
#: asserts on that exact opening — the tenancy guard in `_decorate` can only
#: fire on a column the statement actually returns.
_ACTORS = actor_select("r", updated=True)

_SELECT_COLUMNS = """
    SELECT r.org_id,
""" + "           " + _ACTORS + """
           r.id,
           r.reference_no,
           r.received_on,
           r.due_on,
           r.due_on_override IS NOT NULL      AS due_date_from_notice,
           r.window_in_working_days,
           r.status,
           r.replied_on,
           r.notes,
           -- WHEN, beside the WHO above. These are the register's own audit
           -- stamps and are NOT `received_on`/`replied_on`: those are dates on
           -- the notice, facts about the tax office, while these are facts
           -- about this product — when the row was filed here and when somebody
           -- last touched it. A register that can say who moved a notice along
           -- but not when is half a trail, and the screen renders them as a
           -- pair.
           r.created_at,
           r.updated_at,
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
"""

# The three joins that turn ids into names. Split out from `_SELECT` so that the
# WRITE path can reuse them over a CTE -- a `RETURNING` clause sees only the row
# it wrote, so a create or a status change would otherwise have to re-read the
# row in a second statement, which is a second round trip AND a second place for
# the tenancy predicate to be forgotten. One join clause, two callers, no drift.
_JOINS = """
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
""" + (
    # Two MORE joins onto the same global table, and they cannot share `u`:
    # `owner_user_id` is a uuid against `users.id` while the actor columns are
    # the `user_`-prefixed TEXT in `users.user_id`, and the owner, the person
    # who filed the notice and the person who last moved it are three different
    # people often enough that one join cannot serve them. LEFT, so a notice
    # filed by somebody who has since left the firm still appears in the
    # register — an inner join here would make rows vanish on a leaving date,
    # which is data loss that looks like a filter working.
    "      " + actor_joins("r", updated=True) + "\n"
)

_SELECT = _SELECT_COLUMNS + "      FROM staging.notice_register r\n" + _JOINS

#: The same shape over the CTE a write feeds. `written` is the rows the INSERT
#: or UPDATE just produced; everything else about the projection, including the
#: org-scoped client join, is identical because it is the same string.
_SELECT_WRITTEN = _SELECT_COLUMNS + "      FROM written r\n" + _JOINS


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


# ===========================================================================
#  THE WRITE PATH
#
#  Added 2026-08-21, and the docstring at the top of this file said it would
#  be: "when [an access rule] exists, the insert goes in this file, uses bind
#  parameters, and casts every ambiguous expression". The access rule now
#  exists -- `routers/custody.py` gates every notice route on org_owner /
#  org_admin, the same bar `routers/manav.py` puts on reading an employee's
#  Aadhaar, and gates the WRITES on that plus Manav editor. So this is that
#  insert, and the four lifecycle updates a statutory correspondence log needs.
#
#  == A REGISTER OF NOTICES IS A LOG, AND A LOG DOES NOT OVERWRITE ==========
#
#  Every rule below follows from that one sentence:
#
#    * `notes` is APPENDED, in SQL, with a dated line. Two people recording two
#      facts about one notice cannot lose each other's sentence, and every
#      status change leaves a line behind saying when it was recorded even when
#      nobody typed anything.
#    * `replied_on` and `closed_on` are written with COALESCE, so a date already
#      recorded stays. A second reply date arriving is a correction somebody
#      should make deliberately and visibly; it is not something a second click
#      should do silently.
#    * `closed` and `withdrawn` are TERMINAL. The department's next move is a
#      new notice with its own reference and its own clock -- an ASMT-11 that is
#      rejected becomes a DRC-01, which is a different form under a different
#      section. Reopening a closed row would put two clocks on one record.
#    * Nothing is ever deleted, and there is no delete here to write.
#
#  == THE WINDOW IS A SNAPSHOT AND IT IS NOT A PARAMETER ====================
#
#  `reply_window_days`, `reply_window_months` and `window_in_working_days` are
#  copied onto the register row FROM THE CATALOGUE, in the INSERT statement
#  itself, and are not accepted from a caller. Migration 162 stores them on the
#  row precisely so a later edit to the catalogue cannot move the due date of a
#  notice filed last year -- `due_on` is a STORED GENERATED column computed from
#  them, so a window that moved under a historical row would silently restate a
#  statutory deadline that has already passed.
#
#  What a caller MAY set is `due_on_override`: the date the officer actually
#  wrote on the notice, or an extension they granted. That beats the statutory
#  default everywhere, and where the statute fixes no period at all
#  ('notice_specified' -- rule 142 prescribes none for a DRC-01) it is required.
#  `compute_due_on` is what refuses the case where there is nothing to compute
#  from, and its sentence is better than anything a router could invent.
#
#  == WHAT IS REFUSED, AND WHAT IS ONLY NOTED ===============================
#
#  Refused: a notice served in the future, a reply or a closure dated in the
#  future, a deadline before the notice arrived, a duplicate department
#  reference, a transition that is not in `_TRANSITIONS`. Every one of those
#  would make the register say something that is not true about a date.
#
#  Not refused: an unassigned notice. NULL `owner_user_id` is a real and
#  dangerous state and migration 162 makes it representable on purpose --
#  refusing to record a notice until somebody owns it means the notice does not
#  get recorded, which is strictly worse than an unowned row on a list.
# ===========================================================================

#: Every status `notice_register.status` may hold -- `notice_register_status_ck`
#: as it stands on the LIVE server (read from `pg_constraint` on 2026-08-21).
#: Checked here rather than left to the database: a CheckViolation arrives as an
#: asyncpg error that a router turns into a 500 with nothing readable in it.
NOTICE_STATUSES: tuple[str, ...] = (
    "open", "replied", "closed", "escalated", "withdrawn",
)

#: The two that end the record. See the header -- the department's next step is
#: a new notice, not a second life for this row.
TERMINAL_STATUSES: tuple[str, ...] = ("closed", "withdrawn")

#: Where a notice may go from where it is.
#:
#:   open      -> anywhere. The ordinary path is replied, then closed.
#:   escalated -> a reply can still be filed after the consequence has landed,
#:                and the department can still close or withdraw. It cannot go
#:                back to 'open': the escalation happened.
#:   replied   -> closed is the ordinary end. ESCALATED IS REACHABLE FROM HERE
#:                and that is not a mistake: a reply that the officer rejects
#:                still ends in a determination, and a register that could not
#:                record that would show the practice as safe.
#:   closed / withdrawn -> nowhere.
_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "open": ("replied", "closed", "escalated", "withdrawn"),
    "escalated": ("replied", "closed", "withdrawn"),
    "replied": ("closed", "escalated", "withdrawn"),
    "closed": (),
    "withdrawn": (),
}

#: `notice_register_received_ck`. GST itself began on this date and nothing this
#: register tracks predates the practice by decades; it catches a year typed as
#: 1926 and a date parsed in the wrong order.
EARLIEST_RECEIVED_ON = date(2017, 7, 1)


def _required_text(value: Any, *, field: str, limit: int = 512) -> str:
    """A non-blank string, trimmed. `''` and `'   '` are refused alike."""
    text = "" if value is None else str(value).strip()
    if not text:
        raise NoticeError(f"{field} is required and must not be blank.")
    if len(text) > limit:
        raise NoticeError(
            f"{field} is longer than {limit} characters "
            f"(this one is {len(text)})."
        )
    return text


def _plain_text(value: Any, *, field: str, limit: int = 4000) -> str:
    """A trimmed string, or `''` -- which is what every optional text column on
    this table holds when it is empty (`NOT NULL DEFAULT ''`)."""
    text = "" if value is None else str(value).strip()
    if len(text) > limit:
        raise NoticeError(f"{field} is longer than {limit} characters.")
    return text


def _required_date(value: Any, *, field: str) -> date:
    """A `date`, from a date, a datetime or an ISO string.

    `datetime` is tested FIRST because it is a subclass of `date`: the obvious
    `isinstance(value, date)` accepts a datetime and then compares it with a
    plain date, which raises TypeError a long way from the caller that passed
    it. dsc.py`s `_coerce_as_of` gets this right for the same reason.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        raise NoticeError(f"{field} is required.")
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError as exc:
        raise NoticeError(f"{field} is not an ISO date: {value!r}") from exc


def _optional_date(value: Any, *, field: str) -> date | None:
    """None for an absent date. NEVER `''`.

    An empty string reaching a `::date` cast is an instant PgBouncer 500 with no
    useful message, and an empty form field is exactly how one gets there.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return _required_date(value, field=field)


def _log_line(what: str, *, on: date, note: Any = None) -> str:
    """One dated line for `notes`. NEVER empty.

    Always produced, even when nobody typed anything, because the line is the
    record that the transition happened and when it was written down. An
    undated line in a running log is a line nobody can place.
    """
    body = "" if note is None else str(note).strip()
    return f"[{on.isoformat()}] {what}" + (f": {body}" if body else "")


# == the statements =========================================================
#
# Every value is bound and every parameter is CAST. `$1::uuid` and not `$1`:
# PgBouncer turns an untyped parameter expression into a parse error and an
# instant 500 with no useful message, and this repo has already lost a day to
# exactly that in the credits spend path.
#
# NO DATE ARITHMETIC HERE. `due_on` is computed by the database as a STORED
# GENERATED column and mirrored by `compute_due_on` for callers who need to
# predict it; a third implementation written into these statements would be one
# no test could reach, because the suite has no live database.

#: Every column `_SELECT_COLUMNS` and its joins need, read back off the row that
#: was just written. `due_on` is in here and is generated -- RETURNING sees the
#: computed row, so the caller gets the real deadline rather than a prediction.
#:
#: `created_by` and `updated_by` are carried out of the CTE so the author joins
#: have columns to resolve against, and they stop there: `_SELECT_COLUMNS` names
#: every column it returns, so the ids never reach the caller. Without them the
#: joins would reference columns that do not exist on `written` and every write
#: in this module would fail at parse time rather than at runtime.
_WRITE_RETURNING = (
    "org_id, id, client_id, notice_type_id, owner_user_id, "
    "reference_no, received_on, due_on, due_on_override, "
    "reply_window_days, reply_window_months, window_in_working_days, "
    "status, replied_on, closed_on, notes, created_by, updated_by"
)

#: Resolve a notice type by CODE, inside one practice's visible catalogue.
#:
#: BY CODE AND NOT BY ID, because `notice_types` -- the only listing a caller
#: has -- deliberately returns no id at all. `uq_notice_type_code` is UNIQUE
#: NULLS NOT DISTINCT on (org_id, code), so a practice may mint a type whose
#: code matches a system one, and both rows are visible to it. THE PRACTICE'S
#: OWN WINS: `ORDER BY t.org_id NULLS LAST` puts the non-null org first, and
#: LIMIT 1 makes the resolution deterministic. Without the LIMIT an INSERT ...
#: SELECT over this would write TWO register rows for one notice.
_FETCH_TYPE = """
    SELECT t.org_id,
           t.id                     AS notice_type_ref,
           t.code,
           t.label,
           t.authority,
           t.form_no,
           t.reply_form_no,
           t.statute_ref,
           t.window_basis,
           t.reply_window_days,
           t.reply_window_months,
           t.window_in_working_days,
           t.consequence
      FROM staging.notice_type t
     WHERE t.is_active
       AND t.code = $2::text
       AND (t.org_id IS NULL OR t.org_id = $1::uuid)
     ORDER BY t.org_id NULLS LAST
     LIMIT 1
"""

#: THE TENANCY PROOF IS THE STATEMENT, which is why this is an INSERT ... SELECT
#: rather than an INSERT ... VALUES. `offboarding.record_custody` uses the same
#: shape for the same reason: the statement proves that the type and the client
#: both belong to this practice before any row exists to insert, so there is no
#: window between a check and a write in which the answer could change.
#:
#: THE WINDOW COMES OFF `t`, NOT OFF A PARAMETER. That is what makes it a
#: snapshot rather than a copy somebody typed -- see the header.
#:
#: The owner is resolved from the CALLER'S OWN login, in a scalar subquery, and
#: only when they asked to own it. `owner_user_id` references `public.users(id)`,
#: which is a uuid, while every actor string this application carries is the
#: `user_`-prefixed text in `users.user_id`; translating in SQL is what keeps a
#: user identifier out of the request body and out of every response.
_INSERT_NOTICE = """
    WITH written AS (
        INSERT INTO staging.notice_register
            (org_id, client_id, notice_type_id, reference_no, received_on,
             reply_window_days, reply_window_months, window_in_working_days,
             due_on_override, owner_user_id, status, notes, created_by)
        SELECT $1::uuid, $2::uuid, t.id, btrim($4::text), $5::date,
               t.reply_window_days, t.reply_window_months,
               t.window_in_working_days,
               $6::date,
               CASE WHEN $7::bool
                    THEN (SELECT u.id FROM public.users u
                           WHERE u.user_id = $8::text)
                    ELSE NULL END,
               'open', $9::text, $10::text
          FROM staging.notice_type t
         WHERE t.id = $3::uuid
           AND t.is_active
           AND (t.org_id IS NULL OR t.org_id = $1::uuid)
           AND EXISTS (SELECT 1 FROM staging.graha_clients c
                        WHERE c.id = $2::uuid AND c.org_id = $1::uuid)
        RETURNING """ + _WRITE_RETURNING + """
    )
""" + _SELECT_WRITTEN

#: One row, by id, inside one practice. Read before every update so a refusal
#: can name the state the notice is actually in -- "this notice was closed on
#: 4 August" rather than the bare "nothing happened" a missed WHERE produces.
_FETCH_NOTICE = """
    SELECT r.org_id,
           r.reference_no,
           r.received_on,
           r.due_on,
           r.status,
           r.replied_on,
           r.closed_on
      FROM staging.notice_register r
     WHERE r.org_id = $1::uuid
       AND r.id = $2::uuid
"""

#: `AND r.status = $7::text` is optimistic concurrency and it is not decoration:
#: two people closing one notice at the same moment would otherwise write two
#: closure dates, and the second would win silently.
#:
#: COALESCE ON BOTH DATES. A date already recorded stays -- see the header. The
#: new value only ever lands in a column that was NULL.
_UPDATE_STATUS = """
    WITH written AS (
        UPDATE staging.notice_register r
           SET status     = $3::text,
               -- WHO moved it, in the SAME statement that moves it. `updated_at`
               -- is stamped for this table too, and a timestamp that says a
               -- statutory correspondence record changed without saying who
               -- changed it is not evidence of anything -- which is the one
               -- thing this register exists to be. Bound and cast: an untyped
               -- parameter is a PgBouncer parse error and an instant 500.
               -- NULLIF, so "no actor was supplied" stays NULL rather than
               -- becoming an empty string. `has_updater` in audit_actors is
               -- `updated_by IS NOT NULL`, and an empty string would make it
               -- TRUE with no name behind it -- which the UI renders as the
               -- word `unknown`, i.e. "somebody did this and we lost who".
               -- That is a different and worse claim than "nobody has".
               updated_by = NULLIF(btrim($8::text), ''),
               replied_on = COALESCE(r.replied_on, $4::date),
               closed_on  = COALESCE(r.closed_on,  $5::date),
               notes      = btrim(concat_ws(chr(10),
                                            NULLIF(btrim(r.notes), ''),
                                            $6::text))
         WHERE r.org_id = $1::uuid
           AND r.id     = $2::uuid
           AND r.status = $7::text
        RETURNING """ + _WRITE_RETURNING + """
    )
""" + _SELECT_WRITTEN

#: The officer's date, or an extension they granted. `due_on` is generated from
#: `due_on_override` so writing this column moves the deadline -- which is why
#: the previous one is written into `notes` in the same statement and cannot be
#: lost.
_UPDATE_DUE_DATE = """
    WITH written AS (
        UPDATE staging.notice_register r
           SET due_on_override = $3::date,
               -- Moving a deadline is the change a partner is most likely to be
               -- asked to justify, so it is the last one that should be
               -- anonymous. See `_UPDATE_STATUS`.
               updated_by      = NULLIF(btrim($6::text), ''),
               notes           = btrim(concat_ws(chr(10),
                                                 NULLIF(btrim(r.notes), ''),
                                                 $4::text))
         WHERE r.org_id = $1::uuid
           AND r.id     = $2::uuid
           AND r.status = ANY($5::text[])
        RETURNING """ + _WRITE_RETURNING + """
    )
""" + _SELECT_WRITTEN


def _one(rows: Sequence[Any], org_id: Any, as_of: date) -> dict[str, Any] | None:
    """The single decorated row a write produced, or None when it produced none.

    Goes through `_decorate`, so the tenancy guard, the urgency band and the
    plain-English sentence on a written row are the same code that produces
    them on a read. A write that described its result differently from the list
    it lands in is how two numbers for one notice get onto one screen.
    """
    decorated = _decorate(rows or [], org_id, as_of)
    return decorated[0] if decorated else None


async def notice_type_for(
    pool, org_id: str, code: str
) -> dict[str, Any] | None:
    """One notice type this practice may file against, by code. None if there is
    no such code in its catalogue.

    Exposed rather than kept private because the create form needs it twice: to
    show what the statutory window IS before anything is recorded, and to say
    whether a due date must be read off the paper ('notice_specified') rather
    than computed.
    """
    row = await pool.fetchrow(
        _FETCH_TYPE, org_id, _required_text(code, field="code", limit=64)
    )
    if row is None:
        return None
    out = dict(row)
    owner = out.pop("org_id", None)
    if owner is not None and not _same_org(owner, org_id):
        # Same guard as every read in this module, with the one difference that
        # makes this table different: a NULL org is a system type and belongs to
        # everybody. Anything else that is not this practice is another one's
        # private type, and its LABEL is the leak.
        raise CrossOrgLeak(
            "a notice_type row came back belonging to another practice. The "
            f"statement is wrong and it was NOT returned. (asked {org_id!r})"
        )
    out["is_system"] = owner is None
    return out


async def record_notice(
    pool,
    org_id: str,
    *,
    as_of: date,
    client_id: str,
    notice_type_code: str,
    reference_no: str,
    received_on: Any,
    due_on_override: Any = None,
    notes: Any = "",
    assign_to_me: bool = False,
    actor_user_id: Any = None,
    created_by: Any = "",
) -> dict[str, Any] | None:
    """File one department notice against one client. Returns the decorated row.

    `as_of` is the date the RECORDING is happening on and comes from the server,
    never from a request. It bounds `received_on` (a notice served tomorrow has
    not been served) and dates the line written into `notes`. It is not the
    notice's own clock -- that is `received_on`, the date of SERVICE, and every
    statutory window in the catalogue runs from it.

    THE WINDOW IS SNAPSHOTTED FROM THE CATALOGUE by the INSERT itself and is not
    a parameter. `due_on_override` is: it is the date the officer wrote on the
    paper, it beats the statutory default, and where the statute fixes no period
    it is the only thing there is. `compute_due_on` decides whether the pair
    makes sense and its refusal is the one the caller sees -- refusing is louder
    than being confidently wrong, and being confidently wrong here means a row
    that reads "due today" the day it arrives and "overdue" every day after, for
    ever.

    Returns None when the client or the notice type is not this practice's. That
    is a refusal, not "already exists", and the caller must not read it as one.
    """
    stamp = as_of or date.today()
    reference = _required_text(reference_no, field="reference_no", limit=128)
    served = _required_date(received_on, field="received_on")
    if served < EARLIEST_RECEIVED_ON:
        raise NoticeError(
            f"received_on ({served.isoformat()}) is before "
            f"{EARLIEST_RECEIVED_ON.isoformat()}, which is when GST itself "
            "began. That is usually a year typed wrong or a date read in the "
            "wrong order."
        )
    if served > stamp:
        raise NoticeError(
            f"received_on ({served.isoformat()}) is in the future. A notice "
            "served tomorrow has not been served, and every statutory window "
            "in the catalogue runs from the date of service."
        )

    override = _optional_date(due_on_override, field="due_on_override")
    target = _required_text(client_id, field="client_id", limit=64)

    kind = await notice_type_for(pool, org_id, notice_type_code)
    if kind is None:
        raise NoticeError(
            f"{notice_type_code!r} is not a notice type in this practice's "
            "catalogue. Read the catalogue first -- it carries the system types "
            "and any this practice has minted."
        )

    # `compute_due_on` is the mirror of the generated column, and it raises the
    # sentence a person needs for the one case that cannot be computed at all:
    # a type whose reply period is set by the notice itself, filed with no date
    # read off the notice. Refusing here means the row never reaches a CHECK
    # (`notice_register_has_a_date_ck`) that would surface as a bare 500.
    try:
        due = compute_due_on(
            served,
            window_days=int(kind.get("reply_window_days") or 0),
            window_months=int(kind.get("reply_window_months") or 0),
            due_on_override=override,
        )
    except ValueError as exc:
        raise NoticeError(str(exc)) from exc

    if assign_to_me and not (actor_user_id or ""):
        raise NoticeError(
            "assign_to_me was asked for but there is no caller to assign it to."
        )

    try:
        rows = await pool.fetch(
            _INSERT_NOTICE,
            org_id,
            target,
            str(kind["notice_type_ref"]),
            reference,
            served,
            override,
            bool(assign_to_me),
            str(actor_user_id or ""),
            _plain_text(notes, field="notes", limit=4000),
            _plain_text(created_by, field="created_by", limit=128),
        )
    except asyncpg.UniqueViolationError as exc:
        # `uq_notice_register_reference` is (org_id, notice_type_id,
        # reference_no) -- scoped by TYPE as well as by practice, because two
        # different forms can legitimately carry the same running number on
        # different portals.
        raise NoticeError(
            f"A {kind.get('form_no') or kind.get('code')} with reference "
            f"{reference!r} is already on this register. Nothing was recorded — "
            "open the existing row rather than filing a second one, or the "
            "practice ends up with two clocks on one notice."
        ) from exc

    written = _one(rows, org_id, stamp)
    if written is None:
        return None
    # Stated rather than left for the reader to recompute: the caller has just
    # been told what the deadline is, by the same arithmetic the database used.
    written["due_on_predicted"] = due
    return written


async def record_status_change(
    pool,
    org_id: str,
    notice_id: str,
    *,
    as_of: date,
    to_status: str,
    on_date: Any = None,
    note: Any = None,
    actor_id: Any = None,
) -> dict[str, Any] | None:
    """Move one notice along its own lifecycle. Returns the decorated row.

    `actor_id` is the `users.user_id` of whoever is recording the move and it
    goes into `updated_by` in the same UPDATE. It is a PARAMETER because this
    module never sees a request -- only the router holds the login. Migration
    097's rule is that a function which accepts an actor and then drops it is
    worse than one that never accepted one: the caller believes the answer is
    being written down.

    The whole of the lifecycle, in one function with one transition table,
    because four near-identical functions is how one of them ends up missing a
    date bound. `_TRANSITIONS` is the table; `closed` and `withdrawn` lead
    nowhere and say so in a sentence that names what to do instead.

    `on_date` is the date the thing HAPPENED -- the reply was filed, the
    department accepted it -- and defaults to `as_of`. It may not be in the
    future and may not precede the date the notice was served. It is only
    stored for `replied` and `closed`, because those are the two columns the
    table has; an escalation and a withdrawal are recorded as a dated line in
    `notes`, which is where the register's history lives.

    A DATE ALREADY RECORDED IS KEPT. `replied_on` and `closed_on` are written
    with COALESCE, so this can never quietly restate when a reply was filed.

    Returns None when the notice is not this practice's.
    """
    stamp = as_of or date.today()
    wanted = str(to_status or "").strip().lower()
    if wanted not in NOTICE_STATUSES:
        raise NoticeError(
            f"{to_status!r} is not a notice status. The five are "
            f"{list(NOTICE_STATUSES)}."
        )

    record = await pool.fetchrow(_FETCH_NOTICE, org_id, str(notice_id))
    if record is None:
        return None
    row = dict(record)
    if not _same_org(row.get("org_id"), org_id):
        raise CrossOrgLeak(
            "a notice_register row came back for a different practice than the "
            "one asked for. The statement is wrong and nothing was changed. "
            f"(asked {org_id!r})"
        )

    current = row.get("status") or "open"
    if wanted == current:
        raise NoticeError(
            f"This notice is already recorded as {current!r}. Nothing was "
            "changed."
        )
    allowed = _TRANSITIONS.get(current, ())
    if wanted not in allowed:
        if current in TERMINAL_STATUSES:
            raise NoticeError(
                f"This notice was {current} and stays {current}. The "
                "department's next step is a NEW notice with its own reference "
                "and its own clock — an ASMT-11 that is rejected becomes a "
                "DRC-01, which is a different form under a different section. "
                "Record that instead; nothing was changed."
            )
        raise NoticeError(
            f"A notice that is {current!r} cannot become {wanted!r}. From here "
            f"it can only become one of {list(allowed)}."
        )

    served = _required_date(row["received_on"], field="received_on")
    when = _optional_date(on_date, field="on_date") or stamp
    if when > stamp:
        raise NoticeError(
            f"{when.isoformat()} is in the future. A reply cannot have been "
            "filed tomorrow."
        )
    if when < served:
        raise NoticeError(
            f"{when.isoformat()} is before the notice was served "
            f"({served.isoformat()}). `notice_register_replied_ck` and its "
            "sibling refuse that in the database too; it is usually a "
            "day/month swap."
        )

    replied = when if wanted == "replied" else None
    closed = when if wanted == "closed" else None
    if closed is not None and row.get("replied_on") is not None:
        already = _required_date(row["replied_on"], field="replied_on")
        if closed < already:
            raise NoticeError(
                f"A closure dated {closed.isoformat()} precedes the reply "
                f"recorded on {already.isoformat()}."
            )

    what = {
        "replied": f"Reply filed on {when.isoformat()}",
        "closed": f"Closed by the department on {when.isoformat()}",
        "escalated": f"Escalated on {when.isoformat()}",
        "withdrawn": f"Withdrawn by the department on {when.isoformat()}",
        "open": f"Reopened on {when.isoformat()}",
    }[wanted]

    rows = await pool.fetch(
        _UPDATE_STATUS,
        org_id,
        str(notice_id),
        wanted,
        replied,
        closed,
        _log_line(what, on=stamp, note=note),
        current,
        # $8. Trimmed and capped exactly as `created_by` is on the insert, so a
        # row's author and its last editor cannot be stored in two shapes and
        # then fail to join against the same `users` row.
        _plain_text(actor_id, field="actor_id", limit=128),
    )
    written = _one(rows, org_id, stamp)
    if written is None:
        # The pre-check saw `current` and the UPDATE did not. Somebody else
        # moved the notice in between; loud rather than silent, because the
        # caller believes it recorded a reply and it did not.
        raise NoticeError(
            "Somebody else moved this notice while the change was being "
            "recorded. Nothing was changed; re-read the row first."
        )
    return written


async def record_due_date(
    pool,
    org_id: str,
    notice_id: str,
    *,
    as_of: date,
    due_on_override: Any,
    note: Any = None,
    actor_id: Any = None,
) -> dict[str, Any] | None:
    """Record the date the officer actually gave -- an extension, or a
    correction to a date read off the paper. Returns the decorated row.

    THE PREVIOUS DATE IS WRITTEN INTO `notes` BY THE SAME STATEMENT. `due_on` is
    generated from this column, so setting it moves the deadline, and a
    statutory correspondence log that quietly restates a deadline is a log that
    cannot be used as evidence of anything. Nothing is overwritten that is not
    also written down.

    Only a LIVE notice takes one. A replied notice's deadline is history and a
    closed one's is finished; moving either would be editing the past rather
    than recording the present.

    Returns None when the notice is not this practice's.
    """
    stamp = as_of or date.today()
    record = await pool.fetchrow(_FETCH_NOTICE, org_id, str(notice_id))
    if record is None:
        return None
    row = dict(record)
    if not _same_org(row.get("org_id"), org_id):
        raise CrossOrgLeak(
            "a notice_register row came back for a different practice than the "
            "one asked for. The statement is wrong and nothing was changed. "
            f"(asked {org_id!r})"
        )

    current = row.get("status") or "open"
    if current not in LIVE_STATUSES:
        raise NoticeError(
            f"This notice is {current!r}, so its reply date is history. A "
            "deadline is only moved while the clock is still running; nothing "
            "was changed."
        )

    served = _required_date(row["received_on"], field="received_on")
    new_due = _required_date(due_on_override, field="due_on_override")
    if new_due < served:
        raise NoticeError(
            f"A reply date of {new_due.isoformat()} falls before the notice was "
            f"served ({served.isoformat()}). A deadline cannot precede the "
            "notice — that is usually a day/month swap, and "
            "`notice_register_override_ck` refuses it in the database too."
        )

    was = row.get("due_on")
    line = _log_line(
        "Reply date changed"
        + (f" from {was.isoformat()}" if was is not None else "")
        + f" to {new_due.isoformat()}",
        on=stamp,
        note=note,
    )

    rows = await pool.fetch(
        _UPDATE_DUE_DATE,
        org_id,
        str(notice_id),
        new_due,
        line,
        list(LIVE_STATUSES),
        # $6 -- see `record_status_change`.
        _plain_text(actor_id, field="actor_id", limit=128),
    )
    written = _one(rows, org_id, stamp)
    if written is None:
        raise NoticeError(
            "Somebody else moved this notice while the reply date was being "
            "changed. Nothing was changed; re-read the row first."
        )
    return written
