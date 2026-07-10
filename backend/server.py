"""
server.py — Kartavaya API v2 by Aekam Inc
Monolith routes stay; new v2 routers mounted at the bottom.
R2 upload router replaces the old base64 /api/upload endpoint.

Bug fixes (2026-05-14):
  FIX #4: get_visible_team_ids now UNIONs team_members so users who
          were invited and registered after the invite (no project_assignments
          row) can still see their teams.
  FIX #5: update_team_member guards the project_assignments role UPDATE
          with `if payload.role` to avoid writing NULL when only status
          is being changed.
"""

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import asyncpg
import sentry_sdk
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, ConfigDict, Field
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.cors import CORSMiddleware

from auth_router import require_user, require_admin, JWT_SECRET as _JWT_SECRET
from limiter import limiter
from auth_router import router as auth_router
from invite_router import router as invite_router
from approvals_router import router as approvals_router
from db import close_pool, get_pool
from health import router as health_router

# ── v2 routers ────────────────────────────────────────────
from routers.fields      import router as fields_router
from routers.views       import router as views_router
from routers.automations import router as automations_router
from routers.activity    import router as activity_router
from routers.dashboards  import router as dashboards_router
from routers.templates   import router as templates_router
from routers.time_entries import router as time_router
from routers.uploads     import router as uploads_router   # R2-backed upload
from routers.reports        import router as reports_router
from routers.task_reminders import router as task_reminders_router
from services.gita            import get_verse_of_the_day
from services.web_push_service import (
    is_configured as wp_is_configured,
    save_subscription as wp_save_subscription,
    remove_subscription as wp_remove_subscription,
    send_web_push,
    fan_out_web_push,
    VAPID_PUBLIC_KEY as VAPID_PUB,
)
from services.expo_push_service import send_expo_push, fan_out_expo_push
from utils import SQL_USER_ROLE

# ── Shared constants ──────────────────────────────────────
_NOT_TEAM_MEMBER  = "Not a team member"
# Single definition for the COALESCE name expression used across all queries.
_COALESCE_NAME    = "COALESCE(full_name, name, email)"
_SQL_USER_ROLE    = SQL_USER_ROLE          # local alias kept for backward compat
_SQL_GET_SUBTASKS = "SELECT subtasks,team_id FROM tasks WHERE task_id=$1 AND team_id=ANY($2::text[])"
_SQL_SET_SUBTASKS = "UPDATE tasks SET subtasks=$1,updated_at=NOW() WHERE task_id=$2 AND team_id=ANY($3::text[]) RETURNING *"

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Whitelist for column names used in dynamic SQL fragments — never interpolate user input
_VALID_SCOPE_COLS: frozenset = frozenset({"team_id", "user_id"})

# Per-task team_ids cache: keyed by (asyncio_task_id, user_id) so concurrent requests
# never share entries. Entries are removed after each request completes.
_team_ids_request_cache: dict = {}

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def _bg(coro, *, label: str = "background") -> asyncio.Task:
    """Schedule *coro* as a fire-and-forget background task.
    Any exception it raises is caught and logged rather than becoming an
    unhandled asyncio exception that would silently pollute stderr.

    NOTE: asyncio tasks are in-process only. A Railway dyno restart drops all
    pending _bg() tasks silently. For critical side-effects (approval emails,
    automation triggers) that must survive restarts, persist the intent to a DB
    queue table first, then process from a cron worker. This is a known
    limitation — do not add new critical workflows as bare _bg() calls.
    """
    async def _run() -> None:
        try:
            await coro
        except Exception as exc:
            logger.warning("background task '%s' failed: %s", label, exc)
    return asyncio.create_task(_run())

_SENTRY_DSN = os.environ.get("SENTRY_DSN")
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        traces_sample_rate=0.1,
        environment=os.environ.get("RAILWAY_ENVIRONMENT", "production"),
    )

app = FastAPI(title="Kartavaya API v2", description="Team task management by Aekam Inc")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
api_router = APIRouter(prefix="/api")

# ── CORS ──────────────────────────────────────────
DEFAULT_ORIGINS = [
    "https://kartavaya.com",
    "https://www.kartavaya.com",
    "https://kartavya-aekam.vercel.app",
    "https://kartavya-production.akeam.vercel.app",
    "https://kartavya-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavya-git-main-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavya-git-v2-plan-kevalvshah03-6145s-projects.vercel.app",
    "http://localhost:3000",
    "http://localhost:8080",
]
_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
ALLOWED_ORIGINS = list(dict.fromkeys(DEFAULT_ORIGINS + _extra))

# Workspace super-owner — auto-added as owner on every new project so the
# company account always has full visibility, regardless of who created it.
DEFAULT_OWNER_EMAIL = os.environ.get("DEFAULT_OWNER_EMAIL", "admin@aekaminc.com")

# Regex covers PR preview deployments on both Vercel tenants (kevalvshah03 + akeam).
_VERCEL_PREVIEW_RE = (
    r"https://kartavya-[a-z0-9-]+-kevalvshah03-6145s-projects\.vercel\.app"
    r"|https://kartavya-[a-z0-9-]+\.akeam\.vercel\.app"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_VERCEL_PREVIEW_RE,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def clear_request_cache(request, call_next):
    """Evict per-request team_id cache entries after each HTTP request completes."""
    import asyncio
    task_id = id(asyncio.current_task())
    try:
        return await call_next(request)
    finally:
        # Remove only entries belonging to this request's asyncio task
        keys_to_remove = [k for k in _team_ids_request_cache if k[0] == task_id]
        for k in keys_to_remove:
            _team_ids_request_cache.pop(k, None)



# ── Helpers ───────────────────────────────────────────────────
# now_utc(), parse_dt(), get_db() live in utils.py — use those for new code.
# The local get_visible_team_ids below is kept because it adds request-level
# caching (_team_ids_request_cache) that the utils version does not have.

from utils import now_utc, parse_dt, get_db  # noqa: E402 — after FastAPI imports

def actor_display(user: dict, fallback: str = "Someone") -> str:
    """Return the best display name for a user dict. Prefers full_name > name > email."""
    return user.get("full_name") or user.get("name") or user.get("email") or fallback

async def get_visible_team_ids(pool, user_id, role=None, _user_dict=None):
    """Return team IDs visible to user_id.

    Caches result in _team_ids_request_cache for the duration of a request.
    FIX #4: UNIONs team_members so users invited before registering still see teams.
    """
    import asyncio
    task_id = id(asyncio.current_task())
    cache_key = (task_id, user_id)
    cached = _team_ids_request_cache.get(cache_key)
    if cached is not None:
        return cached

    effective_role = role or (_user_dict and _user_dict.get("role"))
    if effective_role != "admin":
        user_row = await pool.fetchrow(_SQL_USER_ROLE, user_id)
        effective_role = user_row.get("role") if user_row else None

    if effective_role == "admin":
        all_teams = await pool.fetch("SELECT team_id FROM teams")
        result = [r["team_id"] for r in all_teams]
    else:
        rows = await pool.fetch(
            """
            SELECT team_id FROM project_assignments WHERE user_id=$1
            UNION
            SELECT team_id FROM team_members WHERE user_id=$1 AND status='active'
            """,
            user_id,
        )
        result = [r["team_id"] for r in rows]

    _team_ids_request_cache[cache_key] = result
    return result

async def is_project_member(pool, team_id: str, user: dict) -> dict | None:
    """Return membership record (or a synthetic one for admins) or None."""
    if user.get("role") in ("admin", "owner"):
        return {"role": "admin"}
    row = await pool.fetchrow(
        "SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",
        team_id, user["user_id"]
    )
    if row:
        return row
    # Fallback: team_members covers users added after their invite acceptance
    return await pool.fetchrow(
        "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        team_id, user["user_id"]
    )

async def normalize_orders(pool, scope_col, scope_val, column_id):
    """Re-sequence sort_order for all tasks in the given column, closing any gaps.

    Holds a pg_advisory_xact_lock keyed on (scope_val, column_id) so concurrent
    move operations on the same column don't interleave and corrupt sort_order.
    """
    if scope_col not in _VALID_SCOPE_COLS:
        raise ValueError(f"Invalid scope_col: {scope_col!r}")
    import hashlib
    lock_key = int(hashlib.md5(f"{scope_val}:{column_id}".encode()).hexdigest()[:15], 16) % (2**63)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", lock_key)
            rows = await conn.fetch(
                f"SELECT task_id FROM tasks WHERE {scope_col}=$1 AND column_id=$2 ORDER BY sort_order ASC, updated_at ASC",
                scope_val, column_id,
            )
            if not rows:
                return
            values_sql = ",".join(f"(${i*2+1}::int, ${i*2+2}::text)" for i in range(len(rows)))
            params = []
            for idx, row in enumerate(rows):
                params.extend([idx, row["task_id"]])
            await conn.execute(
                f"UPDATE tasks SET sort_order=v.idx, updated_at=NOW() "
                f"FROM (VALUES {values_sql}) AS v(idx, task_id) "
                f"WHERE tasks.task_id=v.task_id",
                *params,
            )

async def create_notification(pool, user_id, notif_type, title, message, task_id=None, team_id=None, url=None, push=True):
    """Insert a notification row and fire a Web Push if the user has a subscription.

    Pass push=False to write the in-app row only (used for reminders whose
    push channel was switched off).
    """
    await pool.execute(
        "INSERT INTO notifications (notification_id,user_id,team_id,type,title,message,task_id,url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        f"notif_{uuid.uuid4().hex[:12]}", user_id, team_id, notif_type, title, message, task_id, url,
    )
    if not push: return
    # Fire Web Push (browser) + Expo Push (mobile) — both non-blocking
    _bg(send_web_push(pool, user_id=user_id, title=title, body=message, url=url or "/"), label="web_push")
    _bg(send_expo_push(pool, user_id=user_id, title=title, body=message, url=url or "/", task_id=task_id), label="expo_push")

async def _replace_task_reminders(pool, task_id: str, due_dt, reminders: List["ReminderIn"]) -> List["ReminderOut"]:
    """Delete unsent reminders for a task and insert the new set, computed off due_dt.

    Wrapped in a transaction so a failed INSERT rolls back the DELETE — reminders
    are never left in a partially-written state.
    Reminders whose offset isn't in REMINDER_OFFSETS, whose channels aren't a
    recognized subset, or whose computed fire_at has already passed are skipped.
    """
    if not due_dt or not reminders:
        await pool.execute("DELETE FROM task_reminders WHERE task_id=$1 AND sent_at IS NULL", task_id)
        return []
    now = now_utc(); out = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM task_reminders WHERE task_id=$1 AND sent_at IS NULL", task_id)
            for r in reminders:
                if r.offset_minutes not in REMINDER_OFFSETS: continue
                channels = [c for c in r.channels if c in REMINDER_CHANNELS] or ["in_app"]
                fire_at = due_dt - timedelta(minutes=r.offset_minutes)
                if fire_at <= now: continue
                row = await conn.fetchrow(
                    """INSERT INTO task_reminders (task_id,offset_minutes,channel_inapp,channel_push,channel_email,fire_at)
                       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
                    task_id, r.offset_minutes, "in_app" in channels, "push" in channels, "email" in channels, fire_at,
                )
                out.append(_reminder_row_to_out(row))
    return out

def _reminder_row_to_out(row) -> "ReminderOut":
    channels = [c for c, flag in (("in_app", row["channel_inapp"]), ("push", row["channel_push"]), ("email", row["channel_email"])) if flag]
    return ReminderOut(reminder_id=row["reminder_id"], offset_minutes=row["offset_minutes"], channels=channels, fire_at=row["fire_at"], sent_at=row["sent_at"])

async def _fetch_task_reminders(pool, task_id: str) -> List["ReminderOut"]:
    rows = await pool.fetch("SELECT * FROM task_reminders WHERE task_id=$1 AND sent_at IS NULL ORDER BY fire_at ASC", task_id)
    return [_reminder_row_to_out(r) for r in rows]

async def ensure_default_columns(pool, team_id):
    """Create the five default kanban columns for a new project if none exist yet."""
    existing = await pool.fetchval("SELECT COUNT(*) FROM project_columns WHERE team_id=$1", team_id)
    if existing == 0:
        defaults = [
            ("To Do","#0082c6",0,False),("In Progress","#03a1b6",1,False),
            ("In Review","#8b5cf6",2,False),("Approval","#f59e0b",3,False),("Done","#05b7aa",4,True),
        ]
        for name,color,order,is_done in defaults:
            await pool.execute(
                "INSERT INTO project_columns (column_id,team_id,name,color,sort_order,is_done) VALUES ($1,$2,$3,$4,$5,$6)",
                f"col_{uuid.uuid4().hex[:12]}",team_id,name,color,order,is_done,
            )

async def client_can_access_task(pool, task_id, user_id):
    """Returns True if a client user can access this task."""
    row = await pool.fetchrow("SELECT team_id, created_by_user_id, assignee_user_ids FROM tasks WHERE task_id=$1", task_id)
    if not row: return False
    if row["created_by_user_id"] == user_id: return True
    if user_id in (row["assignee_user_ids"] or []): return True
    if row["team_id"]:
        pa = await pool.fetchrow("SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2", row["team_id"], user_id)
        if pa: return True
    tc = await pool.fetchrow("SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2", task_id, user_id)
    return bool(tc)


# ── Models ─────────────────────────────────────────────
class ProjectColumnCreate(BaseModel):
    name:str; color:str="#0082c6"; is_done:bool=False
class ProjectColumnUpdate(BaseModel):
    name:Optional[str]=None; color:Optional[str]=None; is_done:Optional[bool]=None; sort_order:Optional[int]=None
class ProjectColumnOut(BaseModel):
    column_id:str; team_id:str; name:str; color:str; sort_order:int; is_done:bool; created_at:datetime
class CategoryCreate(BaseModel):
    name:str; color:str="#0082c6"
class CategoryOut(BaseModel):
    category_id:str; user_id:str; name:str; color:str; created_at:datetime; updated_at:datetime
class TeamCreate(BaseModel):
    name:str; brand_settings:Optional[dict]=None
class TeamOut(BaseModel):
    team_id:str; name:str; created_by:str; created_at:datetime; updated_at:datetime
    task_count:int=0; done_count:int=0; color:Optional[str]=None
    brand_settings:Optional[dict]=None
class TeamMemberAdd(BaseModel):
    email:str; role:str="member"
class TeamMemberUpdate(BaseModel):
    role:Optional[str]=None; status:Optional[str]=None
class TeamMemberOut(BaseModel):
    member_id:str; team_id:str; email:str; user_id:Optional[str]=None; role:str; status:str; created_at:datetime; updated_at:datetime
class Attachment(BaseModel):
    name:str; url:str; key:Optional[str]=None
    is_private:bool=False; visible_to:List[str]=[]
class Subtask(BaseModel):
    subtask_id:str=Field(default_factory=lambda:f"sub_{uuid.uuid4().hex[:12]}"); title:str; is_done:bool=False; order:int=0; assignee_user_id:Optional[str]=None
class Recurrence(BaseModel):
    rule:str="none"; interval:int=1
REMINDER_OFFSETS = {2880, 1440, 240, 120, 60, 30, 15}
REMINDER_CHANNELS = {"in_app", "push", "email"}
class ReminderIn(BaseModel):
    offset_minutes:int; channels:List[str]=["in_app"]
class ReminderOut(BaseModel):
    reminder_id:str; offset_minutes:int; channels:List[str]; fire_at:datetime; sent_at:Optional[datetime]=None
class TaskCreate(BaseModel):
    title:str; description:Optional[str]=None; status:str="todo"; column_id:Optional[str]=None
    priority:str="medium"; category_id:Optional[str]=None; tags:List[str]=[]; team_id:Optional[str]=None
    assignee_user_ids:List[str]=[]; assignee_emails:List[str]=[]; due_at:Optional[str]=None
    reminder_at:Optional[str]=None; reminders:List[ReminderIn]=[]; recurrence:Recurrence=Field(default_factory=Recurrence)
    estimated_minutes:Optional[int]=None; attachments:List[Attachment]=[]
    custom_fields:Dict[str,Any]={}; subtasks:List[Subtask]=[]
class TaskUpdate(BaseModel):
    title:Optional[str]=None; description:Optional[str]=None; status:Optional[str]=None
    column_id:Optional[str]=None; priority:Optional[str]=None; category_id:Optional[str]=None
    tags:Optional[List[str]]=None; team_id:Optional[str]=None; assignee_user_ids:Optional[List[str]]=None
    assignee_emails:Optional[List[str]]=None; due_at:Optional[str]=None; reminder_at:Optional[str]=None
    recurrence:Optional[Recurrence]=None; estimated_minutes:Optional[int]=None
    attachments:Optional[List[Attachment]]=None; custom_fields:Optional[Dict[str,Any]]=None
    subtasks:Optional[List[Subtask]]=None; approval_status:Optional[str]=None
class TaskOut(BaseModel):
    task_id:str; user_id:Optional[str]=None; team_id:Optional[str]=None; column_id:Optional[str]=None
    created_by_user_id:str; assigned_by_user_id:Optional[str]=None; completed_by_user_id:Optional[str]=None
    title:str; description:Optional[str]=None; status:str; priority:str; category_id:Optional[str]=None
    tags:List[str]=[]; assignee_user_ids:List[str]=[]; assignee_emails:List[str]=[]; assignee_names:List[str]=[]
    due_at:Optional[datetime]=None; reminder_at:Optional[datetime]=None; reminder_sent_at:Optional[datetime]=None
    recurrence:Recurrence=Field(default_factory=Recurrence); estimated_minutes:Optional[int]=None
    attachments:List[Attachment]=[]; custom_fields:Dict[str,Any]={}; subtasks:List[Subtask]=[]
    order:int=0; created_at:datetime; updated_at:datetime; completed_at:Optional[datetime]=None
    approval_status:Optional[str]=None; approval_notes:Optional[str]=None; approved_by:Optional[str]=None
    approval_requested_at:Optional[datetime]=None; approval_decided_at:Optional[datetime]=None
    requires_approval:bool=False; created_by_name:Optional[str]=None
    archived_at:Optional[datetime]=None; reminders:List[ReminderOut]=[]
class TaskMoveIn(BaseModel):
    column_id:str; order:int
class CommentCreate(BaseModel):
    body:str=Field(...,min_length=1,max_length=4000)
class CommentOut(BaseModel):
    comment_id:str; task_id:str; user_id:str; user_name:str; body:str; created_at:datetime
class DashboardSummaryOut(BaseModel):
    todo:int; in_progress:int; done:int; overdue:int; due_24h:int
class PushSubscriptionIn(BaseModel):
    model_config=ConfigDict(extra="ignore"); endpoint:str; keys:Dict[str,str]
class NotificationOut(BaseModel):
    notification_id:str; user_id:str; team_id:Optional[str]=None; type:str; title:str; message:str
    task_id:Optional[str]=None; url:Optional[str]=None; created_at:datetime; read_at:Optional[datetime]=None
class MarkReadIn(BaseModel):
    notification_ids:List[str]=[]; mark_all:bool=False


def row_to_task(r) -> TaskOut:
    """Convert an asyncpg Record from the tasks table to a TaskOut Pydantic model."""
    def pj(v,d):
        if isinstance(v,str): return json.loads(v)
        return v if v is not None else d
    def col(key,default=None):
        try:
            if key in r: return r[key]
        except (KeyError,TypeError): pass
        return default
    return TaskOut(
        task_id=r["task_id"],user_id=r["user_id"],team_id=r["team_id"],column_id=r.get("column_id"),
        created_by_user_id=r["created_by_user_id"],assigned_by_user_id=r["assigned_by_user_id"],
        completed_by_user_id=r["completed_by_user_id"],title=r["title"],description=r["description"],
        status=r["status"],priority=r["priority"],category_id=r["category_id"],
        tags=list(r["tags"] or []),assignee_user_ids=list(r["assignee_user_ids"] or []),
        assignee_emails=list(r["assignee_emails"] or []),assignee_names=list(col("assignee_names") or []),
        due_at=r["due_at"],reminder_at=r["reminder_at"],reminder_sent_at=r["reminder_sent_at"],
        recurrence=Recurrence(rule=r["recurrence_rule"] or "none",interval=r["recurrence_interval"] or 1),
        estimated_minutes=r["estimated_minutes"],
        attachments=[Attachment(**a) for a in pj(r["attachments"],[])],
        custom_fields=pj(r["custom_fields"],{}),
        subtasks=[Subtask(**s) for s in pj(r["subtasks"],[])],
        order=r["sort_order"] or 0,created_at=r["created_at"],updated_at=r["updated_at"],
        completed_at=r["completed_at"],
        approval_status=col("approval_status"),approval_notes=col("approval_notes"),
        approved_by=col("approved_by"),approval_requested_at=col("approval_requested_at"),
        approval_decided_at=col("approval_decided_at"),requires_approval=bool(col("requires_approval",False)),
        created_by_name=col("created_by_name"),archived_at=col("archived_at"),
    )


# ── Routes ─────────────────────────────────────────────

@api_router.get("/")
async def root():
    """Return a simple health-check payload confirming the API is running."""
    return {"message":"Kartavaya API v2","by":"Aekam Inc","status":"ok"}

@api_router.get("/auth/me")
async def me(user=Depends(require_user)):
    """Return the authenticated user's profile."""
    return {"user_id":user["user_id"],"email":user["email"],"name":user.get("full_name") or user["name"],
            "full_name":user.get("full_name") or user["name"],"role":user.get("role","member"),
            "position":user.get("position"),"company_name":user.get("company_name"),
            "member_role":user.get("member_role"),"picture":user.get("avatar"),
            "receives_approval_emails":user.get("receives_approval_emails",True)}

@api_router.post("/auth/logout")
async def logout():
    """Invalidate the current session (client-side token deletion only)."""
    return {"ok":True}


# ── Mobile: push tokens ───────────────────────────────────────────────────────

@api_router.post("/me/push_tokens")
async def register_push_token(body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Register or refresh a mobile push token for the authenticated user."""
    platform  = body.get("platform","unknown")
    token     = body.get("token","")
    device_id = body.get("device_id","")
    if not token or not device_id:
        raise HTTPException(400,"token and device_id are required")
    await pool.execute("""
        INSERT INTO push_tokens (user_id,platform,token,device_id)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (device_id) DO UPDATE SET token=EXCLUDED.token, user_id=EXCLUDED.user_id, platform=EXCLUDED.platform
    """, user["user_id"], platform, token, device_id)
    return {"ok":True}

@api_router.delete("/me/push_tokens/{device_id}")
async def unregister_push_token(device_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Remove a mobile push token by device ID for the authenticated user."""
    await pool.execute("DELETE FROM push_tokens WHERE device_id=$1 AND user_id=$2", device_id, user["user_id"])
    return {"ok":True}


# ── Mobile: notification prefs ────────────────────────────────────────────────

DEFAULT_PREFS = {
    "mention":          "always",
    "approval_request": "always",
    "approved":         "always",
    "rejected":         "always",
    "assigned":         "always",
    "comment":          "mine_only",
    "status_changed":   "project",
    "done":             "project",
    "created":          "off",
}

@api_router.get("/me/notification_prefs")
async def get_notification_prefs(pool=Depends(get_db),user=Depends(require_user)):
    """Return the authenticated user's notification preferences merged with defaults."""
    row = await pool.fetchrow("SELECT prefs, quiet_start, quiet_end FROM notification_prefs WHERE user_id=$1", user["user_id"])
    if not row:
        return {"prefs": DEFAULT_PREFS, "quiet_start": "22:00", "quiet_end": "07:00"}
    import json as _json
    prefs = row["prefs"] if isinstance(row["prefs"], dict) else _json.loads(row["prefs"] or "{}")
    merged = {**DEFAULT_PREFS, **prefs}
    return {"prefs": merged, "quiet_start": row["quiet_start"], "quiet_end": row["quiet_end"]}

@api_router.put("/me/notification_prefs")
async def set_notification_prefs(body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Save notification preferences and quiet-hours window for the authenticated user."""
    import json as _json
    prefs       = body.get("prefs", {})
    quiet_start = body.get("quiet_start", "22:00")
    quiet_end   = body.get("quiet_end",   "07:00")
    await pool.execute("""
        INSERT INTO notification_prefs (user_id, prefs, quiet_start, quiet_end)
        VALUES ($1, $2::jsonb, $3, $4)
        ON CONFLICT (user_id) DO UPDATE
          SET prefs=$2::jsonb, quiet_start=$3, quiet_end=$4, updated_at=NOW()
    """, user["user_id"], _json.dumps(prefs), quiet_start, quiet_end)
    return {"ok":True}


@api_router.get("/projects/{team_id}/columns",response_model=List[ProjectColumnOut])
async def list_columns(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Return all kanban columns for the given project, creating defaults if none exist."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,"Not a project member")
    await ensure_default_columns(pool,team_id)
    rows=await pool.fetch("SELECT * FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC",team_id)
    return [ProjectColumnOut(**dict(r)) for r in rows]

@api_router.post("/projects/{team_id}/columns",response_model=ProjectColumnOut)
async def create_column(team_id:str,payload:ProjectColumnCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a new kanban column in the given project."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403,"Owner or admin required")
    max_order=await pool.fetchval("SELECT COALESCE(MAX(sort_order),-1) FROM project_columns WHERE team_id=$1",team_id)
    column_id=f"col_{uuid.uuid4().hex[:12]}"
    row=await pool.fetchrow("INSERT INTO project_columns (column_id,team_id,name,color,sort_order,is_done) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        column_id,team_id,payload.name.strip(),payload.color,max_order+1,payload.is_done)
    return ProjectColumnOut(**dict(row))

@api_router.put("/projects/{team_id}/columns/{column_id}",response_model=ProjectColumnOut)
async def update_column(team_id:str,column_id:str,payload:ProjectColumnUpdate,pool=Depends(get_db),user=Depends(require_user)):
    """Update name, colour, done-flag, or sort order of a project column."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    updates,vals=[],[]
    if payload.name is not None:       updates.append(f"name=${len(vals)+1}");       vals.append(payload.name.strip())
    if payload.color is not None:      updates.append(f"color=${len(vals)+1}");      vals.append(payload.color)
    if payload.is_done is not None:    updates.append(f"is_done=${len(vals)+1}");    vals.append(payload.is_done)
    if payload.sort_order is not None: updates.append(f"sort_order=${len(vals)+1}"); vals.append(payload.sort_order)
    if not updates: raise HTTPException(400,"Nothing to update")
    updates.append(f"updated_at=${len(vals)+1}"); vals.append(now_utc()); vals+=[team_id,column_id]
    row=await pool.fetchrow(f"UPDATE project_columns SET {', '.join(updates)} WHERE team_id=${len(vals)-1} AND column_id=${len(vals)} RETURNING *",*vals)
    if not row: raise HTTPException(404)
    return ProjectColumnOut(**dict(row))

@api_router.delete("/projects/{team_id}/columns/{column_id}")
async def delete_column(team_id:str,column_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Delete a project column, moving its tasks to the next available column."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    remaining=await pool.fetchval("SELECT COUNT(*) FROM project_columns WHERE team_id=$1",team_id)
    if remaining<=1: raise HTTPException(400,"Cannot delete the last column")
    first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 AND column_id!=$2 ORDER BY sort_order ASC LIMIT 1",team_id,column_id)
    if first_col: await pool.execute("UPDATE tasks SET column_id=$1 WHERE column_id=$2",first_col["column_id"],column_id)
    await pool.execute("DELETE FROM project_columns WHERE team_id=$1 AND column_id=$2",team_id,column_id)
    return {"ok":True}

@api_router.post("/projects/{team_id}/columns/reorder")
async def reorder_columns(team_id:str,body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Reorder project columns according to the provided ordered_ids list."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    ordered_ids = body.get("ordered_ids", [])
    if not isinstance(ordered_ids, list): raise HTTPException(400,"ordered_ids must be a list")
    if len(ordered_ids) > 100: raise HTTPException(400,"Too many columns in reorder request")
    if ordered_ids:
        values_sql = ",".join(f"(${i*2+1}::int, ${i*2+2}::text)" for i in range(len(ordered_ids)))
        params = []
        for idx, cid in enumerate(ordered_ids):
            params.extend([idx, cid])
        await pool.execute(
            f"UPDATE project_columns SET sort_order=v.idx "
            f"FROM (VALUES {values_sql}) AS v(idx, column_id) "
            f"WHERE project_columns.column_id=v.column_id AND project_columns.team_id=${ len(params)+1 }",
            *params, team_id,
        )
    return {"ok":True}

# ── Client-scoped endpoints ──────────────────────────────────────────

@api_router.get("/client/tasks",response_model=List[TaskOut])
async def client_tasks(pool=Depends(get_db),user=Depends(require_user)):
    """Return all tasks visible to the authenticated client user."""
    rows=await pool.fetch("""
        SELECT t.*,
               COALESCE(cu.full_name,cu.name,cu.email) AS created_by_name,
               ARRAY(
                 SELECT COALESCE(au.full_name,au.name,au.email)
                 FROM unnest(t.assignee_user_ids) AS uid
                 LEFT JOIN users au ON au.user_id=uid
               ) AS assignee_names
        FROM tasks t
        LEFT JOIN users cu ON cu.user_id=t.created_by_user_id
        WHERE t.archived_at IS NULL
          AND (t.created_by_user_id=$1
           OR $1=ANY(t.assignee_user_ids)
           OR EXISTS(SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1)
           OR EXISTS(SELECT 1 FROM task_clients tc WHERE tc.task_id=t.task_id AND tc.user_id=$1))
        ORDER BY t.updated_at DESC
    """, user["user_id"])
    return [row_to_task(r) for r in rows]

@api_router.get("/client/projects")
async def client_projects(pool=Depends(get_db),user=Depends(require_user)):
    """Return all projects the authenticated client user is assigned to."""
    rows=await pool.fetch("SELECT t.* FROM teams t JOIN project_assignments pa ON pa.team_id=t.team_id WHERE pa.user_id=$1 ORDER BY t.created_at DESC",user["user_id"])
    return [dict(r) for r in rows]

@api_router.get("/client/approvals")
async def client_approvals(pool=Depends(get_db), user=Depends(require_user)):
    """Return all pending approvals and client task approvals visible to the user."""
    uid = user["user_id"]
    approval_rows, task_rows = await asyncio.gather(
      pool.fetch("""
        SELECT a.*,
               COALESCE(u.full_name, u.name, u.email) AS requested_by_name,
               u.email                                AS requested_by_email
        FROM   approvals a
        JOIN   users u ON u.user_id = a.requested_by
        WHERE  a.status = 'pending'
          AND  EXISTS (
                 SELECT 1 FROM project_assignments
                 WHERE  team_id = a.team_id AND user_id = $1
               )
        ORDER BY a.created_at DESC
    """, uid),
      pool.fetch("""
        SELECT
            CONCAT('task_approval--', t.task_id)              AS approval_id,
            t.task_id,
            t.title                                            AS task_title,
            t.approval_status,
            t.team_id,
            COALESCE(u.full_name, u.name, u.email)            AS requested_by_name,
            u.email                                           AS requested_by_email,
            t.approval_requested_at                           AS created_at,
            jsonb_build_object(
                'title',       t.title,
                'description', t.description
            )                                                  AS request_data
        FROM   tasks t
        JOIN   users u ON u.user_id = t.created_by_user_id
        WHERE  t.approval_status = 'pending_client'
          AND  (
               EXISTS (SELECT 1 FROM project_assignments WHERE team_id = t.team_id AND user_id = $1)
            OR EXISTS (SELECT 1 FROM task_clients WHERE task_id = t.task_id AND user_id = $1)
          )
        ORDER BY t.approval_requested_at DESC NULLS LAST
    """, uid),
    )
    return [dict(r) for r in approval_rows] + [dict(r) for r in task_rows]

@api_router.post("/tasks/{task_id}/clients/{target_user_id}")
async def add_client_to_task(task_id:str,target_user_id:str,pool=Depends(get_db),user=Depends(require_admin)):
    """Grant a client user access to a specific task."""
    await pool.execute("INSERT INTO task_clients (id,task_id,user_id,invited_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",f"tc_{uuid.uuid4().hex[:12]}",task_id,target_user_id,user["user_id"])
    return {"ok":True}

@api_router.delete("/tasks/{task_id}/clients/{target_user_id}")
async def remove_client_from_task(task_id:str,target_user_id:str,pool=Depends(get_db),user=Depends(require_admin)):
    """Revoke a client user's access to a specific task."""
    await pool.execute("DELETE FROM task_clients WHERE task_id=$1 AND user_id=$2",task_id,target_user_id)
    return {"ok":True}

# ── Org settings (brand kit) ──────────────────────────────────────────────────

async def _get_org_settings(pool) -> dict:
    rows = await pool.fetch("SELECT key, value FROM org_settings WHERE key IN ('brand_colors','brand_fonts')")
    data = {r["key"]: list(r["value"]) for r in rows}
    return {"brand_colors": data.get("brand_colors", []), "brand_fonts": data.get("brand_fonts", [])}

@api_router.get("/settings")
async def get_org_settings(pool=Depends(get_db), user=Depends(require_user)):
    """Return workspace brand kit (colors + fonts) — readable by all non-client users."""
    return await _get_org_settings(pool)

@api_router.put("/settings")
async def update_org_settings(body: dict, pool=Depends(get_db), user=Depends(require_user)):
    """Persist workspace brand kit. Admin or owner only."""
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Admin access required")
    for key in ("brand_colors", "brand_fonts"):
        if key in body:
            await pool.execute(
                "INSERT INTO org_settings(key, value) VALUES($1, $2::jsonb) "
                "ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
                key, json.dumps(body[key])
            )
    return await _get_org_settings(pool)

# Keep old endpoint as alias so existing frontend code doesn't break mid-deploy
@api_router.put("/settings/brand-colors")
async def update_brand_colors_compat(body: dict, pool=Depends(get_db), user=Depends(require_user)):
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Admin access required")
    colors = body.get("colors", [])
    await pool.execute(
        "INSERT INTO org_settings(key, value) VALUES('brand_colors', $1::jsonb) "
        "ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
        json.dumps(colors)
    )
    return {"brand_colors": colors}

@api_router.post("/client/tasks/request", response_model=TaskOut)
async def client_request_task(payload:TaskCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a task request from a client user, pending team approval."""
    if user.get("role") != "client":
        raise HTTPException(403, "Only client users can submit task requests")
    if not payload.team_id: raise HTTPException(400,"team_id required")
    assignment=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",payload.team_id,user["user_id"])
    if not assignment: raise HTTPException(403,"Not a project member")
    # Create approval record first
    approval_id=f"approval_{uuid.uuid4().hex[:12]}"
    await pool.execute("INSERT INTO approvals (approval_id,team_id,requested_by,status,request_type,request_data) VALUES ($1,$2,$3,'pending','create',$4)",
        approval_id,payload.team_id,user["user_id"],json.dumps(payload.model_dump()))
    # Create actual task with status='requested' so it appears on the board
    first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC LIMIT 1",payload.team_id)
    column_id=first_col["column_id"] if first_col else None
    max_row=await pool.fetchrow("SELECT MAX(sort_order) AS mo FROM tasks WHERE team_id=$1 AND column_id=$2",payload.team_id,column_id)
    next_order=(max_row["mo"] or -1)+1; task_id=f"task_{uuid.uuid4().hex[:12]}"
    actor_name=actor_display(user)
    atts_json=json.dumps([a.model_dump() for a in (payload.attachments or [])])
    row=await pool.fetchrow("""
        INSERT INTO tasks (task_id,team_id,column_id,created_by_user_id,created_by_name,
            title,description,status,priority,approval_id,attachments,custom_fields,subtasks,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10::jsonb,'{}' ::jsonb,'[]'::jsonb,$11)
        RETURNING *""",
        task_id,payload.team_id,column_id,user["user_id"],actor_name,
        payload.title,payload.description,payload.priority or "medium",approval_id,atts_json,next_order)
    # Link approval to task
    await pool.execute("UPDATE approvals SET request_data=$1 WHERE approval_id=$2",
        json.dumps({**payload.model_dump(),"task_id":task_id}),approval_id)
    # Notify project owners/admins — in-app + email
    try:
        reviewers = await pool.fetch("""
            SELECT u.user_id, u.email,
                   COALESCE(u.full_name, u.name, u.email) AS name,
                   COALESCE(u.receives_approval_emails, TRUE) AS wants_email
            FROM project_assignments pa
            JOIN users u ON u.user_id = pa.user_id
            WHERE pa.team_id=$1 AND pa.role IN ('owner','admin') AND pa.user_id != $2
        """, payload.team_id, user["user_id"])
        team_row = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", payload.team_id)
        project_name = team_row["name"] if team_row else None
        for r in reviewers:
            await create_notification(
                pool, r["user_id"], "approval_request",
                "New task request",
                f"{actor_name} requested: {payload.title}",
                task_id, payload.team_id, "/approvals"
            )
            if r["wants_email"]:
                try:
                    from email_service import send_approval_request_email
                    send_approval_request_email(
                        r["email"], r["name"],
                        requester_name=actor_name,
                        task_title=payload.title,
                        notes=payload.description,
                        project=project_name,
                        priority=payload.priority,
                    )
                except Exception as email_err:
                    logger.warning("approval request email failed: %s", email_err)
    except Exception as notif_err:
        logger.warning("approval request notification failed: %s", notif_err)
    return row_to_task(row)

# ── Approvals ───────────────────────────────────────────────────

@api_router.get("/approvals/pending")
async def list_pending_approvals(pool=Depends(get_db),user=Depends(require_user)):
    """Return all pending approvals and task-level approvals the user can action."""
    uid = user["user_id"]
    # Standard approvals table records (task creation requests)
    rows = await pool.fetch("""
        SELECT a.*, COALESCE(u.full_name,u.name,u.email) AS requester_name,
               u.email AS requested_by_email
        FROM approvals a JOIN users u ON u.user_id=a.requested_by WHERE a.status='pending'
        AND EXISTS(SELECT 1 FROM project_assignments WHERE team_id=a.team_id AND user_id=$1 AND role IN('owner','admin'))
        ORDER BY a.created_at DESC
    """, uid)
    # Task-level approvals (approval_status='pending')
    task_rows = await pool.fetch("""
        SELECT
            CONCAT('task_approval--', t.task_id) AS approval_id,
            t.task_id,
            t.title AS task_title,
            t.approval_notes AS notes,
            t.approval_requested_at AS created_at,
            t.team_id,
            t.priority,
            t.due_at AS task_due_at,
            COALESCE(u.full_name, u.name, u.email) AS requester_name,
            u.email AS requested_by_email,
            'task_completion' AS request_type,
            jsonb_build_object('title', t.title, 'description', t.description, 'priority', t.priority) AS request_data
        FROM tasks t
        JOIN users u ON u.user_id = t.created_by_user_id
        WHERE t.approval_status = 'pending'
        AND (
            EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=t.team_id AND tm.user_id=$1 AND tm.role IN ('owner','admin') AND tm.status='active')
        )
        ORDER BY t.approval_requested_at DESC NULLS LAST
    """, uid)
    return [dict(r) for r in rows] + [dict(r) for r in task_rows]

@api_router.get("/approvals/history")
async def approval_history(pool=Depends(get_db), user=Depends(require_user)):
    """Return approved and rejected task approvals visible to the user."""
    uid = user["user_id"]
    task_rows = await pool.fetch("""
        SELECT
            CONCAT('task_approval--', t.task_id) AS approval_id,
            t.task_id,
            t.title AS task_title,
            t.approval_status AS status,
            t.approval_notes AS notes,
            t.approval_decided_at AS updated_at,
            COALESCE(u.full_name, u.name, u.email) AS requester_name
        FROM tasks t
        JOIN users u ON u.user_id = t.created_by_user_id
        WHERE t.approval_status IN ('approved','rejected')
        AND t.approval_decided_at IS NOT NULL
        AND (
            EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=t.team_id AND tm.user_id=$1 AND tm.role IN ('owner','admin') AND tm.status='active')
        )
        ORDER BY t.approval_decided_at DESC NULLS LAST
        LIMIT 50
    """, uid)
    return [dict(r) for r in task_rows]

# ── Task-approval helpers (called by review_approval) ────────────────────────

async def _reject_task_approval(pool, task: dict, task_id: str, notes: str, user: dict) -> dict:
    """Persist a task rejection and notify the requester."""
    await pool.execute(
        "UPDATE tasks SET approval_status='rejected', approved_by=$1, approval_notes=$2,"
        " approval_decided_at=NOW(), updated_at=NOW() WHERE task_id=$3",
        user["user_id"], notes, task_id,
    )
    if task["created_by_user_id"] and task["created_by_user_id"] != user["user_id"]:
        await create_notification(
            pool, task["created_by_user_id"], "rejected",
            f"Task rejected: {task['title']}", notes or "",
            task_id, task["team_id"], "/tasks",
        )
    return {"ok": True, "status": "rejected"}


async def _approve_task_send_client(
    pool, task: dict, task_id: str, notes: str, client_email: str, user: dict
) -> dict:
    """Approve by forwarding to a client for final sign-off; sends magic-link email."""
    client = await pool.fetchrow(
        "SELECT user_id, COALESCE(full_name,name) AS name FROM users WHERE LOWER(email)=$1",
        client_email.lower(),
    )
    if not client:
        raise HTTPException(404, "Client user not found with that email")
    await pool.execute(
        "INSERT INTO task_clients (id,task_id,user_id,invited_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        f"tc_{uuid.uuid4().hex[:12]}", task_id, client["user_id"], user["user_id"],
    )
    import jwt as _jwt_local
    token = _jwt_local.encode(
        {
            "task_id": task_id, "client_user_id": client["user_id"],
            "type": "client_approval",
            "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7,
        },
        _JWT_SECRET, algorithm="HS256",
    )
    await pool.execute(
        "UPDATE tasks SET approval_status='pending_client', approval_requested_at=NOW(),"
        " approval_notes=$1, updated_at=NOW() WHERE task_id=$2",
        notes, task_id,
    )
    try:
        from email_service import send_approval_request_email
        approver_name = actor_display(user, "Team")
        send_approval_request_email(
            client_email, client["name"] or client_email,
            approver_name, task["title"],
            notes=notes, approve_token=token,
        )
    except Exception as exc:
        logger.warning("client approval email failed: %s", exc)
    return {"ok": True, "status": "pending_client"}


async def _approve_task_mark_done(
    pool, task: dict, task_id: str, notes: str, user: dict
) -> dict:
    """Approve by moving the task to the done column."""
    done_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND is_done=TRUE"
        " ORDER BY sort_order DESC LIMIT 1",
        task["team_id"],
    )
    new_col_id = done_col["column_id"] if done_col else task["column_id"]
    await pool.execute(
        "UPDATE tasks SET approval_status='approved', approved_by=$1, approval_notes=$2,"
        " approval_decided_at=NOW(), column_id=$3, status='done',"
        " completed_at=NOW(), completed_by_user_id=$1, updated_at=NOW() WHERE task_id=$4",
        user["user_id"], notes, new_col_id, task_id,
    )
    if task["created_by_user_id"] and task["created_by_user_id"] != user["user_id"]:
        await create_notification(
            pool, task["created_by_user_id"], "approved",
            f"Task approved: {task['title']}", notes or "",
            task_id, task["team_id"], "/tasks",
        )
    return {"ok": True, "status": "approved", "new_column_id": new_col_id}


@api_router.post("/approvals/{approval_id}/review")
async def review_approval(approval_id:str,body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Approve or reject a task creation request or task-level approval."""
    try:
        return await _review_approval_inner(approval_id, body, pool, user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("review_approval 500: approval_id=%s error=%s", approval_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Approval error: {type(exc).__name__}: {exc}")

async def _review_approval_inner(approval_id:str,body:dict,pool,user):
    status=body.get("status"); notes=body.get("notes","")
    send_to_client = body.get("send_to_client", False)
    client_email   = body.get("client_email", "")
    if status not in ("approved","rejected"): raise HTTPException(400,"status must be approved or rejected")
    if approval_id.startswith("task_approval--"):
        task_id = approval_id.split("--", 1)[1]
        # Must be owner/admin of the project
        task = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
        if not task: raise HTTPException(404, "Task not found")
        is_pa = await pool.fetchrow(
            "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin')",
            task["team_id"], user["user_id"]
        )
        is_tm = await pool.fetchrow(
            "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin') AND status='active'",
            task["team_id"], user["user_id"]
        )
        user_data = await pool.fetchrow(_SQL_USER_ROLE, user["user_id"])
        is_admin = user_data and user_data["role"] == "admin"
        if not (is_pa or is_tm or is_admin):
            raise HTTPException(403, "Only project owner/admin can review task approvals")

        if status == "rejected":
            if not notes: raise HTTPException(400, "Rejection reason is required")
            return await _reject_task_approval(pool, dict(task), task_id, notes, user)
        if send_to_client and client_email:
            return await _approve_task_send_client(pool, dict(task), task_id, notes, client_email, user)
        return await _approve_task_mark_done(pool, dict(task), task_id, notes, user)
    approval=await pool.fetchrow("SELECT * FROM approvals WHERE approval_id=$1",approval_id)
    if not approval: raise HTTPException(404)
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",approval["team_id"],user["user_id"])
    if not mem:
        mem = await pool.fetchrow(
            "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
            approval["team_id"], user["user_id"]
        )
    user_data=await pool.fetchrow(_SQL_USER_ROLE,user["user_id"])
    is_owner_admin = mem and mem["role"] in ("owner","admin")
    is_system_admin = user_data and user_data["role"] == "admin"
    if not (is_owner_admin or is_system_admin):
        raise HTTPException(403, "Not authorised to review this approval")
    await pool.execute("UPDATE approvals SET status=$1,reviewed_by=$2,reviewed_at=NOW(),review_notes=$3 WHERE approval_id=$4",status,user["user_id"],notes,approval_id)
    if approval["request_type"]=="create":
        data=json.loads(approval["request_data"])
        existing_task_id=data.get("task_id")
        if status=="approved":
            if existing_task_id:
                # Task already exists with status='requested' — promote to 'todo'
                first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order LIMIT 1",approval["team_id"])
                col=first_col["column_id"] if first_col else None
                await pool.execute("UPDATE tasks SET status='todo',column_id=COALESCE($1,column_id),updated_at=NOW() WHERE task_id=$2",col,existing_task_id)
            else:
                # Legacy: no task yet — create it
                task_id=f"task_{uuid.uuid4().hex[:12]}"
                col=await pool.fetchval("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order LIMIT 1",approval["team_id"])
                await pool.execute("INSERT INTO tasks (task_id,team_id,column_id,created_by_user_id,title,description,status,priority,approval_id) VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$8)",
                    task_id,approval["team_id"],col,approval["requested_by"],data["title"],data.get("description"),data.get("priority","medium"),approval_id)
        elif status=="rejected" and existing_task_id:
            # Remove the 'requested' task since it was declined
            await pool.execute("DELETE FROM tasks WHERE task_id=$1 AND status='requested'",existing_task_id)
        # Email the requester (client) about the decision
        if status == "approved":
            try:
                requester = await pool.fetchrow(
                    "SELECT email, COALESCE(full_name, name, email) AS name FROM users WHERE user_id=$1",
                    approval["requested_by"]
                )
                reviewer_name = actor_display(user, "")
                if requester and requester["email"]:
                    from email_service import send_request_approved_email
                    send_request_approved_email(
                        requester["email"], requester["name"],
                        reviewer_name=reviewer_name,
                        task_title=data.get("title", "your task"),
                    )
            except Exception as _exc:
                logger.warning("request approved email failed: %s", _exc)
    return {"ok":True,"status":status}

# ── Comments ────────────────────────────────────────────────────

@api_router.get("/tasks/{task_id}/comments",response_model=List[CommentOut])
async def list_comments(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Return all comments on a task in chronological order."""
    if user.get("role")=="client":
        if not await client_can_access_task(pool, task_id, user["user_id"]):
            raise HTTPException(403, "Not authorised to view comments on this task")
    rows=await pool.fetch("SELECT c.comment_id,c.task_id,c.user_id,COALESCE(u.full_name,u.name) AS user_name,c.body,c.created_at FROM task_comments c JOIN users u ON u.user_id=c.user_id WHERE c.task_id=$1 ORDER BY c.created_at ASC",task_id)
    return [CommentOut(**dict(r)) for r in rows]

@api_router.post("/tasks/{task_id}/comments",response_model=CommentOut)
async def add_comment(task_id:str,body:CommentCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Add a comment to a task and fan-out notifications to relevant users."""
    if user.get("role")=="client":
        if not await client_can_access_task(pool, task_id, user["user_id"]):
            raise HTTPException(403, "Not authorised to comment on this task")
    comment_id=f"cmt_{uuid.uuid4().hex[:12]}"
    row=await pool.fetchrow("INSERT INTO task_comments (comment_id,task_id,user_id,body) VALUES ($1,$2,$3,$4) RETURNING *",comment_id,task_id,user["user_id"],body.body)
    try:
        task=await pool.fetchrow("SELECT title,team_id,created_by_user_id,assignee_user_ids FROM tasks WHERE task_id=$1",task_id)
        if task:
            recipients=set()
            if task["created_by_user_id"] and task["created_by_user_id"]!=user["user_id"]: recipients.add(task["created_by_user_id"])
            for uid in (task["assignee_user_ids"] or []):
                if uid!=user["user_id"]: recipients.add(uid)
            cr=await pool.fetch("SELECT user_id FROM task_clients WHERE task_id=$1",task_id)
            for c in cr:
                if c["user_id"]!=user["user_id"]: recipients.add(c["user_id"])
            preview=body.body[:140]+("…" if len(body.body)>140 else "")
            actor_name=actor_display(user)
            for rid in recipients:
                await create_notification(pool,rid,"comment",f"New comment on {task['title']}",f"{actor_name}: {preview}",task_id,task["team_id"],"/tasks")
            if recipients:
                try:
                    from services.push_service import fan_out_push
                    task_owner_ids={task["created_by_user_id"]}|(set(task["assignee_user_ids"] or []))
                    asyncio.create_task(fan_out_push(
                        pool,
                        recipient_ids=list(recipients),
                        kind="comment",
                        title=f"New comment on {task['title']}",
                        body=f"{actor_name}: {preview}",
                        task_id=task_id,
                        is_mine_for=task_owner_ids,
                    ))
                except Exception as _pe:
                    logger.warning("comment push failed: %s", _pe)
            from services.mentions import process_mentions
            await process_mentions(pool,comment_id,body.body,task_id,user["user_id"])
            from services.activity_logger import log_event
            await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="commented",data={"preview":preview[:80]})
    except Exception as e:
        logger.warning("comment fan-out failed: %s", e)
    actor_name=actor_display(user)
    return CommentOut(comment_id=row["comment_id"],task_id=row["task_id"],user_id=row["user_id"],user_name=actor_name,body=row["body"],created_at=row["created_at"])

@api_router.put("/tasks/{task_id}/comments/{comment_id}",response_model=CommentOut)
async def edit_comment(task_id:str,comment_id:str,body:CommentCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Edit the body of an existing comment; only the author or an admin may do so."""
    row=await pool.fetchrow("SELECT * FROM task_comments WHERE comment_id=$1 AND task_id=$2",comment_id,task_id)
    if not row: raise HTTPException(404)
    if row["user_id"]!=user["user_id"] and user.get("role")!="admin":
        raise HTTPException(403,"Can only edit your own comments")
    updated=await pool.fetchrow("UPDATE task_comments SET body=$1 WHERE comment_id=$2 RETURNING *",body.body,comment_id)
    try:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="comment_edited",data={"preview":body.body[:80]})
    except Exception as _e: logger.debug("activity log failed (comment_edited): %s", _e)
    actor_name=actor_display(user)
    return CommentOut(comment_id=updated["comment_id"],task_id=updated["task_id"],user_id=updated["user_id"],user_name=actor_name,body=updated["body"],created_at=updated["created_at"])

@api_router.delete("/tasks/{task_id}/comments/{comment_id}")
async def delete_comment(task_id:str,comment_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Delete a task comment; only the author or an admin may do so."""
    row=await pool.fetchrow("SELECT user_id FROM task_comments WHERE comment_id=$1 AND task_id=$2",comment_id,task_id)
    if not row: raise HTTPException(404)
    if row["user_id"]!=user["user_id"] and user.get("role")!="admin":
        raise HTTPException(403,"Can only delete your own comments")
    await pool.execute("DELETE FROM task_comments WHERE comment_id=$1",comment_id)
    try:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="comment_deleted",data={})
    except Exception as _e: logger.debug("activity log failed (comment_deleted): %s", _e)
    return {"ok":True}

@api_router.post("/tasks/{task_id}/subtasks",response_model=TaskOut)
async def add_subtask(task_id:str,body:Subtask,pool=Depends(get_db),user=Depends(require_user)):
    """Append a new subtask to a task's subtask list."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    subtasks=json.loads(task["subtasks"] or "[]")
    new_sub={"subtask_id":f"sub_{uuid.uuid4().hex[:12]}","title":body.title,"is_done":False,"order":len(subtasks)}
    subtasks.append(new_sub)
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    try:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="subtask_added",data={"title":body.title})
    except Exception as _e: logger.debug("activity log failed (subtask_added): %s", _e)
    return row_to_task(row)

@api_router.patch("/tasks/{task_id}/subtasks/{subtask_id}",response_model=TaskOut)
async def toggle_subtask(task_id:str,subtask_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Toggle the is_done flag on a subtask."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    subtasks=json.loads(task["subtasks"] or "[]")
    for s in subtasks:
        if s["subtask_id"]==subtask_id: s["is_done"]=not s.get("is_done",False)
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    return row_to_task(row)

@api_router.delete("/tasks/{task_id}/subtasks/{subtask_id}",response_model=TaskOut)
async def delete_subtask(task_id:str,subtask_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Remove a subtask from a task's subtask list by its ID."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    subtasks=json.loads(task["subtasks"] or "[]")
    removed=[s for s in subtasks if s["subtask_id"]==subtask_id]
    subtasks=[s for s in subtasks if s["subtask_id"]!=subtask_id]
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    try:
        from services.activity_logger import log_event
        title=removed[0]["title"] if removed else ""
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="subtask_deleted",data={"title":title})
    except Exception as _e: logger.debug("activity log failed (subtask_deleted): %s", _e)
    return row_to_task(row)

class SubtaskPatch(BaseModel):
    assignee_user_id: Optional[str] = None
    title: Optional[str] = None

@api_router.put("/tasks/{task_id}/subtasks/{subtask_id}",response_model=TaskOut)
async def update_subtask(task_id:str,subtask_id:str,body:SubtaskPatch,pool=Depends(get_db),user=Depends(require_user)):
    """Update the title or assignee of an existing subtask."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    subtasks=json.loads(task["subtasks"] or "[]")
    for s in subtasks:
        if s["subtask_id"]==subtask_id:
            if body.assignee_user_id is not None:
                # Validate the assignee belongs to this task's team
                member=await pool.fetchrow(
                    "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 UNION SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' LIMIT 1",
                    task["team_id"], body.assignee_user_id
                )
                if not member: raise HTTPException(400,"Assignee is not a member of this project")
                s["assignee_user_id"]=body.assignee_user_id
            if body.title is not None: s["title"]=body.title
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    return row_to_task(row)

# ── Teams ────────────────────────────────────────────────────────

@api_router.get("/teams",response_model=List[TeamOut])
async def list_teams(pool=Depends(get_db),user=Depends(require_user)):
    """Return all projects visible to the authenticated user with task counts."""
    team_ids=await get_visible_team_ids(pool,user["user_id"])
    if not team_ids: return []
    rows=await pool.fetch("""
        SELECT t.*,
          COALESCE(tc.cnt,0)::int AS task_count,
          COALESCE(dc.cnt,0)::int AS done_count
        FROM teams t
        LEFT JOIN (SELECT team_id,COUNT(*) cnt FROM tasks GROUP BY team_id) tc ON tc.team_id=t.team_id
        LEFT JOIN (SELECT team_id,COUNT(*) cnt FROM tasks WHERE status='done' GROUP BY team_id) dc ON dc.team_id=t.team_id
        WHERE t.team_id=ANY($1::text[]) AND t.deleted_at IS NULL ORDER BY t.updated_at DESC
    """, team_ids)
    return [TeamOut(**dict(r)) for r in rows]

# ── MUST be before GET /teams/{team_id} to avoid "bin" matching as a team_id ──
@api_router.get("/teams/bin")
async def list_deleted_teams(pool=Depends(get_db),user=Depends(require_admin)):
    """List soft-deleted projects still within 30-day restore window."""
    rows = await pool.fetch("""
        SELECT t.*,
               COALESCE(u.full_name, u.name, u.email) AS deleted_by_name,
               EXTRACT(EPOCH FROM (NOW() - t.deleted_at)) / 86400 AS days_deleted
        FROM teams t
        LEFT JOIN users u ON u.user_id = t.deleted_by
        WHERE t.deleted_at IS NOT NULL
          AND t.deleted_at > NOW() - INTERVAL '30 days'
        ORDER BY t.deleted_at DESC
    """)
    return [dict(r) for r in rows]

async def _ensure_default_owner(pool, team_id: str, creator: dict):
    """Add DEFAULT_OWNER_EMAIL as owner on every project, unless they created it themselves."""
    if not DEFAULT_OWNER_EMAIL or creator.get("email", "").lower() == DEFAULT_OWNER_EMAIL.lower():
        return
    owner = await pool.fetchrow("SELECT user_id, email FROM users WHERE email=$1", DEFAULT_OWNER_EMAIL)
    if not owner:
        return
    # team_id is freshly created here, so no existing row can collide —
    # neither table has a unique constraint on (team_id,user_id) to upsert against.
    await pool.execute(
        "INSERT INTO team_members (member_id,team_id,email,user_id,role,status) "
        "VALUES ($1,$2,$3,$4,'owner','active')",
        f"mem_{uuid.uuid4().hex[:12]}", team_id, owner["email"], owner["user_id"],
    )
    await pool.execute(
        "INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by) "
        "VALUES ($1,$2,$3,'owner',$4)",
        f"assign_{uuid.uuid4().hex[:12]}", team_id, owner["user_id"], owner["user_id"],
    )


@api_router.post("/teams",response_model=TeamOut)
async def create_team(payload:TeamCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a new project and set the caller as owner with default kanban columns."""
    team_id=f"team_{uuid.uuid4().hex[:12]}"
    bs = json.dumps(payload.brand_settings or {"colors":[],"fonts":[]})
    row=await pool.fetchrow("INSERT INTO teams (team_id,name,created_by,brand_settings) VALUES ($1,$2,$3,$4::jsonb) RETURNING *",team_id,payload.name,user["user_id"],bs)
    await pool.execute("INSERT INTO team_members (member_id,team_id,email,user_id,role,status) VALUES ($1,$2,$3,$4,'owner','active')",f"mem_{uuid.uuid4().hex[:12]}",team_id,user["email"],user["user_id"])
    await pool.execute("INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by) VALUES ($1,$2,$3,'owner',$4)",f"assign_{uuid.uuid4().hex[:12]}",team_id,user["user_id"],user["user_id"])
    await _ensure_default_owner(pool,team_id,creator=user)
    await ensure_default_columns(pool,team_id)
    return TeamOut(**dict(row))

@api_router.patch("/teams/{team_id}/brand")
async def update_team_brand(team_id:str, body:dict, pool=Depends(get_db), user=Depends(require_user)):
    """Update a project's brand kit (colors + fonts). Owner/admin of the project only."""
    mem = await _team_membership(pool, team_id, user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    await pool.execute(
        "UPDATE teams SET brand_settings=$1::jsonb, updated_at=NOW() WHERE team_id=$2",
        json.dumps(body), team_id
    )
    return {"ok": True}

@api_router.get("/users")
async def list_users(pool=Depends(get_db),user=Depends(require_user)):
    """Return all registered users — for admin member picker."""
    if user.get("role") != "admin":  # system-role "owner" does not exist; admin only
        raise HTTPException(403,"Admins only")
    rows=await pool.fetch(
        "SELECT user_id,COALESCE(full_name,name,email) AS display_name,email,role,company_name FROM users ORDER BY display_name ASC"
    )
    return [dict(r) for r in rows]

@api_router.get("/teams/{team_id}")
async def get_team(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Return a project with its member list and the caller's role."""
    # Check project_assignments first, fall back to team_members
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem:
        tm=await pool.fetchrow("SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",team_id,user["user_id"])
        if not tm: raise HTTPException(403,_NOT_TEAM_MEMBER)
        mem=tm
    team=await pool.fetchrow("SELECT * FROM teams WHERE team_id=$1",team_id)
    members=await pool.fetch("""
        SELECT tm.*,COALESCE(u.full_name,u.name,u.email) AS display_name,
               u.position,u.company_name,u.member_role,u.receives_approval_emails
        FROM team_members tm LEFT JOIN users u ON u.user_id=tm.user_id
        WHERE tm.team_id=$1 ORDER BY tm.created_at ASC""",team_id)
    return {"team":dict(team),"members":[dict(m) for m in members],"your_role":mem["role"]}

@api_router.get("/teams/{team_id}/clients")
async def list_team_clients(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Returns users with role='client' in the team — for the send-to-client dropdown."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,_NOT_TEAM_MEMBER)
    rows=await pool.fetch("""
        SELECT tm.user_id, COALESCE(u.full_name,u.name,u.email) AS display_name, u.email
        FROM team_members tm
        LEFT JOIN users u ON u.user_id=tm.user_id
        WHERE tm.team_id=$1 AND tm.status='active' AND tm.user_id IS NOT NULL
          AND tm.role='client'
        ORDER BY display_name ASC
    """,team_id)
    return [dict(r) for r in rows]

@api_router.get("/teams/{team_id}/members")
async def list_team_members(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Returns member list for @mention autocomplete. Accessible to all project members incl. clients."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,_NOT_TEAM_MEMBER)
    rows=await pool.fetch("""
        SELECT tm.user_id, COALESCE(u.full_name,u.name,u.email) AS display_name, u.email
        FROM team_members tm
        LEFT JOIN users u ON u.user_id=tm.user_id
        WHERE tm.team_id=$1 AND tm.status='active' AND tm.user_id IS NOT NULL
        ORDER BY display_name ASC
    """,team_id)
    return [dict(r) for r in rows]

@api_router.post("/teams/{team_id}/members",response_model=TeamMemberOut)
async def add_team_member(team_id:str,payload:TeamMemberAdd,pool=Depends(get_db),user=Depends(require_user)):
    """Add or re-invite a member to a project by email."""
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    email=payload.email.strip().lower()
    existing_user=await pool.fetchrow("SELECT user_id FROM users WHERE email=$1",email)
    uid=existing_user["user_id"] if existing_user else None
    await pool.execute("DELETE FROM team_members WHERE team_id=$1 AND email=$2",team_id,email)
    if uid: await pool.execute("DELETE FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,uid)
    row=await pool.fetchrow("INSERT INTO team_members (member_id,team_id,email,user_id,role,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        f"mem_{uuid.uuid4().hex[:12]}",team_id,email,uid,payload.role,"active" if uid else "invited")
    if uid: await pool.execute("INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (team_id,user_id) DO UPDATE SET role=EXCLUDED.role",
        f"assign_{uuid.uuid4().hex[:12]}",team_id,uid,payload.role,user["user_id"])
    return TeamMemberOut(**dict(row))

@api_router.put("/teams/{team_id}/members/{member_id}",response_model=TeamMemberOut)
async def update_team_member(team_id:str,member_id:str,payload:TeamMemberUpdate,pool=Depends(get_db),user=Depends(require_user)):
    """Update a team member's role or status within a project."""
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    updates,vals=[],[]
    if payload.role:   updates.append(f"role=${len(vals)+1}");   vals.append(payload.role)
    if payload.status: updates.append(f"status=${len(vals)+1}"); vals.append(payload.status)
    updates.append(f"updated_at=${len(vals)+1}"); vals.append(now_utc()); vals+=[team_id,member_id]
    row=await pool.fetchrow(f"UPDATE team_members SET {', '.join(updates)} WHERE team_id=${len(vals)-1} AND member_id=${len(vals)} RETURNING *",*vals)
    if not row: raise HTTPException(404)
    # FIX #5: only sync project_assignments role when a role was actually provided.
    # Without this guard a status-only PATCH would write None/NULL into role.
    if payload.role and row["user_id"]:
        await pool.execute("UPDATE project_assignments SET role=$1 WHERE team_id=$2 AND user_id=$3",payload.role,team_id,row["user_id"])
    return TeamMemberOut(**dict(row))

@api_router.delete("/teams/{team_id}")
async def delete_team(team_id:str,pool=Depends(get_db),user=Depends(require_admin)):
    """Soft-delete: move project to bin. Hard-purged after 30 days."""
    team = await pool.fetchrow("SELECT team_id FROM teams WHERE team_id=$1 AND deleted_at IS NULL", team_id)
    if not team: raise HTTPException(404, "Project not found")
    await pool.execute(
        "UPDATE teams SET deleted_at=NOW(), deleted_by=$1 WHERE team_id=$2",
        user["user_id"], team_id
    )
    return {"ok": True, "soft_deleted": True}

@api_router.post("/teams/{team_id}/restore")
async def restore_team(team_id:str,pool=Depends(get_db),user=Depends(require_admin)):
    """Restore a soft-deleted project from the bin."""
    team = await pool.fetchrow(
        "SELECT team_id FROM teams WHERE team_id=$1 AND deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '30 days'",
        team_id
    )
    if not team: raise HTTPException(404, "Project not found in bin or restore window expired")
    await pool.execute("UPDATE teams SET deleted_at=NULL, deleted_by=NULL WHERE team_id=$1", team_id)
    return {"ok": True}

@api_router.delete("/teams/{team_id}/purge")
async def purge_team(team_id:str,pool=Depends(get_db),user=Depends(require_admin)):
    """Permanently delete a project from the bin."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM activity_events WHERE team_id=$1", team_id)
            await conn.execute("DELETE FROM time_entries WHERE task_id IN (SELECT task_id FROM tasks WHERE team_id=$1)", team_id)
            await conn.execute("DELETE FROM tasks WHERE team_id=$1", team_id)
            await conn.execute("DELETE FROM project_assignments WHERE team_id=$1", team_id)
            await conn.execute("DELETE FROM team_members WHERE team_id=$1", team_id)
            await conn.execute("DELETE FROM project_columns WHERE team_id=$1", team_id)
            await conn.execute("DELETE FROM automations WHERE team_id=$1", team_id)
            try: await conn.execute("DELETE FROM approvals WHERE team_id=$1", team_id)
            except Exception as exc:
                logger.debug("DELETE approvals skipped (table may not exist): %s", exc)
            await conn.execute("DELETE FROM teams WHERE team_id=$1", team_id)
    return {"ok": True}

@api_router.patch("/teams/{team_id}/color")
async def set_team_color(team_id:str,body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Set project colour (hex string). Any project member can update."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,"Not a project member")
    color = body.get("color")
    if not color or not isinstance(color, str) or not color.startswith("#"):
        raise HTTPException(400, "color must be a hex string e.g. #05b7aa")
    await pool.execute("UPDATE teams SET color=$1 WHERE team_id=$2", color, team_id)
    return {"ok": True, "color": color}

@api_router.delete("/teams/{team_id}/members/{member_id}")
async def remove_team_member(team_id:str,member_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Remove a member from a project and revoke their project assignment."""
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    member=await pool.fetchrow("SELECT user_id FROM team_members WHERE team_id=$1 AND member_id=$2",team_id,member_id)
    await pool.execute("DELETE FROM team_members WHERE team_id=$1 AND member_id=$2",team_id,member_id)
    if member and member["user_id"]: await pool.execute("DELETE FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,member["user_id"])
    return {"ok":True}

# ── Categories ───────────────────────────────────────────────────

@api_router.get("/categories",response_model=List[CategoryOut])
async def list_categories(pool=Depends(get_db),user=Depends(require_user)):
    """Return all task categories belonging to the authenticated user."""
    return [CategoryOut(**dict(r)) for r in await pool.fetch("SELECT * FROM categories WHERE user_id=$1 ORDER BY updated_at DESC",user["user_id"])]

@api_router.post("/categories",response_model=CategoryOut)
async def create_category(payload:CategoryCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a new task category for the authenticated user."""
    row=await pool.fetchrow("INSERT INTO categories (category_id,user_id,name,color) VALUES ($1,$2,$3,$4) RETURNING *",f"cat_{uuid.uuid4().hex[:12]}",user["user_id"],payload.name,payload.color)
    return CategoryOut(**dict(row))

@api_router.delete("/categories/{category_id}")
async def delete_category(category_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Delete a category and unlink it from all tasks."""
    await pool.execute("UPDATE tasks SET category_id=NULL,updated_at=NOW() WHERE user_id=$1 AND category_id=$2",user["user_id"],category_id)
    await pool.execute("DELETE FROM categories WHERE user_id=$1 AND category_id=$2",user["user_id"],category_id)
    return {"ok":True}

# ── Tasks ────────────────────────────────────────────────────────

@api_router.get("/tasks",response_model=List[TaskOut])
async def list_tasks(status:Optional[str]=None,category_id:Optional[str]=None,q:Optional[str]=None,
                     team_id:Optional[str]=None,assigned_to_me:Optional[bool]=None,
                     archived:Optional[bool]=False,
                     limit:Optional[int]=500,offset:Optional[int]=0,
                     pool=Depends(get_db),user=Depends(require_user)):
    """Return all tasks visible to the user, with optional filters for status, category, team, and search."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    conditions=["(t.user_id=$1 OR t.team_id=ANY($2::text[])"
                " OR t.created_by_user_id=$1"
                " OR EXISTS(SELECT 1 FROM task_clients tc WHERE tc.task_id=t.task_id AND tc.user_id=$1))"]
    if archived:
        conditions.append("t.archived_at IS NOT NULL")
    else:
        conditions.append("t.archived_at IS NULL")
    vals=[user["user_id"],team_ids]
    if team_id:        conditions.append(f"t.team_id=${len(vals)+1}");       vals.append(team_id)
    if status:         conditions.append(f"t.status=${len(vals)+1}");         vals.append(status)
    if category_id:    conditions.append(f"t.category_id=${len(vals)+1}");   vals.append(category_id)
    if q:              conditions.append(f"t.title ILIKE ${len(vals)+1}");    vals.append(f"%{q}%")
    if assigned_to_me: conditions.append(f"${len(vals)+1}=ANY(t.assignee_user_ids)"); vals.append(user["user_id"])
    _lim = min(limit if limit is not None else 500, 500)
    _off = max(offset if offset is not None else 0, 0)
    _lim_idx = len(vals) + 1
    _off_idx = len(vals) + 2
    rows=await pool.fetch(f"""
        SELECT t.*,
               COALESCE(cu.full_name,cu.name,cu.email) AS created_by_name,
               ARRAY(
                 SELECT COALESCE(au.full_name,au.name,au.email)
                 FROM unnest(t.assignee_user_ids) AS uid
                 LEFT JOIN users au ON au.user_id=uid
               ) AS assignee_names,
               pc.name AS column_name,
               pc.color AS column_color
        FROM tasks t
        LEFT JOIN users cu ON cu.user_id=t.created_by_user_id
        LEFT JOIN project_columns pc ON pc.column_id=t.column_id
        WHERE {' AND '.join(conditions)}
        ORDER BY t.sort_order ASC
        LIMIT ${_lim_idx} OFFSET ${_off_idx}
    """,*vals, _lim, _off)
    return [row_to_task(r) for r in rows]


@api_router.post("/tasks/auto-archive")
async def auto_archive_tasks(pool=Depends(get_db),user=Depends(require_user)):
    """Archive all done tasks that have been completed for more than 30 days."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    result=await pool.execute("""
        UPDATE tasks SET archived_at=NOW(), updated_at=NOW()
        WHERE archived_at IS NULL
          AND completed_at IS NOT NULL
          AND completed_at < NOW() - INTERVAL '30 days'
          AND (user_id=$1 OR team_id=ANY($2::text[]) OR created_by_user_id=$1)
          AND (
            status='done'
            OR column_id IN (
              SELECT column_id FROM project_columns WHERE is_done=TRUE
            )
          )
    """,user["user_id"],team_ids)
    count=int((result or "UPDATE 0").split()[-1])
    return {"archived":count}


@api_router.patch("/tasks/{task_id}/archive",response_model=TaskOut)
async def archive_task(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Manually archive a single task."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    row=await pool.fetchrow("""
        UPDATE tasks SET archived_at=NOW(), updated_at=NOW()
        WHERE task_id=$1 AND archived_at IS NULL
          AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)
        RETURNING *
    """,task_id,user["user_id"],team_ids)
    if not row: raise HTTPException(404)
    return row_to_task(row)


@api_router.patch("/tasks/{task_id}/unarchive",response_model=TaskOut)
async def unarchive_task(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Restore an archived task back to the active list."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    row=await pool.fetchrow("""
        UPDATE tasks SET archived_at=NULL, updated_at=NOW()
        WHERE task_id=$1 AND archived_at IS NOT NULL
          AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)
        RETURNING *
    """,task_id,user["user_id"],team_ids)
    if not row: raise HTTPException(404)
    return row_to_task(row)


@api_router.post("/tasks",response_model=TaskOut)
async def create_task(payload:TaskCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a task, send assignment notifications, and fire automation rules."""
    if payload.team_id:
        mem=await is_project_member(pool,payload.team_id,user)
        if not mem: raise HTTPException(403)
        user_id_field,scope_col,scope_val=None,"team_id",payload.team_id
    else:
        user_id_field,scope_col,scope_val=user["user_id"],"user_id",user["user_id"]
    if scope_col not in _VALID_SCOPE_COLS:
        raise ValueError(f"Invalid scope_col: {scope_col!r}")
    column_id=payload.column_id
    if not column_id and payload.team_id:
        first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC LIMIT 1",payload.team_id)
        column_id=first_col["column_id"] if first_col else None
    status=payload.status or "todo"
    if column_id:
        col=await pool.fetchrow("SELECT is_done FROM project_columns WHERE column_id=$1",column_id)
        if col and col["is_done"]: status="done"
    due_dt=parse_dt(payload.due_at)
    reminder_dt=parse_dt(payload.reminder_at) or (due_dt-timedelta(hours=2) if due_dt else None)
    max_row=await pool.fetchrow(f"SELECT MAX(sort_order) AS mo FROM tasks WHERE {scope_col}=$1 AND column_id=$2",scope_val,column_id)
    next_order=(max_row["mo"] or -1)+1; task_id=f"task_{uuid.uuid4().hex[:12]}"
    actor_name=actor_display(user)
    row=await pool.fetchrow("""
        INSERT INTO tasks (task_id,user_id,team_id,column_id,created_by_user_id,assigned_by_user_id,
           created_by_name,title,description,status,priority,category_id,tags,assignee_user_ids,assignee_emails,
           due_at,reminder_at,recurrence_rule,recurrence_interval,estimated_minutes,attachments,custom_fields,subtasks,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14::text[],$15::text[],
                $16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24)
        RETURNING *""",
        task_id,user_id_field,payload.team_id,column_id,user["user_id"],
        user["user_id"] if (payload.assignee_user_ids or payload.assignee_emails) else None,
        actor_name,payload.title,payload.description,status,payload.priority,payload.category_id,
        payload.tags or [],payload.assignee_user_ids or [],
        [e.strip().lower() for e in payload.assignee_emails if e.strip()],
        due_dt,reminder_dt,payload.recurrence.rule,payload.recurrence.interval,payload.estimated_minutes,
        json.dumps([a.model_dump() for a in payload.attachments or []]),
        json.dumps(payload.custom_fields or {}),json.dumps([s.model_dump() for s in payload.subtasks or []]),next_order)
    team_name=None
    if payload.team_id:
        tr=await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1",payload.team_id)
        team_name=tr["name"] if tr else None
    for uid in set(payload.assignee_user_ids or []):
        if uid==user["user_id"]: continue
        await create_notification(pool,uid,"assigned","Task assigned",f"You were assigned: {payload.title}",task_id,payload.team_id,"/tasks")
        try:
            from email_service import send_task_assignment_email
            assignee=await pool.fetchrow("SELECT email,COALESCE(full_name,name) AS name FROM users WHERE user_id=$1",uid)
            if assignee: send_task_assignment_email(assignee["email"],assignee["name"] or assignee["email"],payload.title,task_id,team_name)
        except Exception as e:
            logger.warning("assignment email failed: %s", e)
    from services.activity_logger import log_event
    await log_event(pool,task_id=task_id,team_id=payload.team_id,actor_id=user["user_id"],event_type="created",data={"title":payload.title})
    from services.automation_engine import fire_automations
    _bg(fire_automations(pool,"task_created",{"task":{"task_id":task_id,"team_id":payload.team_id},"team_id":payload.team_id}), label="fire_automations")
    out=await _fetch_enriched_task(pool,task_id)
    out.reminders=await _replace_task_reminders(pool,task_id,due_dt,payload.reminders)
    return out


async def _notify_status_changed(pool, row, existing, old_status: str, new_status: str, actor: dict, task_id: str):
    """Fan-out in-app + email notifications after a task status change."""
    actor_name   = actor_display(actor, "Someone")
    actor_id     = actor["user_id"]
    assignees    = list(row.get("assignee_user_ids") or [])
    creator_id   = existing["created_by_user_id"]
    team_id      = existing.get("team_id")

    # Notify: assignees + creator, excluding the actor
    notif_targets = list({uid for uid in assignees + ([creator_id] if creator_id else []) if uid and uid != actor_id})

    # In-app notifications
    for uid in notif_targets:
        try:
            await create_notification(pool, uid, "status_changed",
                f"Task status updated: {row['title']}",
                f"{actor_name} moved it to {new_status}",
                task_id, team_id, "/tasks")
        except Exception:
            pass

    # Email notifications
    try:
        if notif_targets:
            user_rows = await pool.fetch(
                "SELECT user_id, COALESCE(full_name,name,email) AS name, email FROM users WHERE user_id=ANY($1::text[])",
                notif_targets
            )
            project_row  = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", team_id) if team_id else None
            project_name = project_row["name"] if project_row else None
            from email_service import send_status_changed_email
            for ur in user_rows:
                if ur["email"]:
                    send_status_changed_email(
                        ur["email"], ur["name"] or ur["email"],
                        actor_name, row["title"], task_id,
                        new_status, project=project_name,
                    )
    except Exception as _e:
        logger.warning("status_changed email failed: %s", _e)

    # Task-done: notify ALL project members
    if new_status == "done" and team_id:
        try:
            member_rows = await pool.fetch("""
                SELECT DISTINCT u.user_id, COALESCE(u.full_name,u.name,u.email) AS name, u.email
                FROM team_members tm
                JOIN users u ON u.user_id = tm.user_id
                WHERE tm.team_id=$1 AND tm.status='active' AND tm.user_id IS NOT NULL
                  AND tm.user_id != $2
            """, team_id, actor_id)
            project_row  = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", team_id) if not locals().get("project_name") else None
            project_name = (project_row["name"] if project_row else None) if project_row else locals().get("project_name")
            from email_service import send_task_done_email
            for mr in member_rows:
                if mr["email"]:
                    # In-app notification
                    try:
                        await create_notification(pool, mr["user_id"], "done",
                            f"Task completed: {row['title']}",
                            f"{actor_name} marked it as done.",
                            task_id, team_id, "/tasks")
                    except Exception:
                        pass
                    # Email
                    send_task_done_email(
                        mr["email"], mr["name"] or mr["email"],
                        actor_name, row["title"],
                    )
        except Exception as _e:
            logger.warning("task_done notification failed: %s", _e)


async def _fetch_enriched_task(pool, task_id: str) -> "TaskOut":
    """Re-fetch a task with all JOIN'd fields (column_name, column_color, assignee_names)."""
    row = await pool.fetchrow("""
        SELECT t.*,
               COALESCE(cu.full_name, cu.name, cu.email) AS created_by_name,
               ARRAY(
                 SELECT COALESCE(u.full_name, u.name, u.email)
                 FROM unnest(t.assignee_user_ids) AS aid
                 JOIN users u ON u.user_id = aid
               ) AS assignee_names,
               pc.name  AS column_name,
               pc.color AS column_color
        FROM tasks t
        LEFT JOIN users cu ON cu.user_id = t.created_by_user_id
        LEFT JOIN project_columns pc ON pc.column_id = t.column_id
        WHERE t.task_id = $1
    """, task_id)
    if not row: return None
    out = row_to_task(row)
    out.reminders = await _fetch_task_reminders(pool, task_id)
    return out

def _filter_private_attachments(task_out, user_id: str, is_creator: bool) -> "TaskOut":
    """Strip private attachments the caller is not allowed to see."""
    filtered = [
        a for a in (task_out.attachments or [])
        if not a.is_private or is_creator or user_id in (a.visible_to or [])
    ]
    task_out.attachments = filtered
    return task_out

@api_router.get("/tasks/{task_id}",response_model=TaskOut)
async def get_task(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Return a single task by ID, enforcing visibility and access rules."""
    row=await pool.fetchrow("SELECT t.*,COALESCE(u.full_name,u.name,u.email) AS created_by_name FROM tasks t LEFT JOIN users u ON u.user_id=t.created_by_user_id WHERE t.task_id=$1",task_id)
    if not row: raise HTTPException(404)
    uid=user["user_id"]; is_creator=row["created_by_user_id"]==uid
    async def _out():
        enriched = await _fetch_enriched_task(pool, task_id)
        return _filter_private_attachments(enriched, uid, is_creator or user.get("role")=="admin")
    if user.get("role")=="admin": return await _out()
    if is_creator: return await _out()
    if uid in (row["assignee_user_ids"] or []): return await _out()
    if row["team_id"]:
        team_ids=await get_visible_team_ids(pool,uid,_user_dict=user)
        if row["team_id"] in team_ids: return await _out()
    client_link=await pool.fetchrow("SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2",task_id,uid)
    if client_link: return await _out()
    raise HTTPException(403,"Not authorized")


@api_router.put("/tasks/{task_id}/reminders",response_model=List[ReminderOut])
async def set_task_reminders(task_id:str,payload:List[ReminderIn],pool=Depends(get_db),user=Depends(require_user)):
    """Replace all pending reminders for a task. Usable at creation time or any time after, from the drawer."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    existing=await pool.fetchrow(
        "SELECT due_at FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id,user["user_id"],team_ids
    )
    if not existing: raise HTTPException(404)
    if not existing["due_at"] and payload:
        raise HTTPException(400,"Task has no due date — set one before adding reminders")
    return await _replace_task_reminders(pool,task_id,existing["due_at"],payload)


@api_router.put("/tasks/{task_id}",response_model=TaskOut)
async def update_task(task_id:str,payload:TaskUpdate,pool=Depends(get_db),user=Depends(require_user)):
    """Update allowed task fields and emit activity events for status and assignee changes."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    existing=await pool.fetchrow(
        "SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id,user["user_id"],team_ids
    )
    if not existing:
        if await client_can_access_task(pool, task_id, user["user_id"]):
            existing = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
        if not existing: raise HTTPException(404)
    data=payload.model_dump(exclude_unset=True); updates,vals=[],[]
    old_status=existing["status"]; old_assignees=list(existing.get("assignee_user_ids") or [])
    # approval_status gated: only admins/owners may approve or reject
    if "approval_status" in data and data["approval_status"] in ("approved","rejected"):
        is_sys_admin = user.get("role") == "admin"
        member_role = None
        if existing["team_id"]:
            mr = await pool.fetchrow(
                "SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",
                existing["team_id"], user["user_id"]
            )
            member_role = mr["role"] if mr else None
        if not is_sys_admin and member_role not in ("owner", "admin"):
            raise HTTPException(403, "Only project admins and owners can approve or reject tasks")
    for k in ["title","description","status","priority","category_id","estimated_minutes","column_id","approval_status"]:
        if k in data: updates.append(f"{k}=${len(vals)+1}"); vals.append(data[k])
    if "approval_status" in data and data["approval_status"] in ("approved","rejected"):
        updates.append(f"approved_by=${len(vals)+1}"); vals.append(user["user_id"])
        updates.append(f"approval_decided_at=${len(vals)+1}"); vals.append(now_utc())
    for k in ["tags","assignee_user_ids","assignee_emails"]:
        if k in data: updates.append(f"{k}=${len(vals)+1}::text[]"); vals.append(data[k])
    for k in ["attachments","custom_fields","subtasks"]:
        if k in data and data[k] is not None:
            updates.append(f"{k}=${len(vals)+1}::jsonb")
            v=data[k]; vals.append(json.dumps([i.model_dump() if hasattr(i,'model_dump') else i for i in v] if isinstance(v,list) else v))
    if "due_at" in data:      updates.append(f"due_at=${len(vals)+1}");      vals.append(parse_dt(data["due_at"]))
    if "reminder_at" in data: updates.append(f"reminder_at=${len(vals)+1}"); vals.append(parse_dt(data["reminder_at"]))
    if "recurrence" in data and data["recurrence"]:
        rec=data["recurrence"]
        updates.append(f"recurrence_rule=${len(vals)+1}");     vals.append(rec.get("rule","none") if isinstance(rec,dict) else rec.rule)
        updates.append(f"recurrence_interval=${len(vals)+1}"); vals.append(rec.get("interval",1) if isinstance(rec,dict) else rec.interval)
    if "column_id" in data and data["column_id"]:
        col=await pool.fetchrow("SELECT is_done FROM project_columns WHERE column_id=$1",data["column_id"])
        if col and col["is_done"] and "status" not in data: updates.append(f"status=${len(vals)+1}"); vals.append("done")
    if not updates: return row_to_task(existing)
    updates.append(f"updated_at=${len(vals)+1}"); vals.append(now_utc()); vals.append(task_id)
    row=await pool.fetchrow(f"UPDATE tasks SET {', '.join(updates)} WHERE task_id=${len(vals)} RETURNING *",*vals)
    new_status=row["status"]; new_assignees=list(row.get("assignee_user_ids") or [])
    from services.activity_logger import log_event, log_assigned, log_field_changed
    if old_status!=new_status:
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="status_changed",data={"from":old_status,"to":new_status})
        await _notify_status_changed(pool, row, existing, old_status, new_status, user, task_id)
        from services.automation_engine import fire_automations
        _bg(fire_automations(pool,"status_changed",{"task":{"task_id":task_id,"team_id":existing["team_id"]},"team_id":existing["team_id"],"from":old_status,"to":new_status}), label="fire_automations")
    for _field in ["title","description","priority"]:
        if _field in data and data[_field] != existing.get(_field):
            await log_field_changed(pool,task_id=task_id,actor_id=user["user_id"],field_name=_field,from_val=existing.get(_field),to_val=data[_field])
    if "due_at" in data:
        old_due = str(existing.get("due_at") or "")
        new_due = str(parse_dt(data["due_at"]) or "")
        if old_due != new_due:
            await log_field_changed(pool,task_id=task_id,actor_id=user["user_id"],field_name="due_at",from_val=old_due or None,to_val=new_due or None)
    if "assignee_user_ids" in data:
        added=[u for u in new_assignees if u not in old_assignees]
        removed=[u for u in old_assignees if u not in new_assignees]
        if added or removed:
            await log_assigned(pool,task_id=task_id,actor_id=user["user_id"],added=added,removed=removed)
        if added:
            try:
                from services.push_service import fan_out_push
                actor_name=actor_display(user, "Someone")
                asyncio.create_task(fan_out_push(
                    pool,
                    recipient_ids=[u for u in added if u!=user["user_id"]],
                    kind="assigned",
                    title=f"You were assigned to {row['title']}",
                    body=f"Assigned by {actor_name}.",
                    task_id=task_id,
                    is_mine_for=set(added),
                ))
            except Exception as _pe:
                logger.warning("assignee push failed: %s", _pe)
    return await _fetch_enriched_task(pool, task_id)


@api_router.patch("/tasks/{task_id}",response_model=TaskOut)
async def patch_task(task_id:str,payload:TaskUpdate,pool=Depends(get_db),user=Depends(require_user)):
    """PATCH alias used by the client 'Mark as Reviewed' CTA."""
    return await update_task(task_id, payload, pool, user)


@api_router.post("/tasks/{task_id}/attachments", response_model=TaskOut)
async def add_task_attachment(
    task_id: str,
    file: UploadFile = File(...),
    pool=Depends(get_db),
    user=Depends(require_user),
):
    """Upload a file to R2 and append it to the task's attachments list."""
    from routers.uploads import MAX_BYTES, MAX_BYTES_VIDEO, ALLOWED_TYPES, ALLOWED_EXTENSIONS, VIDEO_EXTENSIONS
    from services.storage import upload_file
    import mimetypes as _mt

    # Access check
    team_ids = await get_visible_team_ids(pool, user["user_id"], _user_dict=user)
    row = await pool.fetchrow(
        "SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id, user["user_id"], team_ids,
    )
    if not row:
        if await client_can_access_task(pool, task_id, user["user_id"]):
            row = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
        if not row:
            raise HTTPException(404)

    fname = (file.filename or "upload").lower()
    ext   = "." + fname.rsplit(".", 1)[-1] if "." in fname else ""
    is_video = ext in VIDEO_EXTENSIONS
    limit = MAX_BYTES_VIDEO if is_video else MAX_BYTES

    content = await file.read()
    if len(content) > limit:
        label = "50 MB" if is_video else "5 MB"
        raise HTTPException(400, f"File exceeds {label} limit")

    mime  = file.content_type or _mt.guess_type(file.filename or "")[0] or "application/octet-stream"
    if mime not in ALLOWED_TYPES and not mime.startswith("video/") and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "File type not allowed.")
    if ext in {".heic", ".heif"} and mime == "application/octet-stream":
        mime = f"image/{ext.lstrip('.')}"
    if ext in VIDEO_EXTENSIONS and mime == "application/octet-stream":
        mime = "video/quicktime" if ext == ".mov" else f"video/{ext.lstrip('.')}"

    folder = f"projects/{row['team_id']}" if row.get("team_id") else None
    result = await upload_file(file_bytes=content, filename=file.filename or "upload", content_type=mime, user_id=user["user_id"], folder=folder)

    current = pj(row["attachments"], [])
    if len(current) >= 5:
        raise HTTPException(400, "Maximum 5 attachments per task")

    current.append({"name": file.filename or "upload", "url": result["url"], "key": result.get("key")})
    updated = await pool.fetchrow(
        "UPDATE tasks SET attachments=$1::jsonb, updated_at=$2 WHERE task_id=$3 RETURNING *",
        json.dumps(current), now_utc(), task_id,
    )
    return row_to_task(updated)


@api_router.delete("/tasks/{task_id}/attachments/{key:path}", response_model=TaskOut)
async def delete_task_attachment(
    task_id: str,
    key: str,
    pool=Depends(get_db),
    user=Depends(require_user),
):
    """Remove an attachment from a task by its R2 key."""
    team_ids = await get_visible_team_ids(pool, user["user_id"], _user_dict=user)
    row = await pool.fetchrow(
        "SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id, user["user_id"], team_ids,
    )
    if not row:
        raise HTTPException(404)

    current  = pj(row["attachments"], [])
    filtered = [a for a in current if a.get("key") != key]
    updated  = await pool.fetchrow(
        "UPDATE tasks SET attachments=$1::jsonb, updated_at=$2 WHERE task_id=$3 RETURNING *",
        json.dumps(filtered), now_utc(), task_id,
    )
    return row_to_task(updated)


@api_router.post("/admin/migrate-data-uris")
async def migrate_data_uri_attachments(pool=Depends(get_db)):
    """Re-upload data: URI attachments to R2. One-time migration for old files."""
    from services.storage import upload_file
    import base64, mimetypes as _mt

    rows = await pool.fetch("SELECT task_id, attachments FROM tasks WHERE attachments::text LIKE '%data:%'")
    migrated = 0
    errors = []
    for row in rows:
        raw = row["attachments"]
        atts = json.loads(raw) if isinstance(raw, str) else (raw or [])
        changed = False
        for att in atts:
            url = att.get("url", "")
            if not url.startswith("data:"):
                continue
            try:
                header, b64 = url.split(",", 1)
                mime = header.split(":")[1].split(";")[0] if ":" in header else "application/octet-stream"
                content = base64.b64decode(b64)
                fname = att.get("name", "file")
                ext = "." + fname.rsplit(".", 1)[-1] if "." in fname else ""
                if not ext:
                    ext_guess = _mt.guess_extension(mime) or ""
                    fname += ext_guess
                result = await upload_file(
                    file_bytes=content, filename=fname,
                    content_type=mime, user_id="migration",
                )
                att["url"] = result["url"]
                att["key"] = result.get("key")
                changed = True
                migrated += 1
            except Exception as exc:
                errors.append({"task_id": row["task_id"], "name": att.get("name"), "error": str(exc)})
        if changed:
            await pool.execute(
                "UPDATE tasks SET attachments=$1::jsonb, updated_at=$2 WHERE task_id=$3",
                json.dumps(atts), now_utc(), row["task_id"],
            )
    return {"migrated": migrated, "errors": errors}


@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Permanently delete a task; only project admins/owners or the personal task owner may delete."""
    doc=await pool.fetchrow("SELECT team_id FROM tasks WHERE task_id=$1",task_id)
    if not doc: raise HTTPException(404)
    # System admin can always delete
    if user.get("role")!="admin":
        if doc["team_id"]:
            mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",doc["team_id"],user["user_id"])
            if not mem or mem["role"] not in ("owner","admin"):
                raise HTTPException(403,"Only project admin or owner can delete tasks")
        else:
            # Personal task — only the owner can delete
            personal=await pool.fetchrow("SELECT user_id FROM tasks WHERE task_id=$1",task_id)
            if not personal or personal["user_id"]!=user["user_id"]:
                raise HTTPException(403,"Only project admin or owner can delete tasks")
    await pool.execute("DELETE FROM tasks WHERE task_id=$1",task_id)
    return {"ok":True}

@api_router.patch("/tasks/{task_id}/toggle",response_model=TaskOut)
async def toggle_task(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Toggle a task between done and todo status."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    doc=await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]))",task_id,user["user_id"],team_ids)
    if not doc: raise HTTPException(404)
    new_status="todo" if doc["status"]=="done" else "done"
    row=await pool.fetchrow("UPDATE tasks SET status=$1,completed_at=$2,completed_by_user_id=$3,updated_at=NOW() WHERE task_id=$4 RETURNING *",
        new_status,now_utc() if new_status=="done" else None,user["user_id"] if new_status=="done" else None,task_id)
    return row_to_task(row)

@api_router.patch("/tasks/{task_id}/move",response_model=TaskOut)
async def move_task(task_id:str,payload:TaskMoveIn,pool=Depends(get_db),user=Depends(require_user)):
    """Move a task to a different column and update its status accordingly."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    doc=await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]))",task_id,user["user_id"],team_ids)
    if not doc: raise HTTPException(404)
    col=await pool.fetchrow("SELECT * FROM project_columns WHERE column_id=$1",payload.column_id)
    if col and col["is_done"]:
        new_status="done"
    elif col:
        col_name=(col["name"] or "").lower()
        if "progress" in col_name or "review" in col_name or "doing" in col_name:
            new_status="in_progress"
        elif "approval" in col_name:
            new_status="in_review"
        elif "todo" in col_name or "to do" in col_name or "backlog" in col_name or "open" in col_name:
            new_status="todo"
        else:
            new_status="in_progress" if doc["status"]=="todo" else doc["status"]
    else:
        new_status=doc["status"]
    completed_at=now_utc() if new_status=="done" else None
    completed_by=user["user_id"] if new_status=="done" else None

    # Moving column resets pending approval; approved/rejected states are preserved
    new_approval_status = None if doc["approval_status"] == "pending" else doc["approval_status"]

    row=await pool.fetchrow(
        "UPDATE tasks SET column_id=$1,status=$2,sort_order=$3,completed_at=$4,completed_by_user_id=$5,approval_status=$6,updated_at=NOW() WHERE task_id=$7 RETURNING *",
        payload.column_id,new_status,payload.order,completed_at,completed_by,new_approval_status,task_id)
    if doc["status"]!=new_status:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="status_changed",data={"from":doc["status"],"to":new_status})
        await _notify_status_changed(pool, row, dict(doc), doc["status"], new_status, user, task_id)

    return await _fetch_enriched_task(pool, task_id)

# ── Notifications ─────────────────────────────────────────────────

@api_router.get("/notifications",response_model=List[NotificationOut])
async def list_notifications(unread_only:bool=False,pool=Depends(get_db),user=Depends(require_user)):
    """Return up to 200 notifications for the authenticated user, optionally filtering to unread only."""
    sql="SELECT * FROM notifications WHERE user_id=$1"+(" AND read_at IS NULL" if unread_only else "")+" ORDER BY created_at DESC LIMIT 200"
    return [NotificationOut(**dict(r)) for r in await pool.fetch(sql,user["user_id"])]

@api_router.post("/notifications/mark-read")
async def mark_read(payload:MarkReadIn,pool=Depends(get_db),user=Depends(require_user)):
    """Mark one, many, or all notifications as read for the authenticated user."""
    if payload.mark_all: await pool.execute("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL",user["user_id"])
    elif payload.notification_ids: await pool.execute("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND notification_id=ANY($2::text[])",user["user_id"],payload.notification_ids)
    return {"ok":True}

@api_router.post("/notifications/process")
async def process_notifications(pool=Depends(get_db),user=Depends(require_user)):
    """Process due task reminders and create notification rows for each."""
    team_ids=await get_visible_team_ids(pool,user["user_id"])
    rows=await pool.fetch("SELECT * FROM tasks WHERE (user_id=$1 OR team_id=ANY($2::text[])) AND status!='done' AND reminder_at IS NOT NULL AND reminder_at<=$3 AND reminder_sent_at IS NULL",user["user_id"],team_ids,now_utc())
    for t in rows:
        recipients=set(t["assignee_user_ids"] or [])
        if not recipients and t["user_id"]: recipients.add(t["user_id"])
        for uid in recipients:
            await create_notification(pool,uid,"reminder","Task reminder",f"Due soon: {t['title']}",t["task_id"],t["team_id"],"/tasks")
        await pool.execute("UPDATE tasks SET reminder_sent_at=NOW(),updated_at=NOW() WHERE task_id=$1",t["task_id"])
    return {"ok":True,"created":len(rows)}

@api_router.get("/dashboard/summary",response_model=DashboardSummaryOut)
async def dashboard_summary(pool=Depends(get_db),user=Depends(require_user)):
    """Return task count summary (todo, in-progress, done, overdue, due-24h) for the dashboard."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user); now=now_utc()
    row=await pool.fetchrow("""
        SELECT
          COUNT(*) FILTER (WHERE status='todo')        AS todo,
          COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
          COUNT(*) FILTER (WHERE status='done')        AS done,
          COUNT(*) FILTER (WHERE status!='done' AND due_at<$3)                         AS overdue,
          COUNT(*) FILTER (WHERE status!='done' AND due_at>=$3 AND due_at<$4)          AS due_24h
        FROM tasks
        WHERE (user_id=$1 OR team_id=ANY($2::text[]))
    """,user["user_id"],team_ids,now,now+timedelta(hours=24))
    return DashboardSummaryOut(todo=row["todo"],in_progress=row["in_progress"],done=row["done"],overdue=row["overdue"],due_24h=row["due_24h"])

@api_router.get("/notifications/poll")
async def poll_notifications(pool=Depends(get_db),user=Depends(require_user)):
    """Process due reminders, return unread count + any notifications created in the last 70 s."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user)
    # Process reminders
    rows=await pool.fetch(
        "SELECT * FROM tasks WHERE (user_id=$1 OR team_id=ANY($2::text[])) AND status!='done'"
        " AND reminder_at IS NOT NULL AND reminder_at<=$3 AND reminder_sent_at IS NULL",
        user["user_id"],team_ids,now_utc()
    )
    for t in rows:
        recipients=set(t["assignee_user_ids"] or [])
        if not recipients and t["user_id"]: recipients.add(t["user_id"])
        for uid in recipients:
            await create_notification(pool,uid,"reminder","Task reminder",f"Due soon: {t['title']}",t["task_id"],t["team_id"],"/tasks")
        await pool.execute("UPDATE tasks SET reminder_sent_at=NOW(),updated_at=NOW() WHERE task_id=$1",t["task_id"])
    unread=await pool.fetchval(
        "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL",
        user["user_id"]
    )
    # Return notifications created in the last 70 s so the client can toast them
    fresh=await pool.fetch(
        "SELECT * FROM notifications WHERE user_id=$1 AND read_at IS NULL"
        " AND created_at > NOW() - INTERVAL '70 seconds' ORDER BY created_at DESC LIMIT 5",
        user["user_id"]
    )
    return {
        "unread": unread or 0,
        "fresh": [NotificationOut(**dict(r)).model_dump(mode="json") for r in fresh],
    }

@api_router.get("/push/vapid-public-key")
async def get_vapid_public_key(user=Depends(require_user)):
    return {"public_key": VAPID_PUB if wp_is_configured() else "not-configured"}

@api_router.post("/push/subscribe")
async def subscribe_push(payload: PushSubscriptionIn, user=Depends(require_user)):
    pool = await get_pool()
    sub = payload.model_dump()
    await wp_save_subscription(pool, user["user_id"], sub)
    return {"ok": True}

@api_router.post("/push/unsubscribe")
async def unsubscribe_push(payload: PushSubscriptionIn, user=Depends(require_user)):
    pool = await get_pool()
    endpoint = (payload.model_dump() or {}).get("endpoint", "")
    if endpoint:
        await wp_remove_subscription(pool, endpoint)
    return {"ok": True}


# ── App assembly ────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(invite_router)
app.include_router(approvals_router)
app.include_router(health_router)
app.include_router(api_router)

# v2 routers
app.include_router(fields_router)
app.include_router(views_router)
app.include_router(automations_router)
app.include_router(activity_router)
app.include_router(dashboards_router)
app.include_router(templates_router)
app.include_router(time_router)
app.include_router(uploads_router)   # R2-backed file upload (replaces old base64 /api/upload)
app.include_router(reports_router)
app.include_router(task_reminders_router)


# ── Verse of the day (public) ────────────────────────────────────────────────
@app.get("/api/verse-of-the-day")
async def verse_of_the_day():
    """Return today's Bhagavad Gita verse — same verse for all users all day."""
    return await get_verse_of_the_day()


async def _run_startup_migrations():
    """Run idempotent schema migrations in the background so the server is ready immediately."""
    try:
        pool = await get_pool()
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS project_assignments (
                assignment_id TEXT PRIMARY KEY DEFAULT ('pa_' || substr(md5(random()::text), 1, 12)),
                team_id       TEXT NOT NULL,
                user_id       TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'member',
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(team_id, user_id)
            )
        """)
        await pool.execute("""
            CREATE INDEX IF NOT EXISTS idx_project_assignments_user ON project_assignments(user_id)
        """)
        await pool.execute("""
            CREATE INDEX IF NOT EXISTS idx_project_assignments_team ON project_assignments(team_id)
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS activity_events (
                event_id    TEXT PRIMARY KEY DEFAULT ('evt_' || substr(md5(random()::text), 1, 12)),
                task_id     TEXT REFERENCES tasks(task_id) ON DELETE CASCADE,
                team_id     TEXT NOT NULL,
                actor_id    TEXT,
                type        TEXT NOT NULL,
                data        JSONB DEFAULT '{}',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE INDEX IF NOT EXISTS idx_activity_events_team ON activity_events(team_id, created_at DESC)
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS time_entries (
                entry_id    TEXT PRIMARY KEY,
                task_id     TEXT REFERENCES tasks(task_id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                started_at  TIMESTAMPTZ,
                ended_at    TIMESTAMPTZ,
                minutes     INTEGER,
                description TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Soft-delete columns on teams
        await pool.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
        await pool.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_by TEXT")
        # Project colour
        await pool.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS color TEXT")
        # Mobile: push tokens + notification prefs
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS push_tokens (
                id          TEXT PRIMARY KEY DEFAULT ('pt_' || substr(md5(random()::text),1,12)),
                user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                platform    TEXT NOT NULL,
                token       TEXT NOT NULL,
                device_id   TEXT NOT NULL UNIQUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS notification_prefs (
                user_id     TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
                prefs       JSONB NOT NULL DEFAULT '{}',
                quiet_start TEXT NOT NULL DEFAULT '22:00',
                quiet_end   TEXT NOT NULL DEFAULT '07:00',
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Notifications table
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                notification_id TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                team_id         TEXT,
                type            TEXT NOT NULL,
                title           TEXT NOT NULL,
                message         TEXT NOT NULL DEFAULT '',
                task_id         TEXT,
                url             TEXT,
                read_at         TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)")
        # Custom fields tables
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS field_definitions (
                field_id    TEXT PRIMARY KEY,
                team_id     TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL,
                config      JSONB NOT NULL DEFAULT '{}',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS field_values (
                task_id     TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
                field_id    TEXT NOT NULL REFERENCES field_definitions(field_id) ON DELETE CASCADE,
                value       JSONB,
                PRIMARY KEY (task_id, field_id)
            )
        """)
        # (subtasks are JSONB — no separate table migration needed)
        # Approvals table (client task request workflow)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS approvals (
                approval_id  TEXT PRIMARY KEY,
                team_id      TEXT,
                requested_by TEXT,
                status       TEXT NOT NULL DEFAULT 'pending',
                request_type TEXT,
                request_data JSONB,
                task_id      TEXT,
                reviewed_by  TEXT,
                reviewed_at  TIMESTAMPTZ,
                review_notes TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_approvals_team ON approvals(team_id)")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON approvals(task_id)")
        await pool.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_id TEXT")
        # Web Push subscriptions
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS push_web_subscriptions (
                id         TEXT PRIMARY KEY DEFAULT ('pws_' || substr(md5(random()::text),1,12)),
                user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                endpoint   TEXT NOT NULL UNIQUE,
                p256dh     TEXT NOT NULL,
                auth       TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_pws_user ON push_web_subscriptions(user_id)")
        # Tasks extra columns
        await pool.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
        await pool.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by_user_id TEXT")
        # Report schedules
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS report_schedules (
                schedule_id   TEXT PRIMARY KEY,
                team_id       TEXT NOT NULL,
                created_by    TEXT,
                frequency     TEXT NOT NULL DEFAULT 'weekly',
                file_formats  TEXT[] NOT NULL DEFAULT ARRAY['pdf'],
                recipients    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                day_of_week   INTEGER,
                day_of_month  INTEGER,
                send_hour_utc INTEGER NOT NULL DEFAULT 2,
                is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                next_run_at   TIMESTAMPTZ,
                last_sent_at  TIMESTAMPTZ,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_report_sched_team ON report_schedules(team_id)")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_report_sched_next ON report_schedules(next_run_at) WHERE is_active=TRUE")
        # Task reminders (multi-offset, multi-channel)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS task_reminders (
                reminder_id     TEXT PRIMARY KEY DEFAULT ('tr_' || substr(md5(random()::text),1,12)),
                task_id         TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
                offset_minutes  INTEGER NOT NULL,
                channel_inapp   BOOLEAN NOT NULL DEFAULT TRUE,
                channel_push    BOOLEAN NOT NULL DEFAULT TRUE,
                channel_email   BOOLEAN NOT NULL DEFAULT FALSE,
                fire_at         TIMESTAMPTZ NOT NULL,
                sent_at         TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_task_reminders_due ON task_reminders(fire_at) WHERE sent_at IS NULL")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_task_reminders_task ON task_reminders(task_id)")
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS org_settings (
                key   TEXT PRIMARY KEY,
                value JSONB NOT NULL DEFAULT '[]'
            )
        """)
        await pool.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS brand_settings JSONB NOT NULL DEFAULT '{\"colors\":[],\"fonts\":[]}'::jsonb")
        logger.info("Startup migrations OK")
    except Exception as e:
        logger.warning("Startup migration warning (non-fatal): %s", e)


@app.on_event("startup")
async def startup():
    """Log configuration and kick off background migrations so the server is ready immediately."""
    dsn=os.environ.get("DATABASE_URL","NOT SET")
    if "@" in dsn:
        parts=dsn.split("@"); user_part=parts[0].split("://")[-1].split(":")[0]; host_part=parts[1]
        logger.info("DATABASE_URL: postgresql://%s:***@%s", user_part, host_part)
    else:
        logger.info("DATABASE_URL: %s", dsn)
    r2_bucket = os.environ.get("R2_BUCKET_NAME", "NOT SET")
    logger.info("R2_BUCKET: %s | R2_PUBLIC_URL: %s", r2_bucket, os.environ.get('R2_PUBLIC_URL', '<presigned>'))
    logger.info("CORS origins: %s", ALLOWED_ORIGINS)
    logger.info("Kartavaya API v2 ready — custom fields, automations, activity, time tracking, R2 uploads")
    # Run schema migrations in the background so gunicorn workers are ready immediately.
    # The healthcheck hits /api/health which also warms the pool, so the background task
    # completes well before real user traffic arrives.
    asyncio.create_task(_run_startup_migrations())

@app.on_event("shutdown")
async def shutdown():
    """Close the database connection pool on application shutdown."""
    await close_pool()

def App():
    """Return the FastAPI application instance (used by some ASGI runners)."""
    return app
