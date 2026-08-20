-- 178_blocked_and_content_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +3 rows. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #47, #56 and #60 — three entries the folio REJECTED or marked
-- blocked, shipped in the form it prescribed rather than as fake cards or as
-- gaps. A skill that honestly reports it cannot answer is a real deliverable.
-- One that pretends to answer is the thing that destroys a shelf.
--
-- ── WHAT EACH ONE ACTUALLY FOUND ─────────────────────────────────────────────
--
-- #47 "Document Chase, the WhatsApp leg" — blocked three ways. Rather than
--     repeating the folio's claim, the handler VERIFIES each blocker against
--     the live database and returns `blockers_still_true`. Measured after
--     migration 175: still 3 of 3 — no WhatsApp verb or channel in Niyam, no
--     per-client checklist table, and no client-to-task link. It points at
--     #28, the email ladder, which is the version that works today.
--
-- #56 "WhatsApp Window Closing" — rejected as specified, because from
--     1 October 2026 Meta bills every in-window free-form reply, so alerting
--     that a FREE window is closing would alert about something that no longer
--     exists. But the folio recorded a dissent worth acting on: "what the
--     window controls is the ability to answer without a pre-approved
--     template, and that does not stop existing. The honest move may be a
--     downgrade... rather than a kill." THIS IS THE DOWNGRADE. It is framed as
--     "after this you will need an approved template" and never as "free
--     messaging is ending". 38 live conversations examined on the seeded org.
--
-- #60 "Ticket SLA Watch" — the folio: "Missing is not a column but the entire
--     feature. This is a product decision to reverse, and ranking it as a
--     skill card hides the actual question." The handler answers whether an
--     SLA watch is POSSIBLE rather than faking one — AND FOUND THE FOLIO
--     PARTLY STALE: `staging.graha_tickets` DOES exist (empty), so
--     `ticket_tables_present = 1` rather than the assumed zero. That is the
--     kind of thing that only turns up by checking rather than quoting.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Three new cards in production.
-- Inert until assigned; nothing armed.
--
-- LOCKS: one INSERT of three rows. ROW EXCLUSIVE, no ALTER.

BEGIN;

DO $guard$
DECLARE def_type text;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO def_type
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_skill_templates'
       AND con.conname='hub_skill_templates_skill_type_check';
    IF def_type IS NULL OR def_type NOT LIKE '%''brief''%' THEN
        RAISE EXCEPTION 'GUARD 1: migration 166 has not run.';
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

  ('Document chase — can the WhatsApp leg run?',
   'THIS ONE REPORTS THAT IT CANNOT RUN, AND WHY. A per-client WhatsApp chase needs three things this product does not have: a WhatsApp channel in the automation engine, a per-client period checklist, and a link from a client to the work outstanding for them. It checks all three against your live data on every run and names which are still missing, so the day one is closed you find out from the skill rather than by guessing. Until then, use "What we are waiting on" — the email ladder — which does the same job on the channels that work.',
   'check', 'general', 'varta', 'search',
   'The three blockers, checked against live data', 'check_whatsapp_chase_leg'),

  ('Conversations about to require a template',
   'Conversations whose service window is closing, framed as what actually changes: after it shuts you can still reply, but only with a pre-approved template. IT IS NOT AN ALERT THAT FREE MESSAGING IS ENDING — that framing was rejected, because the billing changed and the window is no longer what makes a reply free. The window length is a parameter and not a constant: it is policy, it moves, and the output states the date the figure was true.',
   'check', 'growth', 'varta', 'calendar',
   'Windows closing, and what that will require', 'check_template_required_soon'),

  ('Can we watch ticket SLAs at all?',
   'Answers whether an SLA watch is POSSIBLE here before anyone builds one — what a ticket surface would have to record, and what this product actually has. What is missing is not a column but a feature, so this is a product decision rather than a skill gap, and a card that pretended to watch SLAs would hide that question instead of asking it.',
   'brief', 'general', 'graha', 'star',
   'What an SLA watch would need, and what exists', 'brief_ticket_sla_feasibility')

  ) AS v(name, description, skill_type, category, module, icon, label, fn)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; missing text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 72 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 72 templates (69 + 3), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['check_whatsapp_chase_leg','check_template_required_soon',
               'brief_ticket_sla_feasibility']) AS fn
        EXCEPT
        SELECT s->>'skill_function'
          FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
         WHERE s ? 'skill_function'
    ) q;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: no template names: %', missing;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 3: something is armed. This file writes no trigger.';
    END IF;

    RAISE NOTICE '178 · the blocked three are on the shelf, honestly; % templates.', n_total;
END
$verify$;

COMMIT;
