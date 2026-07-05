# CRM / Sales Module — Implementation Guide

> **Target**: Q3 2026 | **Dependencies**: Core Platform (live), WhatsApp Module (parallel)
> **Stack**: FastAPI router, Supabase PostgreSQL, React 19 frontend
> **Repo**: `kevalvshah/Kartavya` | **Branch**: `feature/crm-module`

---

## 1. Database Migration

Create `backend/migrations/010_crm_module.sql`:

```sql
-- ============================================================
-- Migration 010: CRM / Sales Module
-- Run against Supabase PostgreSQL (project: efzzjcnpjigeffkiissb)
-- ============================================================

-- 1. CRM Accounts (companies/organisations)
CREATE TABLE crm_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gstin VARCHAR(15),              -- 15-char GST Identification Number
    pan VARCHAR(10),                -- 10-char PAN
    billing_address JSONB,          -- {line1, line2, city, state, state_code, pincode}
    shipping_address JSONB,
    state_code VARCHAR(2),          -- 2-digit state code for GST (e.g., '27' = Maharashtra)
    industry TEXT,
    website TEXT,
    phone TEXT,
    email TEXT,
    annual_revenue DECIMAL(15,2),
    employee_count INTEGER,
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_accounts_org ON crm_accounts(org_id);
CREATE INDEX idx_crm_accounts_gstin ON crm_accounts(gstin) WHERE gstin IS NOT NULL;

-- 2. CRM Contacts (people)
CREATE TABLE crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    account_id UUID REFERENCES crm_accounts(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    whatsapp_number TEXT,           -- for WhatsApp module integration
    designation TEXT,
    department TEXT,
    source TEXT CHECK (source IN ('whatsapp', 'indiamart', 'justdial', 'web_form', 'manual', 'referral', 'linkedin', 'other')),
    source_ref TEXT,                -- external reference ID (IndiaMART enquiry ID, etc.)
    custom_fields JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_contacts_org ON crm_contacts(org_id);
CREATE INDEX idx_crm_contacts_account ON crm_contacts(account_id);
CREATE INDEX idx_crm_contacts_email ON crm_contacts(org_id, email);
CREATE INDEX idx_crm_contacts_phone ON crm_contacts(org_id, phone);

-- 3. CRM Pipelines
CREATE TABLE crm_pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stages JSONB NOT NULL DEFAULT '[
        {"name": "New Lead", "order": 1, "probability": 10},
        {"name": "Qualified", "order": 2, "probability": 25},
        {"name": "Proposal Sent", "order": 3, "probability": 50},
        {"name": "Negotiation", "order": 4, "probability": 75},
        {"name": "Won", "order": 5, "probability": 100},
        {"name": "Lost", "order": 6, "probability": 0}
    ]',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_pipelines_org ON crm_pipelines(org_id);
-- Ensure only one default per org
CREATE UNIQUE INDEX idx_crm_pipelines_default ON crm_pipelines(org_id) WHERE is_default = TRUE;

-- 4. CRM Leads
CREATE TABLE crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    pipeline_id UUID NOT NULL REFERENCES crm_pipelines(id),
    source TEXT CHECK (source IN ('whatsapp', 'indiamart', 'justdial', 'web_form', 'manual', 'referral', 'linkedin', 'other')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'disqualified')),
    score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    assigned_to UUID REFERENCES users(id),
    notes TEXT,
    converted_to_deal_id UUID,      -- set when lead converts to deal
    disqualified_reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_leads_org ON crm_leads(org_id);
CREATE INDEX idx_crm_leads_status ON crm_leads(org_id, status);
CREATE INDEX idx_crm_leads_assigned ON crm_leads(assigned_to) WHERE status = 'open';

-- 5. CRM Deals
CREATE TABLE crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    pipeline_id UUID NOT NULL REFERENCES crm_pipelines(id),
    stage TEXT NOT NULL,             -- matches stages[].name in pipeline
    contact_id UUID REFERENCES crm_contacts(id),
    account_id UUID REFERENCES crm_accounts(id),
    lead_id UUID REFERENCES crm_leads(id),
    title TEXT NOT NULL,
    value DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'INR',
    expected_close DATE,
    probability INTEGER DEFAULT 50 CHECK (probability >= 0 AND probability <= 100),
    owner_id UUID NOT NULL REFERENCES users(id),
    won_at TIMESTAMPTZ,
    lost_at TIMESTAMPTZ,
    lost_reason TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_deals_org ON crm_deals(org_id);
CREATE INDEX idx_crm_deals_pipeline_stage ON crm_deals(pipeline_id, stage);
CREATE INDEX idx_crm_deals_owner ON crm_deals(owner_id);
CREATE INDEX idx_crm_deals_expected_close ON crm_deals(expected_close) WHERE won_at IS NULL AND lost_at IS NULL;

-- 6. CRM Products / Services catalog
CREATE TABLE crm_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT,
    hsn_sac_code VARCHAR(8),        -- HSN (goods) or SAC (services) code
    description TEXT,
    unit_price DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    tax_rate DECIMAL(5,2) DEFAULT 18.00,  -- GST rate (5, 12, 18, 28)
    unit TEXT DEFAULT 'unit',        -- unit, hour, kg, piece, etc.
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_products_org ON crm_products(org_id);

-- 7. CRM Quotations
CREATE TABLE crm_quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    quotation_number TEXT NOT NULL,  -- auto-generated: KQ-2026-0001
    deal_id UUID REFERENCES crm_deals(id),
    account_id UUID NOT NULL REFERENCES crm_accounts(id),
    contact_id UUID REFERENCES crm_contacts(id),
    
    -- Line items as JSONB array
    line_items JSONB NOT NULL DEFAULT '[]',
    -- Each item: {product_id, name, hsn_sac, qty, unit_price, discount_pct, tax_rate, amount}
    
    -- Calculated totals
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_total DECIMAL(15,2) DEFAULT 0,
    
    -- GST breakdown
    is_inter_state BOOLEAN DEFAULT FALSE,  -- TRUE = IGST, FALSE = CGST+SGST
    cgst DECIMAL(12,2) DEFAULT 0,
    sgst DECIMAL(12,2) DEFAULT 0,
    igst DECIMAL(12,2) DEFAULT 0,
    cess DECIMAL(12,2) DEFAULT 0,
    
    total DECIMAL(15,2) NOT NULL DEFAULT 0,
    
    -- Metadata
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
    valid_until DATE,
    terms_and_conditions TEXT,
    notes TEXT,
    pdf_url TEXT,                    -- R2 URL for generated PDF
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_quotations_org ON crm_quotations(org_id);
CREATE INDEX idx_crm_quotations_deal ON crm_quotations(deal_id);
CREATE UNIQUE INDEX idx_crm_quotations_number ON crm_quotations(org_id, quotation_number);

-- 8. CRM Invoices
CREATE TABLE crm_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,    -- auto-generated: KINV-2026-0001
    quotation_id UUID REFERENCES crm_quotations(id),
    deal_id UUID REFERENCES crm_deals(id),
    account_id UUID NOT NULL REFERENCES crm_accounts(id),
    contact_id UUID REFERENCES crm_contacts(id),
    
    -- Copy line_items and totals from quotation (snapshot at invoice time)
    line_items JSONB NOT NULL,
    subtotal DECIMAL(15,2) NOT NULL,
    is_inter_state BOOLEAN DEFAULT FALSE,
    cgst DECIMAL(12,2) DEFAULT 0,
    sgst DECIMAL(12,2) DEFAULT 0,
    igst DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(15,2) NOT NULL,
    
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    
    payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overdue', 'cancelled')),
    amount_paid DECIMAL(15,2) DEFAULT 0,
    payment_date DATE,
    payment_reference TEXT,         -- UTR / cheque number
    
    pdf_url TEXT,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_invoices_org ON crm_invoices(org_id);
CREATE UNIQUE INDEX idx_crm_invoices_number ON crm_invoices(org_id, invoice_number);
CREATE INDEX idx_crm_invoices_status ON crm_invoices(org_id, payment_status);

-- 9. CRM Activities (interaction log)
CREATE TABLE crm_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES crm_contacts(id),
    deal_id UUID REFERENCES crm_deals(id),
    account_id UUID REFERENCES crm_accounts(id),
    type TEXT NOT NULL CHECK (type IN ('call', 'email', 'whatsapp', 'meeting', 'note', 'task')),
    subject TEXT,
    body TEXT,
    outcome TEXT,                    -- call outcome: answered, voicemail, no_answer
    scheduled_at TIMESTAMPTZ,       -- for future meetings/calls
    duration_minutes INTEGER,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_activities_contact ON crm_activities(contact_id);
CREATE INDEX idx_crm_activities_deal ON crm_activities(deal_id);

-- 10. CRM Deal Stage History (audit trail)
CREATE TABLE crm_deal_stage_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_stage_history_deal ON crm_deal_stage_history(deal_id);

-- 11. Auto-number sequences
CREATE TABLE crm_sequences (
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('quotation', 'invoice')),
    prefix TEXT NOT NULL,           -- 'KQ' or 'KINV'
    current_number INTEGER DEFAULT 0,
    fiscal_year INTEGER NOT NULL,
    PRIMARY KEY (org_id, type, fiscal_year)
);

-- 12. RLS Policies
ALTER TABLE crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_stage_history ENABLE ROW LEVEL SECURITY;

-- Policy template (repeat for each table):
CREATE POLICY crm_accounts_org_isolation ON crm_accounts
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_contacts_org_isolation ON crm_contacts
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_pipelines_org_isolation ON crm_pipelines
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_leads_org_isolation ON crm_leads
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_deals_org_isolation ON crm_deals
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_products_org_isolation ON crm_products
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_quotations_org_isolation ON crm_quotations
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_invoices_org_isolation ON crm_invoices
    USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY crm_activities_org_isolation ON crm_activities
    USING (org_id = current_setting('app.current_org_id')::uuid);

-- 13. Helper function: next quotation/invoice number
CREATE OR REPLACE FUNCTION crm_next_number(p_org_id UUID, p_type TEXT)
RETURNS TEXT AS $$
DECLARE
    v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    v_prefix TEXT;
    v_num INTEGER;
BEGIN
    v_prefix := CASE p_type WHEN 'quotation' THEN 'KQ' WHEN 'invoice' THEN 'KINV' END;
    
    INSERT INTO crm_sequences (org_id, type, prefix, current_number, fiscal_year)
    VALUES (p_org_id, p_type, v_prefix, 1, v_year)
    ON CONFLICT (org_id, type, fiscal_year) 
    DO UPDATE SET current_number = crm_sequences.current_number + 1
    RETURNING current_number INTO v_num;
    
    RETURN v_prefix || '-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 14. GST calculation helper
CREATE OR REPLACE FUNCTION crm_calculate_gst(
    p_subtotal DECIMAL,
    p_tax_rate DECIMAL,
    p_is_inter_state BOOLEAN
) RETURNS TABLE(cgst DECIMAL, sgst DECIMAL, igst DECIMAL) AS $$
BEGIN
    IF p_is_inter_state THEN
        RETURN QUERY SELECT 0::DECIMAL, 0::DECIMAL, ROUND(p_subtotal * p_tax_rate / 100, 2);
    ELSE
        RETURN QUERY SELECT 
            ROUND(p_subtotal * p_tax_rate / 200, 2),
            ROUND(p_subtotal * p_tax_rate / 200, 2),
            0::DECIMAL;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## 2. Backend — FastAPI Router

Create `backend/routers/crm.py`:

```python
"""
CRM / Sales Module Router
Endpoints for leads, deals, contacts, accounts, quotations, invoices
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID
from datetime import date, datetime
from pydantic import BaseModel, Field
from ..dependencies import get_current_user, get_db

router = APIRouter(prefix="/api/v1/crm", tags=["CRM"])


# ── Pydantic Models ──────────────────────────────────────────

class ContactCreate(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    designation: Optional[str] = None
    account_id: Optional[UUID] = None
    source: str = "manual"
    custom_fields: dict = {}

class AccountCreate(BaseModel):
    name: str
    gstin: Optional[str] = None
    pan: Optional[str] = None
    billing_address: Optional[dict] = None
    state_code: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None

class LeadCreate(BaseModel):
    contact_id: UUID
    pipeline_id: Optional[UUID] = None  # uses default pipeline if None
    source: str = "manual"
    notes: Optional[str] = None
    assigned_to: Optional[UUID] = None

class DealCreate(BaseModel):
    title: str
    pipeline_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    account_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    value: Optional[float] = None
    expected_close: Optional[date] = None

class DealStageUpdate(BaseModel):
    stage: str

class LineItem(BaseModel):
    product_id: Optional[UUID] = None
    name: str
    hsn_sac: Optional[str] = None
    qty: float = 1
    unit_price: float
    discount_pct: float = 0
    tax_rate: float = 18.0

class QuotationCreate(BaseModel):
    deal_id: Optional[UUID] = None
    account_id: UUID
    contact_id: Optional[UUID] = None
    line_items: list[LineItem]
    is_inter_state: bool = False
    valid_until: Optional[date] = None
    terms_and_conditions: Optional[str] = None
    notes: Optional[str] = None

class ActivityCreate(BaseModel):
    contact_id: Optional[UUID] = None
    deal_id: Optional[UUID] = None
    account_id: Optional[UUID] = None
    type: str  # call, email, whatsapp, meeting, note, task
    subject: Optional[str] = None
    body: Optional[str] = None
    outcome: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


# ── Contacts ─────────────────────────────────────────────────

@router.get("/contacts")
async def list_contacts(
    search: Optional[str] = None,
    account_id: Optional[UUID] = None,
    source: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    """List contacts with search, filter, pagination."""
    query = db.table("crm_contacts").select("*, crm_accounts(name)").eq("org_id", user.org_id)
    
    if search:
        query = query.or_(f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,email.ilike.%{search}%,phone.ilike.%{search}%")
    if account_id:
        query = query.eq("account_id", str(account_id))
    if source:
        query = query.eq("source", source)
    
    query = query.order("created_at", desc=True).range((page-1)*limit, page*limit - 1)
    result = query.execute()
    return {"data": result.data, "page": page, "limit": limit}


@router.post("/contacts")
async def create_contact(body: ContactCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Create a new contact."""
    data = body.model_dump()
    data["org_id"] = str(user.org_id)
    data["created_by"] = str(user.id)
    result = db.table("crm_contacts").insert(data).execute()
    return result.data[0]


@router.get("/contacts/{contact_id}")
async def get_contact(contact_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    """Get contact with activity timeline."""
    contact = db.table("crm_contacts").select("*, crm_accounts(*)").eq("id", str(contact_id)).eq("org_id", str(user.org_id)).single().execute()
    activities = db.table("crm_activities").select("*").eq("contact_id", str(contact_id)).order("created_at", desc=True).limit(50).execute()
    deals = db.table("crm_deals").select("*").eq("contact_id", str(contact_id)).execute()
    return {**contact.data, "activities": activities.data, "deals": deals.data}


# ── Leads ────────────────────────────────────────────────────

@router.get("/leads")
async def list_leads(
    status: str = "open",
    assigned_to: Optional[UUID] = None,
    source: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    """List leads with filters."""
    query = db.table("crm_leads").select("*, crm_contacts(first_name, last_name, email, phone)").eq("org_id", str(user.org_id)).eq("status", status)
    if assigned_to:
        query = query.eq("assigned_to", str(assigned_to))
    if source:
        query = query.eq("source", source)
    query = query.order("created_at", desc=True).range((page-1)*limit, page*limit - 1)
    return {"data": query.execute().data}


@router.post("/leads")
async def create_lead(body: LeadCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Create a new lead. If no pipeline_id, uses org default."""
    data = body.model_dump()
    data["org_id"] = str(user.org_id)
    data["created_by"] = str(user.id)
    
    if not data.get("pipeline_id"):
        default = db.table("crm_pipelines").select("id").eq("org_id", str(user.org_id)).eq("is_default", True).single().execute()
        data["pipeline_id"] = default.data["id"]
    
    result = db.table("crm_leads").insert(data).execute()
    return result.data[0]


@router.post("/leads/{lead_id}/convert")
async def convert_lead(lead_id: UUID, body: DealCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Convert a lead to a deal."""
    lead = db.table("crm_leads").select("*").eq("id", str(lead_id)).eq("org_id", str(user.org_id)).single().execute()
    if lead.data["status"] != "open":
        raise HTTPException(400, "Lead is not open")
    
    # Create deal
    deal_data = body.model_dump()
    deal_data["org_id"] = str(user.org_id)
    deal_data["owner_id"] = str(user.id)
    deal_data["lead_id"] = str(lead_id)
    deal_data["contact_id"] = deal_data.get("contact_id") or lead.data["contact_id"]
    deal_data["pipeline_id"] = deal_data.get("pipeline_id") or lead.data["pipeline_id"]
    deal_data["stage"] = "New Lead"  # first stage
    
    deal = db.table("crm_deals").insert(deal_data).execute()
    
    # Update lead status
    db.table("crm_leads").update({
        "status": "converted",
        "converted_to_deal_id": deal.data[0]["id"]
    }).eq("id", str(lead_id)).execute()
    
    return deal.data[0]


# ── Webhook endpoints for lead import ────────────────────────

@router.post("/leads/webhook/indiamart")
async def indiamart_webhook(payload: dict, db=Depends(get_db)):
    """
    IndiaMART Lead Import Webhook.
    IndiaMART sends: SENDER_NAME, SENDER_EMAIL, SENDER_MOBILE, 
    QUERY_MESSAGE, PRODUCT_NAME, QUERY_TIME, UNIQUE_QUERY_ID
    Map to org via API key in header.
    """
    # TODO: Validate IndiaMART API key from header
    # TODO: Map API key to org_id
    # TODO: Create contact + lead
    pass


@router.post("/leads/webhook/justdial")
async def justdial_webhook(payload: dict, db=Depends(get_db)):
    """
    JustDial Lead Import Webhook.
    JustDial sends: leadid, name, mobile, email, category, area, city, date
    """
    # TODO: Similar to IndiaMART - validate, map to org, create contact+lead
    pass


# ── Deals ────────────────────────────────────────────────────

@router.get("/deals")
async def list_deals(
    pipeline_id: Optional[UUID] = None,
    stage: Optional[str] = None,
    owner_id: Optional[UUID] = None,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    """List deals, optionally grouped by pipeline stage (for Kanban)."""
    query = db.table("crm_deals").select("*, crm_contacts(first_name, last_name), crm_accounts(name)").eq("org_id", str(user.org_id))
    if pipeline_id:
        query = query.eq("pipeline_id", str(pipeline_id))
    if stage:
        query = query.eq("stage", stage)
    if owner_id:
        query = query.eq("owner_id", str(owner_id))
    
    query = query.is_("lost_at", "null").order("updated_at", desc=True)
    return {"data": query.execute().data}


@router.patch("/deals/{deal_id}/stage")
async def update_deal_stage(deal_id: UUID, body: DealStageUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    """Move deal to a new stage. Records history."""
    deal = db.table("crm_deals").select("stage, pipeline_id").eq("id", str(deal_id)).eq("org_id", str(user.org_id)).single().execute()
    old_stage = deal.data["stage"]
    
    # Validate stage exists in pipeline
    pipeline = db.table("crm_pipelines").select("stages").eq("id", deal.data["pipeline_id"]).single().execute()
    valid_stages = [s["name"] for s in pipeline.data["stages"]]
    if body.stage not in valid_stages:
        raise HTTPException(400, f"Invalid stage. Valid: {valid_stages}")
    
    # Update deal
    update = {"stage": body.stage, "updated_at": datetime.utcnow().isoformat()}
    if body.stage == "Won":
        update["won_at"] = datetime.utcnow().isoformat()
        update["probability"] = 100
    elif body.stage == "Lost":
        update["lost_at"] = datetime.utcnow().isoformat()
        update["probability"] = 0
    else:
        stage_data = next(s for s in pipeline.data["stages"] if s["name"] == body.stage)
        update["probability"] = stage_data.get("probability", 50)
    
    db.table("crm_deals").update(update).eq("id", str(deal_id)).execute()
    
    # Record history
    db.table("crm_deal_stage_history").insert({
        "deal_id": str(deal_id),
        "from_stage": old_stage,
        "to_stage": body.stage,
        "changed_by": str(user.id)
    }).execute()
    
    return {"status": "ok", "from": old_stage, "to": body.stage}


# ── Quotations ───────────────────────────────────────────────

@router.post("/quotations")
async def create_quotation(body: QuotationCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Create a GST-compliant quotation."""
    # Calculate line item totals
    items = []
    subtotal = 0
    total_cgst = 0
    total_sgst = 0
    total_igst = 0
    
    for item in body.line_items:
        amount = item.qty * item.unit_price * (1 - item.discount_pct / 100)
        tax_amount = amount * item.tax_rate / 100
        
        if body.is_inter_state:
            total_igst += tax_amount
        else:
            total_cgst += tax_amount / 2
            total_sgst += tax_amount / 2
        
        subtotal += amount
        items.append({
            "product_id": str(item.product_id) if item.product_id else None,
            "name": item.name,
            "hsn_sac": item.hsn_sac,
            "qty": item.qty,
            "unit_price": item.unit_price,
            "discount_pct": item.discount_pct,
            "tax_rate": item.tax_rate,
            "amount": round(amount, 2),
            "tax_amount": round(tax_amount, 2)
        })
    
    # Get next quotation number
    q_number = db.rpc("crm_next_number", {"p_org_id": str(user.org_id), "p_type": "quotation"}).execute()
    
    data = {
        "org_id": str(user.org_id),
        "quotation_number": q_number.data,
        "deal_id": str(body.deal_id) if body.deal_id else None,
        "account_id": str(body.account_id),
        "contact_id": str(body.contact_id) if body.contact_id else None,
        "line_items": items,
        "subtotal": round(subtotal, 2),
        "is_inter_state": body.is_inter_state,
        "cgst": round(total_cgst, 2),
        "sgst": round(total_sgst, 2),
        "igst": round(total_igst, 2),
        "total": round(subtotal + total_cgst + total_sgst + total_igst, 2),
        "valid_until": body.valid_until.isoformat() if body.valid_until else None,
        "terms_and_conditions": body.terms_and_conditions,
        "notes": body.notes,
        "status": "draft",
        "created_by": str(user.id)
    }
    
    result = db.table("crm_quotations").insert(data).execute()
    return result.data[0]


@router.post("/quotations/{quotation_id}/invoice")
async def convert_to_invoice(quotation_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    """Convert an accepted quotation to an invoice."""
    quote = db.table("crm_quotations").select("*").eq("id", str(quotation_id)).eq("org_id", str(user.org_id)).single().execute()
    
    if quote.data["status"] not in ("accepted", "draft", "sent"):
        raise HTTPException(400, "Quotation must be accepted/draft/sent to convert")
    
    inv_number = db.rpc("crm_next_number", {"p_org_id": str(user.org_id), "p_type": "invoice"}).execute()
    
    invoice_data = {
        "org_id": str(user.org_id),
        "invoice_number": inv_number.data,
        "quotation_id": str(quotation_id),
        "deal_id": quote.data.get("deal_id"),
        "account_id": quote.data["account_id"],
        "contact_id": quote.data.get("contact_id"),
        "line_items": quote.data["line_items"],
        "subtotal": quote.data["subtotal"],
        "is_inter_state": quote.data["is_inter_state"],
        "cgst": quote.data["cgst"],
        "sgst": quote.data["sgst"],
        "igst": quote.data["igst"],
        "total": quote.data["total"],
        "issue_date": date.today().isoformat(),
        "due_date": (date.today().replace(day=1) + timedelta(days=45)).isoformat(),  # Net 45
        "payment_status": "unpaid",
        "created_by": str(user.id)
    }
    
    result = db.table("crm_invoices").insert(invoice_data).execute()
    
    # Update quotation status
    db.table("crm_quotations").update({"status": "accepted"}).eq("id", str(quotation_id)).execute()
    
    return result.data[0]


# ── Pipeline & Forecast ──────────────────────────────────────

@router.get("/pipeline/{pipeline_id}/forecast")
async def pipeline_forecast(pipeline_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    """Weighted revenue forecast by stage."""
    deals = db.table("crm_deals").select("stage, value, probability, expected_close").eq("pipeline_id", str(pipeline_id)).eq("org_id", str(user.org_id)).is_("won_at", "null").is_("lost_at", "null").execute()
    
    stages = {}
    for d in deals.data:
        stage = d["stage"]
        if stage not in stages:
            stages[stage] = {"count": 0, "total_value": 0, "weighted_value": 0}
        stages[stage]["count"] += 1
        stages[stage]["total_value"] += d["value"] or 0
        stages[stage]["weighted_value"] += (d["value"] or 0) * (d["probability"] or 0) / 100
    
    return {
        "pipeline_id": str(pipeline_id),
        "stages": stages,
        "total_pipeline_value": sum(s["total_value"] for s in stages.values()),
        "total_weighted_value": sum(s["weighted_value"] for s in stages.values()),
    }


# ── Activities ───────────────────────────────────────────────

@router.post("/activities")
async def create_activity(body: ActivityCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Log an activity (call, email, meeting, note)."""
    data = body.model_dump()
    data["org_id"] = str(user.org_id)
    data["created_by"] = str(user.id)
    result = db.table("crm_activities").insert(data).execute()
    return result.data[0]
```

Register in `backend/main.py`:
```python
from .routers import crm
app.include_router(crm.router)
```

---

## 3. Frontend — React Components

### File tree

```
src/
  pages/
    CRMPage.jsx              # Main CRM page with tab navigation
  components/
    crm/
      LeadList.jsx            # Lead list with filters
      LeadCard.jsx            # Individual lead card
      DealPipeline.jsx        # Kanban board for deals (reuse KanbanView engine)
      DealCard.jsx            # Deal card in pipeline
      DealDrawer.jsx          # Deal detail drawer (like TaskDrawer)
      ContactList.jsx         # Contact list with search
      ContactDetail.jsx       # Contact profile + activity timeline
      AccountList.jsx         # Account list
      AccountDetail.jsx       # Account profile
      QuotationBuilder.jsx    # Quotation form with line items + GST calc
      QuotationPreview.jsx    # PDF preview of quotation
      InvoiceList.jsx         # Invoice list with payment status
      ProductCatalog.jsx      # Product/service catalog management
      PipelineSettings.jsx    # Pipeline stage configuration
      ActivityTimeline.jsx    # Activity feed for contact/deal
      CRMDashboard.jsx        # Pipeline snapshot, forecast, metrics
  hooks/
    useCRM.js                 # React Query hooks for CRM API
    useDeals.js               # Deal-specific hooks with Realtime subscription
    useContacts.js            # Contact search + pagination hook
```

### Key component: `DealPipeline.jsx`

Reuse the existing Kanban engine from `KanbanView.jsx`. The deal pipeline is structurally identical to a task board:

```jsx
// DealPipeline.jsx — Reuses KanbanView drag-and-drop engine
import { useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useDeals, useUpdateDealStage } from '../../hooks/useDeals';
import DealCard from './DealCard';

export default function DealPipeline({ pipelineId }) {
  const { data: deals, isLoading } = useDeals(pipelineId);
  const updateStage = useUpdateDealStage();
  
  // Group deals by stage (same pattern as KanbanView groups tasks by status)
  const columns = useMemo(() => {
    if (!deals) return [];
    const grouped = {};
    deals.forEach(deal => {
      if (!grouped[deal.stage]) grouped[deal.stage] = [];
      grouped[deal.stage].push(deal);
    });
    return grouped;
  }, [deals]);
  
  const onDragEnd = (result) => {
    if (!result.destination) return;
    const dealId = result.draggableId;
    const newStage = result.destination.droppableId;
    updateStage.mutate({ dealId, stage: newStage });
  };
  
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto p-4">
        {pipeline.stages.map(stage => (
          <Droppable key={stage.name} droppableId={stage.name}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}
                className="min-w-[280px] bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-sm">{stage.name}</h3>
                  <span className="text-xs text-gray-500">
                    {columns[stage.name]?.length || 0} deals
                  </span>
                </div>
                {/* Column total */}
                <div className="text-xs text-gray-400 mb-2">
                  {formatCurrency(columns[stage.name]?.reduce((s, d) => s + (d.value || 0), 0))}
                </div>
                {columns[stage.name]?.map((deal, i) => (
                  <Draggable key={deal.id} draggableId={deal.id} index={i}>
                    {(prov) => (
                      <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}>
                        <DealCard deal={deal} />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  );
}
```

### Key component: `QuotationBuilder.jsx`

```jsx
// QuotationBuilder.jsx — GST-compliant quotation form
// Core logic: auto-calculate CGST/SGST (intra-state) vs IGST (inter-state)
// based on org's state_code vs account's state_code

export default function QuotationBuilder({ dealId, accountId }) {
  const [lineItems, setLineItems] = useState([]);
  const [isInterState, setIsInterState] = useState(false);
  
  // Auto-detect inter-state from account's state_code vs org's state_code
  useEffect(() => {
    if (account && org) {
      setIsInterState(account.state_code !== org.state_code);
    }
  }, [account, org]);
  
  const totals = useMemo(() => {
    let subtotal = 0, cgst = 0, sgst = 0, igst = 0;
    lineItems.forEach(item => {
      const amount = item.qty * item.unit_price * (1 - item.discount_pct / 100);
      const tax = amount * item.tax_rate / 100;
      subtotal += amount;
      if (isInterState) { igst += tax; }
      else { cgst += tax / 2; sgst += tax / 2; }
    });
    return { subtotal, cgst, sgst, igst, total: subtotal + cgst + sgst + igst };
  }, [lineItems, isInterState]);
  
  // ... render form with product picker, qty/price inputs, GST breakdown
}
```

---

## 4. API Hook: `useCRM.js`

```javascript
// hooks/useCRM.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';

// Leads
export const useLeads = (filters = {}) =>
  useQuery(['crm-leads', filters], () => api.get('/api/v1/crm/leads', { params: filters }));

export const useCreateLead = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/crm/leads', data), {
    onSuccess: () => qc.invalidateQueries(['crm-leads']),
  });
};

export const useConvertLead = () => {
  const qc = useQueryClient();
  return useMutation(({ leadId, ...data }) => api.post(`/api/v1/crm/leads/${leadId}/convert`, data), {
    onSuccess: () => {
      qc.invalidateQueries(['crm-leads']);
      qc.invalidateQueries(['crm-deals']);
    },
  });
};

// Deals
export const useDeals = (pipelineId) =>
  useQuery(['crm-deals', pipelineId], () => api.get('/api/v1/crm/deals', { params: { pipeline_id: pipelineId } }));

export const useUpdateDealStage = () => {
  const qc = useQueryClient();
  return useMutation(({ dealId, stage }) => api.patch(`/api/v1/crm/deals/${dealId}/stage`, { stage }), {
    onSuccess: () => qc.invalidateQueries(['crm-deals']),
  });
};

// Contacts
export const useContacts = (filters = {}) =>
  useQuery(['crm-contacts', filters], () => api.get('/api/v1/crm/contacts', { params: filters }));

// Quotations
export const useCreateQuotation = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/crm/quotations', data), {
    onSuccess: () => qc.invalidateQueries(['crm-quotations']),
  });
};

// Pipeline forecast
export const useForecast = (pipelineId) =>
  useQuery(['crm-forecast', pipelineId], () => api.get(`/api/v1/crm/pipeline/${pipelineId}/forecast`));
```

---

## 5. Implementation Steps

1. **Create branch**: `git checkout -b feature/crm-module`
2. **Run migration**: Apply `010_crm_module.sql` to staging Supabase first
3. **Create default pipeline**: Insert default pipeline for each existing org
4. **Build backend**: Create `backend/routers/crm.py`, register in `main.py`
5. **Build frontend**: Start with `CRMPage.jsx` → `DealPipeline.jsx` (reuse Kanban) → `ContactList.jsx`
6. **GST logic**: Implement `QuotationBuilder.jsx` with inter-state detection
7. **Webhooks**: Wire up IndiaMART and JustDial lead import endpoints
8. **PDF generation**: Add quotation/invoice PDF generation (use `reportlab` or `weasyprint`)
9. **Tests**: API tests for lead lifecycle, deal stage transitions, GST calculations
10. **Realtime**: Enable Supabase Realtime on `crm_deals` for live pipeline updates

---

## 6. Test Cases

```python
# tests/test_crm.py

async def test_lead_to_deal_lifecycle():
    """Full lifecycle: create contact → create lead → convert to deal → move stages → create quotation → convert to invoice"""
    pass

async def test_gst_intra_state():
    """Verify CGST+SGST split for same-state transaction (e.g., MH to MH)"""
    # subtotal=10000, tax_rate=18%, is_inter_state=False
    # expected: cgst=900, sgst=900, igst=0, total=11800
    pass

async def test_gst_inter_state():
    """Verify IGST for cross-state transaction (e.g., MH to GJ)"""
    # subtotal=10000, tax_rate=18%, is_inter_state=True
    # expected: cgst=0, sgst=0, igst=1800, total=11800
    pass

async def test_quotation_number_sequence():
    """Verify auto-incrementing quotation numbers per org per fiscal year"""
    pass

async def test_pipeline_weighted_forecast():
    """Verify weighted pipeline calculation"""
    pass

async def test_indiamart_webhook():
    """Verify IndiaMART payload creates contact + lead"""
    pass
```
