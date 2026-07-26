"""Quiet hours — the cross-language parity proof, and the call site that skipped the gate.

`tests/test_push_prefs.py` already pins the Python behaviour of
`_in_quiet_hours` — half-open bounds, the wrap, the zero-length window, and
unparseable input. This file does NOT repeat that. It adds the two things that
suite cannot cover from inside one process:

1. THE SAME RULE IS IMPLEMENTED TWICE, IN TWO LANGUAGES, IN TWO PROCESSES.
   `inQuietHours()` in `frontend/src/context/NotificationContext.jsx` decides
   whether the browser shows a toast, plays the sound and renders the
   "Quiet hours are on" banner; `_in_quiet_hours` here decides whether the
   device buzzes. If they disagree, the app tells the user one thing and the
   server does another, and nothing in either codebase would notice. The PARITY
   table below is asserted verbatim in
   `frontend/src/pages/inbox/__tests__/notifications.test.jsx`. Change one side
   and both fail.

2. THE EXHAUSTIVE COUNT. `test_window_wraps_midnight` samples five minutes
   inside the window. The classic off-by-one does not fail on a sample — it
   fails by making the window EMPTY, and a sampled test can only catch that if
   the sample happens to land inside. Counting all 1440 minutes states the
   number that must come out, so a regression to the naive single-comparison
   form is arithmetic, not luck.

Nothing here touches the network, a device or the database.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.push_service import IST, _in_quiet_hours, prefs_allow


def at(h: int, m: int = 0) -> datetime:
    """An IST wall-clock instant. The window is a wall-clock range in one zone."""
    return datetime(2026, 1, 15, h, m, tzinfo=IST)


# ── 1. The exhaustive proof ──────────────────────────────────────────────────

def test_an_overnight_window_silences_540_of_1440_minutes():
    """The regression guard for the off-by-one this feature exists to avoid.

    22:00 → 07:00 IS NOT AN INTERVAL ON A NUMBER LINE. No minute is both >= 1320
    and < 420, so the naive `start <= now < end` returns False for every one of
    the 1440 minutes in a day: the schedule almost every user picks would
    silence NOTHING, and would do it silently.

    120 minutes from 22:00 to midnight, plus 420 from midnight to 07:00.
    A naive implementation makes this 0. An "always quiet" reading of the wrap
    makes it 1440.
    """
    silenced = sum(
        1 for t in range(1440)
        if _in_quiet_hours("22:00", "07:00", now=at(t // 60, t % 60))
    )
    assert silenced == 540


def test_a_same_day_window_silences_exactly_its_own_length():
    """The control. If the wrap branch were applied to a non-wrapping window it
    would silence 1440 - 480 instead of 480."""
    silenced = sum(
        1 for t in range(1440)
        if _in_quiet_hours("09:00", "17:00", now=at(t // 60, t % 60))
    )
    assert silenced == 8 * 60


def test_the_two_windows_are_complements_of_each_other():
    """22:00–07:00 and 07:00–22:00 must partition the day exactly: every minute
    belongs to one or the other, never both, never neither. This is the property
    the wrap branch exists to preserve, stated without reference to either
    branch's implementation."""
    for t in range(1440):
        now = at(t // 60, t % 60)
        night = _in_quiet_hours("22:00", "07:00", now=now)
        day   = _in_quiet_hours("07:00", "22:00", now=now)
        assert night != day, f"minute {t} is in both windows or in neither"


# ── 2. Parity with the browser ───────────────────────────────────────────────
#
# Asserted identically in frontend/src/pages/inbox/__tests__/notifications.test.jsx
# under "PARITY WITH push_service._in_quiet_hours". Keep the two tables in step.

PARITY = [
    ("22:00", "07:00", 23,  0, True),
    ("22:00", "07:00",  3,  0, True),
    ("22:00", "07:00",  6, 59, True),
    ("22:00", "07:00",  7,  0, False),   # end exclusive
    ("22:00", "07:00", 21, 59, False),
    ("22:00", "07:00", 22,  0, True),    # start inclusive
    ("22:00", "07:00",  0,  0, True),    # the minute the naive form gets wrong
    ("09:00", "17:00", 12,  0, True),
    ("09:00", "17:00",  8, 59, False),
    ("09:00", "17:00", 17,  0, False),
    ("09:00", "17:00",  0,  0, False),
    ("07:00", "07:00",  7,  0, False),   # zero-length is OFF, not all day
    ("07:00", "07:00",  3,  0, False),
    ("00:00", "23:59",  0,  0, True),
    ("00:00", "23:59", 23, 59, False),
    ("22:00", "22:01", 22,  0, True),    # one-minute window
    ("22:00", "22:01", 22,  1, False),
]


@pytest.mark.parametrize("start,end,h,m,quiet", PARITY)
def test_parity_with_the_browser_implementation(start, end, h, m, quiet):
    assert _in_quiet_hours(start, end, now=at(h, m)) is quiet


def test_the_window_is_ist_not_utc_and_not_the_device():
    """18:30 UTC is 00:00 IST — inside an overnight window.

    The browser computes IST minutes from UTC plus a fixed offset rather than
    from `getHours()`, for this reason: a user in London reading the device
    clock would be told quiet hours end at 07:00 and see their toasts stop five
    and a half hours off what the server actually does.
    """
    midnight_ist = datetime(2026, 1, 14, 18, 30, tzinfo=timezone.utc).astimezone(IST)
    assert (midnight_ist.hour, midnight_ist.minute) == (0, 0)
    assert _in_quiet_hours("22:00", "07:00", now=midnight_ist) is True


# ── 3. The call site that skipped the gate ───────────────────────────────────

def _pool(row):
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=row)
    return pool


async def test_reminder_push_is_refused_inside_the_quiet_window(monkeypatch):
    """`routers/task_reminders.py` fired `send_web_push` and `send_expo_push`
    directly, and NEITHER reads notification_prefs — they take a user_id and
    fire. Every other kind reaches a device through `send_push`, which consults
    the mode and the window first. Reminders did not, so a cron tick at 03:00
    IST buzzed the phone straight through the window the same user had set, and
    straight through the window the Inbox banner was telling them was in force.

    `push_service`'s own header names this router as the bypass and records that
    the call-site fix was reported rather than made. It is made now, and this is
    the assertion that keeps it made.
    """
    from services import push_service

    monkeypatch.setattr(push_service, "_in_quiet_hours", lambda s, e, now=None: True)
    row = {"prefs": {}, "quiet_start": "22:00", "quiet_end": "07:00"}
    assert await prefs_allow(_pool(row), "u1", "reminder") is False


async def test_reminder_push_is_allowed_outside_it(monkeypatch):
    from services import push_service

    monkeypatch.setattr(push_service, "_in_quiet_hours", lambda s, e, now=None: False)
    row = {"prefs": {}, "quiet_start": "22:00", "quiet_end": "07:00"}
    assert await prefs_allow(_pool(row), "u1", "reminder") is True


async def test_a_user_can_switch_reminders_off_and_be_obeyed(monkeypatch):
    """`reminder` is the highest-volume kind the product emits. Until it gained a
    DEFAULT_PREFS row the lookup fell through to MODE_ALWAYS and no user could
    turn it down; until the call site above consulted prefs_allow, setting it
    changed nothing anyway. Both halves are needed for this to pass."""
    from services import push_service

    monkeypatch.setattr(push_service, "_in_quiet_hours", lambda s, e, now=None: False)
    row = {"prefs": {"reminder": "off"}, "quiet_start": "22:00", "quiet_end": "07:00"}
    assert await prefs_allow(_pool(row), "u1", "reminder") is False


async def test_the_reminder_row_is_written_regardless(monkeypatch):
    """QUIET HOURS SUPPRESS THE BUZZ, NEVER THE RECORD.

    The dispatcher inserts the notification row ABOVE the gate, so a reminder
    that arrives at 03:00 is still in the Inbox in the morning with its real
    timestamp — the record is when it happened, not when you saw it. This pins
    the ordering in `routers/task_reminders.py`: the INSERT is not inside the
    `prefs_allow` branch.
    """
    import inspect

    from routers import task_reminders

    src = inspect.getsource(task_reminders.dispatch_reminders)
    insert_at = src.index("INSERT INTO notifications")
    gate_at = src.index("prefs_allow")
    assert insert_at < gate_at, "the notification row must be written before the delivery gate"
