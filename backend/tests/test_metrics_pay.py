"""The payment-link metrics, held to what their docstring promises.

test_analytics_registry.py walks every declaration for the universal contract.
What lives HERE is the metric-SPECIFIC guarantees: the first-OPEN anchor
(nothing records a send — the token is minted at INSERT by migration 128's
column DEFAULT), "paid" meaning what bank reconciliation recorded and the
descriptions saying "reconciled" rather than "paid online" (there is no
gateway and never will be), the median via percentile_cont, the
reconciliation-lag anchors being the two dates the schema actually holds, and
balance_due never being read.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
from datetime import date

import analytics.metrics.pay  # noqa: F401 — registers on import; not yet in load_all()
from analytics.registry import REGISTRY, MetricRequest, load_all
from services.analytics_window import Window

load_all()

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

SQL_KEYS = (
    "ganit.pay_links_opened",
    "ganit.pay_link_conversion",
    "ganit.pay_time_to_payment",
    "ganit.pay_reconciliation_lag",
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
        "ganit.pay_links_opened": ("flow", "count", "operational"),
        "ganit.pay_link_conversion": ("flow", "pct", "financial"),
        "ganit.pay_time_to_payment": ("flow", "days", "financial"),
        "ganit.pay_reconciliation_lag": ("flow", "days", "operational"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key


def test_the_module_is_ganit_because_no_pay_module_code_exists():
    """Payment links are a Ganit capability; the registry gates catalogues on
    module codes and requires the key prefix to equal the module, so a "pay"
    module would gate every one of these out of every catalogue."""
    for key in SQL_KEYS + ("ganit.pay_links_sent",):
        m = REGISTRY[key]
        assert m.module == "ganit", key
        assert key.startswith("ganit.pay_"), key


def test_no_pay_metric_ever_reads_balance_due():
    # balance_due has drifted from the arithmetic on live rows (ganit.py's
    # header); nothing in this batch may read it either.
    for key in SQL_KEYS:
        sql, _ = build(key)
        assert "balance_due" not in sql, key


# ── links_opened ─────────────────────────────────────────────────────────────

def test_links_opened_anchors_on_the_first_scan_not_a_send():
    """Nothing records a send: pay_token is minted by column DEFAULT at INSERT
    (migration 128), so token existence is not a send and the first open is
    the earliest observable fact about a link."""
    sql, params = build("ganit.pay_links_opened")
    assert "MIN(s.created_at) AS first_open" in sql
    assert "FROM staging.ganit_pay_scans s" in sql
    assert "date_trunc('month', fo.first_open)::date" in sql
    assert "fo.first_open::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_links_opened_filters_both_tables_to_the_org():
    sql, _ = build("ganit.pay_links_opened")
    assert sql.count("$1::uuid") == 2, "scans AND invoices must both be org-filtered"
    assert "i.is_active = TRUE" in sql


def test_links_opened_paid_means_what_reconciliation_recorded():
    sql, _ = build("ganit.pay_links_opened")
    assert "COUNT(*) FILTER (WHERE i.payment_status = 'paid') AS reconciled_paid" in sql


# ── link_conversion ──────────────────────────────────────────────────────────

def test_conversion_is_counts_over_counts_with_the_counts_shown():
    sql, _ = build("ganit.pay_link_conversion")
    assert ("COUNT(*) FILTER (WHERE i.payment_status = 'paid')::float "
            "/ NULLIF(COUNT(*), 0)::float * 100") in sql
    assert "AS reconciled_paid" in sql and "AS opened" in sql
    assert "AVG(" not in sql, "the mean of per-link rates is not the period's rate"


def test_conversion_buckets_by_first_open_like_the_count_it_explains():
    sql, params = build("ganit.pay_link_conversion")
    assert "date_trunc('month', fo.first_open)::date" in sql
    assert "fo.first_open::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── time_to_payment ──────────────────────────────────────────────────────────

def test_time_to_payment_is_a_median_not_a_mean():
    sql, _ = build("ganit.pay_time_to_payment")
    assert "percentile_cont(0.5) WITHIN GROUP" in sql
    assert "(ORDER BY p.payment_date - fo.first_open::date)" in sql
    assert "AVG(" not in sql


def test_time_to_payment_windows_on_the_payment_and_scopes_both_tables():
    sql, params = build("ganit.pay_time_to_payment")
    assert "FROM staging.ganit_payments p" in sql
    assert sql.count("$1::uuid") == 2, "payments AND scans must both be org-filtered"
    assert "p.payment_date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_time_to_payment_excludes_payments_that_predate_the_open():
    # A link cannot claim money that arrived before it was seen — and without
    # this clause the median would shrink on negative day-counts.
    sql, _ = build("ganit.pay_time_to_payment")
    assert "p.payment_date >= fo.first_open::date" in sql


# ── reconciliation_lag ───────────────────────────────────────────────────────

def test_reconciliation_lag_is_a_median_over_the_two_recorded_dates():
    """ganit_bank_statement_lines has no reconciled_at (039: is_reconciled is
    a bare boolean), so the lag is the gap between the two dates the schema
    actually holds: the bank's statement_date and the matched payment row's
    created_at. payment_date would read ~0 by construction — the clerk
    backdates it to the bank's own date."""
    sql, _ = build("ganit.pay_reconciliation_lag")
    assert "percentile_cont(0.5) WITHIN GROUP" in sql
    assert "(ORDER BY p.created_at::date - l.statement_date)" in sql
    assert "AVG(" not in sql
    assert "reconciled_at" not in sql, "no such column exists to read"


def test_reconciliation_lag_joins_only_reconciled_invoice_payment_lines():
    sql, params = build("ganit.pay_reconciliation_lag")
    assert "FROM staging.ganit_bank_statement_lines l" in sql
    assert "p.id = l.matched_payment_id" in sql
    assert "l.is_reconciled" in sql
    assert "l.matched_type = 'invoice_payment'" in sql
    assert sql.count("$1::uuid") == 2, "lines AND payments must both be org-filtered"
    assert "l.statement_date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── the reconciliation wording, pinned ───────────────────────────────────────

def test_every_description_says_reconciled_and_never_paid_online():
    """There is no payment gateway and never will be: "paid" only ever comes
    from bank reconciliation, and the catalogue a buyer reads must say so."""
    for key in ("ganit.pay_links_opened", "ganit.pay_link_conversion",
                "ganit.pay_time_to_payment", "ganit.pay_reconciliation_lag"):
        d = REGISTRY[key].description.lower()
        assert "reconcil" in d, f"{key}: description must say reconciled"
        assert "paid online" not in d, key
        assert "instant" not in d, key


def test_time_to_payment_description_states_its_anchors():
    d = REGISTRY["ganit.pay_time_to_payment"].description.lower()
    assert "median" in d
    assert "first open" in d, "the anchor must be stated — nothing records a send"


# ── the declared absence ─────────────────────────────────────────────────────

def test_links_sent_is_a_stated_absence_naming_the_missing_column():
    """Proposal 62 §10: an uncomputable number ships as a stated absence,
    never as a convincing zero — and the reason names the columns so the
    absence is actionable."""
    m = REGISTRY["ganit.pay_links_sent"]
    assert m.sql is None
    assert m.absent and len(m.absent) > 60
    assert "pay_token" in m.absent
    assert "sent_at" in m.absent
    assert "DEFAULT" in m.absent, "the reason is the token being minted at INSERT"
