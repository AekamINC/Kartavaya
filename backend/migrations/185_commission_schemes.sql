-- 185 · Commission schemes — is this person on commission, from what, at what
--       rate, over what period, and SINCE WHEN.
--
-- ── WHAT THIS FILE TOUCHES, exactly ──────────────────────────────────────────
--
--   CREATES  staging.manav_commission_schemes  (one new table, previously
--            absent — confirmed against the live catalog on 2026-08-21:
--            to_regclass was NULL, no column anywhere in either schema matches
--            '%commission%' or '%incentive%', and the only historic reference
--            to such a table is a DELETE in migration 029 against
--            staging.vikray_commissions, which does not exist and by every
--            other sign never did)
--   CREATES  three indexes on that new table
--   COMMENTS on the table and on eight of its columns
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--   ALTERS no existing table. DROPS nothing. Reads no existing row.
--
-- IF IT RUNS TWICE: nothing happens. CREATE TABLE and CREATE INDEX are IF NOT
-- EXISTS and there is no seed, so a second run cannot mint a duplicate scheme
-- and cannot overwrite a rate somebody has since corrected by hand.
--
-- ── WRITE-PATH SIDE EFFECTS ON PRODUCTION ────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE ONE SUPABASE DATABASE and production writes to
-- `staging` too. This file creates one EMPTY table. No existing table is read,
-- written, locked or rewritten, so there is no lock queue against
-- manav_employees, ganit_invoices or anything else, and applying it cannot
-- change any figure any user sees today. Production's code does not know this
-- table exists and will not until services/report_defs/commission_reports.py
-- is deployed; even then, an org with no scheme rows sees "no scheme recorded"
-- against every name, which is the correct answer.
--
-- NOTHING BECOMES PAYABLE. This table records an ARRANGEMENT. It does not
-- create a liability, does not enter payroll, and is read by nothing that
-- writes: services/commission.py is pure arithmetic and the two report
-- sections are SELECT-only. A commission figure appearing on a report is not
-- an instruction to pay it.
--
-- LOCKS: CREATE TABLE takes a lock on nothing that exists. `SET LOCAL
-- lock_timeout` is set anyway, because it costs nothing and because a file
-- that grows an ALTER later must not have to remember to add it.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- The owner asked for the HR half: is this employee on commission, from what
-- threshold, at what rate. There is nowhere to record any of it today —
-- `staging.manav_employees` has 32 columns and not one of them is about pay
-- beyond `bank_details`, and `staging.vetana_salary_structures` models a fixed
-- salary with no variable component keyed to what a person sold.
--
-- ── WHY IT IS DATED, AND WHY HALF-OPEN ───────────────────────────────────────
--
-- A commission rate changes. When it does, last quarter's commission must
-- still compute on LAST QUARTER'S RATE — otherwise re-running a settled
-- period silently restates what a person was paid, and the firm has no way to
-- reproduce the figure on the payslip it already issued.
--
-- So a scheme is a ROW WITH A VALIDITY WINDOW, never a column on the employee,
-- and the window is modelled exactly the way `staging.statute_calendar`
-- (migration 158) models a dated statutory fact:
--
--     [effective_from, effective_to)     effective_to is EXCLUSIVE — the first
--                                        day the scheme is NOT in force, never
--                                        the last day it is.
--
-- That is what makes a rate change expressible without an off-by-one argument:
-- the 4% row ends at 2026-04-01, the 6% row begins at 2026-04-01, one date
-- written once, and 31 March 2026 answers 4% while 1 April 2026 answers 6%.
-- Written the other way — effective_to meaning "last valid day" — one day of a
-- person's pay gets either two answers or none, and which one it gets depends
-- on row order.
--
-- `services/commission.py:scheme_in_force(schemes, on)` is the only reader and
-- it takes `on` as a REQUIRED argument with no default, the same discipline
-- `services/statute.py` enforces: "what is this person's rate" cannot be asked
-- without "as of when".
--
-- ── WHY ON THE EMPLOYEE, AND THE BRIDGE THAT IS MISSING ──────────────────────
--
-- `employee_id`, not a user id: a commission arrangement is an HR fact about a
-- person's employment. It survives them changing login, it is recorded by HR
-- and it belongs beside the joining date, the designation and the exit
-- interview. Putting it on `public.users` would make it a property of an
-- account.
--
-- THE HONEST CONSEQUENCE, MEASURED LIVE 2026-08-21: revenue attributes to a
-- USER (migration 184's `salesperson_id` -> public.users.user_id), and
-- `staging.manav_employees.user_id` is filled on 0 OF 98 ROWS. Not one. And 0
-- employee email addresses match any row in public.users — 98 employees, 32
-- users, no edge between the two sets at all.
--
-- So on the day this table is populated, a scheme can be RECORDED against
-- every employee and JOINED to revenue for none of them. The join is
--
--     manav_employees.user_id  ->  ganit_invoices.salesperson_id
--
-- and its left-hand side is empty. That bridge is a data task for the firm —
-- somebody who knows which login belongs to which employee — and it is
-- deliberately NOT attempted here. Matching on name or on email would be a
-- guess, and a guess that attributes one person's turnover to another person's
-- commission is the single most expensive mistake this design could make.
-- The report says "not attributable" instead, by name, for every unlinked
-- employee.
--
-- ── THE THRESHOLD MODE, WHICH IS NOT DECORATION ──────────────────────────────
--
-- "On commission above ₹10 lakh at 5%" is ambiguous in English, and the two
-- readings differ by ₹50,000 on the first rupee over the line:
--
--     'excess'   the rate applies to the amount ABOVE the threshold.
--                ₹12L at 5% over a ₹10L threshold pays 5% of ₹2L = ₹10,000.
--     'whole'    crossing the threshold qualifies the WHOLE amount.
--                The same figures pay 5% of ₹12L = ₹60,000.
--
-- Both are real arrangements and neither is more correct. A column carrying
-- only a rate and a threshold makes the product PICK ONE SILENTLY — and
-- picking 'excess' underpays a person quietly, every period, while picking
-- 'whole' spends the firm's money. So the mode is recorded, DEFAULT 'excess'
-- because that is the more common consultancy arrangement, and
-- `services/commission.py:commission_due` reads it rather than assuming.
--
-- ── WHAT THIS TABLE DELIBERATELY DOES NOT MODEL ──────────────────────────────
--
--  * TIERED / LADDERED RATES ("5% to ₹20L, 8% above"). One row is one flat
--    rate over one threshold. A ladder needs a child table of bands and it is
--    not seeded here because no firm using this product has asked for one yet,
--    and a bands table with no rows in it is a schema decision made on a
--    guess. The upgrade path is additive: a `manav_commission_bands` child
--    keyed on this table's id, with this row's rate as the last band.
--  * TEAM OR OVERRIDE COMMISSION (a manager earning on their reports' sales).
--    That needs a hierarchy walk over `manav_employees.reporting_to` and a
--    rule for whether the manager's own sales also count. Both are policy.
--  * CLAWBACK. A period whose credit notes exceed its invoices produces a
--    negative basis; `commission_due` floors the commission at zero rather
--    than returning a negative payment. Recovering an overpayment from a
--    person has notice periods and employment law behind it; it is not
--    arithmetic and this schema will not imply that it is.
--  * PAYMENT. There is no `paid_at`, no `payout_id` and no link to
--    `vetana_payroll_runs`. This table says what the ARRANGEMENT is. What was
--    actually paid is a payroll fact and belongs in payroll, and conflating
--    the two is how a report becomes a record of payments that were never
--    made.
--  * ANY SALARY FIGURE. No CTC, no basic, no fixed component. Nothing in this
--    table is a person's pay; it is a rate and a threshold.
--
-- ── OVERLAP: WHAT THE CONSTRAINTS DO AND DO NOT CATCH ────────────────────────
--
-- The realistic mistake is writing a new version and forgetting to close the
-- old one, which leaves two rows both claiming to be current and makes a
-- person's rate depend on row order. The partial unique index
-- `..._one_open_scheme_idx` catches exactly that: AT MOST ONE open-ended
-- version per employee.
--
-- It does NOT catch two CLOSED versions that overlap in the middle
-- (1 Apr-1 Oct and 1 Jul-1 Jan). Catching that needs an EXCLUDE constraint
-- with a daterange and a `btree_gist` operator class for the uuid columns, and
-- btree_gist is NOT INSTALLED on this database (measured 2026-08-21: it is
-- available at 1.7 and installed_version is NULL). Installing an extension on
-- the shared production database to enforce a constraint against a mistake
-- nobody has made yet is a bigger change than this file should be, so the
-- unique index is the guard and `scheme_in_force` resolves any residual
-- overlap DETERMINISTICALLY (latest effective_from wins) rather than by row
-- order. If a firm ever writes overlapping closed versions, the fix is
-- CREATE EXTENSION btree_gist plus one ADD CONSTRAINT, in its own migration
-- with its own risk report.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DROP TABLE staging.manav_commission_schemes;   -- takes its indexes with it
--
-- Safe on the day (the table is empty). Once populated it holds the only
-- record of what people were promised, so export it first.

BEGIN;

-- SET LOCAL is scoped to a transaction; outside one PostgreSQL warns and
-- ignores it. Nothing here can queue behind anything today, but the cap is set
-- so that a later edit to this file inherits it rather than having to
-- remember it.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · The employee table exists and its key is a uuid.
--
-- `employee_id` below is a uuid. If manav_employees.id were ever something
-- else, this table would be unjoinable and every scheme would resolve to
-- nobody — which renders as "no scheme recorded" against every name and looks
-- exactly like a firm that has not filled the form in.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
DECLARE t text;
BEGIN
    IF to_regclass('staging.manav_employees') IS NULL THEN
        RAISE EXCEPTION 'GUARD 1: staging.manav_employees does not exist. '
                        'Migration 018 has not run.';
    END IF;
    SELECT data_type INTO t
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'manav_employees'
       AND column_name = 'id';
    IF t <> 'uuid' THEN
        RAISE EXCEPTION
            'GUARD 1: staging.manav_employees.id is %, not uuid. This file '
            'keys a scheme on that column.', t;
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 2 · Migration 184 has run.
--
-- 185 is useless without it and misleading with it missing: a scheme could be
-- recorded and a rate displayed, with no attributed revenue for it to ever
-- apply to and nothing on the page saying why. Ordering the two files is
-- cheaper than explaining the gap afterwards.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard2$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name IN ('vikray_orders', 'ganit_invoices')
       AND column_name = 'salesperson_id';
    IF n <> 2 THEN
        RAISE EXCEPTION
            'GUARD 2: migration 184 has not run — expected salesperson_id on '
            'both vikray_orders and ganit_invoices, found % of 2. A commission '
            'scheme with no attributed revenue to apply to is a rate on a '
            'screen and nothing else.', n;
    END IF;
END
$guard2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · The table. One row per VERSION of one employee's arrangement.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staging.manav_commission_schemes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Denormalised from the employee ON PURPOSE. Every read of this table is
    -- org-scoped first: joining on employee_id alone can surface another org's
    -- employee, which is the exact shape of the graha_clients join leak, and
    -- the schema cannot refuse a foreign employee id because there is no
    -- composite (id, org_id) key to point an FK at. So the predicate carries
    -- it, and the column has to be here for the predicate to exist.
    org_id            uuid NOT NULL,
    employee_id       uuid NOT NULL,

    -- ELIGIBLE IS A RECORDED FACT, NOT AN ABSENCE. A row with eligible=FALSE
    -- means HR has decided this person is not on commission. No row at all
    -- means nobody has decided. The report renders those differently — "not on
    -- commission" against "no scheme recorded" — because the second is a
    -- question for HR and the first is an answer from them.
    --
    -- DEFAULT FALSE, deliberately: a row written without thinking about this
    -- column must not put somebody on commission.
    eligible          boolean     NOT NULL DEFAULT FALSE,

    -- What the rate applies to. CHECKed, because a typo here does not fail —
    -- it produces a commission computed on the wrong number, silently, and the
    -- only symptom is a cheque of the wrong size.
    basis             text        NOT NULL DEFAULT 'turnover',

    -- Percent, three decimals: 2.5, 7.125. NOT a fraction. The unit is in the
    -- name so that nobody applies a 5 as 500%.
    rate_percent      numeric(6,3) NOT NULL DEFAULT 0,

    -- The amount the person must reach in the period before anything is due.
    -- 0 means no threshold — commission from the first rupee — and that is a
    -- real arrangement, not a missing value, which is why this is NOT NULL
    -- with a zero default rather than nullable.
    threshold_amount  numeric(14,2) NOT NULL DEFAULT 0,

    -- 'excess' | 'whole'. See the header. This is the difference between two
    -- very different cheques and it must never be inferred.
    threshold_mode    text        NOT NULL DEFAULT 'excess',

    -- How often the arrangement SETTLES. The threshold is tested against a
    -- whole period, so this decides what "reaching the threshold" even means:
    -- ₹10L monthly and ₹10L annually are not the same promise.
    period            text        NOT NULL DEFAULT 'monthly',

    -- The window. effective_to is EXCLUSIVE; NULL means still in force.
    effective_from    date        NOT NULL,
    effective_to      date,

    -- Why this version exists — "revised at the April review", "moved to gross
    -- profit basis". Free text, read by a person, printed on no report.
    notes             text,

    -- public.users.user_id (text), migration 030's convention. Who recorded
    -- the arrangement, which is an audit fact and is never the employee.
    created_by        text,
    created_at        timestamptz NOT NULL DEFAULT NOW(),
    updated_at        timestamptz NOT NULL DEFAULT NOW(),

    CONSTRAINT manav_commission_schemes_basis_ck CHECK (
        basis IN ('turnover', 'gross_profit')),

    CONSTRAINT manav_commission_schemes_mode_ck CHECK (
        threshold_mode IN ('excess', 'whole')),

    CONSTRAINT manav_commission_schemes_period_ck CHECK (
        period IN ('monthly', 'quarterly', 'annual')),

    -- A rate above 100% of turnover is not a commission scheme, it is a typo
    -- that pays more than was sold. Refused at write time rather than caught
    -- on a payslip. (A gross-profit basis could in principle exceed 100 and
    -- still be meant; it is refused anyway, because the odds that 500 means
    -- 5.00 are overwhelming and the cost of being wrong is a wrong cheque.)
    CONSTRAINT manav_commission_schemes_rate_ck CHECK (
        rate_percent >= 0 AND rate_percent <= 100),

    CONSTRAINT manav_commission_schemes_threshold_ck CHECK (
        threshold_amount >= 0),

    -- HALF-OPEN. A version that ends on the day it starts was in force for no
    -- days at all, and is always a mistake.
    CONSTRAINT manav_commission_schemes_window_ck CHECK (
        effective_to IS NULL OR effective_to > effective_from),

    -- One version per employee per start date. Makes a re-run or a
    -- double-submitted form a no-op rather than a second scheme.
    CONSTRAINT manav_commission_schemes_version_uniq
        UNIQUE (org_id, employee_id, effective_from)
);

-- The lookup `scheme_in_force` performs: every version of one person's
-- arrangement, oldest first. org_id leads because every read is org-scoped
-- before it is person-scoped.
CREATE INDEX IF NOT EXISTS manav_commission_schemes_employee_idx
    ON staging.manav_commission_schemes (org_id, employee_id, effective_from);

-- The consultant register's shape: every scheme in the org in force at a
-- date, in one pass, without touching the closed history.
CREATE INDEX IF NOT EXISTS manav_commission_schemes_org_window_idx
    ON staging.manav_commission_schemes (org_id, effective_from, effective_to);

-- AT MOST ONE OPEN-ENDED VERSION per employee. This is the constraint that
-- catches the realistic mistake — writing a new rate and forgetting to close
-- the old one — which otherwise leaves two rows both claiming to be current
-- and makes a person's rate depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS manav_commission_schemes_one_open_scheme_idx
    ON staging.manav_commission_schemes (org_id, employee_id)
    WHERE effective_to IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The documentation that lives in the database.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE staging.manav_commission_schemes IS
    'One row per VERSION of one employee''s commission arrangement, valid over '
    'the half-open window [effective_from, effective_to). Read through '
    'services/commission.py:scheme_in_force(schemes, on), which requires an '
    'as-of date — last quarter''s commission must still compute on last '
    'quarter''s rate. Records an ARRANGEMENT only: nothing here is a payment, '
    'a liability or a salary, and nothing reads it that writes. Joining a '
    'scheme to attributed revenue requires manav_employees.user_id, which is '
    'filled on 0 of 98 rows as at 2026-08-21.';

COMMENT ON COLUMN staging.manav_commission_schemes.eligible IS
    'A RECORDED fact. FALSE = HR has decided this person is not on commission '
    '("not on commission"). NO ROW AT ALL = nobody has decided ("no scheme '
    'recorded"). Those render differently and must not be collapsed.';

COMMENT ON COLUMN staging.manav_commission_schemes.basis IS
    'turnover | gross_profit. gross_profit needs a cost on every line '
    '(line_items[].cost_price, migration 184); with no cost recorded the '
    'commission is NOT COMPUTABLE and must render as such, never as zero.';

COMMENT ON COLUMN staging.manav_commission_schemes.rate_percent IS
    'PERCENT, not a fraction. 5 means 5 percent. Capped at 100 by CHECK.';

COMMENT ON COLUMN staging.manav_commission_schemes.threshold_amount IS
    'What the person must reach IN THE SETTLEMENT PERIOD before anything is '
    'due. 0 means commission from the first rupee — a real arrangement, not a '
    'missing value. The test is >=: "commission from 10 lakh" includes 10 lakh.';

COMMENT ON COLUMN staging.manav_commission_schemes.threshold_mode IS
    'excess = the rate applies to the amount ABOVE the threshold. whole = '
    'crossing the threshold qualifies the WHOLE amount. On 12L at 5 percent over a '
    '10L threshold these pay 10,000 and 60,000 respectively. Recorded rather '
    'than assumed, because assuming underpays a person or overspends the firm.';

COMMENT ON COLUMN staging.manav_commission_schemes.period IS
    'monthly | quarterly | annual — how often the arrangement SETTLES, and '
    'therefore what the threshold is tested against. Quarters are FINANCIAL '
    'year quarters (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar), never calendar ones.';

COMMENT ON COLUMN staging.manav_commission_schemes.effective_to IS
    'EXCLUSIVE — the first day the scheme is NOT in force, never the last day '
    'it is. NULL means still in force. Same convention as '
    'staging.statute_calendar.effective_to; deliberately the OPPOSITE of '
    'services/statute.py:fy_bounds, which is inclusive because a financial '
    'year has a real last day.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · PROVE IT, IN THE SAME TRANSACTION.
--
-- This file's claims are: a table exists, with these constraints, holding NO
-- ROWS. The third is the one worth enforcing — a seeded commission scheme in
-- production is an arrangement nobody agreed to, sitting under somebody's
-- name, on a report a firm might act on.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_rows    bigint;
    n_checks  int;
    n_idx     int;
    n_emp     bigint;
    n_linked  bigint;
BEGIN
    -- VERIFY 1 — the table is EMPTY. Nothing was seeded.
    SELECT count(*) INTO n_rows FROM staging.manav_commission_schemes;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 1: this migration seeds NOTHING, yet the table holds % '
            'row(s). Either it has been applied before and somebody has since '
            'recorded arrangements (in which case this run is a no-op and the '
            'rows are real — re-check before forcing), or something in this '
            'transaction wrote a commission scheme. Rolling back.', n_rows;
    END IF;

    -- VERIFY 2 — every CHECK actually landed. Read from pg_constraint, not
    -- assumed from the DDL: a CHECK written inline on a column that already
    -- existed is silently skipped, and pg_constraint is the only truth.
    SELECT count(*) INTO n_checks
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND c.relname = 'manav_commission_schemes'
       AND con.contype = 'c'
       AND con.conname IN ('manav_commission_schemes_basis_ck',
                           'manav_commission_schemes_mode_ck',
                           'manav_commission_schemes_period_ck',
                           'manav_commission_schemes_rate_ck',
                           'manav_commission_schemes_threshold_ck',
                           'manav_commission_schemes_window_ck');
    IF n_checks <> 6 THEN
        RAISE EXCEPTION 'VERIFY 2: expected 6 CHECK constraints, found %.',
                        n_checks;
    END IF;

    -- VERIFY 3 — the three indexes, including the one-open-version guard,
    -- which is the only thing standing between a rate change and two rows both
    -- claiming to be current.
    SELECT count(*) INTO n_idx
      FROM pg_indexes
     WHERE schemaname = 'staging'
       AND indexname IN ('manav_commission_schemes_employee_idx',
                         'manav_commission_schemes_org_window_idx',
                         'manav_commission_schemes_one_open_scheme_idx');
    IF n_idx <> 3 THEN
        RAISE EXCEPTION 'VERIFY 3: expected 3 indexes, found %.', n_idx;
    END IF;

    -- VERIFY 4 — nothing on manav_employees was touched. This file adds no
    -- column there and backfills no user_id; the count is read so that the
    -- NOTICE below states the real size of the gap on the day of the apply
    -- rather than repeating a figure measured earlier.
    SELECT count(*), count(NULLIF(btrim(COALESCE(user_id, '')), ''))
      INTO n_emp, n_linked
      FROM staging.manav_employees;

    RAISE NOTICE '185 · staging.manav_commission_schemes created, 0 rows.';
    RAISE NOTICE '    Nobody is on commission until a scheme is recorded.';
    RAISE NOTICE '    % employee(s); % linked to a login account.', n_emp, n_linked;
    IF n_linked = 0 THEN
        RAISE NOTICE '    NO employee is linked to a login account, so no '
                     'scheme can be joined to attributed revenue yet. Fill '
                     'manav_employees.user_id — by hand, from records, never '
                     'by matching on name or email.';
    END IF;
END
$verify$;

COMMIT;
