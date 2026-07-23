-- ============================================================
-- Migration 052: Org-level credit wallets & transactions
-- Referenced by ai_router.deduct_org_credits()
-- ============================================================

-- Org credit wallet (one row per org)
CREATE TABLE IF NOT EXISTS staging.hub_org_credits (
    org_id      UUID PRIMARY KEY REFERENCES staging.organisations(id) ON DELETE CASCADE,
    balance     INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Per-user credit allocations within an org
CREATE TABLE IF NOT EXISTS staging.hub_user_credits (
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    allocated   INTEGER NOT NULL DEFAULT 0,
    used        INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_credits_org ON staging.hub_user_credits(org_id);

-- Org credit transaction log
CREATE TABLE IF NOT EXISTS staging.hub_org_credit_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    user_id         TEXT,
    amount          INTEGER NOT NULL,
    balance_after   INTEGER NOT NULL,
    tx_type         TEXT NOT NULL DEFAULT 'debit',
    description     TEXT DEFAULT '',
    created_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_org_credit_tx_org ON staging.hub_org_credit_transactions(org_id);
