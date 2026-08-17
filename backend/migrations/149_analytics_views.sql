-- 149 · analytics_views — one saved-view table for every analytics surface.
--
-- Proposal 62 D3. Every module gets an Analytics tab reading the same
-- registry; the views people save over it need one home, not a table per
-- module. The resolution order the reader applies is
--
--     personal (user_id = viewer)  >  org (user_id IS NULL)  >  code preset
--
-- Presets are CODE (analytics/presets.py), never rows: a preset that shipped
-- as a row would be frozen at the version the org signed up under, and a
-- fixed default that improves is a migration nobody should have to write.
--
-- `module` is the registry module code the view belongs to ('ganit', 'core',
-- …) or 'dristi' for the cross-module reporting surface. `layout` is the
-- widget list the builder edits: [{metric, viz, w, h, group_by?, columns?}].
-- The API validates metric keys against the registry ON SAVE; rows are not
-- trusted at render time either, because a metric can be retired after a
-- view named it — an unknown key renders as an absent widget, not an error.
--
-- MIGRATED IN, REVERSIBLE: the existing Dristi saved dashboards
-- (staging.dristi_dashboards, 11 active rows at authoring time — dry-run
-- counted live before this ran) are COPIED here as org-level 'dristi' views.
-- The old table and its rows are left in place untouched, and the old CRUD
-- keeps working against them until the Dristi frontend moves over; nothing
-- is dropped by this migration.
--
-- SHARED-DATABASE NOTE: staging and production share this database. This is
-- a new table plus a read of dristi_dashboards — no existing table is
-- altered, no existing row is written. Production's code (main) never reads
-- analytics_views, so its behaviour is unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.analytics_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- NULL = an org-level view every member sees; a value = personal.
    -- TEXT because users.user_id is text (canonical 'user_<12hex>'); no FK,
    -- matching dristi_dashboards.created_by after migration 030.
    user_id TEXT,
    module TEXT NOT NULL,
    name TEXT NOT NULL,
    layout JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_views_org_module
    ON staging.analytics_views (org_id, module) WHERE is_active;

-- The copy. Idempotent: re-running skips rows whose (org, module, name)
-- already landed.
INSERT INTO staging.analytics_views
    (org_id, user_id, module, name, layout, is_default, is_active,
     created_by, created_at, updated_at)
SELECT d.org_id, NULL, 'dristi', d.name, d.widgets,
       COALESCE(d.is_default, FALSE), COALESCE(d.is_active, TRUE),
       d.created_by::text, d.created_at, d.updated_at
  FROM staging.dristi_dashboards d
 WHERE NOT EXISTS (
    SELECT 1 FROM staging.analytics_views av
     WHERE av.org_id = d.org_id AND av.module = 'dristi' AND av.name = d.name);

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.analytics_views;
-- Nothing else — the source rows were never touched.
