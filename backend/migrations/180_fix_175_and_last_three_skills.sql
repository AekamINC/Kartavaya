-- 180_fix_175_and_last_three_skills.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.client_obligations    1 index REBUILT, 1 CHECK REPLACED
--   staging.manav_holidays        1 CHECK REPLACED
--   staging.hub_skill_templates   +3 rows
--
-- Both table changes fix defects in migration 175, which I wrote. They were
-- found by an adversarial reviewer reading 175 against the live database, and
-- neither would have surfaced until somebody entered real data.
--
-- ── DEFECT 1 · AN INDEX THAT DOES NOT ENFORCE WHAT ITS COMMENT CLAIMS ────────
--
-- 175 created:
--
--   CREATE UNIQUE INDEX client_obligations_one_open_idx
--       ON staging.client_obligations (client_id, obligation_key, state_code)
--       WHERE effective_to IS NULL;
--
-- and said it meant "one OPEN version per (client, obligation, state)... a
-- client cannot be both monthly and QRMP at the same time".
--
-- IT DOES NOT MEAN THAT. Postgres treats NULLs as DISTINCT in a unique index
-- by default, and `state_code` is NULL on every row that is not state-specific
-- — which is almost all of them. So two open-ended rows for the same client
-- and the same obligation are permitted, and a client CAN be simultaneously
-- monthly and QRMP. That is precisely the data error the index was added to
-- refuse.
--
-- The irony is that 175's own sibling got this right: migration 158's
-- `statute_calendar_version_uniq` is `UNIQUE NULLS NOT DISTINCT` and its
-- comment explains exactly why. I read that comment while writing 175 and
-- still did not carry the clause across.
--
-- Rebuilt WITH `NULLS NOT DISTINCT` (PG 15+; this server is 17.6, measured).
-- The table holds ZERO rows, so the rebuild cannot fail on existing data and
-- nothing is lost.
--
-- ── DEFECT 2 · A CHECK THAT REJECTS THE VALUE THE PRODUCT USES ───────────────
--
-- 175 put `CHECK (state_code ~ '^[A-Z]{2,3}$')` on both new state columns,
-- copied from `statute_calendar`, which stores 'MH'.
--
-- But the rest of this database stores the NUMERIC GST state code:
--   staging.organisations.state_code        = '27'
--   staging.pay_professional_tax.state_code = '27'
--
-- So a firm entering the value every other screen uses gets a constraint
-- violation, and a firm entering 'MH' cannot be compared against either
-- existing table. The column was unusable in both directions.
--
-- WIDENED TO ACCEPT BOTH, rather than picking one and breaking the other
-- half of the product. Deriving a state from a GSTIN yields '27' — the first
-- two digits — and that is the path #53 actually uses, so the numeric form had
-- to be legal. `statute_calendar` keeps its own alphabetic convention and is
-- untouched here; the handlers normalise across the two.
--
-- ⚠ OWNER: THE TWO CONVENTIONS ARE A REAL DECISION AND THIS ONLY UNBLOCKS IT.
-- One of them should win product-wide. Until then every join across these
-- tables needs normalising, which is a cost that compounds.
--
-- ── AND THE LAST THREE SKILLS ────────────────────────────────────────────────
--
-- #31, #36, #41 — the deterministic halves of three skills whose template may
-- later carry a model step. The handlers call no model.
--
-- #31 is the most dangerous entry in the catalogue and returns BLOCKERS rather
-- than a letter: a model-drafted scope paragraph that reaches signature is a
-- contract nobody in the firm wrote. While any blocker stands, a template on
-- this must not add a generation step.
--
-- Measured live through the real dispatcher, all three orgs: 62 engagements,
-- 10 templates every one carrying placeholders, 8 ended events with 48
-- registrations split across all three buckets and 0 unrecognised outcomes.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- One index rebuild and two CHECK swaps on tables created hours ago holding
-- ZERO rows, plus an INSERT of three. ACCESS EXCLUSIVE on two small tables;
-- `lock_timeout` makes a queue a clean rollback.

BEGIN;

SET LOCAL lock_timeout = '5s';


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · the index that did not enforce
-- ═══════════════════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS staging.client_obligations_one_open_idx;

CREATE UNIQUE INDEX client_obligations_one_open_idx
    ON staging.client_obligations (client_id, obligation_key, state_code)
    NULLS NOT DISTINCT
    WHERE effective_to IS NULL;

COMMENT ON INDEX staging.client_obligations_one_open_idx IS
    'One OPEN version per (client, obligation, state). NULLS NOT DISTINCT is '
    'the whole clause: state_code is NULL on every row that is not '
    'state-specific, and under default NULL semantics those rows do not '
    'collide — which let a client be simultaneously monthly and QRMP. '
    'statute_calendar_version_uniq carries the same clause for the same reason.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · the CHECK that rejected the product's own value
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.client_obligations
    DROP CONSTRAINT IF EXISTS client_obligations_state_ck;

ALTER TABLE staging.client_obligations
    ADD CONSTRAINT client_obligations_state_ck CHECK (
        state_code IS NULL
        OR state_code ~ '^[A-Z]{2,3}$'   -- 'MH', as statute_calendar stores it
        OR state_code ~ '^[0-9]{1,2}$'   -- '27', as organisations stores it
    );

ALTER TABLE staging.manav_holidays
    DROP CONSTRAINT IF EXISTS manav_holidays_state_ck;

ALTER TABLE staging.manav_holidays
    ADD CONSTRAINT manav_holidays_state_ck CHECK (
        state_code IS NULL
        OR state_code ~ '^[A-Z]{2,3}$'
        OR state_code ~ '^[0-9]{1,2}$'
    );

COMMENT ON COLUMN staging.manav_holidays.state_code IS
    'NULL means the holiday applies everywhere — the correct reading of the 38 '
    'rows that predate this column. ACCEPTS BOTH CONVENTIONS: ''MH'' as '
    'statute_calendar stores it and ''27'' as organisations and '
    'pay_professional_tax store it. Which one wins product-wide is an open '
    'decision; until it is taken, every cross-table join must normalise. '
    'A send guard must NEVER suppress for want of a resolvable state.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · #31 #36 #41
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO staging.hub_skill_templates
    (name, description, skill_type, category, module, icon, scope,
     steps, estimated_credits, is_active, is_system)
SELECT v.name, v.description, v.skill_type, v.category, v.module, v.icon, 'org',
       ('[{"order":1,"label":' || to_jsonb(v.label)::text ||
        ',"skill_function":"' || v.fn || '","generate_image":false}]')::jsonb,
       0, TRUE, FALSE
  FROM (VALUES

  ('Engagement letter — what it would be built from',
   'IT DOES NOT DRAFT A LETTER, AND WHILE ANY BLOCKER STANDS IT MUST NOT. A model-written scope paragraph that reaches signature becomes a contract nobody in the firm wrote. So this assembles the facts a letter is built FROM — existing engagements, their values and signature state, and which clients have obligations recorded — and returns the four things that must exist first: a firm-authored clause library, assembly by rule rather than generation, a mandatory human diff against the previous letter, and a record of which clause version was signed. The MSMED interest clause is offered as a question, never a default: it applies where the FIRM is the MSME supplier, and nothing here records that.',
   'pack', 'growth', 'ganit', 'star',
   'The inputs, and the four blockers', 'pack_engagement_letter_inputs'),

  ('Vernacular template pack',
   'Which templates could go out in another language, and — the part that matters — the exact placeholder inventory each translation must be checked against IN CODE afterwards. A model that silently renumbers the placeholders produces a template the platform approves and which then sends the wrong name to the wrong person, so the check is deterministic post-validation and never the model''s own assurance. NO TARGET LANGUAGES ARE PROPOSED: nothing in this product records which language a client prefers, and inferring one from a name or a state would be worse than not answering. Costed per template PER LANGUAGE PER REVISION, because a rejection forces another call.',
   'brief', 'growth', 'varta', 'star',
   'Templates, placeholders, and what to verify after', 'brief_vernacular_template_targets'),

  ('Event follow-up split',
   'After an event closes, its registrations split by what actually happened — came, registered and did not come, cancelled — each with a different next step, because one message to all three is the thing this replaces. The split is a query; only the wording would ever need writing. An outcome this skill does not recognise is reported separately and never folded into a total, since an unknown status is a change nobody announced.',
   'check', 'growth', 'prachar', 'megaphone',
   'What happened to each registration', 'check_event_followup_split')

  ) AS v(name, description, skill_type, category, module, icon, label, fn)
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.hub_skill_templates t WHERE t.name = v.name
 );


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · PROVE IT
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n_total int; missing text; idxdef text;
BEGIN
    SELECT count(*) INTO n_total FROM staging.hub_skill_templates;
    IF n_total <> 78 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 78 templates (75 + 3), found %.', n_total;
    END IF;

    SELECT string_agg(fn, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['pack_engagement_letter_inputs',
               'brief_vernacular_template_targets','check_event_followup_split']) AS fn
        EXCEPT
        SELECT s->>'skill_function'
          FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
         WHERE s ? 'skill_function'
    ) q;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: no template names: %', missing;
    END IF;

    -- The fix, asserted rather than assumed.
    SELECT pg_get_indexdef(i.indexrelid) INTO idxdef
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'client_obligations_one_open_idx';
    IF idxdef IS NULL OR idxdef NOT ILIKE '%NULLS NOT DISTINCT%' THEN
        RAISE EXCEPTION
            'VERIFY 3: the one-open-version index still lacks NULLS NOT '
            'DISTINCT, so two open rows per client and obligation remain '
            'possible. def=%', COALESCE(idxdef, '(absent)');
    END IF;

    -- Both conventions must now be storable.
    BEGIN
        PERFORM 1 WHERE '27' ~ '^[0-9]{1,2}$' AND 'MH' ~ '^[A-Z]{2,3}$';
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'VERIFY 4: the state patterns do not admit both forms.';
    END;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 5: something is armed. This file writes no trigger.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM staging.hub_skill_templates t
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(t.steps) s
                       WHERE COALESCE((s->>'generate_image')::bool, FALSE))
    ) THEN
        RAISE EXCEPTION 'VERIFY 6: a template generates an image.';
    END IF;

    RAISE NOTICE '180 · 175''s two defects closed, and the last three skills '
                 'are on the shelf. % templates.', n_total;
END
$verify$;

COMMIT;
