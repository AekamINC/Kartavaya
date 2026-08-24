"""
client_billing.py — Client Billing Profiles, Service Lines, and Auto-Invoice.

Proposal 87, phases P5.1 + P5.2.  Lives in its own router rather than inside
ganit.py (3,500 lines already).  Gate: any of ganit / graha / vikray — a firm
that holds any of those can manage its client billing.
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
