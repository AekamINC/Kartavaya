"""What left the building, and the seven ways the record of it could lie.

WHY THIS FILE EXISTS. AWS said 2,586 of 3,000 SES message units had gone in
August and the product could not say what on. The answer took an hour of
inference from `staging.vetana_payslips` row counts and was still only a FLOOR,
because nothing in this product recorded a send. What that hour found — payroll
mailing every employee a payslip on every run, sixteen runs against an org of
71, all ~960 to `@example.com`, which RFC 2606 reserves and which can therefore
only ever hard-bounce against the SES identity production shares — was invisible
while it happened and unreconstructable afterwards, because Railway rotates logs
per deployment.

Migration 098 makes it a table and `services/outbound_log.py` is its one writer.
This file is the check on the pair.

THE FAILURE THIS SUITE IS ACTUALLY GUARDING AGAINST IS NOT "THE LOG IS WRONG".
It is "the log is wrong AND NOTHING SAYS SO", which is the same shape as the
original defect. Every path in that writer swallows its own exceptions on
purpose — `write()` cannot raise, `_lose` warns at most once a minute, and
`_went_dormant` discards the buffer and goes quiet for the life of the process
after one warning. That is correct behaviour for a logger on a send path and it
is also a suite-shaped hole: a writer that silently does nothing passes every
test that only checks it did not raise. So nothing below asserts "no exception".
Everything asserts on the ARGUMENTS ACTUALLY BOUND INTO THE REAL INSERT, decoded
back through the writer's own `_INSERT_COLUMNS`.

WHAT IS PINNED HERE

  1. A SUPPRESSED SEND IS 'suppressed', NEVER 'sent'. Including when the sender
     goes on to report a message id it cannot have — `OUTBOUND_MODE=dry` is set
     on staging, so this is the status of every row staging writes, and a
     suppressed row that reads 'sent' is the kill switch failing silently.
  2. A REAL SEND RECORDS THE PROVIDER'S MESSAGE ID. Both ways round: when the
     outcome beats the flush and collapses into one row, and when it arrives
     after and has to be matched back by correlation id.
  3. A FAILED SEND RECORDS THE ERROR AND DOES NOT CLAIM SUCCESS.
  4. A LOGGING FAILURE DOES NOT FAIL THE SEND. The one that matters, and the
     only one here whose subject is the product rather than the log.
  5. NO MESSAGE BODY IS WRITTEN. Not in a column, not in `detail`, and not as
     the social "subject" that `_guarded` was one mechanical edit away from
     persisting for 400 days.
  6. EVERY COLUMN THE WRITER NAMES EXISTS IN MIGRATION 098, in the style of
     tests/test_prachar_audience.py and for the reason it gives: this repo's
     recurring defect is Python naming a column Postgres does not have. Here it
     does not even surface as a 500 — 42703 sends the writer dormant, one
     warning into a log that rotates away, and then silence.
  7. TENANCY. An org admin cannot read another org's outbound log, and the
     recipient lookup — which is asked with an address rather than an org — is
     still scoped to one.

STYLE. Hand-written fakes and the conftest mock pool, per the house convention.
The mock pool is the seam because it is where the writer's translation stops
being reversible: after `pool.execute(_INSERT, *args)` there is nothing left to
inspect but thirteen parallel lists, which is exactly what `_rows_written`
decodes and exactly what Postgres would have stored.
"""
import json
import re
import uuid
from pathlib import Path

import asyncpg
import pytest

import outbound
from services import outbound_log


# ════════════════════════════════════════════════════════════════════════════
# HARNESS
# ════════════════════════════════════════════════════════════════════════════

MIGRATION = (Path(__file__).resolve().parents[1]
             / "migrations" / "098_outbound_log.sql")

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"


@pytest.fixture(autouse=True)
def reset_outbound_log():
    """Empty the writer's module state around every test in this file.

    It is a process-wide singleton holding a buffer, a correlation map, a
    dormancy flag and a drop counter, and the REST OF THE SUITE FILLS IT: every
    test anywhere that touches a sender runs `suppressed()` through `write()`,
    and conftest's `OUTBOUND_MODE=dry` guarantees they all do. Without this
    fixture a row queued by an unrelated test in an unrelated file arrives in
    the middle of one of these assertions, and the failure names this file.

    `_dormant` is the one that would be actively misleading: once any test
    provokes 42P01 the writer is off for the life of the PROCESS, so every
    later test here would assert against an empty buffer and pass by writing
    nothing at all.
    """
    def _clear():
        outbound_log._pending.clear()
        outbound_log._open_rows.clear()
        outbound_log._updates.clear()
        outbound_log._dormant = False
        outbound_log._dropped = 0
        outbound_log._last_warn = 0.0
        outbound_log._task = None

    _clear()
    yield
    _clear()


@pytest.fixture
def live_mode(monkeypatch):
    """Open the gate.

    conftest sets `OUTBOUND_MODE=dry` for the whole suite and calls it
    non-negotiable, so `outbound.DRY_RUN` is True everywhere by default and
    every send is suppressed. `begin()` re-reads the module global on each call
    — "read now, so a test may patch it" — which is the only reason the live
    path is testable at all. Patched, never set, so it cannot leak into another
    test and turn a mock into a real delivery.
    """
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    return False


def _rows_written(pool) -> list[dict]:
    """Every row actually bound into an INSERT, decoded back to a dict.

    The writer sends thirteen PARALLEL LISTS into an `UNNEST`, so the mapping
    from value to column is positional and lives in `_INSERT_COLUMNS`. Decoding
    through that same tuple is deliberate: it means a test reads a row exactly
    as Postgres would assemble one, and a reordering that silently files a
    subject under `recipient` shows up here as a wrong value rather than as a
    passing test.
    """
    rows: list[dict] = []
    calls = list(pool.execute.call_args_list) + list(pool.fetch.call_args_list)
    for call in calls:
        args = call.args
        if not args or "INSERT INTO public.outbound_log" not in str(args[0]):
            continue
        columns = args[1:]
        assert len(columns) == len(outbound_log._INSERT_COLUMNS), (
            "the INSERT was bound with a different number of lists than "
            "_INSERT_COLUMNS names — every value after the divergence is in "
            "the wrong column"
        )
        for values in zip(*columns):
            rows.append(dict(zip(outbound_log._INSERT_COLUMNS, values)))
    return rows


def _updates_written(pool) -> list[tuple[int, dict]]:
    """Every completion bound into the UPDATE, as (primary key, row)."""
    out: list[tuple[int, dict]] = []
    for call in pool.execute.call_args_list:
        args = call.args
        if not args or "UPDATE public.outbound_log" not in str(args[0]):
            continue
        ids, columns = args[1], args[2:]
        for row_id, values in zip(ids, zip(*columns)):
            out.append((row_id, dict(zip(outbound_log._UPDATE_COLUMNS, values))))
    return out


def _detail(row: dict) -> dict:
    """`detail` reaches the driver as a JSON string; read it as 098 would."""
    return json.loads(row["detail"])


def _boom(*args, **kwargs):
    raise RuntimeError("the outbound log is broken")


# ════════════════════════════════════════════════════════════════════════════
# 1. A SUPPRESSED SEND IS 'suppressed', NEVER 'sent'
#
# This is the status of EVERY row staging writes — `OUTBOUND_MODE=dry` is set
# there and production is the only environment that sends. Both share one
# `staging` schema, so these rows and production's sit in the same table and
# the only thing separating them is `status` and `detail.mode`.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_suppressed_send_is_logged_as_suppressed(mock_pool):
    assert outbound.DRY_RUN is True, "conftest sets OUTBOUND_MODE=dry"

    blocked = outbound.suppressed(
        "email", "arjun.patel@client.example", "Payslip for August 2026",
        org_id=ORG, ref="payslip:PS-2026-08-42", bytes=41_000,
    )

    assert blocked is True, "the gate must still stop the send"
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1, "one attempt is one row"
    row = rows[0]

    assert row["status"] == outbound_log.STATUS_SUPPRESSED == "suppressed"
    assert row["status"] != outbound_log.STATUS_SENT
    # 098: "A suppressed row with a provider set would be claiming a decision
    # that was never made" — the kill switch returns before any client is
    # touched, so there is no carrier and no receipt.
    assert row["provider"] is None
    assert row["provider_message_id"] is None
    # There is no `mode` column. This key is the only thing on the row that
    # says which environment produced it, and both write to the same schema.
    assert _detail(row)["mode"] == "dry"
    # The attempt is still fully described: a suppressed send is the one case
    # where knowing what it WOULD have cost is the entire point.
    assert row["recipient"] == "arjun.patel@client.example"
    assert row["bytes"] == 41_000
    assert row["purpose"] == "payslip"
    assert _detail(row)["ref"] == "payslip:PS-2026-08-42"


async def test_a_suppressed_attempt_cannot_be_completed_as_sent(mock_pool):
    """A sender that reports a message id it cannot have is ignored.

    Nothing was handed to a provider, so there is no id to report and no
    outcome to record. `Attempt._closed` starts True for a blocked send for
    exactly this reason, and the guarantee is worth pinning because the sender
    reporting the outcome is on the far side of a `threading.Thread` from the
    gate that blocked it — `email_service` completes its row from a thread that
    never sees `att.blocked`.
    """
    att = outbound.begin("email", "arjun.patel@client.example", "August payslip")
    assert att.blocked is True

    att.sent("0100018f-ses-message-id", provider="ses", bytes=52_000)
    att.failed(RuntimeError("or this"))
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert [r["status"] for r in rows] == ["suppressed"]
    assert not _updates_written(mock_pool), (
        "a suppressed row has no second half to complete"
    )
    assert rows[0]["provider_message_id"] is None
    assert rows[0]["error"] is None


async def test_suppressed_is_never_folded_into_sent(mock_pool):
    """Across every channel in the product, dry mode produces no 'sent' row.

    Stated over all four families rather than over email alone, because the
    kill switch is per-channel at the choke point and the one that gets
    forgotten is whichever sender was added last.
    """
    for channel, target in (
        ("email", "arjun.patel@client.example"),
        ("push:expo", "user_549c9cac35aa"),
        ("push:web", "user_549c9cac35aa"),
        ("social:facebook", "104857600"),
        ("social:whatsapp_business", "919876543210"),
    ):
        outbound.suppressed(channel, target, "subject")

    await outbound_log.flush()
    rows = _rows_written(mock_pool)

    assert len(rows) == 5
    assert {r["status"] for r in rows} == {"suppressed"}
    assert all(_detail(r)["mode"] == "dry" for r in rows)
    # 098's verification query (e) — "did anything bypass the kill switch" —
    # must return zero rows forever. This is that query, asserted at the source.
    assert not [r for r in rows
                if _detail(r)["mode"] == "dry" and r["status"] in ("sent", "failed")]


# ════════════════════════════════════════════════════════════════════════════
# 2. A REAL SEND RECORDS THE PROVIDER'S MESSAGE ID
#
# The id is the ONLY string tying a row here to a record on the provider's
# side. SES accepted all 960 payslips and bounced them seconds later; without
# the MessageId stored at send time there is nothing for a delivery event to be
# about, and "sent" stays an assertion rather than a receipt.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_real_send_records_the_providers_message_id(mock_pool, live_mode):
    """The outcome beats the flush: one row, already final."""
    att = outbound.begin(
        "email", "keval@aekam.example", "August payslip",
        org_id=ORG, bytes=41_000,
    )
    assert att.blocked is False

    att.sent("0100018f-c0ffee-SES", provider="ses", bytes=52_000)
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    # The collapse is the point, not an optimisation detail: a count of rows in
    # this table has to stay a count of MESSAGES, or the figure reconciled
    # against the AWS bill double-counts every email that reported an outcome.
    assert len(rows) == 1
    row = rows[0]

    assert row["status"] == "sent"
    assert row["provider_message_id"] == "0100018f-c0ffee-SES"
    assert row["provider"] == "ses"
    # The completion's size supersedes the attempt's estimate — `send_email`
    # sizes the HTML before the gate and adds the text alternative after.
    assert row["bytes"] == 52_000
    assert _detail(row)["mode"] == "live"
    # No correlation id on a row that is already final; it is only carried
    # while a row can still be completed.
    assert "event" not in _detail(row)
    assert not _updates_written(mock_pool)


async def test_an_outcome_after_the_flush_completes_the_row_it_belongs_to(
    mock_pool, live_mode,
):
    """The slow path, and the reason the correlation id is read back by NAME.

    When the provider answers after the batch has gone, the row is already in
    the table under a key the database chose, and the completion has to find it
    again. The writer reads `id` back alongside `detail->>'event'` rather than
    zipping RETURNING against input order — that order is not guaranteed, and
    the failure it would produce is A PROVIDER'S MESSAGE ID FILED AGAINST
    SOMEBODY ELSE'S EMAIL, which is worse than no id at all and looks fine.

    So this test flushes TWO attempts and hands the ids back in the reverse
    order, which is the arrangement a positional match gets exactly wrong.
    """
    first = outbound.begin("email", "arjun@client.example", "Payslip A", org_id=ORG)
    second = outbound.begin("email", "priya@client.example", "Payslip B", org_id=ORG)

    # asyncpg hands back Records; dicts index identically and `_remember` only
    # ever reads them by key. Reversed on purpose.
    mock_pool.fetch.return_value = [
        {"id": 902, "event": str(second.id)},
        {"id": 901, "event": str(first.id)},
    ]
    await outbound_log.flush()

    inserted = _rows_written(mock_pool)
    assert {r["status"] for r in inserted} == {"queued"}, (
        "the gate opened and the provider has not answered yet"
    )
    # The correlation id rides in `detail` only while the row is completable.
    assert {_detail(r)["event"] for r in inserted} == {str(first.id), str(second.id)}

    first.sent("SES-FIRST", provider="ses")
    second.failed(RuntimeError("554 Message rejected"), provider="ses")
    await outbound_log.flush()

    updates = dict(_updates_written(mock_pool))
    assert set(updates) == {901, 902}
    assert updates[901]["status"] == "sent"
    assert updates[901]["provider_message_id"] == "SES-FIRST"
    assert updates[902]["status"] == "failed"
    assert updates[902]["provider_message_id"] is None
    assert "554 Message rejected" in updates[902]["error"]
    # Two attempts and two completions are still two rows, never four.
    assert len(inserted) == 2


async def test_a_send_that_never_reports_stays_queued(mock_pool, live_mode):
    """'The block finished' is not evidence the provider accepted anything.

    098 is emphatic that a row still reading 'queued' an hour later IS the
    finding — the process died between the provider call and the answer — so a
    sender that forgets to report must leave an honest 'queued' rather than an
    optimistic 'sent'. Railway redeploys this service constantly, which is the
    exact way the original log history was lost.
    """
    with outbound.sending("email", "arjun@client.example", "Payslip") as att:
        assert att.blocked is False
        pass                                 # neither reports nor raises

    await outbound_log.flush()
    rows = _rows_written(mock_pool)
    assert [r["status"] for r in rows] == ["queued"]
    assert rows[0]["provider_message_id"] is None


# ════════════════════════════════════════════════════════════════════════════
# 3. A FAILED SEND RECORDS THE ERROR AND DOES NOT CLAIM SUCCESS
# ════════════════════════════════════════════════════════════════════════════

async def test_a_failed_send_records_the_error_and_claims_nothing(
    mock_pool, live_mode,
):
    att = outbound.begin("email", "nobody@example.com", "August payslip", org_id=ORG)
    att.failed(
        RuntimeError("554 Message rejected: Email address is not verified"),
        provider="ses",
    )
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    row = rows[0]

    assert row["status"] == outbound_log.STATUS_FAILED == "failed"
    assert row["status"] not in ("sent", "queued")
    # The exception TYPE as well as its text: "554 Message rejected" and a
    # ConnectionResetError carrying the same string are different faults, and
    # the type is the half that says which.
    assert "RuntimeError" in row["error"]
    assert "554 Message rejected" in row["error"]
    assert row["provider_message_id"] is None, "a refusal has no receipt"
    assert row["provider"] == "ses", "the carrier that refused it is still known"


async def test_the_first_answer_wins_and_a_failure_is_not_overwritten(
    mock_pool, live_mode,
):
    """A retry loop that reports twice does not turn a failure into a send.

    `_finish` closes the attempt on the first answer. Without that a sender
    whose second attempt succeeded would leave one row that says 'sent' and no
    record that anything failed — and the count of failures is the standing
    question nobody could ask at all, which is why 960 bounces were invisible.
    """
    att = outbound.begin("email", "nobody@example.com", "August payslip")
    att.failed(RuntimeError("first, and true"))
    att.sent("SES-SECOND", provider="ses")

    await outbound_log.flush()
    rows = _rows_written(mock_pool)

    assert [r["status"] for r in rows] == ["failed"]
    assert rows[0]["provider_message_id"] is None
    assert "first, and true" in rows[0]["error"]


async def test_an_exception_out_of_a_sending_block_is_recorded_and_re_raised(
    mock_pool, live_mode,
):
    """`sending()` exists so the failure branch cannot be forgotten.

    And the re-raise is half the contract: the sender's error stays the
    sender's to handle. A context manager that swallowed it to write a tidy row
    would turn a logging feature into a behaviour change on the send path.
    """
    with pytest.raises(ConnectionResetError):
        with outbound.sending("social:facebook", "104857600", "post text") as att:
            assert att.blocked is False
            raise ConnectionResetError("Meta closed the connection")

    await outbound_log.flush()
    rows = _rows_written(mock_pool)

    assert [r["status"] for r in rows] == ["failed"]
    assert "ConnectionResetError" in rows[0]["error"]
    assert "Meta closed the connection" in rows[0]["error"]


async def test_a_long_error_is_truncated_and_never_discards_the_row(
    mock_pool, live_mode,
):
    """098 asks for the cap to TRUNCATE, never to drop.

    A CHECK on length would lose the log row for the longest error message,
    which is invariably the interesting one — a provider that answers with a
    wall of XML is describing something worth reading the front of.
    """
    att = outbound.begin("email", "nobody@example.com", "Subject")
    att.failed("E" * 5_000)
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1, "the row survived"
    assert len(rows[0]["error"]) == outbound_log._MAX_ERROR
    assert rows[0]["status"] == "failed"


# ════════════════════════════════════════════════════════════════════════════
# 4. A LOGGING FAILURE DOES NOT FAIL THE SEND
#
# THE ONE THAT MATTERS. Everything else here is about the log being right; this
# is about the log being unable to make the PRODUCT wrong. An email that did
# not go because the log was down would be a worse product than no log at all,
# and it would be a self-inflicted outage caused by an observability feature —
# the least defensible kind.
#
# 098 says the same thing from the schema side, and it is why that file is
# allowed to constrain anything: "A LOG ROW FAILING MUST NEVER FAIL A SEND."
# ════════════════════════════════════════════════════════════════════════════

def test_write_cannot_raise_even_when_its_own_internals_do(monkeypatch):
    """Every path inside `write()` is under the try, including the scheduling."""
    monkeypatch.setattr(outbound_log, "_row", _boom)
    outbound_log.write(id=uuid.uuid4(), channel="email", status="sent")

    monkeypatch.setattr(outbound_log, "_schedule", _boom)
    monkeypatch.undo()
    monkeypatch.setattr(outbound_log, "_schedule", _boom)
    outbound_log.write(id=uuid.uuid4(), channel="email", status="sent",
                       target="a@b.example")


def test_the_gate_still_answers_when_the_writer_is_broken(monkeypatch):
    """`suppressed()` and `begin()` are the first line of every sender.

    If a broken logger could raise here, it would not merely lose a row — it
    would take down every email, push and social post in the product at the
    line that decides whether they are allowed to happen.
    """
    monkeypatch.setattr(outbound_log, "write", _boom)

    assert outbound.suppressed("email", "arjun@client.example", "Subject") is True

    att = outbound.begin("email", "arjun@client.example", "Subject")
    assert att.blocked is True
    att.sent("id")                            # completing must not raise either
    att.failed(RuntimeError("nor this"))


def test_a_dead_outbound_log_does_not_stop_an_email(monkeypatch, mock_pool):
    """END TO END, through the real sender, with logging comprehensively dead.

    This is the assertion the whole section is for. The subject is
    `email_service.send_email` — the single choke point every email in the
    product goes through — and the question is whether a broken log can stop
    one reaching the provider. It must not, and 'must not' has to be proved at
    the provider boundary, because that is the only place the omission would be
    observable; every layer above it returns True either way.
    """
    import email_service as E

    captured = {}

    class _SES:
        def send_email(self_, **kwargs):
            captured.update(kwargs)
            return {"MessageId": "ses-message-id"}

    monkeypatch.setattr(E, "ses_client", _SES())
    monkeypatch.setattr(
        E.threading, "Thread",
        lambda target, **kw: type("T", (), {"start": staticmethod(target)})(),
    )
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    monkeypatch.setattr(outbound_log, "write", _boom)

    ok = E.send_email("keval@aekam.example", "August payslip",
                      "<!DOCTYPE html><html><body><p>Payslip</p></body></html>")

    assert ok is True
    assert captured.get("Message"), "the provider was never called — logging blocked a send"
    assert captured["Destination"]["ToAddresses"] == ["keval@aekam.example"]


async def test_a_database_that_refuses_the_row_does_not_raise_and_is_counted(
    mock_pool,
):
    """A transient database failure costs rows, and says how many.

    `dropped()` is the honesty counter. A log that under-counts silently is the
    thing this table exists to stop being, so the number of rows it knows it
    lost has to be readable from inside the process — it is the only evidence
    that a figure taken from this table is a floor.
    """
    mock_pool.execute.side_effect = asyncpg.exceptions.DeadlockDetectedError(
        "deadlock detected")

    outbound.suppressed("email", "arjun@client.example", "Subject")
    written = await outbound_log.flush()

    assert written == 0
    assert outbound_log.dropped() >= 1
    # NOT dormant: a database that is merely down must not permanently disable
    # the log. Only a table that is not what we were promised does that.
    assert outbound_log._dormant is False


async def test_an_unapplied_migration_goes_quiet_instead_of_flooding(mock_pool):
    """42P01 is 'migration 098 is not applied', and it is not transient.

    Retrying it forever would cost a warning per send on the highest-insert
    path in the product, and Railway charges for the compute that writes logs
    it then rotates away. So the writer goes dormant after one warning — which
    is deliberate, documented, and the single most dangerous behaviour in the
    module, because dormancy is indistinguishable from "nothing was sent".

    Pinned here so the cost is visible in a test rather than discovered from an
    empty table: after this, THE PROCESS WRITES NOTHING UNTIL IT IS RESTARTED.
    """
    mock_pool.execute.side_effect = asyncpg.exceptions.UndefinedTableError(
        'relation "public.outbound_log" does not exist')

    outbound.suppressed("email", "arjun@client.example", "Subject")
    await outbound_log.flush()
    assert outbound_log._dormant is True

    # And the send path still works, which is the whole point of going quiet.
    mock_pool.execute.side_effect = None
    mock_pool.execute.reset_mock()
    assert outbound.suppressed("email", "arjun@client.example", "Subject") is True
    await outbound_log.flush()
    assert _rows_written(mock_pool) == [], (
        "dormancy is per-process and nothing resets it — 098 step 2 says "
        "REDEPLOY THE BACKEND after applying, and this is why"
    )


async def test_a_missing_pool_costs_the_row_and_nothing_else(mock_pool, monkeypatch):
    """No database at all — startup, shutdown, a lost connection."""
    async def _no_pool():
        raise RuntimeError("pool is not initialised")

    monkeypatch.setattr(outbound_log, "get_pool", _no_pool)
    outbound.suppressed("email", "arjun@client.example", "Subject")

    assert await outbound_log.flush() == 0
    assert outbound_log.dropped() >= 1


async def test_one_bad_row_does_not_cost_the_batch(mock_pool):
    """The salvage path 098 prices its every CHECK against.

    Left in dry mode deliberately. A suppressed row is already FINAL, so the
    writer inserts it with `pool.execute`; a 'queued' row is still completable
    and goes through `pool.fetch` to read its assigned key back. Only the first
    of those is the plain batched INSERT this salvage path guards.

    That file permits constraints ONLY because `_write_batch` catches SQLSTATE
    class 23 and re-runs the batch a row at a time, so a violation costs the
    offending row and the other 499 land. Its header says in terms: "If that
    salvage path is ever removed, every CHECK in this file has to be
    reconsidered in the same commit." This is the test that notices.
    """
    calls = {"n": 0}

    async def _execute(sql, *args):
        if "INSERT INTO public.outbound_log" not in str(sql):
            return "UPDATE 0"
        calls["n"] += 1
        # The batched statement fails; the per-row retries succeed.
        if len(args[0]) > 1:
            raise asyncpg.exceptions.CheckViolationError(
                'new row violates check constraint "outbound_log_channel_ck"')
        return "INSERT 0 1"

    mock_pool.execute.side_effect = _execute

    for i in range(4):
        outbound.suppressed("email", f"person{i}@client.example", "Subject")
    written = await outbound_log.flush()

    assert written == 4, "three good rows must not die with the fourth"
    assert calls["n"] == 5, "one batched attempt, then four single-row retries"


# ════════════════════════════════════════════════════════════════════════════
# 5. NO MESSAGE BODY IS WRITTEN TO THE TABLE
#
# A payslip body contains somebody's salary. A campaign body is the client's own
# content, posted through the client's own OAuth token. This table is read by
# support, by whoever reconciles the AWS bill, and one day by whoever is
# debugging at 2am — none of whom should be reading salaries to find out
# whether an email went out.
# ════════════════════════════════════════════════════════════════════════════

async def test_the_four_body_keys_are_stripped_before_they_reach_the_table(
    mock_pool,
):
    """Stripped by the writer, not refused by the constraint.

    098 calls its `outbound_log_no_body_ck` a tripwire and not a boundary, and
    asks for the stripping to happen here — because relying on the CHECK costs
    the ROW, and costs it silently. A caller reaching for `body` should lose a
    key, not the record that a payslip was sent.
    """
    salary = "Gross 1,45,000. Net pay 1,18,320. PF 12,600."

    outbound_log.write(
        id=uuid.uuid4(), channel="email", status="sent",
        target="arjun.patel@client.example", subject="Payslip for August 2026",
        detail={"body": salary, "html": salary, "text": salary,
                "content": salary, "ref": "payslip:PS-2026-08-42",
                "run": "PR-2026-08"},
    )
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1, "the row survived — a lost key, not a lost record"
    detail = _detail(rows[0])

    for forbidden in outbound_log._FORBIDDEN_DETAIL_KEYS:
        assert forbidden not in detail
    # Names of things survive; contents of things do not.
    assert detail["ref"] == "payslip:PS-2026-08-42"
    assert detail["run"] == "PR-2026-08"
    # Not in `detail`, and not anywhere else on the row either.
    assert salary not in str(rows[0])


async def test_a_body_key_in_any_case_is_still_a_body_key(mock_pool):
    """`Body`, `HTML`, `Text` — the constraint tests the exact lowercase name.

    So a capitalised key would sail past `outbound_log_no_body_ck` as well as
    past a stripper that only matched lowercase, and land in the table. The
    writer lowercases before comparing; this is the check that it keeps doing so.
    """
    salary = "Net pay 1,18,320."
    outbound_log.write(
        id=uuid.uuid4(), channel="email", status="sent", target="a@b.example",
        detail={"Body": salary, "HTML": salary, "Text": salary,
                "Content": salary},
    )
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert _detail(rows[0]) == {"mode": "live"}
    assert salary not in str(rows[0])


async def test_a_social_post_never_stores_its_own_text(mock_pool, live_mode):
    """THE TRAP 098 SPENT A PARAGRAPH ON, because it nearly fired.

    `services/social_publisher._guarded` passes `(text or "")[:80]` as its
    `detail` argument — the first 80 characters of the CUSTOMER'S OWN POST.
    `begin(channel, target, detail)` kept the positional signature of the old
    `suppressed()` and maps `detail` onto the subject, so the mechanical
    conversion of that call (change the name, keep the arguments) would have
    started persisting client post content for 400 days and would have looked
    correct in review.

    `_NO_SUBJECT_CHANNELS` closes it structurally. A social post has no
    subject; NULL is the correct value there, not missing data, and a future
    author who "fixes" that NULL reopens the hole. Hence this test.
    """
    post = ("Diwali offer: 20% off every retainer signed this month. "
            "Talk to us about your books before the GST deadline.")

    with outbound.sending("social:facebook", "104857600", post[:80]) as att:
        att.sent("104857600_98765", provider="meta")

    await outbound_log.flush()
    rows = _rows_written(mock_pool)
    row = rows[0]

    assert row["channel"] == "social"
    assert row["subject_or_title"] is None, (
        "a social post has no subject and NULL is the right value"
    )
    assert post[:80] not in str(row)
    # Everything that answers a question is still there.
    assert row["recipient"] == "104857600"
    assert row["provider"] == "meta"
    assert row["provider_message_id"] == "104857600_98765"


async def test_an_email_subject_is_clipped_rather_than_stored_whole(mock_pool):
    """200 characters, which doubles as the ceiling on anything mistaken for one.

    A sender that passes a body where a subject belongs gets 200 characters of
    it rather than all of it — which is a bug to fix, not a disclosure to
    discover a year later at the size of a mail merge.
    """
    outbound.suppressed("email", "a@b.example", "S" * 4_000)
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows[0]["subject_or_title"]) == outbound_log._MAX_SUBJECT == 200


def test_no_column_on_this_table_could_hold_a_body():
    """The structural half: there is nowhere to put one.

    Asserted against the migration rather than against the writer, because a
    column added to 098 in a later migration is exactly how a well-meaning
    "just the first bit for debugging" would arrive.
    """
    declared = set(_declared_columns())
    for forbidden in outbound_log._FORBIDDEN_DETAIL_KEYS:
        assert forbidden not in declared, (
            f"098 declares a `{forbidden}` column — this table stores no "
            f"message content"
        )
    assert not declared & {"payload", "message", "raw", "attachment"}


# ════════════════════════════════════════════════════════════════════════════
# 6. EVERY COLUMN THE WRITER NAMES EXISTS IN MIGRATION 098
#
# In the style of tests/test_prachar_audience.py and for the reason it gives:
# the recurring failure in this repo is Python naming a column Postgres does not
# have. There it surfaced as an opaque 500 on every campaign send. HERE IT DOES
# NOT SURFACE AT ALL — 42703 sets `_dormant`, discards the buffer, logs one
# warning into a Railway log that rotates away, and the process never writes
# again. 098's own header: "A DISAGREEMENT BETWEEN THEM IS SILENT, WHICH IS WHY
# THIS PARAGRAPH IS LONG."
#
# The two files are ONE CONTRACT and they are coupled BY NAME in both
# directions. This section is that contract, checked without a database.
# ════════════════════════════════════════════════════════════════════════════

def _sql() -> str:
    """The migration with its line comments removed.

    The commentary is longer than the DDL and quotes column names, constraint
    names and whole queries — parsing it would make this section assert against
    its own prose, which is the way test_prachar_audience.py failed on its first
    run and says so.
    """
    text = MIGRATION.read_text(encoding="utf-8")
    return "\n".join(re.sub(r"--.*$", "", line) for line in text.splitlines())


def _create_table() -> str:
    """The body of the CREATE TABLE, between its outermost parentheses."""
    sql = _sql()
    start = sql.index("CREATE TABLE IF NOT EXISTS staging.outbound_log")
    open_at = sql.index("(", start)
    depth = 0
    for i in range(open_at, len(sql)):
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
            if depth == 0:
                return sql[open_at + 1:i]
    raise AssertionError("unbalanced parentheses in the CREATE TABLE")


def _top_level_items(body: str) -> list[str]:
    """Split a column list on the commas that are not inside parentheses."""
    items, depth, current = [], 0, []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            items.append("".join(current))
            current = []
        else:
            current.append(char)
    items.append("".join(current))
    return [" ".join(item.split()) for item in items if item.strip()]


def _declared_columns() -> dict[str, str]:
    """Column name -> declared type, from 098's CREATE TABLE."""
    columns = {}
    for item in _top_level_items(_create_table()):
        if item.upper().startswith("CONSTRAINT"):
            continue                          # a table constraint, not a column
        parts = item.split()
        if len(parts) >= 2:
            columns[parts[0]] = parts[1].upper()
    return columns


def _named_columns(statement: str, marker: str) -> list[str]:
    """The identifier list following `marker` in one of the writer's statements."""
    at = statement.index(marker)
    open_at = statement.index("(", at)
    depth, end = 0, None
    for i in range(open_at, len(statement)):
        if statement[i] == "(":
            depth += 1
        elif statement[i] == ")":
            depth -= 1
            if depth == 0:
                end = i
                break
    return [name.strip() for name in statement[open_at + 1:end].split(",")]


def test_every_column_the_writer_inserts_exists_in_migration_098():
    declared = _declared_columns()
    missing = [c for c in outbound_log._INSERT_COLUMNS if c not in declared]
    assert not missing, (
        f"services/outbound_log.py INSERTs {missing}, which migration 098 does "
        f"not declare. This is 42703: the writer goes dormant after one warning "
        f"and the process records nothing further."
    )


def test_every_column_the_writer_updates_exists_in_migration_098():
    declared = _declared_columns()
    missing = [c for c in outbound_log._UPDATE_COLUMNS if c not in declared]
    assert not missing, f"the completion UPDATE names {missing}, which 098 lacks"
    # The UPDATE keys on the primary key the database assigned and `_remember`
    # read back; without it there is nothing to complete a row by.
    assert "id" in declared


def test_the_insert_statement_and_the_column_tuple_cannot_drift():
    """`_INSERT` names the columns; `_INSERT_COLUMNS` orders the values.

    They are maintained separately and the binding between them is POSITIONAL,
    so a column inserted into one and not the other does not fail — it files
    every value after the divergence under the wrong name. A recipient stored as
    a subject and a subject stored as a recipient is a personal-data leak onto a
    screen a client's own admin can open, and nothing about the row looks wrong.
    """
    assert _named_columns(outbound_log._INSERT, "INSERT INTO") == \
        list(outbound_log._INSERT_COLUMNS)

    assert _named_columns(outbound_log._UPDATE, "AS u") == \
        ["id", *outbound_log._UPDATE_COLUMNS]


def test_the_writer_never_names_the_generated_key():
    """098 makes `id` GENERATED ALWAYS: naming it is an error, not an override."""
    assert "id" not in outbound_log._INSERT_COLUMNS
    assert "GENERATED ALWAYS AS IDENTITY" in _create_table()


def test_the_migrations_own_verification_list_matches_the_writer():
    """098 step 2 hardcodes the thirteen names it expects the writer to use.

    That query is what somebody runs against the live database after applying
    the file, and it is the ONLY check that a rename has not silenced the
    writer. If the writer's tuple moves and that array does not, the check
    passes against a table the writer can no longer write to.
    """
    array = re.search(r"unnest\(ARRAY\[(.*?)\]\)", _sql(), re.S)
    assert array, "098's verification step 2 has lost its column array"
    expected = re.findall(r"'([a-z_]+)'", array.group(1))
    assert expected == list(outbound_log._INSERT_COLUMNS)


def test_the_two_id_columns_keep_their_two_different_types():
    """The scar from migrations 030 and 092, and it matters twice on this row.

    A user id in this product is TEXT of the form `user_549c9cac35aa`, because
    `public.users.user_id` is text. 030 cost "500 errors on every INSERT"; 092
    cost a sales target that could never be saved by anyone, in any org,
    surfacing in the browser as a CORS error with no body.

    Here `user_id` holds who caused the send AND `recipient` holds a user id
    whenever the channel is push. `org_id` is UUID because
    `staging.organisations.id` is. Two id columns, two types, one row.
    """
    declared = _declared_columns()
    assert declared["user_id"] == "TEXT"
    assert declared["recipient"] == "TEXT"
    assert declared["org_id"] == "UUID"
    assert declared["id"] == "BIGINT"


def test_the_channel_vocabulary_is_the_same_on_both_sides():
    """`channel` is CHECKed, so a value outside it makes NO row, not a wrong one.

    And the writer drops an unmappable channel deliberately rather than filing
    it under a legal-looking family — a row under the wrong family is a wrong
    answer to "what did we send this org" and nothing about it looks wrong
    afterwards. Both halves of that only work if the two lists agree.
    """
    check = re.search(r"CHECK \(channel IN \((.*?)\)\)", _sql(), re.S)
    assert check, "outbound_log_channel_ck has lost its vocabulary"
    assert set(re.findall(r"'(\w+)'", check.group(1))) == outbound_log._LEGAL_CHANNELS

    # And every sub-channel the senders speak maps onto one of them.
    for family, _provider in outbound_log._SUBCHANNELS.values():
        assert family in outbound_log._LEGAL_CHANNELS


def test_the_status_vocabulary_is_the_same_on_both_sides():
    """Four words, and the partial index is a SECOND place two of them live.

    `idx_outbound_log_trouble` is `WHERE status IN ('queued','failed')`. 098
    warns that widening the CHECK without widening that predicate makes the new
    status invisible to the only query that looks for trouble — which is silent
    under-reporting on the one screen built to find it.
    """
    check = re.search(r"CHECK \(status IN \((.*?)\)\)", _sql(), re.S)
    assert check
    declared = set(re.findall(r"'(\w+)'", check.group(1)))

    assert declared == {
        outbound_log.STATUS_QUEUED, outbound_log.STATUS_SENT,
        outbound_log.STATUS_SUPPRESSED, outbound_log.STATUS_FAILED,
    }
    # The old spelling still exported for senders written before the word
    # settled. Both names must keep producing the same legal row.
    assert outbound_log.STATUS_ATTEMPTED in declared
    assert outbound_log._OPEN_STATUSES <= declared

    trouble = re.search(
        r"idx_outbound_log_trouble.*?WHERE status IN \((.*?)\)", _sql(), re.S)
    assert trouble, "the trouble index has lost its predicate"
    assert set(re.findall(r"'(\w+)'", trouble.group(1))) <= declared


def test_the_constraints_the_writer_quotes_by_name_exist():
    """The writer names these back at 098 in its warnings and its coercions.

    Renaming one here makes a warning point at nothing, and makes `_as_bytes`
    and `_detail` guard a rule that is no longer there.
    """
    sql = _sql()
    for name in ("outbound_log_channel_ck", "outbound_log_status_ck",
                 "outbound_log_bytes_ck", "outbound_log_no_body_ck"):
        assert name in sql

    # `_split_channel` prints this constraint name when it drops a row.
    import inspect
    assert "outbound_log_channel_ck" in inspect.getsource(outbound_log._split_channel)


def test_the_no_body_constraint_names_exactly_the_keys_the_writer_strips():
    """Belt and braces have to be the same size.

    The writer strips four keys before they arrive and the CHECK refuses the
    same four. A key added to the CHECK and not to the stripper costs the ROW
    when somebody uses it; one added to the stripper and not the CHECK is a
    tripwire that no longer covers what it advertises.
    """
    check = re.search(r"CONSTRAINT outbound_log_no_body_ck CHECK \((.*?)\)\s*\)",
                      _sql(), re.S)
    assert check
    assert set(re.findall(r"detail \? '(\w+)'", check.group(1))) == \
        set(outbound_log._FORBIDDEN_DETAIL_KEYS)


def test_the_reader_in_billing_names_only_columns_098_declares():
    """The reader is the third file in this contract and fails differently.

    `services/outbound_log.py` answers 42703 by going dormant. `routers/
    billing.py` answers it with a 503 that names the migration — because an
    empty result on that screen reads as "nothing was sent", which is the one
    sentence this whole feature exists to stop anyone saying without evidence.
    Both are correct responses to a drift that should not be possible, so the
    drift is checked here instead.
    """
    declared = set(_declared_columns())
    # Every column name the outbound section selects or filters on.
    read = {
        "id", "ts", "org_id", "channel", "purpose", "recipient",
        "subject_or_title", "status", "provider", "provider_message_id",
        "bytes", "error", "detail",
    }
    assert read <= declared

    import routers.billing as B
    assert B._OUTBOUND == "public.outbound_log"
    # The reader offers exactly the statuses the CHECK allows, so a drill-down
    # can never open on a value the column cannot hold.
    assert set(B._KNOWN_STATUSES) == {
        outbound_log.STATUS_QUEUED, outbound_log.STATUS_SENT,
        outbound_log.STATUS_SUPPRESSED, outbound_log.STATUS_FAILED,
    }


# ════════════════════════════════════════════════════════════════════════════
# 7. TENANCY
#
# These rows name a client's employees and its customers BY ADDRESS. That makes
# this log the most personal thing in the billing console, and it is reached
# through two doors with different keys: `/me/*` is the org's own admin, and
# `/orgs/{id}/*` is Aekam's finance console over anybody.
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def as_org_admin(app, member_user, mock_pool):
    """A member holding `org_admin` in ORG and no platform role at all.

    conftest's `as_admin` answers 'platform_admin' to the platform-role query,
    which is the one thing these tests must NOT have — it is the whole
    difference between the two families of routes. Modelled on the fixture of
    the same name in tests/test_billing_lines.py, deliberately: the outbound
    routes claim to use the same gate as the usage reads, and a test that built
    its own gate could not notice if they had drifted apart.
    """
    from auth_router import require_user
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[require_user] = lambda: member_user
    app.dependency_overrides[get_org_id] = lambda: ORG

    async def _fetchval(query, *args):
        if "org_id IS NULL" in query:
            return None                       # no platform role, ever
        if "public.user_roles" in query and args[1:2] == (ORG,):
            return "org_admin"
        return None

    mock_pool.fetchval.side_effect = _fetchval
    yield member_user
    mock_pool.fetchval.side_effect = None
    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_org_id, None)


def _org_filter_args(mock_pool) -> list:
    """The org id actually bound into the read, not the one echoed in the body.

    A response that says `org_id: ORG` while the query filtered on something
    else is the failure worth catching, and it is invisible from the body.
    """
    conn = mock_pool.acquire.return_value
    bound = []
    for call in conn.fetch.call_args_list:
        args = call.args
        assert "org_id = $1::uuid" in str(args[0]), (
            "the outbound read lost its org filter"
        )
        bound.append(args[1])
    return bound


async def test_an_org_admin_reads_its_own_outbound_log(
    api_client, mock_pool, as_org_admin,
):
    resp = await api_client.get("/api/v1/billing/me/outbound")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["org_id"] == ORG
    assert _org_filter_args(mock_pool) == [ORG]
    # The honesty fields, which are the difference between a floor and a total.
    assert body["excludes_orgless"] is True
    assert "covers_whole_period" in body
    assert "recording_since" in body


@pytest.mark.parametrize("path", [
    "/api/v1/billing/orgs/{other}/outbound",
    "/api/v1/billing/orgs/{other}/outbound/messages",
    "/api/v1/billing/orgs/{other}/outbound/messages?recipient=arjun@rival.example",
])
async def test_an_org_admin_cannot_read_another_orgs_outbound_log(
    api_client, mock_pool, as_org_admin, path,
):
    """Every console route, not a representative one.

    The guard is per-route and the one that gets forgotten is whichever was
    added last — and these two were added last.
    """
    mock_pool.fetchrow.return_value = {
        "id": OTHER_ORG, "name": "Rival Ltd", "is_platform_org": False,
    }
    resp = await api_client.get(path.format(other=OTHER_ORG))

    assert resp.status_code == 403, resp.text
    assert not _org_filter_args(mock_pool), (
        "the rejection must happen before the table is read"
    )


async def test_an_org_admin_cannot_reach_the_console_route_for_its_own_org(
    api_client, mock_pool, as_org_admin,
):
    """Not an oversight: the console family is Aekam's.

    An org admin reaching it for their OWN org would be one `org_id` edit away
    from reaching it for somebody else's.
    """
    mock_pool.fetchrow.return_value = {
        "id": ORG, "name": "Client Co", "is_platform_org": False,
    }
    resp = await api_client.get(f"/api/v1/billing/orgs/{ORG}/outbound")
    assert resp.status_code == 403, resp.text


async def test_nothing_a_caller_sends_can_point_the_me_route_at_another_org(
    api_client, mock_pool, as_org_admin,
):
    """`/me/outbound` takes its org from `get_org_id` and from nowhere else.

    A query parameter that redirected it would be a tenancy hole NO 403 COULD
    CATCH, because the caller is legitimately an admin — of a different org.
    """
    resp = await api_client.get(
        f"/api/v1/billing/me/outbound?org_id={OTHER_ORG}&period=2026-08"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["org_id"] == ORG
    assert _org_filter_args(mock_pool) == [ORG]


async def test_the_recipient_lookup_cannot_leave_the_callers_org(
    api_client, mock_pool, as_org_admin,
):
    """THE ONE THAT MATTERS IN THIS SECTION, because an address is not a tenant.

    098's question 2 — "did this person get it" — is deliberately asked with an
    email address by somebody who does not know which org it belongs to. That
    makes the recipient scope the one place the org filter could most
    plausibly be dropped as unnecessary, and dropping it turns this endpoint
    into an oracle: any org admin could type any address in the product and
    learn whether it exists, what was sent to it, when, and under what subject.

    The scope also drops the PERIOD, which is the change that makes it look
    like a different kind of query and invites exactly that mistake.
    """
    resp = await api_client.get(
        "/api/v1/billing/me/outbound/messages"
        "?recipient=someone@rival.example&period=2026-08"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["org_id"] == ORG
    assert body["scope"] == "recipient"
    assert _org_filter_args(mock_pool) == [ORG]

    conn = mock_pool.acquire.return_value
    sql = str(conn.fetch.call_args.args[0])
    # 098: the index is FUNCTIONAL on lower(recipient), and the plain form is a
    # sequential scan AND WRONG — an address stored `Keval.Shah@Example.com`
    # and searched lowercase returns zero rows. "We never emailed them" is the
    # worst answer this table can give.
    assert "lower(recipient) = lower(" in sql


async def test_the_console_route_reads_the_org_it_was_given(
    api_client, mock_pool, as_admin,
):
    """Aekam's finance console does reach any org — that is what it is for."""
    mock_pool.fetchrow.return_value = {
        "id": OTHER_ORG, "name": "Rival Ltd", "is_platform_org": False,
    }
    resp = await api_client.get(f"/api/v1/billing/orgs/{OTHER_ORG}/outbound")

    assert resp.status_code == 200, resp.text
    assert resp.json()["org_id"] == OTHER_ORG
    assert _org_filter_args(mock_pool) == [OTHER_ORG]


async def test_the_drill_down_refuses_a_status_the_column_cannot_hold(
    api_client, mock_pool, as_org_admin,
):
    """`delivered` is the word a caller reaches for first, and the log has none.

    Refused by name rather than answered with an empty list, because an empty
    list here reads as "nothing of that kind happened" — and nothing in this
    product hears back from a mailbox, so the honest answer is that the
    question cannot be asked.
    """
    resp = await api_client.get(
        "/api/v1/billing/me/outbound/messages?status=delivered")
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"]["error"] == "unknown_status"
