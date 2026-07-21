-- Vetana — Employee loans & salary advances (Odoo features plan, Tier 1 #5)

CREATE TABLE IF NOT EXISTS staging.vetana_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    principal_amount DECIMAL(12,2) NOT NULL,
    emi_amount DECIMAL(12,2) NOT NULL,
    balance_remaining DECIMAL(12,2) NOT NULL,
    disbursed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'written_off')),
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vetana_loans_org ON staging.vetana_loans(org_id);
CREATE INDEX IF NOT EXISTS idx_vetana_loans_emp ON staging.vetana_loans(employee_id);
CREATE INDEX IF NOT EXISTS idx_vetana_loans_status ON staging.vetana_loans(org_id, status);

ALTER TABLE staging.vetana_payslips ADD COLUMN IF NOT EXISTS loan_deduction DECIMAL(14,2) DEFAULT 0;
-- [{loan_id, amount}] snapshot at processing time; applied to vetana_loans.balance_remaining on run approval
ALTER TABLE staging.vetana_payslips ADD COLUMN IF NOT EXISTS loan_deductions JSONB DEFAULT '[]';
