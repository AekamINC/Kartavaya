-- 176_catalogue_next_and_later.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +20 rows. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166 (vocabulary),
-- 170/172 (statutory facts) and 175 (the Later-tier columns).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Twenty catalogue entries, built by five engineers working in parallel against
-- one written contract, each owning a single module and none touching
-- `skill_dispatcher.py` or `modules.py` — which is what makes a fan-out this
-- size conflict-free. Wiring is the lead's, and so is every migration.
--
--   #17 #29 #30 #32 #33 #34+#40 #35 #37 #38 #39 #42 #43 #44
--   #48 #49 #50 #51 #52 #54 #55
--
-- Every one is skill_function-only, so `estimated_credits = 0` is TRUE.
--
-- ── ALL TWENTY RUN THROUGH THE REAL DISPATCHER ───────────────────────────────
--
-- Not called directly — passed through `_run_function_step`, the leg a Run
-- button actually takes, with registry defaults, signature matching, the
-- org_id tenant boundary and the write gate. Against all three live orgs,
-- read-only, 2026-08-20: 20 ok, 0 failed, every output JSON-serialisable and
-- every one carrying a non-empty `limitations`.
--
-- Live signal on the seeded org: 250 inbound messages triaged, 289 invoices
-- with a live payment link, 692 documents tested for the e-invoice window, 259
-- bank lines, 200 time entries in WIP scope, 84 campaigns pre-flighted, 63
-- vendors against the MSME clock, 9 approvals sitting.
--
-- ── SEVERAL OF THESE ARE HONEST NEGATIVES, AND THAT IS THE POINT ─────────────
--
-- `check_quotation_expiry` returns 0 for every org because nothing in this
-- product creates a quotation. `check_payment_proof_claims` reports zero
-- WhatsApp business accounts. `brief_learned_categorisation` reports that no
-- human has categorised a bank line because migration 175 added the column and
-- no screen writes it yet.
--
-- Those are not failures. Each SAYS why it is empty and names the thing that
-- would fill it. The failure mode being avoided is the opposite: a card
-- returning "0 problems" because a column is empty, which on a statutory
-- matter is a false all-clear. Every description below that has a caveat leads
-- with it, because the card is where a firm decides whether to trust the skill.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Twenty new cards in production,
-- immediately. Inert until assigned; nothing armed — `trigger_config` is not
-- named in this file, and VERIFY 4 refuses the transaction if any row anywhere
-- has acquired one.
--
-- LOCKS: one INSERT of twenty rows. ROW EXCLUSIVE, no ALTER, nothing scanned.

BEGIN;

DO $guard$
DECLARE def_type text; n_cols int;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';
    IF def_type IS NULL OR def_type NOT LIKE '%''pack''%' THEN
        RAISE EXCEPTION 'GUARD 1: migration 166 has not run.';
    END IF;

    SELECT count(*) INTO n_cols FROM information_schema.columns
     WHERE table_schema='staging'
       AND (   (table_name='ganit_vendors'  AND column_name='enterprise_class')
            OR (table_name='ganit_invoices' AND column_name='irn')
            OR (table_name='ganit_bank_statement_lines' AND column_name='category'));
    IF n_cols <> 3 THEN
        RAISE EXCEPTION
            'GUARD 2: migration 175 has not run — only % of 3 probe columns '
            'exist. #49, #51 and #55 would query columns that are not there.',
            n_cols;
    END IF;
END
$guard$;

INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, v.skill_type, v.category, v.module, v.icon, 'org',
       ('[{"order":1,"label":' || to_jsonb(v.label)::text ||
        ',"skill_function":"' || v.fn || '","generate_image":false}]')::jsonb,
       0, TRUE, FALSE
  FROM (VALUES

  -- ── Varta · consent and cost ────────────────────────────────────────────
  ('Consent ledger and STOP',
   'Who has a recorded opt-in and with what notice text, who has sent a STOP, and which recipients a template send would reach who never opted in. The schema makes a promise it cannot keep: an opt-in flag with no record of WHAT was consented to is not evidence of consent. This reports the state and names the columns and the screen that would have to write it — it changes nothing and blocks nothing.',
   'check', 'growth', 'varta', 'search',
   'Consent, STOP, and who would be reached anyway', 'check_consent_ledger'),

  ('Before you send to a list',
   'Run before any broadcast: recipients with no recorded opt-in, duplicates resolving to one address, contacts with no address at all, and the real deliverable count against the claimed list size. THE BOUNCE CHECK IS NOT MEASURED and says so — nothing in this product ingests delivery events, so an empty bounce list would read as a clean list and that would be a lie.',
   'check', 'growth', 'prachar', 'search',
   'Who on this list should not get it', 'check_broadcast_preflight'),

  ('What WhatsApp is costing you',
   'Template wording that would make Meta reclassify a utility template as marketing, plus a recut of send volume. THE RUPEE FIGURE IS AN ESTIMATE: Meta bills the organisation directly, this product never sees that invoice, and no tax position on it is asserted or implied.',
   'brief', 'money', 'varta', 'calendar',
   'Template wording, volume, and an estimated cost', 'brief_whatsapp_cost'),

  -- ── the firm''s own week ─────────────────────────────────────────────────
  ('Your own filing calendar',
   'The firm''s own statutory obligations as dated items, shifted off weekends and public holidays, with the right form number for the year. ORG GRAIN ONLY — per-client generation is a different product. Every date, form and section is read from the dated statute table as of the period it belongs to, never from memory, so a renumbered form does not silently persist.',
   'brief', 'compliance', 'kartavya', 'calendar',
   'This period''s obligations, dated and shifted', 'brief_firm_filing_calendar'),

  ('Approvals that sit',
   'Approvals waiting on somebody, each placed on a ladder: ping the approver at two days, copy the requester at four, escalate at seven. The rung comes from what was actually delivered, so it never repeats a nudge and never skips one. Where there is nobody to escalate to it says so rather than picking a person.',
   'check', 'general', 'kartavya', 'search',
   'What is waiting on a decision, and for how long', 'check_approvals_that_sit'),

  ('New lead, first touch',
   'A marketplace lead lands — find or create the contact, check consent, and hand the rep a one-tap link with the first message already written. The link needs no WhatsApp API at all, which is why this works today when the rest of the WhatsApp chase does not. It drafts; it sends nothing.',
   'pack', 'growth', 'graha', 'megaphone',
   'Untouched leads, and the first message for each', 'pack_lead_first_touch'),

  -- ── inbound ─────────────────────────────────────────────────────────────
  ('Inbound triage, and what a model would cost',
   'Labels each inbound message by keyword rules — bill query, order, payment claim, complaint, job enquiry, spam — and then reports THE RESIDUAL it could not classify, with a projected monthly model-call volume for this organisation. That residual figure is the deliverable: a model tier on every inbound scales with a volume nobody controls or bills, and it should not be wired until somebody has seen the number.',
   'check', 'growth', 'varta', 'search',
   'Classified inbound, and the residual a model would bill for', 'check_inbound_triage'),

  ('Reply grounding',
   'Everything needed to answer one conversation properly: open invoices, last payment, order status, and the language the client wrote in. PULL, NEVER PUSH — a draft a human asks for costs once; an auto-drafter on every inbound costs one call per message, and that single choice is the difference between a feature and a leak.',
   'brief', 'growth', 'varta', 'star',
   'One conversation, and the facts to answer it', 'brief_reply_grounding'),

  ('Mismatch schedule for a notice',
   'Given an intimation, the period''s purchase bills as an invoice-level schedule ready to explain. THE PRODUCT SUPPLIES THE SCHEDULE; A HUMAN ASSIGNS THE BUCKET. It deliberately does not guess which bucket each difference falls in — there is no 2B data here to derive one from, so a guess would be a confident invention on a reply to the department.',
   'brief', 'compliance', 'ganit', 'calendar',
   'The period''s bills, invoice by invoice', 'brief_mismatch_schedule'),

  -- ── reconciliation ──────────────────────────────────────────────────────
  ('UPI reference threading',
   'How many of your payment links and QRs carry the invoice number in the reference field, and how many recent bank credits arrived carrying one. A reference that names an invoice IDENTIFIES it; an equal amount is a coincidence that is usually right. Threading the reference removes work a model would otherwise be paid to do — though whether it survives into the bank narration depends on the payer''s app.',
   'check', 'money', 'ganit', 'search',
   'Links, QRs and credits that carry an invoice reference', 'check_upi_reference_threading'),

  ('Payment proof claims',
   'An inbound payment screenshot filed against the client and the likely invoice AS A CLAIM, beside the matching statement line for a human to confirm. NOTHING HERE MARKS AN INVOICE PAID — paid arrives from bank reconciliation and from nothing else, and a screenshot is a claim, not a payment.',
   'check', 'money', 'ganit', 'search',
   'Claimed payments, beside the bank line that would settle them', 'check_payment_proof_claims'),

  ('Bank narration rule candidates',
   'String rules derived from narrations a human has already categorised the same way three or more times. IT REPORTS ZERO UNTIL SOMEBODY CATEGORISES: the column exists and no screen writes it yet, and the skill names that screen rather than presenting an empty column as a clean result. No model is called, ever — without the write path that degrades into a model reading your bank statement every month.',
   'check', 'money', 'ganit', 'search',
   'What could be learned from what a human already decided', 'check_narration_rule_candidates'),

  ('Working paper figures',
   'When a deterministic guard finds a difference, the table of figures a covering note would be written around. The figures are the product; any prose written from them must carry NO statutory citation and NO authority reference, and that constraint is on the output so it cannot be quietly relaxed later.',
   'brief', 'compliance', 'ganit', 'calendar',
   'The differences a guard found, as figures', 'brief_working_paper_figures'),

  -- ── vendor-side statute ─────────────────────────────────────────────────
  ('MSME 45-day clock',
   'Unpaid bills from Udyam-registered MICRO AND SMALL vendors against the 15/45-day clock, and the amount that would be added back to taxable income. The section does NOT apply to traders and does NOT cover medium enterprises, so it tests the class and the kind rather than a single flag; the clock runs from acceptance where recorded, not from the bill date. The section number is read as of the date — it was renumbered on 1 April 2026. It reports how many vendors have no MSME status recorded at all, because a nil result on an empty column is a false all-clear.',
   'check', 'compliance', 'ganit', 'search',
   'Micro and small vendors against the statutory clock', 'check_msme_payment_clock'),

  ('TDS threshold tripwire',
   'Year-to-date paid per vendor against the section thresholds, naming who has crossed and who is within reach before the next run. WHICH section a payment trips depends on a nature-of-payment that is not recorded on most vendors, so it attributes a section only where one exists and reports the unattributed count loudly rather than guessing.',
   'check', 'compliance', 'ganit', 'search',
   'Vendors approaching or past a deduction threshold', 'check_tds_thresholds'),

  ('E-invoice reporting window',
   'Every B2B document with no IRN past day 23, and the day the portal refuses it permanently. THE WINDOW IS 30 DAYS FROM THE INVOICE DATE, so the two beats are day 23 and day 30. It tests applicability first — a missing IRN is only a finding for a taxpayer actually inside the threshold, and the turnover this product can see is a floor, never the PAN-level aggregate the rule is written against.',
   'check', 'compliance', 'ganit', 'search',
   'B2B documents with no IRN, against the 30-day window', 'check_einvoice_window'),

  -- ── WIP, quotes, entry points ───────────────────────────────────────────
  ('WIP ageing',
   'Unbilled BILLABLE time aged by client and engagement, escalating past 90 days. Billable is not billed: billable is whether the client can be charged, billed is whether an invoice went out — unbilled billable time is WIP, unbilled unbillable time is write-off. Where nobody has marked an entry either way it COUNTS THE UNKNOWNS rather than assuming, because assuming billable inflates WIP and assuming not-billable hides it. Where no rate is recorded it says the rupee column is unavailable instead of printing zero.',
   'check', 'money', 'kartavya', 'search',
   'Unbilled billable time, aged', 'check_wip_ageing'),

  ('Quotation expiry chase',
   'Open quotations approaching their validity date get a three-beat chase, exiting on conversion or cancellation. IT IS EMPTY TODAY AND SAYS SO: nothing in this product currently creates a quotation, so the skill reports zero and names the missing path rather than looking like a clean result. It reads the validity date, never the payment term — chasing on the latter would chase on the wrong day.',
   'check', 'growth', 'graha', 'search',
   'Quotations about to lapse', 'check_quotation_expiry'),

  ('Free entry point harvest',
   'Inbound messages that arrived through a click-to-message ad, and the free delivery window each one opens. THE WINDOW LENGTH IS POLICY AND IT MOVES — it is a parameter, not a constant, and the output states the date the figure was true and that it must be checked against the current policy before anyone relies on it.',
   'brief', 'growth', 'varta', 'calendar',
   'Referral-led conversations and the window they open', 'brief_free_entry_point_harvest'),

  ('Learned categorisation',
   'Rules derived from how a human has already categorised the same narration repeatedly — the cheapest skill in the catalogue the day the reconciliation screen starts recording that decision. Until it does, this reports that there is nothing to learn from and names the one column that would change that. It also shows the weaker signal available today from already-reconciled lines, labelled as weaker.',
   'brief', 'money', 'ganit', 'calendar',
   'What the ledger could learn from its own history', 'brief_learned_categorisation')

  ) AS v(name, description, skill_type, category, module, icon, label, fn)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; missing text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 66 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 66 templates (46 + 20), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY[
            'check_consent_ledger','check_broadcast_preflight','brief_whatsapp_cost',
            'brief_firm_filing_calendar','check_approvals_that_sit','pack_lead_first_touch',
            'check_inbound_triage','brief_reply_grounding','brief_mismatch_schedule',
            'check_upi_reference_threading','check_payment_proof_claims',
            'check_narration_rule_candidates','brief_working_paper_figures',
            'check_msme_payment_clock','check_tds_thresholds','check_einvoice_window',
            'check_wip_ageing','check_quotation_expiry','brief_free_entry_point_harvest',
            'brief_learned_categorisation']) AS fn
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

    -- Every one of the twenty must carry exactly one skill_function step and
    -- must say generate_image false: an image is 79% of AI spend to date and a
    -- decorative cover on a compliance brief buys nothing.
    IF EXISTS (
        SELECT 1 FROM staging.hub_skill_templates t
         WHERE t.estimated_credits = 0
           AND (jsonb_array_length(t.steps) <> 1
                OR NOT (t.steps->0 ? 'skill_function')
                OR COALESCE((t.steps->0->>'generate_image')::bool, TRUE))
    ) THEN
        RAISE EXCEPTION 'VERIFY 5: a free skill is not one image-free skill_function step.';
    END IF;

    RAISE NOTICE '176 · twenty more on the shelf; % templates total.', n_total;
END
$verify$;

COMMIT;
