-- PROPOSED_090_statutory_document_identifiers.sql
--
-- PROPOSED — the statutory identifiers the print documents need and the schema
-- cannot represent. Review before running. NOT APPLIED by whoever merges this.
--
-- RENUMBERED FROM 080 on 2026-08-27. Two files carried PROPOSED_080 — this one
-- and `PROPOSED_080_team_members_retire.sql` — in a directory whose only job is
-- to say what runs before what. This one moved because it is referenced from
-- four places and the other from nine; neither is applied, so nothing in any
-- database changes by moving it.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY
-- ═════════════════════════════════════════════════════════════════════════════
-- A field-by-field audit of the eight documents in
-- `design-reference/Kartavaya Redesign/docs/` against the backend that would
-- supply them (full table in `swarm-reports/agent-documents-print-output.md`)
-- found four identifiers with NO column anywhere. Each is mandatory on the face
-- of the document that needs it, not decorative:
--
--   1. `organisations.tan` — `docs/TDS Challan.html` renders `data-org-tan` in
--      the deductor block. A TDS challan (ITNS-281) is filed AGAINST a TAN; the
--      number is how the deposit is attributed to the deductor at all. Without
--      the column the document cannot be built, which is why the TDS challan is
--      one of the six that has no generator.
--
--   2. `organisations.pf_establishment_code` and
--   3. `organisations.esi_employer_code` — the employer-side halves of the
--      payslip's statutory block. `18-documents.md` §Payslip requires "the
--      statutory identifiers (UAN, PF number, ESI number)". The employee halves
--      exist (`manav_employees.uan`, `.esi_number`); the employer halves do not,
--      so a payslip cannot state which establishment the contribution went to.
--
--   4. `manav_employees.pf_number` — the PF MEMBER ID, e.g. MH/BAN/12345/0042.
--      `docs/Payslip.html` renders it on its own line beside the UAN. This is
--      NOT the UAN and the existing `uan` column does not stand in for it: the
--      UAN is one lifetime number per person, the PF account number is per
--      employment, and a Form 3A/6A reconciliation needs the latter.
--      `services/doc_validation.py` already emits an advisory gap for it and
--      says the column does not exist; applying this lets it become real data.
--
-- VERIFIED before writing this: `git grep` over `backend/migrations/*.sql` finds
-- no `tan`, no `pf_number`, no `pf_establishment_code` and no `esi_employer_code`
-- on any table. `PROPOSED_068` records that `staging.organisations` had 32
-- columns when checked live and none of these was among them.
--
-- I did NOT execute SQL against the database to confirm — writing to or querying
-- the shared Supabase project is out of bounds for this work. The evidence is
-- the migration history, which is the same evidence `PROPOSED_068` relied on.
-- Confirm with the VERIFY block below before applying.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- SAFE TO DEPLOY CODE FIRST
-- ═════════════════════════════════════════════════════════════════════════════
-- Nothing needs this migration to ship. `services/doc_validation.py` treats a
-- missing `pf_number` as ADVISORY, never blocking, precisely because no column
-- exists — a blocking rule against an unrepresentable field would refuse every
-- payslip in the system. `payslip_pdf.py` renders each identifier only `if` it
-- is present. So the order is: merge the code, apply this when convenient, and
-- the fields start appearing with no redeploy.
--
-- If you want the same information_schema probe `org_profile.py` uses so a
-- PATCH can accept these before the columns exist, copy `_selectable()` from
-- `backend/routers/org_profile.py:109`. Not done here — no endpoint writes
-- these yet.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- RISK: LOW
-- ═════════════════════════════════════════════════════════════════════════════
--   Schema        : `staging.organisations`, `staging.manav_employees`. Both are
--                   `staging.*`, NOT `public.*`, so this is off production's
--                   data path. Do not retarget it — staging and production share
--                   one Supabase project.
--   Rows affected : 0 rewritten. Every column is nullable or has a constant
--                   default, so Postgres 11+ stores the default in the catalogue
--                   and does not rewrite either table.
--   Blocking      : ADD COLUMN takes ACCESS EXCLUSIVE briefly. `organisations`
--                   is one row per org. `manav_employees` is one row per
--                   employee — still small, but it is the larger of the two and
--                   is read on every payroll run; apply outside a run.
--   Reversible    : Yes, completely — see ROLLBACK.
--   Data loss     : None on apply. Rollback DROPs the columns and discards
--                   anything entered into them.
--   PII           : `pf_number` is an employment identifier and belongs to the
--                   same class as `pan`, `aadhaar` and `uan` on that table. It
--                   inherits whatever `PROPOSED_063_employee_pii.sql` decides
--                   for those; it must NOT be exposed by any endpoint that
--                   those are not. `vetana.py`'s payslip route already audits
--                   reads of that class and is the model to follow.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS tan                    TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS pf_establishment_code  TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS esi_employer_code      TEXT NOT NULL DEFAULT '';

ALTER TABLE staging.manav_employees
    ADD COLUMN IF NOT EXISTS pf_number TEXT;

-- `NOT NULL DEFAULT ''` on the org columns matches every other profile column
-- added by 047 and 051 (`email`, `phone`, `website`, `invoice_note`,
-- `authorized_signatory_name`). `pf_number` is plain nullable to match its
-- neighbours on `manav_employees` — `pan`, `aadhaar`, `uan` and `esi_number`
-- are all nullable TEXT, and "no PF account" is a real state for an employee
-- below the threshold.

COMMENT ON COLUMN staging.organisations.tan IS
    'Tax Deduction and Collection Account Number, format AAAA99999A — four '
    'letters, five digits, one letter. Rendered as data-org-tan in the deductor '
    'block of docs/TDS Challan.html. A TDS challan is filed against this number; '
    'without it the deposit cannot be attributed to the deductor.';

COMMENT ON COLUMN staging.organisations.pf_establishment_code IS
    'EPFO establishment code, e.g. MH/BAN/0012345. The employer half of the '
    'payslip statutory block; the employee half is manav_employees.uan.';

COMMENT ON COLUMN staging.organisations.esi_employer_code IS
    'ESIC employer code, 17 digits. The employer half of the payslip statutory '
    'block; the employee half is manav_employees.esi_number.';

COMMENT ON COLUMN staging.manav_employees.pf_number IS
    'EPF member/account id, e.g. MH/BAN/12345/0042. NOT the UAN: the UAN is one '
    'lifetime number per person (column `uan`), this is per employment, and a '
    'Form 3A/6A reconciliation needs this one. Same PII class as pan/aadhaar/uan '
    'on this table — do not expose it anywhere those are not exposed.';

-- Format checks are deliberately loose, and only where the format is genuinely
-- fixed by statute. TAN is AAAA99999A and has been since 2004. PF and ESI codes
-- vary by region and era, so they are length-capped only — a CHECK that rejects
-- a customer's real, valid number is worse than no CHECK, and this is a field
-- someone types once from a certificate they are holding.
-- ── REMOVED BY MIGRATION 238, 2026-08-28 ────────────────────────────────────
-- This CHECK was live (applied out of band, while this file still said it was
-- not) and it 500d the ENTIRE company-profile save whenever a customer typed a
-- TAN that did not match the shape, or cleared one — the PATCH carries every
-- column, so the name, address and bank details went with it. GSTIN/PAN/TAN
-- must block nothing (CLAUDE.md, standing). Shape is warned at entry in
-- routers/org_profile.py and ENFORCED at the point of use in
-- services/doc_validation.py, which refuses a TDS challan on a bad TAN.
-- DO NOT UNCOMMENT. See backend/migrations/238_tan_format_blocks_nothing.sql.
-- ALTER TABLE staging.organisations
--     DROP CONSTRAINT IF EXISTS organisations_tan_format;
-- ALTER TABLE staging.organisations
--     ADD CONSTRAINT organisations_tan_format
--     CHECK (tan = '' OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$');

ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_pf_estab_len;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_pf_estab_len
    CHECK (char_length(pf_establishment_code) <= 40);

ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_esi_employer_len;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_esi_employer_len
    CHECK (char_length(esi_employer_code) <= 32);

-- NULL passes a CHECK, so "no PF account" stays legal without a special case.
ALTER TABLE staging.manav_employees
    DROP CONSTRAINT IF EXISTS manav_employees_pf_number_len;
ALTER TABLE staging.manav_employees
    ADD CONSTRAINT manav_employees_pf_number_len
    CHECK (pf_number IS NULL OR char_length(pf_number) <= 40);

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═════════════════════════════════════════════════════════════════════════════
-- Run this BEFORE applying too — if it already returns rows, the columns were
-- added out of band and this file is a no-op rather than a surprise.
--
-- SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'staging'
--    AND (   (table_name = 'organisations'
--             AND column_name IN ('tan','pf_establishment_code','esi_employer_code'))
--         OR (table_name = 'manav_employees' AND column_name = 'pf_number') );
-- Expect four rows after applying.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════════════════
-- Drops the columns and everything stored in them. No running code breaks:
-- payslip_pdf.py renders each identifier only when present, and doc_validation
-- treats pf_number as advisory, so absence returns to the current behaviour.
--
-- ALTER TABLE staging.organisations
--     DROP CONSTRAINT IF EXISTS organisations_tan_format,
--     DROP CONSTRAINT IF EXISTS organisations_pf_estab_len,
--     DROP CONSTRAINT IF EXISTS organisations_esi_employer_len;
--
-- ALTER TABLE staging.manav_employees
--     DROP CONSTRAINT IF EXISTS manav_employees_pf_number_len;
--
-- ALTER TABLE staging.organisations
--     DROP COLUMN IF EXISTS tan,
--     DROP COLUMN IF EXISTS pf_establishment_code,
--     DROP COLUMN IF EXISTS esi_employer_code;
--
-- ALTER TABLE staging.manav_employees
--     DROP COLUMN IF EXISTS pf_number;
