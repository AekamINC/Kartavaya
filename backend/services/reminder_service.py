"""
reminder_service.py — Background reminder processor.

Scans for due reminders and sends them via email/push.
Called periodically from a scheduler endpoint or cron.
"""
import logging
from datetime import datetime, timezone, timedelta

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
    """Send all pending reminders that are due."""
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
    }.get(reminder_type, "Kartavya Reminder")


def _build_reminder_html(rem: dict) -> str:
    name = rem.get("full_name") or "there"
    return f"""
    <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1AB8B0; margin-bottom: 16px;">
            {_subject_for_type(rem['reminder_type'])}
        </h2>
        <p>Hi {name},</p>
        <p>{rem['message'] or 'You have a pending item that needs your attention.'}</p>
        <p style="margin-top: 24px;">
            <a href="https://app.kartavya.co" style="background: #1AB8B0; color: #fff;
            padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Open Kartavya</a>
        </p>
        <p style="color: #888; font-size: 12px; margin-top: 32px;">— Kartavya by Aekam Inc</p>
    </div>
    """
