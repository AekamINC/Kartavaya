"""`/v1/statute/due` — the projection, and the two ways it is allowed to fail.

── WHAT THIS COVERS THAT `test_statute.py` DOES NOT ─────────────────────────

`test_statute.py` proves the RESOLVER: which version of an obligation is in
force on a date. This file proves the PROJECTION on top of it — when that
version next falls due — and the projection is where a due-dates screen goes
wrong, because it is arithmetic and arithmetic always produces an answer.

The rows are the real ones. `SEED` is parsed out of `migrations/158_statute_
calendar.sql` by `test_statute.py` and reused here rather than hand-written,
for the reason that file states: a fixture written to agree with the code
passes green while the seed and the code disagree, and the whole product then
ships a date that TRACES rejects. `FakePool` applies the WHERE clauses of
`services/statute.py` and nothing else, so every date decision under test runs
in the real resolver and the real projection.

── THE TWO FAILURES THIS FILE EXISTS TO PREVENT ─────────────────────────────

  1. A DATE THAT WAS INVENTED. `due_day IS NULL` is not a gap to fill in.
     Migration 158 defines it: "THE SCHEDULE IS NOT A DAY-OF-MONTH RULE. Read
     `notes`; do not guess." The quarterly TDS statements are the case that
     forced the column to be nullable — Q1–Q3 fall on the 31st of the month
     after the quarter and Q4 falls on 31 May — so "day 31, one month later"
     is confidently wrong four times a year. Six of the income-tax rows in
     force today are that shape and every one of them must come back with a
     null date and the reason.

  2. A DEADLINE PRINTED FOR SOMETHING THAT HAS NONE. Eighteen of the 45 live
     rows are `standing`: rates, ceilings, thresholds. The ESI wage ceiling is
     a rule in force, not a filing, and a Due tab that listed it would be
     inventing a deadline out of a number.

And the deliverable underneath both: the SAME obligation asked for on 31 March
2026 and on 1 April 2026 must come back with DIFFERENT form numbers. If that
ever stops holding, the projection is dating the wrong version of the law.
"""
import asyncio
import os
from datetime import date

import pytest

import routers.statute as statute_router
from tests.test_statute import SEED, FakePool

USER = {"user_id": "user_admin001"}

#: Chosen, not "today". Every expected date below is arithmetic from this one
#: day, so a test that passes in August and fails in September would be a test
#: measuring the calendar rather than the code.
AS_OF = "2026-08-26"

#: The two boundary days of the Income-tax Act 2025. One date, written once in
#: the seed: 31 March answers the 1961-Act row, 1 April answers the 2025 one.
BEFORE_ACT = "2026-03-31"
AFTER_ACT = "2026-04-01"


def _call(as_of=AS_OF, authority=None, state_code=None, rows=None):
    """Drive the endpoint against the real seed. No network, no database.

    `user=` is passed explicitly. `Depends` resolves for ROUTES only — a direct
    call receives the sentinel object, not a user — so an endpoint invoked like
    this must be handed one.
    """
    pool = FakePool(rows)

    async def _pool():
        return pool

    original, statute_router.get_pool = statute_router.get_pool, _pool
    try:
        return asyncio.run(statute_router.list_due(
            as_of=as_of, authority=authority, state_code=state_code, user=USER,
        ))
    finally:
        statute_router.get_pool = original


def _by_key(out):
    return {r["key"]: r for r in out["data"]}


# ══════════════════════════════════════════════════════════════════════════════
#  The route reaches the app at all
# ══════════════════════════════════════════════════════════════════════════════

def _mounted_paths(routes) -> set[str]:
    """Every path the app serves, whichever way this FastAPI stores them."""
    out: set[str] = set()
    for route in routes:
        path = getattr(route, "path", None)
        if isinstance(path, str):
            out.add(path)
        # 0.138 wraps an included router; 0.115 flattens it. `original_router`
        # is the wrapper's handle on the real one.
        inner = getattr(route, "original_router", None)
        sub = getattr(inner, "routes", None)
        if sub:
            out |= _mounted_paths(sub)
    return out


def test_the_due_route_exists_and_the_app_serves_it():
    """A router that exists and is never included is the same as no router —
    `routers/support_sessions.py` is this codebase's standing example: 401
    lines, complete, unreachable. `/due` rides on the same `include_router`
    call `/obligations` does, so this asserts the path rather than the import.

    It also catches the signature: `authority` is a REPEATABLE query parameter,
    and building the schema is what forces FastAPI to resolve it.

    WALKED, NOT READ OFF `app.routes` DIRECTLY. FastAPI 0.138 (local) keeps an
    included router as a lazy `_IncludedRouter` wrapper and `app.routes` holds
    six paths in total; 0.115.12 — what the container pins, and the reason this
    suite's local baseline is not the deployed one — flattens them and it holds
    hundreds. A test written against either shape passes on one machine and
    fails on the other, which is the 3.14-vs-3.13 trap this suite has been
    caught by before. The walk below handles both and costs nothing;
    `app.openapi()` would also work and takes a minute and a half to build.
    """
    import server
    assert "/api/v1/statute/due" in _mounted_paths(server.app.routes)
    assert "/api/v1/statute/obligations" in _mounted_paths(server.app.routes)


# ══════════════════════════════════════════════════════════════════════════════
#  What the projection computes
# ══════════════════════════════════════════════════════════════════════════════

def test_a_monthly_deposit_lands_on_the_day_of_the_month_after_the_period():
    """PF is due on day 15 of the month FOLLOWING the wage month.

    Asked on 26 August, the answer is 15 September and the period is August —
    both said out loud. The period matters as much as the date: 15 September
    with no period attached is a deadline nobody can reconcile to a payroll
    run.
    """
    row = _by_key(_call(authority=["epfo"]))["epf.remittance"]
    assert row["due_on"] == "2026-09-15"
    assert row["days_away"] == 20
    assert "August 2026" in row["basis"]
    assert "day 15 of the following month" in row["basis"]


def test_an_anniversary_still_ahead_this_year_stays_in_this_year():
    """The input-tax-credit cut-off falls on 30 November, which has not
    happened yet on 26 August. A scan that jumped a year here would push every
    annual deadline twelve months out and none of them would look wrong."""
    row = _by_key(_call(authority=["gst"]))["gst.itc.time_limit"]
    assert row["due_on"] == "2026-11-30"
    assert row["basis"] == "every year on 30 November"


def test_an_anniversary_already_past_rolls_to_next_year_and_stays_positive():
    """The mirror, so the scan cannot be off by a year in the other direction.

    Asked on 1 December, 30 November has gone. An anniversary already past
    resolving to the date that has passed renders as a deadline with a
    negative countdown and nothing saying it is stale.
    """
    row = _by_key(_call(as_of="2026-12-01", authority=["gst"]))["gst.itc.time_limit"]
    assert row["due_on"] == "2027-11-30"
    assert row["days_away"] > 0


def test_a_day_the_month_does_not_have_is_never_slid_onto_one_it_does():
    """Day 31 of a 30-day month is a month with NO such date.

    Sliding it to the 30th is the router inventing a deadline, which is the one
    thing it is not allowed to do — so the day is skipped to the next month
    that actually has it. Asserted on the helper directly because no live row
    has this shape yet and a projection is easiest to get wrong on the case
    nobody has seen.
    """
    assert statute_router._on(2026, 2, 30) is None
    assert statute_router._on(2026, 9, 31) is None
    assert statute_router._on(2026, 9, 30) == date(2026, 9, 30)


def test_the_countdown_is_measured_from_the_date_that_is_echoed_back():
    """`days_away` and `as_of` are two halves of one claim. A countdown whose
    reference date is invisible — or is a DIFFERENT date — is a countdown
    nobody can check."""
    out = _call(as_of=AS_OF)
    assert out["as_of"] == AS_OF
    for row in out["data"]:
        assert row["as_of"] == AS_OF
        if row["due_on"]:
            assert row["days_away"] == (
                date.fromisoformat(row["due_on"]) - date.fromisoformat(AS_OF)
            ).days


# ══════════════════════════════════════════════════════════════════════════════
#  What the projection refuses to compute
# ══════════════════════════════════════════════════════════════════════════════

def test_an_obligation_with_no_due_day_is_listed_with_no_date_and_the_reason():
    """The quarterly TDS statements. Listed, undated, and explained.

    Not dropped: an obligation a firm has is worth naming even where the
    calendar records no day for it, and dropping it would be this endpoint
    deciding the firm has one fewer duty than it does. Not dated: Q4 falls on
    31 May where the others fall on the 31st of the month after the quarter,
    so any uniform rule is wrong a quarter of the time.
    """
    rows = _by_key(_call(authority=["income_tax"]))
    row = rows["tds.statement.salary"]
    assert row["due_on"] is None
    assert row["days_away"] is None
    assert row["basis"] == statute_router._NO_DUE_DAY


def test_a_version_that_expires_before_its_own_next_occurrence_is_not_dated():
    """THE SUBTLE ONE, and it is a live row rather than a hypothetical.

    Asked on 26 August 2025, the salary TDS certificate resolves to the
    1961-Act row: Form 16, due 15 June. The next 15 June is in 2026 — by which
    date that row has been replaced, on 1 April 2026, by the 2025-Act row that
    carries NO due day at all. Migration 158 says so on the successor: "Form
    16 was renumbered 130. Section and due date are NULL because neither was
    verified for the 2025 Act — only the form number was. Do not assume 15
    June carried across."

    So `15 June 2026` is a date computed from a rule that is not the rule on
    the day it lands. It is refused, and the refusal says why. This is the
    same class of failure as a hardcoded constant, reached by arithmetic — and
    it is the reason a projection layer needs its own test rather than
    inheriting the resolver's.
    """
    row = _by_key(_call(as_of="2025-08-26",
                        authority=["income_tax"]))["tds.certificate.salary"]
    assert row["form_number"] == "16"          # the 1961-Act version, in force
    assert row["due_on"] is None
    assert row["basis"] == statute_router._WINDOW_CLOSES_FIRST


def test_a_standing_rule_never_appears_at_all():
    """Eighteen of the 45 live rows are rules in force with no deadline.

    `gst.rate.18` is a rate, `tds.higher_rate_no_pan` is a section, and neither
    is a thing that falls due. They resolve perfectly through
    `/obligations`; they must not reach a screen that reads every row as a
    date.
    """
    out = _call()
    keys = {r["key"] for r in out["data"]}
    assert "gst.rate.18" not in keys
    assert "tds.higher_rate_no_pan" not in keys
    assert "msme.payment_disallowance" not in keys
    for row in out["data"]:
        assert row["cadence"] != "standing"
    # And the exclusion is not a coincidence of the seed — the seed has some.
    assert any(r["periodicity"] == "standing" for r in SEED)


def test_dated_rows_come_before_undated_ones_and_soonest_first():
    """A row with no date sorted in among the dated ones by its key reads as
    though it were due around then."""
    out = _call()
    dated = [r["due_on"] for r in out["data"] if r["due_on"]]
    assert dated == sorted(dated)
    seen_undated = False
    for row in out["data"]:
        if row["due_on"] is None:
            seen_undated = True
        else:
            assert not seen_undated, "a dated row appears after an undated one"
    assert out["dated"] == len(dated)
    assert out["undated"] == len(out["data"]) - len(dated)


# ══════════════════════════════════════════════════════════════════════════════
#  THE DELIVERABLE — the projection dates the right version of the law
# ══════════════════════════════════════════════════════════════════════════════

def test_the_same_obligation_carries_a_different_form_either_side_of_1_april():
    """31 March 2026 answers the 1961 Act; 1 April 2026 answers the 2025 Act.

    This is `test_statute.py`'s deliverable, re-asserted THROUGH the endpoint,
    because a projection layer is exactly where a resolved row can be quietly
    replaced by a convenient one. A statement filed under the old form number
    for a payment made on or after 1 April 2026 is rejected at TRACES.
    """
    before = _by_key(_call(as_of=BEFORE_ACT, authority=["income_tax"]))
    after = _by_key(_call(as_of=AFTER_ACT, authority=["income_tax"]))
    key = "tds.statement.salary"
    assert before[key]["form_number"] != after[key]["form_number"]
    assert before[key]["as_of"] == BEFORE_ACT
    assert after[key]["as_of"] == AFTER_ACT


def test_one_row_per_obligation_key_on_either_side_of_the_boundary():
    """Both versions of a renumbered form must never appear in one list.

    Two rows for `tds.statement.salary` in a due-dates panel leaves a reader to
    work out which one applies, which is the question the table exists to
    answer for them.
    """
    for stamp in (BEFORE_ACT, AFTER_ACT, AS_OF):
        keys = [r["key"] for r in _call(as_of=stamp)["data"]]
        assert len(keys) == len(set(keys)), f"duplicate keys on {stamp}"


# ══════════════════════════════════════════════════════════════════════════════
#  THE ONE TOKEN — `income_tax`, not `incometax`
# ══════════════════════════════════════════════════════════════════════════════

def test_the_income_tax_authority_is_spelled_with_the_underscore():
    """22 of the 45 live rows carry `authority = 'income_tax'`.

    `frontend/src/lib/routeModules.js` asked for `incometax` — a value the
    column has never held — so the Finance page's Due tab dropped all 22 and
    nothing errored, because a filter that matches nothing looks exactly like a
    page with nothing on it. The allowlist here is the second half of the fix:
    the mis-spelling is now REFUSED rather than answered with a short list.
    """
    assert "income_tax" in statute_router._AUTHORITIES
    assert "incometax" not in statute_router._AUTHORITIES

    out = _call(authority=["income_tax"])
    assert out["count"] > 0
    assert {r["authority"] for r in out["data"]} == {"income_tax"}

    with pytest.raises(Exception) as exc:
        _call(authority=["incometax"])
    assert "422" in str(exc.value) or "authority" in str(exc.value)


def test_two_authorities_are_answered_in_one_call_as_of_one_date():
    """The Finance page wants GST and income tax together. Two round trips to
    build one list is two chances for the halves to be resolved as of different
    dates, and a panel showing one column of dates measured from two days is
    not a panel anybody can act on."""
    out = _call(authority=["gst", "income_tax"])
    assert {r["authority"] for r in out["data"]} == {"gst", "income_tax"}
    assert out["filters"]["authority"] == ["gst", "income_tax"]
    keys = [r["key"] for r in out["data"]]
    assert len(keys) == len(set(keys))


# ══════════════════════════════════════════════════════════════════════════════
#  The live half — the router's SQL, against the real schema
# ══════════════════════════════════════════════════════════════════════════════
#
#  READ-ONLY THROUGHOUT. `prepare()` sends Parse and Describe and stops; the
#  two statements that are executed are SELECTs over a 45-row reference table.
#  Nothing here writes, and staging and production share one database.

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing, and it is recognised BY VALUE because conftest uses
#: `setdefault` — the variable is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection, so a statement is planned the way it
#: will actually be planned. `services/statute.py` schema-qualifies its FROM
#: anyway — migration 142's shadow-table incident is why — but the two must be
#: measured together or the qualification is untested.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. The offline half above runs the real resolver against "
    "the real seed, but it cannot see a column that does not exist and it "
    "cannot count the rows the live table actually holds — a MagicMock pool "
    "answers happily to both. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_statute_due.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _captured_statements():
    """Every statement the endpoint issues, with its bound arguments.

    Captured from a real drive of `list_due` rather than copied out of
    `services/statute.py`, so a statement this endpoint starts issuing
    tomorrow is described tomorrow without anybody remembering to add it here.
    """
    pool = FakePool()

    async def _pool():
        return pool

    original, statute_router.get_pool = statute_router.get_pool, _pool
    try:
        asyncio.run(statute_router.list_due(
            as_of=AS_OF, authority=["gst", "income_tax"],
            state_code=None, user=USER,
        ))
        asyncio.run(statute_router.list_due(
            as_of=AS_OF, authority=None, state_code="MH", user=USER,
        ))
    finally:
        statute_router.get_pool = original
    return pool.calls


@pytest.fixture(scope="module")
def live():
    """Described and counted once for the whole file. Connects ONCE.

    Synchronous, running its own loop deliberately: the suite pins
    `asyncio_default_fixture_loop_scope = function`, so a module-scoped async
    fixture would be sharing a loop it does not own.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    calls = _captured_statements()
    try:
        return _describe_and_count(calls)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def _describe_and_count(calls):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)

            failures, params = [], []
            for sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((sql, len(stmt.get_parameters()), len(args)))

            # Read-only, and the point of the whole file: the live spelling of
            # the authority column, and how many rows each value holds.
            by_authority = await conn.fetch(
                "SELECT authority, count(*) AS n "
                "FROM staging.statute_calendar GROUP BY authority"
            )

            # The endpoint's own listing statement, executed as the endpoint
            # binds it, once per spelling. A SELECT over a reference table.
            listing = next(
                sql for sql, _ in calls if "starts_with(obligation_key" in sql)
            correct = await conn.fetch(listing, "income_tax", None, None, None)
            typo = await conn.fetch(listing, "incometax", None, None, None)

            return (failures, params,
                    {r["authority"]: r["n"] for r in by_authority},
                    len(correct), len(typo))
        finally:
            await conn.close()

    return asyncio.run(run())


def test_every_statement_the_endpoint_issues_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means an untyped `$1 + $2`, which PgBouncer turns
    into an instant 500 rather than an error anybody can read."""
    failures, _, _, _, _ = live
    assert not failures, "\n\n".join(f"{err}\n{sql}" for sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    """Postgres counts the placeholders; the code counts the arguments. No
    offline check can see the two part company."""
    _, params, _, _, _ = live
    wrong = [(sql, d, b) for sql, d, b in params if d != b]
    assert not wrong, "\n\n".join(
        f"declares ${d} but binds {b} arguments\n{sql}" for sql, d, b in wrong)


def test_the_live_column_holds_income_tax_and_has_never_held_incometax(live):
    """THE TWO SPELLINGS, COUNTED ON THE LIVE TABLE.

    Read-only on 2026-08-26: income_tax 22, gst 18, esic 4, epfo 1 — 45 rows,
    and `incometax` is not among them and never was. The frontend's page map
    asked for the second spelling, so every income-tax obligation was dropped
    from the Finance page's Due tab with no error anywhere.

    ── WHY THIS NO LONGER PINS 22 ─────────────────────────────────────────────

    It did, and it was right to on the day it was written — a count is the
    sharpest way to state a defect whose symptom is rows going missing. But the
    number is not the invariant: `statute_calendar` is a law store that GROWS as
    the law is written down. Within a day of that test landing, 5.1 seeded three
    EPF rows, 5.2 seeded seven terminal-benefit rows and 5.2b began seeding the
    income-tax ladder — and a pinned count turns each of those into a red test
    for an authority they are not about.

    So the assertions are the ones that cannot drift with honest seeding: the
    typo spelling holds ZERO rows and always has, the correct spelling holds
    rows and never fewer than the 22 the defect was measured against, and both
    counts come from the endpoint's own statement rather than a hand-written
    copy of it.

    Asserted against the CATALOGUE rather than the migration files: migrations
    are applied by hand on this database and the ledger has been wrong before.
    """
    _, _, by_authority, correct, typo = live
    assert by_authority.get("incometax") is None, (
        "the premise changed: the live table now holds rows spelled "
        "`incometax`, and both spellings are in play")
    assert by_authority.get("income_tax", 0) >= 22, (
        f"income_tax rows have GONE — the live table holds "
        f"{by_authority.get('income_tax')} against the 22 this defect was "
        f"measured with. Rows may be added; they may not vanish.")
    assert set(by_authority) == set(statute_router._AUTHORITIES), (
        f"the allowlist and the live column disagree: allowlist "
        f"{sorted(statute_router._AUTHORITIES)}, live {sorted(by_authority)}")

    # The endpoint's own statement, run both ways. This is the defect, live:
    # every income-tax obligation reachable under one spelling and none under
    # the other.
    assert correct >= 22
    assert correct == by_authority.get("income_tax", 0)
    assert typo == 0
