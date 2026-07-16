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
        "SELECT o.*, c.company AS contact_company, c.name AS contact_name "
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
    return {"data": [dict(r) for r in rows]}


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
    body: OrderCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT status FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if not existing:
        raise HTTPException(404, "Order not found")
    if existing["status"] != "draft":
        raise HTTPException(400, "Only draft orders can be edited")
    items = [li.model_dump() for li in body.line_items]
    subtotal, cgst, sgst, igst, total = _compute_order_totals(items, body.discount, body.is_igst)
    row = await pool.fetchrow(
        "UPDATE staging.vikray_orders SET "
        "contact_id=NULLIF($1,'')::uuid, deal_id=NULLIF($2,'')::uuid, "
        "order_date=COALESCE(NULLIF($3,'')::date, order_date), "
        "expected_delivery=NULLIF($4,'')::date, "
        "line_items=$5::jsonb, subtotal=$6, cgst=$7, sgst=$8, igst=$9, "
        "discount=$10, total=$11, is_igst=$12, shipping_address=$13::jsonb, "
        "notes=$14, updated_at=NOW() "
        "WHERE id=$15::uuid AND org_id=$16::uuid RETURNING *",
        body.contact_id, body.deal_id, body.order_date, body.expected_delivery,
        json.dumps(items), subtotal, cgst, sgst, igst,
        body.discount, total, body.is_igst, json.dumps(body.shipping_address),
        body.notes, order_id, org_id,
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
        "SELECT status, deal_id FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
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
        "WHERE id=$2::uuid",
        inv["id"], order_id,
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
        "SELECT status FROM staging.vikray_orders WHERE id=$1::uuid AND org_id=$2::uuid",
        order_id, org_id,
    )
    if not existing:
        raise HTTPException(404, "Order not found")
    if existing["status"] not in ("draft", "confirmed"):
        raise HTTPException(400, "Only draft or confirmed orders can be cancelled")
    await pool.execute(
        "UPDATE staging.vikray_orders SET status='cancelled', is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid",
        order_id,
    )
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
        org_id, body.salesperson_id, body.period_start, body.period_end,
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
