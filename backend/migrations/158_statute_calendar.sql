-- 158 · statute_calendar — dated statutory facts, asked for AS OF a date.
--
-- WHAT THIS FILE TOUCHES, exactly:
--   CREATES  staging.statute_calendar          (one new table, previously absent —
--            confirmed against the live catalog on 2026-08-19: to_regclass
--            ('staging.statute_calendar') was NULL and no table in either schema
--            held a form number, a section reference or a filing due day)
--   CREATES  three indexes on that new table
--   INSERTS  28 seed rows into that new table
--   ALTERS   nothing. DROPS nothing. UPDATEs and DELETEs nothing.
--   No existing table is read, written, locked or rewritten, so there is no
--   lock-queue risk on organisations or on any hot relation. SET LOCAL
--   lock_timeout is deliberately absent: there is nothing here to queue behind.
--
-- IF IT RUNS TWICE: nothing happens. CREATE TABLE / CREATE INDEX are
-- IF NOT EXISTS, and the seed is ON CONFLICT ON CONSTRAINT
-- statute_calendar_version_uniq DO NOTHING, whose arbiter is
-- (obligation_key, state_code, effective_from) with NULLS NOT DISTINCT — so a
-- re-run cannot mint a second copy of an all-India row just because its
-- state_code is NULL. DO NOTHING and not DO UPDATE, on purpose: if a lead has
-- corrected a seeded row by hand, a re-run of this file must not silently
-- overwrite the correction with tonight's understanding of the law.
--
-- SHARED-DATABASE NOTE: staging and production share this database and
-- production writes to `staging` too. One new empty table and its own seed;
-- nothing existing is altered and no existing row is written, so applying this
-- cannot change any figure any user sees today. Production's code (main,
-- 1aa49855) does not read this table — nothing does until a caller imports
-- services/statute.py.
--
-- ── WHY THIS TABLE EXISTS ────────────────────────────────────────────────────
-- Twelve-plus planned skills print a form number, a section number, a threshold
-- or a due date. Hardcoded in Python, those go stale SILENTLY — the skill keeps
-- answering, confidently, with last year's law. That already happened: the
-- Income-tax Act 2025 came into force on 1 April 2026 and renumbered the TDS
-- forms (16→130, 16A→131, 24Q→138, 26Q→140, 27Q→144, 27EQ→143) and the sections
-- with them (206AA→397(2), 43B(h)→37(2)(g)); a return prepared under an old form
-- name for a post-1-April-2026 payment is rejected at TRACES. Meanwhile the 12%
-- and 28% GST slabs were abolished on 22 September 2025 and
-- frontend/src/pages/ganit/ProductsTab.jsx still offers both in its dropdown.
--
-- So a statutory fact is a ROW WITH A VALIDITY WINDOW, never a constant, and the
-- read API (services/statute.py) makes the date a REQUIRED argument so that
-- "which form?" cannot be asked without saying "as of when?".
--
-- ── THE VALIDITY WINDOW IS HALF-OPEN: [effective_from, effective_to) ─────────
-- effective_to is the first day the fact is NOT true, never the last day it is.
-- This is the whole reason the 24Q/138 boundary is expressible without an
-- off-by-one argument: the 24Q row ends at 2026-04-01 and the 138 row begins at
-- 2026-04-01, one date written once, and 31 March 2026 answers 24Q while 1 April
-- 2026 answers 138. If a future row is written with effective_to meaning "last
-- valid day", one day of law silently gets two answers or none.
--
-- ── WHAT IS DELIBERATELY NOT SEEDED ─────────────────────────────────────────
--  * The 2025-Act SECTION for each renumbered FORM. Only the two section
--    renumberings verified on 2026-08-19 (206AA→397(2), 43B(h)→37(2)(g)) carry a
--    section_ref on their post-2026-04-01 row. Guessing a section number is
--    precisely the failure this table exists to prevent, so those cells are NULL
--    and their notes say why.
--  * The DUE DATES under the 2025 Act. The form renumbering was verified; that
--    the 15-June / quarterly dates carried across was not. NULL, with a note.
--  * Any STATE-SPECIFIC row. state_code exists and services/statute.py resolves
--    it (a state row outranks the all-India row for the same key), but the
--    state-specific facts within reach tonight — the GSTR-3B QRMP 22nd/24th
--    State groups, professional-tax return dates — could not be verified, and a
--    guessed state row is worse than an absent one. Seed them when verified.
--
-- verified_on records the date a row was last checked against a source, so
-- staleness is queryable ("no fact re-verified in 400 days") rather than a
-- matter of trust. effective_from_exact is FALSE where the start date is a
-- conservative FLOOR rather than a researched commencement — the 1961-Act forms
-- long predate 1962-04-01 as anything we could cite, and a skill must never
-- print "in force since 1 April 1962" off the back of that placeholder.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.statute_calendar (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- The stable key a skill names. Dotted, lowercase, never renamed once a
    -- skill references it: renaming a key is a silent no-result, not an error.
    obligation_key        TEXT        NOT NULL,
    title                 TEXT        NOT NULL,

    -- NOT CHECKed, on purpose, and the asymmetry with periodicity below is
    -- deliberate: a new authority (a State commercial-tax department, a new
    -- regulator) must not need a migration before its first fact can be seeded.
    authority             TEXT        NOT NULL,
    statute               TEXT,

    form_number           TEXT,
    section_ref           TEXT,

    -- CHECKed, and periodicity alone is, because a typo here does not fail — it
    -- drops the row out of "what is due monthly" and the caller sees a shorter
    -- list, not an error.
    periodicity           TEXT        NOT NULL,

    -- due_day NULL means THE SCHEDULE IS NOT A DAY-OF-MONTH RULE. Read `notes`;
    -- do not guess. The TDS statements are the case that forced this: Q1-Q3 fall
    -- on the 31st of the following month but Q4 falls on 31 May, so encoding
    -- "day 31, one month after period end" would compute 30 April for Q4 and be
    -- confidently wrong four times a year.
    due_day               SMALLINT,
    due_month             SMALLINT,          -- annual obligations: the month of due_day
    due_month_offset      SMALLINT,          -- months after period end, when uniform

    -- A duration a rule turns on, in days — Rule 37's 180 is the seeded case.
    window_days           INTEGER,

    rate_percent          NUMERIC(6,3),
    threshold_amount      NUMERIC(14,2),

    -- NULL = all-India. A state row outranks the all-India row for the same key
    -- on the same date; services/statute.py owns that precedence.
    state_code            TEXT,

    effective_from        DATE        NOT NULL,
    effective_to          DATE,              -- EXCLUSIVE; NULL = still in force
    effective_from_exact  BOOLEAN     NOT NULL DEFAULT TRUE,

    source_ref            TEXT,
    notes                 TEXT,
    verified_on           DATE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT statute_calendar_periodicity_ck CHECK (
        periodicity IN ('monthly', 'quarterly', 'annual', 'event', 'standing')),
    CONSTRAINT statute_calendar_window_ck CHECK (
        effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT statute_calendar_due_day_ck CHECK (
        due_day IS NULL OR due_day BETWEEN 1 AND 31),
    CONSTRAINT statute_calendar_due_month_ck CHECK (
        due_month IS NULL OR due_month BETWEEN 1 AND 12),
    CONSTRAINT statute_calendar_state_ck CHECK (
        state_code IS NULL OR state_code ~ '^[A-Z]{2,3}$'),

    -- NULLS NOT DISTINCT (PG15+; this database is 17.6, measured 2026-08-19) so
    -- the all-India rows, whose state_code is NULL, actually collide with
    -- themselves on a re-run. Under default NULL semantics they would not, and
    -- the ON CONFLICT below would be a no-op that duplicated every all-India row
    -- on every apply.
    CONSTRAINT statute_calendar_version_uniq
        UNIQUE NULLS NOT DISTINCT (obligation_key, state_code, effective_from)
);

-- The lookup services/statute.py performs: every version of one key.
CREATE INDEX IF NOT EXISTS statute_calendar_key_idx
    ON staging.statute_calendar (obligation_key, effective_from);

-- Prefix listings ("everything under gst.").
CREATE INDEX IF NOT EXISTS statute_calendar_authority_idx
    ON staging.statute_calendar (authority, obligation_key);

-- AT MOST ONE OPEN-ENDED VERSION per key per state. This is the constraint that
-- catches the realistic mistake: seeding a new version and forgetting to close
-- the old one, which leaves two rows both claiming to be current and makes the
-- answer depend on row order. COALESCE rather than NULLS NOT DISTINCT because a
-- partial unique INDEX takes no NULLS NOT DISTINCT clause before it is written
-- as a constraint, and this needs the WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS statute_calendar_one_open_version_idx
    ON staging.statute_calendar (obligation_key, COALESCE(state_code, ''))
    WHERE effective_to IS NULL;

COMMENT ON TABLE staging.statute_calendar IS
  'Dated statutory facts — form numbers, section references, due days, rates and '
  'thresholds — each valid over the half-open window [effective_from, effective_to). '
  'Read through services/statute.py, which requires an as-of date. Never hardcode a '
  'form number or a due date in Python; the Income-tax Act 2025 renumbering is why.';

COMMENT ON COLUMN staging.statute_calendar.effective_to IS
  'EXCLUSIVE — the first day the fact is NOT true, never the last day it is.';
COMMENT ON COLUMN staging.statute_calendar.due_day IS
  'NULL means the schedule is not a day-of-month rule. Read notes; do not guess.';
COMMENT ON COLUMN staging.statute_calendar.effective_from_exact IS
  'FALSE where effective_from is a conservative floor, not a researched commencement.';
COMMENT ON COLUMN staging.statute_calendar.state_code IS
  'NULL = all-India. A state row outranks the all-India row for the same key and date.';

-- ── SEED ─────────────────────────────────────────────────────────────────────
-- Every fact below was verified on 2026-08-19. The column order is fixed and
-- tests/test_statute.py parses these rows out of this file, so that the test
-- proving 24Q becomes 138 on 1 April 2026 is testing THE SEED, not a fixture
-- somebody wrote to agree with the service.

INSERT INTO staging.statute_calendar (
    obligation_key, title, authority, statute, form_number, section_ref,
    periodicity, due_day, due_month, due_month_offset, window_days,
    rate_percent, threshold_amount, state_code,
    effective_from, effective_to, effective_from_exact,
    source_ref, notes, verified_on
) VALUES

-- ── TDS / TCS forms: the 1 April 2026 renumbering ───────────────────────────
('tds.certificate.salary','TDS certificate — salary','income_tax','Income-tax Act 1961','16','s.203','annual',15,6,NULL,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 31','Issued to the employee by 15 June following the financial year. Part A from TRACES, Part B from payroll — issued together, not separately.','2026-08-19'),
('tds.certificate.salary','TDS certificate — salary','income_tax','Income-tax Act 2025','130',NULL,'annual',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','Form 16 was renumbered 130. Section and due date are NULL because neither was verified for the 2025 Act — only the form number was. Do not assume 15 June carried across.','2026-08-19'),

('tds.certificate.nonsalary','TDS certificate — payments other than salary','income_tax','Income-tax Act 1961','16A','s.203','quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 31','Downloaded from TRACES after the quarterly statement is processed, so its date follows the statement rather than a day of the month.','2026-08-19'),
('tds.certificate.nonsalary','TDS certificate — payments other than salary','income_tax','Income-tax Act 2025','131',NULL,'quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','Form 16A was renumbered 131. The 2025 Act section is not recorded — it was not verified.','2026-08-19'),

('tds.statement.salary','TDS statement — salary','income_tax','Income-tax Act 1961','24Q','s.200(3)','quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 31A','Quarterly: 31 July, 31 October, 31 January, and 31 May for Q4. Not a uniform day-of-month rule, which is why due_day is NULL.','2026-08-19'),
('tds.statement.salary','TDS statement — salary','income_tax','Income-tax Act 2025','138',NULL,'quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','Form 24Q was renumbered 138. A statement filed as 24Q for a payment made on or after 1 April 2026 fails at TRACES.','2026-08-19'),

('tds.statement.nonsalary','TDS statement — resident payees other than salary','income_tax','Income-tax Act 1961','26Q','s.200(3)','quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 31A','Quarterly: 31 July, 31 October, 31 January, and 31 May for Q4.','2026-08-19'),
('tds.statement.nonsalary','TDS statement — resident payees other than salary','income_tax','Income-tax Act 2025','140',NULL,'quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','Form 26Q was renumbered 140.','2026-08-19'),

('tds.statement.nonresident','TDS statement — non-resident payees','income_tax','Income-tax Act 1961','27Q','s.200(3)','quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 31A','Quarterly: 31 July, 31 October, 31 January, and 31 May for Q4.','2026-08-19'),
('tds.statement.nonresident','TDS statement — non-resident payees','income_tax','Income-tax Act 2025','144',NULL,'quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','Form 27Q was renumbered 144.','2026-08-19'),

('tcs.statement','TCS statement','income_tax','Income-tax Act 1961','27EQ','s.206C(3)','quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 31AA','Collection, not deduction — a separate return from the 26Q family.','2026-08-19'),
('tcs.statement','TCS statement','income_tax','Income-tax Act 2025','143',NULL,'quarterly',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','Form 27EQ was renumbered 143.','2026-08-19'),

-- ── Sections that were renumbered with the forms ────────────────────────────
('tds.higher_rate_no_pan','Higher rate of deduction where the payee has no operative PAN','income_tax','Income-tax Act 1961',NULL,'s.206AA','standing',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2010-04-01','2026-04-01',TRUE,'Finance (No. 2) Act 2009','Cited by services/statutory_ids.py and services/doc_validation.py, both of which name s.206AA in prose with no date attached to it.','2026-08-19'),
('tds.higher_rate_no_pan','Higher rate of deduction where the payee has no operative PAN','income_tax','Income-tax Act 2025',NULL,'s.397(2)','standing',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','s.206AA was renumbered s.397(2). Any message that quotes 206AA for a post-1-April-2026 deduction cites a section that no longer exists.','2026-08-19'),

('msme.payment_disallowance','Disallowance of a deduction for a payment to a micro or small enterprise beyond the statutory window','income_tax','Income-tax Act 1961',NULL,'s.43B(h)','standing',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2023-04-01','2026-04-01',TRUE,'Finance Act 2023','The MSME payment window itself (45 days with an agreement, 15 without) is NOT seeded — it was not verified tonight, so window_days is NULL rather than a plausible number.','2026-08-19'),
('msme.payment_disallowance','Disallowance of a deduction for a payment to a micro or small enterprise beyond the statutory window','income_tax','Income-tax Act 2025',NULL,'s.37(2)(g)','standing',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-01',NULL,TRUE,'Income-tax Act 2025, in force 1 April 2026','s.43B(h) was renumbered s.37(2)(g). services/statement_pdf.py prints "section 43B(h)" onto a statement of account with no date behind it.','2026-08-19'),

-- ── GST returns ─────────────────────────────────────────────────────────────
('gst.return.gstr1','GSTR-1 — outward supplies','gst','CGST Act 2017','GSTR-1','s.37','monthly',11,NULL,1,NULL,NULL,NULL,NULL,'2021-01-01',NULL,FALSE,'CGST Rules 2017, rule 59','Due the 11th of the following month for a monthly filer. effective_from is a floor: the 11th has stood for some years but the notification date was not verified.','2026-08-19'),
('gst.return.gstr3b','GSTR-3B — summary return and payment','gst','CGST Act 2017','GSTR-3B','s.39','monthly',20,NULL,1,NULL,NULL,NULL,NULL,'2021-01-01',NULL,FALSE,'CGST Rules 2017, rule 61','Due the 20th of the following month for a MONTHLY filer. A QRMP filer is due the 22nd or the 24th by State group and NEITHER GROUP IS SEEDED — services/doc_validation.py already says the org profile records no filing scheme, so a QRMP filer is currently shown the monthly date.','2026-08-19'),

-- ── GST rate slabs: the 22 September 2025 rationalisation ───────────────────
('gst.rate.nil','GST rate — nil','gst','CGST Act 2017',NULL,NULL,'standing',NULL,NULL,NULL,NULL,0,NULL,NULL,'2017-07-01',NULL,TRUE,'GST commencement, 1 July 2017',NULL,'2026-08-19'),
('gst.rate.5','GST rate — 5%','gst','CGST Act 2017',NULL,NULL,'standing',NULL,NULL,NULL,NULL,5,NULL,NULL,'2017-07-01',NULL,TRUE,'GST commencement, 1 July 2017',NULL,'2026-08-19'),
('gst.rate.12','GST rate — 12%','gst','CGST Act 2017',NULL,NULL,'standing',NULL,NULL,NULL,NULL,12,NULL,NULL,'2017-07-01','2025-09-22',TRUE,'Rate rationalisation, 22 September 2025','ABOLISHED on 22 September 2025. frontend/src/pages/ganit/ProductsTab.jsx still offers 12 in its GST_RATES dropdown, so a product created today can carry a rate that no longer exists.','2026-08-19'),
('gst.rate.18','GST rate — 18%','gst','CGST Act 2017',NULL,NULL,'standing',NULL,NULL,NULL,NULL,18,NULL,NULL,'2017-07-01',NULL,TRUE,'GST commencement, 1 July 2017','The default assumed all over this codebase (routers/ganit.py, routers/documents.py, services/agreement_pdf.py) — correct today, and correct only because it is still a live slab.','2026-08-19'),
('gst.rate.28','GST rate — 28%','gst','CGST Act 2017',NULL,NULL,'standing',NULL,NULL,NULL,NULL,28,NULL,NULL,'2017-07-01','2025-09-22',TRUE,'Rate rationalisation, 22 September 2025','ABOLISHED on 22 September 2025, and still in the ProductsTab dropdown.','2026-08-19'),
('gst.rate.40','GST rate — 40%','gst','CGST Act 2017',NULL,NULL,'standing',NULL,NULL,NULL,NULL,40,NULL,NULL,'2025-09-22',NULL,TRUE,'Rate rationalisation, 22 September 2025','Introduced for sin goods when 12 and 28 were abolished. Offered nowhere in the product.','2026-08-19'),

-- ── Input tax credit ────────────────────────────────────────────────────────
('gst.itc.time_limit','Time limit to claim input tax credit for a financial year','gst','CGST Act 2017',NULL,'s.16(4)','annual',30,11,NULL,NULL,NULL,NULL,NULL,'2022-10-01',NULL,FALSE,'CGST Act 2017, s.16(4)','Barred after the EARLIER of 30 November following the financial year or the date the annual return is actually filed — so due_day/due_month are the OUTER limit only, and a caller that ignores the annual-return date will tell a firm it still has time when it does not.','2026-08-19'),
('gst.itc.reversal.unpaid_supplier','Reversal of input tax credit where the supplier is unpaid','gst','CGST Rules 2017',NULL,'rule 37','event',NULL,NULL,NULL,180,NULL,NULL,NULL,'2022-10-01',NULL,FALSE,'CGST Rules 2017, rule 37','ITC reverses where the supplier is unpaid 180 days from the INVOICE date. Reported in GSTR-3B Table 4B(2) and re-availed in 4A(5) on payment, with NO time limit on the re-availment — the 16(4) bar does not apply to it. services/gstr3b_pdf.py has those two rows but spells them 4(B)(2) and 4(A)(5), so grepping this note''s spelling finds nothing there; nothing computes the 180 days.','2026-08-19'),

-- ── Payroll remittances ─────────────────────────────────────────────────────
('epf.remittance','Provident fund contribution and ECR','epfo','EPF & MP Act 1952','ECR',NULL,'monthly',15,NULL,1,NULL,NULL,NULL,NULL,'2017-06-01',NULL,FALSE,'EPF Scheme 1952','Due the 15th of the following month. effective_from is a floor — the day is verified, the date it became the 15th is not.','2026-08-19'),
('esi.remittance','Employees State Insurance contribution','esic','ESI Act 1948',NULL,NULL,'monthly',15,NULL,1,NULL,NULL,NULL,NULL,'2017-06-01',NULL,FALSE,'ESI (General) Regulations 1950','Due the 15th of the following month. effective_from is a floor.','2026-08-19')

ON CONFLICT ON CONSTRAINT statute_calendar_version_uniq DO NOTHING;

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.statute_calendar;   -- takes its three indexes with it
