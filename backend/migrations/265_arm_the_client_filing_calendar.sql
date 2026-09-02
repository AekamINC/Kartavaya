-- 265 - The filing calendar has data, so it goes on a schedule
--
-- 264 left these two off with a reason: `public.client_obligations` held zero
-- rows, so both returned an empty answer every month and arming them would have
-- manufactured the wallpaper the whole exercise was avoiding.
--
-- That reason is gone. The obligations screen shipped in 50252192, the first row
-- was written through it on 2026-09-02, and the calendar re-run produced two
-- dated filings for one client: GSTR-1 for August 2026 due 11 September, and
-- GSTR-3B due 20 September but WORKED BY 18 September, because the 20th is a
-- Sunday and the shift is always backwards.
--
-- Neither is in ACK_WIRING, and neither needs to be - that is 264's bar. A
-- filing calendar for the month ahead is replaced by next month's; a register of
-- who is monthly and who is QRMP is a statement of current state, not a list of
-- things somebody closes.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. This is production.
-- * 6 more grants become due (2 templates x 3 orgs), taking the total to 132.
--   Both are free, model-free and write-free; each run is one read-only SELECT.
-- * Both are anchored to day 1, so nothing fires until 1 October.
-- * GUARD 0 refuses outright if `client_obligations` is empty - the condition
--   that kept them off in the first place, checked rather than remembered.
--
-- -- ⚠ WHAT THIS RUN TAUGHT --------------------------------------------------
--
-- The calendar reads obligations AS AT the period it is dating, and the screen's
-- `effective_from` defaults to TODAY. So an obligation recorded today is
-- invisible to the month already under way: the first run returned
-- `could_not_check: true` and produced nothing, and only dated anything after
-- the row was amended to 2026-04-01. Nothing is wrong with either side - but the
-- form said only "Blank means today", which is true and not the whole truth, and
-- it now says to backdate to when the registration began.
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT name, trigger_config FROM public.hub_skill_templates
--    WHERE name IN ('Client filing calendar','Client obligations register');
--   SELECT count(*) FROM public.client_obligations;          -- must be > 0
--
-- -- Rollback ---------------------------------------------------------------
--
-- UPDATE public.hub_skill_templates SET trigger_config = NULL, updated_at = NOW()
--  WHERE name IN ('Client filing calendar','Client obligations register');

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- Its `when_to_run` still read "Once obligations are recorded", which was the
-- blocked state and is no longer true.
UPDATE public.hub_skill_templates
   SET when_to_run = 'Monthly, at the start of the month',
       updated_at  = NOW()
 WHERE name = 'Client obligations register';

UPDATE public.hub_skill_templates
   SET trigger_config = '{"type":"cron","day_of_month":1}'::jsonb,
       updated_at     = NOW()
 WHERE name IN ('Client filing calendar', 'Client obligations register');

DO $$
DECLARE armed int; priced int; grants int; obligations int;
BEGIN
  SELECT count(*) INTO obligations FROM public.client_obligations;
  IF obligations = 0 THEN
    RAISE EXCEPTION
      'Refusing to arm: client_obligations is empty, so both skills would '
      'return nothing every month. Record an obligation first.';
  END IF;

  SELECT count(*) INTO armed
    FROM public.hub_skill_templates WHERE trigger_config IS NOT NULL;
  IF armed <> 44 THEN
    RAISE EXCEPTION 'Expected 44 scheduled templates (42 + 2), found %.', armed;
  END IF;

  SELECT count(*) INTO priced FROM public.hub_skill_templates
   WHERE trigger_config IS NOT NULL AND COALESCE(estimated_credits,0) <> 0;
  IF priced <> 0 THEN
    RAISE EXCEPTION '% priced template(s) are on a schedule.', priced;
  END IF;

  SELECT count(*) INTO grants
    FROM public.hub_org_skills os
    JOIN public.hub_skill_templates t ON t.id = os.template_id
   WHERE os.is_active AND t.trigger_config IS NOT NULL;

  RAISE NOTICE 'Armed % templates over % grants, on % obligation row(s).',
    armed, grants, obligations;
END $$;

COMMIT;
