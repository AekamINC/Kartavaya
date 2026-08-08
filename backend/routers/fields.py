"""
fields.py — Custom field definitions and values
GET/POST/PUT/DELETE field_definitions per team
GET/PUT field_values per task
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
import uuid
from datetime import datetime, timezone

from auth_router import require_user
from db import get_pool
from middleware.roles import is_platform_staff, may_reach_project

router = APIRouter(prefix="/api/fields", tags=["fields"])


# ── Auth helpers ──────────────────────────────────────────────────────────────

async def _assert_team_member(pool, team_id: str, user: dict) -> None:
    """Raise 403 unless the caller may reach this project.

    THE FOURTH COPY of the membership-only project rule, and the one the
    2026-08-08 consolidation missed. The other three — task comments, time
    entries and `/api/activity/team/{id}` — moved to `may_reach_project`; this
    file kept its own `project_assignments` UNION `team_members` and so kept the
    original defect: an org's own administrator can LIST a task (that read is
    org-scoped through `get_visible_team_ids`) and is then refused the custom
    fields attached to it.

    The user-visible shape is worse here than a bare 403, because the drawer
    does not report it. `GET /team/{id}` and `GET /task/{id}/values` both fail,
    the field map stays empty, and the Details tab renders as a task with no
    priority, no status, no due date, no category and no assignees — a drawer
    that looks like an empty task rather than a refused request. Reported from
    staging as "none of the task is loading"; the list was never the problem.

    `may_reach_project` resolves the admin leg from `teams.org_id`, never from
    the caller's active org, so this admits an administrator to their own
    tenant's projects and to no one else's. See `middleware/roles.py:473`.
    """
    if await is_platform_staff(user["user_id"]):
        return
    if not await may_reach_project(pool, team_id, user["user_id"]):
        raise HTTPException(403, "Not a member of this project")


async def _team_id_for_field(pool, field_id: str) -> str:
    """Return the team_id for a field definition, or raise 404."""
    row = await pool.fetchrow(
        "SELECT team_id FROM field_definitions WHERE field_id=$1", field_id
    )
    if not row:
        raise HTTPException(404, "Field not found")
    return row["team_id"]


async def _team_id_for_task(pool, task_id: str) -> str:
    """Return the team_id for a task, or raise 404."""
    row = await pool.fetchrow(
        "SELECT team_id FROM tasks WHERE task_id=$1", task_id
    )
    if not row:
        raise HTTPException(404, "Task not found")
    return row["team_id"]

FIELD_TYPES = {
    "text", "textarea", "number", "date",
    "select", "dropdown",          # dropdown is alias for select
    "checkbox",
    "url",
    "person",
    "files",
    "status",
}


class FieldDefCreate(BaseModel):
    team_id: str
    name: str
    type: str
    config: dict = {}
    sort_order: int = 0


class FieldDefUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None
    sort_order: Optional[int] = None


class FieldValueSet(BaseModel):
    field_id: str
    value: Any


import json as _json

def _norm_field(r):
    row = dict(r)
    cfg = row.get("config")
    if isinstance(cfg, str):
        try: row["config"] = _json.loads(cfg)
        except Exception: row["config"] = {}
    elif cfg is None:
        row["config"] = {}
    return row


@router.get("/team/{team_id}")
async def list_field_definitions(team_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await _assert_team_member(pool, team_id, user)
    rows = await pool.fetch(
        "SELECT * FROM field_definitions WHERE team_id=$1 ORDER BY sort_order, created_at",
        team_id
    )
    return [_norm_field(r) for r in rows]


@router.get("/team/{team_id}/values")
async def list_team_field_values(team_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    """Every custom-field value for every task on a team, in ONE round trip.

    The table view renders a cell per (task × visible custom field), so it needs
    the whole matrix before it can paint. The only endpoint that existed was
    `GET /task/{task_id}/values`, so the board fanned out one request per task:
    a 200-task board opened 200 connections, each re-running the same
    `_assert_team_member` lookup, and the map was only committed to state after
    the slowest of them settled. `/boards` did not even do that — it never
    fetched values at all, so every custom-field cell there rendered blank.

    Shape is `{task_id: {field_id: value}}`, which is exactly what `TableView`
    indexes, so the client does no regrouping.

    Archived tasks are included deliberately: `ProjectBoardPage` can show them,
    and filtering them here would blank their cells in that mode.
    """
    await _assert_team_member(pool, team_id, user)
    rows = await pool.fetch(
        "SELECT fv.task_id, fv.field_id, fv.value "
        "FROM field_values fv "
        "JOIN tasks t ON t.task_id = fv.task_id "
        "WHERE t.team_id = $1",
        team_id
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        val = r["value"]
        # `db.py` registers a jsonb codec, but it logs "set_type_codec skipped
        # (PgBouncer)" and carries on when the pooler refuses it — in that mode
        # jsonb arrives as raw text. `_norm_field` already guards `config` the
        # same way; without the same guard here a checkbox field would reach the
        # renderer as the STRING "false", which is truthy.
        if isinstance(val, str):
            try: val = _json.loads(val)
            except Exception: pass
        out.setdefault(r["task_id"], {})[r["field_id"]] = val
    return out


@router.post("/")
async def create_field_definition(body: FieldDefCreate, pool=Depends(get_pool), user=Depends(require_user)):
    import json
    await _assert_team_member(pool, body.team_id, user)
    if body.type not in FIELD_TYPES:
        raise HTTPException(400, f"type must be one of {FIELD_TYPES}")
    field_id = f"fld_{uuid.uuid4().hex[:12]}"
    await pool.execute(
        "INSERT INTO field_definitions (field_id, team_id, name, type, config, sort_order) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
        field_id, body.team_id, body.name, body.type, json.dumps(body.config), body.sort_order
    )
    return {"field_id": field_id, **body.dict()}


@router.put("/{field_id}")
async def update_field_definition(field_id: str, body: FieldDefUpdate, pool=Depends(get_pool), user=Depends(require_user)):
    import json
    team_id = await _team_id_for_field(pool, field_id)
    await _assert_team_member(pool, team_id, user)
    updates, vals = [], []
    if body.name is not None:       updates.append(f"name=${len(vals)+2}");              vals.append(body.name)
    if body.config is not None:     updates.append(f"config=${len(vals)+2}::jsonb");     vals.append(json.dumps(body.config))
    if body.sort_order is not None: updates.append(f"sort_order=${len(vals)+2}");        vals.append(body.sort_order)
    if not updates:
        return {"ok": True}
    await pool.execute(f"UPDATE field_definitions SET {', '.join(updates)} WHERE field_id=$1", field_id, *vals)
    return {"ok": True}


@router.delete("/{field_id}")
async def delete_field_definition(field_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    team_id = await _team_id_for_field(pool, field_id)
    await _assert_team_member(pool, team_id, user)
    await pool.execute("DELETE FROM field_definitions WHERE field_id=$1", field_id)
    return {"ok": True}


@router.get("/task/{task_id}/values")
async def get_task_field_values(task_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    team_id = await _team_id_for_task(pool, task_id)
    await _assert_team_member(pool, team_id, user)
    rows = await pool.fetch(
        "SELECT fv.field_id, fv.value, fd.name, fd.type, fd.config FROM field_values fv JOIN field_definitions fd ON fd.field_id=fv.field_id WHERE fv.task_id=$1",
        task_id
    )
    return [dict(r) for r in rows]


@router.put("/task/{task_id}/values")
async def set_task_field_values(task_id: str, body: list[FieldValueSet], pool=Depends(get_pool), user=Depends(require_user)):
    import json
    team_id = await _team_id_for_task(pool, task_id)
    await _assert_team_member(pool, team_id, user)
    for fv in body:
        val = json.dumps(fv.value)
        await pool.execute(
            "INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3::jsonb) ON CONFLICT (task_id, field_id) DO UPDATE SET value=EXCLUDED.value",
            task_id, fv.field_id, val
        )
    # Log activity
    from services.activity_logger import log_event
    await log_event(pool, task_id=task_id, actor_id=user["user_id"], event_type="field_changed", data={"fields": [fv.field_id for fv in body]})
    return {"ok": True}
