"""
project_brief — what moved on each project this week.

── "Project" means TEAM here, and that is not a shortcut ──────────────────────

`staging.projects` exists and is unjoinable from tasks: `public.tasks` has no
`project_id` column at all, and its `board_id` is NULL on every live row. What
the codebase actually treats as a project is the TEAM — `project_columns.team_id`
and `project_assignments.team_id` both key on it, and `project_assignments` is
literally named for projects while storing `team_id`. So the grouping is by
team, and calling it a project in the output matches what a user sees.

── The LEFT JOIN direction is load-bearing ────────────────────────────────────

FROM teams LEFT JOIN tasks, not the reverse. Driving from tasks would make a
project with nothing in it unrepresentable, and "this project had no movement"
is a finding — it is how you notice a team that has stopped. The HAVING then
drops only the genuinely idle ones, so a brief stays readable: 24 live teams for
Aekam Inc, 13 with movement in the last 7 days.

── The caveat is not decoration ───────────────────────────────────────────────

`closed` counts `completed_at >= since`, and 9 of Aekam's done tasks have
`status = 'done'` with `completed_at` NULL — closed at some unknown time, so
they cannot be attributed to a window. They are excluded rather than guessed at,
and the count is reported, because a throughput figure that silently undercounts
is worse than one that says how much it is missing.
"""
import logging
from datetime import timedelta

from services.skills.timeutil import utc_now

log = logging.getLogger(__name__)


async def weekly_project_brief(pool, org_id: str, days: int = 7) -> dict:
    """Per-project task movement over the last *days*.

    Returns {period_days, projects: [...], caveat?}.
    """
    now = utc_now()
    since = now - timedelta(days=days)

    rows = await pool.fetch(
        """
        SELECT tm.team_id,
               tm.name AS team_name,
               count(t.task_id) FILTER (WHERE t.created_at >= $2)            AS opened,
               count(t.task_id) FILTER (WHERE t.completed_at >= $2)          AS closed,
               count(t.task_id) FILTER (
                 WHERE t.archived_at IS NULL
                   AND t.status NOT IN ('done','cancelled'))                 AS still_open,
               count(t.task_id) FILTER (
                 WHERE t.archived_at IS NULL
                   AND t.status NOT IN ('done','cancelled')
                   AND t.due_at IS NOT NULL
                   AND t.due_at < $3)                                        AS overdue
        FROM teams tm
        LEFT JOIN tasks t ON t.team_id = tm.team_id
        WHERE tm.org_id = $1::uuid
          AND tm.deleted_at IS NULL
        GROUP BY tm.team_id, tm.name
        HAVING count(t.task_id) FILTER (WHERE t.created_at   >= $2) > 0
            OR count(t.task_id) FILTER (WHERE t.completed_at >= $2) > 0
            OR count(t.task_id) FILTER (WHERE t.archived_at IS NULL
                                          AND t.status NOT IN ('done','cancelled')) > 0
        ORDER BY still_open DESC, opened DESC
        LIMIT 200
        """,
        org_id, since, now,
    )

    # Closed-at-an-unknown-time. Counted separately so the brief can say how
    # much of its own throughput figure is missing.
    undated = await pool.fetchval(
        """
        SELECT count(*) FROM tasks
        WHERE team_id IN (SELECT team_id FROM teams
                          WHERE org_id = $1::uuid AND deleted_at IS NULL)
          AND status = 'done' AND completed_at IS NULL
        """,
        org_id,
    )

    out = {
        "period_days": days,
        "projects": [
            {
                "project": r["team_name"],
                "opened": r["opened"],
                "closed": r["closed"],
                "still_open": r["still_open"],
                "overdue": r["overdue"],
            }
            for r in rows
        ],
    }
    if undated:
        out["caveat"] = (
            f"{undated} completed tasks carry no completion date and are excluded "
            f"from 'closed'. Real throughput is at least this figure, not exactly it."
        )
    return out
