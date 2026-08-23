-- 208_user_totp.sql
-- Two-factor authentication (workstream L): the enrolment store.
--
-- Named `staging.user_totp` on purpose — it is the first of the two names
-- `routers/org_security.py::TOTP_TABLES` already probes for (see that
-- file's module docstring and PROPOSED_069's "TWO NOTES" section). Landing
-- it under this exact name means the lockout-count safety check on
-- PATCH /v1/org/security's `tfa_enforced` switch starts working with ZERO
-- code change to that router, which is why the name was chosen for us.
--
-- ── WHY A ROW ONLY EVER MEANS "CONFIRMED" ──────────────────────────────────
-- org_security.py counts enrolment as `COUNT(DISTINCT user_id) FROM
-- staging.user_totp` with no status filter. For that count to mean what it
-- claims — "this many members have a working authenticator" — a row must
-- never exist for a secret nobody has verified yet. So the enrolment flow
-- (services/totp.py, routers/totp.py) does NOT insert a pending row while a
-- QR code is on screen: the freshly generated secret travels to the client
-- inside a short-lived, server-signed setup token (same JWT_SECRET as
-- session tokens, 10-minute expiry, a `purpose` claim `require_user`
-- already refuses everywhere else) and is written here for the first time
-- only when POST /api/v1/me/2fa/confirm verifies a real code against it.
-- An abandoned setup leaves no trace in this table at all.
--
-- Risk: LOW. Two new tables in `staging`, nothing existing touched, 0 rows
-- affected, no lock anyone is waiting on. Reversible with DROP TABLE — a
-- user who had 2FA enabled would be silently unenrolled (their next login
-- would not challenge them), which is the correct behaviour for an
-- emergency rollback, not a subtle one.

CREATE TABLE IF NOT EXISTS staging.user_totp (
    user_id        TEXT PRIMARY KEY,
    -- Fernet-encrypted via services/encryption.py (the same helper protecting
    -- R2 secret keys and Aadhaar numbers), never stored in the clear. The
    -- `enc::` prefix is the marker encrypt()/decrypt() look for.
    secret         TEXT NOT NULL,
    -- The TOTP time-step (30s window) most recently accepted, both at
    -- confirm and at every later /verify-2fa. A code is valid for a ~90s
    -- window (valid_window=1 either side); without this, the SAME code
    -- could be replayed twice inside that window. Rejecting a step <= the
    -- stored one closes that without rejecting the next legitimate code 30s
    -- later.
    last_used_step BIGINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staging.user_totp IS
    'TOTP enrolment. A row exists ONLY for a CONFIRMED authenticator — see '
    'the file header of 208_user_totp.sql. Read by routers/org_security.py '
    '(lockout count) and auth_router.py (login challenge + enforcement).';

CREATE TABLE IF NOT EXISTS staging.user_totp_recovery_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL,
    -- HMAC-SHA256(JWT_SECRET, code) hex digest, not the code itself — see
    -- services/totp.py::hash_recovery_code. Recovery codes are ~50 bits of
    -- entropy from secrets.choice, so unlike a password this does not need
    -- PBKDF2 stretching; what it needs is to never be recoverable from a
    -- database dump, which a keyed hash gives it.
    code_hash  TEXT NOT NULL,
    -- NULL = unused. Set once, on redemption, and never cleared — a
    -- recovery code is single-use by construction, not by convention.
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_totp_recovery_codes_user
    ON staging.user_totp_recovery_codes (user_id)
    WHERE used_at IS NULL;

COMMENT ON TABLE staging.user_totp_recovery_codes IS
    'One-time bypass codes, issued 10 at a time whenever TOTP is confirmed '
    'or explicitly regenerated. Hashed, single-use. Replacing a user''s '
    'authenticator (re-confirm) deletes every prior UNUSED code for that '
    'user in the same transaction — an old code from a lost-device event '
    'must not outlive the secret it was issued alongside.';

-- Verify:
--   SELECT to_regclass('staging.user_totp');
--   SELECT to_regclass('staging.user_totp_recovery_codes');
--   -- both expect non-NULL; SELECT count(*) FROM each expects 0

-- Rollback (silently unenrols everyone — see the risk note above):
--   DROP TABLE IF EXISTS staging.user_totp_recovery_codes;
--   DROP TABLE IF EXISTS staging.user_totp;
