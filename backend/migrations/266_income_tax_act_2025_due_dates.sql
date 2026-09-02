-- 266 - The Income-tax Act 2025 rows that carry a DATE
--
-- -- What is wrong ----------------------------------------------------------
--
-- `public.statute_calendar` end-dated every Income-tax Act 1961 row at the
-- repeal on 2026-04-01. Somebody then seeded the 2025-Act SUCCESSORS for the
-- forms and got them right - 138 (was 24Q), 140 (was 26Q), 143 (was 27EQ),
-- 144 (was 27Q), 130 (was 16), 131 (was 16A) - but left `due_day`,
-- `due_month` and `section_ref` NULL on all of them, and did not create a
-- successor for `tds.deposit.monthly` or for the four advance-tax rows at all.
--
-- The consequence, measured 2026-09-02 by running the filing calendar for a
-- real client: FOUR filings, ZERO dates. The skill was right and said so twice,
-- in two different ways —
--
--   "The statute calendar carries tds.statement.nonsalary but no due day for it
--    as of 2026-06-30, so no date is shown. The FORM is named so a preparer can
--    see the filing exists."
--
--   "The statute calendar carries NO VERSION of tds.deposit.monthly in force on
--    2026-09-30, so no date and no form are shown. This is a gap in the
--    calendar, not a filing that does not exist."
--
-- -- WHAT THIS FILE DELIBERATELY DOES NOT DO ---------------------------------
--
-- IT DOES NOT GIVE THE QUARTERLY TDS/TCS STATEMENTS A DUE DAY, and that is the
-- most important line in this file.
--
-- The statutory dates are Q1 31 July, Q2 31 October, Q3 31 January and
-- Q4 31 MAY. The first three are one month after the quarter end; the fourth is
-- TWO. `_due_date_from` in `services/skills/data/client_register.py` applies a
-- SINGLE `due_month_offset` to the period end, so one row cannot express both:
--
--     due_day 31, due_month_offset 1  ->  Q4 resolves to 30 April.
--
-- The law says 31 May. A statutory date that is a month early, printed beside a
-- section citation on a compliance screen, is worse than the blank the skill
-- currently prints and explains. The `due_month` branch cannot rescue it either
-- - it takes an absolute month, so all four quarters would collapse onto one -
-- and the `instalment` pattern that advance tax uses works only because all
-- four of ITS dates fall INSIDE the year they belong to, which Q4's 31 May does
-- not.
--
-- Fixing it properly is a schema and resolver change (a per-quarter key, or a
-- `due_year_offset` column), not a row. It is written up in
-- `docs/plans/PROGRESS.md` under this date. Until then those six rows keep
-- naming their form and refusing to name a day, which is the behaviour the
-- shelf is built on.
--
-- -- Sources ----------------------------------------------------------------
--
-- Every value below was researched on 2026-09-02, not recalled. Two independent
-- sources agree on the forms and the dates, and both agree with the form
-- numbers already in this table, which were seeded by somebody else in August:
--
--   caclubindia, "TDS Returns under the Income-tax Act 2025: forms, due dates
--     and filing procedure" - forms 138/140/143/144, s.397(3)(b) read with
--     Rule 219 of the Income-tax Rules 2026, deposit under Rule 218, deposit
--     due the 7th of the following month for non-government deductors.
--   caclubindia, "TDS return due date FY 2026-27, updated as per IT Act 2025"
--     - the same forms and the same quarterly dates.
--   india-briefing / cleartax, advance tax FY 2026-27 - 15 June, 15 September,
--     15 December, 15 March, under ss.403-410 of the Income-tax Act 2025.
--
-- `verified_on` is set to 2026-09-02 for every row this file writes, which is
-- what that column is for: it dates the CHECK, not the law.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. This is production, and these rows are printed next to
--   statute citations for chartered accountants.
--
-- * IT CHANGES WHAT THE FILING CALENDAR PRINTS. `incometax.tds` currently
--   produces two undated filings per client; after this the monthly deposit
--   carries a date and the quarterly statement still does not.
--
-- * ⚠ THE MARCH EXCEPTION IS NOT EXPRESSED, and it is inherited rather than
--   introduced. TDS deducted in March is payable by 30 APRIL for non-government
--   deductors, not by 7 April. `due_day 7, due_month_offset 1` is right for
--   eleven months of twelve and a month early for March - exactly the shape the
--   1961 row this replaces already had, unchanged since it was seeded. It is
--   recorded here rather than fixed because fixing it needs the same
--   per-period capability the quarterly statements need, and inventing a second
--   row with no way to select it would be worse.
--
-- * NO SECTION IS ASSERTED WHERE ONE IS NOT SOURCED. The deposit row's
--   `section_ref` stays NULL and cites Rule 218 in `source_ref`; the two
--   certificate rows (130, 131) are not touched at all, because no source here
--   gives their section. A NULL section prints nothing; a guessed one prints a
--   citation a CA would rely on.
--
-- * IDEMPOTENT. The UPDATEs are assignments; the INSERTs are guarded by
--   NOT EXISTS on (obligation_key, statute).
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT obligation_key, form_number, section_ref, due_day, due_month,
--          due_month_offset, source_ref, verified_on
--     FROM public.statute_calendar
--    WHERE authority='income_tax' AND statute='Income-tax Act 2025'
--    ORDER BY obligation_key;
--
-- Then re-run the filing calendar for an org with an `incometax.tds` obligation
-- and expect the monthly deposit to carry a date and the quarterly statement to
-- carry a form and an explanation.
--
-- -- Rollback ---------------------------------------------------------------
--
-- DELETE FROM public.statute_calendar
--  WHERE statute='Income-tax Act 2025' AND verified_on='2026-09-02'
--    AND obligation_key IN ('tds.deposit.monthly','incometax.advance_tax.q1',
--        'incometax.advance_tax.q2','incometax.advance_tax.q3',
--        'incometax.advance_tax.q4');
-- UPDATE public.statute_calendar SET section_ref = NULL
--  WHERE statute='Income-tax Act 2025' AND section_ref='s.397(3)(b)';

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 1 - The monthly TDS deposit, which had no 2025 successor at all ---------
--
-- Shape copied from the 1961 row it replaces: day 7, one month after the
-- period. See the March caveat above.

INSERT INTO public.statute_calendar
  (obligation_key, title, authority, statute, form_number, section_ref,
   periodicity, due_day, due_month, due_month_offset,
   effective_from, effective_to, source_ref, verified_on)
SELECT 'tds.deposit.monthly',
       'Deposit of tax deducted at source',
       'income_tax',
       'Income-tax Act 2025',
       NULL,
       NULL,
       'monthly', 7, NULL, 1,
       DATE '2026-04-01', NULL,
       'Income-tax Rules 2026, rule 218 — 7th of the month following deduction '
       'for non-government deductors. Researched 2026-09-02.',
       DATE '2026-09-02'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.statute_calendar
    WHERE obligation_key = 'tds.deposit.monthly'
      AND statute = 'Income-tax Act 2025');


-- -- 2 - The four advance-tax instalments, which had no 2025 successor -------
--
-- `periodicity` and the absolute `due_month` are copied from the 1961 rows so
-- the `instalment` cadence in client_register resolves them identically. All
-- four dates are unchanged by the 2025 Act; only the section moved.

INSERT INTO public.statute_calendar
  (obligation_key, title, authority, statute, form_number, section_ref,
   periodicity, due_day, due_month, due_month_offset,
   effective_from, effective_to, source_ref, verified_on)
SELECT v.key, v.title, 'income_tax', 'Income-tax Act 2025', NULL, 'ss.403-410',
       'annual', 15, v.due_month, NULL,
       DATE '2026-04-01', NULL,
       'Income-tax Act 2025, ss.403-410 — instalments unchanged at 15 June, '
       '15 September, 15 December and 15 March. Researched 2026-09-02.',
       DATE '2026-09-02'
  FROM (VALUES
    ('incometax.advance_tax.q1', 'Advance tax — first instalment',  6),
    ('incometax.advance_tax.q2', 'Advance tax — second instalment', 9),
    ('incometax.advance_tax.q3', 'Advance tax — third instalment', 12),
    ('incometax.advance_tax.q4', 'Advance tax — fourth instalment', 3)
  ) AS v(key, title, due_month)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.statute_calendar s
    WHERE s.obligation_key = v.key AND s.statute = 'Income-tax Act 2025');


-- -- 3 - The section the statements are filed under -------------------------
--
-- These rows already carry the right FORM and nothing else. The section is
-- added because it is sourced; the due day is not, because it cannot be
-- expressed correctly (see the header).
--
-- The two certificate rows (130, 131) are deliberately NOT touched: no source
-- consulted here gives their section, and a guessed citation is worse than none.

UPDATE public.statute_calendar
   SET section_ref = 's.397(3)(b)',
       source_ref  = 'Income-tax Act 2025, s.397(3)(b) read with Income-tax '
                     'Rules 2026, rule 219. Researched 2026-09-02. DUE DAY '
                     'DELIBERATELY NOT SET — Q4 falls two months after the '
                     'quarter end (31 May) and the resolver applies one '
                     'due_month_offset to all four quarters.',
       verified_on = DATE '2026-09-02'
 WHERE statute = 'Income-tax Act 2025'
   AND obligation_key IN ('tds.statement.salary', 'tds.statement.nonsalary',
                          'tds.statement.nonresident', 'tcs.statement');


-- -- 4 - What must still be true afterwards ---------------------------------

DO $$
DECLARE
  dated       int;
  bad_quarter int;
BEGIN
  -- The five rows this file gives a date to, and no more.
  SELECT count(*) INTO dated
    FROM public.statute_calendar
   WHERE statute = 'Income-tax Act 2025' AND due_day IS NOT NULL;
  IF dated <> 5 THEN
    RAISE EXCEPTION
      'Expected 5 dated Income-tax Act 2025 rows (1 deposit + 4 advance tax), '
      'found %.', dated;
  END IF;

  -- THE GUARD THAT MATTERS. A quarterly statement with a due day would be
  -- resolved with one offset for all four quarters, and Q4 would print 30 April
  -- against a law that says 31 May.
  SELECT count(*) INTO bad_quarter
    FROM public.statute_calendar
   WHERE statute = 'Income-tax Act 2025'
     AND periodicity = 'quarterly'
     AND due_day IS NOT NULL;
  IF bad_quarter > 0 THEN
    RAISE EXCEPTION
      '% quarterly Income-tax Act 2025 row(s) carry a due day. One '
      'due_month_offset cannot express Q1-Q3 at +1 month and Q4 at +2, so such '
      'a row prints 30 April for a filing the law puts on 31 May. Fix the '
      'resolver first.', bad_quarter;
  END IF;

  RAISE NOTICE 'Income-tax Act 2025: % dated row(s); quarterly statements '
               'correctly left undated.', dated;
END $$;

COMMIT;
