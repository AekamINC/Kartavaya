"""
activity_logger.py — Write activity events on every mutation.
Call log_event() from any router after a successful DB write.
Week 2: added assign_changed + field_changed helpers.
"""
import json
import uuid
from typing import Optional
import logging

log = logging.getLogger(__name__)


async def log_event(
    pool,
    *,
    task_id: Optional[str] = None,
    team_id: Optional[str] = None,
    actor_id: str,
    event_type: str,
    data: dict = None,
):
    """
    Persist an activity event.
    team_id is resolved from the task when not supplied.
    Silently swallows errors — logging must never crash the main request.
    """
    try:
        resolved_team_id = team_id
        if not resolved_team_id and task_id:
            row = await pool.fetchrow("SELECT team_id FROM tasks WHERE task_id=$1", task_id)
            if row:
                resolved_team_id = row["team_id"]

        if not resolved_team_id:
            return  # skip logging for personal tasks — team_id NOT NULL constraint

        event_id = f"evt_{uuid.uuid4().hex[:14]}"
        _org = await pool.fetchval(
            "SELECT org_id::text FROM public.teams WHERE team_id=$1",
            resolved_team_id) if resolved_team_id else None
        await pool.execute(
            """
            INSERT INTO activity_events (event_id, task_id, team_id, actor_id, type, data, org_id)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::uuid)
            """,
            event_id,
            task_id,
            resolved_team_id,
            actor_id,
            event_type,
            json.dumps(data or {}),
            _org,
        )
    except Exception as exc:
        log.warning("activity_logger swallowed error: %s", exc, exc_info=True)


async def log_assigned(pool, *, task_id: str, actor_id: str, added: list, removed: list):
    """Log an 'assigned' event whenever assignee_user_ids change."""
    if not added and not removed:
        return
    await log_event(
        pool,
        task_id=task_id,
        actor_id=actor_id,
        event_type="assigned",
        data={"added": added, "removed": removed},
    )


async def log_field_changed(pool, *, task_id: str, actor_id: str, field_name: str, from_val, to_val):
    """Log a 'field_changed' event."""
    await log_event(
        pool,
        task_id=task_id,
        actor_id=actor_id,
        event_type="field_changed",
        data={"field": field_name, "from": from_val, "to": to_val},
    )
