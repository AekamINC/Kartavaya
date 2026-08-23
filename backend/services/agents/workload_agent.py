"""
workload_agent.py — Check assignee workload on task assignment.

Triggers: task_assigned
Flags if any assignee has >15 open tasks and posts a system comment.
"""
import uuid
import logging
from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

OVERLOAD_THRESHOLD = 15


class WorkloadAgent(BaseAgent):
    name = "workload_agent"
    description = "Flags overloaded assignees on task assignment"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        task_id = context.get("task_id") or context.get("task", {}).get("task_id")
        assignees = context.get("assignee_user_ids") or context.get("added") or []

        if not task_id or not assignees:
            return {"skipped": True, "reason": "no task or assignees"}

        flagged = []
        for uid in assignees:
            count = await pool.fetchval(
                """
                SELECT COUNT(*) FROM tasks
                WHERE $1 = ANY(assignee_user_ids)
                  AND status NOT IN ('done', 'closed', 'cancelled')
                """,
                uid,
            )
            if count and count > OVERLOAD_THRESHOLD:
                flagged.append({"user_id": uid, "open_tasks": count})

                # Notify the user
                await pool.execute(
                    """
                    INSERT INTO notifications
                        (notification_id, user_id, type, title, message, task_id, org_id)
                    VALUES ($1, $2, 'workload_warning', $3, $4, $5, (SELECT org_id FROM tasks WHERE task_id=$5))
                    """,
                    f"notif_{uuid.uuid4().hex[:12]}", uid,
                    "High workload",
                    f"You now have {count} open tasks. Consider delegating or reprioritizing.",
                    task_id,
                )

        if flagged:
            names = []
            for f in flagged:
                row = await pool.fetchrow("SELECT full_name FROM users WHERE user_id = $1", f["user_id"])
                name = row["full_name"] if row else f["user_id"]
                names.append(f"{name} ({f['open_tasks']} open)")

            await pool.execute(
                "INSERT INTO task_comments (comment_id, task_id, user_id, body, org_id) VALUES ($1, $2, 'system', $3, (SELECT org_id FROM tasks WHERE task_id=$2))",
                f"cmt_{uuid.uuid4().hex[:12]}", task_id,
                f"Workload alert: {', '.join(names)} — consider rebalancing.",
            )

        return {"flagged": flagged}
