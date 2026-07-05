# Marketing Module — Implementation Guide

> **Target**: Q4 2026 | **Dependencies**: Core Platform, CRM Module (contacts), WhatsApp Module (broadcasts)
> **Stack**: FastAPI, Supabase PostgreSQL, React 19, AWS SES, MSG91
> **Branch**: `feature/marketing-module`
> **Add-on Price**: ₹39/user/mo | **Requires**: CRM

---

## 1. Module Overview

Full digital marketing engine for Indian SMBs: multi-channel campaigns (email, SMS, WhatsApp), landing page builder, web form capture, contact segmentation, social media link tracking, campaign analytics, and referral programs.

### Channels

| Channel | Provider | Cost Model |
|---------|----------|------------|
| Email | AWS SES (already in stack) | ~₹0.07/email (≈$0.0001/email) |
| SMS | MSG91 | ₹0.15–0.25/SMS (transactional/promotional) |
| WhatsApp | Meta Business API (via WhatsApp module) | ₹0.50–0.85/conversation |
| Landing Pages | Self-hosted (Vercel) | Free (included) |
| Web Forms | Self-hosted | Free (included) |

---

## 2. Database Migration

Create `backend/migrations/016_marketing_module.sql`:

```sql
-- ============================================================
-- Migration 016: Marketing Module
-- Multi-channel campaigns, landing pages, forms, segmentation
-- ============================================================

-- 1. Contact Segments (dynamic groups based on filters)
CREATE TABLE mkt_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    filter_rules JSONB NOT NULL DEFAULT '[]',
    -- [{field: "industry", operator: "eq", value: "IT"},
    --  {field: "source", operator: "in", value: ["indiamart","justdial"]},
    --  {field: "last_activity_days", operator: "gte", value: 30}]
    is_dynamic BOOLEAN DEFAULT TRUE,     -- recalculate on query vs static list
    static_contact_ids UUID[] DEFAULT '{}',  -- for static segments
    contact_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_segments_org ON mkt_segments(org_id);

-- 2. Campaigns
CREATE TABLE mkt_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('email', 'sms', 'whatsapp', 'multi_channel')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled')),
    
    -- Targeting
    segment_id UUID REFERENCES mkt_segments(id),
    recipient_count INTEGER DEFAULT 0,
    
    -- Content
    subject TEXT,                         -- email subject / SMS header
    body_html TEXT,                       -- email HTML body
    body_text TEXT,                       -- SMS / plain text fallback
    whatsapp_template_id UUID,           -- references whatsapp module template
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Settings
    from_name TEXT,
    from_email TEXT,                      -- verified SES sender
    reply_to TEXT,
    msg91_sender_id VARCHAR(6),          -- 6-char sender ID for SMS
    
    -- UTM tracking
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_campaigns_org ON mkt_campaigns(org_id);
CREATE INDEX idx_mkt_campaigns_status ON mkt_campaigns(org_id, status);

-- 3. Campaign Messages (individual sends)
CREATE TABLE mkt_campaign_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES mkt_campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES crm_contacts(id),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
    
    -- Delivery
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed')),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    
    -- Channel-specific refs
    ses_message_id TEXT,                 -- AWS SES message ID
    msg91_request_id TEXT,               -- MSG91 request ID
    
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_cm_campaign ON mkt_campaign_messages(campaign_id);
CREATE INDEX idx_mkt_cm_contact ON mkt_campaign_messages(contact_id);
CREATE INDEX idx_mkt_cm_status ON mkt_campaign_messages(campaign_id, status);

-- 4. Email Templates
CREATE TABLE mkt_email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    category TEXT DEFAULT 'general'
        CHECK (category IN ('general', 'newsletter', 'promotional', 'transactional', 'welcome', 'follow_up')),
    thumbnail_url TEXT,                  -- preview image in R2
    variables JSONB DEFAULT '[]',        -- [{name: "first_name", default: "there"}]
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_templates_org ON mkt_email_templates(org_id);

-- 5. Landing Pages
CREATE TABLE mkt_landing_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,                   -- URL path: /lp/{slug}
    html_content TEXT NOT NULL,           -- full page HTML
    css_content TEXT,
    meta_title TEXT,
    meta_description TEXT,
    og_image_url TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    form_id UUID,                        -- linked web form
    visit_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_mkt_lp_slug ON mkt_landing_pages(org_id, slug);

-- 6. Web Forms (lead capture)
CREATE TABLE mkt_web_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fields JSONB NOT NULL DEFAULT '[]',
    -- [{name: "full_name", type: "text", required: true, label: "Full Name"},
    --  {name: "email", type: "email", required: true},
    --  {name: "phone", type: "tel", required: false},
    --  {name: "company", type: "text", required: false},
    --  {name: "message", type: "textarea", required: false}]
    
    -- On submit actions
    on_submit_action TEXT DEFAULT 'create_lead'
        CHECK (on_submit_action IN ('create_lead', 'create_contact', 'notify_only')),
    assign_to UUID REFERENCES users(id),         -- auto-assign lead
    pipeline_id UUID REFERENCES crm_pipelines(id), -- auto-place in pipeline
    notify_emails TEXT[],                         -- email notifications on submit
    
    -- Appearance
    submit_button_text TEXT DEFAULT 'Submit',
    success_message TEXT DEFAULT 'Thank you! We will get back to you soon.',
    redirect_url TEXT,
    
    -- Embed
    embed_code TEXT,                     -- auto-generated iframe/script snippet
    
    submission_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_forms_org ON mkt_web_forms(org_id);

-- 7. Form Submissions
CREATE TABLE mkt_form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    form_id UUID NOT NULL REFERENCES mkt_web_forms(id) ON DELETE CASCADE,
    data JSONB NOT NULL,                 -- submitted field values
    source_url TEXT,                     -- page where form was embedded
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    ip_address INET,
    user_agent TEXT,
    
    -- Processing
    processed BOOLEAN DEFAULT FALSE,
    contact_id UUID REFERENCES crm_contacts(id),  -- created contact
    lead_id UUID REFERENCES crm_leads(id),         -- created lead
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_submissions_form ON mkt_form_submissions(form_id);
CREATE INDEX idx_mkt_submissions_unprocessed ON mkt_form_submissions(processed) WHERE processed = FALSE;

-- 8. Link Tracking (UTM + click tracking)
CREATE TABLE mkt_tracked_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES mkt_campaigns(id),
    original_url TEXT NOT NULL,
    short_code VARCHAR(12) NOT NULL,     -- /t/{short_code}
    click_count INTEGER DEFAULT 0,
    unique_click_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_mkt_links_code ON mkt_tracked_links(short_code);

-- 9. Link Clicks
CREATE TABLE mkt_link_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID NOT NULL REFERENCES mkt_tracked_links(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES crm_contacts(id),
    ip_address INET,
    user_agent TEXT,
    referer TEXT,
    clicked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_clicks_link ON mkt_link_clicks(link_id);

-- 10. Unsubscribes
CREATE TABLE mkt_unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES crm_contacts(id),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'all')),
    reason TEXT,
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, contact_id, channel)
);

CREATE INDEX idx_mkt_unsub_org ON mkt_unsubscribes(org_id, channel);

-- 11. Social Media Link Tracking
CREATE TABLE mkt_social_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'google_ads', 'other')),
    campaign_name TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    short_code VARCHAR(12) NOT NULL,
    click_count INTEGER DEFAULT 0,
    lead_count INTEGER DEFAULT 0,        -- conversions from this link
    spend DECIMAL(10,2) DEFAULT 0,       -- ad spend (manual input)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_mkt_social_code ON mkt_social_links(short_code);
CREATE INDEX idx_mkt_social_org ON mkt_social_links(org_id);

-- 12. Referral Program
CREATE TABLE mkt_referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES crm_contacts(id),  -- referrer
    code VARCHAR(20) NOT NULL,
    reward_type TEXT DEFAULT 'discount_pct'
        CHECK (reward_type IN ('discount_pct', 'discount_flat', 'credit', 'custom')),
    reward_value DECIMAL(10,2) DEFAULT 10,  -- e.g., 10% discount
    max_uses INTEGER,
    use_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_mkt_ref_code ON mkt_referral_codes(code);
CREATE INDEX idx_mkt_ref_org ON mkt_referral_codes(org_id);

CREATE TABLE mkt_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    referral_code_id UUID NOT NULL REFERENCES mkt_referral_codes(id),
    referred_contact_id UUID REFERENCES crm_contacts(id),
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'converted', 'rewarded', 'expired')),
    converted_at TIMESTAMPTZ,
    reward_given_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mkt_referrals_code ON mkt_referrals(referral_code_id);

-- 13. Campaign Analytics (materialized daily)
CREATE TABLE mkt_campaign_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES mkt_campaigns(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    channel TEXT NOT NULL,
    sent INTEGER DEFAULT 0,
    delivered INTEGER DEFAULT 0,
    opened INTEGER DEFAULT 0,
    clicked INTEGER DEFAULT 0,
    bounced INTEGER DEFAULT 0,
    unsubscribed INTEGER DEFAULT 0,
    UNIQUE(campaign_id, date, channel)
);

CREATE INDEX idx_mkt_stats_campaign ON mkt_campaign_stats(campaign_id);

-- 14. RLS
ALTER TABLE mkt_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_campaign_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_web_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_tracked_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_link_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_social_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_campaign_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY mkt_segments_org ON mkt_segments USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_campaigns_org ON mkt_campaigns USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_cm_org ON mkt_campaign_messages USING (
    campaign_id IN (SELECT id FROM mkt_campaigns WHERE org_id = current_setting('app.current_org_id')::uuid)
);
CREATE POLICY mkt_templates_org ON mkt_email_templates USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_lp_org ON mkt_landing_pages USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_forms_org ON mkt_web_forms USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_submissions_org ON mkt_form_submissions USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_links_org ON mkt_tracked_links USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_clicks_org ON mkt_link_clicks USING (
    link_id IN (SELECT id FROM mkt_tracked_links WHERE org_id = current_setting('app.current_org_id')::uuid)
);
CREATE POLICY mkt_unsub_org ON mkt_unsubscribes USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_social_org ON mkt_social_links USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_ref_codes_org ON mkt_referral_codes USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_referrals_org ON mkt_referrals USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mkt_stats_org ON mkt_campaign_stats USING (
    campaign_id IN (SELECT id FROM mkt_campaigns WHERE org_id = current_setting('app.current_org_id')::uuid)
);
```

---

## 3. Backend — FastAPI Router

Create `backend/routers/marketing.py`:

```python
"""
Marketing Router
Campaigns (email/SMS/WhatsApp), segments, landing pages, forms, link tracking, referrals
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Optional
from uuid import UUID, uuid4
from datetime import date, datetime
from pydantic import BaseModel
from ..dependencies import get_current_user, get_db
from ..middleware.subscription import require_module
from ..services.email_service import send_campaign_emails
from ..services.sms_service import send_campaign_sms

router = APIRouter(
    prefix="/api/v1/marketing",
    tags=["Marketing"],
    dependencies=[Depends(require_module("marketing"))]
)


# ── Pydantic Models ──────────────────────────────────────────

class SegmentCreate(BaseModel):
    name: str
    description: str = ""
    filter_rules: list[dict] = []
    is_dynamic: bool = True

class CampaignCreate(BaseModel):
    name: str
    type: str                            # email, sms, whatsapp, multi_channel
    segment_id: UUID = None
    subject: str = ""
    body_html: str = ""
    body_text: str = ""
    from_name: str = ""
    from_email: str = ""
    utm_source: str = ""
    utm_medium: str = ""
    utm_campaign: str = ""

class LandingPageCreate(BaseModel):
    title: str
    slug: str
    html_content: str
    css_content: str = ""
    meta_title: str = ""
    meta_description: str = ""
    form_id: UUID = None

class WebFormCreate(BaseModel):
    name: str
    fields: list[dict]
    on_submit_action: str = "create_lead"
    assign_to: UUID = None
    pipeline_id: UUID = None
    notify_emails: list[str] = []
    submit_button_text: str = "Submit"
    success_message: str = "Thank you! We will get back to you soon."

class SocialLinkCreate(BaseModel):
    platform: str
    campaign_name: str
    destination_url: str
    spend: float = 0

class ReferralCodeCreate(BaseModel):
    contact_id: UUID
    reward_type: str = "discount_pct"
    reward_value: float = 10
    max_uses: int = None


# ── Segments ─────────────────────────────────────────────────

@router.get("/segments")
async def list_segments(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("mkt_segments").select("*").eq("org_id", str(user.org_id)).order("name").execute().data

@router.post("/segments")
async def create_segment(body: SegmentCreate, user=Depends(get_current_user), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id), "created_by": str(user.id)}
    return db.table("mkt_segments").insert(data).execute().data[0]

@router.get("/segments/{segment_id}/contacts")
async def get_segment_contacts(segment_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    """Resolve segment to actual contacts based on filter rules."""
    segment = db.table("mkt_segments").select("*").eq("id", str(segment_id)).eq("org_id", str(user.org_id)).single().execute()
    if not segment.data:
        raise HTTPException(404, "Segment not found")
    
    if not segment.data["is_dynamic"]:
        # Static segment — return stored contact IDs
        return db.table("crm_contacts").select("id, first_name, last_name, email, phone").in_("id", segment.data["static_contact_ids"]).execute().data
    
    # Dynamic: build query from filter_rules
    query = db.table("crm_contacts").select("id, first_name, last_name, email, phone, whatsapp_number").eq("org_id", str(user.org_id)).eq("is_active", True)
    
    for rule in segment.data["filter_rules"]:
        field = rule["field"]
        op = rule["operator"]
        val = rule["value"]
        if op == "eq":
            query = query.eq(field, val)
        elif op == "neq":
            query = query.neq(field, val)
        elif op == "in":
            query = query.in_(field, val)
        elif op == "ilike":
            query = query.ilike(field, f"%{val}%")
    
    contacts = query.execute()
    
    # Update count
    db.table("mkt_segments").update({"contact_count": len(contacts.data)}).eq("id", str(segment_id)).execute()
    
    return contacts.data


# ── Campaigns ────────────────────────────────────────────────

@router.get("/campaigns")
async def list_campaigns(
    status: str = None,
    user=Depends(get_current_user), db=Depends(get_db)
):
    query = db.table("mkt_campaigns").select("*").eq("org_id", str(user.org_id)).order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    return query.execute().data

@router.post("/campaigns")
async def create_campaign(body: CampaignCreate, user=Depends(get_current_user), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id), "created_by": str(user.id)}
    return db.table("mkt_campaigns").insert(data).execute().data[0]

@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(
    campaign_id: UUID,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user), db=Depends(get_db)
):
    """Queue campaign for sending. Resolves segment contacts and creates message records."""
    campaign = db.table("mkt_campaigns").select("*").eq("id", str(campaign_id)).eq("org_id", str(user.org_id)).single().execute()
    if not campaign.data:
        raise HTTPException(404, "Campaign not found")
    if campaign.data["status"] not in ("draft", "scheduled"):
        raise HTTPException(400, f"Cannot send campaign in '{campaign.data['status']}' status")
    
    # Resolve contacts from segment
    if not campaign.data.get("segment_id"):
        raise HTTPException(400, "Campaign has no segment assigned")
    
    contacts = await get_segment_contacts(UUID(campaign.data["segment_id"]), user, db)
    
    # Check unsubscribes
    unsubs = db.table("mkt_unsubscribes").select("contact_id").eq("org_id", str(user.org_id)).in_("channel", [campaign.data["type"], "all"]).execute()
    unsub_ids = {u["contact_id"] for u in unsubs.data}
    eligible = [c for c in contacts if c["id"] not in unsub_ids]
    
    # Create message records
    messages = []
    for contact in eligible:
        messages.append({
            "campaign_id": str(campaign_id),
            "contact_id": contact["id"],
            "channel": campaign.data["type"],
            "status": "queued"
        })
    
    if messages:
        db.table("mkt_campaign_messages").insert(messages).execute()
    
    # Update campaign
    db.table("mkt_campaigns").update({
        "status": "sending",
        "recipient_count": len(eligible),
        "started_at": datetime.utcnow().isoformat()
    }).eq("id", str(campaign_id)).execute()
    
    # Queue background sending
    if campaign.data["type"] == "email":
        background_tasks.add_task(send_campaign_emails, str(campaign_id))
    elif campaign.data["type"] == "sms":
        background_tasks.add_task(send_campaign_sms, str(campaign_id))
    # WhatsApp handled via WhatsApp module's broadcast endpoint
    
    return {"status": "sending", "recipients": len(eligible)}


# ── Email Templates ──────────────────────────────────────────

@router.get("/templates")
async def list_templates(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("mkt_email_templates").select("*").eq("org_id", str(user.org_id)).order("name").execute().data

@router.post("/templates")
async def create_template(body: dict, user=Depends(get_current_user), db=Depends(get_db)):
    body["org_id"] = str(user.org_id)
    body["created_by"] = str(user.id)
    return db.table("mkt_email_templates").insert(body).execute().data[0]


# ── Landing Pages ────────────────────────────────────────────

@router.get("/landing-pages")
async def list_landing_pages(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("mkt_landing_pages").select("*").eq("org_id", str(user.org_id)).order("created_at", desc=True).execute().data

@router.post("/landing-pages")
async def create_landing_page(body: LandingPageCreate, user=Depends(get_current_user), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id), "created_by": str(user.id)}
    return db.table("mkt_landing_pages").insert(data).execute().data[0]

@router.patch("/landing-pages/{page_id}/publish")
async def publish_landing_page(page_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    db.table("mkt_landing_pages").update({
        "status": "published",
        "published_at": datetime.utcnow().isoformat()
    }).eq("id", str(page_id)).eq("org_id", str(user.org_id)).execute()
    return {"status": "published"}


# ── Web Forms ────────────────────────────────────────────────

@router.get("/forms")
async def list_forms(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("mkt_web_forms").select("*").eq("org_id", str(user.org_id)).execute().data

@router.post("/forms")
async def create_form(body: WebFormCreate, user=Depends(get_current_user), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id), "created_by": str(user.id)}
    # Generate embed code
    form = db.table("mkt_web_forms").insert(data).execute().data[0]
    embed = f'<iframe src="https://kartavaya.com/forms/{form["id"]}" width="100%" height="500" frameborder="0"></iframe>'
    db.table("mkt_web_forms").update({"embed_code": embed}).eq("id", form["id"]).execute()
    return {**form, "embed_code": embed}

@router.post("/forms/{form_id}/submit")
async def submit_form(form_id: UUID, body: dict, db=Depends(get_db)):
    """Public endpoint — no auth required. Captures form submission."""
    form = db.table("mkt_web_forms").select("*").eq("id", str(form_id)).eq("is_active", True).single().execute()
    if not form.data:
        raise HTTPException(404, "Form not found or inactive")
    
    submission = db.table("mkt_form_submissions").insert({
        "org_id": form.data["org_id"],
        "form_id": str(form_id),
        "data": body.get("fields", {}),
        "source_url": body.get("source_url"),
        "utm_source": body.get("utm_source"),
        "utm_medium": body.get("utm_medium"),
        "utm_campaign": body.get("utm_campaign")
    }).execute().data[0]
    
    # Auto-create lead/contact if configured
    if form.data["on_submit_action"] in ("create_lead", "create_contact"):
        fields = body.get("fields", {})
        contact_data = {
            "org_id": form.data["org_id"],
            "first_name": fields.get("full_name", fields.get("name", "Web Lead")),
            "email": fields.get("email"),
            "phone": fields.get("phone"),
            "source": "web_form",
            "source_ref": str(form_id)
        }
        contact = db.table("crm_contacts").insert(contact_data).execute().data[0]
        
        db.table("mkt_form_submissions").update({
            "processed": True,
            "contact_id": contact["id"]
        }).eq("id", submission["id"]).execute()
        
        if form.data["on_submit_action"] == "create_lead" and form.data.get("pipeline_id"):
            lead = db.table("crm_leads").insert({
                "org_id": form.data["org_id"],
                "contact_id": contact["id"],
                "pipeline_id": form.data["pipeline_id"],
                "source": "web_form",
                "assigned_to": form.data.get("assign_to")
            }).execute()
    
    # Update submission count
    db.rpc("increment", {"table_name": "mkt_web_forms", "row_id": str(form_id), "column_name": "submission_count"})
    
    return {"status": "success", "message": form.data.get("success_message")}


# ── Link Tracking ────────────────────────────────────────────

@router.get("/links/{short_code}/redirect")
async def redirect_tracked_link(short_code: str, db=Depends(get_db)):
    """Public endpoint — redirects and tracks click."""
    link = db.table("mkt_tracked_links").select("*").eq("short_code", short_code).single().execute()
    if not link.data:
        raise HTTPException(404, "Link not found")
    
    # Record click
    db.table("mkt_link_clicks").insert({"link_id": link.data["id"]}).execute()
    db.table("mkt_tracked_links").update({"click_count": link.data["click_count"] + 1}).eq("id", link.data["id"]).execute()
    
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=link.data["original_url"])


# ── Social Links ─────────────────────────────────────────────

@router.get("/social-links")
async def list_social_links(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("mkt_social_links").select("*").eq("org_id", str(user.org_id)).order("created_at", desc=True).execute().data

@router.post("/social-links")
async def create_social_link(body: SocialLinkCreate, user=Depends(get_current_user), db=Depends(get_db)):
    short_code = uuid4().hex[:8]
    data = {**body.dict(), "org_id": str(user.org_id), "short_code": short_code}
    return db.table("mkt_social_links").insert(data).execute().data[0]


# ── Referral Program ────────────────────────────────────────

@router.post("/referrals/codes")
async def create_referral_code(body: ReferralCodeCreate, user=Depends(get_current_user), db=Depends(get_db)):
    import random, string
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
    data = {**body.dict(), "org_id": str(user.org_id), "code": code}
    return db.table("mkt_referral_codes").insert(data).execute().data[0]

@router.get("/referrals/codes")
async def list_referral_codes(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("mkt_referral_codes").select("*, crm_contacts(first_name, last_name)").eq("org_id", str(user.org_id)).execute().data


# ── Campaign Analytics ───────────────────────────────────────

@router.get("/campaigns/{campaign_id}/stats")
async def campaign_stats(campaign_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    stats = db.table("mkt_campaign_stats").select("*").eq("campaign_id", str(campaign_id)).order("date").execute()
    
    # Also get aggregate from messages
    messages = db.table("mkt_campaign_messages").select("status").eq("campaign_id", str(campaign_id)).execute()
    totals = {}
    for m in messages.data:
        totals[m["status"]] = totals.get(m["status"], 0) + 1
    
    return {"daily": stats.data, "totals": totals}

@router.get("/dashboard")
async def marketing_dashboard(user=Depends(get_current_user), db=Depends(get_db)):
    """Overview: active campaigns, recent form submissions, top performing links."""
    org = str(user.org_id)
    
    active_campaigns = db.table("mkt_campaigns").select("id, name, type, status, recipient_count").eq("org_id", org).in_("status", ["sending", "sent"]).limit(10).execute()
    recent_submissions = db.table("mkt_form_submissions").select("*, mkt_web_forms(name)").eq("org_id", org).order("created_at", desc=True).limit(10).execute()
    top_links = db.table("mkt_social_links").select("*").eq("org_id", org).order("click_count", desc=True).limit(5).execute()
    
    return {
        "active_campaigns": active_campaigns.data,
        "recent_submissions": recent_submissions.data,
        "top_social_links": top_links.data
    }
```

---

## 4. Services

### `backend/services/email_service.py`

```python
"""
AWS SES email sending for campaigns.
Processes queued campaign messages in batches.
"""
import boto3
from botocore.exceptions import ClientError

ses = boto3.client('ses', region_name='ap-south-1')

async def send_campaign_emails(campaign_id: str):
    """Background task: send all queued emails for a campaign."""
    from ..database import get_db_sync
    db = get_db_sync()
    
    campaign = db.table("mkt_campaigns").select("*").eq("id", campaign_id).single().execute().data
    messages = db.table("mkt_campaign_messages").select("*, crm_contacts(email, first_name)").eq("campaign_id", campaign_id).eq("status", "queued").execute()
    
    sent_count = 0
    for msg in messages.data:
        contact = msg["crm_contacts"]
        if not contact.get("email"):
            db.table("mkt_campaign_messages").update({"status": "failed", "error_message": "No email"}).eq("id", msg["id"]).execute()
            continue
        
        # Personalize body
        body = campaign["body_html"].replace("{{first_name}}", contact.get("first_name", "there"))
        
        try:
            response = ses.send_email(
                Source=f"{campaign['from_name']} <{campaign['from_email']}>",
                Destination={"ToAddresses": [contact["email"]]},
                Message={
                    "Subject": {"Data": campaign["subject"]},
                    "Body": {"Html": {"Data": body}}
                },
                Tags=[
                    {"Name": "campaign_id", "Value": campaign_id},
                    {"Name": "org_id", "Value": campaign["org_id"]}
                ]
            )
            db.table("mkt_campaign_messages").update({
                "status": "sent",
                "ses_message_id": response["MessageId"],
                "sent_at": datetime.utcnow().isoformat()
            }).eq("id", msg["id"]).execute()
            sent_count += 1
        except ClientError as e:
            db.table("mkt_campaign_messages").update({
                "status": "failed",
                "error_message": str(e)
            }).eq("id", msg["id"]).execute()
    
    # Mark campaign complete
    db.table("mkt_campaigns").update({
        "status": "sent",
        "completed_at": datetime.utcnow().isoformat()
    }).eq("id", campaign_id).execute()
```

### `backend/services/sms_service.py`

```python
"""
MSG91 SMS sending for campaigns.
"""
import httpx

MSG91_AUTH_KEY = os.getenv("MSG91_AUTH_KEY")
MSG91_SENDER_ID = os.getenv("MSG91_SENDER_ID", "KARTVY")

async def send_campaign_sms(campaign_id: str):
    """Background task: send all queued SMS for a campaign."""
    from ..database import get_db_sync
    db = get_db_sync()
    
    campaign = db.table("mkt_campaigns").select("*").eq("id", campaign_id).single().execute().data
    messages = db.table("mkt_campaign_messages").select("*, crm_contacts(phone, first_name)").eq("campaign_id", campaign_id).eq("status", "queued").execute()
    
    async with httpx.AsyncClient() as client:
        for msg in messages.data:
            contact = msg["crm_contacts"]
            if not contact.get("phone"):
                db.table("mkt_campaign_messages").update({"status": "failed", "error_message": "No phone"}).eq("id", msg["id"]).execute()
                continue
            
            body = campaign["body_text"].replace("{{first_name}}", contact.get("first_name", ""))
            phone = contact["phone"].lstrip("+").lstrip("91")
            
            try:
                resp = await client.post(
                    "https://control.msg91.com/api/v5/flow/",
                    headers={"authkey": MSG91_AUTH_KEY},
                    json={
                        "sender": campaign.get("msg91_sender_id", MSG91_SENDER_ID),
                        "route": "4",  # promotional
                        "country": "91",
                        "sms": [{"message": body, "to": [phone]}]
                    }
                )
                result = resp.json()
                db.table("mkt_campaign_messages").update({
                    "status": "sent",
                    "msg91_request_id": result.get("request_id"),
                    "sent_at": datetime.utcnow().isoformat()
                }).eq("id", msg["id"]).execute()
            except Exception as e:
                db.table("mkt_campaign_messages").update({
                    "status": "failed",
                    "error_message": str(e)
                }).eq("id", msg["id"]).execute()
    
    db.table("mkt_campaigns").update({
        "status": "sent",
        "completed_at": datetime.utcnow().isoformat()
    }).eq("id", campaign_id).execute()
```

---

## 5. Frontend — React Components

```
src/
  pages/
    MarketingDashboard.jsx       # Overview: campaigns, submissions, links
  components/
    marketing/
      CampaignBuilder.jsx        # Create campaign: pick type, segment, content
      CampaignList.jsx           # List with status badges, stats
      SegmentBuilder.jsx         # Dynamic filter builder UI
      EmailTemplateEditor.jsx    # WYSIWYG email editor
      LandingPageBuilder.jsx     # HTML editor with preview
      WebFormBuilder.jsx         # Drag-and-drop form fields
      SocialLinkTracker.jsx      # Create/view social tracking links
      ReferralManager.jsx        # Create codes, view referrals
      CampaignAnalytics.jsx      # Charts: opens, clicks, bounces over time
      UnsubscribeManager.jsx     # View/manage unsubscribes
  hooks/
    useMarketing.js              # React Query hooks
```

---

## 6. Environment Variables

```env
# AWS SES (already configured)
AWS_ACCESS_KEY_ID=<existing>
AWS_SECRET_ACCESS_KEY=<existing>
AWS_SES_REGION=ap-south-1
SES_VERIFIED_EMAIL=noreply@kartavaya.com

# MSG91 (SMS)
MSG91_AUTH_KEY=<auth-key>
MSG91_SENDER_ID=KARTVY         # 6-char approved sender ID
MSG91_DLT_TE_ID=<template-id>  # DLT registered template ID (TRAI compliance)

# Note: WhatsApp sending uses the WhatsApp module's existing config
```

---

## 7. Implementation Steps

1. `git checkout -b feature/marketing-module staging`
2. Run `016_marketing_module.sql`
3. Register MSG91 account, get DLT registration (TRAI compliance for promotional SMS)
4. Verify SES sender domain/email if not already done
5. Build services: `email_service.py`, `sms_service.py`
6. Build `marketing.py` router
7. Build frontend: `CampaignBuilder` → `SegmentBuilder` → `EmailTemplateEditor`
8. Build `LandingPageBuilder`, `WebFormBuilder` (public form submission endpoint)
9. Build link tracking: `SocialLinkTracker`, redirect endpoint
10. Build `ReferralManager`
11. Build `CampaignAnalytics` with daily stats aggregation
12. Tests

---

## 8. Test Cases

```python
# tests/test_marketing.py

async def test_create_segment_dynamic():
    """Create dynamic segment with filter rules → resolves contacts."""

async def test_create_segment_static():
    """Create static segment with contact IDs."""

async def test_campaign_send_email():
    """Create email campaign → send → messages queued → SES called."""

async def test_campaign_respects_unsubscribes():
    """Unsubscribed contacts excluded from campaign sends."""

async def test_form_submission_creates_lead():
    """Submit web form → contact + lead created in CRM."""

async def test_form_submission_public_no_auth():
    """Form submission endpoint works without authentication."""

async def test_landing_page_publish():
    """Create landing page → publish → status=published."""

async def test_link_tracking_redirect():
    """Click tracked link → click recorded → redirected to original URL."""

async def test_social_link_tracking():
    """Create social link → click → count incremented."""

async def test_referral_code_creation():
    """Create referral code for contact → unique code generated."""

async def test_campaign_analytics():
    """Send campaign → stats endpoint returns correct totals."""

async def test_email_template_variables():
    """Template with {{first_name}} → personalized on send."""

async def test_sms_dlt_compliance():
    """SMS campaign includes DLT template ID header."""
```
