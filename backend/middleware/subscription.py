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

BUNDLED_MODULES = {"srijan"}


def require_module(module_code: str):
    """Returns a FastAPI dependency that checks if the org has the module active.
    Bundled modules (srijan) only need an active subscription — no separate activation."""

    async def _check(request: Request, org_id: str = Depends(get_org_id)):
        user = getattr(request.state, "_auth_user", None)
        if user and user.get("role") == "admin":
            return

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

        pool = await get_pool()

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
