"""
hub.py — Srijan (सृजन) Router
Client management, brand profiles, content generation, credit management.
All endpoints gated by require_module("srijan").
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
from middleware.roles import require_role
from middleware.subscription import require_module
from services.ai_router import generate, deduct_credits, CREDIT_COSTS

router = APIRouter(prefix="/api/v1/hub", tags=["hub"])

_hub_gate = require_module("srijan")


# ── Pydantic Models ──────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    slug: str
    industry: str = ""
    website: str = ""
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""

class ClientUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    is_active: Optional[bool] = None

class BrandProfileUpdate(BaseModel):
    brand_voice: Optional[str] = None
    tone: Optional[str] = None
    target_audience: Optional[str] = None
    languages: Optional[list[str]] = None
    color_primary: Optional[str] = None
    color_secondary: Optional[str] = None
    color_accent: Optional[str] = None
    tagline: Optional[str] = None
    content_dos: Optional[str] = None
    content_donts: Optional[str] = None
    social_handles: Optional[dict] = None
    sample_posts: Optional[list[dict]] = None

class ContentGenerate(BaseModel):
    agent_type: str
    brief: str
    platform: str = ""
    language: str = "en"
    extra_instructions: str = ""

class ContentReview(BaseModel):
    status: str
    review_notes: str = ""

class SkillAssign(BaseModel):
    custom_config: dict = {}
    schedule: str = ""

class SkillRun(BaseModel):
    variables: dict = {}

class CreditTopup(BaseModel):
    amount: int
    notes: str = ""


# ── Helpers ──────────────────────────────────────────────────

def _build_system_prompt(brand: dict) -> str:
    parts = ["You are a marketing content creator for a brand with the following profile:"]
    if brand.get("brand_voice"):
        parts.append(f"Brand Voice: {brand['brand_voice']}")
    if brand.get("tone"):
        parts.append(f"Tone: {brand['tone']}")
    if brand.get("target_audience"):
        parts.append(f"Target Audience: {brand['target_audience']}")
    if brand.get("tagline"):
        parts.append(f"Tagline: {brand['tagline']}")
    if brand.get("content_dos"):
        parts.append(f"DO: {brand['content_dos']}")
    if brand.get("content_donts"):
        parts.append(f"DON'T: {brand['content_donts']}")
    samples = brand.get("sample_posts")
    if samples:
        parts.append(f"Example posts for reference: {json.dumps(samples[:3])}")
    return "\n".join(parts)


AGENT_PROMPTS = {
    "social_media": "Create a social media post for {platform}. Brief: {brief}. {extra}Keep it engaging, concise, and include relevant hashtags. Output the post text only.",
    "blog": "Write a blog article. Brief: {brief}. {extra}Include a compelling headline, introduction, body with subheadings, and conclusion. Output in markdown format.",
    "ad_copy": "Write advertising copy for {platform}. Brief: {brief}. {extra}Include a headline, body text, and call-to-action. Keep it persuasive and conversion-focused.",
    "email": "Write a marketing email. Brief: {brief}. {extra}Include subject line, preview text, and email body. Keep it professional and action-oriented.",
    "whatsapp": "Write a WhatsApp business message. Brief: {brief}. {extra}Keep it short, friendly, and conversational. Under 1000 characters.",
    "lead_magnet": "Create content for a lead magnet. Brief: {brief}. {extra}This should be valuable, actionable content that demonstrates expertise. Output in structured markdown.",
    "campaign": "Create a complete marketing campaign strategy. Brief: {brief}. {extra}Include: campaign name, objective, target audience segments, key messages, channel strategy (social/email/ads), content calendar for 2 weeks, KPIs to track, and budget allocation suggestions. Output in structured markdown.",
    "seo": "Create SEO-optimized content. Brief: {brief}. {extra}Include: primary and secondary keywords, meta title (under 60 chars), meta description (under 155 chars), H1/H2/H3 heading structure, the full article body (1500+ words) with natural keyword placement, internal linking suggestions, and a FAQ section with schema-ready Q&As. Output in structured markdown.",
}


async def _verify_client_access(pool, client_id: str, org_id: str) -> dict:
    """Verify the client belongs to this org. Returns the client row."""
    client = await pool.fetchrow(
        "SELECT * FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        client_id, org_id,
    )
    if not client:
        raise HTTPException(404, "Client not found")
    return client


# ── Client Management ────────────────────────────────────────

@router.get("/clients")
async def list_clients(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT c.*, w.balance as credits, w.monthly_allocation "
        "FROM staging.hub_clients c "
        "LEFT JOIN staging.hub_credit_wallets w ON w.client_id = c.id "
        "WHERE c.org_id=$1::uuid ORDER BY c.name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/clients")
async def create_client(
    body: ClientCreate,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()

    import re
    if not re.match(r'^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$', body.slug):
        raise HTTPException(400, "Slug must be 3-50 chars, lowercase alphanumeric and hyphens only")

    existing = await pool.fetchval(
        "SELECT 1 FROM staging.hub_clients WHERE slug=$1", body.slug
    )
    if existing:
        raise HTTPException(409, "Slug already taken")

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_clients "
        "(org_id, name, slug, industry, website, contact_name, contact_email, contact_phone) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        org_id, body.name, body.slug, body.industry, body.website,
        body.contact_name, body.contact_email, body.contact_phone,
    )
    client_id = str(row["id"])

    await pool.execute(
        "INSERT INTO staging.hub_brand_profiles (client_id) VALUES ($1::uuid)", client_id
    )
    await pool.execute(
        "INSERT INTO staging.hub_credit_wallets (client_id, balance, monthly_allocation) "
        "VALUES ($1::uuid, 0, 0)", client_id
    )

    return dict(row)


@router.get("/clients/{client_id}")
async def get_client(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    client = await _verify_client_access(pool, str(client_id), org_id)

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", str(client_id)
    )
    wallet = await pool.fetchrow(
        "SELECT * FROM staging.hub_credit_wallets WHERE client_id=$1::uuid", str(client_id)
    )
    content_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.hub_content_items WHERE client_id=$1::uuid", str(client_id)
    )

    return {
        "client": dict(client),
        "brand": dict(brand) if brand else None,
        "wallet": dict(wallet) if wallet else None,
        "content_count": content_count or 0,
    }


@router.patch("/clients/{client_id}")
async def update_client(
    client_id: UUID,
    body: ClientUpdate,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    set_clauses = ", ".join(f"{k}=${i+2}" for i, k in enumerate(updates))
    values = [str(client_id)] + list(updates.values())

    await pool.execute(
        f"UPDATE staging.hub_clients SET {set_clauses}, updated_at=NOW() WHERE id=$1::uuid",
        *values,
    )
    return {"status": "updated"}


# ── Brand Profile ────────────────────────────────────────────

@router.get("/clients/{client_id}/brand")
async def get_brand(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", str(client_id)
    )
    return dict(brand) if brand else {}


@router.put("/clients/{client_id}/brand")
async def update_brand(
    client_id: UUID,
    body: BrandProfileUpdate,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    for k in ("social_handles",):
        if k in updates and isinstance(updates[k], dict):
            updates[k] = json.dumps(updates[k])
    for k in ("sample_posts",):
        if k in updates and isinstance(updates[k], list):
            updates[k] = json.dumps(updates[k])

    set_clauses = ", ".join(f"{k}=${i+2}" for i, k in enumerate(updates))
    values = [str(client_id)] + list(updates.values())

    await pool.execute(
        f"UPDATE staging.hub_brand_profiles SET {set_clauses}, updated_at=NOW() WHERE client_id=$1::uuid",
        *values,
    )
    return {"status": "updated"}


# ── Content Generation ───────────────────────────────────────

@router.post("/clients/{client_id}/generate")
async def generate_content(
    client_id: UUID,
    body: ContentGenerate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)
    cid = str(client_id)

    if body.agent_type not in AGENT_PROMPTS:
        raise HTTPException(400, f"Invalid agent type: {body.agent_type}")

    new_balance = await deduct_credits(cid, body.agent_type, user["user_id"])

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", cid
    )
    system_prompt = _build_system_prompt(dict(brand)) if brand else ""
    if body.language != "en":
        system_prompt += f"\nIMPORTANT: Write all content in {body.language}."

    user_prompt = AGENT_PROMPTS[body.agent_type].format(
        platform=body.platform or "general",
        brief=body.brief,
        extra=f"{body.extra_instructions}\n" if body.extra_instructions else "",
    )

    result = await generate(
        prompt=user_prompt,
        system=system_prompt,
        client_id=cid,
        max_tokens=2048 if body.agent_type != "blog" else 4096,
        language=body.language,
        agent_type=body.agent_type,
    )

    title = body.brief[:100] if body.brief else f"{body.agent_type} content"
    hashtags = []
    if body.agent_type == "social_media":
        import re
        hashtags = re.findall(r'#\w+', result["text"])

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_content_items "
        "(client_id, agent_type, title, body, platform, hashtags, status, credits_used, "
        " metadata, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'draft', $7, $8::jsonb, $9) RETURNING *",
        cid, body.agent_type, title, result["text"],
        body.platform or None, hashtags, CREDIT_COSTS.get(body.agent_type, 2),
        json.dumps({"provider": result["provider"], "model": result["model"],
                     "language": body.language}),
        user["user_id"],
    )

    return {
        "content": dict(row),
        "credits_remaining": new_balance,
        "ai": {"provider": result["provider"], "model": result["model"]},
    }


@router.get("/clients/{client_id}/content")
async def list_content(
    client_id: UUID,
    status: Optional[str] = None,
    agent_type: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    query = "SELECT * FROM staging.hub_content_items WHERE client_id=$1::uuid"
    params: list = [str(client_id)]

    if status:
        params.append(status)
        query += f" AND status=${len(params)}"
    if agent_type:
        params.append(agent_type)
        query += f" AND agent_type=${len(params)}"

    query += " ORDER BY created_at DESC"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.get("/clients/{client_id}/content/{content_id}")
async def get_content(
    client_id: UUID,
    content_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    row = await pool.fetchrow(
        "SELECT * FROM staging.hub_content_items WHERE id=$1::uuid AND client_id=$2::uuid",
        content_id, str(client_id),
    )
    if not row:
        raise HTTPException(404, "Content item not found")
    return dict(row)


@router.patch("/clients/{client_id}/content/{content_id}/review")
async def review_content(
    client_id: UUID,
    content_id: UUID,
    body: ContentReview,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "Status must be 'approved' or 'rejected'")

    result = await pool.execute(
        "UPDATE staging.hub_content_items SET status=$1, reviewed_by=$2, "
        "reviewed_at=NOW(), review_notes=$3, updated_at=NOW() "
        "WHERE id=$4::uuid AND client_id=$5::uuid AND status IN ('draft', 'pending_review')",
        body.status, user["user_id"], body.review_notes,
        content_id, str(client_id),
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Content not found or not in reviewable state")

    await pool.execute(
        "INSERT INTO staging.hub_content_approvals "
        "(content_item_id, action, reviewer_id, notes) VALUES ($1, $2, $3, $4)",
        content_id, body.status, user["user_id"], body.review_notes,
    )
    return {"status": body.status}


# ── Credit Management ───────────────────────────────────────

@router.get("/clients/{client_id}/credits")
async def get_credits(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    wallet = await pool.fetchrow(
        "SELECT * FROM staging.hub_credit_wallets WHERE client_id=$1::uuid", str(client_id)
    )
    recent_tx = await pool.fetch(
        "SELECT * FROM staging.hub_credit_transactions "
        "WHERE client_id=$1::uuid ORDER BY created_at DESC LIMIT 20",
        str(client_id),
    )
    return {
        "wallet": dict(wallet) if wallet else None,
        "recent_transactions": [dict(r) for r in recent_tx],
        "credit_costs": CREDIT_COSTS,
    }


@router.post("/clients/{client_id}/credits/topup")
async def topup_credits(
    client_id: UUID,
    body: CreditTopup,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)
    cid = str(client_id)

    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    wallet = await pool.fetchrow(
        "SELECT balance FROM staging.hub_credit_wallets WHERE client_id=$1::uuid FOR UPDATE",
        cid,
    )
    if not wallet:
        raise HTTPException(404, "Credit wallet not found")

    new_balance = wallet["balance"] + body.amount

    await pool.execute(
        "UPDATE staging.hub_credit_wallets SET balance=$1, updated_at=NOW() WHERE client_id=$2::uuid",
        new_balance, cid,
    )
    await pool.execute(
        "INSERT INTO staging.hub_credit_transactions "
        "(client_id, amount, balance_after, tx_type, description, created_by) "
        "VALUES ($1::uuid, $2, $3, 'topup', $4, $5)",
        cid, body.amount, new_balance,
        body.notes or "Manual top-up", user["user_id"],
    )
    return {"balance": new_balance}


# ── Dashboard Stats ──────────────────────────────────────────

@router.get("/dashboard")
async def hub_dashboard(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()

    clients = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.hub_clients WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    total_credits = await pool.fetchval(
        "SELECT COALESCE(SUM(w.balance), 0) FROM staging.hub_credit_wallets w "
        "JOIN staging.hub_clients c ON c.id = w.client_id "
        "WHERE c.org_id=$1::uuid",
        org_id,
    )
    content_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.hub_content_items ci "
        "JOIN staging.hub_clients c ON c.id = ci.client_id "
        "WHERE c.org_id=$1::uuid",
        org_id,
    )
    pending_review = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.hub_content_items ci "
        "JOIN staging.hub_clients c ON c.id = ci.client_id "
        "WHERE c.org_id=$1::uuid AND ci.status IN ('draft', 'pending_review')",
        org_id,
    )

    recent_content = await pool.fetch(
        "SELECT ci.id, ci.title, ci.agent_type, ci.status, ci.created_at, c.name as client_name "
        "FROM staging.hub_content_items ci "
        "JOIN staging.hub_clients c ON c.id = ci.client_id "
        "WHERE c.org_id=$1::uuid ORDER BY ci.created_at DESC LIMIT 10",
        org_id,
    )

    return {
        "stats": {
            "total_clients": clients or 0,
            "total_credits": total_credits or 0,
            "total_content": content_count or 0,
            "pending_review": pending_review or 0,
        },
        "recent_content": [dict(r) for r in recent_content],
        "credit_costs": CREDIT_COSTS,
    }


# ── Skill Pack Templates (global catalog) ───────────────────

@router.get("/skills/templates")
async def list_skill_templates(
    user=Depends(require_user),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.hub_skill_templates WHERE is_active=TRUE ORDER BY category, name"
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/skills/templates/{template_id}")
async def get_skill_template(
    template_id: UUID,
    user=Depends(require_user),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.hub_skill_templates WHERE id=$1 AND is_active=TRUE",
        template_id,
    )
    if not row:
        raise HTTPException(404, "Skill template not found")
    return dict(row)


# ── Client Skills (per-client, isolated) ─────────────────────

@router.get("/clients/{client_id}/skills")
async def list_client_skills(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    rows = await pool.fetch(
        "SELECT cs.*, t.name as template_name, t.description as template_description, "
        "t.category, t.estimated_credits, t.icon, t.steps "
        "FROM staging.hub_client_skills cs "
        "JOIN staging.hub_skill_templates t ON t.id = cs.template_id "
        "WHERE cs.client_id=$1::uuid ORDER BY cs.created_at DESC",
        str(client_id),
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/clients/{client_id}/skills/{template_id}")
async def assign_skill(
    client_id: UUID,
    template_id: UUID,
    body: SkillAssign,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    tmpl = await pool.fetchrow(
        "SELECT id FROM staging.hub_skill_templates WHERE id=$1 AND is_active=TRUE",
        template_id,
    )
    if not tmpl:
        raise HTTPException(404, "Skill template not found")

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_client_skills "
        "(client_id, template_id, custom_config, schedule, assigned_by) "
        "VALUES ($1::uuid, $2, $3::jsonb, $4, $5) "
        "ON CONFLICT (client_id, template_id) DO UPDATE SET "
        "custom_config=EXCLUDED.custom_config, schedule=EXCLUDED.schedule, "
        "is_active=TRUE, updated_at=NOW() RETURNING *",
        str(client_id), template_id, json.dumps(body.custom_config),
        body.schedule or None, user["user_id"],
    )
    return dict(row)


@router.delete("/clients/{client_id}/skills/{skill_id}")
async def remove_skill(
    client_id: UUID,
    skill_id: UUID,
    user=Depends(require_role("admin")),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    await pool.execute(
        "UPDATE staging.hub_client_skills SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1 AND client_id=$2::uuid",
        skill_id, str(client_id),
    )
    return {"status": "removed"}


@router.post("/clients/{client_id}/skills/{skill_id}/run")
async def run_skill(
    client_id: UUID,
    skill_id: UUID,
    body: SkillRun,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Execute a skill pack for a client. Runs each step sequentially,
    generating content using the client's brand profile."""
    pool = await get_pool()
    client = await _verify_client_access(pool, str(client_id), org_id)
    cid = str(client_id)

    cs = await pool.fetchrow(
        "SELECT cs.*, t.steps, t.name as template_name "
        "FROM staging.hub_client_skills cs "
        "JOIN staging.hub_skill_templates t ON t.id = cs.template_id "
        "WHERE cs.id=$1 AND cs.client_id=$2::uuid AND cs.is_active=TRUE",
        skill_id, cid,
    )
    if not cs:
        raise HTTPException(404, "Client skill not found")

    steps = cs["steps"] if isinstance(cs["steps"], list) else json.loads(cs["steps"])
    custom_config = cs["custom_config"] if isinstance(cs["custom_config"], dict) else json.loads(cs["custom_config"] or "{}")

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", cid
    )
    system_prompt = _build_system_prompt(dict(brand)) if brand else ""

    # Merge variables: body.variables + custom_config
    variables = {**custom_config, **body.variables}

    run = await pool.fetchrow(
        "INSERT INTO staging.hub_skill_runs "
        "(client_skill_id, client_id, steps_total, triggered_by) "
        "VALUES ($1, $2::uuid, $3, $4) RETURNING *",
        skill_id, cid, len(steps), user["user_id"],
    )
    run_id = run["id"]

    outputs = []
    content_ids = []
    total_credits = 0

    for step in sorted(steps, key=lambda s: s.get("order", 0)):
        agent_type = step["agent_type"]
        prompt_template = step["prompt_template"]

        # Substitute variables into prompt
        prompt = prompt_template
        for k, v in variables.items():
            prompt = prompt.replace(f"{{{k}}}", str(v))

        try:
            new_balance = await deduct_credits(cid, agent_type, user["user_id"])
        except Exception:
            await pool.execute(
                "UPDATE staging.hub_skill_runs SET status='failed', "
                "error_message='Insufficient credits', completed_at=NOW(), "
                "steps_completed=$1, credits_used=$2, outputs=$3::jsonb, "
                "content_item_ids=$4 WHERE id=$5",
                len(outputs), total_credits, json.dumps(outputs), content_ids, run_id,
            )
            raise

        language = variables.get("language", "en")
        if brand and brand.get("languages"):
            langs = brand["languages"]
            if isinstance(langs, list) and langs:
                language = langs[0]

        result = await generate(
            prompt=prompt,
            system=system_prompt,
            client_id=cid,
            max_tokens=4096 if agent_type in ("blog", "seo", "campaign") else 2048,
            language=language,
            agent_type=agent_type,
        )

        title = f"{cs['template_name']} — Step {step.get('order', 0)}"
        credits_cost = CREDIT_COSTS.get(agent_type, 2)

        row = await pool.fetchrow(
            "INSERT INTO staging.hub_content_items "
            "(client_id, agent_type, title, body, platform, status, credits_used, "
            " metadata, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, 'draft', $6, $7::jsonb, $8) RETURNING id",
            cid, agent_type, title, result["text"],
            step.get("platform"), credits_cost,
            json.dumps({"skill_run_id": str(run_id), "provider": result["provider"],
                         "model": result["model"], "step": step.get("order")}),
            user["user_id"],
        )
        content_ids.append(row["id"])
        total_credits += credits_cost
        outputs.append({
            "step": step.get("order"),
            "agent_type": agent_type,
            "content_id": str(row["id"]),
            "provider": result["provider"],
        })

        await pool.execute(
            "UPDATE staging.hub_skill_runs SET steps_completed=$1 WHERE id=$2",
            len(outputs), run_id,
        )

    await pool.execute(
        "UPDATE staging.hub_skill_runs SET status='completed', completed_at=NOW(), "
        "credits_used=$1, outputs=$2::jsonb, content_item_ids=$3 WHERE id=$4",
        total_credits, json.dumps(outputs), content_ids, run_id,
    )

    return {
        "run_id": str(run_id),
        "status": "completed",
        "steps_completed": len(outputs),
        "credits_used": total_credits,
        "content_ids": [str(c) for c in content_ids],
    }


@router.get("/clients/{client_id}/skills/{skill_id}/runs")
async def list_skill_runs(
    client_id: UUID,
    skill_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    rows = await pool.fetch(
        "SELECT * FROM staging.hub_skill_runs "
        "WHERE client_skill_id=$1 AND client_id=$2::uuid ORDER BY started_at DESC LIMIT 20",
        skill_id, str(client_id),
    )
    return {"data": [dict(r) for r in rows]}


# ── Content Approval History ─────────────────────────────────

@router.get("/clients/{client_id}/content/{content_id}/approvals")
async def list_approvals(
    client_id: UUID,
    content_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    rows = await pool.fetch(
        "SELECT * FROM staging.hub_content_approvals "
        "WHERE content_item_id=$1 ORDER BY created_at DESC",
        content_id,
    )
    return {"data": [dict(r) for r in rows]}
