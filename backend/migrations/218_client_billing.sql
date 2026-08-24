-- 218 · Client Billing (proposal 87, P5.1 + P5.2)
--
-- P5.1: client_billing_profiles, client_service_lines, client_metered_usage
--        + billing_profile_id on ganit_invoices
-- P5.2: client_invoice_lines join table (no-double-charge for auto-invoicing)
--
-- Risk: LOW — all ADDs; nullable FK on ganit_invoices, no rewrite.
-- Shared DB: staging+production both write to staging schema.

BEGIN;

-- ═══ P5.1 ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.client_billing_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id),
    client_id       UUID NOT NULL REFERENCES staging.graha_clients(id),
    billing_cycle   TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
    anchor_day      SMALLINT NOT NULL DEFAULT 1
                    CHECK (anchor_day BETWEEN 1 AND 28),
    payment_terms_days INT NOT NULL DEFAULT 30,
    currency        TEXT NOT NULL DEFAULT 'INR',
    gst_treatment   TEXT NOT NULL DEFAULT 'registered'
                    CHECK (gst_treatment IN ('registered', 'unregistered', 'composition', 'overseas', 'sez')),
    credit_limit    NUMERIC(14,2),
    notes           TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbp_org ON staging.client_billing_profiles(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cbp_org_client
    ON staging.client_billing_profiles(org_id, client_id);

CREATE TABLE IF NOT EXISTS staging.client_service_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id),
    profile_id      UUID NOT NULL REFERENCES staging.client_billing_profiles(id),
    kind            TEXT NOT NULL DEFAULT 'retainer'
                    CHECK (kind IN ('retainer', 'subscription', 'one_off')),
    description     TEXT NOT NULL DEFAULT '',
    amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    cadence         TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (cadence IN ('monthly', 'quarterly', 'annual', 'one_off')),
    period_start    DATE NOT NULL,
    period_end      DATE,
    billing_direction TEXT NOT NULL DEFAULT 'advance'
                    CHECK (billing_direction IN ('advance', 'arrears')),
    auto_invoice    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csl_org ON staging.client_service_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_csl_profile ON staging.client_service_lines(profile_id);

CREATE TABLE IF NOT EXISTS staging.client_metered_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id),
    profile_id      UUID NOT NULL REFERENCES staging.client_billing_profiles(id),
    metric          TEXT NOT NULL DEFAULT '',
    quantity        NUMERIC(14,4) NOT NULL DEFAULT 0,
    unit            TEXT NOT NULL DEFAULT '',
    rate            NUMERIC(14,2) NOT NULL DEFAULT 0,
    recorded_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    source_ref      TEXT,
    invoiced        BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmu_org ON staging.client_metered_usage(org_id);
CREATE INDEX IF NOT EXISTS idx_cmu_profile ON staging.client_metered_usage(profile_id);

-- FK on ganit_invoices: which billing profile generated this invoice (nullable).
ALTER TABLE staging.ganit_invoices
    ADD COLUMN IF NOT EXISTS billing_profile_id UUID
    REFERENCES staging.client_billing_profiles(id) ON DELETE SET NULL;

-- ═══ P5.2 ════════════════════════════════════════════════════════════════

-- Join table: which service line was billed on which invoice for which period.
-- Same no-double-charge pattern as staging.invoice_billing_lines (migration 096).
CREATE TABLE IF NOT EXISTS staging.client_invoice_lines (
    invoice_id      UUID NOT NULL REFERENCES staging.ganit_invoices(id) ON DELETE CASCADE,
    line_id         UUID NOT NULL REFERENCES staging.client_service_lines(id) ON DELETE RESTRICT,
    period_start    DATE NOT NULL,
    amount          NUMERIC(14,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (invoice_id, line_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cil_line_period
    ON staging.client_invoice_lines(line_id, period_start);

COMMIT;
