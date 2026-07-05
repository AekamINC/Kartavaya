-- ============================================================
-- Migration 010: Staging schema + Subscription & Billing tables
-- All new module tables live in the `staging` schema.
-- Org bridge links production team_id to staging org_id.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS staging;

-- 0. Organisation bridge
CREATE TABLE staging.organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    gstin TEXT,
    pan TEXT,
    billing_address JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stg_org_team ON staging.organisations(team_id);

-- 1. Plans
CREATE TABLE staging.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE CHECK (code IN ('free', 'professional', 'business', 'enterprise')),
    price_monthly DECIMAL(10,2) NOT NULL,
    price_annual DECIMAL(10,2) NOT NULL,
    max_users INTEGER,
    features JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add-On Modules
CREATE TABLE staging.add_on_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    price_per_user_monthly DECIMAL(8,2) NOT NULL,
    requires_module TEXT[] DEFAULT '{}',
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Subscriptions (one per org)
CREATE TABLE staging.subscriptions (
    org_id UUID PRIMARY KEY REFERENCES staging.organisations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES staging.plans(id),
    billing_cycle TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_cycle IN ('monthly', 'annual')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'paused')),
    trial_ends_at TIMESTAMPTZ,
    current_period_start DATE,
    current_period_end DATE,
    next_billing_date DATE,
    activated_by UUID,
    notes TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Module Subscriptions
CREATE TABLE staging.module_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL,
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(org_id, module_code)
);

CREATE INDEX idx_mod_sub_org ON staging.module_subscriptions(org_id);
CREATE INDEX idx_mod_sub_active ON staging.module_subscriptions(org_id, is_active) WHERE is_active = TRUE;

-- 5. Subscription Invoices
CREATE TABLE staging.subscription_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL UNIQUE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    line_items JSONB NOT NULL DEFAULT '[]',
    subtotal DECIMAL(12,2) NOT NULL,
    gst DECIMAL(12,2) NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    payment_status TEXT DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_method TEXT,
    payment_reference TEXT,
    collected_by UUID,
    approved_by UUID,
    due_date DATE,
    paid_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    pdf_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_inv_org ON staging.subscription_invoices(org_id);
CREATE INDEX idx_inv_overdue ON staging.subscription_invoices(due_date, payment_status)
    WHERE payment_status = 'pending';

-- 6. Usage Tracking
CREATE TABLE staging.usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    value DECIMAL(12,2) NOT NULL,
    recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE(org_id, metric, recorded_at)
);

CREATE INDEX idx_usage_org ON staging.usage_tracking(org_id, metric);

-- 7. Subscription Events (audit log)
CREATE TABLE staging.subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_events_org ON staging.subscription_events(org_id);
CREATE INDEX idx_sub_events_type ON staging.subscription_events(event_type, created_at);

-- 8. Seed Plans
INSERT INTO staging.plans (name, code, price_monthly, price_annual, max_users, features) VALUES
('Free', 'free', 0, 0, 5, '{"tasks": true, "projects": true, "docs": true, "kanban": true}'),
('Professional', 'professional', 99, 990, NULL, '{"tasks": true, "projects": true, "docs": true, "kanban": true, "addons": true, "api_access": true}'),
('Business', 'business', 149, 1490, NULL, '{"tasks": true, "projects": true, "docs": true, "kanban": true, "addons": true, "api_access": true, "priority_support": true, "custom_branding": true}'),
('Enterprise', 'enterprise', 249, 2490, NULL, '{"tasks": true, "projects": true, "docs": true, "kanban": true, "addons": true, "api_access": true, "priority_support": true, "custom_branding": true, "dedicated_support": true, "custom_integrations": true, "sla": true}');

-- 9. Seed Add-On Modules
INSERT INTO staging.add_on_modules (name, code, price_per_user_monthly, requires_module, description) VALUES
('Graha · ग्राह (CRM)', 'graha', 49, '{}', 'Lead management, deal pipeline, GST quotations & invoices'),
('Ganit · गणित (GST Invoicing)', 'ganit', 29, '{graha}', 'CGST/SGST/IGST compliant invoicing with HSN codes'),
('Manav · मानव (HRMS)', 'manav', 39, '{}', 'Employee directory, attendance, leave management'),
('Pahchan · पहचान (Biometric)', 'pahchan', 19, '{manav}', 'Facial recognition, fingerprint, geo-fenced attendance'),
('Vetana · वेतन (Payroll)', 'vetana', 59, '{manav}', 'Salary computation, PF/ESI/TDS, payslips'),
('Sanvaad · संवाद (WhatsApp)', 'sanvaad', 29, '{}', 'WhatsApp Business API integration, templates, broadcasts'),
('Dristi · दृष्टि (Analytics)', 'dristi', 19, '{}', 'Custom dashboards, scheduled reports, data export');
