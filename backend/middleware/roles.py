"""
roles.py — Multi-role gating middleware.

Supports platform-wide roles (org_id=NULL) and org-scoped roles.
A user can have multiple roles. Platform roles apply everywhere.

Usage:
  Depends(require_role("admin"))              — legacy, checks users.role
  Depends(require_platform_role("platform_admin", "account_manager"))
  Depends(require_org_role("org_admin", "srijan_admin"))
"""
from fastapi import Depends, HTTPException

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id


def require_role(*allowed_roles: str):
    """Legacy: checks users.role field. Keep for backward compat."""

    async def _check(user=Depends(require_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _check


def require_platform_role(*allowed_roles: str):
    """Check staging.user_roles for platform-wide roles (org_id IS NULL)."""

    async def _check(user=Depends(require_user)):
        pool = await get_pool()
        role = await pool.fetchval(
            "SELECT role_code FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
            user["user_id"], list(allowed_roles),
        )
        if not role:
            if user.get("role") == "admin" and "platform_admin" in allowed_roles:
                return user
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _check


def require_org_role(*allowed_roles: str):
    """Check staging.user_roles for org-scoped roles.
    Platform admins always pass."""

    async def _check(user=Depends(require_user), org_id: str = Depends(get_org_id)):
        pool = await get_pool()

        is_platform = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL "
            "AND role_code IN ('platform_admin', 'account_manager')",
            user["user_id"],
        )
        if is_platform or user.get("role") == "admin":
            return user

        role = await pool.fetchval(
            "SELECT role_code FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
            user["user_id"], org_id, list(allowed_roles),
        )
        if not role:
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _check


async def get_user_roles(user_id: str, org_id: str = None) -> list[str]:
    """Get all roles for a user. Returns platform + org-scoped roles."""
    pool = await get_pool()
    if org_id:
        rows = await pool.fetch(
            "SELECT role_code FROM staging.user_roles "
            "WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2::uuid)",
            user_id, org_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT role_code FROM staging.user_roles WHERE user_id=$1",
            user_id,
        )
    return [r["role_code"] for r in rows]
