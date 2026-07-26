-- PROPOSED — `staging.org_security`, the table behind GET/PATCH /v1/org/security.
-- Review before running. NOT APPLIED by whoever merges this.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY
-- ═════════════════════════════════════════════════════════════════════════════
-- `10-org-settings.md` §4 lists `GET/PATCH /v1/org/security` and the
-- `org_security` table as new work. `frontend/src/pages/org/TabSecurity.jsx`
-- renders every control disabled because neither existed.
--
-- VERIFIED against the live database: `to_regclass('staging.org_security')` is
-- NULL, and `to_regclass('public.org_security')` is NULL.
--
-- `backend/routers/org_security.py` PROBES for this table, so it is safe to
-- deploy before this runs: GET returns the defaults with `storage_ready:false`
-- and PATCH returns 503 pointing here. Applying this switches saving on with no
-- redeploy.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- RISK: LOW — but read the two notes at the end before enabling ENFORCEMENT
-- ═════════════════════════════════════════════════════════════════════════════
--   Schema        : creates ONE new table in `staging`. Touches no existing
--                   table, no `public.*` table, and no existing row.
--   Rows affected : 0. The table starts empty; a row appears the first time an
--                   org_owner saves. Absent row == the defaults, which are the
--                   behaviour the product has today.
--   Blocking      : none. CREATE TABLE on a new name takes no lock anyone else
--                   is waiting on.
--   Reversible    : Yes — DROP TABLE. Nothing else references it, there is no
--                   inbound foreign key, and the router tolerates its absence.
--   Data loss     : none on apply.
--   Shared project: staging and production share one Supabase project. This
--                   file creates `staging.org_security` only. Do NOT create a
--                   `public.org_security` — production reads `public.*`, and a
--                   security-policy table on that path is the highest-blast-
--                   radius object in this proposal.

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.org_security (
    org_id          UUID PRIMARY KEY
                    REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- Members may add an authenticator to their own account. Opt-in, per
    -- person. Defaults TRUE because that is today's behaviour: nothing stops
    -- anyone, since there is nothing to stop.
    tfa_allowed     BOOLEAN NOT NULL DEFAULT TRUE,

    -- Required for every member. Defaults FALSE and is REFUSED by the router
    -- while the lockout count is unknowable — see the note at the end.
    tfa_enforced    BOOLEAN NOT NULL DEFAULT FALSE,

    -- Minutes of inactivity before sign-out. NULL means never, which is the
    -- current behaviour and therefore the default.
    idle_timeout    INTEGER,

    -- CIDR ranges permitted to sign in. Empty means no restriction.
    --
    -- TEXT[] and not INET[]/CIDR[] deliberately. The values are written by
    -- `ipaddress.ip_network(..., strict=False)` in Python, already normalised,
    -- and are read back for display far more often than they are compared.
    -- CIDR[] would make Postgres re-validate a value Python already validated,
    -- and would turn a bad row into a driver-level error instead of the 400
    -- naming the offending line that the router returns today.
    ip_ranges       TEXT[] NOT NULL DEFAULT '{}',

    password_policy TEXT NOT NULL DEFAULT 'standard',

    updated_by      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE staging.org_security
    DROP CONSTRAINT IF EXISTS org_security_password_policy_check;
ALTER TABLE staging.org_security
    ADD CONSTRAINT org_security_password_policy_check
    CHECK (password_policy IN ('standard', 'strong'));

-- 0 would sign everyone out instantly and a negative number is meaningless.
-- The upper bound is 30 days; beyond that "never" is the honest setting.
ALTER TABLE staging.org_security
    DROP CONSTRAINT IF EXISTS org_security_idle_timeout_range;
ALTER TABLE staging.org_security
    ADD CONSTRAINT org_security_idle_timeout_range
    CHECK (idle_timeout IS NULL OR idle_timeout BETWEEN 5 AND 43200);

-- Enforcing 2FA that is not allowed locks out every member including whoever
-- saved it. The router refuses this with a 400; the constraint means no path
-- into this table can produce that row, including a manual UPDATE during an
-- incident.
ALTER TABLE staging.org_security
    DROP CONSTRAINT IF EXISTS org_security_enforce_requires_allow;
ALTER TABLE staging.org_security
    ADD CONSTRAINT org_security_enforce_requires_allow
    CHECK (NOT (tfa_enforced AND NOT tfa_allowed));

COMMENT ON TABLE staging.org_security IS
    'Per-organisation security policy. STORED, NOT YET ENFORCED — no middleware '
    'reads ip_ranges, no session expires on idle_timeout, and signup does not '
    'read password_policy. GET /v1/org/security reports enforced:false for each '
    'so the settings screen cannot claim protection that is not applied.';

COMMENT ON COLUMN staging.org_security.ip_ranges IS
    'Normalised CIDR strings. PATCH refuses any non-empty list that does not '
    'contain the saving admin''s own address, and refuses outright if that '
    'address cannot be determined — a range that excludes the browser doing the '
    'saving locks the org out of its own settings with no path back but support.';

COMMENT ON COLUMN staging.org_security.tfa_enforced IS
    'Refused by PATCH until the number of members who would be locked out is '
    'countable, and then only when the request carries acknowledge_lockout '
    'equal to that exact number. See the ENFORCEMENT note in 068.';

-- ═════════════════════════════════════════════════════════════════════════════
-- TWO NOTES FOR WHOEVER BUILDS THE ENFORCEMENT
-- ═════════════════════════════════════════════════════════════════════════════
--
-- 1 · THERE IS NO TWO-FACTOR AUTHENTICATION IN THIS PRODUCT.
--     `grep -rniE 'totp|pyotp|two_factor|twofactor|mfa_|otpauth|authenticator'`
--     over `backend/` returns nothing. `auth.mfa_factors` exists because
--     Supabase creates it for every project, but it keys on `auth.users.id` and
--     this product's users are rows in `public.users` with `user_...` ids —
--     `auth.users` holds 0 rows against `public.users`' 12. There is no join,
--     so it cannot be used to count enrolment.
--
--     `org_security.py` probes for `staging.user_totp` or
--     `staging.user_mfa_factors`. Name the enrolment table one of those, with a
--     `user_id TEXT` column matching `users.user_id`, and the lockout count and
--     the enforce switch both start working with no change to that router.
--
-- 2 · ENFORCING `ip_ranges` NEEDS A TRUSTED SOURCE FOR THE CLIENT ADDRESS.
--     `org_security.py` reads the leftmost `X-Forwarded-For`, which is
--     client-controlled. That is safe there because it is used ONLY to REFUSE a
--     save — a forged header can lock the forger out and nothing else. The
--     moment a value derived from that header is used to ADMIT a request, this
--     reasoning stops holding: anyone can set `X-Forwarded-For` to an address
--     inside the allowlist and walk straight through. Enforcement must take the
--     address from the proxy (a trusted-hop count, or Railway's own header),
--     not from the raw request.

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═════════════════════════════════════════════════════════════════════════════
-- SELECT to_regclass('staging.org_security');           -- expect non-NULL
-- SELECT count(*) FROM staging.org_security;            -- expect 0
-- The router's probe picks the table up on the next request.

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════════════════
-- Discards every saved policy. The router keeps working: its probe finds the
-- table gone and returns to defaults / 503.
--
-- DROP TABLE IF EXISTS staging.org_security;
