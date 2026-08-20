-- 173_payroll_statutory_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +5 rows. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166 (the vocabulary)
-- and 172 (the TDS deposit key and the ESI ceiling and periods).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #23-#27 — what happens to a payroll run AFTER it is approved.
--
--   #23  check_pf_esi_debit_missing    no PF/ESI debit is visible this month
--   #24  pack_form130_annexure         the year's payslips in the Part B heads
--   #25  pack_quarterly_deductees      the deductee list the RPU wants
--   #26  check_esi_ceiling_crossings   who crossed ₹21,000 and still owes
--   #27  brief_professional_tax        PT deducted, and what cannot be dated
--
-- ── THREE OF THE FIVE ARE ABSENCE CLAIMS, AND THE CARDS SAY SO ───────────────
--
-- The product records no challan, parses no bank narration into a statutory
-- head, and does not know which state an employee works in. So #23 says a debit
-- is not VISIBLE and never that the PF was not paid; #27 prints no due date for
-- a state whose slabs are absent; #24 calls its output a working and never a
-- Form. An absence claim is weaker than a match and still catches the failure
-- it is for. A confident claim built on an absence is how a compliance skill
-- loses a firm in one run — so the weaker sentence is on the card too, not just
-- in the output.
--
-- ── THE FORM NUMBER FOLLOWS THE YEAR, AND THIS IS THE PROOF ──────────────────
--
-- Form 16 became Form 130 and 24Q became 138 on 1 April 2026. Verified live
-- from the SAME code, no branch: FY 2025-26 resolves Form 16, FY 2026-27
-- resolves Form 130. That is `services/statute.py` doing the one job it exists
-- for, and it is why #24's description says which certificate it FEEDS rather
-- than naming a form.
--
-- ── MEASURED LIVE, read-only, 2026-08-20, all three organisations ────────────
--
--   #23  seeded org: PF ₹2,15,282.64 owed and NO debit visible. Unicode Group:
--        both PF ₹69,553.78 and ESI ₹2,327.41 not visible. Aekam Inc has no
--        approved run, which reads as "the absence of a question", not a finding.
--   #24  seeded org 60 employees at 12 months each. No join fan-out (payslips
--        per employee max = min = 12), and the repeated NAMES are three real
--        employees with distinct codes — the seeded org has three people called
--        Tara Mehta.
--   #25  seeded org Q2 2026-27: 60 rows, 59 with tax deducted, ₹7,54,916.77,
--        form 138, and NO due date because the quarterly statement has no
--        uniform day of the month.
--   #26  seeded org: 60 of 60 above the ceiling with no contribution recorded.
--        Unicode Group: 21 of 24.
--   #27  `staging.pay_professional_tax` is PER-ORG — every row carries an
--        org_id. Aekam Inc holds all nine slab rows across three states; the
--        other two orgs have NONE, and both are told so rather than shown a
--        national default that does not exist.
--
-- ── A BUG THE LIVE RUN CAUGHT ────────────────────────────────────────────────
--
-- `vetana_payslips.other_earnings` is a jsonb ARRAY of {label, amount}, not a
-- numeric, so `SUM()` over it raises `function sum(jsonb) does not exist`. A
-- mock pool hid it completely. It matters beyond the crash: every non-empty
-- value in the live data is an ARREARS line, and a salary-certificate annexure
-- that silently drops arrears understates the year for exactly the people whose
-- pay was revised.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Five new cards under People and
-- Compliance in production, immediately. Inert until assigned; nothing armed.
--
-- LOCKS: one INSERT of five rows. ROW EXCLUSIVE, no ALTER.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.hub_skill_templates
--    WHERE name IN ('No PF or ESI debit visible','Salary certificate annexure',
--                   'Quarterly deductee pack','ESI ceiling crossings',
--                   'Professional tax this month')
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
    IF def_type IS NULL OR def_type NOT LIKE '%''pack''%' THEN
        RAISE EXCEPTION 'GUARD 1: migration 166 has not run.';
    END IF;

    SELECT count(DISTINCT obligation_key) INTO n_statute
      FROM staging.statute_calendar
     WHERE obligation_key IN ('tds.deposit.monthly','esi.wage_ceiling',
           'esi.contribution_period.first','esi.contribution_period.second');
    IF n_statute <> 4 THEN
        RAISE EXCEPTION
            'GUARD 2: migration 172 has not run — only % of the 4 payroll '
            'statutory keys are present. #26 would compare nothing at all. Run '
            '172_statute_payroll_deposits.sql first.', n_statute;
    END IF;
END
$guard$;

INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, v.skill_type, v.category, v.module, v.icon, 'org',
       v.steps, 0, TRUE, FALSE
  FROM (VALUES

    ('No PF or ESI debit visible',
     'Between the run and the deposit date: what the approved run owes under PF and ESI, and whether any bank debit in the window looks like it. IT IS AN ABSENCE CLAIM, NOT A RECONCILIATION — nothing here records a challan and nothing parses a bank narration into a statutory head, so it can say a debit is not VISIBLE and never that a payment was not made. A debit it does find is a sighting, not a match: the real remittance bundles the employer share, admin charges and EDLI.',
     'check', 'people', 'ganit', 'search',
     '[{"order":1,"label":"What the run owes, and whether a debit is visible","skill_function":"check_pf_esi_debit_missing","generate_image":false}]'::jsonb),

    ('Salary certificate annexure',
     'Each employee''s twelve payslips rolled into the Part B heads, with the exceptions that stop a certificate issuing — no PAN, tax deducted against no PAN, a part-year record. A WORKING, NOT THE FORM: the certificate is generated on TRACES after the quarterly statement is processed and its Part A comes from there, so this is what you reconcile against before you issue it. It names which certificate it feeds, resolved for the year it runs for — Form 16 became Form 130 from 2026-27.',
     'pack', 'people', 'vetana', 'megaphone',
     '[{"order":1,"label":"The year''s payslips in certificate heads","skill_function":"pack_form130_annexure","generate_image":false}]'::jsonb),

    ('Quarterly deductee pack',
     'Per quarter, the salary-TDS deductee list ready for the return preparation utility — employee, PAN, amount paid, tax deducted, month — plus anyone whose tax was deducted against no PAN. NO CHALLAN INFORMATION, and none is possible: the tax shown is a computed liability on the payslip, not a deposited challan, so the challan columns stay yours to map. No due date is printed either — the fourth quarter differs from the other three, so no uniform day exists.',
     'pack', 'compliance', 'vetana', 'megaphone',
     '[{"order":1,"label":"The quarter''s deductees, and any with no PAN","skill_function":"pack_quarterly_deductees","generate_image":false}]'::jsonb),

    ('ESI ceiling crossings',
     'Employees whose wages are above the ESI ceiling with no contribution recorded, and those newly under it. CROSSING THE CEILING DOES NOT END THE OBLIGATION: an employee whose wages rise above it part way through a contribution period keeps contributing to the end of that period, and stopping the month the raise landed is an inspection finding. This reads one month, so every row is a question to check rather than a confirmed breach.',
     'check', 'people', 'vetana', 'search',
     '[{"order":1,"label":"Wages against the ceiling, and who still owes","skill_function":"check_esi_ceiling_crossings","generate_image":false}]'::jsonb),

    ('Professional tax this month',
     'Professional tax deducted this run, by person and department, with the states your slab table actually covers. NO DUE DATE AND NO PENALTY ARE SHOWN — PT is a state levy, both differ by state and by slab, and the slab table carries neither column. That table is also per-organisation rather than shared, so an org that has not seeded it is told it has no slabs instead of being shown a national default that does not exist.',
     'brief', 'people', 'vetana', 'calendar',
     '[{"order":1,"label":"PT deducted, and which state it cannot date","skill_function":"brief_professional_tax","generate_image":false}]'::jsonb)

  ) AS v(name, description, skill_type, category, module, icon, steps)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; missing text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 45 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 45 templates (40 + 5), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['check_pf_esi_debit_missing','pack_form130_annexure',
               'pack_quarterly_deductees','check_esi_ceiling_crossings',
               'brief_professional_tax']) AS fn
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

    RAISE NOTICE '173 · catalogue #23-#27 are on the shelf; % templates total.', n_total;
END
$verify$;

COMMIT;
