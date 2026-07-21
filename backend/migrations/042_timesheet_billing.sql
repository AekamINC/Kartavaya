-- 042: Timesheet → Invoice Billing Bridge
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS is_billed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_id UUID;

ALTER TABLE staging.manav_employees
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2) DEFAULT 0;
