-- 168_the_180_day_reversal.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +1 row. Nothing else read, updated or deleted.
--
-- No schema change. Re-running inserts nothing (NOT EXISTS on `name`).
-- Requires 166 for the `skill_type`/`category` vocabulary; GUARD 1 says so.
--
-- ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
--
-- Catalogue entry #01, and the folio's own verdict on it is "best-evidenced
-- idea in the list — the query already runs and returns 42 rows on the seeded
-- org". It is the first of the fifteen the tier is named for, and it is the one
-- that was never reachable.
--
-- `brief_itc_reversal_risk` has been in `SKILL_REGISTRY` and in
-- `FUNCTION_MODULES` since d316ce04, and `services/skills/data/itc_reversal.py`
-- is 482 lines of finished, tested handler. NO TEMPLATE HAS EVER NAMED IT. A
-- handler no template names is unreachable — there is no other way into the
-- dispatcher — so the best-evidenced skill in the catalogue has been dead code
-- sitting behind a shelf that does not list it.
--
-- 167 shipped the other fourteen and missed this one because it was built from
-- the four handler modules four agents had written that night, not from the
-- catalogue. That is the mistake this file corrects: the tier is defined by the
-- FOLIO, not by what happened to be in `data/` on the day.
--
-- ── THE WORDING IS LOAD-BEARING ──────────────────────────────────────────────
--
-- The description below says "credit at risk of reversal" and never "the tax
-- you must reverse". That is the handler's own rule, stated at length in its
-- docstring, and it is not politeness: the figure cannot be tied out, because
-- nothing records whether the credit was ever AVAILED. Rule 37 reverses credit
-- that was taken; the handler can only see tax that was charged.
--
-- A CA will try to tie this number out against their own working. The card is
-- where they meet it first, so the card must carry the same caveat the output
-- does — the handler puts three of them in `limitations` on the returned dict
-- precisely so a reader sees them, and a description that promised more than
-- the output delivers would undo that before the skill ever ran.
--
-- It also names what comes BACK. The credit is re-availed when the supplier is
-- paid, with no time limit, and s.16(4) does not bite on it. A skill that
-- reports only the outflow describes half the fact.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. One new card on the Skills
-- catalogue in production, under Compliance → Briefs. Inert: it must be
-- assigned to an org before it runs, and run by hand until somebody schedules
-- it. `trigger_config` is not named in this file.
--
-- LOCKS: one INSERT of one row. ROW EXCLUSIVE, no ALTER, nothing scanned.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.hub_skill_templates
--    WHERE name = 'Credit at risk of reversal (180 days)'
--      AND NOT EXISTS (SELECT 1 FROM staging.hub_org_skills os
--                      WHERE os.template_id = hub_skill_templates.id);
--
-- The NOT EXISTS is not optional — see 167's header. Un-stock with
-- `is_active = FALSE`, which keeps every adoption.

BEGIN;

DO $guard$
DECLARE def_type text;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';
    IF def_type IS NULL OR def_type NOT LIKE '%''brief''%' THEN
        RAISE EXCEPTION
            'GUARD 1: migration 166 has not run — the skill_type CHECK does not '
            'admit ''brief'', so the INSERT below would be refused.';
    END IF;
END
$guard$;

INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, 'brief', 'compliance', 'ganit', 'calendar', 'org',
       v.steps, 0, TRUE, FALSE
  FROM (VALUES
    ('Credit at risk of reversal (180 days)',
     'Run before GSTR-3B. Vendor bills unpaid 180 days from the invoice date and the input tax credit Rule 37 puts at risk, grouped by vendor — and what comes back when you pay them, which has no time limit. Credit AT RISK, not tax you must reverse: nothing in the product records whether the credit was ever availed, so the figure is a ceiling and the output says so.',
     '[{"order":1,"label":"Bills unpaid 180 days, and the credit at risk","skill_function":"brief_itc_reversal_risk","generate_image":false}]'::jsonb)
  ) AS v(name, description, steps)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; n_named int;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 34 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 34 templates (33 + 1), found %.', n_total;
    END IF;

    -- The whole point of the file: the handler is now reachable.
    SELECT count(*) INTO n_named
      FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
     WHERE s->>'skill_function' = 'brief_itc_reversal_risk';
    IF n_named <> 1 THEN
        RAISE EXCEPTION
            'VERIFY 2: brief_itc_reversal_risk is named by % template(s), '
            'expected exactly 1.', n_named;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 3: something is armed. This file writes no trigger.';
    END IF;

    -- Every handler in the FIRST tier of the catalogue is now reachable. This
    -- is the assertion 167 could not make, because it was built from the
    -- handler modules rather than from the folio.
    IF EXISTS (
        SELECT unnest(ARRAY[
            'brief_itc_reversal_risk','brief_ims_expectations',
            'brief_itc_at_risk_of_lapse','check_dead_gst_slabs',
            'check_retainers_that_stopped_billing','check_duplicate_vendor_bills',
            'pack_collection_messages','check_invoice_series_and_splits',
            'check_statutory_records_gate','brief_statutory_dues',
            'check_attendance_exceptions','brief_unpaid_reimbursements',
            'check_impossible_stock','check_unfillable_orders',
            'check_stale_retainer_rates']) AS fn
        EXCEPT
        SELECT s->>'skill_function'
          FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
         WHERE s ? 'skill_function'
    ) THEN
        RAISE EXCEPTION
            'VERIFY 4: a first-tier catalogue entry still has no template.';
    END IF;

    RAISE NOTICE '168 · all 15 first-tier skills are reachable; % templates total.', n_total;
END
$verify$;

COMMIT;
