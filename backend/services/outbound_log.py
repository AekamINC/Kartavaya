"""
services/outbound_log.py — the ONE writer of `staging.outbound_log`.

The rule `services/credits.py` holds for the four credit tables and
`services/billing_lines.py` holds for `org_billing_lines`, applied to the table
that says WHAT LEFT THE BUILDING.

WHY THIS FILE EXISTS. AWS said 2,586 of 3,000 SES message units were used in
August. The question "how many emails have you sent?" took an hour to answer by
inference from payslip rows, and the answer was still only a floor — because
nothing in this product recorded a send. What the inference eventually found:
`routers/vetana.py` mails every employee a payslip with a PDF attached on every
payroll run, the E2E suite ran payroll 16 times against an org with 71
employees, and all 960 went to `@example.com` — undeliverable by definition, so
960 hard bounces against the shared SES identity. Nobody could see it happening
while it happened, and Railway rotates logs per deployment, so the only other
record of it is gone.

A log that lives in stdout answers nothing a month later. This one is a table.

── THE RULE ─────────────────────────────────────────────────────────────────

No file outside this one may INSERT, UPDATE or DELETE `staging.outbound_log`.
Reads are open — a screen or a report may SELECT it freely — because a wrong
read is a wrong number on one page, while a second writer is what makes the
ledger itself untrustworthy. If a caller needs a field written, the fix is a
parameter here, not an INSERT there.

── THIS MODULE IS A TRANSLATOR, AND THAT IS THE POINT ───────────────────────

Senders speak in the vocabulary of `outbound.suppressed()`, which has been the
choke point since long before this table existed: `channel="push:expo"`,
`channel="social:facebook"`, a `detail` string, a `mode`. Migration 098's table
speaks in four checked channels, a separate `provider`, and no `mode` column at
all. Both vocabularies are right for their side, and 098's header asks the
writer module to do the mapping rather than ask fourteen senders to learn a
schema:

    "push:expo"        -> channel 'push',     provider 'expo'
    "social:facebook"  -> channel 'social',   provider 'meta'
    STATUS_ATTEMPTED   -> status  'queued'
    ref "payslip:PS-1" -> purpose 'payslip',  detail.ref 'PS-1'
    mode "dry"         -> detail.mode 'dry'

Every one of those is a name one side has and the other does not, which is the
defect this repository keeps paying for. They are reconciled HERE, in one file,
where a mismatch is a test failure rather than a lost row.

── NO BODIES ────────────────────────────────────────────────────────────────

098 makes `outbound_log_no_body_ck` refuse four obvious key names in `detail`
and then says plainly that the constraint is a tripwire and not a boundary, and
that this module must strip content BEFORE it gets there. So:

  * `subject` is clipped to 200 characters and stored in `subject_or_title`.
  * FOR SOCIAL IT IS DROPPED ENTIRELY. `services/social_publisher._guarded`
    passes `(text or "")[:80]` as its detail — the first 80 characters of a
    customer's own post, through a customer's own OAuth token. That is fine in
    a Railway log line that rotates away and is NOT fine in a column that is
    kept for 400 days and read by support. A social post has no subject and
    NULL is the correct value, not missing data.
  * The four forbidden `detail` keys are removed here, not refused there. A
    caller that passes one gets a row without it rather than a lost row and a
    constraint error nobody sees.

── WHY SIZE ─────────────────────────────────────────────────────────────────

SES bills in 256 KB units. A 40 KB notification and a 900 KB payslip PDF are one
row each and four message units apart, so a count of rows is not a count of the
bill. `bytes` is what makes the invoice reconcilable, and it is exactly the
figure the owner could not see.

── WHAT A ROW COSTS ─────────────────────────────────────────────────────────

Nothing on the request path. `write()` never touches the database, never blocks
and never raises: it buffers in memory and returns. A batch is flushed on the
event loop, one statement for however many rows accumulated, so a payroll run
that mails 71 payslips writes once and not 71 times. A logging failure drops the
batch and warns at most once a minute — an email that did not go because the log
was down would be a worse product than no log at all.

── QUEUED, AND HOW A ROW IS COMPLETED ───────────────────────────────────────

`email_service.send_email` hands the message to a thread and returns before the
provider is called, so the outcome exists only inside that thread. 098 argues
for recording the attempt as 'queued' first — a row still queued an hour later
is itself the finding — and completing it in place afterwards.

Completing it in place needs the row's key, and 098's key is
`BIGINT GENERATED ALWAYS AS IDENTITY`: the database assigns it, so a caller
cannot know it in advance and there is no ON CONFLICT to upsert against. That
is the right call for the highest-insert table in the product — a random UUID
key scatters every insert across the whole index — and it is why this module
carries a correlation id of its own:

  * Callers pass a process-local `id` (a uuid). It is NOT the primary key.
  * If the outcome arrives before the flush — the common case, because a send
    takes milliseconds — the two collapse in memory and ONE row is inserted
    carrying the final status. No 'queued' row is ever written, and 098's
    "~20% index-write premium on email rows" is not paid at all.
  * If the outcome arrives after the flush, the correlation id is read back
    from `detail->>'event'` alongside the assigned BIGINT, and the completion
    becomes an UPDATE by primary key.

The correlation id is written into `detail` only for rows that can still be
completed, so a row that is already final costs nothing to carry it. It is read
back explicitly rather than by zipping RETURNING against the input order,
because that order is not guaranteed and the failure would be a provider's
message id filed against somebody else's email.

── THE WINDOW BETWEEN THOSE TWO, WHERE ONE MESSAGE BECAME TWO ROWS ──────────

Reading the assigned BIGINT back takes a round-trip, and for the whole of that
round-trip the attempt is in NEITHER map: `_take()` has popped it out of
`_pending`, and `_remember()` cannot put it in `_open_rows` until the INSERT
answers. A completion arriving inside that window found its id nowhere, fell
through to the last branch of `write()`, and was buffered as a FRESH row. So the
attempt stayed 'queued' for ever, the outcome became a second independent row,
and BOTH were counted.

MEASURED, not reasoned about: 300 payslips, each completed from its own thread
with the provider answering in 120 ms, against the writer's real statements.
By database round-trip — 20 ms: 300 rows, none duplicated. 50 ms: 412 rows, 112
duplicated and 112 left 'queued' for ever. 150 ms: 537 rows, 237 duplicated and
237 left 'queued'. The 20 ms column is clean only because this workload never
happens to overlap at that speed; the overlap itself does not care about the
latency, and forced deterministically it duplicated there too.

It bit hardest exactly where the log matters most — a slow database, a deploy
burst, a 71-payslip payroll run — and it poisoned permanently, because after the
fact a duplicate is indistinguishable from a genuine second send and the
retention is 400 days. It falsified `outbound.py`'s "a count of rows stays a
count of messages", which is the sentence the whole table is for.

So the window is NAMED rather than hoped over. `_take()` moves an open row's
correlation id into `_inflight` in the same locked section that removes it from
`_pending` — there is no instant in which `write()` can see neither — and a
completion for an id that is in flight is PARKED instead of buffered. Every id
`_take()` puts in flight is settled exactly once, in `_write_batch`'s `finally`,
so a parked completion cannot outlive the round-trip that parked it:

  * THE INSERT ANSWERED AND THE KEY CAME BACK. The parked completion becomes an
    UPDATE of the row just inserted. One message, one row, final status.
  * THE INSERT NEVER LANDED — no pool, a deadlock, a row rejected in the
    one-by-one salvage. There is nothing in the table to update, so the parked
    completion goes back into `_pending` and is inserted as the message's ONE
    row, already final. Not a duplicate: the attempt row does not exist. This is
    also exactly what the buggy code happened to do on this path, so a failed
    drain loses nothing it did not lose before.
  * THE INSERT LANDED BUT ITS KEY DID NOT COME BACK — `_remember` itself failed,
    or a `_MAX_OPEN` eviction dropped it. The 'queued' row is in the table under
    a key nobody holds, so the outcome cannot be recorded at all. It is DROPPED
    AND COUNTED, because an under-count `dropped()` declares is recoverable and
    a duplicate is not.

`_parked` therefore holds only what is in flight — at most `_MAX_BATCH` per
concurrent drain — and cannot grow on its own. A parked completion that is never
claimed does not exist: the claim is in a `finally`.

`_abandoned` is the tombstone for the third case. Forgetting an id is what turns
a late completion back into a brand new row, so an id whose row is in the table
but whose key is gone is REMEMBERED as unusable, and a completion for it is
dropped rather than inserted. It is capped like `_open_rows`; past the cap the
guarantee lapses for the oldest tombstone alone, which needs `_MAX_OPEN`
unanswered sends beyond the `_MAX_OPEN` that filled the map to begin with.

── THE ORG IS NOT READ HERE, AND MUST NOT BE ────────────────────────────────

`org_id` arrives as an argument. It is captured by `outbound.begin()` from a
ContextVar the request middleware set, on the caller's thread, at the moment
the gate is asked — see WHOSE SEND WAS IT in `outbound.py`.

Adding a `_ORG_ID.get()` default in `write()` or `_row()` would look like the
same thing and would be silently destructive. `write()` is called TWICE for a
message that reports an outcome, and the second call arrives from
`email_service`'s `threading.Thread`, where the context is empty. The second
row supersedes the first wholesale (see QUEUED below), so a read here would
overwrite the org `begin()` captured with None and produce exactly the empty
screen this feature was built to stop — with nothing in review looking wrong.
This module takes what it is given. That is the whole reason it can be trusted
to be a translator.

── SHUTDOWN ─────────────────────────────────────────────────────────────────

`write()` buffers, so anything not yet flushed dies with the process, and
Railway redeploys this service constantly. `shutdown()` is the drain a
shutdown hook calls WHILE THE POOL IS STILL OPEN — after `close_pool()` there
is nothing left to write with. Rows are most at risk exactly when they are
most interesting: `email_service` reports its outcome from a background thread
that can easily outlive the request that started it.

`stats()` and `dropped()` are how the process says it under-counted. A figure
taken from this table while `dropped()` is non-zero is a FLOOR, which is the
same qualification the original hour of inference produced and the thing this
table exists to improve on — so it has to be sayable, not merely countable.
An `atexit` line is the last-resort version: it cannot save the rows (the loop
and the pool are gone by then) but it stops them disappearing silently, and it
names the hook that would have saved them.

── DEPENDS ON MIGRATION 098 ─────────────────────────────────────────────────

Every column named here is created by it. Until it is applied, this module goes
quiet after one warning rather than failing a send or filling the logs.
"""

import asyncio
import atexit
import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone

import asyncpg

from db import get_pool

log = logging.getLogger(__name__)


# ── The status vocabulary ────────────────────────────────────────────────────
# The strings are 098's, checked by `outbound_log_status_ck`. They live here as
# constants for the same reason credits.py owns its tx_type strings: a second
# spelling anywhere makes a count wrong, and a value outside the CHECK does not
# make a wrong row, it makes NO row.

#: Handed to the sender, outcome not yet known. A row still at this an hour
#: later means the process died between the provider call and the answer.
STATUS_QUEUED = "queued"

#: What the senders were written against before 098 settled on 'queued'. Same
#: value, so both spellings produce the same legal row. Kept because
#: `email_service` and `expo_push_service` import it by this name; collapse the
#: two when those files are next touched.
STATUS_ATTEMPTED = STATUS_QUEUED

#: The provider ACCEPTED it and usually gave an id. Not the same as arrived:
#: SES accepts a message and bounces it seconds later, which is what happened to
#: 960 payslips. A bounce is a later fact about a row that was genuinely sent.
STATUS_SENT = "sent"

#: `OUTBOUND_MODE=dry` refused it. Nothing left the building. Not a failure —
#: it is the correct outcome for every send on staging.
STATUS_SUPPRESSED = "suppressed"

#: The provider refused it or the call raised. `error` says why.
STATUS_FAILED = "failed"

#: A row at one of these can still be completed, so it is the only kind that
#: carries a correlation id.
_OPEN_STATUSES = {STATUS_QUEUED}


# ── channel and provider are not the same axis ───────────────────────────────
# 098's CHECK allows exactly four channels. Senders pass eleven shapes. The
# mapping is the family on the left and who carried it on the right; an explicit
# `provider=` from the caller always wins over the guess made here.
_LEGAL_CHANNELS = {"email", "push", "whatsapp", "social"}

#: Sub-channel -> (channel, provider). Keyed on what senders actually pass:
#: `outbound.suppressed("push:expo", …)`, `("push:web", …)`,
#: `(f"social:{platform}", …)` where platform is a `hub_social_accounts` value.
_SUBCHANNELS = {
    ("push", "expo"): ("push", "expo"),
    ("push", "web"): ("push", "webpush"),
    # Meta carries three of these and bills WhatsApp differently from the rest,
    # which is why whatsapp_business changes CHANNEL and not just provider.
    ("social", "facebook"): ("social", "meta"),
    ("social", "instagram"): ("social", "meta"),
    ("social", "threads"): ("social", "meta"),
    ("social", "whatsapp_business"): ("whatsapp", "meta"),
    ("social", "twitter"): ("social", "x"),
    ("social", "x"): ("social", "x"),
    ("social", "youtube"): ("social", "google"),
}

#: 098 keeps `subject_or_title` NULL for social on purpose. See NO BODIES above:
#: for this channel the "subject" a sender passes is an excerpt of the client's
#: own post, and persisting it is the one rule this table has.
_NO_SUBJECT_CHANNELS = {"social"}

#: `detail` holds names of things, never contents of things. 098 refuses these
#: four with a CHECK; stripping them here means a caller that reaches for one
#: loses a key rather than a row.
_FORBIDDEN_DETAIL_KEYS = ("body", "html", "text", "content")


# ── Storage limits ───────────────────────────────────────────────────────────
# Applied here rather than at the callers: the writer owns the shape of the row,
# and a caller that passes something enormous should cost a truncated field, not
# a failed INSERT that takes the whole batch with it. 098 asks for exactly this
# on `error` — cap by TRUNCATING, never by discarding the row.
_MAX_CHANNEL = 64
_MAX_RECIPIENT = 320       # the longest legal email address
_MAX_SUBJECT = 200         # also the ceiling on anything mistaken for a subject
_MAX_PURPOSE = 64
_MAX_PROVIDER = 32
_MAX_MESSAGE_ID = 200
_MAX_ERROR = 500

#: Used when a sender has no target. 098 makes `recipient` NOT NULL so that the
#: writer has to name what it aimed at; this names the fact that it could not.
_UNKNOWN_RECIPIENT = "(unknown)"

#: 098 makes `purpose` NOT NULL and deliberately does not CHECK it. Senders do
#: not pass one yet, and an obviously unfinished bucket is better than inventing
#: a category that would quietly absorb everything.
_DEFAULT_PURPOSE = "unclassified"

#: In-memory ceiling. Reached only if the database is unreachable for a long
#: time; past it, rows are counted and dropped rather than growing the heap of a
#: process whose actual job is serving requests.
_MAX_PENDING = 2000

#: How many rows one statement carries. A payroll run is 71; the cap exists so a
#: backlog cannot build a single statement of unbounded size.
_MAX_BATCH = 500

#: Correlation ids for rows that are inserted but not yet final. Only email
#: holds one open at a time and only for the length of an SES call, so this is
#: normally near-empty; the cap stops a provider that never answers from being
#: a slow leak.
_MAX_OPEN = 5000

#: A database outage must not also be a log flood — Railway charges for the
#: compute that writes them and rotates them away anyway.
_WARN_EVERY = 60.0


# ── Module state ─────────────────────────────────────────────────────────────
# `_pending` is keyed by the caller's correlation id so an attempt and its
# outcome collapse into ONE row before the statement is built — cheaper, and it
# means the common case never writes a 'queued' row at all.
_pending: dict[uuid.UUID, dict] = {}

#: correlation id -> the BIGINT the database assigned. Only for rows flushed
#: while still open, which is the only case a completion cannot be merged.
_open_rows: dict[uuid.UUID, int] = {}

#: Completions for rows already inserted, as (bigint id, row).
_updates: list[tuple[int, dict]] = []

#: Correlation ids whose 'queued' INSERT is IN FLIGHT — out of `_pending`, not
#: yet in `_open_rows`. This is the window that used to turn one message into
#: two rows; see THE WINDOW BETWEEN THOSE TWO above. Every id put in here by
#: `_take()` is settled by `_settle_inflight` in `_write_batch`'s `finally`.
_inflight: set[uuid.UUID] = set()

#: Completions that arrived while their id was in flight, held until the
#: round-trip says whether they are an UPDATE, a fresh row, or unrecordable.
#: Bounded by what is in flight, and emptied by the same `finally`, so nothing
#: parks here indefinitely.
_parked: dict[uuid.UUID, dict] = {}

#: Ids whose 'queued' row IS in the table but whose key this process no longer
#: holds — evicted by `_MAX_OPEN`, or inserted without a readable RETURNING. A
#: dict used as an insertion-ordered set. A completion for one of these is
#: dropped and counted, never inserted: the row it belongs to already exists,
#: and a second one would be indistinguishable from a genuine second send.
_abandoned: dict[uuid.UUID, None] = {}

_lock = threading.Lock()

#: The loop that owns the pool. Captured the first time we are called from it,
#: because completions arrive from `threading.Thread` — email_service and
#: employee_email both send in a background thread — where there is no loop of
#: our own to schedule on.
_loop: asyncio.AbstractEventLoop | None = None
_task: asyncio.Task | None = None

#: Set when the table cannot exist as we understand it. Not set by a transient
#: failure: a DB blip must not permanently disable the log.
_dormant = False

_dropped = 0
_last_warn = 0.0

#: Rows this process has actually put in the table. Half of the honesty pair —
#: `_dropped` alone cannot say whether a zero means "nothing was sent" or "the
#: log was never working", and those are opposite answers to the only question
#: anyone asks this table.
_written = 0


# ── Public API ───────────────────────────────────────────────────────────────

def write(
    *,
    id: uuid.UUID,
    channel: str,
    status: str,
    mode: str = "live",
    ts: datetime | None = None,
    target: str | None = None,
    subject: str | None = None,
    purpose: str | None = None,
    provider: str | None = None,
    message_id: str | None = None,
    bytes: int | None = None,
    org_id: str | None = None,
    user_id: str | None = None,
    ref: str | None = None,
    error: str | None = None,
    detail: dict | None = None,
) -> None:
    """Record one outbound message, or complete a record already made.

    Fire-and-forget: buffers and returns. Callers are senders, so this must be
    incapable of raising — every path below is inside the try, including the
    scheduling, and a failure here costs a debug line and nothing else.

    Call it twice with the same `id` to complete an attempt. The second call
    carries the whole row rather than a delta, so it works whether or not the
    first has reached the database yet.

    `id` is a process-local correlation id, NOT the primary key — 098's key is
    assigned by the database. `id` and `bytes` shadow builtins; they are named
    for the arguments the senders already pass, and neither builtin is used in
    this file.
    """
    try:
        row = _row(
            id=id, channel=channel, status=status, mode=mode, ts=ts,
            target=target, subject=subject, purpose=purpose, provider=provider,
            message_id=message_id, bytes=bytes, org_id=org_id, user_id=user_id,
            ref=ref, error=error, detail=detail,
        )
        if row is None:
            return                                  # unmappable; already warned

        global _dropped
        with _lock:
            if _dormant:
                return
            if id in _pending:
                # Not yet written. The outcome supersedes the attempt wholesale
                # and the pair costs one INSERT instead of an INSERT and an
                # UPDATE — see QUEUED above.
                _pending[id] = row
            elif id in _inflight:
                # The attempt's INSERT is in flight, so its key does not exist
                # yet and neither map knows this id. Falling through to the last
                # branch here is what wrote the second row; park it instead and
                # let the round-trip say what it is. See THE WINDOW above.
                if len(_parked) >= _MAX_PENDING:
                    _dropped += 1
                    return
                _parked[id] = row
            elif id in _open_rows:
                _updates.append((_open_rows.pop(id), row))
            elif id in _abandoned:
                # The 'queued' row is in the table and its key is gone. Writing
                # this would be a second row for one message, which is
                # permanent; losing the outcome is merely an under-count, and
                # `dropped()` says so. The tombstone is LEFT in place — reading
                # it is not consuming it, and a sender that reports twice must
                # get the same answer the second time.
                _dropped += 1
                return
            elif len(_pending) >= _MAX_PENDING:
                _dropped += 1
                return
            else:
                _pending[id] = row

        _schedule()
    except Exception:                               # never the sender's problem
        log.debug("outbound_log.write failed", exc_info=True)


async def flush() -> int:
    """Drain the buffer now and return the number of rows written.

    For a test that wants to assert what was recorded without racing the
    scheduler. A shutdown hook wants `shutdown()` instead — same drain, but
    bounded, and it waits for a drain already in flight rather than reporting
    zero over rows another task is midway through writing.
    """
    written = 0
    while True:
        rows, updates = _take()
        if not rows and not updates:
            return written
        done = await _write_batch(rows, updates)
        if done is None:
            return written
        written += done


def pending() -> int:
    """How many rows are buffered but not yet written.

    Parked completions count. They are an outcome this process holds and the
    table does not, which is the same thing a buffered row is — and leaving them
    out would let `shutdown()` report "none lost" over the half of the record
    that carries the provider's message id.
    """
    with _lock:
        return len(_pending) + len(_updates) + len(_parked)


def dropped() -> int:
    """How many rows were thrown away because the buffer was full or the write
    failed.

    Non-zero means the log under-counts, and a log that under-counts silently is
    the thing this table exists to stop being.
    """
    return _dropped


def stats() -> dict:
    """What this process knows about its own honesty, in one dict.

    For a health endpoint or the outbound screen's footer. `dropped` on its own
    is a counter nobody reads; beside `written` it is a ratio somebody can act
    on, and beside `dormant` it distinguishes the two zeroes that look alike —
    "nothing was sent" and "this process has not been able to record a send
    since it booted".
    """
    with _lock:
        return {
            "written": _written,
            "dropped": _dropped,
            "pending": len(_pending) + len(_updates) + len(_parked),
            # Rows inserted 'queued' that are still waiting for an outcome. A
            # figure that climbs and never falls is a provider that stopped
            # answering, which is the reading 098 asks of a stale 'queued' row
            # and the only way to see it before the table does.
            "open": len(_open_rows) + len(_inflight),
            "dormant": _dormant,
        }


async def shutdown(timeout: float = 5.0) -> int:
    """Write what is still buffered, before the pool goes away.

    Call it from the app's shutdown hook AND BEFORE `close_pool()`:

        @app.on_event("shutdown")
        async def shutdown():
            await outbound_log.shutdown()
            await close_pool()

    Without it a redeploy silently loses whatever the last requests queued, and
    Railway redeploys this service constantly. The rows most likely to be in
    the buffer at that moment are the ones a background sending thread has just
    reported — the half of the record that carries the provider's message id.

    Bounded, because a shutdown that hangs is answered with SIGKILL and then
    NOTHING is written, including the rows a shorter wait would have saved.
    Never raises — a logger must not be able to fail a deploy any more than it
    can fail a send.

    Returns how many rows the shutdown SAVED, counted as the change in the
    process total rather than as `flush()`'s own return. A drain already in
    flight when this is called writes rows that `flush()` then correctly reports
    as zero, having found an empty buffer; returning that zero would say
    "nothing needed saving" about the exact case where something did.
    """
    before = _written
    try:
        # An in-flight `_drain` has already TAKEN rows out of the buffer, so
        # flushing without waiting for it would report success over rows that
        # are about to be cancelled with the loop.
        task = _task
        if task is not None and not task.done():
            try:
                if task.get_loop() is asyncio.get_running_loop():
                    await asyncio.wait({task}, timeout=timeout)
            except RuntimeError:
                pass                        # foreign or closed loop; not ours
        await asyncio.wait_for(flush(), timeout)
    except asyncio.TimeoutError:
        log.warning(
            "outbound_log: the final drain did not finish within %.0fs. %d "
            "row(s) are still buffered and will be lost.", timeout, pending(),
        )
    except Exception:
        log.warning("outbound_log: the final drain failed", exc_info=True)

    left, lost = pending(), dropped()
    if left or lost:
        # ASCII only, same rule as outbound.py's suppression line: read in
        # Railway logs and in a Windows console.
        log.warning(
            "outbound_log: %d row(s) written this process, %d still buffered "
            "at shutdown, %d dropped. Any figure taken from staging.outbound_log "
            "for this window is a FLOOR.", _written, left, lost,
        )
    else:
        log.info("outbound_log: %d row(s) written this process, none lost.",
                 _written)
    return _written - before


def _at_exit() -> None:
    """Say what was lost, when it is already too late to save it.

    By the time atexit runs, uvicorn has closed the event loop and the shutdown
    hook has closed the pool, so this CANNOT write the rows — `shutdown()` is
    the one that can. What it can do is stop the loss being silent, which is
    the original defect in miniature: nobody knew 2,586 message units had gone
    because nothing said so.

    The one case it can still save is a plain script or worker that exits with
    its loop intact and never had a shutdown hook to run.
    """
    try:
        if pending():
            loop = _loop
            if loop is not None and not loop.is_closed() and not loop.is_running():
                try:
                    loop.run_until_complete(flush())
                except Exception:
                    pass                    # already dying; nothing to add

        left, lost = pending(), dropped()
        if not left and not lost:
            return
        log.warning(
            "outbound_log: %d row(s) were still buffered and %d dropped when "
            "the process exited; they are not in staging.outbound_log. Call "
            "'await outbound_log.shutdown()' from the app shutdown hook, "
            "before close_pool(), to save the first number.", left, lost,
        )
    except Exception:
        pass                                # exiting; a traceback helps nobody


atexit.register(_at_exit)


# ── Building a row ───────────────────────────────────────────────────────────

def _row(*, id, channel, status, mode, ts, target, subject, purpose, provider,
         message_id, bytes, org_id, user_id, ref, error, detail) -> dict | None:
    """Translate a sender's vocabulary into 098's columns. None if unmappable."""
    family, guessed_provider = _split_channel(channel)
    if family is None:
        return None

    extra = _detail(detail)
    if mode:
        # There is no `mode` column, and this is not a detail worth losing:
        # staging and production write to the SAME `staging` schema, so this is
        # the only thing on the row that says which of the two produced it.
        extra["mode"] = str(mode)[:16]

    if ref:
        # 'payslip:PS-2026-08-42' is a purpose and a reference in one string,
        # which is how the senders already spell it.
        head, _, tail = str(ref).partition(":")
        purpose = purpose or head
        extra["ref"] = str(ref)[:_MAX_MESSAGE_ID]

    if status in _OPEN_STATUSES:
        # The only rows that can still be completed carry the correlation id, so
        # a final row pays nothing to store one.
        extra["event"] = str(id)

    return {
        "event": id,
        "ts": ts or datetime.now(timezone.utc),
        "org_id": _as_uuid(org_id),
        "user_id": _clip(user_id, _MAX_RECIPIENT),
        "channel": family,
        "purpose": _clip(purpose, _MAX_PURPOSE) or _DEFAULT_PURPOSE,
        "recipient": _clip(target, _MAX_RECIPIENT) or _UNKNOWN_RECIPIENT,
        # NULL for social, deliberately and permanently. See NO BODIES.
        "subject_or_title": (None if family in _NO_SUBJECT_CHANNELS
                             else _clip(subject, _MAX_SUBJECT)),
        # A suppressed send never reached a client, so it has no carrier. 098:
        # "A suppressed row with a provider set would be claiming a decision
        # that was never made." The guess derived from `social:facebook` is
        # exactly such a claim, so it is withheld here and only here.
        "provider": (_clip(provider, _MAX_PROVIDER) or
                     (None if status == STATUS_SUPPRESSED else guessed_provider)),
        "provider_message_id": _clip(message_id, _MAX_MESSAGE_ID),
        "status": status,
        "error": _clip(error, _MAX_ERROR),
        "bytes": _as_bytes(bytes),
        "detail": json.dumps(extra),
    }


def _split_channel(channel: str) -> tuple[str | None, str | None]:
    """`"push:expo"` -> `("push", "expo")`. `(None, None)` if it cannot be one.

    An unmappable channel is DROPPED rather than filed under a legal-looking
    one. 098's CHECK allows four values, and a row written under the wrong
    family is worse than a missing row: it is a wrong answer to "what did we
    send this org", and nothing about it looks wrong afterwards.
    """
    raw = (channel or "").strip().lower()[:_MAX_CHANNEL]
    family, _, sub = raw.partition(":")
    if sub:
        mapped = _SUBCHANNELS.get((family, sub))
        if mapped:
            return mapped
        if family in _LEGAL_CHANNELS:
            # A platform this table has not met. The family is still right and
            # `provider` is not a checked column, so the row is sound.
            return family, sub[:_MAX_PROVIDER]
    elif family in _LEGAL_CHANNELS:
        return family, None

    log.warning(
        "outbound_log: channel %r has no place in outbound_log_channel_ck "
        "(email/push/whatsapp/social) and the row is dropped. Add it to "
        "_SUBCHANNELS here, or to the CHECK in a new migration.",
        channel,
    )
    return None, None


def _detail(detail: dict | None) -> dict:
    """Names of things, never contents of things.

    098 refuses the four obvious body keys with a CHECK and says in the same
    breath that the constraint is a tripwire and the writer must strip content
    before it arrives. Stripping here costs a key; relying on the CHECK costs
    the row, and costs it silently.
    """
    if not isinstance(detail, dict):
        return {}
    clean = {}
    for key, value in detail.items():
        name = str(key)
        if name.lower() in _FORBIDDEN_DETAIL_KEYS:
            log.warning(
                "outbound_log: detail key %r dropped. This table stores no "
                "message content: put a NAME here, not the thing itself.", name,
            )
            continue
        clean[name[:64]] = value if isinstance(value, (int, float, bool)) else str(value)[:200]
    return clean


# ── Coercion ─────────────────────────────────────────────────────────────────

def _clip(value, limit: int) -> str | None:
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    text = text.strip()
    return text[:limit] if text else None


def _as_bytes(value) -> int | None:
    """098 CHECKs `bytes >= 0` and says plainly that NULL is not zero.

    A negative or unparseable size becomes NULL — not measured — rather than a
    number that would fail the CHECK and take the batch with it.
    """
    try:
        size = int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    return size if size is not None and size >= 0 else None


def _as_uuid(value) -> uuid.UUID | None:
    """A malformed org id costs the row its org, not the whole batch.

    Callers pass org ids as strings from a dozen places and some of them are not
    uuids — 'platform', '', a slug. Binding one of those to a uuid[] parameter
    fails the statement, and losing 500 rows because one had a bad org id is the
    wrong trade.
    """
    if value is None or isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


# ── Scheduling ───────────────────────────────────────────────────────────────

def _schedule() -> None:
    """Ask the event loop to drain, from whichever thread we are on."""
    global _loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No loop here — we are inside one of the sender threads, or in a
        # synchronous script. Hand it to the loop we captured earlier; if we
        # never saw one, the row waits in the buffer for someone who has.
        loop = _loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(_ensure_task)
        except RuntimeError:
            pass                                    # loop shut down mid-call
        return

    _loop = loop
    _ensure_task()


def _ensure_task() -> None:
    """Start the drainer if it is not already running. Loop thread only."""
    global _task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    # `is not done` is not sufficient on its own. A task left pending on a loop
    # that has since been closed never completes and never will, so testing only
    # `done()` would leave `_task` permanently truthy and nothing would ever
    # drain again — silently, for the life of the process. Ownership is the real
    # question: a task belonging to another loop cannot serve this one.
    if _task is not None and not _task.done() and _task.get_loop() is loop:
        return
    try:
        _task = loop.create_task(_drain())
    except RuntimeError:
        _task = None


async def _drain() -> None:
    global _task
    try:
        # One pass of the loop before taking anything. A request that sends 71
        # payslips does so without awaiting between them, so this single yield
        # is the difference between 71 statements and one — and it is also what
        # lets a fast outcome catch up with its own attempt.
        await asyncio.sleep(0)
        while True:
            rows, updates = _take()
            if not rows and not updates:
                return
            if await _write_batch(rows, updates) is None:
                return                              # dropped; do not spin
    except Exception:
        log.debug("outbound_log drain failed", exc_info=True)
    finally:
        _task = None


def _take() -> tuple[list[dict], list[tuple[int, dict]]]:
    with _lock:
        rows = list(_pending.values())[:_MAX_BATCH]
        for row in rows:
            _pending.pop(row["event"], None)
            if row["status"] in _OPEN_STATUSES:
                # OUT OF `_pending` AND NOT YET IN `_open_rows`. For the length
                # of the INSERT round-trip this id lives nowhere else, and a
                # completion arriving now has to be parked rather than buffered
                # as a new row. Marked in the SAME locked section that removes
                # it, so there is no instant in which `write()` sees neither.
                _inflight.add(row["event"])
        updates = _updates[:_MAX_BATCH]
        del _updates[:len(updates)]
        return rows, updates


# ── The write ────────────────────────────────────────────────────────────────

# UNNEST rather than a generated VALUES list: the parameter count is fixed at 13
# whatever the batch size, so the statement text is identical every time and the
# server is not asked to plan a new one per batch shape.
#
# `id` is absent because 098 makes it GENERATED ALWAYS — naming it is an error,
# not an override.
_INSERT = """
INSERT INTO staging.outbound_log
    (ts, org_id, user_id, channel, purpose, recipient, subject_or_title,
     provider, provider_message_id, status, error, bytes, detail)
SELECT * FROM UNNEST(
    $1::timestamptz[], $2::uuid[], $3::text[], $4::text[], $5::text[],
    $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
    $12::int[], $13::jsonb[])
"""

# Read back the assigned key WITH the correlation id rather than relying on
# RETURNING coming back in input order — that order is not guaranteed, and the
# failure would be a provider's message id filed against somebody else's email.
_INSERT_RETURNING = _INSERT + "RETURNING id, detail->>'event' AS event"

_UPDATE = """
UPDATE staging.outbound_log AS l
   SET status              = u.status,
       provider            = COALESCE(u.provider, l.provider),
       provider_message_id = COALESCE(u.provider_message_id, l.provider_message_id),
       bytes               = COALESCE(u.bytes, l.bytes),
       error               = COALESCE(u.error, l.error),
       -- The correlation id earned its place while the row was open and has
       -- none once it is final; dropping it here keeps it off every completed
       -- row on the highest-insert table in the product.
       detail              = (l.detail || u.detail) - 'event'
  FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[], $5::int[],
              $6::text[], $7::jsonb[])
       AS u(id, status, provider, provider_message_id, bytes, error, detail)
 WHERE l.id = u.id
"""

_INSERT_COLUMNS = (
    "ts", "org_id", "user_id", "channel", "purpose", "recipient",
    "subject_or_title", "provider", "provider_message_id", "status", "error",
    "bytes", "detail",
)
_UPDATE_COLUMNS = (
    "status", "provider", "provider_message_id", "bytes", "error", "detail",
)

# SQLSTATEs that mean the shape we were promised is not there. Going quiet is
# right for these and wrong for everything else: an unmigrated database should
# cost one warning, a database that is merely down should cost nothing
# permanent.
_DORMANT_CODES = {
    "42P01",   # undefined_table        — migration 098 not applied
    "42703",   # undefined_column       — table exists, columns differ
    "3F000",   # invalid_schema_name    — no staging schema
    "42501",   # insufficient_privilege — the role cannot write it
}

#: Integrity failures — a CHECK, the org foreign key, a NOT NULL. One bad row
#: must not cost the 499 good ones beside it, so the batch is retried one row at
#: a time and only the offender is lost.
_INTEGRITY_CLASS = "23"


async def _write_batch(rows, updates) -> int | None:
    """Write one batch. Returns rows written, or None if it was dropped."""
    global _dormant, _dropped, _written

    # Exactly the ids `_take()` marked in flight, derived the same way from the
    # same rows. Settled in the `finally` below on EVERY path, including the one
    # where there is no pool to fail against: an id left in `_inflight` would
    # park its own completion for ever, which is this defect in a new shape.
    open_ids = [r["event"] for r in rows if r["status"] in _OPEN_STATUSES]
    landed = False
    written = 0
    try:
        try:
            pool = await get_pool()
        except Exception as exc:
            _lose(rows, updates, "no database pool", exc)
            return None

        if rows:
            done = await _insert(pool, rows)
            if done is None:
                return None
            # The batch reached the table. `_remember` has already settled every
            # id whose key came back with it; anything STILL in flight after
            # this is a row that exists and can no longer be named.
            landed = True
            written += done
        if updates:
            done = await _update(pool, updates)
            if done is None:
                return None
            written += done
        return written
    finally:
        # Counted even on the path that returns None: an INSERT that lands and
        # an UPDATE that then fails returns None, and those inserted rows ARE
        # in the table. A `written` total that undercounted would make
        # `stats()` describe a working log as a broken one.
        if written:
            with _lock:
                _written += written
        _settle_inflight(open_ids, landed)


async def _insert(pool, rows: list[dict]) -> int | None:
    args = [[r[col] for r in rows] for col in _INSERT_COLUMNS]
    open_rows = [r for r in rows if r["status"] in _OPEN_STATUSES]

    try:
        if open_rows:
            returned = await pool.fetch(_INSERT_RETURNING, *args)
            _remember(returned)
        else:
            await pool.execute(_INSERT, *args)
        return len(rows)
    except asyncpg.PostgresError as exc:
        if _went_dormant(exc, len(rows)):
            return None
        if str(getattr(exc, "sqlstate", "")).startswith(_INTEGRITY_CLASS) and len(rows) > 1:
            return await _insert_one_by_one(pool, rows)
        _lose(rows, [], "insert failed", exc)
        return None
    except Exception as exc:
        _lose(rows, [], "insert failed", exc)
        return None


async def _insert_one_by_one(pool, rows: list[dict]) -> int:
    """Salvage a batch that one row poisoned.

    Slow, and only ever on the error path. The alternative is throwing away
    every row that happened to share a statement with a bad one, which is how a
    log quietly starts under-counting.

    An OPEN row is re-run with RETURNING for the same reason the batch is: the
    correlation id has to survive the salvage. Without it the key is never
    learned, the row is stranded 'queued', and the completion arriving a moment
    later has nothing to update — which is the over-count this module now goes
    to some trouble to prevent, reintroduced on the rarest path.
    """
    written = 0
    for row in rows:
        single = [[row[col]] for col in _INSERT_COLUMNS]
        try:
            if row["status"] in _OPEN_STATUSES:
                _remember(await pool.fetch(_INSERT_RETURNING, *single))
            else:
                await pool.execute(_INSERT, *single)
            written += 1
        except Exception as exc:
            _lose([row], [], "row rejected", exc)
            # THIS row is not in the table, whatever the rest of the batch did.
            # A completion parked against it is the message's only surviving
            # record and belongs back in the buffer as a fresh, final row.
            _settle_inflight([row["event"]], landed=False)
    return written


async def _update(pool, updates: list[tuple[int, dict]]) -> int | None:
    args = [[row_id for row_id, _ in updates]]
    args += [[row[col] for _, row in updates] for col in _UPDATE_COLUMNS]
    try:
        await pool.execute(_UPDATE, *args)
        return len(updates)
    except asyncpg.PostgresError as exc:
        if _went_dormant(exc, len(updates)):
            return None
        _lose([], updates, "update failed", exc)
        return None
    except Exception as exc:
        _lose([], updates, "update failed", exc)
        return None


def _remember(returned) -> None:
    """Settle the ids whose INSERT has just answered.

    Two jobs that are really one: the assigned key has arrived, so either a
    completion is already waiting for it — parked while the round-trip was open
    — or the row is still completable and the key is worth keeping.
    """
    try:
        with _lock:
            for record in returned or []:
                event = record["event"]
                if not event:
                    continue
                key = uuid.UUID(str(event))
                row_id = int(record["id"])
                _inflight.discard(key)

                parked = _parked.pop(key, None)
                if parked is not None:
                    # The outcome beat the round-trip. It is an UPDATE of the
                    # row that has just been inserted, and never a second row.
                    _updates.append((row_id, parked))
                    continue

                if len(_open_rows) >= _MAX_OPEN:
                    # Full. The oldest is the least likely to still be waiting
                    # on a provider — but it CANNOT simply be forgotten. Its row
                    # is in the table, so a completion arriving for it later has
                    # to be refused rather than inserted as a new message.
                    _abandon(next(iter(_open_rows)))
                _open_rows[key] = row_id
    except Exception:
        # Losing the key means the row stays 'queued'. 098 reads that as "the
        # process died", which is close enough to true and is not worth risking
        # anything on the send path to avoid. Whatever this loop did not reach
        # is still settled by `_write_batch`'s `finally`, so a failure here
        # cannot strand an id in `_inflight`.
        log.debug("outbound_log: could not record assigned ids", exc_info=True)


def _abandon(key: uuid.UUID) -> None:
    """Lock held. The row IS in the table and this process cannot name it again.

    Tombstoned rather than forgotten, because forgetting is precisely what turns
    a late completion into a brand new row. Capped like `_open_rows` and for the
    same reason — a logger must not grow the heap of a process whose actual job
    is serving requests.
    """
    _open_rows.pop(key, None)
    _abandoned.pop(key, None)               # re-insert so the order is its age
    _abandoned[key] = None
    while len(_abandoned) > _MAX_OPEN:
        _abandoned.pop(next(iter(_abandoned)), None)


def _settle_inflight(ids, landed: bool) -> None:
    """Close the window for every id still in flight. Called from a `finally`.

    `landed` says whether the INSERT reached the table, and it decides what a
    parked completion becomes. The two answers are opposite, and getting them
    the wrong way round is either a lost row or a duplicated one:

      * NOT LANDED — nothing was written, so this completion duplicates nothing.
        Back into `_pending`, where it becomes the message's one row, already
        final. Its attempt was counted as dropped by `_lose`, which is honest:
        that row genuinely did not make it.
      * LANDED — the 'queued' row exists under a key that never came back, so
        the completion has nothing to update and inserting it would be the
        second row this whole mechanism exists to prevent. Dropped and counted.

    An id that `_remember` already settled is not in `_inflight` any more and is
    skipped, which is what makes calling this unconditionally safe.
    """
    global _dropped
    if not ids:
        return

    requeued = False
    with _lock:
        for key in ids:
            if key not in _inflight:
                continue                    # already settled, by key or by row
            _inflight.discard(key)
            row = _parked.pop(key, None)

            if landed:
                _abandon(key)
                if row is not None:
                    _dropped += 1
                continue
            if row is None:
                continue                    # `_lose` already counted the attempt
            if _dormant or len(_pending) >= _MAX_PENDING:
                _dropped += 1
                continue
            _pending[key] = row
            requeued = True

    if requeued:
        # The buffer is not empty after all. A no-op if the drain calling this
        # is about to loop round and take it; the only prompt there will be if
        # it is returning because the batch failed — in which case the row waits
        # for the next send, `flush()`, or `shutdown()`, and `pending()` says so.
        _schedule()


def _went_dormant(exc, count: int) -> bool:
    global _dormant, _dropped
    if getattr(exc, "sqlstate", None) not in _DORMANT_CODES:
        return False
    with _lock:
        _dormant = True
        # Parked completions are rows this process holds and the table never
        # will, so they are counted lost with the rest. `_inflight` is cleared
        # too, which makes `_settle_inflight` a no-op for the batch that
        # discovered this — there is nothing left to requeue it into.
        lost = len(_pending) + len(_updates) + len(_parked)
        _pending.clear()
        _updates.clear()
        _open_rows.clear()
        _inflight.clear()
        _parked.clear()
        _abandoned.clear()
        _dropped += count + lost
    # ASCII only, same rule as outbound.py's suppression line: these are read in
    # Railway logs and in a Windows console, where a nice dash becomes mojibake.
    log.warning(
        "outbound_log: staging.outbound_log is not writable (%s). Outbound "
        "logging is OFF for this process, %d row(s) discarded. Apply migration "
        "098 and redeploy.",
        getattr(exc, "sqlstate", "?"), count + lost,
    )
    return True


def _lose(rows, updates, what: str, exc: Exception) -> None:
    global _last_warn, _dropped
    lost = len(rows) + len(updates)
    with _lock:
        _dropped += lost
        total = _dropped
    now = time.monotonic()
    if now - _last_warn < _WARN_EVERY:
        return
    _last_warn = now
    log.warning(
        "outbound_log: %s [%s] (%s). %d row(s) lost, %d total this process.",
        what, getattr(exc, "sqlstate", "-"), exc, lost, total,
    )
