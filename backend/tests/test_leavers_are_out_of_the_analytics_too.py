"""Phase 2.1 removed ten leavers from payroll. Two read surfaces kept counting them.

`routers/vetana.py` stopped writing payslips for people whose recorded last
working day had passed. Nothing else changed, so the two places that answer
"who is on this payroll" for a READER went on answering with the old roster:

  · `analytics/metrics/vetana.py` — `vetana.salary_bands`, the dashboard's band
    histogram, joined `manav_employees` on `e.is_active = TRUE` alone.
  · `services/skills/data/payroll_readiness.py` — its `emp` CTE did the same,
    under a comment claiming it was "exactly the rows routers/vetana.py would
    pick up". That comment was true when it was written and false the moment
    the router grew its exit guard, which is the interesting part: the parity
    was asserted in prose, where nothing could check it.

Measured read-only on the live database 2026-08-26 (E2E Test & Associates
64e7bea6, Unicode Group fae87907 — the two in-scope organisations):

    E2E     band histogram totalled  60      payroll run paid  51
    Unicode band histogram totalled  24      payroll run paid  24

E2E's ten still-flagged leavers are the whole of that gap. Nine of them left in
July; one left on 3 August.

── THE ONE NUMBER THAT IS ALLOWED TO DIFFER, AND WHY ────────────────────────

The band histogram now totals 50 for E2E, not 51, and that is deliberate.

`salary_bands` is a STOCK as at today, so its bound is today: it counts people
on the rolls now. The payroll run is paying a MONTH, so its bound is the first
of that month: somebody who left on 3 August worked three days of it and is
owed them. Both are right, about different dates, and the two queries are kept
identical in every other respect — same table, same `status <> 'cancelled'`,
same strict `<`, same NULL handling, same org scoping — so that the ONLY thing
that can differ between them is the date they ask about.

`payroll_readiness` is not a stock at all. It audits a named month's run, so it
takes the run's bound exactly: `< month_start`. For August that keeps the man
who left on the 3rd in scope, because the run will pay him and a wrong bank
account would still bounce his money.

── WHY THE OFFLINE HALF IS NOT THE WHOLE STORY ──────────────────────────────

"A mock pool hides bad SQL" (CLAUDE.md). A MagicMock answers `[]` to valid SQL,
invalid SQL and a shopping list, and this repo has already shipped a string-scan
test — `assert "state" in sql` — that passed while the endpoint returned no
state. So the offline half asserts the guard is IN THE RIGHT CTE rather than
merely somewhere in the statement, and the live half runs both statements and
their pre-fix reconstructions against the real database and asserts an EQUALITY
on the rows that changed. Nothing here writes anything: `prepare()` sends Parse
and Describe and stops, and every other statement is a SELECT.

The live half skips with no database, which is how the whole suite behaves
(`test_skill_sql_is_valid.py` set the pattern). Run it with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_leavers_are_out_of_the_analytics_too.py -q
"""
import asyncio
import os
import re
from datetime import date

import pytest

from analytics.registry import REGISTRY, MetricRequest, load_all
from services.skills.data.payroll_readiness import check_payroll_readiness

load_all()
import analytics.metrics.vetana  # noqa: E402,F401 — registers on import

#: A fixture value, and deliberately not the seeded org's id even in part: the
#: offline pool is a fake, so this is only ever an argument to assert on, and an
#: id that LOOKS real gets copied into a live probe that then returns nothing.
ORG = "00000000-0000-4000-8000-000000000009"

#: The month the live figures above were measured in. Passed explicitly so this
#: file does not change its mind on the first of next month.
MONTH = "2026-08"

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing, and is recognised BY VALUE because `setdefault` means the
#: variable is never absent — a bare presence check would try to connect to a
#: host that does not exist and report the timeout as a failure.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What the app's own pool does on every connection (`db.py`), so a statement is
#: planned the way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These checks parse the two read surfaces' SQL against "
    "the real catalogue and compare the leaver guard against real rows; "
    "neither can be done offline. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_leavers_are_out_of_the_analytics_too.py -q"
)

#: The guard, as a pattern rather than a literal, so reformatting the SQL does
#: not fail the test but deleting the guard does. Applied to NORMALISED SQL.
_GUARD = re.compile(
    r"AND NOT EXISTS \( SELECT 1 FROM staging\.manav_offboarding x "
    r"WHERE x\.org_id = e\.org_id AND x\.employee_id = e\.id "
    r"AND x\.status <> 'cancelled' AND x\.last_working_day < (?P<bound>[^)]+)\) "
)


def norm(sql: str) -> str:
    return " ".join(sql.split())


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def bands_sql() -> str:
    """The SQL `vetana.salary_bands` actually builds, whitespace-normalised."""
    sql, params = REGISTRY["vetana.salary_bands"].sql(
        MetricRequest(org_id=ORG, window=None, bucket="month", group_by=None))
    assert params == [ORG], "salary_bands' parameters moved; the live half binds them"
    return norm(sql)


class _CapturePool:
    """Records the statement `check_payroll_readiness` issues and answers nothing.

    It holds no connection. The handler's own Python builds the SQL exactly as
    it would at run time; returning `[]` is honest here because the handler's
    only branch on the result is the severity split.
    """

    def __init__(self):
        self.statements: list[str] = []

    async def fetch(self, sql, *args):
        self.statements.append(sql)
        return []


def readiness_sql(month: str = MONTH) -> str:
    """The SQL `check_payroll_readiness` actually builds, whitespace-normalised."""
    pool = _CapturePool()
    asyncio.run(check_payroll_readiness(pool, ORG, month=month, limit=2000))
    assert len(pool.statements) == 1, (
        "payroll_readiness no longer issues exactly one statement; this file "
        "picks the roster out of it by name and needs updating: %d issued"
        % len(pool.statements))
    return norm(pool.statements[0])


def emp_cte(sql: str) -> str:
    """Just the `emp` CTE — the roster, which is the thing under test.

    Sliced out rather than scanned for whole-statement, because
    `struct_in_scope` sits in the same statement and a guard that landed in the
    wrong CTE would filter structures instead of people and still pass a
    substring assertion. That is the exact shape of the `assert "state" in sql`
    test this repo already shipped.
    """
    m = re.search(r"emp AS \((?P<body>.*?)\), (?:--|struct_in_scope AS)", sql)
    assert m, "no `emp AS (...)` CTE in payroll_readiness' statement: %s" % sql[:400]
    return m.group("body")


def strip_exit_guard(sql: str) -> str:
    """The statement as it was BEFORE this fix — the guard removed, nothing else.

    Used to run the old query against the live database beside the new one. It
    asserts it removed something, so a renamed guard fails here loudly instead
    of silently comparing a query with itself and reporting no difference.
    """
    out, n = _GUARD.subn("", sql)
    assert n == 1, (
        "expected exactly one offboarding guard to strip, found %d. The guard's "
        "shape changed, or it was deleted — either way the live comparison "
        "below would have compared a query with itself: %s" % (n, sql))
    return out


# ══════════════════════════════════════════════════════════════════════════
#  Offline — the shape of the guard, in the right CTE, on the right bound
# ══════════════════════════════════════════════════════════════════════════

def test_salary_bands_does_not_band_somebody_who_has_already_left():
    """THE DASHBOARD HALF. Ten E2E employees are `is_active` while holding a
    non-cancelled exit dated in the past, and all ten carry an active salary
    structure, so all ten were in the histogram."""
    sql = bands_sql()
    m = _GUARD.search(sql)
    assert m, (
        "vetana.salary_bands is back to trusting `is_active` alone, which ten "
        "live employees do not clear — the histogram totals 60 for an org "
        "whose payroll pays 51: %s" % sql)
    assert m.group("bound").strip() == "CURRENT_DATE", (
        "a stock as at today must bound the exit date on today, not on %r"
        % m.group("bound"))


def test_the_bands_guard_uses_the_runs_own_predicate_and_not_a_second_shape():
    """Same table, same vocabulary, same strictness as
    routers/vetana.py:1276-1287. Only the bound date is allowed to differ, and
    a `<=` here would quietly unband somebody on their last working day."""
    sql = bands_sql()
    assert "x.last_working_day <= " not in sql
    assert "x.status <> 'cancelled'" in sql, (
        "a cancelled exit now unbands somebody who never left; migration 083's "
        "unique index uses this same predicate so a mistaken exit can be redone")
    assert "x.org_id = e.org_id" in sql, (
        "manav_offboarding has no composite FK — without this, another org's "
        "exit row unbands this org's employee")


def test_payroll_readiness_audits_the_roster_the_run_will_actually_pay():
    """THE SKILL HALF, and the comment that made it survive review.

    The `emp` CTE called itself "exactly the rows routers/vetana.py would pick
    up" while being `is_active`-only. Nine E2E leavers were therefore audited
    for bank details and attendance for a month in which they are not paid.
    """
    emp = emp_cte(readiness_sql())
    m = _GUARD.search(emp)
    assert m, (
        "payroll_readiness' roster is `is_active`-only again, so it audits "
        "people the run does not pay: %s" % emp)
    assert m.group("bound").strip() == "b.month_start", (
        "the audited month's run drops exits dated before the month STARTS; "
        "this bounds on %r instead, so the two disagree about who is paid"
        % m.group("bound"))


def test_the_readiness_guard_is_bound_not_interpolated_and_costs_no_round_trip():
    """asyncpg bind parameters only, and the month bound comes from the `bounds`
    CTE that was already there rather than from a second read of $2."""
    sql = readiness_sql()
    emp = emp_cte(sql)
    assert "bounds b" in emp, (
        "the roster no longer reads the `bounds` CTE, so its month start comes "
        "from somewhere else: %s" % emp)
    assert MONTH not in sql, "the month is interpolated into the SQL, not bound"
    assert "$1::uuid" in emp, "the org filter lost its cast"


def test_the_two_bounds_are_deliberately_different_and_this_is_the_note():
    """A guard rail on the judgement call, not on the code.

    If someone later "fixes the inconsistency" by giving both surfaces the same
    bound, one of them becomes wrong: a stock bounded on a month start counts
    July's leavers all August, and a month's audit bounded on today drops the
    man who left on the 3rd and is still owed three days. This test is where
    that reasoning is written down in a place that fails.
    """
    def bound_of(sql: str, what: str) -> str:
        m = _GUARD.search(sql)
        assert m, f"{what} carries no exit guard at all: {sql[:400]}"
        return m.group("bound").strip()

    bands = bound_of(bands_sql(), "vetana.salary_bands")
    readiness = bound_of(emp_cte(readiness_sql()), "payroll_readiness' roster")
    assert bands == "CURRENT_DATE" and readiness == "b.month_start", (
        "the two bounds are %r and %r; they are not interchangeable — read the "
        "module docstring before making them agree" % (bands, readiness))


# ══════════════════════════════════════════════════════════════════════════
#  Live — parse against the real catalogue, and count real rows. READ ONLY.
# ══════════════════════════════════════════════════════════════════════════

def live(work):
    """Open a connection, run `work(conn)`, close it — all in ONE event loop.

    asyncpg binds a connection to the loop that created it, so a module-scoped
    connection handed to a second `asyncio.run()` dies with "another operation
    is in progress".

    A connection failure SKIPS; anything `work` raises propagates, so a real
    assertion can never be mistaken for a missing database.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    import asyncpg

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except Exception as exc:                              # noqa: BLE001
            return False, exc
        try:
            await conn.execute(_SEARCH_PATH)
            return True, await work(conn)
        finally:
            await conn.close()

    reached, value = asyncio.run(run())
    if not reached:
        pytest.skip(f"could not reach the database: {value}\n\n{SKIP_REASON}")
    return value


def test_live_both_statements_and_their_pre_fix_forms_parse():
    """`prepare()` sends Parse and Describe and STOPS: the server plans the
    statement and resolves every relation, column and parameter type. No row is
    read and none is written — which matters, because this is production's
    database as well as staging's.

    The pre-fix forms are parsed too: the live comparisons below run them, and a
    reconstruction that does not plan would skip those tests as a connection
    problem instead of failing as a broken regex.
    """
    statements = [bands_sql(), readiness_sql()]
    statements += [strip_exit_guard(s) for s in statements]

    async def work(conn):
        for sql in statements:
            await conn.prepare(sql)
        return len(statements)

    assert live(work) == 4


def test_live_the_histogram_now_totals_the_people_still_on_the_rolls():
    """2.1's dashboard half, PROVED ON REAL ROWS AND WITHOUT WRITING ONE.

    Runs the fixed histogram and the pre-fix one side by side over every org
    and asserts an EQUALITY, not a subset: the drop is exactly the count of
    people who would have been banded and hold a past exit date.

    Measured when written — E2E Test & Associates 60 → 50, Unicode Group
    24 → 24. The assertion is on the property so the numbers moving as leavers
    are properly deactivated does not turn this red; `dropped_total > 0` is
    what stops it passing with the guard deleted.
    """
    fixed, before = bands_sql(), strip_exit_guard(bands_sql())

    async def work(conn):
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM staging.vetana_salary_structures "
            " WHERE is_active = TRUE")]
        out = []
        for org in orgs:
            after_n = sum(r["value"] for r in await conn.fetch(fixed, org))
            before_n = sum(r["value"] for r in await conn.fetch(before, org))
            # The leavers among exactly the population the histogram bands —
            # an active structure effective today, and the employee flagged
            # active. Anything else would not have been in the before figure
            # either, and the equality below would be measuring two things.
            leavers = await conn.fetchval(
                "SELECT COUNT(DISTINCT s.employee_id) "
                "FROM staging.vetana_salary_structures s "
                "JOIN staging.manav_employees e ON e.id = s.employee_id "
                " AND e.org_id = s.org_id AND e.is_active = TRUE "
                "WHERE s.org_id = $1::uuid AND s.is_active = TRUE "
                " AND s.effective_from <= CURRENT_DATE "
                " AND EXISTS (SELECT 1 FROM staging.manav_offboarding x "
                "   WHERE x.org_id = e.org_id AND x.employee_id = e.id "
                "     AND x.status <> 'cancelled' "
                "     AND x.last_working_day < CURRENT_DATE)", org)
            out.append((str(org), before_n, after_n, leavers))
        return out

    results = live(work)
    assert results, "no org has an active salary structure"

    dropped_total = 0
    for org, before_n, after_n, leavers in results:
        dropped_total += before_n - after_n
        assert before_n - after_n == leavers, (
            f"org {org}: the histogram lost {before_n - after_n} people but "
            f"{leavers} hold a past exit date — the guard is removing the "
            f"wrong rows, or removing them twice")
    assert dropped_total > 0, (
        "the guard removed nobody anywhere, so this test would pass with the "
        "guard deleted. Ten employees held a past exit date on 2026-08-26; if "
        "they have since been deactivated, say so here rather than deleting "
        "this assertion.")


def test_live_readiness_stops_auditing_people_the_run_will_not_pay():
    """2.1's skill half, on real rows. The findings the fix removes must every
    one belong to somebody with a live exit dated before the month began.

    A subset assertion in one direction and an emptiness assertion in the
    other: nobody the fix drops is still on the rolls, and nobody it keeps has
    already left. Measured when written, E2E for 2026-08: nine people out.
    """
    fixed, before = readiness_sql(), strip_exit_guard(readiness_sql())
    month_start = date(2026, 8, 1)

    async def work(conn):
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM staging.manav_employees "
            " WHERE is_active = TRUE")]
        out = []
        for org in orgs:
            # `run_already_locked` carries no employee at all; it is not part of
            # the roster question and its NULL would join to everyone.
            kept = {r["employee_id"] for r in await conn.fetch(fixed, org, MONTH, 2000)
                    if r["employee_id"] is not None}
            all_rows = {r["employee_id"] for r in await conn.fetch(before, org, MONTH, 2000)
                        if r["employee_id"] is not None}
            left = {r["employee_id"] for r in await conn.fetch(
                "SELECT DISTINCT employee_id FROM staging.manav_offboarding "
                " WHERE org_id = $1::uuid AND status <> 'cancelled' "
                "   AND last_working_day < $2::date", org, month_start)}
            out.append((str(org), kept, all_rows, left))
        return out

    results = live(work)
    assert results, "no org has an active employee"

    dropped_total = 0
    for org, kept, all_rows, left in results:
        dropped = all_rows - kept
        dropped_total += len(dropped)
        assert dropped <= left, (
            f"org {org}: readiness stopped auditing {len(dropped - left)} "
            f"people who have no past exit date — a blocker for somebody who "
            f"IS being paid has just gone quiet")
        assert not (kept & left), (
            f"org {org}: {len(kept & left)} people whose last working day "
            f"predates {MONTH} are still being audited for its run")
    assert dropped_total > 0, (
        "readiness stopped auditing nobody anywhere, so this test would pass "
        "with the guard deleted. Nine E2E employees had an exit dated before "
        "2026-08-01 on 2026-08-26; if that is no longer true, move MONTH to a "
        "month that still has one rather than deleting this assertion.")


# ══════════════════════════════════════════════════════════════════════════════
# The headcount TILE, which is a stock and was reading a flag
# ══════════════════════════════════════════════════════════════════════════════

def test_the_dristi_headcount_tile_asks_who_is_on_the_rolls():
    """`/api/v1/dristi/overview` reports `hr.headcount`, and its own module
    docstring (`dristi.py:125`) calls headcount a STOCK — "who is on the rolls
    now". `is_active` alone does not answer that.

    AND THE FLAG IS NOT STALE DATA TO BE CLEANED. `routers/manav.py:1958`
    records that offboarding used to set `is_active=FALSE`, which dropped the
    person out of payroll the same day and left an outstanding salary advance
    unrecoverable — so a leaver KEEPS the flag until settlement, deliberately.
    Live 2026-08-26: two of E2E's ten still carry advances totalling 1,15,000.
    The data is right; the READ was asking the wrong question, and the tile
    said 83 where 73 were genuinely on the rolls.
    """
    import inspect
    import routers.dristi as dristi

    src = inspect.getsource(dristi)
    i = src.index("AS headcount")
    stmt = src[i - 400:i + 900]

    assert "manav_offboarding" in stmt, (
        "the headcount tile counts is_active alone, so everybody who has left "
        "but is awaiting settlement is still counted as staff:\n" + stmt
    )
    assert "x.status <> 'cancelled'" in stmt, (
        "a cancelled exit must not remove somebody from headcount — a mistaken "
        "resignation that was withdrawn leaves a cancelled row behind"
    )
    # The org predicate on the exit row: graha_clients taught this repo that a
    # join on the child id alone reaches another tenant's row.
    assert "x.org_id = e.org_id" in stmt, (
        "the offboarding lookup is not scoped to the org as well as the employee"
    )
