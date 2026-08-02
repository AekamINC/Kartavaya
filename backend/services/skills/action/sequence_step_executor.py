import logging
from datetime import timedelta
from services.skills.timeutil import utc_now
from email_service import send_email

log = logging.getLogger(__name__)


async def execute_step(pool, enrollment_id: str) -> dict:
    """Execute the next pending step in a marketing sequence enrollment.

    Returns {status, next_step_at}.
    """
    enrollment = await pool.fetchrow(
        """
        SELECT se.id, se.sequence_id, se.contact_id, se.current_step, se.status, se.org_id,
               c.email, c.name AS contact_name
        FROM staging.prachar_sequence_enrollments se
        JOIN staging.graha_contacts c ON c.id = se.contact_id
        WHERE se.id = $1::uuid AND se.status = 'active'
        """,
        enrollment_id,
    )

    if not enrollment:
        return {"status": "skipped", "reason": "enrollment_not_active", "next_step_at": None}

    # Get next step
    step = await pool.fetchrow(
        """
        SELECT id, step_number, channel, subject, body, delay_hours
        FROM staging.prachar_sequence_steps
        WHERE sequence_id = $1::uuid AND step_number = $2
        ORDER BY step_number
        """,
        enrollment["sequence_id"], (enrollment["current_step"] or 0) + 1,
    )

    if not step:
        # Sequence complete
        await pool.execute(
            "UPDATE staging.prachar_sequence_enrollments SET status = 'completed', updated_at = NOW() WHERE id = $1::uuid",
            enrollment_id,
        )
        return {"status": "completed", "next_step_at": None}

    # Check unsubscribe
    unsub = await pool.fetchrow(
        "SELECT 1 FROM staging.prachar_unsubscribes WHERE org_id = $1::uuid AND email = $2",
        enrollment["org_id"], enrollment["email"],
    )
    if unsub:
        await pool.execute(
            "UPDATE staging.prachar_sequence_enrollments SET status = 'unsubscribed', updated_at = NOW() WHERE id = $1::uuid",
            enrollment_id,
        )
        return {"status": "unsubscribed", "next_step_at": None}

    # Send
    channel = step["channel"] or "email"
    if channel == "email" and enrollment["email"]:
        subject = (step["subject"] or "").replace("{{name}}", enrollment["contact_name"] or "")
        body = (step["body"] or "").replace("{{name}}", enrollment["contact_name"] or "")
        try:
            # Sync — see campaign_sender.py. The await raised, so every step
            # returned "failed" and the enrolment never advanced: the same
            # sequence step was re-sent to the same contact on each cron pass.
            send_email(enrollment["email"], subject, body)
        except Exception:
            log.exception("Sequence email failed for enrollment %s step %s", enrollment_id, step["step_number"])
            return {"status": "failed", "next_step_at": None}

    # Log and advance
    await pool.execute(
        """
        INSERT INTO staging.prachar_sequence_logs (enrollment_id, step_id, channel, sent_at)
        VALUES ($1::uuid, $2::uuid, $3, NOW())
        """,
        enrollment_id, step["id"], channel,
    )

    next_step_at = None
    next_step = await pool.fetchrow(
        "SELECT delay_hours FROM staging.prachar_sequence_steps WHERE sequence_id = $1::uuid AND step_number = $2",
        enrollment["sequence_id"], step["step_number"] + 1,
    )
    if next_step:
        next_step_at = (utc_now() + timedelta(hours=next_step["delay_hours"] or 24)).isoformat()

    await pool.execute(
        "UPDATE staging.prachar_sequence_enrollments SET current_step = $2, updated_at = NOW() WHERE id = $1::uuid",
        enrollment_id, step["step_number"],
    )

    return {"status": "sent", "next_step_at": next_step_at}
