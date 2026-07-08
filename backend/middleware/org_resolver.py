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

    tm = await pool.fetchrow(
        "SELECT team_id FROM team_members WHERE user_id=$1 AND status='active' LIMIT 1",
        user["user_id"],
    )
    if not tm:
        raise HTTPException(403, "You are not a member of any team")

    team_id = tm["team_id"]

    org = await pool.fetchrow(
        "SELECT id FROM staging.organisations WHERE team_id=$1 AND is_active=TRUE",
        team_id,
    )

    if not org:
        raise HTTPException(
            403,
            "No organisation is set up for your team yet. "
            "Contact your administrator.",
        )

    org_id = str(org["id"])
    request.state._org_id = org_id
    return org_id
