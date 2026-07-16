-- ============================================================
-- Migration 025: Per-user module access + developer role + step 0 fix
--
-- 1. org_member_modules — per-user module whitelist within an org
-- 2. Add 'developer' to user_roles role_code CHECK
-- 3. Fix get_org_id: add org_id to team_members for direct lookup
-- ============================================================

-- 1. Per-user module access
CREATE TABLE IF NOT EXISTS staging.org_member_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL,
    granted_by TEXT,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id, module_code)
);

CREATE INDEX IF NOT EXISTS idx_omm_user_org
    ON staging.org_member_modules (user_id, org_id);

-- 2. Add 'developer' to the role_code enum
ALTER TABLE staging.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_code_check;
ALTER TABLE staging.user_roles ADD CONSTRAINT user_roles_role_code_check
    CHECK (role_code IN (
        'platform_admin', 'account_manager', 'account_finance',
        'developer', 'srijan_admin',
        'org_admin', 'org_member', 'org_owner'
    ));
