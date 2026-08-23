-- 198 · user_column_prefs — the column ORDER, VISIBILITY and WIDTH a person
-- chose for one table, and the org default underneath it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Measured by absence, 2026-08-22: nothing in `frontend/src` persists a column
-- order, a hidden column or a dragged width. One Kanban file remembers its own
-- board columns and that is the whole of it. Every one of the ~100 tables in
-- the product therefore forgets, on refresh, that a firm never looks at the
-- Source column and always wants Amount second — which is the difference
-- between a table a user arranges once and a table they re-read every morning.
--
-- This is proposal 67's tab problem again, one level down. 154 gave a person
-- the ORDER OF THE TABS in a module; this gives them the ORDER OF THE COLUMNS
-- in a table, plus the two facts a tab strip has no equivalent of — a column
-- can be hidden, and a column has a width.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One personal row per person per table, and one org-default row per table
-- underneath it. The reader resolves
--
--     personal (user_id = viewer)  >  org default (user_id IS NULL)
--
-- and the page's declared column list is the floor below both — CODE in the
-- frontend, never a row, for the reason 154 gives about analytics presets: a
-- default that improves must not be frozen at whatever version an org signed
-- up under, and a column shipped next month must be able to appear.
--
-- ── THE PERSONAL KEY IS ORG-LESS, exactly as in 154 ────────────────────────
--
-- (user_id, table_key), with no org in it. An arrangement of columns is a
-- habit of the hands: it follows its owner to any device and into any org they
-- switch to. TWO PARTIAL UNIQUE INDEXES rather than one constraint, because
-- the two row shapes key on different columns and NULL defeats every single
-- spelling — a plain UNIQUE (user_id, org_id, table_key) never collides two
-- org defaults (their NULL user_ids are distinct), and NULLS NOT DISTINCT over
-- the triple would weld a personal row to one org, which is precisely what the
-- personal key must not do. Each index is also its upsert's ON CONFLICT
-- target, predicate and all; routers/column_prefs.py names them verbatim.
--
-- ── `table_key` IS NOT VALIDATED AGAINST A CATALOGUE, AND THAT IS THE POINT ─
--
-- 154's sibling router pins a nine-entry MODULE_TABS allowlist because there
-- are nine tab strips and they are enumerable. There are ~100 tables here and
-- the number moves every week, so an allowlist would be a second inventory to
-- maintain and the first thing to go stale — a table added on Tuesday would
-- 422 on Wednesday when someone tried to arrange it. The API pins the GRAMMAR
-- instead (shape, count, uniqueness, at least one visible column) and never a
-- catalogue. A key nothing renders any more is a row nothing resolves:
-- housekeeping, not integrity. Same reasoning as 154's missing FKs, and
-- neither `user_id` (TEXT, canonical 'user_<12hex>') nor `org_id` carries one
-- here either.
--
-- ── `columns` IS jsonb, NOT THREE PARALLEL ARRAYS ──────────────────────────
--
-- 154 stores `tab_order TEXT[]` because a tab has exactly one fact: where it
-- sits. A column has three — position, visible, width — and three TEXT[]/
-- BOOL[]/INT[] columns that must stay the same length and the same order is a
-- consistency invariant no CHECK can express and every writer can break. One
-- ordered jsonb array of {id, hidden, width} keeps the three facts welded to
-- the column they describe, and the ORDER OF THE ARRAY IS THE ORDER OF THE
-- COLUMNS — there is no position field to disagree with the array index.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Purely additive: ONE new table, two indexes, no ALTER, no DML, no trigger.
-- Nothing existing is read or written by this file.
--
-- SHARED-DATABASE NOTE: staging and production share one Supabase database, so
-- this IS a production schema change. Its safety property is that an empty
-- table is the current behaviour byte for byte — every table renders the
-- columns its page declares, in the order it declares them, exactly as today,
-- until somebody saves a row. Production's code (main, 1aa49855) does not
-- mount routers/column_prefs.py, so production never reads or writes it at
-- all.
--
-- WRITE-PATH SIDE EFFECTS: none from this migration. Once the router ships,
-- the write paths it opens are (a) a personal row per person per table, keyed
-- on the caller's own verified user_id and reachable by nobody else, and (b)
-- an org-default row, gated on admin_org_id. Neither touches any other table.
--
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS staging.user_column_prefs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- NULL = the org-default row every member falls back to; a value =
    -- personal, and org-less on purpose. TEXT with no FK — see the header.
    user_id     text,
    org_id      uuid,

    -- The frontend's name for one table, e.g. 'graha.contacts'. Deliberately
    -- not checked against a catalogue; the grammar lives in the router.
    table_key   text        NOT NULL,

    -- Ordered array of {"id": text, "hidden": bool, "width": int|null}.
    -- ARRAY ORDER IS COLUMN ORDER. The router validates every element before
    -- any of this is written; the CHECK below is the floor under that.
    columns     jsonb       NOT NULL DEFAULT '[]'::jsonb,

    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- A row naming neither a person nor an org is a preference for nobody;
    -- the table refuses it rather than trusting every writer to. (154.)
    CONSTRAINT user_column_prefs_owner_ck
        CHECK (user_id IS NOT NULL OR org_id IS NOT NULL),

    -- An object here, or a bare string, would read as "no columns" in the
    -- resolver and silently return the page's own list — a saved arrangement
    -- that quietly does nothing is worse than one that fails loudly.
    CONSTRAINT user_column_prefs_columns_is_array_ck
        CHECK (jsonb_typeof(columns) = 'array')
);

COMMENT ON TABLE staging.user_column_prefs IS
    'Per-person column order, visibility and width for one table, with an '
    'org-default row underneath. Resolution is personal -> org -> the page''s '
    'declared columns, which are frontend CODE and never a row.';

COMMENT ON COLUMN staging.user_column_prefs.columns IS
    'Ordered [{id, hidden, width}]. The ARRAY ORDER is the column order — '
    'there is no position field that could disagree with the index.';

-- One personal row per person per table (org-less by design) …
CREATE UNIQUE INDEX IF NOT EXISTS user_column_prefs_personal_key
    ON staging.user_column_prefs (user_id, table_key) WHERE user_id IS NOT NULL;

-- … and one org-default row per org per table.
CREATE UNIQUE INDEX IF NOT EXISTS user_column_prefs_org_key
    ON staging.user_column_prefs (org_id, table_key) WHERE user_id IS NULL;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='staging' AND table_name='user_column_prefs'
--    ORDER BY ordinal_position;               -- expect 6 rows
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='staging' AND tablename='user_column_prefs';
--                                             -- expect pkey + the 2 above
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='staging.user_column_prefs'::regclass;
--                                             -- expect the 2 named CHECKs + pkey
--
--   SELECT count(*) FROM staging.user_column_prefs;          -- expect 0
--
-- Zero rows is the point: every table renders exactly what it renders today.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Safe while the table is empty. Once people have arranged their tables,
-- dropping it returns every table to its shipped column list — visible, but a
-- loss of their work, so check first:
--
--   SELECT count(*) FROM staging.user_column_prefs;          -- expect 0
--
--   DROP TABLE staging.user_column_prefs;
