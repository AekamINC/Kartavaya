"""
prachar_ads.py — Ad Insights Router
Meta (and future Google) ad account sync, campaign data, AI analysis.
"""
import json
import logging
import uuid as _uuid
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

router = APIRouter(prefix="/api/v1/prachar/ads", tags=["prachar-ads"])

_gate = require_module("prachar")
log = logging.getLogger(__name__)


class SyncRequest(BaseModel):
    social_account_id: str


class AnalyseRequest(BaseModel):
    brief: str = "Analyse my ad performance and suggest improvements"
    date_from: date | None = None
    date_to: date | None = None
    # `UUID`, not `str`. The value reaches SQL as `$1::uuid`, so a non-uuid string
    # used to travel all the way to asyncpg and come back a 500; typed here it is
    # a 422 that names the field. Every other client route takes it as a path
    # `UUID` and gets this for free.
    client_id: UUID | None = None


# ── Ad Accounts ─────────────────────────────────────────────


@router.get("/accounts", dependencies=[Depends(_gate)])
async def list_ad_accounts(user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    # `account_name`, not `platform_user_name`. The latter has never existed on
    # staging.hub_social_accounts — 017:82-100 declares the table and the column
    # it carries for a connected account's display name is `account_name`.
    #
    # This 500'd on EVERY Prachar page load, and did not look like a 500: the
    # exception escapes before CORSMiddleware attaches headers, so the browser
    # reported a CORS violation and the network tab showed net::ERR_FAILED with
    # no status. The Ads tab then rendered "…appear here once the platform
    # answers", so the page read as empty rather than broken. Confirmed from the
    # Railway traceback: asyncpg.exceptions.UndefinedColumnError.
    #
    # Fixed by renaming the reference rather than adding the column. Adding
    # `platform_user_name` would have given the table two columns for one fact,
    # and `account_name` is already populated by both OAuth callback paths.
    rows = await pool.fetch(
        "SELECT a.*, s.account_name AS social_name "
        "FROM staging.prachar_ad_accounts a "
        "LEFT JOIN staging.hub_social_accounts s ON s.id = a.social_account_id "
        "WHERE a.org_id=$1::uuid ORDER BY a.created_at DESC",
        org_id,
    )
    return [dict(r) for r in rows]


@router.post("/accounts/sync", dependencies=[Depends(_gate)])
async def sync_ad_account(
    body: SyncRequest,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    from services.ad_insights import sync_meta_account

    result = await sync_meta_account(await get_pool(), org_id, body.social_account_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


# ── Campaigns ───────────────────────────────────────────────


@router.get("/campaigns", dependencies=[Depends(_gate)])
async def list_campaigns(
    account_id: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    if account_id:
        rows = await pool.fetch(
            "SELECT c.* FROM staging.prachar_ad_campaigns c "
            "JOIN staging.prachar_ad_accounts a ON a.id = c.account_id "
            "WHERE a.org_id=$1::uuid AND c.account_id=$2::uuid "
            "ORDER BY c.updated_at DESC",
            org_id, account_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT c.* FROM staging.prachar_ad_campaigns c "
            "JOIN staging.prachar_ad_accounts a ON a.id = c.account_id "
            "WHERE a.org_id=$1::uuid ORDER BY c.updated_at DESC",
            org_id,
        )
    return [dict(r) for r in rows]


# ── Insights ────────────────────────────────────────────────


@router.get("/insights", dependencies=[Depends(_gate)])
async def get_insights(
    account_id: str | None = None,
    campaign_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    conditions = ["a.org_id=$1::uuid"]
    params: list = [org_id]
    idx = 2

    if account_id:
        conditions.append(f"c.account_id=${idx}::uuid")
        params.append(account_id)
        idx += 1
    if campaign_id:
        conditions.append(f"i.campaign_id=${idx}::uuid")
        params.append(campaign_id)
        idx += 1
    if date_from:
        conditions.append(f"i.date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"i.date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)
    rows = await pool.fetch(
        f"SELECT i.*, c.name AS campaign_name, c.objective, c.status AS campaign_status "
        f"FROM staging.prachar_ad_insights i "
        f"JOIN staging.prachar_ad_campaigns c ON c.id = i.campaign_id "
        f"JOIN staging.prachar_ad_accounts a ON a.id = c.account_id "
        f"WHERE {where} ORDER BY i.date DESC LIMIT 1000",
        *params,
    )
    return [dict(r) for r in rows]


@router.get("/overview", dependencies=[Depends(_gate)])
async def get_overview(
    days: int = 30,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT "
        "  COALESCE(SUM(i.spend), 0) AS total_spend, "
        "  COALESCE(SUM(i.impressions), 0) AS total_impressions, "
        "  COALESCE(SUM(i.clicks), 0) AS total_clicks, "
        "  COALESCE(SUM(i.conversions), 0) AS total_conversions, "
        "  CASE WHEN SUM(i.impressions) > 0 "
        "    THEN ROUND(SUM(i.clicks)::numeric / SUM(i.impressions) * 100, 2) "
        "    ELSE 0 END AS avg_ctr, "
        "  CASE WHEN SUM(i.clicks) > 0 "
        "    THEN ROUND(SUM(i.spend) / SUM(i.clicks), 2) "
        "    ELSE 0 END AS avg_cpc, "
        "  COUNT(DISTINCT c.id) AS active_campaigns "
        "FROM staging.prachar_ad_insights i "
        "JOIN staging.prachar_ad_campaigns c ON c.id = i.campaign_id "
        "JOIN staging.prachar_ad_accounts a ON a.id = c.account_id "
        "WHERE a.org_id=$1::uuid AND i.date >= CURRENT_DATE - $2::int",
        org_id, days,
    )
    return dict(row)


# ── AI Analysis ─────────────────────────────────────────────


@router.post("/analyse", dependencies=[Depends(_gate)])
async def analyse_ads(
    body: AnalyseRequest,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    # hub.py's helper rather than a fourth spelling of the same SELECT. It is
    # called at 18 sites there and inlined at 6 in hub_chat.py; this route is the
    # one that was written without any of them. Imported in the body to match the
    # other cross-module imports in this file.
    from routers.hub import _verify_client_access
    from services import credits
    from services.ai_router import generate

    pool = await get_pool()

    # THE CHECK THAT WAS NOT HERE. `client_id` arrives on the request body and
    # this route never matched it against the caller's org, while the charge below
    # resolved the PAYER from it — `SELECT org_id FROM hub_clients WHERE id=$1`.
    # So a user signed in to org A could post any client uuid belonging to org B
    # and have org B pay for A's analysis, one ledger row at a time, until B was
    # at zero. It was harmless only while the debit landed in the per-client pot
    # that nothing in the product could spend; metering the real org balance
    # turned it into theft of something real.
    #
    # 404 rather than 403 is `_verify_client_access`'s wording and the right one:
    # "forbidden" would confirm the uuid exists.
    client = (
        await _verify_client_access(pool, str(body.client_id), org_id)
        if body.client_id else None
    )

    conditions = ["a.org_id=$1::uuid"]
    params: list = [org_id]
    idx = 2
    if body.date_from:
        conditions.append(f"i.date >= ${idx}")
        params.append(body.date_from)
        idx += 1
    if body.date_to:
        conditions.append(f"i.date <= ${idx}")
        params.append(body.date_to)
        idx += 1

    where = " AND ".join(conditions)
    rows = await pool.fetch(
        f"SELECT c.name, c.objective, c.status, "
        f"  SUM(i.spend) AS spend, SUM(i.impressions) AS impressions, "
        f"  SUM(i.clicks) AS clicks, SUM(i.conversions) AS conversions, "
        f"  AVG(i.ctr) AS ctr, AVG(i.cpc) AS cpc, AVG(i.roas) AS roas "
        f"FROM staging.prachar_ad_insights i "
        f"JOIN staging.prachar_ad_campaigns c ON c.id = i.campaign_id "
        f"JOIN staging.prachar_ad_accounts a ON a.id = c.account_id "
        f"WHERE {where} "
        f"GROUP BY c.id, c.name, c.objective, c.status "
        f"ORDER BY SUM(i.spend) DESC LIMIT 50",
        *params,
    )

    if not rows:
        raise HTTPException(404, "No ad data found. Sync your ad accounts first.")

    data_summary = "\n".join(
        f"- {r['name']} ({r['objective'] or 'N/A'}): "
        f"spend={float(r['spend']):.2f}, impressions={r['impressions']}, "
        f"clicks={r['clicks']}, conversions={r['conversions']}, "
        f"CTR={float(r['ctr']):.2f}%, CPC={float(r['cpc']):.2f}, ROAS={float(r['roas']):.2f}"
        for r in rows
    )

    # Charged UNCONDITIONALLY, and to the caller's own org. `if body.client_id:`
    # made a 5-credit analysis free for anyone who left one optional field out of
    # the body — and the only caller in the product,
    # `frontend/src/pages/prachar/AdsTab.jsx:262`, has never sent that field. Every
    # ad analysis this product has ever run was therefore free, and the one way to
    # make the route charge was to name somebody else's client.
    #
    # `client_id` now decides nothing about the money, and cannot: the query above
    # is scoped by `a.org_id` alone, so the campaigns analysed are the caller
    # org's whether a client is named or not. The org that reads the answer is the
    # org that pays for it. All the field does now is put a name on the row.
    #
    # After the `404` above, so an org with nothing synced is refused rather than
    # charged for an analysis of no data.
    receipt = await credits.spend_standalone(
        org_id=org_id,
        # Not None. This was called with no user_id at all, so the row it wrote
        # was traceable to nobody — precisely what a spend row must not be.
        user_id=user["user_id"],
        kind="content",
        ref_id="ad_analysis",
        # NO IDEMPOTENCY, stated rather than faked. This route has no unit of work
        # to name — no run row, no client-supplied request id — and a key built
        # from (org, user, brief) would make a second look at the same campaigns
        # after a fresh sync free instead of charged. So a double submit charges
        # twice, exactly as it did before, and exactly as
        # `ai_router._no_idempotency_key` documents for the wrappers this replaces.
        # Give the route a request id and this key becomes a real one.
        idempotency_key=f"adanalysis:{_uuid.uuid4().hex}",
        # Empty means `credits._default_description` — "ad_analysis generation",
        # the same sentence the old wrapper wrote, so nothing reading the ledger
        # shifts. Named clients get the name appended and keep that prefix.
        description=f"ad_analysis generation — {client['name']}" if client else "",
    )

    try:
        result = await generate(
            prompt=f"{body.brief}\n\nCampaign performance data:\n{data_summary}",
            system="You are an expert digital advertising analyst. Analyse the campaign data and provide actionable insights.",
            agent_type="ad_analysis",
            task="analysis",
            org_id=org_id,
        )
    except Exception:
        # Charging first is what stops two concurrent analyses each spending the
        # balance the other is about to take, so the order stays and the refund is
        # the missing half of it. `generate` raises RuntimeError when every
        # provider in the chain is down, and two of them 400 on every request —
        # this is not a hypothetical branch.
        #
        # By tx_id: what was actually taken, not what `ad_analysis` lists at.
        # `refund_standalone` returns None instead of raising, so a failed refund
        # does not put a 500 on top of the outage that lost the credits; it logs
        # what the customer is owed.
        await credits.refund_standalone(
            tx_id=receipt.tx_id,
            reason="Refund — ad analysis did not generate",
            user_id=user["user_id"],
        )
        raise

    return {
        "analysis": result.get("text", ""),
        "campaigns_analysed": len(rows),
        # What it cost and what is left. The screen printed neither, which is how
        # a route that charged nothing looked no different from one that did.
        "credits_used": receipt.credits,
        "balance_after": receipt.balance_after,
    }
