"""Two read surfaces still counted the people payroll had already stopped paying.

`routers/vetana.py::process_payroll` stopped writing payslips for anyone whose
recorded last working day had passed (:1526-1545). Nothing else changed, so the
two surfaces that ask "how many people are there" for a HUMAN went on answering
with the old roster:

  · `routers/vetana.py::dashboard` — `headcount`, the tile that sits directly
    beside `latest_run` and the YTD money, counted `is_active = TRUE` alone.
  · `routers/pahchan.py::enrollment_queue` — `incomplete`, the list of people
    HR is asked to enrol reference photographs for, did the same.

THE FLAG IS NOT STALE DATA AND MUST NOT BE "CLEANED". `routers/manav.py:1958`
records that offboarding used to set `is_active = FALSE`, which dropped the
person out of payroll the same day and left an outstanding salary advance
unrecoverable. So a leaver KEEPS the flag until settlement, deliberately — and
the reads are what have to change.

Measured read-only on the live database 2026-08-26, the two in-scope
organisations:

                                        before    after
    E2E Test & Associates  64e7bea6        83       73
    Unicode Group          fae87907        26       26   (headcount)
    Unicode Group          fae87907        14       14   (enrolment queue)

E2E's ten still-flagged leavers are the whole of that gap, and they are a live
workflow rather than corruption: their exits sit at `initiated` (2),
`in_clearance` (3), `completed` (2) and `settled` (3), with last working days
from 7 July to 3 August. Two carry outstanding salary advances totalling
1,15,000, which is exactly why the flag is still set.

── THE TILE WILL STILL NOT EQUAL THE RUN, AND THAT IS CORRECT ───────────────

`headcount` is a STOCK as at today, so it bounds the exit date on today: 73.
The August run is paying a MONTH, so it bounds on 1 August and still pays the
man who left on the 3rd — he worked three days of it and is owed them. The two
numbers are allowed to differ by exactly the people who left mid-month, and
`test_the_tile_is_a_stock_as_at_today_and_the_run_is_a_month` is where that
reasoning is written down somewhere that fails.

── WHY THE OFFLINE HALF IS NOT A SUBSTRING SCAN ─────────────────────────────

"A mock pool hides bad SQL" (CLAUDE.md). A MagicMock answers `[]` to valid SQL,
invalid SQL and a shopping list, and this repo has already shipped a string-scan
test — `assert "state" in sql` — that passed while the endpoint returned no
state. So the offline half runs the handlers, picks the ONE statement each
figure comes from out of the several each handler issues, and asserts the guard
is that statement's — and that it is the SHARED predicate character for
character, not a twenty-sixth hand-written copy of it.

The live half parses both statements and their pre-fix reconstructions against
the real catalogue and then counts real rows. Nothing here writes anything:
`prepare()` sends Parse and Describe and stops, and every other statement is a
SELECT. It skips with no database, which is how the whole suite behaves. Run it
with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_leavers_are_off_the_tile_and_the_enrolment_queue.py -q
"""
import asyncio
import inspect
import os

import pytest

import db
import routers.pahchan as pahchan
import routers.vetana as vetana
from middleware.role_tiers import ADMIN
from services.on_the_rolls import still_on_the_rolls

#: A fixture value, and deliberately not the seeded org's id even in part: the
#: offline pool is a fake, so this is only ever an argument to assert on, and an
#: id that LOOKS real gets copied into a live probe that then returns nothing.
ORG = "00000000-0000-4000-8000-000000000009"

#: The caller. `dashboard` is gated at EDITOR on Vetana and the level set is a
#: frozenset of tier names, so this is the smallest thing that gets past
#: `_require` without reaching into the gate's own machinery.
LEVELS = frozenset({ADMIN})
USER = {"user_id": "user_test0001", "email": "t@example.com", "role": "admin"}

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing, and is recognised BY VALUE because `setdefault` means the
#: variable is never absent — a bare presence check would try to connect to a
#: host that does not exist and report the timeout as a failure.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What the app's own pool does on every connection (`db.py`), so a statement is
#: planned the way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These checks plan both statements against the real "
    "catalogue and count the rows the guard removes; neither can be done "
    "offline. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_leavers_are_off_the_tile_and_the_enrolment_queue.py -q"
)

#: The guard as the shared module emits it, against the alias both statements
#: use. Compared as a LITERAL rather than a pattern: the whole point of
#: `services/on_the_rolls.py` is that there is one spelling of this predicate,
#: so "close enough" is the failure mode under test.
GUARD = still_on_the_rolls("e")


def norm(sql: str) -> str:
    return " ".join(sql.split())


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


# ══════════════════════════════════════════════════════════════════════════
#  Running the handlers, and picking the right statement out of each
# ══════════════════════════════════════════════════════════════════════════

class _CapturePool:
    """Records every statement a handler issues and answers plausibly.

    It holds no connection. The handlers' own Python builds the SQL exactly as
    it would at run time, which is the only thing being read off it here — the
    values are chosen so the handler reaches its `return` rather than to mean
    anything.
    """

    def __init__(self):
        self.statements: list[str] = []

    async def fetch(self, sql, *args):
        self.statements.append(sql)
        return []

    async def fetchval(self, sql, *args):
        self.statements.append(sql)
        return 0

    async def fetchrow(self, sql, *args):
        self.statements.append(sql)
        # `dashboard` reads `latest_run["month"]` and passes it to the next
        # query, so the run row cannot be None or the handler never issues the
        # department split. Every other fetchrow here is spread into a dict.
        if "vetana_payroll_runs" in sql and "ORDER BY month DESC" in sql:
            return {"month": "2026-08"}
        return {}


def statements_of(coro_factory) -> list[str]:
    """Every statement one handler issues, whitespace-normalised, in order.

    `db._pool` is swapped rather than the routers' `get_pool` name, because
    `get_pool()` short-circuits on the module-level pool and that is how
    conftest already injects its own mock — one mechanism, not two.
    """
    pool = _CapturePool()
    original, db._pool = db._pool, pool
    try:
        asyncio.run(coro_factory())
    finally:
        db._pool = original
    return [norm(s) for s in pool.statements]


def one_statement(statements: list[str], *must_contain: str) -> str:
    """The single statement matching every fragment, or a failure naming why.

    Exactly one, never the first match: each of these handlers issues several
    statements over the same tables, and a guard that landed in the wrong one
    would filter the wrong population and still satisfy a whole-handler
    substring assertion. That is the exact shape of the `assert "state" in sql`
    test this repo already shipped.
    """
    hits = [s for s in statements if all(f in s for f in must_contain)]
    assert len(hits) == 1, (
        "expected exactly one statement containing %r, found %d. The handler's "
        "queries moved and this file picks them out by shape:\n%s"
        % (list(must_contain), len(hits), "\n".join(statements)))
    return hits[0]


def headcount_sql() -> str:
    """The statement `GET /vetana/dashboard` counts `headcount` with."""
    return one_statement(
        statements_of(lambda: vetana.dashboard(
            user=USER, org_id=ORG, levels=LEVELS)),
        "COUNT(*)", "staging.manav_employees")


def enrolment_statements() -> list[str]:
    """Both statements `GET /pahchan/enrollment/queue/pending` issues."""
    return statements_of(lambda: pahchan.enrollment_queue(
        user=USER, org_id=ORG, _g=None, _r=None))


def incomplete_sql() -> str:
    """The statement the `incomplete` list comes from.

    Identified by its HAVING, which is what makes it the "who has fewer than
    two approved photographs" question rather than the pending-approval one
    beside it.
    """
    return one_statement(enrolment_statements(), "HAVING COUNT(r.id)")


def strip_guard(sql: str) -> str:
    """The statement as it was BEFORE this fix — the guard removed, nothing else.

    Used to run the old query against the live database beside the new one. It
    asserts it removed something, so a renamed guard fails here loudly instead
    of silently comparing a query with itself and reporting no difference.
    """
    assert sql.count(GUARD) == 1, (
        "expected exactly one shared guard to strip, found %d. The predicate's "
        "shape changed, or it was deleted — either way the live comparison "
        "below would have compared a query with itself:\n%s"
        % (sql.count(GUARD), sql))
    return sql.replace(GUARD, "")


# ══════════════════════════════════════════════════════════════════════════
#  Offline — the shared predicate, in the right statement, on the right bound
# ══════════════════════════════════════════════════════════════════════════

def test_the_payroll_tile_does_not_count_people_payroll_no_longer_pays():
    """THE TILE. It sits beside `latest_run` and the YTD totals, so counting
    `is_active` alone had the page contradicting its own payroll run: 83 staff
    over a run that paid 73 of them."""
    sql = headcount_sql()
    assert GUARD in sql, (
        "vetana's headcount tile is back to trusting `is_active` alone, which "
        "ten live E2E employees do not clear — the tile says 83 beside a run "
        "that paid 73:\n" + sql)


def test_the_enrolment_queue_does_not_ask_hr_to_enrol_people_who_have_left():
    """THE QUEUE. `incomplete` is a work list: every name on it is HR being
    asked to collect two face photographs from that person. Ten of E2E's 83
    left up to seven weeks ago."""
    sql = incomplete_sql()
    assert GUARD in sql, (
        "pahchan's enrolment queue is `is_active`-only again, so HR is asked "
        "to enrol reference photographs for ten people who have left:\n" + sql)


@pytest.mark.parametrize("get_sql", [headcount_sql, incomplete_sql],
                         ids=["vetana.headcount", "pahchan.incomplete"])
def test_both_use_the_shared_predicate_and_not_a_twenty_sixth_copy(get_sql):
    """`services/on_the_rolls.py` exists because a sweep found twenty-five
    hand-written copies of this predicate. A copy that drifts is worse than no
    guard: it disagrees with payroll silently.

    The three things the shared predicate gets right, each of which was got
    wrong somewhere before it existed, are asserted here as well as by
    identity — so a reader who reaches this file after a failure is told WHAT
    would break rather than only that two strings differ.
    """
    sql = get_sql()
    assert "x.status <> 'cancelled'" in sql, (
        "a withdrawn resignation leaves a cancelled row behind and that person "
        "never left; without this they vanish from the count for ever")
    assert "x.org_id = e.org_id" in sql, (
        "manav_offboarding has no composite (id, org_id) constraint, so an "
        "employee-id-only join reads another tenant's exit row")
    assert "x.last_working_day <= " not in sql, (
        "somebody whose last working day IS today was on the rolls today; "
        "`<=` drops them a day early")
    assert GUARD in sql, (
        "the guard is hand-written rather than imported from "
        "services.on_the_rolls, which is the failure that module exists to "
        "prevent. Expected:\n  %s\ngot:\n  %s" % (GUARD, sql))


@pytest.mark.parametrize("get_sql", [headcount_sql, incomplete_sql],
                         ids=["vetana.headcount", "pahchan.incomplete"])
def test_the_employee_table_is_aliased_rather_than_the_predicate_inlined(get_sql):
    """The shared predicate is written against an alias. A query with none used
    to be the reason somebody inlined a variant — so the alias is added to the
    query, and this is the check that says so."""
    sql = get_sql()
    assert "staging.manav_employees e" in sql, (
        "the employee table lost its alias, so the shared predicate cannot be "
        "applied to it without writing a variant:\n" + sql)
    assert "e.is_active" in sql, (
        "`is_active` is still required — it is what a hand-deactivation means, "
        "and the guard narrows that set rather than replacing it:\n" + sql)


def test_the_tile_is_a_stock_as_at_today_and_the_run_is_a_month():
    """A guard rail on the judgement call, not on the code.

    Both surfaces here are stocks — "how many people are there NOW" — so both
    bound the exit date on today. `process_payroll` bounds on the first of the
    month it is paying, and the two are NOT interchangeable: a stock bounded on
    a month start counts July's leavers all August, and a run bounded on today
    would refuse the three days owed to somebody who left on the 3rd.

    This is where that reasoning fails if someone later "fixes the
    inconsistency" by making the bounds agree.
    """
    for name, sql in (("vetana headcount", headcount_sql()),
                      ("pahchan incomplete", incomplete_sql())):
        assert "x.last_working_day < CURRENT_DATE" in sql, (
            f"{name} is a stock as at today and must bound the exit date on "
            f"today; read this test's docstring before changing it:\n{sql}")
    run_src = inspect.getsource(vetana.process_payroll)
    assert "x.last_working_day < $3::date" in run_src, (
        "the payroll run no longer bounds on its own month start. If it now "
        "bounds on today, somebody who left mid-month has just stopped being "
        "paid for the days they worked — which is the failure the flag was "
        "left set to avoid in the first place.")


def test_the_department_split_beside_the_tile_is_a_flow_and_stays_unguarded():
    """DELIBERATELY UNGUARDED, and this is the note.

    `department_split` sums a MONTH's payslips. An ex-employee's July salary was
    still paid in July, out of July's departmental budget, and guarding it would
    rewrite that history the first time somebody left — the departmental totals
    would stop reconciling with `latest_run`, which is the very contradiction
    the headcount fix removes.
    """
    stmt = one_statement(
        statements_of(lambda: vetana.dashboard(
            user=USER, org_id=ORG, levels=LEVELS)),
        "vetana_payslips", "GROUP BY e.department")
    assert "manav_offboarding" not in stmt, (
        "the department split now drops people who have since left, so a past "
        "month's departmental cost no longer totals the run that paid it:\n"
        + stmt)


# ══════════════════════════════════════════════════════════════════════════
#  The punch path — considered, and deliberately left alone
# ══════════════════════════════════════════════════════════════════════════

def test_employee_for_stays_an_identity_lookup_and_not_an_eligibility_gate():
    """`pahchan._employee_for` was flagged: a leaver could clock in. The guard
    still does not belong IN IT, and this test is where that decision lives.

    It answers "WHICH employee is this login", and seven call sites read it —
    only one of which is about eligibility:

      · `create_punch` (:771)            — eligibility. The one real case.
      · `upload_photo` (:738)            — the storage scope segment. A photo
                                           belongs to the person in it whether
                                           or not they have since left.
      · `GET /me` (:1071)                — the employee's own record and the
                                           DPDP retention promise. A leaver
                                           awaiting settlement is precisely the
                                           person entitled to read it.
      · `POST /notice/ack` (:1197)       — files the employee id alongside.
      · reference read / signed URL /
        self-capture (:1674, :1750, :1798) — `is_self`. Guarding here does not
                                           deny a leaver an action; it makes
                                           `is_self` FALSE, which falls through
                                           to the org-admin gate and returns
                                           403 on their OWN biometric record.

    So a guard inside the resolver would close one door and silently lock five
    people out of their own data. And the eligibility case is not a read: 07 §2
    is that NOTHING BLOCKS A PUNCH — "a blocked punch at a client site becomes a
    payroll dispute a week later, and the employee is right" — so a leaver's
    punch belongs in `_compute_flags` as a flag HR can see, not as a new 4xx.
    That is a product decision about §2, not a read that is answering the wrong
    question, and it is out of scope for this change.

    Nothing is being deferred quietly, either. Measured read-only 2026-08-26:
    two employees in the whole database carry a login, and neither has left, so
    there is no live path by which a leaver can punch today.
    """
    src = inspect.getsource(pahchan._employee_for)
    assert "manav_offboarding" not in src, (
        "the leaver guard has been put inside `_employee_for`. Read this "
        "test's docstring: three of its seven callers use it to establish "
        "OWNERSHIP, and a None there means 403 on the employee's own "
        "photographs rather than a refused punch.")

    # The fact the reasoning rests on. If ownership stops being decided from
    # this resolver, the objection above no longer holds and the decision is
    # worth taking again rather than inheriting.
    module_src = inspect.getsource(pahchan)
    assert module_src.count('is_self = caller and str(caller["id"])') == 3, (
        "the ownership checks that read `_employee_for` have moved. The reason "
        "the guard was kept out of it was that a None there denies somebody "
        "their own record — re-take that decision rather than assuming it.")


def test_the_pending_approval_half_of_the_queue_is_left_unguarded():
    """The other list in the same payload, deliberately not guarded.

    `incomplete` is a coverage denominator — who on the rolls has no usable
    reference pair — and a person who has left is not a gap in the register.
    `pending_approval` is a list of ARTEFACTS: photographs somebody actually
    captured, each awaiting a decision. Hiding one because its subject has since
    left does not save HR work; it leaves an unadjudicated photograph in storage
    that nobody can see until retention deletes it unreviewed.

    Live 2026-08-26 it is empty everywhere — 24 enrolment photographs, none
    pending, none belonging to a leaver — so this costs nothing either way
    today. It is recorded because the two lists come back from one handler and
    the asymmetry would otherwise read like an oversight.
    """
    pending = one_statement(enrolment_statements(), "r.approved_at IS NULL")
    assert "manav_offboarding" not in pending, (
        "the pending-approval list is now filtered by the leaver guard. If "
        "that is deliberate, say why here — as written, an unapproved "
        "photograph of somebody who has left becomes invisible rather than "
        "decided:\n" + pending)


# ══════════════════════════════════════════════════════════════════════════
#  Live — plan against the real catalogue, and count real rows. READ ONLY.
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


def test_live_both_statements_and_their_pre_fix_forms_plan():
    """`prepare()` sends Parse and Describe and STOPS: the server plans the
    statement and resolves every relation, column and parameter type. No row is
    read and none is written — which matters, because this is production's
    database as well as staging's.

    The pre-fix forms are planned too: the comparisons below run them, and a
    reconstruction that does not plan would skip those tests as a connection
    problem instead of failing as a broken strip.
    """
    statements = [headcount_sql(), incomplete_sql()]
    statements += [strip_guard(s) for s in statements]

    async def work(conn):
        for sql in statements:
            await conn.prepare(sql)
        return len(statements)

    assert live(work) == 4


def test_live_the_tile_now_counts_the_people_still_on_the_rolls():
    """PROVED ON REAL ROWS AND WITHOUT WRITING ONE.

    Runs the fixed tile and the pre-fix one side by side over every org and
    asserts an EQUALITY, not an inequality: the drop is exactly the number of
    flagged employees holding a past exit date. Measured when written — E2E
    83 → 73, Unicode 26 → 26. The assertion is on the property, so the figures
    moving as leavers are finally settled does not turn this red;
    `dropped_total > 0` is what stops it passing with the guard deleted.
    """
    fixed = headcount_sql()
    before = strip_guard(fixed)

    async def work(conn):
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM staging.manav_employees "
            " WHERE is_active = TRUE")]
        out = []
        for org in orgs:
            after_n = await conn.fetchval(fixed, org)
            before_n = await conn.fetchval(before, org)
            leavers = await conn.fetchval(
                "SELECT COUNT(*) FROM staging.manav_employees e "
                " WHERE e.org_id = $1::uuid AND e.is_active = TRUE "
                "   AND EXISTS (SELECT 1 FROM staging.manav_offboarding x "
                "     WHERE x.org_id = e.org_id AND x.employee_id = e.id "
                "       AND x.status <> 'cancelled' "
                "       AND x.last_working_day < CURRENT_DATE)", org)
            out.append((str(org), before_n, after_n, leavers))
        return out

    results = live(work)
    assert results, "no org has an active employee"

    dropped_total = 0
    for org, before_n, after_n, leavers in results:
        dropped_total += before_n - after_n
        assert before_n - after_n == leavers, (
            f"org {org}: the tile lost {before_n - after_n} people but "
            f"{leavers} hold a past exit date — the guard is removing the "
            f"wrong rows, or removing them twice")
    assert dropped_total > 0, (
        "the guard removed nobody anywhere, so this test would pass with the "
        "guard deleted. Ten E2E employees held a past exit date on 2026-08-26; "
        "if they have since been deactivated, say so here rather than deleting "
        "this assertion.")


def test_live_the_enrolment_queue_stops_listing_people_who_have_left():
    """The same equality for the queue, and a stronger one beside it: the names
    the fix removes must EVERY ONE hold a past exit date, and no name it keeps
    may hold one. A subset assertion in one direction and an emptiness
    assertion in the other, so a guard that removed the wrong people fails here
    rather than merely removing the right number of them.

    Measured when written — E2E 83 → 73, Unicode 14 → 14.
    """
    fixed = incomplete_sql()
    before = strip_guard(fixed)

    async def work(conn):
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM staging.manav_employees "
            " WHERE is_active = TRUE")]
        out = []
        for org in orgs:
            kept = {r["employee_id"] for r in await conn.fetch(fixed, org)}
            all_rows = {r["employee_id"] for r in await conn.fetch(before, org)}
            left = {r["employee_id"] for r in await conn.fetch(
                "SELECT DISTINCT employee_id FROM staging.manav_offboarding "
                " WHERE org_id = $1::uuid AND status <> 'cancelled' "
                "   AND last_working_day < CURRENT_DATE", org)}
            out.append((str(org), kept, all_rows, left))
        return out

    results = live(work)
    assert results, "no org has an active employee"

    dropped_total = 0
    for org, kept, all_rows, left in results:
        dropped = all_rows - kept
        dropped_total += len(dropped)
        assert dropped <= left, (
            f"org {org}: the queue stopped listing {len(dropped - left)} "
            f"people who have no past exit date — HR has just been told those "
            f"employees are enrolled when they are not")
        assert not (kept & left), (
            f"org {org}: {len(kept & left)} people who have already left are "
            f"still being queued for face enrolment")
    assert dropped_total > 0, (
        "the guard removed nobody anywhere, so this test would pass with the "
        "guard deleted. Ten E2E employees held a past exit date on 2026-08-26; "
        "if they have since been deactivated, say so here rather than deleting "
        "this assertion.")
