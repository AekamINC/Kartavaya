-- 197 · Purchase orders — the procurement module, whole (proposal 77).
--
-- ── RENUMBERED FROM 196, AND WHY THAT IS SAFE HERE ───────────────────────────
--
-- This file was written and APPLIED as 196. `196_pahchan_policy_scopes.sql`
-- landed on the live database in the same window and has the prior claim, so
-- this one moved to 197. The number is a FILENAME CONVENTION — there is no
-- applied-migrations ledger table in this product — so the rename costs
-- nothing and changes nothing that ran.
--
-- IT MUST NOT BE RE-APPLIED. Every statement in it is IF NOT EXISTS and the
-- VERIFY block is idempotent, so a second run would be a no-op rather than a
-- fault; but "would be harmless" is not a reason to run DDL against a shared
-- production database twice. Confirm the objects instead:
--
--   SELECT to_regclass('staging.ganit_purchase_orders');   -- non-NULL = applied
--
-- Applied 2026-08-22. Verified live: 5 tables, 14 declared indexes (19 with
-- primary keys), 10 CHECK constraints, `ganit_vendor_bills.po_id` present,
-- 189 bills intact and 0 linked, all five new tables empty.
--
-- ── WHAT THIS FILE TOUCHES, exactly ──────────────────────────────────────────
--
--   CREATES  staging.ganit_purchase_orders   (empty)
--   CREATES  staging.ganit_po_lines          (empty)
--   CREATES  staging.ganit_po_receipts       (empty)
--   CREATES  staging.ganit_po_revisions      (empty)
--   CREATES  staging.ganit_po_approvals      (empty)
--   ALTERS   staging.ganit_vendor_bills — ONE new nullable column, `po_id`
--   CREATES  fourteen indexes on the five new tables, one on the new column
--   COMMENTS on the five tables and on the columns whose meaning is not
--            recoverable from the name
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--   DROPS nothing. Rewrites no existing row.
--
-- Confirmed against the live catalog on 2026-08-22 before this was written:
-- `to_regclass` was NULL for all five table names, and no table in either
-- schema matches '%purchase%' or 'ganit_po%'. Proposal 77's own count agrees:
-- "0 — purchase-order tables of any kind".
--
-- IF IT RUNS TWICE: nothing happens. Every CREATE and every ALTER is
-- IF NOT EXISTS, there is no seed, and the VERIFY block below reads
-- pg_constraint and pg_indexes rather than trusting the DDL it just ran.
--
-- ── WRITE-PATH SIDE EFFECTS ON PRODUCTION ────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE ONE SUPABASE DATABASE and production writes to
-- `staging` too, so this IS a production schema change. Two distinct risks,
-- and they are not the same size:
--
--  1. THE FIVE NEW TABLES are inert. Nothing existing is read, written, locked
--     or rewritten by creating them; production's code does not know they
--     exist and will not until `routers/procurement.py` is mounted. An org
--     that never opens the tab sees no change of any kind.
--
--  2. THE COLUMN ON `ganit_vendor_bills` IS THE REAL ONE. 189 live rows. In
--     PostgreSQL 11+ an `ADD COLUMN ... NULL` with no default and no volatile
--     expression is a CATALOG-ONLY change — no table rewrite, no row is
--     touched, no page is dirtied — so it takes an ACCESS EXCLUSIVE lock for
--     the duration of a catalog update and releases it. `SET LOCAL
--     lock_timeout` is set below so that if a long payables read is holding
--     the table when this runs, this file gives up rather than queueing behind
--     it and blocking every subsequent reader of vendor bills. Re-run it.
--
--     NO DEFAULT, deliberately. `ADD COLUMN ... DEFAULT` is also metadata-only
--     since 11, but a default on this column would be a lie: the truthful
--     value for all 189 existing bills is "we do not know whether this bill
--     had a purchase order", and that is NULL.
--
--     AND NO INLINE CHECK, equally deliberately — see the note under CONSTRAINTS.
--
-- NOTHING BECOMES COMMITTED SPEND. These tables record ORDERS. A purchase
-- order is not a liability and not a payable; it enters no ledger, changes no
-- balance, and is read by nothing that writes to `ganit_vendor_bills`,
-- `ganit_vendor_payments` or the bank reconciliation. The committed-spend
-- figure the module reports is a SELECT over rows this file creates none of.
--
-- ── WHY LINES ARE A TABLE AND INVOICE LINES ARE JSONB ────────────────────────
--
-- `ganit_invoices.line_items` and `ganit_vendor_bills.line_items` are jsonb and
-- that is right for them: nothing queries INSIDE an invoice line. A purchase
-- order line is queried constantly and from outside the order — "what is on
-- order for this product", "which lines are outstanding past their expected
-- date", "how much of line 3 has arrived" — and every one of those is a
-- sequential scan with a jsonb unnest if the lines live in a column.
--
-- ── WHY RECEIPTS ARE A TABLE AND NOT A COUNTER ───────────────────────────────
--
-- A PO line has THREE quantities that are routinely all different: ordered,
-- received, billed. The gaps between them are the entire module — ordered >
-- received is a late supplier, received > billed is the period-end accrual a
-- CA needs, billed > received is a vendor charging for goods that never came.
--
-- `qty_received` is therefore NOT a column anywhere in this schema. It is
-- SUM(qty) over `ganit_po_receipts` for the line, every time. A counter that
-- gets overwritten loses the arrival history, and "when did this arrive?" is
-- exactly what the MSME payment clock and any dispute both turn on. Same
-- reasoning for `qty_billed`: it is derived from the bills linked to the PO,
-- so it cannot drift away from the bills themselves.
--
-- ── THE ONE COLLISION THIS MODULE COULD HAVE CAUSED, AND DID NOT ─────────────
--
-- `ganit_vendor_bills.acceptance_date` (migration 175) already exists and feeds
-- the MSME payment-clock check in `services/skills/data/vendor_compliance.py`,
-- which is a STATUTORY deadline. If a PO receipt introduced its own idea of
-- "received on", the two would disagree the first time somebody used both.
--
-- There is no `accepted_on` column in this file. `ganit_po_receipts.received_on`
-- is the arrival of a QUANTITY against a LINE — a different fact, at a
-- different grain — and `routers/procurement.py` WRITES `acceptance_date` on
-- the linked bill from the earliest receipt rather than shadowing it. The PO
-- feeds that column; it does not compete with it.
--
-- ── CONSTRAINTS: WHY THEY ARE ALL NAMED AND NONE IS INLINE ON THE ALTER ──────
--
-- An inline CHECK on `ADD COLUMN IF NOT EXISTS` is skipped WITH THE WHOLE
-- CLAUSE when the column already exists — the column survives a re-run and the
-- constraint silently does not. That is why `po_id` carries no inline CHECK
-- here and why VERIFY 2 below reads `pg_constraint` instead of assuming the
-- DDL landed.
--
-- `po_id` also carries no FOREIGN KEY. Not an oversight: a bill may be linked
-- to a PO and the PO may later be soft-deleted as an abandoned draft, and a
-- referential action that either blocked that or cascaded into the bill would
-- be the wrong answer in both directions. The link is validated in the router,
-- inside the org, on the way in — which is where the tenancy check has to
-- happen anyway, because a foreign key cannot express "and in the same org".
--
-- ── TENANCY ──────────────────────────────────────────────────────────────────
--
-- `org_id` is NOT NULL on every one of the five tables, INCLUDING the three
-- child tables that could have reached it through `po_id`. Carrying it is what
-- lets every child query filter on `org_id` in its own WHERE clause rather
-- than trusting a join — and `graha_clients` is on record for what happens
-- when a join on id alone is the only thing standing between two tenants.
--
-- ── ROW COUNTS AT APPLY TIME (measured live, read-only, 2026-08-22) ──────────
--
--   staging.ganit_vendors           80
--   staging.ganit_vendor_bills     189   ← the ALTER's subject
--   staging.ganit_products         106
--   purchase-order tables            0   ← none existed

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · The order
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.ganit_purchase_orders (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             uuid        NOT NULL,
    vendor_id          uuid        NOT NULL,

    -- NULL until the order is ISSUED. A serial spent on a draft is a gap in
    -- the series, and a gap in a numbered series is the thing an auditor asks
    -- about. See `services/purchase_orders.next_po_number` for why this table
    -- cannot use `utils.next_doc_number`.
    po_number          text,
    revision           integer     NOT NULL DEFAULT 0,

    status             text        NOT NULL DEFAULT 'draft',
    po_date            date        NOT NULL DEFAULT CURRENT_DATE,
    expected_date      date,

    -- Free text, and knowingly so. `manav_employees.department` is free text
    -- too (11 of 98 blank), so budgets keyed on this string are as dependable
    -- as the string is — which is why budget limits ship OFF by default and
    -- the settings screen says so out loud.
    department         text,
    category           text,

    currency           text        NOT NULL DEFAULT 'INR',
    -- Decided the same way an invoice decides it — from the counterparty's
    -- state — or the PO total and the bill total differ and the three-way
    -- match fails on tax alone. GSTIN is NOT mandatory, so when the vendor has
    -- none recorded these fall back to the caller's answer and block nothing.
    place_of_supply    text,
    is_igst            boolean     NOT NULL DEFAULT false,

    subtotal           numeric(14,2) NOT NULL DEFAULT 0,
    cgst               numeric(14,2) NOT NULL DEFAULT 0,
    sgst               numeric(14,2) NOT NULL DEFAULT 0,
    igst               numeric(14,2) NOT NULL DEFAULT 0,
    total              numeric(14,2) NOT NULL DEFAULT 0,

    terms              text,
    delivery_address   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    notes              text,

    -- The rule that was in force WHEN THIS REVISION WAS SUBMITTED, snapshotted.
    -- Settings change; "who was required to approve this order" must not
    -- change retroactively because somebody edited the rules afterwards.
    approval_required  boolean     NOT NULL DEFAULT false,
    approvers_required integer     NOT NULL DEFAULT 0,
    approval_rule      jsonb,

    created_by         text,
    issued_at          timestamptz,
    closed_at          timestamptz,
    closed_by          text,
    -- Chosen from the firm's own list, so "why did this order stop short" is a
    -- value something can report on rather than free text nobody reads.
    closed_reason      text,

    is_active          boolean     NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ganit_purchase_orders_status_ck CHECK (status IN (
        'draft', 'awaiting_approval', 'rejected', 'issued',
        'part_received', 'received', 'closed', 'cancelled')),
    CONSTRAINT ganit_purchase_orders_revision_ck   CHECK (revision >= 0),
    CONSTRAINT ganit_purchase_orders_approvers_ck  CHECK (approvers_required BETWEEN 0 AND 5),
    -- A draft has no number; anything past draft that has one must not have an
    -- empty one. Written as "not blank" rather than "not null" because a
    -- rejected order returns to draft and legitimately still carries the
    -- number it was issued under, if it ever was.
    CONSTRAINT ganit_purchase_orders_number_ck
        CHECK (po_number IS NULL OR btrim(po_number) <> '')
);

CREATE INDEX IF NOT EXISTS ganit_purchase_orders_org_status_idx
    ON staging.ganit_purchase_orders (org_id, status);
CREATE INDEX IF NOT EXISTS ganit_purchase_orders_org_vendor_idx
    ON staging.ganit_purchase_orders (org_id, vendor_id);
CREATE INDEX IF NOT EXISTS ganit_purchase_orders_org_expected_idx
    ON staging.ganit_purchase_orders (org_id, expected_date);
-- The serial guard. Partial, because every draft carries NULL and a plain
-- unique index would be satisfied by any number of them — which is correct,
-- but only a partial index says so.
CREATE UNIQUE INDEX IF NOT EXISTS ganit_purchase_orders_org_number_uq
    ON staging.ganit_purchase_orders (org_id, po_number)
    WHERE po_number IS NOT NULL;

COMMENT ON TABLE staging.ganit_purchase_orders IS
    'Purchase orders (proposal 77). Numbered only at issue; a draft has no '
    'po_number because a serial spent on a draft is a gap in the series.';
COMMENT ON COLUMN staging.ganit_purchase_orders.approval_rule IS
    'Snapshot of the approval rule in force when this revision was submitted. '
    'Settings change; who was required to approve THIS order must not.';
COMMENT ON COLUMN staging.ganit_purchase_orders.department IS
    'Free text, mirroring manav_employees.department. Budgets keyed on it are '
    'as dependable as the string is, which is why they ship off by default.';

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · The lines
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.ganit_po_lines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid          NOT NULL,
    po_id         uuid          NOT NULL,
    line_no       integer       NOT NULL DEFAULT 1,

    -- Nullable: a firm orders things that are not in the catalogue, and
    -- refusing an ad-hoc line would push the order back into email.
    -- Where it IS set it points at `staging.ganit_products` — the ONE
    -- catalogue, never a second one.
    product_id    uuid,
    description   text          NOT NULL DEFAULT '',
    -- The catalogue already carries HSN. The PO must too, or the bill cannot
    -- be matched to it line by line.
    hsn_code      text,
    sac_code      text,

    qty_ordered   numeric(14,3) NOT NULL DEFAULT 0,
    unit          text          NOT NULL DEFAULT 'NOS',
    rate          numeric(14,2) NOT NULL DEFAULT 0,
    gst_rate      numeric(6,2)  NOT NULL DEFAULT 0,
    discount_pct  numeric(6,2)  NOT NULL DEFAULT 0,
    line_total    numeric(14,2) NOT NULL DEFAULT 0,
    gst_amount    numeric(14,2) NOT NULL DEFAULT 0,

    is_active     boolean       NOT NULL DEFAULT true,
    created_at    timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT ganit_po_lines_qty_ck  CHECK (qty_ordered >= 0),
    CONSTRAINT ganit_po_lines_disc_ck CHECK (discount_pct >= 0 AND discount_pct <= 100)
);

CREATE INDEX IF NOT EXISTS ganit_po_lines_po_idx
    ON staging.ganit_po_lines (po_id, line_no);
CREATE INDEX IF NOT EXISTS ganit_po_lines_org_product_idx
    ON staging.ganit_po_lines (org_id, product_id);

COMMENT ON TABLE staging.ganit_po_lines IS
    'PO lines as ROWS, not jsonb: "what is on order for this product" is the '
    'second question anyone asks, and it is a jsonb unnest scan otherwise. '
    'There is no qty_received and no qty_billed here — both are DERIVED.';

-- ══════════════════════════════════════════════════════════════════════════
-- 3 · The receipts — one row per delivery, never overwritten
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.ganit_po_receipts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid          NOT NULL,
    po_id       uuid          NOT NULL,
    po_line_id  uuid          NOT NULL,
    qty         numeric(14,3) NOT NULL,
    received_on date          NOT NULL DEFAULT CURRENT_DATE,
    received_by text,
    note        text,
    created_at  timestamptz   NOT NULL DEFAULT now(),

    -- Negative quantities ARE allowed: a return or a correction is a receipt
    -- of minus five, recorded as its own dated row, rather than an edit that
    -- destroys the record of what arrived on the day it arrived. Zero is not,
    -- because a receipt of nothing is a note and there is a column for notes.
    CONSTRAINT ganit_po_receipts_qty_ck CHECK (qty <> 0)
);

CREATE INDEX IF NOT EXISTS ganit_po_receipts_line_idx
    ON staging.ganit_po_receipts (po_line_id);
CREATE INDEX IF NOT EXISTS ganit_po_receipts_po_idx
    ON staging.ganit_po_receipts (po_id, received_on);
CREATE INDEX IF NOT EXISTS ganit_po_receipts_org_idx
    ON staging.ganit_po_receipts (org_id, received_on);

COMMENT ON TABLE staging.ganit_po_receipts IS
    'One row per delivery against one PO line. NEVER overwritten: the arrival '
    'history is what the MSME payment clock and any dispute both turn on. The '
    'earliest receipt is what writes ganit_vendor_bills.acceptance_date — this '
    'table does not shadow that column.';

-- ══════════════════════════════════════════════════════════════════════════
-- 4 · The revisions — the answer to the most-asked question in the market
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.ganit_po_revisions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL,
    po_id       uuid        NOT NULL,
    -- The revision number this row CREATED. Revision 1 is the first change
    -- after issue; revision 0 is the order as issued and has no row here.
    revision    integer     NOT NULL,
    changed_by  text,
    changed_at  timestamptz NOT NULL DEFAULT now(),
    -- What changed, field by field, {field: {from, to}} plus a `lines` entry.
    diff        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- The order EXACTLY as it stood BEFORE this change, header and lines. The
    -- original is never destroyed; this column is what makes that true rather
    -- than aspirational.
    snapshot    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    reason      text,
    -- Whether this revision was material enough to go back down the approval
    -- path. A small edit within the existing authorisation flows through; a
    -- change that materially raises the value needs fresh approval.
    re_approved boolean     NOT NULL DEFAULT false,

    CONSTRAINT ganit_po_revisions_revision_ck CHECK (revision >= 1)
);

CREATE INDEX IF NOT EXISTS ganit_po_revisions_po_idx
    ON staging.ganit_po_revisions (po_id, revision);
CREATE INDEX IF NOT EXISTS ganit_po_revisions_org_idx
    ON staging.ganit_po_revisions (org_id, changed_at);

COMMENT ON COLUMN staging.ganit_po_revisions.snapshot IS
    'The order as it stood BEFORE this change. "The original is never '
    'destroyed" is a promise this column keeps.';

-- ══════════════════════════════════════════════════════════════════════════
-- 5 · The approvals — one row per approver per revision
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.ganit_po_approvals (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL,
    po_id       uuid        NOT NULL,
    revision    integer     NOT NULL DEFAULT 0,
    -- TEXT, not uuid: `staging.users.user_id` is text across this whole
    -- product, and `staging.commission_*` is on record for what a uuid column
    -- pointed at a text id costs.
    approver_id text        NOT NULL,
    decision    text        NOT NULL,
    decided_at  timestamptz NOT NULL DEFAULT now(),
    note        text,

    CONSTRAINT ganit_po_approvals_decision_ck
        CHECK (decision IN ('approved', 'rejected')),
    CONSTRAINT ganit_po_approvals_revision_ck CHECK (revision >= 0)
);

-- One person decides once per revision. A second click must not count as a
-- second approver on a two-approver rule.
CREATE UNIQUE INDEX IF NOT EXISTS ganit_po_approvals_one_per_approver_uq
    ON staging.ganit_po_approvals (po_id, revision, approver_id);
CREATE INDEX IF NOT EXISTS ganit_po_approvals_org_idx
    ON staging.ganit_po_approvals (org_id, decided_at);

COMMENT ON TABLE staging.ganit_po_approvals IS
    'One row per approver per revision, so a two-approver rule is expressible '
    'and a rejection keeps its reason.';

-- ══════════════════════════════════════════════════════════════════════════
-- 6 · The link back to the bill
-- ══════════════════════════════════════════════════════════════════════════
--
-- Nullable, and it stays nullable for ever. A BILL WITHOUT A PO IS LEGAL: most
-- firms raise purchase orders for some spend and not all, and refusing an
-- un-ordered bill would stop them recording real invoices. 189 existing bills
-- have no PO and never will.

ALTER TABLE staging.ganit_vendor_bills
    ADD COLUMN IF NOT EXISTS po_id uuid;

CREATE INDEX IF NOT EXISTS ganit_vendor_bills_po_idx
    ON staging.ganit_vendor_bills (po_id) WHERE po_id IS NOT NULL;

COMMENT ON COLUMN staging.ganit_vendor_bills.po_id IS
    'The purchase order this bill was raised against, if any. NULL is the '
    'truthful value for a bill nobody ordered, which is most of them.';

-- ══════════════════════════════════════════════════════════════════════════
-- VERIFY — inside the transaction, so a failure throws the whole file away
-- ══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
    n_tables  bigint;
    n_checks  bigint;
    n_idx     bigint;
    n_rows    bigint;
    n_bills   bigint;
    n_col     bigint;
BEGIN
    -- VERIFY 1 — all five tables exist.
    SELECT count(*) INTO n_tables
      FROM information_schema.tables
     WHERE table_schema = 'staging'
       AND table_name IN ('ganit_purchase_orders', 'ganit_po_lines',
                          'ganit_po_receipts', 'ganit_po_revisions',
                          'ganit_po_approvals');
    IF n_tables <> 5 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 5 new tables, found %.', n_tables;
    END IF;

    -- VERIFY 2 — every CHECK actually landed. Read from pg_constraint, never
    -- assumed from the DDL above: a CHECK written inline on a column that
    -- already existed is silently skipped WITH THE WHOLE CLAUSE, and
    -- pg_constraint is the only truth about what is enforced.
    SELECT count(*) INTO n_checks
      FROM pg_constraint con
      JOIN pg_class c     ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND con.contype = 'c'
       AND con.conname IN ('ganit_purchase_orders_status_ck',
                           'ganit_purchase_orders_revision_ck',
                           'ganit_purchase_orders_approvers_ck',
                           'ganit_purchase_orders_number_ck',
                           'ganit_po_lines_qty_ck',
                           'ganit_po_lines_disc_ck',
                           'ganit_po_receipts_qty_ck',
                           'ganit_po_revisions_revision_ck',
                           'ganit_po_approvals_decision_ck',
                           'ganit_po_approvals_revision_ck');
    IF n_checks <> 10 THEN
        RAISE EXCEPTION 'VERIFY 2: expected 10 CHECK constraints, found %.', n_checks;
    END IF;

    -- VERIFY 3 — the indexes, including the two UNIQUE ones that are the whole
    -- of the serial guard and the one-decision-per-approver guard.
    SELECT count(*) INTO n_idx
      FROM pg_indexes
     WHERE schemaname = 'staging'
       AND indexname IN ('ganit_purchase_orders_org_status_idx',
                         'ganit_purchase_orders_org_vendor_idx',
                         'ganit_purchase_orders_org_expected_idx',
                         'ganit_purchase_orders_org_number_uq',
                         'ganit_po_lines_po_idx',
                         'ganit_po_lines_org_product_idx',
                         'ganit_po_receipts_line_idx',
                         'ganit_po_receipts_po_idx',
                         'ganit_po_receipts_org_idx',
                         'ganit_po_revisions_po_idx',
                         'ganit_po_revisions_org_idx',
                         'ganit_po_approvals_one_per_approver_uq',
                         'ganit_po_approvals_org_idx',
                         'ganit_vendor_bills_po_idx');
    IF n_idx <> 14 THEN
        RAISE EXCEPTION 'VERIFY 3: expected 14 indexes, found %.', n_idx;
    END IF;

    -- VERIFY 4 — the column landed on vendor bills, and NOTHING there moved.
    SELECT count(*) INTO n_col
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'ganit_vendor_bills'
       AND column_name = 'po_id';
    IF n_col <> 1 THEN
        RAISE EXCEPTION 'VERIFY 4: ganit_vendor_bills.po_id did not land.';
    END IF;

    SELECT count(*), count(po_id) INTO n_bills, n_rows
      FROM staging.ganit_vendor_bills;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 4: % vendor bill(s) already carry a po_id. This file '
            'backfills nothing, so either it has been run before and bills '
            'have since been linked (in which case this run is a no-op and '
            'the links are real), or something in this transaction wrote one. '
            'Rolling back.', n_rows;
    END IF;

    -- VERIFY 5 — the five new tables are EMPTY. This file seeds nothing, and a
    -- row here on a first apply means something else wrote it.
    SELECT (SELECT count(*) FROM staging.ganit_purchase_orders)
         + (SELECT count(*) FROM staging.ganit_po_lines)
         + (SELECT count(*) FROM staging.ganit_po_receipts)
         + (SELECT count(*) FROM staging.ganit_po_revisions)
         + (SELECT count(*) FROM staging.ganit_po_approvals)
      INTO n_rows;
    IF n_rows <> 0 THEN
        RAISE NOTICE '197 · % row(s) already present across the five tables — '
                     'this is a re-run and nothing has been changed.', n_rows;
    END IF;

    RAISE NOTICE '197 · five purchase-order tables created, % row(s).', n_rows;
    RAISE NOTICE '    ganit_vendor_bills.po_id added; % bill(s), 0 linked.', n_bills;
    RAISE NOTICE '    Nothing is committed spend until a PO is ISSUED, and no '
                 'PO exists.';
END
$verify$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (by hand, after the fact)
-- ═══════════════════════════════════════════════════════════════════════════
--
--   -- expect 5
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='staging'
--      AND table_name IN ('ganit_purchase_orders','ganit_po_lines',
--                         'ganit_po_receipts','ganit_po_revisions',
--                         'ganit_po_approvals');
--
--   -- expect 1
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema='staging' AND table_name='ganit_vendor_bills'
--      AND column_name='po_id';
--
--   -- expect 189, 0  — every bill still there, none linked to anything
--   SELECT count(*), count(po_id) FROM staging.ganit_vendor_bills;
--
--   -- expect 0,0,0,0,0
--   SELECT (SELECT count(*) FROM staging.ganit_purchase_orders),
--          (SELECT count(*) FROM staging.ganit_po_lines),
--          (SELECT count(*) FROM staging.ganit_po_receipts),
--          (SELECT count(*) FROM staging.ganit_po_revisions),
--          (SELECT count(*) FROM staging.ganit_po_approvals);
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- There is no backup schema for this file because there is nothing to back up:
-- it reads no row and writes no row. The rollback is a drop, and it is safe
-- ONLY while the five tables are still empty — after that it destroys real
-- purchase orders and the `WHERE po_id IS NOT NULL` guard below is what stops
-- the column going with real links on it.
--
--   BEGIN;
--   -- Refuses if anything has been ordered. Check before you drop.
--   SELECT count(*) FROM staging.ganit_purchase_orders;   -- must be 0
--   SELECT count(*) FROM staging.ganit_vendor_bills WHERE po_id IS NOT NULL;  -- must be 0
--
--   DROP TABLE IF EXISTS staging.ganit_po_approvals;
--   DROP TABLE IF EXISTS staging.ganit_po_revisions;
--   DROP TABLE IF EXISTS staging.ganit_po_receipts;
--   DROP TABLE IF EXISTS staging.ganit_po_lines;
--   DROP TABLE IF EXISTS staging.ganit_purchase_orders;
--   ALTER TABLE staging.ganit_vendor_bills DROP COLUMN IF EXISTS po_id;
--   COMMIT;
--
-- Dropping the COLUMN alone is the narrower rollback and the one to prefer if
-- the module is merely being disabled rather than removed: the five tables are
-- invisible to every existing code path, so leaving them costs nothing.
