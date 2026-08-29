"""The three Dristi surfaces Phase 2.4 walked past.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────

2.4 took drafts out of the revenue TREND CHART. Three more reads over the same
table, two of them in the same router, kept counting them:

  · `dristi.overview` — the KPI tile. Its invoice read was
    `WHERE org_id=$1::uuid` and nothing else. Measured live 2026-08-26 for
    E2E Test & Associates: **total_invoiced Rs 12,29,86,008.58 against a
    draft-free Rs 11,14,93,756.12** — a Rs 1,14,92,252.46 phantom across 97
    draft rows — and **outstanding Rs 3,86,36,429.46 against Rs 2,71,54,767.00**.
    E2E holds ZERO inactive invoices, so every rupee of that gap is drafts.

    This tile sits DIRECTLY ABOVE the trend chart 2.4 fixed. Two numbers over
    one table, on one screen, disagreeing by a crore and a half — metric drift,
    the analytics programme's named failure mode, rendered twice in one view.

  · `dristi.run_pivot_query` — the custom-dashboard builder. Beyond `org_id`
    its only predicate was `spec["soft_delete"]`, so `source=invoices,
    measure=sum` returned the same Rs 12,29,86,008.58.

  · `dristi._fetch_report_data("overview")` — the exported twin, summing
    `total` on `payment_status='paid'` with no draft test. Live for Unicode
    Group: **Rs 27,39,830 against Rs 25,33,330** — one draft invoice marked
    paid, Rs 2,06,500. E2E has no paid draft, so E2E alone could not have
    shown this and the probe has to look at both orgs.

The pivot ALSO carried the date-bind bug `documents.py:300-315` documents:

    where.append(f"{date_col} >= ${len(params)}::date")

with a Python `str` off the request body. Postgres infers such a parameter as
`date` and asyncpg refuses the bind outright —

    DataError: invalid input for query argument $2: '2026-01-01'
               ('str' object has no attribute 'toordinal')

— so ANY pivot with a date filter raised before it read a row. Fixed with the
`::text::date` double cast `gst_period.py` and `_tally_rows` already use.

── FOUND HERE, DELIBERATELY NOT FIXED ───────────────────────────────────────

`run_pivot_query`'s `body.filters` loop binds `str(fv)` against a bare
`{col} = $N`. Of the 42 columns the eight sources make filterable, **15 are
`date` or `timestamp`**, and every one of them raises the SAME `DataError` —
reproduced live 2026-08-26 with `invoice_date = $2` and the string `'1000'`,
while the numeric columns bind cleanly.

It is left alone because the repair is a product decision, not a cast:
`created_at = '2026-01-01'` on a `timestamptz` column has to mean the whole
day or nothing, and guessing which would put a wrong answer where an error is
now. Recorded rather than patched — the same call `KNOWN_UNPLANNABLE` records
in `test_drafts_are_not_dunned.py`.

── WHY THIS FILE IS SHAPED LIKE `test_drafts_are_not_dunned.py` ─────────────

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock
answers `[]` to any statement it is given — valid SQL, invalid SQL, a shopping
list. It also accepts an argument of ANY type, which is precisely why the date
bind above survived a green suite. So, the two halves that file established:

  1. CAPTURE, offline. The callables are invoked with a pool that records the
     statement AND THE ARGUMENTS and answers emptily. Their own Python builds
     the SQL. Runs everywhere.

  2. PARSE AND EXECUTE, live. `prepare()` plans each captured statement
     against the real catalogue; then each is run with the arguments its own
     caller bound, and the draft-sensitive ones are run TWICE — as written and
     with the guard textually removed. The difference between the two answers
     is the drafts, and that is the only honest proof.

Everything against the live database here is a `SELECT`. Staging and production
share one Supabase project (CLAUDE.md), so that is not a nicety.

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_dristi_overview_excludes_drafts.py -q
"""
from __future__ import annotations

import asyncio
import os
import re

import pytest

from routers import dristi as dr

#: The canonical filter, quoted rather than re-derived. `services/gst_period.py`
#: settled it (:209, :425) and carries the reasoning; five surfaces now copy it.
CANONICAL = "AND COALESCE(doc_status, '') <> 'draft'"

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognised BY VALUE because conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` does on every connection, so a statement is planned the way it
#: will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

USER = {"user_id": "user_admin001"}

#: An org id that matches nothing, so every captured statement replayed live is
#: a zero-row SELECT. The bind, not the answer, is what those checks measure.
ORG = "00000000-0000-0000-0000-0000000000aa"

#: The two orgs this work is scoped to (owner decision). The live half reads
#: only these; a gap that exists only in Aekam/Demo is not a defect here.
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"
UNICODE_ORG = "fae87907-2f99-4b35-a241-c94d9e1e4a17"
IN_SCOPE = (E2E_ORG, UNICODE_ORG)

#: Dates as STRINGS, which is what FastAPI hands the pivot off the request body
#: and therefore what it must be able to bind.
PERIOD = ("2026-01-01", "2026-08-26")


def _norm(sql: str) -> str:
    return " ".join(sql.split())


# ══════════════════════════════════════════════════════════════════════════════
#  Capture — no database, no writes
# ══════════════════════════════════════════════════════════════════════════════

class CapturePool:
    """Records every statement, with the arguments its caller bound.

    The ARGUMENTS are half the check. The pivot bound ISO strings into
    `$2::date` and asyncpg refused every one, so the route raised before
    reading a row — SQL text alone cannot see that, and neither can `prepare()`.
    """

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

    `reachable_modules` is answered YES for whatever it is asked, because the
    entitlement check is not what is under test and a NO would skip the very
    reads this file is about. An exception on the way out is not a failure of
    the harness — the statements it managed to issue are the subject.
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
    """The KPI tile, on the no-window branch — the one the page loads with."""
    return _capture(lambda: dr.overview(
        date_from="", date_to="", user=USER, org_id=ORG, _g=None,
    ))


@pytest.fixture(scope="module")
def overview_windowed_pool() -> CapturePool:
    """The same tile with a date range, which is a DIFFERENT statement.

    Worth its own capture only because of what the pivot turned out to be: the
    windowed branch appends `$2::date`, and whether that is safe depends
    entirely on `aw.parse` handing back `date` objects rather than the strings
    it was given. That is a fact about another module, so it is measured here
    rather than assumed.
    """
    return _capture(lambda: dr.overview(
        date_from=PERIOD[0], date_to=PERIOD[1], user=USER, org_id=ORG, _g=None,
    ))


@pytest.fixture(scope="module")
def trend_pool() -> CapturePool:
    """The trend chart 2.4 fixed, drawn directly beneath the tile above.

    Captured only so the two can be compared as they are actually built. If
    the tile ever drifts from it again, that comparison is what says so.
    """
    return _capture(lambda: dr.revenue_trends(
        months=12, date_from="", date_to="", user=USER, org_id=ORG, _g=None,
    ))


@pytest.fixture(scope="module")
def pivot_pool() -> CapturePool:
    """`source=invoices, measure=sum`, WITH a date range — the branch that
    carried both the missing filter and the refused bind."""
    body = dr.PivotQuery(source="invoices", group_by="payment_status",
                         measure="sum", date_from=PERIOD[0], date_to=PERIOD[1])
    return _capture(lambda: dr.run_pivot_query(body=body, user=USER, org_id=ORG))


@pytest.fixture(scope="module")
def pivot_deals_pool() -> CapturePool:
    """The same builder over a source with NO `doc_status` column.

    `staging.graha_deals` has no such column, so a filter applied to every
    source instead of the declared ones turns this into an UndefinedColumn 500.
    The guard has to be per-source or it is a new outage.
    """
    body = dr.PivotQuery(source="deals", group_by="stage", measure="sum",
                         date_from=PERIOD[0], date_to=PERIOD[1])
    return _capture(lambda: dr.run_pivot_query(body=body, user=USER, org_id=ORG))


@pytest.fixture(scope="module")
def export_pool() -> CapturePool:
    """`_fetch_report_data("overview")` — the CSV/PDF twin of the tile.

    A plain function with no gate to fake, so it takes the capture pool
    directly. `win=None` is what a scheduled report passes.
    """
    pool = CapturePool()
    try:
        asyncio.run(dr._fetch_report_data(pool, ORG, "overview", None))
    except Exception:                                         # noqa: BLE001
        pass
    return pool


def _invoice_reads(pool: CapturePool) -> list[str]:
    return [_norm(s) for s in pool.statements if "ganit_invoices" in s]


def _guards(sql: str) -> set[str]:
    """Which predicates a statement applies to `ganit_invoices`.

    Compared as a SET rather than as text because these queries legitimately
    differ in shape — one groups by month, one is a single row of KPIs, one
    pivots. What must agree is what they exclude.
    """
    found = set()
    if re.search(r"is_active\s*=?\s*TRUE", sql):
        found.add("is_active")
    if "doc_status" in sql and "draft" in sql:
        found.add("not_draft")
    return found


# ══════════════════════════════════════════════════════════════════════════════
#  The capture half — runs everywhere, including with no database
# ══════════════════════════════════════════════════════════════════════════════

def test_the_capture_sees_every_surface(
        overview_pool, overview_windowed_pool, trend_pool, pivot_pool,
        pivot_deals_pool, export_pool):
    """Guard on the harness itself.

    If capture silently stopped working, every assertion below would pass by
    inspecting nothing — the exact failure mode this file exists to end,
    reproduced inside it.
    """
    for name, pool in (("overview KPI tile", overview_pool),
                       ("overview KPI tile, windowed", overview_windowed_pool),
                       ("revenue trend chart", trend_pool),
                       ("pivot / invoices", pivot_pool),
                       ("overview export", export_pool)):
        got = len(_invoice_reads(pool))
        assert got == 1, (
            f"{name} issued {got} reads against ganit_invoices, expected 1. "
            f"The capture is no longer seeing the caller.")
    assert any("graha_deals" in s for s in pivot_deals_pool.statements), (
        "the deals pivot issued no graha_deals read — the per-source check "
        "below certifies nothing")


def test_the_canonical_filter_still_lives_in_gst_period():
    """The expression is quoted from `services/gst_period.py`. If that module
    ever changes its mind, this file must be told rather than silently
    certifying a form nothing else uses any more."""
    import inspect

    from services import gst_period

    assert CANONICAL in inspect.getsource(gst_period), (
        f"{CANONICAL!r} is no longer in services/gst_period.py, which is where "
        f"this filter was settled (:209 and :425). Five surfaces copy it; "
        f"reconcile them deliberately.")


def test_the_overview_kpi_tile_excludes_drafts(
        overview_pool, overview_windowed_pool):
    """97 drafts, Rs 1,14,92,252.46, counted as invoiced revenue for E2E.

    Both branches. The guard is concatenated before the window clause, so one
    covering the other is the expectation rather than the proof.
    """
    for name, pool in (("default", overview_pool),
                       ("windowed", overview_windowed_pool)):
        [sql] = _invoice_reads(pool)
        assert CANONICAL in sql, (
            f"the Dristi overview KPI tile ({name} branch) counts unissued "
            f"documents as invoiced revenue and as outstanding receivables:"
            f"\n  {sql}")


def test_the_kpi_tile_agrees_with_the_chart_printed_beneath_it(
        overview_pool, trend_pool):
    """The tile and the trend chart are stacked in one view over one table.

    2.4 fixed the chart and not the tile, so the page shipped disagreeing with
    itself by Rs 1,14,92,252.46 — a reader has no way to tell which half to
    believe, which is worse than either being wrong alone.
    """
    [tile] = _invoice_reads(overview_pool)
    [chart] = _invoice_reads(trend_pool)
    assert _guards(tile) == _guards(chart) == {"is_active", "not_draft"}, (
        f"the KPI tile and the trend chart below it filter the same table "
        f"differently:\n  tile : {sorted(_guards(tile))}\n"
        f"  chart: {sorted(_guards(chart))}")


def test_the_exported_overview_agrees_with_the_tile(export_pool, overview_pool):
    """`_fetch_report_data("overview")` is the same money on its way to CSV and
    PDF. Fixing only the screen would recreate the disagreement one layer down —
    live for Unicode the export carried one paid draft, Rs 2,06,500."""
    [export] = _invoice_reads(export_pool)
    [tile] = _invoice_reads(overview_pool)
    assert _guards(export) == _guards(tile) == {"is_active", "not_draft"}, (
        f"the exported overview and the on-screen tile filter the same table "
        f"differently:\n  tile  : {sorted(_guards(tile))}\n"
        f"  export: {sorted(_guards(export))}")
    assert CANONICAL in export, export


def test_the_pivot_builder_excludes_drafts_from_the_invoice_source(pivot_pool):
    """`source=invoices, measure=sum` was the whole ledger, drafts and all."""
    [sql] = _invoice_reads(pivot_pool)
    assert CANONICAL in sql, (
        f"the custom-dashboard pivot sums drafts into the invoice total:\n  {sql}")


def test_the_pivot_guard_is_per_source_not_global(pivot_deals_pool):
    """`graha_deals` has no `doc_status`. A filter appended to every source
    would make this query UndefinedColumn — the fix must be declared on the
    source, the way `soft_delete` already is."""
    for sql in pivot_deals_pool.statements:
        assert "doc_status" not in sql, (
            f"the deals pivot now filters on doc_status, a column "
            f"public.graha_deals does not have:\n  {_norm(sql)[:200]}")


def test_only_invoice_sources_declare_the_draft_guard():
    """The declaration itself, read off the spec rather than off one query.

    `ganit_invoices` is the only source in the builder that has `doc_status`;
    the flag is what keeps the next source added from inheriting a filter its
    table cannot answer.
    """
    flagged = {name for name, spec in dr._ALLOWED_QUERY_TABLES.items()
               if spec.get("not_draft")}
    assert flagged == {"invoices"}, (
        f"sources declaring the draft guard: {sorted(flagged)}. Only "
        f"`invoices` reads public.ganit_invoices; every other table in the "
        f"builder would raise UndefinedColumn on doc_status.")


def test_the_nullable_safe_form_is_used_everywhere(
        overview_pool, pivot_pool, export_pool):
    """`doc_status <> 'draft'` alone drops every NULL row — the column is
    nullable and NULL <> 'draft' is NULL. That is the same bug pointed the
    other way, and it would hide every invoice predating the column."""
    for name, pool in (("overview", overview_pool), ("pivot", pivot_pool),
                       ("export", export_pool)):
        for sql in _invoice_reads(pool):
            bare = re.search(r"(?<!COALESCE\()\b(?:i\.)?doc_status\s*<>\s*'draft'",
                             sql)
            assert bare is None, (
                f"bare `doc_status <> 'draft'` in the {name} path:\n  {sql[:200]}")


def test_the_pivot_casts_its_dates_twice(pivot_pool):
    """`$2::date` with a Python `str` bound to it is a DataError, not a query.

    Asserted on the SQL as well as on the live bind below, because the live
    half skips without a database and this branch is unreachable for every
    caller until it is fixed. `::text::date` makes the parameter infer as
    `text` and casts server-side; nothing about the comparison changes.
    """
    [sql] = _invoice_reads(pivot_pool)
    single = re.search(r"\$\d+::date\b", sql)
    assert single is None, (
        f"the pivot binds a date parameter as `{single.group(0) if single else ''}` "
        f"while passing an ISO string — asyncpg refuses the bind and the route "
        f"raises before reading a row. Use the `::text::date` form "
        f"`documents.py` and `gst_period.py` already use:\n  {sql}")
    assert re.search(r"\$\d+::text::date\b", sql), (
        f"no `::text::date` cast in the dated pivot query at all:\n  {sql}")


def test_the_pivot_really_bound_strings(pivot_pool):
    """Guard on the check above: it only means something because the route is
    handed `str`, which is what FastAPI parses the request body into."""
    [(_, args)] = [(s, a) for s, a in pivot_pool.calls if "ganit_invoices" in s]
    assert args[1:] == PERIOD, (
        f"the pivot no longer binds the period as ISO strings ({args[1:]!r}); "
        f"re-read the cast check above before trusting it")


# ══════════════════════════════════════════════════════════════════════════════
#  The live half — parse, then execute read-only
# ══════════════════════════════════════════════════════════════════════════════

SKIP_REASON = (
    "no live database. These checks run each query against the real catalogue, "
    "once as written and once with the draft guard removed — a MagicMock pool "
    "answers [] to both and proves nothing. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_dristi_overview_excludes_drafts.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def _live(fn):
    """Run one read-only coroutine against the live database, or skip.

    Only the CONNECT is allowed to turn into a skip. Once the socket is open,
    whatever `fn` raises is raised — the pre-fix pivot failed with a `DataError`
    on its own date bind, and a blanket `except` around the whole block reported
    that as "could not reach the database", which is how a broken query gets to
    look like an absent one.
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
    """The same statement with the draft filter textually removed.

    Comparing the two answers is the measurement. Nothing else about the
    statement changes, so the difference cannot be anything but the drafts.
    """
    # Removed without assuming a trailing space: on the KPI tile and the export
    # the guard is the LAST clause in the statement, and a `CANONICAL + " "`
    # replace silently matches nothing there.
    out = _norm(_norm(sql).replace(CANONICAL, ""))
    assert out != _norm(sql), f"nothing was removed — the guard is not in:\n{sql}"
    return out


def test_every_captured_statement_plans_against_the_real_catalogue(
        overview_pool, overview_windowed_pool, pivot_pool, pivot_deals_pool,
        export_pool):
    """`prepare()` sends Parse and Describe and STOPS. The server plans the
    statement, resolves every relation, column and parameter type, and returns
    the shapes — it does not execute, does not read a row, does not write one.

    This is the check CLAUDE.md requires of any router change: a column that
    does not exist is invisible to the offline suite, and the per-source guard
    above is exactly the kind of change that invents one.
    """
    async def go(conn):
        failures = []
        for name, pool in (("overview", overview_pool),
                           ("overview/windowed", overview_windowed_pool),
                           ("pivot", pivot_pool),
                           ("pivot/deals", pivot_deals_pool),
                           ("export", export_pool)):
            for sql in pool.statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append(f"{name}: {type(exc).__name__}: {exc}"
                                    f"\n    {_norm(sql)[:200]}")
        return failures

    failures = _live(go)
    assert not failures, ("statements the server refuses to plan:\n  "
                          + "\n  ".join(failures))


def test_live_every_query_binds_the_way_its_caller_binds_it(
        overview_pool, overview_windowed_pool, pivot_pool, pivot_deals_pool,
        export_pool):
    """THE HALF `prepare()` CANNOT SEE.

    Parsing proves the SQL is valid. It says nothing about whether the VALUES
    the caller passes can be bound to it, and that is where the pivot was
    broken: an ISO string into `$2::date` is a DataError, so every dated pivot
    raised before reading a row. A MagicMock pool accepts any argument of any
    type, so the offline suite could never have seen it.

    Each statement runs with the arguments ITS OWN CALLER captured. The org id
    is a fixture that matches nothing, so every one is a zero-row SELECT.
    """
    async def go(conn):
        failures = []
        for name, pool in (("overview KPI tile", overview_pool),
                           ("overview KPI tile, windowed", overview_windowed_pool),
                           ("pivot / invoices", pivot_pool),
                           ("pivot / deals", pivot_deals_pool),
                           ("overview export", export_pool)):
            for sql, args in pool.calls:
                try:
                    await conn.fetch(sql, *args)
                except Exception as exc:                      # noqa: BLE001
                    failures.append(f"{name}: {type(exc).__name__}: {exc}"
                                    f"\n    {_norm(sql)[:180]}\n    args={args!r}")
        return failures

    failures = _live(go)
    assert not failures, ("queries their own caller cannot bind:\n  "
                          + "\n  ".join(failures))


def test_live_the_kpi_tile_drops_real_drafts(overview_pool):
    """Executed both ways against the in-scope org that actually holds drafts.

    Both figures on the tile are asserted, not just the headline: `outstanding`
    is a receivable, and dunning a client for an unissued document is the same
    defect as booking it as revenue.
    """
    [sql] = _invoice_reads(overview_pool)

    async def go(conn):
        org = await conn.fetchval(
            "SELECT org_id::text FROM public.ganit_invoices "
            "WHERE org_id = ANY($1::uuid[]) AND COALESCE(doc_status,'') = 'draft' "
            "  AND is_active = TRUE "
            "GROUP BY org_id ORDER BY COUNT(*) DESC LIMIT 1", list(IN_SCOPE))
        if org is None:
            pytest.skip("neither in-scope org holds a draft invoice any more — "
                        "the fixture is the live table, and it has moved")
        drafts = await conn.fetchrow(
            "SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS amt, "
            "COALESCE(SUM(total - amount_paid) FILTER "
            "  (WHERE payment_status NOT IN ('paid','cancelled')),0)::float AS due "
            "FROM public.ganit_invoices WHERE org_id = $1::uuid "
            "  AND COALESCE(doc_status,'') = 'draft' AND is_active = TRUE", org)
        fixed = await conn.fetchrow(_norm(sql), org)
        before = await conn.fetchrow(_without_guard(sql), org)
        return org, dict(drafts), dict(fixed), dict(before)

    org, drafts, fixed, before = _live(go)
    assert drafts["n"] > 0
    for key, moved in (("total_invoiced", drafts["amt"]),
                       ("outstanding", drafts["due"])):
        b, f = float(before[key]), float(fixed[key])
        assert b > f, (
            f"removing the guard changed {key} by nothing — the tile is not "
            f"filtering. org={org} drafts={drafts['n']}")
        assert round(b - f, 2) == round(moved, 2), (
            f"the difference between the two answers for {key} is not the "
            f"drafts: before={b:.2f} fixed={f:.2f} drafts={moved:.2f}")


def test_live_the_pivot_drops_the_same_drafts_as_the_tile(
        pivot_pool, overview_pool):
    """One table, two surfaces, one total. Run un-windowed so the pivot's sum
    covers the same rows as the tile's and the two can be compared."""
    [pivot_sql] = _invoice_reads(pivot_pool)
    [tile_sql] = _invoice_reads(overview_pool)

    async def go(conn):
        org = await conn.fetchval(
            "SELECT org_id::text FROM public.ganit_invoices "
            "WHERE org_id = ANY($1::uuid[]) AND COALESCE(doc_status,'') = 'draft' "
            "  AND is_active = TRUE "
            "GROUP BY org_id ORDER BY COUNT(*) DESC LIMIT 1", list(IN_SCOPE))
        if org is None:
            pytest.skip("no in-scope org holds a draft invoice any more")
        # The captured pivot is windowed; widen the dates so both statements
        # cover every row and the totals are comparable.
        wide = ("2000-01-01", "2099-12-31")
        pivot_total = sum(float(r["value"] or 0)
                          for r in await conn.fetch(pivot_sql, org, *wide))
        tile = await conn.fetchrow(tile_sql, org)
        return org, pivot_total, float(tile["total_invoiced"])

    org, pivot_total, tile_total = _live(go)
    assert round(pivot_total, 2) == round(tile_total, 2), (
        f"the pivot builder and the overview tile disagree about the invoiced "
        f"total for org {org}: pivot={pivot_total:.2f} tile={tile_total:.2f}")


def test_live_the_exported_overview_drops_a_paid_draft(export_pool):
    """The export sums `payment_status='paid'`, so it only moves where a draft
    is ALSO marked paid — one row, Rs 2,06,500, in Unicode Group. E2E has none,
    which is why an E2E-only probe would have certified the bug as fixed."""
    [sql] = _invoice_reads(export_pool)

    async def go(conn):
        org = await conn.fetchval(
            "SELECT org_id::text FROM public.ganit_invoices "
            "WHERE org_id = ANY($1::uuid[]) AND COALESCE(doc_status,'') = 'draft' "
            "  AND is_active = TRUE AND payment_status = 'paid' "
            "GROUP BY org_id ORDER BY COUNT(*) DESC LIMIT 1", list(IN_SCOPE))
        if org is None:
            pytest.skip("no in-scope org holds a draft marked paid any more — "
                        "the fixture is the live table, and it has moved")
        moved = await conn.fetchval(
            "SELECT COALESCE(SUM(total),0)::float FROM public.ganit_invoices "
            "WHERE org_id = $1::uuid AND COALESCE(doc_status,'') = 'draft' "
            "  AND is_active = TRUE AND payment_status = 'paid'", org)
        fixed = float(await conn.fetchval(_norm(sql), org) or 0)
        before = float(await conn.fetchval(_without_guard(sql), org) or 0)
        return org, float(moved), fixed, before

    org, moved, fixed, before = _live(go)
    assert moved > 0
    assert round(before - fixed, 2) == round(moved, 2), (
        f"the exported overview's revenue did not move by the paid drafts for "
        f"org {org}: before={before:.2f} fixed={fixed:.2f} drafts={moved:.2f}")
