-- 269 — the personnel file gets somewhere to keep documents.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  1. WHAT THIS DOES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Creates ONE table, `public.manav_employee_documents`, and turns RLS on it.
-- No column is added to or altered on any existing table. No data is written,
-- moved, or deleted.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  2. WHY — MEASURED, NOT ASSUMED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Manav has twenty tables and NOT ONE of them holds a document:
--
--     manav_announcements  manav_assets      manav_attendance   manav_availability
--     manav_candidates     manav_departments manav_employees    manav_exit_interviews
--     manav_expense_claims manav_holidays    manav_job_openings manav_leave_balances
--     manav_leave_requests manav_leave_types manav_offboarding  manav_schedules
--     manav_shift_bid_responses  manav_shift_bids  manav_shift_definitions
--     manav_swap_requests
--
-- The only document tables in the whole database are `graha_documents` (CRM),
-- `hub_kb_documents` (the knowledge base) and `sign_documents` (e-sign). There
-- is no upload route in `routers/manav.py` and no documents tab in the UI.
--
-- ⚠ AND THE DOCS SAY OTHERWISE. `docs/modules/manav.md` opens with "it holds
-- identity documents", and the generated table list directly beneath it
-- contains no such table — the prose there is hand-written while everything
-- under it is generated from source, so the two drifted. What the employee
-- record actually holds is an encrypted Aadhaar NUMBER
-- (`_ENCRYPTED_COLS = ("aadhaar",)`), decrypted then masked on read. A number
-- is not a document: it does not prove itself, cannot be handed to an auditor,
-- and expires without anybody noticing.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  3. RLS — THE PART THAT IS NOT OPTIONAL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `public` is exposed to PostgREST and the anon key is compiled into the
-- shipped browser bundle. Every one of the ~300 tables in `public` carries RLS
-- with NO policies, and that deny-all is the only working tenancy control in
-- this database.
--
-- A new table without it is a cross-tenant leak from the moment it is created,
-- with no error and no log line — and this particular table would hold scans
-- of PAN cards, Aadhaar cards and signed contracts. So RLS is enabled in the
-- SAME transaction as the CREATE, not in a follow-up migration, and the
-- assertion at the bottom refuses to commit without it.
--
-- Run the Supabase security advisor after this. A new `rls_disabled_in_public`
-- is a breach, not a lint.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  4. BLAST RADIUS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ Both Railway environments carry the same DATABASE_URL. This is a
-- production write and there is no second place to try it.
--
-- It is additive and reversible:
--
--   · CREATE TABLE IF NOT EXISTS — nothing existing is touched.
--   · No existing query can see the new table, so no read path changes.
--   · Zero rows on arrival, so nothing to migrate and nothing to back out of.
--   · The two foreign keys are ON DELETE CASCADE, which matches
--     `graha_documents.org_id` and means deleting an org or an employee takes
--     their documents with them rather than orphaning rows. ⚠ The R2 OBJECTS
--     are not cascaded — the database cannot reach them. Deleting a document
--     row leaves its object; that is the same behaviour `graha_documents` has
--     and it is called out here so nobody assumes otherwise.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  5. REVERSAL
-- ═══════════════════════════════════════════════════════════════════════════
--
--     DROP TABLE public.manav_employee_documents;
--
-- Safe while the table is empty. Once documents exist, the R2 objects they
-- point at outlive the DROP and would have to be swept separately.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  6. WHAT IS DELIBERATELY NOT HERE
-- ═══════════════════════════════════════════════════════════════════════════
--
--   · NO CHECK on `doc_type`. The allowlist lives in `routers/manav.py` beside
--     the one `employment_type` already uses, so adding a kind of document is
--     a code change rather than a production migration.
--   · NO `document.expiring` WIRING. That event already exists and means
--     something else entirely — "A signature request nears expiry", family
--     esign. `expires_on` here is written by the upload form and read by the
--     list; it is not connected to an automation, and this comment exists so
--     the next reader does not assume it is.

BEGIN;

CREATE TABLE IF NOT EXISTS public.manav_employee_documents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES public.organisations(id)   ON DELETE CASCADE,
    employee_id  UUID NOT NULL REFERENCES public.manav_employees(id) ON DELETE CASCADE,
    doc_type     TEXT NOT NULL DEFAULT 'other',
    name         TEXT NOT NULL,
    -- `file_key` is the durable one. `file_url` is a PRESIGNED url and expires
    -- in nine hours — `graha_documents` carries both for this reason, and a
    -- row holding only the url is a row whose file is unreachable by tomorrow.
    file_url     TEXT NOT NULL DEFAULT '',
    file_key     TEXT NOT NULL,
    file_size    BIGINT DEFAULT 0,
    mime_type    TEXT DEFAULT '',
    issued_on    DATE,
    expires_on   DATE,
    notes        TEXT DEFAULT '',
    -- TEXT, matching `manav_employees.created_by` — read live, it is text and
    -- not uuid, and a uuid column here would refuse the same value that table
    -- accepts.
    uploaded_by  TEXT NOT NULL,
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Every index leads with org_id: it is the tenancy column and every query in
-- the router filters on it first.
CREATE INDEX IF NOT EXISTS idx_manav_emp_docs_org
    ON public.manav_employee_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_manav_emp_docs_employee
    ON public.manav_employee_documents(org_id, employee_id)
    WHERE is_active;
-- Partial on `expires_on IS NOT NULL`: most documents never expire, and an
-- index over a mostly-NULL column is mostly dead weight.
CREATE INDEX IF NOT EXISTS idx_manav_emp_docs_expiry
    ON public.manav_employee_documents(org_id, expires_on)
    WHERE is_active AND expires_on IS NOT NULL;

ALTER TABLE public.manav_employee_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE bad text;
BEGIN
    -- The whole schema, not just this table. Migration 243 turned RLS on for
    -- the last two tables that lacked it, and this keeps that invariant true
    -- rather than checking only the row this migration added.
    SELECT string_agg(c.relname, ', ') INTO bad
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relrowsecurity IS FALSE;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION
          'RLS is off in public on: % — the anon key reads these', bad;
    END IF;
END $$;

COMMIT;
