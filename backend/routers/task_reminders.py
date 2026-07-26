"""task_reminders.py — custom due-date reminder dispatch.

Endpoints:
  POST /api/task-reminders/dispatch — cron endpoint (Railway cron should call this every 5 min)

Reminders themselves are created/edited via /api/tasks (create) and
PUT /api/tasks/{task_id}/reminders (server.py) — this router only fires the
ones that are due.

Operational note: this needs a real external scheduler. Add a Railway Cron
Schedule (Project → + New → Cron Schedule) running every 5 minutes with:
    curl -X POST "$BACKEND_URL/api/task-reminders/dispatch?request_secret=$TASK_REMINDER_DISPATCH_SECRET"
Set TASK_REMINDER_DISPATCH_SECRET to a random 32+ char value in both the
backend service and the cron service's env vars. Without this cron, due
reminders sit unsent — the in-app polling loop only catches the legacy
single `tasks.reminder_at` field, not the new task_reminders table.
"""
import logging
import os
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from auth_router import require_user, security
from middleware.roles import require_platform_role
from middleware.role_tiers import OPERATIONS_CONSOLE_ROLES

_require_admin = require_platform_role(*OPERATIONS_CONSOLE_ROLES)
from db import get_pool
from utils import now_utc, log_safe as _log_safe
from services.web_push_service import send_web_push
from services.expo_push_service import send_expo_push
from services.push_service import prefs_allow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/task-reminders", tags=["task-reminders"])

DISPATCH_SECRET = os.environ.get("TASK_REMINDER_DISPATCH_SECRET", "")
if not DISPATCH_SECRET:
    logger.warning(
        "TASK_REMINDER_DISPATCH_SECRET is not set — dispatch endpoint will require an "
        "authenticated admin session instead. Set this env var so the cron caller "
        "(which has no session cookie) can authenticate with the secret alone."
    )


@router.post("/dispatch")
async def dispatch_reminders(
    request: Request,
    pool = Depends(get_pool),
    request_secret: str = Query(""),
    x_dispatch_secret: str = Header(""),
):
    """Called every few minutes by an external cron. Sends all due task reminders.

    Auth: if TASK_REMINDER_DISPATCH_SECRET is set, a matching secret is
    sufficient on its own (the cron caller has no session cookie to send).
    Only falls back to requiring an authenticated admin session when the
    secret env var isn't configured at all.

    PREFER the `X-Dispatch-Secret` HEADER. `?request_secret=` still works so an
    already-configured cron keeps running, but a secret in a query string is
    written to every access log, proxy log and platform request log it passes
    through, and those outlive and out-scope the secret itself. The header form
    is not logged.
    """
    from utils import secret_matches

    if DISPATCH_SECRET:
        # Header first; the query form is the deprecated fallback.
        if not (secret_matches(x_dispatch_secret, DISPATCH_SECRET)
                or secret_matches(request_secret, DISPATCH_SECRET)):
            raise HTTPException(403, "Invalid dispatch secret")
    else:
        creds = await security(request)
        await _require_admin(await require_user(request, creds))

    now = now_utc()

    # Claim due reminders atomically — FOR UPDATE SKIP LOCKED prevents double-fire
    # when multiple Railway instances run the cron simultaneously.
    async with pool.acquire() as conn:
        async with conn.transaction():
            due = await conn.fetch("""
                SELECT tr.reminder_id, tr.task_id, tr.channel_inapp, tr.channel_push, tr.channel_email,
                       t.title, t.team_id, t.user_id, t.assignee_user_ids, t.due_at
                FROM task_reminders tr
                JOIN tasks t ON t.task_id = tr.task_id
                WHERE tr.sent_at IS NULL AND tr.fire_at <= $1
                  AND t.status != 'done' AND t.archived_at IS NULL
                FOR UPDATE OF tr SKIP LOCKED
            """, now)
            if due:
                await conn.execute(
                    "UPDATE task_reminders SET sent_at=$1 WHERE reminder_id=ANY($2::text[])",
                    now, [r["reminder_id"] for r in due]
                )

    sent, errors = 0, []
    for r in due:
        try:
            recipients = set(r["assignee_user_ids"] or [])
            if not recipients and r["user_id"]:
                recipients.add(r["user_id"])
            message = f"Due soon: {r['title']}"
            for uid in recipients:
                if r["channel_inapp"] or r["channel_push"]:
                    await pool.execute(
                        "INSERT INTO notifications (notification_id,user_id,team_id,type,title,message,task_id,url) "
                        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                        f"notif_{uuid.uuid4().hex[:12]}", uid, r["team_id"], "reminder",
                        "Task reminder", message, r["task_id"], "/tasks",
                    )
                    # QUIET HOURS. `send_web_push` and `send_expo_push` read no
                    # preferences at all — they take a user_id and fire. Every
                    # other kind reaches the device through `send_push`, which
                    # checks the mode and the quiet window first; reminders did
                    # not, so a cron tick at 03:00 IST buzzed the phone straight
                    # through a window the same user had set and the same window
                    # the Inbox banner was telling them was in force.
                    #
                    # `prefs_allow` is the gate `services/push_service.py` split
                    # out of `send_push` for exactly this call site — its own
                    # header names this router as the path that bypasses it and
                    # says the call-site fix was reported rather than made. This
                    # is that fix. The `reminder` key it reads is already in
                    # DEFAULT_PREFS, so the switch the user sets is the switch
                    # this consults.
                    #
                    # The NOTIFICATION ROW IS INSERTED ABOVE THIS CHECK and
                    # stays inserted. Quiet hours suppress the buzz, never the
                    # record: it arrives in the Inbox with its real timestamp,
                    # which is when it happened, not when they saw it.
                    if r["channel_push"] and await prefs_allow(pool, uid, "reminder"):
                        await send_web_push(pool, user_id=uid, title="Task reminder", body=message, url="/tasks")
                        await send_expo_push(pool, user_id=uid, title="Task reminder", body=message, url="/tasks", task_id=r["task_id"])
                if r["channel_email"]:
                    try:
                        from email_service import send_task_reminder_email
                        recipient = await pool.fetchrow("SELECT email,COALESCE(full_name,name) AS name FROM users WHERE user_id=$1", uid)
                        if recipient and recipient["email"]:
                            due_str = r["due_at"].strftime("%b %d, %Y %H:%M UTC") if r["due_at"] else ""
                            send_task_reminder_email(recipient["email"], recipient["name"] or recipient["email"], r["title"], r["task_id"], due_str)
                    except Exception as e:
                        logger.warning("reminder email failed for %s: %s", _log_safe(r["task_id"]), _log_safe(e))
            sent += 1
        except Exception as exc:
            logger.error("Reminder dispatch failed for %s: %s", _log_safe(r["reminder_id"]), _log_safe(exc), exc_info=True)
            errors.append(str(r["reminder_id"]))

    return {"ok": True, "dispatched": sent, "errors": errors}
