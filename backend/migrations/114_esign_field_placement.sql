-- 114_esign_field_placement.sql
--
-- WHERE ON THE PAGE THE SIGNATURE GOES. Today nothing in this product places,
-- stores, transmits or consumes a field position: `CreateTab.jsx` is one card
-- of title / description / file / expiry / signer rows, `SigningPage.jsx` never
-- renders the PDF at all (it shows a "View document (PDF)" anchor), and
-- `services/esign_signed_doc.build_signed_pdf` APPENDS a signature page rather
-- than stamping one.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/114_esign_field_placement.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 6 August 2026. Measured against the live catalogue
-- (`to_regclass('staging.sign_fields')` → NULL, project toacecaewujfxjfrjwco;
-- `sign_documents` 24 columns, `sign_signers` 19, none of them positional),
-- deliberately not run.
--
-- ── THE DOCTRINE THIS FILE FOLLOWS, STATED ONCE ────────────────────────────
--
-- A COLUMN MAY EXIST UNREAD IF ITS DEFAULT REPRODUCES TODAY'S BEHAVIOUR
-- EXACTLY. IT MUST NOT BE OFFERED IN ANY UI UNTIL SOMETHING HONOURS IT.
--
-- That is the whole reason this file contains what it contains and, more
-- importantly, why it leaves out two of the four "Send" options the prototype
-- draws. Migration 106 exists because `pahchan_policy` shipped three report
-- toggles defaulting TRUE with no sender behind them, and every org that never
-- opened the screen was recorded as wanting three summaries that do not exist.
-- Adding `delivery_channel` with a `whatsapp` value would be that bug rebuilt
-- one migration later — see the DELIBERATELY ABSENT section at the foot, which
-- carries the exact DDL for the day it becomes honest.
--
-- ── PERCENTAGES, NOT POINTS ────────────────────────────────────────────────
--
-- `design-reference/Kartavaya Redesign/ScreensThin.jsx:393-398` models a field
-- as `{ kind, who, page, top, left, w }` where top/left/w are PERCENTAGES of
-- the page box, and the height is hard-coded at 9%. Percentages are kept here
-- rather than converted to PDF points, and that is a decision with a reason:
-- the placement editor works against a rasterised preview whose pixel size
-- depends on the viewport, and the stamper works against a PDF whose MediaBox
-- differs per page and per document. A percentage is the only representation
-- that means the same thing to both, on every zoom level and every page size.
-- The conversion to points belongs in the stamper, once, where the MediaBox is
-- actually in hand.
--
-- `numeric(6,3)` and not float. `left + width <= 100` has to be exact
-- arithmetic or a field dragged to the right margin fails a CHECK by 1e-14.
--
-- ── WHAT THIS TABLE DOES NOT MAKE TRUE ─────────────────────────────────────
--
-- Placement is a FOUR-LAYER feature and this file is one layer. With only this
-- applied, a placed field is decoration: `POST /v1/esign/verify/{token}/sign`
-- accepts exactly `{signature_data, signature_type}` (esign.py:166-168) and the
-- merger never positions anything on a page of the original. The other three
-- layers, none of them in this file:
--
--   · a PDF renderer in the frontend. There is none — zero pdf packages in
--     `frontend/package.json` and zero in `node_modules`.
--   · the signing page carrying field values back. `SigningPage.jsx` renders no
--     PDF and posts no field.
--   · a stamping pass in `services/esign_signed_doc.py`. `pypdf` 6.14.2 already
--     exposes `merge_transformed_page` / `merge_translated_page`, so this needs
--     no new backend dependency — but it does need care: that file's own
--     docstring (L21-25) says the original is never re-rendered "or it would
--     change the bytes the signers actually saw", and stamping must preserve
--     that promise by overlaying, never by re-rendering.
--
-- Applying this file alone changes nothing anybody can see. That is intended.
--
-- ── EVERY DEFAULT, CHOSEN AS IF NOBODY EVER OPENS THE SCREEN ───────────────
--
--   sign_fields          no rows      A document with no placed fields behaves
--                                     exactly as every one of the 75 existing
--                                     documents does. The absence of a row is
--                                     the current product.
--   required             TRUE         only reachable on a field somebody
--                                     deliberately placed. A placed field that
--                                     is optional is decoration; if that is
--                                     wanted it should be typed, not defaulted.
--   height               9.000        the prototype's hard-coded 9%.
--   otp_required         TRUE         ON sign_documents. 75 EXISTING ROWS get
--                                     this the instant it runs, and TRUE is the
--                                     only safe value: OTP is UNCONDITIONAL
--                                     today (`esign.py:499` computes
--                                     `otp_required` as `not verified`, with no
--                                     per-document opt-out anywhere). FALSE as
--                                     a default would silently drop identity
--                                     verification on every signature in flight.
--
-- ── LOCKS ──────────────────────────────────────────────────────────────────
--
-- One CREATE TABLE, two CREATE INDEX, one ALTER ... ADD COLUMN on
-- `sign_documents`, one ADD CONSTRAINT ... UNIQUE on `sign_documents`.
--
-- The ADD COLUMN is a catalogue update without a rewrite (constant default,
-- PG 11+). The ADD CONSTRAINT UNIQUE BUILDS AN INDEX over 75 rows and holds
-- ACCESS EXCLUSIVE on `sign_documents` for its duration — milliseconds at this
-- size, but it is a real index build and would not be at 75,000 rows. Both take
-- ACCESS EXCLUSIVE until COMMIT and queue behind any open transaction on that
-- table. Blast radius is the eSign module only. `lock_timeout` makes the bad
-- case a clean rollback; run it when the module is quiet.
--
-- No data is rewritten, so no wrong-database guard.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── GUARD 0 · the three parents ─────────────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.organisations')  IS NULL THEN
        RAISE EXCEPTION 'staging.organisations does not exist.';
    END IF;
    IF to_regclass('staging.sign_documents') IS NULL THEN
        RAISE EXCEPTION 'staging.sign_documents does not exist.';
    END IF;
    IF to_regclass('staging.sign_signers')   IS NULL THEN
        RAISE EXCEPTION 'staging.sign_signers does not exist.';
    END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The tenant key a field can be attached to
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `sign_fields` carries `org_id`, because every child table in this schema that
-- lacked one is on the list from the cross-org access audit. But a redundant
-- `org_id` that is only copied by application code is a comment, not a
-- constraint: it drifts the first time a write path forgets, and the drift is
-- invisible until somebody reads another tenant's field positions.
--
-- A composite FK `(document_id, org_id) → sign_documents (id, org_id)` makes it
-- a database fact, and that requires this otherwise-redundant UNIQUE. `id` is
-- already the primary key, so this index adds nothing to uniqueness — it exists
-- solely to be a referenceable target.
--
-- NOTE: `sign_signers.org_id` is NULLABLE on the live database, so the same
-- trick is NOT available for the signer FK. That is a real asymmetry and it is
-- why signer_id is a plain FK below.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sign_documents_id_org_uq'
           AND conrelid = 'staging.sign_documents'::regclass
    ) THEN
        ALTER TABLE staging.sign_documents
            ADD CONSTRAINT sign_documents_id_org_uq UNIQUE (id, org_id);
    END IF;
END $$;

COMMENT ON CONSTRAINT sign_documents_id_org_uq ON staging.sign_documents IS
    'Redundant against the primary key, and deliberately so: it is the target '
    'of sign_fields'' composite foreign key, which is what makes "a field '
    'belongs to the same org as its document" a fact the database enforces '
    'rather than a line application code is trusted to remember.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · The field
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.sign_fields (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    document_id UUID NOT NULL,
    org_id      UUID NOT NULL,

    -- Whose field. The prototype keys by signer NAME (`who: 'Meera Joshi'`),
    -- which is a fixture convenience and cannot survive two signers of the same
    -- name or a rename. CASCADE: removing a signer removes the boxes they were
    -- to fill, which is the only coherent outcome.
    signer_id   UUID NOT NULL
                REFERENCES staging.sign_signers(id) ON DELETE CASCADE,

    -- 1-based, as the prototype's `page: 2` is and as every PDF viewer in the
    -- world displays. No upper CHECK — the page count lives in the file, not in
    -- this schema, and a CHECK that guessed it would refuse a legitimate field
    -- on page 40 of a 60-page lease.
    page        INTEGER NOT NULL CHECK (page >= 1),

    -- The prototype's five, stored as codes and rendered as labels. Lowercase
    -- because every other CHECKed vocabulary in this schema is
    -- (`sign_documents.status`, `outbound_log.channel`), and a single
    -- Title-Case column is how you get `'Signature'` and `'signature'` both in
    -- the table.
    kind        TEXT NOT NULL
                CHECK (kind IN ('signature', 'initials', 'date', 'text', 'checkbox')),

    -- Percentages of the page box. See the header for why not points.
    --
    -- `_pct` suffixes, and NOT the prototype's bare `top` / `left` / `w`:
    -- `left` is a reserved word in Postgres, so a column called `left` needs
    -- double quotes in every query, every migration and every ORDER BY for the
    -- rest of the table's life, and the first one that forgets is a syntax
    -- error at runtime. The suffix also says what the number is, which `top: 62`
    -- does not. Map them in the serialiser: top_pct→top, left_pct→left,
    -- width_pct→w, height_pct→h.
    top_pct     NUMERIC(6,3) NOT NULL,
    left_pct    NUMERIC(6,3) NOT NULL,
    width_pct   NUMERIC(6,3) NOT NULL,
    height_pct  NUMERIC(6,3) NOT NULL DEFAULT 9.000,

    -- A placed field is required unless somebody says otherwise.
    required    BOOLEAN NOT NULL DEFAULT TRUE,

    -- What the signer put in it, for text/date/checkbox. SIGNATURE AND INITIALS
    -- FIELDS DO NOT STORE AN IMAGE HERE: they render from
    -- `sign_signers.signature_data`, which is the column the audit trail and the
    -- completion certificate already reference. Duplicating the image would
    -- create a second source of truth for the one artefact that must have
    -- exactly one.
    value       TEXT,
    filled_at   TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Invariants ──────────────────────────────────────────────────────────

    -- The tenant key cannot drift from the document's. This is the constraint,
    -- not the org_id column.
    CONSTRAINT sign_fields_document_fk
        FOREIGN KEY (document_id, org_id)
        REFERENCES staging.sign_documents (id, org_id) ON DELETE CASCADE,

    -- The box is on the page. Exact numeric arithmetic, so a field flush to the
    -- right margin is legal and one hanging off it is not.
    CONSTRAINT sign_fields_within_page
        CHECK (top_pct   >= 0 AND left_pct   >= 0
           AND width_pct >  0 AND height_pct >  0
           AND left_pct + width_pct  <= 100
           AND top_pct  + height_pct <= 100),

    -- A filled field records when. An unfilled one records neither.
    CONSTRAINT sign_fields_fill_pairs
        CHECK ((value IS NULL) = (filled_at IS NULL)),

    -- A signature is not typed into this column. See the `value` comment: the
    -- image belongs to the signer row, exactly once.
    CONSTRAINT sign_fields_signature_value_lives_on_the_signer
        CHECK (kind NOT IN ('signature', 'initials') OR value IS NULL)
);

COMMENT ON TABLE staging.sign_fields IS
    'Where each signer''s boxes sit on each page, as PERCENTAGES of the page '
    'box — the only representation that means the same thing to a rasterised '
    'browser preview and to a PDF whose MediaBox differs per page. Conversion '
    'to points belongs in the stamper. APPLYING THIS ALONE CHANGES NOTHING '
    'VISIBLE: POST /verify/{token}/sign accepts only {signature_data, '
    'signature_type} and build_signed_pdf appends a page rather than stamping '
    'one, so until those two change a placed field is decoration.';

COMMENT ON COLUMN staging.sign_fields.value IS
    'The filled value for text/date/checkbox fields. NULL for signature and '
    'initials, enforced: those render from sign_signers.signature_data, which '
    'is what the audit trail and the completion certificate already reference. '
    'Two copies of a signature image is two answers to "what did they sign".';

COMMENT ON COLUMN staging.sign_fields.org_id IS
    'Kept honest by the composite FK to sign_documents(id, org_id), not by '
    'application code. Denormalised on purpose so a field can be tenant-scoped '
    'without a join, which is what the cross-org access audit asked of every '
    'child table in this schema.';

-- The stamper's read: every field on this document, in page order.
CREATE INDEX IF NOT EXISTS idx_sign_fields_document
    ON staging.sign_fields (document_id, page);

-- The signing page's read: what THIS signer has to fill.
CREATE INDEX IF NOT EXISTS idx_sign_fields_signer
    ON staging.sign_fields (signer_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · The one send option that can be honoured
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Of the four options the prototype's "Send" card offers, exactly one can be
-- added without promising something the product cannot do:
--
--   Expire after 30 days   ALREADY EXISTS. `sign_documents.expires_at` is
--                          nullable, `_doc_status_guard` (esign.py:408-424)
--                          treats NULL as "never expires", and
--                          `DetailTab.jsx:174` already renders 'Never'.
--   Verify signer by OTP   ADDED BELOW, defaulting TRUE = today's behaviour.
--   Deliver by WhatsApp    NOT ADDED. See the foot of this file.
--   Remind every 3 days    NOT ADDED. See the foot of this file.

ALTER TABLE staging.sign_documents
    ADD COLUMN IF NOT EXISTS otp_required BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN staging.sign_documents.otp_required IS
    'Whether a signer must pass the emailed OTP before signing. TRUE on all 75 '
    'existing rows and TRUE by default, because OTP is UNCONDITIONAL today: '
    'esign.py:499 computes the response field as `not signer.otp_verified` and '
    'there is no per-document opt-out anywhere. Applying this changes nothing. '
    'MUST NOT BE OFFERED IN ANY UI until esign.py:499 and the sign gate read '
    'it — a tickbox that turns off identity verification and is ignored is '
    'worse than no tickbox, because the customer believes they turned it off '
    'and the signer believes they were verified.';

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The table, the column and the composite target all exist.
--      SELECT to_regclass('staging.sign_fields') AS tbl;
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema='staging' AND table_name='sign_documents'
--         AND column_name='otp_required';
--    Expect: boolean, NO, true.

-- 2. NOTHING IN FLIGHT LOST ITS OTP. All 75 TRUE, zero FALSE. This is the check
--    that says the apply was inert, which is the claim in the header.
--      SELECT count(*) AS docs,
--             count(*) FILTER (WHERE otp_required) AS otp_on,
--             count(*) FILTER (WHERE NOT otp_required) AS otp_off
--        FROM staging.sign_documents;

-- 3. NO DOCUMENT GAINED A FIELD. Zero — every existing document keeps behaving
--    exactly as it did, because the absence of a row IS the current product.
--      SELECT count(*) FROM staging.sign_fields;

-- 4. THE COMPOSITE FK ACTUALLY REFUSES A CROSS-ORG FIELD. This is the one that
--    matters; the org_id column is worthless without it. Needs two orgs.
--      BEGIN;
--        INSERT INTO staging.sign_fields
--          (document_id, org_id, signer_id, page, kind, top_pct, left_pct, width_pct)
--          SELECT s.document_id,
--                 (SELECT id FROM staging.organisations
--                   WHERE id <> d.org_id LIMIT 1),   -- a DIFFERENT org
--                 s.id, 1, 'signature', 60, 8, 40
--            FROM staging.sign_signers s
--            JOIN staging.sign_documents d ON d.id = s.document_id
--           LIMIT 1;
--        -- expect: violates foreign key constraint sign_fields_document_fk
--      ROLLBACK;

-- 5. A BOX OFF THE PAGE IS REFUSED, AND A BOX FLUSH TO THE MARGIN IS NOT. Both
--    halves — a CHECK that refuses the legal case is a placement editor users
--    cannot use.
--      BEGIN;
--        -- flush right: left 60 + width 40 = exactly 100. MUST SUCCEED.
--        INSERT INTO staging.sign_fields
--          (document_id, org_id, signer_id, page, kind, top_pct, left_pct, width_pct)
--          SELECT s.document_id, d.org_id, s.id, 1, 'signature', 60, 60, 40
--            FROM staging.sign_signers s
--            JOIN staging.sign_documents d ON d.id = s.document_id LIMIT 1;
--        -- one micron over. MUST FAIL.
--        INSERT INTO staging.sign_fields
--          (document_id, org_id, signer_id, page, kind, top_pct, left_pct, width_pct)
--          SELECT s.document_id, d.org_id, s.id, 1, 'signature', 60, 60.001, 40
--            FROM staging.sign_signers s
--            JOIN staging.sign_documents d ON d.id = s.document_id LIMIT 1;
--        -- expect: violates sign_fields_within_page
--      ROLLBACK;

-- 6. A SIGNATURE IMAGE CANNOT BE TYPED INTO A FIELD ROW.
--      BEGIN;
--        INSERT INTO staging.sign_fields
--          (document_id, org_id, signer_id, page, kind, top_pct, left_pct, width_pct, value, filled_at)
--          SELECT s.document_id, d.org_id, s.id, 1, 'signature', 60, 8, 40,
--                 'data:image/png;base64,AAAA', NOW()
--            FROM staging.sign_signers s
--            JOIN staging.sign_documents d ON d.id = s.document_id LIMIT 1;
--        -- expect: violates sign_fields_signature_value_lives_on_the_signer
--      ROLLBACK;

-- 7. DELETING A SIGNER TAKES THEIR BOXES AND NOT THE DOCUMENT'S.
--      BEGIN;
--        -- place two fields for two different signers on one document, delete
--        -- one signer, and confirm exactly the other signer's field survives.
--        -- (Left as a shape rather than a script: it needs a document with two
--        -- signers, and inventing one here would write to a live table.)
--      ROLLBACK;


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS staging.sign_fields;
--   ALTER TABLE staging.sign_documents
--       DROP COLUMN IF EXISTS otp_required,
--       DROP CONSTRAINT IF EXISTS sign_documents_id_org_uq;
--
-- In that order — the constraint is the FK's target and cannot be dropped while
-- sign_fields references it. Safe while nothing reads either. Once the signing
-- page reads fields, dropping the table loses the placements on every document
-- in flight, and a half-signed document whose boxes have vanished cannot be
-- completed or reconstructed.


-- ── DELIBERATELY ABSENT, WITH THE DDL FOR THE DAY THEY ARE HONEST ──────────
--
-- ── (a) `delivery_channel` — Deliver by WhatsApp / Email / Both ────────────
--
-- NOT ADDED. There is no path that sends a document to a named signer's phone.
-- What exists is two things that are not it:
--
--   · `services/social_publisher.publish_to_whatsapp_business` — posts AS a
--     business account to its own audience via the Meta Cloud API. Not a
--     one-to-one delivery to a signer.
--   · `routers/whatsapp.py:169-193` `send_wa_message` — INSERTs a row with
--     status 'pending' behind a `TODO: Call Meta Cloud API`, "for now, store as
--     pending — Meta API integration requires WABA approval". Nothing sends it.
--     `services/skills/action/campaign_sender.py:70-85` documents the same fact
--     and the damage the last attempt to work around it did.
--
-- A column with `'whatsapp'` in its CHECK, a picker that offers it, and nothing
-- that delivers, is `pahchan_policy.report_daily DEFAULT true` all over again:
-- the customer chooses WhatsApp, the document is never delivered, and there is
-- no error anywhere. The day a real one-to-one WhatsApp sender exists, in the
-- SAME commit as that sender:
--
--   ALTER TABLE staging.sign_documents
--       ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'email';
--   ALTER TABLE staging.sign_documents
--       ADD CONSTRAINT sign_documents_delivery_channel_ck
--       CHECK (delivery_channel IN ('email', 'whatsapp', 'both'));
--
-- DEFAULT 'email' and not 'both': 'both' would start WhatsApp-ing 75 documents'
-- worth of signers who were only ever emailed.
--
-- ── (b) `reminder_every_days` — Remind every 3 days ────────────────────────
--
-- NOT ADDED, for the same reason and it is not a weaker one. There is no
-- scheduler hook for eSign reminders: `routers/scheduler.py` drives the daily
-- retention cron and nothing in it walks unsigned documents. A stored cadence
-- with no job is a customer who ticked "remind every 3 days", watched a
-- contract go unsigned for a fortnight, and was never reminded either.
--
-- It is tempting to argue NULL-means-off makes it safe to add early. It does
-- make the APPLY safe — but the column only has a purpose once a UI writes to
-- it, and the UI is exactly the promise. Add both together:
--
--   ALTER TABLE staging.sign_documents
--       ADD COLUMN IF NOT EXISTS reminder_every_days INTEGER,
--       ADD COLUMN IF NOT EXISTS reminder_last_sent_at TIMESTAMPTZ;
--   ALTER TABLE staging.sign_documents
--       ADD CONSTRAINT sign_documents_reminder_cadence_ck
--       CHECK (reminder_every_days IS NULL
--              OR reminder_every_days BETWEEN 1 AND 30);
--
-- `reminder_last_sent_at` is not optional when that day comes — without it the
-- job is not idempotent, and a job that reruns is a signer mailed six times.
--
-- ── (c) `message` on DocumentCreate ────────────────────────────────────────
--
-- NOT ADDED, and worth naming because it looks like an omission. `esign.py`'s
-- `DocumentCreate` (L154-159) ACCEPTS a `message` field and `create_document`
-- (L207-246) never reads it — the covering note a sender types is silently
-- discarded today. That is a bug in the router, not a missing column: the fix
-- is to read `body.message` or to remove it from the model, and a column added
-- before that decision would just be a second place for it to be ignored.
