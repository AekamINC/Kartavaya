"""
time_entries.py — Time tracking: start/stop timer + manual entries
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone

from auth_router import require_user
from db import get_pool
from middleware.roles import is_platform_staff

router = APIRouter(prefix="/api/time", tags=["time"])


async def _assert_task_access(pool, task_id: str, user: dict):
    """Verify user belongs to the task's team."""
    if await is_platform_staff(user["user_id"]):
        return
    task = await pool.fetchrow("SELECT team_id FROM tasks WHERE task_id=$1", task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    row = await pool.fetchrow(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' "
        "UNION ALL "
        "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 "
        "LIMIT 1",
        task["team_id"], user["user_id"],
    )
    if not row:
        raise HTTPException(403, "Not a member of this project")


async def _assert_team_access(pool, team_id: str, user: dict):
    if await is_platform_staff(user["user_id"]):
        return
    row = await pool.fetchrow(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' "
        "UNION ALL "
        "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 "
        "LIMIT 1",
        team_id, user["user_id"],
    )
    if not row:
        raise HTTPException(403, "Not a member of this project")


class TimeEntryCreate(BaseModel):
    task_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    minutes: Optional[int] = None
    description: Optional[str] = None


@router.get("/task/{task_id}")
async def get_task_time(task_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await _assert_task_access(pool, task_id, user)
    rows = await pool.fetch(
        """
        SELECT te.*, COALESCE(u.full_name, u.name) AS user_name
        FROM time_entries te
        LEFT JOIN users u ON u.user_id = te.user_id
        WHERE te.task_id=$1
        ORDER BY te.started_at DESC
        """,
        task_id,
    )
    total = await pool.fetchval(
        "SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE task_id=$1", task_id
    )
    return {"entries": [dict(r) for r in rows], "total_minutes": total}


@router.post("/start")
async def start_timer(task_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    """Start a running timer. Auto-stops any existing running timer first."""
    if user.get("role") == "client":
        raise HTTPException(403, "Clients cannot log time")
    await _assert_task_access(pool, task_id, user)
    await pool.execute(
        """
        UPDATE time_entries
        SET ended_at=NOW(),
            minutes=GREATEST(1, EXTRACT(EPOCH FROM (NOW()-started_at))::int/60)
        WHERE user_id=$1 AND ended_at IS NULL
        """,
        user["user_id"],
    )
    entry_id = f"te_{uuid.uuid4().hex[:12]}"
    await pool.execute(
        "INSERT INTO time_entries (entry_id, task_id, user_id, started_at) VALUES ($1,$2,$3,NOW())",
        entry_id, task_id, user["user_id"],
    )
    try:
        from services.activity_logger import log_event
        await log_event(pool, task_id=task_id, actor_id=user["user_id"],
                        event_type="timer_started", data={"entry_id": entry_id})
    except Exception:
        pass
    return {"entry_id": entry_id, "started_at": datetime.now(timezone.utc)}


@router.post("/stop")
async def stop_timer(pool=Depends(get_pool), user=Depends(require_user)):
    """Stop the currently running timer."""
    row = await pool.fetchrow(
        "SELECT entry_id, task_id, started_at FROM time_entries WHERE user_id=$1 AND ended_at IS NULL",
        user["user_id"],
    )
    if not row:
        raise HTTPException(404, "No running timer")

    mins = max(1, int((datetime.now(timezone.utc) - row["started_at"]).total_seconds() / 60))
    await pool.execute(
        "UPDATE time_entries SET ended_at=NOW(), minutes=$1 WHERE entry_id=$2",
        mins, row["entry_id"],
    )
    try:
        from services.activity_logger import log_event
        await log_event(pool, task_id=row["task_id"], actor_id=user["user_id"],
                        event_type="timer_stopped", data={"entry_id": row["entry_id"], "minutes": mins})
    except Exception:
        pass
    return {"entry_id": row["entry_id"], "task_id": row["task_id"], "minutes": mins}


@router.post("/manual")
async def add_manual_entry(body: TimeEntryCreate, pool=Depends(get_pool), user=Depends(require_user)):
    if user.get("role") == "client":
        raise HTTPException(403, "Clients cannot log time")
    await _assert_task_access(pool, body.task_id, user)
    entry_id = f"te_{uuid.uuid4().hex[:12]}"
    mins = body.minutes
    if mins is None and body.ended_at:
        mins = max(1, int((body.ended_at - body.started_at).total_seconds() / 60))
    await pool.execute(
        """INSERT INTO time_entries
           (entry_id, task_id, user_id, started_at, ended_at, minutes, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
        entry_id, body.task_id, user["user_id"],
        body.started_at, body.ended_at, mins, body.description,
    )
    try:
        from services.activity_logger import log_event
        await log_event(pool, task_id=body.task_id, actor_id=user["user_id"],
                        event_type="time_logged", data={"minutes": mins, "manual": True})
    except Exception:
        pass
    return {"entry_id": entry_id, "minutes": mins}


@router.delete("/{entry_id}")
async def delete_time_entry(entry_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await pool.execute(
        "DELETE FROM time_entries WHERE entry_id=$1 AND user_id=$2", entry_id, user["user_id"]
    )
    return {"ok": True}


@router.get("/report")
async def time_report(
    team_id: Optional[str] = None,
    user_id_filter: Optional[str] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Report scoped to teams the caller belongs to."""
    is_staff = await is_platform_staff(user["user_id"])

    if team_id:
        if not is_staff:
            await _assert_team_access(pool, team_id, user)

    filters, vals = ["te.ended_at IS NOT NULL"], []

    if team_id:
        filters.append(f"tk.team_id=${len(vals)+1}")
        vals.append(team_id)
    elif not is_staff:
        user_teams = await pool.fetch(
            "SELECT team_id FROM team_members WHERE user_id=$1 AND status='active' "
            "UNION SELECT team_id FROM project_assignments WHERE user_id=$1",
            user["user_id"],
        )
        team_ids = [r["team_id"] for r in user_teams]
        if not team_ids:
            return {"entries": [], "total_minutes": 0}
        filters.append(f"tk.team_id = ANY(${len(vals)+1}::text[])")
        vals.append(team_ids)

    if not is_staff:
        is_team_admin = False
        if team_id:
            owner = await pool.fetchrow(
                "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin')",
                team_id, user["user_id"]
            )
            is_team_admin = owner is not None
        target_user = user_id_filter if (user_id_filter and is_team_admin) else user["user_id"]
        filters.append(f"te.user_id=${len(vals)+1}")
        vals.append(target_user)

    where = " AND ".join(filters)
    rows = await pool.fetch(f"""
        SELECT te.entry_id, te.task_id, tk.title AS task_title,
               te.started_at, te.ended_at, te.minutes, te.description,
               COALESCE(u.full_name, u.name) AS user_name
        FROM   time_entries te
        JOIN   tasks tk ON tk.task_id = te.task_id
        LEFT JOIN users u ON u.user_id = te.user_id
        WHERE  {where}
        ORDER  BY te.started_at DESC
        LIMIT  500
    """, *vals)
    total = sum(r["minutes"] or 0 for r in rows)
    return {"entries": [dict(r) for r in rows], "total_minutes": total}
