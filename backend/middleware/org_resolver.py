"""
org_resolver.py — Bridge between production team_id and staging org_id.
Production uses text team_id everywhere; staging modules use UUID org_id.
This middleware resolves the authenticated user's team to an org, auto-creating
the staging.organisations row on first access.
"""
from fastapi import Depends, HTTPException, Request
from db import get_pool
from auth_router import require_user


async def get_org_id(request: Request, user=Depends(require_user)):
    """Resolve the user's primary team_id to a staging.organisations UUID.
    Auto-creates the org bridge row on first access.
    Returns the org_id UUID string."""
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
        "SELECT id FROM staging.organisations WHERE team_id=$1", team_id
    )

    if org:
        org_id = str(org["id"])
    else:
        team = await pool.fetchrow(
            "SELECT team_id, name FROM teams WHERE team_id=$1", team_id
        )
        if not team:
            raise HTTPException(404, "Team not found")
        row = await pool.fetchrow(
            "INSERT INTO staging.organisations (team_id, name) "
            "VALUES ($1, $2) "
            "ON CONFLICT (team_id) DO UPDATE SET name=EXCLUDED.name "
            "RETURNING id",
            team_id, team["name"],
        )
        org_id = str(row["id"])

        default_plan = await pool.fetchval(
            "SELECT id FROM staging.plans WHERE code='free' AND is_active=TRUE"
        )
        if default_plan:
            await pool.execute(
                "INSERT INTO staging.subscriptions (org_id, plan_id, status) "
                "VALUES ($1, $2, 'active') ON CONFLICT (org_id) DO NOTHING",
                row["id"], default_plan,
            )

    request.state._org_id = org_id
    return org_id
