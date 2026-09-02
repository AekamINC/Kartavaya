-- 264 - The period-scoped free checks, and a bar that moves for them
--
-- -- What this changes ------------------------------------------------------
--
-- 21 more templates on a schedule, taking the shelf to 42 and 126 active org
-- grants. Everything here is free, model-free and write-free, as before.
--
-- -- The rule that changed, and why ------------------------------------------
--
-- 262 and 263 required every armed skill to be in ACK_WIRING. That rule was
-- right for findings that PERSIST - an overdue bill sits there until somebody
-- pays it, and without a dismiss path it is read again for ever.
--
-- It was wrong as a universal, and applying it universally is what produced the
-- claim that 37 skills were "blocked on ack wiring". They were not.
-- `skill_ack_wiring.py` had already MEASURED AND EXCLUDED them, and re-checking
-- all 37 against its categories - using the output shapes of the 455 completed
-- runs in `hub_org_skill_runs` rather than guessing - confirmed 36 were
-- correctly out. A GSTR-9 working paper, a month's professional tax, a service
-- window that shuts on the clock: none of those is a row somebody closes. The
-- period closes it.
--
-- So the bar becomes "in ACK_WIRING, or carries a recorded reason it need not
-- be", and GUARD 3 enforces the disjunction. The reason lives in the row beside
-- the schedule, because a judgement kept next to the thing it licenses is the
-- one that gets re-read when somebody changes that thing.
--
-- The guard cannot check a reason is TRUE. No predicate can. It refuses an
-- arming that never made one, which is the failure worth preventing - arming by
-- momentum, one more name added to a list that already worked.
--
-- -- What is still NOT armed, and why ----------------------------------------
--
-- Seventeen remain, and every one has a reason that is not "we ran out of time":
--
--   REPORTS NOTHING YET (no screen writes the input): Bank narration rule
--     candidates, Learned categorisation, Client obligations register,
--     Quotation expiry chase, Document chase - can the WhatsApp leg run?
--     ⚠ CLIENT FILING CALENDAR JOINS THEM: `public.client_obligations` holds
--     ZERO rows, so it would return an empty calendar every month. It is the
--     highest-value conversion on the shelf and it is waiting on a screen, not
--     on a schedule.
--
--   EVENT-DRIVEN, needing a subject a timer cannot choose: Mismatch schedule
--     for a notice (an intimation), Working paper figures (a guard's
--     difference), New lead first touch (a lead), Event follow-up split (an
--     event closing), Reply grounding (one conversation).
--
--   ONE-OFF DECISIONS, not recurring reading: Can we watch ticket SLAs at all?,
--     Inbound triage and what a model would cost, Vernacular template pack,
--     Engagement letter - what it would be built from.
--
--   A MOMENTARY GUARD: Regional send guard. Unlike the two guards 263 did arm,
--     it has no accumulating state - "would a send land on a holiday today" is
--     true or false at the instant of sending and says nothing a month later.
--     263 armed list hygiene and the consent register because both DRIFT; this
--     one does not.
--
--   DRAFTS NOBODY CAN SEND: Collection message pack. It writes a message per
--     overdue invoice, and until the send verb exists a schedule would
--     regenerate drafts into a screen nobody acts from - and overdue invoices
--     persist, so it would repeat. It is armable the day either changes.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. This is production.
--
-- * 63 more grants become schedulable (21 x 3 orgs), taking the total to 126.
--   The three interval-based ones have `last_run_at IS NULL` and fire at the
--   next 01:15 UTC sweep - 9 runs. The rest wait for their date, and several
--   wait for their MONTH: the annual and quarterly ones will not run at all
--   until November, October, February, March or June, which is correct and
--   will look like nothing happening.
--
-- * WHAT A RUN DOES. One read-only SELECT per step, dispatched sequentially.
--   No model, no credit, nothing written but the run row and `last_run_at`.
--
-- * WATCH `hub_org_skill_runs`, NOT `hub_skill_runs`.
--
-- * IDEMPOTENT. Section 2 refuses unless the total is exactly 42.
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT count(*) FROM public.hub_skill_templates
--    WHERE trigger_config IS NOT NULL;                      -- expect 42
--   SELECT count(*) FROM public.hub_org_skills
--    WHERE last_run_at IS NOT NULL;                         -- was 15, heading to 126
--
-- -- Rollback ---------------------------------------------------------------
--
-- UPDATE public.hub_skill_templates SET trigger_config = NULL, updated_at = NOW()
--  WHERE name IN (SELECT name FROM (VALUES 
--        ('Dead GST rates'),
--        ('Annual return — books side'),
--        ('Annual return — the 9C books side'),
--        ('Credit at risk of reversal (180 days)'),
--        ('E-invoice reporting window'),
--        ('IMS expectations brief'),
--        ('Input tax credit about to lapse'),
--        ('LUT expiry'),
--        ('No PF or ESI debit visible'),
--        ('Set aside for advance tax'),
--        ('Thresholds you are approaching'),
--        ('Your own filing calendar'),
--        ('Unpaid reimbursements'),
--        ('Where the AI spend went'),
--        ('Conversations about to require a template'),
--        ('Free entry point harvest'),
--        ('What WhatsApp is costing you'),
--        ('Professional tax this month'),
--        ('Quarterly deductee pack'),
--        ('Salary certificate annexure'),
--        ('Statutory dues brief')) AS v(name));

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 0 - The twenty-one, each with its answer to "why no acknowledgement?" ---

CREATE TEMP TABLE _arming (name text PRIMARY KEY, cfg jsonb, why_no_ack text)
  ON COMMIT PRESERVE ROWS;

INSERT INTO _arming (name, cfg, why_no_ack) VALUES
  ('Dead GST rates',
   '{"type":"cron","day_of_month":10,"months":[1,4,7,10]}',
   ''),
  ('Annual return — books side',
   '{"type":"cron","day_of_month":1,"months":[11]}',
   'GSTR-9 is due 31 December; the form is rebuilt from the year that closed and the previous year''s is never shown again'),
  ('Annual return — the 9C books side',
   '{"type":"cron","day_of_month":1,"months":[11]}',
   'same annual form, same close; the applicability test is re-answered each year'),
  ('Credit at risk of reversal (180 days)',
   '{"type":"cron","day_of_month":15}',
   'a brief, not a findings list - it returns the period''s ITC exposure as figures, and the period moves every month'),
  ('E-invoice reporting window',
   '{"type":"cron","interval_minutes":1440}',
   'the window itself expires: a document is out of scope at day 30 whatever anybody does about it'),
  ('IMS expectations brief',
   '{"type":"cron","day_of_month":12}',
   'an expectation for one return period, replaced by the next period''s'),
  ('Input tax credit about to lapse',
   '{"type":"cron","day_of_month":1,"months":[10]}',
   'the s.16(4) bar closes the question absolutely; after it there is nothing left to acknowledge'),
  ('LUT expiry',
   '{"type":"cron","day_of_month":1,"months":[2,3]}',
   'the card says it has no done-state by design - cover lapses on 1 April and the question restarts'),
  ('No PF or ESI debit visible',
   '{"type":"cron","day_of_month":12}',
   'an absence claim about ONE month, replaced by the next month''s'),
  ('Set aside for advance tax',
   '{"type":"cron","day_of_month":5,"months":[3,6,9,12]}',
   'a cash figure for one instalment date; the next instalment recomputes it'),
  ('Thresholds you are approaching',
   '{"type":"cron","day_of_month":3,"months":[1,4,7,10]}',
   'a position against fixed statutory lines, not a list of things to fix - it moves as turnover moves'),
  ('Your own filing calendar',
   '{"type":"cron","day_of_month":1}',
   'dated obligations for the month ahead; last month''s are gone, not acknowledged'),
  ('Unpaid reimbursements',
   '{"type":"cron","day_of_month":12}',
   'skill_ack_wiring names this one explicitly - ''Money owed to employees, not a decision anybody still has to make'', and it clears when payroll pays it'),
  ('Where the AI spend went',
   '{"type":"cron","day_of_month":1}',
   'a monthly cost attribution; nothing in it is a finding somebody closes'),
  ('Conversations about to require a template',
   '{"type":"cron","interval_minutes":1440}',
   'the service window shuts on its own, which ends the finding whether or not anybody read it'),
  ('Free entry point harvest',
   '{"type":"cron","interval_minutes":1440}',
   'same - a free window opens and closes on the clock'),
  ('What WhatsApp is costing you',
   '{"type":"cron","day_of_month":1}',
   'a monthly cost recut; the rupee figure is an estimate and is replaced, not resolved'),
  ('Professional tax this month',
   '{"type":"cron","day_of_month":12}',
   'one month''s deduction by person and state, replaced by the next month''s'),
  ('Quarterly deductee pack',
   '{"type":"cron","day_of_month":20,"months":[1,4,7,10]}',
   'the quarter''s deductee list for the return utility; once filed the quarter is closed'),
  ('Salary certificate annexure',
   '{"type":"cron","day_of_month":1,"months":[6]}',
   'the year''s Part B working, issued once and superseded by the next year''s'),
  ('Statutory dues brief',
   '{"type":"cron","day_of_month":8}',
   'what ONE approved payroll run owes, replaced when the next run is approved');


CREATE TEMP TABLE _ack (fn text PRIMARY KEY) ON COMMIT PRESERVE ROWS;
INSERT INTO _ack (fn) VALUES
  ('check_194q_approaching'),('check_amendments_before_filing'),
  ('check_approvals_that_sit'),('check_attendance_exceptions'),
  ('check_books_moved_since_due'),('check_broadcast_preflight'),
  ('check_chase_ladder'),('check_consent_ledger'),
  ('check_dead_gst_slabs'),
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


-- GUARD 1 - every name resolves.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(a.name, '; ') INTO missing FROM _arming a
   WHERE NOT EXISTS (SELECT 1 FROM public.hub_skill_templates t WHERE t.name = a.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'No template named: %.', missing;
  END IF;
END $$;


-- GUARD 2 - free, model-free, write-free, and it has a data step.
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
    RAISE EXCEPTION 'Refusing to arm: %.', bad;
  END IF;
END $$;


-- GUARD 3 - DISMISSIBLE, OR A RECORDED REASON WHY IT NEED NOT BE.
--
-- 262 and 263 required every armed skill to be in ACK_WIRING. That rule was
-- right for findings that PERSIST and wrong as a universal: a finding that
-- expires when its period closes has nothing to acknowledge, and demanding a
-- wiring for it would mean building a dismiss button for a row that will not
-- be there next month.
--
-- So the bar moves from "is wired" to "is wired OR says why not", and the
-- reason is stored beside the schedule rather than argued in a comment nobody
-- reads next to the row it applies to. The guard cannot check that a reason is
-- TRUE - no predicate can - but it can refuse an arming that never made one,
-- which is the failure mode worth preventing: arming by momentum.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.name, '; ') INTO bad
    FROM _arming a
    JOIN public.hub_skill_templates t ON t.name = a.name
   WHERE btrim(COALESCE(a.why_no_ack, '')) = ''
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(t.steps) e
       JOIN _ack ON _ack.fn = e->>'skill_function');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to arm: % is neither in ACK_WIRING nor carries a reason it does '
      'not need to be. Wire it, or say in why_no_ack what closes the finding.', bad;
  END IF;
END $$;


-- GUARD 4 - no hour the daily sweep can never reach.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(a.name, '; ') INTO bad FROM _arming a
   WHERE COALESCE((a.cfg->>'hour_utc')::int, 0) > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to arm - unreachable hour_utc: %.', bad;
  END IF;
END $$;


-- -- 1 - Arm them ------------------------------------------------------------

UPDATE public.hub_skill_templates AS t
   SET trigger_config = a.cfg,
       updated_at     = NOW()
  FROM _arming a
 WHERE t.name = a.name;


-- -- 2 - Forty-two armed, none priced ---------------------------------------

DO $$
DECLARE armed int; priced int; grants int;
BEGIN
  SELECT count(*) INTO armed
    FROM public.hub_skill_templates WHERE trigger_config IS NOT NULL;
  IF armed <> 42 THEN
    RAISE EXCEPTION 'Expected 42 scheduled templates (21 + 21), found %.', armed;
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

  RAISE NOTICE 'Armed % templates, covering % active org grants.', armed, grants;
END $$;

DROP TABLE _arming;
DROP TABLE _ack;

COMMIT;
