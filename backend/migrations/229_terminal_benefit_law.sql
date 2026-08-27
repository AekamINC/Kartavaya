-- 229_terminal_benefit_law.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   INSERT staging.statute_calendar × 6
--     gratuity.ceiling · gratuity.rate.per_completed_year · gratuity.qualifying_years
--     bonus.rate.minimum · bonus.rate.maximum · bonus.eligibility_ceiling
--     bonus.calculation_ceiling                                    (7 in total)
--
-- SIX-PLUS ROWS IN A REFERENCE TABLE. No DDL, no customer row, nothing
-- backfilled. Guarded per key, so re-running inserts 0. Reversal at the foot.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Phase 5.2: "add `gratuity`, `statutory_bonus` and `LWF` keys to the calendar
-- and the payroll computation — none of these exists as a column or as code
-- today". Confirmed live 2026-08-27: `statute_calendar` holds no key matching
-- gratuity or bonus, and `grep gratuity backend/` finds exactly one file —
-- `services/compliance_settings.py`, where it is a rule a firm can tick, not a
-- rate anything computes.
--
-- ── WHAT WILL READ THEM, HONESTLY ────────────────────────────────────────────
--
-- The acceptance in the plan is "a gratuity-eligible employee's F&F can read a
-- rate". **THERE IS NO F&F PATH.** `routers/vetana.py:1545` says so in its own
-- words — "no full-and-final settlement path exists anywhere in the codebase
-- (searched: settlement, fnf, final_settlement — no hits)" — and threads a
-- `final_settlement` flag through for a feature not yet built.
--
-- So these rows are seeded for two readers that are real today, and one that is
-- not:
--   · the skill shelf reads `statute_calendar` by key across eight modules, so
--     these become citable dated law the moment they land;
--   · `_terminal_benefit_terms` in `routers/vetana.py` resolves them at a date,
--     so the F&F feature inherits the law instead of inventing constants;
--   · the F&F path itself is OWED, and this file does not pretend otherwise.
--
-- ── THE FIGURES, AND WHERE THEY COME FROM ────────────────────────────────────
--
--   gratuity.ceiling                20,00,000   from 2018-03-29
--       Payment of Gratuity Act 1972, s.4(3), as amended by the Payment of
--       Gratuity (Amendment) Act 2018 and notified by S.O. 1420(E) dated
--       29 March 2018, raising the ceiling from 10,00,000.
--
--   gratuity.rate.per_completed_year  57.692%   from 1972-09-16
--       s.4(2): fifteen days' wages for every completed year, on the last drawn
--       wages. For a monthly-rated employee the explanation to s.4(2) divides
--       the monthly wage by 26, so a completed year is 15/26 of a month —
--       57.6923%. Stored as a percentage of ONE MONTH'S wages, because that is
--       what the column can express; the exact fraction is 15/26.
--
--   gratuity.qualifying_years              5    from 1972-09-16
--       s.4(1): five years of continuous service. The proviso waives it where
--       employment ends by death or disablement.
--       ⚠ UNIT WARNING, and it is why this key is named the way it is:
--       `threshold_amount` is an unqualified NUMERIC used elsewhere for rupees.
--       Here it is YEARS. A reader that assumes rupees reads 5 rupees. The key
--       name and this note are the only guards the column offers.
--
--   bonus.rate.minimum                  8.33%   from 1965-09-25
--       Payment of Bonus Act 1965, s.10 — the minimum bonus payable whether or
--       not the employer has an allocable surplus.
--   bonus.rate.maximum                     20%  from 1965-09-25
--       s.11 — the maximum payable out of allocable surplus.
--   bonus.eligibility_ceiling           21,000  from 2014-04-01
--       s.2(13), as substituted by the Payment of Bonus (Amendment) Act 2015,
--       given retrospective effect from 1 April 2014.
--   bonus.calculation_ceiling            7,000  from 2014-04-01
--       s.12, as amended in 2015: bonus is computed on 7,000 or the minimum
--       wage for the scheduled employment, WHICHEVER IS HIGHER. The second limb
--       is a state-by-state figure this product does not hold, so a reader must
--       treat 7,000 as a floor and not as the answer. Recorded in notes.
--
-- ── LWF IS DELIBERATELY NOT SEEDED, AND THAT IS THE HONEST ANSWER ────────────
--
-- The Labour Welfare Fund is STATE law. Rates, periodicity (monthly, half-yearly
-- or annual), the employer:employee split and even whether a fund exists at all
-- differ by state — roughly fifteen states operate one and the rest do not. A
-- single national LWF row would be wrong everywhere.
--
-- It needs the shape professional tax already has — a per-state ladder with a
-- resolution order that falls back and never refuses — not a key in this table.
-- Seeding one number here to satisfy a checklist would put a figure into a
-- deduction that is wrong for every state it is not from. Recorded as owed.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE. Nothing computes gratuity or bonus from these today; the monthly run
-- takes `bonus` as an amount somebody enters and does not consult a rate. No
-- payslip changes, now or when the backend deploys. `statute_calendar` has no
-- writer in the product — every reference in `backend/` is a read.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
-- Either order is safe: `_terminal_benefit_terms` returns None per term when the
-- store cannot answer, and nothing computes from it yet. Rows first regardless.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- RowExclusiveLock on staging.statute_calendar for seven inserts.

INSERT INTO staging.statute_calendar
    (obligation_key, title, authority, statute, section_ref, periodicity,
     threshold_amount, effective_from, effective_from_exact, source_ref, notes, verified_on)
SELECT v.k, v.t, 'epfo', v.act, v.sec, 'standing',
       v.amt, v.eff, TRUE, v.src, v.note, DATE '2026-08-27'
FROM (VALUES
    ('gratuity.ceiling',
     'Gratuity — statutory ceiling',
     'Payment of Gratuity Act, 1972', 's.4(3)',
     2000000.00, DATE '2018-03-29',
     'Payment of Gratuity (Amendment) Act 2018, notified by S.O. 1420(E) dated 29 March 2018',
     'Raised from 10,00,000.'),
    ('gratuity.qualifying_years',
     'Gratuity — years of continuous service required',
     'Payment of Gratuity Act, 1972', 's.4(1)',
     5.00, DATE '1972-09-16',
     'Payment of Gratuity Act 1972, s.4(1)',
     'THE UNIT IS YEARS, NOT RUPEES. threshold_amount is an unqualified NUMERIC used for money elsewhere in this table; the key name is the only other guard. The proviso to s.4(1) waives the five years where employment ends by death or disablement.'),
    ('bonus.eligibility_ceiling',
     'Statutory bonus — wage ceiling for eligibility',
     'Payment of Bonus Act, 1965', 's.2(13)',
     21000.00, DATE '2014-04-01',
     'Payment of Bonus (Amendment) Act 2015, retrospective to 1 April 2014',
     'An employee drawing above this is outside the Act.'),
    ('bonus.calculation_ceiling',
     'Statutory bonus — wage ceiling for computation',
     'Payment of Bonus Act, 1965', 's.12',
     7000.00, DATE '2014-04-01',
     'Payment of Bonus (Amendment) Act 2015, retrospective to 1 April 2014',
     's.12 says 7,000 OR the minimum wage for the scheduled employment, WHICHEVER IS HIGHER. The second limb is a state-by-state figure this product does not hold, so a reader must treat this as a floor and not as the answer.')
) AS v(k, t, act, sec, amt, eff, src, note)
WHERE NOT EXISTS (SELECT 1 FROM staging.statute_calendar c WHERE c.obligation_key = v.k);

INSERT INTO staging.statute_calendar
    (obligation_key, title, authority, statute, section_ref, periodicity,
     rate_percent, effective_from, effective_from_exact, source_ref, notes, verified_on)
SELECT v.k, v.t, 'epfo', v.act, v.sec, 'standing',
       v.pct, v.eff, TRUE, v.src, v.note, DATE '2026-08-27'
FROM (VALUES
    ('gratuity.rate.per_completed_year',
     'Gratuity — wages payable per completed year of service',
     'Payment of Gratuity Act, 1972', 's.4(2)',
     57.692, DATE '1972-09-16',
     'Payment of Gratuity Act 1972, s.4(2) and its explanation',
     'Fifteen days'' wages per completed year on the LAST DRAWN wages. For a monthly-rated employee the explanation divides the monthly wage by 26, so a completed year is 15/26 of a month = 57.6923%. Stored as a percentage of one month''s wages because that is what this column can express; the exact fraction is 15/26.'),
    ('bonus.rate.minimum',
     'Statutory bonus — minimum rate',
     'Payment of Bonus Act, 1965', 's.10',
     8.330, DATE '1965-09-25',
     'Payment of Bonus Act 1965, s.10',
     'Payable whether or not the employer has an allocable surplus.'),
    ('bonus.rate.maximum',
     'Statutory bonus — maximum rate',
     'Payment of Bonus Act, 1965', 's.11',
     20.000, DATE '1965-09-25',
     'Payment of Bonus Act 1965, s.11',
     'The ceiling payable out of allocable surplus.')
) AS v(k, t, act, sec, pct, eff, src, note)
WHERE NOT EXISTS (SELECT 1 FROM staging.statute_calendar c WHERE c.obligation_key = v.k);

-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.statute_calendar
--    WHERE obligation_key IN ('gratuity.ceiling', 'gratuity.qualifying_years',
--                             'gratuity.rate.per_completed_year',
--                             'bonus.rate.minimum', 'bonus.rate.maximum',
--                             'bonus.eligibility_ceiling',
--                             'bonus.calculation_ceiling');
--
-- Exact and complete. Nothing computes from them, so removing them changes no
-- figure anywhere — it only takes the citations away again.
