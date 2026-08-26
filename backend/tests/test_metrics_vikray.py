"""The vikray metrics, held to the guards their docstring promises.

One wiring fact shapes this file: `analytics.registry.load_all()` does not yet
import `analytics.metrics.vikray`, so the universal walk in
test_analytics_registry.py cannot see these declarations. Its rules
(schema-qualified tables, $1::uuid, placeholder parity, window binding, bucket
honouring) are therefore MIRRORED here over the vikray set, so the wiring
commit changes nothing but the import line.

What else lives here is the metric-SPECIFIC guarantees a refactor could drop
while every universal check stays green: the attainment join staying on
`assigned_to` (never the dead owner_id, never data-entry credit), close dates
via COALESCE(won_at, updated_at), each target measured over its OWN period,
the lag being a median over live invoices with the uninvoiced leak counted
beside it, repeat rate from grouped counts with unattributable orders out of
both sides, shares computed against the whole window's revenue, and
'Uncatalogued lines' / 'Unattributed orders' / 'Unknown salesperson' where a
NULL would otherwise leak an id or vanish a row.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

import pytest

import analytics.metrics.vikray  # noqa: F401 — registers the declarations
from analytics.registry import REGISTRY, MetricRequest
from analytics.windowing import BUCKETS
from services.analytics_window import Window

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

VIKRAY_SQL = sorted(
    k for k, m in REGISTRY.items() if m.module == "vikray" and m.sql is not None
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
        "vikray.orders": ("flow", "inr", "financial"),
        "vikray.aov": ("flow", "inr", "financial"),
        "vikray.product_mix": ("flow", "inr", "financial"),
        "vikray.repeat_rate": ("flow", "pct", "operational"),
        "vikray.target_attainment": ("flow", "pct", "financial"),
        "vikray.order_to_invoice_lag": ("flow", "days", "financial"),
        "vikray.customer_concentration": ("flow", "inr", "financial"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["vikray.orders"].dimensions == ("status",)
    assert VIKRAY_SQL == sorted(expect)


# ── The universal rules, mirrored until load_all() carries this module ───────

@pytest.mark.parametrize("key", VIKRAY_SQL)
def test_universal_rules_hold_before_the_wiring(key):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))

    assert isinstance(sql, str) and isinstance(params, list)
    # Schema-qualified, always — the live search_path does not include
    # staging (the shadow-table incident, migration 142).
    assert re.search(r"\b(staging|public)\.", sql), f"{key}: unqualified table"
    # $1 is the org and it is CAST — PgBouncer turns an untyped parse error
    # into an instant 500 (the credits incident).
    assert "$1::uuid" in sql and params[0] == ORG
    placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert placeholders == set(range(1, len(params) + 1)), key
    if m.grain == "flow":
        assert params[1] == WIN.start and params[2] == WIN.end


@pytest.mark.parametrize("key", VIKRAY_SQL)
def test_every_bucket_is_honoured(key):
    m = REGISTRY[key]
    if m.grain != "flow":
        pytest.skip("stocks take no bucket")
    for b in sorted(BUCKETS):
        sql, _ = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket=b))
        assert f"date_trunc('{b}'" in sql, f"{key} ignored bucket={b}"
        assert "::date" in sql


# ── orders ───────────────────────────────────────────────────────────────────

def test_orders_windows_on_order_date_and_coalesces_the_money():
    sql, params = build("vikray.orders")
    assert "FROM staging.vikray_orders" in sql
    assert "SUM(COALESCE(total, 0))::float AS value" in sql
    assert "COUNT(*) AS orders" in sql
    assert "order_date BETWEEN $2::date AND $3::date" in sql
    # Cancelled orders are soft-deleted (status AND is_active flip together),
    # so this one filter removes them; drafts stay, deliberately — the status
    # split must always sum to the headline.
    assert "is_active = TRUE" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_orders_status_split_appears_only_when_asked():
    plain, _ = build("vikray.orders")
    assert "status" not in plain
    grouped, _ = build("vikray.orders", group_by="status")
    assert "period, status" in grouped
    assert "GROUP BY 1, 2" in grouped
    assert grouped.rstrip().endswith("ORDER BY 1, 2")


# ── aov ──────────────────────────────────────────────────────────────────────

def test_aov_is_a_ratio_of_the_buckets_sums_never_avg():
    sql, params = build("vikray.aov")
    assert "SUM(COALESCE(total, 0))::float / NULLIF(COUNT(*), 0)::float AS value" in sql
    assert "AVG(" not in sql, "AOV is the bucket's sums divided, never AVG(total)"
    # Both operands ride along so the ratio is auditable.
    assert "AS order_value" in sql and "AS orders" in sql
    assert "status <> 'draft'" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── product_mix ──────────────────────────────────────────────────────────────

def test_product_mix_prices_a_line_like_the_order_totals_helper():
    sql, _ = build("vikray.product_mix")
    assert (
        "COALESCE((li->>'quantity')::numeric, 0) "
        "* COALESCE((li->>'rate')::numeric, 0) "
        "* (1 - COALESCE((li->>'discount_pct')::numeric, 0) / 100)"
    ) in sql
    assert "jsonb_array_elements(o.line_items)" in sql


def test_product_mix_share_is_sums_over_the_window_total():
    sql, _ = build("vikray.product_mix")
    assert "(SUM(v) / NULLIF(SUM(SUM(v)) OVER (), 0) * 100)::float AS share_pct" in sql
    assert "AVG(" not in sql


def test_product_mix_joins_products_as_text_and_folds_uncatalogued():
    sql, _ = build("vikray.product_mix")
    # Text = text: casting the jsonb value to uuid would let one malformed
    # line 500 the whole metric.
    assert "ON p.id::text = li->>'product_id' AND p.org_id = o.org_id" in sql
    assert "COALESCE(p.name, 'Uncatalogued lines') AS label" in sql
    assert "GROUP BY 1, p.id, p.name" in sql
    assert "o.status <> 'draft'" in sql and "o.is_active = TRUE" in sql
    # names-not-ids: no id may reach the outer select list — p.id and o.id
    # belong to the inner grouping only.
    select_list = sql.split(" FROM ")[0]
    assert "p.id" not in select_list and "o.id" not in select_list


# ── repeat_rate ──────────────────────────────────────────────────────────────

def test_repeat_rate_is_grouped_counts_never_an_average():
    sql, _ = build("vikray.repeat_rate")
    assert "(COUNT(*) FILTER (WHERE n > 1))::float / NULLIF(COUNT(*), 0)::float * 100" in sql
    assert "GROUP BY client_id" in sql, "per-customer counts are the operands"
    assert "AVG(" not in sql
    assert "AS repeat_customers" in sql and "AS customers" in sql


def test_repeat_rate_excludes_orders_that_name_no_customer():
    # A customer is a COMPANY (client_id, migration 136). An order with no
    # company can prove neither a first purchase nor a repeat — it leaves
    # both the numerator and the denominator.
    sql, _ = build("vikray.repeat_rate")
    assert "client_id IS NOT NULL" in sql
    assert "status <> 'draft'" in sql


def test_repeat_rate_ghost_org_gets_no_row():
    sql, _ = build("vikray.repeat_rate")
    assert "HAVING COUNT(*) > 0" in sql


# ── target_attainment ────────────────────────────────────────────────────────

def test_attainment_counts_won_deals_by_assignee_never_owner_or_clerk():
    """The router's measured definition: owner_id is a column nothing writes
    (649 deals, 0 non-null) and created_by is data-entry credit (one user
    keyed all 658 invoices in a live org). Attainment is deals by their
    ASSIGNEE, which is also what the Targets tab promises in prose."""
    sql, _ = build("vikray.target_attainment")
    assert "d.assigned_to = t.salesperson_id" in sql
    assert "owner_id" not in sql
    assert "created_by" not in sql
    assert "d.stage = 'Won'" in sql
    assert "d.is_active = TRUE" in sql


def test_attainment_dates_a_deal_by_close_date_with_fallback():
    """won_at, not updated_at: a fixed typo must not relocate a rep's revenue
    into a different quarter (measured live: 1653%% attainment under
    updated_at). The COALESCE fallback keeps a deal with no recorded close
    date in SOMEONE's period rather than vanishing its money."""
    sql, _ = build("vikray.target_attainment")
    assert "COALESCE(d.won_at, d.updated_at) >= t.period_start" in sql
    assert "COALESCE(d.won_at, d.updated_at) < t.period_end + 1" in sql


def test_attainment_window_selects_targets_but_each_measures_its_own_period():
    sql, params = build("vikray.target_attainment")
    # The $2..$3 window picks WHICH targets (period overlap)…
    assert "t.period_end >= $2::date AND t.period_start <= $3::date" in sql
    # …and never bounds the deals: those are bounded by the target's own
    # stored period, the contract the row states.
    assert "BETWEEN $2" not in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_attainment_salesperson_join_is_text_to_text_with_no_cast():
    # salesperson_id is TEXT since migration 092; a cast on this join is the
    # fingerprint of the dead uuid column coming back.
    sql, _ = build("vikray.target_attainment")
    assert "u.user_id = t.salesperson_id" in sql
    assert "salesperson_id::" not in sql
    assert "FROM staging.vikray_targets t" in sql
    assert "public.users" in sql


def test_attainment_ratio_is_per_target_sums_and_labels_are_names():
    sql, _ = build("vikray.target_attainment")
    assert "(COALESCE(won.amount, 0) / NULLIF(t.target_amount, 0) * 100)::float AS value" in sql
    assert "AVG(" not in sql
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
    assert "'Unknown salesperson') AS label" in sql
    assert "u.email" not in sql
    # names-not-ids: neither the salesperson id nor the target id may reach
    # the select list.
    select_list = sql.split(" FROM ")[0]
    assert "salesperson_id" not in select_list and "t.id" not in select_list


# ── order_to_invoice_lag ─────────────────────────────────────────────────────

def test_lag_is_a_median_not_a_mean():
    sql, _ = build("vikray.order_to_invoice_lag")
    assert "percentile_cont(0.5) WITHIN GROUP (ORDER BY i.invoice_date - o.order_date)" in sql
    assert "AVG(" not in sql


def test_lag_windows_on_order_date_and_counts_the_leak_beside_the_median():
    """Windowed on ORDER date, deliberately: an invoice-dated window could
    never count the orders that got NO invoice, and those are the leak the
    catalogue names."""
    sql, params = build("vikray.order_to_invoice_lag")
    assert "o.order_date BETWEEN $2::date AND $3::date" in sql
    assert "FILTER (WHERE i.invoice_date IS NOT NULL) AS invoiced_orders" in sql
    assert "FILTER (WHERE i.invoice_date IS NULL) AS uninvoiced_orders" in sql
    assert "(SUM(COALESCE(o.total, 0)) FILTER (WHERE i.invoice_date IS NULL))::float AS uninvoiced_value" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_lag_join_is_org_scoped_and_live_only():
    # i.is_active on the JOIN: an order whose invoice was later deleted has
    # leaked AGAIN and must count as uninvoiced, not as handled.
    sql, _ = build("vikray.order_to_invoice_lag")
    assert "ON i.id = o.invoice_id AND i.org_id = o.org_id AND i.is_active = TRUE" in sql
    assert "o.status <> 'draft'" in sql and "o.is_active = TRUE" in sql


# ── customer_concentration ───────────────────────────────────────────────────

def test_concentration_denominator_is_every_order_not_the_top_15():
    sql, params = build("vikray.customer_concentration")
    # The share's window function runs before ORDER BY/LIMIT, so a top-15
    # row's share is against the WHOLE window's revenue.
    assert "(SUM(v) / NULLIF(SUM(SUM(v)) OVER (), 0) * 100)::float AS share_pct" in sql
    assert "LIMIT 15" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_concentration_folds_unattributed_and_groups_by_company_identity():
    sql, _ = build("vikray.customer_concentration")
    assert "COALESCE(cl.name, 'Unattributed orders') AS label" in sql
    # By cl.id, so two companies sharing a name stay two rows and every NULL
    # client_id folds into the one honest bucket.
    assert "GROUP BY 1, cl.id, cl.name" in sql
    assert "ON cl.id = o.client_id AND cl.org_id = o.org_id" in sql
    select_list = sql.split(" FROM ")[0]
    assert "cl.id" not in select_list and "client_id" not in select_list


# ── declared absent ──────────────────────────────────────────────────────────

def test_margin_is_absent_for_coverage_not_for_a_missing_write_path():
    """The blocker has moved TWICE and the reason has to move with it.

    Migration 137 added `ganit_products.cost_price`, so "no cost column" stopped
    being true. Phase 1.3 (2026-08-25) added the snapshot — every order and
    invoice line written from now on carries `cost_price` per unit, copied at
    write time — so "line_items snapshots no cost" stopped being true too, and
    a reason still claiming it would send the next reader to build something
    that already exists.

    What is left is COVERAGE: 2 of 106 products carry a cost and every existing
    line predates the key. So the reason must name the data, not the plumbing,
    and must not go back to claiming nothing writes it."""
    m = REGISTRY["vikray.order_margin"]
    assert m.sql is None and m.absent
    assert "cost_price" in m.absent
    assert "migration 184" in m.absent, "the snapshot contract must be named"
    assert "2 of 106" in m.absent, "the reason must carry the measured coverage"
    # The old claim, now false. A reason that says the line snapshots no cost
    # is a reason that outlived its own fix.
    assert "snapshots no cost" not in m.absent
    assert len(m.absent) > 60, "a reason must be a sentence someone can act on"
