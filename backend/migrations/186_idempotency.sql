-- 186 · Idempotency keys — the store that lets a CREATE be retried.
--
--       WRITTEN, NOT APPLIED. Nothing in this repository has run this file.
--       See "HOW TO APPLY" at the foot of the header before anybody does.
--
-- ── WHAT THIS FILE TOUCHES, exactly ──────────────────────────────────────────
--
--   CREATES  staging.idempotency_keys  (one new table, previously absent —
--            confirmed against the live catalog on 2026-08-21: the ONLY
--            object anywhere in `staging` or `public` whose name matches
--            '%idempot%' is the index `uq_org_credit_tx_idempotency`, and the
--            only column is `staging.hub_org_credit_transactions
--            .idempotency_key` (text). There is no request-level idempotency
--            store in this database and there never has been.)
--   CREATES  one index on that new table (the primary key is the second)
--   CREATES  staging.prune_idempotency_keys(int) — a function, called by
--            NOTHING until somebody wires it. Section 5 says so out loud.
--   ADDS     eleven CHECK constraints, each as its own guarded
--            `ALTER TABLE … ADD CONSTRAINT`, never inline — see THE INLINE
--            TRAP below.
--   COMMENTS on the table and on nine of its columns.
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--   ALTERS no existing table. DROPS nothing. Reads no existing row.
--   Does NOT touch staging.cleanup_old_data(), which exists (measured
--   2026-08-21, returns TABLE(table_name text, rows_deleted bigint)) but is
--   defined in NO migration in this repository. Section 5 explains.
--
-- IF IT RUNS TWICE: nothing happens. The table is CREATE TABLE IF NOT EXISTS,
-- the index is IF NOT EXISTS, every constraint is added inside a NOT EXISTS
-- guard against pg_constraint, the function is CREATE OR REPLACE behind a
-- signature guard, and there is no seed. A second run cannot mint a row and
-- therefore cannot fabricate a replay.
--
-- ── WRITE-PATH SIDE EFFECTS ON PRODUCTION ────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE ONE SUPABASE DATABASE and production writes to
-- `staging` too. This file creates one EMPTY table and one function. No
-- existing table is read, written, locked or rewritten. There is no ALTER on
-- any live relation, no FOREIGN KEY (see WHY NO FOREIGN KEY), and therefore no
-- lock taken on `organisations` or `public.users` — the two relations nearly
-- every request touches. Applying it cannot change any figure any user sees.
--
-- APPLYING IT CHANGES NO BEHAVIOUR AT ALL. The mobile client will start
-- sending an `Idempotency-Key` header the moment the next build ships; every
-- endpoint in `backend/routers/` will ignore it, exactly as it ignores any
-- unknown header, and this table will stay at zero rows. It becomes load-
-- bearing only when a router calls the service that reads and writes it — and
-- that service does not exist yet. See "WHAT THE SERVER STILL OWES".
--
-- THE UNPROTECTED WINDOW IS TODAY, NOT AFTER THIS FILE.
-- `components/NewTaskSheet.tsx:222` already enqueues `POST /tasks` (and
-- `POST /client/tasks/request`) when the device is offline, with no key of any
-- kind. `offline/mutationQueue.ts` retries a failed item up to three times. So
-- a create whose response is lost in transit — the ordinary outcome on a train
-- between Pune and Mumbai — is re-sent and makes a second task, and nothing in
-- the product can tell the two apart afterwards. This file is the store that
-- ends that; it does not by itself end it.
--
-- LOCKS: CREATE TABLE takes a lock on nothing that exists. `SET LOCAL
-- lock_timeout` is set anyway, so that a later edit to this file inherits the
-- cap rather than having to remember it.
--
-- ── WHY A TABLE AND NOT A CACHE ──────────────────────────────────────────────
--
-- The obvious alternative is Redis or an in-process dict. Both are wrong here
-- for the same reason: the guarantee has to survive the thing that causes the
-- retry. A backend restart, a Railway redeploy and a PgBouncer reconnect are
-- all events that (a) lose in-process state and (b) cause exactly the timeout
-- that makes the client retry. An idempotency store that forgets under the
-- conditions that produce duplicates protects against nothing. There is also
-- no Redis in this stack and adding one for this would be a larger decision
-- than this file.
--
-- The cost is one INSERT and one SELECT on the write path of every keyed
-- request, against a table with a two-column primary key and a seven-day
-- working set. That is cheap, and it is paid only by requests that carry the
-- header.
--
-- ── THE KEY, AND WHAT IT IS SCOPED TO ────────────────────────────────────────
--
-- The key is client-generated, opaque to the server, and the primary key is
--
--     (user_id, idempotency_key)
--
-- USER-SCOPED, not org-scoped, and this is the security decision in the file.
--
-- `routers/pahchan.py:511` carries the scar that argues it. Punch idempotency
-- was originally matched on `(org_id, client_punch_id)` alone, so a caller who
-- sent an id that happened to exist got back SOMEBODY ELSE'S PUNCH — its id,
-- direction, capture time and flags — with no ownership check. The fix there
-- was to add `employee_id` to the predicate. Here the principal is IN THE
-- PRIMARY KEY, so a lookup can only ever find the caller's own row and a
-- cross-principal replay is not a rule that code has to remember; it is a
-- shape the table cannot express.
--
-- `org_id` is recorded but is NOT part of the key, for two reasons:
--
--  1. MANY ROUTES RESOLVE NO ORG. `audit_org_switch_never_scoped` records 233
--     routes in core PM that resolve no org at all. A NOT NULL org_id would
--     make this table unusable on exactly the endpoints the mobile queue hits
--     most (`POST /tasks`), and a synthesised placeholder org would be a lie
--     in a column other people will later join on.
--  2. IT ADDS NOTHING. The principal already bounds the lookup. Adding org_id
--     to the key would mean the same user switching org context could replay a
--     key twice — one row per org — which is a duplicate create wearing the
--     costume of a scoping rule.
--
-- `org_id` is `uuid` because every one of the 228 columns named `org_id` in
-- `staging` is uuid (measured 2026-08-21, zero exceptions). `user_id` is
-- `text` because `public.users.user_id` is text (measured; it holds values of
-- the shape `user_549c9cac35aa`). Migrations 030 and 092 exist because that
-- was forgotten twice; this file does not make it three times.
--
-- ── WHY NO FOREIGN KEY ───────────────────────────────────────────────────────
--
-- `public.users` DOES carry `users_user_id_key UNIQUE (user_id)` (measured),
-- so an FK is possible. It is declined:
--
--  * It would take ShareRowExclusiveLock on `public.users` at apply time, and
--    `public.users` is read on nearly every request. Migration 096's note in
--    the README is about precisely this hazard on `organisations`.
--  * A row here is a SEVEN-DAY CACHE, not a record. It is not evidence of
--    anything, nobody reports on it, and a stale row for a deleted user is
--    harmless — it expires. An FK would buy referential integrity for data
--    whose whole point is to be thrown away.
--  * 185, 096 and 097 all record an actor as bare `text` with no FK. This
--    follows them.
--
-- ── THE STATE MACHINE, WHICH IS TWO STATES AND A LEASE ───────────────────────
--
--     'in_flight'   the request has been accepted and is running. No response
--                   recorded yet. A second attempt arriving now must NOT run
--                   the handler.
--     'completed'   the handler finished and its status and body are stored.
--                   Every later attempt with this key returns them.
--
-- There is deliberately no 'failed' state. A 4xx IS a completed outcome and is
-- stored as one: replaying "you are not allowed to do that" is correct and
-- costs nothing. A 5xx or an unhandled exception DELETES the row instead, so
-- the next attempt genuinely re-runs — see the no-cached-5xx CHECK, which is
-- the one constraint in this file that exists to stop a well-meaning
-- implementation from making a transient outage permanent.
--
-- 'in_flight' needs a lease or it becomes a tombstone. A process killed
-- mid-request (Railway redeploy, OOM, PgBouncer dropping the connection)
-- leaves a row that never completes, and without a lease every later attempt
-- with that key gets refused for ever and the user's create is unrecoverable.
-- So the rule the reader must implement is:
--
--     state='in_flight' AND created_at > now() - interval '60 seconds'
--         →  409, "still running, retry shortly"
--     state='in_flight' AND created_at <= now() - interval '60 seconds'
--         →  ABANDONED. Take it over: UPDATE created_at = now() and run.
--
-- 60 seconds because the mobile client's axios timeout is 15 seconds
-- (`mobile/src/api/client.ts`) and Railway's request ceiling is well under a
-- minute; a row older than that cannot still be being served. The lease is NOT
-- a column — it is `created_at` plus a constant — because a second timestamp
-- that has to be kept in step with the first is one more thing to get wrong,
-- and this one is only ever compared, never displayed.
--
-- ── THE FINGERPRINT, AND WHY THE SERVER COMPUTES IT ALONE ────────────────────
--
-- The same key with a DIFFERENT body is the failure this catches. Without it,
-- a client bug that reuses one key for two different creates gets the FIRST
-- create's response for the second create — so the app shows a success, the
-- second thing was never made, and nothing anywhere records that.
--
--     request_fingerprint = sha256_hex( METHOD || '\n' || PATH || '\n' || RAW_BODY_BYTES )
--
-- RAW BODY BYTES, exactly as received off the wire — never a re-serialisation
-- of a parsed model. Re-serialising invites a key-order or float-formatting
-- difference between two attempts that carried identical bytes, which would
-- reject a legitimate retry.
--
-- THE CLIENT NEVER COMPUTES THIS. It is a comparison between attempt 1's bytes
-- and attempt 2's bytes, both seen by the server. The client's only obligation
-- is not to change the body under a key it has already sent — and
-- `mutationQueue.ts` guarantees that by minting a NEW key whenever a squash
-- changes a body, for every method except POST.
--
-- A mismatch is 422, not 409. 409 already means "in flight, retry"; a client
-- that cannot tell those apart retries a request that will never succeed.
--
-- ── THE INLINE TRAP, WHICH THIS FILE AVOIDS BY CONSTRUCTION ──────────────────
--
-- `ALTER TABLE … ADD COLUMN IF NOT EXISTS x text CHECK (…)` skips the WHOLE
-- clause when the column already exists: the constraint is silently NOT
-- created and pg_constraint is the only place the truth lives. The same trap
-- has a second mouth that is less well known — `CREATE TABLE IF NOT EXISTS`
-- against an ALREADY EXISTING table skips everything in the parentheses too,
-- including every inline CHECK.
--
-- So the CHECKs here are NOT inline. The CREATE TABLE carries columns and the
-- primary key and nothing else; all eleven CHECKs are separate
-- `ALTER TABLE … ADD CONSTRAINT` statements inside a NOT EXISTS guard, the
-- pattern migration 184 §2 established. That makes a re-run against a
-- half-created table SELF-HEAL rather than silently leave the table
-- unconstrained, and section 6 reads pg_constraint by name to prove it.
--
-- ── EXPIRY: SEVEN DAYS, AND WHY THE CLIENT'S CEILING IS SIX ──────────────────
--
-- `expires_at` defaults to `now() + interval '7 days'`, and the DEFAULT is the
-- single place the number is written on this side.
--
-- Seven days is chosen against the offline queue, not against a convention.
-- Pahchan retires an unsent punch at 72 hours because a punch is payroll-time-
-- sensitive; a queued create is not, and a phone that spends a long weekend
-- without a usable network is an ordinary event on Indian mobile data. Seven
-- days covers that with room. Beyond it, "this is still the same intent" stops
-- being true — a task somebody meant to create last week is a decision they
-- should get to make again.
--
-- AFTER EXPIRY THERE IS NO PROTECTION. A row that is gone cannot recognise a
-- replay, so a very late retry re-executes and creates a duplicate. That is
-- the honest limit of any TTL'd store, and the client closes it rather than
-- the server: `mutationQueue.ts` refuses to DISPATCH a queued POST older than
-- SIX days and fails it loudly to the user instead. The 24-hour margin is the
-- point — it means there is no window in which the client believes it is
-- protected and the server has already forgotten the key, including for a
-- request that spends minutes in transit on a bad link.
--
-- If either number moves, BOTH move, in one commit: this DEFAULT and
-- `CREATE_MAX_AGE_MS` in `mobile/src/offline/mutationQueue.ts`. They name each
-- other in both directions.
--
-- ── WHAT THIS TABLE DELIBERATELY DOES NOT DO ─────────────────────────────────
--
--  * NO ORG INDEX. `(org_id, created_at)` would answer "which devices are
--    double-posting", which nobody has asked. Every index is a tax on the
--    insert path of every keyed request, and this file pays for two: the
--    primary key, which is the lookup, and `expires_at`, which is the pruner.
--  * NO RESPONSE HEADERS. Only status and body are stored. Replaying a
--    `Set-Cookie` or a rate-limit header from last Tuesday would be worse than
--    omitting it.
--  * NO CROSS-DEVICE DEDUPLICATION. Two phones signed in as the same user
--    generating two different keys for the same intent produce two creates.
--    That is a different feature (content-based dedup) and it needs a product
--    decision about what "the same intent" means, not a schema.
--  * NO REQUEST BODY. The request is fingerprinted, never stored. A create can
--    carry a client's name, an amount, a phone number; keeping it here would
--    duplicate customer data into a cache with no retention argument of its
--    own. The hash answers the only question this table asks of it.
--  * NO GET. `method` refuses it. A GET needs no idempotency key and a GET
--    with one is a caller misunderstanding the mechanism.
--
-- ── WHAT THE SERVER STILL OWES (NOT IN THIS FILE) ────────────────────────────
--
-- This migration is a store. Nothing reads or writes it. The endpoint contract
-- a backend engineer must implement is written out in full in the report that
-- accompanies this file; the four load-bearing sentences are:
--
--   1. Header is `Idempotency-Key`. Absent → behave exactly as today.
--   2. Scope is `(user_id, key)`. Never org, never global.
--   3. A replay returns the STORED status and body byte-for-byte, plus the
--      response header `Idempotent-Replay: true`. It does not re-run anything.
--   4. A 5xx deletes the row. A 4xx is stored. A body change under a live key
--      is 422.
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DROP FUNCTION IF EXISTS staging.prune_idempotency_keys(int);
--   DROP TABLE    IF EXISTS staging.idempotency_keys;      -- takes its indexes
--
-- Safe on any day, including a busy one. This table is a cache and is a system
-- of record for nothing: dropping it loses replay protection for whatever keys
-- are live at that moment and nothing else. No other object references it —
-- there is no FK pointing at it and no view over it. Nothing needs exporting
-- first, which is the difference between this file and 185.
--
-- Reverse the CLIENT first if the two are being unwound together, or ship the
-- client's header anyway: an ignored header is a no-op.
--
-- ── HOW TO APPLY ─────────────────────────────────────────────────────────────
--
--   railway run -e staging -s Kartavya -- psql "$DATABASE_URL" -f \
--       backend/migrations/186_idempotency.sql
--
-- Read section 6's NOTICEs. If the transaction rolls back, the RAISE says
-- which claim failed; nothing is left half-applied because everything is in
-- one transaction.
--
-- Measured environment, 2026-08-21: PostgreSQL 17.6, reached through the
-- Supabase pooler at aws-1-ap-southeast-1 (PgBouncer, port 6543).

BEGIN;

-- SET LOCAL is scoped to a transaction; outside one PostgreSQL warns and
-- ignores it. Nothing here queues behind anything today, but the cap is set so
-- that a later edit to this file inherits it rather than having to remember.
SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · The `staging` schema exists.
--
-- Cheap, and it turns the confusing failure into the true one. Every table in
-- this product lives in `staging` or `public`; if `staging` is missing, this
-- database is not the one this file was written against and every statement
-- below would fail with a message about a relation rather than a schema.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'staging') THEN
        RAISE EXCEPTION
            'GUARD 1: schema "staging" does not exist. This is not the '
            'Kartavaya database.';
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 2 · If the table is already here, it is OURS and it is the right shape.
--
-- `CREATE TABLE IF NOT EXISTS` would accept a pre-existing table of any shape
-- and do nothing, and the constraint block below would then bolt eleven CHECKs
-- onto somebody else's columns — or fail obscurely on a column that is not
-- there. Worse, a `user_id` of the wrong type (uuid, say) would make every
-- lookup miss silently and the mechanism would appear to work while protecting
-- nothing: every create would be treated as new.
--
-- Measured 2026-08-21: no relation in `staging` or `public` matches
-- '%idempot%' except the index `uq_org_credit_tx_idempotency`. On the measured
-- database this guard is a no-op and exists for the re-run.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard2$
DECLARE
    t_user text;
    t_key  text;
    t_org  text;
BEGIN
    IF to_regclass('staging.idempotency_keys') IS NULL THEN
        RETURN;                     -- first run: nothing to check
    END IF;

    SELECT data_type INTO t_user FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='idempotency_keys'
       AND column_name='user_id';
    SELECT data_type INTO t_key  FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='idempotency_keys'
       AND column_name='idempotency_key';
    SELECT data_type INTO t_org  FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='idempotency_keys'
       AND column_name='org_id';

    IF t_user IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION
            'GUARD 2: staging.idempotency_keys.user_id is %, expected text. '
            'public.users.user_id is text (user_xxxxxxxx); a uuid column here '
            'would miss every lookup silently and protect nothing.',
            COALESCE(t_user, '(absent)');
    END IF;
    IF t_key IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION
            'GUARD 2: staging.idempotency_keys.idempotency_key is %, expected '
            'text. The key is opaque to the server and must not be typed.',
            COALESCE(t_key, '(absent)');
    END IF;
    IF t_org IS DISTINCT FROM 'uuid' THEN
        RAISE EXCEPTION
            'GUARD 2: staging.idempotency_keys.org_id is %, expected uuid. '
            'All 228 org_id columns in staging are uuid.',
            COALESCE(t_org, '(absent)');
    END IF;
END
$guard2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 3 · Nothing else already owns the function name.
--
-- Section 5 uses CREATE OR REPLACE, which would silently overwrite a function
-- of the same name and argument list belonging to somebody else. If one exists
-- with a DIFFERENT signature, that is not ours and the file stops rather than
-- guessing.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard3$
DECLARE sig text;
BEGIN
    SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
      INTO sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'staging' AND p.proname = 'prune_idempotency_keys';

    IF sig IS NOT NULL AND sig <> 'p_limit integer' THEN
        RAISE EXCEPTION
            'GUARD 3: staging.prune_idempotency_keys already exists with '
            'signature(s) [%], not (p_limit integer). Refusing to replace a '
            'function this file did not write.', sig;
    END IF;
END
$guard3$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · The table. One row per (principal, key).
--
-- COLUMNS AND THE PRIMARY KEY ONLY. Every CHECK is added separately in
-- section 2 — see THE INLINE TRAP in the header.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staging.idempotency_keys (
    -- public.users.user_id — TEXT, `user_549c9cac35aa`. The authenticated
    -- principal, and half the primary key, so a lookup can only ever find the
    -- caller's own row. See routers/pahchan.py:511 for what the alternative
    -- cost last time.
    user_id             text        NOT NULL,

    -- Client-generated and OPAQUE. The server never parses it, never derives
    -- meaning from it and never generates one. A UUIDv4 is what the mobile
    -- client sends; the CHECK bounds length and refuses whitespace and does
    -- not require a UUID, because a future web client may reasonably use
    -- something else.
    idempotency_key     text        NOT NULL,

    -- Recorded, never keyed. Many routes resolve no org (233 in core PM), so
    -- this is nullable BY DESIGN and its absence is not a defect.
    org_id              uuid,

    -- What was asked for. Stored for the support question "what did this key
    -- do", and to make a key reused across two different endpoints legible in
    -- the 422 that refuses it.
    method              text        NOT NULL,
    path                text        NOT NULL,

    -- sha256 hex of METHOD || '\n' || PATH || '\n' || RAW BODY BYTES.
    -- Computed by the server on both attempts; the client never computes it.
    request_fingerprint text        NOT NULL,

    -- 'in_flight' | 'completed'. There is no 'failed' — see the header.
    state               text        NOT NULL DEFAULT 'in_flight',

    -- The stored outcome. NULL while in flight. A 5xx is NEVER stored: the row
    -- is deleted instead so the retry genuinely re-runs.
    response_status     smallint,
    response_body       jsonb,

    -- The id of the thing that got created, for support and for reading this
    -- table by eye. It is NOT the replay mechanism — a replay returns the
    -- stored body, never a re-derivation from this column, because re-deriving
    -- would re-read a record that may have changed since.
    resource_id         text,

    created_at          timestamptz NOT NULL DEFAULT NOW(),
    completed_at        timestamptz,

    -- SEVEN DAYS. This DEFAULT is the only place the server-side number is
    -- written. Its counterpart is CREATE_MAX_AGE_MS in
    -- mobile/src/offline/mutationQueue.ts, which is SIX days on purpose.
    expires_at          timestamptz NOT NULL DEFAULT (NOW() + interval '7 days'),

    -- The principal is IN the key. This is the whole cross-tenant argument:
    -- not a predicate somebody has to remember to write, but a shape in which
    -- another user's row cannot be reached.
    CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, idempotency_key)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The constraints — separate statements, guarded, NEVER inline.
--
-- Each is added only if a constraint of that name is absent, so a re-run
-- against a table created by an earlier partial apply repairs it instead of
-- leaving it silently unconstrained. Section 6 reads every one of these names
-- back out of pg_constraint.
-- ═══════════════════════════════════════════════════════════════════════════
DO $constraints$
DECLARE
    have int;
BEGIN
    -- ── the key itself ──────────────────────────────────────────────────────
    -- 16 is a floor, not a format: a four-character key is guessable, and a
    -- guessable key in a user-scoped store still lets a buggy client collide
    -- with itself across two unrelated creates. 128 bounds the index. No
    -- whitespace, because a key that differs from another only by a trailing
    -- newline is two keys that look like one in every log and every ticket.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_key_shape_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_key_shape_ck
            CHECK (length(idempotency_key) BETWEEN 16 AND 128
                   AND idempotency_key !~ '\s');
    END IF;

    -- An empty principal would put every anonymous caller in one bucket and
    -- let them replay each other's responses. There is no anonymous caller on
    -- these routes, and this makes that true of the table as well as of the
    -- middleware.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_user_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_user_ck
            CHECK (length(btrim(user_id)) > 0);
    END IF;

    -- ── what was asked ──────────────────────────────────────────────────────
    -- GET is absent deliberately. A GET needs no key; one arriving with a key
    -- is a caller who has misunderstood the mechanism, and storing it would
    -- mean a cached GET nobody designed.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_method_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_method_ck
            CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE'));
    END IF;

    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_path_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_path_ck
            CHECK (path LIKE '/%' AND length(path) BETWEEN 1 AND 512);
    END IF;

    -- Lowercase hex, exactly 64 characters. Refusing uppercase is not fussiness:
    -- two implementations disagreeing on case would compare unequal for
    -- identical bytes and 422 every legitimate retry.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_fingerprint_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_fingerprint_ck
            CHECK (request_fingerprint ~ '^[0-9a-f]{64}$');
    END IF;

    -- ── the state machine ───────────────────────────────────────────────────
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_state_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_state_ck
            CHECK (state IN ('in_flight', 'completed'));
    END IF;

    -- THE ONE THAT MATTERS MOST. A row marked 'completed' with no status is a
    -- replay that returns 200 and an empty body — the app shows a success for
    -- something that may never have happened. And an 'in_flight' row that
    -- already carries a response is a half-written record that the lease will
    -- later hand to a second executor. Both are refused at write time rather
    -- than discovered on a support call.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_completion_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_completion_ck
            CHECK (
                (state = 'in_flight'
                 AND response_status IS NULL
                 AND response_body   IS NULL
                 AND completed_at    IS NULL)
             OR (state = 'completed'
                 AND response_status IS NOT NULL
                 AND completed_at    IS NOT NULL)
            );
    END IF;

    -- NO CACHED 5xx. 100-499 only.
    --
    -- Storing a 500 would make one bad minute permanent: every retry for the
    -- next seven days would replay the 500 without ever reaching the handler,
    -- and the create the user is waiting for would never happen — while the
    -- client, seeing a 5xx, would keep retrying until it exhausted its three
    -- attempts and gave up. The correct handling of a 5xx is to DELETE the
    -- row. This CHECK is what stops a plausible implementation ("just record
    -- whatever came back") from getting that wrong quietly.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_no_cached_5xx_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_no_cached_5xx_ck
            CHECK (response_status IS NULL
                   OR (response_status >= 100 AND response_status <= 499));
    END IF;

    -- ── size and sanity ─────────────────────────────────────────────────────
    -- 64 KiB. Written as octet_length(response_body::text) because that is
    -- IMMUTABLE and therefore legal in a CHECK: jsonb_out is marked 'i'
    -- (measured 2026-08-21). The obvious alternative, pg_column_size, is
    -- marked 's' — STABLE — and PostgreSQL refuses it here.
    --
    -- Responses on these routes are small JSON objects; anything at this size
    -- is a list endpoint that should never have been keyed. Refusing it keeps
    -- a cache from becoming a document store.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_body_size_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_body_size_ck
            CHECK (response_body IS NULL
                   OR octet_length(response_body::text) <= 65536);
    END IF;

    -- A row that expires before it is created is a clock or a caller that
    -- cannot be trusted, and it would be pruned instantly — silently removing
    -- the protection the caller thinks it has.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_window_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_window_ck
            CHECK (expires_at > created_at);
    END IF;

    -- '' and NULL would both mean "nothing was created" while
    -- count(resource_id) counted only one of them. 184 §2 refuses the empty
    -- string on salesperson_id for exactly this reason.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='idempotency_keys'
       AND con.conname='idempotency_keys_resource_ck';
    IF have = 0 THEN
        ALTER TABLE staging.idempotency_keys
            ADD CONSTRAINT idempotency_keys_resource_ck
            CHECK (resource_id IS NULL OR length(btrim(resource_id)) > 0);
    END IF;
END
$constraints$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · The one index that is not the primary key.
--
-- The primary key (user_id, idempotency_key) IS the lookup — every read of
-- this table is "have I seen this key from this principal", and there is no
-- second access pattern in the design.
--
-- This one serves the pruner, and only the pruner. Rows are inserted in
-- expires_at order (expires_at is created_at plus a constant), so the deletion
-- always works the leading edge and a plain btree gives it an ordered scan for
-- `WHERE expires_at < now() … LIMIT n`. BRIN would be smaller and would also
-- work; btree is chosen because the LIMIT wants order, not just a range.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idempotency_keys_expiry_idx
    ON staging.idempotency_keys (expires_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · The documentation that lives in the database.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE staging.idempotency_keys IS
    'Request-level idempotency for retryable writes, keyed on (user_id, '
    'idempotency_key) so a lookup can only ever find the caller''s own row. A '
    'SEVEN-DAY CACHE and a system of record for nothing — safe to drop, holds '
    'no request body, and is not evidence of anything. Written and read by the '
    'endpoint layer only; the mobile offline queue '
    '(mobile/src/offline/mutationQueue.ts) is the client that sends the '
    'Idempotency-Key header. Two states: in_flight (with a 60-second lease off '
    'created_at) and completed. A 5xx DELETES the row; a 4xx is stored.';

COMMENT ON COLUMN staging.idempotency_keys.user_id IS
    'public.users.user_id — TEXT (user_xxxxxxxx), never uuid. Half the primary '
    'key: cross-principal replay is a shape this table cannot express, not a '
    'predicate somebody has to remember. See routers/pahchan.py:511.';

COMMENT ON COLUMN staging.idempotency_keys.idempotency_key IS
    'Client-generated and OPAQUE. The server never parses it and never mints '
    'one. 16-128 characters, no whitespace. The mobile client sends a UUIDv4 '
    'generated once at enqueue and never regenerated on retry.';

COMMENT ON COLUMN staging.idempotency_keys.org_id IS
    'Recorded, NEVER keyed, and NULLABLE by design — 233 core PM routes '
    'resolve no org at all. Adding it to the key would let one user replay the '
    'same key once per org, which is a duplicate create dressed as scoping.';

COMMENT ON COLUMN staging.idempotency_keys.request_fingerprint IS
    'sha256 hex of METHOD || newline || PATH || newline || RAW BODY BYTES, as '
    'received off the wire — never a re-serialisation of a parsed model, which '
    'would differ between two attempts that sent identical bytes. Computed by '
    'the server on both attempts; the client never computes it. A mismatch '
    'under a live key is 422, NOT 409 — 409 means "in flight, retry", and a '
    'client that confuses them retries something that can never succeed.';

COMMENT ON COLUMN staging.idempotency_keys.state IS
    'in_flight | completed. There is no failed state: a 4xx IS a completed '
    'outcome and replaying it is correct, while a 5xx deletes the row so the '
    'retry genuinely re-runs. An in_flight row older than 60 seconds is '
    'ABANDONED and may be taken over — without that lease, one killed process '
    'makes a key unusable for seven days.';

COMMENT ON COLUMN staging.idempotency_keys.response_status IS
    'The stored outcome, 100-499. A 5xx is REFUSED by CHECK: caching one would '
    'make a transient outage permanent for the life of the key, replaying the '
    'failure without ever reaching the handler.';

COMMENT ON COLUMN staging.idempotency_keys.response_body IS
    'Returned to a replay BYTE-FOR-BYTE alongside the header '
    'Idempotent-Replay: true. Capped at 64 KiB. No response headers are '
    'stored — replaying a Set-Cookie or a rate-limit header from last week '
    'would be worse than omitting it.';

COMMENT ON COLUMN staging.idempotency_keys.resource_id IS
    'What got created, for support and for reading this table by eye. NOT the '
    'replay mechanism: a replay returns the stored body, never a re-derivation '
    'from this id, because the record may have changed since.';

COMMENT ON COLUMN staging.idempotency_keys.expires_at IS
    'SEVEN DAYS from creation; this DEFAULT is the only place the server''s '
    'number is written. Its counterpart is CREATE_MAX_AGE_MS in '
    'mobile/src/offline/mutationQueue.ts, which is SIX days — the 24-hour '
    'margin means there is no window in which the client believes it is '
    'protected and the server has already forgotten the key. If either moves, '
    'both move, in one commit.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · The pruner. CALLED BY NOTHING.
--
-- Say it plainly: applying this migration does not schedule anything. This
-- function exists so that wiring the prune is one line rather than a design
-- decision made in a hurry, and section 6 raises a NOTICE saying it is inert.
--
-- WHY NOT ADD IT TO staging.cleanup_old_data(). That function EXISTS (measured
-- 2026-08-21, returns TABLE(table_name text, rows_deleted bigint)) and the
-- retention cron calls it daily via routers/scheduler.py. But it is defined in
-- NO migration in this repository — migration 098 records the same finding —
-- so its body is not in version control and this file cannot CREATE OR REPLACE
-- it without either guessing the body or destroying the parts it cannot see.
-- Editing a function you cannot read is how a retention job silently stops
-- pruning six other tables. So: a separate function, and a stated debt.
--
-- BATCHED ON PURPOSE. An unbounded `DELETE … WHERE expires_at < now()` on a
-- table with a week of write-path traffic takes one long lock and one long
-- transaction against a database production shares. This deletes at most
-- p_limit rows and returns how many, so the caller loops until it returns 0
-- and each iteration is short.
--
-- WHAT IT DELETES: expired cache entries, and nothing else. It cannot reach
-- any other table. A row it removes is one whose protection had already
-- lapsed — see EXPIRY in the header.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION staging.prune_idempotency_keys(p_limit int DEFAULT 5000)
RETURNS bigint
LANGUAGE plpgsql
AS $prune$
DECLARE
    n bigint;
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN
        RAISE EXCEPTION 'prune_idempotency_keys: p_limit must be positive, got %',
                        p_limit;
    END IF;

    WITH doomed AS (
        SELECT user_id, idempotency_key
          FROM staging.idempotency_keys
         WHERE expires_at < NOW()
         ORDER BY expires_at
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED       -- never block a live request
    )
    DELETE FROM staging.idempotency_keys k
     USING doomed d
     WHERE k.user_id = d.user_id
       AND k.idempotency_key = d.idempotency_key;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END
$prune$;

COMMENT ON FUNCTION staging.prune_idempotency_keys(int) IS
    'Deletes at most p_limit EXPIRED idempotency keys and returns how many. '
    'Call it in a loop until it returns 0. CALLED BY NOTHING as at migration '
    '186 — wiring it is one line in the retention cron. Deliberately NOT '
    'folded into staging.cleanup_old_data(), whose body is in no migration in '
    'this repository and therefore cannot be replaced without guessing it.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · PROVE IT, IN THE SAME TRANSACTION.
--
-- This file's claims are: a table exists, with these eleven CHECKs and this
-- primary key, plus one index and one function, holding NO ROWS. The last is
-- the one worth rolling back for — a seeded row in this table is a REPLAY
-- WAITING TO HAPPEN. It would make a real create that happens to present that
-- key return a fabricated response without ever running, and the user would be
-- shown a success for something that never occurred.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_rows   bigint;
    n_checks int;
    n_idx    int;
    n_fn     int;
    pk_def   text;
BEGIN
    -- VERIFY 1 — the table is EMPTY. Nothing was seeded.
    SELECT count(*) INTO n_rows FROM staging.idempotency_keys;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 1: this migration seeds NOTHING, yet the table holds % '
            'row(s). Either it has been applied before and the endpoint layer '
            'is live (in which case this run is a no-op and the rows are real '
            'in-flight keys — re-check before forcing), or something in this '
            'transaction wrote a key. A fabricated key is a replay waiting to '
            'happen. Rolling back.', n_rows;
    END IF;

    -- VERIFY 2 — every CHECK landed. Read from pg_constraint BY NAME, never
    -- assumed from the DDL: both CREATE TABLE IF NOT EXISTS and ADD COLUMN IF
    -- NOT EXISTS silently skip inline constraints when their target already
    -- exists, and pg_constraint is the only truth.
    SELECT count(*) INTO n_checks
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND c.relname = 'idempotency_keys'
       AND con.contype = 'c'
       AND con.conname IN ('idempotency_keys_key_shape_ck',
                           'idempotency_keys_user_ck',
                           'idempotency_keys_method_ck',
                           'idempotency_keys_path_ck',
                           'idempotency_keys_fingerprint_ck',
                           'idempotency_keys_state_ck',
                           'idempotency_keys_completion_ck',
                           'idempotency_keys_no_cached_5xx_ck',
                           'idempotency_keys_body_size_ck',
                           'idempotency_keys_window_ck',
                           'idempotency_keys_resource_ck');
    IF n_checks <> 11 THEN
        RAISE EXCEPTION
            'VERIFY 2: expected 11 CHECK constraints on '
            'staging.idempotency_keys, found %. An inline constraint was '
            'silently skipped, or a name in section 2 does not match a name '
            'here.', n_checks;
    END IF;

    -- VERIFY 3 — the primary key is EXACTLY (user_id, idempotency_key), in
    -- that order. This is the cross-principal guarantee. A primary key of
    -- (idempotency_key) alone would let one user's key collide with another's
    -- and hand back somebody else's response body; a key with org_id in it
    -- would let one user replay once per org.
    SELECT pg_get_constraintdef(con.oid) INTO pk_def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND c.relname = 'idempotency_keys'
       AND con.contype = 'p';
    IF pk_def IS DISTINCT FROM 'PRIMARY KEY (user_id, idempotency_key)' THEN
        RAISE EXCEPTION
            'VERIFY 3: primary key is [%], expected PRIMARY KEY (user_id, '
            'idempotency_key). The principal must be IN the key — that is the '
            'only thing making a cross-principal replay unreachable.',
            COALESCE(pk_def, '(none)');
    END IF;

    -- VERIFY 4 — the pruner's index exists. Without it the prune degrades to a
    -- sequential scan on the busiest small table in the product, which is the
    -- kind of thing that looks fine for a month.
    SELECT count(*) INTO n_idx
      FROM pg_indexes
     WHERE schemaname = 'staging'
       AND indexname = 'idempotency_keys_expiry_idx';
    IF n_idx <> 1 THEN
        RAISE EXCEPTION 'VERIFY 4: expected idempotency_keys_expiry_idx, found %.',
                        n_idx;
    END IF;

    -- VERIFY 5 — the pruner exists with the signature GUARD 3 allowed.
    SELECT count(*) INTO n_fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'staging'
       AND p.proname = 'prune_idempotency_keys'
       AND pg_get_function_identity_arguments(p.oid) = 'p_limit integer'
       AND pg_get_function_result(p.oid) = 'bigint';
    IF n_fn <> 1 THEN
        RAISE EXCEPTION
            'VERIFY 5: staging.prune_idempotency_keys(p_limit integer) '
            'RETURNS bigint not found (matched %).', n_fn;
    END IF;

    RAISE NOTICE '186 · staging.idempotency_keys created, 0 rows.';
    RAISE NOTICE '    11 CHECKs, PK (user_id, idempotency_key), 1 index.';
    RAISE NOTICE '    NOTHING HONOURS THE HEADER YET. Every endpoint in '
                 'backend/routers/ ignores Idempotency-Key, so this table '
                 'stays empty and a retried POST still makes a second row. '
                 'The store is the easy half.';
    RAISE NOTICE '    staging.prune_idempotency_keys(int) is CALLED BY '
                 'NOTHING. Until it is wired, this table only grows.';
    RAISE NOTICE '    Server TTL is 7 days (expires_at DEFAULT). The client '
                 'ceiling is 6 days (CREATE_MAX_AGE_MS in '
                 'mobile/src/offline/mutationQueue.ts). Move one, move both.';
END
$verify$;

COMMIT;
