-- ============================================================================
-- PROPOSED_067_account_self_service.sql
--
-- NOT APPLIED. Staging and production share one Supabase project, so nothing
-- here has been run. Review, then apply in a window where a rollback is
-- acceptable.
--
-- Two independent parts. Part A is additive and safe. Part B is NOT safe to
-- apply on its own and is deliberately left commented out.
--
--   Part A — staging.account_requests. Backs POST /api/v1/me/export,
--            POST /api/v1/me/delete and DELETE /api/v1/me/delete. New table
--            only; touches no existing object. Until it exists those three
--            endpoints return 503 with an explicit "your request was NOT
--            recorded" message rather than a generic 500.
--
--   Part B — staging.user_sessions. The schema half of real session
--            revocation. Applying it changes NOTHING by itself and MUST NOT be
--            applied before the auth_router.py changes described below, or it
--            becomes an empty table that looks like a security feature.
--
-- RISK SUMMARY
--   Part A:  LOW.  CREATE TABLE IF NOT EXISTS + three indexes. No writes to
--                  existing rows, no locks on existing tables, no FK onto a
--                  hot table beyond users(user_id), which is already the FK
--                  target for push_tokens and notification_prefs.
--   Part B:  HIGH. Adds a per-request database read to every authenticated
--                  call in the system. See the note above Part B.
--
-- SIDE EFFECTS ON THE SHARED DATABASE
--   Part A creates one table visible to BOTH staging and production, because
--   they are the same database. A staging deployment writing test deletion
--   requests puts rows in the same table production reads. Rows carry no
--   environment marker — if that matters, add one before applying, do not
--   discover it later.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — account_requests
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.account_requests (
    request_id    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

    -- 'export' | 'delete'. Constrained rather than free text: this table is
    -- read by an operator deciding whether to erase somebody's account, and a
    -- typo'd kind is a request that silently never gets actioned.
    kind          TEXT NOT NULL CHECK (kind IN ('export', 'delete')),

    -- pending    → requested, not yet touched
    -- processing → an operator has begun; no longer cancellable by the user
    -- completed  → fulfilled
    -- cancelled  → withdrawn by the user during the grace period
    -- failed     → attempted and did not complete; needs a human
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','cancelled','failed')),

    requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Deletion only: the earliest moment this request may be acted on.
    -- The grace period is the safety feature, so it lives in the row rather
    -- than only in application code — a future worker reads THIS, and cannot
    -- act early by forgetting to add the interval itself.
    scheduled_for TIMESTAMPTZ,

    cancelled_at  TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,

    -- Free text from the user. Nullable, never required: making someone
    -- justify leaving is a dark pattern.
    reason        TEXT,

    -- For the operator: what was actually done, or why it failed.
    notes         TEXT,

    -- A deletion request must never be acted on before its grace period.
    -- Enforced here as well as in the application because a worker written
    -- later will not have read the endpoint.
    CONSTRAINT account_requests_delete_has_schedule
        CHECK (kind <> 'delete' OR scheduled_for IS NOT NULL)
);

-- At most ONE open request per user per kind. Without this, a double-clicked
-- button leaves two pending deletion rows and cancelling clears one of them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_requests_one_open
    ON staging.account_requests (user_id, kind)
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_account_requests_user
    ON staging.account_requests (user_id, requested_at DESC);

-- The queue view an operator or worker scans.
CREATE INDEX IF NOT EXISTS idx_account_requests_due
    ON staging.account_requests (kind, status, scheduled_for)
    WHERE status = 'pending';

COMMENT ON TABLE staging.account_requests IS
    'Self-service export and account-deletion requests. A request is a record of '
    'intent, never an action: nothing in this table deletes anything. Deletion '
    'requires an operator or a worker to act after scheduled_for has passed.';


-- ROLLBACK — Part A
-- Destroys any pending requests. Copy the table first if real users have
-- already submitted; a dropped deletion request is a promise silently broken.
--
--   -- CREATE TABLE staging.account_requests_backup_067 AS
--   --     SELECT * FROM staging.account_requests;
--   DROP INDEX IF EXISTS staging.idx_account_requests_due;
--   DROP INDEX IF EXISTS staging.idx_account_requests_user;
--   DROP INDEX IF EXISTS staging.idx_account_requests_one_open;
--   DROP TABLE IF EXISTS staging.account_requests;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — user_sessions.  DO NOT APPLY YET.
--
-- This is the schema for the thing GET /api/v1/me/sessions currently reports it
-- CANNOT do. Schema alone does not deliver it, and applying this table on its
-- own is worse than not having it: an empty user_sessions table reads, to the
-- next person, like session tracking that works.
--
-- Three code changes must land in the SAME deploy. All are in auth_router.py,
-- which is owned by another agent, which is why this is a proposal:
--
--   1. _create_token() — add a `jti`, insert the session row:
--        jti = uuid4().hex
--        payload = {"sub": user_id, "jti": jti, "exp": ..., "iat": ...}
--        INSERT INTO staging.user_sessions (jti, user_id, expires_at, ...)
--
--   2. _decode_token() / require_user() — reject a revoked jti:
--        SELECT 1 FROM staging.user_sessions
--         WHERE jti=$1 AND revoked_at IS NULL AND expires_at > NOW()
--      A token whose jti is absent must be treated as VALID until every
--      pre-existing token has expired (7 days), or this deploy signs out every
--      user at once. Gate on `iat > <deploy timestamp>` and remove the
--      exception a week later.
--
--   3. Revocation call sites: logout, password reset (which today mints a new
--      token and leaves every other one working), and a new
--      POST /api/v1/me/sessions/revoke.
--
-- COST, stated plainly: step 2 adds a database round-trip to EVERY
-- authenticated request. require_user already caches the user on request.state
-- for the request's lifetime, so it is one extra read per request, not per
-- dependency — but it is still a new hard dependency of all authentication on
-- this table's availability. Budget for a cache with a short TTL, and decide
-- whether an unavailable session store fails open or closed BEFORE shipping.
-- ─────────────────────────────────────────────────────────────────────────────

-- CREATE TABLE IF NOT EXISTS staging.user_sessions (
--     jti          TEXT PRIMARY KEY,
--     user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
--     issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     expires_at   TIMESTAMPTZ NOT NULL,
--     revoked_at   TIMESTAMPTZ,
--     -- Set when revocation was not the user's own doing, so the UI can say
--     -- "ended by a password change" instead of leaving them to guess.
--     revoked_by   TEXT,
--     revoked_cause TEXT CHECK (revoked_cause IN
--                    ('user_logout','user_revoked','password_reset','admin','expired')),
--     user_agent   TEXT,
--     ip           INET,
--     last_seen_at TIMESTAMPTZ
-- );
--
-- CREATE INDEX IF NOT EXISTS idx_user_sessions_user
--     ON staging.user_sessions (user_id, revoked_at, expires_at DESC);
--
-- -- The hot path: one lookup per authenticated request.
-- CREATE INDEX IF NOT EXISTS idx_user_sessions_live
--     ON staging.user_sessions (jti) WHERE revoked_at IS NULL;
--
-- COMMENT ON TABLE staging.user_sessions IS
--     'Live JWT registry keyed by jti. Required for session listing and '
--     'revocation; without the auth_router.py changes it does nothing.';
--
-- ROLLBACK — Part B
--   Revert the auth_router.py changes FIRST. Dropping this table while
--   require_user still reads it locks every user out of the product.
--   DROP INDEX IF EXISTS staging.idx_user_sessions_live;
--   DROP INDEX IF EXISTS staging.idx_user_sessions_user;
--   DROP TABLE IF EXISTS staging.user_sessions;
