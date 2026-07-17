"""
graha.py — Graha · ग्राह (CRM) Router
Contacts, deals, pipelines, activities.
"""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.subscription import require_module
from services.contact_dedupe import find_duplicates, merge_contacts, undo_merge
from services.lead_parser import parse_lead_email

log = logging.getLogger(__name__)

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


class ContactMerge(BaseModel):
    merge_ids: list[UUID]


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
    lead_score: int | None = None
    lead_score_reasons: list[str] | None = None
    assigned_to: str | None = None


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


class FollowUpCreate(BaseModel):
    title: str
    description: str = ""
    due_at: str
    remind_at: str = ""
    contact_id: str = ""
    deal_id: str = ""
    assigned_to: str = ""


class LabelCreate(BaseModel):
    name: str
    color: str = "#6366f1"


# ── Contacts ─────────────────────────────────────────────────

@router.get("/contacts")
async def list_contacts(
    contact_type: Optional[str] = None,
    search: Optional[str] = None,
    label_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT c.id, c.name, c.email, c.phone, c.company, c.designation, c.contact_type, "
        "c.tags, c.source, c.lead_score, c.assigned_to, c.last_contacted_at, c.created_at "
        "FROM staging.graha_contacts c "
    )

    if label_id:
        query += "JOIN staging.graha_contact_labels cl ON cl.contact_id = c.id "

    query += "WHERE c.org_id=$1::uuid AND c.is_active=TRUE "
    params: list = [org_id]
    idx = 2

    if label_id:
        query += f"AND cl.label_id=${idx}::uuid "
        params.append(label_id)
        idx += 1

    if contact_type:
        query += f"AND c.contact_type=${idx} "
        params.append(contact_type)
        idx += 1

    if search:
        query += f"AND (c.name ILIKE '%' || ${idx} || '%' OR c.email ILIKE '%' || ${idx} || '%' OR c.company ILIKE '%' || ${idx} || '%') "
        params.append(search)
        idx += 1

    query += "ORDER BY c.created_at DESC LIMIT 200"
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

    try:
        row = await pool.fetchrow(
            "INSERT INTO staging.graha_contacts "
            "(org_id, name, email, phone, company, designation, gstin, pan, "
            " billing_address, shipping_address, tags, notes, contact_type, source, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) "
            "RETURNING id, name, contact_type",
            org_id, body.name, body.email, body.phone, body.company, body.designation,
            body.gstin, body.pan, json.dumps(body.billing_address), json.dumps(body.shipping_address),
            body.tags, body.notes, body.contact_type, body.source, user["user_id"],
        )
    except Exception as e:
        logger.error("create_contact failed: %s", e, exc_info=True)
        raise
    if body.contact_type == "lead":
        asyncio.ensure_future(fire_automations(pool, org_id, "lead_created", {
            "contact_id": str(row["id"]), "source": body.source or "", "contact_type": "lead",
        }))
    return {"status": "created", **dict(row)}


# ── Dedupe & Merge ───────────────────────────────────────────
# NOTE: these literal paths MUST stay above /contacts/{contact_id}. FastAPI
# matches in declaration order, and contact_id is typed UUID — "duplicates"
# would fail validation with a 422 rather than falling through to here.

@router.get("/contacts/duplicates")
async def list_duplicate_groups(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Review queue: groups of live contacts sharing a normalized email or phone.
    Exact keys only — fuzzy name matches are surfaced per-contact via
    /contacts/{id}/duplicates, since they are too weak to queue org-wide.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        WITH live AS (
            SELECT * FROM staging.graha_contacts
            WHERE org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL
        ),
        groups AS (
            SELECT 'email' AS match_type, email_norm AS match_key,
                   array_agg(id) AS ids, count(*) AS n
            FROM live WHERE email_norm IS NOT NULL
            GROUP BY email_norm HAVING count(*) > 1
            UNION ALL
            SELECT 'phone', phone_norm, array_agg(id), count(*)
            FROM live WHERE phone_norm IS NOT NULL
            GROUP BY phone_norm HAVING count(*) > 1
        )
        SELECT g.match_type, g.match_key, g.n,
               (SELECT json_agg(json_build_object(
                    'id', c.id, 'name', c.name, 'email', c.email,
                    'phone', c.phone, 'company', c.company,
                    'contact_type', c.contact_type, 'lead_score', c.lead_score,
                    'source', c.source, 'created_at', c.created_at
                ) ORDER BY c.created_at)
                FROM staging.graha_contacts c WHERE c.id = ANY(g.ids)
               ) AS contacts
        FROM groups g
        ORDER BY g.n DESC, g.match_type
        LIMIT $2
        """,
        org_id, limit,
    )
    return {
        "data": [
            {
                "match_type": r["match_type"],
                "match_key": r["match_key"],
                "count": r["n"],
                "contacts": json.loads(r["contacts"]) if isinstance(r["contacts"], str) else r["contacts"],
            }
            for r in rows
        ]
    }


@router.get("/contacts/merges")
async def list_merges(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Recent merges, for the undo window."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT m.id, m.survivor_id, m.merged_id, m.moved_rows, m.field_updates, "
        "       m.actor_id, m.created_at, m.undone_at, "
        "       s.name AS survivor_name, l.name AS merged_name "
        "FROM staging.graha_contact_merges m "
        "JOIN staging.graha_contacts s ON s.id = m.survivor_id "
        "JOIN staging.graha_contacts l ON l.id = m.merged_id "
        "WHERE m.org_id=$1::uuid "
        "ORDER BY m.created_at DESC LIMIT $2",
        org_id, limit,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/contacts/merges/{merge_id}/undo")
async def undo_contact_merge(
    merge_id: UUID,
    user=Depends(require_org_role("org_admin")),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Reverse a merge and restore the merged contact."""
    pool = await get_pool()
    try:
        return await undo_merge(pool, org_id, str(merge_id), user["user_id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/contacts/{contact_id}/duplicates")
async def contact_duplicates(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Candidate duplicates for one contact — exact and fuzzy."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT name, email, phone, company FROM staging.graha_contacts "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(contact_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contact not found")

    matches = await find_duplicates(
        pool, org_id,
        email=row["email"], phone=row["phone"],
        name=row["name"], company=row["company"],
        exclude_id=str(contact_id),
    )
    return {"data": matches}


@router.post("/contacts/{contact_id}/merge")
async def merge_into_contact(
    contact_id: UUID,
    body: ContactMerge,
    user=Depends(require_org_role("org_admin")),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Merge other contacts into this one (the survivor).
    Destructive enough to be admin-only, but reversible via
    /contacts/merges/{merge_id}/undo.
    """
    if not body.merge_ids:
        raise HTTPException(400, "merge_ids must not be empty")
    if len(body.merge_ids) > 20:
        raise HTTPException(400, "Cannot merge more than 20 contacts at once")

    pool = await get_pool()
    try:
        result = await merge_contacts(
            pool, org_id, str(contact_id),
            [str(m) for m in body.merge_ids],
            user["user_id"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "merged", **result}


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
    follow_ups = await pool.fetch(
        "SELECT id, title, description, due_at, remind_at, is_completed, completed_at, "
        "assigned_to, deal_id, created_at "
        "FROM staging.graha_follow_ups WHERE contact_id=$1::uuid ORDER BY due_at ASC",
        str(contact_id),
    )
    labels = await pool.fetch(
        "SELECT l.id, l.name, l.color FROM staging.graha_labels l "
        "JOIN staging.graha_contact_labels cl ON cl.label_id = l.id "
        "WHERE cl.contact_id=$1::uuid ORDER BY l.name",
        str(contact_id),
    )
    return {
        "contact": dict(row),
        "deals": [dict(d) for d in deals],
        "activities": [dict(a) for a in activities],
        "follow_ups": [dict(f) for f in follow_ups],
        "labels": [dict(lb) for lb in labels],
    }


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

    if "lead_score" in updates:
        score = updates["lead_score"]
        if score < 0 or score > 100:
            raise HTTPException(400, "lead_score must be 0–100")

    sets = []
    params = [str(contact_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("lead_score_reasons", "billing_address", "shipping_address"):
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v))
        elif k == "assigned_to":
            sets.append(f"{k}=NULLIF(${idx},'')")
            params.append(v)
        else:
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
        " NULLIF($8,'')::date, NULLIF($9,''), $10, $11, $12) "
        "RETURNING id, title, stage",
        org_id, pipeline_id, body.contact_id, body.title, body.value,
        body.stage, body.probability, body.expected_close_date,
        body.assigned_to, body.notes, body.tags, user["user_id"],
    )
    asyncio.ensure_future(fire_automations(pool, org_id, "deal_created", {
        "deal_id": str(row["id"]), "stage": body.stage or "New",
        "contact_id": body.contact_id or "", "value": str(body.value or 0),
    }))
    if body.contact_id:
        asyncio.ensure_future(compute_lead_score(pool, org_id, body.contact_id))
    return {"status": "created", **dict(row)}


@router.get("/deals/kanban")
async def deals_kanban(
    pipeline_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    pid = pipeline_id
    if not pid:
        pid = await pool.fetchval(
            "SELECT id::text FROM staging.graha_pipelines "
            "WHERE org_id=$1::uuid AND is_default=TRUE AND is_active=TRUE",
            org_id,
        )
    if not pid:
        return {"stages": [], "columns": {}}

    pipeline = await pool.fetchrow(
        "SELECT stages FROM staging.graha_pipelines "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        pid, org_id,
    )
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    stages = pipeline["stages"]

    rows = await pool.fetch(
        "SELECT d.id, d.title, d.value, d.stage, d.tags, d.assigned_to, "
        "d.expected_close_date, d.owner_id, "
        "c.name as contact_name, c.company as contact_company "
        "FROM staging.graha_deals d "
        "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.org_id=$1::uuid AND d.pipeline_id=$2::uuid AND d.is_active=TRUE "
        "ORDER BY d.created_at DESC",
        org_id, pid,
    )

    columns: dict[str, list] = {s: [] for s in stages}
    for r in rows:
        stage = r["stage"]
        if stage in columns:
            columns[stage].append(dict(r))
        else:
            columns.setdefault(stage, []).append(dict(r))

    return {"stages": stages, "columns": columns}


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
    _DEAL_COLS = {
        "title", "contact_id", "pipeline_id", "value", "stage", "probability",
        "expected_close_date", "assigned_to", "notes", "tags", "custom_data",
        "territory_id", "won_at", "lost_at",
    }
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None and k in _DEAL_COLS}
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "stage" in updates and updates["stage"] == "Won":
        updates["won_at"] = datetime.now(timezone.utc)
        updates["probability"] = 100
    elif "stage" in updates and updates["stage"] == "Lost":
        updates["lost_at"] = datetime.now(timezone.utc)
        updates["probability"] = 0

    date_fields = {"expected_close_date"}
    ts_fields = {"won_at", "lost_at"}
    jsonb_fields = {"custom_data"}
    sets = []
    params = [str(deal_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in date_fields:
            sets.append(f"{k}=${idx}::date")
            params.append(date.fromisoformat(v) if isinstance(v, str) and v else v)
        elif k in ts_fields:
            sets.append(f"{k}=${idx}")
            params.append(v)
        elif k in jsonb_fields:
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v) if v is not None else None)
        elif k == "assigned_to":
            sets.append(f"{k}=NULLIF(${idx},'')")
            params.append(v)
        elif k == "tags":
            sets.append(f"{k}=${idx}")
            params.append(v if isinstance(v, list) else [])
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.graha_deals SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    if "stage" in updates:
        asyncio.ensure_future(fire_automations(pool, org_id, "deal_stage_changed", {
            "deal_id": str(deal_id), "stage": updates["stage"],
        }))
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
    asyncio.ensure_future(fire_automations(pool, org_id, "activity_created", {
        "activity_type": body.activity_type, "deal_id": body.deal_id or "",
        "contact_id": body.contact_id or "",
    }))
    if body.contact_id:
        asyncio.ensure_future(compute_lead_score(pool, org_id, body.contact_id))
    return {"status": "created", "id": str(row["id"])}


@router.get("/activities")
async def list_activities(
    contact_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    activity_type: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT id, deal_id, contact_id, activity_type, title, description, "
        "scheduled_at, completed_at, is_completed, created_by, created_at "
        "FROM staging.graha_activities WHERE org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2
    if contact_id:
        query += f"AND contact_id=${idx}::uuid "
        params.append(contact_id)
        idx += 1
    if deal_id:
        query += f"AND deal_id=${idx}::uuid "
        params.append(deal_id)
        idx += 1
    if activity_type:
        query += f"AND activity_type=${idx} "
        params.append(activity_type)
        idx += 1
    query += "ORDER BY created_at DESC LIMIT 100"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


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


# ── Follow-ups ──────────────────────────────────────────────

@router.get("/follow-ups")
async def list_follow_ups(
    assigned_to: Optional[str] = None,
    contact_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    is_completed: Optional[bool] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT f.id, f.title, f.description, f.due_at, f.remind_at, "
        "f.is_completed, f.completed_at, f.assigned_to, f.contact_id, f.deal_id, "
        "f.created_by, f.created_at, "
        "c.name as contact_name, d.title as deal_title "
        "FROM staging.graha_follow_ups f "
        "LEFT JOIN staging.graha_contacts c ON c.id = f.contact_id "
        "LEFT JOIN staging.graha_deals d ON d.id = f.deal_id "
        "WHERE f.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2

    if is_completed is None:
        query += "AND f.is_completed=FALSE "
    else:
        query += f"AND f.is_completed=${idx} "
        params.append(is_completed)
        idx += 1

    if assigned_to:
        query += f"AND f.assigned_to=${idx} "
        params.append(assigned_to)
        idx += 1

    if contact_id:
        query += f"AND f.contact_id=${idx}::uuid "
        params.append(contact_id)
        idx += 1

    if deal_id:
        query += f"AND f.deal_id=${idx}::uuid "
        params.append(deal_id)
        idx += 1

    query += "ORDER BY f.due_at ASC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/follow-ups")
async def create_follow_up(
    body: FollowUpCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    assigned = body.assigned_to or user["user_id"]
    due = datetime.fromisoformat(body.due_at) if body.due_at else None
    remind = datetime.fromisoformat(body.remind_at) if body.remind_at else None
    row = await pool.fetchrow(
        "INSERT INTO staging.graha_follow_ups "
        "(org_id, contact_id, deal_id, title, description, due_at, remind_at, "
        " assigned_to, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, "
        " $6::timestamptz, $7::timestamptz, $8, $9) "
        "RETURNING id, title, due_at",
        org_id, body.contact_id, body.deal_id, body.title, body.description,
        due, remind, assigned, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/follow-ups/{follow_up_id}/complete")
async def complete_follow_up(
    follow_up_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_follow_ups SET is_completed=TRUE, completed_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(follow_up_id), org_id,
    )
    return {"status": "completed"}


@router.delete("/follow-ups/{follow_up_id}")
async def delete_follow_up(
    follow_up_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.graha_follow_ups WHERE id=$1::uuid AND org_id=$2::uuid",
        str(follow_up_id), org_id,
    )
    return {"status": "deleted"}


# ── Labels ──────────────────────────────────────────────────

@router.get("/labels")
async def list_labels(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, color, created_at FROM staging.graha_labels "
        "WHERE org_id=$1::uuid ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/labels")
async def create_label(
    body: LabelCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO staging.graha_labels (org_id, name, color) "
            "VALUES ($1::uuid, $2, $3) RETURNING id, name, color",
            org_id, body.name, body.color,
        )
    except Exception:
        raise HTTPException(409, "Label with this name already exists")
    return {"status": "created", **dict(row)}


@router.delete("/labels/{label_id}")
async def delete_label(
    label_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.graha_labels WHERE id=$1::uuid AND org_id=$2::uuid",
        str(label_id), org_id,
    )
    return {"status": "deleted"}


@router.post("/contacts/{contact_id}/labels/{label_id}")
async def add_contact_label(
    contact_id: UUID,
    label_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    contact = await pool.fetchval(
        "SELECT id FROM staging.graha_contacts WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(contact_id), org_id,
    )
    if not contact:
        raise HTTPException(404, "Contact not found")
    label = await pool.fetchval(
        "SELECT id FROM staging.graha_labels WHERE id=$1::uuid AND org_id=$2::uuid",
        str(label_id), org_id,
    )
    if not label:
        raise HTTPException(404, "Label not found")

    try:
        await pool.execute(
            "INSERT INTO staging.graha_contact_labels (contact_id, label_id) VALUES ($1::uuid, $2::uuid) "
            "ON CONFLICT DO NOTHING",
            str(contact_id), str(label_id),
        )
    except Exception:
        raise HTTPException(400, "Could not add label")
    return {"status": "added"}


@router.delete("/contacts/{contact_id}/labels/{label_id}")
async def remove_contact_label(
    contact_id: UUID,
    label_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.graha_contact_labels "
        "WHERE contact_id=$1::uuid AND label_id=$2::uuid "
        "AND contact_id IN (SELECT id FROM staging.graha_contacts WHERE org_id=$3::uuid)",
        str(contact_id), str(label_id), org_id,
    )
    return {"status": "removed"}


# ── Lead Conversion ─────────────────────────────────────────

@router.post("/contacts/{contact_id}/convert")
async def convert_lead(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, contact_type FROM staging.graha_contacts "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(contact_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contact not found")
    if row["contact_type"] == "customer":
        raise HTTPException(400, "Contact is already a customer")

    updated = await pool.fetchrow(
        "UPDATE staging.graha_contacts "
        "SET contact_type='customer', converted_at=NOW(), updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid "
        "RETURNING *",
        str(contact_id), org_id,
    )
    return {"status": "converted", "contact": dict(updated)}


# ── Today / Daily Action View ──────────────────────────────

@router.get("/today")
async def crm_today(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    role = user.get("role", "member")
    uid = user["user_id"]
    is_admin = role == "admin"

    if is_admin:
        overdue_q = pool.fetch(
            "SELECT f.id, f.title, f.due_at, f.contact_id, c.name AS contact_name "
            "FROM staging.graha_follow_ups f "
            "LEFT JOIN staging.graha_contacts c ON c.id = f.contact_id "
            "WHERE f.org_id=$1::uuid AND f.due_at < NOW() AND NOT f.is_completed "
            "ORDER BY f.due_at ASC LIMIT 20",
            org_id,
        )
    else:
        overdue_q = pool.fetch(
            "SELECT f.id, f.title, f.due_at, f.contact_id, c.name AS contact_name "
            "FROM staging.graha_follow_ups f "
            "LEFT JOIN staging.graha_contacts c ON c.id = f.contact_id "
            "WHERE f.org_id=$1::uuid AND f.due_at < NOW() AND NOT f.is_completed "
            "AND f.assigned_to=$2 "
            "ORDER BY f.due_at ASC LIMIT 20",
            org_id, uid,
        )

    if is_admin:
        stale_q = pool.fetch(
            "SELECT d.id, d.title, d.value, d.stage, d.probability, "
            "d.updated_at, c.name AS contact_name "
            "FROM staging.graha_deals d "
            "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
            "LEFT JOIN LATERAL ("
            "  SELECT MAX(a.created_at) AS last_act FROM staging.graha_activities a "
            "  WHERE a.deal_id = d.id"
            ") la ON TRUE "
            "WHERE d.org_id=$1::uuid AND d.is_active=TRUE "
            "AND d.stage NOT IN ('Won','Lost') "
            "AND COALESCE(la.last_act, d.created_at) < NOW() - INTERVAL '7 days' "
            "ORDER BY COALESCE(la.last_act, d.created_at) ASC LIMIT 15",
            org_id,
        )
    else:
        stale_q = pool.fetch(
            "SELECT d.id, d.title, d.value, d.stage, d.probability, "
            "d.updated_at, c.name AS contact_name "
            "FROM staging.graha_deals d "
            "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
            "LEFT JOIN LATERAL ("
            "  SELECT MAX(a.created_at) AS last_act FROM staging.graha_activities a "
            "  WHERE a.deal_id = d.id"
            ") la ON TRUE "
            "WHERE d.org_id=$1::uuid AND d.is_active=TRUE "
            "AND d.stage NOT IN ('Won','Lost') AND d.assigned_to=$2 "
            "AND COALESCE(la.last_act, d.created_at) < NOW() - INTERVAL '7 days' "
            "ORDER BY COALESCE(la.last_act, d.created_at) ASC LIMIT 15",
            org_id, uid,
        )

    if is_admin:
        new_leads_q = pool.fetch(
            "SELECT id, name, email, phone, company, source, created_at "
            "FROM staging.graha_contacts "
            "WHERE org_id=$1::uuid AND is_active=TRUE AND contact_type='lead' "
            "AND created_at > NOW() - INTERVAL '24 hours' "
            "ORDER BY created_at DESC LIMIT 20",
            org_id,
        )
    else:
        new_leads_q = pool.fetch(
            "SELECT id, name, email, phone, company, source, created_at "
            "FROM staging.graha_contacts "
            "WHERE org_id=$1::uuid AND is_active=TRUE AND contact_type='lead' "
            "AND created_at > NOW() - INTERVAL '24 hours' AND assigned_to=$2 "
            "ORDER BY created_at DESC LIMIT 20",
            org_id, uid,
        )

    today_act_q = pool.fetch(
        "SELECT a.id, a.activity_type, a.title, a.scheduled_at, a.is_completed, "
        "a.deal_id, a.contact_id, c.name AS contact_name "
        "FROM staging.graha_activities a "
        "LEFT JOIN staging.graha_contacts c ON c.id = a.contact_id "
        "WHERE a.org_id=$1::uuid "
        "AND (DATE(a.scheduled_at) = CURRENT_DATE OR DATE(a.created_at) = CURRENT_DATE) "
        "ORDER BY COALESCE(a.scheduled_at, a.created_at) ASC LIMIT 30",
        org_id,
    )

    closures_q = pool.fetch(
        "SELECT d.id, d.title, d.value, d.stage, d.updated_at, c.name AS contact_name "
        "FROM staging.graha_deals d "
        "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.org_id=$1::uuid AND d.stage IN ('Won','Lost') "
        "AND d.updated_at > NOW() - INTERVAL '7 days' "
        "ORDER BY d.updated_at DESC LIMIT 15",
        org_id,
    )

    overdue, stale, new_leads, today_act, closures = await asyncio.gather(
        overdue_q, stale_q, new_leads_q, today_act_q, closures_q,
    )

    return {
        "overdue_followups": [dict(r) for r in overdue],
        "stale_deals": [dict(r) for r in stale],
        "new_leads": [dict(r) for r in new_leads],
        "todays_activities": [dict(r) for r in today_act],
        "recent_closures": [dict(r) for r in closures],
    }


# ── Contact Timeline ──────────────────────────────────────

@router.get("/contacts/{contact_id}/timeline")
async def contact_timeline(
    contact_id: UUID,
    cursor: Optional[str] = None,
    limit: int = Query(30, ge=1, le=100),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cid = str(contact_id)

    cursor_filter = ""
    params: list = [cid, org_id]
    if cursor:
        params.append(cursor)
        cursor_filter = f" AND ts < ${len(params)}::timestamptz"

    params.append(limit)
    limit_param = f"${len(params)}"

    q = f"""
    SELECT * FROM (
        SELECT id, 'activity' AS type, title, activity_type AS subtype,
            COALESCE(scheduled_at, created_at) AS ts, NULL::numeric AS amount, NULL AS stage
        FROM staging.graha_activities
        WHERE contact_id=$1::uuid AND org_id=$2::uuid

        UNION ALL

        SELECT id, 'followup' AS type, title, NULL AS subtype,
            due_at AS ts, NULL::numeric AS amount, NULL AS stage
        FROM staging.graha_follow_ups
        WHERE contact_id=$1::uuid AND org_id=$2::uuid

        UNION ALL

        SELECT id, 'invoice' AS type, invoice_number AS title, status AS subtype,
            created_at AS ts, total AS amount, NULL AS stage
        FROM staging.ganit_invoices
        WHERE contact_id=$1::uuid AND org_id=$2::uuid

        UNION ALL

        SELECT id, 'deal' AS type, title, NULL AS subtype,
            created_at AS ts, value AS amount, stage
        FROM staging.graha_deals
        WHERE contact_id=$1::uuid AND org_id=$2::uuid
    ) timeline
    WHERE 1=1{cursor_filter}
    ORDER BY ts DESC
    LIMIT {limit_param}
    """

    rows = await pool.fetch(q, *params)
    data = [dict(r) for r in rows]
    next_cursor = str(data[-1]["ts"].isoformat()) if data and len(data) == limit else None

    return {"data": data, "next_cursor": next_cursor}


# ── Contact → Projects ─────────────────────────────────────

@router.get("/contacts/{contact_id}/projects")
async def contact_projects(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cid = str(contact_id)
    rows = await pool.fetch(
        "SELECT p.id, p.name, p.status, p.created_at "
        "FROM staging.projects p "
        "WHERE p.org_id=$1::uuid AND p.contact_id=$2::uuid AND p.is_active=TRUE "
        "ORDER BY p.created_at DESC LIMIT 20",
        org_id, cid,
    )
    return {"data": [dict(r) for r in rows]}


# ── Inbound Lead Capture ──────────────────────────────────

import hmac
import hashlib
import os

_INBOUND_SECRET = os.environ.get("INBOUND_WEBHOOK_SECRET", "")

def _sanitize(val: str, max_len: int = 500) -> str:
    import re as _re
    val = _re.sub(r"<[^>]+>", "", val or "")
    return val.strip()[:max_len]


@router.post("/inbound-leads")
async def inbound_leads(request: Request):
    if not _INBOUND_SECRET:
        raise HTTPException(503, "Webhook not configured")
    body_bytes = await request.body()
    sig = request.headers.get("x-webhook-signature", "")
    expected = hmac.new(_INBOUND_SECRET.encode(), body_bytes, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(403, "Invalid webhook signature")
    payload = json.loads(body_bytes)

    sender = payload.get("from", payload.get("sender", ""))
    subject = payload.get("subject", "")
    body_text = payload.get("text", payload.get("html", payload.get("body", "")))
    to_addr = payload.get("to", "")

    pool = await get_pool()

    org_row = await pool.fetchrow(
        "SELECT o.id FROM staging.organisations o "
        "WHERE o.settings->>'lead_capture_email' = $1 AND o.is_active=TRUE",
        to_addr.lower().strip(),
    )
    if not org_row:
        raise HTTPException(400, "No org found for this inbound address")

    org_id = str(org_row["id"])
    source, parsed = parse_lead_email(sender, subject, body_text)

    email_row = await pool.fetchrow(
        "INSERT INTO staging.graha_inbound_emails "
        "(org_id, sender, subject, body_text, parsed_data, status) "
        "VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6) RETURNING id",
        org_id, _sanitize(sender, 200), _sanitize(subject, 300),
        body_text[:10000] if body_text else "",
        json.dumps(parsed) if parsed else "{}",
        "parsed" if parsed else "failed",
    )

    if not parsed:
        return {"status": "stored", "parsed": False, "email_id": str(email_row["id"])}

    name = _sanitize(parsed.get("name", "Unknown Lead"))
    phone = _sanitize(parsed.get("phone", ""), 20)
    email = _sanitize(parsed.get("email", ""), 200)
    company = _sanitize(parsed.get("company", parsed.get("city", "")))
    product = _sanitize(parsed.get("product", ""))

    # Exact-key dedupe at write time. Raw equality missed +91/spacing variants
    # of the same number; find_duplicates matches on the normalized keys.
    # Exact matches only here — fuzzy is never auto-merged, only reviewed.
    dupes = await find_duplicates(pool, org_id, email=email, phone=phone)
    existing = dupes[0] if dupes else None

    if existing:
        await pool.execute(
            "INSERT INTO staging.graha_activities "
            "(org_id, contact_id, activity_type, title, description, created_by) "
            "VALUES ($1::uuid, $2::uuid, 'note', $3, $4, $5)",
            org_id, str(existing["id"]),
            f"New {source} enquiry: {product}" if product else f"New {source} enquiry",
            parsed.get("message", ""),
            "system",
        )
        await pool.execute(
            "UPDATE staging.graha_inbound_emails SET status='duplicate', contact_id=$1::uuid WHERE id=$2::uuid",
            str(existing["id"]), str(email_row["id"]),
        )
        return {"status": "duplicate", "contact_id": str(existing["id"]), "email_id": str(email_row["id"])}

    # No ON CONFLICT here. Migration 022 declared a unique index on
    # (org_id, phone) that was never created in the live DB, so the old
    # ON CONFLICT (org_id, phone) clause had no matching index and Postgres
    # raised at plan time — every new inbound lead 500'd. Migration 024 drops
    # the intent deliberately: phone is not unique in a CRM (shared landlines,
    # soft-merged tombstones retain their number). The find_duplicates() check
    # above handles the dedupe; anything that races past it is caught by the
    # /contacts/duplicates review queue.
    contact_row = await pool.fetchrow(
        "INSERT INTO staging.graha_contacts "
        "(org_id, name, email, phone, company, contact_type, source, notes) "
        "VALUES ($1::uuid, $2, $3, $4, $5, 'lead', $6, $7) "
        "RETURNING id",
        org_id, name, email, phone, company, source,
        parsed.get("message", ""),
    )
    contact_id = str(contact_row["id"])

    await pool.execute(
        "UPDATE staging.graha_inbound_emails SET contact_id=$1::uuid WHERE id=$2::uuid",
        contact_id, str(email_row["id"]),
    )

    if product:
        await pool.execute(
            "INSERT INTO staging.graha_activities "
            "(org_id, contact_id, activity_type, title, description, created_by) "
            "VALUES ($1::uuid, $2::uuid, 'note', $3, $4, $5)",
            org_id, contact_id,
            f"{source} enquiry: {product}",
            parsed.get("message", ""),
            "system",
        )

    await pool.execute(
        "INSERT INTO staging.graha_follow_ups "
        "(org_id, contact_id, title, due_at, assigned_to, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $5)",
        org_id, contact_id,
        f"Follow up on {source} lead: {name}",
        datetime.now(timezone.utc) + timedelta(days=3),
        "system",
    )

    log.info("Created lead from %s: %s (org=%s)", source, name, org_id)
    return {"status": "created", "contact_id": contact_id, "email_id": str(email_row["id"])}


# ── Inbound Email Log (admin only) ────────────────────────

@router.get("/inbound-emails")
async def list_inbound_emails(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, sender, subject, status, contact_id, created_at "
        "FROM staging.graha_inbound_emails "
        "WHERE org_id=$1::uuid ORDER BY created_at DESC LIMIT 100",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/inbound-emails/{email_id}")
async def get_inbound_email(
    email_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.graha_inbound_emails WHERE id=$1::uuid AND org_id=$2::uuid",
        str(email_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Email not found")
    return dict(row)


# ── Phase 1: Lead Scoring ──────────────────────────────────

SCORING_SIGNALS = {
    "has_phone": lambda c, **_: bool(c.get("phone")),
    "has_email": lambda c, **_: bool(c.get("email")),
    "source_indiamart": lambda c, **_: c.get("source") == "indiamart",
    "source_justdial": lambda c, **_: c.get("source") == "justdial",
    "source_website": lambda c, **_: c.get("source") in ("website", "web_form"),
}


async def compute_lead_score(pool, org_id: str, contact_id: str) -> tuple[int, list[str]]:
    rules = await pool.fetch(
        "SELECT signal, points FROM staging.graha_scoring_rules "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    if not rules:
        return 0, []

    contact = await pool.fetchrow(
        "SELECT * FROM staging.graha_contacts WHERE id=$1::uuid AND org_id=$2::uuid",
        contact_id, org_id,
    )
    if not contact:
        return 0, []
    c = dict(contact)

    deal_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.graha_deals WHERE contact_id=$1::uuid AND is_active=TRUE",
        contact_id,
    )
    best_stage = await pool.fetchval(
        "SELECT stage FROM staging.graha_deals WHERE contact_id=$1::uuid AND is_active=TRUE "
        "ORDER BY CASE stage WHEN 'Negotiation' THEN 4 WHEN 'Proposal' THEN 3 "
        "WHEN 'Qualified' THEN 2 WHEN 'New' THEN 1 ELSE 0 END DESC LIMIT 1",
        contact_id,
    )
    has_high_value = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM staging.graha_deals WHERE contact_id=$1::uuid "
        "AND is_active=TRUE AND value >= 100000)",
        contact_id,
    )
    recent_activity = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM staging.graha_activities WHERE contact_id=$1::uuid "
        "AND created_at > NOW() - INTERVAL '7 days')",
        contact_id,
    )
    activity_types = await pool.fetch(
        "SELECT DISTINCT activity_type FROM staging.graha_activities WHERE contact_id=$1::uuid",
        contact_id,
    )
    act_set = {r["activity_type"] for r in activity_types}
    overdue_fu = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM staging.graha_follow_ups WHERE contact_id=$1::uuid "
        "AND NOT is_completed AND due_at < NOW())",
        contact_id,
    )

    dynamic_signals = {
        "has_deal": deal_count > 0,
        "multiple_deals": deal_count >= 2,
        "deal_qualified": best_stage == "Qualified",
        "deal_proposal": best_stage == "Proposal",
        "deal_negotiation": best_stage == "Negotiation",
        "high_value_deal": has_high_value,
        "activity_recent_7d": recent_activity,
        "activity_call": "call" in act_set,
        "activity_meeting": "meeting" in act_set,
        "followup_overdue": overdue_fu,
    }

    score = 0
    reasons = []
    for rule in rules:
        sig = rule["signal"]
        pts = rule["points"]
        fn = SCORING_SIGNALS.get(sig)
        if fn:
            if fn(c):
                score += pts
                reasons.append(f"+{pts} {sig}" if pts > 0 else f"{pts} {sig}")
        elif sig in dynamic_signals:
            if dynamic_signals[sig]:
                score += pts
                reasons.append(f"+{pts} {sig}" if pts > 0 else f"{pts} {sig}")

    score = max(0, min(100, score))
    await pool.execute(
        "UPDATE staging.graha_contacts SET lead_score=$1, lead_score_reasons=$2::jsonb, updated_at=NOW() "
        "WHERE id=$3::uuid AND org_id=$4::uuid",
        score, json.dumps(reasons), contact_id, org_id,
    )
    return score, reasons


@router.post("/contacts/{contact_id}/rescore")
async def rescore_contact(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    score, reasons = await compute_lead_score(pool, org_id, str(contact_id))
    return {"score": score, "reasons": reasons}


@router.post("/contacts/rescore-all")
async def rescore_all_contacts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    contacts = await pool.fetch(
        "SELECT id FROM staging.graha_contacts WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    count = 0
    for c in contacts:
        await compute_lead_score(pool, org_id, str(c["id"]))
        count += 1
    return {"status": "rescored", "count": count}


@router.get("/scoring-rules")
async def list_scoring_rules(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, signal, points, description, is_active FROM staging.graha_scoring_rules "
        "WHERE org_id=$1::uuid ORDER BY points DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


class ScoringRuleUpdate(BaseModel):
    points: int | None = None
    is_active: bool | None = None


@router.patch("/scoring-rules/{rule_id}")
async def update_scoring_rule(
    rule_id: UUID,
    body: ScoringRuleUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    _RULE_COLS = {"points", "is_active"}
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None and k in _RULE_COLS}
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets = []
    params = [str(rule_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    await pool.execute(
        f"UPDATE staging.graha_scoring_rules SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


# ── Phase 1: Sales Automations ─────────────────────────────

class AutomationCreate(BaseModel):
    name: str
    trigger_type: str
    conditions: dict = {}
    action_type: str
    action_data: dict = {}


@router.get("/automations")
async def list_automations(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, trigger_type, conditions, action_type, action_data, "
        "is_active, run_count, last_run_at, created_at "
        "FROM staging.graha_automations WHERE org_id=$1::uuid ORDER BY created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/automations")
async def create_automation(
    body: AutomationCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    valid_triggers = (
        "lead_created", "deal_stage_changed", "deal_created",
        "activity_created", "contact_updated", "deal_stale", "followup_overdue",
    )
    valid_actions = (
        "assign_to", "create_followup", "create_activity",
        "update_score", "change_stage", "send_notification", "add_label",
    )
    if body.trigger_type not in valid_triggers:
        raise HTTPException(400, f"trigger_type must be one of: {', '.join(valid_triggers)}")
    if body.action_type not in valid_actions:
        raise HTTPException(400, f"action_type must be one of: {', '.join(valid_actions)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.graha_automations "
        "(org_id, name, trigger_type, conditions, action_type, action_data, created_by) "
        "VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6::jsonb, $7) RETURNING id, name",
        org_id, body.name, body.trigger_type, json.dumps(body.conditions),
        body.action_type, json.dumps(body.action_data), user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/automations/{auto_id}/toggle")
async def toggle_automation(
    auto_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_automations SET is_active = NOT is_active "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(auto_id), org_id,
    )
    return {"status": "toggled"}


@router.delete("/automations/{auto_id}")
async def delete_automation(
    auto_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.graha_automations WHERE id=$1::uuid AND org_id=$2::uuid",
        str(auto_id), org_id,
    )
    return {"status": "deleted"}


@router.get("/automation-logs")
async def list_automation_logs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT al.id, al.automation_id, a.name AS automation_name, "
        "al.trigger_data, al.result, al.error_message, al.created_at "
        "FROM staging.graha_automation_logs al "
        "JOIN staging.graha_automations a ON a.id = al.automation_id "
        "WHERE al.org_id=$1::uuid ORDER BY al.created_at DESC LIMIT 100",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


async def fire_automations(pool, org_id: str, trigger_type: str, context: dict):
    rules = await pool.fetch(
        "SELECT * FROM staging.graha_automations "
        "WHERE org_id=$1::uuid AND trigger_type=$2 AND is_active=TRUE",
        org_id, trigger_type,
    )
    for rule in rules:
        r = dict(rule)
        conditions = r.get("conditions", {})
        skip = False
        if conditions.get("stage") and context.get("stage") != conditions["stage"]:
            skip = True
        if conditions.get("source") and context.get("source") != conditions["source"]:
            skip = True
        if conditions.get("contact_type") and context.get("contact_type") != conditions["contact_type"]:
            skip = True

        result = "skipped" if skip else "success"
        error_msg = None

        if not skip:
            try:
                action = r["action_type"]
                data = r.get("action_data", {})
                contact_id = context.get("contact_id")
                deal_id = context.get("deal_id")

                if action == "assign_to" and contact_id and data.get("user_id"):
                    await pool.execute(
                        "UPDATE staging.graha_contacts SET assigned_to=$1, updated_at=NOW() "
                        "WHERE id=$2::uuid AND org_id=$3::uuid",
                        data["user_id"], contact_id, org_id,
                    )
                elif action == "create_followup" and contact_id:
                    days = data.get("days", 3)
                    await pool.execute(
                        "INSERT INTO staging.graha_follow_ups "
                        "(org_id, contact_id, deal_id, title, due_at, assigned_to, created_by) "
                        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $6)",
                        org_id, contact_id, deal_id or "",
                        data.get("title", f"Auto follow-up: {r['name']}"),
                        datetime.now(timezone.utc) + timedelta(days=days),
                        data.get("user_id", "system"),
                    )
                elif action == "create_activity" and contact_id:
                    await pool.execute(
                        "INSERT INTO staging.graha_activities "
                        "(org_id, contact_id, deal_id, activity_type, title, created_by) "
                        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, $5, $6)",
                        org_id, contact_id, deal_id or "",
                        data.get("activity_type", "note"),
                        data.get("title", f"Auto: {r['name']}"),
                        "system",
                    )
                elif action == "update_score" and contact_id:
                    await compute_lead_score(pool, org_id, contact_id)
                elif action == "change_stage" and deal_id and data.get("stage"):
                    await pool.execute(
                        "UPDATE staging.graha_deals SET stage=$1, updated_at=NOW() "
                        "WHERE id=$2::uuid AND org_id=$3::uuid",
                        data["stage"], deal_id, org_id,
                    )
                elif action == "add_label" and contact_id and data.get("label_id"):
                    await pool.execute(
                        "INSERT INTO staging.graha_contact_labels (contact_id, label_id) "
                        "VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING",
                        contact_id, data["label_id"],
                    )
            except Exception as e:
                result = "error"
                error_msg = str(e)[:500]
                log.warning("Automation %s failed: %s", r["id"], e)

        await pool.execute(
            "INSERT INTO staging.graha_automation_logs "
            "(org_id, automation_id, trigger_data, result, error_message) "
            "VALUES ($1::uuid, $2::uuid, $3::jsonb, $4, $5)",
            org_id, str(r["id"]), json.dumps(context, default=str),
            result, error_msg,
        )
        if result == "success":
            await pool.execute(
                "UPDATE staging.graha_automations SET run_count=run_count+1, last_run_at=NOW() "
                "WHERE id=$1::uuid",
                str(r["id"]),
            )


# ── Phase 3: Sales Reports ─────────────────────────────────

@router.get("/reports/pipeline-velocity")
async def report_pipeline_velocity(
    days: int = Query(30, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT stage, COUNT(*) as count, COALESCE(SUM(value),0) as total_value, "
        "COALESCE(AVG(value),0) as avg_value, "
        "AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/86400)::int as avg_days_in_stage "
        "FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND created_at > NOW() - ($2 || ' days')::interval "
        "GROUP BY stage ORDER BY count DESC",
        org_id, str(days),
    )
    return {"data": [dict(r) for r in rows], "period_days": days}


@router.get("/reports/conversion")
async def report_conversion(
    days: int = Query(90, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    total = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND created_at > $2",
        org_id, cutoff,
    )
    won = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND created_at > $2 AND stage='Won'",
        org_id, cutoff,
    )
    lost = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND created_at > $2 AND stage='Lost'",
        org_id, cutoff,
    )
    won_value = await pool.fetchval(
        "SELECT COALESCE(SUM(value),0) FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND created_at > $2 AND stage='Won'",
        org_id, cutoff,
    )
    avg_cycle = await pool.fetchval(
        "SELECT AVG(EXTRACT(EPOCH FROM (won_at - created_at))/86400)::int "
        "FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND created_at > $2 AND stage='Won' AND won_at IS NOT NULL",
        org_id, cutoff,
    )

    rate = round(won / total * 100, 1) if total > 0 else 0
    return {
        "total_deals": total, "won": won, "lost": lost,
        "open": total - won - lost,
        "conversion_rate": rate,
        "won_value": float(won_value),
        "avg_cycle_days": avg_cycle or 0,
        "period_days": days,
    }


@router.get("/reports/rep-performance")
async def report_rep_performance(
    days: int = Query(30, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = await pool.fetch(
        "SELECT d.assigned_to, "
        "COUNT(*) as total_deals, "
        "COUNT(*) FILTER (WHERE d.stage='Won') as won, "
        "COUNT(*) FILTER (WHERE d.stage='Lost') as lost, "
        "COALESCE(SUM(d.value) FILTER (WHERE d.stage='Won'), 0) as won_value, "
        "COALESCE(AVG(d.value), 0) as avg_deal_value "
        "FROM staging.graha_deals d "
        "WHERE d.org_id=$1::uuid AND d.created_at > $2 AND d.assigned_to IS NOT NULL "
        "GROUP BY d.assigned_to ORDER BY won_value DESC",
        org_id, cutoff,
    )
    return {"data": [dict(r) for r in rows], "period_days": days}


@router.get("/reports/forecast")
async def report_forecast(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT stage, COUNT(*) as count, "
        "COALESCE(SUM(value),0) as total_value, "
        "COALESCE(SUM(value * probability / 100.0),0) as weighted_value "
        "FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND stage NOT IN ('Won','Lost') "
        "GROUP BY stage ORDER BY weighted_value DESC",
        org_id,
    )
    total_weighted = sum(float(r["weighted_value"]) for r in rows)
    total_pipeline = sum(float(r["total_value"]) for r in rows)
    return {
        "stages": [dict(r) for r in rows],
        "total_pipeline": round(total_pipeline, 2),
        "weighted_forecast": round(total_weighted, 2),
    }


@router.get("/reports/source-analysis")
async def report_source_analysis(
    days: int = Query(90, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = await pool.fetch(
        "SELECT COALESCE(c.source, 'unknown') as source, "
        "COUNT(*) as leads, "
        "COUNT(d.id) as deals, "
        "COUNT(d.id) FILTER (WHERE d.stage='Won') as won, "
        "COALESCE(SUM(d.value) FILTER (WHERE d.stage='Won'), 0) as won_value "
        "FROM staging.graha_contacts c "
        "LEFT JOIN staging.graha_deals d ON d.contact_id = c.id AND d.is_active=TRUE "
        "WHERE c.org_id=$1::uuid AND c.created_at > $2 AND c.is_active=TRUE "
        "GROUP BY COALESCE(c.source, 'unknown') ORDER BY leads DESC",
        org_id, cutoff,
    )
    return {"data": [dict(r) for r in rows], "period_days": days}


# ── Phase 3: Territories ──────────────────────────────────

class TerritoryCreate(BaseModel):
    name: str
    description: str = ""
    assigned_users: list[str] = []
    rules: dict = {}


@router.get("/territories")
async def list_territories(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, description, assigned_users, rules, round_robin_index, is_active "
        "FROM staging.graha_territories WHERE org_id=$1::uuid AND is_active=TRUE ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/territories")
async def create_territory(
    body: TerritoryCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.graha_territories (org_id, name, description, assigned_users, rules) "
        "VALUES ($1::uuid, $2, $3, $4, $5::jsonb) RETURNING id, name",
        org_id, body.name, body.description, body.assigned_users,
        json.dumps(body.rules),
    )
    return {"status": "created", **dict(row)}


@router.patch("/territories/{territory_id}")
async def update_territory(
    territory_id: UUID,
    body: TerritoryCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_territories SET name=$1, description=$2, assigned_users=$3, "
        "rules=$4::jsonb WHERE id=$5::uuid AND org_id=$6::uuid",
        body.name, body.description, body.assigned_users,
        json.dumps(body.rules), str(territory_id), org_id,
    )
    return {"status": "updated"}


@router.delete("/territories/{territory_id}")
async def delete_territory(
    territory_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_territories SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(territory_id), org_id,
    )
    return {"status": "deleted"}


@router.post("/territories/{territory_id}/assign-next")
async def territory_round_robin(
    territory_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    territory = await pool.fetchrow(
        "SELECT assigned_users, round_robin_index FROM staging.graha_territories "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(territory_id), org_id,
    )
    if not territory:
        raise HTTPException(404, "Territory not found")
    users = territory["assigned_users"] or []
    if not users:
        raise HTTPException(400, "Territory has no assigned users")
    idx = (territory["round_robin_index"] or 0) % len(users)
    next_user = users[idx]
    await pool.execute(
        "UPDATE staging.graha_territories SET round_robin_index=$1 WHERE id=$2::uuid",
        idx + 1, str(territory_id),
    )
    return {"assigned_user": next_user, "index": idx}


# ── Phase 3: Custom Fields ────────────────────────────────

class CustomFieldCreate(BaseModel):
    entity_type: str
    field_name: str
    field_type: str
    options: list = []
    is_required: bool = False
    sort_order: int = 0


@router.get("/custom-fields")
async def list_custom_fields(
    entity_type: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = "SELECT * FROM staging.graha_custom_fields WHERE org_id=$1::uuid AND is_active=TRUE "
    params: list = [org_id]
    if entity_type:
        params.append(entity_type)
        q += f"AND entity_type=${len(params)} "
    q += "ORDER BY sort_order, field_name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/custom-fields")
async def create_custom_field(
    body: CustomFieldCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    valid_entities = ("contact", "deal")
    valid_types = ("text", "number", "date", "select", "checkbox", "url", "email", "phone")
    if body.entity_type not in valid_entities:
        raise HTTPException(400, f"entity_type must be one of: {', '.join(valid_entities)}")
    if body.field_type not in valid_types:
        raise HTTPException(400, f"field_type must be one of: {', '.join(valid_types)}")
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO staging.graha_custom_fields "
            "(org_id, entity_type, field_name, field_type, options, is_required, sort_order) "
            "VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id, field_name",
            org_id, body.entity_type, body.field_name, body.field_type,
            json.dumps(body.options), body.is_required, body.sort_order,
        )
    except Exception:
        raise HTTPException(409, "Field with this name already exists for this entity type")
    return {"status": "created", **dict(row)}


@router.delete("/custom-fields/{field_id}")
async def delete_custom_field(
    field_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_custom_fields SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(field_id), org_id,
    )
    return {"status": "deleted"}


# ── Phase 3: Web-to-Lead Forms ─────────────────────────────

class WebFormCreate(BaseModel):
    name: str
    slug: str
    fields: list = []
    settings: dict = {}
    auto_assign_to: str = ""
    auto_source: str = "web_form"


@router.get("/web-forms")
async def list_web_forms(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, slug, fields, settings, auto_assign_to, auto_source, "
        "submission_count, is_active, created_at "
        "FROM staging.graha_web_forms WHERE org_id=$1::uuid ORDER BY created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/web-forms")
async def create_web_form(
    body: WebFormCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    import re
    slug = re.sub(r"[^a-z0-9-]", "", body.slug.lower().strip())
    if not slug:
        raise HTTPException(400, "Invalid slug")
    try:
        row = await pool.fetchrow(
            "INSERT INTO staging.graha_web_forms "
            "(org_id, name, slug, fields, settings, auto_assign_to, auto_source, created_by) "
            "VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, NULLIF($6,'')::uuid, $7, $8) "
            "RETURNING id, name, slug",
            org_id, body.name, slug, json.dumps(body.fields),
            json.dumps(body.settings),
            body.auto_assign_to, body.auto_source, user["user_id"],
        )
    except Exception:
        raise HTTPException(409, "A form with this slug already exists")
    return {"status": "created", **dict(row)}


@router.delete("/web-forms/{form_id}")
async def delete_web_form(
    form_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.graha_web_forms SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(form_id), org_id,
    )
    return {"status": "deleted"}


@router.get("/web-forms/{form_id}/submissions")
async def list_form_submissions(
    form_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT s.id, s.data, s.contact_id, s.status, s.created_at "
        "FROM staging.graha_web_form_submissions s "
        "JOIN staging.graha_web_forms f ON f.id = s.form_id "
        "WHERE s.form_id=$1::uuid AND f.org_id=$2::uuid "
        "ORDER BY s.created_at DESC LIMIT 200",
        str(form_id), org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/f/{slug}")
async def submit_web_form(
    slug: str,
    request: Request,
):
    pool = await get_pool()
    form = await pool.fetchrow(
        "SELECT * FROM staging.graha_web_forms WHERE slug=$1 AND is_active=TRUE",
        slug,
    )
    if not form:
        raise HTTPException(404, "Form not found")

    payload = await request.json()
    org_id = str(form["org_id"])
    form_id = str(form["id"])

    name = str(payload.get("name", ""))[:200]
    email = str(payload.get("email", ""))[:200]
    phone = str(payload.get("phone", ""))[:20]
    company = str(payload.get("company", ""))[:200]

    existing = None
    if email:
        existing = await pool.fetchrow(
            "SELECT id FROM staging.graha_contacts WHERE org_id=$1::uuid AND email=$2",
            org_id, email,
        )
    if not existing and phone:
        existing = await pool.fetchrow(
            "SELECT id FROM staging.graha_contacts WHERE org_id=$1::uuid AND phone=$2",
            org_id, phone,
        )

    contact_id = None
    if existing:
        contact_id = str(existing["id"])
    elif name:
        contact_row = await pool.fetchrow(
            "INSERT INTO staging.graha_contacts "
            "(org_id, name, email, phone, company, contact_type, source, "
            " assigned_to, notes, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, 'lead', $6, "
            " NULLIF($7,'')::uuid, $8, 'system') "
            "ON CONFLICT (org_id, phone) WHERE phone IS NOT NULL AND phone != '' "
            "DO UPDATE SET notes = staging.graha_contacts.notes "
            "RETURNING id",
            org_id, name, email, phone, company,
            form["auto_source"] or "web_form",
            str(form["auto_assign_to"]) if form["auto_assign_to"] else "",
            str(payload.get("message", ""))[:2000],
        )
        contact_id = str(contact_row["id"])

        await fire_automations(pool, org_id, "lead_created", {
            "contact_id": contact_id,
            "source": form["auto_source"] or "web_form",
            "contact_type": "lead",
        })

    sub = await pool.fetchrow(
        "INSERT INTO staging.graha_web_form_submissions "
        "(org_id, form_id, data, contact_id, ip_address, status) "
        "VALUES ($1::uuid, $2::uuid, $3::jsonb, NULLIF($4,'')::uuid, $5, 'processed') "
        "RETURNING id",
        org_id, form_id, json.dumps(payload, default=str),
        contact_id or "", request.client.host if request.client else "",
    )

    await pool.execute(
        "UPDATE staging.graha_web_forms SET submission_count=submission_count+1 "
        "WHERE id=$1::uuid",
        form_id,
    )

    return {"status": "submitted", "id": str(sub["id"])}
