-- 192 · The customer's own reference on an invoice, and where an org's
--       document prefixes live.
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--
--   ADDS     staging.ganit_invoices.customer_ref  text, NULL-able, no default
--   ADDS     one CHECK, as its own guarded ALTER TABLE … ADD CONSTRAINT,
--            never inline — see THE INLINE TRAP below.
--   COMMENTS on the new column and on staging.organisations.settings.
--   DROPS    nothing. CREATES no table, no index, no trigger.
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--
-- IF IT RUNS TWICE: nothing happens. The ADD COLUMN is IF NOT EXISTS, the
-- CHECK is inside a NOT EXISTS guard against pg_constraint, and COMMENT ON is
-- idempotent by nature.
--
-- ── MEASURED, 2026-08-22, read-only against the live database ───────────────
--
--     ganit_invoices                 784 rows across 3 orgs (Aekam Inc: 0)
--     organisations.settings         exists, jsonb; '{}' on Aekam Inc
--     no column matching '(ref|po|order|customer)' on ganit_invoices today
--
-- Staging and production share this database, so those counts are the whole
-- product.
--
-- ── WHY A COLUMN AND NOT `notes` ────────────────────────────────────────────
--
-- A customer's purchase-order number is the reference THEY will quote when
-- they pay, and the thing their accounts-payable team matches against. It has
-- to be findable — searched on, printed in a fixed place on the document,
-- carried onto the payment link — and none of that is possible if it is
-- buried inside free text that also holds delivery instructions.
--
-- IT IS NOT THE PURCHASE ORDER MODULE. That is a separate object with its own
-- table, its own numbering series and an approval step; this is one string the
-- customer gave us. Naming it `customer_ref` rather than `po_number` is
-- deliberate for exactly that reason: plenty of customers quote a contract or
-- a work-order number instead, and a column called `po_number` would invite a
-- later reader to join it to the PO table, which it is not.
--
-- ── WHY NULL-ABLE, AND WHY NO DEFAULT ───────────────────────────────────────
--
-- Most customers give no reference at all. NULL means "they did not give one";
-- an empty string would be a second way of saying the same thing, which is why
-- the CHECK below refuses it. There is no default because there is nothing
-- sensible to invent.
--
-- ── WHERE THE PREFIXES LIVE, and why no column for them ─────────────────────
--
-- The document prefix is hardcoded today in `routers/ganit.py`:
--
--     {"tax_invoice": "INV", "proforma": "PI", "credit_note": "CN",
--      "debit_note": "DN", "quotation": "QTN"}
--
-- so every firm on the platform numbers its invoices INV-YYYY-NNNN whether
-- that matches its books or not.
--
-- The per-org override goes in `organisations.settings`, the jsonb that
-- already holds `publish_batch_limit`, under the key `doc_prefixes`:
--
--     {"doc_prefixes": {"tax_invoice": "AEK", "credit_note": "AEKCN"}}
--
-- A jsonb key rather than five columns, and the reason is this repository's
-- deployment order: code ships to Railway when the branch merges and
-- migrations are applied BY HAND afterwards. Five new columns would make the
-- invoice-create path 500 for the whole gap between the deploy and somebody
-- running psql — and that is the path this change exists to improve. A jsonb
-- key works the moment the code lands, with or without this file.
--
-- An absent key means "use the built-in prefix", so nothing changes for an org
-- that never sets one.
--
-- ── THE SERIAL, AND THE ONE THING THIS MUST NOT BREAK ───────────────────────
--
-- `utils.next_doc_number` reads the LAST number for the org and increments it.
-- Changing a prefix therefore starts a NEW series at 0001 rather than
-- continuing the old one, because the old numbers no longer match the new
-- shape. Under Rule 46(b) a GST invoice serial must be consecutive within a
-- series; starting a second series is allowed, silently renumbering an
-- existing one is not. Nothing in this file rewrites a stored number, and the
-- application must not either.
--
-- ── THE INLINE TRAP, WHICH THIS FILE AVOIDS BY CONSTRUCTION ─────────────────
--
-- `ALTER TABLE … ADD COLUMN IF NOT EXISTS x text CHECK (…)` skips the WHOLE
-- clause when the column already exists: the constraint is silently NOT
-- created, and pg_constraint is the only place the truth lives. So the CHECK
-- below is a separate guarded ADD CONSTRAINT, the pattern migrations 184 §2,
-- 186 §2 and 188 established, and section 3 reads it back out by name.
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.ganit_invoices
--       DROP CONSTRAINT IF EXISTS ganit_invoices_customer_ref_ck,
--       DROP COLUMN IF EXISTS customer_ref;
--
-- DROPPING THE COLUMN DESTROYS whatever customers' references have been
-- recorded by then. Safe on the day this lands, when it holds nothing; after
-- that, export first. Removing only the CHECK is safe on any day.
--
-- ── HOW TO APPLY ────────────────────────────────────────────────────────────
--
--   railway run -e staging -s Kartavya -- psql "$DATABASE_URL" -f \
--       backend/migrations/192_invoice_customer_ref.sql
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Write-path effect, in full: an
-- INSERT or UPDATE that sets `customer_ref` to an empty or whitespace-only
-- string now FAILS instead of storing a blank. Nothing in the repository does
-- that — the router coalesces a blank to NULL — and adding a NULL-able column
-- changes nothing for any statement that does not name it.

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · The schema and both tables are here.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'staging') THEN
        RAISE EXCEPTION
            'GUARD 1: schema "staging" does not exist. This is not the '
            'Kartavaya database.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema='staging' AND table_name='ganit_invoices') THEN
        RAISE EXCEPTION 'GUARD 1: staging.ganit_invoices does not exist.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='staging' AND table_name='organisations'
           AND column_name='settings') THEN
        RAISE EXCEPTION
            'GUARD 1: staging.organisations.settings is missing — the document '
            'prefixes documented by this file have nowhere to live.';
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 · The column.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.ganit_invoices
    ADD COLUMN IF NOT EXISTS customer_ref text;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 · A blank is not a reference.
--
--   Guarded and separate, never inline on the ADD COLUMN clause — see the
--   header. NULL stays legal and means "the customer gave none"; '' and '   '
--   are a second way of saying the same thing and are refused, so a search for
--   "invoices with a customer reference" has one answer rather than two.
-- ═══════════════════════════════════════════════════════════════════════════
DO $ck$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ganit_invoices_customer_ref_ck'
           AND conrelid = 'staging.ganit_invoices'::regclass
    ) THEN
        ALTER TABLE staging.ganit_invoices
            ADD CONSTRAINT ganit_invoices_customer_ref_ck
            CHECK (customer_ref IS NULL OR btrim(customer_ref) <> '');
        RAISE NOTICE 'SECTION 2: customer_ref_ck added.';
    ELSE
        RAISE NOTICE 'SECTION 2: customer_ref_ck already present.';
    END IF;
END
$ck$;

COMMENT ON COLUMN staging.ganit_invoices.customer_ref IS
    'The reference the CUSTOMER gave us — their purchase order, contract or '
    'work-order number — printed on the document and quoted back on payment. '
    'NULL means they gave none; a blank is refused by '
    'ganit_invoices_customer_ref_ck. NOT a link to the purchase-order module: '
    'it is a string they supplied, not a row we own.';

COMMENT ON COLUMN staging.organisations.settings IS
    'Per-org settings as jsonb. Keys in use: `publish_batch_limit` (int, how '
    'many scheduled posts one publish sweep may send) and `doc_prefixes` '
    '(object, e.g. {"tax_invoice":"AEK"}) which overrides the built-in '
    'INV/PI/CN/DN/QTN document prefixes. An absent key means the built-in is '
    'used. Changing a prefix starts a NEW number series at 0001 — it never '
    'renumbers documents already issued.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 · VERIFY. Read every claim back out of the catalogue.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    is_null text;
    dflt    text;
    blanks  bigint;
BEGIN
    SELECT is_nullable, column_default INTO is_null, dflt
      FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='ganit_invoices'
       AND column_name='customer_ref';

    IF is_null IS NULL THEN
        RAISE EXCEPTION 'VERIFY 1: customer_ref was not created.';
    END IF;
    IF is_null <> 'YES' THEN
        RAISE EXCEPTION
            'VERIFY 1: customer_ref is NOT NULL. Most customers give no '
            'reference, so that would refuse ordinary invoices.';
    END IF;
    IF dflt IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 1: customer_ref has a default (%).', dflt;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ganit_invoices_customer_ref_ck'
           AND conrelid = 'staging.ganit_invoices'::regclass) THEN
        RAISE EXCEPTION 'VERIFY 2: customer_ref_ck is absent.';
    END IF;

    -- VERIFY 3 · and it REFUSES. Proved inside a subtransaction, because a
    -- constraint that exists and does not bite is the failure the whole
    -- guarded-ADD-CONSTRAINT pattern exists to prevent.
    BEGIN
        UPDATE staging.ganit_invoices SET customer_ref = '   '
         WHERE id = (SELECT id FROM staging.ganit_invoices LIMIT 1);
        -- If there are no rows at all the UPDATE touches nothing and proves
        -- nothing; say so rather than counting it as a pass.
        GET DIAGNOSTICS blanks = ROW_COUNT;
        IF blanks = 0 THEN
            RAISE NOTICE 'VERIFY 3 inconclusive: no invoice rows to test the '
                         'constraint against. It is present (VERIFY 2).';
        ELSE
            RAISE EXCEPTION
                'VERIFY 3: a whitespace-only customer_ref was ACCEPTED. The '
                'constraint is not doing its job.';
        END IF;
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'VERIFY 3 ok: a blank customer_ref is refused.';
    END;

    RAISE NOTICE 'VERIFY ok: customer_ref is NULL-able with no default and a '
                 'blank is refused; doc_prefixes is documented on '
                 'organisations.settings.';
END
$verify$;

COMMIT;
