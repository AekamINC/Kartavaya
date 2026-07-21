-- 043: Company Asset Tracking
CREATE TABLE IF NOT EXISTS staging.manav_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    asset_tag TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'other' CHECK (category IN ('laptop', 'phone', 'tablet', 'vehicle', 'furniture', 'other')),
    serial_number TEXT DEFAULT '',
    purchase_date DATE,
    purchase_cost DECIMAL(12,2) DEFAULT 0,
    assigned_to UUID REFERENCES staging.manav_employees(id),
    assigned_date DATE,
    returned_date DATE,
    condition TEXT DEFAULT 'good' CHECK (condition IN ('new', 'good', 'fair', 'poor', 'disposed')),
    notes TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT TRUE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets_org ON staging.manav_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON staging.manav_assets(assigned_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_tag ON staging.manav_assets(org_id, asset_tag);
