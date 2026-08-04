"""
hub.py — Srijan (सृजन) Router
Org-level content generation, skill packs, credit management, brand profiles.
All endpoints gated by require_module("srijan").
"""
import json
import logging
import uuid as _uuid
from datetime import datetime, time, timezone
from typing import Optional
from uuid import UUID

log = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_platform_role
from middleware.role_tiers import (
    OPERATIONS_CONSOLE_ROLES, ORG_MANAGEMENT_ROLES, SRIJAN_COMMERCIAL_ROLES,
)
from middleware.subscription import require_module
from services.ai_router import (
    generate, generate_image, generate_rich_content, deduct_credits,
)
# Every org credit in this file moves through `services/credits.py` and nowhere
# else. It used to move through `deduct_org_credits` / `refund_org_credits` /
# `_maybe_reset_monthly_credits`, which opened their OWN pool connection and
# committed on their own — so when `generate()` raised afterwards the debit was
# already committed in a different transaction and nothing put it back. Six of
# the eleven org-wallet sites in this file were non-refundable for that one
# reason, and the three that did refund could only refund an agent_type's LIST
# PRICE, never what was actually charged.
#
# `CREDIT_COSTS` is gone from here too. It was read at five sites to decide what
# to print and what to write into `hub_content_items.credits_used`, one table
# lookup away from the number actually taken; §3 of the 095 spec makes
# `credits.price_of` the only thing in the product allowed to name a price.
from services import credits
from services.credits import CreditError
from services.skills.prompt import fill_prompt
from services.skills.context import (
    context_for_step, assert_step_access, SkillAccessDenied,
    SOURCES as CONTEXT_SOURCES,
)
from services.skill_dispatcher import (
    _run_function_step, SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS,
    UNIMPLEMENTED_SKILL_FUNCTIONS, RUNTIME_FORBIDDEN_PARAMS, describe_skill_functions,
)

router = APIRouter(prefix="/api/v1/hub", tags=["hub"])

_hub_gate = require_module("srijan")

#: skill_function -> can its handler be scoped to one organisation. Built once
#: from the same introspection the capabilities endpoint serves, so the editor's
#: picker, the create validator and the run guard cannot disagree about which
#: functions are usable.
#: Built once from the same introspection the capabilities endpoint serves, so
#: the editor's picker, the create validator and the run guard cannot disagree
#: about which functions are usable or which parameters may be asked for.
_CAPABILITIES = describe_skill_functions()
_SCOPABLE: dict[str, bool] = {f["name"]: f["available"] for f in _CAPABILITIES}
_RUNTIME_ELIGIBLE: dict[str, list] = {
    f["name"]: f.get("runtime_eligible", []) for f in _CAPABILITIES
}


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
    #: The member's CEILING on the shared org balance for this period, absolute.
    #: `None` clears it (uncapped); `0` refuses that member everything. The two
    #: are different states and both are reachable on purpose — see
    #: `allocate_user_credits`.
    amount: Optional[int] = None

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


async def sign_content_images(org_id: str, items: list[dict]) -> list[dict]:
    """Re-sign every generated image on its way out. Mutates and returns `items`.

    `hub_content_items.image_url` holds a PRESIGNED R2 link with a nine-hour
    expiry (`storage.upload_file`, ExpiresIn=32400), so it is dead by the next
    morning and the card renders a broken image. Only the org-level list ever
    re-signed; `/clients/{id}/content` and the single-item read returned the
    stored string untouched, which is the difference between a content library
    and a wall of expired links.

    One helper for all three, because the bug was not that re-signing is hard —
    it was that it lived at one call site and the others were written without
    it. Signing from `image_key` where it exists and falling back to parsing the
    key out of the old URL keeps the six pre-existing images working.
    """
    from services.storage import refresh_signed_url, sign_key

    for item in items:
        url = item.get("image_url")
        if not url or str(url).startswith("data:"):
            continue
        key = item.get("image_key")
        item["image_url"] = (await sign_key(org_id, key) if key else None) \
            or await refresh_signed_url(org_id, url)
    return items


async def _verify_client_access(pool, client_id: str, org_id: str) -> dict:
    """Verify the client belongs to this org. Returns the client row."""
    client = await pool.fetchrow(
        "SELECT * FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        client_id, org_id,
    )
    if not client:
        raise HTTPException(404, "Client not found")
    return client


# ── Credit plumbing shared by every Srijan spend ─────────────

#: The kinds whose price gets PRINTED beside a button. Not a price list — the
#: prices live in the credits service's own table and are read one at a time
#: below. No name of a credit table appears anywhere in this file, deliberately:
#: `tests/test_credits_isolation.py` enforces that, and it is what stops a sixth
#: debit implementation being written here next quarter.
_PRICED_AGENT_TYPES: tuple[str, ...] = tuple(AGENT_PROMPTS) + ("image",)


async def _display_credit_costs(conn) -> dict[str, int]:
    """`agent_type -> credits`, for the labels three screens print by a button.

    Resolved through `credits.price_of` rather than from a dict in this file.
    The dict is how the Generate tab came to quote five credits for a festival
    campaign that charged ten: two copies of one price list, and only one of
    them was the one the wallet used.

    A kind with no price row is OMITTED here rather than defaulted or fatal,
    and that is the single place this file is deliberately softer than a
    charge. `price_of` raises `UnknownPrice` when asked what to BILL — on
    purpose, so a channel nobody priced fails loudly instead of quietly costing
    2 forever. Asked what to LABEL, the honest answer for an unpriced kind is
    to say nothing; 500ing three read-only screens over a missing catalogue row
    would be worse than a missing caption.
    """
    out: dict[str, int] = {}
    for agent_type in _PRICED_AGENT_TYPES:
        try:
            out[agent_type] = await credits.price_of(conn, "content", agent_type)
        except CreditError:
            continue
    return out


async def _current_balance(pool, org_id: str):
    """The org's balance, advanced to this month first.

    The roll is otherwise LAZY — it happens inside a spend — so a wallet nobody
    has touched since the month turned reports LAST month's allowance until the
    next run, and the balance visibly jumps the moment somebody generates
    anything. Reading is the other moment the answer has to be current, which
    is why the old `_maybe_reset_monthly_credits` was called here too.

    `roll_period` takes the row lock itself and is idempotent on `period_start`,
    so this is one extra SELECT on every day but the first of the month. It also
    carries the member ceilings forward, which is what makes the allocation
    screen correct on the 1st rather than empty.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await credits.roll_period(conn, org_id)


def _work_key(org_id: str, supplied: Optional[str]) -> str:
    """The idempotency key for one generation request.

    A key names the UNIT OF WORK, not the attempt — otherwise a retry of a
    request that timed out on the way back charges the customer twice, which
    every path in this file did.

    A generation has no natural id before it runs: the content row is written
    afterwards, so there is nothing durable to key on. The client therefore has
    to say. When it does not send `Idempotency-Key` we mint one, and that
    genuinely is NOT idempotent — two identical submissions are charged twice.
    That is the correct default for this route: without a key from the caller
    there is no way to tell a retry from someone deliberately generating a
    second draft of the same brief, and refusing to charge for the second would
    be the worse error.

    KNOWN LIMIT, stated so it is a debt and not a discovery: when a caller DOES
    send a key and retries, the credit layer correctly charges once
    (`Receipt.replayed` is True and nothing is written), but the retry still
    generates and still writes a second `hub_content_items` row. The money is
    right; the library gains a duplicate draft. Making the content row itself
    idempotent means creating it before the generation and keying on its id,
    which is a larger change than 095 asked for.
    """
    return f"gen:{org_id}:{supplied or _uuid.uuid4()}"


def _denial_text(exc: CreditError) -> str:
    """The sentence out of a refusal, for a column a human will read.

    A `CreditError`'s `detail` carries the structured fields the frontend needs
    — needed, member_remaining, org_allowance, org_purchased — so that no
    screen has to parse English. A run row's `error_message` is the opposite
    problem: it is read by a person, and `str({'code': ...})` is not a sentence.
    """
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("detail") or detail)
    return str(detail or exc)


async def _assert_org_credit_admin(pool, user_id: str, org_id: str) -> None:
    """Only an org owner/admin — or Aekam staff — may see or set the ceilings
    of the whole organisation.

    `GET /org/credits/users` was `require_user`, so any member could read every
    colleague's allocation and spend. A member reads their own through
    `GET /org/credits`, which is the same fact about themselves and none about
    anyone else.

    The role literal comes from `ORG_MANAGEMENT_ROLES` rather than being typed
    out again; this file held the fourth copy of that pair.
    """
    is_admin = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
        user_id, org_id, list(ORG_MANAGEMENT_ROLES),
    )
    if is_admin:
        return
    from middleware.roles import is_platform_staff
    if not await is_platform_staff(user_id):
        raise HTTPException(403, "Only org admins can see or set member credit limits")


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

    # Charged through `spend_standalone`, like the four other generation sites
    # in this file, rather than through the `deduct_credits` shim.
    #
    # The shim used to spend `hub_credit_wallets` — a per-client pot nothing
    # else could see — so the missing refund below cost nobody anything. 095
    # repointed it at the org wallet, which turned a dormant path into a real
    # loss: a provider outage took five credits and returned an error. Two of
    # the three providers 400 on every request (see ai_router's own note), so
    # that is not a rare branch.
    #
    # A receipt, not a balance: the refund has to name the TRANSACTION it
    # reverses. An amount cannot know whether a second debit happened, and the
    # database enforces refund-once on the id.
    receipt = await credits.spend_standalone(
        org_id=org_id,
        user_id=user["user_id"],
        kind="content",
        ref_id=body.agent_type,
        description=f"{body.agent_type} generation",
    )
    charged = receipt.credits
    new_balance = receipt.balance_after

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

    # The charge is above the generation and the refund is here, in that order,
    # deliberately: charging afterwards lets two concurrent requests each spend
    # the balance the other is about to take. So the debit comes first and this
    # is its other half. Without it a provider outage keeps the money and hands
    # back an error.
    try:
        result = await generate(
            prompt=user_prompt,
            system=system_prompt,
            client_id=cid,
            org_id=org_id,
            max_tokens=2048 if body.agent_type != "blog" else 4096,
            language=body.language,
            agent_type=body.agent_type,
        )
    except Exception:
        await credits.refund_standalone(
            tx_id=receipt.tx_id,
            reason=f"Refund — {body.agent_type} generation failed",
            user_id=user["user_id"],
        )
        raise

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
        body.platform or None, hashtags, charged,
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
    return {"data": await sign_content_images(org_id, [dict(r) for r in rows])}


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
    return (await sign_content_images(org_id, [dict(row)]))[0]


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
        "credit_costs": await _display_credit_costs(pool),
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
    # The org's own spendable balance, not the sum of the per-client wallets.
    # That sum was a number nothing could spend: no debit path in the product
    # reads `hub_credit_wallets`, so this tile could read 5,300 while every
    # generation on the page was refused for an empty org balance.
    org_balance = await _current_balance(pool, org_id)
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
            "total_credits": org_balance.total,
            "allowance_credits": org_balance.allowance,
            "purchased_credits": org_balance.purchased,
            "total_content": content_count or 0,
            "pending_review": pending_review or 0,
        },
        "recent_content": [dict(r) for r in recent_content],
        "credit_costs": await _display_credit_costs(pool),
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
            # Refused at authoring time as well as at run time. A handler that
            # cannot be scoped to one organisation is refused by
            # `_run_function_step`, so accepting it here would store a template
            # that saves cleanly and can never run — and the failure would
            # surface in front of whoever pressed Run rather than whoever chose
            # the step.
            if not _SCOPABLE.get(fn, True):
                raise HTTPException(
                    400,
                    f"Step {i+1}: '{fn}' cannot be scoped to one organisation — "
                    f"its handler does not take org_id — so it is unavailable.",
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
            # Runtime parameters are an allowlist the AUTHOR opens. Checked here
            # as well as at run time, because a name the dispatcher would strip
            # should be refused while somebody is looking at it rather than
            # silently ignored on a run months later.
            eligible = _RUNTIME_ELIGIBLE.get(fn, [])
            for param in (step.get("runtime_params") or []):
                if param in RUNTIME_FORBIDDEN_PARAMS:
                    raise HTTPException(
                        400,
                        f"Step {i+1}: '{param}' can never be set by the person "
                        f"running a skill. It selects which data is read, not "
                        f"which record — that is the template author's decision.",
                    )
                if param not in eligible:
                    raise HTTPException(
                        400,
                        f"Step {i+1}: '{fn}' has no parameter '{param}'. "
                        f"It accepts: {', '.join(eligible) or 'none'}.",
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
    # Data steps call no model, so they cost nothing. Counting them at the old
    # `CREDIT_COSTS.get(..., 2)` fallback would have quoted a price for work
    # that is free.
    #
    # `estimated_credits` is an ESTIMATE and prices nothing — it is the "this
    # will cost about N" figure on the catalog card, never what is charged. The
    # charge is the sum of the steps at run time, resolved by
    # `credits.price_of`, so a template edited after this number was written
    # bills the new steps and not this stale total.
    #
    # An unpriced step is SKIPPED rather than refusing the template. Every
    # `agent_type` here has already been validated against `AGENT_PROMPTS`
    # above, so a missing price row is a gap in the catalogue, not a mistake by
    # the author — and making the author's Save fail for it punishes the one
    # person who cannot fix it.
    estimated = body.estimated_credits
    if not estimated:
        estimated = 0
        for s in steps_with_order:
            if s.get("skill_function"):
                continue
            try:
                estimated += await credits.price_of(pool, "skill_step", s.get("agent_type"))
            except CreditError:
                log.warning("No credit price for skill step agent_type %r — "
                            "omitted from the template estimate", s.get("agent_type"))

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

    # Every module this skill's data touches, checked BEFORE the run row is
    # written and long before any credit is deducted. The whole skill path is
    # gated on `require_module("srijan")`, and the handlers behind it read
    # ganit, manav and vetana tables — so without this, Srijan is a way around
    # SENSITIVE_MODULES.
    try:
        await assert_step_access(steps, user["user_id"], org_id)
    except SkillAccessDenied as denied:
        raise HTTPException(403, str(denied))

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

    # Enumerated for the idempotency key below. `step["order"]` is not usable
    # for that: it is author-supplied and two steps may share a number, which
    # would make one step's retry replay the other's charge. The position in the
    # sorted sequence is unique and stable for a given run.
    for step_no, step in enumerate(sorted(steps, key=lambda s: s.get("order", 0)), start=1):
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

        # Resolved before the charge, from the one price list, so the figure
        # written to `hub_content_items.credits_used` below is the figure the
        # wallet moved by and not a second lookup that can drift from it.
        credits_cost = await credits.price_of(pool, "skill_step", agent_type)

        # `spend_standalone`, not the `deduct_credits` shim — for the refund
        # below, and to fix an attribution bug the shim caused here: it
        # hardcodes `kind="content"` while the price two lines up was resolved
        # as `skill_step`. The money was identical, so nothing broke; but a
        # skill's step landed in the ledger indistinguishable from a one-off
        # generation, and the per-source billing tabs group on `kind`.
        try:
            receipt = await credits.spend_standalone(
                org_id=org_id,
                user_id=user["user_id"],
                kind="skill_step",
                ref_id=agent_type,
                idempotency_key=f"clientskillrun:{run_id}:step:{step_no}",
                description=f"client skill — {agent_type}",
            )
            new_balance = receipt.balance_after
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

        # Refunded by transaction id if the provider chain is exhausted — the
        # same shape as the org-skill path above. The charge has to precede the
        # generation so concurrent runs cannot both spend the same balance, and
        # this is the other half of that trade.
        try:
            result = await generate(
                prompt=prompt,
                system=system_prompt,
                client_id=cid,
                org_id=org_id,
                max_tokens=4096 if agent_type in ("blog", "seo", "campaign") else 2048,
                language=language,
                agent_type=agent_type,
            )
        except Exception:
            await credits.refund_standalone(
                tx_id=receipt.tx_id,
                reason=f"Refund — client skill step {step.get('order', step_no)} "
                       f"did not generate",
                user_id=user["user_id"],
            )
            raise

        title = f"{cs['template_name']} — Step {step.get('order', 0)}"

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

    # See `run_skill` — refused before the run row and before any deduction.
    try:
        await assert_step_access(steps, user["user_id"], org_id)
    except SkillAccessDenied as denied:
        raise HTTPException(403, str(denied))

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

    async def _fail_run(message: str) -> None:
        """Close the run row out honestly and stop.

        The message used to be the literal 'Insufficient credits' for EVERY
        exception, so a database outage told the customer their wallet was
        empty. `credits.spend` refuses with a sentence that says what is needed
        and what is held; anything else is a fault and must read as one.
        """
        await pool.execute(
            "UPDATE staging.hub_org_skill_runs SET status='failed', "
            "error_message=$1, completed_at=NOW(), "
            "steps_completed=$2, credits_used=$3, outputs=$4::jsonb, "
            "content_item_ids=$5 WHERE id=$6",
            message[:500], len(outputs), total_credits,
            json.dumps(outputs), content_ids, run_id,
        )

    # The idempotency key for a step is `skillrun:{run_id}:step:{step_no}`,
    # where `step_no` is the step's POSITION IN THE EXECUTED SEQUENCE and not
    # its authored `order`. `order` is author-supplied, defaults to 0 and is not
    # unique — two steps sharing one would collide on the key, and a collision
    # in an idempotency key does not double-charge, it makes the second step
    # FREE and hands back the first step's receipt. Position cannot repeat.
    for step_no, step in enumerate(sorted(steps, key=lambda s: s.get("order", 0)), start=1):
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
            receipt = await credits.spend_standalone(
                org_id=org_id,
                user_id=user["user_id"],
                kind="skill_step",
                ref_id=agent_type,
                idempotency_key=f"skillrun:{run_id}:step:{step_no}",
                description=f"{os_row['template_name']} — step {step.get('order', step_no)}",
            )
        except CreditError as denial:
            await _fail_run(_denial_text(denial))
            raise
        except Exception as exc:
            await _fail_run(f"{type(exc).__name__}: {exc}")
            raise

        language = variables.get("language", "en")
        try:
            result = await generate(
                prompt=prompt,
                system=system_prompt,
                # `org_id=`, not `client_id=`. This passed the ORG uuid in the
                # CLIENT column, which names a `hub_clients` row — and an org
                # route has none behind it, so the value pointed at nothing while
                # the column that would have made the call attributable stayed
                # NULL.
                org_id=org_id,
                max_tokens=4096 if agent_type in ("blog", "seo", "campaign") else 2048,
                language=language,
                agent_type=agent_type,
            )
        except Exception as exc:
            # Charging first is what stops concurrent runs raiding a wallet, so
            # the order stays and the refund is the missing half. Before 095 the
            # debit was committed in `deduct_org_credits`'s own connection and
            # this raise simply kept the money.
            #
            # By TRANSACTION ID, not by agent_type. The old refund took an
            # agent_type and could therefore only return that type's list
            # price — never what was actually charged, and never the right one
            # of two charges when a step bought both text and a picture.
            # `refund_standalone` returns None rather than raising: this is
            # already an except block, and a refund that throws replaces lost
            # credits with a 500 on top of the failure that lost them.
            #
            # THAT NAME IS NOW ONLY IN THIS COMMENT, and one test depends on it
            # being somewhere: `tests/test_skill_module_access.py`'s
            # `test_the_check_runs_before_any_credit_is_deducted` locates the
            # charge by searching this function's source for
            # "deduct_org_credits". It therefore currently passes by matching a
            # sentence rather than a call, which is a check that has stopped
            # checking. Repoint it at "credits.spend_standalone" — the real
            # charge, several lines above this — and this note can go.
            await credits.refund_standalone(
                tx_id=receipt.tx_id,
                reason=f"Refund — skill step {step.get('order', step_no)} did not generate",
                user_id=user["user_id"],
            )
            await _fail_run(f"{type(exc).__name__}: {exc}")
            raise

        image_url, image_key = None, ""
        img_receipt = None
        if step.get("generate_image") or body.generate_images:
            img_prompt = _fill_prompt(step.get("image_prompt", prompt), variables)
            try:
                img_receipt = await credits.spend_standalone(
                    org_id=org_id,
                    user_id=user["user_id"],
                    kind="content",
                    ref_id="image",
                    idempotency_key=f"skillrun:{run_id}:step:{step_no}:image",
                    description=f"{os_row['template_name']} — step "
                                f"{step.get('order', step_no)} image",
                )
                img_result = await generate_image(
                    prompt=img_prompt,
                    aspect_ratio=step.get("aspect_ratio", "1:1"),
                    org_id=org_id,
                )
                image_url = img_result["image_url"]
                image_key = img_result.get("image_key") or ""
                total_credits += img_receipt.credits
            except Exception as e:
                log.warning("Image generation failed for step %s: %s", step.get("order"), e)
                # Exactly what the image took, and nothing else. The text above
                # succeeded and stays paid for — this is the partial-success
                # case the old code got wrong in both directions: it refunded
                # `CREDIT_COSTS["image"]` whatever had actually been charged,
                # and it refunded that even when the failure was the DEDUCTION
                # itself, in which case nothing had been taken to give back.
                #
                # `img_receipt is None` means the spend is what raised — a
                # member at their ceiling, or an empty wallet. There is nothing
                # to return, the step keeps the text it has already paid for,
                # and the run carries on. A ceiling reached on the picture is
                # not a reason to void the paragraph.
                if img_receipt is not None:
                    await credits.refund_standalone(
                        tx_id=img_receipt.tx_id,
                        reason="Refund — skill step image failed",
                        user_id=user["user_id"],
                    )

        title = f"{os_row['template_name']} — Step {step.get('order', 0)}"
        # What was ACTUALLY charged, from the receipt — not a second price
        # lookup. Aekam's burn-rate reads `hub_content_items.credits_used` and
        # the client's report reads the ledger; when the two are resolved
        # independently they disagree, and that disagreement is the reason
        # nobody could reconcile a month.
        credits_cost = receipt.credits

        import re
        hashtags = re.findall(r'#\w+', result["text"]) if agent_type == "social_media" else []

        row = await pool.fetchrow(
            "INSERT INTO staging.hub_content_items "
            "(org_id, agent_type, title, body, platform, hashtags, "
            " image_url, image_key, status, credits_used, metadata, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10::jsonb, $11) "
            "RETURNING id",
            org_id, agent_type, title, result["text"],
            step.get("platform"), hashtags,
            image_url, image_key, credits_cost,
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
    """The org's balance in both buckets, the caller's own ceiling, the ledger.

    Readable by any member, and deliberately says NOTHING about any other
    member — the whole-org allocation view is `GET /org/credits/users`, which is
    gated. A member needs their own ceiling to understand a refusal; they do not
    need their colleagues'.
    """
    pool = await get_pool()

    # Rolls the period first, then reads. The wallet row is created if it is
    # missing, which is what the lazy INSERT here used to do — except that one
    # sat behind `require_module("srijan")` and seeded the row with the plan's
    # credit figure, minting credits nobody had granted.
    bal = await _current_balance(pool, org_id)
    cap = await credits.member_cap_of(pool, org_id, user["user_id"])

    period_start = datetime.combine(bal.period_start, time.min, tzinfo=timezone.utc)
    summary = await credits.usage_summary(pool, org_id, since=period_start)
    recent_tx = await credits.ledger(pool, org_id, limit=20)

    return {
        "org_balance": {
            # `balance` stays the key it has always been and stays the STORED
            # total, because two screens read it by that name and because it is
            # the figure a spend is refused against. `allowance` and `purchased`
            # are the two things it is made of: the monthly grant, which is
            # forfeited at the roll, and the credits the org paid for, which are
            # not. Before 095 the roll did `SET balance = $1` and destroyed the
            # second along with the first while the ledger called it a reset.
            "balance": bal.total,
            "allowance": bal.allowance,
            "purchased": bal.purchased,
            "total": bal.total,
            "period_start": bal.period_start,
            "is_platform_org": bal.is_platform_org,
            # `organisations.monthly_credits`, off the Balance, and nothing
            # else. The plan join that used to compute this
            # (`monthly_credits or default_credits or 0`) was the read side of
            # the bug 095 closes: `if not org_credits` treats a deliberately
            # negotiated 0 as absent, so an org Aekam had agreed to give nothing
            # was shown — and handed — the plan default every month. The grant
            # now has one source, and this screen must print that source or it
            # is describing a different refill from the one that will happen.
            "plan_credits": bal.monthly_credits,
            # NET of refunds, not gross. `SUM(ABS(amount)) WHERE tx_type='debit'`
            # counted every refunded image and every failed run as spend, so the
            # figure on this strip was always larger than the month had cost.
            "used": summary["net_debits"],
            "used_gross": summary["gross_debits"],
            "refunded": summary["refunds"],
        },
        # `None` when the member is UNCAPPED, which is not the same as a cap of
        # zero and never has been: no ceiling means spend freely from the org
        # pool, a ceiling of zero means refused. Serving `{allocated: 0}` for
        # both told every uncapped user their balance was 0 — the Generate form
        # printed "Balance 0 · this run spends 1" and then ran anyway, and the
        # KPI strip advised "ask an admin to raise it" when there was nothing to
        # raise.
        #
        # `allocated`/`used` are kept as the key names two screens already read.
        # `cap`/`spent`/`remaining` are the names the model actually uses; both
        # are served so the frontend can move at its own pace.
        "user_allocation": None if cap.cap is None else {
            "user_id": cap.user_id,
            "allocated": cap.cap,
            "used": cap.spent,
            "cap": cap.cap,
            "spent": cap.spent,
            "remaining": cap.remaining,
            "period_start": cap.period_start,
        },
        "recent_transactions": recent_tx,
        "credit_costs": await _display_credit_costs(pool),
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
    """Aekam tops up org credits.

    Writes the PURCHASED bucket. That is the whole point of the two buckets:
    a top-up the client was invoiced for carries over indefinitely, and the old
    month roll — `SET balance = $1` — annihilated it while the ledger called
    the event a reset.
    """
    pool = await get_pool()

    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    async with pool.acquire() as conn:
        async with conn.transaction():
            bal = await credits.grant(
                conn,
                org_id=org_id,
                credits=body.amount,
                bucket="purchased",
                granted_by=user["user_id"],
                description=body.notes or "Aekam credit top-up",
            )

    return {
        "balance": bal.total,
        "allowance": bal.allowance,
        "purchased": bal.purchased,
    }


@router.post("/org/credits/allocate/{target_user_id}")
async def allocate_user_credits(
    target_user_id: str,
    body: UserCreditAllocate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Set a member's ceiling on the shared org balance for this period.

    ABSOLUTE, not additive, and that is the behaviour change. This did
    `allocated = allocated + EXCLUDED.allocated`, so a ceiling could only ever
    go up: no lowering, no clearing, no reset with the month, no ledger row. An
    admin who typed 200 twice gave the member 400 and had no way back.

    `amount: null` CLEARS the ceiling — uncapped within the org balance.
    `amount: 0` refuses that member everything, which is a real and supported
    state; it is not the same as clearing.

    Nothing is debited from here and nothing is reserved. A ceiling is a limit
    on the ORG's money, not a second wallet, so the sum of the ceilings may
    legitimately exceed the balance and this route does not refuse that — see
    `GET /org/credits/users`, which shows the over-commitment.
    """
    pool = await get_pool()
    await _assert_org_credit_admin(pool, user["user_id"], org_id)

    if body.amount is not None and body.amount < 0:
        raise HTTPException(400, "Amount must be zero or more, or null to clear the limit")

    async with pool.acquire() as conn:
        async with conn.transaction():
            cap = await credits.set_member_cap(
                conn,
                org_id=org_id,
                user_id=target_user_id,
                cap=body.amount,
                set_by=user["user_id"],
            )

    return {
        "user_id": cap.user_id,
        # The old key names, so nothing reading this reply has to move at the
        # same time as the model underneath it.
        "allocated": cap.cap,
        "used": cap.spent,
        "cap": cap.cap,
        "spent": cap.spent,
        "remaining": cap.remaining,
        "period_start": cap.period_start,
    }


@router.delete("/org/credits/allocate/{target_user_id}")
async def clear_user_credit_cap(
    target_user_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Remove a member's ceiling entirely — they spend from the org pool.

    There was no way to do this at all. The allocation upsert was additive, so
    a ceiling set once could be raised and never removed, and an admin who
    wanted to undo a limit had to raise it to a number they hoped was large
    enough. Clearing is a different act from setting a very big number, and the
    refusal message says so.
    """
    pool = await get_pool()
    await _assert_org_credit_admin(pool, user["user_id"], org_id)

    async with pool.acquire() as conn:
        async with conn.transaction():
            cap = await credits.set_member_cap(
                conn,
                org_id=org_id,
                user_id=target_user_id,
                cap=None,
                set_by=user["user_id"],
            )

    return {"user_id": cap.user_id, "cap": None, "spent": cap.spent,
            "period_start": cap.period_start}


@router.get("/org/credits/users")
async def list_user_credits(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Every member's ceiling and spend this period, plus the over-commitment.

    Gated. This was `require_user`, so any member of the org could read every
    colleague's allocation and how much of it they had spent.

    The over-commitment figure is the point of the screen. Ceilings are limits
    on ONE shared balance, so five members capped at 200 against a 500 balance
    is a legitimate arrangement that runs on first-come — but the org has to be
    able to SEE that it has promised 1,000 out of 500. Refusing to save it
    would be the product deciding the customer's policy for them; not showing
    it is how the first member to be refused becomes a support ticket.
    """
    pool = await get_pool()
    await _assert_org_credit_admin(pool, user["user_id"], org_id)

    # Rolled before it is read: `roll_period` is what carries the ceilings into
    # the new period, so without this the screen is empty on the 1st and an
    # admin concludes their allocations were lost.
    await _current_balance(pool, org_id)
    caps = await credits.org_member_caps(pool, org_id)
    # `commitment_of` rather than summing the caps here: the over-commitment
    # figure is arithmetic over the ceilings and the balance, and arithmetic
    # over credits belongs in the credits service with everything else that
    # touches them.
    commitment = await credits.commitment_of(pool, org_id)

    return {
        "data": [
            {
                "user_id": c.user_id,
                # The key names this endpoint has always used, so a caller does
                # not have to move at the same moment the model under it does.
                "allocated": c.cap,
                "used": c.spent,
                "cap": c.cap,
                "spent": c.spent,
                "remaining": c.remaining,
                "period_start": c.period_start,
            }
            for c in caps
        ],
        # Positive `over_committed_by` means the ceilings promise more than the
        # balance holds. That is allowed and is not an error; it is first-come.
        "commitment": commitment,
    }


# ══════════════════════════════════════════════════════════════
# ORG CONTENT — generate content at org level
# ══════════════════════════════════════════════════════════════


@router.post("/org/generate")
async def generate_org_content(
    body: OrgContentGenerate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    _=Depends(_hub_gate),
):
    """Generate content at org level using org credits."""
    pool = await get_pool()

    if body.agent_type not in AGENT_PROMPTS:
        raise HTTPException(400, f"Invalid agent type: {body.agent_type}")

    work = _work_key(org_id, idempotency_key)
    receipt = await credits.spend_standalone(
        org_id=org_id,
        user_id=user["user_id"],
        kind="content",
        ref_id=body.agent_type,
        idempotency_key=work,
        description=f"{body.agent_type} generation",
    )

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

    try:
        result = await generate(
            prompt=user_prompt, system=system_prompt,
            org_id=org_id,
            max_tokens=2048 if body.agent_type != "blog" else 4096,
            language=body.language, agent_type=body.agent_type,
        )
    except Exception:
        # The text charge, returned in full, before the failure reaches the
        # caller. This raise used to leave a committed debit and no content —
        # the debit was taken on `deduct_org_credits`'s own connection, so
        # there was not even a transaction to roll back.
        await credits.refund_standalone(
            tx_id=receipt.tx_id, reason="Refund — generation failed",
            user_id=user["user_id"],
        )
        raise

    # Image generation if requested
    image_url, image_key = None, ""
    img_receipt = None
    charged = receipt.credits
    if body.generate_image:
        try:
            img_receipt = await credits.spend_standalone(
                org_id=org_id,
                user_id=user["user_id"],
                kind="content",
                ref_id="image",
                idempotency_key=f"{work}:image",
                description="image generation",
            )
            img_prompt = body.image_prompt or f"Professional social media graphic for: {body.brief}"
            img_result = await generate_image(
                prompt=img_prompt, aspect_ratio=body.aspect_ratio, org_id=org_id,
            )
            image_url = img_result["image_url"]
            image_key = img_result.get("image_key") or ""
            charged += img_receipt.credits
        except Exception as e:
            log.warning("Image generation failed: %s", e)
            # Only the image. The text landed and is kept — this is the
            # partial-success case, and refunding the whole request would hand
            # back credits for a paragraph the customer still has.
            #
            # `img_receipt is None` means the SPEND is what failed — a ceiling
            # or an empty wallet — so there is nothing to return and the caller
            # keeps the text they already paid for.
            if img_receipt is not None:
                await credits.refund_standalone(
                    tx_id=img_receipt.tx_id,
                    reason="Refund — image generation failed",
                    user_id=user["user_id"],
                )

    title = body.brief[:100] if body.brief else f"{body.agent_type} content"
    import re
    hashtags = re.findall(r'#\w+', result["text"]) if body.agent_type == "social_media" else []

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_content_items "
        "(org_id, agent_type, title, body, platform, hashtags, image_url, image_key, "
        " status, credits_used, metadata, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10::jsonb, $11) RETURNING *",
        org_id, body.agent_type, title, result["text"],
        body.platform or None, hashtags, image_url, image_key,
        # What the request ACTUALLY cost, text plus the image if it arrived —
        # not a price looked up a second time. This column is what Aekam's
        # burn-rate sums; the client's report reads the ledger; when the two are
        # resolved independently they disagree and neither can be reconciled.
        charged,
        json.dumps({"provider": result["provider"], "model": result["model"],
                     "language": body.language}),
        user["user_id"],
    )

    return {
        "content": dict(row),
        "credits_used": charged,
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
    for item in data:
        item.pop("_total", None)
    await sign_content_images(org_id, data)
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
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    _=Depends(_hub_gate),
):
    """Quick content generation — standalone, no client/skill setup needed.
    Supports text-only and text+image output."""
    skill_cfg = QUICK_SKILL_PROMPTS.get(body.skill)
    if not skill_cfg:
        raise HTTPException(400, f"Unknown skill: {body.skill}. Available: {', '.join(QUICK_SKILL_PROMPTS)}")

    pool = await get_pool()

    # ONE figure for the price of a run, and it is now the RECEIPT.
    #
    # `QUICK_SKILL_PROMPTS[...]["credits"]` was a second, decorative one: the
    # wallet is debited by AGENT TYPE, and the skill config's own number went
    # into the reply and into `hub_content_items.credits_used`. Four of the
    # seven disagreed —
    #
    #   social_post       reported 3, charged 2
    #   email_campaign    reported 3, charged 2
    #   proposal          reported 5, charged 8
    #   festival_campaign reported 5, charged 10
    #
    # — so a festival campaign took ten credits and told the reader it took
    # five, on the same screen whose card had just said ten. Measured against
    # the ledger 2026-07-29: a social post debits −2 under a footer reading
    # "3 credits used". Reading the figure off the receipt is what makes a
    # third disagreement impossible rather than merely unlikely.
    #
    # Nothing is caught here on purpose. This was
    # `except Exception: raise HTTPException(402, "Insufficient credits")`,
    # which told a customer their wallet was empty when the DATABASE was down —
    # they top up, it still fails, and the one screen that could have told them
    # the truth was the one lying. A CreditError is already a 402 carrying a
    # sentence that names what is needed and what is held; anything else is a
    # fault and must surface as a 500.
    work = _work_key(org_id, idempotency_key)
    receipt = await credits.spend_standalone(
        org_id=org_id,
        user_id=user["user_id"],
        kind="content",
        ref_id=skill_cfg["agent_type"],
        idempotency_key=work,
        description=f"Quick generate: {body.skill}",
    )
    charged = receipt.credits

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
    try:
        text_result = await generate(
            prompt=prompt,
            system=system,
            max_tokens=4096,
            language=body.language,
            agent_type=skill_cfg["agent_type"],
            org_id=org_id,
        )
    except Exception:
        # "Always reliable" is a comment, not a guarantee. When it is wrong the
        # customer had been charged and told nothing.
        await credits.refund_standalone(
            tx_id=receipt.tx_id,
            reason=f"Refund — quick generate failed: {body.skill}",
            user_id=user["user_id"],
        )
        raise

    result = {**text_result, "images": []}
    image_url, image_key = None, ""
    img_receipt = None

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
            # the same to buy. The image was already priced at 3. Nothing here
            # is a new price, only the missing half of an existing one.
            #
            # Before the call, and refunded below if it does not produce one.
            # Its own idempotency key, so a retry that already paid for the text
            # does not pay for the picture twice either.
            img_receipt = await credits.spend_standalone(
                org_id=org_id,
                user_id=user["user_id"],
                kind="content",
                ref_id="image",
                idempotency_key=f"{work}:image",
                description=f"Quick generate image: {body.skill}",
            )
            charged += img_receipt.credits
            img_result = await generate_image(prompt=img_prompt, org_id=org_id)
            result["images"] = [{"url": img_result["image_url"], "mime": "image/png"}]
            # …and on the COLUMN, not only in `metadata.images`. The content
            # library reads `image_url`; metadata is not a display surface. This
            # path charged three credits for an image, stored it, and then never
            # put it anywhere the Content tab looks — 34 of the 40 generated
            # images in the live data were invisible for this reason alone.
            image_url = img_result["image_url"]
            image_key = img_result.get("image_key") or ""
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
            #
            # By the receipt's own amount, not by a price looked up again. The
            # old walk-back subtracted `CREDIT_COSTS["image"]` and refunded the
            # same constant, and the guard in front of it — `charged > the text
            # price` — was a proxy for "did the deduction happen", which was
            # wrong in exactly the case that matters: when the DEDUCTION was
            # what raised, `charged` had not been incremented, the guard read
            # false, and nothing was refunded. Correct by accident. Now the
            # receipt is the record: no receipt, nothing was taken, nothing to
            # return, and the text the customer already has stays paid for.
            if img_receipt is not None:
                await credits.refund_standalone(
                    tx_id=img_receipt.tx_id,
                    reason=f"Refund — image failed: {body.skill}",
                    user_id=user["user_id"],
                )
                charged -= img_receipt.credits

    # Save to content items
    content_row = await pool.fetchrow(
        "INSERT INTO staging.hub_content_items "
        "(org_id, agent_type, title, body, platform, image_url, image_key, status, "
        " credits_used, metadata, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'draft', $8, $9::jsonb, $10) RETURNING id",
        org_id, skill_cfg["agent_type"],
        f"{body.skill}: {body.topic[:60]}",
        result["text"],
        body.platform,
        image_url, image_key,
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
