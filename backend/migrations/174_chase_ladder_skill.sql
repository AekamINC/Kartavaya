-- 174_chase_ladder_skill.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +1 row. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #28, "Document Chase — the email ladder", which the folio calls
-- THE HIGHEST-VALUE THING IN ITS TIER. The reason is not technical: document
-- intake and follow-up was ranked a top-three operational bottleneck by 58% of
-- firm leaders in AICPA's 2025 survey, ahead of billing complexity and
-- recruitment.
--
-- ── THE LADDER IS THE SKILL. THE LIST IS NOT. ────────────────────────────────
--
-- `find_overdue_tasks` and `find_stalled_agreements` already return the items,
-- and neither answers the question a person actually has on a Monday: which of
-- these have I already chased twice. Without that a firm does one of two
-- things, and both are bad — chase everything again every day until the
-- recipient filters them, or chase nothing because nobody can remember.
--
-- So every item comes back on a rung: +2 first nudge, +5 second nudge, +9 stop
-- nudging and tell somebody inside the firm. The rung is derived from what was
-- actually DELIVERED, read out of `staging.reminders`, not from the age — so
-- two items the same number of days overdue sit on different rungs when one
-- was chased and the other was missed.
--
-- This is the rare skill in the catalogue with a REAL done-state. #19's own
-- note is that it has none and would nag daily about a thing already filed;
-- here the reminder log answers it.
--
-- ── TWO BUGS THE LIVE RUN CAUGHT, BOTH COMPLETELY SILENT ─────────────────────
--
-- 1. `staging.reminders.entity_id` holds `public.tasks.id`, the UUID — NOT
--    `tasks.task_id`, which the same table also carries. Measured: 102 of 102
--    task reminders match `id` and NOT ONE matches `task_id`. Keying on the
--    wrong column returns zero chases for everything, so every item stays on
--    rung 1 and is chased daily for ever. It looked perfect: 163 items, all
--    "first nudge". After the fix the same org shows 147 nudges, 4 escalations
--    and 12 items correctly HOLDING because they are already chased.
--
-- 2. An expired signature carried an action in neither the due set nor the
--    holding set, so it was counted in `expired_signatures` and rendered in no
--    list at all. A row that a count insists exists and no reader can find is
--    worse than either showing it or not counting it. It has its own list now,
--    and a test asserts every item appears in exactly one.
--
-- ── MEASURED LIVE, read-only, 2026-08-20 ─────────────────────────────────────
--
--   seeded org  163 waiting — 134 overdue tasks and 29 unsigned documents.
--               147 nudges due, 4 escalations, 12 holding.
--   Unicode     21 waiting, 19 nudges, 1 holding, 1 expired signature.
--   Aekam Inc   nothing waiting. Its 17 chased tasks are all closed, which is
--               the ladder's exit working.
--   eSign       NOT ONE reminder row has ever carried entity_type
--               'sign_documents'. Nothing has ever chased a signature in this
--               product, so all 31 stalled ones are on rung zero — the single
--               largest finding this skill produces on day one.
--
-- ── IT SENDS NOTHING AND WRITES NOTHING ──────────────────────────────────────
--
-- Not even a reminder row: writing one would mark an item chased that nobody
-- chased. Delivering is a Niyam rule and arming one is the owner's decision.
-- `test_it_never_sends_and_never_writes` scans the module mechanically.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. One new card under General →
-- Checks in production. Inert until assigned; nothing armed.
--
-- LOCKS: one INSERT of one row. ROW EXCLUSIVE, no ALTER.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.hub_skill_templates
--    WHERE name = 'What we are waiting on'
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
SELECT v.name, v.description, 'check', 'general', 'kartavya', 'calendar', 'org',
       v.steps, 0, TRUE, FALSE
  FROM (VALUES
    ('What we are waiting on',
     'Everything the firm is waiting on and has not got — overdue tasks and documents sent for signature — each placed on a chase ladder: a first nudge at 2 days, a second at 5, and at 9 days STOP NUDGING and tell someone inside the firm instead. The rung comes from what was actually delivered, read from the reminder log, so it never repeats a chase and never skips one either. It says what is due and to whom; it sends nothing and records nothing, because recording a chase nobody sent is worse than sending none.',
     '[{"order":1,"label":"What is waiting, and which rung each item is owed","skill_function":"check_chase_ladder","generate_image":false}]'::jsonb)
  ) AS v(name, description, steps)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; n_named int;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 46 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 46 templates (45 + 1), found %.', n_total;
    END IF;

    SELECT count(*) INTO n_named
      FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
     WHERE s->>'skill_function' = 'check_chase_ladder';
    IF n_named <> 1 THEN
        RAISE EXCEPTION 'VERIFY 2: check_chase_ladder named by % templates.', n_named;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 3: something is armed. This file writes no trigger.';
    END IF;

    RAISE NOTICE '174 · catalogue #28 is on the shelf; % templates total.', n_total;
END
$verify$;

COMMIT;
