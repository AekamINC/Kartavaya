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
CHANNELS = frozenset({"inapp", "push", "email"})

#: Known, understood, and NOT BUILT. Separated rather than deleted so the
#: refusal can say which it is: "email is not built yet" is a different sentence
#: from "smoke-signal is not a channel", and an author deserves the true one.
#: `email` graduated 2026-08-18 (the A4 ladder): it sends through
#: `email_service.send_email`, the product's single choke point, so the
#: outbound kill switch, the escaping rules and `outbound_log` all apply
#: without this module knowing about any of them.
PLANNED_CHANNELS = frozenset()


class Delivery(NamedTuple):
    #: 'ok' | 'deferred' | 'refused' | 'failed'
    #:
    #: ⚠ `deferred` IS NOT A KIND OF `refused`, and collapsing them is what lost
    #: the message. `prefs_verdict`'s own docstring draws the line: "A PREFERENCE
    #: is a decision … QUIET HOURS are a clock: this person does not want to be
    #: INTERRUPTED right now. It says nothing about whether they want the
    #: message." A refusal is final and re-asking gives the same answer; a
    #: deferral is the same answer asked at the wrong time.
    outcome: str
    reason: str
    outbound_id: Optional[int] = None
    #: When this becomes deliverable — aware UTC, set only on 'deferred'.
    retry_after: Optional[object] = None


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
        # ── QUIET HOURS ARE A CLOCK, SO THE MESSAGE WAITS ──────────────────
        #
        # This returned a flat `refused`, `NotifySend.run` turned that into a
        # refused ActionResult, `run_pipeline` recorded the step and called
        # `_finish` — which stamps `finished_at` and NULLs `wake_at`. Nothing
        # re-queued it and no later sweep retried it. The message was gone.
        #
        # Suite 16.14 measured it as "no run deferred, and none can", and the
        # loss is not hypothetical: `INTERRUPTING`'s own comment records the
        # first armed rule in this product matching at 01:15 IST and the
        # notification it existed to send simply never happening.
        #
        # ⚠ ONLY WHEN QUIET HOURS ARE THE REASON. A person who turned this kind
        # of notification off has made a DECISION, and re-delivering it at 07:00
        # would override them.
        #
        # "Is the clock quiet?" is NOT that question, and asking it alone got
        # this wrong: `prefs_verdict` checks the preference gate FIRST, so at
        # 01:15 a turned-off kind and a quiet hour produce one refusal and both
        # facts are true at once. Deferring on the clock would have deferred the
        # decision too.
        #
        # So the preference gate is asked ON ITS OWN, with the clock switched
        # off — `quiet_hours_apply=False`. If it still refuses, the refusal is a
        # decision and is final at any hour. Only if it ALLOWS is the clock the
        # whole reason, and only then is there anything to come back for.
        #
        # Asked as a question rather than matched on the refusal's prose: `why`
        # is a sentence written for a person, and a `"quiet hours" in why` test
        # would silently start deferring preferences the day somebody reworded
        # it.
        if channel in INTERRUPTING:
            from services.push_service import prefs_verdict, quiet_until_for
            try:
                pref_ok, _ = await prefs_verdict(conn, user_id, kind,
                                                 is_mine=False,
                                                 quiet_hours_apply=False)
            except Exception:                             # noqa: BLE001
                # `_allowed` has already applied this module's fail polarity to
                # get here; a second lookup failing is not a reason to invent a
                # deferral, so the refusal stands.
                pref_ok = False
            if pref_ok:
                until = await quiet_until_for(conn, user_id)
                if until is not None:
                    return Delivery("deferred", why, retry_after=until)
        return Delivery("refused", why)

    if channel == "inapp":
        return await _inapp(conn, user_id=user_id, kind=kind, title=title, body=body, org_id=org_id)

    if channel == "push":
        return await _push(conn, user_id=user_id, kind=kind, title=title,
                           body=body, org_id=org_id)

    return await _email(conn, user_id=user_id, kind=kind, title=title,
                        body=body, org_id=org_id)


async def _inapp(conn, *, user_id: str, kind: str, title: str, body: str,
                 org_id: Optional[str] = None) -> Delivery:
    """A `notifications` row. No outbound_log row exists for this channel."""
    import uuid
    try:
        await conn.execute(
            """
            INSERT INTO public.notifications
                (notification_id, user_id, type, title, message, org_id)
            VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::uuid)
            """,
            f"notif_{uuid.uuid4().hex[:12]}", user_id, kind, title, body or "", org_id)
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


async def deliver_customer_email(conn, *, address: str, subject: str,
                                 body: str, purpose: str, ref: str) -> Delivery:
    """One email to somebody OUTSIDE the firm. The A0 Q1 gate lives HERE.

    In the transport rather than in the verb that wants it, so no future
    action can mail a non-member without passing it — the same reasoning that
    puts the channel allowlist in this module instead of in every action.

    What is deliberately DIFFERENT from `_email`:

      · `flags.customer_mail_armed()` first. Off — the shipped state — means
        every customer-facing send refuses, by name, whatever `NIYAM_ARMED`
        says. Two independent switches, because their blast radii differ by
        an order of magnitude.
      · NO `prefs_verdict` and no quiet hours: preferences are rows a MEMBER
        owns, and a customer has none. What protects the customer is the gate
        above, the run-time re-checks in the verb (an invoice paid mid-flight
        refuses), and `OUTBOUND_MODE` underneath everything.
      · the address arrives resolved. This function does not know what a
        client is; the verb that does states where the address came from.

    Same as `_email`: `send_email` is the single choke point (outbound gate,
    `_safe_subject`, `outbound_log`), and the body is escaped wholesale — a
    rule is not a template language, and customer-controlled strings must
    never reach HTML unescaped.
    """
    from .flags import customer_mail_armed, CUSTOMER_MAIL_VAR

    if not customer_mail_armed():
        return Delivery(
            "refused",
            f"customer mail is not armed ({CUSTOMER_MAIL_VAR}) — nothing "
            f"Niyam sends may leave the firm until the owner opens that gate")
    address = (address or "").strip()
    if not address or "@" not in address:
        return Delivery("failed", "no usable customer address")
    if address.endswith(".invalid"):
        return Delivery("refused", "the address is a sentinel, not a mailbox")

    from email_service import send_email
    from html import escape

    html_body = f"<p>{escape(body or subject)}</p>"
    try:
        handed = await __import__("asyncio").to_thread(
            send_email, address, subject, html_body,
            purpose=purpose, ref=ref,
        )
    except Exception as exc:
        return Delivery("failed", f"{type(exc).__name__}: {exc}")
    if not handed:
        return Delivery("failed", "the email layer refused the handover")
    return Delivery("ok", "handed to the email layer; outbound_log holds the outcome")


async def deliver_report_email(conn, *, address: str, subject: str,
                               html_document: str, ref: str) -> Delivery:
    """One rendered report to one MEMBER of the org — report.send's transport.

    What is deliberately different from the other two email paths:

      · `html_document` is a full letterhead DOCUMENT this product rendered —
        `services/module_report.render_report_html`, the same bytes the pdf
        branch prints — so it is passed through, NOT wrapped and escaped
        wholesale. Every user-controlled string inside it already went
        through `doc_render.esc` at the cell level; escaping the document
        would mail the markup as text.
      · NO customer gate: the VERB proves membership against
        `staging.user_roles` before any address reaches here, so nothing on
        this path leaves the firm. An address this function is handed is a
        member's by contract — which is why it must never be exported to a
        verb that has not done that join.
      · NO `prefs_verdict` and no quiet hours: a scheduled report is not a
        notification about someone; its `time_utc` on the schedule row IS the
        preference, chosen by the person who scheduled it.

    Same as everywhere: `send_email` is the single choke point (outbound
    kill switch, `_safe_subject`, `outbound_log`).
    """
    address = (address or "").strip()
    if not address or "@" not in address:
        return Delivery("failed", "no usable member address")

    from email_service import send_email

    try:
        handed = await __import__("asyncio").to_thread(
            send_email, address, subject, html_document,
            purpose="niyam_report", ref=ref,
        )
    except Exception as exc:
        return Delivery("failed", f"{type(exc).__name__}: {exc}")
    if not handed:
        return Delivery("failed", "the email layer refused the handover")
    return Delivery("ok", "handed to the email layer; outbound_log holds the outcome")


async def _email(conn, *, user_id: str, kind: str, title: str, body: str,
                 org_id: Optional[str]) -> Delivery:
    """One email to one PERSON, through the product's single choke point.

    `send_email` is where the outbound gate lives (`OUTBOUND_MODE=dry` writes a
    `suppressed` row and sends nothing), where subjects are made header-safe
    (`_safe_subject`) and where `outbound_log` is written — so this function
    adds none of that machinery and cannot drift from it.

    The recipient is a USER ID, resolved to an address here. Two refusals are
    this function's own:

      · a system account (`is_system`, or the `.invalid` sentinel domain that
        marks one even before migration 148 is read) — the automation must
        never mail itself, and `.invalid` is unroutable by RFC 2606 anyway;
      · a user with no address — recorded, not silently skipped.

    `blocking=False` (the default): the provider outcome lands in
    `outbound_log`, which is this product's only honest answer to "was it
    sent" — the rule run records the HANDOVER, exactly as `_push` does.
    """
    try:
        row = await conn.fetchrow(
            "SELECT email, COALESCE(is_system, FALSE) AS is_system "
            "FROM public.users WHERE user_id = $1::text",
            user_id,
        )
    except Exception as exc:
        return Delivery("failed", f"recipient lookup failed — {type(exc).__name__}: {exc}")
    if row is None:
        return Delivery("failed", "no such user")
    address = (row["email"] or "").strip()
    if row["is_system"] or address.endswith(".invalid"):
        return Delivery("refused", "system accounts do not receive mail")
    if not address:
        return Delivery("failed", "the recipient has no email address")

    from email_service import send_email
    from html import escape

    # The body is rule-author text over event data — escaped wholesale. A rule
    # is not a template language, and the one thing an automation email must
    # never do is carry a customer-controlled string into HTML unescaped.
    html_body = f"<p>{escape(body or title)}</p>"
    try:
        handed = await __import__("asyncio").to_thread(
            send_email, address, title, html_body,
            purpose="niyam_rule", ref=f"niyam:{kind}",
        )
    except Exception as exc:
        return Delivery("failed", f"{type(exc).__name__}: {exc}")
    if not handed:
        return Delivery("failed", "the email layer refused the handover")
    return Delivery("ok", "handed to the email layer; outbound_log holds the outcome")
