-- ============================================================
-- Migration 027: E-Sign + Shift Scheduling + Sequences + Report Delivery
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- P0.3 — In-house E-Signature on Contracts
-- ═══════════════════════════════════════════════════════════

ALTER TABLE staging.ganit_contracts
    ADD COLUMN IF NOT EXISTS signature_status TEXT DEFAULT 'none'
        CHECK (signature_status IN ('none','pending','viewed','signed','declined','expired','cancelled')),
    ADD COLUMN IF NOT EXISTS signature_method TEXT DEFAULT 'draw'
        CHECK (signature_method IN ('draw','type','upload')),
    ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT,
    ADD COLUMN IF NOT EXISTS signed_pdf_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signers JSONB DEFAULT '[]';

CREATE TABLE IF NOT EXISTS staging.ganit_contract_signers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES staging.ganit_contracts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    signing_order INT DEFAULT 1,
    token TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending','sent','viewed','signed','declined','expired')),
    ip_address TEXT,
    user_agent TEXT,
    otp_code TEXT,
    otp_attempts INT DEFAULT 0,
    otp_verified_at TIMESTAMPTZ,
    signature_data_url TEXT,
    consent_text TEXT,
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.ganit_contract_audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES staging.ganit_contracts(id) ON DELETE CASCADE,
    signer_id UUID REFERENCES staging.ganit_contract_signers(id),
    event TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gcs_contract ON staging.ganit_contract_signers(contract_id);
CREATE INDEX IF NOT EXISTS idx_gcs_token ON staging.ganit_contract_signers(token);
CREATE INDEX IF NOT EXISTS idx_gcat_contract ON staging.ganit_contract_audit_trail(contract_id);

-- ═══════════════════════════════════════════════════════════
-- P1.1 — Shift Scheduling + Bidding (Manav)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.manav_shift_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INT DEFAULT 0,
    color TEXT DEFAULT '#3B82F6',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, name)
);

CREATE TABLE IF NOT EXISTS staging.manav_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES staging.manav_shift_definitions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','confirmed','completed','absent','swapped')),
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS staging.manav_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    preferred_shift_id UUID REFERENCES staging.manav_shift_definitions(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS staging.manav_shift_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES staging.manav_shift_definitions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    slots_needed INT DEFAULT 1,
    status TEXT DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.manav_shift_bid_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id UUID NOT NULL REFERENCES staging.manav_shift_bids(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'applied' CHECK (status IN ('applied','accepted','rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bid_id, employee_id)
);

CREATE TABLE IF NOT EXISTS staging.manav_swap_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    requester_schedule_id UUID NOT NULL REFERENCES staging.manav_schedules(id),
    target_schedule_id UUID REFERENCES staging.manav_schedules(id),
    target_employee_id UUID REFERENCES staging.manav_employees(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    approved_by TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ms_org_date ON staging.manav_schedules(org_id, date);
CREATE INDEX IF NOT EXISTS idx_ms_emp_date ON staging.manav_schedules(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_msb_org ON staging.manav_shift_bids(org_id, status);

-- ═══════════════════════════════════════════════════════════
-- P1.2 — Sequences / Cadences (Prachar)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.prachar_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
    exit_on_reply BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.prachar_sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES staging.prachar_sequences(id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp','call_task','manual')),
    delay_days INT DEFAULT 1,
    subject TEXT,
    body_html TEXT,
    body_text TEXT,
    template_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(sequence_id, step_order)
);

CREATE TABLE IF NOT EXISTS staging.prachar_sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES staging.prachar_sequences(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES staging.graha_contacts(id) ON DELETE CASCADE,
    current_step INT DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','replied','bounced','unsubscribed','paused','manual_exit')),
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    next_step_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE(sequence_id, contact_id)
);

CREATE TABLE IF NOT EXISTS staging.prachar_sequence_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES staging.prachar_sequence_enrollments(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES staging.prachar_sequence_steps(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent','delivered','opened','clicked','replied','bounced','failed')),
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_pse_seq ON staging.prachar_sequence_enrollments(sequence_id, status);
CREATE INDEX IF NOT EXISTS idx_pse_next ON staging.prachar_sequence_enrollments(next_step_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_psl_enrollment ON staging.prachar_sequence_logs(enrollment_id);

-- ═══════════════════════════════════════════════════════════
-- P1.3 — Scheduled Report Delivery (Dristi)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.dristi_scheduled_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    dashboard_id UUID REFERENCES staging.dristi_dashboards(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('overview','revenue','pipeline','hr','sales','custom')),
    frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
    day_of_week INT,
    day_of_month INT,
    time_utc TIME DEFAULT '08:00',
    file_formats TEXT[] DEFAULT '{pdf}',
    recipients TEXT[] NOT NULL,
    filters JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    last_sent_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.dristi_report_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_report_id UUID NOT NULL REFERENCES staging.dristi_scheduled_reports(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
    file_urls TEXT[],
    recipients_count INT DEFAULT 0,
    error TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_org ON staging.dristi_scheduled_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_drl_report ON staging.dristi_report_logs(scheduled_report_id);
