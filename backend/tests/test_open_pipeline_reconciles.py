"""Every reading of "open pipeline" applies the SAME predicate.

── THE FINDING, SUITE 12.11 ON 2026-08-31 ──────────────────────────────────

12.11 does not assert a number. It reads one concept from three surfaces and
requires them to agree, and three of thirty-one figures did not:

    GET /v1/dristi/overview  deals.pipeline_value, tiled "Open pipeline"
    the Pipeline tab's funnel, which excludes Won and Lost
    analytics.run graha.pipeline_by_stage, minus Won and Lost

The Dristi tile was `COALESCE(SUM(value), 0)` over `graha_deals` with no
predicate beyond `org_id`. Measured live on the reference org 2026-08-31:
**35,730,000 shown against 26,320,000 open — 9,410,000 of won and lost deals
counted as open, 15 of 33 deals already closed.** A 36% overstatement of the
one number a sales lead plans the quarter from.

── WHY THIS TEST COMPARES SOURCES RATHER THAN LITERALS ─────────────────────

The obvious test writes the predicate down twice and checks the router against
the copy. That test passes forever while the two real readers drift apart,
which is precisely how the defect arrived: `analytics.py`'s client report had
`open_pipeline_value` correctly scoped, the metric registry had it correctly
scoped, and the tile between them did not — three maintained definitions, one
of them wrong, and nothing comparing them.

So the assertions below build the metric's SQL from the REGISTRY BUILDER and
the tile's SQL by CAPTURING the router, and compare those two artefacts. There
is no third copy of the rule in this file to keep in step.

`graha_deals.archived_at` is in the metric's predicate and in the tile's, and
`is_active` in both: a soft-deleted or archived deal is not open anywhere else
in the product either.

── THE OTHER HALF, AND WHERE IT LIVES ──────────────────────────────────────

Scoping the READ was half the repair. The predicate is on `won_at`/`lost_at`,
and both write paths failed to maintain those columns — a deal created at a
closing stage was never stamped, and a re-opened deal was never un-stamped.
That is `test_deal_close_is_a_timestamp.py`; without it this file pins a
correct query over columns nothing keeps true.

MUTATION-PROVED 2026-08-31: restoring the tile's bare `COALESCE(SUM(value),0)`
turns `test_the_tile_and_the_metric_agree` and
`test_the_tile_excludes_closed_deals` red; dropping `archived_at` from the
tile alone turns the agreement test red on that term.
"""
import asyncio
import re

import pytest

from routers import dristi as dr
from analytics.registry import REGISTRY, MetricRequest, load_all

# The metric registry does not import graha from `load_all()` yet; importing
# the module registers it, exactly as `test_metrics_graha.py` does.
import analytics.metrics.graha  # noqa: E402,F401

load_all()

ORG = "00000000-0000-0000-0000-0000000000aa"
USER = {"user_id": "user_admin001"}


def _norm(sql: str) -> str:
    return " ".join(str(sql).split())


class CapturePool:
    """Records statements; returns nothing, writes nothing.

    Deliberately the same shape as `test_dristi_overview_excludes_drafts.py`'s
    pool rather than an import from it — a shared harness between two files
    that pin different rules is a dependency neither file declares.
    """

    def __init__(self):
        self.statements: list[str] = []

    def _rec(self, sql):
        if isinstance(sql, str) and sql.strip():
            self.statements.append(sql)

    async def fetch(self, sql, *a, **k):
        self._rec(sql)
        return []

    async def fetchrow(self, sql, *a, **k):
        self._rec(sql)
        return None

    async def fetchval(self, sql, *a, **k):
        self._rec(sql)
        return 0

    async def execute(self, sql, *a, **k):
        self._rec(sql)
        return "SELECT 0"


@pytest.fixture(scope="module")
def tile_sql() -> str:
    """The deals statement the Dristi overview actually issues."""
    pool = CapturePool()
    orig_pool, orig_reach = dr.get_pool, dr.reachable_modules

    async def _get_pool():
        return pool

    async def _reachable(pool_, user_id, org_id, codes):
        return set(codes)

    dr.get_pool, dr.reachable_modules = _get_pool, _reachable
    try:
        try:
            asyncio.run(dr.overview(date_from="", date_to="",
                                    user=USER, org_id=ORG, _g=None))
        except Exception:                                     # noqa: BLE001
            pass
    finally:
        dr.get_pool, dr.reachable_modules = orig_pool, orig_reach

    reads = [_norm(s) for s in pool.statements
             if "graha_deals" in s and "pipeline_value" in s]
    assert len(reads) == 1, (
        "the harness saw %d deals reads, not 1 — every assertion below would "
        "then be inspecting nothing" % len(reads))
    return reads[0]


@pytest.fixture(scope="module")
def metric_sql() -> str:
    """`graha.pipeline_by_stage` as the registry builds it."""
    m = REGISTRY["graha.pipeline_by_stage"]
    sql, _ = m.sql(MetricRequest(org_id=ORG, window=None, bucket="month",
                                 group_by=None))
    return _norm(sql)


#: The three terms that make a deal open. Named so a failure says WHICH one is
#: missing rather than dumping two queries side by side.
TERMS = {
    "not won":      r"won_at\s+IS\s+NULL",
    "not lost":     r"lost_at\s+IS\s+NULL",
    "not archived": r"archived_at\s+IS\s+NULL",
    "not deleted":  r"is_active\s*=\s*TRUE",
}


def _terms(sql: str) -> set[str]:
    return {name for name, pat in TERMS.items()
            if re.search(pat, sql, re.IGNORECASE)}


def test_the_metric_is_the_definition(metric_sql):
    """The reference the other assertions are measured against.

    If the registry itself loses a term this fails FIRST, so a later agreement
    test cannot pass by both sides being equally wrong.
    """
    assert _terms(metric_sql) == set(TERMS), (
        "graha.pipeline_by_stage no longer states the rule it documents: "
        f"missing {set(TERMS) - _terms(metric_sql)}")


def test_the_tile_excludes_closed_deals(tile_sql):
    """THE DEFECT. RED with the shipped `COALESCE(SUM(value), 0)`."""
    missing = set(TERMS) - _terms(tile_sql)
    assert not missing, (
        "the Dristi tile labelled 'Open pipeline' does not exclude "
        f"{sorted(missing)} — measured live 2026-08-31, that was 9,410,000 of "
        "closed deals inside a 35,730,000 headline")


def test_the_tile_and_the_metric_agree(tile_sql, metric_sql):
    """The reconciliation 12.11 is actually testing, as one assertion.

    Compared as SETS of terms, not as text: the two statements legitimately
    differ in shape — one groups by stage, one is a single row of KPIs. What
    has to agree is what they exclude.
    """
    assert _terms(tile_sql) == _terms(metric_sql), (
        "the overview tile and graha.pipeline_by_stage disagree about what "
        f"'open' means: tile={sorted(_terms(tile_sql))} "
        f"metric={sorted(_terms(metric_sql))}")


def test_the_client_report_agrees_too(tile_sql):
    """`analytics.py`'s `open_pipeline_value` is the third reader and was the
    only one already right; it is pinned here so a future edit cannot quietly
    make the majority wrong."""
    import inspect
    from routers import analytics

    src = inspect.getsource(analytics)
    m = re.search(r"open_pipeline_value.{0,400}", src, re.S)
    assert m, "open_pipeline_value is gone from the client report"
    stmt = re.search(
        r'"SELECT COALESCE\(SUM\(value\), 0\)::float "(.{0,600}?)client_id, org_id\)',
        src, re.S)
    assert stmt, "the client report's pipeline statement could not be located"
    assert _terms(_norm(stmt.group(1))) == set(TERMS)


def test_the_closed_aggregates_were_not_collateral(tile_sql):
    """Only `pipeline_value` moves.

    `total_deals`, `won_deals`, `won_value` and `lost_deals` answer a different
    question — "how did we do", not "what is still open" — and they count on
    the STAGE, which is what a person reads on the board. Narrowing them to the
    timestamp in the same edit would have silently dropped the 8 deals that
    read Won or Lost with no timestamp, replacing an overstated pipeline with
    an understated win count.
    """
    assert "COUNT(*) AS total_deals" in tile_sql
    for frag in ("COUNT(*) FILTER (WHERE stage='Won') AS won_deals",
                 "COUNT(*) FILTER (WHERE stage='Lost') AS lost_deals"):
        assert frag in tile_sql, f"missing or altered: {frag}"
    assert "SUM(value) FILTER (WHERE stage='Won')" in tile_sql


def test_the_tile_is_still_one_round_trip(tile_sql):
    """Cheap guard against the tempting fix — a second query for the pipeline
    figure. The overview already issues one statement per module and this page
    is the slowest in the product; the predicate belongs in the FILTER."""
    assert tile_sql.count("FROM public.graha_deals") == 1
