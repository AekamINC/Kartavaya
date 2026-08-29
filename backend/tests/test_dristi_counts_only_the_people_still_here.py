"""Dristi's other three employee reads went on counting the people who left.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────

`GET /dristi/overview` learned to ask `manav_offboarding` who is still on the
rolls. Three more reads over the same register — two of them in the same
router, one of them the export of the very tile that was fixed — kept trusting
`manav_employees.is_active` alone:

  · `_fetch_report_data(..., "hr")` — `active_employees`, the CSV/PDF twin of
    the headcount tile. Live 2026-08-26, E2E Test & Associates: **83 against a
    true 73**. A partner mails that file to a client.

  · `GET /dristi/hr` — `dept_breakdown`, the department histogram. Live:
    **Accounts 8→6, Payroll 8→6, Taxation 8→7, Compliance 8→7**, and
    Administration, Advisory, Audit and IT 7→6 each. Ten people counted into
    departments they left up to seven weeks ago.

  · `POST /dristi/query` with `source=employees` — the custom-dashboard pivot,
    a widget a customer builds and pins to their own screen. Live **83 → 73**
    ungrouped, and `status` grouped read `{'active': 83}` for an org where
    seventy-three people are actually employed.

Unicode Group holds no offboarding rows at all and stays at 26 across all
three. That is the control: the guard removes leavers, not people.

── THE FLAG IS NOT STALE DATA, AND THAT IS THE WHOLE POINT ──────────────────

`routers/manav.py:1958` records that offboarding used to set
`is_active=FALSE`, which dropped the person out of payroll the same day and
left an outstanding salary advance unrecoverable. So a leaver KEEPS the flag
until settlement, deliberately — live, two of E2E's ten carry advances
totalling ₹1,15,000, and their exits sit at `initiated`, `in_clearance`,
`completed` and `settled`. A live workflow, not corruption. Nothing may be
"cleaned"; the READS have to ask the right question, which is what this file
pins.

── WHY THE PREDICATE IS COMPARED AS TEXT, VERBATIM ──────────────────────────

Twenty-five hand-written copies of this guard is the failure
`services/on_the_rolls.py` exists to prevent, and drift between two copies is
not a syntax error — it is two headcounts on two screens that disagree by one
person on one day. So `test_every_employee_read_carries_the_same_predicate`
asserts the fragment the shared module emits appears CHARACTER FOR CHARACTER
(whitespace normalised) in all four statements, `/overview`'s included. The
one inlined copy left in the router is `/overview`'s own, which predates the
module; that test is what keeps it honest.

── STOCK, INCLUDING THE ONE THAT LOOKS LIKE A FLOW ──────────────────────────

All four are stocks — "who is on the rolls NOW". The pivot is the only
arguable one, because `employees` declares `date_col: date_of_joining`, so a
dated pivot reads "of the people who joined in this window, how many …". That
is still a stock cut by a cohort, not a flow: `manav_employees` holds one row
per PERSON, never one per period, and the source already declares
`soft_delete`, so a hand-deactivated employee has always dropped out of it.
The guard makes the source consistent with what it already claimed to be.
`test_the_dated_pivot_keeps_the_guard` pins that decision so it is reversed
deliberately or not at all.

── THE TWO HALVES ───────────────────────────────────────────────────────────

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock
answers `[]` to valid SQL, invalid SQL and a shopping list. So, the shape
`test_dristi_overview_excludes_drafts.py` established:

  1. CAPTURE, offline. The callables run against a pool that records the
     statement and the arguments bound to it. Runs everywhere.
  2. PARSE AND EXECUTE, live. Every captured statement is planned against the
     real catalogue, then run with its own caller's arguments, and each
     employee read is run TWICE — as written and with the guard textually
     removed. The difference between the two answers is the leavers, and it is
     asserted to equal them exactly: a guard that removed one person too many
     would pass "the number moved" and fail here.

Everything against the live database is a SELECT. Staging and production share
one Supabase project (CLAUDE.md), so that is not a nicety.

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_dristi_counts_only_the_people_still_here.py -q
"""
from __future__ import annotations

import asyncio
import os
import re

import pytest

from routers import dristi as dr
from services.on_the_rolls import still_on_the_rolls

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognised BY VALUE because conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` does on every connection, so a statement is planned the way it
#: will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

USER = {"user_id": "user_admin001"}

#: An org id that matches nothing, so every captured statement replayed live is
#: a zero-row SELECT. The bind, not the answer, is what those replays measure.
ORG = "00000000-0000-0000-0000-0000000000aa"

#: The two orgs this work is scoped to (owner decision). The live half reads
#: only these; a gap that exists only in Aekam/Demo is not a defect here.
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"
UNICODE_ORG = "fae87907-2f99-4b35-a241-c94d9e1e4a17"
IN_SCOPE = (E2E_ORG, UNICODE_ORG)

#: Dates as STRINGS, which is what FastAPI hands the pivot off the request body.
PERIOD = ("2020-01-01", "2026-08-26")


def _norm(sql: str) -> str:
    return " ".join(sql.split())


def _tight(sql: str) -> str:
    """`_norm`, plus the space a hand-indented sub-select leaves after `(`.

    `/overview` writes its copy of the guard across five indented lines and the
    shared module emits it on one. Those are the same predicate, and this file
    is about whether they say the same THING — so the one difference whitespace
    normalisation cannot reach is closed here rather than by weakening the
    comparison to a fuzzy match.
    """
    return re.sub(r"\(\s+", "(", _norm(sql))


#: The predicate itself, taken from the shared module rather than retyped. If
#: `on_the_rolls.py` changes its mind — a fourth clause, a different boundary —
#: every assertion below moves with it, which is the point of it being one
#: module. The alias is `e` because that is what every employee read in this
#: router calls the table.
CANONICAL = _tight(still_on_the_rolls("e"))


# ══════════════════════════════════════════════════════════════════════════════
#  Capture — no database, no writes
# ══════════════════════════════════════════════════════════════════════════════

class CapturePool:
    """Records every statement, with the arguments its caller bound."""

    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    @property
    def statements(self) -> list[str]:
        return [s for s, _ in self.calls]

    def _record(self, sql, args=()):
        if isinstance(sql, str) and sql.strip():
            self.calls.append((sql, tuple(args)))

    async def fetch(self, sql, *args, **kwargs):
        self._record(sql, args)
        return []

    async def fetchrow(self, sql, *args, **kwargs):
        self._record(sql, args)
        return None

    async def fetchval(self, sql, *args, **kwargs):
        self._record(sql, args)
        return 0

    async def execute(self, sql, *args, **kwargs):
        self._record(sql, args)
        return "SELECT 0"


def _capture(coro_factory) -> CapturePool:
    """Every statement one Dristi callable issues, with `get_pool` swapped out.

    `reachable_modules` is answered YES for whatever it is asked: the
    entitlement check is not what is under test, and `/dristi/hr` raises 403
    outright without `manav`, which would skip the very read this file is about.
    An exception on the way out is not a failure of the harness — the statements
    it managed to issue are the subject.
    """
    pool = CapturePool()
    original_pool, original_reach = dr.get_pool, dr.reachable_modules

    async def _get_pool():
        return pool

    async def _reachable(pool_, user_id, org_id, codes):
        return set(codes)

    dr.get_pool, dr.reachable_modules = _get_pool, _reachable
    try:
        try:
            asyncio.run(coro_factory())
        except Exception:                                     # noqa: BLE001
            pass
    finally:
        dr.get_pool, dr.reachable_modules = original_pool, original_reach
    return pool


@pytest.fixture(scope="module")
def overview_pool() -> CapturePool:
    """The headcount tile — already fixed, captured as the reference.

    It is here so the three surfaces below can be compared against a number
    that is already right, rather than against a second opinion.
    """
    return _capture(lambda: dr.overview(
        date_from="", date_to="", user=USER, org_id=ORG, _g=None,
    ))


@pytest.fixture(scope="module")
def report_hr_pool() -> CapturePool:
    """`_fetch_report_data(..., "hr")` — the tile's CSV and PDF twin.

    A plain function with no gate to fake, so it takes the capture pool
    directly. `win=None` is what a scheduled report passes.
    """
    pool = CapturePool()
    try:
        asyncio.run(dr._fetch_report_data(pool, ORG, "hr", None))
    except Exception:                                         # noqa: BLE001
        pass
    return pool


@pytest.fixture(scope="module")
def hr_pool() -> CapturePool:
    """`GET /dristi/hr` — the department histogram."""
    return _capture(lambda: dr.hr_analytics(
        date_from="", date_to="", user=USER, org_id=ORG, _g=None,
    ))


@pytest.fixture(scope="module")
def pivot_employees_pool() -> CapturePool:
    """`source=employees, group_by=department` — the pinned customer widget."""
    body = dr.PivotQuery(source="employees", group_by="department", measure="count")
    return _capture(lambda: dr.run_pivot_query(body=body, user=USER, org_id=ORG))


@pytest.fixture(scope="module")
def pivot_employees_dated_pool() -> CapturePool:
    """The same source WITH a window, which lands on `date_of_joining`.

    Captured separately because this is the branch where "stock or flow" is a
    real question, and because the guard has to survive being concatenated
    alongside the date clauses rather than instead of them.
    """
    body = dr.PivotQuery(source="employees", group_by="department",
                         measure="count", date_from=PERIOD[0], date_to=PERIOD[1])
    return _capture(lambda: dr.run_pivot_query(body=body, user=USER, org_id=ORG))


@pytest.fixture(scope="module")
def pivot_employees_crosstab_pool() -> CapturePool:
    """`group_by` AND `group_by2` — a third statement shape, not a variation.

    The cross-tab branch builds its own SELECT and its own ORDER BY, so it is
    the one that would be left behind by a fix applied to "the pivot query"
    rather than to the clause all three share.
    """
    body = dr.PivotQuery(source="employees", group_by="department",
                         group_by2="employment_type", measure="count")
    return _capture(lambda: dr.run_pivot_query(body=body, user=USER, org_id=ORG))


@pytest.fixture(scope="module")
def pivot_orders_pool() -> CapturePool:
    """A source with no offboarding register anywhere near it.

    `soft_delete` is a GENERIC flag every source declares. If the guard were
    hung off that flag instead of its own, `staging.vikray_orders` would join
    `manav_offboarding` on `e.id` and become an UndefinedColumn 500 — a new
    outage in place of a wrong number.
    """
    body = dr.PivotQuery(source="orders", group_by="status", measure="sum")
    return _capture(lambda: dr.run_pivot_query(body=body, user=USER, org_id=ORG))


def _employee_reads(pool: CapturePool) -> list[str]:
    return [s for s in pool.statements if "manav_employees" in s]


#: Every surface that answers "how many people work here", and the fixture that
#: captures it. `/overview` leads because it is the one already right.
#: Every STOCK read of `manav_employees` in this router. One definition of "on
#: the rolls", not five that drift.
#:
#: The DATED pivot is deliberately absent: with `date_from`/`date_to` that
#: source filters `date_of_joining` and becomes "who joined inside this window",
#: a cohort over a past period — a FLOW, which must never carry the guard or a
#: hiring chart silently drops everyone who has since left.
#: `test_the_dated_pivot_does_NOT_carry_the_guard` pins that, and it is listed
#: here as a comment rather than omitted silently so the next reader sees the
#: exclusion was a decision.
SURFACES = (
    ("/dristi/overview headcount", "overview_pool"),
    ("/dristi/reports?type=hr active_employees", "report_hr_pool"),
    ("/dristi/hr dept_breakdown", "hr_pool"),
    ("/dristi/query source=employees", "pivot_employees_pool"),
    ("/dristi/query source=employees, cross-tab", "pivot_employees_crosstab_pool"),
)


# ══════════════════════════════════════════════════════════════════════════════
#  The capture half — runs everywhere, including with no database
# ══════════════════════════════════════════════════════════════════════════════

def test_the_capture_sees_every_surface(request):
    """Guard on the harness itself.

    If capture silently stopped working, every assertion below would pass by
    inspecting nothing — the exact failure mode this file exists to end,
    reproduced inside it.
    """
    for name, fixture in SURFACES:
        pool = request.getfixturevalue(fixture)
        got = len(_employee_reads(pool))
        assert got == 1, (
            f"{name} issued {got} reads against manav_employees, expected 1. "
            f"The capture is no longer seeing the caller.")


def test_every_employee_read_carries_the_same_predicate(request):
    """One definition of "on the rolls", not five that drift.

    Compared verbatim rather than by feature, because the ways these can
    disagree are not syntax errors: `<=` instead of `<` moves one person on one
    day, a missing `status <> 'cancelled'` deletes a withdrawn resignation from
    headcount for ever, and a join on `employee_id` alone reads another
    tenant's exit row. Each of those was got wrong somewhere before
    `services/on_the_rolls.py` existed, and none of them would fail a test that
    only looked for the words `manav_offboarding`.
    """
    for name, fixture in SURFACES:
        [sql] = _employee_reads(request.getfixturevalue(fixture))
        assert CANONICAL in _tight(sql), (
            f"{name} counts people who have left, or asks about them "
            f"differently from every other surface.\n"
            f"  expected: {CANONICAL}\n"
            f"  in      : {_tight(sql)}")


def test_the_router_takes_the_predicate_from_the_shared_module(request):
    """The fragment must come from `services/on_the_rolls.py`, not be retyped.

    One inlined copy is allowed to remain — `/overview`'s, which predates the
    module — and the test above is what stops it drifting. A SECOND inlined
    copy is how twenty-five became twenty-five, so it is refused here.
    """
    import inspect

    src = inspect.getsource(dr)
    assert dr.still_on_the_rolls is still_on_the_rolls, (
        "routers/dristi.py no longer imports the shared predicate")
    inlined = src.count("public.manav_offboarding")
    assert inlined == 1, (
        f"{inlined} statements in routers/dristi.py name public.manav_offboarding "
        f"in their own SQL. Exactly one is expected — the `/overview` headcount "
        f"tile, written before services/on_the_rolls.py existed. Every other "
        f"employee read must call still_on_the_rolls(), or the definition "
        f"forks again.")
    assert src.count("still_on_the_rolls(") >= 3, (
        "fewer than three call sites of still_on_the_rolls() in this router; "
        "the reports, hr and pivot reads each need one")


def test_the_guard_is_declared_on_the_source_not_on_soft_delete():
    """`soft_delete` is generic; the offboarding register is not.

    All eight pivot sources declare `soft_delete`. Only `manav_employees` has
    an exit register, so a guard hung off the generic flag would correlate
    `staging.manav_offboarding` against `vikray_orders.id` — the same mistake
    the draft filter avoided by being declared per source.
    """
    flagged = {name for name, spec in dr._ALLOWED_QUERY_TABLES.items()
               if spec.get("on_the_rolls")}
    assert flagged == {"employees"}, (
        f"sources declaring the on-the-rolls guard: {sorted(flagged)}. Only "
        f"`employees` reads public.manav_employees; every other table in the "
        f"builder would be joined to an offboarding row that cannot mean "
        f"anything about it.")
    assert all(spec.get("soft_delete") for spec in dr._ALLOWED_QUERY_TABLES.values()), (
        "a source stopped declaring soft_delete — re-read the check above, it "
        "assumes the two flags are independent")


def test_a_source_with_no_exit_register_is_left_alone(pivot_orders_pool):
    """`staging.vikray_orders` has no `manav_offboarding` row and never will."""
    assert pivot_orders_pool.statements, "the orders pivot issued nothing"
    for sql in pivot_orders_pool.statements:
        assert "manav_offboarding" not in sql, (
            f"the orders pivot now joins the offboarding register:\n"
            f"  {_norm(sql)[:200]}")


#: The window predicate the assertion above assumes is present.
DOJ_WINDOW = r"date_of_joining\s*>=\s*\$\d+::text::date"


def test_the_dated_pivot_does_NOT_carry_the_guard(pivot_employees_dated_pool):
    """The judgement call, reversed on review, and written down so reversing it
    back is deliberate rather than accidental.

    A dated `employees` pivot filters `date_of_joining`, and
    `frontend/src/pages/dristi/PivotTab.jsx` posts `date_from`/`date_to` for
    anything except "All time". So with a window this source is not "who is on
    the rolls" — it is "who JOINED inside these dates, by department", a cohort
    over a past period, which is a FLOW.

    Guarding it there erases anybody who joined inside the window and has since
    left. A hiring chart that silently drops your leavers is worse than one that
    counts them, and it is the exact failure mode the stock/flow rule exists to
    prevent: a number that quietly rewrites history.

    The first version of this file guarded it and defended the choice on the
    grounds that the source "has ALWAYS applied `is_active=TRUE`, so a
    hand-deactivated employee already dropped out". That argument does not
    survive this codebase's own terms — `is_active` is precisely the flag a
    leaver KEEPS until settlement (`routers/manav.py:1958`), so it never removed
    the people this guard would.

    Unwindowed the source has no period at all, so it can only mean the present,
    and the present is a stock — `test_the_undated_pivot_keeps_the_guard` pins
    that half.
    """
    [sql] = _employee_reads(pivot_employees_dated_pool)
    assert CANONICAL not in _tight(sql), (
        "the dated employees pivot carries the on-the-rolls guard, so anybody "
        "who joined inside the window and has since left has been erased from "
        "a hiring cohort: " + _norm(sql))
    assert re.search(DOJ_WINDOW, sql), (
        "the dated pivot no longer filters date_of_joining the way this test "
        "assumes; re-read it before trusting the sentence above: " + _norm(sql))


def test_the_pivot_still_binds_its_period_as_strings(pivot_employees_dated_pool):
    """Guard on the check above: it means something only because the route is
    handed `str`, which is what FastAPI parses the request body into."""
    [(_, args)] = [(s, a) for s, a in pivot_employees_dated_pool.calls
                   if "manav_employees" in s]
    assert args[1:] == PERIOD, (
        f"the employees pivot no longer binds the period as ISO strings "
        f"({args[1:]!r}); re-read the cast check above before trusting it")


# ══════════════════════════════════════════════════════════════════════════════
#  The live half — parse, then execute read-only
# ══════════════════════════════════════════════════════════════════════════════

SKIP_REASON = (
    "no live database. These checks run each employee read against the real "
    "catalogue, once as written and once with the on-the-rolls guard removed — "
    "a MagicMock pool answers [] to both and proves nothing. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_dristi_counts_only_the_people_still_here.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def _live(fn):
    """Run one read-only coroutine against the live database, or skip.

    Only the CONNECT is allowed to turn into a skip. Once the socket is open,
    whatever `fn` raises is raised — a blanket `except` around the whole block
    reports a broken query as "could not reach the database", which is how a
    defect gets to look like an absent fixture.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    import asyncpg

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except Exception as exc:                              # noqa: BLE001
            pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")
        try:
            await conn.execute(_SEARCH_PATH)
            return await fn(conn)
        finally:
            await conn.close()

    return asyncio.run(run())


def _without_guard(sql: str) -> str:
    """The same statement with the on-the-rolls guard textually removed.

    Comparing the two answers is the measurement. Nothing else about the
    statement changes, so the difference cannot be anything but the leavers.
    """
    out = _tight(sql).replace(CANONICAL, "")
    assert out != _tight(sql), f"nothing was removed — the guard is not in:\n{sql}"
    return out


def test_every_captured_statement_plans_against_the_real_catalogue(request):
    """`prepare()` sends Parse and Describe and STOPS. The server plans the
    statement, resolves every relation, column and parameter type, and returns
    the shapes — it does not execute, does not read a row, does not write one.

    This is the check CLAUDE.md requires of any router change. The pivot's
    `FROM {table} e` alias is exactly the kind of edit an offline suite cannot
    see: a mock pool accepts a statement whose correlation name does not
    resolve just as happily as one that does.
    """
    async def go(conn):
        failures = []
        for name, fixture in SURFACES + (("pivot / orders", "pivot_orders_pool"),):
            for sql in request.getfixturevalue(fixture).statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append(f"{name}: {type(exc).__name__}: {exc}"
                                    f"\n    {_norm(sql)[:220]}")
        return failures

    failures = _live(go)
    assert not failures, ("statements the server refuses to plan:\n  "
                          + "\n  ".join(failures))


def test_live_every_query_binds_the_way_its_caller_binds_it(request):
    """THE HALF `prepare()` CANNOT SEE.

    Parsing proves the SQL is valid. It says nothing about whether the VALUES
    the caller passes can be bound to it. Each statement runs with the
    arguments ITS OWN CALLER captured; the org id matches nothing, so every one
    is a zero-row SELECT.
    """
    async def go(conn):
        failures = []
        for name, fixture in SURFACES + (("pivot / orders", "pivot_orders_pool"),):
            for sql, args in request.getfixturevalue(fixture).calls:
                try:
                    await conn.fetch(sql, *args)
                except Exception as exc:                      # noqa: BLE001
                    failures.append(f"{name}: {type(exc).__name__}: {exc}"
                                    f"\n    {_norm(sql)[:180]}\n    args={args!r}")
        return failures

    failures = _live(go)
    assert not failures, ("queries their own caller cannot bind:\n  "
                          + "\n  ".join(failures))


def _leavers(conn, org: str, extra: str = ""):
    """People this org still flags active who have a recorded last working day.

    Counted by its own join rather than by subtracting the two answers under
    test, so "the number moved" and "the number moved by the right amount" are
    two different measurements. `extra` carries the one surface-specific
    filter — `/reports?type=hr` also requires `status='active'`.
    """
    return conn.fetchval(
        "SELECT COUNT(*)::int FROM public.manav_employees e "
        "JOIN public.manav_offboarding x "
        "  ON x.org_id = e.org_id AND x.employee_id = e.id "
        "WHERE e.org_id = $1::uuid AND e.is_active = TRUE " + extra +
        "  AND x.status <> 'cancelled' AND x.last_working_day < CURRENT_DATE", org)


def _org_with_leavers(conn):
    return conn.fetchval(
        "SELECT e.org_id::text FROM public.manav_employees e "
        "JOIN public.manav_offboarding x "
        "  ON x.org_id = e.org_id AND x.employee_id = e.id "
        "WHERE e.org_id = ANY($1::uuid[]) AND e.is_active = TRUE "
        "  AND x.status <> 'cancelled' AND x.last_working_day < CURRENT_DATE "
        "GROUP BY e.org_id ORDER BY COUNT(*) DESC LIMIT 1", list(IN_SCOPE))


def test_live_the_exported_hr_report_drops_the_leavers(report_hr_pool):
    """83 people in a file a partner mails to a client; 73 of them work here.

    This one also filters `status='active'`, so the expected difference is
    counted with that same filter — a guard that removed somebody the statement
    was never counting would pass a bare "it went down".
    """
    [sql] = _employee_reads(report_hr_pool)

    async def go(conn):
        org = await _org_with_leavers(conn)
        if org is None:
            pytest.skip("neither in-scope org has a departed-but-flagged "
                        "employee any more — the fixture is the live table")
        n = await _leavers(conn, org, extra="AND e.status = 'active' ")
        after = await conn.fetchval(_norm(sql), org)
        before = await conn.fetchval(_without_guard(sql), org)
        return org, n, before, after

    org, n, before, after = _live(go)
    assert n > 0
    assert before - after == n, (
        f"active_employees went {before} -> {after} for org={org}, but {n} of "
        f"those people have a recorded last working day in the past. The guard "
        f"is removing the wrong set.")


def test_live_the_department_histogram_drops_the_leavers(hr_pool):
    """Accounts 8→6, Payroll 8→6, Taxation 8→7, Compliance 8→7 — live.

    Asserted on the TOTAL and on the shape: every department must shrink or
    stay, none may grow, and no department may vanish outright unless every
    person in it has gone.
    """
    [sql] = _employee_reads(hr_pool)

    async def go(conn):
        org = await _org_with_leavers(conn)
        if org is None:
            pytest.skip("neither in-scope org has a departed-but-flagged "
                        "employee any more — the fixture is the live table")
        n = await _leavers(conn, org)
        after = await conn.fetch(_norm(sql), org)
        before = await conn.fetch(_without_guard(sql), org)
        return org, n, ([dict(r) for r in before], [dict(r) for r in after])

    org, n, (before, after) = _live(go)
    b = {r["department"]: r["count"] for r in before}
    a = {r["department"]: r["count"] for r in after}
    assert n > 0
    assert sum(b.values()) - sum(a.values()) == n, (
        f"the department histogram totalled {sum(b.values())} -> {sum(a.values())} "
        f"for org={org} against {n} departed-but-flagged people:\n"
        f"  before {b}\n  after  {a}")
    for dept, count in a.items():
        assert count <= b.get(dept, 0), (
            f"department {dept!r} GREW when the leavers were removed "
            f"({b.get(dept, 0)} -> {count}) — the guard is not doing what this "
            f"test thinks it is")


def test_live_the_pinned_pivot_widget_drops_the_leavers(pivot_employees_pool):
    """The customer's own dashboard tile. Live 83 -> 73, department by department."""
    [sql] = _employee_reads(pivot_employees_pool)

    async def go(conn):
        org = await _org_with_leavers(conn)
        if org is None:
            pytest.skip("neither in-scope org has a departed-but-flagged "
                        "employee any more — the fixture is the live table")
        n = await _leavers(conn, org)
        after = await conn.fetch(_norm(sql), org)
        before = await conn.fetch(_without_guard(sql), org)
        return org, n, (sum(r["value"] for r in before), sum(r["value"] for r in after))

    org, n, (before, after) = _live(go)
    assert n > 0
    assert before - after == n, (
        f"the employees pivot totalled {before} -> {after} for org={org} "
        f"against {n} departed-but-flagged people")


def test_live_an_org_with_no_exits_does_not_move(hr_pool):
    """The control. A guard that quietly dropped people would show up here.

    Unicode Group holds no offboarding rows at all, so its department
    histogram must be identical with the guard and without it. If BOTH in-scope
    orgs have exits this skips rather than pretending — an absent control is
    reported, not assumed.
    """
    [sql] = _employee_reads(hr_pool)

    async def go(conn):
        org = await conn.fetchval(
            "SELECT o.id::text FROM UNNEST($1::uuid[]) AS o(id) "
            "WHERE EXISTS (SELECT 1 FROM public.manav_employees e "
            "               WHERE e.org_id = o.id AND e.is_active = TRUE) "
            "  AND NOT EXISTS (SELECT 1 FROM public.manav_offboarding x "
            "                   WHERE x.org_id = o.id "
            "                     AND x.status <> 'cancelled' "
            "                     AND x.last_working_day < CURRENT_DATE) "
            "LIMIT 1", list(IN_SCOPE))
        if org is None:
            pytest.skip("both in-scope orgs now record exits — no control org "
                        "left to prove the guard removes only leavers")
        after = await conn.fetch(_norm(sql), org)
        before = await conn.fetch(_without_guard(sql), org)
        return org, ([dict(r) for r in before], [dict(r) for r in after])

    org, (before, after) = _live(go)
    assert before, f"control org {org} returned no employees at all"
    assert before == after, (
        f"org={org} records no exits, yet the guard changed its department "
        f"histogram:\n  before {before}\n  after  {after}")
