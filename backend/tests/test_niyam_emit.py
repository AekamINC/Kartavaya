"""The emitter: what it writes, what it refuses, and what it never carries.

The refusals matter more than the happy path here. An event is a side effect of
a business write, so the rule this file pins is that a bad event is dropped with
a warning and NEVER takes the caller's transaction down with it — an invoice
must not fail to save because an automation event was malformed.
"""
import json

import pytest

from services.niyam import emit as E


class FakeConn:
    """Records what would have been executed. Stands in for the connection the
    caller is already using — the point being that this is a CONNECTION and not
    a pool, so the event shares the business write's transaction."""

    def __init__(self, returning=1):
        self.calls = []
        self._returning = returning

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        return self._returning


async def test_writes_one_row_with_every_column_bound():
    conn = FakeConn()
    out = await E.emit_event(
        conn,
        org_id="11111111-1111-1111-1111-111111111111",
        event_type="task.status_changed",
        actor_id="user_abc123",
        entity_type="task",
        entity_id="task_deadbeef01",
        before={"status": "in_progress"},
        after={"status": "done"},
    )
    assert out == 1
    sql, args = conn.calls[0]
    assert "INSERT INTO staging.niyam_events" in sql
    # Every parameter is CAST. An untyped parameter expression is an instant
    # PgBouncer 500 — this product lost every credit spend to that once.
    for cast in ("$1::uuid", "$2::text", "$7::jsonb"):
        assert cast in sql
    assert args[1] == "task.status_changed"
    assert args[4] == "user_abc123"
    assert args[5] == "app"
    payload = json.loads(args[6])
    assert payload == {"before": {"status": "in_progress"}, "after": {"status": "done"}}


async def test_dedupe_returns_none_and_is_not_an_error():
    """A sweep re-emitting inside its window is normal, not a failure."""
    conn = FakeConn(returning=None)
    out = await E.emit_event(
        conn, org_id="1" * 8 + "-1111-1111-1111-111111111111",
        event_type="invoice.overdue", source="sweep",
        dedupe_key="invoice_overdue:inv_1:2026-08-16",
    )
    assert out is None
    assert "ON CONFLICT DO NOTHING" in conn.calls[0][0]


# ── the refusals ─────────────────────────────────────────────────────────────

async def test_an_app_event_with_no_actor_is_refused(caplog):
    """The production co-write defence, one layer earlier than the CHECK.

    Enforced in SQL too (niyam_events_actor_ck) because the other deployment
    against this shared database does not run this code — but caught here so
    OUR mistake is a warning naming the event, not a constraint violation that
    rolls back somebody's invoice.
    """
    conn = FakeConn()
    out = await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="task.created", source="app", actor_id=None,
    )
    assert out is None
    assert not conn.calls, "nothing may be written for a refused event"
    assert "no actor" in caplog.text


async def test_a_machine_source_may_have_no_actor():
    """A sweep has no person behind it, and pretending otherwise would be the
    lie the actor column exists to prevent."""
    conn = FakeConn()
    out = await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="invoice.overdue", source="sweep",
    )
    assert out == 1
    assert conn.calls[0][1][4] is None


async def test_an_unknown_source_is_refused(caplog):
    conn = FakeConn()
    out = await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="x.y", source="webhook", actor_id="user_a",
    )
    assert out is None
    assert not conn.calls
    assert "unknown source" in caplog.text


async def test_a_database_error_is_NOT_swallowed():
    """The one thing that must propagate. A DB error here means the caller's
    transaction is already broken; hiding it would hide that."""
    class Broken(FakeConn):
        async def fetchval(self, sql, *args):
            raise RuntimeError("connection is closed")

    with pytest.raises(RuntimeError):
        await E.emit_event(
            Broken(), org_id="11111111-1111-1111-1111-111111111111",
            event_type="task.created", actor_id="user_a",
        )


# ── what a payload may never carry ───────────────────────────────────────────

@pytest.mark.parametrize("key", ["body", "html", "text", "content", "message", "password", "token", "secret"])
async def test_bodies_and_secrets_are_stripped(key):
    """A condition cannot compare a message body, so carrying one turns this
    table into a second copy of the product's content with its own retention
    window and nobody watching it."""
    conn = FakeConn()
    await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="chat.posted", actor_id="user_a",
        after={key: "the customer's actual words", "channel_id": "c1"},
    )
    payload = json.loads(conn.calls[0][1][6])
    assert key not in payload["after"]
    assert payload["after"]["channel_id"] == "c1", "the comparable field survives"


async def test_nested_bodies_are_stripped_too():
    conn = FakeConn()
    await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="x.y", actor_id="user_a",
        after={"msg": {"body": "secret words", "id": "m1"}},
    )
    payload = json.loads(conn.calls[0][1][6])
    assert payload["after"]["msg"] == {"id": "m1"}


async def test_unserialisable_values_are_dropped_not_stringified():
    """Silently str()-ing a datetime produces conditions that compare against a
    repr, which works until the format changes."""
    import datetime
    conn = FakeConn()
    await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="x.y", actor_id="user_a",
        after={"when": datetime.datetime(2026, 8, 16), "status": "done"},
    )
    payload = json.loads(conn.calls[0][1][6])
    assert "when" not in payload["after"]
    assert payload["after"]["status"] == "done"


async def test_payload_is_always_present_even_when_empty():
    """The engine reads payload.after unconditionally; a NULL here would make
    every condition a None-check at the far end."""
    conn = FakeConn()
    await E.emit_event(
        conn, org_id="11111111-1111-1111-1111-111111111111",
        event_type="x.y", actor_id="user_a",
    )
    assert json.loads(conn.calls[0][1][6]) == {"before": {}, "after": {}}
