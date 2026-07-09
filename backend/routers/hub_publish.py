"""
hub_publish.py — Srijan P4: Social Publishing Router
Connect social accounts, schedule content, publish to platforms.
"""
import json
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.social_publisher import publish_content

router = APIRouter(prefix="/api/v1/hub", tags=["hub-publish"])

_hub_gate = require_module("srijan")


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


# ── Social Accounts ─────────────────────────────────────────

@router.get("/clients/{client_id}/social-accounts")
async def list_social_accounts(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)
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

    valid_platforms = {"facebook", "instagram", "linkedin", "google_business", "twitter"}
    if body.platform not in valid_platforms:
        raise HTTPException(400, f"Invalid platform. Must be one of: {', '.join(valid_platforms)}")

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
    await pool.execute(
        "UPDATE staging.hub_social_accounts SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND client_id=$2::uuid",
        str(account_id), str(client_id),
    )
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
    results = []

    for acct_id in body.account_ids:
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
    await pool.execute(
        "UPDATE staging.hub_publish_queue SET status='cancelled' "
        "WHERE id=$1::uuid AND status='scheduled'",
        str(queue_id),
    )
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
