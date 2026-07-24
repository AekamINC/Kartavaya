import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)


async def scan_upcoming_deadlines(pool, team_id: str, horizon_hours: int = 48) -> list:
    """Return tasks due within *horizon_hours* for a project/team.

    Each item: {task, assignee, hours_left}.
    """
    now = datetime.utcnow()
    cutoff = now + timedelta(hours=horizon_hours)

    rows = await pool.fetch(
        """
        SELECT t.id, t.title, t.due_date, t.assigned_to,
               COALESCE(u.name, u.email) AS assignee_name
        FROM staging.tasks t
        LEFT JOIN staging.user_roles u ON u.user_id = t.assigned_to
        WHERE t.project_id = $1::uuid
          AND t.status NOT IN ('done', 'cancelled')
          AND t.due_date IS NOT NULL
          AND t.due_date > $2
          AND t.due_date <= $3
          AND t.is_active = true
        ORDER BY t.due_date
        """,
        team_id, now, cutoff,
    )

    results = []
    for r in rows:
        hours_left = max(0, (r["due_date"] - now).total_seconds() / 3600)
        results.append({
            "task": {"id": str(r["id"]), "title": r["title"]},
            "assignee": str(r["assigned_to"]) if r["assigned_to"] else None,
            "assignee_name": r["assignee_name"],
            "hours_left": round(hours_left, 1),
        })
    return results
