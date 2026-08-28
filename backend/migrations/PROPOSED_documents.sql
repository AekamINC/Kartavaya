-- PROPOSED_documents.sql — columns and tables the approved document set needs
-- and Kartavaya does not have.
--
-- ############################################################################
-- #  APPLIED 2026-07-27 on the owner's explicit instruction, in two           #
-- #  migrations: `documents_tan_and_challans` (sections 1-2) and              #
-- #  `documents_supply_flags_and_org_fields` (sections 3-7).                  #
-- #                                                                          #
-- #  The owner's basis: production today runs project management only, with   #
-- #  no finance or CRM in use, so these tables are unreachable from anything  #
-- #  a customer sees.                                                         #
-- #                                                                          #
-- #  Verified before and after. Every pre-existing row count UNCHANGED:       #
-- #  organisations 2, ganit_invoices 10, ganit_vendor_bills 0,                #
-- #  ganit_contracts 1. Added 12 columns and 4 tables, all four empty, and    #
-- #  0 invoices reclassified (supply_nature defaults to 'taxable').           #
-- #                                                                          #
-- #  Staging and production still SHARE one Supabase project                  #
-- #  (toacecaewujfxjfrjwco, schema `staging`). The rollback at the foot of    #
-- #  this file is live and untested — read its DATA LOSS warning first.       #
-- ############################################################################
--
-- Provenance
-- ----------
-- Every gap below was verified against the LIVE catalog
-- (information_schema.columns on the staging schema), not against the
-- migration ledger. That distinction matters here: `services/skills/data/
-- kpi_aggregator.py` and `services/skills/data/workload_calculator.py` both
-- join `staging.projects`, and `staging.projects` does not exist.
--
-- Each section names the document that needs it and the statutory or design
-- source that requires the field. Nothing is proposed "for completeness".
--
-- Sections
-- --------
--   1  organisations.tan            — TDS challan, BLOCKING
--   2  ganit_tds_challans           — TDS challan, BLOCKING
--   3  ganit_invoices supply flags  — GSTR-3B, materially incomplete without
--   4  ganit_vendor_bills.cess      — GSTR-3B
--   5  organisations MSME + scheme  — statement, service agreement, GSTR-3B
--   6  ganit_invoices quote fields  — quotation
--   7  project milestones + risks   — project report, service agreement
--
-- Ordering: sections 1 and 2 unblock the TDS challan and are the only ones the
-- 15 August delivery strictly needs. 3 to 7 improve documents that already
-- render honestly without them.


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · organisations.tan — TDS challan (BLOCKING)
-- ═══════════════════════════════════════════════════════════════════════════
-- Section 203A of the Income-tax Act 1961. The Tax Deduction Account Number is
-- the deductor's identifier on ITNS-281 and on every quarterly return that
-- quotes the challan. The PAN is not a substitute.
--
-- `staging.organisations` has gstin and pan and no tan. Until this lands,
-- `routers/documents._load_org` reads a TAN out of `organisations.settings`
-- (JSONB) so a firm can transact today, and `validate_tds_challan` refuses the
-- document outright when there is none — it does not invent one.
--
-- Format is enforced because a malformed TAN fails the portal outright and the
-- failure surfaces months later, on a rejected 26Q.

ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS tan VARCHAR(10);

-- ── REMOVED BY MIGRATION 238, 2026-08-28 ────────────────────────────────────
-- This CHECK was live (applied out of band, while this file still said it was
-- not) and it 500d the ENTIRE company-profile save whenever a customer typed a
-- TAN that did not match the shape, or cleared one — the PATCH carries every
-- column, so the name, address and bank details went with it. GSTIN/PAN/TAN
-- must block nothing (CLAUDE.md, standing). Shape is warned at entry in
-- routers/org_profile.py and ENFORCED at the point of use in
-- services/doc_validation.py, which refuses a TDS challan on a bad TAN.
-- DO NOT UNCOMMENT. See backend/migrations/238_tan_format_blocks_nothing.sql.
-- ALTER TABLE staging.organisations
--   DROP CONSTRAINT IF EXISTS organisations_tan_format;

-- ALTER TABLE staging.organisations
--   ADD CONSTRAINT organisations_tan_format
--   CHECK (tan IS NULL OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$')
--   NOT VALID;   -- NOT VALID: existing rows are all NULL, and a full-table
--                -- validation scan on a shared production table is not worth
--                -- taking for a constraint that only new writes can violate.
--                -- Run `VALIDATE CONSTRAINT` in a quiet window if wanted.

COMMENT ON COLUMN staging.organisations.tan IS
  'Tax Deduction Account Number, section 203A. Four letters, five digits, one '
  'letter. Required on ITNS-281 and on Forms 24Q/26Q/27Q.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · ganit_tds_challans — TDS challan (BLOCKING)
-- ═══════════════════════════════════════════════════════════════════════════
-- There is no challan table of any kind. `staging.pay_tds_records` records
-- per-payslip salary TDS (month, year, tax_deducted_this_month) and nothing
-- about a DEPOSIT: no BSR code, no challan serial, no tender date, no bank, no
-- major head, no type of payment.
--
-- Without this table `POST /api/v1/documents/tds/challan/{period}/pdf` must
-- take the bank's particulars in the request body every time, and no two
-- counterfoils for the same deposit can be proven identical.
--
-- The CIN is the triple (bsr_code, tender_date, challan_serial). It is unique
-- per deposit nationally, so the unique index is on the triple rather than on
-- (org_id, ...) — two orgs cannot legitimately share one CIN.

CREATE TABLE IF NOT EXISTS staging.ganit_tds_challans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
  challan_number    TEXT NOT NULL DEFAULT '',
  -- The deduction period this challan settles, as YYYY-MM. Rule 30(2) fixes
  -- the due date from it (the 7th of the following month; 30 April for March).
  period            TEXT NOT NULL,
  assessment_year   TEXT NOT NULL DEFAULT '',
  deposit_date      DATE NOT NULL,
  -- 0020 where the deductee is a company, 0021 where it is not. A property of
  -- the DEDUCTEE, so it is stated per challan and never derived from the org.
  major_head        VARCHAR(4) NOT NULL,
  -- 200 = TDS payable by taxpayer; 400 = TDS on regular assessment.
  payment_type      VARCHAR(3) NOT NULL,
  -- ── the CIN triple ──
  bsr_code          VARCHAR(7) NOT NULL,
  tender_date       DATE NOT NULL,
  challan_serial    VARCHAR(5) NOT NULL,
  bank_name         TEXT NOT NULL DEFAULT '',
  payment_method    TEXT NOT NULL DEFAULT '',
  -- ── the six ITNS-281 amount heads ──
  income_tax        NUMERIC(14,2) NOT NULL DEFAULT 0,
  surcharge         NUMERIC(14,2) NOT NULL DEFAULT 0,
  education_cess    NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_201_1a   NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty           NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_234e          NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Non-salary deduction lines: [{section, nature, count, amount_paid, rate,
  -- tds, note}]. JSONB rather than a child table because a challan's lines are
  -- never queried independently of the challan; the 192B line is derived from
  -- staging.vetana_payslips at render time and is NOT stored here.
  deductions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes             JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by        TEXT NOT NULL DEFAULT '',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ganit_tds_challans_period_format CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT ganit_tds_challans_major_head    CHECK (major_head IN ('0020','0021')),
  CONSTRAINT ganit_tds_challans_payment_type  CHECK (payment_type IN ('200','400')),
  CONSTRAINT ganit_tds_challans_bsr_format    CHECK (bsr_code ~ '^[0-9]{7}$'),
  CONSTRAINT ganit_tds_challans_serial_format CHECK (challan_serial ~ '^[0-9]{5}$')
);

-- org_id first: every read is org-scoped, which is the sole tenant path.
CREATE INDEX IF NOT EXISTS ganit_tds_challans_org_period_idx
  ON staging.ganit_tds_challans (org_id, period);

-- A CIN identifies one deposit nationally. Two rows sharing one means a
-- duplicate counterfoil, which is exactly what this document exists to catch.
CREATE UNIQUE INDEX IF NOT EXISTS ganit_tds_challans_cin_uniq
  ON staging.ganit_tds_challans (bsr_code, tender_date, challan_serial);

COMMENT ON TABLE staging.ganit_tds_challans IS
  'ITNS-281 deposits. The bank''s challan is the primary record; this is the '
  'transcription the 26Q preparer works from. See services/tds_challan_pdf.py.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · ganit_invoices supply flags — GSTR-3B
-- ═══════════════════════════════════════════════════════════════════════════
-- GSTR-3B Table 3.1 has five rows. Kartavaya can derive two of them:
--   (a) outward taxable            — derivable (subtotal + tax columns)
--   (b) outward zero-rated         — derivable (is_export)
--   (c) other outward, nil/exempt  — NO COLUMN
--   (d) inward reverse charge      — NO COLUMN
--   (e) non-GST outward supplies   — NO COLUMN
--
-- Today rows (c), (d) and (e) arrive as request-body overrides and default to
-- nil, and the paper prints them as nil rather than omitting them. That is
-- honest but it means an org with exempt supplies must retype them monthly.
--
-- `supply_nature` is a single enumerated column rather than three booleans
-- because the categories are mutually exclusive: one supply is taxable OR
-- zero-rated OR nil/exempt OR non-GST. Booleans would permit a row that claims
-- to be two at once, and Table 3.1 would then double-count it.

ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS supply_nature TEXT NOT NULL DEFAULT 'taxable';

ALTER TABLE staging.ganit_invoices
  DROP CONSTRAINT IF EXISTS ganit_invoices_supply_nature;

ALTER TABLE staging.ganit_invoices
  ADD CONSTRAINT ganit_invoices_supply_nature
  CHECK (supply_nature IN ('taxable', 'zero_rated', 'nil_rated', 'exempt', 'non_gst'))
  NOT VALID;

-- Reverse charge lives on the INWARD side, so it belongs on vendor bills.
ALTER TABLE staging.ganit_vendor_bills
  ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN staging.ganit_invoices.supply_nature IS
  'GSTR-3B Table 3.1 row this supply falls in. Mutually exclusive by '
  'construction so 3.1 cannot double-count.';
COMMENT ON COLUMN staging.ganit_vendor_bills.is_reverse_charge IS
  'GSTR-3B 3.1(d) and 4(A)(3). Reverse-charge liability must be paid in CASH '
  '(section 49(4), rule 85(4)) and the credit taken separately.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · ganit_vendor_bills.cess — GSTR-3B
-- ═══════════════════════════════════════════════════════════════════════════
-- `ganit_invoices` has a `cess` column; `ganit_vendor_bills` does not. So the
-- outward cess in Table 3.1 is real and the inward cess credit in Table 4 is
-- always nil, which understates credit for anyone dealing in cess goods.
--
-- Table 4 was rebuilt onto the NOTIFIED form (Notification 14/2022-CT) and
-- gained five rows: 4(A)(2) import of services, 4(A)(4) ISD credit, 4(B)(2)
-- other reversals, 4(D)(1) ITC reclaimed and 4(D)(2) ineligible under section
-- 16(4)/PoS. NONE of them proposes a column here, and that is a decision
-- rather than an omission:
--
--   * 4(A)(2) and 4(A)(4) would need an import/ISD classification on
--     `ganit_vendor_bills`, which has neither, and inventing one would mean
--     guessing at the classification for every bill already recorded.
--   * 4(B)(2), 4(D)(1) and 4(D)(2) are figures a preparer ASCERTAINS — rule 37
--     reversals, reclaims, and section 16(4)/place-of-supply ineligibility that
--     comes from GSTR-2B rather than from anything Kartavaya holds. A column
--     would not populate itself; it would only move the typing.
--
-- All five therefore arrive as request-body overrides on `Gstr3bOverrides`,
-- default to nil, and print as nil on the face of the paper — the same
-- treatment the three earlier override rows already get. If a firm later
-- records vendor bills with a supply classification, 4(A)(2) and 4(A)(4)
-- become derivable and belong in this section.

ALTER TABLE staging.ganit_vendor_bills
  ADD COLUMN IF NOT EXISTS cess NUMERIC(14,2) NOT NULL DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · organisations — MSME registration and GST filing scheme
-- ═══════════════════════════════════════════════════════════════════════════
-- Two claims the documents currently cannot make truthfully from stored data.
--
-- MSME: the statement of account prints a section 43B(h) notice and the service
-- agreement prints a section 15/16 MSMED interest clause. Both are assertions
-- about the ISSUER'S OWN registration, made on a document that lands in a
-- buyer's tax file. Asserting one falsely is a misrepresentation, so both
-- render only when this column says so — and today the caller must pass a flag.
--
-- Filing scheme: the GSTR-3B due date shown is the monthly filer's, the 20th of
-- the following month. A QRMP filer's date is the 22nd or the 24th depending on
-- the State group. The validator raises an advisory declaring the assumption;
-- this column would remove the guess.

ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS msme_registered BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS msme_udyam_number TEXT;

ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS gst_filing_scheme TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE staging.organisations
  DROP CONSTRAINT IF EXISTS organisations_gst_filing_scheme;

ALTER TABLE staging.organisations
  ADD CONSTRAINT organisations_gst_filing_scheme
  CHECK (gst_filing_scheme IN ('monthly', 'qrmp')) NOT VALID;

-- brand.css: "the staging /v1/org/profile schema has no colour field yet …
-- Until it does, accent falls back to Kartavaya teal." `doc_render.accent()`
-- already reads an `accent` key off the org dict, so this column is all that is
-- needed for per-tenant document branding.
ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS brand_accent VARCHAR(7);

ALTER TABLE staging.organisations
  DROP CONSTRAINT IF EXISTS organisations_brand_accent_hex;

ALTER TABLE staging.organisations
  ADD CONSTRAINT organisations_brand_accent_hex
  CHECK (brand_accent IS NULL OR brand_accent ~ '^#[0-9A-Fa-f]{6}$') NOT VALID;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · ganit_invoices — quotation fields
-- ═══════════════════════════════════════════════════════════════════════════
-- `docs/Quotation.html` prints a "Prepared by", a scope summary, numbered terms
-- and a three-tranche payment schedule. The route currently borrows `notes` for
-- the reference and `terms` for the scope summary, and leaves the schedule and
-- the numbered terms empty with an advisory naming each.
--
-- `valid_until` is deliberately NOT proposed: `due_date` already carries it and
-- a second date column would let the two disagree.

ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS prepared_by TEXT NOT NULL DEFAULT '';

ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS scope_summary TEXT NOT NULL DEFAULT '';

-- [{label, amount, due}] — ordered tranches.
ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS payment_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ["…", "…"] — the numbered terms, in order.
ALTER TABLE staging.ganit_invoices
  ADD COLUMN IF NOT EXISTS quote_terms JSONB NOT NULL DEFAULT '[]'::jsonb;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · Milestones and risks — project report and service agreement
-- ═══════════════════════════════════════════════════════════════════════════
-- The project report's three central tables — "Position at a glance",
-- "Milestones", "Risks and what is being done" — have no backing store, and the
-- service agreement's clause 3 milestone schedule has none either. The report
-- currently renders an explicit empty state saying so, which is honest and not
-- useful.
--
-- Keyed on `board_id TEXT` (public.boards) because that is the project concept
-- that exists. There is NO `staging.projects` table, whatever
-- services/skills/data/*.py believes.

CREATE TABLE IF NOT EXISTS staging.project_milestones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
  board_id      TEXT NOT NULL,
  -- Set when the milestone is also a payment trigger in a service agreement.
  contract_id   UUID REFERENCES staging.ganit_contracts(id) ON DELETE SET NULL,
  seq           INTEGER NOT NULL DEFAULT 1,
  title         TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  target_date   DATE,
  forecast_date DATE,
  -- The BASELINE. Without it every variance in the report is actual-only, and
  -- a plan of zero would show every project as infinitely over.
  baseline_date DATE,
  share_pct     NUMERIC(5,2) NOT NULL DEFAULT 0,
  fee           NUMERIC(14,2) NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'not_started',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT project_milestones_state CHECK (
    state IN ('not_started','in_progress','slipping','blocked','done','signed')
  ),
  CONSTRAINT project_milestones_share CHECK (share_pct >= 0 AND share_pct <= 100)
);

CREATE INDEX IF NOT EXISTS project_milestones_org_board_idx
  ON staging.project_milestones (org_id, board_id, seq);

CREATE TABLE IF NOT EXISTS staging.project_risks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
  board_id     TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'low',
  risk         TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  mitigation   TEXT NOT NULL DEFAULT '',
  owner        TEXT NOT NULL DEFAULT '',
  is_open      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT project_risks_severity CHECK (severity IN ('low','med','high'))
);

CREATE INDEX IF NOT EXISTS project_risks_org_board_idx
  ON staging.project_risks (org_id, board_id) WHERE is_open;

-- The plan side of the numeric measures. One row per board per measure.
CREATE TABLE IF NOT EXISTS staging.project_baselines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
  board_id    TEXT NOT NULL,
  measure     TEXT NOT NULL,          -- 'hours' | 'fee' | 'open_tasks' | …
  planned     NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT project_baselines_uniq UNIQUE (org_id, board_id, measure)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in this order. Reversing every statement above exactly.
--
-- DATA LOSS WARNING. Dropping a column drops its data irrecoverably, and
-- staging and production are the SAME database. Before running any of this,
-- confirm the columns are still empty:
--
--   SELECT count(*) FROM staging.organisations WHERE tan IS NOT NULL;
--   SELECT count(*) FROM staging.ganit_tds_challans;
--   SELECT count(*) FROM staging.ganit_invoices WHERE supply_nature <> 'taxable';
--   SELECT count(*) FROM staging.project_milestones;
--   SELECT count(*) FROM staging.project_risks;
--
-- A non-zero count on any of these means a real firm has entered real data.
-- Dropping a `tan` or a challan row destroys a statutory record; take a
-- targeted backup of the affected table first.
--
-- The `IF EXISTS` clauses make the script idempotent, NOT safe. They stop it
-- erroring on a partial apply; they do not stop it deleting data.
--
-- BEGIN;
--   DROP TABLE IF EXISTS staging.project_baselines;
--   DROP TABLE IF EXISTS staging.project_risks;
--   DROP TABLE IF EXISTS staging.project_milestones;
--
--   ALTER TABLE staging.ganit_invoices
--     DROP COLUMN IF EXISTS quote_terms,
--     DROP COLUMN IF EXISTS payment_schedule,
--     DROP COLUMN IF EXISTS scope_summary,
--     DROP COLUMN IF EXISTS prepared_by;
--
--   ALTER TABLE staging.organisations
--     DROP CONSTRAINT IF EXISTS organisations_brand_accent_hex,
--     DROP CONSTRAINT IF EXISTS organisations_gst_filing_scheme;
--   ALTER TABLE staging.organisations
--     DROP COLUMN IF EXISTS brand_accent,
--     DROP COLUMN IF EXISTS gst_filing_scheme,
--     DROP COLUMN IF EXISTS msme_udyam_number,
--     DROP COLUMN IF EXISTS msme_registered;
--
--   ALTER TABLE staging.ganit_vendor_bills
--     DROP COLUMN IF EXISTS cess,
--     DROP COLUMN IF EXISTS is_reverse_charge;
--
--   ALTER TABLE staging.ganit_invoices
--     DROP CONSTRAINT IF EXISTS ganit_invoices_supply_nature;
--   ALTER TABLE staging.ganit_invoices
--     DROP COLUMN IF EXISTS supply_nature;
--
--   DROP TABLE IF EXISTS staging.ganit_tds_challans;
--
--   ALTER TABLE staging.organisations
--     DROP CONSTRAINT IF EXISTS organisations_tan_format;
--   ALTER TABLE staging.organisations
--     DROP COLUMN IF EXISTS tan;
-- COMMIT;
--
-- Note on section 1: `routers/documents._load_org` reads a TAN out of
-- `organisations.settings` when the column is absent. That fallback is written
-- so it keeps working either way — it only fires when `settings->>'tan'` is
-- set — so rolling section 1 back does not break the TDS route. It reverts to
-- refusing, which is the documented behaviour.
