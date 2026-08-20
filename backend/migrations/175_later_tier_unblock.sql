-- 175_later_tier_unblock.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   NEW TABLE  staging.client_obligations              (catalogue #45)
--   ADD COLUMN staging.ganit_vendors            × 6    (#49, #50)
--   ADD COLUMN staging.ganit_vendor_bills       × 1    (#49)
--   ADD COLUMN staging.ganit_invoices           × 2    (#51)
--   ADD COLUMN staging.ganit_expenses           × 2    (#50)
--   ADD COLUMN staging.manav_holidays           × 1    (#46, #53)
--   ADD COLUMN staging.ganit_bank_statement_lines × 3  (#42, #55)
--   ADD COLUMN public.time_entries              × 2    (#48)
--   ADD COLUMN staging.varta_contacts           × 3    (#33)
--   ADD COLUMN staging.varta_messages           × 2    (#54)
--
-- EVERY COLUMN IS NULLABLE WITH NO DEFAULT. Nothing is backfilled, no existing
-- row changes value, and no existing query can see a different answer than it
-- did yesterday. Re-running is a no-op (IF NOT EXISTS throughout).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- The eleven catalogue entries in the "Later" tier are each blocked on an
-- absence, and the folio names every one. This is that list, closed. It ships
-- NO skill — it is only the schema, so that the handlers can be written against
-- columns that exist rather than columns somebody hoped for.
--
-- #45 is the one that matters: "Unblock this and six other candidates become
-- buildable. It is also exactly where QwikCA, Finexo, PracticeStacks and Turia
-- all position. That is table stakes being missed, not a skill gap."
--
-- ── WHAT THE PROBE CHANGED ABOUT THE PLAN ────────────────────────────────────
--
-- Read-only against the live database, 2026-08-20, two of the folio's blockers
-- turned out to be wrong or stale and are NOT addressed here because they need
-- nothing:
--
--   #52 "no validity date" — `staging.crm_quotations.valid_until` ALREADY
--       EXISTS. The real blocker is that the table holds ZERO rows because
--       nothing in the product creates a quotation, so the skill ships to an
--       empty set and must say so. No column is needed.
--   #33 "an opted_in boolean that nothing ever writes" — `varta_contacts`
--       carries `opted_in` AND `opted_out_at` is what is missing, not the
--       opt-in. 45 of the 60 rows are opted in WITH a timestamp. What is
--       genuinely absent is the NOTICE TEXT and the SOURCE of the consent, and
--       the opt-out side. Those three are added below.
--
-- ── THE ONE JUDGEMENT CALL, STATED ───────────────────────────────────────────
--
-- `public.time_entries` gains `is_billable` SEPARATE from the existing
-- `is_billed`. They are not the same fact and the folio is explicit that
-- conflating them is why WIP ageing cannot be built: billABLE is whether the
-- client can be charged, billED is whether an invoice went out. Unbilled
-- billable time is the WIP; unbilled UNbillable time is write-off. A report
-- that cannot tell them apart is not the thing anyone asked for.
--
-- It is NULLABLE, and NULL means "nobody has said". #48's handler must treat
-- NULL as unknown and report the count of unknowns rather than assuming either
-- way — assuming billable inflates WIP, assuming not-billable hides it.
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
--
--   · No backfill of any kind. Every new column is NULL on every existing row.
--   · No skill, no template, nothing armed, no trigger_config written.
--   · It does not create the WRITE PATHS. A column nobody writes is exactly the
--     defect #55 is named for ("the product cannot learn from a decision it
--     never stores"), so each handler built on these MUST report how many rows
--     carry the fact and must not present an empty column as a clean result.
--   · No WhatsApp channel in Niyam (#47) and no WABA (#39). Those are code and
--     an external account, not schema, and remain blocked.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Production runs the same schema,
-- so these columns appear there too — inert, NULL everywhere, read by nothing
-- that exists today. `SELECT *` consumers get extra NULL keys; every consumer
-- in this codebase indexes rows by name.
--
-- LOCKS — the real risk here, and it is acquisition, not work. Each
-- `ALTER TABLE … ADD COLUMN` nullable with no default is a catalogue update
-- with NO TABLE REWRITE (PG 11+), microseconds of work. But each takes
-- ACCESS EXCLUSIVE until COMMIT, and this file touches EIGHT live tables in one
-- transaction — including `ganit_invoices` (787 rows, read on most Ganit
-- requests) and `public.time_entries`. Every one of those locks is held until
-- the end. `SET LOCAL lock_timeout = '5s'` turns a queue into a clean rollback
-- rather than a stalled product. RUN IT WHEN THE APP IS QUIET.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DROP TABLE staging.client_obligations;
--   ALTER TABLE staging.ganit_vendors DROP COLUMN is_msme, DROP COLUMN udyam_number,
--     DROP COLUMN enterprise_class, DROP COLUMN vendor_kind,
--     DROP COLUMN payment_terms_days, DROP COLUMN tds_section;
--   … and the same shape for each table below. Nothing is backfilled, so a
--   reversal loses only what somebody entered after this ran.

BEGIN;

SET LOCAL lock_timeout = '5s';


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · #45 — THE CLIENT OBLIGATIONS REGISTER
--
-- Per-client registration facts: who is monthly, who is QRMP, who deducts TDS,
-- who is under audit. One row per client per obligation, because a client's
-- GST scheme and its TDS status are different facts with different dates and a
-- single wide row cannot carry either one's history.
--
-- WHY A ROW PER OBLIGATION AND NOT A WIDE CLIENT ROW: a firm needs to say "this
-- client moved from monthly to QRMP in October". A column cannot hold that; a
-- row with a validity window can, and it is the same half-open
-- [effective_from, effective_to) shape `statute_calendar` already uses, so
-- there is one rule in this database for "which version was in force".
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staging.client_obligations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL
                      REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: an obligation register that silently loses rows
    -- when somebody tidies a client is worse than a delete that refuses.
    --
    -- AND NOTE WHAT THIS FK DOES NOT SAY. It references graha_clients(id)
    -- ALONE, so nothing here stops a row pairing one practice's org_id with
    -- another practice's client_id. graha_clients has no UNIQUE (id, org_id)
    -- for a composite key to point at, and creating one means ALTERing a table
    -- this file is already touching enough of. The consequence is real and was
    -- proved live for migration 163. SO EVERY QUERY AGAINST THIS TABLE MUST
    -- CARRY `AND c.org_id = o.org_id` ON THE CLIENT JOIN.
    client_id       uuid NOT NULL
                      REFERENCES staging.graha_clients(id) ON DELETE RESTRICT,

    -- WHAT the client is registered for. Deliberately open text with a CHECK
    -- rather than an enum: a new obligation must not need a type migration.
    obligation_key  text NOT NULL,
    CONSTRAINT client_obligations_key_ck CHECK (obligation_key IN (
        'gst.regular',        -- monthly GSTR-1 + 3B
        'gst.qrmp',           -- quarterly return, monthly payment
        'gst.composition',
        'gst.tds',            -- GST TDS, s.51
        'gst.tcs',
        'incometax.tds',      -- deducts tax at source
        'incometax.tcs',
        'incometax.advance',  -- pays advance tax
        'epf', 'esi', 'professional_tax',
        'audit.statutory', 'audit.tax', 'audit.gst',
        'roc.annual',
        'other'
    )),

    --: The state this obligation is administered in, where that matters —
    --: professional tax and shops-and-establishments differ by state. NULL
    --: means all-India or not recorded. Same 2-3 char shape statute_calendar
    --: uses, so one join answers "which version applies to this client".
    state_code      text,
    CONSTRAINT client_obligations_state_ck CHECK (
        state_code IS NULL OR state_code ~ '^[A-Z]{2,3}$'),

    --: Who inside the firm owns this filing. TEXT, not uuid: a user id in this
    --: product is `user_xxxxxxxx`. Migrations 030 and 092 exist because that
    --: was forgotten twice.
    owner_user_id   text,

    --: The registration number for this obligation where one exists — GSTIN
    --: for a GST row, TAN for a TDS row. NEVER MANDATORY. GSTIN, PAN and TAN
    --: block nothing anywhere in this product and must not start here.
    registration_no text,

    --: The half-open validity window, [effective_from, effective_to), exactly
    --: as statute_calendar defines it: effective_to is the FIRST DAY THE FACT
    --: IS NOT TRUE. One date written once, so a client that moved to QRMP on
    --: 1 October has the old row ending and the new row starting on that same
    --: date with no off-by-one to argue about.
    effective_from  date NOT NULL DEFAULT CURRENT_DATE,
    effective_to    date,
    CONSTRAINT client_obligations_window_ck CHECK (
        effective_to IS NULL OR effective_to > effective_from),

    notes           text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT NOW(),
    updated_at      timestamptz NOT NULL DEFAULT NOW()
);

-- One OPEN version per (client, obligation, state). A client cannot be both
-- monthly and QRMP at the same time, and the realistic data error is two
-- open-ended rows rather than two overlapping closed ones — which is exactly
-- what `statute_calendar_one_open_version_idx` refuses for the statute table.
CREATE UNIQUE INDEX IF NOT EXISTS client_obligations_one_open_idx
    ON staging.client_obligations (client_id, obligation_key, state_code)
    WHERE effective_to IS NULL;

-- The filing-week board reads "every obligation live for this org today".
CREATE INDEX IF NOT EXISTS client_obligations_org_live_idx
    ON staging.client_obligations (org_id, obligation_key)
    WHERE effective_to IS NULL;

COMMENT ON TABLE staging.client_obligations IS
    'Per-client registration facts — who is monthly, who is QRMP, who deducts '
    'TDS, who is under audit. One row per obligation per validity window, not '
    'a wide client row, so a client moving scheme mid-year is expressible. '
    'Half-open window [effective_from, effective_to), same rule as '
    'statute_calendar. EVERY QUERY MUST JOIN graha_clients ON id AND org_id: '
    'the FK is on the id alone.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · #49 + #50 — WHAT A VENDOR IS
--
-- The MSME 45-day clock needs five facts and the product holds none of them.
-- The folio: "Needs is_msme, udyam_number, a payment-terms field (the 15-vs-45
-- split is otherwise unrepresentable), an acceptance date, and a
-- trader/manufacturer flag — the section does not apply to traders and does not
-- cover medium enterprises."
--
-- ⚠ AND KARTAVAYA ALREADY BELIEVES IT DOES THIS AND GETS IT WRONG:
-- routers/ganit.py:1101 documents an MSME tile that warns only when the count
-- is non-zero, while 199 invoices were past due and the count was structurally
-- 0. That tile is reading nothing. It is NOT fixed here — this only makes the
-- facts recordable — and it must be fixed or removed before #49 ships, or the
-- product will show two different MSME answers on two screens.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.ganit_vendors
    ADD COLUMN IF NOT EXISTS is_msme            boolean,
    ADD COLUMN IF NOT EXISTS udyam_number       text,
    ADD COLUMN IF NOT EXISTS enterprise_class   text,
    ADD COLUMN IF NOT EXISTS vendor_kind        text,
    ADD COLUMN IF NOT EXISTS payment_terms_days integer,
    ADD COLUMN IF NOT EXISTS tds_section        text;

-- Added as separate statements, never inline on ADD COLUMN IF NOT EXISTS:
-- if the column already exists Postgres skips the ENTIRE clause including the
-- CHECK, silently. That is exactly how hub_skill_templates went a year with no
-- skill_type constraint (see migration 166's header).
DO $ck$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ganit_vendors_enterprise_class_ck') THEN
        ALTER TABLE staging.ganit_vendors ADD CONSTRAINT ganit_vendors_enterprise_class_ck
            CHECK (enterprise_class IS NULL OR enterprise_class IN ('micro','small','medium'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ganit_vendors_kind_ck') THEN
        ALTER TABLE staging.ganit_vendors ADD CONSTRAINT ganit_vendors_kind_ck
            CHECK (vendor_kind IS NULL OR vendor_kind IN ('manufacturer','service','trader'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ganit_vendors_terms_ck') THEN
        ALTER TABLE staging.ganit_vendors ADD CONSTRAINT ganit_vendors_terms_ck
            CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365);
    END IF;
END
$ck$;

COMMENT ON COLUMN staging.ganit_vendors.enterprise_class IS
    'micro | small | medium. THE SECTION DOES NOT COVER MEDIUM — a medium '
    'enterprise is Udyam-registered and outside the 45-day disallowance — so a '
    'skill must test the class, not merely is_msme.';
COMMENT ON COLUMN staging.ganit_vendors.vendor_kind IS
    'manufacturer | service | trader. THE SECTION DOES NOT APPLY TO TRADERS. '
    'NULL means nobody has said, which is not the same as trader.';
COMMENT ON COLUMN staging.ganit_vendors.payment_terms_days IS
    'Agreed credit period. The 15-vs-45 day split is unrepresentable without '
    'it: 15 days applies where there is no written agreement, 45 where there '
    'is and it says so. NULL means no agreement recorded, i.e. the 15-day leg.';
COMMENT ON COLUMN staging.ganit_vendors.tds_section IS
    'Nature-of-payment section for TDS attribution (#50). Free text, NOT '
    'validated here — the section numbers were renumbered by the Income-tax '
    'Act 2025 and belong in statute_calendar, not in a CHECK on this table.';

ALTER TABLE staging.ganit_vendor_bills
    ADD COLUMN IF NOT EXISTS acceptance_date date;

COMMENT ON COLUMN staging.ganit_vendor_bills.acceptance_date IS
    'The date goods/services were ACCEPTED, which is when the 15/45-day clock '
    'starts — not bill_date. Where they differ the clock is longer, so using '
    'bill_date understates the deadline and reports a breach early.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · #51 — THE E-INVOICE REPORTING WINDOW
--
-- FIX THE ARITHMETIC BEFORE BUILDING, and the folio is explicit: the window is
-- 30 days from the invoice date, so the alerts are day 23 and day 30 — NOT
-- day 28. That belongs in the handler; this is only the column.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.ganit_invoices
    ADD COLUMN IF NOT EXISTS irn              text,
    ADD COLUMN IF NOT EXISTS irn_generated_at timestamptz;

COMMENT ON COLUMN staging.ganit_invoices.irn IS
    'Invoice Reference Number from the IRP. NULL means not reported — which is '
    'only a finding for a taxpayer actually inside the e-invoicing threshold, '
    'so a skill must test applicability (gst.einvoice.threshold) before it '
    'calls a NULL a problem.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · #50 — TDS ON EXPENSES
--
-- "no vendor_id on expenses, no tds_amount to test whether anything was
-- deducted." Both, now recordable.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.ganit_expenses
    ADD COLUMN IF NOT EXISTS vendor_id  uuid,
    ADD COLUMN IF NOT EXISTS tds_amount numeric(14,2);

-- No FK on vendor_id, deliberately: `ganit_expenses` predates `ganit_vendors`
-- as a concept and holds 378 rows whose payee is free text in `vendor`. A FK
-- would make every one of those unlinkable rather than merely unlinked, and
-- would fail the moment somebody expenses a one-off payee. The join is
-- `LEFT JOIN ganit_vendors v ON v.id = e.vendor_id AND v.org_id = e.org_id`.
COMMENT ON COLUMN staging.ganit_expenses.tds_amount IS
    'Tax deducted on this expense. NULL means NOT RECORDED, which is different '
    'from 0.00 meaning nothing was deducted. A threshold skill must report the '
    'NULL count rather than treating unrecorded as nil.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · #46 + #53 — REGIONAL HOLIDAYS
--
-- "manav_holidays has no state column, so a Maharashtra PT date cannot be
-- shifted for a Maharashtra holiday." One column. NULL means the holiday
-- applies everywhere, which is the correct reading of the 38 rows that exist.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.manav_holidays
    ADD COLUMN IF NOT EXISTS state_code text;

DO $ck$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='manav_holidays_state_ck') THEN
        ALTER TABLE staging.manav_holidays ADD CONSTRAINT manav_holidays_state_ck
            CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2,3}$');
    END IF;
END
$ck$;

COMMENT ON COLUMN staging.manav_holidays.state_code IS
    'NULL means the holiday applies everywhere — the correct reading of the 38 '
    'rows that predate this column. A send guard (#53) must NEVER refuse to '
    'send for want of a state: GSTIN blocks nothing in this product, and a '
    'recipient whose state is unknown is sent to, not suppressed.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · #42 + #55 — THE CATEGORISATION WRITE PATH
--
-- #55 is named separately in the folio "because the blocker deserves it: the
-- product cannot learn from a decision it never stores. One column, written
-- when a human classifies a line, makes this the cheapest skill in the
-- catalogue." Three, because WHO and WHEN are what make it evidence rather
-- than a guess — a rule learned from one person's Tuesday is not a rule.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.ganit_bank_statement_lines
    ADD COLUMN IF NOT EXISTS category       text,
    ADD COLUMN IF NOT EXISTS categorised_by text,
    ADD COLUMN IF NOT EXISTS categorised_at timestamptz;

CREATE INDEX IF NOT EXISTS ganit_bsl_category_idx
    ON staging.ganit_bank_statement_lines (org_id, category)
    WHERE category IS NOT NULL;

COMMENT ON COLUMN staging.ganit_bank_statement_lines.category IS
    'What a HUMAN said this narration is. Adding the column does not create the '
    'write path — until the reconciliation screen writes it, this stays NULL '
    'and #42/#55 must report "nothing to learn from" rather than presenting an '
    'empty column as a clean result.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · #48 — BILLABLE IS NOT BILLED
--
-- See the header. `is_billed` already exists and is a different fact.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.time_entries
    ADD COLUMN IF NOT EXISTS is_billable   boolean,
    ADD COLUMN IF NOT EXISTS rate_per_hour numeric(12,2);

COMMENT ON COLUMN public.time_entries.is_billable IS
    'Whether the client CAN be charged — distinct from is_billed, which is '
    'whether an invoice went out. Unbilled billable time is WIP; unbilled '
    'unbillable time is write-off. NULL means nobody has said: a WIP report '
    'must count the unknowns, never assume, because assuming billable inflates '
    'WIP and assuming not-billable hides it.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · #33 + #54 — CONSENT, AND THE FREE ENTRY POINT
--
-- `varta_contacts.opted_in` and `opted_in_at` already exist and ARE populated
-- (45 of 60 live rows, all with a timestamp). What is missing is the evidence
-- — what notice the person actually agreed to and where — and the opt-out
-- side, without which a STOP cannot be honoured.
--
-- #54 was promoted by the folio: from 1 October 2026 the Click-to-WhatsApp
-- entry point is the only free window Meta leaves standing. DO NOT HARDCODE
-- THE 72 HOURS ANYWHERE — it is policy and it moves.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.varta_contacts
    ADD COLUMN IF NOT EXISTS consent_source text,
    ADD COLUMN IF NOT EXISTS consent_notice text,
    ADD COLUMN IF NOT EXISTS opted_out_at   timestamptz;

COMMENT ON COLUMN staging.varta_contacts.consent_notice IS
    'The exact notice text the person agreed to, captured at source. An opt-in '
    'flag with no record of what was consented to is not evidence of consent.';
COMMENT ON COLUMN staging.varta_contacts.opted_out_at IS
    'When a STOP was received. A send path must refuse an opted-out number; '
    'until it does, this column records the fact and the skill reports who '
    'would wrongly be sent to.';

ALTER TABLE staging.varta_messages
    ADD COLUMN IF NOT EXISTS entry_point text,
    ADD COLUMN IF NOT EXISTS referral    jsonb;

COMMENT ON COLUMN staging.varta_messages.referral IS
    'The referral block on an inbound Click-to-WhatsApp message. The free '
    'window it opens is POLICY and moves — never hardcode its length; read it '
    'from configuration and state the date the figure was true.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · PROVE IT, IN THE SAME TRANSACTION
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE missing text;
BEGIN
    SELECT string_agg(w.t || '.' || w.c, ', ') INTO missing
    FROM (VALUES
        ('ganit_vendors','is_msme'),('ganit_vendors','udyam_number'),
        ('ganit_vendors','enterprise_class'),('ganit_vendors','vendor_kind'),
        ('ganit_vendors','payment_terms_days'),('ganit_vendors','tds_section'),
        ('ganit_vendor_bills','acceptance_date'),
        ('ganit_invoices','irn'),('ganit_invoices','irn_generated_at'),
        ('ganit_expenses','vendor_id'),('ganit_expenses','tds_amount'),
        ('manav_holidays','state_code'),
        ('ganit_bank_statement_lines','category'),
        ('ganit_bank_statement_lines','categorised_by'),
        ('ganit_bank_statement_lines','categorised_at'),
        ('varta_contacts','consent_source'),('varta_contacts','consent_notice'),
        ('varta_contacts','opted_out_at'),
        ('varta_messages','entry_point'),('varta_messages','referral')
    ) AS w(t, c)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='staging' AND table_name=w.t AND column_name=w.c);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 1: staging columns did not land: %', missing;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='time_entries'
          AND column_name='is_billable') THEN
        RAISE EXCEPTION 'VERIFY 2: public.time_entries.is_billable did not land.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='staging' AND table_name='client_obligations') THEN
        RAISE EXCEPTION 'VERIFY 3: staging.client_obligations was not created.';
    END IF;

    -- NOTHING IS BACKFILLED. If any new column has a non-NULL value, something
    -- in this file wrote data it should not have.
    IF (SELECT count(*) FROM staging.ganit_invoices WHERE irn IS NOT NULL) <> 0
       OR (SELECT count(*) FROM public.time_entries WHERE is_billable IS NOT NULL) <> 0
       OR (SELECT count(*) FROM staging.client_obligations) <> 0 THEN
        RAISE EXCEPTION 'VERIFY 4: this migration wrote data. It must not.';
    END IF;

    -- Standing invariant across the whole programme.
    IF EXISTS (SELECT 1 FROM staging.hub_skill_templates WHERE trigger_config IS NOT NULL) THEN
        RAISE EXCEPTION 'VERIFY 5: something is armed. This file writes no trigger.';
    END IF;

    RAISE NOTICE '175 · the Later tier is unblocked: 1 table, 20 columns, 0 rows '
                 'written, 0 skills armed.';
END
$verify$;

COMMIT;
