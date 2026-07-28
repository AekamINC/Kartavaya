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
from middleware.roles import require_org_role, require_platform_role
from middleware.role_tiers import ALL_MODULES, BILLING_CONSOLE_ROLES, is_god_mode, strongest
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

    from middleware.roles import is_platform_staff
    is_staff = await is_platform_staff(user["user_id"])
    plan_list = []
    for r in plans:
        p = dict(r)
        if not is_staff:
            p.pop("price_monthly", None)
            p.pop("price_annual", None)
        plan_list.append(p)

    mod_list = []
    for r in modules:
        m = dict(r)
        # is_staff, not is_admin — the latter was never defined, so this raised
        # NameError for any org with an active add-on module, which failed the
        # whole billing page (its four requests are awaited together).
        if not is_staff:
            m.pop("price_per_user_monthly", None)
        mod_list.append(m)

    return {"plans": plan_list, "modules": mod_list}


# ── Current Subscription ─────────────────────────────────────

@router.get("/current")
async def get_current(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    pool = await get_pool()
    # Explicit columns, not `s.*`. The wildcard returned whatever the table
    # happened to hold, to any authenticated member of the org — so the first
    # cost or margin column added to `staging.subscriptions` would have started
    # crossing to tenants with no code change and no review. It also already
    # carried `activated_by` and `notes`, which are ours, not theirs.
    #
    # Deliberately excluded:
    #   activated_by  — the platform staff user_id who set the plan.
    #   notes         — free text written by platform staff in `admin_set_plan`.
    #   cancel_reason — internal; never written by any code path today.
    #   plan_id       — internal FK; the plan is already named by plan_code/plan_name.
    sub = await pool.fetchrow(
        "SELECT s.org_id, s.billing_cycle, s.status, s.trial_ends_at, "
        "s.current_period_start, s.current_period_end, s.next_billing_date, "
        "s.cancelled_at, s.created_at, s.updated_at, "
        "p.name as plan_name, p.code as plan_code, "
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
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
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
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
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

    # The module vocabulary is role_tiers', not the seed table's.
    #
    # This used to reject anything absent from `staging.add_on_modules`, which is
    # seeded with EIGHT codes (migrations/010:141 and 011:8): graha, ganit,
    # manav, pahchan, vetana, sanvaad, dristi, srijan. `vikray`, `prachar` and
    # `varta` have no row and never did — so this endpoint answered "Invalid
    # module code" for three modules that have live `require_module()` gates and
    # working routers behind them, and the only way to switch them on was
    # `POST /v1/admin/orgs/{org_id}/modules/{code}`, which validates against
    # role_tiers and writes the same table.
    #
    # Two activation paths at the same trust level (both BILLING/CONSOLE
    # platform-role guards, both writing `module_subscriptions`) disagreeing on
    # which modules exist is how a customer ends up paying for Vikray and being
    # told it is not a module. Agreeing on role_tiers widens no guard.
    if body.module_code not in ALL_MODULES:
        raise HTTPException(
            400,
            f"Unknown module: {body.module_code}. "
            f"Valid: {', '.join(sorted(ALL_MODULES))}",
        )

    # The dependency graph still comes from the catalogue, because that is where
    # `requires_module` lives. A module with no catalogue row simply has no
    # declared dependency — it must not be an activation failure.
    mod = await pool.fetchrow(
        "SELECT code, requires_module FROM staging.add_on_modules WHERE code=$1 AND is_active=TRUE",
        body.module_code,
    )

    for dep in ((mod["requires_module"] if mod else None) or []):
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
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
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
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
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
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
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
async def list_overdue(user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES))):
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
async def list_invoices(
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """The org's own invoices. Owner and admin only.

    This was `Depends(require_user)`, so any `org_member` could read the whole
    invoice history with totals. `OrgSettingsPage.jsx:31` already gates the
    entire settings surface — Billing tab included — on
    `ORG_ROLES = ['org_owner','org_admin']`, so the control was hidden in the UI
    and open in the API. RBAC-SPEC Tier 2 puts `org_member` at "base membership,
    only explicitly granted modules", and billing is not a module grant.
    """
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
    # COALESCE, so a per-org seat count overrides the tier default. The org
    # column is the seats actually bought; the plan column is the tier's
    # default. NULL on both still means unlimited, which is the existing
    # behaviour for every plan except basic and must not become 0.
    sub = await pool.fetchrow(
        "SELECT COALESCE(o.max_users, p.max_users) AS max_users "
        "FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "JOIN staging.organisations o ON o.id = s.org_id "
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
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Client-facing usage report. Shows credit consumption only — no money disclosed.

    Owner and admin, for the same reason as `list_invoices`: it was open to every
    `org_member` while the only screen that renders it sits behind an
    owner/admin gate.
    """
    pool = await get_pool()

    period_map = {"7d": 7, "30d": 30, "90d": 90, "ytd": None}
    days = period_map.get(period, 30)
    if days:
        start = date.today() - timedelta(days=days)
    else:
        start = date(date.today().year, 1, 1)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.monthly_credits, p.name as plan_name, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    plan_credits = (org["monthly_credits"] or org["default_credits"] or 0) if org else 0

    wallet = await pool.fetchrow(
        "SELECT balance, credits_reset_at FROM staging.hub_org_credits WHERE org_id=$1::uuid",
        org_id,
    )

    # Credit transactions in period
    transactions = await pool.fetch(
        "SELECT tx_type, amount, description "
        "FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid AND created_at >= $2 AND created_at < $3 "
        "ORDER BY created_at DESC",
        org_id, cutoff,
        datetime.combine(date.today() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
    )

    # Aggregate by category
    ai_credits = 0
    scraper_credits = 0
    for tx in transactions:
        if tx["tx_type"] != "debit":
            continue
        desc = tx["description"] or ""
        amt = abs(tx["amount"])
        if desc.startswith("scraper:") or desc.startswith("scraper true-up"):
            scraper_credits += amt
        else:
            ai_credits += amt

    total_used = ai_credits + scraper_credits
    overage = max(0, total_used - plan_credits)

    return {
        "period": period,
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "plan_credits": plan_credits,
        # The WALLET is the balance. It is fetched thirty lines above and was
        # used only for `last_reset`, while this field was derived as
        # `plan_credits - total_used` — a different number that nothing enforces.
        #
        # Measured live on staging 2026-07-28: this reported `current_balance`
        # 2000 while `POST /v1/scrapers/run` refused the same org with
        # "Insufficient credits. Need 2, have 0". Every debit path reads
        # `staging.hub_org_credits.balance` (scrapers.py:138, ai_router.py:713,
        # hub.py:1588); this report read none of them, so a customer was shown
        # 2000 spendable credits they did not have.
        #
        # The derived figure could not be right, for two independent reasons:
        # `total_used` counts only transactions inside the reporting window, so
        # the number drifts UP as older spend falls out of a 30d period; and a
        # top-up or admin adjustment moves the wallet without writing a debit
        # here at all.
        #
        # The fallback keeps the previous behaviour for an org with no wallet
        # row, which is the only case with nothing better to report.
        "current_balance": (
            wallet["balance"] if wallet is not None else max(0, plan_credits - total_used)
        ),
        "last_reset": wallet["credits_reset_at"].isoformat() if wallet and wallet["credits_reset_at"] else None,
        "ai_credits_used": ai_credits,
        "scraper_credits_used": scraper_credits,
        "total_credits_used": total_used,
        "overage_credits": overage,
        "is_over_plan": overage > 0,
    }


@router.get("/cost-report/pdf")
async def cost_report_pdf(
    period: str = "30d",
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Download client usage report as PDF. Shows credits only — no money.

    Owner and admin. This one also carries `authorized_signatory_name` and
    `authorized_signatory_designation` into the rendered document, which is org
    identity data rather than usage data, and it was reachable by every member.
    """
    from fastapi.responses import Response
    from services.cost_report_pdf import generate_credit_report_pdf

    pool = await get_pool()

    period_map = {"7d": 7, "30d": 30, "90d": 90, "ytd": None}
    days = period_map.get(period, 30)
    if days:
        start = date.today() - timedelta(days=days)
    else:
        start = date(date.today().year, 1, 1)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    cutoff_end = datetime.combine(date.today() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.monthly_credits, o.authorized_signatory_name, o.authorized_signatory_designation, "
        "p.name as plan_name, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    plan_credits = (org["monthly_credits"] or org["default_credits"] or 0) if org else 0

    wallet = await pool.fetchrow(
        "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid", org_id
    )

    transactions = await pool.fetch(
        "SELECT tx_type, amount, description, created_at "
        "FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid AND created_at >= $2 AND created_at < $3 "
        "ORDER BY created_at DESC",
        org_id, cutoff, cutoff_end,
    )

    ai_credits = 0
    scraper_credits = 0
    for tx in transactions:
        if tx["tx_type"] != "debit":
            continue
        desc = tx["description"] or ""
        amt = abs(tx["amount"])
        if desc.startswith("scraper:") or desc.startswith("scraper true-up"):
            scraper_credits += amt
        else:
            ai_credits += amt

    total_used = ai_credits + scraper_credits
    overage = max(0, total_used - plan_credits)

    scraper_breakdown = await pool.fetch(
        "SELECT c.name, COUNT(r.id) as runs, COALESCE(SUM(r.credits_charged),0) as credits "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.org_id=$1::uuid AND r.created_at >= $2 AND r.created_at < $3 "
        "GROUP BY c.name ORDER BY credits DESC",
        org_id, cutoff, cutoff_end,
    )

    report_data = {
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "plan_credits": plan_credits,
        # Same fix as the JSON report above, and the same reason — this handler
        # also fetched `wallet` and then never used it. Left divergent, the PDF
        # a customer files would disagree with the screen it was generated from.
        "current_balance": (
            wallet["balance"] if wallet is not None else max(0, plan_credits - total_used)
        ),
        "ai_credits_used": ai_credits,
        "scraper_credits_used": scraper_credits,
        "total_credits_used": total_used,
        "overage_credits": overage,
        "signatory_name": org["authorized_signatory_name"] if org else "",
        "signatory_designation": org["authorized_signatory_designation"] if org else "",
        "scraper_breakdown": [{"name": r["name"], "runs": r["runs"], "credits": r["credits"]} for r in scraper_breakdown],
    }

    pdf_bytes = generate_credit_report_pdf(report_data)
    filename = f"Usage-Report-{start.strftime('%b%Y')}-{date.today().strftime('%d%b%Y')}.pdf"
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
        # `is_god_mode(strongest(...))`, not `"platform_admin" in platform_roles`.
        #
        # The literal test returns False for a `platform_owner`, which is the
        # CURRENT spelling of god mode — `platform_admin` is the legacy alias
        # that role_tiers.py:19-22 keeps only until the rows are migrated. On the
        # day those rows are renamed this flag would have silently flipped to
        # False for all three god-mode accounts, which is the exact lockout
        # role_tiers.py:115-121 was written to warn about.
        "is_platform_admin": is_god_mode(strongest(platform_roles)),
    }
