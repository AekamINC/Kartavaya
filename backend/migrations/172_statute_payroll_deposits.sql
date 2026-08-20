-- 172_statute_payroll_deposits.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.statute_calendar   +4 rows. Reference data only, org-independent.
--
-- No schema change, no tenant data, no template, nothing armed. Re-running
-- inserts nothing.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue #23-#27 are the payroll-statutory five, and three facts they need
-- are missing from the calendar. `services/skills/data/people_checks.py` already
-- records the first gap in its own header, in as many words:
--
--     "There is NO key for the monthly TDS deposit (the challan, ordinarily due
--      on the 7th). `tds.statement.salary` is the QUARTERLY STATEMENT and its
--      `due_day` is NULL. So the TDS line below names its form and section and
--      says the catalogue records no due date — it does not print the 7th from
--      memory. Hardcoding a due day here is precisely the defect
--      services/statute.py exists to remove."
--
-- This is that key. `brief_statutory_dues` starts answering the question the
-- moment it lands, with no code change, because it already asks the calendar.
--
-- ── THE ESI CEILING, AND WHY IT IS THREE ROWS AND NOT ONE ────────────────────
--
-- Catalogue #26 is "employees whose gross crossed ₹21,000 mid-period and must
-- keep contributing to the half-year end". That is TWO statutory facts:
--
--   the ceiling      ₹21,000 of monthly wages
--   the periods      1 April–30 September and 1 October–31 March
--
-- and the rule that matters is the join between them — crossing the ceiling
-- inside a period does NOT stop the contribution, it continues to the end of
-- that period. A single row cannot carry two period ends, so the two periods
-- are their own rows and the handler reads all three. Storing "Apr-Sep" as a
-- string in a note would put a statutory boundary somewhere no code can read.
--
-- ── THE DISCIPLINE, AS EVER ──────────────────────────────────────────────────
--
-- Every row cites a provision and carries `verified_on`. What was NOT verified
-- is NULL, not guessed. Specifically: no Income-tax Act 2025 successor row for
-- the TDS deposit, exactly as 158 and 170 handle the rest of the renumbering —
-- the deposit provision was renumbered on 1 April 2026 and the new number was
-- not verified, so the 1961 row ends there and nothing follows it. A handler
-- asking as of a later date is told the catalogue records no rule, which is
-- correct and is far better than a wrong section in front of a CA.
--
-- ⚠ OWNER: statutory assertions, inert until a skill reading them is armed, and
-- nothing is armed. Read the `notes` column before arming anything that prints
-- one.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- One INSERT of 4 rows into a 41-row reference table. ROW EXCLUSIVE, no ALTER.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.statute_calendar
--    WHERE obligation_key IN ('tds.deposit.monthly','esi.wage_ceiling',
--          'esi.contribution_period.first','esi.contribution_period.second');

BEGIN;

INSERT INTO staging.statute_calendar (
    obligation_key, title, authority, statute, form_number, section_ref,
    periodicity, due_day, due_month, due_month_offset, window_days,
    rate_percent, threshold_amount, state_code,
    effective_from, effective_to, effective_from_exact,
    source_ref, notes, verified_on
) VALUES

-- ── the monthly TDS deposit ─────────────────────────────────────────────────
-- The gap people_checks.py names in its own header. due_day 7, offset 1: tax
-- deducted in August is deposited by 7 September.
('tds.deposit.monthly','Deposit of tax deducted at source','income_tax','Income-tax Act 1961',NULL,'s.200(1)','monthly',7,NULL,1,NULL,NULL,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Rules 1962, rule 30','Tax deducted in a month is deposited by the 7th of the following month. THE MARCH DEDUCTION IS THE EXCEPTION — it is due 30 April, not 7 April — and this row CANNOT express that, because one due_day cannot hold two rules. A skill reading this MUST special-case a March wage month and say so; do not let the 7th print for March. No Income-tax Act 2025 successor row: the provision was renumbered on 1 April 2026 and the new number was not verified.','2026-08-20'),

-- ── the ESI wage ceiling and the two contribution periods ───────────────────
('esi.wage_ceiling','Wage ceiling for coverage under the ESI Act','esic','Employees State Insurance Act 1948',NULL,NULL,'standing',NULL,NULL,NULL,NULL,NULL,21000,NULL,'2017-01-01',NULL,TRUE,'Employees State Insurance (Central) Rules 1950, rule 50','₹21,000 of monthly wages. THE CEILING ALONE IS NOT THE RULE: an employee whose wages rise above it PART WAY THROUGH a contribution period continues to contribute until the END of that period — see the two contribution-period rows, which exist so that boundary is readable by code rather than buried in this sentence. The ceiling is higher for an employee with a disability and that variation is NOT carried here.','2026-08-20'),
('esi.contribution_period.first','ESI contribution period — April to September','esic','Employees State Insurance Act 1948',NULL,NULL,'standing',30,9,NULL,NULL,NULL,NULL,NULL,'1950-01-01',NULL,FALSE,'Employees State Insurance (Central) Rules 1950, rule 2(5)(a)','1 April to 30 September. due_day/due_month are the LAST DAY OF THE PERIOD, not a filing date — nothing is due on 30 September because of this row. It exists so a skill can answer "when does the obligation to keep contributing end".','2026-08-20'),
('esi.contribution_period.second','ESI contribution period — October to March','esic','Employees State Insurance Act 1948',NULL,NULL,'standing',31,3,NULL,NULL,NULL,NULL,NULL,'1950-01-01',NULL,FALSE,'Employees State Insurance (Central) Rules 1950, rule 2(5)(a)','1 October to 31 March. See the first-period row: due_day/due_month are the last day of the period and not a filing date.','2026-08-20')

ON CONFLICT ON CONSTRAINT statute_calendar_version_uniq DO NOTHING;

DO $verify$
DECLARE n int; missing text;
BEGIN
    SELECT count(*) INTO n FROM staging.statute_calendar;
    IF n <> 45 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 45 statute rows (41 + 4), found %.', n;
    END IF;

    SELECT string_agg(k, ', ') INTO missing FROM (
        SELECT unnest(ARRAY['tds.deposit.monthly','esi.wage_ceiling',
               'esi.contribution_period.first','esi.contribution_period.second']) AS k
        EXCEPT SELECT obligation_key FROM staging.statute_calendar
    ) q;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: keys did not land: %', missing;
    END IF;

    IF EXISTS (
        SELECT 1 FROM staging.statute_calendar
         WHERE verified_on = '2026-08-20'
           AND (source_ref IS NULL OR btrim(source_ref) = ''
                OR notes IS NULL OR btrim(notes) = '')
    ) THEN
        RAISE EXCEPTION 'VERIFY 3: a row seeded today carries no source_ref or note.';
    END IF;

    RAISE NOTICE '172 · statute calendar is % rows. The monthly TDS deposit key '
                 'people_checks.py asked for now exists.', n;
END
$verify$;

COMMIT;
