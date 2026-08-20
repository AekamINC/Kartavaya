-- 167_first_tier_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +14 rows. Nothing else in the table is read,
--                                 updated or deleted; the existing nineteen are
--                                 not touched by any statement here.
--
-- No schema change of any kind: no column, no constraint, no index, no table.
-- Re-running inserts nothing — every row is guarded by NOT EXISTS on `name`.
--
-- Requires 166. These rows carry `skill_type` values ('check', 'brief', 'pack')
-- and `category` values ('compliance', 'money', 'people', 'stock') that both
-- CHECK constraints refuse until 166 has run. GUARD 1 says so in a sentence
-- rather than letting you read a constraint violation and work it out.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Folio 2 of docs/proposals/70-the-night-ledger.html. Fourteen handlers were
-- written, tested and wired (518b5301) and no template named any of them, so
-- nothing in the product could reach a single one. This is the shelf they go on.
--
-- ── THE FIRST GENUINELY FREE SKILLS IN THE CATALOGUE ─────────────────────────
--
-- Every one of these is `skill_function`-only. Not one carries an `agent_type`
-- step, so not one calls a model, so `estimated_credits = 0` is TRUE — which it
-- has never been before. 166's header records the thirteen cards that read
-- "0 credits" and charged 2 anyway; these fourteen are what a 0 is supposed to
-- mean. They cost the same to serve as a page of the ledger, because that is
-- what they are.
--
-- That is also why 166 and this file agree by construction rather than by
-- coincidence: 166 section 6 computes a template's price by summing
-- `credit_prices` over its agent steps, and a template with no agent steps sums
-- to 0. Re-run 166 after this and all fourteen stay at 0.
--
-- `"generate_image": false` is written on every step even though it cannot
-- matter. `routers/hub.py` reads that key inside the LLM branch — the one that
-- refunds a generation that failed — and a function-only template never reaches
-- that branch at all. It is written because an image is $0.036-0.040 a call and
-- 79% of all AI spend to date, and because the next person to add a step to one
-- of these should have to delete the word `false` to make a picture happen.
--
-- ── NOTHING IS ARMED ─────────────────────────────────────────────────────────
--
-- `trigger_config` and `default_schedule` are not named in any INSERT below, so
-- all fourteen arrive NULL, exactly like the nineteen already there. A skill
-- with a NULL trigger_config is never selected by the cron's due predicate, so
-- these rows dispatch nothing and cost nothing until somebody deliberately
-- schedules one through `PUT /skills/templates/{id}/schedule`.
--
-- ARMING A SKILL IS THE OWNER'S DECISION. It is not a side effect of putting
-- one on the shelf, and this file does not make it. VERIFY 4 refuses the
-- transaction if any row anywhere in the table has acquired a trigger.
--
-- ── WHAT A READER GETS FOR FREE, AND WHAT THEY STILL NEED ────────────────────
--
-- `scope = 'org'`, like every other operational skill: these read one
-- organisation's own records and have no per-client meaning.
--
-- Being on the shelf is not being allowed to run it. Every one of these reads a
-- gated module — ganit, vetana, manav, vikray, and for three of them graha as
-- well — and `services/skills/modules.py` refuses a caller who does not hold
-- every module the handler touches. A firm with Sahayak and nothing else sees
-- these cards and cannot run them, which is correct and is the whole point of
-- that file.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Fourteen new cards appear on the
-- Skills catalogue in production the moment this commits. They are inert: each
-- must be assigned to an org before it can be run, and run by hand until
-- somebody schedules it.
--
-- Two of the five new shelves are empty until this runs — `stock` has no
-- occupant at all after 166 — so this is also what makes 166's taxonomy look
-- like a taxonomy rather than a rename.
--
-- LOCKS. One INSERT of 14 rows. ROW EXCLUSIVE on hub_skill_templates, no ALTER,
-- nothing scanned, nothing rewritten, no other table touched. There is nothing
-- here to queue behind, so `SET LOCAL lock_timeout` is deliberately absent —
-- the BEGIN is for atomicity, so a failed verification takes all fourteen rows
-- with it rather than leaving a half-stocked shelf.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.hub_skill_templates
--    WHERE name IN (… the fourteen names below …)
--      AND NOT EXISTS (SELECT 1 FROM staging.hub_org_skills os
--                      WHERE os.template_id = hub_skill_templates.id);
--
-- The NOT EXISTS is not optional. `hub_org_skills.template_id` references these
-- ids, so once an org has adopted one, deleting the template either fails or
-- cascades away that org's grant and its run history. Un-stock a shelf by
-- setting `is_active = FALSE`, which hides the card and keeps every adoption.

BEGIN;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · GUARDS
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard$
DECLARE
    def_type text;
    def_cat  text;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';

    IF def_type IS NULL OR def_type NOT LIKE '%''check''%' THEN
        RAISE EXCEPTION
            'GUARD 1: migration 166 has not run. The skill_type CHECK either '
            'does not exist or does not admit ''check'', so every INSERT below '
            'would be refused. Run 166_skill_taxonomy.sql first.';
    END IF;

    SELECT pg_get_constraintdef(con.oid) INTO def_cat
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_category_check';

    IF def_cat IS NULL OR def_cat NOT LIKE '%''compliance''%' THEN
        RAISE EXCEPTION
            'GUARD 2: the category CHECK does not admit ''compliance''. '
            'Migration 166 has not run, or has been reverted.';
    END IF;
END
$guard$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · THE FOURTEEN
--
-- One step each, and the step names a handler in
-- `services/skill_dispatcher.SKILL_REGISTRY`. NO PARAMS BLOCK on any of them,
-- deliberately: every limit and window these handlers take already has a
-- default in the registry entry, and a `params` block here would be a second
-- copy of that number, free to drift from it silently. The existing templates
-- carry one and that is exactly the trap — `Overdue follow-up chase` repeats
-- `{"module": "follow_ups", "days_overdue": 0}`, which is the registry default
-- written twice.
--
-- `label` is what the run log and the catalogue card show for the step. It says
-- what the step reads, in a firm's words rather than the function's.
--
-- Guarded by NOT EXISTS on `name`, not by ON CONFLICT: `name` carries no unique
-- index, so there is no arbiter for ON CONFLICT to use and it would be a syntax
-- error dressed as idempotency.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, v.skill_type, v.category, v.module, v.icon, 'org',
       v.steps, 0, TRUE, FALSE
  FROM (VALUES

    -- ── compliance ─────────────────────────────────────────────────────────

    ('IMS expectations brief',
     'Every vendor bill in the period by tax value, split on whether the vendor has a GSTIN — what to expect on the IMS dashboard before you open it. Defaults to the period being filed, not the current month.',
     'brief', 'compliance', 'ganit', 'calendar',
     '[{"order":1,"label":"Vendor bills in the period, by GSTIN","skill_function":"brief_ims_expectations","generate_image":false}]'::jsonb),

    ('Input tax credit about to lapse',
     'Prior-year vendor bills and their tax measured against the s.16(4) bar, by vendor. Defaults to the most recently ended financial year — the one with a live deadline.',
     'brief', 'compliance', 'ganit', 'calendar',
     '[{"order":1,"label":"Prior-year credit against the s.16(4) bar","skill_function":"brief_itc_at_risk_of_lapse","generate_image":false}]'::jsonb),

    ('Dead GST rates',
     'Products and document lines still carrying a GST rate that no longer exists, plus invoice lines whose rate disagrees with the product master. Rates come from the dated statute table, never from memory.',
     'check', 'compliance', 'ganit', 'search',
     '[{"order":1,"label":"Rates that no longer exist","skill_function":"check_dead_gst_slabs","generate_image":false}]'::jsonb),

    ('Invoice series gaps and splits',
     'Serial gaps and duplicates in a financial year, and lines on the wrong tax head. Refuses to answer rather than answer half — a capped series scan invents holes instead of missing them.',
     'check', 'compliance', 'ganit', 'search',
     '[{"order":1,"label":"Gaps, duplicates and wrong tax heads","skill_function":"check_invoice_series_and_splits","generate_image":false}]'::jsonb),

    ('Statutory records gate',
     'Employees whose statutory identifiers are missing for a deduction the payroll run will make anyway — the PF, ESI and PAN joins nothing else in the product performs. Reports; blocks nothing.',
     'check', 'compliance', 'vetana', 'search',
     '[{"order":1,"label":"Missing UAN, ESI and PAN against live deductions","skill_function":"check_statutory_records_gate","generate_image":false}]'::jsonb),

    ('Statutory dues brief',
     'What the last APPROVED payroll run owes, when it is due, and last month beside it. Due dates come from the dated statute table; where the catalogue records none, it says so instead of printing one from memory.',
     'brief', 'compliance', 'vetana', 'calendar',
     '[{"order":1,"label":"PF, ESI and TDS owed on the approved run","skill_function":"brief_statutory_dues","generate_image":false}]'::jsonb),

    -- ── money ──────────────────────────────────────────────────────────────

    ('Retainers that stopped billing',
     'Retainers about to fail, and live contracts that billed nothing this month. On the seeded org: 30 live contracts examined, 20 with a finding — 15 that raised no invoice at all.',
     'check', 'money', 'ganit', 'search',
     '[{"order":1,"label":"Contracts that raised nothing","skill_function":"check_retainers_that_stopped_billing","generate_image":false}]'::jsonb),

    ('Duplicate vendor bills',
     'Vendor bills that are probably one bill entered twice. Run it BEFORE the payment run — that skill has no notion of a duplicate, so a bill entered twice is proposed twice and paid twice.',
     'check', 'money', 'ganit', 'search',
     '[{"order":1,"label":"Candidate duplicate pairs, by vendor","skill_function":"check_duplicate_vendor_bills","generate_image":false}]'::jsonb),

    ('Collection message pack',
     'One ready-to-send collection message per overdue invoice, oldest first, with the payment address on each. Drafts only — it sends nothing. Says up front if no receiving address is recorded.',
     'pack', 'money', 'ganit', 'megaphone',
     '[{"order":1,"label":"A drafted chase per overdue invoice","skill_function":"pack_collection_messages","generate_image":false}]'::jsonb),

    ('Stale retainer rates',
     'Engagements about to expire, and fees nobody has revisited in a year or more, with the customer on each.',
     'check', 'money', 'ganit', 'search',
     '[{"order":1,"label":"Expiring engagements and unrevised fees","skill_function":"check_stale_retainer_rates","generate_image":false}]'::jsonb),

    -- ── people ─────────────────────────────────────────────────────────────

    ('Attendance exceptions',
     'What the attendance record cannot support, before the payroll cutoff — every finding is still fixable then and none of it is fixable after the run. Says so plainly when there is no punch data at all.',
     'check', 'people', 'manav', 'search',
     '[{"order":1,"label":"Attendance the record cannot support","skill_function":"check_attendance_exceptions","generate_image":false}]'::jsonb),

    ('Unpaid reimbursements',
     'Expense claims approved and not yet reimbursed, aged, by person and team. Unpaid means no payroll run has ever picked the claim up, not that somebody has yet to decide on it.',
     'brief', 'people', 'manav', 'calendar',
     '[{"order":1,"label":"Approved claims no run has reimbursed","skill_function":"brief_unpaid_reimbursements","generate_image":false}]'::jsonb),

    -- ── stock ──────────────────────────────────────────────────────────────

    ('Impossible stock figures',
     'Stock figures that cannot be true, and the movements behind them, in descending order of how sure of each we can be.',
     'check', 'stock', 'vikray', 'search',
     '[{"order":1,"label":"Figures that cannot be true","skill_function":"check_impossible_stock","generate_image":false}]'::jsonb),

    ('Orders that cannot be filled',
     'Open order lines against the stock actually on hand, in pick order — separating what is short today from what was never stocked at all, because they are different problems with different answers.',
     'check', 'stock', 'vikray', 'search',
     '[{"order":1,"label":"Open lines against stock on hand","skill_function":"check_unfillable_orders","generate_image":false}]'::jsonb)

  ) AS v(name, description, skill_type, category, module, icon, steps)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · PROVE IT, IN THE SAME TRANSACTION
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_total   int;
    n_free    int;
    n_ai      int;
    n_shelves int;
    r         record;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 33 THEN
        RAISE EXCEPTION
            'VERIFY 1: expected 33 templates (19 + 14), found %. Either a row '
            'failed to insert or the catalogue changed underneath this file.',
            n_total;
    END IF;

    -- The claim this migration makes about itself. Any of the fourteen carrying
    -- an agent step would be a card that says free and charges.
    SELECT count(*) INTO n_ai
      FROM staging.hub_skill_templates t
     WHERE t.estimated_credits = 0
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                   WHERE s ? 'agent_type');
    IF n_ai <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 2: % template(s) claim 0 credits and carry an agent step. '
            'That is the exact defect 166 was written to end.', n_ai;
    END IF;

    SELECT count(*) INTO n_free
      FROM staging.hub_skill_templates
     WHERE skill_type IN ('check','brief','pack') AND estimated_credits = 0;
    IF n_free < 14 THEN
        RAISE EXCEPTION
            'VERIFY 3: only % genuinely free check/brief/pack skills, expected '
            'at least 14.', n_free;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION
            'VERIFY 4: something is armed. This file writes no trigger_config '
            'and arming a skill is the owner''s decision, not a side effect of '
            'stocking a shelf.';
    END IF;

    -- Every new row must carry exactly one step, and that step must name a
    -- function. A row with an empty steps array is a card that runs and
    -- returns nothing, which reads as a broken skill rather than as a bad row.
    IF EXISTS (
        SELECT 1 FROM staging.hub_skill_templates t
         WHERE t.skill_type IN ('check','brief','pack')
           AND t.estimated_credits = 0
           AND (jsonb_array_length(t.steps) <> 1
                OR NOT (t.steps->0 ? 'skill_function'))
    ) THEN
        RAISE EXCEPTION 'VERIFY 5: a free skill does not carry exactly one '
                        'skill_function step.';
    END IF;

    SELECT count(DISTINCT category) INTO n_shelves
      FROM staging.hub_skill_templates
     WHERE category IN ('compliance','money','people','stock','growth');
    IF n_shelves <> 5 THEN
        RAISE EXCEPTION
            'VERIFY 6: only % of the 5 new shelves have an occupant. ''stock'' '
            'is empty until this migration runs, so an empty shelf here means '
            'a row did not land.', n_shelves;
    END IF;

    RAISE NOTICE '167 · the shelf, after:';
    FOR r IN
        SELECT category, skill_type, count(*) AS n, sum(estimated_credits) AS cr
          FROM staging.hub_skill_templates
         GROUP BY category, skill_type ORDER BY category, skill_type
    LOOP
        RAISE NOTICE '    %  ·  %  ·  % skill(s), % credit(s)',
            rpad(r.category, 10), rpad(r.skill_type, 7), r.n, r.cr;
    END LOOP;
END
$verify$;

COMMIT;
