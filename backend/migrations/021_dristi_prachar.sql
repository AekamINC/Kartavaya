-- Migration 021: Dristi (Analytics) + Prachar (Marketing) modules
-- 2026-07-11

-- ── Dristi: Saved Dashboards ────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.dristi_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    widgets JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN DEFAULT FALSE,
    created_by UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dristi_dashboards_org ON staging.dristi_dashboards(org_id);

-- ── Prachar: Email Templates ────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.prachar_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    category TEXT DEFAULT 'general',
    variables JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prachar_templates_org ON staging.prachar_templates(org_id);

-- ── Prachar: Campaigns ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.prachar_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_id UUID REFERENCES staging.prachar_templates(id),
    subject TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    channel TEXT DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'whatsapp')),
    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled')),
    audience_filter JSONB DEFAULT '{}',
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    total_recipients INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_bounced INTEGER DEFAULT 0,
    total_unsubscribed INTEGER DEFAULT 0,
    created_by UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prachar_campaigns_org ON staging.prachar_campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_prachar_campaigns_status ON staging.prachar_campaigns(org_id, status);

-- ── Prachar: Campaign Recipients ────────────────────────────

CREATE TABLE IF NOT EXISTS staging.prachar_campaign_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES staging.prachar_campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES staging.graha_contacts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'failed')),
    sent_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prachar_cc_campaign ON staging.prachar_campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_prachar_cc_contact ON staging.prachar_campaign_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_prachar_cc_status ON staging.prachar_campaign_contacts(campaign_id, status);

-- ── Prachar: Marketing Automations ──────────────────────────

CREATE TABLE IF NOT EXISTS staging.prachar_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL
        CHECK (trigger_type IN ('contact_created', 'contact_converted', 'deal_won', 'deal_lost', 'label_added', 'score_above', 'manual')),
    trigger_config JSONB DEFAULT '{}',
    action_type TEXT NOT NULL
        CHECK (action_type IN ('send_email', 'add_label', 'update_score', 'create_follow_up', 'notify_owner')),
    action_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    run_count INTEGER DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prachar_automations_org ON staging.prachar_automations(org_id);
CREATE INDEX IF NOT EXISTS idx_prachar_automations_trigger ON staging.prachar_automations(org_id, trigger_type) WHERE is_active;

-- ── Prachar: Unsubscribe list ───────────────────────────────

CREATE TABLE IF NOT EXISTS staging.prachar_unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    reason TEXT,
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_prachar_unsub_org ON staging.prachar_unsubscribes(org_id);
