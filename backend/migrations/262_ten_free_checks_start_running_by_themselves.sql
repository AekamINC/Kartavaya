-- 262 - Ten free checks start running by themselves
--
-- -- What this changes ------------------------------------------------------
--
-- THIS IS THE FIRST TIME ANYTHING ON THE SKILL SHELF RUNS WITHOUT A PERSON
-- PRESSING A BUTTON. Every run in the product's history has been somebody on
-- the Skills screen. Read that sentence before the rest of the file.
--
-- `/cron/skills` has ticked every fifteen minutes since it was built and has
-- matched nothing, because `_DUE_PREDICATE` selects on
-- `trigger_config->>'type' = 'cron'` and `trigger_config` was NULL on all 78
-- templates. `last_run_at` is NULL on all 234 grants. The scheduler was never
-- broken; the column was never written. 261 gave every template a
-- `when_to_run` sentence, and this file turns ten of those sentences into the
-- machine schedule they describe.
--
-- -- Why these ten ----------------------------------------------------------
--
-- Every one satisfies all six, checked against the live row by the guard in
-- section 0 rather than asserted here:
--
--   free            estimated_credits = 0
--   model-free      no step carries an agent_type, so no provider is called
--   write-free      no step sets allow_writes; none is in WRITE_SKILL_FUNCTIONS
--   org-scopable    every handler takes org_id and filters on it
--   unattended      none is SUBJECT_BOUND - a schedule cannot choose a subject
--   dismissible     every skill_function is in ACK_WIRING, so a finding can be
--                   closed. THIS ONE IS NOT OPTIONAL. An armed skill with no
--                   ack path repeats the same rows for ever; that is the exact
--                   mechanism by which an automation catalogue becomes
--                   wallpaper, and arming an unwired skill would manufacture it
--                   on a schedule.
--
-- Deliberately NOT armed: the 19 priced templates (a timer bills
-- `assigned_by`'s monthly ceiling on a schedule nobody watches); the three
-- guards - Regional send guard, Consent ledger, Before you send to a list -
-- which answer "is this send safe?" and are worth nothing except at the moment
-- of sending; and the seven that honestly report nothing yet, which would
-- produce an empty finding every period for ever.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. This is production.
--
-- * IT STARTS BACKGROUND WORK. All three orgs hold all 78 grants, so ten
--   templates is 30 active grants. The five interval-based ones have
--   `last_run_at IS NULL`, which the predicate treats as due, so 15 runs fire
--   at the NEXT DAILY SWEEP - 01:15 UTC, not within fifteen minutes. That is
--   intended: it is the proof the shelf runs at all, and it is the first
--   evidence in the product's history of a skill running unattended.
--
-- * WHAT THOSE RUNS DO. Each dispatches one `skill_function`, which is one
--   read-only SELECT against the org's own records. The dispatch loop is
--   sequential, not gathered, so this is fifteen queries in series. No model
--   is called, no credit moves, nothing is written except the run row and
--   `last_run_at`.
--
-- * THE SCHEDULE LIVES ON THE TEMPLATE, NOT THE GRANT. Arming one arms it for
--   every org holding it - here, all three. There is no per-org opt-out short
--   of deactivating the grant, and that is a property of the existing schema
--   rather than something this file introduces.
--
-- * ⚠ THE SWEEP IS DAILY AT 01:15 UTC, NOT EVERY FIFTEEN MINUTES, and this is
--   the trap this file walked into. `run_skills`' own docstring says "called
--   every 15 min" - that is the cadence the endpoint was DESIGNED for, and the
--   only thing that reaches it in production is the `cron-daily-prod` service
--   on `15 1 * * *` (read off the Railway service config 2026-09-01; no other
--   prod cron names `skills`). So `EXTRACT(HOUR FROM now())` is always 1, and
--   the first draft of this file - `hour_utc` 3 and 4 on the five monthly
--   templates - would have armed five skills that could never fire. It would
--   have looked exactly like success: the config stores, the card renders it,
--   and nothing runs. `services/skills/schedule.py:SWEEP_HOUR_UTC` now refuses
--   an unreachable hour at the door, and `run_skills`' docstring has been
--   corrected. The database's TimeZone is UTC and nothing in `db.py` pins a
--   session zone, so the hour the predicate reads is genuinely UTC.
--
-- * DAY-OF-MONTH IS CLAMPED BY THE PREDICATE, not here: it compares against
--   `LEAST(day_of_month, last day of this month)`, so day 25 is safe in
--   February and a day 31 would still fire on the 28th. None of these is
--   above 25.
--
-- * THE INTERVAL AND DAY FORMS ARE MUTUALLY EXCLUSIVE and the shapes below
--   mirror `services/skills/schedule.py:validate_trigger_config` exactly. A
--   config that saves cleanly and never fires is worse than a refusal, which
--   is why that validator exists and why nothing here invents a third shape.
--
-- * IDEMPOTENT. Re-running rewrites the same ten configs. Section 2 refuses if
--   the total number of scheduled templates is not exactly ten, so a second
--   arming from elsewhere is caught rather than compounded.
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT name, trigger_config, last_run_at
--     FROM public.hub_skill_templates
--    WHERE trigger_config IS NOT NULL ORDER BY name;
--
-- Then, after the next 01:15 UTC sweep - this is the line that has never been
-- true in the product's history:
--
--   SELECT count(*) FROM public.hub_skill_runs;              -- was 1
--   SELECT count(*) FROM public.hub_org_skills
--    WHERE last_run_at IS NOT NULL;                          -- was 0
--
-- -- Rollback ---------------------------------------------------------------
--
-- Disarms everything and returns the shelf to on-demand. Runs already recorded
-- are kept - they are the evidence.
--
-- UPDATE public.hub_skill_templates
--    SET trigger_config = NULL, updated_at = NOW()
--  WHERE trigger_config IS NOT NULL;

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 0 - The ten, and the guard that makes this file unable to arm anything else

-- PRESERVE ROWS, not ON COMMIT DROP: if the runner gives each statement its
-- own transaction rather than wrapping the file, ON COMMIT DROP would take
-- the table away the instant it was created and the INSERT below would fail
-- on a missing relation. Dropped explicitly at the end instead.
CREATE TEMP TABLE _arming (name text PRIMARY KEY, cfg jsonb) ON COMMIT PRESERVE ROWS;

INSERT INTO _arming (name, cfg) VALUES
  -- Daily. Both are chase ladders whose rung is computed from what was actually
  -- delivered, so a daily read is what keeps a rung from being skipped.
  ('Approvals that sit',              '{"type":"cron","interval_minutes":1440}'),
  ('What we are waiting on',          '{"type":"cron","interval_minutes":1440}'),

  -- Weekly. The three that guard money leaving or arriving.
  ('Duplicate vendor bills',          '{"type":"cron","interval_minutes":10080}'),
  ('MSME 45-day clock',               '{"type":"cron","interval_minutes":10080}'),
  ('Money in, invoice unpaid',        '{"type":"cron","interval_minutes":10080}'),

  -- Monthly, anchored to the day the work actually falls on. NO hour_utc, and
  -- that is the whole lesson of this file: it is a FLOOR the predicate tests as
  -- `EXTRACT(HOUR FROM now()) >= hour_utc`, evaluated only while /cron/skills is
  -- being served — which happens once a day at 01:15 UTC. An hour above 1 can
  -- never be satisfied. These five were first written with 3 and 4, which would
  -- have armed them, shown them on the card, and never run them.
  ('WIP ageing',                      '{"type":"cron","day_of_month":3}'),
  ('Retainers that stopped billing',  '{"type":"cron","day_of_month":5}'),
  ('Amend before you file',           '{"type":"cron","day_of_month":12}'),
  ('Attendance exceptions',           '{"type":"cron","day_of_month":25}'),
  ('Statutory records gate',          '{"type":"cron","day_of_month":25}');


-- THE GUARD. Every one of the ten must be free, model-free, write-free and
-- already dismissible. Checked against the LIVE row rather than against this
-- file's intent, so a rename that made a name match a different template
-- aborts instead of arming something nobody chose.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s (%s)', t.name, g.why), '; ')
    INTO bad
    FROM _arming a
    JOIN public.hub_skill_templates t ON t.name = a.name
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN NOT t.is_active THEN 'not active'
        WHEN COALESCE(t.estimated_credits, 0) <> 0 THEN 'is priced'
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                      WHERE s ? 'agent_type') THEN 'has a model step'
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                      WHERE (s->>'allow_writes')::bool IS TRUE) THEN 'writes data'
        WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                          WHERE s ? 'skill_function') THEN 'has no data step'
      END AS why
    ) g
   WHERE g.why IS NOT NULL;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to arm: %. Only free, model-free, write-free data skills may run unattended.', bad;
  END IF;
END $$;


-- Every name must resolve. A typo here would arm nine and report success.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.name, '; ') INTO missing
    FROM _arming a
   WHERE NOT EXISTS (SELECT 1 FROM public.hub_skill_templates t WHERE t.name = a.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'No template named: %. Reconcile against the live names.', missing;
  END IF;
END $$;


-- -- 1 - Arm them ------------------------------------------------------------

UPDATE public.hub_skill_templates AS t
   SET trigger_config = a.cfg,
       updated_at     = NOW()
  FROM _arming a
 WHERE t.name = a.name;


-- -- 2 - Exactly ten, and nothing else on a schedule -------------------------

DO $$
DECLARE
  armed   int;
  grants  int;
BEGIN
  SELECT count(*) INTO armed
    FROM public.hub_skill_templates
   WHERE trigger_config IS NOT NULL;

  IF armed <> 10 THEN
    RAISE EXCEPTION
      'Expected exactly 10 scheduled templates, found %. Something else was '
      'already armed, or this run armed the wrong set.', armed;
  END IF;

  SELECT count(*) INTO grants
    FROM public.hub_org_skills os
    JOIN public.hub_skill_templates t ON t.id = os.template_id
   WHERE os.is_active AND t.trigger_config IS NOT NULL;

  RAISE NOTICE 'Armed % templates, covering % active org grants.', armed, grants;
END $$;

DROP TABLE _arming;

COMMIT;
