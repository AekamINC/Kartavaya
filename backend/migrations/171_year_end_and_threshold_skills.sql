-- 171_year_end_and_threshold_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +5 rows. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166 (the vocabulary)
-- and 170 (the statutory facts the handlers read) — GUARD 1 and GUARD 2.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #18-#22, the year-end and threshold five. All Ganit, all
-- skill_function-only, all genuinely 0 credits.
--
--   #18  check_amendments_before_filing   documents that now go through GSTR-1A
--   #19  brief_lut_expiry                 the RFD-11 that stops covering 1 April
--   #20  brief_annual_return_books        the books column of GSTR-9
--   #21  check_thresholds_approaching     rolling turnover vs what it changes
--   #22  brief_advance_tax_reserve        cash to reserve, and what it is not
--
-- ── EVERY DATE AND FIGURE THEY PRINT COMES FROM 170 ──────────────────────────
--
-- Not one is a literal. `services/statute.py` resolves each as of a date, so a
-- form that is renumbered or a threshold that moves changes in ONE place. That
-- is not decoration: 24Q became 138 on 1 April 2026 and the 12% and 28% slabs
-- stopped existing on 22 September 2025, both inside this product's lifetime.
--
-- The one that proves it works: `brief_advance_tax_reserve` returns NO SCHEDULE
-- AT ALL today. The advance-tax rows end on 2026-04-01 with no successor,
-- because the Income-tax Act 2025 renumbering is real and the new section
-- numbers were not verified. So the handler reports the gap in words instead of
-- printing four dates under a section that may not exist. Verified live.
--
-- ── MEASURED ON THE LIVE DATABASE, read-only, 2026-08-20 ─────────────────────
--
-- All five run against all three organisations, and every output serialises.
--
--   #18  29 documents EDITED after the GSTR-1 due date in the seeded org — a
--        real GSTR-1A list. The other two orgs: nothing.
--   #19  no export invoices anywhere, and August is outside the February–March
--        window, so all three correctly answer "does not apply yet" rather than
--        an empty list that reads like a clean result.
--   #20  seeded org books figure Rs8,31,16,840 for FY 2025-26 — GSTR-9 AND
--        GSTR-9C both required, due 31 December 2026. 36 drafts are included and
--        declared rather than dropped.
--   #21  seeded org is over ALL FIVE thresholds; Aekam Inc is clear on all five
--        at Rs3,11,671 rolling.
--   #22  surplus Rs2,00,59,968 in the seeded org, and NO schedule — see above.
--
-- ── THE CAVEATS ARE PART OF THE PRODUCT ──────────────────────────────────────
--
-- Three of these five compare a turnover figure to a statutory threshold, and
-- every one of those comparisons is wrong in the SAME DIRECTION: GST aggregate
-- turnover is PAN-level across every registration, and this product sees one
-- organisation's invoices. So the figure is a FLOOR — an org that looks near a
-- line is probably already past it — and that is the opposite of what somebody
-- reads off a bar that is 70% full. Each of the three carries it in
-- `limitations`, and the descriptions below carry it too, because the card is
-- where a firm decides whether to trust the skill.
--
-- #22 is the sharpest case: "a number this rough will be read as tax advice".
-- Its output's FIRST key is `what_this_is_not`, and its description leads with
-- the same sentence.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Five new cards under Compliance
-- and Money in production, immediately. Inert until assigned; nothing armed —
-- `trigger_config` is not named in this file.
--
-- LOCKS: one INSERT of five rows. ROW EXCLUSIVE, no ALTER, nothing scanned.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.hub_skill_templates
--    WHERE name IN ('Amend before you file','LUT expiry','Annual return — books side',
--                   'Thresholds you are approaching','Set aside for advance tax')
--      AND NOT EXISTS (SELECT 1 FROM staging.hub_org_skills os
--                      WHERE os.template_id = hub_skill_templates.id);

BEGIN;

DO $guard$
DECLARE def_type text; n_statute int;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';
    IF def_type IS NULL OR def_type NOT LIKE '%''brief''%' THEN
        RAISE EXCEPTION 'GUARD 1: migration 166 has not run.';
    END IF;

    -- 170, by the keys the handlers actually read. A template naming a handler
    -- whose statutory facts are absent is a card that runs and says "the
    -- catalogue records no rule" for everything — technically honest, entirely
    -- useless, and it would look like a product defect rather than a missing
    -- migration.
    SELECT count(DISTINCT obligation_key) INTO n_statute
      FROM staging.statute_calendar
     WHERE obligation_key IN ('gst.lut.rfd11','gst.return.gstr9','gst.return.gstr9c',
           'gst.registration.threshold.goods','gst.registration.threshold.services',
           'gst.einvoice.threshold','gst.qrmp.threshold','gst.composition.threshold');
    IF n_statute <> 8 THEN
        RAISE EXCEPTION
            'GUARD 2: migration 170 has not run — only % of the 8 statutory keys '
            'these skills read are present. Run '
            '170_statute_gst_year_and_advance_tax.sql first.', n_statute;
    END IF;
END
$guard$;

INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, v.skill_type, v.category, 'ganit', v.icon, 'org',
       v.steps, 0, TRUE, FALSE
  FROM (VALUES

    ('Amend before you file',
     'Documents created or edited after their GSTR-1 due date had already passed — the ones that now go through GSTR-1A rather than being quietly picked up next month. Nothing in this product records that a period was FILED, so the cutoff is inferred from the statutory due date and the output says so on every run.',
     'check', 'compliance', 'search',
     '[{"order":1,"label":"Documents that missed their return","skill_function":"check_amendments_before_filing","generate_image":false}]'::jsonb),

    ('LUT expiry',
     'From February: if you raised any export invoice this year, the RFD-11 stops covering you on 1 April and a fresh one is needed. It can say that cover LAPSES; it can never say you are covered until a date, and never that you have no LUT — nothing here records that one was filed. For the same reason it has no done-state, so run it monthly, not daily.',
     'brief', 'compliance', 'calendar',
     '[{"order":1,"label":"Exports this year, and when cover lapses","skill_function":"brief_lut_expiry","generate_image":false}]'::jsonb),

    ('Annual return — books side',
     'The books column of GSTR-9 in the form''s own table order, with the applicability test for GSTR-9 and GSTR-9C. THE BOOKS COLUMN ONLY: comparing it to the twelve GSTR-1s this product built from the same rows would return zero by construction and teach you to trust a check that checks nothing. The portal column is yours to fill.',
     'brief', 'compliance', 'calendar',
     '[{"order":1,"label":"Outward supplies, credit notes and exports for the year","skill_function":"brief_annual_return_books","generate_image":false}]'::jsonb),

    ('Thresholds you are approaching',
     'Rolling twelve-month turnover against the lines that change what you must do — registration, composition, the quarterly option, e-invoicing — and what crossing each one costs you. THE FIGURE IS A FLOOR: GST aggregate turnover is PAN-level across every registration, and this reads one organisation''s invoices, so if you look close to a line you are probably already past it. It reports where you stand; it never claims to have detected a crossing.',
     'check', 'compliance', 'search',
     '[{"order":1,"label":"Rolling turnover against each statutory line","skill_function":"check_thresholds_approaching","generate_image":false}]'::jsonb),

    ('Set aside for advance tax',
     'NOT TAX ADVICE AND NOT A COMPUTATION OF TAX. Receipts less expenses recorded in this product, set beside the statutory instalment dates and their cumulative percentages, so you can reserve cash. No depreciation, no disallowances, no add-backs, no other head of income, no set-off of losses and no regime choice — the figure is a share of a surplus, never a share of a liability.',
     'brief', 'money', 'calendar',
     '[{"order":1,"label":"Surplus to date against the instalment calendar","skill_function":"brief_advance_tax_reserve","generate_image":false}]'::jsonb)

  ) AS v(name, description, skill_type, category, icon, steps)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; missing text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 40 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 40 templates (35 + 5), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['check_amendments_before_filing','brief_lut_expiry',
               'brief_annual_return_books','check_thresholds_approaching',
               'brief_advance_tax_reserve']) AS fn
        EXCEPT
        SELECT s->>'skill_function'
          FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
         WHERE s ? 'skill_function'
    ) q;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: no template names: %', missing;
    END IF;

    IF EXISTS (
        SELECT 1 FROM staging.hub_skill_templates t
         WHERE t.estimated_credits = 0
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                       WHERE s ? 'agent_type')
    ) THEN
        RAISE EXCEPTION 'VERIFY 3: a template claims 0 credits and calls a model.';
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 4: something is armed. This file writes no trigger.';
    END IF;

    RAISE NOTICE '171 · catalogue #18-#22 are on the shelf; % templates total.', n_total;
END
$verify$;

COMMIT;
