"""The vetana (payroll) metrics, held to the guards their docstring promises.

Mirrors test_metrics_ganit.py: a batch pin for the declarations, then the
metric-SPECIFIC guarantees a refactor could drop while every universal check
stays green — draft runs excluded via the run join (a reverted run keeps its
payslips), PF/ESI counted both sides, the month TEXT column read as a real
date, per-head as a ratio of sums, overtime from the payslip snapshot rather
than rateless attendance, and above all the revenue-definition pin: the
payroll-share denominator must be ganit.invoiced's revenue VERBATIM, so the
two modules drifting apart fails this suite instead of shipping two revenues
(the programme's named failure mode).

vetana is not yet named in registry.load_all() — wiring it is integration's
change, not this batch's — so this file imports the module directly and also
replicates the universal registry walk locally for the vetana keys; that
local walk goes redundant the day load_all() lists the module.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

from analytics.registry import REGISTRY, MetricRequest, load_all
from analytics.windowing import BUCKETS
from services.analytics_window import Window

load_all()
import analytics.metrics.vetana  # noqa: E402,F401 — registers on import; see docstring

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

#: Cost to company, the expression both payroll_cost and the share's numerator
#: must agree on — one definition of payroll cost, like one of revenue.
COST_FRAGMENT = "COALESCE(p.gross, 0) + COALESCE(p.pf_employer, 0) + COALESCE(p.esi_employer, 0)"

#: ganit.invoiced's revenue, verbatim. Asserted against BOTH files' built SQL:
#: if ganit ever changes what revenue means, the ganit-side assertion fails
#: here too, and this metric gets updated WITH it rather than drifting.
REVENUE_FRAGMENT = "SUM(CASE WHEN invoice_type = 'credit_note' THEN -total ELSE total END)"
REVENUE_GUARDS = (
    "FROM staging.ganit_invoices",
    "is_active = TRUE AND doc_status <> 'draft'",
    "invoice_date BETWEEN $2::date AND $3::date",
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
        "vetana.payroll_cost": ("flow", "inr", "financial"),
        "vetana.statutory": ("flow", "inr", "financial"),
        "vetana.overtime": ("flow", "hours", "financial"),
        "vetana.salary_bands": ("stock", "count", "financial"),
        "vetana.payroll_revenue_share": ("flow", "pct", "financial"),
        "vetana.run_status": ("stock", "count", "operational"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["vetana.payroll_cost"].dimensions == ("department",)
    assert REGISTRY["vetana.statutory"].dimensions == ("component",)


def test_compa_ratio_is_declared_absent_naming_what_is_missing():
    m = REGISTRY["vetana.compa_ratio"]
    assert m.sql is None and m.absent
    assert m.sensitivity == "financial"
    # The reason must name the schema gap someone would close, not just shrug.
    assert "vetana_salary_structures" in m.absent
    assert "midpoint" in m.absent


def test_the_universal_registry_rules_hold_locally():
    """test_analytics_registry.py cannot walk this module until load_all()
    names it, so its universal contract is replicated for the vetana keys:
    schema-qualified tables, $1::uuid cast, placeholder parity, window
    binding, every bucket honoured."""
    keys = sorted(k for k in REGISTRY if k.startswith("vetana.") and REGISTRY[k].sql)
    assert len(keys) == 6, keys
    for key in keys:
        m = REGISTRY[key]
        win = WIN if m.grain == "flow" else None
        sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))
        assert re.search(r"\bstaging\.", sql), f"{key}: unqualified table"
        assert "$1::uuid" in sql, f"{key}: org parameter not cast"
        assert params[0] == ORG
        placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert placeholders == set(range(1, len(params) + 1)), key
        if m.grain == "flow":
            assert params[1] == WIN.start and params[2] == WIN.end, key
            for b in sorted(BUCKETS):
                s, _ = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket=b))
                assert f"date_trunc('{b}'" in s and "::date" in s, (key, b)
        for dim in m.dimensions:
            s, _ = m.sql(MetricRequest(org_id=ORG, window=win,
                                       bucket="month", group_by=dim))
            assert dim in s, f"{key}: group_by={dim} accepted but absent from SQL"


# ── payroll_cost ─────────────────────────────────────────────────────────────

def test_payroll_cost_is_cost_to_company_from_non_draft_runs():
    sql, params = build("vetana.payroll_cost")
    assert COST_FRAGMENT in sql
    assert "FROM staging.vetana_payslips p" in sql
    # A reverted run drops to 'draft' WITHOUT deleting its payslips, so the
    # payslip row alone cannot be trusted — the run join is the guard.
    assert "JOIN staging.vetana_payroll_runs r ON r.id = p.run_id AND r.org_id = p.org_id" in sql
    assert "r.status <> 'draft'" in sql
    assert "p.is_active = TRUE" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_payroll_cost_reads_the_month_text_column_as_a_real_date():
    sql, _ = build("vetana.payroll_cost")
    # month is TEXT 'YYYY-MM' (migration 020) — windows and buckets both go
    # through to_date, never string comparison.
    assert "to_date(p.month || '-01', 'YYYY-MM-DD') BETWEEN $2::date AND $3::date" in sql
    assert "date_trunc('month', to_date(p.month || '-01', 'YYYY-MM-DD'))::date" in sql


def test_payroll_cost_per_head_is_a_ratio_of_sums():
    sql, _ = build("vetana.payroll_cost")
    assert "NULLIF(COUNT(DISTINCT p.employee_id), 0)" in sql
    assert "AVG(" not in sql, "per-head is SUM/COUNT in the bucket, never an averaged rate"


def test_payroll_cost_department_split_labels_blanks_and_only_appears_when_asked():
    grouped, _ = build("vetana.payroll_cost", group_by="department")
    # department is a free-text NAME on manav_employees — there is no
    # department_id column to join (the router states this twice).
    assert "COALESCE(NULLIF(e.department, ''), 'Unassigned') AS department" in grouped
    assert "JOIN staging.manav_employees e ON e.id = p.employee_id AND e.org_id = p.org_id" in grouped
    assert "GROUP BY 1, 2" in grouped
    # An exited employee's payslips still cost money — a flow must keep them.
    assert "e.is_active" not in grouped
    plain, _ = build("vetana.payroll_cost")
    assert "department" not in plain
    assert "manav_employees" not in plain


# ── statutory ────────────────────────────────────────────────────────────────

def test_statutory_components_are_columns_counted_on_both_sides():
    sql, _ = build("vetana.statutory")
    # PF and ESI both sides — the rule the run's own totals apply; both sides
    # are remitted. Each column COALESCEd: DEFAULT 0 but nullable.
    assert "COALESCE(p.pf_employee, 0) + COALESCE(p.pf_employer, 0)" in sql
    assert "COALESCE(p.esi_employee, 0) + COALESCE(p.esi_employer, 0)" in sql
    assert "COALESCE(p.professional_tax, 0)" in sql
    assert "COALESCE(p.tds, 0)" in sql
    assert "AS pf" in sql and "AS esi" in sql and "AS pt" in sql and "AS tds" in sql
    assert "r.status <> 'draft'" in sql


def test_statutory_component_split_is_a_lateral_values_not_a_component_table():
    grouped, _ = build("vetana.statutory", group_by="component")
    # The components are COLUMNS — no component table exists to join.
    assert "CROSS JOIN LATERAL (VALUES" in grouped
    for label in ("('PF',", "('ESI',", "('PT',", "('TDS',"):
        assert label in grouped, label
    assert "AS c(component, amount)" in grouped
    assert "GROUP BY 1, 2 ORDER BY 1, 2" in grouped
    plain, _ = build("vetana.statutory")
    assert "LATERAL" not in plain


# ── overtime ─────────────────────────────────────────────────────────────────

def test_overtime_reads_the_payslip_snapshot_never_rateless_attendance():
    sql, params = build("vetana.overtime")
    assert "SUM(COALESCE(p.overtime_hours, 0))::float AS value" in sql
    assert "SUM(COALESCE(p.overtime_pay, 0))::float AS cost" in sql
    # attendance holds hours with no rate column anywhere — the payslip is
    # the one place overtime COST exists, written at process time.
    assert "manav_attendance" not in sql
    assert "FROM staging.vetana_payslips p" in sql
    assert "r.status <> 'draft'" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── salary_bands ─────────────────────────────────────────────────────────────

def test_salary_bands_count_each_employees_current_structure_once():
    sql, params = build("vetana.salary_bands")
    # Latest effective structure per employee — the same selection
    # process_payroll makes (ORDER BY employee_id, effective_from DESC).
    assert "DISTINCT ON (s.employee_id)" in sql
    assert "ORDER BY s.employee_id, s.effective_from DESC" in sql
    assert "s.effective_from <= CURRENT_DATE" in sql
    assert "s.is_active = TRUE" in sql
    assert "e.is_active = TRUE" in sql, "a stock counts people on the payroll today"
    assert params == [ORG]


def test_salary_bands_order_is_deterministic_and_no_id_reaches_the_select():
    sql, _ = build("vetana.salary_bands")
    assert sql.startswith("SELECT band AS label, COUNT(*) AS value")
    assert "WHEN '<3L' THEN 1" in sql
    assert "ELSE 5 END" in sql


# ── payroll_revenue_share ────────────────────────────────────────────────────

def test_the_revenue_side_is_ganits_definition_verbatim_so_drift_fails_here():
    """THE pin this file exists for. The fragment is asserted against BOTH
    modules' built SQL: if ganit.invoiced ever redefines revenue, the
    ganit-side assertion fails too, and vetana gets updated WITH it — two
    modules can never quietly report two different revenues."""
    ganit_sql, _ = build("ganit.invoiced")
    share_sql, _ = build("vetana.payroll_revenue_share")
    assert REVENUE_FRAGMENT in ganit_sql, (
        "ganit.invoiced no longer computes revenue this way — update "
        "vetana.payroll_revenue_share to match its NEW definition, then this pin"
    )
    assert REVENUE_FRAGMENT in share_sql
    for guard in REVENUE_GUARDS:
        assert guard in ganit_sql, f"ganit.invoiced dropped: {guard}"
        assert guard in share_sql, f"payroll_revenue_share dropped: {guard}"


def test_payroll_share_is_sums_over_sums_with_both_sides_shown():
    sql, params = build("vetana.payroll_revenue_share")
    assert sql.startswith(
        "SELECT SUM(pay)::float / NULLIF(SUM(rev), 0)::float * 100 AS value"
    )
    assert "AS payroll" in sql and "AS revenue" in sql
    assert "AVG(" not in sql, "the mean of monthly rates is not the period's rate"
    assert params == [ORG, WIN.start, WIN.end]


def test_payroll_share_numerator_is_the_same_cost_payroll_cost_reports():
    # One definition of payroll cost, like one of revenue — the share's
    # numerator and the cost metric must never diverge either.
    share, _ = build("vetana.payroll_revenue_share")
    cost, _ = build("vetana.payroll_cost")
    assert COST_FRAGMENT in share and COST_FRAGMENT in cost
    assert "r.status <> 'draft'" in share


def test_payroll_share_empty_window_returns_no_rows_not_a_null_shape():
    sql, _ = build("vetana.payroll_revenue_share")
    assert "HAVING COUNT(*) > 0" in sql


def test_payroll_share_is_the_same_single_row_under_every_bucket():
    # A ratio of sums is invariant to the cut — the inner halves honour the
    # bucket walk, the outer shape stays one aggregate row (the dso rule).
    for b in sorted(BUCKETS):
        sql, _ = build("vetana.payroll_revenue_share", bucket=b)
        assert sql.startswith(
            "SELECT SUM(pay)::float / NULLIF(SUM(rev), 0)::float * 100"
        ), b


# ── run_status ───────────────────────────────────────────────────────────────

def test_run_status_is_a_stock_of_statuses_binding_only_the_org():
    sql, params = build("vetana.run_status")
    assert "FROM staging.vetana_payroll_runs r" in sql
    assert "GROUP BY r.status" in sql
    assert "MAX(r.month) AS latest_month" in sql
    assert params == [ORG]
    assert "$2" not in sql


def test_run_status_orders_the_lifecycle_and_selects_no_id():
    sql, _ = build("vetana.run_status")
    assert "WHEN 'draft' THEN 1 WHEN 'processed' THEN 2" in sql
    select_list = sql.split(" FROM ")[0]
    assert "r.id" not in select_list and "run_id" not in select_list
