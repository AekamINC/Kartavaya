"""
Tests for `services/push_service.py` — the preference gate, quiet hours, and the
guarantee that the test suite itself cannot send anything.

The quiet-hours cases matter more than they look. `_in_quiet_hours` decides
whether a person's phone stays silent, and every failure mode here is invisible:
nothing errors, notifications simply stop arriving. The tests below pin the two
readings that a naive implementation gets wrong — the midnight wrap and the
zero-length window — at a fixed clock rather than whenever the suite runs.
"""
import importlib
import os
from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from services.push_service import (
    DEFAULT_PREFS,
    DEFAULT_QUIET_END,
    DEFAULT_QUIET_START,
    IST,
    WINDOW_OFF,
    _in_quiet_hours,
    _parse_hhmm,
    dnd_enabled,
    encode_window,
    normalise_prefs,
    normalise_window,
    prefs_allow,
)


def at(hh, mm=0):
    """A fixed IST instant, so wrap tests do not depend on the wall clock."""
    return datetime(2026, 7, 26, hh, mm, tzinfo=IST)


# ── The suite must not be able to send ───────────────────────────────────────

def test_outbound_mode_is_dry_during_tests():
    """conftest forces OUTBOUND_MODE=dry before any app import.

    Without it `outbound.MODE` defaults to "live" and every sender's gate opens:
    the only thing left between send_push and a real POST to Expo production is
    whichever mock happens to return an empty list. This test is the tripwire
    for anyone who removes that line.
    """
    assert os.environ.get("OUTBOUND_MODE") == "dry"

    import outbound
    assert outbound.DRY_RUN is True
    assert outbound.suppressed("push", "user_x", "subject") is True
    assert outbound.suppressed("email", "a@b.c", "subject") is True


@pytest.mark.anyio
async def test_send_push_short_circuits_before_any_query(mock_pool):
    """Under dry mode send_push must return before touching the DB or network."""
    from services.push_service import send_push

    mock_pool.fetch = AsyncMock(return_value=[])
    mock_pool.fetchrow = AsyncMock(return_value=None)

    await send_push(
        mock_pool, recipient_id="user_x", kind="mention",
        title="t", body="b",
    )
    assert mock_pool.fetch.await_count == 0
    assert mock_pool.fetchrow.await_count == 0


# ── HH:MM parsing ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    ("00:00", 0), ("07:00", 420), ("22:00", 1320), ("23:59", 1439),
])
def test_parse_hhmm_valid(value, expected):
    assert _parse_hhmm(value) == expected


@pytest.mark.parametrize("value", [
    "24:00", "7:00", "07:60", "-1:00", "", "  ", "abc", None, 700, [], {}, "07:00:00",
])
def test_parse_hhmm_rejects_junk(value):
    assert _parse_hhmm(value) is None


# ── Quiet hours ──────────────────────────────────────────────────────────────

def test_daytime_window_is_half_open():
    assert _in_quiet_hours("09:00", "17:00", now=at(9, 0)) is True
    assert _in_quiet_hours("09:00", "17:00", now=at(16, 59)) is True
    # Over AT the end, so an alarm on the boundary is delivered.
    assert _in_quiet_hours("09:00", "17:00", now=at(17, 0)) is False
    assert _in_quiet_hours("09:00", "17:00", now=at(8, 59)) is False


def test_window_wraps_midnight():
    """22:00-07:00 is one window across two arcs of the clock."""
    for t in (at(22, 0), at(23, 59), at(0, 0), at(3, 30), at(6, 59)):
        assert _in_quiet_hours("22:00", "07:00", now=t) is True
    for t in (at(7, 0), at(12, 0), at(21, 59)):
        assert _in_quiet_hours("22:00", "07:00", now=t) is False


def test_zero_length_window_means_no_quiet_hours():
    """Equal bounds must never be read as 'always quiet'.

    Both readings are defensible from the data; the tie breaks on consequence.
    All-day silences every notification indefinitely with nothing on screen to
    explain it. Off costs one unwanted buzz.
    """
    for t in (at(0, 0), at(12, 0), at(23, 59)):
        assert _in_quiet_hours("09:00", "09:00", now=t) is False


@pytest.mark.parametrize("start,end", [
    ("nonsense", "07:00"), ("22:00", "nonsense"), (None, None), ("25:00", "07:00"),
])
def test_unparseable_window_never_mutes(start, end):
    """Bad data must not silently disable a user's notifications."""
    assert _in_quiet_hours(start, end, now=at(3, 0)) is False


# ── Mode resolution ──────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_corrupt_mode_falls_back_to_that_kinds_default(mock_pool):
    """An unrecognised mode must resolve to the kind's default, not to 'always'.

    `created` defaults to off, so a corrupted value must stay quiet rather than
    becoming the loudest setting.
    """
    mock_pool.fetchrow = AsyncMock(return_value={
        "prefs": {"created": "Off"},          # capital O — not a valid mode
        "quiet_start": "22:00", "quiet_end": "07:00",
    })
    assert await prefs_allow(mock_pool, "user_x", "created") is False


@pytest.mark.anyio
async def test_prefs_accepted_as_raw_json_string(mock_pool):
    """Behind PgBouncer db.py skips the jsonb codec and this arrives as a str.

    The old code called .get() on it inside a broad except, so the push vanished
    with a log line naming the wrong cause.
    """
    mock_pool.fetchrow = AsyncMock(return_value={
        "prefs": '{"mention": "off"}',
        "quiet_start": "22:00", "quiet_end": "07:00",
    })
    assert await prefs_allow(mock_pool, "user_x", "mention") is False


@pytest.mark.anyio
async def test_prefs_allow_fails_open_on_db_error(mock_pool):
    """Losing an approval request to a prefs timeout is the worse failure."""
    mock_pool.fetchrow = AsyncMock(side_effect=RuntimeError("pool exhausted"))
    assert await prefs_allow(mock_pool, "user_x", "approval_request") is True


@pytest.mark.anyio
async def test_mine_only_respects_ownership(mock_pool):
    mock_pool.fetchrow = AsyncMock(return_value={
        "prefs": {"comment": "mine_only"},
        "quiet_start": "00:00", "quiet_end": "00:00",
    })
    assert await prefs_allow(mock_pool, "u", "comment", is_mine=True) is True
    assert await prefs_allow(mock_pool, "u", "comment", is_mine=False) is False


# ── Write-path validation ────────────────────────────────────────────────────

def test_normalise_prefs_drops_unknown_and_invalid():
    out = normalise_prefs({
        "mention": "off",              # kept
        "comment": "Off",              # invalid mode
        "not_a_kind": "always",        # unknown kind
        "assigned": {"nested": True},  # not a string
        "done": "project",             # kept
    })
    assert out == {"mention": "off", "done": "project"}


@pytest.mark.parametrize("raw", [None, "string", 42, [], True])
def test_normalise_prefs_rejects_non_dicts(raw):
    assert normalise_prefs(raw) == {}


def test_omitted_window_field_means_unchanged():
    """The reset-on-omit bug: a save that sends only prefs must not wipe the
    user's customised overnight window back to the default."""
    assert normalise_window(None, None, current=("23:30", "06:15")) == ("23:30", "06:15")
    assert normalise_window("21:00", None, current=("23:30", "06:15")) == ("21:00", "06:15")


def test_normalise_window_falls_back_when_stored_value_is_junk():
    assert normalise_window(None, None, current=("junk", "junk")) == (
        DEFAULT_QUIET_START, DEFAULT_QUIET_END,
    )


# ── The designed DND switch ──────────────────────────────────────────────────

def test_dnd_enabled_is_derived_from_the_window():
    assert dnd_enabled("22:00", "07:00") is True
    assert dnd_enabled("00:00", "00:00") is False
    assert dnd_enabled("junk", "07:00") is False


def test_switching_dnd_off_writes_the_off_window():
    assert encode_window(False, "22:00", "07:00") == WINDOW_OFF
    assert dnd_enabled(*encode_window(False, "22:00", "07:00")) is False


def test_switching_dnd_on_keeps_a_real_window():
    assert encode_window(True, "23:00", "06:00") == ("23:00", "06:00")
    # "On" with a zero-length window is a contradiction — the UI would show DND
    # active while nothing is ever silenced.
    assert encode_window(True, "09:00", "09:00") == (DEFAULT_QUIET_START, DEFAULT_QUIET_END)


def test_dnd_round_trips_through_the_stored_columns():
    for start, end in (("22:00", "07:00"), ("23:30", "06:15")):
        stored = encode_window(True, start, end)
        assert dnd_enabled(*stored) is True
        assert stored == (start, end)


# ── Vocabulary is single-sourced ─────────────────────────────────────────────

def test_server_uses_push_service_vocabulary():
    """server.py used to carry its own copy of DEFAULT_PREFS, and it had already
    drifted: push_service gained `reminder` and the copy did not, so the switch
    was enforced on delivery and invisible in the UI."""
    import server
    assert server.DEFAULT_PREFS is DEFAULT_PREFS
    assert "reminder" in DEFAULT_PREFS
