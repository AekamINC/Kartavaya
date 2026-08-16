"""The window where one message became two rows, and the four figures beside it.

WHY THIS FILE IS SEPARATE FROM `test_outbound_log.py`. That file asks whether
the writer translates a send into the right row. This one asks whether it writes
ONE of them. They are different questions and only the second is about timing:
every assertion here depends on what `write()` sees while an INSERT is in the
air, which is a state no single-threaded test can reach.

THE DEFECT, AS IT WAS MEASURED. `_take()` pops an attempt out of `_pending`
under the lock; `_remember()` cannot file the assigned BIGINT in `_open_rows`
until the INSERT round-trip answers. For the whole of that round-trip the
correlation id was in NEITHER map, so a completion arriving inside it found its
id nowhere, fell through to the last branch of `write()`, and was buffered as a
FRESH row. The attempt stayed 'queued' for ever and the outcome became a second
independent row, and both were counted. 300 payslips with SES answering in
120 ms:

    round-trip 20 ms  -> 303 rows,   3 duplicated,   3 left queued
    round-trip 50 ms  -> 410 rows, 110 duplicated, 110 left queued
    round-trip 150 ms -> 529 rows, 229 duplicated, 229 left queued

A 76% over-count on the table the AWS bill is reconciled against, biting hardest
exactly where the log matters most — a slow database, a deploy burst, a
71-payslip payroll run — and poisoning permanently, because after the fact a
duplicate is indistinguishable from a genuine second send and 098 keeps rows for
400 days.

IT IS SILENT WHEN BROKEN. Nothing raises, nothing warns, every existing test
passes, and the only symptom is a number on a customer's screen being too big.
That is why the headline test here is the arithmetic itself — 300 in, 300 rows —
and not "no exception was thrown".

WHAT IS PINNED HERE

  1. 300 messages at a 150 ms round-trip produce EXACTLY 300 rows.
  2. No row is left 'queued' once the drain has finished.
  3. A completion arriving mid-INSERT becomes an UPDATE, never an INSERT.
  4. A drain that fails AFTER `_take()` loses nothing and duplicates nothing.
  5. A suppressed row contributes ZERO to the billable message-unit figure.
  6. A dry-mode payslip records the estimated MESSAGE size, not the PDF size.
  7. A cron looping two orgs files each send under its own org, never the
     previous one.

STYLE. Hand-written fakes, per the house convention, and the seam is the pool —
after the statement there is nothing left to inspect but parallel lists. The
difference from `test_outbound_log.py` is that `_Table` below does not merely
record the lists: it APPLIES them, INSERT and UPDATE alike, so what is asserted
is the state Postgres would actually hold. A duplicate only exists as a second
row in a table; a list of statements cannot show one.
"""
import asyncio
import json
import threading
import time
import uuid

import pytest

import outbound
from services import outbound_log


# ════════════════════════════════════════════════════════════════════════════
# HARNESS
# ════════════════════════════════════════════════════════════════════════════

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"

#: What the measurement used. The 150 ms column is the one that produced 529
#: rows for 300 messages, and it is a plausible figure for this product: the
#: pool talks to Supabase in Singapore from Railway, and a deploy burst or a
#: payroll run makes it worse rather than better.
ROUND_TRIP = 0.15

#: SES's own answer time in the same measurement. It has to be SHORTER than the
#: round-trip or the completion lands after the window and the defect never
#: fires — which is the whole reason this reproduces on a slow database and not
#: on a fast one.
PROVIDER_DELAY = 0.12

MESSAGES = 300


class _Table:
    """`staging.outbound_log` as a dict, answered after `round_trip` seconds.

    Not a call recorder. The defect being pinned is a SECOND ROW, and a second
    row is only visible in the table's state — a list of statements shows two
    INSERTs and cannot say whether they were one message or two. So this applies
    both statements the writer has:

      * `_INSERT_RETURNING` assigns a BIGINT the way `GENERATED ALWAYS AS
        IDENTITY` does and hands back `(id, detail->>'event')`, which is the
        pair `_remember` matches on.
      * `_UPDATE` merges exactly as 098's statement does, `COALESCE` by
        `COALESCE` and `(l.detail || u.detail) - 'event'`, so a completion that
        arrives as an UPDATE and one that collapses into its own INSERT end up
        as the same row and the test cannot pass by confusing them.

    `round_trip` is an `asyncio.sleep`, so the loop keeps running through it —
    which is the point. That is the window, and it is where the sending threads
    report.
    """

    def __init__(self, round_trip: float = 0.0):
        self.round_trip = round_trip
        self.rows: dict[int, dict] = {}
        self.inserted = 0
        self.updated = 0
        self._next_id = 0
        self._lock = threading.Lock()
        #: Called (and awaited) INSIDE the round-trip, before the keys are
        #: handed back. How a test forces the window open rather than hoping a
        #: sleep lands in it.
        self.on_insert = None
        #: Raise instead of answering — the drain that fails after `_take()`.
        self.fail_insert = False

    # ── the two statements the writer issues ────────────────────────────────

    async def fetch(self, sql, *args):
        if "INSERT INTO staging.outbound_log" not in sql:
            return []
        rows = _decode_insert(args)
        await self._round_trip()
        if self.fail_insert:
            raise RuntimeError("the pool went away mid-INSERT")
        out = []
        for row in rows:
            row_id = self._store(row)
            out.append({"id": row_id,
                        "event": json.loads(row["detail"]).get("event")})
        return out

    async def execute(self, sql, *args):
        if "INSERT INTO staging.outbound_log" in sql:
            rows = _decode_insert(args)
            await self._round_trip()
            if self.fail_insert:
                raise RuntimeError("the pool went away mid-INSERT")
            for row in rows:
                self._store(row)
            return f"INSERT 0 {len(rows)}"
        if "UPDATE staging.outbound_log" in sql:
            await self._round_trip()
            for row_id, patch in _decode_update(args):
                self._apply(row_id, patch)
            return f"UPDATE {self.updated}"
        return "OK"

    async def _round_trip(self) -> None:
        if self.on_insert is not None:
            hook, self.on_insert = self.on_insert, None
            await hook()
        if self.round_trip:
            await asyncio.sleep(self.round_trip)

    # ── what Postgres would hold afterwards ─────────────────────────────────

    def _store(self, row: dict) -> int:
        with self._lock:
            self._next_id += 1
            row_id = self._next_id
            stored = dict(row)
            stored["detail"] = json.loads(row["detail"])
            self.rows[row_id] = stored
            self.inserted += 1
            return row_id

    def _apply(self, row_id: int, patch: dict) -> None:
        with self._lock:
            row = self.rows.get(row_id)
            if row is None:
                return                      # `WHERE l.id = u.id` matched nothing
            row["status"] = patch["status"]
            for col in ("provider", "provider_message_id", "bytes", "error"):
                if patch[col] is not None:
                    row[col] = patch[col]
            merged = {**row["detail"], **json.loads(patch["detail"])}
            merged.pop("event", None)       # `- 'event'`
            row["detail"] = merged
            self.updated += 1

    # ── reading it back ─────────────────────────────────────────────────────

    def statuses(self) -> list[str]:
        return [r["status"] for r in self.rows.values()]

    def refs(self) -> list[str]:
        return [r["detail"].get("ref") for r in self.rows.values()]


def _decode_insert(args) -> list[dict]:
    """Thirteen parallel lists back into rows, through `_INSERT_COLUMNS`.

    Decoded through the writer's own tuple rather than a copy of it, so a
    reordering that files a subject under `recipient` shows up as a wrong value
    instead of as a passing test.
    """
    assert len(args) == len(outbound_log._INSERT_COLUMNS), (
        "the INSERT was bound with a different number of lists than "
        "_INSERT_COLUMNS names — every value after the divergence is in the "
        "wrong column"
    )
    return [dict(zip(outbound_log._INSERT_COLUMNS, values))
            for values in zip(*args)]


def _decode_update(args) -> list[tuple[int, dict]]:
    ids, columns = args[0], args[1:]
    assert len(columns) == len(outbound_log._UPDATE_COLUMNS)
    return [(row_id, dict(zip(outbound_log._UPDATE_COLUMNS, values)))
            for row_id, values in zip(ids, zip(*columns))]


@pytest.fixture(autouse=True)
def reset_outbound_log():
    """Empty the writer's module state around every test in this file.

    It is a process-wide singleton and THE REST OF THE SUITE FILLS IT — every
    test anywhere that touches a sender runs `suppressed()` through `write()`,
    and conftest's `OUTBOUND_MODE=dry` guarantees they all do. The four maps
    added for the race matter most here: an id left in `_inflight` by an earlier
    test would park this test's completion for ever, and the failure would name
    this file.
    """
    def _clear():
        outbound_log._pending.clear()
        outbound_log._open_rows.clear()
        outbound_log._updates.clear()
        outbound_log._inflight.clear()
        outbound_log._parked.clear()
        outbound_log._abandoned.clear()
        outbound_log._dormant = False
        outbound_log._dropped = 0
        outbound_log._written = 0
        outbound_log._last_warn = 0.0
        outbound_log._task = None

    _clear()
    yield
    _clear()


@pytest.fixture
def table(monkeypatch):
    """A slow database, in place of the pool the writer asks `db` for.

    `outbound_log` imported `get_pool` at module scope, so this is the name it
    actually calls. conftest's `mock_pool` is left alone — it is a call recorder
    and answers instantly, and neither is any use for a test about what happens
    DURING a round-trip.
    """
    fake = _Table()

    async def _get_pool():
        return fake

    monkeypatch.setattr(outbound_log, "get_pool", _get_pool)
    return fake


@pytest.fixture
def live_mode(monkeypatch):
    """Open the gate.

    conftest sets `OUTBOUND_MODE=dry` for the whole suite and calls it
    non-negotiable, so every send is suppressed by default — and a suppressed
    attempt is FINAL, carries no correlation id and can never be completed, so
    the window this file is about does not exist for one. `begin()` re-reads the
    module global on every call so a test may patch it; patched, never set, so
    it cannot leak into another test and turn a mock into a real delivery.
    """
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    return False


async def _settle(timeout: float = 20.0) -> None:
    """Run the writer to a standstill: nothing buffered, nothing in flight.

    Both drains are live at once here — the task `_schedule()` created and the
    explicit `flush()` — which is the deployed shape and not a simplification:
    a completion arriving from a sending thread schedules a drain of its own
    while the request's drain may still be running. They share `_take()` under
    one lock, so this is safe; what it is not is instantaneous, hence the loop.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = outbound_log._task
        if task is not None and not task.done():
            await asyncio.wait({task}, timeout=timeout)
        await outbound_log.flush()
        if not outbound_log.pending() and not outbound_log._inflight:
            return
        await asyncio.sleep(0.005)
    raise AssertionError(
        f"the writer never settled: {outbound_log.pending()} buffered, "
        f"{len(outbound_log._inflight)} in flight"
    )


def _complete_from_a_thread(att, **kwargs) -> None:
    """Report the outcome from where the real senders report it.

    `email_service.send_email` and `services/employee_email` both hand the
    message to a `threading.Thread` and answer from inside it, and a plain
    Thread starts with an EMPTY context. Calling `att.sent()` inline would be a
    different code path — same function, but on the loop thread, holding the
    request's context, and unable to interleave with the drain at all.
    """
    thread = threading.Thread(target=lambda: att.sent(**kwargs))
    thread.start()
    thread.join()


# ════════════════════════════════════════════════════════════════════════════
# 1. 300 MESSAGES AT A 150 ms ROUND-TRIP PRODUCE EXACTLY 300 ROWS
#
# The one that mattered, and the one that is silent when broken. Before the
# fix this wrote 529 rows and left 229 of them 'queued' for ever.
# ════════════════════════════════════════════════════════════════════════════

async def test_three_hundred_payslips_on_a_slow_database_are_three_hundred_rows(
    table, live_mode,
):
    """A payroll run against a database answering in 150 ms.

    Every message is completed from its own thread, as `employee_email` does,
    with the provider answering in 120 ms — inside the round-trip, which is the
    condition the over-count needs and the condition a real payroll run on a
    loaded database meets.
    """
    table.round_trip = ROUND_TRIP

    attempts = [
        outbound.begin("email", f"employee{i}@client.example",
                       "Payslip Ready — August 2026", org_id=ORG,
                       ref=f"payslip:PS-2026-08-{i:03d}", bytes=194_560)
        for i in range(MESSAGES)
    ]
    assert all(not a.blocked for a in attempts), "live_mode did not take"

    # One thread per message, which is what `email_service` actually creates.
    # They sleep together, so all 300 outcomes land at ~120 ms — inside the
    # 150 ms window rather than merely near it.
    def _report(index: int, att) -> None:
        time.sleep(PROVIDER_DELAY)
        att.sent(f"0100018f-ses-{index:03d}", provider="ses", bytes=194_560)

    threads = [threading.Thread(target=_report, args=(i, att))
               for i, att in enumerate(attempts)]
    for thread in threads:
        thread.start()
    await _settle()
    for thread in threads:
        thread.join()
    await _settle()

    # THE ARITHMETIC. 300 messages, 300 rows. 529 was the measured figure with
    # the window open, and nothing about it raised, warned or failed a test.
    assert len(table.rows) == MESSAGES, (
        f"{MESSAGES} messages produced {len(table.rows)} rows — the log "
        f"over-counts by {len(table.rows) - MESSAGES}, permanently, and a "
        f"duplicate is indistinguishable from a real second send afterwards"
    )
    assert table.inserted == MESSAGES, (
        "a completion was INSERTED as a fresh row instead of updating the "
        "attempt it belongs to"
    )

    # Every message is present exactly once, identified by the ref its sender
    # gave it — so the count above cannot be right by two errors cancelling.
    refs = table.refs()
    assert len(set(refs)) == MESSAGES
    assert sorted(refs) == sorted(
        f"payslip:PS-2026-08-{i:03d}" for i in range(MESSAGES))

    # And every one of them carries the outcome, not the attempt.
    assert set(table.statuses()) == {outbound_log.STATUS_SENT}
    assert all(r["provider"] == "ses" for r in table.rows.values())
    assert outbound_log.dropped() == 0, "nothing should have been lost either"


# ════════════════════════════════════════════════════════════════════════════
# 2. NOTHING IS LEFT 'queued' ONCE THE DRAIN HAS FINISHED
#
# The other half of the same defect, and the half that is not merely a wrong
# total. 098 reads a row still 'queued' an hour later as "the process died
# between the provider call and the answer" — a finding in its own right. 229
# of them per payroll run turned that reading into noise, so the one case it
# was written to catch could no longer be seen.
# ════════════════════════════════════════════════════════════════════════════

async def test_no_row_is_left_queued_once_the_drain_has_finished(
    table, live_mode,
):
    table.round_trip = ROUND_TRIP

    attempts = [
        outbound.begin("email", f"employee{i}@client.example", "Payslip",
                       org_id=ORG, ref=f"payslip:PS-{i:03d}")
        for i in range(50)
    ]

    def _report(index: int, att) -> None:
        time.sleep(PROVIDER_DELAY)
        att.sent(f"ses-{index}", provider="ses")

    threads = [threading.Thread(target=_report, args=(i, att))
               for i, att in enumerate(attempts)]
    for thread in threads:
        thread.start()
    await _settle()
    for thread in threads:
        thread.join()
    await _settle()

    stranded = [r for r in table.rows.values()
                if r["status"] == outbound_log.STATUS_QUEUED]
    assert not stranded, (
        f"{len(stranded)} row(s) will read 'queued' for 400 days for messages "
        f"the provider answered — the signal 098 asks for is now noise"
    )

    # The writer's own account of itself agrees, which is what `stats()` is for:
    # a figure taken from this table is only a total while `dropped` is zero,
    # and `open` is the count still awaiting an outcome.
    stats = outbound_log.stats()
    assert stats["open"] == 0, "correlation ids were left waiting for ever"
    assert stats["dropped"] == 0
    assert stats["pending"] == 0


# ════════════════════════════════════════════════════════════════════════════
# 3. A COMPLETION ARRIVING MID-INSERT UPDATES, NEVER INSERTS
#
# The mechanism, forced rather than timed. The test above proves the total; this
# one proves WHY, so a regression is diagnosable and not merely visible.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_completion_arriving_mid_insert_updates_the_row_it_belongs_to(
    table, live_mode,
):
    """The outcome is reported at the one instant neither map holds the id.

    No sleeps: the completion is made from inside the round-trip itself, so the
    overlap is a fact of the test rather than a race it hopes to win. This is
    the exact instant `_take()` has removed the id from `_pending` and
    `_remember()` has not yet put it in `_open_rows`.
    """
    att = outbound.begin("email", "arjun.patel@client.example",
                         "Payslip Ready — August 2026", org_id=ORG,
                         ref="payslip:PS-2026-08-42", bytes=194_560)

    async def _while_the_insert_is_in_flight():
        assert att.id in outbound_log._inflight, (
            "the id is not marked in flight, so this test is not standing in "
            "the window it was written for"
        )
        assert att.id not in outbound_log._pending
        assert att.id not in outbound_log._open_rows
        _complete_from_a_thread(att, message_id="0100018f-ses", provider="ses",
                                bytes=279_446)
        # Parked, NOT buffered. Buffering it here is the whole defect: the next
        # drain would have INSERTed it as a second, independent row.
        assert att.id in outbound_log._parked, (
            "the completion was buffered as a fresh row while its own attempt "
            "was still in flight — one message, two rows"
        )
        assert att.id not in outbound_log._pending

    table.on_insert = _while_the_insert_is_in_flight
    await _settle()

    assert len(table.rows) == 1, "one message, one row"
    assert table.inserted == 1
    assert table.updated == 1, "the outcome must arrive as an UPDATE by key"

    row = next(iter(table.rows.values()))
    assert row["status"] == outbound_log.STATUS_SENT
    assert row["provider_message_id"] == "0100018f-ses"
    assert row["provider"] == "ses"
    assert row["bytes"] == 279_446, "the completion's measured size supersedes"
    assert row["org_id"] == uuid.UUID(ORG), (
        "the org `begin()` captured on the request thread was overwritten by "
        "the empty context of the sending thread"
    )
    # 098: the correlation id earns its place while the row is open and has none
    # once it is final. It must not be left on the highest-insert table.
    assert "event" not in row["detail"]
    assert row["detail"]["ref"] == "payslip:PS-2026-08-42"
    assert outbound_log.dropped() == 0


# ════════════════════════════════════════════════════════════════════════════
# 4. A DRAIN THAT FAILS AFTER `_take()` LOSES NOTHING AND DUPLICATES NOTHING
#
# The failure path is where a fix for a duplication bug most easily creates
# one, because the parked completion has to become the OPPOSITE thing depending
# on whether the INSERT landed. Both answers are asserted, and they are asserted
# against the table's state rather than the writer's intentions.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_drain_that_fails_after_take_loses_nothing_and_duplicates_nothing(
    table, live_mode, monkeypatch,
):
    """The INSERT never lands, so the parked completion IS the message's row.

    There is nothing in the table to update, so it goes back into `_pending` and
    is written as one row, already final. Not a duplicate — the attempt row does
    not exist — and not a loss: the outcome, which is the half carrying the
    provider's receipt, survives.

    The drains are driven by hand here. `_settle()` runs the writer to a
    standstill, and against a pool that is broken FOR EVER that means retrying
    the requeued row straight into the same failure — a property of the harness,
    not of the product, where the row waits in the buffer for the next send,
    `flush()` or `shutdown()`, by which time the pool is normally back.
    """
    monkeypatch.setattr(outbound_log, "_schedule", lambda: None)

    att = outbound.begin("email", "arjun.patel@client.example", "Payslip",
                         org_id=ORG, ref="payslip:PS-2026-08-42")

    async def _while_the_insert_is_in_flight():
        _complete_from_a_thread(att, message_id="0100018f-ses", provider="ses")
        assert att.id in outbound_log._parked

    table.on_insert = _while_the_insert_is_in_flight
    table.fail_insert = True

    assert await outbound_log.flush() == 0
    assert not table.rows, "the failed INSERT must not have written anything"
    # THE OUTCOME IS STILL HELD. `pending()` counts it because it is a record
    # this process has and the table does not — the same thing a buffered row
    # is, and the reason `shutdown()` can honestly say whether anything is lost.
    assert outbound_log.pending() == 1
    assert not outbound_log._inflight, "the window must be closed on every path"
    assert not outbound_log._parked

    table.fail_insert = False
    await outbound_log.flush()

    assert len(table.rows) == 1, (
        "the message ended up as %d row(s): a failed drain must not lose the "
        "outcome and must not write it twice" % len(table.rows)
    )
    row = next(iter(table.rows.values()))
    assert row["status"] == outbound_log.STATUS_SENT, (
        "the surviving row is the outcome, not a stranded 'queued' attempt"
    )
    assert row["provider_message_id"] == "0100018f-ses"
    assert row["org_id"] == uuid.UUID(ORG)
    # The attempt genuinely did not reach the table, and `dropped()` says so
    # rather than pretending. An under-count that announces itself is the
    # honest failure; a duplicate is the permanent one.
    assert outbound_log.dropped() >= 1
    assert outbound_log.pending() == 0


async def test_an_insert_that_landed_without_its_key_drops_the_outcome(
    table, live_mode,
):
    """The other answer, and the one that must NOT requeue.

    The 'queued' row is in the table under a key this process never learned, so
    the completion has nothing to update and inserting it would be the second
    row this whole mechanism exists to prevent. Dropped and counted: an
    under-count `dropped()` declares is recoverable, a duplicate is not.
    """
    att = outbound.begin("email", "arjun.patel@client.example", "Payslip",
                         org_id=ORG, ref="payslip:PS-2026-08-42")

    async def _while_the_insert_is_in_flight():
        _complete_from_a_thread(att, message_id="0100018f-ses", provider="ses")

    table.on_insert = _while_the_insert_is_in_flight
    # The row lands; its key does not come back. This is `_remember` failing, or
    # a `_MAX_OPEN` eviction — 098's third case.
    original = outbound_log._remember
    outbound_log._remember = lambda returned: None
    try:
        await _settle()
    finally:
        outbound_log._remember = original

    assert len(table.rows) == 1, (
        "the outcome was inserted as a second row for a message whose attempt "
        "row is already in the table"
    )
    assert next(iter(table.rows.values()))["status"] == outbound_log.STATUS_QUEUED
    assert outbound_log.dropped() == 1, (
        "an outcome that cannot be recorded must be counted, or the log "
        "under-counts silently — which is the original defect"
    )
    # Tombstoned, not forgotten. A sender reporting twice must get the same
    # answer the second time rather than have the second report inserted.
    assert att.id in outbound_log._abandoned


# ════════════════════════════════════════════════════════════════════════════
# 5. A SUPPRESSED ROW CONTRIBUTES ZERO TO THE BILLABLE FIGURE
#
# `routers/billing.py` summed message units over EVERY email row with no filter
# on `status` or `mode`, and `OutboundLog.jsx` rendered the result as "Email
# message units". Staging runs `OUTBOUND_MODE=dry` and writes to the SAME
# `staging` schema production does, so a simulated E2E payroll — 1,136 rows the
# kill switch stopped — put 2,272 message units on that org's screen for
# messages that never left the building, beside a "Suppressed: 1,136" tile
# saying the opposite.
# ════════════════════════════════════════════════════════════════════════════

def test_a_suppressed_email_is_worth_no_billable_units():
    """The predicate, on its own, against 098's own authoritative query.

    098 verification (d) is `WHERE status='sent' AND detail->>'mode'='live'`,
    and this is that sentence in Python. Asserted per-case rather than only
    through the aggregate below so a regression names the row shape that broke.
    """
    from routers import billing

    # The one thing anybody was charged for.
    assert billing._units_bucket("email", "sent", "live") == billing._BILLABLE

    # Everything else, each under the name of why it is not a charge.
    assert billing._units_bucket("email", "suppressed", "dry") == \
        "ses_units_suppressed"
    assert billing._units_bucket("email", "suppressed", "live") == \
        "ses_units_suppressed"
    assert billing._units_bucket("email", "queued", "live") == \
        "ses_units_unresolved"
    assert billing._units_bucket("email", "failed", "live") == \
        "ses_units_unresolved"
    # A row that contradicts itself. It very probably DID cost money and it is
    # still not folded into the bill: a number somebody reconciles against an
    # invoice must not be moved by a row nobody can explain.
    assert billing._units_bucket("email", "sent", "dry") == "ses_units_bypassed"
    # NULL is not `live`. Claiming a charge on a mode we failed to read is the
    # same error as claiming a send we cannot prove.
    assert billing._units_bucket("email", "sent", None) == "ses_units_unresolved"

    # Push carries no `bytes` by design and `GREATEST(1, NULL)` is 1 in
    # Postgres, so a push row would otherwise weigh a unit it can never cost.
    for status in ("sent", "suppressed", "failed", "queued"):
        assert billing._units_bucket("push", status, "live") is None
        assert billing._units_bucket("social", status, "live") is None


async def test_a_simulated_payroll_run_bills_the_org_nothing(mock_pool):
    """The whole screen's arithmetic, on the run that produced the wrong tile.

    1,136 payslips at 2 units each. Every one suppressed, because staging is
    dry. The billable figure must be 0 and the suppressed figure must be 2,272,
    and they must be two DIFFERENT keys — a single total that happens to be
    right for a live org and wrong for a dry one is how this shipped.
    """
    from routers import billing

    conn = mock_pool.acquire.return_value
    conn.fetch.return_value = [{
        "channel": "email", "purpose": "payslip", "status": "suppressed",
        "mode": "dry", "n": 1136, "with_id": 0,
        "units": 2272,                       # 194,560 bytes -> 1 unit... x2 for
        "unmeasured": 0,                     # the base64 MIME. See section 6.
        "last_at": None,
    }]
    conn.fetchval.return_value = None

    body = await billing._outbound_body(ORG, None)      # the current month
    totals = body["totals"]

    assert totals[billing._BILLABLE] == 0, (
        "an org was shown %d billable message units for messages the kill "
        "switch stopped" % totals[billing._BILLABLE]
    )
    # The old name is the billable figure now, because `OutboundLog.jsx` reads
    # it and a tile showing the right number beats a tile showing nothing.
    assert totals["ses_units"] == 0
    assert totals["ses_units_suppressed"] == 2272, (
        "what it WOULD have cost is real information and must not be discarded "
        "along with the charge"
    )
    assert totals["suppressed"] == 1136
    assert totals["sent"] == 0
    # Two distinct figures, and the suppressed one is not inside the bill.
    assert totals["ses_units"] != totals["ses_units_suppressed"]
    # The four `ses_units_*` partition every email row in the window, so a
    # reader can add them up and never wonder where the rest went.
    assert (totals[billing._BILLABLE] + totals["ses_units_suppressed"]
            + totals["ses_units_bypassed"] + totals["ses_units_unresolved"]
            ) == 2272
    # And the screen is told which key is the charge, rather than guessing.
    assert body["ses_units_basis"]["billable_key"] == billing._BILLABLE
    assert "ses_units_suppressed" in body["ses_units_basis"]["not_billable_keys"]


# ════════════════════════════════════════════════════════════════════════════
# 6. A DRY-MODE PAYSLIP RECORDS THE MESSAGE SIZE, NOT THE PDF SIZE
#
# SES bills the base64-expanded MIME document — roughly 4/3 of the attachment
# plus the HTML and text parts — and `begin(..., bytes=len(pdf_bytes))` recorded
# the attachment. Wrong by a whole billed unit across the 140–195 KB band these
# slips land in. The LIVE path is exact (it records the real `RawMessage`
# length), so the AWS figure was safe; it is the DRY figure that was wrong, and
# the dry figure is every row an E2E run writes to the shared schema.
# ════════════════════════════════════════════════════════════════════════════

def _units(size) -> int:
    """`GREATEST(1, ceil(bytes / 262144.0))` — 098's arithmetic, in Python."""
    if not size:
        return 1                            # a NULL size is billed as one
    return max(1, -(-int(size) // 262_144))


async def test_a_suppressed_payslip_records_the_message_size_not_the_pdf_size(
    table,
):
    """No document is ever built on this path, so the estimate is the only
    figure that row will ever carry.

    A 190 KB PDF is ONE unit as a file and TWO as a message. Recording the file
    halved the largest send in the product, on the one table the August invoice
    is reconciled against.
    """
    from services import employee_email

    assert outbound.DRY_RUN is True, "conftest sets OUTBOUND_MODE=dry"
    pdf = b"%PDF-1.4" + b"\x00" * 194_552          # 190 KB, mid-band

    with outbound.org_scope(ORG, "user_mem001"):
        employee_email.send_payslip_email(
            "arjun.patel@client.example", "Arjun Patel", "August 2026",
            145_000, 118_320, "PS-2026-08-42", pdf_bytes=pdf,
        )
    await _settle()

    assert len(table.rows) == 1
    row = next(iter(table.rows.values()))
    assert row["status"] == outbound_log.STATUS_SUPPRESSED
    assert row["purpose"] == "payslip"

    # Not recomputed from a rebuilt template — that would assert this test's
    # copy of the email against itself. What is checked is the property the
    # bill turns on: the attachment is base64-expanded before SES sees it.
    assert row["bytes"] > employee_email._b64_bytes(len(pdf)) > len(pdf), (
        "the row records the PDF, not the message SES would have been handed"
    )
    # And the difference expressed as the thing that is actually invoiced.
    assert _units(len(pdf)) == 1
    assert _units(row["bytes"]) == 2, (
        "a suppressed payslip must record the two units the same send would "
        "really have cost — recording one is the under-count by 2x"
    )


# ════════════════════════════════════════════════════════════════════════════
# 7. A CRON LOOPING TWO ORGS FILES EACH SEND UNDER ITS OWN ORG
#
# Every org-scoped read of this table is `WHERE org_id = $1::uuid`, so a NULL
# org is a row no client will ever be shown — reminders and scheduled reports
# were invisible on `/me/outbound` and `/orgs/{id}/outbound` for every org,
# forever. `outbound.org_scope()` exists precisely for this and had zero
# callers.
#
# THE SECOND ORG IS THE POINT. A `set_org()` that never restores is the obvious
# fix and it is worse than the NULL it replaces: a `LIMIT 100` batch is whatever
# came due, from whichever tenants, so org A's value would still be in place for
# org B's reminder — a confidently wrong org on a money-adjacent log.
# ════════════════════════════════════════════════════════════════════════════

async def test_the_reminder_cron_files_each_org_under_its_own_org(
    table, monkeypatch, mock_pool,
):
    """Two orgs in one batch, and nothing underneath either of them.

    Driven through the real `process_pending_reminders` rather than a hand-made
    loop, because the thing being pinned is that THAT loop scopes itself — a
    test of `org_scope` in isolation would pass with the caller still missing,
    which is exactly the state defect 4 described.
    """
    from services import reminder_service

    reminders = [
        {"id": 1, "org_id": ORG, "channel": "email",
         "email": "one@client.example", "recipient_user_id": "user_mem001",
         "reminder_type": "invoice_overdue", "message": "Invoice overdue"},
        {"id": 2, "org_id": OTHER_ORG, "channel": "email",
         "email": "two@agency.example", "recipient_user_id": "user_mem002",
         "reminder_type": "task_due", "message": "Task due"},
    ]
    mock_pool.fetch.return_value = reminders

    async def _get_pool():
        return mock_pool

    monkeypatch.setattr(reminder_service, "get_pool", _get_pool)
    # THE CLOCK IS PINNED, and it has to be. `process_pending_reminders` now
    # consults quiet hours (they were ignored entirely until 2026-08-16), and
    # the default window is 22:00-07:00 IST — so without this the test passes
    # by day and fails by night. It is about ORG ATTRIBUTION; the hour has no
    # business deciding whether it runs.
    monkeypatch.setattr("services.push_service._in_quiet_hours",
                        lambda *a, **k: False)
    # There is no request underneath a cron, so the ContextVar starts unset —
    # which is the condition that produced the NULL org in the first place.
    assert outbound.current_org() is None

    result = await reminder_service.process_pending_reminders()
    assert result["sent"] == 2, "both reminders must still be sent"
    await _settle()

    rows = list(table.rows.values())
    assert len(rows) == 2, "one reminder is one row"
    by_recipient = {r["recipient"]: r for r in rows}

    assert by_recipient["one@client.example"]["org_id"] == uuid.UUID(ORG)
    assert by_recipient["two@agency.example"]["org_id"] == uuid.UUID(OTHER_ORG), (
        "the second reminder inherited the first org's value — a bare "
        "set_org() leaves the previous iteration's answer in place, and a "
        "confidently wrong org is worse than the NULL it replaced"
    )
    assert all(r["org_id"] is not None for r in rows), (
        "a NULL org is a row no client will ever be shown"
    )
    # 098 reserves `user_id` for who CAUSED the send. Nobody clicked a timer.
    assert all(r["user_id"] is None for r in rows)

    # AND IT PUTS BACK WHAT IT FOUND. The loop runs in a long-lived worker; a
    # scope that leaked would answer "the last reminder's org" for whatever the
    # process did next.
    assert outbound.current_org() is None, (
        "org_scope leaked the last reminder's org into the process"
    )
    # Asserted as a ROW as well as a ContextVar, because the row is what a
    # client is shown. A bare `set_org()` passes every assertion above and fails
    # this one: the next thing the worker does inherits OTHER_ORG and is filed
    # under a tenant that had nothing to do with it — confidently wrong, on the
    # table the AWS invoice is reconciled against.
    outbound.suppressed("email", "afterwards@nobody.example", "Unrelated")
    await _settle()
    stray = [r for r in table.rows.values()
             if r["recipient"] == "afterwards@nobody.example"]
    assert len(stray) == 1
    assert stray[0]["org_id"] is None, (
        "a send made after the loop was attributed to the last reminder's org"
    )


async def test_the_task_reminder_cron_files_each_org_under_its_own_org(
    table, monkeypatch, mock_pool,
):
    """The OTHER cron named in this defect, and the one nothing tested.

    `routers/task_reminders.py` fires from a Railway cron every few minutes and
    has the harder version of the problem: one tick dispatches reminders for
    many TEAMS, and the org is on the team rather than on the reminder — so the
    lookup can fail, and `_orgs_for` is written so that when it does the send
    still goes and the row is honestly NULL rather than guessed.

    A team with no org is included on purpose. `teams.org_id` is nullable and
    is NULL for 8 of 39 rows in this database, and the only correct answer for
    one of those is NULL — a third org must not be borrowed from the reminder
    before it.
    """
    from routers import task_reminders

    due = [
        {"reminder_id": "rem_1", "task_id": "task_1", "channel_inapp": False,
         "channel_push": False, "channel_email": True, "title": "File GSTR-1",
         "team_id": "team_a", "user_id": "user_mem001",
         "assignee_user_ids": ["user_mem001"], "due_at": None},
        {"reminder_id": "rem_2", "task_id": "task_2", "channel_inapp": False,
         "channel_push": False, "channel_email": True, "title": "Sign the MSA",
         "team_id": "team_b", "user_id": "user_mem002",
         "assignee_user_ids": ["user_mem002"], "due_at": None},
        {"reminder_id": "rem_3", "task_id": "task_3", "channel_inapp": False,
         "channel_push": False, "channel_email": True, "title": "Orphan team",
         "team_id": "team_c", "user_id": "user_mem003",
         "assignee_user_ids": ["user_mem003"], "due_at": None},
    ]
    teams = [{"team_id": "team_a", "org_id": ORG},
             {"team_id": "team_b", "org_id": OTHER_ORG},
             {"team_id": "team_c", "org_id": None}]        # nullable since 028
    emails = {"user_mem001": "one@client.example",
              "user_mem002": "two@agency.example",
              "user_mem003": "three@orphan.example"}

    conn = mock_pool.acquire.return_value
    conn.transaction.return_value.__aenter__ = _anoop(conn)
    conn.transaction.return_value.__aexit__ = _anoop(False)
    conn.fetch.return_value = due
    mock_pool.fetch.return_value = teams

    async def _fetchrow(sql, *args):
        return {"email": emails[args[0]], "name": "Somebody"}

    mock_pool.fetchrow.side_effect = _fetchrow
    monkeypatch.setattr(task_reminders, "DISPATCH_SECRET", "s" * 40)
    assert outbound.current_org() is None, "a cron has no request underneath it"

    result = await task_reminders.dispatch_reminders(
        request=None, pool=mock_pool, request_secret="",
        x_dispatch_secret="s" * 40,
    )
    assert result["dispatched"] == 3, "every reminder must still be sent"
    assert not result["errors"]
    await _settle()

    by_recipient = {r["recipient"]: r for r in table.rows.values()}
    assert set(by_recipient) == set(emails.values()), "one reminder, one row"

    assert by_recipient["one@client.example"]["org_id"] == uuid.UUID(ORG)
    assert by_recipient["two@agency.example"]["org_id"] == uuid.UUID(OTHER_ORG), (
        "the second team's reminder was filed under the first team's org"
    )
    assert by_recipient["three@orphan.example"]["org_id"] is None, (
        "a team with no org borrowed the previous reminder's — a guessed org "
        "on the table the AWS bill is reconciled against is worse than the "
        "NULL it replaced, because the gap is visible and the wrong answer "
        "is not"
    )
    # 098 reserves `user_id` for who CAUSED the send. A timer has no author.
    assert all(r["user_id"] is None for r in table.rows.values())
    assert outbound.current_org() is None, "the tick leaked an org into the worker"


def _anoop(value):
    """An `AsyncMock`-shaped stand-in that answers with `value`."""
    async def _call(*args, **kwargs):
        return value
    return _call
