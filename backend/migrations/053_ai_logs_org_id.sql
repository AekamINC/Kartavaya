-- ============================================================
-- Migration 053: Add org_id column to hub_ai_logs
-- ai_router.py writes org_id but original migration only had client_id
-- ============================================================

ALTER TABLE staging.hub_ai_logs ADD COLUMN IF NOT EXISTS org_id UUID;
CREATE INDEX IF NOT EXISTS idx_hub_ai_logs_org_id ON staging.hub_ai_logs(org_id);
