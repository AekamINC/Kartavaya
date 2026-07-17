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

_cache: dict = {}
_CACHE_TTL = timedelta(minutes=5)

BUNDLED_MODULES = {"srijan", "esign"}

SENSITIVE_MODULES = {"vetana", "ganit", "manav"}


def require_module(module_code: str):
    """Returns a FastAPI dependency that checks if the org has the module active
    AND the user has been granted access to this module."""

    async def _check(request: Request, org_id: str = Depends(get_org_id)):
        user = getattr(request.state, "_auth_user", None)
        if user and user.get("role") == "admin":
            return

        pool = await get_pool()

        # Platform staff (account_manager+) bypass per-user module check
        if user:
            is_platform = await pool.fetchval(
                "SELECT 1 FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code IN ('platform_admin','account_manager')",
                user.get("user_id"),
            )
            if is_platform:
                return  # platform staff can access any module for support

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
