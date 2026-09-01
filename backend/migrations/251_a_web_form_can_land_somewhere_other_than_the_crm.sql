-- 251 · A web form can land somewhere other than the CRM.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- `graha_web_forms` is already module-agnostic in every respect but one. It
-- carries `name`, `slug`, `fields` (free-form jsonb), `settings`, and the
-- auto-assign trio. Nothing in the FORM is CRM-specific.
--
-- The coupling is entirely in the submit handler, which creates a
-- `graha_contacts` row and stores its id. So a firm can publish a lead form and
-- nothing else — no job application, no vendor enquiry, no support request —
-- even though the table would hold any of them.
--
-- ── WHY A COLUMN AND A CHECK, RATHER THAN A LOOKUP TABLE ───────────────────
--
-- A `destinations` table would be a NEW RELATION IN `public`, and a new table
-- without RLS is a silent cross-tenant leak (CLAUDE.md). It would also be a
-- table whose rows must match a dict of Python handlers — two places to change,
-- one of which the database cannot check.
--
-- The CHECK constraint is the database's half of the same allowlist the code
-- keeps in `services/webforms/destinations.py`. A destination the code cannot
-- handle cannot be stored, and a destination the database rejects cannot reach
-- the handler. Neither half can drift without the other failing loudly.
--
-- ⚠ THE DEFAULT IS TODAY'S BEHAVIOUR. Both live forms and all 24 live
-- submissions keep working with no data change and no backfill. This migration
-- must alter not one existing row.

ALTER TABLE public.graha_web_forms
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'crm_contact';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'graha_web_forms_destination_check'
  ) THEN
    ALTER TABLE public.graha_web_forms
      ADD CONSTRAINT graha_web_forms_destination_check
      CHECK (destination IN ('crm_contact', 'hr_application'));
  END IF;
END $$;

-- ── ONE REAL FOREIGN KEY PER DESTINATION, NOT A POLYMORPHIC PAIR ───────────
--
-- The tempting shape is `(entity_type text, entity_id uuid)`. It is wrong here.
-- A polymorphic pair cannot be a foreign key, so the database cannot tell you
-- that the row it points at is gone — and this codebase's repeated lesson is
-- that a column nothing can check rots quietly. `contact_id` is already a real
-- FK; `candidate_id` joins it as one.
--
-- Nullable because exactly one of them is set per submission, decided by the
-- form's `destination`.
ALTER TABLE public.graha_web_form_submissions
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.manav_candidates(id);

CREATE INDEX IF NOT EXISTS idx_gwfs_candidate
  ON public.graha_web_form_submissions (candidate_id)
  WHERE candidate_id IS NOT NULL;

-- ── THE SLUG NAMESPACE IS NOT FIXED HERE, DELIBERATELY ─────────────────────
--
-- `idx_graha_web_forms_slug` is UNIQUE (slug) WHERE is_active — GLOBAL across
-- every tenant. So "careers", "jobs" and "apply" are claimed once product-wide,
-- first come, and the firm that loses is told somebody else holds the word.
--
-- That is a real defect and it gets worse the moment HR forms exist, because
-- every firm wants the same three words. It is NOT fixed in this migration
-- because changing the public URL shape is a customer-visible decision — the
-- two live forms already have printed links — and it belongs in its own change
-- with its own redirect story rather than riding in on a column addition.
