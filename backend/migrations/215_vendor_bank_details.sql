-- Migration 215: Add bank details and PAN to vendor master
-- ALREADY APPLIED via Supabase MCP on 2026-08-23.
--
-- Additive columns only — no existing behaviour changes.
-- bank_details is JSONB so it can hold account_number, ifsc, bank_name,
-- branch without a fixed schema (some vendors have multiple accounts).

SET lock_timeout = '3s';
SET statement_timeout = '30s';

ALTER TABLE staging.ganit_vendors
  ADD COLUMN IF NOT EXISTS pan text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_details jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
