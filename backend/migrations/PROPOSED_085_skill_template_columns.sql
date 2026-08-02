-- 085 · The three columns migration 059 declared and never landed
--
-- ── What is wrong ────────────────────────────────────────────────────────
--
-- `059_skills_integration.sql:12-15` declares five columns on
-- `staging.hub_skill_templates`:
--
--     ADD COLUMN IF NOT EXISTS skill_type     text ...
--     ADD COLUMN IF NOT EXISTS scope          text ...
--     ADD COLUMN IF NOT EXISTS module         text DEFAULT NULL,
--     ADD COLUMN IF NOT EXISTS trigger_config jsonb DEFAULT NULL,
--     ADD COLUMN IF NOT EXISTS is_system      bool DEFAULT FALSE;
--
-- Live, the table has `skill_type` and `scope` and NOT the other three.
-- Verified against the live catalog 2026-08-02. So 059 was applied PARTIALLY —
-- the statement is a single ALTER TABLE, so this cannot be a half-executed
-- statement; the likelier history is that the file was edited after it was run.
--
-- ── The consequence, which is a feature that has never worked ────────────
--
-- `routers/scheduler.py:236-238` selects `t.module`, `t.trigger_config` and
-- `t.is_system`, and filters on `t.trigger_config IS NOT NULL`. All three are
-- absent, so `POST /api/internal/cron/skills` raises UndefinedColumn on every
-- call. Scheduled skills have never run once, and the failure is invisible
-- because the endpoint is called by cron rather than by a person.
--
-- `trigger_config` is also the only thing that makes a schedule expressible at
-- all: `hub_client_skills.schedule` is a bare text column the run path never
-- reads.
--
-- ── Why `module` matters now ─────────────────────────────────────────────
--
-- The owner's requirement, 2026-08-02: every skill ties to a module. This
-- column is what a template DECLARES, for grouping and filtering in the
-- catalog.
--
-- It is NOT the access control. What a run may read is decided per STEP by
-- `backend/services/skills/modules.py`, from the skill_functions and context
-- sources the step actually names, and the run is refused unless the caller
-- holds every module involved. That distinction is deliberate: a declared
-- column can be edited to say anything, while the per-step derivation cannot
-- lie about which tables a handler queries. A template claiming
-- `module = 'srijan'` while carrying a step that reads `ganit_invoices` is
-- still refused to anyone without Ganit.
--
-- NULL means cross-module. The general skills — a partner's Monday brief over
-- receivables, tasks and follow-ups — belong to no single module, and forcing
-- one would be a lie in the catalog.
--
-- ── RISKS AND SIDE EFFECTS ───────────────────────────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE. This is a production change.
--
-- * Three ADD COLUMNs, all nullable or with a constant default. On PostgreSQL
--   11+ that is a catalog-only rewrite — no table rewrite, no long lock. The
--   table holds 6 rows regardless.
--
-- * Additive only. No existing column is altered or dropped, and every one of
--   the six existing templates keeps working: `module` and `trigger_config`
--   default to NULL, `is_system` to FALSE, which is exactly what the code
--   already assumes for them.
--
-- * It makes `/cron/skills` REACHABLE for the first time. That endpoint
--   dispatches skills in the background. Nothing runs by itself as a result:
--   the query requires `trigger_config->>'type' = 'cron'`, and after this
--   migration every row has `trigger_config IS NULL`. A schedule has to be set
--   deliberately before anything fires.
--
-- * IF_NOT_EXISTS throughout, so re-running is safe and so is applying this on
--   an environment where 059 did land in full.
--
-- ── Conventions ──────────────────────────────────────────────────────────
--
-- Column names, types and defaults copied verbatim from 059 so that the two
-- files cannot disagree about the shape.

ALTER TABLE staging.hub_skill_templates
  ADD COLUMN IF NOT EXISTS module         text  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_config jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_system      bool  DEFAULT FALSE;


-- A template belongs to at most one module, and NULL means cross-module.
-- Constrained rather than free text so a typo cannot create a catalog filter
-- that matches nothing. Codes are `ALL_MODULES` in
-- backend/middleware/role_tiers.py, plus 'kartavya' for core PM, which is not a
-- gated module but is a real home for a task-shaped skill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_skill_templates_module_check'
  ) THEN
    ALTER TABLE staging.hub_skill_templates
      ADD CONSTRAINT hub_skill_templates_module_check
      CHECK (module IS NULL OR module = ANY (ARRAY[
        'graha','vikray','prachar','srijan','dristi','sanvaad',
        'ganit','esign','varta','pahchan','manav','vetana','kartavya'
      ]));
  END IF;
END $$;


-- The catalog is read by module in the step editor and by trigger in the cron
-- sweep. Both are small scans today and will not stay small.
CREATE INDEX IF NOT EXISTS hub_skill_templates_module_idx
  ON staging.hub_skill_templates (module)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS hub_skill_templates_trigger_idx
  ON staging.hub_skill_templates ((trigger_config->>'type'))
  WHERE trigger_config IS NOT NULL;


-- ── Verify ───────────────────────────────────────────────────────────────
-- Expect all three present, six rows, all module NULL and trigger_config NULL.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='staging' AND table_name='hub_skill_templates'
--    AND column_name IN ('module','trigger_config','is_system');
--
-- SELECT count(*) AS templates,
--        count(module) AS with_module,
--        count(trigger_config) AS scheduled
--   FROM staging.hub_skill_templates;
--
-- And the endpoint that could never run:
--   POST /api/internal/cron/skills  ->  {"dispatched": 0}   (was UndefinedColumn)


-- ── Rollback ─────────────────────────────────────────────────────────────
-- Only if nothing has been written to the new columns. Dropping `module` after
-- templates have declared one loses that classification irrecoverably.
--
-- DROP INDEX IF EXISTS staging.hub_skill_templates_trigger_idx;
-- DROP INDEX IF EXISTS staging.hub_skill_templates_module_idx;
-- ALTER TABLE staging.hub_skill_templates
--   DROP CONSTRAINT IF EXISTS hub_skill_templates_module_check;
-- ALTER TABLE staging.hub_skill_templates
--   DROP COLUMN IF EXISTS is_system,
--   DROP COLUMN IF EXISTS trigger_config,
--   DROP COLUMN IF EXISTS module;
