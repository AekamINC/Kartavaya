"""Vetana (payroll) metrics — proposal 62 §4.

Verified against the schema files and the router, 2026-08-18 — migrations
020_vikray_vetana.sql / 033_vetana_loans.sql / 034_expense_claims.sql and
routers/vetana.py. NOT live-probed in this session (this batch ran with no
database access, deliberately); the column facts below come from the DDL and
from queries the router runs in production, not from a catalogue probe.

The facts every query in this file stands on:

· `month` is TEXT, 'YYYY-MM', on both vetana_payroll_runs and vetana_payslips
  (PayrollProcessRequest validates exactly that shape). Every window filter
  and every bucket therefore goes through `to_date(month || '-01',
  'YYYY-MM-DD')` — a real date, so $2/$3 windows and date_trunc buckets work.
  Consequence stated rather than hidden: a payroll month belongs to its FIRST
  day, so a window opening mid-month excludes that month's run.

· PF / ESI / PT / TDS are separate COLUMNS on vetana_payslips, not component
  rows: pf_employee, pf_employer, esi_employee, esi_employer,
  professional_tax, tds. PF and ESI are counted BOTH SIDES (employee +
  employer) — the run's own total_pf/total_esi do the same
  (process_payroll: `totals["pf"] += pf_employee + pf_employer`), and both
  sides are remitted to the state. Every column is DEFAULT 0 but nullable, so
  each is COALESCEd before arithmetic — one NULL component nulls the row.

· Run status is draft → processed → approved → disbursed, and a REVERTED run
  goes back to 'draft' WITHOUT deleting its payslips (revert_run touches only
  the run row). So a payslip row alone cannot be trusted: every money metric
  joins the run and requires `r.status <> 'draft'` — the ganit rule
  (`doc_status <> 'draft'`, never `= 'final'`) translated to payroll.

· Overtime hours AND pay are snapshotted onto the payslip at process time
  (`overtime_hours`, `overtime_pay` — the router computes pay at 2x the
  derived hourly rate). manav_attendance holds hours only, with no rate
  column anywhere, so the payslip snapshot is the one place cost exists and
  this file deliberately never reads attendance.

· Cost to company = gross + employer PF + employer ESI. Employee-side
  deductions are already inside gross; the employer contributions are on top
  of it; loan recoveries and reimbursements are transfers, not pay cost.

· Department is `manav_employees.department` — a free-text NAME. There is no
  department_id column and no migration adds one (the router states this
  twice and joins by name). Blank departments label 'Unassigned'; no id ever
  reaches a select list (decision_names_not_ids).

· No salary bands exist anywhere: no bands/grades table in any migration and
  no band, grade or midpoint column on vetana_salary_structures — so the
  band distribution below is a fixed CTC histogram, and compa-ratio is
  declared ABSENT rather than faked against invented midpoints.

· The revenue side of payroll_revenue_share is ganit.invoiced's definition
  VERBATIM — staging.ganit_invoices, is_active, doc_status <> 'draft',
  credit notes subtracting. Metric drift between modules is the programme's
  named failure mode; test_metrics_vetana.py pins both files to the same
  fragment so drift fails the suite instead of shipping two revenues.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: The payroll month as a real date — month is TEXT 'YYYY-MM' (migration 020).
_MONTH = "to_date(p.month || '-01', 'YYYY-MM-DD')"

#: Payslips that stand: live rows whose RUN is not draft. A reverted run drops
#: back to 'draft' with its payslips still on file — the join is the guard.
_SLIPS = (
    "FROM staging.vetana_payslips p "
    "JOIN staging.vetana_payroll_runs r ON r.id = p.run_id AND r.org_id = p.org_id "
    "WHERE p.org_id = $1::uuid AND p.is_active = TRUE AND r.status <> 'draft' "
)

_WINDOW = f"AND {_MONTH} BETWEEN $2::date AND $3::date "

#: Cost to company, per payslip. Gross already contains every employee-side
#: deduction; the employer contributions are on top. COALESCE each — the
#: columns are DEFAULT 0 but nullable, and one NULL nulls the sum.
_COST = "COALESCE(p.gross, 0) + COALESCE(p.pf_employer, 0) + COALESCE(p.esi_employer, 0)"

#: Statutory components, both sides where both sides exist — the same rule the
#: run's own totals apply (process_payroll sums employee + employer).
_PF = "COALESCE(p.pf_employee, 0) + COALESCE(p.pf_employer, 0)"
_ESI = "COALESCE(p.esi_employee, 0) + COALESCE(p.esi_employer, 0)"
_PT = "COALESCE(p.professional_tax, 0)"
_TDS = "COALESCE(p.tds, 0)"


@metric(
    key="vetana.payroll_cost",
    module="vetana",
    label="Payroll cost",
    unit="inr",
    grain="flow",
    dimensions=("department",),
    sensitivity="financial",
    drill="vetana.payslips",
    description="Cost to company per payroll month — gross plus employer PF "
                "and ESI, from the payslips of non-draft runs. Headcount and "
                "per-head cost ride along (per-head is SUM/COUNT within the "
                "bucket, never an average of averages). group_by=department "
                "splits by the employee's department name; blank departments "
                "read 'Unassigned'.",
)
def payroll_cost(req: MetricRequest):
    period = bucket_expr(req.bucket, _MONTH)
    if req.group_by == "department":
        # The employee join exists ONLY for the department name, and it does
        # NOT filter e.is_active: an exited employee's payslips still cost
        # money in the months they were paid — a flow includes them, exactly
        # as core.throughput keeps archived tasks.
        return (
            f"SELECT {period} AS period, "
            "COALESCE(NULLIF(e.department, ''), 'Unassigned') AS department, "
            f"SUM({_COST})::float AS value, "
            "SUM(COALESCE(p.gross, 0))::float AS gross, "
            "SUM(COALESCE(p.net_pay, 0))::float AS net, "
            "COUNT(DISTINCT p.employee_id) AS employees, "
            f"SUM({_COST})::float / NULLIF(COUNT(DISTINCT p.employee_id), 0)::float AS per_head "
            "FROM staging.vetana_payslips p "
            "JOIN staging.vetana_payroll_runs r ON r.id = p.run_id AND r.org_id = p.org_id "
            "JOIN staging.manav_employees e ON e.id = p.employee_id AND e.org_id = p.org_id "
            "WHERE p.org_id = $1::uuid AND p.is_active = TRUE AND r.status <> 'draft' "
            + _WINDOW +
            "GROUP BY 1, 2 ORDER BY 1, 2",
            [req.org_id, req.window.start, req.window.end],
        )
    return (
        f"SELECT {period} AS period, "
        f"SUM({_COST})::float AS value, "
        "SUM(COALESCE(p.gross, 0))::float AS gross, "
        "SUM(COALESCE(p.net_pay, 0))::float AS net, "
        "COUNT(DISTINCT p.employee_id) AS employees, "
        f"SUM({_COST})::float / NULLIF(COUNT(DISTINCT p.employee_id), 0)::float AS per_head "
        + _SLIPS + _WINDOW +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vetana.statutory",
    module="vetana",
    label="Statutory deductions",
    unit="inr",
    grain="flow",
    dimensions=("component",),
    sensitivity="financial",
    drill="vetana.payslips",
    description="PF, ESI, PT and TDS per payroll month — separate payslip "
                "columns, PF and ESI counted both sides (employee + employer, "
                "the same rule the run's own totals apply; both sides are "
                "remitted). The four components ride along; group_by="
                "component returns them as rows instead.",
)
def statutory(req: MetricRequest):
    period = bucket_expr(req.bucket, _MONTH)
    if req.group_by == "component":
        # The components are COLUMNS, not rows — the split is a LATERAL
        # VALUES over the four expressions, not a join to any component table
        # (none exists).
        return (
            f"SELECT {period} AS period, c.component, SUM(c.amount)::float AS value "
            "FROM staging.vetana_payslips p "
            "JOIN staging.vetana_payroll_runs r ON r.id = p.run_id AND r.org_id = p.org_id "
            "CROSS JOIN LATERAL (VALUES "
            f"('PF', {_PF}), ('ESI', {_ESI}), ('PT', {_PT}), ('TDS', {_TDS})"
            ") AS c(component, amount) "
            "WHERE p.org_id = $1::uuid AND p.is_active = TRUE AND r.status <> 'draft' "
            + _WINDOW +
            "GROUP BY 1, 2 ORDER BY 1, 2",
            [req.org_id, req.window.start, req.window.end],
        )
    return (
        f"SELECT {period} AS period, "
        f"SUM({_PF} + {_ESI} + {_PT} + {_TDS})::float AS value, "
        f"SUM({_PF})::float AS pf, "
        f"SUM({_ESI})::float AS esi, "
        f"SUM({_PT})::float AS pt, "
        f"SUM({_TDS})::float AS tds "
        + _SLIPS + _WINDOW +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vetana.overtime",
    module="vetana",
    label="Overtime",
    unit="hours",
    grain="flow",
    sensitivity="financial",
    drill="vetana.payslips",
    description="Overtime hours per payroll month, with the cost paid for "
                "them riding along. Both come from the payslip snapshot "
                "(hours and 2x-rate pay are written at process time) — "
                "attendance holds hours with no rate anywhere, so the "
                "payslip is the one place cost exists.",
)
def overtime(req: MetricRequest):
    period = bucket_expr(req.bucket, _MONTH)
    return (
        f"SELECT {period} AS period, "
        "SUM(COALESCE(p.overtime_hours, 0))::float AS value, "
        "SUM(COALESCE(p.overtime_pay, 0))::float AS cost "
        + _SLIPS + _WINDOW +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vetana.salary_bands",
    module="vetana",
    label="Salary band distribution",
    unit="count",
    grain="stock",
    sensitivity="financial",
    drill="vetana.salary_structures",
    description="Employees per annual-CTC band, as at today — each active "
                "employee's CURRENT structure counted once (latest "
                "effective_from, the same selection process_payroll makes). "
                "Fixed lakh bands: no org-configured bands exist anywhere in "
                "the schema, which is also why compa-ratio is declared "
                "absent rather than computed against invented midpoints.",
)
def salary_bands(req: MetricRequest):
    # DISTINCT ON picks each employee's latest effective structure — the same
    # dedupe process_payroll does in Python (ORDER BY employee_id,
    # effective_from DESC, first row wins). ctc_annual is NOT NULL DEFAULT 0.
    return (
        "SELECT band AS label, COUNT(*) AS value FROM ("
        "  SELECT DISTINCT ON (s.employee_id) "
        "    CASE WHEN s.ctc_annual < 300000 THEN '<3L' "
        "         WHEN s.ctc_annual < 600000 THEN '3-6L' "
        "         WHEN s.ctc_annual < 1200000 THEN '6-12L' "
        "         WHEN s.ctc_annual < 2400000 THEN '12-24L' "
        "         ELSE '24L+' END AS band "
        "  FROM staging.vetana_salary_structures s "
        "  JOIN staging.manav_employees e ON e.id = s.employee_id "
        "  AND e.org_id = s.org_id AND e.is_active = TRUE "
        "  WHERE s.org_id = $1::uuid AND s.is_active = TRUE "
        "  AND s.effective_from <= CURRENT_DATE "
        "  ORDER BY s.employee_id, s.effective_from DESC"
        ") bands GROUP BY band "
        "ORDER BY CASE band WHEN '<3L' THEN 1 WHEN '3-6L' THEN 2 "
        "WHEN '6-12L' THEN 3 WHEN '12-24L' THEN 4 ELSE 5 END",
        [req.org_id],
    )


@metric(
    key="vetana.payroll_revenue_share",
    module="vetana",
    label="Payroll as a share of revenue",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    drill="vetana.runs",
    description="SUM(payroll cost) over SUM(net invoiced) for the window — "
                "one row, a ratio of sums, never an average of monthly "
                "rates. The revenue side is ganit.invoiced's definition "
                "verbatim (non-draft live invoices, credit notes subtract); "
                "the payroll side is the same cost-to-company "
                "vetana.payroll_cost reports. Both sums ride along so the "
                "ratio is auditable.",
)
def payroll_revenue_share(req: MetricRequest):
    # One row, always — the dso pattern. The inner halves are bucketed to
    # honour the registry's bucket walk, and the outer ratio sums the
    # per-bucket sums, so the answer is invariant to how the window is cut.
    period_pay = bucket_expr(req.bucket, _MONTH)
    period_rev = bucket_expr(req.bucket, "invoice_date")
    return (
        "SELECT SUM(pay)::float / NULLIF(SUM(rev), 0)::float * 100 AS value, "
        "SUM(pay)::float AS payroll, SUM(rev)::float AS revenue FROM ("
        f"  SELECT {period_pay} AS period, SUM({_COST}) AS pay, 0::numeric AS rev "
        + _SLIPS + _WINDOW +
        "GROUP BY 1 "
        "UNION ALL "
        # ganit.invoiced, verbatim — pinned against that file by test so the
        # two modules cannot quietly grow two different revenues.
        f"  SELECT {period_rev} AS period, 0::numeric AS pay, "
        "SUM(CASE WHEN invoice_type = 'credit_note' THEN -total ELSE total END) AS rev "
        "FROM staging.ganit_invoices "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND doc_status <> 'draft' "
        "AND invoice_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1"
        ") b "
        # Nothing on either side → no rows, never a convincing {value: null}
        # shape for an org that is not yours — the rule dso and outstanding pin.
        "HAVING COUNT(*) > 0",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vetana.run_status",
    module="vetana",
    label="Payroll run status",
    unit="count",
    grain="stock",
    drill="vetana.runs",
    description="Runs per lifecycle status as at today — draft and processed "
                "are pending (processed awaits an approver; a reverted run "
                "is draft again), then approved, then disbursed. The latest "
                "month in each state rides along.",
)
def run_status(req: MetricRequest):
    return (
        "SELECT r.status AS label, COUNT(*) AS value, MAX(r.month) AS latest_month "
        "FROM staging.vetana_payroll_runs r "
        "WHERE r.org_id = $1::uuid "
        "GROUP BY r.status "
        "ORDER BY CASE r.status WHEN 'draft' THEN 1 WHEN 'processed' THEN 2 "
        "WHEN 'approved' THEN 3 ELSE 4 END",
        [req.org_id],
    )


# ── Declared absent — the schema cannot answer this honestly ─────────────────
# Proposal 62 §10: a stated absence, never a convincing zero.

absent_metric(
    key="vetana.compa_ratio",
    module="vetana",
    label="Compa-ratio",
    unit="pct",
    grain="stock",
    sensitivity="financial",
    absent="No salary bands are configured anywhere: no migration creates a "
           "bands or grades table, and staging.vetana_salary_structures "
           "carries no band, grade or midpoint column — ctc_annual is a bare "
           "number. Compa-ratio is pay over the band midpoint; without a "
           "stored midpoint the ratio has no denominator. Configuring bands "
           "is an owner decision plus a migration, not a query — and the "
           "fixed lakh histogram in vetana.salary_bands does not qualify: "
           "its cut points are the product's, not the org's pay policy.",
)
