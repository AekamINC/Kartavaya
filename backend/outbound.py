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
    OUTBOUND_SUPPRESSED_ORGS=<id>,<id>
                                   — suppress and log for THESE orgs only,
                                     whatever OUTBOUND_MODE says

── WHY A PER-ORG LIST EXISTS BESIDE THE MODE ────────────────────────────────

`OUTBOUND_MODE=live` went on staging on 2026-08-18 so real orgs could receive
real mail — and the same flip armed the E2E test org, whose data tables hold
~1,600 seeded `@example.com` addresses. RFC 2606 domains hard-bounce by
definition, so one payroll run or one campaign send from that org is hundreds
of bounces against the shared verified sender identity: the August incident
again, with the switch pointing the other way. The mode is all-or-nothing;
the list is the surgical version. An org on it is treated exactly as dry mode
treats everyone — the send stops at this same gate and the ledger records
`suppressed`, so the row is honest about what never left — while every other
org keeps sending. Same idiom as the mode: read at import, one comma-separated
env var, set on the service and never in code.

The org the gate checks is the SAME org the row is filed under — captured in
`begin()`, explicit argument first, request context second (see WHOSE SEND WAS
IT below). A send that reaches the gate with NO org — a password-reset from a
route that resolves no tenancy, a worker that never entered `org_scope()` —
cannot match the list and stays governed by `OUTBOUND_MODE` alone. That is the
honest reading: suppressing every unattributed send would silently kill
production password resets, and guessing an org is worse than the gap.

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

import asyncio
import logging
import os
import threading
import uuid
from collections import defaultdict
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


def _parse_suppressed_orgs(raw: str | None) -> frozenset[str]:
    """`OUTBOUND_SUPPRESSED_ORGS` -> canonical uuid strings, malformed entries
    dropped.

    Dropped WITH A LINE, not silently: an operator who typo'd the one org id
    the list exists for should find out at boot, not from a bounce report. But
    dropped nonetheless — a malformed entry must not take the module down with
    an import-time raise, and it must not widen into "suppress everything":
    this list is a scalpel, and a scalpel that fails open for one entry is
    still a working scalpel for the rest.

    Canonicalised through `uuid.UUID` so `{64E7BEA6-...}`, uppercase, and
    hyphenless spellings all match the same org, the same way `_as_uuid` in
    `services/outbound_log.py` reads the org on the row.
    """
    orgs = set()
    for part in (raw or "").split(","):
        text = part.strip()
        if not text:
            continue
        try:
            orgs.add(str(uuid.UUID(text)))
        except (ValueError, AttributeError):
            logger.warning(
                "OUTBOUND_SUPPRESSED_ORGS entry %r is not an org id and is "
                "IGNORED — sends from whatever it meant to name are NOT "
                "suppressed.", text,
            )
    return frozenset(orgs)


#: Read at import, like MODE. `begin()` re-reads the module global on every
#: call — same "read now, so a test may patch it" contract as DRY_RUN.
SUPPRESSED_ORGS = _parse_suppressed_orgs(os.getenv("OUTBOUND_SUPPRESSED_ORGS"))

if SUPPRESSED_ORGS:
    logger.warning(
        "OUTBOUND_SUPPRESSED_ORGS — email, push, social and WhatsApp are "
        "SUPPRESSED for %d org(s), whatever OUTBOUND_MODE says. Their sends "
        "are logged as 'suppressed' and never leave.", len(SUPPRESSED_ORGS),
    )


def _org_suppressed(org_id) -> bool:
    """True if this org is on the suppression list. Never raises.

    Reads `SUPPRESSED_ORGS` through the module so a test may patch it, exactly
    as `begin()` reads `DRY_RUN`. A non-uuid org id — 'platform', a slug, ''
    — cannot be on a list of uuids, so it answers False rather than raising:
    the gate must be incapable of failing a send (see `begin()`), and a send
    the product cannot attribute is governed by OUTBOUND_MODE alone.
    """
    if not SUPPRESSED_ORGS or org_id is None:
        return False
    try:
        return str(uuid.UUID(str(org_id))) in SUPPRESSED_ORGS
    except (TypeError, ValueError):
        return False


def is_suppressed(org_id=None) -> bool:
    """Would the gate stop a send for this org right now? Pure; never raises.

    THE PREDICATE BOOKKEEPING CALLERS MUST CONSULT. `send_email` (and every
    other sender) deliberately returns True on a suppressed message — the
    operator asked for nothing to leave, and the sender succeeded at doing
    nothing — so a return value cannot tell "delivered to a provider" from
    "stopped at the door". Callers that stamp their own status columns used
    to read `outbound.DRY_RUN` instead, which was right until the PER-ORG
    gate landed: a listed org's send in a live process is refused at
    `begin()` while `DRY_RUN` still reads False, so the caller writes
    status='sent', sent_at=NOW() over a message that never left. That is the
    module's own recorded disease — 1,562 reminders once said 'sent' while
    every matching outbound row said 'suppressed' — repeated one switch over.

    So: one predicate, both gates, same answer `begin()` will give. Pass the
    SAME org the send runs under (the explicit `org_id=` argument or the
    `org_scope()` the send is inside); None means "no attributable org",
    which only the mode can suppress — exactly `begin()`'s reading.

    Reads `DRY_RUN` and (via `_org_suppressed`) `SUPPRESSED_ORGS` through the
    module on every call, so a test may patch either — the same contract as
    `begin()`. Never raises: bookkeeping must not be able to fail a send
    path, so garbage in answers the mode alone rather than an exception.
    """
    try:
        return bool(DRY_RUN or _org_suppressed(org_id))
    except Exception:                       # pragma: no cover — belt only
        return bool(DRY_RUN)


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

    `suppressed_by` names WHICH gate blocked it — 'org' when the per-org list
    fired, 'dry' when the mode did, None when the send may proceed. Public on
    purpose: a caller whose own bookkeeping records the reason
    (`routers/whatsapp.py` stores it as `error_code`) must not have to guess
    from `DRY_RUN`, which is exactly the wrong answer for an org-suppressed
    send in a live process, and must not reach into `_fields` for it.
    """

    __slots__ = ("id", "blocked", "suppressed_by", "_fields", "_closed")

    def __init__(self, blocked: bool, fields: dict,
                 suppressed_by: str | None = None):
        self.id = fields["id"]
        self.blocked = blocked
        self.suppressed_by = suppressed_by
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

    # THE PER-ORG GATE, and it rides on the line above: the org it checks is
    # the SAME resolved org the row is filed under — explicit argument first,
    # request context second — so a channel is covered here for exactly the
    # reason the mode gate covers it: every sender's first statement is this
    # function, and a sender written next year is guarded without anyone
    # remembering to guard it. Checked AFTER the capture, never before, or an
    # org supplied by `org_scope()` would sail past the list.
    org_blocked = not blocked and _org_suppressed(org_id)
    if org_blocked:
        blocked = True

    # EMAIL CAP ENFORCEMENT. Checked after the org gate and before the row is
    # written, so a capped send is recorded as 'capped' in the ledger. The
    # check is sync and uses an in-memory counter + cached caps — no DB query
    # on the hot path.
    email_capped = False
    if not blocked and channel == "email" and org_id is not None:
        cap_result = _check_email_cap_sync(org_id)
        if cap_result == "blocked":
            blocked = True
            email_capped = True

    fields = {
        "id": uuid.uuid4(),
        "ts": datetime.now(timezone.utc),
        "channel": channel,
        "target": target,
        "subject": detail,
        "status": ("capped" if email_capped
                   else outbound_log.STATUS_SUPPRESSED if blocked
                   else outbound_log.STATUS_QUEUED),
        # Which switch the PROCESS was under, not which one fired — staging and
        # production write to the same schema and this key is what tells their
        # rows apart. An org-suppressed send in a live process is therefore
        # mode='live', status='suppressed': a true sentence about a message
        # that never left, and the pairing that distinguishes the org gate
        # from dry mode in the ledger.
        "mode": "dry" if DRY_RUN else "live",
        "org_id": org_id,
        "user_id": user_id,
        "ref": ref,
        "bytes": bytes,
        "purpose": purpose,
        # `detail` holds names of things. `suppressed_by: 'org'` is the name of
        # the switch that fired when it was NOT the mode, added on a COPY —
        # the caller's dict is the caller's.
        "detail": (dict(context or {}, suppressed_by="cap")
                   if email_capped
                   else dict(context or {}, suppressed_by="org")
                   if org_blocked else context),
        "provider": None,
        "message_id": None,
        "error": None,
    }
    att = Attempt(blocked, fields,
                  "cap" if email_capped
                  else "org" if org_blocked
                  else ("dry" if blocked else None))

    try:
        if blocked:
            # ASCII only: these lines are read in Railway logs and in a Windows
            # console, and a non-UTF8 terminal turns a nice arrow into mojibake.
            logger.warning(
                "OUTBOUND[%s] suppressed %s -> %s%s",
                "cap" if email_capped else "org" if org_blocked else "dry",
                channel, target or "(no target)", f" | {detail}" if detail else "",
            )
        # The live case gets no log line. Railway rotates logs per deployment,
        # which is why the August history is gone; the row is the record.
        outbound_log.write(**fields)

        # Increment the in-memory counter for non-blocked email sends, and
        # schedule a background alert check if the usage crossed 80%.
        if not blocked and channel == "email" and org_id is not None:
            _increment_email_counter(org_id)
            _maybe_schedule_alert(org_id)
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


# ── Email cap enforcement ─────────────────────────────────────────────────────
#
# Process-local, approximate counters. The caps themselves are cached from the
# DB with a TTL. This is a rate limit, not an accounting system — the billing
# view uses the actual DB counts.

_cap_lock = threading.Lock()

# org_id -> {"daily_cap": int|None, "monthly_cap": int|None,
#            "overage_rate": float|None, "loaded_at": float}
_cap_cache: dict[str, dict] = {}
_CAP_TTL = 300.0  # 5 minutes

# org_id -> {"daily": int, "monthly": int, "day": str, "month": str}
_email_counters: dict[str, dict] = defaultdict(
    lambda: {"daily": 0, "monthly": 0, "day": "", "month": ""}
)


def _today_keys() -> tuple[str, str]:
    """Return (day_key, month_key) in IST for period boundaries."""
    from datetime import timedelta
    now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    return now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")


def _increment_email_counter(org_id: str) -> None:
    """Bump the in-memory email counter for this org."""
    try:
        day_key, month_key = _today_keys()
        with _cap_lock:
            c = _email_counters[org_id]
            if c["day"] != day_key:
                c["daily"] = 0
                c["day"] = day_key
            if c["month"] != month_key:
                c["monthly"] = 0
                c["month"] = month_key
            c["daily"] += 1
            c["monthly"] += 1
    except Exception:
        pass


def _check_email_cap_sync(org_id: str) -> str | None:
    """Sync cap check using cached caps and in-memory counters.
    Returns 'blocked' if hard-capped, 'overage' if over cap with rate, None if OK.
    """
    import time
    try:
        with _cap_lock:
            cached = _cap_cache.get(org_id)

        if cached is None or (time.monotonic() - cached.get("loaded_at", 0)) > _CAP_TTL:
            return None  # no cached caps — allow (async warm will populate)

        daily_cap = cached.get("daily_cap")
        monthly_cap = cached.get("monthly_cap")
        overage_rate = cached.get("overage_rate")

        if daily_cap is None and monthly_cap is None:
            return None

        day_key, month_key = _today_keys()
        with _cap_lock:
            c = _email_counters[org_id]
            if c["day"] != day_key:
                c["daily"] = 0
                c["day"] = day_key
            if c["month"] != month_key:
                c["monthly"] = 0
                c["month"] = month_key
            daily_usage = c["daily"]
            monthly_usage = c["monthly"]

        exceeded = False
        if daily_cap is not None and daily_usage >= daily_cap:
            exceeded = True
        if monthly_cap is not None and monthly_usage >= monthly_cap:
            exceeded = True

        if exceeded:
            if overage_rate is not None:
                return "overage"
            return "blocked"
        return None
    except Exception:
        return None  # never block on a check failure


async def warm_email_caps(org_id: str) -> None:
    """Load an org's email caps into the process cache. Call from async context."""
    import time
    try:
        from db import get_pool
        pool = await get_pool()
        row = await pool.fetchrow(
            "SELECT email_cap_daily, email_cap_monthly, email_overage_rate "
            "FROM public.organisations WHERE id = $1::uuid",
            org_id,
        )
        if row:
            with _cap_lock:
                _cap_cache[org_id] = {
                    "daily_cap": row["email_cap_daily"],
                    "monthly_cap": row["email_cap_monthly"],
                    "overage_rate": float(row["email_overage_rate"]) if row["email_overage_rate"] is not None else None,
                    "loaded_at": time.monotonic(),
                }
    except Exception:
        logger.debug("outbound: warming email caps failed", exc_info=True)


def _maybe_schedule_alert(org_id: str) -> None:
    """If usage just crossed 80%, schedule an async alert in the background."""
    try:
        with _cap_lock:
            cached = _cap_cache.get(org_id)
        if not cached:
            return

        daily_cap = cached.get("daily_cap")
        monthly_cap = cached.get("monthly_cap")
        if daily_cap is None and monthly_cap is None:
            return

        day_key, month_key = _today_keys()
        with _cap_lock:
            c = _email_counters[org_id]
            daily_usage = c.get("daily", 0)
            monthly_usage = c.get("monthly", 0)

        should_alert_daily = (
            daily_cap is not None
            and daily_usage == int(daily_cap * 0.8)
        )
        should_alert_monthly = (
            monthly_cap is not None
            and monthly_usage == int(monthly_cap * 0.8)
        )

        if not should_alert_daily and not should_alert_monthly:
            return

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        if should_alert_daily:
            loop.create_task(_fire_cap_alert(org_id, "daily", day_key))
        if should_alert_monthly:
            loop.create_task(_fire_cap_alert(org_id, "monthly", month_key))
    except Exception:
        pass


async def _fire_cap_alert(org_id: str, cap_type: str, period_key: str) -> None:
    """Send the 80% cap alert email if not already sent for this period."""
    try:
        from db import get_pool
        from services.email_caps import record_alert

        pool = await get_pool()
        is_new = await record_alert(pool, org_id, cap_type, period_key)
        if not is_new:
            return

        org = await pool.fetchrow(
            "SELECT name, email_cap_daily, email_cap_monthly, email_overage_rate "
            "FROM public.organisations WHERE id = $1::uuid",
            org_id,
        )
        if not org:
            return

        cap = org[f"email_cap_{cap_type}"]
        if cap is None:
            return

        from services.email_caps import email_usage
        usage = await email_usage(pool, org_id)
        current = usage.get(cap_type, 0)

        overage_rate = float(org["email_overage_rate"]) if org["email_overage_rate"] is not None else None
        org_name = org["name"]

        recipients = await _get_alert_recipients(pool, org_id)

        from email_service import send_email

        overage_line = (
            f"Emails beyond the cap will be billed at ₹{overage_rate:.2f} per email."
            if overage_rate is not None
            else "Emails beyond the cap will be blocked."
        )

        subject = f"[Kartavaya] {org_name} — {cap_type} email cap at {int(current/cap*100)}%"
        html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a;">Email Cap Alert</h2>
            <p><strong>{org_name}</strong> has used <strong>{current}</strong> of
            <strong>{cap}</strong> {cap_type} emails ({int(current/cap*100)}%).</p>
            <p>Remaining: <strong>{cap - current}</strong> emails.</p>
            <p>{overage_line}</p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 20px 0;">
            <p style="color: #666; font-size: 13px;">This is an automated alert from Kartavaya.</p>
        </div>
        """
        for email in recipients:
            send_email(email, subject, html, purpose="email_cap_alert")
    except Exception:
        logger.debug("outbound: cap alert failed for %s", org_id, exc_info=True)


async def _get_alert_recipients(pool, org_id: str) -> list[str]:
    """Get email addresses of org owner + admins, plus the Aekam admin."""
    recipients = []
    try:
        # `ur.role_code`, NOT `ur.role`. There has never been a `role` column on
        # user_roles — its columns are (id, user_id, org_id, role_code,
        # granted_by, granted_at, updated_at, updated_by). This query therefore
        # raised 42703 on every single call, the `except` below swallowed it, and
        # the org's owners and admins have never once been told their email cap
        # was running out; only AEKAM_ADMIN_EMAIL ever got the alert.
        #
        # The table halves are right and load-bearing: `users` lives in `public`
        # only, `user_roles` moves to `public` with migration 241, and both
        # user_id columns are `text`. Measured against the live catalogue
        # 2026-08-29 — the corrected query returns 7/6/5/4/1 recipients for the
        # five orgs that have any, where the old one returned none, ever.
        rows = await pool.fetch(
            "SELECT DISTINCT u.email FROM public.user_roles ur "
            "JOIN public.users u ON u.user_id = ur.user_id "
            "WHERE ur.org_id = $1::uuid AND ur.role_code IN ('org_owner', 'org_admin') "
            "AND u.email IS NOT NULL",
            org_id,
        )
        for r in rows:
            if r["email"]:
                recipients.append(r["email"])
    except Exception:
        # MUST NOT RAISE, but MUST NOT BE SILENT EITHER.
        #
        # Not raising is deliberate: the fallback below still yields
        # AEKAM_ADMIN_EMAIL, so a broken lookup degrades from "everyone is told"
        # to "Aekam is told" rather than losing the alert altogether. This runs
        # inside the outbound email path; letting it propagate would turn a
        # cap-alert lookup failure into a failure of the send that triggered it.
        #
        # The silence is what has to go. `except Exception: pass` is the only
        # reason a query that could never succeed survived in production — there
        # was no symptom to notice. exc_info=True at exception level, matching
        # _fire_cap_alert's own handler, so the next such bug shows up in Sentry
        # on its first call instead of being found by reading the source.
        logger.exception("outbound: cap alert recipient lookup failed for %s", org_id)

    import os
    aekam_admin = os.getenv("AEKAM_ADMIN_EMAIL", "admin@aekaminc.com")
    if aekam_admin not in recipients:
        recipients.append(aekam_admin)

    return recipients
