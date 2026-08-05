-- 096_billing_lines.sql
--
-- WHAT AN ORG IS BILLED, AS ROWS INSTEAD OF AS A NUMBER TYPED INTO A FORM.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Read that sentence twice, as 093, 094 and
-- 095 also ask you to. Apply by hand, in a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/096_billing_lines.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- REQUIRES 095. Section 6 inserts into staging.credit_prices, which 095
-- creates. GUARD 0 says so by name rather than letting you read
-- "relation staging.credit_prices does not exist" and go looking for a typo.
--
-- Additive only. No DROP, no ALTER … TYPE, no SET NOT NULL on an existing
-- column, no destructive rewrite of a money column. Every statement is
-- guarded (IF NOT EXISTS / ON CONFLICT / CREATE OR REPLACE) and the file is
-- replayable: running it twice produces exactly the same database as running
-- it once, including the backfill. Section 4 is where that is hardest and it
-- is argued out in full there.
--
-- ── THE PROBLEM, so the SQL below is legible ────────────────────────────────
--
-- `staging.organisations.monthly_price` is a single NUMERIC(10,2) with no
-- description, no start date, and no way to say "and Rs 8,000/mo for support
-- since March". It is SELECTed by four endpoints (admin_orgs.py:329, :617,
-- :793, :1288, and rendered again at :1390 and :1651) and it is CHARGED BY
-- NOTHING — no code path anywhere turns it into an invoice line. An invoice is
-- a hand-typed `line_items` JSONB and a hand-typed total.
--
-- The owner bills a client for five things, not one:
--     1. Platform fee        — always present, one amount, no toggle
--     2. Support plan        — optional, off by default
--     3. Integration setup   — optional, off by default, one-off
--     5. Ongoing support     — optional, off by default
--     4. Credit top-up       — never configured; born from the top-up dialog
-- 2, 3 and 5 are ONE shape: {enabled, description, amount}. This migration is
-- that shape, as a table.
--
-- After this file, an invoice stops being a total somebody typed and becomes a
-- QUERY OVER THE LINES DUE IN A PERIOD. `invoice_billing_lines` is what makes
-- that query idempotent: a line can be billed once per period, enforced by a
-- unique index rather than by remembering.
--
-- There is no payment gateway and there will not be one. An invoice collects by
-- carrying a UPI address, which is why section 3 snapshots the VPA onto the
-- invoice rather than joining to it — changing the payee later must not
-- silently rewrite an invoice already sent.
--
-- ── WHICH IS AUTHORITATIVE: THE LINE OR monthly_price ───────────────────────
--
-- SAID ONCE, HERE, AND NOWHERE ELSE:
--
--   · `staging.org_billing_lines` IS AUTHORITATIVE for what an org is charged.
--   · `staging.organisations.monthly_price` SURVIVES as a DENORMALISED MIRROR
--     of the single OPEN `platform` line. It is DISPLAY AND COMPATIBILITY ONLY.
--     Nothing charges from it. It is not dropped because four endpoints select
--     it and three screens render it, and breaking those to win a column is a
--     bad trade.
--   · From the application change onward, PATCH /admin/orgs/{org_id}/settings
--     writes BOTH, IN ONE TRANSACTION. Never one without the other.
--   · `staging.v_org_platform_line_drift` (section 5) exists to prove it and
--     MUST ALWAYS RETURN ZERO ROWS — exactly the contract 095 gave
--     `v_org_credit_drift`.
--   · IF THE TWO EVER DISAGREE, THE LINE WINS AND monthly_price IS THE BUG.
--     Repair by rewriting the scalar from the line, never the other way round:
--     the line carries a description, a start date and an author, and the
--     scalar carries none of those, so the scalar cannot be reconstructed from
--     anything else while the line can always be flattened back down.
--
-- YES, THIS MIGRATION BACKFILLS. Section 4 creates one open `platform` line per
-- org with monthly_price > 0, so the drift view is empty the moment this file
-- commits rather than "once the application ships". A view that is allowed to
-- be non-empty for a while is a view nobody ever looks at again.
--
-- ── ROW COUNTS THIS ANALYSIS ASSUMES (carried from 095, verified 2026-08-04) ─
--     staging.organisations                 3 rows
--     staging.subscriptions                 3 rows
--     staging.hub_org_credit_transactions 171 rows  (NOT TOUCHED by this file)
--     staging.hub_org_credits               3 rows  (not touched)
--     staging.credit_prices                16 rows  (7 rows added, section 6)
--     staging.subscription_invoices         not counted; bounded by 3 orgs and
--                                           hand-raised invoices only, and the
--                                           lock analysis below does not depend
--                                           on the number
--     staging.org_billing_lines             does not exist yet
--     staging.invoice_billing_lines         does not exist yet
--
-- ── HOW TO READ THE LOCK NOTES ──────────────────────────────────────────────
--
-- Each statement is annotated with the lock it takes. Two things are true of
-- ALL of them and are not repeated at every line:
--
--   1. THIS IS ONE TRANSACTION, SO EVERY LOCK IS HELD UNTIL COMMIT. The
--      per-statement note describes how long the statement takes to acquire and
--      do its work, not how long the lock is held. At these row counts the
--      whole file is well under a second, which is why one transaction is the
--      right shape: a half-applied billing schema — lines without the invoice
--      join table, or a backfill without the drift view that polices it — is
--      far worse than a sub-second write block.
--
--   2. THE RISK IS ACQUISITION, NOT WORK. The two ALTER TABLE … ADD COLUMNs in
--      section 3 take AccessExclusiveLock on `subscription_invoices` and
--      `organisations`. Neither rewrites the table (PG 11+, constant defaults),
--      so the work is a catalog update measured in microseconds — but the
--      REQUEST queues behind any open transaction already holding a lock on
--      those tables, and while it queues it blocks every reader that arrives
--      after it. `organisations` is read on essentially every request in this
--      product. One stuck session turns a millisecond migration into an
--      outage. The lock_timeout below makes that a fast, clean rollback
--      instead of a hope. Run this when the app is quiet.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
--
-- Safe to apply BEFORE the application changes, and that is the intended order:
--
--   · Sections 1–3 create objects nothing reads yet.
--   · Section 4's backfill makes the drift view empty on day one. Until
--     PATCH /settings is taught to write both, an operator editing
--     monthly_price through the existing screen puts that org INTO the drift
--     view. That is the view working. Watch it across the gap.
--   · Section 6 must land BEFORE services/social_publisher.py starts emitting
--     ref_id='social_send:{platform}', or `price_of` raises UnknownPrice and
--     the post 500s. Note the 60-second price cache in services/credits.py
--     (`_PRICE_CACHE_TTL = 60.0`): a running process will not see these seven
--     rows for up to a minute after COMMIT, so leave a minute between this file
--     and that deploy. The application's UnknownPrice → 'social_send' fallback
--     covers the gap; the wait is so nobody has to rely on it.
--
-- NOTHING HERE TOUCHES A BALANCE. No wallet column, no ledger row, no price
-- moves — the seven `credit_prices` rows in section 6 are all 0 credits,
-- identical to the `social_send` row they split. This file cannot change what
-- anybody is charged today. It can only change what a future invoice says.

BEGIN;

-- Fail fast rather than freeze the product. Without lock_timeout, the ALTER in
-- section 3 waits indefinitely for its AccessExclusiveLock on `organisations`
-- and every request that reads an org waits behind it. Five seconds is far
-- longer than any honest transaction on these tables. SET LOCAL — scoped to
-- this transaction, reverted at COMMIT, changes nothing for anyone else.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ════════════════════════════════════════════════════════════════════════════
-- GUARD 0 — 095 MUST BE APPLIED FIRST
-- ════════════════════════════════════════════════════════════════════════════
--
-- Section 6 inserts seven rows into staging.credit_prices, which 095 creates.
-- Without this guard the file aborts on that statement with a bare "relation
-- does not exist", six sections after the one that actually needed checking,
-- and the reader goes looking for a typo in a table name that is spelled
-- correctly. Say the real answer out loud instead.
--
-- The transaction rolls back either way and nothing is left half-applied. This
-- guard buys a legible error, not safety.
DO $$
BEGIN
    IF to_regclass('staging.credit_prices') IS NULL THEN
        RAISE EXCEPTION
          'ABORT: staging.credit_prices does not exist, so migration 095 has '
          'not been applied. Apply 095_credit_model.sql first — 096 section 6 '
          'prices the per-platform social sends into that table.';
    END IF;
    IF to_regclass('staging.subscription_invoices') IS NULL THEN
        RAISE EXCEPTION
          'ABORT: staging.subscription_invoices does not exist, so migration '
          '010_staging_schema_subscription.sql has not been applied. 096 '
          'section 2 references it and section 3 adds columns to it.';
    END IF;
END $$;
-- Lock: AccessShareLock on the catalog only. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE LINES
-- ════════════════════════════════════════════════════════════════════════════
--
-- The five things a client is billed for. `platform` is always present and has
-- no toggle; support/setup/ongoing are the same shape with a checkbox that is
-- OFF until someone ticks it; `topup` rows are BORN from the top-up dialog,
-- never typed — the dialog creates one in the same transaction as the credit
-- grant, so "credits added but never billed" is not a state this system can
-- reach.
--
-- ── created_by AND ended_by ARE TEXT, NOT UUID, AND THIS IS THE ONE PLACE ────
-- ── THIS FILE KNOWINGLY DEPARTS FROM THE SPEC IT WAS WRITTEN FROM ───────────
--
-- A USER ID IN THIS PRODUCT IS TEXT of the form `user_549c9cac35aa`, because
-- `public.users.user_id` is text. This repo has paid for that fact twice:
--     · 030_created_by_uuid_to_text.sql — "Production user_ids are text (e.g.
--       "user_admin001"), not UUIDs. Staging module tables had these columns as
--       UUID, causing 500 errors on every INSERT."
--     · 092_sales_target_salesperson_is_a_user_id.sql — a uuid column meant a
--       sales target could never be saved BY ANYONE, IN ANY ORG, and it went
--       unnoticed because the browser sees a 500 with no CORS headers and there
--       is no response body to report.
-- The adjacent credit table already has the right answer:
-- `staging.hub_org_credit_transactions.created_by` is TEXT
-- (052_org_credit_tables.sql:33), and 095 wrote
-- `staging.org_member_credits.user_id TEXT` with the same reasoning attached.
--
-- The routers that will write these columns pass `user["user_id"]` verbatim. As
-- UUID, POST /v1/billing/orgs/{org_id}/lines would 500 on its first real call
-- and the screen would say nothing useful. TEXT is not a preference here; UUID
-- is a known, twice-diagnosed defect.
--
-- SEE ALSO, AND NOT FIXED HERE: `staging.subscription_invoices.approved_by` and
-- `.collected_by` are UUID (010:96-97) and routers/subscription.py writes
-- `user["user_id"]` into both (create_invoice, record_payment). That is the
-- same defect, it predates this migration, and repairing it is an ALTER COLUMN
-- TYPE — not additive, not this file's job, and inside another agent's file
-- this batch. Flagged, deliberately not fixed, exactly as 092 left
-- `graha_deals.owner_id` alone.
CREATE TABLE IF NOT EXISTS staging.org_billing_lines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    kind          TEXT NOT NULL
                  CHECK (kind IN ('platform','support','setup','ongoing','topup')),

    description   TEXT NOT NULL CHECK (btrim(description) <> ''),
    amount        NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency      TEXT NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),

    cadence       TEXT NOT NULL CHECK (cadence IN ('monthly','one_off')),

    -- Always the 1st of a month, matching `hub_org_credits.period_start`, so a
    -- billing period and a credit period are the same object and never drift.
    --
    -- WRITTEN WITH AN EXPLICIT ::timestamp ON PURPOSE. `date_trunc('month', x)`
    -- where x is a DATE has two candidate overloads — date_trunc(text,
    -- timestamp), which is IMMUTABLE, and date_trunc(text, timestamptz), which
    -- is STABLE because it depends on the session TimeZone. `timestamptz` is
    -- the preferred type in the datetime category, so the unqualified form can
    -- resolve to the STABLE one, and a CHECK constraint requires IMMUTABLE:
    -- Postgres would refuse the constraint outright with "functions in check
    -- constraint expression must be marked IMMUTABLE" and abort this file at
    -- its first CREATE TABLE. The cast pins the immutable overload and is
    -- correct whichever way resolution would have gone.
    period_start  DATE NOT NULL
                  CHECK (period_start = date_trunc('month', period_start::timestamp)::date),
    -- NULL = open-ended (a monthly line still running). ENDING A LINE IS
    -- SETTING THIS, NEVER DELETING THE ROW: a deleted line silently rewrites
    -- what an already-issued invoice was for, and the ON DELETE RESTRICT in
    -- section 2 is what stops that being possible by accident.
    period_end    DATE CHECK (period_end IS NULL
                              OR period_end = date_trunc('month', period_end::timestamp)::date),

    -- What created this line, when it was not typed:
    --   'credit_tx:<uuid>'          — the top-up that ticked "add to invoice"
    --                                 (hub_org_credit_transactions.id is UUID)
    --   'marketplace_request:<uuid>'
    source_ref    TEXT,

    -- TEXT. See the block above this CREATE TABLE. public.users.user_id.
    created_by    TEXT,
    ended_by      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- No trigger maintains this. The one module allowed to write this table
    -- (services/billing_lines.py) sets it explicitly on every UPDATE. A trigger
    -- would be a second writer nobody reads.
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A one-off is due in exactly one period. Leaving period_end NULL on a
    -- one-off would bill a setup fee every month forever.
    CONSTRAINT org_billing_lines_span_ck CHECK (
        (cadence = 'one_off' AND period_end = period_start)
        OR (cadence = 'monthly' AND (period_end IS NULL OR period_end >= period_start))
    ),
    -- A top-up is a fact about a payment, not a subscription.
    CONSTRAINT org_billing_lines_topup_ck CHECK (
        kind <> 'topup' OR (cadence = 'one_off' AND source_ref IS NOT NULL)
    ),
    -- NOT IN THE SPEC; ADDED BECAUSE uq_obl_open_platform IS OTHERWISE NOT
    -- EXHAUSTIVE. That index only sees rows with period_end IS NULL, so a
    -- `platform` line written as one_off — which the CHECKs above otherwise
    -- permit — carries period_end = period_start, slips past the index, and
    -- sits alongside the open monthly platform line in the same month. The
    -- invoice query in §2.3 unions monthly-in-range with one_off-in-month, so
    -- both would land on the same invoice and the client would be charged the
    -- platform fee twice. Same shape as the topup constraint above: a rule the
    -- money code must obey, written as a constraint rather than as a code path.
    -- Only `platform` is constrained — a one-off support charge or a one-off
    -- ongoing charge is a thing a client can genuinely agree to.
    CONSTRAINT org_billing_lines_platform_ck CHECK (
        kind <> 'platform' OR cadence = 'monthly'
    )
);
-- Lock: AccessExclusiveLock on a relation that does not exist yet, so nothing
-- can be waiting on it. The FK to staging.organisations takes
-- ShareRowExclusiveLock on `organisations` — that BLOCKS WRITES to organisations
-- (not reads) for the duration of a catalog update, milliseconds at 3 rows.

CREATE INDEX IF NOT EXISTS idx_obl_org_period
    ON staging.org_billing_lines (org_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_obl_kind
    ON staging.org_billing_lines (org_id, kind);
-- Lock: ShareLock on a table with 0 rows, twice. Instant.
-- The first serves the "lines due in period M" query, which is the whole
-- invoice. The second serves the billing block's per-kind render.

-- Exactly one open platform line per org. Two would double the platform fee on
-- the next invoice and nothing downstream would notice — `line_items` is a
-- JSONB snapshot, so the duplicate would be baked into the issued document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_obl_open_platform
    ON staging.org_billing_lines (org_id)
    WHERE kind = 'platform' AND period_end IS NULL;
-- Lock: ShareLock, 0 rows. Instant.
-- Not created CONCURRENTLY, and it cannot be: CREATE INDEX CONCURRENTLY is
-- illegal inside a transaction block and this file must stay one BEGIN/COMMIT.
-- At 0 rows the point is moot; it is stated so the next author does not
-- reintroduce the question.

-- A top-up creates one line, however many times the request is retried. Paired
-- with the top-up handler doing its INSERT in the SAME transaction as
-- credits.grant, this is what makes "add to invoice" idempotent without the
-- handler having to remember anything.
CREATE UNIQUE INDEX IF NOT EXISTS uq_obl_source_ref
    ON staging.org_billing_lines (source_ref)
    WHERE source_ref IS NOT NULL;
-- Lock: ShareLock, 0 rows. Instant.
-- GLOBAL, not per-org, for the same reason 095 made uq_org_credit_tx_idempotency
-- global: the key already contains the transaction id, so a global unique adds
-- nothing except the ability to catch a source_ref reused ACROSS orgs — which
-- would be a bug however it was caught, and is much better caught here than by
-- a customer reading someone else's top-up on their invoice.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. WHICH LINES AN INVOICE ACTUALLY BILLED
-- ════════════════════════════════════════════════════════════════════════════
--
-- `subscription_invoices.line_items` STAYS as the frozen human-readable
-- snapshot — an issued invoice must never change because a line was later
-- edited. This table is the machine-readable half: it is what stops the same
-- line being billed twice for the same month.
--
-- ON DELETE RESTRICT on line_id, not CASCADE, and the asymmetry is the point.
-- Deleting an INVOICE may reasonably discard its join rows (CASCADE). Deleting
-- a LINE that an invoice has already billed must be impossible (RESTRICT) —
-- otherwise the row that proves what a client was charged disappears while the
-- charge stands. §4.3 says lines are ended, never deleted; this is that rule
-- with teeth.
CREATE TABLE IF NOT EXISTS staging.invoice_billing_lines (
    invoice_id   UUID NOT NULL REFERENCES staging.subscription_invoices(id) ON DELETE CASCADE,
    line_id      UUID NOT NULL REFERENCES staging.org_billing_lines(id) ON DELETE RESTRICT,
    -- Denormalised from the line: WHICH period this invoice billed it for. A
    -- monthly line is billed many times over its life and only this column
    -- distinguishes those billings from each other.
    period_start DATE NOT NULL,
    -- Denormalised from the line AT ISSUE TIME. The line's amount may change
    -- afterwards; what the client was charged may not.
    amount       NUMERIC(12,2) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (invoice_id, line_id)
);
-- Lock: AccessExclusiveLock on a relation nobody can see yet;
-- ShareRowExclusiveLock on staging.subscription_invoices AND on
-- staging.org_billing_lines for the two foreign keys. The first of those blocks
-- writes to subscription_invoices for the length of a catalog update.

-- THE NO-DOUBLE-CHARGE RULE, AS AN INDEX RATHER THAN AS A CODE PATH.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ibl_line_period
    ON staging.invoice_billing_lines (line_id, period_start);
-- Lock: ShareLock, 0 rows. Instant.
--
-- READ THIS BEFORE WRITING THE REFUND PATH. §2.3 describes the lines due in a
-- period as excluding any line already billed "on an invoice whose
-- payment_status <> 'refunded'" — i.e. refunding an invoice makes its lines
-- billable again. This index does not agree with that on its own: the join rows
-- of the refunded invoice are still present, so re-billing the same line for
-- the same period raises a unique violation.
--
-- The resolution is NOT to weaken this index. It is that voiding or refunding
-- an invoice must DELETE its staging.invoice_billing_lines rows in the same
-- transaction as it sets payment_status='refunded' — the join table records
-- what is CURRENTLY billed, and a refunded invoice bills nothing. The frozen
-- `line_items` snapshot on the invoice remains as the historical record, which
-- is what it is for.
--
-- Nothing sets payment_status='refunded' today — no code path in
-- routers/subscription.py writes that value — so this is a note for whoever
-- adds one, not a live bug.
--
-- NOT CREATED, deliberately: the spec also lists idx_ibl_invoice on
-- (invoice_id). The PRIMARY KEY is a btree on (invoice_id, line_id) and leads
-- with invoice_id, so it already answers every lookup and every ON DELETE
-- CASCADE scan by invoice. A second index on a strict prefix of the primary key
-- is write cost with no read benefit. Say so here rather than leave the next
-- reader to wonder whether it was forgotten.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. INVOICE PROVENANCE AND THE COLLECTION MECHANISM
-- ════════════════════════════════════════════════════════════════════════════
--
-- `generated_from` distinguishes an invoice assembled from lines from one
-- somebody typed. Both remain legal, permanently: Kartavaya's clients agree
-- terms verbally, an invoice must be creatable standalone, and NOTHING MAY GATE
-- PROVISIONING ON AN INVOICE EXISTING. The default is 'manual' precisely
-- because every invoice raised before this migration was one.
--
-- The UPI columns are the entire collection mechanism. There is no payment
-- gateway and there will not be one. They are snapshotted onto the invoice
-- (from the platform org, not from the client) so that changing the payee later
-- does not silently rewrite an invoice already sent.
ALTER TABLE staging.subscription_invoices
    ADD COLUMN IF NOT EXISTS generated_from TEXT NOT NULL DEFAULT 'manual'
        CHECK (generated_from IN ('manual','lines')),
    ADD COLUMN IF NOT EXISTS upi_vpa        TEXT,
    ADD COLUMN IF NOT EXISTS upi_payee_name TEXT;
-- Lock: AccessExclusiveLock on staging.subscription_invoices.
--
-- No table rewrite: 'manual' is a constant default, so PG 11+ stores it as the
-- missing value in pg_attribute and the existing rows are not touched. The
-- inline CHECK may still cost a validating scan of the table depending on
-- version — it cannot fail, since every existing row takes the constant default
-- — and at this table's size both readings are milliseconds. As the header
-- says, the cost here is ACQUIRING the lock, not the work behind it.
--
-- IF NOT EXISTS skips the whole clause, CHECK included, when the column is
-- already there. That is what makes this statement replayable.
--
-- SIDE EFFECT WORTH KNOWING: routers/subscription.py `create_invoice` returns
-- `dict(row)` from an INSERT … RETURNING *, and `record_payment` reads
-- SELECT *. Three new keys therefore appear in the POST /admin/invoices
-- response body the moment this lands, before any Python changes. Additive to a
-- JSON object, so no existing consumer breaks — but it is a response-shape
-- change caused by a migration, and those are worth writing down.

ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS upi_vpa        TEXT,
    ADD COLUMN IF NOT EXISTS upi_payee_name TEXT;
-- Lock: AccessExclusiveLock on staging.organisations — THE MOST CONTENDED
-- TABLE THIS FILE TOUCHES. Both columns are nullable with no default, so this
-- is a pure catalog update: no rewrite, no scan, microseconds of work. The
-- danger is entirely in the queue behind it. See header note 2.
--
-- These live on `organisations` rather than on a settings blob because the
-- PLATFORM org's row is the payee for every invoice Aekam raises, and section 5
-- of 095 already established `organisations` as where a platform-wide fact
-- lives (`is_platform_org`).


-- ════════════════════════════════════════════════════════════════════════════
-- 4. BACKFILL THE PLATFORM LINE FROM THE SCALAR IT REPLACES
-- ════════════════════════════════════════════════════════════════════════════
--
-- One open `platform` line per org that is currently charged something, at the
-- amount it is currently charged, starting this month. `period_end` is NULL —
-- it is still running. `created_by` is NULL — no person did this, a migration
-- did, and inventing an author is worse than admitting there isn't one.
--
-- `period_start = date_trunc('month', NOW())` and NOT an earlier date: this
-- line asserts "the platform fee is Rs X from now on". Backdating it would
-- make every past month suddenly billable by the §2.3 query and an operator
-- pressing "load lines" for June would raise an invoice for a fee that was
-- already collected some other way. The line starts where the evidence starts.
--
-- ── IDEMPOTENCY: WHY THE SPEC'S BARE `ON CONFLICT DO NOTHING` IS NOT ENOUGH ──
--
-- `ON CONFLICT DO NOTHING` with no target does consider partial unique indexes
-- as arbiters, so a second run WOULD be caught by uq_obl_open_platform while an
-- open platform line exists. It is kept below as the last line of defence.
--
-- It is not sufficient on its own, because it only sees OPEN lines. Consider an
-- org whose platform fee was raised: the application ends the old line
-- (period_end set) and opens a new one. Now suppose someone replays this file
-- at a moment when the org has an ENDED platform line and, for whatever reason,
-- no open one — a partially-applied application change, a restore from a backup
-- taken between the two writes. The partial index has nothing in it, the
-- INSERT succeeds, and the org acquires a SECOND platform fee for this month
-- from a file that was only ever supposed to be replayable.
--
-- So the guard is NOT EXISTS over ANY platform line, open or ended:
--     · an org that has never had one gets one — including an org created after
--       096 by a code path that only wrote monthly_price, which is exactly the
--       drift this backfill exists to prevent;
--     · an org that has ever had one is left alone, and if its scalar and its
--       line disagree, section 5's view reports it and A HUMAN DECIDES. A
--       migration must not guess a commercial term. 095 said the same thing
--       about monthly_credits and it is no less true of a rupee amount.
--
-- The WHERE clause here and the predicate in section 5's view MUST STAY IN
-- LOCKSTEP. Today both consider every org with monthly_price > 0, active or
-- not. Narrow one without narrowing the other and the drift view is non-empty
-- on the day it ships, which retires it.
INSERT INTO staging.org_billing_lines
       (org_id, kind, description, amount, currency, cadence, period_start, created_by)
SELECT o.id, 'platform', 'Platform fee',
       o.monthly_price, 'INR', 'monthly',
       date_trunc('month', NOW())::date, NULL
FROM   staging.organisations o
WHERE  COALESCE(o.monthly_price, 0) > 0
  AND  NOT EXISTS (
        SELECT 1 FROM staging.org_billing_lines l
         WHERE l.org_id = o.id AND l.kind = 'platform'
       )
ON CONFLICT DO NOTHING;
-- Lock: RowExclusiveLock on staging.org_billing_lines; AccessShareLock on
-- staging.organisations for the scan; the FK takes row-share locks on the 3
-- referenced org rows. Reads and writes to `organisations` continue throughout.
-- Instant.
--
-- COALESCE(monthly_price, 0) even though the column is NOT NULL DEFAULT 0: it
-- is not created by any file in this folder — server.py:3559 adds it as startup
-- DDL — so an environment where that startup path has not run is a real shape,
-- and `> 0` on a NULL silently selects nothing rather than failing loudly.
--
-- 'Platform fee' is a literal, not derived from the plan name. The line's
-- description is what the client reads on the invoice, and a plan code
-- ('professional', which no screen in this product speaks — every screen says
-- free/starter/growth/scale) is not that.


-- ════════════════════════════════════════════════════════════════════════════
-- 5. THE DRIFT VIEW — A REPORT, NOT A CONSTRAINT
-- ════════════════════════════════════════════════════════════════════════════
--
-- ANY ROW RETURNED BY THIS VIEW IS A BUG: either PATCH /admin/orgs/{id}/settings
-- wrote monthly_price without writing the platform line, or something created a
-- line without mirroring it back. It must be EMPTY AT ALL TIMES, exactly like
-- staging.v_org_credit_drift, and it is the single query to run after each
-- deploy in this programme lands.
--
-- A VIEW AND NOT A CHECK, for the same reason 095 gave: a constraint would
-- enforce on every UPDATE to `organisations` from the moment this file commits,
-- including the writes made by the un-migrated code path that is still live
-- during the gap between this migration and the application deploy. That takes
-- the product down to catch a reporting problem. This is a query you can read.
--
-- LEFT JOIN, not JOIN: the row that matters most is the org with a monthly_price
-- and NO line at all, and an inner join is exactly the join that hides it.
CREATE OR REPLACE VIEW staging.v_org_platform_line_drift AS
SELECT o.id AS org_id, o.name,
       COALESCE(o.monthly_price, 0) AS monthly_price,
       l.amount                     AS platform_line_amount
FROM   staging.organisations o
LEFT   JOIN staging.org_billing_lines l
       ON l.org_id = o.id AND l.kind = 'platform' AND l.period_end IS NULL
WHERE  COALESCE(o.monthly_price, 0) <> COALESCE(l.amount, 0);
-- Lock: AccessExclusiveLock on the new view object; AccessShareLock on
-- staging.organisations and staging.org_billing_lines to resolve the column
-- lists. No data is read at definition time. Instant.
--
-- CREATE OR REPLACE, so a later migration can redefine it without a DROP. The
-- column list may not change under OR REPLACE; adding a column here later means
-- a DROP VIEW … CREATE VIEW pair in that file.


-- ════════════════════════════════════════════════════════════════════════════
-- 6. PER-PLATFORM SOCIAL PRICES, SO "PER SOURCE" CAN MEAN "PER PLATFORM"
-- ════════════════════════════════════════════════════════════════════════════
--
-- services/social_publisher.py maps only whatsapp_business → 'whatsapp_send'.
-- Facebook, Instagram, Threads, YouTube, TikTok, LinkedIn and X ALL write
-- ref_id='social_send', and the platform survives only inside the free-text
-- description — the same free text 095 spent nine columns teaching this system
-- to stop trusting. The billing screens are meant to show spend PER SOURCE, and
-- "social" collapsed into one row cannot answer which channel cost what.
--
-- `price_of` resolves a `channel` spend by EXACT ref_id against
-- staging.credit_prices and raises UnknownPrice rather than guessing
-- (services/credits.py:346-359). So the ref_id cannot be split until the price
-- rows exist — the split and the seed are one change, and this is its half.
--
-- EVERY ROW IS 0 CREDITS, IDENTICAL TO THE `social_send` ROW IT SPLITS. THIS
-- MIGRATION MUST NOT MOVE A PRICE. A price change and a plumbing change must
-- never ship together, or the next time somebody asks why the bill moved,
-- nobody can tell them which of the two did it — 095 section 9 said this first
-- and it is the same rule.
--
-- `social_send` itself is deliberately left in place. A platform with no seeded
-- row keeps working through the application's UnknownPrice fallback and lands
-- in the `social` tab under the unqualified id, which is a legible degradation
-- rather than a 500 on someone's post.
INSERT INTO staging.credit_prices (kind, credits, unit_size, is_active, notes)
VALUES ('social_send:facebook',  0, 1, TRUE, 'Organic publish — no AI cost'),
       ('social_send:instagram', 0, 1, TRUE, 'Organic publish — no AI cost'),
       ('social_send:threads',   0, 1, TRUE, 'Organic publish — no AI cost'),
       ('social_send:youtube',   0, 1, TRUE, 'Organic publish — no AI cost'),
       ('social_send:tiktok',    0, 1, TRUE, 'Organic publish — no AI cost'),
       ('social_send:linkedin',  0, 1, TRUE, 'Organic publish — no AI cost'),
       ('social_send:x',         0, 1, TRUE, 'Organic publish — no AI cost')
ON CONFLICT (kind) DO NOTHING;
-- Lock: RowExclusiveLock on staging.credit_prices, 16 rows, 7 added. Instant.
-- DO NOTHING, not DO UPDATE: replaying this file must never reset a price the
-- owner has since changed. Same contract as 095's seed.
--
-- The seven keys must match the platform identifiers social_publisher.py uses
-- to build the ref_id, character for character. They are lower-case and
-- unprefixed here because that is how the publisher names its platforms; if
-- that file ever renames one, the price disappears and the post 500s on the
-- UnknownPrice path unless the fallback catches it.

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER COMMIT AND READ IT WITH YOUR EYES. DO NOT AUTOMATE IT.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. THE ONE THAT MUST COME BACK EMPTY. If it does not, section 4's backfill
--    did not cover an org, and the answer is a decision about a commercial
--    term, not another migration:
--
--        SELECT * FROM staging.v_org_platform_line_drift;
--
-- 2. Every org, its scalar, and the line that now mirrors it. Check that the
--    amounts match what each client actually pays, because monthly_price has
--    never been charged by anything and may never have been kept honest:
SELECT o.id, o.name, o.is_active, o.monthly_price,
       l.id AS platform_line_id, l.amount AS platform_line_amount,
       l.period_start, l.period_end
  FROM staging.organisations o
  LEFT JOIN staging.org_billing_lines l
         ON l.org_id = o.id AND l.kind = 'platform' AND l.period_end IS NULL
 ORDER BY o.name;

-- 3. The payee. Both columns are NULL on every row until somebody sets them,
--    and an invoice raised before they are set carries no way to pay it:
--
--        SELECT id, name, is_platform_org, upi_vpa, upi_payee_name
--          FROM staging.organisations WHERE is_platform_org;
--
--    If that returns no rows at all, is_platform_org was never set — 095 left
--    it FALSE everywhere on purpose and asked for the same check.
--
-- 4. The seven new prices, all zero:
--
--        SELECT kind, credits, is_active FROM staging.credit_prices
--         WHERE kind LIKE 'social_send%' ORDER BY kind;
--
-- 5. NOT VERIFIABLE BY QUERY, AND THE MOST LIKELY THING TO BITE:
--    staging.subscription_invoices.approved_by and .collected_by are UUID while
--    routers/subscription.py writes public.users.user_id (TEXT, `user_xxxx`)
--    into both. See section 1. If POST /v1/subscription/admin/invoices has
--    never been exercised by a real operator, expect it to fail on the first
--    try, and expect the failure to look like a CORS error in the browser
--    rather than a type error — 092 documents that signature.
