-- 160 · dsc_register — the digital signature certificates a practice holds for
-- its clients, the dates they die on, and whether the firm actually has them.
--
-- WHAT THIS FILE TOUCHES, exactly:
--   CREATES  staging.dsc_register              (one new table, previously absent —
--            confirmed against the live catalog on 2026-08-19: to_regclass on
--            'staging.dsc_register', 'staging.dsc_certificates',
--            'staging.custody_dsc' and 'public.dsc_register' all returned NULL,
--            no table in either schema has a name matching %dsc% / %signature% /
--            %certificate% / %custody% / %register%, and the only columns in the
--            whole database matching %dsc% / %certificate% / %udin% are
--            staging.sign_documents.certificate_{file_key,file_url,hash} — which
--            belong to the eSign audit trail and are a different thing entirely.)
--   CREATES  four indexes and one BEFORE UPDATE trigger on that new table.
--   ALTERS   nothing. DROPS nothing. INSERTs, UPDATEs and DELETEs nothing.
--   READS    staging.organisations and staging.graha_clients only to take a
--            FOREIGN KEY on each. That takes a SHARE ROW EXCLUSIVE lock on both
--            for the duration of the statement; it does not rewrite either
--            table and does not block concurrent SELECTs. graha_clients held 91
--            rows across 2 orgs at the time of writing, so the lock is measured
--            in milliseconds. SET LOCAL lock_timeout is deliberately absent —
--            there is no long-running rewrite here to queue behind.
--
-- IF IT RUNS TWICE: nothing happens. CREATE TABLE and CREATE INDEX are IF NOT
-- EXISTS, the trigger is DROP TRIGGER IF EXISTS + CREATE, and there is no seed
-- at all — a DSC register with rows in it that this repo invented would be
-- worse than an empty one, because a firm would trust it. The table ships
-- empty, on purpose.
--
-- SHARED-DATABASE NOTE: staging and production share this database and
-- production writes to `staging` too. This adds one empty table. No existing
-- row is read for its value, written, or moved, so applying this cannot change
-- any figure any user sees today. Production's code (main, 1aa49855) does not
-- reference this table; nothing does until a caller imports
-- services/custody/dsc.py.
--
-- ── WHY THIS TABLE EXISTS ────────────────────────────────────────────────────
-- A practice holds dozens of client DSC tokens and they expire on rolling
-- dates. The failure is always the same shape: it is filing day, the token goes
-- into the USB port, and the certificate died three weeks ago. Nobody found out
-- earlier because the only record of the expiry date was on the token itself.
-- This is a date column and a query.
--
-- AND IT IS NOT ONLY ABOUT EXPIRY. "We handed that token back to the client in
-- March" stops a filing exactly as dead as "it expired in March", and today
-- neither fact is written down anywhere. custody_status carries the second one,
-- and services/custody/dsc.py reports the two through a single blocking reason
-- so that a caller cannot check one and forget the other.
--
-- ── valid_to IS THE LAST DAY THE CERTIFICATE WORKS, INCLUSIVE ────────────────
-- READ THIS BEFORE COPYING THE PATTERN FROM MIGRATION 158. `statute_calendar`
-- uses a HALF-OPEN window where effective_to is the first day a fact is NOT
-- true. THIS TABLE IS THE OPPOSITE and deliberately so: valid_from/valid_to
-- mirror X.509 notBefore/notAfter, which are INCLUSIVE bounds, and every CA in
-- India prints "valid till 14/03/2027" on the certificate the firm is copying
-- from. Storing that date as an exclusive bound would mean every row is keyed
-- off a date the operator never saw, and the day the token actually stops
-- working would be the day before the one in the record. So:
--
--     expired      <=>  valid_to <  as_of
--     live         <=>  valid_from <= as_of <= valid_to
--
-- The two are disjoint and together cover every row, which is what makes
-- "expiring in the next N days" and "already expired" safe to render side by
-- side without a certificate appearing in both or in neither.
--
-- ── STATUTORY FACTS ENCODED HERE, AND WHERE THEY CAME FROM ──────────────────
-- certificate_class allows class_1, class_2, class_3, aadhaar_ekyc_otp and
-- aadhaar_ekyc_biometric. Those are the classes the Controller of Certifying
-- Authorities names (https://cca.gov.in/classes_of_certificates.html, read
-- 2026-08-19).
--
-- class_2 IS ALLOWED AND MUST STAY ALLOWED. The CCA's guidelines of 26 November
-- 2020 withdrew the ISSUANCE of Class 2 certificates from 1 January 2021 — but
-- a Class 2 certificate issued before that date stayed valid to its own expiry.
-- A firm typing up a legacy register is entering real, correct Class 2 rows,
-- and a CHECK that rejected them would make the product wrong about history in
-- the name of being current. Same reasoning as `users.role`: rows that look
-- wrong are real. 'unknown' is allowed for the same reason from the other
-- direction — a firm entering forty tokens will not know the class of all
-- forty, and forcing a guess puts a fabricated fact in a compliance record.
--
-- certificate_type separates 'signature' from 'encryption' because the CCA
-- requires them to be separate certificates for an individual
-- (https://cca.gov.in/faq.html, read 2026-08-19). A firm that records only "one
-- DSC" for a client and needs the encryption certificate on filing day has the
-- same bad morning this table exists to prevent.
--
-- THERE IS NO CHECK ON issuing_authority, on purpose. The CCA licenses 23 CAs
-- today (https://cca.gov.in/licensed_ca.html, read 2026-08-19) and that list
-- changes: a licence lapses, and every certificate that CA ever issued is still
-- in a drawer somewhere with years left to run. A CHECK constraint would make
-- the day a licence lapses the day the firm can no longer record its own
-- certificates. services/custody/dsc.py canonicalises the spelling instead, and
-- canonicalising is advisory — an unrecognised name is stored exactly as typed.
--
-- THERE IS NO CHECK THAT valid_to IS WITHIN THREE YEARS OF valid_from. Indian
-- CAs sell one-, two- and three-year certificates and none sells longer — but
-- that three-year ceiling is COMMERCIAL PRACTICE AND NOT A VERIFIED STATUTORY
-- LIMIT. It could not be confirmed against a primary CCA instrument on
-- 2026-08-19 (cca.gov.in/faq.html and /classes_of_certificates.html are both
-- silent on validity periods, and the X.509 Certificate Policy for India PKI at
-- cca.gov.in/sites/files/pdf/guidelines/CCA-CP.pdf could not be read to confirm
-- it); every source that states it is a CA's own marketing page. So it is a
-- fact about what a CA will sell, not a rule about what a register may record,
-- and it must not be hardened into a CHECK or attributed to the CCA until
-- someone can quote a clause. This house also does not block data entry on
-- a statutory nicety (see GSTIN/PAN/TAN, which are non-mandatory and block
-- nothing, twice regressed). The service flags an implausible span as a warning
-- on the row. A warning gets looked at; a rejection gets worked around by
-- typing a wrong date.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
--  * NO PIN, NO PASSWORD, NO PIN HINT COLUMN, and none may ever be added. A DSC
--    token PIN is the whole of the security of the private key it guards; a
--    column for it turns one compromised database read into the ability to sign
--    as forty taxpayers. If someone asks for "just a hint field", the answer is
--    still no — a hint is a password with a worse threat model, because it gets
--    typed by people who believe it is not one.
--  * NO CUSTODY HISTORY. This table holds where the token is NOW. Who had it in
--    March needs its own append-only table with a person and a timestamp, and
--    inventing that shape before anyone has asked a question of it would be
--    guessing. custody_changed_on records when the current state began, which is
--    the one historical fact the expiry queries actually need.
--  * NO DUE DATES AND NO FORM NUMBERS. Those are dated statutory facts and they
--    live in staging.statute_calendar (migration 158) behind services/statute.py.
--    ==> INTEGRATION POINT: a future "which filings does this expiry endanger?"
--        query joins this table's valid_to against statute.obligations(as_of=…).
--        It is not written here and must not be reimplemented here.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.dsc_register (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The tenant. NOT NULL and first in every index because every query in
    -- services/custody/dsc.py narrows by it before anything else; a DSC
    -- register that leaked across orgs would be handing one firm the names of
    -- another firm's clients.
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- The company the certificate belongs to — graha_clients is THE company
    -- record (migration 136), never a contact: contacts come and go and the
    -- customer stays, and a DSC outlives the person who emailed about it.
    --
    -- NULL MEANS THE PRACTICE'S OWN CERTIFICATE. A CA firm holds its partners'
    -- DSCs for its own signing, and those have no client. That is why this is
    -- ON DELETE CASCADE and NOT ON DELETE SET NULL, which is the pattern used
    -- elsewhere in this schema: SET NULL would silently reclassify a deleted
    -- client's certificate as one of the firm's own, and the row would then
    -- appear in the partners' list with a client's holder name on it. Cascading
    -- is also nearly theoretical — graha.py soft-deletes a client
    -- (`is_active=FALSE`, routers/graha.py:353) and never issues a DELETE, so a
    -- hard delete here means a deliberate purge, where taking the certificates
    -- with it is the intended behaviour.
    client_id UUID REFERENCES staging.graha_clients(id) ON DELETE CASCADE,

    -- WHOSE NAME THE CERTIFICATE IS IN — a director, a partner, the proprietor,
    -- an authorised signatory. TEXT and not a reference to any user table, and
    -- that is not laziness: this person is almost never a user of this product.
    -- They are a person at the client company whose name is inside the
    -- certificate, and the certificate is only usable for filings made in that
    -- name. Storing an id here would also put us one careless SELECT away from
    -- rendering a uuid in a UI, which this house forbids outright.
    holder_name TEXT NOT NULL,
    holder_kind TEXT NOT NULL DEFAULT 'individual'
        CHECK (holder_kind IN ('individual', 'organisation', 'unknown')),
    holder_designation TEXT,

    -- NON-MANDATORY, AND THERE IS NO FORMAT CHECK ON EITHER. Both are here
    -- because the income-tax portal binds a DSC to a PAN and MCA binds it to a
    -- DIN, so "which PAN is this token registered against?" is the question
    -- asked at 11pm on the due date. They are nullable, unvalidated and block
    -- nothing — the GSTIN/PAN/TAN rule of this codebase, which has been
    -- reintroduced as a "fix" more than once.
    holder_pan TEXT,
    holder_din TEXT,

    -- See the header. class_2 and unknown are allowed on purpose.
    certificate_class TEXT NOT NULL DEFAULT 'class_3'
        CHECK (certificate_class IN (
            'class_1', 'class_2', 'class_3',
            'aadhaar_ekyc_otp', 'aadhaar_ekyc_biometric',
            'unknown')),

    -- 'combined' is the ordinary case for a Class 3 token sold as one unit;
    -- 'signature' and 'encryption' exist because the CCA requires them to be
    -- separate certificates for an individual. 'document_signer' is the
    -- server-side certificate used to seal generated PDFs and 'dgft' is the
    -- organisational certificate the foreign-trade portal insists on — both are
    -- things a practice genuinely holds and neither is an ordinary signing
    -- token.
    certificate_type TEXT NOT NULL DEFAULT 'signature'
        CHECK (certificate_type IN (
            'signature', 'encryption', 'combined',
            'document_signer', 'dgft', 'unknown')),

    -- Free text. NOT constrained to the CCA's current licensee list — see the
    -- header for why a lapsed licence must not invalidate a real certificate.
    issuing_authority TEXT,

    -- The certificate serial as printed by the CA. Nullable because a firm
    -- copying forty tokens into a register will not read forty serials off
    -- forty certificates on day one, and an empty register is worse than an
    -- incomplete one.
    serial_number TEXT,

    -- INCLUSIVE BOUNDS. valid_to is the last day the certificate works, not the
    -- first day it does not. See the header — this differs from
    -- statute_calendar on purpose and the difference is load-bearing.
    valid_from DATE NOT NULL,
    valid_to   DATE NOT NULL,

    -- A certificate can die before valid_to: key compromise, the holder leaving
    -- the company, the CA revoking it. Set this and the certificate is dead
    -- from that date whatever valid_to says. Nullable, and NULL is the norm.
    revoked_on DATE,

    -- ── CUSTODY ─────────────────────────────────────────────────────────────
    -- The question a boolean cannot answer. "We do not have it" splits into at
    -- least three genuinely different facts, and a firm needs to tell them
    -- apart on filing morning:
    --   with_firm    the token is in the office and can be used today.
    --   with_client  we gave it back. It exists, it works, we must ask for it.
    --                This is the one that surprises people, and it is precisely
    --                as blocking as an expiry until someone drives over.
    --   never_held   we track this certificate's expiry as a service, but the
    --                client has always kept the token. Recording it as
    --                with_client would imply we once had it and returned it.
    --   in_transit   handed to a courier or a colleague; nobody can use it now.
    --   lost         cannot be found. Distinct from destroyed: a lost token may
    --                turn up, and a lost token is a security incident.
    --   destroyed    physically damaged or deliberately destroyed.
    --   surrendered  handed back to the CA. The certificate is finished.
    custody_status TEXT NOT NULL DEFAULT 'with_firm'
        CHECK (custody_status IN (
            'with_firm', 'with_client', 'never_held',
            'in_transit', 'lost', 'destroyed', 'surrendered')),

    -- Where the physical token actually is: "Safe, cabin 2", "Drawer B".
    custody_location TEXT,

    -- The NAME of the person holding it, when a person rather than a place
    -- holds it. A name and not a user id, for the same reason holder_name is a
    -- name: this is frequently a client's own accountant, and even when it is
    -- staff, the register is read by humans looking for a token.
    custody_holder_name TEXT,

    -- When the CURRENT custody state began. Not a history — see the header —
    -- but without it "with_client" is undated and nobody can tell a token
    -- returned last week from one returned in 2023.
    custody_changed_on DATE,

    token_kind TEXT NOT NULL DEFAULT 'usb_token'
        CHECK (token_kind IN ('usb_token', 'hsm', 'software', 'unknown')),

    -- The serial printed on the plastic, which is what someone reads out over
    -- the phone. Different from serial_number, which is inside the certificate.
    token_serial TEXT,

    -- Which portals this certificate is currently registered on: 'incometax',
    -- 'mca', 'gst', 'traces', 'dgft', 'epfo', 'esic', 'tender'. Free-form on
    -- purpose (portals appear and merge faster than a CHECK can be maintained),
    -- and here because RENEWING A DSC DOES NOT RE-REGISTER IT: the new
    -- certificate must be registered again on the income-tax portal before it
    -- will sign anything, and a firm that renews on the 28th and files on the
    -- 30th discovers this on the 30th.
    registered_portals TEXT[] NOT NULL DEFAULT '{}',

    notes TEXT,

    -- Soft delete, matching every other table in this schema. A certificate
    -- removed from the register is removed from the queries, not from history —
    -- an audit two years later asks what the firm held, not what it still holds.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A one-day certificate is legitimate (a re-issue on the day of expiry);
    -- a certificate that expires before it starts is a transposed pair of dates
    -- and every query downstream would then be quietly wrong.
    CONSTRAINT dsc_register_validity_order CHECK (valid_to >= valid_from),

    -- Revocation cannot predate issue. It CAN postdate valid_to — a CA
    -- publishing a revocation for an already-expired certificate is ordinary
    -- housekeeping and must not be rejected.
    CONSTRAINT dsc_register_revoked_after_issue
        CHECK (revoked_on IS NULL OR revoked_on >= valid_from),

    -- NOT NULL is not enough: '' and '   ' both pass it, and a register row
    -- whose holder is a blank string is a row nobody can act on. The whole
    -- value of this table is that a human can read a name off it.
    CONSTRAINT dsc_register_holder_name_present
        CHECK (btrim(holder_name) <> '')
);

-- THE INDEX THE WHOLE TABLE IS FOR: "what dies in the next thirty days", asked
-- by an org, every day, by a cron. Partial on is_active because a soft-deleted
-- certificate must never appear in an alert, and excluding it here means the
-- planner never has to look at one.
CREATE INDEX IF NOT EXISTS dsc_register_org_expiry_idx
    ON staging.dsc_register (org_id, valid_to)
    WHERE is_active;

-- The per-client view. NOT partial on is_active: the client detail page shows
-- retired certificates too, because "we used to hold three of theirs" is a
-- question a client asks.
CREATE INDEX IF NOT EXISTS dsc_register_org_client_idx
    ON staging.dsc_register (org_id, client_id);

-- "What are we not holding?" — the query that has no equivalent in any
-- spreadsheet anyone keeps today.
CREATE INDEX IF NOT EXISTS dsc_register_org_custody_idx
    ON staging.dsc_register (org_id, custody_status)
    WHERE is_active;

-- One certificate, one row. The duplicate this prevents is not a typo: it is
-- the same token entered twice, months apart, by two people, with two different
-- expiry dates — after which the register has an answer and a contradiction and
-- no way to tell which is which.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+; this database is 17.6, measured
-- 2026-08-19) is the point of the constraint. issuing_authority is nullable, and
-- under the default NULLS DISTINCT two rows with the same serial and no
-- authority would BOTH be allowed — which is exactly the case a firm typing
-- serials without CA names produces. Serials are unique per CA, not globally,
-- so the authority stays in the key.
CREATE UNIQUE INDEX IF NOT EXISTS dsc_register_serial_uniq
    ON staging.dsc_register (org_id, issuing_authority, serial_number)
    NULLS NOT DISTINCT
    WHERE serial_number IS NOT NULL AND is_active;

-- updated_at maintained by the DATABASE, for the reason migration 139 gives at
-- length: an UPDATE that forgets the stamp is invisible, and this table is a
-- candidate for delta sync the moment it has a mobile screen.
-- staging.touch_updated_at() already exists (138); this adds only the trigger.
DROP TRIGGER IF EXISTS trg_touch_dsc_register ON staging.dsc_register;
CREATE TRIGGER trg_touch_dsc_register
    BEFORE UPDATE ON staging.dsc_register
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

COMMENT ON TABLE staging.dsc_register IS
    'Digital signature certificates a practice holds for its clients. valid_to '
    'is the LAST day the certificate works (inclusive, mirroring X.509 '
    'notAfter) — the opposite convention to staging.statute_calendar. NULL '
    'client_id means the practice''s own certificate. Read through '
    'services/custody/dsc.py; never store a token PIN here.';

COMMENT ON COLUMN staging.dsc_register.custody_status IS
    'Where the physical token is NOW. "we do not have it" blocks a filing as '
    'hard as an expiry, and never_held / with_client / lost are three different '
    'facts a boolean cannot carry.';

COMMENT ON COLUMN staging.dsc_register.certificate_class IS
    'CCA classes (cca.gov.in/classes_of_certificates.html). class_2 is allowed '
    'deliberately: issuance was withdrawn from 1 Jan 2021 but certificates '
    'issued before then stayed valid to their own expiry, and a legacy register '
    'entry for one is real data.';

COMMIT;
