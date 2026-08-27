-- 228_epf_rates_are_dated_law.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   INSERT staging.statute_calendar × 3   (epf.wage_ceiling, epf.rate.employee,
--                                          epf.rate.employer)
--
-- THREE ROWS IN A REFERENCE TABLE. No DDL, no column, no constraint, nothing
-- backfilled and no customer row touched. Guarded per key, so re-running
-- inserts 0. Reversal is at the foot of this file.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Phase 5.1 asks for every hardcoded payroll constant to come out of a literal
-- and be read from `statute_calendar` at the run's date. The ESI wage ceiling
-- went first and proved the mechanism. Provident fund could not follow, and the
-- reason is worth writing down rather than discovering twice:
--
--   **`statute_calendar` HOLDS NO PF RATE AND NO PF CEILING.** Read live
--   2026-08-27: `epf.remittance` exists, and its `rate_percent` and
--   `threshold_amount` are both NULL. It is a DUE-DATE row — "contribution and
--   ECR by the 15th" — not a rate row. Of the 45 rows in the table, exactly one
--   carries a payroll figure: `esi.wage_ceiling`.
--
-- So `routers/vetana.py` kept `min(pf_base * 0.12, 1800)`, which hardcodes TWO
-- statutory facts at once — the 12% rate and the ₹15,000 ceiling that makes
-- 1,800 the cap. Neither can change without a deploy, and neither says when it
-- started.
--
-- ── THE FIGURES, AND WHERE THEY COME FROM ────────────────────────────────────
--
--   epf.wage_ceiling      ₹15,000/month   from 2014-09-01
--       EPF Scheme 1952, para 2(f) read with the Ministry of Labour and
--       Employment notification G.S.R. 609(E) dated 22 August 2014, in force
--       1 September 2014, which raised the ceiling from ₹6,500 to ₹15,000.
--
--   epf.rate.employee     12%             from 1997-06-01
--   epf.rate.employer     12%             from 1997-06-01
--       EPF & MP Act 1952, s.6 read with the statutory rate of 12% of basic
--       wages, dearness allowance and retaining allowance, in force since
--       1 June 1997 for the general class of establishments.
--
-- **NOT SEEDED, deliberately: the 8.33% EPS split and the 10% reduced-rate
-- class.** The engine does not model either — it computes one employer figure —
-- and a row nothing reads is a row that goes stale unnoticed. The reduced 10%
-- class in particular is an establishment-level fact this product does not
-- record anywhere, so seeding it would invite a reader to apply it wrongly.
--
-- ── IT MOVES NO PAYSLIP, WHICH IS THE POINT ──────────────────────────────────
--
-- 12% of a ₹15,000 ceiling is ₹1,800 — exactly the literal it replaces. Every
-- payslip in both in-scope orgs computes the identical figure the day this
-- lands. The mechanism arrives without moving money; the NEXT change becomes a
-- dated row instead of a deploy.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE until the backend that reads these keys deploys, and none after it
-- either, for the reason above. `statute_calendar` has no writer in the product
-- — every reference in `backend/` is a read — so nothing else can be disturbed
-- by three more rows in it. The skill shelf reads the table by key and will
-- simply see three more.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
-- ROWS FIRST, then the backend — and unusually, the reverse is also safe here:
-- `_epf_terms` returns None when the store cannot answer and the caller keeps
-- the statutory literal, so a backend deployed ahead of these rows computes
-- exactly what it computes today. Rows first anyway, because "safe either way"
-- is a property to rely on when something goes wrong, not a reason to be casual.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- RowExclusiveLock on staging.statute_calendar for three inserts. Nothing waits.

INSERT INTO staging.statute_calendar
    (obligation_key, title, authority, statute, section_ref, periodicity,
     threshold_amount, effective_from, effective_from_exact, source_ref, notes,
     verified_on)
SELECT 'epf.wage_ceiling',
       'Wage ceiling for contribution under the EPF Scheme',
       'epfo', 'Employees'' Provident Funds and Miscellaneous Provisions Act, 1952',
       'EPF Scheme 1952, para 2(f)', 'standing',
       15000.00, DATE '2014-09-01', TRUE,
       'G.S.R. 609(E) dated 22 August 2014, in force 1 September 2014',
       'Raised from 6,500. The engine caps the contribution at 12% of this, '
       'which is the 1,800 that used to be a literal.',
       DATE '2026-08-27'
WHERE NOT EXISTS (SELECT 1 FROM staging.statute_calendar
                   WHERE obligation_key = 'epf.wage_ceiling');

INSERT INTO staging.statute_calendar
    (obligation_key, title, authority, statute, section_ref, periodicity,
     rate_percent, effective_from, effective_from_exact, source_ref, notes,
     verified_on)
SELECT 'epf.rate.employee',
       'Provident fund — employee contribution rate',
       'epfo', 'Employees'' Provident Funds and Miscellaneous Provisions Act, 1952',
       's.6', 'standing',
       12.000, DATE '1997-06-01', TRUE,
       'EPF & MP Act 1952 s.6 — statutory rate for the general class',
       'On basic wages, dearness allowance and retaining allowance. The reduced '
       '10% class is NOT seeded: it is an establishment-level fact this product '
       'does not record, and a row nothing reads goes stale unnoticed.',
       DATE '2026-08-27'
WHERE NOT EXISTS (SELECT 1 FROM staging.statute_calendar
                   WHERE obligation_key = 'epf.rate.employee');

INSERT INTO staging.statute_calendar
    (obligation_key, title, authority, statute, section_ref, periodicity,
     rate_percent, effective_from, effective_from_exact, source_ref, notes,
     verified_on)
SELECT 'epf.rate.employer',
       'Provident fund — employer contribution rate',
       'epfo', 'Employees'' Provident Funds and Miscellaneous Provisions Act, 1952',
       's.6', 'standing',
       12.000, DATE '1997-06-01', TRUE,
       'EPF & MP Act 1952 s.6 — statutory rate for the general class',
       'The 8.33% pension-scheme split of this is NOT seeded: the engine '
       'computes one employer figure and does not model EPS separately.',
       DATE '2026-08-27'
WHERE NOT EXISTS (SELECT 1 FROM staging.statute_calendar
                   WHERE obligation_key = 'epf.rate.employer');

-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.statute_calendar
--    WHERE obligation_key IN ('epf.wage_ceiling', 'epf.rate.employee',
--                             'epf.rate.employer');
--
-- Exact and complete. Payroll returns to the literal it has always used, which
-- computes the same number — so this is reversible without moving a payslip
-- either way.
