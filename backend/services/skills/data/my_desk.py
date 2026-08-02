"""
my_desk — what is on one person's plate right now.

── Why this is FREE, and why the follow-ups leg is NOT here ───────────────────

The obvious design fuses three things: your tasks, your approvals, and your
overdue CRM follow-ups. It is the wrong design, because of how access works.

`services/skills/modules.py` requires the caller to hold EVERY module a skill
names, and the run is refused otherwise. Follow-ups are `graha`. So a fused
handler would have to declare `{"graha"}`, and a core-PM user — someone who
lives in tasks and has never opened the CRM — would be refused their own task
list. Refusing somebody their own desk to protect data they did not ask for is
the gate working against the user.

So this handler is core PM only and declares FREE. The follow-ups leg already
exists as the registered `find_overdue_followups`, declared `{"graha"}`, and a
template that wants both simply carries both steps: the CRM step is refused or
returned on its own merits, and the tasks step always works.

── Two approval sources, because neither is complete ──────────────────────────

`/approvals/pending` (`server.py:1507-1543`) reads `public.approvals` AND
`tasks.approval_status`, and it needs both — they are different mechanisms.
Copied rather than reinvented, with one correction: that endpoint INNER JOINs
`users` on `requested_by`, and `requested_by` is absent from `public.users` on 4
of the 5 live approval rows, so the live endpoint hides 80% of that table. A
LEFT JOIN here, with the id as the fallback label.

Leg B returns 0 today: no approval anywhere is `pending`, and `approval_status`
is NULL on 240 of 244 task rows. Shipped anyway — the query is proven and it
populates on the first Request Approval click. An empty section that is
correctly empty is not a reason to omit the section.
"""
import logging
from datetime import timedelta

from services.skills.timeutil import utc_now

log = logging.getLogger(__name__)

_ORG_TEAMS = (
    "SELECT team_id FROM teams WHERE org_id = $1::uuid AND deleted_at IS NULL"
)


async def get_my_desk(pool, org_id: str, user_id: str, horizon_days: int = 7) -> dict:
    """One person's open work: tasks due or overdue, and approvals awaiting them.

    *user_id* has no default, so a step that omits it fails closed in
    `_run_function_step` rather than silently reporting somebody else's desk.

    Returns {user_id, horizon_days, tasks: [...], approvals: [...]}.
    """
    now = utc_now()
    horizon = now + timedelta(days=horizon_days)

    # Assignment is `assignee_user_ids` (text[]). `user_id` exists on this table
    # and is NULL on all 201 live rows — reading it returns an empty desk for
    # everybody and looks like it worked.
    tasks = await pool.fetch(
        f"""
        SELECT t.task_id, t.title, t.status, t.priority, t.due_at, t.team_id,
               tm.name AS team_name,
               (t.due_at < $3) AS is_overdue
        FROM tasks t
        JOIN teams tm ON tm.team_id = t.team_id
        WHERE t.team_id IN ({_ORG_TEAMS})
          AND $2 = ANY(t.assignee_user_ids)
          AND t.archived_at IS NULL
          AND t.status NOT IN ('done','cancelled')
          AND t.due_at IS NOT NULL
          AND t.due_at < $4
        ORDER BY t.due_at ASC
        LIMIT 200
        """,
        org_id, user_id, now, horizon,
    )

    approvals = await pool.fetch(
        f"""
        WITH org_teams AS ({_ORG_TEAMS})
        SELECT a.approval_id, a.request_type,
               COALESCE(a.request_data->>'title','(untitled)') AS title,
               a.created_at AS requested_at, a.team_id,
               COALESCE(u.full_name, u.name, u.email, a.requested_by) AS requested_by
        FROM public.approvals a
        LEFT JOIN users u ON u.user_id = a.requested_by
        WHERE a.team_id IN (SELECT team_id FROM org_teams)
          AND a.status = 'pending'
          AND EXISTS (SELECT 1 FROM project_assignments pa
                      WHERE pa.team_id = a.team_id AND pa.user_id = $2
                        AND pa.role IN ('owner','admin'))
        UNION ALL
        SELECT CONCAT('task_approval--', t.task_id), 'task_completion', t.title,
               t.approval_requested_at, t.team_id,
               COALESCE(u.full_name, u.name, u.email, t.created_by_user_id)
        FROM tasks t
        LEFT JOIN users u ON u.user_id = t.created_by_user_id
        WHERE t.team_id IN (SELECT team_id FROM org_teams)
          AND t.approval_status IN ('pending','pending_client')
          AND t.archived_at IS NULL
          AND (EXISTS (SELECT 1 FROM project_assignments pa
                       WHERE pa.team_id = t.team_id AND pa.user_id = $2
                         AND pa.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM team_members tmem
                       WHERE tmem.team_id = t.team_id AND tmem.user_id = $2
                         AND tmem.role IN ('owner','admin') AND tmem.status = 'active'))
        ORDER BY requested_at DESC NULLS LAST
        LIMIT 200
        """,
        org_id, user_id,
    )

    return {
        "user_id": user_id,
        "horizon_days": horizon_days,
        "tasks": [
            {
                "id": r["task_id"],
                "title": r["title"],
                "status": r["status"],
                "priority": r["priority"],
                "project": r["team_name"],
                "due_at": r["due_at"].isoformat() if r["due_at"] else None,
                "is_overdue": r["is_overdue"],
            }
            for r in tasks
        ],
        "approvals": [
            {
                "id": r["approval_id"],
                "kind": r["request_type"],
                "title": r["title"],
                "requested_by": r["requested_by"],
                "requested_at": r["requested_at"].isoformat() if r["requested_at"] else None,
            }
            for r in approvals
        ],
    }
