-- migration 060: structured audit log for security-critical events
-- Tracks auth events, admin actions, data exports, and sensitive operations.

CREATE TABLE IF NOT EXISTS staging.audit_log (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    org_id        UUID,
    user_id       TEXT,
    action        TEXT NOT NULL,
    resource_type TEXT,
    resource_id   TEXT,
    ip            INET,
    user_agent    TEXT,
    detail        JSONB DEFAULT '{}',
    severity      TEXT NOT NULL DEFAULT 'info'
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts      ON staging.audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_org     ON staging.audit_log (org_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON staging.audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON staging.audit_log (action, ts DESC);
