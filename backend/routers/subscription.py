"""
subscription.py — Subscription & Billing Router
Plan management, manual billing by admin, module activation/deactivation.
All queries use raw asyncpg matching the existing codebase pattern.
"""
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_platform_role
from middleware.subscription import clear_module_cache

router = APIRouter(prefix="/api/v1/subscription", tags=["subscription"])


# ── Pydantic Models ──────────────────────────────────────────

class ModuleAction(BaseModel):
    module_code: str

class PlanChange(BaseModel):
    plan_code: str
    billing_cycle: str = "monthly"
    notes: str = ""

class InvoiceCreate(BaseModel):
    period_start: date
    period_end: date
    due_date: date
    line_items: list[dict]
    notes: str = ""

class RecordPayment(BaseModel):
    payment_method: str
    payment_reference: str
    paid_at: Optional[datetime] = None


# ── Helpers ──────────────────────────────────────────────────

async def _log_event(pool, org_id: str, event_type: str, metadata: dict):
    await pool.execute(
        "INSERT INTO staging.subscription_events (org_id, event_type, metadata) "
        "VALUES ($1::uuid, $2, $3::jsonb)",
        org_id, event_type, json.dumps(metadata),
    )


# ── Public ───────────────────────────────────────────────────

@router.get("/plans")
async def list_plans(user=Depends(require_user)):
    """List available plans. Pricing is only visible to admins."""
    pool = await get_pool()
    plans = await pool.fetch(
        "SELECT * FROM staging.plans WHERE is_active=TRUE ORDER BY price_monthly"
    )
    modules = await pool.fetch(
        "SELECT * FROM staging.add_on_modules WHERE is_active=TRUE ORDER BY price_per_user_monthly"
    )

    is_admin = user.get("role") == "admin"
    plan_list = []
    for r in plans:
        p = dict(r)
        if not is_admin:
            p.pop("price_monthly", None)
            p.pop("price_annual", None)
        plan_list.append(p)

    mod_list = []
    for r in modules:
        m = dict(r)
        if not is_admin:
            m.pop("price_per_user_monthly", None)
        mod_list.append(m)

    return {"plans": plan_list, "modules": mod_list}


# ── Current Subscription ─────────────────────────────────────

@router.get("/current")
async def get_current(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    pool = await get_pool()
    sub = await pool.fetchrow(
        "SELECT s.*, p.name as plan_name, p.code as plan_code, "
        "p.max_users, p.features "
        "FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    modules = await pool.fetch(
        "SELECT module_code FROM staging.module_subscriptions "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    user_count = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id=$1::uuid "
        "AND role_code IN ('org_owner','org_admin','org_member')",
        org_id,
    )
    return {
        "subscription": dict(sub) if sub else None,
        "active_modules": [r["module_code"] for r in modules],
        "user_count": user_count or 0,
    }


# ── Admin: Plan Management ───────────────────────────────────

@router.post("/admin/set-plan")
async def admin_set_plan(
    body: PlanChange,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    plan = await pool.fetchrow(
        "SELECT id, code FROM staging.plans WHERE code=$1 AND is_active=TRUE",
        body.plan_code,
    )
    if not plan:
        raise HTTPException(400, "Invalid plan code")

    current = await pool.fetchrow(
        "SELECT p.code FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    old_code = current["code"] if current else "none"

    tier = {"none": -1, "free": 0, "starter": 1, "growth": 2, "scale": 3,
            "professional": 1, "business": 2, "enterprise": 3}
    direction = "upgraded" if tier.get(body.plan_code, 0) > tier.get(old_code, 0) else "downgraded"

    cycle_days = 30 if body.billing_cycle == "monthly" else 365
    now = datetime.now(timezone.utc)
    period_end = date.today() + timedelta(days=cycle_days)

    await pool.execute(
        "INSERT INTO staging.subscriptions "
        "(org_id, plan_id, billing_cycle, status, activated_by, notes, "
        " current_period_start, current_period_end, next_billing_date, updated_at) "
        "VALUES ($1::uuid, $2, $3, 'active', $4, $5, $6, $7, $7, $8) "
        "ON CONFLICT (org_id) DO UPDATE SET "
        "plan_id=EXCLUDED.plan_id, billing_cycle=EXCLUDED.billing_cycle, "
        "status='active', activated_by=EXCLUDED.activated_by, notes=EXCLUDED.notes, "
        "current_period_start=EXCLUDED.current_period_start, "
        "current_period_end=EXCLUDED.current_period_end, "
        "next_billing_date=EXCLUDED.next_billing_date, updated_at=EXCLUDED.updated_at",
        org_id, plan["id"], body.billing_cycle,
        user["user_id"], body.notes,
        date.today(), period_end, now,
    )

    if body.plan_code == "free":
        await pool.execute(
            "UPDATE staging.module_subscriptions SET is_active=FALSE, "
            "deactivated_at=NOW() WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
        clear_module_cache(org_id)

    await _log_event(pool, org_id, direction, {
        "from": old_code, "to": body.plan_code,
        "set_by": user["user_id"], "notes": body.notes,
    })
    return {"status": direction, "plan": body.plan_code}


# ── Module Activation ────────────────────────────────────────

@router.post("/modules/activate")
async def activate_module(
    body: ModuleAction,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    from middleware.subscription import BUNDLED_MODULES
    if body.module_code in BUNDLED_MODULES:
        raise HTTPException(400, f"'{body.module_code}' is bundled with every plan — no activation needed")

    sub = await pool.fetchrow(
        "SELECT p.code FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    if not sub or sub["code"] == "free":
        raise HTTPException(403, "Add-on modules require a paid plan")

    mod = await pool.fetchrow(
        "SELECT code, requires_module FROM staging.add_on_modules WHERE code=$1 AND is_active=TRUE",
        body.module_code,
    )
    if not mod:
        raise HTTPException(400, "Invalid module code")

    for dep in (mod["requires_module"] or []):
        dep_active = await pool.fetchval(
            "SELECT 1 FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
            org_id, dep,
        )
        if not dep_active:
            raise HTTPException(400, f"Module '{body.module_code}' requires '{dep}' to be active first")

    await pool.execute(
        "INSERT INTO staging.module_subscriptions (org_id, module_code, is_active, activated_at) "
        "VALUES ($1::uuid, $2, TRUE, NOW()) "
        "ON CONFLICT (org_id, module_code) DO UPDATE SET "
        "is_active=TRUE, activated_at=NOW(), deactivated_at=NULL",
        org_id, body.module_code,
    )
    clear_module_cache(org_id)

    await _log_event(pool, org_id, "module_added", {
        "module": body.module_code, "by": user["user_id"],
    })
    return {"status": "activated", "module": body.module_code}


@router.post("/modules/deactivate")
async def deactivate_module(
    body: ModuleAction,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    all_modules = await pool.fetch(
        "SELECT code, requires_module FROM staging.add_on_modules"
    )
    active_codes = {
        r["module_code"] for r in await pool.fetch(
            "SELECT module_code FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
    }

    for m in all_modules:
        if m["code"] in active_codes and body.module_code in (m["requires_module"] or []):
            raise HTTPException(
                400,
                f"Cannot deactivate '{body.module_code}': module '{m['code']}' depends on it. "
                f"Deactivate '{m['code']}' first.",
            )

    await pool.execute(
        "UPDATE staging.module_subscriptions SET is_active=FALSE, deactivated_at=NOW() "
        "WHERE org_id=$1::uuid AND module_code=$2",
        org_id, body.module_code,
    )
    clear_module_cache(org_id)

    await _log_event(pool, org_id, "module_removed", {
        "module": body.module_code, "by": user["user_id"],
    })
    return {"status": "deactivated", "module": body.module_code}


# ── Admin: Invoice Management ────────────────────────────────

@router.post("/admin/invoices")
async def create_invoice(
    body: InvoiceCreate,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    subtotal = sum(item.get("amount", 0) for item in body.line_items)
    gst = round(subtotal * 0.18, 2)
    total = round(subtotal + gst, 2)

    month_str = datetime.now(timezone.utc).strftime("%Y%m")
    seq = await pool.fetchval(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 'KSUB-\\d{6}-(\\d+)') AS INT)), 0) + 1 "
        "FROM staging.subscription_invoices "
        "WHERE invoice_number LIKE 'KSUB-' || $1 || '-%' "
        "FOR UPDATE",
        month_str,
    )
    invoice_number = f"KSUB-{month_str}-{seq:04d}"

    row = await pool.fetchrow(
        "INSERT INTO staging.subscription_invoices "
        "(org_id, invoice_number, period_start, period_end, "
        " line_items, subtotal, gst, total, due_date, payment_status, approved_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'pending', $10) "
        "RETURNING *",
        org_id, invoice_number, body.period_start, body.period_end,
        json.dumps(body.line_items), subtotal, gst, total,
        body.due_date, user["user_id"],
    )

    await _log_event(pool, org_id, "invoice_created", {
        "invoice_number": invoice_number, "total": float(total),
        "created_by": user["user_id"],
    })
    return dict(row)


@router.patch("/admin/invoices/{invoice_id}/record-payment")
async def record_payment(
    invoice_id: UUID,
    body: RecordPayment,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
):
    pool = await get_pool()

    inv = await pool.fetchrow(
        "SELECT * FROM staging.subscription_invoices WHERE id=$1",
        invoice_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["payment_status"] == "paid":
        raise HTTPException(409, "Invoice is already paid")

    paid_at = body.paid_at or datetime.now(timezone.utc)
    await pool.execute(
        "UPDATE staging.subscription_invoices SET "
        "payment_status='paid', payment_method=$1, payment_reference=$2, "
        "paid_at=$3, collected_by=$4 WHERE id=$5",
        body.payment_method, body.payment_reference,
        paid_at, user["user_id"], invoice_id,
    )

    await _log_event(pool, str(inv["org_id"]), "payment_recorded", {
        "invoice": inv["invoice_number"],
        "amount": float(inv["total"]),
        "method": body.payment_method,
        "reference": body.payment_reference,
        "collected_by": user["user_id"],
    })
    return {"status": "paid", "invoice_number": inv["invoice_number"]}


@router.get("/admin/invoices/overdue")
async def list_overdue(user=Depends(require_platform_role("platform_admin", "account_manager"))):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT i.*, o.name as org_name "
        "FROM staging.subscription_invoices i "
        "JOIN staging.organisations o ON o.id = i.org_id "
        "WHERE i.payment_status='pending' AND i.due_date < CURRENT_DATE "
        "ORDER BY i.due_date"
    )
    return {"data": [dict(r) for r in rows]}


# ── Org Billing History ──────────────────────────────────────

@router.get("/invoices")
async def list_invoices(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.subscription_invoices "
        "WHERE org_id=$1::uuid ORDER BY created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


# ── Usage ────────────────────────────────────────────────────

@router.get("/usage")
async def get_usage(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    pool = await get_pool()
    usage = await pool.fetch(
        "SELECT metric, value FROM staging.usage_tracking "
        "WHERE org_id=$1::uuid AND recorded_at=CURRENT_DATE",
        org_id,
    )
    sub = await pool.fetchrow(
        "SELECT p.max_users FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    user_count = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id=$1::uuid "
        "AND role_code IN ('org_owner','org_admin','org_member')",
        org_id,
    )
    return {
        "metrics": {r["metric"]: float(r["value"]) for r in usage},
        "user_count": user_count or 0,
        "max_users": sub["max_users"] if sub else None,
    }


# ── Client Cost Report ─────────────────────────────────────

@router.get("/cost-report")
async def cost_report(
    period: str = "30d",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Client-facing cost report. Shows charged amounts (with markup), not raw costs."""
    pool = await get_pool()
    from routers.admin_orgs import MARKUP_PCT
    from services.forex import get_usd_inr

    period_map = {"7d": 7, "30d": 30, "90d": 90, "ytd": None}
    days = period_map.get(period, 30)
    if days:
        start = date.today() - timedelta(days=days)
    else:
        start = date(date.today().year, 1, 1)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, p.name as plan_name FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )

    # AI costs by provider+model
    ai_rows = await pool.fetch(
        "SELECT l.provider, l.model, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, COUNT(*) as calls "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "GROUP BY l.provider, l.model ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    # Scraper costs
    scraper_rows = await pool.fetch(
        "SELECT r.scraper_id, COALESCE(SUM(r.cost_usd), 0) as cost_usd, "
        "COUNT(*) as runs "
        "FROM staging.hub_scraper_runs r "
        "WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "GROUP BY r.scraper_id ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    # Credit usage
    credits_used = await pool.fetchval(
        "SELECT COALESCE(SUM(credits_used), 0) FROM staging.hub_content_items "
        "WHERE org_id=$1::uuid AND created_at >= $2",
        org_id, cutoff,
    ) or 0

    rate = await get_usd_inr()

    def _charge(usd):
        return round(float(usd) * rate * (1 + MARKUP_PCT), 2)

    total_ai_usd = sum(float(r["cost_usd"]) for r in ai_rows)
    total_scraper_usd = sum(float(r["cost_usd"]) for r in scraper_rows)
    total_usd = total_ai_usd + total_scraper_usd

    return {
        "period": period,
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "ai_services": [
            {"service": f"{r['provider']} / {r['model']}", "calls": r["calls"],
             "charge_inr": _charge(r["cost_usd"])}
            for r in ai_rows
        ],
        "scraper_services": [
            {"service": r["scraper_id"], "runs": r["runs"],
             "charge_inr": _charge(r["cost_usd"])}
            for r in scraper_rows
        ],
        "credits_used": credits_used,
        "total_ai_inr": _charge(total_ai_usd),
        "total_scraper_inr": _charge(total_scraper_usd),
        "total_charge_inr": _charge(total_usd),
    }


@router.get("/cost-report/pdf")
async def cost_report_pdf(
    period: str = "30d",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Download client cost report as PDF."""
    from fastapi.responses import Response
    from services.cost_report_pdf import generate_cost_report_pdf
    from routers.admin_orgs import MARKUP_PCT
    from services.forex import get_usd_inr

    pool = await get_pool()

    period_map = {"7d": 7, "30d": 30, "90d": 90, "ytd": None}
    days = period_map.get(period, 30)
    if days:
        start = date.today() - timedelta(days=days)
    else:
        start = date(date.today().year, 1, 1)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.authorized_signatory_name, o.authorized_signatory_designation, "
        "p.name as plan_name "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )

    ai_rows = await pool.fetch(
        "SELECT l.provider, l.model, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, COUNT(*) as calls "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "GROUP BY l.provider, l.model ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    scraper_rows = await pool.fetch(
        "SELECT r.scraper_id, COALESCE(SUM(r.cost_usd), 0) as cost_usd, "
        "COUNT(*) as runs "
        "FROM staging.hub_scraper_runs r "
        "WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "GROUP BY r.scraper_id ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    credits_used = await pool.fetchval(
        "SELECT COALESCE(SUM(credits_used), 0) FROM staging.hub_content_items "
        "WHERE org_id=$1::uuid AND created_at >= $2",
        org_id, cutoff,
    ) or 0

    rate = await get_usd_inr()

    def _charge(usd):
        return round(float(usd) * rate * (1 + MARKUP_PCT), 2)

    report_data = {
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "ai_services": [
            {"service": f"{r['provider']} / {r['model']}", "calls": r["calls"],
             "charge_inr": _charge(r["cost_usd"])}
            for r in ai_rows
        ],
        "scraper_services": [
            {"service": r["scraper_id"], "runs": r["runs"],
             "charge_inr": _charge(r["cost_usd"])}
            for r in scraper_rows
        ],
        "credits_used": credits_used,
        "total_ai_inr": _charge(sum(float(r["cost_usd"]) for r in ai_rows)),
        "total_scraper_inr": _charge(sum(float(r["cost_usd"]) for r in scraper_rows)),
        "total_charge_inr": _charge(
            sum(float(r["cost_usd"]) for r in ai_rows)
            + sum(float(r["cost_usd"]) for r in scraper_rows)
        ),
        "signatory_name": org["authorized_signatory_name"] if org else "",
        "signatory_designation": org["authorized_signatory_designation"] if org else "",
    }

    pdf_bytes = generate_cost_report_pdf(report_data)
    filename = f"Cost-Report-{start.strftime('%b%Y')}-{date.today().strftime('%d%b%Y')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── User Roles ──────────────────────────────────────────────

@router.get("/my-roles")
async def get_my_roles(user=Depends(require_user)):
    """Return all roles for the current user (platform + org-scoped)."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT ur.role_code, ur.org_id, o.name as org_name "
        "FROM staging.user_roles ur "
        "LEFT JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1",
        user["user_id"],
    )
    platform_roles = [r["role_code"] for r in rows if r["org_id"] is None]
    org_roles = [
        {"org_id": str(r["org_id"]), "org_name": r["org_name"], "role": r["role_code"]}
        for r in rows if r["org_id"] is not None
    ]
    return {
        "platform_roles": platform_roles,
        "org_roles": org_roles,
        "is_platform_admin": "platform_admin" in platform_roles or user.get("role") == "admin",
    }
