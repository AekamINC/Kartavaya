"""
activity.py — Activity feed read endpoints
BUG FIX: removed spaces inside f-string braces for LIMIT/OFFSET params
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import json

from auth_router import require_user
from db import get_pool
from middleware.role_tiers import PLATFORM_ROLE_PRECEDENCE, is_god_mode, modules_for

logger = logging.getLogger(__name__)


async def _platform_reach(pool, user_id: str) -> tuple[bool, bool]:
    """(may_bypass_membership, sees_every_org) for this caller's platform role.

    `is_platform_staff` used to answer the first half of this on its own, but it
    tests membership of ALL_PLATFORM_ROLES — which includes the three
    COMMERCIAL_ONLY_ROLES and `platform_support`. `role_tiers.modules_for()`
    gives every one of those `frozenset()`: they reach no operational module at
    all, and `platform_support` is documented as granting nothing until its
    approval flow exists. An activity feed is a customer's operational record,
    so the set that may cross into one is the set with operational reach — god
    mode, manager and staff — not "holds any platform row".

    Only god mode sees across org boundaries. Manager and staff are defined over
    a customer's modules, which means one customer at a time.
    """
    role = await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[]) "
        "ORDER BY array_position($2::text[], role_code) LIMIT 1",
        user_id, list(PLATFORM_ROLE_PRECEDENCE),
    )
    if not role or not modules_for(role):
        return False, False
    return True, is_god_mode(role)


def _normalize(rows):
    """Deserialize the 'data' JSONB field in each activity row from string to dict."""
    result = []
    for r in rows:
        row = dict(r)
        d = row.get("data")
        if isinstance(d, str):
            try:
                row["data"] = json.loads(d)
            except Exception:
                row["data"] = {}
        result.append(row)
    return result

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("/team/{team_id}")
async def team_activity(
    team_id: str,
    limit: int = Query(50, le=200),
    offset: int = 0,
    actor_id: Optional[str] = None,
    event_type: Optional[str] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Return paginated activity events for a team, with optional actor and type filters."""
    may_bypass, _ = await _platform_reach(pool, user["user_id"])
    if not may_bypass:
        try:
            access = await pool.fetchrow(
                """
                SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'
                LIMIT 1
                """,
                team_id, user["user_id"],
            )
        except Exception as exc:
            logger.error("team_members check failed: %s", exc)
            access = None
        if not access:
            raise HTTPException(403, "Access denied")
    filters, vals = ["ae.team_id=$1"], [team_id]
    if actor_id:   filters.append(f"actor_id=${len(vals)+1}"); vals.append(actor_id)
    if event_type: filters.append(f"type=${len(vals)+1}");     vals.append(event_type)
    where = " AND ".join(filters)
    limit_idx  = len(vals) + 1
    offset_idx = len(vals) + 2
    try:
        rows = await pool.fetch(f"""
            SELECT ae.*,
                   COALESCE(u.full_name, u.name, u.email) AS actor_name,
                   t.title AS task_title
            FROM activity_events ae
            LEFT JOIN users u ON u.user_id = ae.actor_id
            LEFT JOIN tasks t ON t.task_id = ae.task_id
            WHERE {where}
            ORDER BY ae.created_at DESC
            LIMIT ${limit_idx} OFFSET ${offset_idx}
        """, *vals, limit, offset)
        return _normalize(rows)
    except Exception as exc:
        # Gracefully return empty list if table doesn't exist yet (first deploy)
        if "activity_events" in str(exc) and "does not exist" in str(exc):
            logger.warning("activity_events table missing, returning empty: %s", exc)
            return []
        logger.error("Activity fetch failed for %s: %s", team_id, exc, exc_info=True)
        raise HTTPException(500, "Activity fetch error") from exc


@router.get("/feed")
async def feed_activity(
    limit: int = Query(50, le=200),
    offset: int = 0,
    actor_id: Optional[str] = None,
    event_type: Optional[str] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Return paginated activity events across all teams the user belongs to."""
    try:
        may_bypass, sees_every_org = await _platform_reach(pool, user["user_id"])
        if may_bypass:
            org_row = await pool.fetchrow(
                "SELECT org_id FROM staging.user_roles WHERE user_id=$1 AND org_id IS NOT NULL LIMIT 1", user["user_id"])
            if org_row and org_row["org_id"]:
                team_ids = [r["team_id"] for r in await pool.fetch(
                    "SELECT team_id FROM teams WHERE org_id=$1::uuid AND deleted_at IS NULL", org_row["org_id"])]
            elif sees_every_org:
                team_ids = [r["team_id"] for r in await pool.fetch("SELECT team_id FROM teams WHERE deleted_at IS NULL")]
            else:
                # Manager/staff with no org row have no customer context to be
                # in. The old code fell through to EVERY team in EVERY org here,
                # which is the widest read in this file and was reached by the
                # weakest role that gets past the bypass.
                team_ids = []
        else:
            rows = await pool.fetch(
                """
                SELECT team_id FROM team_members WHERE user_id=$1 AND status='active'
                UNION
                SELECT team_id FROM project_assignments WHERE user_id=$1
                """,
                user["user_id"],
            )
            team_ids = [r["team_id"] for r in rows]

        if not team_ids:
            return []

        filters, vals = ["ae.team_id = ANY($1::text[])"], [team_ids]
        if actor_id:   filters.append(f"ae.actor_id=${len(vals)+1}"); vals.append(actor_id)
        if event_type: filters.append(f"ae.type=${len(vals)+1}");     vals.append(event_type)
        where = " AND ".join(filters)
        limit_idx  = len(vals) + 1
        offset_idx = len(vals) + 2
        rows = await pool.fetch(f"""
            SELECT ae.*,
                   COALESCE(u.full_name, u.name, u.email) AS actor_name,
                   t.title AS task_title,
                   tm.name AS team_name
            FROM activity_events ae
            LEFT JOIN users u ON u.user_id = ae.actor_id
            LEFT JOIN tasks t ON t.task_id = ae.task_id
            LEFT JOIN teams tm ON tm.team_id = ae.team_id
            WHERE {where}
            ORDER BY ae.created_at DESC
            LIMIT ${limit_idx} OFFSET ${offset_idx}
        """, *vals, limit, offset)
        return _normalize(rows)
    except Exception as exc:
        logger.error("Feed activity fetch failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Activity fetch error") from exc


@router.get("/task/{task_id}")
async def task_activity(
    task_id: str,
    limit: int = Query(100, le=500),
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Return all activity events for a specific task, newest first."""
    # Enforce task visibility: caller must belong to the task's project
    may_bypass, _ = await _platform_reach(pool, user["user_id"])
    if not may_bypass:
        task_team = await pool.fetchrow(
            "SELECT team_id FROM tasks WHERE task_id=$1", task_id
        )
        if not task_team:
            raise HTTPException(404, "Task not found")
        access = await pool.fetchrow(
            """
            SELECT 1 FROM team_members        WHERE team_id=$1 AND user_id=$2 AND status='active'
            UNION ALL
            SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2
            LIMIT 1
            """,
            task_team["team_id"], user["user_id"],
        )
        if not access:
            raise HTTPException(403, "Access denied")
    rows = await pool.fetch("""
        SELECT ae.*,
               COALESCE(u.full_name, u.name, u.email) AS actor_name
        FROM activity_events ae
        LEFT JOIN users u ON u.user_id = ae.actor_id
        WHERE ae.task_id=$1
        ORDER BY ae.created_at DESC
        LIMIT $2
    """, task_id, limit)
    return _normalize(rows)
