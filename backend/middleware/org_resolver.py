"""
org_resolver.py — Bridge between production team_id and staging org_id.
Production uses text team_id everywhere; staging modules use UUID org_id.
Orgs must be created by a platform admin — no auto-creation.
"""
from fastapi import Depends, HTTPException, Request
from db import get_pool
from auth_router import require_user


async def get_org_id(request: Request, user=Depends(require_user)):
    """Resolve the user's primary team_id to a staging.organisations UUID.
    Returns 403 if no org exists — admin must create it first."""
    cached = getattr(request.state, "_org_id", None)
    if cached is not None:
        return cached

    pool = await get_pool()

    # Prefer org from X-Org-Id header (org switcher)
    header_org = request.headers.get("x-org-id")
    if header_org:
        # Validate user belongs to this org
        is_member = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid "
            "AND role_code IN ('org_owner','org_admin','org_member')",
            user["user_id"], header_org,
        )
        # Platform staff can access any org
        if not is_member:
            is_platform = await pool.fetchval(
                "SELECT 1 FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code IN ('platform_admin','account_manager')",
                user["user_id"],
            )
            if not is_platform and user.get("role") != "admin":
                raise HTTPException(403, "You do not belong to this organisation")
        org = await pool.fetchrow(
            "SELECT id FROM staging.organisations WHERE id=$1::uuid AND is_active=TRUE",
            header_org,
        )
        if not org:
            raise HTTPException(404, "Organisation not found or inactive")
        org_id = str(org["id"])
        request.state._org_id = org_id
        return org_id

    # Fallback: resolve from user_roles (org-scoped roles)
    org_role = await pool.fetchrow(
        "SELECT org_id FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL "
        "AND role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY granted_at LIMIT 1",
        user["user_id"],
    )
    if org_role:
        org = await pool.fetchrow(
            "SELECT id FROM staging.organisations WHERE id=$1 AND is_active=TRUE",
            org_role["org_id"],
        )
        if org:
            org_id = str(org["id"])
            request.state._org_id = org_id
            return org_id

    # Legacy fallback: team_members → teams.org_id (excludes clients)
    tm = await pool.fetchrow(
        "SELECT t.org_id FROM team_members tm "
        "JOIN teams t ON t.team_id = tm.team_id "
        "WHERE tm.user_id=$1 AND tm.status='active' AND tm.role <> 'client' "
        "AND t.org_id IS NOT NULL "
        "ORDER BY tm.created_at LIMIT 1",
        user["user_id"],
    )
    if not tm or not tm["org_id"]:
        raise HTTPException(403, "You are not a member of any organisation")

    resolved_org = await pool.fetchval(
        "SELECT id FROM staging.organisations WHERE id=$1 AND is_active=TRUE",
        tm["org_id"],
    )
    if not resolved_org:
        raise HTTPException(
            403,
            "No organisation is set up for your team yet. "
            "Contact your administrator.",
        )

    org_id = str(resolved_org)
    request.state._org_id = org_id
    return org_id
