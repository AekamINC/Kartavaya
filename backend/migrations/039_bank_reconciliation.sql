-- 039: Bank Reconciliation
CREATE TABLE IF NOT EXISTS staging.ganit_bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    statement_date DATE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    reference TEXT DEFAULT '',
    amount DECIMAL(14,2) NOT NULL,
    running_balance DECIMAL(14,2),
    matched_payment_id UUID,
    matched_type TEXT CHECK (matched_type IS NULL OR matched_type IN ('invoice_payment', 'vendor_payment')),
    is_reconciled BOOLEAN DEFAULT FALSE,
    batch_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_lines_org ON staging.ganit_bank_statement_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_bank_lines_batch ON staging.ganit_bank_statement_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_bank_lines_unmatched ON staging.ganit_bank_statement_lines(org_id, is_reconciled) WHERE NOT is_reconciled;
