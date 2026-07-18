"""
auth_router.py — Kartavaya by Aekam Inc
Invite-only auth. No public registration.
Roles: admin | member | client
"""
import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field

from db import get_pool
from limiter import limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable must be set")
JWT_ALGORITHM = "HS256"
JWT_TTL_DAYS = 30


def _hash_password(password: str, salt: str) -> str:
    """Return the PBKDF2-SHA256 hex digest of password with the given salt."""
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000).hex()


def _verify_password(password: str, salt: str, stored: str) -> bool:
    """Return True if the password matches the stored hash using constant-time comparison."""
    return hmac.compare_digest(_hash_password(password, salt), stored)


def _create_token(user_id: str) -> str:
    """Create a signed JWT for the given user_id with a 30-day expiry."""
    return jwt.encode(
        {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=JWT_TTL_DAYS), "iat": datetime.now(timezone.utc)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )


def _decode_token(token: str) -> Optional[str]:
    """Decode a JWT and return the user_id subject, or None if invalid."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])["sub"]
    except jwt.PyJWTError:
        return None


async def require_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """FastAPI dependency that validates the Bearer token and returns the user dict."""
    # Cache resolved user on the request state for this request's lifetime.
    # Avoids a DB round-trip when multiple dependencies call require_user
    # on the same request (e.g. require_admin → require_user).
    cached = getattr(request.state, "_auth_user", None)
    if cached is not None:
        return cached

    token = credentials.credentials if credentials else request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = _decode_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    pool = await get_pool()
    user = await pool.fetchrow(
        "SELECT user_id,email,name,full_name,role,avatar,position,company_name,"
        "member_role,receives_approval_emails FROM users WHERE user_id=$1",
        user_id,
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    result = dict(user)
    request.state._auth_user = result
    return result


async def require_admin(user=Depends(require_user)):
    """FastAPI dependency that raises 403 unless the user has the admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


class AcceptInviteBody(BaseModel):
    token: str
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


def _safe_user(u: dict, platform_roles: list[str] | None = None, org_roles: list[dict] | None = None) -> dict:
    """Return a public-safe subset of user fields for API responses."""
    out = {
        "id": u["user_id"],
        "user_id": u["user_id"],
        "name": u["name"],
        "email": u["email"],
        "role": u.get("role", "member"),
        "avatar": u.get("avatar"),
    }
    if platform_roles:
        out["platform_roles"] = platform_roles
    if org_roles:
        out["org_roles"] = org_roles
    return out


@router.post("/accept-invite")
@limiter.limit("10/minute")
async def accept_invite(request: Request, body: AcceptInviteBody):
    """Called when a user clicks their invite link and sets their password."""
    pool = await get_pool()
    invite = await pool.fetchrow("SELECT * FROM invites WHERE token=$1", body.token)
    if not invite:
        raise HTTPException(status_code=400, detail="Invite link is invalid or has expired")

    # Invite already accepted — never verify the password here (brute-force oracle).
    # Direct the user to the login page instead.
    if invite["accepted_at"] is not None:
        raise HTTPException(status_code=400, detail="Account already activated — please sign in.")

    if invite["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite link has expired. Ask your admin for a new one.")

    existing = await pool.fetchrow("SELECT user_id FROM users WHERE email=$1", invite["email"])
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    salt = uuid.uuid4().hex
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    role = invite["role"]  # "member" or "client"
    # Carry invite metadata into the user record so admin-set fields aren't lost
    full_name = invite.get("full_name") or body.name
    member_role = invite.get("member_role")
    receives_approval_emails = invite.get("receives_approval_emails", True)

    await pool.execute(
        """INSERT INTO users
               (user_id, name, full_name, email, password_hash, salt, role,
                member_role, receives_approval_emails)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
        user_id, body.name, full_name, invite["email"],
        _hash_password(body.password, salt), salt, role,
        member_role, receives_approval_emails,
    )
    await pool.execute(
        "UPDATE invites SET accepted_at=NOW() WHERE token=$1", body.token
    )
    # Activate any pending team invites for this email
    await pool.execute(
        "UPDATE team_members SET user_id=$1, status='active', updated_at=NOW() WHERE email=$2 AND status='invited'",
        user_id, invite["email"],
    )
    # Sync to project_assignments so the user can create/view tasks
    await pool.execute("""
        INSERT INTO project_assignments (assignment_id, team_id, user_id, role)
        SELECT 'pa_' || substr(md5(random()::text), 1, 12), team_id, $1,
               CASE WHEN role IN ('owner','admin','member','client') THEN role ELSE 'member' END
        FROM team_members
        WHERE user_id=$1 AND status='active'
        ON CONFLICT (team_id, user_id) DO NOTHING
    """, user_id)
    user = await pool.fetchrow("SELECT * FROM users WHERE user_id=$1", user_id)

    try:
        from email_service import send_welcome_email
        send_welcome_email(invite["email"], body.name)
    except Exception:
        pass

    return {"token": _create_token(user_id), "user": _safe_user(dict(user))}


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginBody):
    """Authenticate with email and password and return a JWT and user profile."""
    pool = await get_pool()
    user = await pool.fetchrow("SELECT * FROM users WHERE email=$1", body.email.lower())
    if not user or not _verify_password(body.password, user["salt"], user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        user["user_id"],
    )
    platform_roles = [r["role_code"] for r in pr]
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member')",
        user["user_id"],
    )
    org_roles = [dict(r) for r in or_rows]
    return {"token": _create_token(user["user_id"]), "user": _safe_user(dict(user), platform_roles, org_roles)}


@router.post("/logout")
async def logout():
    """Invalidate the session (client-side token deletion)."""
    return {"ok": True}


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    password: str = Field(..., min_length=8, max_length=128)


@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, body: ForgotPasswordBody):
    """Generate a password-reset token and email it. Always returns 200 to avoid email enumeration."""
    pool = await get_pool()
    user = await pool.fetchrow("SELECT user_id, name, email FROM users WHERE email=$1", body.email.lower())
    if user:
        reset_token = secrets.token_urlsafe(32)
        await pool.execute(
            """UPDATE users SET password_reset_token=$1,
               password_reset_expires=NOW() + INTERVAL '1 hour'
               WHERE user_id=$2""",
            reset_token, user["user_id"],
        )
        try:
            from email_service import send_password_reset_email
            send_password_reset_email(user["email"], user["name"] or user["email"], reset_token)
        except Exception:
            pass
    return {"ok": True}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody):
    """Verify a password-reset token and update the user's password."""
    pool = await get_pool()
    user = await pool.fetchrow(
        "SELECT * FROM users WHERE password_reset_token=$1 AND password_reset_expires > NOW()",
        body.token,
    )
    if not user:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")
    salt = uuid.uuid4().hex
    await pool.execute(
        """UPDATE users SET password_hash=$1, salt=$2,
           password_reset_token=NULL, password_reset_expires=NULL
           WHERE user_id=$3""",
        _hash_password(body.password, salt), salt, user["user_id"],
    )
    return {"token": _create_token(user["user_id"]), "user": _safe_user(dict(user))}


@router.get("/me")
async def me(current_user: dict = Depends(require_user)):
    """Return the authenticated user's public profile."""
    pool = await get_pool()
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        current_user["user_id"],
    )
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member')",
        current_user["user_id"],
    )
    return _safe_user(current_user, [r["role_code"] for r in pr], [dict(r) for r in or_rows])
