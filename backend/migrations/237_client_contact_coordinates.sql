-- 237_client_contact_coordinates.sql
--
-- Phase 8.4 — ONE COORDINATE, WRITTEN ON PURPOSE, WITH ITS PROVENANCE.
--
-- The number was read at the moment this file was written —
-- `ls backend/migrations/ | grep -oE '^[0-9]+' | sort -n | tail -1` answered
-- 236 — and it is never re-numbered afterwards.
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   ALTER TABLE  staging.graha_clients   ADD COLUMN x 4   (lat, lng,
--                                                          geo_source,
--                                                          geo_fetched_at)
--   ALTER TABLE  staging.graha_contacts  ADD COLUMN x 4   (the same four)
--   ADD CONSTRAINT  x 6                  (3 CHECKs on each table)
--   COMMENT         on 8 columns
--
--   NO ROW IS WRITTEN, ANYWHERE. There is no INSERT, no UPDATE, no DELETE and
--   NO BACKFILL in this file. All eight columns land NULL on all 389 existing
--   rows (92 clients, 297 contacts, counted live 2026-08-28) and stay NULL
--   until a human deliberately drops a pin. That is 8.4's whole premise: a
--   coordinate is never a side effect of looking at a record.
--
--   NO COLUMN IS DROPPED OR RETYPED. No foreign key is created in either
--   direction. No index is created — see "NO INDEX, DELIBERATELY" below.
--   `pin_directory`, `graha_territories`, `graha_deals`, `ganit_invoices` and
--   `vikray_orders` are not touched at all.
--
-- ── THE COLUMNS DO NOT EXIST YET. MEASURED, IN BOTH PRODUCT SCHEMAS ──────────
--
-- Read-only against the live catalogue on 2026-08-28, before this file was
-- written, because a 42P01 — or an empty result — is a fact about ONE schema
-- and this database has twice been caught with the same object in two of them:
--
--     SELECT table_schema, table_name, column_name, data_type
--       FROM information_schema.columns
--      WHERE table_schema IN ('staging','public')
--        AND table_name IN ('graha_clients','graha_contacts')
--        AND column_name IN ('lat','lng','geo_source','geo_fetched_at',
--                            'digipin','geo_place_id');
--       -- 0 rows
--
--     SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='public'
--        AND table_name IN ('graha_clients','graha_contacts');
--       -- 0   <- both tables exist ONLY in `staging`. There is no `public`
--       --        copy to keep in step, and no second place to add these.
--
--     SELECT count(*) FROM pg_constraint c
--       JOIN pg_class t ON t.oid=c.conrelid
--       JOIN pg_namespace n ON n.oid=t.relnamespace
--      WHERE n.nspname='staging'
--        AND t.relname IN ('graha_clients','graha_contacts')
--        AND c.conname LIKE '%geo%';
--       -- 0   <- none of the six constraint names below is taken
--
-- `staging.graha_clients` + `staging.graha_contacts` carry 47 columns between
-- them today; this file makes it 55.
--
-- ── NEVER A BARE COORDINATE PAIR. THIS IS THE POINT OF THE FILE ──────────────
--
-- `docs/plans/PHASE-8-maps-across-modules.md` §8.4 is explicit: `lat`, `lng`,
-- `geo_source` and `geo_fetched_at` ship IN THE SAME MIGRATION, never a pair
-- first and the provenance later. The reason is not tidiness, it is that the
-- two vendors this product can touch have INCOMPATIBLE and TIME-BOUND terms:
--
--     Google  a cached coordinate is permitted for 30 DAYS
--             (a `place_id` indefinitely — we store neither yet)
--     Mappls  caching a geocode result to avoid fees is FORBIDDEN OUTRIGHT,
--             and submitted content carries a perpetual sub-licensable
--             licence to them (proposal 92 §6.3)
--
-- A coordinate with no provenance cannot comply with EITHER rule, because
-- nobody can tell which rule it falls under. "Where did this coordinate come
-- from" would have exactly one honest answer — a shrug — and the only safe
-- remediation would be to delete every coordinate in the product.
--
-- With these two columns beside the pair, a retention sweep is one statement
-- and a vendor swap is a filter. Without them neither is expressible at all.
--
-- ── WHY THE ALLOWLIST HAS NO MAPPLS VALUE, AND WHY THAT IS THE ENFORCEMENT ───
--
-- ⚠ READ THIS BEFORE ADDING A VALUE TO `*_geo_source_ck`.
--
-- The five permitted values are the five ways a coordinate may LAWFULLY reach
-- these columns:
--
--   'user_pin'      A human dragged or dropped a pin on our own map surface.
--                   The coordinate is our user's own assertion about their own
--                   customer. No vendor produced it, so no vendor has rights
--                   over it and no expiry attaches. THE EXPECTED VALUE for
--                   almost every row 8.4 will ever write.
--   'device_gps'    The device's own Geolocation API — someone standing at the
--                   premises. Same story: the user's hardware, not a vendor's
--                   database. `pahchan_punches.lat/lng` is this, and is why
--                   these columns share that column's exact type.
--   'manual_entry'  Decimal degrees typed by a person, from a survey, a deed
--                   or a site plan. No vendor.
--   'google_places' Copied out of a Google Maps result. ⏳ THE ONLY VALUE WITH
--                   A CLOCK ON IT: permitted for 30 days from
--                   `geo_fetched_at`, after which the row must be cleared or
--                   re-derived. This is the value that makes `geo_fetched_at`
--                   load-bearing rather than decorative.
--   'import'        Arrived through a bulk import of the customer's own data.
--                   Provenance is whatever their file said, which is to say
--                   unknown — and 'unknown' is a fact worth recording as
--                   itself rather than laundering into one of the four above.
--
-- THERE IS DELIBERATELY NO 'mappls_geocode', NO 'mappls_suggest' AND NO OTHER
-- MAPPLS VALUE. Mappls forbids caching a geocode result, so a Mappls-derived
-- coordinate has no lawful home in this database at all — and the cheapest
-- possible place to enforce that is a CHECK constraint that makes the write
-- fail. If a future writer needs a Mappls value here, the licence changed or
-- the writer is wrong; either way it is a conversation, not an ALTER.
--
-- Phase 8.3's autosuggest DOES call Mappls. What it may store is the ADDRESS
-- TEXT the user accepted, in the existing `address` jsonb — not a coordinate.
-- That distinction is the reason this constraint exists.
--
-- ── `NUMERIC(10,7)`, MATCHING `pahchan_punches`. THE TYPE IS A DECISION ──────
--
-- Measured live, not assumed:
--
--     SELECT data_type, numeric_precision, numeric_scale
--       FROM information_schema.columns
--      WHERE table_schema='staging' AND table_name='pahchan_punches'
--        AND column_name IN ('lat','lng');
--       -- numeric, 10, 7   (both)
--
-- Matched, for four reasons, in order of weight:
--
--  1. **One coordinate type in the product.** Pahchan already stores a
--     coordinate this way. A `double precision` here would mean a UNION or a
--     JOIN between a punch and a client — which is exactly what "clients near
--     me" and the Manav conveyance distance will want — needs a cast, and the
--     first person to write that cast will pick a direction at random.
--  2. **Exact decimal. A stored coordinate is evidence.** `numeric` round-trips
--     the value that was written, character for character. A float does not:
--     21.1702 is not representable in binary and comes back as a value that
--     merely prints the same. When the question is "prove this coordinate has
--     not changed since we captured it" — which is what a retention rule and a
--     DPDP answer both reduce to — bit-exactness is the whole answer.
--  3. **The range fits the precision exactly.** 10 digits, 7 after the point,
--     leaves 3 before it: ±180.0000000 fits, and there is nothing left over to
--     let a nonsense value in through the type alone.
--  4. **7 decimals ≈ 1.1 cm at the equator.** Finer than any GNSS fix and
--     finer than DIGIPIN's ~4 m grid, so no precision this product can produce
--     is lost on the way in. `AddressBlock.jsx` renders 4 decimals (~11 m) to
--     a human; that is a display choice and this column must not adopt it.
--
-- ⚠ ASSIGNMENT INTO `numeric(10,7)` ROUNDS THE FRACTION SILENTLY AND RAISES
--   22003 ON THE INTEGER PART. 21.123456789 stores as 21.1234568 with no
--   warning, which is correct and intended. 1000.5 raises. The range CHECK
--   below makes the second case unreachable, so the only behaviour left is the
--   rounding, and the rounding is below the noise floor of every source above.
--
-- ── A HALF-COORDINATE IS NOT A LOCATION, AND ALL FOUR MOVE TOGETHER ──────────
--
-- `frontend/src/components/ui/AddressBlock.jsx::coordinate()` already refuses a
-- lat with no lng — it returns `null` and the component renders NO link rather
-- than a link to a meridian. `*_geo_complete_ck` is that same rule, one layer
-- down, widened from two columns to four:
--
--     all four NULL          the ordinary state of all 389 rows today
--     all four NOT NULL      a coordinate that was written on purpose
--     anything else          REFUSED
--
-- Which means, and this is the behaviour the route depends on:
--
--   * a coordinate can never be stored without a source and a timestamp —
--     the "bare pair" §8.4 forbids is not merely discouraged, it is
--     unrepresentable;
--   * CLEARING must null ALL FOUR in one statement. A route that nulls the
--     pair and leaves the provenance behind gets a 23514, not a half-cleared
--     row that outlives the coordinate it described;
--   * a source or a timestamp can never sit alone, so `geo_fetched_at` cannot
--     become a record of a lookup that produced nothing.
--
-- ── NO INDEX, DELIBERATELY. SAY IT OUT LOUD OR SOMEBODY ADDS ONE ─────────────
--
-- Nothing reads these columns by value on the day this runs, and the reads
-- 8.4 unlocks are per-record (`WHERE id = $1`), which the primary key already
-- serves. "Clients near me" is a bounding-box scan over at most a few hundred
-- rows per org and does not justify an index, let alone PostGIS. When it does,
-- the right answer is a partial index `WHERE lat IS NOT NULL` — most rows will
-- never carry a coordinate — and that is a separate, measured decision.
--
-- ── WRITE-PATH SIDE EFFECTS, STATED BEFORE IT RUNS ───────────────────────────
--
-- ⚠ STAGING AND PRODUCTION SHARE THIS DATABASE. Both write to the `staging`
--   schema, so this DDL lands in production the moment it runs. That is the
--   standing condition of every migration here, not a new risk — but it is
--   sharper than usual here because, unlike 233, this file ALTERS TWO TABLES
--   THAT ARE ON EVERY REQUEST PATH IN THREE MODULES.
--
-- WHAT CHANGES FOR A RUNNING CUSTOMER: nothing they can see, in any
-- organisation. Eight nullable columns appear and nothing reads or writes them
-- until the 8.4 route ships. No existing statement changes plan: every
-- SELECT in the product names its columns explicitly except `SELECT *` in
-- `get_client` and `RETURNING *` in `create_client`, and both of those hand the
-- row to code that builds its response key by key — the four NULLs ride along
-- in `get_client`'s response and are ignored by every current consumer.
--
-- ⚠ THE ONE ORDERING FACT: this file may be applied BEFORE the backend deploy
--   that adds the route, and must be. Applied after, the route 500s on an
--   undefined column. There is no reverse hazard — the currently deployed
--   backend neither knows nor needs to know these columns exist.
--
-- LOCK FOOTPRINT, AND IT IS NOT ZERO:
--
--   * `ADD COLUMN ... NULL` with NO DEFAULT is metadata-only on PostgreSQL 11+
--     (this database is 17.6). No table rewrite, no per-row work, milliseconds.
--   * `ADD CONSTRAINT ... CHECK` takes ACCESS EXCLUSIVE and VALIDATES by
--     scanning the table. 92 and 297 rows, every new column NULL, so the scan
--     is instant and trivially passes — but ACCESS EXCLUSIVE still queues
--     behind any open transaction holding a lock on these tables, and every
--     later query queues behind IT. `lock_timeout` is set to 5s so this file
--     fails fast rather than stalling the CRM behind a long-running read.
--   * NOT VALID + a later VALIDATE was considered and rejected: it is the
--     right tool for a million-row table and this is 389 rows. Two statements
--     to avoid a lock measured in milliseconds would leave a window where the
--     constraint is present and unenforced, which is worse.
--
-- RISK: LOW. Additive, nullable, no backfill, no FK, no index, no data
-- touched. The reversal at the foot of this file is exact TODAY and stops
-- being exact the moment the first coordinate is written — see the warning
-- there.
--
-- ── RE-RUNNING THIS FILE IS SAFE ─────────────────────────────────────────────
--
-- The columns use `ADD COLUMN IF NOT EXISTS` and the constraints are guarded
-- by a `pg_constraint` lookup, so a second run is a no-op.
--
-- ⚠ WHAT MUST NOT BE INFERRED FROM THAT: that a green run means the
--   constraints are present. `ADD COLUMN IF NOT EXISTS` SKIPS AN INLINE CHECK
--   WHOLE when the column already exists — migration 233 records the same
--   trap. That is precisely why the CHECKs below are separate `ALTER TABLE ...
--   ADD CONSTRAINT` statements inside a `DO` block rather than inline column
--   constraints: an inline CHECK on a column that already exists is silently
--   not created, and the file still reports success. VERIFY FROM
--   `pg_constraint`; the query is at the foot of this file.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1 · The four columns, on both tables ─────────────────────────────────────
--
-- Written out twice rather than looped in a DO block: a `format()`-driven loop
-- over two table names would hide the exact DDL from anyone reading this file
-- to find out what ran, and there are only two tables.

ALTER TABLE staging.graha_clients
    ADD COLUMN IF NOT EXISTS lat            NUMERIC(10,7) NULL,
    ADD COLUMN IF NOT EXISTS lng            NUMERIC(10,7) NULL,
    ADD COLUMN IF NOT EXISTS geo_source     TEXT          NULL,
    ADD COLUMN IF NOT EXISTS geo_fetched_at TIMESTAMPTZ   NULL;

ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS lat            NUMERIC(10,7) NULL,
    ADD COLUMN IF NOT EXISTS lng            NUMERIC(10,7) NULL,
    ADD COLUMN IF NOT EXISTS geo_source     TEXT          NULL,
    ADD COLUMN IF NOT EXISTS geo_fetched_at TIMESTAMPTZ   NULL;

-- ── 2 · The three CHECKs, on both tables ─────────────────────────────────────
--
-- Guarded by name against `pg_constraint`, which is the only place that can
-- answer whether a constraint exists. `ADD CONSTRAINT` has no `IF NOT EXISTS`
-- and a bare re-run would raise 42710 and abort the whole file.

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['graha_clients', 'graha_contacts'] LOOP

        -- (a) RANGE. The type already bounds the magnitude at ±999.9999999;
        --     this is what actually says "on Earth". A swapped lat/lng pair is
        --     the classic coordinate bug and this catches exactly the half of
        --     them where the longitude exceeds 90.
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'staging' AND t.relname = tbl
               AND c.conname = tbl || '_geo_range_ck'
        ) THEN
            EXECUTE format(
                'ALTER TABLE staging.%I ADD CONSTRAINT %I CHECK ('
                '  (lat IS NULL OR (lat >= -90  AND lat <= 90)) AND'
                '  (lng IS NULL OR (lng >= -180 AND lng <= 180)))',
                tbl, tbl || '_geo_range_ck');
        END IF;

        -- (b) ALL FOUR OR NONE. A half-coordinate is not a location, a
        --     coordinate with no provenance cannot comply with any vendor's
        --     terms, and a clear that leaves either behind is refused.
        --     See the section above before relaxing any arm of this.
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'staging' AND t.relname = tbl
               AND c.conname = tbl || '_geo_complete_ck'
        ) THEN
            EXECUTE format(
                'ALTER TABLE staging.%I ADD CONSTRAINT %I CHECK ('
                '  (lat IS NULL AND lng IS NULL AND geo_source IS NULL'
                '   AND geo_fetched_at IS NULL)'
                '  OR'
                '  (lat IS NOT NULL AND lng IS NOT NULL AND geo_source IS NOT NULL'
                '   AND geo_fetched_at IS NOT NULL))',
                tbl, tbl || '_geo_complete_ck');
        END IF;

        -- (c) THE ALLOWLIST. Five values, and no Mappls value, for the reason
        --     given at length above: Mappls forbids caching a geocode result,
        --     so there is no lawful Mappls row to permit.
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'staging' AND t.relname = tbl
               AND c.conname = tbl || '_geo_source_ck'
        ) THEN
            EXECUTE format(
                'ALTER TABLE staging.%I ADD CONSTRAINT %I CHECK ('
                '  geo_source IS NULL OR geo_source IN '
                '  (''user_pin'',''device_gps'',''manual_entry'','
                '   ''google_places'',''import''))',
                tbl, tbl || '_geo_source_ck');
        END IF;

    END LOOP;
END $$;

-- ── 3 · What the catalogue should say about itself ───────────────────────────
--
-- Eight comments, because the next person to meet these columns will meet them
-- in `\d staging.graha_clients` and not in this file.

COMMENT ON COLUMN staging.graha_clients.lat IS
    'Latitude, decimal degrees, NUMERIC(10,7) matching pahchan_punches.lat. '
    'WRITTEN ONLY WHEN A HUMAN DELIBERATELY DROPS A PIN (Phase 8.4) - never as '
    'a side effect of viewing a record, because a view-time geocode is metered '
    'and sends a client''s premises to a vendor on every open. NULL on almost '
    'every row and that is the normal state. Never present without lng, '
    'geo_source and geo_fetched_at: see graha_clients_geo_complete_ck.';
COMMENT ON COLUMN staging.graha_clients.lng IS
    'Longitude, decimal degrees. See the lat comment - the two are one value '
    'and a half-coordinate is refused by graha_clients_geo_complete_ck.';
COMMENT ON COLUMN staging.graha_clients.geo_source IS
    'WHERE THIS COORDINATE CAME FROM, and the reason a bare pair is forbidden. '
    'One of: user_pin (a human dropped it - the expected value), device_gps, '
    'manual_entry, google_places (⏳ 30-DAY CACHE LIMIT under Google''s terms, '
    'measured from geo_fetched_at), import (provenance unknown). NO MAPPLS '
    'VALUE EXISTS AND NONE MAY BE ADDED: Mappls forbids caching a geocode '
    'result, so a Mappls coordinate has no lawful home here.';
COMMENT ON COLUMN staging.graha_clients.geo_fetched_at IS
    'When the coordinate was captured. SET SERVER-SIDE WITH NOW(), never taken '
    'from the client - a caller-supplied timestamp would let a 30-day '
    'retention rule be reset by the thing it constrains. This is the clock a '
    'google_places retention sweep reads.';

COMMENT ON COLUMN staging.graha_contacts.lat IS
    'Latitude, decimal degrees, NUMERIC(10,7) matching pahchan_punches.lat. '
    'WRITTEN ONLY WHEN A HUMAN DELIBERATELY DROPS A PIN (Phase 8.4) - never as '
    'a side effect of viewing a record. Never present without lng, geo_source '
    'and geo_fetched_at: see graha_contacts_geo_complete_ck.';
COMMENT ON COLUMN staging.graha_contacts.lng IS
    'Longitude, decimal degrees. See the lat comment - the two are one value '
    'and a half-coordinate is refused by graha_contacts_geo_complete_ck.';
COMMENT ON COLUMN staging.graha_contacts.geo_source IS
    'WHERE THIS COORDINATE CAME FROM. One of: user_pin, device_gps, '
    'manual_entry, google_places (⏳ 30-day cache limit from geo_fetched_at), '
    'import. NO MAPPLS VALUE EXISTS AND NONE MAY BE ADDED - Mappls forbids '
    'caching a geocode result. A contact is a PERSON: this is a coordinate for '
    'their business address, and it is subject to the same DPDP reasoning as '
    'every other personal field on this table.';
COMMENT ON COLUMN staging.graha_contacts.geo_fetched_at IS
    'When the coordinate was captured. SET SERVER-SIDE WITH NOW(), never taken '
    'from the client.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- ── VERIFY FROM THE CATALOGUE, NEVER FROM THIS FILE ──────────────────────────
--
--   SELECT table_name, column_name, data_type, numeric_precision,
--          numeric_scale, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='staging'
--      AND table_name IN ('graha_clients','graha_contacts')
--      AND column_name IN ('lat','lng','geo_source','geo_fetched_at')
--    ORDER BY table_name, column_name;
--   -- expect 8 rows. lat/lng MUST read numeric / 10 / 7 - if either says
--   -- 'double precision' the exactness argument above is already lost.
--   -- is_nullable MUST be YES on all eight and column_default MUST be NULL on
--   -- all eight: a DEFAULT here would be a coordinate nobody chose.
--
--   SELECT c.conname, pg_get_constraintdef(c.oid)
--     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--    WHERE n.nspname='staging'
--      AND t.relname IN ('graha_clients','graha_contacts')
--      AND c.conname LIKE '%geo%' ORDER BY 1;
--   -- expect EXACTLY 6, all convalidated: {clients,contacts} x
--   -- {geo_range_ck, geo_complete_ck, geo_source_ck}
--
--   SELECT count(*) FROM staging.graha_clients WHERE lat IS NOT NULL;
--   SELECT count(*) FROM staging.graha_contacts WHERE lat IS NOT NULL;
--   -- expect 0 and 0 IMMEDIATELY AFTER THIS FILE RUNS. Anything else means
--   -- something backfilled, and nothing in this file can have.
--
-- Once the 8.4 route has been exercised (§8.4's acceptance is ONE contact):
--
--   SELECT id, lat, lng, geo_source, geo_fetched_at
--     FROM staging.graha_contacts WHERE lat IS NOT NULL;
--   -- every row must carry all four. If one does not, geo_complete_ck is not
--   -- present - re-read the ADD COLUMN IF NOT EXISTS warning above.
--
-- A retention sweep, for when the first google_places row is written:
--
--   SELECT count(*) FROM staging.graha_contacts
--    WHERE geo_source='google_places' AND geo_fetched_at < NOW() - INTERVAL '30 days';
--   -- and the clear is the four-column UPDATE in the reversal section below,
--   -- filtered the same way. It must null all four or it raises 23514.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
-- FULL, and it is exact TODAY:
--
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   ALTER TABLE staging.graha_clients
--       DROP COLUMN IF EXISTS lat,
--       DROP COLUMN IF EXISTS lng,
--       DROP COLUMN IF EXISTS geo_source,
--       DROP COLUMN IF EXISTS geo_fetched_at;
--   ALTER TABLE staging.graha_contacts
--       DROP COLUMN IF EXISTS lat,
--       DROP COLUMN IF EXISTS lng,
--       DROP COLUMN IF EXISTS geo_source,
--       DROP COLUMN IF EXISTS geo_fetched_at;
--   COMMIT;
--
-- DROP COLUMN takes the constraints and the comments with it; there is nothing
-- else to undo, because this file created no index, no FK and no row.
--
-- ⚠ THE DROP STOPS BEING EXACT THE MOMENT THE FIRST COORDINATE IS WRITTEN.
--   After that it destroys customer-entered data that exists nowhere else in
--   this database and cannot be re-derived — a pin someone dropped by hand is
--   not recoverable from an address. Before dropping, check:
--
--     SELECT (SELECT count(*) FROM staging.graha_clients  WHERE lat IS NOT NULL)
--          + (SELECT count(*) FROM staging.graha_contacts WHERE lat IS NOT NULL);
--     -- if this is not 0, TAKE A COPY FIRST, into a dated restore schema, the
--     -- way dead_tables_20260822 and ledger_repair_20260826 were taken:
--     --   CREATE SCHEMA IF NOT EXISTS geo_backup_YYYYMMDD;
--     --   CREATE TABLE geo_backup_YYYYMMDD.graha_clients_geo AS
--     --     SELECT id, org_id, lat, lng, geo_source, geo_fetched_at
--     --       FROM staging.graha_clients WHERE lat IS NOT NULL;
--     --   (and the same for graha_contacts)
--
-- PARTIAL REVERSAL — keep the columns, discard every coordinate. This is what
-- a licence problem or a DPDP erasure request actually needs, and it is not a
-- DROP. All four columns MUST be nulled together or geo_complete_ck raises:
--
--   UPDATE staging.graha_clients
--      SET lat=NULL, lng=NULL, geo_source=NULL, geo_fetched_at=NULL
--    WHERE lat IS NOT NULL;
--   UPDATE staging.graha_contacts
--      SET lat=NULL, lng=NULL, geo_source=NULL, geo_fetched_at=NULL
--    WHERE lat IS NOT NULL;
-- ═════════════════════════════════════════════════════════════════════════════
