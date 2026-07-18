-- Scraper marketplace — Apify actor proxy with margin billing

CREATE TABLE IF NOT EXISTS staging.hub_scraper_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT DEFAULT '🔍',
    category TEXT NOT NULL DEFAULT 'general',
    apify_actor_id TEXT NOT NULL,
    input_schema JSONB NOT NULL DEFAULT '[]',
    cost_per_run DECIMAL(8,4) NOT NULL DEFAULT 0.50,
    price_inr DECIMAL(8,2) NOT NULL DEFAULT 70,
    margin_pct INTEGER NOT NULL DEFAULT 75,
    max_results INTEGER DEFAULT 100,
    result_columns JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.hub_scraper_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    scraper_id TEXT NOT NULL REFERENCES staging.hub_scraper_catalog(id),
    user_id TEXT NOT NULL,
    apify_run_id TEXT,
    inputs JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
    result_count INTEGER DEFAULT 0,
    cost_usd DECIMAL(8,4) DEFAULT 0,
    billed_inr DECIMAL(8,2) DEFAULT 0,
    results JSONB DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_org ON staging.hub_scraper_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_status ON staging.hub_scraper_runs(status);
