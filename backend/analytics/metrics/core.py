"""Core PM (projects / tasks / time) metrics — proposal 62 §4.

THE SCHEMA FACT THIS WHOLE FILE STANDS ON, measured 2026-08-17 (verify-db.md):
core PM lives in **public**, not staging — `public.tasks` (734),
`public.time_entries` (289), `public.approvals` (58), `public.boards` (10) —
and the live `search_path` does not include `staging`, so every table here is
schema-qualified explicitly. `staging.projects` exists, holds 0 rows, and is a
CRM stub, not the PM project entity.

Org scoping: none of the four tables carries org_id. The one honest path is
`tasks.team_id -> public.teams.team_id -> teams.org_id` — and the join key is
**teams.team_id (text)**, never `teams.id` (uuid): joining on `id` matches
zero rows or raises `text = uuid`. 697 of 734 tasks resolve; the 37 that do
not (36 NULL team_id + 1 dangling) are invisible to every metric here, which
is stated rather than hidden. Time entries carry no team_id at all and scope
two hops: time_entries.task_id -> tasks.team_id -> teams.org_id.

`archived_at`: 244 tasks are archived. Stock metrics (on-hand counts) exclude
them — an archived task is not on anybody's plate. Flow metrics (throughput)
include them — work that was finished and later archived still happened.

Approvals scope the same way, one table over: `public.approvals.team_id` is
NOT NULL (measured — 58 of 58 rows) and joins `public.teams.team_id` (text)
exactly as tasks do. Approvals carry no org_id and no archived_at.

Names, not ids: any per-person metric resolves `assignee_user_ids` entries
through `public.users` in SQL and labels the unresolvable 'Unassigned'. A raw
user id never appears in an output column — the ratchet that guards the UI
(check-rendered-ids) cannot see an API payload, so the query itself is the
enforcement point.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: tasks.team_id = teams.team_id — both text. See the module docstring.
_ORG_TASKS = (
    "FROM public.tasks t "
    "JOIN public.teams tm ON tm.team_id = t.team_id "
    "WHERE tm.org_id = $1::uuid "
)

#: approvals.team_id = teams.team_id — same text key, same org hop.
_ORG_APPROVALS = (
    "FROM public.approvals a "
    "JOIN public.teams tm ON tm.team_id = a.team_id "
    "WHERE tm.org_id = $1::uuid "
)

#: interval -> fractional days, for medians. EXTRACT(EPOCH FROM …) so the
#: result is a plain float in JSON, not a Postgres interval the renderer
#: would have to interpret.
_DAYS = "EXTRACT(EPOCH FROM ({0})) / 86400.0"


@metric(
    key="core.tasks_by_status",
    module="core",
    label="Tasks by status",
    unit="count",
    grain="stock",
    drill="core.tasks",
    description="Open (unarchived) tasks on hand, by status, as at today.",
)
def tasks_by_status(req: MetricRequest):
    return (
        "SELECT t.status AS label, COUNT(*) AS value "
        + _ORG_TASKS +
        "AND t.archived_at IS NULL "
        "GROUP BY t.status ORDER BY value DESC",
        [req.org_id],
    )


@metric(
    key="core.throughput",
    module="core",
    label="Tasks completed",
    unit="count",
    grain="flow",
    drill="core.tasks",
    description="Tasks completed during the period, by completion date. "
                "Includes tasks archived after completion — the work happened.",
)
def throughput(req: MetricRequest):
    period = bucket_expr(req.bucket, "t.completed_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value "
        + _ORG_TASKS +
        "AND t.completed_at IS NOT NULL "
        "AND t.completed_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="core.overdue",
    module="core",
    label="Overdue tasks",
    unit="count",
    grain="stock",
    drill="core.tasks",
    description="Unarchived, not-done tasks past their due date, as at now — "
                "with how many are more than 7 and more than 30 days late. "
                "A task with no due date can never appear here.",
)
def overdue(req: MetricRequest):
    # One aggregate row, three columns: the headline and its age split cost
    # one scan (FILTER, not three queries). due_at < now() is the definition;
    # the 7/30 splits are strictly narrower, so value >= overdue_7 >= overdue_30.
    return (
        "SELECT COUNT(*) AS value, "
        "COUNT(*) FILTER (WHERE t.due_at < now() - interval '7 days') AS overdue_7, "
        "COUNT(*) FILTER (WHERE t.due_at < now() - interval '30 days') AS overdue_30 "
        + _ORG_TASKS +
        "AND t.archived_at IS NULL "
        "AND t.status <> 'done' "
        "AND t.due_at < now()",
        [req.org_id],
    )


@metric(
    key="core.lead_time",
    module="core",
    label="Lead time (created → done)",
    unit="days",
    grain="flow",
    drill="core.tasks",
    description="Median days from task creation to completion, for tasks "
                "completed during the period. This is LEAD time: there is no "
                "status-transition history, so true cycle time "
                "(in_progress → done) cannot be computed honestly and this "
                "metric does not claim to be it. Includes tasks archived "
                "after completion — the work happened.",
)
def lead_time(req: MetricRequest):
    # Negative durations are reported as-is, deliberately. The only rows where
    # completed_at < created_at (34, measured live 2026-08-17) are backdated
    # E2E seed data — every one sits in the E2E test org. Clamping to zero
    # would hide a data-quality fault from any real org that ever grows one.
    period = bucket_expr(req.bucket, "t.completed_at")
    days = _DAYS.format("t.completed_at - t.created_at")
    return (
        f"SELECT {period} AS period, "
        f"percentile_cont(0.5) WITHIN GROUP (ORDER BY {days})::float AS value, "
        "COUNT(*) AS tasks "
        + _ORG_TASKS +
        "AND t.completed_at IS NOT NULL "
        "AND t.completed_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="core.workload",
    module="core",
    label="Workload by assignee",
    unit="count",
    grain="stock",
    drill="core.tasks",
    description="Open (unarchived, not-done) tasks per assignee, as at today. "
                "A co-assigned task counts once per assignee, so the column "
                "sums to more than the open-task total. Tasks with no "
                "assignee — and assignees no longer present in users — count "
                "under 'Unassigned'. Labels are names; user ids never leave "
                "the query.",
)
def workload(req: MetricRequest):
    # LEFT JOIN LATERAL keeps a task whose assignee array is empty (one row,
    # uid NULL -> 'Unassigned'); a bare CROSS JOIN unnest would silently drop
    # every unassigned task from a metric whose whole point is who holds what.
    # COALESCE order is the house display chain (full_name, name, email) —
    # the same one approvals_router and activity.py resolve people with.
    return (
        "SELECT COALESCE(u.full_name, u.name, u.email, 'Unassigned') AS label, "
        "COUNT(*) AS value "
        "FROM public.tasks t "
        "JOIN public.teams tm ON tm.team_id = t.team_id "
        "LEFT JOIN LATERAL unnest(t.assignee_user_ids) AS a(uid) ON TRUE "
        "LEFT JOIN public.users u ON u.user_id = a.uid "
        "WHERE tm.org_id = $1::uuid "
        "AND t.archived_at IS NULL "
        "AND t.status <> 'done' "
        "GROUP BY 1 ORDER BY value DESC, label",
        [req.org_id],
    )


@metric(
    key="core.approval_turnaround",
    module="core",
    label="Approval turnaround",
    unit="days",
    grain="flow",
    drill="core.approvals",
    description="Median days from an approval being raised to its decision, "
                "for approvals decided during the period. Uses "
                "public.approvals (timestamps on both ends), not the "
                "task-side approval_status columns — those carry decided "
                "times on only 29 rows. Scoped approvals.team_id → "
                "teams.org_id, the same org path tasks use.",
)
def approval_turnaround(req: MetricRequest):
    period = bucket_expr(req.bucket, "a.reviewed_at")
    days = _DAYS.format("a.reviewed_at - a.created_at")
    return (
        f"SELECT {period} AS period, "
        f"percentile_cont(0.5) WITHIN GROUP (ORDER BY {days})::float AS value, "
        "COUNT(*) AS approvals "
        + _ORG_APPROVALS +
        "AND a.reviewed_at IS NOT NULL "
        "AND a.reviewed_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer these honestly ────────────────
# Each reason measured on the live database 2026-08-17. These are the four
# metrics PM buyers ask for first, which is exactly why they must not ship as
# convincing zeroes. Closing any of them is a migration plus an owner decision
# (where do rates and capacity live), not a query.

absent_metric(
    key="core.billable_split",
    module="core",
    label="Billable vs non-billable hours",
    unit="hours",
    grain="flow",
    absent="No billable flag exists anywhere: time_entries.is_billed means "
           "INVOICED (and invoice_id is NULL on all 289 rows), which is a "
           "different fact. Recording billability needs a column and a policy.",
)

absent_metric(
    key="core.utilisation",
    module="core",
    label="Utilisation %",
    unit="pct",
    grain="flow",
    absent="The denominator does not exist: no capacity, contracted-hours or "
           "FTE column on public.users, public.team_members or "
           "staging.manav_employees. Hours worked are recorded; hours "
           "available are not.",
)

absent_metric(
    key="core.project_margin",
    module="core",
    label="Project margin",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    absent="Blocked twice over. No rate is reachable from a time entry: "
           "manav_employees.hourly_rate is non-NULL on all 98 rows but "
           "user_id is NULL on all 98 (and the rate is zero on 38), so no "
           "entry can be priced. And ganit_invoices carries no board_id or "
           "team_id, so there is no join from PM work to revenue at all.",
)

absent_metric(
    key="core.burndown",
    module="core",
    label="Burndown vs due date",
    unit="count",
    grain="flow",
    absent="public.boards has no due date, start date or budget; the "
           "milestone and baseline tables that would carry them "
           "(staging.project_milestones, staging.project_baselines) are both "
           "empty; and only 343 of 734 tasks carry a board_id.",
)
