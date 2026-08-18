"""The graha (CRM) metrics, held to the guards their docstring promises.

test_analytics_registry.py walks every declaration for the universal contract
— but load_all() does not import graha until integration wires it in, so the
universal walk is REPLICATED here for graha's metrics first: this file must
fail on a violation today, not on the day the wiring lands.

The metric-specific pins are the ones a refactor could drop while every
universal check stays green: won/lost decided by TIMESTAMPS with no stage
literal anywhere (stages are per-org text), the rep join on assigned_to
(text) never owner_id (an unwritten uuid that once 500'd the kanban),
medians via percentile_cont rather than AVG, ratios from counts and sums
rather than averaged rates, archived closed deals counting in every flow
(migration 133: the record of revenue stays countable) while both board
stocks exclude them, and the three declared absences staying declared.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

import pytest

from analytics.registry import REGISTRY, MetricRequest, load_all
from analytics.windowing import BUCKETS
from services.analytics_window import Window

# load_all() does not yet know graha; importing the module registers it. The
# import is idempotent against a future load_all() that does include it.
import analytics.metrics.graha  # noqa: E402,F401

load_all()

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

RUNNABLE = sorted(
    k for k, m in REGISTRY.items() if m.module == "graha" and m.sql is not None
)
ABSENT = sorted(k for k, m in REGISTRY.items() if m.module == "graha" and m.absent)
FLOWS = [k for k in RUNNABLE if REGISTRY[k].grain == "flow"]
STOCKS = [k for k in RUNNABLE if REGISTRY[k].grain == "stock"]


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


# ── The declared batch, pinned ──────────────────────────────────────────────

def test_the_batch_is_declared_as_specified():
    expect = {
        "graha.pipeline_by_stage": ("stock", "inr", "financial"),
        "graha.win_rate": ("flow", "pct", "operational"),
        "graha.sales_cycle": ("flow", "days", "operational"),
        "graha.deal_aging": ("stock", "count", "operational"),
        "graha.lead_conversion": ("flow", "pct", "operational"),
        "graha.avg_deal_size": ("flow", "inr", "financial"),
        "graha.client_concentration": ("flow", "pct", "financial"),
        "graha.contacts_added": ("flow", "count", "operational"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert sorted(expect) == RUNNABLE
    assert REGISTRY["graha.win_rate"].dimensions == ("rep", "source", "size_band")
    assert REGISTRY["graha.lead_conversion"].dimensions == ("source", "lead_score")
    assert REGISTRY["graha.contacts_added"].dimensions == ("contact_type",)


def test_the_three_absences_are_declared_with_the_reason_naming_the_gap():
    reasons = {
        "graha.stage_conversion": ["stage-transition history", "niyam_events"],
        "graha.ticket_volume": ["048", "graha_tickets", "write"],
        "graha.ticket_resolution_time": ["048", "graha_tickets", "resolved_at"],
    }
    assert sorted(reasons) == ABSENT
    for key, needles in reasons.items():
        m = REGISTRY[key]
        assert m.sql is None and m.absent, key
        for needle in needles:
            assert needle in m.absent, f"{key}: reason no longer names {needle!r}"


# ── The universal contract, replicated until load_all() wires graha ─────────

@pytest.mark.parametrize("key", RUNNABLE)
def test_universal_contract_holds(key):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))
    assert isinstance(sql, str) and isinstance(params, list)
    # Schema-qualified, always — the live search_path does not include staging.
    assert re.search(r"\b(staging|public)\.", sql), f"{key}: unqualified table\n{sql}"
    # The org is $1 and it is CAST — PgBouncer turns an untyped parse error
    # into an instant 500 (the credits incident).
    assert "$1::uuid" in sql, f"{key}: org parameter not cast\n{sql}"
    assert params[0] == ORG
    placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert placeholders == set(range(1, len(params) + 1)), (
        f"{key}: SQL names {sorted(placeholders)} but {len(params)} params bound"
    )
    if m.grain == "flow":
        assert params[1] == WIN.start and params[2] == WIN.end
        assert "$2::date" in sql and "$3::date" in sql, f"{key}: window bounds uncast"


@pytest.mark.parametrize("key", FLOWS)
def test_flows_honour_every_bucket(key):
    for b in sorted(BUCKETS):
        sql, _ = build(key, bucket=b)
        assert f"date_trunc('{b}'" in sql, f"{key} ignored bucket={b}"
        assert "::date" in sql


@pytest.mark.parametrize("key", STOCKS)
def test_stocks_bind_only_the_org_and_never_a_window(key):
    sql, params = build(key)
    assert params == [ORG], f"{key}: a stock binds only the org"
    assert "$2" not in sql and "$3" not in sql


def test_dimensions_are_reachable():
    for key in RUNNABLE:
        m = REGISTRY[key]
        for dim in m.dimensions:
            sql, _ = build(key, group_by=dim)
            assert dim in sql, f"{key}: group_by={dim} accepted but absent from SQL"


# ── Stage strings never decide anything ─────────────────────────────────────

@pytest.mark.parametrize("key", RUNNABLE)
def test_no_query_hardcodes_a_stage_name(key):
    """Stages are per-org text (graha_pipelines.stages). The default
    vocabulary's words must not appear as literals in ANY graha query —
    won/lost is the won_at/lost_at timestamp pair, which is what the deal
    PATCH handler actually writes."""
    for group_by in (None,) + REGISTRY[key].dimensions:
        sql, _ = build(key, group_by=group_by)
        for stage in ("'New'", "'Qualified'", "'Proposal'", "'Negotiation'",
                      "'Won'", "'Lost'"):
            assert stage not in sql, f"{key}: stage literal {stage} in SQL\n{sql}"


# ── archived_at: flows count it, board stocks exclude it (migration 133) ────

@pytest.mark.parametrize("key", ["graha.win_rate", "graha.sales_cycle",
                                 "graha.avg_deal_size",
                                 "graha.client_concentration"])
def test_deal_flows_count_archived_wins(key):
    sql, _ = build(key)
    assert "archived_at" not in sql, (
        f"{key}: archived deals still count in every revenue figure "
        f"(migration 133's own comment)\n{sql}"
    )
    assert "d.is_active = TRUE" in sql, f"{key}: deleted deals must not count"


@pytest.mark.parametrize("key", STOCKS)
def test_board_stocks_exclude_archived_and_closed_deals(key):
    sql, _ = build(key)
    assert "d.archived_at IS NULL" in sql, f"{key}: archived deals are off the board"
    assert "d.won_at IS NULL AND d.lost_at IS NULL" in sql, (
        f"{key}: open means neither close timestamp is set\n{sql}"
    )
    assert "d.is_active = TRUE" in sql


# ── pipeline_by_stage ───────────────────────────────────────────────────────

def test_pipeline_groups_by_the_org_own_stage_text():
    sql, _ = build("graha.pipeline_by_stage")
    assert "SELECT d.stage AS label" in sql
    assert "GROUP BY d.stage" in sql
    assert "SUM(COALESCE(d.value, 0))::float AS value" in sql, (
        "money is COALESCEd before arithmetic — value is nullable"
    )
    assert "HAVING COUNT(*) > 0" in sql
    assert "FROM staging.graha_deals" in sql


# ── win_rate ────────────────────────────────────────────────────────────────

def test_win_rate_is_counts_over_counts_never_averaged_rates():
    sql, params = build("graha.win_rate")
    assert "/ NULLIF(COUNT(*), 0)::float * 100" in sql
    assert "AVG(" not in sql, "the mean of per-deal outcomes is not the period's rate"
    assert "AS won" in sql and "AS closed" in sql, "the ratio must be auditable"
    assert params == [ORG, WIN.start, WIN.end]


def test_win_rate_outcome_is_the_later_timestamp_ties_to_won():
    sql, _ = build("graha.win_rate")
    assert "(d.won_at IS NOT NULL AND (d.lost_at IS NULL OR d.won_at >= d.lost_at))" in sql


def test_win_rate_windows_on_the_close_date():
    sql, _ = build("graha.win_rate")
    assert "GREATEST(d.won_at, d.lost_at)::date BETWEEN $2::date AND $3::date" in sql
    # And buckets on the same clock, not created_at.
    assert "date_trunc('month', GREATEST(d.won_at, d.lost_at))::date" in sql


def test_win_rate_by_rep_joins_assigned_to_and_labels_names_never_ids():
    sql, _ = build("graha.win_rate", group_by="rep")
    assert "LEFT JOIN public.users u ON u.user_id = d.assigned_to" in sql
    assert "owner_id" not in sql, (
        "owner_id is an unwritten uuid — joining it 500'd the kanban (migration 092)"
    )
    assert "COALESCE(u.full_name, u.name, u.email, 'Unassigned') AS rep" in sql
    select_list = sql.split(" FROM ")[0]
    assert "user_id" not in select_list and "assigned_to" not in select_list, (
        f"raw id in output columns\n{select_list}"
    )


def test_win_rate_by_source_reads_the_contact_source():
    """Deals have no source column — the source is the contact's."""
    sql, _ = build("graha.win_rate", group_by="source")
    assert "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id" in sql
    assert "COALESCE(NULLIF(c.source, ''), 'No source') AS source" in sql
    assert "d.source" not in sql


def test_win_rate_size_bands_are_the_declared_edges_in_order():
    sql, _ = build("graha.win_rate", group_by="size_band")
    assert "AS size_band" in sql
    for edge in ("50000", "500000", "5000000"):
        assert edge in sql, f"band edge {edge} vanished"
    for label in ("'<50k'", "'50k-5L'", "'5L-50L'", "'50L+'"):
        assert label in sql
    assert "ORDER BY MIN(COALESCE(d.value, 0))" in sql, "bands must come out in order"


# ── sales_cycle ─────────────────────────────────────────────────────────────

def test_sales_cycle_is_a_median_in_fractional_days_not_a_mean():
    sql, _ = build("graha.sales_cycle")
    assert "percentile_cont(0.5) WITHIN GROUP" in sql
    assert "EXTRACT(EPOCH FROM (d.won_at - d.created_at)) / 86400.0" in sql
    assert not re.search(r"\bAVG\s*\(", sql), (
        "the existing dristi report AVGs this — the catalogue says median"
    )


def test_sales_cycle_windows_and_buckets_on_won_at():
    sql, params = build("graha.sales_cycle")
    assert "d.won_at IS NOT NULL" in sql
    assert "d.won_at::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── deal_aging ──────────────────────────────────────────────────────────────

def test_deal_aging_buckets_start_past_thirty_idle_days():
    sql, _ = build("graha.deal_aging")
    for label in ("'31-60'", "'61-90'", "'90+'"):
        assert label in sql
    assert "> 30" in sql, "deals idle 30 days or less are not aging"
    assert "ORDER BY CASE bucket WHEN '31-60' THEN 1 WHEN '61-90' THEN 2" in sql


def test_deal_aging_last_touch_is_activity_or_deal_edit():
    sql, _ = build("graha.deal_aging")
    assert "GREATEST(d.updated_at, la.last_at)::date" in sql
    assert "MAX(a.created_at) AS last_at" in sql
    assert "FROM staging.graha_activities a" in sql
    assert "LEFT JOIN LATERAL" in sql, (
        "a deal with no activities must age from its last edit, not vanish"
    )


def test_deal_aging_scopes_both_tables_to_the_org():
    sql, _ = build("graha.deal_aging")
    assert sql.count("$1::uuid") == 2, "deals AND activities must both be org-filtered"
    assert "a.deal_id = d.id" in sql


# ── lead_conversion ─────────────────────────────────────────────────────────

def test_lead_conversion_is_counts_over_counts_with_an_org_scoped_exists():
    sql, params = build("graha.lead_conversion")
    assert "/ NULLIF(COUNT(*), 0)::float * 100" in sql
    assert "AVG(" not in sql
    assert "EXISTS (SELECT 1 FROM staging.graha_deals d WHERE d.contact_id = c.id AND d.org_id = $1::uuid)" in sql
    assert "AS with_deal" in sql and "AS contacts" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_lead_conversion_cohort_excludes_vendors_and_partners():
    sql, _ = build("graha.lead_conversion")
    assert "c.contact_type NOT IN ('vendor', 'partner')" in sql
    assert "c.is_active = TRUE" in sql
    assert "c.created_at::date BETWEEN $2::date AND $3::date" in sql


def test_lead_conversion_score_bands_are_quartiles_in_order():
    sql, _ = build("graha.lead_conversion", group_by="lead_score")
    for label in ("'0-24'", "'25-49'", "'50-74'", "'75-100'"):
        assert label in sql
    assert "COALESCE(c.lead_score, 0)" in sql, "a NULL score is a zero score, not a crash"
    assert "AS lead_score" in sql
    assert sql.rstrip().endswith("ORDER BY 1"), "band labels sort in band order"


def test_lead_conversion_by_source_labels_the_blank_source_honestly():
    sql, _ = build("graha.lead_conversion", group_by="source")
    assert "COALESCE(NULLIF(c.source, ''), 'No source') AS source" in sql


# ── avg_deal_size ───────────────────────────────────────────────────────────

def test_avg_deal_size_is_sum_over_count_never_avg():
    sql, params = build("graha.avg_deal_size")
    assert "SUM(COALESCE(d.value, 0))::float / NULLIF(COUNT(*), 0)::float AS value" in sql
    assert "AVG(" not in sql
    assert "AS won_value" in sql and "AS deals" in sql, "the average must be auditable"
    assert "d.won_at::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── client_concentration ────────────────────────────────────────────────────

def test_concentration_is_top_five_share_of_summed_won_value():
    sql, _ = build("graha.client_concentration")
    assert "ORDER BY cv DESC LIMIT 5" in sql
    assert "/ NULLIF(SUM(v), 0)::float * 100" in sql, "a ratio of sums, never averaged"
    assert "SUM(COALESCE(d.value, 0))" in sql


def test_concentration_top_five_are_real_clients_but_all_value_is_the_base():
    sql, _ = build("graha.client_concentration")
    # Only linked clients can be ranked…
    assert "WHERE client_id IS NOT NULL" in sql
    # …but the denominator is EVERY won rupee: no filter on the outer sum.
    outer = sql.split(") top5)", 1)[1]
    assert "client_id IS NOT NULL" not in outer.split("HAVING")[0].replace(
        "COUNT(DISTINCT client_id)", ""
    )


def test_concentration_empty_window_returns_no_rows_not_a_null_shape():
    sql, _ = build("graha.client_concentration")
    assert "HAVING COUNT(*) > 0" in sql


def test_concentration_is_one_row_invariant_to_the_bucket():
    for b in sorted(BUCKETS):
        sql, _ = build("graha.client_concentration", bucket=b)
        assert sql.startswith("WITH bucketed AS ("), b
        assert sql.count("HAVING") == 1, b


def test_concentration_never_reads_ganit_tables():
    """Revenue here is won deal value: invoiced revenue belongs to ganit and
    its entitlement — a graha metric must not reach across the module line."""
    sql, _ = build("graha.client_concentration")
    assert "ganit" not in sql


# ── contacts_added ──────────────────────────────────────────────────────────

def test_contacts_added_counts_per_bucket_and_splits_by_type_on_request():
    plain, params = build("graha.contacts_added")
    assert "date_trunc('month', created_at)::date" in plain
    assert "contact_type" not in plain
    assert params == [ORG, WIN.start, WIN.end]
    grouped, _ = build("graha.contacts_added", group_by="contact_type")
    assert ", contact_type" in grouped
    assert "GROUP BY 1, 2" in grouped and grouped.rstrip().endswith("ORDER BY 1, 2")


def test_contacts_added_excludes_merged_and_deleted_contacts():
    sql, _ = build("graha.contacts_added")
    assert "is_active = TRUE" in sql, (
        "a merged duplicate (migration 024 soft-merge) is the same person twice"
    )
    assert "FROM staging.graha_contacts" in sql
