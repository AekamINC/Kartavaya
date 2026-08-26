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

SCHEMA FACTS this file stands on — re-read against the LIVE database on
2026-08-25 (`railway run -e staging -s Kartavya`, READ ONLY transaction,
information_schema plus SELECT … LIMIT 1 per column). The 2026-08-18 version
of this header read the migration folder instead and got the central fact
wrong; that is why the geofence metrics spent a release telling customers a
number was impossible:

· The applied attendance fact is **staging.manav_attendance** (migration 018):
  org_id, employee_id, date, check_in, check_out, work_hours, overtime_hours,
  marked_by ∈ system/manual/biometric/geo, and
  status ∈ present/absent/half_day/late/on_leave/holiday/weekend. It carries
  NO shift_id — confirmed absent from information_schema on 2026-08-25.
· **The Pahchan tables ARE applied.** staging.pahchan_punches (699 rows),
  staging.pahchan_sites (9 rows) and staging.pahchan_policy (2 rows) all
  exist live, whatever the PROPOSED_ prefix on migrations/PROPOSED_064_pahchan.sql
  still suggests — migration 193 ALTERs both tables, which it could not do
  against a table that was never created. pahchan_punches carries lat, lng,
  accuracy_m, distance_m, geofence_id, flags, source, captured_at,
  received_at and synced_at; pahchan_sites carries lat, lng and radius_m;
  pahchan_policy carries grace_minutes and shift_start_time. Read the schema,
  never the migration ledger: an absence reason is a claim about the database
  and expires the moment the database moves.
· What stays `absent=` below stays for a reason that is NOT "the migration is
  unapplied" — each surviving guard now names the column or the boundary that
  actually blocks it. Proposal 62 §10 is a stated absence over a convincing
  zero; it was never a licence to keep a stale one.
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


@metric(
    key="pahchan.geofence_exceptions",
    module="pahchan",
    label="Geofence exceptions",
    unit="count",
    grain="flow",
    description="Punches recorded outside their site's geofence, per bucket. "
                "The headline counts the 'geo' flag the write path stamped at "
                "capture — the verdict that was actually acted on, and the "
                "only one a later edit to a site's radius cannot rewrite. "
                "beyond_radius recomputes the same question against the "
                "radius as it stands TODAY (distance_m > radius_m), so the "
                "two disagreeing is itself the signal that a geofence moved "
                "under recorded history. unresolved counts punches with no "
                "site to measure against — judged as neither in nor out, "
                "never folded into the exception count. A bucket with "
                "punches and no exceptions is a true zero and is shipped; a "
                "bucket with no punches returns no row.",
)
def geofence_exceptions(req: MetricRequest):
    # captured_at, never received_at (07 §4): a punch captured 09:41 and
    # synced 11:38 is a 09:41 punch. Truncated in IST, not the session's UTC —
    # a 04:00 IST punch is 22:30 UTC the PREVIOUS day, so a UTC bucket would
    # file an early shift under the wrong day, week and month. Same expression
    # bounds the window, so the end date is whole rather than cut at midnight
    # UTC.
    local = "(p.captured_at AT TIME ZONE 'Asia/Kolkata')"
    period = bucket_expr(req.bucket, local)
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE 'geo' = ANY(p.flags)) AS value, "
        "COUNT(*) AS punches, "
        "COUNT(*) FILTER (WHERE p.distance_m > s.radius_m) AS beyond_radius, "
        "COUNT(*) FILTER (WHERE p.geofence_id IS NULL) AS unresolved, "
        "MAX(p.distance_m)::float AS max_distance_m "
        "FROM staging.pahchan_punches p "
        # LEFT, not inner: a punch whose site was deleted must still be
        # counted and must still show in `unresolved` — an inner join would
        # delete the exception along with the site.
        "LEFT JOIN staging.pahchan_sites s ON s.id = p.geofence_id "
        "WHERE p.org_id = $1::uuid "
        f"AND {local}::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="pahchan.offline_reconciliation",
    module="pahchan",
    label="Offline punches reconciled in buffer",
    unit="count",
    grain="flow",
    description="Of the punches captured offline in each bucket, how many "
                "reached the server inside the 72-hour buffer — measured as "
                "received_at - captured_at, an interval between two absolute "
                "instants and so immune to any timezone question. late_sync "
                "is the remainder: captured, but delivered after the buffer "
                "had closed. Only buckets that actually held an offline "
                "punch are returned — a bucket of purely live punches has "
                "nothing to reconcile, and '0 reconciled' there would read "
                "as a failure rather than as an absence of the case.",
)
def offline_reconciliation(req: MetricRequest):
    # 72 hours is a product constant, not a policy column: pahchan_policy
    # carries retention and grace but no buffer field (live column list,
    # 2026-08-25). It is written once here so a future policy column has one
    # place to replace.
    local = "(p.captured_at AT TIME ZONE 'Asia/Kolkata')"
    period = bucket_expr(req.bucket, local)
    offline = "p.source = 'offline'"
    inside = "p.received_at - p.captured_at <= INTERVAL '72 hours'"
    return (
        f"SELECT {period} AS period, "
        f"COUNT(*) FILTER (WHERE {offline} AND {inside}) AS value, "
        f"COUNT(*) FILTER (WHERE {offline}) AS offline_punches, "
        f"COUNT(*) FILTER (WHERE {offline} AND NOT ({inside})) AS late_sync, "
        "MAX(EXTRACT(EPOCH FROM (p.received_at - p.captured_at)) / 3600.0)"
        f" FILTER (WHERE {offline})::float AS max_lag_hours "
        "FROM staging.pahchan_punches p "
        "WHERE p.org_id = $1::uuid "
        f"AND {local}::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 "
        f"HAVING COUNT(*) FILTER (WHERE {offline}) > 0 "
        "ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the applied schema cannot answer these honestly ────────
# Proposal 62 §10: a stated absence, never a convincing zero. Both reasons
# below were re-verified against the LIVE database on 2026-08-25 and both were
# REWRITTEN: their previous text rested on "PROPOSED_064_pahchan.sql is not
# applied", which is false — the tables are live. An absence reason is a claim
# about the database, so it carries the date it was checked and it is checked
# again before it is believed. Neither of these is closed by a migration; one
# needs a column nothing has written, the other needs a DPDP decision.

absent_metric(
    key="pahchan.attendance_by_shift",
    module="pahchan",
    label="Attendance % by shift",
    unit="pct",
    grain="flow",
    absent="Nothing records which shift a day was worked on. Verified live "
           "2026-08-25: staging.manav_attendance has no shift_id column, and "
           "staging.pahchan_punches has no shift column either; "
           "manav_employees.shift is free text defaulting to 'general' with "
           "no FK into staging.manav_shift_definitions (027, 12 rows live); "
           "and joining a same-day staging.manav_schedules row would silently "
           "drop every attendance day the optional scheduler never covered — "
           "a convincing partial answer. staging.pahchan_policy IS applied "
           "and does carry shift_start_time, but it holds ONE shift per org, "
           "so it yields a single bucket rather than a shift dimension. "
           "Closing this needs a shift stamped on the attendance or punch "
           "row at the time it is written, not a query.",
)

absent_metric(
    key="pahchan.late_arrivals",
    module="pahchan",
    label="Late arrivals vs shift policy",
    unit="count",
    grain="flow",
    absent="The policy now exists — verified live 2026-08-25, "
           "staging.pahchan_policy carries grace_minutes and shift_start_time "
           "on every row — but an ARRIVAL does not. An arrival is the first "
           "'in' punch of a person's day, and isolating it needs a per-person "
           "grouping that the DPDP boundary at the top of this file forbids "
           "outright; counting late PUNCHES instead would score somebody who "
           "punches in three times as three late arrivals, which is a "
           "different question under this metric's name. "
           "manav_attendance.status = 'late' is likewise the marking path's "
           "own verdict, not a measurement against any policy. This is an "
           "owner decision about the DPDP boundary, not a schema gap.",
)
