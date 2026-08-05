"""
reminder_service.py — Background reminder processor.

Scans for due reminders and sends them via email/push.
Called periodically from a scheduler endpoint or cron.
"""
import logging
from datetime import datetime, timezone, timedelta

import outbound
from db import get_pool

log = logging.getLogger(__name__)


async def scan_and_create_reminders():
    """Scan entities for upcoming/overdue items and create reminder records."""
    pool = await get_pool()

    # 1. Overdue invoices (no payment reminder sent in last 3 days)
    overdue_invoices = await pool.fetch(
        "SELECT i.id, i.org_id, i.invoice_number, i.contact_id, i.total, i.balance_due, "
        "i.due_date, i.created_by "
        "FROM staging.ganit_invoices i "
        "WHERE i.payment_status NOT IN ('paid', 'void') "
        "AND i.due_date < NOW() AND i.is_active = TRUE "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM staging.reminders r "
        "  WHERE r.entity_id = i.id AND r.reminder_type = 'invoice_overdue' "
        "  AND r.created_at > NOW() - INTERVAL '3 days'"
        ")"
    )
    for inv in overdue_invoices:
        await pool.execute(
            "INSERT INTO staging.reminders "
            "(org_id, reminder_type, entity_type, entity_id, remind_at, channel, "
            "recipient_user_id, message, created_by) "
            "VALUES ($1, 'invoice_overdue', 'ganit_invoices', $2, NOW(), 'email', "
            "$3, $4, 'system')",
            inv["org_id"], inv["id"], inv["created_by"],
            f"Invoice {inv['invoice_number']} is overdue. Balance: ₹{inv['balance_due']}",
        )

    # 2. CRM follow-ups due today or overdue
    due_followups = await pool.fetch(
        "SELECT f.id, f.org_id, f.contact_id, f.assigned_to, f.note, f.due_at "
        "FROM staging.graha_follow_ups f "
        "WHERE f.is_completed = FALSE AND f.due_at <= NOW() + INTERVAL '1 hour' "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM staging.reminders r "
        "  WHERE r.entity_id = f.id AND r.reminder_type = 'follow_up_due' "
        "  AND r.created_at > NOW() - INTERVAL '1 day'"
        ")"
    )
    for fu in due_followups:
        await pool.execute(
            "INSERT INTO staging.reminders "
            "(org_id, reminder_type, entity_type, entity_id, remind_at, channel, "
            "recipient_user_id, message, created_by) "
            "VALUES ($1, 'follow_up_due', 'graha_follow_ups', $2, NOW(), 'email', "
            "$3, $4, 'system')",
            fu["org_id"], fu["id"], fu["assigned_to"],
            f"Follow-up due: {fu['note'][:100] if fu['note'] else 'Check your CRM follow-ups'}",
        )

    # 3. Pending approvals older than 24 hours
    stale_approvals = await pool.fetch(
        "SELECT a.id, a.org_id, a.title, a.current_step_approver_id "
        "FROM staging.approval_requests a "
        "WHERE a.status = 'pending' "
        "AND a.created_at < NOW() - INTERVAL '24 hours' "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM staging.reminders r "
        "  WHERE r.entity_id = a.id AND r.reminder_type = 'approval_pending' "
        "  AND r.created_at > NOW() - INTERVAL '1 day'"
        ")"
    )
    for ap in stale_approvals:
        await pool.execute(
            "INSERT INTO staging.reminders "
            "(org_id, reminder_type, entity_type, entity_id, remind_at, channel, "
            "recipient_user_id, message, created_by) "
            "VALUES ($1, 'approval_pending', 'approval_requests', $2, NOW(), 'email', "
            "$3, $4, 'system')",
            ap["org_id"], ap["id"], ap["current_step_approver_id"],
            f"Approval pending: {ap['title']}",
        )

    # 4. Tasks due within next 24 hours
    upcoming_tasks = await pool.fetch(
        "SELECT t.task_id, t.title, t.due_at, tm.org_id, "
        "COALESCE(ta.user_id, t.created_by) as assignee_id "
        "FROM tasks t "
        "JOIN teams tm ON tm.team_id = t.team_id "
        "LEFT JOIN task_assignments ta ON ta.task_id = t.task_id "
        "WHERE t.status != 'done' AND t.archived_at IS NULL "
        "AND t.due_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours' "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM staging.reminders r "
        "  WHERE r.entity_id = t.task_id AND r.reminder_type = 'task_due' "
        "  AND r.created_at > NOW() - INTERVAL '1 day'"
        ")"
    )
    for t in upcoming_tasks:
        await pool.execute(
            "INSERT INTO staging.reminders "
            "(org_id, reminder_type, entity_type, entity_id, remind_at, channel, "
            "recipient_user_id, message, created_by) "
            "VALUES ($1, 'task_due', 'tasks', $2, NOW(), 'email', "
            "$3, $4, 'system')",
            t["org_id"], t["task_id"], t["assignee_id"],
            f"Task due soon: {t['title']}",
        )

    return {
        "invoices": len(overdue_invoices),
        "follow_ups": len(due_followups),
        "approvals": len(stale_approvals),
        "tasks": len(upcoming_tasks),
    }


async def process_pending_reminders():
    """Send all pending reminders that are due.

    Runs from `POST /api/internal/cron/reminders` every 15 minutes. There is no
    request underneath it, so `outbound`'s org ContextVar is unset and every
    email and every push this function sent used to be recorded with a NULL
    org — see the org_scope block below. `staging.reminders.org_id` is NOT NULL
    (migration 049), so the org is on every row this loop reads and nothing here
    has to guess one.
    """
    pool = await get_pool()
    pending = await pool.fetch(
        "SELECT r.*, u.email, u.mobile_number, u.full_name "
        "FROM staging.reminders r "
        "LEFT JOIN users u ON u.user_id = r.recipient_user_id "
        "WHERE r.status = 'pending' AND r.remind_at <= NOW() "
        "ORDER BY r.remind_at "
        "LIMIT 100"
    )

    sent = 0
    for rem in pending:
        try:
            # WHOSE SEND THIS IS. `send_email(to, subject, html)` has no org
            # parameter and no caller could give it one, so the org travels in
            # the ContextVar `outbound.begin()` captures — and a cron has no
            # request to set it. Every org-scoped read of `staging.outbound_log`
            # is `WHERE org_id = $1::uuid` (routers/billing.py), so these rows
            # were invisible to every org, forever: the scheduler was the one
            # sender the outbound screen could never show.
            #
            # PER REMINDER, AND AS A CONTEXT MANAGER, because this loop crosses
            # orgs — a `LIMIT 100` batch is whatever came due, from whichever
            # tenants. A bare `set_org()` would leave the previous reminder's
            # org in place for the next one, and a confidently wrong org on a
            # money-adjacent log is worse than the NULL it replaces. `org_scope`
            # restores what it found on the way out, so an org can only ever
            # attribute its own iteration.
            #
            # NO user_id. 098 reserves that column for who CAUSED the send and
            # says NULL is the right value for "the scheduler that fires a
            # reminder". `recipient_user_id` is who it is FOR, which is already
            # recorded as the recipient; putting them in the causer column would
            # blame them for a timer they never set.
            with outbound.org_scope(rem["org_id"]):
                if rem["channel"] == "email" and rem["email"]:
                    from email_service import send_email
                    send_email(
                        to_email=rem["email"],
                        subject=_subject_for_type(rem["reminder_type"]),
                        html_content=_build_reminder_html(rem),
                    )
                elif rem["channel"] == "push" and rem["recipient_user_id"]:
                    from services.expo_push_service import send_expo_push
                    await send_expo_push(
                        pool, user_id=rem["recipient_user_id"],
                        title=_subject_for_type(rem["reminder_type"]),
                        body=rem["message"] or "",
                    )

            await pool.execute(
                "UPDATE staging.reminders SET status='sent', sent_at=NOW() WHERE id=$1",
                rem["id"],
            )
            sent += 1
        except Exception as e:
            log.warning("Reminder %s failed: %s", rem["id"], e)
            await pool.execute(
                "UPDATE staging.reminders SET status='failed', message=$2 WHERE id=$1",
                rem["id"], f"Error: {str(e)[:200]}",
            )

    return {"processed": len(pending), "sent": sent}


def _subject_for_type(reminder_type: str) -> str:
    return {
        "invoice_overdue": "Invoice overdue — action needed",
        "follow_up_due": "CRM follow-up due today",
        "approval_pending": "Approval waiting for your review",
        "task_due": "Task due soon",
        "meeting_upcoming": "Upcoming meeting reminder",
        "quote_expiry": "Quote expiring soon",
    }.get(reminder_type, "Kartavaya reminder")


# The Devanagari cue for each reminder kind. Fixed decorative glyphs, so
# `--font-hindi`, never `--font-indic` — under an EN+GU preference that resolves
# to Noto Sans Gujarati, which has zero Devanagari coverage.
_HINDI_FOR_TYPE = {
    "invoice_overdue":  "बकाया चालान",
    "follow_up_due":    "अनुवर्तन",
    "approval_pending": "अनुमोदन प्रतीक्षित",
    "task_due":         "समयसीमा",
    "meeting_upcoming": "आगामी बैठक",
    "quote_expiry":     "प्रस्ताव समाप्ति",
}


def _build_reminder_html(rem: dict) -> str:
    """Render a scheduled reminder on the shared editorial email shell.

    Was a bare <div> with its own teal (#1AB8B0, in no token file), the wrong
    brand spelling ("Kartavya"), and a link to app.kartavya.co — a domain the
    owner has corrected repeatedly and which is not where this product lives.

    It also interpolated `full_name` and the reminder `message` unescaped. Both
    are user-controlled: `message` is written by whoever created the reminder,
    and a reminder can be addressed to any user in the org.
    """
    from email_service import _base, _body_text, _cta_row, FRONTEND_URL
    from html import escape as _h

    name = _h(str(rem.get("full_name") or "there").split()[0])
    rtype = rem.get("reminder_type") or ""
    title = _subject_for_type(rtype)
    message = rem.get("message") or "You have a pending item that needs your attention."

    body = (
        _body_text(f"Hi <strong>{name}</strong>, this is a scheduled reminder.")
        + _body_text(_h(str(message)).replace("\n", "<br>"))
        + _cta_row(f"{FRONTEND_URL}/dashboard", "Open Kartavaya", "primary")
    )
    return _base(
        preheader=title,
        kicker="REMINDER · स्मरण",
        headline=title,
        sanskrit=_HINDI_FOR_TYPE.get(rtype, ""),
        lede="",
        body_rows=body,
    )
