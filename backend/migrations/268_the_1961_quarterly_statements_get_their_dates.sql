-- 268 - The Income-tax Act 1961 quarterly statements get their dates
--
-- -- What is wrong ----------------------------------------------------------
--
-- 267 dated the quarterly statements under the Income-tax Act 2025 and left the
-- 1961-Act rows alone, saying so in its header: "this file researched the 2025
-- Act, not the repealed one, and a date backfilled into a repealed statute from
-- an unresearched source is exactly what 266 refused to do."
--
-- That research is now done, and the consequence of NOT doing it was a live gap
-- with a current example: the Q4 statement for FY 2025-26 covers the quarter
-- ended 31 March 2026, which is BEFORE the repeal, so it resolves against a
-- 1961-Act row and came back undated. It was due 31 May 2026. A firm catching up
-- on it today is exactly who the register was built for.
--
-- -- TCS IS NOT TDS, AND THIS IS THE LINE THAT MATTERS ----------------------
--
-- Under the 1961 Act the two statements are on DIFFERENT DAYS:
--
--     TDS  24Q / 26Q / 27Q   rule 31A    31 Jul · 31 Oct · 31 Jan · 31 MAY
--     TCS  27EQ              rule 31AA   15 Jul · 15 Oct · 15 Jan · 15 MAY
--
-- The first search run for this file returned a summary asserting the 31st dates
-- "apply to Form 24Q, 26Q, 27Q, and 27EQ equally". That is wrong, and seeding it
-- would have put every TCS statement sixteen days late beside a rule citation.
-- Rule 31AA was checked separately and three sources agree on the 15th.
--
-- The structural reason they differ: CBDT Notification 30/2016 moved the TDS
-- dates to the 31st and amended rules 30, 31A and 37CA — it did NOT touch rule
-- 31AA. TCS was never pulled onto the TDS calendar until the 2025 Act did it
-- (Form 143 is on the 31st, which is why the 2025-Act row 267 seeded is).
--
-- A fourth candidate turned up and was discarded: "30 April" for TCS Q4. It
-- traces to rule 37CA, the DEPOSIT where the collection relates to March — a
-- different obligation, conflated by a summariser.
--
-- -- WHY THIS SPLITS EACH ROW IN TWO RATHER THAN UPDATING IT -----------------
--
-- The existing rows run from 1962-04-01, and that date is a placeholder: they
-- already carry `effective_from_exact = FALSE`, which 158 defines as "a
-- conservative floor, not a researched commencement", precisely so nothing
-- prints "in force since 1 April 1962".
--
-- Writing a due day onto those rows would assert the 31st applied in 1962. It
-- did not — the quarterly e-statement regime did not exist, and immediately
-- before June 2016 the dates differed BY DEDUCTOR TYPE (government vs not),
-- which one row cannot express either. A quarter ending in 2010 would then have
-- resolved to a plausible, wrong, cited date. That is the failure mode 266 and
-- 267 both refused.
--
-- So each key becomes two versions, which is what `effective_from` /
-- `effective_to` are FOR:
--
--   1962-04-01 → 2016-06-01   undated. The window this file did not research.
--   2016-06-01 → 2026-04-01   dated. Notification 30/2016, in force 1 June 2016.
--
-- Cross-check on the boundary: the source's own headline example is "last date
-- for filing TDS returns for Q1 FY 2016-17 — 31st July". Q1 FY 2016-17 ends
-- 30 June 2016, falls in the new window, and resolves to 31 July 2016.
--
-- ⚠ For TCS the 2016-06-01 boundary is a FLOOR, NOT A COMMENCEMENT — rule 31AA
-- was not amended then, so its 15th dates were already in force before that
-- date and this file did not research how far back. The row therefore carries
-- `effective_from_exact = FALSE` and the TDS rows carry TRUE. Understating a
-- window's start never prints a wrong date; it prints no date for older
-- periods, which is the honest answer.
--
-- -- RISKS AND SIDE EFFECTS -------------------------------------------------
--
-- * ONE DATABASE. Production, printed next to statute citations for CAs.
--
-- * IT CHANGES PRINTED DATES for any period ending between 1 June 2016 and the
--   repeal: four filings per client per quarter go from "form named, no date"
--   to dated. Nothing that already carried a date changes.
--
-- * NO ROW LOSES COVERAGE. The old rows are shortened, not deleted, and the new
--   ones start exactly where they stop — `[from, to)` is half-open, so
--   2016-06-01 is covered once and only once.
--
-- * INSERT, not UPDATE, so `statute_calendar_version_uniq`
--   (obligation_key, state_code, effective_from) is what makes this idempotent.
--   `statute_calendar_one_open_version_idx` is not engaged: every row here is
--   closed-ended.
--
-- * THE RESOLVER ALREADY HANDLES THIS. `due_overrides` shipped in 267 and
--   `services.statute.due_date_from` is live. No code change here.
--
-- -- Sources (researched 2026-09-03) -----------------------------------------
--
-- TDS, post-01-06-2016 — two independent sources giving the identical table:
--   abcaus, "TDS TCS rules major amendments — CBDT Notification 30/2016",
--     quoting the substituted rule 31A(2) table: quarter ending 30 June → 31
--     July, 30 September → 31 October, 31 December → 31 January, 31 March → 31
--     May of the following financial year; "shall come into force from the 1st
--     day of June, 2016".
--   tdsman, "New dates for filing TDS returns w.e.f. 1st June 2016" — the same
--     four dates, unified for government and non-government deductors, and the
--     note that the dates differed by deductor type before.
--
-- TCS, rule 31AA / Form 27EQ — 15 July, 15 October, 15 January, 15 May:
--   quicko, "Form 27EQ: TCS return" — the four dates in a table, Q4 15 May.
--   kanakkupillai, "Form 27EQ TCS return filing: due dates" — the same.
--   incometaxindia.gov.in rule 31AA (returned 403 to automated fetch; the two
--     above were used instead, and both cite rule 31AA by name).
--
-- -- Verify -----------------------------------------------------------------
--
--   SELECT obligation_key, form_number, due_day, due_month_offset,
--          due_overrides, effective_from, effective_to, effective_from_exact
--     FROM public.statute_calendar
--    WHERE statute = 'Income-tax Act 1961'
--      AND obligation_key LIKE '%statement%'
--    ORDER BY obligation_key, effective_from;
--
-- Then, through `services.statute.due_date_from`:
--   quarter ended 2025-12-31, tds.statement.nonsalary  -> 2026-01-31
--   quarter ended 2026-03-31, tds.statement.nonsalary  -> 2026-05-31
--   quarter ended 2026-03-31, tcs.statement            -> 2026-05-15
--   quarter ended 2015-12-31, any of them              -> no date, and says so
-- `tests/test_1961_quarterly_statements.py` asserts all four.
--
-- -- Rollback ---------------------------------------------------------------
--
-- DELETE FROM public.statute_calendar
--  WHERE statute='Income-tax Act 1961' AND effective_from = DATE '2016-06-01';
-- UPDATE public.statute_calendar SET effective_to = DATE '2026-04-01'
--  WHERE statute='Income-tax Act 1961' AND effective_from = DATE '1962-04-01'
--    AND obligation_key IN ('tds.statement.salary','tds.statement.nonsalary',
--                           'tds.statement.nonresident','tcs.statement');

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';


-- -- 1 - The new dated versions ---------------------------------------------
--
-- Inserted BEFORE the old rows are shortened, so that if anything in this file
-- fails the transaction rolls back with coverage never having had a hole.
--
-- `due_day` differs between the two rules and that is the whole point of the
-- VALUES list: 31 for TDS under rule 31A, 15 for TCS under rule 31AA.

INSERT INTO public.statute_calendar
  (obligation_key, title, authority, statute, form_number, section_ref,
   periodicity, due_day, due_month, due_month_offset, due_overrides,
   effective_from, effective_to, effective_from_exact, source_ref, verified_on)
SELECT v.key, v.title, 'income_tax', 'Income-tax Act 1961', v.form, v.section,
       'quarterly', v.due_day, NULL, 1,
       '{"3": {"month_offset": 2}}'::jsonb,
       DATE '2016-06-01', DATE '2026-04-01', v.exact,
       v.src, DATE '2026-09-03'
  FROM (VALUES
    ('tds.statement.salary', 'TDS statement — salary', '24Q', 's.200(3)', 31, TRUE,
     'Income-tax Rules 1962, rule 31A(2) as substituted by CBDT Notification '
     '30/2016 dated 29-04-2016, in force 1 June 2016 — Q1 31 July, Q2 31 '
     'October, Q3 31 January, Q4 31 May. Researched 2026-09-03.'),
    ('tds.statement.nonsalary', 'TDS statement — resident payees other than salary',
     '26Q', 's.200(3)', 31, TRUE,
     'Income-tax Rules 1962, rule 31A(2) as substituted by CBDT Notification '
     '30/2016 dated 29-04-2016, in force 1 June 2016 — Q1 31 July, Q2 31 '
     'October, Q3 31 January, Q4 31 May. Researched 2026-09-03.'),
    ('tds.statement.nonresident', 'TDS statement — non-resident payees',
     '27Q', 's.200(3)', 31, TRUE,
     'Income-tax Rules 1962, rule 31A(2) as substituted by CBDT Notification '
     '30/2016 dated 29-04-2016, in force 1 June 2016 — Q1 31 July, Q2 31 '
     'October, Q3 31 January, Q4 31 May. Researched 2026-09-03.'),
    -- ⚠ FIFTEENTH, NOT THIRTY-FIRST, and effective_from is a floor: rule 31AA
    -- was NOT amended by Notification 30/2016, so these dates were already in
    -- force before 1 June 2016 and this file did not research how far back.
    ('tcs.statement', 'TCS statement', '27EQ', 's.206C(3)', 15, FALSE,
     'Income-tax Rules 1962, rule 31AA — Q1 15 July, Q2 15 October, Q3 15 '
     'January, Q4 15 May. Researched 2026-09-03. DIFFERENT FROM TDS ON PURPOSE: '
     'Notification 30/2016 moved rule 31A to the 31st and did not touch rule '
     '31AA. effective_from is a FLOOR, not a commencement.')
  ) AS v(key, title, form, section, due_day, exact, src)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.statute_calendar s
    WHERE s.obligation_key = v.key
      AND s.state_code IS NULL
      AND s.effective_from = DATE '2016-06-01');


-- -- 2 - The old rows stop where the new ones start --------------------------
--
-- They keep their NULL due_day. This is the 1962–2016 window: the dates differed
-- by deductor type before June 2016 and were not researched here, so the skill
-- keeps naming the form and explaining the absence, which is what it did for
-- every period until now.

UPDATE public.statute_calendar
   SET effective_to = DATE '2016-06-01',
       notes = COALESCE(NULLIF(btrim(notes), '') || ' ', '') ||
               'Deliberately undated: before 1 June 2016 the quarterly statement '
               'due dates differed by deductor type (government vs other) and '
               'were not researched. The dated version runs from 2016-06-01.',
       verified_on = DATE '2026-09-03'
 WHERE statute = 'Income-tax Act 1961'
   AND effective_from = DATE '1962-04-01'
   AND effective_to = DATE '2026-04-01'
   AND obligation_key IN ('tds.statement.salary', 'tds.statement.nonsalary',
                          'tds.statement.nonresident', 'tcs.statement');


-- -- 3 - What must be true afterwards ---------------------------------------

DO $$
DECLARE
  bad_quarter int;
  tds_days    int;
  tcs_day     int;
  -- NOT `overlaps`: OVERLAPS is a reserved SQL operator (the row-constructor
  -- form `(a,b) OVERLAPS (c,d)`), so `IF overlaps > 0` is a syntax error AT THE
  -- `>` — the parser has already consumed the name as an operator. Cost one
  -- failed apply; the error names a character that is not the problem.
  dup_pairs    int;
  gaps        int;
BEGIN
  -- 267's rule, re-asserted across the whole table: a quarterly row may carry a
  -- due day ONLY with the period-end-March exception, or Q4 prints a month early.
  SELECT count(*) INTO bad_quarter
    FROM public.statute_calendar
   WHERE periodicity = 'quarterly' AND due_day IS NOT NULL
     AND NOT (due_overrides ? '3');
  IF bad_quarter > 0 THEN
    RAISE EXCEPTION '% quarterly row(s) dated with no March exception.', bad_quarter;
  END IF;

  -- THE GUARD THAT MATTERS HERE. TCS is the 15th and TDS is the 31st; a source
  -- summary claimed they were the same and would have put every TCS statement
  -- sixteen days late.
  SELECT count(*) INTO tds_days
    FROM public.statute_calendar
   WHERE statute = 'Income-tax Act 1961' AND effective_from = DATE '2016-06-01'
     AND obligation_key LIKE 'tds.statement.%' AND due_day = 31;
  IF tds_days <> 3 THEN
    RAISE EXCEPTION 'Expected 3 TDS statement rows on day 31, found %.', tds_days;
  END IF;

  SELECT due_day INTO tcs_day
    FROM public.statute_calendar
   WHERE statute = 'Income-tax Act 1961' AND effective_from = DATE '2016-06-01'
     AND obligation_key = 'tcs.statement';
  IF tcs_day IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION
      'TCS 1961 statement due_day is %, expected 15. Rule 31AA is the FIFTEENTH; '
      'only the 2025 Act moved TCS onto the TDS calendar.', tcs_day;
  END IF;

  -- No version of one key may overlap another, or `_resolve` is picking between
  -- two rows that both claim the same day.
  SELECT count(*) INTO dup_pairs
    FROM public.statute_calendar a
    JOIN public.statute_calendar b
      ON a.obligation_key = b.obligation_key
     AND a.id <> b.id
     AND a.state_code IS NOT DISTINCT FROM b.state_code
     AND a.effective_from < COALESCE(b.effective_to, DATE '9999-12-31')
     AND b.effective_from < COALESCE(a.effective_to, DATE '9999-12-31')
   WHERE a.obligation_key IN ('tds.statement.salary', 'tds.statement.nonsalary',
                              'tds.statement.nonresident', 'tcs.statement');
  IF dup_pairs > 0 THEN
    RAISE EXCEPTION '% overlapping version pair(s) among the statement keys.', dup_pairs;
  END IF;

  -- And no HOLE either: the 1961 row must stop exactly where the new one starts.
  SELECT count(*) INTO gaps
    FROM public.statute_calendar
   WHERE statute = 'Income-tax Act 1961' AND effective_from = DATE '1962-04-01'
     AND obligation_key IN ('tds.statement.salary', 'tds.statement.nonsalary',
                            'tds.statement.nonresident', 'tcs.statement')
     AND effective_to <> DATE '2016-06-01';
  IF gaps > 0 THEN
    RAISE EXCEPTION '% statement row(s) leave a coverage gap or overlap.', gaps;
  END IF;

  RAISE NOTICE '1961 statements: 3 TDS rows on the 31st, TCS on the 15th, '
               'no overlap and no gap at 2016-06-01.';
END $$;

COMMIT;
