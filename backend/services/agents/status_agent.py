"""
status_agent.py — Auto-advance a parent task when its checklist is finished.

WHAT THIS FILE USED TO DO, AND WHY IT COULD NOT HAVE WORKED
───────────────────────────────────────────────────────────
Three things were wrong, all measured against the live database on 2026-08-06
(project toacecaewujfxjfrjwco, read-only SELECTs, nothing written):

  1. It wrote `tasks.status = 'review'` — not one of the five statuses. The
     vocabulary is `services/task_transitions.py`: todo · in_progress ·
     in_review · done · requested. `review` is not `in_review`; the string
     belongs to a third vocabulary (`review`, `complete`, `closed`, `approved`)
     that exists in this file and its sibling and NOWHERE else in the backend.
  2. It never called `assert_transition`, so nothing checked the value, the
     `requested` edges, or the project approval gate.
  3. `SELECT … FROM tasks WHERE parent_task_id = $1` — **there is no
     `parent_task_id` column**. `public.tasks` has 40 columns and that is not
     one of them; the string appears in exactly two files in the whole backend,
     this one and `review_agent.py`. Subtasks are the JSONB `tasks.subtasks`
     array (`server.py:3718`: "subtasks are JSONB — no separate table
     migration needed"). Every run would have raised UndefinedColumnError on
     its first query, before reaching the illegal UPDATE.

So the bad value could never actually land — but "it crashes first" is not a
guard. The write is now routed through the one validator, and the read is
routed at the schema that exists.

THE THIRD VOCABULARY IS MAPPED, NOT ADDED
─────────────────────────────────────────
  `review`             → `in_review`   (the LINE state for finished-but-unblessed)
  `complete`, `closed` → `done`        (there is no separate closed state)
  `approved`           → NOT a status. It is `tasks.approval_status`, a real
                         column that really does take 'approved' (see
                         approvals_router). The two-tier behaviour the old code
                         wanted — "completed" vs "approved" — is preserved by
                         reading that column instead of inventing a sixth state.

So: a parent whose checklist is fully ticked moves to `in_review`, and only a
parent that has ALREADY been approved by a person moves to `done`. An agent
never grants the approval itself — `is_task_approver` answers False for a write
with no user behind it, deliberately (see the task_transitions docblock), and
that is exactly what this agent is.

Triggers: subtask_completed, subtask_status_changed
"""
import json
import logging
import uuid

from fastapi import HTTPException

from services.agents.base import BaseAgent
from services.task_transitions import LINE, assert_transition

logger = logging.getLogger(__name__)


def _col(row, key, default=None):
    """Read a column that may not exist on this database.

    Production and staging share one schema and migrations here are written,
    not applied, so a read path has to be correct on both sides of every
    migration. `approval_status` is present today (measured), but a missing
    column must degrade to "not approved", never to a 500.
    """
    try:
        if key in row:
            return row[key]
    except (KeyError, TypeError):
        pass
    return default


def _subtasks(raw) -> list:
    """`tasks.subtasks` is JSONB — a list of {subtask_id, title, is_done, order}.

    asyncpg hands back either a decoded list or the raw string depending on the
    codec registered on the pool, so both are accepted. Anything else is
    treated as "no checklist", which makes this agent a no-op rather than a
    crash.
    """
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return []
    return raw if isinstance(raw, list) else []


class StatusAgent(BaseAgent):
    name = "status_agent"
    description = "Advances a parent task when every subtask is ticked"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        task_id = context.get("task_id") or context.get("task", {}).get("task_id")
        if not task_id:
            return {"skipped": True, "reason": "no task_id"}

        parent = await pool.fetchrow(
            "SELECT status, team_id, subtasks, approval_status "
            "FROM tasks WHERE task_id = $1",
            task_id,
        )
        if not parent:
            return {"skipped": True, "reason": "parent not found"}

        subtasks = _subtasks(_col(parent, "subtasks"))
        if not subtasks:
            return {"skipped": True, "reason": "no subtasks"}

        total = len(subtasks)
        done_count = sum(1 for s in subtasks if isinstance(s, dict) and s.get("is_done"))
        if done_count < total:
            return {"action": "none", "done": done_count, "of": total}

        current = _col(parent, "status")

        # `approved` was the old code's second tier. It is not a status; it is
        # the decision a person already recorded on this task.
        approved = (_col(parent, "approval_status") or "") == "approved"
        target = "done" if approved else "in_review"

        # Only ever forward along the line. A task already at or past the target
        # is left alone — an agent that drags a finished task backwards because a
        # checklist was edited is a bug, not an automation. `current` outside the
        # line (`requested`, or anything a future migration adds) falls through to
        # the validator, which is the only thing allowed to have an opinion.
        if current in LINE and target in LINE and LINE.index(target) <= LINE.index(current):
            return {"action": "none", "current": current, "reason": "already at or past target"}

        try:
            await assert_transition(
                pool,
                old_status=current,
                new_status=target,
                team_id=_col(parent, "team_id"),
                user=None,  # no person is behind an agent — never an approver
            )
        except HTTPException as exc:
            # A refusal is a result, not a crash. `BaseAgent.execute` would log
            # this as an agent error and bury the reason in a stack trace.
            logger.info("status_agent: refused %s → %s: %s", task_id, target, exc.detail)
            return {"action": "refused", "from": current, "to": target, "reason": str(exc.detail)}

        await pool.execute(
            "UPDATE tasks SET status = $1, "
            "completed_at = CASE WHEN $1 = 'done' THEN NOW() ELSE NULL END, "
            "updated_at = NOW() WHERE task_id = $2",
            target, task_id,
        )
        logger.info("status_agent: task %s → %s (all %d subtasks ticked)", task_id, target, total)

        await pool.execute(
            "INSERT INTO task_comments (comment_id, task_id, user_id, body) VALUES ($1, $2, 'system', $3)",
            f"cmt_{uuid.uuid4().hex[:12]}", task_id,
            f"All {total} subtasks ticked — status auto-changed to **{target}**.",
        )

        return {"action": "status_changed", "from": current, "to": target, "subtasks": total}
