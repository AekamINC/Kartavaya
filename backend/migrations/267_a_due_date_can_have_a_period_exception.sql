-- 267 - A due date can have a period exception
--
-- -- What is wrong ----------------------------------------------------------
--
-- 266 seeded the Income-tax Act 2025 rows it could and refused the quarterly
-- TDS/TCS statements, because the calendar could not express them:
--
--     Q1 ends 30 Jun -> 31 Jul   +1 month
--     Q2 ends 30 Sep -> 31 Oct   +1 month
--     Q3 ends 31 Dec -> 31 Jan   +1 month
--     Q4 ends 31 Mar -> 31 MAY   +2 months
--
-- `due_month_offset` is ONE number applied to every period, so `due_day 31,
-- offset 1` resolves Q4 to 30 April against a law that says 31 May. 266 left
-- those rows undated and added a guard so nobody seeded the wrong date later.
--
-- The same shape defeats the monthly TDS deposit: it is the 7th of the
-- following month for eleven months and 30 APRIL for March, so the row has been
-- a month early for March deductions since it was first seeded under the 1961
-- Act. That is inherited, not introduced, and it is fixed here too.
--
-- -- The mechanism ----------------------------------------------------------
--
-- One nullable jsonb column, `due_overrides`, keyed by the PERIOD-END MONTH,
-- carrying whatever differs for a period ending in that month:
--
--     {"3": {"month_offset": 2}}          the Q4 statement is two months out
--     {"3": {"day": 30}}                  March TDS is deposited by 30 April
--
-- Keyed on the period end rather than on a quarter number because that is what
-- the resolver already has in its hand, and because it then works for any
-- periodicity — a monthly rule and a quarterly rule use the same column and the
-- same code. A `due_year_offset` column would have fixed neither case: nothing
-- here crosses a year boundary that the existing arithmetic does not already
-- handle.
--
-- The alternative considered and rejected was four per-quarter keys, the way
-- `incometax.advance_tax.q1..q4` is modelled. That works for advance tax only
-- because all four of ITS dates fall inside the year they belong to; the TDS Q4
-- date falls in the next one, and it would also have meant a code change in
-- `_FILINGS` plus four rows per statement type instead of one column.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. This is production, and these rows are printed next to
--   statute citations for chartered accountants.
--
-- * IT CHANGES PRINTED DATES. Four statement rows go from "no date, form
--   named" to a date, and the March TDS deposit moves from 7 April to 30 April.
--   Both are corrections; neither is silent — the runs are recorded.
--
-- * INERT WITHOUT THE CODE. `due_overrides` is read by
--   `services/statute.due_date_from`, which lands in the same commit. Applied
--   alone, the column is ignored and every date stays exactly as it is now.
--
-- * ADD COLUMN, nullable, no default: a catalog update with no table rewrite on
--   PG 11+. 61 rows regardless.
--
-- * NO INLINE CHECK. `ADD COLUMN IF NOT EXISTS ... CHECK` is skipped entirely
--   when the column already exists — 059's scar. The shape is validated in the
--   resolver and by section 3 below, not by a constraint that might not be there.
--
-- * THE 1961 ROWS ARE NOT TOUCHED. Their quarterly statements carry no due day
--   and still will: this file researched the 2025 Act, not the 1961 one, and a
--   date backfilled into a repealed statute from an unresearched source is
--   exactly what 266 refused to do. A period ending before 1 April 2026
--   therefore remains undated, and says so.
--
-- * SUPERSEDES 266's GUARD, which refused any quarterly 2025 row carrying a due
--   day. That guard was right when one offset had to serve four quarters. It
--   ran once at apply time and constrains nothing now; section 3 replaces it
--   with the rule that actually matters — a quarterly row may carry a day ONLY
--   if it also carries the Q4 exception.
--
-- -- Sources ----------------------------------------------------------------
--
-- Researched 2026-09-02, same two sources as 266, which agree with each other
-- and with the form numbers already in this table:
--   caclubindia, "TDS Returns under the Income-tax Act 2025" — Q1 31 July,
--     Q2 31 October, Q3 31 January, Q4 31 May; s.397(3)(b) with Rule 219.
--   caclubindia, "TDS return due date FY 2026-27" — the same four dates.
--   Deposit: Rule 218, 7th of the following month, March by 30 April.
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT obligation_key, due_day, due_month_offset, due_overrides
--     FROM public.statute_calendar
--    WHERE statute='Income-tax Act 2025' AND due_overrides IS NOT NULL;
--
-- Then, with the code in place, a Q4 statement must resolve to 31 May and a
-- March deposit to 30 April. `tests/test_due_date_exceptions.py` asserts both.
--
-- -- Rollback ---------------------------------------------------------------
--
-- UPDATE public.statute_calendar
--    SET due_day = NULL, due_month_offset = NULL, due_overrides = NULL
--  WHERE statute='Income-tax Act 2025' AND periodicity='quarterly';
-- UPDATE public.statute_calendar SET due_overrides = NULL
--  WHERE obligation_key='tds.deposit.monthly' AND statute='Income-tax Act 2025';
-- ALTER TABLE public.statute_calendar DROP COLUMN IF EXISTS due_overrides;

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 1 - The column ---------------------------------------------------------

ALTER TABLE public.statute_calendar
  ADD COLUMN IF NOT EXISTS due_overrides jsonb DEFAULT NULL;

COMMENT ON COLUMN public.statute_calendar.due_overrides IS
  'Period-specific exceptions to the due date, keyed by the PERIOD-END MONTH as a string. Each value may carry "day", "month_offset" or "month", and replaces the row''s own value for a period ending in that month. Example: {"3": {"month_offset": 2}} — a quarter ending in March is due two months later, not one. Read by services/statute.due_date_from.';


-- -- 2 - The four quarterly statements, now expressible ---------------------
--
-- One month after the quarter end for Q1-Q3; two for Q4, which is the whole
-- reason this column exists.

UPDATE public.statute_calendar
   SET due_day          = 31,
       due_month_offset = 1,
       due_overrides    = '{"3": {"month_offset": 2}}'::jsonb,
       source_ref       = 'Income-tax Act 2025, s.397(3)(b) read with Income-tax '
                          'Rules 2026, rule 219 — Q1 31 July, Q2 31 October, '
                          'Q3 31 January, Q4 31 May. Researched 2026-09-02.',
       verified_on      = DATE '2026-09-02'
 WHERE statute = 'Income-tax Act 2025'
   AND periodicity = 'quarterly'
   AND obligation_key IN ('tds.statement.salary', 'tds.statement.nonsalary',
                          'tds.statement.nonresident', 'tcs.statement');


-- -- 3 - The March deposit exception, inherited and now expressed -----------
--
-- The day changes, not the offset: March's deduction is still deposited in
-- April, on the 30th rather than the 7th.

UPDATE public.statute_calendar
   SET due_overrides = '{"3": {"day": 30}}'::jsonb,
       source_ref    = 'Income-tax Rules 2026, rule 218 — 7th of the month '
                       'following deduction for non-government deductors, and '
                       '30 April for March. Researched 2026-09-02.',
       verified_on   = DATE '2026-09-02'
 WHERE obligation_key = 'tds.deposit.monthly'
   AND statute = 'Income-tax Act 2025';


-- -- 4 - What must be true afterwards ---------------------------------------

DO $$
DECLARE
  bad_quarter int;
  overridden  int;
BEGIN
  -- 266's guard, replaced by the rule that actually matters. A quarterly row
  -- may carry a due day ONLY if it also carries the Q4 exception; without it
  -- one offset serves four quarters again and Q4 prints 30 April.
  SELECT count(*) INTO bad_quarter
    FROM public.statute_calendar
   WHERE periodicity = 'quarterly'
     AND due_day IS NOT NULL
     AND NOT (due_overrides ? '3');
  IF bad_quarter > 0 THEN
    RAISE EXCEPTION
      '% quarterly row(s) carry a due day with no period-end-March exception. '
      'One due_month_offset would serve all four quarters and Q4 would print a '
      'month early. Add {"3": {"month_offset": 2}} or leave the day NULL.',
      bad_quarter;
  END IF;

  SELECT count(*) INTO overridden
    FROM public.statute_calendar WHERE due_overrides IS NOT NULL;
  IF overridden <> 5 THEN
    RAISE EXCEPTION
      'Expected 5 rows carrying a due_overrides (4 statements + the monthly '
      'deposit), found %.', overridden;
  END IF;

  RAISE NOTICE 'due_overrides set on % row(s); no quarterly row is dated '
               'without its Q4 exception.', overridden;
END $$;

COMMIT;
