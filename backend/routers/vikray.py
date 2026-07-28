"""
vikray.py — Vikray · विक्रय (Sales) Router
Sales orders, targets, and dashboard. Reads Graha (CRM) + Ganit (Invoicing) directly.
"""
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
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
    deal_id: str = ""
    order_date: str = ""
    expected_delivery: str = ""
    is_igst: bool = False
    line_items: list[OrderLineItem]
    discount: float = 0
    shipping_address: dict = {}
    notes: str = ""


class OrderStatusUpdate(BaseModel):
    status: str


class OrderUpdate(BaseModel):
    contact_id: Optional[str] = None
    order_date: Optional[str] = None
    expected_delivery: Optional[str] = None
    is_igst: Optional[bool] = None
    line_items: Optional[list[OrderLineItem]] = None
    discount: Optional[float] = None
    shipping_address: Optional[dict] = None
    notes: Optional[str] = None


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
    subtotal = 0
    total_tax = 0
    for item in line_items:
        qty = item.get("quantity", 1)
        rate = item.get("rate", 0)
        disc = item.get("discount_pct", 0)
        line_total = qty * rate * (1 - disc / 100)
        gst = item.get("gst_rate", 18) / 100
        subtotal += line_total
        total_tax += line_total * gst
    subtotal_after_disc = subtotal - discount
    if is_igst:
        return subtotal_after_disc, 0, 0, total_tax, subtotal_after_disc + total_tax
    half = round(total_tax / 2, 2)
    return subtotal_after_disc, half, total_tax - half, 0, subtotal_after_disc + total_tax

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
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT o.*, c.company AS contact_company, c.name AS contact_name, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.vikray_orders o "
        "LEFT JOIN staging.graha_contacts c ON c.id = o.contact_id "
        "WHERE o.org_id=$1::uuid AND o.is_active=TRUE"
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND o.status=${len(params)}"
    if contact_id:
        params.append(contact_id)
        q += f" AND o.contact_id=${len(params)}::uuid"
    q += " ORDER BY o.created_at DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=200)


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
    subtotal, cgst, sgst, igst, total = _compute_order_totals(items, body.discount, body.is_igst)
    row = await pool.fetchrow(
        "INSERT INTO staging.vikray_orders "
        "(org_id, contact_id, deal_id, order_number, order_date, expected_delivery, "
        "line_items, subtotal, cgst, sgst, igst, discount, total, is_igst, "
        "shipping_address, notes, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, "
        "COALESCE(NULLIF($5,'')::date, CURRENT_DATE), NULLIF($6,'')::date, "
        "$7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17) "
        "RETURNING *",
        org_id, body.contact_id, body.deal_id, order_number,
        body.order_date, body.expected_delivery,
        json.dumps(items), subtotal, cgst, sgst, igst, body.discount, total, body.is_igst,
        json.dumps(body.shipping_address), body.notes, user["user_id"],
    )
    return dict(row)


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
        "c.email AS contact_email, c.phone AS contact_phone "
        "FROM staging.vikray_orders o "
        "LEFT JOIN staging.graha_contacts c ON c.id = o.contact_id "
        "WHERE o.id=$1::uuid AND o.org_id=$2::uuid",
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

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "line_items" in updates and updates["line_items"] is not None:
        items = [li.model_dump() for li in body.line_items]
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
        if k == "contact_id":
            sets.append(f"{k}=NULLIF(${idx},'')::uuid")
            params.append(v)
        elif k in ("order_date", "expected_delivery"):
            sets.append(f"{k}=${idx}::date")
            params.append(date.fromisoformat(v) if v else None)
        elif k == "line_items":
            sets.append(f"{k}=${idx}::jsonb")
            params.append(v)
        elif k == "shipping_address":
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v) if v else "{}")
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

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
    row = await pool.fetchrow(
        "UPDATE staging.vikray_orders SET status=$1, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid RETURNING *",
        body.status, order_id, org_id,
    )
    if body.status == "confirmed":
        await _apply_stock_moves(pool, org_id, order_id, existing["line_items"], -1, "order_confirmed", user["user_id"])
    elif body.status == "cancelled" and existing["status"] == "confirmed":
        await _apply_stock_moves(pool, org_id, order_id, existing["line_items"], 1, "order_cancelled", user["user_id"])
    if body.status == "closed" and existing["deal_id"]:
        await pool.execute(
            "UPDATE staging.graha_deals SET stage='Won', updated_at=NOW() "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(existing["deal_id"]), org_id,
        )
    return dict(row)


@router.post("/orders/{order_id}/invoice")
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
    inv_number = await next_doc_number(pool, org_id, "ganit_invoices", "invoice_number", "INV")
    inv = await pool.fetchrow(
        "INSERT INTO staging.ganit_invoices "
        "(org_id, contact_id, invoice_number, invoice_type, invoice_date, "
        "place_of_supply, is_igst, line_items, subtotal, cgst, sgst, igst, "
        "discount, total, notes, created_by) "
        "VALUES ($1::uuid, $2, $3, 'tax_invoice', CURRENT_DATE, '', $4, "
        "$5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id",
        org_id, order["contact_id"], inv_number, order["is_igst"],
        json.dumps(order["line_items"] if isinstance(order["line_items"], list) else json.loads(order["line_items"])),
        order["subtotal"], order["cgst"], order["sgst"], order["igst"],
        order["discount"], order["total"], f"Generated from order {order['order_number']}",
        user["user_id"],
    )
    await pool.execute(
        "UPDATE staging.vikray_orders SET invoice_id=$1, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid",
        inv["id"], order_id, org_id,
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
    await pool.execute(
        "UPDATE staging.vikray_orders SET status='cancelled', is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if existing["status"] == "confirmed":
        await _apply_stock_moves(pool, org_id, order_id, existing["line_items"], 1, "order_cancelled", user["user_id"])
    return {"ok": True}


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
        "VALUES ($1::uuid, $2::uuid, $3::date, $4::date, $5, $6, $7, $8) "
        "ON CONFLICT (org_id, salesperson_id, period_start) DO UPDATE SET "
        "target_amount=EXCLUDED.target_amount, target_deals=EXCLUDED.target_deals, notes=EXCLUDED.notes "
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
        "COALESCE(u.full_name, u.name, u.email) AS salesperson_name, "
        "COALESCE(d.won_amount, 0) AS actual_amount, "
        "COALESCE(d.won_deals, 0) AS actual_deals "
        "FROM staging.vikray_targets t "
        "LEFT JOIN users u ON u.user_id = t.salesperson_id::text "
        "LEFT JOIN LATERAL ("
        "  SELECT COALESCE(SUM(value),0) AS won_amount, COUNT(*) AS won_deals "
        "  FROM staging.graha_deals "
        "  WHERE org_id=$1::uuid AND stage='Won' "
        "    AND owner_id = t.salesperson_id "
        "    AND updated_at >= t.period_start AND updated_at < t.period_end + 1 "
        ") d ON TRUE "
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
        "COALESCE(u.full_name, u.name, u.email) AS salesperson_name, "
        "t.target_amount, "
        "COALESCE(d.won_amount, 0) AS actual_amount, "
        "CASE WHEN t.target_amount > 0 "
        "  THEN ROUND(COALESCE(d.won_amount,0) / t.target_amount * 100, 1) "
        "  ELSE 0 END AS achievement_pct "
        "FROM staging.vikray_targets t "
        "LEFT JOIN users u ON u.user_id = t.salesperson_id::text "
        "LEFT JOIN LATERAL ("
        "  SELECT COALESCE(SUM(value),0) AS won_amount "
        "  FROM staging.graha_deals "
        "  WHERE org_id=$1::uuid AND stage='Won' "
        "    AND owner_id = t.salesperson_id "
        "    AND updated_at >= t.period_start AND updated_at < t.period_end + 1 "
        ") d ON TRUE "
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
        "COALESCE(u.full_name, u.name, u.email) AS owner_name "
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
# This is the sales ledger's view of a party — how much they have ordered, when
# they last did, and what is still open — derived entirely by grouping THIS
# module's `vikray_orders`. It is not a second CRM contact list: a contact who
# has never placed an order does not appear, and none of Graha's CRM columns
# (lead_score, lead_score_reasons, assigned_to, source, tags, notes,
# last_contacted_at) are selected. The identifying fields that are returned —
# name, company, gstin, email, phone — are the ones `GET /orders/{id}` already
# returns behind this same gate.


@router.get("/customers")
async def list_customers(
    q: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    sql = (
        "SELECT o.contact_id, "
        "c.name AS contact_name, c.company AS contact_company, "
        "c.gstin, c.email, c.phone, "
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
        "WHERE o.org_id=$1::uuid AND o.is_active=TRUE AND o.contact_id IS NOT NULL"
    )
    params: list = [org_id]
    if q:
        params.append(f"%{q}%")
        sql += f" AND (c.name ILIKE ${len(params)} OR c.company ILIKE ${len(params)})"
    sql += (
        " GROUP BY o.contact_id, c.name, c.company, c.gstin, c.email, c.phone "
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
        "SELECT id FROM staging.ganit_products WHERE id=$1::uuid AND org_id=$2::uuid",
        product_id, org_id,
    )
    if not product:
        raise HTTPException(404, "Product not found")

    await pool.execute(
        "INSERT INTO staging.vikray_stock (org_id, product_id, low_stock_threshold) "
        "VALUES ($1::uuid, $2::uuid, COALESCE($3, 0)) "
        "ON CONFLICT (org_id, product_id) DO UPDATE SET "
        "low_stock_threshold = COALESCE($3, staging.vikray_stock.low_stock_threshold), updated_at=NOW()",
        org_id, product_id, body.low_stock_threshold,
    )
    if body.quantity_delta:
        await pool.execute(
            "UPDATE staging.vikray_stock SET quantity_on_hand = quantity_on_hand + $1, updated_at=NOW() "
            "WHERE org_id=$2::uuid AND product_id=$3::uuid",
            body.quantity_delta, org_id, product_id,
        )
        await pool.execute(
            "INSERT INTO staging.vikray_stock_moves (org_id, product_id, quantity_delta, reason, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3, $4, $5)",
            org_id, product_id, body.quantity_delta, body.reason, user["user_id"],
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
        "SELECT *, COUNT(*) OVER() AS _total FROM staging.vikray_stock_moves "
        "WHERE org_id=$1::uuid AND product_id=$2::uuid ORDER BY created_at DESC LIMIT 100",
        org_id, product_id,
    )
    # 100, the tightest cap in the codebase, on a ledger that grows with every
    # movement. A stock ledger truncated in the middle reads as a complete
    # history of a shorter period, which is worse than an obviously empty one.
    return _listed(rows, limit=100)


