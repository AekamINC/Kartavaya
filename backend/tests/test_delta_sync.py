"""`?since=` — the delta contract.

Owner's decision, 2026-08-09: the mobile app syncs what changed since the last
session, for real. Every test here is a way a delta sync goes wrong quietly —
the failure mode throughout is not an error, it is a phone showing data that
stopped being true weeks ago.
"""
import inspect
import pathlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import server
from routers import graha, sync
from services import delta_sync

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        line for line in src.splitlines()
        if not line.strip().startswith("#")).split())


# ── parse_since ─────────────────────────────────────────────────────────────

def test_it_reads_iso_with_and_without_a_z():
    a = delta_sync.parse_since("2026-08-09T10:00:00Z")
    b = delta_sync.parse_since("2026-08-09T10:00:00+00:00")
    assert a == b


def test_a_naive_timestamp_is_utc_not_server_local():
    """Otherwise the window shifts by hours depending on which region the
    container happens to run in, and this service has moved regions before."""
    dt = delta_sync.parse_since("2026-08-09T10:00:00")
    assert dt.tzinfo is not None
    assert dt.utcoffset() == timedelta(0)


def test_none_means_a_full_list_not_an_error():
    assert delta_sync.parse_since(None) is None
    assert delta_sync.parse_since("") is None


def test_a_future_since_is_refused_rather_than_answered():
    """A phone whose clock runs fast would otherwise be told, correctly and
    uselessly, that nothing has changed — for as long as its clock is wrong."""
    ahead = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    with pytest.raises(HTTPException) as e:
        delta_sync.parse_since(ahead)
    assert e.value.status_code == 400
    assert "clock" in str(e.value.detail)


def test_ordinary_clock_drift_is_tolerated():
    """Refusing a device that is ninety seconds fast would break sync for
    roughly every phone."""
    slight = (datetime.now(timezone.utc) + timedelta(seconds=90)).isoformat()
    assert delta_sync.parse_since(slight) is not None


def test_a_since_from_last_year_is_refused():
    old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    with pytest.raises(HTTPException):
        delta_sync.parse_since(old)


def test_garbage_names_what_to_send_instead():
    with pytest.raises(HTTPException) as e:
        delta_sync.parse_since("yesterday")
    assert "synced_at" in str(e.value.detail)


# ── the envelope ────────────────────────────────────────────────────────────

def test_the_envelope_carries_the_servers_clock():
    """The client stores THIS and sends it back — never its own clock."""
    now = datetime.now(timezone.utc)
    env = delta_sync.envelope([], now - timedelta(hours=1), now)
    assert env["synced_at"] == now.isoformat()
    assert env["delta"] is True


def test_a_truncated_delta_says_so():
    """A client that treats a capped delta as complete never learns about the
    rows past the cap."""
    now = datetime.now(timezone.utc)
    env = delta_sync.envelope([{}] * 200, now, now, limit=200)
    assert env["truncated"] is True
    assert delta_sync.envelope([{}], now, now, limit=200)["truncated"] is False


def test_the_horizon_is_reported_not_assumed():
    now = datetime.now(timezone.utc)
    assert "tombstone_horizon" in delta_sync.envelope([], None, now)


# ── the boundary ────────────────────────────────────────────────────────────

def test_the_comparison_is_strictly_greater():
    """`>=` re-sends every row that landed in the final microsecond of the last
    sync, on every sync, for ever."""
    params = []
    clause = delta_sync.since_clause("t.updated_at", datetime.now(timezone.utc), params)
    assert ">" in clause and ">=" not in clause
    assert len(params) == 1


def test_the_clock_is_read_before_the_query_not_after():
    """A row written WHILE the query runs must fall into the next window rather
    than into neither."""
    for fn in (server.list_tasks, graha.list_deals):
        code = _code(fn)
        assert code.index("synced_at = datetime.now") < code.index("await pool.fetch"), \
            f"{fn.__name__} stamps the clock after the query — rows can be lost"


# ── the deletion rules, which are where deltas actually fail ────────────────

def test_a_delta_must_see_soft_deleted_rows():
    """`is_active=FALSE` is HOW a deletion reaches the device. Filtering it out
    of a delta is the single most likely way to ship a sync that looks perfect
    and leaves deleted records on every phone."""
    assert delta_sync.include_inactive_for_delta(datetime.now(timezone.utc)) is True
    assert delta_sync.include_inactive_for_delta(None) is False
    code = _code(graha.list_deals)
    assert 'if since_dt is not None else "AND d.is_active=TRUE ' in code


def test_a_delta_must_see_archived_rows():
    """A task archived since the last sync is a CHANGE. Filtering it out is how
    a phone keeps showing a task the web archived."""
    assert "if since_dt is None:" in _code(server.list_tasks)
    assert "since_dt is None and not include_archived" in _code(graha.list_deals)


def test_a_truncated_delta_is_ordered_so_it_can_be_resumed():
    """Sorted newest-first, a truncated delta silently drops the middle of the
    window for ever — the client resumes from the last row it received."""
    code = _code(graha.list_deals)
    assert "ORDER BY d.updated_at ASC" in code


# ── tombstones ──────────────────────────────────────────────────────────────

def test_a_device_past_the_horizon_is_told_to_resync():
    """A short list that looks complete is worse than an honest "start again"."""
    code = _code(sync.list_tombstones)
    assert "resync_required" in code and "horizon" in code


def test_truncated_tombstones_resume_from_the_last_row():
    code = _code(sync.list_tombstones)
    assert 'data[-1]["deleted_at"]' in code


def test_the_migration_records_the_key_clients_actually_use():
    """`tasks` carries BOTH a uuid `id` and the `task_id` every client uses.
    Reading `id` first wrote a tombstone naming a key no device has seen — so
    the deletion would never be applied. Caught by a live rolled-back proof."""
    sql = (BACKEND / "migrations" / "138_delta_sync.sql").read_text(encoding="utf-8")
    body = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
    assert "COALESCE(to_jsonb(OLD) ->> TG_ARGV[1], to_jsonb(OLD) ->> 'id')" in body
    assert "write_tombstone('task', 'task_id')" in body


def test_the_hard_deleted_tables_all_have_a_tombstone_trigger():
    """tasks, follow-ups and teams are DELETEd outright in the codebase. A
    table that deletes for real and has no trigger leaks rows onto every
    device, silently and for ever."""
    sql = (BACKEND / "migrations" / "138_delta_sync.sql").read_text(encoding="utf-8")
    for entity in ("'task'", "'follow_up'", "'team'"):
        assert f"write_tombstone({entity}," in sql


def test_the_two_tables_with_no_updated_at_get_one_by_trigger():
    """"Remember to set updated_at" is a rule that holds until the next handler
    is written."""
    sql = (BACKEND / "migrations" / "138_delta_sync.sql").read_text(encoding="utf-8")
    assert "trg_touch_activities" in sql and "trg_touch_follow_ups" in sql
    assert "BEFORE UPDATE ON staging.graha_activities" in sql


def test_the_delta_columns_are_indexed():
    """Without these, every app open is a sequential scan on the tables that
    grow fastest."""
    sql = (BACKEND / "migrations" / "138_delta_sync.sql").read_text(encoding="utf-8")
    for idx in ("tasks_delta", "graha_deals_delta", "ganit_invoices_delta"):
        assert idx in sql


# ── the plain path is untouched ─────────────────────────────────────────────

def test_a_call_with_no_since_still_answers_the_old_shape():
    """Every existing caller reads a bare array from /tasks and {"data": …}
    from /deals. A delta is opt-in and must not change either."""
    assert "if since_dt is None:\n        return tasks" in inspect.getsource(server.list_tasks)
    assert "return _listed(rows, limit=200)" in _code(graha.list_deals)
