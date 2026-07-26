"""
hub_publish.py — Srijan P4: Social Publishing Router
Connect social accounts via OAuth, schedule content, publish to platforms.
"""
import json
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.social_publisher import publish_content, process_scheduled_posts

router = APIRouter(prefix="/api/v1/hub", tags=["hub-publish"])

_hub_gate = require_module("srijan")
log = logging.getLogger(__name__)

async def _store_oauth_state(state: str, data: dict):
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO staging.hub_oauth_states (state, data) VALUES ($1, $2::jsonb) "
        "ON CONFLICT (state) DO UPDATE SET data=$2::jsonb, created_at=NOW()",
        state, json.dumps(data),
    )

async def _require_client_in_org(pool, client_id: str, org_id: str):
    """Every `/clients/{client_id}/…` route must prove the client belongs to the
    caller's org before touching anything keyed on `client_id`.

    Half the routes in this file did this inline and half did not, so a member
    of any org holding a Srijan grant could read another org's connected social
    accounts, their scheduled posts and their content calendar — and, through
    bulk-schedule, queue a post to another org's account. Nothing about the
    request had to be forged: the id was simply never checked.
    """
    ok = await pool.fetchval(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        client_id, org_id,
    )
    if not ok:
        raise HTTPException(404, "Client not found")


async def _pop_oauth_state(state: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "DELETE FROM staging.hub_oauth_states "
        "WHERE state=$1 AND created_at > NOW() - INTERVAL '10 minutes' "
        "RETURNING data",
        state,
    )
    return json.loads(row["data"]) if row else None

ALL_PLATFORMS = [
    "facebook", "instagram", "linkedin", "google_business", "twitter",
    "youtube", "whatsapp_business", "pinterest", "tiktok",
    "threads", "telegram", "snapchat", "reddit",
]

OAUTH_CONFIGS = {
    "facebook": {
        "auth_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "scopes": "pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish,ads_read",
        "env_id": "META_APP_ID",
        "env_secret": "META_APP_SECRET",
    },
    "instagram": {
        "auth_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "scopes": "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,ads_read",
        "env_id": "META_APP_ID",
        "env_secret": "META_APP_SECRET",
    },
    "linkedin": {
        "auth_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "scopes": "openid profile w_member_social",
        "env_id": "LINKEDIN_CLIENT_ID",
        "env_secret": "LINKEDIN_CLIENT_SECRET",
    },
    "google_business": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "https://www.googleapis.com/auth/business.manage",
        "env_id": "GOOGLE_CLIENT_ID",
        "env_secret": "GOOGLE_CLIENT_SECRET",
    },
    "youtube": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
        "env_id": "GOOGLE_CLIENT_ID",
        "env_secret": "GOOGLE_CLIENT_SECRET",
    },
    "pinterest": {
        "auth_url": "https://www.pinterest.com/oauth/",
        "token_url": "https://api.pinterest.com/v5/oauth/token",
        "scopes": "boards:read,pins:read,pins:write",
        "env_id": "PINTEREST_APP_ID",
        "env_secret": "PINTEREST_APP_SECRET",
    },
    "tiktok": {
        "auth_url": "https://www.tiktok.com/v2/auth/authorize/",
        "token_url": "https://open.tiktokapis.com/v2/oauth/token/",
        "scopes": "video.publish,video.upload",
        "env_id": "TIKTOK_CLIENT_KEY",
        "env_secret": "TIKTOK_CLIENT_SECRET",
    },
    "threads": {
        "auth_url": "https://threads.net/oauth/authorize",
        "token_url": "https://graph.threads.net/oauth/access_token",
        "scopes": "threads_basic,threads_content_publish",
        "env_id": "META_APP_ID",
        "env_secret": "META_APP_SECRET",
    },
    "reddit": {
        "auth_url": "https://www.reddit.com/api/v1/authorize",
        "token_url": "https://www.reddit.com/api/v1/access_token",
        "scopes": "submit,read,identity",
        "env_id": "REDDIT_CLIENT_ID",
        "env_secret": "REDDIT_CLIENT_SECRET",
    },
}


# ── Pydantic Models ──────────────────────────────────────────

class SocialAccountConnect(BaseModel):
    platform: str
    account_name: str = ""
    account_id: str = ""
    page_id: str = ""
    access_token: str
    refresh_token: str = ""
    scopes: list[str] = []

class SchedulePost(BaseModel):
    content_id: str
    social_account_id: str
    scheduled_for: datetime

class BulkSchedule(BaseModel):
    content_id: str
    account_ids: list[str]
    scheduled_for: datetime


# ── OAuth Flow ─────────────────────────────────────────────

@router.get("/oauth/{platform}/authorize")
async def oauth_authorize(
    platform: str,
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Generate OAuth authorization URL for a platform."""
    config = OAUTH_CONFIGS.get(platform)
    if not config:
        raise HTTPException(400, f"Unsupported platform: {platform}")

    app_id = os.getenv(config["env_id"], "")
    if not app_id:
        raise HTTPException(500, f"{config['env_id']} not configured")

    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    redirect_uri = f"{backend_url}/api/v1/hub/oauth/{platform}/callback"

    state = secrets.token_urlsafe(32)
    await _store_oauth_state(state, {
        "platform": platform,
        "client_id": str(client_id),
        "org_id": org_id,
        "user_id": user["user_id"],
    })

    if platform in ("facebook", "instagram"):
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": config["scopes"],
            "state": state,
            "response_type": "code",
        }
    elif platform == "linkedin":
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": config["scopes"],
            "state": state,
            "response_type": "code",
        }
    elif platform == "google_business":
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": config["scopes"],
            "state": state,
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
        }
    else:
        raise HTTPException(400, f"Unsupported platform: {platform}")

    auth_url = f"{config['auth_url']}?{urlencode(params)}"
    return {"auth_url": auth_url, "state": state}


@router.get("/oauth/{platform}/callback")
async def oauth_callback(
    platform: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
):
    """Handle OAuth callback — exchange code for tokens, store account."""
    import httpx

    state_data = await _pop_oauth_state(state)
    if not state_data or state_data["platform"] != platform:
        raise HTTPException(400, "Invalid or expired OAuth state")

    config = OAUTH_CONFIGS.get(platform)
    app_id = os.getenv(config["env_id"], "")
    app_secret = os.getenv(config["env_secret"], "")
    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    redirect_uri = f"{backend_url}/api/v1/hub/oauth/{platform}/callback"

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            config["token_url"],
            data={
                "code": code,
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in")

    from datetime import timedelta
    token_expires_at = None
    if expires_in:
        token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    account_name = ""
    account_id = ""
    page_id = ""

    if platform in ("facebook", "instagram"):
        account_info = await _fetch_meta_accounts(access_token, platform)
        account_name = account_info.get("name", "")
        account_id = account_info.get("id", "")
        page_id = account_info.get("page_id", "")
        if account_info.get("page_token"):
            access_token = account_info["page_token"]
    elif platform == "linkedin":
        account_info = await _fetch_linkedin_profile(access_token)
        account_name = account_info.get("name", "")
        account_id = account_info.get("id", "")
    elif platform == "google_business":
        account_info = await _fetch_google_locations(access_token)
        account_name = account_info.get("name", "")
        account_id = account_info.get("id", "")
        page_id = account_info.get("location_name", "")

    cid = state_data["client_id"]
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO staging.hub_social_accounts "
        "(client_id, platform, account_name, account_id, page_id, "
        " access_token, refresh_token, token_expires_at, scopes, connected_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10) "
        "ON CONFLICT (client_id, platform, account_id) DO UPDATE SET "
        "access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, "
        "token_expires_at=EXCLUDED.token_expires_at, account_name=EXCLUDED.account_name, "
        "page_id=EXCLUDED.page_id, is_active=TRUE, updated_at=NOW()",
        cid, platform, account_name, account_id, page_id,
        access_token, refresh_token or None, token_expires_at,
        config["scopes"].split(","), state_data["user_id"],
    )

    frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(
        f"{frontend_url}/hub/clients/{state_data['client_id']}?tab=publish&oauth=success&platform={platform}"
    )


async def _fetch_meta_accounts(token: str, platform: str) -> dict:
    """Fetch the user's Facebook Pages (and linked Instagram accounts)."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        me = await client.get(
            "https://graph.facebook.com/v21.0/me",
            params={"access_token": token, "fields": "id,name"},
        )
        me.raise_for_status()
        user_data = me.json()

        pages = await client.get(
            "https://graph.facebook.com/v21.0/me/accounts",
            params={"access_token": token, "fields": "id,name,access_token,instagram_business_account"},
        )
        pages.raise_for_status()
        page_list = pages.json().get("data", [])

    if not page_list:
        return {"id": user_data["id"], "name": user_data.get("name", "")}

    page = page_list[0]
    result = {
        "id": user_data["id"],
        "name": page.get("name", user_data.get("name", "")),
        "page_id": page["id"],
        "page_token": page.get("access_token", ""),
    }

    if platform == "instagram":
        ig = page.get("instagram_business_account", {})
        if ig.get("id"):
            result["page_id"] = ig["id"]

    return result


async def _fetch_linkedin_profile(token: str) -> dict:
    """Fetch LinkedIn user profile."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "id": data.get("sub", ""),
        "name": data.get("name", ""),
    }


async def _fetch_google_locations(token: str) -> dict:
    """Fetch first Google Business Profile location."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        accounts = resp.json().get("accounts", [])

    if not accounts:
        return {"id": "", "name": "No account found"}

    account = accounts[0]
    account_name = account.get("name", "")

    async with httpx.AsyncClient(timeout=15) as client:
        loc_resp = await client.get(
            f"https://mybusinessbusinessinformation.googleapis.com/v1/{account_name}/locations",
            headers={"Authorization": f"Bearer {token}"},
        )
        if loc_resp.status_code == 200:
            locations = loc_resp.json().get("locations", [])
            if locations:
                loc = locations[0]
                return {
                    "id": account_name,
                    "name": loc.get("title", account.get("accountName", "")),
                    "location_name": loc.get("name", ""),
                }

    return {
        "id": account_name,
        "name": account.get("accountName", ""),
        "location_name": "",
    }


# ── Social Accounts (manual + list) ───────────────────────

@router.get("/clients/{client_id}/social-accounts")
async def list_social_accounts(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)
    rows = await pool.fetch(
        "SELECT id, platform, account_name, account_id, page_id, "
        "token_expires_at, is_active, connected_at "
        "FROM staging.hub_social_accounts "
        "WHERE client_id=$1::uuid AND is_active=TRUE "
        "ORDER BY platform",
        cid,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/clients/{client_id}/social-accounts")
async def connect_social_account(
    client_id: UUID,
    body: SocialAccountConnect,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)

    cl = await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")

    if body.platform not in ALL_PLATFORMS:
        raise HTTPException(400, f"Invalid platform. Must be one of: {', '.join(ALL_PLATFORMS)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_social_accounts "
        "(client_id, platform, account_name, account_id, page_id, "
        " access_token, refresh_token, scopes, connected_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9) "
        "ON CONFLICT (client_id, platform, account_id) DO UPDATE SET "
        "access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, "
        "account_name=EXCLUDED.account_name, page_id=EXCLUDED.page_id, "
        "is_active=TRUE, updated_at=NOW() "
        "RETURNING id, platform, account_name",
        cid, body.platform, body.account_name, body.account_id,
        body.page_id, body.access_token, body.refresh_token or None,
        body.scopes or [], user["user_id"],
    )
    return {"status": "connected", **dict(row)}


@router.delete("/clients/{client_id}/social-accounts/{account_id}")
async def disconnect_social_account(
    client_id: UUID,
    account_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.hub_social_accounts sa SET is_active=FALSE, updated_at=NOW() "
        "FROM staging.hub_clients c "
        "WHERE sa.id=$1::uuid AND sa.client_id=$2::uuid "
        "AND c.id = sa.client_id AND c.org_id=$3::uuid",
        str(account_id), str(client_id), org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Social account not found")
    return {"status": "disconnected"}


# ── Publishing Queue ────────────────────────────────────────

@router.post("/clients/{client_id}/publish/schedule")
async def schedule_post(
    client_id: UUID,
    body: SchedulePost,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)

    content = await pool.fetchrow(
        "SELECT id, status FROM staging.hub_content_items WHERE id=$1::uuid AND client_id=$2::uuid",
        body.content_id, cid,
    )
    if not content:
        raise HTTPException(404, "Content not found")
    if content["status"] not in ("approved", "draft"):
        raise HTTPException(400, f"Content must be approved or draft to schedule (current: {content['status']})")

    account = await pool.fetchrow(
        "SELECT id FROM staging.hub_social_accounts "
        "WHERE id=$1::uuid AND client_id=$2::uuid AND is_active=TRUE",
        body.social_account_id, cid,
    )
    if not account:
        raise HTTPException(404, "Social account not found")

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_publish_queue "
        "(content_id, social_account_id, client_id, scheduled_for, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5) RETURNING id",
        body.content_id, body.social_account_id, cid, body.scheduled_for, user["user_id"],
    )

    await pool.execute(
        "UPDATE staging.hub_content_items SET status='scheduled', scheduled_for=$1 "
        "WHERE id=$2::uuid AND status IN ('draft', 'approved')",
        body.scheduled_for, body.content_id,
    )

    return {"queue_id": str(row["id"]), "status": "scheduled"}


@router.post("/clients/{client_id}/publish/bulk-schedule")
async def bulk_schedule(
    client_id: UUID,
    body: BulkSchedule,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Schedule same content to multiple platforms at once."""
    cid = str(client_id)
    pool = await get_pool()
    await _require_client_in_org(pool, cid, org_id)

    # This route validated nothing at all — it inserted whatever content_id and
    # social_account_id it was handed. Given an account id from another org it
    # would publish that org's queue item to their real social account. The
    # single-post route checks both ids against the client; so does this one now.
    content = await pool.fetchval(
        "SELECT id FROM staging.hub_content_items "
        "WHERE id=$1::uuid AND client_id=$2::uuid",
        body.content_id, cid,
    )
    if not content:
        raise HTTPException(404, "Content not found")

    results = []
    for acct_id in body.account_ids:
        owned = await pool.fetchval(
            "SELECT 1 FROM staging.hub_social_accounts "
            "WHERE id=$1::uuid AND client_id=$2::uuid AND is_active=TRUE",
            acct_id, cid,
        )
        if not owned:
            results.append({"account_id": acct_id, "status": "failed",
                            "error": "Social account not found"})
            continue
        try:
            row = await pool.fetchrow(
                "INSERT INTO staging.hub_publish_queue "
                "(content_id, social_account_id, client_id, scheduled_for, created_by) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5) RETURNING id",
                body.content_id, acct_id, cid, body.scheduled_for, user["user_id"],
            )
            results.append({"account_id": acct_id, "queue_id": str(row["id"]), "status": "scheduled"})
        except Exception as exc:
            results.append({"account_id": acct_id, "status": "failed", "error": str(exc)[:100]})

    return {"results": results}


@router.post("/publish/queue/{queue_id}/publish-now")
async def publish_now(
    queue_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Immediately publish a scheduled post."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT q.id FROM staging.hub_publish_queue q "
        "JOIN staging.hub_clients c ON c.id = q.client_id "
        "WHERE q.id=$1::uuid AND c.org_id=$2::uuid",
        str(queue_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Queue item not found")
    result = await publish_content(str(queue_id))
    return result


@router.post("/publish/queue/{queue_id}/cancel")
async def cancel_scheduled(
    queue_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.hub_publish_queue q SET status='cancelled' "
        "FROM staging.hub_clients c "
        "WHERE q.id=$1::uuid AND q.status='scheduled' "
        "AND c.id = q.client_id AND c.org_id=$2::uuid",
        str(queue_id), org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Queue item not found")
    return {"status": "cancelled"}


@router.get("/clients/{client_id}/publish/queue")
async def list_publish_queue(
    client_id: UUID,
    status: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)

    query = (
        "SELECT q.id, q.scheduled_for, q.status, q.platform_url, q.error_message, "
        "q.published_at, q.retry_count, "
        "c.title as content_title, c.body as content_body, "
        "sa.platform, sa.account_name "
        "FROM staging.hub_publish_queue q "
        "JOIN staging.hub_content_items c ON c.id = q.content_id "
        "JOIN staging.hub_social_accounts sa ON sa.id = q.social_account_id "
        "WHERE q.client_id=$1::uuid "
    )
    params = [cid]

    if status:
        query += "AND q.status=$2 "
        params.append(status)

    query += "ORDER BY q.scheduled_for DESC"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


# ── Content Calendar ────────────────────────────────────────

@router.get("/clients/{client_id}/calendar")
async def content_calendar(
    client_id: UUID,
    month: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Get all scheduled/published content for a month (content calendar view)."""
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)

    if month:
        year, mo = month.split("-")
        start = f"{year}-{mo}-01"
        end = f"{year}-{int(mo)+1:02d}-01" if int(mo) < 12 else f"{int(year)+1}-01-01"
    else:
        from datetime import date
        today = date.today()
        start = today.replace(day=1).isoformat()
        if today.month < 12:
            end = today.replace(month=today.month + 1, day=1).isoformat()
        else:
            end = today.replace(year=today.year + 1, month=1, day=1).isoformat()

    items = await pool.fetch(
        "SELECT q.id, q.scheduled_for, q.status, q.published_at, "
        "c.title, c.agent_type, c.platform as content_platform, "
        "sa.platform, sa.account_name "
        "FROM staging.hub_publish_queue q "
        "JOIN staging.hub_content_items c ON c.id = q.content_id "
        "JOIN staging.hub_social_accounts sa ON sa.id = q.social_account_id "
        "WHERE q.client_id=$1::uuid "
        "AND q.scheduled_for >= $2::date AND q.scheduled_for < $3::date "
        "ORDER BY q.scheduled_for",
        cid, start, end,
    )
    return {"data": [dict(r) for r in items]}


# ── Cron: Process Scheduled Posts ──────────────────────────

@router.post("/publish/dispatch")
async def dispatch_scheduled_posts(
    request: Request,
    request_secret: str = Query(""),
):
    """Cron endpoint — process all posts whose scheduled_for has passed.
    Secured by PUBLISH_DISPATCH_SECRET env var (same pattern as task-reminders).
    """
    expected = os.getenv("PUBLISH_DISPATCH_SECRET", "")
    if not expected or request_secret != expected:
        raise HTTPException(403, "Invalid dispatch secret")

    results = await process_scheduled_posts()
    published = sum(1 for r in results if r.get("status") == "published")
    failed = sum(1 for r in results if r.get("status") == "failed")
    return {"processed": len(results), "published": published, "failed": failed}


# ── Client Platform Management (Aekam controls) ─────────

class PlatformToggle(BaseModel):
    platforms: list[str]


@router.get("/clients/{client_id}/platforms")
async def list_client_platforms(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """List which platforms are enabled for this client."""
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)
    rows = await pool.fetch(
        "SELECT platform, enabled FROM staging.hub_client_platforms "
        "WHERE client_id=$1::uuid ORDER BY platform",
        cid,
    )
    enabled = [r["platform"] for r in rows if r["enabled"]]
    return {"enabled": enabled, "all_platforms": ALL_PLATFORMS}


@router.put("/clients/{client_id}/platforms")
async def set_client_platforms(
    client_id: UUID,
    body: PlatformToggle,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Set which platforms a client can use. Only valid platform keys accepted."""
    pool = await get_pool()
    cid = str(client_id)

    cl = await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")

    invalid = [p for p in body.platforms if p not in ALL_PLATFORMS]
    if invalid:
        raise HTTPException(400, f"Invalid platforms: {', '.join(invalid)}")

    await pool.execute(
        "DELETE FROM staging.hub_client_platforms WHERE client_id=$1::uuid", cid,
    )
    for p in body.platforms:
        await pool.execute(
            "INSERT INTO staging.hub_client_platforms (client_id, platform, enabled, enabled_by, org_id) "
            "VALUES ($1::uuid, $2, TRUE, $3, $4::uuid)",
            cid, p, user["user_id"], org_id,
        )

    return {"enabled": body.platforms}
