"""
client_billing.py — Client Billing Profiles, Service Lines, Metered Usage,
and Auto-Invoice.

Proposal 87, phases P5.1 + P5.2 + P5.3.  Lives in its own router rather than
inside ganit.py (3,500 lines already).  Gate: any of ganit / graha / vikray —
a firm that holds any of those can manage its client billing.
"""
import logging
from datetime import date
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_any_module
from services.billing_cycle import next_anchor, period_end_for

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ganit/billing", tags=["client-billing"])

_gate = require_any_module("ganit", "graha", "vikray")
_vendor_gate = require_any_module("ganit", "kray")


# ── Pydantic models ──────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    client_id: str
    billing_cycle: str = "monthly"
    anchor_day: int = 1
    payment_terms_days: int = 30
    currency: str = "INR"
    gst_treatment: str = "registered"
    credit_limit: float | None = None
    notes: str = ""


class ProfileUpdate(BaseModel):
    billing_cycle: str | None = None
    anchor_day: int | None = None
    payment_terms_days: int | None = None
    currency: str | None = None
    gst_treatment: str | None = None
    credit_limit: float | None = None
    notes: str | None = None


class ServiceLineCreate(BaseModel):
    profile_id: str
    kind: str = "retainer"
    description: str = ""
    amount: float = 0
    cadence: str = "monthly"
    period_start: str
    period_end: str | None = None
    billing_direction: str = "advance"
    auto_invoice: bool = False


class ServiceLineUpdate(BaseModel):
    description: str | None = None
    amount: float | None = None
    period_end: str | None = None
    auto_invoice: bool | None = None


class MeteredUsageCreate(BaseModel):
    profile_id: str
    metric: str = ""
    quantity: float = 0
    unit: str = ""
    rate: float = 0
    recorded_date: str | None = None
    source_ref: str | None = None


class MeteredUsageUpdate(BaseModel):
    metric: str | None = None
    quantity: float | None = None
    unit: str | None = None
    rate: float | None = None
    recorded_date: str | None = None
    source_ref: str | None = None


class GenerateUsageInvoice(BaseModel):
    profile_id: str
    usage_ids: list[str] | None = None


class RateCardCreate(BaseModel):
    vendor_id: str
    item_category: str = ""
    rate: float = 0
    unit: str = ""
    effective_from: str | None = None
    effective_to: str | None = None
    proration_clause: bool = False
    notes: str = ""


class RateCardUpdate(BaseModel):
    item_category: str | None = None
    rate: float | None = None
    unit: str | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    proration_clause: bool | None = None
    notes: str | None = None


class SLACreditCreate(BaseModel):
    vendor_id: str
    rate_card_id: str | None = None
    sla_metric: str = ""
    threshold: float = 0
    actual: float = 0
    credit_amount: float = 0
    period: str
    status: str = "pending"


class SLACreditApply(BaseModel):
    bill_id: str


# ── Profiles CRUD ────────────────────────────────────────────────────────

@router.get("/profiles")
async def list_profiles(
    client_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT p.*, c.name AS client_name "
        "FROM staging.client_billing_profiles p "
        "JOIN staging.graha_clients c ON c.id = p.client_id "
        "WHERE p.org_id = $1::uuid"
    )
    params: list = [org_id]
    if client_id:
        params.append(client_id)
        q += f" AND p.client_id = ${len(params)}::uuid"
    q += " ORDER BY c.name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.get("/profiles/{profile_id}")
async def get_profile(
    profile_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT p.*, c.name AS client_name "
        "FROM staging.client_billing_profiles p "
        "JOIN staging.graha_clients c ON c.id = p.client_id "
        "WHERE p.id = $1::uuid AND p.org_id = $2::uuid",
        profile_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Billing profile not found")
    return dict(row)


@router.post("/profiles")
async def create_profile(
    body: ProfileCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchval(
        "SELECT id FROM staging.client_billing_profiles "
        "WHERE org_id = $1::uuid AND client_id = $2::uuid",
        org_id, body.client_id,
    )
    if existing:
        raise HTTPException(409, "Billing profile already exists for this client")
    row = await pool.fetchrow(
        "INSERT INTO staging.client_billing_profiles "
        "(org_id, client_id, billing_cycle, anchor_day, payment_terms_days, "
        " currency, gst_treatment, credit_limit, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::smallint, $5::int, $6, $7, $8, $9, $10) "
        "RETURNING *",
        org_id, body.client_id, body.billing_cycle, body.anchor_day,
        body.payment_terms_days, body.currency, body.gst_treatment,
        body.credit_limit, body.notes, user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/profiles/{profile_id}")
async def update_profile(
    profile_id: UUID,
    body: ProfileUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("billing_cycle", "anchor_day", "payment_terms_days",
                  "currency", "gst_treatment", "credit_limit", "notes"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            cast = "::smallint" if field == "anchor_day" else "::int" if field == "payment_terms_days" else ""
            updates.append(f"{field}=${len(vals)}{cast}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals.append(str(profile_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.client_billing_profiles SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Billing profile not found")
    return dict(row)


# ── Service Lines CRUD ───────────────────────────────────────────────────

@router.get("/service-lines")
async def list_service_lines(
    profile_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT sl.*, p.client_id, c.name AS client_name "
        "FROM staging.client_service_lines sl "
        "JOIN staging.client_billing_profiles p ON p.id = sl.profile_id "
        "JOIN staging.graha_clients c ON c.id = p.client_id "
        "WHERE sl.org_id = $1::uuid"
    )
    params: list = [org_id]
    if profile_id:
        params.append(profile_id)
        q += f" AND sl.profile_id = ${len(params)}::uuid"
    q += " ORDER BY sl.period_start DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/service-lines")
async def create_service_line(
    body: ServiceLineCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    profile = await pool.fetchrow(
        "SELECT id FROM staging.client_billing_profiles "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        body.profile_id, org_id,
    )
    if not profile:
        raise HTTPException(404, "Billing profile not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.client_service_lines "
        "(org_id, profile_id, kind, description, amount, cadence, "
        " period_start, period_end, billing_direction, auto_invoice, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11) "
        "RETURNING *",
        org_id, body.profile_id, body.kind, body.description,
        body.amount, body.cadence, body.period_start,
        body.period_end, body.billing_direction, body.auto_invoice,
        user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/service-lines/{line_id}")
async def update_service_line(
    line_id: UUID,
    body: ServiceLineUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("description", "amount", "period_end", "auto_invoice"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            cast = "::date" if field == "period_end" else ""
            updates.append(f"{field}=${len(vals)}{cast}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals.append(str(line_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.client_service_lines SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Service line not found")
    return dict(row)


# ── P5.2: Auto-Invoice Sweep ────────────────────────────────────────────

async def sweep_client_auto_invoices(today: date | None = None) -> dict:
    """Generate ganit_invoices for client_service_lines due today.

    Called from the billing cron.  For each auto_invoice line whose current
    period is due, creates a ganit_invoices row and a client_invoice_lines
    join row to prevent double-billing.
    """
    today = today or date.today()
    pool = await get_pool()

    lines = await pool.fetch(
        "SELECT sl.*, p.client_id, p.gst_treatment, p.anchor_day, "
        "       p.billing_cycle, p.payment_terms_days, p.currency, "
        "       c.name AS client_name "
        "FROM staging.client_service_lines sl "
        "JOIN staging.client_billing_profiles p ON p.id = sl.profile_id "
        "JOIN staging.graha_clients c ON c.id = p.client_id "
        "WHERE sl.auto_invoice = TRUE "
        "  AND sl.period_start <= $1::date "
        "  AND (sl.period_end IS NULL OR sl.period_end > $1::date)",
        today,
    )

    created = 0
    skipped = 0

    for sl in lines:
        anchor = sl["anchor_day"]
        cadence = sl["cadence"]
        if cadence == "one_off":
            period_start = sl["period_start"]
        else:
            period_start = next_anchor(anchor, sl["period_start"])

        if period_start > today:
            skipped += 1
            continue

        period_end = period_end_for(period_start, cadence) if cadence != "one_off" else period_start

        already = await pool.fetchval(
            "SELECT 1 FROM staging.client_invoice_lines "
            "WHERE line_id = $1::uuid AND period_start = $2::date",
            sl["id"], period_start,
        )
        if already:
            skipped += 1
            continue

        amount = float(sl["amount"])
        is_igst = sl["gst_treatment"] in ("overseas", "sez")
        gst_rate = 18
        gst_amount = round(amount * gst_rate / 100, 2)
        total = round(amount + gst_amount, 2)
        due_date = today + __import__("datetime").timedelta(days=sl["payment_terms_days"])

        invoice_id = uuid4()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO staging.ganit_invoices "
                    "(id, org_id, client_id, billing_profile_id, "
                    " invoice_date, due_date, subtotal, gst_rate, "
                    " cgst, sgst, igst, total, payment_status, "
                    " notes, created_by, is_igst) "
                    "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, "
                    "        $5::date, $6::date, $7, $8, "
                    "        $9, $10, $11, $12, 'unpaid', "
                    "        $13, 'system', $14)",
                    str(invoice_id), sl["org_id"], sl["client_id"],
                    sl["profile_id"],
                    today, due_date, amount, gst_rate,
                    0 if is_igst else round(gst_amount / 2, 2),
                    0 if is_igst else round(gst_amount / 2, 2),
                    gst_amount if is_igst else 0,
                    total,
                    f"Auto-invoice: {sl['description']} ({period_start} – {period_end})",
                    is_igst,
                )
                await conn.execute(
                    "INSERT INTO staging.client_invoice_lines "
                    "(invoice_id, line_id, period_start, amount) "
                    "VALUES ($1::uuid, $2::uuid, $3::date, $4)",
                    str(invoice_id), sl["id"], period_start, amount,
                )
        created += 1
        logger.info(
            "Auto-invoiced %s for %s: %s – %s, ₹%.2f",
            sl["client_name"], sl["description"], period_start, period_end, total,
        )

    return {"date": str(today), "created": created, "skipped": skipped}


# ── P5.3: Metered Usage CRUD ───────────────────────────────────────────

@router.get("/metered-usage")
async def list_metered_usage(
    profile_id: str = "",
    invoiced: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT u.*, p.client_id, c.name AS client_name "
        "FROM staging.client_metered_usage u "
        "JOIN staging.client_billing_profiles p ON p.id = u.profile_id "
        "JOIN staging.graha_clients c ON c.id = p.client_id "
        "WHERE u.org_id = $1::uuid"
    )
    params: list = [org_id]
    if profile_id:
        params.append(profile_id)
        q += f" AND u.profile_id = ${len(params)}::uuid"
    if invoiced in ("true", "false"):
        params.append(invoiced == "true")
        q += f" AND u.invoiced = ${len(params)}::bool"
    q += " ORDER BY u.recorded_date DESC, u.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/metered-usage")
async def create_metered_usage(
    body: MeteredUsageCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    profile = await pool.fetchrow(
        "SELECT id FROM staging.client_billing_profiles "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        body.profile_id, org_id,
    )
    if not profile:
        raise HTTPException(404, "Billing profile not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.client_metered_usage "
        "(org_id, profile_id, metric, quantity, unit, rate, "
        " recorded_date, source_ref, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, "
        "        COALESCE($7::date, CURRENT_DATE), $8, $9) "
        "RETURNING *",
        org_id, body.profile_id, body.metric, body.quantity,
        body.unit, body.rate, body.recorded_date,
        body.source_ref, user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/metered-usage/{usage_id}")
async def update_metered_usage(
    usage_id: UUID,
    body: MeteredUsageUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    already = await pool.fetchval(
        "SELECT invoiced FROM staging.client_metered_usage "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        usage_id, org_id,
    )
    if already is None:
        raise HTTPException(404, "Usage entry not found")
    if already:
        raise HTTPException(409, "Cannot edit usage that has already been invoiced")
    updates, vals = [], []
    for field in ("metric", "quantity", "unit", "rate", "recorded_date", "source_ref"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            cast = "::date" if field == "recorded_date" else ""
            updates.append(f"{field}=${len(vals)}{cast}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    vals.append(str(usage_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.client_metered_usage SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Usage entry not found")
    return dict(row)


@router.delete("/metered-usage/{usage_id}")
async def delete_metered_usage(
    usage_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT invoiced FROM staging.client_metered_usage "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        usage_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Usage entry not found")
    if row["invoiced"]:
        raise HTTPException(409, "Cannot delete usage that has already been invoiced")
    await pool.execute(
        "DELETE FROM staging.client_metered_usage "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        usage_id, org_id,
    )
    return {"ok": True}


# ── P5.3: Generate Invoice from Unbilled Usage ─────────────────────────

@router.post("/metered-usage/generate-invoice")
async def generate_usage_invoice(
    body: GenerateUsageInvoice,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Roll unbilled metered-usage rows into a draft ganit_invoices row."""
    pool = await get_pool()

    profile = await pool.fetchrow(
        "SELECT p.*, c.name AS client_name "
        "FROM staging.client_billing_profiles p "
        "JOIN staging.graha_clients c ON c.id = p.client_id "
        "WHERE p.id = $1::uuid AND p.org_id = $2::uuid",
        body.profile_id, org_id,
    )
    if not profile:
        raise HTTPException(404, "Billing profile not found")

    if body.usage_ids:
        placeholders = ", ".join(f"${i+3}::uuid" for i in range(len(body.usage_ids)))
        q = (
            f"SELECT * FROM staging.client_metered_usage "
            f"WHERE org_id = $1::uuid AND profile_id = $2::uuid "
            f"AND invoiced = FALSE AND id IN ({placeholders}) "
            f"ORDER BY recorded_date"
        )
        usage_rows = await pool.fetch(q, org_id, body.profile_id, *body.usage_ids)
    else:
        usage_rows = await pool.fetch(
            "SELECT * FROM staging.client_metered_usage "
            "WHERE org_id = $1::uuid AND profile_id = $2::uuid AND invoiced = FALSE "
            "ORDER BY recorded_date",
            org_id, body.profile_id,
        )

    if not usage_rows:
        raise HTTPException(400, "No unbilled usage entries to invoice")

    import json
    line_items = []
    subtotal = 0.0
    for u in usage_rows:
        amount = round(float(u["quantity"]) * float(u["rate"]), 2)
        line_items.append({
            "description": f"{u['metric']}: {u['quantity']} {u['unit']} @ {u['rate']}",
            "quantity": float(u["quantity"]),
            "rate": float(u["rate"]),
            "amount": amount,
        })
        subtotal += amount

    subtotal = round(subtotal, 2)
    is_igst = profile["gst_treatment"] in ("overseas", "sez")
    gst_rate = 18
    gst_amount = round(subtotal * gst_rate / 100, 2)
    total = round(subtotal + gst_amount, 2)
    today = date.today()
    due_date = today + __import__("datetime").timedelta(days=profile["payment_terms_days"])

    invoice_id = uuid4()
    usage_ids = [u["id"] for u in usage_rows]
    uid = user.get("user_id", "")

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO staging.ganit_invoices "
                "(id, org_id, client_id, billing_profile_id, "
                " invoice_date, due_date, line_items, subtotal, gst_rate, "
                " cgst, sgst, igst, total, payment_status, "
                " notes, created_by, is_igst) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, "
                "        $5::date, $6::date, $7::jsonb, $8, $9, "
                "        $10, $11, $12, $13, 'unpaid', "
                "        $14, $15, $16)",
                str(invoice_id), org_id, profile["client_id"],
                profile["id"],
                today, due_date, json.dumps(line_items), subtotal, gst_rate,
                0 if is_igst else round(gst_amount / 2, 2),
                0 if is_igst else round(gst_amount / 2, 2),
                gst_amount if is_igst else 0,
                total,
                f"Metered usage invoice for {profile['client_name']}",
                uid, is_igst,
            )
            placeholders = ", ".join(f"${i+2}::uuid" for i in range(len(usage_ids)))
            await conn.execute(
                f"UPDATE staging.client_metered_usage SET invoiced = TRUE "
                f"WHERE org_id = $1::uuid AND id IN ({placeholders})",
                org_id, *[str(uid) for uid in usage_ids],
            )

    logger.info(
        "Generated metered invoice %s for %s: %d entries, ₹%.2f",
        invoice_id, profile["client_name"], len(usage_rows), total,
    )
    return {
        "invoice_id": str(invoice_id),
        "entries": len(usage_rows),
        "subtotal": subtotal,
        "total": total,
    }


# ── P5.4: Vendor Rate Cards ─────────────────────────────────────────────

@router.get("/rate-cards")
async def list_rate_cards(
    vendor_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    q = (
        "SELECT rc.*, v.name AS vendor_name "
        "FROM staging.vendor_rate_cards rc "
        "JOIN staging.ganit_vendors v ON v.id = rc.vendor_id "
        "WHERE rc.org_id = $1::uuid"
    )
    params: list = [org_id]
    if vendor_id:
        params.append(vendor_id)
        q += f" AND rc.vendor_id = ${len(params)}::uuid"
    q += " ORDER BY rc.effective_from DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/rate-cards")
async def create_rate_card(
    body: RateCardCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    vendor = await pool.fetchrow(
        "SELECT id FROM staging.ganit_vendors WHERE id = $1::uuid AND org_id = $2::uuid",
        body.vendor_id, org_id,
    )
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.vendor_rate_cards "
        "(org_id, vendor_id, item_category, rate, unit, effective_from, "
        " effective_to, proration_clause, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, "
        "        COALESCE($6::date, CURRENT_DATE), $7::date, $8, $9, $10) "
        "RETURNING *",
        org_id, body.vendor_id, body.item_category, body.rate, body.unit,
        body.effective_from, body.effective_to, body.proration_clause,
        body.notes, user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/rate-cards/{card_id}")
async def update_rate_card(
    card_id: UUID,
    body: RateCardUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("item_category", "rate", "unit", "effective_from",
                  "effective_to", "proration_clause", "notes"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            cast = "::date" if field in ("effective_from", "effective_to") else ""
            updates.append(f"{field}=${len(vals)}{cast}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals.append(str(card_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.vendor_rate_cards SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Rate card not found")
    return dict(row)


# ── P5.4: SLA Credits ────────────────────────────────────────────────────

@router.get("/sla-credits")
async def list_sla_credits(
    vendor_id: str = "",
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    q = (
        "SELECT sc.*, v.name AS vendor_name "
        "FROM staging.vendor_sla_credits sc "
        "JOIN staging.ganit_vendors v ON v.id = sc.vendor_id "
        "WHERE sc.org_id = $1::uuid"
    )
    params: list = [org_id]
    if vendor_id:
        params.append(vendor_id)
        q += f" AND sc.vendor_id = ${len(params)}::uuid"
    if status:
        params.append(status)
        q += f" AND sc.status = ${len(params)}"
    q += " ORDER BY sc.period DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/sla-credits")
async def create_sla_credit(
    body: SLACreditCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    vendor = await pool.fetchrow(
        "SELECT id FROM staging.ganit_vendors WHERE id = $1::uuid AND org_id = $2::uuid",
        body.vendor_id, org_id,
    )
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.vendor_sla_credits "
        "(org_id, vendor_id, rate_card_id, sla_metric, threshold, actual, "
        " credit_amount, period, status, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, "
        "        $7, $8::date, $9, $10) "
        "RETURNING *",
        org_id, body.vendor_id, body.rate_card_id, body.sla_metric,
        body.threshold, body.actual, body.credit_amount, body.period,
        body.status, user.get("user_id", ""),
    )
    return dict(row)


@router.post("/sla-credits/{credit_id}/apply")
async def apply_sla_credit(
    credit_id: UUID,
    body: SLACreditApply,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            credit = await conn.fetchrow(
                "SELECT * FROM staging.vendor_sla_credits "
                "WHERE id = $1::uuid AND org_id = $2::uuid",
                credit_id, org_id,
            )
            if not credit:
                raise HTTPException(404, "SLA credit not found")
            if credit["status"] != "pending":
                raise HTTPException(409, "SLA credit is not pending")
            bill = await conn.fetchrow(
                "SELECT id FROM staging.ganit_vendor_bills "
                "WHERE id = $1::uuid AND org_id = $2::uuid",
                body.bill_id, org_id,
            )
            if not bill:
                raise HTTPException(404, "Vendor bill not found")
            row = await conn.fetchrow(
                "UPDATE staging.vendor_sla_credits "
                "SET status = 'applied', applied_to_bill = $1::uuid "
                "WHERE id = $2::uuid AND org_id = $3::uuid RETURNING *",
                body.bill_id, credit_id, org_id,
            )
            await conn.execute(
                "UPDATE staging.ganit_vendor_bills "
                "SET sla_credit_applied = COALESCE(sla_credit_applied, 0) + $1 "
                "WHERE id = $2::uuid AND org_id = $3::uuid",
                float(credit["credit_amount"]), body.bill_id, org_id,
            )
    return dict(row)


@router.patch("/sla-credits/{credit_id}/waive")
async def waive_sla_credit(
    credit_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE staging.vendor_sla_credits SET status = 'waived' "
        "WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'pending' "
        "RETURNING *",
        credit_id, org_id,
    )
    if not row:
        raise HTTPException(404, "SLA credit not found or not pending")
    return dict(row)


# ── P5.5: Payment Ageing ────────────────────────────────────────────────

def _ageing_bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "30"
    if days_overdue <= 60:
        return "60"
    if days_overdue <= 90:
        return "90"
    if days_overdue <= 120:
        return "120"
    return "120+"


@router.get("/ageing")
async def payment_ageing(
    direction: str = "receivable",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if direction not in ("receivable", "payable"):
        raise HTTPException(400, "direction must be 'receivable' or 'payable'")
    pool = await get_pool()
    today = date.today()

    if direction == "receivable":
        rows = await pool.fetch(
            "SELECT i.id, i.total, i.amount_paid, i.due_date, "
            "       c.id AS party_id, c.name AS party_name "
            "FROM staging.ganit_invoices i "
            "JOIN staging.graha_clients c ON c.id = i.client_id "
            "WHERE i.org_id = $1::uuid AND i.payment_status != 'paid'",
            org_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT b.id, b.total, b.amount_paid, b.due_date, "
            "       v.id AS party_id, v.name AS party_name "
            "FROM staging.ganit_vendor_bills b "
            "JOIN staging.ganit_vendors v ON v.id = b.vendor_id "
            "WHERE b.org_id = $1::uuid AND b.status != 'paid'",
            org_id,
        )

    totals = {"current": 0.0, "30": 0.0, "60": 0.0, "90": 0.0, "120": 0.0, "120+": 0.0}
    by_client: dict[str, dict] = {}
    for r in rows:
        outstanding = float(r["total"] or 0) - float(r["amount_paid"] or 0)
        if outstanding <= 0:
            continue
        due = r["due_date"] or today
        days_overdue = (today - due).days
        bucket = _ageing_bucket(days_overdue)
        totals[bucket] += outstanding

        party_id = str(r["party_id"])
        entry = by_client.setdefault(party_id, {
            "party_id": party_id,
            "party_name": r["party_name"],
            "current": 0.0, "30": 0.0, "60": 0.0, "90": 0.0, "120": 0.0, "120+": 0.0,
            "total_outstanding": 0.0,
        })
        entry[bucket] += outstanding
        entry["total_outstanding"] += outstanding

    return {
        "direction": direction,
        "buckets": ["current", "30", "60", "90", "120", "120+"],
        "by_client": list(by_client.values()),
        "totals": totals,
    }


# ── P5.5: Sales Quota Proration ─────────────────────────────────────────

@router.get("/quota-proration")
async def quota_proration(
    target: float,
    start_date: str,
    end_date: str,
    join_date: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(require_any_module("ganit", "vikray")),
):
    try:
        period_start = date.fromisoformat(start_date)
        period_end = date.fromisoformat(end_date)
        joined = date.fromisoformat(join_date)
    except ValueError:
        raise HTTPException(400, "Dates must be ISO format (YYYY-MM-DD)")
    if period_end <= period_start:
        raise HTTPException(400, "end_date must be after start_date")

    working_days_total = 0
    working_days_active = 0
    d = period_start
    while d < period_end:
        if d.weekday() < 5:
            working_days_total += 1
            if d >= joined:
                working_days_active += 1
        d += __import__("datetime").timedelta(days=1)

    ratio = (working_days_active / working_days_total) if working_days_total else 0.0
    prorated_target = round(target * ratio, 2)

    return {
        "full_target": target,
        "prorated_target": prorated_target,
        "ratio": round(ratio, 4),
        "working_days_total": working_days_total,
        "working_days_active": working_days_active,
    }
