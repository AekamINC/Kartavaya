"""The vikray (sales) events are wired to the writes that own them.

order.created        — both order INSERTs (`create_order`, `create_order_from_deal`)
order.status_changed — `update_order_status`'s status write, and `cancel_order`'s
order.fulfilled      — additionally, when the new status is 'delivered'
stock.adjusted       — the MANUAL stock adjustment (`adjust_stock`), never
                       order-driven `_apply_stock_moves`
deal.stage_changed   — the deal-won branch: closing an order against a linked
                       deal marks the deal Won, and the stage write emits

The contract under test is emit.py's one rule: the emitter is awaited on the
BUSINESS WRITE'S OWN CONNECTION, inside its transaction — and never on a
refusal path. The fakes below share their idiom with
`tests/test_target_attainment.py`: `_Pool.acquire()` lends out a DISTINCT
`_Conn` (never the pool itself), the pool remembers every conn it lent, and
`_Conn.transaction()` tracks `in_tx` — so "the write's own connection, inside
its transaction" is assertable as membership in `pool.lent` plus the `in_tx`
flag the recorder captured at emit time. The previous shape (acquire() handed
the pool back, transaction() was a stateless no-op) made that same sentence
satisfiable by an emitter called on the raw pool with no transaction anywhere.

Emitters are monkeypatched in the ROUTER's namespace (`vikray.order_created`,
not `services.niyam.subjects.order_created`) — the router imports them by name
at module level precisely so these tests can prove the handler called them.
The one exception is `deal_stage_changed`, which the handler imports at call
time, so it is patched at its source module.
"""
import pytest
from fastapi import HTTPException

import routers.vikray as vikray
import services.niyam.subjects as subjects


# ── fakes ────────────────────────────────────────────────────

class _Conn:
    """One LENT connection — a distinct object, never the pool itself.

    Every query proxies back to the pool's ledger and answer machinery, so
    scripting and assertions stay on the pool; the conn's only private fact is
    whether it is currently inside a transaction. `transaction()` counts depth
    rather than toggling, because emit_event opens a savepoint via
    `conn.transaction()` on the same connection and a boolean would read False
    for the rest of the outer transaction after the savepoint closed.
    """

    def __init__(self, pool):
        self._pool = pool
        self.in_tx = False
        self._tx_depth = 0

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
                conn._tx_depth += 1
                conn.in_tx = True
                return _s

            async def __aexit__(_s, *exc):
                conn._tx_depth -= 1
                conn.in_tx = conn._tx_depth > 0
                return False
        return _T()


class _Pool:
    """The shared fake-pool idiom, plus a tiny substring dispatcher so each
    test can script what a query returns.

    The pool itself deliberately has NO `transaction()` and is never handed
    out as a connection: a handler that emitted on the raw pool, or outside
    the write's transaction, must fail these tests rather than satisfy them.
    """

    def __init__(self):
        self.calls = []
        #: every conn `acquire()` ever lent, in order.
        self.lent = []
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
    # `async with conn.transaction()`; the fake lends out a DISTINCT conn that
    # proxies every call back into the same ledger the assertions read, and
    # records the loan in `self.lent`.
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


class _Recorder:
    """Stands in for one subjects.py emitter and remembers how it was called —
    including whether the connection was inside a transaction AT CALL TIME,
    because by the time the test asserts, every transaction has exited."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, getattr(conn, "in_tx", False), kw))
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
    # The deal-won branch does `from services.niyam.subjects import
    # deal_stage_changed` at call time, so this one is patched at its source
    # module — patching a `vikray.deal_stage_changed` name would prove nothing.
    rec = _Recorder()
    monkeypatch.setattr(subjects, "deal_stage_changed", rec)
    emitters["deal_stage_changed"] = rec
    return p, emitters


def _order_body(**kw):
    return vikray.OrderCreate(line_items=[], **kw)


def _assert_silent(emitters, *names):
    for name in names:
        assert emitters[name].calls == [], f"{name} fired on a path that must emit nothing"


def _assert_in_write_tx(p, conn, in_tx):
    """The emit.py contract, now actually falsifiable: the emitter rode a
    connection this pool LENT (not the pool itself), and that connection was
    inside a transaction at the moment of the call."""
    assert conn is not p, "the emitter was handed the raw pool, not the write's connection"
    assert conn in p.lent, "the emitter's connection was never lent by this pool"
    assert in_tx, "the emitter ran OUTSIDE the business write's transaction"


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
    conn, in_tx, kw = em["order_created"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
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
    _, _, kw = em["order_created"].calls[0]
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
    _assert_silent(em, *em)
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
    conn, in_tx, kw = em["order_created"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
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
    _assert_silent(em, *em)


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
    _assert_silent(em, *em)


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
    conn, in_tx, kw = em["order_status_changed"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
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
    conn, in_tx, kw = em["order_fulfilled"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
    assert conn is em["order_status_changed"].calls[0][0], \
        "status_changed and fulfilled must ride the SAME transaction's connection"
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
    _assert_silent(em, *em)
    assert not any("UPDATE staging.vikray_orders SET status=" in q
                   for q, _ in p.calls), "refused, yet the status was written"


@pytest.mark.asyncio
async def test_a_raced_status_update_is_a_409_and_emits_nothing(rig):
    """The transition validated against a pre-read taken BEFORE the
    transaction, but the guarded UPDATE (`AND status=$4`) matched zero rows —
    somebody else moved the order in between. The loser gets a 409, no event
    announces a change that did not happen, and nothing downstream (the
    confirm path's stock deduction) runs."""
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT status, deal_id, line_items",
         {"status": "draft", "deal_id": None,
          "line_items": '[{"product_id": "p1", "quantity": 2}]'}),
        # nothing scripted for the UPDATE → RETURNING answers None: the race
    ]
    with pytest.raises(HTTPException) as exc:
        await vikray.update_order_status(
            "o1", vikray.OrderStatusUpdate(status="confirmed"),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 409
    _assert_silent(em, *em)
    # the guarded UPDATE is what detected the race — it must carry the
    # pre-read status in its WHERE …
    guarded = [(q, a) for q, a in p.calls
               if "UPDATE staging.vikray_orders SET status=" in q]
    assert guarded and "AND status=" in guarded[0][0], \
        "the status write lost its optimistic-concurrency guard"
    assert "draft" in guarded[0][1], "the guard must bind the PRE-READ status"
    # … and the loser must not touch stock for a confirm that never happened
    assert not any("vikray_stock" in q for q, _ in p.calls), \
        "a raced confirm still moved stock"


# ── the deal-won branch of PATCH /orders/{id}/status ─────────

def _deal_close_rig(p, deal_before_stage):
    p.fetchrow_responses = [
        ("SELECT status, deal_id, line_items",
         {"status": "delivered", "deal_id": "d1", "line_items": "[]"}),
        ("UPDATE staging.vikray_orders SET status=",
         {"id": "o1", "order_number": "SO-2026-0001", "total": 118.0,
          "client_id": "c1", "status": "closed"}),
        ("SELECT * FROM staging.graha_deals",
         {"id": "d1", "stage": deal_before_stage, "value": 100.0,
          "assigned_to": "u2", "client_id": "c1"}),
        ("UPDATE staging.graha_deals",
         {"id": "d1", "stage": "Won", "value": 100.0,
          "assigned_to": "u2", "client_id": "c1"}),
    ]


@pytest.mark.asyncio
async def test_closing_an_order_that_wins_its_deal_emits_deal_stage_changed(rig):
    """Closing an order with a linked deal marks the deal Won; when the pre-
    and post-write rows differ in stage, `deal_stage_changed` fires with the
    honest before/after — on the DEAL write's own in-transaction connection
    (a second acquire, after the order's own transaction has closed)."""
    p, em = rig
    _deal_close_rig(p, deal_before_stage="Negotiation")

    await vikray.update_order_status(
        "o1", vikray.OrderStatusUpdate(status="closed"),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["deal_stage_changed"].calls) == 1
    conn, in_tx, kw = em["deal_stage_changed"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
    assert kw["deal_id"] == "d1"
    assert kw["old_stage"] == "Negotiation"
    assert kw["new_stage"] == "Won"
    assert kw["row"]["stage"] == "Won", \
        "row must be the written deal, straight off the UPDATE's RETURNING"
    # closing is a status change on the order too — but never fulfilment
    assert len(em["order_status_changed"].calls) == 1
    _assert_silent(em, "order_fulfilled")


@pytest.mark.asyncio
async def test_reclosing_against_an_already_won_deal_stays_silent(rig):
    """The stage write still runs (won_at=COALESCE keeps the original close
    date) but Won → Won is not a stage CHANGE — announcing one would fire
    every "deal won" rule a second time for the same win."""
    p, em = rig
    _deal_close_rig(p, deal_before_stage="Won")

    await vikray.update_order_status(
        "o1", vikray.OrderStatusUpdate(status="closed"),
        user={"user_id": "u1"}, org_id="org1")

    assert em["deal_stage_changed"].calls == []
    assert any("UPDATE staging.graha_deals" in q for q, _ in p.calls), \
        "the won_at stamp must still be written on a re-close"
    assert len(em["order_status_changed"].calls) == 1


# ── order.status_changed — DELETE /orders/{id} (cancel) ──────

@pytest.mark.asyncio
async def test_cancelling_emits_the_status_change_from_inside_the_write(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT status, line_items", {"status": "draft", "line_items": "[]"}),
        ("UPDATE staging.vikray_orders SET status='cancelled'",
         {"id": "o1", "order_number": "SO-2026-0001", "total": 118.0,
          "client_id": "c1", "status": "cancelled"}),
    ]

    await vikray.cancel_order("o1", user={"user_id": "u1"}, org_id="org1")

    assert len(em["order_status_changed"].calls) == 1
    conn, in_tx, kw = em["order_status_changed"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
    assert kw["old_status"] == "draft"
    assert kw["new_status"] == "cancelled"
    assert kw["row"]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_a_raced_cancel_is_a_409_with_no_event_and_no_restock(rig):
    """Same guard, same stakes, one more: the pre-read said 'confirmed' but
    the guarded UPDATE matched nothing. A 409, no event — and NO stock write,
    because the restock decision keys off a pre-read the write just proved
    stale."""
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT status, line_items",
         {"status": "confirmed",
          "line_items": '[{"product_id": "p1", "quantity": 2}]'}),
        # nothing scripted for the UPDATE → RETURNING answers None: the race
    ]
    with pytest.raises(HTTPException) as exc:
        await vikray.cancel_order("o1", user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 409
    _assert_silent(em, *em)
    guarded = [(q, a) for q, a in p.calls
               if "UPDATE staging.vikray_orders SET status='cancelled'" in q]
    assert guarded and "AND status=" in guarded[0][0], \
        "the cancel write lost its optimistic-concurrency guard"
    assert "confirmed" in guarded[0][1], "the guard must bind the PRE-READ status"
    assert not any("vikray_stock" in q for q, _ in p.calls), \
        "a cancel that wrote nothing still restocked"


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
    conn, in_tx, kw = em["stock_adjusted"].calls[0]
    _assert_in_write_tx(p, conn, in_tx)
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
    _assert_silent(em, *em)


@pytest.mark.asyncio
async def test_unknown_product_emits_nothing(rig):
    p, em = rig  # ganit_products lookup returns the default None → 404
    with pytest.raises(HTTPException) as exc:
        await vikray.adjust_stock(
            "p-missing", vikray.StockAdjust(quantity_delta=5),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 404
    _assert_silent(em, *em)
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
