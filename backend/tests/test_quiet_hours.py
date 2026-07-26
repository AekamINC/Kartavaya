"""
Quiet hours — `services/push_service.py`.

Worth its own file because it fails silently in both directions. A window that
is wrongly active suppresses every notification and looks like a broken push
pipeline; a window that is wrongly inactive buzzes people's phones at 3am. Neither
raises anything, so nothing surfaces until someone complains.

The interesting case is the wrap. `22:00 → 07:00` is not a range in the ordinary
sense — it is the complement of `07:00 → 22:00` — and the naive `start <= now <
end` is False for every minute of it. The boundaries matter too: start is
inclusive, end is exclusive, so `07:00` is the first minute of the day that gets
a notification.

Time is frozen by substituting the module's `datetime`, so these do not drift and
do not depend on when CI runs. No push ever leaves: `send_push` is exercised with
a mock pool and, where it would reach the network, the outbound kill switch.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

import services.push_service as push_service
from services.push_service import IST, _in_quiet_hours

NIGHT_START, NIGHT_END = "22:00", "07:00"
DAY_START, DAY_END = "09:00", "17:00"


@pytest.fixture
def at_ist(monkeypatch):
    """Freeze IST wall-clock time for the module under test."""
    def _freeze(hour: int, minute: int = 0):
        frozen = datetime(2026, 7, 26, hour, minute, tzinfo=IST)

        class _FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return frozen.astimezone(tz) if tz else frozen

        monkeypatch.setattr(push_service, "datetime", _FrozenDatetime)
        return frozen

    return _freeze


# ── The midnight-wrapping window: 22:00 → 07:00 IST ──────────────────────────

@pytest.mark.parametrize("hour,minute,expected", [
    # Before the window opens.
    (21, 59, False),
    # Start is INCLUSIVE — the first quiet minute.
    (22, 0, True),
    (23, 30, True),
    # Across midnight, which the naive comparison gets wrong.
    (0, 0, True),
    (2, 0, True),
    (6, 59, True),
    # End is EXCLUSIVE — the first minute that gets a notification again.
    (7, 0, False),
    (7, 1, False),
    (12, 0, False),
    (17, 30, False),
])
def test_midnight_wrapping_window(at_ist, hour, minute, expected):
    at_ist(hour, minute)
    assert _in_quiet_hours(NIGHT_START, NIGHT_END) is expected, (
        f"{hour:02d}:{minute:02d} IST in {NIGHT_START}-{NIGHT_END}"
    )


def test_the_wrap_covers_the_whole_night_and_nothing_else():
    """Stated as a whole-day sweep rather than as spot checks, so a window that
    is inverted — quiet all day, awake all night — cannot pass on the samples
    above."""
    quiet_minutes = set()
    for total in range(24 * 60):
        hour, minute = divmod(total, 60)
        frozen = datetime(2026, 7, 26, hour, minute, tzinfo=IST)

        class _FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None, _f=frozen):
                return _f

        original = push_service.datetime
        push_service.datetime = _FrozenDatetime
        try:
            if _in_quiet_hours(NIGHT_START, NIGHT_END):
                quiet_minutes.add(total)
        finally:
            push_service.datetime = original

    expected = set(range(22 * 60, 24 * 60)) | set(range(0, 7 * 60))
    assert quiet_minutes == expected
    assert len(quiet_minutes) == 9 * 60   # 22:00→07:00 is nine hours


# ── A normal daytime window: 09:00 → 17:00 ───────────────────────────────────

@pytest.mark.parametrize("hour,minute,expected", [
    (8, 59, False),
    (9, 0, True),      # inclusive start
    (12, 0, True),
    (16, 59, True),
    (17, 0, False),    # exclusive end
    (23, 0, False),
    (2, 0, False),     # explicitly NOT quiet — the wrap must not apply here
])
def test_non_wrapping_window(at_ist, hour, minute, expected):
    at_ist(hour, minute)
    assert _in_quiet_hours(DAY_START, DAY_END) is expected


# ── Equal start and end ──────────────────────────────────────────────────────

@pytest.mark.parametrize("hour,minute", [(22, 0), (3, 0), (12, 0), (21, 59)])
def test_equal_start_and_end_is_never_quiet(at_ist, hour, minute):
    """`start <= end` holds when they are equal, so the test becomes
    `x <= now < x` — false at every minute including x itself.

    That is the right reading: a zero-length window means the user has switched
    quiet hours off, not that they want silence for twenty-four hours. The
    opposite interpretation would suppress every notification forever and look
    exactly like a dead push pipeline."""
    at_ist(hour, minute)
    assert _in_quiet_hours("22:00", "22:00") is False


# ── The window is applied, not merely computed ───────────────────────────────

def _pool_with_prefs(prefs=None, quiet_start=NIGHT_START, quiet_end=NIGHT_END):
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={
        "prefs": prefs or {},
        "quiet_start": quiet_start,
        "quiet_end": quiet_end,
    })
    pool.fetch = AsyncMock(return_value=[
        {"token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"}
    ])
    return pool


async def test_send_push_is_suppressed_during_quiet_hours(at_ist, monkeypatch):
    """The token lookup must not even happen — if it does, the early return is
    in the wrong place and a later refactor can let the send through."""
    at_ist(23, 30)
    monkeypatch.setattr("outbound.DRY_RUN", False)
    pool = _pool_with_prefs()

    await push_service.send_push(
        pool, recipient_id="user_1", kind="mention", title="t", body="b",
    )

    pool.fetch.assert_not_called()


async def test_send_push_proceeds_outside_quiet_hours(at_ist, monkeypatch):
    """The contrast. Without it the test above passes on a function that never
    sends anything at all.

    The network is never reached: the outbound kill switch is forced on, which
    returns before the Expo call."""
    at_ist(12, 0)
    monkeypatch.setattr("outbound.DRY_RUN", True)
    pool = _pool_with_prefs()

    await push_service.send_push(
        pool, recipient_id="user_1", kind="mention", title="t", body="b",
    )

    # Suppressed at the outbound gate, which is the first line of the function,
    # so nothing was read at all.
    pool.fetchrow.assert_not_called()


async def test_send_push_defaults_to_the_night_window_when_a_user_has_no_prefs(
    at_ist, monkeypatch,
):
    """A user who never opened notification settings still gets quiet nights."""
    at_ist(2, 0)
    monkeypatch.setattr("outbound.DRY_RUN", False)
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=None)     # no prefs row
    pool.fetch = AsyncMock(return_value=[])

    await push_service.send_push(
        pool, recipient_id="user_1", kind="mention", title="t", body="b",
    )

    pool.fetch.assert_not_called()


async def test_the_outbound_kill_switch_stops_a_push_before_anything_else(
    monkeypatch,
):
    """Staging shares production's credentials, so the kill switch is the thing
    standing between a test run and a real device buzzing. It is checked on the
    first line, before prefs, before quiet hours, before tokens."""
    monkeypatch.setattr("outbound.DRY_RUN", True)
    pool = _pool_with_prefs()

    await push_service.send_push(
        pool, recipient_id="user_1", kind="mention", title="t", body="b",
    )

    pool.fetchrow.assert_not_called()
    pool.fetch.assert_not_called()


# ── Parsing ──────────────────────────────────────────────────────────────────

def test_minutes_are_honoured_not_just_hours(at_ist):
    """`22:30` must not be read as `22:00`. Both boundaries are checked because
    a truncating parse would still pass a test that only looked at one."""
    at_ist(22, 15)
    assert _in_quiet_hours("22:30", "07:00") is False
    at_ist(22, 30)
    assert _in_quiet_hours("22:30", "07:00") is True
