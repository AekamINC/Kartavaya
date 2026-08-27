"""
hub.py — Sahayak (सहायक) Router
Org-level content generation, skill packs, credit management, brand profiles.
All endpoints gated by require_module("sahayak").
"""
import asyncio
import html as _html
import json
import logging
import uuid as _uuid
from datetime import datetime, time, timezone
from typing import Any, Mapping, Optional
from uuid import UUID

log = logging.getLogger(__name__)

import asyncpg
from fastapi import (
    APIRouter, Depends, Header, HTTPException, Query, Request, Response,
)
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_platform_role
from middleware.role_tiers import (
    OPERATIONS_CONSOLE_ROLES, ORG_MANAGEMENT_ROLES, SAHAYAK_COMMERCIAL_ROLES,
)
from middleware.subscription import require_module
from services.audit_actors import actor_joins, actor_select
from services.ai_router import (
    generate, generate_image, generate_rich_content, deduct_credits,
    detect_language, generate_stream, LANGUAGE_NAMES,
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
from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING
# THE PRIVATE THREE, IMPORTED ON PURPOSE. `_with_ack_keys` below has to compute
# the SAME `finding_key` that `apply_wiring` computes, byte for byte, or the
# acknowledgement is filed under a key the filter never looks up — an ack that
# appears to work and suppresses nothing, for ever (services/skill_ack.py says
# this at length). Re-deriving the bucket walk and the `_list` fold here would
# be a second copy of that judgement, drifting from the first the day a wiring
# changes shape. Calling the originals cannot drift.
from services.skill_ack_wiring import (
    _buckets_of as _ack_buckets_of,
    _identity_for as _ack_identity_for,
    _read_bucket as _ack_read_bucket,
)
from services.credits import CreditError
from services.image_brief import build_brief as build_image_brief
from services.skills.prompt import fill_prompt
from services.skills.schedule import (
    ScheduleError,
    describe as describe_schedule,
    validate_trigger_config,
)
from services.skills.context import (
    context_for_step, assert_step_access, SkillAccessDenied,
    SOURCES as CONTEXT_SOURCES,
)
from services.skill_dispatcher import (
    _run_function_step, SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS,
    UNIMPLEMENTED_SKILL_FUNCTIONS, RUNTIME_FORBIDDEN_PARAMS, describe_skill_functions,
    # The dispatcher's own input hash, not a second one. `_get_feedback_
    # corrections` looks a correction up by (template, org, input_hash), so a
    # feedback row written with any other hash is a row the loop can never find.
    _hash_input as _hash_skill_input,
)
# The Sahayak answer contract — work steps, figures, evidence, and the refusal
# block that 29 §2 rule 2 calls the most important element on the screen.
from services import sahayak_answer as sahayak
# The words this product uses, and what a wrong answer about them sounds like.
# Read from `services/glossary_terms/*.md`, which the owner edits directly —
# the assistant's business mistakes are vocabulary mistakes, and until this
# existed the vocabulary lived only in CLAUDE.md and in people's heads.
from services import glossary
from services import web_search
# Retrieval for the assistant. Scoped to a `hub_clients` row that has already
# been checked against the caller's org — see `sahayak_chat` step 1, and
# `hub_chat.create_chat_session` for the leak that check exists to close.
from services.rag import search_hybrid

#: How much of a data step's findings ride back on the run row.
#:
#: `hub_org_skill_runs.outputs` is jsonb and every run writes one. A skill like
#: the receivables ageing can return thousands of rows, so an unbounded copy
#: would put a full report into the database on EVERY run and into every
#: response that reads it.
#:
#: 20,000 characters holds every current handler's output whole — measured
#: across the 78 live templates. When something does exceed it the payload is
#: sent as text with `truncated: true`, so the renderer says the list is short
#: instead of quietly showing a short list. A silent truncation on a compliance
#: finding is the failure this whole shelf exists to avoid.
_MAX_FINDING_CHARS = 20_000


# ── The handle a finding needs before anybody can dismiss it ────────────────
#
# THE CHICKEN AND THE EGG, AND WHY `skill_finding_ack` HELD ZERO ROWS.
#
# `skill_ack_wiring.apply_wiring` annotates each surviving finding with
# `_ack_key` and `_ack_state` — the handle the client hands straight back to
# `POST /org/skills/findings/ack`. But it returns the handler's output UNTOUCHED
# when the org holds no acknowledgements, and `skill_dispatcher` short-circuits
# on the same condition. Both are right about what they were guarding: an
# `acknowledged: {count: 0}` block on a list nobody has ever acknowledged
# anything in would have every screen render "0 acknowledged" for ever.
#
# The cost was the rest of it. No org has ever held an acknowledgement, so no
# finding has ever carried a key, so no client could ever ask for the first
# one. All 32 wired skills repeated the same list every run, and the feature
# could not be started at all: the only door in was locked from the inside.
#
# So the KEY is separated from the FILTER. This adds the handle to every
# finding of a wired skill on the way into `outputs`, whether or not anything
# has been acknowledged; `apply_wiring` keeps sole charge of hiding rows and of
# the `acknowledged` block, and still no-ops when there is nothing to hide.
#
# THREE PROPERTIES IT MUST HAVE, in the order they can hurt:
#
#   1. IT RETURNS A COPY. `data` also becomes `prior_facts`, the text a later
#      AI step is grounded on. Annotating in place would put two 32-character
#      digests on every row of a 4,000-character prompt window — a third of the
#      grounding on `check_chase_ladder`'s nineteen rows spent on hashes no
#      model can use.
#   2. IT NEVER RAISES. A skill that ran and found something must not be turned
#      into a failed step because a wiring's `label_of` tripped over a row. The
#      unannotated finding is the safe direction: the reader loses the dismiss
#      control, not the finding.
#   3. IT FAILS OPEN ON SHAPE. A handler that moved its rows since the wiring
#      was written gets its output back untouched, exactly as `apply_wiring`
#      does — and for the same reason: showing a finding twice is a nuisance,
#      losing one is a missed payment.
#
# `_ack_label` is computed here rather than by the client for the reason the
# endpoint's own comment gives about the key: what the acknowledgement is CALLED
# when a human reads the table back is the wiring's `label_of`, and a
# client-side guess at it would put a different sentence in the audit row than
# the one the ack list renders.
def _ack_put(root: dict, path: str, value: list) -> None:
    """Write *value* at a dotted *path*, copying every dict on the way down.

    `check_wip_ageing` keeps its rows at `escalated.rows`, beside the threshold
    they are a sample of. A shallow copy of the top level shares that inner dict
    with the original, so writing through it would annotate `data` after all and
    defeat property 1 above.
    """
    steps = path.split(".")
    node: Any = root
    for step in steps[:-1]:
        child = node.get(step)
        if not isinstance(child, dict):
            return
        child = dict(child)
        node[step] = child
        node = child
    node[steps[-1]] = value


def _with_ack_keys(skill_function: str, data: Any) -> Any:
    """A copy of *data* whose findings carry the handle needed to dismiss them.

    Returns *data* itself — the same object, so the caller can skip a second
    serialisation — when the skill is not wired, when the shape does not match
    the wiring, or when anything at all goes wrong.
    """
    wiring = ACK_WIRING.get(skill_function)
    if wiring is None or not isinstance(data, dict):
        return data
    try:
        buckets = _ack_buckets_of(wiring)
        lists = {key: _ack_read_bucket(data, key) for key in buckets}
        if not all(isinstance(found, list) for found in lists.values()):
            return data

        out = dict(data)
        for key in buckets:
            identity_of = _ack_identity_for(wiring, key)
            annotated = []
            for finding in lists[key]:
                if not isinstance(finding, Mapping):
                    # A list of strings under a key the wiring names. Carried
                    # through rather than dropped — see property 3.
                    annotated.append(finding)
                    continue
                row = dict(finding)
                row["_ack_key"] = skill_ack.finding_key(identity_of(finding))
                row["_ack_state"] = (
                    skill_ack.state_hash(wiring.material_of(finding))
                    if wiring.material_of else None
                )
                row["_ack_label"] = skill_ack.sanitise_label(
                    wiring.label_of(finding)
                )
                annotated.append(row)
            _ack_put(out, key, annotated)
        return out
    except Exception:
        log.exception(
            "skill_ack: could not key the findings of '%s' — returning them "
            "with no dismiss handle", skill_function,
        )
        return data


router = APIRouter(prefix="/api/v1/hub", tags=["hub"])


#: Columns the content list may be ordered by, mapped to the SQL that does it.
#:
#: A whitelist rather than a validated string, because the value is interpolated
#: into the query — there is no way to bind an ORDER BY column as a parameter,
#: so the only safe version is one where the user's input never reaches SQL at
#: all. It selects a key here or it is refused.
#:
#: `NULLS LAST` on every one of them: `platform` and `credits_used` are null on
#: a large share of rows, and Postgres sorts nulls FIRST on DESC. Without this,
#: "sort by credits, highest first" opens on a page of blanks.
#: EVERY VALUE IS ALIAS-QUALIFIED, and that is not cosmetic. Both content lists
#: now LEFT JOIN `public.users` twice to resolve the author names, and that table
#: carries `id`, `created_at` and `updated_at` of its own — so a bare `created_at`
#: or a bare `id` in the ORDER BY is `column reference "created_at" is ambiguous`,
#: which PgBouncer hands back as an instant 500 on the default sort of the
#: busiest list in Sahayak. The tiebreaks below are qualified for the same reason.
CONTENT_SORTS: dict[str, str] = {
    "created_at":   "ci.created_at",
    "title":        "lower(coalesce(ci.title, ''))",
    "agent_type":   "ci.agent_type",
    "status":       "ci.status",
    "platform":     "ci.platform",
    "credits_used": "ci.credits_used",
}

CONTENT_PAGE_MAX = 100


def _content_order(sort: Optional[str], order: Optional[str]) -> str:
    """ORDER BY for the content list, from a key the caller may choose.

    Ties break on `created_at DESC, id` rather than being left to the planner.
    Without a total order, two rows equal on the sort column can swap places
    between page 1 and page 2 of the SAME result set — one row shown twice and
    another never shown at all. That reads as data loss and is the classic
    pagination bug; it costs one clause to make impossible.
    """
    col = CONTENT_SORTS.get((sort or "created_at").lower())
    if col is None:
        raise HTTPException(
            400,
            f"Cannot sort by '{sort}'. Valid: {', '.join(CONTENT_SORTS)}.",
        )
    direction = "ASC" if (order or "desc").lower() == "asc" else "DESC"
    tail = "" if col == "ci.created_at" else ", ci.created_at DESC"
    return f" ORDER BY {col} {direction} NULLS LAST{tail}, ci.id"


_hub_gate = require_module("sahayak")

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
    #: The reader's own description of the picture they wanted, from the result
    #: pane's "Describe the image you want instead". The field was missing here
    #: while `GenerateTab.run()` sent it, so Pydantic dropped it silently and
    #: the route re-briefed the picture from `topic` — the brief the reader had
    #: just rejected. They were charged for a full text-and-image run and given
    #: a re-roll of the same thing, under a button priced as though it worked.
    image_prompt: str = ""

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
    #: When it runs by itself. None means unscheduled, which is what every
    #: template in the catalogue was until this field existed — and the reason
    #: all 104 runs in the product's history were somebody pressing a button.
    #: Validated by `services.skills.schedule`, which is the same shape
    #: `/cron/skills` selects on.
    trigger_config: dict | None = None


class SkillScheduleSet(BaseModel):
    """The schedule alone, for the templates that already exist.

    Separate from the create body because the nineteen seeded templates cannot
    be re-created — they carry live grants — and a full update endpoint would
    let a schedule change rewrite steps and prices as a side effect.
    """
    trigger_config: dict | None = None

class CreditTopup(BaseModel):
    amount: int
    notes: str = ""

class OrgSkillAssign(BaseModel):
    custom_config: dict = {}

class SkillRequest(BaseModel):
    """A customer asking for a skill they do not have.

    ONE FIELD, and deliberately not two. There is no `org_id` and no `user_id`
    here: the org is the caller's active org — the same one the catalogue was
    read as, resolved by `get_org_id` — and the requester is `user["user_id"]`.
    A body that could name either would let any member file a request against
    an org they are not in, or in somebody else's name, and neither is a thing
    the screen can even ask for.

    `max_length` matches the CHECK in migration 112, so the two cannot drift
    into a Pydantic rule the database does not hold.
    """
    note: str = Field("", max_length=2000)

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
    #: `None`, not `"1:1"`. A hard default here is indistinguishable from a
    #: caller who chose a square, so it silently overrode the frame the image
    #: preset picks from the content type — a blog hero wants 16:9 and a
    #: greeting card wants 4:5, and both were being cropped to a square by a
    #: value nobody had asked for.
    aspect_ratio: Optional[str] = None


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


def compose_system_prompt(brand: dict | None,
                          skill_instructions: str | None,
                          org_override: str | None,
                          *, skill_name: str = "") -> str:
    """The system prompt, in three layers, most general first.

    ── The defect this closes ──────────────────────────────────────────────────

    `system_prompt = _build_system_prompt(dict(brand)) if brand else ""`.

    `hub_brand_profiles` holds 5 rows live — 4 client-scoped, exactly ONE
    org-scoped. So of three organisations, TWO sent a completely EMPTY system
    prompt, and every content skill they ran was written by a model told
    nothing whatever about the firm it was writing for. Nothing failed; the
    output was simply generic, which is the kind of wrong nobody files a bug
    about.

    ── Why three layers and not one profile ───────────────────────────────────

    The owner: "each skill will have its own set of brand instructions,
    especially where content is getting created."

    A brand profile answers WHO THE FIRM IS. It cannot answer what a
    particular skill's output should be like, and those genuinely differ:
    "Weekly Social Media Pack" and "Engagement Letter Inputs" want opposite
    voices from the same firm — one is marketing, the other becomes a signed
    contract. One voice cannot serve both.

        1. brand              the org's profile        — who the firm is
        2. skill_instructions hub_skill_templates      — what THIS skill's
                                                         output must be like
        3. org_override       hub_org_skills.custom_config
                                                       — this firm's variation

    ── Order is precedence, and later wins ────────────────────────────────────

    Models weight later instructions more heavily than earlier ones, so the
    sequence is not cosmetic: the org's own override for this skill is last
    because it is the most specific thing anyone has said, and a firm that
    writes "never mention pricing" must not be overruled by a generic brand
    voice authored months earlier by somebody else.

    ── The floor ──────────────────────────────────────────────────────────────

    With no brand profile and no instructions, this returns a short statement
    of what the model IS rather than an empty string. An unprompted model
    invents a voice; a minimally prompted one at least knows it is writing for
    an Indian professional-services firm and not a lifestyle blog. That floor
    is the difference for the two orgs that have no profile today.
    """
    layers: list[str] = []

    if brand:
        layers.append(_build_system_prompt(brand))

    if (skill_instructions or "").strip():
        layers.append(
            "Instructions specific to this skill"
            + (f" ({skill_name})" if skill_name else "")
            + f":\n{skill_instructions.strip()}"
        )

    if (org_override or "").strip():
        layers.append(
            "This organisation's own instructions for this skill, which take "
            f"precedence over everything above:\n{org_override.strip()}"
        )

    if not layers:
        return (
            "You are writing on behalf of an Indian professional-services firm. "
            "No brand profile has been set up, so keep the voice plain, "
            "professional and factual, avoid superlatives and marketing "
            "language, and do not invent facts about the firm, its people, its "
            "clients or its results."
        )

    return "\n\n".join(layers)


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

    ── AND THE BRIEF COMES OUT OF `metadata` HERE ────────────────────────────
    Every generating route stores the built image prompt inside the `metadata`
    jsonb — there is no column for it and this agent may not add one, because
    staging and production share a database. `ContentTable.jsx` reads
    `item.image_prompt`, `list_org_content` is `SELECT *`, and no frontend reads
    `item.metadata`, so the diagnosis panel said "This run did not report the
    brief it built" on every row that had one. Lifting it here fixes all three
    read paths at once, for the same reason the signing lives here. Only set
    when there is one, so a row with no picture is still returned untouched.
    """
    from services.storage import refresh_signed_url, sign_key

    for item in items:
        meta = item.get("metadata")
        if isinstance(meta, dict) and meta.get("image_prompt"):
            item.setdefault("image_prompt", meta["image_prompt"])

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


# ── Credit plumbing shared by every Sahayak spend ─────────────

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


def _with_partial(exc, outputs: list, credits_used: int, run_id) -> Exception:
    """Attach the work a failed run ALREADY DID to the error it raises.

    ── The bug ────────────────────────────────────────────────────────────────

    `_fail_run` writes `outputs` onto the run row and then the caller re-raises,
    so the HTTP response is an error and the frontend renders a toast. The data
    steps that SUCCEEDED before an AI step's spend was refused are sitting in
    the database, complete and correct, and unreachable from the run path —
    there is no run-history screen to find them in.

    That is the same defect as the one where findings were never recorded at
    all, wearing a different coat: the work was done and the person who asked
    for it is not shown it. A skill that read a firm's whole overdue book and
    then hit an empty wallet on step 3 should say "here is what I found, and I
    could not finish" — not "insufficient credits" alone.

    ── Why the detail is ENRICHED and not replaced ────────────────────────────

    `CreditError.detail` is a dict carrying `needed`, `member_remaining`,
    `org_allowance`, `org_purchased`, and the top-up screen reads those fields
    by name. Replacing it would break that screen to fix this one. So `partial`
    is ADDED beside them and every existing consumer is untouched: a caller
    that does not know the key ignores it, exactly as it does today.

    A non-dict detail is wrapped rather than discarded, because the message is
    the only thing some failures have.
    """
    from fastapi import HTTPException as _HTTPException

    partial = {
        "run_id": str(run_id),
        "steps_completed": len(outputs),
        "credits_used": credits_used,
        "outputs": outputs,
    }

    if isinstance(exc, _HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            # Mutating in place would edit whatever the raiser still holds a
            # reference to; a copy keeps this purely additive.
            exc.detail = {**detail, "partial": partial}
        else:
            exc.detail = {"message": str(detail), "partial": partial}
        return exc

    # Not an HTTP error — a fault. It still gets to carry what was found,
    # because the findings are no less real for the run having crashed.
    return _HTTPException(
        500,
        {"message": f"{type(exc).__name__}: {exc}", "partial": partial},
    )


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
    This lets admin/members access Sahayak features without manually creating a client."""
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
#
# ═══════════════════════════════════════════════════════════════════════════
# `staging.hub_clients` HOLDS A THIRD PARTY'S CONTACT DETAILS, AND THIS ROUTER
# IS REACHABLE ACROSS TENANTS ON A HEADER.
#
# THE CHAIN, stated in full because no single line of it looks wrong:
#
#   1. Every route here takes its org from `Depends(get_org_id)`, which accepts
#      `X-Org-Id`.
#   2. `middleware/org_resolver.CROSS_ORG_HEADER_PREFIXES` contains
#      `/api/v1/hub/`, so a platform role may name an org it has no membership
#      in and this router will serve it. That is deliberate — Sahayak is the
#      agency service Aekam runs FOR client orgs.
#   3. `sahayak` is NOT in `middleware/subscription.SENSITIVE_MODULES`, so the
#      god-mode narrowing that protects vetana/ganit/manav/pahchan does not
#      apply. The reach is CROSS_ORG_HEADER_ROLES — ten accounts, not the four
#      that hold the finance console.
#   4. `c.name`, `industry`, `website`, `slug` are a company. `contact_name`,
#      `contact_email` and `contact_phone` are a PERSON at that company, and
#      live on 2026-08-20 there are 51 of them with an address on file.
#
# So the org's own people get the whole row, and a caller who arrived through
# the header gets the company and not the person. `_caller_is_member` below is
# the question that separates them, and it is asked of `staging.user_roles`,
# which `docs`/`architecture_tenancy` call the sole tenant path.
#
# WHY MEMBERSHIP AND NOT "IS THIS A PLATFORM ROLE". Because the answer has to
# stay right for a support session too. `org_resolver` admits two kinds of
# header caller — a console role, and a customer-approved support session — and
# neither of them is a member. A test on the ROLE would have handed the contact
# columns to the second kind, which is the one the customer never agreed to
# hand over; a test on MEMBERSHIP is right for both without knowing they exist.
#
# WHAT IS NOT DONE HERE. `_verify_client_access` (used by ~20 handlers) still
# does `SELECT *`, and `get_or_create_org_client` still does. The first is
# handled at the two read sites that return the row to a caller; the second
# resolves the org's OWN internal client, whose contact columns are written by
# nobody. Both are recorded in `tests/test_platform_privacy.py`'s allow-list
# with that reasoning, so neither is silently exempt.
# ═══════════════════════════════════════════════════════════════════════════

#: Everything on `staging.hub_clients` EXCEPT the three contact columns.
#: Verified against the live catalogue on 2026-08-20 rather than read off
#: migration 011 — `is_internal` exists in the database and in no migration in
#: this tree, so a column list derived from the ledger would have dropped it and
#: broken `get_or_create_org_client`'s callers.
#:
#: WRITTEN OUT RATHER THAN `SELECT *` MINUS THREE. A wildcard cannot be reviewed:
#: the day somebody adds `contact_whatsapp` to this table it joins every response
#: in this file, and no diff on this router shows it happening. An explicit list
#: means a new column is invisible until somebody puts it here on purpose.
_CLIENT_COLS_PUBLIC: tuple[str, ...] = (
    "id", "org_id", "name", "slug", "industry", "website", "logo_url",
    "is_active", "is_internal", "created_at", "updated_at",
)

#: The three that name a human being.
_CLIENT_COLS_CONTACT: tuple[str, ...] = (
    "contact_name", "contact_email", "contact_phone",
)


async def _caller_is_member(pool, user_id: str, org_id: str) -> bool:
    """Does this caller hold a role row IN this organisation?

    False means they arrived through `X-Org-Id` — as a platform console role or
    on a support session — rather than by belonging here. `staging.user_roles`
    is the sole tenant path, and `ORG_TENANT_ROLES` is the same set
    `org_resolver` asks its own membership question with, so the two cannot
    drift into disagreeing about what membership is.
    """
    from middleware.role_tiers import ORG_TENANT_ROLES
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[]) "
        "LIMIT 1",
        user_id, org_id, list(ORG_TENANT_ROLES),
    ))


def _audit_cross_org_client_read(request, action: str, org_id: str,
                                 user_id: str, **detail) -> None:
    """Record one non-member read of a customer's client list.

    Imported at call time, the same lazy style this file already uses for
    `middleware.roles.is_platform_staff` — this router is imported by the skill
    dispatcher and its import block is deliberately not grown for a helper.

    ONLY THE HEADER PATH WRITES A ROW. An org's own admin listing their own
    clients is not a tenant boundary crossing, and a row per page-load there
    would bury the rows that matter.
    """
    from services.audit import emit as _emit
    _emit(
        action,
        request,
        user_id=user_id,
        org_id=org_id,
        resource_type="organisation",
        resource_id=org_id,
        detail=detail or None,
        severity="warn",
    )


@router.get("/clients")
async def list_clients(
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """This org's client companies. Contact people only for this org's people.

    `SELECT c.*` is gone. It returned `contact_name`, `contact_email` and
    `contact_phone` to anybody who could reach this org — including the ten
    accounts that can reach it by naming it in a header — and the wildcard meant
    no diff on this router would ever show a new contact column being added to
    the response.
    """
    pool = await get_pool()
    member = await _caller_is_member(pool, user["user_id"], org_id)
    # A COLUMN LIST FROM A SERVER-SIDE ALLOWLIST, joined here and never built
    # from anything a caller sent — the house rule for a dynamic identifier.
    cols = _CLIENT_COLS_PUBLIC + (_CLIENT_COLS_CONTACT if member else ())
    projection = ", ".join(f"c.{c}" for c in cols)
    rows = await pool.fetch(
        f"SELECT {projection}, w.balance as credits, w.monthly_allocation "
        f"FROM staging.hub_clients c "
        f"LEFT JOIN staging.hub_credit_wallets w ON w.client_id = c.id "
        f"WHERE c.org_id=$1::uuid ORDER BY c.name",
        org_id,
    )
    if not member:
        _audit_cross_org_client_read(
            request, "platform.org_clients_read", org_id, user["user_id"],
            clients=len(rows), contacts_withheld=True,
        )
    return {"data": [dict(r) for r in rows]}


@router.post("/clients")
async def create_client(
    body: ClientCreate,
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """One client company. The contact PERSON only for this org's own people.

    ── WHY THE REDACTION IS HERE AND NOT IN `_verify_client_access` ───────────

    That helper is the tenancy guard for roughly twenty handlers, and its job is
    to answer "does this client belong to this org, yes or no" — it returns the
    row because most of its callers need one field off it. Narrowing its
    projection would change what every one of those twenty sees, several of them
    write paths that read `contact_email` in order to preserve it, and a tenancy
    guard is the last thing in this file that should grow a second
    responsibility. So the guard stays exactly as it is and the REDACTION lives
    at the surface that hands the row to a caller — which is this route and
    `list_clients` above, and no other.

    THE KEYS ARE REMOVED, NOT NULLED. A `contact_email: null` is a field a screen
    renders an empty box for and somebody later "fixes"; an absent key is a shape
    that says this door does not carry one. `ClientUpdate` still accepts all
    three on PATCH, so a member editing a contact is unaffected — a platform
    caller writing one would be writing a value it was never shown, which is a
    separate question and is not opened here.
    """
    pool = await get_pool()
    client = await _verify_client_access(pool, str(client_id), org_id)
    member = await _caller_is_member(pool, user["user_id"], org_id)

    brand = await pool.fetchrow(
        "SELECT * FROM staging.hub_brand_profiles WHERE client_id=$1::uuid", str(client_id)
    )
    wallet = await pool.fetchrow(
        "SELECT * FROM staging.hub_credit_wallets WHERE client_id=$1::uuid", str(client_id)
    )
    content_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.hub_content_items WHERE client_id=$1::uuid", str(client_id)
    )

    client_out = dict(client)
    if not member:
        for col in _CLIENT_COLS_CONTACT:
            client_out.pop(col, None)
        _audit_cross_org_client_read(
            request, "platform.org_client_read", org_id, user["user_id"],
            client_id=str(client_id), contacts_withheld=True,
        )

    return {
        "client": client_out,
        "brand": dict(brand) if brand else None,
        "wallet": dict(wallet) if wallet else None,
        "content_count": content_count or 0,
    }


@router.patch("/clients/{client_id}")
async def update_client(
    client_id: UUID,
    body: ClientUpdate,
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    # No skill here — this is ad-hoc generation — so only the org layer and the
    # floor apply. The floor is the point: this used to send "" when no brand
    # profile existed, which is true for two of three live organisations.
    system_prompt = compose_system_prompt(dict(brand) if brand else None, None, None)
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
    platform: Optional[str] = None,
    sort: Optional[str] = None,
    order: Optional[str] = None,
    limit: int = Query(25, ge=1, le=CONTENT_PAGE_MAX),
    offset: int = Query(0, ge=0),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """One client's generated content, sorted and paged the same way as the org list.

    These two lists render the SAME component. If only one of them could page,
    the shared component would need a branch for which caller it had — which is
    how the two Sahayak content views drifted apart the first time.
    """
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)

    # `ci.*` and NOT a bare `*`. The two LEFT JOINs below put `public.users` in
    # the FROM list, and `*` across a join splices whole user rows — email,
    # password_hash, salt, password_reset_token — into every content item. One
    # character is the difference between resolving a name and dumping a
    # credential store, which is why the alias is named before the joins exist.
    #
    # WHO generated it and WHO last touched it, as NAMES: `created_by` and
    # `updated_by` hold `users.user_id`, and a user id may not reach a screen.
    # `services/audit_actors` owns that ladder; the raw ids are popped below.
    head = ("SELECT ci.*, "
            + actor_select("ci", updated=True)
            + "COUNT(*) OVER() AS _total ")
    query = (head
             + "FROM staging.hub_content_items ci "
             + actor_joins("ci", updated=True)
             + "WHERE ci.client_id=$1::uuid")
    params: list = [str(client_id)]

    # Every filter column is alias-qualified now that a second and third table
    # are in scope. `status` is unique to the content table today; qualifying it
    # anyway costs three characters and removes the class of bug entirely.
    if status:
        params.append(status)
        query += f" AND ci.status=${len(params)}"
    if agent_type:
        params.append(agent_type)
        query += f" AND ci.agent_type=${len(params)}"
    if platform:
        params.append(platform)
        query += f" AND ci.platform=${len(params)}"

    query += _content_order(sort, order)
    params.append(limit)
    query += f" LIMIT ${len(params)}"
    params.append(offset)
    query += f" OFFSET ${len(params)}"

    rows = await pool.fetch(query, *params)
    total = int(dict(rows[0]).get("_total", len(rows))) if rows else 0
    data = [dict(r) for r in rows]
    for item in data:
        item.pop("_total", None)
        # `ci.*` hands back the raw actor ids as well as the resolved names, and
        # `users.user_id` is exactly the value CLAUDE.md forbids rendering. They
        # are dropped here rather than by listing all twenty-eight columns in the
        # SELECT — the explicit list is the version that silently stops returning
        # a column somebody adds to the table next month.
        item.pop("created_by", None)
        item.pop("updated_by", None)
    return {
        "data": await sign_content_images(org_id, data),
        "total": total, "limit": limit, "offset": offset,
        "truncated": offset + len(data) < total,
    }


@router.get("/clients/{client_id}/content/facets")
async def client_content_facets(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Counts per agent type, status and platform for one client's whole library.

    Declared BEFORE `/clients/{client_id}/content/{content_id}` would otherwise
    match it — FastAPI resolves in declaration order, and `facets` is a valid
    UUID path segment as far as the router is concerned right up until the
    handler tries to parse it. It sits above that route in this file.
    """
    pool = await get_pool()
    await _verify_client_access(pool, str(client_id), org_id)
    rows = await pool.fetch(
        """
        SELECT 'agent_type' AS facet, coalesce(agent_type, '—') AS value, count(*) AS n
          FROM staging.hub_content_items WHERE client_id=$1::uuid GROUP BY 2
        UNION ALL
        SELECT 'status', coalesce(status, '—'), count(*)
          FROM staging.hub_content_items WHERE client_id=$1::uuid GROUP BY 2
        UNION ALL
        SELECT 'platform', coalesce(platform, '—'), count(*)
          FROM staging.hub_content_items WHERE client_id=$1::uuid AND platform IS NOT NULL GROUP BY 2
        """,
        str(client_id),
    )
    out: dict[str, dict[str, int]] = {"agent_type": {}, "status": {}, "platform": {}}
    for r in rows:
        out[r["facet"]][r["value"]] = int(r["n"])
    return {"facets": out, "total": sum(out["agent_type"].values())}


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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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

    Readable by any Sahayak user, not gated to the roles that may CREATE
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


# ── Asking for a skill you do not have ──────────────────────────────────────
#
# THE CARD WAS TERMINAL. `assign_skill_to_org` is
# `require_platform_role(*OPERATIONS_CONSOLE_ROLES)` and every one of those
# five roles is platform tier — GOD_MODE, MANAGER, STAFF, account_manager,
# sahayak_admin — so no org-tier account can turn a skill on for itself, by
# design. What the product then offered the customer was the sentence
# "Assigning a template is an Aekam function. Ask your account contact." and no
# way to do it. This is that way.
#
# Skills are REQUESTED, not installed. There is no self-serve install path here
# and there is not one behind a flag either: a button that 403s is worse than
# one that is honest about who presses it.

#: The platform-tier roles that stand in for "the account contact".
#:
#: THIS IS A STAND-IN AND THE TABLE KNOWS IT. `staging.organisations` has 44
#: columns and not one of them names an account contact, an account manager or
#: an Aekam-side owner (`owner_user_id` is the CUSTOMER's own owner), so there
#: is no per-org relationship to read. These are the platform-tier commercial
#: roles, which is what "the account contact" means today and is not what it
#: should mean forever. `hub_skill_requests.notified_to` records the addresses
#: each request actually reached, so the day a real per-org contact lands, the
#: history does not have to be reconstructed or guessed at.
ACCOUNT_CONTACT_ROLES = ("account_manager", "platform_admin")

#: Whether `staging.hub_skill_requests` exists.
#:
#: Migration 112 is a FILE and is NOT APPLIED — one `staging` schema, and
#: production writes to it too, so nothing in application code applies it.
#: Cached only once the answer is YES, for `org_profile._senders_table_exists`'s
#: reason: the migration may be applied under a long-running process, and a
#: permanently cached "no" would keep the button dead until the next redeploy.
_skill_requests_table: bool = False


async def _skill_requests_ready(pool) -> bool:
    global _skill_requests_table
    if _skill_requests_table:
        return True
    row = await pool.fetchrow(
        "SELECT to_regclass('staging.hub_skill_requests') IS NOT NULL AS ok"
    )
    _skill_requests_table = bool(row and row["ok"])
    return _skill_requests_table


def _requests_pending_migration() -> HTTPException:
    """503, and it says the request was NOT recorded.

    The same shape `me.py:_pending_migration` uses for PROPOSED_067, for the
    same reason: a generic 500 reads as "try again", and somebody who tries
    again still has no request on file. 503 naming the migration tells the
    screen it can say so plainly, and tells whoever reads the log what to run.
    """
    return HTTPException(
        503,
        "Skill requests are not available on this environment yet — the "
        "hub_skill_requests table (migration 112) has not been created. Your "
        "request was NOT recorded. Ask your account contact directly.",
    )


def _request_row(row) -> dict:
    """The one response shape, whether the row was just written or already open.

    A second press must be indistinguishable from the first from the screen's
    point of view except for the status code, or the UI grows two code paths
    for one state.
    """
    return {
        "request_id": str(row["id"]),
        "template_id": str(row["template_id"]),
        "status": row["status"],
        "requested_at": row["requested_at"],
        "note": row["note"],
    }


async def _account_contacts(pool) -> list[dict]:
    """Who hears about a request. Never empty — see the fallback.

    An empty recipient list would mean a request recorded and nobody told,
    which is the failure mode this whole path exists to remove. When no
    platform-tier commercial account has an address, it goes to FROM_EMAIL,
    which is an Aekam inbox, so the request is never silently unheard.
    """
    rows = await pool.fetch(
        "SELECT DISTINCT u.user_id, u.email, u.name "
        "FROM staging.user_roles r "
        "JOIN users u ON u.user_id = r.user_id "
        "WHERE r.org_id IS NULL AND r.role_code = ANY($1::text[]) "
        "AND u.email IS NOT NULL AND u.email <> ''",
        list(ACCOUNT_CONTACT_ROLES),
    )
    contacts = [dict(r) for r in (rows or [])]
    if contacts:
        return contacts

    from email.utils import parseaddr
    from email_service import FROM_EMAIL

    fallback = parseaddr(FROM_EMAIL)[1]
    return [{"user_id": None, "email": fallback, "name": "Aekam"}] if fallback else []


async def _announce_skill_request(pool, org_id, template, row, user) -> list[str]:
    """Tell the account contact, by email and in-app. Returns what was mailed.

    Called AFTER the row is committed, and every caller wraps it. A request
    that is on file but whose mail failed is recoverable — the row is there and
    `notified_to` is empty, which is exactly the record of "written, nobody
    told". A 500 raised after the INSERT is not recoverable: the customer is
    told it failed and the row says it did not.
    """
    from email_service import send_email
    from utils import create_notification

    contacts = await _account_contacts(pool)

    org = await pool.fetchrow(
        "SELECT name FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    org_name = (org and org["name"]) or "an organisation"
    who = user.get("full_name") or user.get("name") or user.get("user_id") or "A user"
    who_email = user.get("email") or ""
    skill = template["name"]
    note = (row["note"] or "").strip()

    # THE NOTE GOES VERBATIM AND IT IS THE POINT. Everything else in this mail
    # can be looked up; the sentence saying what they want it for is the thing
    # the account contact would otherwise have to ask for by a second email.
    note_html = (
        f'<p><strong>What they said:</strong><br>'
        f'<em>&ldquo;{_html.escape(note)}&rdquo;</em></p>'
        if note else
        "<p>They left no note.</p>"
    )
    body = (
        f"<p><strong>{_html.escape(org_name)}</strong> has asked for the skill "
        f"<strong>{_html.escape(str(skill))}</strong>.</p>"
        f"<p>Requested by {_html.escape(str(who))}"
        + (f" ({_html.escape(who_email)})" if who_email else "")
        + ".</p>"
        + note_html
        + "<p>Nothing has been switched on. Assigning the skill to this org is "
          "still a deliberate act in the operations console.</p>"
    )
    subject = f"Skill requested: {skill} — {org_name}"

    mailed: list[str] = []
    for contact in contacts:
        try:
            send_email(
                contact["email"], subject, body,
                purpose="skill_request",
                ref=f"skill_request:{row['id']}",
            )
            mailed.append(contact["email"])
        except Exception:
            log.exception("skill request mail failed for %s", contact["email"])

        # In-app, per `utils.create_notification`'s own docstring: fire and
        # forget, wrapped by the caller. A contact with no user_id is the
        # FROM_EMAIL fallback and has no account to notify.
        if contact.get("user_id"):
            try:
                await create_notification(
                    pool, contact["user_id"], "skill_request",
                    f"{org_name} asked for “{skill}”",
                    note or "No note was left.",
                    url="/hub/skills",
                )
            except Exception:
                log.exception("skill request notification failed for %s",
                              contact["user_id"])

    return mailed


@router.post("/skills/{template_id}/request", status_code=201)
async def request_skill(
    template_id: UUID,
    body: SkillRequest,
    response: Response,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Ask Aekam to turn this skill on for the caller's organisation.

    ANY member may ask. Gating this to the roles that could not turn it on
    anyway would rebuild the dead end one rung down — ask someone to ask
    someone — and the request is not a grant: it writes a row and sends a mail,
    and the assignment is still a separate deliberate act by a platform account.

    IDEMPOTENT PER ORG AND SKILL WHILE A REQUEST IS OPEN, and that is a UNIQUE
    INDEX rather than an if-statement. `idx_hub_skill_requests_one_open` is
    partial on `WHERE status='open'`, so a second press hits `ON CONFLICT DO
    NOTHING`, this re-reads the open row and answers 200 with the SAME
    request_id. Checking first in Python instead would let two clicks a
    millisecond apart both find nothing and both insert — two leads and two
    emails for one skill. A DECIDED request stops blocking, which is why the
    index is partial: a declined skill can be asked for again later.

    201 on a genuine insert, 200 on a repeat. Same body either way.
    """
    pool = await get_pool()

    template = await pool.fetchrow(
        "SELECT id, name FROM staging.hub_skill_templates "
        "WHERE id=$1 AND is_active=TRUE",
        template_id,
    )
    if not template:
        raise HTTPException(404, "Skill template not found")

    if not await _skill_requests_ready(pool):
        raise _requests_pending_migration()

    row = None
    created = False
    # Two attempts, not a loop: the only way the INSERT can conflict and the
    # SELECT then find nothing is if the open row was decided in between, and
    # one retry covers that. A third pass would mean something else is wrong,
    # and 409 says so rather than spinning.
    for _attempt in range(2):
        try:
            row = await pool.fetchrow(
                "INSERT INTO staging.hub_skill_requests "
                "(org_id, template_id, requested_by, note) "
                "VALUES ($1::uuid, $2, $3, $4) "
                "ON CONFLICT DO NOTHING RETURNING *",
                org_id, template_id, user["user_id"], body.note,
            )
        except asyncpg.exceptions.UndefinedTableError:
            # The probe said the table was there and the INSERT disagreed. That
            # is a rollback between the two, and it is still "not recorded".
            raise _requests_pending_migration()
        if row is not None:
            created = True
            break
        row = await pool.fetchrow(
            "SELECT * FROM staging.hub_skill_requests "
            "WHERE org_id=$1::uuid AND template_id=$2 AND status='open'",
            org_id, template_id,
        )
        if row is not None:
            break

    if row is None:
        raise HTTPException(
            409,
            "The request could not be recorded because another change to this "
            "skill landed at the same moment. Nothing was written. Try again.",
        )

    payload = _request_row(row)
    if not created:
        # A repeat. No second mail: the account contact already has this one,
        # and a fan-out per press turns an impatient customer into a mailbox
        # full of the same request.
        response.status_code = 200
        payload["already_open"] = True
        return payload

    try:
        mailed = await _announce_skill_request(pool, org_id, template, row, user)
        if mailed:
            await pool.execute(
                "UPDATE staging.hub_skill_requests "
                "SET notified_to=$1::text[], updated_at=NOW() WHERE id=$2",
                mailed, row["id"],
            )
    except Exception:
        # The row is committed and that is the durable half. `notified_to` stays
        # '{}', which is the truthful record of "written, nobody told" and is
        # recoverable by hand; a 500 here would tell the customer their request
        # failed while the row says otherwise.
        log.exception("skill request %s recorded but the fan-out failed", row["id"])

    payload["already_open"] = False
    return payload


@router.get("/skills/requests")
async def list_skill_requests(
    status: str = Query("open"),
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
    _=Depends(_hub_gate),
):
    """Aekam's queue: who asked for which skill, and whether anyone was told.

    ── WHY THIS EXISTS ────────────────────────────────────────────────────────

    `POST /skills/{template_id}/request` writes a row and then mails the account
    contact. The mail was the ONLY way the ask reached a human — there was no
    screen anywhere in the product that reads `hub_skill_requests`. That makes
    every failure in `_announce_skill_request` silent and permanent: the fan-out
    is deliberately wrapped so a mail failure cannot 500 the customer's request,
    which is right, and the cost of it being right was that the row then sat in
    a table nobody looks at. `notified_to` stays `'{}'` in exactly that case,
    which is the record of "written, nobody told" — and until this endpoint
    there was nothing that could read it.

    `idx_hub_skill_requests_queue (status, requested_at DESC)` was created by
    migration 112 for this read. It was the only index in that file with no
    caller.

    ── THIS IS A CROSS-ORG READ, AND THAT IS THE POINT ────────────────────────

    `middleware/subscription.py` is quoted elsewhere in this codebase as "no one
    should be able to see any other org data even god mode users", and that rule
    is why `activity.py` lost its `sees_every_org` branch. This read does not
    breach it, for a reason that has to be stated rather than assumed:

      · `hub_skill_requests` IS NOT TENANT DATA. Its own table comment says so —
        "this is AEKAM'S LEAD, not the tenant's CRM record" — and the migration
        records the three tenant-owned tables that were rejected as homes for it
        precisely so a request would not land inside a customer's own records.
      · EVERY FIELD BELOW IS ALREADY IN THE EMAIL. `_announce_skill_request`
        mails the org name, the skill name, the requester's name and address and
        the note verbatim, to these same platform accounts. A screen that shows
        what the inbox already shows discloses nothing new; it just makes the
        disclosure durable and searchable instead of dependent on one SMTP call.

    So the join reaches `organisations` for a NAME and `users` for the requester,
    and nothing else about the org — no counts, no modules, no other rows. Adding
    a field here that is not in that mail would be a new disclosure and must be
    argued separately.

    ── READ-ONLY, DELIBERATELY ────────────────────────────────────────────────

    There is no decide/grant/decline route in this change and the omission is not
    an oversight. `assign_skill_to_org` grants to `Depends(get_org_id)` — the
    CALLER's active org — so granting from this queue would need a cross-org
    WRITE, which this product does not have a sanctioned path for. Migration 112
    is explicit that `status='granted'` is "a RECORD of the grant, not the grant
    itself", so a button here that flipped the status without writing
    `hub_org_skills` would produce exactly the drift that column warns about.
    `already_active` is therefore read LIVE from the grant table on every row:
    the screen reports what is true rather than what somebody once ticked.

    ── DORMANCY IS NOT EMPTINESS ──────────────────────────────────────────────

    Migration 112 is unapplied, so this answers `available: false` with an empty
    list rather than 503. A queue that 503s cannot be opened at all; a queue that
    returns `[]` with no flag would say "nobody has asked for anything", which is
    a claim about customers and is not known to be true. `available` is what lets
    the screen say the third thing: requests cannot be recorded here yet.
    """
    if status not in ("open", "granted", "declined", "withdrawn", "all"):
        raise HTTPException(400, "Unknown status filter")

    pool = await get_pool()

    if not await _skill_requests_ready(pool):
        return {"data": [], "available": False}

    where = "" if status == "all" else "WHERE r.status = $1"
    vals: list = [] if status == "all" else [status]
    vals.append(limit)

    try:
        rows = await pool.fetch(
            "SELECT r.id, r.org_id, r.template_id, r.requested_by, r.note, "
            "       r.status, r.requested_at, r.decided_at, r.decided_by, "
            "       r.notified_to, "
            "       o.name AS org_name, "
            "       t.name AS template_name, t.category, "
            # NAME ONLY, AND NEVER FALLING THROUGH TO AN ADDRESS.
            #
            # Two leaks in two adjacent lines. `u.email AS requester_email` put
            # a customer employee's address on Aekam's queue outright; the
            # `COALESCE(..., u.email)` beside it did the same thing to every
            # requester with an incomplete profile, in a field called
            # `requester_name` where nobody would look for one. The docstring
            # above argues that everything here is already in the announcement
            # mail — and it is — but "it also leaked through SMTP" is a reason to
            # narrow the mail, not a licence to make the leak durable and
            # searchable, which is exactly what this screen does.
            #
            # `NULLIF(TRIM(...))` and not a bare COALESCE: a bare one treats `''`
            # as present, so a blank name field comes back blank. The form is
            # `server.py:list_users`'s, copied rather than re-derived.
            #
            # THE TABLE HAS 0 ROWS (live, 2026-08-20) because migration 112 is
            # unapplied — so this is latent, and the cheapest possible moment to
            # fix it is before the first row exists.
            "       COALESCE(NULLIF(TRIM(u.full_name), ''), "
            "                NULLIF(TRIM(u.name), ''), "
            "                'Name not on file') AS requester_name, "
            # THE DECIDER GOT THE SAME TREATMENT, seven lines late.
            #
            # `r.decided_by` was selected raw and returned raw, and
            # `hub/skills/RequestsTab.jsx` rendered it — so the screen that took
            # such care over `requester_name` printed an Aekam staff id in the
            # next column. Found by `check-rendered-ids.mjs` on 2026-08-23,
            # after that ratchet was taught to see a `_by` value reaching a
            # rendered position; it had walked past this since the endpoint
            # shipped.
            #
            # Same ladder, same terminal wording as the requester above — two
            # phrasings for one absence on one screen is how a reader learns to
            # believe they mean different things.
            "       COALESCE(NULLIF(TRIM(d.full_name), ''), "
            "                NULLIF(TRIM(d.name), ''), "
            "                'Name not on file') AS decided_by_name, "
            # LIVE, from the grant table. Never from r.status — see the note
            # above about `granted` being a record rather than the grant.
            "       EXISTS(SELECT 1 FROM staging.hub_org_skills os "
            "               WHERE os.org_id = r.org_id "
            "                 AND os.template_id = r.template_id "
            "                 AND os.is_active = TRUE) AS already_active "
            "FROM staging.hub_skill_requests r "
            "JOIN staging.organisations o ON o.id = r.org_id "
            "JOIN staging.hub_skill_templates t ON t.id = r.template_id "
            "LEFT JOIN users u ON u.user_id = r.requested_by "
            # LEFT, so an undecided request still appears. An INNER join here
            # would hide every PENDING row — the only rows this queue exists to
            # show — which is a filter that looks like it is working.
            "LEFT JOIN users d ON d.user_id = r.decided_by "
            f"{where} "
            f"ORDER BY r.requested_at DESC LIMIT ${len(vals)}",
            *vals,
        )
    except asyncpg.exceptions.UndefinedTableError:
        # The probe said the table was there and the read disagreed — a rollback
        # between the two. Same answer as never having been created.
        log.warning("hub_skill_requests vanished between probe and read")
        return {"data": [], "available": False}

    return {
        "available": True,
        "data": [
            {
                "request_id": str(r["id"]),
                "org_id": str(r["org_id"]),
                "org_name": r["org_name"],
                "template_id": str(r["template_id"]),
                "template_name": r["template_name"],
                "category": r["category"],
                "requested_by": r["requested_by"],
                "requester_name": r["requester_name"],
                # `requester_email` is gone. Aekam's queue answers "which org
                # asked for which skill, and was anybody told" — `org_name`,
                # `template_name` and `notified_to` answer all three. Replying
                # to the person goes through the approved support-session flow,
                # which leaves a row.
                "note": r["note"],
                "status": r["status"],
                "requested_at": r["requested_at"],
                "decided_at": r["decided_at"],
                # The NAME, never `r["decided_by"]`, which is a `users.user_id`.
                # `decided_at` is what tells the screen whether a decision has
                # been made at all; the name answers who made it.
                "decided_by_name": r["decided_by_name"],
                # `[]` here means NOBODY WAS TOLD. On an open request that is the
                # fan-out having failed, and it is the single most important
                # thing this screen can surface — the row is the only surviving
                # trace of an ask that never reached a person.
                "notified_to": list(r["notified_to"] or []),
                "already_active": bool(r["already_active"]),
            }
            for r in (rows or [])
        ],
    }


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

    # Refused here rather than stored and ignored. A schedule the cron cannot
    # read saves cleanly, shows on the card and never fires, which reads as the
    # scheduler being broken rather than the schedule being wrong.
    try:
        trigger = validate_trigger_config(body.trigger_config)
    except ScheduleError as bad:
        raise HTTPException(400, str(bad))

    row = await pool.fetchrow(
        "INSERT INTO staging.hub_skill_templates "
        "(name, description, category, steps, estimated_credits, icon, trigger_config) "
        "VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb) RETURNING *",
        body.name, body.description, body.category,
        json.dumps(steps_with_order), estimated, body.icon,
        json.dumps(trigger) if trigger else None,
    )
    return dict(row)


@router.put("/skills/templates/{template_id}/schedule")
async def set_skill_template_schedule(
    template_id: UUID,
    body: SkillScheduleSet,
    user=Depends(require_platform_role(*OPERATIONS_CONSOLE_ROLES)),
    _=Depends(_hub_gate),
):
    """Put a skill on a schedule, change it, or take it off one.

    This is the control that was missing, and its absence is the whole reason
    the marketplace looked dead. `/cron/skills` selects on
    `trigger_config->>'type' = 'cron'`; every template in the catalogue carried
    NULL there, so the cron matched nothing and all 104 runs in the product's
    history were somebody pressing Run. There was no bug to find — there was no
    way to write the column.

    PUT rather than PATCH, and a body carrying only the schedule: replacing the
    whole schedule is the operation people actually perform, and a partial merge
    on a jsonb column is how a `months` filter survives a change to a config
    that no longer wants one.

    `trigger_config: null` unschedules. A control that can only add a schedule
    leaves a customer with a skill firing every month and no way to stop it
    short of a database write.

    Arming a skill is deliberately an OWNER action — same platform roles as
    creating one — because it commits the org's credits on a timer nobody is
    watching. The spend lands against whoever assigned the skill.
    """
    pool = await get_pool()
    try:
        trigger = validate_trigger_config(body.trigger_config)
    except ScheduleError as bad:
        raise HTTPException(400, str(bad))

    row = await pool.fetchrow(
        "UPDATE staging.hub_skill_templates "
        "SET trigger_config = $2::jsonb, updated_at = NOW() "
        "WHERE id = $1 RETURNING id, name, trigger_config, is_active",
        template_id, json.dumps(trigger) if trigger else None,
    )
    if not row:
        raise HTTPException(404, "Skill template not found")

    # How many grants this actually arms, counted rather than implied. "Runs on
    # the 12th" is a different decision when it is one org and when it is forty,
    # and the person setting it is entitled to know which before they see the
    # credit line.
    grants = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.hub_org_skills "
        "WHERE template_id = $1 AND is_active = TRUE",
        template_id,
    )
    out = dict(row)
    out["schedule_description"] = describe_schedule(trigger)
    out["active_grants"] = grants
    log.info("Skill template %s schedule set to %s by %s — %d active grant(s)",
             template_id, trigger, user["user_id"], grants)
    return out

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
    request: Request,
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
        # `t.brand_instructions` — the SKILL's own voice. Migration 181.
        "SELECT cs.*, t.steps, t.name as template_name, t.brand_instructions "
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
    system_prompt = compose_system_prompt(
        dict(brand) if brand else None,
        cs["brand_instructions"] if "brand_instructions" in cs else None,
        (custom_config or {}).get("brand_instructions"),
        skill_name=cs["template_name"] or "",
    )

    # Merge variables: body.variables + custom_config
    variables = {**custom_config, **body.variables}

    # Every module this skill's data touches, checked BEFORE the run row is
    # written and long before any credit is deducted. The whole skill path is
    # gated on `require_module("sahayak")`, and the handlers behind it read
    # ganit, manav and vetana tables — so without this, Sahayak is a way around
    # SENSITIVE_MODULES.
    try:
        await assert_step_access(steps, user["user_id"], org_id, request=request)
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

            # ── THE FINDING IS THE PRODUCT, AND IT WAS BEING THROWN AWAY ────
            #
            # `data` is what the skill actually found — the overdue invoices,
            # the employees with no UAN, the invoices that cannot be filed.
            # Until now it went into `prior_facts` and NOWHERE ELSE.
            # `prior_facts` exists only to ground a LATER model step's prompt,
            # so for the 59 templates that carry no model step it was read by
            # nothing and garbage-collected when the loop ended.
            #
            # The visible consequence: a user ran a check, the run completed,
            # and the screen said "Finished — 3 steps, 0 credits. 0 items are
            # waiting in the Content tab." There was no content item, because
            # only an AI step writes one. Sixty-one skills that each answer a
            # real question, and no path from the answer to a person.
            #
            # BOUNDED, and the bound is stated rather than silent. `outputs` is
            # a jsonb column on every run row, so an unbounded copy of a
            # 5,000-row ageing report would be written to the database on every
            # run and returned in every response. `truncated` tells the
            # renderer to SAY the list is short rather than quietly showing one.
            # The GROUNDING text and the STORED finding are dumped separately
            # and that is deliberate: `_with_ack_keys` returns a COPY carrying
            # the dismiss handle for the screen, and `prior_facts` below must
            # stay the handler's own words — a later AI step grounded on two
            # 32-character digests per row is grounded on less of the finding.
            # When the skill is not wired the copy IS the original and the
            # second dump is skipped.
            _ground = json.dumps(data, default=str, ensure_ascii=False)
            _annotated = _with_ack_keys(step["skill_function"], data)
            _payload = _ground if _annotated is data else json.dumps(
                _annotated, default=str, ensure_ascii=False)
            # THE HANDLE MUST NOT COST THE ROWS. Three extra fields is roughly
            # 150 bytes per finding, so a two-hundred-row list that fitted
            # under `_MAX_FINDING_CHARS` unannotated can cross it annotated —
            # and a clipped finding loses `data` entirely, so it renders as a
            # wall of text with no table AND no dismiss control. Strictly
            # worse than before. When the keys are what tips it over, they go.
            if len(_payload) > _MAX_FINDING_CHARS >= len(_ground):
                _payload = _ground
            _clipped = len(_payload) > _MAX_FINDING_CHARS
            outputs.append({
                "step": step.get("order"),
                "skill_function": step["skill_function"],
                "status": "ok",
                "credits_used": 0,
                "label": step.get("label") or step["skill_function"],
                # The parsed object when it fits — a renderer can lay out a
                # table. The raw text when it does not, because "we could not
                # show you this" is a worse answer than an unstyled one.
                # `json.loads(_payload)`, NOT `data`. A handler returns real
                # `date`, `Decimal` and `UUID` objects; `_payload` is the
                # `default=str` dump of them and round-tripping it is what makes
                # the value JSON-safe. Putting `data` here serialised fine into
                # the jsonb column — asyncpg took the dumped string — and then
                # 500'd when FastAPI encoded the RESPONSE:
                #   TypeError: Object of type date is not JSON serializable
                # Found by the e2e suite running a real skill against staging,
                # which is the only place the two paths differ.
                "data": None if _clipped else json.loads(_payload),
                "data_text": _payload[:_MAX_FINDING_CHARS] if _clipped else None,
                "truncated": _clipped,
            })
            prior_facts.append(
                f"## {step.get('label') or step['skill_function']}\n"
                + _ground[:4000]
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
        except Exception as exc:
            # Say what actually went wrong. This branch wrote the literal
            # 'Insufficient credits' for EVERY exception, so a database outage,
            # a missing parameter or a PgBouncer parse error all told the
            # customer their wallet was empty — and the run history then
            # preserved that lie for ever. The org-skill path was repaired at
            # `_fail_run` for exactly this reason; this one was missed, so the
            # two halves of the same feature disagreed about honesty.
            #
            # `credits.spend` refuses with a sentence naming what is needed and
            # what is held, which is already the right message. Anything else is
            # a fault and must read as one.
            await pool.execute(
                "UPDATE staging.hub_skill_runs SET status='failed', "
                "error_message=$1, completed_at=NOW(), "
                "steps_completed=$2, credits_used=$3, outputs=$4::jsonb, "
                "content_item_ids=$5 WHERE id=$6",
                str(exc)[:500] or exc.__class__.__name__,
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
        # The findings themselves, so the caller can RENDER what the skill
        # found rather than being told a count. Without this the response says
        # "3 steps, 0 credits, 0 content items" for a check that just listed
        # forty-two unpaid vendor bills, and the only honest thing a screen
        # could draw from it was a number.
        "outputs": outputs,
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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    """The skills this org HAS, and — as a sibling key — the ones it has ASKED for.

    `data` IS NOT WIDENED, deliberately. It is the ACTIVE grant set: every row
    is a `hub_org_skills` row with `is_active=TRUE`, and a template that has
    been requested but not granted has no row there to appear in. Putting a
    request into that array would make "assigned" and "asked for" the same
    value on the one list the whole surface reads to decide what can be RUN.

    So `skill_requests` sits BESIDE it. `useList` in `pages/hub/_shared.jsx`
    unwraps only `.data` into `.items`, so both existing consumers see a
    byte-identical list and the new key is read explicitly by whoever wants it.
    That is what makes a second endpoint unnecessary: the card and the drawer
    read Available → Requested → Active off this one fetch.

    The key is ALWAYS PRESENT and is `[]` when migration 112 is unapplied, so
    the shape does not change between deploys and no consumer has to test for
    its existence.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT os.*, t.name as template_name, t.description as template_description, "
        # `description` UNALIASED as well. Every card in SkillsTab read
        # `skill.description`, which was always undefined here because the
        # only spelling on the wire was `template_description` — so each one
        # silently fell back to printing a step count where its description
        # belonged. Both names ride now: the alias for the consumers that
        # already read it, the plain one because that is what a card asks for.
        "t.description, "
        # `module` and `skill_type` ride along so the shelf can be GROUPED.
        # Migration 166 built that taxonomy and this endpoint never
        # returned it, so 61 assigned skills rendered as one flat list
        # with a category pill and nothing to sort or filter by. The
        # catalogue endpoint is SELECT * and already had both; only the
        # ASSIGNED list — the one a customer actually reads — did not.
        "t.module, t.skill_type, "
        "t.category, t.estimated_credits, t.icon, t.steps "
        "FROM staging.hub_org_skills os "
        "JOIN staging.hub_skill_templates t ON t.id = os.template_id "
        "WHERE os.org_id=$1::uuid AND os.is_active=TRUE "
        "ORDER BY t.category, t.name",
        org_id,
    )

    requests: list[dict] = []
    if await _skill_requests_ready(pool):
        try:
            open_rows = await pool.fetch(
                "SELECT id, template_id, status, requested_at, note "
                "FROM staging.hub_skill_requests "
                "WHERE org_id=$1::uuid AND status='open' "
                "ORDER BY requested_at DESC",
                org_id,
            )
            requests = [_request_row(r) for r in (open_rows or [])]
        except asyncpg.exceptions.UndefinedTableError:
            # The probe and the read disagreed. The assigned list is the thing
            # this endpoint exists for and it already loaded; losing the
            # request markers is a degraded screen, not a broken one.
            log.warning("hub_skill_requests vanished between probe and read")

    return {"data": [dict(r) for r in rows], "skill_requests": requests}


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


# ── Acknowledging a finding ─────────────────────────────────────────────────
#
# A skill reports the world as it is. `propose_payment_run` returns the same
# overdue vendor bills every run until somebody actually pays a vendor, and
# this skill cannot record a payment. Without a way to say "yes, I know, it is
# handled", the list only ever grows — read carefully in week one, skimmed in
# month two, wallpaper by month three, and wallpaper that still looks like
# coverage is worse than no list at all.
#
# THE KEY IS NOT THE CLIENT'S TO INVENT. `_ack_key` and `_ack_state` arrive on
# each finding from the run, computed server-side by
# `services/skill_ack_wiring.py`. The client hands them straight back. It must
# never derive them, because a client-side copy of the identity/material split
# would drift from this one and file the acknowledgement under a key the filter
# never looks up — an ack that appears to work and suppresses nothing, for ever.
#
# `state` is what makes this trustworthy rather than a way of permanently
# hiding bad news: an ack recorded against a balance of 42,000 stops
# suppressing the moment that balance becomes 84,000. Omitting it records an
# unconditional acknowledgement, which is a deliberate choice and not a default.

class FindingAck(BaseModel):
    skill: str
    key: str
    label: str
    state: Optional[str] = None
    snooze_until: Optional[datetime] = None
    note: str = ""


@router.post("/org/skills/findings/ack")
async def ack_finding(
    body: FindingAck,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Acknowledge one finding so it stops appearing in this skill's runs."""
    if body.skill not in ACK_WIRING:
        # Refused by NAME rather than accepted and ignored. An ack stored
        # against an unwired skill would sit in the table suppressing nothing,
        # and the user would believe the finding was closed.
        raise HTTPException(
            400,
            f"'{body.skill}' does not support acknowledgements yet. Wiring one "
            f"is a per-skill judgement — see services/skill_ack_wiring.py.",
        )
    pool = await get_pool()
    await skill_ack.record_ack(
        pool, org_id, body.skill,
        key=body.key,
        label=body.label,
        acknowledged_by=user["user_id"],
        state=body.state,
        snooze_until=body.snooze_until,
        note=body.note,
    )
    return {"ok": True, "skill": body.skill, "key": body.key}


@router.delete("/org/skills/findings/ack")
async def unack_finding(
    skill: str,
    key: str,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Withdraw an acknowledgement, so the finding returns at the next run.

    A real delete. Withdrawing is the user saying "that was wrong, show me this
    again"; a tombstone would leave the finding hidden while the table claimed
    otherwise.
    """
    pool = await get_pool()
    await skill_ack.clear_ack(pool, org_id, skill, key=key)
    return {"ok": True, "skill": skill, "key": key}


@router.post("/org/skills/{skill_id}/run")
async def run_org_skill(
    skill_id: UUID,
    body: SkillRun,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Org user runs an assigned skill. Deducts from org credits + user allocation.

    A thin wrapper. The work is in `execute_org_skill` below, which takes plain
    arguments instead of `Depends` so that something other than a request can
    call it — specifically `/cron/skills`.

    That mattered more than it looks. `staging.hub_org_skills` was read by this
    router and by nothing else: no cron touched it, so the nineteen marketplace
    skills granted to organisations had no scheduler at all. Not a missing
    column — a missing loop. Every run in the product's history was somebody
    pressing this button.

    The split is deliberately here rather than in `services/`: moving three
    hundred lines of credit handling to another module in the same change would
    have made a behaviour-preserving refactor unreviewable. The right home is a
    service and this is recorded as owed.
    """
    return await execute_org_skill(
        skill_id=skill_id,
        org_id=org_id,
        user_id=user["user_id"],
        variables=body.variables,
        generate_images=body.generate_images,
        request=request,
    )


async def execute_org_skill(
    *,
    skill_id: UUID,
    org_id: str,
    user_id: str,
    variables: dict | None = None,
    generate_images: bool = False,
    request: Request | None = None,
) -> dict:
    """Run one org-assigned skill to completion. Callable without a request.

    `request` is optional and only reaches `assert_step_access`, which passes it
    to `withheld_modules` for the audit row's IP and user agent. That function
    documents that it changes no decision — so a scheduled caller with no
    request weakens the record it leaves, never the gate itself.

    `user_id` on a scheduled run is the member who was assigned the skill, which
    is who the spend is billed to. That is the same rule `/cron/skills` already
    applies to client skills through `hub_client_skills.assigned_by`, and it has
    the same consequence: a timer set months ago bills against that person's
    monthly ceiling.

    Raises HTTPException for a missing grant or a refused module, exactly as
    before, because the route depends on that and a scheduled caller can catch
    it as easily as FastAPI can render it.
    """
    body_variables = variables or {}
    pool = await get_pool()

    # `t.description` and `t.category` join the SELECT for the IMAGE brief. The
    # owner asked for "detailed image by description of skill" and the
    # description was never read by this route at all; the category is the
    # fallback that gives a template added tomorrow a real art direction
    # instead of none. Read-only additions to an existing row fetch.
    os_row = await pool.fetchrow(
        # `t.brand_instructions` — the SKILL's own voice, layered under the
        # org's profile by `compose_system_prompt`. Migration 181.
        "SELECT os.*, t.steps, t.name as template_name, t.brand_instructions, "
        "       t.description as template_description, "
        "       t.category as template_category "
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
    system_prompt = compose_system_prompt(
        dict(brand) if brand else None,
        os_row["brand_instructions"] if "brand_instructions" in os_row else None,
        (custom_config or {}).get("brand_instructions"),
        skill_name=os_row["template_name"] or "",
    )

    # The org's own art direction, if Aekam has authored one for this skill.
    # `custom_config` is the jsonb column that already exists for exactly this
    # kind of per-org override, and it is read here rather than out of
    # `variables` below because `variables` is a flat string substitution map —
    # a nested object dropped into it would be str()'d into a prompt the first
    # time somebody wrote `{image_brief}` in a template. The keys are the field
    # names of `services/image_brief.ArtDirection`, one per line of the brief.
    image_overrides = custom_config.get("image_brief")

    variables = {**custom_config, **body_variables}

    # See `run_skill` — refused before the run row and before any deduction.
    try:
        await assert_step_access(steps, user_id, org_id, request=request)
    except SkillAccessDenied as denied:
        raise HTTPException(403, str(denied))

    run = await pool.fetchrow(
        "INSERT INTO staging.hub_org_skill_runs "
        "(org_skill_id, org_id, steps_total, triggered_by) "
        "VALUES ($1, $2::uuid, $3, $4) RETURNING *",
        skill_id, org_id, len(steps), user_id,
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
                    pool, step, variables, org_id, user_id
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

            # ── THE FINDING IS THE PRODUCT, AND IT WAS BEING THROWN AWAY ────
            #
            # `data` is what the skill actually found — the overdue invoices,
            # the employees with no UAN, the invoices that cannot be filed.
            # Until now it went into `prior_facts` and NOWHERE ELSE.
            # `prior_facts` exists only to ground a LATER model step's prompt,
            # so for the 59 templates that carry no model step it was read by
            # nothing and garbage-collected when the loop ended.
            #
            # The visible consequence: a user ran a check, the run completed,
            # and the screen said "Finished — 3 steps, 0 credits. 0 items are
            # waiting in the Content tab." There was no content item, because
            # only an AI step writes one. Sixty-one skills that each answer a
            # real question, and no path from the answer to a person.
            #
            # BOUNDED, and the bound is stated rather than silent. `outputs` is
            # a jsonb column on every run row, so an unbounded copy of a
            # 5,000-row ageing report would be written to the database on every
            # run and returned in every response. `truncated` tells the
            # renderer to SAY the list is short rather than quietly showing one.
            # The GROUNDING text and the STORED finding are dumped separately
            # and that is deliberate: `_with_ack_keys` returns a COPY carrying
            # the dismiss handle for the screen, and `prior_facts` below must
            # stay the handler's own words — a later AI step grounded on two
            # 32-character digests per row is grounded on less of the finding.
            # When the skill is not wired the copy IS the original and the
            # second dump is skipped.
            _ground = json.dumps(data, default=str, ensure_ascii=False)
            _annotated = _with_ack_keys(step["skill_function"], data)
            _payload = _ground if _annotated is data else json.dumps(
                _annotated, default=str, ensure_ascii=False)
            # THE HANDLE MUST NOT COST THE ROWS. Three extra fields is roughly
            # 150 bytes per finding, so a two-hundred-row list that fitted
            # under `_MAX_FINDING_CHARS` unannotated can cross it annotated —
            # and a clipped finding loses `data` entirely, so it renders as a
            # wall of text with no table AND no dismiss control. Strictly
            # worse than before. When the keys are what tips it over, they go.
            if len(_payload) > _MAX_FINDING_CHARS >= len(_ground):
                _payload = _ground
            _clipped = len(_payload) > _MAX_FINDING_CHARS
            outputs.append({
                "step": step.get("order"),
                "skill_function": step["skill_function"],
                "status": "ok",
                "credits_used": 0,
                "label": step.get("label") or step["skill_function"],
                # The parsed object when it fits — a renderer can lay out a
                # table. The raw text when it does not, because "we could not
                # show you this" is a worse answer than an unstyled one.
                # `json.loads(_payload)`, NOT `data`. A handler returns real
                # `date`, `Decimal` and `UUID` objects; `_payload` is the
                # `default=str` dump of them and round-tripping it is what makes
                # the value JSON-safe. Putting `data` here serialised fine into
                # the jsonb column — asyncpg took the dumped string — and then
                # 500'd when FastAPI encoded the RESPONSE:
                #   TypeError: Object of type date is not JSON serializable
                # Found by the e2e suite running a real skill against staging,
                # which is the only place the two paths differ.
                "data": None if _clipped else json.loads(_payload),
                "data_text": _payload[:_MAX_FINDING_CHARS] if _clipped else None,
                "truncated": _clipped,
            })
            prior_facts.append(
                f"## {step.get('label') or step['skill_function']}\n"
                + _ground[:4000]
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
                user_id=user_id,
                kind="skill_step",
                ref_id=agent_type,
                idempotency_key=f"skillrun:{run_id}:step:{step_no}",
                description=f"{os_row['template_name']} — step {step.get('order', step_no)}",
            )
        except CreditError as denial:
            await _fail_run(_denial_text(denial))
            raise _with_partial(denial, outputs, total_credits, run_id)
        except Exception as exc:
            await _fail_run(f"{type(exc).__name__}: {exc}")
            raise _with_partial(exc, outputs, total_credits, run_id)

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
                user_id=user_id,
            )
            await _fail_run(f"{type(exc).__name__}: {exc}")
            raise _with_partial(exc, outputs, total_credits, run_id)

        image_url, image_key = None, ""
        img_receipt = None
        img_brief = None
        image_error = ""
        if step.get("generate_image") or generate_images:
            # `prompt_template`, NOT `prompt`. By this line `prompt` carries the
            # grounding block prepended above — several thousand characters of
            # invoice rows and pipeline figures — and handing that to an image
            # model asks it to draw a spreadsheet. The step's own
            # `image_prompt` wins where an author wrote one; otherwise the
            # picture is briefed from what the step is ABOUT.
            img_seed = _fill_prompt(
                step.get("image_prompt") or prompt_template, variables
            )
            try:
                img_receipt = await credits.spend_standalone(
                    org_id=org_id,
                    user_id=user_id,
                    kind="content",
                    ref_id="image",
                    idempotency_key=f"skillrun:{run_id}:step:{step_no}:image",
                    description=f"{os_row['template_name']} — step "
                                f"{step.get('order', step_no)} image",
                )
                # AFTER the deduction, because the expansion inside it is a
                # paid text call on Aekam's own key. A member at their ceiling
                # must not cost Aekam a brief for a picture they are not going
                # to get. It cannot raise — every failure inside it falls back
                # to the deterministic house brief — so it does not widen the
                # refund window this `try` exists for.
                img_brief = await build_image_brief(
                    brief=img_seed,
                    template_name=os_row["template_name"],
                    template_description=os_row["template_description"],
                    category=os_row["template_category"],
                    agent_type=agent_type,
                    platform=step.get("platform"),
                    aspect_ratio=step.get("aspect_ratio"),
                    brand=dict(brand) if brand else None,
                    overrides=image_overrides,
                    org_id=org_id,
                )
                img_result = await generate_image(
                    prompt=img_brief.prompt,
                    style=img_brief.style,
                    aspect_ratio=img_brief.aspect_ratio,
                    org_id=org_id,
                    user_id=user_id,
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
                        user_id=user_id,
                    )
                # And the step SAYS the picture is missing. `has_image: false`
                # on the output is what a step that never asked for one looks
                # like too, so a run that asked and failed was indistinguishable
                # from a run that did not ask.
                image_error = (
                    "The image could not be generated — every provider in the "
                    "chain refused. Any credits taken for it have been returned."
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
            # The BUILT image prompt rides along in `metadata`. A customer
            # reporting a bad picture used to leave nobody — not Aekam, not the
            # org — able to find out what the model had been asked for, because
            # the prompt was assembled at the call site and thrown away. It goes
            # in the existing jsonb rather than a new column: staging and
            # production share one database and the schema is owner-gated.
            json.dumps({"skill_run_id": str(run_id), "provider": result["provider"],
                         "model": result["model"], "step": step.get("order"),
                         **(img_brief.as_metadata() if img_brief else {})}),
            user_id,
        )
        content_ids.append(row["id"])
        total_credits += credits_cost
        outputs.append({
            "step": step.get("order"),
            "agent_type": agent_type,
            "content_id": str(row["id"]),
            "provider": result["provider"],
            "has_image": image_url is not None,
            "image_prompt": img_brief.prompt if img_brief else "",
            "image_error": image_error,
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
        # The findings themselves, so the caller can RENDER what the skill
        # found rather than being told a count. Without this the response says
        # "3 steps, 0 credits, 0 content items" for a check that just listed
        # forty-two unpaid vendor bills, and the only honest thing a screen
        # could draw from it was a number.
        "outputs": outputs,
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
    # sat behind `require_module("sahayak")` and seeded the row with the plan's
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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
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
    # No skill here — this is ad-hoc generation — so only the org layer and the
    # floor apply. The floor is the point: this used to send "" when no brand
    # profile existed, which is true for two of three live organisations.
    system_prompt = compose_system_prompt(dict(brand) if brand else None, None, None)
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
    img_brief = None
    image_error = ""
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
            # Was `"Professional social media graphic for: " + brief`, which
            # `generate_image` then cut to 200 characters behind a second
            # generic prefix. No subject, no framing, no light, no palette and
            # no negative ever reached the model; "professional" is a word a
            # diffusion model resolves to the average of its training set,
            # which is the look the owner called slop.
            #
            # This route has no template, so the art direction is resolved from
            # the AGENT TYPE — a blog lead and a WhatsApp broadcast are not the
            # same picture — and `body.image_prompt` is treated as the brief
            # when the caller wrote one, not as a finished prompt.
            img_brief = await build_image_brief(
                brief=body.image_prompt or body.brief,
                agent_type=body.agent_type,
                platform=body.platform or None,
                aspect_ratio=body.aspect_ratio,
                brand=dict(brand) if brand else None,
                org_id=org_id,
            )
            img_result = await generate_image(
                prompt=img_brief.prompt,
                style=img_brief.style,
                aspect_ratio=img_brief.aspect_ratio,
                org_id=org_id,
                # Who asked for it. Every image used to land under
                # `user_id="system"` in one flat folder — proposal 83's second
                # bug — so nothing could say whose it was.
                user_id=user.get("user_id"),
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
            # Said out loud, on the reply. `image_url` came back null with no
            # error beside it, which is indistinguishable from "no image was
            # asked for" — so a caller who asked for one and got none had no
            # way to tell a refusal from a setting.
            image_error = (
                "The image could not be generated — every provider in the "
                "chain refused. Any credits taken for it have been returned."
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
        # The BUILT image prompt, stored with the picture it produced. Nothing
        # recorded what the image model was actually asked for, so a report of
        # a bad picture was undiagnosable. `metadata` is an existing jsonb
        # column — no migration, because the two environments share a database.
        json.dumps({"provider": result["provider"], "model": result["model"],
                     "language": body.language,
                     **(img_brief.as_metadata() if img_brief else {})}),
        user["user_id"],
    )

    # `image_prompt` lifted out of `metadata` on the way out, by the same helper
    # and for the same reason as the three read paths: the screen reads
    # `item.image_prompt` and there is no column of that name to read.
    content = (await sign_content_images(org_id, [dict(row)]))[0]

    return {
        "content": content,
        "credits_used": charged,
        "image_prompt": img_brief.prompt if img_brief else "",
        "image_error": image_error,
        "ai": {"provider": result["provider"], "model": result["model"]},
    }


@router.get("/org/content")
async def list_org_content(
    status: Optional[str] = None,
    agent_type: Optional[str] = None,
    platform: Optional[str] = None,
    sort: Optional[str] = None,
    order: Optional[str] = None,
    limit: int = Query(25, ge=1, le=CONTENT_PAGE_MAX),
    offset: int = Query(0, ge=0),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """List content generated at org level.

    Was `ORDER BY created_at DESC LIMIT 100` with no way to page past it, so an
    org with more than a hundred items simply could not reach the rest, and the
    ones it could reach arrived as one unbroken scroll.
    """
    pool = await get_pool()
    # `ci.*` and NOT `*` — see `list_content`, which this list renders with the
    # same component: a bare `*` across the author joins would return two whole
    # `public.users` rows per item, password hash included.
    head = ("SELECT ci.*, "
            + actor_select("ci", updated=True)
            + "COUNT(*) OVER() AS _total ")
    query = (head
             + "FROM staging.hub_content_items ci "
             + actor_joins("ci", updated=True)
             + "WHERE ci.org_id=$1::uuid")
    params: list = [org_id]

    if status:
        params.append(status)
        query += f" AND ci.status=${len(params)}"
    if agent_type:
        params.append(agent_type)
        query += f" AND ci.agent_type=${len(params)}"
    if platform:
        params.append(platform)
        query += f" AND ci.platform=${len(params)}"

    query += _content_order(sort, order)
    params.append(limit)
    query += f" LIMIT ${len(params)}"
    params.append(offset)
    query += f" OFFSET ${len(params)}"

    rows = await pool.fetch(query, *params)
    # Refreshes a signed URL per row, so it cannot hand `rows` straight to
    # `_listed` — same shape as `ganit.list_contracts`. `_total` is popped in
    # the same pass so it cannot ride out on an item the frontend maps over.
    #
    # COUNT(*) OVER() counts the filtered set BEFORE LIMIT, which is what makes
    # it the page count. On a page past the end there are no rows to read it
    # from, so `total` would collapse to 0 and the pager would lose its last
    # page — hence the separate count in that one case.
    if rows:
        total = int(dict(rows[0]).get("_total", len(rows)))
    else:
        # The projection is replaced by the string it was BUILT from rather than
        # by a re-typed copy of it. The previous version matched a literal
        # "SELECT *, COUNT(*) OVER() AS _total", and the moment the select list
        # grew an author fragment that match would have failed silently: the
        # replace is a no-op, the count query keeps `COUNT(*) OVER()` and the
        # window function makes `fetchval` return the first row's total — which
        # on an empty page is no row at all, and the pager loses its last page
        # again. Deriving both from `head` makes the two impossible to drift.
        count_q = query.split(" ORDER BY ")[0].replace(head, "SELECT COUNT(*) ", 1)
        total = int(await pool.fetchval(count_q, *params[:-2]) or 0)

    data = [dict(r) for r in rows]
    for item in data:
        item.pop("_total", None)
        # The raw actor ids, dropped for the reason `list_content` gives at
        # length: `users.user_id` is never rendered, and the resolved names are
        # what this list now carries in their place.
        item.pop("created_by", None)
        item.pop("updated_by", None)
    await sign_content_images(org_id, data)
    return {
        "data": data, "total": total, "limit": limit, "offset": offset,
        "truncated": offset + len(data) < total,
    }


@router.get("/org/content/facets")
async def org_content_facets(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Counts per agent type, status and platform, over the WHOLE library.

    The filter chips used to count the rows currently on screen. Once the list
    pages, that number is the size of the page and not of the group — a chip
    reading "Blog 25" on every page, whatever the filter. These counts are
    computed across the org, so the chip means the same thing on page 4 as on
    page 1.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT 'agent_type' AS facet, coalesce(agent_type, '—') AS value, count(*) AS n
          FROM staging.hub_content_items WHERE org_id=$1::uuid GROUP BY 2
        UNION ALL
        SELECT 'status', coalesce(status, '—'), count(*)
          FROM staging.hub_content_items WHERE org_id=$1::uuid GROUP BY 2
        UNION ALL
        SELECT 'platform', coalesce(platform, '—'), count(*)
          FROM staging.hub_content_items WHERE org_id=$1::uuid AND platform IS NOT NULL GROUP BY 2
        """,
        org_id,
    )
    out: dict[str, dict[str, int]] = {"agent_type": {}, "status": {}, "platform": {}}
    for r in rows:
        out[r["facet"]][r["value"]] = int(r["n"])
    total = sum(out["agent_type"].values())
    return {"facets": out, "total": total}


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
    img_brief = None
    #: Empty means "no picture was asked for". A sentence means one was asked
    #: for and did not arrive — see the reply, at the bottom of this function.
    image_error = ""

    # Generate image separately using Seedream (reliable, cheap)
    image_skills = ("social_post", "ad_copy", "festival_campaign", "email_campaign", "blog_post")
    if body.with_image and body.skill in image_skills:
        try:
            # THE FIVE PROMPTS THAT USED TO LIVE HERE ARE GONE, and with them
            # `body.topic[:200]`. They were adjective stacks — "modern,
            # scroll-stopping, brand-quality", "bold, eye-catching,
            # professional" — which name nothing a camera could do differently,
            # so the model answered each of them with the average of its
            # training set and all five skills produced the same picture. The
            # topic was then cut at 200 characters, mid-word, and the whole
            # string was cut AGAIN inside `generate_image`.
            #
            # `services/image_brief.py` replaces them with a real art direction
            # per skill — subject, setting, framing, light, palette, medium,
            # register and a negative list — and the topic reaches it whole.
            #
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
            # After the deduction, because the brief's expansion is itself a
            # paid text call on Aekam's key: an org at its ceiling must not cost
            # Aekam a brief for a picture it will never get. It cannot raise —
            # every failure inside falls back to the deterministic house
            # brief — so the refund window this `try` guards is unchanged.
            #
            # `body.image_prompt` FIRST, because a reader who typed one has
            # already seen a picture built from the topic and rejected it.
            # The field used to be absent from `QuickGenerate` entirely, so the
            # request carried it, Pydantic dropped it, and "Generate a new
            # image" charged for and returned a re-roll of the same brief.
            img_brief = await build_image_brief(
                brief=body.image_prompt.strip() or body.topic,
                skill=body.skill,
                agent_type=skill_cfg["agent_type"],
                platform=body.platform,
                brand=dict(brand) if brand else None,
                org_id=org_id,
            )
            img_result = await generate_image(
                prompt=img_brief.prompt,
                style=img_brief.style,
                aspect_ratio=img_brief.aspect_ratio,
                org_id=org_id,
                # Who asked for it. Every image used to land under
                # `user_id="system"` in one flat folder — proposal 83's second
                # bug — so nothing could say whose it was.
                user_id=user.get("user_id"),
            )
            # The mime the provider ACTUALLY answered with, not a literal.
            # Recraft V4 returns image/webp and Gemini image/jpeg; `image/png`
            # was hardcoded here and persisted into `metadata.images`, so the
            # reply, the jsonb and the file the reader saves all named a format
            # the bytes are not. `generate_image` already resolves it — the fix
            # is to stop discarding what it returns.
            #
            # `prompt` rides on the image because `ImagePanel` reads
            # `img.prompt` — and rendered "This run did not report the brief it
            # built" on every single run, because no route ever returned one.
            result["images"] = [{"url": img_result["image_url"],
                                 "mime": img_result.get("mime") or "image/png",
                                 "prompt": img_brief.prompt}]
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
            # AND THE READER IS TOLD. `images` came back empty with no error
            # field, the result pane guards on `images.length > 0` and simply
            # omitted the column, so somebody who ticked "Generate a matching
            # image" saw copy and no picture and no explanation — and clicked
            # Generate again, paying for a second full text run to chase a
            # failure that had already refunded itself. The refund is stated
            # too, because "you were not charged" is the half that stops the
            # second click.
            image_error = (
                "The image could not be generated — every provider in the "
                "chain refused. The credits for it have been returned; the "
                "text is yours and stays paid for."
            )

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
        # The BUILT image prompt travels with the row. Until now the prompt was
        # assembled here and discarded, so "this picture is wrong" was a report
        # nobody could act on. Existing jsonb column, no migration — the two
        # environments share one database and the schema is owner-gated.
        json.dumps({
            "skill": body.skill, "images": result.get("images", []),
            "provider": result.get("provider"), "model": result.get("model"),
            **(img_brief.as_metadata() if img_brief else {}),
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
        # The brief, at the top level as well as on the image, because the two
        # readers of it are different: the result pane reads it off the image it
        # is showing, and a run whose image FAILED has no image to hang it on
        # and is exactly the run somebody wants the brief for.
        "image_prompt": img_brief.prompt if img_brief else "",
        "image_error": image_error,
    }


# ══════════════════════════════════════════════════════════════
# SAHAYAK ASSISTANT — the answer contract the screen was built for
# ══════════════════════════════════════════════════════════════
#
# `POST /chat` and `POST /skills/feedback` did not exist. The Sahayak screen
# shipped as markup with nothing behind it: `assistant/AnswerBody.jsx` renders
# `message.work`, `message.figs` and `message.refusal` and says in its own header
# that those are "fields nothing sets today, which means they render NOTHING
# today". The only chat route in the product returns five keys — message,
# sources, model, cost_usd, credits_charged — so the work-steps panel, the
# figures, the evidence table and the refusal block have never had data.
#
# The shape is `design-reference/Kartavaya Redesign/SahayakData.jsx`, which is
# the spec: work / figs / body-with-citations / none / srcs / ev. It is built in
# `services/sahayak_answer.py`; this router is the plumbing around it — who may
# ask, out of whose records, and what it costs.
#
# ── Three things this route does NOT do, each on purpose ─────────────────────
#
# It does not re-rank. `hub_chat.py` fetches 20 chunks and re-ranks to 5 with a
# second paid LLM call through `services/ai/reranker.py`. This takes 5 straight
# out of the hybrid search: one fewer paid call per question, on the cheapest
# thing the product does, and the owner's standing rule is that production
# runtime uses cheap models.
#
# It does not plan with a model. Which sources a question needs is a keyword
# table in `sahayak_answer.INTENTS`. A planning call would double the cost of
# every answer to save a table whose misses are safe.
#
# It does not generate images, and unlike `hub_chat.py` that is not structural
# here — this module imports `generate_image` for the content routes. The
# control is `tests/test_sahayak_answer.py::test_the_assistant_cannot_reach_an
# _image_generator`, which parses THIS function and fails the build on the call.


class ChatAsk(BaseModel):
    """One question.

    `session_id` continues a conversation, `client_id` names a workspace, and
    both are verified against the caller's org before anything is read — a
    session id is the one value in this request that points at somebody else's
    knowledge base if it is taken on trust. See `hub_chat.create_chat_session`,
    where that exact hole was closed.
    """
    message: str = Field(min_length=1, max_length=4000)
    session_id: Optional[str] = None
    client_id: Optional[str] = None


class SkillFeedback(BaseModel):
    """What the reader thought of a skill run or a Sahayak answer.

    `variables` is hashed the same way `skill_dispatcher._hash_input` hashes a
    run's inputs, because `_get_feedback_corrections` looks a correction up by
    (template, org, input_hash) — a feedback row written with any other hash is
    a row the self-learning loop can never find, which is what "recorded" would
    otherwise quietly mean.
    """
    accepted: bool
    template_id: Optional[str] = None
    skill_id: Optional[str] = None
    run_id: Optional[str] = None
    message_id: Optional[str] = None
    variables: dict = Field(default_factory=dict)
    predicted: Optional[dict] = None
    corrected: Optional[dict] = None
    note: str = ""


def _sahayak_payload(**kw) -> dict:
    """The wire shape. Every key is always present.

    An absent key and an empty one are different bugs on the screen and the
    frontend cannot tell them apart, so nothing here is conditional: a refusal
    carries `figs: []`, not no `figs`.
    """
    return {
        "session_id":     kw.get("session_id"),
        "message_id":     kw.get("message_id"),
        "answered":       bool(kw.get("answered")),
        "message":        kw.get("message") or "",
        "work":           kw.get("work") or [],
        "figs":           kw.get("figs") or [],
        "sources":        kw.get("sources") or [],
        "evidence":       kw.get("evidence"),
        "refusal":        kw.get("refusal") or "",
        "refusal_detail": kw.get("refusal_detail") or None,
        "model":          kw.get("model") or "",
        "credits":        int(kw.get("credits") or 0),
        # The name `POST /chat/sessions/{id}/send` uses. Both are returned so a
        # screen wired to either reads the same number — `SahayakTab.shape()`
        # already falls back from `credits` to `credits_charged`.
        "credits_charged": int(kw.get("credits") or 0),
        "cost_usd":       float(kw.get("cost_usd") or 0),
        "language":       kw.get("language") or "en",
        "read":           kw.get("read") or [],
    }


async def _sahayak_store_answer(pool, session_id, text, sources, model, cost, answer):
    """Store the reply, with the structured half if the column is there.

    Migration 119 adds `hub_chat_messages.answer`. It is NOT applied — one
    staging schema and production writes to it — so the unapplied path is
    production's actual state and has to work. The insert therefore falls back
    to the columns that have existed since migration 017; the answer the CALLER
    gets is identical either way, and what is lost without the column is only
    the work steps and figures on a RELOAD of an old conversation.
    """
    if not session_id:
        return None
    try:
        return await pool.fetchval(
            "INSERT INTO staging.hub_chat_messages "
            "(session_id, role, content, sources, model_used, cost_usd, answer) "
            "VALUES ($1::uuid, 'assistant', $2, $3::jsonb, $4, $5, $6::jsonb) "
            "RETURNING id",
            session_id, text, json.dumps(sources), model, cost, json.dumps(answer),
        )
    except asyncpg.UndefinedColumnError:
        return await pool.fetchval(
            "INSERT INTO staging.hub_chat_messages "
            "(session_id, role, content, sources, model_used, cost_usd) "
            "VALUES ($1::uuid, 'assistant', $2, $3::jsonb, $4, $5) RETURNING id",
            session_id, text, json.dumps(sources), model, cost,
        )


# ── ONE PIPELINE, TWO ENDPOINTS ──────────────────────────────────────────────
#
# `POST /chat` and `POST /chat/stream` are not two answers with the same shape.
# They are the same code: `_sahayak_answer` below IS the route, and the two
# handlers differ only in what they do with the events it yields. Forking it
# would have been half the work and the wrong half — grounding, the RBAC gate,
# the credit spend, citation numbering, `strip_invalid_refs` and the storage
# write are the parts that are easy to get subtly wrong and hard to notice, and
# a second copy of them drifts on the first fix only one copy receives.
#
# THE STREAMING CONTRACT, in full:
#
#   POST /api/v1/hub/chat/stream — same body, same auth, same module gate.
#   `text/event-stream`; a frame is `event: NAME`, `data: <json>`, blank line.
#
#     step   {"label": "Reading overdue customer invoices"}
#     delta  {"text": "…"}
#     final  {…}   exactly the JSON body POST /chat returns
#     error  {"detail": "one sentence"}
#
#   THE STREAMED TEXT IS PROVISIONAL AND `final` IS AUTHORITATIVE. The client
#   replaces what it accumulated with `final["message"]`. It has to:
#   `strip_invalid_refs` can only run on the COMPLETE text — a `[3]` is only
#   invalid once you know the answer never cited anything else — so a client
#   that keeps its own accumulation will display citations the server rejected,
#   pointing at records the model was never given.
#
#   `POST /chat` IS UNCHANGED AND STAYS. Mobile, the e2e suite and every other
#   caller keep working; a client that cannot stream loses nothing at all.
#
# ── Why nothing is yielded until after the credit spend ──────────────────────
#
# `_sahayak_answer` buffers its first step labels rather than yielding them as
# the work happens, which looks backwards and is deliberate. An SSE response has
# already sent `200 OK` by the time its first frame is written, so a pipeline
# that yields early has thrown away the status codes that matter: 404 for
# somebody else's session and, above all, 402 carrying the price of the answer
# and what the org has left. A customer at zero has to get that 402 from both
# endpoints — not an `error` frame on a 200, which no client reads as "top up".
#
# So the first `yield` sits after `credits.spend` returns, and everything before
# it either raises an HTTPException or falls out as a refusal `final`. The
# reader loses nothing: the buffered steps arrive together and still ahead of
# every delta, which is the order they describe.
#
# ── What happens when the reader is the one who leaves ───────────────────────
#
# `ai_router._record_abandoned` holds that decision in full. Short version: the
# debit stands, the `hub_ai_logs` row is still written because the provider
# billed us either way, and no half-answer is stored.
#
# THAT IS THE ANSWER ONLY ONCE THE PROVIDER HAS BEEN ASKED. "We were billed
# either way" is a statement about a call that was made, and between the charge
# and the first token this route makes none: it flushes the held steps, reads
# the brand row and the history, and — for a question that is not about their
# own books — waits several hundred milliseconds on Serper. A reader who leaves
# in that window, which is the window the Stop button makes easy to hit, has
# paid for an answer no model was ever asked to write. There the credit goes
# back; see `_refund_abandoned` and the guard it is called from at step 5b.


#: Strong references to the detached refunds. `asyncio` keeps only a weak one,
#: so a task nothing else holds can be collected before it has run — the same
#: half of `server._bg` that `ai_router._DETACHED` exists for.
_DETACHED_REFUNDS: set = set()


def _refund_abandoned(tx_id: str, user_id: str) -> None:
    """Put a credit back from a stack that is already being torn down.

    HANDED TO THE LOOP, NEVER AWAITED, and that is the whole reason this is a
    function rather than one more `await credits.refund_standalone(...)`. It is
    called while a `GeneratorExit` or a `CancelledError` is in flight, and on
    that stack every `await` raises immediately — an awaited refund would be
    swallowed by the very cancellation it is reacting to, which is exactly how
    the credit went missing in the first place. `ai_router._record_abandoned`
    detaches its log row for the same reason and says so at greater length.

    If the loop is already gone there is nowhere to run it. That is logged
    naming what the customer is owed — the phrasing `credits.refund_standalone`
    uses for its own failures — rather than raised on top of a cancellation.
    """
    async def _run() -> None:
        await credits.refund_standalone(
            tx_id=tx_id,
            reason="Sahayak never reached the model",
            user_id=user_id,
        )

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:                              # pragma: no cover — shutdown
        log.error(
            "Sahayak abandoned before the model during shutdown: tx %s was not "
            "refunded and the customer is owed those credits.", tx_id,
        )
        return
    _DETACHED_REFUNDS.add(task)
    task.add_done_callback(_DETACHED_REFUNDS.discard)


def _sse(event: str, data: dict) -> str:
    """One SSE frame.

    `json.dumps` and not an f-string: a newline inside any value would end the
    frame early and the reader would see a truncated answer with no error.

    `jsonable_encoder` first, because `final` is required to be EXACTLY the body
    `POST /chat` returns and that body goes out through the same encoder. A
    Decimal off a money column is a number there and would be the string
    "4200.50" here — the same answer, rendered two different ways, which is
    precisely the drift two clients built against one contract cannot afford.
    """
    return f"event: {event}\ndata: {json.dumps(jsonable_encoder(data))}\n\n"


@router.post("/chat")
async def sahayak_chat(
    body: ChatAsk,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Ask Sahayak, and get back what it read as well as what it said."""
    async for event, data in _sahayak_answer(body, request, user, org_id, stream=False):
        if event == "final":
            return data
    # Every path through `_sahayak_answer` either raises or ends in `final`, and
    # with no reader to stream to it cannot reach `error` — that event exists
    # only for a failure AFTER the first delta. Arriving here is a bug in this
    # file, and it says so rather than handing back an empty 200.
    raise HTTPException(500, "Sahayak produced no answer.")


@router.post("/chat/stream")
async def sahayak_chat_stream(
    body: ChatAsk,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """The same answer as `POST /chat`, arriving as it is written."""
    events = _sahayak_answer(body, request, user, org_id, stream=True)

    # PRIMED HERE, OUTSIDE THE RESPONSE BODY. `__anext__` runs the pipeline as
    # far as its first yield, which is everything that can still legitimately be
    # an HTTP status. Whatever it raises is raised by THIS coroutine, so FastAPI
    # turns it into a real 402/404/400 with a JSON body, exactly as `POST /chat`
    # does. After this line the status is committed and errors are frames.
    try:
        first = await events.__anext__()
    except StopAsyncIteration:
        first = None

    async def frames():
        try:
            if first is not None:
                yield _sse(*first)
            async for event, data in events:
                yield _sse(event, data)
        except Exception as exc:                      # noqa: BLE001 — reported
            log.warning("Sahayak stream failed for org %s: %s", org_id, exc)
            yield _sse("error", {
                "detail": "Sahayak stopped part-way through this answer. Ask "
                          "again — nothing above is a guess at the rest.",
            })
        finally:
            # Explicit, not left to the interpreter's async-generator finaliser.
            # This is what runs the accounting for an answer the reader walked
            # out on, and "eventually, on finalisation" is not when a spend row
            # should be written.
            await events.aclose()

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Every buffering proxy in front of this holds a text/event-stream
            # response until it is complete unless told not to, which turns the
            # stream back into the blocking call it exists to replace.
            "X-Accel-Buffering": "no",
        },
    )


async def _sahayak_answer(
    body: ChatAsk, request: Request, user, org_id: str, *, stream: bool,
):
    """The whole answer, as `(event, data)` pairs.

    Yields `("step", …)`, then `("delta", …)` when `stream` is true, and ends
    with exactly one `("final", payload)` — or raises. `payload` is
    `_sahayak_payload`, byte-identical on both endpoints.
    """
    pool = await get_pool()
    question = body.message.strip()
    if not question:
        raise HTTPException(400, "Ask a question.")

    #: Step labels held back until the charge has succeeded. See the block
    #: comment above: yielding one commits a 200 and loses the 402.
    held: list[dict] = []

    # ── 1 · whose workspace, and is it theirs ────────────────────────────────
    session_id: Optional[str] = None
    client_id: Optional[str] = None

    if body.session_id:
        session = await pool.fetchrow(
            "SELECT id, client_id FROM staging.hub_chat_sessions "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            body.session_id, org_id,
        )
        if not session:
            raise HTTPException(404, "Session not found")
        session_id = str(session["id"])
        client_id = str(session["client_id"]) if session["client_id"] else None
    elif body.client_id:
        client = await _verify_client_access(pool, body.client_id, org_id)
        client_id = str(client["id"])
    else:
        found = await pool.fetchval(
            "SELECT id FROM staging.hub_clients "
            "WHERE org_id=$1::uuid AND is_internal=TRUE AND is_active=TRUE LIMIT 1",
            org_id,
        )
        client_id = str(found) if found else None

    # ── 2 · what the question needs, and whether the CALLER may see it ───────
    #
    # Before the read, before the charge AND — since 2026-08-06 — before the
    # session row. The first two are the order `skills/context.py:
    # assert_step_access` establishes: a partial answer is worse than a refusal
    # because it looks finished, and charging for a run the customer cannot have
    # is the second wrong thing on top of the first.
    #
    # The third is new and is a tenancy fix rather than a tidiness one. This
    # route sits on `/api/v1/hub/`, where a platform role MAY name another
    # organisation on the X-Org-Id header, so a refused question used to leave
    # an `hub_chat_sessions` row in the customer's org stamped with the Aekam
    # account's user id — a write, into a tenant the caller was about to be
    # refused, for a question shaped like a read. Opening the session after the
    # refusal costs a refused first message its place in the history and buys
    # that. A refusal inside an EXISTING conversation is still recorded, because
    # there the session is the caller's own and the reader who scrolls back has
    # to find out why.
    plan = sahayak.plan_for(question)
    withheld = await sahayak.withheld_for(
        plan, user["user_id"], org_id, request=request,
    )
    if withheld:
        text, detail = sahayak.refusal_access(plan, withheld)
        payload = _sahayak_payload(
            session_id=session_id, answered=False, message=text,
            refusal=text, refusal_detail=detail,
            read=[i.key for i in plan],
        )
        payload["message_id"] = await _sahayak_record_turn(
            pool, session_id, question, text, payload,
        )
        yield "final", payload
        return

    # ── 2b · now, and only now, open a conversation ──────────────────────────
    if not session_id and client_id:
        opened = await pool.fetchrow(
            "INSERT INTO staging.hub_chat_sessions "
            "(client_id, org_id, title, session_type, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3, 'internal', $4) RETURNING id",
            client_id, org_id,
            question[:60] + ("…" if len(question) > 60 else ""),
            user["user_id"],
        )
        session_id = str(opened["id"]) if opened else None

    # ── 3 · read the org's own records. Free — no model is involved ──────────
    #
    # The labels are collected from the PLAN rather than from the readings, so
    # they are known BEFORE the read instead of being reconstructed from what
    # came back. THEY ARE NOT LIVE, AND NOTHING HERE PRETENDS THEY ARE: they go
    # into `held` and are flushed after the charge, which is the trade the block
    # comment on this function sets out — the first `yield` spends the status
    # line, and a customer at zero is owed the 402 more than a reader is owed a
    # step row a moment sooner. They arrive together, still ahead of every
    # delta, which is the order they describe.
    #
    # ONLY THE FIRST CHARACTER IS LOWERED. `.lower()` on the whole label printed
    # "Reading overdue crm follow-ups" and "Reading business kpis" — two of the
    # nine intents carry an acronym — while the work-steps panel prints
    # `Intent.label` untouched. Same intent, named two ways in one answer, a
    # second apart.
    held.extend(
        {"label": f"Reading {i.label[:1].lower()}{i.label[1:]}"} for i in plan
    )
    readings = await sahayak.read_plan(pool, org_id, plan)
    if plan and not any(r.ok for r in readings):
        text, detail = sahayak.refusal_unavailable(readings)
        payload = _sahayak_payload(
            session_id=session_id, answered=False, message=text,
            work=sahayak.work_for(readings, wrote=False, credits=0),
            refusal=text, refusal_detail=detail,
            read=[i.key for i in plan],
        )
        payload["message_id"] = await _sahayak_record_turn(
            pool, session_id, question, text, payload,
        )
        yield "final", payload
        return

    # ── 4 · the knowledge base, scoped to the workspace just verified ────────
    kb_hits: list = []
    if client_id:
        held.append({"label": "Searching your knowledge base"})
        try:
            kb_hits = await search_hybrid(client_id, question, top_k=sahayak.KB_TOP_K)
        except Exception as exc:                      # noqa: BLE001 — reported
            # A knowledge base that is down costs the documents, never the
            # ledger reads that already succeeded.
            log.warning("Sahayak KB search failed for org %s: %s", org_id, exc)
            kb_hits = []

    src_cards, next_ref = sahayak.data_sources(readings)
    kb_cards, kb_blocks, next_ref = sahayak.kb_sources(kb_hits, next_ref)
    sources = src_cards + kb_cards
    citable = {s["ref"] for s in sources if s.get("ref")}

    # ── 5 · charge once, in the same transaction as the question ─────────────
    #
    # `credits.spend` and nothing else. Charging BEFORE the model is what stops
    # two concurrent questions spending one balance twice, and putting the
    # INSERT inside the same transaction means a refused question leaves nothing
    # behind. A CreditError is an HTTPException and is deliberately not caught:
    # a 402 carrying what the answer costs and what the org has left is the one
    # thing a customer at zero needs, and the friendly 200 that older code
    # returns instead has no way to say it.
    async with pool.acquire() as conn:
        async with conn.transaction():
            msg_id = None
            if session_id:
                msg_id = await conn.fetchval(
                    "INSERT INTO staging.hub_chat_messages (session_id, role, content) "
                    "VALUES ($1::uuid, 'user', $2) RETURNING id",
                    session_id, question,
                )
            receipt = await credits.spend(
                conn,
                org_id=org_id,
                user_id=user["user_id"],
                kind="channel",
                ref_id="chatbot_message",
                idempotency_key=f"sahayak-chat:{msg_id or _uuid.uuid4()}",
                description="Sahayak answer",
            )

    # ── 5b · the first frame, and the window the charge is exposed in ────────
    #
    # THE STATUS LINE IS SPENT HERE, not before. Everything above this point can
    # still answer 400, 402 or 404; nothing below can. See the block comment on
    # `_sahayak_answer` for why that boundary is drawn at the charge and not at
    # the first piece of work.
    #
    # AND THE CHARGE IS NOW GUARDED UNTIL THE MODEL IS ASKED. What sits between
    # them is not instantaneous: the held steps, the brand row, ten rows of
    # history and — for a question that is not about their own books — a Serper
    # round trip of several hundred milliseconds. Leaving during it (Stop, or a
    # closed tab) arrives here as `GeneratorExit` or `CancelledError`, and
    # NEITHER IS AN `Exception`, so the refund arm further down never saw one:
    # the org had bought an answer that no provider was ever asked for, with no
    # refund, no `hub_ai_logs` row and nothing in the history to show for it.
    try:
        for label in held:
            yield "step", label

        # ── 6 · write the answer ─────────────────────────────────────────────
        lang = detect_language(question)
        lang_name = LANGUAGE_NAMES.get(lang, "English")

        brand = await pool.fetchrow(
            "SELECT brand_voice, tone FROM staging.hub_brand_profiles "
            "WHERE org_id=$1::uuid", org_id,
        )
        if not brand and client_id:
            brand = await pool.fetchrow(
                "SELECT brand_voice, tone FROM staging.hub_brand_profiles "
                "WHERE client_id=$1::uuid", client_id,
            )

        history_text = ""
        if session_id:
            history = await pool.fetch(
                "SELECT role, content FROM staging.hub_chat_messages "
                "WHERE session_id=$1::uuid ORDER BY created_at DESC LIMIT 10",
                session_id,
            )
            for msg in reversed(list(history)[1:]):
                history_text += f"\n{msg['role'].upper()}: {msg['content']}"

        grounding = sahayak.render_readings(readings, kb_blocks)

        # THE WEB, but only for questions that are not about their own books.
        #
        # `looks_like_org_question` is the gate, and it is the whole cost control:
        # "how many invoices are overdue" must never leave the building, and
        # searching for it would be both a waste and a small privacy leak. What
        # reaches Serper is the residue — "what is the GST rate on cement", "who
        # audits a private limited company" — which is a minority of traffic and is
        # why the free tier is expected to hold.
        #
        # Also gated on the planner having found nothing: if their own records
        # answered the question, a public page is noise at best.
        # THE `not plan` HALF OF THIS GATE IS GONE, 2026-08-10.
        #
        # Reported: "What is the current RBI repo rate?" came back as "The
        # organisation's records do not contain the current RBI repo rate", with
        # `2 records read` under it. The planner had matched something on the word
        # `rate`, so `plan` was non-empty, so no search ran — and the answer was
        # written from two ledger reads that were never going to hold a policy rate.
        # A stray planner match should not be able to switch off the web for a
        # question that is plainly not about their books.
        #
        # `looks_like_org_question` remains, and it is still the whole cost and
        # privacy control: "how many invoices are overdue" never leaves the building.
        # What changed is that the planner no longer gets a veto over it — the
        # question's own words decide, which is what that function is for.
        web_results: list[dict] = []
        if web_search.is_configured() and not sahayak.looks_like_org_question(question):
            # Announced BEFORE the call, unlike the reads above, because this is the
            # one step with a third party's latency in it — the reader is owed the
            # label while they are waiting for it, not once it has returned.
            yield "step", {"label": "Searching the web"}
            web_results = await web_search.search(question)

        prompt = question
        if history_text:
            prompt = f"Conversation so far:{history_text}\n\nUSER: {question}"
        if grounding:
            prompt = f"{grounding}\n\n---\n\n{prompt}"
        if web_results:
            # Numbered AFTER the org's own readings so one [n] means one thing, and
            # added to `citable` — otherwise `strip_invalid_refs` below deletes every
            # web citation as bogus and the answer silently loses its attribution.
            first_web_ref = (max(citable) if citable else 0) + 1
            for i, r in enumerate(web_results):
                r["ref"] = first_web_ref + i
                citable.add(r["ref"])
            prompt = f"{web_search.render_for_prompt(web_results, first_web_ref)}\n\n---\n\n{prompt}"

        # THE HOUSE WORDS, and they go FIRST — above the records, above the web
        # pages, above the question. Definitions have to be read before the
        # things they describe: the readings below talk about clients, invoice
        # status and payments in this product's sense, and a model that meets
        # those rows before it is told what the words mean has already decided
        # what they mean by the time it gets here.
        #
        # `glossary.for_question` matches on the term and its aliases and injects
        # at most four, so an ordinary question carries nothing and the ones that
        # do carry only what they touched — see `services/glossary.py` for why
        # the cap is where it is.
        #
        # NOT NUMBERED, and not added to `citable`. It is vocabulary, not
        # evidence: a definition given an `[n]` would either be cited at a number
        # that points at somebody's invoice, or have the marker stripped by
        # `strip_invalid_refs` and read as a rendering fault.
        vocabulary = glossary.for_question(question)
        if vocabulary:
            prompt = f"{vocabulary}\n\n---\n\n{prompt}"

        # ONE SET OF ARGUMENTS FOR BOTH CALLS. `generate` and `generate_stream` take
        # the same signature and walk the same `_select_providers` chain; building
        # the arguments once is what makes "the streaming answer is the same answer"
        # true rather than nearly true.
        ask = dict(
            prompt=prompt,
            system=sahayak.system_prompt(
                dict(brand) if brand else None, lang_name, len(citable),
                web=bool(web_results),
            ),
            language=lang,
            # TASK, not agent_type. `_select_providers` branches on task, and
            # `task="chatbot"` is the branch that leads with the free model and
            # keeps the paid ones behind it. `agent_type="chatbot"` reaches neither
            # QUALITY_AGENTS nor PREMIUM_AGENTS, so it changes no routing; it is
            # what the spend reports read to say what the call was for.
            task="chatbot",
            agent_type="chatbot",
            client_id=client_id,
            org_id=org_id,
        )

        yield "step", {"label": "Writing the answer"}
    except BaseException:                             # noqa: BLE001 — re-raised
        # `BaseException`, deliberately: the case this exists for is the reader
        # leaving, and that is not an `Exception`. The guard ENDS on the line
        # above, one statement short of the provider — past it
        # `ai_router._record_abandoned` takes over and the debit stands, because
        # from there on the tokens were generated and billed whether or not
        # anybody was still reading them.
        #
        # No refusal is sent and nothing is stored: there may be nobody left to
        # send one to, and a question with no reply under it is what actually
        # happened. Only the credit goes back, and the failure goes on up
        # untouched — the caller turns it into a 500 or an `error` frame exactly
        # as it did before.
        _refund_abandoned(receipt.tx_id, user["user_id"])
        raise

    #: Has a single token reached the reader. It decides two things that must
    #: agree: whether a failure may fall back to another provider (it may not —
    #: see `generate_stream`), and whether the credit is returned.
    delivered = False
    answering = generate_stream(**ask) if stream else None

    try:
        if answering is None:
            result = await generate(**ask)
        else:
            result = None
            try:
                async for kind, value in answering:
                    if kind == "delta":
                        delivered = True
                        yield "delta", {"text": value}
                    else:
                        result = value
            finally:
                # Deterministic, rather than left to the interpreter's
                # async-generator finaliser: closing this here is what runs the
                # abandoned-call accounting on the same tick the reader
                # disconnects, instead of whenever collection happens.
                await answering.aclose()
            if result is None:
                raise RuntimeError("the provider ended the stream with no answer")
    except Exception as exc:                          # noqa: BLE001 — refunded or reported
        if delivered:
            # ── THE ONE RULE FOR MONEY ON THE STREAM ─────────────────────────
            #
            # Text delivered is text charged. The provider generated — and
            # billed us for — everything the reader has already seen, so a
            # refund here would make "fail late" cheaper than "fail early" and
            # would be a second ledger movement against an answer that has had
            # exactly one. It is the same rule a disconnect gets, for the same
            # reason (`ai_router._record_abandoned`).
            #
            # What IS written is a refusal, never the partial prose: invariant 4
            # of the streaming contract. A half-answer stored as an answer is a
            # record that reads as finished, and the reader who scrolls back a
            # week later has nothing to tell them it was not.
            text, detail = sahayak.refusal_generation(type(exc).__name__, False)
            payload = _sahayak_payload(
                session_id=session_id, answered=False, message=text,
                work=sahayak.work_for(readings, wrote=False, credits=receipt.credits),
                refusal=text, refusal_detail=detail,
                credits=receipt.credits,
                read=[i.key for i in plan],
            )
            await _sahayak_store_answer(pool, session_id, text, [], "", 0, payload)
            log.warning("Sahayak stream died mid-answer for org %s: %s", org_id, exc)
            yield "error", {"detail": text}
            return

        refunded = True
        await credits.refund_standalone(
            tx_id=receipt.tx_id,
            reason="Sahayak answer did not complete",
            user_id=user["user_id"],
        )
        text, detail = sahayak.refusal_generation(type(exc).__name__, refunded)
        payload = _sahayak_payload(
            session_id=session_id, answered=False, message=text,
            work=sahayak.work_for(readings, wrote=False, credits=0),
            refusal=text, refusal_detail=detail,
            read=[i.key for i in plan],
        )
        payload["message_id"] = await _sahayak_store_answer(
            pool, session_id, text, [], "", 0, payload,
        )
        payload["message_id"] = str(payload["message_id"]) if payload["message_id"] else None
        yield "final", payload
        return

    answer_text = sahayak.strip_invalid_refs(
        result.get("text") or "", citable,
    ).strip()
    # Two web paths, one card shape. Gemini's own grounding is still read here in
    # case the entitlement is ever granted on the key; `web_results` is Serper.
    # Only one of the two is ever non-empty.
    sources = sources + sahayak.web_sources(result.get("grounding_sources", []))
    sources = sources + [
        {"kind": "web", "type": "web", "ref": r["ref"],
         "title": r.get("title") or "Web", "url": r.get("url") or ""}
        for r in web_results
    ]

    # A source that failed gets the `partial` block. A question about their
    # records that the planner never recognised gets the `unrecognised` one —
    # the fix for the fault this whole route was reopened for. Without it the
    # miss is invisible: no source is read, the model writes from its own words,
    # and the reply says "I don't currently have access to your task records",
    # which is false. `plan` empty AND the question plainly about their books is
    # the exact condition, and it cannot collide with `partial` because an empty
    # plan produces no readings and therefore no failures.
    refusal, refusal_detail = sahayak.refusal_partial(readings)
    if not refusal and not plan and sahayak.looks_like_org_question(question):
        refusal, refusal_detail = sahayak.refusal_unrecognised(question)

    payload = _sahayak_payload(
        session_id=session_id,
        answered=True,
        message=answer_text,
        work=sahayak.work_for(readings, wrote=True, credits=receipt.credits),
        figs=sahayak.figures_for(readings),
        sources=sources,
        evidence=sahayak.evidence_for(readings),
        refusal=refusal,
        refusal_detail=refusal_detail,
        model=result.get("model") or "",
        credits=receipt.credits,
        # What the call cost US, which is not what the customer was charged.
        cost_usd=result.get("cost_usd", 0) or 0,
        language=lang,
        read=[i.key for i in plan],
    )
    stored = await _sahayak_store_answer(
        pool, session_id, answer_text, sources,
        payload["model"], payload["cost_usd"], payload,
    )
    payload["message_id"] = str(stored) if stored else None

    if session_id:
        await pool.execute(
            "UPDATE staging.hub_chat_sessions SET updated_at=NOW() WHERE id=$1::uuid",
            session_id,
        )
    # THE LAST EVENT, AND THE AUTHORITATIVE ONE. `answer_text` above is what
    # `strip_invalid_refs` left of the model's prose, and the deltas that
    # streamed were the prose BEFORE it ran — they can carry a `[4]` this answer
    # never earned. A client that keeps its own accumulation shows the reader
    # citations the server rejected, so this payload replaces it wholesale.
    yield "final", payload


async def _sahayak_record_turn(pool, session_id, question, text, payload) -> Optional[str]:
    """Store a question and the refusal it got, charging nothing.

    A refusal IS the answer to that question and belongs in the history — the
    reader who scrolls back has to find out why, not find a question with
    nothing under it. Free, because no model ran: the RBAC refusal happens
    before any read and the unavailable refusal happens after reads that cost
    nothing.
    """
    if not session_id:
        return None
    await pool.execute(
        "INSERT INTO staging.hub_chat_messages (session_id, role, content) "
        "VALUES ($1::uuid, 'user', $2)",
        session_id, question,
    )
    stored = await _sahayak_store_answer(pool, session_id, text, [], "", 0, payload)
    return str(stored) if stored else None


#: The structured half of a stored answer, and nothing else.
#:
#: `hub_chat_messages.answer` holds the whole `_sahayak_payload`, which repeats
#: facts the row already carries under different names — `message` against
#: `content`, `model` against `model_used`, its own `session_id`. Copying the
#: blob wholesale would let those two versions disagree, and the row is the one
#: the database can be queried on. So the read-back lifts exactly the keys that
#: exist NOWHERE ELSE and leaves the rest where it is.
#:
#: Every name here is one `SahayakTab.shape()` already reads off a message; see
#: its comment, which says these "render NOTHING today" on a reloaded thread.
_ANSWER_READBACK = (
    "answered", "work", "figs", "evidence", "refusal", "refusal_detail",
    "read", "credits", "credits_charged", "sections",
)


def _with_stored_answer(row: dict) -> dict:
    """One history row, with its work steps, figures and evidence put back."""
    stored = row.pop("answer", None)
    if isinstance(stored, (str, bytes)):
        # `db.py:82` registers the jsonb codec per connection and WARNS rather
        # than raises when PgBouncer drops the handshake, so on such a
        # connection asyncpg hands jsonb back as a string. `assistant/sources.js`
        # already carries this same defence for the `sources` column.
        try:
            stored = json.loads(stored)
        except ValueError:
            stored = None
    if isinstance(stored, dict):
        for key in _ANSWER_READBACK:
            if key in stored:
                row[key] = stored[key]
    return row


@router.get("/chat/sessions/{session_id}/messages")
async def sahayak_chat_history(
    session_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """A conversation, reopened WITH the work steps, figures and evidence.

    ── WHY THIS ROUTE IS DECLARED TWICE IN THIS PRODUCT ────────────────────────

    `hub_chat.get_chat_messages` answers the same path and selects six columns,
    none of which is `answer`. That is the whole defect: `_sahayak_store_answer`
    has been writing the full payload into `hub_chat_messages.answer` on every
    reply, and nothing has ever read it back — so an answer was complete while
    it was on screen and lost its work steps, its figures and its evidence table
    the moment the reader reopened the thread. The prose survived; the
    provenance, which is the thing the surface exists to promise, did not.

    `server.py` includes `hub_router` BEFORE `hub_chat_router`, and Starlette
    returns the first route that matches — so this one answers and the other is
    dead. That is deliberate rather than accidental, and it is written here
    because a shadowed route is invisible from the shadowed file: the answer
    payload is built in THIS module, by `_sahayak_payload`, and the read-back
    belongs beside the write. `tests/test_sahayak_stream.py` pins which of the
    two the router actually resolves, so this cannot quietly swap back.

    The shape is a SUPERSET of what was returned before — same six keys, same
    `{"data": [...]}` envelope, `sources` still handed over exactly as the
    column holds it. A client written against the old route reads the same
    fields it always did.
    """
    pool = await get_pool()
    session = await pool.fetchrow(
        "SELECT client_id FROM staging.hub_chat_sessions "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(session_id), org_id,
    )
    if not session:
        raise HTTPException(404, "Session not found")

    try:
        # The six columns the shadowed route selected, plus `answer`. Nothing
        # else: a row that carries an extra column on one deployment and not on
        # the other is a shape the client has to test for, and the whole point
        # of the fallback below is that it cannot tell which one it got.
        msgs = await pool.fetch(
            "SELECT id, role, content, sources, model_used, answer, created_at "
            "FROM staging.hub_chat_messages "
            "WHERE session_id=$1::uuid ORDER BY created_at",
            str(session_id),
        )
    except asyncpg.UndefinedColumnError:
        # Migration 119 is not applied here. The prose and the sources are older
        # than that column and still answer; what is missing is what was never
        # written in the first place, so the thread reads exactly as it did
        # before this route existed rather than 500ing.
        msgs = await pool.fetch(
            "SELECT id, role, content, sources, model_used, created_at "
            "FROM staging.hub_chat_messages "
            "WHERE session_id=$1::uuid ORDER BY created_at",
            str(session_id),
        )

    return {"data": [_with_stored_answer(dict(m)) for m in msgs]}


@router.post("/skills/feedback", status_code=201)
async def record_skill_feedback(
    body: SkillFeedback,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_hub_gate),
):
    """Record what the reader thought — and, when they correct it, feed it back.

    `staging.hub_skill_feedback` has existed since migration 059 and
    `skill_dispatcher._get_feedback_corrections` has read it the whole time.
    Nothing has ever written to it: there was no endpoint. So the self-learning
    half of the skill system has been a lookup against an empty table.

    ── What is verified before a row is written ────────────────────────────────
    Every id in the body is checked against THIS org. A skill id resolves to its
    template through `hub_org_skills WHERE org_id`, a run through
    `hub_org_skill_runs WHERE org_id`, and a message through its session's
    org — so an id belonging to another tenant 404s rather than being stamped
    with the caller's org_id and stored. Writing an unverified foreign id into
    an org-scoped table is how a feedback row becomes a cross-tenant pointer.
    """
    if not (body.template_id or body.skill_id or body.message_id):
        raise HTTPException(
            400, "Name what the feedback is about: template_id, skill_id or message_id.",
        )

    pool = await get_pool()
    template_id = body.template_id

    if body.skill_id:
        # Org skills first, then the per-client assignment — both are org-scoped
        # rows and either can be what the reader pressed the button on.
        resolved = await pool.fetchval(
            "SELECT template_id FROM staging.hub_org_skills "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            body.skill_id, org_id,
        )
        if not resolved:
            resolved = await pool.fetchval(
                "SELECT cs.template_id FROM staging.hub_client_skills cs "
                "LEFT JOIN staging.hub_clients c ON c.id = cs.client_id "
                "WHERE cs.id=$1::uuid AND (cs.org_id=$2::uuid OR c.org_id=$2::uuid)",
                body.skill_id, org_id,
            )
        if not resolved:
            raise HTTPException(404, "Skill not found")
        template_id = str(resolved)

    if template_id:
        known = await pool.fetchval(
            "SELECT 1 FROM staging.hub_skill_templates WHERE id=$1::uuid",
            template_id,
        )
        if not known:
            raise HTTPException(404, "Skill template not found")

    if body.run_id:
        owns_run = await pool.fetchval(
            "SELECT 1 FROM staging.hub_org_skill_runs "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            body.run_id, org_id,
        )
        if not owns_run:
            raise HTTPException(404, "Run not found")

    if body.message_id:
        # Through the SESSION, which is the row that carries org_id.
        # `hub_chat_messages` has no org column of its own, so a check against
        # the message alone would confirm the existence of — and accept feedback
        # on — another tenant's answer.
        owns_msg = await pool.fetchval(
            "SELECT 1 FROM staging.hub_chat_messages m "
            "JOIN staging.hub_chat_sessions s ON s.id = m.session_id "
            "WHERE m.id=$1::uuid AND s.org_id=$2::uuid",
            body.message_id, org_id,
        )
        if not owns_msg:
            raise HTTPException(404, "Answer not found")

    input_hash = _hash_skill_input(body.variables or {})

    try:
        row = await pool.fetchrow(
            "INSERT INTO staging.hub_skill_feedback "
            "(skill_template_id, org_id, input_hash, predicted, corrected, accepted, "
            " run_id, message_id, note, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6, "
            "        $7::uuid, $8::uuid, $9, $10) RETURNING id",
            template_id, org_id, input_hash,
            json.dumps(body.predicted) if body.predicted else None,
            json.dumps(body.corrected) if body.corrected else None,
            body.accepted, body.run_id, body.message_id, body.note[:2000],
            user["user_id"],
        )
    except asyncpg.UndefinedColumnError:
        # Migration 119's four columns are not applied. The feedback that drives
        # the correction loop — template, org, hash, corrected, accepted — is
        # older than this endpoint and lands either way; what is lost is the
        # provenance, not the signal.
        row = await pool.fetchrow(
            "INSERT INTO staging.hub_skill_feedback "
            "(skill_template_id, org_id, input_hash, predicted, corrected, accepted) "
            "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6) RETURNING id",
            template_id, org_id, input_hash,
            json.dumps(body.predicted) if body.predicted else None,
            json.dumps(body.corrected) if body.corrected else None,
            body.accepted,
        )

    return {
        "status": "recorded",
        "id": str(row["id"]) if row else None,
        "template_id": template_id,
        "input_hash": input_hash,
        # True only when this row can actually change a later run: the loop
        # reads corrections, and an accepted row or one with nothing corrected
        # is a signal for a human, not for the dispatcher.
        "will_correct_future_runs": bool(
            template_id and body.corrected and not body.accepted
        ),
    }
