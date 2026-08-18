-- 151 · the analytics spine — accounts, entities, one fact table (A1).
--
-- Proposal 60: every external source reduces to the same grain — "on this
-- date, for this entity, this metric had this value". Long, not wide, so a
-- new source adds ROWS, never a migration. Adapters never touch SQL; the
-- spine upserts (analytics/spine.py owns that path).
--
-- Derived metrics are NOT stored: CTR/CPC/ROAS are views over sums at read
-- time, because a stored ratio cannot be re-aggregated — averaging seven
-- daily CTRs is not the week's CTR.
--
-- ONE DEVIATION from the proposal's sketch, stated: it wrote
-- PRIMARY KEY (account_id, entity_id, date, metric) with a NULLable
-- entity_id — impossible, a PK column is implicitly NOT NULL, and
-- account-level facts (GA4 property totals) legitimately have no entity.
-- The uniqueness lives in a UNIQUE NULLS NOT DISTINCT constraint instead
-- (PG15+; this database is Supabase PG15+), which is the same promise the
-- sketch meant: one row per (account, entity-or-none, day, metric).
--
-- SHARED-DATABASE NOTE: four new empty tables; nothing existing is touched.
-- The A2 backfill of prachar_ad_insights into the fact table is a SEPARATE,
-- owner-gated step — this migration copies nothing.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.analytics_accounts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id               UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    client_id            UUID REFERENCES staging.graha_clients(id) ON DELETE SET NULL,
    source               TEXT NOT NULL,          -- 'meta_ads' | 'ga4' | ...
    external_account_id  TEXT NOT NULL,
    name                 TEXT,
    currency             TEXT DEFAULT 'INR',
    timezone             TEXT DEFAULT 'Asia/Kolkata',
    connector_ref        UUID,                   -- which sealed credential
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    cursor_date          DATE,                   -- last day considered settled
    last_ok_at           TIMESTAMPTZ,
    last_error           TEXT,
    consecutive_failures INT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, source, external_account_id)
);

CREATE TABLE IF NOT EXISTS staging.analytics_entities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID NOT NULL REFERENCES staging.analytics_accounts(id) ON DELETE CASCADE,
    entity_type  TEXT NOT NULL,                  -- 'campaign' | 'property' | ...
    external_id  TEXT NOT NULL,
    parent_id    UUID REFERENCES staging.analytics_entities(id) ON DELETE CASCADE,
    name         TEXT,
    attrs        JSONB NOT NULL DEFAULT '{}',
    UNIQUE (account_id, entity_type, external_id)
);

CREATE TABLE IF NOT EXISTS staging.analytics_metrics_daily (
    org_id     UUID NOT NULL,                    -- denormalised: every read filters on it
    account_id UUID NOT NULL REFERENCES staging.analytics_accounts(id) ON DELETE CASCADE,
    entity_id  UUID REFERENCES staging.analytics_entities(id) ON DELETE CASCADE,
    date       DATE NOT NULL,
    metric     TEXT NOT NULL,                    -- 'spend' | 'impressions' | ...
    value      NUMERIC(20, 6) NOT NULL,
    currency   TEXT,                             -- money metrics only
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE NULLS NOT DISTINCT (account_id, entity_id, date, metric)
);

CREATE INDEX IF NOT EXISTS idx_amd_org_date
    ON staging.analytics_metrics_daily (org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_amd_org_metric
    ON staging.analytics_metrics_daily (org_id, metric, date DESC);

-- The metric catalogue: what each source can emit, with a human label — so
-- the UI never hardcodes a spellings list. Upserted by the spine when an
-- adapter registers; seeding it here would just drift from the code.
CREATE TABLE IF NOT EXISTS staging.analytics_source_metrics (
    source   TEXT NOT NULL,
    metric   TEXT NOT NULL,
    label    TEXT NOT NULL,
    is_money BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (source, metric)
);

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.analytics_source_metrics;
--   DROP TABLE staging.analytics_metrics_daily;
--   DROP TABLE staging.analytics_entities;
--   DROP TABLE staging.analytics_accounts;
