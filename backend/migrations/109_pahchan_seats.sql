-- 109_pahchan_seats.sql
--
-- AN ORGANISATION BUYS TWO KINDS OF SEAT AND THEY ARE COUNTED SEPARATELY.
-- `organisations.max_users` is the org-seat allowance and already exists
-- (migration 061). This adds its attendance counterpart.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change, exactly as 093-105 each say. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/109_pahchan_seats.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED, AND THE CODE THAT READS THIS COLUMN ALREADY SHIPS WITHOUT IT.
-- `services/seat_model.py` reads the value as `to_jsonb(o) ->> 'max_pahchan_seats'`
-- rather than `o.max_pahchan_seats`, which yields NULL for a column that is not
-- there instead of raising `UndefinedColumn`. NULL is that file's word for "no
-- cap set", so the product behaves today exactly as it will behave for an org
-- Aekam has not given a cap to. Applying this file changes NOTHING on its own —
-- it only makes the cap settable.
--
-- ── WHY A SECOND COLUMN AND NOT A BIGGER `max_users` ────────────────────────
--
-- Settled by the owner on 2026-08-04: a firm with 8 office staff and 200 site
-- workers pays for 8 org seats and 200 attendance seats, NOT 208 of one kind. A
-- site worker who only ever clocks in must not cost what a full user costs. One
-- number cannot express two prices, and the moment the two populations share a
-- column the cheaper one is billed at the dearer one's rate.
--
-- ── WHY NOT A STORED COUNT ─────────────────────────────────────────────────
--
-- This column is the ALLOWANCE — what was bought. There is deliberately no
-- column for what is USED. A stored count drifts the first time somebody is
-- removed by a path that does not maintain it, and this product has already had
-- five seat counters that disagreed with each other (see the long note in
-- `routers/org_invites.py`). The used figure is derived from
-- `staging.manav_employees` and `staging.user_roles` on every read, by
-- `services/seat_model.count_pahchan_seats`, and costs one query.
--
-- ── NULLABLE, WITH NO DEFAULT, AND THAT IS THE SAFE CHOICE ──────────────────
--
-- NULL means UNLIMITED, matching `max_users` and `plans.max_users` (measured
-- 2026-08-06: `organisations.max_users` is NULL for two of three live orgs and
-- 15 for Unicode Group; `plans.max_users` is NULL for six of seven plans). A
-- DEFAULT of any number would apply a cap to every existing organisation the
-- instant this runs, refusing hires at three live customers who never agreed to
-- one. The cap begins when Aekam types a number in.
--
-- A CHECK constraint rather than an unsigned type, because Postgres has no
-- unsigned integer: `max_pahchan_seats = 0` is a legitimate value meaning "this
-- org may not put anybody on the attendance roster", and negative is meaningless
-- in a way that would read as "unlimited but weirder" to
-- `PahchanSeatCount.is_full`.
--
-- ── LOCKS ──────────────────────────────────────────────────────────────────
--
-- `ADD COLUMN ... NULL` with no default and no rewrite: Postgres records it in
-- the catalogue only. It takes an ACCESS EXCLUSIVE lock on `staging.organisations`
-- for the duration of the catalogue write, which is sub-millisecond on a
-- three-row table, and it does NOT rewrite the heap. The CHECK constraint is
-- added in the same statement and is validated against the existing rows, all of
-- which will hold NULL and therefore pass trivially (a CHECK is satisfied when it
-- evaluates to NULL).
--
-- Wrapped in a transaction so a failure in either guard leaves the table exactly
-- as it was. Nothing here uses CONCURRENTLY, so there is no reason not to.

BEGIN;

-- ── GUARD 0 · the table this file is about ──────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION
            'staging.organisations does not exist. It is created by '
            '010_staging_schema_subscription.sql — apply that first.';
    END IF;
END $$;

-- ── GUARD 1 · the org-seat column this one is the counterpart to ────────────
--
-- Not decoration. If `max_users` is absent then migration 061 never ran here,
-- and this database is not the shape either half of the seat model expects —
-- `services/seat_model.py` and `routers/org_invites.count_seats` are written to
-- be read side by side, and shipping the attendance half onto a database with no
-- org half would leave a cap enforced on workers and none on users.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'staging'
          AND table_name = 'organisations'
          AND column_name = 'max_users'
    ) THEN
        RAISE EXCEPTION
            'staging.organisations.max_users is missing — 061_org_max_users.sql '
            'has not been applied to this database. The attendance seat cap is '
            'the counterpart to the org seat cap and must not be the only one.';
    END IF;
END $$;

-- ── The column ──────────────────────────────────────────────────────────────
-- IF NOT EXISTS makes the file replayable: run it twice and the second run does
-- nothing.
ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS max_pahchan_seats integer;

-- Separate statement, and guarded, because `ADD COLUMN IF NOT EXISTS` skips the
-- whole clause on a replay — including a CHECK written inline, which would then
-- never be created on a database where the column was added by hand first.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'organisations_max_pahchan_seats_non_negative'
          AND conrelid = 'staging.organisations'::regclass
    ) THEN
        ALTER TABLE staging.organisations
            ADD CONSTRAINT organisations_max_pahchan_seats_non_negative
            CHECK (max_pahchan_seats IS NULL OR max_pahchan_seats >= 0);
    END IF;
END $$;

COMMENT ON COLUMN staging.organisations.max_pahchan_seats IS
    'Attendance seats bought. NULL means unlimited, matching max_users. Counted '
    'separately from org seats by the owner''s decision of 2026-08-04: an '
    'employee who only clocks in must not cost what a full user costs. An '
    'employee LINKED to an account holding an org role in this org is exempt and '
    'costs no attendance seat — they are already paid for under max_users. What '
    'is USED is never stored; it is derived by '
    'services/seat_model.count_pahchan_seats.';

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- 1. The column exists and is nullable with no default:
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema='staging' AND table_name='organisations'
--         AND column_name='max_pahchan_seats';
--    Expect: integer, YES, NULL.
--
-- 2. Every existing org is still uncapped — applying this must refuse nobody:
--      SELECT name, max_users, max_pahchan_seats FROM staging.organisations;
--    Expect max_pahchan_seats NULL on every row.
--
-- 3. The CHECK actually refuses. In a transaction you ROLL BACK:
--      BEGIN;
--        UPDATE staging.organisations SET max_pahchan_seats = -1
--         WHERE id = (SELECT id FROM staging.organisations LIMIT 1);
--        -- expect: new row violates check constraint
--      ROLLBACK;
--
-- 4. The seat counter reads it. Before this file, it returned NULL through the
--    to_jsonb fallback; after, it returns the column:
--      SELECT (to_jsonb(o) ->> 'max_pahchan_seats')::int
--        FROM staging.organisations o WHERE o.name = 'Unicode Group';
--
-- 5. THIS FILE ALONE REFUSES NOBODY. The cap only binds once a number is typed
--    in, which is a commercial decision and not a migration. Measured read-only
--    2026-08-06, the roster each org would be billed for if capped today:
--    Aekam Inc 2, E2E Test & Associates 71, Unicode Group 7 — none of them
--    exempt, because manav_employees.user_id is NULL on all 81 rows.
