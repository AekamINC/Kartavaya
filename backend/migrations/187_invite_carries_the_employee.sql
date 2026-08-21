-- 187 · The invitation remembers which employee it was for.
--
--       WRITTEN, NOT APPLIED. Nothing in this repository has run this file, and
--       no application code applies it. See "HOW TO APPLY" below.
--
-- ── THE PROBLEM, MEASURED ───────────────────────────────────────────────────
--
-- `staging.manav_employees.user_id` is the ONLY join between the personnel side
-- of this product (keyed on an EMPLOYEE) and the money and permissions side
-- (keyed on an ACCOUNT). Payslips, attendance, leave and expense claims are
-- keyed on the employee; commission, targets, revenue attribution and every
-- module grant are keyed on the account.
--
-- Measured read-only against the live database on 2026-08-21
-- (`railway run -e staging -s Kartavya`, SELECT only, statement_cache_size=0):
--
--     SELECT count(*), count(user_id), count(DISTINCT org_id)
--       FROM staging.manav_employees;
--     -- 98 rows, 0 linked, 3 organisations
--
--     SELECT count(*) FROM public.invites;                    -- 34
--     SELECT count(*) FROM public.invites WHERE org_id IS NOT NULL;  -- 19
--     SELECT count(*) FROM public.invites
--      WHERE accepted_at IS NULL AND expires_at > NOW();      -- 0 pending
--
-- Ninety-eight employees, nought links. A linking screen shipped on 20 August
-- that lets an admin make the join by hand, and it surfaced the real shape of
-- the problem rather than solving it: the largest organisation has 71 employees
-- and 7 accounts, so MOST OF THOSE LINKS CANNOT BE MADE. There is no account on
-- the other end to point at.
--
-- The owner's correction is that most of them should never have one. A Pahchan
-- attendance-only worker punches in on a shared device; they are an employee of
-- the firm and they are not a user of this software. The people who DO need to
-- sign in should be invited at the moment their employee record is created, and
-- the account that results should link itself when the invitation is accepted.
--
-- For the invitation to do that, it has to remember which employee record it
-- came from. That is this column and nothing else.
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--
--   ADDS     public.invites.employee_id  (UUID, NULLABLE, no default)
--   ADDS     ONE named CHECK constraint, as its own guarded
--            `ALTER TABLE … ADD CONSTRAINT` — never inline on the ADD COLUMN,
--            see THE INLINE TRAP below.
--   CREATES  ONE partial index on the new column.
--   COMMENTS on the new column.
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--   BACKFILLS NOTHING — in particular it does not touch any of the 98 employee
--            rows, and it writes no `user_id` anywhere.
--   ADDS NO FOREIGN KEY. That is a decision, and it is argued below.
--   DROPS nothing, renames nothing, alters no existing column, and touches no
--            table other than `public.invites`.
--
-- IF IT RUNS TWICE: nothing happens. The column is ADD COLUMN IF NOT EXISTS,
-- the constraint is added inside a NOT EXISTS guard against `pg_constraint`,
-- the index is IF NOT EXISTS, and there is no seed and no backfill. A second
-- run cannot write a row and therefore cannot fabricate a link.
--
-- ── THE INLINE TRAP (why the CHECK is a separate statement) ─────────────────
--
-- `ALTER TABLE … ADD COLUMN IF NOT EXISTS employee_id UUID CHECK (…)` is a trap
-- that has already cost this codebase a constraint it believed it had. When the
-- column ALREADY EXISTS, Postgres skips THE WHOLE CLAUSE — column and CHECK
-- together — and reports success. The migration then reads as applied, the
-- ledger says applied, and `pg_constraint` has no row. The only trustworthy
-- answer to "is this constraint on the table" is a read of `pg_constraint`,
-- which is what the guard and the VERIFY block below both do.
--
-- ── THE FOREIGN KEY DECISION: THERE IS NO FOREIGN KEY, AND HERE IS WHY ──────
--
-- The obvious shape is
--     employee_id UUID REFERENCES staging.manav_employees(id) ON DELETE …
-- and it is genuinely defensible. The case FOR it is real and is stated first,
-- because an unargued answer here is worth nothing:
--
--   · CROSS-SCHEMA IS NOT NOVEL HERE. Measured on the same probe: this database
--     already carries 26 foreign keys that cross the public/staging boundary —
--     twenty-five from `staging.*` into `public.users`, and one going the same
--     direction this would go, `public.org_settings.org_id →
--     staging.organisations(id)`. "It couples two schemas" is therefore not by
--     itself an objection; the coupling exists and is load-bearing.
--   · A DANGLING POINTER IS A REAL THING. Nothing would stop an invite carrying
--     an `employee_id` for a row that no longer exists, or for a row in a
--     different organisation entirely.
--
-- It is still the wrong answer, for four reasons, in ascending order of weight.
--
--   1. `public.invites` HAS NO FOREIGN KEYS AT ALL TODAY. Measured: the only
--      constraints on it are `invites_pkey` (invite_id) and `invites_token_key`
--      (token). Its `org_id uuid` does NOT reference `staging.organisations`,
--      and `invited_by` does NOT reference `public.users`, although both are
--      more load-bearing pointers than this one — `org_id` decides which
--      organisation an accepted invite puts a person into. Giving the newest
--      and least important column a stricter contract than the two beside it
--      does not make the table safer; it makes the table inconsistent, and it
--      invites the next reader to conclude the older columns are broken and
--      "fix" them, which is a very different migration with a very different
--      risk.
--
--   2. EVERY AVAILABLE `ON DELETE` ACTION IS WRONG.
--        ON DELETE CASCADE  — deleting an employee record would DELETE THE
--          INVITATION. That destroys the audit trail of who invited whom, and
--          it silently kills a live invite link: somebody halfway through
--          setting a password gets "this invite is invalid" and no explanation
--          exists anywhere. The first rule of this repository is NEVER DELETE
--          ANYTHING, and a cascade is a delete somebody else's DELETE performs
--          on your behalf.
--        ON DELETE SET NULL — quietly rewrites history. The invitation then
--          claims it was never for anybody, which is false, and the acceptance
--          path cannot tell "there was no employee" from "there was one and it
--          is gone".
--        ON DELETE RESTRICT / NO ACTION — makes deleting an employee record
--          FAIL because of a seven-day-old invitation in a different schema.
--          HR presses Delete, gets a 500, and the reason is in a table they
--          have never heard of.
--      There is no fifth option. When no referential action is correct, the
--      relationship is not a foreign key.
--
--   3. IT INVERTS THE DEPENDENCY THE AUTH PATH CAN AFFORD. `public.invites` is
--      read by `POST /auth/accept-invite` on every acceptance, including
--      platform-console invitations that belong to NO organisation and have
--      nothing to do with HR. An FK would make the global authentication table
--      depend on a per-tenant HRMS table: `DELETE FROM staging.manav_employees`
--      would take a lock that the login path's table participates in, for ever,
--      to protect a column that is NULL on 34 of 34 rows today.
--
--   4. THE INTEGRITY IT WOULD BUY IS ALREADY BOUGHT, AND MORE CHEAPLY. The
--      acceptance path's UPDATE is
--          UPDATE staging.manav_employees SET user_id = $1
--           WHERE id = $2::uuid AND org_id = $3::uuid AND user_id IS NULL
--      — scoped by BOTH the employee id and the organisation from the invite,
--      and required to treat "nought rows updated" as an ordinary outcome
--      rather than an error. A pointer to an employee that has been deleted, or
--      that was never in this organisation, therefore updates nothing and costs
--      nothing. The dangling reference is inert BY CONSTRUCTION, and paying for
--      it with a cross-schema delete-time lock is a bad trade.
--
-- WHAT REPLACES IT is the one invariant that is genuinely worth enforcing in
-- the database, `invites_employee_needs_org` below: an employee_id may only
-- appear on an invite that names an organisation. That is not decoration. The
-- acceptance UPDATE is org-scoped, so an `employee_id` with a NULL `org_id`
-- could NEVER link anything — it would be a promise the schema guarantees to
-- break. Refusing it at write time turns a silent no-op into a loud refusal.
--
-- ── WHY THE INDEX IS NOT UNIQUE ─────────────────────────────────────────────
--
-- "One employee, one invitation" is tempting and every formulation of it as a
-- unique index is wrong:
--
--   · UNIQUE (employee_id) WHERE employee_id IS NOT NULL — an employee could
--     never be re-invited after the first invitation expired. Superseding an
--     invite in this product sets `expires_at = NOW()`; it does not delete the
--     row and does not set `accepted_at`. So the dead invitation would block
--     the replacement for ever.
--   · … AND accepted_at IS NULL AND expires_at > NOW() — `NOW()` is not
--     IMMUTABLE and cannot appear in an index predicate. Postgres refuses it.
--   · … AND accepted_at IS NOT NULL — indexable, and it creates a dead end.
--     Acceptance stamps `accepted_at` BEFORE the link is attempted, and the
--     link is allowed to fail (see below). An accepted-but-unlinked invitation
--     would then permanently block anybody else being invited for that employee,
--     with no way out but a manual UPDATE on a production table.
--
-- The uniqueness that actually matters is already enforced, in the right place,
-- by migration 101: `uq_manav_employee_login`, a partial UNIQUE index on
-- `staging.manav_employees (org_id, user_id) WHERE user_id IS NOT NULL`.
-- CONFIRMED PRESENT ON THE LIVE TABLE by the same probe. One account belongs to
-- at most one employee record per organisation, and that index — not this one —
-- is what refuses a second link. When it refuses at acceptance time, the person
-- must still end up signed in: the refusal is logged and the employee is left
-- unlinked for the repair screen, because somebody who has just set a password
-- must not be turned away over a bookkeeping collision they cannot see.
--
-- So the index here is a PLAIN partial index, and it exists for one read: "does
-- this employee have an invitation outstanding", asked by the employee
-- directory so it can say so instead of offering to invite them twice.
--
-- ── WHAT HAPPENS ON THE DAY ─────────────────────────────────────────────────
--
-- Nothing observable. The column is nullable with NO DEFAULT, so this is a
-- catalogue-only change: Postgres 11+ does not rewrite the table for a nullable
-- column with no default, and even a rewrite would be over 34 rows. Every
-- existing invitation keeps NULL, which is exactly what it means — it was for a
-- person, not for an employee record.
--
-- The application code that reads this column is written to survive its
-- absence: the employee-create path REFUSES the "create a login" tick with a
-- named 503 that says this file has not been applied, and leaves every other
-- part of creating an employee untouched. So the state before this migration is
-- "the checkbox does not work yet and says so", not "the checkbox is broken".
-- Unticked, nothing about creating an employee changes at all, before or after.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One ALTER TABLE ADD COLUMN (nullable, no default) and one ALTER TABLE ADD
-- CONSTRAINT, both taking ACCESS EXCLUSIVE on `public.invites` until COMMIT,
-- plus one CREATE INDEX taking SHARE. `public.invites` is 34 rows and is read
-- by `POST /auth/accept-invite` and by the org invites list.
--
-- The exposure is ACQUISITION, not work: the ALTERs queue behind any open
-- transaction touching `invites`, and while they queue everything else queues
-- behind them. `lock_timeout` turns that into a clean rollback after five
-- seconds rather than a stall on the table the login-acceptance path reads.
-- The CHECK is validated against 34 rows, all of which have NULL in the new
-- column, so the validation itself is free.
--
-- STAGING AND PRODUCTION SHARE ONE DATABASE AND ONE `public` SCHEMA, and
-- PRODUCTION READS `public.invites` ON EVERY INVITE ACCEPTANCE. Applying this
-- file is a production change.
--
-- HOW TO APPLY (by hand, and only by hand):
--     psql "$DATABASE_URL" -f backend/migrations/187_invite_carries_the_employee.sql
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   BEGIN;
--     ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_employee_needs_org;
--     DROP INDEX IF EXISTS public.idx_invites_employee;
--     ALTER TABLE public.invites DROP COLUMN IF EXISTS employee_id;
--   COMMIT;
--
-- Safe while no invitation carries an employee_id — which is every invitation
-- until somebody ticks the box. Check first, and do not drop the column if the
-- answer is not zero, because dropping it discards the only record of which
-- employee each pending invitation was for:
--
--     SELECT count(*) FROM public.invites WHERE employee_id IS NOT NULL;
--
-- If that is non-zero, the honest rollback is to drop the CONSTRAINT and the
-- INDEX and LEAVE THE COLUMN. A nullable column nothing reads is inert; the
-- employee-create path already refuses the tick when the column is missing, and
-- the acceptance path already treats a NULL employee_id as "an ordinary
-- invitation". Nothing in the product breaks with the column present and
-- unread. NEVER DELETE ANYTHING.


BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ── GUARD 0 · the table this file alters ────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('public.invites') IS NULL THEN
        RAISE EXCEPTION
            'public.invites does not exist. This file adds a column to it; it '
            'does not create it. NOTE THE SCHEMA: invites lives in `public`, '
            'not in `staging`, unlike almost everything else this product '
            'writes.';
    END IF;
END $$;


-- ── GUARD 1 · the thing the new column points at ────────────────────────────
--
-- Not a foreign key — see the header for the four reasons — but the column is
-- meaningless without the table, and a pointer into a table that does not exist
-- is a column nobody can interpret later.
DO $$
BEGIN
    IF to_regclass('staging.manav_employees') IS NULL THEN
        RAISE EXCEPTION
            'staging.manav_employees does not exist. invites.employee_id holds '
            'an id from that table; without it this column means nothing.';
    END IF;
END $$;


-- ── GUARD 2 · the types must agree, or the link silently never matches ──────
--
-- `manav_employees.id` is UUID and `manav_employees.user_id` is TEXT (matching
-- `public.users.user_id`, also TEXT). Both halves are asserted because the
-- acceptance path writes the second using the first, and because the sibling
-- tables `staging.sales_commissions.user_id` and
-- `staging.sales_commission_assignments.user_id` are UUID — they are joined to
-- a TEXT account id and are therefore already broken. A type mismatch here
-- would not raise; it would simply never match a row, and the symptom would be
-- "the link quietly does not happen", which is the hardest possible thing to
-- notice.
DO $$
DECLARE
    id_type   TEXT;
    user_type TEXT;
BEGIN
    SELECT data_type::text INTO id_type
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'manav_employees'
       AND column_name = 'id';
    IF id_type IS DISTINCT FROM 'uuid' THEN
        RAISE EXCEPTION
            'staging.manav_employees.id is %, expected uuid. invites.employee_id '
            'is declared UUID to match it.', COALESCE(id_type, '<missing>');
    END IF;

    SELECT data_type::text INTO user_type
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'manav_employees'
       AND column_name = 'user_id';
    IF user_type IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION
            'staging.manav_employees.user_id is %, expected text. Acceptance '
            'writes public.users.user_id (text) into it; a uuid column there '
            'would never match and the failure would be silent.',
            COALESCE(user_type, '<missing>');
    END IF;
END $$;


-- ── GUARD 3 · migration 101 must already be in place ────────────────────────
--
-- `uq_manav_employee_login` is what refuses a second employee record claiming
-- an account that another record in the same organisation already holds. This
-- file's whole point is to create links automatically, and creating links
-- automatically without that index means two acceptances racing both read
-- "free" and both write. CONFIRMED PRESENT on 2026-08-21; the guard is here so
-- that a database restored from before 101 cannot get this feature without it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'staging'
           AND tablename  = 'manav_employees'
           AND indexname  = 'uq_manav_employee_login'
    ) THEN
        RAISE EXCEPTION
            'uq_manav_employee_login is missing — apply '
            'migrations/101_employee_login_link_unique.sql first. Without it, '
            'two invitations accepted in the same instant can both link to one '
            'account, and three readers (manav._own_employee_id, '
            'pahchan._employee_for, vetana payslip ownership) then answer '
            '"which employee am I" from whichever row the planner reached '
            'first.';
    END IF;
END $$;


-- ── The row count BEFORE anything is altered ────────────────────────────────
--
-- Captured into a temp table rather than a variable because the VERIFY block
-- below is a separate DO block and cannot see this one's locals. ON COMMIT DROP
-- so it leaves nothing behind, and it rolls back with the transaction if the
-- verification fails. This file must not change how many invitations exist.
CREATE TEMP TABLE _m187_before ON COMMIT DROP AS
SELECT count(*) AS n FROM public.invites;


-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The column
-- ═════════════════════════════════════════════════════════════════════════════

-- NULLABLE and NO DEFAULT, both deliberate.
--
-- NULL is the correct value for every invitation that exists and for most that
-- ever will: a platform-console invite belongs to no organisation, and an org
-- invite sent from Settings → Members is an invitation to a PERSON, with no
-- personnel record behind it. NULL here reads as "this invitation was not
-- raised from an employee record", which is true.
--
-- No default, because a default on this column could only ever be a lie — there
-- is no employee it would be right to guess.
--
-- NO INLINE CHECK. See THE INLINE TRAP in the header: on a re-run where the
-- column already exists, Postgres skips this entire clause, and an inline CHECK
-- would go with it while the file still reported success.
ALTER TABLE public.invites
    ADD COLUMN IF NOT EXISTS employee_id UUID;

COMMENT ON COLUMN public.invites.employee_id IS
    'The staging.manav_employees row this invitation was raised from, or NULL. '
    'Set only when an HR admin ticked "this person needs a login" while '
    'creating an employee; NULL on every invitation sent from Settings and on '
    'every platform-console invitation. On acceptance the account that is '
    'created is written back to that employee row''s user_id, scoped by BOTH '
    'this id and the invite''s org_id. DELIBERATELY NOT A FOREIGN KEY — see '
    'migrations/187 for the argument. A dangling value is inert: the acceptance '
    'UPDATE simply matches no row, which is a supported outcome, and the '
    'acceptance still succeeds because somebody who has just set a password '
    'must end up signed in.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · The one invariant worth enforcing here
-- ═════════════════════════════════════════════════════════════════════════════

-- An employee belongs to an organisation, and the acceptance UPDATE is scoped
-- by `org_id` as well as by the employee id. So an employee_id sitting on an
-- invitation with a NULL org_id is a pointer that CANNOT EVER BE FOLLOWED —
-- a promise the schema itself guarantees to break. Refuse it at write time so
-- the failure is a loud constraint violation instead of a silent no-op nobody
-- ever traces.
--
-- Its own ALTER, inside a NOT EXISTS guard against pg_constraint, and never
-- inline on the ADD COLUMN above.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.invites'::regclass
           AND conname  = 'invites_employee_needs_org'
    ) THEN
        ALTER TABLE public.invites
            ADD CONSTRAINT invites_employee_needs_org
            CHECK (employee_id IS NULL OR org_id IS NOT NULL);
    END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · The index
-- ═════════════════════════════════════════════════════════════════════════════

-- PLAIN, NOT UNIQUE — the header argues all three unique formulations and why
-- each is wrong. Uniqueness of the LINK is migration 101's job and is enforced
-- on the employee table, where it belongs.
--
-- Partial, because this column is NULL on 34 of 34 rows today and will stay
-- NULL on the majority for ever: most employees are Pahchan-only and are never
-- invited to anything. Indexing the NULLs would be indexing the whole table to
-- find the handful of rows that carry a value.
--
-- The one read it serves: "does this employee already have an invitation out",
-- so the directory can say so rather than offer to invite the same person a
-- second time.
CREATE INDEX IF NOT EXISTS idx_invites_employee
    ON public.invites (employee_id)
    WHERE employee_id IS NOT NULL;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · VERIFY, in the same transaction. If any of this is false the whole apply
--     rolls back and `public.invites` is exactly as it was.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    col_type     TEXT;
    col_nullable TEXT;
    col_default  TEXT;
    n            INTEGER;
    before_n     BIGINT;
    after_n      BIGINT;
BEGIN
    -- 4a · the column is there, and is the shape this file promised. Three
    --      scalars rather than a %ROWTYPE over an information_schema view:
    --      those columns are domains over `name` and `character_data`, and a
    --      composite of them is awkward to compare against a text literal.
    SELECT data_type::text, is_nullable::text, column_default::text
      INTO col_type, col_nullable, col_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'invites'
       AND column_name = 'employee_id';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'public.invites.employee_id was not created';
    END IF;
    IF col_type <> 'uuid' THEN
        RAISE EXCEPTION
            'public.invites.employee_id is %, expected uuid — it holds '
            'staging.manav_employees.id', col_type;
    END IF;
    IF col_nullable <> 'YES' THEN
        RAISE EXCEPTION
            'public.invites.employee_id is NOT NULL. Every invitation that '
            'exists, and most that ever will, legitimately has no employee '
            'behind it.';
    END IF;
    IF col_default IS NOT NULL THEN
        RAISE EXCEPTION
            'public.invites.employee_id has a default (%). There is no employee '
            'it would be right to guess.', col_default;
    END IF;

    -- 4b · the CHECK is really on the table. THE INLINE TRAP is why this is a
    --      read of pg_constraint and not a reading of the file above.
    SELECT count(*) INTO n
      FROM pg_constraint
     WHERE conrelid = 'public.invites'::regclass
       AND conname  = 'invites_employee_needs_org'
       AND contype  = 'c';
    IF n <> 1 THEN
        RAISE EXCEPTION
            'invites_employee_needs_org is not on the table (found %). An '
            'employee_id with no org_id can never be followed: the acceptance '
            'UPDATE is scoped by org_id.', n;
    END IF;

    -- 4c · NO FOREIGN KEY WAS CREATED, on this column or on any other. This is
    --      the property the header spends its longest section on, so it is
    --      asserted rather than assumed — a later hand adding one would change
    --      what DELETE on staging.manav_employees does, in a file that claims
    --      it does not.
    SELECT count(*) INTO n
      FROM pg_constraint
     WHERE conrelid = 'public.invites'::regclass
       AND contype  = 'f';
    IF n <> 0 THEN
        RAISE EXCEPTION
            'public.invites now carries % foreign key(s). This file adds none, '
            'and the table had none before it (measured 2026-08-21: only '
            'invites_pkey and invites_token_key).', n;
    END IF;

    -- 4d · the index exists and is NOT unique.
    SELECT count(*) INTO n
      FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'invites'
       AND indexname  = 'idx_invites_employee';
    IF n <> 1 THEN
        RAISE EXCEPTION 'idx_invites_employee is missing';
    END IF;

    SELECT count(*) INTO n
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_invites_employee' AND i.indisunique;
    IF n <> 0 THEN
        RAISE EXCEPTION
            'idx_invites_employee is UNIQUE. It must not be: superseding an '
            'invite sets expires_at rather than deleting the row, so a unique '
            'index here would stop an employee ever being re-invited.';
    END IF;

    -- 4e · THE APPLY WROTE NO ROW. Same number of invitations as before, and
    --      not one of them carries an employee. If either is false the whole
    --      transaction rolls back — this file adds a column, it does not
    --      backfill, and a backfill here would invent links between people who
    --      have never been connected.
    SELECT n INTO before_n FROM _m187_before;
    SELECT count(*) INTO after_n FROM public.invites;
    IF after_n <> before_n THEN
        RAISE EXCEPTION
            'the invitation count changed during this migration (% -> %). This '
            'file writes no rows.', before_n, after_n;
    END IF;

    SELECT count(*) INTO n FROM public.invites WHERE employee_id IS NOT NULL;
    IF n <> 0 THEN
        RAISE EXCEPTION
            'an invitation already carries an employee_id (% rows) immediately '
            'after the column was created. Nothing in this file backfills, so '
            'something else wrote during the apply — roll back and find out '
            'what.', n;
    END IF;

    -- 4f · the 98 employee rows are untouched and STILL UNLINKED. This file
    --      does not link anybody and must not appear to have.
    SELECT count(*) INTO n
      FROM staging.manav_employees WHERE user_id IS NOT NULL;
    RAISE NOTICE
        'employee records carrying a login, before and after this migration: % '
        '(measured 0 of 98 on 2026-08-21; this file changes it by design not '
        'at all)', n;
END $$;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. THE COLUMN, AND ITS SHAPE.
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='invites'
--         AND column_name='employee_id';
--    Expect: employee_id | uuid | YES | NULL

-- 2. NOTHING WAS WRITTEN AND NOBODY WAS LINKED.
--      SELECT count(*) FROM public.invites;                              -- 34
--      SELECT count(*) FROM public.invites WHERE employee_id IS NOT NULL; -- 0
--      SELECT count(user_id) FROM staging.manav_employees;                -- 0

-- 3. THERE IS STILL NO FOREIGN KEY ON invites.
--      SELECT conname, contype, pg_get_constraintdef(oid)
--        FROM pg_constraint WHERE conrelid='public.invites'::regclass;
--    Expect exactly three: invites_pkey (p), invites_token_key (u),
--    invites_employee_needs_org (c). No row with contype='f'.

-- 4. AN EMPLOYEE POINTER WITH NO ORGANISATION IS REFUSED.
--      BEGIN;
--        UPDATE public.invites
--           SET employee_id = gen_random_uuid()
--         WHERE org_id IS NULL
--         LIMIT 1;                    -- expect: violates invites_employee_needs_org
--      ROLLBACK;
--    (`LIMIT` is not valid on UPDATE; use `WHERE invite_id = (SELECT invite_id
--     FROM public.invites WHERE org_id IS NULL LIMIT 1)`. Written out here so
--     nobody pastes the short form and reads the syntax error as a pass.)

-- 5. AN ORG-SCOPED INVITATION MAY CARRY ONE.
--      BEGIN;
--        UPDATE public.invites SET employee_id = gen_random_uuid()
--         WHERE invite_id = (SELECT invite_id FROM public.invites
--                             WHERE org_id IS NOT NULL LIMIT 1);
--        -- expect: UPDATE 1, and NO foreign key error even though that uuid
--        -- names no employee. A dangling pointer is inert by design.
--      ROLLBACK;

-- 6. MIGRATION 101 IS STILL THE THING THAT ENFORCES ONE-ACCOUNT-ONE-EMPLOYEE.
--      SELECT indexdef FROM pg_indexes
--       WHERE schemaname='staging' AND tablename='manav_employees'
--         AND indexname='uq_manav_employee_login';
--    Expect: … UNIQUE … (org_id, user_id) WHERE (user_id IS NOT NULL)


-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
--
-- NO FOREIGN KEY to staging.manav_employees. Four reasons, argued at length in
-- the header; the shortest of them is that every available ON DELETE action is
-- wrong, and when no referential action is correct the relationship is not a
-- foreign key.
--
-- NO BACKFILL. Not one of the 98 employee rows is read, and no `user_id` is
-- written anywhere. There is no email overlap between employee records and
-- accounts to backfill FROM — measured — and inventing links between people who
-- have never been connected is how somebody else's payslip becomes readable.
--
-- NO UNIQUE INDEX on employee_id. Uniqueness of the link lives on
-- staging.manav_employees, in migration 101, and a unique index here would
-- instead prevent re-invitation and create an unrecoverable dead end after a
-- link refusal.
--
-- NO NOT NULL, NO DEFAULT, NO CHANGE TO ANY EXISTING COLUMN. `org_id`,
-- `member_role`, `module_grants`, `token` and `expires_at` all keep the exact
-- types, defaults and nullability they have today.
--
-- NO SECOND INVITE TABLE, and no `manav_invites`. There is one invitation
-- machinery in this product — `routers/org_invites.issue_invite` — and it is
-- the only thing that counts an organisation's seats while it works. A second
-- one would be a second seat counter, which is the exact defect
-- `org_invites.py` was written to end.
--
-- NOTHING IS ARMED. No cron reads this column, no trigger fires on it, and the
-- employee-create path refuses the tick outright until this file is applied.
