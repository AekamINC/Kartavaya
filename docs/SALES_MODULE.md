# Sales Operations Module — Implementation Guide

> **Target**: Q4 2026 | **Dependencies**: CRM Module (deals, contacts, pipelines)
> **Stack**: FastAPI, Supabase PostgreSQL, React 19
> **Branch**: `feature/sales-module`
> **Add-on Price**: ₹49/user/mo | **Requires**: CRM

---

## 1. Module Overview

Full sales operations engine: targets & quotas, commission tracking with slab-based incentives, territory/region management with geo-based lead routing, sales playbooks, proposal templates with e-signatures, revenue forecasting, and team leaderboards.

### Feature Set

| Feature | Description |
|---------|-------------|
| **Targets & Quotas** | Monthly/quarterly/annual targets per rep, team, or region |
| **Commission Engine** | Slab-based commission calculation, incentive tracking, payout reports |
| **Territory Management** | Region → state → city hierarchy, territory assignment, geo-based routing |
| **Sales Playbooks** | Step-by-step guides for deal stages, objection handling, pitch scripts |
| **Proposal Templates** | Branded proposal generation with dynamic fields, PDF export |
| **E-Signatures** | Aadhaar eSign / simple digital signature on proposals and contracts |
| **Revenue Forecasting** | Weighted pipeline forecast, historical trend analysis |
| **Leaderboard** | Real-time rep rankings by revenue, deals closed, conversion rate |

---

## 2. Database Migration

Create `backend/migrations/017_sales_module.sql`:

```sql
-- ============================================================
-- Migration 017: Sales Operations Module
-- Requires: 010_crm_module.sql (crm_deals, crm_contacts, crm_pipelines)
-- ============================================================

-- 1. Sales Territories
CREATE TABLE sales_territories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('region', 'state', 'city', 'zone', 'custom')),
    parent_id UUID REFERENCES sales_territories(id),  -- hierarchy
    state_codes VARCHAR(2)[] DEFAULT '{}',             -- mapped Indian state codes
    city_names TEXT[] DEFAULT '{}',
    pincode_ranges JSONB DEFAULT '[]',                 -- [{from: "400001", to: "400099"}]
    assigned_to UUID[] DEFAULT '{}',                   -- user IDs of reps assigned
    manager_id UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_terr_org ON sales_territories(org_id);
CREATE INDEX idx_sales_terr_parent ON sales_territories(parent_id);

-- 2. Sales Targets
CREATE TABLE sales_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    
    -- Target owner (one of these)
    user_id UUID REFERENCES users(id),                 -- individual rep
    team_name TEXT,                                     -- team target
    territory_id UUID REFERENCES sales_territories(id), -- territory target
    
    period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Targets
    revenue_target DECIMAL(15,2) NOT NULL DEFAULT 0,
    deals_target INTEGER DEFAULT 0,
    leads_target INTEGER DEFAULT 0,
    calls_target INTEGER DEFAULT 0,
    meetings_target INTEGER DEFAULT 0,
    
    -- Actuals (updated by trigger/cron)
    revenue_actual DECIMAL(15,2) DEFAULT 0,
    deals_actual INTEGER DEFAULT 0,
    leads_actual INTEGER DEFAULT 0,
    calls_actual INTEGER DEFAULT 0,
    meetings_actual INTEGER DEFAULT 0,
    
    -- Achievement
    achievement_pct DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN revenue_target > 0 THEN ROUND((revenue_actual / revenue_target) * 100, 2)
        ELSE 0 END
    ) STORED,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_targets_org ON sales_targets(org_id);
CREATE INDEX idx_sales_targets_user ON sales_targets(user_id, period_start);
CREATE INDEX idx_sales_targets_period ON sales_targets(period_start, period_end);
CREATE UNIQUE INDEX idx_sales_targets_unique ON sales_targets(
    org_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(team_name, ''), period_start
);

-- 3. Commission Slabs
CREATE TABLE sales_commission_slabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                                -- "Standard", "Senior Rep", "Manager"
    
    slabs JSONB NOT NULL DEFAULT '[]',
    -- [{from_pct: 0, to_pct: 80, rate: 2},         -- 0-80% achievement: 2% commission
    --  {from_pct: 80, to_pct: 100, rate: 5},        -- 80-100%: 5%
    --  {from_pct: 100, to_pct: 150, rate: 8},       -- 100-150%: 8%
    --  {from_pct: 150, to_pct: null, rate: 12}]     -- 150%+: 12% (accelerator)
    
    base_metric TEXT DEFAULT 'revenue'
        CHECK (base_metric IN ('revenue', 'deals', 'gross_margin')),
    is_default BOOLEAN DEFAULT FALSE,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_cs_org ON sales_commission_slabs(org_id);

-- 4. Commission Assignments (which slab applies to which rep)
CREATE TABLE sales_commission_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    slab_id UUID NOT NULL REFERENCES sales_commission_slabs(id),
    effective_from DATE NOT NULL,
    effective_to DATE,
    override_rate DECIMAL(5,2),          -- flat override if not slab-based
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(org_id, user_id, effective_from)
);

CREATE INDEX idx_sales_ca_user ON sales_commission_assignments(user_id);

-- 5. Commission Records (calculated per period)
CREATE TABLE sales_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Calculation
    target_id UUID REFERENCES sales_targets(id),
    slab_id UUID REFERENCES sales_commission_slabs(id),
    achievement_pct DECIMAL(5,2),
    base_amount DECIMAL(15,2) NOT NULL,      -- revenue/metric that commission is on
    commission_amount DECIMAL(12,2) NOT NULL,
    
    -- Breakdown
    calculation_details JSONB DEFAULT '{}',
    -- {slabs_applied: [{from: 0, to: 80, rate: 2, amount: 5000}, ...]}
    
    -- Approval
    status TEXT DEFAULT 'computed'
        CHECK (status IN ('computed', 'approved', 'paid', 'disputed')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    dispute_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_comm_user ON sales_commissions(user_id, period_start);
CREATE INDEX idx_sales_comm_status ON sales_commissions(org_id, status);

-- 6. Sales Playbooks
CREATE TABLE sales_playbooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    pipeline_id UUID REFERENCES crm_pipelines(id),     -- applicable pipeline
    
    stages JSONB NOT NULL DEFAULT '[]',
    -- [{stage_name: "New Lead", steps: [
    --     {action: "Send intro email", template_id: "...", duration_hours: 2},
    --     {action: "Follow-up call", script: "...", duration_hours: 24},
    --     {action: "Send brochure via WhatsApp", template_id: "..."}
    -- ]}]
    
    objection_handlers JSONB DEFAULT '[]',
    -- [{objection: "Too expensive", response: "...", tips: "..."},
    --  {objection: "Already using competitor", response: "...", tips: "..."}]
    
    pitch_scripts JSONB DEFAULT '[]',
    -- [{scenario: "Cold call", script: "...", notes: ""},
    --  {scenario: "Demo follow-up", script: "...", notes: ""}]
    
    resources JSONB DEFAULT '[]',         -- [{name, url, type}] linked docs/videos
    
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_pb_org ON sales_playbooks(org_id);

-- 7. Proposal Templates
CREATE TABLE sales_proposal_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    
    -- Template content
    sections JSONB NOT NULL DEFAULT '[]',
    -- [{title: "About Us", content_html: "...", order: 1},
    --  {title: "Proposed Solution", content_html: "...", order: 2, dynamic_fields: ["{{product_name}}", "{{price}}"]},
    --  {title: "Pricing", content_html: "...", order: 3},
    --  {title: "Terms & Conditions", content_html: "...", order: 4}]
    
    -- Branding
    header_html TEXT,
    footer_html TEXT,
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#1E2761',
    
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_pt_org ON sales_proposal_templates(org_id);

-- 8. Proposals (generated from templates)
CREATE TABLE sales_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    template_id UUID REFERENCES sales_proposal_templates(id),
    deal_id UUID REFERENCES crm_deals(id),
    account_id UUID REFERENCES crm_accounts(id),
    contact_id UUID REFERENCES crm_contacts(id),
    
    proposal_number TEXT NOT NULL,        -- KP-2026-0001
    title TEXT NOT NULL,
    
    -- Content (snapshot from template + customizations)
    sections JSONB NOT NULL DEFAULT '[]',
    
    -- Pricing
    line_items JSONB DEFAULT '[]',
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_pct DECIMAL(5,2) DEFAULT 0,
    total DECIMAL(15,2) DEFAULT 0,
    validity_days INTEGER DEFAULT 30,
    valid_until DATE,
    
    -- Status
    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    
    -- Signature
    signature_status TEXT DEFAULT 'unsigned'
        CHECK (signature_status IN ('unsigned', 'pending', 'signed', 'declined')),
    signer_name TEXT,
    signer_email TEXT,
    signed_at TIMESTAMPTZ,
    signature_data JSONB,                -- {type: "drawn"/"aadhaar_esign", image_url, certificate}
    
    -- Output
    pdf_url TEXT,                         -- generated PDF in R2
    public_link_token VARCHAR(64),       -- for shareable view link
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_prop_org ON sales_proposals(org_id);
CREATE INDEX idx_sales_prop_deal ON sales_proposals(deal_id);
CREATE UNIQUE INDEX idx_sales_prop_number ON sales_proposals(org_id, proposal_number);
CREATE INDEX idx_sales_prop_token ON sales_proposals(public_link_token) WHERE public_link_token IS NOT NULL;

-- 9. Proposal Sequences (auto-number)
CREATE TABLE sales_proposal_sequences (
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    current_number INTEGER DEFAULT 0,
    fiscal_year INTEGER NOT NULL,
    PRIMARY KEY (org_id, fiscal_year)
);

-- 10. Leaderboard Cache (refreshed daily or on demand)
CREATE TABLE sales_leaderboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
    period_start DATE NOT NULL,
    
    -- Metrics
    revenue_closed DECIMAL(15,2) DEFAULT 0,
    deals_closed INTEGER DEFAULT 0,
    deals_in_progress INTEGER DEFAULT 0,
    pipeline_value DECIMAL(15,2) DEFAULT 0,
    conversion_rate DECIMAL(5,2) DEFAULT 0,   -- won / total deals %
    avg_deal_size DECIMAL(12,2) DEFAULT 0,
    avg_close_days INTEGER DEFAULT 0,
    activities_count INTEGER DEFAULT 0,
    
    -- Ranking
    rank INTEGER,
    achievement_pct DECIMAL(5,2) DEFAULT 0,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, user_id, period_type, period_start)
);

CREATE INDEX idx_sales_lb_org ON sales_leaderboard(org_id, period_type, period_start);

-- 11. Revenue Forecast Snapshots
CREATE TABLE sales_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL DEFAULT CURRENT_DATE,
    period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
    period_start DATE NOT NULL,
    
    -- Weighted pipeline
    weighted_pipeline DECIMAL(15,2) DEFAULT 0,   -- sum(deal.value * deal.probability/100)
    best_case DECIMAL(15,2) DEFAULT 0,           -- all open deals value
    committed DECIMAL(15,2) DEFAULT 0,           -- deals at >75% probability
    closed_won DECIMAL(15,2) DEFAULT 0,          -- already won
    
    -- By stage breakdown
    stage_breakdown JSONB DEFAULT '{}',
    -- {"New Lead": {count: 5, value: 100000}, "Qualified": {count: 3, value: 250000}, ...}
    
    -- By rep breakdown
    rep_breakdown JSONB DEFAULT '{}',
    -- {"user-id-1": {weighted: 150000, best_case: 300000}, ...}
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_fc_org ON sales_forecasts(org_id, period_start);

-- 12. Lead Routing Rules (geo-based auto-assignment)
CREATE TABLE sales_routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 10,          -- lower = higher priority
    
    -- Conditions
    conditions JSONB NOT NULL DEFAULT '[]',
    -- [{field: "state_code", operator: "in", value: ["27", "30"]},
    --  {field: "source", operator: "eq", value: "indiamart"},
    --  {field: "industry", operator: "eq", value: "manufacturing"}]
    
    -- Action
    assign_to UUID REFERENCES users(id),
    territory_id UUID REFERENCES sales_territories(id),
    round_robin_users UUID[] DEFAULT '{}',  -- rotate among these users
    round_robin_index INTEGER DEFAULT 0,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_rr_org ON sales_routing_rules(org_id, priority);

-- 13. RLS
ALTER TABLE sales_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_commission_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_commission_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_proposal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_terr_org ON sales_territories USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_targets_org ON sales_targets USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_cs_org ON sales_commission_slabs USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_ca_org ON sales_commission_assignments USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_comm_org ON sales_commissions USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_pb_org ON sales_playbooks USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_pt_org ON sales_proposal_templates USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_prop_org ON sales_proposals USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_lb_org ON sales_leaderboard USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_fc_org ON sales_forecasts USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY sales_rr_org ON sales_routing_rules USING (org_id = current_setting('app.current_org_id')::uuid);

-- 14. Helper: Next proposal number
CREATE OR REPLACE FUNCTION sales_next_proposal_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    v_num INTEGER;
BEGIN
    INSERT INTO sales_proposal_sequences (org_id, current_number, fiscal_year)
    VALUES (p_org_id, 1, v_year)
    ON CONFLICT (org_id, fiscal_year)
    DO UPDATE SET current_number = sales_proposal_sequences.current_number + 1
    RETURNING current_number INTO v_num;
    RETURN 'KP-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 15. Helper: Compute commission for a rep/period
CREATE OR REPLACE FUNCTION sales_compute_commission(
    p_org_id UUID, p_user_id UUID, p_period_start DATE, p_period_end DATE
) RETURNS DECIMAL AS $$
DECLARE
    v_slab RECORD;
    v_target RECORD;
    v_achievement DECIMAL;
    v_commission DECIMAL := 0;
    v_slab_entry JSONB;
    v_from DECIMAL;
    v_to DECIMAL;
    v_rate DECIMAL;
BEGIN
    -- Get assignment
    SELECT cs.* INTO v_slab
    FROM sales_commission_assignments ca
    JOIN sales_commission_slabs cs ON cs.id = ca.slab_id
    WHERE ca.user_id = p_user_id AND ca.org_id = p_org_id AND ca.is_active = TRUE
    LIMIT 1;
    
    IF v_slab IS NULL THEN RETURN 0; END IF;
    
    -- Get target
    SELECT * INTO v_target
    FROM sales_targets
    WHERE user_id = p_user_id AND org_id = p_org_id
      AND period_start = p_period_start
    LIMIT 1;
    
    IF v_target IS NULL OR v_target.revenue_target = 0 THEN RETURN 0; END IF;
    
    v_achievement := (v_target.revenue_actual / v_target.revenue_target) * 100;
    
    -- Apply slabs
    FOR v_slab_entry IN SELECT * FROM jsonb_array_elements(v_slab.slabs)
    LOOP
        v_from := (v_slab_entry->>'from_pct')::DECIMAL;
        v_to := COALESCE((v_slab_entry->>'to_pct')::DECIMAL, 999);
        v_rate := (v_slab_entry->>'rate')::DECIMAL;
        
        IF v_achievement > v_from THEN
            v_commission := v_commission + (
                LEAST(v_achievement, v_to) - v_from
            ) / 100 * v_target.revenue_actual * v_rate / 100;
        END IF;
    END LOOP;
    
    RETURN ROUND(v_commission, 2);
END;
$$ LANGUAGE plpgsql;

-- 16. Trigger: Update target actuals when deal closes
CREATE OR REPLACE FUNCTION sales_update_target_on_deal_close()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.won_at IS NOT NULL AND OLD.won_at IS NULL THEN
        -- Deal just won — update target actuals
        UPDATE sales_targets
        SET revenue_actual = revenue_actual + COALESCE(NEW.value, 0),
            deals_actual = deals_actual + 1
        WHERE user_id = NEW.owner_id
          AND org_id = NEW.org_id
          AND period_start <= CURRENT_DATE
          AND period_end >= CURRENT_DATE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deal_close_target
    AFTER UPDATE ON crm_deals
    FOR EACH ROW EXECUTE FUNCTION sales_update_target_on_deal_close();

-- 17. Function: Route a new lead to the right rep
CREATE OR REPLACE FUNCTION sales_route_lead(
    p_org_id UUID, p_state_code VARCHAR, p_source TEXT, p_industry TEXT
) RETURNS UUID AS $$
DECLARE
    v_rule RECORD;
    v_assign_to UUID;
    v_condition JSONB;
    v_match BOOLEAN;
BEGIN
    FOR v_rule IN
        SELECT * FROM sales_routing_rules
        WHERE org_id = p_org_id AND is_active = TRUE
        ORDER BY priority
    LOOP
        v_match := TRUE;
        FOR v_condition IN SELECT * FROM jsonb_array_elements(v_rule.conditions)
        LOOP
            IF (v_condition->>'field') = 'state_code' AND
               NOT (p_state_code = ANY(ARRAY(SELECT jsonb_array_elements_text(v_condition->'value')))) THEN
                v_match := FALSE;
            END IF;
            IF (v_condition->>'field') = 'source' AND p_source != (v_condition->>'value') THEN
                v_match := FALSE;
            END IF;
            IF (v_condition->>'field') = 'industry' AND p_industry != (v_condition->>'value') THEN
                v_match := FALSE;
            END IF;
        END LOOP;
        
        IF v_match THEN
            IF v_rule.assign_to IS NOT NULL THEN
                RETURN v_rule.assign_to;
            ELSIF array_length(v_rule.round_robin_users, 1) > 0 THEN
                v_assign_to := v_rule.round_robin_users[
                    (v_rule.round_robin_index % array_length(v_rule.round_robin_users, 1)) + 1
                ];
                UPDATE sales_routing_rules SET round_robin_index = round_robin_index + 1
                WHERE id = v_rule.id;
                RETURN v_assign_to;
            END IF;
        END IF;
    END LOOP;
    
    RETURN NULL;  -- no matching rule
END;
$$ LANGUAGE plpgsql;
```

---

## 3. Backend — FastAPI Router

Create `backend/routers/sales.py`:

```python
"""
Sales Operations Router
Targets, commissions, territories, playbooks, proposals, forecasting, leaderboard
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Optional
from uuid import UUID
from datetime import date, datetime, timedelta
from decimal import Decimal
from pydantic import BaseModel
from ..dependencies import get_current_user, get_db, require_role
from ..middleware.subscription import require_module

router = APIRouter(
    prefix="/api/v1/sales",
    tags=["Sales"],
    dependencies=[Depends(require_module("sales"))]
)


# ── Pydantic Models ──────────────────────────────────────────

class TargetCreate(BaseModel):
    user_id: UUID = None
    team_name: str = None
    territory_id: UUID = None
    period_type: str                     # monthly, quarterly, annual
    period_start: date
    period_end: date
    revenue_target: float = 0
    deals_target: int = 0
    leads_target: int = 0
    calls_target: int = 0
    meetings_target: int = 0

class TerritoryCreate(BaseModel):
    name: str
    type: str                            # region, state, city, zone, custom
    parent_id: UUID = None
    state_codes: list[str] = []
    city_names: list[str] = []
    assigned_to: list[UUID] = []
    manager_id: UUID = None

class CommissionSlabCreate(BaseModel):
    name: str
    slabs: list[dict]
    base_metric: str = "revenue"
    effective_from: date

class PlaybookCreate(BaseModel):
    title: str
    description: str = ""
    pipeline_id: UUID = None
    stages: list[dict] = []
    objection_handlers: list[dict] = []
    pitch_scripts: list[dict] = []
    resources: list[dict] = []

class ProposalCreate(BaseModel):
    template_id: UUID = None
    deal_id: UUID = None
    account_id: UUID = None
    contact_id: UUID = None
    title: str
    sections: list[dict] = []
    line_items: list[dict] = []
    validity_days: int = 30


# ── Targets ──────────────────────────────────────────────────

@router.get("/targets")
async def list_targets(
    period_type: str = None,
    user_id: UUID = None,
    user=Depends(get_current_user), db=Depends(get_db)
):
    query = db.table("sales_targets").select("*, users(name, email)").eq("org_id", str(user.org_id))
    if period_type:
        query = query.eq("period_type", period_type)
    if user_id:
        query = query.eq("user_id", str(user_id))
    return query.order("period_start", desc=True).execute().data

@router.post("/targets")
async def create_target(body: TargetCreate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id), "created_by": str(user.id)}
    # Convert UUIDs to strings
    if data.get("user_id"):
        data["user_id"] = str(data["user_id"])
    if data.get("territory_id"):
        data["territory_id"] = str(data["territory_id"])
    return db.table("sales_targets").insert(data).execute().data[0]

@router.get("/targets/my")
async def my_targets(user=Depends(get_current_user), db=Depends(get_db)):
    """Get current user's active targets."""
    return db.table("sales_targets").select("*").eq("user_id", str(user.id)).gte("period_end", date.today().isoformat()).order("period_start").execute().data


# ── Territories ──────────────────────────────────────────────

@router.get("/territories")
async def list_territories(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("sales_territories").select("*").eq("org_id", str(user.org_id)).order("name").execute().data

@router.post("/territories")
async def create_territory(body: TerritoryCreate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id)}
    return db.table("sales_territories").insert(data).execute().data[0]

@router.post("/leads/auto-route")
async def auto_route_lead(
    lead_id: UUID,
    state_code: str = None,
    source: str = None,
    industry: str = None,
    user=Depends(get_current_user), db=Depends(get_db)
):
    """Auto-assign a lead based on routing rules."""
    result = db.rpc("sales_route_lead", {
        "p_org_id": str(user.org_id),
        "p_state_code": state_code,
        "p_source": source,
        "p_industry": industry
    }).execute()
    
    assigned_to = result.data
    if assigned_to:
        db.table("crm_leads").update({"assigned_to": assigned_to}).eq("id", str(lead_id)).execute()
        return {"assigned_to": assigned_to}
    return {"assigned_to": None, "message": "No matching routing rule"}


# ── Commissions ──────────────────────────────────────────────

@router.get("/commissions/slabs")
async def list_commission_slabs(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("sales_commission_slabs").select("*").eq("org_id", str(user.org_id)).order("name").execute().data

@router.post("/commissions/slabs")
async def create_slab(body: CommissionSlabCreate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id)}
    return db.table("sales_commission_slabs").insert(data).execute().data[0]

@router.post("/commissions/assign")
async def assign_commission(
    user_id: UUID, slab_id: UUID, effective_from: date,
    user=Depends(require_role("admin", "director")), db=Depends(get_db)
):
    return db.table("sales_commission_assignments").insert({
        "org_id": str(user.org_id),
        "user_id": str(user_id),
        "slab_id": str(slab_id),
        "effective_from": effective_from.isoformat()
    }).execute().data[0]

@router.post("/commissions/compute")
async def compute_commissions(
    period_start: date, period_end: date,
    user=Depends(require_role("admin", "director")), db=Depends(get_db)
):
    """Compute commissions for all reps for a period."""
    assignments = db.table("sales_commission_assignments").select("user_id, slab_id").eq("org_id", str(user.org_id)).eq("is_active", True).execute()
    
    results = []
    for a in assignments.data:
        commission = db.rpc("sales_compute_commission", {
            "p_org_id": str(user.org_id),
            "p_user_id": a["user_id"],
            "p_period_start": period_start.isoformat(),
            "p_period_end": period_end.isoformat()
        }).execute()
        
        amount = commission.data or 0
        target = db.table("sales_targets").select("*").eq("user_id", a["user_id"]).eq("period_start", period_start.isoformat()).single().execute()
        
        record = db.table("sales_commissions").upsert({
            "org_id": str(user.org_id),
            "user_id": a["user_id"],
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "target_id": target.data["id"] if target.data else None,
            "slab_id": a["slab_id"],
            "achievement_pct": target.data.get("achievement_pct", 0) if target.data else 0,
            "base_amount": target.data.get("revenue_actual", 0) if target.data else 0,
            "commission_amount": amount,
            "status": "computed"
        }).execute()
        results.append(record.data[0] if record.data else None)
    
    return {"computed": len(results), "records": results}

@router.get("/commissions/my")
async def my_commissions(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("sales_commissions").select("*").eq("user_id", str(user.id)).order("period_start", desc=True).execute().data


# ── Playbooks ────────────────────────────────────────────────

@router.get("/playbooks")
async def list_playbooks(user=Depends(get_current_user), db=Depends(get_db)):
    return db.table("sales_playbooks").select("*").eq("org_id", str(user.org_id)).eq("is_active", True).execute().data

@router.post("/playbooks")
async def create_playbook(body: PlaybookCreate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    data = {**body.dict(), "org_id": str(user.org_id), "created_by": str(user.id)}
    return db.table("sales_playbooks").insert(data).execute().data[0]


# ── Proposals ────────────────────────────────────────────────

@router.get("/proposals")
async def list_proposals(
    status: str = None,
    user=Depends(get_current_user), db=Depends(get_db)
):
    query = db.table("sales_proposals").select("*, crm_accounts(name), crm_contacts(first_name, last_name)").eq("org_id", str(user.org_id))
    if status:
        query = query.eq("status", status)
    return query.order("created_at", desc=True).execute().data

@router.post("/proposals")
async def create_proposal(body: ProposalCreate, user=Depends(get_current_user), db=Depends(get_db)):
    # Generate proposal number
    number = db.rpc("sales_next_proposal_number", {"p_org_id": str(user.org_id)}).execute().data
    
    subtotal = sum(item.get("amount", 0) for item in body.line_items)
    discount = subtotal * (body.dict().get("discount_pct", 0) / 100)
    total = subtotal - discount
    
    import secrets
    data = {
        **body.dict(),
        "org_id": str(user.org_id),
        "proposal_number": number,
        "subtotal": subtotal,
        "total": total,
        "valid_until": (date.today() + timedelta(days=body.validity_days)).isoformat(),
        "public_link_token": secrets.token_urlsafe(32),
        "created_by": str(user.id)
    }
    return db.table("sales_proposals").insert(data).execute().data[0]

@router.get("/proposals/public/{token}")
async def view_proposal_public(token: str, db=Depends(get_db)):
    """Public endpoint — view proposal via shared link."""
    proposal = db.table("sales_proposals").select("*, crm_accounts(name), organisations(name, logo_url)").eq("public_link_token", token).single().execute()
    if not proposal.data:
        raise HTTPException(404, "Proposal not found")
    
    # Track view
    if not proposal.data.get("viewed_at"):
        db.table("sales_proposals").update({
            "status": "viewed",
            "viewed_at": datetime.utcnow().isoformat()
        }).eq("id", proposal.data["id"]).execute()
    
    return proposal.data

@router.post("/proposals/{proposal_id}/sign")
async def sign_proposal(
    proposal_id: UUID,
    signer_name: str,
    signature_data: dict,               # {type: "drawn", image_url: "..."}
    db=Depends(get_db)
):
    """Public endpoint — sign a proposal."""
    db.table("sales_proposals").update({
        "signature_status": "signed",
        "signer_name": signer_name,
        "signed_at": datetime.utcnow().isoformat(),
        "signature_data": signature_data,
        "status": "accepted"
    }).eq("id", str(proposal_id)).execute()
    return {"status": "signed"}


# ── Leaderboard ──────────────────────────────────────────────

@router.get("/leaderboard")
async def get_leaderboard(
    period_type: str = "monthly",
    period_start: date = None,
    user=Depends(get_current_user), db=Depends(get_db)
):
    if not period_start:
        period_start = date.today().replace(day=1)
    
    return db.table("sales_leaderboard").select("*, users(name, email, profile_photo_url)").eq("org_id", str(user.org_id)).eq("period_type", period_type).eq("period_start", period_start.isoformat()).order("rank").execute().data

@router.post("/leaderboard/refresh")
async def refresh_leaderboard(
    period_type: str = "monthly",
    user=Depends(require_role("admin", "director")), db=Depends(get_db)
):
    """Recalculate leaderboard from deal data."""
    period_start = date.today().replace(day=1)
    if period_type == "quarterly":
        quarter_month = ((date.today().month - 1) // 3) * 3 + 1
        period_start = date.today().replace(month=quarter_month, day=1)
    elif period_type == "annual":
        period_start = date.today().replace(month=4, day=1)  # Indian fiscal year
        if date.today().month < 4:
            period_start = period_start.replace(year=date.today().year - 1)
    
    # Get all reps with deals
    deals = db.table("crm_deals").select("owner_id, value, won_at, lost_at, created_at").eq("org_id", str(user.org_id)).gte("created_at", period_start.isoformat()).execute()
    
    rep_stats = {}
    for d in deals.data:
        rep = d["owner_id"]
        if rep not in rep_stats:
            rep_stats[rep] = {"revenue": 0, "won": 0, "total": 0, "pipeline": 0, "values": []}
        rep_stats[rep]["total"] += 1
        if d.get("won_at"):
            rep_stats[rep]["won"] += 1
            rep_stats[rep]["revenue"] += d.get("value", 0) or 0
            rep_stats[rep]["values"].append(d.get("value", 0) or 0)
        elif not d.get("lost_at"):
            rep_stats[rep]["pipeline"] += d.get("value", 0) or 0
    
    # Rank by revenue
    sorted_reps = sorted(rep_stats.items(), key=lambda x: x[1]["revenue"], reverse=True)
    
    for rank, (rep_id, stats) in enumerate(sorted_reps, 1):
        target = db.table("sales_targets").select("revenue_target").eq("user_id", rep_id).eq("period_start", period_start.isoformat()).execute()
        target_val = target.data[0]["revenue_target"] if target.data else 0
        
        db.table("sales_leaderboard").upsert({
            "org_id": str(user.org_id),
            "user_id": rep_id,
            "period_type": period_type,
            "period_start": period_start.isoformat(),
            "revenue_closed": stats["revenue"],
            "deals_closed": stats["won"],
            "deals_in_progress": stats["total"] - stats["won"],
            "pipeline_value": stats["pipeline"],
            "conversion_rate": round(stats["won"] / stats["total"] * 100, 2) if stats["total"] > 0 else 0,
            "avg_deal_size": round(sum(stats["values"]) / len(stats["values"]), 2) if stats["values"] else 0,
            "rank": rank,
            "achievement_pct": round(stats["revenue"] / target_val * 100, 2) if target_val > 0 else 0,
            "updated_at": datetime.utcnow().isoformat()
        }).execute()
    
    return {"refreshed": len(sorted_reps)}


# ── Forecasting ──────────────────────────────────────────────

@router.get("/forecast")
async def get_forecast(
    period_type: str = "monthly",
    user=Depends(get_current_user), db=Depends(get_db)
):
    """Weighted pipeline forecast for current period."""
    period_start = date.today().replace(day=1)
    
    deals = (db.table("crm_deals")
        .select("*, crm_pipelines(stages)")
        .eq("org_id", str(user.org_id))
        .is_("won_at", "null")
        .is_("lost_at", "null")
        .execute())
    
    weighted = 0
    best_case = 0
    committed = 0
    stage_breakdown = {}
    
    for d in deals.data:
        value = d.get("value", 0) or 0
        prob = d.get("probability", 50) / 100
        weighted += value * prob
        best_case += value
        if prob >= 0.75:
            committed += value
        
        stage = d.get("stage", "Unknown")
        if stage not in stage_breakdown:
            stage_breakdown[stage] = {"count": 0, "value": 0}
        stage_breakdown[stage]["count"] += 1
        stage_breakdown[stage]["value"] += value
    
    # Add closed-won this period
    won = db.table("crm_deals").select("value").eq("org_id", str(user.org_id)).gte("won_at", period_start.isoformat()).execute()
    closed_won = sum(d.get("value", 0) or 0 for d in won.data)
    
    return {
        "period_type": period_type,
        "period_start": period_start.isoformat(),
        "weighted_pipeline": round(weighted, 2),
        "best_case": round(best_case, 2),
        "committed": round(committed, 2),
        "closed_won": round(closed_won, 2),
        "total_forecast": round(closed_won + weighted, 2),
        "stage_breakdown": stage_breakdown,
        "open_deals": len(deals.data)
    }
```

---

## 4. Frontend — React Components

```
src/
  pages/
    SalesDashboard.jsx           # Overview: targets, pipeline, leaderboard
  components/
    sales/
      TargetTracker.jsx          # Progress bars per target metric
      TargetSetup.jsx            # Admin: create/edit targets
      CommissionSlabEditor.jsx   # Admin: define commission slabs
      CommissionReport.jsx       # Rep: view own commissions; Admin: all
      TerritoryMap.jsx           # Visual territory hierarchy + assignment
      RoutingRuleBuilder.jsx     # Admin: define lead routing rules
      PlaybookViewer.jsx         # Stage-by-stage playbook with scripts
      PlaybookEditor.jsx         # Admin: create/edit playbooks
      ProposalBuilder.jsx        # Build proposal from template + line items
      ProposalViewer.jsx         # Public view + e-sign
      LeaderboardTable.jsx       # Rankings with avatars, sparklines
      ForecastChart.jsx          # Weighted pipeline funnel/waterfall chart
  hooks/
    useSales.js                  # React Query hooks
```

---

## 5. Implementation Steps

1. `git checkout -b feature/sales-module staging`
2. Run `017_sales_module.sql`
3. Build `sales.py` router
4. Build territory + routing system first (foundational)
5. Build target + commission engine
6. Build playbook editor/viewer
7. Build proposal system with PDF generation + public links + e-sign
8. Build leaderboard + forecast
9. Build `SalesDashboard.jsx` with all components
10. Tests

---

## 6. Test Cases

```python
# tests/test_sales.py

async def test_create_target():
    """Create monthly revenue target for a rep."""

async def test_target_achievement_auto_updates():
    """Close a deal → target.revenue_actual incremented."""

async def test_commission_slab_calculation():
    """Rep at 120% achievement with slabs → correct commission computed."""

async def test_commission_zero_below_threshold():
    """Rep at 0% achievement → 0 commission."""

async def test_commission_accelerator():
    """Rep at 160% → accelerator slab rate applied."""

async def test_territory_hierarchy():
    """Create region → state under region → rep assigned to state."""

async def test_lead_routing_by_state():
    """Lead with state_code=27 → routed to Maharashtra territory rep."""

async def test_lead_routing_round_robin():
    """3 leads routed → distributed across round-robin reps."""

async def test_proposal_number_sequence():
    """Create 3 proposals → KP-2026-0001, KP-2026-0002, KP-2026-0003."""

async def test_proposal_public_view():
    """Access proposal via public token → status changes to 'viewed'."""

async def test_proposal_sign():
    """Sign proposal → signature_status=signed, status=accepted."""

async def test_leaderboard_ranking():
    """3 reps with different revenue → ranked correctly."""

async def test_forecast_weighted_pipeline():
    """3 deals at different probabilities → weighted sum correct."""

async def test_playbook_creation():
    """Create playbook with stages, objection handlers, scripts."""

async def test_routing_no_match():
    """Lead with unmatched criteria → returns null."""
```
