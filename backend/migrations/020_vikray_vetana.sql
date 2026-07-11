-- Migration 020: Vikray (Sales) + Vetana (Payroll) modules
-- 2026-07-11

-- ── Vikray: Sales Orders ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.vikray_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES staging.graha_contacts(id),
    deal_id UUID REFERENCES staging.graha_deals(id),
    order_number TEXT NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery DATE,
    line_items JSONB NOT NULL DEFAULT '[]',
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
    cgst DECIMAL(14,2) DEFAULT 0,
    sgst DECIMAL(14,2) DEFAULT 0,
    igst DECIMAL(14,2) DEFAULT 0,
    discount DECIMAL(14,2) DEFAULT 0,
    total DECIMAL(14,2) NOT NULL DEFAULT 0,
    is_igst BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'dispatched', 'delivered', 'closed', 'cancelled')),
    invoice_id UUID REFERENCES staging.ganit_invoices(id),
    shipping_address JSONB DEFAULT '{}',
    notes TEXT,
    created_by UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vikray_orders_org ON staging.vikray_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_vikray_orders_status ON staging.vikray_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_vikray_orders_contact ON staging.vikray_orders(contact_id);

-- ── Vikray: Sales Targets ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.vikray_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    salesperson_id UUID NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    target_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    target_deals INTEGER DEFAULT 0,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, salesperson_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_vikray_targets_org ON staging.vikray_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_vikray_targets_period ON staging.vikray_targets(org_id, period_start, period_end);

-- ── Vetana: Salary Structures ───────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.vetana_salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    ctc_annual DECIMAL(14,2) NOT NULL DEFAULT 0,
    basic DECIMAL(14,2) NOT NULL DEFAULT 0,
    hra DECIMAL(14,2) DEFAULT 0,
    da DECIMAL(14,2) DEFAULT 0,
    special_allowance DECIMAL(14,2) DEFAULT 0,
    conveyance DECIMAL(14,2) DEFAULT 0,
    medical DECIMAL(14,2) DEFAULT 0,
    other_allowances JSONB DEFAULT '[]',
    pf_enabled BOOLEAN DEFAULT TRUE,
    esi_enabled BOOLEAN DEFAULT FALSE,
    pt_applicable BOOLEAN DEFAULT TRUE,
    tds_regime TEXT DEFAULT 'new' CHECK (tds_regime IN ('old', 'new')),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_vetana_structures_org ON staging.vetana_salary_structures(org_id);
CREATE INDEX IF NOT EXISTS idx_vetana_structures_emp ON staging.vetana_salary_structures(employee_id);

-- ── Vetana: Payroll Runs ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.vetana_payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'processed', 'approved', 'disbursed')),
    total_gross DECIMAL(14,2) DEFAULT 0,
    total_deductions DECIMAL(14,2) DEFAULT 0,
    total_net DECIMAL(14,2) DEFAULT 0,
    total_pf DECIMAL(14,2) DEFAULT 0,
    total_esi DECIMAL(14,2) DEFAULT 0,
    total_pt DECIMAL(14,2) DEFAULT 0,
    total_tds DECIMAL(14,2) DEFAULT 0,
    employee_count INTEGER DEFAULT 0,
    processed_at TIMESTAMPTZ,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, month)
);

CREATE INDEX IF NOT EXISTS idx_vetana_runs_org ON staging.vetana_payroll_runs(org_id);

-- ── Vetana: Payslips ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.vetana_payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES staging.vetana_payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id),
    payslip_number TEXT NOT NULL,
    month TEXT NOT NULL,
    working_days INTEGER DEFAULT 0,
    present_days INTEGER DEFAULT 0,
    leaves_paid INTEGER DEFAULT 0,
    leaves_unpaid INTEGER DEFAULT 0,
    overtime_hours DECIMAL(8,2) DEFAULT 0,
    basic DECIMAL(14,2) DEFAULT 0,
    hra DECIMAL(14,2) DEFAULT 0,
    da DECIMAL(14,2) DEFAULT 0,
    special_allowance DECIMAL(14,2) DEFAULT 0,
    conveyance DECIMAL(14,2) DEFAULT 0,
    medical DECIMAL(14,2) DEFAULT 0,
    other_earnings JSONB DEFAULT '[]',
    overtime_pay DECIMAL(14,2) DEFAULT 0,
    gross DECIMAL(14,2) DEFAULT 0,
    pf_employee DECIMAL(14,2) DEFAULT 0,
    pf_employer DECIMAL(14,2) DEFAULT 0,
    esi_employee DECIMAL(14,2) DEFAULT 0,
    esi_employer DECIMAL(14,2) DEFAULT 0,
    professional_tax DECIMAL(14,2) DEFAULT 0,
    tds DECIMAL(14,2) DEFAULT 0,
    other_deductions JSONB DEFAULT '[]',
    total_deductions DECIMAL(14,2) DEFAULT 0,
    net_pay DECIMAL(14,2) DEFAULT 0,
    status TEXT DEFAULT 'generated'
        CHECK (status IN ('generated', 'approved', 'disbursed')),
    disbursed_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vetana_payslips_org ON staging.vetana_payslips(org_id);
CREATE INDEX IF NOT EXISTS idx_vetana_payslips_run ON staging.vetana_payslips(run_id);
CREATE INDEX IF NOT EXISTS idx_vetana_payslips_emp ON staging.vetana_payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_vetana_payslips_month ON staging.vetana_payslips(org_id, month);
