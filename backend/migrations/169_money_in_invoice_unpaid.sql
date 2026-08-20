-- 169_money_in_invoice_unpaid.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +1 row. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #16, "Money In, Invoice Unpaid" — the folio's "smallest wire with
-- the biggest return", and the first entry of the NEXT tier.
--
-- `match_bank_transactions` has been registered since the dispatcher was
-- written. It takes `bank_txns` as a REQUIRED parameter, so it is subject-bound,
-- unschedulable, and nothing has ever fed it the backlog — the same failure as
-- the two GST handlers that required `period`. `check_unmatched_receipts`
-- supplies the query that was missing.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
--
-- It does not return "the best invoice for this credit", which is what the
-- existing matcher returns and what a one-click accept list would need.
--
-- Measured live before building: the seeded org's open credits produce ties as
-- the ORDINARY case — one credit of ₹59,000 has ELEVEN unpaid invoices at
-- exactly that amount. `fuzzy_match_transactions` keeps `best_match` under
-- `if conf > best_conf`, so the first row of a tie wins and which invoice the
-- money is attributed to is decided by whatever order Postgres returned. One
-- click would then make that true.
--
-- So the question the skill answers is "can this be settled WITHOUT a person
-- choosing", and the three answers — one candidate, several, none — are three
-- sections of the output.
--
-- ── MEASURED ON THE LIVE DATABASE, read-only, 2026-08-20 ─────────────────────
--
-- Run against all three organisations. Two return nothing at all (neither has
-- ever imported a statement). The seeded org, over 180 days:
--
--     23 open credits examined
--      1 settled by one invoice   — matched on REFERENCE, and a part payment
--      9 need a decision          — one of them with 11 candidates
--     13 money in, nothing matches
--     12 invoices whose money is already in
--
-- That last figure is the one that matters most: twelve invoices the collection
-- pack would chase whose money is already sitting in the bank.
--
-- ── IT NEVER WRITES ──────────────────────────────────────────────────────────
--
-- "Paid" arrives from bank reconciliation and from nothing else — there is no
-- payment gateway and there will not be one. Accepting a suggestion stays a
-- human action on the reconciliation screen. `test_nothing_here_writes` scans
-- the module mechanically, and the handler is not in WRITE_SKILL_FUNCTIONS.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. One new card under Money →
-- Checks, in production, immediately. Inert until assigned; nothing armed.
--
-- LOCKS: one INSERT of one row. ROW EXCLUSIVE, no ALTER.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.hub_skill_templates
--    WHERE name = 'Money in, invoice unpaid'
--      AND NOT EXISTS (SELECT 1 FROM staging.hub_org_skills os
--                      WHERE os.template_id = hub_skill_templates.id);

BEGIN;

DO $guard$
DECLARE def_type text;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';
    IF def_type IS NULL OR def_type NOT LIKE '%''check''%' THEN
        RAISE EXCEPTION 'GUARD 1: migration 166 has not run.';
    END IF;
END
$guard$;

INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, 'check', 'money', 'ganit', 'search', 'org',
       v.steps, 0, TRUE, FALSE
  FROM (VALUES
    ('Money in, invoice unpaid',
     'Unreconciled bank credits split three ways: the ones a single invoice settles, the ones several invoices could settle so a person must choose, and money in that nothing explains. Plus the mirror — unpaid invoices whose exact balance is already sitting in an unmatched credit, which are the clients you must NOT chase. A reference that names an invoice beats an equal amount, because an amount is a coincidence. It suggests and never records: paid comes from reconciliation only.',
     '[{"order":1,"label":"Unreconciled credits, and what each one settles","skill_function":"check_unmatched_receipts","generate_image":false}]'::jsonb)
  ) AS v(name, description, steps)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; n_named int;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 35 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 35 templates (34 + 1), found %.', n_total;
    END IF;

    SELECT count(*) INTO n_named
      FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
     WHERE s->>'skill_function' = 'check_unmatched_receipts';
    IF n_named <> 1 THEN
        RAISE EXCEPTION 'VERIFY 2: check_unmatched_receipts named by % templates.', n_named;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 3: something is armed. This file writes no trigger.';
    END IF;

    RAISE NOTICE '169 · catalogue #16 is on the shelf; % templates total.', n_total;
END
$verify$;

COMMIT;
