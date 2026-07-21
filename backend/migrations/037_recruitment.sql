-- Manav — Recruitment / applicant tracking (Odoo features plan, Tier 1 #4)

CREATE TABLE IF NOT EXISTS staging.manav_job_openings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    department_id UUID REFERENCES staging.manav_departments(id),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'on_hold', 'closed')),
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_openings_org ON staging.manav_job_openings(org_id);

CREATE TABLE IF NOT EXISTS staging.manav_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    job_opening_id UUID NOT NULL REFERENCES staging.manav_job_openings(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    resume_url TEXT,
    stage TEXT NOT NULL DEFAULT 'applied'
        CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
    notes TEXT,
    rejection_reason TEXT,
    converted_employee_id UUID REFERENCES staging.manav_employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidates_org ON staging.manav_candidates(org_id);
CREATE INDEX IF NOT EXISTS idx_candidates_job ON staging.manav_candidates(job_opening_id);
CREATE INDEX IF NOT EXISTS idx_candidates_stage ON staging.manav_candidates(org_id, stage);
