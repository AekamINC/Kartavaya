-- ═════════════════════════════════════════════════════════════════════════════
-- 190 · Slab bands, a scheme's scope, two schemes at once, and a bonus.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- OWNER, 2026-08-21, across four messages. His words, because every design
-- decision below is traceable to one of them:
--
--   "also add option add more threshold option i.e HR or director decide 3% on
--    1lakh above and 4% 5 above 7.5% above 10lakh and also commission monthly
--    or yearly option as well."
--
--   "3% above 1L, 4% above 5L, 7.5% above 10L : example 3% from 1L to 5L, if
--    company had agrees higher commission then company can add more threshold
--    3.75% 5L to 7.5L and so on."
--
--   "commission can be decided by company they may pay yearly as well as
--    monthly depends on agreed terms i.e. if person is leading a team he gets
--    his own of what he do but he gets yearly commission on total GP of his
--    team, if it meets threshold."   ... "but yes teams is department."
--
--   "HR or company can also give bonus we need to add that as well in employee
--    eligible for bonus yes or no. both commission and bonus will get added in
--    payroll."
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--
--   CREATES  staging.manav_commission_bands           (new, empty)
--   CREATES  staging.manav_bonus_awards               (new, empty)
--   CREATES  staging.manav_commission_terms_stated()  (one trigger function)
--   CREATES  two DEFERRABLE constraint triggers
--   ALTERS   staging.manav_commission_schemes         (0 rows — ADDs ONE
--            column `revenue_scope`, replaces 189's rate CHECK, replaces two
--            uniqueness rules, adds a composite key a band can point at)
--   ALTERS   staging.manav_employees                  (98 rows — ADDs ONE
--            column `bonus_eligible boolean NOT NULL DEFAULT FALSE`, and ADDs
--            a UNIQUE (id, org_id) key)
--   ALTERS   staging.vetana_salary_structures         (94 rows — ADDs FIVE
--            nullable statutory switches, all defaulted to what payroll
--            already does: see section 5)
--   ALTERS   staging.vetana_payslips                  (1,095 rows — ADDs ONE
--            column `statutory_treatment jsonb DEFAULT '{}'`, the record of
--            which treatment each payslip was computed under. NO EARNINGS
--            COLUMN IS ADDED: commission and bonus are entries in the
--            `other_earnings` array that already exists)
--   INSERTS  nothing that survives. SEE "THE ONE WRITE" BELOW.
--   UPDATEs nothing. DELETEs nothing. DROPS NO TABLE AND NO COLUMN.
--
-- ── WRITE-PATH SIDE EFFECTS ON PRODUCTION ───────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE ONE SUPABASE DATABASE and production writes to
-- `staging` too. Every risk below is a production risk.
--
--   · manav_commission_schemes holds ZERO rows — measured read-only
--     2026-08-21, and GUARD 3 measures it again at apply time and refuses to
--     run if that has changed.
--   · manav_employees holds 98 rows and IS ALTERED. `ADD COLUMN ... boolean
--     NOT NULL DEFAULT FALSE` is metadata-only on PostgreSQL 11+ (the default
--     is recorded in pg_attribute.attmissingval; the server here is 17.6), so
--     this is a brief ACCESS EXCLUSIVE lock and not a 98-row rewrite. EVERY
--     EXISTING EMPLOYEE READS bonus_eligible = FALSE: this file makes NOBODY
--     eligible for a bonus, and VERIFY 6 proves that count is zero before
--     committing.
--   · The UNIQUE (id, org_id) key on manav_employees builds one index over 98
--     rows. Sub-millisecond, same lock.
--   · lock_timeout is 5s, so a blocked ALTER fails and rolls back rather than
--     queueing and blocking every HR read in production.
--   · NOTHING BECOMES PAYABLE. These tables record an ARRANGEMENT and an
--     AWARD. No payslip is written here and no existing payslip changes.
--
-- ── THE ONE WRITE, WHICH IS DELIBERATE AND MUST FAIL ────────────────────────
--
-- VERIFY 8 attempts to INSERT an eligible commission scheme with no bands, and
-- this file only commits if the database REFUSED it. If the insert is
-- accepted, the block raises and the entire transaction — every ALTER, both
-- CREATE TABLEs, the probe row — rolls back. Two outcomes only: the property
-- is proven and no row exists, or nothing was applied.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · THE LADDER, AND THE AMBIGUITY THE OWNER RESOLVED
-- ═════════════════════════════════════════════════════════════════════════════
--
-- "3% above ₹1L, 4% above ₹5L, 7.5% above ₹10L" has two readings in English
-- and they pay very different money. On ₹12,00,000:
--
--   EACH BAND ON ITS OWN SLICE (income-tax shaped)
--       first ₹1,00,000                earns nothing
--       ₹1L → ₹5L   = ₹4,00,000 at 3%      = ₹12,000
--       ₹5L → ₹10L  = ₹5,00,000 at 4%      = ₹20,000
--       above ₹10L  = ₹2,00,000 at 7.5%    = ₹15,000
--                                            ───────
--                                            ₹47,000
--   TOP BAND ON THE WHOLE AMOUNT
--       ₹12,00,000 at 7.5%                 = ₹90,000
--
-- Nearly double, from the same sentence. THE OWNER HAS ANSWERED: "3% from 1L
-- to 5L ... company can add more threshold 3.75% 5L to 7.5L and so on". A band
-- is a RANGE that pays its own rate on its own portion. So this schema stores
-- ONE reading and offers no choice — a chooser here would be a question the
-- firm has already answered, put back on the screen.
--
-- A band therefore has NO upper bound column. It runs to the next band's
-- `from_amount`, and the highest band runs to infinity. One edge between two
-- rungs, written once, so two bands cannot disagree about where one ends and
-- the next begins — and "and so on" means the ladder has NO CAP on how many
-- rungs it may have.
--
-- ── THE THREE COLUMNS THIS SUPERSEDES, AND WHY THEY STAY ────────────────────
--
-- Migration 185 modelled a single flat rate over a single threshold:
--
--   `rate_percent`      the one rate            SUPERSEDED by the bands' rates
--   `threshold_amount`  the one threshold       SUPERSEDED by the LOWEST band
--   `threshold_mode`    'excess' | 'whole'      SUPERSEDED — this was the
--                                               two-value version of exactly
--                                               the question the owner has now
--                                               answered, and the answer is
--                                               'excess' generalised to a
--                                               ladder.
--
-- NONE OF THEM IS DROPPED. Dropping a column is irreversible against a shared
-- production database and buys nothing here; they are documented as superseded
-- in COMMENT ON COLUMN, the arithmetic in services/commission.py does not read
-- them, and the trigger below refuses a row that states a `rate_percent`
-- alongside bands so the two can never disagree about the terms.
--
-- `threshold_mode` additionally loses its DEFAULT and its NOT NULL, so a row
-- written from now on records NULL there — "nothing is said here, read the
-- bands" — rather than a meaningless 'excess' that a future reader might
-- mistake for a live setting. That is the only change made to a superseded
-- column and it removes information from nothing: the table is empty.
--
-- OWED, AND STATED RATHER THAN QUIETLY LEFT: three live columns that nothing
-- reads. When it is certain no firm has written to them, a later migration may
-- drop them, in its own file with its own risk report.
--
-- ── AND THE PROPERTY 189 PROTECTS, WHICH SURVIVES ───────────────────────────
--
-- 189 added `..._eligible_needs_rate_ck`: an eligible scheme must carry a rate
-- above zero, so "on commission, terms unrecorded" cannot be stored and
-- silently compute ₹0 every period while somebody is owed money.
--
-- The rate now lives in a CHILD TABLE, so that CHECK as written would refuse
-- every banded scheme. It is REPLACED, NOT WEAKENED: an eligible scheme must
-- have AT LEAST ONE BAND. A row CHECK cannot count rows in another table, so
-- the rule becomes a DEFERRABLE CONSTRAINT TRIGGER,
-- `manav_commission_terms_stated()`, which at COMMIT refuses:
--
--   · an eligible scheme with no bands;
--   · a scheme that states bands AND a legacy `rate_percent` (two
--     representations of one fact, and whichever a reader trusts is the
--     cheque);
--   · a scheme that states bands AND a non-zero legacy `threshold_amount`
--     (the entry threshold of a ladder is its lowest band, stated once).
--
-- DEFERRED because a scheme and its bands are written in one transaction and
-- the scheme necessarily lands first — an immediate trigger would refuse every
-- correct write. It fires on the bands table too, so removing the last band
-- from an eligible scheme is refused as firmly as never adding one.
--
-- NO DEFAULT ANYWHERE THAT DECIDES MONEY. Not a rate, not a band floor, not a
-- scope. The owner: "no default commission percentage please org decide its
-- own commission". `eligible` and `bonus_eligible` keep DEFAULT FALSE, which
-- is a default that REFUSES — a careless row puts nobody on commission and
-- makes nobody bonus-eligible, the opposite fault to a default rate.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · WHOSE REVENUE — the scheme's SCOPE
-- ═════════════════════════════════════════════════════════════════════════════
--
-- "if person is leading a team he gets his own of what he do but he gets
--  yearly commission on total GP of his team, if it meets threshold."
--
-- So a scheme measures one of two different things, and which one decides the
-- cheque exactly as the rate does:
--
--   `revenue_scope = 'own'`         the person's OWN attributed revenue.
--   `revenue_scope = 'department'`  their DEPARTMENT's, everybody in it.
--
-- TEAM IS DEPARTMENT. The owner's words, and it is written down here as ONE
-- definition rather than made configurable. `staging.manav_employees` carries
-- both a `department` (text) and a `reporting_to` (text); the second is filled
-- on 0 OF 98 ROWS, measured read-only 2026-08-21, and this file does not read
-- it, fill it or drop it.
--
-- THE HONEST NUMBER, MEASURED THE SAME DAY: `department` is filled on 87 OF
-- 98 EMPLOYEES, not on all of them, across 18 distinct names against 30 rows
-- in `staging.manav_departments`. So ELEVEN PEOPLE CANNOT HOLD A
-- DEPARTMENT-SCOPED SCHEME that resolves to anything, and for them
-- services/commission.py returns the reason "department not set" — never ₹0,
-- and never "no revenue". Paying a team leader nothing because nobody filled
-- in a column is the exact failure this product keeps almost making.
--
-- NULLABLE WITH NO DEFAULT, and an ELIGIBLE scheme must state it. Same rule as
-- the rate, for the same reason: 'own' and 'department' are different amounts
-- of money and the product must not pick.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · MONTHLY AND YEARLY, OWN AND TEAM, ALL AT ONCE
-- ═════════════════════════════════════════════════════════════════════════════
--
-- The owner's example is one person holding TWO arrangements simultaneously: a
-- monthly one on their own sales, and an annual one on their department's
-- gross profit. Both current, both paying, measuring different revenue over
-- different windows.
--
-- Two of 185's rules block that and BOTH ARE REPLACED RATHER THAN DROPPED,
-- because the mistake they catch is still a real mistake:
--
--   ..._one_open_scheme_idx     UNIQUE (org_id, employee_id)
--                               WHERE effective_to IS NULL
--        becomes
--   ..._one_open_scheme_per_period_idx
--                               UNIQUE (org_id, employee_id, period,
--                                       revenue_scope) NULLS NOT DISTINCT
--                               WHERE effective_to IS NULL
--
--   ..._version_uniq            UNIQUE (org_id, employee_id, effective_from)
--        becomes
--   ..._version_uniq_idx        UNIQUE (org_id, employee_id, period,
--                                       revenue_scope, effective_from)
--                               NULLS NOT DISTINCT
--
-- What was prevented before: two rows both claiming to be this person's
-- current arrangement, so their rate depends on row order. What is prevented
-- now: two rows both claiming to be their current MONTHLY-OWN arrangement, or
-- their current ANNUAL-DEPARTMENT one. Those genuinely compete to answer one
-- question; a monthly-own row and an annual-department row never do, because
-- each is resolved for its own (period, scope) pair.
--
-- `NULLS NOT DISTINCT` (PostgreSQL 15+; this server is 17.6) matters: an
-- INELIGIBLE scheme records no scope, and under the default NULL semantics two
-- such rows would both be storable and both be "current". The identity of a
-- scheme is (employee, period, scope) whether or not the scope is stated.
--
-- Both become INDEXES rather than table constraints because that is what
-- carries `NULLS NOT DISTINCT` alongside a partial `WHERE` in one consistent
-- style; the uniqueness they enforce is identical either way.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · BONUS: DISCRETIONARY, AND COMPUTED FROM NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
--
-- A bonus is not a small commission. Nothing derives it: no turnover, no
-- threshold, no rate, no band, no department, no period figure. A person
-- decided, and the record must say WHO, HOW MUCH, WHY, and WHICH PAYROLL MONTH
-- it belongs to. That is the whole table.
--
--   · `manav_employees.bonus_eligible` — "eligible for bonus yes or no",
--     exactly as asked. DEFAULT FALSE: a default that refuses.
--   · `amount` has NO DEFAULT and must be > 0. A ₹0 bonus is an unfinished
--     form, and this product does not print ₹0 where the truth is "nothing was
--     awarded".
--   · `reason` NOT NULL and non-blank. A discretionary payment with no stated
--     reason cannot be audited, defended, or explained to the person who did
--     not get one.
--   · `pay_period` is 'YYYY-MM' and matches `vetana_payroll_runs.month`
--     exactly (verified live: 27 runs, all of that shape). That is the join.
--
-- WHY THERE IS NO payslip_id ON AN AWARD. `manav_expense_claims` carries one
-- and it has a live defect: `process_payroll` DELETEs the month's payslips and
-- re-inserts them on a re-run, so a claim stamped with the id of a now-deleted
-- payslip is excluded from the re-run and silently vanishes from the pay.
-- Keying a bonus on the MONTH makes a re-run pick up the same awards and
-- produce the same payslip. Idempotent by construction.
--
-- No UNIQUE (employee, pay_period): a festival bonus and a performance bonus
-- in one month are two real awards with two reasons, and collapsing them would
-- lose one.
--
-- ── WHAT THIS FILE STILL DOES NOT MODEL ─────────────────────────────────────
--
--   · A TEAM DEFINED ANY WAY BUT DEPARTMENT. `reporting_to` is untouched.
--   · CLAWBACK. A negative period reaches no rung and pays nothing; recovering
--     an overpayment has notice periods and employment law behind it.
--   · A BONUS APPROVAL WORKFLOW. An award is a recorded decision, not a
--     request awaiting sign-off.
--   · WHETHER COMMISSION AND BONUS ENTER THE PROFESSIONAL TAX OR TDS BASE.
--     Section 5 makes the PF and ESI bases switchable, which is what the owner
--     asked for. PT (₹200 over a ₹15,000 gross) and TDS (annualised gross) are
--     still computed on the FIXED salary, and widening them was not asked for
--     — it is OWED, stated here rather than done unasked.
--   · ANY RATE, CEILING OR THRESHOLD. PF 12%% capped at ₹1,800, ESI 0.75%% /
--     3.25%% under the ₹21,000 ceiling, PT ₹200 over ₹15,000, the ₹50,000
--     standard deduction and both slab tables are LAW. This file and its
--     commit change WHETHER a component is computed and WHAT BASE it uses.
--     Never the arithmetic.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS manav_commission_bands_terms_trg
--       ON staging.manav_commission_bands;
--   DROP TRIGGER IF EXISTS manav_commission_schemes_terms_trg
--       ON staging.manav_commission_schemes;
--   DROP FUNCTION IF EXISTS staging.manav_commission_terms_stated();
--   -- EXPORT THESE FIRST if anything has been recorded: they are the only
--   -- record of what people were promised and what they were given.
--   DROP TABLE IF EXISTS staging.manav_commission_bands;
--   DROP TABLE IF EXISTS staging.manav_bonus_awards;
--   DROP INDEX IF EXISTS staging.manav_commission_schemes_version_uniq_idx;
--   DROP INDEX IF EXISTS
--       staging.manav_commission_schemes_one_open_scheme_per_period_idx;
--   CREATE UNIQUE INDEX manav_commission_schemes_one_open_scheme_idx
--       ON staging.manav_commission_schemes (org_id, employee_id)
--    WHERE effective_to IS NULL;
--   ALTER TABLE staging.manav_commission_schemes
--       DROP CONSTRAINT IF EXISTS manav_commission_schemes_scope_ck,
--       DROP CONSTRAINT IF EXISTS manav_commission_schemes_eligible_needs_scope_ck,
--       DROP CONSTRAINT IF EXISTS manav_commission_schemes_stated_rate_ck,
--       DROP CONSTRAINT IF EXISTS manav_commission_schemes_id_org_uniq,
--       ADD CONSTRAINT manav_commission_schemes_version_uniq
--           UNIQUE (org_id, employee_id, effective_from),
--       ADD CONSTRAINT manav_commission_schemes_eligible_needs_rate_ck
--           CHECK (eligible IS NOT TRUE
--                  OR (rate_percent IS NOT NULL AND rate_percent > 0));
--   ALTER TABLE staging.manav_commission_schemes
--       ALTER COLUMN threshold_mode SET DEFAULT 'excess';
--   -- `revenue_scope`, `manav_employees.bonus_eligible`, the five statutory
--   -- switches on vetana_salary_structures and
--   -- vetana_payslips.statutory_treatment are ALL LEFT IN PLACE. Dropping any
--   -- of them destroys answers a firm has recorded — and dropping
--   -- statutory_treatment destroys the only record of how issued payslips were
--   -- computed. All are inert without the code above.
--   COMMIT;
--
-- The rollback has to INVENT a flat rate for any banded scheme written in the
-- meantime and would silently discard every ladder. Roll back only while the
-- table is still empty.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Transaction-scoped. A file that grows another ALTER later inherits the cap
-- rather than having to remember it.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARDS · every one of them RAISES rather than assuming.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard1$
BEGIN
    IF to_regclass('staging.manav_commission_schemes') IS NULL THEN
        RAISE EXCEPTION
            'GUARD 1: staging.manav_commission_schemes does not exist. '
            'Migration 185 has not been applied; apply 185 and 189 first.';
    END IF;
    IF to_regclass('staging.manav_employees') IS NULL THEN
        RAISE EXCEPTION
            'GUARD 1: staging.manav_employees does not exist. Migration 018 '
            'has not run, and both new tables key on it.';
    END IF;
END
$guard1$;

DO $guard2$
DECLARE t text;
BEGIN
    SELECT data_type INTO t
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'manav_employees'
       AND column_name = 'id';
    IF t IS DISTINCT FROM 'uuid' THEN
        RAISE EXCEPTION
            'GUARD 2: staging.manav_employees.id is %, not uuid. Both new '
            'tables key a row on that column.', t;
    END IF;
END
$guard2$;

-- The table is empty. This file changes what `eligible` REQUIRES — a ladder
-- rather than a flat rate — and it will not guess what a stored row meant.
DO $guard3$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM staging.manav_commission_schemes;
    IF n <> 0 THEN
        RAISE EXCEPTION
            'GUARD 3: % commission scheme row(s) exist. This file makes bands '
            'the only terms and requires every eligible scheme to state a '
            'revenue scope, so each stored row would need a ladder and a scope '
            'chosen FOR it — which is the one thing this design refuses to do. '
            'Decide row by row, write the mapping into this file, re-run.', n;
    END IF;
END
$guard3$;

-- 189 has run. If its CHECK is absent, something other than the documented
-- sequence built this table and the replacement below replaces nothing.
DO $guard4$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'manav_commission_schemes_eligible_needs_rate_ck'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        RAISE EXCEPTION
            'GUARD 4: manav_commission_schemes_eligible_needs_rate_ck is not '
            'on the table, so migration 189 has not been applied. 190 replaces '
            'that constraint with a rule that can see the bands table; '
            'replacing something that is not there would silently leave an '
            'eligible scheme with no terms storable.';
    END IF;
END
$guard4$;

-- `department` is how a team is defined, and it must exist as text before a
-- scheme can be scoped to one.
DO $guard5$
DECLARE t text;
BEGIN
    SELECT data_type INTO t
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'manav_employees'
       AND column_name = 'department';
    IF t IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION
            'GUARD 5: staging.manav_employees.department is %, not text. A '
            'department-scoped scheme is resolved through that column and '
            'through nothing else — teams ARE departments here.',
            COALESCE(t, 'absent');
    END IF;
END
$guard5$;

-- Payroll has somewhere to put a commission line and a bonus line.
DO $guard6$
DECLARE t text;
BEGIN
    IF to_regclass('staging.vetana_payslips') IS NULL THEN
        RAISE EXCEPTION 'GUARD 6: staging.vetana_payslips does not exist.';
    END IF;
    SELECT data_type INTO t
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'vetana_payslips'
       AND column_name = 'other_earnings';
    IF t IS DISTINCT FROM 'jsonb' THEN
        RAISE EXCEPTION
            'GUARD 6: vetana_payslips.other_earnings is % rather than jsonb. '
            'Commission and bonus are payslip EARNING LINES in that array; '
            'this file adds no EARNINGS column and will not invent one.',
            COALESCE(t, 'absent');
    END IF;
END
$guard6$;

-- NULLS NOT DISTINCT is PostgreSQL 15+. Measured 17.6 on 2026-08-21; asserted
-- rather than assumed, because on an older server the uniqueness rules below
-- would be created WITHOUT it and two ineligible schemes would both be
-- storable and both be "current".
DO $guard7$
DECLARE v int;
BEGIN
    SELECT current_setting('server_version_num')::int INTO v;
    IF v < 150000 THEN
        RAISE EXCEPTION
            'GUARD 7: PostgreSQL % is older than 15, so NULLS NOT DISTINCT is '
            'unavailable and the scheme-identity indexes below would leave a '
            'hole exactly where revenue_scope is unstated.', v;
    END IF;
END
$guard7$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · The scheme learns WHOSE revenue it measures, and that its terms are a
--     ladder in a child table.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a · A key a band can point at WITHOUT being able to reach another org.
--
-- 185 recorded the hole and could not close it: "the schema cannot refuse a
-- foreign employee id because there is no composite (id, org_id) key to point
-- an FK at". For the bands table that key can exist, so it does — and the
-- graha_clients join leak becomes unrepresentable here rather than merely
-- guarded against by every reader remembering the predicate.
DO $c_id_org$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'manav_commission_schemes_id_org_uniq'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        ALTER TABLE staging.manav_commission_schemes
            ADD CONSTRAINT manav_commission_schemes_id_org_uniq
            UNIQUE (id, org_id);
    END IF;
END
$c_id_org$;

-- The same key on the employee, so an award cannot be hung on another org's
-- person. 98 rows; one small index.
DO $e_id_org$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'manav_employees_id_org_uniq'
           AND conrelid = 'staging.manav_employees'::regclass
    ) THEN
        ALTER TABLE staging.manav_employees
            ADD CONSTRAINT manav_employees_id_org_uniq UNIQUE (id, org_id);
    END IF;
END
$e_id_org$;

-- 1b · WHOSE REVENUE. No inline CHECK on the ADD COLUMN — PostgreSQL skips the
-- WHOLE clause when the column already exists, constraint included, and
-- reports success having added nothing. The constraints are separate
-- statements below and VERIFY 4 reads them back from pg_constraint.
ALTER TABLE staging.manav_commission_schemes
    ADD COLUMN IF NOT EXISTS revenue_scope text;

DO $ck_scope$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'manav_commission_schemes_scope_ck'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        ALTER TABLE staging.manav_commission_schemes
            ADD CONSTRAINT manav_commission_schemes_scope_ck
            CHECK (revenue_scope IS NULL
                   OR revenue_scope IN ('own', 'department'));
    END IF;
END
$ck_scope$;

DO $ck_needs_scope$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'manav_commission_schemes_eligible_needs_scope_ck'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        ALTER TABLE staging.manav_commission_schemes
            ADD CONSTRAINT manav_commission_schemes_eligible_needs_scope_ck
            CHECK (eligible IS NOT TRUE OR revenue_scope IS NOT NULL);
    END IF;
END
$ck_needs_scope$;

-- 1c · 189's constraint, replaced rather than weakened.
--
-- 189 said: eligible => rate_percent IS NOT NULL AND rate_percent > 0. The
-- terms are now a ladder in a child table, so the row-level half becomes "IF a
-- legacy rate is stated here at all it must be a real one" and the "terms
-- exist" half moves to the deferred trigger in section 3, which can see the
-- child table. Both halves are asserted by VERIFY 8.
ALTER TABLE staging.manav_commission_schemes
    DROP CONSTRAINT IF EXISTS manav_commission_schemes_eligible_needs_rate_ck;

DO $ck_stated_rate$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname  = 'manav_commission_schemes_stated_rate_ck'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        ALTER TABLE staging.manav_commission_schemes
            ADD CONSTRAINT manav_commission_schemes_stated_rate_ck
            CHECK (rate_percent IS NULL OR rate_percent > 0);
    END IF;
END
$ck_stated_rate$;

-- 1d · The superseded mode column stops carrying an answer nothing reads.
-- Its CHECK is LEFT IN PLACE and still passes: a NULL satisfies an IN () CHECK.
ALTER TABLE staging.manav_commission_schemes
    ALTER COLUMN threshold_mode DROP DEFAULT;

ALTER TABLE staging.manav_commission_schemes
    ALTER COLUMN threshold_mode DROP NOT NULL;

-- 1e · A scheme's IDENTITY is (employee, period, scope).
--
-- Both of these REPLACE a 185 rule. What they prevented — two rows both
-- claiming to be current, so a person's rate depends on row order — is still
-- prevented, now within each (period, scope) pair. A monthly-own row and an
-- annual-department row never compete to answer the same question.
--
-- Created BEFORE the old ones are removed, so the guarantee is never absent at
-- any point inside this transaction.
CREATE UNIQUE INDEX IF NOT EXISTS manav_commission_schemes_version_uniq_idx
    ON staging.manav_commission_schemes
       (org_id, employee_id, period, revenue_scope, effective_from)
    NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS
    manav_commission_schemes_one_open_scheme_per_period_idx
    ON staging.manav_commission_schemes
       (org_id, employee_id, period, revenue_scope)
    NULLS NOT DISTINCT
    WHERE effective_to IS NULL;

ALTER TABLE staging.manav_commission_schemes
    DROP CONSTRAINT IF EXISTS manav_commission_schemes_version_uniq;

DROP INDEX IF EXISTS staging.manav_commission_schemes_one_open_scheme_idx;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The bands. Many per scheme; each one a floor and a rate; no cap on how
--     many — the owner said "and so on".
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staging.manav_commission_bands (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Denormalised from the scheme, and NOT merely for convenience: it is half
    -- of the composite foreign key below, which is what makes a band pointing
    -- at another org's scheme unrepresentable rather than merely unlikely.
    org_id        uuid NOT NULL,
    scheme_id     uuid NOT NULL,

    -- The amount from which THIS band's rate applies. There is no upper bound
    -- column: a band runs to the next band's from_amount, or to infinity if it
    -- is the highest. One edge between two neighbours, written once, so two
    -- bands cannot disagree about where one ends and the next begins.
    --
    -- NO DEFAULT. 0 ("from the first rupee") is a real and common floor, but it
    -- is a floor the FIRM states — the product supplying it would be inventing
    -- the entry threshold of somebody's commission.
    from_amount   numeric(14,2) NOT NULL,

    -- Percent, three decimals: 3, 3.75, 7.5. NOT a fraction. NO DEFAULT, and
    -- must be above zero: "the first lakh earns nothing" is said by the lowest
    -- band starting at ₹1,00,000, not by a 0% band, so a zero here is always an
    -- unfinished form.
    rate_percent  numeric(6,3) NOT NULL,

    -- public.users.user_id (text) — migration 030's convention. Who recorded
    -- the band. Never the employee it pays.
    created_by    text,
    created_at    timestamptz NOT NULL DEFAULT NOW(),
    updated_at    timestamptz NOT NULL DEFAULT NOW(),

    CONSTRAINT manav_commission_bands_from_ck CHECK (from_amount >= 0),

    CONSTRAINT manav_commission_bands_rate_ck CHECK (
        rate_percent > 0 AND rate_percent <= 100),

    -- THE CONSTRAINT THIS TABLE EXISTS FOR. Two bands with the same
    -- from_amount make the payout depend on which row is read first. Refused
    -- at write time rather than discovered on a payslip.
    CONSTRAINT manav_commission_bands_one_per_threshold_uniq
        UNIQUE (scheme_id, from_amount),

    -- Composite, so a band's org and its scheme's org cannot differ.
    -- RESTRICT and not CASCADE: a scheme with bands is a promise made to a
    -- person, and deleting the promise by deleting its parent should have to
    -- be deliberate rather than automatic.
    CONSTRAINT manav_commission_bands_scheme_fk
        FOREIGN KEY (scheme_id, org_id)
        REFERENCES staging.manav_commission_schemes (id, org_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The read every caller performs: one scheme's ladder, lowest band first.
CREATE INDEX IF NOT EXISTS manav_commission_bands_scheme_idx
    ON staging.manav_commission_bands (org_id, scheme_id, from_amount);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · The property 189 protected, re-stated so it can see the child table.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- No SECURITY DEFINER: the function reads only the two tables the writer is
-- already writing, and a definer-rights trigger on a shared database is a
-- privilege escalation waiting for a search_path bug. `search_path` is pinned
-- anyway and every identifier is schema-qualified.
CREATE OR REPLACE FUNCTION staging.manav_commission_terms_stated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, staging
AS $fn$
DECLARE
    sid    uuid;
    s      record;
    n_band int;
BEGIN
    -- Which scheme is being asserted about. Written as statements rather than
    -- a CASE expression so NEW is never referenced on a DELETE.
    IF TG_TABLE_NAME = 'manav_commission_schemes' THEN
        IF TG_OP = 'DELETE' THEN sid := OLD.id; ELSE sid := NEW.id; END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN sid := OLD.scheme_id; ELSE sid := NEW.scheme_id; END IF;
    END IF;

    SELECT * INTO s FROM staging.manav_commission_schemes WHERE id = sid;
    IF NOT FOUND THEN
        -- The scheme itself is gone. There is no arrangement left to be
        -- incomplete, and raising here would only make a legitimate cleanup
        -- impossible.
        RETURN NULL;
    END IF;

    SELECT count(*) INTO n_band
      FROM staging.manav_commission_bands WHERE scheme_id = sid;

    -- ONE representation of the terms, never two. `rate_percent` is a
    -- SUPERSEDED column kept for history; a value in it beside a ladder is two
    -- answers, and whichever a reader trusts becomes the cheque.
    IF s.rate_percent IS NOT NULL AND n_band > 0 THEN
        RAISE EXCEPTION
            'Commission scheme % states BOTH the superseded flat rate (% '
            'percent) and % band(s). The terms are the BANDS. Clear '
            'rate_percent.', sid, s.rate_percent, n_band
            USING ERRCODE = 'check_violation';
    END IF;

    -- A ladder's entry threshold is its LOWEST BAND. The superseded
    -- threshold_amount as well would be the same fact stated twice, and they
    -- can disagree.
    IF n_band > 0 AND COALESCE(s.threshold_amount, 0) <> 0 THEN
        RAISE EXCEPTION
            'Commission scheme % has % band(s) AND the superseded '
            'threshold_amount = %. The entry threshold of a ladder is its '
            'lowest band''s from_amount. Leave threshold_amount at 0.',
            sid, n_band, s.threshold_amount
            USING ERRCODE = 'check_violation';
    END IF;

    -- 189's property, intact: an ELIGIBLE scheme with no terms cannot be
    -- stored. It would read on every screen as "this person is on commission",
    -- compute a plausible ₹0 every period, and owe somebody money nobody can
    -- see.
    IF s.eligible IS TRUE AND n_band = 0 THEN
        RAISE EXCEPTION
            'Commission scheme % is ELIGIBLE but has NO BANDS. An eligible '
            'scheme with no terms reads as configured, computes zero every '
            'period, and quietly owes somebody money. State the ladder — at '
            'least one band — or set eligible = FALSE.', sid
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END
$fn$;

-- DEFERRABLE INITIALLY DEFERRED, and that is load-bearing. A scheme and its
-- bands are written in one transaction and the scheme necessarily lands first;
-- an immediate trigger would refuse every correct write, and the only way past
-- it would be to make eligible schemes writable without terms, which is the
-- bug.
DO $trg_schemes$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname   = 'manav_commission_schemes_terms_trg'
           AND tgrelid  = 'staging.manav_commission_schemes'::regclass
    ) THEN
        CREATE CONSTRAINT TRIGGER manav_commission_schemes_terms_trg
            AFTER INSERT OR UPDATE ON staging.manav_commission_schemes
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION staging.manav_commission_terms_stated();
    END IF;
END
$trg_schemes$;

-- On the bands too: removing the last band from an eligible scheme leaves
-- exactly the state the scheme trigger refuses, and a rule enforced on one
-- side only is a rule with a door in it.
DO $trg_bands$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname   = 'manav_commission_bands_terms_trg'
           AND tgrelid  = 'staging.manav_commission_bands'::regclass
    ) THEN
        CREATE CONSTRAINT TRIGGER manav_commission_bands_terms_trg
            AFTER INSERT OR UPDATE OR DELETE ON staging.manav_commission_bands
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION staging.manav_commission_terms_stated();
    END IF;
END
$trg_bands$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Bonus — eligibility on the person, and the award itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- NO INLINE CHECK on an ADD COLUMN IF NOT EXISTS: when the column already
-- exists PostgreSQL skips THE WHOLE CLAUSE, constraint included, and the
-- migration reports success having added nothing. This clause carries only a
-- type, a NOT NULL and a DEFAULT — all three read back by VERIFY 6.
--
-- On PostgreSQL 11+ a non-volatile DEFAULT on ADD COLUMN is metadata-only: no
-- row of the 98 is rewritten, and every one of them reads FALSE.
ALTER TABLE staging.manav_employees
    ADD COLUMN IF NOT EXISTS bonus_eligible boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS staging.manav_bonus_awards (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id        uuid NOT NULL,
    employee_id   uuid NOT NULL,

    -- NO DEFAULT, and > 0 by CHECK. A zero bonus is an unfinished form, and
    -- ₹0 printed on a payslip beside the word "Bonus" is a statement about a
    -- person that nobody made.
    amount        numeric(14,2) NOT NULL,

    -- WHY. NOT NULL and non-blank: a discretionary payment with no stated
    -- reason cannot be audited, defended or explained to the person who did
    -- not get one.
    reason        text NOT NULL,

    -- WHICH PAYROLL MONTH it belongs to — 'YYYY-MM', the same spelling as
    -- staging.vetana_payroll_runs.month (verified live: 27 runs, all of that
    -- shape). Deliberately a MONTH and not a payslip id — see the header.
    pay_period    text NOT NULL,

    -- WHO decided. public.users.user_id (text). An award with no author is an
    -- amount that appeared.
    awarded_by    text NOT NULL,

    -- WHEN it was decided — not when it is paid. The payroll month says that.
    awarded_at    timestamptz NOT NULL DEFAULT NOW(),

    notes         text,
    created_at    timestamptz NOT NULL DEFAULT NOW(),
    updated_at    timestamptz NOT NULL DEFAULT NOW(),

    CONSTRAINT manav_bonus_awards_amount_ck CHECK (amount > 0),

    CONSTRAINT manav_bonus_awards_reason_ck CHECK (btrim(reason) <> ''),

    CONSTRAINT manav_bonus_awards_awarded_by_ck CHECK (btrim(awarded_by) <> ''),

    -- 'YYYY-MM', month 01-12. A typo here does not fail — it silently files
    -- the award against a month no payroll run will look at, and the person is
    -- simply not paid.
    CONSTRAINT manav_bonus_awards_period_ck CHECK (
        pay_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

    -- Composite: an award cannot be hung on another org's employee.
    CONSTRAINT manav_bonus_awards_employee_fk
        FOREIGN KEY (employee_id, org_id)
        REFERENCES staging.manav_employees (id, org_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT

    -- DELIBERATELY NO UNIQUE (org_id, employee_id, pay_period): a festival
    -- bonus and a performance bonus in the same month are two real awards with
    -- two reasons, and a unique key would force one to be lost.
);

-- The read payroll performs: this org's awards for this month, per employee.
CREATE INDEX IF NOT EXISTS manav_bonus_awards_period_idx
    ON staging.manav_bonus_awards (org_id, pay_period, employee_id);

-- The read the employee's own page performs: their awards, newest first.
CREATE INDEX IF NOT EXISTS manav_bonus_awards_employee_idx
    ON staging.manav_bonus_awards (org_id, employee_id, awarded_at DESC);

-- A department-scoped scheme is resolved by grouping employees on
-- `department`, and payroll does that once per settlement period per
-- department. 98 rows today, so this is a correctness-of-plan index rather
-- than a rescue, and it costs nothing.
CREATE INDEX IF NOT EXISTS manav_employees_department_idx
    ON staging.manav_employees (org_id, department);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · Statutory switches — "we dont know how company operates so we dont
--     block", and a payslip that records which way they were set.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- OWNER, 2026-08-21: "we keep it as optional checkbox as we dont know what
-- company org what they works how they work", and then, broadening it: "in
-- general PF, ESI etc as well for all employee keep it as optional please we
-- dont know how company operates so we dont block."
--
-- MOST OF THAT ALREADY EXISTS AND IS NOT REBUILT HERE. Measured read-only
-- 2026-08-21 across 94 salary structures:
--
--     pf_enabled     boolean  DEFAULT true    true=91  false=3   NULL=0
--     esi_enabled    boolean  DEFAULT false   true=3   false=91  NULL=0
--     pt_applicable  boolean  DEFAULT true    true=94  false=0   NULL=0
--     tds_regime     text     DEFAULT 'new'   new=57   old=37    NULL=0
--
-- Firms are already using those differently — three structures run without PF,
-- three with ESI. They are left exactly as they are.
--
-- TWO GAPS, and only these two are closed here.
--
-- GAP 1 · TDS HAD NO OFF SWITCH. `_compute_statutory` ran the slab table
-- unconditionally: `tds_regime` chose old or new and there was no "none", so
-- every employee had TDS deducted whether or not the firm operates TDS on
-- salary at all. `tds_applicable` is added at the same grain as the other
-- three, DEFAULT TRUE — for two reasons that agree: it matches pf_enabled and
-- pt_applicable, and it is BEHAVIOUR-PRESERVING. 871 of 1,095 existing
-- payslips carry a TDS figure; defaulting this to FALSE would silently stop
-- deducting tax for all of them, which is a change in money made by a
-- migration rather than by a firm.
--
-- GAP 2 · WHETHER COMMISSION AND BONUS SIT IN THE PF AND ESI BASE. Four
-- independent answers, because a firm can and often does treat the two
-- components differently:
--
--     commission_in_pf_base    commission_in_esi_base
--     bonus_in_pf_base         bonus_in_esi_base
--
-- All four DEFAULT FALSE, and THAT IS A CHOICE, not a neutral position:
-- unticked means the component does not attract the deduction. It is chosen
-- because it is behaviour-preserving — statutory deductions today are computed
-- on the fixed salary and nothing else — so applying this file and running
-- payroll produces exactly the deductions it produced yesterday.
--
-- WHY HERE AND NOT IN A NEW SETTINGS TABLE. `vetana_salary_structures` is
-- already the home of every statutory switch and `_compute_statutory(basic,
-- gross, structure)` is already handed that row, so this needs no new plumbing
-- and no fallback chain. A payroll-level settings table would be a SECOND
-- place the same answer could live, and the two would eventually disagree —
-- which for a statutory switch means a payslip nobody can explain. Per
-- employee is finer than most firms need; a firm that wants one answer sets
-- the same answer on every structure, and the cost of that is a screen, not a
-- schema.
--
-- ── NULL AND FALSE WERE THE SAME THING, AND THE DEFAULT DISAGREED ───────────
--
-- `_compute_statutory` read `if structure["pf_enabled"]`. asyncpg returns None
-- for a NULL column, None is falsy, so a NULL read as OFF — while the column's
-- DEFAULT is TRUE. A structure created through a path that names the column
-- got PF; one that left it NULL silently did not, and nobody was told.
--
-- The fix is in routers/vetana.py, not here: every flag is now read through
-- one helper that states what an unanswered flag means, and it means WHAT THE
-- COLUMN'S OWN DEFAULT MEANS. No NULL exists in any of the four flags today
-- (measured above: NULL=0 on all of them), so this changes no live figure —
-- it removes a trap rather than repairing damage.
--
-- ── THE PAYSLIP RECORDS WHICH TREATMENT WAS APPLIED ─────────────────────────
--
-- `vetana_payslips.statutory_treatment jsonb DEFAULT '{}'` — the ONE payslip
-- column this file adds, and it is not an earning: commission and bonus are
-- entries in the existing `other_earnings` array and no column is added for
-- them.
--
-- A payslip is a statutory document that is filed, disputed and audited years
-- later, and "was commission in the PF base that month?" must be answerable
-- FROM THE PAYSLIP rather than from whatever the checkbox happens to say
-- today. Somebody ticking a box in March must not silently restate January.
-- So each payslip stores the switches as they were AT THE MOMENT IT WAS
-- COMPUTED, the two bases the deductions were actually computed on, and the
-- list of flags that were unanswered and therefore read at their default.
--
-- NOTHING BLOCKS A RUN. There is no NOT NULL, no CHECK requiring an answer and
-- no validation anywhere that refuses to compute payroll because a firm has
-- not ticked something. An unanswered flag is read at its default and the
-- payslip says that it was.

-- Five switches, one ALTER, no inline CHECK on any of them (the whole clause
-- is skipped when a column already exists, constraint included). Every one is
-- NULLABLE WITH A DEFAULT, exactly like the four that are already there: NULL
-- means nobody answered, and an unanswered flag is read at its default rather
-- than blocking anybody's pay.
ALTER TABLE staging.vetana_salary_structures
    ADD COLUMN IF NOT EXISTS tds_applicable         boolean DEFAULT TRUE;

ALTER TABLE staging.vetana_salary_structures
    ADD COLUMN IF NOT EXISTS commission_in_pf_base  boolean DEFAULT FALSE;

ALTER TABLE staging.vetana_salary_structures
    ADD COLUMN IF NOT EXISTS commission_in_esi_base boolean DEFAULT FALSE;

ALTER TABLE staging.vetana_salary_structures
    ADD COLUMN IF NOT EXISTS bonus_in_pf_base       boolean DEFAULT FALSE;

ALTER TABLE staging.vetana_salary_structures
    ADD COLUMN IF NOT EXISTS bonus_in_esi_base      boolean DEFAULT FALSE;

ALTER TABLE staging.vetana_payslips
    ADD COLUMN IF NOT EXISTS statutory_treatment jsonb DEFAULT '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · The documentation that lives in the database.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE staging.manav_commission_bands IS
    'The ladder: many rows per commission scheme, each a from_amount and the '
    'rate that applies FROM it, and there is no cap on how many. A band has NO '
    'upper bound — it runs to the next band''s from_amount, or to infinity. '
    'EACH BAND PAYS ON ITS OWN PORTION ONLY (income-tax shaped): 3% on the '
    'slice from 1L to 5L, 3.75% on 5L to 7.5L, and so on. That reading is the '
    'owner''s decision of 2026-08-21 and is NOT configurable — the superseded '
    'manav_commission_schemes.threshold_mode was the two-value version of the '
    'same question. UNIQUE (scheme_id, from_amount): two bands at one '
    'threshold make the payout depend on row order. Records an ARRANGEMENT; '
    'nothing here is a payment or a liability.';

COMMENT ON COLUMN staging.manav_commission_bands.from_amount IS
    'The amount, IN THE SETTLEMENT PERIOD AND WITHIN THE SCHEME''S SCOPE, from '
    'which this band''s rate applies. The test is >=: "3% from 1 lakh" '
    'includes exactly 1 lakh. The LOWEST band is the scheme''s entry threshold '
    '— below it nothing is due — so "the first lakh earns nothing" is said '
    'here and never by a 0% band.';

COMMENT ON COLUMN staging.manav_commission_bands.rate_percent IS
    'PERCENT, three decimals: 3, 3.75, 7.5. NOT a fraction, so nobody applies '
    'a 5 as 500%. Must be above zero — a 0% band is an unfinished form, and '
    'the same argument migration 189 made about a default rate.';

COMMENT ON COLUMN staging.manav_commission_schemes.revenue_scope IS
    'WHOSE REVENUE this scheme measures. own = the person''s own attributed '
    'revenue. department = their DEPARTMENT''S, everybody in it — teams ARE '
    'departments here (owner, 2026-08-21), resolved through '
    'manav_employees.department and through nothing else; reporting_to is '
    'filled on 0 of 98 rows and is not read. One person may hold a monthly '
    '''own'' scheme and an annual ''department'' scheme at the same time and '
    'be paid by both. NULLABLE with NO DEFAULT — nobody has said yet — and an '
    'ELIGIBLE scheme must state it, because whose revenue is measured decides '
    'the cheque exactly as the rate does. An employee with no department '
    'reads "department not set", NEVER 0.';

COMMENT ON COLUMN staging.manav_commission_schemes.period IS
    'monthly | quarterly | annual — how often the arrangement SETTLES, and '
    'therefore what the ladder is tested against. Part of a scheme''s IDENTITY '
    'together with revenue_scope since migration 190: at most one OPEN scheme '
    'per employee per (period, scope), so a monthly-own and an annual-'
    'department arrangement coexist and both pay. Quarters are FINANCIAL year '
    'quarters (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar).';

COMMENT ON COLUMN staging.manav_commission_schemes.rate_percent IS
    'SUPERSEDED by staging.manav_commission_bands (migration 190) and read by '
    'NOTHING. Kept because dropping a column is irreversible and this one may '
    'yet hold history. A row may not state this AND bands — the trigger '
    'manav_commission_terms_stated() refuses it, because two representations '
    'of the terms means whichever a reader trusts becomes the cheque.';

COMMENT ON COLUMN staging.manav_commission_schemes.threshold_amount IS
    'SUPERSEDED by the LOWEST BAND''s from_amount (migration 190) and read by '
    'NOTHING. A banded scheme must leave this at 0; the trigger refuses a '
    'ladder that also states a threshold here, because the entry threshold is '
    'stated once or it can disagree with itself.';

COMMENT ON COLUMN staging.manav_commission_schemes.threshold_mode IS
    'SUPERSEDED and read by NOTHING. This was the two-value version — excess | '
    'whole — of the question "does a rate apply to the slice above a threshold '
    'or to the whole amount", and the owner answered it on 2026-08-21: each '
    'band pays on its own portion. Migration 190 removed this column''s '
    'DEFAULT and its NOT NULL so a row written from now on records NULL here — '
    'nothing is said, read the bands — rather than a meaningless ''excess'' a '
    'future reader might mistake for a live setting.';

COMMENT ON TABLE staging.manav_bonus_awards IS
    'One row per bonus somebody DECIDED to give. DISCRETIONARY: nothing here '
    'is computed from turnover, gross profit, a threshold, a band or a '
    'department, and no code may derive it. Amount, why, which payroll month '
    '(YYYY-MM, matching vetana_payroll_runs.month), who awarded it and when. '
    'Reaches pay as an entry in vetana_payslips.other_earnings; there is '
    'deliberately no payslip_id, because process_payroll deletes and '
    're-inserts a month''s payslips and a stamped award would vanish on the '
    'second run.';

COMMENT ON COLUMN staging.manav_bonus_awards.amount IS
    'Rupees. NO DEFAULT and must be > 0. A zero bonus is an unfinished form, '
    'and this product never prints 0 where the truth is "nothing was awarded".';

COMMENT ON COLUMN staging.manav_bonus_awards.pay_period IS
    'The payroll month this award is paid in — YYYY-MM, exactly '
    'vetana_payroll_runs.month. Payroll selects awards BY THIS MONTH, so a '
    're-run of the month produces the same payslip.';

COMMENT ON COLUMN staging.manav_employees.bonus_eligible IS
    'Has the firm said this person may receive a bonus at all? DEFAULT FALSE — '
    'a default that REFUSES, so a carelessly written row makes nobody '
    'eligible. Not a promise and not an amount: an award is a row in '
    'staging.manav_bonus_awards.';

COMMENT ON COLUMN staging.manav_employees.department IS
    'The employee''s department, by NAME. Since migration 190 this is also how '
    'a TEAM is defined for a department-scoped commission scheme — the owner''s '
    'decision, 2026-08-21, and the only grouping with data: filled on 87 of 98 '
    'rows across 18 distinct names, while reporting_to is filled on 0 of 98. A '
    'person with no department cannot have a department-scoped commission '
    'computed, and the answer for them is "department not set" — never 0.';

COMMENT ON COLUMN staging.vetana_salary_structures.tds_applicable IS
    'Does this firm deduct TDS on this person''s salary at all? Before '
    'migration 190 the slab table ran unconditionally and there was no way to '
    'say no — tds_regime chose old or new and offered no "none". DEFAULT TRUE, '
    'matching pf_enabled and pt_applicable and preserving what every existing '
    'payslip already did (871 of 1,095 carry a TDS figure). NULL means nobody '
    'answered and is read AS THE DEFAULT; nothing blocks a payroll run.';

COMMENT ON COLUMN staging.vetana_salary_structures.commission_in_pf_base IS
    'Does commission sit in the PROVIDENT FUND base for this person? DEFAULT '
    'FALSE, and that is a CHOICE rather than a neutral position: unticked '
    'means commission does not attract PF. It is chosen because it preserves '
    'what payroll did before commission existed. The rate and the ₹1,800 cap '
    'are law and are untouched — this changes only WHAT THE BASE INCLUDES. '
    'Whichever way it is set, the payslip records it in statutory_treatment, '
    'so changing this in March cannot restate January.';

COMMENT ON COLUMN staging.vetana_salary_structures.commission_in_esi_base IS
    'Does commission sit in the ESI base — both the amount charged AND the '
    '₹21,000 gross ceiling that decides whether ESI applies at all? DEFAULT '
    'FALSE for the same behaviour-preserving reason. The 0.75%% / 3.25%% rates '
    'and the ceiling itself are law and are untouched.';

COMMENT ON COLUMN staging.vetana_salary_structures.bonus_in_pf_base IS
    'Does a bonus sit in the PF base for this person? Independent of the '
    'commission answer, because firms treat the two differently. DEFAULT '
    'FALSE. Recorded on every payslip it affects.';

COMMENT ON COLUMN staging.vetana_salary_structures.bonus_in_esi_base IS
    'Does a bonus sit in the ESI base, ceiling included? Independent of the '
    'commission answer. DEFAULT FALSE. Recorded on every payslip it affects.';

COMMENT ON COLUMN staging.vetana_payslips.statutory_treatment IS
    'WHICH TREATMENT THIS PAYSLIP WAS COMPUTED UNDER, frozen at the moment it '
    'was computed. A payslip is filed, disputed and audited years later, and '
    '"was commission in the PF base that month?" must be answerable from the '
    'payslip rather than from whatever the checkbox says today — somebody '
    'ticking a box in March must not silently restate January. Holds the five '
    'switches as they stood, the PF and ESI bases the deductions were actually '
    'computed on, and `unanswered`: the flags that were NULL and were '
    'therefore read at their default. NOT an earning — commission and bonus '
    'are entries in other_earnings, and no column is added for those.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · PROVE IT, IN THE SAME TRANSACTION.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
    n_rows      bigint;
    n_bands     bigint;
    n_awards    bigint;
    n_eligible  bigint;
    n_dept      bigint;
    n_emp       bigint;
    has_default text;
    is_notnull  boolean;
    n           int;
    accepted    boolean := TRUE;
    probe_emp   uuid;
    probe_org   uuid;
BEGIN
    -- VERIFY 1 — the scheme table is still EMPTY. It held 0 rows at GUARD 3;
    -- if it holds any now, something in THIS transaction wrote a commission
    -- arrangement, and an arrangement nobody agreed to sits under somebody's
    -- name on a report a firm might act on.
    SELECT count(*) INTO n_rows FROM staging.manav_commission_schemes;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 1: this migration writes NOTHING that survives, yet '
            'manav_commission_schemes holds % row(s) and held none at GUARD 3. '
            'Rolling back.', n_rows;
    END IF;

    -- VERIFY 2 — both new tables exist and are empty. No seeded ladder, no
    -- seeded award.
    SELECT count(*) INTO n_bands  FROM staging.manav_commission_bands;
    SELECT count(*) INTO n_awards FROM staging.manav_bonus_awards;
    IF n_bands <> 0 OR n_awards <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 2: this file seeds nothing, yet bands=% awards=%. A seeded '
            'band is a rate nobody agreed; a seeded award is money.',
            n_bands, n_awards;
    END IF;

    -- VERIFY 3 — revenue_scope landed, with NO default and NULLABLE, so
    -- "nobody has said yet" is representable and nothing is chosen for a firm.
    SELECT column_default, (is_nullable = 'NO')
      INTO has_default, is_notnull
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name   = 'manav_commission_schemes'
       AND column_name  = 'revenue_scope';
    IF is_notnull IS NULL THEN
        RAISE EXCEPTION
            'VERIFY 3: revenue_scope was not added. ADD COLUMN IF NOT EXISTS '
            'skips the WHOLE clause when the column exists — read '
            'pg_attribute, not this migration.';
    END IF;
    IF has_default IS NOT NULL THEN
        RAISE EXCEPTION
            'VERIFY 3: revenue_scope carries a default (%). Whose revenue a '
            'scheme measures decides the cheque exactly as the rate does.',
            has_default;
    END IF;
    IF is_notnull THEN
        RAISE EXCEPTION
            'VERIFY 3: revenue_scope is NOT NULL, so an ineligible scheme '
            'would have to invent a scope for an arrangement that does not '
            'exist.';
    END IF;

    -- The superseded mode column no longer supplies an answer.
    SELECT column_default INTO has_default
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name   = 'manav_commission_schemes'
       AND column_name  = 'threshold_mode';
    IF has_default IS NOT NULL THEN
        RAISE EXCEPTION
            'VERIFY 3: threshold_mode still defaults to %. It is superseded by '
            'the bands and must record NULL, not a value a later reader could '
            'mistake for a live setting.', has_default;
    END IF;

    -- …and it is still THERE. This file drops no column.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'staging'
                      AND table_name   = 'manav_commission_schemes'
                      AND column_name  = 'threshold_mode') THEN
        RAISE EXCEPTION
            'VERIFY 3: threshold_mode has been DROPPED. Superseded is not the '
            'same as deleted, and this file drops nothing.';
    END IF;

    -- VERIFY 4 — every constraint, read from pg_constraint rather than assumed
    -- from the DDL. A CHECK written inline on a column that already existed is
    -- silently skipped, and pg_constraint is the only truth.
    SELECT count(*) INTO n
      FROM pg_constraint
     WHERE conrelid = 'staging.manav_commission_schemes'::regclass
       AND conname IN ('manav_commission_schemes_scope_ck',
                       'manav_commission_schemes_eligible_needs_scope_ck',
                       'manav_commission_schemes_stated_rate_ck',
                       'manav_commission_schemes_id_org_uniq');
    IF n <> 4 THEN
        RAISE EXCEPTION
            'VERIFY 4: expected 4 named constraints on '
            'manav_commission_schemes, found %.', n;
    END IF;

    SELECT count(*) INTO n
      FROM pg_constraint
     WHERE conrelid = 'staging.manav_commission_bands'::regclass
       AND conname IN ('manav_commission_bands_from_ck',
                       'manav_commission_bands_rate_ck',
                       'manav_commission_bands_one_per_threshold_uniq',
                       'manav_commission_bands_scheme_fk');
    IF n <> 4 THEN
        RAISE EXCEPTION
            'VERIFY 4: expected 4 constraints on manav_commission_bands, '
            'found %. Without the threshold uniqueness, two bands at one '
            'amount make the payout depend on row order.', n;
    END IF;

    SELECT count(*) INTO n
      FROM pg_constraint
     WHERE conrelid = 'staging.manav_bonus_awards'::regclass
       AND conname IN ('manav_bonus_awards_amount_ck',
                       'manav_bonus_awards_reason_ck',
                       'manav_bonus_awards_awarded_by_ck',
                       'manav_bonus_awards_period_ck',
                       'manav_bonus_awards_employee_fk');
    IF n <> 5 THEN
        RAISE EXCEPTION
            'VERIFY 4: expected 5 constraints on manav_bonus_awards, found %.',
            n;
    END IF;

    -- VERIFY 5 — a scheme's identity is (employee, period, scope), and the old
    -- rules are gone rather than sitting alongside the new ones still
    -- forbidding what the owner asked for.
    IF EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname = 'staging'
                  AND indexname  = 'manav_commission_schemes_one_open_scheme_idx') THEN
        RAISE EXCEPTION
            'VERIFY 5: the old one-open-scheme index is still present and '
            'still forbids a person holding a monthly-own and an annual-'
            'department scheme at once.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'staging.manav_commission_schemes'::regclass
                  AND conname  = 'manav_commission_schemes_version_uniq') THEN
        RAISE EXCEPTION
            'VERIFY 5: the old version key is still present and still forbids '
            'two schemes starting on the same day.';
    END IF;

    SELECT count(*) INTO n
      FROM pg_indexes
     WHERE schemaname = 'staging'
       AND indexname IN ('manav_commission_schemes_version_uniq_idx',
                         'manav_commission_schemes_one_open_scheme_per_period_idx');
    IF n <> 2 THEN
        RAISE EXCEPTION
            'VERIFY 5: expected both replacement uniqueness indexes, found %. '
            'Dropping the old rules without them would let two rows both claim '
            'to be a person''s current monthly-own arrangement, and their rate '
            'would depend on row order.', n;
    END IF;

    -- Both must key on period AND scope, or a person cannot hold the two
    -- arrangements the owner described.
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'staging'
           AND indexname  = 'manav_commission_schemes_one_open_scheme_per_period_idx'
           AND indexdef ILIKE '%period%' AND indexdef ILIKE '%revenue_scope%'
    ) THEN
        RAISE EXCEPTION
            'VERIFY 5: the one-open-scheme index does not key on both period '
            'and revenue_scope.';
    END IF;

    -- VERIFY 6 — bonus_eligible landed as intended, and NOBODY became
    -- eligible. This file makes no decision about any person.
    SELECT (is_nullable = 'NO'), column_default
      INTO is_notnull, has_default
      FROM information_schema.columns
     WHERE table_schema = 'staging' AND table_name = 'manav_employees'
       AND column_name = 'bonus_eligible';
    IF is_notnull IS NULL THEN
        RAISE EXCEPTION
            'VERIFY 6: manav_employees.bonus_eligible was not added. ADD '
            'COLUMN IF NOT EXISTS skips the WHOLE clause when the column '
            'exists — check pg_attribute, not this migration.';
    END IF;
    IF NOT is_notnull OR has_default IS NULL THEN
        RAISE EXCEPTION
            'VERIFY 6: bonus_eligible is nullable or has no default '
            '(not null=%, default=%). It must be NOT NULL DEFAULT FALSE so '
            'that an unanswered question reads as "no".',
            is_notnull, COALESCE(has_default, 'none');
    END IF;
    SELECT count(*) INTO n_eligible
      FROM staging.manav_employees WHERE bonus_eligible IS TRUE;
    IF n_eligible <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 6: % employee(s) are bonus_eligible. This file makes '
            'nobody eligible for anything; the firm decides, one person at a '
            'time.', n_eligible;
    END IF;

    -- VERIFY 7 — both constraint triggers exist and are DEFERRABLE. An
    -- immediate one would refuse every correct write of a scheme with bands,
    -- and the pressure to "fix" that is what would delete the rule.
    SELECT count(*) INTO n
      FROM pg_trigger
     WHERE tgname IN ('manav_commission_schemes_terms_trg',
                      'manav_commission_bands_terms_trg')
       AND NOT tgisinternal
       AND tgdeferrable
       AND tginitdeferred;
    IF n <> 2 THEN
        RAISE EXCEPTION
            'VERIFY 7: expected 2 DEFERRABLE INITIALLY DEFERRED constraint '
            'triggers, found %.', n;
    END IF;

    -- VERIFY 8 — THE PROPERTY, PROVEN RATHER THAN DESCRIBED.
    --
    -- 189 made an eligible scheme with no terms impossible to store. The terms
    -- moved to a child table, so this asserts the replacement works: insert an
    -- eligible scheme with no bands, with constraints made IMMEDIATE so the
    -- trigger fires inside this block.
    --
    -- Both outcomes are safe. If the database refuses it, the inner block's
    -- exception handler rolls back to its own savepoint and the row is gone.
    -- If the database ACCEPTS it, the RAISE below aborts the whole transaction
    -- and every ALTER in this file goes with it. The probe cannot survive.
    SELECT id, org_id INTO probe_emp, probe_org
      FROM staging.manav_employees ORDER BY id LIMIT 1;

    IF probe_emp IS NULL THEN
        RAISE NOTICE '190 · no employee row exists, so the eligible-needs-'
                     'terms proof could not be run. The trigger is installed '
                     '(VERIFY 7); nothing exercised it.';
    ELSE
        SET CONSTRAINTS ALL IMMEDIATE;
        BEGIN
            INSERT INTO staging.manav_commission_schemes
                (org_id, employee_id, eligible, basis, revenue_scope, period,
                 effective_from, notes)
            VALUES (probe_org, probe_emp, TRUE, 'turnover', 'own', 'monthly',
                    DATE '1900-01-01',
                    'migration 190 VERIFY probe — MUST NEVER COMMIT');
        EXCEPTION WHEN OTHERS THEN
            accepted := FALSE;
        END;
        SET CONSTRAINTS ALL DEFERRED;

        IF accepted THEN
            RAISE EXCEPTION
                'VERIFY 8: an ELIGIBLE scheme with NO BANDS was ACCEPTED. That '
                'is the exact state migration 189 was written to make '
                'unstorable — it reads as configured, computes zero every '
                'period, and owes somebody money nobody can see. Rolling back '
                'the entire migration, probe row included.';
        END IF;

        SELECT count(*) INTO n_rows FROM staging.manav_commission_schemes;
        IF n_rows <> 0 THEN
            RAISE EXCEPTION
                'VERIFY 8: the refused probe row survived — % row(s) present. '
                'Rolling back.', n_rows;
        END IF;
    END IF;

    -- VERIFY 9 — the statutory switches landed, nullable, with the defaults
    -- argued in section 5, and NOBODY was opted into anything.
    FOR has_default, is_notnull, n IN
        SELECT column_default, (is_nullable = 'NO'), 0
          FROM information_schema.columns
         WHERE table_schema = 'staging'
           AND table_name   = 'vetana_salary_structures'
           AND column_name IN ('tds_applicable', 'commission_in_pf_base',
                               'commission_in_esi_base', 'bonus_in_pf_base',
                               'bonus_in_esi_base')
    LOOP
        IF is_notnull THEN
            RAISE EXCEPTION
                'VERIFY 9: a statutory switch is NOT NULL. An unanswered flag '
                'must be storable — the owner said "we dont block".';
        END IF;
        IF has_default IS NULL THEN
            RAISE EXCEPTION
                'VERIFY 9: a statutory switch has no default, so an '
                'unanswered flag has no stated reading and payroll would have '
                'to guess.';
        END IF;
    END LOOP;

    SELECT count(*) INTO n
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name   = 'vetana_salary_structures'
       AND column_name IN ('tds_applicable', 'commission_in_pf_base',
                           'commission_in_esi_base', 'bonus_in_pf_base',
                           'bonus_in_esi_base');
    IF n <> 5 THEN
        RAISE EXCEPTION
            'VERIFY 9: expected 5 statutory switches on '
            'vetana_salary_structures, found %. ADD COLUMN IF NOT EXISTS '
            'skips the WHOLE clause when a column already exists.', n;
    END IF;

    -- Nobody is opted in. The four base switches are new, so any TRUE here
    -- would mean this file decided a firm's PF treatment for it.
    SELECT count(*) INTO n
      FROM staging.vetana_salary_structures
     WHERE commission_in_pf_base IS TRUE OR commission_in_esi_base IS TRUE
        OR bonus_in_pf_base IS TRUE OR bonus_in_esi_base IS TRUE;
    IF n <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 9: % structure(s) already put commission or bonus in a '
            'statutory base. This file opts nobody in.', n;
    END IF;

    -- TDS stays switched ON everywhere it was on, which is everywhere: this
    -- migration must not stop deducting anybody's tax.
    SELECT count(*) INTO n
      FROM staging.vetana_salary_structures
     WHERE tds_applicable IS FALSE;
    IF n <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 9: % structure(s) have TDS switched OFF immediately after '
            'the column was added. The default is TRUE precisely so that '
            'applying this file changes nobody''s tax.', n;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'staging' AND table_name = 'vetana_payslips'
           AND column_name = 'statutory_treatment' AND data_type = 'jsonb'
    ) THEN
        RAISE EXCEPTION
            'VERIFY 9: vetana_payslips.statutory_treatment is absent or is not '
            'jsonb. Without it a payslip cannot say which treatment it was '
            'computed under, and a checkbox changed in March silently '
            'restates January.';
    END IF;

    -- VERIFY 10 — the honest size of the department gap, measured on the day of
    -- the apply rather than quoted from a note written earlier. A
    -- department-scoped scheme for an employee with no department resolves to
    -- NOTHING, and the answer for them must read "department not set".
    SELECT count(*), count(NULLIF(btrim(COALESCE(department, '')), ''))
      INTO n_emp, n_dept
      FROM staging.manav_employees;

    RAISE NOTICE '190 · bands, scope and bonus in place. 0 schemes, 0 bands, '
                 '0 awards.';
    RAISE NOTICE '    No rate, no band, no scope and no bonus is set for '
                 'anybody. The firm states all of it.';
    RAISE NOTICE '    Each band pays on ITS OWN PORTION — the owner decided '
                 'that on 2026-08-21 and it is not configurable.';
    RAISE NOTICE '    One OPEN scheme per employee per (period, scope): a '
                 'monthly-own and an annual-department arrangement coexist and '
                 'both pay.';
    RAISE NOTICE '    % of % employee(s) have a department. Teams ARE '
                 'departments, so a department-scoped scheme for the other % '
                 'reads "department not set" and NEVER zero.',
                 n_dept, n_emp, n_emp - n_dept;
END
$verify$;

COMMIT;
