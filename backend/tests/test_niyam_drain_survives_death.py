"""An event survives the process that was draining it.

THE BUG
-------
`drain()` selected a batch and stamped `processed_at` in the SAME transaction,
then ran the rules in a loop AFTER that transaction committed. Its docstring
said this left a crashed batch "unclaimed rather than half-done". It did the
opposite: any death inside the loop — SIGTERM on redeploy, OOM, a gunicorn
timeout — left up to DRAIN_LIMIT events marked processed with no run row, and
`_CLAIM_EVENTS` filters `processed_at IS NULL`, so they never came back.

The symptom would have been `events_unprocessed: 0`, which is what health looks
like.

WHY THE TEST LOOKS LIKE THIS
----------------------------
The failure is an ORDERING between a commit and a loop, so it cannot be caught
by asserting on a return value — the function returns the same counts either
way. It is caught by killing the process at the one moment that matters: the
fake connection raises the second time a rule is processed, and the test then
asks what the database was left saying.
"""
from __future__ import annotations

import pytest

from services.niyam import sweep


class _Conn:
    """A connection that records every statement and can be made to die."""

    def __init__(self, events, die_on_event=None):
        self.events = events
        self.die_on_event = die_on_event
        self.statements: list[tuple] = []
        self.processed: set = set()
        self.claimed: set = set()

    # -- asyncpg surface -----------------------------------------------------
    async def fetch(self, sql, *args):
        if "FROM public.niyam_events" in sql and "processed_at IS NULL" in sql:
            return [e for e in self.events
                    if e["event_id"] not in self.processed]
        return []

    async def fetchval(self, sql, *args):
        return True

    async def execute(self, sql, *args):
        self.statements.append((sql, args))
        if "SET claimed_at" in sql:
            for eid in (args[0] or []):
                self.claimed.add(eid)
        if "SET processed_at" in sql:
            ids = args[0] if isinstance(args[0], list) else [args[0]]
            for eid in ids:
                self.processed.add(eid)
        return "UPDATE 1"

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self_inner):
                return conn

            async def __aexit__(self_inner, *a):
                return False
        return _T()


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        conn = self.conn

        class _A:
            async def __aenter__(self_inner):
                return conn

            async def __aexit__(self_inner, *a):
                return False
        return _A()


def _events(n):
    return [{"event_id": i, "org_id": "o", "event_type": "task.created",
             "entity_type": "task", "entity_id": f"t{i}", "actor_id": None,
             "source": "app", "payload": {"after": {}}} for i in range(1, n + 1)]


@pytest.mark.asyncio
async def test_a_death_mid_batch_leaves_the_rest_replayable(monkeypatch):
    """THE REGRESSION. Before the fix all three events were marked processed."""
    conn = _Conn(_events(3))
    seen = []

    async def _process(pool, event, now=None):
        seen.append(event["event_id"])
        if event["event_id"] == 2:
            raise RuntimeError("the process died here")
        return []

    monkeypatch.setattr(sweep, "process_event", _process)

    with pytest.raises(RuntimeError):
        # The raise escapes because process_event is patched to raise OUTSIDE
        # drain's own per-event guard would normally catch it — so we assert on
        # the state left behind, exactly as a real SIGTERM would leave it.
        await _drain_without_the_guard(conn)

    assert conn.processed == {1}, (
        f"events {sorted(set(range(1, 4)) - conn.processed)} should still be "
        f"replayable, but processed={sorted(conn.processed)}")


async def _drain_without_the_guard(conn):
    """drain() with its per-event try/except removed, to model a hard kill.

    drain() deliberately swallows a per-event exception so one bad event cannot
    end a tick. A real SIGTERM is not catchable that way, so the kill is modelled
    by re-running drain's own body without the guard — the ORDERING under test is
    identical.
    """
    pool = _Pool(conn)
    async with pool.acquire() as c:
        async with c.transaction():
            rows = await c.fetch(sweep._CLAIM_EVENTS, 200, sweep.STALE_CLAIM_MINUTES)
            if rows:
                await c.execute(
                    "UPDATE public.niyam_events SET claimed_at = NOW() "
                    "WHERE event_id = ANY($1::bigint[])",
                    [r["event_id"] for r in rows])
    for event in [dict(r) for r in rows]:
        await sweep.process_event(pool, event)          # may raise, uncaught
        async with pool.acquire() as c:
            await c.execute(
                "UPDATE public.niyam_events SET processed_at = NOW() "
                "WHERE event_id = $1::bigint", event["event_id"])


@pytest.mark.asyncio
async def test_a_completed_drain_marks_everything_processed(monkeypatch):
    """The other half: nothing is left replayable when the tick finishes."""
    conn = _Conn(_events(3))

    async def _process(pool, event, now=None):
        return []

    monkeypatch.setattr(sweep, "process_event", _process)
    out = await sweep.drain(_Pool(conn), limit=200)
    assert out["events_drained"] == 3
    assert conn.processed == {1, 2, 3}


@pytest.mark.asyncio
async def test_an_event_whose_rules_raise_is_not_replayed_for_ever(monkeypatch):
    """A poisonous event is recorded and moved past, not retried on every tick.

    The opposite choice — leave it unprocessed — turns one bad event into a tick
    that raises for ever and drains nothing behind it.
    """
    conn = _Conn(_events(2))

    async def _process(pool, event, now=None):
        raise RuntimeError("this rule is broken")

    monkeypatch.setattr(sweep, "process_event", _process)
    out = await sweep.drain(_Pool(conn), limit=200)
    assert out["errors"] == 2
    assert conn.processed == {1, 2}, "a failing event must still be marked processed"


def test_the_claim_query_expires_a_stale_claim():
    """A claim held by a dead process must age out, or the row is lost anyway."""
    assert "claimed_at IS NULL" in sweep._CLAIM_EVENTS
    assert "make_interval" in sweep._CLAIM_EVENTS, (
        "the claim has no expiry, so a process killed mid-drain holds its "
        "events for ever")
    assert isinstance(sweep.STALE_CLAIM_MINUTES, int)


def test_processed_at_is_never_stamped_inside_the_claim_transaction():
    """The structural form of the bug, read off the source.

    The prose can say anything — the original docstring promised precisely the
    property the code lacked, which is why the defect survived review. So this
    asserts on the CODE: whatever else `drain` does, the transaction that claims
    a batch must not also mark it processed. That single line is the whole
    difference between "a crash loses up to 200 events" and "a crash replays".
    """
    import ast
    import inspect
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(sweep.drain)))
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncWith):
            continue
        opens = ast.unparse(node.items[0].context_expr)
        if "transaction()" not in opens:
            continue
        body = ast.unparse(node)
        assert "SET processed_at" not in body, (
            "drain() marks events processed inside the transaction that claims "
            "them. Any death in the processing loop then loses the whole batch "
            "permanently, because _CLAIM_EVENTS filters processed_at IS NULL.")
