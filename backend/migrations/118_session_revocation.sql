-- 118_session_revocation.sql
--
-- THE RESET EMAIL PROMISED A SIGN-OUT. THIS IS THE COLUMN THAT PERFORMS IT.
--
-- `email_service.send_password_reset_email` has always told the recipient
-- "Setting a new password signs out every other device." It did not.
-- `auth_router.reset_password` wrote the new hash, cleared the reset token,
-- minted a fresh JWT and revoked nothing — every token issued before the reset
-- kept working until its own 7-day expiry. A stolen token survived the password
-- change that was made BECAUSE it was stolen.
--
-- The promise is not only in the email, which is why it was made true rather
-- than deleted:
--   · design-reference/Kartavaya Redesign/AUTH-SPEC.md:134 lists the sign-out
--     side effect as a REQUIRED element of that template;
--   · design-reference/Kartavaya Redesign/Auth Emails.html:186 is the source;
--   · frontend/src/pages/LoginPage.jsx carried a comment saying the on-screen
--     sentence goes in when the revocation does;
--   · backend/routers/me.py had to be written to explain the absence to the
--     signed-in user in one screen while the email said the opposite in another.
-- Deleting the sentence would also leave a user who suspects compromise with no
-- lever at all: there is NO change-password endpoint anywhere in this product,
-- so the emailed reset is the only password path that exists.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change, exactly as 093–110 each say. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/118_session_revocation.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- ⚠ `users` IS IN `public`, NOT `staging`. `to_regclass('staging.users')` is
--   NULL — recorded independently in PROPOSED_065:257, routers/messaging.py:11
--   and routers/search.py:386. The application reaches it through
--   `SET search_path TO staging, public` (db.py:113). Qualified explicitly
--   below so this file does not depend on a session setting.
--
--
-- ── WHY A CUTOFF COLUMN AND NOT A SESSION TABLE ─────────────────────────────
--
-- PROPOSED_067 Part B (lines 116-181, commented out, never applied) proposes
-- `staging.user_sessions` keyed by a `jti` minted into every token. THESE TWO
-- FILES ARE ALTERNATIVES, NOT COMPLEMENTS. Applying both buys the `jti` table's
-- costs for no capability this column does not already provide. A note has been
-- added to the head of PROPOSED_067 pointing here.
--
-- Measured, not assumed. `auth_router.require_user` already performs exactly one
--   SELECT ... FROM users WHERE user_id=$1
-- on EVERY authenticated request. So:
--
--   jti table            cutoff column on users
--   ─────────            ──────────────────────
--   +1 DB round-trip     +0 round-trips — the column rides the primary-key read
--   per request          that already happens; it is +1 column on a single row
--
--   needs a 7-day        needs NO grace window. NULL means "never revoked",
--   `iat > deploy_ts`    which is every account on the day this is applied, so
--   grace exception or   applying it signs out NOBODY.
--   it signs out every
--   user at once
--
--   new table, new       one nullable column
--   writes, new
--   cleanup job
--
-- The stateless design also has a real strength that a session table would
-- tempt someone to trade away: the JWT carries NO roles. Org membership, role
-- revocation and org deactivation are all read per request from
-- `staging.user_roles` / `organisations`, so those already take effect on the
-- very next request without any token being revoked. Nothing here changes that
-- and nothing should.
--
--
-- ── SAFE TO APPLY EARLY. THE OPPOSITE OF PROPOSED_067 PART B. ───────────────
--
-- This column appears in production the moment it is applied. Until the
-- `auth_router.py` change ships, NOTHING READS IT and NOTHING WRITES IT — it is
-- inert, not dangerous. That is deliberate, and it fixes the deployment order:
--
--     APPLY THIS FILE FIRST, THEN DEPLOY THE BACKEND.
--
-- The reverse order is survivable but degraded. `auth_router` catches Postgres
-- 42703 (undefined_column) on the auth read, logs an error, and falls back to
-- the column list without it; revocation is then NOT in force and
-- `GET /api/v1/me/sessions` says so to the user rather than claiming a
-- capability that is not running. The fallback exists so that a wrong order is
-- a degraded security control instead of a total authentication outage — it is
-- not a licence to skip this file.
--
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One `ALTER TABLE ... ADD COLUMN`, nullable, NO DEFAULT: PostgreSQL 11+ takes
-- the catalog-only path — no table rewrite, no scan of `users`, microseconds of
-- work. It takes ACCESS EXCLUSIVE on `public.users` until COMMIT. The work is
-- trivial; the RISK IS ACQUISITION — it queues behind any open transaction on
-- `users` and, while queued, blocks every reader arriving after it. `users` is
-- read on essentially every authenticated request, so a long-running
-- transaction would turn this into a product-wide stall. `lock_timeout` below
-- makes that a clean rollback instead. Run it when the app is quiet.
--
-- No index is created. Nothing queries users BY this column; it is only ever
-- read for a row already being fetched by primary key.
--
--
-- ── THE VALUE IS WRITTEN BY THE APPLICATION, NOT BY `NOW()` ─────────────────
--
-- `auth_router.reset_password` sets this from `datetime.now(timezone.utc)`
-- truncated to whole seconds, and NOT from a database `NOW()`. That looks
-- backwards for a timestamp column, so the reason is recorded here as well as
-- in the code, because "fixing" it to `NOW()` would reintroduce a real bug.
--
-- This value is only ever compared against a JWT `iat`, and an `iat` is
-- unavoidably written by the application process. Sourcing the cutoff from the
-- database makes the correctness of every session depend on app-vs-database
-- clock agreement, which nothing else in this product requires:
--
--   · database BEHIND the app — the cutoff is older than it should be and
--     tokens issued in the gap survive a reset that was meant to kill them;
--   · database AHEAD of the app — the replacement token gets a FUTURE `iat`,
--     and PyJWT raises `ImmatureSignatureError` on it. The reset then returns a
--     token that cannot be decoded at all, and the user who correctly reset
--     their password is locked out until the app clock catches up. This was
--     measured, not theorised — see
--     `test_the_cutoff_is_never_in_the_future`.
--
-- One clock for both values removes the whole class.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1. The column ───────────────────────────────────────────────────────────
--
-- NULL = this account has never had its sessions revoked. That is every account
-- today, and it is why applying this file signs nobody out.
--
-- TIMESTAMPTZ, not TIMESTAMP: it is compared against a JWT `iat`, which is
-- seconds since the Unix epoch in UTC. A naive timestamp here would compare
-- against whatever the session's TimeZone happened to be and the error would be
-- silent and hours wide.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;

COMMENT ON COLUMN public.users.sessions_valid_from IS
  'Session revocation cutoff. Any JWT whose `iat` is strictly before this is '
  'rejected by auth_router.require_user. NULL = never revoked. Written ONLY by '
  'auth_router.reset_password, from the APPLICATION clock truncated to whole '
  'seconds — deliberately not NOW(). See 118_session_revocation.sql.';

COMMIT;


-- ── VERIFY ──────────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='users'
--      AND column_name='sessions_valid_from';
--   -- expect: sessions_valid_from | timestamp with time zone | YES | (null)
--
--   SELECT count(*) FROM public.users WHERE sessions_valid_from IS NOT NULL;
--   -- expect 0 immediately after applying. Anything else means this file was
--   -- applied twice against a database where resets have since happened, which
--   -- is harmless — ADD COLUMN IF NOT EXISTS will not clear existing values.
--
-- After deploying the backend, the end-to-end check WITHOUT writing anything of
-- consequence: reset a throwaway account's password, then reuse a token issued
-- to it beforehand. Expect 401 with detail
--   "Signed out — the password on this account was changed."
-- and expect the token the reset itself returned to keep working. The second
-- half is the one that matters: getting it wrong locks out the person who just
-- reset their password. See `auth_router.reset_password` and
-- `backend/tests/test_session_revocation.py::test_token_minted_by_reset_is_accepted`.


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   ALTER TABLE public.users DROP COLUMN IF EXISTS sessions_valid_from;
-- COMMIT;
--
-- Rolling back AFTER the code has shipped LOCKS NOBODY OUT: the code treats a
-- missing column as "revocation not available" (42703 → fallback) and a NULL
-- value as "never revoked". Both are valid. What it does do is silently
-- un-revoke every account that had been revoked — anyone who reset a password
-- to end a stolen session would have that session work again. Prefer
--     UPDATE public.users SET sessions_valid_from = NULL;
-- if the goal is to undo a bad cutoff rather than to remove the feature.
