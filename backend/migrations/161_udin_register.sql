-- 161_udin_register.sql
--
-- THE UDIN REGISTER. A practising Chartered Accountant must obtain a Unique
-- Document Identification Number from the ICAI portal for every certificate,
-- every GST and tax audit report and every other audit, assurance and
-- attestation function they sign. The number can only be generated inside a
-- window that starts at signing, and once generated it can only be revoked
-- inside a much shorter one. Miss the first window and the document is signed
-- and unnumbered for ever: ICAI notification No.1-CA(7)/192/2019 was issued
-- under Item (1) of Part II of the Second Schedule to the Chartered Accountants
-- Act 1949 -- the clause that makes a contravention of a Council guideline
-- professional misconduct. It is not an administrative slip and it cannot be
-- fixed after the fact.
--
-- Kartavaya has never recorded any of this. Probed READ-ONLY against the live
-- catalogue on 19 August 2026: no table in `staging` or `public` has a name or
-- a column matching '%udin%', and none has a membership-number column either.
-- Every Indian practice-management competitor ships this register.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/161_udin_register.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 19 August 2026, deliberately not run.
--
-- == WHAT IT TOUCHES ========================================================
--
--   CREATES  staging.udin_register                  (new table, 0 rows)
--   CREATES  staging.udin_window                    (new table, 2 seeded rows)
--   CREATES  idx_udin_register_open                 (partial index, new table)
--   CREATES  idx_udin_register_revocable            (partial index, new table)
--   CREATES  uq_udin_register_udin                  (partial unique, new table)
--   CREATES  uq_udin_register_source                (partial unique, new table)
--   CREATES  idx_udin_register_client               (index, new table)
--   CREATES  uq_udin_window_version                 (unique, new table)
--   CREATES  trg_touch_udin_register                (trigger, new table)
--   CREATES  trg_touch_udin_window                  (trigger, new table)
--   INSERTS  2 rows into staging.udin_window        (its own new table)
--   READS    staging.organisations                  (FK target only)
--   READS    staging.graha_clients                  (FK target only)
--
--   ALTERS   nothing.  DROPS nothing (bar its own triggers, see below).
--   BACKFILLS nothing.  DELETES nothing.  UPDATEs nothing.
--   No existing table gains, loses or changes a column. No existing row is
--   read, rewritten or removed. `staging.sign_documents` is NOT touched and
--   gains no column -- see THE ESIGN QUESTION below, which is the reason.
--
-- == IF IT RUNS TWICE =======================================================
--
-- Nothing happens the second time.
--   * Every CREATE TABLE and CREATE INDEX is IF NOT EXISTS.
--   * The two seed rows are `ON CONFLICT ON CONSTRAINT uq_udin_window_version
--     DO NOTHING`, whose arbiter is (window_key, effective_from). DO NOTHING
--     and NOT DO UPDATE, on purpose: if a lead has corrected a window by hand
--     because the ICAI Council has moved it again, a re-run of this file must
--     not silently overwrite that correction with tonight's understanding.
--   * The two triggers are CREATE OR REPLACE TRIGGER (PG 14+; this server is
--     17.6, probed 19 August 2026). There is no CREATE TRIGGER IF NOT EXISTS
--     in any Postgres, and OR REPLACE is the one idempotent spelling that
--     never leaves a window with no trigger attached.
-- Re-running after rows exist is equally safe: nothing here writes to
-- `udin_register` at all, and the `udin_window` seed cannot mint a duplicate.
--
-- == HOW TO UNDO IT =========================================================
--
--     DROP TABLE IF EXISTS staging.udin_register;   -- takes its indexes/trigger
--     DROP TABLE IF EXISTS staging.udin_window;
--
-- That is the whole reversal and it is lossless with respect to every other
-- table, because nothing else references either of these. It does discard the
-- register itself, which is a statutory record -- dump it first if any firm has
-- entered anything.
--
-- == THE TWO CLOCKS, AND WHY THEY ARE DIFFERENT TYPES =======================
--
-- These are the only two numbers in this file that come from outside it, and
-- they are both Council decisions, both of which have already moved once.
--
--   GENERATION: 60 days, counted in WHOLE DAYS from the date of signing, and
--   BOTH END DATES COUNT. ICAI FAQs on UDIN (6th edition, January 2026) Q19
--   (it was Q17 in the 4th edition -- the numbering moves between editions,
--   which is why the wording is quoted here and not merely the number):
--   "UDIN is to be generated at the time of signing the Documents. However, in
--   alignment with SQC-1 and SA 230, the same can be generated within 60 days
--   ... from the signing of the same (both the dates i.e signing of the
--   document and date of generation of UDIN are included in the time
--   allowed)." Council, 405th meeting, 17 September 2021, which RAISED it from
--   15 days -- proof the number moves.
--     https://udin.icai.org/assets/images/FAQs%20on%20UDIN.pdf
--   That is the LIVE copy: ICAI replaces it in place at each edition, so it
--   does not rot -- but the question numbers behind it move, so re-find the
--   quoted sentence rather than trusting Q19 to still be Q19.
--   Because both ends count, the last permissible date is
--   `signed_on + (window_days - 1)`, NOT `signed_on + window_days`. Writing the
--   obvious `+ 60` hands the firm a day it does not have. That off-by-one is
--   the single most likely bug in anything built on this table and it is why
--   the arithmetic lives in ONE place, `services/custody/udin.py`, and is
--   deliberately NOT duplicated as a generated column here.
--   `signed_on` is therefore a DATE and not a timestamptz: the certificate
--   bears a date, the Council counts days, and a timestamptz would make the
--   answer depend on the server's timezone -- a document signed at 23:30 IST
--   would lose a day the moment the process ran in UTC.
--
--   REVOCATION: 48 HOURS, counted from the INSTANT of generation, not from
--   signing and not in days. ICAI announcement of 23 June 2023, Council 420th
--   meeting 23-24 March 2023: "revocation of UDINs would now be possible
--   within 48 hours from the time of its generation."
--     https://udin.icai.org/announcement/udin_2023-06-23
--   Hence `udin_generated_at` is a timestamptz and `signed_on` is a date, and
--   the difference is load-bearing, not stylistic. FAQ Q124 completes the rule:
--   a member who misses the 48 hours "has to generate a fresh UDIN within the
--   permissible time limit" -- so a revocation points FORWARD, which is what
--   `replaced_by_udin` is for.
--
-- Both live in `staging.udin_window`, effective-dated, so a Council decision is
-- a one-row INSERT rather than a deploy. `services/custody/udin.py` falls back
-- to the same two numbers as Python constants if this table is absent or empty,
-- so the service works before this file is applied -- it just cannot be
-- corrected without a deploy until it is.
--
-- INTEGRATION POINT (statute): a sibling agent is building
-- `staging.statute_calendar` (migration 158, also unapplied) as the general home
-- for dated statutory facts. `udin_window` is deliberately NOT that table and
-- does not depend on it, because the register must work whether or not 158 is
-- applied. When 158 lands, seeding `icai.udin.generate_window` and
-- `icai.udin.revoke_window` there and pointing `load_windows()` at
-- `services/statute.py` is a body change only: `load_windows` already takes
-- `as_of` and already resolves the half-open window [effective_from,
-- effective_to) exactly the way `services/statute.py` does.
--
-- == THE ESIGN QUESTION, WHICH IS THE DESIGN DECISION IN THIS FILE ==========
--
-- Should a UDIN row hang off `staging.sign_documents`? No. Probed READ-ONLY,
-- 19 August 2026 (67 rows, 97 signers):
--
--   * `sign_documents` models an ENVELOPE SENT OUT FOR COUNTERSIGNATURE. Its
--     columns are `signers_total`, `signers_completed`, and per signer a
--     `token`, an `otp_code`, `otp_expires_at`, `signature_data` and a
--     `declined_reason`. Its statuses are draft / sent / partially_signed /
--     completed / cancelled / expired.
--   * A UDIN-bearing document has exactly ONE signatory, who is a member of
--     the FIRM, not a counterparty. There is nothing to send, no OTP, no
--     token, and the signatory cannot decline their own certificate.
--   * `sign_documents` HAS NO CLIENT COLUMN AT ALL -- there is no `client_id`
--     on it, and 62 of its 67 rows have `source_module` NULL. The UDIN
--     register's primary axis is the client, because that is what the ICAI
--     portal asks for and what a firm answers "have we numbered everything we
--     signed for this client" against.
--   * The clocks are unrelated. `sign_documents.expires_at` is a signing-link
--     expiry the firm chooses and can extend. The 60 days is statutory and
--     cannot be extended by anybody.
--   * The duty does not follow the surface. eSign here is web-only (settled
--     decision); the UDIN obligation attaches to a report signed on paper, with
--     a DSC, or in another firm's software, and most of them will be. A
--     register that can only hold what passed through this product's eSign
--     would be silently incomplete, which is the worst possible failure mode
--     for a compliance register.
--   * The other direction fails too: an engagement letter countersigned by a
--     client -- the commonest thing in `sign_documents` here, by title --
--     creates NO UDIN duty at all. It is not a certificate, a report or an
--     attest function.
--
-- So: separate table, and a LOOSE link for the real overlap, which is a firm
-- that does e-sign a certificate through Kartavaya. `source_module` /
-- `source_id` mirror the pair `sign_documents` already carries, and there is
-- deliberately NO foreign key to `sign_documents`: envelopes get cancelled and
-- purged, and a statutory register must outlive the workflow artefact that
-- happened to produce the document. `uq_udin_register_source` stops the same
-- envelope minting two register rows.
--
-- == NAMES, NOT IDS =========================================================
--
-- `client_name` and `signed_by_member` are NOT NULL text snapshots taken at
-- signing, alongside (not instead of) the `client_id` link. Three reasons, and
-- the first is a real trigger in this database:
--   * `staging.graha_clients` carries `trg_client_rename_cascades`. Clients get
--     renamed. The register must keep saying what the DOCUMENT said, because
--     that is what the ICAI portal holds and what a reviewer will compare.
--   * `client_id` is `ON DELETE SET NULL`; without the snapshot, deleting a
--     client would erase which entity a signed certificate was issued for.
--   * The signatory may be a partner who has no login here at all, so a user
--     link alone cannot name them. `signed_by_user_id` is optional and is TEXT
--     with NO foreign key: the actor identifiers this application writes are
--     `user_`-prefixed strings (`sign_documents.created_by` holds e.g.
--     'user_21457956f010') while `public.users.id` is a uuid. Migrations 030,
--     092 and 159 are the three previous scars from forgetting that.
-- `services/custody/udin.py` never returns `client_id`, `org_id` or
-- `signed_by_user_id` in a row it hands out. Only names.
--
-- == GSTIN / PAN / TAN / MRN BLOCK NOTHING ==================================
--
-- `signed_by_membership_no` (the ICAI MRN) is NOT NULL DEFAULT '' and has no
-- format CHECK. It is genuinely useful -- digits 3-8 of a UDIN ARE the MRN, so
-- knowing it lets the service flag a pasted-in UDIN that belongs to a different
-- member -- but that is an ADVISORY in Python, never a constraint here. This
-- product's rule that statutory identifiers must block nothing has regressed
-- twice; it is not going to regress from this file.
--
-- The `udin` CHECK is likewise deliberately loose: 18 alphanumeric characters,
-- and nothing about the internal syntax. The published syntax is
-- YY MMMMMM AAAAAANNNN (FAQ Q4, e.g. 19304576AKTSBN1359), and
-- `services/custody/udin.py` reports departures from it -- but a CHECK that
-- encoded it would refuse to record a REAL UDIN the day ICAI changes the
-- generator, and a register that cannot record the truth is worse than one that
-- records it with a warning.
--
-- == WHY THERE IS NO 'lapsed' STATUS ========================================
--
-- The window closing is a fact about TODAY, not a state change anybody
-- performs. A stored 'lapsed' needs a nightly job to flip it, and the row is
-- wrong between midnight and whenever that job runs -- which is exactly the
-- moment somebody is looking. It is derived, once, in
-- `services/custody/udin.py`. `status` records only what a HUMAN did: signed
-- it, numbered it, revoked it, or judged it out of scope.
--
-- == LOCKS ==================================================================
--
-- Two CREATE TABLEs of relations nothing else references, and their indexes,
-- all built on brand-new empty tables in the same transaction (so no
-- CONCURRENTLY is needed -- there is nothing to scan). The only locks on live
-- relations are taken by the foreign keys: ShareRowExclusiveLock on
-- `staging.organisations` and on `staging.graha_clients` for a catalogue
-- update, which blocks WRITES (not reads) to those two for microseconds. Both
-- are read constantly and written rarely. `lock_timeout` below turns a queue
-- behind an open long transaction into a clean rollback rather than a stall.
--
-- == APPLYING IT CHANGES NO BEHAVIOUR BY ITSELF =============================
--
-- Nothing reads either table until a caller imports
-- `services/custody/udin.py`, and no router does yet. Production (main,
-- 1aa49855) does not know these tables exist. Applying this file cannot change
-- any figure any user sees today.

BEGIN;

-- A queued ShareRowExclusive lock blocks everything that arrives behind it.
-- Five seconds then failing cleanly beats stalling `organisations`.
SET LOCAL lock_timeout = '5s';


-- ── the windows ─────────────────────────────────────────────────────────────
-- Effective-dated so that a Council decision is an INSERT, not a deploy. The
-- 15-days-to-60-days change of 17 September 2021 is why this is a table and not
-- two constants: it has moved once already, inside the life of UDIN itself.
CREATE TABLE IF NOT EXISTS staging.udin_window (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 'generate' or 'revoke'. Two keys today; the CHECK is a spelling guard,
    -- not a taxonomy -- a third key would be a migration, which is correct,
    -- because a third window would need service code to mean anything.
    window_key      text        NOT NULL,

    -- The magnitude, in the UNIT below. Kept as two columns rather than one
    -- interval because the generation window is counted in whole days with
    -- both ends inclusive (a calendar rule) and the revocation window is
    -- counted in hours from an instant (a clock rule). An interval would let a
    -- caller apply the wrong arithmetic to the right number.
    window_amount   integer     NOT NULL,
    window_unit     text        NOT NULL,

    -- Half-open: [effective_from, effective_to). `effective_to` is the first
    -- day the fact is NOT true. Same convention as `staging.statute_calendar`
    -- (migration 158) on purpose -- two different resolvers disagreeing about
    -- an inclusive end date is an invisible bug in both.
    effective_from  date        NOT NULL,
    effective_to    date,

    -- Where the number came from. A compliance window with no citation is a
    -- rumour; this column is why the next person does not have to re-derive it.
    source_note     text        NOT NULL DEFAULT '',
    source_url      text        NOT NULL DEFAULT '',

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT udin_window_key_ck
        CHECK (window_key IN ('generate', 'revoke')),
    CONSTRAINT udin_window_unit_ck
        CHECK (window_unit IN ('days', 'hours')),
    -- A zero or negative window would silently mark every signed document
    -- lapsed on the day it was signed.
    CONSTRAINT udin_window_amount_ck
        CHECK (window_amount > 0),
    CONSTRAINT udin_window_range_ck
        CHECK (effective_to IS NULL OR effective_to > effective_from),
    -- The arbiter for the seed's ON CONFLICT. Named, so the INSERT can name it
    -- and cannot silently bind to some other index later.
    CONSTRAINT uq_udin_window_version
        UNIQUE (window_key, effective_from)
);

COMMENT ON TABLE staging.udin_window IS
    'Effective-dated ICAI UDIN windows: how long after signing a UDIN may be '
    'generated (days, both ends inclusive) and how long after generation it '
    'may be revoked (hours from the instant). Read via '
    'services/custody/udin.py load_windows(); half-open [from, to).';


-- ── the register ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.udin_register (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant. CASCADE: a register is meaningless once the firm is gone, and it
    -- matches every other org-owned table here.
    org_id                  uuid        NOT NULL
                              REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- WHICH CLIENT. `graha_clients` is the company -- the customer -- which is
    -- exactly the entity a certificate is issued for. Nullable because a firm
    -- signs things for parties it has never opened a CRM record for (a bank
    -- certificate for a walk-in), and a NOT NULL here would push people into
    -- creating junk clients or, worse, into not recording the document at all.
    client_id               uuid
                              REFERENCES staging.graha_clients(id) ON DELETE SET NULL,

    -- The entity AS NAMED ON THE DOCUMENT. See NAMES, NOT IDS in the header:
    -- clients get renamed (there is a rename-cascade trigger on that table) and
    -- the link is ON DELETE SET NULL. This is the register's own record.
    client_name             text        NOT NULL,

    -- ICAI's own three mandatory categories, with the dates they each became
    -- mandatory (FAQ Q5 / notification No.1-CA(7)/192/2019, Gazette 2 Aug 2019):
    --   certificate                    -- all Certificates,        w.e.f. 01-02-2019
    --   gst_or_tax_audit_report        -- GST and Tax Audit Reports, w.e.f. 01-04-2019
    --   audit_assurance_attestation    -- all other Audit, Assurance
    --                                     and Attestation functions, w.e.f. 01-07-2019
    -- Kept as ICAI's three and not as a free-text document type, because these
    -- are the three the UDIN portal itself splits on -- a firm choosing one
    -- here has already answered the question the portal will ask.
    document_kind           text        NOT NULL,

    -- What a person would recognise. Names, not ids.
    document_title          text        NOT NULL,

    -- The firm's own reference on the document, if it has one. Optional and
    -- blocks nothing.
    document_ref            text        NOT NULL DEFAULT '',

    -- '2025-26' style, or ''. Optional: plenty of certificates are not
    -- year-bound. Loose CHECK below, and it permits '' -- see the header on
    -- statutory identifiers blocking nothing.
    financial_year          text        NOT NULL DEFAULT '',

    -- THE DATE THE DOCUMENT WAS SIGNED. A date, not a timestamp -- see THE TWO
    -- CLOCKS. Day 1 of the 60 is this date itself.
    signed_on               date        NOT NULL,

    -- The member who signed, BY NAME. NOT NULL: a register that cannot say who
    -- signed is not a register. The person may have no login here.
    signed_by_member        text        NOT NULL,

    -- ICAI membership number (MRN). Optional, no format CHECK, blocks nothing.
    -- Digits 3-8 of a UDIN are the MRN, so when this is present the service can
    -- flag a UDIN that belongs to somebody else -- as an advisory, never a bar.
    signed_by_membership_no text        NOT NULL DEFAULT '',

    -- The platform account, when the signatory has one. TEXT and no FK: this
    -- application writes `user_`-prefixed identifiers while `public.users.id`
    -- is a uuid. '' means "no platform account", one absent value and not two.
    signed_by_user_id       text        NOT NULL DEFAULT '',

    -- THE NUMBER. '' until generated. 18 alphanumerics and nothing more
    -- specific -- see the header on why the syntax is checked in Python.
    udin                    text        NOT NULL DEFAULT '',

    -- The INSTANT of generation. The 48-hour revocation window runs from here,
    -- not from `signed_on`, which is why this one is a timestamptz.
    udin_generated_at       timestamptz,

    -- What a HUMAN did. There is no 'lapsed' -- see the header.
    --   signed        signed, not yet numbered. The at-risk state.
    --   generated     numbered.
    --   revoked       numbered, then revoked inside the 48 hours.
    --   not_required  the firm's recorded judgement that this document carries
    --                 no UDIN duty. Worth storing: an empty row in the at-risk
    --                 list forever is how a register stops being read.
    status                  text        NOT NULL DEFAULT 'signed',

    revoked_at              timestamptz,
    revocation_reason       text        NOT NULL DEFAULT '',

    -- FAQ Q124: a member who revokes must generate a FRESH UDIN within the
    -- permissible time. FAQ Q127: the revoked one cannot be regenerated on the
    -- old signature date beyond the 60 days. So a revocation points forward,
    -- and this column is how the register shows the replacement exists.
    replaced_by_udin        text        NOT NULL DEFAULT '',

    -- The loose link to whatever produced the document. See THE ESIGN QUESTION.
    -- Deliberately no FK: envelopes are cancelled and purged, statutory records
    -- are not.
    source_module           text        NOT NULL DEFAULT '',
    source_id               uuid,

    notes                   text        NOT NULL DEFAULT '',

    created_by              text        NOT NULL DEFAULT '',
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT udin_register_kind_ck
        CHECK (document_kind IN ('certificate',
                                 'gst_or_tax_audit_report',
                                 'audit_assurance_attestation')),
    CONSTRAINT udin_register_status_ck
        CHECK (status IN ('signed', 'generated', 'revoked', 'not_required')),

    -- A blank name makes the row unreadable in the one list it exists to feed.
    CONSTRAINT udin_register_client_name_ck
        CHECK (length(btrim(client_name)) > 0),
    CONSTRAINT udin_register_title_ck
        CHECK (length(btrim(document_title)) > 0),
    CONSTRAINT udin_register_member_ck
        CHECK (length(btrim(signed_by_member)) > 0),

    -- 18 alphanumerics, or absent. Nothing about the internal syntax: see the
    -- header. `''` is the single absent value (migration 106's rule), so no
    -- caller has to test for NULL and '' both.
    CONSTRAINT udin_register_udin_shape_ck
        CHECK (udin = '' OR udin ~ '^[0-9A-Za-z]{18}$'),

    -- '' or '2025-26'. Permissive on purpose; a wrong-looking FY must not stop
    -- a firm recording that a document was signed.
    CONSTRAINT udin_register_fy_ck
        CHECK (financial_year = '' OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'),

    -- The status and the facts must agree, or the at-risk list lies. These four
    -- are the whole integrity story of this table:
    --   'signed'      -> no number yet. A row holding a UDIN while claiming to
    --                    be unnumbered would sit in the at-risk list for ever
    --                    and train people to ignore it.
    CONSTRAINT udin_register_signed_ck
        CHECK (status <> 'signed'
               OR (udin = '' AND udin_generated_at IS NULL AND revoked_at IS NULL)),
    --   'generated'   -> a number and the instant it was generated. Without
    --                    the instant there is no 48-hour window to compute.
    CONSTRAINT udin_register_generated_ck
        CHECK (status <> 'generated'
               OR (udin <> '' AND udin_generated_at IS NOT NULL AND revoked_at IS NULL)),
    --   'revoked'     -> all of the above plus when it was revoked.
    CONSTRAINT udin_register_revoked_ck
        CHECK (status <> 'revoked'
               OR (udin <> '' AND udin_generated_at IS NOT NULL AND revoked_at IS NOT NULL)),
    --   'not_required'-> no number, by definition.
    CONSTRAINT udin_register_not_required_ck
        CHECK (status <> 'not_required'
               OR (udin = '' AND udin_generated_at IS NULL AND revoked_at IS NULL)),

    -- A UDIN cannot be generated before the document is signed -- the window
    -- starts at signing. Compared in UTC against the signing DATE with a day of
    -- slack on the near side, because `signed_on` has no time and no timezone:
    -- a document signed on the 5th in IST can legitimately carry a generation
    -- instant that is still the 4th in UTC. The slack is what stops this
    -- constraint rejecting honest data; it is a sanity bar, not the window.
    --
    -- WRITTEN THIS WAY BECAUSE A CHECK MUST BE IMMUTABLE, and the obvious
    -- `udin_generated_at >= (signed_on - 1)::timestamptz` is NOT: probed on the
    -- live server 19 August 2026, pg_cast says date -> timestamptz is STABLE
    -- (it reads the session TimeZone), and Postgres refuses a non-immutable
    -- expression in a CHECK -- so that spelling fails at APPLY time, not at
    -- write time, which is the worst place to find out. `timezone(text,
    -- timestamptz) -> timestamp` is IMMUTABLE and `timestamp -> date` is
    -- IMMUTABLE, so this direction is legal. Do not "simplify" it back.
    CONSTRAINT udin_register_order_ck
        CHECK (udin_generated_at IS NULL
               OR (udin_generated_at AT TIME ZONE 'UTC')::date >= signed_on - 1),
    CONSTRAINT udin_register_revoke_order_ck
        CHECK (revoked_at IS NULL
               OR udin_generated_at IS NULL
               OR revoked_at >= udin_generated_at),
    CONSTRAINT udin_register_replacement_ck
        CHECK (replaced_by_udin = '' OR replaced_by_udin ~ '^[0-9A-Za-z]{18}$'),
    -- A replacement is only meaningful for something that was revoked.
    CONSTRAINT udin_register_replacement_status_ck
        CHECK (replaced_by_udin = '' OR status = 'revoked')
);

-- THE KEY QUERY'S INDEX: "signed, no UDIN, day N of the window". Partial on
-- `status = 'signed'`, which is the only status the at-risk list reads, so the
-- index stays the size of the open work rather than the size of the register --
-- and a firm's register grows without bound while its open work does not.
-- Ordered by `signed_on` ASC, which IS least-time-left-first: every open row
-- shares the same window, so the oldest signing has the nearest deadline. The
-- service still re-sorts by computed deadline (see its docstring) -- this index
-- makes the scan cheap, it is not where the correctness lives.
CREATE INDEX IF NOT EXISTS idx_udin_register_open
    ON staging.udin_register (org_id, signed_on)
    WHERE status = 'signed';

-- The 48-hour question: what can still be revoked right now. Partial for the
-- same reason -- 'generated' rows older than two days can never answer yes, but
-- there is no way to express that in an index predicate (now() is not
-- immutable), so the predicate is the status and the service applies the clock.
CREATE INDEX IF NOT EXISTS idx_udin_register_revocable
    ON staging.udin_register (org_id, udin_generated_at DESC)
    WHERE status = 'generated';

-- One row per UDIN per firm. The realistic error this catches is a copy-paste:
-- the same number recorded against two documents, which would make one of them
-- look numbered when it is not. Scoped to the org rather than global even
-- though a UDIN is globally unique, because a global unique index leaks the
-- existence of another firm's row through a constraint violation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_udin_register_udin
    ON staging.udin_register (org_id, udin)
    WHERE udin <> '';

-- One register row per source artefact, so re-running an importer or clicking
-- twice on an e-signed certificate cannot mint a duplicate obligation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_udin_register_source
    ON staging.udin_register (org_id, source_module, source_id)
    WHERE source_id IS NOT NULL AND source_module <> '';

-- "Everything we have signed for this client." The second question a firm asks
-- of this table, and the one a client asks of the firm.
CREATE INDEX IF NOT EXISTS idx_udin_register_client
    ON staging.udin_register (org_id, client_id, signed_on DESC)
    WHERE client_id IS NOT NULL;

COMMENT ON TABLE staging.udin_register IS
    'One row per document a member of the firm has signed that may carry an '
    'ICAI UDIN duty. status records what a human did (signed/generated/'
    'revoked/not_required); whether the 60-day generation window has lapsed is '
    'DERIVED in services/custody/udin.py and is deliberately not stored. '
    'client_name and signed_by_member are snapshots taken at signing.';

COMMENT ON COLUMN staging.udin_register.signed_on IS
    'Date of signing. Day 1 of the generation window is this date itself -- '
    'ICAI counts both end dates -- so the last permissible date is '
    'signed_on + (window_days - 1). Never signed_on + window_days.';

COMMENT ON COLUMN staging.udin_register.udin_generated_at IS
    'Instant the UDIN was generated on the ICAI portal. The 48-hour revocation '
    'window runs from HERE, not from signed_on.';


-- ── updated_at ──────────────────────────────────────────────────────────────
-- `staging.touch_updated_at()` already exists (migration 138, verified present
-- on the live server 19 August 2026, returns `trigger`).
--
-- CREATE OR REPLACE TRIGGER, not the DROP-then-CREATE that migration 138 used:
-- there is no CREATE TRIGGER IF NOT EXISTS in any Postgres, and OR REPLACE
-- (PG 14+, this server is 17.6 -- probed) is the only spelling that is
-- idempotent WITHOUT a window in which the trigger does not exist. On a table
-- created in the same transaction that window is theoretical; on a re-run
-- against a live table it is not, and a row updated inside it would keep a
-- stale `updated_at` for ever with nothing to show why.
CREATE OR REPLACE TRIGGER trg_touch_udin_register
    BEFORE UPDATE ON staging.udin_register
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

CREATE OR REPLACE TRIGGER trg_touch_udin_window
    BEFORE UPDATE ON staging.udin_window
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();


-- ── the seed: two Council decisions, with their citations ───────────────────
-- effective_from is the date the decision took effect, not the date it was
-- announced. Both rows are open-ended: these are the windows in force today.
--
-- The 15-day window that preceded 17 September 2021 is deliberately NOT seeded.
-- It would be correct history, and it would be actively dangerous: a row signed
-- in 2020 and entered into this register in 2026 would be resolved against a
-- 15-day window and reported as long lapsed, when the honest answer for
-- back-entered history is "we do not track this retrospectively". If a firm
-- ever needs the historical window, insert it deliberately and knowingly.
INSERT INTO staging.udin_window
    (window_key, window_amount, window_unit, effective_from, effective_to,
     source_note, source_url)
VALUES
    ('generate', 60, 'days', DATE '2021-09-17', NULL,
     'ICAI Council 405th meeting, 17 September 2021: time limit for generating '
     'UDIN raised from 15 days to 60 days from the date of signing, to align '
     'with SQC-1 and SA 230. FAQs on UDIN (6th edn, January 2026) Q19: both the '
     'date of signing and the date of generation are included in the time '
     'allowed -- so the last permissible date is signed_on + 59 days.',
     'https://udin.icai.org/assets/images/FAQs%20on%20UDIN.pdf'),

    ('revoke', 48, 'hours', DATE '2023-06-23', NULL,
     'ICAI Council 420th meeting, 23-24 March 2023, announced 23 June 2023: '
     'revocation of a UDIN is possible only within 48 hours from the TIME of '
     'its generation. Applies to UDINs generated on or after 23 June 2023. '
     'FAQ Q124: a member who misses it must generate a fresh UDIN within the '
     'permissible time limit.',
     'https://udin.icai.org/announcement/udin_2023-06-23')
ON CONFLICT ON CONSTRAINT uq_udin_window_version DO NOTHING;

COMMIT;
