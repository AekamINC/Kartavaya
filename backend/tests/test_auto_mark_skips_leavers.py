"""/cron/hr was writing attendance for people who had already left.

Phase 2.6 — the same fault as 2.1 (`test_payroll_leavers_and_pt_slabs.py`) in a
second place: a query that decides who a nightly job acts on trusts
`manav_employees.is_active`, which is a flag somebody has to remember to clear,
instead of the last working day, which is a fact somebody already recorded.

`mark_holidays_weekends` selected `status = 'active' AND is_active = true` and
nothing else, so every Saturday, Sunday and compulsory holiday it wrote an
attendance row for everybody the flag still called active. Measured read-only
against the shared database 2026-08-26, over the two in-scope organisations:

    system-marked attendance rows dated after their employee's
    non-cancelled last working day .............................. 60
    ...the people they belong to ................................. 10
    ...the organisations ................. E2E Test & Associates only
    ...the dates ..... 2026-08-08, -09, -15 (Independence Day), -16, -22, -23
    ...post-exit rows NOT marked_by='system' ...................... 0

Every one of the sixty was written by this function; no human marked any of
them. The plan names one of the ten — 55d33071-39d4-468d-b657-c17504496172,
last working day 2026-08-03, exit `settled` — who collected six, the last of
them three weeks after he left.

Unicode Group holds one offboarding row and zero bad attendance rows, because
its leaver's employee record was ALSO deactivated by hand. That comparison is
the whole shape of the bug: the guard held exactly where a person remembered
to apply it, and nowhere else.

WHY THE BOUND IS THE DAY AND NOT THE MONTH
------------------------------------------
Payroll's guard compares the exit date against the START OF THE MONTH being
paid, because payroll's unit is a month and somebody who leaves mid-month is
owed a part-month. Auto-mark's unit is a DAY, and copying payroll's bound here
would keep marking anybody who left earlier in the same month.

That is not hypothetical. Of the sixty rows above, a month-start bound would
have prevented 54 and written the other six anyway — and those six are exactly
the ones belonging to the leaver the plan names, whose last working day falls
inside the month they were written in. Same query, read-only, 2026-08-26:

    all post-exit system rows ................. 60
    a month-start bound would have blocked .... 54
    a per-day bound would have blocked ........ 60

So the bound is `last_working_day < the day being marked`.

NULL KEEPS SOMEBODY IN THE RUN, exactly as payroll's guard documents. The
column is nullable, `NULL < date` is NULL, and NOT EXISTS therefore admits
them. An exit that has been started and not dated is not evidence that anyone
has gone, and a nightly job must not stop recording somebody's calendar on a
guess. `test_live_an_undated_exit_is_admitted_by_the_servers_own_semantics`
proves that on the server rather than asserting it about SQL in a docstring.

WHY NO ROW IS SEEDED
--------------------
Staging and production share one Supabase database (CLAUDE.md, "The one
dangerous fact"), so seeding a leaver would write a `manav_offboarding` row
into production. Nothing in this file writes anything anywhere — the live half
runs the fixed query and the OLD unguarded one side by side, read-only, and
compares the difference against the real exit rows.

The live half SKIPS with no database, which is how the whole suite behaves.
Run it with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_auto_mark_skips_leavers.py -q
"""
import asyncio
import inspect
import os
import re
from datetime import date

import pytest

from services.skills.action import attendance_auto_mark as auto
from services.skills.action.attendance_auto_mark import mark_holidays_weekends

#: E2E Test & Associates and Unicode Group — the two organisations in scope.
#: Everything measured in this file was measured over exactly these two.
E2E = "64e7bea6-6abe-490c-a2a4-27a60c6be916"
UNICODE = "fae87907-2f99-4b35-a241-c94d9e1e4a17"
IN_SCOPE = (E2E, UNICODE)

#: A Saturday auto-mark would write a 'weekend' row for, and one of the six
#: dates the sixty bad rows actually carry.
SAT = date(2026, 8, 22)

#: A state holiday, so the state-aware branch of the query can be captured too.
#: Both branches have to carry the guard: a fix applied to one of them leaves
#: the other marking leavers on every date that has no regional holiday on it,
#: which is most dates.
MH_HOLIDAY = {"id": "h1", "name": "Gudi Padwa", "state_code": "27"}

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing, and it is recognised BY VALUE because `setdefault` means
#: the variable is never absent — a bare presence check would try to connect to
#: a host that does not exist and report the timeout as a failure.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What the app's own pool does on every connection (`db.py`), so a statement is
#: planned the way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These checks parse auto-mark's SQL against the real "
    "catalogue and compare the leaver guard against real rows; neither can be "
    "done offline. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_auto_mark_skips_leavers.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


@pytest.fixture(autouse=True)
def forget_the_state_column_probe():
    """`_HAS_EMPLOYEE_STATE` is a module-level cache that outlives a test.

    Cleared both sides for the same reason
    `test_employee_state_and_regional_holidays.py` clears it: the order tests
    run in is not this file's business, and a True set by a neighbour would
    silently pick the wrong branch of the query to capture.
    """
    auto._HAS_EMPLOYEE_STATE = False
    yield
    auto._HAS_EMPLOYEE_STATE = False


# ══════════════════════════════════════════════════════════════════════════
#  Capture — the statements auto-mark actually issues. No database.
# ══════════════════════════════════════════════════════════════════════════

#: An offboarding row that exists but names no last working day. A distinct
#: sentinel rather than None, because "no exit row at all" and "an exit nobody
#: has dated" are different facts and the guard must treat only the second of
#: them as a question about NULL.
UNDATED = object()


class _CapturePool:
    """Records every statement, and answers employees honestly per branch.

    A MagicMock would answer the holiday query, the catalogue probe and the
    employee query with one canned value, which is how a mocked pool "proves" a
    filter that is not there. This routes on the SQL instead, and — for the
    behavioural tests — applies the offboarding predicate ONLY when the
    statement actually contains one.

    That last part is deliberately not a second implementation of the guard: it
    enforces what the SQL says, so these tests answer "does the query ask?".
    Whether the query MEANS it is what the live half below is for.
    """

    def __init__(self, *, holidays=(), employees=(), has_state_column=True):
        self.statements: list[tuple[str, tuple]] = []
        self._holidays = list(holidays)
        self._employees = list(employees)
        self._has_state = has_state_column
        self.inserted: dict[str, str] = {}

    def _record(self, sql, args):
        self.statements.append((sql, args))

    def find(self, needle: str) -> tuple[str, tuple]:
        for sql, args in self.statements:
            if needle in sql:
                return sql, args
        raise AssertionError(
            f"auto-mark issued no statement containing {needle!r}. It issued:\n"
            + "\n".join(re.sub(r"\s+", " ", s)[:110] for s, _ in self.statements))

    async def fetchval(self, sql, *args):
        self._record(sql, args)
        if "information_schema.columns" in sql:
            return self._has_state
        raise AssertionError(f"unexpected fetchval: {sql}")

    async def fetch(self, sql, *args):
        self._record(sql, args)
        if "manav_holidays" in sql:
            return self._holidays
        if "manav_employees" not in sql:
            raise AssertionError(f"unexpected fetch: {sql}")

        rows = self._employees
        if "manav_offboarding" in sql:
            # The statement asks, so answer as the database would. `args[1]` is
            # whatever it bound as the bound — read from the call rather than
            # assumed, so binding the wrong date shows up here as the wrong
            # people surviving instead of passing silently.
            bound = args[1]
            rows = [e for e in rows
                    if not (e["exit"] is not None and e["exit"] is not UNDATED
                            and e["exit"] < bound)]

        if "state" in sql.split("FROM")[0]:
            return [{"id": e["id"], "state": e.get("state")} for e in rows]
        # The pre-migration query does not select the state column at all, so
        # the rows it hands back cannot carry it. Modelled honestly: a fake that
        # returned it anyway would let a missing branch pass.
        return [{"id": e["id"]} for e in rows]

    async def fetchrow(self, sql, *args):
        self._record(sql, args)
        if "manav_attendance" in sql:
            return None
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def execute(self, sql, *args):
        self._record(sql, args)
        assert "manav_attendance" in sql, sql
        # (id, org_id, employee_id, date, status)
        self.inserted[args[2]] = args[4]
        return "INSERT 0 1"


def capture(*, holidays=(), employees=(), has_state_column=True,
            org=E2E, day=SAT) -> _CapturePool:
    pool = _CapturePool(holidays=holidays, employees=employees,
                        has_state_column=has_state_column)
    asyncio.run(mark_holidays_weekends(pool, org, day))
    return pool


def norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


@pytest.fixture
def plain():
    """The statement that runs on an ordinary weekend — no regional holiday, so
    no state probe. This is the shape that ran on five of the six dates the
    sixty bad rows carry."""
    sql, args = capture().find("FROM staging.manav_employees")
    return norm(sql), args


@pytest.fixture
def state_aware():
    """The other branch, taken when a holiday on the date names a state."""
    sql, args = capture(holidays=[MH_HOLIDAY]).find("FROM staging.manav_employees")
    return norm(sql), args


# ══════════════════════════════════════════════════════════════════════════
#  The guard
# ══════════════════════════════════════════════════════════════════════════

def test_the_weekend_query_excludes_anyone_whose_exit_predates_the_day(plain):
    """THE BLOCKER. Sixty attendance rows, ten people, all written by this
    query on dates after the day each of them had already stopped working."""
    sql, _args = plain
    assert "NOT EXISTS" in sql, (
        "the leaver guard is gone; auto-mark is back to trusting `is_active` "
        "alone, which ten live E2E employees do not clear: %s" % sql)
    assert "staging.manav_offboarding x" in sql, sql


def test_the_state_aware_query_carries_the_same_guard(state_aware):
    """Two branches, one rule. A guard added to one of them would leave the
    other marking leavers on every date that has no regional holiday on it —
    which is nearly every date, and is five of the six dates already damaged.
    """
    sql, _args = state_aware
    assert "staging.manav_offboarding x" in sql, (
        "the state-aware branch has no leaver guard, so a date with a regional "
        "holiday on it still marks people who have left: %s" % sql)


def test_the_bound_is_the_day_being_marked_and_not_the_month(plain):
    """Bound, not interpolated, and checked BY VALUE — a reordering of the
    parameters cannot pass this.

    The distinction the value carries is the point of 2.6: auto-mark runs per
    day, and a month-start bound would have written six of the sixty rows
    anyway (see the module docstring for the live figures).
    """
    _sql, args = plain
    assert args[0] == E2E
    assert args[1] == SAT, (
        "the second parameter is not the day being marked, so the guard is "
        "comparing the exit date against something else: %r" % (args,))
    assert isinstance(args[1], date)


def test_the_comparison_is_strict_so_a_last_day_is_still_marked(plain):
    """`<`, never `<=`: somebody whose last working day IS this Saturday was
    still on the rolls on it, and a 'weekend' row for that date is true."""
    sql, _args = plain
    assert "x.last_working_day < $2::date" in sql, (
        "the guard no longer compares the exit date against the bound day: %s"
        % sql)
    assert "x.last_working_day <= " not in sql


def test_the_bound_parameter_is_cast(plain):
    """PgBouncer turns an untyped parse error into an instant 500 — this
    product has already lost every credit spend to exactly that (`$1 + $2`
    unqualified). Every parameter in this module names its type."""
    sql, _args = plain
    assert "$1::uuid" in sql and "$2::date" in sql, sql


def test_a_cancelled_exit_does_not_stop_somebody_being_marked(plain):
    """Migration 083's own vocabulary, and the same predicate its
    `one_live_per_employee` unique index uses, so a mistaken exit can be
    cancelled and redone. Live statuses in the two orgs, read-only 2026-08-26:
    completed 3, in_clearance 3, initiated 2, settled 3, cancelled 0."""
    sql, _args = plain
    assert "x.status <> 'cancelled'" in sql, (
        "a cancelled exit now stops auto-mark recording somebody who never "
        "left: %s" % sql)


def test_the_exit_row_is_scoped_to_the_org_as_well_as_the_employee(plain):
    """There is no composite foreign key from `manav_offboarding` to
    `manav_employees` — migration 083 says so in its header — so this predicate
    is the only thing stopping another org's exit row silencing this org's
    calendar."""
    sql, _args = plain
    assert "x.org_id = e.org_id" in sql and "x.employee_id = e.id" in sql, sql


def test_the_active_flag_is_still_required_as_well(plain):
    """The exit date is added TO `is_active`, not swapped for it. Somebody
    deactivated with no offboarding row at all — Unicode's one leaver is
    exactly that — must stay out."""
    sql, _args = plain
    assert "is_active = true" in sql, sql
    assert "status = 'active'" in sql, sql


def test_the_guard_is_the_hr_paths_shape_and_not_a_third_one():
    """`analytics/metrics/manav.py:_headcount_asat` already answers "was this
    person on the rolls at date d", and payroll's Phase 2.1 guard is that
    predicate negated. Auto-mark asks the same question about the day it is
    marking, so it must ask it the same way — three shapes for one question is
    how the three come to disagree.
    """
    from analytics.metrics import manav as hr

    hr_sql = norm(inspect.getsource(hr._headcount_asat))
    for piece in ("staging.manav_offboarding x",
                  "x.org_id = e.org_id AND x.employee_id = e.id",
                  "x.status <> 'cancelled'",
                  "x.last_working_day"):
        assert piece in hr_sql, (
            "the HR path this guard was mirrored from has changed shape (%r is "
            "gone). Re-derive the auto-mark guard from it rather than leaving "
            "the two to drift." % piece)

    sql, _args = capture().find("FROM staging.manav_employees")
    for piece in ("staging.manav_offboarding x",
                  "x.org_id = e.org_id AND x.employee_id = e.id",
                  "x.status <> 'cancelled'"):
        assert piece in norm(sql), piece


# ══════════════════════════════════════════════════════════════════════════
#  Who ends up with a row — the same question, asked at the INSERT
# ══════════════════════════════════════════════════════════════════════════

STAYER = {"id": "emp-stayer", "exit": None}
#: The leaver the plan names, to the day: last working day 2026-08-03, marked
#: 'weekend' on 2026-08-22 among five others.
LEFT_EARLIER_THIS_MONTH = {"id": "emp-left", "exit": date(2026, 8, 3)}
#: Unicode's live case: a completed exit dated 2026-08-28, still in the future
#: on the day being marked. Serving notice is working.
ON_NOTICE = {"id": "emp-notice", "exit": date(2026, 8, 28)}
#: The last working day IS the day being marked.
LAST_DAY_IS_TODAY = {"id": "emp-lastday", "exit": SAT}
#: An exit somebody started and nobody dated.
UNDATED_EXIT = {"id": "emp-undated", "exit": UNDATED}


class TestWhoGetsAWeekendRow:
    """These read the INSERTs rather than the SQL, so the failure message is
    the defect in the owner's words — "he got an attendance row" — rather than
    a missing substring. The fake applies the predicate the statement states
    (see `_CapturePool`), so this proves the query ASKS; the live half proves
    the database answers the same way.
    """

    def test_a_leaver_gets_no_row(self):
        pool = capture(employees=[STAYER, LEFT_EARLIER_THIS_MONTH])
        assert "emp-left" not in pool.inserted, (
            "somebody whose last working day was 2026-08-03 was marked "
            "'weekend' on 2026-08-22, three weeks after he left")
        assert pool.inserted == {"emp-stayer": "weekend"}

    def test_somebody_serving_notice_is_still_marked(self):
        """An exit dated in the future is not an exit yet. Unicode's single
        offboarding row is exactly this case."""
        pool = capture(employees=[ON_NOTICE])
        assert pool.inserted == {"emp-notice": "weekend"}

    def test_the_last_working_day_itself_is_still_marked(self):
        """They were on the rolls that day; the calendar for it is true."""
        pool = capture(employees=[LAST_DAY_IS_TODAY])
        assert pool.inserted == {"emp-lastday": "weekend"}

    def test_an_undated_exit_keeps_being_marked(self):
        """An exit nobody has dated is not evidence anybody has gone. Same rule
        payroll's guard documents, and the reason the predicate is a NOT EXISTS
        over a `<` rather than an `IS NULL` test."""
        pool = capture(employees=[UNDATED_EXIT])
        assert pool.inserted == {"emp-undated": "weekend"}

    def test_a_leaver_gets_no_holiday_row_either(self):
        """Independence Day 2026-08-15 is one of the six damaged dates, and it
        is a holiday, not a weekend — the branch that runs on it is the other
        one."""
        pool = capture(holidays=[MH_HOLIDAY],
                       employees=[STAYER, LEFT_EARLIER_THIS_MONTH])
        assert "emp-left" not in pool.inserted, (
            "the state-aware branch still marks leavers")
        assert pool.inserted == {"emp-stayer": "holiday"}

    def test_the_pre_migration_branch_guards_too(self):
        """Migration 220 is applied, but this module keeps a fallback for the
        window in which code is deployed and a migration is not. A guard that
        lives only in the post-migration shape is a guard that vanishes in
        exactly the window most likely to go unwatched."""
        pool = capture(holidays=[MH_HOLIDAY], has_state_column=False,
                       employees=[STAYER, LEFT_EARLIER_THIS_MONTH])
        assert pool.inserted == {"emp-stayer": "holiday"}


def test_this_query_is_the_only_thing_that_decides_who_gets_a_row():
    """The step between "not in the query" and "not marked", written down.

    No row is seeded, so "the leaver is not marked" is proved at the query that
    decides who is marked rather than at the row that would have been written.
    That substitution is only sound while the query is the SOLE source of who
    is marked — so this pins exactly that: one attendance INSERT in the whole
    function, inside the loop over the rows this query returned.
    """
    src = inspect.getsource(mark_holidays_weekends)
    assert src.count("INSERT INTO staging.manav_attendance") == 1, (
        "auto-mark writes attendance from more than one place; excluding a "
        "leaver from the employee query no longer excludes them from the run")
    loop = "for emp in employees:"
    assert src.count(loop) == 1
    assert src.index("INSERT INTO staging.manav_attendance") > src.index(loop)


# ══════════════════════════════════════════════════════════════════════════
#  Live — parse against the real catalogue, and count real rows. READ ONLY.
# ══════════════════════════════════════════════════════════════════════════

def live(work):
    """Open a connection, run `work(conn)`, close it — all in ONE event loop.

    asyncpg binds a connection to the loop that created it, so a module-scoped
    connection handed to a second `asyncio.run()` dies with "another operation
    is in progress". One loop per test is the cheap and correct shape.

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


def _both_employee_statements() -> list[str]:
    """Both branches, captured. The state-aware one is issued only when a
    regional holiday falls on the date, so it would never appear in an
    ordinary run — and an unparsed statement is exactly how a router ships a
    column that has never existed."""
    return [
        norm(capture().find("FROM staging.manav_employees")[0]),
        norm(capture(holidays=[MH_HOLIDAY]).find("FROM staging.manav_employees")[0]),
    ]


def test_live_every_statement_auto_mark_now_issues_parses():
    """THE ONE THING A MOCK POOL CANNOT PROVE. A MagicMock answers `[]` to a
    column that has never existed, which is how `manav_holidays.is_active`
    shipped and left /cron/hr answering 500 for months.

    `prepare()` sends Parse and Describe and STOPS: the server plans the
    statement and resolves every relation, column and parameter type. No row is
    read and none is written — which matters, because this is production's
    database as well as staging's.
    """
    statements = _both_employee_statements()

    async def work(conn):
        for sql in statements:
            await conn.prepare(sql)
        return len(statements)

    assert live(work) == 2
    assert all("manav_offboarding" in s for s in statements)


def test_live_an_undated_exit_is_admitted_by_the_servers_own_semantics():
    """The NULL rule, proved by the server rather than argued in a comment.

    `last_working_day` is nullable (migration 083; confirmed against
    information_schema 2026-08-26). If `NULL < date` were anything but NULL,
    NOT EXISTS would drop everybody holding an undated exit and a started-but-
    unfinished offboarding would silently stop somebody's calendar.
    """
    async def work(conn):
        return await conn.fetchval(
            "SELECT NOT EXISTS (SELECT 1 WHERE $1::date < $2::date)",
            None, SAT)

    assert live(work) is True


def test_live_the_fix_removes_exactly_the_people_who_had_already_left():
    """2.6, PROVED ON REAL ROWS AND WITHOUT WRITING ONE.

    Runs the guarded query and the OLD unguarded one side by side, read-only,
    over the two in-scope orgs, and asserts three things about the difference:

      · everyone the fix drops holds a non-cancelled exit dated before the day;
      · nobody the fix keeps does;
      · the fix drops somebody — otherwise this test proves nothing and would
        keep passing after the guard was deleted.

    Measured when written: E2E 83 employees eligible, 73 after the guard;
    Unicode 26 and 26, because its one leaver was deactivated by hand. The
    assertion is on the PROPERTY, not on 10, so the number moving as leavers
    are properly deactivated does not turn this red.
    """
    guarded = norm(capture().find("FROM staging.manav_employees")[0])
    unguarded = re.sub(
        r"AND NOT EXISTS \(.*?x\.last_working_day < \$2::date\)\s*", "", guarded)
    assert "NOT EXISTS" not in unguarded, (
        "could not reconstruct the pre-fix query; the guard's shape changed")

    async def work(conn):
        out = []
        for org in IN_SCOPE:
            kept = {r["id"] for r in await conn.fetch(guarded, org, SAT)}
            everyone = {r["id"] for r in await conn.fetch(unguarded, org)}
            left = {r["employee_id"] for r in await conn.fetch(
                "SELECT DISTINCT employee_id FROM staging.manav_offboarding "
                " WHERE org_id = $1::uuid AND status <> 'cancelled' "
                "   AND last_working_day < $2::date", org, SAT)}
            out.append((org, kept, everyone, left))
        return out

    dropped_total = 0
    for org, kept, everyone, left in live(work):
        dropped = everyone - kept
        dropped_total += len(dropped)
        assert dropped <= left, (
            f"org {org}: the guard dropped {len(dropped - left)} people who "
            f"hold no past exit date — it is removing the wrong rows")
        assert not (kept & left), (
            f"org {org}: {len(kept & left)} people with a last working day "
            f"before {SAT} are still being marked")
    assert dropped_total > 0, (
        "the guard removed nobody in either org, so this test would pass with "
        "the guard deleted. Ten E2E employees held a past exit date on "
        "2026-08-26; if they have since been deactivated, pick a date that "
        "still has one rather than deleting this assertion.")


def test_live_the_guard_would_have_prevented_every_row_already_written():
    """The sixty, replayed. Nothing is deleted — the existing rows are the
    owner's to decide about — but each one is checked against the fixed query
    for the org and DATE it carries, and none of them may survive it.

    This is what makes the per-day bound a measurement rather than an opinion:
    run the same replay with the month-start bound payroll uses and six rows
    come back.
    """
    guarded = norm(capture().find("FROM staging.manav_employees")[0])

    async def work(conn):
        bad = await conn.fetch(
            "SELECT a.org_id, a.employee_id, a.date "
            "  FROM staging.manav_attendance a "
            "  JOIN staging.manav_offboarding o "
            "    ON o.org_id = a.org_id AND o.employee_id = a.employee_id "
            "   AND o.status <> 'cancelled' "
            " WHERE a.org_id = ANY($1::uuid[]) AND a.marked_by = 'system' "
            "   AND o.last_working_day < a.date",
            list(IN_SCOPE))
        survivors = []
        for row in bad:
            still = await conn.fetchval(
                f"SELECT EXISTS (SELECT 1 FROM ({guarded}) q WHERE q.id = $3::uuid)",
                row["org_id"], row["date"], row["employee_id"])
            if still:
                survivors.append((str(row["employee_id"]), str(row["date"])))
        return len(bad), survivors

    total, survivors = live(work)
    assert not survivors, (
        f"{len(survivors)} of the {total} attendance rows already written "
        f"after their employee's exit would STILL be written by the fixed "
        f"query: {survivors[:5]}")
    assert total > 0, (
        "no post-exit system-marked attendance row exists any more, so this "
        "replay proves nothing. Sixty existed on 2026-08-26; if they have been "
        "cleaned up, say so here rather than deleting the check.")
