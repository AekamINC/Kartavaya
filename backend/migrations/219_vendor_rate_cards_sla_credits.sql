-- 219 · Vendor Rate Cards + SLA Credits (proposal 87, P5.4)
--
-- Risk: LOW — all ADDs, no rewrite.
-- Shared DB: staging+production both write to staging schema.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.vendor_rate_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id),
    vendor_id UUID NOT NULL REFERENCES staging.ganit_vendors(id),
    item_category TEXT NOT NULL DEFAULT '',
    rate NUMERIC(14,2) NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '',
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    proration_clause BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_cards_org
    ON staging.vendor_rate_cards (org_id);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_cards_org_vendor
    ON staging.vendor_rate_cards (org_id, vendor_id);

CREATE TABLE IF NOT EXISTS staging.vendor_sla_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id),
    vendor_id UUID NOT NULL REFERENCES staging.ganit_vendors(id),
    rate_card_id UUID REFERENCES staging.vendor_rate_cards(id),
    sla_metric TEXT NOT NULL DEFAULT '',
    threshold NUMERIC(14,4) NOT NULL DEFAULT 0,
    actual NUMERIC(14,4) NOT NULL DEFAULT 0,
    credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    period DATE NOT NULL,
    applied_to_bill UUID REFERENCES staging.ganit_vendor_bills(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'waived')),
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_sla_credits_org
    ON staging.vendor_sla_credits (org_id);

CREATE INDEX IF NOT EXISTS idx_vendor_sla_credits_org_vendor
    ON staging.vendor_sla_credits (org_id, vendor_id);

ALTER TABLE staging.ganit_vendor_bills
    ADD COLUMN IF NOT EXISTS sla_credit_applied NUMERIC(14,2) DEFAULT 0;

COMMIT;
