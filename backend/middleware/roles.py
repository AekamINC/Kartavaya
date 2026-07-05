"""
roles.py — Granular role gating beyond require_admin.
Usage: Depends(require_role("admin", "director"))
"""
from fastapi import Depends, HTTPException
from auth_router import require_user


def require_role(*allowed_roles: str):
    """Returns a FastAPI dependency that raises 403 unless user has one of the allowed roles."""

    async def _check(user=Depends(require_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _check
