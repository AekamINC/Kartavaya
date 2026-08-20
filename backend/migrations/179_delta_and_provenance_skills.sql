-- 179_delta_and_provenance_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +3 rows. Nothing else. Requires 166.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #58, #59 and #61 — the last three the folio rejected, each shipped
-- as THE HALF THAT SURVIVES ITS OWN OBJECTION rather than as the thing that
-- was rejected.
--
--   #58  "Reporting the delta is honest and already lives inside #18. Claiming
--        to predict an automated intimation the product cannot see is not."
--        So it reports MOVEMENT and never a notice. #18 reports which
--        DOCUMENTS changed; this reports the rupee DELTA, which is the half
--        #18 does not carry.
--   #59  "Rejected AS A RECONCILIATION, because the other side does not exist
--        in this product. A skill that calls itself a reconciliation and
--        compares a number to itself will be caught by the first CA who runs
--        it." So this is the books side and the applicability test, and the
--        word reconciliation appears nowhere in what it produces.
--   #61  "Rejected from the marketplace, not the roadmap... the provenance
--        record doubles as cost attribution." Which model and template made
--        each piece of content, when, and what it cost.
--
-- ── #61 IS THE ONE WITH TEETH ────────────────────────────────────────────────
--
-- Images run $0.036-$0.040 each and are 79% of all AI spend to date.
-- `routers/hub.py` generates one whenever a step sets `generate_image`, and
-- `services/image_brief.py` carries art direction keyed by template name —
-- INCLUDING four statutory ones: gstr-1-filing-readiness, payables-payment-run,
-- pre-run-payroll-readiness and receivables-chase-pack. The art direction is
-- sitting there ready for the day somebody toggles the flag on a compliance
-- brief, at roughly Rs3.5 per org per run for a decorative cover that buys
-- nothing.
--
-- Verified live 2026-08-20: ZERO templates set generate_image, and all 50 free
-- skills say `generate_image: false` explicitly. The trap is armed and not
-- triggered. This skill is what makes it visible if it ever is.
--
-- ── MEASURED LIVE, read-only, through the real dispatcher ────────────────────
--
--   #58  documents in period: Aekam 6, E2E 30, Unicode 20
--   #59  documents read for the year: Aekam 0, E2E 360, Unicode 23
--   #61  generation records: Aekam 4, E2E 100, Unicode 102
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Three new cards in production,
-- inert until assigned. Nothing armed.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · A DRIFT THIS FILE TRIPPED OVER AND HAS TO FIX FIRST
--
-- `hub_skill_templates_module_check` admits `srijan` and NOT `sahayak`.
-- `middleware/role_tiers.ALL_MODULES` admits `sahayak` and NOT `srijan`. The
-- rename landed in the code and never in the constraint, so the database and
-- the application have disagreed about the name of a module ever since.
--
-- It has been invisible because `module` is a display label that no existing
-- template set to either value — all eight NULLs were filled by 166 with other
-- codes. #61 is the first skill that belongs to that module, and it failed the
-- INSERT, which is how this surfaced.
--
-- WIDENED, NOT SWAPPED. `srijan` stays legal: dropping it would be a data
-- migration on a column this file has no business rewriting, and a value no
-- row currently holds costs nothing to keep. The comment records which one is
-- current so the next reader is not left guessing.
--
-- NOTE THE ASYMMETRY THIS LEAVES, deliberately: `FUNCTION_MODULES` in
-- `services/skills/modules.py` must still say `sahayak`, because
-- `modules_for_step` INTERSECTS with `ALL_MODULES` and `srijan` would silently
-- vanish from the requirement set — making the skill reachable by anyone.
-- `test_declared_modules_are_real_module_codes` catches that, and did.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.hub_skill_templates
    DROP CONSTRAINT IF EXISTS hub_skill_templates_module_check;

ALTER TABLE staging.hub_skill_templates
    ADD CONSTRAINT hub_skill_templates_module_check CHECK (
        module IS NULL OR module IN (
            'graha', 'vikray', 'prachar', 'dristi', 'sanvaad', 'ganit',
            'esign', 'varta', 'pahchan', 'manav', 'vetana', 'kartavya',
            'sahayak',   -- current name, and what ALL_MODULES holds
            'srijan'     -- the former name of the same module; retained
        ));

DO $guard$
DECLARE def_type text;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';
    IF def_type IS NULL OR def_type NOT LIKE '%''brief''%' THEN
        RAISE EXCEPTION 'GUARD 1: migration 166 has not run.';
    END IF;
END
$guard$;

INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, v.skill_type, v.category, v.module, v.icon, 'org',
       ('[{"order":1,"label":' || to_jsonb(v.label)::text ||
        ',"skill_function":"' || v.fn || '","generate_image":false}]')::jsonb,
       0, TRUE, FALSE
  FROM (VALUES

  ('What has moved since the return went',
   'For a period whose due date has passed: what has changed in the books since — documents added, edited or cancelled — and the rupee delta that movement represents. IT NEVER CLAIMS TO PREDICT A NOTICE. This product cannot see a departmental intimation, and a skill that implied otherwise would be inventing the one thing a firm would act on hardest. Its sibling, "Amend before you file", names the documents; this one carries the value.',
   'check', 'compliance', 'ganit', 'search',
   'Movement since the due date, and what it is worth',
   'check_books_moved_since_due'),

  ('Annual return — the 9C books side',
   'The applicability test for the reconciliation statement and the figures from your books that the form asks for, plus an explicit list of every table it CANNOT fill and why. IT IS NOT A RECONCILIATION AND NEVER CALLS ITSELF ONE: the audited-accounts side does not exist in this product, so anything claiming to reconcile would be comparing a number to itself — and the first chartered accountant who ran it would find that out.',
   'brief', 'compliance', 'ganit', 'calendar',
   'What the 9C asks for, and what the books can answer',
   'brief_gstr9c_books_side'),

  ('Where the AI spend went',
   'Every piece of generated content this organisation has, with the model and template that produced it, when, and what it cost — attributed per template and per month. Images run roughly forty times the price of a text step and are the overwhelming majority of AI spend to date, so this is where a decorative cover on a monthly compliance brief becomes visible instead of invisible.',
   'brief', 'money', 'sahayak', 'search',
   'Generated content, its provenance, and its cost',
   'brief_content_provenance')

  ) AS v(name, description, skill_type, category, module, icon, label, fn)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; missing text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 75 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 75 templates (72 + 3), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['check_books_moved_since_due','brief_gstr9c_books_side',
               'brief_content_provenance']) AS fn
        EXCEPT
        SELECT s->>'skill_function'
          FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
         WHERE s ? 'skill_function'
    ) q;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: no template names: %', missing;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 3: something is armed. This file writes no trigger.';
    END IF;

    -- #61's own subject: no template may quietly acquire an image step.
    IF EXISTS (
        SELECT 1 FROM staging.hub_skill_templates t
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                       WHERE COALESCE((s->>'generate_image')::bool, FALSE))
    ) THEN
        RAISE EXCEPTION
            'VERIFY 4: a template generates an image. Images are ~79%% of AI '
            'spend; a decorative cover on a compliance brief buys nothing.';
    END IF;

    RAISE NOTICE '179 · the last three rejects, shipped honestly; % templates.', n_total;
END
$verify$;

COMMIT;
