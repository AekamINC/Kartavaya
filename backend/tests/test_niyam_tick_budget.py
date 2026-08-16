"""A long tick ends by choosing to, not by being disowned.

Nothing in the stack bounds a tick: `command_timeout` is per statement,
gunicorn's `--timeout` does not kill an async request that is awaiting, and
uvicorn does not cancel on client disconnect. So the cron's `curl -m 600` only
ever turned the job red while the work carried on invisibly behind it.

The budget stops the loop STARTING new work; nothing is interrupted mid-flight.
What it must get right is the arithmetic afterwards — a tick that defers half
its batch and reports a full drain is worse than no budget at all, because the
counts are the only signal anyone watches.
"""
from __future__ import annotations

import pytest

from services.niyam import sweep


class _Conn:
    def __init__(self, events):
        self.events = events
        self.processed = set()

    async def fetch(self, sql, *args):
        if "processed_at IS NULL" in sql:
            return [e for e in self.events if e["event_id"] not in self.processed]
        return []

    async def execute(self, sql, *args):
        if "SET processed_at" in sql:
            ids = args[0] if isinstance(args[0], list) else [args[0]]
            self.processed.update(ids)
        return "UPDATE 1"

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(s):
                return conn

            async def __aexit__(s, *a):
                return False
        return _T()


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        conn = self.conn

        class _A:
            async def __aenter__(s):
                return conn

            async def __aexit__(s, *a):
                return False
        return _A()


def _events(n):
    return [{"event_id": i, "org_id": "o", "event_type": "task.created",
             "entity_type": "task", "entity_id": f"t{i}", "actor_id": None,
             "source": "app", "payload": {"after": {}}} for i in range(1, n + 1)]


@pytest.mark.asyncio
async def test_the_budget_stops_the_loop_and_says_how_much_is_left(monkeypatch):
    conn = _Conn(_events(5))
    seen = []

    async def _process(pool, event, now=None):
        seen.append(event["event_id"])
        return []

    monkeypatch.setattr(sweep, "process_event", _process)

    # A clock that runs out of budget after two events. A list of canned values
    # would StopIteration the moment the code calls monotonic once more than the
    # test guessed, which is a test that breaks on refactors rather than on
    # regressions.
    class _Clock:
        def __init__(self):
            self.calls = 0

        def monotonic(self):
            self.calls += 1
            return 0.0 if self.calls <= 3 else 10_000.0

    monkeypatch.setattr(sweep, "time", _Clock())

    out = await sweep.drain(_Pool(conn), limit=200)
    assert out["events_deferred"] > 0, "the budget never triggered"
    assert out["events_drained"] == len(seen), (
        f"reported {out['events_drained']} drained but processed {len(seen)} — "
        f"a budget-limited tick is claiming to be a full one")
    assert out["events_drained"] + out["events_deferred"] == 5


@pytest.mark.asyncio
async def test_a_tick_inside_its_budget_reports_no_deferral(monkeypatch):
    conn = _Conn(_events(3))

    async def _process(pool, event, now=None):
        return []

    monkeypatch.setattr(sweep, "process_event", _process)
    out = await sweep.drain(_Pool(conn), limit=200)
    assert out["events_deferred"] == 0
    assert out["events_drained"] == 3


def test_the_budget_is_under_the_cron_client_timeout():
    """The cron calls with `curl -m 600`. A budget above that would let the job
    go red before the tick chose to stop, which is the situation it exists to
    prevent."""
    assert sweep.TICK_BUDGET_SECONDS < 600
    assert sweep.TICK_BUDGET_SECONDS >= 60, "too tight to finish a real batch"


def test_deferred_events_are_recoverable_without_a_second_mechanism():
    """Deferred events stay claimed, and `claimed_at` expires — the same path a
    killed process uses. If that expiry ever goes, deferral silently loses
    events."""
    assert "claimed_at IS NULL" in sweep._CLAIM_EVENTS
    assert "make_interval" in sweep._CLAIM_EVENTS
    assert sweep.STALE_CLAIM_MINUTES > 0
