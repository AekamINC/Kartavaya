import html
import logging
from datetime import datetime, timedelta
from email_service import send_email

log = logging.getLogger(__name__)

REMIND_DAYS_BEFORE = 7
EXPIRE_GRACE_DAYS = 0


async def process_expiry(pool, org_id: str, module: str = "esign") -> dict:
    """Process document expiry: send reminders for soon-to-expire docs and mark expired ones.

    *module*: 'esign' (ganit_contracts) or 'assets' (manav_assets).

    Returns {reminded: int, expired: int}.
    """
    now = datetime.utcnow()
    remind_cutoff = (now + timedelta(days=REMIND_DAYS_BEFORE)).date()
    expire_cutoff = (now - timedelta(days=EXPIRE_GRACE_DAYS)).date()

    reminded = 0
    expired = 0

    if module == "esign":
        # Contracts expiring soon - remind signers
        expiring = await pool.fetch(
            """
            SELECT c.id, c.title, c.created_by,
                   u.email AS creator_email, u.name AS creator_name
            FROM staging.ganit_contracts c
            LEFT JOIN staging.user_roles u ON u.user_id = c.created_by
            WHERE c.org_id = $1::uuid
              AND c.status = 'active'
              AND c.end_date IS NOT NULL
              AND c.end_date <= $2
              AND c.end_date > $3
              AND c.is_active = true
            """,
            org_id, remind_cutoff, expire_cutoff,
        )

        for doc in expiring:
            if doc["creator_email"]:
                try:
                    # Sync — see campaign_sender.py. Awaiting it raised after
                    # the send had already been dispatched.
                    # Escaped. A contract title and a creator name are both
                    # user-supplied and both land inside HTML, so a contract
                    # named `<img src=x onerror=…>` executed in the recipient's
                    # inbox. This template hand-writes its markup and so never
                    # passed through `_base()`, which is where the product's
                    # escaping lives — `scripts/preview_emails.py` flags all
                    # nine such templates. The SUBJECT is plain text and must
                    # NOT be escaped: entities there render literally as
                    # "&lt;" in the inbox.
                    send_email(
                        doc["creator_email"],
                        f"Contract expiring soon: {doc['title']}",
                        f"<p>Hi {html.escape(str(doc['creator_name'] or ''))},</p>"
                        f"<p>Your contract <b>{html.escape(str(doc['title'] or ''))}</b> is expiring within "
                        f"{REMIND_DAYS_BEFORE} days. Please review and renew if needed.</p>",
                    )
                    reminded += 1
                except Exception:
                    log.warning("Expiry reminder email failed for contract %s", doc["id"])

        # Mark expired
        result = await pool.execute(
            """
            UPDATE staging.ganit_contracts
            SET status = 'expired', updated_at = NOW()
            WHERE org_id = $1::uuid
              AND status = 'active'
              AND end_date IS NOT NULL
              AND end_date < $2
              AND is_active = true
            """,
            org_id, expire_cutoff,
        )
        expired = int(result.split()[-1]) if result else 0

    elif module == "assets":
        # Assets with warranty expiring
        expiring_assets = await pool.fetch(
            """
            SELECT a.id, a.name, a.assigned_to, e.email, e.name AS emp_name
            FROM staging.manav_assets a
            LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to
            WHERE a.org_id = $1::uuid
              AND a.warranty_end IS NOT NULL
              AND a.warranty_end <= $2
              AND a.warranty_end > $3
              AND a.is_active = true
            """,
            org_id, remind_cutoff, expire_cutoff,
        )

        for asset in expiring_assets:
            if asset["email"]:
                try:
                    # Sync — see campaign_sender.py. Awaiting it raised after
                    # the send had already been dispatched.
                    send_email(
                        asset["email"],
                        f"Asset warranty expiring: {asset['name']}",
                        f"<p>The warranty for asset <b>{html.escape(str(asset['name'] or ''))}</b> "
                        f"is expiring soon.</p>",
                    )
                    reminded += 1
                except Exception:
                    log.warning("Asset warranty reminder failed for %s", asset["id"])

    return {"reminded": reminded, "expired": expired}
