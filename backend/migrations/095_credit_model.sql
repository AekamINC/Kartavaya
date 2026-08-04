-- 095_credit_model.sql
--
-- ONE CREDIT LEDGER. Two buckets, one number; a per-member CEILING that is not
-- a second wallet; one price list; and an idempotent ledger that can be
-- reconciled to a balance. Settled by the owner 2026-08-04.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Read that sentence twice, as 093 and 094
-- also ask you to. Apply by hand, in a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/095_credit_model.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- Additive only. No DROP, no ALTER … TYPE, no SET NOT NULL on an existing
-- column, no generated columns, no destructive rewrite of a money column.
--
-- ── THE MODEL, so the SQL below is legible ──────────────────────────────────
--
--   · The balance is TWO BUCKETS, ONE NUMBER.
--       allowance  — the monthly grant. Reset each period. NO carry-over.
--       purchased  — a paid top-up. Carries over indefinitely.
--     A spend draws ALLOWANCE FIRST, so the credits the client actually paid
--     for survive the month roll. Today's roll is `SET balance = $1`
--     (services/ai_router.py:696) and annihilates them, then writes a ledger
--     row calling it a reset.
--
--   · A member allocation is a CEILING ON THE SHARED ORG BALANCE, never a
--     second wallet. Nothing is ever debited from a member. A member who runs
--     out asks the org to raise the ceiling; the org that runs out asks Aekam.
--
--   · Aekam's own platform org skips THE ORG BALANCE CHECK AND NOTHING ELSE.
--     Member ceilings still apply and every spend is still written to the
--     ledger. Metering is for visibility, not for charging.
--
-- ── WHY `balance` IS NOT A GENERATED COLUMN ─────────────────────────────────
--
-- Postgres cannot convert an existing column into GENERATED ALWAYS AS … STORED
-- in place; it would take DROP COLUMN balance + ADD COLUMN balance, which is
-- destructive DDL on a money column and a full rewrite. Worse, a generated
-- column cannot be the target of UPDATE, and tests/test_scraper_refund.py:44
-- string-matches the literal "UPDATE staging.hub_org_credits SET balance=" —
-- so that test, and every legacy writer not yet converted, would hard-error the
-- moment this file landed, before the application changes ship.
--
-- `balance` therefore survives as a plain INTEGER and is the maintained sum.
-- services/credits.py sets all three columns in one statement:
--     SET allowance_balance = $1, purchased_balance = $2, balance = $1 + $2
--
-- No CHECK (balance = allowance_balance + purchased_balance) is added, and that
-- is deliberate rather than an oversight. Even NOT VALID, a CHECK enforces on
-- every new UPDATE, so it would reject the legacy writers during the window
-- between this migration and the last converted caller. Drift is caught by
-- staging.v_org_credit_drift at the bottom of this file instead — a report you
-- can read, not a constraint that takes the product down at 3am.
--
-- ── DEPLOY ORDER — THE ONE THING THAT CAN LOSE MONEY HERE ───────────────────
--
-- This migration is safe to apply before the application changes EXCEPT across
-- a month boundary. Until services/ai_router._maybe_reset_monthly_credits is
-- replaced by the shim, it is still live, it still does `SET balance = $1`, and
-- it knows nothing about the two new columns. If it fires after this file lands
-- it will:
--     · overwrite `balance` without touching allowance_balance or
--       purchased_balance, putting the row in v_org_credit_drift immediately;
--     · destroy the purchased balance that section 2 below just preserved.
-- It only fires when `credits_reset_at` falls in an earlier calendar month, so
-- the window is a month roll. Do not leave this migration applied and the
-- application unshipped across the end of a month. If you must, watch
-- v_org_credit_drift.
--
-- ── EVERY PYTHON LINE NUMBER BELOW IS ANCHORED TO COMMIT c3ce1345 ──────────
--
-- Six agents are editing backend/ while this file is being written, so the
-- application line numbers move hourly. They are quoted as they stood at
-- c3ce1345, the commit this programme was specified against, and every one was
-- re-derived from `git show c3ce1345:` rather than from the working tree. Where
-- a number and a symbol name disagree in future, TRUST THE SYMBOL NAME.
--
-- ── ROW COUNTS THIS ANALYSIS ASSUMES (verified 2026-08-04) ──────────────────
--     staging.hub_org_credits               3 rows
--     staging.hub_org_credit_transactions 171 rows
--     staging.hub_credit_wallets           53 rows  (touched only by a COMMENT)
--     staging.hub_user_credits              small
--     staging.organisations                 3 rows
--     staging.hub_scraper_catalog          22 rows  (not touched here)
--     staging.hub_skill_templates          19 rows  (not touched here)
--
-- ── HOW TO READ THE LOCK NOTES ──────────────────────────────────────────────
--
-- Each statement is annotated with the lock it takes. Two things are true of
-- ALL of them and are not repeated at every line:
--
--   1. THIS IS ONE TRANSACTION, SO EVERY LOCK IS HELD UNTIL COMMIT. The
--      per-statement note describes how long the statement takes to ACQUIRE and
--      do its work, not how long the lock is held. The AccessExclusiveLock that
--      the first ALTER takes on hub_org_credits is held for the whole file. At
--      these row counts the whole file is well under a second, which is why one
--      transaction is the right shape: partial application of a money schema is
--      far worse than a sub-second write block.
--
--   2. THE RISK IS ACQUISITION, NOT WORK. An AccessExclusiveLock request that
--      has to queue behind someone else's open transaction also blocks every
--      reader that arrives after it — so a single stuck session turns a
--      millisecond migration into a credit-system outage. Every debit in this
--      codebase is sub-second and none of them idles in a transaction, so there
--      should be nothing to queue behind. The lock_timeout below makes that a
--      fast, clean rollback instead of a hope.

BEGIN;

-- Fail fast rather than freeze the product. Without lock_timeout, the first
-- ALTER waits indefinitely for its AccessExclusiveLock and every credit read
-- that arrives behind it waits too. Five seconds is far longer than any
-- honest transaction on these tables. SET LOCAL — scoped to this transaction,
-- reverted at COMMIT, changes nothing for anyone else.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ════════════════════════════════════════════════════════════════════════════
-- GUARD 0 — THE LIVE TABLE DOES NOT MATCH ITS OWN MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- migrations/052_org_credit_tables.sql:7-11 and the startup DDL at
-- server.py:3497-3501 both declare:
--     org_id UUID PRIMARY KEY REFERENCES staging.organisations(id) …
-- The live table is (id, org_id, balance, monthly_allocation, last_refill_at,
-- created_at, updated_at, credits_reset_at) — it carries an `id` column that
-- 052 never declared and no migration in this folder ever added. Its shape is
-- character-for-character the shape of staging.hub_credit_wallets
-- (011_hub_foundation.sql:60-68) with client_id swapped for org_id, so it was
-- created out of band by copying that table.
--
-- The consequence is the one that matters: the CREATE TABLE IF NOT EXISTS has
-- NEVER DONE ANYTHING on this database, `org_id` is therefore probably not the
-- primary key, and it may carry no unique constraint at all. Every
-- INSERT … ON CONFLICT (org_id) in the new services/credits.py depends on one.
-- Section 4 creates it. This guard is what stops that CREATE UNIQUE INDEX from
-- discovering a duplicate for us — because at that point the only honest
-- question is "which of these two rows holds the customer's real balance?", and
-- a migration must never guess at that.
DO $$
DECLARE dupes INT;
BEGIN
    SELECT COUNT(*) INTO dupes FROM (
        SELECT org_id FROM staging.hub_org_credits
        GROUP BY org_id HAVING COUNT(*) > 1
    ) d;
    IF dupes > 0 THEN
        RAISE EXCEPTION
          'ABORT: % org_id value(s) appear more than once in staging.hub_org_credits. '
          'Merge them by hand before applying 095 — this migration must not '
          'guess which row holds the real balance.', dupes;
    END IF;
END $$;
-- Lock: AccessShareLock on hub_org_credits, 3 rows. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- GUARD 1 — CAN SECTION 3'S INSERT ACTUALLY RUN?
-- ════════════════════════════════════════════════════════════════════════════
--
-- Not in the original spec; added because GUARD 0's finding implies it.
--
-- Section 3 inserts a wallet row naming only the columns this migration knows
-- about. The live table has columns no migration in this repo declared — `id`,
-- `created_at`, `monthly_allocation`, `last_refill_at`. If any of those is
-- NOT NULL with no default, that INSERT fails, and it fails AFTER the ALTERs
-- have taken their AccessExclusiveLock. The transaction rolls back cleanly, so
-- nothing is corrupted, but you would be reading a null-violation on a column
-- name that appears nowhere in this file and wondering what you broke.
--
-- So we ask the catalog first and say the name out loud. `id` is called out
-- separately because it is both the likely culprit and the one with a safe,
-- catalog-only remedy: hub_credit_wallets declares
-- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, and if hub_org_credits was
-- copied from it without the default, restoring the default is additive,
-- instant, and exactly what the surrounding tables already do.
DO $$
DECLARE
    id_needs_default BOOLEAN;
    offender TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'staging' AND table_name = 'hub_org_credits'
           AND column_name  = 'id'
           AND is_nullable  = 'NO'
           AND column_default IS NULL
    ) INTO id_needs_default;

    IF id_needs_default THEN
        EXECUTE 'ALTER TABLE staging.hub_org_credits '
                'ALTER COLUMN id SET DEFAULT gen_random_uuid()';
        RAISE NOTICE '095: staging.hub_org_credits.id had no default; set to '
                     'gen_random_uuid() to match staging.hub_credit_wallets.';
    END IF;

    -- Any OTHER mandatory column this file does not populate is a stop.
    -- We do not invent a value for a column whose meaning we do not know.
    -- ::text is not decoration: information_schema.column_name is the
    -- sql_identifier domain over `name`, and string_agg has no (name, text)
    -- signature. Relying on the implicit name→text cast to find it is exactly
    -- the class of thing that fails only on the live database.
    SELECT string_agg(column_name::text, ', ' ORDER BY column_name) INTO offender
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'hub_org_credits'
       AND is_nullable = 'NO'
       AND column_default IS NULL
       AND is_generated = 'NEVER'
       AND column_name NOT IN ('id', 'org_id', 'balance', 'allowance_balance',
                               'purchased_balance', 'period_start',
                               'credits_reset_at');
    IF offender IS NOT NULL THEN
        RAISE EXCEPTION
          'ABORT: staging.hub_org_credits has mandatory column(s) with no '
          'default that migration 095 does not populate: %. Give them a default '
          'or add them to the INSERT in section 3 by hand — 095 will not invent '
          'a value for a money table.', offender;
    END IF;
END $$;
-- Lock: AccessShareLock on the catalog; ALTER … SET DEFAULT (only if the column
-- is genuinely broken) takes AccessExclusiveLock on hub_org_credits and writes
-- one pg_attrdef row. No data is read or rewritten. Instant at any row count.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. TWO BUCKETS, ONE NUMBER
-- ════════════════════════════════════════════════════════════════════════════
--
-- allowance  — the monthly grant. Reset each period. NO carry-over.
-- purchased  — a paid top-up. Carries over indefinitely.
-- Spend draws ALLOWANCE FIRST so the credits the client paid for survive.
--
-- `balance` is retained and maintained as the sum by services/credits.py, for
-- the reasons in the header.

ALTER TABLE staging.hub_org_credits
  ADD COLUMN IF NOT EXISTS allowance_balance  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staging.hub_org_credits
  ADD COLUMN IF NOT EXISTS purchased_balance  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staging.hub_org_credits
  ADD COLUMN IF NOT EXISTS period_start       DATE NOT NULL
                                              DEFAULT date_trunc('month', now())::date;
-- Lock: AccessExclusiveLock on hub_org_credits, three times.
--
-- NO TABLE REWRITE, for a reason worth stating precisely because it is the
-- difference between microseconds and a rewrite of a money table: since PG 11,
-- ADD COLUMN with a NON-VOLATILE default evaluates the default once and stores
-- it in pg_attribute as the missing value for existing rows. `0` is a constant.
-- `date_trunc('month', now())::date` is STABLE, not volatile — now() returns
-- the transaction timestamp — so it takes the same fast path. Had it been
-- clock_timestamp(), every row would be rewritten.
--
-- Each statement acquires and completes in microseconds. At 3 rows a rewrite
-- would have been free anyway; the analysis matters because the same pattern
-- will be replayed on a database with more orgs than this one.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. BACKFILL: EVERY EXISTING CREDIT BECOMES *PURCHASED*
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE STATEMENT NOBODY MAY CHANGE. Read the reasoning before touching it.
--
-- We cannot reconstruct which of an existing balance was granted and which was
-- bought, and no amount of cleverness recovers it. `_maybe_reset_monthly_credits`
-- wrote `SET balance = $1` (ai_router.py:695-699) — an assignment, not a delta —
-- and the ledger row it left behind uses the NEW BALANCE for BOTH `amount` and
-- `balance_after` (ai_router.py:700-704, `VALUES ($1::uuid, $2, $2, 'reset', …)`).
-- So SUM(amount) over the ledger reconstructs nothing at all; the history is
-- genuinely gone, not merely awkward to query.
--
-- Given that, the choice is not "which is more accurate" but "which way should
-- we be wrong". The two errors are not symmetric:
--
--   · Call an existing credit ALLOWANCE  → it is FORFEITED at the next period
--     roll. The customer loses credits they may well have paid for. Irreversible
--     and invisible: it looks exactly like a normal monthly reset.
--   · Call an existing credit PURCHASED  → it carries over forever. At worst an
--     org keeps credits it would otherwise have lost.
--
-- So: EVERY EXISTING BALANCE BECOMES PURCHASED. It is the only direction of
-- error that cannot take money off a customer, and it is a small fraction of
-- what the old reset was destroying every month regardless.
--
-- CONSEQUENCE, STATED PLAINLY SO NOBODY IS SURPRISED LATER: the first
-- roll_period() after this migration ADDS the month's allowance on top of the
-- preserved balance instead of replacing it. Balances will appear to jump once.
-- That is intended and it is a one-time effect.
--
-- GREATEST(…, 0) because a bucket carries CHECK-free INTEGER semantics and a
-- negative legacy balance — however it got there — must not become a negative
-- purchased bucket that the new arithmetic then treats as spendable debt.
--
-- `period_start` IS STAMPED FROM credits_reset_at, NOT FROM TODAY, and the
-- difference is a skipped monthly grant. roll_period() returns immediately at
-- `if bal.period_start >= now_period` (services/credits.py), so this column is
-- not a note about when the migration ran — it is the assertion "this row has
-- ALREADY been granted for that period". Stamping every row with the current
-- month asserts that for rows where it may not be true, and the row then waits
-- a full month for a grant it was owed now.
--
-- credits_reset_at is the honest input: it is the timestamp the legacy roll
-- writes when it grants (_maybe_reset_monthly_credits, `SET credits_reset_at =
-- NOW()`) and the same column that path reads to decide a month has turned. A
-- NULL falls back to LAST month, which errs toward granting — the direction
-- this whole section has already chosen.
--
-- CHECKED AGAINST THE LIVE DATA RATHER THAN ASSUMED (2026-08-04): all three
-- hub_org_credits rows carry credits_reset_at inside the current period
-- (2026-08-01, -02 and -03; the period began 2026-08-01), so August has already
-- landed everywhere and both expressions yield 2026-08-01 today. NO ORG IS
-- CURRENTLY AT RISK EITHER WAY. This form is taken because it also survives a
-- re-run, a restore from a backup taken before the roll, and an org created
-- between now and the apply — none of which cost anything to protect against.
UPDATE staging.hub_org_credits
   SET purchased_balance = GREATEST(COALESCE(balance, 0), 0),
       allowance_balance = 0,
       period_start      = date_trunc('month',
                             COALESCE(credits_reset_at, now() - interval '1 month'))::date,
       updated_at        = NOW()
 WHERE purchased_balance = 0 AND allowance_balance = 0;
-- Lock: RowExclusiveLock on the table, row locks on 3 rows. Instant.
--
-- IDEMPOTENT, and the WHERE clause is what makes it so. Re-running this file
-- after any real spend leaves the rows alone, because by then at least one
-- bucket is non-zero. Re-running it immediately after itself is also safe: the
-- rows it already converted have purchased_balance <> 0 and are skipped. The
-- only row it would touch twice is a genuinely empty wallet, where both
-- readings are 0 — and both buckets and period_start now come from the row
-- rather than from the clock, so re-running it writes the same three values
-- whenever you run it and only updated_at moves. `date_trunc('month', now())`
-- did not have that property: replaying this file on an empty wallet after a
-- month boundary moved period_start forward and cost that org the grant for the
-- month it was replayed in.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE ORG WALLET IS NOW UNIVERSAL
-- ════════════════════════════════════════════════════════════════════════════
--
-- The dead-org bug, end to end: create_org only inserted a wallet
-- `if monthly_credits > 0` (routers/admin_orgs.py:167); the startup seed carries
-- the identical `WHERE o.monthly_credits > 0` filter (server.py:3555-3561); so
-- an org that Aekam negotiated down to 0 got NO ROW AT ALL.
-- `_maybe_reset_monthly_credits` then returns forever at its `if not wallet`
-- (ai_router.py:672-676), the balance never initialises, and deduct answers 402
-- permanently. The only self-heal in the product sat behind
-- require_module("srijan") — routers/hub.py:1804-1806, inside GET /org/credits,
-- behind the module-level `_hub_gate` at routers/hub.py:41 — so an org without
-- the Srijan module could not even accidentally recover.
--
-- Every org gets a row. A zero balance is a balance, and it is a completely
-- different thing from an absent wallet: one refuses a spend with a number, the
-- other refuses it with a missing record.
--
-- `period_start` IS LAST MONTH, for the same reason as section 2 and with more
-- force: a wallet that has never existed has never been granted anything. Stamp
-- it with the current month and roll_period() returns at its `>=` guard, the
-- rescued org sits at a balance of 0 until the following month, and section 3
-- has swapped a permanent 402 for a temporary one instead of ending it. Last
-- month makes the row eligible, and spend() calls roll_period() before every
-- debit, so the org is granted the first time it tries to work rather than on a
-- schedule. It cannot double-grant: no wallet meant no grant could ever have
-- landed here.
--
-- Written out rather than reusing section 2's COALESCE because there is nothing
-- to coalesce — credits_reset_at is a column of hub_org_credits, not of
-- organisations, and this row does not exist yet. This is that expression's
-- fallback branch, which is the only branch a brand-new row can take.
--
-- So the two timestamp columns on this row deliberately DISAGREE about which
-- period it is in, and that is not an oversight: credits_reset_at = NOW() is
-- addressed to the LEGACY resetter (see below), period_start = last month is
-- addressed to the NEW roll. Each column is set to what its own reader needs.
INSERT INTO staging.hub_org_credits
  (org_id, balance, allowance_balance, purchased_balance, period_start, credits_reset_at)
SELECT o.id, 0, 0, 0, date_trunc('month', now() - interval '1 month')::date, NOW()
  FROM staging.organisations o
 WHERE NOT EXISTS (SELECT 1 FROM staging.hub_org_credits c WHERE c.org_id = o.id);
-- Lock: RowExclusiveLock on hub_org_credits; AccessShareLock on organisations
-- for the anti-join, plus the FK's row-share lock on the referenced rows.
-- 3 organisations. Instant.
--
-- WHERE NOT EXISTS rather than ON CONFLICT (org_id) on purpose: the unique index
-- that ON CONFLICT would need is not created until section 4, three statements
-- below, and this INSERT must not depend on it.
--
-- `credits_reset_at` is set to NOW() so the legacy reset does not fire on these
-- brand-new rows the moment the month turns. See the deploy-order warning in
-- the header — that legacy path is still live until the ai_router shim ships.


-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE CONSTRAINT ON_CONFLICT NEEDS
-- ════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS uq_hub_org_credits_org
    ON staging.hub_org_credits (org_id);
-- Lock: ShareLock on hub_org_credits — this BLOCKS WRITES while it builds, and
-- reads continue. 3 rows: single-digit milliseconds.
--
-- Deliberately NOT CONCURRENTLY. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, and this file must stay one BEGIN/COMMIT — a half-applied
-- credit schema is worse than any lock. At 3 rows the blocking window is
-- shorter than the round trip to the database.
--
-- A unique INDEX, not a unique CONSTRAINT: ON CONFLICT (org_id) is satisfied by
-- either, and an index is created with IF NOT EXISTS, which a constraint is not.
-- That is what makes this file safe to replay.

-- Deprecated but NOT dropped, per the owner. These are the columns the new code
-- stops reading; leaving them in place means a rollback of the application does
-- not need a rollback of the schema.
COMMENT ON COLUMN staging.hub_org_credits.monthly_allocation IS
  'DEPRECATED 095. The monthly grant is organisations.monthly_credits. Not read.';
COMMENT ON COLUMN staging.hub_org_credits.last_refill_at IS
  'DEPRECATED 095. Superseded by period_start. Not read.';
COMMENT ON TABLE staging.hub_credit_wallets IS
  'DEPRECATED 095. Per-CLIENT wallet, 53 rows, spendable by nothing. '
  'Retained with its rows by the owner''s instruction. No new reads or writes.';
-- Lock: ShareUpdateExclusiveLock on each object; writes to pg_description only.
-- Conflicts with other DDL, never with SELECT/INSERT/UPDATE/DELETE. Instant —
-- and in particular the hub_credit_wallets comment does not read its 53 rows.


-- ════════════════════════════════════════════════════════════════════════════
-- 5. THE MEMBER CEILING
-- ════════════════════════════════════════════════════════════════════════════
--
-- THIS IS NOT A SECOND WALLET. It is a CEILING ON THE SHARED ORG BALANCE.
-- Nothing is ever debited from here: `spent_credits` is a counter and
-- `cap_credits` is the most of the ORG's money this member may move this period.
-- Money lives in exactly one place, staging.hub_org_credits, and the whole point
-- of this programme is that it stays that way.
--
-- A NEW TABLE rather than columns bolted onto hub_user_credits, because that
-- table's grain is wrong in a way that columns cannot fix. It has no notion of a
-- period; its only writer does
--     allocated = staging.hub_user_credits.allocated + EXCLUDED.allocated
-- (routers/hub.py:1939-1944), which is additive-only — so a ceiling can go up
-- and never down, it has never reset, there is no way to clear one, and no
-- ledger row records that it changed. An admin who typed 200 twice gave that
-- member 400 and had no way back.
--
-- One row per (org, member, period). roll_period() carries cap_credits forward
-- into the new period, which is precisely what lets an admin set a DIFFERENT
-- ceiling for next month without disturbing this month's.
CREATE TABLE IF NOT EXISTS staging.org_member_credits (
    org_id        UUID    NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- TEXT, because every user id in this product is text (public.users.user_id).
    -- Migration 092 exists because that was forgotten once already.
    user_id       TEXT    NOT NULL,
    period_start  DATE    NOT NULL,
    -- NULL = uncapped within the org balance. 0 = refused everything.
    -- This preserves today's semantics exactly: no hub_user_credits row meant
    -- uncapped (ai_router.py:793, `if user_wallet:`) and a row of 0 meant
    -- refused. Collapsing the two would refuse every member on deploy day.
    cap_credits   INTEGER NULL CHECK (cap_credits IS NULL OR cap_credits >= 0),
    spent_credits INTEGER NOT NULL DEFAULT 0 CHECK (spent_credits >= 0),
    set_by        TEXT    NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id, period_start)
);
-- Lock: AccessExclusiveLock on a table nobody else can see yet, plus
-- ShareRowExclusiveLock on staging.organisations for the foreign key — that one
-- blocks writes to organisations, not reads, for the instant it takes to
-- validate against 3 rows.

CREATE INDEX IF NOT EXISTS idx_org_member_credits_org_period
    ON staging.org_member_credits (org_id, period_start);
-- Lock: ShareLock on a table with 0 rows. Instant.
-- Serves roll_period()'s carry-forward and GET /hub/org/credits/users. The
-- primary key leads with org_id too, but its second column is user_id, so it
-- cannot answer "every member of this org in this period" without a full scan
-- of the org's history once more than one period exists.


-- ════════════════════════════════════════════════════════════════════════════
-- 6. CARRY THE EXISTING CEILINGS INTO THIS PERIOD
-- ════════════════════════════════════════════════════════════════════════════
--
-- hub_user_credits.allocated is a LIFETIME running total that has never been
-- reset, so it is not honestly a monthly figure. But it is the only ceiling
-- anyone in this product has ever set, and silently dropping it would UNCAP
-- EVERY MEMBER OF EVERY ORG on the day this ships — which is a security change
-- disguised as a data migration.
--
-- So EVERY row is carried verbatim as this period's ceiling, with `used` as this
-- period's spend. Too generous, knowably, and in the same direction of error as
-- section 2: the failure mode is a member who can spend more than intended for
-- one month, not a member locked out of work they were authorised to do. Note
-- what that argues for and what it does not — inflating a number, never
-- discarding one, and least of all discarding the zeros. Admins can lower a
-- ceiling the day this ships, which is the first time in this product's life
-- that lowering one has been possible at all.
--
-- `>= 0`, NOT `> 0`, AND THE DIFFERENCE IS THE PARAGRAPH ABOVE. A row of 0
-- is not an empty row — per section 5 it is the STRICTEST ceiling there is. NO
-- row means uncapped: ai_router.py:793 `if user_wallet:` skips the member check
-- entirely when the SELECT returns nothing. A row of 0 means refused: the same
-- block computes `remaining = allocated - used` and raises 402 on
-- `remaining < cost`. `> 0` drops exactly the zero rows, so the members an org
-- went out of its way to block would come out of this migration as the ONLY
-- members in the product with no ceiling at all — a spend-control regression, in
-- the section written to prevent one, and invisible because it looks like a
-- member who was simply never allocated anything.
--
-- Negative `allocated` stays excluded rather than clamped to 0. It is not
-- reachable through the product — the column is NOT NULL DEFAULT 0
-- (052_org_credit_tables.sql:17) and its only writer rejects `amount <= 0` with
-- a 400 before the additive UPSERT (routers/hub.py:1935-1944) — so a negative
-- row is corruption, and a money migration must not quietly reinterpret
-- corruption as a policy. Carrying one would violate CHECK (cap_credits >= 0)
-- and abort the whole file mid-apply; leaving it out puts it in front of a human
-- instead.
INSERT INTO staging.org_member_credits
  (org_id, user_id, period_start, cap_credits, spent_credits, set_by)
SELECT u.org_id, u.user_id, date_trunc('month', now())::date,
       u.allocated, GREATEST(LEAST(u.used, u.allocated), 0), 'migration_095'
  FROM staging.hub_user_credits u
 WHERE u.allocated >= 0
ON CONFLICT (org_id, user_id, period_start) DO NOTHING;
-- Lock: RowExclusiveLock on the new table; AccessShareLock on hub_user_credits
-- (small); FK row-share locks on organisations. Instant.
--
-- LEAST(used, allocated) so a member whose lifetime spend already exceeds their
-- lifetime allocation starts this period at their ceiling rather than above it.
-- GREATEST(…, 0) guards the CHECK (spent_credits >= 0): the refund path floors
-- `used` at zero already (ai_router.py:750-753) so it should be unreachable,
-- but an unreachable CHECK violation still aborts a money migration halfway
-- through, and the cost of being wrong here is one extra function call.
--
-- ON CONFLICT DO NOTHING makes the file replayable: a re-run after an admin has
-- already set a real ceiling this period must not overwrite it with the legacy
-- number.

COMMENT ON TABLE staging.hub_user_credits IS
  'DEPRECATED 095. Superseded by staging.org_member_credits, which is '
  'period-scoped and can be lowered. Rows retained. No new reads or writes.';
-- Lock: ShareUpdateExclusiveLock. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 7. THE UNLIMITED FLAG
-- ════════════════════════════════════════════════════════════════════════════
--
-- Aekam's own org skips THE ORG BALANCE CHECK ONLY. Per-user ceilings still
-- apply and every spend is still written to the ledger — metering is for
-- visibility, not for charging.
--
-- A FLAG, NOT A PLAN NUMBER. The owner was explicit and the reason is
-- operational: a plan of 999999999 is a number, and a number is something a
-- report sums, a reconciliation compares against, and an invoice eventually
-- quotes. A boolean cannot be accidentally believed.
ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS is_platform_org BOOLEAN NOT NULL DEFAULT FALSE;
-- Lock: AccessExclusiveLock on organisations. FALSE is a constant default, so
-- catalog-only, no rewrite. Microseconds.

CREATE INDEX IF NOT EXISTS idx_organisations_platform_org
    ON staging.organisations (id) WHERE is_platform_org;
-- Lock: ShareLock on organisations, 3 rows. Instant.
-- Partial: it indexes the one row that will ever be true, so it stays a page
-- long no matter how many orgs the product acquires.

-- NOT SET HERE, and this is a decision rather than an omission. Aekam's own org
-- is flagged by god mode through PATCH /admin/orgs/{id}/settings. A migration
-- that hardcodes an org_id is a migration that flags the WRONG org the first
-- time it is replayed onto another environment — and the org it would wrongly
-- flag gets free everything.


-- ════════════════════════════════════════════════════════════════════════════
-- 8. max_users IS ALREADY AMENDABLE — NOTHING TO DO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Recorded so nobody goes looking for the missing DDL. organisations.max_users
-- exists and is nullable (061_org_max_users.sql:22), NULL meaning "fall back to
-- plans.max_users". The defect is that PATCH /admin/orgs/{id}/settings never
-- WRITES it and GET never RETURNS it. That is a Python fix, not a schema one.


-- ════════════════════════════════════════════════════════════════════════════
-- 9. THE ONE PRICE LIST FOR KIND-PRICED WORK
-- ════════════════════════════════════════════════════════════════════════════
--
-- CREDIT_COSTS (services/ai_router.py:613-623) is a Python dict, and every call
-- site reads it as `.get(x, 2)` — so an agent_type nobody ever listed silently
-- costs 2 credits and looks like somebody decided that. "chatbot" is not a key
-- in it. Neither is "content".
--
-- A table, so the owner can price a channel without a deploy, and so an UNLISTED
-- kind is an ERROR instead of a guess.
CREATE TABLE IF NOT EXISTS staging.credit_prices (
    kind        TEXT PRIMARY KEY,
    credits     INTEGER NOT NULL CHECK (credits >= 0),
    -- Charge `credits` per `unit_size` units. Everything ships at 1; the column
    -- exists so a future per-chunk channel does not need DDL on a live schema.
    unit_size   INTEGER NOT NULL DEFAULT 1 CHECK (unit_size >= 1),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    notes       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Lock: none on any existing table. New table. Instant.

-- Seeded EXACTLY from CREDIT_COSTS as it stands at c3ce1345 — verified value by
-- value against services/ai_router.py:613-623 while writing this file. NOT ONE
-- NUMBER CHANGES ON MIGRATION DAY. A price change and a plumbing change must
-- never ship together, or the next time somebody asks why the bill moved,
-- nobody can tell them which of the two did it.
INSERT INTO staging.credit_prices (kind, credits, notes) VALUES
  ('social_media',    2, 'CREDIT_COSTS, unchanged'),
  ('blog',            5, 'CREDIT_COSTS, unchanged'),
  ('ad_copy',         3, 'CREDIT_COSTS, unchanged'),
  ('email',           2, 'CREDIT_COSTS, unchanged'),
  ('whatsapp',        1, 'CREDIT_COSTS, unchanged — GENERATING WhatsApp copy'),
  ('lead_magnet',     8, 'CREDIT_COSTS, unchanged'),
  ('campaign',       10, 'CREDIT_COSTS, unchanged'),
  ('seo',             8, 'CREDIT_COSTS, unchanged'),
  ('ad_analysis',     5, 'CREDIT_COSTS, unchanged'),
  ('image',           3, 'CREDIT_COSTS, unchanged'),
  -- Explicit entries for the two agent_types that were riding the `.get(x, 2)`
  -- default. Same price they were already paying wherever anything paid at all;
  -- now it is a decision instead of a fallthrough.
  ('content',         2, 'Was the silent CREDIT_COSTS.get default'),
  -- The five channels that charged nothing at all. Priced, not free.
  ('chatbot_message', 2, 'One RAG answer: query embedding + answer LLM call'),
  ('chatbot_rerank',  1, 'services/ai/reranker.py, ~$0.01/call by its docstring'),
  ('kb_ingest',       1, 'One knowledge-base document, charged ONCE at ingest, '
                         'not per chunk — see spec §3.4'),
  ('whatsapp_send',   1, 'One WhatsApp Cloud API send. Meta bills per 24h '
                         'conversation, not per message; see spec §3.5'),
  ('social_send',     0, 'FB/IG/Threads/YouTube/TikTok/LinkedIn/X publish. '
                         'API-quota, not per-message billing. Priced at 0 so '
                         'the ledger records the event.')
ON CONFLICT (kind) DO NOTHING;
-- Lock: RowExclusiveLock on the new table. 16 rows. Instant.
-- DO NOTHING, not DO UPDATE: replaying this file must never reset a price the
-- owner has since changed back to the seed value.


-- ════════════════════════════════════════════════════════════════════════════
-- 10. THE LEDGER GROWS UP
-- ════════════════════════════════════════════════════════════════════════════
--
-- Today THE DESCRIPTION IS LOAD-BEARING. routers/admin_orgs.py:1490 does
-- `r["description"].replace(" generation", "")` to build usage_by_type, and
-- routers/subscription.py classifies scraper spend with
-- `description.startswith("scraper:")`. A free-text column with no constraint on
-- it is deciding what a customer is told they spent. These columns end that.
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS kind             TEXT;
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS ref_id           TEXT;
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS quantity         INTEGER NOT NULL DEFAULT 1;
-- Which bucket moved — so a refund returns to where it took from, and so
-- SUM(allowance_delta) + SUM(purchased_delta) reconstructs the wallet. Nothing
-- in the current ledger can do that; see the note in section 2.
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS allowance_delta  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS purchased_delta  INTEGER NOT NULL DEFAULT 0;
-- The whole idempotency mechanism. Nothing else is needed for it.
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key  TEXT;
-- A refund names the spend it reverses. This is what enforces refund-once and
-- what lets refund() read the original's bucket split.
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS reverses_tx_id   UUID;
-- TRUE on a platform-org spend: recorded for visibility, wallet untouched.
-- Reports MUST exclude these from balance reconciliation and INCLUDE them in
-- usage.
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS metered_only     BOOLEAN NOT NULL DEFAULT FALSE;
-- Which allowance period the spend belonged to. refund() reads it to decide
-- whether the allowance portion can go back to allowance at all.
ALTER TABLE staging.hub_org_credit_transactions
  ADD COLUMN IF NOT EXISTS period_start     DATE;
-- Lock: AccessExclusiveLock on hub_org_credit_transactions, nine times.
-- Every default here is either a constant (1, 0, FALSE) or NULL, so all nine
-- take the PG 11+ catalog-only path and the 171 existing rows ARE NOT
-- REWRITTEN. Microseconds each.
--
-- No FK from reverses_tx_id to id, deliberately: it is enforced in
-- services/credits.py, which reads the original row anyway to get its bucket
-- split, and a self-referential FK on the highest-write table in the credit
-- system buys a constraint check on every single debit to catch a bug that the
-- unique index below already makes unreachable.

-- Historic rows keep a NULL kind forever. There is no backfill for them: `kind`
-- would have to be inferred from the same free-text description this column
-- exists to stop trusting, and a guessed classification is worse than an honest
-- NULL because it cannot be told apart from a real one.
COMMENT ON COLUMN staging.hub_org_credit_transactions.kind IS
  'NULL on rows written before 095. Readers must fall back to parsing '
  'description for those, and must NOT parse description for new rows.';
-- Lock: ShareUpdateExclusiveLock. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 11. IDEMPOTENCY
-- ════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credit_tx_idempotency
    ON staging.hub_org_credit_transactions (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
-- Lock: ShareLock on hub_org_credit_transactions — blocks writes, allows reads.
-- All 171 existing rows are excluded by the partial predicate, so the index is
-- built empty. Single-digit milliseconds.
--
-- GLOBAL, not per-org, on purpose. The key is already built from org_id at
-- every call site, so a global unique adds nothing but the ability to catch a
-- key accidentally reused ACROSS orgs — which would be a bug whichever way it
-- was caught, and is much better caught here than by a customer.

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credit_tx_reverses
    ON staging.hub_org_credit_transactions (reverses_tx_id)
    WHERE reverses_tx_id IS NOT NULL;
-- Lock: ShareLock, all 171 rows excluded by the predicate. Instant.
--
-- A spend can be refunded exactly once, and the database is what guarantees it
-- rather than a code path. The old refund_org_credits had no such guard and
-- could not have had one: it took an agent_type, not a transaction
-- (ai_router.py:708, `async def refund_org_credits(org_id, user_id,
-- agent_type, description)`), so it had no idea which spend it was reversing —
-- only what that TYPE of work costs at list price today.


-- ════════════════════════════════════════════════════════════════════════════
-- 12. THE INDEXES THE HOT PATHS ACTUALLY USE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every report in the product windows the ledger by org AND date —
-- routers/hub.py:1814 (monthly_used), routers/admin_orgs.py:1477 (the ledger
-- read behind `org_cost_breakdown`, GET /{org_id}/cost-breakdown), and
-- routers/subscription.py:526 and :627. The only index that exists is
-- idx_hub_org_credit_tx_org (052:38), on org alone, so each of those reads the
-- org's entire history and throws away everything outside the window.
CREATE INDEX IF NOT EXISTS idx_org_credit_tx_org_created
    ON staging.hub_org_credit_transactions (org_id, created_at DESC);
-- Lock: ShareLock, 171 rows sorted and written. Milliseconds.

-- usage_by_type without parsing a sentence.
CREATE INDEX IF NOT EXISTS idx_org_credit_tx_org_kind_created
    ON staging.hub_org_credit_transactions (org_id, kind, created_at DESC)
    WHERE kind IS NOT NULL;
-- Lock: ShareLock; all 171 existing rows are excluded, so it builds empty.
-- Instant. It fills as new spend arrives.

-- Per-member spend for GET /hub/org/credits/users and the ceiling report.
CREATE INDEX IF NOT EXISTS idx_org_credit_tx_org_user_period
    ON staging.hub_org_credit_transactions (org_id, user_id, period_start)
    WHERE user_id IS NOT NULL AND period_start IS NOT NULL;
-- Lock: ShareLock; period_start is NULL on every existing row, so it too builds
-- empty. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 13. DRIFT DETECTION — A REPORT, NOT A CONSTRAINT
-- ════════════════════════════════════════════════════════════════════════════
--
-- The header explains why there is no CHECK here. This is what replaces it.
-- ANY ROW RETURNED BY THIS VIEW IS A BUG: either a legacy writer that has not
-- been converted to services/credits.py, or services/credits.py itself failing
-- to set all three columns in one statement. It should be empty at all times,
-- and it is the single query to run after each of the application deploys in
-- this programme lands.
CREATE OR REPLACE VIEW staging.v_org_credit_drift AS
SELECT c.org_id,
       c.balance,
       c.allowance_balance,
       c.purchased_balance,
       c.allowance_balance + c.purchased_balance AS expected_balance,
       c.balance - (c.allowance_balance + c.purchased_balance) AS drift
  FROM staging.hub_org_credits c
 WHERE c.balance <> c.allowance_balance + c.purchased_balance;
-- Lock: AccessExclusiveLock on the new view object; AccessShareLock on
-- hub_org_credits to resolve the column list. No data is read at definition
-- time. Instant.

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER COMMIT AND READ IT WITH YOUR EYES. DO NOT AUTOMATE IT.
-- ════════════════════════════════════════════════════════════════════════════
--
-- organisations.monthly_credits becomes the SOLE source of the monthly grant.
-- The plan fallback at ai_router.py:685-693 is deleted by the application
-- change, and that is what makes a negotiated 0 finally mean 0 — today
-- `if not org_credits` treats a deliberately agreed zero as absent and hands
-- the org the plan default every single month.
--
-- THE FLIP SIDE, WHICH IS WHY YOU HAVE TO LOOK: an org sitting at
-- monthly_credits = 0 only because nobody ever set it will now genuinely get 0
-- per month. There are three orgs. Look at them, decide each one by hand, and
-- set the number through PATCH /admin/orgs/{id}/settings. A migration must not
-- guess a commercial term.
--
-- Second thing to check while you are here: is_platform_org is FALSE on every
-- row, including Aekam's own. Set it through god mode, not with an UPDATE here.
SELECT o.id, o.name, o.monthly_credits, o.is_platform_org,
       p.code AS plan_code, p.default_credits AS plan_default,
       s.status AS sub_status,
       c.balance, c.allowance_balance, c.purchased_balance
  FROM staging.organisations o
  LEFT JOIN staging.subscriptions s ON s.org_id = o.id AND s.status = 'active'
  LEFT JOIN staging.plans p ON p.id = s.plan_id
  LEFT JOIN staging.hub_org_credits c ON c.org_id = o.id
 ORDER BY o.name;

-- And the one that must come back empty:
--     SELECT * FROM staging.v_org_credit_drift;
