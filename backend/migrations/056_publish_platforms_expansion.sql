-- 056: Expand publishing platforms + per-client platform enablement
-- Aekam team controls which platforms each client can use

-- 1. Per-client enabled platforms (Aekam decides)
CREATE TABLE IF NOT EXISTS staging.hub_client_platforms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    enabled_by TEXT,
    enabled_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, platform)
);

CREATE INDEX idx_hub_client_platforms_client ON staging.hub_client_platforms(client_id);

-- 2. Expand the platform CHECK constraint on hub_social_accounts
ALTER TABLE staging.hub_social_accounts DROP CONSTRAINT IF EXISTS hub_social_accounts_platform_check;
ALTER TABLE staging.hub_social_accounts ADD CONSTRAINT hub_social_accounts_platform_check
    CHECK (platform IN (
        'facebook', 'instagram', 'linkedin', 'google_business', 'twitter',
        'youtube', 'whatsapp_business', 'pinterest', 'tiktok',
        'threads', 'telegram', 'snapchat', 'reddit'
    ));

-- 3. Add org_id to hub_client_platforms for RLS
ALTER TABLE staging.hub_client_platforms ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES staging.organisations(id);
UPDATE staging.hub_client_platforms cp SET org_id = c.org_id
    FROM staging.hub_clients c WHERE cp.client_id = c.id AND cp.org_id IS NULL;
