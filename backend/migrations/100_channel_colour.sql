-- 100_channel_colour.sql
--
-- ONE STORED COLOUR PER CHANNEL, SO THE RAIL CAN BE NAVIGATED BY COLOUR
-- INSTEAD OF BY READING IT.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Read that sentence twice, as 093, 094, 095,
-- 096, 097 and 098 also ask you to. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/100_channel_colour.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- REQUIRES only `staging.samvada_channels`, which migration 058 created. GUARD 0
-- names it anyway, because a missing-relation error sends people looking for a
-- typo in a table name that is spelled correctly — and this table's name is one
-- people DO get wrong. See the spelling section below.
--
-- Additive only: ONE new nullable column, a backfill of rows that have no value
-- yet, ONE named CHECK, one comment. No DROP, no rewrite, no data destroyed, no
-- existing column touched. Every statement is guarded, so the file is
-- REPLAYABLE: run it twice and the second run does nothing.
--
-- ── THE TWO SPELLING TRAPS, BOTH LIVE IN THIS ONE FILE ───────────────────────
--
-- 1. THE TABLE IS `samvada_*`, THE MODULE IS `sanvaad`. Migration 058 created
--    `staging.samvada_channels`; `routers/messaging.py:142-148` records what the
--    mismatch already cost — `require_module("samvada")` matched no subscription
--    row and answered "Module 'samvada' is not active" to everyone, org_owner
--    included. Table names are `samvada`. The module code is `sanvaad`. This
--    file only ever names tables, so it is `samvada` throughout.
--
-- 2. THE COLUMN IS `color`, THE FILE IS `…_colour.sql`, AND THAT IS DELIBERATE.
--    Prose in this repository is British; identifiers in this database are not.
--    Every colour column that already exists here is American — `color`
--    (019_crm_enhancements), `color_primary` / `color_secondary` /
--    `color_accent` (011_hub_foundation), `color` (027). The approved design,
--    `docs/proposals/09-sanvaad-design-system.html`, also says in as many words:
--    "A `color` column on `samvada_channels`". That document is the ONE spec the
--    frontend and the backend both read, so agreeing with it is what stops the
--    two halves of this feature being built against different column names.
--    `services/`, `routers/` and the tests spell the CONCEPT "colour" in prose
--    and the COLUMN `color` in every string that reaches the database.
--
-- ── WHY A TONE KEY AND NOT A HEX ────────────────────────────────────────────
--
-- The column stores `'graha'`, `'ganit'`, `'manav'` … — the id of a MODULE TONE,
-- not `#2F6690`.
--
-- THIS PRODUCT HAS TWO THEMES AND A STORED HEX CAN ONLY EVER BE RIGHT IN ONE OF
-- THEM. `frontend/src/styles/module.css` declares every module tone twice, and
-- the two ramps are opposite temperatures rather than one being a tint of the
-- other — the file says so at its head: "a light-theme tint cannot be reused in
-- dark — it comes out the wrong hue, not merely the wrong luminance". #2F6690 is
-- the LIGHT graha; the dark one is #8FB8DC. A row holding #2F6690 renders a
-- near-black chip on a #0B0E16 ground, which is not a dim colour, it is an
-- invisible one. A row holding `'graha'` resolves through `var(--m-graha)` and
-- follows the theme for free, and a later correction to the palette reaches
-- every channel in the product without a data migration.
--
-- THE EIGHT KEYS ARE THE FIRST EIGHT MODULE TONES, IN module.css ORDER, and they
-- are the same eight colours the design approved. Proposal 09 declares its
-- palette as `--sv-ch-1 … 8` with literal hexes; those eight hexes are byte for
-- byte the first eight `--m-*` values:
--
--     sv-ch-1 #2F6690 = --m-graha     sv-ch-5 #6B4FA8 = --m-vetana
--     sv-ch-2 #2E7D52 = --m-ganit     sv-ch-6 #24707F = --m-dristi
--     sv-ch-3 #A65A2E = --m-manav     sv-ch-7 #8A6A18 = --m-prachar
--     sv-ch-4 #A83E63 = --m-vikray    sv-ch-8 #8E4A86 = --m-sanvaad
--
-- So naming them by module id is not a second colour set — it is the SAME set,
-- named by something that already exists in both themes. The key is also the
-- variable: `color` = 'graha' renders as `var(--m-graha)` with no lookup table
-- in between, and a lookup table is the thing that would eventually disagree
-- with this list.
--
-- EIGHT, NOT FIFTEEN, even though module.css declares fifteen tones. Proposal 09
-- states the reason and it is a legibility one, not a schema one: "past eight,
-- adjacent hues stop being distinguishable at 22px and the colour stops being a
-- navigation aid". Widening the set later is one `DROP CONSTRAINT` / `ADD
-- CONSTRAINT … NOT VALID` pair plus one line in `routers/messaging.CHANNEL_TONES`
-- — and `test_channel_colour.py` fails if either moves without the other.
--
-- ── WHY THE COLUMN IS CONSTRAINED RATHER THAN FREE TEXT ─────────────────────
--
-- A bad write here does not raise anything at render time. `var(--m-nonsense)`
-- with no fallback resolves to nothing and the glyph tile draws in whatever the
-- inherited colour happens to be — usually the page ground, i.e. an INVISIBLE
-- channel that still occupies a row. There is no error, no console warning and
-- no way to tell it apart from a channel whose colour was never set. So the
-- vocabulary is checked HERE, at the last place that can still refuse it, and a
-- typo fails loudly at INSERT instead of silently at paint.
--
-- This is the same call `outbound_log_channel_ck` makes for `channel` (098) and
-- the opposite of the one it makes for `purpose` — the distinction being that an
-- open set that grows whenever somebody adds a feature must not need a
-- migration, and this set does not grow: it is fixed at eight by how many hues a
-- human can tell apart in a 22px tile.
--
-- ── WHY NULLABLE, AND WHY NULL IS A REAL ANSWER RATHER THAN A GAP ───────────
--
-- NULL means "this channel has no tone", and TWO different things arrive at it
-- legitimately:
--
--   1. EVERY DM. `find_or_create_dm` inserts `name = ''` and the rail renders a
--      DM as the other person, not as a `#glyph` — there is no tile to colour.
--      Worse, giving DMs tones would spend the rotation on rows nobody can see
--      it on: an org with nine DMs would have every named channel colliding
--      while eight of the eight tones sat invisible in private conversations.
--      So the backfill below skips `type = 'dm'`, the router does not assign one
--      at DM creation, and the rotation does not count them.
--   2. THE WINDOW BETWEEN THIS FILE AND THE NEXT DEPLOY, and any channel created
--      in it. See the next section.
--
-- A `NOT NULL DEFAULT 'graha'` was the obvious alternative and it is wrong twice
-- over: it paints every DM, and it makes "nobody chose a colour for this" and
-- "somebody chose the first colour" the same value, so the backfill could never
-- be re-run safely and neither could this file.
--
-- ── SAFE TO APPLY WHILE THE OLD CODE IS STILL RUNNING, IN EITHER ORDER ──────
--
-- Migrations here are applied BY HAND and the deploy is a separate act, so BOTH
-- orders happen. This file is written so neither one breaks:
--
--   MIGRATION FIRST, OLD CODE STILL SERVING. The old code reads channels with
--   `SELECT c.*` and `RETURNING *`, so it starts returning one extra key that no
--   client reads — additive on the wire. It INSERTs a NAMED column list that does
--   not mention `color`, and a nullable column with no default accepts that
--   silently. Nothing 500s and nothing looks different.
--
--   DEPLOY FIRST, MIGRATION OUTSTANDING. `routers/messaging._colour_ready()`
--   probes `information_schema.columns` for this exact column, caches the answer
--   the same asymmetric way `_parity_ready` caches 093's — TRUE forever, FALSE
--   for sixty seconds — and while the answer is FALSE:
--       · channel creation still works and simply assigns no tone;
--       · every channel read still carries a `color` key, filled in as `null` by
--         `_channel_row`, because a key that is ABSENT renders `undefined` in a
--         client that spreads the row, and `undefined` is not a colour;
--       · a user-initiated colour EDIT answers 503 naming this migration, rather
--         than 500ing on UndefinedColumn or, worse, pretending to save.
--   Applying this file flips that probe inside a minute with no redeploy.
--
-- THE ONE THING TO KNOW AFTERWARDS: channels created during a DEPLOY-FIRST
-- window keep `color = NULL` — the backfill below has already run by then and
-- does not run again. Verification query 4 lists them; re-running this file is
-- the fix and is safe, because the backfill only ever touches `color IS NULL`.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One transaction, so every lock is held until COMMIT.
--
-- SECTION 1 IS THE ONLY STATEMENT THAT BLOCKS READS. `ALTER TABLE … ADD COLUMN`
-- takes an AccessExclusiveLock on `samvada_channels`, which blocks EVERYTHING on
-- that table — including the channel rail, which every Sanvaad page load and
-- every four-second poll reads. Adding a nullable column with NO DEFAULT is
-- metadata-only in PostgreSQL 11+ (no table rewrite), so the lock is held for a
-- catalog update rather than for a scan, and this table holds single-digit rows
-- per org. Milliseconds.
--
-- The danger is not the duration, it is the QUEUE: while this statement waits
-- for a lock it cannot get, every reader arriving behind it waits too, and
-- Sanvaad stops loading for everybody. `SET LOCAL lock_timeout = '5s'` turns
-- that into a clean rollback instead of an outage. Apply it in a quiet minute
-- anyway.
--
-- Section 2 (the backfill) writes at most a handful of rows and holds a RowExclusiveLock.
-- Section 3 validates the CHECK against a table this transaction already holds
-- AccessExclusive on, so it adds no new contention.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
--
-- Either. Prefer THIS FILE FIRST, because then the feature is live the moment
-- the code lands; but the code is built to survive the other order and says so
-- above. What must NOT happen is this file being applied and the deploy never
-- following: the column would sit there correctly backfilled and nothing would
-- ever read it.

BEGIN;

-- Fail fast rather than queue in front of every Sanvaad reader. Five seconds is
-- far longer than any honest transaction on a table this size. SET LOCAL is
-- scoped to this transaction and reverted at COMMIT; it changes nothing for
-- anyone else.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ════════════════════════════════════════════════════════════════════════════
-- GUARD 0 — THE TABLE THIS FILE ALTERS
-- ════════════════════════════════════════════════════════════════════════════
--
-- The transaction rolls back either way and nothing is left half-applied. This
-- guard buys a legible error, not safety — and it catches the likelier mistakes,
-- which are being connected to the wrong database and spelling the table
-- `sanvaad_channels`.
DO $$
BEGIN
    IF to_regclass('staging.samvada_channels') IS NULL THEN
        RAISE EXCEPTION
          'ABORT: staging.samvada_channels does not exist. Note the spelling: '
          'the TABLES are samvada_*, the MODULE CODE is sanvaad. Either you are '
          'connected to the wrong database, or search_path is wrong, or this is '
          'a branch on which migration 058 was never applied.';
    END IF;
END $$;
-- Lock: AccessShareLock on the catalog only. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE COLUMN
-- ════════════════════════════════════════════════════════════════════════════
--
-- TEXT and nullable, holding a tone KEY — see the header for why not a hex and
-- why NULL is a real answer. No DEFAULT, deliberately: a default would paint
-- every DM and would make "unset" indistinguishable from "set to the first
-- tone", which is what makes both this file and its backfill replayable.
--
-- `IF NOT EXISTS` so a second run is a no-op rather than an error. The CHECK is
-- NOT declared inline here — it is section 3 — precisely so that a database
-- which somehow acquired this column without the constraint still gets the
-- constraint on a re-run.
ALTER TABLE staging.samvada_channels
    ADD COLUMN IF NOT EXISTS color TEXT;
-- Lock: AccessExclusiveLock on samvada_channels. Metadata-only in PG11+ —
-- nullable, no default, so no rewrite and no scan. See the header on the queue.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE BACKFILL — A ROTATION OVER CREATION ORDER, NOT ONE COLOUR
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every existing channel must come out of this with a tone, and they must NOT
-- all come out with the same one. A single `SET color = 'graha'` would satisfy
-- "no row is left NULL" and defeat the entire point of the feature — the rail
-- would be one colour, which is what it already is.
--
-- PARTITION BY org_id, so each tenant's rotation starts at the first tone. The
-- colours are a navigation aid WITHIN one org's rail; nobody ever sees two orgs'
-- channels side by side, so continuing one org's rotation into the next would
-- only mean the second tenant's first channel is arbitrarily green.
--
-- ORDER BY created_at, id. `created_at` is the order the user built the rail in,
-- which is the order they will recognise. `id` is the TIEBREAKER and it is not
-- decoration: 058 gives `created_at` a `NOW()` default, and NOW() is TRANSACTION
-- time, so channels seeded in one script share a timestamp to the microsecond.
-- Without the tiebreaker `row_number()` over a tie is not deterministic, and a
-- re-run of this file could hand the same channel a different colour.
--
-- `% 8` wraps, so an org with twelve channels gets each of the first four tones
-- twice rather than four channels with no colour at all. The router's live
-- assignment does better than modulo — it counts what is actually in use and
-- takes the least-used tone — but modulo is the right instrument HERE, because a
-- backfill is a one-shot pass over a fixed set where "stable and explainable"
-- beats "optimally spread".
--
-- `WHERE color IS NULL` in the `ordered` CTE is what makes this replayable AND
-- what makes it safe to run after the feature is live: a channel whose colour
-- somebody has already edited is not renumbered, and the rows that do get a
-- colour are numbered among themselves.
--
-- `type <> 'dm'` — a DM has no tile to colour. See the header.
WITH tones AS (
    -- The one place this file names the vocabulary twice; section 3 names it
    -- again as the CHECK. Both must agree with `routers/messaging.CHANNEL_TONES`
    -- and `test_channel_colour.py` reads all three and fails if they diverge.
    SELECT ARRAY['graha','ganit','manav','vikray',
                 'vetana','dristi','prachar','sanvaad']::text[] AS keys
),
ordered AS (
    SELECT id,
           row_number() OVER (PARTITION BY org_id ORDER BY created_at, id) - 1 AS seat
      FROM staging.samvada_channels
     WHERE type <> 'dm'
       AND color IS NULL
)
UPDATE staging.samvada_channels c
   SET color = t.keys[((o.seat % array_length(t.keys, 1))::int) + 1]
  FROM ordered o, tones t
 WHERE c.id = o.id;
-- Lock: RowExclusiveLock on samvada_channels, which this transaction already
-- holds AccessExclusive on. Writes one row per uncoloured non-DM channel.
--
-- PostgreSQL arrays are 1-INDEXED, hence the `+ 1` on a 0-based seat. The
-- `::int` is not decoration either: `row_number()` returns BIGINT, so the modulo
-- is bigint, and an array subscript must be `integer`. PostgreSQL does apply the
-- assignment cast on its own — but this file cannot be executed anywhere before
-- it is applied to the one database that matters, so the one construct in it
-- that relies on an implicit coercion is written out explicitly instead.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE CHECK — THE LAST PLACE A BAD TONE CAN STILL BE REFUSED
-- ════════════════════════════════════════════════════════════════════════════
--
-- Added AFTER the backfill so it validates rows that already hold legal values,
-- and named so the router can quote it back. `NULL OR IN (…)` because NULL is a
-- real answer here — every DM has one.
--
-- The DO block is what makes this replayable: `ADD CONSTRAINT` has no
-- `IF NOT EXISTS` form, and a bare re-run would abort the whole file on
-- "constraint already exists" — which matters, because re-running this file is
-- the documented fix for channels created during a deploy-first window.
--
-- TO WIDEN THE SET LATER, do not write a plain `ADD CONSTRAINT`: it validates
-- every row under AccessExclusiveLock. Write
--     ALTER TABLE staging.samvada_channels DROP CONSTRAINT samvada_channels_color_ck;
--     ALTER TABLE staging.samvada_channels ADD CONSTRAINT samvada_channels_color_ck
--         CHECK (color IS NULL OR color IN (…)) NOT VALID;
-- then VALIDATE CONSTRAINT afterwards under ShareUpdateExclusiveLock, which
-- blocks nothing. At this table's size it is moot today; it will not always be.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'staging.samvada_channels'::regclass
           AND conname  = 'samvada_channels_color_ck'
    ) THEN
        ALTER TABLE staging.samvada_channels
            ADD CONSTRAINT samvada_channels_color_ck
            CHECK (color IS NULL OR color IN ('graha','ganit','manav','vikray',
                                              'vetana','dristi','prachar','sanvaad'));
    END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE RULE, ON THE SCHEMA ITSELF
-- ════════════════════════════════════════════════════════════════════════════
--
-- `\d+ staging.samvada_channels` shows this. Somebody will meet this column
-- through the schema and not through this file, and the one thing they must not
-- do — write a hex into it — belongs where they will read it.
COMMENT ON COLUMN staging.samvada_channels.color IS
  'Channel identity tone as a MODULE TONE KEY (graha, ganit, manav, vikray, '
  'vetana, dristi, prachar, sanvaad) — NEVER a hex. The key resolves through '
  'var(--m-<key>) in frontend/src/styles/module.css, which declares each tone '
  'twice; a stored hex can only be correct in one of the two themes. NULL is a '
  'real answer: every DM has one, because a DM has no glyph tile to colour. '
  'Assigned by rotation at creation and editable afterwards. See migration 100.';

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER COMMIT AND READ IT WITH YOUR EYES. DO NOT AUTOMATE IT.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. The column is there, it is `text`, and it is NULLABLE with NO default. A
--    `column_default` here means somebody added one and every DM is now painted:
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'staging'
   AND table_name   = 'samvada_channels'
   AND column_name  = 'color';

-- 2. The constraint exists and lists all eight keys. The router quotes this name
--    in the error it raises when a write is refused; if it is missing, a typo
--    reaches the database and renders as an invisible channel:
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'staging.samvada_channels'::regclass
   AND conname  = 'samvada_channels_color_ck';

-- 3. THE BACKFILL SPREAD, WHICH IS THE WHOLE POINT. Read this per org. One row
--    per org with `distinct_tones = 1` and `channels > 1` means the rotation did
--    not rotate and the rail is one colour:
SELECT org_id,
       count(*)                                   AS channels,
       count(DISTINCT color)                      AS distinct_tones,
       count(*) FILTER (WHERE color IS NULL)      AS uncoloured,
       array_agg(color ORDER BY created_at, id)   AS in_creation_order
  FROM staging.samvada_channels
 WHERE type <> 'dm'
 GROUP BY org_id
 ORDER BY channels DESC;

-- 4. WHAT IS STILL UNCOLOURED, AND WHETHER THAT IS CORRECT. Every DM belongs in
--    this list. A NON-DM channel in it was created after this file was applied
--    by a process that had already cached "not applied" — re-running the whole
--    file fixes it and is safe, because section 2 only touches `color IS NULL`:
SELECT id, org_id, type, name, created_at
  FROM staging.samvada_channels
 WHERE color IS NULL
   AND type <> 'dm'
 ORDER BY created_at DESC;

-- 5. NO DM SHOULD HAVE A COLOUR. This must return zero rows; a row here means
--    something assigned a tone on the DM path and is spending the rotation on
--    tiles nobody can see:
SELECT id, org_id, created_at
  FROM staging.samvada_channels
 WHERE type = 'dm'
   AND color IS NOT NULL;

-- 6. AFTER THE BACKEND REDEPLOY (or within sixty seconds of applying this file,
--    whichever is later): create a channel in the UI and confirm it comes back
--    with a `color` that is NOT the colour of any channel already on the rail.
--    That is the one behaviour this migration exists to enable, and it is the
--    one thing no query above can prove.
