-- Manav — Employee expense claims & reimbursement (Odoo features plan, Tier 1 #1)
-- Distinct from ganit_expenses (client-billable business expenses): this is
-- employee-submitted, manager-approved, and paid out via Vetana payroll.

CREATE TABLE IF NOT EXISTS staging.manav_expense_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'other',
    expense_date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    receipt_urls JSONB DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    payslip_id UUID REFERENCES staging.vetana_payslips(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_claims_org ON staging.manav_expense_claims(org_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_emp ON staging.manav_expense_claims(employee_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_status ON staging.manav_expense_claims(org_id, status);

ALTER TABLE staging.vetana_payslips ADD COLUMN IF NOT EXISTS reimbursements DECIMAL(14,2) DEFAULT 0;
