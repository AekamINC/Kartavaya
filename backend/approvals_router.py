"""Approvals Router — Task Approval Workflow
Fix: all email calls now pass task_id for deep-link; send_approval_notification_email
signature extended; client-approve/reject fan out team-sync emails.
Token-based magic-link endpoints for client approval via email.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime, timezone
import asyncio
import logging as _logging
import uuid
import jwt as _jwt

_logger = _logging.getLogger(__name__)


def _bg_push(coro, label: str = "push"):
    """Schedule a push coroutine as fire-and-forget, logging any exception."""
    async def _run():
        try:
            await coro
        except Exception as exc:
            _logger.warning("bg push '%s' failed: %s", label, exc)
    return asyncio.create_task(_run())

from auth_router import require_user, JWT_SECRET as _JWT_SECRET
from db import get_pool
from utils import SQL_USER_ROLE as _SQL_USER_ROLE

_JWT_ALG = "HS256"

_TASK_NOT_FOUND     = "Task not found"
_REJECTION_REQUIRED = "Rejection reason is required"


def _make_client_token(task_id: str, client_user_id: str) -> str:
    """Generate a 7-day JWT magic-link token for client approval of a task."""
    import time
    return _jwt.encode(
        {"task_id": task_id, "client_user_id": client_user_id,
         "type": "client_approval", "exp": time.time() + 86400 * 7},
        _JWT_SECRET, algorithm=_JWT_ALG
    )


def _decode_client_token(token: str) -> dict:
    """Decode and validate a client-approval JWT, raising HTTP 400 on failure."""
    try:
        payload = _jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
        if payload.get("type") != "client_approval":
            raise HTTPException(400, "Invalid token type")
        return payload
    except _jwt.ExpiredSignatureError:
        raise HTTPException(400, "Approval link has expired")
    except _jwt.PyJWTError:
        raise HTTPException(400, "Invalid or malformed approval token")

router = APIRouter(prefix="/api", tags=["approvals"])


class ApprovalRequest(BaseModel):
    notes: Optional[str] = None


class ApprovalResponse(BaseModel):
    task_id: str
    approval_status: str
    approved_by: Optional[str]
    approval_notes: Optional[str]
    approval_decided_at: Optional[datetime]


# ── Helpers ────────────────────────────────────────────────────────────────────

async def get_task_with_permission(pool, task_id: str, user_id: str):
    """Fetch a task by ID, raising 404 if not found.

    Permission checks (owner/admin) are done by callers via is_project_owner().
    The previous LEFT JOIN on team_members was unused — removed to avoid drift.
    """
    task = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
    if not task:
        raise HTTPException(status_code=404, detail=_TASK_NOT_FOUND)
    return task


async def is_project_owner(pool, team_id: str, user_id: str) -> bool:
    """Return True if the user is an owner or admin of the given team (via either membership table)."""
    member = await pool.fetchrow("""
        SELECT role FROM team_members
        WHERE team_id=$1 AND user_id=$2 AND status='active'
    """, team_id, user_id)
    if member and member["role"] in ("owner", "admin"):
        return True
    pa = await pool.fetchrow("""
        SELECT role FROM project_assignments
        WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin')
    """, team_id, user_id)
    return bool(pa)


async def _notify(pool, task_id: str, task_title: str, recipient_id: str,
                  notif_type: str, notes: Optional[str] = None, team_id: Optional[str] = None):
    """Insert a DB notification row (fire-and-forget; never raises)."""
    try:
        title = {
            "request":  f"Approval Requested: {task_title}",
            "approved": f"Task Approved: {task_title}",
            "rejected": f"Task Rejected: {task_title}",
        }.get(notif_type, f"Update on: {task_title}")
        message = notes or ""
        await pool.execute("""
            INSERT INTO notifications (notification_id, user_id, team_id, type, title, message, task_id, url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """, f"notif_{uuid.uuid4().hex[:12]}", recipient_id, team_id, notif_type, title, message, task_id, "/tasks")
    except Exception as exc:
        import logging; logging.getLogger(__name__).warning("_notify failed: %s", exc)


async def send_approval_notification(pool, task_id: str, task_title: str,
                                     recipient_id: str, notification_type: str,
                                     notes: Optional[str] = None, team_id: Optional[str] = None,
                                     requester_name: Optional[str] = None):
    """Send a DB notification, email, and push notification for an approval event."""
    user = await pool.fetchrow(
        "SELECT email, COALESCE(full_name,name) AS name FROM users WHERE user_id=$1", recipient_id
    )
    if user:
        await _notify(pool, task_id, task_title, recipient_id, notification_type, notes, team_id=team_id)
        try:
            from email_service import send_approval_notification_email
            send_approval_notification_email(
                user["email"], user["name"] or user["email"],
                task_title, notification_type, notes,
                task_id=task_id,
                requester_name=requester_name,
            )
        except Exception as exc:
            import logging; logging.getLogger(__name__).warning("approval email failed: %s", exc)

        try:
            from services.push_service import send_push
            import asyncio
            _push_title = {
                "request":  f"Approval Requested: {task_title}",
                "approved": f"✅ Task Approved: {task_title}",
                "rejected": f"Task Rejected: {task_title}",
            }.get(notification_type, f"Update: {task_title}")
            _push_body = notes or {
                "request":  "Your review is needed.",
                "approved": "The task has been approved.",
                "rejected": "The task was sent back for revision.",
            }.get(notification_type, "")
            _bg_push(send_push(
                pool,
                recipient_id=recipient_id,
                kind=notification_type if notification_type in ("approved", "rejected") else "approval_request",
                title=_push_title,
                body=_push_body,
                task_id=task_id,
                is_mine=True,
            ), "approval-push")
        except Exception as exc:
            import logging; logging.getLogger(__name__).warning("approval push failed: %s", exc)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/tasks/{task_id}/request-approval")
async def request_approval(task_id: str, payload: ApprovalRequest,
                            pool=Depends(get_pool), user=Depends(require_user)):
    """Submit a task for approval by the project owner."""
    task = await get_task_with_permission(pool, task_id, user["user_id"])
    if not task["team_id"]:
        raise HTTPException(400, "Cannot request approval for personal tasks")

    owner = await pool.fetchrow("""
        SELECT user_id FROM team_members
        WHERE team_id=$1 AND role IN ('owner','admin') AND status='active'
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1
    """, task["team_id"])
    if not owner:
        raise HTTPException(400, "No project owner or admin found to approve")

    requester = await pool.fetchrow(
        "SELECT COALESCE(full_name, name, email) AS name FROM users WHERE user_id=$1",
        user["user_id"]
    )
    requester_name = requester["name"] if requester else "A team member"

    # Move task into the Approval column automatically
    approval_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND name ILIKE '%approval%' ORDER BY sort_order LIMIT 1",
        task["team_id"]
    )

    if approval_col:
        await pool.execute("""
            UPDATE tasks
            SET approval_status='pending', approval_requested_at=NOW(),
                approval_notes=$1, column_id=$2, updated_at=NOW()
            WHERE task_id=$3
        """, payload.notes, approval_col["column_id"], task_id)
    else:
        await pool.execute("""
            UPDATE tasks
            SET approval_status='pending', approval_requested_at=NOW(),
                approval_notes=$1, updated_at=NOW()
            WHERE task_id=$2
        """, payload.notes, task_id)

    await send_approval_notification(
        pool, task_id, task["title"], owner["user_id"], "request",
        payload.notes, team_id=task["team_id"], requester_name=requester_name
    )
    return {
        "message": "Approval requested",
        "approval_status": "pending",
        "column_id": approval_col["column_id"] if approval_col else None,
    }


@router.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, payload: ApprovalRequest,
                        pool=Depends(get_pool), user=Depends(require_user)):
    """Approve a pending task and advance it to the next kanban column."""
    task = await get_task_with_permission(pool, task_id, user["user_id"])
    if not task["team_id"]:
        raise HTTPException(400, "Cannot approve personal tasks")

    if not await is_project_owner(pool, task["team_id"], user["user_id"]):
        user_data = await pool.fetchrow(_SQL_USER_ROLE, user["user_id"])
        if not user_data or user_data["role"] != "admin":
            raise HTTPException(403, "Only project owner or admin can approve")

    all_cols = await pool.fetch(
        "SELECT * FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC", task["team_id"]
    )
    # Prefer a column explicitly named "Approved"; fall back to next col after current; then last col
    approved_col = next((c for c in all_cols if "approved" in (c["name"] or "").lower()
                         and "approval" not in (c["name"] or "").lower().replace("approved","")), None)
    if approved_col:
        new_col_id = approved_col["column_id"]
        new_status  = "done" if approved_col["is_done"] else "in_progress"
    else:
        current_col = next((c for c in all_cols if c["column_id"] == task["column_id"]), None)
        next_col = next((c for c in all_cols if current_col and c["sort_order"] > current_col["sort_order"]), None)
        if next_col:
            new_col_id = next_col["column_id"]
            new_status  = "done" if next_col["is_done"] else "in_progress"
        elif all_cols:
            # No next col — use last column and mark done
            new_col_id = all_cols[-1]["column_id"]
            new_status  = "done"
        else:
            new_col_id, new_status = task["column_id"], "in_progress"

    updated = await pool.fetchrow("""
        UPDATE tasks
        SET approval_status='approved', approved_by=$1, approval_notes=$2,
            approval_decided_at=NOW(), column_id=$3, status=$4, updated_at=NOW()
        WHERE task_id=$5
        RETURNING *
    """, user["user_id"], payload.notes, new_col_id, new_status, task_id)

    await send_approval_notification(pool, task_id, task["title"],
                                     task["created_by_user_id"], "approved", payload.notes, team_id=task["team_id"])
    return {"message": "Task approved", "approval_status": "approved", "new_column_id": new_col_id, "status": new_status}


@router.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str, payload: ApprovalRequest,
                       pool=Depends(get_pool), user=Depends(require_user)):
    """Reject a pending task approval with a mandatory reason note."""
    task = await get_task_with_permission(pool, task_id, user["user_id"])
    if not task["team_id"]:
        raise HTTPException(400, "Cannot reject personal tasks")

    if not await is_project_owner(pool, task["team_id"], user["user_id"]):
        user_data = await pool.fetchrow(_SQL_USER_ROLE, user["user_id"])
        if not user_data or user_data["role"] != "admin":
            raise HTTPException(403, "Only project owner or admin can reject")

    if not payload.notes or not payload.notes.strip():
        raise HTTPException(400, _REJECTION_REQUIRED)

    # Move task back to a "Rejected" column if one exists, else the first "In Progress" col, else keep current
    fallback_col_id = task["column_id"]
    fallback_status = "in_progress"
    if task["team_id"]:
        all_cols = await pool.fetch(
            "SELECT * FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC", task["team_id"]
        )
        rejected_col = next((c for c in all_cols if "reject" in (c["name"] or "").lower()), None)
        inprog_col   = next((c for c in all_cols if "progress" in (c["name"] or "").lower()
                             or "doing" in (c["name"] or "").lower()), None)
        target = rejected_col or inprog_col
        if target:
            fallback_col_id = target["column_id"]
            fallback_status = "done" if target["is_done"] else "in_progress"

    await pool.execute("""
        UPDATE tasks
        SET approval_status='rejected', approved_by=$1, approval_notes=$2,
            approval_decided_at=NOW(), column_id=$3, status=$4, updated_at=NOW()
        WHERE task_id=$5
    """, user["user_id"], payload.notes, fallback_col_id, fallback_status, task_id)

    await send_approval_notification(pool, task_id, task["title"],
                                     task["created_by_user_id"], "rejected", payload.notes, team_id=task["team_id"])
    return {"message": "Task rejected", "approval_status": "rejected", "status": fallback_status}


@router.get("/tasks/pending-approval", response_model=List[dict])
async def get_pending_approvals(pool=Depends(get_pool), user=Depends(require_user)):
    """Return all tasks with approval_status='pending' that the user can action."""
    from middleware.roles import is_org_admin
    if await is_org_admin(user["user_id"]):
        # Admins see only teams they are actually a member of — no cross-team data leak.
        tasks = await pool.fetch("""
            SELECT t.*, u.name AS created_by_name, u.email AS created_by_email,
                   tm.name AS team_name
            FROM tasks t
            JOIN users u ON u.user_id = t.created_by_user_id
            LEFT JOIN teams tm ON tm.team_id = t.team_id
            WHERE t.approval_status = 'pending'
              AND (
                EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1)
                OR EXISTS (SELECT 1 FROM team_members tmem WHERE tmem.team_id=t.team_id AND tmem.user_id=$1 AND tmem.status='active')
              )
            ORDER BY t.approval_requested_at DESC
        """, user["user_id"])
    else:
        tasks = await pool.fetch("""
            SELECT t.*, u.name AS created_by_name, u.email AS created_by_email,
                   tm.name AS team_name
            FROM tasks t
            JOIN users u ON u.user_id = t.created_by_user_id
            LEFT JOIN teams tm ON tm.team_id = t.team_id
            JOIN team_members tmem ON tmem.team_id = t.team_id AND tmem.user_id = $1
            WHERE t.approval_status = 'pending'
              AND tmem.role IN ('owner', 'admin')
              AND tmem.status = 'active'
            ORDER BY t.approval_requested_at DESC
        """, user["user_id"])
    return [dict(t) for t in tasks]


class ClientApprovalRequest(BaseModel):
    client_email: EmailStr
    notes: Optional[str] = None


@router.post("/tasks/{task_id}/request-client-approval")
async def request_client_approval(task_id: str, payload: ClientApprovalRequest,
                                   pool=Depends(get_pool), user=Depends(require_user)):
    """Send a task to a client user for approval via email magic-link."""
    task   = await get_task_with_permission(pool, task_id, user["user_id"])
    client = await pool.fetchrow(
        "SELECT user_id, name, full_name, email FROM users WHERE email=$1",
        payload.client_email.lower()
    )
    if not client:
        raise HTTPException(404, "Client not found")

    await pool.execute(
        "INSERT INTO task_clients (id,task_id,user_id,invited_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        f"tc_{uuid.uuid4().hex[:12]}", task_id, client["user_id"], user["user_id"]
    )
    await pool.execute("""
        UPDATE tasks
        SET approval_status='pending_client', approval_requested_at=NOW(),
            approval_notes=$1, updated_at=NOW()
        WHERE task_id=$2
    """, payload.notes, task_id)

    # Generate magic-link token for email
    token = _make_client_token(task_id, client["user_id"])
    requester_name = user.get("full_name") or user.get("name") or user.get("email", "Team")
    try:
        from email_service import send_approval_request_email
        send_approval_request_email(
            payload.client_email, client["name"] or payload.client_email,
            requester_name, task["title"],
            notes=payload.notes, approve_token=token
        )
    except Exception as exc:
        import logging; logging.getLogger(__name__).warning("client approval email failed: %s", exc)

    return {"message": "Client approval requested", "approval_status": "pending_client"}


@router.post("/tasks/{task_id}/client-approve")
async def client_approve_task(task_id: str, payload: ApprovalRequest,
                               pool=Depends(get_pool), user=Depends(require_user)):
    """Allow an authenticated client user to approve a pending_client task."""
    task   = await get_task_with_permission(pool, task_id, user["user_id"])
    # Only explicit task_clients entries may approve — not general project members.
    # Admins retain override access to unblock stuck approvals.
    if user.get("role") != "admin":
        access = await pool.fetchrow(
            "SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2",
            task_id, user["user_id"]
        )
        if not access:
            raise HTTPException(403, "Only the assigned client can approve this task")

    done_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND is_done=TRUE ORDER BY sort_order DESC LIMIT 1",
        task["team_id"]
    )
    new_col_id = done_col["column_id"] if done_col else task["column_id"]

    client_user = await pool.fetchrow(
        "SELECT COALESCE(full_name,name,email) AS display FROM users WHERE user_id=$1", user["user_id"]
    )
    client_name = client_user["display"] if client_user else "Client"

    await pool.execute("""
        UPDATE tasks
        SET approval_status='approved', approved_by=$1::text, approval_notes=$2,
            approval_decided_at=NOW(), column_id=$3, status='done',
            completed_at=NOW(), completed_by_user_id=$1::text, updated_at=NOW()
        WHERE task_id=$4
    """, user["user_id"], payload.notes, new_col_id, task_id)

    # Notify task creator
    if task.get("created_by_user_id") and task["created_by_user_id"] != user["user_id"]:
        await send_approval_notification(pool, task_id, task["title"],
                                         task["created_by_user_id"], "approved", payload.notes, team_id=task.get("team_id"))

    # Fan-out: in-app notification + email to all project members/owners + client
    try:
        from email_service import send_team_sync_email
        from services.web_push_service import send_web_push
        from services.expo_push_service import send_expo_push
        recipients = await pool.fetch("""
            SELECT DISTINCT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS name
            FROM project_assignments pa
            JOIN users u ON u.user_id = pa.user_id
            WHERE pa.team_id=$1
            UNION
            SELECT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS name
            FROM users u WHERE u.user_id=$2
        """, task["team_id"], user["user_id"])
        notif_title = f"{client_name} approved a task"
        notif_body  = task["title"]
        task_url    = f"/tasks/{task_id}"
        for r in recipients:
            if r["user_id"] == user["user_id"]:
                continue  # don't notify the client themselves
            try:
                send_team_sync_email(r["email"], r["name"], client_name, task["title"], task_id)
            except Exception:
                pass
            try:
                await _notify(pool, task_id, task["title"], r["user_id"], "approved", payload.notes, team_id=task.get("team_id"))
            except Exception:
                pass
            _bg_push(send_web_push(pool, user_id=r["user_id"], title=notif_title, body=notif_body, url=task_url), "web-push")
            _bg_push(send_expo_push(pool, user_id=r["user_id"], title=notif_title, body=notif_body, url=task_url, task_id=task_id), "expo-push")
    except Exception as exc:
        _logger.warning("team-sync fan-out failed: %s", exc)

    return {"message": "Task approved by client", "approval_status": "approved",
            "new_column_id": new_col_id}


@router.get("/approvals/by-token/{token}")
async def get_approval_by_token(token: str, pool=Depends(get_pool)):
    """Public endpoint — no auth required; used by email magic-link."""
    payload = _decode_client_token(token)
    task_id = payload["task_id"]
    task = await pool.fetchrow("""
        SELECT t.task_id, t.title, t.description, t.priority, t.due_at, t.approval_status,
               t.approval_notes AS notes, t.approval_requested_at AS requested_at,
               COALESCE(u.full_name, u.name, u.email) AS requester_name
        FROM tasks t
        LEFT JOIN users u ON u.user_id = t.created_by_user_id
        WHERE t.task_id = $1
    """, task_id)
    if not task:
        raise HTTPException(404, _TASK_NOT_FOUND)
    if task["approval_status"] not in ("pending_client",):
        # Already decided — return only the decision status, no task content
        return {
            "task": {"task_id": task["task_id"], "title": task["title"],
                     "approval_status": task["approval_status"]},
            "already_decided": True,
            "requester_name": task["requester_name"],
            "requested_at": task["requested_at"],
        }
    return {"task": dict(task), "already_decided": False,
            "requester_name": task["requester_name"], "requested_at": task["requested_at"]}


@router.post("/approvals/by-token/{token}/approve")
async def approve_by_token(token: str, payload_body: ApprovalRequest, pool=Depends(get_pool)):
    """Public magic-link endpoint — client approves via email link."""
    payload = _decode_client_token(token)
    task_id        = payload["task_id"]
    client_user_id = payload["client_user_id"]
    task = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
    if not task:
        raise HTTPException(404, _TASK_NOT_FOUND)
    if task["approval_status"] != "pending_client":
        raise HTTPException(400, "This approval link is no longer active")
    # Verify the client is still authorized at decision time (token alone is not sufficient)
    access = await pool.fetchrow(
        "SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2", task_id, client_user_id
    )
    if not access:
        raise HTTPException(403, "Client is not authorized to approve this task")
    done_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND is_done=TRUE ORDER BY sort_order DESC LIMIT 1",
        task["team_id"]
    )
    new_col_id = done_col["column_id"] if done_col else task["column_id"]
    await pool.execute("""
        UPDATE tasks SET approval_status='approved', approved_by=$1::text, approval_notes=$2,
            approval_decided_at=NOW(), column_id=$3, status='done',
            completed_at=NOW(), completed_by_user_id=$1::text, updated_at=NOW()
        WHERE task_id=$4
    """, client_user_id, payload_body.notes, new_col_id, task_id)
    # Notify task creator in-app
    if task.get("created_by_user_id") and task["created_by_user_id"] != client_user_id:
        await send_approval_notification(pool, task_id, task["title"],
                                         task["created_by_user_id"], "approved", payload_body.notes, team_id=task.get("team_id"))
    # Fan-out: in-app notification + email to all project members/owners
    try:
        client_row = await pool.fetchrow(
            "SELECT COALESCE(full_name, name, email) AS name FROM users WHERE user_id=$1", client_user_id
        )
        client_name = client_row["name"] if client_row else "Client"
        recipients = await pool.fetch("""
            SELECT DISTINCT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS name
            FROM project_assignments pa
            JOIN users u ON u.user_id = pa.user_id
            WHERE pa.team_id=$1
            UNION
            SELECT DISTINCT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS name
            FROM users u WHERE u.user_id=$2
        """, task["team_id"], client_user_id)
        from email_service import send_team_sync_email
        from services.web_push_service import send_web_push
        from services.expo_push_service import send_expo_push
        notif_title = f"{client_name} approved a task"
        notif_body  = task["title"]
        task_url    = f"/tasks/{task_id}"
        for r in recipients:
            if r["user_id"] == client_user_id:
                continue  # don't notify the client themselves
            try:
                send_team_sync_email(r["email"], r["name"], client_name, task["title"], task_id)
            except Exception:
                pass
            try:
                await _notify(pool, task_id, task["title"], r["user_id"], "approved", payload_body.notes, team_id=task.get("team_id"))
            except Exception:
                pass
            _bg_push(send_web_push(pool, user_id=r["user_id"], title=notif_title, body=notif_body, url=task_url), "web-push")
            _bg_push(send_expo_push(pool, user_id=r["user_id"], title=notif_title, body=notif_body, url=task_url, task_id=task_id), "expo-push")
    except Exception as exc:
        _logger.warning("team-sync fan-out failed: %s", exc)
    return {"message": "Task approved by client", "approval_status": "approved"}


@router.post("/approvals/by-token/{token}/reject")
async def reject_by_token(token: str, payload_body: ApprovalRequest, pool=Depends(get_pool)):
    """Public magic-link endpoint — client rejects via email link."""
    payload = _decode_client_token(token)
    task_id        = payload["task_id"]
    client_user_id = payload["client_user_id"]
    task = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
    if not task:
        raise HTTPException(404, _TASK_NOT_FOUND)
    if task["approval_status"] != "pending_client":
        raise HTTPException(400, "This approval link is no longer active")
    # Verify the client is still authorized at decision time (token alone is not sufficient)
    access = await pool.fetchrow(
        "SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2", task_id, client_user_id
    )
    if not access:
        raise HTTPException(403, "Client is not authorized to reject this task")
    if not payload_body.notes or not payload_body.notes.strip():
        raise HTTPException(400, _REJECTION_REQUIRED)
    revision_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND is_done=FALSE ORDER BY sort_order ASC LIMIT 1",
        task["team_id"]
    )
    new_col_id = revision_col["column_id"] if revision_col else task["column_id"]
    await pool.execute("""
        UPDATE tasks SET approval_status='rejected', approved_by=$1, approval_notes=$2,
            approval_decided_at=NOW(), column_id=$3, status='in_progress', updated_at=NOW()
        WHERE task_id=$4
    """, client_user_id, payload_body.notes, new_col_id, task_id)
    if task.get("created_by_user_id"):
        await send_approval_notification(pool, task_id, task["title"],
                                         task["created_by_user_id"], "rejected", payload_body.notes, team_id=task.get("team_id"))
    return {"message": "Task rejected by client", "approval_status": "rejected"}


@router.post("/tasks/{task_id}/client-reject")
async def client_reject_task(task_id: str, payload: ApprovalRequest,
                              pool=Depends(get_pool), user=Depends(require_user)):
    """Allow an authenticated client user to reject a pending_client task with a reason."""
    task   = await get_task_with_permission(pool, task_id, user["user_id"])
    if user.get("role") != "admin":
        access = await pool.fetchrow(
            "SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2",
            task_id, user["user_id"]
        )
        if not access:
            raise HTTPException(403, "Only the assigned client can reject this task")

    if not payload.notes or not payload.notes.strip():
        raise HTTPException(400, _REJECTION_REQUIRED)

    revision_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND is_done=FALSE ORDER BY sort_order ASC LIMIT 1",
        task["team_id"]
    )
    new_col_id = revision_col["column_id"] if revision_col else task["column_id"]

    await pool.execute("""
        UPDATE tasks
        SET approval_status='rejected', approved_by=$1, approval_notes=$2,
            approval_decided_at=NOW(), column_id=$3, status='in_progress', updated_at=NOW()
        WHERE task_id=$4
    """, user["user_id"], payload.notes, new_col_id, task_id)

    if task.get("created_by_user_id"):
        await send_approval_notification(pool, task_id, task["title"],
                                         task["created_by_user_id"], "rejected", payload.notes, team_id=task.get("team_id"))
    for uid in (task.get("assignee_user_ids") or []):
        if uid != task.get("created_by_user_id"):
            await send_approval_notification(pool, task_id, task["title"], uid, "rejected", payload.notes, team_id=task.get("team_id"))

    return {"message": "Task rejected by client", "approval_status": "rejected",
            "new_column_id": new_col_id}
