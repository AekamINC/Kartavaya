-- PROPOSED — NOT APPLIED. Staging and production share one database.
--
-- Remembering which column is which, per bank.
--
-- Owner, 2026-08-09: "if bank already exists it should match the columns, if
-- new bank it should ask." A statement export's column order is a property of
-- the BANK, not of the upload — HDFC writes the same columns in the same order
-- every month — so the mapping is worth storing once and reusing for ever.
--
-- Keyed on (org_id, bank_name) because two organisations bank differently and
-- one organisation banks with several. `mapping` is {field: column index}, the
-- same shape the importer builds in the browser.

CREATE TABLE IF NOT EXISTS staging.ganit_bank_formats (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    bank_name   TEXT NOT NULL,
    mapping     JSONB NOT NULL DEFAULT '{}',
    has_header  BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, bank_name)
);

CREATE INDEX IF NOT EXISTS ganit_bank_formats_org
  ON staging.ganit_bank_formats (org_id);

COMMENT ON TABLE staging.ganit_bank_formats IS
  'One saved CSV column map per bank per org. The importer offers it when the '
  'bank is chosen, and asks when the bank is new.';
