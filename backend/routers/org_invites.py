"""
org_invites.py — an organisation invites its own people.

Before this, it could not. The only invite endpoint was `POST /api/admin/invites`
behind Aekam's platform console, and `org_members.add_member` refuses anyone
without an existing account. With no public registration, every new user at every
customer required Aekam personally. This closes that.

Three things this deliberately does differently from the platform console:

  1. **The token is returned exactly once, to its creator.** `GET /api/admin/invites`
     used to select `i.token` and hand back a ready-made accept link for every
     pending invite on the platform, to anyone in CONSOLE_ROLES — and
     `POST /auth/accept-invite` asks for nothing but that token, then sets whatever
     password the caller supplies. That listing was a page of live credentials.
     The list endpoint here has no field to leak one from.

  2. **A seat is reserved by the invite, not by the acceptance.** Counting only
     accepted members lets an org at its cap send unlimited invites and discover
     the ceiling only when people start bouncing off it. Pending invites count.

  3. **Nobody can invite above themselves.** An org_admin cannot mint an
     org_owner, and cannot grant `approver` on a separated-duty module — that
     would let the person who defines what people are paid create the person who
     releases the money, which is the exact pair the separation exists to keep
     apart.
"""
import os
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth_router import require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    ALL_MODULES,
    APPROVER,
    DEFAULT_GRANT_LEVEL,
    default_level_for,
    ORG_SETTINGS_ROLES,
    SEPARATED_DUTY_MODULES,
    valid_levels_for,
)

router = APIRouter(prefix="/api/v1/org/invites", tags=["org-invites"])

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://kartavaya.com")

#: Roles an org may hand out. `org_owner` is here but gated below — only an
#: existing owner may grant it.
INVITABLE_ROLES: tuple[str, ...] = ("org_owner", "org_admin", "org_member")

#: Mirrors admin_orgs.ORG_MEMBER_ROLES. Anything counted as occupying a seat.
SEAT_ROLES: tuple[str, ...] = ("org_owner", "org_admin", "org_member")

INVITE_TTL_DAYS = 7


class GrantIn(BaseModel):
    code: str
    #: Empty, NOT `DEFAULT_GRANT_LEVEL`. A concrete default here is truthy, so
    #: the `g.role or …` below could never fire and the per-module default was
    #: unreachable — an omitted level would silently become `viewer` even for a
    #: module whose new grants start higher. Resolved at the call site instead,
    #: where the module code is in hand.
    role: str = ""


class InviteCreate(BaseModel):
    email: EmailStr
    org_role: str = Field(default="org_member")
    full_name: Optional[str] = None
    module_grants: List[GrantIn] = Field(default_factory=list)


class OrgInviteOut(BaseModel):
    """No `token` field, and that is the point — see the module docstring."""
    invite_id: str
    email: str
    org_role: str
    full_name: Optional[str] = None
    module_grants: List[GrantIn] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    invited_by: Optional[str] = None


class InviteCreated(OrgInviteOut):
    """Returned only from POST, only to the person who just created it."""
    invite_link: str


async def _caller_org_role(pool, user_id: str, org_id: str) -> Optional[str]:
    return await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[]) "
        "ORDER BY array_position($3::text[], role_code) LIMIT 1",
        user_id, org_id, list(SEAT_ROLES),
    )


async def _assert_may_grant_role(pool, user_id: str, org_id: str, target_role: str) -> None:
    """No one hands out authority they do not hold.

    God mode reaches here with no org row at all — `require_org_role` already let
    them through, and they may grant anything.
    """
    if target_role not in INVITABLE_ROLES:
        raise HTTPException(400, f"Invalid role: {target_role}. Valid: {', '.join(INVITABLE_ROLES)}")

    caller_role = await _caller_org_role(pool, user_id, org_id)
    if caller_role is None:
        return  # platform/god-mode: require_org_role vouched for them

    if target_role == "org_owner" and caller_role != "org_owner":
        raise HTTPException(
            403,
            "Only an organisation owner can invite another owner.",
        )


async def _validate_grants(pool, org_id: str, grants: List[GrantIn],
                           caller_role: Optional[str]) -> list[dict]:
    """Every grant must name a real module the org actually has, at a level that
    module allows — and an admin may not mint an approver on a separated-duty
    module.
    """
    if not grants:
        return []

    active = {
        r["module_code"]
        for r in await pool.fetch(
            "SELECT module_code FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active = TRUE",
            org_id,
        )
    }

    out: list[dict] = []
    for g in grants:
        # Module-aware: Sanvaad starts at editor because a viewer there cannot
        # post, and inviting someone to a chat they cannot speak in is a broken
        # invitation. See role_tiers.NEW_GRANT_LEVEL_BY_MODULE.
        code, level = g.code, (g.role or default_level_for(g.code))

        if code not in ALL_MODULES:
            raise HTTPException(400, f"Unknown module: {code}")
        if code not in active:
            raise HTTPException(
                400,
                f"Your organisation does not have {code} active, so it cannot be granted.",
            )

        allowed = valid_levels_for(code)
        if level not in allowed:
            raise HTTPException(
                400,
                f"{level} is not a valid level for {code}. Valid: {', '.join(allowed)}",
            )

        # An org_admin granting approver on vetana/ganit would be creating the
        # counterparty to their own authority. Only an owner does that.
        if (
            level == APPROVER
            and code in SEPARATED_DUTY_MODULES
            and caller_role is not None
            and caller_role != "org_owner"
        ):
            raise HTTPException(
                403,
                f"Only an organisation owner can grant approver on {code}. "
                "Administering a module and releasing money against it are "
                "deliberately separate.",
            )

        out.append({"code": code, "role": level})

    return out


async def _assert_seat_available(pool, org_id: str, email: str) -> None:
    """Count members AND pending invites against the cap.

    Counting only accepted members would let an org at its ceiling send any
    number of invites and find out only when recipients start failing to join,
    by which time the mail has gone and the promise has been made.

    Resolution is COALESCE(org, plan) per migration 061; NULL on both means
    unlimited and must not collapse to zero.
    """
    limit = await pool.fetchval(
        "SELECT COALESCE(o.max_users, p.max_users) "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id=$1::uuid",
        org_id,
    )
    if limit is None:
        return

    seats_used = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id=$1::uuid AND role_code = ANY($2::text[])",
        org_id, list(SEAT_ROLES),
    ) or 0

    pending = await pool.fetchval(
        "SELECT COUNT(*) FROM invites "
        "WHERE org_id=$1::uuid AND accepted_at IS NULL AND expires_at > NOW() "
        "AND LOWER(email) <> LOWER($2)",
        org_id, email,
    ) or 0

    if seats_used + pending >= limit:
        raise HTTPException(
            409,
            f"This organisation is at its limit of {limit} users "
            f"({seats_used} joined, {pending} invited and not yet accepted). "
            "Remove a member or ask Aekam to raise the allowance.",
        )


@router.post("", response_model=InviteCreated)
async def create_org_invite(
    body: InviteCreate,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    email = body.email.lower()

    await _assert_may_grant_role(pool, user["user_id"], org_id, body.org_role)
    caller_role = await _caller_org_role(pool, user["user_id"], org_id)
    grants = await _validate_grants(pool, org_id, body.module_grants, caller_role)

    existing_user = await pool.fetchrow("SELECT user_id FROM users WHERE LOWER(email)=LOWER($1)", email)
    if existing_user:
        raise HTTPException(
            409,
            "Someone with this email already has an account. Add them from the "
            "Members tab instead of inviting them.",
        )

    await _assert_seat_available(pool, org_id, email)

    # Supersede any pending invite for the same address in THIS org. Scoped by
    # org so one organisation cannot expire another's pending invite by
    # inviting the same person.
    await pool.execute(
        "UPDATE invites SET expires_at = NOW() "
        "WHERE LOWER(email)=LOWER($1) AND org_id=$2::uuid AND accepted_at IS NULL",
        email, org_id,
    )

    token = secrets.token_urlsafe(32)
    invite_id = f"inv_{uuid.uuid4().hex[:12]}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    import json

    await pool.execute(
        """INSERT INTO invites
               (invite_id, email, role, token, invited_by, expires_at,
                full_name, member_role, org_id, module_grants)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10::jsonb)""",
        invite_id, email, "member", token, user["user_id"], expires_at,
        body.full_name or None, body.org_role, org_id, json.dumps(grants),
    )

    org_name = await pool.fetchval("SELECT name FROM staging.organisations WHERE id=$1::uuid", org_id)
    invite_link = f"{FRONTEND_URL}/accept-invite?token={token}"

    try:
        from email_service import send_invite_email
        inviter_name = user.get("full_name") or user.get("name") or user.get("email") or "A colleague"
        send_invite_email(
            email, inviter_name, body.org_role, token,
            workspace_name=org_name or "Kartavaya",
            expires_label=expires_at.strftime("%d %b %Y"),
            recipient_name=body.full_name or "",
            inviter_role=(caller_role or "org_admin").replace("org_", "").capitalize(),
        )
    except Exception as exc:
        # The invite row is already committed and the link is returned below, so
        # a mail failure costs the convenience of delivery, not the invite. The
        # creator can copy the link. Failing the request here would leave a
        # pending invite the caller believes was never made.
        import logging
        logging.getLogger(__name__).warning("org invite email failed: %s", exc)

    return InviteCreated(
        invite_id=invite_id, email=email, org_role=body.org_role,
        full_name=body.full_name, module_grants=[GrantIn(**g) for g in grants],
        created_at=datetime.now(timezone.utc), expires_at=expires_at,
        invited_by=user["user_id"], invite_link=invite_link,
    )


@router.get("", response_model=List[OrgInviteOut])
async def list_org_invites(
    pool=Depends(get_pool),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Pending invites for THIS org. The column list is explicit and excludes
    `token` — see the module docstring for why that is not an oversight."""
    rows = await pool.fetch(
        "SELECT invite_id, email, member_role, full_name, module_grants, "
        "       created_at, expires_at, invited_by "
        "FROM invites "
        "WHERE org_id=$1::uuid AND accepted_at IS NULL AND expires_at > NOW() "
        "ORDER BY created_at DESC",
        org_id,
    )
    import json
    out = []
    for r in rows:
        raw = r["module_grants"]
        grants = json.loads(raw) if isinstance(raw, str) else (raw or [])
        out.append(OrgInviteOut(
            invite_id=r["invite_id"], email=r["email"],
            org_role=r["member_role"] or "org_member",
            full_name=r["full_name"],
            module_grants=[GrantIn(**g) for g in grants],
            created_at=r["created_at"], expires_at=r["expires_at"],
            invited_by=r["invited_by"],
        ))
    return out


@router.delete("/{invite_id}")
async def revoke_org_invite(
    invite_id: str,
    pool=Depends(get_pool),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Revoke by expiring, scoped to the caller's org.

    The org_id predicate is the access control, not a filter: without it any org
    admin could revoke any other organisation's invite by guessing an id.
    """
    row = await pool.fetchrow(
        "UPDATE invites SET expires_at = NOW() "
        "WHERE invite_id=$1 AND org_id=$2::uuid AND accepted_at IS NULL "
        "RETURNING invite_id",
        invite_id, org_id,
    )
    if not row:
        raise HTTPException(404, "No pending invite with that id in this organisation")
    return {"ok": True}
