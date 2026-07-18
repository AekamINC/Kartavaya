-- Graha Clients (Company entity)
-- Contacts, deals, and invoices link to a client company.

CREATE TABLE IF NOT EXISTS staging.graha_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ref_no TEXT,
    gstin TEXT,
    address JSONB DEFAULT '{}',
    website TEXT,
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    created_by TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_clients_org ON staging.graha_clients(org_id);
CREATE UNIQUE INDEX idx_graha_clients_ref ON staging.graha_clients(org_id, ref_no) WHERE ref_no IS NOT NULL;

-- Link contacts to clients
ALTER TABLE staging.graha_contacts ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES staging.graha_clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_graha_contacts_client ON staging.graha_contacts(client_id);

-- Link deals to clients
ALTER TABLE staging.graha_deals ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES staging.graha_clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_graha_deals_client ON staging.graha_deals(client_id);

-- Link invoices to clients
ALTER TABLE staging.ganit_invoices ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES staging.graha_clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ganit_invoices_client ON staging.ganit_invoices(client_id);
