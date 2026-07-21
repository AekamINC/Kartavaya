-- 047: Company profile fields (for invoice PDF letterhead) + export/foreign invoice support.

ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS website TEXT DEFAULT '';
ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS bank_details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS invoice_note TEXT DEFAULT '';

ALTER TABLE staging.ganit_invoices ADD COLUMN IF NOT EXISTS is_export BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE staging.ganit_invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';
