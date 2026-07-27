"""
auth_router.py — Kartavaya by Aekam Inc
Invite-only auth. No public registration.
Roles: admin | member | client
"""
import hashlib
import hmac
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field

from db import get_pool
from limiter import limiter
from middleware.role_tiers import SENSITIVE_MODULES, modules_for, strongest
from services.audit import emit as audit

_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") != "0"
_COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", None) or None

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable must be set")
JWT_ALGORITHM = "HS256"
JWT_TTL_DAYS = 7


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


def _auth_response(token: str, body: dict) -> JSONResponse:
    """Return a JSON response that also sets the session_token httpOnly cookie."""
    resp = JSONResponse(content=body)
    resp.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=JWT_TTL_DAYS * 86400,
        path="/",
        domain=_COOKIE_DOMAIN,
    )
    return resp


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


def _safe_user(
    u: dict,
    platform_roles: list[str] | None = None,
    org_roles: list[dict] | None = None,
    module_grants: list[str] | None = None,
) -> dict:
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
    # `is not None`, NOT truthiness. An EMPTY list is a real answer — "this
    # member has been granted nothing" — and it is the answer the nav needs in
    # order to hide the modules group. Dropping it on falsiness would turn the
    # one case that matters back into "no opinion", which is what left ten
    # module links in the sidebar of a member who gets 403 on every one.
    if module_grants is not None:
        out["module_grants"] = module_grants
    return out


async def _module_grants(
    pool, user_id: str, platform_roles: list[str], org_roles: list[dict]
) -> list[str] | None:
    """
    Which module codes this user may actually reach — the nav's entitlement feed.

    `01-navigation.md` §4 lists `module_grants[]` on `GET /v1/me` as the field that
    "drives every nav predicate", and `RBAC-SPEC.md` · Denied states rule 1 is
    explicit about what the nav must then do: **"No access → absent from the
    sidebar, never a greyed-out row that advertises what is missing."**

    This MIRRORS `middleware/subscription.py::require_module`, gate for gate, so the
    sidebar cannot promise a module the API refuses:

      gate 1  a platform role decides reach through `role_tiers.modules_for()`
      gate 2  org_owner / org_admin reach every module of their org
      gate 3  org_member reaches only what `org_member_modules` names

    Returning ``None`` means "no opinion" and the client leaves every module
    visible. That is reserved for the two cases where this function genuinely
    cannot answer — an administrator, whose reach is the plan rather than a grant
    row, and a user with no organisation at all. An empty LIST is a different
    answer and is returned deliberately: it means "nothing", and the nav must
    show nothing.

    Sensitive modules are subtracted for anyone below org_admin regardless of what
    the grant table holds. `RBAC-SPEC.md`: "Sensitive modules are role-derived, not
    granted … a grant row naming a sensitive module is invalid input." Filtering
    here keeps a stale row from re-advertising Payroll in the sidebar.
    """
    platform_role = strongest(platform_roles)
    if platform_role:
        return sorted(modules_for(platform_role))

    if not org_roles:
        # A portal client, or staff not yet placed in an org. Neither renders the
        # staff module rail, so there is nothing to gate.
        return None

    # The user's primary org, resolved the same way `middleware/org_resolver.py`
    # resolves it with no `X-Org-Id` header: the earliest grant. Picking a
    # different org here than the API picks would gate the nav against modules
    # the requests are not even scoped to.
    primary = org_roles[0]
    if primary.get("role_code") in ("org_owner", "org_admin"):
        return None

    rows = await pool.fetch(
        "SELECT module_code FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        user_id,
        primary["org_id"],
    )
    return sorted({r["module_code"] for r in rows} - SENSITIVE_MODULES)


#: What an invite preview says when the token is no good. ONE string for every
#: failure — unknown, expired, already accepted and revoked are indistinguishable
#: from outside, so a token cannot be probed for which kind of wrong it is.
_INVITE_DEAD = "This invitation link is not valid. It may have expired, already been used, or been withdrawn."


@router.get("/invite/{token}")
@limiter.limit("20/minute")
async def preview_invite(request: Request, token: str):
    """What the person is being asked to accept, before they accept it.

    The accept screen used to show a name field and a password field and nothing
    about the organisation, the inviter, the role or the module grants — every
    one of which was already stored on the invite row by
    `routers/org_invites.create_org_invite` and applied by `accept_invite`
    below. The data was there; there was no way to read it.

    **On disclosure.** This is an unauthenticated endpoint that returns an email
    address and an organisation name, and that is deliberate rather than an
    oversight. The caller has to hold a 256-bit `secrets.token_urlsafe(32)` that
    was mailed to that address, so holding it already implies knowing it —
    `accept_invite` accepts nothing else, and would let the same caller SET THE
    PASSWORD on the account. A preview strictly discloses less than the accept
    it precedes.

    What it will not do is distinguish *why* a token is no good. Unknown,
    expired, spent and revoked all answer 404 with one string, so the endpoint
    cannot be used to sweep for live tokens or to confirm that a given address
    was ever invited.
    """
    pool = await get_pool()
    # `SELECT *`, and the `.keys()` guards below, for the same reason
    # `accept_invite` uses them: `org_id` and `module_grants` arrive with
    # `PROPOSED_073_org_scoped_invites.sql`, which is a PROPOSAL — naming those
    # columns in the select list would raise UndefinedColumnError on an
    # unmigrated database instead of degrading to the platform-invite shape.
    invite = await pool.fetchrow("SELECT * FROM invites WHERE token=$1", token)
    if (
        not invite
        or invite["accepted_at"] is not None
        or invite["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc)
    ):
        raise HTTPException(status_code=404, detail=_INVITE_DEAD)

    org_id = invite["org_id"] if "org_id" in invite.keys() else None
    org_name = None
    org_members = None
    if org_id:
        org_name = await pool.fetchval(
            "SELECT name FROM staging.organisations WHERE id=$1::uuid", str(org_id)
        )
        org_members = await pool.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
            "WHERE org_id=$1::uuid AND role_code = ANY($2::text[])",
            str(org_id), ["org_owner", "org_admin", "org_member"],
        )

    inviter = None
    if invite["invited_by"]:
        inviter = await pool.fetchval(
            "SELECT COALESCE(full_name, name, email) FROM users WHERE user_id=$1",
            invite["invited_by"],
        )

    raw = invite["module_grants"] if "module_grants" in invite.keys() else None
    try:
        grants = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (TypeError, ValueError):
        grants = []

    # A grant is re-checked against the org's live subscriptions for the same
    # reason `accept_invite` re-checks before writing one: an invite is good for
    # seven days and a module can be switched off inside that window. Promising
    # access on this screen that the accept will then silently drop is the exact
    # mismatch worth avoiding, since this screen is the promise.
    if grants and org_id:
        active = {
            r["module_code"]
            for r in await pool.fetch(
                "SELECT module_code FROM staging.module_subscriptions "
                "WHERE org_id=$1::uuid AND is_active = TRUE",
                str(org_id),
            )
        }
        grants = [g for g in grants if (g or {}).get("code") in active]

    # Whether the address already has an account decides which form the screen
    # draws. Today this can only be TRUE for someone who signed up in the window
    # between issue and acceptance — both invite creators refuse an address that
    # already has one (`invite_router.py:365`, `org_invites.py:236`).
    has_account = await pool.fetchval(
        "SELECT 1 FROM users WHERE LOWER(email)=LOWER($1)", invite["email"]
    )

    return {
        "email": invite["email"],
        "full_name": invite["full_name"],
        "account_type": invite["role"],
        "org_id": str(org_id) if org_id else None,
        "org_name": org_name,
        "org_members": org_members,
        "org_role": invite["member_role"] if org_id else None,
        "invited_by_name": inviter,
        "module_grants": [
            {"code": g.get("code"), "role": g.get("role") or "viewer"}
            for g in grants if (g or {}).get("code")
        ],
        "expires_at": invite["expires_at"].replace(tzinfo=timezone.utc).isoformat(),
        "account_exists": bool(has_account),
    }


@router.post("/invite/{token}/decline")
@limiter.limit("10/minute")
async def decline_invite(request: Request, token: str):
    """Turn down an invitation. The reference screen offers it; nothing did it.

    Declining expires the row rather than deleting it, so the org's own
    `GET /api/v1/org/invites` stops listing it (that query is
    `expires_at > NOW()`) while the audit trail of who invited whom survives.

    Same single answer as the preview for a token that is not live, and it is
    idempotent — declining twice is not an error, because a person who clicks it
    again has not done anything wrong.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE invites SET expires_at = NOW() "
        "WHERE token=$1 AND accepted_at IS NULL AND expires_at > NOW() "
        "RETURNING invite_id, email",
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail=_INVITE_DEAD)
    audit("auth.invite_declined", request, detail={"invite_id": row["invite_id"]}, severity="warn")
    return {"ok": True}


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

    # ── Org-scoped invite (migration 073) ────────────────────────────────────
    # A platform-console invite has org_id NULL and behaves exactly as before.
    # An org invite has to actually produce the membership, or the invitee ends
    # up with an account belonging to nothing and no way to tell why.
    #
    # Grants are RE-VALIDATED here rather than trusted from the invite row: an
    # invite is good for seven days, and a module can be deactivated in that
    # window. Writing a grant for a module the org no longer has would hand
    # someone access their organisation is not paying for, and it would be
    # invisible — it only surfaces the day the module is switched back on.
    invite_org_id = invite["org_id"] if "org_id" in invite.keys() else None
    if invite_org_id:
        org_role = invite["member_role"] or "org_member"
        if org_role not in ("org_owner", "org_admin", "org_member"):
            org_role = "org_member"

        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT DO NOTHING",
            user_id, str(invite_org_id), org_role, invite["invited_by"],
        )

        raw_grants = invite["module_grants"] if "module_grants" in invite.keys() else None
        try:
            grants = json.loads(raw_grants) if isinstance(raw_grants, str) else (raw_grants or [])
        except (TypeError, ValueError):
            grants = []

        if grants:
            active = {
                r["module_code"]
                for r in await pool.fetch(
                    "SELECT module_code FROM staging.module_subscriptions "
                    "WHERE org_id=$1::uuid AND is_active = TRUE",
                    str(invite_org_id),
                )
            }
            for g in grants:
                code = (g or {}).get("code")
                level = (g or {}).get("role") or "viewer"
                if not code or code not in active:
                    continue
                await pool.execute(
                    "INSERT INTO staging.org_member_modules "
                    "    (user_id, org_id, module_code, role, granted_by) "
                    "VALUES ($1, $2::uuid, $3, $4, $5) "
                    "ON CONFLICT DO NOTHING",
                    user_id, str(invite_org_id), code, level, invite["invited_by"],
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

    token = _create_token(user_id)
    audit("auth.invite_accepted", request, user_id=user_id, detail={"email": invite["email"]})
    return _auth_response(token, {"token": token, "user": _safe_user(dict(user))})


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginBody):
    """Authenticate with email and password and return a JWT and user profile."""
    pool = await get_pool()
    user = await pool.fetchrow("SELECT * FROM users WHERE email=$1", body.email.lower())
    if not user or not _verify_password(body.password, user["salt"], user["password_hash"]):
        audit("auth.login_failed", request, detail={"email": body.email.lower()}, severity="warn")
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
    token = _create_token(user["user_id"])
    audit("auth.login", request, user_id=user["user_id"])
    return _auth_response(token, {"token": token, "user": _safe_user(dict(user), platform_roles, org_roles)})


@router.post("/refresh")
@limiter.limit("30/minute")
async def refresh(request: Request, current_user: dict = Depends(require_user)):
    """Extend a session that is still alive. **It cannot revive a dead one.**

    That limit is the whole design, so it is stated first. `require_user` rejects
    an expired JWT, which means this endpoint only ever sees a token that is
    still valid — it slides the seven-day window forward for someone who is
    using the product, and answers 401 to someone whose window has closed. There
    is no refresh token anywhere in this file and no table to hold one, so a
    sliding window is the honest ceiling; anything more would need a token store,
    which is also what `reset_password` would need to revoke other sessions.

    `AUTH-SPEC.md` and `12-auth-onboarding.md` both assume `/auth/refresh`
    exists. It did not, in any form — so "verify session refresh" had nothing to
    verify, and the frontend had nothing to call before deciding a 401 meant the
    session was over.

    Re-reads the user's roles rather than echoing the request's, because the
    point of a refresh is to pick up what changed. A member promoted to org_admin
    an hour ago gets the new nav on the next refresh instead of on the next
    sign-in.
    """
    pool = await get_pool()
    user_id = current_user["user_id"]
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        user_id,
    )
    # ORDER BY granted_at for the same reason `me` does: `or_rows[0]` has to be
    # the org `middleware/org_resolver.py` falls back to, or the nav is gated
    # against one org while the requests are scoped to another.
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY ur.granted_at",
        user_id,
    )
    platform_roles = [r["role_code"] for r in pr]
    org_roles = [dict(r) for r in or_rows]
    grants = await _module_grants(pool, user_id, platform_roles, org_roles)
    token = _create_token(user_id)
    return _auth_response(
        token,
        {"token": token, "user": _safe_user(current_user, platform_roles, org_roles, grants)},
    )


@router.post("/logout")
async def logout():
    """Clear the session cookie (client also drops localStorage token)."""
    resp = JSONResponse(content={"ok": True})
    resp.delete_cookie(
        key="session_token",
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/",
        domain=_COOKIE_DOMAIN,
    )
    return resp


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
async def reset_password(request: Request, body: ResetPasswordBody):
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
    token = _create_token(user["user_id"])
    audit("auth.password_reset", request, user_id=user["user_id"], severity="warn")
    return _auth_response(token, {"token": token, "user": _safe_user(dict(user))})


@router.get("/me")
async def me(current_user: dict = Depends(require_user)):
    """Return the authenticated user's public profile."""
    pool = await get_pool()
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        current_user["user_id"],
    )
    # ORDER BY granted_at, so `or_rows[0]` is the SAME org
    # `middleware/org_resolver.py` falls back to when no `X-Org-Id` header is
    # sent. Without the ordering the row order is whatever the planner returns,
    # and `_module_grants` below could gate the nav against one org while every
    # request the nav fires is scoped to another.
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY ur.granted_at",
        current_user["user_id"],
    )
    platform_roles = [r["role_code"] for r in pr]
    org_roles = [dict(r) for r in or_rows]
    grants = await _module_grants(pool, current_user["user_id"], platform_roles, org_roles)
    return _safe_user(current_user, platform_roles, org_roles, grants)
