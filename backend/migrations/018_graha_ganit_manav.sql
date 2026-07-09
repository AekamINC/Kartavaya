-- ============================================================
-- Migration 018: Graha (CRM), Ganit (GST Invoicing), Manav (HRMS)
-- Three add-on modules with full table schemas.
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- GRAHA · ग्राह (CRM) — Leads, Deals, Contacts, Quotations
-- ═══════════════════════════════════════════════════════════

CREATE TABLE staging.graha_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    designation TEXT,
    gstin TEXT,
    pan TEXT,
    billing_address JSONB DEFAULT '{}',
    shipping_address JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    contact_type TEXT NOT NULL DEFAULT 'lead'
        CHECK (contact_type IN ('lead', 'customer', 'vendor', 'partner')),
    source TEXT DEFAULT '',
    created_by UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_contacts_org ON staging.graha_contacts(org_id);
CREATE INDEX idx_graha_contacts_type ON staging.graha_contacts(org_id, contact_type);

CREATE TABLE staging.graha_pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stages JSONB NOT NULL DEFAULT '["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]',
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_pipelines_org ON staging.graha_pipelines(org_id);

CREATE TABLE staging.graha_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    pipeline_id UUID REFERENCES staging.graha_pipelines(id),
    contact_id UUID REFERENCES staging.graha_contacts(id),
    title TEXT NOT NULL,
    value DECIMAL(14,2) DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    stage TEXT NOT NULL DEFAULT 'New',
    probability INTEGER DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
    expected_close_date DATE,
    assigned_to UUID,
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    won_at TIMESTAMPTZ,
    lost_at TIMESTAMPTZ,
    lost_reason TEXT,
    created_by UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_deals_org ON staging.graha_deals(org_id);
CREATE INDEX idx_graha_deals_stage ON staging.graha_deals(org_id, stage);
CREATE INDEX idx_graha_deals_contact ON staging.graha_deals(contact_id);

CREATE TABLE staging.graha_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES staging.graha_deals(id),
    contact_id UUID REFERENCES staging.graha_contacts(id),
    activity_type TEXT NOT NULL CHECK (activity_type IN ('call', 'email', 'meeting', 'note', 'task')),
    title TEXT NOT NULL,
    description TEXT,
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    is_completed BOOLEAN DEFAULT FALSE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graha_activities_deal ON staging.graha_activities(deal_id);
CREATE INDEX idx_graha_activities_contact ON staging.graha_activities(contact_id);

-- ═══════════════════════════════════════════════════════════
-- GANIT · गणित (GST Invoicing) — depends on Graha contacts
-- ═══════════════════════════════════════════════════════════

CREATE TABLE staging.ganit_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hsn_code TEXT,
    sac_code TEXT,
    unit TEXT DEFAULT 'NOS',
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    description TEXT,
    is_service BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ganit_products_org ON staging.ganit_products(org_id);

CREATE TABLE staging.ganit_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES staging.graha_contacts(id),
    deal_id UUID REFERENCES staging.graha_deals(id),
    invoice_number TEXT NOT NULL,
    invoice_type TEXT NOT NULL DEFAULT 'tax_invoice'
        CHECK (invoice_type IN ('tax_invoice', 'proforma', 'credit_note', 'debit_note', 'quotation')),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    place_of_supply TEXT DEFAULT '',
    is_igst BOOLEAN DEFAULT FALSE,
    line_items JSONB NOT NULL DEFAULT '[]',
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
    cgst DECIMAL(14,2) NOT NULL DEFAULT 0,
    sgst DECIMAL(14,2) NOT NULL DEFAULT 0,
    igst DECIMAL(14,2) NOT NULL DEFAULT 0,
    cess DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total DECIMAL(14,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
    balance_due DECIMAL(14,2) NOT NULL DEFAULT 0,
    payment_status TEXT DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overdue', 'cancelled')),
    notes TEXT,
    terms TEXT,
    created_by UUID,
    approved_by UUID,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    pdf_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ganit_invoices_org ON staging.ganit_invoices(org_id);
CREATE INDEX idx_ganit_invoices_contact ON staging.ganit_invoices(contact_id);
CREATE INDEX idx_ganit_invoices_status ON staging.ganit_invoices(org_id, payment_status);
CREATE UNIQUE INDEX idx_ganit_invoices_number ON staging.ganit_invoices(org_id, invoice_number);

CREATE TABLE staging.ganit_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES staging.ganit_invoices(id),
    amount DECIMAL(14,2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method TEXT DEFAULT 'bank_transfer'
        CHECK (payment_method IN ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other')),
    reference TEXT,
    notes TEXT,
    recorded_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ganit_payments_invoice ON staging.ganit_payments(invoice_id);

-- ═══════════════════════════════════════════════════════════
-- MANAV · मानव (HRMS) — Employees, Attendance, Leaves
-- ═══════════════════════════════════════════════════════════

CREATE TABLE staging.manav_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    user_id UUID,
    employee_code TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    department TEXT DEFAULT '',
    designation TEXT DEFAULT '',
    date_of_joining DATE,
    date_of_birth DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other') OR gender IS NULL),
    blood_group TEXT,
    emergency_contact JSONB DEFAULT '{}',
    address JSONB DEFAULT '{}',
    bank_details JSONB DEFAULT '{}',
    pan TEXT,
    aadhaar TEXT,
    uan TEXT,
    esi_number TEXT,
    employment_type TEXT DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern', 'consultant')),
    status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'on_notice', 'terminated', 'resigned', 'absconding')),
    reporting_to UUID REFERENCES staging.manav_employees(id),
    shift TEXT DEFAULT 'general',
    created_by UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manav_employees_org ON staging.manav_employees(org_id);
CREATE INDEX idx_manav_employees_user ON staging.manav_employees(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_manav_emp_code ON staging.manav_employees(org_id, employee_code) WHERE employee_code IS NOT NULL;

CREATE TABLE staging.manav_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    head_employee_id UUID REFERENCES staging.manav_employees(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manav_departments_org ON staging.manav_departments(org_id);

CREATE TABLE staging.manav_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id),
    date DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    status TEXT DEFAULT 'present'
        CHECK (status IN ('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend')),
    work_hours DECIMAL(4,2),
    overtime_hours DECIMAL(4,2) DEFAULT 0,
    location JSONB DEFAULT '{}',
    notes TEXT,
    marked_by TEXT DEFAULT 'system'
        CHECK (marked_by IN ('system', 'manual', 'biometric', 'geo')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_manav_attendance_unique ON staging.manav_attendance(employee_id, date);
CREATE INDEX idx_manav_attendance_org ON staging.manav_attendance(org_id, date);

CREATE TABLE staging.manav_leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    annual_quota INTEGER DEFAULT 0,
    is_paid BOOLEAN DEFAULT TRUE,
    carry_forward BOOLEAN DEFAULT FALSE,
    max_carry_forward INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manav_leave_types_org ON staging.manav_leave_types(org_id);

CREATE TABLE staging.manav_leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id),
    leave_type_id UUID NOT NULL REFERENCES staging.manav_leave_types(id),
    year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
    allocated INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    carried_forward INTEGER DEFAULT 0,
    UNIQUE(employee_id, leave_type_id, year)
);

CREATE INDEX idx_manav_leave_bal_emp ON staging.manav_leave_balances(employee_id);

CREATE TABLE staging.manav_leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id),
    leave_type_id UUID NOT NULL REFERENCES staging.manav_leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days DECIMAL(4,1) NOT NULL DEFAULT 1,
    reason TEXT,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manav_leave_req_emp ON staging.manav_leave_requests(employee_id);
CREATE INDEX idx_manav_leave_req_org ON staging.manav_leave_requests(org_id, status);

CREATE TABLE staging.manav_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    is_optional BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manav_holidays_org ON staging.manav_holidays(org_id, date);
