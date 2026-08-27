-- 229_statute_invoicing_thresholds.sql
--
-- Phase 5.3 — "where invoicing derives a statutory date or threshold, read it
-- from the calendar rather than a literal."
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.statute_calendar   +4 rows. Reference data only.
--
-- No schema change. No column added, dropped or altered. No other table read or
-- written. `statute_calendar` carries NO org_id — it is org-independent
-- reference data, the same rows for every tenant — so this adds no tenant data
-- and edits not one customer record. Re-running inserts nothing: ON CONFLICT DO
-- NOTHING on `statute_calendar_version_uniq (obligation_key, state_code,
-- effective_from) NULLS NOT DISTINCT`.
--
-- ── RISK, STATED BEFORE IT RAN ───────────────────────────────────────────────
--
-- Staging and production share one Supabase database, so this runs against
-- production data. What it can and cannot do:
--
--   · It CANNOT change any figure the product prints today. Every value below
--     is EXACTLY the literal the code already applies — Rs 2,50,000 for B2CL,
--     Rs 50,00,000 and 0.1% for 194Q. The readers added alongside this
--     migration fall back to those same literals when a row is absent, so the
--     before-state and the after-state produce byte-identical output. The fact
--     moves; the number does not.
--   · It CANNOT break the deployment order. The readers degrade to the literal
--     when the row is missing, so code-before-migration and
--     migration-before-code are both safe. There is no ordering requirement.
--   · It DOES add rows to a table eight skill modules read. All four are
--     periodicity 'standing', which `/api/v1/statute/due` excludes BY
--     CONSTRUCTION (`_DATED_PERIODICITIES`), so no new deadline appears on any
--     due-dates screen. They WILL appear in `/api/v1/statute/obligations`,
--     which is the intent. `check_thresholds_approaching` reads a fixed list of
--     five keys and is unaffected.
--   · `statute_calendar_one_open_version_idx` allows exactly one open-ended
--     version per key. Each key below is new and is inserted once, so the index
--     is satisfied and stays available for the successor rows described below.
--
-- Reversal, should it ever be wanted — it discards nothing else:
--
--   DELETE FROM staging.statute_calendar
--    WHERE obligation_key IN ('gst.b2cl.threshold','tds.194q.threshold',
--                             'tds.194q.rate','tds.194q.buyer_turnover_test');
--
-- ── THE DISCIPLINE, WHICH IS 158'S AND 170'S AND NOT MINE ────────────────────
--
-- "WHERE A FIELD IS NOT VERIFIED IT IS NULL, NOT GUESSED." Every row below
-- carries a `source_ref` naming the provision and a `verified_on`. Where a
-- commencement date was not verified, `effective_from_exact` is FALSE and the
-- `notes` say so in words rather than leaving a reader to infer it.
--
-- ⚠ OWNER — ONE UNVERIFIED SUCCESSOR IS NAMED AND DELIBERATELY NOT SEEDED.
-- Notification 12/2024-Central Tax is understood to reduce the B2CL
-- invoice-wise reporting threshold from Rs 2,50,000 to Rs 1,00,000. The
-- COMMENCEMENT for GSTR-1 reporting was NOT verified here, and a plausible
-- wrong date in this table defeats every reader at once — so no successor row
-- is written. The `notes` on the row below carry the warning. When the date is
-- confirmed, the change is two statements and no code at all, which is the
-- entire point of moving the figure out of Python:
--
--   UPDATE staging.statute_calendar SET effective_to = DATE '<commencement>'
--    WHERE obligation_key = 'gst.b2cl.threshold';
--   INSERT ... ('gst.b2cl.threshold', ..., 100000, ..., '<commencement>', NULL, TRUE, ...);

INSERT INTO staging.statute_calendar (
    obligation_key, title, authority, statute, form_number, section_ref,
    periodicity, due_day, due_month, due_month_offset, window_days,
    rate_percent, threshold_amount, state_code,
    effective_from, effective_to, effective_from_exact,
    source_ref, notes, verified_on
) VALUES

-- ── GST · the B2CL invoice-wise reporting threshold ─────────────────────────
-- The invoice value above which an INTER-STATE supply to an UNREGISTERED person
-- is reported invoice-wise in GSTR-1 Table 5 (b2cl) instead of being folded into
-- the Table 7 aggregate (b2cs). It decides which SECTION a row lands in; it
-- changes no tax. `services/gstr1_json.py` applied this as a literal Decimal
-- from the day it was written, with a comment saying the rule "has moved before
-- and can move again" — this row is that comment made actionable.
('gst.b2cl.threshold','B2CL — invoice-wise reporting threshold for inter-state supplies to unregistered persons','gst','CGST Rules 2017',NULL,'rule 59(1)','standing',NULL,NULL,NULL,NULL,NULL,250000,NULL,'2017-07-01',NULL,FALSE,'GSTR-1 Table 5, as notified under CGST Rules 2017 rule 59(1)','Rs 2,50,000 per invoice. A REPORTING rule, not a rate: above it the supply is reported invoice-wise in Table 5, at or below it aggregated in Table 7. It changes no liability. effective_from is GST commencement and effective_from_exact is FALSE — the date the Rs 2,50,000 figure itself took effect was not separately verified. ⚠ UNVERIFIED SUCCESSOR: Notification 12/2024-Central Tax is understood to reduce this to Rs 1,00,000. The commencement for GSTR-1 reporting was NOT verified and NO successor row has been written, because a plausible wrong date here is worse than a stale correct one. Kartavaya does not track GSTN advisories; the firm''s own GSTR-1 software is the authority on the threshold in force for the period being filed.','2026-08-27'),

-- ── Income tax · section 194Q, the per-vendor threshold ─────────────────────
-- Inserted by the Finance Act 2021 with effect from 1 July 2021. Rs 50 lakh per
-- SELLER per financial year, measured on the purchase value INCLUDING GST.
('tds.194q.threshold','TDS on purchase of goods — per-seller annual threshold','income_tax','Income-tax Act 1961',NULL,'s.194Q','standing',NULL,NULL,NULL,NULL,NULL,5000000,NULL,'2021-07-01',NULL,TRUE,'Income-tax Act 1961, s.194Q, inserted by the Finance Act 2021 w.e.f. 1 July 2021','Rs 50,00,000 per SELLER per financial year. Measured on the purchase value INCLUDING GST, and TDS applies only to the excess OVER this figure. s.194Q bites at payment OR CREDIT, whichever is earlier, and advances count — which is why the product warns at purchase-order time. NOT renumbered here: the Income-tax Act 2025 renumbering seeded by migration 158 covered the statement, certificate and higher-rate provisions only, and s.194Q''s successor number was NOT verified. When it is, close this row and add the successor rather than editing it.','2026-08-27'),

-- ── Income tax · section 194Q, the rate ─────────────────────────────────────
-- Kept as its own row rather than folded into the threshold row above, because
-- `statute_calendar` carries one `rate_percent` and one `threshold_amount` per
-- row and a rate that changes on a different date from its threshold could not
-- otherwise be expressed. That is the same reason professional tax models a
-- band as a row.
('tds.194q.rate','TDS on purchase of goods — rate on the excess over the threshold','income_tax','Income-tax Act 1961',NULL,'s.194Q','standing',NULL,NULL,NULL,NULL,0.1,NULL,NULL,'2021-07-01',NULL,TRUE,'Income-tax Act 1961, s.194Q(1), inserted by the Finance Act 2021 w.e.f. 1 July 2021','0.1% of the purchase value EXCEEDING the s.194Q threshold, not of the whole. Where the seller has furnished no PAN the higher-rate provision applies instead — see tds.higher_rate_no_pan, which migration 158 seeds in both its 1961-Act and 2025-Act versions. Nothing in this product deducts anything; the figure it prints is indicative.','2026-08-27'),

-- ── Income tax · section 194Q, the BUYER test the product cannot run ────────
-- Seeded so the figure the code names in prose is at least recorded as dated
-- law. NOTHING reads it to decide anything: Kartavaya does not hold the firm's
-- own turnover, so the applicability verdict is permanently `could_not_check`
-- and this row exists to let a screen PRINT the test, never to apply it.
('tds.194q.buyer_turnover_test','TDS on purchase of goods — buyer turnover above which the section applies at all','income_tax','Income-tax Act 1961',NULL,'s.194Q(1) Explanation','standing',NULL,NULL,NULL,NULL,NULL,100000000,NULL,'2021-07-01',NULL,TRUE,'Income-tax Act 1961, s.194Q(1) Explanation, inserted by the Finance Act 2021 w.e.f. 1 July 2021','Rs 10,00,00,000 of total sales/turnover/gross receipts in the financial year IMMEDIATELY PRECEDING the year of purchase. ⚠ THIS BASE EXCLUDES GST, whereas the tds.194q.threshold base INCLUDES it — two different bases, and swapping them is a filing error rather than a rounding one. KARTAVAYA DOES NOT HOLD THE FIRM''S OWN TURNOVER, so nothing in the product tests this row; it is recorded so a screen can state the test it cannot run. Never use it to assert that the section applies.','2026-08-27')

ON CONFLICT (obligation_key, state_code, effective_from) DO NOTHING;
