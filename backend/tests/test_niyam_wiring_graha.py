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

The fake pool: `acquire()` lends out a DISTINCT `_Conn` wrapper (never the
pool itself — the old idiom made "the emitter got the write's own connection"
satisfiable by calling the emitter on the bare pool with no transaction at
all). Every statement on a lent conn proxies back to the pool's one ledger and
answer machinery, `_Conn.transaction()` flips `in_tx` on enter/exit, and the
emitter stubs capture BOTH the conn and `in_tx` at call time. The proof is
three-legged: the conn is one `acquire()` lent (`conn in pool.lent`), it is
not the pool, and the write's transaction was open at the moment of emit.

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


class _Conn:
    """What acquire() lends out. Distinct from the pool by construction, so
    handing the pool to an emitter can no longer satisfy the connection
    assertion. Every statement proxies to the pool's CURRENT method at call
    time, so per-test `pool.fetchrow = ...` patches keep working and every
    statement — through the pool or through a lent conn — lands in the one
    ledger."""

    def __init__(self, pool):
        self._pool = pool
        self.in_tx = False

    async def fetch(self, q, *a):
        return await self._pool.fetch(q, *a)

    async def fetchrow(self, q, *a):
        return await self._pool.fetchrow(q, *a)

    async def fetchval(self, q, *a):
        return await self._pool.fetchval(q, *a)

    async def execute(self, q, *a):
        return await self._pool.execute(q, *a)

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(_s):
                conn.in_tx = True
                return _s

            async def __aexit__(_s, *exc):
                conn.in_tx = False
                return False
        return _T()


class _Pool:
    def __init__(self):
        self.calls = []
        self.lent = []  # every _Conn acquire() handed out, in order

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
        # An org-ownership probe (`SELECT 1 FROM staging.graha_… WHERE id = $1
        # AND org_id = $2 AND is_active`) must answer "yes, and it is yours".
        # Returning None unconditionally made every such probe read as "not in
        # this org", so the moment `create_deal` grew a pipeline guard this mock
        # started 400ing a deal it had always accepted — a MOCK gap presenting
        # as a product regression, which is `memory/mock_pool_hides_bad_sql` in
        # the opposite direction: a mock that answers a column name it has never
        # seen will confirm whatever you already believe, in either polarity.
        if isinstance(q, str) and q.lstrip().upper().startswith("SELECT 1 "):
            return 1
        return None

    # The pool itself has NO transaction() — a handler that opens its
    # transaction on the pool instead of a lent conn fails loudly here.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                conn = _Conn(pool)
                pool.lent.append(conn)
                return conn

            async def __aexit__(_s, *exc):
                return False
        return _A()


@pytest.fixture
def pool(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(graha, "get_pool", _get_pool)
    return p


@pytest.fixture
def emitted(monkeypatch, pool):
    """Recorded emitter calls: (name, conn, in_tx_at_emit, kwargs). `in_tx`
    is read off the conn AT CALL TIME — after the handler returns the
    transaction CM has already reset it, so only a capture inside the stub can
    prove the emit happened inside the write's transaction. Each stub also
    drops a marker into the pool's ledger so ordering against the SQL is
    assertable."""
    calls = []

    def _stub(name):
        async def _record(conn, **kw):
            calls.append((name, conn, getattr(conn, "in_tx", False), kw))
            pool.calls.append((f"<emit {name}>", ()))
            return 1
        return _record

    for name in ("deal_created", "client_created", "lead_converted"):
        monkeypatch.setattr(subjects, name, _stub(name))
    return calls


def _assert_writes_own_conn(pool, conn, in_tx):
    """The three-legged proof that replaced `conn is pool`."""
    assert conn is not pool, "the emitter was handed the POOL, not a connection"
    assert conn in pool.lent, \
        "the emitter's conn was never lent by acquire()"
    assert in_tx, "the emitter ran outside the write's transaction"


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
    name, conn, in_tx, kw = emitted[0]
    assert name == "client_created"
    _assert_writes_own_conn(pool, conn, in_tx)
    assert kw["org_id"] == ORG
    assert kw["actor_id"] == ACTOR
    assert kw["client_id"] == CLIENT_ROW["id"]
    # The full row rode to the emitter — the fields the payload needs and the
    # response never carried.
    assert kw["row"]["gstin"] == CLIENT_ROW["gstin"]
    assert kw["row"]["created_by"] == ACTOR

    insert = pool.calls[_ledger_index(pool, "INSERT INTO public.graha_clients")][0]
    assert "RETURNING *" in insert, "the emitter is reading a three-column row"
    assert _ledger_index(pool, "INSERT INTO public.graha_clients") \
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
    name, conn, in_tx, kw = emitted[0]
    assert name == "deal_created"
    _assert_writes_own_conn(pool, conn, in_tx)
    assert kw["org_id"] == ORG
    assert kw["actor_id"] == ACTOR
    assert kw["deal_id"] == DEAL_ROW["id"]
    # deal_created reads value / client_id / assigned_to / created_by — the
    # columns the old three-column RETURNING never carried.
    assert kw["row"]["value"] == 50000
    assert kw["row"]["created_by"] == ACTOR

    insert = pool.calls[_ledger_index(pool, "INSERT INTO public.graha_deals")][0]
    assert "RETURNING *" in insert
    assert _ledger_index(pool, "INSERT INTO public.graha_deals") \
        < _ledger_index(pool, "<emit deal_created>")

    assert resp == {"status": "created", "id": DEAL_ROW["id"],
                    "title": "Big Deal", "stage": "New"}


@pytest.mark.asyncio
async def test_create_deal_failed_insert_emits_nothing(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "INSERT INTO public.graha_deals" in q:
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
    # `contact` — migration 254 removed `customer` as a kind of person. The
    # customer is the COMPANY, and `client_id` below is it.
    "contact_type": "contact",
    "company": "Acme",
    "client_id": "a0000000-0000-0000-0000-000000000001",
}


@pytest.mark.asyncio
async def test_convert_lead_emits_the_row_as_converted(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "UPDATE public.graha_contacts" in q:
            return dict(CONVERTED_ROW)
        # `client_id` is read by the conversion now: a lead that already
        # belongs to a company converts without asking for one.
        return {"id": str(CONTACT_ID), "contact_type": "lead",
                "client_id": CONVERTED_ROW["client_id"]}

    pool.fetchrow = _fetchrow

    resp = await graha.convert_lead(
        CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG,
    )

    assert len(emitted) == 1
    name, conn, in_tx, kw = emitted[0]
    assert name == "lead_converted"
    _assert_writes_own_conn(pool, conn, in_tx)
    assert kw["org_id"] == ORG
    assert kw["actor_id"] == ACTOR
    assert kw["contact_id"] == str(CONTACT_ID)
    # The row AS CONVERTED: contact_type is what the contact became and
    # client_id is the company it now belongs to — never the pre-check row.
    assert kw["row"]["contact_type"] == "contact"
    assert kw["row"]["client_id"] == CONVERTED_ROW["client_id"]

    # The pre-check rides inside the transaction under FOR UPDATE, so two
    # simultaneous converts cannot both pass it and emit twice.
    check = pool.calls[_ledger_index(pool, "SELECT id, contact_type")][0]
    assert "FOR UPDATE" in check

    update = pool.calls[_ledger_index(pool, "UPDATE public.graha_contacts")][0]
    assert "RETURNING *" in update
    assert _ledger_index(pool, "UPDATE public.graha_contacts") \
        < _ledger_index(pool, "<emit lead_converted>")

    assert resp == {"status": "converted", "contact": CONVERTED_ROW}


@pytest.mark.asyncio
async def test_convert_lead_unknown_contact_is_404_and_silent(pool, emitted):
    with pytest.raises(HTTPException) as e:
        await graha.convert_lead(CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG)
    assert e.value.status_code == 404
    assert emitted == [], "a refused conversion still announced itself"


@pytest.mark.asyncio
async def test_convert_lead_already_converted_is_400_and_silent(pool, emitted):
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        return {"id": str(CONTACT_ID), "contact_type": "contact"}

    pool.fetchrow = _fetchrow

    with pytest.raises(HTTPException) as e:
        await graha.convert_lead(CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG)
    assert e.value.status_code == 400
    assert emitted == []
    assert not any("UPDATE public.graha_contacts" in q for q, _ in pool.calls), \
        "the refusal wrote anyway"


@pytest.mark.asyncio
async def test_convert_lead_with_no_company_is_refused_and_silent(pool, emitted):
    """THE FLAW THE OWNER NAMED, AS A TEST.

    "so only customer doesnt have client it got converted to customer and sales
    order got generated without an customer or client how invoice can be assign
    correctly. thats big flaw."

    `convert_lead` used to do exactly one thing — set `contact_type='customer'`
    — and never created or required a `graha_clients` row, while its own comment
    claimed "client_id is the company it now belongs to". A lead converted this
    way became a customer belonging to no company, and every document raised
    against them afterwards belonged to no company either: 21 invoices worth
    ₹2,54,172 and a ₹49,08,800 order reached exactly that state.

    A conversion that cannot name a company must refuse, and it must refuse
    SILENTLY — an automation rule firing `lead.converted` for a conversion that
    did not happen is worse than no rule.
    """
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        return {"id": str(CONTACT_ID), "contact_type": "lead", "client_id": None}

    pool.fetchrow = _fetchrow

    with pytest.raises(HTTPException) as e:
        await graha.convert_lead(CONTACT_ID, user={"user_id": ACTOR}, org_id=ORG)

    assert e.value.status_code == 400
    # The message names what to do, the standard `validate_tds_challan` is held
    # to — a refusal that does not say how to proceed is a dead end.
    assert "company" in str(e.value.detail).lower()
    assert emitted == [], "a refused conversion still announced itself"
    assert not any("UPDATE public.graha_contacts" in q for q, _ in pool.calls), \
        "the refusal wrote anyway"
