"""
dashboards.py — User dashboard widget grid
Widgets: count | chart | my_work | deadlines
"""
import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.roles import is_platform_staff

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])


class DashboardCreate(BaseModel):
    name: str
    widgets: list = []


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    widgets: Optional[list] = None


@router.get("/")
async def list_dashboards(pool=Depends(get_pool), user=Depends(require_user)):
    rows = await pool.fetch(
        "SELECT * FROM dashboards WHERE user_id=$1 ORDER BY created_at",
        user["user_id"]
    )
    return [dict(r) for r in rows]


@router.post("/")
async def create_dashboard(body: DashboardCreate, pool=Depends(get_pool), user=Depends(require_user)):
    dash_id = f"dash_{uuid.uuid4().hex[:12]}"
    await pool.execute(
        "INSERT INTO dashboards (dashboard_id, user_id, name, widgets) VALUES ($1,$2,$3,$4)",
        dash_id, user["user_id"], body.name, body.widgets
    )
    return {"dashboard_id": dash_id, **body.dict()}


@router.put("/{dashboard_id}")
async def update_dashboard(dashboard_id: str, body: DashboardUpdate, pool=Depends(get_pool), user=Depends(require_user)):
    updates, vals = [], []
    if body.name is not None:    updates.append(f"name=${len(vals)+2}");    vals.append(body.name)
    if body.widgets is not None: updates.append(f"widgets=${len(vals)+2}"); vals.append(body.widgets)
    if updates:
        await pool.execute(
            f"UPDATE dashboards SET {', '.join(updates)} WHERE dashboard_id=$1 AND user_id=${ len(vals)+2 }",
            dashboard_id, *vals, user["user_id"]
        )
    return {"ok": True}


@router.delete("/{dashboard_id}")
async def delete_dashboard(dashboard_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await pool.execute("DELETE FROM dashboards WHERE dashboard_id=$1 AND user_id=$2", dashboard_id, user["user_id"])
    return {"ok": True}


@router.get("/{dashboard_id}/data")
async def get_dashboard_data(dashboard_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    """Returns pre-computed data for all widgets in one call."""
    dash = await pool.fetchrow(
        "SELECT * FROM dashboards WHERE dashboard_id=$1 AND user_id=$2",
        dashboard_id, user["user_id"]
    )
    if not dash:
        raise HTTPException(404, "Dashboard not found")

    widgets = dash["widgets"] or []

    # Build set of teams the user can access
    _allowed_teams = None
    if not await is_platform_staff(user["user_id"]):
        # PROJECT membership, one table since migration 195 made
        # `project_assignments` a strict superset of active `team_members`.
        # Canonical note: `middleware/roles.may_reach_project`.
        rows = await pool.fetch(
            "SELECT team_id FROM public.project_assignments WHERE user_id=$1",
            user["user_id"],
        )
        _allowed_teams = {r["team_id"] for r in rows}

    async def _fetch_widget(widget: dict):
        wtype = widget.get("type")
        wid   = widget.get("id", wtype)
        cfg   = widget.get("config", {})

        widget_team = cfg.get("team_id")
        if _allowed_teams is not None and widget_team and widget_team not in _allowed_teams:
            return wid, {}

        if wtype == "count":
            count = await pool.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE team_id=$1 AND ($2::text IS NULL OR status=$2)",
                cfg.get("team_id"), cfg.get("status"),
            )
            return wid, {"count": count}

        elif wtype == "my_work":
            tasks = await pool.fetch("""
                SELECT task_id, title, status, priority, due_at
                FROM tasks WHERE $1=ANY(assignee_user_ids) AND status != 'done'
                ORDER BY due_at ASC NULLS LAST LIMIT 10
            """, user["user_id"])
            return wid, {"tasks": [dict(t) for t in tasks]}

        elif wtype == "deadlines":
            # `team_id` is OPTIONAL on this widget, and the guard above only
            # fires when one is present (`and widget_team`). A widget saved
            # without one therefore skipped the membership check and fell into
            # the `$1 IS NULL` branch below, which disables the team filter
            # entirely — returning the fifteen nearest deadlines from EVERY team
            # in EVERY organisation, with task titles and assignee names, to any
            # authenticated user who saved such a widget.
            #
            # The other three widget types are unaffected: `count` and `chart`
            # compare `team_id=$1`, which matches no row when $1 is NULL, and
            # `my_work` is filtered to the caller's own id.
            #
            # With no team chosen the widget's scope is the caller's own teams,
            # never all of them. Platform staff keep the unrestricted view they
            # have everywhere else — for them `_allowed_teams` is None.
            scope_teams = None
            if _allowed_teams is not None and not widget_team:
                if not _allowed_teams:
                    return wid, {"tasks": []}
                scope_teams = list(_allowed_teams)
            tasks = await pool.fetch("""
                SELECT task_id, title, status, priority, due_at,
                       COALESCE(u.full_name, u.name) AS assignee_name
                FROM tasks t
                LEFT JOIN users u ON u.user_id = ANY(t.assignee_user_ids::text[])
                WHERE t.due_at IS NOT NULL AND t.due_at > NOW() AND t.status != 'done'
                  AND ($1::text IS NULL OR t.team_id=$1)
                  AND ($2::text[] IS NULL OR t.team_id = ANY($2::text[]))
                ORDER BY t.due_at ASC LIMIT 15
            """, cfg.get("team_id"), scope_teams)
            return wid, {"tasks": [dict(t) for t in tasks]}

        elif wtype == "chart":
            rows = await pool.fetch(
                "SELECT status, COUNT(*) as count FROM tasks WHERE team_id=$1 GROUP BY status",
                cfg.get("team_id"),
            )
            return wid, {"series": [dict(r) for r in rows]}

        return wid, {}

    results = await asyncio.gather(*[_fetch_widget(w) for w in widgets])
    return dict(results)
