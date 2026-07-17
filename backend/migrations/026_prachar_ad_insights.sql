-- ============================================================
-- Migration 026: Prachar ad insights — Meta/Google ad data
-- ============================================================

CREATE TABLE IF NOT EXISTS staging.prachar_ad_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
    external_account_id TEXT NOT NULL,
    name TEXT,
    currency TEXT DEFAULT 'INR',
    social_account_id UUID,
    is_active BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, platform, external_account_id)
);

CREATE TABLE IF NOT EXISTS staging.prachar_ad_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES staging.prachar_ad_accounts(id) ON DELETE CASCADE,
    external_campaign_id TEXT NOT NULL,
    name TEXT,
    status TEXT,
    objective TEXT,
    daily_budget NUMERIC(12,2),
    lifetime_budget NUMERIC(12,2),
    platform_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, external_campaign_id)
);

CREATE TABLE IF NOT EXISTS staging.prachar_ad_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES staging.prachar_ad_campaigns(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    spend NUMERIC(12,2) DEFAULT 0,
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    conversions BIGINT DEFAULT 0,
    ctr NUMERIC(8,4) DEFAULT 0,
    cpc NUMERIC(10,4) DEFAULT 0,
    cpm NUMERIC(10,4) DEFAULT 0,
    roas NUMERIC(10,4) DEFAULT 0,
    platform_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_pai_campaign_date ON staging.prachar_ad_insights(campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_pac_org ON staging.prachar_ad_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_padc_account ON staging.prachar_ad_campaigns(account_id);
