"""
automations.py — Automation rules CRUD + manual trigger
Triggers: task_created, status_changed, field_changed, assigned,
          due_date_approaching, task_overdue, comment_added, approval_status_changed
Actions: send_email, send_notification, set_field, change_status, assign_to, post_comment
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone

from auth_router import require_user
from db import get_pool
from middleware.roles import is_platform_staff

router = APIRouter(prefix="/api/automations", tags=["automations"])

VALID_TRIGGERS = {
    "task_created", "status_changed", "field_changed", "assigned",
    "due_date_approaching", "task_overdue", "comment_added", "approval_status_changed"
}
VALID_ACTIONS = {
    "send_email", "send_notification", "set_field",
    "change_status", "assign_to", "post_comment"
}


class AutomationCreate(BaseModel):
    team_id: str
    name: str
    trigger: dict   # {event: str, filters: [...]}
    actions: list   # [{type: str, config: {...}}]
    enabled: bool = True


class AutomationUpdate(BaseModel):
    name: Optional[str] = None
    trigger: Optional[dict] = None
    actions: Optional[list] = None
    enabled: Optional[bool] = None


@router.get("/team/{team_id}")
async def list_automations(team_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    """Return all automations for the given team."""
    if not await is_platform_staff(user["user_id"]):
        member = await pool.fetchrow(
            "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' "
            "UNION ALL "
            "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 "
            "LIMIT 1",
            team_id, user["user_id"],
        )
        if not member:
            raise HTTPException(403, "Not a member of this project")
    rows = await pool.fetch(
        "SELECT * FROM automations WHERE team_id=$1 ORDER BY created_at DESC",
        team_id
    )
    return [dict(r) for r in rows]


@router.post("/")
async def create_automation(body: AutomationCreate, pool=Depends(get_pool), user=Depends(require_user)):
    """Create a new automation rule for the given team."""
    # Verify the caller is an active member of the target team
    member = await pool.fetchrow(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        body.team_id, user["user_id"],
    )
    if not member:
        raise HTTPException(403, "You are not a member of this project")
    # A RULE IS A TASK WRITE WITH A DELAY ON IT. `change_status` and
    # `assign_user` (services/automation_engine.py) run detached with
    # `user=None`, so the author is the only person the question can ever be
    # asked of — after this row is written there is nobody standing there.
    # "when priority is urgent → change_status done" is a rule-shaped way for a
    # read-only client to mark the firm's work done.
    from services.task_actor import assert_may_write_task
    await assert_may_write_task(pool, team_id=body.team_id, user=user)
    # Structural validation: trigger must be a dict, actions a non-empty list of dicts
    if not isinstance(body.trigger, dict):
        raise HTTPException(400, "trigger must be an object")
    if not isinstance(body.actions, list) or len(body.actions) == 0:
        raise HTTPException(400, "actions must be a non-empty list")
    for action in body.actions:
        if not isinstance(action, dict):
            raise HTTPException(400, "each action must be an object")
    if body.trigger.get("event") not in VALID_TRIGGERS:
        raise HTTPException(400, f"trigger.event must be one of {sorted(VALID_TRIGGERS)}")
    for action in body.actions:
        if action.get("type") not in VALID_ACTIONS:
            raise HTTPException(400, f"action.type must be one of {sorted(VALID_ACTIONS)}")
    auto_id = f"auto_{uuid.uuid4().hex[:12]}"
    await pool.execute(
        "INSERT INTO automations (automation_id, team_id, name, trigger, actions, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        auto_id, body.team_id, body.name, body.trigger, body.actions, body.enabled, user["user_id"]
    )
    return {"automation_id": auto_id, **body.dict()}


async def _check_automation_access(pool, automation_id: str, user: dict):
    """Raises 403/404 if the caller may not edit this automation.

    Takes the whole `user` dict rather than a bare id so it can ask the same
    write question `create_automation` asks — editing a rule's `actions` is
    authoring it again, and a guard on create that the update route walks around
    is not a guard.
    """
    user_id = user["user_id"]
    automation = await pool.fetchrow("SELECT team_id FROM automations WHERE automation_id=$1", automation_id)
    if not automation:
        raise HTTPException(404, "Automation not found")
    member = await pool.fetchrow(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        automation["team_id"], user_id
    )
    if not member:
        raise HTTPException(403, "You are not a member of this project")
    from services.task_actor import assert_may_write_task
    await assert_may_write_task(pool, team_id=automation["team_id"], user=user)
    return automation


@router.put("/{automation_id}")
async def update_automation(automation_id: str, body: AutomationUpdate, pool=Depends(get_pool), user=Depends(require_user)):
    """Update the name, trigger, actions, or enabled flag of an existing automation."""
    await _check_automation_access(pool, automation_id, user)
    updates, vals = [], []
    if body.name is not None:    updates.append(f"name=${len(vals)+2}");    vals.append(body.name)
    if body.trigger is not None: updates.append(f"trigger=${len(vals)+2}"); vals.append(body.trigger)
    if body.actions is not None: updates.append(f"actions=${len(vals)+2}"); vals.append(body.actions)
    if body.enabled is not None: updates.append(f"enabled=${len(vals)+2}"); vals.append(body.enabled)
    if updates:
        await pool.execute(f"UPDATE automations SET {', '.join(updates)} WHERE automation_id=$1", automation_id, *vals)
    return {"ok": True}


@router.delete("/{automation_id}")
async def delete_automation(automation_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    """Delete an automation rule by ID."""
    await _check_automation_access(pool, automation_id, user)
    await pool.execute("DELETE FROM automations WHERE automation_id=$1", automation_id)
    return {"ok": True}


@router.post("/{automation_id}/run")
async def run_automation_manually(automation_id: str, context: dict, pool=Depends(get_pool), user=Depends(require_user)):
    """Manually trigger an automation for testing."""
    automation = await pool.fetchrow("SELECT * FROM automations WHERE automation_id=$1", automation_id)
    if not automation:
        raise HTTPException(404, "Automation not found")
    member = await pool.fetchrow(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        automation["team_id"], user["user_id"]
    )
    if not member:
        raise HTTPException(403, "You are not a member of this project")
    # Firing a rule by hand EXECUTES its actions now, against a caller-supplied
    # context. That is the write itself, not the authoring of one.
    from services.task_actor import assert_may_write_task
    await assert_may_write_task(pool, team_id=automation["team_id"], user=user)
    from services.automation_engine import run_automation
    result = await run_automation(dict(automation), context, pool)
    await pool.execute(
        "UPDATE automations SET last_run_at=NOW(), run_count=run_count+1 WHERE automation_id=$1",
        automation_id
    )
    return {"ok": True, "result": result}
