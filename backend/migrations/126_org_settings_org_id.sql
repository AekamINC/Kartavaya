-- 126_org_settings_org_id.sql
--
-- THE BRAND KIT BELONGED TO EVERY ORGANISATION AT ONCE.
--
-- `org_settings` is created by `server.py`'s startup DDL as:
--
--     CREATE TABLE IF NOT EXISTS org_settings (
--         key   TEXT PRIMARY KEY,
--         value JSONB NOT NULL DEFAULT '[]'
--     )
--
-- Two rows for the whole database — `brand_colors` and `brand_fonts`. Every
-- organisation's `GET /api/settings` read the same two rows, and every
-- organisation's `PUT /api/settings` upserted `ON CONFLICT (key)`, so the last
-- tenant to save its colours overwrote every other tenant's colours in place.
-- That is a cross-tenant WRITE, not merely a shared read.
--
-- ── WHAT IS ACTUALLY IN THE DATABASE, MEASURED ──────────────────────────────
--
-- Read-only against kartavya-sg (Singapore) on 2026-08-06:
--
--   information_schema.columns for table_name='org_settings' returns FIVE rows,
--   because there are TWO tables:
--
--     public.org_settings   (key text NOT NULL, value jsonb NOT NULL)
--     staging.org_settings  (key text NOT NULL, value jsonb NOT NULL,
--                            org_id uuid NULL)
--
--   `pg_get_constraintdef` says PRIMARY KEY (key) on BOTH. So staging's
--   `org_id` column already exists — added by an earlier catch-up — and it has
--   never been written by any code path, and it is not in the key, so its
--   presence changed nothing: one row per key, database-wide, either way.
--
--   The backend connects with `SET search_path TO staging, public`
--   (`backend/db.py:113`), so the unqualified `org_settings` in `server.py`
--   resolves to `staging.org_settings`. `public.org_settings` is the older
--   copy. This migration fixes BOTH, because leaving a wrongly-shaped table
--   behind a search_path is how it comes back.
--
-- ── ROW COUNT EXPECTATION ───────────────────────────────────────────────────
--
--   SELECT count(*) FROM public.org_settings   ->  0      (measured 2026-08-06)
--   SELECT count(*) FROM staging.org_settings  ->  0      (measured 2026-08-06)
--
--   THE BACKFILL IS THEREFORE EXPECTED TO UPDATE 0 ROWS, in both schemas. The
--   brand kit has never been saved on this database; the hole is real and
--   unexercised. The migration RAISES NOTICE with the actual count so the
--   number is in the apply log rather than in someone's memory.
--
--   If it updates more than 0: those rows were written between the measurement
--   above and the apply, they are the shared kit, and the owner has confirmed
--   Aekam Inc owns it — 045b76ad-654b-42dd-b4b1-731700efc6c3. That is the
--   backfill target and it is deliberate, not a default.
--
--   If it updates more than 2 per schema: STOP AND LOOK. There are only two
--   legal keys ('brand_colors', 'brand_fonts'); a third means something else
--   started writing this table and the ownership question has to be asked
--   again before it is answered by this file.
--
-- ── IDEMPOTENT ──────────────────────────────────────────────────────────────
--
-- Every step is guarded on catalogue state rather than on "has this run
-- before": ADD COLUMN IF NOT EXISTS, an UPDATE predicated on `org_id IS NULL`,
-- a primary key that is dropped only when it is the single-column one, and an
-- FK added only when absent. Running it twice is a no-op that prints zeros.
--
-- ── NOT APPLIED ─────────────────────────────────────────────────────────────
--
-- There is ONE `staging` schema and production writes to it too, so applying
-- this is a production change and is the owner's call. It must land WITH the
-- code change in `server.py` (`_get_org_settings`, `update_org_settings`,
-- `update_brand_colors_compat`), which now writes
-- `ON CONFLICT (org_id, key)` — that conflict target needs the composite
-- primary key below to exist. Code without migration = a 500 on save.
-- Migration without code = correct but unused. Ship them together.

BEGIN;

DO $mig$
DECLARE
    AEKAM CONSTANT uuid := '045b76ad-654b-42dd-b4b1-731700efc6c3';
    s          text;
    pk_name    text;
    pk_cols    smallint[];
    moved      bigint;
    remaining  bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM staging.organisations WHERE id = AEKAM) THEN
        RAISE EXCEPTION
            'backfill target org % does not exist; refusing to orphan the brand kit',
            AEKAM;
    END IF;

    FOREACH s IN ARRAY ARRAY['staging', 'public'] LOOP
        IF to_regclass(format('%I.org_settings', s)) IS NULL THEN
            RAISE NOTICE '126: %.org_settings does not exist — skipped', s;
            CONTINUE;
        END IF;

        -- 1. the column. staging already has it; public does not.
        EXECUTE format(
            'ALTER TABLE %I.org_settings ADD COLUMN IF NOT EXISTS org_id uuid', s);

        -- 2. the backfill. Expected: 0 rows (see the header).
        EXECUTE format(
            'UPDATE %I.org_settings SET org_id = $1 WHERE org_id IS NULL', s)
            USING AEKAM;
        GET DIAGNOSTICS moved = ROW_COUNT;
        RAISE NOTICE '126: %.org_settings — % row(s) backfilled to Aekam Inc',
            s, moved;

        -- 3. prove it before constraining on it.
        EXECUTE format(
            'SELECT count(*) FROM %I.org_settings WHERE org_id IS NULL', s)
            INTO remaining;
        IF remaining > 0 THEN
            RAISE EXCEPTION
                '126: %.org_settings still has % row(s) with a null org_id',
                s, remaining;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.org_settings ALTER COLUMN org_id SET NOT NULL', s);

        -- 4. the key. THIS is the part that stops one org's save from being
        --    every org's save; the column on its own changed nothing, which is
        --    exactly what staging.org_settings has been demonstrating.
        SELECT con.conname, con.conkey INTO pk_name, pk_cols
          FROM pg_constraint con
          JOIN pg_class c      ON c.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = s
           AND c.relname  = 'org_settings'
           AND con.contype = 'p';

        IF pk_name IS NOT NULL AND array_length(pk_cols, 1) = 1 THEN
            EXECUTE format('ALTER TABLE %I.org_settings DROP CONSTRAINT %I',
                           s, pk_name);
            pk_name := NULL;
        END IF;

        IF pk_name IS NULL THEN
            EXECUTE format(
                'ALTER TABLE %I.org_settings '
                'ADD CONSTRAINT org_settings_pkey PRIMARY KEY (org_id, key)', s);
            RAISE NOTICE '126: %.org_settings — primary key is now (org_id, key)', s;
        ELSE
            RAISE NOTICE '126: %.org_settings — composite primary key already present', s;
        END IF;

        -- 5. and the org has to be a real one. Deleting an organisation takes
        --    its brand kit with it rather than leaving a row nothing can reach.
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
              JOIN pg_class c      ON c.oid = con.conrelid
              JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = s
               AND c.relname  = 'org_settings'
               AND con.contype = 'f'
               AND con.conname = 'org_settings_org_id_fkey'
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I.org_settings '
                'ADD CONSTRAINT org_settings_org_id_fkey '
                'FOREIGN KEY (org_id) REFERENCES staging.organisations(id) '
                'ON DELETE CASCADE', s);
        END IF;
    END LOOP;
END
$mig$;

COMMIT;

-- ── VERIFY (run by hand after apply; not part of the transaction) ────────────
--
--   SELECT n.nspname, pg_get_constraintdef(con.oid)
--     FROM pg_constraint con
--     JOIN pg_class c      ON c.oid = con.conrelid
--     JOIN pg_namespace n  ON n.oid = c.relnamespace
--    WHERE c.relname = 'org_settings' AND con.contype = 'p';
--   -- expected: PRIMARY KEY (org_id, key) for both `staging` and `public`
--
--   SELECT count(*) FROM staging.org_settings WHERE org_id IS NULL;   -- 0
