-- 228_income_tax_slabs.sql
--
-- Phase 5.2b — THE INCOME-TAX SLAB LADDER, AS DATA. ONE ROW PER BAND.
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   CREATE TABLE  staging.pay_income_tax_slabs          × 1   (NEW, empty)
--   CREATE INDEX  idx_pay_income_tax_slabs_lookup       × 1
--   CREATE UNIQUE INDEX pay_income_tax_slabs_band_uniq  × 1
--   COMMENT       on the table and on eight columns
--   INSERT        staging.pay_income_tax_slabs          × 23  (org_id NULL)
--
--   NO EXISTING TABLE IS ALTERED. No column is added, dropped or retyped on any
--   relation that exists today. No live row anywhere in this database is
--   UPDATEd or DELETEd. `staging.pay_professional_tax`, `staging.statute_calendar`,
--   `staging.vetana_payslips` and `staging.vetana_salary_structures` are not
--   touched at all.
--
-- ── WHY A NEW TABLE, DECIDED FROM THE LIVE CATALOGUE ─────────────────────────
--
-- Four existing relations were read on 2026-08-27 before this file was written.
-- Each was rejected for a structural reason, not a stylistic one.
--
--   · `staging.statute_calendar` — THE OBVIOUS CANDIDATE, AND IT REFUSES THE
--     SHAPE THREE SEPARATE WAYS. Read from `pg_constraint`:
--
--         statute_calendar_version_uniq
--             UNIQUE NULLS NOT DISTINCT (obligation_key, state_code, effective_from)
--
--       A ladder is MANY rows sharing one key and one effective_from. That
--       index makes a second band for the same year impossible — the table is
--       one row per VERSION of one obligation, which is exactly why the thing
--       is not in it already. It also carries NO `org_id` column at all, so a
--       per-org override could not exist without putting a tenant column on
--       national reference data; and `statute_calendar_state_ck` requires
--       `^[A-Z]{2,3}$` where this product's payroll ladders key on the numeric
--       GST code. `services/statute.py` stays the reader for DATED FACTS —
--       forms, due days, the ESI ceiling — and this table is the reader for
--       BANDS. Neither duplicates the other.
--
--   · `staging.pay_professional_tax` — the right SHAPE and the wrong SUBJECT.
--     `state_code` is NOT NULL and income tax is national; `monthly_tax` is a
--     rupee figure and a slab rate is a percentage. Overloading it would mean
--     "monthly_tax means percent when state_code is a sentinel", which is the
--     precise move that makes two surfaces disagree about what the law was.
--
--   · `staging.sales_commission_slabs` — a `slabs jsonb` column, 0 rows. It is
--     sales commission, not tax, AND it is the JSON-ladder shape the owner
--     ruled out on 2026-08-26. `staging.manav_commission_bands` (from_amount,
--     rate_percent) is the same domain.
--
--   · `staging.pay_it_declarations` — 0 rows; an EMPLOYEE's 80C/HRA
--     declarations, one row per person per year. Not a rate table.
--
-- ── THE SHAPE IS THE OWNER'S, AND THE ONE DEPARTURE FROM PT IS STATED ────────
--
-- Owner, 2026-08-26: "do one row per band, and if it needs more it can be done
-- via settings." So a band is a row, `org_id IS NULL` is a shared ladder read by
-- everybody and edited by nobody, and an org's own rows outrank it — the same
-- three rules `pay_professional_tax` already runs on, so there is ONE
-- resolution story in payroll rather than two.
--
-- WHERE IT DIFFERS, AND IT IS A REAL DIFFERENCE RATHER THAN A PREFERENCE:
--
--   · PT picks ONE band and charges its rupee figure. Income tax SLICES —
--     every band below the figure contributes. So resolution here selects a
--     whole GENERATION (all bands sharing one `effective_from` in the winning
--     scope), never a band at a time. Mixing FY 2024-25's ₹7,00,000 step with
--     FY 2025-26's ₹8,00,000 one would produce a ladder no Finance Act has
--     enacted, and every band of it would look individually defensible.
--
--   · PT's bounds are INCLUSIVE and leave paise gaps (15000.00 / 15000.01),
--     because containment is the question. HERE THEY ARE CONTIGUOUS
--     THRESHOLDS: `slab_from` is the figure the rate applies ABOVE, `slab_to`
--     the figure it applies UP TO, so each band's `slab_from` EQUALS its
--     predecessor's `slab_to`. That is how the statute words it — the
--     Department's own table reads "5% above ₹4,00,000" — and it is what makes
--     the arithmetic exact. A band typed 4,00,001 off a newspaper table would
--     under-tax by ₹1 of base, so the settings screen labels the two fields
--     "above" and "up to" rather than "from" and "to". The column COMMENTs say
--     the same thing to anyone reading the catalogue instead of this file.
--
-- ── WRITE-PATH SIDE EFFECTS, STATED BEFORE IT RUNS ───────────────────────────
--
-- ⚠ STAGING AND PRODUCTION SHARE THIS DATABASE. Both write the `staging`
--   schema, so the CREATE and the 23 INSERTs land in production the moment this
--   runs. There is no separate staging copy to try it on.
--
-- ⚠ THESE ARE SHARED ROWS. `org_id IS NULL` means EVERY organisation reads
--   them. This is not a per-tenant seed and cannot be rolled back per tenant.
--
-- WHAT ACTUALLY CHANGES FOR A LIVE PAYROLL RUN THE MOMENT THIS IS APPLIED:
-- **NOTHING, IN EITHER IN-SCOPE ORGANISATION, UNTIL A ROUTER IS DEPLOYED THAT
-- READS IT.** Measured read-only on the live database 2026-08-27:
--
--     staging.pay_income_tax_slabs                does not exist  (0 rows)
--     grep -c 'pay_income_tax_slabs' backend/      0 before this change
--
-- `routers/vetana.py` computes TDS from two ladders written into its own
-- source. This file gives that number somewhere to be read FROM; it does not
-- by itself change where it IS read from. Until `_compute_statutory` is
-- rewired (Phase 5.1, another author, another commit) every payslip carries
-- exactly the TDS it carried yesterday.
--
-- THE LIVE EXPOSURE THAT REWIRING WILL HAVE, so it is on the record before the
-- table exists rather than after. Measured 2026-08-27:
--
--     E2E Test & Associates   1,011 payslips, 17 runs, ₹492,838–₹754,917 of
--                             TDS per month; 30 structures 'new', 30 'old'
--     Unicode Group             149 payslips, 9 runs, ₹959–₹91,713 per month;
--                             25 structures 'new', 7 'old'
--
-- Both orgs are running FY 2026-27 months right now (E2E through 2026-08,
-- Unicode through 2026-09), so the generation that will resolve for them is the
-- one dated 2025-04-01 — see "WHY FY 2026-27 IS NOT A SEPARATE GENERATION".
--
-- RISK: **LOW for this file, MODERATE for the wiring it enables**, and the two
-- are worth separating.
--   · Applying this file cannot move a payslip. It creates an empty relation
--     nothing selects from and seeds reference rows nothing reads. The only
--     failure mode is the CREATE itself failing, which leaves nothing behind.
--   · The realistic harm is later and is a DATA risk: a band below being WRONG
--     and silently deducting the wrong tax from a real person's pay once the
--     wiring lands. That is why every band carries its instrument and its
--     assessment year in its own row, why four ladders were seeded and several
--     were deliberately not, and why the reversal at the foot is one scoped
--     DELETE plus one DROP.
--
-- LOCKS: none worth naming. `CREATE TABLE` takes a lock on a relation that does
-- not exist yet; the two indexes are built on it while it is empty; the INSERT
-- writes 23 rows to a table nothing else can be holding. No ALTER on any
-- existing relation, so nothing queues behind an open transaction and no reader
-- anywhere in the product is blocked for an instant. Contrast migration 096,
-- whose ALTER on `organisations` blocked a table read on nearly every request.
--
-- ── DEPLOY ORDER: THIS FILE FIRST, THEN THE BACKEND. STRICTLY. ───────────────
--
-- `services/income_tax.py` SELECTs `staging.pay_income_tax_slabs` by name and
-- `routers/income_tax_slabs.py` SELECTs, INSERTs, UPDATEs and DELETEs it. If the
-- backend deploys before this file is applied, every one of those statements
-- raises `UndefinedTableError` — the settings screen 500s outright, and
-- `services.income_tax.ladders()` catches, logs and returns `{}`, which means
-- **every payslip in the product silently deducts ₹0 of TDS**. The catch is
-- there so a reference table cannot stop a payroll run; it is not a licence to
-- deploy in the wrong order.
--
--     1. apply THIS file
--     2. verify from the catalogue (queries at the foot)
--     3. deploy the backend
--     4. deploy the frontend
--
-- This is migration 220's lesson repeated: its header records that
-- `manav_employees.state` HAD to land before `routers/manav.py` deployed or
-- every employee read 500'd. The same rule, one table further on.
--
-- ── RE-RUNNING IS SAFE, AND THE INDEX IS WHY ─────────────────────────────────
--
-- `pay_income_tax_slabs_band_uniq` is UNIQUE NULLS NOT DISTINCT on
-- (org_id, regime, effective_from, slab_from), and every INSERT below is
-- `ON CONFLICT DO NOTHING`. So a second run is a no-op and an edit the owner
-- has since made through the settings screen is left alone rather than being
-- silently restored — a SEED, not an upsert, which is the choice migration 224
-- made and stated.
--
-- THAT INDEX IS ALSO A MONEY GUARD, AND IT IS THE ONE THING THIS TABLE HAS THAT
-- `pay_professional_tax` DOES NOT. PT has no unique index at all (verified from
-- `pg_indexes` on 2026-08-27: only the pkey and an org index), and 224's header
-- notes a naked re-run would duplicate its rows. For PT a duplicate is
-- harmless — `_pt_from_slabs` ranks and picks one, and the twin ranks
-- identically. HERE A DUPLICATE BAND WOULD BE SUMMED TWICE AND CHARGE THAT
-- SLICE OF SOMEBODY'S SALARY TWO TIMES OVER. `NULLS NOT DISTINCT` is what makes
-- it bite on the shared rows, whose `org_id` is NULL — under the default
-- `NULLS DISTINCT` every shared band would be unique to itself and the guard
-- would be decorative. The server supports it: `statute_calendar_version_uniq`
-- already uses the same clause, read from `pg_constraint` on this database.
--
-- ── EVERY BAND, ITS INSTRUMENT AND ITS ASSESSMENT YEAR ───────────────────────
--
-- Every rate below is a claim about somebody's take-home pay, so each row
-- carries its own `source_ref` and `assessment_year` in the table rather than
-- only here. A band that could not be established with confidence was LEFT OUT
-- and is listed under "WHAT IS OWED" — a wrong rate seeded is worse than a
-- missing one, because a missing one deducts ₹0 and gets asked about.
--
-- NEW REGIME — section 115BAC(1A) of the Income-tax Act 1961 (and its successor
-- provision in the Income-tax Act 2025 from 1 April 2026), resident individual:
--
--   effective 2023-04-01 · AY 2024-25 · Finance Act 2023 (s.115BAC(1A))
--        0 –  3,00,000   nil        the year the new regime became the DEFAULT
--    3,00,000 –  6,00,000    5%
--    6,00,000 –  9,00,000   10%
--    9,00,000 – 12,00,000   15%
--   12,00,000 – 15,00,000   20%
--   15,00,000 and above     30%
--
--   effective 2024-04-01 · AY 2025-26 · Finance (No. 2) Act 2024
--        0 –  3,00,000   nil
--    3,00,000 –  7,00,000    5%
--    7,00,000 – 10,00,000   10%
--   10,00,000 – 12,00,000   15%
--   12,00,000 – 15,00,000   20%
--   15,00,000 and above     30%
--
--   effective 2025-04-01 · AY 2026-27 · Finance Act 2025
--        0 –  4,00,000   nil
--    4,00,000 –  8,00,000    5%
--    8,00,000 – 12,00,000   10%
--   12,00,000 – 16,00,000   15%
--   16,00,000 – 20,00,000   20%
--   20,00,000 – 24,00,000   25%
--   24,00,000 and above     30%
--
--   Verified 2026-08-27 against the Income Tax Department's own e-filing portal
--   help page for AY 2026-27, https://www.incometax.gov.in/iec/foportal/help/
--   individual/return-applicable-1 — which prints this exact seven-band table
--   and the ₹60,000 / ₹12,00,000 section 87A rebate beside it.
--
-- OLD REGIME — resident individual below 60, First Schedule Part I of each
-- annual Finance Act:
--
--   effective 2017-04-01 · AY 2018-19 onwards · Finance Act 2017
--        0 –  2,50,000   nil        Finance Act 2017 cut the second band from
--    2,50,000 –  5,00,000    5%     10% to 5%; the ladder has not moved since,
--    5,00,000 – 10,00,000   20%     and is unchanged for AY 2026-27 and
--   10,00,000 and above     30%     AY 2027-28.
--
--   ONE GENERATION, ONE DATE, and it covers every payroll month this product
--   has ever run. Re-stamping an unchanged ladder with a fresh date each April
--   would put four identical rows beside four others, and the first edit to one
--   of them would diverge silently. `statute_calendar`'s header states the same
--   rule for the same reason: one date, written once.
--
-- ── WHY FY 2026-27 IS NOT A SEPARATE GENERATION, WHICH MATTERS MOST ──────────
--
-- Both in-scope organisations are running FY 2026-27 months TODAY, so the
-- ladder that resolves for them is the one dated 2025-04-01 — and that is
-- correct, not an oversight. The Union Budget 2026 changed no slab, no basic
-- exemption, no rate. The Income-tax Act 2025 came into force on 1 April 2026
-- and renumbered the provisions (this database already records the consequence:
-- `statute_calendar` supersedes Form 24Q with Form 138 on exactly that date),
-- but it did not restate the rate table.
--
-- So there is nothing to seed for FY 2026-27. An identical seven-band
-- generation dated 2026-04-01 would be seven rows that duplicate seven others,
-- and the first time somebody corrected one of them through the settings screen
-- the two generations would disagree — with the newer one winning, silently.
-- AN UNCHANGED LAW GETS NO NEW ROW. That is the whole reason resolution is
-- "the latest generation on or before the run date" rather than "the generation
-- whose year matches".
--
-- ── WHAT IS OWED, AND WHY IT IS NOT GUESSED HERE ─────────────────────────────
--
-- A. NOT BANDS AT ALL, so they cannot be rows in this table — and NONE of them
--    was in the literal ladder either, so nothing regresses by their absence.
--    Each materially changes the figure, and each needs a schema conversation
--    rather than a seed:
--
--      · SECTION 87A REBATE. Under the new regime for AY 2026-27 it is up to
--        ₹60,000 where total income does not exceed ₹12,00,000 — which is why
--        a salary of ₹12 lakh pays NOTHING despite the 5% and 10% bands above.
--        Under the old regime it is ₹12,500 up to ₹5,00,000. Without it this
--        ladder over-deducts from everybody below the threshold. It is a
--        rebate on the tax, not a band, and expressing it as one would be a
--        rebate no auditor could find.
--      · HEALTH AND EDUCATION CESS, 4% on tax plus surcharge. A multiplier.
--      · SURCHARGE, stepping from nil below ₹50 lakh to 37% above ₹5 crore
--        under the old regime and capped at 25% under the new. A step function
--        on the tax, not on the income.
--      · STANDARD DEDUCTION on salary. It is applied to the INCOME before this
--        ladder sees it; `routers/vetana.py` currently subtracts a flat
--        ₹50,000 for both regimes, which is the old-regime figure — the new
--        regime's has been ₹75,000 since AY 2025-26. That literal is in the
--        caller and is the caller's to fix; it is named here because a reader
--        comparing this ladder's output to a payslip will otherwise blame the
--        ladder.
--
-- B. AGE-BANDED OLD-REGIME EXEMPTIONS. A resident aged 60–80 has a ₹3,00,000
--    basic exemption and one aged 80+ has ₹5,00,000. THIS TABLE HAS NO AGE
--    DIMENSION, exactly as `pay_professional_tax` has no gender dimension for
--    Maharashtra's split (224's header). That needs a column, not a row.
--    Consequence, stated plainly: a senior citizen on the old regime is
--    currently over-taxed on the slice between ₹2,50,000 and ₹3,00,000 —
--    ₹2,500 a year at 5%. Reported, not fixed here.
--
-- C. THE ORIGINAL 115BAC LADDER, FY 2020-21 to FY 2022-23 (six-band, 2.5/5/
--    7.5/10/12.5/15 lakh steps under the Finance Act 2020). Deliberately NOT
--    seeded: the earliest payroll month in this database is 2025-04 for E2E and
--    2026-01 for Unicode, so no run can reach a date before 1 April 2023, and a
--    generation nothing can resolve is rows to maintain with no reader. Add it
--    the day somebody needs to restate an FY 2022-23 payslip.
--
-- D. NON-INDIVIDUAL ASSESSEES, non-residents, and the Schedule's other Parts.
--    This is a SALARY payroll engine; every row it will ever compute is a
--    resident individual. Out of scope by subject, not by omission.
--
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1 · The table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.pay_income_tax_slabs (
    id              SERIAL       PRIMARY KEY,

    -- NULL IS A SHARED BAND, READ BY EVERY ORGANISATION. Nullable for exactly
    -- the reason `pay_professional_tax.org_id` is: a Finance Act ladder is
    -- national reference data, seeded once. An org's own rows outrank the
    -- shared ladder WHOLESALE — see `services/income_tax.py::_generation`.
    org_id          UUID         NULL,

    -- 'new' | 'old'. Matches `vetana_salary_structures.tds_regime`, whose live
    -- values are exactly these two.
    regime          TEXT         NOT NULL,

    -- CONTIGUOUS THRESHOLDS, NOT INCLUSIVE BOUNDS — the one place this table
    -- departs from `pay_professional_tax`. `slab_from` is the ANNUAL TAXABLE
    -- figure the rate applies ABOVE; `slab_to` is the figure it applies UP TO
    -- and NULL means "and above". Each band's `slab_from` equals its
    -- predecessor's `slab_to`.
    slab_from       NUMERIC(14,2) NOT NULL,
    slab_to         NUMERIC(14,2) NULL,

    -- A PERCENTAGE, not a rupee figure. This is where the subject differs from
    -- professional tax, which charges a flat monthly amount per band.
    rate_percent    NUMERIC(6,3) NOT NULL,

    -- The date this GENERATION of the ladder came into force. Every band of one
    -- ladder shares it, and that shared value is what makes a generation
    -- selectable as a unit. NULL is admitted (as it is on PT) and reads as
    -- "always" — a band nobody dated is still a band somebody entered.
    effective_from  DATE         NULL,

    -- The claim's provenance, per band. Free text on purpose: an organisation
    -- entering its own band is not obliged to cite an Act, but every row this
    -- migration seeds carries one.
    assessment_year TEXT         NULL,
    source_ref      TEXT         NULL,
    notes           TEXT         NULL,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      TEXT         NULL,
    updated_at      TIMESTAMPTZ  NULL,
    updated_by      TEXT         NULL,

    -- Save-time refusals, every one of them. NONE of these can stop a payroll
    -- run: a run only ever SELECTs this table, and an unresolvable ladder is
    -- ₹0 by design rather than an error.
    CONSTRAINT pay_income_tax_slabs_regime_ck
        CHECK (regime = ANY (ARRAY['new'::text, 'old'::text])),
    CONSTRAINT pay_income_tax_slabs_from_ck
        CHECK (slab_from >= 0),
    -- STRICTLY greater, because the bounds are contiguous thresholds: a band
    -- whose top equals its bottom is zero rupees wide and can never tax
    -- anything.
    CONSTRAINT pay_income_tax_slabs_band_ck
        CHECK (slab_to IS NULL OR slab_to > slab_from),
    CONSTRAINT pay_income_tax_slabs_rate_ck
        CHECK (rate_percent >= 0 AND rate_percent <= 100)
);

-- ── 2 · The two indexes ──────────────────────────────────────────────────────

-- The read path: `(org_id = $1 OR org_id IS NULL) AND effective_from <= $2`,
-- grouped by regime.
CREATE INDEX IF NOT EXISTS idx_pay_income_tax_slabs_lookup
    ON staging.pay_income_tax_slabs (org_id, regime, effective_from);

-- THE MONEY GUARD. A duplicated band is summed twice and charges that slice of
-- somebody's salary two times over. NULLS NOT DISTINCT is what makes it bite on
-- the shared rows, whose org_id is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS pay_income_tax_slabs_band_uniq
    ON staging.pay_income_tax_slabs (org_id, regime, effective_from, slab_from)
    NULLS NOT DISTINCT;

-- ── 3 · What the catalogue should say about itself ───────────────────────────

COMMENT ON TABLE staging.pay_income_tax_slabs IS
    'Income-tax slab ladder, ONE ROW PER BAND (owner, 2026-08-26). org_id NULL '
    'is a shared national ladder read by every org; an org''s own rows outrank '
    'it as a whole generation. Read by services/income_tax.py; written by '
    'routers/income_tax_slabs.py. An absent ladder deducts 0 and NEVER refuses '
    'a payroll run, and there is deliberately no literal ladder to fall back '
    'to. Phase 5.2b, migration 228.';

COMMENT ON COLUMN staging.pay_income_tax_slabs.org_id IS
    'NULL = SHARED, read by every organisation and editable by none. An org''s '
    'own bands replace the shared ladder wholesale, never band by band.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.regime IS
    '''new'' or ''old''. Matches vetana_salary_structures.tds_regime. An '
    'unrecognised value resolves to no ladder and therefore to 0.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.slab_from IS
    'CONTIGUOUS THRESHOLD, not an inclusive bound: the annual taxable figure '
    'this rate applies ABOVE. Equals the previous band''s slab_to. NOTE this '
    'differs from pay_professional_tax.slab_from, which is inclusive — PT picks '
    'one band by containment, this ladder slices across all of them.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.slab_to IS
    'The annual taxable figure this rate applies UP TO. NULL = and above.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.rate_percent IS
    'Marginal rate on the slice between slab_from and slab_to, as a percentage.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.effective_from IS
    'The date this GENERATION came into force. Every band of one ladder shares '
    'it; that is what makes a generation selectable as a unit. Resolution takes '
    'the latest generation on or before the run''s period end, so re-running an '
    'old month uses that month''s law. An unchanged law gets NO new generation.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.assessment_year IS
    'The AY (or tax year) this band belongs to, e.g. ''AY 2026-27''. Recorded '
    'per row so a payslip figure can be justified without opening a migration.';
COMMENT ON COLUMN staging.pay_income_tax_slabs.source_ref IS
    'The instrument the rate comes from — Finance Act, section, or the '
    'Department page it was verified against.';

-- ── 4 · The seed. 23 SHARED rows, org_id NULL, ON CONFLICT DO NOTHING ────────

INSERT INTO staging.pay_income_tax_slabs
    (org_id, regime, slab_from, slab_to, rate_percent,
     effective_from, assessment_year, source_ref, notes)
VALUES
    -- ── NEW REGIME · AY 2024-25 · the year it became the default ────────────
    (NULL, 'new',        0,   300000,  0, DATE '2023-04-01', 'AY 2024-25',
     'Finance Act 2023, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',   300000,   600000,  5, DATE '2023-04-01', 'AY 2024-25',
     'Finance Act 2023, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',   600000,   900000, 10, DATE '2023-04-01', 'AY 2024-25',
     'Finance Act 2023, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',   900000,  1200000, 15, DATE '2023-04-01', 'AY 2024-25',
     'Finance Act 2023, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',  1200000,  1500000, 20, DATE '2023-04-01', 'AY 2024-25',
     'Finance Act 2023, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',  1500000,     NULL, 30, DATE '2023-04-01', 'AY 2024-25',
     'Finance Act 2023, s.115BAC(1A), Income-tax Act 1961', NULL),

    -- ── NEW REGIME · AY 2025-26 ─────────────────────────────────────────────
    (NULL, 'new',        0,   300000,  0, DATE '2024-04-01', 'AY 2025-26',
     'Finance (No. 2) Act 2024, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',   300000,   700000,  5, DATE '2024-04-01', 'AY 2025-26',
     'Finance (No. 2) Act 2024, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',   700000,  1000000, 10, DATE '2024-04-01', 'AY 2025-26',
     'Finance (No. 2) Act 2024, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',  1000000,  1200000, 15, DATE '2024-04-01', 'AY 2025-26',
     'Finance (No. 2) Act 2024, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',  1200000,  1500000, 20, DATE '2024-04-01', 'AY 2025-26',
     'Finance (No. 2) Act 2024, s.115BAC(1A), Income-tax Act 1961', NULL),
    (NULL, 'new',  1500000,     NULL, 30, DATE '2024-04-01', 'AY 2025-26',
     'Finance (No. 2) Act 2024, s.115BAC(1A), Income-tax Act 1961', NULL),

    -- ── NEW REGIME · AY 2026-27 · IN FORCE FOR BOTH IN-SCOPE ORGS TODAY ─────
    -- Also the ladder that applies to FY 2026-27: the Union Budget 2026 moved
    -- no slab, and the Income-tax Act 2025 renumbered the provision without
    -- restating the rates. An unchanged law gets no new generation.
    (NULL, 'new',        0,   400000,  0, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),
    (NULL, 'new',   400000,   800000,  5, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),
    (NULL, 'new',   800000,  1200000, 10, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),
    (NULL, 'new',  1200000,  1600000, 15, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),
    (NULL, 'new',  1600000,  2000000, 20, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),
    (NULL, 'new',  2000000,  2400000, 25, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),
    (NULL, 'new',  2400000,     NULL, 30, DATE '2025-04-01', 'AY 2026-27',
     'Finance Act 2025, s.115BAC(1A); verified against incometax.gov.in AY 2026-27 slab table',
     'Continues to apply to FY 2026-27: Budget 2026 changed no slab.'),

    -- ── OLD REGIME · one generation, unchanged since AY 2018-19 ─────────────
    (NULL, 'old',        0,   250000,  0, DATE '2017-04-01', 'AY 2018-19 onwards',
     'Finance Act 2017, First Schedule Part I; resident individual below 60',
     'Unchanged through AY 2027-28. One generation, one date.'),
    (NULL, 'old',   250000,   500000,  5, DATE '2017-04-01', 'AY 2018-19 onwards',
     'Finance Act 2017, First Schedule Part I; resident individual below 60',
     'Finance Act 2017 cut this band from 10% to 5%.'),
    (NULL, 'old',   500000,  1000000, 20, DATE '2017-04-01', 'AY 2018-19 onwards',
     'Finance Act 2017, First Schedule Part I; resident individual below 60',
     'Unchanged through AY 2027-28.'),
    (NULL, 'old',  1000000,     NULL, 30, DATE '2017-04-01', 'AY 2018-19 onwards',
     'Finance Act 2017, First Schedule Part I; resident individual below 60',
     'Unchanged through AY 2027-28.')
ON CONFLICT DO NOTHING;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- ── VERIFY FROM THE CATALOGUE, NEVER FROM THIS FILE ──────────────────────────
--
-- An inline CHECK on `ADD COLUMN IF NOT EXISTS` is skipped WHOLE when the
-- column already exists, so a migration file is not evidence a constraint is
-- there. This one is a CREATE rather than an ALTER, but the rule is the rule.
--
--   SELECT c.conname, pg_get_constraintdef(c.oid)
--     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--    WHERE n.nspname='staging' AND t.relname='pay_income_tax_slabs';
--   -- expect 5: pkey + regime_ck + from_ck + band_ck + rate_ck
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='staging' AND tablename='pay_income_tax_slabs';
--   -- expect 3, and band_uniq must read NULLS NOT DISTINCT
--
--   SELECT regime, effective_from, count(*), min(slab_from), max(slab_from)
--     FROM staging.pay_income_tax_slabs GROUP BY 1,2 ORDER BY 1,2;
--   -- expect  new 2023-04-01 6 · new 2024-04-01 6 · new 2025-04-01 7
--   --         old 2017-04-01 4                              = 23 rows
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.pay_income_tax_slabs WHERE org_id IS NULL;
--   DROP TABLE IF EXISTS staging.pay_income_tax_slabs;
--
-- Exact and complete: the relation did not exist before this file ran (verified
-- read-only 2026-08-27 against `information_schema.tables`), nothing else in
-- the database references it — no foreign key points at it, and
-- `vetana_payslips` stores the resulting AMOUNT and its workings, never a band
-- id — and no router selects it until the backend carrying
-- `services/income_tax.py` is deployed.
--
-- ⚠ THE DELETE IS SCOPED `org_id IS NULL` ON PURPOSE. After the settings screen
-- ships, dropping the table would also destroy bands an organisation entered
-- for itself, which no backup of this file can restore. Run the scoped DELETE
-- to undo the SEED; run the DROP only while the table still holds nothing but
-- these 23 rows.
-- ═════════════════════════════════════════════════════════════════════════════
