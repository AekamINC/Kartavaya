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
from middleware.org_resolver import active_org_id
from middleware.role_tiers import PLATFORM_ROLE_PRECEDENCE, is_god_mode, modules_for
from middleware.roles import may_reach_project

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
    org=Depends(active_org_id),
):
    """Return paginated activity events for the teams the user sees IN THE ACTIVE ORG.

    ── THIS ROUTE HELD AN UNFIXED TWIN OF BOTH ROOT DEFECTS ───────────────────

    `server.get_visible_team_ids` was given an `org_id` and `middleware.roles.
    admin_org_id` was made deterministic, and this file kept its own copy of
    each — while feeding `ActivityFeedPage.jsx:75` AND the Today dashboard
    (`DashboardPage.jsx:140`, `{limit: 6}`). A fixed function with an unfixed
    twin is the failure mode, so the replacement is a CALL and not a fourth
    restatement of the predicate:

      (a) `SELECT org_id FROM staging.user_roles WHERE user_id=$1 AND org_id IS
          NOT NULL LIMIT 1` — no ORDER BY, no org argument, over a set with
          three rows for the owner. The org came from the query planner.

      (b) `SELECT team_id FROM team_members WHERE user_id=$1 … UNION SELECT
          team_id FROM project_assignments WHERE user_id=$1` — constrained by
          USER ONLY, so a member of two orgs got both orgs' events.

      (c) the `sees_every_org` branch read EVERY team in EVERY organisation.
          `middleware/subscription.py:333` quotes the spec as "no one should be
          able to see any other org data even god mode users", so god mode is
          not an exception and the branch is gone. A platform account keeps
          everything its own membership in the ACTIVE org gives it, which for
          the vendor's staff — members of Aekam Inc — is Aekam Inc.

    `get_visible_team_ids` already weighs the platform role (it calls
    `is_org_admin(user_id, org)`, which is the function that decides whether a
    platform row plus membership means "all of this org's teams"). So
    `_platform_reach` is no longer consulted here: it answered a question the
    helper now answers better, and keeping both would put the two back out of
    step. It is still used by `task_activity` below.

    `org` is None only for the populations `server.active_org_id` names —
    portal clients and staff whose only team carries no `org_id`. The helper's
    own fall-through handles them: membership only, never a union across orgs.
    """
    try:
        # Deferred: `server` imports this router, so this cannot be a top-level
        # import. Same pattern and same reason as `routers/search.py:276`.
        from server import get_visible_team_ids

        team_ids = await get_visible_team_ids(
            pool, user["user_id"], _user_dict=user, org_id=org)

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
    org=Depends(active_org_id),
):
    """Return all activity events for a specific task, newest first.

    The platform bypass below is scoped to the ACTIVE org for the same reason
    `server.get_task`'s admin hatch is: `_platform_reach` answers "may this
    caller skip the membership check", and skipping it used to mean skipping
    every predicate — any task in any organisation, by id. Narrowing WHO may
    bypass without narrowing WHAT they reach leaves the boundary open.
    """
    # Enforce task visibility: caller must belong to the task's project
    may_bypass, _ = await _platform_reach(pool, user["user_id"])
    task_team = await pool.fetchrow(
        "SELECT team_id, user_id, created_by_user_id FROM tasks WHERE task_id=$1", task_id
    )
    if not task_team:
        raise HTTPException(404, "Task not found")
    if may_bypass:
        from server import task_is_in_org  # deferred: server imports this router
        may_bypass = await task_is_in_org(
            pool, org, team_id=task_team["team_id"],
            owner_ids=(task_team["user_id"], task_team["created_by_user_id"]))
    if not may_bypass:
        if not await may_reach_project(pool, task_team["team_id"], user["user_id"]):
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
