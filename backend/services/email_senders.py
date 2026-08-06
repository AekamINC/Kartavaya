"""
services/email_senders.py — WHICH ADDRESS DOES THIS MESSAGE LEAVE FROM.

Today, every message in the product leaves from ONE address: `FROM_EMAIL`, a
Railway environment variable, read as a module constant by the three senders
that put a From on the wire (`email_service.send_email` on both its Resend and
its SES branch, `email_service.send_report_email`, and the payslip sender in
`services/employee_email.py`). A payslip, a marketing campaign and a password
reset all arrive from the same place.

SENDER REPUTATION AND DELIVERABILITY ARE PER-ADDRESS. Mixing marketing with
transactional on one address means the marketing can cost you the payslips: a
recipient who marks a campaign as spam, or a campaign that accumulates enough
complaints to move the address's standing at the receiving domain, degrades
delivery for everything else sent from it. The payslip is the message that MUST
arrive. Today it is underwritten by the reputation of the campaign.

Migration 110 gives an org one row per purpose. This module turns "which
notification is this" into "which address does it leave from", and falls back
to `FROM_EMAIL` at every point where it does not have a confident answer.

── THE FALLBACK IS THE FEATURE, NOT THE ERROR PATH ──────────────────────────

THERE ARE THREE ORGS AND ZERO CONFIGURED SENDERS, AND MIGRATION 110 IS NOT
APPLIED. So on the day this ships, EVERY path through this module returns
`FROM_EMAIL` and not one message changes. That is the intended behaviour and it
is what makes the change safe to deploy: an org with no rows must keep sending
exactly as it does today, or this breaks mail for every existing org.

There are five distinct ways to arrive at the fallback, and
`tests/test_email_senders.py` pins each one separately rather than pinning "it
works", because they fail independently and four of the five are live right now:

    1. the notification has no purpose at all           -> FROM_EMAIL
    2. the purpose maps to no bucket (`_BUCKET` miss)   -> FROM_EMAIL
    3. the org has no row for that bucket               -> FROM_EMAIL
    4. the row exists but `is_verified` is false        -> FROM_EMAIL
    5. the table is missing, or the lookup fails or
       times out, or there is no org context at all     -> FROM_EMAIL

Nothing in here raises. A sender that cannot decide which address to use must
send from the address it has always used, not fail.

── TWO PURPOSE VOCABULARIES, AND THE MAP BETWEEN THEM LIVES HERE ────────────

`send_email` already takes a `purpose`, and this module deliberately reuses it
rather than adding a second parameter beside it. What that parameter does today
is name the row in `staging.outbound_log` — 'payslip', 'prachar_sequence',
'password_reset' — and 098 argues at length for keeping that set OPEN and
unchecked, because a new notification must not need a migration.

Migration 110's `purpose` is a different thing wearing the same word. It is
CLOSED, nine values, one per address the owner provisioned, and it names A
REPUTATION rather than a notification. `_BUCKET` below is the map from the ~30
open values to the nine closed ones, and it is here rather than in SQL for
exactly 098's reason: it changes every time somebody adds an email to the
product, and a migration per notification is the cost that stops people
bothering.

A purpose with no entry in `_BUCKET` is not an error. It is case 2 above and it
sends from FROM_EMAIL, which is what it did before this module existed. What
makes that safe rather than sloppy is `test_every_purpose_in_the_codebase_maps`,
which walks the AST of every backend source file, collects every literal
`purpose="…"` keyword argument, and fails if one of them is unmapped. AST, not
grep — a grep over this file matches its own explanation, and `_BUCKET`'s keys
are quoted strings in exactly the shape a grep for `purpose="…"` would collect.

── WHERE THIS RUNS, WHICH IS THE WHOLE SUBTLETY ─────────────────────────────

READ `outbound.py`'s "WHOSE SEND WAS IT" BEFORE CHANGING ANYTHING BELOW. The
org this message belongs to lives in a ContextVar that the request middleware
set, and it is readable ONLY on the caller's thread. `email_service.send_email`
hands the message to a `threading.Thread` immediately, and a plain Thread starts
with an EMPTY context — every ContextVar reads its default in there.

So the work is split across the same boundary `outbound.begin()` already
straddles, and for the same reason:

    plan(purpose, FROM_EMAIL)   ON THE CALLER'S THREAD. Reads the org from the
                                context and captures the event loop. Cheap:
                                two ContextVar reads and a dict lookup, no I/O,
                                no lock.

    Plan.resolve()              IN THE SENDING THREAD, immediately before the
                                From header is built. May block on a database
                                round-trip — which is FREE there, because that
                                thread exists precisely to do slow I/O and the
                                request has already returned.

Doing the lookup in `plan()` instead would put a query on the request path for
every email. Doing the context read in `resolve()` instead would read an empty
context and file every send under no org — silently, because a ContextVar read
from the wrong place does not raise, it returns None. That is the exact defect
`tests/test_outbound_org_context.py` exists to prevent, in a new shape.

`resolve()` DEFENDS AGAINST BEING CALLED ON THE LOOP THREAD ANYWAY. Blocking on
a future you submitted to the loop you are running on is a deadlock, not a slow
path, and it would hang the whole worker. If a running loop is detected it
refuses to block, schedules the load in the background and returns the fallback
for this one message.

── THE CACHE ────────────────────────────────────────────────────────────────

Nine rows per org, read on every send, changed when somebody edits a form. So
it is cached per org for `_TTL` seconds and the settings screen calls
`invalidate()` on save, which makes an edit visible immediately for the path
that can know about it. A hand-written UPDATE (migration 110 step 5 flips
`is_verified` by hand, deliberately) is NOT visible until the TTL expires, and
110 says so where somebody running that statement will read it.

Single-flight: a payroll run mails 71 payslips from 71 threads, all of which
miss a cold cache at the same instant. Without it that is 71 identical queries;
with it, one query and 70 threads waiting on its future.

── DORMANCY, COPIED FROM services/outbound_log.py ───────────────────────────

Migration 110 is a FILE and is not applied. Until it is, this table does not
exist and every read raises `42P01 undefined_table`. Retrying that per send
would be a query per email, for ever, all of them failing.

So the four SQLSTATEs that mean "the table is not what we were promised" set
`_dormant` and this module stops asking, after ONE warning. Transient failures
— a pool blip, a timeout — deliberately do NOT set it: a database that is
merely down must not permanently disable a feature.

THE FLAG IS PER PROCESS AND NOTHING RESETS IT, which is why 110's verification
block says REDEPLOY THE BACKEND after applying it. Same trap as 098.
"""

import asyncio
import concurrent.futures
import logging
import re
import threading
import time
from typing import Mapping, NamedTuple

log = logging.getLogger(__name__)


# ── The nine ─────────────────────────────────────────────────────────────────
# The local parts of the nine addresses the owner provisioned on
# unicodegroup.com, verbatim and lowercase. These ARE the values in migration
# 110's `org_email_senders_purpose_ck`, and `tests/test_email_senders.py`
# asserts the two lists are character-identical by reading the .sql file —
# because the failure of a disagreement is silent. A row filed under a purpose
# this tuple does not contain is not a wrong From; it is no From at all, and the
# settings screen would still show the address as configured.
#
# WRITTEN OUT LITERALLY, and the test asserts on this literal rather than on
# "whatever the CHECK contains". A set derived from the constraint would agree
# with the constraint by construction and could never detect it widening.
#
# THE HYPHEN IN 'no-reply' IS PART OF THE VALUE. It is the mailbox name.
SENDER_PURPOSES: tuple[str, ...] = (
    "invoice",
    "sales",
    "payroll",
    "crm",
    "notifications",
    "attendance",
    "hr",
    "marketing",
    "no-reply",
)

#: Human labels for the settings screen, kept here so the screen and the
#: resolver cannot disagree about what a bucket is for. The router serves this
#: to the frontend rather than the frontend hard-coding nine strings that would
#: then drift from `_BUCKET`.
PURPOSE_LABELS: dict[str, str] = {
    "invoice": "Invoices and payment reminders",
    "sales": "Quotations, sales orders and customer correspondence",
    "payroll": "Payslips and salary advances",
    "crm": "Leads, contacts and client conversations",
    "notifications": "Task, approval, reminder and report notifications",
    "attendance": "Shifts, rosters and attendance",
    "hr": "Leave, expenses, announcements, assets and reviews",
    "marketing": "Campaigns and marketing sequences",
    "no-reply": "Sign-in, invites and password resets",
}


# ── The map: one notification purpose -> one reputation ──────────────────────
# The left-hand side is `outbound_log.purpose` — what `send_email(purpose=…)`
# already passes, plus the heads of the `ref=` strings whose first segment
# becomes the purpose (`outbound._row`: 'payslip:PS-2026-08-42' -> 'payslip').
# The right-hand side is one of `SENDER_PURPOSES`.
#
# A KEY THAT IS ABSENT IS NOT A BUG. It sends from FROM_EMAIL, which is what it
# did before this file existed. What would be a bug is nobody NOTICING that a
# new notification is unmapped, and that is what the AST test catches.
#
# THREE BUCKETS HAVE NO SENDER AT ALL TODAY — 'invoice', 'sales' and 'crm'. The
# product does not email an invoice, a quotation or a CRM contact from any code
# path; Ganit, Vikray and Graha all render documents and none of them send. The
# addresses are provisioned for mail that does not exist yet, and that is worth
# knowing before anybody concludes the feature is only two-thirds wired.
_BUCKET: dict[str, str] = {
    # ── payroll ──────────────────────────────────────────────────────────────
    # The message this whole change is for. `services/employee_email.py` mails
    # every employee a payslip with a PDF on every payroll run — 960 of them in
    # one August — and it is the one send where a delivery failure has a
    # statutory shape rather than an inconvenient one.
    "payslip": "payroll",
    # A salary advance is deducted from the payslip and is administered in the
    # same module by the same people. It belongs on the same reputation.
    "loan_update": "payroll",

    # ── hr ───────────────────────────────────────────────────────────────────
    "leave_decision": "hr",
    "expense_decision": "hr",
    "announcement": "hr",
    "asset_assignment": "hr",
    "performance_review": "hr",

    # ── attendance ───────────────────────────────────────────────────────────
    # Shift assignment is the rostering half of attendance, not the HR half:
    # it is sent by Pahchan/attendance to the person who has to turn up.
    "shift_schedule": "attendance",

    # ── marketing ────────────────────────────────────────────────────────────
    # THE SEPARATION THAT MATTERS MOST. Everything else in this map could be
    # collapsed onto one address without much harm; these two could not.
    "prachar_campaign": "marketing",
    "prachar_sequence": "marketing",
    # `social_publisher` — channel 'social', not email, so it never reaches a
    # From header. Mapped anyway so the AST test does not have to special-case
    # a purpose it can see in the source, and because if social publishing ever
    # grows an email leg it is marketing.
    "publish": "marketing",

    # ── no-reply ─────────────────────────────────────────────────────────────
    # Account and credential mail. Sent before any org context exists in most
    # cases — an invite and a password reset are both pre-tenancy — so these
    # will usually fall back for want of an org rather than for want of a row.
    # Mapped correctly regardless: the org-less case is a property of WHERE
    # they are sent from, not of what they are.
    "invite": "no-reply",
    "welcome": "no-reply",
    "password_reset": "no-reply",

    # ── notifications ────────────────────────────────────────────────────────
    # The generic operational bucket: something happened in the product and
    # somebody is being told.
    "task_assigned": "notifications",
    "task_done": "notifications",
    "task_reminder": "notifications",
    "reminder": "notifications",
    "comment": "notifications",
    "mention": "notifications",
    "status_changed": "notifications",
    "approval_request": "notifications",
    "approval_decision": "notifications",
    "request_approved": "notifications",
    "client_approved": "notifications",
    "report": "notifications",
    "automation": "notifications",
    # A customer asking Aekam to switch a skill on for their org
    # (`routers/hub.py:request_skill`). Approval-shaped internal traffic — it
    # goes to the account contact and it asks them to do something — so it is
    # 'notifications' and emphatically NOT 'marketing': a recipient who
    # unsubscribes from campaign mail must not stop hearing that their own
    # colleague asked for a skill.
    "skill_request": "notifications",

    # E-SIGNATURE, AND THE COMPROMISE IN IT. A signature request goes to a
    # counterparty who may well reply to it, so 'no-reply' is wrong. There is no
    # 'legal' or 'documents' address among the nine, so 'notifications' is where
    # it lands. All three signing purposes go to the SAME bucket deliberately —
    # the request, the OTP and the reminder are one conversation, and a
    # recipient who sees three different senders for one signing has been given
    # three reasons to distrust it.
    #
    # If signature traffic should carry its own reputation, that is a tenth
    # address to buy and verify, then one line here and one in 110's CHECK.
    "signature_request": "notifications",
    "signature_reminder": "notifications",
    "signing_otp": "notifications",

    # THE NOTICE THAT SUPPORT ACCESS WAS OPENED, sent to the customer's owner in
    # the same transaction that opens it (`services/support_session.py`). It
    # tells the recipient that a stranger can now see their records, so it must
    # arrive, and it must NEVER carry marketing's reputation — a customer who
    # unsubscribed from campaign mail has not consented to stop being told who
    # is in their books. 'notifications' rather than 'no-reply' because the
    # owner may well reply to it, and because it is squarely "something happened
    # in the product and somebody is being told".
    "support_session": "notifications",
}


class Sender(NamedTuple):
    """One configured address. Exactly migration 110's four readable columns."""
    from_email: str
    from_name: str | None
    is_verified: bool


# ── Header safety ────────────────────────────────────────────────────────────
# Both values below are interpolated into an RFC 5322 `From:` header. A stored
# value containing CR or LF splits that header and lets the rest of the line be
# anything — `Bcc:`, a second `To:`, a forged `Reply-To:`.
# `email_service._safe_subject` exists because the same hole was closed on the
# Subject; this is the same hole on a field that is now user-editable.
#
# 110 CHECKs both columns, AND THAT IS THE TRIPWIRE, NOT THE BOUNDARY — 098's
# exact distinction. The boundary is here, on the read side, deliberately: this
# table can be written by a psql session, by a restore, or by an admin tool
# nobody has written yet, and only the read side is guaranteed to run before the
# header is built. Do not delete this because the CHECK exists.

#: The shape a From address must have. Same expression as 110's CHECK, stated
#: independently rather than derived from it, because they guard different
#: writers and a shared definition would make the DB-side one untestable from
#: here. Not an RFC 5322 parser and not trying to be: what it catches is
#: whitespace (which covers CR and LF), angle brackets, a bare local part, and a
#: domain with no dot.
_ADDR_RE = re.compile(r'^[^\s<>@,;:"]+@[^\s<>@,;:"]+\.[^\s<>@,;:"]+$')

#: Anything a display name may not contain. C0, DEL and C1 — every control
#: character, rather than an enumeration of CR and LF that invites somebody to
#: find a third.
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")

#: Long enough for any real company name, short enough that a pasted paragraph
#: cannot become a header line. Migration 110 CHECKs the same number.
MAX_NAME = 100


def is_address(value: str | None) -> bool:
    """Does this look like a bare address we could put in a From header.

    Public because `routers/org_profile.py` validates the form against the SAME
    rule, and a second regex written there would be a second answer to "is this
    a legal From" — which is precisely the class of disagreement this module
    exists to prevent between the schema and the code.
    """
    return bool(value) and bool(_ADDR_RE.match(str(value)))


def has_control_chars(value: str | None) -> bool:
    """True if this string would split a header. Public for the same reason."""
    return bool(value) and bool(_CTRL_RE.search(str(value)))


def bucket_for(purpose: str | None) -> str | None:
    """Which of the nine reputations a notification purpose belongs to.

    None when the purpose is missing or unmapped, which is a legitimate answer
    and means "send from FROM_EMAIL". PURE — this is the function worth testing
    directly, because the pool is mocked in tests and resolves any table name it
    is handed, so a test that goes through the database proves nothing about
    the decision.
    """
    if not purpose:
        return None
    return _BUCKET.get(str(purpose).strip().lower())


def format_from(from_email: str, from_name: str | None = None) -> str:
    """Build the `From:` value. Returns "" if the address is unusable.

    THE DISPLAY NAME IS ALWAYS QUOTED, even when it would not strictly need to
    be. An unquoted display name is an RFC 5322 *phrase* and may not contain
    specials — a comma, a full stop, a colon — so `Unicode Group, Inc.` is
    illegal bare and legal quoted. Deciding per name whether quoting is required
    is a rule with edges; always quoting has none, and every client renders it
    identically.

    PURE. Returning "" rather than raising is what lets every caller treat an
    unusable stored value as case 5 of the fallback list.
    """
    addr = _CTRL_RE.sub("", str(from_email or "")).strip()
    if not _ADDR_RE.match(addr):
        return ""

    name = _CTRL_RE.sub("", str(from_name or "")).strip()[:MAX_NAME]
    if not name:
        return addr
    # Escape the two characters that can close or escape the quoted string. In
    # that order: escaping the backslash after the quote would double-escape the
    # backslash this line just inserted.
    name = name.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{name}" <{addr}>'


def pick_from(configured: Mapping[str, Sender] | None,
              purpose: str | None,
              fallback: str) -> str:
    """The From header for this message, given the org's configured senders.

    PURE, AND IT IS THE FUNCTION THAT HOLDS THE DECISION. Everything around it
    is plumbing — a context read, a cache, a query — and all of it is mocked or
    absent in tests. This takes the rows as a plain mapping and answers.

    `configured` is bucket -> Sender, as `load()` returns it. `fallback` is
    `FROM_EMAIL`, passed in rather than imported so this module does not depend
    on `email_service` (which imports the senders that would import this).

    Returns `fallback` for every one of the five cases in this module's header.
    Never raises, never returns "".
    """
    bucket = bucket_for(purpose)
    if bucket is None:
        return fallback                     # case 1 and case 2

    sender = (configured or {}).get(bucket)
    if sender is None:
        return fallback                     # case 3

    if not sender.is_verified:
        # CASE 4, AND IT IS THE ONE PEOPLE WILL WANT TO REMOVE. An unverified
        # From is not a soft failure: Resend answers 403 "the domain is not
        # verified" and SES answers MessageRejected, so the message does not go
        # at all. Falling back means a wrong entry costs today's behaviour;
        # honouring it means a wrong entry costs the payslip.
        return fallback

    header = format_from(sender.from_email, sender.from_name)
    return header or fallback               # case 5: a stored value we cannot use


# ── Everything below is plumbing ─────────────────────────────────────────────

#: How long an org's nine rows are held. Long enough that a payroll run is one
#: query, short enough that migration 110's by-hand `is_verified` UPDATE takes
#: effect without a redeploy. The settings screen does not wait for it — its PUT
#: calls `invalidate()`.
_TTL = 300.0

#: How long a sending thread will block on a cold lookup before giving up and
#: using FROM_EMAIL. This is on a background thread and the request has already
#: returned, so it costs nobody's latency — but a provider call is waiting
#: behind it, and a message sent late from the right address is worse than a
#: message sent now from the old one.
_LOAD_TIMEOUT = 2.0

#: SQLSTATEs that mean the table is not what we were promised. Identical set and
#: identical reasoning to `services/outbound_log._DORMANT_CODES`: going quiet is
#: right for these and wrong for everything else.
_DORMANT_CODES = {
    "42P01",   # undefined_table        — migration 110 not applied
    "42703",   # undefined_column       — table exists, columns differ
    "3F000",   # invalid_schema_name    — no staging schema
    "42501",   # insufficient_privilege — the role cannot read it
}

_SELECT = """
SELECT purpose, from_email, from_name, is_verified
  FROM staging.org_email_senders
 WHERE org_id = $1::uuid
"""

_lock = threading.Lock()

#: org id -> (expires_at, bucket -> Sender)
_cache: dict[str, tuple[float, dict[str, Sender]]] = {}

#: org id -> the future of a load already running. Single-flight: 71 payslip
#: threads missing a cold cache together cost one query, not 71.
_inflight: dict[str, "concurrent.futures.Future"] = {}

#: The loop that owns the pool, captured whenever we are called from it — which
#: `plan()` is, on every request-driven send. Sending threads have no loop of
#: their own and this is the one they hand work to.
_loop: asyncio.AbstractEventLoop | None = None

#: Set when the table cannot exist as we understand it. Never set by a transient
#: failure. Per process, and nothing resets it: see DORMANCY in the header and
#: step 0 of migration 110's verification block.
_dormant = False


def _capture_loop() -> asyncio.AbstractEventLoop | None:
    """Remember the running loop if there is one, and return the best we have."""
    global _loop
    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        pass                                # a sync worker thread, or a script
    return _loop


class Plan:
    """A resolution that has captured its context and not yet done its I/O.

    Created by `plan()` ON THE CALLER'S THREAD, where the org is readable.
    Resolved by `resolve()` IN THE SENDING THREAD, where blocking is free. The
    split is the whole point of this class; see WHERE THIS RUNS in the module
    header before collapsing it into one call.
    """

    __slots__ = ("purpose", "fallback", "_org", "_loop")

    def __init__(self, purpose: str | None, fallback: str,
                 org_id: str | None, loop) -> None:
        self.purpose = purpose
        self.fallback = fallback
        self._org = org_id
        self._loop = loop

    def resolve(self) -> str:
        """The From header. Never raises, never returns "" — worst case, FROM_EMAIL."""
        try:
            if self._org is None or bucket_for(self.purpose) is None:
                # No org context, or a purpose with no bucket. Either way there
                # is nothing to look up, and a query would be a wasted
                # round-trip on the path a background thread is holding open.
                return self.fallback
            configured = _cached(self._org)
            if configured is None:
                configured = self._fetch()
            return pick_from(configured, self.purpose, self.fallback)
        except Exception:                   # never the sender's problem
            log.debug("email_senders: resolving the From failed", exc_info=True)
            return self.fallback

    def _fetch(self) -> dict[str, Sender] | None:
        """Load this org's rows, blocking briefly. None if we could not."""
        loop = self._loop
        if _dormant or loop is None or loop.is_closed():
            return None

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass                            # the normal case: a sending thread
        else:
            # WE ARE ON THE LOOP. Blocking on a future submitted to the loop we
            # are running on is a deadlock and would hang the worker, not slow
            # it. Warm the cache for the next message and use the fallback for
            # this one — a wrong-but-working From beats a hung request.
            _background(loop, self._org)
            return None

        try:
            return _submit(loop, self._org).result(timeout=_LOAD_TIMEOUT)
        except Exception:
            # Timeout, a cancelled loop, a failed query. All of them mean "we do
            # not know", and not knowing means FROM_EMAIL.
            return None


def plan(purpose: str | None, fallback: str,
         org_id: str | None = None) -> Plan:
    """Capture what only this thread can see. Call it where `begin()` is called.

    Cheap by construction — one ContextVar read and a dict lookup, no I/O, no
    lock — because it runs on the request path. The query happens in
    `Plan.resolve()`, in the sending thread.

    `org_id` falls back to the request context, and AN EXPLICIT ARGUMENT WINS —
    the same rule, spelled the same way, as `outbound.begin()`. A caller that
    knows better than the request must not have its answer replaced by whichever
    org happened to be resolved: `send_report_email` runs from the report cron,
    where there is no request underneath and the org is a local variable.

    `fallback` is passed in rather than imported: `email_service` owns
    `FROM_EMAIL` and imports this module, so importing it back would be a cycle,
    and reading the environment variable independently here would give two
    sources of truth for the one value that must never disagree.
    """
    if org_id is None:
        from outbound import current_org    # local: outbound imports outbound_log
        try:
            org_id = current_org()
        except Exception:
            org_id = None
    return Plan(purpose, fallback, str(org_id) if org_id else None,
                _capture_loop())


def invalidate(org_id: str | None) -> None:
    """Forget this org's cached senders. For the settings screen's PUT.

    Not a full clear: one org saving a form must not cost every other org a
    fresh query. A hand-written UPDATE — migration 110 step 5 flips
    `is_verified` by hand on purpose — cannot call this, which is why 110 says
    the change takes up to `_TTL` seconds to appear.
    """
    if not org_id:
        return
    with _lock:
        _cache.pop(str(org_id), None)


def _cached(org_id: str) -> dict[str, Sender] | None:
    with _lock:
        entry = _cache.get(org_id)
        if entry is None or entry[0] <= time.monotonic():
            return None
        return entry[1]


def _remember(org_id: str, senders: dict[str, Sender]) -> None:
    with _lock:
        _cache[org_id] = (time.monotonic() + _TTL, senders)


def _submit(loop, org_id: str) -> "concurrent.futures.Future":
    """One in-flight load per org. Returns the future to wait on."""
    with _lock:
        fut = _inflight.get(org_id)
        if fut is not None and not fut.done():
            return fut
        fut = asyncio.run_coroutine_threadsafe(load(org_id), loop)
        _inflight[org_id] = fut
    # Outside the lock: the callback fires on the loop thread and would
    # otherwise re-enter a lock this thread may still hold.
    fut.add_done_callback(lambda f, o=org_id: _forget_inflight(o, f))
    return fut


def _forget_inflight(org_id: str, fut) -> None:
    with _lock:
        if _inflight.get(org_id) is fut:
            _inflight.pop(org_id, None)


def _background(loop, org_id: str | None) -> None:
    """Warm the cache without waiting for it. For the on-the-loop case only."""
    if not org_id:
        return
    try:
        _submit(loop, org_id)
    except Exception:
        log.debug("email_senders: could not schedule a background load",
                  exc_info=True)


async def load(org_id: str) -> dict[str, Sender]:
    """Read an org's configured senders. Caches. Never raises.

    Public because the settings router reads the same nine rows to render the
    form, and a second query spelled slightly differently is how the screen and
    the sender start disagreeing about what is configured.

    An empty dict is a real answer — it is what every org returns today — and it
    is cached like any other, so an org with nothing configured costs one query
    per `_TTL` rather than one per email.
    """
    global _dormant
    org_id = str(org_id)

    cached = _cached(org_id)
    if cached is not None:
        return cached
    if _dormant:
        return {}

    try:
        from db import get_pool
        pool = await get_pool()
        rows = await pool.fetch(_SELECT, org_id)
    except Exception as exc:
        state = str(getattr(exc, "sqlstate", "") or "")
        if state in _DORMANT_CODES:
            with _lock:
                _dormant = True
            # ASCII only, same rule as `outbound.py`'s suppression line: read in
            # Railway logs and in a Windows console, where a nice arrow becomes
            # mojibake.
            log.warning(
                "email_senders: staging.org_email_senders is not readable (%s). "
                "Per-purpose From addresses are OFF for this process and every "
                "message will be sent from FROM_EMAIL, which is what happened "
                "before this feature existed. Apply migration 110 and redeploy.",
                state,
            )
        else:
            # Transient. Do NOT go dormant — a database that is merely down must
            # not permanently disable the feature. Not cached either, so the
            # next send retries.
            log.debug("email_senders: could not read the senders for %s",
                      org_id, exc_info=True)
        return {}

    senders: dict[str, Sender] = {}
    for row in rows or []:
        purpose = str(row["purpose"] or "").strip().lower()
        if purpose not in SENDER_PURPOSES:
            # Only reachable if 110's CHECK is absent or has been widened
            # without this tuple. Warn rather than drop silently: the row would
            # otherwise be configured, visible on the screen, and used by
            # nothing.
            log.warning(
                "email_senders: org %s has a sender row for purpose %r, which "
                "is not one of the nine this product knows about. It will never "
                "be used. Either 110's org_email_senders_purpose_ck is missing, "
                "or SENDER_PURPOSES needs widening in the same commit.",
                org_id, purpose,
            )
            continue
        senders[purpose] = Sender(
            from_email=str(row["from_email"] or ""),
            from_name=row["from_name"],
            is_verified=bool(row["is_verified"]),
        )

    _remember(org_id, senders)
    return senders


def _reset_for_tests() -> None:
    """Drop every piece of process state. Tests only.

    Named for what it is. The cache, the dormancy flag and the captured loop all
    outlive a single test, and a dormant flag set by one test would make the
    next one pass for the wrong reason — which is the failure mode this module
    is otherwise built to have.
    """
    global _dormant, _loop
    with _lock:
        _cache.clear()
        _inflight.clear()
        _dormant = False
        _loop = None

