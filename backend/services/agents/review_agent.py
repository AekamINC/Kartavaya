"""
review_agent.py — Report what is missing when a task is marked done.

WHAT CHANGED, AND WHY
─────────────────────
This file used to end with:

    UPDATE tasks SET status = 'approved' … -- "auto-approve"

Three separate things were wrong with that line, all measured against the live
database on 2026-08-06 (read-only SELECTs, nothing written):

  1. `approved` is not a task status. The five are todo · in_progress ·
     in_review · done · requested (`services/task_transitions.py`), and
     migration 117 §4 adds a CHECK that refuses anything else outright.
  2. It never called `assert_transition`, so no validator saw the value.
  3. **An agent cannot approve.** `tasks.approval_status` is the column that
     really does take 'approved', and every legitimate writer of it records an
     `approved_by` person (approvals_router, server.py). `task_transitions`
     answers `is_task_approver(user=None)` with False on purpose: "a robot is
     not an approver". An agent stamping an approval would be the approval gate
     being walked around from the inside — the same shape of hole the bulk
     route had, only quieter, because the row would read as blessed by nobody.

So the auto-approval is GONE rather than translated. What survives is the part
that was always sound and always safe: say what is missing, in a comment, and
let a person decide. This agent now writes no status and no approval — the only
row it creates is a `task_comments` row.

THE QUERIES WERE ALSO AIMED AT A SCHEMA THAT DOES NOT EXIST
───────────────────────────────────────────────────────────
  · `WHERE parent_task_id = $1` — `public.tasks` has no `parent_task_id`
    column, and the name appears in exactly two files in the backend: this one
    and `status_agent.py`. Subtasks are the JSONB `tasks.subtasks` array
    (`server.py:3718`). Every run raised UndefinedColumnError on its first
    query. Fixed to read the JSONB.
  · `JOIN custom_fields cf` — there is no `custom_fields` TABLE either;
    `custom_fields` is a JSONB column on `tasks`, and the definitions table is
    `field_definitions` (field_id, team_id, name, type, config, sort_order).
    It has no `required` column, so requiredness is read from `config`. Nothing
    writes `config.required` today, so that gap check finds nothing until
    something does — it is wired at the real table rather than left pointing at
    a table that has never existed.

Triggers: status_changed (filtered to to='done')
"""
import json
import logging
import uuid

from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

#: A subtask is a JSONB entry with `is_done`. Everything else about it is
#: display. There is no per-subtask status and no per-subtask approval.
def _subtasks(raw) -> list:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return []
    return raw if isinstance(raw, list) else []


def _col(row, key, default=None):
    try:
        if key in row:
            return row[key]
    except (KeyError, TypeError):
        pass
    return default


class ReviewAgent(BaseAgent):
    name = "review_agent"
    description = "Reports completeness gaps when a task is marked done"
    module = "kaam"

    async def run(self, pool, org_id: str, context: dict) -> dict:
        # Only act on transitions TO 'done'
        if context.get("to") != "done":
            return {"skipped": True, "reason": "not a done transition"}

        task_id = context.get("task_id") or context.get("task", {}).get("task_id")
        if not task_id:
            return {"skipped": True, "reason": "no task_id"}

        task = await pool.fetchrow(
            "SELECT team_id, subtasks FROM tasks WHERE task_id = $1", task_id
        )
        if not task:
            return {"skipped": True, "reason": "task not found"}

        gaps = []

        # 1. Unticked subtasks
        open_subtasks = sum(
            1 for s in _subtasks(_col(task, "subtasks"))
            if isinstance(s, dict) and not s.get("is_done")
        )
        if open_subtasks:
            gaps.append(f"{open_subtasks} subtask(s) still open")

        # 2. Time logged
        time_logged = await pool.fetchval(
            "SELECT COALESCE(SUM(minutes), 0) FROM time_entries WHERE task_id = $1",
            task_id,
        )
        if not time_logged:
            gaps.append("No time logged")

        # 3. Required custom fields. Inert until something writes
        #    `field_definitions.config->>'required'` — see the docblock.
        team_id = _col(task, "team_id")
        if team_id:
            required_fields = await pool.fetch(
                """
                SELECT field_id, name FROM field_definitions
                WHERE team_id = $1 AND COALESCE(config->>'required','false') = 'true'
                """,
                team_id,
            )
            for field in required_fields:
                val = await pool.fetchval(
                    "SELECT value FROM field_values WHERE task_id = $1 AND field_id = $2",
                    task_id, field["field_id"],
                )
                if not val:
                    gaps.append(f"Required field '{field['name']}' not filled")

        if gaps:
            body = "Completeness check on this task found:\n" + "\n".join(f"- {g}" for g in gaps)
            logger.info("review_agent: task %s has %d gaps", task_id, len(gaps))
        else:
            body = "Completeness check passed — subtasks ticked, time logged, fields filled."
            logger.info("review_agent: task %s is complete", task_id)

        await pool.execute(
            "INSERT INTO task_comments (comment_id, task_id, user_id, body) VALUES ($1, $2, 'system', $3)",
            f"cmt_{uuid.uuid4().hex[:12]}", task_id, body,
        )

        # No status write, no approval write. The approval decision belongs to a
        # person, through Approvals; see the docblock.
        return {"complete": not gaps, "gaps": gaps}
