"""Seat billing and the four skill rosters, against the shared leaver predicate.

WHAT THIS FILE IS FOR
---------------------
`manav_employees.is_active` does not mean "still employed". It is a flag somebody
must remember to clear, and `routers/manav.py:1958` records why a leaver KEEPS it
on purpose: offboarding used to set it FALSE, which dropped the person out of
payroll the same day and left an outstanding salary advance unrecovered. So the
flag is deliberate, the data is right, and it is the READS that have to change.

`services/on_the_rolls.py` is the one definition. This file is the tripwire for
the five reads in the seat model and the skills that must use it — and, just as
importantly, for the one read that must NOT.

Live, read-only, against E2E Test & Associates on 2026-08-26:

    seat_model roster                      83 → 73   (exempt 0 → 0, so 10 seats)
    kpi_aggregator employees_active        83 → 73
    leave coverage denominator, Accounts    8 →  6   (Payroll 8 → 6, six more)
    attendance missing-days, August        180 →  1  phantom day-rows

── WHY A CAPTURED-SQL TEST AND NOT A BEHAVIOURAL ONE ────────────────────────

`tests/conftest.py` hands every module a MagicMock pool that answers `[]` to any
statement, so a handler called with it proves only that the mock returned what
the test told it to. The predicate is a WHERE clause; the only honest offline
proof that a clause is in a statement is to capture the statement the handler
actually builds and look. `tests/test_skill_sql_is_valid.py` already parses these
same statements against the live catalogue, so validity is covered there; what it
cannot check is whether a valid statement asks the RIGHT QUESTION. That is here.

Every assertion compares against `still_on_the_rolls(...)` CALLED, never against
a hand-typed copy of the fragment. Twenty-five hand-written copies is the failure
the shared module exists to prevent, and a test carrying a twenty-sixth would
keep passing while the shared definition moved out from under it.

── THE ONE SITE THAT MUST STAY UNGUARDED, AND THE ONE THAT NEEDS A DIFFERENT
   ANCHOR ──────────────────────────────────────────────────────────────────

  leave_beyond_balance   FLOW. Days taken in months the person worked; they do
                         not un-happen on the last working day, and the overdraw
                         is recoverable at full-and-final — the same class of
                         money as the advance in `manav.py:1958`. Five of E2E's
                         ten leavers have exits still open. Guarding it would
                         blind the settlement clerk to the recovery the flag is
                         kept for. `test_the_leave_overdraw_check_is_left_alone`
                         is a real assertion, not a placeholder.

  no_attendance_on_working_day
                         FLOW over a period, read PER DAY. Guarding it at
                         CURRENT_DATE would drop the leaver entirely and erase
                         genuine missing days from BEFORE they left — measured,
                         that is 1 real day in August against 180 phantom ones.
                         So the anchor is `d.d`, the day being tested, which is
                         the exact mirror of the `date_of_joining` rule already
                         two lines above it in that query.
"""
import asyncio

import pytest

from services.on_the_rolls import still_on_the_rolls
from services.seat_model import PahchanSeatCount, count_pahchan_seats
from services.skills.data.kpi_aggregator import aggregate_kpis
from services.skills.data.leave_conflict_checker import check_dept_coverage
from services.skills.data.people_checks import (
    check_attendance_exceptions,
    check_statutory_records_gate,
)

# A fixture value, and deliberately not the seeded org's id even in part — an id
# that LOOKS real gets copied into a live probe, which then returns nothing and
# reads as a regression. Same reasoning as `tests/test_people_checks.py`.
ORG = "00000000-0000-4000-8000-00000000000b"

#: The fragment as the shared module builds it, anchored at today. Anything that
#: reads a roster must carry exactly this.
GUARD = still_on_the_rolls("e")

#: The same fragment anchored at the DAY under test, for the per-day flow site.
GUARD_PER_DAY = still_on_the_rolls("e", "d.d")


class _Row(dict):
    """A permissive row: `r["anything"]` answers, and `dict(r)` works.

    A small POSITIVE default, not zero. `check_dept_coverage` returns early when
    its denominator is 0 and would then never issue the second statement at all,
    so a zero-answering fake would make this file pass by never looking.
    """

    def __missing__(self, key):
        return 3


class _Recorder:
    """A pool that answers nothing useful and remembers every statement.

    It deliberately does not route on the SQL. Routing is what a behavioural fake
    needs; this one only has to let each handler run far enough to build all of
    its statements, and every statement it is handed is evidence.
    """

    def __init__(self):
        self.seen: list[str] = []

    def _record(self, sql, default):
        self.seen.append(sql)
        return default

    async def fetch(self, sql, *args):
        return self._record(sql, [])

    async def fetchrow(self, sql, *args):
        return self._record(sql, _Row())

    async def fetchval(self, sql, *args):
        return self._record(sql, 0)

    async def execute(self, sql, *args):
        return self._record(sql, "")

    # ── Reading the capture ──────────────────────────────────────────────────

    def touching_employees(self) -> list[str]:
        """Every captured statement that reads the employee table."""
        return [s for s in self.seen if "staging.manav_employees" in s]

    def matching(self, marker: str) -> list[str]:
        return [s for s in self.seen if marker in s]


def _drive(handler, *args, **kw) -> _Recorder:
    """Run one handler against a recorder and hand back what it asked for.

    Exceptions are swallowed ON PURPOSE — a fake this permissive will trip some
    handler's arithmetic sooner or later, and the statements issued before that
    point are still exactly the statements production issues. What stops that
    swallow from hollowing the test out is that every caller below asserts the
    statement it cares about was actually SEEN before asserting anything about
    its contents.
    """
    pool = _Recorder()
    try:
        asyncio.run(handler(pool, *args, **kw))
    except Exception:                                  # noqa: BLE001 — see above
        pass
    return pool


# ── 1 · The money ────────────────────────────────────────────────────────────

def test_the_attendance_seat_roster_excludes_people_who_have_left():
    """Pahchan seats are BILLED off this roster.

    Live on 2026-08-26 the count was 83 with 0 exempt while ten of those people
    had a last working day up to seven weeks past — so the organisation was being
    invoiced for ten attendance seats belonging to nobody. 83 → 73.
    """
    pool = _drive(count_pahchan_seats, ORG)
    stmts = pool.touching_employees()
    assert stmts, "the seat count issued no employee query at all"
    sql = stmts[0]

    # BOTH halves. `PahchanSeatCount.used` is `roster - exempt` and its docstring
    # rests on exempt being counted over the same population as roster; guarding
    # one and not the other breaks that invariant and can only ever overcount.
    assert sql.count(GUARD) == 2, (
        "the roster and the exempt subquery must BOTH carry the leaver guard — "
        f"found {sql.count(GUARD)} of 2 in:\n{sql}"
    )


def test_ten_leavers_are_the_difference_between_refusing_a_hire_and_allowing_one():
    """The arithmetic the seat query feeds, stated as money.

    An org that bought 75 attendance seats is at 83 on the unguarded count and is
    refused its next hire over ten people who have gone. The same org is at 73 on
    the guarded one and has room. This is `is_full`, which is what raises the 409.
    """
    assert PahchanSeatCount(limit=75, roster=83, exempt=0).is_full is True
    assert PahchanSeatCount(limit=75, roster=73, exempt=0).is_full is False
    assert PahchanSeatCount(limit=75, roster=73, exempt=0).used == 73


# ── 2 · The headline number ──────────────────────────────────────────────────

def test_the_employees_active_kpi_counts_only_people_still_on_the_rolls():
    """`employees_active` is a STOCK — who is on the rolls now. 83 → 73."""
    pool = _drive(aggregate_kpis, ORG)
    stmts = pool.touching_employees()
    assert len(stmts) == 1, f"expected one employee arm, saw {len(stmts)}"
    assert GUARD in stmts[0], (
        "the employees_active KPI still counts leavers:\n" + stmts[0])


# ── 3 · The automation engine's coverage denominator ─────────────────────────

def test_leave_coverage_counts_both_halves_over_the_same_population():
    """An inflated denominator UNDER-BLOCKS leave.

    `check_dept_coverage` blocks at 50%. Live, Accounts and Payroll each hold 8
    on the unguarded count and 6 on the guarded one, so three people off is 37%
    (allowed) against the truth of 50% (blocked) — the engine believes the
    department has cover it does not have.

    The NUMERATOR is asserted too, and not as decoration. Guarding only the
    denominator lets somebody who has left contribute to `on_leave` while being
    absent from `total`, and `pct` can then exceed 100 — a coverage figure that
    cannot exist is worse than the one that is merely too low.
    """
    pool = _drive(check_dept_coverage, ORG, "Accounts", "2026-09-01", "2026-09-05")
    stmts = pool.touching_employees()
    assert len(stmts) == 2, (
        "expected the denominator AND the on-leave numerator, saw "
        f"{len(stmts)} — did the denominator return early?")
    for sql in stmts:
        assert GUARD in sql, "unguarded half of the coverage ratio:\n" + sql


# ── 4 · The statutory gate: findings and denominators together ───────────────

def test_the_statutory_gate_and_its_coverage_agree_on_who_is_in_scope():
    """Two statements, one population.

    The gate prints "0 of 59" so that a check which found nothing is
    distinguishable from one that never ran. If the findings roster excludes
    leavers and the coverage denominator does not, that sentence starts comparing
    a numerator drawn from one population against a denominator drawn from
    another, which is a worse lie than either number alone.
    """
    pool = _drive(check_statutory_records_gate, ORG)
    stmts = pool.touching_employees()
    assert len(stmts) == 2, (
        f"expected the findings query and the coverage query, saw {len(stmts)}")
    for sql in stmts:
        assert GUARD in sql, "unguarded statutory roster:\n" + sql


# ── 5 · Attendance: the flow that needs a per-day anchor ─────────────────────

def test_missing_attendance_is_bounded_by_the_last_working_day_not_by_today():
    """The mirror of the joining rule, and the reason it cannot be CURRENT_DATE.

    That query already says "somebody who joined mid-month is not absent for the
    days before they joined". The same sentence backwards: somebody who left
    mid-month is not absent for the days after they left.

    Measured over August in E2E: ten leavers produce 180 missing-day rows on the
    unguarded query. Anchored at `d.d` that becomes 1 — a genuine missing day one
    of them had BEFORE leaving. Anchored at CURRENT_DATE it would become 0, and
    that surviving real day is exactly the history a stock guard rewrites.
    """
    pool = _drive(check_attendance_exceptions, ORG)
    missing = pool.matching("generate_series")
    assert len(missing) == 1, f"expected one missing-days query, saw {len(missing)}"
    sql = missing[0]

    assert GUARD_PER_DAY in sql, (
        "the missing-attendance roster must be bounded per DAY:\n" + sql)
    assert GUARD not in sql, (
        "anchored at CURRENT_DATE this erases missing days the leaver really had "
        "before they left:\n" + sql)


def test_the_leave_overdraw_check_is_left_alone():
    """FLOW. Asserted, because the next reader will want to 'finish the job'.

    Leave taken in the months somebody worked is not undone by their leaving, and
    an overdraw is money recoverable at full-and-final — the same class of money
    as the salary advance whose loss is why the flag is kept in the first place.
    Five of E2E's ten leavers have exits still open (`initiated`, `in_clearance`).
    A guard here would hide the overdraw from the person settling the account.
    """
    pool = _drive(check_attendance_exceptions, ORG)
    # Two: the overdraw itself, and the `no_balance` count of pairs the question
    # could not be asked about. Both are year-scoped flows and both stay bare.
    over = pool.matching("manav_leave_balances")
    assert len(over) == 2, f"expected two leave-balance queries, saw {len(over)}"
    for sql in over:
        assert "manav_offboarding" not in sql, (
            "leave overdrawn while employed is a FLOW and must keep reporting "
            "after the last working day — read this test's docstring before "
            "changing it:\n" + sql)


# ── 6 · No twenty-sixth hand-written copy ────────────────────────────────────

@pytest.mark.parametrize("handler,args", [
    (count_pahchan_seats, (ORG,)),
    (aggregate_kpis, (ORG,)),
    (check_dept_coverage, (ORG, "Accounts", "2026-09-01", "2026-09-05")),
    (check_statutory_records_gate, (ORG,)),
    (check_attendance_exceptions, (ORG,)),
])
def test_every_offboarding_read_comes_from_the_shared_module(handler, args):
    """`manav_offboarding` may appear ONLY inside a fragment the module built.

    This is the assertion that stops the drift the shared module exists to stop.
    A caller that writes its own `NOT EXISTS` — dropping `status <> 'cancelled'`
    and vanishing a withdrawn resignation for ever, or joining on `employee_id`
    alone and reading another tenant's exit row — passes every other test in this
    file and fails this one.
    """
    pool = _drive(handler, *args)
    for sql in pool.seen:
        if "manav_offboarding" not in sql:
            continue
        stripped = sql.replace(GUARD, "").replace(GUARD_PER_DAY, "")
        assert "manav_offboarding" not in stripped, (
            "an offboarding predicate that services/on_the_rolls.py did not "
            "build:\n" + sql)
