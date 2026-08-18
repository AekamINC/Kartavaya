"""Manav (HR) metrics — proposal 62 §4.

PROVENANCE, stated because it differs from ganit.py: every column named here
was verified against the migrations that create it (018_graha_ganit_manav.sql,
037_recruitment.sql, 042_timesheet_billing.sql,
083_offboarding_and_exit_interviews.sql) and the queries routers/manav.py
actually runs — NOT against the live catalogue. This file was written under a
no-live-probe rule (staging and production share one database); the live row
counts it cites (hourly_rate zero on 38 of 98 rows, user_id NULL on all 98)
are core.py's measurements of 2026-08-17, not a fresh probe. Probe read-only
via `railway run` before wiring this module into load_all().

THE SCHEMA FACTS THE WHOLE FILE STANDS ON:

· staging.manav_employees carries `date_of_joining` (nullable) but NO leaving
  date — no ALTER ever added one. The only dated exit anywhere is
  staging.manav_offboarding.last_working_day (migration 083, also nullable).
  The legacy `DELETE /employees/{id}` path still sets `is_active=FALSE,
  status='terminated'` with no offboarding row and no date, so an employee
  deactivated that way has an exit that cannot be placed in time: every dated
  leaver metric here counts offboarding rows and says so in its description
  rather than silently undercounting in the dark.

· Voluntary vs involuntary is manav_offboarding.exit_type. The CHECK allows
  seven values; they split three ways, not two — forcing `end_of_contract`
  and `death` into either side would be a fiction, so the split is
  voluntary / involuntary / other, documented on the metric.

· `status='on_notice'` is still headcount — someone serving notice is on the
  rolls and on payroll. The module dashboard's `status='active'` count
  (routers/manav.py) is a deliberately narrower number; the divergence is
  stated on manav.headcount, not papered over.

· Leave balances (manav_leave_balances) are integer DAYS per employee, type
  and year — allocated / used / carried_forward. `carried_forward` has a
  default but no NOT NULL, so it is COALESCEd. The rupee half of leave
  liability is declared ABSENT: no column stores the encashment basis.

· manav_employees has no probation or confirmation column of any kind, and
  manav_job_openings has only created_at — both drive declared absences, not
  approximations.

· Ghost orgs: single-aggregate-row queries carry HAVING COUNT(*) > 0 (or a
  WHERE on the reconstructed headcount) so an org that is not yours — or an
  org with no HR data — gets no rows, never a convincing {value: null} shape.

· Names, not ids (decision_names_not_ids): span-of-control labels the
  manager's name and groups by the manager ROW (m.id in GROUP BY only), so
  namesakes stay distinct and a UUID never reaches a response column.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: exit_type → the three-way attrition split. resignation / retirement /
#: abandonment are employee-initiated; termination / redundancy are
#: employer-initiated; end_of_contract and death are honestly neither.
_EXIT_CLASS = (
    "CASE WHEN o.exit_type IN ('resignation', 'retirement', 'abandonment') "
    "THEN 'voluntary' "
    "WHEN o.exit_type IN ('termination', 'redundancy') THEN 'involuntary' "
    "ELSE 'other' END"
)


def _headcount_asat(param: str) -> str:
    """Reconstructed headcount as at a bound date ($2 or $3).

    An employee counts at date d when they had joined by d (date_of_joining
    is the only joining fact) and had not yet left — still active today, or
    holding a live offboarding whose last_working_day is after d. Employees
    with no joining date, and employees deactivated with no offboarding row,
    cannot be placed in time and are excluded — stated on the metric.
    """
    return (
        "(SELECT COUNT(*) FROM staging.manav_employees e "
        "WHERE e.org_id = $1::uuid AND e.date_of_joining IS NOT NULL "
        f"AND e.date_of_joining <= {param}::date "
        "AND (e.is_active = TRUE OR EXISTS ("
        "SELECT 1 FROM staging.manav_offboarding x "
        "WHERE x.org_id = e.org_id AND x.employee_id = e.id "
        "AND x.status <> 'cancelled' "
        f"AND x.last_working_day > {param}::date)))"
    )


@metric(
    key="manav.headcount",
    module="manav",
    label="Headcount",
    unit="count",
    grain="stock",
    dimensions=("employment_type",),
    drill="manav.employees",
    description="Employees on the rolls as at today (is_active), with how "
                "many are serving notice riding along. Someone on notice is "
                "still headcount — the HR dashboard's status='active' count "
                "is a deliberately narrower question. "
                "group_by=employment_type splits full-time / part-time / "
                "contract / intern / consultant.",
)
def headcount(req: MetricRequest):
    if req.group_by == "employment_type":
        return (
            "SELECT employment_type AS label, COUNT(*) AS value "
            "FROM staging.manav_employees "
            "WHERE org_id = $1::uuid AND is_active = TRUE "
            "GROUP BY employment_type ORDER BY value DESC, label",
            [req.org_id],
        )
    return (
        "SELECT COUNT(*) AS value, "
        "COUNT(*) FILTER (WHERE status = 'on_notice') AS on_notice "
        "FROM staging.manav_employees "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "HAVING COUNT(*) > 0",
        [req.org_id],
    )


@metric(
    key="manav.headcount_bridge",
    module="manav",
    label="Joiners and leavers",
    unit="count",
    grain="flow",
    drill="manav.employees",
    description="The headcount bridge: joiners (by date_of_joining) and "
                "leavers (by offboarding last_working_day, cancelled exits "
                "excluded) per bucket — value is the net change, both counts "
                "ride along. A joiner who has since left still joined. An "
                "employee deactivated without an offboarding record has no "
                "dated exit and cannot appear as a leaver; an employee with "
                "no joining date cannot appear as a joiner.",
)
def headcount_bridge(req: MetricRequest):
    joined = bucket_expr(req.bucket, "date_of_joining")
    departed = bucket_expr(req.bucket, "o.last_working_day")
    return (
        "SELECT period, SUM(joined) AS joiners, SUM(departed) AS leavers, "
        "SUM(joined) - SUM(departed) AS value FROM ("
        f"SELECT {joined} AS period, 1 AS joined, 0 AS departed "
        "FROM staging.manav_employees "
        "WHERE org_id = $1::uuid "
        "AND date_of_joining BETWEEN $2::date AND $3::date "
        "UNION ALL "
        f"SELECT {departed} AS period, 0 AS joined, 1 AS departed "
        "FROM staging.manav_offboarding o "
        "WHERE o.org_id = $1::uuid AND o.status <> 'cancelled' "
        "AND o.last_working_day BETWEEN $2::date AND $3::date"
        ") moves GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="manav.attrition",
    module="manav",
    label="Attrition (annualised)",
    unit="pct",
    grain="flow",
    dimensions=("exit_class",),
    drill="manav.offboarding",
    description="Annualised attrition: leavers in the window ÷ average "
                "headcount (the mean of headcount reconstructed at the "
                "window's start and end) × 365/window-days × 100 — a ratio "
                "of sums, never an average of per-period rates. Headcount at "
                "a past date is rebuilt from date_of_joining and offboarding "
                "last_working_day; employees with no joining date, or "
                "deactivated with no offboarding record, cannot be placed in "
                "time and are excluded from the reconstruction. "
                "group_by=exit_class splits the numerator — voluntary "
                "(resignation, retirement, abandonment), involuntary "
                "(termination, redundancy), other (end_of_contract, death) — "
                "over the same shared denominator.",
)
def attrition(req: MetricRequest):
    # The leaver count is bucketed inside (the registry walk demands every
    # flow honour the bucket) and summed outside — a ratio of sums is
    # invariant to how the window is cut, so the answer is the same whichever
    # bucket the caller sends. Same construction ganit.dso pins.
    period = bucket_expr(req.bucket, "o.last_working_day")
    grouped = req.group_by == "exit_class"
    class_col = f", {_EXIT_CLASS} AS exit_class" if grouped else ""
    lv = (
        f"lv AS (SELECT {period} AS period{class_col}, COUNT(*) AS leavers "
        "FROM staging.manav_offboarding o "
        "WHERE o.org_id = $1::uuid AND o.status <> 'cancelled' "
        "AND o.last_working_day BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{', 2' if grouped else ''})"
    )
    hc = (
        "hc AS (SELECT ("
        + _headcount_asat("$2") + " + " + _headcount_asat("$3") +
        ") / 2.0 AS avg_headcount)"
    )
    annual = "* (365.0 / ($3::date - $2::date + 1)) * 100"
    if grouped:
        return (
            f"WITH {hc}, {lv} "
            "SELECT l.exit_class, l.leavers, "
            f"(l.leavers / NULLIF(h.avg_headcount, 0) {annual})::float AS value "
            "FROM (SELECT exit_class, SUM(leavers) AS leavers FROM lv "
            "GROUP BY exit_class) l "
            "CROSS JOIN hc h "
            "WHERE h.avg_headcount > 0 "
            "ORDER BY l.exit_class",
            [req.org_id, req.window.start, req.window.end],
        )
    # Ungrouped: an org with headcount and zero leavers gets an honest 0%
    # row (COALESCE over the empty leaver sum); a ghost org — reconstructed
    # headcount 0 — gets no rows at all, never a {value: null} shape.
    return (
        f"WITH {hc}, {lv} "
        "SELECT l.leavers, h.avg_headcount::float AS avg_headcount, "
        f"(l.leavers / NULLIF(h.avg_headcount, 0) {annual})::float AS value "
        "FROM hc h CROSS JOIN "
        "(SELECT COALESCE(SUM(leavers), 0) AS leavers FROM lv) l "
        "WHERE h.avg_headcount > 0",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="manav.tenure",
    module="manav",
    label="Tenure",
    unit="days",
    grain="stock",
    dimensions=("band",),
    drill="manav.employees",
    description="Median days of service across current employees, as at "
                "today — percentile_cont, never AVG for the headline; the "
                "mean rides along as mean_days, labelled as what it is. "
                "group_by=band answers the distribution instead: under 1 / "
                "1-3 / 3-5 / 5+ years. Employees with no date_of_joining "
                "cannot be measured and are excluded from both shapes.",
)
def tenure(req: MetricRequest):
    if req.group_by == "band":
        return (
            "SELECT CASE "
            "WHEN CURRENT_DATE - date_of_joining < 365 THEN '< 1 yr' "
            "WHEN CURRENT_DATE - date_of_joining < 1095 THEN '1-3 yrs' "
            "WHEN CURRENT_DATE - date_of_joining < 1825 THEN '3-5 yrs' "
            "ELSE '5+ yrs' END AS band, COUNT(*) AS value "
            "FROM staging.manav_employees "
            "WHERE org_id = $1::uuid AND is_active = TRUE "
            "AND date_of_joining IS NOT NULL "
            "GROUP BY 1 ORDER BY MIN(CURRENT_DATE - date_of_joining)",
            [req.org_id],
        )
    return (
        "SELECT percentile_cont(0.5) WITHIN GROUP "
        "(ORDER BY CURRENT_DATE - date_of_joining)::float AS value, "
        "AVG(CURRENT_DATE - date_of_joining)::float AS mean_days, "
        "COUNT(*) AS employees "
        "FROM staging.manav_employees "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "AND date_of_joining IS NOT NULL "
        "HAVING COUNT(*) > 0",
        [req.org_id],
    )


@metric(
    key="manav.department_mix",
    module="manav",
    label="Headcount by department",
    unit="count",
    grain="stock",
    drill="manav.employees",
    description="Current employees per department, as at today. department "
                "is free text on the employee row (the manav_departments "
                "table does not constrain it); blank and NULL group as "
                "'Unassigned' rather than vanishing.",
)
def department_mix(req: MetricRequest):
    return (
        "SELECT COALESCE(NULLIF(department, ''), 'Unassigned') AS label, "
        "COUNT(*) AS value "
        "FROM staging.manav_employees "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "GROUP BY 1 ORDER BY value DESC, label",
        [req.org_id],
    )


@metric(
    key="manav.designation_mix",
    module="manav",
    label="Headcount by designation",
    unit="count",
    grain="stock",
    drill="manav.employees",
    description="Current employees per designation, as at today. designation "
                "is free text; blank and NULL group as 'Unassigned' rather "
                "than vanishing.",
)
def designation_mix(req: MetricRequest):
    return (
        "SELECT COALESCE(NULLIF(designation, ''), 'Unassigned') AS label, "
        "COUNT(*) AS value "
        "FROM staging.manav_employees "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "GROUP BY 1 ORDER BY value DESC, label",
        [req.org_id],
    )


absent_metric(
    key="manav.span_of_control",
    module="manav",
    label="Span of control",
    unit="count",
    grain="stock",
    absent="manav_employees.reporting_to has never been written — 0 of 98 "
           "rows carry a value on the live database (probed read-only, "
           "2026-08-18) — and migration 030 retyped it TEXT against the "
           "table's uuid id, so the join both lies and errors. A span "
           "computed over an unwritten link would render as an org where "
           "nobody manages anyone, which is a data gap wearing a chart. The "
           "metric returns when the HR screen starts writing reporting_to "
           "(with the ::uuid cast the retype now requires).",
)


@metric(
    key="manav.leave_liability_days",
    module="manav",
    label="Leave liability (days)",
    unit="days",
    grain="stock",
    drill="manav.leave",
    description="Accrued paid-leave balance in DAYS as at today: allocated + "
                "carried forward − used on each current-year balance row, "
                "floored at zero per row (an overdrawn balance is "
                "recoverable pay, not negative liability), paid leave types "
                "only, current employees only. Days only, deliberately — "
                "the rupee value is declared absent "
                "(manav.leave_liability_inr) because the schema stores no "
                "encashment basis to price a day with.",
)
def leave_liability_days(req: MetricRequest):
    return (
        "SELECT SUM(GREATEST(b.allocated + COALESCE(b.carried_forward, 0) "
        "- b.used, 0))::float AS value, "
        "COUNT(DISTINCT b.employee_id) AS employees "
        "FROM staging.manav_leave_balances b "
        "JOIN staging.manav_employees e "
        "ON e.id = b.employee_id AND e.org_id = $1::uuid "
        "JOIN staging.manav_leave_types t "
        "ON t.id = b.leave_type_id AND t.org_id = $1::uuid "
        "AND t.is_paid = TRUE "
        "WHERE b.org_id = $1::uuid AND e.is_active = TRUE "
        "AND b.year = EXTRACT(YEAR FROM CURRENT_DATE)::int "
        "HAVING COUNT(*) > 0",
        [req.org_id],
    )


# ── Declared absent — the schema cannot answer these honestly ────────────────
# Proposal 62 §10: a stated absence, never a convincing zero. Each reason was
# verified against the migrations named in the module docstring — closing any
# of them is a migration plus an owner decision, not a query.

absent_metric(
    key="manav.time_to_fill",
    module="manav",
    label="Time to fill",
    unit="days",
    grain="flow",
    absent="No requisition opened-at date is stored: "
           "staging.manav_job_openings carries only created_at (row "
           "insertion, not when the requisition opened), and closing a role "
           "is a bare status flip to 'closed' with no timestamp — nor does a "
           "candidate's move to stage 'hired' write a dated event "
           "(manav_candidates has only updated_at, which any edit moves). "
           "Neither end of the interval exists; the metric needs an "
           "opened_at and a filled-at column, not a query.",
)

absent_metric(
    key="manav.confirmations_due",
    module="manav",
    label="Confirmations due (next 30 days)",
    unit="count",
    grain="stock",
    absent="No probation or confirmation date exists anywhere in the schema: "
           "staging.manav_employees has no confirmation-due or probation-end "
           "column, its status CHECK (active / on_notice / terminated / "
           "resigned / absconding) has no probation state, and "
           "employment_type (full_time / part_time / contract / intern / "
           "consultant) does not encode one either. Tracking confirmations "
           "needs a column and a policy for who sets it at hire.",
)

absent_metric(
    key="manav.leave_liability_inr",
    module="manav",
    label="Leave liability (₹)",
    unit="inr",
    grain="stock",
    sensitivity="financial",
    absent="The rupee conversion needs an encashment basis the schema does "
           "not store: no column says which salary component prices a leave "
           "day (basic vs gross vs CTC — staging.vetana_salary_structures "
           "carries all three) or which divisor (26, 30 or 365) turns it "
           "into a day rate, and manav_employees.hourly_rate is unusable as "
           "a stand-in (DEFAULT 0; zero on 38 of 98 live rows, measured "
           "2026-08-17 for core.project_margin). Any choice here would be a "
           "payroll policy invented by a query — the day count ships as "
           "manav.leave_liability_days instead.",
)
