-- 184 · Revenue attribution — the column that says WHO sold it.
--
-- ── WHAT THIS FILE TOUCHES, exactly ──────────────────────────────────────────
--
--   ALTERS   staging.vikray_orders    ADD COLUMN salesperson_id text NULL
--   ALTERS   staging.ganit_invoices   ADD COLUMN salesperson_id text NULL
--   ADDS     two CHECK constraints (one per column), each as its OWN
--            `ALTER TABLE ... ADD CONSTRAINT` and each guarded — never inline
--            on the ADD COLUMN (see THE INLINE-CHECK TRAP below)
--   CREATES  two partial indexes, one per column
--   COMMENTS on the two new columns and on the two `line_items` columns
--   BACKFILLS NOTHING. Not one UPDATE, not one INSERT, not one DELETE.
--   DROPS nothing. RENAMES nothing. RETYPES nothing. Touches no CHECK that
--   already exists on either table.
--
-- IF IT RUNS TWICE: nothing happens. Both ALTERs are ADD COLUMN IF NOT EXISTS,
-- both constraints and both indexes are added inside a NOT EXISTS guard, and
-- COMMENT ON is idempotent by definition. There is no seed and no UPDATE, so a
-- second run cannot restate a fact a person has since corrected.
--
-- ── WRITE-PATH SIDE EFFECTS ON PRODUCTION ────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE ONE SUPABASE DATABASE and production writes to
-- the `staging` schema too, so everything below runs against live rows. What
-- actually happens on the day:
--
--   · ADD COLUMN, nullable, no DEFAULT, is a CATALOG-ONLY change in PostgreSQL
--     11+ (this database is 17.6). No table rewrite. No row is read or written.
--     The ACCESS EXCLUSIVE lock is held for microseconds.
--   · The CHECK constraints are added with NOT VALID omitted DELIBERATELY: the
--     column was created one statement earlier and is NULL on every row, so the
--     validation scan finds nothing to check and completes instantly. A
--     NOT VALID constraint here would buy nothing and would leave a permanently
--     unvalidated constraint behind for somebody to wonder about.
--   · The indexes are PARTIAL — `WHERE salesperson_id IS NOT NULL` — so each
--     one is built over ZERO rows and occupies a page. They exist now rather
--     than later because building them once the columns are populated is a real
--     scan of 788 and 377 rows under a lock; building them empty is free.
--   · Nothing reads these columns until services/report_defs/commission_reports
--     is deployed, and nothing WRITES them until the order and invoice write
--     paths are changed (see WHAT THE WRITE PATH MUST START CAPTURING). An
--     application running the old code is completely unaffected — a SELECT * on
--     either table returns one extra key that every consumer indexes past.
--
-- LOCKS: two ALTER TABLEs, each ACCESS EXCLUSIVE for the duration of a catalog
-- update. The risk is the lock QUEUE, never the lock: if a long transaction
-- already holds vikray_orders or ganit_invoices, this ALTER waits behind it and
-- every later reader of Sales and Finance waits behind this ALTER. `SET LOCAL
-- lock_timeout` below caps that at five seconds. A migration that failed and
-- which you re-run for free is strictly better than a finance module that stops
-- answering.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- The owner asked for what a UK consultancy gives its consultants: turnover,
-- gross profit, margin and commission, per person, per week / month / quarter /
-- year-to-date / year.
--
-- NONE OF IT IS COMPUTABLE TODAY, and the reason is one missing column repeated
-- across three tables. Measured read-only against the live database on
-- 2026-08-21, all organisations:
--
--   staging.graha_deals       675 deals. `assigned_to` (text) filled on 141.
--                             `owner_id` (uuid) NULL on ALL 675 and no code
--                             path writes it. All 141 filled values resolve to
--                             a real public.users row, so `assigned_to` IS the
--                             house convention — that is what this file copies.
--
--   staging.vikray_orders     377 active orders. NO SALESPERSON COLUMN AT ALL.
--                             `created_by` is a data-entry stamp: 319 of the
--                             377 are one account.
--
--   staging.ganit_invoices    788 active invoices. NO SALESPERSON COLUMN.
--                             `created_by` and `prepared_by` DISAGREE on 751 of
--                             them, and 693 were created by ONE account.
--                             ₹11.55 crore of signed turnover sits behind that
--                             single account.
--
--   the bridge                1 of 377 orders and 5 of 788 invoices carry a
--                             `deal_id`. So the deal's `assigned_to` — the only
--                             attribution the product has ever recorded — does
--                             not reach the money. It cannot be borrowed.
--
-- A "who sold this" derived from `created_by` would be a number the firm would
-- pay commission on. It is a data-entry stamp. This file adds the real column
-- instead of deriving a wrong one.
--
-- ── WHY THERE IS NO BACKFILL, AND WHY THERE CAN NEVER BE ONE ─────────────────
--
-- There is no historical record of who sold what. Not a stale one, not a partial
-- one — none. The four candidate sources were each examined and each rejected:
--
--   `created_by` / `prepared_by`  a data-entry stamp, and demonstrably so: one
--                                 account holds 693 of 788 invoices and the two
--                                 columns contradict each other on 751 rows.
--                                 Copying it would attribute 96% of the firm's
--                                 turnover to one person.
--   `deal_id` -> `assigned_to`    the bridge is empty (1 order, 5 invoices).
--                                 It would attribute six documents and leave
--                                 1,159 blank, which is not a backfill.
--   `contact_id` -> owner         graha_contacts carries `assigned_to` too, but
--                                 the contact's owner is who MANAGES the
--                                 relationship now, not who sold the invoice
--                                 two years ago. Attributing historic commission
--                                 off a current ownership field pays the wrong
--                                 person by design.
--   audit_log                     holds no per-document authorship for these
--                                 tables over the historic range.
--
-- So this column starts NULL on all 1,165 documents and stays NULL until a human
-- or a write path sets it. That is not a gap in the migration; it is the honest
-- state of the record. Everything downstream — services/commission.py, both
-- report sections — is built to print "not attributable" for a NULL and NEVER
-- ₹0. A zero is a claim that nothing was sold. NULL is the truth: nobody wrote
-- down who sold it.
--
-- ── THE TYPE IS text, NOT uuid, AND THAT IS NOT A MISTAKE ────────────────────
--
-- `public.users.user_id` is TEXT — production user ids look like
-- 'user_admin001' and always have. Migration 030 converted every
-- created_by / assigned_to / approved_by column in this schema from uuid to
-- text for exactly that reason, after the uuid versions 500'd on every INSERT.
-- `staging.vikray_targets.salesperson_id` is already text and is the closest
-- existing sibling; `staging.manav_offboarding_custody.reassigned_to_user_id`
-- (migration 164) is text for the same reason. text it is.
--
-- NO FOREIGN KEY to public.users, for the same reason none of those columns has
-- one: `public` and `staging` are separate schemas with separate lifecycles, and
-- an FK here would make deleting a user fail against every document they ever
-- touched. The referential promise is carried by the CHECK (a non-empty handle)
-- and by the reader, which LEFT JOINs and prints an honest "no longer a member"
-- rather than dropping the row.
--
-- ── THE INLINE-CHECK TRAP, WHICH THIS FILE DELIBERATELY AVOIDS ───────────────
--
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS x text CHECK (...)` skips the WHOLE
-- clause when the column already exists — the constraint is silently NOT
-- created, and `pg_constraint` is then the only place the truth lives. This has
-- bitten this repository before. Every constraint below is therefore its own
-- statement inside a DO block that reads `pg_constraint` first.
--
-- ── THE COST KEY: A CONVENTION, NOT A COLUMN ─────────────────────────────────
--
-- Gross profit needs a cost. There is nowhere to put one today:
--
--   · `staging.vikray_orders.line_items` — 389 lines live, and NOT ONE carries a
--     cost key. The keys actually present are: description, gst_rate, hsn_code,
--     rate, amount, qty, discount_pct, unit, product_id, quantity, line_total,
--     sac_code, gst_amount.
--   · `staging.ganit_invoices.line_items` — 1,342 lines, same story, plus `sac`
--     and `hsn` as unprefixed twins.
--   · `staging.ganit_products.cost_price` EXISTS and is filled on 2 of 106
--     products. It is also the WRONG place to read a historic cost from: a
--     product's cost today is not what it cost when the invoice was raised, and
--     reading it retrospectively re-prices last year's gross profit every time
--     procurement changes.
--
-- So the cost belongs ON THE LINE, captured at the moment the line is written,
-- and it needs no ALTER because both columns are already jsonb. This file
-- DOCUMENTS the key rather than adding a column:
--
--     line_items[].cost_price   numeric, per ONE unit, exclusive of tax, in the
--                               document's own currency, as at the moment the
--                               line was written. Absent means NOT RECORDED and
--                               must never be read as zero.
--
-- `cost_price` and not `unit_cost`, to match the name `ganit_products` already
-- uses for the same idea; per UNIT and not per line, to match `rate`, which is
-- the neighbouring key and is also per unit. Verified live: zero lines in either
-- table carry a `cost_price` key today, so nothing is being redefined.
--
-- ── WHAT THE WRITE PATH MUST START CAPTURING (NOT IN THIS FILE) ──────────────
--
--   1. routers/vikray.py    — order create/update must set `salesperson_id`.
--   2. routers/ganit.py     — invoice create/update must set `salesperson_id`,
--                             and must NOT default it to the caller. Defaulting
--                             to `created_by` reintroduces the exact fiction
--                             this column exists to replace, silently, and with
--                             the authority of a real column behind it. An
--                             unset salesperson must stay NULL.
--   3. both                 — when a line is written from a product, copy that
--                             product's `cost_price` onto the line as
--                             `cost_price`. Copy, never join: the line records
--                             what it cost THEN.
--   4. an order that becomes an invoice must carry `salesperson_id` across, or
--                             the two registers will disagree about the same sale.
--
-- Until (1) and (2) ship, this migration changes no figure any user sees. That
-- is intentional: the column has to exist before the form can offer it.
--
-- ── WHAT IS STILL NOT ATTRIBUTABLE AFTER THIS FILE ───────────────────────────
--
--   · Every document written before the write path changes. Permanently. There
--     is no source to recover it from.
--   · Any figure per EMPLOYEE, as opposed to per user account.
--     `staging.manav_employees.user_id` is text and is filled on 0 of 98 rows,
--     and 0 employee email addresses match any row in public.users. The HR
--     record and the login account are entirely disjoint sets — 98 employees,
--     32 users, no edge between them. Migration 185 puts the commission scheme
--     on the employee, which is where it belongs; joining that scheme to
--     attributed revenue requires `manav_employees.user_id` to be filled, and
--     that is a data task for the firm, not a migration. It is NOT done here
--     because guessing which login belongs to which employee is precisely the
--     class of guess this whole pair of files exists to stop.
--   · Cost, gross profit and margin, on every historic document, for the same
--     reason: no line ever recorded a cost.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   BEGIN;
--     DROP INDEX IF EXISTS staging.vikray_orders_salesperson_idx;
--     DROP INDEX IF EXISTS staging.ganit_invoices_salesperson_idx;
--     ALTER TABLE staging.vikray_orders  DROP COLUMN IF EXISTS salesperson_id;
--     ALTER TABLE staging.ganit_invoices DROP COLUMN IF EXISTS salesperson_id;
--   COMMIT;
--
-- DROP COLUMN takes its CHECK and its index with it. Reversal loses only
-- attribution recorded since the apply — which is nothing on the day, and is
-- real data the moment the write path ships. After that point, reverse by
-- exporting the two columns first.

BEGIN;

-- SET LOCAL is scoped to a transaction. Run outside one and PostgreSQL emits
-- `WARNING: SET LOCAL can only be used in transaction blocks` and the setting
-- takes no effect at all — the cap promised in the header would be inert and
-- the ALTERs below could queue behind a long transaction for as long as it
-- lasts, with every reader of Sales and Finance queued behind them. That is the
-- outage the timeout exists to prevent, so the BEGIN is load-bearing.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · The tables are the ones this file was written against.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
BEGIN
    IF to_regclass('staging.vikray_orders') IS NULL THEN
        RAISE EXCEPTION 'GUARD 1: staging.vikray_orders does not exist. '
                        'Migration 020 has not run.';
    END IF;
    IF to_regclass('staging.ganit_invoices') IS NULL THEN
        RAISE EXCEPTION 'GUARD 1: staging.ganit_invoices does not exist. '
                        'Migration 018 has not run.';
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 2 · The handle really is text.
--
-- If `public.users.user_id` were ever retyped to uuid, a text column here would
-- silently stop joining and every consultant would show nil turnover — a
-- failure that looks exactly like "nobody sold anything" and would be believed.
-- Refuse to add the column rather than add one that cannot join.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard2$
DECLARE t text;
BEGIN
    SELECT data_type INTO t
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND column_name = 'user_id';
    IF t IS NULL THEN
        RAISE EXCEPTION 'GUARD 2: public.users.user_id does not exist.';
    END IF;
    IF t <> 'text' THEN
        RAISE EXCEPTION
            'GUARD 2: public.users.user_id is % , not text. This file adds a '
            'text attribution column to match it (migration 030''s convention); '
            'adding one now would create a column that cannot join.', t;
    END IF;
END
$guard2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 3 · Neither table already carries a salesperson_id of another type.
--
-- ADD COLUMN IF NOT EXISTS would silently accept a pre-existing uuid column and
-- leave every reader below joining text to uuid. Verified live on 2026-08-21:
-- the only `salesperson_id` anywhere in the staging schema is
-- vikray_targets.salesperson_id, which is already text.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard3$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT table_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'staging'
           AND table_name IN ('vikray_orders', 'ganit_invoices')
           AND column_name = 'salesperson_id'
    LOOP
        IF r.data_type <> 'text' THEN
            RAISE EXCEPTION
                'GUARD 3: staging.%.salesperson_id already exists as % . '
                'This file will not silently leave a column of the wrong type '
                'in place.', r.table_name, r.data_type;
        END IF;
    END LOOP;
END
$guard3$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · The columns.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE staging.vikray_orders
    ADD COLUMN IF NOT EXISTS salesperson_id text;

ALTER TABLE staging.ganit_invoices
    ADD COLUMN IF NOT EXISTS salesperson_id text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The constraints — separate statements, guarded, NEVER inline.
--
-- The rule the CHECK enforces is one thing only: NULL or a real handle. The
-- empty string is refused because '' and NULL would otherwise both mean
-- "unattributed" while `count(salesperson_id)` counted only one of them — so a
-- register would report a coverage figure that is quietly wrong, which is worse
-- than reporting none. graha_deals holds 0 empty-string `assigned_to` values
-- today (measured), so nothing existing violates the same rule.
-- ═══════════════════════════════════════════════════════════════════════════
DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'staging' AND c.relname = 'vikray_orders'
           AND con.conname = 'vikray_orders_salesperson_id_ck'
    ) THEN
        ALTER TABLE staging.vikray_orders
            ADD CONSTRAINT vikray_orders_salesperson_id_ck
            CHECK (salesperson_id IS NULL OR length(btrim(salesperson_id)) > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'staging' AND c.relname = 'ganit_invoices'
           AND con.conname = 'ganit_invoices_salesperson_id_ck'
    ) THEN
        ALTER TABLE staging.ganit_invoices
            ADD CONSTRAINT ganit_invoices_salesperson_id_ck
            CHECK (salesperson_id IS NULL OR length(btrim(salesperson_id)) > 0);
    END IF;
END
$constraints$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · The indexes.
--
-- (org_id, salesperson_id) in that order: every read is org-scoped first — a
-- join on the person alone is the cross-tenant leak `graha_clients_join_leak`
-- records — and the consultant register then groups by person within one org.
-- PARTIAL, so the index holds only attributed documents: today that is zero
-- rows and zero cost, and even fully populated it never indexes the NULLs,
-- which no query looks up by.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS vikray_orders_salesperson_idx
    ON staging.vikray_orders (org_id, salesperson_id, order_date)
    WHERE salesperson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ganit_invoices_salesperson_idx
    ON staging.ganit_invoices (org_id, salesperson_id, invoice_date)
    WHERE salesperson_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · The documentation that lives in the database, not only in this file.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN staging.vikray_orders.salesperson_id IS
    'WHO SOLD IT — public.users.user_id (text), same convention as '
    'graha_deals.assigned_to and vikray_targets.salesperson_id. NULL means '
    'nobody recorded who sold it, and MUST be rendered "not attributable", '
    'never as zero turnover for anybody. Never default this to created_by: '
    'created_by is a data-entry stamp (319 of 377 orders are one account) and '
    'copying it attributes the firm''s turnover to whoever types.';

COMMENT ON COLUMN staging.ganit_invoices.salesperson_id IS
    'WHO SOLD IT — public.users.user_id (text). NULL means unrecorded, never '
    'zero. Distinct from created_by (who keyed it in) and from prepared_by '
    '(who drew the document): those two disagree on 751 of 788 live invoices, '
    'and 693 of 788 were created by one account, so neither can be read as '
    'authorship of the sale. Commission is computed from THIS column.';

COMMENT ON COLUMN staging.vikray_orders.line_items IS
    'Order lines. Recognised keys: description, hsn_code, sac_code, unit, '
    'qty|quantity, rate, discount_pct, gst_rate, gst_amount, amount|line_total, '
    'product_id. PLUS cost_price (numeric): the cost of ONE unit, exclusive of '
    'tax, in the document currency, AS AT the moment the line was written — '
    'copied from ganit_products.cost_price at write time, never joined at read '
    'time, because a product''s cost today is not what it cost then. An ABSENT '
    'cost_price means NOT RECORDED and must never be read as zero: zero cost is '
    'a claim of 100% gross margin. 0 of 389 live lines carry it (2026-08-21).';

COMMENT ON COLUMN staging.ganit_invoices.line_items IS
    'Invoice lines. Recognised keys: description, hsn_code|hsn, sac_code|sac, '
    'unit, qty|quantity, rate, discount_pct, gst_rate, gst_amount, '
    'amount|line_total, product_id. PLUS cost_price (numeric): the cost of ONE '
    'unit, exclusive of tax, AS AT the moment the line was written. Absent '
    'means NOT RECORDED, never zero. 0 of 1,342 live lines carry it '
    '(2026-08-21). Gross profit is not computable for any line without it.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · PROVE IT, IN THE SAME TRANSACTION.
--
-- This file's central claim is that it writes NO DATA. That claim is worth
-- exactly as much as the check that enforces it, so it is checked here and the
-- transaction rolls back rather than leaving attributed rows in production that
-- nobody meant to create.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_orders_attr   bigint;
    n_invoices_attr bigint;
    n_order_cost    bigint;
    n_invoice_cost  bigint;
    n_cols          int;
    n_checks        int;
    n_indexes       int;
    n_orders        bigint;
    n_invoices      bigint;
BEGIN
    -- VERIFY 1 — both columns exist and both are text.
    SELECT count(*) INTO n_cols
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name IN ('vikray_orders', 'ganit_invoices')
       AND column_name = 'salesperson_id'
       AND data_type = 'text';
    IF n_cols <> 2 THEN
        RAISE EXCEPTION
            'VERIFY 1: expected 2 text salesperson_id columns, found %. An '
            'ADD COLUMN IF NOT EXISTS silently did nothing.', n_cols;
    END IF;

    -- VERIFY 2 — both CHECKs are really there. This is the inline-check trap
    -- caught by reading pg_constraint rather than trusting the DDL above.
    SELECT count(*) INTO n_checks
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND con.conname IN ('vikray_orders_salesperson_id_ck',
                           'ganit_invoices_salesperson_id_ck');
    IF n_checks <> 2 THEN
        RAISE EXCEPTION
            'VERIFY 2: expected 2 salesperson_id CHECK constraints in '
            'pg_constraint, found %.', n_checks;
    END IF;

    -- VERIFY 3 — both partial indexes exist.
    SELECT count(*) INTO n_indexes
      FROM pg_indexes
     WHERE schemaname = 'staging'
       AND indexname IN ('vikray_orders_salesperson_idx',
                         'ganit_invoices_salesperson_idx');
    IF n_indexes <> 2 THEN
        RAISE EXCEPTION 'VERIFY 3: expected 2 attribution indexes, found %.',
                        n_indexes;
    END IF;

    -- VERIFY 4 — THE ONE THAT MATTERS. Nothing was attributed. If this file
    -- ever grows a backfill by accident, or somebody adds an UPDATE above,
    -- this refuses the whole transaction.
    SELECT count(*) INTO n_orders_attr
      FROM staging.vikray_orders WHERE salesperson_id IS NOT NULL;
    SELECT count(*) INTO n_invoices_attr
      FROM staging.ganit_invoices WHERE salesperson_id IS NOT NULL;
    IF n_orders_attr <> 0 OR n_invoices_attr <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 4: this migration backfills NOTHING, yet % order(s) and % '
            'invoice(s) carry a salesperson_id. Something in this transaction '
            'wrote attribution data. Rolling back.',
            n_orders_attr, n_invoices_attr;
    END IF;

    -- VERIFY 5 — no line acquired a cost either. This file documents the key;
    -- it does not populate it, and a cost written here would be a fabricated
    -- gross profit in production.
    SELECT count(*) INTO n_order_cost
      FROM staging.vikray_orders o, jsonb_array_elements(o.line_items) li
     WHERE li ? 'cost_price';
    SELECT count(*) INTO n_invoice_cost
      FROM staging.ganit_invoices i, jsonb_array_elements(i.line_items) li
     WHERE li ? 'cost_price';
    IF n_order_cost <> 0 OR n_invoice_cost <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 5: % order line(s) and % invoice line(s) carry a '
            'cost_price. This file writes no costs — if these predate it, '
            'confirm the convention matches before proceeding.',
            n_order_cost, n_invoice_cost;
    END IF;

    SELECT count(*) INTO n_orders   FROM staging.vikray_orders;
    SELECT count(*) INTO n_invoices FROM staging.ganit_invoices;

    RAISE NOTICE '184 · attribution columns added.';
    RAISE NOTICE '    orders   : % row(s), 0 attributed', n_orders;
    RAISE NOTICE '    invoices : % row(s), 0 attributed', n_invoices;
    RAISE NOTICE '    Every document in the database is now EXPLICITLY '
                 'unattributed rather than implicitly so.';
    RAISE NOTICE '    Nothing is computable per person until routers/vikray.py '
                 'and routers/ganit.py start writing these columns.';
END
$verify$;

COMMIT;
