"""Ganit (accounting) metrics — proposal 62 §4, verified against the live
catalogue 2026-08-17 (scout-ganit.md, re-probed by verify-db.md; every column
named here was measured, not assumed).

The guards every query in this file carries, and why:

· `is_active = TRUE` — soft delete; the pivot builder applies the same filter.
· `doc_status <> 'draft'` — NEVER `= 'final'`: the live values are
  final 524 / viewed 154 / draft 102 / sent 1, so an equality test silently
  drops 155 real invoices. The same trap already bit invoice editability once.
· Credit notes (`invoice_type = 'credit_note'`, 22 rows) are stored with
  POSITIVE totals and must be SUBTRACTED — summing them adds ₹123,900 of
  reversals to revenue.
· Outstanding is `total - COALESCE(amount_paid, 0)`, never `balance_due` —
  that column has drifted from the arithmetic on 2 live rows.
· Ageing anchors on `COALESCE(due_date, invoice_date)` — due_date is NULL on
  159 rows, and dropping them from ageing would hide a fifth of the book.
· Every parameter is cast (`$1::uuid`, `$2::date`) — PgBouncer turns an
  untyped parse error into an instant 500 (the credits incident).
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr


@metric(
    key="ganit.invoiced",
    module="ganit",
    label="Invoiced",
    unit="inr",
    grain="flow",
    dimensions=("invoice_type",),
    sensitivity="financial",
    drill="ganit.invoices",
    description="Net value invoiced during the period — credit notes subtract.",
)
def invoiced(req: MetricRequest):
    period = bucket_expr(req.bucket, "invoice_date")
    group = ", invoice_type" if req.group_by == "invoice_type" else ""
    return (
        f"SELECT {period} AS period{group}, "
        "SUM(CASE WHEN invoice_type = 'credit_note' THEN -total ELSE total END)::float AS value "
        "FROM staging.ganit_invoices "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "AND invoice_date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{group and ', 2'} ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.collected",
    module="ganit",
    label="Collected",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    drill="ganit.payments",
    description="Payments received during the period, by payment date.",
)
def collected(req: MetricRequest):
    period = bucket_expr(req.bucket, "payment_date")
    return (
        f"SELECT {period} AS period, SUM(amount)::float AS value "
        "FROM staging.ganit_payments "
        "WHERE org_id = $1::uuid "
        "AND payment_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.receivables_ageing",
    module="ganit",
    label="Receivables ageing",
    unit="inr",
    grain="stock",
    sensitivity="financial",
    drill="ganit.invoices",
    description="Outstanding value in 0-30 / 31-60 / 61-90 / 90+ day buckets, "
                "aged from due date (invoice date when no due date is set).",
)
def receivables_ageing(req: MetricRequest):
    return (
        "SELECT bucket, SUM(outstanding)::float AS value, COUNT(*) AS invoices FROM ("
        "  SELECT total - COALESCE(amount_paid, 0) AS outstanding, "
        "    CASE "
        "      WHEN CURRENT_DATE - COALESCE(due_date, invoice_date) <= 30 THEN '0-30' "
        "      WHEN CURRENT_DATE - COALESCE(due_date, invoice_date) <= 60 THEN '31-60' "
        "      WHEN CURRENT_DATE - COALESCE(due_date, invoice_date) <= 90 THEN '61-90' "
        "      ELSE '90+' END AS bucket "
        "  FROM staging.ganit_invoices "
        "  WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "  AND invoice_type <> 'credit_note' "
        "  AND total - COALESCE(amount_paid, 0) > 0"
        ") aged GROUP BY bucket "
        "ORDER BY CASE bucket WHEN '0-30' THEN 1 WHEN '31-60' THEN 2 "
        "WHEN '61-90' THEN 3 ELSE 4 END",
        [req.org_id],
    )


# ── Declared absent — the schema cannot answer these honestly ────────────────
# Proposal 62 §10: a stated absence, never a convincing zero. Each reason was
# verified against the live catalogue on 2026-08-17.

absent_metric(
    key="ganit.tds_by_section",
    module="ganit",
    label="TDS deducted by section",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    absent="staging.ganit_tds_challans holds 0 rows and has no section column; "
           "sections would sit in its `deductions` jsonb, whose shape has never "
           "been exercised. The only populated TDS columns in the database "
           "belong to payroll (vetana_payslips), which is a different domain.",
)
