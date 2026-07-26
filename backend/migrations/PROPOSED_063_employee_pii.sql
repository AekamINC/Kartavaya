-- PROPOSED — NOT APPLIED. Needs a product decision first (see §1).
--
-- Filename deliberately carries no runnable sequence number. Migrations in this
-- directory are applied by hand — `_run_startup_migrations()` in server.py holds
-- inline SQL only and early-returns on an existing database, so nothing here
-- auto-applies. Rename to `063_employee_pii.sql` when a decision is made.
--
-- Context: the access-control half of this work is already shipped in code
-- (masked detail endpoint, audited reveal endpoint gated on org owner/admin).
-- This file covers only the storage question, which needed the decision below.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The decision: does Kartavaya need to store Aadhaar at all?
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Finding: `staging.manav_employees.aadhaar` is WRITTEN AND NEVER READ.
--
-- Every reference in the backend is one of:
--   · the Pydantic models (`EmployeeCreate.aadhaar`, `EmployeeUpdate.aadhaar`)
--   · the INSERT in `routers/manav.py`
--   · the masking / audit code added by this change
--   · a comment in `services/esign_service.py` about a *possible future*
--     Aadhaar eSign provider, which the project has decided against
--     (in-house eSign, not Aadhaar)
--
-- No business logic consumes it. Payroll reads `pan`, `uan` and `bank_details`.
-- PF uses UAN. ESI uses `esi_number`. Both are the correct statutory
-- identifiers and both are already stored separately.
--
-- `migrations/046_leadgen_catalog.sql` already records that Aadhaar
-- verification is deliberately not implemented, because it needs a UIDAI
-- AUA/KUA licence.
--
-- Under India's DPDP Act 2023 an Aadhaar number must be held for a stated,
-- lawful purpose. A column that nothing reads has no purpose to state. Holding
-- it is pure downside: it raises what a single leak costs and it is the one
-- field in this table that turns "employee records" into "identity kit".
--
-- RECOMMENDATION: Option A. Stop collecting it and drop the column.
-- If HR genuinely needs to record that an Aadhaar was *sighted* during
-- onboarding, store a boolean and a date, never the number.

-- Live data as of 2026-07-26 (read-only count, `staging` schema):
--   9 employees across 2 orgs · 3 with aadhaar · 3 with pan · 9 with bank_details
-- Blast radius is small enough that either option is low risk today. It will
-- not stay that way once clients onboard real workforces — which is the
-- argument for deciding now rather than later.

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · OPTION A (recommended) — drop the column
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Also requires, in the same release:
--   · remove `aadhaar` from EmployeeCreate / EmployeeUpdate in routers/manav.py
--   · remove it from the INSERT column list and params
--   · remove `aadhaar` from _SENSITIVE_COLS and from _mask_employee_pii
--   · remove the Aadhaar input from frontend EmployeesTab.jsx (form + detail)
--   · drop it from the reveal endpoint's SELECT
--
-- Preserve first, so the drop is reversible for one release cycle. Without this
-- the drop is irreversible the moment it runs.

CREATE TABLE IF NOT EXISTS staging.manav_employees_aadhaar_archive (
    employee_id  UUID PRIMARY KEY,
    org_id       UUID NOT NULL,
    aadhaar      TEXT NOT NULL,
    archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staging.manav_employees_aadhaar_archive IS
    'Rollback safety net for the aadhaar column drop. DELETE THIS TABLE once the '
    'drop is confirmed good — it is the same data under a different name, and '
    'keeping it indefinitely defeats the purpose of the drop. Target: one release.';

INSERT INTO staging.manav_employees_aadhaar_archive (employee_id, org_id, aadhaar)
SELECT id, org_id, aadhaar
  FROM staging.manav_employees
 WHERE aadhaar IS NOT NULL AND aadhaar <> ''
ON CONFLICT (employee_id) DO NOTHING;

ALTER TABLE staging.manav_employees DROP COLUMN IF EXISTS aadhaar;

-- ROLLBACK for Option A:
--   ALTER TABLE staging.manav_employees ADD COLUMN IF NOT EXISTS aadhaar TEXT;
--   UPDATE staging.manav_employees e
--      SET aadhaar = a.aadhaar
--     FROM staging.manav_employees_aadhaar_archive a
--    WHERE a.employee_id = e.id;
-- Then revert the application code. The API tolerates the column's absence
-- only if the code changes above ship together with the migration — deploying
-- the migration alone will break the INSERT in create_employee.

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · OPTION B — keep it, encrypt at rest
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Only choose this if a stated lawful purpose exists. "We might need it later"
-- is not one.
--
-- The infrastructure already exists and is tested: `services/encryption.py`
-- provides Fernet `encrypt()` / `decrypt()` with an `enc::` prefix, is
-- idempotent, and passes legacy plaintext straight through — which is exactly
-- the shape needed to migrate an existing plaintext column with no downtime.
-- `routers/whatsapp.py` is the existing precedent. `tests/test_encryption.py`
-- covers it.
--
-- So Option B is application-level, not SQL: encrypt on write in
-- create_employee / update_employee, decrypt on read in the reveal endpoint,
-- and backfill existing rows with a one-off script. No DDL required — the
-- column stays TEXT and simply starts holding ciphertext.
--
-- TWO THINGS TO FIX FIRST, both key hygiene:
--
--   a) `encryption.py` falls back to JWT_SECRET when FIELD_ENCRYPTION_KEY is
--      unset. That means one secret serving two purposes: rotating the JWT
--      secret would silently make every encrypted field undecryptable. Set
--      FIELD_ENCRYPTION_KEY explicitly on every environment before encrypting
--      anything that matters, and confirm it is set before the backfill runs.
--
--   b) The key lives in an environment variable, so it sits next to the data in
--      any compromise that reads env. That is still a real improvement over
--      plaintext — it defeats a database dump, a leaked read-only connection
--      string, and Supabase support access — but it is not KMS. Worth stating
--      plainly rather than describing this as "encrypted" without qualification.
--
-- No SQL for Option B. Deliberately: writing DDL here would imply the column
-- type changes, and it does not.

-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · Risk assessment
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SHARED DATABASE. Staging and production are two schemas in ONE Supabase
-- project (`toacecaewujfxjfrjwco`). Every statement above targets `staging.*`
-- explicitly. `public.*` is untouched. Verify the schema qualifier on every
-- line before running anything.
--
-- Option A risks:
--   · Deploying the migration without the code changes breaks create_employee
--     (INSERT references a dropped column). MUST ship together.
--   · The archive table is itself Aadhaar data. If it is not deleted after the
--     confirmation window, the migration has achieved nothing.
--   · 3 rows carry a value today. Losing them is recoverable from the archive
--     for one release, and unrecoverable after it is dropped — which is the
--     intent.
--
-- Option B risks:
--   · Backfilling with FIELD_ENCRYPTION_KEY unset encrypts under JWT_SECRET.
--     A later JWT rotation then destroys the data with no error at rotation
--     time — it fails later, on read. Assert the variable is set before the
--     backfill, not after.
--   · `decrypt()` passes unrecognised input through as plaintext by design, so
--     a partially-completed backfill leaves no visible symptom. Count
--     `WHERE aadhaar NOT LIKE 'enc::%'` after running, and expect zero.
--
-- Both options are reversible for one release. Neither is reversible after the
-- archive table is dropped, which is the point at which the decision becomes
-- final.
