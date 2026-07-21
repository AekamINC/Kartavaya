-- 045: Document Repository
CREATE TABLE IF NOT EXISTS staging.graha_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT DEFAULT 0,
    mime_type TEXT DEFAULT '',
    folder TEXT DEFAULT '',
    tags JSONB DEFAULT '[]',
    contact_id UUID REFERENCES staging.graha_contacts(id),
    deal_id UUID REFERENCES staging.graha_deals(id),
    description TEXT DEFAULT '',
    uploaded_by TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_org ON staging.graha_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_documents_contact ON staging.graha_documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal ON staging.graha_documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON staging.graha_documents(org_id, folder);
