"""
views.py — Saved views (kanban / table / calendar configs per team)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid

from auth_router import require_user
from db import get_pool
from middleware.roles import is_platform_staff


router = APIRouter(prefix="/api/views", tags=["views"])


async def _assert_team_access(pool, team_id: str, user: dict):
    if await is_platform_staff(user["user_id"]):
        return
    # PROJECT membership, one table since migration 195 made
    # `project_assignments` a strict superset of active `team_members`.
    # Canonical note: `middleware/roles.may_reach_project`.
    row = await pool.fetchrow(
        "SELECT 1 FROM public.project_assignments "
        "WHERE team_id=$1 AND user_id=$2 LIMIT 1",
        team_id, user["user_id"],
    )
    if not row:
        raise HTTPException(403, "Not a member of this project")


class ViewCreate(BaseModel):
    team_id: str
    name: str
    type: str   # kanban | table | calendar
    config: dict = {}
    is_default: bool = False


class ViewUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None
    is_default: Optional[bool] = None


@router.get("/team/{team_id}")
async def list_views(team_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await _assert_team_access(pool, team_id, user)
    rows = await pool.fetch(
        "SELECT * FROM saved_views WHERE team_id=$1 ORDER BY is_default DESC, created_at",
        team_id
    )
    return [dict(r) for r in rows]


@router.post("/")
async def create_view(body: ViewCreate, pool=Depends(get_pool), user=Depends(require_user)):
    await _assert_team_access(pool, body.team_id, user)
    if body.type not in {"kanban", "table", "calendar"}:
        raise HTTPException(400, "type must be kanban, table, or calendar")
    view_id = f"view_{uuid.uuid4().hex[:12]}"
    if body.is_default:
        await pool.execute("UPDATE saved_views SET is_default=FALSE WHERE team_id=$1", body.team_id)
    await pool.execute(
        "INSERT INTO saved_views (view_id, team_id, name, type, config, created_by, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        view_id, body.team_id, body.name, body.type, body.config, user["user_id"], body.is_default
    )
    return {"view_id": view_id, **body.dict()}


@router.put("/{view_id}")
async def update_view(view_id: str, body: ViewUpdate, pool=Depends(get_pool), user=Depends(require_user)):
    view = await pool.fetchrow("SELECT team_id FROM saved_views WHERE view_id=$1", view_id)
    if not view:
        raise HTTPException(404, "View not found")
    await _assert_team_access(pool, view["team_id"], user)
    updates, vals = [], []
    if body.name is not None:       updates.append(f"name=${len(vals)+2}");       vals.append(body.name)
    if body.config is not None:     updates.append(f"config=${len(vals)+2}");     vals.append(body.config)
    if body.is_default is not None:
        if body.is_default:
            await pool.execute("UPDATE saved_views SET is_default=FALSE WHERE team_id=$1", view["team_id"])
        updates.append(f"is_default=${len(vals)+2}"); vals.append(body.is_default)
    if updates:
        await pool.execute(f"UPDATE saved_views SET {', '.join(updates)} WHERE view_id=$1", view_id, *vals)
    return {"ok": True}


@router.delete("/{view_id}")
async def delete_view(view_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    view = await pool.fetchrow("SELECT team_id FROM saved_views WHERE view_id=$1", view_id)
    if not view:
        raise HTTPException(404, "View not found")
    await _assert_team_access(pool, view["team_id"], user)
    await pool.execute("DELETE FROM saved_views WHERE view_id=$1", view_id)
    return {"ok": True}
