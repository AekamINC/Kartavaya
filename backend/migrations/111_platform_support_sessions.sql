-- 111_platform_support_sessions.sql
--
-- SUPPORT ACCESS THE CUSTOMER GRANTS, RATHER THAN SUPPORT ACCESS AEKAM HELPS
-- ITSELF TO.
--
-- Today a platform-tier account reaches any tenant through the `X-Org-Id`
-- header and `subscription.PLATFORM_MODULE_LEVEL`, which is ADMIN. There is no
-- record that it happened, no ceiling on what it reaches, no clock on it and
-- nothing the customer can revoke. RBAC-SPEC:19 says a support session is
-- requested, approved by the customer, capped below admin and time-boxed. This
-- is the table that makes each of those four words a database fact instead of a
-- paragraph in a spec.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/111_platform_support_sessions.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 6 August 2026. Measured against the live catalogue
-- (`SELECT to_regclass('staging.platform_support_sessions')` returns NULL,
-- project toacecaewujfxjfrjwco), deliberately not run.
--
-- ── THE MEASUREMENT THAT MAKES THIS SAFE TO SHIP ────────────────────────────
--
-- This apply grants nobody anything. The table is born empty, and an empty
-- table means zero support sessions, which is exactly the number of support
-- sessions that exist today. Every read path is already written to survive its
-- absence: `routers/org_switch.py:103-107` guards on `to_regclass` and answers
-- `[]`, and `OrgSwitcher.jsx` omits the whole "Support access" section when the
-- list is empty. So the before state and the after state are indistinguishable
-- to every user, and the only thing that changes is that the feature stops
-- being unreachable.
--
-- What it CANNOT do by accident is the part worth stating: the most permissive
-- row this schema can produce without anybody typing a value reaches zero
-- modules, as a viewer, for two hours, unapproved — and unapproved means
-- `v_active_support_sessions` does not return it at all.
--
-- ── WHY THERE IS NO `status` COLUMN ─────────────────────────────────────────
--
-- The obvious shape is
--
--       status TEXT CHECK (status IN ('pending','active','expired','revoked'))
--
-- and it is wrong, because a stored status is a cache of a clock. It says
-- 'active' until something writes 'expired'. That something is a sweeper, and a
-- sweeper can be late, can fail, can be undeployed, can be dropped in a
-- refactor — and every one of those failures leaves a session reading 'active'
-- three days after it ended, with nothing on screen looking wrong, because the
-- table looks fine.
--
-- The failure mode of a cache is that it is stale. The failure mode of a stale
-- authorisation cache is that somebody has access they should not have, and
-- nobody can tell by looking. So state is DERIVED, once, in
-- `staging.v_active_support_sessions`, and that view is the only place the
-- predicate is written. A caller that re-derives it will drift, and the drift
-- is always permissive: a forgotten `AND revoked_at IS NULL` is a grant the
-- customer cannot take back.
--
-- ── THE FOUR DURATIONS, AND WHY 0 IS ONE OF THEM ────────────────────────────
--
-- 2 hours, 24 hours, 7 days (168), and 0 meaning "until revoked". A free-text
-- integer would let somebody request 8760 and have it read as reasonable in a
-- list of numbers; a fixed vocabulary makes "until revoked" a deliberate choice
-- that looks like one. 0 is the ONLY value that yields a NULL `expires_at` on
-- an approved row, which is why `expires_at` is nullable and why every reader
-- must treat NULL as LIVE and not as expired. `org_switch._support_sessions`
-- carries that rule as `expires_at IS NULL OR expires_at > NOW()`.
--
-- Both halves are recorded. `requested_ttl_hours` is what the agent asked for
-- and `granted_ttl_hours` is what the customer allowed, and they are separate
-- columns because an approval that quietly shortened a request is the customer
-- exercising the control this feature exists to give them, and it must be
-- visible afterwards rather than overwritten.
--
-- ── THE APPROVAL AND THE OWNER MAIL ARE ONE ACT ─────────────────────────────
--
-- `pss_approval_and_owner_email_are_one_act` is the invariant that is a
-- constraint rather than a try/except somebody can reorder: `approved_at` and
-- `owner_emailed_at` are NULL together or NOT NULL together. Send first, then
-- write both in one statement. A support session the owner was never told about
-- is the whole feature failing quietly.
--
-- Note that `email_service.send_email` returns True on THREAD HANDOFF and is
-- worthless as delivery evidence. `staging.outbound_log` is the record; this
-- column is the fact that the attempt was made before the grant took effect.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One CREATE TABLE, one CREATE VIEW, four CREATE INDEX. Nothing is altered and
-- nothing is rewritten.
--
-- The foreign key takes ShareRowExclusiveLock on `staging.organisations` (3
-- rows) until COMMIT: writes to that table are blocked, reads are not. The
-- indexes are built on a table that is empty at the instant it is created, so
-- they are free. The exposure is acquisition rather than work — the FK queues
-- behind any open transaction on `organisations` — and `lock_timeout` makes the
-- bad case a clean rollback instead of a stall on a table read by nearly every
-- request.
--
-- No data is rewritten, so no wrong-database guard. Schema only.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── GUARD 0 · the parent ────────────────────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION
            'staging.organisations does not exist. A support session is scoped '
            'to one organisation; without the parent there is nothing to scope.';
    END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The session
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.platform_support_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The short human reference. A UUID cannot be read down a phone line, and
    -- the approval mail, the switcher row and the org audit log all have to
    -- name the SAME session to a person who is on the phone while they read it.
    -- Crockford-ish alphabet: no I and no O, because SUP-I0OI is not a thing
    -- anybody can dictate correctly.
    ref                 TEXT NOT NULL UNIQUE
                        CHECK (ref ~ '^SUP-[0-9A-HJ-NP-Z]{6}$'),

    org_id              UUID NOT NULL
                        REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- TEXT, not UUID: `user_549c9cac35aa`. Migrations 030 and 092 are the scars.
    requested_by        TEXT NOT NULL,

    -- What the customer is being asked to approve. Free text and NOT NULL with
    -- a length floor rather than a vocabulary: the owner is deciding whether to
    -- let a stranger into their books, and a picker with six canned reasons
    -- makes that decision look procedural. See pss_reason_is_substantive.
    reason              TEXT NOT NULL,

    -- The modules this session may touch. EMPTY BY DEFAULT, which reaches
    -- nothing: a row nobody finished filling in is not a skeleton key.
    modules             TEXT[] NOT NULL DEFAULT '{}',

    -- RBAC-SPEC:19 caps a support session BELOW admin. The platform tier is
    -- ADMIN everywhere else in this product and the entire purpose of a session
    -- is to narrow that, so a third value here is the feature inverted.
    access_level        TEXT NOT NULL DEFAULT 'viewer'
                        CHECK (access_level IN ('viewer', 'editor')),

    -- The shortest window is the default, so an unfinished request asks for the
    -- least.
    requested_ttl_hours INTEGER NOT NULL DEFAULT 2
                        CHECK (requested_ttl_hours IN (0, 2, 24, 168)),

    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── The approval half. NO DEFAULTS ANYWHERE BELOW THIS LINE. ────────────
    -- Every column here is written by a deliberate act, and a default on any
    -- one of them is a grant that happens because a row was inserted.

    approved_by         TEXT,
    approved_at         TIMESTAMPTZ,

    -- What the customer actually allowed, which may be shorter than what was
    -- asked for. No default: it is set only by an approval.
    granted_ttl_hours   INTEGER
                        CHECK (granted_ttl_hours IN (0, 2, 24, 168)),

    -- NULL is LIVE, not expired — it is what `granted_ttl_hours = 0` produces.
    expires_at          TIMESTAMPTZ,

    -- See pss_approval_and_owner_email_are_one_act.
    owner_emailed_at    TIMESTAMPTZ,

    denied_by           TEXT,
    denied_at           TIMESTAMPTZ,
    denial_reason       TEXT,

    revoked_by          TEXT,
    revoked_at          TIMESTAMPTZ,

    -- Who ended it. `customer` is the owner pulling the grant, `aekam` is a
    -- platform admin ending a colleague session, `self` is the support agent
    -- closing their own. Kept separate from `revoked_by` because the identity
    -- does not say which of the three happened: an Aekam platform admin can
    -- also be the person who requested it.
    revoked_by_party    TEXT
                        CHECK (revoked_by_party IN ('customer', 'aekam', 'self')),

    -- ── Invariants ──────────────────────────────────────────────────────────

    -- A reason is the only thing the owner has to decide on. "test", "x" and ""
    -- are all the same non-answer, and a notice that says nothing is worse than
    -- no notice because it looks like process.
    CONSTRAINT pss_reason_is_substantive
        CHECK (length(btrim(reason)) >= 12),

    -- One decision per request. A row that is both approved and denied has no
    -- readable meaning and both readings are defensible, which is the worst
    -- property an authorisation record can have.
    CONSTRAINT pss_not_both_approved_and_denied
        CHECK (approved_at IS NULL OR denied_at IS NULL),

    -- Every decision has an author and a time, or neither.
    CONSTRAINT pss_approver_pairs
        CHECK ((approved_at IS NULL) = (approved_by IS NULL)),

    CONSTRAINT pss_denier_pairs
        CHECK ((denied_at IS NULL) = (denied_by IS NULL)),

    CONSTRAINT pss_revoker_pairs
        CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)
           AND (revoked_at IS NULL) = (revoked_by_party IS NULL)),

    -- INVARIANT (c), as DDL rather than as an ordering somebody can change.
    CONSTRAINT pss_approval_and_owner_email_are_one_act
        CHECK ((approved_at IS NULL) = (owner_emailed_at IS NULL)),

    -- An approved session with no granted duration is a grant with no clock,
    -- and an unapproved row that already names one is a duration nobody agreed
    -- to.
    CONSTRAINT pss_approval_states_its_duration
        CHECK ((approved_at IS NULL) = (granted_ttl_hours IS NULL)),

    -- 0 is "until revoked" and is the ONLY value that leaves an approved row
    -- with a null expiry. Every other granted duration must produce a clock,
    -- and no unapproved row may carry one.
    CONSTRAINT pss_expiry_matches_granted_ttl
        CHECK ((granted_ttl_hours IS NULL AND expires_at IS NULL)
            OR (granted_ttl_hours = 0     AND expires_at IS NULL)
            OR (granted_ttl_hours > 0     AND expires_at IS NOT NULL)),

    -- Revoking something that was never approved is a state with no meaning:
    -- the withdrawal of a request is a denial, and it has its own columns.
    CONSTRAINT pss_revocation_needs_an_approval
        CHECK (revoked_at IS NULL OR approved_at IS NOT NULL),

    CONSTRAINT pss_decision_after_request
        CHECK ((approved_at IS NULL OR approved_at >= requested_at)
           AND (denied_at   IS NULL OR denied_at   >= requested_at)),

    CONSTRAINT pss_revocation_after_approval
        CHECK (revoked_at IS NULL OR revoked_at >= approved_at)
);

COMMENT ON TABLE staging.platform_support_sessions IS
    'A time-boxed, customer-approved grant that lets one Aekam support account '
    'act inside one organisation, capped below admin. '
    'THERE IS DELIBERATELY NO status COLUMN: a stored status is a cache of a '
    'clock and it goes stale in the permissive direction, so a session reads '
    'as live long after it ended '
    'and nothing looks wrong. Authorisation reads '
    'staging.v_active_support_sessions, which is the one place the predicate is '
    'written.';

COMMENT ON COLUMN staging.platform_support_sessions.ref IS
    'The short human reference, SUP-XXXXXX. The approval mail, the switcher '
    'row and the audit entry all name the session with this token, because a '
    'customer on the phone cannot read a UUID and will not check one.';

COMMENT ON COLUMN staging.platform_support_sessions.expires_at IS
    'NULL means UNTIL REVOKED, which is a LIVE session with no clock. It is '
    'produced only by granted_ttl_hours = 0. A reader that filters on a bare '
    'expires_at > NOW() drops exactly the open-ended sessions, which are the '
    'ones most worth showing to the customer who granted them.';

COMMENT ON COLUMN staging.platform_support_sessions.granted_ttl_hours IS
    'What the customer allowed, which may be shorter than requested_ttl_hours. '
    'Both are kept: an approval that quietly narrowed a request is the customer '
    'using the control this feature exists to give them, and overwriting the '
    'ask would erase the evidence that they did.';

COMMENT ON COLUMN staging.platform_support_sessions.owner_emailed_at IS
    'The instant the owner notification was handed off, written in the SAME '
    'statement as approved_at and constrained to be NULL with it. '
    'email_service.send_email returns True on thread handoff and is not '
    'delivery evidence; staging.outbound_log is the record of what was sent.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · The predicate, written once
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Four clauses, and every one of them is load-bearing:
--
--   approved_at IS NOT NULL   a request is not a grant
--   denied_at   IS NULL       111 keeps both timestamps, so an approved row
--                             that was later denied would otherwise read live
--   revoked_at  IS NULL       the customer pulling the grant is the whole point
--   expires_at  NULL or future   NULL is until-revoked and must NOT be dropped
--
-- `security_invoker` so that the view never becomes a way around RLS if
-- PROPOSED_081 is ever applied. A SECURITY DEFINER view over an authorisation
-- table is a hole with a nice name.

CREATE OR REPLACE VIEW staging.v_active_support_sessions
    WITH (security_invoker = true) AS
SELECT s.id,
       s.ref,
       s.org_id,
       s.requested_by,
       s.access_level,
       s.modules,
       s.approved_by,
       s.approved_at,
       s.expires_at
  FROM staging.platform_support_sessions s
 WHERE s.approved_at IS NOT NULL
   AND s.denied_at   IS NULL
   AND s.revoked_at  IS NULL
   AND (s.expires_at IS NULL OR s.expires_at > NOW());

COMMENT ON VIEW staging.v_active_support_sessions IS
    'THE authorisation predicate for platform support access. Read this; never '
    'rebuild the four clauses at a call site. Drift in a re-derived predicate '
    'is always permissive, because the clause a reader forgets is one that '
    'excludes rows.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Indexes
-- ═════════════════════════════════════════════════════════════════════════════

-- ONE PENDING REQUEST PER AGENT PER ORG, as an index rather than as Python.
-- Two presses of "Request access" race, and the customer gets two mails about
-- one request. The partial predicate is deliberately the UNDECIDED state, so a
-- denied request can be asked again with a better reason.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pss_one_pending_per_agent_per_org
    ON staging.platform_support_sessions (org_id, requested_by)
    WHERE approved_at IS NULL AND denied_at IS NULL;

-- The org owner screen: what is pending and what is live for MY organisation.
CREATE INDEX IF NOT EXISTS idx_pss_org_requested
    ON staging.platform_support_sessions (org_id, requested_at DESC);

-- `org_switch._support_sessions`: the orgs THIS agent can currently reach.
CREATE INDEX IF NOT EXISTS idx_pss_requester_live
    ON staging.platform_support_sessions (requested_by, approved_at)
    WHERE denied_at IS NULL AND revoked_at IS NULL;

-- Lookup by the token a customer reads out.
CREATE INDEX IF NOT EXISTS idx_pss_ref
    ON staging.platform_support_sessions (ref);

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The table and the view exist, and the view is security_invoker.
--      SELECT to_regclass('staging.platform_support_sessions') AS tbl,
--             to_regclass('staging.v_active_support_sessions') AS vw;
--      SELECT reloptions FROM pg_class
--       WHERE oid = 'staging.v_active_support_sessions'::regclass;
--    Expect: {security_invoker=true}

-- 2. THE APPLY GRANTED NOBODY ANYTHING. Both zero, forever, until somebody
--    requests a session and a customer approves it. This is the check that
--    demonstrates the header claim that before and after are indistinguishable.
--      SELECT count(*) AS sessions FROM staging.platform_support_sessions;
--      SELECT count(*) AS live     FROM staging.v_active_support_sessions;

-- 3. THERE IS NO STORED STATUS COLUMN. If this returns a row, somebody added
--    the cache this file exists to argue against.
--      SELECT column_name FROM information_schema.columns
--       WHERE table_schema='staging' AND table_name='platform_support_sessions'
--         AND column_name IN ('status','state','is_active','active');
--    Expect: zero rows.

-- 4. AN APPROVAL CANNOT BE COMMITTED WITHOUT THE OWNER BEING TOLD.
--      BEGIN;
--        INSERT INTO staging.platform_support_sessions
--               (ref, org_id, requested_by, reason, granted_ttl_hours,
--                approved_by, approved_at, expires_at)
--          SELECT 'SUP-AAAAAA', id, 'user_probe',
--                 'customer reported a locked invoice run',
--                 2, 'user_owner', NOW(), NOW() + INTERVAL '2 hours'
--            FROM staging.organisations LIMIT 1;
--        -- expect: violates pss_approval_and_owner_email_are_one_act
--      ROLLBACK;

-- 5. AN UNTIL-REVOKED SESSION IS LIVE, NOT EXPIRED. The null expiry is the
--    case a bare `expires_at > NOW()` silently drops.
--      BEGIN;
--        INSERT INTO staging.platform_support_sessions
--               (ref, org_id, requested_by, reason, granted_ttl_hours,
--                approved_by, approved_at, owner_emailed_at)
--          SELECT 'SUP-BBBBBB', id, 'user_probe',
--                 'migration assistance, open ended',
--                 0, 'user_owner', NOW(), NOW()
--            FROM staging.organisations LIMIT 1;
--        SELECT count(*) FROM staging.v_active_support_sessions
--         WHERE ref='SUP-BBBBBB';   -- expect 1
--      ROLLBACK;

-- 6. REVOCATION TAKES EFFECT IMMEDIATELY AND WITHOUT A SWEEPER.
--      BEGIN;
--        INSERT INTO staging.platform_support_sessions
--               (ref, org_id, requested_by, reason, granted_ttl_hours,
--                approved_by, approved_at, owner_emailed_at, expires_at)
--          SELECT 'SUP-CCCCCC', id, 'user_probe',
--                 'customer reported a locked invoice run',
--                 24, 'user_owner', NOW(), NOW(), NOW() + INTERVAL '24 hours'
--            FROM staging.organisations LIMIT 1;
--        SELECT count(*) FROM staging.v_active_support_sessions
--         WHERE ref='SUP-CCCCCC';   -- expect 1
--        UPDATE staging.platform_support_sessions
--           SET revoked_at=NOW(), revoked_by='user_owner',
--               revoked_by_party='customer'
--         WHERE ref='SUP-CCCCCC';
--        SELECT count(*) FROM staging.v_active_support_sessions
--         WHERE ref='SUP-CCCCCC';   -- expect 0
--      ROLLBACK;

-- 7. NOTHING GRANTS ACCESS BY OMISSION. The least-filled row possible reaches
--    zero modules, as a viewer, for two hours, and is NOT live.
--      BEGIN;
--        INSERT INTO staging.platform_support_sessions (ref, org_id, requested_by, reason)
--          SELECT 'SUP-DDDDDD', id, 'user_probe', 'looking into something'
--            FROM staging.organisations LIMIT 1;
--        SELECT modules, access_level, requested_ttl_hours
--          FROM staging.platform_support_sessions WHERE ref='SUP-DDDDDD';
--        -- expect: {} / viewer / 2
--        SELECT count(*) FROM staging.v_active_support_sessions
--         WHERE ref='SUP-DDDDDD';   -- expect 0
--      ROLLBACK;

-- 8. A SUPPORT AGENT CANNOT BE GRANTED ADMIN.
--      BEGIN;
--        INSERT INTO staging.platform_support_sessions
--               (ref, org_id, requested_by, reason, access_level)
--          SELECT 'SUP-EEEEEE', id, 'user_probe',
--                 'customer reported a locked invoice run', 'admin'
--            FROM staging.organisations LIMIT 1;
--        -- expect: violates the access_level CHECK
--      ROLLBACK;

-- 9. TWO PRESSES OF "REQUEST ACCESS" MAKE ONE REQUEST.
--      BEGIN;
--        INSERT INTO staging.platform_support_sessions (ref, org_id, requested_by, reason)
--          SELECT 'SUP-FFFFFF', id, 'user_probe', 'first press of the button'
--            FROM staging.organisations LIMIT 1;
--        INSERT INTO staging.platform_support_sessions (ref, org_id, requested_by, reason)
--          SELECT 'SUP-GGGGGG', id, 'user_probe', 'second press of the button'
--            FROM staging.organisations LIMIT 1;
--        -- expect: violates idx_pss_one_pending_per_agent_per_org
--      ROLLBACK;


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   DROP VIEW  IF EXISTS staging.v_active_support_sessions;
--   DROP TABLE IF EXISTS staging.platform_support_sessions;
--
-- Safe while nothing reads them, which is true until the request and approval
-- endpoints ship. `org_switch._support_sessions` already handles the table
-- being absent, so dropping it degrades the switcher to the state it is in
-- today rather than breaking it.


-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
--
-- NO STATUS COLUMN. Argued at length in the header. The DDL a future author
-- would write is quoted there so that the argument is where the change would
-- be made.
--
-- NO SWEEPER, NO CRON, NO `expire_sessions()` FUNCTION. There is nothing to
-- sweep: expiry is a comparison against NOW() inside the view, evaluated at
-- read time, and a session is out of the view the instant its clock passes. A
-- sweeper would exist only to maintain the cache this file refuses to keep.
--
-- NO ROW IN `user_roles`. A support session is NOT a role grant. Writing one
-- would put an Aekam account into the customer org member list, where it would
-- appear in the team screen, count against `max_users` through
-- `org_invites.count_seats`, and survive the session it came from. Resolution
-- goes through the view at request time, next to the existing `X-Org-Id`
-- membership check, and leaves no residue when the session ends.
--
-- NO AUDIT TABLE. `staging.audit_log` (migration 060) already exists and is the
-- place a support action is recorded. A second, feature-local audit trail is
-- how two partial answers to "what did they do" come to exist.
--
-- NO `org_id` ON THE NOTIFICATION. The owner is resolved at send time from
-- `user_roles WHERE org_id = $1 AND role_code = 'org_owner'` — the same
-- resolution the rest of the product uses — and `owner_emailed_at` records only
-- that it happened. 112 explains why a `notified_to` array is worth having when
-- the recipient set is GUESSED; here it is not guessed, it is the org owner.
