-- 163 · client_engagements + client_engagement_predecessor_comms —
--       the two moments a practice is most exposed: taking a client on, and letting one go.
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--   CREATES  staging.client_engagements                        (new table)
--   CREATES  staging.client_engagement_predecessor_comms       (new table)
--   CREATES  six indexes on those two new tables
--   ALTERS   nothing. DROPS nothing. INSERTs, UPDATEs and DELETEs nothing.
--
--   It DOES take a brief ShareRowExclusiveLock on three EXISTING tables,
--   because the new tables carry foreign keys into them:
--       staging.organisations   (org_id)
--       staging.graha_clients   (client_id)
--       staging.ganit_invoices  (final_invoice_id)
--   The new tables are empty, so there are no rows to validate and the lock is
--   held only for the duration of the catalog write. `SET LOCAL lock_timeout`
--   below means that if a long transaction is already holding a conflicting
--   lock on ganit_invoices — the one hot table in that list — this migration
--   FAILS AFTER FIVE SECONDS instead of queueing behind it and blocking every
--   invoice write in production. Re-run it when the queue is clear.
--
-- ── IF IT RUNS TWICE ────────────────────────────────────────────────────────
--   Nothing happens. Both CREATE TABLE and all six CREATE INDEX are IF NOT
--   EXISTS, and there is no seed, so a second run is a no-op that neither
--   duplicates a row nor re-validates a constraint. Every CHECK is declared
--   INLINE in the CREATE TABLE rather than as a later ALTER TABLE ADD
--   CONSTRAINT, precisely because ADD CONSTRAINT has no IF NOT EXISTS form and
--   would abort a second run.
--
-- ── SHARED-DATABASE NOTE ────────────────────────────────────────────────────
--   staging and production share this database and production writes to
--   `staging` too. Two new empty tables and nothing else; no existing row is
--   read for update, written, or rewritten, so applying this cannot change any
--   figure any user sees today. Production (main, 1aa49855) has no code that
--   reads these names — nothing does until a caller imports
--   services/custody/lifecycle.py.
--
--
-- ════ WHY THIS EXISTS ═══════════════════════════════════════════════════════
--
-- ENTRY. Clause (8) of Part I of the First Schedule to the Chartered
-- Accountants Act, 1949 makes it professional misconduct for a member in
-- practice who
--
--     "accepts a position as auditor previously held by another chartered
--      accountant or a certified auditor who has been issued certificate under
--      the Restricted Certificate Rules, 1932 without first communicating with
--      him in writing"
--
-- ICAI's own FAQ answers the scope question directly: "the requirement for
-- communicating with the previous auditor would apply to all types of audits
-- viz., statutory audit, tax audit, internal audit, concurrent audit or any
-- other kind of audit" (https://icai.org/post/5645). ICAI has imposed
-- penalties for exactly this failure. So it is not a checklist item a firm may
-- design away; it is a precondition of accepting the work, and the thing that
-- must survive is the EVIDENCE OF DELIVERY — which is why the communications
-- get their own table below and not a timestamp column.
--
-- AND THE CONVERSE MATTERS JUST AS MUCH. Clause (8) says "a position as
-- auditor". It does not reach bookkeeping, return preparation, ROC filing,
-- payroll, certification, valuation or representation work, and it does not
-- reach an audit where there was no predecessor or where the predecessor was
-- not a chartered accountant. A product that demands a predecessor letter
-- before a firm may file a GST return is not being careful — it is blocking
-- lawful work, and it will be switched off. Nothing in this schema requires the
-- predecessor fields; the rule that decides when they are owed lives in ONE
-- place, services/custody/lifecycle.clause8_applies(), and is asserted in both
-- directions by tests/test_client_lifecycle.py.
--
-- EXIT. Nothing in this product covered a client leaving. Four facts have to be
-- recordable or the firm cannot defend itself: the records were handed back and
-- someone acknowledged receipt, portal access was revoked, the final bill was
-- raised and settled, and the working papers are being retained for as long as
-- they must be. SQC 1 paragraph 83, as amended by the Council at its 289th
-- meeting on 19 August 2009, sets that last one for audit work: the retention
-- period "ordinarily is no shorter than seven years from the date of the
-- auditor's report, or, if later, the date of the group auditor's report" — it
-- was TEN years before that amendment. See
-- https://www.icai.org/post/announcement-on-amendment-to-sqc-1-retention-period-for-engagement-documentation-working-papers-21-08-2009
--
-- Note what that anchors on: THE DATE OF THE REPORT, not the date the client
-- left. An engagement whose report was signed in 2021 and whose client walked
-- out in 2026 is retained to 2028, not to 2033. `retention_anchor_date` is a
-- separate column from every exit date for that reason alone.
--
--
-- ════ WHY TWO TABLES ════════════════════════════════════════════════════════
--
-- The exit facts live ON the engagement row: an engagement has exactly one
-- exit, so a second table would buy a join and nothing else, and "what is
-- outstanding at exit" is the query this register exists to answer.
--
-- The predecessor communications do NOT, and could not. Clause (8) is
-- satisfied by communicating in writing with positive evidence of delivery, and
-- registered post comes back undelivered often enough that a firm sends twice.
-- A single `predecessor_communicated_at` column cannot record "sent 4 March,
-- returned undelivered, sent again 11 March, delivered 14 March" — it can only
-- record the last attempt, which is the one that says nothing about whether the
-- firm tried in time. The disciplinary cases turn on producing the evidence, so
-- the evidence is the row.
--
--
-- ════ THREE SHAPE DECISIONS WORTH ARGUING WITH ══════════════════════════════
--
-- 1. `client_id` is ON DELETE RESTRICT, not the SET NULL that graha_deals,
--    ganit_invoices and analytics_accounts use. Deliberate, and the one place
--    this file is stricter than its neighbours: an engagement row with a NULL
--    client is not a compliance record, it is a fragment, and the whole point
--    of the register is that a firm can still produce the predecessor letter
--    and the handover acknowledgement years after the relationship ended. If
--    hard-deleting clients turns out to be a live path — graha_clients has
--    `is_active`, which suggests soft delete is the intended one — change this
--    to SET NULL with a nullable column and say so. Do not discover it in
--    production.
--
-- 2. There is NO unique constraint on (org_id, client_id, engagement_type,
--    financial_year), and it is missing on purpose. A firm can be appointed,
--    resign mid-year, and be re-appointed for the same audit in the same
--    financial year — that is two engagements, two acceptance dates, and
--    possibly two predecessor letters. A uniqueness rule here would make the
--    register unable to record the exact situation Clause (8) exists for.
--
-- 3. `retention_until` is a plain column, not GENERATED ALWAYS AS. A stored
--    generated column would be tamper-proof, which is attractive for a
--    retention date — but the arithmetic ("N years from an anchor, with 29
--    February collapsing to 28 February") has one implementation in
--    lifecycle.retention_until_for(), which the suite exercises without a
--    database, and a second one written in DDL would be asserted by nothing.
--    The CHECK below stops the only incoherent value: a retention date earlier
--    than its own anchor.

-- BEGIN/COMMIT, and not because two CREATE TABLEs need to be atomic (they do,
-- but that is the small reason). `SET LOCAL` is scoped to a transaction: run
-- outside one it emits `WARNING: SET LOCAL can only be used in transaction
-- blocks` and does NOTHING — the timeout that stops this file queueing on
-- ganit_invoices would silently not exist. 095 through 107 all wrap for the
-- same reason.
BEGIN;

SET LOCAL lock_timeout = '5s';


-- ── the register ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.client_engagements (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      uuid NOT NULL
                                  REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- RESTRICT: see shape decision 1 above.
    --
    -- AND NOTE WHAT THIS FOREIGN KEY DOES NOT SAY. It references
    -- graha_clients(id) alone, so nothing here stops a row being written with
    -- an `org_id` of one practice and a `client_id` belonging to another. The
    -- composite trick used for the child table below cannot be repeated:
    -- graha_clients has no UNIQUE (id, org_id) for a composite key to point
    -- at, and creating one means ALTERing a table this migration is not
    -- allowed to touch. The consequence is real and was probed read-only
    -- against the live database on 2026-08-19 — a mis-filed row came back
    -- inside the wrong practice's result set carrying the OTHER PRACTICE'S
    -- CLIENT NAME. So every join in services/custody/lifecycle.py carries
    -- `AND c.org_id = e.org_id`, and TestEveryJoinIsOrgScoped refuses a new
    -- query without it. If a later migration is ALTERing graha_clients anyway,
    -- add UNIQUE (id, org_id) there and make this a composite FK: the database
    -- should be enforcing this, and today only the queries do.
    client_id                   uuid NOT NULL
                                  REFERENCES staging.graha_clients(id) ON DELETE RESTRICT,

    -- The allowlist is mirrored, name for name, by ENGAGEMENT_TYPES in
    -- services/custody/lifecycle.py. tests/test_client_lifecycle.py parses this
    -- very CHECK out of this very file and asserts the two agree, because a
    -- drift between them is invisible: Python would happily classify a type the
    -- database refuses to store, and the failure would surface as an insert
    -- error in front of a user rather than as a red test.
    --
    -- The eleven types ending in `_audit` are the ones Clause (8) reaches.
    -- `other_audit` is the catch-all for ICAI's "or any other kind of audit"
    -- and IS an audit; `other_non_audit` is the catch-all that is not.
    engagement_type             text NOT NULL
      CONSTRAINT client_engagements_type_ck CHECK (engagement_type = ANY (ARRAY[
        'statutory_audit', 'tax_audit', 'internal_audit', 'concurrent_audit',
        'stock_audit', 'revenue_audit', 'bank_branch_audit', 'trust_audit',
        'cooperative_audit', 'forensic_audit', 'other_audit',
        'accounting', 'income_tax_return', 'tds_return', 'gst_return',
        'roc_filing', 'payroll', 'certification', 'valuation', 'advisory',
        'representation', 'company_secretarial', 'other_non_audit'
      ])),

    -- '2025-26'. Free text on purpose: services/statute.fy_bounds() already
    -- parses this exact shape, and a CHECK here would be a second parser to
    -- keep in step with it.
    financial_year              text,
    period_from                 date,
    period_to                   date,

    status                      text NOT NULL DEFAULT 'proposed'
      CONSTRAINT client_engagements_status_ck CHECK (status = ANY (ARRAY[
        'proposed', 'active', 'completed', 'exiting', 'closed', 'declined'
      ])),

    -- THE CLAUSE (8) CLOCK, and it runs in two directions. The communication
    -- must precede acceptance — ICAI's wording is "without FIRST
    -- communicating" — so this is the date a dispatch date is compared
    -- against, and a letter sent the week after the firm signed does not cure
    -- the breach. It must ALSO precede it by an interval: ICAI's FAQ makes the
    -- member guilty who failed to communicate in writing "and if he did not
    -- wait for a reasonable length of time for a reply to be received from
    -- him", so a letter posted on the morning of the signature satisfies the
    -- writing and not the waiting. Both readings are applied by
    -- lifecycle.predecessor_communication_state() against THIS column; the
    -- Code of Ethics fixes no number of days, and neither does the schema.
    accepted_on                 date,
    started_on                  date,
    -- SA 210 requires the agreed terms of an audit engagement to be recorded in
    -- writing. Recordable for every engagement type; only demanded for audits.
    engagement_letter_signed_on date,

    -- ── predecessor facts ───────────────────────────────────────────────────
    -- All of these are optional and none of them gates a write. Whether the
    -- communication is OWED is decided by lifecycle.clause8_applies(), never by
    -- a constraint here.
    had_predecessor             boolean NOT NULL DEFAULT false,
    -- NULL means "not established yet", which is itself a gap worth reporting
    -- on an audit: you cannot conclude Clause (8) is silent until you know what
    -- the predecessor was.
    predecessor_is_ca           boolean,
    -- A firm name, entered by a human. The predecessor is another practice, so
    -- there is no user row to point at and nothing here is an id.
    predecessor_name            text,
    -- Free text for the lawful reasons the letter is not owed: first-ever
    -- appointment, predecessor was not a chartered accountant, not an audit.
    predecessor_not_required_reason text,

    -- The only combination that is self-contradictory: there was no predecessor
    -- AND the predecessor was a chartered accountant. Everything else —
    -- including a named predecessor on a first appointment — is a firm
    -- recording what it knows.
    CONSTRAINT client_engagements_predecessor_ck
      CHECK (NOT (had_predecessor IS FALSE AND predecessor_is_ca IS TRUE)),

    -- ── exit ────────────────────────────────────────────────────────────────
    exit_initiated_on           date,
    exit_reason                 text
      CONSTRAINT client_engagements_exit_reason_ck
      CHECK (exit_reason IS NULL OR exit_reason = ANY (ARRAY[
        'client_resigned', 'firm_resigned', 'not_reappointed', 'completed',
        'client_closed', 'dispute', 'other'
      ])),

    records_handover_status     text NOT NULL DEFAULT 'not_started'
      CONSTRAINT client_engagements_handover_status_ck
      CHECK (records_handover_status = ANY (ARRAY[
        'not_started', 'in_progress', 'completed', 'not_applicable'
      ])),
    records_handover_on         date,
    -- The NAME of the person at the client who acknowledged receipt. A handover
    -- nobody acknowledged is a handover the firm cannot prove, which is the
    -- dispute it cannot win.
    records_handover_ack_by     text,
    records_handover_note       text,
    -- R2 object key for the signed manifest. Files live in R2, never in a
    -- column: six screenshots once accounted for 33MB of an 82MB database.
    handover_manifest_key       text,

    portal_access_revoked_at    timestamptz,
    -- Name, not a user id.
    portal_access_revoked_by    text,

    final_invoice_id            uuid
                                  REFERENCES staging.ganit_invoices(id) ON DELETE SET NULL,
    final_billing_status        text NOT NULL DEFAULT 'pending'
      CONSTRAINT client_engagements_final_billing_ck
      CHECK (final_billing_status = ANY (ARRAY[
        'pending', 'invoiced', 'settled', 'written_off', 'not_applicable'
      ])),

    -- ── retention ───────────────────────────────────────────────────────────
    -- The date the clock starts. For an audit this is THE DATE OF THE AUDITOR'S
    -- REPORT (SQC 1 para 83) — not the exit date and not the period end; for
    -- other work it is the date of the final deliverable.
    retention_anchor_date       date,
    -- Seven, from SQC 1 para 83 as amended 19 August 2009, for audit
    -- engagements. The same seven is applied to non-audit engagements as FIRM
    -- POLICY rather than as statute — SQC 1 fixes the number only for audits —
    -- and it is a per-engagement column so a firm with a different policy, or a
    -- client under a longer contractual or litigation hold, can say so.
    retention_years             integer NOT NULL DEFAULT 7
      CONSTRAINT client_engagements_retention_years_ck CHECK (retention_years > 0),
    retention_until             date,
    retention_note              text,

    closed_on                   date,

    notes                       text,
    created_by                  text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    -- Date sanity. Every one of these is NULL-tolerant: a register that refuses
    -- a half-known engagement is a register nobody fills in, and an empty
    -- register proves nothing to anybody.
    CONSTRAINT client_engagements_period_ck
      CHECK (period_from IS NULL OR period_to IS NULL OR period_to >= period_from),
    CONSTRAINT client_engagements_exit_after_accept_ck
      CHECK (exit_initiated_on IS NULL OR accepted_on IS NULL
             OR exit_initiated_on >= accepted_on),
    CONSTRAINT client_engagements_closed_after_exit_ck
      CHECK (closed_on IS NULL OR exit_initiated_on IS NULL
             OR closed_on >= exit_initiated_on),
    CONSTRAINT client_engagements_retention_ck
      CHECK (retention_until IS NULL OR retention_anchor_date IS NULL
             OR retention_until >= retention_anchor_date),

    -- Not redundant with the primary key. It is the target of the composite
    -- foreign key on the child table below, which is what makes it impossible
    -- to file a predecessor letter under one org against an engagement that
    -- belongs to another.
    CONSTRAINT client_engagements_id_org_uniq UNIQUE (id, org_id)
);


-- ── the evidence ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.client_engagement_predecessor_comms (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL
                      REFERENCES staging.organisations(id) ON DELETE CASCADE,
    engagement_id   uuid NOT NULL,

    -- ICAI guidance expects a mode that yields positive evidence of delivery;
    -- registered post with acknowledgement due is the one the disciplinary
    -- material keeps naming, and the Council recommends it. EMAIL IS NOT AN
    -- ILLEGITIMATE MODE — the requirement was relaxed to allow it, and a
    -- register that treated an emailed communication as invalid would be
    -- accusing firms of a breach ICAI does not recognise. So the mode is
    -- recorded and never judged: lifecycle.py treats an attempt as EVIDENCED
    -- when it was actually delivered or carries a proof reference, whatever
    -- the mode it went by.
    mode            text NOT NULL
      CONSTRAINT cepc_mode_ck CHECK (mode = ANY (ARRAY[
        'registered_post_ad', 'speed_post', 'courier', 'hand_delivery',
        'email', 'other'
      ])),
    dispatched_on   date NOT NULL,
    -- Registered-post tracking number, courier AWB, or the acknowledgement
    -- reference on a hand delivery. Free text: these are other people's
    -- identifier formats and none of them is ours to validate.
    proof_ref       text,
    -- R2 key for the scanned acknowledgement. Never the bytes.
    proof_file_key  text,

    delivery_outcome text NOT NULL DEFAULT 'awaiting'
      CONSTRAINT cepc_outcome_ck CHECK (delivery_outcome = ANY (ARRAY[
        'awaiting', 'delivered', 'returned_undelivered', 'refused'
      ])),
    delivered_on     date,
    -- A REPLY IS NOT REQUIRED BY CLAUSE (8), and lifecycle.py must never demand
    -- one. There is no such thing as a mandatory NOC; the misconduct is failing
    -- to communicate, and a predecessor who never answers cannot hold the
    -- incoming auditor hostage. Recorded because a firm that has one wants it
    -- findable years later.
    --
    -- WHAT IS REQUIRED IS THE WAIT, and the distinction is thin enough that
    -- somebody will collapse it. ICAI's FAQ makes the member guilty who failed
    -- to communicate in writing "and if he did not wait for a reasonable length
    -- of time for a reply to be received from him" — the firm must allow the
    -- interval; it does not need anything to arrive in it. A reply that DID
    -- arrive before acceptance is what lifecycle.py reads this column for: it
    -- ends the wait early, because the wait existed to give the predecessor a
    -- chance to answer and this one answered. Nothing here ever demands a row.
    reply_received_on date,
    reply_summary     text,

    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cepc_delivered_after_dispatch_ck
      CHECK (delivered_on IS NULL OR delivered_on >= dispatched_on),
    CONSTRAINT cepc_reply_after_dispatch_ck
      CHECK (reply_received_on IS NULL OR reply_received_on >= dispatched_on),

    -- Composite, against client_engagements_id_org_uniq: the child cannot be
    -- filed under a different org from its parent.
    CONSTRAINT cepc_engagement_fk
      FOREIGN KEY (engagement_id, org_id)
      REFERENCES staging.client_engagements(id, org_id) ON DELETE CASCADE
);


-- ── indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS client_engagements_org_client_idx
    ON staging.client_engagements (org_id, client_id);

CREATE INDEX IF NOT EXISTS client_engagements_org_status_idx
    ON staging.client_engagements (org_id, status);

-- The entry sweep reads engagements that are not finished with. Partial, so it
-- does not have to carry a decade of closed rows.
CREATE INDEX IF NOT EXISTS client_engagements_open_idx
    ON staging.client_engagements (org_id, accepted_on)
    WHERE status IN ('proposed', 'active');

-- The exit sweep: started leaving, not yet closed.
CREATE INDEX IF NOT EXISTS client_engagements_exiting_idx
    ON staging.client_engagements (org_id, exit_initiated_on)
    WHERE exit_initiated_on IS NOT NULL AND closed_on IS NULL;

-- The retention sweep asks "which of these expires before <date>", so the date
-- leads the tuple after the tenant key.
CREATE INDEX IF NOT EXISTS client_engagements_retention_idx
    ON staging.client_engagements (org_id, retention_until)
    WHERE retention_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS cepc_engagement_idx
    ON staging.client_engagement_predecessor_comms (engagement_id, dispatched_on);

COMMIT;
