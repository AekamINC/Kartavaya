-- Migration 055: Plan default credits, monthly reset, scraper credit costs
ALTER TABLE staging.plans ADD COLUMN IF NOT EXISTS default_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staging.hub_org_credits ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMPTZ DEFAULT NOW();

-- Per-scraper minimum credit cost + actual credits tracked per run
ALTER TABLE staging.hub_scraper_runs ADD COLUMN IF NOT EXISTS credits_charged INTEGER DEFAULT 0;
ALTER TABLE staging.hub_scraper_catalog ADD COLUMN IF NOT EXISTS credit_cost INTEGER NOT NULL DEFAULT 2;
UPDATE staging.hub_scraper_catalog SET credit_cost = CASE
    WHEN cost_per_run <= 0.05 THEN 1
    WHEN cost_per_run <= 0.15 THEN 2
    WHEN cost_per_run <= 0.25 THEN 3
    ELSE 5
END;

-- Set default credits per plan
UPDATE staging.plans SET default_credits = 200  WHERE code = 'free';
UPDATE staging.plans SET default_credits = 500  WHERE code = 'professional';
UPDATE staging.plans SET default_credits = 1000 WHERE code = 'business';
UPDATE staging.plans SET default_credits = 2000 WHERE code = 'enterprise';
