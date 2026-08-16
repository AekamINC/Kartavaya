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

── QUIET HOURS ARE A CLOCK, PREFERENCES ARE A DECISION ─────────────────────

`prefs_allow` returns one bool for two unrelated questions, so every caller
inherits the stricter reading of each. A preference is final; quiet hours are
the time of day. Collapsing them means an in-app notification — a silent row in
a list — is destroyed at 2am by a rule written to stop a phone buzzing.

So the channel decides, via `prefs_verdict(..., quiet_hours_apply=)`. The
preference gate always applies; the clock applies only to channels in
`INTERRUPTING`.

This is the rule `create_notification` in server.py already follows — it writes
the in-app row above the push gate, because "quiet hours suppress the DEVICE,
never the record". Niyam's send layer had simply diverged from its own product.

ONE DELIBERATE DIFFERENCE. `create_notification` writes the row even for a kind
the person switched off, on the reasoning that the row IS the record. Niyam does
not: its messages exist because an ORG configured a rule, and somebody who
turned off `task_done` has made a decision about that message specifically.
Their list is not the place to overrule it.

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

#: Channels this module can ACTUALLY deliver on. A closed list for the same
#: reason the action allowlist is closed: an unrecognised channel must be a
#: refusal with a name in it, not a silent no-op.
#:
#: `email` was in here and is not. It passed `validate_steps` — which checks
#: membership of this set — so a rule with `channel: "email"` SAVED CLEANLY, was
#: reported valid by the builder, and then failed on every event it ever
#: matched, because `deliver()` ends "email from a rule is not built yet". That
#: is precisely the "a broken rule is UNWRITABLE" promise this module is built
#: around, broken by a one-word list.
CHANNELS = frozenset({"inapp", "push"})

#: Known, understood, and NOT BUILT. Separated rather than deleted so the
#: refusal can say which it is: "email is not built yet" is a different sentence
#: from "smoke-signal is not a channel", and an author deserves the true one.
PLANNED_CHANNELS = frozenset({"email"})


class Delivery(NamedTuple):
    outcome: str                       # 'ok' | 'refused' | 'failed'
    reason: str
    outbound_id: Optional[int] = None


#: Channels that INTERRUPT, and therefore respect quiet hours. In-app is
#: deliberately absent: it is a row in a list, read when the person next opens
#: the app, and suppressing it at 2am does not postpone the message — there is
#: no queue — it loses it. Quiet hours protect people from being woken, not from
#: being informed.
#:
#: Found the hard way. The first armed rule matched correctly at 01:15 IST and
#: refused with "every recipient was suppressed", and the notification the rule
#: existed to send simply never happened.
INTERRUPTING = frozenset({"push", "email"})


async def _allowed(pool, user_id: str, kind: str, channel: str) -> tuple:
    """(allowed, why). Fail polarity decided here, not in push_service."""
    try:
        from services.push_service import prefs_verdict
    except Exception:                                   # pragma: no cover
        return (kind in ACTIONABLE), "the preference layer could not be loaded"

    try:
        # The reason comes back NAMED — "turned off `task_done`" and "it is
        # quiet hours" are opposite answers to "will I get it later?", and the
        # old single sentence gave both at once.
        return await prefs_verdict(pool, user_id, kind, is_mine=False,
                                   quiet_hours_apply=channel in INTERRUPTING)
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
    if channel not in CHANNELS and channel not in PLANNED_CHANNELS:
        return Delivery("failed", f"`{channel}` is not a channel Niyam can send on")
    if not user_id:
        return Delivery("failed", "no recipient")

    allowed, why = await _allowed(conn, user_id, kind, channel)
    if not allowed:
        return Delivery("refused", why)

    if channel == "inapp":
        return await _inapp(conn, user_id=user_id, kind=kind, title=title, body=body)

    if channel == "push":
        return await _push(conn, user_id=user_id, kind=kind, title=title,
                           body=body, org_id=org_id)

    # Reachable only for a rule SAVED BEFORE `email` left CHANNELS — validation
    # now refuses it at authoring time. Kept so such a rule records an honest
    # outcome rather than a bare "not a channel".
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
