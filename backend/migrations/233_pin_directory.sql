-- 233_pin_directory.sql
--
-- Phase 7.2 — THE PIN DIRECTORY. WHICH DISTRICT AND STATE A PIN CODE IS IN.
--
-- "PIN" here is the Postal Index Number, the six-digit Indian postcode.
-- `400001` is Fort, Mumbai. It is not a password. The number was read at the
-- moment this file was written — `ls backend/migrations/ | grep -oE '^[0-9]+' |
-- sort -n | tail -1` answered 232 — and it is never re-numbered afterwards.
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   CREATE TABLE  staging.pin_directory                      x 1   (NEW, empty)
--   CREATE UNIQUE INDEX pin_directory_pin_district_uniq      x 1
--   CREATE UNIQUE INDEX pin_directory_pin_state_district_uniq x 1
--   COMMENT       on the table and on seven columns
--
--   NO ROW IS INSERTED HERE. The 20,144 rows are loaded by
--   `backend/scripts/load_pin_directory.py`, deliberately and separately —
--   see "WHY THE DATA IS NOT IN THIS FILE" below.
--
--   NO EXISTING TABLE IS ALTERED. No column is added, dropped or retyped on any
--   relation that exists today; no live row anywhere in this database is
--   UPDATEd or DELETEd; no foreign key is created in either direction, so
--   nothing that exists gains a constraint it did not have this morning.
--   `graha_contacts`, `graha_clients` and `graha_territories` are not touched
--   at all.
--
-- ── THE NAME WAS FREE, CHECKED IN BOTH SCHEMAS ───────────────────────────────
--
-- Read-only against the live catalogue on 2026-08-27, before this file was
-- written, because a 42P01 is a fact about ONE schema and this database has
-- twice been caught with the same object in two of them:
--
--     SELECT table_schema, table_name FROM information_schema.tables
--      WHERE table_schema IN ('staging','public') AND table_name ILIKE 'pin%';
--       -- 0 rows
--     SELECT sequence_schema, sequence_name FROM information_schema.sequences
--      WHERE sequence_name ILIKE '%pin%';
--       -- 0 rows
--
-- Nothing called `pin_*` exists in `staging` (284 tables) or `public` (42).
-- `services/pin_boundaries.py`'s docstring records the same probe on the same
-- day and says the table does not exist yet. This is the file that makes it.
--
-- ── WHY A NEW TABLE, AND WHY IT CARRIES NO `org_id` ──────────────────────────
--
-- `pay_professional_tax` and `pay_income_tax_slabs` are national reference data
-- with a NULLable `org_id`, because an organisation may legitimately enter its
-- own band and outrank the shared ladder. **This table is not that shape.**
-- Which district a PIN code sits in is a fact published by the Government of
-- India; it is not a rate a customer may set differently for itself, and there
-- is no per-org override to express. So there is no `org_id` column at all,
-- which also means there is no tenancy question to get wrong: every row is
-- readable by everyone because every row is the same public fact for everyone.
--
-- The companion dataset — the PIN *boundaries*, the polygons — deliberately
-- lives in R2 and not in a table, because it is 18.5 MB of geometry that is
-- only ever streamed to a map. This one is 20,144 short rows that will be
-- JOINed and filtered, and that is a table. The two are constantly confused;
-- `services/pin_boundaries.py` opens with a section headed WHAT THIS IS NOT for
-- exactly that reason, and this table is the other one.
--
-- ── `pincode` IS NOT THE PRIMARY KEY, AND THIS IS THE WHOLE POINT ────────────
--
-- Measured over all 20,144 rows of the R2 copy on 2026-08-27, not asserted:
--
--     data rows                                        20,144
--     distinct pincodes                                18,839
--     PINs resolving to exactly one (state, district)   17,610   <- only 93.5%
--     PINs spanning more than one DISTRICT               1,229   (2,534 rows)
--     PINs spanning more than one STATE                     51   (105 rows)
--     most rows for a single PIN                             4
--       192124 -> J&K/ANANTNAG, /SHUPIYAN, /PULWAMA, /KULGAM
--
-- `110003` is present THREE times (NEW DELHI/094, SOUTH EAST/677, SOUTH/098) —
-- the handover said two. `110025` does not even resolve to one STATE: it is
-- DELHI/SOUTH EAST, DELHI/SOUTH *and* UTTAR PRADESH/BUDAUN.
--
-- So a `pincode PRIMARY KEY` — or any UNIQUE(pincode) — would reject 1,305 of
-- the 20,144 rows, and the natural way to write that load is `ON CONFLICT
-- (pincode) DO NOTHING`, which does not fail: it silently keeps whichever
-- district happened to be read first and throws away the other two. A customer
-- in Nizamuddin would be filed in NEW DELHI district because their row lost a
-- race in a CSV. That is the failure this schema exists to prevent, and it is
-- why the constraint below is composite.
--
-- ── THE KEYS, BOTH MEASURED, AND WHY BOTH ARE ENFORCED ───────────────────────
--
-- Over the same 20,144 rows:
--
--     duplicates on (pincode, state, district)     0
--     duplicates on (pincode, district_lgd)        0
--     duplicates on (pincode, state_lgd, district_lgd)  0
--
-- `(pincode, district_lgd)` is the UPSERT TARGET. It is the narrower of the two
-- and the stable one: LGD codes are the government's own identifiers, so a
-- district that is RENAMED keeps its code and the loader updates the row in
-- place, where a name-based key would insert a second row and orphan the first.
--
-- `(pincode, state, district)` is enforced as a SECOND unique index rather than
-- left as a note in a plan. It is what any human-written query will join on —
-- nobody looks up a district by '677' — and a table where one PIN reaches the
-- same named district twice under two codes would silently double every such
-- join. Enforcing it turns a measurement that was true today into a fact that
-- stays true.
--
-- ⚠ THE COST OF THE SECOND INDEX, STATED RATHER THAN DISCOVERED: a future
--   vintage that gives an existing (pincode, state, district) a NEW LGD code
--   will FAIL the load with a unique violation instead of upserting, because
--   the upsert is targeted at the other key. That is deliberate. An LGD recode
--   is a real change in the government's own data and it should stop and get a
--   person, not resolve itself two different ways depending on row order.
--
-- ── `state_lgd` / `district_lgd` ARE TEXT. AN `integer` DESTROYS THEM ─────────
--
-- THE SINGLE MOST LIKELY WAY TO GET THIS FILE WRONG. Both columns are
-- ZERO-PADDED and the padding is significant: Delhi is `'07'`, New Delhi
-- district is `'094'`. As an `integer` those become 7 and 94, they stop
-- matching every other government table keyed on LGD, and NOTHING RAISES —
-- `'07'::integer` is a perfectly good cast. The damage is silent and is only
-- noticed the day somebody tries to join to an LGD-keyed dataset and gets
-- nothing back.
--
-- Measured, so the CHECKs below are calibrated to the data rather than guessed:
--
--     state_lgd     every one of 20,144 rows is exactly 2 digits, 0 blank
--                   36 distinct values, 9 of them starting '0'
--     district_lgd  every one of 20,144 rows is exactly 3 digits, 0 blank
--                   752 distinct values, 99 of them starting '0'
--     state <-> state_lgd is 1:1 over 36 values, 0 conflicts
--     district_lgd -> district name: 0 conflicts over 752 codes / 748 names
--       (four district NAMES repeat across states, which is the other reason
--        the code and not the name is the upsert key)
--
-- TEXT with a digits-only CHECK, and never `char(2)`/`char(3)`: bpchar
-- blank-pads on comparison and would make `'07 '` equal `'07'`, which is a
-- second way to lose the same information.
--
-- ── `blocks`, AND THE WARNING THAT TRAVELS WITH IT ───────────────────────────
--
-- `blocks` is a JSON array inside a CSV cell — `"[""NEW DELHI"",""DELHI""]"`.
-- All 20,144 parse as arrays, none is empty, the longest holds 25 entries and
-- 338 characters, and the whole column is 438 KB.
--
-- ⚠ IT IS NOT CLEAN DATA AND MUST NEVER BE SHOWN AS AUTHORITATIVE. 2,435 rows
--   carry the literal string 'NA' as a block name and 402 rows are exactly
--   `["NA"]`. It is stored because it is the source's own content and dropping
--   a column is not this migration's decision to make; it is `jsonb` so that
--   the 'NA' rows can be filtered in SQL rather than in six call sites.
--
-- ── WRITE-PATH SIDE EFFECTS, STATED BEFORE IT RUNS ───────────────────────────
--
-- ⚠ STAGING AND PRODUCTION SHARE THIS DATABASE. Both write to the `staging`
--   schema, so this DDL lands in production the moment it runs. That is the
--   standing condition of every migration here, not a new risk.
--
-- WHAT CHANGES FOR A RUNNING CUSTOMER: nothing, in any organisation. This
-- creates one relation that did not exist, and on the day it runs NOTHING READS
-- IT — `grep -rn "pin_directory" --include=*.py backend/` finds the loader and
-- its service module and no router, no service on a request path, and no cron.
-- No existing statement's plan changes, because no existing statement names a
-- relation this file touches. There is no deploy ordering requirement in either
-- direction: this file may be applied before, during or after any deploy, and
-- the currently deployed backend neither knows nor needs to know it exists.
--
-- LOCK FOOTPRINT: a CREATE TABLE takes a lock on a relation that no session can
-- be holding, because it does not exist until this statement makes it. It
-- cannot block a customer's query. `lock_timeout` is set anyway, matching the
-- house pattern.
--
-- RISK: LOW, and it is a *schema* risk of the mildest kind — a new empty table
-- with no FK in or out. The reversal at the foot of this file is a single DROP
-- and it is exact, because nothing referenced this relation before it existed.
-- The honest risk in Phase 7.2 is not here; it is in the LOAD, and the load is
-- in a separate file that a person runs deliberately.
--
-- ── WHY THE DATA IS NOT IN THIS FILE ─────────────────────────────────────────
--
-- 20,144 INSERTs could have been generated into this migration and it would
-- have run. It is kept out for three reasons, in order of weight:
--
--  1. **The plan's own rule.** Migrations are pre-approved in this repo;
--     loading 20,144 live rows is a data change and is not covered by that
--     approval. Welding the two together would smuggle the second past the
--     first. (The load was separately approved by the owner on 2026-08-27.)
--  2. **The source of truth is R2, not a copy pasted into git.** The CSV lives
--     at `shared/reference/pin-directory/datagov-2025-05/pin-directory.csv`,
--     sha256 f5de1b50…11cd28, and the loader reads THAT and re-checks its own
--     invariants against it before writing a row. A generated INSERT block is a
--     third copy that can drift from both.
--  3. **A refresh must not be a new migration.** When the government publishes
--     a 2026 vintage, the answer is to run the loader again with a new
--     `--vintage`; it upserts in place. If the seed lived here, every refresh
--     would need a new numbered file that re-states 20,144 rows.
--
-- ── RE-RUNNING THIS FILE IS SAFE ─────────────────────────────────────────────
--
-- Every statement is `IF NOT EXISTS`, and there is no INSERT to duplicate. A
-- second run of this file is a no-op. What must NOT be inferred from that is
-- that the constraints are therefore present — an inline CHECK on `ADD COLUMN
-- IF NOT EXISTS` is skipped WHOLE when the column already exists, so a
-- migration file is never evidence a constraint is there. This one is a CREATE
-- rather than an ALTER, but the rule is the rule: verify from `pg_constraint`,
-- and the query to do it is at the foot of this file.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1 · The table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.pin_directory (
    -- A surrogate key, because no natural single column is unique and the two
    -- composite keys below are both wide. Nothing points at this id — there is
    -- no foreign key to this table anywhere — so it exists to give a row a
    -- handle, not to be joined on.
    id              SERIAL       PRIMARY KEY,

    -- SIX DIGITS AS TEXT, never numeric. A PIN never starts with 0 (the first
    -- digit is the postal region, 1-8, with 9 for Army Post Office), so an
    -- integer column would survive today's data — and would still be wrong the
    -- first time somebody wrote `WHERE pincode = 400001` and got a number
    -- comparison, or exported a CSV and watched Excel eat a leading digit.
    -- The CHECK is `services/territory_routing.py::normalise_pin`'s regex,
    -- character for character, so a row that cannot be routed cannot be stored:
    -- all 20,144 source rows pass it, measured.
    pincode         TEXT         NOT NULL,

    -- The government's own spellings, upper-case, as published. 36 distinct
    -- states, 748 distinct district names. NOT normalised, NOT title-cased and
    -- NOT reconciled against any other table in this database: the moment these
    -- are "tidied" they stop being quotable as the source's own values, and the
    -- longest is 38 characters so nothing is gained by shortening them.
    state           TEXT         NOT NULL,
    district        TEXT         NOT NULL,

    -- The block / tehsil names the source lists for this PIN. `jsonb` and not
    -- `text[]`: it arrives as a JSON array and stays one, which means the load
    -- does no reshaping that could lose an entry. SEE THE WARNING ABOVE — 2,435
    -- rows contain the literal 'NA'.
    blocks          JSONB        NOT NULL DEFAULT '[]'::jsonb,

    -- ⚠ TEXT. ZERO-PADDED. `'07'`, NOT 7. Read the section above before
    --   changing either of these; an integer column destroys them in silence
    --   and the loss is only discovered by a join that returns nothing.
    state_lgd       TEXT         NOT NULL,
    district_lgd    TEXT         NOT NULL,

    -- Which government release this row came from, matching the vintage segment
    -- in the R2 key. A vintage is never rewritten in R2, so this column is what
    -- lets a reader tell a refreshed row from one the new release did not
    -- mention, WITHOUT the loader having to delete anything to find out.
    source_vintage  TEXT         NOT NULL,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- NULL until a later vintage actually CHANGES this row. The loader's
    -- upsert is guarded so that re-running it against an unchanged source
    -- leaves this NULL rather than stamping 20,144 rows with a new timestamp
    -- and reporting work it did not do.
    updated_at      TIMESTAMPTZ  NULL,

    -- Save-time refusals, all of them shaped by the measurement above. None of
    -- these can block a customer: nothing on a request path writes this table.
    CONSTRAINT pin_directory_pincode_ck
        CHECK (pincode ~ '^[1-9][0-9]{5}$'),
    -- Exactly two and exactly three digits. `~ '^[0-9]{2}$'` and not
    -- `length() = 2`, because the point is to reject a value that lost its
    -- padding on the way in — and '7 ' has length 2.
    CONSTRAINT pin_directory_state_lgd_ck
        CHECK (state_lgd ~ '^[0-9]{2}$'),
    CONSTRAINT pin_directory_district_lgd_ck
        CHECK (district_lgd ~ '^[0-9]{3}$'),
    CONSTRAINT pin_directory_blocks_ck
        CHECK (jsonb_typeof(blocks) = 'array'),
    CONSTRAINT pin_directory_state_ck
        CHECK (length(state) > 0 AND length(district) > 0)
);

-- ── 2 · The two unique keys. Both measured; see the section above ────────────

-- THE UPSERT TARGET. `ON CONFLICT (pincode, district_lgd)` in the loader names
-- exactly this index; renaming it is fine, changing its columns is not.
CREATE UNIQUE INDEX IF NOT EXISTS pin_directory_pin_district_uniq
    ON staging.pin_directory (pincode, district_lgd);

-- THE JOIN GUARD. Nobody looks a district up by '677'; every human-written
-- query will use the names, and one PIN reaching the same named district twice
-- would double every such join.
CREATE UNIQUE INDEX IF NOT EXISTS pin_directory_pin_state_district_uniq
    ON staging.pin_directory (pincode, state, district);

-- NO SEPARATE INDEX ON `pincode` ALONE, AND THAT IS DELIBERATE — say it out
-- loud or somebody adds a redundant one. `WHERE pincode = $1` is the only read
-- this table will ever get in volume, and `pin_directory_pin_district_uniq`
-- already leads on `pincode`, so it serves that lookup completely. A third
-- index would cost writes and buy nothing.
--
-- Nothing on `state_lgd` or `district_lgd` either, until something reads them:
-- "list the districts in a state" is a plausible dropdown and an implausible
-- reason to carry an index nobody has asked for yet. 20,144 rows is a
-- sub-millisecond sequential scan.

-- ── 3 · What the catalogue should say about itself ───────────────────────────

COMMENT ON TABLE staging.pin_directory IS
    'data.gov.in PIN code directory: which district and state each six-digit '
    'Indian PIN sits in. 20,144 rows, 18,839 distinct PINs. NATIONAL REFERENCE '
    'DATA - no org_id, every row readable by every tenant, no per-org override '
    'exists. A PIN IS NOT UNIQUE HERE: 1,229 PINs span more than one district '
    'and 51 span more than one STATE (110025 is in Delhi and in Uttar Pradesh), '
    'so any query assuming one row per PIN is wrong. Loaded by '
    'backend/scripts/load_pin_directory.py from R2, never by a migration. The '
    'PIN polygons are a DIFFERENT dataset and live in R2, not here - see '
    'backend/services/pin_boundaries.py.';

COMMENT ON COLUMN staging.pin_directory.pincode IS
    'Six digits, never leading zero. TEXT, not numeric. Not unique - see the '
    'table comment. Matches services/territory_routing.py::normalise_pin.';

COMMENT ON COLUMN staging.pin_directory.state IS
    'The government''s own spelling, upper-case, unreconciled with any other '
    'table here. 36 distinct values.';

COMMENT ON COLUMN staging.pin_directory.district IS
    'The government''s own spelling, upper-case. 748 distinct names against 752 '
    'distinct district_lgd codes - four names repeat across states, which is '
    'why the code and not the name is the upsert key.';

COMMENT ON COLUMN staging.pin_directory.blocks IS
    'Block / tehsil names as the source publishes them, JSON array. NOT CLEAN: '
    '2,435 rows contain the literal string ''NA'' and 402 are exactly ["NA"]. '
    'Never present this as authoritative without filtering.';

COMMENT ON COLUMN staging.pin_directory.state_lgd IS
    'LGD state code. ZERO-PADDED TEXT - Delhi is ''07'', not 7. An integer '
    'column destroys the padding silently and the value stops matching every '
    'other government dataset keyed on LGD. Always exactly two digits.';

COMMENT ON COLUMN staging.pin_directory.district_lgd IS
    'LGD district code. ZERO-PADDED TEXT - New Delhi is ''094'', not 94. Always '
    'exactly three digits. Nationally unique, which makes (pincode, '
    'district_lgd) the stable upsert key.';

COMMENT ON COLUMN staging.pin_directory.source_vintage IS
    'The government release this row came from, matching the vintage segment of '
    'the R2 key (e.g. datagov-2025-05). A vintage is never rewritten, so a row '
    'still carrying an older value after a load is one the new release did not '
    'mention - which the loader reports and does not delete.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- ── VERIFY FROM THE CATALOGUE, NEVER FROM THIS FILE ──────────────────────────
--
--   SELECT c.conname, pg_get_constraintdef(c.oid)
--     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--    WHERE n.nspname='staging' AND t.relname='pin_directory' ORDER BY 1;
--   -- expect 6: pkey + pincode_ck + state_lgd_ck + district_lgd_ck
--   --           + blocks_ck + state_ck
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='staging' AND tablename='pin_directory' ORDER BY 1;
--   -- expect 3: the pkey and the two UNIQUE indexes. NOT four.
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='staging' AND table_name='pin_directory'
--      AND column_name IN ('state_lgd','district_lgd');
--   -- BOTH MUST READ 'text'. If either says 'integer', the padding is already
--   -- gone and the table has to be rebuilt, not patched.
--
-- After `scripts/load_pin_directory.py` has run:
--
--   SELECT count(*), count(DISTINCT pincode) FROM staging.pin_directory;
--   -- expect 20144, 18839
--   SELECT state, district, state_lgd, district_lgd FROM staging.pin_directory
--    WHERE pincode='110003';                     -- expect 3 rows
--   SELECT DISTINCT state FROM staging.pin_directory WHERE pincode='110025';
--   -- expect 2: DELHI and UTTAR PRADESH
--   SELECT DISTINCT state_lgd FROM staging.pin_directory WHERE state='DELHI';
--   -- expect '07' -- if it reads '7', the padding was lost
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS staging.pin_directory;
--
-- Exact and complete, and it stays exact for as long as this table has no
-- customer-entered rows in it. The relation did not exist before this file ran
-- (verified read-only 2026-08-27 in BOTH schemas), no foreign key points at it
-- in either direction, and nothing selects it until the Phase 7.6 address work
-- ships. Dropping it destroys nothing but a re-loadable copy of a public
-- dataset that is still in R2.
--
-- To undo only the LOAD and keep the table:
--
--   DELETE FROM staging.pin_directory WHERE source_vintage = 'datagov-2025-05';
--
-- ⚠ IF A LATER PHASE EVER LETS A CUSTOMER ADD OR CORRECT A ROW HERE, THE DROP
--   STOPS BEING EXACT. Add an `org_id`-shaped column at that point and scope
--   the reversal, exactly as 230 does for the income-tax ladder.
-- ═════════════════════════════════════════════════════════════════════════════
