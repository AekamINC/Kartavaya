-- 166_skill_taxonomy.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_skill_templates   19 rows, all of them, four columns:
--                                   skill_type          19 rewritten
--                                   category            16 rewritten, 3 left
--                                   module               8 NULLs filled
--                                   estimated_credits   13 corrected, 6 unchanged
--                                 + hub_skill_templates_category_check   REPLACED
--                                 + hub_skill_templates_skill_type_check CREATED
--
-- Nothing else. No table is created or dropped, no column is added or removed,
-- no row is inserted or deleted, and NOTHING IS ARMED — `trigger_config` is not
-- named anywhere in this file and stays NULL on all nineteen. Re-running is a
-- no-op: every UPDATE is idempotent and both constraints are dropped IF EXISTS
-- before being added.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Measured live 2026-08-20:
--
--     skill_type   content 19            <- all of them. carries no information.
--     category     general 11 · engagement 4 · launch 2 · branding 1 · festival 1
--     module       NULL 8
--
-- Every category is MARKETING-SHAPED, because the shelf was built when the only
-- skills were content skills. So all eleven operational skills — GSTR-1
-- readiness, payroll variance, the receivables chase — landed in "general",
-- which is why the marketplace reads as a content marketplace with accounting
-- stuck to the side of it. A firm looking for the thing that checks its GST
-- filing has no shelf to look under.
--
-- ── THE COSTING LIE, WHICH MATTERS MORE ──────────────────────────────────────
--
-- 0 of 19 skills are AI-free. Every one carries at least one `agent_type` step.
--
-- Six are priced. The other THIRTEEN display 0 credits on the card and call a
-- model anyway: they were seeded by migration with `estimated_credits = 0`,
-- which bypassed `create_skill_template` — the one code path that computes the
-- estimate from the steps. The run then charges `price_of("skill_step", …)`.
-- The card says free and the provider invoices Aekam.
--
-- Every one of the thirteen carries exactly ONE `email` step, and `email` is
-- 2 credits, so the true price of each is 2. That is not asserted here, it is
-- COMPUTED: section 6 sums `credit_prices` over each template's own agent
-- steps. Probed read-only before writing, the same expression reproduces all
-- six already-correct prices exactly — 24, 19, 14, 10, 7, 6, to the credit —
-- which is why it can be trusted to set the other thirteen. It is a no-op on
-- the six by arithmetic rather than by a WHERE clause that could go stale.
--
-- OWNER'S DECISION, and it is the reason the thirteen are PRICED rather than
-- stripped: the model step is the deliverable. "Receivables chase pack" without
-- its drafted emails is a list of overdue invoices, which Ganit already shows.
-- The standing policy — checks, briefs and packs cost 0 credits permanently,
-- credits are for generated content and images — describes SQL-only skills, and
-- the fourteen arriving in the next migration are the first that are genuinely
-- free. These thirteen get retired as free equivalents replace them; migration
-- 167's `pack_collection_messages` already supersedes the chase pack. Until
-- then the card tells the truth about what a run costs, which is the whole of
-- the defect being fixed here.
--
-- ── THE CONSTRAINT THAT WAS NEVER THERE ──────────────────────────────────────
--
-- 059 declared `skill_type … CHECK (skill_type IN ('content','automation',
-- 'detection','analysis'))` inline on `ADD COLUMN IF NOT EXISTS`. The column
-- already existed, so PostgreSQL skipped the ENTIRE clause — default, CHECK and
-- all — and the constraint has never existed. Verified against pg_constraint on
-- 2026-08-20: the live table carries `category_check`, `module_check` and
-- `setup_fee_non_negative`, and nothing on skill_type.
--
-- So this file EXTENDS one constraint and CREATES the other. Both are added
-- BEFORE the backfills, not after, so that the writes below are validated by
-- the rule rather than merely consistent with it, and so a typo in section 4 or
-- 5 fails this transaction instead of landing.
--
-- Dropping `automation`, `detection` and `analysis` from the vocabulary costs
-- nothing: no row has ever carried one. It does leave one branch of shipped
-- code provably dead — `services/skill_dispatcher.py` looks up feedback
-- corrections `if skill_type in ("detection", "analysis")`, which after this can
-- never be true. It was already dead (all 19 rows were 'content'), and it is
-- left alone here rather than repointed at `check`, because corrections are
-- delivered only to `_run_function_step`, which passes them to a handler that
-- has no parameter to receive them. Repointing it would add a query per run and
-- change no output. That is a real gap and it is a separate piece of work.
--
-- ── WHAT DOES *NOT* CHANGE ───────────────────────────────────────────────────
--
--   · No skill runs differently. `steps` is not touched by any statement here,
--     so every run does exactly what it did yesterday.
--   · The ten templates with live org adoptions keep their adoptions:
--     `hub_org_skills` references `template_id`, and no id changes.
--   · `scope`, `is_active`, `is_system`, `permissions`, `default_schedule`,
--     `setup_fee_paise`, `icon` and `description` are untouched.
--   · Nothing becomes schedulable. The due predicate requires `trigger_config`
--     on the template and all nineteen stay NULL.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Production serves this exact
-- table to its Skills screen, so the changes below are visible in production the
-- moment this commits. The visible effects, stated plainly:
--
--   1. Thirteen cards that read "0 credits" begin reading "2 credits". That is
--      the correction. Nobody is charged anything new — the run has always
--      charged 2 — but a firm that read the card as free will now see a price.
--   2. Skills regroup on the screen. The catalogue UI does not yet section by
--      type, so until that ships the visible change is the category label.
--   3. Eight skills that showed no module now show one.
--
-- LOCKS. Two ALTER TABLE … DROP/ADD CONSTRAINT take ACCESS EXCLUSIVE on
-- hub_skill_templates until COMMIT. Each ADD validates against 19 rows, which is
-- microseconds of work; the risk is not the work, it is ACQUISITION — the lock
-- queues behind any open transaction on the table and blocks every reader that
-- arrives while it waits. `SET LOCAL lock_timeout` turns that into a clean
-- rollback rather than a stalled Skills screen. Blast radius is the Skills
-- catalogue and the skills cron, not the product.
--
-- The four UPDATEs take ROW EXCLUSIVE and touch at most 19 rows.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
-- The constraints reverse exactly:
--
--   ALTER TABLE staging.hub_skill_templates
--     DROP CONSTRAINT hub_skill_templates_skill_type_check,
--     DROP CONSTRAINT hub_skill_templates_category_check;
--   ALTER TABLE staging.hub_skill_templates
--     ADD CONSTRAINT hub_skill_templates_category_check CHECK (category IN (
--       'general','festival','launch','engagement','branding','seasonal','industry'));
--
-- The DATA does not, and this is the one thing to know before running it: the
-- prior `skill_type` was 'content' for every row, so restoring it is a single
-- UPDATE, but the prior `category` and the eight NULL `module` values are only
-- recoverable from this file's own comments. They are recorded in section 3 for
-- exactly that reason.


-- The wrap is not decoration. `SET LOCAL` is scoped to a transaction: run
-- outside one it emits `WARNING: SET LOCAL can only be used in transaction
-- blocks` and does nothing at all, so the timeout promised above would silently
-- not exist. 163 and 164 wrap for the same reason.
BEGIN;

SET LOCAL lock_timeout = '5s';


-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · GUARDS
--
-- This file rewrites every row of a catalogue that production serves. It states
-- what it expects to find and refuses to run against anything else, because the
-- alternative is a partial rewrite of a live shelf discovered later by a reader.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard$
DECLARE
    n_rows    int;
    n_armed   int;
    n_foreign int;
BEGIN
    SELECT count(*) INTO n_rows FROM staging.hub_skill_templates;
    IF n_rows <> 19 THEN
        RAISE EXCEPTION
            'GUARD 1: expected 19 templates, found %. The catalogue has changed '
            'since this migration was written against it; re-read it before '
            'running. Every mapping in sections 4 and 5 is BY NAME, so a new '
            'template would silently keep skill_type=''content''.', n_rows;
    END IF;

    -- Not a safety property of this file — it writes nothing that could arm a
    -- skill — but the standing fact the whole programme rests on, checked here
    -- because this is the last migration before templates start being inserted.
    SELECT count(*) INTO n_armed FROM staging.hub_skill_templates
        WHERE trigger_config IS NOT NULL;
    IF n_armed <> 0 THEN
        RAISE EXCEPTION
            'GUARD 2: % template(s) carry a trigger_config. Nothing should be '
            'armed. Arming a skill is the owner''s decision and this programme '
            'has not made it; find out who did before continuing.', n_armed;
    END IF;

    -- Section 6 computes a price by summing credit_prices over each template's
    -- agent steps. An agent_type with no active price row would contribute 0
    -- and quietly under-price the card — the exact defect being repaired.
    SELECT count(DISTINCT s->>'agent_type') INTO n_foreign
    FROM staging.hub_skill_templates t, jsonb_array_elements(t.steps) s
    WHERE s ? 'agent_type'
      AND NOT EXISTS (SELECT 1 FROM staging.credit_prices p
                      WHERE p.kind = s->>'agent_type' AND p.is_active);
    IF n_foreign <> 0 THEN
        RAISE EXCEPTION
            'GUARD 3: % agent_type(s) in the catalogue have no active row in '
            'credit_prices. Section 6 would price every template using one at '
            'zero, which is the bug this migration exists to fix. Add the price '
            'rows first.', n_foreign;
    END IF;
END
$guard$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · THE SHELF A FIRM LOOKS UNDER
--
-- Five new categories, and the seven old ones KEPT rather than dropped.
--
-- Keeping them is deliberate. Three templates — Monday Morning Brief, My desk
-- today, Weekly project status brief — are core PM, and none of compliance,
-- money, people, stock or growth is true of them. 'general' is true of them, so
-- they stay there and the value stays legal. Dropping 'seasonal' and 'industry',
-- which no row uses, would buy nothing and would make this constraint a second
-- thing to reason about on the day somebody seeds a seasonal pack.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.hub_skill_templates
    DROP CONSTRAINT IF EXISTS hub_skill_templates_category_check;

ALTER TABLE staging.hub_skill_templates
    ADD CONSTRAINT hub_skill_templates_category_check CHECK (category IN (
        -- the shelves this migration introduces
        'compliance',   -- a statutory obligation with a date on it
        'money',        -- what is owed, by whom, in which direction
        'people',       -- the roster, the register, the run
        'stock',        -- what is on the shelf and what cannot be filled
        'growth',       -- outward material, and the pipeline it feeds
        -- retained
        'general',      -- genuinely cross-cutting. Core PM lives here.
        'festival', 'launch', 'engagement', 'branding', 'seasonal', 'industry'
    ));


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · WHAT KIND OF THING A SKILL IS
--
-- The four words, and the distinction is what a reader DOES with the output:
--
--   check    finds a problem in the org's own records. There is a list, and
--            every row on it is something somebody has to go and fix.
--   brief    tells you what is happening. Read it and you know something; there
--            is no defect list attached.
--   pack     assembles a working paper or a document — a set of drafted chases,
--            a payment proposal. The output is a thing you send or file.
--   content  outward material. Marketing copy, posts, articles, images.
--
-- Only `content` costs credits, and that is not a rule this constraint can
-- express — see section 6 and the policy note in the header.
--
-- CREATED, not replaced: 059's inline CHECK never existed. See the header.
-- The DROP IF EXISTS is there so re-running this file works, not because
-- anything is expected to be found.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.hub_skill_templates
    DROP CONSTRAINT IF EXISTS hub_skill_templates_skill_type_check;

ALTER TABLE staging.hub_skill_templates
    ADD CONSTRAINT hub_skill_templates_skill_type_check CHECK (skill_type IN (
        'check', 'brief', 'pack', 'content'
    ));


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · THE PRIOR STATE, RECORDED SO THE REVERSAL IS POSSIBLE
--
-- Read from the live database 2026-08-20, before anything below ran. The
-- reversal in the header restores the constraints; only this comment restores
-- the data.
--
--   name                          skill_type  category    module    credits
--   ────────────────────────────  ──────────  ──────────  ────────  ───────
--   SEO Blog Series               content     branding    NULL           24
--   Campaign Launch               content     launch      NULL           19
--   Product Launch Pack           content     launch      NULL           14
--   Weekly Reel Scripts           content     engagement  NULL           10
--   Festival Calendar             content     festival    NULL            7
--   Weekly Social Media Pack      content     engagement  NULL            6
--   New lead triage               content     engagement  graha           0
--   Overdue follow-up chase       content     engagement  graha           0
--   Account brief                 content     general     NULL            0
--   GSTR-1 filing readiness       content     general     ganit           0
--   GSTR-3B liability brief       content     general     ganit           0
--   Monday Morning Brief          content     general     NULL            0
--   My desk today                 content     general     kartavya        0
--   Payables payment run          content     general     ganit           0
--   Payroll variance review       content     general     vetana          0
--   Pipeline risk review          content     general     graha           0
--   Pre-run payroll readiness     content     general     vetana          0
--   Receivables chase pack        content     general     ganit           0
--   Weekly project status brief   content     general     kartavya        0
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · skill_type — all nineteen
--
-- BY NAME, and `name` has no unique index, so each UPDATE is written to be
-- correct even if a name were duplicated: it sets a value rather than reading
-- one. GUARD 1 has already refused a catalogue that is not the one below.
-- ═══════════════════════════════════════════════════════════════════════════

-- content · the six that generate outward material, and the only six that cost
-- credits. Their prices were already right; section 6 recomputes them to the
-- same numbers.
UPDATE staging.hub_skill_templates SET skill_type = 'content'
 WHERE name IN (
    'SEO Blog Series', 'Campaign Launch', 'Product Launch Pack',
    'Weekly Reel Scripts', 'Festival Calendar', 'Weekly Social Media Pack'
 );

-- check · returns a defect list. Every row is work.
UPDATE staging.hub_skill_templates SET skill_type = 'check'
 WHERE name IN (
    'GSTR-1 filing readiness',      -- what will bounce at the portal
    'Pre-run payroll readiness',    -- what would make this month's run wrong
    'Payroll variance review'       -- movement nobody has explained
 );

-- brief · tells you what is happening. No defect list attached.
UPDATE staging.hub_skill_templates SET skill_type = 'brief'
 WHERE name IN (
    'GSTR-3B liability brief',
    'Account brief',
    'Monday Morning Brief',
    'My desk today',
    'Weekly project status brief',
    'Pipeline risk review',
    'New lead triage'
 );

-- pack · assembles something you send or file.
UPDATE staging.hub_skill_templates SET skill_type = 'pack'
 WHERE name IN (
    'Receivables chase pack',       -- drafted collection emails
    'Overdue follow-up chase',      -- drafted catch-up messages
    'Payables payment run'          -- a payment PROPOSAL, not a payment
 );


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · category and module
--
-- `module` is a single column with a CHECK allowing thirteen codes and NOT
-- allowing 'sahayak'. Skills that straddle — Account brief reaches graha, ganit
-- and vikray; Monday Morning Brief reaches nearly everything — name the module
-- a person would look under, not every module the handler reads. The authority
-- on what a skill may READ is `services/skills/modules.py`, which holds a SET
-- per handler precisely because one column cannot say it. This column is a
-- label on a shelf; it is not, and must never become, an access decision.
-- ═══════════════════════════════════════════════════════════════════════════

-- compliance · a statutory obligation with a date on it.
UPDATE staging.hub_skill_templates SET category = 'compliance'
 WHERE name IN ('GSTR-1 filing readiness', 'GSTR-3B liability brief');

-- money · what is owed, and in which direction.
UPDATE staging.hub_skill_templates SET category = 'money'
 WHERE name IN ('Receivables chase pack', 'Payables payment run');

-- people · the roster, the register, the run.
UPDATE staging.hub_skill_templates SET category = 'people'
 WHERE name IN ('Pre-run payroll readiness', 'Payroll variance review');

-- growth · outward material, and the pipeline it feeds. The six content packs
-- plus the three CRM skills, which are the same shelf from a firm's point of
-- view: all nine are about winning and keeping work.
UPDATE staging.hub_skill_templates SET category = 'growth'
 WHERE name IN (
    'SEO Blog Series', 'Campaign Launch', 'Product Launch Pack',
    'Weekly Reel Scripts', 'Festival Calendar', 'Weekly Social Media Pack',
    'New lead triage', 'Overdue follow-up chase', 'Pipeline risk review',
    'Account brief'
 );

-- 'general' is left in place, and is TRUE, for the three core-PM skills:
-- Monday Morning Brief, My desk today, Weekly project status brief. No
-- statement touches them here. Owner's decision 2026-08-20: a sixth category
-- for core PM was offered and declined — these three are genuinely
-- cross-cutting and 'general' says so.

-- module · the eight NULLs. `srijan` is the content module and owns all six
-- generated-content packs; `graha` for the client brief, whose subject is a
-- client; `kartavya` for the cross-module morning brief, which is core PM.
UPDATE staging.hub_skill_templates SET module = 'srijan'
 WHERE module IS NULL AND name IN (
    'SEO Blog Series', 'Campaign Launch', 'Product Launch Pack',
    'Weekly Reel Scripts', 'Festival Calendar', 'Weekly Social Media Pack'
 );

UPDATE staging.hub_skill_templates SET module = 'graha'
 WHERE module IS NULL AND name = 'Account brief';

UPDATE staging.hub_skill_templates SET module = 'kartavya'
 WHERE module IS NULL AND name = 'Monday Morning Brief';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · THE PRICE ON THE CARD
--
-- COMPUTED from each template's own steps against the live price list — the
-- same thing `create_skill_template` does, which is the code path the thirteen
-- bypassed by being seeded directly.
--
-- Not a list of thirteen names, on purpose. A hardcoded 2 would be right today
-- and silently wrong the day `email` reprices or a step is added; this
-- expression is right by construction and will stay right. It also proves
-- itself: run against the six templates whose prices were already correct it
-- returns 24, 19, 14, 10, 7 and 6 unchanged, verified read-only before writing.
--
-- LEFT JOIN, not JOIN: a template of only skill_function steps has no agent
-- step at all and must come out 0 rather than vanishing from the UPDATE. That
-- is the shape every template inserted by 167 has.
--
-- `is_active` is honoured because credit_prices carries retired rows; summing
-- an inactive price would bill from a list nothing charges against. GUARD 3 has
-- already refused a catalogue containing an agent_type with no active price.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE staging.hub_skill_templates t
   SET estimated_credits = c.total
  FROM (
        SELECT t2.id,
               COALESCE(SUM(p.credits), 0)::int AS total
          FROM staging.hub_skill_templates t2
          LEFT JOIN LATERAL jsonb_array_elements(t2.steps) s
                 ON s ? 'agent_type'
          LEFT JOIN staging.credit_prices p
                 ON p.kind = s->>'agent_type' AND p.is_active
         GROUP BY t2.id
       ) c
 WHERE c.id = t.id
   AND t.estimated_credits IS DISTINCT FROM c.total;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · WHAT THE COLUMNS MEAN, on the columns themselves
-- ═══════════════════════════════════════════════════════════════════════════
COMMENT ON COLUMN staging.hub_skill_templates.skill_type IS
    'What kind of thing this is, by what the reader DOES with the output. '
    'check: a defect list, every row is work. brief: tells you what is '
    'happening. pack: assembles a document you send or file. content: outward '
    'material. Only content costs credits — see estimated_credits.';

COMMENT ON COLUMN staging.hub_skill_templates.category IS
    'The shelf a firm looks under: compliance, money, people, stock, growth. '
    '''general'' is retained and is correct for genuinely cross-cutting core-PM '
    'skills; the four marketing values (festival, launch, engagement, branding) '
    'and the two unused ones (seasonal, industry) are retained for '
    'compatibility. Prefer the five.';

COMMENT ON COLUMN staging.hub_skill_templates.module IS
    'The module a person would look under — a LABEL, one value, chosen for the '
    'shelf. It is NOT an access decision and must never become one: what a '
    'skill may read is a SET per handler in services/skills/modules.py, because '
    'handlers straddle and one column cannot say so.';

COMMENT ON COLUMN staging.hub_skill_templates.estimated_credits IS
    'What a run costs, computed from the steps against credit_prices — never '
    'typed. A skill_function step is a scoped SQL read with no provider invoice '
    'behind it and contributes 0; only agent_type steps and images cost. Seed a '
    'template through create_skill_template, or recompute as migration 166 '
    'section 6 does; a hand-set value is how thirteen cards came to read 0 '
    'while every run charged 2.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · PROVE IT, IN THE SAME TRANSACTION
--
-- If any of this is wrong the transaction rolls back rather than leaving a
-- half-classified shelf in production.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_content_type int;
    n_general      int;
    n_null_module  int;
    n_mispriced    int;
    r              record;
BEGIN
    SELECT count(*) INTO n_content_type FROM staging.hub_skill_templates
        WHERE skill_type = 'content';
    IF n_content_type <> 6 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 6 content skills, found %.', n_content_type;
    END IF;

    SELECT count(*) INTO n_general FROM staging.hub_skill_templates
        WHERE category = 'general';
    IF n_general <> 3 THEN
        RAISE EXCEPTION
            'VERIFY 2: expected exactly 3 skills left in ''general'' (the core-PM '
            'three), found %.', n_general;
    END IF;

    SELECT count(*) INTO n_null_module FROM staging.hub_skill_templates
        WHERE module IS NULL;
    IF n_null_module <> 0 THEN
        RAISE EXCEPTION 'VERIFY 3: % template(s) still have a NULL module.', n_null_module;
    END IF;

    -- The headline. Not one card may claim a price the run will not charge.
    SELECT count(*) INTO n_mispriced
      FROM staging.hub_skill_templates t
      JOIN LATERAL (
            SELECT COALESCE(SUM(p.credits), 0)::int AS total
              FROM jsonb_array_elements(t.steps) s
              LEFT JOIN staging.credit_prices p
                     ON p.kind = s->>'agent_type' AND p.is_active
             WHERE s ? 'agent_type'
           ) c ON TRUE
     WHERE t.estimated_credits <> c.total;
    IF n_mispriced <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 4: % template(s) still display a price the run will not '
            'charge.', n_mispriced;
    END IF;

    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 5: something armed a skill. This file does not '
                        'write trigger_config; find out what did.';
    END IF;

    RAISE NOTICE '166 · the shelf, after:';
    FOR r IN
        SELECT skill_type, category, count(*) AS n,
               sum(estimated_credits) AS credits
          FROM staging.hub_skill_templates
         GROUP BY skill_type, category ORDER BY skill_type, category
    LOOP
        RAISE NOTICE '    %  ·  %  ·  % skill(s), % credit(s) total',
            rpad(r.skill_type, 7), rpad(r.category, 10), r.n, r.credits;
    END LOOP;
END
$verify$;

COMMIT;
