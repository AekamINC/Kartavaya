-- 170_statute_gst_year_and_advance_tax.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.statute_calendar   +13 rows. Reference data only.
--
-- No schema change, no other table read or written, no template touched,
-- nothing armed. `statute_calendar` is org-independent — the same rows for
-- every tenant — so this adds no tenant data and changes no tenant's records.
-- Re-running inserts nothing (ON CONFLICT DO NOTHING on the natural key).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Catalogue entries #19–#22 each print a statutory date, form or threshold, and
-- `services/statute.py` is the only way anything in this product is allowed to
-- learn one. Its whole reason for existing is that a statutory fact is never a
-- constant: Form 24Q became 138 on 1 April 2026 and the 12% and 28% GST slabs
-- stopped existing on 22 September 2025. A handler that hardcodes "31 December"
-- or "₹5 crore" is the defect that module was written to remove.
--
-- The calendar carries 28 rows and NONE of them cover the annual return, the
-- LUT, the registration thresholds or advance tax. So the handlers cannot be
-- written until these exist. This is the seed; the handlers follow.
--
-- ── THE DISCIPLINE, WHICH IS 158'S AND NOT MINE ──────────────────────────────
--
-- 158 seeds `('tds.certificate.salary', … '130', NULL, 'annual', NULL, NULL …)`
-- with the note "Section and due date are NULL because neither was verified —
-- only the form number was. Do not assume 15 June carried across."
--
-- That is the rule this file follows. Every row below carries a `source_ref`
-- naming the provision it comes from and a `verified_on`. WHERE A FIELD IS NOT
-- VERIFIED IT IS NULL, NOT GUESSED — `services/statute.py` and the handlers
-- above it are all built to say "the catalogue records no due date" rather than
-- print one from memory, and a plausible wrong number here would defeat every
-- one of them at once.
--
-- ⚠ OWNER: THESE ARE STATUTORY ASSERTIONS IN A PRODUCT USED BY TAX
-- PROFESSIONALS. They are seeded so the skills can be built and are inert until
-- a skill that reads them is armed — and nothing is armed. Read the `notes`
-- column on each row before arming anything that prints one.
--
-- ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
--
--   · No Income-tax Act 2025 section numbers for advance tax. 158's precedent:
--     the renumbering is real and the specific new numbers were not verified,
--     so the 1961 sections are recorded with an effective_to of 2026-04-01 and
--     NO successor row. A handler asking as-of a 2026-27 date gets nothing and
--     must say so, which is correct — better a stated gap than a wrong section.
--   · No state-wise GST registration thresholds beyond the special-category
--     distinction. The special-category list itself has changed and is not
--     verified per state, so `state_code` stays NULL and the note carries the
--     caveat. Catalogue #21 is required to print that limitation.
--   · No professional tax. PT is a state levy with roughly 20 different regimes
--     and the existing slab table covers three; catalogue #27 names it as a
--     seed-data job and it is not this file's.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- One INSERT of 13 rows into a 28-row reference table. ROW EXCLUSIVE, no ALTER,
-- nothing scanned. `SET LOCAL lock_timeout` is absent because there is nothing
-- to queue behind; the BEGIN is for atomicity.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.statute_calendar
--    WHERE obligation_key IN ('gst.lut.rfd11','gst.return.gstr9','gst.return.gstr9c',
--          'gst.registration.threshold.goods','gst.registration.threshold.services',
--          'gst.einvoice.threshold','gst.qrmp.threshold','gst.composition.threshold',
--          'incometax.advance_tax.q1','incometax.advance_tax.q2',
--          'incometax.advance_tax.q3','incometax.advance_tax.q4',
--          'incometax.advance_tax.presumptive');

BEGIN;

INSERT INTO staging.statute_calendar (
    obligation_key, title, authority, statute, form_number, section_ref,
    periodicity, due_day, due_month, due_month_offset, window_days,
    rate_percent, threshold_amount, state_code,
    effective_from, effective_to, effective_from_exact,
    source_ref, notes, verified_on
) VALUES

-- ── GST · the letter of undertaking ─────────────────────────────────────────
-- Catalogue #19. An LUT is furnished FOR a financial year and does not carry
-- across, so one filed for 2025-26 stops covering exports on 1 April 2026.
-- due_day/due_month are 31 March: the last day the outgoing LUT is good for.
('gst.lut.rfd11','Letter of Undertaking for export without payment of IGST','gst','CGST Rules 2017','RFD-11','rule 96A','annual',31,3,NULL,NULL,NULL,NULL,NULL,'2017-07-01',NULL,FALSE,'CGST Rules 2017, rule 96A','Furnished for a financial year; a fresh LUT is required for each year, so cover lapses on 1 April whatever the previous one said. NOTHING IN THIS PRODUCT RECORDS THAT AN LUT WAS FILED — a skill reading this row may say "you export and it expires", never "you are covered until X".','2026-08-20'),

-- ── GST · the annual return ─────────────────────────────────────────────────
-- Catalogue #20. threshold_amount is the point BELOW which GSTR-9 is optional.
('gst.return.gstr9','Annual return','gst','CGST Act 2017','GSTR-9','s.44','annual',31,12,NULL,NULL,NULL,20000000,NULL,'2017-07-01',NULL,FALSE,'CGST Act 2017, s.44 read with rule 80','Due 31 December following the financial year. threshold_amount is ₹2 crore, the aggregate turnover at or below which filing has been made optional by successive exemption notifications — it is an EXEMPTION FLOOR, not a liability. AGGREGATE TURNOVER IS PAN-LEVEL across every registration; this product sees one org, so any turnover it computes is a floor.','2026-08-20'),
('gst.return.gstr9c','Self-certified reconciliation statement','gst','CGST Act 2017','GSTR-9C','s.44','annual',31,12,NULL,NULL,NULL,50000000,NULL,'2021-08-01',NULL,FALSE,'CGST Act 2017, s.44 as substituted by the Finance Act 2021, read with rule 80(3)','Required where aggregate turnover exceeds ₹5 crore, filed with the annual return. Self-certified since FY 2020-21 — the audit by a chartered accountant was removed, and any wording calling this a GST audit is out of date.','2026-08-20'),

-- ── GST · the thresholds that change what you must do ───────────────────────
-- Catalogue #21. Each is a threshold_amount with no due date, which is why
-- periodicity is 'standing'.
('gst.registration.threshold.goods','Registration threshold — exclusive supply of goods','gst','CGST Act 2017',NULL,'s.22','standing',NULL,NULL,NULL,NULL,NULL,4000000,NULL,'2019-04-01',NULL,FALSE,'CGST Act 2017, s.22(1) read with Notification 10/2019-Central Tax','₹40 lakh, for a supplier engaged exclusively in the supply of GOODS in a normal-category state. SPECIAL CATEGORY STATES ARE LOWER and this row does not carry them: the special-category list has itself changed and was not verified per state, so state_code is NULL. Any skill printing this must say which state it did NOT check.','2026-08-20'),
('gst.registration.threshold.services','Registration threshold — services','gst','CGST Act 2017',NULL,'s.22','standing',NULL,NULL,NULL,NULL,NULL,2000000,NULL,'2017-07-01',NULL,FALSE,'CGST Act 2017, s.22(1)','₹20 lakh where any services are supplied. A supplier of both goods and services falls here, not on the ₹40 lakh goods row — the higher figure is for EXCLUSIVE supply of goods. Special-category states are lower; see the goods row.','2026-08-20'),
('gst.einvoice.threshold','E-invoicing applicability','gst','CGST Rules 2017',NULL,'rule 48(4)','standing',NULL,NULL,NULL,NULL,NULL,50000000,NULL,'2023-08-01',NULL,TRUE,'Notification 10/2023-Central Tax, in force 1 August 2023','₹5 crore aggregate annual turnover in ANY financial year from 2017-18 onwards — once you cross it you stay in, so a skill testing only the current year understates. B2B and export documents only.','2026-08-20'),
('gst.qrmp.threshold','Quarterly return, monthly payment — eligibility ceiling','gst','CGST Act 2017',NULL,'s.39(1) proviso','standing',NULL,NULL,NULL,NULL,NULL,50000000,NULL,'2021-01-01',NULL,FALSE,'Notification 84/2020-Central Tax','Aggregate turnover up to ₹5 crore in the preceding financial year. A CEILING, not a floor: crossing it removes the option and moves the taxpayer to monthly returns, which changes every GSTR-1 due date the product prints.','2026-08-20'),
('gst.composition.threshold','Composition levy — eligibility ceiling','gst','CGST Act 2017',NULL,'s.10','standing',NULL,NULL,NULL,NULL,NULL,15000000,NULL,'2019-04-01',NULL,FALSE,'CGST Act 2017, s.10(1) read with Notification 14/2019-Central Tax','₹1.5 crore in a normal-category state. Special-category states are lower and are not carried here; the separate ₹50 lakh services composition under s.10(2A) is a different scheme and is not this row.','2026-08-20'),

-- ── Income tax · advance tax ────────────────────────────────────────────────
-- Catalogue #22. Four instalments, each its own row, because the CUMULATIVE
-- percentage differs per instalment and a single row cannot carry four.
--
-- NO SUCCESSOR ROWS FOR THE 2025 ACT. 158's rule: the renumbering is real and
-- these specific new section numbers were not verified, so each row ends
-- 2026-04-01 and nothing follows it. A handler asking as-of a later date gets
-- NOTHING and must say the catalogue records no rule — which is correct, and
-- far better than a plausible wrong section in front of a CA.
('incometax.advance_tax.q1','Advance tax — first instalment','income_tax','Income-tax Act 1961',NULL,'s.211','annual',15,6,NULL,NULL,15.000,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Act 1961, s.211(1)','rate_percent is the CUMULATIVE percentage of the estimated liability payable by this date, not an instalment share. 15% by 15 June.','2026-08-20'),
('incometax.advance_tax.q2','Advance tax — second instalment','income_tax','Income-tax Act 1961',NULL,'s.211','annual',15,9,NULL,NULL,45.000,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Act 1961, s.211(1)','Cumulative 45% by 15 September — so 30% more, not 45% more.','2026-08-20'),
('incometax.advance_tax.q3','Advance tax — third instalment','income_tax','Income-tax Act 1961',NULL,'s.211','annual',15,12,NULL,NULL,75.000,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Act 1961, s.211(1)','Cumulative 75% by 15 December.','2026-08-20'),
('incometax.advance_tax.q4','Advance tax — fourth instalment','income_tax','Income-tax Act 1961',NULL,'s.211','annual',15,3,NULL,NULL,100.000,NULL,NULL,'1962-04-01','2026-04-01',FALSE,'Income-tax Act 1961, s.211(1)','Cumulative 100% by 15 March. Tax paid after 15 March but on or before 31 March is still treated as advance tax for the year.','2026-08-20'),
('incometax.advance_tax.presumptive','Advance tax — presumptive scheme, single instalment','income_tax','Income-tax Act 1961',NULL,'s.211(1)(b)','annual',15,3,NULL,NULL,100.000,NULL,NULL,'2016-04-01','2026-04-01',FALSE,'Income-tax Act 1961, s.211(1)(b)','An assessee under the presumptive scheme pays the WHOLE amount by 15 March in one instalment. A skill that shows four instalments to a presumptive assessee is showing three deadlines that do not exist — and NOTHING IN THIS PRODUCT RECORDS WHICH SCHEME AN ORG IS ON, so it must present both and let the reader pick.','2026-08-20')

-- Named, not bare. `statute_calendar_version_uniq` is
-- `UNIQUE NULLS NOT DISTINCT (obligation_key, state_code, effective_from)`, and
-- NULLS NOT DISTINCT is what makes the all-India rows — whose state_code is
-- NULL — actually collide with themselves on a re-run. A bare `ON CONFLICT DO
-- NOTHING` would also swallow a collision on any OTHER constraint, including a
-- CHECK violation dressed up as idempotency. 158 names it for the same reason.
ON CONFLICT ON CONSTRAINT statute_calendar_version_uniq DO NOTHING;

DO $verify$
DECLARE n int; missing text;
BEGIN
    SELECT count(*) INTO n FROM staging.statute_calendar;
    IF n <> 41 THEN
        RAISE EXCEPTION 'VERIFY 1: expected 41 statute rows (28 + 13), found %.', n;
    END IF;

    -- Every key the handlers are about to read must resolve.
    SELECT string_agg(k, ', ') INTO missing FROM (
        SELECT unnest(ARRAY[
            'gst.lut.rfd11','gst.return.gstr9','gst.return.gstr9c',
            'gst.registration.threshold.goods','gst.registration.threshold.services',
            'gst.einvoice.threshold','gst.qrmp.threshold','gst.composition.threshold',
            'incometax.advance_tax.q1','incometax.advance_tax.q2',
            'incometax.advance_tax.q3','incometax.advance_tax.q4',
            'incometax.advance_tax.presumptive']) AS k
        EXCEPT SELECT obligation_key FROM staging.statute_calendar
    ) q;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: keys did not land: %', missing;
    END IF;

    -- Every new row must cite a source and a verification date. A statutory
    -- assertion with neither is exactly what this table was built to stop.
    IF EXISTS (
        SELECT 1 FROM staging.statute_calendar
         WHERE verified_on = '2026-08-20'
           AND (source_ref IS NULL OR btrim(source_ref) = ''
                OR notes IS NULL OR btrim(notes) = '')
    ) THEN
        RAISE EXCEPTION 'VERIFY 3: a row seeded today carries no source_ref or no note.';
    END IF;

    RAISE NOTICE '170 · statute calendar is % rows; the year-end and advance-tax '
                 'facts #19-#22 need are now readable through services/statute.py.', n;
END
$verify$;

COMMIT;
