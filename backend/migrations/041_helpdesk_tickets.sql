-- 041: Helpdesk / Support Tickets
CREATE TABLE IF NOT EXISTS staging.graha_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES staging.graha_contacts(id),
    subject TEXT NOT NULL,
    description TEXT DEFAULT '',
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
    category TEXT DEFAULT '',
    assigned_to TEXT,
    sla_due_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_org ON staging.graha_tickets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_contact ON staging.graha_tickets(contact_id);

CREATE TABLE IF NOT EXISTS staging.graha_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES staging.graha_tickets(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('agent', 'contact')),
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL,
    attachment_urls JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages ON staging.graha_ticket_messages(ticket_id);
