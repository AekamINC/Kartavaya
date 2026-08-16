"""The only way a rule reaches a human.

Every channel goes through `deliver`. Nothing else under `services/niyam/` may
import a transport — `tests/test_niyam_import_discipline.py` fails the build if
it does, and this module is the single exemption.

── FAILURE POLARITY, DECIDED ONCE ──────────────────────────────────────────

`push_service.prefs_allow` fails OPEN on any database error: it logs and returns
True. That is the right default for an approval request — a missed approval is
worse than a mistimed one — and the wrong one for a bulk overnight send, where a
preferences outage becomes a 2am dunning broadcast.

Today both get fail-open, because there is one function and one default. The
split has to happen here, around the call, keyed on what the message IS. Niyam's
sends are automation-initiated and therefore bulk-shaped by default, so the
default here is fail CLOSED — the opposite of the layer underneath. A kind
listed in `ACTIONABLE` opts back into fail-open.

── "NO EXCEPTION" IS NOT EVIDENCE OF DELIVERY ──────────────────────────────

Every sender in this codebase returns None or a meaningless True and swallows
its own exceptions. `email_service.send_email` returns True the moment the
thread starts AND returns True when suppressed. That is exactly how 331
reminders recorded `status='sent'` while every corresponding outbound row said
`suppressed`, and how the cron that dispatched them stayed green.

So no outcome here is ever derived from the absence of an exception. Either a
row was written that says what happened, or the outcome is `not recorded` and
says so.

── THERE IS NO 'inapp' CHANNEL IN outbound_log ─────────────────────────────

`outbound_log_channel_ck` allows email, push, whatsapp and social. An in-app
notification is a `notifications` ROW, not an outbound message, and writing
`channel='inapp'` makes the writer's `_split_channel` return None and the row
vanish with a warning. So in-app delivery records `outbound_id=None` and an
explicit outcome, which is one of the three states migration 143's header names.
"""
from __future__ import annotations

import logging
from typing import NamedTuple, Optional

log = logging.getLogger(__name__)

#: Kinds that FAIL OPEN — sent even if the preference lookup itself failed,
#: because the message is a person waiting on another person. Everything not
#: listed fails closed.
ACTIONABLE = frozenset({"approval_request", "approval_decision", "mention",
                        "assigned", "client_request"})

#: Channels this module knows how to deliver. A closed list for the same reason
#: the action allowlist is closed: an unrecognised channel must be a refusal
#: with a name in it, not a silent no-op.
CHANNELS = frozenset({"inapp", "push", "email"})


class Delivery(NamedTuple):
    outcome: str                       # 'ok' | 'refused' | 'failed'
    reason: str
    outbound_id: Optional[int] = None


async def _allowed(pool, user_id: str, kind: str) -> tuple:
    """(allowed, why). Fail polarity decided here, not in push_service."""
    try:
        from services.push_service import prefs_allow
    except Exception:                                   # pragma: no cover
        return (kind in ACTIONABLE), "the preference layer could not be loaded"

    try:
        ok = await prefs_allow(pool, user_id, kind, is_mine=False)
        return ok, ("preferences allow it" if ok
                    else "stopped by notification preference or quiet hours")
    except Exception as exc:
        # prefs_allow catches its own database errors and fails open, so
        # reaching here means something more unusual. Apply OUR polarity.
        if kind in ACTIONABLE:
            log.warning("niyam: prefs lookup failed for %s (%s) — sending anyway "
                        "because %r is actionable: %s", user_id, kind, kind, exc)
            return True, "actionable, and the preference lookup failed open"
        log.warning("niyam: prefs lookup failed for %s (%s) — NOT sending, "
                    "because a preferences outage must not become a broadcast: %s",
                    user_id, kind, exc)
        return False, "the preference lookup failed, and this kind fails closed"


async def deliver(conn, *, user_id: str, kind: str, title: str, body: str,
                  org_id: Optional[str] = None, channel: str = "inapp") -> Delivery:
    """Send one message to one person, or record why not.

    Never raises. A rule step is not a reason for a drain tick to die, and the
    engine records whatever comes back either way.
    """
    if channel not in CHANNELS:
        return Delivery("failed", f"`{channel}` is not a channel Niyam can send on")
    if not user_id:
        return Delivery("failed", "no recipient")

    allowed, why = await _allowed(conn, user_id, kind)
    if not allowed:
        return Delivery("refused", why)

    if channel == "inapp":
        return await _inapp(conn, user_id=user_id, kind=kind, title=title, body=body)

    if channel == "push":
        return await _push(conn, user_id=user_id, kind=kind, title=title,
                           body=body, org_id=org_id)

    return Delivery("failed", "email from a rule is not built yet")


async def _inapp(conn, *, user_id: str, kind: str, title: str, body: str) -> Delivery:
    """A `notifications` row. No outbound_log row exists for this channel."""
    import uuid
    try:
        await conn.execute(
            """
            INSERT INTO public.notifications
                (notification_id, user_id, type, title, message)
            VALUES ($1::text, $2::text, $3::text, $4::text, $5::text)
            """,
            f"notif_{uuid.uuid4().hex[:12]}", user_id, kind, title, body or "")
    except Exception as exc:
        return Delivery("failed", f"{type(exc).__name__}: {exc}")
    # outbound_id stays None: this is the "delivered by a channel outbound_log
    # cannot represent" state, not a missing record.
    return Delivery("ok", "in-app notification created")


async def _push(conn, *, user_id: str, kind: str, title: str, body: str,
                org_id: Optional[str]) -> Delivery:
    """Delegated to the gated push path, which writes its own outbound row.

    `send_push` is the function that CONSULTS preferences and quiet hours — it
    is not a raw sender, and the import ratchet correctly permits it. The raw
    primitives (`send_expo_push`, `send_web_push`) are what the ratchet forbids,
    and they are not reachable from here.

    It returns None and swallows its own exceptions, so no outcome is inferred
    from its return. What is recorded is that the attempt was HANDED OVER —
    `outbound_log` is the record of what happened to it, and this function
    cannot learn that row's id (see migration 143's header).
    """
    try:
        from services.push_service import send_push
        await send_push(conn, recipient_id=user_id, kind=kind, title=title,
                        body=body or "", is_mine=False, org_id=org_id)
    except Exception as exc:
        return Delivery("failed", f"{type(exc).__name__}: {exc}")
    return Delivery("ok", "handed to the push layer; outbound_log holds the outcome")
