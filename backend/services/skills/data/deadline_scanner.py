"""
deadline_scanner — tasks falling due inside a short horizon.

Wrong in five ways at once, and unreachable in a sixth. Verified against the
live catalog 2026-08-02 and corrected:

  staging.tasks       DOES NOT EXIST. Tasks are `public.tasks`.
  t.project_id        no such column, so the only filter it had was invalid.
  t.due_date          the column is `due_at`.
  t.is_active         no such column; the flag is `archived_at IS NULL`.
  t.assigned_to       no such column, and `user_id` — the obvious substitute —
                      is NULL on all 201 live task rows. Assignment lives in
                      `assignee_user_ids`, a text[], populated on 181 of them.
                      A handler reading `user_id` returns a null owner for every
                      task and looks like it worked.
  staging.user_roles  joined for `u.name, u.email`. That table has neither
                      column: it is (id, user_id, org_id, role_code, granted_by,
                      granted_at). Names live in `staging.user_org_context`.

And the sixth: it took `team_id` and no `org_id`, so `_run_function_step`
refuses it outright — a handler that cannot be scoped to one tenant, since a
caller could pass any team id in the database. It now takes `org_id` first and
treats `team_id` as an optional narrowing WITHIN that org, which is both
scopeable and more useful.
"""
import logging
from datetime import timedelta

from services.skills.timeutil import hours_between, utc_now

log = logging.getLogger(__name__)

#: `public.tasks` has no org_id. A task belongs to a TEAM and a team to an org.
#: Same clause `find_overdue`, `aggregate_kpis` and `dristi.py:187` use.
_ORG_TEAMS = (
    "t.team_id IN (SELECT team_id FROM teams "
    "WHERE org_id = $1::uuid AND deleted_at IS NULL)"
)


async def scan_upcoming_deadlines(
    pool, org_id: str, team_id: str | None = None, horizon_hours: int = 48
) -> list:
    """Tasks due within *horizon_hours*, across the org or one team of it.

    *team_id*: optional. When given it narrows to that team, but the org clause
    is applied REGARDLESS — so naming another tenant's team returns nothing
    rather than their tasks. The org filter is never replaced by the team
    filter, only added to.

    Each item: {task, assignees, assignee_names, hours_left}.
    """
    now = utc_now()
    cutoff = now + timedelta(hours=horizon_hours)

    params = [org_id, now, cutoff]
    team_clause = ""
    if team_id:
        params.append(team_id)
        team_clause = f"AND t.team_id = ${len(params)}"

    rows = await pool.fetch(
        f"""
        SELECT t.id, t.title, t.due_at, t.priority, t.status,
               t.assignee_user_ids,
               (SELECT string_agg(DISTINCT c.name, ', ')
                  FROM public.user_org_context c
                 WHERE c.user_id = ANY(t.assignee_user_ids)) AS assignee_names
        FROM public.tasks t
        WHERE {_ORG_TEAMS}
          {team_clause}
          AND t.status NOT IN ('done', 'cancelled')
          AND t.archived_at IS NULL
          AND t.due_at IS NOT NULL
          AND t.due_at > $2
          AND t.due_at <= $3
        ORDER BY t.due_at
        LIMIT 200
        """,
        *params,
    )

    return [
        {
            "task": {
                "id": str(r["id"]),
                "title": r["title"],
                "priority": r["priority"],
                "status": r["status"],
            },
            # A task can have several assignees, so this is a list. The previous
            # shape promised a single `assignee` and delivered None every time.
            "assignees": list(r["assignee_user_ids"] or []),
            "assignee_names": r["assignee_names"] or "unassigned",
            "hours_left": round(max(0.0, hours_between(r["due_at"], now)), 1),
        }
        for r in rows
    ]
