import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

MAX_CAPACITY = 20  # default max open tasks per person


async def get_team_workload(pool, team_id: str) -> dict:
    """Return workload stats per user in a team (project).

    Returns dict keyed by user_id with {open, due_soon, overdue, capacity_pct}.
    """
    now = datetime.utcnow()
    due_soon_cutoff = now + timedelta(hours=48)

    rows = await pool.fetch(
        """
        SELECT
            pa.user_id,
            COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled'))                           AS open,
            COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled')
                             AND t.due_date IS NOT NULL AND t.due_date <= $2
                             AND t.due_date > $1)                                                    AS due_soon,
            COUNT(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled')
                             AND t.due_date IS NOT NULL AND t.due_date < $1)                         AS overdue
        FROM staging.tasks t
        JOIN staging.project_assignments pa ON pa.project_id = t.project_id AND pa.user_id = t.assigned_to
        WHERE t.project_id = $3::uuid
          AND t.is_active = true
        GROUP BY pa.user_id
        """,
        now, due_soon_cutoff, team_id,
    )

    result = {}
    for r in rows:
        open_count = r["open"]
        result[str(r["user_id"])] = {
            "open": open_count,
            "due_soon": r["due_soon"],
            "overdue": r["overdue"],
            "capacity_pct": round(min(open_count / MAX_CAPACITY * 100, 100)),
        }
    return result
