-- ============================================================
-- Migration 023: CRM Phase 1 + Phase 3
-- Phase 1: Lead scoring config, sales automation rules
-- Phase 3: Custom fields, web forms, territory assignments
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- Phase 1: Lead Scoring Configuration
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_scoring_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    signal TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_scoring_org ON staging.graha_scoring_rules(org_id) WHERE is_active;

INSERT INTO staging.graha_scoring_rules (org_id, signal, points, description)
SELECT o.id, s.signal, s.points, s.description
FROM staging.organisations o
CROSS JOIN (VALUES
    ('has_phone', 10, 'Contact has phone number'),
    ('has_email', 5, 'Contact has email'),
    ('source_indiamart', 15, 'Lead from IndiaMART'),
    ('source_justdial', 12, 'Lead from JustDial'),
    ('source_website', 8, 'Lead from website'),
    ('has_deal', 20, 'Has an associated deal'),
    ('deal_qualified', 10, 'Deal moved to Qualified'),
    ('deal_proposal', 15, 'Deal moved to Proposal'),
    ('deal_negotiation', 20, 'Deal in Negotiation'),
    ('activity_call', 5, 'Had a call logged'),
    ('activity_meeting', 10, 'Had a meeting logged'),
    ('activity_recent_7d', 10, 'Activity in last 7 days'),
    ('high_value_deal', 15, 'Deal value > ₹1L'),
    ('multiple_deals', 10, 'Has 2+ deals'),
    ('followup_overdue', -10, 'Has overdue follow-up')
) AS s(signal, points, description)
WHERE o.is_active = TRUE
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- Phase 1: Sales Automation Rules
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL
        CHECK (trigger_type IN (
            'lead_created', 'deal_stage_changed', 'deal_created',
            'activity_created', 'contact_updated', 'deal_stale',
            'followup_overdue'
        )),
    conditions JSONB DEFAULT '{}',
    action_type TEXT NOT NULL
        CHECK (action_type IN (
            'assign_to', 'create_followup', 'create_activity',
            'update_score', 'change_stage', 'send_notification',
            'add_label'
        )),
    action_data JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    run_count INTEGER DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_automations_org ON staging.graha_automations(org_id, trigger_type) WHERE is_active;

CREATE TABLE IF NOT EXISTS staging.graha_automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    automation_id UUID NOT NULL REFERENCES staging.graha_automations(id) ON DELETE CASCADE,
    trigger_data JSONB DEFAULT '{}',
    result TEXT CHECK (result IN ('success', 'error', 'skipped')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_auto_logs_org ON staging.graha_automation_logs(org_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- Phase 3: Custom Fields
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_custom_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'deal')),
    field_name TEXT NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'checkbox', 'url', 'email', 'phone')),
    options JSONB DEFAULT '[]',
    is_required BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, entity_type, field_name)
);

CREATE INDEX idx_graha_custom_fields_org ON staging.graha_custom_fields(org_id, entity_type) WHERE is_active;

-- Custom field values stored in the existing JSONB columns:
-- graha_contacts.billing_address is repurposed as custom_fields via a new column
ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

ALTER TABLE staging.graha_deals
    ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════
-- Phase 3: Web-to-Lead Forms
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_web_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    fields JSONB NOT NULL DEFAULT '[
        {"name":"name","label":"Name","type":"text","required":true},
        {"name":"email","label":"Email","type":"email","required":true},
        {"name":"phone","label":"Phone","type":"tel","required":false},
        {"name":"company","label":"Company","type":"text","required":false},
        {"name":"message","label":"Message","type":"textarea","required":false}
    ]',
    settings JSONB DEFAULT '{}',
    auto_assign_to UUID,
    auto_source TEXT DEFAULT 'web_form',
    auto_labels UUID[] DEFAULT '{}',
    submission_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, slug)
);

CREATE INDEX idx_graha_web_forms_org ON staging.graha_web_forms(org_id);
CREATE UNIQUE INDEX idx_graha_web_forms_slug ON staging.graha_web_forms(slug) WHERE is_active;

CREATE TABLE IF NOT EXISTS staging.graha_web_form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    form_id UUID NOT NULL REFERENCES staging.graha_web_forms(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}',
    contact_id UUID REFERENCES staging.graha_contacts(id),
    ip_address TEXT,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'processed', 'spam')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_submissions_form ON staging.graha_web_form_submissions(form_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- Phase 3: Territory / Team Assignment
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_territories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    assigned_users UUID[] DEFAULT '{}',
    rules JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, name)
);

CREATE INDEX idx_graha_territories_org ON staging.graha_territories(org_id);

-- Add territory to contacts and deals
ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS territory_id UUID REFERENCES staging.graha_territories(id);

ALTER TABLE staging.graha_deals
    ADD COLUMN IF NOT EXISTS territory_id UUID REFERENCES staging.graha_territories(id);

-- Round-robin state for lead distribution
ALTER TABLE staging.graha_territories
    ADD COLUMN IF NOT EXISTS round_robin_index INTEGER DEFAULT 0;
