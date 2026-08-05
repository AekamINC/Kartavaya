-- 097_billing_updated_by.sql
--
-- WHO RAISED THE FEE.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Read that sentence twice, as 093, 094, 095
-- and 096 also ask you to. Apply by hand, in a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/097_billing_updated_by.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- REQUIRES 096. It adds a column to `staging.org_billing_lines`, which
-- 096_billing_lines.sql creates. GUARD 0 says so by name rather than letting
-- you read "relation does not exist" and go looking for a typo in a table name
-- that is spelled correctly.
--
-- Additive only. ONE nullable column on ONE table. No DROP, no ALTER … TYPE, no
-- SET NOT NULL, no backfill, no trigger, no index, no data touched. Replayable:
-- `ADD COLUMN IF NOT EXISTS` makes a second run a no-op, and there is nothing
-- else in the file to replay.
--
-- THIS FILE CANNOT CHANGE WHAT ANYBODY IS CHARGED. It adds somewhere to record
-- who changed it.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
--
-- 096 gave `staging.org_billing_lines` two actor columns, `created_by` and
-- `ended_by`. Between them they answer "who opened this charge" and "who
-- stopped it". They do not answer the question somebody will actually ask,
-- which is WHO CHANGED WHAT THIS CLIENT PAYS, AND WHEN.
--
-- Amending in place is not an oversight either — it is the documented path, and
-- 096 argues it out at length: ending a line and opening a second one at the new
-- price puts two rows of one kind in one invoice period, `uq_obl_open_platform`
-- cannot refuse the second because the first is no longer open, and the client
-- is charged twice. So a price change IS an UPDATE to a standing row, by design,
-- and the row records `updated_at` and no author.
--
-- `services/billing_lines.py:update_line` — the only path an operator has to
-- re-price a support or ongoing line — says this about itself, in the shipped
-- code, before this file existed:
--
--     TAKES NO `actor_id`, and that is a gap rather than a decision: 096 gives
--     the table `created_by` and `ended_by` and NO `updated_by`, so there is
--     nowhere to put one. Who raised a fee is therefore not recorded — only who
--     opened the line and who stopped it. Accepting an `actor_id` here and
--     dropping it would be worse than not accepting one: a router would pass it
--     and believe the amendment was attributed. Adding the column is an additive
--     migration for whoever wants that trail.
--
-- This is that migration, and nothing more than that migration. It is money
-- code: a price that moved with no author is a price nobody can defend to the
-- client who is paying it.
--
-- ── TEXT, NOT UUID ──────────────────────────────────────────────────────────
--
-- A user id in this product is TEXT of the form `user_549c9cac35aa`, because
-- `public.users.user_id` is text. This repo has paid for forgetting that twice —
-- 030_created_by_uuid_to_text.sql ("500 errors on every INSERT") and
-- 092_sales_target_salesperson_is_a_user_id.sql (a sales target that could never
-- be saved by anyone, in any org, reported to the browser as a CORS error with
-- no body). 096 wrote out the same reasoning at length for the two columns this
-- one sits beside, and wrote them TEXT.
--
-- The router that will write this column passes `user["user_id"]` verbatim, the
-- same value `created_by` and `ended_by` already hold. Matching its neighbours
-- is not a preference here; UUID is a known, twice-diagnosed defect, and a third
-- actor column of a different type on the same table would be worse than either.
--
-- ── WHAT A NULL MEANS, AND WHY THERE IS NO BACKFILL ─────────────────────────
--
-- NULL = this line has never been amended, or it was amended before this column
-- existed. Both are true things and neither can be improved on by a migration:
-- the author of a past amendment was never recorded anywhere, so there is
-- nothing to backfill FROM. 096 made the same call for its own backfilled rows —
-- "`created_by` is NULL — no person did this, a migration did, and inventing an
-- author is worse than admitting there isn't one" — and inventing one here would
-- be worse still, because the invented name would be attached to a price change.
--
-- Read it with `updated_at`, which already exists: a row where
-- `updated_at = created_at` has never been amended at all, and one where
-- `updated_at > created_at AND updated_by IS NULL` was amended before this
-- column landed. Those two are distinguishable, which is the most this file can
-- honestly offer.
--
-- ── WHAT THIS COLUMN IS NOT ─────────────────────────────────────────────────
--
-- IT IS THE LAST WRITER, NOT A HISTORY. One column holds one name. A line
-- re-priced in March by A and ended in June by B carries B; the March change is
-- gone. A full amendment trail is a second table — an append-only row per
-- change, with the old and new amount — and that is a real design decision with
-- a real cost, not something to smuggle in as a column. Say what this is so
-- nobody reads it as the audit log it is not: it answers "who last changed this
-- line, and when", and `ended_by`/`created_by` keep answering the two questions
-- they always did.
--
-- NO CHECK CONSTRAINT, deliberately. An empty-string author would be a lie
-- dressed as a value, and `CHECK (updated_by IS NULL OR btrim(updated_by) <> '')`
-- would refuse it — but `created_by` and `ended_by` carry no such check, and a
-- rule that covers one of three identical columns is a rule that looks enforced
-- and is not. If that check is worth having it is worth having on all three, and
-- that is a different migration with a validating scan in it.
--
-- NO INDEX. Nothing queries lines BY author; the question is always "who
-- changed this line", asked one line at a time, and the primary key already
-- answers it. An index here would be write cost against a read nobody makes.
--
-- ── THE COLUMN IS INERT UNTIL TWO OTHER FILES CHANGE ────────────────────────
--
-- APPLYING THIS FILE RECORDS NOTHING BY ITSELF. Nothing writes the column yet,
-- so it stays NULL on every row and every amendment goes on being anonymous
-- until the follow-up below ships. That is not a reason to delay this file —
-- the column has to exist before the code can pass an actor into it — but it IS
-- a reason not to close the ticket on the strength of a successful psql run.
--
--   1. `services/billing_lines.py` — THE ONLY WRITER OF THIS TABLE. No router
--      may write it, so no router can set this column.
--
--        · `update_line(conn, line_id, *, org_id, description=None, amount=None)`
--          gains `actor_id: Optional[str] = None`, and its closing UPDATE —
--          which already writes `updated_at=NOW()` — writes `updated_by` beside
--          it. Its docstring paragraph quoted above then needs replacing rather
--          than editing: it currently explains why the parameter does NOT exist.
--        · `_end_row` and `sync_platform_line`'s amount UPDATE already receive an
--          `actor_id` and already set `updated_at`. They should set `updated_by`
--          too, so that the pair (`updated_at`, `updated_by`) is never half
--          true — a row whose `updated_at` moved with no `updated_by` would read
--          as "amended before 097" forever, which is the one distinction the
--          NULL above is carrying.
--        · `_LINE_COLS` gains `updated_by` — every read in that module selects
--          through that one constant.
--        · `_row_to_line` returns it ONLY under `actors=True`, alongside
--          `created_by` and `ended_by`. THIS IS NOT COSMETIC: it is an Aekam
--          staff user id, this table has no tenant writers, and
--          `GET /v1/billing/me/lines` hands that body straight to the client.
--          Returned unconditionally it would leak which of Aekam's people
--          re-priced a client, to that client, on a screen nobody would think to
--          re-check. `list_lines(include_actors=False)` is defaulted the safe way
--          round for exactly this reason and the new column has to sit inside
--          that gate, not beside it.
--
--   2. `routers/billing.py` — `org_update_billing_line`, serving
--      `PATCH /api/v1/billing/orgs/{org_id}/lines/{line_id}`. It binds its guard
--      as `_=Depends(require_platform_role(*BILLING_CONSOLE_ROLES))` and its
--      docstring says why: "TAKES NO ACTOR. 096 gives the table `created_by` and
--      `ended_by` and no `updated_by` … Hence `_=` on the guard rather than
--      `user=`: this handler genuinely has no use for the caller's identity, and
--      binding one would imply it recorded it." Once this column exists that
--      reasoning inverts — rebind to `user=`, pass `actor_id=user["user_id"]`
--      into `update_line`, and rewrite the paragraph. It is the ONE route that
--      amends a line's terms.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
--
-- Safe to apply BEFORE the application change, and that is the intended order,
-- because it is the only order: the code cannot pass an actor into a column that
-- does not exist, and this column is read by nothing, written by nothing and
-- constrained by nothing until it does. There is no gap to watch and no drift
-- view to keep empty — unlike 096, this file adds no second copy of any fact.

BEGIN;

-- Fail fast rather than freeze the billing screens. Without lock_timeout the
-- ALTER below waits indefinitely for its AccessExclusiveLock and every request
-- that touches a billing line queues behind it. Five seconds is far longer than
-- any honest transaction on this table. SET LOCAL — scoped to this transaction,
-- reverted at COMMIT, changes nothing for anyone else.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ════════════════════════════════════════════════════════════════════════════
-- GUARD 0 — 096 MUST BE APPLIED FIRST
-- ════════════════════════════════════════════════════════════════════════════
--
-- The transaction rolls back either way and nothing is left half-applied. This
-- guard buys a legible error, not safety: "staging.org_billing_lines does not
-- exist" on an ALTER is true and unhelpful, and the answer — apply 096 — is
-- worth saying out loud in the file that needs it.
DO $$
BEGIN
    IF to_regclass('staging.org_billing_lines') IS NULL THEN
        RAISE EXCEPTION
          'ABORT: staging.org_billing_lines does not exist, so migration 096 '
          'has not been applied. Apply 096_billing_lines.sql first — 097 only '
          'adds one column to the table 096 creates.';
    END IF;
END $$;
-- Lock: AccessShareLock on the catalog only. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. WHO LAST AMENDED THIS LINE
-- ════════════════════════════════════════════════════════════════════════════
--
-- TEXT, matching `created_by` and `ended_by` beside it. See the header.
ALTER TABLE staging.org_billing_lines
    ADD COLUMN IF NOT EXISTS updated_by TEXT;
-- ── WHAT THIS LOCKS ─────────────────────────────────────────────────────────
--
-- AccessExclusiveLock on `staging.org_billing_lines`, held until COMMIT — which
-- for this file is the next statement. It is the strongest lock Postgres has:
-- while it is held, EVERY read and EVERY write of this table waits, including
-- SELECTs.
--
-- The WORK is microseconds. The column is nullable with no default, so on PG 11+
-- this is a pure catalog update — no table rewrite, no scan, existing rows are
-- not touched — and the table holds one open `platform` line per paying org
-- (three orgs at the row counts 096 recorded) plus whatever has been raised
-- since. There is no version of this ALTER that is slow because of data.
--
-- THE RISK IS ACQUISITION, NOT WORK, exactly as it was for 096's two ALTERs. The
-- request queues behind any open transaction already holding a lock on this
-- table, and WHILE IT QUEUES it blocks every reader that arrives after it. What
-- holds locks here, all of them short and all of them inside a transaction with
-- something else in it:
--
--     PATCH /api/v1/admin/orgs/{id}/settings   sync_platform_line, in the same
--                                              transaction as the write to
--                                              organisations.monthly_price
--     POST  /api/v1/admin/orgs/{id}/credits/topup   create_line, in the same
--                                              transaction as the credit grant
--     POST  /api/v1/subscription/admin/invoices     record_billed
--     the billing console and GET /v1/billing/me/lines   reads
--
-- The blast radius is therefore the billing console, the top-up dialog and the
-- invoice builder — NOT the whole product. That is a meaningfully smaller
-- exposure than 096's ALTER on `organisations`, which is read on essentially
-- every request. It is still money code and a stuck session still stalls an
-- invoice being raised, so: run it when the app is quiet, and let lock_timeout
-- turn the bad case into a clean rollback instead of a hope.
--
-- IF NOT EXISTS is what makes the statement replayable, and it is the whole of
-- the replay story for this file: run it twice and the second run does nothing.

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER COMMIT AND READ IT WITH YOUR EYES. DO NOT AUTOMATE IT.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. The column is there, and it is TEXT. If this says `uuid`, something other
--    than this file created it and the router will 500 on the first amendment
--    exactly as 030 and 092 describe:
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'staging'
   AND table_name   = 'org_billing_lines'
   AND column_name IN ('created_by', 'ended_by', 'updated_by')
 ORDER BY column_name;

-- 2. EXPECT ZERO, AND KEEP EXPECTING ZERO UNTIL THE FOLLOW-UP SHIPS. Nothing
--    writes this column yet. A non-zero answer here before
--    services/billing_lines.py has been changed means something outside that
--    module is writing this table, which is the one rule the whole billing-line
--    design rests on:
--
--        SELECT count(*) FROM staging.org_billing_lines
--         WHERE updated_by IS NOT NULL;
--
-- 3. AFTER the follow-up ships, this is the list of amendments nobody can be
--    named for — every one of them predates the column, and the number must
--    never grow again:
--
--        SELECT id, org_id, kind, description, amount, created_at, updated_at
--          FROM staging.org_billing_lines
--         WHERE updated_at > created_at AND updated_by IS NULL
--         ORDER BY updated_at DESC;
