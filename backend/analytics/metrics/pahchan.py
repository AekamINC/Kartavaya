"""Pahchan (attendance) metrics — proposal 62 §4.

THE GOVERNING CONSTRAINT, before any metric: attendance detail is DPDP-scoped
and is deliberately reachable only by god-mode roles today
(project_pahchan_dpdp_access — the privacy notice is TRUE because the register
is closed). Analytics must keep that boundary, not become the side door:

· EVERY metric here aggregates BY TEAM / DAY / SHIFT. Never a per-person
  series. No employee id, employee name, employee code or email appears in
  any dimension, any label, or any output row. The only place an employee_id
  may occur in SQL is as the JOIN KEY from an attendance row to its
  employee's department — it never reaches a SELECT list or a GROUP BY.
· No metric declares a `drill`. A click-through target would be the
  attendance register, which is god-mode-only by design; a drill would grant
  through analytics what the module itself refuses.
· test_metrics_pahchan.py pins both rules on the SQL the builders actually
  return.

SCHEMA FACTS this file stands on — read from the applied migrations and the
routers, NOT from a live probe (this session was forbidden live access; the
mock-pool caveat applies, so probe these queries read-only via railway run
before arming anything on top of them):

· The applied attendance fact is **staging.manav_attendance** (migration 018):
  org_id, employee_id, date, check_in, check_out, work_hours, overtime_hours,
  marked_by ∈ system/manual/biometric/geo, and
  status ∈ present/absent/half_day/late/on_leave/holiday/weekend.
· The Pahchan-specific tables (pahchan_punches, pahchan_sites,
  pahchan_policy) exist ONLY in migrations/PROSED-prefixed form —
  migrations/PROPOSED_064_pahchan.sql — and a PROPOSED_ migration is not
  schema. Everything that honestly needs them is declared `absent=` below
  rather than approximated: proposal 62 §10, a stated absence over a
  convincing zero.
· "Team" is **manav_employees.department** — free text, DEFAULT '' (018).
  Empty is labelled 'No department'. staging.manav_departments exists but the
  column has no FK into it, so it is never joined — the same trap as
  ganit_expense_categories: a join on a free-text label silently drops every
  row whose value never got a lookup row.
· manav_employees also carries a `shift` label (free text, DEFAULT
  'general', no FK) and migration 027 created staging.manav_shift_definitions
  + manav_schedules — but no applied column links an ATTENDANCE row to a
  shift, so the shift cut is declared absent, not faked through an optional
  scheduler join that would drop every unscheduled day.
· The attendance-day formula is payroll's own (routers/vetana.py, the payslip
  builder): a day counts as present when status IN ('present','late'), a
  half_day counts 0.5. The reconciliation metric reuses it verbatim so both
  sides of the comparison measure the same thing — and payroll's fallback
  (an employee with NO attendance rows is paid the full month's working
  days) is precisely the gap the metric exists to surface.
· vetana_payslips.month is TEXT 'YYYY-MM' (zero-padded by every writer), so
  months are ranged with a text BETWEEN on to_char bounds.
· House SQL rules throughout: schema-qualified tables, every ambiguous
  parameter cast ($1::uuid, $2::date — PgBouncer turns an untyped parse
  error into an instant 500), rates from SUMS within each bucket (never an
  average of per-row rates), and no convincing empty shapes — an org with no
  attendance returns no rows, not a {value: null} row.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: The department ("team") label — free text, '' becomes an honest bucket
#: name. This is the ONLY thing ever read off manav_employees here.
_TEAM = "COALESCE(NULLIF(e.department, ''), 'No department') AS team"

#: The join that resolves an attendance row to its department. employee_id
#: appears here and NOWHERE else — never in a SELECT list, never in a
#: GROUP BY (the DPDP pin counts on exactly this text).
_TEAM_JOIN = "JOIN staging.manav_employees e ON e.id = a.employee_id "

#: Payroll's own present-day formula (routers/vetana.py payslip builder):
#: present + late count 1, half_day counts 0.5. Reused verbatim so the
#: reconciliation compares like with like.
_ATTENDED = (
    "COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) "
    "+ 0.5 * COUNT(*) FILTER (WHERE a.status = 'half_day')"
)

#: A day that was marked and could have been attended. holiday and weekend
#: are not workable days; on_leave STAYS in the denominator deliberately —
#: the approved/unplanned split is absenteeism's job, and removing leave here
#: would let a team on permanent leave read as 100% attendance.
_MARKED = "COUNT(*) FILTER (WHERE a.status NOT IN ('holiday', 'weekend'))"


def _team_parts(req: MetricRequest) -> tuple[str, str, str]:
    """(select-suffix, join, group-suffix) for the optional team cut."""
    if req.group_by == "team":
        return f", {_TEAM}", _TEAM_JOIN, ", 2"
    return "", "", ""


@metric(
    key="pahchan.attendance_rate",
    module="pahchan",
    label="Attendance %",
    unit="pct",
    grain="flow",
    dimensions=("team",),
    description="Of the marked, workable days in each bucket, the share "
                "attended — (present + late + half_day x 0.5) / marked, from "
                "grouped counts, never an average of per-day rates. Marked "
                "excludes holiday and weekend; approved leave stays in the "
                "denominator (the absenteeism metric carries the approved vs "
                "unplanned split). bucket=day is the by-day read; "
                "group_by=team cuts by department. Aggregates only — no "
                "per-person series exists or will.",
)
def attendance_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "a.date")
    team_col, join, g2 = _team_parts(req)
    return (
        f"SELECT {period} AS period{team_col}, "
        f"({_ATTENDED})::float / NULLIF({_MARKED}, 0)::float * 100 AS value, "
        f"({_ATTENDED})::float AS attended, "
        f"{_MARKED} AS marked "
        "FROM staging.manav_attendance a "
        + join +
        "WHERE a.org_id = $1::uuid "
        "AND a.date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{g2} "
        # A bucket whose every row is holiday/weekend has no denominator —
        # it is dropped rather than shipped as a null-valued row.
        f"HAVING {_MARKED} > 0 "
        f"ORDER BY 1{g2}",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="pahchan.absenteeism",
    module="pahchan",
    label="Absenteeism",
    unit="count",
    grain="flow",
    dimensions=("team",),
    description="Absence days per bucket, split unplanned versus approved: "
                "unplanned = status 'absent' (nobody sanctioned it), "
                "approved = status 'on_leave' (leave that was granted). The "
                "headline value is their sum; both legs ride along so the "
                "trend of each is visible. A bucket with marked attendance "
                "and zero absences is a true zero, not a gap.",
)
def absenteeism(req: MetricRequest):
    period = bucket_expr(req.bucket, "a.date")
    team_col, join, g2 = _team_parts(req)
    return (
        f"SELECT {period} AS period{team_col}, "
        "COUNT(*) FILTER (WHERE a.status IN ('absent', 'on_leave')) AS value, "
        "COUNT(*) FILTER (WHERE a.status = 'absent') AS unplanned, "
        "COUNT(*) FILTER (WHERE a.status = 'on_leave') AS approved "
        "FROM staging.manav_attendance a "
        + join +
        "WHERE a.org_id = $1::uuid "
        "AND a.date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{g2} ORDER BY 1{g2}",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="pahchan.hours_worked",
    module="pahchan",
    label="Hours worked",
    unit="hours",
    grain="flow",
    dimensions=("team",),
    description="Recorded work hours per bucket, with overtime hours and the "
                "count of days that carried a recording alongside. A bucket "
                "where attendance was marked but hours never recorded is "
                "dropped, not shipped as zero — no data is not 'nobody "
                "worked'.",
)
def hours_worked(req: MetricRequest):
    period = bucket_expr(req.bucket, "a.date")
    team_col, join, g2 = _team_parts(req)
    return (
        f"SELECT {period} AS period{team_col}, "
        "SUM(a.work_hours)::float AS value, "
        "SUM(COALESCE(a.overtime_hours, 0))::float AS overtime, "
        "COUNT(*) FILTER (WHERE a.work_hours IS NOT NULL) AS recorded_days "
        "FROM staging.manav_attendance a "
        + join +
        "WHERE a.org_id = $1::uuid "
        "AND a.date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{g2} "
        "HAVING SUM(a.work_hours) IS NOT NULL "
        f"ORDER BY 1{g2}",
        [req.org_id, req.window.start, req.window.end],
    )


#: The payslip months a [start, end] window touches. month is TEXT 'YYYY-MM',
#: zero-padded by every writer, so a text BETWEEN on to_char bounds is exact.
_VETANA_MONTHS = (
    "p.org_id = $1::uuid AND p.is_active = TRUE "
    "AND p.month BETWEEN to_char($2::date, 'YYYY-MM') "
    "AND to_char($3::date, 'YYYY-MM')"
)


@metric(
    key="pahchan.vetana_reconciliation",
    module="pahchan",
    label="Attendance vs Vetana days",
    unit="days",
    grain="flow",
    description="One row: payroll-recorded days minus attendance-recorded "
                "days over the window, org-level — positive means Vetana "
                "paid days attendance never saw. Both sides use payroll's "
                "own formula (present + late + half_day x 0.5 = "
                "SUM(present_days)), so the delta isolates real gaps — "
                "chiefly payroll's fallback that pays a full month to anyone "
                "with no attendance rows at all. Payslips are monthly: a "
                "window that cuts a month mid-way compares partial "
                "attendance against that whole month's payroll, so send "
                "whole months for a clean read.",
)
def vetana_reconciliation(req: MetricRequest):
    # dso's precedent: the inner query is bucketed to honour the registry's
    # one-walk contract, the outer aggregate sums the per-bucket sums, so the
    # answer is the same single row whichever bucket the caller sends.
    period = bucket_expr(req.bucket, "a.date")
    return (
        "SELECT vetana_days - attendance_days AS value, "
        "attendance_days, vetana_days FROM ("
        "  SELECT COALESCE(SUM(att), 0)::float AS attendance_days, "
        "    (SELECT COALESCE(SUM(p.present_days), 0)::float "
        "     FROM staging.vetana_payslips p "
        f"     WHERE {_VETANA_MONTHS}) AS vetana_days "
        "  FROM ("
        f"    SELECT {period} AS period, "
        f"      {_ATTENDED} AS att "
        "    FROM staging.manav_attendance a "
        "    WHERE a.org_id = $1::uuid "
        "    AND a.date BETWEEN $2::date AND $3::date "
        "    GROUP BY 1"
        "  ) b "
        # A row comes back when EITHER side has data: attendance with no
        # payroll and payroll with no attendance are both 100% gaps this
        # metric exists to show. An org with neither — including an org that
        # is not yours — returns no rows, never a {value: null} shape.
        "  HAVING COUNT(*) > 0 OR EXISTS ("
        "    SELECT 1 FROM staging.vetana_payslips p "
        f"    WHERE {_VETANA_MONTHS})"
        ") r",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the applied schema cannot answer these honestly ────────
# Proposal 62 §10: a stated absence, never a convincing zero. Each reason
# names the unapplied migration or missing column, verified against
# backend/migrations on 2026-08-18. Closing them is applying PROPOSED_064
# (an owner decision on a shared production database), not a query.

absent_metric(
    key="pahchan.attendance_by_shift",
    module="pahchan",
    label="Attendance % by shift",
    unit="pct",
    grain="flow",
    absent="The attendance fact carries no shift: staging.manav_attendance "
           "(018) has no shift_id; manav_employees.shift is free text "
           "defaulting to 'general' with no FK into "
           "staging.manav_shift_definitions (027); and joining a same-day "
           "staging.manav_schedules row would silently drop every attendance "
           "day the optional scheduler never covered — a convincing partial "
           "answer. The Pahchan shift model lives only in "
           "migrations/PROPOSED_064_pahchan.sql, which is not applied.",
)

absent_metric(
    key="pahchan.late_arrivals",
    module="pahchan",
    label="Late arrivals vs shift policy",
    unit="count",
    grain="flow",
    absent="'Late against the shift policy' needs a policy: grace minutes "
           "exist only on staging.pahchan_policy in "
           "migrations/PROPOSED_064_pahchan.sql (not applied); "
           "staging.manav_shift_definitions (027) carries start_time but no "
           "grace and nothing links an attendance row to a shift; and "
           "manav_attendance.status = 'late' is the marking path's verdict, "
           "not a measurement against any policy — counting it would answer "
           "a different question under this metric's name.",
)

absent_metric(
    key="pahchan.geofence_exceptions",
    module="pahchan",
    label="Geofence exceptions",
    unit="count",
    grain="flow",
    absent="Geofence data does not exist in the applied schema: "
           "staging.pahchan_punches (lat/lng, distance_m, geofence_id, "
           "flags) and staging.pahchan_sites are declared only in "
           "migrations/PROPOSED_064_pahchan.sql, which is not applied. "
           "manav_attendance.location is an untyped JSONB defaulting to "
           "'{}' with no site or radius to measure against.",
)

absent_metric(
    key="pahchan.offline_reconciliation",
    module="pahchan",
    label="Offline punches reconciled in buffer",
    unit="count",
    grain="flow",
    absent="Offline punches and the 72-hour buffer live on "
           "staging.pahchan_punches (source = 'offline', captured_at versus "
           "received_at, synced_at) — declared only in "
           "migrations/PROPOSED_064_pahchan.sql, which is not applied. The "
           "applied manav_attendance rows carry marked_by but no "
           "capture-versus-receipt timeline, so 'reconciled inside the "
           "buffer' cannot be measured.",
)
