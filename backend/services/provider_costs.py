"""
provider_costs.py — Fetch account-level usage from third-party AI/scraper
providers for cost reconciliation against internal tracking.
"""
import logging
import os

import httpx

log = logging.getLogger(__name__)


async def get_openrouter_account_usage() -> dict:
    """Fetch account-level usage from OpenRouter API."""
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        return {"error": "OPENROUTER_API_KEY not configured"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/auth/key",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
        return {
            "total_spend_usd": data.get("usage", 0),
            "credits_remaining": data.get("limit", 0) - data.get("usage", 0)
            if data.get("limit")
            else None,
            "limit": data.get("limit"),
            "label": data.get("label", ""),
            "rate_limit": data.get("rate_limit"),
        }
    except Exception as exc:
        log.warning("OpenRouter account API failed: %s", exc)
        return {"error": str(exc)}


async def get_apify_account_usage(months: int = 1) -> dict:
    """Fetch account-level usage from Apify API."""
    token = os.getenv("APIFY_API_KEY", "")
    if not token:
        return {"error": "APIFY_API_KEY not configured"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Get monthly usage stats
            resp = await client.get(
                "https://api.apify.com/v2/users/me/usage",
                params={"token": token, "months": months},
            )
            resp.raise_for_status()
            usage = resp.json()["data"]

            # Also get recent runs count for context
            runs_resp = await client.get(
                "https://api.apify.com/v2/actor-runs",
                params={"token": token, "limit": 1, "desc": "true"},
            )
            runs_resp.raise_for_status()
            runs_data = runs_resp.json()["data"]
            total_runs = runs_data.get("total", 0)

        # Sum monthly costs
        monthly = usage.get("monthlyUsage", [])
        total_spend = sum(m.get("totalCostUsd", 0) for m in monthly)

        return {
            "total_spend_usd": total_spend,
            "runs_count": total_runs,
            "monthly_breakdown": [
                {
                    "month": m.get("month"),
                    "cost_usd": m.get("totalCostUsd", 0),
                }
                for m in monthly
            ],
        }
    except Exception as exc:
        log.warning("Apify account API failed: %s", exc)
        return {"error": str(exc)}


def get_huggingface_usage() -> dict:
    """HF Inference API free tier — zero cost."""
    return {"total_spend_usd": 0, "tier": "free"}


async def get_all_provider_costs() -> dict:
    """Aggregate costs from all providers."""
    openrouter = await get_openrouter_account_usage()
    apify = await get_apify_account_usage()
    huggingface = get_huggingface_usage()

    return {
        "openrouter": openrouter,
        "apify": apify,
        "huggingface": huggingface,
    }
