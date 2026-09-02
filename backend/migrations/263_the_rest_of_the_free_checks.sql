-- 263 - The rest of the free checks that can safely run themselves
--
-- -- What this changes ------------------------------------------------------
--
-- 262 armed ten. This arms eleven more, taking the shelf to 21 scheduled
-- templates and 63 active org grants. Everything here is free, model-free,
-- write-free, org-scopable, unattended-safe and dismissible - the same six
-- conditions, but this time three of them are PREDICATES rather than prose.
--
-- -- What "the rest" actually turned out to be ------------------------------
--
-- 49 free templates were unarmed. They divide sharply:
--
--     12  clear every condition
--     37  fail exactly one - THEY ARE NOT IN ACK_WIRING
--
-- So the binding constraint on arming the shelf is not credits, not writes and
-- not scheduling. It is that only 32 of the 78 skills can have a finding
-- dismissed, and an armed skill without that repeats the same rows for ever.
-- Wiring is a long tail of small, individually-verifiable commits - one skill
-- per commit, because which of a skill's fields are identity and which are
-- material is a judgement per skill and getting it wrong is silent.
--
-- Of the 12, eleven are armed. QUOTATION EXPIRY CHASE IS NOT: its own card
-- says "Once quotations exist", because nothing in the product creates a
-- quotation yet. A schedule would emit an empty finding every month for ever,
-- which is the wallpaper this file is trying to avoid making.
--
-- -- A position from 262 that has changed, and why --------------------------
--
-- 262 excluded "Before you send to a list" and "Consent ledger and STOP" as
-- GUARDS - things that answer "is this send safe?" and are worth nothing except
-- at the moment of sending. That argument was about where they should ALSO be
-- called from, and it stands: both should become pre-flight calls on the send
-- path, and neither is.
--
-- It was wrong to read it as "therefore never schedule them". A weekly list-
-- hygiene sweep and a monthly consent register are real compliance artefacts
-- for a firm under the DPDP Act, and both are free and dismissible. Being a
-- pre-flight and being a periodic report are not alternatives.
--
-- The consent ledger keeps its OTHER constraint untouched: it is deliberately
-- given no contact and no outbound, because a register of people who have not
-- consented must never acquire a second channel. Scheduling a read does not
-- touch that.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. This is production.
--
-- * 33 more grants become schedulable (11 templates x 3 orgs), taking the total
--   to 63. The three interval-based ones have `last_run_at IS NULL`, which the
--   predicate treats as due, so 9 runs land at the next 01:15 UTC sweep. The
--   day-anchored ones wait for their date - and note a day_of_month schedule
--   only fires if the daily sweep happens ON that day, which it does, once.
--
-- * WHAT A RUN DOES. One `skill_function` per step, one read-only SELECT
--   against the org's own records, dispatched sequentially. No model, no
--   credit, nothing written but the run row and `last_run_at`.
--
-- * WATCH `hub_org_skill_runs`, NOT `hub_skill_runs`. The latter is keyed on
--   `client_skill_id` and stays flat while org runs land beside it. 262's
--   verify block named the wrong one and had to be corrected.
--
-- * IDEMPOTENT. Re-running rewrites the same eleven configs. Section 2 refuses
--   unless the total is exactly 21, so a second arming from elsewhere is caught
--   rather than compounded, and it refuses outright if anything priced has
--   acquired a schedule.
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT name, trigger_config FROM public.hub_skill_templates
--    WHERE trigger_config IS NOT NULL ORDER BY name;      -- expect 21
--
--   SELECT count(*) FROM public.hub_org_skill_runs;       -- grows at each sweep
--   SELECT count(*) FROM public.hub_org_skills
--    WHERE last_run_at IS NOT NULL;                       -- was 15, heading to 63
--
-- -- Rollback ---------------------------------------------------------------
--
-- Disarms only this file's eleven, leaving 262's ten running:
--
-- UPDATE public.hub_skill_templates SET trigger_config = NULL, updated_at = NOW()
--  WHERE name IN ('Orders that cannot be filled','Before you send to a list',
--                 'Payment proof claims','Consent ledger and STOP',
--                 'Impossible stock figures','TDS threshold tripwire',
--                 'What has moved since the return went','ESI ceiling crossings',
--                 'Stale retainer rates','UPI reference threading',
--                 'Invoice series gaps and splits');

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 0 - The eleven, and the four guards ------------------------------------

CREATE TEMP TABLE _arming (name text PRIMARY KEY, cfg jsonb) ON COMMIT PRESERVE ROWS;

INSERT INTO _arming (name, cfg) VALUES
  -- Daily.
  ('Orders that cannot be filled',
     '{"type":"cron","interval_minutes":1440}'),

  -- Weekly. Neither has a calendar date: one is a list-hygiene sweep and the
  -- other waits on a client sending a screenshot, so a weekly pass is the
  -- honest reading of "before any broadcast" and "when a client sends one".
  ('Before you send to a list',
     '{"type":"cron","interval_minutes":10080}'),
  ('Payment proof claims',
     '{"type":"cron","interval_minutes":10080}'),

  -- Monthly, on the day the work falls.
  ('Consent ledger and STOP',
     '{"type":"cron","day_of_month":1}'),
  ('Impossible stock figures',
     '{"type":"cron","day_of_month":1}'),
  ('TDS threshold tripwire',
     '{"type":"cron","day_of_month":2}'),
  ('What has moved since the return went',
     '{"type":"cron","day_of_month":15}'),
  ('ESI ceiling crossings',
     '{"type":"cron","day_of_month":20}'),

  -- Quarterly, via the months filter the predicate already supports.
  ('Stale retainer rates',
     '{"type":"cron","day_of_month":1,"months":[1,4,7,10]}'),
  ('UPI reference threading',
     '{"type":"cron","day_of_month":7,"months":[1,4,7,10]}'),

  -- Twice a year: the Indian financial year ends 31 March, so April is the
  -- close and September is when the audit actually wants the series clean.
  ('Invoice series gaps and splits',
     '{"type":"cron","day_of_month":5,"months":[4,9]}');


-- The 32 skill_functions that ACK_WIRING covers, as of 2026-09-02. A skill
-- whose findings cannot be dismissed repeats them for ever, and arming one
-- manufactures wallpaper on a timer. 262 asserted this in prose and checked it
-- by hand; here it is a predicate, so the file cannot arm an unwired skill even
-- if somebody adds a name to the list above.
--
-- IT MUST BE RE-READ, NOT TRUSTED. Regenerate with:
--   grep -oE '^\s{4}"[a-z_0-9]+":' backend/services/skill_ack_wiring.py
-- (note the 0-9 — a pattern without it silently drops check_194q_approaching
-- and reports 31 where there are 32, which is exactly what happened.)
CREATE TEMP TABLE _ack (fn text PRIMARY KEY) ON COMMIT PRESERVE ROWS;
INSERT INTO _ack (fn) VALUES
  ('check_194q_approaching'),('check_amendments_before_filing'),
  ('check_approvals_that_sit'),('check_attendance_exceptions'),
  ('check_books_moved_since_due'),('check_broadcast_preflight'),
  ('check_chase_ladder'),('check_consent_ledger'),
  ('check_duplicate_vendor_bills'),('check_esi_ceiling_crossings'),
  ('check_impossible_stock'),('check_invoice_series_and_splits'),
  ('check_late_suppliers'),('check_msme_payment_clock'),
  ('check_payment_proof_claims'),('check_payroll_readiness'),
  ('check_quotation_expiry'),('check_received_not_invoiced'),
  ('check_retainers_that_stopped_billing'),('check_stale_retainer_rates'),
  ('check_statutory_records_gate'),('check_tds_thresholds'),
  ('check_unfillable_orders'),('check_unmatched_receipts'),
  ('check_upi_reference_threading'),('check_wip_ageing'),
  ('find_overdue_followups'),('find_overdue_invoices'),
  ('find_overdue_tasks'),('find_overdue_vendor_bills'),
  ('find_stalled_agreements'),('propose_payment_run');


-- GUARD 1 - every name resolves. A typo would arm ten and report success.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(a.name, '; ') INTO missing
    FROM _arming a
   WHERE NOT EXISTS (SELECT 1 FROM public.hub_skill_templates t WHERE t.name = a.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'No template named: %. Reconcile against the live names.', missing;
  END IF;
END $$;


-- GUARD 2 - free, model-free, write-free, and it actually has a data step.
-- Checked against the LIVE row, so a rename that made a name match a different
-- template aborts instead of arming something nobody chose.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s (%s)', t.name, g.why), '; ') INTO bad
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


-- GUARD 3 - EVERY data step is dismissible. Not "any": a skill whose second
-- step is unwired still repeats that step's findings for ever.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT t.name || ' (' || s.fn || ')', '; ') INTO bad
    FROM _arming a
    JOIN public.hub_skill_templates t ON t.name = a.name
    CROSS JOIN LATERAL (
      SELECT e->>'skill_function' AS fn
        FROM jsonb_array_elements(t.steps) e
       WHERE e ? 'skill_function'
    ) s
   WHERE NOT EXISTS (SELECT 1 FROM _ack WHERE _ack.fn = s.fn);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to arm, not in ACK_WIRING: %. An armed skill whose findings '
      'cannot be dismissed repeats them for ever - wire it one skill per commit '
      'first, then arm it.', bad;
  END IF;
END $$;


-- GUARD 4 - no hour the sweep can never reach. /cron/skills is served only by
-- cron-daily-prod on `15 1 * * *`, so EXTRACT(HOUR FROM now()) is always 1 and
-- any hour_utc above that is unsatisfiable for ever. 262 shipped its first
-- draft with 3 and 4 and would have armed five permanently dead schedules.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(a.name, '; ') INTO bad
    FROM _arming a
   WHERE COALESCE((a.cfg->>'hour_utc')::int, 0) > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to arm - hour_utc above the sweep hour, so these could never '
      'fire: %.', bad;
  END IF;
END $$;


-- -- 1 - Arm them ------------------------------------------------------------

UPDATE public.hub_skill_templates AS t
   SET trigger_config = a.cfg,
       updated_at     = NOW()
  FROM _arming a
 WHERE t.name = a.name;


-- -- 2 - Twenty-one armed in total, and nothing priced among them ------------

DO $$
DECLARE
  armed  int;
  priced int;
  grants int;
BEGIN
  SELECT count(*) INTO armed
    FROM public.hub_skill_templates WHERE trigger_config IS NOT NULL;
  IF armed <> 21 THEN
    RAISE EXCEPTION
      'Expected 21 scheduled templates (10 from 262 + 11 here), found %.', armed;
  END IF;

  SELECT count(*) INTO priced
    FROM public.hub_skill_templates
   WHERE trigger_config IS NOT NULL AND COALESCE(estimated_credits,0) <> 0;
  IF priced <> 0 THEN
    RAISE EXCEPTION
      '% priced template(s) are on a schedule. A timer bills assigned_by''s '
      'monthly ceiling with nobody watching.', priced;
  END IF;

  SELECT count(*) INTO grants
    FROM public.hub_org_skills os
    JOIN public.hub_skill_templates t ON t.id = os.template_id
   WHERE os.is_active AND t.trigger_config IS NOT NULL;

  RAISE NOTICE 'Armed % templates, covering % active org grants.', armed, grants;
END $$;

DROP TABLE _arming;
DROP TABLE _ack;

COMMIT;
