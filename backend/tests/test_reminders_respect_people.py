"""Scheduled reminders ask before sending, and say what actually happened.

TWO FAULTS ON ONE PATH
----------------------
`reminder_service.process_pending_reminders` is the loop that produced every
reminder this product has ever created. It called `send_email` and
`send_expo_push` DIRECTLY.

1. IT ASKED NOBODY. `prefs_allow` gates `create_notification`, `send_push` and
   the task-reminder dispatch. This loop consulted neither preferences nor quiet
   hours — the one job that runs unattended at 3am was the one that never asked
   whether 3am was acceptable.

2. IT CALLED EVERYTHING SENT. Measured on the live database 2026-08-16:
   `staging.reminders` held 1,562 rows, every one `status='sent'`;
   `staging.outbound_log` held 1,562 reminder rows, every one `suppressed`. A
   perfect 1:1. Nothing this product has ever called a reminder has reached
   anybody, and the table said otherwise the whole time.

   `send_email` returns True when the outbound gate suppressed the message —
   deliberately, because the operator asked for nothing to leave the building —
   so the return value cannot tell the two apart. The gate itself can.

DEFERRED IS NOT DROPPED
-----------------------
Quiet hours leave the row `pending`, because here `pending` IS a queue and the
next run picks it up. That is the opposite of Niyam's in-app channel, where
there is no queue and suppressing loses the message for ever — same principle,
opposite conclusion, and the difference is whether anything remembers.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

import outbound
from services import reminder_service

ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"


def _reminder(**over):
    base = {"id": 1, "org_id": ORG, "channel": "email",
            "email": "someone@example.com", "recipient_user_id": "user_x",
            "reminder_type": "invoice_overdue", "message": "m"}
    base.update(over)
    return base


@pytest.fixture
def pool(monkeypatch):
    p = MagicMock()
    p.fetch = AsyncMock(return_value=[_reminder()])
    p.fetchrow = AsyncMock(return_value=None)     # no prefs row → defaults
    p.execute = AsyncMock(return_value="UPDATE 1")

    async def _get_pool():
        return p

    monkeypatch.setattr(reminder_service, "get_pool", _get_pool)
    monkeypatch.setattr("email_service.send_email", lambda **k: True)
    return p


def _statuses(pool):
    """Every status this run wrote."""
    out = []
    for call in pool.execute.await_args_list:
        args = call.args
        if args and "public.reminders SET status" in args[0]:
            out.append(args[2] if len(args) > 2 else
                       ("suppressed" if "'suppressed'" in args[0] else "sent"))
    return out


@pytest.mark.asyncio
async def test_quiet_hours_hold_the_reminder_without_marking_it(pool, monkeypatch):
    """THE REGRESSION. It used to send, at any hour."""
    monkeypatch.setattr("services.push_service._in_quiet_hours", lambda *a, **k: True)
    out = await reminder_service.process_pending_reminders()
    assert out["sent"] == 0
    assert _statuses(pool) == [], (
        "a reminder held for quiet hours was given a final status — it must "
        "stay pending so the next run delivers it")


@pytest.mark.asyncio
async def test_a_switched_off_preference_is_final(pool, monkeypatch):
    """A decision, unlike a clock, must not be retried for ever."""
    monkeypatch.setattr("services.push_service._in_quiet_hours", lambda *a, **k: False)
    monkeypatch.setattr("services.push_service._mode_allows", lambda *a, **k: False)
    out = await reminder_service.process_pending_reminders()
    assert out["sent"] == 0
    assert _statuses(pool) == ["suppressed"]


@pytest.mark.asyncio
async def test_a_dry_outbound_gate_is_not_recorded_as_sent(pool, monkeypatch):
    """The 1,562-row lie, asserted."""
    monkeypatch.setattr("services.push_service._in_quiet_hours", lambda *a, **k: False)
    monkeypatch.setattr(outbound, "DRY_RUN", True)
    await reminder_service.process_pending_reminders()
    assert _statuses(pool) == ["suppressed"], (
        "the outbound gate suppressed the message and the reminder recorded "
        "'sent' — that is the exact 1:1 mismatch measured on the live database")


@pytest.mark.asyncio
async def test_a_real_send_is_recorded_as_sent(pool, monkeypatch):
    monkeypatch.setattr("services.push_service._in_quiet_hours", lambda *a, **k: False)
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    out = await reminder_service.process_pending_reminders()
    assert out["sent"] == 1
    assert _statuses(pool) == ["sent"]
