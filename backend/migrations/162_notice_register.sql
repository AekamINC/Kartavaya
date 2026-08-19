-- 162_notice_register.sql
--
-- THE CLOCK THAT ESCALATES ON ITS OWN. Every other register in this product
-- tracks something that merely expires: a DSC goes stale, a licence lapses, and
-- the practice renews it late and apologises. A department notice is different.
-- A GST ASMT-10 that goes unanswered is escalated by the officer into a s.73/74
-- determination. A DRC-01 that goes unanswered becomes a DRC-07 demand order
-- passed on whatever the record happens to say. A DRC-07 that goes unpaid for
-- three months becomes recovery under s.79 -- a garnishee order to the client's
-- bank. Nobody has to remember to punish the practice; missing the date is the
-- punishment. This is therefore the highest-consequence clock in the product,
-- and it is the one thing Kartavaya has never held.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/162_notice_register.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 19 August 2026. Measured against the live catalogue:
-- to_regclass('staging.notice_register') -> NULL and
-- to_regclass('staging.notice_type')     -> NULL. The only table in either
-- schema whose name contains "notice" is `staging.pahchan_notice_acknowledge-
-- ments`, which is a DPDP consent record and has nothing to do with this.
--
-- == WHAT IT TOUCHES ========================================================
--
--   CREATES  staging.notice_type                     (new table, then 7 seed rows)
--   CREATES  staging.notice_register                 (new table, 0 rows)
--   CREATES  uq_notice_type_code                     (UNIQUE constraint + its index)
--   CREATES  uq_notice_register_reference            (unique index on notice_register)
--   CREATES  idx_notice_register_due                 (partial index, live notices)
--   CREATES  idx_notice_register_client              (per-client history index)
--   CREATES  idx_notice_register_owner               (partial index, open by owner)
--   READS    staging.organisations                   (FK target only)
--   READS    staging.graha_clients                   (FK target only)
--   READS    public.users                            (FK target only)
--
--   ALTERS nothing. DROPS nothing. BACKFILLS nothing. DELETES nothing. No
--   existing table gains, loses or changes a column, and no existing row is
--   read, rewritten or removed. The three FK targets are referenced, never
--   written; each gains one more inbound constraint and nothing else.
--
--   Cross-schema FK (staging -> public.users) is the established pattern here,
--   not an experiment: 24 such constraints already exist, including
--   staging.crm_deals.owner_id and staging.crm_leads.assigned_to. Counted
--   against pg_constraint on the live database, 19 August 2026.
--
-- == IF IT RUNS TWICE =======================================================
--
-- Nothing happens the second time. Both CREATE TABLE and all four CREATE INDEX
-- are IF NOT EXISTS (uq_notice_type_code rides along inside CREATE TABLE IF NOT
-- EXISTS as a table constraint, so it too is a no-op on a replay); the only
-- INSERT is the notice_type seed and it carries
-- ON CONFLICT ON CONSTRAINT uq_notice_type_code DO NOTHING.
--
-- DO NOTHING and not DO UPDATE, deliberately. If a lead has corrected a seeded
-- window or reworded a consequence by hand -- or worse, if Parliament has moved
-- one and somebody has already fixed it -- a replay of this file must not
-- silently restore tonight's understanding of the law over the correction.
-- A statutory change is a NEW row with a new `code`, never an edit of an old
-- one, because register rows in flight are pointing at the old one.
--
-- == HOW TO UNDO IT =========================================================
--
--     DROP TABLE IF EXISTS staging.notice_register;   -- FK child first
--     DROP TABLE IF EXISTS staging.notice_type;
--
-- In that order. Reversed, the second statement fails on the dependency, which
-- is the intended protection and not a bug. Both drops take their own indexes.
-- Lossless with respect to every other table -- nothing else references either
-- of these -- but it discards the register itself, which in this module is the
-- practice's evidence of what it was told and when. Dump both tables first if
-- any org has used them.
--
-- ── WHY THE NOTICE TYPE IS A TABLE AND NOT AN ENUM ──────────────────────────
--
-- Notice types appear constantly and from three different directions: a new
-- rule mints a form (rule 88C minted DRC-01B in 2022, rule 88D minted DRC-01C
-- in 2023), a state authority uses its own paper, and a practice tracks things
-- the statute never named at all. A CHECK-constrained text column or a Postgres
-- enum makes each of those a migration -- which means each of those waits for a
-- release, which means the practice tracks the notice in a spreadsheet in the
-- meantime, which is exactly the failure this register exists to end.
--
-- So types live in a table, and `org_id IS NULL` marks a type Aekam ships to
-- everybody while `org_id = <org>` marks one a practice minted for itself. The
-- unique index uses NULLS NOT DISTINCT so a re-run cannot mint a second copy of
-- a system type just because its org_id is NULL. (Server is PostgreSQL 17.6;
-- NULLS NOT DISTINCT needs 15+.)
--
-- ── THE TWO CLOCKS, WHICH IS THE PART THAT IS EASY TO GET WRONG ─────────────
--
-- The brief for this table said "GST DRC-01 -> reply within 30 days". That is
-- two different facts welded together and the weld is wrong.
--
--   * Rule 142 of the CGST Rules prescribes NO reply period for a DRC-01. The
--     representation goes in FORM GST DRC-06 (rule 142(4)) and the date is
--     whatever the proper officer wrote on the notice. There is no statutory
--     30 days to compute against.
--   * The 30 days that DOES exist is a different clock and buys a different
--     thing: s.73(8) -- pay the tax and interest within thirty days of the SCN
--     and NO penalty is payable. Under s.74(8) the same thirty days concludes
--     proceedings on payment of tax, interest and 25% penalty.
--
-- Encoding "30 days" as the DRC-01 reply window would therefore have printed a
-- confident, statutory-looking due date that no statute supports, and hidden
-- the concession window that is worth real money. Hence `window_basis`:
--
--   'statutory_fixed'   the statute fixes the period. Compute the date.
--   'statutory_max'     the officer sets it, capped by statute (ASMT-10:
--                       rule 99(1) says "not exceeding thirty days ... or such
--                       further period as may be permitted by him"). Compute
--                       the cap, and treat the cap as the date until somebody
--                       reads the actual notice and fills in due_on_override.
--   'notice_specified'  the statute fixes nothing. There is no date to compute;
--                       due_on_override is REQUIRED and the row is rejected
--                       without it, rather than inventing a deadline.
--
-- A compliance product that invents a deadline is worse than one that has none:
-- the invented one is believed.
--
-- ── WHY THE WINDOW IS SNAPSHOTTED AND THE PROSE IS NOT ──────────────────────
--
-- `reply_window_days` / `reply_window_months` are copied onto the register row
-- at insert, even though the catalogue already holds them. They are inputs to a
-- STORED generated column: if the register read them through a join and the
-- catalogue were later corrected, every historical due date would silently move
-- and the practice's record of what it was working to would be rewritten
-- underneath it. Numbers that a computed date depends on are snapshotted.
--
-- The consequence PROSE is not snapshotted and is read through the join on
-- purpose: better wording is an improvement to every row that ever pointed at
-- that type, including closed ones, and no date depends on it.
--
-- ── WORKING DAYS ARE NOT DAYS ───────────────────────────────────────────────
--
-- Rule 22(1) gives SEVEN WORKING DAYS to show cause on a REG-17 against
-- cancellation of registration. This database has no holiday calendar -- there
-- is no national one to have, since a GST holiday depends on the state -- so
-- the computed date treats those seven as calendar days. That is always EARLIER
-- than the true deadline, never later, which is the only direction an error in
-- this table is allowed to point. `window_in_working_days` marks the row so the
-- service can say so out loud instead of overstating its own precision.
--
-- ── WHO MAY READ THIS ───────────────────────────────────────────────────────
--
-- This table is a list of which clients are under assessment. It is the most
-- sensitive operational data in the product and it is commercially damaging in
-- a way an invoice register is not. No access rule is implemented here (the
-- brief asked for a recommendation, not an implementation) and none should be
-- inferred from the absence of one -- the recommendation is in the handover
-- report, and this table MUST NOT be exposed by a router until it lands.
--
-- ── SOURCES FOR EVERY SEEDED WINDOW ─────────────────────────────────────────
--
-- Each seed row carries its own `source_url`. They were read on 19 August 2026
-- and the statutory positions they encode are:
--   s.61 + r.99      ASMT-10, explanation in ASMT-11, "not exceeding 30 days"
--   r.88C            DRC-01B, 7 days, else GSTR-1/IFF is blocked (r.59(6))
--   r.88D            DRC-01C, 7 days, same blocking consequence
--   r.22(1)/(2)      REG-17, 7 WORKING days; r.22(2) puts the reply in REG-18
--                    and gives it the same period
--   r.142(1) + 142(4) DRC-01, representation in DRC-06, no statutory period
--   r.142(5)/(6) + s.78  DRC-07 is itself the recovery notice; 3 months to pay
--   s.107(1) + 107(6)    APL-01, 3 months, 10% pre-deposit capped Rs 20 crore
--
-- Nothing in here depends on the Income-tax Act 2025 renumbering (16->130,
-- 24Q->138, 206AA->s.397(2) and the rest): GST form and section numbers were
-- untouched by it. Income-tax notice types are deliberately NOT seeded for that
-- exact reason -- see `statute_key` below, which is the integration point.

BEGIN;

-- A queued ShareRowExclusive lock blocks everything behind it. Five seconds
-- then failing cleanly beats stalling `organisations` or `graha_clients`, both
-- of which are on hot read paths.
SET LOCAL lock_timeout = '5s';


-- ═══ THE CATALOGUE ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.notice_type (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- NULL = a system type Aekam ships to every org. Non-NULL = a type one
    -- practice minted for itself. CASCADE is right only for the second kind and
    -- is harmless for the first, which can never match an org row.
    org_id                 uuid REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- Stable slug. This is what a register row is really pointing at, so it is
    -- never edited: a statutory change mints a NEW code.
    code                   text        NOT NULL,

    -- Bilingual-safe display string. Names, not ids -- and never a client name.
    label                  text        NOT NULL,

    -- Which department. Free text with a shape check, NOT an enum: GST, income
    -- tax, MCA, PF, ESI, professional tax and every state commercial-tax
    -- authority are all real, and a new one must not need a migration.
    authority              text        NOT NULL,

    -- The form the department sends, e.g. 'ASMT-10'. Display only.
    form_no                text        NOT NULL DEFAULT '',
    -- The form the reply goes on, e.g. 'ASMT-11'. This is the single most
    -- asked question about a notice and it is not guessable from form_no:
    -- ASMT-10 is answered on ASMT-11 but DRC-01 is answered on DRC-06.
    reply_form_no          text        NOT NULL DEFAULT '',

    -- Human-readable statutory citation for a reference that the Income-tax Act
    -- 2025 did NOT renumber. Every seeded row is GST, so every seeded row uses
    -- this and leaves statute_key NULL.
    statute_ref            text        NOT NULL DEFAULT '',

    -- INTEGRATION POINT, deliberately unwired. When an income-tax notice type
    -- is added, its section number is a dated fact -- s.143(2) and s.139(9)
    -- under the 1961 Act are renumbered under the Income-tax Act 2025, in force
    -- 1 April 2026 -- and it must NOT be frozen in this column. Put the
    -- obligation key here instead and resolve it AS OF the notice's
    -- received_on through `services/statute.py` (`obligation(...)`), backed by
    -- staging.statute_calendar (migration 158, also not yet applied). There is
    -- no FK to that table and there must not be one: this column stays
    -- meaningful whether or not 158 has been applied.
    statute_key            text,

    -- The window, as a number of days OR a number of months, never both. See
    -- the CHECK below for why "never both" is a correctness requirement and not
    -- tidiness.
    reply_window_days      integer     NOT NULL DEFAULT 0,
    reply_window_months    integer     NOT NULL DEFAULT 0,

    -- 'statutory_fixed' | 'statutory_max' | 'notice_specified'. See the header.
    window_basis           text        NOT NULL,

    -- TRUE means the window is counted in working days and the computed date is
    -- therefore conservative (earlier than the truth). Only REG-17 has this.
    window_in_working_days boolean     NOT NULL DEFAULT false,

    -- What actually happens if the date is missed, in the words a partner would
    -- use to a client. Not snapshotted onto the register -- see the header.
    consequence            text        NOT NULL,

    -- Where the window above was read from. Empty string is allowed for a type
    -- a practice minted itself; every SEEDED row has one.
    source_url             text        NOT NULL DEFAULT '',

    -- Retire a type by clearing this, never by deleting it: register rows point
    -- at it and the FK below is RESTRICT.
    is_active              boolean     NOT NULL DEFAULT true,

    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notice_type_code_ck
        CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT notice_type_authority_ck
        CHECK (authority ~ '^[a-z][a-z0-9_]{1,31}$'),
    CONSTRAINT notice_type_label_ck
        CHECK (length(btrim(label)) > 0),
    CONSTRAINT notice_type_consequence_ck
        CHECK (length(btrim(consequence)) > 0),
    CONSTRAINT notice_type_basis_ck
        CHECK (window_basis IN ('statutory_fixed', 'statutory_max', 'notice_specified')),
    CONSTRAINT notice_type_window_range_ck
        CHECK (reply_window_days   BETWEEN 0 AND 3650
           AND reply_window_months BETWEEN 0 AND 120),

    -- Never both, and this is a correctness requirement. `date + interval` in
    -- PostgreSQL applies the months component BEFORE the days component, and
    -- the two orders disagree: 2026-01-30 + (1 month, 1 day) is 2026-03-01
    -- months-first and 2026-02-28 days-first (measured on the live server,
    -- 19 August 2026). Forbidding the combination means the register's stored
    -- generated column and the Python in services/custody/notices.py cannot
    -- drift apart over an ordering nobody would think to test. No real
    -- statutory window is expressed as "two months and ten days" anyway.
    CONSTRAINT notice_type_window_exclusive_ck
        CHECK (reply_window_days = 0 OR reply_window_months = 0),

    -- A computable basis must actually carry a window; a 'notice_specified'
    -- type must NOT pretend to have one.
    CONSTRAINT notice_type_basis_window_ck
        CHECK (
            (window_basis = 'notice_specified'
                AND reply_window_days = 0 AND reply_window_months = 0)
            OR
            (window_basis IN ('statutory_fixed', 'statutory_max')
                AND (reply_window_days > 0 OR reply_window_months > 0))
        ),

    -- NULLS NOT DISTINCT so that the 7 system rows (org_id NULL) cannot be
    -- duplicated by a replay of the seed below. Without it NULL <> NULL and
    -- every re-run would mint a second `gst_asmt_10`, and the register would
    -- then have two types that mean the same thing and split every report.
    --
    -- A table CONSTRAINT and not a bare CREATE UNIQUE INDEX, because the seed's
    -- ON CONFLICT names it: `ON CONFLICT ON CONSTRAINT` resolves through
    -- pg_constraint, and an index created by CREATE UNIQUE INDEX has no row
    -- there -- the statement would fail at parse with "constraint does not
    -- exist". Migration 158 gets this right; it is easy to get wrong.
    CONSTRAINT uq_notice_type_code UNIQUE NULLS NOT DISTINCT (org_id, code)
);

COMMENT ON TABLE staging.notice_type IS
    'Catalogue of department notice types. org_id NULL = shipped by Aekam to '
    'every org; org_id set = one practice''s own type. Never edit a row for a '
    'statutory change -- mint a new code, because register rows in flight point '
    'at the old one. See migration 162 for window_basis.';


-- ═══ THE REGISTER ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.notice_register (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id                 uuid        NOT NULL
                             REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- WHICH CLIENT. `graha_clients` is the company -- the customer -- and never
    -- a contact: a notice is served on the entity, and the person who handles
    -- it comes and goes. RESTRICT, not CASCADE: a notice is the practice's
    -- evidence of what a department said and when, and deleting a client row
    -- must not silently destroy it. Deactivate the client instead.
    --
    -- The FK is on `id` alone and NOT the composite (org_id, client_id), which
    -- would be the stronger guarantee. Making it composite requires a unique
    -- index on staging.graha_clients (org_id, id) -- a change to a hot shared
    -- table this file has no business making. THE CONSEQUENCE IS THAT A ROW
    -- POINTING AT ANOTHER PRACTICE'S COMPANY IS A ROW THIS SCHEMA PERMITS, and
    -- every reader has to assume one exists:
    --
    --   * `r.org_id = $1` in a WHERE clause does NOT catch it. That row's
    --     org_id is this org; the foreign value is `graha_clients.name` on the
    --     JOINED side. services/custody/notices.py therefore scopes the join
    --     itself -- ON c.id = r.client_id AND c.org_id = r.org_id -- which is
    --     how services/custody/dsc.py joins the same table, for this reason.
    --   * It then reads r.org_id back and raises CrossOrgLeak rather than
    --     returning the row, so a deleted predicate is loud instead of silent.
    --   * A router that ever INSERTS here must verify the client belongs to the
    --     org before writing. The database will not catch it and neither of the
    --     two guards above is on the write path.
    --
    -- If the lead would rather have this in the schema, the whole class goes
    -- away with `CREATE UNIQUE INDEX CONCURRENTLY ... ON staging.graha_clients
    -- (org_id, id)` followed by a composite FK. That is a separate migration
    -- against a shared table, deliberately not smuggled into this one.
    client_id              uuid        NOT NULL
                             REFERENCES staging.graha_clients(id) ON DELETE RESTRICT,

    -- RESTRICT for the same reason: retire a type with is_active = false.
    notice_type_id         uuid        NOT NULL
                             REFERENCES staging.notice_type(id) ON DELETE RESTRICT,

    -- The department's own reference -- the DIN on a GST notice, the ARN, the
    -- order number. This is what a partner searches by and what an officer
    -- quotes on the phone.
    reference_no           text        NOT NULL,

    -- DATE OF SERVICE, not the date somebody noticed it. Every statutory window
    -- in the seed runs from service, so this is the column the whole table
    -- depends on being right.
    received_on            date        NOT NULL,

    -- SNAPSHOT of the catalogue window at the moment the notice was filed. See
    -- the header: these are inputs to a stored generated column and must not
    -- move under a historical row.
    reply_window_days      integer     NOT NULL DEFAULT 0,
    reply_window_months    integer     NOT NULL DEFAULT 0,
    window_in_working_days boolean     NOT NULL DEFAULT false,

    -- The date actually written on the notice, or an extension the officer has
    -- granted. REQUIRED where the statute fixes no period ('notice_specified'),
    -- and it OVERRIDES the computed date everywhere else -- because an ASMT-10
    -- that says 15 days is due in 15 days, not in the rule's 30-day cap.
    due_on_override        date,

    -- THE DUE DATE. Generated and stored, so it is one expression in one place
    -- rather than a number every caller recomputes slightly differently.
    --
    -- Month-end is the whole reason this is not `received_on + 30`:
    --   31 Jan 2026 + 30 days   = 2 Mar 2026  (NOT "end of February")
    --   31 Jan 2026 + 3 months  = 30 Apr 2026 (clamped, NOT 31 Apr / 1 May)
    --   30 Nov 2026 + 3 months  = 28 Feb 2027 (clamped)
    -- All three measured against this server on 19 August 2026 and mirrored
    -- exactly by `compute_due_on` in services/custody/notices.py.
    --
    -- Every function here is IMMUTABLE, which a generated column requires:
    -- make_interval is provolatile 'i', date + interval is date_pl_interval
    -- (immutable -- it is timestamptz + interval that is merely stable), and
    -- the cast back to date is immutable. Checked on the live server, not
    -- assumed.
    due_on                 date
        GENERATED ALWAYS AS (
            COALESCE(
                due_on_override,
                (received_on + make_interval(months => reply_window_months,
                                             days   => reply_window_days))::date
            )
        ) STORED,

    -- Who in the practice owns replying to it. NULL = unassigned, which is a
    -- real and dangerous state and therefore representable rather than hidden.
    -- SET NULL on delete so a departing employee cannot take a notice with them.
    owner_user_id          uuid        REFERENCES public.users(id) ON DELETE SET NULL,

    -- 'open' | 'replied' | 'closed' | 'escalated' | 'withdrawn'.
    --   replied    the reply is filed and the clock has stopped
    --   closed     the department has accepted it (ASMT-12, REG-20, DRC-05)
    --   escalated  the deadline passed and the consequence happened; kept
    --              OPEN-adjacent on purpose, because an escalation is the one
    --              row a partner must never lose sight of
    --   withdrawn  the department withdrew the notice
    -- A CHECK and not an enum: adding a status is a one-line ALTER, whereas an
    -- enum value cannot be removed at all. Migration 147 already established
    -- that a status column is the right home for this kind of state.
    status                 text        NOT NULL DEFAULT 'open',

    replied_on             date,
    closed_on              date,

    -- Free-text working notes. Never a place for a UUID.
    notes                  text        NOT NULL DEFAULT '',

    -- Actor is text and has NO foreign key, unlike owner_user_id above. That is
    -- not an inconsistency: `owner_user_id` is an assignment this product makes
    -- and it is always a real public.users row, whereas the actor strings this
    -- application writes are `user_`-prefixed and a uuid FK rejects them. See
    -- migration 159's note; migrations 030 and 092 exist because it was
    -- forgotten twice.
    created_by             text        NOT NULL DEFAULT '',

    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notice_register_reference_ck
        CHECK (length(btrim(reference_no)) BETWEEN 1 AND 128),
    CONSTRAINT notice_register_status_ck
        CHECK (status IN ('open', 'replied', 'closed', 'escalated', 'withdrawn')),
    CONSTRAINT notice_register_window_range_ck
        CHECK (reply_window_days   BETWEEN 0 AND 3650
           AND reply_window_months BETWEEN 0 AND 120),
    CONSTRAINT notice_register_window_exclusive_ck
        CHECK (reply_window_days = 0 OR reply_window_months = 0),

    -- A register row MUST resolve to a date. Without this a 'notice_specified'
    -- type inserted with no override would compute received_on + 0 = the day it
    -- arrived, i.e. it would show as due today, then overdue tomorrow, for ever.
    -- Silently wrong and permanently alarming.
    CONSTRAINT notice_register_has_a_date_ck
        CHECK (due_on_override IS NOT NULL
               OR reply_window_days > 0
               OR reply_window_months > 0),

    -- A deadline before the notice arrived is a data-entry error, most often a
    -- dd/mm swap. Reject it rather than render a permanently-overdue row.
    CONSTRAINT notice_register_override_ck
        CHECK (due_on_override IS NULL OR due_on_override >= received_on),

    -- GST itself began 1 July 2017; nothing this register tracks predates the
    -- practice's own existence by decades. Catches a year typed as 1926 or a
    -- date parsed in the wrong order. No upper bound, because now() is not
    -- immutable and a CHECK against it would be a time bomb.
    CONSTRAINT notice_register_received_ck
        CHECK (received_on >= DATE '2017-07-01'),

    CONSTRAINT notice_register_replied_ck
        CHECK (replied_on IS NULL OR replied_on >= received_on),
    CONSTRAINT notice_register_closed_ck
        CHECK (closed_on  IS NULL OR closed_on  >= received_on)
);

-- One row per department reference. Scoped by type as well as org because two
-- different forms can legitimately carry the same running number on different
-- portals, and a false collision would silently reject a real notice -- which
-- in this table means the notice goes untracked, which is the failure mode the
-- whole register exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_register_reference
    ON staging.notice_register (org_id, notice_type_id, reference_no);

-- The urgency list, which is the read this table exists for. Partial, so the
-- index holds only notices whose clock is still running: 'closed', 'withdrawn'
-- and 'replied' rows accumulate for ever and must not bloat the hot path.
-- 'escalated' IS included -- an escalated notice is the most urgent row there
-- is, not a finished one.
CREATE INDEX IF NOT EXISTS idx_notice_register_due
    ON staging.notice_register (org_id, due_on)
    WHERE status IN ('open', 'escalated');

-- Per-client history: every notice this company has ever received, newest
-- first, including the closed ones -- so it is deliberately NOT partial.
CREATE INDEX IF NOT EXISTS idx_notice_register_client
    ON staging.notice_register (org_id, client_id, received_on DESC);

-- "What is on my desk." Partial for the same reason as idx_notice_register_due,
-- and it also answers "what is assigned to nobody" via owner_user_id IS NULL.
CREATE INDEX IF NOT EXISTS idx_notice_register_owner
    ON staging.notice_register (org_id, owner_user_id, due_on)
    WHERE status IN ('open', 'escalated');

COMMENT ON TABLE staging.notice_register IS
    'Department notices held on behalf of clients, with the statutory reply '
    'clock. due_on is GENERATED: COALESCE(due_on_override, received_on + the '
    'SNAPSHOTTED window). The window is snapshotted, never joined, so a later '
    'correction to the catalogue cannot move a historical due date. This is a '
    'list of which clients are under assessment -- the most sensitive table in '
    'the product. Do not expose it without an access rule.';


-- ═══ THE SEED ════════════════════════════════════════════════════════════════
--
-- Seven GST notice types, every window read from a primary or near-primary
-- source on 19 August 2026 and cited per row. GST form and section numbering
-- was untouched by the Income-tax Act 2025, so nothing here is at risk from
-- that renumbering. Income-tax notice types are NOT seeded: their section
-- numbers ARE dated facts and belong behind `statute_key` and
-- services/statute.py, not frozen in a seed.

INSERT INTO staging.notice_type
    (org_id, code, label, authority, form_no, reply_form_no, statute_ref,
     reply_window_days, reply_window_months, window_basis,
     window_in_working_days, consequence, source_url)
VALUES
    -- Rule 99(1): the officer seeks an explanation "within such time, not
    -- exceeding thirty days from the date of service of the notice or such
    -- further period as may be permitted by him". So THIRTY IS A CAP, not the
    -- period -- 'statutory_max', and the notice's own date wins via override.
    (NULL, 'gst_asmt_10',
     'GST ASMT-10 — scrutiny of returns',
     'gst', 'ASMT-10', 'ASMT-11',
     'CGST Act s.61; CGST Rules r.99',
     30, 0, 'statutory_max', false,
     'No satisfactory explanation within the period allowed and the officer may '
     'move straight past scrutiny: audit under s.65, special audit under s.66, '
     'inspection or search under s.67, or determination of tax under s.73, s.74 '
     'or s.74A. The scrutiny stops being a question and becomes a demand.',
     'https://taxguru.in/goods-and-service-tax/section-61-gst-scrutiny-returns-asmt-10-asmt-11-asmt-12.html'),

    -- Rule 142 prescribes NO reply period for a DRC-01; the representation goes
    -- in DRC-06 (r.142(4)) by the date the officer wrote. The famous "30 days"
    -- is s.73(8)/s.74(8) -- a payment concession, a different clock -- and is
    -- stated in the consequence rather than computed as a deadline.
    (NULL, 'gst_drc_01',
     'GST DRC-01 — show cause notice (s.73 / s.74 / s.74A)',
     'gst', 'DRC-01', 'DRC-06',
     'CGST Act s.73/74/74A; CGST Rules r.142(1)(a), r.142(4)',
     0, 0, 'notice_specified', false,
     'No reply by the date on the notice and the officer passes a demand order '
     'in DRC-07 on whatever the record shows, unanswered. Separately and worth '
     'real money: paying the tax and interest within thirty days of the notice '
     'means no penalty at all under s.73(8), or concludes proceedings on payment '
     'of tax, interest and 25% penalty under s.74(8). That thirty days is a '
     'concession window, not the reply deadline — do not confuse the two.',
     'https://taxguru.in/goods-and-service-tax/gst-drc-01-notice-section-73-74-74a-guide-rules-reply.html'),

    -- r.142(5) uploads the order summary as DRC-07 and r.142(6) makes that
    -- order itself the notice for recovery. s.78 gives three MONTHS from
    -- service to pay -- calendar months, hence reply_window_months and not 90
    -- days, which would be a different date in every quarter.
    (NULL, 'gst_drc_07',
     'GST DRC-07 — demand order',
     'gst', 'DRC-07', 'APL-01',
     'CGST Act s.78, s.79; CGST Rules r.142(5), r.142(6)',
     0, 3, 'statutory_fixed', false,
     'Unpaid three months after service and recovery begins under s.79 without '
     'a further notice — the DRC-07 is itself the recovery notice. Recovery '
     'includes a garnishee order to the client''s bank, attachment and sale of '
     'property, and recovery from anyone who owes the client money. The officer '
     'may compress the three months, but only the Principal Commissioner or '
     'Commissioner may order it and only with written reasons. Appeal in APL-01 '
     'within three months if the order is to be contested at all.',
     'https://www.aaptaxlaw.com/cgst-act/section-78-cgst-act-initiation-of-recovery-proceedings.html'),

    -- s.107(1): three months from the date the order is communicated. s.107(4)
    -- lets the appellate authority condone one further month on sufficient
    -- cause -- discretionary, so it is NOT built into the window.
    (NULL, 'gst_apl_01',
     'GST APL-01 — appeal to the Appellate Authority',
     'gst', 'APL-01', '',
     'CGST Act s.107(1), s.107(4), s.107(6)',
     0, 3, 'statutory_fixed', false,
     'Three months from communication of the order, and after that the appeal is '
     'time-barred except for one further month the appellate authority may '
     'condone on sufficient cause under s.107(4) — discretionary, never assume '
     'it. Filing at all requires the admitted tax in full plus a pre-deposit of '
     '10% of the disputed tax, capped at Rs 20 crore per component of CGST and '
     'of SGST/IGST since 1 November 2024. For a penalty-only order under s.129(3) '
     'the pre-deposit was cut from 25% to 10% with effect from 1 October 2025. '
     'Miss the window and the demand simply stands.',
     'https://www.jurishour.in/tax-experts/payment-pre-deposit-appeals-gst-law/'),

    -- Rule 88C: seven days to pay the difference through DRC-03 or explain it
    -- in Part B of DRC-01B.
    (NULL, 'gst_drc_01b',
     'GST DRC-01B — GSTR-1 vs GSTR-3B liability mismatch',
     'gst', 'DRC-01B', 'DRC-01B Part B',
     'CGST Rules r.88C; r.59(6)',
     7, 0, 'statutory_fixed', false,
     'Seven days to pay the difference in DRC-03 or explain it in Part B. Do '
     'neither and the client is barred from filing the next GSTR-1 or using the '
     'IFF under r.59(6) — which stops the client''s own customers claiming input '
     'credit, so the damage lands on the client''s customers before it lands on '
     'the client.',
     'https://taxguru.in/goods-and-service-tax/mismatch-liability-gstr-1-3b-evolution-drc-01b-rule-88c.html'),

    -- Rule 88D: the same seven days and the same blocking consequence, but for
    -- input credit taken in 3B beyond what 2B shows.
    (NULL, 'gst_drc_01c',
     'GST DRC-01C — GSTR-2B vs GSTR-3B input credit mismatch',
     'gst', 'DRC-01C', 'DRC-01C Part B',
     'CGST Rules r.88D; r.59(6)',
     7, 0, 'statutory_fixed', false,
     'Seven days to reverse or pay the excess credit with interest in DRC-03, or '
     'to give reasons in Part B. Do neither and the client is barred from filing '
     'the next GSTR-1 or using the IFF under r.59(6).',
     'https://cleartax.in/s/rule-88d-cgst-itc-mismatch-gstr-2b-vs-gstr-3b'),

    -- Rule 22(1): seven WORKING days. The only seeded row with
    -- window_in_working_days -- see the header on why the computed date is
    -- deliberately conservative.
    (NULL, 'gst_reg_17',
     'GST REG-17 — show cause against cancellation of registration',
     'gst', 'REG-17', 'REG-18',
     'CGST Act s.29; CGST Rules r.22(1), r.22(2), r.22(3), r.22(4)',
     7, 0, 'statutory_fixed', true,
     'Seven working days to show cause in REG-18. No reply, or an unsatisfactory '
     'one, and the officer cancels the registration by order in REG-19 — after '
     'which the client cannot issue a tax invoice, cannot pass on input credit '
     'and in practice cannot trade. A satisfactory reply gets the proceedings '
     'dropped in REG-20. Note the seven are WORKING days: the date this register '
     'computes counts calendar days and is therefore earlier than the real one, '
     'never later.',
     'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter3/rule22_v1.00.html')

ON CONFLICT ON CONSTRAINT uq_notice_type_code DO NOTHING;

COMMIT;
