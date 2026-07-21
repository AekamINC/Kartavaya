-- Vikray — Product & stock ledger (Odoo features plan, Tier 1 #3)

CREATE TABLE IF NOT EXISTS staging.vikray_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES staging.ganit_products(id) ON DELETE CASCADE,
    quantity_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0,
    low_stock_threshold DECIMAL(12,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, product_id)
);

CREATE TABLE IF NOT EXISTS staging.vikray_stock_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES staging.ganit_products(id),
    order_id UUID REFERENCES staging.vikray_orders(id) ON DELETE SET NULL,
    quantity_delta DECIMAL(12,2) NOT NULL,
    reason TEXT NOT NULL DEFAULT 'manual_adjustment',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_moves_org ON staging.vikray_stock_moves(org_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON staging.vikray_stock_moves(product_id);
