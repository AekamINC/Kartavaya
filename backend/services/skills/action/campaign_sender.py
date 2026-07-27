import html
import logging
from email_service import send_email

log = logging.getLogger(__name__)

BATCH_SIZE = 50


async def send_campaign(pool, campaign_id: str) -> dict:
    """Send an email campaign to all pending recipients.

    Returns {total, sent, failed}.
    """
    campaign = await pool.fetchrow(
        """
        SELECT id, org_id, subject, html_content, channel, status
        FROM staging.prachar_campaigns
        WHERE id = $1::uuid
        """,
        campaign_id,
    )
    if not campaign:
        return {"total": 0, "sent": 0, "failed": 0, "error": "campaign_not_found"}

    if campaign["status"] not in ("scheduled", "sending"):
        return {"total": 0, "sent": 0, "failed": 0, "error": f"invalid_status_{campaign['status']}"}

    # Mark as sending
    await pool.execute(
        "UPDATE staging.prachar_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid",
        campaign_id,
    )

    # Fetch pending contacts
    recipients = await pool.fetch(
        """
        SELECT cc.id, cc.contact_id, c.email, c.name
        FROM staging.prachar_campaign_contacts cc
        JOIN staging.graha_contacts c ON c.id = cc.contact_id
        LEFT JOIN staging.prachar_unsubscribes u
            ON u.org_id = $2::uuid AND u.email = c.email
        WHERE cc.campaign_id = $1::uuid
          AND cc.status = 'pending'
          AND c.email IS NOT NULL
          AND u.id IS NULL
        LIMIT 5000
        """,
        campaign_id, campaign["org_id"],
    )

    total = len(recipients)
    sent = 0
    failed = 0

    for r in recipients:
        # The campaign BODY is the org's own authored HTML and stays raw — that
        # is the feature. The substituted CONTACT NAME is not: it is third-party
        # data landing inside that HTML, so a contact named `<img src=x
        # onerror=…>` had their own markup rendered live in the mail. Escaped
        # here rather than at the campaign, so the distinction between "markup
        # we authored" and "text someone gave us" stays visible at the join.
        #
        # The SUBJECT is plain text and must NOT be escaped: an entity there
        # renders literally as "&amp;" in the inbox.
        safe_name = html.escape(r["name"] or "")
        subject = (campaign["subject"] or "").replace("{{name}}", r["name"] or "")
        body = (campaign["html_content"] or "").replace("{{name}}", safe_name)
        try:
            # NOT awaited. `send_email` is sync — it threads internally and
            # returns bool. Awaiting it raised TypeError AFTER the send thread
            # had already started, so the mail went out and this contact was
            # then written back as 'failed'. A retry of the campaign resent to
            # everyone who had in fact received it.
            send_email(r["email"], subject, body)
            await pool.execute(
                "UPDATE staging.prachar_campaign_contacts SET status = 'sent', sent_at = NOW() WHERE id = $1::uuid",
                r["id"],
            )
            sent += 1
        except Exception:
            await pool.execute(
                "UPDATE staging.prachar_campaign_contacts SET status = 'failed' WHERE id = $1::uuid",
                r["id"],
            )
            failed += 1
            log.warning("Campaign send failed for contact %s", r["contact_id"])

    # Mark campaign complete
    final_status = "sent" if failed == 0 else "sent"
    await pool.execute(
        "UPDATE staging.prachar_campaigns SET status = $2, updated_at = NOW() WHERE id = $1::uuid",
        campaign_id, final_status,
    )

    return {"total": total, "sent": sent, "failed": failed}
