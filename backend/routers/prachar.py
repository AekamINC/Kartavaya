"""
prachar.py — Prachar · प्रचार (Marketing) Router
Email templates, campaigns, automations, unsubscribes.
Reads Graha contacts for audience targeting.
"""
import asyncio
import html
import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, field_validator

from auth_router import require_user
import outbound
from db import get_pool
from email_service import send_email
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.engagement_metrics import (
    UNMEASURED_REASON,
    engagement_is_measured,
    redact_contact_stats,
    redact_engagement,
    redact_engagement_rows,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/prachar", tags=["prachar-marketing"])

_gate = require_module("prachar")

_background_tasks: set = set()


# ── The audience filter contract ─────────────────────────────

# What a campaign may segment on. Everything else is a typo or a probe, and both
# deserve a refusal: a key that is quietly ignored does not narrow the audience,
# it mails the whole org — and the preview agrees with it, because the preview
# ignores the same key. The expensive failure here is the one that looks fine.
AUDIENCE_FILTER_KEYS = ("type", "source", "company", "tag", "min_score")

# `label` was this filter's original name for `tag` and is still sitting in
# `audience_filter` on campaigns saved before anything validated it. Accepted on
# the way in, rewritten to `tag`, never emitted.
_AUDIENCE_ALIASES = {"label": "tag"}

# staging.graha_contacts.contact_type CHECK, migration 018. The comparison is
# exact and case sensitive because the column is, so 'Customer' would silently
# match nobody — which is why the wrong case is refused here rather than tried.
CONTACT_TYPES = ("lead", "customer", "vendor", "partner")

_SCORE_REFUSAL = "min_score must be a whole number between 0 and 100."


def normalise_audience_filter(value):
    """Refuse a filter that cannot mean what it says; store the rest one way.

    This runs on the way in (both campaign models and the standalone preview)
    and again on the way out of the database, because a filter persisted before
    this function existed has never been checked by anything.

    Coercing `min_score` is the fix for a 500 rather than a nicety. A number
    typed into a form arrives as `"50"`; `lead_score >= '50'` binds text against
    an INTEGER column and asyncpg raises DataError inside `/audience`, which
    reads to the operator as "the preview is broken" rather than "your number
    arrived as text".

    HTTPException rather than ValueError on purpose. Pydantic turns a ValueError
    into a 422 whose body is a list of validation errors; the segment builder
    has one place to put one sentence, and a refusal that names the bad key is
    the entire value of validating here at all.
    """
    if value is None:
        return None
    if isinstance(value, str):
        # db.py registers a jsonb codec but is allowed to give up behind
        # PgBouncer, in which case a stored filter comes back as text. Parsing
        # it here beats an AttributeError three frames down in the query builder.
        try:
            value = json.loads(value)
        except ValueError:
            raise HTTPException(400, "audience_filter must be an object.") from None
    if not isinstance(value, dict):
        raise HTTPException(400, "audience_filter must be an object.")

    out: dict = {}
    for raw_key, raw_val in value.items():
        key = _AUDIENCE_ALIASES.get(raw_key, raw_key)
        if key not in AUDIENCE_FILTER_KEYS:
            raise HTTPException(
                400,
                f"'{raw_key}' is not an audience filter. "
                f"Valid keys: {', '.join(AUDIENCE_FILTER_KEYS)}.",
            )

        # Absent and blank mean the same thing: do not filter on this. A form
        # that builds its payload lazily sends `{"type": ""}` for "Any type",
        # and refusing that would make the harmless case the loud one.
        if raw_val is None:
            continue
        if isinstance(raw_val, str) and not raw_val.strip():
            continue

        if key == "min_score":
            try:
                score = int(raw_val)
            except (TypeError, ValueError):
                raise HTTPException(400, _SCORE_REFUSAL) from None
            if not 0 <= score <= 100:
                raise HTTPException(400, _SCORE_REFUSAL)
            out[key] = score
            continue

        if not isinstance(raw_val, str):
            raise HTTPException(400, f"'{key}' must be text.")
        text = raw_val.strip()
        if key == "type" and text not in CONTACT_TYPES:
            raise HTTPException(
                400,
                f"'{text}' is not a contact type. "
                f"Valid types: {', '.join(CONTACT_TYPES)}.",
            )
        out[key] = text
    return out


def _audience_filter_validator(cls, v):
    """Shared by CampaignCreate, CampaignUpdate and the standalone preview, so
    the three cannot disagree about what a filter is allowed to say."""
    return normalise_audience_filter(v)


_TYPE_PLURALS = {
    "lead": "leads", "customer": "customers",
    "vendor": "vendors", "partner": "partners",
}


def _audience_summary(filters: dict) -> str:
    """The segment in words, built once on the server.

    The builder panel, the Segment column in the list and the send confirmation
    all describe the same audience. Composed separately they drift, and the one
    that drifts is the confirmation — the last thing anyone reads before a send.
    """
    if not filters:
        return "everyone in this organisation"

    subject = _TYPE_PLURALS.get(filters.get("type") or "", "contacts")
    phrases = []
    # The same presence test `_resolve_audience` uses, key for key. If the two
    # ever disagree about what counts as set, this sentence describes a different
    # audience from the one the query resolved — and it is the sentence, not the
    # query, that the operator reads last before pressing send.
    #
    # "with a lead score of 0 or more" is redundant on purpose. It IS every
    # contact; an operator who left the box at 0 is better told that the filter
    # is doing nothing than shown a sentence that quietly omits it.
    if filters.get("source") is not None:
        phrases.append(f"from “{filters['source']}”")
    if filters.get("company") is not None:
        phrases.append(f"whose company matches “{filters['company']}”")
    if filters.get("tag") is not None:
        phrases.append(f"tagged “{filters['tag']}”")
    if filters.get("min_score") is not None:
        phrases.append(f"with a lead score of {filters['min_score']} or more")

    if not phrases:
        return subject
    if len(phrases) == 1:
        return f"{subject} {phrases[0]}"
    return f"{subject} {', '.join(phrases[:-1])} and {phrases[-1]}"


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

    _check_audience = field_validator("audience_filter")(
        classmethod(_audience_filter_validator))


class CampaignUpdate(BaseModel):
    name: str | None = None
    template_id: str | None = None
    subject: str | None = None
    body_html: str | None = None
    channel: str | None = None
    audience_filter: dict | None = None
    scheduled_at: str | None = None

    _check_audience = field_validator("audience_filter")(
        classmethod(_audience_filter_validator))


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
    # `SELECT *` carries `total_opened`/`total_clicked`/`total_bounced`/
    # `total_unsubscribed`, which nothing in this product writes. On Unicode
    # Group those columns hold seed data. See `services/engagement_metrics.py`
    # — the redaction is here rather than on the screen so the fabricated
    # figures never leave the server.
    return {"data": redact_engagement_rows(dict(r) for r in rows)}


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
    return redact_engagement(row)


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
    return redact_engagement(row)


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
    return redact_engagement(row)


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

class AudiencePreview(BaseModel):
    audience_filter: dict = {}

    _check_audience = field_validator("audience_filter")(
        classmethod(_audience_filter_validator))


@router.get("/campaigns/{camp_id}/audience")
async def preview_audience(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `is_active=TRUE` to match get_campaign and send_campaign: a soft-deleted
    # campaign is one nobody can open or send, so previewing its audience
    # answers a question about a campaign that no longer exists.
    campaign = await pool.fetchrow(
        "SELECT audience_filter FROM staging.prachar_campaigns "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        camp_id, org_id,
    )
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    # Normalised here as well as on the way in, because this row may have been
    # written before anything validated it — a stored `"min_score": "50"` is
    # then a 400 naming the field rather than a DataError 500 naming nothing.
    filters = normalise_audience_filter(campaign["audience_filter"] or {}) or {}
    contacts = await _resolve_audience(pool, org_id, filters)
    return await _audience_preview_body(pool, org_id, filters, contacts)


@router.get("/audience/options")
async def audience_options(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """What the segment builder can offer, without going through Graha.

    `/v1/graha/contacts` sits behind `require_module("graha")`. A marketer whose
    org buys Prachar and not Graha gets a 403 from it — and that marketer is
    exactly who segmentation is for. Two DISTINCTs on this side of the gate are
    cheaper than a module grant nobody meant to give.
    """
    pool = await get_pool()
    sources = await pool.fetch(
        "SELECT DISTINCT source FROM staging.graha_contacts "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL "
        "AND source IS NOT NULL AND btrim(source) <> '' ORDER BY 1 LIMIT 200",
        org_id,
    )
    companies = await pool.fetch(
        "SELECT DISTINCT company FROM staging.graha_contacts "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL "
        "AND company IS NOT NULL AND btrim(company) <> '' ORDER BY 1 LIMIT 200",
        org_id,
    )
    return {
        # Always the four CHECK values in the migration's order, whatever this
        # org happens to hold today. A type with nobody in it is still a type
        # you can segment on tomorrow, and an option that appears and vanishes
        # with the data reads as a bug in the form.
        "types": list(CONTACT_TYPES),
        "sources": [r["source"] for r in sources],
        "companies": [r["company"] for r in companies],
    }


@router.post("/audience/preview")
async def preview_audience_filter(
    body: AudiencePreview,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Count a segment that has not been saved onto a campaign yet.

    `GET /campaigns/{id}/audience` needs a persisted campaign and takes no
    parameters, so a filter could not be counted until it was saved — which is
    backwards, because the count is what tells you whether to save it.

    Resolving through `_resolve_audience` rather than through a query of its own
    is the entire point of this endpoint's shape. A second resolver would drift
    from the one `/send` uses, and a preview that drifts from the send is a
    promise the product does not keep.
    """
    pool = await get_pool()
    filters = body.audience_filter or {}
    contacts = await _resolve_audience(pool, org_id, filters)
    return await _audience_preview_body(pool, org_id, filters, contacts)


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

    # A campaign whose channel is not email must NOT be sent by email.
    #
    # `prachar_campaigns.channel` CHECKs against ('email','sms','whatsapp') and
    # the live table holds 12 of each of the other two. This route read the
    # column, ignored it, and called `send_email` — so a WhatsApp campaign went
    # out as email, and not merely to the wrong medium: to a DIFFERENT AUDIENCE.
    # `_resolve_audience` filters `email IS NOT NULL AND email != ''` and the
    # suppression pass below then drops everyone who opted out of EMAIL, so the
    # people reached are "contacts with an email address who have not
    # unsubscribed from email" — a set with no necessary relationship to the
    # people a marketer chose a WhatsApp channel to reach, none of whom consented
    # to email. `routers/whatsapp.py` cannot deliver either: `send_wa_message`
    # writes the row 'pending' behind a `TODO: Call Meta Cloud API`.
    #
    # Refusing loses nothing that was working and stops mail nobody asked for.
    if (campaign["channel"] or "email") != "email":
        raise HTTPException(
            400,
            f"This campaign's channel is {campaign['channel']}, and Prachar can "
            f"only deliver email today. Sending it would email a different set "
            f"of people from the ones you chose this channel to reach. Change the "
            f"channel to email, or send it from the {campaign['channel']} module.",
        )

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
    org_name = await pool.fetchval(
        "SELECT name FROM staging.organisations WHERE id=$1::uuid", org_id) or ""

    async def _dispatch():
        sent_count = 0
        failed_count = 0
        suppressed_count = 0
        for c in eligible:
            contact_email = c["email"]
            # Simple variable substitution: {{name}}, {{email}}, {{company}}
            #
            # Escaped into the BODY, raw into the SUBJECT. A contact whose name
            # is `<img src=x onerror=…>` is third-party data landing inside HTML
            # the org authored, and it rendered live in the mail; an entity in a
            # subject line renders literally as "&amp;" in the inbox. Same split
            # as `services/skills/action/campaign_sender.py`, same reasons.
            rendered_body = body_html
            rendered_subj = subject
            for var_key in ("name", "email", "company"):
                placeholder = "{{" + var_key + "}}"
                val = str(c.get(var_key) or "")
                rendered_body = rendered_body.replace(placeholder, html.escape(val))
                rendered_subj = rendered_subj.replace(placeholder, val)

            # THE OPT-OUT. Marketing mail left this product with no way for a
            # recipient to stop it — see `services/prachar_unsubscribe.py` for
            # why that is a legal exposure and not a missing feature.
            rendered_body = _with_unsubscribe(rendered_body, org_id,
                                              contact_email, org_name)

            try:
                send_email(contact_email, rendered_subj, rendered_body,
                           purpose="prachar_campaign", ref=f"campaign:{campaign_id}")
                # `send_email` returns True on a SUPPRESSED message too — the
                # gate is doing what the operator asked — so the gate, not the
                # return value, decides what this row may claim. Same reasoning
                # and same shape as `campaign_sender.py`; see the long note
                # there for why 'failed' rather than a new status value.
                if outbound.DRY_RUN:
                    suppressed_count += 1
                    await pool.execute(
                        "UPDATE staging.prachar_campaign_contacts "
                        "SET status='failed', error_message=$3 "
                        "WHERE campaign_id=$1::uuid AND email=$2",
                        campaign_id, contact_email,
                        "suppressed: OUTBOUND_MODE is not live, so nothing left "
                        "the building. Nobody received this.",
                    )
                else:
                    sent_count += 1
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
        # Nothing left the building -> the campaign is not 'sent'. 'paused' is
        # the only value this CHECK allows that means "stopped by a switch, not
        # by an error", and `sent_at` stays NULL so the state is readable
        # without parsing a string.
        if suppressed_count and not sent_count:
            await pool.execute(
                "UPDATE staging.prachar_campaigns SET status='paused', "
                "total_recipients=$1, total_sent=0, updated_at=NOW() "
                "WHERE id=$2::uuid",
                suppressed_count, campaign_id,
            )
        else:
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


@router.post("/campaigns/{camp_id}/schedule")
async def schedule_campaign(
    camp_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Commit a campaign to send at its `scheduled_at`. The only way into that state.

    NOTHING IN THE PRODUCT WROTE `status = 'scheduled'`. `create_campaign` and
    `update_campaign` both store `scheduled_at` and leave the status at 'draft',
    and the cron that sends scheduled campaigns selects on the status — so the
    calendar screen could place a campaign on a date and no date would ever
    arrive. Measured on the live database: 0 campaigns in 'scheduled', and 0
    holding a `scheduled_at` at all.

    An explicit act rather than a side effect of setting the date, and that is
    the whole safety argument for the cron's `WHERE status = 'scheduled'`. There
    are 89 drafts on the live database. Had the sender keyed on `scheduled_at <=
    now()` regardless of status — or had setting a date implied scheduling — the
    first tick would have mailed every one of them to an audience nobody
    approved. A draft has to stay a draft until somebody says otherwise.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT status, scheduled_at, channel, subject, body_html, template_id "
        "FROM staging.prachar_campaigns "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        camp_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Campaign not found")
    if row["status"] != "draft":
        raise HTTPException(400, f"Campaign status is '{row['status']}', only a draft can be scheduled")
    if not row["scheduled_at"]:
        raise HTTPException(400, "Set a date and time on this campaign before scheduling it")
    # Refused here as well as at send time. A campaign the sender will refuse
    # should not be allowed to sit on the calendar looking as though it will go.
    if (row["channel"] or "email") != "email":
        raise HTTPException(
            400,
            f"This campaign's channel is {row['channel']}, and Prachar can only "
            f"deliver email today.",
        )
    if not (row["subject"] and row["body_html"]) and not row["template_id"]:
        raise HTTPException(400, "Campaign has no subject or body content")

    await pool.execute(
        "UPDATE staging.prachar_campaigns SET status='scheduled', updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        camp_id, org_id,
    )
    return {"ok": True, "status": "scheduled", "scheduled_at": row["scheduled_at"]}


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
    # `opened`, `clicked` and `bounced` count statuses nothing ever writes —
    # the column only ever holds 'pending', 'sent' or 'failed'. They are 0 for
    # every campaign that has ever existed, and "Opened 0 — 0%" next to a real
    # "Sent 7" reads as a measured result. Same missing receiver, same switch:
    # see `services/engagement_metrics.py`.
    return redact_contact_stats(stats) if stats else {}


# ── Automations CRUD ─────────────────────────────────────────
#
# THERE IS NO ENGINE BEHIND THIS TABLE, AND THERE NEVER HAS BEEN.
#
# `staging.prachar_automations` stores a `trigger_type` and an `action_type`,
# and the seven trigger names the form offers —
#
#     contact_created  contact_converted  deal_won  deal_lost
#     label_added      score_above        manual
#
# — appear NOWHERE ELSE in the backend. Not in a dispatcher, not in a call site,
# not in a constant. Every reference to this table is one of the five CRUD
# statements below. A row created here is read back by the list endpoint and by
# nothing else, for ever, with `run_count` frozen at 0.
#
# WHERE THIS PARAGRAPH USED TO SEND PEOPLE, AND WHY IT NO LONGER CAN.
#
# It used to say Graha's automations "really do fire", naming
# `routers/graha.py:fire_automations` as a working engine, and the 501 above
# told the user to go and use it. N1 (`257d8bd6`) DELETED that engine — both
# copies of `fire_automations`, and the inline CRM one with them. So for the
# time in between, a refusal whose whole purpose was honesty was directing
# people to something that no longer existed. A message that names a
# destination has to be re-read whenever a destination is removed.
#
# The engine that fires today is NIYAM, at `/settings/automations`
# (`services/niyam/`), and it takes a deliberately small vocabulary: it emits
# `task.created` and `task.status_changed` from six write paths in `server.py`,
# plus four temporal predicates. NONE of the seven trigger names above is among
# them — so this table still cannot be pointed at it, for the same reason as
# before. Six of these seven are CRM events, and Niyam's own CRM triggers
# (`contact.created`, `deal.stage_changed`) are declared in its registry with no
# emitter behind them yet either. Real cross-module work, and still a product
# decision.
#
# WHY CREATE IS REFUSED RATHER THAN LEFT ALONE. The tab is unmounted (see
# `frontend/src/pages/PracharPage.jsx`), and unmounting a tab closes the door a
# person walks through — not the one an app, a script or a returning tab walks
# through. `staging.prachar_automations` holds 0 rows in the product's entire
# life, measured 6 August 2026, so refusing now costs nobody anything and means
# the count stays 0 rather than becoming a set of rows somebody believes are
# running. 501 and not 400: the request is well formed and the server is the
# thing that is missing, which is exactly what 501 means, and it is the status a
# client can tell apart from "you sent me nonsense".
#
# LIST, PATCH AND DELETE ARE DELIBERATELY LEFT OPEN. If a row does exist —
# written before this, or by a path nobody has found — it must still be
# readable, pausable and removable. Sealing the exit as well as the entrance is
# how dead rows become permanent.

_NO_AUTOMATION_ENGINE = (
    "Prachar automations cannot be created: nothing in the product fires them. "
    "No trigger in this module is wired to an engine, so an automation saved "
    "here would never run. Use Settings -> Automations, which does fire."
)


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
    # `engine` says what the `run_count` column cannot: a 0 there looks like
    # "hasn't fired yet", and the truth is "cannot fire". Anything that lists
    # these rows should be able to say so without having to know this file.
    return {"data": [dict(r) for r in rows], "engine": None,
            "note": _NO_AUTOMATION_ENGINE}


@router.post("/automations")
async def create_automation(
    body: AutomationCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    # See the block comment above this section. The INSERT this replaced is in
    # the history and its columns are still described by `AutomationCreate`
    # above, so nothing has to be re-derived the day an engine exists — but
    # unreachable code left sitting under a `raise` is how the next reader
    # concludes the endpoint works.
    raise HTTPException(501, _NO_AUTOMATION_ENGINE)


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


def _with_unsubscribe(body: str, org_id: str, email: str, org_name: str) -> str:
    """Attach the opt-out footer to one outgoing marketing message.

    Never raises. Marketing mail with no unsubscribe link is a legal exposure;
    marketing mail that does not go out because a key is unset is an outage, and
    trading the second for the first would be the wrong way round. The branch is
    close to unreachable — `mint` fails only when neither FIELD_ENCRYPTION_KEY
    nor JWT_SECRET is set, and `server.py` will not boot without JWT_SECRET — so
    it is logged at ERROR rather than swallowed.
    """
    from services import prachar_unsubscribe as unsub

    try:
        token = unsub.mint(org_id, email)
        return unsub.append_footer(
            body, unsub.link(os.getenv("BACKEND_URL", ""), token), org_name or "")
    except Exception:                                       # noqa: BLE001
        logger.error("Could not build an unsubscribe link — the campaign mail is "
                     "going out WITHOUT one.", exc_info=True)
        return body


#: What a recipient sees after clicking. Deliberately a whole page from the API
#: rather than a redirect into the SPA: someone who has just asked a company to
#: stop mailing them should be told it worked, immediately, without booting a
#: JavaScript application to find out.
_UNSUB_PAGE = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<meta name="robots" content="noindex,nofollow">'
    '<title>{title}</title></head>'
    '<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;'
    'background:#f9fafb;color:#111827;">'
    '<div style="max-width:34rem;margin:12vh auto;padding:2rem;background:#fff;'
    'border:1px solid #e5e7eb;border-radius:12px;">'
    '<h1 style="margin:0 0 .75rem;font-size:1.25rem;">{title}</h1>'
    '<p style="margin:0;line-height:1.6;color:#4b5563;">{message}</p>'
    '</div></body></html>'
)


def _unsub_page(title: str, message: str, status: int) -> HTMLResponse:
    return HTMLResponse(
        _UNSUB_PAGE.format(title=html.escape(title), message=html.escape(message)),
        status_code=status,
    )


@router.get("/unsubscribe", include_in_schema=False)
async def public_unsubscribe(token: str = Query("")):
    """Opt a recipient out. NO AUTHENTICATION, ON PURPOSE.

    This is the endpoint the link in every marketing email points at, and it is
    the thing this module was missing entirely: `POST /prachar/unsubscribes`
    sits behind `require_user`, `get_org_id` and `require_module("prachar")`, so
    the only person who could opt somebody out was an employee of the firm doing
    the mailing. The recipient could not.

    Requiring auth here is not an option and not a hardening opportunity. The
    recipient is a CRM contact, not a user of this product; they have no account
    and never will. CAN-SPAM §7704(a)(3) and DPDP §6(4)-(6) both require the
    mechanism to be usable BY THE RECIPIENT, and a login wall is the canonical
    way to fail that test.

    The token is what carries the authority, and it can do exactly one thing:
    add one address to one org's suppression list. It cannot read a record, name
    a different org, or be extended to — see the closing note in
    `services/prachar_unsubscribe.py`.

    GET rather than POST even though it writes. Mail clients and corporate link
    scanners issue GETs and nothing else, so a POST-only opt-out is an opt-out
    that does not work from an inbox. The write is idempotent (`ON CONFLICT DO
    NOTHING`), which is what makes that safe: a scanner pre-fetching the link
    unsubscribes someone who was going to unsubscribe anyway, and a second click
    changes nothing.

    Every outcome returns HTML, including the refusals. A recipient who lands on
    a JSON error body has been told nothing they can act on.
    """
    parsed = None
    if token:
        from services import prachar_unsubscribe as unsub
        parsed = unsub.read(token)

    if not parsed:
        # One message for every way a token can be bad. Which way it was bad is
        # information about our key and our format, and the person holding it
        # cannot act on the difference anyway.
        return _unsub_page(
            "This link is not valid",
            "We could not read this unsubscribe link. It may have been broken by "
            "your email program. Please reply to the message you received and ask "
            "to be removed, and the sender will action it.",
            400,
        )

    org_id, email = parsed
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO staging.prachar_unsubscribes (org_id, email, reason) "
        "VALUES ($1::uuid, $2, 'link') ON CONFLICT (org_id, email) DO NOTHING",
        org_id, email,
    )

    # Every ACTIVE drip enrolment for this person, in this org, stops now.
    #
    # Without this the suppression list is honoured only at the moment a step
    # comes due, which is correct but slow to be visible: the Enrolled table
    # would keep showing them 'active' with a next-message date until that date
    # arrived. Someone who has just opted out should not still be queued.
    await pool.execute(
        """
        UPDATE staging.prachar_sequence_enrollments e
        SET status = 'unsubscribed', completed_at = NOW(), next_step_at = NULL
        FROM staging.prachar_sequences s, staging.graha_contacts c
        WHERE s.id = e.sequence_id AND c.id = e.contact_id
          AND s.org_id = $1::uuid AND lower(c.email) = $2
          AND e.status = 'active'
        """,
        org_id, email.lower(),
    )

    logger.info("Prachar: %s unsubscribed via link (org %s)", email, org_id)
    return _unsub_page(
        "You have been unsubscribed",
        f"{email} will not receive further marketing email from this sender. "
        "You may still receive messages about things you have asked for directly, "
        "such as invoices or account notices.",
        200,
    )


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

    # The delivery funnel. `total_recipients` is the one figure here anything
    # writes; the other three are summed only so the response keeps its shape
    # for a client that still reads them, and `redact_engagement` below replaces
    # them with null. Summing then discarding is one query rather than two
    # branches, and the branch is the thing that rots — a future edit that drops
    # the redaction would otherwise reintroduce the seeded numbers silently
    # rather than failing a test.
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
        "delivery": redact_engagement(delivery) if delivery else {},
        "templates_count": templates or 0,
        "automations_count": automations or 0,
        "unsubscribes_count": unsubs or 0,
        "recent_campaigns": redact_engagement_rows(dict(r) for r in recent),
        # Said once at the top level as well as per-row, because the KPI strip
        # reads `delivery` and the funnel reads it again — one flag both can
        # test without either inferring it from a null.
        "engagement_measured": engagement_is_measured(),
        "engagement_note": None if engagement_is_measured() else UNMEASURED_REASON,
    }


# ── Helpers ──────────────────────────────────────────────────

async def _resolve_audience(pool, org_id: str, filters: dict) -> list[dict]:
    """Who a campaign goes to.

    Two column names here were invented rather than looked up, and because this
    helper is the FIRST thing both `/audience` and `/send` do, the whole email
    side of the module was dead from the day it was written:

        type    → the column is `contact_type` (`type` is what the API returns)
        labels  → the column is `tags`

    `SELECT … type …` raised UndefinedColumnError before any row was read, so
    the audience preview 500'd and every send 500'd with it. Nothing was ever
    delivered and no campaign could leave 'draft'. Aliasing `contact_type AS
    type` keeps the response shape the UI already reads.

    Two later corrections, both of which widened an audience silently:

    `merged_into_id IS NULL` — a merged duplicate is a tombstone kept for the
    undo path (migration 024). It still holds the losing record's email, so
    without this the same person received the campaign twice, once under a name
    the CRM no longer shows anyone.

    `ESCAPE` on the company match — `%` and `_` are ILIKE wildcards. A marketer
    typing "100%" into the company box was asking for one company and getting
    `company ILIKE '%100%%'`, which is every company in the org. The preview
    then reported the larger number as though it were the segment, so the
    widening confirmed itself.
    """
    filters = normalise_audience_filter(filters) or {}

    q = ("SELECT id, name, email, contact_type AS type, company "
         "FROM staging.graha_contacts "
         "WHERE org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL "
         "AND email IS NOT NULL AND email != ''")
    params: list = [org_id]

    # PRESENCE, NOT TRUTH — and the identical test on all five keys, because
    # `_audience_summary` reads the same dict and the sentence has to describe
    # the query that ran.
    #
    # `if filters.get("min_score")` dropped a stored `0`. `lead_score` is
    # CHECK (0..100) (migration 019), so "at least 0" is every contact, which is
    # exactly what an operator who typed 0 asked for — and the normaliser keeps
    # the 0, so the builder rendered it as an active filter (_shared.jsx:214
    # tests `!= null`) while this function added NO CLAUSE AT ALL. A filter that
    # is stored, shown, and never applied is the same defect as the ignored key
    # AUDIENCE_FILTER_KEYS exists to refuse: the operator believes the audience
    # is narrowed and it is not.
    #
    # The other four keys were never broken, and the reason is worth writing
    # down because it lives in another function rather than here:
    # `normalise_audience_filter` drops None and blank strings before storage
    # and refuses a non-string, so a stored `type`, `source`, `tag` or `company`
    # is always a NON-EMPTY string — and every non-empty string is truthy,
    # including "0". Truthiness and presence were the same test for those four
    # only by that guarantee. `is not None` does not borrow it, so a normaliser
    # that one day stops dropping blanks, or a sixth key that is numeric, cannot
    # reintroduce this.
    #
    # Presence is also the safe direction if a blank ever did reach here: a
    # predicate bound to '' matches nobody, and /send refuses an empty audience
    # out loud, whereas a dropped predicate quietly mails the whole org.
    if filters.get("type") is not None:
        params.append(filters["type"])
        q += f" AND contact_type=${len(params)}"
    if filters.get("source") is not None:
        params.append(filters["source"])
        q += f" AND source=${len(params)}"
    if filters.get("tag") is not None:
        params.append(filters["tag"])
        q += f" AND ${len(params)} = ANY(tags)"
    if filters.get("min_score") is not None:
        params.append(filters["min_score"])
        # Deliberately NOT COALESCE(lead_score, 0). The column is nullable
        # (019 adds it `INTEGER DEFAULT 0`, no NOT NULL), so `>= 0` would drop a
        # NULL-scored contact — but no write path in this repo can produce one:
        # every INSERT omits the column and takes the default, update_contact
        # filters `v is not None` out of its updates, and compute_lead_score and
        # the dedupe merge both bind an int. A COALESCE guarding an unreachable
        # state would also cost the clause its shape, and that shape is what
        # tests/test_audience_filter.py reads to execute this query against
        # in-memory rows.
        q += f" AND lead_score >= ${len(params)}"
    if filters.get("company") is not None:
        params.append(f"%{_like_escape(filters['company'])}%")
        q += f" AND company ILIKE ${len(params)} ESCAPE '\\'"

    q += " ORDER BY name"
    rows = await pool.fetch(q, *params)
    return [dict(r) for r in rows]


def _like_escape(text: str) -> str:
    """Make a user's text mean itself inside ILIKE.

    The backslash has to go first: escaping the wildcards first would then
    double the backslashes this step just introduced.
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _audience_preview_body(pool, org_id: str, filters: dict,
                                 contacts: list[dict]) -> dict:
    """The one preview shape, for the saved campaign and the unsaved filter.

    A bare count is not something you can send on. "128 contacts" reads as 128
    emails, but twelve of those people have unsubscribed and `/send` drops them
    without saying so — so the number the operator approved and the number the
    product delivered differ by twelve, every time, invisibly.

    The suppression list is read exactly the way `/send` reads it, so preview
    and send cannot disagree about who is excluded. It is read HERE rather than
    inside `_resolve_audience` because the send path already makes that pass
    itself; putting it in the resolver would buy the send a second round trip
    per campaign for an answer it is about to compute anyway.
    """
    unsubs = await pool.fetch(
        "SELECT email FROM staging.prachar_unsubscribes WHERE org_id=$1::uuid", org_id
    )
    unsub_set = {r["email"].lower() for r in unsubs if r["email"]}
    eligible = [c for c in contacts if c["email"] and c["email"].lower() not in unsub_set]
    matched = len(contacts)

    return {
        # Retained, unchanged, and equal to `matched`. The confirm dialog and
        # campaign-send.spec.ts both read `count`, and it has always meant
        # "matched, before suppression".
        "count": matched,
        "matched": matched,
        "unsubscribed": matched - len(eligible),
        "will_receive": len(eligible),
        # The sample is who will RECEIVE, not who matched. To the person reading
        # the panel, an unsubscribed address listed in an audience is the same
        # defect as an unsubscribed address receiving mail.
        "contacts": eligible[:50],
        "truncated": matched > 50,
        "filter": filters,
        "summary": _audience_summary(filters),
    }


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
        "SELECT e.*, c.name AS contact_name, c.email AS contact_email, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.prachar_sequence_enrollments e "
        "JOIN staging.graha_contacts c ON c.id = e.contact_id "
        "WHERE e.sequence_id=$1::uuid ORDER BY e.enrolled_at DESC LIMIT 100",
        seq_id,
    )
    # F4 (b). A capped list nested inside a detail response, so it cannot BE the
    # `_listed` envelope without changing the shape `SequencesTab.jsx:453` maps
    # over. The same three facts ride alongside instead, under prefixed names.
    #
    # It is worth reporting even though it is not a page of its own: a sequence
    # with more than 100 enrolled contacts silently showed 100, and "how many
    # people are in this sequence" is the question the panel exists to answer.
    enrolled_total = int(dict(enrollments[0]).get("_total", len(enrollments))) if enrollments else 0
    rows = []
    for e in enrollments:
        d = dict(e)
        d.pop("_total", None)
        rows.append(d)
    return {
        "sequence": dict(seq),
        "steps": [dict(s) for s in steps],
        "enrollments": rows,
        "enrollments_total": enrolled_total,
        "enrollments_limit": 100,
        "enrollments_truncated": enrolled_total > 100,
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
        "SELECT step_order, delay_days FROM staging.prachar_sequence_steps "
        "WHERE sequence_id=$1::uuid ORDER BY step_order LIMIT 1",
        seq_id,
    )
    # `current_step` is the step_order the contact is WAITING FOR — see
    # `services/prachar_sequencing.py`, which states that meaning once for
    # everything that reads the column.
    #
    # It was hardcoded to 1. `step_order` is only UNIQUE per sequence, not
    # required to start at 1 (migration 027), so a sequence whose steps are
    # numbered 3, 4, 5 enrolled everyone "waiting for step 1" and the Enrolled
    # table said Step 1 for a step that does not exist. The planner tolerates
    # that — a `current_step` below the first position starts at the first
    # position — but the column should not have to be tolerated, and the number
    # on the screen should be a step somebody can point at.
    #
    # `delay_days` is NULLable with a DDL default of 1; `or 1` would also swallow
    # a deliberate 0, so the fallback tests for None.
    first_order = first_step["step_order"] if first_step else 1
    delay = (first_step["delay_days"] if first_step
             and first_step["delay_days"] is not None else 1)

    # The SEQUENCE was checked against the org; the CONTACTS were not.
    # `prachar_sequence_enrollments.org_id` is NULLABLE and was never written, so
    # the table carried no usable tenant column at all, and the ids came straight
    # from the request body into the insert — so any contact id from any org
    # could be enrolled into this org's sequence, and the sequence engine would
    # then send that org's marketing email to another tenant's contacts.
    #
    # Filtering to the caller's own contacts is what scopes this table: nothing
    # downstream can re-derive the boundary once a foreign id is stored, so the
    # guarantee has to be established here, at the only point where an id from
    # outside enters. The org is now also written onto the row (below), which is
    # a record of that decision rather than a second enforcement of it.
    if not body.contact_ids:
        return {"enrolled": 0, "rejected": 0,
                "sequence_status": seq["status"],
                "will_send": seq["status"] == "active"}

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
            # `org_id` was omitted, and the column is nullable, so every
            # enrolment row in the live table holds NULL. That was not cosmetic:
            # the sequence executor read `se.org_id` and handed it to the
            # unsubscribe check, making it `WHERE org_id = NULL`, which matches
            # nothing — an opted-out contact would have been mailed anyway. The
            # executor now takes the org from the sequence (NOT NULL) so it does
            # not depend on this, but the column should stop lying.
            "INSERT INTO staging.prachar_sequence_enrollments "
            "(sequence_id, contact_id, current_step, next_step_at, org_id) "
            "VALUES ($1::uuid, $2::uuid, $4, NOW() + ($3 || ' days')::interval, $5::uuid) "
            "ON CONFLICT (sequence_id, contact_id) DO NOTHING RETURNING id",
            seq_id, cid, str(delay), first_order, org_id,
        )
        if row:
            enrolled += 1

    # What the toast could not say before, because nothing downstream existed to
    # make it false: enrolling into a sequence that is not ACTIVE schedules
    # nothing. This route does not check the sequence's status — you can enrol
    # into a draft — and both the cron query and the executor refuse to send for
    # a non-active sequence, correctly. Saying so here is what stops "20 contacts
    # enrolled" from being read as "20 people will be emailed".
    return {"enrolled": enrolled, "rejected": rejected,
            "sequence_status": seq["status"],
            "will_send": seq["status"] == "active"}


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
        # `status='sent'`, not COUNT(*). This counted EVERY log row, and the
        # executor writes a row for steps it passed over as well as ones it
        # delivered — a contact with no email address, or a step on a
        # non-sendable channel. So a sequence aimed at a list with no addresses
        # reported a full send. The executor now records what actually happened;
        # this is the other half, and without it the fix there changes nothing
        # a user can see.
        "(SELECT COUNT(*) FROM staging.prachar_sequence_logs l "
        "  WHERE l.step_id=st.id AND l.status='sent') AS total_sent, "
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
