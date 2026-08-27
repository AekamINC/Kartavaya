-- 224_professional_tax_states.sql
--
-- Phase 0.24 — seed more professional-tax states.
--
-- Owner, `docs/plans/PHASE-0-owner-unblocks.md:117`: "Mechanism DONE, data NOT.
-- Migration 221 applied, the settings screen shipped, resolution falls back and
-- never blocks. But the ladder still holds 3 states of ~20. Add states as
-- customers need them; the ₹0 fallback means an unseeded state blocks nothing."
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   INSERT staging.pay_professional_tax  × 14   (org_id NULL — SHARED rows)
--     '18' Assam            3 bands
--     '19' West Bengal      5 bands
--     '36' Telangana        3 bands
--     '37' Andhra Pradesh   3 bands
--
--   No DDL. No column added, dropped or retyped. No existing row is UPDATEd or
--   DELETEd — in particular the nine rows already there (Maharashtra '27',
--   Gujarat '24', Karnataka '29') are not touched, and neither is Maharashtra's
--   February variant, which is a separate owner decision and stays unseeded.
--
-- ── WRITE-PATH SIDE EFFECTS, STATED BEFORE IT RUNS ───────────────────────────
--
-- ⚠ THESE ARE SHARED ROWS. `org_id IS NULL` means EVERY organisation reads
--   them — `routers/vetana.py::_pt_slabs` admits `org_id = $1 OR org_id IS
--   NULL`. This is not a per-tenant seed and cannot be rolled back per tenant.
--
-- ⚠ STAGING AND PRODUCTION SHARE THIS DATABASE. Both write to the `staging`
--   schema, so this INSERT lands in production the moment it runs.
--
-- WHAT ACTUALLY CHANGES FOR A LIVE PAYROLL RUN: nothing, in either in-scope
-- organisation. A band is matched on the EMPLOYEE's state
-- (`_pt_from_slabs(slabs, state, gross)`), and measured read-only on the live
-- database 2026-08-27 every employee row that carries a state carries '27' or
-- '24':
--
--     SELECT state, count(*) FROM staging.manav_employees GROUP BY 1;
--       '27'  83   (E2E Test & Associates)
--       '24'  26   (Unicode Group)
--
-- Nobody is in Assam, West Bengal, Telangana or Andhra Pradesh. Fourteen rows
-- that no employee can match change no payslip, no total and no net pay. They
-- become live the first time somebody sets an employee's state to one of the
-- four — which is the point.
--
-- RISK, honestly: LOW, and it is a *reversible data* risk rather than a schema
-- one. The realistic failure is not that this breaks a run; it is that a rate
-- below is WRONG and silently deducts the wrong amount from a real person in
-- one of these four states later. That is why every band below carries its
-- source, why four states were seeded and fifteen were deliberately not, and
-- why the reversal at the foot of this file is a single scoped DELETE.
--
-- RE-RUNNING IS SAFE. There is no unique index on this table — verified from
-- the catalogue, not from a migration file:
--
--     SELECT indexname FROM pg_indexes WHERE schemaname='staging'
--      AND tablename='pay_professional_tax';
--       pay_professional_tax_pkey · idx_pay_professional_tax_org
--
-- so a naked re-run would DUPLICATE all fourteen rows and the duplicate would
-- rank identically in `_pt_from_slabs`. Each INSERT below is therefore guarded
-- `WHERE NOT EXISTS` on *the state already having any shared row at all* — not
-- on the exact band. That is deliberate: it makes this a SEED, not an upsert.
-- If the owner later edits Telangana's ₹150 through the settings screen, a
-- re-run of this file leaves that edit alone instead of silently restoring the
-- figure the owner changed.
--
-- ── DEPLOY ORDER: NONE REQUIRED, AND THAT IS A PROPERTY WORTH STATING ────────
--
-- This migration adds no column and renames nothing, so no router SELECTs
-- anything that does not already exist. It may be applied before, during or
-- after any deploy, and the currently deployed backend reads the new rows
-- correctly without being redeployed — `_pt_slabs` already selects
-- `state_code` generically and has no state allowlist compiled into it.
-- (Contrast migration 220, whose header records that `manav_employees.state`
-- HAD to land before `routers/manav.py` deployed or every employee read 500'd.)
--
-- ── HOW A BAND IS MATCHED, AND WHY THE BOUNDARIES CARRY PAISE ────────────────
--
-- `_pt_from_slabs` matches INCLUSIVELY at both ends:
--
--     if gross < low:                       continue
--     if high is not None and gross > high: continue
--
-- and `pay_professional_tax.slab_from/slab_to` and `vetana_payslips.gross` are
-- all `numeric(_, 2)` — so the smallest gap expressible between two bands is
-- one paisa.
--
-- The nine rows already seeded use whole-rupee boundaries: Maharashtra runs
-- 0–7,500 then 7,501–10,000 then 10,001+. That leaves a NINETY-NINE-PAISA DEAD
-- ZONE at the top of every band. A gross of ₹10,000.50 matches the ₹175 band
-- (10,000.50 > 10,000) and does not match the ₹200 band (10,000.50 < 10,001):
-- it matches NOTHING, and `_pt_from_slabs` returns 0.0 with no error and no log
-- line. One live payslip already carries a fractional gross (₹3,657.69 in E2E),
-- so this is a reachable hole rather than a theoretical one.
--
-- The four ladders below therefore start each band ONE PAISA above the previous
-- band's statutory ceiling — 15,000.01, not 15,001 — which is contiguous over
-- `numeric(_,2)` with no gap at all. `slab_to` still carries the clean
-- statutory figure (15,000.00), so the settings screen shows the number the
-- statute uses. DO NOT "TIDY" THESE TO WHOLE RUPEES: that re-opens the hole.
--
-- Fixing the existing nine rows is NOT done here. That is an UPDATE to live
-- shared rows a customer's payroll reads today, which the plan's own rule keeps
-- as a separate decision raised first — it is in this session's report.
--
-- ── EVERY RATE BELOW IS A CLAIM ABOUT SOMEBODY'S PAYSLIP ─────────────────────
--
-- Each state carries the Act, the amendment, and the sources checked on
-- 2026-08-27. Where two sources disagreed the disagreement is written down
-- rather than averaged away. Fifteen further states were researched and
-- DELIBERATELY LEFT OUT; the list and the reason for each is at the foot of
-- this file, because "we looked and decided not to" is the fact a later reader
-- needs and the one that otherwise gets lost.
--
-- The annual ceiling on this levy is ₹2,500 (Constitution, Article 276(2)).
-- Every top band below is checked against it in the comments.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- '18' ASSAM
--
-- The Assam Professions, Trades, Callings and Employments Taxation Act, 1947.
-- Entry 1 of the Schedule (salary and wage earners) was SUBSTITUTED by a
-- Government of Assam notification dated 2 April 2025, which raised the
-- exemption from ₹10,000 to ₹15,000 a month and dropped the old ₹150 band.
--
-- Sources checked 2026-08-27:
--   · cleartax.in/s/professional-tax-assam — "revised professional tax slab
--     rate in Assam, effective from 1st April 2025": up to ₹15,000 Nil;
--     ₹15,001–₹25,000 ₹180; above ₹25,001 ₹208.
--   · legalitysimplified.com — notification of 2 April 2025 replacing Entry 1:
--     up to ₹15,000 Nil; ₹15,000–₹25,000 ₹180; more than ₹25,000 ₹208.
--   · product-updates.greythr.com — "applicable from April 2025".
--
-- ⚠ ONE DISAGREEMENT, RECORDED RATHER THAN SMOOTHED. greytHR paraphrases the
--   middle band as "₹15,001–₹24,999" and the top as "₹25,000+", which would
--   charge ₹208 at a gross of exactly ₹25,000. cleartax and legalitysimplified
--   both put the break AFTER ₹25,000, which is also the standard drafting of
--   this Schedule ("exceeds ₹15,000 but does not exceed ₹25,000"). Two sources
--   to one, and the majority reading is the one seeded. The whole disagreement
--   is worth ₹28 a month to an employee grossing exactly ₹25,000.00.
--
-- ⚠ THE PRE-2025 ASSAM LADDER IS NOT SEEDED. Re-running an Assam payroll for a
--   month before April 2025 will find no band with `effective_from <= as_at`
--   and compute ₹0 rather than the superseded ₹150/₹180/₹208. ₹0 is the owner's
--   documented never-block fallback; seeding a ladder whose exact repeal-date
--   boundaries could not be established would have been the worse error.
--
-- Ceiling check: ₹208 × 12 = ₹2,496 ≤ ₹2,500. ✓
INSERT INTO staging.pay_professional_tax
       (org_id, state_code, state_name, slab_from, slab_to, monthly_tax,
        effective_from, month)
SELECT NULL::uuid, v.state_code, v.state_name, v.slab_from, v.slab_to,
       v.monthly_tax, v.effective_from, NULL::smallint
  FROM (VALUES
    ('18', 'Assam',        0.00::numeric, 15000.00::numeric,   0.00::numeric, DATE '2025-04-01'),
    ('18', 'Assam',    15000.01,          25000.00,          180.00,          DATE '2025-04-01'),
    ('18', 'Assam',    25000.01,          NULL::numeric,     208.00,          DATE '2025-04-01')
  ) AS v(state_code, state_name, slab_from, slab_to, monthly_tax, effective_from)
 WHERE NOT EXISTS (
     SELECT 1 FROM staging.pay_professional_tax x
      WHERE x.org_id IS NULL AND x.state_code = v.state_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- '19' WEST BENGAL
--
-- The West Bengal State Tax on Professions, Trades, Callings and Employments
-- Act, 1979 — the Schedule as it stands with effect from 1 April 2014, which
-- zeroed the old ₹8,501–₹10,000 (₹90) band and left the exemption at ₹10,000.
--
-- Sources checked 2026-08-27:
--   · comtax.wb.gov.in/Ptax-Schedule-New_(w.e.f._1-4-2014).pdf — the state
--     Directorate of Commercial Taxes' own schedule, and the source of the
--     `effective_from` below.
--   · cleartax.in/s/professional-tax-west-bengal — up to ₹10,000 Nil;
--     ₹10,001–₹15,000 ₹110; ₹15,001–₹25,000 ₹130; ₹25,001–₹40,000 ₹150;
--     above ₹40,000 ₹200.
--   · taxguru.in state-wise table — identical figures.
--
-- Three independent sources, no disagreement on any boundary or rate.
--
-- Ceiling check: ₹200 × 12 = ₹2,400 ≤ ₹2,500. ✓
INSERT INTO staging.pay_professional_tax
       (org_id, state_code, state_name, slab_from, slab_to, monthly_tax,
        effective_from, month)
SELECT NULL::uuid, v.state_code, v.state_name, v.slab_from, v.slab_to,
       v.monthly_tax, v.effective_from, NULL::smallint
  FROM (VALUES
    ('19', 'West Bengal',     0.00::numeric, 10000.00::numeric,   0.00::numeric, DATE '2014-04-01'),
    ('19', 'West Bengal', 10000.01,          15000.00,          110.00,          DATE '2014-04-01'),
    ('19', 'West Bengal', 15000.01,          25000.00,          130.00,          DATE '2014-04-01'),
    ('19', 'West Bengal', 25000.01,          40000.00,          150.00,          DATE '2014-04-01'),
    ('19', 'West Bengal', 40000.01,          NULL::numeric,     200.00,          DATE '2014-04-01')
  ) AS v(state_code, state_name, slab_from, slab_to, monthly_tax, effective_from)
 WHERE NOT EXISTS (
     SELECT 1 FROM staging.pay_professional_tax x
      WHERE x.org_id IS NULL AND x.state_code = v.state_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- '36' TELANGANA
--
-- The Telangana Tax on Professions, Trades, Callings and Employments Act, 1987
-- — the First Schedule carried over unchanged from the undivided Andhra Pradesh
-- Act on the appointed day of the Andhra Pradesh Reorganisation Act, 2014
-- (2 June 2014), which is the `effective_from` below and the honest date for
-- when this ladder began to apply IN TELANGANA. The figures themselves are the
-- 2013 AP substitution cited under '37'.
--
-- Sources checked 2026-08-27:
--   · simpliance.in/professional-tax-detail/telangana — up to ₹15,000 ₹0;
--     ₹15,001–₹20,000 ₹150; ₹20,001 and above ₹200, under the 1987 Act.
--   · factohr.com/professional-tax/telangana — same three bands.
--   · taxguru.in state-wise table — same three bands.
--
-- Three independent sources, no disagreement.
--
-- Ceiling check: ₹200 × 12 = ₹2,400 ≤ ₹2,500. ✓
INSERT INTO staging.pay_professional_tax
       (org_id, state_code, state_name, slab_from, slab_to, monthly_tax,
        effective_from, month)
SELECT NULL::uuid, v.state_code, v.state_name, v.slab_from, v.slab_to,
       v.monthly_tax, v.effective_from, NULL::smallint
  FROM (VALUES
    ('36', 'Telangana',     0.00::numeric, 15000.00::numeric,   0.00::numeric, DATE '2014-06-02'),
    ('36', 'Telangana', 15000.01,          20000.00,          150.00,          DATE '2014-06-02'),
    ('36', 'Telangana', 20000.01,          NULL::numeric,     200.00,          DATE '2014-06-02')
  ) AS v(state_code, state_name, slab_from, slab_to, monthly_tax, effective_from)
 WHERE NOT EXISTS (
     SELECT 1 FROM staging.pay_professional_tax x
      WHERE x.org_id IS NULL AND x.state_code = v.state_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- '37' ANDHRA PRADESH
--
-- The Andhra Pradesh Tax on Professions, Trades, Callings and Employments Act,
-- 1987. The First Schedule was SUBSTITUTED by G.O.Ms.No. 82 dated 4 February
-- 2013, given effect by the AP Tax on Professions, Trades, Callings and
-- Employments (Amendment) Act, 2013, which came into force on 6 February 2013
-- — the `effective_from` below. It raised the exemption from ₹5,000 to ₹15,000
-- a month.
--
-- '37' is the LIVE Andhra Pradesh GST code. '28' is the undivided state and is
-- flagged retired in `services/gst_states.py`; nothing is seeded against it, so
-- an employee still carrying '28' resolves no band and pays ₹0 rather than
-- silently picking up post-bifurcation AP rates.
--
-- Sources checked 2026-08-27:
--   · simpliance.in/professional-tax-detail/andhra-pradesh — up to ₹15,000 ₹0;
--     ₹15,001–₹20,000 ₹150; above ₹20,001 ₹200, under the 1987 Act.
--   · legitquest.com — Amendment Act, 2013, in force 6 February 2013.
--   · taxguru.in "Revised Rates of Profession Tax in Andhra Pradesh" —
--     G.O.Ms.No. 82 dated 04-02-2013, First Schedule replaced, exemption to
--     ₹15,000, ₹150 and ₹200 bands as below.
--
-- Ceiling check: ₹200 × 12 = ₹2,400 ≤ ₹2,500. ✓
INSERT INTO staging.pay_professional_tax
       (org_id, state_code, state_name, slab_from, slab_to, monthly_tax,
        effective_from, month)
SELECT NULL::uuid, v.state_code, v.state_name, v.slab_from, v.slab_to,
       v.monthly_tax, v.effective_from, NULL::smallint
  FROM (VALUES
    ('37', 'Andhra Pradesh',     0.00::numeric, 15000.00::numeric,   0.00::numeric, DATE '2013-02-06'),
    ('37', 'Andhra Pradesh', 15000.01,          20000.00,          150.00,          DATE '2013-02-06'),
    ('37', 'Andhra Pradesh', 20000.01,          NULL::numeric,     200.00,          DATE '2013-02-06')
  ) AS v(state_code, state_name, slab_from, slab_to, monthly_tax, effective_from)
 WHERE NOT EXISTS (
     SELECT 1 FROM staging.pay_professional_tax x
      WHERE x.org_id IS NULL AND x.state_code = v.state_code);

COMMIT;

-- ── THE FIFTEEN STATES DELIBERATELY LEFT OUT, AND WHY ────────────────────────
--
-- Researched 2026-08-27 and NOT seeded. "We looked and decided not to" is the
-- fact a later reader needs; without it the next person re-does this work and
-- reaches a different answer.
--
-- A. THE TABLE'S MODEL IS «MONTHLY GROSS BAND → MONTHLY TAX». `_pt_from_slabs`
--    compares `slab_from/slab_to` against ONE MONTH's gross. Any state whose
--    Schedule bands ANNUAL income cannot be entered here without dividing by
--    twelve — an inference the statute does not make, because annual income is
--    not twelve times one month's gross once a bonus, arrears or a mid-year
--    joiner exists. Seeding a ÷12 guess would deduct a wrong amount silently:
--
--      '23' Madhya Pradesh   annual bands (₹2,25,000 / ₹3,00,000 / ₹4,00,000)
--                            AND a different figure in the twelfth month.
--                            Sources also disagree on that figure (₹166/₹174
--                            vs ₹167, ₹208/₹212) — two reasons, either fatal.
--      '21' Odisha           annual bands + a ₹300 last month.
--      '10' Bihar            annual bands, paid annually.
--      '20' Jharkhand        annual bands.
--      '22' Chhattisgarh     annual bands (ten of them).
--      '17' Meghalaya        annual bands (twelve of them).
--      '14' Manipur          annual bands.
--
-- B. HALF-YEARLY, AND SET BY THE LOCAL BODY RATHER THAN THE STATE. Neither the
--    period nor the rate is a state-level monthly figure, so there is no single
--    correct row to write:
--
--      '33' Tamil Nadu       half-yearly, each municipal corporation fixing its
--                            own rate within statutory limits. Chennai is a
--                            large market and this is the most valuable state
--                            still owed — it needs a schema conversation about
--                            period and local body first, not a guess.
--      '32' Kerala           half-yearly, levied by the local body.
--      '34' Puducherry       half-yearly.
--
-- C. NOT A GROSS-SALARY BAND AT ALL.
--
--      '03' Punjab           the State Development Tax is a flat ₹200 a month
--                            on persons whose income is TAXABLE UNDER THE
--                            INCOME-TAX ACT. Mapping that onto a gross band
--                            ("above ₹2,50,000 a year") is an inference about
--                            regime, deductions and exemptions, not a rate.
--
-- D. FITS THE MODEL, BUT ONE STALE SOURCE IS NOT ENOUGH. These four DO band
--    monthly gross and could be seeded — but the only figures found were in a
--    consolidated 2024-25 aggregator table, and Assam above is the proof that
--    those go stale (its slabs changed in April 2025 and that same table still
--    showed the old ones). Each needs one verified state source before it is
--    written into anybody's deductions:
--
--      '11' Sikkim · '16' Tripura · '15' Mizoram · '13' Nagaland
--
-- E. NO PROFESSIONAL TAX IS LEVIED — nothing to seed, and ₹0 is already the
--    right answer for them by fallback: Delhi '07', Haryana '06', Uttar Pradesh
--    '09', Uttarakhand '05', Rajasthan '08', Himachal Pradesh '02', Goa '30',
--    Arunachal Pradesh '12', Chandigarh '04', Jammu and Kashmir '01',
--    Ladakh '38', Andaman and Nicobar '35', Lakshadweep '31'.
--
-- ── WHAT THIS FILE DOES NOT DO, ON PURPOSE ───────────────────────────────────
--
--   · Maharashtra's FEBRUARY variant (₹300) is not seeded. Migration 221 built
--     the `month` column for it and left the figure to the owner; that stands.
--   · Maharashtra's GENDER split is not seeded and CANNOT BE — this table has
--     no gender dimension. Since 1 April 2023 (L.A. Bill No. XIII of 2023,
--     20 March 2023) women in Maharashtra are exempt up to ₹25,000 a month
--     while men are exempt only to ₹7,500. The seeded '27' ladder is the MALE
--     one, so every woman in Maharashtra grossing ₹7,501–₹25,000 is currently
--     over-deducted. That needs a column, not a row. Reported, not fixed here.
--   · The stale '24' Gujarat and '29' Karnataka bands are not corrected. Both
--     are UPDATEs/DELETEs of live shared rows a customer's payroll reads today,
--     which the plan keeps as a separate decision. Reported, not fixed here.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.pay_professional_tax
--    WHERE org_id IS NULL AND state_code IN ('18','19','36','37');
--
-- Exact and complete: no row with those four state codes existed before this
-- file ran (verified read-only 2026-08-27 — the table held exactly nine rows,
-- '24' × 4, '27' × 3, '29' × 2), and the guard is scoped to `org_id IS NULL`
-- so it cannot reach a band an organisation entered for itself. Nothing else
-- references these rows: `pay_professional_tax.id` is a foreign key from
-- nowhere, and `vetana_payslips` stores the resulting AMOUNT, never the slab.
