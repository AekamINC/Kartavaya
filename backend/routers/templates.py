"""
templates.py — Project and task templates (CRUD + apply)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid, json

from auth_router import require_user
from db import get_pool
from middleware.roles import is_platform_staff

router = APIRouter(prefix="/api/templates", tags=["templates"])

_TEMPLATE_NOT_FOUND = "Template not found"


# ── Shared helpers ───────────────────────────────────────────────────────────────

async def _is_team_member(pool, team_id: str, user_id: str) -> bool:
    row = await pool.fetchrow("""
        SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'
        UNION
        SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2
    """, team_id, user_id)
    return row is not None


async def _assert_team_member(pool, team_id: str, user_id: str):
    if not await _is_team_member(pool, team_id, user_id):
        raise HTTPException(403, "Not a member of this team")


async def _assert_can_modify(pool, tmpl, user):
    """Raise 403 if user may not edit/delete the template row."""
    if await is_platform_staff(user["user_id"]):
        return
    if tmpl["team_id"]:
        await _assert_team_member(pool, tmpl["team_id"], user["user_id"])
    else:
        if tmpl["created_by"] != user["user_id"]:
            raise HTTPException(403, "Not authorised")


# ── Models ───────────────────────────────────────────────────────────────────────

class ProjectTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    config: dict  # {columns, fields, sample_tasks}


class TaskTemplateCreate(BaseModel):
    name: str
    team_id: Optional[str] = None
    config: dict  # {title_pattern, description, priority, default_assignees, ...}


class TaskTemplateBody(BaseModel):
    name: str
    team_id: Optional[str] = None
    icon: str = "📋"
    is_default: bool = False
    config: dict  # title, description, priority, subtasks[], attachments[], tags[], category_id, custom_fields{}


# ── Project templates ─────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_project_templates(pool=Depends(get_pool), user=Depends(require_user)):
    if await is_platform_staff(user["user_id"]):
        rows = await pool.fetch("SELECT * FROM project_templates ORDER BY created_at DESC")
    else:
        rows = await pool.fetch(
            "SELECT * FROM project_templates WHERE created_by=$1 ORDER BY created_at DESC",
            user["user_id"],
        )
    return [dict(r) for r in rows]


@router.post("/projects")
async def create_project_template(body: ProjectTemplateCreate, pool=Depends(get_pool), user=Depends(require_user)):
    tid = f"ptmpl_{uuid.uuid4().hex[:10]}"
    row = await pool.fetchrow(
        "INSERT INTO project_templates (template_id, name, description, config, created_by) "
        "VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *",
        tid, body.name, body.description, json.dumps(body.config), user["user_id"]
    )
    return dict(row)


@router.delete("/projects/{template_id}")
async def delete_project_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    tmpl = await pool.fetchrow("SELECT created_by FROM project_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    if tmpl["created_by"] != user["user_id"] and not await is_platform_staff(user["user_id"]):
        raise HTTPException(403, "Not authorised")
    await pool.execute("DELETE FROM project_templates WHERE template_id=$1", template_id)
    return {"ok": True}


@router.post("/projects/{template_id}/apply")
async def apply_project_template(
    template_id: str, team_id: str,
    pool=Depends(get_pool), user=Depends(require_user)
):
    """Create columns and sample tasks from template into existing team."""
    if not await is_platform_staff(user["user_id"]):
        await _assert_team_member(pool, team_id, user["user_id"])
    tmpl = await pool.fetchrow("SELECT config FROM project_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    cfg = tmpl["config"] if isinstance(tmpl["config"], dict) else json.loads(tmpl["config"])
    created = {"columns": 0, "fields": 0, "tasks": 0}

    for i, col in enumerate(cfg.get("columns", [])):
        col_id = f"col_{uuid.uuid4().hex[:10]}"
        await pool.execute(
            "INSERT INTO project_columns (column_id, team_id, name, color, sort_order, is_done) "
            "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
            col_id, team_id, col["name"], col.get("color", "#0082c6"), i, col.get("is_done", False)
        )
        created["columns"] += 1

    for field_cfg in cfg.get("fields", []):
        fid = f"fld_{uuid.uuid4().hex[:10]}"
        await pool.execute(
            "INSERT INTO field_definitions (field_id, team_id, name, type, config, sort_order) "
            "VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING",
            fid, team_id, field_cfg["name"], field_cfg["type"],
            json.dumps(field_cfg.get("config", {})), 0
        )
        created["fields"] += 1

    for task_cfg in cfg.get("sample_tasks", []):
        task_id = f"task_{uuid.uuid4().hex[:10]}"
        await pool.execute(
            "INSERT INTO tasks (task_id, team_id, created_by_user_id, title, description, status, priority) "
            "VALUES ($1,$2,$3,$4,$5,'todo','medium')",
            task_id, team_id, user["user_id"],
            task_cfg["title"], task_cfg.get("description", "")
        )
        created["tasks"] += 1

    return {"ok": True, "created": created}


# ── Task templates ───────────────────────────────────────────────────────────────

@router.get("/tasks")
async def list_task_templates(team_id: Optional[str] = None, pool=Depends(get_pool), user=Depends(require_user)):
    is_staff = await is_platform_staff(user["user_id"])

    if team_id:
        if not is_staff:
            await _assert_team_member(pool, team_id, user["user_id"])
        rows = await pool.fetch("""
            SELECT * FROM task_templates
            WHERE team_id=$1 OR team_id IS NULL
            ORDER BY is_default DESC, created_at ASC
        """, team_id)
    else:
        if not is_staff:
            rows = await pool.fetch("""
                SELECT DISTINCT tt.* FROM task_templates tt
                LEFT JOIN (
                    SELECT team_id FROM team_members WHERE user_id=$1 AND status='active'
                    UNION
                    SELECT team_id FROM project_assignments WHERE user_id=$1
                ) my_teams ON my_teams.team_id = tt.team_id
                WHERE tt.team_id IS NULL OR my_teams.team_id IS NOT NULL
                ORDER BY tt.is_default DESC, tt.created_at ASC
            """, user["user_id"])
        else:  # platform staff
            rows = await pool.fetch("SELECT * FROM task_templates ORDER BY is_default DESC, created_at ASC")
    return [dict(r) for r in rows]


@router.get("/tasks/{template_id}")
async def get_task_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    row = await pool.fetchrow("SELECT * FROM task_templates WHERE template_id=$1", template_id)
    if not row:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    if row["team_id"] and not await is_platform_staff(user["user_id"]):
        await _assert_team_member(pool, row["team_id"], user["user_id"])
    return dict(row)


@router.post("/tasks")
async def create_task_template(body: TaskTemplateBody, pool=Depends(get_pool), user=Depends(require_user)):
    is_staff = await is_platform_staff(user["user_id"])
    if not body.team_id and not is_staff:
        raise HTTPException(403, "Only platform staff can create org-wide templates")
    if body.team_id and not is_staff:
        await _assert_team_member(pool, body.team_id, user["user_id"])
    tid = f"ttmpl_{uuid.uuid4().hex[:10]}"
    if body.is_default and body.team_id:
        await pool.execute("UPDATE task_templates SET is_default=FALSE WHERE team_id=$1", body.team_id)
    row = await pool.fetchrow(
        """INSERT INTO task_templates (template_id, team_id, name, icon, is_default, config, created_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *""",
        tid, body.team_id, body.name, body.icon, body.is_default,
        json.dumps(body.config), user["user_id"]
    )
    return dict(row)


@router.patch("/tasks/{template_id}")
async def update_task_template(template_id: str, body: TaskTemplateBody, pool=Depends(get_pool), user=Depends(require_user)):
    tmpl = await pool.fetchrow("SELECT created_by, team_id FROM task_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    await _assert_can_modify(pool, tmpl, user)
    if body.is_default and tmpl["team_id"]:
        await pool.execute(
            "UPDATE task_templates SET is_default=FALSE WHERE team_id=$1 AND template_id!=$2",
            tmpl["team_id"], template_id
        )
    row = await pool.fetchrow("""
        UPDATE task_templates
        SET name=$1, icon=$2, is_default=$3, config=$4::jsonb, updated_at=NOW()
        WHERE template_id=$5 RETURNING *
    """, body.name, body.icon, body.is_default, json.dumps(body.config), template_id)
    return dict(row)


@router.post("/tasks/{template_id}/set-default")
async def set_default_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    tmpl = await pool.fetchrow("SELECT team_id FROM task_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    if not await is_platform_staff(user["user_id"]):
        member = await pool.fetchrow(
            "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' LIMIT 1",
            tmpl["team_id"], user["user_id"]
        )
        if not member or member["role"] not in ("owner", "admin"):
            raise HTTPException(403, "Only team owners/admins can change the default template")
    if tmpl["team_id"]:
        await pool.execute(
            "UPDATE task_templates SET is_default=(template_id=$1) WHERE team_id=$2",
            template_id, tmpl["team_id"]
        )
    return {"ok": True}


@router.delete("/tasks/{template_id}")
async def delete_task_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    tmpl = await pool.fetchrow("SELECT created_by, team_id FROM task_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    await _assert_can_modify(pool, tmpl, user)
    await pool.execute("DELETE FROM task_templates WHERE template_id=$1", template_id)
    return {"ok": True}
