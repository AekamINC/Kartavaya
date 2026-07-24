"""
review_agent.py — Verify task completeness when status changes to 'done'.

Triggers: status_changed (filtered to to='done')
Checks: subtasks complete, time logged, required fields filled.
Auto-approves if all pass, else posts a system comment listing gaps.
"""
import uuid
import logging
from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)


class ReviewAgent(BaseAgent):
    name = "review_agent"
    description = "Validates task completeness on done transition"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        # Only act on transitions TO 'done'
        if context.get("to") != "done":
            return {"skipped": True, "reason": "not a done transition"}

        task_id = context.get("task_id") or context.get("task", {}).get("task_id")
        if not task_id:
            return {"skipped": True, "reason": "no task_id"}

        gaps = []

        # 1. Check subtasks
        open_subtasks = await pool.fetchval(
            """
            SELECT COUNT(*) FROM tasks
            WHERE parent_task_id = $1
              AND status NOT IN ('done', 'closed', 'cancelled', 'approved')
            """,
            task_id,
        )
        if open_subtasks and open_subtasks > 0:
            gaps.append(f"{open_subtasks} subtask(s) still open")

        # 2. Check time logged
        time_logged = await pool.fetchval(
            "SELECT COALESCE(SUM(minutes), 0) FROM time_entries WHERE task_id = $1",
            task_id,
        )
        if not time_logged or time_logged == 0:
            gaps.append("No time logged")

        # 3. Check required custom fields
        required_fields = await pool.fetch(
            """
            SELECT cf.field_id, cf.name
            FROM custom_fields cf
            JOIN tasks t ON t.team_id = cf.team_id
            WHERE t.task_id = $1 AND cf.required = TRUE
            """,
            task_id,
        )
        for field in required_fields:
            val = await pool.fetchval(
                "SELECT value FROM field_values WHERE task_id = $1 AND field_id = $2",
                task_id, field["field_id"],
            )
            if not val:
                gaps.append(f"Required field '{field['name']}' not filled")

        if gaps:
            body = "Review check failed before auto-approval:\n" + "\n".join(f"- {g}" for g in gaps)
            await pool.execute(
                "INSERT INTO task_comments (comment_id, task_id, user_id, body) VALUES ($1, $2, 'system', $3)",
                f"cmt_{uuid.uuid4().hex[:12]}", task_id, body,
            )
            logger.info("review_agent: task %s has %d gaps", task_id, len(gaps))
            return {"approved": False, "gaps": gaps}
        else:
            # Auto-approve
            await pool.execute(
                "UPDATE tasks SET status = 'approved', updated_at = NOW() WHERE task_id = $1",
                task_id,
            )
            await pool.execute(
                "INSERT INTO task_comments (comment_id, task_id, user_id, body) VALUES ($1, $2, 'system', $3)",
                f"cmt_{uuid.uuid4().hex[:12]}", task_id,
                "All checks passed — task auto-approved.",
            )
            logger.info("review_agent: task %s auto-approved", task_id)
            return {"approved": True}
