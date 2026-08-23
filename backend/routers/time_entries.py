"""
time_entries.py — Time tracking: start/stop timer + manual entries
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import active_org_id
from middleware.roles import is_platform_staff, is_portal_client, may_reach_project

router = APIRouter(prefix="/api/time", tags=["time"])


async def _assert_task_access(pool, task_id: str, user: dict):
    """Verify user belongs to the task's team."""
    if await is_platform_staff(user["user_id"]):
        return
    task = await pool.fetchrow("SELECT team_id FROM tasks WHERE task_id=$1", task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if not await may_reach_project(pool, task["team_id"], user["user_id"]):
        raise HTTPException(403, "Not a member of this project")


async def _assert_team_access(pool, team_id: str, user: dict):
    if await is_platform_staff(user["user_id"]):
        return
    if not await may_reach_project(pool, team_id, user["user_id"]):
        raise HTTPException(403, "Not a member of this project")


class TimeEntryCreate(BaseModel):
    task_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    minutes: Optional[int] = None
    description: Optional[str] = None


@router.get("/task/{task_id}")
async def get_task_time(task_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await _assert_task_access(pool, task_id, user)
    rows = await pool.fetch(
        """
        SELECT te.*, COALESCE(u.full_name, u.name) AS user_name
        FROM time_entries te
        LEFT JOIN users u ON u.user_id = te.user_id
        WHERE te.task_id=$1
        ORDER BY te.started_at DESC
        """,
        task_id,
    )
    total = await pool.fetchval(
        "SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE task_id=$1", task_id
    )
    return {"entries": [dict(r) for r in rows], "total_minutes": total}


@router.post("/start")
async def start_timer(task_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    """Start a running timer. Auto-stops any existing running timer first."""
    if await is_portal_client(user):
        raise HTTPException(403, "Clients cannot log time")
    await _assert_task_access(pool, task_id, user)
    await pool.execute(
        """
        UPDATE time_entries
        SET ended_at=NOW(),
            minutes=GREATEST(1, EXTRACT(EPOCH FROM (NOW()-started_at))::int/60)
        WHERE user_id=$1 AND ended_at IS NULL
        """,
        user["user_id"],
    )
    entry_id = f"te_{uuid.uuid4().hex[:12]}"
    await pool.execute(
        "INSERT INTO time_entries (entry_id, task_id, user_id, started_at) VALUES ($1,$2,$3,NOW())",
        entry_id, task_id, user["user_id"],
    )
    try:
        from services.activity_logger import log_event
        await log_event(pool, task_id=task_id, actor_id=user["user_id"],
                        event_type="timer_started", data={"entry_id": entry_id})
    except Exception:
        pass
    return {"entry_id": entry_id, "started_at": datetime.now(timezone.utc)}


@router.post("/stop")
async def stop_timer(pool=Depends(get_pool), user=Depends(require_user)):
    """Stop the currently running timer."""
    row = await pool.fetchrow(
        "SELECT entry_id, task_id, started_at FROM time_entries WHERE user_id=$1 AND ended_at IS NULL",
        user["user_id"],
    )
    if not row:
        raise HTTPException(404, "No running timer")

    mins = max(1, int((datetime.now(timezone.utc) - row["started_at"]).total_seconds() / 60))
    await pool.execute(
        "UPDATE time_entries SET ended_at=NOW(), minutes=$1 WHERE entry_id=$2",
        mins, row["entry_id"],
    )
    try:
        from services.activity_logger import log_event
        await log_event(pool, task_id=row["task_id"], actor_id=user["user_id"],
                        event_type="timer_stopped", data={"entry_id": row["entry_id"], "minutes": mins})
    except Exception:
        pass
    return {"entry_id": row["entry_id"], "task_id": row["task_id"], "minutes": mins}


@router.post("/manual")
async def add_manual_entry(body: TimeEntryCreate, pool=Depends(get_pool), user=Depends(require_user)):
    if await is_portal_client(user):
        raise HTTPException(403, "Clients cannot log time")
    await _assert_task_access(pool, body.task_id, user)
    entry_id = f"te_{uuid.uuid4().hex[:12]}"
    mins = body.minutes
    if mins is None and body.ended_at:
        mins = max(1, int((body.ended_at - body.started_at).total_seconds() / 60))
    await pool.execute(
        """INSERT INTO time_entries
           (entry_id, task_id, user_id, started_at, ended_at, minutes, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
        entry_id, body.task_id, user["user_id"],
        body.started_at, body.ended_at, mins, body.description,
    )
    try:
        from services.activity_logger import log_event
        await log_event(pool, task_id=body.task_id, actor_id=user["user_id"],
                        event_type="time_logged", data={"minutes": mins, "manual": True})
    except Exception:
        pass
    return {"entry_id": entry_id, "minutes": mins}


@router.delete("/{entry_id}")
async def delete_time_entry(entry_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    await pool.execute(
        "DELETE FROM time_entries WHERE entry_id=$1 AND user_id=$2", entry_id, user["user_id"]
    )
    return {"ok": True}


#: How far back `/report` looks when the caller names no dates. Thirty days,
#: and the value is ECHOED IN THE RESPONSE — see the docstring: the whole fault
#: this default replaces was a total with no window at all, printed under a
#: heading that named one.
DEFAULT_REPORT_DAYS = 30

#: The row ceiling. Unchanged at 500, but `truncated` now travels with it: a
#: capped total is a total of the first 500 rows and nothing said so before.
REPORT_ROW_CAP = 500


@router.get("/report")
async def time_report(
    team_id: Optional[str] = None,
    user_id_filter: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org=Depends(active_org_id),
):
    """The time report — scoped to ONE organisation, over a STATED window.

    ── WHAT THIS ROUTE DID, MEASURED LIVE 2026-08-22 ──────────────────────────

    The reported symptom was "the Time Report only shows up for Aekam". That
    turned out to be true of the DATA on the page and false about its cause,
    and neither half of the guess was right:

      · It is not an entitlement gate. `staging.module_subscriptions` carries
        the identical twelve module codes for all three orgs, and there is no
        `time` code anywhere in `org_member_modules`. The sidebar row
        (`frontend/src/components/layout/navConfig.js`, key `timeReport`)
        declares no `module`, no `adminOnly` and no `consoleOnly`, so it is
        visible to every signed-in user in every org and cannot be org-specific.

      · It is not that Aekam has the data. Aekam Inc has the FEWEST entries of
        the three orgs — 5, against Unicode Group's 65 and the seeded E2E org's
        34, out of 108 rows in `public.time_entries` after the 22 August
        cleanup.

    The cause was here. This route had NO ORG SCOPE OF ANY KIND, and two things
    followed from that:

      1. `is_platform_staff` short-circuited every filter, so a platform
         account got all 108 rows of every org's work in one list, with no org
         column to tell them apart. The Aekam accounts are the god-mode
         accounts — so Aekam is precisely the population for whom this page was
         ever full, and what filled it was other people's organisations.
      2. An ordinary member's rows were filtered on `te.user_id` alone. One
         real person holds 9 entries spanning Aekam Inc AND Unicode Group, and
         saw all nine whichever org they had switched to. Everyone else saw
         their own handful — 7 of Unicode's 11 members see zero — which is why
         the page reads as empty everywhere else.

    Three further faults in the same twenty lines, all of them the failure mode
    proposal 70 named on `/reports`: A NUMBER UNDER THE WRONG LABEL.

      3. NO DATE FILTER AT ALL. `total_minutes` was a lifetime total, printed
         by a page whose controls imply a period. There is now a window, it
         defaults to 30 days, and `window` in the response states it.
      4. `LIMIT 500` with the total summed AFTER the cap, so a busy org's
         "total" was the total of its 500 most recent entries and said nothing.
         `truncated` now travels with the payload.
      5. UNQUALIFIED TABLE NAMES — `time_entries`, `tasks`, `users`. Which
         table those resolve to depends on `search_path` under PgBouncer, and
         this repo has already been bitten by a shadow table appearing in
         `staging` beside a `public` original (migration 142). Qualified now.

    ── WHY `active_org_id` AND NOT `get_org_id` ──────────────────────────────

    `get_org_id` RAISES 403 when it cannot name an org, and two populations
    reach the core PM surface with no `staging.user_roles` row: portal clients,
    and members whose only team is one of the teams with `org_id IS NULL`.
    Bolting the raising dependency on would trade a tenancy leak for an outage
    on the timer page. `active_org_id` is the same resolver — same header
    validation, same platform-role and support-session rules, same
    `request.state` cache — returning None instead of raising.

    When it returns None the report falls back to membership scoping alone,
    exactly as before, and SAYS SO: `org_scoped: false` in the response. A
    surface that cannot name its tenant should admit it rather than look
    identical to one that can.
    """
    from datetime import date as _date, timedelta as _timedelta

    is_staff = await is_platform_staff(user["user_id"])

    if team_id and not is_staff:
        await _assert_team_access(pool, team_id, user)

    # ── The window. Parsed here, echoed below, never implied. ──────────────
    try:
        to_d = _date.fromisoformat(to_date) if to_date else _date.today()
        from_d = (_date.fromisoformat(from_date) if from_date
                  else to_d - _timedelta(days=DEFAULT_REPORT_DAYS))
    except ValueError:
        raise HTTPException(400, "Invalid date format — use YYYY-MM-DD")
    if from_d > to_d:
        raise HTTPException(400, "from_date is after to_date")

    filters, vals = ["te.ended_at IS NOT NULL"], []

    # `started_at` is when the work happened, which is the question the page
    # asks. Half-open on the far end via `+ 1 day` so an entry started at
    # 23:50 on the last day of the window is inside it.
    filters.append(f"te.started_at >= ${len(vals)+1}::date")
    vals.append(from_d)
    filters.append(f"te.started_at < (${len(vals)+1}::date + interval '1 day')")
    vals.append(to_d)

    # ── THE ORG FILTER. Applied to STAFF TOO. ─────────────────────────────
    # `time_entries` carries no org column, so the org is reached the only
    # honest way there is: entry -> task -> team -> teams.org_id, joined on the
    # TEXT key `teams.team_id` and never `teams.id` (uuid), which raises
    # `text = uuid`. The same path `report_defs/work_reports.py` uses for
    # `Minutes logged`, so the two surfaces cannot disagree.
    #
    # A staff caller inside an org sees THAT ORG. The console's own
    # cross-org powers are a property of the console prefixes, which
    # `active_org_id` already decides; they are not a licence for a core PM
    # route to hand out three tenants' timesheets in one list.
    if org:
        filters.append(f"tm.org_id = ${len(vals)+1}::uuid")
        vals.append(org)

    if team_id:
        filters.append(f"tk.team_id=${len(vals)+1}")
        vals.append(team_id)
    elif not is_staff:
        # PROJECT membership, one table since migration 195 made
        # `project_assignments` a strict superset of active `team_members`.
        # Canonical note: `middleware/roles.may_reach_project`.
        user_teams = await pool.fetch(
            "SELECT team_id FROM public.project_assignments WHERE user_id=$1",
            user["user_id"],
        )
        team_ids = [r["team_id"] for r in user_teams]
        if not team_ids:
            return {
                "entries": [], "total_minutes": 0, "entry_count": 0,
                "truncated": False,
                "window": {"from": from_d.isoformat(), "to": to_d.isoformat()},
                "org_scoped": bool(org),
                "scope": "no project membership",
            }
        filters.append(f"tk.team_id = ANY(${len(vals)+1}::text[])")
        vals.append(team_ids)

    scope = "org" if org else "membership"
    if not is_staff:
        is_team_admin = False
        if team_id:
            owner = await pool.fetchrow(
                "SELECT 1 FROM public.project_assignments WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin')",
                team_id, user["user_id"]
            )
            is_team_admin = owner is not None
        target_user = user_id_filter if (user_id_filter and is_team_admin) else user["user_id"]
        filters.append(f"te.user_id=${len(vals)+1}")
        vals.append(target_user)
        # Named so the page can say "your own entries" rather than implying it
        # is showing the project. 7 of Unicode Group's 11 members see zero rows
        # here, and "no entries" and "no entries of yours" are different
        # sentences.
        scope = ("this project" if (team_id and is_team_admin and user_id_filter)
                 else "your own entries")

    where = " AND ".join(filters)
    rows = await pool.fetch(f"""
        SELECT te.entry_id, te.task_id, tk.title AS task_title,
               te.started_at, te.ended_at, te.minutes, te.description,
               COALESCE(u.full_name, u.name) AS user_name
        FROM   public.time_entries te
        JOIN   public.tasks tk ON tk.task_id = te.task_id
        JOIN   public.teams tm ON tm.team_id = tk.team_id
        LEFT JOIN public.users u ON u.user_id = te.user_id
        WHERE  {where}
        ORDER  BY te.started_at DESC
        LIMIT  {REPORT_ROW_CAP + 1}
    """, *vals)
    truncated = len(rows) > REPORT_ROW_CAP
    rows = rows[:REPORT_ROW_CAP]
    total = sum(r["minutes"] or 0 for r in rows)
    return {
        "entries": [dict(r) for r in rows],
        "total_minutes": total,
        "entry_count": len(rows),
        # A capped list makes `total_minutes` the total OF THE ROWS RETURNED.
        # It travels with the number so the page can say which it is.
        "truncated": truncated,
        # What this total counts, and over what. Never implied by a control the
        # server never saw.
        "window": {"from": from_d.isoformat(), "to": to_d.isoformat()},
        "org_scoped": bool(org),
        "scope": scope,
    }
