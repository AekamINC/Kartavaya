"""Three CRM writes now announce themselves: deal.created, client.created,
lead.converted.

The contract under test is emit.py's one rule — the emitter is handed the
BUSINESS WRITE'S OWN CONNECTION, inside the write's own transaction — plus the
two properties a wiring can silently lose:

  * the row handed to the emitter is the row the database returned
    (`RETURNING *`, not the three columns the response needs), and for a
    conversion it is the row AS CONVERTED, not the row that was checked;
  * a refusal or a failed write emits NOTHING. There is no try/except around
    the emitter in the router — the shared transaction is the guarantee — so
    these tests prove the emitter is simply never reached on those paths.

The fake pool is the `_Pool` idiom from test_target_attainment.py: `acquire()`
lends the pool itself out as the connection, so every statement — through the
pool or through the conn — lands in one ledger, and "the emitter received the
write's own connection" is assertable as `conn is pool`.

The emitters are monkeypatched on `services.niyam.subjects`, not on the router
module: graha imports each emitter INSIDE the handler (the committed idiom at
its other call sites), so the function-local import re-reads the module
attribute at call time and finds the stub.
"""
import uuid

import pytest
from fastapi import HTTPException

import routers.graha as graha
import services.niyam.subjects as subjects

ORG = "5b7c9a10-0000-4000-8000-000000000001"
ACTOR = "user_admin001"


class _Pool:
    def __init__(self):
        self.calls = []

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return None

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return None

    # The proxy: the conn a handler acquires IS this pool, so one ledger holds
    # the writes and the emit markers in the order they happened.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return pool

            async def __aexit__(_s, *exc):
                return False
        return _A()

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *exc):
                return False
        return _T()


@pytest.fixture
def pool(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(graha, "get_pool", _get_pool)
    return p


@pytest.fixture
def emitted(monkeypatch, pool):
    """Recorded emitter calls: (name, conn, kwargs). Each stub also drops a
    marker into the pool's ledger so ordering against the SQL is assertable."""
    calls = []

    def _stub(name):
        async def _record(conn, **kw):
            calls.append((name, conn, kw))
            pool.calls.append((f"<emit {name}>", ()))
            return 1
        return _record

    for name in ("deal_created", "client_created", "lead_converted"):
        monkeypatch.setattr(subjects, name, _stub(name))
    return calls


def _ledger_index(pool, fragment):
    for i, (q, _) in enumerate(pool.calls):
        if fragment in q:
            return i
    raise AssertionError(f"nothing in the ledger contains {fragment!r}")


# ── client.created ───────────────────────────────────────────

CLIENT_ROW = {
    "id": "a0000000-0000-0000-0000-000000000001",
    "name": "Acme Ltd",
    "ref_no": "A-1",
    "gstin": "27ABCDE1234F1Z5",
    "created_by": ACTOR,
}


@pytest.mark.asyncio
async def test_create_client_emits_on_the_writes_own_connection(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        return dict(CLIENT_ROW)

    pool.fetchrow = _fetchrow

    resp = await graha.create_client(
        graha.ClientCreate(name="Acme Ltd", ref_no="A-1"),
        user={"user_id": ACTOR}, org_id=ORG,
    )

    assert len(emitted) == 1
    name, conn, kw = emitted[0]
    assert name == "client_created"
    assert conn is pool, "the emitter did not get the write's own connection"
    assert kw["org_id"] == ORG
    assert kw["actor_id"] == ACTOR
    assert kw["client_id"] == CLIENT_ROW["id"]
    # The full row rode to the emitter — the fields the payload needs and the
    # response never carried.
    assert kw["row"]["gstin"] == CLIENT_ROW["gstin"]
    assert kw["row"]["created_by"] == ACTOR

    insert = pool.calls[_ledger_index(pool, "INSERT INTO staging.graha_clients")][0]
    assert "RETURNING *" in insert, "the emitter is reading a three-column row"
    assert _ledger_index(pool, "INSERT INTO staging.graha_clients") \
        < _ledger_index(pool, "<emit client_created>"), "emitted before the write"

    # The widened RETURNING must not leak into the response shape.
    assert resp == {"status": "created", "id": CLIENT_ROW["id"],
                    "name": "Acme Ltd", "ref_no": "A-1"}


@pytest.mark.asyncio
async def test_create_client_failed_insert_emits_nothing(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        raise RuntimeError("unique violation")

    pool.fetchrow = _fetchrow

    with pytest.raises(RuntimeError):
        await graha.create_client(
            graha.ClientCreate(name="Acme Ltd"),
            user={"user_id": ACTOR}, org_id=ORG,
        )
    assert emitted == [], "a write that failed still announced itself"


# ── deal.created ─────────────────────────────────────────────

DEAL_ROW = {
    "id": "d0000000-0000-0000-0000-000000000001",
    "title": "Big Deal",
    "stage": "New",
    "value": 50000,
    "client_id": None,
    "assigned_to": None,
    "created_by": ACTOR,
}


@pytest.mark.asyncio
async def test_create_deal_emits_on_the_writes_own_connection(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        return dict(DEAL_ROW)

    pool.fetchrow = _fetchrow

    resp = await graha.create_deal(
        graha.DealCreate(title="Big Deal", value=50000,
                         pipeline_id="p0000000-0000-0000-0000-000000000001"),
        user={"user_id": ACTOR}, org_id=ORG,
    )

    assert len(emitted) == 1
    name, conn, kw = emitted[0]
    assert name == "deal_created"
    assert conn is pool
    assert kw["org_id"] == ORG
    assert kw["actor_id"] == ACTOR
    assert kw["deal_id"] == DEAL_ROW["id"]
    # deal_created reads value / client_id / assigned_to / created_by — the
    # columns the old three-column RETURNING never carried.
    assert kw["row"]["value"] == 50000
    assert kw["row"]["created_by"] == ACTOR

    insert = pool.calls[_ledger_index(pool, "INSERT INTO staging.graha_deals")][0]
    assert "RETURNING *" in insert
    assert _ledger_index(pool, "INSERT INTO staging.graha_deals") \
        < _ledger_index(pool, "<emit deal_created>")

    assert resp == {"status": "created", "id": DEAL_ROW["id"],
                    "title": "Big Deal", "stage": "New"}


@pytest.mark.asyncio
async def test_create_deal_failed_insert_emits_nothing(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "INSERT INTO staging.graha_deals" in q:
            raise RuntimeError("fk violation")
        return {"id": "p001"}

    pool.fetchrow = _fetchrow

    with pytest.raises(RuntimeError):
        await graha.create_deal(
            graha.DealCreate(title="Big Deal"),
            user={"user_id": ACTOR}, org_id=ORG,
        )
    assert emitted == []


# ── lead.converted ───────────────────────────────────────────

CONTACT_ID = uuid.UUID("c0000000-0000-0000-0000-000000000001")

CONVERTED_ROW = {
    "id": str(CONTACT_ID),
    "contact_type": "customer",
    "company": "Acme",
    "client_id": "a0000000-0000-0000-0000-000000000001",
}


@pytest.mark.asyncio
async def test_convert_lead_emits_the_row_as_converted(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "UPDATE staging.graha_contacts" in q:
            return dict(CONVERTED_ROW)
        return {"id": str(CONTACT_ID), "contact_type": "lead"}

    pool.fetchrow = _fetchrow

    resp = await graha.convert_lead(
        CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG,
    )

    assert len(emitted) == 1
    name, conn, kw = emitted[0]
    assert name == "lead_converted"
    assert conn is pool
    assert kw["org_id"] == ORG
    assert kw["actor_id"] == ACTOR
    assert kw["contact_id"] == str(CONTACT_ID)
    # The row AS CONVERTED: contact_type is what the contact became and
    # client_id is the company it now belongs to — never the pre-check row.
    assert kw["row"]["contact_type"] == "customer"
    assert kw["row"]["client_id"] == CONVERTED_ROW["client_id"]

    # The pre-check rides inside the transaction under FOR UPDATE, so two
    # simultaneous converts cannot both pass it and emit twice.
    check = pool.calls[_ledger_index(pool, "SELECT id, contact_type")][0]
    assert "FOR UPDATE" in check

    update = pool.calls[_ledger_index(pool, "UPDATE staging.graha_contacts")][0]
    assert "RETURNING *" in update
    assert _ledger_index(pool, "UPDATE staging.graha_contacts") \
        < _ledger_index(pool, "<emit lead_converted>")

    assert resp == {"status": "converted", "contact": CONVERTED_ROW}


@pytest.mark.asyncio
async def test_convert_lead_unknown_contact_is_404_and_silent(pool, emitted):
    with pytest.raises(HTTPException) as e:
        await graha.convert_lead(CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG)
    assert e.value.status_code == 404
    assert emitted == [], "a refused conversion still announced itself"


@pytest.mark.asyncio
async def test_convert_lead_already_customer_is_400_and_silent(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        return {"id": str(CONTACT_ID), "contact_type": "customer"}

    pool.fetchrow = _fetchrow

    with pytest.raises(HTTPException) as e:
        await graha.convert_lead(CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG)
    assert e.value.status_code == 400
    assert emitted == []
    assert not any("UPDATE staging.graha_contacts" in q for q, _ in pool.calls), \
        "the refusal wrote anyway"
