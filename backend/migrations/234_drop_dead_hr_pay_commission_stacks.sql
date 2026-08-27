-- 234 · Drop the twenty dead tables of the hr_* / pay_* / sales_commission* stacks
--
-- Approved by the owner on 2026-08-27, answering "the 24-table DROP list" with
-- "Go ahead". A DROP is approved BY NAME in this project, so every one of the
-- twenty is named below and every EXCLUSION is named too, with its reason.
--
-- ── FOUR OF THE TWENTY-FOUR ARE NOT DROPPED ──────────────────────────────────
--
-- The list was 24. This drops 20. The four left standing, and why:
--
--   staging.pay_professional_tax    23 ROWS. LIVE.
--   staging.pay_income_tax_slabs    23 ROWS. LIVE.
--
--       These two are on the list only to be VISIBLY EXCLUDED, and they are the
--       reason the whole list needed re-reading. `pay_professional_tax` is the
--       shared PT ladder every payroll run reads; `pay_income_tax_slabs` was
--       created by migration 230 during Phase 5.2b and `income_tax.ladder_for`
--       reads it for every TDS figure on every payslip. Dropping them takes
--       professional tax AND income tax to ₹0 for every employee in the
--       product. They share a prefix with the dead stack and nothing else.
--
--   public.report_schedules         0 rows — and STILL NOT SAFE.
--
--       Empty is not the same as unused. `routers/reports.py` holds EIGHT live
--       statements against it — SELECT, INSERT, UPDATE ×2, DELETE — and
--       `POST /api/reports/dispatch` is on an ARMED hourly cron
--       (`cron-report-dispatch`, `7 * * * *`). Dropping the table turns all of
--       that into 42P01 and fails the cron every hour. Retiring the second
--       report scheduler is Phase 6.4's DECISION, and executing it means
--       removing a router and disarming a cron, not dropping a table.
--
--   staging.sales_territories       0 rows — and it has dependents nobody named.
--
--       `staging.sales_targets` and `staging.sales_routing_rules` both carry a
--       foreign key INTO it. Both are empty too, but neither was on the owner's
--       list, and dropping this table necessarily alters two tables he did not
--       name — either by failing, or by discarding their constraints under
--       CASCADE. A DROP approved by name does not reach tables that were not
--       named. It needs putting to him as three tables, not one.
--
-- ── WHAT WAS CHECKED BEFORE WRITING THIS ─────────────────────────────────────
--
-- Live, read-only, 2026-08-27:
--
--   · Every one of the twenty holds exactly ZERO rows. Counted with `count(*)`,
--     never `n_live_tup` — that estimator reported 23 and 14 for two tables
--     that both held 23 earlier today.
--   · Every inbound foreign key to the twenty comes from a table INSIDE the
--     twenty. Nothing outside the set points at any of them. (`sales_territories`
--     is excluded above precisely because that was NOT true of it.)
--   · No view or materialised view depends on any of them.
--   · No router, service or `server.py` path names any of them in SQL. Three
--     are mentioned in PROSE — `hr_employees` in `report_defs/people_reports.py`
--     (a comment saying it exists, looks identical and holds zero),
--     `hr_holidays` in `skills/data/people_checks.py`, and `pay_tds_records` in
--     `services/tds_challan_pdf.py`. All three are comments. Nothing executes.
--
-- ── WHY ONE STATEMENT, AND WHY NO CASCADE ────────────────────────────────────
--
-- One `DROP TABLE` naming all twenty, because they reference each other —
-- `hr_employees` alone has twelve inbound keys from its own stack — and a
-- single statement resolves that without anyone having to get the order right.
-- Deletion order being fatal when reversed is recorded in
-- `memory/architecture_table_systems`; this sidesteps it rather than solving it.
--
-- NO CASCADE, deliberately. If some dependency exists that the checks above did
-- not find, this statement must FAIL and leave the database exactly as it is.
-- CASCADE would silently drop whatever that dependency was, and the report of
-- what happened would be "it worked".
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
-- There is no data to restore: all twenty are empty, which is the whole reason
-- they can go. The SCHEMA is recoverable from the migrations that created it,
-- which stay in this directory and in git history. Nothing here is a backup.

DROP TABLE IF EXISTS
    staging.hr_attendance,
    staging.hr_documents,
    staging.hr_employees,
    staging.hr_holidays,
    staging.hr_leave_balances,
    staging.hr_leave_requests,
    staging.hr_leave_types,
    staging.hr_office_locations,
    staging.hr_salary_structures,
    staging.hr_shifts,
    staging.pay_esi_records,
    staging.pay_it_declarations,
    staging.pay_loans,
    staging.pay_pf_records,
    staging.pay_runs,
    staging.pay_slips,
    staging.pay_tds_records,
    staging.sales_commission_assignments,
    staging.sales_commission_slabs,
    staging.sales_commissions;
