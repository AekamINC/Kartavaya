"""The batch-2 ganit metrics, held to the guards their docstring promises.

test_analytics_registry.py already walks every declaration for the universal
contract (schema-qualified tables, $1::uuid, placeholder parity, window
binding, bucket honouring, dimension reachability). What lives HERE is the
metric-SPECIFIC guarantees — the ones a refactor could drop while every
universal check stays green: credit notes subtracting, drafts excluded,
medians via percentile_cont rather than AVG, the tax_type CASE, outstanding
computed from total - amount_paid rather than the drifted balance_due column,
and 'Unlinked client' where a NULL client_id would otherwise leak a UUID.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
from datetime import date

from analytics.registry import REGISTRY, MetricRequest, load_all
from services.analytics_window import Window

load_all()

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"


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
        "ganit.dso": ("flow", "days", "financial"),
        "ganit.collection_rate": ("flow", "pct", "financial"),
        "ganit.payment_lag": ("flow", "days", "financial"),
        "ganit.gst_output": ("flow", "inr", "financial"),
        "ganit.expense_by_category": ("flow", "inr", "financial"),
        "ganit.reconciliation_rate": ("flow", "pct", "operational"),
        "ganit.top_debtors": ("stock", "inr", "financial"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["ganit.gst_output"].dimensions == ("tax_type",)
    assert REGISTRY["ganit.expense_by_category"].dimensions == ("category",)


# ── dso ──────────────────────────────────────────────────────────────────────

def test_dso_is_the_classic_formula_and_the_clock_stops_at_payment():
    """Review finding, 2026-08-17: the first formula weighted every invoice by
    (CURRENT_DATE - invoice_date), so a fully-paid invoice kept aging forever
    — 177 "days" against 94 real on the E2E org, worsening daily for a fixed
    historical window. Classic DSO is what is STILL outstanding over what was
    invoiced, times the period's days — these assertions pin each piece."""
    sql, params = build("ganit.dso")
    assert sql.startswith("SELECT (SUM(o)::float / NULLIF(SUM(t), 0)::float) ")
    # The numerator is the arithmetic outstanding — the paid part is gone.
    assert "SUM(total - COALESCE(amount_paid, 0)) AS o" in sql
    # Scaled by the window's own length, from its bound parameters.
    assert "($3::date - $2::date + 1)" in sql
    # The defective weighting must never return.
    assert "CURRENT_DATE - invoice_date" not in sql
    assert "AVG(" not in sql, "DSO must be a ratio of sums, never an averaged rate"
    assert params == [ORG, WIN.start, WIN.end]


def test_dso_empty_window_returns_no_rows_not_a_null_shape():
    """The HAVING clause the first version sold in prose with no test — a
    refactor dropping it would ship {value: null} for an empty window and a
    row shape to orgs that are not yours (review mutation 5 survived)."""
    sql, _ = build("ganit.dso")
    assert "HAVING SUM(t) IS NOT NULL" in sql


def test_dso_excludes_drafts_and_credit_notes():
    sql, _ = build("ganit.dso")
    assert "doc_status <> 'draft'" in sql
    assert "invoice_type <> 'credit_note'" in sql
    assert "is_active = TRUE" in sql


def test_dso_is_the_same_single_row_under_every_bucket():
    # A ratio of sums is invariant to the cut: the builder may interpolate
    # the bucket (the registry walk demands it), but the shape must stay one
    # outer aggregate row.
    for b in ("day", "week", "month", "quarter", "year"):
        sql, _ = build("ganit.dso", bucket=b)
        assert sql.startswith("SELECT (SUM(o)::float / NULLIF(SUM(t), 0)::float) "), b


# ── collection_rate ──────────────────────────────────────────────────────────

def test_collection_rate_is_sums_over_sums():
    sql, _ = build("ganit.collection_rate")
    assert "SUM(COALESCE(amount_paid, 0))::float / NULLIF(SUM(total), 0)::float * 100" in sql
    assert "AVG(" not in sql, "the mean of per-invoice rates is not the period's rate"


def test_collection_rate_excludes_drafts_and_credit_notes():
    sql, _ = build("ganit.collection_rate")
    assert "doc_status <> 'draft'" in sql
    assert "invoice_type <> 'credit_note'" in sql
    assert "is_active = TRUE" in sql


# ── payment_lag ──────────────────────────────────────────────────────────────

def test_payment_lag_is_a_median_not_a_mean():
    sql, _ = build("ganit.payment_lag")
    assert "percentile_cont(0.5) WITHIN GROUP" in sql
    assert "(ORDER BY p.payment_date - i.invoice_date)" in sql
    assert "AVG(" not in sql


def test_payment_lag_filters_both_tables_to_the_org_and_windows_on_payment_date():
    sql, params = build("ganit.payment_lag")
    assert sql.count("$1::uuid") == 2, "payments AND invoices must both be org-filtered"
    assert "p.payment_date BETWEEN $2::date AND $3::date" in sql
    assert "i.doc_status <> 'draft'" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── gst_output ───────────────────────────────────────────────────────────────

def test_gst_output_sums_the_four_components_not_a_tax_amount_column():
    sql, _ = build("ganit.gst_output")
    assert "COALESCE(cgst,0) + COALESCE(sgst,0) + COALESCE(igst,0) + COALESCE(cess,0)" in sql
    assert "tax_amount" not in sql, "ganit_invoices has no tax_amount column"


def test_gst_output_subtracts_credit_notes():
    sql, _ = build("ganit.gst_output")
    assert "WHEN invoice_type = 'credit_note' THEN -(" in sql
    assert "doc_status <> 'draft'" in sql


def test_gst_output_tax_type_split_is_the_igst_case():
    sql, _ = build("ganit.gst_output", group_by="tax_type")
    assert "CASE WHEN is_igst THEN 'IGST' ELSE 'CGST+SGST' END AS tax_type" in sql
    assert "GROUP BY 1, 2" in sql
    # And the split appears ONLY when asked for.
    plain, _ = build("ganit.gst_output")
    assert "tax_type" not in plain


# ── expense_by_category ──────────────────────────────────────────────────────

def test_expenses_default_is_per_bucket_and_grouped_is_per_category():
    plain, _ = build("ganit.expense_by_category")
    assert "date_trunc('month', expense_date)::date" in plain
    assert "GROUP BY category" not in plain
    grouped, _ = build("ganit.expense_by_category", group_by="category")
    assert "GROUP BY category" in grouped


def test_expenses_never_join_the_categories_table():
    # category is free text with no FK — a join would silently drop every
    # expense whose value has no ganit_expense_categories row.
    for kw in ({}, {"group_by": "category"}):
        sql, _ = build("ganit.expense_by_category", **kw)
        assert "ganit_expense_categories" not in sql
        assert "FROM public.ganit_expenses" in sql
        assert "is_active = TRUE" in sql


# ── reconciliation_rate ──────────────────────────────────────────────────────

def test_reconciliation_rate_is_counts_over_counts_with_the_counts_shown():
    sql, _ = build("ganit.reconciliation_rate")
    assert "COUNT(*) FILTER (WHERE is_reconciled)::float / NULLIF(COUNT(*), 0)::float * 100" in sql
    assert "AS matched" in sql and "AS total" in sql
    assert "FROM public.ganit_bank_statement_lines" in sql
    assert "statement_date BETWEEN $2::date AND $3::date" in sql


# ── top_debtors ──────────────────────────────────────────────────────────────

def test_top_debtors_is_a_stock_binding_only_the_org():
    _, params = build("ganit.top_debtors")
    assert params == [ORG]


def test_top_debtors_labels_a_null_client_honestly_and_never_selects_an_id():
    sql, _ = build("ganit.top_debtors")
    assert "COALESCE(c.name, 'Unlinked client') AS label" in sql
    assert "LEFT JOIN public.graha_clients c ON c.id = i.client_id" in sql
    # names-not-ids: no id may reach the select list — c.id and i.id belong
    # to the JOIN and GROUP BY only.
    select_list = sql.split(" FROM ")[0]
    assert "c.id" not in select_list and "i.id" not in select_list


def test_top_debtors_outstanding_comes_from_the_arithmetic_never_balance_due():
    sql, _ = build("ganit.top_debtors")
    assert "i.total - COALESCE(i.amount_paid, 0)" in sql
    assert "balance_due" not in sql, "balance_due has drifted from the arithmetic on live rows"
    assert "i.total - COALESCE(i.amount_paid, 0) > 0" in sql


def test_top_debtors_ages_from_due_date_with_invoice_date_fallback():
    sql, _ = build("ganit.top_debtors")
    assert "MIN(COALESCE(i.due_date, i.invoice_date)) AS oldest_due" in sql
    assert "doc_status <> 'draft'" in sql
    assert "invoice_type <> 'credit_note'" in sql
    assert "LIMIT 15" in sql


def test_outstanding_is_the_ageing_total_with_the_same_guards():
    """The KPI the frontend asks for beside DSO — added at integration after
    the frontend review found it missing from the catalogue entirely."""
    m = REGISTRY["ganit.outstanding"]
    assert m.grain == "stock" and m.unit == "inr"
    sql, params = m.sql(MetricRequest(org_id=ORG, window=None, bucket="month"))
    assert "SUM(total - COALESCE(amount_paid, 0))" in sql
    assert "balance_due" not in sql
    assert "invoice_type <> 'credit_note'" in sql
    assert "doc_status <> 'draft'" in sql
    assert "total - COALESCE(amount_paid, 0) > 0" in sql
    # No qualifying invoices → no rows, never a {value: null} row-shape for
    # an org that is not yours (caught by the ghost-org probe at integration).
    assert "HAVING COUNT(*) > 0" in sql
    assert params == [ORG]


def test_payment_lag_ignores_credit_note_invoices_on_the_join():
    sql, _ = build("ganit.payment_lag")
    assert "i.invoice_type <> 'credit_note'" in sql


def test_gst_output_grouped_order_is_deterministic():
    sql, _ = build("ganit.gst_output", group_by="tax_type")
    assert sql.rstrip().endswith("ORDER BY 1, 2")
