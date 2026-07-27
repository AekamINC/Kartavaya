import logging
from services.web_push_service import fan_out_web_push
from email_service import send_email

log = logging.getLogger(__name__)


async def notify_multi(
    pool, user_ids: list, title: str, body: str, channels: list = None
) -> dict:
    """Send notifications to multiple users across channels.

    *channels*: subset of ['push', 'email', 'in_app']. Defaults to ['push', 'in_app'].

    Returns {sent: int}.
    """
    channels = channels or ["push", "in_app"]
    sent = 0

    if "push" in channels:
        try:
            await fan_out_web_push(pool, user_ids, title, body)
            sent += len(user_ids)
        except Exception:
            log.exception("Push fan-out failed")

    if "email" in channels:
        # Fetch emails for all users
        rows = await pool.fetch(
            """
            SELECT user_id, email FROM staging.user_roles
            WHERE user_id = ANY($1::uuid[])
            """,
            user_ids,
        )
        for r in rows:
            try:
                # Sync — see campaign_sender.py.
                send_email(r["email"], title, f"<p>{body}</p>")
                sent += 1
            except Exception:
                log.warning("Email send failed for %s", r["user_id"])

    if "in_app" in channels:
        # Insert into reminders table as in-app notifications
        for uid in user_ids:
            try:
                await pool.execute(
                    """
                    INSERT INTO staging.reminders (user_id, title, message, due_at, is_read)
                    VALUES ($1::uuid, $2, $3, NOW(), false)
                    """,
                    uid, title, body,
                )
                sent += 1
            except Exception:
                log.warning("In-app notification failed for %s", uid)

    return {"sent": sent}
