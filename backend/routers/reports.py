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

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator, EmailStr
from typing import Optional as _Optional

from auth_router import require_user, _decode_token as _auth_decode
from db import get_pool
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
    """Raise 403 unless the user is a system admin or project owner/admin."""
    if user.get("role") == "admin":
        return
    mem = await pool.fetchrow(
        "SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",
        team_id, user["user_id"]
    )
    if not mem or mem["role"] not in ("owner", "admin"):
        raise HTTPException(403, "Owner or admin required")


async def _assert_project_member(pool, team_id: str, user: dict):
    """Raise 403 unless the user is a system admin or any member of the project.

    Viewing/exporting a report you already have task access to shouldn't require
    being the project owner — that restriction is reserved for managing schedules,
    which dispatch automated emails to other people.
    """
    if user.get("role") == "admin":
        return
    mem = await pool.fetchrow(
        "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2",
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
    """Fetch time entries + task stats + task list + leaderboard + throughput."""
    from datetime import date as _date
    from_dt = _date.fromisoformat(from_date)
    to_dt   = _date.fromisoformat(to_date)
    # Time entries
    entries = await pool.fetch("""
        SELECT te.entry_id, te.minutes, te.started_at, te.description,
               COALESCE(u.full_name, u.name, u.email) AS user_name,
               t.title AS task_title
        FROM time_entries te
        JOIN tasks t ON t.task_id = te.task_id AND t.team_id = $1
        LEFT JOIN users u ON u.user_id = te.user_id
        WHERE te.started_at >= $2::timestamptz
          AND te.started_at <= ($3::date + interval '1 day')::timestamptz
        ORDER BY te.started_at DESC
    """, team_id, from_dt, to_dt)

    total_mins = sum(e["minutes"] or 0 for e in entries)

    now = datetime.now(timezone.utc)
    counts = await pool.fetchrow("""
        SELECT
          COUNT(*) FILTER (WHERE status='todo')                         AS todo,
          COUNT(*) FILTER (WHERE status='in_progress')                  AS in_progress,
          COUNT(*) FILTER (WHERE status='done')                         AS done,
          COUNT(*) FILTER (WHERE status!='done' AND due_at < $2)        AS overdue
        FROM tasks WHERE team_id=$1
    """, team_id, now)
    todo        = counts["todo"]
    in_progress = counts["in_progress"]
    done        = counts["done"]
    overdue     = counts["overdue"]

    # Detailed task list (up to 50) — no array subquery, owner derived from created_by
    try:
        task_list_rows = await pool.fetch("""
            SELECT t.task_id, t.title, t.status, t.priority, t.due_at, t.updated_at,
                   COALESCE(u2.full_name, u2.name, u2.email, 'Unassigned') AS owner_name
            FROM tasks t
            LEFT JOIN users u2 ON u2.user_id = t.created_by_user_id
            WHERE t.team_id = $1
            ORDER BY CASE t.status
                WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
                t.due_at ASC NULLS LAST
            LIMIT 50
        """, team_id)
    except Exception:
        task_list_rows = []

    # Daily throughput: tasks closed per calendar day
    try:
        throughput_rows = await pool.fetch("""
            SELECT DATE(t.updated_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS done_count
            FROM tasks t
            WHERE t.team_id = $1 AND t.status = 'done'
              AND t.updated_at >= $2::timestamptz
              AND t.updated_at <= ($3::date + interval '1 day')::timestamptz
            GROUP BY day ORDER BY day
        """, team_id, from_dt, to_dt)
    except Exception:
        throughput_rows = []

    # Per-member task counts: derived from time entries (no array unnest needed)
    member_tasks_map: dict[str, int] = {}
    for e in entries:
        nm = e.get("user_name") or "Unknown"
        member_tasks_map[nm] = member_tasks_map.get(nm, 0) + 1
    member_tasks_rows_derived = [
        {"user_name": nm, "tasks_done": cnt}
        for nm, cnt in sorted(member_tasks_map.items(), key=lambda x: -x[1])
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

    team = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", team_id)
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
        "SELECT * FROM report_schedules WHERE team_id=$1 ORDER BY created_at DESC",
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
    row = await pool.fetchrow("""
        INSERT INTO report_schedules
          (schedule_id, team_id, created_by, frequency, file_formats, recipients,
           day_of_week, day_of_month, send_hour_utc, next_run_at)
        VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9,$10)
        RETURNING *
    """,
        schedule_id, team_id, user["user_id"],
        payload.frequency, payload.file_formats, payload.recipients,
        payload.day_of_week, payload.day_of_month, payload.send_hour_utc, next_run,
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
        "SELECT team_id FROM report_schedules WHERE schedule_id=$1", schedule_id
    )
    if not row:
        raise HTTPException(404)
    await _assert_project_owner(pool, row["team_id"], user)
    await pool.execute("DELETE FROM report_schedules WHERE schedule_id=$1", schedule_id)
    return {"ok": True}


@router.post("/dispatch")
async def dispatch_reports(
    request: Request,
    request_secret: str = Query(""),
    pool = Depends(get_pool),
    credentials: _Optional[HTTPAuthorizationCredentials] = Depends(_dispatch_bearer),
):
    """Called hourly by Railway cron. Accepts REPORT_DISPATCH_SECRET OR an admin JWT.

    Cron callers (no session): supply ?request_secret=<REPORT_DISPATCH_SECRET>.
    Manual callers (browser/admin): supply a valid admin Bearer token.
    """
    authorized = False
    if DISPATCH_SECRET and request_secret == DISPATCH_SECRET:
        authorized = True
    else:
        # Fall back to admin JWT check
        token = credentials.credentials if credentials else request.cookies.get("session_token")
        if token:
            user_id = _auth_decode(token)
            if user_id:
                row = await pool.fetchrow("SELECT role FROM users WHERE user_id=$1", user_id)
                if row and row["role"] == "admin":
                    authorized = True
    if not authorized:
        raise HTTPException(403, "Provide REPORT_DISPATCH_SECRET or an admin JWT")

    now = datetime.now(timezone.utc)
    due = await pool.fetch("""
        SELECT rs.*, t.name AS team_name
        FROM report_schedules rs
        JOIN teams t ON t.team_id = rs.team_id
        WHERE rs.is_active = TRUE AND rs.next_run_at <= $1
    """, now)

    sent = 0
    errors = []

    for sched in due:
        try:
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

            next_run = _next_run(
                freq, sched["day_of_week"],
                sched["day_of_month"], sched["send_hour_utc"]
            )
            await pool.execute("""
                UPDATE report_schedules
                SET last_sent_at=$1, next_run_at=$2, updated_at=NOW()
                WHERE schedule_id=$3
            """, now, next_run, sched["schedule_id"])
            sent += 1
            logger.info("Report dispatched: %s", _log_safe(sched['schedule_id']))
        except Exception as exc:
            logger.error("Report dispatch failed for %s: %s", _log_safe(sched['schedule_id']), _log_safe(exc), exc_info=True)
            errors.append(str(sched["schedule_id"]))

    return {"ok": True, "dispatched": sent, "errors": errors}
