-- Migration 050: Move scraper results from JSONB column to R2 storage
-- The results column stays for backward compat with old runs but new runs use results_r2_key
ALTER TABLE staging.hub_scraper_runs ADD COLUMN IF NOT EXISTS results_r2_key TEXT;
