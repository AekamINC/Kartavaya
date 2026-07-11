-- ============================================================
-- Migration 019: CRM Enhancements from NN Tours audit
-- Adds: follow-ups, expenses, contracts, recurring invoices,
--        announcements, invoice lifecycle, estimate workflow,
--        AI feedback tracking
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- GRAHA · ग्राह — Follow-ups, labels, companies
-- ═══════════════════════════════════════════════════════════

-- Follow-up reminders (private per user, linked to contacts/deals)
CREATE TABLE staging.graha_follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES staging.graha_contacts(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES staging.graha_deals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_at TIMESTAMPTZ NOT NULL,
    remind_at TIMESTAMPTZ,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    assigned_to UUID NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_followups_org ON staging.graha_follow_ups(org_id);
CREATE INDEX idx_graha_followups_due ON staging.graha_follow_ups(assigned_to, due_at) WHERE NOT is_completed;
CREATE INDEX idx_graha_followups_contact ON staging.graha_follow_ups(contact_id);

-- Customer labels / groups for segmentation
CREATE TABLE staging.graha_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, name)
);

-- Junction table: contacts can have many labels, labels can have many contacts
CREATE TABLE staging.graha_contact_labels (
    contact_id UUID NOT NULL REFERENCES staging.graha_contacts(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES staging.graha_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, label_id)
);

-- Add lead score and owner to contacts
ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
    ADD COLUMN IF NOT EXISTS lead_score_reasons JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS assigned_to UUID,
    ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

-- Add owner to deals for "My deals" filtering
ALTER TABLE staging.graha_deals
    ADD COLUMN IF NOT EXISTS owner_id UUID;

-- ═══════════════════════════════════════════════════════════
-- GANIT · गणित — Invoice lifecycle, estimates, expenses, contracts
-- ═══════════════════════════════════════════════════════════

-- Add document status (lifecycle) separate from payment status
ALTER TABLE staging.ganit_invoices
    ADD COLUMN IF NOT EXISTS doc_status TEXT DEFAULT 'final'
        CHECK (doc_status IN ('draft', 'final', 'sent', 'viewed')),
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS recurring_id UUID,
    ADD COLUMN IF NOT EXISTS estimate_status TEXT
        CHECK (estimate_status IN ('draft', 'sent', 'accepted', 'rejected', 'converted')),
    ADD COLUMN IF NOT EXISTS converted_invoice_id UUID REFERENCES staging.ganit_invoices(id);

-- Recurring invoice definitions
CREATE TABLE staging.ganit_recurring (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES staging.graha_contacts(id),
    template_items JSONB NOT NULL DEFAULT '[]',
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
    gst_rate DECIMAL(5,2) DEFAULT 18.00,
    is_igst BOOLEAN DEFAULT FALSE,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
    next_date DATE NOT NULL,
    end_date DATE,
    auto_send BOOLEAN DEFAULT FALSE,
    notes TEXT,
    terms TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ganit_recurring_org ON staging.ganit_recurring(org_id);
CREATE INDEX idx_ganit_recurring_next ON staging.ganit_recurring(next_date) WHERE is_active;

-- Expenses
CREATE TABLE staging.ganit_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    amount DECIMAL(14,2) NOT NULL,
    tax_amount DECIMAL(14,2) DEFAULT 0,
    total DECIMAL(14,2) NOT NULL,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vendor TEXT,
    reference TEXT,
    notes TEXT,
    receipt_urls TEXT[] DEFAULT '{}',
    is_billable BOOLEAN DEFAULT FALSE,
    contact_id UUID REFERENCES staging.graha_contacts(id),
    project_id UUID,
    created_by UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ganit_expenses_org ON staging.ganit_expenses(org_id);
CREATE INDEX idx_ganit_expenses_date ON staging.ganit_expenses(org_id, expense_date);
CREATE INDEX idx_ganit_expenses_category ON staging.ganit_expenses(org_id, category);

-- Contracts
CREATE TABLE staging.ganit_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES staging.graha_contacts(id),
    title TEXT NOT NULL,
    description TEXT,
    contract_value DECIMAL(14,2) DEFAULT 0,
    start_date DATE,
    end_date DATE,
    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'expired', 'cancelled', 'renewed')),
    renewal_reminder_days INTEGER DEFAULT 30,
    file_url TEXT,
    notes TEXT,
    created_by UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ganit_contracts_org ON staging.ganit_contracts(org_id);
CREATE INDEX idx_ganit_contracts_status ON staging.ganit_contracts(org_id, status);
CREATE INDEX idx_ganit_contracts_end ON staging.ganit_contracts(end_date) WHERE status = 'active';

-- Expense categories (configurable per org)
CREATE TABLE staging.ganit_expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📁',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, name)
);

-- Seed default expense categories
-- (Will be inserted per-org on first use via the API)

-- ═══════════════════════════════════════════════════════════
-- MANAV · मानव — Announcements, performance
-- ═══════════════════════════════════════════════════════════

CREATE TABLE staging.manav_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    priority TEXT DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    pinned BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manav_announcements_org ON staging.manav_announcements(org_id);
CREATE INDEX idx_manav_announcements_active ON staging.manav_announcements(org_id, published_at)
    WHERE is_active;

-- ═══════════════════════════════════════════════════════════
-- CROSS-MODULE: AI feedback tracking
-- ═══════════════════════════════════════════════════════════

CREATE TABLE staging.ai_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    skill_type TEXT NOT NULL,
    context_type TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('accept', 'edit', 'reject')),
    ai_output JSONB NOT NULL,
    edited_output JSONB,
    model_used TEXT,
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,6) DEFAULT 0,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_feedback_org ON staging.ai_feedback(org_id);
CREATE INDEX idx_ai_feedback_skill ON staging.ai_feedback(org_id, skill_type, action);

-- AI conversation memory (short-term, per user per context)
CREATE TABLE staging.ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    context_type TEXT NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, user_id, context_type)
);

CREATE INDEX idx_ai_conversations_user ON staging.ai_conversations(org_id, user_id);
