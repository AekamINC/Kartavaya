-- 159_skill_finding_ack.sql
--
-- THE FINDING THAT WAS ALREADY DEALT WITH. Not one of the skill handlers in
-- `services/skills/{data,detect,action}` has any notion of a finding being
-- closed. `propose_payment_run` returns the same overdue vendor bills every
-- time it runs until somebody actually pays a vendor. `check_payroll_readiness`
-- names the same employee with no salary structure every month. A catalogue
-- that cannot be told "yes, I know, it is handled" is read carefully in week
-- one, skimmed in month two and ignored for ever after -- and an ignored alert
-- list is worse than no alert list, because it still looks like coverage.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/159_skill_finding_ack.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 19 August 2026. Measured against the live catalogue
-- (`to_regclass('staging.skill_finding_ack')` -> NULL), deliberately not run.
--
-- == WHAT IT TOUCHES ========================================================
--
--   CREATES  staging.skill_finding_ack               (new table, 0 rows)
--   CREATES  uq_skill_finding_ack                    (unique index on the above)
--   CREATES  idx_skill_finding_ack_snoozed           (partial index on the above)
--   SETS     a COMMENT on staging.skill_finding_ack  (catalogue text only)
--   READS    staging.organisations                   (FK target only)
--
-- Verified against the live catalogue on 19 August 2026, read-only:
-- `staging.organisations` exists, its `id` is `uuid` and carries PRIMARY KEY
-- (id), so the FK below resolves; `gen_random_uuid()` resolves; and
-- `to_regclass('staging.skill_finding_ack')` is still NULL.
--
--   ALTERS   nothing.  DROPS nothing.  BACKFILLS nothing.  DELETES nothing.
--   No existing table gains, loses or changes a column. No existing row is
--   read, rewritten or removed by this file.
--
-- == IF IT RUNS TWICE =======================================================
--
-- Nothing happens the second time. Every statement is `IF NOT EXISTS`, there is
-- no INSERT, no UPDATE and no ALTER, so a replay is a catalogue no-op and
-- cannot duplicate, reset or destroy an acknowledgement. Re-running after rows
-- exist is equally safe for the same reason: this file never writes data.
--
-- == HOW TO UNDO IT =========================================================
--
--     DROP TABLE IF EXISTS staging.skill_finding_ack;   -- takes the indexes too
--
-- That is the whole reversal, and it is lossless with respect to every other
-- table because nothing else references this one. It does discard the
-- acknowledgements themselves, which is the only thing in here worth keeping --
-- dump the table first if any org has used it.
--
-- == THE FINDING KEY, WHICH IS THE WHOLE DESIGN =============================
--
-- An acknowledgement is worthless unless "the same finding" means the same
-- thing on Tuesday as it did on Monday. Findings are not rows and have no
-- primary key: `check_payroll_readiness` returns {check, employee, detail,
-- amount} and `propose_payment_run` returns {bill, vendor, balance_due, ...}.
-- So the key is DERIVED, in `services/skill_ack.py`, and split three ways --
-- and the split, not the hashing, is the part that matters:
--
--   IDENTITY    the fields that say WHICH FACT this is: the bill number, the
--               employee name plus the check code. Hashed into `finding_key`.
--               Stable for the life of the underlying fact.
--
--   MATERIAL    the fields whose MOVEMENT should void the acknowledgement: the
--               balance outstanding, the status. Hashed into `state_hash`.
--               A finding whose material state has moved since the ack is a
--               NEW situation wearing an old name, and it must resurface --
--               somebody acknowledged a bill of 42,000, not one of 84,000.
--
--   INCIDENTAL  everything else, and specifically anything that changes by the
--               mere passage of time: `days_past`, `days_past_due`, `ageing`,
--               `as_of`. Hashed into NEITHER. This is the trap the whole
--               mechanism dies of if it is got wrong: put `days_past` in the
--               material set and every acknowledgement expires at midnight;
--               put it in the identity set and every finding gets a fresh key
--               daily so no acknowledgement ever matches twice. Either way the
--               list is wallpaper again and the table looks like it is working.
--               `skill_ack._DRIFT_FIELDS` refuses those names outright rather
--               than trusting the next author to remember this paragraph.
--
-- == `finding_key` IS NOT AN ID, AND THE CHECK ENFORCES THAT =================
--
-- `finding_key` and `state_hash` are lowercase hex digests. The CHECKs below
-- accept `^[0-9a-f]{16,128}$` ONLY, which structurally refuses a raw UUID -- a
-- UUID carries dashes and fails the pattern, and so does an uppercase digest;
-- both verified against the live engine. That is deliberate and it is the
-- names-not-IDs rule (`frontend/scripts/check-rendered-ids.mjs`) made
-- unavoidable at the schema level: a UUID may be an INPUT to the digest, where
-- it is an excellent stable identifier, but it can never be what comes back
-- out, so no screen rendering an acknowledgement can leak one. The same reason
-- `skill` is constrained to `^[a-z][a-z0-9_]*$`: it holds the registry slug
-- from `SKILL_REGISTRY` (`propose_payment_run`), never
-- `hub_skill_templates.id`. The slug is also the more durable of the two --
-- several templates can share one handler, and templates get re-seeded, which
-- would orphan every acknowledgement keyed on a template id.
--
-- == `finding_label` IS FOR HUMANS AND CARRIES NO CONTACT DETAILS ============
--
-- The digest is unreadable by design, so the row also stores the sentence a
-- person would recognise: "Bill INV-2291 -- Sharma Traders". Names, never ids.
-- It must NOT be given an email address or a phone number: Aekam staff read
-- this table across orgs and the platform-privacy rule says client contact
-- details are not theirs to see. `skill_ack.sanitise_label` strips the obvious
-- shapes before insert; this comment is why.
--
-- == ONE LIVE ACK PER FINDING. THIS IS A STATE ROW, NOT A HISTORY ============
--
-- `uq_skill_finding_ack` makes (org, skill, finding_key) unique, so
-- re-acknowledging is an UPSERT that moves `state_hash`, `snooze_until` and
-- `note` and rewrites `acknowledged_by`/`acknowledged_at`. One row holds one
-- answer to "is this dealt with, and by whom". It is therefore the LAST
-- WRITER and not an audit trail -- exactly the line migration 097 drew for
-- `org_billing_lines.updated_by`, and for the same reason: a real history of
-- who acknowledged what and when is an append-only second table and a separate
-- decision, not something to smuggle in by dropping the unique index.
--
-- == SNOOZE AND ACK ARE THE SAME ROW, DISTINGUISHED BY ONE NULL =============
--
--   snooze_until IS NULL      acknowledged permanently (subject to state_hash)
--   snooze_until > now()      suppressed until that moment
--   snooze_until <= now()     EXPIRED -- the row stays, and suppresses nothing
--
-- An expired snooze is deliberately NOT deleted. The row is the evidence that
-- this finding has been pushed back before, and by whom; a list that quietly
-- forgets it has been snoozed three times cannot show anyone that it is being
-- avoided rather than handled. Nothing sweeps this table on a timer.
--
-- == state_hash NULL MEANS "REGARDLESS" =====================================
--
-- A NULL `state_hash` is an unconditional acknowledgement: suppress this
-- finding however its numbers move. That is the honest record for a finding
-- that is permanently not a problem -- a director with no UAN is still going to
-- have no UAN next month, and forcing that one to resurface every time an
-- amount shifts recreates the wallpaper this table exists to prevent. It is
-- NOT the default, and `skill_ack` will not produce one unless asked.
--
-- == LOCKS ==================================================================
--
-- One CREATE TABLE of a relation nothing else references, and two CREATE INDEX
-- on that same brand-new empty table. Nothing is scanned and nothing is
-- rewritten. The only lock taken on a live relation is by the foreign key,
-- which takes ShareRowExclusiveLock on `staging.organisations` for a catalogue
-- update -- that blocks WRITES to `organisations` (not reads) for the
-- microseconds it is held. `organisations` is read on nearly every request but
-- written rarely, so the exposure is small; it can still queue behind an open
-- long transaction, and `lock_timeout` below turns that into a clean rollback
-- instead of a stall. There is no CONCURRENTLY here on purpose: the table is
-- created empty in the same transaction, so an index build has nothing to do.
--
-- == APPLYING IT CHANGES NO BEHAVIOUR BY ITSELF =============================
--
-- No skill is wired to this table yet, by design. Applying this file makes
-- every skill return exactly what it returned before. The mechanism only takes
-- effect when a handler starts calling `skill_ack.apply_acks`, and each such
-- wiring is its own decision about which of that skill's fields are identity
-- and which are material -- which is the judgement this table cannot make.

BEGIN;

-- A queued ShareRowExclusive lock blocks everything that arrives behind it.
-- Five seconds then failing cleanly beats stalling `organisations`.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS staging.skill_finding_ack (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant. CASCADE because an acknowledgement is meaningless once the org is
    -- gone, and it matches `pahchan_notice_acknowledgements`, the only other
    -- acknowledgement table in this database.
    org_id           uuid        NOT NULL
                       REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- The `SKILL_REGISTRY` slug in `services/skill_dispatcher.py`, e.g.
    -- 'propose_payment_run'. NOT a template id -- see the header.
    skill            text        NOT NULL,

    -- Opaque identity digest. Hex only: a raw UUID cannot be stored here.
    finding_key      text        NOT NULL,

    -- Opaque material-state digest, or NULL for an unconditional ack.
    state_hash       text,

    -- What a person would recognise. Names, not ids; no contact details.
    finding_label    text        NOT NULL,

    -- WHO. `text`, and NO foreign key, which is not an oversight: the actor
    -- identifiers this application writes are `user_`-prefixed strings, while
    -- `public.users.id` is a uuid -- probed 19 August 2026, all 31 rows uuid,
    -- and every `user_`-prefixed value in `hub_skill_runs.triggered_by` and
    -- `pahchan_notice_acknowledgements.user_id` would be rejected by an FK to
    -- it. Both of those columns are `text` for exactly this reason. Migrations
    -- 030 and 092 exist because it was forgotten once; this is the third scar
    -- and it is not going to be a fourth.
    acknowledged_by  text        NOT NULL,
    acknowledged_at  timestamptz NOT NULL DEFAULT now(),

    -- NULL = permanent. See the header: expired rows are kept, not swept.
    snooze_until     timestamptz,

    -- Not NULL. One absent value, not two -- migration 112's rule, set for the
    -- `note` column on `hub_skill_requests` and held here for the same reason.
    -- (An earlier draft of this line cited migration 106, which is about
    -- Pahchan attendance report defaults and says nothing of the sort.)
    note             text        NOT NULL DEFAULT '',

    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- Hex-only, so a UUID (which has dashes) cannot be stored as a key. This is
    -- the names-not-IDs rule enforced by the schema rather than by review.
    CONSTRAINT skill_finding_ack_key_ck
        CHECK (finding_key ~ '^[0-9a-f]{16,128}$'),
    CONSTRAINT skill_finding_ack_state_ck
        CHECK (state_hash IS NULL OR state_hash ~ '^[0-9a-f]{16,128}$'),
    -- Registry-slug shape. Also refuses a template UUID, for the same reason.
    CONSTRAINT skill_finding_ack_skill_ck
        CHECK (skill ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT skill_finding_ack_label_ck
        CHECK (length(btrim(finding_label)) > 0),
    CONSTRAINT skill_finding_ack_actor_ck
        CHECK (length(btrim(acknowledged_by)) > 0)
);

-- One live acknowledgement per finding, and simultaneously the index the read
-- path uses: `fetch_ack_set` selects on (org_id, skill), which is this index's
-- leading prefix, so no second index is needed for the only query there is.
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_finding_ack
    ON staging.skill_finding_ack (org_id, skill, finding_key);

-- Answers "what is currently snoozed, and is anything being avoided?" without
-- reading the permanent acks, which are the overwhelming majority. Partial, so
-- it stays small.
CREATE INDEX IF NOT EXISTS idx_skill_finding_ack_snoozed
    ON staging.skill_finding_ack (org_id, snooze_until)
    WHERE snooze_until IS NOT NULL;

COMMENT ON TABLE staging.skill_finding_ack IS
    'One row per skill finding an org has dealt with. Keyed on a DERIVED '
    'finding_key (see services/skill_ack.py), never a row id. state_hash NULL '
    'means suppress regardless of movement; snooze_until NULL means permanent. '
    'Last writer, not a history.';

COMMIT;
