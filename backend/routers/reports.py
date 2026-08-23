"""reports.py — Kartavaya Reports router.

Endpoints:
  GET  /api/reports/data/{team_id}           — fetch report data (time + tasks)
  GET  /api/reports/download/{team_id}       — stream PDF or Excel on-demand
  GET  /api/reports/schedules/{team_id}      — list schedules for a project
  POST /api/reports/schedules/{team_id}      — create schedule
  DELETE /api/reports/schedules/{schedule_id} — delete schedule
  POST /api/reports/dispatch                 — cron endpoint (Railway cron calls this hourly)
"""
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator, EmailStr
from typing import Optional as _Optional

from auth_router import (
    require_user,
    _decode_token as _auth_decode,  # noqa: F401 — kept for callers/tests
    resolve_token_user_id as _auth_resolve,
)
from db import get_pool
from services.audit_actors import display_name
from utils import log_safe as _log_safe

_dispatch_bearer = HTTPBearer(auto_error=False)

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["reports"])

DISPATCH_SECRET = os.environ.get("REPORT_DISPATCH_SECRET", "")
if not DISPATCH_SECRET:
    logger.warning(
        "REPORT_DISPATCH_SECRET is not set — dispatch endpoint is protected by admin auth only. "
        "Set this env var in production to add a second layer of protection."
    )
elif len(DISPATCH_SECRET) < 32:
    logger.warning(
        "REPORT_DISPATCH_SECRET is too short (%d chars) — use a random secret of at least 32 "
        "characters in production (e.g. openssl rand -hex 32).",
        len(DISPATCH_SECRET),
    )


# ── Models ─────────────────────────────────────────────────────────────────────

_VALID_FREQUENCIES   = {"daily", "weekly", "monthly"}
_VALID_FILE_FORMATS  = {"pdf", "excel"}


class ScheduleCreate(BaseModel):
    frequency:     str           # daily | weekly | monthly
    file_formats:  List[str]     # ["pdf"] | ["excel"] | ["pdf","excel"]
    recipients:    List[EmailStr]  # validated email addresses
    day_of_week:   Optional[int] = None   # 0–6 (weekly)
    day_of_month:  Optional[int] = None   # 1–28 (monthly)
    send_hour_utc: int = 2

    @field_validator("frequency")
    @classmethod
    def validate_frequency(cls, v: str) -> str:
        if v not in _VALID_FREQUENCIES:
            raise ValueError(f"frequency must be one of {sorted(_VALID_FREQUENCIES)}")
        return v

    @field_validator("file_formats")
    @classmethod
    def validate_file_formats(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("file_formats must not be empty")
        for fmt in v:
            if fmt not in _VALID_FILE_FORMATS:
                raise ValueError(f"file format '{fmt}' must be one of {sorted(_VALID_FILE_FORMATS)}")
        return v

    @field_validator("recipients")
    @classmethod
    def validate_recipients(cls, v: list) -> list:
        if not v:
            raise ValueError("recipients must not be empty")
        return v

    @field_validator("send_hour_utc")
    @classmethod
    def validate_send_hour(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("send_hour_utc must be between 0 and 23")
        return v

    @field_validator("day_of_week")
    @classmethod
    def validate_day_of_week(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not 0 <= v <= 6:
            raise ValueError("day_of_week must be between 0 and 6")
        return v

    @field_validator("day_of_month")
    @classmethod
    def validate_day_of_month(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not 1 <= v <= 28:
            raise ValueError("day_of_month must be between 1 and 28")
        return v


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _assert_project_owner(pool, team_id: str, user: dict):
    """Raise 403 unless the user is platform staff or project owner/admin."""
    from middleware.roles import is_platform_staff
    if await is_platform_staff(user["user_id"]):
        return
    mem = await pool.fetchrow(
        "SELECT role FROM public.project_assignments WHERE team_id=$1 AND user_id=$2",
        team_id, user["user_id"]
    )
    if not mem or mem["role"] not in ("owner", "admin"):
        raise HTTPException(403, "Owner or admin required")


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


def _next_run(frequency: str, day_of_week: int, day_of_month: int, send_hour_utc: int) -> datetime:
    """Calculate the next UTC run time for a report schedule given its frequency settings."""
    now = datetime.now(timezone.utc)
    base = now.replace(minute=0, second=0, microsecond=0)

    if frequency == "daily":
        candidate = base.replace(hour=send_hour_utc)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    if frequency == "weekly":
        dow = day_of_week if day_of_week is not None else 1  # Monday default
        days_ahead = (dow - now.weekday()) % 7
        if days_ahead == 0 and now.hour >= send_hour_utc:
            days_ahead = 7
        candidate = (base + timedelta(days=days_ahead)).replace(hour=send_hour_utc)
        return candidate

    # monthly
    dom = day_of_month if day_of_month else 1
    candidate = base.replace(day=min(dom, 28), hour=send_hour_utc)
    if candidate <= now:
        # advance one month
        if candidate.month == 12:
            candidate = candidate.replace(year=candidate.year + 1, month=1)
        else:
            candidate = candidate.replace(month=candidate.month + 1)
    return candidate


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


@router.get("/schedules/{team_id}")
async def list_schedules(
    team_id: str,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Return all report schedules for the given project."""
    await _assert_project_owner(pool, team_id, user)
    rows = await pool.fetch(
        "SELECT * FROM public.report_schedules WHERE team_id=$1 ORDER BY created_at DESC",
        team_id,
    )
    return [dict(r) for r in rows]


@router.post("/schedules/{team_id}")
async def create_schedule(
    team_id: str,
    payload: ScheduleCreate,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Create a new report schedule for a project."""
    await _assert_project_owner(pool, team_id, user)

    # Validation is now handled by ScheduleCreate field validators; no manual checks needed.

    next_run = _next_run(
        payload.frequency, payload.day_of_week,
        payload.day_of_month, payload.send_hour_utc
    )
    schedule_id = f"sched_{uuid.uuid4().hex[:12]}"
    _org = await pool.fetchval(
        "SELECT org_id::text FROM public.teams WHERE team_id=$1", team_id)
    row = await pool.fetchrow("""
        INSERT INTO public.report_schedules
          (schedule_id, team_id, created_by, frequency, file_formats, recipients,
           day_of_week, day_of_month, send_hour_utc, next_run_at, org_id)
        VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9,$10,$11::uuid)
        RETURNING *
    """,
        schedule_id, team_id, user["user_id"],
        payload.frequency, payload.file_formats, payload.recipients,
        payload.day_of_week, payload.day_of_month, payload.send_hour_utc, next_run, _org,
    )
    return dict(row)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Delete a report schedule by ID."""
    row = await pool.fetchrow(
        "SELECT team_id FROM public.report_schedules WHERE schedule_id=$1", schedule_id
    )
    if not row:
        raise HTTPException(404)
    await _assert_project_owner(pool, row["team_id"], user)
    await pool.execute("DELETE FROM public.report_schedules WHERE schedule_id=$1", schedule_id)
    return {"ok": True}


@router.post("/dispatch")
async def dispatch_reports(
    request: Request,
    request_secret: str = Query(""),
    x_dispatch_secret: str = Header(""),
    pool = Depends(get_pool),
    credentials: _Optional[HTTPAuthorizationCredentials] = Depends(_dispatch_bearer),
):
    """Called hourly by Railway cron. Accepts REPORT_DISPATCH_SECRET OR an admin JWT.

    Cron callers (no session): send the secret in the `X-Dispatch-Secret` HEADER.
    Manual callers (browser/admin): supply a valid admin Bearer token.

    `?request_secret=` still works so an already-configured cron keeps running,
    but it is deprecated: a secret in a query string is written to every access
    log, proxy log and platform request log the request passes through, and
    those outlive and out-scope the secret itself.
    """
    from utils import secret_matches

    authorized = False
    # Constant-time, header preferred. `==` leaked how many leading bytes of the
    # secret were correct via response timing.
    if (secret_matches(x_dispatch_secret, DISPATCH_SECRET)
            or secret_matches(request_secret, DISPATCH_SECRET)):
        authorized = True
    else:
        # Fall back to admin JWT check
        token = credentials.credentials if credentials else request.cookies.get("session_token")
        if token:
            # `resolve_token_user_id`, not `_auth_decode`: this is the ONE
            # authenticated path in the product that does not run through
            # `require_user`, so a plain signature-and-expiry decode here would
            # be the single hole in password-reset session revocation. It reads
            # the same cutoff `require_user` reads.
            user_id = await _auth_resolve(token)
            if user_id:
                # Platform staff, not org admin: this dispatches scheduled
                # reports across every team, so it is a system operation.
                from middleware.roles import is_platform_staff
                if await is_platform_staff(user_id):
                    authorized = True
    if not authorized:
        raise HTTPException(403, "Provide REPORT_DISPATCH_SECRET or an admin JWT")

    now = datetime.now(timezone.utc)
    # `t.org_id` comes along so each report can be filed against the org that
    # asked for it. This runs on a timer with no request behind it, so the
    # ContextVar `outbound.begin()` normally reads is unset and every scheduled
    # report would otherwise land in the log under NULL — invisible on
    # `/me/outbound` and `/orgs/{id}/outbound` for every org, forever.
    #
    # From `teams.org_id`, deliberately, not from `organisations.team_id`: an
    # org has MANY teams and names one primary, so the backlink answers a
    # different question and is NULL for every other team. Verified against the
    # live catalogue — all 34 teams resolve, none disagrees.
    #
    # NULL stays NULL. Eight teams have no org, and an unattributed row is the
    # honest answer there; a guessed org on a table support reads is worse.
    due = await pool.fetch("""
        SELECT rs.*, t.name AS team_name, t.org_id AS team_org_id
        FROM public.report_schedules rs
        JOIN public.teams t ON t.team_id = rs.team_id
        WHERE rs.is_active = TRUE AND rs.next_run_at <= $1
    """, now)

    sent = 0
    errors = []

    for sched in due:
        try:
            # ── CLAIM IT BEFORE SENDING, NOT AFTER ──────────────────────────
            #
            # `next_run_at` used to move only AFTER every recipient had been
            # mailed, inside the same `try`. Two ways that sends a customer's
            # client the same report twice:
            #
            #   · A schedule with three recipients where the second address
            #     bounces at the SMTP layer. The exception skips the UPDATE, the
            #     row is still due, and the next hour mails all three again —
            #     including the one that already received it.
            #   · The container dying between the send and the UPDATE. Railway
            #     restarts it; the row is still due.
            #
            # And a third that arrives with scale rather than with failure: this
            # runs every hour on a schedule that can take minutes, so two
            # invocations can overlap, and both would read the same due row.
            #
            # `OUTBOUND_MODE=live` since 2026-08-18, so all three send real mail
            # to a customer's clients.
            #
            # So the row is CLAIMED first: `next_run_at` moves forward in a
            # conditional UPDATE that only takes if the row is still due. A
            # second worker's UPDATE matches nothing and it skips. This is the
            # ordinary claim pattern and it is why the predicate repeats
            # `next_run_at <= $3` rather than trusting the SELECT above.
            #
            # THE TRADE, STATED: a send that fails is now SKIPPED rather than
            # retried — the schedule has already moved on. That is deliberate
            # for outbound mail. A missed report is visible and recoverable: the
            # next one covers a longer window, and the schedules panel shows
            # `last_sent_at` standing still. A duplicate is neither — it is
            # already in somebody's client's inbox, and no amount of retrying
            # takes it back.
            next_run = _next_run(
                sched["frequency"], sched["day_of_week"],
                sched["day_of_month"], sched["send_hour_utc"],
            )
            claimed = await pool.fetchval("""
                UPDATE public.report_schedules
                   SET next_run_at=$2, updated_at=NOW()
                 WHERE schedule_id=$1 AND next_run_at <= $3
             RETURNING schedule_id
            """, sched["schedule_id"], next_run, now)
            if not claimed:
                # Another invocation took it between our SELECT and here.
                logger.info(
                    "Report schedule %s was already claimed; skipping",
                    _log_safe(sched["schedule_id"]),
                )
                continue

            # Determine period for this report
            freq = sched["frequency"]
            if freq == "daily":
                from_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
                to_date   = (now - timedelta(days=1)).strftime("%Y-%m-%d")
            elif freq == "weekly":
                from_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
                to_date   = (now - timedelta(days=1)).strftime("%Y-%m-%d")
            else:  # monthly
                from_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
                to_date   = (now - timedelta(days=1)).strftime("%Y-%m-%d")

            data      = await _fetch_report_data(pool, sched["team_id"], from_date, to_date)
            team_name = sched["team_name"]
            fmts      = sched["file_formats"] or ["pdf"]

            pdf_bytes   = None
            excel_bytes = None
            if "pdf" in fmts:
                from services.report_generator import generate_pdf
                pdf_bytes = generate_pdf(data, team_name, from_date, to_date)
            if "excel" in fmts:
                from services.report_generator import generate_excel
                excel_bytes = generate_excel(data, team_name, from_date, to_date)

            from email_service import send_report_email
            # Scoped per schedule, not once around the loop: this cron walks
            # every team in the product, so a scope set once would file every
            # report after the first under the previous org — which is worse
            # than the NULL it replaces, because it reads as a fact.
            from outbound import org_scope
            with org_scope(sched["team_org_id"]):
                for recipient in (sched["recipients"] or []):
                    send_report_email(
                        to_email=recipient,
                        team_name=team_name,
                        frequency=freq,
                        period_from=from_date,
                        period_to=to_date,
                        data_summary=data.get("tasks", {}),
                        total_minutes=data.get("total_minutes", 0),
                        pdf_bytes=pdf_bytes,
                        excel_bytes=excel_bytes,
                        by_member_tasks=data.get("by_member_tasks", []),
                        daily_throughput=data.get("daily_throughput", []),
                    )

            # `next_run_at` already moved, at the claim. This records only that
            # the send SUCCEEDED — which is what the schedules panel shows, and
            # what tells an operator the difference between "sent" and "was due
            # and did not go".
            await pool.execute("""
                UPDATE public.report_schedules
                SET last_sent_at=$1, updated_at=NOW()
                WHERE schedule_id=$2
            """, now, sched["schedule_id"])
            sent += 1
            logger.info("Report dispatched: %s", _log_safe(sched['schedule_id']))
        except Exception as exc:
            logger.error("Report dispatch failed for %s: %s", _log_safe(sched['schedule_id']), _log_safe(exc), exc_info=True)
            errors.append(str(sched["schedule_id"]))

    return {"ok": True, "dispatched": sent, "errors": errors}
