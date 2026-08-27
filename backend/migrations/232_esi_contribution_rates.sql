-- 232_esi_contribution_rates.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   INSERT staging.statute_calendar × 2   (esi.rate.employee, esi.rate.employer)
--
-- TWO ROWS IN A REFERENCE TABLE. No DDL, no customer row, nothing backfilled.
-- Guarded per key, so re-running inserts 0. Reversal at the foot.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- The last two literals in `_compute_statutory`. When the ESI **ceiling** came
-- out of the code in 5.1's first pass, the RATES stayed, and the comment beside
-- them gave the honest reason:
--
--     "THE CEILING IS DATED NOW; THE RATES ARE NOT. 0.75% and 3.25% stay
--      literal because `statute_calendar` holds no key for them ... A constant
--      with nowhere to read it from is not improved by pretending otherwise."
--
-- That was true when it was written. This file makes it false, the same way
-- migration 228 did for provident fund: seed the law, then read it.
--
-- ── THE FIGURES ──────────────────────────────────────────────────────────────
--
--   esi.rate.employee    0.75%   from 2019-07-01
--   esi.rate.employer    3.25%   from 2019-07-01
--       ESI (Central) Rules 1950, rule 51, as substituted by G.S.R. 423(E)
--       dated 13 June 2019, in force 1 July 2019 — the notification that cut
--       them from 1.75% and 4.75%.
--
-- The rates are charged on the ESI base only while that base is at or under
-- `esi.wage_ceiling`, which is already a dated row. Rate and ceiling are
-- separate keys because they change separately and have done.
--
-- ── IT MOVES NO PAYSLIP ──────────────────────────────────────────────────────
--
-- 0.75 and 3.25 are exactly the literals they replace. Every payslip in both
-- in-scope orgs computes the identical figure the day this lands; the next
-- change becomes a dated row instead of a deploy.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE. `statute_calendar` has no writer in this product — every reference in
-- `backend/` is a read — and `_esi_rates` falls back to the same literals when
-- the store cannot answer, so a backend deployed either side of these rows
-- computes the same number.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- RowExclusiveLock on staging.statute_calendar for two inserts.

INSERT INTO staging.statute_calendar
    (obligation_key, title, authority, statute, section_ref, periodicity,
     rate_percent, effective_from, effective_from_exact, source_ref, notes, verified_on)
SELECT v.k, v.t, 'esic', 'Employees'' State Insurance Act, 1948', v.sec, 'standing',
       v.pct, DATE '2019-07-01', TRUE,
       'G.S.R. 423(E) dated 13 June 2019, in force 1 July 2019',
       v.note, DATE '2026-08-27'
FROM (VALUES
    ('esi.rate.employee',
     'Employees State Insurance — employee contribution rate',
     'ESI (Central) Rules 1950, rule 51', 0.750,
     'Reduced from 1.75% by the 2019 notification. Charged on the ESI base only while that base is at or under esi.wage_ceiling.'),
    ('esi.rate.employer',
     'Employees State Insurance — employer contribution rate',
     'ESI (Central) Rules 1950, rule 51', 3.250,
     'Reduced from 4.75% by the 2019 notification.')
) AS v(k, t, sec, pct, note)
WHERE NOT EXISTS (SELECT 1 FROM staging.statute_calendar c WHERE c.obligation_key = v.k);

-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.statute_calendar
--    WHERE obligation_key IN ('esi.rate.employee', 'esi.rate.employer');
--
-- Payroll returns to the literals, which compute the same number — reversible
-- without moving a payslip either way.
