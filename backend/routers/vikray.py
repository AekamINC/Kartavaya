"""
vikray.py — Vikray · विक्रय (Sales) Router
Sales orders, targets, and dashboard. Reads Graha (CRM) + Ganit (Invoicing) directly.
"""
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.audit_actors import actor_joins, actor_select, display_name
from utils import next_doc_number

router = APIRouter(prefix="/api/v1/vikray", tags=["vikray-sales"])

_gate = require_module("vikray")

#: Writing a row into `staging.ganit_invoices` is an accounting action, and the
#: entitlement that governs it is `ganit` — not `vikray`.
#:
#: `POST /orders/{id}/invoice` creates a tax invoice, and it was gated on the
#: sales module alone. Ganit is a SENSITIVE module: withheld by default, audited
#: on platform bypass, and deliberately excluded from `STAFF_MODULES`. So a
#: vikray-only member could issue tax invoices they were never granted the books
#: for — and `platform_staff`, a role defined to exclude finance entirely, could
#: issue them in a customer's ledger.
#:
#: Stacking the ganit gate closes that. It DOES narrow access: a member holding
#: vikray but not ganit can no longer convert an order to an invoice. That is
#: the intent — they were reaching the books without the grant that governs
#: them, and the remedy is a ganit grant, not a hole in the gate.
_ganit_gate = require_module("ganit")

# F4 (b) — shared, not re-implemented. See the docstring in graha.py: two copies
# of a response contract is how one ends up reporting a total the other does not.
from routers.graha import _listed  # noqa: E402

# Niyam emitters for this module's four sales events. Module-level and by name,
# so a test can monkeypatch `vikray.order_created` and prove a handler called
# it — and so the call sites below read as what they are: part of the write,
# not an afterthought bolted onto the route. Each is awaited on the SAME
# connection as the business write, inside its transaction (`emit.py`'s one
# rule), so the event exists iff the change committed.
from services.niyam.subjects import (  # noqa: E402
    order_created,
    order_fulfilled,
    order_status_changed,
    stock_adjusted,
)


# ── Pydantic Models ──────────────────────────────────────────

class OrderLineItem(BaseModel):
    product_id: str = ""
    description: str
    hsn_code: str = ""
    quantity: float = 1
    unit: str = "NOS"
    rate: float = 0
    gst_rate: float = 18.0
    discount_pct: float = 0


class OrderCreate(BaseModel):
    contact_id: str = ""
    #: The COMPANY the order is for — `staging.graha_clients`, the one shared
    #: company record (migration 136). A customer is the firm that buys, not the
    #: person who signed: contacts leave and the customer stays. `contact_id`
    #: remains, and is now who to speak to rather than who is buying.
    client_id: str = ""
    deal_id: str = ""
    order_date: str = ""
    expected_delivery: str = ""
    is_igst: bool = False
    line_items: list[OrderLineItem]
    discount: float = 0
    shipping_address: dict = {}
    notes: str = ""
    #: The LOGIN credited with the sale — `users.user_id`. `vikray_orders`
    #: carries this column but no create path wrote it, so the leaderboard and
    #: commission read zero. Optional; blank -> NULL. The form offers org members.
    salesperson_id: str = ""


class OrderStatusUpdate(BaseModel):
    status: str


class OrderUpdate(BaseModel):
    contact_id: Optional[str] = None
    client_id: Optional[str] = None
    order_date: Optional[str] = None
    expected_delivery: Optional[str] = None
    is_igst: Optional[bool] = None
    line_items: Optional[list[OrderLineItem]] = None
    discount: Optional[float] = None
    shipping_address: Optional[dict] = None
    notes: Optional[str] = None
    salesperson_id: Optional[str] = None


class TargetCreate(BaseModel):
    salesperson_id: str
    period_start: str
    period_end: str
    target_amount: float = 0
    target_deals: int = 0
    notes: str = ""


class TargetUpdate(BaseModel):
    target_amount: float | None = None
    target_deals: int | None = None
    notes: str | None = None


class StockAdjust(BaseModel):
    low_stock_threshold: float | None = None
    quantity_delta: float | None = None
    reason: str = "manual_adjustment"


# ── Helpers ──────────────────────────────────────────────────

def _compute_order_totals(line_items: list[dict], discount: float, is_igst: bool):
    """`(subtotal, cgst, sgst, igst, total)` — and `subtotal` is GROSS.

    ── THE DISCOUNT WAS DEDUCTED ONCE AND SHOWN TWICE ──────────────────────

    This stored `subtotal` ALREADY NET of the flat order discount and then
    returned `subtotal + tax` as the total, so on any discounted order the
    identity every money document obeys —

        subtotal + tax − discount = total

    — did not hold. `OrderDetail`'s totals block prints Subtotal, CGST, SGST,
    Discount and Total one under the other, so the five figures a customer
    reads did not add up on screen.

    Ganit computes the same document the other way: `_compute_invoice`
    (`routers/ganit.py`) keeps `subtotal` GROSS and takes the discount off the
    TOTAL. So did this module's own client-side preview
    (`pages/vikray/_shared.jsx` `previewTotals`), which is what the person
    filling the form was shown. The server was the only one of the three
    disagreeing.

    That is not merely cosmetic, because `generate_invoice_from_order` copies
    `order["subtotal"]` straight into `ganit_invoices.subtotal` — a column every
    Ganit reader treats as gross. A discounted order therefore minted a tax
    invoice whose TAXABLE VALUE was understated by the discount, and any reader
    computing `subtotal − discount` took it off a second time.

    ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────

    `total` is arithmetically identical — `(gross − discount) + tax` and
    `gross + tax − discount` are the same money — so no order's payable amount
    moves. Only the taxable value is now stated correctly.

    Live exposure measured before the change, 2026-08-29: `staging
    .vikray_orders` held ONE row in the entire table (Aekam Inc, SO-2026-0001)
    and its discount is 0.00, so the identity held vacuously and no stored row
    is affected. Nothing is backfilled; the figures are recomputed by the write
    path on the next create or edit, which is the only place they are ever set.

    Rounding follows `_compute_invoice` line for line, because
    `services/purchase_orders.py` matches a PO against the invoice it becomes
    and two roundings would report a tax discrepancy on every match.
    """
    subtotal = 0
    total_tax = 0
    for item in line_items:
        qty = item.get("quantity", 1)
        rate = item.get("rate", 0)
        disc = item.get("discount_pct", 0)
        line_total = round(qty * rate * (1 - disc / 100), 2)
        gst = item.get("gst_rate", 18) / 100
        subtotal += line_total
        total_tax += round(line_total * gst, 2)
    subtotal = round(subtotal, 2)
    total_tax = round(total_tax, 2)
    total = round(subtotal + total_tax - discount, 2)
    if is_igst:
        return subtotal, 0, 0, total_tax, total
    half = round(total_tax / 2, 2)
    return subtotal, half, round(total_tax - half, 2), 0, total

_VALID_TRANSITIONS = {
    "draft": {"confirmed", "cancelled"},
    "confirmed": {"dispatched", "cancelled"},
    "dispatched": {"delivered"},
    "delivered": {"closed"},
}


async def _apply_stock_moves(pool, org_id: str, order_id: str, line_items, sign: int, reason: str, user_id: str):
    """Adjust stock for every catalogued product on an order. sign=-1 to deduct, +1 to restock."""
    items = json.loads(line_items) if isinstance(line_items, str) else line_items
    for item in items:
        product_id = item.get("product_id")
        qty = item.get("quantity") or 0
        if not product_id or not qty:
            continue
        delta = sign * float(qty)
        await pool.execute(
            "INSERT INTO staging.vikray_stock (org_id, product_id, quantity_on_hand) "
            "VALUES ($1::uuid, $2::uuid, $3) "
            "ON CONFLICT (org_id, product_id) DO UPDATE SET "
            "quantity_on_hand = staging.vikray_stock.quantity_on_hand + $3, updated_at=NOW()",
            org_id, product_id, delta,
        )
        await pool.execute(
            "INSERT INTO staging.vikray_stock_moves (org_id, product_id, order_id, quantity_delta, reason, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)",
            org_id, product_id, order_id, delta, reason, user_id,
        )


# ── Orders CRUD ──────────────────────────────────────────────

@router.get("/orders")
async def list_orders(
    status: str = "",
    contact_id: str = "",
    client_id: str = "",
    since: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Orders — or, with `?since=`, only those changed since that moment.

    Cancelling an order sets `is_active=FALSE`, so the delta must NOT apply the
    `is_active=TRUE` filter — that row is exactly the change the device needs,
    and hiding it leaves a cancelled order live on the phone. The client removes
    any row it receives with `is_active=false`. See `services/delta_sync`.
    """
    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    synced_at = datetime.now(timezone.utc)
    pool = await get_pool()
    q = (
        "SELECT o.*, c.company AS contact_company, c.name AS contact_name, "
        # WHO raised the order and WHO last amended it, as NAMES. `o.*` already
        # carries `created_by`/`updated_by`, but those are `users.user_id` TEXT
        # — a member id, which never reaches a screen — so the display value is
        # resolved here rather than by a second round trip per row from the
        # client. `services/audit_actors` owns the ladder; the alternative was a
        # hand-written COALESCE per router, and the one that exists
        # (`graha.py:1466`) falls through to the EMAIL.
        + actor_select("o", updated=True)
        + "COUNT(*) OVER() AS _total "
        "FROM staging.vikray_orders o "
        "LEFT JOIN staging.graha_contacts c ON c.id = o.contact_id "
        + actor_joins("o", updated=True)
        + "WHERE o.org_id=$1::uuid"
        + ("" if since_dt is not None else " AND o.is_active=TRUE")
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND o.status=${len(params)}"
    if contact_id:
        params.append(contact_id)
        q += f" AND o.contact_id=${len(params)}::uuid"
    # By COMPANY. The customers list asks this way for every customer that has
    # one; `contact_id` remains for the orders that predate migration 136.
    if client_id:
        params.append(client_id)
        q += f" AND o.client_id=${len(params)}::uuid"
    if since_dt is not None:
        params.append(since_dt)
        q += f" AND o.updated_at > ${len(params)} ORDER BY o.updated_at ASC LIMIT 200"
    else:
        q += " ORDER BY o.created_at DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    if since_dt is not None:
        return envelope([dict(r) for r in rows], since_dt, synced_at, limit=200)
    return _listed(rows, limit=200)


async def resolve_order_company(pool, org_id: str, client_id: str,
                                contact_id: str) -> str | None:
    """Which company is this order for?

    Named directly if the form named one. Otherwise INHERITED from the contact's
    client, because an order placed against a person is still an order placed by
    the firm that person works for — and the alternative is a customers list
    that reports the same firm twice, once by company and once by contact.

    Validated against this org before it is written: a `client_id` arriving from
    a request body is user input, and a foreign key alone would let one
    organisation attach its order to another's company row.
    """
    if client_id:
        ok = await pool.fetchval(
            "SELECT 1 FROM staging.graha_clients "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            client_id, org_id)
        if not ok:
            raise HTTPException(400, "That company is not in this organisation")
        return client_id
    if contact_id:
        return await pool.fetchval(
            "SELECT client_id::text FROM staging.graha_contacts "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            contact_id, org_id)
    return None


#: The one place `line_items[].cost_price` is written, for orders and invoices
#: both. Ganit imports it from here for the same reason it imports
#: `resolve_order_company`: two copies of a costing rule is how the order and
#: the invoice it becomes end up disagreeing about what the sale cost.
async def apply_line_costs(pool, org_id: str, items: list,
                           prior_items=None) -> list:
    """Stamp the cost onto each line AT THE MOMENT THE LINE IS WRITTEN.

    Migration 184's contract, in code:

        line_items[].cost_price   numeric, per ONE unit, exclusive of tax, in
                                  the document's own currency, as at the moment
                                  the line was written. Absent means NOT
                                  RECORDED and must never be read as zero.

    Four rules, each of which a naive implementation gets wrong:

    ── COPY, NEVER JOIN ────────────────────────────────────────────────────
    The cost is read from `staging.ganit_products.cost_price` once, here, and
    written onto the line. Readers must never join back to the product:
    procurement renegotiates, and a report that joins re-prices last January's
    gross profit every time it does. The line records what it cost THEN.

    ── ABSENT, NEVER ZERO ──────────────────────────────────────────────────
    A line with no product, a product this org does not have, or a product
    whose cost nobody has recorded, gets NO `cost_price` KEY AT ALL — not 0,
    not null. 104 of the 106 live products carry no cost, so zero would report
    almost the entire catalogue as pure profit. The readers guard on
    `li ? 'cost_price' AND jsonb_typeof(li->'cost_price') = 'number'`
    (`services/report_defs/commission_reports.py`), which is exactly the shape
    an omitted key satisfies and a `null` does not — hence `float()`, so the
    value lands in the document as a JSON number rather than a string.

    ── SERVER-SIDE, NEVER THE BROWSER'S ────────────────────────────────────
    What a firm pays its suppliers is not on the invoice its customer receives
    and is not the customer's — or the customer's browser's — to set. Any
    `cost_price` already on an incoming line is DISCARDED before this decides.
    `OrderLineItem` and `LineItem` are closed models and drop it already, but
    `RecurringCreate.template_items` is `list[dict]` and does not, so this is
    the check that actually closes that door.

    ── CARRIED ON UPDATE, NEVER RE-RESOLVED ────────────────────────────────
    `update_order` and `update_invoice` REPLACE every line. Re-resolving there
    would silently re-price a January order at August's cost — precisely the
    join this key exists to avoid, just performed by the write path instead of
    the report. `prior_items` is the document's lines AS STORED: any product
    already on it keeps the cost it was written with, and only a line new to
    the document is resolved at today's cost, which for that line is the
    moment it was written.

    One query per write, org-scoped, whatever the line count.
    """
    if not items:
        return items

    # What this document already recorded, keyed by product. A cost is only
    # carried if it is genuinely a number: a `null` left by an older write is
    # "not recorded", and must not be carried forward as though it were.
    #
    # Keyed by PRODUCT and not by line position, deliberately. Position is not
    # stable across an edit — a deleted or reordered line would shift every
    # cost after it onto the wrong product, which is worse than not carrying at
    # all because the resulting figure looks perfectly plausible. The known
    # limit of keying by product is two lines of the SAME product carrying
    # different costs: the first wins for both. That is rare, bounded, and
    # visibly conservative; mis-assigning by position is neither.
    carried: dict[str, float] = {}
    for li in (prior_items or []):
        if not isinstance(li, dict):
            continue
        pid = str(li.get("product_id") or "")
        cost = li.get("cost_price")
        if pid and isinstance(cost, (int, float, Decimal)) and not isinstance(cost, bool):
            carried.setdefault(pid, float(cost))

    # Only products this document does not already have a cost for. Malformed
    # ids are dropped rather than bound: `id = ANY($2::uuid[])` fails to encode
    # on the first non-uuid string, and a whole order failing to save because
    # one line carried a stale identifier is worse than that line being
    # uncosted.
    canon_to_raw: dict[str, list[str]] = {}
    for li in items:
        if not isinstance(li, dict):
            continue
        pid = str(li.get("product_id") or "")
        if not pid or pid in carried:
            continue
        try:
            canon_to_raw.setdefault(str(UUID(pid)), []).append(pid)
        except (ValueError, AttributeError, TypeError):
            continue

    resolved: dict[str, float] = {}
    if canon_to_raw:
        rows = await pool.fetch(
            # Org-scoped, not id alone: `ganit_products.id` is a bare primary
            # key, so an id from another organisation's catalogue would
            # otherwise resolve — and a cost is the one figure a competitor
            # would most like to read out of a neighbouring tenant.
            "SELECT id::text AS id, cost_price FROM staging.ganit_products "
            "WHERE org_id=$1::uuid AND id = ANY($2::uuid[])",
            org_id, list(canon_to_raw),
        )
        for r in rows:
            if r["cost_price"] is None:
                continue
            for raw in canon_to_raw.get(str(r["id"]), ()):
                resolved[raw] = float(r["cost_price"])

    for li in items:
        # Unconditional: whatever the caller handed us is not evidence.
        li.pop("cost_price", None)
        pid = str(li.get("product_id") or "")
        cost = carried.get(pid, resolved.get(pid))
        if cost is not None:
            li["cost_price"] = cost
    return items


@router.post("/orders")
async def create_order(
    body: OrderCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    order_number = await next_doc_number(pool, org_id, "vikray_orders", "order_number", "SO")
    items = [li.model_dump() for li in body.line_items]
    # What each line COST us, copied off the product now and remembered by the
    # line for ever. No `prior_items`: nothing exists yet to carry.
    await apply_line_costs(pool, org_id, items)
    client_id = await resolve_order_company(pool, org_id, body.client_id, body.contact_id)
    subtotal, cgst, sgst, igst, total = _compute_order_totals(items, body.discount, body.is_igst)
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # `is_first_order` is answered BEFORE the insert, in the same
            # transaction, so the row being written cannot count itself and a
            # concurrent order for the same company cannot slip between the
            # count and the insert. No `is_active` filter: a firm whose only
            # previous order was cancelled has still ordered before, and a
            # "new customer" rule firing twice for one company is the noise
            # this engine exists to avoid. No client resolved → False, never
            # a guess (the emitter's own contract).
            is_first_order = False
            if client_id:
                _prior = await _conn.fetchval(
                    "SELECT COUNT(*) FROM staging.vikray_orders "
                    "WHERE org_id=$1::uuid AND client_id=$2::uuid",
                    org_id, client_id)
                is_first_order = (_prior or 0) == 0
            row = await _conn.fetchrow(
                "INSERT INTO staging.vikray_orders "
                "(org_id, contact_id, client_id, deal_id, order_number, order_date, expected_delivery, "
                "line_items, subtotal, cgst, sgst, igst, discount, total, is_igst, "
                "shipping_address, notes, created_by, salesperson_id) "
                # $18 (client_id) and $19 (salesperson_id) are appended, not
                # slotted in — the same rule the invoice INSERT documents.
                "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($18,'')::uuid, NULLIF($3,'')::uuid, $4, "
                "COALESCE(NULLIF($5,'')::date, CURRENT_DATE), NULLIF($6,'')::date, "
                "$7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, NULLIF($19,'')) "
                "RETURNING *",
                org_id, body.contact_id, body.deal_id, order_number,
                body.order_date, body.expected_delivery,
                json.dumps(items), subtotal, cgst, sgst, igst, body.discount, total, body.is_igst,
                json.dumps(body.shipping_address), body.notes, user["user_id"],
                client_id,
                # $19. Never None (untyped NULL through PgBouncer = 500).
                body.salesperson_id or "",
            )
            # The owner's "tick", set where it is EARNED rather than by a sync job: this
            # company has now placed an order. Never cleared — a firm that ordered once
            # is a customer for ever, and un-ticking them would drop them out of a sales
            # report on an anniversary nobody chose.
            if client_id:
                await _conn.execute(
                    "UPDATE staging.graha_clients SET is_sales_customer=TRUE, updated_at=NOW() "
                    "WHERE id=$1::uuid AND org_id=$2::uuid AND is_sales_customer=FALSE",
                    client_id, org_id)
            await order_created(
                _conn, org_id=org_id, actor_id=user["user_id"],
                order_id=row["id"], row=dict(row), is_first_order=is_first_order,
            )
    return dict(row)


@router.post("/orders/from-deal/{deal_id}")
async def create_order_from_deal(
    deal_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """A won deal becomes a sales order.

    Owner, 2026-08-09: "a won deal converts to a sales order". The other half of
    the CRM↔Sales question, and the direction that was missing — Ganit could
    already turn a deal into an invoice, which skips the order entirely and
    leaves stock untouched.

    ── WHAT IT CARRIES ACROSS ──────────────────────────────────────────────────

    The company (migration 136's `client_id`), the contact, and the deal's value
    as ONE line. A deal has a value, not a basket: inventing line items from a
    figure would put quantities and HSN codes on the order that nobody entered.
    The line is editable the moment the order exists, which is where the detail
    belongs.

    ── ONLY A WON DEAL, AND ONLY ONCE ──────────────────────────────────────────

    An open deal is a forecast; converting one would book revenue against work
    that has not been agreed. And a second conversion returns the first order
    rather than making a duplicate — the same shape `from-deal` uses for
    invoices, because a double-click must not double the books.
    """
    pool = await get_pool()
    deal = await pool.fetchrow(
        "SELECT id, title, value, stage, contact_id, client_id "
        "FROM staging.graha_deals "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        deal_id, org_id)
    if not deal:
        raise HTTPException(404, "Deal not found")
    if deal["stage"] != "Won":
        raise HTTPException(400, "Only a Won deal becomes a sales order — an open "
                                 "deal is a forecast, not an agreement")

    existing = await pool.fetchrow(
        "SELECT id, order_number FROM staging.vikray_orders "
        "WHERE deal_id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE LIMIT 1",
        deal_id, org_id)
    if existing:
        return {"status": "exists", "order_id": str(existing["id"]),
                "order_number": existing["order_number"]}

    client_id = await resolve_order_company(
        pool, org_id,
        str(deal["client_id"]) if deal["client_id"] else "",
        str(deal["contact_id"]) if deal["contact_id"] else "")

    items = [{
        "product_id": "",
        "description": deal["title"] or "Sales order",
        "hsn_code": "",
        "quantity": 1,
        "unit": "NOS",
        "rate": float(deal["value"] or 0),
        "gst_rate": 18.0,
        "discount_pct": 0,
    }]
    # Costed on the same terms as every other order write — and this one
    # resolves NOTHING, deliberately. A deal is an amount and a title, not a
    # catalogue item: the single line above is synthesised from `deal.value`
    # with `product_id: ""`, so there is no product to read a cost from and the
    # key is correctly omitted. The call stays so that the day this route
    # learns to carry the deal's products across, it is already costed — and so
    # the source-level test that every order INSERT costs its lines can hold
    # without an exception carved out for this path.
    await apply_line_costs(pool, org_id, items)
    subtotal, cgst, sgst, igst, total = _compute_order_totals(items, 0, False)
    order_number = await next_doc_number(pool, org_id, "vikray_orders",
                                         "order_number", "SO")
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # Same first-order question as `create_order`, answered the same
            # way and in the same place: before the insert, on the write's own
            # connection. See the comment there for why `is_active` is not
            # filtered and why an unresolved client means False.
            is_first_order = False
            if client_id:
                _prior = await _conn.fetchval(
                    "SELECT COUNT(*) FROM staging.vikray_orders "
                    "WHERE org_id=$1::uuid AND client_id=$2::uuid",
                    org_id, client_id)
                is_first_order = (_prior or 0) == 0
            row = await _conn.fetchrow(
                "INSERT INTO staging.vikray_orders "
                "(org_id, contact_id, client_id, deal_id, order_number, order_date, "
                " line_items, subtotal, cgst, sgst, igst, discount, total, is_igst, "
                " notes, created_by) "
                "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4::uuid, $5, CURRENT_DATE, "
                " $6::jsonb, $7, $8, $9, $10, 0, $11, FALSE, $12, $13) "
                "RETURNING *",
                org_id, deal["contact_id"], client_id or "", deal_id, order_number,
                json.dumps(items), subtotal, cgst, sgst, igst, total,
                f"From deal: {deal['title']}", user["user_id"])
            if client_id:
                await _conn.execute(
                    "UPDATE staging.graha_clients SET is_sales_customer=TRUE, updated_at=NOW() "
                    "WHERE id=$1::uuid AND org_id=$2::uuid AND is_sales_customer=FALSE",
                    client_id, org_id)
            await order_created(
                _conn, org_id=org_id, actor_id=user["user_id"],
                order_id=row["id"], row=dict(row), is_first_order=is_first_order,
            )
    return {"status": "created", **dict(row)}


@router.get("/orders/{order_id}")
async def get_order(
    order_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT o.*, c.company AS contact_company, c.name AS contact_name, "
        # The detail view answers the same two questions as the list, in the
        # same words. An audit trail that only exists in the table is the shape
        # that sends somebody back to the list to find out who touched the
        # record they already have open. Comma-terminated, so the contact
        # columns follow it and the SELECT list never ends on a comma.
        + actor_select("o", updated=True)
        + "c.email AS contact_email, c.phone AS contact_phone "
        "FROM staging.vikray_orders o "
        "LEFT JOIN staging.graha_contacts c ON c.id = o.contact_id "
        + actor_joins("o", updated=True)
        + "WHERE o.id=$1::uuid AND o.org_id=$2::uuid",
        order_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Order not found")
    return dict(row)


@router.patch("/orders/{order_id}")
async def update_order(
    order_id: str,
    body: OrderUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT * FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if not existing:
        raise HTTPException(404, "Order not found")
    if existing["status"] != "draft":
        raise HTTPException(400, "Only draft orders can be edited")

    # `exclude_unset` is what keeps this PATCH from nulling what it was not
    # asked about: a field absent from the request JSON is absent from
    # `updates`, never reaches the SET list, and survives the edit untouched.
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")

    # ── THE COMPANY ─────────────────────────────────────────────────────────
    #   named `client_id`      validated against THIS org, then written; "" is
    #                          the deliberate "no company" and clears the link
    #   named only `contact_id`  re-inherited from the new person's employer,
    #                          because moving an order to somebody at a
    #                          different firm must not leave the old firm on
    #                          it. Never CLEARS: a contact with no employer
    #                          leaves the company as it was.
    #   named neither          untouched
    #
    # Before this, a `client_id` in the body fell through to the generic branch
    # below and was bound as bare text against a uuid column — a 500 — and it
    # reached the write with no org check at all, the one thing
    # `resolve_order_company` exists to prevent on the create path.
    if "client_id" in updates:
        updates["client_id"] = await resolve_order_company(
            pool, org_id, updates["client_id"] or "", "") or ""
    elif "contact_id" in updates:
        _inherited = await resolve_order_company(
            pool, org_id, "", updates["contact_id"] or "")
        if _inherited:
            updates["client_id"] = _inherited

    if "line_items" in updates and updates["line_items"] is not None:
        items = [li.model_dump() for li in body.line_items]
        # An edit REPLACES every line, so without the order's stored lines as
        # `prior_items` this would re-read the catalogue and re-price a
        # January order at today's cost — the exact join `cost_price` exists
        # to avoid, just performed by the write path rather than the report.
        # A product already on this order keeps what it was written with; a
        # line added by this edit is resolved now, which for that line IS the
        # moment it was written.
        _prior_lines = existing["line_items"]
        if isinstance(_prior_lines, str):
            _prior_lines = json.loads(_prior_lines)
        await apply_line_costs(pool, org_id, items,
                               _prior_lines if isinstance(_prior_lines, list) else None)
        discount = updates.get("discount", existing["discount"])
        is_igst = updates.get("is_igst", existing["is_igst"])
        subtotal, cgst, sgst, igst, total = _compute_order_totals(items, discount, is_igst)
        updates["line_items"] = json.dumps(items)
        updates["subtotal"] = subtotal
        updates["cgst"] = cgst
        updates["sgst"] = sgst
        updates["igst"] = igst
        updates["total"] = total
    elif "discount" in updates or "is_igst" in updates:
        old_items = existing["line_items"]
        items = json.loads(old_items) if isinstance(old_items, str) else old_items
        discount = updates.get("discount", existing["discount"])
        is_igst = updates.get("is_igst", existing["is_igst"])
        subtotal, cgst, sgst, igst, total = _compute_order_totals(items, discount, is_igst)
        updates["subtotal"] = subtotal
        updates["cgst"] = cgst
        updates["sgst"] = sgst
        updates["igst"] = igst
        updates["total"] = total

    sets = []
    params = [order_id, org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("contact_id", "client_id"):
            # NULLIF before the cast: an empty string reaching `::uuid` is an
            # instant PgBouncer 500, and "" is how both of these say "none".
            sets.append(f"{k}=NULLIF(${idx},'')::uuid")
            params.append(v or "")
        elif k in ("order_date", "expected_delivery"):
            sets.append(f"{k}=${idx}::date")
            params.append(date.fromisoformat(v) if v else None)
        elif k == "line_items":
            sets.append(f"{k}=${idx}::jsonb")
            params.append(v)
        elif k == "shipping_address":
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v) if v else "{}")
        elif k == "salesperson_id":
            # Text column; "" -> NULL so "clear the salesperson" and "never set"
            # store the same absence, and the leaderboard's join matches neither.
            sets.append(f"{k}=NULLIF(${idx},'')")
            params.append(v or "")
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")
    # WHO amended it, in the same statement that amends it. A trigger cannot
    # answer this — it does not know who is holding the connection — so a write
    # path that stamps `updated_at` and not `updated_by` leaves a row that can
    # say it changed and not who changed it. Bound at `$idx`, never
    # interpolated: `user["user_id"]` is server-side, but interpolating it here
    # is how the next author learns the wrong habit.
    sets.append(f"updated_by=${idx}")
    params.append(user["user_id"])
    idx += 1

    row = await pool.fetchrow(
        f"UPDATE staging.vikray_orders SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid RETURNING *",
        *params,
    )
    return dict(row)


@router.patch("/orders/{order_id}/status")
async def update_order_status(
    order_id: str,
    body: OrderStatusUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT status, deal_id, line_items FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if not existing:
        raise HTTPException(404, "Order not found")
    allowed = _VALID_TRANSITIONS.get(existing["status"], set())
    if body.status not in allowed:
        raise HTTPException(400, f"Cannot transition from '{existing['status']}' to '{body.status}'")
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # `AND status=$4`: the transition was validated against a read
            # taken BEFORE this transaction, so two overlapping requests both
            # believed it. Carrying the pre-read status into the WHERE makes
            # the loser match zero rows — no write, no event, a 409.
            row = await _conn.fetchrow(
                # `updated_by=$5` — a status move is the edit most worth
                # attributing, and it is the one write here that a trigger will
                # never cover. Appended LAST in both the SET list and the params
                # tuple so the existing $1-$4 numbering is untouched; renumbering
                # an existing placeholder to make room is how this becomes a 500.
                "UPDATE staging.vikray_orders SET status=$1, updated_at=NOW(), "
                "updated_by=$5 "
                "WHERE id=$2::uuid AND org_id=$3::uuid AND status=$4 RETURNING *",
                body.status, order_id, org_id, existing["status"],
                user["user_id"],
            )
            if row is None:
                # Vanished, or somebody else moved it first. Refusing here —
                # inside the transaction, before any emitter — means no event
                # announces a change that did not happen.
                raise HTTPException(
                    409, "The order changed while you were looking at it. "
                         "Reload and try again.")
            await order_status_changed(
                _conn, org_id=org_id, actor_id=user["user_id"],
                order_id=order_id, old_status=existing["status"],
                new_status=body.status, row=dict(row),
            )
            # 'delivered' is the fulfilment terminal, read off _VALID_TRANSITIONS:
            # it is where the goods stop moving (dispatched → delivered), and it
            # is what the emitter's own docstring promises. 'closed' is the
            # administrative end of the ledger line — books, not fulfilment —
            # and a thank-you rule firing at book-keeping would be late noise.
            if body.status == "delivered":
                await order_fulfilled(
                    _conn, org_id=org_id, actor_id=user["user_id"],
                    order_id=order_id, row=dict(row),
                )
    if body.status == "confirmed":
        await _apply_stock_moves(pool, org_id, order_id, existing["line_items"], -1, "order_confirmed", user["user_id"])
    elif body.status == "cancelled" and existing["status"] == "confirmed":
        await _apply_stock_moves(pool, org_id, order_id, existing["line_items"], 1, "order_cancelled", user["user_id"])
    if body.status == "closed" and existing["deal_id"]:
        # `won_at` is stamped here, not just the stage. Graha's own
        # `PATCH /deals/{id}` sets it whenever a deal moves to Won, and target
        # attainment now dates a won deal by `COALESCE(won_at, updated_at)` —
        # so a deal won through THIS path with no `won_at` falls back to
        # last-touched, and any later edit silently moves the money into a
        # different quarter. COALESCE, not overwrite: a deal already recorded as
        # won keeps its original close date if an order is closed against it
        # afterwards, because the sale happened when it happened.
        # …and the stage write EMITS, like Graha's own PATCH does. This
        # direct UPDATE bypassed deal_stage_changed for months, so a
        # "deal won" rule fired from the CRM board but not from sales —
        # the same fact, two behaviours, and the sales path is where most
        # wins actually land.
        from services.niyam.subjects import deal_stage_changed
        async with pool.acquire() as _conn:
            async with _conn.transaction():
                _before = await _conn.fetchrow(
                    "SELECT * FROM staging.graha_deals WHERE id=$1::uuid AND org_id=$2::uuid",
                    str(existing["deal_id"]), org_id)
                _after = await _conn.fetchrow(
                    "UPDATE staging.graha_deals "
                    "SET stage='Won', won_at=COALESCE(won_at, NOW()), updated_at=NOW() "
                    "WHERE id=$1::uuid AND org_id=$2::uuid RETURNING *",
                    str(existing["deal_id"]), org_id,
                )
                if _before and _after and _before.get("stage") != _after.get("stage"):
                    await deal_stage_changed(
                        _conn, org_id=org_id, actor_id=user["user_id"],
                        deal_id=_after["id"], old_stage=_before["stage"],
                        new_stage=_after["stage"], row=dict(_after),
                    )
    return dict(row)


@router.post("/orders/{order_id}/invoice")
# `balance_due` is written explicitly, and that is not cosmetic. The column
# DEFAULTS to 0 and this INSERT omitted it, so an invoice generated from an
# order was born reading as FULLY PAID against a non-zero total. Three
# consequences, none of them visible at the point of creation:
#
#   · it never appeared in receivables or in ageing — the money owed was
#     invisible to the firm that was owed it;
#   · payment recording had nothing to reduce;
#   · and it could not be EDITED, because editing is bounded by payment
#     (owner's ruling: unpaid is amendable, paid is not). This is the second
#     and independent cause of "I created an invoice from an order and I
#     cannot edit it" — doc_status DEFAULT 'final' was the first.
#
# Measured on live data before the fix: every order-generated invoice in the
# database had balance_due = 0 against a positive total.
async def generate_invoice_from_order(
    order_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _gg=Depends(_ganit_gate),
):
    pool = await get_pool()
    order = await pool.fetchrow(
        "SELECT * FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] == "draft":
        raise HTTPException(400, "Confirm the order before generating an invoice")
    if order["invoice_id"]:
        raise HTTPException(400, "Invoice already generated for this order")

    lines = order["line_items"] if isinstance(order["line_items"], list) \
        else json.loads(order["line_items"])

    # The lines cross to the invoice VERBATIM, and that is what carries
    # `cost_price` with them. `apply_line_costs` is deliberately NOT called
    # here: the order already recorded what each line cost when it was placed,
    # and re-resolving at invoicing time would re-price a March order at
    # June's catalogue — the order and the invoice for the same sale would
    # then report two different gross profits. Nothing to do but not break it.

    # Rule 46 BEFORE the serial is drawn. This route minted a tax invoice with
    # no check at all, riding `ganit_invoices.doc_status` DEFAULT 'final' — so a
    # confirmed order whose lines carry no HSN produced a "final" tax invoice
    # that Ganit's own PDF endpoint then refused to render. The customer could
    # not be sent the document and the number was already spent.
    #
    # Refusing before `next_doc_number` is deliberate: a refusal that has
    # already drawn a serial leaves a permanent gap in the invoice sequence,
    # which is precisely what a tax auditor asks about.
    # The company crosses the module boundary with the document. The order
    # already knows which firm it is for — migration 136's `client_id`, set on
    # both create paths — and this INSERT dropped it, so the moment a sale
    # became money owed it stopped belonging to anybody: filed under "Unlinked
    # client" in receivables ageing, absent from that company's Client 360, and
    # invisible to every Niyam rule keyed on the customer. Falls back to the
    # contact's employer for an order predating the column.
    #
    # CARRIED, not re-validated: `order` was read `WHERE org_id=$2`, so its
    # company is already this org's. Re-checking would refuse to invoice a
    # delivered order whose client has since been archived — the goods are
    # gone and the firm still needs to bill for them.
    client_id = (
        str(order["client_id"]) if order["client_id"]
        else await resolve_order_company(
            pool, org_id, "",
            str(order["contact_id"]) if order["contact_id"] else "")
    )

    from routers.ganit import _refuse_final_if_incomplete
    await _refuse_final_if_incomplete(pool, org_id, {
        "invoice_type": "tax_invoice",
        "invoice_number": "pending",
        "invoice_date": date.today(),
        "line_items": lines,
        "is_igst": order["is_igst"],
        "subtotal": order["subtotal"], "cgst": order["cgst"],
        "sgst": order["sgst"], "igst": order["igst"], "total": order["total"],
        # ⚠ `client_id`, AND WITHOUT IT A B2B ORDER COULD NEVER BE INVOICED.
        #
        # Rule 46(e) asks for the name of the RECIPIENT, and this gate resolved
        # it from `contact_id` alone. An order raised against a COMPANY with no
        # individual named — which is the ordinary B2B case, and the one this
        # product's own rule describes ("a CRM client is the company; contacts
        # are people who come and go, the customer stays") — therefore arrived
        # with `contact = None`, raised the BLOCKING "Recipient name" gap, and
        # 422'd. The order could be confirmed, dispatched and delivered and
        # then never billed, with the customer's name sitting on the row the
        # whole time.
        #
        # `_refuse_final_if_incomplete` already carries the company fallback —
        # it resolves `graha_clients` when there is no contact and hands the
        # firm's name in as the `company` the validator accepts. `create_invoice`
        # and `client_billing.generate_usage_invoice` both pass the key. THIS
        # ROUTE WAS THE ONE CALLER THAT DID NOT, so the fallback could not fire.
        # Found by proposal 93 Suite 10 (10.08) on 2026-08-29: every one of the
        # thirty-five orders raised through the real form names a company and no
        # person, and the first `Generate invoice` answered 422.
        #
        # Nothing is invented: the name comes from the row the order already
        # points at, and it is the same row the INSERT below files the invoice
        # under. The resolution moved ABOVE this call for that reason — it used
        # to sit between the gate and the INSERT, which is why the gate could
        # not see it.
        "client_id": client_id or "",
    }, order["contact_id"])

    inv_number = await next_doc_number(pool, org_id, "ganit_invoices", "invoice_number", "INV")
    inv = await pool.fetchrow(
        "INSERT INTO staging.ganit_invoices "
        "(org_id, contact_id, invoice_number, invoice_type, invoice_date, "
        "place_of_supply, is_igst, line_items, subtotal, cgst, sgst, igst, "
        "discount, total, balance_due, notes, created_by, client_id) "
        "VALUES ($1::uuid, $2, $3, 'tax_invoice', CURRENT_DATE, '', $4, "
        "$5::jsonb, $6, $7, $8, $9, $10, $11, $11, $12, $13, NULLIF($14,'')::uuid) "
        "RETURNING id",
        org_id, order["contact_id"], inv_number, order["is_igst"],
        json.dumps(lines),
        order["subtotal"], order["cgst"], order["sgst"], order["igst"],
        order["discount"], order["total"], f"Generated from order {order['order_number']}",
        user["user_id"],
        client_id or "",
    )
    await pool.execute(
        # Attaching the invoice IS an amendment of the order, and the person who
        # issued the invoice is the person who made it. Without `updated_by` the
        # order's last editor would read as whoever touched it before the
        # invoice — the wrong name, which is worse than no name.
        "UPDATE staging.vikray_orders SET invoice_id=$1, updated_at=NOW(), updated_by=$4 "
        "WHERE id=$2::uuid AND org_id=$3::uuid",
        inv["id"], order_id, org_id, user["user_id"],
    )
    return {"ok": True, "invoice_id": str(inv["id"]), "invoice_number": inv_number}


@router.delete("/orders/{order_id}")
async def cancel_order(
    order_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT status, line_items FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if not existing:
        raise HTTPException(404, "Order not found")
    if existing["status"] not in ("draft", "confirmed"):
        raise HTTPException(400, "Only draft or confirmed orders can be cancelled")
    # Cancellation IS a status change, and the one status writer that shipped
    # silent: a rule on "order changes status" saw confirm and dispatch but
    # never cancel — the change most worth reacting to. Same shape as
    # update_order_status above: the write and its event share a transaction,
    # a RETURNING that matched nothing emits nothing.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # `AND status=$3` (the pre-read value, itself validated as
            # cancellable above): two overlapping cancels both passed the
            # stale pre-check, and the second write was an idempotent
            # re-cancel that still emitted — and still restocked. Binding
            # the exact pre-read status makes the loser match nothing, AND
            # guarantees the restock gate below ("was it confirmed?") is
            # judging the true pre-write state, not a stale read: a
            # draft-read order that got confirmed mid-flight (stock already
            # deducted) now 409s here instead of cancelling with the
            # restock silently skipped.
            _after = await _conn.fetchrow(
                # Cancellation is a soft delete, and a soft delete with no
                # actor is the one row in the table nobody can explain later.
                # `$4` is appended after the pre-read status so $1-$3 keep their
                # meaning.
                "UPDATE staging.vikray_orders SET status='cancelled', is_active=FALSE, "
                "updated_at=NOW(), updated_by=$4 "
                "WHERE id=$1::uuid AND org_id=$2::uuid AND status=$3 "
                "RETURNING *",
                order_id, org_id, existing["status"], user["user_id"],
            )
            if _after is None:
                raise HTTPException(
                    409, "The order changed while you were looking at it. "
                         "Reload and try again.")
            await order_status_changed(
                _conn, org_id=org_id, actor_id=user["user_id"],
                order_id=order_id, old_status=existing["status"],
                new_status="cancelled", row=dict(_after),
            )
    if existing["status"] == "confirmed":
        await _apply_stock_moves(pool, org_id, order_id, existing["line_items"], 1, "order_cancelled", user["user_id"])
    return {"ok": True}


# ── Target attainment ────────────────────────────────────────
#
# Attainment was PERMANENTLY ZERO for every target in every org, and the cause
# was the join column. Both reads below, and `GET /v1/dristi/sales`, matched a
# target's salesperson against `staging.graha_deals.owner_id` — a column that
# NOTHING IN THE PRODUCT EVER WRITES.
#
# Measured on the live database before this change:
#
#   · 649 deals, **0** with a non-null `owner_id`.
#   · 120 with `assigned_to`, and all 120 of those match a real
#     `public.users.user_id`. `assigned_to` is what `POST /graha/deals` accepts,
#     what `PATCH /graha/deals/{id}` updates, and what Graha's own
#     `GET /graha/reports/rep-performance` already groups by. It is the deal
#     owner in this product; `owner_id` is a column somebody added and left.
#   · 26 targets across 13 people, 5 live for the current period, Rs 9,00,000
#     to Rs 18,00,000 each — every one rendering "Rs 0 of Rs 15,00,000".
#
# WHY DEALS AND NOT INVOICES. A sales target is often measured on closed
# revenue, so orders and invoices were checked before deciding. Neither carries
# an owner: `vikray_orders` and `ganit_invoices` have only `created_by`, which
# is whoever did the DATA ENTRY. In one live org a single user created all 658
# invoices, Rs 12.2 crore — crediting that to a target would hand one person
# the whole firm's number. And `created_by` on deals is no better: one live org
# has 513 deals created by `user_admin001` in a single day, an import, none of
# them assigned to anyone. So attainment counts DEALS BY THEIR ASSIGNEE, which
# is also what the target row itself says it wants — `vikray_targets` carries a
# `target_deals` COUNT alongside the amount, and nothing but a deal is countable
# that way — and what the Targets tab already promises the user in prose:
# "Actuals come from deals marked Won in Graha (CRM) inside the target period."
# This is not a new definition. It is the definition the product advertises,
# finally implemented.
#
# WHY `won_at` AND NOT `updated_at`. The old window was
# `updated_at BETWEEN period_start AND period_end`, and `updated_at` moves on
# ANY edit — a fixed typo relocates a rep's revenue into a different quarter.
# This is not theoretical and it does not only under-report. Measured live, one
# rep's 20 won deals span 2025-05-08 to 2026-08-07 by their real close dates but
# were all last touched on 2026-08-02, so under `updated_at`:
#
#   · a Q3-2026 target of Rs 14,75,310 collected all 20 deals, Rs 2,43,86,460 —
#     1653% attainment;
#   · a Q2-2025 target collected 0, though 3 deals worth Rs 12,67,290 closed in
#     that quarter.
#
# `won_at` is stamped by `PATCH /graha/deals/{id}` when the stage flips to Won
# and is populated on 25 of 25 won deals. It is the close date. `updated_at`
# survives only as a COALESCE fallback, because two write paths still set
# stage='Won' without stamping it — Graha's automation runner, and this module's
# own order-close below, which is fixed in this change. A deal with no recorded
# close date has no better answer available, and dropping it would make money a
# rep actually earned disappear from their number entirely.


def _won_in_period(owner_predicate: str) -> str:
    """The won-deal aggregate for one target row, as a LATERAL sub-select body.

    Both attainment and the unattributed diagnostic are built from this one
    fragment so they cannot drift apart on the period rule — the whole point of
    the diagnostic is that it is measured over exactly the window attainment is
    measured over, and two hand-written copies is how that stops being true.

    Expects the enclosing query to expose the target row as `t` and to pass
    `org_id` as `$1`.
    """
    return (
        "  SELECT COALESCE(SUM(d.value), 0) AS amount, COUNT(*) AS deals "
        "  FROM staging.graha_deals d "
        "  WHERE d.org_id = $1::uuid "
        # Every deal-listing query in Graha filters this; the attainment join
        # did not, so a deleted deal kept paying into somebody's target forever.
        "    AND d.is_active = TRUE "
        "    AND d.stage = 'Won' "
        f"    AND {owner_predicate} "
        "    AND COALESCE(d.won_at, d.updated_at) >= t.period_start "
        "    AND COALESCE(d.won_at, d.updated_at) < t.period_end + 1 "
    )


#: What this salesperson closed. Both sides are text — `vikray_targets`
#: .salesperson_id since migration 092, `graha_deals.assigned_to` always — so
#: there is no cast here and there must never be one: the previous version of
#: this join needed `owner_id::text` precisely because it was reaching for a
#: uuid column, and the cast is the fingerprint of the wrong column.
_ATTAINMENT_SQL = _won_in_period("d.assigned_to = t.salesperson_id")

#: Won money inside the same period that NO target can claim, because the deal
#: was never assigned to anyone.
#:
#: This exists because fixing the column does not, on its own, make the number
#: non-zero for every org. In one live org all five deals — including
#: Rs 2,50,000 of won business — have `assigned_to` NULL, so both people who
#: hold targets there will still read zero after this change, and correctly so:
#: nobody has claimed that revenue. Returning the figure lets the screen say
#: "Rs 2,50,000 won this period is not assigned to anyone" instead of showing a
#: bare zero that looks like the old bug. Inventing an owner — crediting
#: `created_by` — was the alternative, and it is the import case above: a
#: confidently wrong number is worse than a zero you can explain.
_UNATTRIBUTED_SQL = _won_in_period("d.assigned_to IS NULL")


# ── Targets CRUD ─────────────────────────────────────────────

@router.post("/targets")
async def create_target(
    body: TargetCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.vikray_targets "
        "(org_id, salesperson_id, period_start, period_end, target_amount, target_deals, notes, created_by) "
        "VALUES ($1::uuid, $2, $3::date, $4::date, $5, $6, $7, $8) "
        "ON CONFLICT (org_id, salesperson_id, period_start) DO UPDATE SET "
        "target_amount=EXCLUDED.target_amount, target_deals=EXCLUDED.target_deals, notes=EXCLUDED.notes, "
        # The conflict arm is an EDIT of somebody else's target row, not a
        # create — `created_by` on that row belongs to whoever set it first and
        # must not move. `EXCLUDED.created_by` is $8, the caller, reused rather
        # than bound a second time so no new placeholder enters the statement.
        # `updated_at` is left to `trg_touch_vikray_targets` (migration 201);
        # stamping it here as well would be harmless but would hide who owns it.
        "updated_by=EXCLUDED.created_by "
        "RETURNING *",
        org_id, body.salesperson_id,
        date.fromisoformat(body.period_start) if body.period_start else None,
        date.fromisoformat(body.period_end) if body.period_end else None,
        body.target_amount, body.target_deals, body.notes, user["user_id"],
    )
    return dict(row)


@router.get("/targets")
async def list_targets(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT t.*, "
        # WHO set the quota and WHO last moved it. A target is a number somebody
        # is measured against, so "it changed" is a question with a person
        # attached — and before migration 201 this table could record the new
        # figure and nothing else. The `u` join below answers a different
        # question (WHOSE target this is) and is left exactly as it was.
        + actor_select("t", updated=True)
        # WHOSE target this is, as a NAME. This ended `…, u.email)`: a
        # salesperson with no name recorded had their EMAIL printed as the
        # label on the row carrying their quota. That is a contact detail
        # rendered as a label, and it inverts the standing rule that Aekam
        # must not see a customer's member emails. The owner's ruling
        # (2026-08-23): a display-name ladder must never end at an email.
        #
        # MEASURED FIRST — the objection is "then the cell goes blank": on the
        # live database 0 of 35 accounts have neither `full_name` nor `name`,
        # so this rung has never fired. Removing it changes nothing visible.
        #
        # It ends at a STATED label rather than blank because a blank name
        # beside a quota reads as an unassigned target, which is a different
        # and false claim — the target IS assigned, to somebody whose name we
        # do not hold. Same module that already owns `actor_select` above, so
        # the two ladders in this one query cannot drift apart; `display_name`
        # emits no `$n` and leaves `$1` below alone. The other two sites in
        # this file (targets leaderboard, orders pipeline) are the same fix.
        + display_name("u")
        + " AS salesperson_name, "
        "COALESCE(d.amount, 0) AS actual_amount, "
        "COALESCE(d.deals, 0) AS actual_deals, "
        "COALESCE(x.amount, 0) AS unattributed_amount, "
        "COALESCE(x.deals, 0) AS unattributed_deals "
        "FROM staging.vikray_targets t "
        "LEFT JOIN users u ON u.user_id = t.salesperson_id "
        + actor_joins("t", updated=True)
        + "LEFT JOIN LATERAL (" + _ATTAINMENT_SQL + ") d ON TRUE "
        "LEFT JOIN LATERAL (" + _UNATTRIBUTED_SQL + ") x ON TRUE "
        "WHERE t.org_id=$1::uuid "
        "ORDER BY t.period_start DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/targets/leaderboard")
async def targets_leaderboard(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    now = date.today()
    rows = await pool.fetch(
        "SELECT t.salesperson_id, "
        + display_name("u")
        + " AS salesperson_name, "
        "t.target_amount, t.target_deals, "
        "COALESCE(d.amount, 0) AS actual_amount, "
        "COALESCE(d.deals, 0) AS actual_deals, "
        "COALESCE(x.amount, 0) AS unattributed_amount, "
        "COALESCE(x.deals, 0) AS unattributed_deals, "
        "CASE WHEN t.target_amount > 0 "
        "  THEN ROUND(COALESCE(d.amount,0) / t.target_amount * 100, 1) "
        "  ELSE 0 END AS achievement_pct "
        "FROM staging.vikray_targets t "
        "LEFT JOIN users u ON u.user_id = t.salesperson_id "
        "LEFT JOIN LATERAL (" + _ATTAINMENT_SQL + ") d ON TRUE "
        "LEFT JOIN LATERAL (" + _UNATTRIBUTED_SQL + ") x ON TRUE "
        "WHERE t.org_id=$1::uuid AND t.period_start <= $2 AND t.period_end >= $2 "
        "ORDER BY achievement_pct DESC",
        org_id, now,
    )
    return {"data": [dict(r) for r in rows]}


@router.patch("/targets/{target_id}")
async def update_target(
    target_id: str,
    body: TargetUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    if body.target_amount is not None:
        vals.append(body.target_amount)
        updates.append(f"target_amount=${len(vals)}")
    if body.target_deals is not None:
        vals.append(body.target_deals)
        updates.append(f"target_deals=${len(vals)}")
    if body.notes is not None:
        vals.append(body.notes)
        updates.append(f"notes=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    # WHO moved the quota, in the same statement that moves it. Appended while
    # `vals` still holds only SET values, BEFORE `target_id`/`org_id` join the
    # list — the WHERE clause below addresses those two by `len(vals)-1` and
    # `len(vals)`, so anything added after them silently shifts the predicate
    # onto the wrong parameter and the UPDATE matches nothing.
    #
    # `updated_at` is deliberately absent: migration 201 put
    # `trg_touch_vikray_targets` on this table, so the timestamp has an owner
    # and a second writer of the same column is a second thing to keep in step.
    vals.append(user["user_id"])
    updates.append(f"updated_by=${len(vals)}")
    vals += [target_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.vikray_targets SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Target not found")
    return dict(row)


@router.delete("/targets/{target_id}")
async def delete_target(
    target_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM staging.vikray_targets WHERE id=$1::uuid AND org_id=$2::uuid",
        target_id, org_id,
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Target not found")
    return {"ok": True}


# ── Dashboard ────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    orders_stats = await pool.fetchrow(
        "SELECT "
        "COUNT(*) FILTER (WHERE status NOT IN ('cancelled')) AS total_orders, "
        "COUNT(*) FILTER (WHERE status='draft') AS draft_orders, "
        "COUNT(*) FILTER (WHERE status='confirmed') AS confirmed_orders, "
        "COUNT(*) FILTER (WHERE status='dispatched') AS dispatched_orders, "
        "COUNT(*) FILTER (WHERE status='delivered') AS delivered_orders, "
        "COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled','draft')), 0) AS order_value "
        "FROM staging.vikray_orders WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    pipeline = await pool.fetchrow(
        "SELECT COUNT(*) AS open_deals, COALESCE(SUM(value),0) AS pipeline_value "
        "FROM staging.graha_deals WHERE org_id=$1::uuid AND stage NOT IN ('Won','Lost')",
        org_id,
    )
    revenue = await pool.fetchrow(
        "SELECT COALESCE(SUM(total),0) AS total_revenue, "
        "COALESCE(SUM(amount_paid),0) AS collected "
        "FROM staging.ganit_invoices WHERE org_id=$1::uuid AND payment_status != 'cancelled'",
        org_id,
    )
    return {
        **dict(orders_stats),
        "pipeline_value": pipeline["pipeline_value"],
        "open_deals": pipeline["open_deals"],
        "total_revenue": revenue["total_revenue"],
        "collected": revenue["collected"],
    }


# ── Pipeline ─────────────────────────────────────────────────
#
# The reference (`design-reference/Kartavaya Redesign/ScreensBiz.jsx`,
# `ScreenVikray`) opens Vikray on `tab: 'pipeline'` and renders "Quote to cash":
# every live sales object on a five-segment progress bar, with the money summed
# per stage. `Data.jsx:125` lists the tab, `Data.jsx:119` records that the tab
# set was "lifted from staging pages — nothing dropped", and `TAB_HI` carries a
# Devanagari label for it. It is specified.
#
# It is NOT Graha's deal pipeline, and this endpoint deliberately cannot become
# one. `GET /v1/dristi/pipeline` was found reading `staging.graha_deals` with no
# source-module check, so a grant on the reporting module alone read the whole
# CRM. Nothing here touches `graha_deals`: the only Graha table in the query is
# `graha_contacts`, joined for the party NAME on an order that already belongs
# to this org — precisely what `GET /orders` two hundred lines above already
# returns under this same gate. A vikray grant reads vikray's own orders.
#
# The reference is quote-shaped and the build is order-shaped: there is no
# quote entity in `staging.vikray_orders` and none is invented here. The five
# stages are the order lifecycle in `_VALID_TRANSITIONS`, which is the same
# quote→cash line the design draws, named for the objects this build actually
# stores.

#: The lifecycle, in order — mirrors `_VALID_TRANSITIONS` and the frontend's
#: `ORDER_FLOW` in `pages/vikray/_shared.jsx`. `cancelled` is terminal and off
#: the line: a cancelled order is soft-deleted (`is_active=FALSE`) and is not
#: money sitting anywhere, so it is neither a stage nor part of any total.
_PIPELINE_STAGES = ["draft", "confirmed", "dispatched", "delivered", "closed"]


@router.get("/pipeline")
async def pipeline(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # Aggregated over EVERY active order, not over the truncated list below.
    # A stage total computed from a LIMITed page is a wrong number that looks
    # like a right one — and these are rupee figures somebody plans against.
    stage_rows = await pool.fetch(
        "SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS value "
        "FROM staging.vikray_orders "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
        "GROUP BY status",
        org_id,
    )
    by_status = {r["status"]: r for r in stage_rows}
    stages = [
        {
            "stage": s,
            "count": int(by_status[s]["count"]) if s in by_status else 0,
            "value": by_status[s]["value"] if s in by_status else 0,
        }
        for s in _PIPELINE_STAGES
    ]

    rows = await pool.fetch(
        "SELECT o.id, o.order_number, o.status, o.total, o.order_date, "
        "o.expected_delivery, o.invoice_id, o.contact_id, "
        "c.company AS contact_company, c.name AS contact_name, "
        + display_name("u")
        + " AS owner_name "
        "FROM staging.vikray_orders o "
        # Org-scoped on both sides. `GET /orders` joins on `c.id` alone; a
        # contact_id that ever pointed outside the org would cross a tenant
        # boundary on a read, and the extra predicate costs nothing.
        "LEFT JOIN staging.graha_contacts c ON c.id = o.contact_id AND c.org_id = o.org_id "
        "LEFT JOIN users u ON u.user_id = o.created_by "
        "WHERE o.org_id=$1::uuid AND o.is_active=TRUE "
        "ORDER BY o.order_date DESC, o.created_at DESC LIMIT 400",
        org_id,
    )

    return {"data": [dict(r) for r in rows], "stages": stages}


# ── Customers ────────────────────────────────────────────────
#
# `Data.jsx:125` lists `customers`; `TAB_HI` gives it ग्राहक.
#
# ── A CUSTOMER IS A COMPANY, NOT A CONTACT ──────────────────────────────────
#
# This grouped by `contact_id`, so a "customer" was a CRM contact who happened
# to have placed an order — a PERSON. Contacts leave; the customer stays, and
# two people at one firm produced two customers with the firm's orders split
# between them.
#
# Since migration 136 an order carries `client_id`, the one shared company
# record, and this groups by that. Orders that predate the column and whose
# contact had no client keep falling back to the contact, so nothing disappears
# from the list — but they are the exception now, not the design.
#
# Still derived, and deliberately so: this is the sales ledger's view of a
# party — what they have ordered, when, and what is open. None of Graha's CRM
# columns (lead_score, assigned_to, source, tags, notes) are selected, so an
# org with Sales and no CRM sees a sales list and nothing else.


@router.get("/customers")
async def list_customers(
    q: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    sql = (
        "SELECT COALESCE(o.client_id::text, 'contact:' || o.contact_id::text) AS customer_key, "
        "o.client_id, "
        # The company's own name and GSTIN when there is one; the contact's
        # otherwise. A customer row must always be able to say who it is.
        "COALESCE(cl.name, c.company, c.name) AS customer_name, "
        "COALESCE(cl.gstin, c.gstin) AS gstin, "
        "cl.is_sales_customer, "
        "MAX(c.name) AS contact_name, MAX(c.email) AS email, MAX(c.phone) AS phone, "
        "COUNT(*) AS order_count, "
        "COALESCE(SUM(o.total), 0) AS order_value, "
        "MAX(o.order_date) AS last_order_date, "
        "COUNT(*) FILTER (WHERE o.status <> 'closed') AS open_orders, "
        "COUNT(*) FILTER (WHERE o.invoice_id IS NOT NULL) AS invoiced_orders, "
        # After GROUP BY, a window counts GROUPS — customers — not order rows,
        # which is the number this list is capped on. Getting that backwards
        # would report the order count as the customer count and look plausible.
        "COUNT(*) OVER() AS _total "
        "FROM staging.vikray_orders o "
        "LEFT JOIN staging.graha_contacts c ON c.id = o.contact_id AND c.org_id = o.org_id "
        "LEFT JOIN staging.graha_clients cl ON cl.id = o.client_id AND cl.org_id = o.org_id "
        "WHERE o.org_id=$1::uuid AND o.is_active=TRUE "
        "  AND (o.client_id IS NOT NULL OR o.contact_id IS NOT NULL)"
    )
    params: list = [org_id]
    if q:
        params.append(f"%{q}%")
        sql += (f" AND (cl.name ILIKE ${len(params)} OR c.name ILIKE ${len(params)} "
                f"OR c.company ILIKE ${len(params)})")
    sql += (
        " GROUP BY COALESCE(o.client_id::text, 'contact:' || o.contact_id::text), "
        " o.client_id, COALESCE(cl.name, c.company, c.name), "
        " COALESCE(cl.gstin, c.gstin), cl.is_sales_customer "
        "ORDER BY order_value DESC LIMIT 200"
    )

    rows = await pool.fetch(sql, *params)
    return _listed(rows, limit=200)


# ── Stock Ledger ─────────────────────────────────────────────

@router.get("/stock")
async def list_stock(
    low_stock: bool = False,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT p.id AS product_id, p.name, p.unit, "
        "COALESCE(s.quantity_on_hand, 0) AS quantity_on_hand, "
        "COALESCE(s.low_stock_threshold, 0) AS low_stock_threshold "
        "FROM staging.ganit_products p "
        "LEFT JOIN staging.vikray_stock s ON s.product_id = p.id AND s.org_id = p.org_id "
        "WHERE p.org_id=$1::uuid AND p.is_active=TRUE"
    )
    if low_stock:
        q += " AND COALESCE(s.quantity_on_hand, 0) <= COALESCE(s.low_stock_threshold, 0)"
    q += " ORDER BY p.name"
    rows = await pool.fetch(q, org_id)
    return {"data": [dict(r) for r in rows]}


@router.patch("/stock/{product_id}")
async def adjust_stock(
    product_id: str,
    body: StockAdjust,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    product = await pool.fetchrow(
        "SELECT id, name FROM staging.ganit_products WHERE id=$1::uuid AND org_id=$2::uuid",
        product_id, org_id,
    )
    if not product:
        raise HTTPException(404, "Product not found")

    async with pool.acquire() as _conn:
        async with _conn.transaction():
            await _conn.execute(
                "INSERT INTO staging.vikray_stock (org_id, product_id, low_stock_threshold) "
                "VALUES ($1::uuid, $2::uuid, COALESCE($3, 0)) "
                "ON CONFLICT (org_id, product_id) DO UPDATE SET "
                "low_stock_threshold = COALESCE($3, staging.vikray_stock.low_stock_threshold), updated_at=NOW()",
                org_id, product_id, body.low_stock_threshold,
            )
            if body.quantity_delta:
                # This is the MANUAL adjustment — the emitter's docstring says
                # manual only, so order fulfilment's `_apply_stock_moves` stays
                # silent. Both sides of the write are read on the write's own
                # connection: the before under FOR UPDATE (the upsert above has
                # just guaranteed the row exists in this transaction), the
                # after from the UPDATE's own RETURNING — never re-derived by
                # arithmetic that could disagree with what was stored.
                quantity_before = await _conn.fetchval(
                    "SELECT quantity_on_hand FROM staging.vikray_stock "
                    "WHERE org_id=$1::uuid AND product_id=$2::uuid FOR UPDATE",
                    org_id, product_id,
                )
                quantity_after = await _conn.fetchval(
                    "UPDATE staging.vikray_stock SET quantity_on_hand = quantity_on_hand + $1, updated_at=NOW() "
                    "WHERE org_id=$2::uuid AND product_id=$3::uuid RETURNING quantity_on_hand",
                    body.quantity_delta, org_id, product_id,
                )
                await _conn.execute(
                    "INSERT INTO staging.vikray_stock_moves (org_id, product_id, quantity_delta, reason, created_by) "
                    "VALUES ($1::uuid, $2::uuid, $3, $4, $5)",
                    org_id, product_id, body.quantity_delta, body.reason, user["user_id"],
                )
                await stock_adjusted(
                    _conn, org_id=org_id, actor_id=user["user_id"],
                    product_id=product_id, product_name=product["name"],
                    quantity_before=quantity_before, quantity_after=quantity_after,
                )
    row = await pool.fetchrow(
        "SELECT * FROM staging.vikray_stock WHERE org_id=$1::uuid AND product_id=$2::uuid",
        org_id, product_id,
    )
    return dict(row)


@router.get("/stock/{product_id}/moves")
async def stock_moves(
    product_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT m.*, "
        # Creator only — and that is a schema fact, not an oversight. Migration
        # 201 deliberately SKIPPED this table: it is an append-only ledger where
        # a wrong movement is corrected by a counter-movement, never by editing
        # the row, so there is no `updated_by` to resolve and adding one would
        # invite exactly the in-place edit the ledger exists to forbid.
        + actor_select("m", updated=False)
        + "COUNT(*) OVER() AS _total FROM staging.vikray_stock_moves m "
        + actor_joins("m", updated=False)
        + "WHERE m.org_id=$1::uuid AND m.product_id=$2::uuid "
        "ORDER BY m.created_at DESC LIMIT 100",
        org_id, product_id,
    )
    # 100, the tightest cap in the codebase, on a ledger that grows with every
    # movement. A stock ledger truncated in the middle reads as a complete
    # history of a shorter period, which is worse than an obviously empty one.
    return _listed(rows, limit=100)


