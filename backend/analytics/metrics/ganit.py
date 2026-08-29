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

Facts the second batch stands on (same live catalogue, 2026-08-17):

· There is NO `tax_amount` column on ganit_invoices — output GST is
  `cgst + sgst + igst + cess`, each COALESCEd to 0: the insert paths differ
  in which components they write (`cess` in particular), and one NULL
  component nulls the whole row's sum.
· `ganit_expenses.category` is free text with NO foreign key — 14 live
  values including 'general'. Never join ganit_expense_categories; it does
  not constrain the column.
· `ganit_invoices.client_id` is NULL on 234 of 781 rows. A debtor with no
  linked client is labelled 'Unlinked client' — a UUID never reaches a
  response label (decision_names_not_ids).
· Ratios come from SUMS within each bucket, never an average of per-row
  rates; medians come from `percentile_cont(0.5)`, never AVG.
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
        "FROM public.ganit_invoices "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "AND invoice_date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{group and ', 2'} ORDER BY 1{group and ', 2'}",
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
        "FROM public.ganit_payments "
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
        "  FROM public.ganit_invoices "
        "  WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "  AND invoice_type <> 'credit_note' "
        "  AND total - COALESCE(amount_paid, 0) > 0"
        ") aged GROUP BY bucket "
        "ORDER BY CASE bucket WHEN '0-30' THEN 1 WHEN '31-60' THEN 2 "
        "WHEN '61-90' THEN 3 ELSE 4 END",
        [req.org_id],
    )


@metric(
    key="ganit.dso",
    module="ganit",
    label="Days sales outstanding",
    unit="days",
    grain="flow",
    sensitivity="financial",
    drill="ganit.invoices",
    description="Classic DSO: what is STILL outstanding from the period's "
                "invoices, over the period's invoiced value, times the days "
                "in the period. An invoice that has been paid stops counting "
                "the day it is paid off — a formula that keeps aging settled "
                "invoices reads three times worse and worsens by a day every "
                "day the report is reopened.",
)
def dso(req: MetricRequest):
    # One row, always. The inner query is bucketed to honour the registry's
    # one-walk contract (every flow interpolates the validated bucket); the
    # outer ratio sums the per-bucket sums, so the answer is the same single
    # number whichever bucket the caller sends — a ratio of SUMS is invariant
    # to how the window is cut.
    #
    # REVIEWED AND CORRECTED 2026-08-17: the first version weighted every
    # invoice by (CURRENT_DATE - invoice_date) — fully-paid invoices kept
    # aging forever. Measured on the E2E org (window 2025-08-01..2026-08-17):
    # 177.3 "days" against 93.8 by this formula, and the old number grew by
    # ~1 day per day for a fixed historical window with no data changes.
    period = bucket_expr(req.bucket, "invoice_date")
    return (
        "SELECT (SUM(o)::float / NULLIF(SUM(t), 0)::float) "
        "* ($3::date - $2::date + 1) AS value FROM ("
        f"  SELECT {period} AS period, "
        "    SUM(total - COALESCE(amount_paid, 0)) AS o, "
        "    SUM(total) AS t "
        "  FROM public.ganit_invoices "
        "  WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "  AND invoice_type <> 'credit_note' "
        "  AND invoice_date BETWEEN $2::date AND $3::date "
        "  GROUP BY 1"
        ") b "
        # No invoices in the window → no rows, like every other flow — never
        # a convincing {value: null} row (and an org that isn't yours returns
        # nothing, not a shape). Pinned by test now; the first version sold
        # this clause in prose and no test held it.
        "HAVING SUM(t) IS NOT NULL",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.collection_rate",
    module="ganit",
    label="Collection rate",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    drill="ganit.invoices",
    description="Of the value invoiced in each bucket, the share already "
                "collected — SUM(paid)/SUM(total) per bucket, never an "
                "average of per-invoice rates. Credit notes excluded.",
)
def collection_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "invoice_date")
    return (
        f"SELECT {period} AS period, "
        "SUM(COALESCE(amount_paid, 0))::float / NULLIF(SUM(total), 0)::float * 100 AS value, "
        "SUM(total)::float AS invoiced, "
        "SUM(COALESCE(amount_paid, 0))::float AS collected "
        "FROM public.ganit_invoices "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "AND invoice_type <> 'credit_note' "
        "AND invoice_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.payment_lag",
    module="ganit",
    label="Payment lag",
    unit="days",
    grain="flow",
    sensitivity="financial",
    drill="ganit.payments",
    description="Median days from invoice date to payment date, for payments "
                "received in each bucket. Median (percentile_cont), not mean "
                "— one 200-day straggler must not move the headline.",
)
def payment_lag(req: MetricRequest):
    period = bucket_expr(req.bucket, "p.payment_date")
    return (
        f"SELECT {period} AS period, "
        "percentile_cont(0.5) WITHIN GROUP "
        "(ORDER BY p.payment_date - i.invoice_date)::float AS value, "
        "COUNT(*) AS payments "
        "FROM public.ganit_payments p "
        "JOIN public.ganit_invoices i ON i.id = p.invoice_id "
        "WHERE p.org_id = $1::uuid AND i.org_id = $1::uuid "
        "AND i.is_active = TRUE AND i.doc_status <> 'draft' AND i.invoice_type <> 'credit_note' "
        "AND p.payment_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.gst_output",
    module="ganit",
    label="GST output tax",
    unit="inr",
    grain="flow",
    dimensions=("tax_type",),
    sensitivity="financial",
    drill="ganit.invoices",
    description="Output GST charged in the period — cgst+sgst+igst+cess per "
                "bucket (there is no tax_amount column; the components are "
                "the truth). Credit notes subtract their tax.",
)
def gst_output(req: MetricRequest):
    period = bucket_expr(req.bucket, "invoice_date")
    grouped = req.group_by == "tax_type"
    tax_col = (
        ", CASE WHEN is_igst THEN 'IGST' ELSE 'CGST+SGST' END AS tax_type"
        if grouped else ""
    )
    return (
        f"SELECT {period} AS period{tax_col}, "
        "SUM(CASE WHEN invoice_type = 'credit_note' "
        "THEN -(COALESCE(cgst,0) + COALESCE(sgst,0) + COALESCE(igst,0) + COALESCE(cess,0)) "
        "ELSE COALESCE(cgst,0) + COALESCE(sgst,0) + COALESCE(igst,0) + COALESCE(cess,0) "
        "END)::float AS value "
        "FROM public.ganit_invoices "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "AND invoice_date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{tax_col and ', 2'} ORDER BY 1{tax_col and ', 2'}",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.expense_by_category",
    module="ganit",
    label="Expenses",
    unit="inr",
    grain="flow",
    dimensions=("category",),
    sensitivity="financial",
    drill="ganit.expenses",
    description="Expense outflow booked in the period, per bucket; "
                "group_by=category answers 'where did it go' for the whole "
                "window instead. category is free text — 14 live values.",
)
def expense_by_category(req: MetricRequest):
    # category has NO foreign key — ganit_expense_categories does not
    # constrain it, so joining that table would silently drop every expense
    # whose free-text value never got a row there.
    if req.group_by == "category":
        return (
            "SELECT category, SUM(total)::float AS value, COUNT(*) AS expenses "
            "FROM public.ganit_expenses "
            "WHERE org_id = $1::uuid AND is_active = TRUE "
            "AND expense_date BETWEEN $2::date AND $3::date "
            "GROUP BY category ORDER BY value DESC",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "expense_date")
    return (
        f"SELECT {period} AS period, SUM(total)::float AS value "
        "FROM public.ganit_expenses "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "AND expense_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.reconciliation_rate",
    module="ganit",
    label="Bank reconciliation rate",
    unit="pct",
    grain="flow",
    drill="ganit.bank",
    description="Share of bank statement lines matched to a payment, per "
                "bucket by statement date — matched and total counts ride "
                "along so the % is auditable.",
)
def reconciliation_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "statement_date")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE is_reconciled)::float / NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE is_reconciled) AS matched, "
        "COUNT(*) AS total "
        "FROM public.ganit_bank_statement_lines "
        "WHERE org_id = $1::uuid "
        "AND statement_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.top_debtors",
    module="ganit",
    label="Top debtors",
    unit="inr",
    grain="stock",
    sensitivity="financial",
    drill="ganit.invoices",
    description="The 15 clients owing the most, as at today — outstanding "
                "value, open invoice count, and the oldest due date. "
                "Invoices with no linked client group under 'Unlinked "
                "client'.",
)
def top_debtors(req: MetricRequest):
    # client_id is NULL on 234/781 live rows: the LEFT JOIN keeps them and
    # COALESCE names them honestly — a UUID never reaches the label
    # (names-not-ids). Grouping is by c.id, so two clients that happen to
    # share a name stay two debtors; every NULL client_id folds into the one
    # 'Unlinked client' row, which is what NULL grouping does and exactly
    # the aggregate a collections screen should show for them.
    return (
        "SELECT COALESCE(c.name, 'Unlinked client') AS label, "
        "SUM(i.total - COALESCE(i.amount_paid, 0))::float AS value, "
        "COUNT(*) AS invoices, "
        "MIN(COALESCE(i.due_date, i.invoice_date)) AS oldest_due "
        "FROM public.ganit_invoices i "
        # Scoped on `org_id` as well as `id`. `ganit_invoices.client_id` has a
        # plain FK to `graha_clients(id)` with no composite (id, org_id)
        # constraint, so the schema cannot refuse a foreign company id — and
        # the product now WRITES this column, which it never used to.
        "LEFT JOIN public.graha_clients c ON c.id = i.client_id AND c.org_id = i.org_id "
        "WHERE i.org_id = $1::uuid AND i.is_active = TRUE "
        "AND i.doc_status <> 'draft' "
        "AND i.invoice_type <> 'credit_note' "
        "AND i.total - COALESCE(i.amount_paid, 0) > 0 "
        "GROUP BY c.id, c.name "
        "ORDER BY value DESC LIMIT 15",
        [req.org_id],
    )


@metric(
    key="ganit.outstanding",
    module="ganit",
    label="Outstanding",
    unit="inr",
    grain="stock",
    sensitivity="financial",
    drill="ganit.invoices",
    description="Total unpaid value across all live invoices, as at today — "
                "the sum the ageing buckets split. total - amount_paid, never "
                "balance_due (drifted on 2 live rows); credit notes excluded.",
)
def outstanding(req: MetricRequest):
    return (
        "SELECT SUM(total - COALESCE(amount_paid, 0))::float AS value, "
        "COUNT(*) AS invoices "
        "FROM public.ganit_invoices "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "AND invoice_type <> 'credit_note' "
        "AND total - COALESCE(amount_paid, 0) > 0 "
        # An unfiltered aggregate returns one row even for an org that is not
        # yours — {value: null} is a shape leak and a convincing nothing.
        # Same rule dso pins: no rows is the honest empty.
        "HAVING COUNT(*) > 0",
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
    absent="public.ganit_tds_challans holds 0 rows and has no section column; "
           "sections would sit in its `deductions` jsonb, whose shape has never "
           "been exercised. The only populated TDS columns in the database "
           "belong to payroll (vetana_payslips), which is a different domain.",
)
