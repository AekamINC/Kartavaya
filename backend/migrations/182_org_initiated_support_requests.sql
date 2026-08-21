-- 182_org_initiated_support_requests.sql
--
-- THE STEP THAT WAS MISSING: THE CUSTOMER ASKING.
--
-- The owner's flow, verbatim:
--
--     org requests > aekam gets email and notification > aekam sends request
--     > org approves
--
-- Migration 111 and `services/support_session.py` implement only the last two
-- steps. A `platform_support` holder raises a request naming an org, a reason,
-- a module list and a TTL, and an `org_owner`/`org_admin` approves it. THERE
-- WAS NO WAY FOR AN ORGANISATION TO ASK IN THE FIRST PLACE, which is what the
-- owner noticed. This table is that first step and nothing else.
--
-- ── WHAT THIS TOUCHES ───────────────────────────────────────────────────────
--
-- ONE new table: `staging.platform_support_requests`. Three new indexes on it.
-- Nothing existing is altered, nothing is rewritten, no view is replaced, no
-- constraint on any existing table is added or dropped.
--
-- 111 MUST BE APPLIED FIRST. Not because this file references its table — it
-- deliberately does not, see below — but because a help request that nobody can
-- answer is worse than no button at all: `POST /api/v1/support-sessions` is the
-- reply, and that endpoint writes to `staging.platform_support_sessions`.
--
-- MEASURED 21 August 2026 against the live catalogue (project toacecaewujfxjfrjwco,
-- `railway run -e staging -s Kartavya`, SELECT only):
--
--     to_regclass('staging.platform_support_sessions')  -> present
--     to_regclass('staging.v_active_support_sessions')  -> present, {security_invoker=true}
--     count(*) FROM staging.platform_support_sessions   -> 0
--     count(*) FROM staging.v_active_support_sessions   -> 0
--     to_regclass('staging.platform_support_requests')  -> NULL
--
-- So 111 IS APPLIED, contrary to the note in its own header and in
-- `services/support_session.py`. Its six indexes and all ten of its named CHECK
-- constraints are on the live table. The prerequisite above is already met.
--
-- ── WHY A SIBLING TABLE AND NOT A COLUMN ON 111'S ───────────────────────────
--
-- Extending 111 was the first design and it is the wrong one, for one reason
-- that outranks the tidiness argument: EVERY ROW IN `platform_support_sessions`
-- IS ONE `UPDATE` AWAY FROM BEING A LIVE GRANT. `v_active_support_sessions`
-- turns any row with `approved_at IS NOT NULL` into authority inside a customer
-- org, and `POST /{id}/approve` is reachable by any `org_owner`/`org_admin` of
-- that org.
--
-- Put the customer's ask in that table and the following becomes possible: an
-- org admin raises a help request, a SECOND org admin of the same org presses
-- Approve on it (the self-approval guard only refuses the same person), and the
-- row enters `v_active_support_sessions` with `requested_by` set to a customer
-- account. Aekam never asked for anything and a support session now exists.
-- That inverts the double approval the owner confirmed.
--
-- It is defensible with a discriminator column plus a CHECK plus guards in
-- `open_session`, `_shape`, `get_session` and the approve route — four edits to
-- the grant path, to store a record that grants nothing. The cheaper and far
-- more durable answer is that a signal which grants nothing lives where an
-- UPDATE cannot make it a grant:
--
--   · this table has NO approved_at, NO approved_by, NO granted_ttl_hours,
--     NO expires_at, NO access_level and NO revoked_* columns. There is no
--     column here to set that would create authority.
--   · NO VIEW READS IT. `middleware/org_resolver.py` and
--     `middleware/subscription.py` resolve support authority from
--     `staging.v_active_support_sessions` and from nowhere else, and this file
--     does not touch that view.
--   · the grant path is UNCHANGED. `open_session` is not edited by the change
--     this migration supports.
--
-- The two are joined by `org_id`, at read time, in the list endpoint. That is
-- enough to answer "has anybody replied to this ask yet" without a foreign key
-- that would let a delete on one table touch the other.
--
-- ── WHY THERE IS NO `status`, NO `closed_at` AND NO `answered_at` ───────────
--
-- The same argument 111 makes at length, applied to a smaller table: a stored
-- status is a cache of an event, and its failure mode is staleness. An ask is
-- OPEN until Aekam raises a support session for that organisation after it was
-- raised, and that is a comparison against `platform_support_sessions`
-- evaluated at read time in `services.support_session.list_help_requests`. It
-- cannot be late, cannot fail and cannot be forgotten in a refactor, and no
-- second endpoint has to exist to keep it true.
--
-- A column that nothing writes is worse than no column: it reads as a fact.
--
-- ── WHY `notified_to` IS NOT NULL AND MUST NOT BE EMPTY ─────────────────────
--
-- 111's closing note says a `notified_to` array is worth having when the
-- recipient set is GUESSED. Here it is guessed. There is no "Aekam support
-- desk" account: `platform_support` has ZERO holders live (measured, same
-- probe), so the people who can actually act on an ask are the god-mode
-- platform roles, and which of them exist changes over time.
--
-- `CHECK (cardinality(notified_to) > 0)` makes "an ask nobody at Aekam was told
-- about cannot exist" a database fact rather than an ordering in Python that a
-- refactor can move. The service resolves the recipients, writes their
-- notification rows and this array in ONE transaction; if there is nobody to
-- tell, the request is refused with a sentence instead of committing a cry for
-- help into a table nobody reads.
--
-- It holds user ids and it is never rendered. `names, not IDs` is a rule about
-- what a screen shows; the list endpoint returns a COUNT.
--
-- ── WHY `raised_on` EXISTS ──────────────────────────────────────────────────
--
-- Two presses of "Ask for help" must make ONE ask, for the same reason 111
-- writes `idx_pss_one_pending_per_agent_per_org`: two presses race, and the
-- failure is Aekam receiving two mails and two notifications about one problem.
-- A Python check cannot win that race.
--
-- The dedupe key has to be indexable, and `date_trunc`/`AT TIME ZONE` over a
-- timestamptz is STABLE rather than IMMUTABLE, so it cannot go in a unique
-- index or a generated column. `raised_on` is therefore a plain DATE with a
-- DEFAULT — defaults may be volatile — written by the same INSERT that writes
-- `raised_at` and never written by hand. One ask per person, per org, per UTC
-- day. A second press inside the day answers 409 and names the first ask.
--
-- ── WHAT HAPPENS ON THE DAY ─────────────────────────────────────────────────
--
-- Nothing observable. The table is born empty; an empty table is exactly as
-- many help requests as exist today. Every read path in the service answers
-- `[]` on `UndefinedTableError` (42P01) and every write answers 503 naming this
-- file, so the endpoints behave identically before and after — the only thing
-- that changes is that `POST /api/v1/support-sessions/requests` stops
-- answering 503.
--
-- The most permissive row this schema can produce without anybody typing a
-- value does not exist: `ref`, `raised_by`, `reason` and `notified_to` are all
-- NOT NULL with no default, and `reason` must be substantive. There is no
-- half-filled row, and no row here reaches anything in any case.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One CREATE TABLE, three CREATE INDEX. Nothing is altered and nothing is
-- rewritten, so there is no exclusive lock on anything anybody is reading.
--
-- The one foreign key takes ShareRowExclusiveLock on `staging.organisations`
-- (3 active rows, measured) until COMMIT: writes to that table are blocked for
-- the duration, reads are not. The indexes are built on a table that is empty
-- at the instant it is created, so they are free. The exposure is ACQUISITION
-- rather than work — the FK queues behind any open transaction on
-- `organisations` — and `lock_timeout` turns the bad case into a clean rollback
-- instead of a stall on a table nearly every request reads.
--
-- STAGING AND PRODUCTION SHARE ONE DATABASE AND ONE `staging` SCHEMA. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/182_org_initiated_support_requests.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS staging.platform_support_requests;
--
-- Safe at any time. Nothing else references it, no view reads it, and the
-- service treats its absence as "no help requests" on every read and as a named
-- 503 on every write — which is the state the product is in today. Dropping it
-- cannot affect an existing support session, because no grant path touches it.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── GUARD 0 · the parent ────────────────────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION
            'staging.organisations does not exist. A help request is raised BY '
            'an organisation; without the parent there is nothing to scope it to.';
    END IF;
END $$;

-- ── GUARD 1 · the reply must be possible ────────────────────────────────────
-- Not a foreign key and deliberately not one — see the header. This is a
-- refusal to ship half a conversation: the ask is answered by
-- `POST /api/v1/support-sessions`, which writes 111's table.
DO $$
BEGIN
    IF to_regclass('staging.platform_support_sessions') IS NULL THEN
        RAISE EXCEPTION
            'migrations/111_platform_support_sessions.sql has not been applied. '
            'An organisation could raise a help request that Aekam has no way '
            'to answer. Apply 111 first.';
    END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The ask
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.platform_support_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ASK-XXXXXX, the same Crockford-ish alphabet 111 uses and a DIFFERENT
    -- prefix. The two refs travel together in one conversation — the customer
    -- reads ASK-A1B2C3 down a phone line and Aekam answers with SUP-D4E5F6 —
    -- and a shared prefix would make the audit log unable to say which of the
    -- two any given row is about.
    ref             TEXT NOT NULL UNIQUE
                    CHECK (ref ~ '^ASK-[0-9A-HJ-NP-Z]{6}$'),

    org_id          UUID NOT NULL
                    REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- The org_owner or org_admin who asked. TEXT, not UUID: `user_549c9cac35aa`.
    -- Migrations 030 and 092 are the scars.
    raised_by       TEXT NOT NULL,

    -- What they need help with, in their own words. The same floor 111 puts on
    -- a support request's reason, for the mirrored purpose: Aekam is deciding
    -- what scope to propose, and "help" is not something anybody can scope.
    reason          TEXT NOT NULL,

    -- Which modules they think the problem is in. A HINT, never a grant, and
    -- deliberately allowed to be empty — an organisation in trouble often does
    -- not know which module is at fault, and refusing the ask over that would
    -- be the product asking the customer to diagnose itself.
    modules         TEXT[] NOT NULL DEFAULT '{}',

    raised_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- THE DEDUPE KEY AND NOTHING ELSE. Never written by the application; the
    -- default fires in the same INSERT as `raised_at`, so the two cannot drift.
    -- See the header for why this is a plain column rather than generated.
    raised_on       DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::date,

    -- The Aekam accounts that got a `notifications` row for this ask, written
    -- in the same transaction as those rows. GUESSED recipients, which is
    -- exactly the case 111's closing note says is worth recording.
    notified_to     TEXT[] NOT NULL,

    -- ── Invariants ──────────────────────────────────────────────────────────

    CONSTRAINT psr_reason_is_substantive
        CHECK (length(btrim(reason)) >= 12),

    -- An ask nobody at Aekam was told about must not exist. This is the whole
    -- point of the row — it grants nothing, so being READ is the only thing it
    -- does — and a Python ordering that guarantees it is a Python ordering a
    -- refactor can move.
    CONSTRAINT psr_somebody_at_aekam_was_told
        CHECK (cardinality(notified_to) > 0)
);

COMMENT ON TABLE staging.platform_support_requests IS
    'AN ORGANISATION ASKING AEKAM FOR HELP. IT GRANTS NOTHING AND CANNOT BE '
    'MADE TO GRANT ANYTHING: there is no approved_at, no access_level, no '
    'expiry and no view that reads this table. Access is created in exactly '
    'one place, staging.platform_support_sessions, and only after the customer '
    'approves a scope Aekam proposed. The double approval is deliberate — the '
    'org asks, Aekam proposes a scope, the org approves THAT scope — and this '
    'table is the first of those three acts.';

COMMENT ON COLUMN staging.platform_support_requests.modules IS
    'A HINT about where the customer thinks the problem is. It is not a scope, '
    'it is not approved by anybody, and nothing reads it to decide authority. '
    'The scope of a support session comes from the session row in '
    'staging.platform_support_sessions and from the customer approving it.';

COMMENT ON COLUMN staging.platform_support_requests.notified_to IS
    'The Aekam user ids that received a notifications row for this ask, written '
    'in the same transaction as those rows. Recorded because the recipient set '
    'is GUESSED — platform_support has zero holders, so the people who can act '
    'are whichever god-mode accounts exist on the day. Never rendered: the list '
    'endpoint returns a count.';

COMMENT ON COLUMN staging.platform_support_requests.raised_on IS
    'The dedupe key for idx_psr_one_ask_per_person_per_org_per_day, and nothing '
    'else. Written only by its DEFAULT, in the same INSERT as raised_at. It '
    'exists because AT TIME ZONE over a timestamptz is STABLE rather than '
    'IMMUTABLE and therefore cannot be indexed or generated.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Indexes
-- ═════════════════════════════════════════════════════════════════════════════

-- TWO PRESSES MAKE ONE ASK, as an index rather than as Python. The harm a race
-- causes here is Aekam receiving two mails and two notification rows about one
-- problem, which is the same harm 111's partial unique index exists to prevent.
-- Per PERSON, not per org: two different administrators noticing two different
-- problems on the same day is two asks, and collapsing them would lose one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_psr_one_ask_per_person_per_org_per_day
    ON staging.platform_support_requests (org_id, raised_by, raised_on);

-- Aekam's queue: every ask, newest first.
CREATE INDEX IF NOT EXISTS idx_psr_raised
    ON staging.platform_support_requests (raised_at DESC);

-- The customer's own view: what MY organisation has asked for.
CREATE INDEX IF NOT EXISTS idx_psr_org_raised
    ON staging.platform_support_requests (org_id, raised_at DESC);


-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · VERIFY, in the same transaction. Catalogue reads only — this file writes
--     no rows, so nothing here needs a savepoint and nothing here can leave
--     residue in a shared production database.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    grantish TEXT;
    n INTEGER;
BEGIN
    IF to_regclass('staging.platform_support_requests') IS NULL THEN
        RAISE EXCEPTION 'the table was not created';
    END IF;

    -- THE PROPERTY THIS WHOLE FILE RESTS ON. If any of these columns is ever
    -- added here, this table stops being a signal and becomes a second place
    -- authority can be created — and the org_resolver would not know to look.
    -- `column_name` is `information_schema.sql_identifier`, a domain over
    -- `name`, and `string_agg` has no overload for it. The cast is required,
    -- not decorative — without it this block fails to parse at apply time.
    SELECT string_agg(column_name::text, ', ') INTO grantish
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name   = 'platform_support_requests'
       AND column_name IN ('approved_at', 'approved_by', 'access_level',
                           'granted_ttl_hours', 'expires_at', 'revoked_at',
                           'status', 'state', 'is_active', 'active');
    IF grantish IS NOT NULL THEN
        RAISE EXCEPTION
            'staging.platform_support_requests carries grant-shaped columns '
            '(%). A help request grants nothing; access is created only in '
            'staging.platform_support_sessions.', grantish;
    END IF;

    -- No view may read this table. A view over it is how a "convenience" join
    -- becomes an authorisation path nobody audited.
    SELECT count(*) INTO n
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class v   ON v.oid = r.ev_class AND v.relkind = 'v'
     WHERE d.refobjid = 'staging.platform_support_requests'::regclass
       AND d.classid  = 'pg_rewrite'::regclass;
    IF n > 0 THEN
        RAISE EXCEPTION 'a view already reads platform_support_requests (% found)', n;
    END IF;

    SELECT count(*) INTO n
      FROM pg_indexes
     WHERE schemaname = 'staging'
       AND tablename  = 'platform_support_requests'
       AND indexname  = 'idx_psr_one_ask_per_person_per_org_per_day';
    IF n <> 1 THEN
        RAISE EXCEPTION
            'the dedupe index is missing; two presses would make two asks and '
            'Aekam would get two mails about one problem';
    END IF;

    SELECT count(*) INTO n
      FROM pg_constraint
     WHERE conrelid = 'staging.platform_support_requests'::regclass
       AND conname IN ('psr_reason_is_substantive', 'psr_somebody_at_aekam_was_told');
    IF n <> 2 THEN
        RAISE EXCEPTION 'a named CHECK is missing (found % of 2)', n;
    END IF;

    -- THE APPLY GRANTED NOBODY ANYTHING, and it could not have.
    SELECT count(*) INTO n FROM staging.platform_support_requests;
    IF n <> 0 THEN
        RAISE EXCEPTION 'the table is not empty (% rows); this file creates it', n;
    END IF;

    -- And 111's live-session count is untouched by this file.
    SELECT count(*) INTO n FROM staging.v_active_support_sessions;
    RAISE NOTICE 'live support sessions before and after this migration: %', n;
END $$;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The table exists and NO VIEW READS IT.
--      SELECT to_regclass('staging.platform_support_requests');
--      SELECT count(*) FROM pg_depend d
--        JOIN pg_rewrite r ON r.oid = d.objid
--        JOIN pg_class v ON v.oid = r.ev_class AND v.relkind='v'
--       WHERE d.refobjid = 'staging.platform_support_requests'::regclass;
--    Expect: the table, and 0.

-- 2. NOTHING WAS GRANTED. Both counts are what they were before.
--      SELECT count(*) AS asks FROM staging.platform_support_requests;   -- 0
--      SELECT count(*) AS live FROM staging.v_active_support_sessions;   -- 0

-- 3. AN ASK NOBODY WAS TOLD ABOUT CANNOT BE COMMITTED.
--      BEGIN;
--        INSERT INTO staging.platform_support_requests
--               (ref, org_id, raised_by, reason, notified_to)
--          SELECT 'ASK-AAAAAA', id, 'user_probe',
--                 'the invoice run has been stuck since this morning', '{}'
--            FROM staging.organisations LIMIT 1;
--        -- expect: violates psr_somebody_at_aekam_was_told
--      ROLLBACK;

-- 4. A REASON THAT SAYS NOTHING IS REFUSED.
--      BEGIN;
--        INSERT INTO staging.platform_support_requests
--               (ref, org_id, raised_by, reason, notified_to)
--          SELECT 'ASK-BBBBBB', id, 'user_probe', 'help', '{user_aekam}'
--            FROM staging.organisations LIMIT 1;
--        -- expect: violates psr_reason_is_substantive
--      ROLLBACK;

-- 5. TWO PRESSES MAKE ONE ASK.
--      BEGIN;
--        INSERT INTO staging.platform_support_requests
--               (ref, org_id, raised_by, reason, notified_to)
--          SELECT 'ASK-CCCCCC', id, 'user_probe',
--                 'the invoice run has been stuck since this morning',
--                 '{user_aekam}' FROM staging.organisations LIMIT 1;
--        INSERT INTO staging.platform_support_requests
--               (ref, org_id, raised_by, reason, notified_to)
--          SELECT 'ASK-DDDDDD', id, 'user_probe',
--                 'the invoice run is still stuck, second press',
--                 '{user_aekam}' FROM staging.organisations LIMIT 1;
--        -- expect: violates idx_psr_one_ask_per_person_per_org_per_day
--      ROLLBACK;

-- 6. AN ASK CANNOT BE TURNED INTO A GRANT. There is no column to set.
--      SELECT column_name FROM information_schema.columns
--       WHERE table_schema='staging' AND table_name='platform_support_requests'
--         AND column_name IN ('approved_at','approved_by','access_level',
--                             'granted_ttl_hours','expires_at','revoked_at',
--                             'status','state','is_active','active');
--    Expect: zero rows.

-- 7. THE GRANT PATH IS UNCHANGED. 111's constraint set is exactly as it was.
--      SELECT count(*) FROM pg_constraint
--       WHERE conrelid='staging.platform_support_sessions'::regclass
--         AND contype='c';
--    Expect: the same number as before this file ran (10 named + 4 column CHECKs).


-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
--
-- NO FOREIGN KEY TO `platform_support_sessions`. The two are joined by `org_id`
-- at read time. A FK would make a delete on one table reach into the other and
-- would put a column on this row that names a grant — which is one refactor
-- away from being read as one.
--
-- NO `closed_at`, NO `answered_at`, NO `status`. Argued in the header: an ask is
-- open until Aekam raises a session for that org after it, and that is a read-
-- time comparison. A column nothing writes reads as a fact.
--
-- NO CHANGE TO `staging.v_active_support_sessions`. The authorisation predicate
-- is written once, in 111, and this file does not go near it.
--
-- NO ROW IN `user_roles`, NO ENTITLEMENT, NO CREDIT. An ask costs nothing and
-- entitles nobody to anything. The only thing it does is put a row in front of
-- somebody at Aekam.
--
-- NO SECOND AUDIT TABLE. `staging.audit_log` (migration 060) records the ask,
-- in the CUSTOMER'S org, written on the same connection inside the same
-- transaction as the row itself.
