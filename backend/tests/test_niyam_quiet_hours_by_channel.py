"""Quiet hours silence a buzz, not a list.

WHAT HAPPENED
-------------
The first armed Niyam rule matched a real event at 01:15 IST and recorded

    refused — every recipient was suppressed

The condition was right, the recipient was right, and the person's preferences
allowed it (`task_done` resolves to `always`). What stopped it was the default
quiet window, 22:00–07:00.

The action was an IN-APP notification: a row in the notifications list, read
when the person next opens the app. It makes no sound and lights nothing up.
There is no queue behind it either, so suppressing it did not postpone the
message by seven hours — it lost it permanently, and the rule that existed to
tell somebody their task was finished told nobody, for ever.

THE DISTINCTION THIS FILE PINS
------------------------------
A preference is a decision about the MESSAGE: do not tell me about this. It is
final and applies to every channel.

Quiet hours are a fact about the CLOCK: do not interrupt me right now. They
apply only to channels that interrupt.

Both were one boolean before, so every caller got the strictest reading of each.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from services.niyam.send import INTERRUPTING, deliver


def _pool(row):
    p = AsyncMock()
    p.fetchrow = AsyncMock(return_value=row)
    p.execute = AsyncMock(return_value="INSERT 0 1")
    return p


#: 01:15 IST — inside the 22:00–07:00 default window, which is when the real
#: run was refused.
DEEP_NIGHT = {"prefs": {}, "quiet_start": "22:00", "quiet_end": "07:00"}


@pytest.fixture
def at_night(monkeypatch):
    monkeypatch.setattr("services.push_service._in_quiet_hours",
                        lambda *a, **k: True)


@pytest.mark.asyncio
async def test_inapp_is_delivered_during_quiet_hours(at_night):
    """The regression. Before the split this returned refused."""
    conn = _pool(DEEP_NIGHT)
    res = await deliver(conn, user_id="user_x", kind="task_done",
                        title="A task you asked for is done",
                        body="It has been marked complete.", channel="inapp")
    assert res.outcome == "ok", res.reason
    assert conn.execute.await_count == 1, "no notifications row was written"


@pytest.mark.asyncio
async def test_push_is_still_silenced_during_quiet_hours(at_night, monkeypatch):
    """The other half. Loosening in-app must not loosen the buzz.

    ⚠ THE OUTCOME IS NOW `deferred`, NOT `refused`, AND THAT IS THE FIX.
    Both mean "the phone does not buzz right now", which is everything this
    test was written to protect. They differ in what happens NEXT: `refused`
    was terminal — `run_pipeline` recorded the step and called `_finish`, which
    NULLs `wake_at`, so the message was destroyed rather than delayed (suite
    16.14, and `send.INTERRUPTING`'s own note about the 01:15 IST send that
    never happened).

    So the assertion is split in two, because the test was really making two
    claims and could only see one of them: not delivered now, AND not lost.
    """
    conn = _pool(DEEP_NIGHT)
    res = await deliver(conn, user_id="user_x", kind="task_done",
                        title="t", body="b", channel="push")
    assert res.outcome != "ok", "the push was sent during quiet hours"
    assert res.outcome == "deferred", res.reason
    assert "quiet hours" in res.reason
    assert res.retry_after is not None, (
        "deferred with no retry time — the engine would fall back to a blind "
        "one-hour retry inside the same window")
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_preference_still_stops_in_app(monkeypatch):
    """A decision about the message applies to every channel, at any hour."""
    monkeypatch.setattr("services.push_service._in_quiet_hours",
                        lambda *a, **k: False)
    conn = _pool({"prefs": {"task_done": "off"}, "quiet_start": "22:00",
                  "quiet_end": "07:00"})
    res = await deliver(conn, user_id="user_x", kind="task_done",
                        title="t", body="b", channel="inapp")
    assert res.outcome == "refused"
    assert "turned off" in res.reason
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_refusal_names_which_gate_stopped_it(at_night):
    """'preference or quiet hours' is two opposite answers in one sentence.

    One of them means "you will never get it"; the other means "you will get it
    at 07:00". A support reply cannot be written from the pair.
    """
    conn = _pool(DEEP_NIGHT)
    res = await deliver(conn, user_id="user_x", kind="task_done",
                        title="t", body="b", channel="push")
    assert " or " not in res.reason, res.reason


def test_inapp_is_not_an_interrupting_channel():
    """Stated as data, so adding a channel forces the question to be answered."""
    assert "inapp" not in INTERRUPTING
    assert {"push", "email"} <= INTERRUPTING
