"""WHOSE SEND WAS IT — the half of `staging.outbound_log` that returns None.

`tests/test_outbound_log.py` proves the writer records the right things. This
file proves the row is filed under the right ORG, which is a separate failure
and a quieter one.

WHY IT IS SEPARATE. Every org-scoped read of this table is `WHERE org_id =
$1::uuid` (`routers/billing.py`), so a row with a NULL org is a row no client is
ever shown. `email_service.send_email(to, subject, html)` has no org parameter
and no caller could supply one — which means the whole feature could pass every
assertion in the other file, write a correct row for every send in the product,
and still answer `/me/outbound` with nothing at all, for every org, forever. It
would have answered the SES incident it was built for with an empty screen.

So the org travels with the REQUEST, in a ContextVar `middleware/org_resolver`
sets once it has resolved the org tenancy needed anyway, and `outbound.begin()`
captures it ON THE CALLER'S THREAD. That mechanism has exactly one interesting
property and it is the reason this file exists:

    IT IS INVISIBLE WHEN IT BREAKS.

A ContextVar read from the wrong place does not raise, does not warn and does
not fail a send. It returns None. `email_service` hands the message to a
`threading.Thread` and a plain Thread starts with an EMPTY context, so a read
from in there — the obvious-looking "just default it in the writer" fix —
returns None AND, because the completion supersedes the buffered attempt
wholesale, ERASES the org `begin()` already captured. One row reaches the table,
it reads `org_id = NULL`, and nothing anywhere looks wrong. That is the same
shape as the original defect: not "the number is wrong" but "the number is
missing and nothing says so".

WHAT IS PINNED HERE

  1. A send inside a request is filed under that request's org, through the
     REAL `get_org_id` on the REAL app — not a `dependency_overrides` stand-in,
     which would skip the one line that publishes it.
  2. A SEND DISPATCHED ON A BACKGROUND THREAD KEEPS IT. The one that looks
     right and returns None. Written with a real `threading.Thread` and with
     the attempt still buffered, because those are the two conditions under
     which the wrong fix loses the org — a test that lets the drain race the
     thread asserts nothing.
  3. No request context records NULL, never a guessed org. A plausible wrong
     org is worse than an honest gap: the gap is visible.
  4. Two requests for different orgs on one worker do not leak into each other.
  5. The payslip path — the sender that caused the incident — records `bytes`
     and a real `purpose`, not 'unclassified' and not NULL.
  6. No social row contains the post text. On BOTH families, because
     `social:whatsapp_business` is translated to the `whatsapp` family, which
     keeps its subject.
  7. A logging failure still does not fail the send — and now also: the org
     resolver runs on EVERY request in the product, so it must not be able to
     fail one either.

STYLE. The conftest mock pool is the seam, as in `test_outbound_log.py`: after
`pool.execute(_INSERT, *args)` there is nothing left to inspect but thirteen
parallel lists, and decoding them back through the writer's own
`_INSERT_COLUMNS` is reading the row exactly as Postgres would assemble it.
"""
import json
import math
import threading
import uuid

import pytest
from fastapi import Depends

import outbound
from services import outbound_log

# Two real-looking orgs. ORG is the client whose request is being served;
# OTHER_ORG is the one a leak would file the send under.
ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"

#: The probe route below. Mounted on the REAL app — see `probe`.
PROBE = "/api/v1/__outbound_probe__"

#: SES bills per 256 KB unit, which is the arithmetic the August alert was
#: about. A payslip PDF is the only thing in this product big enough for the
#: distinction to change the answer.
_SES_UNIT = 262_144


# ════════════════════════════════════════════════════════════════════════════
# HARNESS
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def clean_slate():
    """Empty the writer's buffer AND the org context around every test.

    Both are process-wide singletons and the rest of the suite fills both: any
    test anywhere that touches a sender runs through `write()`, and any test
    that exercises a real `get_org_id` now sets the ContextVar. Without this,
    a row queued by an unrelated file arrives in the middle of an assertion
    here, or an org resolved by one leaks into a test whose whole point is that
    nothing leaks — and the failure names this file.

    The ContextVar is cleared rather than reset: a token from another test's
    context cannot be reset in this one, and clearing is what the next test
    needs anyway.
    """
    def _clear():
        outbound_log._pending.clear()
        outbound_log._open_rows.clear()
        outbound_log._updates.clear()
        outbound_log._dormant = False
        outbound_log._dropped = 0
        outbound_log._last_warn = 0.0
        outbound_log._task = None
        outbound._ORG_ID.set(None)
        outbound._USER_ID.set(None)

    _clear()
    yield
    _clear()


@pytest.fixture
def live_mode(monkeypatch):
    """Open the gate.

    conftest sets `OUTBOUND_MODE=dry` for the whole suite and calls it
    non-negotiable. `begin()` re-reads the module global on every call — "read
    now, so a test may patch it" — which is the only reason the live path is
    reachable. Patched, never set, so it cannot leak into another test and turn
    a mock into a real delivery.
    """
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    return False


@pytest.fixture
def resolves_org(mock_pool):
    """Let the REAL `get_org_id` resolve whatever `X-Org-Id` asks for.

    Deliberately NOT `app.dependency_overrides[get_org_id]`, which is how the
    rest of the suite supplies an org. An override REPLACES the function that
    publishes the org, so a test built on one would pass with the publication
    deleted — it would be asserting that the harness knows the org, which was
    never in doubt.

    This drives the header branch of the real dependency instead: membership
    check, then the organisations lookup. The header is also what lets one test
    resolve two different orgs on one worker, which is the leak this mechanism
    could most plausibly have.
    """
    async def _fetchval(query, *args):
        if "public.user_roles" in query and "org_id=$2::uuid" in query:
            return 1                        # a member of whatever was asked for
        return None                         # and no platform role anywhere

    async def _fetchrow(query, *args):
        if "public.organisations" in query:
            return {"id": args[0]}
        return None

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow
    yield mock_pool
    mock_pool.fetchval.side_effect = None
    mock_pool.fetchrow.side_effect = None


@pytest.fixture
def probe(app, member_user, resolves_org):
    """A route on the REAL app that resolves an org and then sends an email.

    Mounted here rather than borrowed from a business router on purpose. The
    subject under test is the path from `get_org_id` to `outbound.begin()` and
    across `email_service`'s thread; a real endpoint would bring twelve queries
    of its own to mock, and every one of them is a place for this test to fail
    for a reason that has nothing to do with attribution.

    What is real is everything that matters: `server.app` with its four
    `BaseHTTPMiddleware` — which is what puts a task boundary between one
    request and the next, and therefore the only reason `set_org` is allowed
    not to reset — the real `get_org_id`, and the real `send_email`.

    GET, because `global_write_rate_limit` counts writes per IP and the whole
    suite shares one.
    """
    from auth_router import require_user
    from middleware.org_resolver import get_org_id
    import email_service

    async def _probe(org_id: str = Depends(get_org_id)):
        email_service.send_email(
            "arjun.patel@client.example",
            "August payslip",
            "<!DOCTYPE html><html><body><p>Payslip</p></body></html>",
            purpose="payslip",
        )
        return {"org_id": org_id}

    app.dependency_overrides[require_user] = lambda: member_user
    app.add_api_route(PROBE, _probe, methods=["GET"], include_in_schema=False)
    added = app.router.routes[-1]
    try:
        yield PROBE
    finally:
        # The app fixture is session-scoped; a probe left mounted would be on
        # every later test's app.
        app.router.routes.remove(added)
        app.dependency_overrides.pop(require_user, None)


class _CapturingThreading:
    """Stands in for the `threading` module inside a sender, and keeps the threads.

    The threads are REAL. A shim that ran the target inline would run it in the
    caller's context, which is the one condition under which a thread-side read
    of the ContextVar would appear to work — so an inline shim turns the single
    most important test in this file into one that cannot fail.

    Only the module reference inside the sender is replaced, never
    `threading.Thread` itself, so nothing else in the process is affected for
    the length of a test.
    """

    def __init__(self):
        self.threads = []

    def Thread(self, *args, **kwargs):
        t = threading.Thread(*args, **kwargs)
        self.threads.append(t)
        return t

    def join(self, timeout: float = 5.0):
        for t in self.threads:
            t.join(timeout)
            assert not t.is_alive(), "the sending thread never finished"


def _rows_written(pool) -> list[dict]:
    """Every row actually bound into an INSERT, decoded back to a dict.

    The writer sends thirteen PARALLEL LISTS into an `UNNEST`, so the mapping
    from value to column is positional and lives in `_INSERT_COLUMNS`. Decoding
    through that same tuple means a test reads a row exactly as Postgres would
    assemble one.
    """
    rows: list[dict] = []
    for call in list(pool.execute.call_args_list) + list(pool.fetch.call_args_list):
        args = call.args
        if not args or "INSERT INTO public.outbound_log" not in str(args[0]):
            continue
        columns = args[1:]
        assert len(columns) == len(outbound_log._INSERT_COLUMNS)
        for values in zip(*columns):
            rows.append(dict(zip(outbound_log._INSERT_COLUMNS, values)))
    return rows


def _detail(row: dict) -> dict:
    return json.loads(row["detail"])


def _units(size) -> int:
    """SES message units for a message of `size` bytes, as 098 counts them.

    NULL yields 1 — which is the whole reason `bytes` on the payslip path is
    not an optional nicety: a ~300 KB slip counted as one unit is the bill
    under-reported by half.
    """
    return max(1, math.ceil((size or 0) / _SES_UNIT)) if size else 1


def _fake_ses(sent: list, message_id: str = "ses-message-id"):
    class _SES:
        def send_email(self, **kwargs):
            sent.append({"kwargs": kwargs, "context_org": outbound.current_org()})
            return {"MessageId": message_id}

        def send_raw_email(self, **kwargs):
            sent.append({"kwargs": kwargs, "context_org": outbound.current_org()})
            return {"MessageId": message_id}

    return _SES()


def _boom(*args, **kwargs):
    raise RuntimeError("the outbound log is broken")


# ════════════════════════════════════════════════════════════════════════════
# 1. A SEND INSIDE A REQUEST IS FILED UNDER THAT REQUEST'S ORG
# ════════════════════════════════════════════════════════════════════════════

async def test_a_send_inside_a_request_records_that_requests_org(
    api_client, mock_pool, probe, member_user,
):
    """The claim the whole feature rests on, end to end and un-stubbed.

    Nothing in `email_service.send_email`'s signature mentions an org and no
    caller passes one. If this row comes back NULL then `/me/outbound` returns
    nothing for every client in the product, and the screen built to answer an
    SES bill answers it with an empty table.
    """
    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200, resp.text
    assert resp.json()["org_id"] == ORG

    await outbound_log.flush()
    rows = _rows_written(mock_pool)

    assert rows, "the send recorded nothing at all"
    assert all(r["org_id"] == uuid.UUID(ORG) for r in rows), (
        "a send inside a request was filed under no org — every org-scoped read "
        "of this table is `WHERE org_id = $1::uuid`, so these rows are invisible "
        "to the client that caused them"
    )
    # Who CAUSED it, which is a different column from `recipient` and a
    # different type — TEXT, because `public.users.user_id` is text.
    assert all(r["user_id"] == member_user["user_id"] for r in rows)
    assert rows[0]["recipient"] == "arjun.patel@client.example"
    assert rows[0]["purpose"] == "payslip"


async def test_the_org_context_does_not_survive_the_request_that_set_it(
    api_client, mock_pool, probe,
):
    """`set_org` never unsets, and this is the measurement that makes that safe.

    A ContextVar left set on a reused worker would file the NEXT request's sends
    under the PREVIOUS request's org — confidently, and on a money-adjacent
    table. What stops it is a task boundary, which comes from uvicorn wrapping
    each request and from all four `BaseHTTPMiddleware` in `server.py` running
    everything downstream in a child task. Neither is this module's doing, so
    neither is assumed here.
    """
    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200

    assert outbound.current_org() is None, (
        "the request's org climbed out into the ambient context — every send "
        "this worker makes outside a request is now filed under that client"
    )
    assert outbound.current_user() is None


# ════════════════════════════════════════════════════════════════════════════
# 2. A SEND DISPATCHED ON A BACKGROUND THREAD KEEPS IT
#
# THE ONE THAT LOOKS RIGHT AND RETURNS NONE.
#
# `send_email` hands the message to a `threading.Thread` and returns before the
# provider is called, so the outcome — and the SES MessageId, the only join key
# a later bounce has — exists only inside that thread. The completion the thread
# reports SUPERSEDES the buffered attempt wholesale, which is what makes one
# message cost one row instead of an INSERT and an UPDATE.
#
# That supersession is also the trap. A plain Thread starts with an EMPTY
# context, so the obvious-looking fix — default `org_id` from the ContextVar
# inside `outbound_log.write()`, or re-derive it in `Attempt._finish` — does not
# merely fail to add an org. IT REPLACES THE ONE `begin()` CAPTURED WITH NONE,
# and the single row that reaches the table is back to where this feature
# started, with nothing in review looking wrong.
#
# Both conditions are forced below, because a test that has neither passes with
# the bug in place.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_send_finished_on_a_background_thread_keeps_the_requests_org(
    api_client, mock_pool, probe, monkeypatch, live_mode,
):
    """A REAL thread, and the attempt still buffered when it reports.

    The buffering is forced by suspending the drain for the length of the
    request. That is not an artificial arrangement — it is the COMMON one, and
    the writer says so: "If the outcome arrives before the flush — the common
    case, because a send takes milliseconds — the two collapse in memory and ONE
    row is inserted carrying the final status."

    It has to be forced because the alternative is a race the test would lose
    silently: if the drain runs first, the 'queued' row is already in the table
    carrying the org `begin()` captured, the completion becomes an UPDATE that
    does not touch `org_id`, and a thread-side read that erased the org would
    leave no trace. The assertion would pass and prove nothing.
    """
    import email_service

    sent: list = []
    monkeypatch.setattr(email_service, "ses_client", _fake_ses(sent))
    shim = _CapturingThreading()
    monkeypatch.setattr(email_service, "threading", shim)
    monkeypatch.setattr(outbound_log, "_schedule", lambda: None)

    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200, resp.text

    shim.join()
    assert sent, "the provider was never called"

    monkeypatch.undo()                      # give the drain back
    await outbound_log.flush()
    rows = _rows_written(mock_pool)

    assert len(rows) == 1, (
        "the attempt and its outcome did not collapse into one row, so this "
        "test is not exercising the case it was written for"
    )
    row = rows[0]
    assert row["status"] == "sent", "the outcome reported from the thread landed"
    assert row["provider_message_id"] == "ses-message-id"
    # THE ASSERTION. The org was captured on the request's thread and carried
    # across the hand-off in the Attempt's own fields; re-deriving it anywhere
    # downstream produces None here.
    assert row["org_id"] == uuid.UUID(ORG), (
        "the completion reported from the sending thread erased the org that "
        "`begin()` captured — the row that reaches the table is NULL-org and "
        "invisible to the client, which is exactly the state this feature was "
        "built to end"
    )


async def test_the_sending_thread_genuinely_has_no_request_context(
    api_client, mock_pool, probe, monkeypatch, live_mode,
):
    """The premise of the test above, asserted rather than assumed.

    If a plain `threading.Thread` could see the request's ContextVar, the test
    above would pass whether the org was carried or re-derived, and would be
    worth nothing. This is the check that it keeps being able to fail: the
    sending thread reads the org as None, which is why the value has to travel
    in the Attempt's fields and not in the context.
    """
    import email_service

    sent: list = []
    monkeypatch.setattr(email_service, "ses_client", _fake_ses(sent))
    shim = _CapturingThreading()
    monkeypatch.setattr(email_service, "threading", shim)

    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200
    shim.join()

    assert sent and sent[0]["context_org"] is None, (
        "a background thread can see the request's org context, so nothing in "
        "this file proves the hand-off carries it"
    )


# ════════════════════════════════════════════════════════════════════════════
# 3. NO REQUEST CONTEXT RECORDS NULL, NEVER A GUESSED ORG
#
# An unattributed row is a gap somebody can see. A plausible-looking wrong org
# is a gap nobody can — it is a wrong answer to "what did we send this org" and
# nothing about it looks wrong afterwards.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_send_with_no_request_context_records_null(mock_pool):
    """A scheduler tick, a worker, a backfill: no request, so no org."""
    assert outbound.current_org() is None

    outbound.suppressed("email", "arjun.patel@client.example", "August payslip")
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    assert rows[0]["org_id"] is None, "an org was invented for a send that had none"
    assert rows[0]["user_id"] is None


async def test_an_unparseable_org_costs_the_row_its_org_and_nothing_else(mock_pool):
    """'platform', a slug, an empty string — none of them are uuids.

    Callers pass org ids as strings from a dozen places. Binding one of those
    to a `uuid[]` parameter fails the whole statement, and losing 500 rows
    because one had a bad org id is the wrong trade — so the row keeps its
    place and loses its org.
    """
    for bad in ("platform", "", "org-42"):
        outbound.suppressed("email", "arjun@client.example", "Subject", org_id=bad)
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 3, "a malformed org id must not cost the row"
    assert all(r["org_id"] is None for r in rows)


async def test_a_caller_that_knows_better_than_the_request_wins(mock_pool):
    """The context is a DEFAULT, not an override.

    A platform job sending on behalf of an org it was handed must not have its
    answer replaced by whichever org happened to be resolved for the request it
    is running inside.
    """
    with outbound.org_scope(OTHER_ORG, "user_platform001"):
        outbound.suppressed("email", "arjun@client.example", "Subject", org_id=ORG)
    await outbound_log.flush()

    assert _rows_written(mock_pool)[0]["org_id"] == uuid.UUID(ORG)


# ════════════════════════════════════════════════════════════════════════════
# 4. TWO REQUESTS FOR DIFFERENT ORGS ON ONE WORKER DO NOT LEAK
# ════════════════════════════════════════════════════════════════════════════

async def test_two_requests_for_different_orgs_do_not_leak_into_each_other(
    api_client, mock_pool, probe,
):
    """One process, one client, two orgs, in order.

    This is the failure `set_org`'s refusal to reset would produce if the task
    boundary were not there, and it is the one that would be found by a client
    seeing another client's addresses on their own outbound screen.
    """
    first = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert first.status_code == 200, first.text
    await outbound_log.flush()
    after_first = {r["org_id"] for r in _rows_written(mock_pool)}

    second = await api_client.get(PROBE, headers={"X-Org-Id": OTHER_ORG})
    assert second.status_code == 200, second.text
    await outbound_log.flush()
    all_rows = _rows_written(mock_pool)
    after_second = {r["org_id"] for r in all_rows} - after_first

    assert after_first == {uuid.UUID(ORG)}
    assert after_second == {uuid.UUID(OTHER_ORG)}, (
        "the second request's sends were filed under the first request's org"
    )
    assert uuid.UUID(ORG) not in after_second


async def test_a_send_after_a_request_is_not_filed_under_that_request(
    api_client, mock_pool, probe,
):
    """The other half of the leak, and the one a scheduler would hit.

    A worker that served a request and then ran a scheduled job on the same
    thread must not attribute the job to the client it last served.
    """
    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200
    await outbound_log.flush()
    from_request = len(_rows_written(mock_pool))

    outbound.suppressed("email", "cron@aekam.example", "Nightly digest")
    await outbound_log.flush()

    later = _rows_written(mock_pool)[from_request:]
    assert len(later) == 1
    assert later[0]["org_id"] is None, (
        "a send made outside any request inherited the last request's org"
    )


# ════════════════════════════════════════════════════════════════════════════
# 5. THE PAYSLIP PATH RECORDS BYTES AND A REAL PURPOSE
#
# The sender the table was written about. `routers/vetana.py` mails every
# employee a payslip with a PDF attached on every payroll run; sixteen runs
# against an org of 71 is ~960 messages, and nothing recorded one of them.
#
# `bytes` is not a nicety here. SES bills in 256 KB UNITS, and a payslip PDF is
# the only thing this product sends that crosses one — so a payslip row with a
# NULL size counts as a single unit and the figure reconciled against the AWS
# invoice is short by a factor of two or more.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_suppressed_payslip_still_records_its_size_and_purpose(mock_pool):
    """Staging runs `OUTBOUND_MODE=dry`, so this is every payslip row it writes.

    A suppressed send is the one case where what it WOULD have cost is the only
    figure there will ever be.
    """
    from services import employee_email

    pdf = b"%PDF-1.4" + b"\x00" * 210_000

    with outbound.org_scope(ORG, "user_mem001"):
        employee_email.send_payslip_email(
            "arjun.patel@client.example", "Arjun Patel", "August 2026",
            145_000, 118_320, "PS-2026-08-42", org_name="Client Co",
            pdf_bytes=pdf,
        )
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    row = rows[0]

    assert row["status"] == "suppressed"
    assert row["org_id"] == uuid.UUID(ORG)
    assert row["purpose"] == "payslip", (
        "the largest email volume in the product was filed under "
        f"{row['purpose']!r}, which answers nothing"
    )
    assert row["purpose"] != outbound_log._DEFAULT_PURPOSE
    assert _detail(row)["ref"] == "payslip:PS-2026-08-42"
    # THE MESSAGE, NOT THE ATTACHMENT. `len(pdf_bytes)` stood here and this
    # assertion held it in place: SES bills the base64-expanded MIME document,
    # which is ~4/3 of the PDF plus the HTML and text parts, and on the
    # suppressed path no document is ever built — so this estimate is the only
    # figure the row will ever carry. Asserted as the unit count as well as the
    # size, because the unit is what the invoice is in and it is where the
    # difference stops being a rounding error.
    #
    # The expected figure is not recomputed from a rebuilt template here — that
    # would assert this test's copy of the email against itself. What is checked
    # is the property the bill turns on: the PDF is base64-expanded, so the
    # recorded size must clear the encoded attachment alone.
    assert row["bytes"] > employee_email._b64_bytes(len(pdf)) > len(pdf), (
        "the row records the PDF, not the message SES would have been handed"
    )
    assert _units(row["bytes"]) == 2, (
        "a suppressed payslip must record the two units the same send would "
        "really have cost"
    )
    assert _units(len(pdf)) == 1, (
        "this PDF must be one unit as a file and two as a message, or the test "
        "is not demonstrating the under-count it was written for"
    )
    # And no part of the payslip itself.
    assert "118,320" not in str(row)


async def test_a_sent_payslip_records_the_bytes_ses_actually_meters(
    mock_pool, monkeypatch, live_mode,
):
    """The completion refines the estimate to the exact figure SES bills on.

    A PDF is base64-encoded into the message, which is ~4/3 of its size before
    the HTML and text parts are added. So a slip that is ONE unit as a file is
    TWO as a message, and that difference IS the August alert: the number the
    owner was shown counted messages, and the number AWS charged for counted
    units.
    """
    from services import employee_email

    pdf = b"%PDF-1.4" + b"\x00" * 210_000
    raw_seen: dict = {}

    class _SES:
        @staticmethod
        def send_raw_email(*, Source, Destinations, RawMessage):
            raw_seen["len"] = len(RawMessage["Data"])
            return {"MessageId": "0100018f-c0ffee-SES"}

    monkeypatch.setattr(employee_email, "ses_client", _SES)
    shim = _CapturingThreading()
    monkeypatch.setattr(employee_email, "threading", shim)
    monkeypatch.setattr(outbound_log, "_schedule", lambda: None)

    with outbound.org_scope(ORG, "user_mem001"):
        employee_email.send_payslip_email(
            "arjun.patel@client.example", "Arjun Patel", "August 2026",
            145_000, 118_320, "PS-2026-08-42", pdf_bytes=pdf,
        )
    shim.join()
    assert raw_seen, "SES was never called"

    monkeypatch.undo()
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    row = rows[0]

    assert row["status"] == "sent"
    assert row["provider"] == "ses"
    assert row["provider_message_id"] == "0100018f-c0ffee-SES"
    assert row["bytes"] == raw_seen["len"], (
        "the size recorded is not the size SES received"
    )
    # The point of the column, stated as the arithmetic that pays the bill.
    assert _units(row["bytes"]) == 2
    assert _units(len(pdf)) == 1, (
        "this PDF must be one unit as a file and two as a message, or the test "
        "is not demonstrating the under-count it was written for"
    )
    assert _units(None) == 1, "a NULL size is billed as one unit — it is not zero"
    # Reported from a real sending thread, and still the request's org.
    assert row["org_id"] == uuid.UUID(ORG)
    assert row["purpose"] == "payslip"


# ════════════════════════════════════════════════════════════════════════════
# 6. NO SOCIAL ROW CONTAINS THE POST TEXT
#
# `_guarded` used to pass `(text or "")[:80]` into the subject position — the
# opening of a customer's own post, published through a customer's own OAuth
# token. The writer drops the subject for the `social` family, which covers
# Facebook. IT DOES NOT COVER WHATSAPP: `social:whatsapp_business` is
# translated to the `whatsapp` FAMILY, which keeps its subject — so on the one
# platform where the text is a private message to one person, eighty characters
# of it would have been kept for 400 days and read by support.
#
# Both families are asserted for that reason. One of them was covered by the
# writer and one of them never was.
# ════════════════════════════════════════════════════════════════════════════

POST = ("Diwali offer: 20% off every retainer signed this month. "
        "Talk to us about your books before the GST deadline.")


def _account(**over) -> dict:
    account = {
        "id": "q-7",                        # the hub_publish_queue row
        "content_id": "c-42",
        "client_org_id": ORG,               # the CLIENT's org, not the agency's
        "created_by": "user_mem001",
        "account_name": "Client Co on Facebook",
        "page_id": "104857600",
        "access_token_encrypted": "not-used-in-dry-mode",
    }
    account.update(over)
    return account


@pytest.mark.parametrize("publisher,family,keeps_subject", [
    ("publish_to_facebook", "social", False),
    ("publish_to_whatsapp_business", "whatsapp", True),
])
async def test_no_outbound_row_contains_a_word_of_the_clients_post(
    mock_pool, publisher, family, keeps_subject,
):
    """Not one character of it, in any column, on either family.

    Asserted over the WHOLE row rather than over `subject_or_title`, because
    the failure worth catching is the text arriving somewhere nobody thought to
    look — `detail`, `error`, a `ref`.
    """
    from services import social_publisher

    result = await getattr(social_publisher, publisher)(_account(), POST)
    assert result["suppressed"] is True, "the kill switch must still stop the post"
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    row = rows[0]

    assert row["channel"] == family
    assert POST[:80] not in str(row)
    assert "Diwali" not in str(row)
    assert "retainer" not in str(row)

    if keeps_subject:
        # The channel that keeps a subject must therefore be given something
        # that is not the message: what was published, not what it said.
        assert row["subject_or_title"] == "content c-42"
    else:
        assert row["subject_or_title"] is None, (
            "a social post has no subject and NULL is the right value — a "
            "future author who 'fixes' this NULL reopens the hole"
        )

    # Everything that answers a question is still there.
    assert row["purpose"] == "publish"
    assert _detail(row)["ref"] == "publish:q-7"


async def test_a_publish_is_filed_under_the_client_org_not_the_agency(mock_pool):
    """The one channel where the request's org is the WRONG answer.

    A Kartavaya customer is an agency; the post goes to its CLIENT's audience
    through that client's own OAuth token, and `hub_clients` is where the org
    on that row comes from. So `_guarded` passes an explicit `client_org_id`,
    and it has to beat whatever the request resolved — otherwise every publish
    in the product is filed under the agency and the client's own outbound
    screen shows nothing.
    """
    from services import social_publisher

    with outbound.org_scope(OTHER_ORG, "user_agency001"):
        await social_publisher.publish_to_facebook(_account(client_org_id=ORG), POST)
    await outbound_log.flush()

    row = _rows_written(mock_pool)[0]
    assert row["org_id"] == uuid.UUID(ORG)
    assert row["org_id"] != uuid.UUID(OTHER_ORG)


# ════════════════════════════════════════════════════════════════════════════
# 7. A LOGGING FAILURE STILL DOES NOT FAIL THE SEND
#
# Everything above is about the log being right. This is about the log being
# unable to make the PRODUCT wrong — a self-inflicted outage caused by an
# observability feature, which is the least defensible kind.
#
# The org context widens the blast radius, which is why it is re-asserted here
# and not left to `test_outbound_log.py`: `middleware/org_resolver.get_org_id`
# is a dependency of essentially every route in the product, and it now calls
# into `outbound` on every request. A raise from there is not a lost row. It is
# a 500 on everything.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_broken_org_context_cannot_fail_a_request(
    api_client, mock_pool, probe, monkeypatch,
):
    """`get_org_id` gained a call it did not have. It must be incapable of failing.

    Patched at `middleware.org_resolver.set_org` rather than at
    `outbound.set_org`, because the resolver binds the name at import — the
    other patch would leave the real function in place and prove nothing.
    """
    import middleware.org_resolver as resolver

    monkeypatch.setattr(resolver, "set_org", _boom)

    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200, (
        "a failure in outbound attribution took down a request — this "
        "dependency runs on every route in the product"
    )
    assert resp.json()["org_id"] == ORG, "tenancy resolution is unaffected"


async def test_a_dead_writer_does_not_stop_an_email_sent_inside_a_request(
    api_client, mock_pool, probe, monkeypatch, live_mode,
):
    """Broken at the writer's front door, so BOTH halves fail.

    The attempt `begin()` records and the completion the sending thread reports.
    Proved at the provider boundary, because that is the only place the omission
    would be observable — every layer above it returns True either way.
    """
    import email_service

    sent: list = []
    monkeypatch.setattr(email_service, "ses_client", _fake_ses(sent))
    shim = _CapturingThreading()
    monkeypatch.setattr(email_service, "threading", shim)
    monkeypatch.setattr(outbound_log, "write", _boom)

    resp = await api_client.get(PROBE, headers={"X-Org-Id": ORG})
    assert resp.status_code == 200, resp.text

    shim.join()
    assert sent, "the provider was never called — logging blocked a send"
    assert sent[0]["kwargs"]["Destination"]["ToAddresses"] == ["arjun.patel@client.example"]


def test_the_shutdown_hook_drains_the_log_before_the_pool_closes():
    """Rows buffered at redeploy are lost unless something drains them.

    `write()` buffers and returns — that is why a payroll run costs one
    statement — so whatever has not been flushed exists only in this process.
    Railway redeploys this service constantly.

    Asserted on the ORDER as well as the presence: `shutdown()` needs the pool
    that `close_pool()` is about to take away, so the two lines are only
    correct in one sequence and a later edit that tidies them is the way the
    drain silently stops working.
    """
    import inspect

    import server

    # The AWAITED STATEMENTS, not the source text. The hook's docstring names
    # both calls in the order it explains them, which is the reverse of the
    # order it makes them — so a substring search over the whole function
    # asserts against the prose. `test_outbound_log._sql()` strips 098's
    # comments for the same reason and says it was found the hard way.
    statements = [line.strip() for line in inspect.getsource(server.shutdown)
                  .splitlines() if line.strip().startswith("await ")]

    assert "await outbound_log.shutdown()" in statements, (
        "the shutdown hook does not drain the outbound log — every redeploy "
        "silently loses whatever the last requests queued, and Railway "
        "redeploys this service constantly"
    )
    assert "await close_pool()" in statements
    assert (statements.index("await outbound_log.shutdown()")
            < statements.index("await close_pool()")), (
        "the log is drained after the pool is closed, so there is nothing left "
        "to write with and the drain writes nothing"
    )
