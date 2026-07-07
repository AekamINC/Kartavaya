-- ============================================================
-- Migration 013: AI Cost Tracking — real USD cost per generation
-- Adds cost_usd and generation_id to ai_logs,
-- plus a spend analytics view.
-- ============================================================

-- Add cost tracking columns to ai_logs
ALTER TABLE staging.hub_ai_logs
    ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS generation_id TEXT DEFAULT '';

-- Index for spend analytics queries
CREATE INDEX IF NOT EXISTS idx_hub_ai_logs_cost
    ON staging.hub_ai_logs(client_id, created_at)
    WHERE status = 'success';
