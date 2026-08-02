"""
workload_calculator — how much is on each person's plate.

Broken the same way `deadline_scanner` was, plus one of its own. Verified
against the live catalog 2026-08-02:

  staging.tasks              DOES NOT EXIST. Tasks are `public.tasks`.
  t.project_id               no such column — and it was the only scope filter.
  t.due_date                 the column is `due_at`.
  t.is_active                no such column; use `archived_at IS NULL`.
  t.assigned_to              no such column. `user_id` exists but is NULL on all
                             201 live rows; assignment is `assignee_user_ids`,
                             a text[].
  staging.project_assignments
                             joined `ON pa.project_id = t.project_id`. The table
                             is `public.project_assignments` and it has NO
                             project_id — it is keyed (team_id, user_id).

Its own extra fault: grouping by `pa.user_id` meant a person appeared only if
they had a `project_assignments` row, so anyone assigned a task without one was
invisible — a workload report that silently omits people is worse than no
report. It now groups by the assignees on the tasks themselves.

And, like `deadline_scanner`, it took `team_id` without `org_id`, so it was
refused at run time as unscopeable. `org_id` first; `team_id` optional and
additive.
"""
import logging
from datetime import timedelta

from services.skills.timeutil import utc_now

log = logging.getLogger(__name__)

#: Open tasks at which someone is considered fully loaded. A blunt instrument,
#: but the previous value was equally blunt and undocumented.
MAX_CAPACITY = 20

_ORG_TEAMS = (
    "t.team_id IN (SELECT team_id FROM teams "
    "WHERE org_id = $1::uuid AND deleted_at IS NULL)"
)


async def get_team_workload(pool, org_id: str, team_id: str | None = None) -> dict:
    """Workload per person across the org, or one team of it.

    Returns {user_id: {name, open, due_soon, overdue, capacity_pct}}.

    A task with several assignees counts once for EACH of them. That is the
    honest reading of shared work — three people on a task each have it on their
    plate — and the alternative, attributing it to whoever happens to be first
    in the array, would understate two of them.
    """
    now = utc_now()
    due_soon_cutoff = now + timedelta(hours=48)

    params = [org_id, now, due_soon_cutoff]
    team_clause = ""
    if team_id:
        params.append(team_id)
        team_clause = f"AND t.team_id = ${len(params)}"

    rows = await pool.fetch(
        f"""
        SELECT a.user_id,
               COALESCE(MAX(c.name), MAX(c.email), a.user_id)                    AS name,
               COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled'))      AS open,
               COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled')
                                AND t.due_at IS NOT NULL
                                AND t.due_at > $2 AND t.due_at <= $3)             AS due_soon,
               COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled')
                                AND t.due_at IS NOT NULL AND t.due_at < $2)       AS overdue
        FROM public.tasks t
        CROSS JOIN LATERAL unnest(t.assignee_user_ids) AS a(user_id)
        LEFT JOIN staging.user_org_context c
               ON c.user_id = a.user_id AND c.org_id = $1::uuid
        WHERE {_ORG_TEAMS}
          {team_clause}
          AND t.archived_at IS NULL
        GROUP BY a.user_id
        ORDER BY open DESC
        LIMIT 200
        """,
        *params,
    )

    result = {}
    for r in rows:
        open_count = r["open"]
        result[str(r["user_id"])] = {
            "name": r["name"],
            "open": open_count,
            "due_soon": r["due_soon"],
            "overdue": r["overdue"],
            "capacity_pct": round(min(open_count / MAX_CAPACITY * 100, 100)),
        }
    return result
