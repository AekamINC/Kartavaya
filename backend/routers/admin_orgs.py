"""
admin_orgs.py — Platform admin: org creation, member assignment, role management,
cost aggregation analytics.
Only platform_admin / account_manager can access these endpoints.
"""
import json
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.roles import require_platform_role
from services.provider_costs import get_all_provider_costs
from services.forex import get_usd_inr, get_usd_inr_sync
from services.storage import create_org_bucket, verify_r2_credentials, clear_org_r2_cache
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES, GOD_MODE_ROLES, MANAGER_ROLES, STAFF_ROLES,
    FINANCE_CONSOLE_ROLES, SUPERUSER_ONLY_ROLES,
    ALL_MODULES as ROLE_TIER_MODULES,
    SENSITIVE_MODULES,
)

# Who may open the platform console. Reaching the console is not the same as
# reading what is in it — role_tiers.can_reach_module still decides that per
# module, so a platform_staff who opens an org sees the operating set and not
# its payroll.
CONSOLE_ROLES = GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + ("account_manager",)
CONSOLE_ROLES_WITH_FINANCE = CONSOLE_ROLES + ("account_finance",)


router = APIRouter(prefix="/api/v1/admin/orgs", tags=["admin-orgs"])

DEFAULT_MARKUP_PCT = 0.30

def _with_inr(cost_usd: float, rate: float, markup: float = 0.30) -> dict:
    """Return USD, INR, and client-charged INR (with markup, ceiled to whole number)."""
    inr = cost_usd * rate
    charged_inr = math.ceil(inr * (1 + markup))
    return {"usd": round(cost_usd, 4), "inr": round(inr, 2), "charged_inr": charged_inr}

PLAN_STORAGE_LIMITS = {
    "free": 0,
    "starter": 5 * 1024**3,
    "growth": 10 * 1024**3,
    "scale": 25 * 1024**3,
}


class R2Credentials(BaseModel):
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket_name: str = "kartavya-storage"

class OrgCreate(BaseModel):
    name: str
    owner_email: EmailStr
    plan_code: str = "free"
    markup_pct: float = 0.30
    monthly_credits: Optional[int] = None
    monthly_price: Optional[float] = None
    # Seats bought by this org. None = inherit the plan's default (5 on basic).
    # Not constrained to multiples of 5: that is a pricing convention, and a
    # negotiated 12 must stay expressible.
    max_users: Optional[int] = None
    r2: Optional[R2Credentials] = None

class OrgMemberAdd(BaseModel):
    email: EmailStr
    roles: list[str] = ["org_member"]
    module_grants: list[str] = []
    mobile_number: str = ""

class RoleAssign(BaseModel):
    user_id: str
    role_code: str
    org_id: Optional[str] = None


# ── Org CRUD ────────────────────────────────────────────────

@router.post("")
async def create_org(
    body: OrgCreate,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Create a new org, link to a team, set owner, assign plan."""
    pool = await get_pool()

    owner = await pool.fetchrow(
        "SELECT user_id, email FROM users WHERE LOWER(email)=LOWER($1)",
        body.owner_email,
    )
    if not owner:
        raise HTTPException(
            404,
            f"No user found with email '{body.owner_email}'. "
            "They must register first before an org can be created for them.",
        )

    tm = await pool.fetchrow(
        "SELECT team_id FROM team_members WHERE user_id=$1 AND status='active' LIMIT 1",
        owner["user_id"],
    )
    if not tm:
        raise HTTPException(
            400,
            "User has no active team. They must create a team first.",
        )

    existing = await pool.fetchrow(
        "SELECT id FROM staging.organisations WHERE team_id=$1",
        tm["team_id"],
    )
    if existing:
        raise HTTPException(409, "An organisation already exists for this team")

    plan = await pool.fetchrow(
        "SELECT id, code, default_credits FROM staging.plans WHERE code=$1 AND is_active=TRUE",
        body.plan_code,
    )
    if not plan:
        raise HTTPException(400, f"Invalid plan code: {body.plan_code}")

    org_id = uuid.uuid4()
    storage_limit = PLAN_STORAGE_LIMITS.get(body.plan_code, 0)

    r2_account_id = body.r2.account_id if body.r2 else None
    r2_access_key = body.r2.access_key_id if body.r2 else None
    r2_secret_key = body.r2.secret_access_key if body.r2 else None
    r2_bucket = body.r2.bucket_name if body.r2 else None

    monthly_credits = body.monthly_credits if body.monthly_credits is not None else (plan["default_credits"] or 0)
    monthly_price = body.monthly_price if body.monthly_price is not None else 0

    await pool.execute(
        "INSERT INTO staging.organisations "
        "(id, team_id, name, owner_user_id, r2_account_id, r2_access_key_id, "
        " r2_secret_access_key, r2_bucket_name, storage_limit_bytes, markup_pct, "
        " monthly_credits, monthly_price, max_users, is_active) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE)",
        org_id, tm["team_id"], body.name, owner["user_id"],
        r2_account_id, r2_access_key, r2_secret_key, r2_bucket,
        storage_limit, body.markup_pct, monthly_credits, monthly_price,
        body.max_users,
    )

    bucket_name = None
    if body.r2:
        bucket_name = await create_org_bucket(str(org_id))

    await pool.execute(
        "INSERT INTO staging.subscriptions (org_id, plan_id, status) "
        "VALUES ($1, $2, 'active')",
        org_id, plan["id"],
    )

    if monthly_credits > 0:
        await pool.execute(
            "INSERT INTO staging.hub_org_credits (org_id, balance, credits_reset_at) "
            "VALUES ($1, $2, NOW())",
            org_id, monthly_credits,
        )
        await pool.execute(
            "INSERT INTO staging.hub_org_credit_transactions "
            "(org_id, amount, balance_after, tx_type, description, created_by) "
            "VALUES ($1, $2, $2, 'topup', 'Initial monthly credits', $3)",
            org_id, monthly_credits, user["user_id"],
        )

    await pool.execute(
        "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
        "VALUES ($1, $2, 'org_admin', $3)",
        owner["user_id"], org_id, user["user_id"],
    )

    await _log_event(pool, str(org_id), "org_created", {
        "name": body.name,
        "owner": owner["email"],
        "plan": body.plan_code,
        "created_by": user["user_id"],
    })

    return {
        "org_id": str(org_id),
        "name": body.name,
        "owner": owner["email"],
        "plan": body.plan_code,
        "r2_bucket": bucket_name,
        "r2_configured": body.r2 is not None,
    }


@router.get("")
async def list_orgs(
    count_only: int = 0,
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """List all orgs with plan and owner info.

    `count_only=1` returns just `{"count": n}`. The admin sidebar badge
    (01-navigation.md §4) needs the number on every admin page, and pulling
    every org row plus its plan and owner joins to render one integer is the
    kind of waste that only shows up once a customer has a few hundred orgs.
    """
    pool = await get_pool()
    if count_only:
        n = await pool.fetchval("SELECT COUNT(*) FROM staging.organisations")
        return {"count": n or 0}
    rows = await pool.fetch(
        "SELECT o.id, o.name, o.team_id, o.owner_user_id, o.is_active, "
        "o.storage_used_bytes, o.storage_limit_bytes, o.created_at, "
        "o.markup_pct, o.monthly_credits, o.monthly_price, "
        "p.code as plan_code, p.name as plan_name, "
        "u.email as owner_email, u.full_name as owner_name "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN users u ON u.user_id = o.owner_user_id "
        "ORDER BY o.created_at DESC"
    )
    return {"data": [dict(r) for r in rows]}


# ── Cost Aggregation (platform-wide) ──────────────────────
# NOTE: These must be declared before /{org_id} to avoid
# FastAPI matching "platform-analytics" as an org_id.

def _period_start(period: str) -> date:
    """Convert period string to a start date."""
    today = date.today()
    if period == "7d":
        return today - timedelta(days=7)
    if period == "90d":
        return today - timedelta(days=90)
    if period == "ytd":
        return date(today.year, 1, 1)
    return today - timedelta(days=30)  # default 30d


@router.get("/platform-analytics")
async def platform_analytics(
    period: str = "30d",
    user=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    """Platform-wide KPIs for Aekam super-admin dashboard."""
    pool = await get_pool()
    start = _period_start(period)

    total_orgs = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.organisations WHERE is_active=TRUE"
    )
    total_users = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id IS NOT NULL"
    )

    # Revenue = margin earned from AI + scraper usage per org (charged_inr - cost_inr)
    margin_rows = await pool.fetch(
        "SELECT o.markup_pct, "
        "COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0) as total_cost_usd "
        "FROM staging.organisations o "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(l.cost_usd) as cost "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = o.id AND l.created_at >= $1"
        ") ai ON TRUE "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(r.cost_usd) as cost "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = o.id AND r.created_at >= $1"
        ") sc ON TRUE "
        "WHERE o.is_active=TRUE AND "
        "(COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0)) > 0",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )
    rate_for_rev = await get_usd_inr()
    total_revenue_inr = sum(
        math.ceil(float(r["total_cost_usd"]) * rate_for_rev * (1 + float(r["markup_pct"])))
        for r in margin_rows
    )
    total_cost_inr = sum(
        round(float(r["total_cost_usd"]) * rate_for_rev, 2)
        for r in margin_rows
    )

    ai_stats = await pool.fetchrow(
        "SELECT COALESCE(SUM(l.cost_usd), 0) as total_cost, COUNT(*) as total_calls "
        "FROM staging.hub_ai_logs l "
        "WHERE l.created_at >= $1",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )

    total_scraper_cost = await pool.fetchval(
        "SELECT COALESCE(SUM(cost_usd), 0) FROM staging.hub_scraper_runs "
        "WHERE created_at >= $1",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    ) or 0

    by_provider = await pool.fetch(
        "SELECT l.provider, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, "
        "COUNT(*) as call_count "
        "FROM staging.hub_ai_logs l "
        "WHERE l.created_at >= $1 "
        "GROUP BY l.provider ORDER BY cost_usd DESC",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )

    top_orgs = await pool.fetch(
        "SELECT o.id as org_id, o.name as org_name, o.markup_pct, "
        "COALESCE(ai.cost, 0) as ai_cost_usd, "
        "COALESCE(sc.cost, 0) as scraper_cost_usd, "
        "COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0) as total_cost_usd "
        "FROM staging.organisations o "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(l.cost_usd) as cost "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = o.id AND l.created_at >= $1"
        ") ai ON TRUE "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(r.cost_usd) as cost "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = o.id AND r.created_at >= $1"
        ") sc ON TRUE "
        "WHERE o.is_active=TRUE "
        "ORDER BY total_cost_usd DESC NULLS LAST "
        "LIMIT 10",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )

    ai_cost = float(ai_stats["total_cost"])
    scraper_cost = float(total_scraper_cost)
    total_cost = ai_cost + scraper_cost
    rate = await get_usd_inr()

    return {
        "period": period,
        "total_orgs": total_orgs,
        "total_users": total_users,
        "total_revenue_inr": round(total_revenue_inr, 2),
        "total_cost_inr": round(total_cost_inr, 2),
        "margin_inr": round(total_revenue_inr - total_cost_inr, 2),
        "total_ai_cost_usd": ai_cost,
        "total_scraper_cost_usd": scraper_cost,
        "total_cost": _with_inr(total_cost, rate),
        "ai_cost": _with_inr(ai_cost, rate),
        "scraper_cost": _with_inr(scraper_cost, rate),
        "total_ai_calls": ai_stats["total_calls"],
        "default_markup_pct": DEFAULT_MARKUP_PCT,
        "usd_to_inr": rate,
        "ai_cost_by_provider": [
            {"provider": r["provider"], "cost_usd": float(r["cost_usd"]),
             "cost": _with_inr(float(r["cost_usd"]), rate),
             "call_count": r["call_count"]}
            for r in by_provider
        ],
        "top_orgs_by_spend": [
            {"org_id": str(r["org_id"]), "org_name": r["org_name"],
             "ai_cost_usd": float(r["ai_cost_usd"]),
             "scraper_cost_usd": float(r["scraper_cost_usd"]),
             "total_cost_usd": float(r["total_cost_usd"]),
             "markup_pct": float(r["markup_pct"]),
             "total": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"])),
             "charged_inr": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"]))["charged_inr"],
             "margin_inr": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"]))["charged_inr"]
                           - round(float(r["total_cost_usd"]) * rate, 2)}
            for r in top_orgs
        ],
    }


@router.get("/cost-summary")
async def all_orgs_cost_summary(
    period: str = "30d",
    user=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    """All orgs cost summary table for admin cost dashboard."""
    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    rows = await pool.fetch(
        "SELECT o.id as org_id, o.name as org_name, o.markup_pct, "
        "p.name as plan_name, "
        "COALESCE(ai.cost, 0) as ai_cost_usd, "
        "COALESCE(ai.calls, 0) as ai_calls, "
        "COALESCE(sc.cost, 0) as scraper_cost_usd, "
        "COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0) as total_cost_usd, "
        "GREATEST(ai.last_at, sc.last_at) as last_active "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(l.cost_usd) as cost, COUNT(*) as calls, "
        "  MAX(l.created_at) as last_at "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = o.id AND l.created_at >= $1"
        ") ai ON TRUE "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(r.cost_usd) as cost, MAX(r.created_at) as last_at "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = o.id AND r.created_at >= $1"
        ") sc ON TRUE "
        "WHERE o.is_active=TRUE "
        "ORDER BY total_cost_usd DESC NULLS LAST",
        cutoff,
    )

    rate = await get_usd_inr()

    return {
        "period": period,
        "default_markup_pct": DEFAULT_MARKUP_PCT,
        "usd_to_inr": rate,
        "data": [
            {
                "org_id": str(r["org_id"]),
                "org_name": r["org_name"],
                "plan_name": r["plan_name"],
                "markup_pct": float(r["markup_pct"]),
                "ai_cost_usd": float(r["ai_cost_usd"]),
                "scraper_cost_usd": float(r["scraper_cost_usd"]),
                "total_cost_usd": float(r["total_cost_usd"]),
                "total": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"])),
                "charged_inr": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"]))["charged_inr"],
                "ai_calls": r["ai_calls"],
                "last_active": r["last_active"].isoformat() if r["last_active"] else None,
            }
            for r in rows
        ],
    }


@router.get("/provider-costs")
async def provider_costs(
    user=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    """Real-time costs from provider accounts for reconciliation against tracked spend."""
    pool = await get_pool()

    # Tracked totals from internal logs (all-time)
    ai_by_provider = await pool.fetch(
        "SELECT provider, COALESCE(SUM(cost_usd), 0) as total "
        "FROM staging.hub_ai_logs GROUP BY provider"
    )
    tracked_ai = {r["provider"]: float(r["total"]) for r in ai_by_provider}

    tracked_scraper = await pool.fetchval(
        "SELECT COALESCE(SUM(cost_usd), 0) FROM staging.hub_scraper_runs"
    ) or 0

    # Map internal provider names to reconciliation buckets
    tracked_openrouter = sum(
        v for k, v in tracked_ai.items()
        if k in ("openrouter", "gemini_lite_or", "glm", "qwen_flash",
                  "qwen_plus", "gemini_flash_or", "gemini_pro_or")
    )
    tracked_hf = tracked_ai.get("huggingface", 0)

    tracked_totals = {
        "openrouter": round(tracked_openrouter, 6),
        "apify": round(float(tracked_scraper), 6),
        "huggingface": round(tracked_hf, 6),
    }

    # Fetch real provider costs
    providers = await get_all_provider_costs()

    # Compute discrepancies where provider data is available
    discrepancy = {}
    for key in ("openrouter", "apify", "huggingface"):
        provider_data = providers.get(key, {})
        if "error" in provider_data:
            discrepancy[key] = None
        else:
            provider_total = provider_data.get("total_spend_usd", 0)
            discrepancy[key] = round(provider_total - tracked_totals[key], 6)

    return {
        "providers": providers,
        "tracked_totals": tracked_totals,
        "discrepancy": discrepancy,
    }


@router.get("/{org_id}")
async def get_org(
    org_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Get org details including members and roles."""
    pool = await get_pool()
    org = await pool.fetchrow(
        "SELECT o.id, o.team_id, o.name, o.owner_user_id, o.is_active, "
        "o.r2_account_id, o.r2_bucket_name, o.storage_limit_bytes, "
        "o.markup_pct, o.monthly_credits, o.monthly_price, "
        "o.created_at, o.updated_at, "
        "p.code as plan_code, p.name as plan_name, "
        "u.email as owner_email "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN users u ON u.user_id = o.owner_user_id "
        "WHERE o.id=$1::uuid",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    members = await pool.fetch(
        "SELECT ur.user_id, ur.role_code, ur.granted_at, "
        "u.email, u.full_name "
        "FROM staging.user_roles ur "
        "JOIN users u ON u.user_id = ur.user_id "
        "WHERE ur.org_id=$1::uuid "
        "ORDER BY ur.granted_at",
        org_id,
    )

    modules = await pool.fetch(
        "SELECT module_code, is_active, activated_at "
        "FROM staging.module_subscriptions WHERE org_id=$1::uuid",
        org_id,
    )

    member_modules = await pool.fetch(
        "SELECT user_id, module_code FROM staging.org_member_modules "
        "WHERE org_id=$1::uuid",
        org_id,
    )

    return {
        "org": dict(org),
        "members": [dict(m) for m in members],
        "modules": [dict(m) for m in modules],
        "member_modules": [dict(mm) for mm in member_modules],
    }


@router.patch("/{org_id}/deactivate")
async def deactivate_org(
    org_id: str,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.organisations SET is_active=FALSE WHERE id=$1::uuid",
        org_id,
    )
    await pool.execute(
        "UPDATE staging.subscriptions SET status='cancelled' WHERE org_id=$1::uuid",
        org_id,
    )
    return {"status": "deactivated"}


@router.patch("/{org_id}/settings")
async def update_org_settings(
    org_id: str,
    body: dict,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Update org markup, monthly credits, and/or monthly price."""
    pool = await get_pool()
    updates = []
    params = []
    idx = 1

    if "markup_pct" in body:
        pct = float(body["markup_pct"])
        if not (0 <= pct <= 1):
            raise HTTPException(400, "markup_pct must be between 0 and 1")
        updates.append(f"markup_pct=${idx}")
        params.append(pct)
        idx += 1

    if "monthly_credits" in body:
        mc = int(body["monthly_credits"])
        if mc < 0:
            raise HTTPException(400, "monthly_credits must be >= 0")
        updates.append(f"monthly_credits=${idx}")
        params.append(mc)
        idx += 1

    if "monthly_price" in body:
        mp = float(body["monthly_price"])
        if mp < 0:
            raise HTTPException(400, "monthly_price must be >= 0")
        updates.append(f"monthly_price=${idx}")
        params.append(mp)
        idx += 1

    if not updates:
        raise HTTPException(400, "No fields to update")

    params.append(org_id)
    await pool.execute(
        f"UPDATE staging.organisations SET {', '.join(updates)} WHERE id=${idx}::uuid",
        *params,
    )
    row = await pool.fetchrow(
        "SELECT markup_pct, monthly_credits, monthly_price FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    return {
        "markup_pct": float(row["markup_pct"]),
        "monthly_credits": row["monthly_credits"],
        "monthly_price": float(row["monthly_price"]),
    }


# ── Member Management ───────────────────────────────────────

@router.post("/{org_id}/members")
async def add_member(
    org_id: str,
    body: OrgMemberAdd,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Add a user to an org with specified roles."""
    pool = await get_pool()

    org = await pool.fetchrow(
        "SELECT id, team_id FROM staging.organisations WHERE id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    target = await pool.fetchrow(
        "SELECT user_id FROM users WHERE LOWER(email)=LOWER($1)",
        body.email,
    )
    if not target:
        raise HTTPException(404, f"No user found with email '{body.email}'")

    if body.mobile_number:
        await pool.execute(
            "UPDATE users SET mobile_number=$1 WHERE user_id=$2",
            body.mobile_number.strip(), target["user_id"],
        )

    valid_org_roles = {"org_admin", "org_member"}
    for role in body.roles:
        if role not in valid_org_roles:
            raise HTTPException(400, f"Invalid org role: {role}. Valid: {', '.join(valid_org_roles)}")

    is_team_member = await pool.fetchval(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        org["team_id"], target["user_id"],
    )
    if not is_team_member:
        await pool.execute(
            "INSERT INTO team_members (member_id, team_id, email, user_id, role, status) "
            "VALUES ($1, $2, $3, $4, 'member', 'active') "
            "ON CONFLICT DO NOTHING",
            f"mem_{uuid.uuid4().hex[:12]}", org["team_id"],
            body.email, target["user_id"],
        )

    for role in body.roles:
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT (user_id, org_id, role_code) DO NOTHING",
            target["user_id"], org_id, role, user["user_id"],
        )

    # Module grants: if explicit list provided, use it;
    # otherwise auto-grant non-sensitive modules that are enabled for this org
    # Was a retyped `{"vetana", "ganit", "manav"}`. Identical to
    # role_tiers.SENSITIVE_MODULES today, which is exactly why it was worth
    # importing: two copies that agree are one edit away from disagreeing, and
    # the direction this one fails in is auto-granting payroll.
    SENSITIVE = SENSITIVE_MODULES
    target_uid = target["user_id"]

    if body.module_grants:
        grant_codes = body.module_grants
    else:
        # Auto-grant non-sensitive enabled modules for org_member
        # org_admin/org_owner get all modules implicitly (checked at runtime)
        if any(r in ("org_admin", "org_owner") for r in body.roles):
            grant_codes = []  # admins don't need explicit grants
        else:
            enabled = await pool.fetch(
                "SELECT module_code FROM staging.module_subscriptions "
                "WHERE org_id=$1::uuid AND is_active=TRUE",
                org_id,
            )
            grant_codes = [r["module_code"] for r in enabled if r["module_code"] not in SENSITIVE]

    for mc in grant_codes:
        if mc not in ALL_MODULES:
            continue
        await pool.execute(
            "INSERT INTO staging.org_member_modules (user_id, org_id, module_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT (user_id, org_id, module_code) DO NOTHING",
            target_uid, org_id, mc, user["user_id"],
        )

    await _log_event(pool, org_id, "member_added", {
        "email": body.email,
        "roles": body.roles,
        "modules": grant_codes,
        "added_by": user["user_id"],
    })

    return {"status": "added", "email": body.email, "roles": body.roles, "modules": grant_codes}


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(
    org_id: str,
    user_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.user_roles WHERE user_id=$1 AND org_id=$2::uuid",
        user_id, org_id,
    )
    return {"status": "removed"}


# ── Role Management ─────────────────────────────────────────

@router.get("/users/search")
async def search_user_by_email(
    email: str = Query(...),
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT user_id, email, name AS full_name FROM users WHERE LOWER(email)=LOWER($1)",
        email,
    )
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


@router.get("/roles/platform")
async def list_platform_roles(
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT r.id, r.user_id, r.role_code, r.granted_at, "
        "u.email, u.name AS full_name "
        "FROM staging.user_roles r "
        "JOIN users u ON u.user_id = r.user_id "
        "WHERE r.org_id IS NULL "
        "ORDER BY r.granted_at DESC"
    )
    return [dict(r) for r in rows]


@router.post("/roles/assign")
async def assign_role(
    body: RoleAssign,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Assign any role (platform or org-scoped) to a user."""
    pool = await get_pool()

    target = await pool.fetchval("SELECT 1 FROM users WHERE user_id=$1", body.user_id)
    if not target:
        raise HTTPException(404, "User not found")

    platform_roles = set(ALL_PLATFORM_ROLES) | {"developer"}
    org_roles = {"org_admin", "org_member"}

    if body.role_code in platform_roles:
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, NULL, $2, $3) "
            "ON CONFLICT DO NOTHING",
            body.user_id, body.role_code, user["user_id"],
        )
    elif body.role_code in org_roles:
        if not body.org_id:
            raise HTTPException(400, "org_id required for org-scoped roles")
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT DO NOTHING",
            body.user_id, body.org_id, body.role_code, user["user_id"],
        )
    else:
        raise HTTPException(400, f"Invalid role: {body.role_code}")

    return {"status": "assigned", "role": body.role_code}


@router.delete("/roles/{role_id}")
async def revoke_role(
    role_id: str,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    await pool.execute("DELETE FROM staging.user_roles WHERE id=$1::uuid", role_id)
    return {"status": "revoked"}


# ── Module Management ──────────────────────────────────────

# The list used to be retyped here, and held EIGHT codes where role_tiers holds
# twelve. `org_members.py` had the identical bug and was fixed the same way in
# 40124fb. The consequence here was concrete: `POST /{org_id}/modules/{code}`
# and its DELETE both validate against this name, so switching Sanvaad, Varta,
# eSign or Pahchan on for a customer returned `400 Unknown module` from the
# platform console — four modules unreachable through the only UI that reaches
# them.
#
# `sanvaad` is added on top of role_tiers' twelve rather than replacing
# `samvada`, because THESE endpoints write `staging.module_subscriptions`, and
# that table spells the module `sanvaad` — verified live, it holds `sanvaad` and
# never `samvada`. Importing role_tiers' spelling alone would swap one 400 for
# another and reject the exact code the live data uses. Both spellings are
# accepted until `PROPOSED_069_sanvaad_spelling.sql` converges them; that file
# names this line as one of the places the workaround disappears from.
ALL_MODULES = frozenset(ROLE_TIER_MODULES) | {"sanvaad"}


@router.post("/{org_id}/modules/{module_code}")
async def enable_module(
    org_id: str,
    module_code: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    if module_code not in ALL_MODULES:
        # sorted() because ALL_MODULES is a frozenset now — an unsorted join
        # gives the same request a differently-ordered error message on every
        # process, which is miserable to search for in a log.
        raise HTTPException(400, f"Unknown module: {module_code}. Valid: {', '.join(sorted(ALL_MODULES))}")
    pool = await get_pool()
    org = await pool.fetchval("SELECT id FROM staging.organisations WHERE id=$1::uuid", org_id)
    if not org:
        raise HTTPException(404, "Organisation not found")
    await pool.execute(
        "INSERT INTO staging.module_subscriptions (org_id, module_code, is_active) "
        "VALUES ($1::uuid, $2, TRUE) "
        "ON CONFLICT (org_id, module_code) DO UPDATE SET is_active=TRUE, activated_at=NOW()",
        org_id, module_code,
    )
    await _log_event(pool, org_id, "module_enabled", {
        "module": module_code, "by": user["user_id"],
    })
    return {"status": "enabled", "module": module_code}


@router.delete("/{org_id}/modules/{module_code}")
async def disable_module(
    org_id: str,
    module_code: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    if module_code not in ALL_MODULES:
        raise HTTPException(400, f"Unknown module: {module_code}")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.module_subscriptions SET is_active=FALSE "
        "WHERE org_id=$1::uuid AND module_code=$2",
        org_id, module_code,
    )
    await _log_event(pool, org_id, "module_disabled", {
        "module": module_code, "by": user["user_id"],
    })
    return {"status": "disabled", "module": module_code}


# ── Per-user Module Grants ─────────────────────────────────


class ModuleGrantBody(BaseModel):
    user_id: str
    modules: list[str]


@router.put("/{org_id}/members/{target_user_id}/modules")
async def set_member_modules(
    org_id: str,
    target_user_id: str,
    body: ModuleGrantBody,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Replace a member's module grants with the given list."""
    pool = await get_pool()
    for mc in body.modules:
        if mc not in ALL_MODULES:
            raise HTTPException(400, f"Unknown module: {mc}")

    await pool.execute(
        "DELETE FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    for mc in body.modules:
        await pool.execute(
            "INSERT INTO staging.org_member_modules (user_id, org_id, module_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4)",
            target_user_id, org_id, mc, user["user_id"],
        )

    await _log_event(pool, org_id, "member_modules_updated", {
        "target": target_user_id,
        "modules": body.modules,
        "by": user["user_id"],
    })

    return {"status": "updated", "user_id": target_user_id, "modules": body.modules}


@router.get("/{org_id}/members/{target_user_id}/modules")
async def get_member_modules(
    org_id: str,
    target_user_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Get a member's module grants."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT module_code, granted_at FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    return {"user_id": target_user_id, "modules": [dict(r) for r in rows]}


# ── R2 Credentials ──────────────────────────────────────────

@router.post("/r2/verify")
async def verify_r2(
    body: R2Credentials,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Test R2 credentials before assigning to an org."""
    result = await verify_r2_credentials(
        body.account_id, body.access_key_id, body.secret_access_key,
    )
    return result


@router.put("/{org_id}/r2")
async def set_org_r2(
    org_id: str,
    body: R2Credentials,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Set or update R2 credentials for an org."""
    pool = await get_pool()

    result = await verify_r2_credentials(
        body.account_id, body.access_key_id, body.secret_access_key,
    )
    if not result["valid"]:
        raise HTTPException(400, f"R2 credentials invalid: {result['error']}")

    await pool.execute(
        "UPDATE staging.organisations SET "
        "r2_account_id=$1, r2_access_key_id=$2, r2_secret_access_key=$3, "
        "r2_bucket_name=$4 WHERE id=$5::uuid",
        body.account_id, body.access_key_id, body.secret_access_key,
        body.bucket_name, org_id,
    )

    clear_org_r2_cache(org_id)

    bucket = await create_org_bucket(org_id)

    await _log_event(pool, org_id, "r2_configured", {
        "bucket": bucket,
        "set_by": user["user_id"],
    })

    return {"status": "configured", "bucket": bucket, "valid": True}


# ── Storage Analytics ───────────────────────────────────────

@router.get("/{org_id}/storage")
async def get_storage_usage(
    org_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Get org storage usage and R2 cost estimate."""
    pool = await get_pool()
    org = await pool.fetchrow(
        "SELECT storage_used_bytes, storage_limit_bytes, r2_prefix "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    used_gb = org["storage_used_bytes"] / (1024**3)
    r2_cost_per_gb = 0.015
    margin = 1.20
    monthly_cost = max(0, used_gb * r2_cost_per_gb * margin)

    return {
        "storage_used_bytes": org["storage_used_bytes"],
        "storage_limit_bytes": org["storage_limit_bytes"],
        "used_gb": round(used_gb, 3),
        "limit_gb": round(org["storage_limit_bytes"] / (1024**3), 1),
        "r2_cost_usd": round(used_gb * r2_cost_per_gb, 4),
        "billed_usd": round(monthly_cost, 4),
        "margin_pct": 20,
    }


# ── Cost Aggregation (per-org) ─────────────────────────────

@router.get("/{org_id}/cost-breakdown")
async def org_cost_breakdown(
    org_id: str,
    period: str = "30d",
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """Per-org cost breakdown: AI by provider+model, scraper by type, daily trend."""
    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org_row = await pool.fetchrow(
        "SELECT id, markup_pct, monthly_credits, monthly_price FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    if not org_row:
        raise HTTPException(404, "Organisation not found")
    org_markup = float(org_row["markup_pct"])

    ai_costs = await pool.fetch(
        "SELECT l.provider, l.model, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, "
        "COUNT(*) as call_count, "
        "COALESCE(SUM(l.prompt_tokens), 0) as prompt_tokens, "
        "COALESCE(SUM(l.completion_tokens), 0) as completion_tokens "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "GROUP BY l.provider, l.model "
        "ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    scraper_costs = await pool.fetch(
        "SELECT r.scraper_id, "
        "COALESCE(SUM(r.cost_usd), 0) as cost_usd, "
        "COALESCE(SUM(r.billed_inr), 0) as billed_inr, "
        "COUNT(*) as run_count "
        "FROM staging.hub_scraper_runs r "
        "WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "GROUP BY r.scraper_id "
        "ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    total_ai = sum(float(r["cost_usd"]) for r in ai_costs)
    total_scraper = sum(float(r["cost_usd"]) for r in scraper_costs)

    # Per-client breakdown within this org
    per_client_costs = await pool.fetch(
        "SELECT c.id as client_id, c.name as client_name, "
        "COALESCE(SUM(l.cost_usd), 0) as ai_cost_usd, "
        "COUNT(l.id) as ai_calls "
        "FROM staging.hub_clients c "
        "LEFT JOIN staging.hub_ai_logs l ON l.client_id = c.id AND l.created_at >= $2 "
        "WHERE c.org_id = $1::uuid "
        "GROUP BY c.id, c.name ORDER BY ai_cost_usd DESC",
        org_id, cutoff,
    )

    # Credit usage stats
    credit_balance = await pool.fetchval(
        "SELECT COALESCE(w.balance, 0) "
        "FROM staging.hub_credit_wallets w "
        "JOIN staging.hub_clients c ON c.id = w.client_id "
        "WHERE c.org_id = $1::uuid "
        "ORDER BY w.balance DESC LIMIT 1",
        org_id,
    ) or 0

    org_credits = await pool.fetchrow(
        "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid",
        org_id,
    )

    credits_used = await pool.fetchval(
        "SELECT COALESCE(SUM(credits_used), 0) FROM staging.hub_content_items "
        "WHERE org_id=$1::uuid AND created_at >= $2",
        org_id, cutoff,
    ) or 0

    daily_trend = await pool.fetch(
        "WITH days AS ("
        "  SELECT d::date as day FROM generate_series($2::date, CURRENT_DATE, '1 day') d"
        "), ai_daily AS ("
        "  SELECT l.created_at::date as day, SUM(l.cost_usd) as cost "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "  GROUP BY 1"
        "), sc_daily AS ("
        "  SELECT r.created_at::date as day, SUM(r.cost_usd) as cost "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "  GROUP BY 1"
        ") "
        "SELECT d.day, COALESCE(a.cost, 0) as ai_cost, COALESCE(s.cost, 0) as scraper_cost "
        "FROM days d "
        "LEFT JOIN ai_daily a ON a.day = d.day "
        "LEFT JOIN sc_daily s ON s.day = d.day "
        "ORDER BY d.day",
        org_id, start,
    )

    total_cost = total_ai + total_scraper
    rate = await get_usd_inr()

    return {
        "period": period,
        "org_id": org_id,
        "markup_pct": org_markup,
        "monthly_credits": org_row["monthly_credits"] or 0,
        "monthly_price": float(org_row["monthly_price"]) if org_row["monthly_price"] else 0,
        "usd_to_inr": rate,
        "ai_costs": [
            {"provider": r["provider"], "model": r["model"],
             "cost_usd": float(r["cost_usd"]),
             "cost": _with_inr(float(r["cost_usd"]), rate, org_markup),
             "call_count": r["call_count"],
             "prompt_tokens": r["prompt_tokens"],
             "completion_tokens": r["completion_tokens"]}
            for r in ai_costs
        ],
        "scraper_costs": [
            {"scraper_id": r["scraper_id"], "cost_usd": float(r["cost_usd"]),
             "cost": _with_inr(float(r["cost_usd"]), rate, org_markup),
             "billed_inr": float(r["billed_inr"]), "run_count": r["run_count"]}
            for r in scraper_costs
        ],
        "per_client": [
            {"client_id": str(r["client_id"]), "client_name": r["client_name"],
             "ai_cost_usd": float(r["ai_cost_usd"]),
             "ai_cost": _with_inr(float(r["ai_cost_usd"]), rate, org_markup),
             "ai_calls": r["ai_calls"]}
            for r in per_client_costs
        ],
        "total_ai_cost_usd": total_ai,
        "total_scraper_cost_usd": total_scraper,
        "total_cost_usd": total_cost,
        "total": _with_inr(total_cost, rate, org_markup),
        "ai": _with_inr(total_ai, rate, org_markup),
        "scraper": _with_inr(total_scraper, rate, org_markup),
        "credit_balance": credit_balance,
        "org_credits_balance": org_credits["balance"] if org_credits else 0,
        "credits_used_period": credits_used,
        "daily_trend": [
            {"date": r["day"].isoformat(),
             "ai_cost": float(r["ai_cost"]),
             "scraper_cost": float(r["scraper_cost"])}
            for r in daily_trend
        ],
    }


@router.get("/{org_id}/cost-report-pdf")
async def admin_org_cost_report_pdf(
    org_id: str,
    period: str = "30d",
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """Admin generates client cost report PDF for any org."""
    from fastapi.responses import Response
    from services.cost_report_pdf import generate_cost_report_pdf

    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.markup_pct, o.authorized_signatory_name, o.authorized_signatory_designation, "
        "p.name as plan_name "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

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

    pdf_markup = float(org["markup_pct"])

    def _charge(usd):
        return math.ceil(float(usd) * rate * (1 + pdf_markup))

    report_data = {
        "org_name": org["name"],
        "plan_name": org["plan_name"] or "Free",
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
        "signatory_name": org["authorized_signatory_name"] or "",
        "signatory_designation": org["authorized_signatory_designation"] or "",
    }

    pdf_bytes = generate_cost_report_pdf(report_data)
    filename = f"CostReport-{org['name']}-{start.strftime('%b%Y')}-{date.today().strftime('%d%b%Y')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Credit Management ──────────────────────────────────────

@router.post("/{org_id}/credits/topup")
async def admin_topup_credits(
    org_id: str,
    body: dict,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Aekam tops up org credits. Preset or custom amount."""
    pool = await get_pool()
    amount = body.get("amount")
    if not amount or int(amount) <= 0:
        raise HTTPException(400, "amount must be a positive integer")
    amount = int(amount)
    notes = body.get("notes", "")

    async with pool.acquire() as conn:
        async with conn.transaction():
            wallet = await conn.fetchrow(
                "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid FOR UPDATE",
                org_id,
            )
            if not wallet:
                await conn.execute(
                    "INSERT INTO staging.hub_org_credits (org_id, balance) VALUES ($1::uuid, 0)",
                    org_id,
                )
                wallet = {"balance": 0}
            new_balance = wallet["balance"] + amount
            await conn.execute(
                "UPDATE staging.hub_org_credits SET balance=$1, updated_at=NOW() WHERE org_id=$2::uuid",
                new_balance, org_id,
            )
            await conn.execute(
                "INSERT INTO staging.hub_org_credit_transactions "
                "(org_id, amount, balance_after, tx_type, description, created_by) "
                "VALUES ($1::uuid, $2, $3, 'topup', $4, $5)",
                org_id, amount, new_balance,
                notes or f"Admin top-up: {amount} credits",
                user["user_id"],
            )
    return {"balance": new_balance, "added": amount}


@router.get("/{org_id}/credits/usage")
async def admin_credit_usage(
    org_id: str,
    start_date: str = None,
    end_date: str = None,
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """Credit usage report for an org. Date range filter."""
    pool = await get_pool()
    if not start_date:
        s = date.today().replace(day=1)
    else:
        s = date.fromisoformat(start_date)
    if not end_date:
        e = date.today()
    else:
        e = date.fromisoformat(end_date)

    cutoff_start = datetime.combine(s, datetime.min.time(), tzinfo=timezone.utc)
    cutoff_end = datetime.combine(e + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.monthly_credits, o.monthly_price, p.name as plan_name, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions sub ON sub.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = sub.plan_id "
        "WHERE o.id=$1::uuid", org_id,
    )
    wallet = await pool.fetchrow(
        "SELECT balance, credits_reset_at FROM staging.hub_org_credits WHERE org_id=$1::uuid",
        org_id,
    )

    transactions = await pool.fetch(
        "SELECT id, user_id, amount, balance_after, tx_type, description, created_at "
        "FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid AND created_at >= $2 AND created_at < $3 "
        "ORDER BY created_at DESC",
        org_id, cutoff_start, cutoff_end,
    )

    total_debits = sum(abs(r["amount"]) for r in transactions if r["tx_type"] == "debit")
    total_topups = sum(r["amount"] for r in transactions if r["tx_type"] == "topup")
    total_resets = sum(r["amount"] for r in transactions if r["tx_type"] == "reset")

    by_type = {}
    for r in transactions:
        if r["tx_type"] == "debit" and r["description"]:
            key = r["description"].replace(" generation", "")
            by_type[key] = by_type.get(key, 0) + abs(r["amount"])

    return {
        "org_id": org_id,
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "monthly_credits": (org["monthly_credits"] or org["default_credits"] or 0) if org else 0,
        "monthly_price": float(org["monthly_price"]) if org and org["monthly_price"] else 0,
        "current_balance": wallet["balance"] if wallet else 0,
        "last_reset": wallet["credits_reset_at"].isoformat() if wallet and wallet["credits_reset_at"] else None,
        "period_start": s.isoformat(),
        "period_end": e.isoformat(),
        "total_debits": total_debits,
        "total_topups": total_topups,
        "total_resets": total_resets,
        "usage_by_type": by_type,
        "transactions": [
            {
                "id": str(r["id"]),
                "user_id": r["user_id"],
                "amount": r["amount"],
                "balance_after": r["balance_after"],
                "type": r["tx_type"],
                "description": r["description"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in transactions
        ],
    }


# ── Helpers ─────────────────────────────────────────────────

async def _log_event(pool, org_id: str, event_type: str, metadata: dict):
    await pool.execute(
        "INSERT INTO staging.subscription_events (org_id, event_type, metadata) "
        "VALUES ($1::uuid, $2, $3::jsonb)",
        org_id, event_type, json.dumps(metadata),
    )
