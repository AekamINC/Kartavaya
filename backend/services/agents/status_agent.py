"""
status_agent.py — Auto-transition task status based on subtask completion.

Triggers: subtask_completed, subtask_status_changed
Logic:
  - All subtasks done → task status = 'review'
  - All subtasks approved → task status = 'done'
"""
import logging
from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)


class StatusAgent(BaseAgent):
    name = "status_agent"
    description = "Auto-transitions task status when subtasks complete"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        task_id = context.get("task_id") or context.get("task", {}).get("task_id")
        if not task_id:
            return {"skipped": True, "reason": "no task_id"}

        # Fetch all subtasks for this parent
        subtasks = await pool.fetch(
            "SELECT status FROM tasks WHERE parent_task_id = $1", task_id
        )
        if not subtasks:
            return {"skipped": True, "reason": "no subtasks"}

        statuses = [r["status"] for r in subtasks]
        total = len(statuses)

        # Current parent status
        parent = await pool.fetchrow(
            "SELECT status FROM tasks WHERE task_id = $1", task_id
        )
        if not parent:
            return {"skipped": True, "reason": "parent not found"}

        current = parent["status"]

        # All subtasks approved/done → mark parent done
        all_approved = all(s in ("done", "approved", "closed") for s in statuses)
        # All subtasks at least completed → mark parent review
        all_completed = all(s in ("done", "approved", "closed", "review", "complete") for s in statuses)

        new_status = None
        if all_approved and current not in ("done", "closed"):
            new_status = "done"
        elif all_completed and not all_approved and current not in ("review", "done", "closed"):
            new_status = "review"

        if not new_status:
            return {"action": "none", "current": current, "subtask_statuses": statuses}

        await pool.execute(
            "UPDATE tasks SET status = $1, updated_at = NOW() WHERE task_id = $2",
            new_status, task_id,
        )
        logger.info("status_agent: task %s → %s (all %d subtasks qualify)", task_id, new_status, total)

        # Post system comment
        import uuid
        await pool.execute(
            "INSERT INTO task_comments (comment_id, task_id, user_id, body) VALUES ($1, $2, 'system', $3)",
            f"cmt_{uuid.uuid4().hex[:12]}", task_id,
            f"All {total} subtasks completed — status auto-changed to **{new_status}**.",
        )

        return {"action": "status_changed", "from": current, "to": new_status, "subtasks": total}
