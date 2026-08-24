-- 217 · Billing Cycle Engine (proposal 86, P1)
--
-- Adds:
--   1. billing_anchor_day on organisations (1–28, default 1)
--   2. billing_direction on org_billing_lines ('advance' | 'arrears')
--
-- Risk: LOW — two nullable ADDs, no data rewrite, no constraint on existing rows.
-- Both columns DEFAULT so every existing row gets a value in place.

BEGIN;

-- 1. Anchor day: the calendar day (1–28) on which the org's billing period
--    starts.  28 is the ceiling so February never overflows.
ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS billing_anchor_day SMALLINT NOT NULL DEFAULT 1
  CHECK (billing_anchor_day BETWEEN 1 AND 28);

-- 2. Billing direction per line: does the line charge before ("advance") or
--    after ("arrears") the service period?
ALTER TABLE staging.org_billing_lines
  ADD COLUMN IF NOT EXISTS billing_direction TEXT NOT NULL DEFAULT 'advance'
  CHECK (billing_direction IN ('advance', 'arrears'));

COMMIT;
