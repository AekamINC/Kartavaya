-- 040: Approval Chains for deals & vendor bills
CREATE TABLE IF NOT EXISTS staging.graha_approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('deal', 'vendor_bill', 'expense_claim')),
    threshold_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    approver_role TEXT NOT NULL DEFAULT 'org_admin',
    description TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_rules_org ON staging.graha_approval_rules(org_id, entity_type);

CREATE TABLE IF NOT EXISTS staging.graha_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES staging.graha_approval_rules(id),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    amount DECIMAL(14,2) DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by TEXT NOT NULL,
    approved_by TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON staging.graha_approval_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_entity ON staging.graha_approval_requests(entity_type, entity_id);
