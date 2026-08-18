-- 150 · analytics_alerts — a threshold on any metric raises a Niyam event.
--
-- Proposal 62 D7: "DSO over 45, attendance under 90%, pipeline coverage
-- under 3× … the feature that makes the dashboard stop needing to be
-- opened, and Niyam already has the delivery path."
--
-- The row is CONFIGURATION, not state: which metric, which direction, what
-- number, over how many days. Evaluation lives in the Niyam sweep
-- (services/niyam/metric_alerts.py) — it runs the metric's own registry SQL,
-- so the alert can never disagree with the dashboard about what DSO is
-- (metric drift is the programme's named failure mode). A breach emits a
-- `metric.threshold` event, deduplicated to once per alert per day by the
-- same partial unique index every temporal event rides; what happens next is
-- a rule, exactly like every other event in the product.
--
-- SHARED-DATABASE NOTE: a new empty table; no existing table or row is
-- touched. Production's code never reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.analytics_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- a registry key ('ganit.dso'); validated against the registry on save
    -- AND tolerated at evaluation (a metric can retire after an alert named
    -- it — the evaluator skips it with a stated reason, never errors)
    metric TEXT NOT NULL,
    operator TEXT NOT NULL CHECK (operator IN ('gt', 'lt')),
    threshold DOUBLE PRECISION NOT NULL,
    -- the flow window the metric is evaluated over, ending today; ignored by
    -- stock metrics, which are as-at-today by definition
    window_days INT NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 366),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_active
    ON staging.analytics_alerts (org_id) WHERE is_active;

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.analytics_alerts;
