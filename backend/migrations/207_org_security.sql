-- 207_org_security.sql
-- Promotes PROPOSED_069_org_security.sql to applied. Content unchanged from
-- that file's APPLY section — see it for the full risk report, the two
-- design notes on 2FA lockout-counting and IP-range enforcement, and the
-- verify/rollback steps. Applied 2026-08-23 as part of workstream L
-- (two-factor authentication): `org_security.py` already ships fully wired
-- against this table (probes for it, degrades to defaults/503 while it is
-- absent) and against a TOTP table named in TOTP_TABLES — 208_user_totp.sql
-- supplies that, in the same batch.
--
-- Risk: LOW, per PROPOSED_069's own report — one new table in `staging`,
-- touches nothing existing, 0 rows affected, fully reversible with DROP
-- TABLE, and the router already tolerates the table's absence so this can
-- be applied with no redeploy required.

CREATE TABLE IF NOT EXISTS staging.org_security (
    org_id          UUID PRIMARY KEY
                    REFERENCES staging.organisations(id) ON DELETE CASCADE,
    tfa_allowed     BOOLEAN NOT NULL DEFAULT TRUE,
    tfa_enforced    BOOLEAN NOT NULL DEFAULT FALSE,
    idle_timeout    INTEGER,
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

ALTER TABLE staging.org_security
    DROP CONSTRAINT IF EXISTS org_security_idle_timeout_range;
ALTER TABLE staging.org_security
    ADD CONSTRAINT org_security_idle_timeout_range
    CHECK (idle_timeout IS NULL OR idle_timeout BETWEEN 5 AND 43200);

ALTER TABLE staging.org_security
    DROP CONSTRAINT IF EXISTS org_security_enforce_requires_allow;
ALTER TABLE staging.org_security
    ADD CONSTRAINT org_security_enforce_requires_allow
    CHECK (NOT (tfa_enforced AND NOT tfa_allowed));

COMMENT ON TABLE staging.org_security IS
    'Per-organisation security policy. tfa_allowed/tfa_enforced are ENFORCED '
    'at login as of 208/209 (workstream L). idle_timeout, ip_ranges and '
    'password_policy remain STORED, NOT ENFORCED — no middleware reads '
    'ip_ranges, no session expires on idle_timeout, signup does not read '
    'password_policy. GET /v1/org/security reports enforced:false for those '
    'three so the settings screen cannot claim protection that is not applied.';

COMMENT ON COLUMN staging.org_security.tfa_enforced IS
    'Refused by PATCH until the number of members who would be locked out is '
    'countable, and then only when the request carries acknowledge_lockout '
    'equal to that exact number (org_security.py). Once true for ANY org a '
    'user belongs to, login (auth_router.py) refuses that user unless they '
    'have a confirmed row in staging.user_totp — see 208_user_totp.sql and '
    'auth_router.py login() for the enforcement wiring. Scoped to the USER, '
    'not the org: a member of one enforcing org and one lenient org must '
    'still enrol to sign in at all, because login predates org selection.';

-- Verify: SELECT to_regclass('staging.org_security'); -- expect non-NULL
-- Rollback: DROP TABLE IF EXISTS staging.org_security;
