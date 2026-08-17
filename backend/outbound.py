"""Outbound side-effect kill switch — and the record of everything that left.

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
GUARDED SINCE 2026-08-17, and worth recording why it was not:
  * WhatsApp (`routers/whatsapp.py`). This list used to carry it as unguarded,
    on the stated grounds that it "does not send today", with the instruction to
    "guard it here before it ships". P7 (`45e94bd5`) made it send and nobody
    came back to this line, so for nine days the one channel whose recipient is
    somebody else's client was the one channel `OUTBOUND_MODE=dry` did not stop
    and `outbound_log` never saw. An exemption that names its own expiry
    condition still needs someone to notice the condition was met.

── WHY THE LOG LIVES HERE TOO ───────────────────────────────────────────────

AWS said 2,586 of 3,000 SES message units were used in August, and the product
could not say how many emails it had sent. Not approximately — at all. The
answer took an hour of inference from payslip rows and was still only a floor,
because nothing recorded a send.

The record belongs at this exact line for the same reason the kill switch does.
`suppressed()` is already the first statement of every sender in the product;
that is why the whole GSTIN scraper could be withdrawn in one line, and it is
why a sender written next year is logged without anyone remembering to log it.
Anywhere else — a decorator per sender, a call after each provider call — and
the coverage is only as good as the next author's memory, which is precisely
the failure this exercise is about.

So `suppressed()` no longer only sees the suppressed case. It writes a row for
EVERY call: `suppressed` when the switch stopped it, `queued` when the gate
opened and the sender proceeded. That alone answers "how many emails in August,
to whom, how big", for every channel, with no change to any sender.

── THE HALF THIS FILE CANNOT SEE ────────────────────────────────────────────

What it cannot know is what the provider said. `suppressed()` returns before
the send; the message id exists only inside the sender, and for email inside a
`threading.Thread` that outlives the request. So the record has a second half,
and it is OPTIONAL BY DESIGN — a sender that never reports still produces a
correct row, marked `queued`, which is an honest claim rather than a missing
one:

    att = outbound.begin("email", to_email, subject, bytes=len(body))
    if att.blocked:
        return True
    ...
    att.sent(r["MessageId"], provider="ses")      # or att.failed(exc)

`att.sent()` completes the row it already wrote. It does not add a second one,
so a count of rows stays a count of messages.

Where the send finishes inside the same block, `sending()` removes the last
thing anyone can forget — the failure branch — because `__exit__` runs whether
the body returns or raises:

    with outbound.sending("social:facebook", page_id, text[:80]) as att:
        if att.blocked:
            return {"suppressed": True}
        r = await _post(...)
        att.sent(r["id"], provider="meta")

Nothing here can raise. A logging failure that stopped an email would be a
worse product than no logging at all.

── WHOSE SEND WAS IT, AND WHY IT IS CAPTURED HERE ───────────────────────────

Every org-scoped read of this table is `WHERE org_id = $1::uuid`
(`routers/billing.py:1449`, `:1455`, `:1593`), so a row with a NULL org is a
row no client will ever be shown. NULL is what every email and every push wrote,
because `email_service.send_email(to, subject, html)` has no org parameter and
no caller could supply one — the feature would have answered the incident it
was built for with an empty screen, for every org, forever.

Threading an argument through fourteen senders and their call sites is the fix
the fifteenth sender forgets, which is the failure mode this whole table exists
to end. So the org travels with the REQUEST instead, in a
`contextvars.ContextVar` that `middleware/org_resolver.py` sets once it has
resolved the org it was going to resolve anyway. An explicit `org_id=` still
wins; the context is only the default.

THE CAPTURE HAPPENS IN `begin()`, ON THE CALLER'S THREAD, AND NOWHERE ELSE.
That placement is the entire subtlety and it is worth the paragraph:

  * `email_service.send_email` hands the message to a `threading.Thread`
    (`email_service.py:602`), and a plain Thread starts with an EMPTY context —
    every ContextVar reads its default in there. `begin()` runs at line 523,
    BEFORE that thread exists, and `services/employee_email.py` calls
    `suppressed()` at :197 before its own thread starts at :249. Both read the
    value while the request is still underneath them, and the Attempt then
    carries it across the handoff in its own fields. There is nothing to copy
    because nothing crosses.
  * Reading it later — inside `services/outbound_log.write()`, say — looks
    identical and is silently wrong in the worst available way. The completion
    the sending thread reports REPLACES the buffered attempt wholesale (see
    QUEUED in that file), so a thread-side read would not merely fail to add an
    org: IT WOULD ERASE THE ONE `begin()` HAD ALREADY CAPTURED, and the single
    row reaching the table would be back to org_id = NULL with nothing anywhere
    looking wrong. That is why the writer has no default of its own, and why it
    must not grow one.
  * `asyncio.create_task` / `ensure_future` — the push fan-outs in
    `services/mentions.py` and `services/samvaad_mentions.py` — DO inherit,
    because `Task.__init__` copies the current context at creation. A push
    scheduled from a request carries that request's org with no further help. A
    push scheduled from a scheduler or an automation carries whatever that job
    set, which is what `org_scope()` is for.
  * A SYNC FastAPI dependency or endpoint runs in anyio's worker thread, which
    is handed a COPY of the request context: reads work there, and a `set()`
    made there is thrown away when the thread returns. Set it from async code —
    `get_org_id` is `async def`, which is why setting it there works.
  * Setting it in a `BaseHTTPMiddleware.dispatch` before `call_next` would NOT
    reach the endpoint on the Starlette versions that run the app in a separate
    task. A dependency shares the endpoint's task and does.
  * The same task boundary is what ISOLATES one request from the next, and it
    comes from whatever creates a task — not from this file. Measured on
    starlette 1.3.1 through `httpx.ASGITransport`: a bare FastAPI app leaks the
    value into the following request, and the SAME app with one
    `BaseHTTPMiddleware` in front of it does not, because that middleware runs
    everything downstream in a child task. `server.py` has four of them, and
    uvicorn wraps each request in a task besides. `org_scope()` is the form
    that needs neither. See `set_org()`.
"""

import logging
import os
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone

from services import outbound_log

logger = logging.getLogger("outbound")

MODE = os.getenv("OUTBOUND_MODE", "live").strip().lower()
DRY_RUN = MODE == "dry"

if DRY_RUN:
    logger.warning(
        "OUTBOUND_MODE=dry — email, push and social publishing are SUPPRESSED. "
        "AI inference still runs and still costs money."
    )


# ── Whose send is this ───────────────────────────────────────────────────────
# Private on purpose. The rule that the capture happens once, in `begin()`, on
# the caller's thread is only enforceable while the read is in one place — a
# caller holding the ContextVar itself would be free to read it from a sending
# thread, which is the failure described at the top of this file. Set through
# `set_org()`, read through `current_org()`.

_ORG_ID: ContextVar[str | None] = ContextVar("outbound_org_id", default=None)
_USER_ID: ContextVar[str | None] = ContextVar("outbound_user_id", default=None)


def set_org(org_id: str | None, user_id: str | None = None) -> None:
    """Name the org (and optionally the person) every send from here belongs to.

    For `middleware/org_resolver.get_org_id`, which is `async def` and therefore
    runs in the same task — and so the same context — as the endpoint it
    resolves for.

    IT DOES NOT UNSET, AND THAT IS ONLY SAFE WHILE SOMETHING MAKES A TASK. A
    task copies the context at creation, so a `set()` inside one cannot be seen
    outside it; uvicorn wraps every request in one, and every
    `BaseHTTPMiddleware` wraps everything downstream of it in another.
    `server.py` has four, so the deployed app and the test suite both have the
    boundary twice over.

    WHERE NOTHING MAKES A TASK THERE IS NO ISOLATION, and that is measured
    rather than assumed: a bare FastAPI app with no middleware, driven through
    `httpx.ASGITransport`, runs the endpoint in the CALLER'S context, and the
    org one request set is still there for the next. So:

      * A caller that cannot promise a task boundary — a bare app in a focused
        test, a worker loop, anything hand-rolled — should use `org_scope()`,
        which puts back what it found. As a FastAPI dependency that is one line:
            with outbound.org_scope(org_id, user["user_id"]):
                yield org_id
      * A test asserting on org attribution should set the org it means per
        request rather than inherit one, whichever shape the app under test is.

    `user_id` is `staging.outbound_log.user_id` — who CAUSED the send, which is
    a different column from `recipient` and a different type (TEXT, not UUID;
    see 098's note on migrations 030 and 092). It is optional because the org is
    the one that makes the table answer anything: every read filters on org.
    """
    try:
        if org_id is not None:
            _ORG_ID.set(str(org_id))
        if user_id is not None:
            _USER_ID.set(str(user_id))
    except Exception:                       # never the request's problem
        logger.debug("outbound: could not set the org context", exc_info=True)


@contextmanager
def org_scope(org_id: str | None, user_id: str | None = None):
    """`set_org()` that puts back what it found. Use it wherever that matters.

    Two callers. A scheduler tick, an automation run, a backfill script: there
    is no middleware underneath these and the org is a local variable, so the
    sends they cause would otherwise be the NULL-org rows this mechanism exists
    to stop — and a long-lived worker that merely `set()` org A would keep
    answering "org A" for org B's next job. And any request path that cannot
    rely on a task boundary to throw the value away for it.

    The reset is defended rather than trusted: `ContextVar.reset` raises
    ValueError when the token was created in a different Context, which is
    reachable if a caller straddles a task boundary between the two halves of
    the block. Attributing a send to the wrong org is a bug; taking down the
    request that noticed is a worse one.
    """
    org_token = _ORG_ID.set(str(org_id)) if org_id is not None else None
    user_token = _USER_ID.set(str(user_id)) if user_id is not None else None
    try:
        yield
    finally:
        for var, token in ((_USER_ID, user_token), (_ORG_ID, org_token)):
            if token is None:
                continue
            try:
                var.reset(token)
            except ValueError:
                # The block ended somewhere its own token does not belong. Fall
                # back to clearing, so the next caller inherits nothing.
                try:
                    var.set(None)
                except Exception:
                    pass
                logger.debug("outbound: org_scope could not reset %s", var.name)


def current_org() -> str | None:
    """The org a send started right now would be filed under, or None.

    Read it to check the wiring; do not read it to pass it somewhere else — the
    value is only trustworthy on the thread the request is running on, and
    `begin()` is the line that is guaranteed to still be there.
    """
    return _ORG_ID.get()


def current_user() -> str | None:
    """The user a send started right now would be attributed to, or None."""
    return _USER_ID.get()


class Attempt:
    """One outbound message, from the decision to send to the provider's answer.

    Created by `begin()`. Read `.blocked` to decide whether to proceed — it is
    the same boolean `suppressed()` returns. Call `.sent()` or `.failed()` when
    the provider answers; both are safe from a background thread, and both are
    safe to skip.
    """

    __slots__ = ("id", "blocked", "_fields", "_closed")

    def __init__(self, blocked: bool, fields: dict):
        self.id = fields["id"]
        self.blocked = blocked
        self._fields = fields
        # A suppressed message has no second half — nothing was handed to a
        # provider, so nothing can come back to report.
        self._closed = blocked

    def sent(self, message_id: str | None = None, *,
             provider: str | None = None, bytes: int | None = None) -> None:
        """The provider ACCEPTED it. `message_id` is the receipt.

        Accepted is not arrived. SES takes a message and bounces it seconds
        later against the sending identity's reputation, which is what happened
        to 960 payslips addressed to `@example.com`. This marks acceptance; a
        bounce is a later fact about the same row.
        """
        self._finish(outbound_log.STATUS_SENT, provider=provider,
                     message_id=message_id, bytes=bytes)

    def failed(self, error, *, provider: str | None = None) -> None:
        """The provider or the transport refused it."""
        self._finish(outbound_log.STATUS_FAILED, provider=provider,
                     error=f"{type(error).__name__}: {error}"
                     if isinstance(error, BaseException) else error)

    def _finish(self, status: str, **changed) -> None:
        try:
            if self._closed:
                return                      # first answer wins; no double count
            self._closed = True
            # The whole row, not a delta — the writer may not have inserted the
            # attempt yet, and if it has not the two collapse into one INSERT.
            # Which is also why `org_id` and `user_id` are carried here rather
            # than re-derived: this runs in the sending thread, where the
            # request's context does not exist, and re-deriving would replace
            # what `begin()` captured with None.
            fields = dict(self._fields)
            fields["status"] = status
            for key, value in changed.items():
                if value is not None:
                    fields[key] = value
            outbound_log.write(**fields)
        except Exception:                   # never the sender's problem
            logger.debug("outbound: completing a log row failed", exc_info=True)


def begin(channel: str, target: str = "", detail: str = "", *,
          org_id: str | None = None, user_id: str | None = None,
          ref: str | None = None, bytes: int | None = None,
          purpose: str | None = None, context: dict | None = None) -> Attempt:
    """Open the gate and record the attempt. Returns a handle, never raises.

    `detail` is the subject or the title — never a body, and for social it is
    not stored at all: what a publisher passes there is an excerpt of the
    client's own post. `bytes` is the payload size where the sender knows it:
    SES bills in 256 KB units, so a payslip PDF is what actually costs money and
    a count of rows is not a count of the bill. `ref` is what caused the send —
    'payslip:PS-2026-08-42' — which also gives the row its `purpose`. `context`
    is names of things (a run id, a device count), never contents of things.

    `org_id` and `user_id` fall back to the request context when the caller does
    not pass them, which is how the fourteen senders that have no org parameter
    get one. See WHOSE SEND WAS IT at the top of this file: this line is the
    capture point, and it is the last line guaranteed to be running on the
    thread the request is on.
    """
    blocked = DRY_RUN                       # read now, so a test may patch it

    # THE CAPTURE. Here and nowhere downstream — `email_service` starts a
    # `threading.Thread` immediately after this returns, and a plain Thread has
    # an empty context, so a read from in there would produce None AND would
    # overwrite the value taken here when the completion supersedes the attempt.
    # An explicit argument wins: a caller that knows better than the request —
    # a platform job sending on behalf of an org it was handed — must not have
    # its answer replaced by whichever org happened to be resolved.
    if org_id is None:
        org_id = _ORG_ID.get()
    if user_id is None:
        user_id = _USER_ID.get()

    fields = {
        "id": uuid.uuid4(),
        "ts": datetime.now(timezone.utc),
        "channel": channel,
        "target": target,
        "subject": detail,
        "status": (outbound_log.STATUS_SUPPRESSED if blocked
                   else outbound_log.STATUS_QUEUED),
        "mode": "dry" if blocked else "live",
        "org_id": org_id,
        "user_id": user_id,
        "ref": ref,
        "bytes": bytes,
        "purpose": purpose,
        "detail": context,
        "provider": None,
        "message_id": None,
        "error": None,
    }
    att = Attempt(blocked, fields)

    try:
        if blocked:
            # ASCII only: these lines are read in Railway logs and in a Windows
            # console, and a non-UTF8 terminal turns a nice arrow into mojibake.
            logger.warning(
                "OUTBOUND[dry] suppressed %s -> %s%s",
                channel, target or "(no target)", f" | {detail}" if detail else "",
            )
        # The live case gets no log line. Railway rotates logs per deployment,
        # which is why the August history is gone; the row is the record.
        outbound_log.write(**fields)
    except Exception:
        logger.debug("outbound: recording an attempt failed", exc_info=True)

    return att


def suppressed(channel: str, target: str = "", detail: str = "", *,
               org_id: str | None = None, user_id: str | None = None,
               ref: str | None = None, bytes: int | None = None,
               purpose: str | None = None, context: dict | None = None) -> bool:
    """True if this send must not go out. Records the attempt either way.

    Call as the first line of a sender:

        if suppressed("email", to_email, subject):
            return True

    The keyword arguments are all optional and all worth passing — `org_id`
    turns the log into a per-client answer, `bytes` into a per-client bill.
    Nothing breaks without them; the row is simply less useful. `org_id` and
    `user_id` come from the request context when they are not passed, so a
    sender that cannot reach them — `email_service.send_email` has no org
    parameter and no caller could give it one — is still filed under an org.

    A sender that can report what the provider said should call `begin()`
    instead and keep the handle. This stays the floor: every sender in the
    product already calls it, so every sender is already logged.
    """
    return begin(channel, target, detail, org_id=org_id, user_id=user_id,
                 ref=ref, bytes=bytes, purpose=purpose, context=context).blocked


@contextmanager
def sending(channel: str, target: str = "", detail: str = "", **kwargs):
    """`begin()` scoped to a block, so the failure branch cannot be forgotten.

    Yields the `Attempt`. An exception out of the body is recorded as `failed`
    and re-raised — the sender's error is still the sender's to handle. A body
    that neither reports nor raises leaves the row `queued`, because "the
    block finished" is not evidence the provider accepted anything.
    """
    att = begin(channel, target, detail, **kwargs)
    try:
        yield att
    except BaseException as exc:
        att.failed(exc)
        raise
