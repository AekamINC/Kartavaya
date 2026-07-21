-- Ganit — Vendor bills & accounts payable (Odoo features plan, Tier 1 #2)

CREATE TABLE IF NOT EXISTS staging.ganit_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gstin TEXT,
    email TEXT,
    phone TEXT,
    address JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ganit_vendors_org ON staging.ganit_vendors(org_id);

CREATE TABLE IF NOT EXISTS staging.ganit_vendor_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES staging.ganit_vendors(id),
    bill_number TEXT,
    internal_ref TEXT NOT NULL,
    bill_date DATE NOT NULL,
    due_date DATE,
    line_items JSONB NOT NULL DEFAULT '[]',
    subtotal DECIMAL(14,2) DEFAULT 0,
    cgst DECIMAL(14,2) DEFAULT 0,
    sgst DECIMAL(14,2) DEFAULT 0,
    igst DECIMAL(14,2) DEFAULT 0,
    total DECIMAL(14,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(14,2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'cancelled')),
    attachment_url TEXT,
    notes TEXT,
    created_by TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_bills_org ON staging.ganit_vendor_bills(org_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bills_status ON staging.ganit_vendor_bills(org_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_bills_vendor ON staging.ganit_vendor_bills(vendor_id);

CREATE TABLE IF NOT EXISTS staging.ganit_vendor_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    bill_id UUID NOT NULL REFERENCES staging.ganit_vendor_bills(id) ON DELETE CASCADE,
    amount DECIMAL(14,2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    method TEXT,
    reference TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_bill ON staging.ganit_vendor_payments(bill_id);
