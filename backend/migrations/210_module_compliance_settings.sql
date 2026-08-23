-- 210_module_compliance_settings.sql
-- Workstream H (proposal 80) — the generic table behind "compliance is a
-- setting". One table, one resolver, every module: a rule with no row
-- resolves to 'applicable' (shown, optional, consequence stated, nothing
-- blocked — today's behaviour), so nothing needs seeding and nothing
-- arrives enforced. 'not_applicable' hides the field entirely (a composition
-- dealer charging no GST). 'enforced' is only reachable by a firm
-- deliberately choosing the guardrail.
--
-- Pahchan's operational numbers (radius, grace, retention days/years, report
-- cadence) stay in staging.pahchan_policy — those are not "does this apply
-- to us" questions, they are configuration, and moving them here would just
-- be a second table for the same seventeen columns. Only applies/does-not-
-- apply questions move here, starting with Ganit (see routers/ganit.py's
-- HSN-required wiring, services/compliance_settings.py).
--
-- Risk: LOW. One new table, no existing table touched, 0 rows affected,
-- reversible with DROP TABLE (every org falls back to 'applicable' for
-- every rule, which is today's behaviour — losing nothing that blocks
-- anything).

CREATE TABLE IF NOT EXISTS staging.module_compliance_settings (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id   UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- Free text, not a CHECK enum — a new module getting settings must not
    -- need a migration to add its rows, only an entry in the Python registry
    -- (services/compliance_settings.py::RULES) that gives the UI a label and
    -- states the consequence.
    module   TEXT NOT NULL,
    rule_key TEXT NOT NULL,
    state    TEXT NOT NULL DEFAULT 'applicable'
             CHECK (state IN ('not_applicable', 'applicable', 'enforced')),
    -- "Not applicable is a decision, not an absence" (proposal 80, rule 1).
    -- set_by/set_at alone already answer "who decided this and when" even
    -- when reason is left blank — reason is optionally why, per the proposal.
    set_by   TEXT,
    set_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason   TEXT,
    UNIQUE (org_id, module, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_module_compliance_settings_org_module
    ON staging.module_compliance_settings (org_id, module);

COMMENT ON TABLE staging.module_compliance_settings IS
    'Three-state compliance applicability, per org per module per rule. '
    'Absent row = applicable (shown, optional, warns, never blocks). '
    'See services/compliance_settings.py for the resolver and the registry '
    'of rule_keys each module actually reads.';

-- Verify: SELECT to_regclass('staging.module_compliance_settings'); -- expect non-NULL
-- Rollback: DROP TABLE IF EXISTS staging.module_compliance_settings;
