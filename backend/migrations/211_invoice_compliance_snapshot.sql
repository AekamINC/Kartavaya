-- Migration 211: freeze compliance profile onto issued invoices
--
-- Rule 2 of proposal 80: when a tax invoice becomes final, the org's
-- compliance settings at that moment are frozen alongside the document.
-- Without this, changing a setting retroactively changes every past invoice's
-- compliance interpretation.
--
-- Risk report
-- -----------
-- READ-ONLY column addition with a NULL default — no table rewrite, no lock
-- beyond ACCESS EXCLUSIVE for the brief ALTER, no data change. Existing rows
-- get NULL (they predate the feature). Only new finalizations populate it.
--
-- Rollback
-- --------
-- ALTER TABLE staging.ganit_invoices DROP COLUMN IF EXISTS compliance_snapshot;

ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS compliance_snapshot JSONB;

COMMENT ON COLUMN staging.ganit_invoices.compliance_snapshot IS
  'Frozen compliance_states at the moment doc_status became final. NULL for invoices finalised before this column existed.';
