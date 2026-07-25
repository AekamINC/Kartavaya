"""
utils.py — shared helpers and Pydantic models for the Kartavaya API.

Anything that was previously inline in server.py and used by more than
one router lives here. Import from here, not from server.py.

Sections:
  1. datetime helpers       — now_utc(), parse_dt()
  2. DB dependency          — get_db()
  3. DB helpers             — get_visible_team_ids(), create_notification(),
                               ensure_default_columns(), client_can_access_task()
  4. Pydantic models        — all request/response models
  5. Row mapper             — row_to_task()
"""

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from db import get_pool


# ── 0. Logging helpers ───────────────────────────────────────────────────────

_CTRL_RE = re.compile(r'[\x00-\x1f\x7f]|\x1b\[[0-?]*[ -/]*[@-~]')


def log_safe(value: object) -> str:
    """Sanitize a value for use in log messages (CWE-117 log injection prevention).

    Strips all ASCII control characters (including CR/LF that could forge log
    entries) and ANSI escape sequences that could corrupt log output or terminals.
    """
    return _CTRL_RE.sub('', str(value))


# ── 1. Datetime helpers ───────────────────────────────────────────────────────

def now_utc() -> datetime:
    """Current UTC datetime, always timezone-aware."""
    return datetime.now(timezone.utc)


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 string to a timezone-aware datetime, or return None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid datetime: {value}") from e
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# Shared SQL fragments — import these instead of duplicating across routers
SQL_USER_ROLE = "SELECT role FROM users WHERE user_id=$1"

# ── 2. DB dependency ──────────────────────────────────────────────────────────

async def get_db():
    """FastAPI dependency — returns the asyncpg connection pool."""
    return await get_pool()


_ALLOWED_DOC_TABLES = {
    ("ganit_invoices", "invoice_number"),
    ("vikray_orders", "order_number"),
    ("vetana_payslips", "payslip_number"),
    ("ganit_vendor_bills", "internal_ref"),
}

async def next_doc_number(pool, org_id: str, table: str, column: str, prefix: str) -> str:
    """Generate next sequential document number: PREFIX-YYYY-0001.

    Shared by Ganit (invoices), Vikray (orders), and Vetana (payslips).
    Uses advisory lock to prevent race conditions producing duplicates.
    """
    if (table, column) not in _ALLOWED_DOC_TABLES:
        raise ValueError(f"Disallowed table/column: {table}.{column}")
    async with pool.acquire() as conn:
        lock_key = hash((org_id, table)) & 0x7FFFFFFF
        await conn.execute("SELECT pg_advisory_xact_lock($1)", lock_key)
        last = await conn.fetchval(
            f"SELECT {column} FROM staging.{table} "
            "WHERE org_id=$1::uuid ORDER BY created_at DESC LIMIT 1",
            org_id,
        )
        if last:
            parts = last.rsplit("-", 1)
            num = int(parts[-1]) + 1 if len(parts) == 2 and parts[-1].isdigit() else 1
        else:
            num = 1
        fy = datetime.now().year
        return f"{prefix}-{fy}-{num:04d}"


# ── 3. DB helpers ─────────────────────────────────────────────────────────────

async def get_visible_team_ids(pool, user_id: str) -> List[str]:
    """Return the list of team_ids visible to this user.

    Platform staff and org owners/admins see every team in their org. For
    everyone else we UNION project_assignments and team_members (active) so
    late-registering invitees are included.

    Authority comes from staging.user_roles, not the legacy users.role column —
    that column was mirrored into the JWT, so a token minted while someone was
    an admin kept admin visibility after the flag was removed.
    """
    # Imported here rather than at module scope: middleware.roles imports
    # auth_router, and utils is imported early enough that a top-level import
    # would risk an import cycle as those modules grow.
    from middleware.roles import is_org_admin, admin_org_id

    if await is_org_admin(user_id):
        org_id = await admin_org_id(user_id)
        if org_id:
            rows = await pool.fetch(
                "SELECT team_id FROM teams WHERE org_id=$1::uuid AND deleted_at IS NULL", org_id)
        else:
            rows = await pool.fetch("SELECT team_id FROM teams WHERE deleted_at IS NULL")
        return [r["team_id"] for r in rows]
    rows = await pool.fetch(
        """
        SELECT team_id FROM project_assignments WHERE user_id=$1
        UNION
        SELECT team_id FROM team_members      WHERE user_id=$1 AND status='active'
        """,
        user_id,
    )
    return [r["team_id"] for r in rows]


async def create_notification(
    pool, user_id: str, notif_type: str, title: str, message: str,
    task_id: Optional[str] = None, team_id: Optional[str] = None,
    url: Optional[str] = None,
) -> None:
    """Insert a notification row. Fire-and-forget — callers should wrap in try/except."""
    await pool.execute(
        "INSERT INTO notifications "
        "(notification_id,user_id,team_id,type,title,message,task_id,url) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        f"notif_{uuid.uuid4().hex[:12]}", user_id, team_id,
        notif_type, title, message, task_id, url,
    )


async def ensure_default_columns(pool, team_id: str) -> None:
    """Create the five default kanban columns for a new project if none exist."""
    existing = await pool.fetchval(
        "SELECT COUNT(*) FROM project_columns WHERE team_id=$1", team_id
    )
    if existing == 0:
        defaults = [
            ("To Do",      "#0082c6", 0, False),
            ("In Progress","#03a1b6", 1, False),
            ("In Review",  "#8b5cf6", 2, False),
            ("Approval",   "#f59e0b", 3, False),
            ("Rejected",   "#ef4444", 4, False),
            ("Done",       "#05b7aa", 5, True),
        ]
        for name, color, order, is_done in defaults:
            await pool.execute(
                "INSERT INTO project_columns "
                "(column_id,team_id,name,color,sort_order,is_done) "
                "VALUES ($1,$2,$3,$4,$5,$6)",
                f"col_{uuid.uuid4().hex[:12]}", team_id, name, color, order, is_done,
            )


async def client_can_access_task(pool, task_id: str, user_id: str) -> bool:
    """True if a client-role user is permitted to read/write this task."""
    row = await pool.fetchrow(
        "SELECT team_id, created_by_user_id, assignee_user_ids FROM tasks WHERE task_id=$1",
        task_id,
    )
    if not row:
        return False
    if row["created_by_user_id"] == user_id:
        return True
    if user_id in (row["assignee_user_ids"] or []):
        return True
    if row["team_id"]:
        pa = await pool.fetchrow(
            "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2",
            row["team_id"], user_id,
        )
        if pa:
            return True
    tc = await pool.fetchrow(
        "SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2", task_id, user_id
    )
    return bool(tc)


# ── 4. Pydantic models ────────────────────────────────────────────────────────

class ProjectColumnCreate(BaseModel):
    name: str; color: str = "#0082c6"; is_done: bool = False

class ProjectColumnUpdate(BaseModel):
    name: Optional[str] = None; color: Optional[str] = None
    is_done: Optional[bool] = None; sort_order: Optional[int] = None

class ProjectColumnOut(BaseModel):
    column_id: str; team_id: str; name: str; color: str
    sort_order: int; is_done: bool; created_at: datetime

class CategoryCreate(BaseModel):
    name: str; color: str = "#0082c6"

class CategoryOut(BaseModel):
    category_id: str; user_id: str; name: str; color: str
    created_at: datetime; updated_at: datetime

class TeamCreate(BaseModel):
    name: str

class TeamOut(BaseModel):
    team_id: str; name: str; created_by: str
    created_at: datetime; updated_at: datetime

class TeamMemberAdd(BaseModel):
    email: str; role: str = "member"

class TeamMemberUpdate(BaseModel):
    role: Optional[str] = None; status: Optional[str] = None

class TeamMemberOut(BaseModel):
    member_id: str; team_id: str; email: str; user_id: Optional[str] = None
    role: str; status: str; created_at: datetime; updated_at: datetime

class Attachment(BaseModel):
    name: str; url: str; key: Optional[str] = None
    is_private: bool = False
    visible_to: List[str] = []

class Subtask(BaseModel):
    subtask_id: str = Field(default_factory=lambda: f"sub_{uuid.uuid4().hex[:12]}")
    title: str; is_done: bool = False; order: int = 0

class Recurrence(BaseModel):
    rule: str = "none"; interval: int = 1

class TaskCreate(BaseModel):
    title: str; description: Optional[str] = None
    status: str = "todo"; column_id: Optional[str] = None
    priority: str = "medium"; category_id: Optional[str] = None
    tags: List[str] = []; team_id: Optional[str] = None
    assignee_user_ids: List[str] = []; assignee_emails: List[str] = []
    due_at: Optional[str] = None; reminder_at: Optional[str] = None
    recurrence: Recurrence = Field(default_factory=Recurrence)
    estimated_minutes: Optional[int] = None
    attachments: List[Attachment] = []
    custom_fields: Dict[str, Any] = {}; subtasks: List[Subtask] = []

class TaskUpdate(BaseModel):
    title: Optional[str] = None; description: Optional[str] = None
    status: Optional[str] = None; column_id: Optional[str] = None
    priority: Optional[str] = None; category_id: Optional[str] = None
    tags: Optional[List[str]] = None; team_id: Optional[str] = None
    assignee_user_ids: Optional[List[str]] = None
    assignee_emails: Optional[List[str]] = None
    due_at: Optional[str] = None; reminder_at: Optional[str] = None
    recurrence: Optional[Recurrence] = None
    estimated_minutes: Optional[int] = None
    attachments: Optional[List[Attachment]] = None
    custom_fields: Optional[Dict[str, Any]] = None
    subtasks: Optional[List[Subtask]] = None
    approval_status: Optional[str] = None

class TaskOut(BaseModel):
    task_id: str; user_id: Optional[str] = None; team_id: Optional[str] = None
    column_id: Optional[str] = None; created_by_user_id: str
    assigned_by_user_id: Optional[str] = None
    completed_by_user_id: Optional[str] = None
    title: str; description: Optional[str] = None
    status: str; priority: str; category_id: Optional[str] = None
    tags: List[str] = []; assignee_user_ids: List[str] = []
    assignee_emails: List[str] = []; assignee_names: List[str] = []
    due_at: Optional[datetime] = None; reminder_at: Optional[datetime] = None
    reminder_sent_at: Optional[datetime] = None
    recurrence: Recurrence = Field(default_factory=Recurrence)
    estimated_minutes: Optional[int] = None
    attachments: List[Attachment] = []
    custom_fields: Dict[str, Any] = {}; subtasks: List[Subtask] = []
    order: int = 0; created_at: datetime; updated_at: datetime
    completed_at: Optional[datetime] = None
    approval_status: Optional[str] = None; approval_notes: Optional[str] = None
    approved_by: Optional[str] = None
    approval_requested_at: Optional[datetime] = None
    approval_decided_at: Optional[datetime] = None
    requires_approval: bool = False; created_by_name: Optional[str] = None
    archived_at: Optional[datetime] = None
    column_name: Optional[str] = None
    column_color: Optional[str] = None

class TaskMoveIn(BaseModel):
    column_id: str; order: int

class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)

class CommentOut(BaseModel):
    comment_id: str; task_id: str; user_id: str
    user_name: str; body: str; created_at: datetime

class DashboardSummaryOut(BaseModel):
    todo: int; in_progress: int; done: int; overdue: int; due_24h: int

class PushSubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: str; keys: Dict[str, str]

class NotificationOut(BaseModel):
    notification_id: str; user_id: str; team_id: Optional[str] = None
    type: str; title: str; message: str
    task_id: Optional[str] = None; url: Optional[str] = None
    created_at: datetime; read_at: Optional[datetime] = None

class MarkReadIn(BaseModel):
    notification_ids: List[str] = []; mark_all: bool = False


# ── 5. Row mapper ─────────────────────────────────────────────────────────────

def row_to_task(r) -> TaskOut:
    """Convert an asyncpg Record (from the tasks table) to a TaskOut model."""
    def pj(v, d):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, ValueError):
                return d
        return v if v is not None else d

    def col(key, default=None):
        try:
            if key in r:
                return r[key]
        except (KeyError, TypeError):
            pass
        return default

    return TaskOut(
        task_id=r["task_id"], user_id=r["user_id"], team_id=r["team_id"],
        column_id=r.get("column_id"),
        created_by_user_id=r["created_by_user_id"],
        assigned_by_user_id=r["assigned_by_user_id"],
        completed_by_user_id=r["completed_by_user_id"],
        title=r["title"], description=r["description"],
        status=r["status"], priority=r["priority"],
        category_id=r["category_id"],
        tags=list(r["tags"] or []),
        assignee_user_ids=list(r["assignee_user_ids"] or []),
        assignee_emails=list(r["assignee_emails"] or []),
        due_at=r["due_at"], reminder_at=r["reminder_at"],
        reminder_sent_at=r["reminder_sent_at"],
        recurrence=Recurrence(
            rule=r["recurrence_rule"] or "none",
            interval=r["recurrence_interval"] or 1,
        ),
        estimated_minutes=r["estimated_minutes"],
        attachments=[Attachment(**a) for a in pj(r["attachments"], [])],
        custom_fields=pj(r["custom_fields"], {}),
        subtasks=[Subtask(**s) for s in pj(r["subtasks"], [])],
        order=r["sort_order"] or 0,
        created_at=r["created_at"], updated_at=r["updated_at"],
        completed_at=r["completed_at"],
        approval_status=col("approval_status"),
        approval_notes=col("approval_notes"),
        approved_by=col("approved_by"),
        approval_requested_at=col("approval_requested_at"),
        approval_decided_at=col("approval_decided_at"),
        requires_approval=bool(col("requires_approval", False)),
        created_by_name=col("created_by_name"),
        archived_at=col("archived_at"),
        column_name=col("column_name"),
        column_color=col("column_color"),
    )
