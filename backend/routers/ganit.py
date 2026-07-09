"""
ganit.py — Ganit · गणित (GST Invoicing) Router
GST-compliant invoicing with HSN/SAC codes, CGST/SGST/IGST calculations.
Depends on Graha (CRM) for contacts.
"""
import json
import math
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

router = APIRouter(prefix="/api/v1/ganit", tags=["ganit-invoicing"])

_gate = require_module("ganit")


# ── Pydantic Models ──────────────────────────────────────────

class LineItem(BaseModel):
    product_id: str = ""
    description: str
    hsn_code: str = ""
    sac_code: str = ""
    quantity: float = 1
    unit: str = "NOS"
    rate: float = 0
    gst_rate: float = 18.0
    discount_pct: float = 0


class ProductCreate(BaseModel):
    name: str
    hsn_code: str = ""
    sac_code: str = ""
    unit: str = "NOS"
    price: float = 0
    gst_rate: float = 18.0
    description: str = ""
    is_service: bool = False


class ProductUpdate(BaseModel):
    name: str | None = None
    hsn_code: str | None = None
    sac_code: str | None = None
    unit: str | None = None
    price: float | None = None
    gst_rate: float | None = None
    description: str | None = None
    is_service: bool | None = None


class InvoiceCreate(BaseModel):
    contact_id: str = ""
    deal_id: str = ""
    invoice_type: str = "tax_invoice"
    invoice_date: str = ""
    due_date: str = ""
    place_of_supply: str = ""
    is_igst: bool = False
    line_items: list[LineItem]
    discount: float = 0
    notes: str = ""
    terms: str = ""


class PaymentRecord(BaseModel):
    amount: float
    payment_date: str = ""
    payment_method: str = "bank_transfer"
    reference: str = ""
    notes: str = ""


# ── Helper: compute GST breakdown ───────────────────────────

def _compute_invoice(items: list[LineItem], is_igst: bool, flat_discount: float = 0):
    subtotal = 0
    cgst = 0
    sgst = 0
    igst = 0
    computed_items = []

    for item in items:
        line_total = item.quantity * item.rate
        if item.discount_pct > 0:
            line_total *= (1 - item.discount_pct / 100)
        line_total = round(line_total, 2)

        gst_amount = round(line_total * item.gst_rate / 100, 2)
        if is_igst:
            igst += gst_amount
        else:
            cgst += round(gst_amount / 2, 2)
            sgst += round(gst_amount / 2, 2)

        subtotal += line_total
        computed_items.append({
            "description": item.description,
            "product_id": item.product_id,
            "hsn_code": item.hsn_code,
            "sac_code": item.sac_code,
            "quantity": item.quantity,
            "unit": item.unit,
            "rate": item.rate,
            "gst_rate": item.gst_rate,
            "discount_pct": item.discount_pct,
            "line_total": line_total,
            "gst_amount": gst_amount,
        })

    total = round(subtotal + cgst + sgst + igst - flat_discount, 2)
    return {
        "line_items": computed_items,
        "subtotal": round(subtotal, 2),
        "cgst": round(cgst, 2),
        "sgst": round(sgst, 2),
        "igst": round(igst, 2),
        "discount": round(flat_discount, 2),
        "total": total,
    }


# ── Invoice Number Generation ───────────────────────────────

async def _next_invoice_number(pool, org_id: str, prefix: str = "INV") -> str:
    last = await pool.fetchval(
        "SELECT invoice_number FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid ORDER BY created_at DESC LIMIT 1",
        org_id,
    )
    if last:
        parts = last.rsplit("-", 1)
        num = int(parts[-1]) + 1 if len(parts) == 2 and parts[-1].isdigit() else 1
    else:
        num = 1
    fy = datetime.now().year
    return f"{prefix}-{fy}-{num:04d}"


# ── Products / Services ─────────────────────────────────────

@router.get("/products")
async def list_products(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, hsn_code, sac_code, unit, price, gst_rate, "
        "description, is_service, created_at "
        "FROM staging.ganit_products WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/products")
async def create_product(
    body: ProductCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_products "
        "(org_id, name, hsn_code, sac_code, unit, price, gst_rate, description, is_service) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name",
        org_id, body.name, body.hsn_code, body.sac_code, body.unit,
        body.price, body.gst_rate, body.description, body.is_service,
    )
    return {"status": "created", **dict(row)}


@router.patch("/products/{product_id}")
async def update_product(
    product_id: UUID,
    body: ProductUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    sets = []
    params = [str(product_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.ganit_products SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.ganit_products SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        str(product_id), org_id,
    )
    return {"status": "deleted"}


# ── Invoices ─────────────────────────────────────────────────

@router.get("/invoices")
async def list_invoices(
    invoice_type: Optional[str] = None,
    payment_status: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.due_date, "
        "i.subtotal, i.cgst, i.sgst, i.igst, i.total, i.amount_paid, i.balance_due, "
        "i.payment_status, i.created_at, "
        "c.name as contact_name, c.company as contact_company "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.org_id=$1::uuid AND i.is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if invoice_type:
        query += f"AND i.invoice_type=${idx} "
        params.append(invoice_type)
        idx += 1

    if payment_status:
        query += f"AND i.payment_status=${idx} "
        params.append(payment_status)
        idx += 1

    query += "ORDER BY i.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/invoices")
async def create_invoice(
    body: InvoiceCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    if not body.line_items:
        raise HTTPException(400, "At least one line item is required")

    valid_types = ("tax_invoice", "proforma", "credit_note", "debit_note", "quotation")
    if body.invoice_type not in valid_types:
        raise HTTPException(400, f"invoice_type must be one of: {', '.join(valid_types)}")

    computed = _compute_invoice(body.line_items, body.is_igst, body.discount)

    prefix_map = {"tax_invoice": "INV", "proforma": "PI", "credit_note": "CN",
                  "debit_note": "DN", "quotation": "QTN"}
    inv_number = await _next_invoice_number(pool, org_id, prefix_map.get(body.invoice_type, "INV"))

    inv_date = body.invoice_date or date.today().isoformat()
    due = body.due_date or None

    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_invoices "
        "(org_id, contact_id, deal_id, invoice_number, invoice_type, invoice_date, due_date, "
        " place_of_supply, is_igst, line_items, subtotal, cgst, sgst, igst, discount, total, "
        " balance_due, notes, terms, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6::date, $7::date, "
        " $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $16, $17, $18, $19) "
        "RETURNING id, invoice_number, total",
        org_id, body.contact_id, body.deal_id, inv_number, body.invoice_type,
        inv_date, due, body.place_of_supply, body.is_igst,
        json.dumps(computed["line_items"]),
        computed["subtotal"], computed["cgst"], computed["sgst"], computed["igst"],
        computed["discount"], computed["total"],
        body.notes, body.terms, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.get("/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT i.*, c.name as contact_name, c.email as contact_email, "
        "c.company as contact_company, c.gstin as contact_gstin, "
        "c.billing_address as contact_billing_address "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.id=$1::uuid AND i.org_id=$2::uuid",
        str(invoice_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Invoice not found")

    payments = await pool.fetch(
        "SELECT id, amount, payment_date, payment_method, reference, notes, created_at "
        "FROM staging.ganit_payments WHERE invoice_id=$1::uuid ORDER BY payment_date",
        str(invoice_id),
    )
    return {"invoice": dict(row), "payments": [dict(p) for p in payments]}


@router.post("/invoices/{invoice_id}/cancel")
async def cancel_invoice(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.ganit_invoices SET payment_status='cancelled', "
        "cancelled_at=NOW(), updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND payment_status NOT IN ('paid','cancelled')",
        str(invoice_id), org_id,
    )
    return {"status": "cancelled"}


# ── Payments ─────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/payments")
async def record_payment(
    invoice_id: UUID,
    body: PaymentRecord,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    inv = await pool.fetchrow(
        "SELECT total, amount_paid, payment_status FROM staging.ganit_invoices "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(invoice_id), org_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["payment_status"] in ("paid", "cancelled"):
        raise HTTPException(400, f"Cannot record payment: invoice is {inv['payment_status']}")

    pay_date = body.payment_date or date.today().isoformat()

    await pool.execute(
        "INSERT INTO staging.ganit_payments "
        "(org_id, invoice_id, amount, payment_date, payment_method, reference, notes, recorded_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $6, $7, $8)",
        org_id, str(invoice_id), body.amount, pay_date,
        body.payment_method, body.reference, body.notes, user["user_id"],
    )

    new_paid = float(inv["amount_paid"]) + body.amount
    new_balance = float(inv["total"]) - new_paid
    new_status = "paid" if new_balance <= 0 else "partial"

    await pool.execute(
        "UPDATE staging.ganit_invoices SET amount_paid=$1, balance_due=$2, "
        "payment_status=$3, updated_at=NOW() WHERE id=$4::uuid",
        round(new_paid, 2), round(max(new_balance, 0), 2), new_status, str(invoice_id),
    )
    return {"status": new_status, "amount_paid": round(new_paid, 2), "balance_due": round(max(new_balance, 0), 2)}


# ── Dashboard Stats ──────────────────────────────────────────

@router.get("/stats")
async def invoice_stats(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    totals = await pool.fetchrow(
        "SELECT "
        "  COUNT(*) FILTER (WHERE payment_status='unpaid') as unpaid_count, "
        "  COALESCE(SUM(balance_due) FILTER (WHERE payment_status IN ('unpaid','partial','overdue')),0) as total_outstanding, "
        "  COALESCE(SUM(total) FILTER (WHERE payment_status='paid'),0) as total_collected, "
        "  COUNT(*) FILTER (WHERE payment_status='overdue') as overdue_count, "
        "  COUNT(*) as total_invoices "
        "FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND invoice_type='tax_invoice'",
        org_id,
    )
    return dict(totals)
