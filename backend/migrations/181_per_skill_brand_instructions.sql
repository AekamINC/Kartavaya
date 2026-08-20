-- 181 · Per-skill brand instructions
--
-- ── WHAT THIS TOUCHES ───────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   ADD COLUMN brand_instructions text
--
-- One nullable column on a 78-row table. No data is written, no row is
-- rewritten, no constraint is added, no index is built, nothing is dropped.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- The owner's words: "skills form instruction is half baked — each skill will
-- have its own set of brand instructions, potentially especially where content
-- is getting created of any type."
--
-- He is right, and the live numbers say how right. `_build_system_prompt`
-- (routers/hub.py:304) composes ONE prompt from `hub_brand_profiles`, and that
-- table holds 5 rows: 4 client-scoped and exactly 1 org-scoped. So of three
-- organisations, TWO send a completely empty system prompt to the model —
--
--     system_prompt = _build_system_prompt(dict(brand)) if brand else ""
--
-- — and every content skill they run is written by a model told nothing at all
-- about the firm it is writing for.
--
-- Worse, the profile is per-ORG and the instruction that matters is often
-- per-SKILL. "Weekly Social Media Pack" and "Engagement Letter Inputs" want
-- opposite voices from the same firm: one is marketing, the other is a
-- document that becomes a signed contract. One brand voice cannot serve both,
-- and today there is nowhere to say so.
--
-- ── THE THREE LAYERS, AND WHY THE COLUMN GOES HERE ──────────────────────────
--
--   1. ORG brand profile      `hub_brand_profiles`   — who the firm is
--   2. SKILL instructions     THIS COLUMN            — what this skill's
--                                                      output must be like
--   3. ORG-per-skill override `hub_org_skills.custom_config`
--                                                    — this firm's variation
--
-- Layer 3 already exists: `custom_config` is a jsonb column on the grant, and
-- it is non-empty on **0 of 11 grants** — a per-org override slot that has
-- never been used. Nothing needs adding for it.
--
-- Layer 2 has nowhere to live. It belongs on the TEMPLATE and not on the grant
-- because it is a property of the skill, authored once by Aekam, and inherited
-- by every org that is granted it. Putting it on the grant would mean writing
-- the same paragraph into every future assignment and having 61 copies drift.
--
-- ── WHAT HAPPENS ON THE DAY ─────────────────────────────────────────────────
--
-- Nothing visible. The column is NULL on all 78 rows and the prompt builder
-- treats NULL exactly as it treats today's absence. The behaviour changes only
-- when somebody writes an instruction into a row, one skill at a time.
--
-- This is deliberate. Authoring 61 sets of brand instructions is editorial
-- work, not a migration, and a migration that invented them would put words
-- Aekam never wrote into a model's mouth on a customer's letterhead.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- `ADD COLUMN ... text` with no DEFAULT and no NOT NULL is a catalogue-only
-- change in PostgreSQL 11+ (this is 17.6): no table rewrite, no row touched.
-- It takes ACCESS EXCLUSIVE on `hub_skill_templates` for the duration, which
-- on a 78-row catalogue change is sub-millisecond. `lock_timeout` is set so a
-- long-running reader makes this FAIL rather than queue behind it and block
-- every skill list in the product.
--
-- ── SHARED DATABASE ─────────────────────────────────────────────────────────
--
-- Staging and production share one Supabase database and one `staging` schema.
-- This commits into the schema production's data lives in. It is additive and
-- nullable, so no existing query's result changes: `SELECT os.*, t.name, ...`
-- names its columns and `SELECT *` callers gain one NULL field.
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.hub_skill_templates DROP COLUMN brand_instructions;
--
-- Lossless while the column is NULL everywhere, which is its state on the day
-- this runs. Once instructions are authored, dropping it discards them — so
-- reverse this on the day it lands or not at all.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- GUARD: the table must exist and must be the one we think it is.
DO $$
BEGIN
    IF to_regclass('staging.hub_skill_templates') IS NULL THEN
        RAISE EXCEPTION 'GUARD: staging.hub_skill_templates does not exist.';
    END IF;
END $$;

ALTER TABLE staging.hub_skill_templates
    ADD COLUMN IF NOT EXISTS brand_instructions text;

COMMENT ON COLUMN staging.hub_skill_templates.brand_instructions IS
    'Aekam-authored guidance for THIS skill''s output — voice, format, what to '
    'never say. Composed UNDER the org''s brand profile and OVER the org''s '
    'per-grant override in hub_org_skills.custom_config. NULL means the skill '
    'adds nothing of its own, which is the state every row starts in: writing '
    '61 sets of instructions is editorial work, not a migration.';

-- VERIFY, in the same transaction, so a partial apply cannot commit.
DO $$
DECLARE
    n_col  int;
    n_rows int;
    n_set  int;
BEGIN
    SELECT count(*) INTO n_col
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name   = 'hub_skill_templates'
       AND column_name  = 'brand_instructions';
    IF n_col <> 1 THEN
        RAISE EXCEPTION 'VERIFY 1: brand_instructions did not land (found %).', n_col;
    END IF;

    -- The column must be NULLABLE. A NOT NULL here would refuse every existing
    -- row and take the catalogue offline.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='staging' AND table_name='hub_skill_templates'
           AND column_name='brand_instructions' AND is_nullable='NO'
    ) THEN
        RAISE EXCEPTION 'VERIFY 2: brand_instructions must be nullable.';
    END IF;

    SELECT count(*) INTO n_rows FROM staging.hub_skill_templates;
    SELECT count(*) INTO n_set  FROM staging.hub_skill_templates
     WHERE brand_instructions IS NOT NULL;

    -- Nothing was written. Stated as an assertion rather than as a promise in
    -- a comment: this migration must not put words into a model's mouth.
    IF n_set <> 0 THEN
        RAISE EXCEPTION 'VERIFY 3: % of % rows carry instructions; this '
                        'migration writes none.', n_set, n_rows;
    END IF;

    RAISE NOTICE '181 OK — brand_instructions added, % templates, 0 authored.', n_rows;
END $$;

COMMIT;
