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
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: tasks.team_id = teams.team_id — both text. See the module docstring.
_ORG_TASKS = (
    "FROM public.tasks t "
    "JOIN public.teams tm ON tm.team_id = t.team_id "
    "WHERE tm.org_id = $1::uuid "
)


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
