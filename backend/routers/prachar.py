"""
prachar.py — Prachar · प्रचार (Marketing) Router
Email templates, campaigns, automations, unsubscribes.
Reads Graha contacts for audience targeting.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from email_service import send_email
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/prachar", tags=["prachar-marketing"])

_gate = require_module("prachar")

_background_tasks: set = set()


# ── Pydantic Models ──────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    subject: str
    body_html: str = ""
    body_text: str = ""
    category: str = "general"
    variables: list[str] = []


class TemplateUpdate(BaseModel):
    name: str | None = None
    subject: str | None = None
    body_html: str | None = None
    body_text: str | None = None
    category: str | None = None
    variables: list[str] | None = None


class CampaignCreate(BaseModel):
    name: str
    template_id: str | None = None
    subject: str = ""
    body_html: str = ""
    channel: str = "email"
    audience_filter: dict = {}
    scheduled_at: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    template_id: str | None = None
    subject: str | None = None
    body_html: str | None = None
    channel: str | None = None
    audience_filter: dict | None = None
    scheduled_at: str | None = None


class AutomationCreate(BaseModel):
    name: str
    trigger_type: str
    trigger_config: dict = {}
    action_type: str
    action_config: dict = {}
    is_active: bool = True


class AutomationUpdate(BaseModel):
    name: str | None = None
    trigger_config: dict | None = None
    action_config: dict | None = None
    is_active: bool | None = None


# ── Templates CRUD ───────────────────────────────────────────

@router.get("/templates")
async def list_templates(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.prachar_templates "
        "WHERE org_id=$1::uuid AND is_active=TRUE ORDER BY updated_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/templates")
async def create_template(
    body: TemplateCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_templates "
        "(org_id, name, subject, body_html, body_text, category, variables, created_by) "
        "VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *",
        org_id, body.name, body.subject, body.body_html, body.body_text,
        body.category, json.dumps(body.variables), user["user_id"],
    )
    return dict(row)


@router.get("/templates/{tmpl_id}")
async def get_template(
    tmpl_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.prachar_templates WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        tmpl_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Template not found")
    return dict(row)


@router.patch("/templates/{tmpl_id}")
async def update_template(
    tmpl_id: str,
    body: TemplateUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ["name", "subject", "body_html", "body_text", "category"]:
        v = getattr(body, field)
        if v is not None:
            vals.append(v); updates.append(f"{field}=${len(vals)}")
    if body.variables is not None:
        vals.append(json.dumps(body.variables)); updates.append(f"variables=${len(vals)}::jsonb")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [tmpl_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.prachar_templates SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid AND is_active=TRUE RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Template not found")
    return dict(row)


@router.delete("/templates/{tmpl_id}")
async def delete_template(
    tmpl_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.prachar_templates SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        tmpl_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Template not found")
    return {"ok": True}


# ── Campaigns CRUD ───────────────────────────────────────────

@router.get("/campaigns")
async def list_campaigns(
    status: str | None = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = "SELECT * FROM staging.prachar_campaigns WHERE org_id=$1::uuid AND is_active=TRUE"
    params = [org_id]
    if status:
        params.append(status)
        q += f" AND status=${len(params)}"
    q += " ORDER BY created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/campaigns")
async def create_campaign(
    body: CampaignCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_campaigns "
        "(org_id, name, template_id, subject, body_html, channel, audience_filter, scheduled_at, created_by) "
        "VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb,$8::timestamptz,$9) RETURNING *",
        org_id, body.name, body.template_id, body.subject, body.body_html,
        body.channel, json.dumps(body.audience_filter), body.scheduled_at, user["user_id"],
    )
    return dict(row)


@router.get("/campaigns/{camp_id}")
async def get_campaign(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.prachar_campaigns WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        camp_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Campaign not found")
    return dict(row)


@router.patch("/campaigns/{camp_id}")
async def update_campaign(
    camp_id: str,
    body: CampaignUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    current = await pool.fetchrow(
        "SELECT status FROM staging.prachar_campaigns WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        camp_id, org_id,
    )
    if not current:
        raise HTTPException(404, "Campaign not found")
    if current["status"] not in ("draft", "scheduled"):
        raise HTTPException(400, "Cannot edit a campaign that is already sending or sent")

    updates, vals = [], []
    for field in ["name", "subject", "body_html", "channel"]:
        v = getattr(body, field)
        if v is not None:
            vals.append(v); updates.append(f"{field}=${len(vals)}")
    if body.template_id is not None:
        vals.append(body.template_id); updates.append(f"template_id=${len(vals)}::uuid")
    if body.audience_filter is not None:
        vals.append(json.dumps(body.audience_filter)); updates.append(f"audience_filter=${len(vals)}::jsonb")
    if body.scheduled_at is not None:
        vals.append(body.scheduled_at); updates.append(f"scheduled_at=${len(vals)}::timestamptz")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [camp_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.prachar_campaigns SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    return dict(row)


@router.delete("/campaigns/{camp_id}")
async def delete_campaign(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.prachar_campaigns SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND status IN ('draft','scheduled')",
        camp_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Campaign not found or already sent")
    return {"ok": True}


# ── Campaign Audience & Send ─────────────────────────────────

@router.get("/campaigns/{camp_id}/audience")
async def preview_audience(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    campaign = await pool.fetchrow(
        "SELECT audience_filter FROM staging.prachar_campaigns WHERE id=$1::uuid AND org_id=$2::uuid",
        camp_id, org_id,
    )
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    contacts = await _resolve_audience(pool, org_id, campaign["audience_filter"] or {})
    return {"count": len(contacts), "contacts": contacts[:50]}


@router.post("/campaigns/{camp_id}/send")
async def send_campaign(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    campaign = await pool.fetchrow(
        "SELECT * FROM staging.prachar_campaigns WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        camp_id, org_id,
    )
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    if campaign["status"] not in ("draft", "scheduled"):
        raise HTTPException(400, f"Campaign status is '{campaign['status']}', cannot send")

    contacts = await _resolve_audience(pool, org_id, campaign["audience_filter"] or {})
    if not contacts:
        raise HTTPException(400, "No contacts match the audience filter")

    unsubs = await pool.fetch(
        "SELECT email FROM staging.prachar_unsubscribes WHERE org_id=$1::uuid", org_id
    )
    unsub_set = {r["email"].lower() for r in unsubs}
    eligible = [c for c in contacts if c["email"] and c["email"].lower() not in unsub_set]

    # Resolve subject & body: use template if linked, else campaign's own fields
    subject = campaign["subject"] or ""
    body_html = campaign["body_html"] or ""
    if campaign["template_id"] and (not subject or not body_html):
        tmpl = await pool.fetchrow(
            "SELECT subject, body_html FROM staging.prachar_templates "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            str(campaign["template_id"]), org_id,
        )
        if tmpl:
            subject = subject or tmpl["subject"]
            body_html = body_html or tmpl["body_html"]

    if not subject or not body_html:
        raise HTTPException(400, "Campaign has no subject or body content")

    # Insert contact rows and set status to sending
    async with pool.acquire() as conn:
        async with conn.transaction():
            for c in eligible:
                await conn.execute(
                    "INSERT INTO staging.prachar_campaign_contacts (campaign_id, contact_id, email) "
                    "VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING",
                    str(campaign["id"]), str(c["id"]), c["email"],
                )

            await conn.execute(
                "UPDATE staging.prachar_campaigns SET status='sending', "
                "total_recipients=$1, sent_at=NOW(), updated_at=NOW() "
                "WHERE id=$2::uuid",
                len(eligible), str(campaign["id"]),
            )

    # Dispatch emails in background so the API responds quickly
    campaign_id = str(campaign["id"])
    campaign_name = campaign["name"]

    async def _dispatch():
        sent_count = 0
        failed_count = 0
        for c in eligible:
            contact_email = c["email"]
            # Simple variable substitution: {{name}}, {{email}}, {{company}}
            rendered_body = body_html
            rendered_subj = subject
            for var_key in ("name", "email", "company"):
                placeholder = "{{" + var_key + "}}"
                val = str(c.get(var_key) or "")
                rendered_body = rendered_body.replace(placeholder, val)
                rendered_subj = rendered_subj.replace(placeholder, val)

            try:
                send_email(contact_email, rendered_subj, rendered_body)
                sent_count += 1
                # Mark individual contact as sent
                await pool.execute(
                    "UPDATE staging.prachar_campaign_contacts SET status='sent', sent_at=NOW() "
                    "WHERE campaign_id=$1::uuid AND email=$2",
                    campaign_id, contact_email,
                )
            except Exception as exc:
                failed_count += 1
                logger.error("Prachar campaign %s: failed to send to %s: %s",
                             campaign_name, contact_email, exc)
                await pool.execute(
                    "UPDATE staging.prachar_campaign_contacts SET status='failed' "
                    "WHERE campaign_id=$1::uuid AND email=$2",
                    campaign_id, contact_email,
                )

        # Update campaign to sent with aggregate counts
        await pool.execute(
            "UPDATE staging.prachar_campaigns SET status='sent', "
            "total_recipients=$1, updated_at=NOW() "
            "WHERE id=$2::uuid",
            sent_count, campaign_id,
        )
        logger.info("Prachar campaign '%s' (%s): %d sent, %d failed",
                     campaign_name, campaign_id, sent_count, failed_count)

    task = asyncio.create_task(_dispatch())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return {"ok": True, "recipients": len(eligible), "skipped_unsubscribed": len(contacts) - len(eligible)}


@router.get("/campaigns/{camp_id}/stats")
async def campaign_stats(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `prachar_campaign_contacts` is keyed on campaign_id only, so without this
    # the counts came back for any campaign id in any org.
    if not await pool.fetchval(
        "SELECT 1 FROM staging.prachar_campaigns WHERE id=$1::uuid AND org_id=$2::uuid",
        camp_id, org_id,
    ):
        raise HTTPException(404, "Campaign not found")
    stats = await pool.fetchrow(
        "SELECT "
        "COUNT(*) AS total, "
        "COUNT(*) FILTER (WHERE status='sent' OR status='delivered') AS sent, "
        "COUNT(*) FILTER (WHERE status='opened' OR status='clicked') AS opened, "
        "COUNT(*) FILTER (WHERE status='clicked') AS clicked, "
        "COUNT(*) FILTER (WHERE status='bounced') AS bounced, "
        "COUNT(*) FILTER (WHERE status='failed') AS failed "
        "FROM staging.prachar_campaign_contacts WHERE campaign_id=$1::uuid",
        camp_id,
    )
    return dict(stats) if stats else {}


# ── Automations CRUD ─────────────────────────────────────────

@router.get("/automations")
async def list_automations(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.prachar_automations WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY created_at DESC",
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
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_automations "
        "(org_id, name, trigger_type, trigger_config, action_type, action_config, is_active, created_by) "
        "VALUES ($1::uuid,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8) RETURNING *",
        org_id, body.name, body.trigger_type, json.dumps(body.trigger_config),
        body.action_type, json.dumps(body.action_config), body.is_active, user["user_id"],
    )
    return dict(row)


@router.patch("/automations/{auto_id}")
async def update_automation(
    auto_id: str,
    body: AutomationUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    if body.name is not None:
        vals.append(body.name); updates.append(f"name=${len(vals)}")
    if body.trigger_config is not None:
        vals.append(json.dumps(body.trigger_config)); updates.append(f"trigger_config=${len(vals)}::jsonb")
    if body.action_config is not None:
        vals.append(json.dumps(body.action_config)); updates.append(f"action_config=${len(vals)}::jsonb")
    if body.is_active is not None:
        vals.append(body.is_active); updates.append(f"is_active=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [auto_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.prachar_automations SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Automation not found")
    return dict(row)


@router.delete("/automations/{auto_id}")
async def delete_automation(
    auto_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.prachar_automations SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        auto_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Automation not found")
    return {"ok": True}


# ── Unsubscribes ─────────────────────────────────────────────

@router.get("/unsubscribes")
async def list_unsubscribes(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.prachar_unsubscribes WHERE org_id=$1::uuid ORDER BY unsubscribed_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/unsubscribes")
async def add_unsubscribe(
    email: str = Query(...),
    reason: str = Query("manual"),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO staging.prachar_unsubscribes (org_id, email, reason) "
        "VALUES ($1::uuid, $2, $3) ON CONFLICT (org_id, email) DO NOTHING",
        org_id, email.lower().strip(), reason,
    )
    return {"ok": True}


@router.delete("/unsubscribes/{unsub_id}")
async def remove_unsubscribe(
    unsub_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM staging.prachar_unsubscribes WHERE id=$1::uuid AND org_id=$2::uuid",
        unsub_id, org_id,
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ── Dashboard ────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    campaigns = await pool.fetchrow(
        "SELECT COUNT(*) AS total, "
        "COUNT(*) FILTER (WHERE status='sent') AS sent, "
        "COUNT(*) FILTER (WHERE status='sending') AS sending, "
        "COUNT(*) FILTER (WHERE status='draft') AS drafts, "
        "COUNT(*) FILTER (WHERE status='scheduled') AS scheduled "
        "FROM staging.prachar_campaigns WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    delivery = await pool.fetchrow(
        "SELECT "
        "COALESCE(SUM(total_recipients),0) AS total_sent, "
        "COALESCE(SUM(total_opened),0) AS total_opened, "
        "COALESCE(SUM(total_clicked),0) AS total_clicked, "
        "COALESCE(SUM(total_bounced),0) AS total_bounced "
        "FROM staging.prachar_campaigns WHERE org_id=$1::uuid AND status='sent'",
        org_id,
    )

    templates = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.prachar_templates WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    automations = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.prachar_automations WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    unsubs = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.prachar_unsubscribes WHERE org_id=$1::uuid",
        org_id,
    )

    recent = await pool.fetch(
        "SELECT id, name, status, total_recipients, total_opened, total_clicked, sent_at "
        "FROM staging.prachar_campaigns WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY created_at DESC LIMIT 5",
        org_id,
    )

    return {
        "campaigns": dict(campaigns) if campaigns else {},
        "delivery": dict(delivery) if delivery else {},
        "templates_count": templates or 0,
        "automations_count": automations or 0,
        "unsubscribes_count": unsubs or 0,
        "recent_campaigns": [dict(r) for r in recent],
    }


# ── Helpers ──────────────────────────────────────────────────

async def _resolve_audience(pool, org_id: str, filters: dict) -> list[dict]:
    q = ("SELECT id, name, email, type, company FROM staging.graha_contacts "
         "WHERE org_id=$1::uuid AND is_active=TRUE AND email IS NOT NULL AND email != ''")
    params: list = [org_id]

    if filters.get("type"):
        params.append(filters["type"])
        q += f" AND type=${len(params)}"
    if filters.get("label"):
        params.append(filters["label"])
        q += f" AND ${len(params)} = ANY(labels)"
    if filters.get("min_score"):
        params.append(filters["min_score"])
        q += f" AND lead_score >= ${len(params)}"
    if filters.get("company"):
        params.append(f"%{filters['company']}%")
        q += f" AND company ILIKE ${len(params)}"

    q += " ORDER BY name"
    rows = await pool.fetch(q, *params)
    return [dict(r) for r in rows]


# ── Sequences / Cadences ────────────────────────────────────

class SequenceCreate(BaseModel):
    name: str
    description: str = ""
    exit_on_reply: bool = True


class SequenceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    exit_on_reply: bool | None = None


class StepCreate(BaseModel):
    step_order: int
    channel: str = "email"
    delay_days: int = 1
    subject: str = ""
    body_html: str = ""
    body_text: str = ""
    notes: str = ""


class EnrollBody(BaseModel):
    contact_ids: list[str]


@router.get("/sequences", dependencies=[Depends(_gate)])
async def list_sequences(user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT s.*, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_steps WHERE sequence_id=s.id) AS step_count, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_enrollments WHERE sequence_id=s.id AND status='active') AS active_enrollments "
        "FROM staging.prachar_sequences s WHERE s.org_id=$1::uuid ORDER BY s.created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/sequences", dependencies=[Depends(_gate)])
async def create_sequence(body: SequenceCreate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_sequences "
        "(org_id, name, description, exit_on_reply, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id, name, status",
        org_id, body.name, body.description, body.exit_on_reply, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.get("/sequences/{seq_id}", dependencies=[Depends(_gate)])
async def get_sequence(seq_id: str, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    seq = await pool.fetchrow(
        "SELECT * FROM staging.prachar_sequences WHERE id=$1::uuid AND org_id=$2::uuid",
        seq_id, org_id,
    )
    if not seq:
        raise HTTPException(404, "Sequence not found")
    steps = await pool.fetch(
        "SELECT * FROM staging.prachar_sequence_steps WHERE sequence_id=$1::uuid ORDER BY step_order",
        seq_id,
    )
    enrollments = await pool.fetch(
        "SELECT e.*, c.name AS contact_name, c.email AS contact_email "
        "FROM staging.prachar_sequence_enrollments e "
        "JOIN staging.graha_contacts c ON c.id = e.contact_id "
        "WHERE e.sequence_id=$1::uuid ORDER BY e.enrolled_at DESC LIMIT 100",
        seq_id,
    )
    return {
        "sequence": dict(seq),
        "steps": [dict(s) for s in steps],
        "enrollments": [dict(e) for e in enrollments],
    }


@router.patch("/sequences/{seq_id}", dependencies=[Depends(_gate)])
async def update_sequence(seq_id: str, body: SequenceUpdate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    if "status" in updates:
        valid = ("draft", "active", "paused", "archived")
        if updates["status"] not in valid:
            raise HTTPException(400, f"status must be one of: {', '.join(valid)}")
    sets, params = [], [seq_id, org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")
    await pool.execute(
        f"UPDATE staging.prachar_sequences SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


async def _require_sequence_in_org(pool, seq_id: str, org_id: str):
    """`prachar_sequence_steps` has no `org_id` of its own — it hangs off the
    sequence. Routes keyed on `seq_id` alone therefore reached across tenants:
    the step routes below could rewrite the subject and body of another
    company's outbound email sequence, which is content injection into mail
    their contacts receive over their name."""
    ok = await pool.fetchval(
        "SELECT 1 FROM staging.prachar_sequences WHERE id=$1::uuid AND org_id=$2::uuid",
        seq_id, org_id,
    )
    if not ok:
        raise HTTPException(404, "Sequence not found")


@router.post("/sequences/{seq_id}/steps", dependencies=[Depends(_gate)])
async def add_step(seq_id: str, body: StepCreate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    await _require_sequence_in_org(pool, seq_id, org_id)
    valid_channels = ("email", "whatsapp", "call_task", "manual")
    if body.channel not in valid_channels:
        raise HTTPException(400, f"channel must be one of: {', '.join(valid_channels)}")
    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_sequence_steps "
        "(sequence_id, step_order, channel, delay_days, subject, body_html, body_text, notes) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8) "
        "ON CONFLICT (sequence_id, step_order) DO UPDATE SET "
        "channel=$3, delay_days=$4, subject=$5, body_html=$6, body_text=$7, notes=$8 "
        "RETURNING id",
        seq_id, body.step_order, body.channel, body.delay_days,
        body.subject, body.body_html, body.body_text, body.notes,
    )
    return {"status": "saved", "id": str(row["id"])}


@router.delete("/sequences/{seq_id}/steps/{step_order}", dependencies=[Depends(_gate)])
async def delete_step(seq_id: str, step_order: int, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    await _require_sequence_in_org(pool, seq_id, org_id)
    await pool.execute(
        "DELETE FROM staging.prachar_sequence_steps "
        "WHERE sequence_id=$1::uuid AND step_order=$2",
        seq_id, step_order,
    )
    return {"status": "deleted"}


@router.post("/sequences/{seq_id}/enroll", dependencies=[Depends(_gate)])
async def enroll_contacts(seq_id: str, body: EnrollBody, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    seq = await pool.fetchrow(
        "SELECT * FROM staging.prachar_sequences WHERE id=$1::uuid AND org_id=$2::uuid",
        seq_id, org_id,
    )
    if not seq:
        raise HTTPException(404, "Sequence not found")

    first_step = await pool.fetchrow(
        "SELECT delay_days FROM staging.prachar_sequence_steps "
        "WHERE sequence_id=$1::uuid ORDER BY step_order LIMIT 1",
        seq_id,
    )
    delay = first_step["delay_days"] if first_step else 1

    # The SEQUENCE was checked against the org; the CONTACTS were not.
    # `prachar_sequence_enrollments` has no org_id, and the ids came straight
    # from the request body into the insert — so any contact id from any org
    # could be enrolled into this org's sequence, and the sequence engine would
    # then send that org's marketing email to another tenant's contacts.
    #
    # Filtering to the caller's own contacts is what scopes this table: it has
    # no org column of its own, so the guarantee has to be established here, at
    # the only point where an id from outside enters.
    if not body.contact_ids:
        return {"enrolled": 0}

    owned = await pool.fetch(
        "SELECT id FROM staging.graha_contacts "
        "WHERE org_id=$1::uuid AND id = ANY($2::uuid[])",
        org_id, body.contact_ids,
    )
    owned_ids = [str(r["id"]) for r in owned]
    rejected = len(body.contact_ids) - len(owned_ids)

    enrolled = 0
    for cid in owned_ids:
        row = await pool.fetchrow(
            "INSERT INTO staging.prachar_sequence_enrollments "
            "(sequence_id, contact_id, current_step, next_step_at) "
            "VALUES ($1::uuid, $2::uuid, 1, NOW() + ($3 || ' days')::interval) "
            "ON CONFLICT (sequence_id, contact_id) DO NOTHING RETURNING id",
            seq_id, cid, str(delay),
        )
        if row:
            enrolled += 1
    return {"enrolled": enrolled, "rejected": rejected}


@router.post("/sequences/{seq_id}/pause", dependencies=[Depends(_gate)])
async def pause_sequence(seq_id: str, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.prachar_sequences SET status='paused', updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        seq_id, org_id,
    )
    await pool.execute(
        "UPDATE staging.prachar_sequence_enrollments SET status='paused' "
        "WHERE sequence_id=$1::uuid AND status='active'",
        seq_id,
    )
    return {"status": "paused"}


@router.get("/sequences/{seq_id}/stats", dependencies=[Depends(_gate)])
async def sequence_stats(seq_id: str, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    await _require_sequence_in_org(pool, seq_id, org_id)
    steps = await pool.fetch(
        "SELECT st.id, st.step_order, st.channel, st.subject, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l WHERE l.step_id=st.id) AS total_sent, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l WHERE l.step_id=st.id AND l.status='delivered') AS delivered, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l WHERE l.step_id=st.id AND l.status='opened') AS opened, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l WHERE l.step_id=st.id AND l.status='clicked') AS clicked, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l WHERE l.step_id=st.id AND l.status='replied') AS replied, "
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l WHERE l.step_id=st.id AND l.status='bounced') AS bounced "
        "FROM staging.prachar_sequence_steps st "
        "WHERE st.sequence_id=$1::uuid ORDER BY st.step_order",
        seq_id,
    )
    totals = await pool.fetchrow(
        "SELECT "
        "COUNT(*) FILTER (WHERE status='active') AS active, "
        "COUNT(*) FILTER (WHERE status='completed') AS completed, "
        "COUNT(*) FILTER (WHERE status='replied') AS replied, "
        "COUNT(*) FILTER (WHERE status='bounced') AS bounced, "
        "COUNT(*) FILTER (WHERE status='unsubscribed') AS unsubscribed, "
        "COUNT(*) AS total "
        "FROM staging.prachar_sequence_enrollments WHERE sequence_id=$1::uuid",
        seq_id,
    )
    return {"steps": [dict(s) for s in steps], "totals": dict(totals)}


# ── Event Management ────────────────────────────────────────

class EventCreate(BaseModel):
    title: str
    description: str = ""
    event_type: str = "webinar"
    location: str = ""
    location_url: str = ""
    starts_at: str
    ends_at: str = ""
    max_attendees: int | None = None
    registration_open: bool = True
    tags: list[str] = []


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    event_type: str | None = None
    location: str | None = None
    location_url: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    max_attendees: int | None = None
    registration_open: bool | None = None
    status: str | None = None
    tags: list[str] | None = None


class EventRegistration(BaseModel):
    name: str
    email: str
    phone: str = ""
    contact_id: str = ""


@router.get("/events")
async def list_events(
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT e.*, "
        "(SELECT COUNT(*) FROM staging.prachar_event_registrations r WHERE r.event_id=e.id AND r.status != 'cancelled') AS reg_count "
        "FROM staging.prachar_events e WHERE e.org_id=$1::uuid AND e.is_active=TRUE"
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND e.status=${len(params)}"
    q += " ORDER BY e.starts_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/events")
async def create_event(
    body: EventCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid_types = ("webinar", "meetup", "workshop", "conference", "other")
    if body.event_type not in valid_types:
        raise HTTPException(400, f"event_type must be one of: {', '.join(valid_types)}")
    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_events "
        "(org_id, title, description, event_type, location, location_url, "
        "starts_at, ends_at, max_attendees, registration_open, tags, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, "
        "NULLIF($8,'')::timestamptz, $9, $10, $11::jsonb, $12) RETURNING *",
        org_id, body.title, body.description, body.event_type,
        body.location, body.location_url, body.starts_at,
        body.ends_at, body.max_attendees, body.registration_open,
        json.dumps(body.tags), user["user_id"],
    )
    return dict(row)


@router.get("/events/{event_id}")
async def get_event(
    event_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT e.*, "
        "(SELECT COUNT(*) FROM staging.prachar_event_registrations r WHERE r.event_id=e.id AND r.status != 'cancelled') AS reg_count "
        "FROM staging.prachar_events e WHERE e.id=$1::uuid AND e.org_id=$2::uuid AND e.is_active=TRUE",
        event_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Event not found")
    return dict(row)


@router.patch("/events/{event_id}")
async def update_event(
    event_id: str,
    body: EventUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("title", "description", "location", "location_url"):
        v = getattr(body, field)
        if v is not None:
            vals.append(v); updates.append(f"{field}=${len(vals)}")
    if body.event_type is not None:
        valid = ("webinar", "meetup", "workshop", "conference", "other")
        if body.event_type not in valid:
            raise HTTPException(400, "Invalid event_type")
        vals.append(body.event_type); updates.append(f"event_type=${len(vals)}")
    if body.status is not None:
        valid = ("draft", "published", "ongoing", "completed", "cancelled")
        if body.status not in valid:
            raise HTTPException(400, "Invalid status")
        vals.append(body.status); updates.append(f"status=${len(vals)}")
    if body.starts_at is not None:
        vals.append(body.starts_at); updates.append(f"starts_at=${len(vals)}::timestamptz")
    if body.ends_at is not None:
        vals.append(body.ends_at); updates.append(f"ends_at=${len(vals)}::timestamptz")
    if body.max_attendees is not None:
        vals.append(body.max_attendees); updates.append(f"max_attendees=${len(vals)}")
    if body.registration_open is not None:
        vals.append(body.registration_open); updates.append(f"registration_open=${len(vals)}")
    if body.tags is not None:
        vals.append(json.dumps(body.tags)); updates.append(f"tags=${len(vals)}::jsonb")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [event_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.prachar_events SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid AND is_active=TRUE RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Event not found")
    return dict(row)


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.prachar_events SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        event_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Event not found")
    return {"ok": True}


@router.post("/events/{event_id}/register")
async def register_for_event(
    event_id: str,
    body: EventRegistration,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    event = await pool.fetchrow(
        "SELECT id, registration_open, max_attendees FROM staging.prachar_events "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        event_id, org_id,
    )
    if not event:
        raise HTTPException(404, "Event not found")
    if not event["registration_open"]:
        raise HTTPException(400, "Registration is closed")

    if event["max_attendees"]:
        current = await pool.fetchval(
            "SELECT COUNT(*) FROM staging.prachar_event_registrations "
            "WHERE event_id=$1::uuid AND status != 'cancelled'",
            event_id,
        )
        if current >= event["max_attendees"]:
            raise HTTPException(400, "Event is full")

    row = await pool.fetchrow(
        "INSERT INTO staging.prachar_event_registrations "
        "(event_id, org_id, name, email, phone, contact_id) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, NULLIF($6,'')::uuid) "
        "ON CONFLICT (event_id, email) DO UPDATE SET name=$3, phone=$5 "
        "RETURNING *",
        event_id, org_id, body.name, body.email, body.phone, body.contact_id,
    )
    return dict(row)


@router.get("/events/{event_id}/registrations")
async def list_registrations(
    event_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT r.*, c.name AS contact_name "
        "FROM staging.prachar_event_registrations r "
        "LEFT JOIN staging.graha_contacts c ON c.id = r.contact_id "
        "WHERE r.event_id=$1::uuid AND r.org_id=$2::uuid ORDER BY r.registered_at DESC",
        event_id, org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.patch("/events/{event_id}/registrations/{reg_id}")
async def update_registration(
    event_id: str,
    reg_id: str,
    status: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    valid = ("registered", "attended", "no_show", "cancelled")
    if status not in valid:
        raise HTTPException(400, f"status must be one of: {', '.join(valid)}")
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE staging.prachar_event_registrations SET status=$1 "
        "WHERE id=$2::uuid AND event_id=$3::uuid AND org_id=$4::uuid RETURNING *",
        status, reg_id, event_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Registration not found")
    return dict(row)
