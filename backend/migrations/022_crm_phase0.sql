-- ============================================================
-- Migration 022: CRM Phase 0
-- Security fixes: OAuth state table
-- Features: contact→project link, inbound lead capture
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- OAuth state (replaces process-local dict for multi-worker safety)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.hub_oauth_states (
    state TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup: states older than 10 minutes are stale
CREATE INDEX idx_hub_oauth_states_ttl ON staging.hub_oauth_states(created_at);

-- ═══════════════════════════════════════════════════════════
-- Contact → Project link
-- ═══════════════════════════════════════════════════════════

ALTER TABLE staging.projects
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES staging.graha_contacts(id);

CREATE INDEX IF NOT EXISTS idx_projects_contact
    ON staging.projects(contact_id) WHERE contact_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- Inbound lead capture (IndiaMART / JustDial email parsing)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_inbound_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    subject TEXT,
    body_text TEXT,
    parsed_data JSONB DEFAULT '{}',
    contact_id UUID REFERENCES staging.graha_contacts(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('parsed', 'failed', 'duplicate', 'pending')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_inbound_org ON staging.graha_inbound_emails(org_id, created_at DESC);

-- Dedup index: one contact per phone per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_graha_contacts_org_phone
    ON staging.graha_contacts(org_id, phone)
    WHERE phone IS NOT NULL AND phone != '';
