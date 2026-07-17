"""
ad_insights.py — Ingest ad performance data from Meta Marketing API.
Normalises platform-specific formats into prachar_ad_* tables.
"""
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

META_GRAPH_URL = "https://graph.facebook.com/v21.0"


async def fetch_meta_ad_accounts(access_token: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{META_GRAPH_URL}/me/adaccounts",
            params={
                "fields": "name,currency,account_status,amount_spent",
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        return resp.json().get("data", [])


async def fetch_meta_campaigns(access_token: str, ad_account_id: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{META_GRAPH_URL}/{ad_account_id}/campaigns",
            params={
                "fields": "name,status,objective,daily_budget,lifetime_budget",
                "limit": "500",
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        return resp.json().get("data", [])


async def fetch_meta_insights(
    access_token: str, ad_account_id: str, date_preset: str = "last_30d"
) -> list[dict]:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(
            f"{META_GRAPH_URL}/{ad_account_id}/insights",
            params={
                "fields": "campaign_id,campaign_name,spend,impressions,clicks,"
                          "ctr,cpc,cpm,actions,cost_per_action_type,"
                          "purchase_roas",
                "level": "campaign",
                "time_increment": "1",
                "date_preset": date_preset,
                "limit": "1000",
                "access_token": access_token,
            },
        )
        resp.raise_for_status()
        return resp.json().get("data", [])


def _extract_conversions(actions: list[dict] | None) -> int:
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase", "lead"):
            return int(a.get("value", 0))
    return 0


def _extract_roas(purchase_roas: list[dict] | None) -> float:
    if not purchase_roas:
        return 0.0
    for r in purchase_roas:
        if r.get("action_type") == "omni_purchase":
            return float(r.get("value", 0))
    return float(purchase_roas[0].get("value", 0)) if purchase_roas else 0.0


async def sync_meta_account(pool, org_id: str, social_account_id: str) -> dict:
    """Full sync: refresh token → fetch accounts → campaigns → insights → upsert."""
    from services.social_publisher import _refresh_meta_token

    row = await pool.fetchrow(
        "SELECT id, access_token, platform_data FROM staging.hub_social_accounts "
        "WHERE id=$1::uuid",
        social_account_id,
    )
    if not row:
        return {"error": "Social account not found"}

    token = await _refresh_meta_token(pool, str(row["id"]), row["access_token"])

    ad_accounts = await fetch_meta_ad_accounts(token)
    if not ad_accounts:
        return {"error": "No ad accounts found", "synced": 0}

    total_campaigns = 0
    total_insights = 0

    for acct in ad_accounts:
        if acct.get("account_status") != 1:
            continue

        ext_id = acct["id"]
        acct_row = await pool.fetchrow(
            "INSERT INTO staging.prachar_ad_accounts "
            "(org_id, platform, external_account_id, name, currency, social_account_id) "
            "VALUES ($1::uuid, 'meta', $2, $3, $4, $5::uuid) "
            "ON CONFLICT (org_id, platform, external_account_id) "
            "DO UPDATE SET name=$3, last_synced_at=NOW() "
            "RETURNING id",
            org_id, ext_id, acct.get("name", ext_id),
            acct.get("currency", "INR"), social_account_id,
        )
        account_id = acct_row["id"]

        campaigns = await fetch_meta_campaigns(token, ext_id)
        for camp in campaigns:
            camp_row = await pool.fetchrow(
                "INSERT INTO staging.prachar_ad_campaigns "
                "(account_id, external_campaign_id, name, status, objective, "
                "daily_budget, lifetime_budget, platform_data) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) "
                "ON CONFLICT (account_id, external_campaign_id) "
                "DO UPDATE SET name=$3, status=$4, objective=$5, "
                "daily_budget=$6, lifetime_budget=$7, platform_data=$8, updated_at=NOW() "
                "RETURNING id",
                account_id, camp["id"], camp.get("name"),
                camp.get("status"), camp.get("objective"),
                _to_decimal(camp.get("daily_budget")),
                _to_decimal(camp.get("lifetime_budget")),
                "{}",
            )
            total_campaigns += 1

        insights = await fetch_meta_insights(token, ext_id)
        for row_data in insights:
            camp_ext_id = row_data.get("campaign_id")
            if not camp_ext_id:
                continue

            camp_id = await pool.fetchval(
                "SELECT id FROM staging.prachar_ad_campaigns "
                "WHERE account_id=$1 AND external_campaign_id=$2",
                account_id, camp_ext_id,
            )
            if not camp_id:
                continue

            date_str = row_data.get("date_start", "")
            if not date_str:
                continue

            await pool.execute(
                "INSERT INTO staging.prachar_ad_insights "
                "(campaign_id, date, spend, impressions, clicks, conversions, "
                "ctr, cpc, cpm, roas, platform_data) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) "
                "ON CONFLICT (campaign_id, date) "
                "DO UPDATE SET spend=$3, impressions=$4, clicks=$5, conversions=$6, "
                "ctr=$7, cpc=$8, cpm=$9, roas=$10, platform_data=$11::jsonb",
                camp_id, date_str,
                float(row_data.get("spend", 0)),
                int(row_data.get("impressions", 0)),
                int(row_data.get("clicks", 0)),
                _extract_conversions(row_data.get("actions")),
                float(row_data.get("ctr", 0)),
                float(row_data.get("cpc", 0)),
                float(row_data.get("cpm", 0)),
                _extract_roas(row_data.get("purchase_roas")),
                __import__("json").dumps(row_data),
            )
            total_insights += 1

    return {
        "accounts": len(ad_accounts),
        "campaigns": total_campaigns,
        "insights": total_insights,
    }


def _to_decimal(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val) / 100  # Meta returns budget in cents
    except (TypeError, ValueError):
        return None
