"""reports.py — Kartavaya Reports router.

Endpoints:
  GET  /api/reports/data/{team_id}           — fetch report data (time + tasks)
  GET  /api/reports/download/{team_id}       — stream PDF or Excel on-demand

── `public.report_schedules` IS RETIRED (owner's decision, 2026-08-27) ────────

This router used to carry a second, TEAM-scoped scheduled-report system: a
CRUD at `/schedules/...` and an hourly `POST /dispatch` that walked
`public.report_schedules`. All of it is gone, and the table is being dropped.

WHY, measured live on 2026-08-27:

    public.report_schedules            0 rows   dispatcher complete   CRON ARMED HOURLY
    staging.dristi_scheduled_reports   7 rows   dispatcher complete   never scheduled

An empty table was being swept every hour while seven schedules real people
configured had never dispatched once. Two scheduled-report systems is one more
than this product can keep correct — `services/report_schedule_window.py`
already records that `_next_run` here compared a JavaScript `getDay()` integer
(0 = Sunday) against Python's `weekday()` (0 = Monday), so every weekly
schedule this system ever ran would have fired a day late. That defect was
invisible only because the table was empty.

The surviving system is the per-org one:
`POST /api/v1/dristi/scheduled-reports/dispatch` over
`staging.dristi_scheduled_reports`, due-rule in
`services/report_schedule_window.py`, armed by `DRISTI_REPORT_SWEEP_ARMED`.
Do not rebuild a team-scoped scheduler here. If team-level scheduling is wanted
again it belongs in that table, behind that one dispatcher.

DELETED WITH IT: `ScheduleCreate`, `_next_run`, `_assert_project_owner` (its
only callers were the three schedule endpoints) and `REPORT_DISPATCH_SECRET`,
which now authenticates nothing and should be removed from Railway.
"""
import io
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from auth_router import (
    require_user,
    _decode_token as _auth_decode,  # noqa: F401 — kept for callers/tests
)
from db import get_pool
from services.audit_actors import display_name
from utils import log_safe as _log_safe

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["reports"])


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _assert_project_member(pool, team_id: str, user: dict):
    """Raise 403 unless the user is platform staff or any member of the project."""
    from middleware.roles import is_platform_staff
    if await is_platform_staff(user["user_id"]):
        return
    mem = await pool.fetchrow(
        "SELECT 1 FROM public.project_assignments WHERE team_id=$1 AND user_id=$2",
        team_id, user["user_id"]
    )
    if not mem:
        raise HTTPException(403, "Project membership required")


async def _fetch_report_data(pool, team_id: str, from_date: str, to_date: str) -> dict:
    """Time entries, task counts, the task list, per-member work and throughput.

    ── Every figure here is scoped to the period, or says that it is not ──────

    This function used to answer a different question from the one its own
    report asked. Under a heading reading "12 Aug — 19 Aug" it printed lifetime
    task counts, a throughput chart bucketed on `updated_at` (so a task somebody
    merely edited was drawn as a task closed), and an unfiltered task list. The
    period controls at the top of the page changed the time entries and nothing
    else, which is the worst kind of wrong: the document looked responsive.

    Three rules now hold, and the tests in
    `tests/test_a_report_reports_its_own_period.py` keep them:

      1. Anything counted as WORK DONE is scoped by `completed_at`, never by
         `updated_at`. This is the same basis the analytics registry uses for
         `core.throughput`, so the two surfaces can no longer disagree.
      2. Anything that is a STATE — open, in progress, overdue — is a fact about
         now, not about the period, and is returned under `as_of` so the
         renderer can label it honestly rather than filing it under the dates.
      3. Rows that cannot be placed in time are counted and reported, never
         silently dropped and never quietly folded in. 44 of 379 completed tasks
         on staging predate the `completed_at` column; `done_undated` carries
         them so a total can be reconciled instead of just looking short.

    Tables are schema-qualified throughout. They resolve to `public` under the
    current search_path either way, so this is hardening rather than a live fix —
    but every other module qualifies, and this repo has already been bitten once
    by a shadow table appearing in `staging` beside a `public` original.
    """
    from datetime import date as _date
    from_dt = _date.fromisoformat(from_date)
    to_dt   = _date.fromisoformat(to_date)
    # Time entries.
    #
    # THE NAME LADDER STOPS AT NAMES. This read `COALESCE(u.full_name, u.name,
    # u.email)`, so a member row with neither name printed that person's EMAIL
    # into a report column. That is a CONTACT DETAIL rendered as a LABEL on a
    # screen that only wanted to say who logged the time — and it inverts the
    # standing rule that Aekam must not see a customer's member emails. The
    # owner's ruling (2026-08-23) is that a display-name ladder must never end
    # at an email address.
    #
    # MEASURED BEFORE REMOVING IT, because the obvious objection is "then some
    # rows go blank": on the live database 0 of 35 accounts have neither
    # `full_name` nor `name`. The email rung has never once fired on real data,
    # so this changes nothing anybody can see — it was not a working fallback,
    # it was a loaded gun.
    #
    # `services/audit_actors.display_name()` owns the ladder now; the
    # alternative was nine hand-written COALESCEs that drift apart, and the
    # first one to drift drifts towards the email again. It emits no `$n`, so
    # the parameter numbering below is untouched. The two ladders further down
    # this file keep their OWN terminals (`'Unassigned'`, `'Unattributed'`) —
    # those say more in a report than a generic label, so only the email rung
    # came out of them.
    entries = await pool.fetch(f"""
        SELECT te.entry_id, te.minutes, te.started_at, te.description,
               {display_name("u")} AS user_name,
               t.title AS task_title
        FROM public.time_entries te
        JOIN public.tasks t ON t.task_id = te.task_id AND t.team_id = $1
        LEFT JOIN public.users u ON u.user_id = te.user_id
        WHERE te.started_at >= $2::timestamptz
          AND te.started_at <= ($3::date + interval '1 day')::timestamptz
        ORDER BY te.started_at DESC
    """, team_id, from_dt, to_dt)

    total_mins = sum(e["minutes"] or 0 for e in entries)

    now = datetime.now(timezone.utc)
    counts = await pool.fetchrow("""
        SELECT
          -- States, as of now. These are not period figures and must not be
          -- rendered under the period heading.
          COUNT(*) FILTER (WHERE status='todo')                          AS todo,
          COUNT(*) FILTER (WHERE status='in_progress')                   AS in_progress,
          COUNT(*) FILTER (WHERE status!='done' AND due_at < $2)         AS overdue,
          -- Completed WITHIN the period, on the completion timestamp.
          COUNT(*) FILTER (
              WHERE status='done'
                AND completed_at >= $3::timestamptz
                AND completed_at <= ($4::date + interval '1 day')::timestamptz
          )                                                              AS done,
          -- Completed, but with no completion date recorded, so they cannot be
          -- placed in any period. Reported, not absorbed.
          COUNT(*) FILTER (WHERE status='done' AND completed_at IS NULL)  AS done_undated
        FROM public.tasks WHERE team_id=$1
    """, team_id, now, from_dt, to_dt)
    todo         = counts["todo"]
    in_progress  = counts["in_progress"]
    done         = counts["done"]
    overdue      = counts["overdue"]
    done_undated = counts["done_undated"]

    # The task list: what was finished in the period, plus what is still open.
    # A period report that listed tasks closed two years ago was answering
    # nobody's question; one that hid the open work would be worse.
    try:
        task_list_rows = await pool.fetch("""
            SELECT t.task_id, t.title, t.status, t.priority, t.due_at, t.updated_at,
                   t.completed_at,
                   -- Keeps its own terminal: 'Unassigned' answers the reader's
                   -- question ("nobody owns this") better than a generic
                   -- label would, so only the email rung was removed.
                   COALESCE(u2.full_name, u2.name, 'Unassigned') AS owner_name
            FROM public.tasks t
            LEFT JOIN public.users u2 ON u2.user_id = t.created_by_user_id
            WHERE t.team_id = $1
              AND (
                    t.status <> 'done'
                 OR (t.completed_at >= $2::timestamptz
                     AND t.completed_at <= ($3::date + interval '1 day')::timestamptz)
              )
            ORDER BY CASE t.status
                WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
                t.due_at ASC NULLS LAST
            LIMIT 50
        """, team_id, from_dt, to_dt)
    except Exception:
        task_list_rows = []

    # Daily throughput: tasks CLOSED per calendar day.
    # On `completed_at`, not `updated_at` — retitling a finished task in March
    # used to redraw it as March's work.
    try:
        throughput_rows = await pool.fetch("""
            SELECT DATE(t.completed_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS done_count
            FROM public.tasks t
            WHERE t.team_id = $1 AND t.status = 'done'
              AND t.completed_at >= $2::timestamptz
              AND t.completed_at <= ($3::date + interval '1 day')::timestamptz
            GROUP BY day ORDER BY day
        """, team_id, from_dt, to_dt)
    except Exception:
        throughput_rows = []

    # Per-member work, from who actually completed the task.
    #
    # This counted TIME-ENTRY ROWS per person and called the result "tasks_done".
    # Somebody who logged their week in ten short entries outranked somebody who
    # logged one long session and closed three tasks — and the PDF then crowned
    # the top of that list "champion of the period". `completed_by_user_id` is
    # the column that answers the question actually being asked.
    try:
        member_rows = await pool.fetch("""
            -- Keeps its own terminal ('Unattributed'); email rung only removed.
            -- `GROUP BY 1` is positional, so it follows this expression.
            SELECT COALESCE(u.full_name, u.name, 'Unattributed') AS user_name,
                   COUNT(*) AS tasks_done
            FROM public.tasks t
            LEFT JOIN public.users u ON u.user_id = t.completed_by_user_id
            WHERE t.team_id = $1 AND t.status = 'done'
              AND t.completed_at >= $2::timestamptz
              AND t.completed_at <= ($3::date + interval '1 day')::timestamptz
            GROUP BY 1 ORDER BY tasks_done DESC, user_name
        """, team_id, from_dt, to_dt)
    except Exception:
        member_rows = []
    member_tasks_rows_derived = [
        {"user_name": r["user_name"], "tasks_done": int(r["tasks_done"])}
        for r in member_rows
    ]

    def _serialize(e):
        d = dict(e)
        if d.get("started_at") and hasattr(d["started_at"], "isoformat"):
            d["started_at"] = d["started_at"].isoformat()
        return d

    def _serialize_task(t):
        d = dict(t)
        for fld in ("due_at", "updated_at"):
            if d.get(fld) and hasattr(d[fld], "isoformat"):
                d[fld] = d[fld].isoformat()
        return d

    return {
        "total_minutes":    total_mins,
        "entries":          [_serialize(e) for e in entries],
        "tasks": {
            "todo":        todo or 0,
            "in_progress": in_progress or 0,
            "done":        done or 0,
            "overdue":     overdue or 0,
        },
        # Completed tasks with no completion date, so a reader can reconcile a
        # period total against the lifetime one instead of wondering.
        "done_undated":     done_undated or 0,
        # `todo`, `in_progress` and `overdue` above are states as of this moment,
        # not counts for the period. Named here so a renderer cannot file them
        # under the date range by accident.
        "as_of":            now.isoformat(),
        "state_fields":     ["todo", "in_progress", "overdue"],
        "task_list":        [_serialize_task(t) for t in task_list_rows],
        "by_member_tasks":  member_tasks_rows_derived,
        "daily_throughput": [{"day": str(r["day"]), "done_count": int(r["done_count"])}
                             for r in throughput_rows],
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/data/{team_id}")
async def get_report_data(
    team_id: str,
    from_date: str = Query(..., alias="from"),
    to_date:   str = Query(..., alias="to"),
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Return raw report data (tasks, time entries, throughput) for the given project and date range."""
    if not _DATE_RE.match(from_date) or not _DATE_RE.match(to_date):
        raise HTTPException(400, "Invalid date format — use YYYY-MM-DD")
    await _assert_project_member(pool, team_id, user)
    try:
        return await _fetch_report_data(pool, team_id, from_date, to_date)
    except Exception as exc:
        logger.error("Report data fetch failed for %s: %s", _log_safe(team_id), _log_safe(exc), exc_info=True)
        raise HTTPException(500, "Report data error") from exc


@router.get("/download/{team_id}")
async def download_report(
    team_id:   str,
    from_date: str   = Query(..., alias="from"),
    to_date:   str   = Query(..., alias="to"),
    fmt:       str   = Query("pdf"),           # pdf | excel
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Generate and stream a PDF or Excel report file for a project and date range."""
    if not _DATE_RE.match(from_date) or not _DATE_RE.match(to_date):
        raise HTTPException(400, "Invalid date format — use YYYY-MM-DD")

    await _assert_project_member(pool, team_id, user)

    team = await pool.fetchrow("SELECT name FROM public.teams WHERE team_id=$1", team_id)
    if not team:
        raise HTTPException(404, "Project not found")
    team_name = team["name"]

    data = await _fetch_report_data(pool, team_id, from_date, to_date)

    safe_slug = re.sub(r'[^a-z0-9\-]', '', team_name.lower().replace(' ', '-'))
    try:
        if fmt == "excel":
            from services.report_generator import generate_excel
            content = generate_excel(data, team_name, from_date, to_date)
            filename = f"Kartavaya-{safe_slug}-{from_date}-{to_date}.xlsx"
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            from services.report_generator import generate_pdf
            content = generate_pdf(data, team_name, from_date, to_date)
            filename = f"Kartavaya-{safe_slug}-{from_date}-{to_date}.pdf"
            media_type = "application/pdf"
    except Exception as exc:
        logger.error("Report generation failed for %s fmt=%s: %s", _log_safe(team_id), _log_safe(fmt), _log_safe(exc), exc_info=True)
        raise HTTPException(500, "Report generation failed") from exc

    from urllib.parse import quote
    encoded_filename = quote(filename, safe="")
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )
