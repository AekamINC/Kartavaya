"""Outbound side-effect kill switch.

Staging shares production's credentials — the same SES identity, the same
per-client social OAuth tokens, the same AI billing. Nothing in the codebase
distinguished the two, so testing a screen that sends could deliver a real
email, or post publicly to a customer's client's Facebook page.

`OUTBOUND_MODE=dry` suppresses everything that leaves the building and logs
what would have gone. Set it on the staging service; leave it unset (or
`live`) in production.

Guarded at the narrowest choke point in each channel rather than at call
sites, so a new caller is covered automatically instead of being one more
thing to remember.

    OUTBOUND_MODE=live   (default) — send normally
    OUTBOUND_MODE=dry              — suppress and log

Deliberately NOT guarded:
  * AI inference (`services/ai_router.py`). It costs real money, but blocking
    it makes every Srijan screen unusable and the redesign untestable. Cost is
    metered per-org and visible; a wrong Facebook post is not retractable.
    Treat AI spend as a budget question, not a safety one.
  * WhatsApp (`routers/whatsapp.py`). It does not send today — `send_wa_message`
    stores the row as 'pending' behind a `TODO: Call Meta Cloud API`. When that
    TODO is implemented, guard it here before it ships.
"""

import logging
import os

logger = logging.getLogger("outbound")

MODE = os.getenv("OUTBOUND_MODE", "live").strip().lower()
DRY_RUN = MODE == "dry"

if DRY_RUN:
    logger.warning(
        "OUTBOUND_MODE=dry — email, push and social publishing are SUPPRESSED. "
        "AI inference still runs and still costs money."
    )


def suppressed(channel: str, target: str = "", detail: str = "") -> bool:
    """True if this send must not go out. Logs the suppression when it does.

    Call as the first line of a sender:

        if suppressed("email", to_email, subject):
            return True
    """
    if not DRY_RUN:
        return False
    # ASCII only: these lines are read in Railway logs and in a Windows console,
    # and a non-UTF8 terminal turns a nice arrow into mojibake.
    logger.warning(
        "OUTBOUND[dry] suppressed %s -> %s%s",
        channel, target or "(no target)", f" | {detail}" if detail else "",
    )
    return True
