"""
graha.py — Graha · ग्राह (CRM) Router
Contacts, deals, pipelines, activities.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

router = APIRouter(prefix="/api/v1/graha", tags=["graha-crm"])

_gate = require_module("graha")


# ── Pydantic Models ──────────────────────────────────────────

class ContactCreate(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    company: str = ""
    designation: str = ""
    gstin: str = ""
    pan: str = ""
    billing_address: dict = {}
    shipping_address: dict = {}
    tags: list[str] = []
    notes: str = ""
    contact_type: str = "lead"
    source: str = ""


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    designation: str | None = None
    gstin: str | None = None
    pan: str | None = None
    billing_address: dict | None = None
    shipping_address: dict | None = None
    tags: list[str] | None = None
    notes: str | None = None
    contact_type: str | None = None
    source: str | None = None


class DealCreate(BaseModel):
    title: str
    contact_id: str = ""
    pipeline_id: str = ""
    value: float = 0
    stage: str = "New"
    probability: int = 0
    expected_close_date: str = ""
    assigned_to: str = ""
    notes: str = ""
    tags: list[str] = []


class DealUpdate(BaseModel):
    title: str | None = None
    stage: str | None = None
    value: float | None = None
    probability: int | None = None
    expected_close_date: str | None = None
    assigned_to: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    won_at: str | None = None
    lost_at: str | None = None
    lost_reason: str | None = None


class PipelineCreate(BaseModel):
    name: str
    stages: list[str] = ["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]


class ActivityCreate(BaseModel):
    deal_id: str = ""
    contact_id: str = ""
    activity_type: str = "note"
    title: str
    description: str = ""
    scheduled_at: str = ""


# ── Contacts ─────────────────────────────────────────────────

@router.get("/contacts")
async def list_contacts(
    contact_type: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT id, name, email, phone, company, designation, contact_type, "
        "tags, source, created_at "
        "FROM staging.graha_contacts "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if contact_type:
        query += f"AND contact_type=${idx} "
        params.append(contact_type)
        idx += 1

    if search:
        query += f"AND (name ILIKE '%' || ${idx} || '%' OR email ILIKE '%' || ${idx} || '%' OR company ILIKE '%' || ${idx} || '%') "
        params.append(search)
        idx += 1

    query += "ORDER BY created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/contacts")
async def create_contact(
    body: ContactCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid_types = ("lead", "customer", "vendor", "partner")
    if body.contact_type not in valid_types:
        raise HTTPException(400, f"contact_type must be one of: {', '.join(valid_types)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.graha_contacts "
        "(org_id, name, email, phone, company, designation, gstin, pan, "
        " billing_address, shipping_address, tags, notes, contact_type, source, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) "
        "RETURNING id, name, contact_type",
        org_id, body.name, body.email, body.phone, body.company, body.designation,
        body.gstin, body.pan, body.billing_address, body.shipping_address,
        body.tags, body.notes, body.contact_type, body.source, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.get("/contacts/{contact_id}")
async def get_contact(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.graha_contacts "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(contact_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contact not found")

    deals = await pool.fetch(
        "SELECT id, title, value, stage, created_at FROM staging.graha_deals "
        "WHERE contact_id=$1::uuid AND is_active=TRUE ORDER BY created_at DESC",
        str(contact_id),
    )
    activities = await pool.fetch(
        "SELECT id, activity_type, title, scheduled_at, is_completed, created_at "
        "FROM staging.graha_activities WHERE contact_id=$1::uuid ORDER BY created_at DESC LIMIT 20",
        str(contact_id),
    )
    return {"contact": dict(row), "deals": [dict(d) for d in deals], "activities": [dict(a) for a in activities]}


@router.patch("/contacts/{contact_id}")
async def update_contact(
    contact_id: UUID,
    body: ContactUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    sets = []
    params = [str(contact_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.graha_contacts SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_contacts SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contact_id), org_id,
    )
    return {"status": "deleted"}


# ── Pipelines ────────────────────────────────────────────────

@router.get("/pipelines")
async def list_pipelines(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, stages, is_default, created_at "
        "FROM staging.graha_pipelines WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY is_default DESC, created_at",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/pipelines")
async def create_pipeline(
    body: PipelineCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.graha_pipelines WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    row = await pool.fetchrow(
        "INSERT INTO staging.graha_pipelines (org_id, name, stages, is_default) "
        "VALUES ($1::uuid, $2, $3::jsonb, $4) RETURNING id, name",
        org_id, body.name, body.stages, existing == 0,
    )
    return {"status": "created", **dict(row)}


# ── Deals ────────────────────────────────────────────────────

@router.get("/deals")
async def list_deals(
    stage: Optional[str] = None,
    pipeline_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT d.id, d.title, d.value, d.stage, d.probability, d.expected_close_date, "
        "d.assigned_to, d.created_at, d.tags, "
        "c.name as contact_name, c.company as contact_company "
        "FROM staging.graha_deals d "
        "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.org_id=$1::uuid AND d.is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if stage:
        query += f"AND d.stage=${idx} "
        params.append(stage)
        idx += 1

    if pipeline_id:
        query += f"AND d.pipeline_id=${idx}::uuid "
        params.append(pipeline_id)
        idx += 1

    query += "ORDER BY d.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/deals")
async def create_deal(
    body: DealCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    pipeline_id = body.pipeline_id or None
    if not pipeline_id:
        default = await pool.fetchval(
            "SELECT id FROM staging.graha_pipelines "
            "WHERE org_id=$1::uuid AND is_default=TRUE AND is_active=TRUE",
            org_id,
        )
        pipeline_id = str(default) if default else None

    if not pipeline_id:
        p = await pool.fetchrow(
            "INSERT INTO staging.graha_pipelines (org_id, name, is_default) "
            "VALUES ($1::uuid, 'Default Pipeline', TRUE) RETURNING id",
            org_id,
        )
        pipeline_id = str(p["id"])

    row = await pool.fetchrow(
        "INSERT INTO staging.graha_deals "
        "(org_id, pipeline_id, contact_id, title, value, stage, probability, "
        " expected_close_date, assigned_to, notes, tags, created_by) "
        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7, "
        " NULLIF($8,'')::date, NULLIF($9,'')::uuid, $10, $11, $12) "
        "RETURNING id, title, stage",
        org_id, pipeline_id, body.contact_id, body.title, body.value,
        body.stage, body.probability, body.expected_close_date,
        body.assigned_to, body.notes, body.tags, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.get("/deals/{deal_id}")
async def get_deal(
    deal_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT d.*, c.name as contact_name, c.email as contact_email, "
        "c.company as contact_company, c.gstin as contact_gstin "
        "FROM staging.graha_deals d "
        "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.id=$1::uuid AND d.org_id=$2::uuid",
        str(deal_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Deal not found")

    activities = await pool.fetch(
        "SELECT id, activity_type, title, scheduled_at, is_completed, created_at "
        "FROM staging.graha_activities WHERE deal_id=$1::uuid ORDER BY created_at DESC LIMIT 30",
        str(deal_id),
    )
    return {"deal": dict(row), "activities": [dict(a) for a in activities]}


@router.patch("/deals/{deal_id}")
async def update_deal(
    deal_id: UUID,
    body: DealUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "stage" in updates and updates["stage"] == "Won":
        updates["won_at"] = datetime.now(timezone.utc).isoformat()
        updates["probability"] = 100
    elif "stage" in updates and updates["stage"] == "Lost":
        updates["lost_at"] = datetime.now(timezone.utc).isoformat()
        updates["probability"] = 0

    sets = []
    params = [str(deal_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.graha_deals SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.get("/pipeline-summary")
async def pipeline_summary(
    pipeline_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT stage, COUNT(*) as count, COALESCE(SUM(value),0) as total_value "
        "FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    if pipeline_id:
        query += "AND pipeline_id=$2::uuid "
        params.append(pipeline_id)
    query += "GROUP BY stage ORDER BY count DESC"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


# ── Activities ───────────────────────────────────────────────

@router.post("/activities")
async def create_activity(
    body: ActivityCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid_types = ("call", "email", "meeting", "note", "task")
    if body.activity_type not in valid_types:
        raise HTTPException(400, f"activity_type must be one of: {', '.join(valid_types)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.graha_activities "
        "(org_id, deal_id, contact_id, activity_type, title, description, scheduled_at, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, "
        " NULLIF($7,'')::timestamptz, $8) RETURNING id",
        org_id, body.deal_id, body.contact_id, body.activity_type,
        body.title, body.description, body.scheduled_at, user["user_id"],
    )
    return {"status": "created", "id": str(row["id"])}


@router.patch("/activities/{activity_id}/complete")
async def complete_activity(
    activity_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_activities SET is_completed=TRUE, completed_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(activity_id), org_id,
    )
    return {"status": "completed"}
