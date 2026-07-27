"""
org_members.py — Org-level member management (self-service).
Org admins/owners manage their own members. No platform admin needed.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    ALL_MODULES, SENSITIVE_MODULES, DEFAULT_GRANT_LEVEL, default_level_for,
    valid_levels_for,
)

router = APIRouter(prefix="/api/v1/org/members", tags=["org-members"])

# ALL_MODULES and SENSITIVE_MODULES now come from role_tiers rather than being
# retyped here. The local list held EIGHT codes where role_tiers holds twelve, so
# a grant naming esign, samvada, varta or pahchan was rejected with 400 by the
# only endpoint that can create one — four modules unreachable through the UI
# that exists to reach them.


def _normalise_grant(g) -> tuple[str, str]:
    """
    Accept a bare "ganit" or a {"code": "ganit", "role": "editor"} and return
    (module_code, level).

    Both shapes are accepted because the bare-string form is what every existing
    caller sends. Rejecting it would break the member editor the moment this
    deploys, and a level-aware API that no client can call is not an improvement.
    """
    if isinstance(g, str):
        # `default_level_for`, not the flat default: Sanvaad starts at editor,
        # because a viewer in a messaging module cannot post and an invitation
        # to a chat you cannot speak in is a broken one. Every other module is
        # unchanged at viewer. See role_tiers.NEW_GRANT_LEVEL_BY_MODULE.
        return g, default_level_for(g)
    if isinstance(g, dict):
        code = g.get("code") or g.get("module_code")
        level = g.get("role") or g.get("level") or (default_level_for(code) if code else DEFAULT_GRANT_LEVEL)
        if code:
            return code, level
    raise HTTPException(400, f"Malformed module grant: {g!r}")


def _validate_grant(code: str, level: str) -> None:
    """Reject an unknown module, and a level that module has no use for."""
    if code not in ALL_MODULES:
        raise HTTPException(400, f"Unknown module: {code}")
    allowed = valid_levels_for(code)
    if level not in allowed:
        raise HTTPException(
            400,
            f"'{level}' is not a level {code} has. Valid: {', '.join(allowed)}.",
        )


class AddMemberBody(BaseModel):
    email: EmailStr
    role: str = "org_member"
    # list[str] | list[{code, role}] — see _normalise_grant.
    module_grants: list = []
    mobile_number: str = ""


class UpdateModulesBody(BaseModel):
    # Same two shapes as module_grants.
    modules: list


@router.get("")
async def list_members(
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """List all members of the caller's org."""
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT ur.user_id, ur.role_code, ur.granted_at,
               u.email, COALESCE(u.full_name, u.name) AS full_name,
               u.avatar AS avatar_url, u.mobile_number
        FROM staging.user_roles ur
        JOIN users u ON u.user_id = ur.user_id
        WHERE ur.org_id = $1::uuid
          AND ur.role_code IN ('org_owner','org_admin','org_member')
        ORDER BY ur.granted_at
    """, org_id)

    members = []
    for r in rows:
        mods = await pool.fetch(
            "SELECT module_code, role FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid",
            r["user_id"], org_id,
        )
        members.append({
            **dict(r),
            # `modules` keeps the bare-code shape every existing caller reads.
            # `module_grants` carries the level alongside it. Returning only the
            # new shape would blank the module column in any client that has not
            # been redeployed yet; returning only the old one is what hid the
            # level from the UI in the first place.
            "modules": [m["module_code"] for m in mods],
            "module_grants": [
                {"code": m["module_code"], "role": m["role"]} for m in mods
            ],
        })
    return members


@router.post("")
async def add_member(
    body: AddMemberBody,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Add an existing user to this org. The user must already have an account."""
    pool = await get_pool()

    valid_roles = {"org_admin", "org_member"}
    if body.role not in valid_roles:
        raise HTTPException(400, f"Invalid role: {body.role}. Valid: {', '.join(valid_roles)}")

    target = await pool.fetchrow(
        "SELECT user_id, email FROM users WHERE LOWER(email)=LOWER($1)",
        body.email,
    )
    if not target:
        raise HTTPException(
            404,
            f"No account found for '{body.email}'. "
            "The user must sign up first, then you can add them.",
        )

    if body.mobile_number:
        await pool.execute(
            "UPDATE users SET mobile_number=$1 WHERE user_id=$2",
            body.mobile_number.strip(), target["user_id"],
        )

    existing = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code IN ('org_owner','org_admin','org_member')",
        target["user_id"], org_id,
    )
    if existing:
        raise HTTPException(409, f"{body.email} is already a member of this organisation")

    # Seat limit. max_users was previously READ in two places and enforced in
    # none — /v1/subscription/usage returned it and BillingPage displayed it,
    # but nothing stopped an org adding members past it. A limit that is
    # displayed and not applied is worse than no limit: it tells the customer
    # they are capped at 5 while letting them add 50, and the discrepancy
    # surfaces at billing.
    #
    # COALESCE order matters — the org's own seat count wins over the tier
    # default. NULL on both means unlimited, which is correct for the tiers
    # that are not sold per user; it must not collapse to 0.
    limit = await pool.fetchval(
        "SELECT COALESCE(o.max_users, p.max_users) "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id=$1::uuid",
        org_id,
    )
    if limit is not None:
        seats_used = await pool.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
            "WHERE org_id=$1::uuid "
            "AND role_code IN ('org_owner','org_admin','org_member')",
            org_id,
        ) or 0
        if seats_used >= limit:
            raise HTTPException(
                403,
                f"This organisation is using all {limit} of its seats. "
                "Remove a member, or ask your account manager to add seats.",
            )

    await pool.execute(
        "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
        "VALUES ($1, $2::uuid, $3, $4) "
        "ON CONFLICT (user_id, org_id, role_code) DO NOTHING",
        target["user_id"], org_id, body.role, user["user_id"],
    )

    org = await pool.fetchrow(
        "SELECT team_id FROM staging.organisations WHERE id=$1::uuid", org_id,
    )
    if org and org["team_id"]:
        await pool.execute(
            "INSERT INTO team_members (member_id, team_id, email, user_id, role, status) "
            "VALUES ($1, $2, $3, $4, 'member', 'active') "
            "ON CONFLICT DO NOTHING",
            f"mem_{uuid.uuid4().hex[:12]}", org["team_id"],
            target["email"], target["user_id"],
        )

    if body.module_grants:
        # An explicit list is validated and REJECTED on error rather than
        # filtered. The old `if m in ALL_MODULES` silently dropped anything it
        # did not recognise, so adding a member with a typo'd or newer module
        # reported success while granting less than was asked for.
        grants = [_normalise_grant(g) for g in body.module_grants]
        for code, level in grants:
            _validate_grant(code, level)
    elif body.role == "org_admin":
        grants = []
    else:
        enabled = await pool.fetch(
            "SELECT module_code FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
        # Defaults are deliberately the weakest level, and skip the sensitive
        # modules entirely. Payroll, personnel files and the books are granted
        # on purpose or not at all — never by omission.
        grants = [
            (r["module_code"], default_level_for(r["module_code"]))
            for r in enabled
            if r["module_code"] not in SENSITIVE_MODULES
            and r["module_code"] in ALL_MODULES
            and default_level_for(r["module_code"]) in valid_levels_for(r["module_code"])
        ]

    for code, level in grants:
        await pool.execute(
            "INSERT INTO staging.org_member_modules "
            "(user_id, org_id, module_code, role, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4, $5) "
            "ON CONFLICT (user_id, org_id, module_code) DO NOTHING",
            target["user_id"], org_id, code, level, user["user_id"],
        )

    return {
        "status": "added",
        "email": body.email,
        "role": body.role,
        "modules": [c for c, _ in grants],
        "module_grants": [{"code": c, "role": r} for c, r in grants],
    }


@router.delete("/{target_user_id}")
async def remove_member(
    target_user_id: str,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Remove a member from this org. Cannot remove yourself or an owner."""
    if target_user_id == user["user_id"]:
        raise HTTPException(400, "You cannot remove yourself")

    pool = await get_pool()

    is_owner = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code='org_owner'",
        target_user_id, org_id,
    )
    if is_owner:
        raise HTTPException(403, "Cannot remove an org owner")

    await pool.execute(
        "DELETE FROM staging.user_roles WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    await pool.execute(
        "DELETE FROM staging.org_member_modules WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )

    org = await pool.fetchrow(
        "SELECT team_id FROM staging.organisations WHERE id=$1::uuid", org_id,
    )
    if org and org["team_id"]:
        await pool.execute(
            "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
            org["team_id"], target_user_id,
        )

    return {"status": "removed"}


@router.put("/{target_user_id}/role")
async def update_member_role(
    target_user_id: str,
    role: str = Query(...),
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Change a member's org role (org_admin / org_member)."""
    valid = {"org_admin", "org_member"}
    if role not in valid:
        raise HTTPException(400, f"Invalid role. Valid: {', '.join(valid)}")
    if target_user_id == user["user_id"]:
        raise HTTPException(400, "You cannot change your own role")

    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.user_roles SET role_code=$1 "
        "WHERE user_id=$2 AND org_id=$3::uuid "
        "AND role_code IN ('org_admin','org_member')",
        role, target_user_id, org_id,
    )
    return {"status": "updated", "role": role}


@router.put("/{target_user_id}/modules")
async def set_member_modules(
    target_user_id: str,
    body: UpdateModulesBody,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Replace a member's module grants."""
    pool = await get_pool()

    # Validate the WHOLE list before deleting anything. This used to validate in
    # one loop and write in another, with the DELETE between them — so a request
    # whose last entry was a bad module code passed the first loop for every
    # earlier entry, wiped the member's grants, and only then raised. The member
    # ended up with nothing.
    grants = [_normalise_grant(g) for g in body.modules]
    for code, level in grants:
        _validate_grant(code, level)

    # THE DEFECT THIS ENDPOINT EXISTED WITH: the INSERT never named `role`, so
    # every re-INSERT landed on the column default. Saving a member's modules to
    # change one checkbox silently demoted every other grant they held to viewer,
    # and nothing in the response said so.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM staging.org_member_modules "
                "WHERE user_id=$1 AND org_id=$2::uuid",
                target_user_id, org_id,
            )
            for code, level in grants:
                await conn.execute(
                    "INSERT INTO staging.org_member_modules "
                    "(user_id, org_id, module_code, role, granted_by) "
                    "VALUES ($1, $2::uuid, $3, $4, $5)",
                    target_user_id, org_id, code, level, user["user_id"],
                )

    return {
        "status": "updated",
        "modules": [c for c, _ in grants],
        "module_grants": [{"code": c, "role": r} for c, r in grants],
    }


@router.get("/search")
async def search_user(
    email: str = Query(...),
    user=Depends(require_org_role("org_admin", "org_owner")),
):
    """Search for a user by email (for add-member flow)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT user_id, email, COALESCE(full_name, name) AS full_name, avatar AS avatar_url "
        "FROM users WHERE LOWER(email)=LOWER($1)",
        email,
    )
    if not row:
        raise HTTPException(404, "No account found with that email")
    return dict(row)
