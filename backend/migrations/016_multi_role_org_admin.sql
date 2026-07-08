-- ============================================================
-- Migration 016: Multi-role system + admin-driven org creation
--
-- 1. user_roles — replaces single role field with multi-role per org
-- 2. organisations gets owner_user_id, storage tracking columns
-- 3. Seed platform_admin role for existing admin users
-- ============================================================

-- 1. User Roles (multi-role, org-scoped or platform-wide)
CREATE TABLE IF NOT EXISTS staging.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    org_id UUID REFERENCES staging.organisations(id) ON DELETE CASCADE,
    role_code TEXT NOT NULL CHECK (role_code IN (
        'platform_admin', 'account_manager', 'account_finance',
        'srijan_admin', 'org_admin', 'org_member'
    )),
    granted_by TEXT,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id, role_code)
);

-- Platform roles have org_id = NULL, need a partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_platform
    ON staging.user_roles (user_id, role_code)
    WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON staging.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON staging.user_roles(org_id);

-- 2. Add owner + storage + per-org R2 credentials to organisations
ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
    ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS r2_prefix TEXT,
    ADD COLUMN IF NOT EXISTS r2_account_id TEXT,
    ADD COLUMN IF NOT EXISTS r2_access_key_id TEXT,
    ADD COLUMN IF NOT EXISTS r2_secret_access_key TEXT,
    ADD COLUMN IF NOT EXISTS r2_bucket_name TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 3. Seed: existing admin users get platform_admin role
INSERT INTO staging.user_roles (user_id, org_id, role_code)
SELECT user_id, NULL, 'platform_admin'
FROM users WHERE role = 'admin'
ON CONFLICT DO NOTHING;

-- 4. Set r2_prefix (bucket name) for existing orgs
UPDATE staging.organisations
SET r2_prefix = 'kartavya-' || REPLACE(id::text, '-', '')::varchar(12)
WHERE r2_prefix IS NULL;
