"""
hub.py — Srijan (सृजन) Router
Org-level content generation, skill packs, credit management, brand profiles.
All endpoints gated by require_module("srijan").
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

log = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_platform_role
from middleware.role_tiers import (
    OPERATIONS_CONSOLE_ROLES, SRIJAN_COMMERCIAL_ROLES,
)
from middleware.subscription import require_module
from services.ai_router import (
    generate, generate_image, generate_rich_content, deduct_credits,
    deduct_org_credits, refund_org_credits, _maybe_reset_monthly_credits, CREDIT_COSTS,
)
from services.skills.prompt import fill_prompt
from services.skills.context import context_for_step, SOURCES as CONTEXT_SOURCES
from services.skill_dispatcher import (
    _run_function_step, SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS,
    UNIMPLEMENTED_SKILL_FUNCTIONS, describe_skill_functions,
)

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

class QuickGenerate(BaseModel):
    skill: str
    topic: str
    platform: str = "Instagram"
    tone: str = "Professional"
    language: str = "en"
    with_image: bool = True
    extra: str = ""

class ContentReview(BaseModel):
    status: str
    review_notes: str = ""

class SkillAssign(BaseModel):
    custom_config: dict = {}
    schedule: str = ""

class SkillRun(BaseModel):
    variables: dict = {}
    generate_images: bool = False

class SkillTemplateCreate(BaseModel):
    name: str
    description: str = ""
    category: str = "general"
    steps: list[dict]
    estimated_credits: int = 0
    icon: str = "star"

class CreditTopup(BaseModel):
    amount: int
    notes: str = ""

class OrgSkillAssign(BaseModel):
    custom_config: dict = {}

class OrgCreditTopup(BaseModel):
    amount: int
    notes: str = ""

class UserCreditAllocate(BaseModel):
    amount: int

class OrgContentGenerate(BaseModel):
    agent_type: str
    brief: str
    platform: str = ""
    language: str = "en"
    extra_instructions: str = ""
    generate_image: bool = False
    image_prompt: str = ""
    aspect_ratio: str = "1:1"


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
    "ad_analysis": "Analyse the following ad performance data and provide actionable insights. Brief: {brief}. {extra}Include: top/bottom performing campaigns with reasons, budget reallocation recommendations, audience/creative suggestions, trend analysis, and a summary scorecard. Output in structured markdown with tables.",
}


#: Kept as a module-level alias so the two run paths below read the same as they
#: did when the helper lived here. The implementation moved to `services/` so the
#: dispatcher — which must not import from `routers/` — can share it.
_fill_prompt = fill_prompt


async def _verify_client_access(pool, client_id: str, org_id: str) -> dict:
    """Verify the client belongs to this org. Returns the client row."""
    client = await pool.fetchrow(
        "SELECT * FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        client_id, org_id,
    )
    if not client:
        raise HTTPException(404, "Client not found")
    return client


# ── Org-level default client (auto-created) ─────────────────

@router.get("/org-client")
async def get_or_create_org_client(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Return the default org-level client, auto-creating it if needed.
    This lets admin/members access Srijan features without manually creating a client."""
    pool = await get_pool()

    row = await pool.fetchrow(
        "SELECT c.*, w.balance as credits, w.monthly_allocation "
        "FROM staging.hub_clients c "
        "LEFT JOIN staging.hub_credit_wallets w ON w.client_id = c.id "
        "WHERE c.org_id=$1::uuid AND c.is_internal=TRUE AND c.is_active=TRUE",
        org_id,
    )
    if row:
        brand = await pool.fetchrow(
            "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", str(row["id"])
        )
        return {"client": dict(row), "brand": dict(brand) if brand else None}

    org = await pool.fetchrow(
        "SELECT name FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    org_name = org["name"] if org else "My Organisation"
    slug = org_name.lower().replace(" ", "-")[:50]
    import re
    slug = re.sub(r'[^a-z0-9-]', '', slug) or "org"

    existing_slug = await pool.fetchval("SELECT 1 FROM staging.hub_clients WHERE slug=$1", slug)
    if existing_slug:
        slug = f"{slug}-{org_id[:8]}"

    client = await pool.fetchrow(
        "INSERT INTO staging.hub_clients "
        "(org_id, name, slug, is_internal) "
        "VALUES ($1::uuid, $2, $3, TRUE) RETURNING *",
        org_id, org_name, slug,
    )
    cid = str(client["id"])

    await pool.execute(
        "INSERT INTO staging.hub_brand_profiles (client_id) VALUES ($1::uuid)", cid
    )
    await pool.execute(
        "INSERT INTO staging.hub_credit_wallets (client_id, balance, monthly_allocation) "
        "VALUES ($1::uuid, 100, 100)", cid
    )

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", cid
    )
    return {"client": dict(client), "brand": dict(brand) if brand else None}


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
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
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
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
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
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
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
        org_id=org_id,
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
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
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
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
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


@router.get("/skills/capabilities")
async def list_skill_capabilities(
    user=Depends(require_user),
    _=Depends(_hub_gate),
):
    """What a skill step can be built out of: data functions and context sources.

    Served rather than hard-coded in the editor. The step editor previously
    offered `agent_type` alone from a list written out in the frontend, and the
    one price list that WAS duplicated there had already gone stale and was
    quoting people the wrong cost — see `AGENT_TYPES` in
    `pages/hub/skills/_shared.jsx`. A second copy of the registry would go the
    same way, except the failure would be a template naming a function that does
    not exist.

    Readable by any Srijan user, not gated to the roles that may CREATE
    templates: the same list drives the read-only step display on the Catalog
    and Assigned tabs, which everyone sees.
    """
    return {
        "skill_functions": describe_skill_functions(),
        "context_sources": [
            {"key": key, "label": src.label, "kind": src.kind}
            for key, src in sorted(CONTEXT_SOURCES.items())
        ],
        "unimplemented": sorted(UNIMPLEMENTED_SKILL_FUNCTIONS),
    }


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


@router.post("/skills/templates")
async def create_skill_template(
    body: SkillTemplateCreate,
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    valid_categories = ("general", "festival", "launch", "engagement", "branding", "seasonal", "industry")
    if body.category not in valid_categories:
        raise HTTPException(400, f"Category must be one of: {', '.join(valid_categories)}")
    if not body.steps:
        raise HTTPException(400, "At least one step is required")

    # Two kinds of step, and the validator used to know only one. It required a
    # valid `agent_type` AND a non-empty `prompt_template` on every step, so a
    # data step — which has neither — was refused outright. That is why the
    # dispatcher's function path could not be authored even after it worked.
    valid_agents = set(AGENT_PROMPTS.keys())
    for i, step in enumerate(body.steps):
        fn = step.get("skill_function")
        if fn:
            if fn in UNIMPLEMENTED_SKILL_FUNCTIONS:
                raise HTTPException(
                    400,
                    f"Step {i+1}: '{fn}' is named in the registry but has no "
                    f"implementation. It cannot be run.",
                )
            if fn not in SKILL_REGISTRY:
                raise HTTPException(
                    400,
                    f"Step {i+1}: unknown skill function '{fn}'. "
                    f"Must be one of: {', '.join(sorted(SKILL_REGISTRY))}",
                )
            # Opting a template into writes is a decision, not a default. The
            # step has to say so here as well as at run time, so the refusal
            # lands while someone is authoring rather than mid-run against a
            # customer's invoices.
            if fn in WRITE_SKILL_FUNCTIONS and not step.get("allow_writes"):
                raise HTTPException(
                    400,
                    f"Step {i+1}: '{fn}' writes data. Set allow_writes on the "
                    f"step to confirm that is intended.",
                )
        else:
            if step.get("agent_type") not in valid_agents:
                raise HTTPException(400, f"Step {i+1}: invalid agent_type. Must be one of: {', '.join(valid_agents)}")
            if not (step.get("prompt_template") or "").strip():
                raise HTTPException(400, f"Step {i+1}: prompt_template is required")

        # Context is available to either kind. A name that does not exist would
        # otherwise surface only as an "unavailable" line at run time, long
        # after whoever typed it has gone.
        for source in (step.get("context") or []):
            if source not in CONTEXT_SOURCES:
                raise HTTPException(
                    400,
                    f"Step {i+1}: unknown context source '{source}'. "
                    f"Must be one of: {', '.join(sorted(CONTEXT_SOURCES))}",
                )

    steps_with_order = [
        {**s, "order": s.get("order", i + 1)} for i, s in enumerate(body.steps)
    ]
    # Data steps call no model, so they cost nothing. Counting them at the
    # `.get(..., 2)` fallback would have quoted a price for work that is free.
    estimated = body.estimated_credits or sum(
        0 if s.get("skill_function") else CREDIT_COSTS.get(s.get("agent_type"), 2)
        for s in steps_with_order
    )

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_skill_templates "
        "(name, description, category, steps, estimated_credits, icon) "
        "VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING *",
        body.name, body.description, body.category,
        json.dumps(steps_with_order), estimated, body.icon,
    )
    return dict(row)


@router.delete("/skills/templates/{template_id}")
async def delete_skill_template(
    template_id: UUID,
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.hub_skill_templates SET is_active=FALSE, updated_at=NOW() WHERE id=$1",
        template_id,
    )
    return {"status": "deactivated"}


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
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
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
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
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

    # See the org path for why earlier steps' findings are carried forward.
    prior_facts: list[str] = []

    for step in sorted(steps, key=lambda s: s.get("order", 0)):
        # Data-first step: reads records, calls no model, costs no AI credits.
        if step.get("skill_function"):
            try:
                data = await _run_function_step(
                    pool, step, variables, org_id, user["user_id"]
                )
            except Exception as exc:
                log.warning("Skill function step %s failed: %s", step.get("order"), exc)
                outputs.append({
                    "step": step.get("order"),
                    "skill_function": step["skill_function"],
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {exc}",
                })
                prior_facts.append(
                    f"## {step.get('label') or step['skill_function']}\n"
                    f"Unavailable ({type(exc).__name__}). Treat as unknown, not as empty."
                )
                continue

            outputs.append({
                "step": step.get("order"),
                "skill_function": step["skill_function"],
                "status": "ok",
                "credits_used": 0,
            })
            prior_facts.append(
                f"## {step.get('label') or step['skill_function']}\n"
                + json.dumps(data, default=str, ensure_ascii=False)[:4000]
            )
            await pool.execute(
                "UPDATE staging.hub_skill_runs SET steps_completed=$1 WHERE id=$2",
                len(outputs), run_id,
            )
            continue

        agent_type = step["agent_type"]
        prompt_template = step["prompt_template"]

        prompt = _fill_prompt(prompt_template, variables)

        # This client's knowledge base, not the org's — `cid` scopes retrieval
        # to the brand being worked on, which is the isolation the Skill Packs
        # screen promises ("every step reads that client's brand profile and
        # nobody else's").
        grounding = await context_for_step(pool, step, org_id, variables, client_id=cid)
        if prior_facts:
            grounding = (grounding + "\n" if grounding else "") + "\n".join(prior_facts)
        if grounding:
            prompt = (
                f"{grounding}\n\n---\n\nUsing only the data above where it is "
                f"relevant, do the following.\n\n{prompt}"
            )

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
            org_id=org_id,
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

    # Verifying the CLIENT and then reading by CONTENT id alone is not a scope.
    # `content_id` is a separate path parameter, so a caller could pair their own
    # client with another org's content id and read that org's review history —
    # who reviewed it, when, and the reviewer's notes verbatim.
    #
    # `hub_content_approvals` has no org_id; the tenant path is
    # content_item_id -> hub_content_items.client_id -> hub_clients.org_id, and
    # the client half is already proved above. The sibling write path
    # (`review_content`) has always scoped its UPDATE with `AND client_id=`;
    # only this read was missing it.
    rows = await pool.fetch(
        "SELECT a.* FROM staging.hub_content_approvals a "
        "JOIN staging.hub_content_items ci ON ci.id = a.content_item_id "
        "WHERE a.content_item_id=$1 AND ci.client_id=$2::uuid "
        "ORDER BY a.created_at DESC",
        content_id, str(client_id),
    )
    return {"data": [dict(r) for r in rows]}


# ── AI Spend Analytics ─────────────────────────────────────────

@router.get("/analytics/spend")
async def ai_spend_analytics(
    days: int = 30,
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Org-wide AI spend analytics: cost by provider, model, agent type, and client."""
    pool = await get_pool()

    by_provider = await pool.fetch(
        "SELECT l.provider, l.model, COUNT(*) as calls, "
        "SUM(l.prompt_tokens) as total_prompt_tokens, "
        "SUM(l.completion_tokens) as total_completion_tokens, "
        "SUM(l.cost_usd) as total_cost_usd, "
        "AVG(l.latency_ms)::int as avg_latency_ms "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id=$1::uuid AND l.status='success' "
        "AND l.created_at >= NOW() - ($2 || ' days')::interval "
        "GROUP BY l.provider, l.model ORDER BY total_cost_usd DESC",
        org_id, str(days),
    )

    by_client = await pool.fetch(
        "SELECT c.name as client_name, l.client_id, COUNT(*) as calls, "
        "SUM(l.cost_usd) as total_cost_usd, "
        "SUM(l.prompt_tokens + l.completion_tokens) as total_tokens "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id=$1::uuid AND l.status='success' "
        "AND l.created_at >= NOW() - ($2 || ' days')::interval "
        "GROUP BY c.name, l.client_id ORDER BY total_cost_usd DESC",
        org_id, str(days),
    )

    totals = await pool.fetchrow(
        "SELECT COUNT(*) as total_calls, "
        "COALESCE(SUM(l.cost_usd), 0) as total_cost_usd, "
        "COALESCE(SUM(l.prompt_tokens), 0) as total_prompt_tokens, "
        "COALESCE(SUM(l.completion_tokens), 0) as total_completion_tokens, "
        "COUNT(*) FILTER (WHERE l.status='error') as failed_calls "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id=$1::uuid "
        "AND l.created_at >= NOW() - ($2 || ' days')::interval",
        org_id, str(days),
    )

    return {
        "period_days": days,
        "totals": dict(totals) if totals else {},
        "by_provider": [dict(r) for r in by_provider],
        "by_client": [dict(r) for r in by_client],
    }


@router.get("/clients/{client_id}/analytics/spend")
async def client_spend_analytics(
    client_id: UUID,
    days: int = 30,
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Per-client AI spend breakdown by provider and agent type."""
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)
    cid = str(client_id)

    by_agent = await pool.fetch(
        "SELECT ci.agent_type, COUNT(*) as calls, "
        "SUM(l.cost_usd) as total_cost_usd, "
        "SUM(l.prompt_tokens + l.completion_tokens) as total_tokens, "
        "AVG(l.latency_ms)::int as avg_latency_ms "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_content_items ci ON ci.client_id = l.client_id "
        "WHERE l.client_id=$1::uuid AND l.status='success' "
        "AND l.created_at >= NOW() - ($2 || ' days')::interval "
        "GROUP BY ci.agent_type ORDER BY total_cost_usd DESC",
        cid, str(days),
    )

    by_provider = await pool.fetch(
        "SELECT provider, model, COUNT(*) as calls, "
        "SUM(cost_usd) as total_cost_usd, "
        "SUM(prompt_tokens) as total_prompt_tokens, "
        "SUM(completion_tokens) as total_completion_tokens, "
        "AVG(latency_ms)::int as avg_latency_ms "
        "FROM staging.hub_ai_logs "
        "WHERE client_id=$1::uuid AND status='success' "
        "AND created_at >= NOW() - ($2 || ' days')::interval "
        "GROUP BY provider, model ORDER BY total_cost_usd DESC",
        cid, str(days),
    )

    daily = await pool.fetch(
        "SELECT created_at::date as date, COUNT(*) as calls, "
        "SUM(cost_usd) as cost_usd "
        "FROM staging.hub_ai_logs "
        "WHERE client_id=$1::uuid AND status='success' "
        "AND created_at >= NOW() - ($2 || ' days')::interval "
        "GROUP BY created_at::date ORDER BY date",
        cid, str(days),
    )

    return {
        "client_id": cid,
        "period_days": days,
        "by_agent_type": [dict(r) for r in by_agent],
        "by_provider": [dict(r) for r in by_provider],
        "daily_spend": [dict(r) for r in daily],
    }


# ── AI Feedback ─────────────────────────────────────────────

class AIFeedbackCreate(BaseModel):
    skill_type: str
    context_type: str
    action: str
    ai_output: dict
    edited_output: dict | None = None
    model_used: str = ""
    tokens_used: int = 0
    cost_usd: float = 0


@router.post("/ai-feedback")
async def record_ai_feedback(
    body: AIFeedbackCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    if body.action not in ("accept", "edit", "reject"):
        raise HTTPException(400, "action must be accept, edit, or reject")
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.ai_feedback "
        "(org_id, skill_type, context_type, action, ai_output, edited_output, "
        " model_used, tokens_used, cost_usd, user_id) "
        "VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::uuid) "
        "RETURNING id",
        org_id, body.skill_type, body.context_type, body.action,
        json.dumps(body.ai_output),
        json.dumps(body.edited_output) if body.edited_output else None,
        body.model_used, body.tokens_used, body.cost_usd, user["user_id"],
    )
    return {"status": "recorded", "id": str(row["id"])}


@router.get("/ai-feedback")
async def list_ai_feedback(
    skill_type: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 50,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    # `cost_usd` is what Aekam pays the model provider. This endpoint is guarded
    # by `require_user` + `get_org_id`, so every member of a tenant could read
    # Aekam's own cost basis per AI call. It is dropped from the projection
    # rather than hidden in the UI — `11-platform-admin.md` §1 requires the
    # containment at the serializer. `tokens_used` stays: it is a property of
    # the tenant's own request, not a price.
    query = (
        "SELECT id, skill_type, context_type, action, model_used, "
        "tokens_used, user_id, created_at "
        "FROM staging.ai_feedback WHERE org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2
    if skill_type:
        query += f"AND skill_type=${idx} "
        params.append(skill_type)
        idx += 1
    if action:
        query += f"AND action=${idx} "
        params.append(action)
        idx += 1
    query += f"ORDER BY created_at DESC LIMIT ${idx}"
    params.append(min(limit, 200))
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.get("/ai-feedback/stats")
async def ai_feedback_stats(
    days: int = 30,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    # `SUM(cost_usd) as total_cost` removed: summing it does not make it any
    # less Aekam's cost basis, and `by_skill_action` below hands each row
    # straight to the caller. Counts and token totals are the tenant's own.
    rows = await pool.fetch(
        "SELECT skill_type, action, COUNT(*) as count, "
        "COALESCE(SUM(tokens_used), 0) as total_tokens "
        "FROM staging.ai_feedback "
        "WHERE org_id=$1::uuid AND created_at >= NOW() - ($2 || ' days')::interval "
        "GROUP BY skill_type, action ORDER BY count DESC",
        org_id, str(days),
    )
    accept_count = sum(r["count"] for r in rows if r["action"] == "accept")
    total_count = sum(r["count"] for r in rows)
    return {
        "by_skill_action": [dict(r) for r in rows],
        "total_feedback": total_count,
        "acceptance_rate": round(accept_count / total_count * 100, 1) if total_count > 0 else 0,
    }


# ── AI Conversations (short-term memory) ─────────────────────

@router.get("/ai-conversations/{context_type}")
async def get_ai_conversation(
    context_type: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, messages, updated_at FROM staging.ai_conversations "
        "WHERE org_id=$1::uuid AND user_id=$2::uuid AND context_type=$3",
        org_id, user["user_id"], context_type,
    )
    if not row:
        return {"messages": [], "context_type": context_type}
    return {"id": str(row["id"]), "messages": row["messages"], "context_type": context_type, "updated_at": row["updated_at"]}


@router.put("/ai-conversations/{context_type}")
async def upsert_ai_conversation(
    context_type: str,
    body: dict,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    messages = body.get("messages", [])
    if not isinstance(messages, list):
        raise HTTPException(400, "messages must be an array")
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.ai_conversations (org_id, user_id, context_type, messages) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb) "
        "ON CONFLICT (org_id, user_id, context_type) "
        "DO UPDATE SET messages=$4::jsonb, updated_at=NOW() "
        "RETURNING id",
        org_id, user["user_id"], context_type, json.dumps(messages),
    )
    return {"status": "saved", "id": str(row["id"])}


@router.delete("/ai-conversations/{context_type}")
async def delete_ai_conversation(
    context_type: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.ai_conversations "
        "WHERE org_id=$1::uuid AND user_id=$2::uuid AND context_type=$3",
        org_id, user["user_id"], context_type,
    )
    return {"status": "deleted"}


# ══════════════════════════════════════════════════════════════
# ORG-LEVEL SKILLS — Aekam assigns skills to orgs, orgs use them
# ══════════════════════════════════════════════════════════════

@router.get("/org/skills")
async def list_org_skills(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """List all skills assigned to this org."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT os.*, t.name as template_name, t.description as template_description, "
        "t.category, t.estimated_credits, t.icon, t.steps "
        "FROM staging.hub_org_skills os "
        "JOIN staging.hub_skill_templates t ON t.id = os.template_id "
        "WHERE os.org_id=$1::uuid AND os.is_active=TRUE "
        "ORDER BY t.category, t.name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/org/skills/{template_id}")
async def assign_skill_to_org(
    template_id: UUID,
    body: OrgSkillAssign,
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Aekam admin assigns a skill template to an org."""
    pool = await get_pool()

    tmpl = await pool.fetchrow(
        "SELECT id FROM staging.hub_skill_templates WHERE id=$1 AND is_active=TRUE",
        template_id,
    )
    if not tmpl:
        raise HTTPException(404, "Skill template not found")

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_org_skills "
        "(org_id, template_id, custom_config, assigned_by) "
        "VALUES ($1::uuid, $2, $3::jsonb, $4) "
        "ON CONFLICT (org_id, template_id) DO UPDATE SET "
        "custom_config=EXCLUDED.custom_config, is_active=TRUE, updated_at=NOW() "
        "RETURNING *",
        org_id, template_id, json.dumps(body.custom_config), user["user_id"],
    )
    return dict(row)


@router.delete("/org/skills/{skill_id}")
async def remove_skill_from_org(
    skill_id: UUID,
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Aekam admin removes a skill from an org."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.hub_org_skills SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1 AND org_id=$2::uuid",
        skill_id, org_id,
    )
    return {"status": "removed"}


@router.post("/org/skills/{skill_id}/run")
async def run_org_skill(
    skill_id: UUID,
    body: SkillRun,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Org user runs an assigned skill. Deducts from org credits + user allocation."""
    pool = await get_pool()

    os_row = await pool.fetchrow(
        "SELECT os.*, t.steps, t.name as template_name "
        "FROM staging.hub_org_skills os "
        "JOIN staging.hub_skill_templates t ON t.id = os.template_id "
        "WHERE os.id=$1 AND os.org_id=$2::uuid AND os.is_active=TRUE",
        skill_id, org_id,
    )
    if not os_row:
        raise HTTPException(404, "Org skill not found")

    steps = os_row["steps"] if isinstance(os_row["steps"], list) else json.loads(os_row["steps"])
    custom_config = os_row["custom_config"] if isinstance(os_row["custom_config"], dict) else json.loads(os_row["custom_config"] or "{}")

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE org_id=$1::uuid", org_id
    )
    if not brand:
        # Fallback to internal client brand
        brand = await pool.fetchrow(
            "SELECT bp.* FROM staging.hub_brand_profiles bp "
            "JOIN staging.hub_clients c ON c.id = bp.client_id "
            "WHERE c.org_id=$1::uuid AND c.is_internal=TRUE", org_id
        )
    system_prompt = _build_system_prompt(dict(brand)) if brand else ""

    variables = {**custom_config, **body.variables}

    run = await pool.fetchrow(
        "INSERT INTO staging.hub_org_skill_runs "
        "(org_skill_id, org_id, steps_total, triggered_by) "
        "VALUES ($1, $2::uuid, $3, $4) RETURNING *",
        skill_id, org_id, len(steps), user["user_id"],
    )
    run_id = run["id"]

    outputs = []
    content_ids = []
    total_credits = 0

    # Facts read by earlier steps, offered to later ones. This is what makes a
    # multi-step skill worth more than its steps: step 1 reads the overdue
    # invoices, step 2 writes the chasing email about THOSE invoices instead of
    # about receivables in the abstract.
    prior_facts: list[str] = []

    for step in sorted(steps, key=lambda s: s.get("order", 0)):
        # ── Data-first steps ────────────────────────────────────────────────
        # A step naming a `skill_function` reads the org's own records and never
        # calls a model, so it costs no AI credits. It was unreachable until the
        # registry and the calling convention were repaired — see
        # services/skill_dispatcher.py.
        if step.get("skill_function"):
            try:
                data = await _run_function_step(
                    pool, step, variables, org_id, user["user_id"]
                )
            except Exception as exc:
                # One unreadable source must not void a run the user has already
                # been charged for. The step is recorded as failed and the run
                # continues; the model is told the source was unavailable rather
                # than being left to assume it was empty.
                log.warning("Skill function step %s failed: %s", step.get("order"), exc)
                outputs.append({
                    "step": step.get("order"),
                    "skill_function": step["skill_function"],
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {exc}",
                })
                prior_facts.append(
                    f"## {step.get('label') or step['skill_function']}\n"
                    f"Unavailable ({type(exc).__name__}). Treat as unknown, not as empty."
                )
                continue

            outputs.append({
                "step": step.get("order"),
                "skill_function": step["skill_function"],
                "status": "ok",
                "credits_used": 0,
            })
            prior_facts.append(
                f"## {step.get('label') or step['skill_function']}\n"
                + json.dumps(data, default=str, ensure_ascii=False)[:4000]
            )
            await pool.execute(
                "UPDATE staging.hub_org_skill_runs SET steps_completed=$1 WHERE id=$2",
                len(outputs), run_id,
            )
            continue

        agent_type = step["agent_type"]
        prompt_template = step["prompt_template"]

        prompt = _fill_prompt(prompt_template, variables)

        # Grounding: this step's own requested sources, plus whatever earlier
        # function steps read. Both are omitted entirely when nothing asked for
        # them, so the six content templates already in the catalog behave
        # exactly as they did before.
        grounding = await context_for_step(pool, step, org_id, variables)
        if prior_facts:
            grounding = (grounding + "\n" if grounding else "") + "\n".join(prior_facts)
        if grounding:
            prompt = (
                f"{grounding}\n\n---\n\nUsing only the data above where it is "
                f"relevant, do the following.\n\n{prompt}"
            )

        try:
            await deduct_org_credits(org_id, user["user_id"], agent_type)
        except Exception:
            await pool.execute(
                "UPDATE staging.hub_org_skill_runs SET status='failed', "
                "error_message='Insufficient credits', completed_at=NOW(), "
                "steps_completed=$1, credits_used=$2, outputs=$3::jsonb, "
                "content_item_ids=$4 WHERE id=$5",
                len(outputs), total_credits, json.dumps(outputs), content_ids, run_id,
            )
            raise

        language = variables.get("language", "en")
        result = await generate(
            prompt=prompt,
            system=system_prompt,
            # `org_id=`, not `client_id=`. This passed the ORG uuid in the
            # CLIENT column, which names a `hub_clients` row — and an org route
            # has none behind it, so the value pointed at nothing while the
            # column that would have made the call attributable stayed NULL.
            org_id=org_id,
            max_tokens=4096 if agent_type in ("blog", "seo", "campaign") else 2048,
            language=language,
            agent_type=agent_type,
        )

        image_url = None
        if step.get("generate_image") or body.generate_images:
            img_prompt = _fill_prompt(step.get("image_prompt", prompt), variables)
            try:
                await deduct_org_credits(org_id, user["user_id"], "image")
                img_result = await generate_image(
                    prompt=img_prompt,
                    aspect_ratio=step.get("aspect_ratio", "1:1"),
                    org_id=org_id,
                )
                image_url = img_result["image_url"]
                total_credits += CREDIT_COSTS.get("image", 3)
            except Exception as e:
                log.warning("Image generation failed for step %s: %s", step.get("order"), e)
                # The deduction above is already committed. Without this the
                # step charged for an image it did not produce.
                await refund_org_credits(org_id, user["user_id"], "image",
                                         "Refund — skill step image failed")

        title = f"{os_row['template_name']} — Step {step.get('order', 0)}"
        credits_cost = CREDIT_COSTS.get(agent_type, 2)

        import re
        hashtags = re.findall(r'#\w+', result["text"]) if agent_type == "social_media" else []

        row = await pool.fetchrow(
            "INSERT INTO staging.hub_content_items "
            "(org_id, agent_type, title, body, platform, hashtags, "
            " image_url, status, credits_used, metadata, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'draft', $8, $9::jsonb, $10) "
            "RETURNING id",
            org_id, agent_type, title, result["text"],
            step.get("platform"), hashtags,
            image_url, credits_cost,
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
            "has_image": image_url is not None,
        })

        await pool.execute(
            "UPDATE staging.hub_org_skill_runs SET steps_completed=$1 WHERE id=$2",
            len(outputs), run_id,
        )

    await pool.execute(
        "UPDATE staging.hub_org_skill_runs SET status='completed', completed_at=NOW(), "
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


@router.get("/org/skills/{skill_id}/runs")
async def list_org_skill_runs(
    skill_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.hub_org_skill_runs "
        "WHERE org_skill_id=$1 AND org_id=$2::uuid ORDER BY started_at DESC LIMIT 20",
        skill_id, org_id,
    )
    return {"data": [dict(r) for r in rows]}


# ══════════════════════════════════════════════════════════════
# ORG CREDITS — Aekam → Org → User hierarchy
# ══════════════════════════════════════════════════════════════

@router.get("/org/credits")
async def get_org_credits(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Get org credit balance and recent transactions."""
    pool = await get_pool()

    org_row = await pool.fetchrow(
        "SELECT o.monthly_credits, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    plan_credits = (org_row["monthly_credits"] or org_row["default_credits"] or 0) if org_row else 0

    # The reset is otherwise LAZY — it lives inside `deduct_org_credits` and so
    # fires only when somebody spends. A wallet nobody has touched since the
    # month turned therefore reports last month's balance until the next run,
    # and the first run of the month is charged against it. Reading is the other
    # moment the answer has to be current.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _maybe_reset_monthly_credits(conn, org_id)

    wallet = await pool.fetchrow(
        "SELECT * FROM staging.hub_org_credits WHERE org_id=$1::uuid", org_id
    )
    if not wallet:
        wallet = await pool.fetchrow(
            "INSERT INTO staging.hub_org_credits (org_id, balance) VALUES ($1::uuid, $2) RETURNING *",
            org_id, plan_credits,
        )

    # Compute used credits this month
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_used = await pool.fetchval(
        "SELECT COALESCE(SUM(ABS(amount)), 0) FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid AND tx_type='debit' AND created_at >= $2",
        org_id, month_start,
    ) or 0

    recent_tx = await pool.fetch(
        "SELECT * FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid ORDER BY created_at DESC LIMIT 20",
        org_id,
    )

    user_alloc = await pool.fetchrow(
        "SELECT * FROM staging.hub_user_credits "
        "WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )

    return {
        "org_balance": {
            # The STORED balance, which is the one `deduct_org_credits` reads
            # under `FOR UPDATE` and refuses against.
            #
            # This used to answer `max(0, plan_credits - monthly_used)` — a
            # figure invented for the reply out of the month's debit rows, which
            # nothing enforces and which drifts from the column the moment a
            # balance carries anything older than this month. Measured on QA Test
            # Corp, 2026-07-29: stored 324, reported 744, and the ledger's own
            # latest `balance_after` 324. The org was being shown 420 credits it
            # would have been refused for spending, and the refusal names a third
            # number again ("have 324"), so nothing on screen agreed with it.
            **dict(wallet),
            "plan_credits": plan_credits,
            "used": monthly_used,
        },
        # `None`, not `{"allocated": 0, "used": 0}`. NO ROW and A ROW OF ZERO are
        # different facts and `deduct_org_credits` treats them differently: it
        # caps the user only `if user_wallet:`, so someone with no row spends
        # freely from the org pool while someone allocated zero is refused.
        #
        # Serving zero for both told every user without an allocation that their
        # balance was 0 — the Generate form printed "Balance 0 · this run spends
        # 1" and then ran the generation anyway, and the KPI strip advised
        # "ask an admin to raise it" when there was nothing to raise. Measured
        # 2026-07-29 as org_admin on QA Test Corp, which has no allocation row.
        "user_allocation": dict(user_alloc) if user_alloc else None,
        "recent_transactions": [dict(r) for r in recent_tx],
        "credit_costs": CREDIT_COSTS,
        # `price_per_credit_inr` was served here. Our rupee price is not a tenant
        # fact — the org needs its balance and what each action spends, not what
        # a credit costs us to sell. Owner's standing rule: no pricing figures on
        # any client-reachable surface. The platform console keeps its margin
        # view; that router is behind require_platform_role end to end.
    }


@router.post("/org/credits/topup")
async def topup_org_credits(
    body: OrgCreditTopup,
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Aekam tops up org credits."""
    pool = await get_pool()

    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    async with pool.acquire() as conn:
        async with conn.transaction():
            wallet = await conn.fetchrow(
                "SELECT balance FROM staging.hub_org_credits "
                "WHERE org_id=$1::uuid FOR UPDATE", org_id
            )
            if not wallet:
                await conn.execute(
                    "INSERT INTO staging.hub_org_credits (org_id, balance) "
                    "VALUES ($1::uuid, 0)", org_id
                )
                wallet = {"balance": 0}

            new_balance = wallet["balance"] + body.amount
            await conn.execute(
                "UPDATE staging.hub_org_credits SET balance=$1, updated_at=NOW() "
                "WHERE org_id=$2::uuid",
                new_balance, org_id,
            )
            await conn.execute(
                "INSERT INTO staging.hub_org_credit_transactions "
                "(org_id, user_id, amount, balance_after, tx_type, description, created_by) "
                "VALUES ($1::uuid, $2, $3, $4, 'topup', $5, $2)",
                org_id, user["user_id"], body.amount, new_balance,
                body.notes or "Aekam credit top-up",
            )

    return {"balance": new_balance}


@router.post("/org/credits/allocate/{target_user_id}")
async def allocate_user_credits(
    target_user_id: str,
    body: UserCreditAllocate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Org admin allocates credits to a user from org pool."""
    pool = await get_pool()

    # Verify caller is org_admin or org_owner
    is_admin = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code IN ('org_owner','org_admin')",
        user["user_id"], org_id,
    )
    if not is_admin:
        from middleware.roles import is_platform_staff
        if not await is_platform_staff(user["user_id"]):
            raise HTTPException(403, "Only org admins can allocate credits")

    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_user_credits (org_id, user_id, allocated) "
        "VALUES ($1::uuid, $2, $3) "
        "ON CONFLICT (org_id, user_id) DO UPDATE SET "
        "allocated = staging.hub_user_credits.allocated + EXCLUDED.allocated, "
        "updated_at=NOW() RETURNING *",
        org_id, target_user_id, body.amount,
    )
    return {"user_id": target_user_id, "allocated": row["allocated"], "used": row["used"]}


@router.get("/org/credits/users")
async def list_user_credits(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """List all user credit allocations for this org."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.hub_user_credits "
        "WHERE org_id=$1::uuid ORDER BY allocated DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


# ══════════════════════════════════════════════════════════════
# ORG CONTENT — generate content at org level
# ══════════════════════════════════════════════════════════════


@router.post("/org/generate")
async def generate_org_content(
    body: OrgContentGenerate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Generate content at org level using org credits."""
    pool = await get_pool()

    if body.agent_type not in AGENT_PROMPTS:
        raise HTTPException(400, f"Invalid agent type: {body.agent_type}")

    await deduct_org_credits(org_id, user["user_id"], body.agent_type)

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE org_id=$1::uuid", org_id
    )
    if not brand:
        brand = await pool.fetchrow(
            "SELECT bp.* FROM staging.hub_brand_profiles bp "
            "JOIN staging.hub_clients c ON c.id = bp.client_id "
            "WHERE c.org_id=$1::uuid AND c.is_internal=TRUE", org_id
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
        prompt=user_prompt, system=system_prompt,
        org_id=org_id,
        max_tokens=2048 if body.agent_type != "blog" else 4096,
        language=body.language, agent_type=body.agent_type,
    )

    # Image generation if requested
    image_url = None
    if body.generate_image:
        try:
            await deduct_org_credits(org_id, user["user_id"], "image")
            img_prompt = body.image_prompt or f"Professional social media graphic for: {body.brief}"
            img_result = await generate_image(
                prompt=img_prompt, aspect_ratio=body.aspect_ratio, org_id=org_id,
            )
            image_url = img_result["image_url"]
        except Exception as e:
            log.warning("Image generation failed: %s", e)
            await refund_org_credits(org_id, user["user_id"], "image",
                                     "Refund — image generation failed")

    title = body.brief[:100] if body.brief else f"{body.agent_type} content"
    import re
    hashtags = re.findall(r'#\w+', result["text"]) if body.agent_type == "social_media" else []

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_content_items "
        "(org_id, agent_type, title, body, platform, hashtags, image_url, "
        " status, credits_used, metadata, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'draft', $8, $9::jsonb, $10) RETURNING *",
        org_id, body.agent_type, title, result["text"],
        body.platform or None, hashtags, image_url,
        CREDIT_COSTS.get(body.agent_type, 2),
        json.dumps({"provider": result["provider"], "model": result["model"],
                     "language": body.language}),
        user["user_id"],
    )

    return {
        "content": dict(row),
        "ai": {"provider": result["provider"], "model": result["model"]},
    }


@router.get("/org/content")
async def list_org_content(
    status: Optional[str] = None,
    agent_type: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """List content generated at org level."""
    pool = await get_pool()
    query = ("SELECT *, COUNT(*) OVER() AS _total FROM staging.hub_content_items "
             "WHERE org_id=$1::uuid")
    params: list = [org_id]

    if status:
        params.append(status)
        query += f" AND status=${len(params)}"
    if agent_type:
        params.append(agent_type)
        query += f" AND agent_type=${len(params)}"

    query += " ORDER BY created_at DESC LIMIT 100"
    rows = await pool.fetch(query, *params)
    # Refreshes a signed URL per row, so it cannot hand `rows` straight to
    # `_listed` — same shape as `ganit.list_contracts`. `_total` is popped in
    # the same pass so it cannot ride out on an item the frontend maps over.
    total = int(dict(rows[0]).get("_total", len(rows))) if rows else 0
    data = [dict(r) for r in rows]
    from services.storage import refresh_signed_url
    for item in data:
        item.pop("_total", None)
        if item.get("image_url") and not item["image_url"].startswith("data:"):
            item["image_url"] = await refresh_signed_url(org_id, item["image_url"])
    return {"data": data, "total": total, "limit": 100, "truncated": total > 100}


@router.get("/org/brand")
async def get_org_brand(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Get org-level brand profile."""
    pool = await get_pool()
    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE org_id=$1::uuid", org_id
    )
    if not brand:
        brand = await pool.fetchrow(
            "SELECT bp.* FROM staging.hub_brand_profiles bp "
            "JOIN staging.hub_clients c ON c.id = bp.client_id "
            "WHERE c.org_id=$1::uuid AND c.is_internal=TRUE", org_id
        )
    return dict(brand) if brand else {}


@router.put("/org/brand")
async def update_org_brand(
    body: BrandProfileUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Update org-level brand profile. Creates one if it doesn't exist."""
    pool = await get_pool()

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    for k in ("social_handles",):
        if k in updates and isinstance(updates[k], dict):
            updates[k] = json.dumps(updates[k])
    for k in ("sample_posts",):
        if k in updates and isinstance(updates[k], list):
            updates[k] = json.dumps(updates[k])

    existing = await pool.fetchrow(
        "SELECT id FROM staging.hub_brand_profiles WHERE org_id=$1::uuid", org_id
    )
    if not existing:
        await pool.execute(
            "INSERT INTO staging.hub_brand_profiles (org_id) VALUES ($1::uuid)", org_id
        )

    set_clauses = ", ".join(f"{k}=${i+2}" for i, k in enumerate(updates))
    values = [org_id] + list(updates.values())
    await pool.execute(
        f"UPDATE staging.hub_brand_profiles SET {set_clauses}, updated_at=NOW() "
        f"WHERE org_id=$1::uuid",
        *values,
    )
    return {"status": "updated"}


# ── Quick Generate (standalone, no skill/client overhead) ──

QUICK_SKILL_PROMPTS = {
    "social_post": {
        "agent_type": "social_media",
        "system": (
            "You are an expert social media content creator for Indian businesses. "
            "Create engaging, professional content with proper formatting.\n\n"
            "IMPORTANT OUTPUT RULES:\n"
            "- Use markdown formatting: **bold** for emphasis, headers for sections\n"
            "- Include relevant emojis naturally\n"
            "- Include 5-8 relevant hashtags at the end\n"
            "- Keep the post concise but impactful\n"
            "- If the platform is Instagram, include a caption + hashtags\n"
            "- If LinkedIn, be more professional and longer\n"
            "- If WhatsApp, keep it short and conversational\n"
            "- Also generate a matching image that represents the post visually"
        ),
        "prompt": (
            "Create a {platform} post about: {topic}\n"
            "Tone: {tone}\n"
            "Language: {language}\n"
            "{extra}\n\n"
            "Generate the complete post text with formatting AND a matching professional image."
        ),
    },
    "email_campaign": {
        "agent_type": "email",
        "system": (
            "You are a marketing email specialist for Indian businesses. "
            "Create compelling email content with proper structure.\n\n"
            "OUTPUT FORMAT:\n"
            "## Subject Line\n"
            "## Preview Text\n"
            "## Email Body\n"
            "(with proper formatting, headers, bullet points)\n"
            "## Call to Action"
        ),
        "prompt": (
            "Create a marketing email about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "ad_copy": {
        "agent_type": "ad_copy",
        "system": (
            "You are an advertising copywriter for Indian market. "
            "Create high-converting ad copy.\n\n"
            "OUTPUT FORMAT:\n"
            "## Headline Options (3 variants)\n"
            "## Primary Text\n"
            "## Description\n"
            "## Call to Action Options\n"
            "Also generate a matching ad creative image."
        ),
        "prompt": (
            "Create {platform} ad copy about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}\n\n"
            "Generate the complete ad copy AND a matching professional ad creative image."
        ),
    },
    "blog_post": {
        "agent_type": "blog",
        "system": (
            "You are a content writer for Indian businesses. "
            "Create SEO-friendly blog content with proper structure.\n\n"
            "OUTPUT FORMAT:\n"
            "# Title\n"
            "## Introduction\n"
            "## Body (with H2/H3 subheadings, bullet points, bold key terms)\n"
            "## Conclusion\n"
            "## Meta Description (under 155 chars)\n"
            "## Keywords"
        ),
        "prompt": (
            "Write a blog post about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "whatsapp_broadcast": {
        "agent_type": "whatsapp",
        "system": (
            "You are a WhatsApp marketing specialist for Indian businesses. "
            "Create short, engaging broadcast messages.\n\n"
            "RULES:\n"
            "- Under 1000 characters\n"
            "- Use emojis naturally\n"
            "- Include a clear CTA\n"
            "- Friendly, conversational tone\n"
            "- No hashtags (not a WhatsApp thing)"
        ),
        "prompt": (
            "Create a WhatsApp broadcast message about: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "proposal": {
        "agent_type": "lead_magnet",
        "system": (
            "You are a business proposal writer for Indian companies. "
            "Create professional, structured proposals.\n\n"
            "OUTPUT FORMAT:\n"
            "# Proposal: [Title]\n"
            "## Executive Summary\n"
            "## Scope of Work\n"
            "## Deliverables\n"
            "## Timeline\n"
            "## Investment / Pricing\n"
            "## Terms & Conditions\n"
            "## Next Steps"
        ),
        "prompt": (
            "Write a business proposal for: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}"
        ),
    },
    "festival_campaign": {
        "agent_type": "campaign",
        "system": (
            "You are an Indian festival marketing expert. "
            "Create culturally appropriate, engaging festival campaigns.\n\n"
            "OUTPUT FORMAT:\n"
            "# Campaign: [Festival Name] 🎉\n"
            "## Campaign Theme\n"
            "## Key Messages (3-5)\n"
            "## Social Media Posts (Instagram + WhatsApp)\n"
            "## Email Template\n"
            "## Offer/Discount Structure\n"
            "## Timeline (1-2 weeks)\n\n"
            "Also generate a festive, vibrant image that matches the campaign."
        ),
        "prompt": (
            "Create a festival marketing campaign for: {topic}\n"
            "Tone: {tone}\nLanguage: {language}\n{extra}\n\n"
            "Generate the complete campaign plan AND a matching festive campaign image."
        ),
    },
}


@router.post("/org/quick-generate")
async def quick_generate(
    body: QuickGenerate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Quick content generation — standalone, no client/skill setup needed.
    Supports text-only and text+image output."""
    skill_cfg = QUICK_SKILL_PROMPTS.get(body.skill)
    if not skill_cfg:
        raise HTTPException(400, f"Unknown skill: {body.skill}. Available: {', '.join(QUICK_SKILL_PROMPTS)}")

    pool = await get_pool()

    # ONE figure for the price of a run.
    #
    # `QUICK_SKILL_PROMPTS[...]["credits"]` was a second, decorative one: the
    # wallet is debited by AGENT TYPE through `CREDIT_COSTS`, and the skill
    # config's own number went into the reply and into
    # `hub_content_items.credits_used`. Four of the seven disagreed —
    #
    #   social_post       reported 3, charged 2
    #   email_campaign    reported 3, charged 2
    #   proposal          reported 5, charged 8
    #   festival_campaign reported 5, charged 10
    #
    # — so a festival campaign took ten credits and told the reader it took
    # five, on the same screen whose card had just said ten. Measured against
    # the ledger 2026-07-29: a social post debits −2 under a footer reading
    # "3 credits used".
    charged = CREDIT_COSTS.get(skill_cfg["agent_type"], 2)
    try:
        await deduct_org_credits(org_id, user["user_id"], skill_cfg["agent_type"],
                                  f"Quick generate: {body.skill}")
    except Exception:
        raise HTTPException(402, "Insufficient credits")

    # Build prompt from template
    prompt = skill_cfg["prompt"].format(
        topic=body.topic,
        platform=body.platform,
        tone=body.tone,
        language=body.language,
        extra=body.extra,
    )

    # Load brand profile for context
    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE org_id=$1::uuid", org_id
    )
    brand_system = _build_system_prompt(dict(brand)) if brand else ""
    system = f"{brand_system}\n\n{skill_cfg['system']}" if brand_system else skill_cfg["system"]

    # Generate text first (always reliable)
    text_result = await generate(
        prompt=prompt,
        system=system,
        max_tokens=4096,
        language=body.language,
        agent_type=skill_cfg["agent_type"],
        org_id=org_id,
    )
    result = {**text_result, "images": []}

    # Generate image separately using Seedream (reliable, cheap)
    image_skills = ("social_post", "ad_copy", "festival_campaign", "email_campaign", "blog_post")
    if body.with_image and body.skill in image_skills:
        try:
            img_prompts = {
                "social_post": "Engaging social media visual for: {t}. Modern, scroll-stopping, brand-quality image.",
                "ad_copy": "High-converting advertisement creative for: {t}. Bold, eye-catching, professional product/service visual.",
                "festival_campaign": "Vibrant festive Indian celebration image for: {t}. Colorful, culturally rich, celebratory mood.",
                "email_campaign": "Professional email banner image for: {t}. Clean, modern, corporate marketing header visual.",
                "blog_post": "Blog featured image for: {t}. Professional, editorial-quality, topic-relevant photograph or illustration.",
            }
            img_prompt = img_prompts.get(body.skill, "Professional marketing visual for: {t}. Clean, modern, corporate Indian business aesthetic.").format(t=body.topic[:200])
            # Charged, as it already is on the two OTHER routes that make an
            # image — `/org/generate` and the org skill runner both deduct
            # `"image"` before calling `generate_image`. This one did not, and it
            # is the route the Generate tab uses, so the image was free on the
            # only path anybody clicks.
            #
            # Measured over 54 runs, 2026-07-30: the image is $0.0352 a call and
            # 85% of the entire AI bill, against $0.0027 for the text beside it.
            # Five paired runs — same brief, image on and off — were charged
            # identically, so a social post cost 14× more to serve and exactly
            # the same to buy. `CREDIT_COSTS["image"]` was already 3. Nothing
            # here is a new price, only the missing half of an existing one.
            #
            # Before the call, and refunded below if it does not produce one.
            await deduct_org_credits(org_id, user["user_id"], "image",
                                     f"Quick generate image: {body.skill}")
            charged += CREDIT_COSTS.get("image", 3)
            img_result = await generate_image(prompt=img_prompt, org_id=org_id)
            result["images"] = [{"url": img_result["image_url"], "mime": "image/png"}]
        except Exception as e:
            log.warning("Image generation failed for %s: %s", body.skill, e)
            # Charging first is what stops concurrent runs raiding a wallet, so
            # the order stays and the refund is the missing half. Image
            # generation genuinely fails here — HuggingFace has answered
            # `410 Gone` on every call since its serverless route for FLUX.1-dev
            # was retired, and the chain survives only because OpenRouter is
            # behind it.
            #
            # `charged` is walked back too, so the reply and
            # `hub_content_items.credits_used` report what the run actually cost
            # rather than what it attempted.
            if charged > CREDIT_COSTS.get(skill_cfg["agent_type"], 2):
                await refund_org_credits(org_id, user["user_id"], "image",
                                         f"Refund — image failed: {body.skill}")
                charged -= CREDIT_COSTS.get("image", 3)

    # Save to content items
    content_row = await pool.fetchrow(
        "INSERT INTO staging.hub_content_items "
        "(org_id, agent_type, title, body, platform, status, credits_used, "
        " metadata, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, 'draft', $6, $7::jsonb, $8) RETURNING id",
        org_id, skill_cfg["agent_type"],
        f"{body.skill}: {body.topic[:60]}",
        result["text"],
        body.platform,
        charged,
        json.dumps({
            "skill": body.skill, "images": result.get("images", []),
            "provider": result.get("provider"), "model": result.get("model"),
        }),
        user["user_id"],
    )

    return {
        "content_id": str(content_row["id"]),
        "text": result["text"],
        "images": result.get("images", []),
        "skill": body.skill,
        "credits_used": charged,
        "provider": result.get("provider"),
        "model": result.get("model"),
    }
