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

router = APIRouter(prefix="/api/v1/org/members", tags=["org-members"])

ALL_MODULES = [
    "graha", "ganit", "manav", "vikray", "vetana",
    "dristi", "prachar", "srijan",
]
SENSITIVE = {"vetana", "ganit", "manav"}


class AddMemberBody(BaseModel):
    email: EmailStr
    role: str = "org_member"
    module_grants: list[str] = []


class UpdateModulesBody(BaseModel):
    modules: list[str]


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
               u.avatar_url
        FROM staging.user_roles ur
        JOIN users u ON u.user_id = ur.user_id
        WHERE ur.org_id = $1::uuid
          AND ur.role_code IN ('org_owner','org_admin','org_member')
        ORDER BY ur.granted_at
    """, org_id)

    members = []
    for r in rows:
        mods = await pool.fetch(
            "SELECT module_code FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid",
            r["user_id"], org_id,
        )
        members.append({
            **dict(r),
            "modules": [m["module_code"] for m in mods],
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

    existing = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code IN ('org_owner','org_admin','org_member')",
        target["user_id"], org_id,
    )
    if existing:
        raise HTTPException(409, f"{body.email} is already a member of this organisation")

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
        grant_codes = [m for m in body.module_grants if m in ALL_MODULES]
    elif body.role == "org_admin":
        grant_codes = []
    else:
        enabled = await pool.fetch(
            "SELECT module_code FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
        grant_codes = [r["module_code"] for r in enabled if r["module_code"] not in SENSITIVE]

    for mc in grant_codes:
        await pool.execute(
            "INSERT INTO staging.org_member_modules (user_id, org_id, module_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT (user_id, org_id, module_code) DO NOTHING",
            target["user_id"], org_id, mc, user["user_id"],
        )

    return {
        "status": "added",
        "email": body.email,
        "role": body.role,
        "modules": grant_codes,
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
    for mc in body.modules:
        if mc not in ALL_MODULES:
            raise HTTPException(400, f"Unknown module: {mc}")

    await pool.execute(
        "DELETE FROM staging.org_member_modules WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    for mc in body.modules:
        await pool.execute(
            "INSERT INTO staging.org_member_modules (user_id, org_id, module_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4)",
            target_user_id, org_id, mc, user["user_id"],
        )

    return {"status": "updated", "modules": body.modules}


@router.get("/search")
async def search_user(
    email: str = Query(...),
    user=Depends(require_org_role("org_admin", "org_owner")),
):
    """Search for a user by email (for add-member flow)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT user_id, email, COALESCE(full_name, name) AS full_name, avatar_url "
        "FROM users WHERE LOWER(email)=LOWER($1)",
        email,
    )
    if not row:
        raise HTTPException(404, "No account found with that email")
    return dict(row)
