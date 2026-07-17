-- ============================================================
-- Migration 028: Tenancy FK inversion — teams.org_id
-- ============================================================
-- Adds org_id to teams (many projects : 1 org), populated from
-- the existing organisations.team_id 1:1 mapping.
-- organisations.team_id kept for backward compat during transition.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS org_id UUID;

UPDATE teams t SET org_id = o.id
FROM staging.organisations o
WHERE o.team_id = t.team_id AND t.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);

ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
