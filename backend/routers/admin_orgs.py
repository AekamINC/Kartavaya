"""
admin_orgs.py — Platform admin: org creation, member assignment, role management,
cost aggregation analytics.
Only platform_admin / account_manager can access these endpoints.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.roles import require_platform_role
from services.storage import create_org_bucket, verify_r2_credentials, clear_org_r2_cache

router = APIRouter(prefix="/api/v1/admin/orgs", tags=["admin-orgs"])

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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
        "SELECT id, code FROM staging.plans WHERE code=$1 AND is_active=TRUE",
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

    await pool.execute(
        "INSERT INTO staging.organisations "
        "(id, team_id, name, owner_user_id, r2_account_id, r2_access_key_id, "
        " r2_secret_access_key, r2_bucket_name, storage_limit_bytes, is_active) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)",
        org_id, tm["team_id"], body.name, owner["user_id"],
        r2_account_id, r2_access_key, r2_secret_key, r2_bucket,
        storage_limit,
    )

    bucket_name = None
    if body.r2:
        bucket_name = await create_org_bucket(str(org_id))

    await pool.execute(
        "INSERT INTO staging.subscriptions (org_id, plan_id, status) "
        "VALUES ($1, $2, 'active')",
        org_id, plan["id"],
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
    user=Depends(require_platform_role("platform_admin", "account_manager", "account_finance")),
):
    """List all orgs with plan and owner info."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT o.id, o.name, o.team_id, o.owner_user_id, o.is_active, "
        "o.storage_used_bytes, o.storage_limit_bytes, o.created_at, "
        "p.code as plan_code, p.name as plan_name, "
        "u.email as owner_email, u.full_name as owner_name "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN users u ON u.user_id = o.owner_user_id "
        "ORDER BY o.created_at DESC"
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/{org_id}")
async def get_org(
    org_id: str,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
):
    """Get org details including members and roles."""
    pool = await get_pool()
    org = await pool.fetchrow(
        "SELECT o.id, o.team_id, o.name, o.owner_user_id, o.is_active, "
        "o.r2_account_id, o.r2_bucket_name, o.storage_limit_bytes, "
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
    user=Depends(require_platform_role("platform_admin")),
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


# ── Member Management ───────────────────────────────────────

@router.post("/{org_id}/members")
async def add_member(
    org_id: str,
    body: OrgMemberAdd,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
    SENSITIVE = {"vetana", "ganit", "manav"}
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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
    user=Depends(require_platform_role("platform_admin")),
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
    user=Depends(require_platform_role("platform_admin")),
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
    user=Depends(require_platform_role("platform_admin")),
):
    """Assign any role (platform or org-scoped) to a user."""
    pool = await get_pool()

    target = await pool.fetchval("SELECT 1 FROM users WHERE user_id=$1", body.user_id)
    if not target:
        raise HTTPException(404, "User not found")

    platform_roles = {"platform_admin", "account_manager", "account_finance", "developer", "srijan_admin"}
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
    user=Depends(require_platform_role("platform_admin")),
):
    pool = await get_pool()
    await pool.execute("DELETE FROM staging.user_roles WHERE id=$1::uuid", role_id)
    return {"status": "revoked"}


# ── Module Management ──────────────────────────────────────

ALL_MODULES = [
    "graha", "ganit", "manav", "vikray", "vetana",
    "dristi", "prachar", "srijan",
]


@router.post("/{org_id}/modules/{module_code}")
async def enable_module(
    org_id: str,
    module_code: str,
    user=Depends(require_platform_role("platform_admin", "account_manager")),
):
    if module_code not in ALL_MODULES:
        raise HTTPException(400, f"Unknown module: {module_code}. Valid: {', '.join(ALL_MODULES)}")
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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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
    user=Depends(require_platform_role("platform_admin")),
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
    user=Depends(require_platform_role("platform_admin", "account_manager")),
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


# ── Cost Aggregation ───────────────────────────────────────

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
    user=Depends(require_platform_role("platform_admin", "account_finance")),
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

    total_revenue_inr = await pool.fetchval(
        "SELECT COALESCE(SUM(total), 0) FROM staging.subscription_invoices "
        "WHERE payment_status='paid' AND paid_at >= $1",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    ) or 0

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
        "SELECT o.id as org_id, o.name as org_name, "
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

    return {
        "period": period,
        "total_orgs": total_orgs,
        "total_users": total_users,
        "total_revenue_inr": float(total_revenue_inr),
        "total_ai_cost_usd": float(ai_stats["total_cost"]),
        "total_scraper_cost_usd": float(total_scraper_cost),
        "total_ai_calls": ai_stats["total_calls"],
        "ai_cost_by_provider": [
            {"provider": r["provider"], "cost_usd": float(r["cost_usd"]),
             "call_count": r["call_count"]}
            for r in by_provider
        ],
        "top_orgs_by_spend": [
            {"org_id": str(r["org_id"]), "org_name": r["org_name"],
             "ai_cost_usd": float(r["ai_cost_usd"]),
             "scraper_cost_usd": float(r["scraper_cost_usd"]),
             "total_cost_usd": float(r["total_cost_usd"])}
            for r in top_orgs
        ],
    }


@router.get("/cost-summary")
async def all_orgs_cost_summary(
    period: str = "30d",
    user=Depends(require_platform_role("platform_admin", "account_finance")),
):
    """All orgs cost summary table for admin cost dashboard."""
    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    rows = await pool.fetch(
        "SELECT o.id as org_id, o.name as org_name, "
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

    return {
        "period": period,
        "data": [
            {
                "org_id": str(r["org_id"]),
                "org_name": r["org_name"],
                "plan_name": r["plan_name"],
                "ai_cost_usd": float(r["ai_cost_usd"]),
                "scraper_cost_usd": float(r["scraper_cost_usd"]),
                "total_cost_usd": float(r["total_cost_usd"]),
                "ai_calls": r["ai_calls"],
                "last_active": r["last_active"].isoformat() if r["last_active"] else None,
            }
            for r in rows
        ],
    }


@router.get("/{org_id}/cost-breakdown")
async def org_cost_breakdown(
    org_id: str,
    period: str = "30d",
    user=Depends(require_platform_role("platform_admin", "account_manager", "account_finance")),
):
    """Per-org cost breakdown: AI by provider+model, scraper by type, daily trend."""
    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchval(
        "SELECT id FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

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

    credit_balance = await pool.fetchval(
        "SELECT COALESCE(w.balance, 0) "
        "FROM staging.hub_credit_wallets w "
        "JOIN staging.hub_clients c ON c.id = w.client_id "
        "WHERE c.org_id = $1::uuid "
        "ORDER BY w.balance DESC LIMIT 1",
        org_id,
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

    return {
        "period": period,
        "org_id": org_id,
        "ai_costs": [
            {"provider": r["provider"], "model": r["model"],
             "cost_usd": float(r["cost_usd"]), "call_count": r["call_count"],
             "prompt_tokens": r["prompt_tokens"],
             "completion_tokens": r["completion_tokens"]}
            for r in ai_costs
        ],
        "scraper_costs": [
            {"scraper_id": r["scraper_id"], "cost_usd": float(r["cost_usd"]),
             "billed_inr": float(r["billed_inr"]), "run_count": r["run_count"]}
            for r in scraper_costs
        ],
        "total_ai_cost_usd": total_ai,
        "total_scraper_cost_usd": total_scraper,
        "total_cost_usd": total_ai + total_scraper,
        "credit_balance": credit_balance,
        "daily_trend": [
            {"date": r["day"].isoformat(),
             "ai_cost": float(r["ai_cost"]),
             "scraper_cost": float(r["scraper_cost"])}
            for r in daily_trend
        ],
    }


# ── Helpers ─────────────────────────────────────────────────

async def _log_event(pool, org_id: str, event_type: str, metadata: dict):
    await pool.execute(
        "INSERT INTO staging.subscription_events (org_id, event_type, metadata) "
        "VALUES ($1::uuid, $2, $3::jsonb)",
        org_id, event_type, json.dumps(metadata),
    )
