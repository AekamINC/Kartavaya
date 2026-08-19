-- 164 · Offboarding custody — what the leaver still holds, and what was taken back.
--
-- WHAT THIS FILE TOUCHES, exactly:
--   CREATES  staging.manav_offboarding_custody   (one new table, previously absent —
--            confirmed against the live catalog on 2026-08-19: no table in either
--            schema records a reassignment or a revocation, and the only
--            offboarding tables are manav_offboarding and manav_exit_interviews)
--   CREATES  four indexes on that new table
--   ALTERS   staging.manav_offboarding — SIX new nullable columns, all ADD COLUMN
--            IF NOT EXISTS. No existing column is renamed, retyped, defaulted or
--            dropped, and no CHECK constraint on that table is touched.
--   DROPS    nothing. INSERTs, UPDATEs and DELETEs nothing.
--
-- WRITE-PATH SIDE EFFECTS ON PRODUCTION (staging and production share one
-- Supabase database, so this runs against live rows):
--   · ADD COLUMN ... nullable with no DEFAULT is a catalog-only change in
--     PostgreSQL 11+ — no table rewrite, no row is touched, and the ACCESS
--     EXCLUSIVE lock is held for microseconds. manav_offboarding holds 11 rows.
--   · Nothing reads or writes these columns until services/custody/offboarding.py
--     is deployed, so an application running the OLD code is unaffected.
--   · The one real risk is the lock QUEUE, not the lock: if a long transaction is
--     already holding manav_offboarding, this ALTER waits behind it and every
--     later reader waits behind this ALTER. lock_timeout below caps that at three
--     seconds — a failed migration you re-run is strictly better than an HR module
--     that stops answering. Re-running is free; see below.
--
-- IF IT RUNS TWICE: nothing happens. CREATE TABLE / CREATE INDEX are IF NOT
-- EXISTS and every ALTER is ADD COLUMN IF NOT EXISTS. There is no seed data and
-- no UPDATE, so a second run cannot restate a fact a human has since corrected.

-- BEGIN is not decoration and it is not only about atomicity. `SET LOCAL` is
-- scoped to a transaction: run outside one, PostgreSQL emits
-- `WARNING: SET LOCAL can only be used in transaction blocks` and the setting
-- takes no effect at all. Without this BEGIN the lock_timeout promised above is
-- inert, and the ALTER below would queue behind a long-running transaction on
-- manav_offboarding for as long as that transaction lasts — with every later
-- reader of the HR module queued behind the ALTER. That is the exact outage the
-- timeout exists to prevent. Migrations 095–107 and siblings 158–163 all wrap
-- for this reason; this file must too.
BEGIN;

SET LOCAL lock_timeout = '3s';
-- A catalog-only ADD COLUMN cannot run long, so this cap only ever fires on
-- something having gone wrong. Matches the house value in 095/104/106.
SET LOCAL statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The ledger. One row per THING, not one row per exit.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `manav_offboarding.clearance` (migration 083) is a jsonb checklist and it is
-- the right shape for "laptop returned, ID card returned" — a firm's own list,
-- no migration per item. It is the WRONG shape for custody, for one reason: a
-- reassignment names a SECOND person. "Sharma's forty open tasks went to Iyer"
-- is a fact about Iyer as much as about Sharma, and the question actually asked
-- six months later is "what did Iyer inherit" — which a jsonb blob on Sharma's
-- row cannot answer without scanning every exit the firm has ever recorded.
--
-- So: a real table, indexed both ways.
CREATE TABLE IF NOT EXISTS staging.manav_offboarding_custody (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL,
    offboarding_id  uuid NOT NULL,
    employee_id     uuid NOT NULL,

    -- The two halves of the brief, and they are genuinely different verbs.
    -- A reassignment must name a destination; a revocation must name a time.
    -- Keeping them in one table rather than two is what makes "is custody
    -- finished" a single query instead of a join nobody remembers to write.
    action          text NOT NULL,

    -- What kind of thing. Deliberately NOT a foreign key to anything: the
    -- subjects live across two schemas' tables (public.tasks,
    -- staging.graha_clients, staging.user_roles, public.team_members) and some
    -- key on text while others key on uuid. An FK would have to pick one and
    -- would then refuse to record the others.
    subject_type    text NOT NULL,

    -- The machine handle for the subject: tasks.task_id, graha_clients.id::text,
    -- user_roles.role_code, teams.team_id. NULL is legal — a firm recording
    -- "the physical DSC token in the second drawer" has no row to point at, and
    -- refusing that record is how it ends up in nobody's notes instead.
    subject_ref     text,

    -- The human name, and it is NOT NULL on purpose. NAMES, NOT IDS: every
    -- reader of this register — the exit checklist, the audit answer, the
    -- "what did Iyer inherit" question — displays this column and never
    -- subject_ref. A row that cannot be labelled cannot be shown to anybody, so
    -- it is refused at write time rather than rendered as a raw uuid later.
    subject_label   text NOT NULL,

    -- Reassignment only. Both columns, because the user_id alone would render as
    -- an opaque handle, and the name alone cannot be re-resolved once the
    -- successor also leaves.
    reassigned_to_user_id text,
    reassigned_to_name    text,

    -- Revocation only. `revoked_at` is when access actually stopped, which is
    -- NOT when the row was written: credentials are commonly killed on the last
    -- working day and recorded the following week, and a compliance answer that
    -- reports the recording date overstates the exposure window.
    revoked_at      timestamptz,
    revoked_by      text,

    -- 'outstanding' is the default because that is what a newly-discovered item
    -- IS. 'waived' exists so a firm can close a line honestly — the client was
    -- lost, the portal was decommissioned — instead of marking it done and lying
    -- to its own audit trail.
    status          text NOT NULL DEFAULT 'outstanding',
    waived_reason   text,

    note            text,
    recorded_by     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT manav_offboarding_custody_action_ck CHECK (action IN (
        'reassign', 'revoke'
    )),
    CONSTRAINT manav_offboarding_custody_status_ck CHECK (status IN (
        'outstanding', 'done', 'waived'
    )),
    -- The subject vocabulary. `portal_credential` and `dsc_token` have NO table
    -- behind them in this database today (checked 2026-08-19: the only match for
    -- credential/dsc/portal/access in either schema is
    -- staging.hub_connector_credentials, which is a per-ORG social-publishing
    -- credential and not a per-person one). Migration 160 proposes
    -- staging.dsc_register, but it keys custody on `custody_holder_name TEXT` —
    -- a name, not a login or an employee id — so a leaver cannot be joined to it
    -- and this register does not try. Both values are listed anyway because they
    -- are the two things a practice most needs to take back from a leaver, and a
    -- register that cannot record them until some other table exists is a
    -- register that gets kept in a spreadsheet instead. See the INTEGRATION
    -- POINT note in services/custody/offboarding.py.
    CONSTRAINT manav_offboarding_custody_subject_ck CHECK (subject_type IN (
        'task', 'client', 'deal', 'contact', 'follow_up',
        'role_grant', 'module_grant', 'team_membership',
        'portal_credential', 'dsc_token', 'device', 'other'
    )),
    -- A reassignment with nowhere to go is the exact failure this register
    -- exists to prevent: work marked handed over, to nobody. Enforced only on
    -- completion, so an item can be raised as outstanding before the successor
    -- has been chosen.
    CONSTRAINT manav_offboarding_custody_destination_ck CHECK (
        action <> 'reassign' OR status <> 'done'
        OR (reassigned_to_user_id IS NOT NULL OR reassigned_to_name IS NOT NULL)
    ),
    -- Likewise: revoked means a time. "Done" with no timestamp cannot answer the
    -- only question anybody asks afterwards, which is when the access stopped.
    CONSTRAINT manav_offboarding_custody_revoked_at_ck CHECK (
        action <> 'revoke' OR status <> 'done' OR revoked_at IS NOT NULL
    ),
    -- A waiver without a reason is a tick-box. This is the one column that turns
    -- "we decided not to" from an absence into a record.
    CONSTRAINT manav_offboarding_custody_waived_ck CHECK (
        status <> 'waived' OR waived_reason IS NOT NULL
    )
);

-- One row per (exit, verb, thing). Without this, a service that re-scans the
-- leaver's open work every time the page is opened writes a duplicate line for
-- every task on every visit, and the register grows a fresh copy of the truth
-- daily. Partial, because subject_ref is legitimately NULL for free-text items
-- (a drawer key), and NULLs are distinct in a unique index — so those rows must
-- be allowed to repeat rather than silently collapsing into one.
CREATE UNIQUE INDEX IF NOT EXISTS manav_offboarding_custody_one_per_subject
    ON staging.manav_offboarding_custody (org_id, offboarding_id, action, subject_type, subject_ref)
    WHERE subject_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manav_offb_custody_offb
    ON staging.manav_offboarding_custody (org_id, offboarding_id);

-- "What is still open on this exit" — the query the whole module exists for.
CREATE INDEX IF NOT EXISTS idx_manav_offb_custody_outstanding
    ON staging.manav_offboarding_custody (org_id, employee_id)
    WHERE status = 'outstanding';

-- "What did this person INHERIT" — the other direction, and the one a jsonb
-- checklist could never serve.
CREATE INDEX IF NOT EXISTS idx_manav_offb_custody_successor
    ON staging.manav_offboarding_custody (org_id, reassigned_to_user_id)
    WHERE reassigned_to_user_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The roll-up on the exit itself.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These six answer "is this exit safe to close" without touching the ledger.
-- They are a SUMMARY of it, never a substitute: the ledger says WHICH access,
-- these say whether all of it is gone.
--
-- Note what is deliberately NOT here: a new value in
-- manav_offboarding_status_ck. Adding one means DROP CONSTRAINT + ADD
-- CONSTRAINT, which is neither additive nor safely re-runnable, and it would
-- momentarily leave the live table unconstrained. Custody completeness is
-- therefore its own pair of timestamps rather than a status the existing
-- lifecycle has to make room for.
ALTER TABLE staging.manav_offboarding
    -- Who inherits by default. uuid against manav_employees.id, and NOT a
    -- reporting line: manav_employees.reporting_to is TEXT against a uuid id and
    -- is unwritten on all 98 live rows (probed 2026-08-19), so anything derived
    -- from it would resolve to nobody for every employee in the database. The
    -- successor is a decision a human makes at exit time. It is stored, not
    -- inferred.
    ADD COLUMN IF NOT EXISTS handover_to_employee_id uuid,

    -- When the reassignment half was finished. NULL means work may still be
    -- pointed at somebody who has left.
    ADD COLUMN IF NOT EXISTS handover_completed_at   timestamptz,

    -- When the revocation half was finished, and who confirmed it. This is the
    -- pair an access-control question is answered from, so it records the
    -- confirming human and not only the clock.
    ADD COLUMN IF NOT EXISTS access_revoked_at       timestamptz,
    ADD COLUMN IF NOT EXISTS access_revoked_by       text,

    -- The scan's own timestamp. Distinct from the two above: it says when the
    -- system last LOOKED for outstanding custody, which is how you tell "nothing
    -- outstanding" apart from "never checked". Those two look identical in every
    -- report that omits this column, and only one of them is good news.
    ADD COLUMN IF NOT EXISTS custody_scanned_at      timestamptz,

    ADD COLUMN IF NOT EXISTS custody_notes           text;

COMMENT ON TABLE staging.manav_offboarding_custody IS
    'One row per thing a leaver held: reassignments (with a named successor) and revocations (with the time access actually stopped). subject_label is the display field; subject_ref is a machine handle and is never rendered.';
COMMENT ON COLUMN staging.manav_offboarding.custody_scanned_at IS
    'When custody was last scanned. NULL distinguishes "never checked" from "nothing outstanding".';
COMMENT ON COLUMN staging.manav_offboarding.handover_to_employee_id IS
    'Default successor, chosen by a human. NOT derived from manav_employees.reporting_to, which is unwritten on every live row.';

COMMIT;
