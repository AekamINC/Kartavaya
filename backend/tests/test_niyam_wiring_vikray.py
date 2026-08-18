"""The four vikray (sales) events are wired to the writes that own them.

order.created        — both order INSERTs (`create_order`, `create_order_from_deal`)
order.status_changed — `update_order_status`'s status write
order.fulfilled      — additionally, when the new status is 'delivered'
stock.adjusted       — the MANUAL stock adjustment (`adjust_stock`), never
                       order-driven `_apply_stock_moves`

The contract under test is emit.py's one rule: the emitter is awaited on the
BUSINESS WRITE'S OWN CONNECTION, inside its transaction — and never on a
refusal path. The fakes below are the committed idiom from
`tests/test_target_attainment.py`: `_Pool.acquire()` lends the pool itself out
as the connection, so "same connection" is assertable with `is`.

Emitters are monkeypatched in the ROUTER's namespace (`vikray.order_created`,
not `services.niyam.subjects.order_created`) — the router imports them by name
at module level precisely so these tests can prove the handler called them.
"""
import pytest
from fastapi import HTTPException

import routers.vikray as vikray


# ── fakes ────────────────────────────────────────────────────

class _Pool:
    """The fake-pool idiom from test_target_attainment.py, plus a tiny
    substring dispatcher so each test can script what a query returns."""

    def __init__(self):
        self.calls = []
        #: list of (SQL fragment, value) — first fragment found in the query
        #: wins; an unmatched query returns the method's empty default.
        self.fetchrow_responses = []
        self.fetchval_responses = []

    def _dispatch(self, table, q, default):
        for frag, val in table:
            if frag in q:
                return val
        return default

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchrow_responses, q, None)

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchval_responses, q, None)

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    # The wired writes run inside `async with pool.acquire()` /
    # `async with conn.transaction()`; the fake lends out a conn that proxies
    # every call back into the same ledger the assertions read.
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


class _Recorder:
    """Stands in for one subjects.py emitter and remembers how it was called."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, kw))
        return 1


_EMITTERS = ("order_created", "order_status_changed", "order_fulfilled",
             "stock_adjusted")


@pytest.fixture
def rig(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(vikray, "get_pool", _get_pool)

    async def _next_doc_number(pool, org_id, table, column, prefix):
        return "SO-2026-0001"

    monkeypatch.setattr(vikray, "next_doc_number", _next_doc_number)

    emitters = {}
    for name in _EMITTERS:
        rec = _Recorder()
        monkeypatch.setattr(vikray, name, rec)
        emitters[name] = rec
    return p, emitters


def _order_body(**kw):
    return vikray.OrderCreate(line_items=[], **kw)


def _assert_silent(emitters, *names):
    for name in names:
        assert emitters[name].calls == [], f"{name} fired on a path that must emit nothing"


_ORDER_ROW = {
    "id": "o1", "order_number": "SO-2026-0001", "total": 118.0,
    "client_id": "c1", "created_by": "u1", "status": "draft",
}


# ── order.created — POST /orders ─────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("prior,expected_first", [(0, True), (3, False)],
                         ids=["no-prior-orders", "prior-orders-exist"])
async def test_create_order_emits_order_created(rig, prior, expected_first):
    p, em = rig
    p.fetchval_responses = [("graha_clients", 1), ("COUNT(*)", prior)]
    p.fetchrow_responses = [("INSERT INTO staging.vikray_orders", _ORDER_ROW)]

    await vikray.create_order(_order_body(client_id="c1"),
                              user={"user_id": "u1"}, org_id="org1")

    assert len(em["order_created"].calls) == 1
    conn, kw = em["order_created"].calls[0]
    assert conn is p, "the emitter must ride the business write's own connection"
    assert kw == {
        "org_id": "org1", "actor_id": "u1", "order_id": "o1",
        "row": _ORDER_ROW, "is_first_order": expected_first,
    }


@pytest.mark.asyncio
async def test_create_order_counts_prior_orders_before_the_insert(rig):
    """`is_first_order` is a COUNT taken in the same transaction, BEFORE the
    insert — so the new row cannot count itself and flip the answer."""
    p, em = rig
    p.fetchval_responses = [("graha_clients", 1), ("COUNT(*)", 0)]
    p.fetchrow_responses = [("INSERT INTO staging.vikray_orders", _ORDER_ROW)]

    await vikray.create_order(_order_body(client_id="c1"),
                              user={"user_id": "u1"}, org_id="org1")

    count_idx = next(i for i, (q, _) in enumerate(p.calls)
                     if "COUNT(*)" in q and "vikray_orders" in q)
    insert_idx = next(i for i, (q, _) in enumerate(p.calls)
                      if q.startswith("INSERT INTO staging.vikray_orders"))
    assert count_idx < insert_idx, "the first-order count must precede the insert"


@pytest.mark.asyncio
async def test_create_order_with_no_client_passes_first_order_false(rig):
    """No resolvable company → `is_first_order=False`, never a guess — the
    emitter's own contract — and no COUNT query is even attempted."""
    p, em = rig
    # contact resolves to no client (fetchval default None), insert succeeds
    p.fetchrow_responses = [("INSERT INTO staging.vikray_orders",
                             {**_ORDER_ROW, "client_id": None})]

    await vikray.create_order(_order_body(contact_id="ct1"),
                              user={"user_id": "u1"}, org_id="org1")

    assert len(em["order_created"].calls) == 1
    _, kw = em["order_created"].calls[0]
    assert kw["is_first_order"] is False
    assert not any("COUNT(*)" in q for q, _ in p.calls), \
        "no client — there is nothing honest to count"


@pytest.mark.asyncio
async def test_create_order_refusal_emits_nothing(rig):
    """A client_id from another org is refused (400) before any write — and
    before any event."""
    p, em = rig
    # graha_clients validation finds nothing → resolve_order_company raises
    with pytest.raises(HTTPException) as exc:
        await vikray.create_order(_order_body(client_id="not-ours"),
                                  user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)
    assert not any(q.startswith("INSERT INTO staging.vikray_orders")
                   for q, _ in p.calls), "refused, yet the order was written"


# ── order.created — POST /orders/from-deal/{deal_id} ─────────

_DEAL = {"id": "d1", "title": "Big deal", "value": 100, "stage": "Won",
         "contact_id": "ct1", "client_id": "c1"}


@pytest.mark.asyncio
async def test_create_order_from_deal_emits_order_created(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.graha_deals", _DEAL),
        ("INSERT INTO staging.vikray_orders", _ORDER_ROW),
    ]
    p.fetchval_responses = [("graha_clients", 1), ("COUNT(*)", 2)]

    out = await vikray.create_order_from_deal(
        "d1", user={"user_id": "u1"}, org_id="org1")

    # NOT out["status"] == "created": the handler returns
    # `{"status": "created", **dict(row)}` and the row's own `status` column
    # ('draft') wins the spread — a pre-existing quirk this file does not own.
    # The row's identity is the stable fact.
    assert out["id"] == "o1"
    assert len(em["order_created"].calls) == 1
    conn, kw = em["order_created"].calls[0]
    assert conn is p
    assert kw["order_id"] == "o1"
    assert kw["actor_id"] == "u1"
    assert kw["is_first_order"] is False, "two prior orders — not a first"


@pytest.mark.asyncio
async def test_create_order_from_an_open_deal_emits_nothing(rig):
    p, em = rig
    p.fetchrow_responses = [("FROM staging.graha_deals",
                             {**_DEAL, "stage": "Proposal"})]
    with pytest.raises(HTTPException) as exc:
        await vikray.create_order_from_deal(
            "d1", user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)


@pytest.mark.asyncio
async def test_a_second_conversion_returns_the_first_order_and_emits_nothing(rig):
    """The dedupe path: the order already exists, nothing is created, so
    announcing a creation would be a lie."""
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.graha_deals", _DEAL),
        ("SELECT id, order_number FROM staging.vikray_orders",
         {"id": "o0", "order_number": "SO-2026-0000"}),
    ]
    out = await vikray.create_order_from_deal(
        "d1", user={"user_id": "u1"}, org_id="org1")
    assert out["status"] == "exists"
    _assert_silent(em, *_EMITTERS)


# ── order.status_changed / order.fulfilled — PATCH /orders/{id}/status ──

def _status_rig(p, old, new):
    p.fetchrow_responses = [
        ("SELECT status, deal_id, line_items",
         {"status": old, "deal_id": None, "line_items": "[]"}),
        ("UPDATE staging.vikray_orders SET status=",
         {"id": "o1", "order_number": "SO-2026-0001", "total": 118.0,
          "client_id": "c1", "status": new}),
    ]


@pytest.mark.asyncio
async def test_status_change_emits_with_the_honest_before_and_after(rig):
    p, em = rig
    _status_rig(p, "draft", "confirmed")

    await vikray.update_order_status(
        "o1", vikray.OrderStatusUpdate(status="confirmed"),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["order_status_changed"].calls) == 1
    conn, kw = em["order_status_changed"].calls[0]
    assert conn is p
    assert kw["old_status"] == "draft"
    assert kw["new_status"] == "confirmed"
    assert kw["order_id"] == "o1"
    assert kw["row"]["status"] == "confirmed", \
        "row must be the written row, straight off the UPDATE's RETURNING"
    _assert_silent(em, "order_fulfilled")


@pytest.mark.asyncio
async def test_delivered_additionally_emits_order_fulfilled(rig):
    """'delivered' is the fulfilment terminal (see _VALID_TRANSITIONS: it is
    where the goods stop moving; 'closed' is book-keeping)."""
    p, em = rig
    _status_rig(p, "dispatched", "delivered")

    await vikray.update_order_status(
        "o1", vikray.OrderStatusUpdate(status="delivered"),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["order_status_changed"].calls) == 1
    assert len(em["order_fulfilled"].calls) == 1
    conn, kw = em["order_fulfilled"].calls[0]
    assert conn is p
    assert kw == {"org_id": "org1", "actor_id": "u1", "order_id": "o1",
                  "row": {"id": "o1", "order_number": "SO-2026-0001",
                          "total": 118.0, "client_id": "c1",
                          "status": "delivered"}}


@pytest.mark.asyncio
async def test_closing_the_ledger_line_is_not_fulfilment(rig):
    p, em = rig
    _status_rig(p, "delivered", "closed")
    await vikray.update_order_status(
        "o1", vikray.OrderStatusUpdate(status="closed"),
        user={"user_id": "u1"}, org_id="org1")
    assert len(em["order_status_changed"].calls) == 1
    _assert_silent(em, "order_fulfilled")


@pytest.mark.asyncio
async def test_a_refused_transition_emits_nothing(rig):
    p, em = rig
    _status_rig(p, "draft", "delivered")  # draft → delivered is not a move
    with pytest.raises(HTTPException) as exc:
        await vikray.update_order_status(
            "o1", vikray.OrderStatusUpdate(status="delivered"),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)
    assert not any("UPDATE staging.vikray_orders SET status=" in q
                   for q, _ in p.calls), "refused, yet the status was written"


# ── stock.adjusted — PATCH /stock/{product_id} ───────────────

@pytest.mark.asyncio
async def test_manual_adjustment_emits_both_sides_of_the_write(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.ganit_products", {"id": "p1", "name": "Widget"}),
        ("SELECT * FROM staging.vikray_stock",
         {"org_id": "org1", "product_id": "p1", "quantity_on_hand": 15.0}),
    ]
    p.fetchval_responses = [
        ("FOR UPDATE", 10.0),                    # the locked before-read
        ("RETURNING quantity_on_hand", 15.0),    # the UPDATE's own answer
    ]

    await vikray.adjust_stock(
        "p1", vikray.StockAdjust(quantity_delta=5),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["stock_adjusted"].calls) == 1
    conn, kw = em["stock_adjusted"].calls[0]
    assert conn is p
    assert kw == {"org_id": "org1", "actor_id": "u1", "product_id": "p1",
                  "product_name": "Widget",
                  "quantity_before": 10.0, "quantity_after": 15.0}
    # the ledger row rides in the same transaction as the event
    assert any("INSERT INTO staging.vikray_stock_moves" in q for q, _ in p.calls)


@pytest.mark.asyncio
async def test_a_threshold_only_change_is_not_an_adjustment(rig):
    """No quantity moved — nothing to announce."""
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.ganit_products", {"id": "p1", "name": "Widget"}),
        ("SELECT * FROM staging.vikray_stock",
         {"org_id": "org1", "product_id": "p1", "quantity_on_hand": 10.0}),
    ]
    await vikray.adjust_stock(
        "p1", vikray.StockAdjust(low_stock_threshold=7),
        user={"user_id": "u1"}, org_id="org1")
    _assert_silent(em, *_EMITTERS)


@pytest.mark.asyncio
async def test_unknown_product_emits_nothing(rig):
    p, em = rig  # ganit_products lookup returns the default None → 404
    with pytest.raises(HTTPException) as exc:
        await vikray.adjust_stock(
            "p-missing", vikray.StockAdjust(quantity_delta=5),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 404
    _assert_silent(em, *_EMITTERS)
    assert not any("vikray_stock" in q for q, _ in p.calls), \
        "refused, yet stock was touched"


# ── the order-driven mover stays silent ──────────────────────

def test_apply_stock_moves_does_not_emit_stock_adjusted():
    """The emitter's docstring says MANUAL only: order fulfilment's movements
    are the order's story. Source-level, because `_apply_stock_moves` runs on
    the happy path of confirm/cancel and a call added there would pass every
    monkeypatch test above while double-reporting every order."""
    import inspect
    src = inspect.getsource(vikray._apply_stock_moves)
    assert "stock_adjusted" not in src
