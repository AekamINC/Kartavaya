-- 177_client_register_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   +3 rows. Nothing else.
--
-- No schema change. Re-running inserts nothing. Requires 166 and 175.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #45, #46 and #53 — the register migration 175 created, and the two
-- skills the folio said it unblocks. #45 is the entry it calls "the migration
-- that matters... table stakes being missed, not a skill gap", and the place
-- QwikCA, Finexo, PracticeStacks and Turia all position.
--
-- ── ALL THREE REPORT ZERO TODAY, ON PURPOSE ──────────────────────────────────
--
-- `staging.client_obligations` is empty: 175 created it and backfilled nothing,
-- and no screen writes it yet. So the register and the calendar both return
-- `obligation_rows_live = 0` on every organisation — verified through the real
-- dispatcher against all three, read-only.
--
-- That is the CORRECT output and it is the whole reason these were written the
-- way they were. An empty register is not a firm with no obligations; it is a
-- firm nobody has recorded obligations for, and the two must never look alike.
-- Each says which is which and names what would fill it.
--
-- `check_regional_send_guard` is the one with real data today — 171 recipients
-- tested on the seeded org — because it reads holidays and recipients rather
-- than the new register.
--
-- ── THE RULE THE SEND GUARD MUST NOT BREAK ───────────────────────────────────
--
-- It may never refuse to send for want of a GSTIN. GSTIN, PAN and TAN are
-- NON-MANDATORY everywhere in this product and block nothing; a recipient whose
-- state cannot be resolved is SENT TO, not suppressed, and is reported as
-- unresolved. The description says so, because the card is where a firm decides
-- whether to trust it.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Three new cards in production.
-- Inert until assigned; nothing armed.
--
-- LOCKS: one INSERT of three rows. ROW EXCLUSIVE, no ALTER.

BEGIN;

DO $guard$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM information_schema.tables
     WHERE table_schema='staging' AND table_name='client_obligations';
    IF n <> 1 THEN
        RAISE EXCEPTION
            'GUARD 1: migration 175 has not run — staging.client_obligations '
            'does not exist and #45/#46 would query a missing table.';
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

  ('Client obligations register',
   'Which of your clients is monthly, which is QRMP, who deducts TDS, who is under audit — and the filing week built from it. IT REPORTS ZERO UNTIL SOMEBODY RECORDS AN OBLIGATION: the register exists and no screen writes it yet, and an empty register is a firm nobody has recorded obligations for, NOT a firm with no obligations. It says which of those it is and names what would fill it.',
   'brief', 'compliance', 'graha', 'star',
   'Every client obligation in force, and the week ahead',
   'brief_client_obligations_register'),

  ('Client filing calendar',
   'Each client''s obligations resolved to real dates from their own registration facts, shifted off weekends and public holidays, with a named owner per filing. Dates and form numbers come from the dated statute table as of the period they belong to, never from memory. Optional holidays are working days and are NOT shifted for. Empty until the register is filled, and it says so rather than looking clean.',
   'pack', 'compliance', 'graha', 'calendar',
   'Per-client obligations, dated and shifted', 'pack_client_filing_calendar'),

  ('Regional send guard',
   'Whether a chase or reminder would land on a recipient''s regional non-working day, before it goes. IT NEVER REFUSES TO SEND FOR WANT OF A GSTIN — a recipient whose state cannot be resolved is sent to and reported as unresolved, because GSTIN blocks nothing in this product and a silent suppression is worse than a message on a holiday. Holidays with no state recorded are treated as applying everywhere.',
   'check', 'compliance', 'manav', 'search',
   'Recipients whose regional day is closed', 'check_regional_send_guard')

  ) AS v(name, description, skill_type, category, module, icon, label, fn)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );

DO $verify$
DECLARE n_total int; missing text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 69 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 69 templates (66 + 3), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['brief_client_obligations_register',
               'pack_client_filing_calendar','check_regional_send_guard']) AS fn
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

    RAISE NOTICE '177 · the client register is on the shelf; % templates total.', n_total;
END
$verify$;

COMMIT;
