-- 038: Multi-Currency Invoicing
-- Add currency + exchange_rate to invoices and vendor bills
ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(10,4) DEFAULT 1.0000;

ALTER TABLE staging.ganit_vendor_bills
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(10,4) DEFAULT 1.0000;
