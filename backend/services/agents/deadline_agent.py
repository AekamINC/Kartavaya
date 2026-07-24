"""
deadline_agent.py — Hourly cron agent for deadline warnings and escalation.

Runs via /cron/agents. Finds tasks due within 48h, sends warnings at
48h / 24h / overdue thresholds. Escalates overdue tasks to the
assignee's manager via manav_employees.reporting_to.
"""
import uuid
import logging
from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)


class DeadlineAgent(BaseAgent):
    name = "deadline_agent"
    description = "Sends deadline warnings and escalates overdue tasks"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        warnings_sent = 0
        escalations = 0

        # Tasks due within 48h that are still open
        tasks = await pool.fetch(
            """
            SELECT t.task_id, t.title, t.due_date, t.status,
                   t.assignee_user_ids, t.team_id
            FROM tasks t
            JOIN teams tm ON tm.team_id = t.team_id
            WHERE tm.org_id = $1
              AND t.due_date IS NOT NULL
              AND t.status NOT IN ('done', 'closed', 'cancelled')
              AND t.due_date <= NOW() + INTERVAL '48 hours'
            ORDER BY t.due_date ASC
            LIMIT 500
            """,
            org_id,
        )

        for task in tasks:
            task = dict(task)
            assignees = task.get("assignee_user_ids") or []
            if not assignees:
                continue

            due = task["due_date"]
            # Determine warning level
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if due.tzinfo is None:
                from datetime import timezone as tz
                due = due.replace(tzinfo=tz.utc)

            hours_left = (due - now).total_seconds() / 3600

            if hours_left < 0:
                level = "overdue"
                msg = f"Task **{task['title']}** is overdue."
            elif hours_left <= 24:
                level = "24h"
                msg = f"Task **{task['title']}** is due within 24 hours."
            else:
                level = "48h"
                msg = f"Task **{task['title']}** is due within 48 hours."

            # Check if we already warned at this level today
            already = await pool.fetchval(
                """
                SELECT 1 FROM notifications
                WHERE task_id = $1 AND type = 'deadline_warning'
                  AND metadata->>'level' = $2
                  AND created_at > NOW() - INTERVAL '20 hours'
                LIMIT 1
                """,
                task["task_id"], level,
            )
            if already:
                continue

            # Send notification to each assignee
            for uid in assignees:
                await pool.execute(
                    """
                    INSERT INTO notifications
                        (notification_id, user_id, type, title, message, task_id, metadata)
                    VALUES ($1, $2, 'deadline_warning', $3, $4, $5, $6::jsonb)
                    """,
                    f"notif_{uuid.uuid4().hex[:12]}", uid,
                    f"Deadline {level}", msg, task["task_id"],
                    __import__("json").dumps({"level": level}),
                )
                warnings_sent += 1

            # Escalate overdue to manager
            if level == "overdue":
                for uid in assignees:
                    manager_id = await pool.fetchval(
                        """
                        SELECT me2.user_id
                        FROM manav_employees me
                        JOIN manav_employees me2 ON me2.employee_id = me.reporting_to
                        WHERE me.user_id = $1 AND me.org_id = $2
                        """,
                        uid, org_id,
                    )
                    if manager_id and manager_id not in assignees:
                        await pool.execute(
                            """
                            INSERT INTO notifications
                                (notification_id, user_id, type, title, message, task_id, metadata)
                            VALUES ($1, $2, 'deadline_escalation', $3, $4, $5, $6::jsonb)
                            """,
                            f"notif_{uuid.uuid4().hex[:12]}", manager_id,
                            "Overdue escalation",
                            f"Task **{task['title']}** assigned to your report is overdue.",
                            task["task_id"],
                            __import__("json").dumps({"level": "escalation", "assignee": uid}),
                        )
                        escalations += 1

        return {"warnings_sent": warnings_sent, "escalations": escalations}
