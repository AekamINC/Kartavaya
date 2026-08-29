"""
utils.py — shared helpers and Pydantic models for the Kartavaya API.

Anything that was previously inline in server.py and used by more than
one router lives here — WHEN IT IS ACTUALLY SHARED. "Import from here, not
from server.py" applies to the names below; it is not a licence to keep a
second copy of a server.py model here on the theory that someone might.

That theory already cost us one. `TaskOut` and `row_to_task` were duplicated
into this file, gained no importers at all, and then DRIFTED from the copies
the API actually serves (server.py:788 and server.py:975): this file's `TaskOut`
had no `reminders` field and never populated `assignee_names`, so any endpoint
that took the header at its word and imported from here would have silently
dropped both. They were deleted on 2026-08-06. If you need the task response
shape, it is in server.py, and there is exactly one of it.

Sections:
  1. datetime helpers       — now_utc(), parse_dt()
  1b. file-URL validation   — assert_file_url(), assert_file_urls(),
                               assert_config_attachments()
  2. DB dependency          — get_db()
  3. DB helpers             — get_visible_team_ids(), create_notification(),
                               ensure_default_columns(), client_can_access_task()
  4. Pydantic models        — request/response models used by more than one router
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from db import get_pool


# ── 0. Logging helpers ───────────────────────────────────────────────────────

_CTRL_RE = re.compile(r'[\x00-\x1f\x7f]|\x1b\[[0-?]*[ -/]*[@-~]')


def secret_matches(provided: object, expected: object) -> bool:
    """Constant-time comparison of a shared secret.

    `provided == expected` on a `str` short-circuits at the first differing
    byte, so the time it takes to fail is a function of how many leading bytes
    were right. Against an endpoint that can be called repeatedly — which every
    cron dispatch route can — that is enough to recover the secret a byte at a
    time. `hmac.compare_digest` takes the same time whatever the input.

    Returns False when either side is empty, so an unset environment variable
    can never be matched by an omitted parameter (both being "" would otherwise
    compare EQUAL and authorise the request).
    """
    import hmac as _hmac

    p = "" if provided is None else str(provided)
    e = "" if expected is None else str(expected)
    if not p or not e:
        return False
    return _hmac.compare_digest(p, e)


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


# ── 1b. File URLs ─────────────────────────────────────────────────────────────
#
# A column holds a KEY, or a URL derived from one. It never holds the file.
#
# `services/storage.upload_file` had a third backend behind the two real ones:
# when neither the org's own R2 bucket nor the platform bucket resolved, it
# returned the file base64-encoded as a `data:` URI with an empty key, and every
# caller wrote that string into its column. Two of the three orgs had no R2
# credentials of their own — Aekam Inc among them — so the vendor's own uploads
# took the fallback silently while every screen reported success. Six rows of
# `public.tasks` reached 32MB that way, 45% of the whole database; the eleven
# files that had accumulated by 2026-08-19 came to 99MB, and repointing them at
# R2 took the database from 82MB to 49MB.
#
# Closing that fallback is necessary and NOT sufficient, which is why these
# helpers exist separately from it. `file_url`, `attachment_url`, `resume_url`,
# `receipt_urls[]` and `config.attachments[].url` arrive as strings in a JSON
# body and are written straight to their columns; not one of them passes through
# `upload_file`, so a caller can put the bytes in a column by hand with R2
# perfectly healthy. The multipart siblings — `POST /graha/documents/upload`,
# `POST /api/upload` — are not this hole: they read the file, store it, and mint
# the URL themselves.
#
# The check is a scheme refusal plus a length ceiling, deliberately not an
# http(s) allowlist. `resume_url` on the recruitment tab and the add-by-URL row
# on a task template are typed by a person, and somebody pasting
# `drive.google.com/…` without a scheme is filing a link, not smuggling a file;
# an allowlist would 422 them for a fault they do not have. The ceiling is what
# carries the guarantee: 2048 characters cannot hold a file whatever scheme is
# written in front of them.

#: A presigned R2 URL runs well under 1KB — bucket host, key path, five `X-Amz-`
#: query parameters and a 64-character signature. 2048 is the conventional URL
#: ceiling and leaves room for a long filename. The eleven files migrated on
#: 2026-08-19 averaged 9MB, which is twelve million base64 characters apiece, so
#: nothing about the ceiling is a close call.
MAX_FILE_URL_LEN = 2048

#: A list field multiplies the blast radius by its length, so it needs a bound
#: of its own — fifty receipts against one expense claim is already far past
#: anything a person files.
MAX_FILE_URL_ITEMS = 50

#: Schemes that carry the bytes, or the code, inline instead of naming a place
#: to fetch them from. `data:` is the measured one. The others are refused with
#: it because the same string is later rendered as an `href` — `RecruitmentTab`
#: links a candidate's résumé directly — and a `javascript:` résumé is stored
#: XSS rather than a file in a column.
_INLINE_SCHEMES = ("data:", "blob:", "javascript:", "vbscript:", "file:")

#: Everything a URL parser discards before it reads the scheme: space and the
#: whole C0 control range.
_URL_LEADING_NOISE = "".join(chr(c) for c in range(0x21))

#: The keys an attachment names its file with. `Attachment` below is
#: `{name, url, key}` and `TaskTemplateForm.jsx` writes exactly that shape;
#: `file_url`/`file_key` are checked alongside because the column is free-form
#: JSONB and nothing stops a second writer using the other spelling.
_ATTACHMENT_URL_KEYS = ("url", "key", "file_url", "file_key")


def _scheme_is_inline(value: str) -> bool:
    """True when `value` names bytes or code rather than a location.

    Leading whitespace and C0 controls come off first and the comparison is
    case-insensitive, because that is what a browser does to an `href` before it
    reads the scheme: `"\\n DATA:image/png;base64,…"` is a data URI to Chrome,
    and it is a file inside a column to Postgres either way.
    """
    return value.lstrip(_URL_LEADING_NOISE).lower().startswith(_INLINE_SCHEMES)


def assert_file_url(value: object, field: str) -> None:
    """422 unless `value` is a location, and a short enough one to be one.

    `field` is named in every message. These bodies carry several of these at
    once — a document has `file_url` and `file_key`, a template attachment has
    both again — and "invalid URL" does not tell anyone which one to fix.

    An empty value is accepted: every one of these columns defaults to `''` and
    most rows legitimately have no file.
    """
    if value is None or value == "":
        return
    if not isinstance(value, str):
        raise HTTPException(422, f"{field} must be a string")
    if len(value) > MAX_FILE_URL_LEN:
        raise HTTPException(
            422,
            f"{field} is {len(value)} characters long; the maximum is "
            f"{MAX_FILE_URL_LEN}. Upload the file and store the URL the upload "
            "returns.",
        )
    if _scheme_is_inline(value):
        raise HTTPException(
            422,
            f"{field} must be a link to a stored file, not the file itself. "
            "Upload it and store the URL the upload returns.",
        )


def assert_file_urls(values: object, field: str) -> None:
    """The list form — EVERY element, and the element's index in the message.

    A list field is where one unchecked string becomes twenty, so checking the
    first entry and trusting the rest would leave the hole open at a wider
    mouth than the scalar fields ever had.
    """
    if values is None:
        return
    if not isinstance(values, (list, tuple)):
        raise HTTPException(422, f"{field} must be a list")
    if len(values) > MAX_FILE_URL_ITEMS:
        raise HTTPException(
            422,
            f"{field} holds {len(values)} entries; the maximum is "
            f"{MAX_FILE_URL_ITEMS}.",
        )
    for i, value in enumerate(values):
        assert_file_url(value, f"{field}[{i}]")


def _assert_attachment_list(items: object, field: str) -> None:
    """Check an `attachments[]` array, whose entries are objects, not strings."""
    if items is None:
        return
    if not isinstance(items, list):
        raise HTTPException(422, f"{field} must be a list")
    if len(items) > MAX_FILE_URL_ITEMS:
        raise HTTPException(
            422,
            f"{field} holds {len(items)} entries; the maximum is "
            f"{MAX_FILE_URL_ITEMS}.",
        )
    for i, item in enumerate(items):
        if isinstance(item, str):
            assert_file_url(item, f"{field}[{i}]")
            continue
        if not isinstance(item, dict):
            raise HTTPException(422, f"{field}[{i}] must be an attachment object")
        for key in _ATTACHMENT_URL_KEYS:
            if item.get(key) is not None:
                assert_file_url(item[key], f"{field}[{i}].{key}")


def assert_config_attachments(config: object, field: str = "config") -> None:
    """Check the attachments a template `config` is documented to carry.

    `config` is free-form JSONB, `json.dumps`-ed whole with nothing looked at on
    the way past. The alternative to inspecting the documented carriers is
    scanning every string anywhere in the blob, and that refuses a template
    whose *description* explains what a data URI is.

    The carriers are `config.attachments[]` on a task template — the shape is
    `title, description, priority, subtasks[], attachments[], tags[],
    category_id, custom_fields{}` — and the tasks a project template seeds,
    which are tasks and so carry attachments the same way.
    """
    if not isinstance(config, dict):
        return
    _assert_attachment_list(config.get("attachments"), f"{field}.attachments")
    seeded = config.get("sample_tasks")
    if isinstance(seeded, list):
        for i, task in enumerate(seeded):
            if isinstance(task, dict):
                _assert_attachment_list(
                    task.get("attachments"),
                    f"{field}.sample_tasks[{i}].attachments",
                )


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

    Shared by Ganit (invoices), Vikray (orders), Vetana (payslips) and the
    recurring-invoice cron. It is the ONLY allocator: that file grew its own,
    in a different format, and the two poisoned each other's state — see
    `services/skills/action/recurring_invoice_generator.py:_next_invoice_number`
    for what that did to a GST serial.

    ── THE LOCK IS INSIDE A TRANSACTION, AND HAS TO BE ─────────────────────────

    `pg_advisory_xact_lock` is released at the end of the transaction that took
    it. asyncpg runs in autocommit, so a bare `execute` of it is its own
    transaction — the lock was acquired and dropped before the SELECT that it
    exists to protect ever ran, and two callers could read the same `last` and
    mint the same number. The docstring claimed a guarantee the code did not
    give. `conn.transaction()` makes the claim true: the lock is now held from
    before the read until after the caller's INSERT... within this function's
    scope, which is where the read happens.
    """
    if (table, column) not in _ALLOWED_DOC_TABLES:
        raise ValueError(f"Disallowed table/column: {table}.{column}")
    async with pool.acquire() as conn:
        async with conn.transaction():
            lock_key = hash((org_id, table)) & 0x7FFFFFFF
            await conn.execute("SELECT pg_advisory_xact_lock($1)", lock_key)
            last = await conn.fetchval(
                f"SELECT {column} FROM public.{table} "
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

# ── `get_visible_team_ids` USED TO LIVE HERE. IT WAS THE SECOND COPY. ────────
#
# Two implementations of one tenancy predicate, same name, different logic — and
# this one still had the branch that `server.py` closed on 965d0e82:
#
#     if await is_org_admin(user_id):
#         org_id = await admin_org_id(user_id)
#         if org_id: ... WHERE org_id=$1 ...
#         else:      SELECT team_id FROM teams WHERE deleted_at IS NULL
#
# That `else` has NO PREDICATE. It returns every team in the database, for every
# organisation, to any caller `is_org_admin(user_id)` says yes to with no org
# argument — which includes every platform role. The identical line in
# `server.py` was measured handing all 29 live teams and 557 tasks to 7 of the
# 10 platform accounts on an ordinary page load. It was fixed there. It was not
# fixed here, because nobody knew here existed.
#
# Measured before removal: `grep -rn "get_visible_team_ids"` across the whole
# backend finds no import of this one. Zero callers — server.py defines and uses
# its own, and `search.py` / `tasks_bulk.py` defer their import to `server`. So
# it was dead code holding a live hole, one `from utils import` away from being
# the version that decides which company's projects a user sees.
#
# The predicate now has exactly ONE definition: `server.get_visible_team_ids`,
# which takes and enforces an `org_id`. Do not add a second. If a module needs
# it and cannot import `server` at module scope, defer the import inside the
# function the way `routers/search.py:276` does and say why in a comment.
# `tests/test_active_org_visibility.py::test_there_is_only_one_get_visible_team_ids`
# fails if this name comes back.


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
    """True if a client-role user is permitted to READ this task.

    READ. This docstring said "read/write", and it described the code
    accurately: `server.update_task`, `patch_task` and `add_task_attachment`
    all fall back to this predicate when the team-id test misses, so a
    `task_clients` row — which the client-approval forward would write for any
    email address in the database — was a WRITE grant on somebody else's task.

    The write half is gone. `services/task_actor.assert_may_write_task` is now
    asked separately by every task writer and refuses a caller whose only claim
    on the task is a `task_clients` row. This predicate answers reachability and
    nothing more.

    NOTE: this copy is imported by nothing — `server.py` carries the live one at
    the same name. It is corrected rather than deleted because it is the copy
    that wrote the wrong rule down, and a stale docstring is how the next reader
    re-learns it.
    """
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

# `TaskOut` is NOT here. There is one, in server.py:788, and it is the one every
# `response_model=TaskOut` and every `row_to_task()` call site uses. The copy
# that used to sit on this line had zero importers and had already drifted.

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

# ── 5. Row mapper ─ NOT HERE ───────────────────────────────────────
#
# `row_to_task()` lives in server.py:975 and is the only one. The duplicate that
# used to sit here was never imported by anything and had already drifted from
# it — see the module docblock.
