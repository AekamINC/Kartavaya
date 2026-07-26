"""
invite_router.py — Kartavaya by Aekam Inc
Admin-only invite system. No public registration.
"""
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from db import get_pool
from middleware.roles import require_platform_role
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES, GOD_MODE_ROLES, MANAGER_ROLES, STAFF_ROLES,
    SUPERUSER_ONLY_ROLES, strongest,
)

# Who may open the platform console. Reaching the console is not the same as
# reading what is in it — role_tiers.can_reach_module still decides that per
# module, so a platform_staff who opens an org sees the operating set and not
# its payroll.
CONSOLE_ROLES = GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + ("account_manager",)
CONSOLE_ROLES_WITH_FINANCE = CONSOLE_ROLES + ("account_finance",)


_require_admin = require_platform_role(*CONSOLE_ROLES)

router = APIRouter(prefix="/api/admin", tags=["admin"])

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://kartavaya.com")


# ── The account-type ladder ───────────────────────────────────────────────────
#
# `users.role` is the LEGACY account type, not a tier in the four-tier model. It
# is not dead: `approvals_router.py:402,610` and `server.py:345,1134` still read
# it, so a user created at `admin` can approve work and act as a team admin.
#
# Which means minting one is a role grant, and role_tiers.py:138-141 is explicit
# about those: "Role assignment in particular must never be delegated — a role
# that can grant roles can grant itself anything." So the top rung is
# SUPERUSER_ONLY_ROLES. The lower two are open to the whole console.
#
# Before this, `create_invite`, `update_user` and `change_user_role` each
# validated `role in ("admin","member","client")` and stopped there — no
# comparison against the caller at all. A platform_staff, whose entire remit is
# the operating set (CRM, marketing, Srijan), could invite an `admin` and then
# sign in as them.
ACCOUNT_TYPES: tuple[str, ...] = ("client", "member", "admin")

#: Account types any console role may hand out.
DELEGABLE_ACCOUNT_TYPES: frozenset[str] = frozenset({"client", "member"})


async def _caller_platform_role(pool, user_id: str) -> str | None:
    """The caller's strongest platform role, or None."""
    rows = await pool.fetch(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
        user_id, list(ALL_PLATFORM_ROLES),
    )
    return strongest([r["role_code"] for r in rows])


async def _assert_may_grant(pool, caller: dict, account_type: str) -> None:
    """Refuse an account type the caller is not senior enough to hand out."""
    if account_type not in ACCOUNT_TYPES:
        raise HTTPException(400, "Role must be 'admin', 'member', or 'client'")
    if account_type in DELEGABLE_ACCOUNT_TYPES:
        return
    role = await _caller_platform_role(pool, caller["user_id"])
    if role not in SUPERUSER_ONLY_ROLES:
        raise HTTPException(
            403,
            "Only a platform owner may create an admin account. "
            "Invite them as a member and have an owner raise the account type.",
        )


async def _assert_target_not_platform(pool, caller: dict, target_user_id: str,
                                      what: str) -> None:
    """Refuse to touch a user who holds a platform role, unless the caller is god mode.

    Without this, every write below is a lateral escalation: `remove_user` is
    guarded by CONSOLE_ROLES, so a platform_staff could delete a platform_owner's
    account outright, and `update_user` could re-point their email.
    """
    target_role = await _caller_platform_role(pool, target_user_id)
    if not target_role:
        return
    caller_role = await _caller_platform_role(pool, caller["user_id"])
    if caller_role not in SUPERUSER_ONLY_ROLES:
        raise HTTPException(
            403,
            f"{what} a user who holds the {target_role} platform role requires "
            "a platform owner.",
        )


# ── Schemas ───────────────────────────────────────────────────────────────────

class InviteCreate(BaseModel):
    email: EmailStr
    role: str = "member"                       # account type: admin | member | client
    full_name: Optional[str] = None
    member_role: Optional[str] = None          # job title / position
    receives_approval_emails: bool = True      # client approval emails


class InviteOut(BaseModel):
    """Returned by `create_invite` ONLY — it is the one response that carries the
    redemption link, and only to the person who just created it."""
    invite_id: str
    email: str
    role: str
    invite_link: str
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    full_name: Optional[str] = None
    member_role: Optional[str] = None
    receives_approval_emails: Optional[bool] = True
    invited_by_name: Optional[str] = None


class InviteListOut(BaseModel):
    """The listing shape. Deliberately has no `invite_link` and no `token`
    field — a response model without them cannot leak them by accident later."""
    invite_id: str
    email: str
    role: str
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    full_name: Optional[str] = None
    member_role: Optional[str] = None
    receives_approval_emails: Optional[bool] = True
    invited_by_name: Optional[str] = None


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    full_name: Optional[str] = None
    role: str
    position: Optional[str] = None
    company_name: Optional[str] = None
    member_role: Optional[str] = None
    receives_approval_emails: Optional[bool] = True
    avatar: Optional[str] = None
    # provider intentionally omitted — OAuth provider type is internal metadata
    created_at: datetime


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    member_role: Optional[str] = None          # job title / position
    company_name: Optional[str] = None
    receives_approval_emails: Optional[bool] = None


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=List[UserOut])
async def list_users(pool=Depends(get_pool), admin=Depends(_require_admin)):
    rows = await pool.fetch(
        """SELECT user_id, email, name, full_name, role, position, company_name,
                  member_role, receives_approval_emails, avatar, created_at
           FROM users ORDER BY created_at DESC"""
    )
    return [UserOut(**dict(r)) for r in rows]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Edit a user's profile fields. Email is immutable."""
    await _assert_target_not_platform(pool, admin, user_id, "Editing")

    # Build dynamic SET clause for only provided fields
    fields, vals = [], []
    if body.full_name is not None:
        fields.append(f"full_name=${len(vals)+1}"); vals.append(body.full_name)
    if body.role is not None:
        await _assert_may_grant(pool, admin, body.role)
        fields.append(f"role=${len(vals)+1}"); vals.append(body.role)
    if body.member_role is not None:
        fields.append(f"member_role=${len(vals)+1}"); vals.append(body.member_role)
    if body.company_name is not None:
        fields.append(f"company_name=${len(vals)+1}"); vals.append(body.company_name)
    if body.receives_approval_emails is not None:
        fields.append(f"receives_approval_emails=${len(vals)+1}"); vals.append(body.receives_approval_emails)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    vals.append(user_id)
    await pool.execute(
        f"UPDATE users SET {', '.join(fields)}, updated_at=NOW() WHERE user_id=${len(vals)}",
        *vals
    )
    row = await pool.fetchrow(
        """SELECT user_id, email, name, full_name, role, position, company_name,
                  member_role, receives_approval_emails, avatar, created_at
           FROM users WHERE user_id=$1""", user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(**dict(row))


@router.put("/users/{user_id}/role")
async def change_user_role(user_id: str, body: dict, pool=Depends(get_pool), admin=Depends(_require_admin)):
    role = body.get("role")
    await _assert_may_grant(pool, admin, role)
    await _assert_target_not_platform(pool, admin, user_id, "Changing the role of")
    await pool.execute("UPDATE users SET role=$1, updated_at=NOW() WHERE user_id=$2", role, user_id)
    return {"ok": True}


@router.delete("/users/{user_id}")
async def remove_user(user_id: str, reassign_to: Optional[str] = None, pool=Depends(get_pool), admin=Depends(_require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    await _assert_target_not_platform(pool, admin, user_id, "Deleting")
    if reassign_to == user_id:
        raise HTTPException(status_code=400, detail="Cannot reassign to the same user")
    if reassign_to:
        target = await pool.fetchrow(
            "SELECT user_id, role FROM users WHERE user_id=$1", reassign_to
        )
        if not target:
            raise HTTPException(status_code=404, detail="Reassign target user not found")
        # Prevent reassigning to a client account — clients should not appear
        # as task creators or team leads.
        if target["role"] == "client":
            raise HTTPException(status_code=400, detail="Cannot reassign work to a client account")

    r = reassign_to  # shorthand

    # Run each cleanup statement on its own connection (auto-commit).
    # Never share a transaction across optional cleanup — a failed statement
    # inside a Postgres transaction aborts the entire block, and there is no
    # way to recover with plain try/except.
    async def run(sql, *args):
        """Execute one statement, silently ignore any error."""
        try:
            async with pool.acquire() as c:
                await c.execute(sql, *args)
        except Exception:
            pass

    # ── Memberships (remove — cannot transfer) ────────────────────────────────
    await run("DELETE FROM team_members        WHERE user_id=$1", user_id)
    await run("DELETE FROM project_assignments WHERE user_id=$1", user_id)
    await run("DELETE FROM task_clients        WHERE user_id=$1", user_id)

    # ── Activity events ───────────────────────────────────────────────────────
    if r: await run("UPDATE activity_events SET actor_id=$1   WHERE actor_id=$2",  r, user_id)
    else: await run("DELETE FROM activity_events               WHERE actor_id=$1",  user_id)

    # ── Time entries ──────────────────────────────────────────────────────────
    if r: await run("UPDATE time_entries SET user_id=$1        WHERE user_id=$2",   r, user_id)
    else: await run("DELETE FROM time_entries                  WHERE user_id=$1",   user_id)

    # ── Comments (try both table/column name variants) ────────────────────────
    # Allowlist guards against future drift — never add entries with user-controlled values.
    _ALLOWED_COMMENT_TABLES = frozenset({("task_comments", "user_id"), ("comments", "author_id")})
    for tbl, col in [("task_comments", "user_id"), ("comments", "author_id")]:
        if (tbl, col) not in _ALLOWED_COMMENT_TABLES:
            continue
        if r: await run(f"UPDATE {tbl} SET {col}=$1 WHERE {col}=$2", r, user_id)
        else: await run(f"DELETE FROM {tbl}          WHERE {col}=$1",    user_id)

    # ── Tasks: created_by_user_id ─────────────────────────────────────────────
    if r:
        await run("UPDATE tasks SET created_by_user_id=$1 WHERE created_by_user_id=$2", r, user_id)
    else:
        # Per-team fallback to owner/admin
        try:
            async with pool.acquire() as c:
                task_teams = await c.fetch(
                    "SELECT DISTINCT team_id FROM tasks WHERE created_by_user_id=$1", user_id
                )
                for tt in task_teams:
                    tid = tt["team_id"]
                    fallback = await c.fetchval("""
                        SELECT user_id FROM project_assignments
                        WHERE team_id=$1 AND role IN ('owner','admin') AND user_id != $2
                        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1
                    """, tid, user_id)
                    await c.execute(
                        "UPDATE tasks SET created_by_user_id=$1 WHERE created_by_user_id=$2 AND team_id=$3",
                        fallback, user_id, tid
                    )
        except Exception:
            pass

    # ── Tasks: user_id column (may have FK) ───────────────────────────────────
    if r: await run("UPDATE tasks SET user_id=$1             WHERE user_id=$2",              r, user_id)
    else: await run("UPDATE tasks SET user_id=NULL           WHERE user_id=$1",              user_id)

    # ── Tasks: assigned_by_user_id ────────────────────────────────────────────
    if r: await run("UPDATE tasks SET assigned_by_user_id=$1 WHERE assigned_by_user_id=$2", r, user_id)
    else: await run("UPDATE tasks SET assigned_by_user_id=NULL WHERE assigned_by_user_id=$1", user_id)

    # ── Tasks: assignee_user_ids[] ────────────────────────────────────────────
    if r:
        await run("""
            UPDATE tasks
            SET assignee_user_ids = array_append(array_remove(assignee_user_ids,$1), $2)
            WHERE $1=ANY(assignee_user_ids) AND NOT ($2=ANY(assignee_user_ids))
        """, user_id, r)
    await run(
        "UPDATE tasks SET assignee_user_ids=array_remove(assignee_user_ids,$1) WHERE $1=ANY(assignee_user_ids)",
        user_id
    )

    # ── Task assignees junction table ─────────────────────────────────────────
    if r: await run("UPDATE task_assignees SET user_id=$1 WHERE user_id=$2", r, user_id)
    else: await run("DELETE FROM task_assignees            WHERE user_id=$1",   user_id)

    # ── Approvals ─────────────────────────────────────────────────────────────
    if r:
        await run("UPDATE approvals SET requested_by=$1 WHERE requested_by=$2", r, user_id)
        await run("UPDATE approvals SET approved_by=$1   WHERE approved_by=$2",  r, user_id)
    else:
        await run("UPDATE approvals SET requested_by=NULL WHERE requested_by=$1", user_id)
        await run("UPDATE approvals SET approved_by=NULL   WHERE approved_by=$1",  user_id)

    # ── Report schedules ──────────────────────────────────────────────────────
    if r: await run("UPDATE report_schedules SET created_by=$1 WHERE created_by=$2", r, user_id)
    else: await run("DELETE FROM report_schedules              WHERE created_by=$1",    user_id)

    # ── Automations ───────────────────────────────────────────────────────────
    if r: await run("UPDATE automations SET created_by=$1 WHERE created_by=$2", r, user_id)
    else: await run("DELETE FROM automations              WHERE created_by=$1",    user_id)

    # ── Invites ───────────────────────────────────────────────────────────────
    if r: await run("UPDATE invites SET invited_by=$1 WHERE invited_by=$2", r, user_id)
    else: await run("UPDATE invites SET invited_by=NULL WHERE invited_by=$1", user_id)
    await run("DELETE FROM invites WHERE email=(SELECT email FROM users WHERE user_id=$1)", user_id)

    # ── Sessions / tokens ─────────────────────────────────────────────────────
    for tbl in ("refresh_tokens", "sessions"):
        await run(f"DELETE FROM {tbl} WHERE user_id=$1", user_id)

    # ── Delete the user (final, must succeed) ─────────────────────────────────
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM users WHERE user_id=$1", user_id)

    return {"ok": True}


# ── Invites ───────────────────────────────────────────────────────────────────

@router.post("/invites", response_model=InviteOut)
async def create_invite(body: InviteCreate, pool=Depends(get_pool), admin=Depends(_require_admin)):
    await _assert_may_grant(pool, admin, body.role)

    existing = await pool.fetchrow("SELECT 1 FROM users WHERE email=$1", body.email.lower())
    if existing:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    # Expire old pending invites for same email
    await pool.execute(
        "UPDATE invites SET expires_at=NOW() WHERE email=$1 AND accepted_at IS NULL",
        body.email.lower(),
    )

    token      = secrets.token_urlsafe(32)
    invite_id  = f"inv_{uuid.uuid4().hex[:12]}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    await pool.execute(
        """INSERT INTO invites
               (invite_id, email, role, token, invited_by, expires_at,
                full_name, member_role, receives_approval_emails)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
        invite_id, body.email.lower(), body.role, token, admin["user_id"], expires_at,
        body.full_name or None, body.member_role or None, body.receives_approval_emails,
    )

    invite_link = f"{FRONTEND_URL}/accept-invite?token={token}"

    try:
        from email_service import send_invite_email
        inviter_name   = admin.get("full_name") or admin.get("name") or admin.get("email", "An admin")
        inviter_role   = (admin.get("role") or "admin").capitalize()
        workspace_name = admin.get("company_name")
        if not workspace_name:
            row = await pool.fetchrow(
                "SELECT company_name FROM users WHERE company_name IS NOT NULL LIMIT 1"
            )
            workspace_name = (row["company_name"] if row else None) or "Kartavaya"
        expires_label  = expires_at.strftime("%b %-d, %Y")
        send_invite_email(body.email.lower(), inviter_name, body.role, token,
                          workspace_name=workspace_name,
                          expires_label=expires_label,
                          recipient_name=body.full_name or "",
                          inviter_role=inviter_role)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("invite email failed: %s", exc)

    inviter_name = admin.get("full_name") or admin.get("name") or admin.get("email")

    return InviteOut(
        invite_id=invite_id,
        email=body.email.lower(),
        role=body.role,
        invite_link=invite_link,
        created_at=datetime.now(timezone.utc),
        expires_at=expires_at,
        accepted_at=None,
        full_name=body.full_name or None,
        member_role=body.member_role or None,
        receives_approval_emails=body.receives_approval_emails,
        invited_by_name=inviter_name,
    )


@router.get("/invites", response_model=List[InviteListOut])
async def list_invites(pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Pending and accepted invites. **Never carries the token.**

    This endpoint used to select `i.token` and hand back a ready-made
    `/accept-invite?token=…` link for every invite in the system, 100 at a time,
    to anyone holding CONSOLE_ROLES — which includes platform_staff and
    account_manager.

    `POST /api/auth/accept-invite` asks for nothing but that token: it looks the
    invite up by it, creates the account, and sets whatever password the caller
    supplies. So the list was a set of live credentials for every account that
    had not been claimed yet, readable by roles whose remit is CRM and
    marketing. The token is 256 bits from `secrets.token_urlsafe(32)` and cannot
    be guessed — it did not need to be.

    The link is still returned once, by `create_invite`, to the person who
    created it. That is the only party who should ever hold it.
    """
    rows = await pool.fetch(
        """SELECT i.invite_id, i.email, i.role, i.created_at, i.expires_at,
                  i.accepted_at, i.full_name, i.member_role, i.receives_approval_emails,
                  COALESCE(u.full_name, u.name, u.email) AS invited_by_name
           FROM invites i
           LEFT JOIN users u ON u.user_id = i.invited_by
           ORDER BY i.created_at DESC LIMIT 100"""
    )
    return [InviteListOut(**dict(r)) for r in rows]


@router.post("/users/{user_id}/send-reset-link")
async def admin_send_reset_link(user_id: str, pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Admin action: generate a password-reset link and email it to the user."""
    user = await pool.fetchrow("SELECT user_id, name, email FROM users WHERE user_id=$1", user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    reset_token = secrets.token_urlsafe(32)
    await pool.execute(
        """UPDATE users SET password_reset_token=$1,
           password_reset_expires=NOW() + INTERVAL '1 hour'
           WHERE user_id=$2""",
        reset_token, user_id,
    )
    try:
        from email_service import send_password_reset_email
        send_password_reset_email(user["email"], user["name"] or user["email"], reset_token)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("reset email failed: %s", exc)
    return {"ok": True}


@router.delete("/invites/{invite_id}")
async def revoke_invite(invite_id: str, pool=Depends(get_pool), admin=Depends(_require_admin)):
    await pool.execute("DELETE FROM invites WHERE invite_id=$1", invite_id)
    return {"ok": True}


# ── R2 folder map ───────────────────────────────────────────────────────────

class TeamFolderOut(BaseModel):
    team_id: str
    name: str
    r2_folder: str   # path prefix this project's files are stored under in R2


@router.get("/teams", response_model=List[TeamFolderOut])
async def list_team_folders(pool=Depends(get_pool), admin=Depends(_require_admin)):
    """team_id → project name lookup, so an admin can identify R2 folders
    (which are keyed by team_id, e.g. projects/{team_id}/...) without
    needing direct database access."""
    rows = await pool.fetch(
        "SELECT team_id, name FROM teams WHERE deleted_at IS NULL ORDER BY name"
    )
    return [
        TeamFolderOut(team_id=r["team_id"], name=r["name"], r2_folder=f"projects/{r['team_id']}/")
        for r in rows
    ]
