-- 101_employee_login_link_unique.sql
--
-- ONE LOGIN BELONGS TO ONE EMPLOYEE RECORD. THE DATABASE SHOULD BE THE ONE
-- SAYING SO, NOT A `SELECT` IN A PYTHON HANDLER.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change, exactly as 093–100 each say. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/101_employee_login_link_unique.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED, AND NOTHING DEPENDS ON IT. `routers/manav.link_refusal` already
-- refuses a second employee row pointing at an account another row holds, and
-- that check is the one the product runs. This file closes the gap that a
-- check-then-write in application code cannot: two admins linking the same
-- account in the same instant both read "free" and both write. The index makes
-- the second write fail instead of succeed.
--
-- ── WHY THIS MATTERS MORE THAN A DUPLICATE ROW USUALLY DOES ──────────────────
--
-- Three readers resolve a person from `user_id` and every one of them takes the
-- FIRST row it finds:
--
--   routers/manav.py     `_own_employee_id`   … WHERE user_id=$1 … LIMIT 1
--   routers/pahchan.py   `_employee_for`      … fetchrow, one row, unordered
--   routers/vetana.py    payslip ownership    compares e.user_id to the caller
--
-- With two rows carrying one `user_id`, "which employee am I" is answered by
-- whichever row the planner reached first. That is not stable across a plan
-- change, a VACUUM, or an index being added — so the same person's payslip,
-- attendance and leave balance can change between two requests with nothing in
-- the data looking wrong and nothing in the logs recording a change. It is the
-- worst class of bug this table can carry, because the symptom is intermittent
-- and the cause is invisible.
--
-- ── WHY IT IS SAFE TO ADD TODAY, AND WHY THAT WILL NOT LAST ──────────────────
--
-- Measured read-only against the live database on 2026-08-05, before the linking
-- endpoints shipped:
--
--     SELECT count(*) FILTER (WHERE user_id IS NOT NULL) FROM staging.manav_employees;
--     -- 0, out of 81 rows across 3 organisations
--
-- Zero rows carry a `user_id`, so there are no duplicates to resolve and the
-- index builds over nothing. Once HR starts linking people this stops being
-- true, and a duplicate created before the index exists BLOCKS the index from
-- being created afterwards. GUARD 1 below reports duplicates rather than failing
-- on them halfway, so the answer to "why did this not apply" is in the output
-- instead of in a Postgres error code.
--
-- ── PARTIAL, AND ON (org_id, user_id) ───────────────────────────────────────
--
-- `WHERE user_id IS NOT NULL` is not an optimisation. Without it the index still
-- permits any number of NULLs (Postgres treats NULLs as distinct in a unique
-- index), so it would behave identically — but it would also index all 81 rows
-- that carry nothing, and it would break the day somebody adds NULLS NOT
-- DISTINCT thinking it tidies things up. Stating the predicate makes the
-- intention "rows that have a link" rather than "rows".
--
-- Scoped to `org_id` and NOT to the account alone, deliberately. One person can
-- legitimately be an employee of two organisations on this platform — an
-- accountant on the books of two firms — and a global unique index on `user_id`
-- would refuse the second the moment it is real. What must never happen is two
-- records in the SAME organisation claiming one login, which is what every
-- reader above is scoped to.
--
-- Inactive rows are INCLUDED. A terminated employee still holds their account
-- until it is unlinked; excluding them would let a new record claim an account
-- an old record still points at, and `pahchan._employee_for` filters on
-- `is_active` while `_own_employee_id` and the payslip check reach rows the
-- other does not. Consistency here is cheaper than three predicates that have to
-- agree.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- `CREATE UNIQUE INDEX CONCURRENTLY`, so no write to `manav_employees` is
-- blocked while it builds. That is why this file has NO transaction wrapper:
-- CONCURRENTLY cannot run inside one, and psql would refuse it with "cannot run
-- inside a transaction block". Do not add BEGIN/COMMIT.
--
-- The cost of CONCURRENTLY is that a failure leaves an INVALID index behind
-- rather than nothing. It is not dropped automatically and it is not used by the
-- planner, but a later re-run of this file sees the name taken and skips. GUARD
-- 2 checks for exactly that and says what to do.

-- ── GUARD 0 · the table this file is about ──────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.manav_employees') IS NULL THEN
        RAISE EXCEPTION
            'staging.manav_employees does not exist. It is created by '
            '018_graha_ganit_manav.sql — apply that first.';
    END IF;
END $$;

-- ── GUARD 1 · duplicates would make the index un-creatable ──────────────────
DO $$
DECLARE
    dupes int;
BEGIN
    SELECT count(*) INTO dupes FROM (
        SELECT org_id, user_id
        FROM staging.manav_employees
        WHERE user_id IS NOT NULL
        GROUP BY org_id, user_id
        HAVING count(*) > 1
    ) d;

    IF dupes > 0 THEN
        RAISE EXCEPTION
            '% (org_id, user_id) pair(s) are already held by more than one '
            'employee record. The index cannot be created until each one is '
            'resolved. List them with: SELECT org_id, user_id, '
            'array_agg(id) FROM staging.manav_employees WHERE user_id IS NOT '
            'NULL GROUP BY 1,2 HAVING count(*) > 1; then unlink the wrong '
            'record via DELETE /api/v1/manav/employees/{id}/link.', dupes;
    END IF;
END $$;

-- ── GUARD 2 · an INVALID index left by a failed CONCURRENTLY run ────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'staging'
          AND c.relname = 'uq_manav_employee_login'
          AND NOT i.indisvalid
    ) THEN
        RAISE EXCEPTION
            'staging.uq_manav_employee_login exists but is INVALID — a previous '
            'CONCURRENTLY build failed partway. Drop it first: DROP INDEX '
            'CONCURRENTLY staging.uq_manav_employee_login;';
    END IF;
END $$;

-- ── The index ───────────────────────────────────────────────────────────────
-- IF NOT EXISTS makes the file replayable: run it twice and the second run does
-- nothing. `idx_manav_employees_user` (a plain, non-unique index on `user_id`
-- alone) already exists and is LEFT IN PLACE — it serves the three lookups that
-- query by user_id without an org_id in hand, which this composite index cannot.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_manav_employee_login
    ON staging.manav_employees (org_id, user_id)
    WHERE user_id IS NOT NULL;

COMMENT ON INDEX staging.uq_manav_employee_login IS
    'One login belongs to one employee record within an organisation. '
    'Enforces what routers/manav.link_refusal checks in application code, '
    'against the concurrent case that check cannot see. Partial: rows with no '
    'link are not indexed. Scoped to org_id because one person may legitimately '
    'be an employee of two organisations on this platform.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- 1. The index exists and is VALID:
--      SELECT indexrelid::regclass, indisvalid FROM pg_index
--       WHERE indexrelid = 'staging.uq_manav_employee_login'::regclass;
--    `indisvalid` must be true. False means the CONCURRENTLY build failed and
--    the index is enforcing nothing.
--
-- 2. It actually refuses a second claim. Do this in a transaction you ROLL BACK,
--    and only against a link that already exists:
--      BEGIN;
--        UPDATE staging.manav_employees SET user_id = (
--          SELECT user_id FROM staging.manav_employees
--           WHERE org_id = '<org>' AND user_id IS NOT NULL LIMIT 1)
--         WHERE id = '<some other employee in the same org>';
--        -- expect: duplicate key value violates unique constraint
--      ROLLBACK;
--
-- 3. Applying this changes no application behaviour by itself. `link_refusal`
--    already refuses the sequential case and returns a sentence naming the
--    employee who holds the account; this index turns the CONCURRENT case from
--    a silent second row into an asyncpg UniqueViolationError, which reaches the
--    caller as a 500. That is the correct trade — a 500 on a race is recoverable
--    and visible, a duplicate row is neither — but if the race is ever observed
--    in practice, the fix is to catch UniqueViolationError in
--    `link_employee_login` and re-raise it as the same 409 the check produces.
