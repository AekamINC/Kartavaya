"""The Sahayak metrics, held to the ledger facts their docstring promises.

The guarantees a refactor could silently drop while everything else stays
green: spends are tx_type='debit' summed as -amount (never ABS over mixed
rows); reversals count BOTH spellings ('refund' and the pre-095 'credit');
pre-095 rows with NULL kind are labelled honestly, never classified by
parsing description; metered_only platform rows are INCLUDED in usage
(migration 095's own comment); the by-member split resolves names through
public.users and never emits a user id; the failure rate is counts over
counts from terminal outcomes only; scraper spend compares billed INR to the
CURRENT price list and leaves vendor cost in USD rather than inventing a
forex rate.

analytics/metrics/sahayak.py is not yet in registry.load_all() (the wiring is
the integration owner's file, not this batch's), so the universal walk from
test_analytics_registry.py is REPLICATED here.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring.
"""
import re
from datetime import date

import pytest

import analytics.metrics.sahayak  # noqa: F401 — registering is the import's effect
from analytics.registry import REGISTRY, MetricRequest
from analytics.windowing import BUCKETS
from services.analytics_window import Window

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

SAHAYAK_SQL = sorted(
    k for k, m in REGISTRY.items() if m.module == "sahayak" and m.sql is not None
)
SAHAYAK_ABSENT = sorted(
    k for k, m in REGISTRY.items() if m.module == "sahayak" and m.absent
)


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


def test_the_batch_is_declared_as_specified():
    expect = {
        "sahayak.credits_spent": ("flow", "count", "financial"),
        "sahayak.cost_per_run": ("flow", "count", "financial"),
        "sahayak.failure_rate": ("flow", "pct", "operational"),
        "sahayak.refund_rate": ("flow", "pct", "financial"),
        "sahayak.scraper_spend": ("flow", "inr", "financial"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["sahayak.credits_spent"].dimensions == ("skill", "member")
    assert REGISTRY["sahayak.scraper_spend"].dimensions == ("scraper",)
    assert SAHAYAK_ABSENT == ["sahayak.scraper_margin"]


# ── credits_spent ────────────────────────────────────────────────────────────

def test_credits_spent_is_debits_only_summed_as_negative_amount():
    sql, params = build("sahayak.credits_spent")
    assert "t.tx_type = 'debit'" in sql
    assert "SUM(-t.amount)::float AS value" in sql
    assert "t.created_at::date BETWEEN $2::date AND $3::date" in sql
    # grant/topup/expire move the wallet but are not spend; the equality
    # filter is what keeps them out.
    assert "grant" not in sql and "topup" not in sql and "expire" not in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_credits_spent_includes_metered_platform_rows():
    """Migration 095's comment: metered_only rows are EXCLUDED from balance
    reconciliation and INCLUDED in usage. This is usage — a filter appearing
    here would silently blank the platform org's own view."""
    for kw in ({}, {"group_by": "skill"}, {"group_by": "member"}):
        sql, _ = build("sahayak.credits_spent", **kw)
        assert "metered_only" not in sql


def test_credits_spent_by_skill_labels_pre_095_rows_honestly():
    sql, _ = build("sahayak.credits_spent", group_by="skill")
    assert "COALESCE(t.ref_id, t.kind, 'Pre-095 spend') AS skill" in sql
    # The 095 COMMENT: readers must NOT parse description for new rows — and
    # this reader does not parse it for any row.
    assert "description" not in sql
    assert "ORDER BY value DESC" in sql


def test_credits_spent_by_member_resolves_names_and_never_emits_an_id():
    sql, _ = build("sahayak.credits_spent", group_by="member")
    assert "LEFT JOIN public.users u ON u.user_id = t.user_id" in sql
    # THE ASSERTION MOVED FROM THE TEXT TO THE PROPERTY.
    #
    # This used to pin the literal `COALESCE(u.full_name, u.name, u.email, …)`.
    # Under a test named for names-never-ids, that string was the leak itself:
    # the owner ruled on 2026-08-23 that a display ladder must never end at an
    # email address, and a text match would have FAILED on the fix and passed on
    # the bug — teaching the next reader to revert rather than to keep the
    # property. So it asserts what actually matters: a name is resolved, no id
    # reaches the label, and the ladder does not reach `.email`.
    assert "u.full_name" in sql and "u.name" in sql
    assert "u.email" not in sql
    assert "'System'" in sql and "'Departed member'" in sql
    # Two departed members stay two rows: group on the key, label the name.
    assert "GROUP BY t.user_id" in sql
    # names-not-ids: in the select list the id may only be TESTED, never output.
    select_list = sql.split(" FROM ")[0]
    assert select_list.count("t.user_id") == 1
    assert "t.user_id IS NULL" in select_list
    assert "AS member" in select_list


# ── cost_per_run ─────────────────────────────────────────────────────────────

def test_cost_per_run_is_a_median_over_per_debit_magnitudes():
    sql, params = build("sahayak.cost_per_run")
    assert "percentile_cont(0.5) WITHIN GROUP (ORDER BY -t.amount)" in sql
    assert "AVG(" not in sql, "one 10-credit campaign must not move the typical run"
    assert "t.tx_type = 'debit'" in sql
    assert "COUNT(*) AS runs" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── failure_rate ─────────────────────────────────────────────────────────────

def test_failure_rate_is_counts_over_counts_across_both_run_tables():
    sql, params = build("sahayak.failure_rate")
    assert "COUNT(*) FILTER (WHERE d.failed)::float / NULLIF(COUNT(*), 0)::float * 100" in sql
    assert "AS failed" in sql and "AS runs" in sql
    assert "UNION ALL" in sql
    assert "FROM staging.hub_skill_runs r" in sql
    assert "FROM staging.hub_scraper_runs s" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_failure_rate_scopes_both_arms_to_the_org():
    """hub_skill_runs has NO org_id — its scope is the hub_clients hop. Both
    arms must bind the org, or one module's runs leak across tenants."""
    sql, _ = build("sahayak.failure_rate")
    assert sql.count("$1::uuid") == 2
    assert "JOIN staging.hub_clients hc ON hc.id = r.client_id" in sql
    assert "hc.org_id = $1::uuid" in sql
    assert "s.org_id = $1::uuid" in sql


def test_failure_rate_counts_terminal_outcomes_only():
    sql, _ = build("sahayak.failure_rate")
    # Two tables, two vocabularies — each pinned to its own terminal pair.
    assert "r.status IN ('completed', 'failed')" in sql
    assert "s.status IN ('succeeded', 'failed')" in sql
    # Neither in-flight nor cancelled may enter either side of the ratio.
    assert "'running'" not in sql
    assert "'pending'" not in sql
    assert "'cancelled'" not in sql


# ── refund_rate ──────────────────────────────────────────────────────────────

def test_refund_rate_is_sums_over_sums_counting_both_reversal_spellings():
    sql, params = build("sahayak.refund_rate")
    # 'credit' is what scrapers.py called a refund before 095 — counting only
    # 'refund' understates every pre-095 reversal
    # (services/credits._REVERSAL_TX_TYPES counts both for the same reason).
    assert "t.tx_type IN ('refund', 'credit')" in sql
    assert "NULLIF(SUM(-t.amount) FILTER (WHERE t.tx_type = 'debit'), 0)" in sql
    assert "AVG(" not in sql, "the mean of daily rates is not the period's rate"
    assert "AS refunded" in sql and "AS spent" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_refund_rate_reads_only_spend_and_reversal_rows():
    sql, _ = build("sahayak.refund_rate")
    assert "t.tx_type IN ('debit', 'refund', 'credit')" in sql
    assert "grant" not in sql and "expire" not in sql and "topup" not in sql


# ── scraper_spend ────────────────────────────────────────────────────────────

def test_scraper_spend_compares_billed_to_the_current_price_list():
    for kw in ({}, {"group_by": "scraper"}):
        sql, _ = build("sahayak.scraper_spend", **kw)
        assert "SUM(COALESCE(r.billed_inr, 0))::float AS value" in sql
        assert "SUM(c.price_inr)::float AS list_inr" in sql
        assert "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id" in sql
        assert "COUNT(*) AS runs" in sql


def test_scraper_spend_leaves_vendor_cost_in_usd():
    """No usd_inr rate exists per run — converting with today's rate would
    fabricate a figure that drifts as the rupee moves."""
    for kw in ({}, {"group_by": "scraper"}):
        sql, _ = build("sahayak.scraper_spend", **kw)
        assert "SUM(COALESCE(r.cost_usd, 0))::float AS cost_usd" in sql
        assert "usd_inr" not in sql and "forex" not in sql


def test_scraper_spend_by_scraper_labels_from_the_catalogue_never_the_id():
    sql, params = build("sahayak.scraper_spend", group_by="scraper")
    assert "c.name AS scraper" in sql
    # Group on the key so two actors sharing a name stay two rows…
    assert "GROUP BY c.id, c.name" in sql
    # …but the id never reaches the select list (names-not-ids).
    select_list = sql.split(" FROM ")[0]
    assert "c.id" not in select_list and "r.id" not in select_list
    assert "ORDER BY value DESC" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── the declared absence ─────────────────────────────────────────────────────

def test_scraper_margin_is_absent_for_want_of_a_stored_rate():
    m = REGISTRY["sahayak.scraper_margin"]
    assert m.sql is None
    assert "cost_usd" in m.absent and "billed_inr" in m.absent
    assert len(m.absent) > 60


# ── the universal walk, replicated until load_all() carries this module ──────

@pytest.mark.parametrize("key", SAHAYAK_SQL)
def test_every_runnable_metric_builds_sound_sql(key):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))
    assert isinstance(sql, str) and isinstance(params, list)
    assert re.search(r"\b(staging|public)\.", sql), f"{key}: unqualified table"
    assert "$1::uuid" in sql, f"{key}: org parameter not cast"
    assert params[0] == ORG
    placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert placeholders == set(range(1, len(params) + 1)), key
    if m.grain == "flow":
        assert params[1] == win.start and params[2] == win.end


@pytest.mark.parametrize("key", SAHAYAK_SQL)
def test_flow_metrics_honour_every_bucket(key):
    m = REGISTRY[key]
    if m.grain != "flow":
        pytest.skip("stocks take no bucket")
    for b in sorted(BUCKETS):
        sql, _ = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket=b))
        assert f"date_trunc('{b}'" in sql and "::date" in sql, f"{key} ignored bucket={b}"


@pytest.mark.parametrize("key", SAHAYAK_SQL)
def test_dimensions_are_reachable(key):
    m = REGISTRY[key]
    for dim in m.dimensions:
        sql, _ = build(key, group_by=dim)
        assert dim in sql, f"{key}: group_by={dim} accepted but absent from SQL"
