"""`line_items[].cost_price` — what the line cost us, remembered by the line.

── What was broken ──────────────────────────────────────────────────────────
Measured live 2026-08-25, read-only: **0 of 1,338 invoice lines and 0 of 389
order lines carried a cost**, so gross profit, item margin, product margin and
the commission scheme's cost column had nothing to compute from and reported
blank. `staging.ganit_products.cost_price` existed (migration 137) but is the
wrong place to read a historic cost from — a product's cost TODAY is not what
it cost when the invoice was raised, and joining to it re-prices last year's
gross profit every time procurement changes a number.

Migration 184:162-170 wrote the contract and deliberately added no column,
because both `line_items` columns are already jsonb:

    line_items[].cost_price   numeric, per ONE unit, exclusive of tax, in the
                              document's own currency, as at the moment the
                              line was written. Absent means NOT RECORDED and
                              must never be read as zero.

── What these tests hold ────────────────────────────────────────────────────
1.  A line naming a product with a recorded cost stores that cost, per unit,
    as a JSON **number** — the shape the readers guard on.
2.  A free-text line stores NO `cost_price` key. Not 0, not null: 104 of the
    106 live products carry no cost, and zero would report almost the whole
    catalogue as pure profit.
3.  A product whose cost nobody has recorded stores no key either.
4.  An UPDATE does not re-price a line that already has a cost — the whole
    point of copying rather than joining, defeated if the write path performs
    the very join the report refuses to.
5.  A line ADDED by an update IS resolved: for that line, now is the moment it
    was written.
6.  The lookup is org-scoped, and the browser is never the source.
7.  Source-level: no invoice or order write path can be added that skips it.

The fakes follow `test_ganit_client_link.py` and `test_niyam_wiring_vikray.py`:
a substring dispatcher scripts what each query answers, so a test cannot pass
because the handler happened to ask in the expected order.
"""
import ast
import inspect
import json

import pytest

import routers.ganit as ganit
import routers.vikray as vikray


# ── fakes ────────────────────────────────────────────────────

class _Conn:
    """One lent connection; proxies back into the pool's ledger."""

    def __init__(self, pool):
        self._pool = pool

    async def fetch(self, q, *a):
        return await self._pool.fetch(q, *a)

    async def fetchrow(self, q, *a):
        return await self._pool.fetchrow(q, *a)

    async def fetchval(self, q, *a):
        return await self._pool.fetchval(q, *a)

    async def execute(self, q, *a):
        return await self._pool.execute(q, *a)

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *exc):
                return False
        return _T()


class _Pool:
    def __init__(self):
        #: every (SQL, args) that reached the database.
        self.calls = []
        self.fetch_responses = []
        self.fetchrow_responses = []
        self.fetchval_responses = []

    def _dispatch(self, table, q, default):
        for frag, val in table:
            if frag in q:
                return val
        return default

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetch_responses, q, [])

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchrow_responses, q, None)

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchval_responses, q, None)

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return _Conn(pool)

            async def __aexit__(_s, *exc):
                return False
        return _A()


async def _noop_emitter(conn, **kw):
    return 1


#: Two real-shaped product ids. Canonical lowercase-dashed, because that is
#: what `uuid::text` returns and what the products API hands the browser.
COSTED = "11111111-1111-4111-8111-111111111111"
UNCOSTED = "22222222-2222-4222-8222-222222222222"
OTHER_ORG = "33333333-3333-4333-8333-333333333333"

#: The one lookup this feature performs, by the fragment that identifies it.
PRODUCT_LOOKUP = "FROM public.ganit_products "

_ORDER_ROW = {"id": "o1", "order_number": "SO-2026-0001", "total": 118.0,
              "client_id": None, "created_by": "u1", "status": "draft"}
_INV_ROW = {"id": "i1", "invoice_number": "INV-2026-0001",
            "invoice_type": "tax_invoice", "total": 1180.0, "doc_status": "final"}


def _stored_lines(args):
    """The lines as they reached the database — found by SHAPE, not position.

    `test_ganit_client_link.py:188-191` records why: an assertion pinned to an
    argument index breaks the day an unrelated column is appended. This finds
    the one argument that decodes to a list of line dicts, so adding a column
    cannot break it — and decoding through `json.loads` is also what proves the
    cost landed as a JSON number rather than a string, which is exactly what
    `jsonb_typeof(li->'cost_price') = 'number'` filters on in
    `services/report_defs/commission_reports.py`.

    Both bindings are accepted because the module genuinely uses both: most
    paths `json.dumps` into a `$n::jsonb` placeholder, while `update_invoice`
    binds the list itself and leans on the jsonb codec `db.py` registers.
    """
    for a in args:
        parsed = a
        if isinstance(a, str):
            try:
                parsed = json.loads(a)
            except (TypeError, ValueError):
                continue
        if (isinstance(parsed, list) and parsed and isinstance(parsed[0], dict)
                and "description" in parsed[0]):
            # Round-tripped either way, so "it is a JSON number" is asserted
            # against what jsonb will actually hold, not against a Python type
            # that never left the process.
            return json.loads(json.dumps(parsed))
    raise AssertionError("no line_items JSON in the argument tuple")


def _query(p, fragment):
    """The first (SQL, args) on the ledger containing `fragment`, or None."""
    for q, a in p.calls:
        if fragment in q:
            return q, a
    return None


# ── rigs ─────────────────────────────────────────────────────

@pytest.fixture
def order_rig(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    async def _next_doc_number(pool, org_id, table, column, prefix):
        return f"{prefix}-2026-0001"

    monkeypatch.setattr(vikray, "get_pool", _get_pool)
    monkeypatch.setattr(vikray, "next_doc_number", _next_doc_number)
    monkeypatch.setattr(vikray, "order_created", _noop_emitter)
    p.fetchrow_responses = [("INSERT INTO public.vikray_orders", _ORDER_ROW)]
    return p


@pytest.fixture
def invoice_rig(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    async def _next_doc_number(pool, org_id, table, column, prefix):
        return f"{prefix}-2026-0001"

    async def _gate_ok(pool, org_id, invoice, contact_id):
        return None

    monkeypatch.setattr(ganit, "get_pool", _get_pool)
    monkeypatch.setattr(ganit, "next_doc_number", _next_doc_number)
    monkeypatch.setattr(ganit, "_refuse_final_if_incomplete", _gate_ok)
    monkeypatch.setattr(ganit, "invoice_created", _noop_emitter)
    p.fetchrow_responses = [("INSERT INTO public.ganit_invoices", _INV_ROW)]
    return p


def _catalogue(p, *rows):
    """Script the product lookup. A row with cost_price None is a product
    nobody has recorded a cost for — 104 of the 106 live ones."""
    p.fetch_responses = [(PRODUCT_LOOKUP, list(rows))]


def _order_body(**kw):
    kw.setdefault("line_items", [])
    return vikray.OrderCreate(**kw)


# ── the cost lands on the line ───────────────────────────────

@pytest.mark.asyncio
async def test_order_line_from_a_costed_product_stores_the_cost_per_unit(order_rig):
    """Per UNIT, matching `rate`, which is the neighbouring key — and matching
    what the readers expect: `commission_reports.py:230-231` multiplies by
    quantity itself. Storing a line total here would double-count silently."""
    p = order_rig
    _catalogue(p, {"id": COSTED, "cost_price": 40})

    await vikray.create_order(
        _order_body(line_items=[vikray.OrderLineItem(
            product_id=COSTED, description="Widget", quantity=7, rate=100)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "INSERT INTO public.vikray_orders")[1])[0]
    assert line["cost_price"] == 40, "the cost is per unit, not the line total"
    assert isinstance(line["cost_price"], (int, float)) \
        and not isinstance(line["cost_price"], bool), \
        "a string would fail the readers' jsonb_typeof(...) = 'number' guard"


@pytest.mark.asyncio
async def test_invoice_line_from_a_costed_product_stores_the_cost_per_unit(invoice_rig):
    """The same rule through the other module's funnel. Two copies of a costing
    rule is how an order and the invoice it becomes end up disagreeing."""
    p = invoice_rig
    _catalogue(p, {"id": COSTED, "cost_price": 250})

    await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", line_items=[
            ganit.LineItem(product_id=COSTED, description="Widget",
                           hsn_code="998231", quantity=3, rate=1000)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "INSERT INTO public.ganit_invoices")[1])[0]
    assert line["cost_price"] == 250
    assert line["product_id"] == COSTED, \
        "_compute_invoice's explicit key list must keep carrying product_id"


# ── absent, never zero ───────────────────────────────────────

@pytest.mark.asyncio
async def test_a_free_text_line_stores_no_cost_key_at_all(order_rig):
    """Not 0, not null. A line with no product is a line whose cost is NOT
    RECORDED (migration 184:167-169), and the reader's `li ? 'cost_price'`
    guard is written for exactly this: an absent key reads as unknown, a zero
    reads as a 100% margin on something nobody costed."""
    p = order_rig

    await vikray.create_order(
        _order_body(line_items=[vikray.OrderLineItem(
            description="Consulting, as agreed", quantity=1, rate=5000)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "INSERT INTO public.vikray_orders")[1])[0]
    assert "cost_price" not in line, "an unresolvable cost must be ABSENT, never 0"
    assert _query(p, PRODUCT_LOOKUP) is None, \
        "no product named, so no lookup should have been issued at all"


@pytest.mark.asyncio
async def test_a_product_with_no_recorded_cost_stores_no_key(order_rig):
    """104 of 106 live products have `cost_price IS NULL`. NULL means nobody
    has recorded one — never that the item is free."""
    p = order_rig
    _catalogue(p, {"id": UNCOSTED, "cost_price": None})

    await vikray.create_order(
        _order_body(line_items=[vikray.OrderLineItem(
            product_id=UNCOSTED, description="Widget", quantity=2, rate=100)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "INSERT INTO public.vikray_orders")[1])[0]
    assert "cost_price" not in line
    assert line["product_id"] == UNCOSTED, "the product itself is still recorded"


@pytest.mark.asyncio
async def test_a_free_text_line_beside_a_costed_one_stays_uncosted(order_rig):
    """The mixed document is the normal one, and the failure mode is a loop
    that stamps the last resolved cost onto every subsequent line."""
    p = order_rig
    _catalogue(p, {"id": COSTED, "cost_price": 40})

    await vikray.create_order(
        _order_body(line_items=[
            vikray.OrderLineItem(product_id=COSTED, description="Widget", rate=100),
            vikray.OrderLineItem(description="Delivery", rate=250),
        ]),
        user={"user_id": "u1"}, org_id="org1")

    lines = _stored_lines(_query(p, "INSERT INTO public.vikray_orders")[1])
    assert lines[0]["cost_price"] == 40
    assert "cost_price" not in lines[1]


# ── copy, never join: the org scope and the browser ──────────

@pytest.mark.asyncio
async def test_the_lookup_is_scoped_to_this_org(order_rig):
    """`ganit_products.id` is a bare primary key, not composite with org_id, so
    the application check is the only thing between a line item and another
    tenant's cost sheet — the one figure a competitor would most like to read."""
    p = order_rig
    _catalogue(p, {"id": COSTED, "cost_price": 40})

    await vikray.create_order(
        _order_body(line_items=[vikray.OrderLineItem(
            product_id=COSTED, description="Widget", rate=100)]),
        user={"user_id": "u1"}, org_id="org1")

    q, args = _query(p, PRODUCT_LOOKUP)
    assert "org_id=$1::uuid" in q, "the lookup is not org-scoped"
    assert "id = ANY($2::uuid[])" in q, \
        "bind parameters only, and cast — an untyped array is a PgBouncer 500"
    assert args[0] == "org1"


@pytest.mark.asyncio
async def test_a_product_that_is_not_this_orgs_resolves_to_no_cost(order_rig):
    """The org-scoped query returns nothing, and nothing is what the line gets."""
    p = order_rig
    _catalogue(p)  # the WHERE org_id matched no row

    await vikray.create_order(
        _order_body(line_items=[vikray.OrderLineItem(
            product_id=OTHER_ORG, description="Widget", rate=100)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "INSERT INTO public.vikray_orders")[1])[0]
    assert "cost_price" not in line


@pytest.mark.asyncio
async def test_a_cost_sent_by_the_client_is_discarded(order_rig):
    """What a firm pays its suppliers is not the browser's to set. The line
    models are closed and drop it, but `RecurringCreate.template_items` is
    `list[dict]` and does not — so the helper discards unconditionally rather
    than relying on a model that one payload shape does not use."""
    p = order_rig
    items = [{"product_id": "", "description": "Widget", "quantity": 1,
              "rate": 100, "cost_price": 1}]

    await vikray.apply_line_costs(p, "org1", items)

    assert "cost_price" not in items[0], "a client-supplied cost survived"


@pytest.mark.asyncio
async def test_a_client_cost_is_overwritten_not_trusted(order_rig):
    """Planting a cost must not even bias the answer where one IS resolvable."""
    p = order_rig
    _catalogue(p, {"id": COSTED, "cost_price": 40})
    items = [{"product_id": COSTED, "description": "Widget", "cost_price": 999}]

    await vikray.apply_line_costs(p, "org1", items)

    assert items[0]["cost_price"] == 40


@pytest.mark.asyncio
async def test_a_malformed_product_id_does_not_fail_the_write(order_rig):
    """`id = ANY($2::uuid[])` fails to ENCODE on the first non-uuid string, so
    an unfiltered id would 500 the whole save. One stale identifier costs that
    line its cost, never the document."""
    p = order_rig
    items = [{"product_id": "not-a-uuid", "description": "Widget"}]

    await vikray.apply_line_costs(p, "org1", items)

    assert "cost_price" not in items[0]
    assert _query(p, PRODUCT_LOOKUP) is None, "a malformed id was bound anyway"


@pytest.mark.asyncio
async def test_one_lookup_covers_every_line(order_rig):
    """One org-scoped batch per write, whatever the line count — not N+1
    against the catalogue on a fifty-line invoice."""
    p = order_rig
    _catalogue(p, {"id": COSTED, "cost_price": 40},
               {"id": UNCOSTED, "cost_price": None})

    await vikray.create_order(
        _order_body(line_items=[
            vikray.OrderLineItem(product_id=COSTED, description="A", rate=1),
            vikray.OrderLineItem(product_id=UNCOSTED, description="B", rate=1),
            vikray.OrderLineItem(product_id=COSTED, description="C", rate=1),
        ]),
        user={"user_id": "u1"}, org_id="org1")

    assert sum(1 for q, _ in p.calls if PRODUCT_LOOKUP in q) == 1


# ── the update must not re-price ─────────────────────────────

@pytest.mark.asyncio
async def test_updating_an_order_does_not_reprice_an_existing_costed_line(order_rig):
    """THE test this feature exists for.

    `update_order` REPLACES every line. Re-resolving on the way through would
    perform the exact join `cost_price` exists to avoid — just in the write
    path instead of the report — and correcting a typo in a description would
    silently restate a March order's gross profit at June's catalogue.
    """
    p = order_rig
    p.fetchrow_responses = [
        ("SELECT * FROM public.vikray_orders",
         {"status": "draft", "discount": 0, "is_igst": False,
          "line_items": [{"product_id": COSTED, "description": "Widget",
                          "quantity": 1, "rate": 100, "cost_price": 40}]}),
        ("UPDATE public.vikray_orders", _ORDER_ROW),
    ]
    # Procurement has since renegotiated. The catalogue says 90 today.
    _catalogue(p, {"id": COSTED, "cost_price": 90})

    await vikray.update_order(
        "o1",
        vikray.OrderUpdate(line_items=[vikray.OrderLineItem(
            product_id=COSTED, description="Widget (blue)", quantity=1, rate=100)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "UPDATE public.vikray_orders")[1])[0]
    assert line["cost_price"] == 40, \
        "the edit re-priced the order at TODAY's cost — copy-never-join defeated"
    assert line["description"] == "Widget (blue)", "the edit itself must still apply"


@pytest.mark.asyncio
async def test_a_line_added_by_an_update_is_costed_now(order_rig):
    """Carried is not the same as frozen. A product NEW to this document has
    just been written, and now is the moment it was written."""
    p = order_rig
    p.fetchrow_responses = [
        ("SELECT * FROM public.vikray_orders",
         {"status": "draft", "discount": 0, "is_igst": False,
          "line_items": [{"product_id": COSTED, "description": "Widget",
                          "quantity": 1, "rate": 100, "cost_price": 40}]}),
        ("UPDATE public.vikray_orders", _ORDER_ROW),
    ]
    _catalogue(p, {"id": UNCOSTED, "cost_price": 12})

    await vikray.update_order(
        "o1",
        vikray.OrderUpdate(line_items=[
            vikray.OrderLineItem(product_id=COSTED, description="Widget", rate=100),
            vikray.OrderLineItem(product_id=UNCOSTED, description="Gasket", rate=30),
        ]),
        user={"user_id": "u1"}, org_id="org1")

    lines = _stored_lines(_query(p, "UPDATE public.vikray_orders")[1])
    assert lines[0]["cost_price"] == 40, "the line already on the order kept its cost"
    assert lines[1]["cost_price"] == 12, "the line the edit added was resolved now"
    # The carried product is never asked about — that IS the carry.
    assert _query(p, PRODUCT_LOOKUP)[1][1] == [UNCOSTED]


@pytest.mark.asyncio
async def test_updating_an_invoice_does_not_reprice_an_existing_costed_line(invoice_rig):
    """The same rule on the invoice side, which is where gross profit is read."""
    p = invoice_rig
    p.fetchrow_responses = [
        ("SELECT invoice_number, doc_status",
         {"invoice_number": "INV-2026-0001", "doc_status": "draft",
          "total": 1180.0, "balance_due": 1180.0, "is_active": True,
          "sent_at": None, "viewed_at": None,
          "line_items": [{"product_id": COSTED, "description": "Widget",
                          "quantity": 1, "rate": 1000, "cost_price": 250}]}),
        ("UPDATE public.ganit_invoices", _INV_ROW),
    ]
    _catalogue(p, {"id": COSTED, "cost_price": 700})

    await ganit.update_invoice(
        "i1",
        ganit.InvoiceCreate(invoice_type="tax_invoice", line_items=[
            ganit.LineItem(product_id=COSTED, description="Widget",
                           hsn_code="998231", quantity=1, rate=1000)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "UPDATE public.ganit_invoices")[1])[0]
    assert line["cost_price"] == 250, "the edit re-priced the invoice at today's cost"


@pytest.mark.asyncio
async def test_a_prior_null_cost_is_not_carried_as_a_number(order_rig):
    """A `null` left on an old line means NOT RECORDED, exactly as an absent
    key does. Carrying it as though it were a figure would put a zero-ish
    unknown into gross profit; re-resolving it is correct."""
    p = order_rig
    p.fetchrow_responses = [
        ("SELECT * FROM public.vikray_orders",
         {"status": "draft", "discount": 0, "is_igst": False,
          "line_items": [{"product_id": COSTED, "description": "Widget",
                          "rate": 100, "cost_price": None}]}),
        ("UPDATE public.vikray_orders", _ORDER_ROW),
    ]
    _catalogue(p, {"id": COSTED, "cost_price": 90})

    await vikray.update_order(
        "o1",
        vikray.OrderUpdate(line_items=[vikray.OrderLineItem(
            product_id=COSTED, description="Widget", rate=100)]),
        user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "UPDATE public.vikray_orders")[1])[0]
    assert line["cost_price"] == 90


# ── the order carries its cost to the invoice ────────────────

@pytest.mark.asyncio
async def test_order_to_invoice_carries_the_cost_verbatim(monkeypatch):
    """The invoice must report the same gross profit as the order it came from.

    Re-resolving at invoicing time would price a March order at June's
    catalogue and make the two registers disagree about one sale — so this
    path costs nothing and copies everything.
    """
    p = _Pool()

    async def _get_pool():
        return p

    async def _next_doc_number(pool, org_id, table, column, prefix):
        return f"{prefix}-2026-0001"

    async def _gate_ok(pool, org_id, invoice, contact_id):
        return None

    monkeypatch.setattr(vikray, "get_pool", _get_pool)
    monkeypatch.setattr(vikray, "next_doc_number", _next_doc_number)
    monkeypatch.setattr(ganit, "_refuse_final_if_incomplete", _gate_ok)

    stored = [{"product_id": COSTED, "description": "Widget", "quantity": 2,
               "rate": 100, "gst_rate": 18, "cost_price": 40}]
    p.fetchrow_responses = [
        ("SELECT * FROM public.vikray_orders",
         {"id": "o1", "status": "confirmed", "invoice_id": None,
          "line_items": stored, "is_igst": False, "contact_id": None,
          "client_id": None, "subtotal": 200, "cgst": 18, "sgst": 18,
          "igst": 0, "discount": 0, "total": 236,
          "order_number": "SO-2026-0001"}),
        ("INSERT INTO public.ganit_invoices", {"id": "i1"}),
    ]
    # Deliberately different from the order's 40: if this path resolved, the
    # assertion below would read 90 and the two documents would disagree.
    _catalogue(p, {"id": COSTED, "cost_price": 90})

    await vikray.generate_invoice_from_order(
        "o1", user={"user_id": "u1"}, org_id="org1")

    line = _stored_lines(_query(p, "INSERT INTO public.ganit_invoices")[1])[0]
    assert line["cost_price"] == 40, "the invoice disagrees with its own order"
    assert _query(p, PRODUCT_LOOKUP) is None, \
        "the catalogue was re-read on a path that must only copy"


# ── source-level backstops ───────────────────────────────────

def _async_defs(module):
    return [n for n in ast.walk(ast.parse(inspect.getsource(module)))
            if isinstance(n, ast.AsyncFunctionDef)]


def _calls_named(node):
    out = set()
    for c in ast.walk(node):
        if isinstance(c, ast.Call):
            if isinstance(c.func, ast.Name):
                out.add(c.func.id)
            elif isinstance(c.func, ast.Attribute):
                out.add(c.func.attr)
    return out


def _writes(node, fragment):
    return any(fragment in c.value for c in ast.walk(node)
               if isinstance(c, ast.Constant) and isinstance(c.value, str))


def test_no_invoice_write_path_computes_lines_without_costing():
    """Every invoice INSERT that BUILDS its lines goes through the one funnel.

    `_compute_invoice` is the pure rounding contract — shared with
    `services/purchase_orders.py`, whose lines are a PURCHASE and carry no sale
    cost at all. `_compute_invoice_costed` is the funnel that also stamps the
    cost. A function that computes lines and then writes an invoice must use
    the second, or it writes a document nothing can compute a margin from and
    nothing says so.
    """
    offenders = [n.name for n in _async_defs(ganit)
                 if _writes(n, "INSERT INTO public.ganit_invoices")
                 and "_compute_invoice" in _calls_named(n)]
    assert not offenders, (
        "these invoice write paths call the UNCOSTED _compute_invoice: "
        f"{offenders} — use _compute_invoice_costed")


def test_every_order_insert_costs_its_lines():
    """The order side has no funnel to hide behind: the two create paths and
    the update all call `apply_line_costs` by name. A fourth added next month
    fails here rather than shipping uncosted lines nobody notices for a
    quarter."""
    offenders = [n.name for n in _async_defs(vikray)
                 if _writes(n, "INSERT INTO public.vikray_orders")
                 and "apply_line_costs" not in _calls_named(n)]
    assert not offenders, \
        f"these order write paths never cost their lines: {offenders}"


def test_the_cost_is_never_exposed_on_the_public_pay_page():
    """A cross-module guard, held here because this is the change that made the
    key real.

    Until now `cost_price` was a documented idea and `test_pay_public.py`
    planted one in a fixture to prove the allow-list held. From this commit the
    key is written by the product on every costed line, so the day
    `routers/pay.py` stops allow-listing and starts passing lines through, it
    hands every customer holding an invoice link the firm's supplier pricing.
    Asserted on the function's OUTPUT rather than on its source text, so a
    comment mentioning the key cannot fail it and a real leak cannot pass it.
    """
    import routers.pay as pay
    out = pay._line({"description": "Widget", "hsn_code": "998231",
                     "quantity": 2, "rate": 100, "gst_rate": 18,
                     "amount": 200, "cost_price": 40, "product_id": COSTED})
    assert set(out) == {"description", "hsn_code", "quantity", "rate",
                        "gst_rate", "amount"}
    assert "cost_price" not in out and "product_id" not in out
