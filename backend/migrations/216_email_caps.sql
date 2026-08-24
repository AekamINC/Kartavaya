-- 216: Per-org email caps and overage billing
--
-- Adds daily/monthly email caps to organisations, an overage rate for billing,
-- and a deduplication table for 80% threshold alerts.
--
-- RISK REPORT
-- -----------
-- 1. Three ADD COLUMN IF NOT EXISTS on staging.organisations — all nullable,
--    no default, no rewrite. Instant on any table size.
-- 2. New table staging.email_cap_alerts — empty, no FK risk.
-- 3. No data migration, no backfill.
-- 4. All columns nullable: NULL = unlimited (no cap).
-- 5. Write-path impact: NONE until the application code reads these columns.

ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS email_cap_daily    INT,
  ADD COLUMN IF NOT EXISTS email_cap_monthly  INT,
  ADD COLUMN IF NOT EXISTS email_overage_rate NUMERIC(10,2);

-- Widen the outbound_log status CHECK to accept 'capped'.
ALTER TABLE staging.outbound_log
  DROP CONSTRAINT IF EXISTS outbound_log_status_ck;
ALTER TABLE staging.outbound_log
  ADD CONSTRAINT outbound_log_status_ck
  CHECK (status IN ('queued','sent','suppressed','failed','capped'));

CREATE TABLE IF NOT EXISTS staging.email_cap_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  cap_type    TEXT NOT NULL CHECK (cap_type IN ('daily', 'monthly')),
  period_key  TEXT NOT NULL,
  alerted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, cap_type, period_key)
);
