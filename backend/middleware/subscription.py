"""
subscription.py — Feature gating middleware.
Use require_module("srijan") as a FastAPI dependency to restrict endpoints
to orgs that have that module active.

Srijan is a bundled module — included in every paid plan. Other modules
(graha, manav, etc.) are activated per-org by admin.
"""
from datetime import datetime, timezone, timedelta
from fastapi import Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from services.audit import emit as audit

_cache: dict = {}
_CACHE_TTL = timedelta(minutes=5)
_CACHE_MAX_SIZE = 2000

BUNDLED_MODULES = {"srijan", "esign"}

# Modules holding payroll, financial records, HR files or biometric attendance.
# `pahchan` is here because its rows are face-match scores and selfies against a
# named employee — biometric-adjacent data that is at least as sensitive as the
# HR file it attaches to, and the standing constraints already single it out.
SENSITIVE_MODULES = {"vetana", "ganit", "manav", "pahchan"}

# Platform roles that may cross into a customer's *operational* data.
# `account_manager` is deliberately absent: it is a commercial role — create
# orgs, toggle modules, chase invoices — and PLAN_ROLES §2.1 grants it no
# customer data at all. It previously bypassed this gate for every module in
# every org, which meant whoever ran the commercial side could read any
# customer's payroll, Aadhaar and attendance without leaving a trace.
OPERATIONAL_PLATFORM_ROLES = ("platform_admin",)

# Roles that may bypass the per-user grant check on a non-sensitive module.
SUPPORT_PLATFORM_ROLES = ("platform_admin", "account_manager")


def require_module(module_code: str):
    """Returns a FastAPI dependency that checks if the org has the module active
    AND the user has been granted access to this module."""

    async def _check(request: Request, org_id: str = Depends(get_org_id)):
        # get_org_id depends on require_user, so _auth_user is guaranteed set
        user = getattr(request.state, "_auth_user", None)

        pool = await get_pool()

        # Platform staff bypass the per-user module grant check.
        #
        # Two tiers, because the two kinds of module are not the same risk.
        #
        # Non-sensitive modules (Kartavya, Graha, Prachar, …): platform_admin
        # and account_manager both pass, and the pass is silent. That is a
        # volume decision — this dependency guards ~400 endpoints and a row per
        # request is a product call, not one to make inside a middleware.
        #
        # Sensitive modules (payroll, accounting, HR, biometric attendance):
        # only platform_admin passes, and every pass writes an audit row. The
        # volume objection does not apply here — these are a small minority of
        # requests, made rarely by three people — so the standing rule that
        # support access is never silent is enforced rather than deferred.
        # account_manager is refused outright: a commercial role has no business
        # in a customer's salary register or Aadhaar file.
        if user:
            # A user can hold several platform rows. Order so the strongest
            # wins — otherwise someone who is both platform_admin and
            # account_manager would be refused or admitted at random depending
            # on row order, and the audit row would name the wrong role.
            platform_role = await pool.fetchval(
                "SELECT role_code FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code = ANY($2::text[]) "
                "ORDER BY (role_code = 'platform_admin') DESC LIMIT 1",
                user.get("user_id"), list(SUPPORT_PLATFORM_ROLES),
            )
            if platform_role:
                if module_code not in SENSITIVE_MODULES:
                    return
                if platform_role in OPERATIONAL_PLATFORM_ROLES:
                    audit(
                        "platform.sensitive_module_access",
                        request,
                        org_id=org_id,
                        user_id=user.get("user_id"),
                        resource_type="module",
                        resource_id=module_code,
                        detail={
                            "role": platform_role,
                            "path": str(request.url.path),
                            "method": request.method,
                            "via": "platform_bypass",
                        },
                        severity="warn",
                    )
                    return
                raise HTTPException(
                    403,
                    f"The {platform_role} role cannot access the {module_code} "
                    "module. It holds payroll, financial, HR or biometric data.",
                )

        # Gate 2: per-user module grant (before subscription check for fast 403)
        if user:
            user_id = user.get("user_id")
            # org_owner and org_admin get all enabled modules
            org_role = await pool.fetchval(
                "SELECT role_code FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id=$2::uuid "
                "AND role_code IN ('org_owner','org_admin')",
                user_id, org_id,
            )
            if not org_role:
                # org_member needs explicit grant
                has_grant = await pool.fetchval(
                    "SELECT 1 FROM staging.org_member_modules "
                    "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
                    user_id, org_id, module_code,
                )
                if not has_grant:
                    raise HTTPException(
                        403,
                        f"You don't have access to the {module_code} module. "
                        "Ask your org admin to grant it.",
                    )

        cache_key = f"{org_id}:{module_code}"
        now = datetime.now(timezone.utc)

        if len(_cache) > _CACHE_MAX_SIZE:
            _cache.clear()

        if cache_key in _cache:
            cached_at, is_active = _cache[cache_key]
            if now - cached_at < _CACHE_TTL:
                if not is_active:
                    raise HTTPException(
                        403,
                        f"Module '{module_code}' is not active. "
                        "Contact your administrator to activate it.",
                    )
                return

        sub = await pool.fetchrow(
            "SELECT s.status, p.features FROM staging.subscriptions s "
            "JOIN staging.plans p ON p.id = s.plan_id "
            "WHERE s.org_id=$1::uuid",
            org_id,
        )
        if not sub or sub["status"] in ("cancelled", "paused"):
            _cache[cache_key] = (now, False)
            raise HTTPException(403, "Subscription is not active")

        if module_code in BUNDLED_MODULES:
            features = sub["features"] if isinstance(sub["features"], dict) else {}
            if features.get(module_code):
                _cache[cache_key] = (now, True)
                return
            else:
                _cache[cache_key] = (now, False)
                raise HTTPException(
                    403,
                    f"Module '{module_code}' requires a paid plan. "
                    "Contact your administrator to upgrade.",
                )

        mod = await pool.fetchval(
            "SELECT 1 FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
            org_id, module_code,
        )

        is_active = mod is not None
        _cache[cache_key] = (now, is_active)

        if not is_active:
            raise HTTPException(
                403,
                f"Module '{module_code}' is not active. "
                "Contact your administrator to activate it.",
            )

    return _check


def clear_module_cache(org_id: str = None):
    """Clear cache when subscription changes. Call after activate/deactivate."""
    if org_id:
        keys = [k for k in _cache if k.startswith(f"{org_id}:")]
        for k in keys:
            del _cache[k]
    else:
        _cache.clear()
