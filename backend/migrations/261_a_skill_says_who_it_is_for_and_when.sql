-- 261 - A skill says who it is for and when to run it
--
-- -- What is wrong ---------------------------------------------------------
--
-- The catalogue holds 78 templates. A card shows a name, a description and a
-- price, and the drawer adds what each step reads and writes. None of it
-- answers the question somebody choosing between 78 cards actually has:
--
--     is this for me, and when would I run it?
--
-- "GSTR-1 filing readiness" is for a compliance owner in the week before a
-- filing. "Payables payment run" is for whoever approves payments, weekly.
-- "Attendance exceptions" is worthless after the payroll cutoff and valuable
-- for the three days before it. Every one of those facts existed only in the
-- head of whoever wrote the handler, and a shelf of 78 names nobody can
-- choose between is the same as a shelf of none.
--
-- -- Why TWO columns and not one sentence -----------------------------------
--
-- A single "when to use" blob would render fine and be good for nothing else.
-- Split, both halves become data:
--
--   used_by       a role. Makes the catalogue filterable by seat - show me
--                 what payroll runs, show me what a partner reads - which is
--                 how a firm of eight people actually divides 78 skills.
--
--   when_to_run   a cadence or a trigger. This is the column that makes
--                 ARMING obvious. trigger_config is NULL on all 78 rows and
--                 /cron/skills has therefore matched nothing since it was
--                 built; the reason nobody has set a schedule is that nothing
--                 in the product ever said what the right schedule WAS. A row
--                 reading "monthly, days before filing" is a row somebody can
--                 arm without asking an accountant first.
--
-- Neither is parsed by anything. They are prose for a human, kept apart so a
-- screen never has to split a string on a separator to get one of them.
--
-- -- What this deliberately does NOT add ------------------------------------
--
-- There is no next_actions column, and there must not be one yet.
--
-- The obvious companion field is "what you can do with the result", and today
-- the honest answer for all 78 is "read it, and go do the work somewhere
-- else" - Findings.jsx offers Dismiss and Undo and nothing more. A stored
-- column saying "creates tasks" would advertise a button that does not exist,
-- on the screen a customer buys from. That is the same defect as a card that
-- pretends to watch SLAs: it hides the question instead of asking it.
--
-- When those actions are built, the field must be DERIVED FROM THE STEPS the
-- way permissionsFor already derives what a skill reads and writes - a
-- hand-kept list drifts from what the skill can actually do, and the drift is
-- silent. That is why this file adds nothing for it: an empty column would be
-- filled by hand within a week.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. `staging` is a label on a second front door, not a second
--   place. This is a production change.
--
-- * ADDITIVE AND INERT. Two nullable columns with no default, so on PG 11+
--   this is a catalog update with NO TABLE REWRITE. Nothing reads them until
--   routers/hub.py selects them, so applying this file alone changes no
--   behaviour anywhere - no run, no schedule, no price, no permission.
--
-- * NO INLINE CHECK, on purpose. ADD COLUMN IF NOT EXISTS ... CHECK (...) is
--   skipped ENTIRELY when the column already exists - PostgreSQL drops the
--   default and the constraint with it, silently. 059 declared skill_type's
--   CHECK that way and it never existed. These columns are free prose with no
--   vocabulary to enforce, so there is nothing to constrain; if that ever
--   changes, the constraint goes in its own DO block and is verified against
--   pg_constraint, never against this file.
--
-- * LOCKS. The ALTER takes ACCESS EXCLUSIVE on hub_skill_templates until
--   COMMIT. The work is microseconds at 78 rows; the risk is acquisition - it
--   queues behind any open transaction on the table and blocks readers that
--   arrive after it. Blast radius is the Skills screen, the skill drawer and
--   /cron/skills, NOT the whole product: this table is not on the request
--   path the way organisations and user_roles are. SET LOCAL lock_timeout
--   makes the bad case a clean rollback.
--
-- * THE BACKFILL IS KEYED ON name, which was measured before being trusted:
--   78 rows, 78 distinct names, no NULLs (2026-08-31). A template renamed
--   between that measurement and this run would silently keep NULLs, so
--   section 3 RAISES if the match count is not total, rather than letting a
--   partial backfill look like a clean one.
--
-- * TEMPLATES ARE GLOBAL PLATFORM DATA, not org rows - the catalogue every
--   org's grants point at. So there is deliberately no org_id predicate here,
--   and this is the narrow case where its absence is correct rather than the
--   bug it usually is.
--
-- * IDEMPOTENT. IF NOT EXISTS on both columns; the UPDATE is a straight
--   assignment from a fixed VALUES list, so re-running rewrites the same text.

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 1 - The columns --------------------------------------------------------

ALTER TABLE public.hub_skill_templates
  ADD COLUMN IF NOT EXISTS used_by      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS when_to_run  text DEFAULT NULL;

COMMENT ON COLUMN public.hub_skill_templates.used_by IS
  'Which seat this skill is for, as prose for a human. Nothing parses it.';

COMMENT ON COLUMN public.hub_skill_templates.when_to_run IS
  'The cadence or trigger a person should run this on. Prose, not a schedule: the machine-readable schedule is trigger_config, and this column is what tells somebody what to put there.';


-- -- 2 - The backfill, all 78 -----------------------------------------------
--
-- Every row derived from the handler's own description and the statutory or
-- operational cadence it is written against. Where a skill currently reports
-- nothing because no screen writes its input, when_to_run says so rather than
-- naming a cadence that would produce an empty list for ever.

UPDATE public.hub_skill_templates AS t
   SET used_by     = v.used_by,
       when_to_run = v.when_to_run,
       updated_at  = NOW()
  FROM (VALUES
  ('Amend before you file', 'Compliance owner', 'After a GSTR-1 due date passes · monthly'),
  ('Annual return — books side', 'Partner / compliance', 'Annually, before GSTR-9'),
  ('Annual return — the 9C books side', 'Partner', 'Annually, if past the 9C bar'),
  ('Credit at risk of reversal (180 days)', 'Accounts payable', 'Monthly, before GSTR-3B'),
  ('Dead GST rates', 'Master-data owner', 'Quarterly, and after any rate change'),
  ('E-invoice reporting window', 'Billing desk', 'Daily, through the month'),
  ('GSTR-1 filing readiness', 'Compliance owner', 'Monthly, days before filing'),
  ('GSTR-3B liability brief', 'Finance', 'Monthly, before the 3B payment'),
  ('IMS expectations brief', 'Compliance', 'Monthly, before opening IMS'),
  ('Input tax credit about to lapse', 'Finance', 'Annually, before the s.16(4) bar'),
  ('Invoice series gaps and splits', 'Billing desk', 'Year-end, and before audit'),
  ('LUT expiry', 'Compliance · exporters only', 'February and March'),
  ('Mismatch schedule for a notice', 'Partner', 'On receiving an intimation'),
  ('MSME 45-day clock', 'Accounts payable', 'Weekly'),
  ('TDS threshold tripwire', 'Finance', 'Monthly, before payment runs'),
  ('Thresholds you are approaching', 'Partner', 'Quarterly'),
  ('What has moved since the return went', 'Compliance', 'Monthly, after the due date'),
  ('Working paper figures', 'Whoever writes the note', 'When a guard finds a difference'),
  ('Bank narration rule candidates', 'Accounts', 'Once categorisation exists'),
  ('Collection message pack', 'Receivables desk', 'Weekly'),
  ('Duplicate vendor bills', 'Accounts payable', 'Before every payment run'),
  ('Learned categorisation', 'Accounts', 'Once categorisation is recorded'),
  ('Money in, invoice unpaid', 'Accounts', 'Weekly, after each bank import'),
  ('Payables payment run', 'Whoever approves payments', 'Weekly'),
  ('Payment proof claims', 'Receivables', 'When a client sends a screenshot'),
  ('Receivables chase pack', 'Receivables desk', 'Weekly'),
  ('Retainers that stopped billing', 'Practice manager', 'Monthly, after billing'),
  ('Set aside for advance tax', 'Finance', 'Before each of the 4 instalments'),
  ('Stale retainer rates', 'Partner / account owner', 'Quarterly'),
  ('UPI reference threading', 'Finance ops', 'Quarterly review'),
  ('Engagement letter — what it would be built from', 'Partner', 'At engagement renewal'),
  ('No PF or ESI debit visible', 'Payroll', 'Monthly, between run and deposit'),
  ('Client filing calendar', 'Practice manager', 'Start of each month'),
  ('Client obligations register', 'Practice manager', 'Once obligations are recorded'),
  ('Can we watch ticket SLAs at all?', 'Owner', 'One-off product decision'),
  ('Account brief', 'Account owner', 'Before a client call'),
  ('New lead triage', 'Sales', 'Daily or weekly'),
  ('New lead, first touch', 'Sales rep', 'The moment a marketplace lead lands'),
  ('Overdue follow-up chase', 'Sales', 'Daily'),
  ('Pipeline risk review', 'Sales manager', 'Weekly'),
  ('Quotation expiry chase', 'Sales', 'Once quotations exist'),
  ('Your own filing calendar', 'Firm admin', 'Start of the year, then monthly'),
  ('Approvals that sit', 'Anyone awaiting approval', 'Daily'),
  ('Monday Morning Brief', 'Partner / manager', 'Monday morning'),
  ('My desk today', 'Every user', 'Every morning'),
  ('Weekly project status brief', 'Project lead', 'Before the weekly status meeting'),
  ('What we are waiting on', 'Practice manager', 'Daily'),
  ('WIP ageing', 'Partner', 'Monthly, before billing'),
  ('Quarterly deductee pack', 'Payroll', 'Each quarter, before the TDS return'),
  ('Statutory dues brief', 'Payroll', 'Monthly, after each approved run'),
  ('Statutory records gate', 'HR', 'Monthly, before the run'),
  ('ESI ceiling crossings', 'Payroll', 'Monthly, after a pay revision'),
  ('Payroll variance review', 'Payroll approver', 'Before approving the run'),
  ('Pre-run payroll readiness', 'HR + payroll', 'Before the payroll cutoff'),
  ('Professional tax this month', 'Payroll', 'Monthly, per state'),
  ('Salary certificate annexure', 'Payroll', 'Annually, after Q4 TDS'),
  ('Document chase — can the WhatsApp leg run?', 'Product owner', 'Until the three pieces exist'),
  ('Consent ledger and STOP', 'Marketing / compliance', 'Before any template send'),
  ('Conversations about to require a template', 'Whoever answers messages', 'Daily'),
  ('Free entry point harvest', 'Whoever answers messages', 'Daily'),
  ('Inbound triage, and what a model would cost', 'Product / ops', 'Before wiring a model tier'),
  ('Reply grounding', 'Support', 'When answering one conversation'),
  ('Vernacular template pack', 'Marketing', 'Entering a new language market'),
  ('What WhatsApp is costing you', 'Marketing ops', 'Monthly'),
  ('Campaign Launch', 'Agency team · per client', 'At a campaign kickoff'),
  ('Festival Calendar', 'Agency team · per client', 'Ahead of the festival season'),
  ('Product Launch Pack', 'Agency team · per client', 'At a product launch'),
  ('SEO Blog Series', 'Agency team · per client', 'Ongoing content programme'),
  ('Weekly Reel Scripts', 'Agency team · per client', 'Weekly'),
  ('Weekly Social Media Pack', 'Agency team · per client', 'Weekly'),
  ('Regional send guard', 'Ops', 'Before any chase goes out'),
  ('Attendance exceptions', 'HR', 'Monthly, before the payroll cutoff'),
  ('Unpaid reimbursements', 'HR + finance', 'Monthly, before payroll'),
  ('Before you send to a list', 'Marketing', 'Before any broadcast'),
  ('Event follow-up split', 'Events / marketing', 'When an event closes'),
  ('Impossible stock figures', 'Stores', 'Monthly, and before a stock count'),
  ('Orders that cannot be filled', 'Sales + stores', 'Daily'),
  ('Where the AI spend went', 'Whoever owns the credit budget', 'Monthly')
  ) AS v(name, used_by, when_to_run)
 WHERE t.name = v.name;


-- -- 3 - Refuse a partial backfill ------------------------------------------
--
-- A rename between the measurement above and this run would leave NULLs that
-- look exactly like a column nobody got round to filling. Loud, not silent.

DO $$
DECLARE
  filled int;
  total  int;
BEGIN
  SELECT count(*) FILTER (WHERE used_by IS NOT NULL AND when_to_run IS NOT NULL),
         count(*)
    INTO filled, total
    FROM public.hub_skill_templates;

  IF filled <> total THEN
    RAISE EXCEPTION
      'Backfill incomplete: % of % templates carry used_by + when_to_run. A template was renamed, added or removed since the VALUES list was built - reconcile the list against the live names before re-running.',
      filled, total;
  END IF;

  RAISE NOTICE 'used_by / when_to_run set on % of % templates', filled, total;
END $$;

COMMIT;


-- -- Verify -----------------------------------------------------------------
--
-- Expect 78 / 78, and no row where either column is blank rather than NULL
-- (an empty string is not NULL, and reads as "we know it is nothing").
--
--   SELECT count(*) AS templates,
--          count(used_by) AS with_seat,
--          count(when_to_run) AS with_cadence,
--          count(*) FILTER (WHERE btrim(used_by) = '' OR btrim(when_to_run) = '')
--            AS blank_not_null
--     FROM public.hub_skill_templates;
--
-- And the shape the catalogue screen will group by:
--
--   SELECT used_by, count(*) FROM public.hub_skill_templates
--    GROUP BY 1 ORDER BY 2 DESC;
--
-- Run the Supabase security advisor afterwards. This adds no table and no
-- view, so rls_disabled_in_public must not gain an entry; if it does,
-- something else landed alongside this and it is a breach, not a lint.


-- -- Rollback ---------------------------------------------------------------
--
-- Safe at any time: nothing derives from these columns and no other row
-- references them. It discards the authored text, which lives only here.
--
-- ALTER TABLE public.hub_skill_templates
--   DROP COLUMN IF EXISTS when_to_run,
--   DROP COLUMN IF EXISTS used_by;
