# Payroll & Compliance Module — Implementation Guide

> **Target**: Q4 2026 | **Dependencies**: HRMS Module (hr_employees, hr_attendance)
> **Stack**: FastAPI, Supabase PostgreSQL, React 19
> **Branch**: `feature/payroll-module`

---

## 1. Database Migration

Create `backend/migrations/012_payroll_module.sql`:

```sql
-- ============================================================
-- Migration 012: Payroll & Compliance Module
-- Requires: 011_hrms_module.sql (hr_employees, hr_attendance)
-- ============================================================

-- 1. Salary Structures
CREATE TABLE hr_salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    
    -- Labour Code 2026: basic must be >= 50% of CTC
    basic_pct DECIMAL(5,2) NOT NULL DEFAULT 50.00 CHECK (basic_pct >= 50.00),
    hra_pct DECIMAL(5,2) DEFAULT 20.00,
    conveyance DECIMAL(10,2) DEFAULT 1600,
    medical DECIMAL(10,2) DEFAULT 1250,
    special_allowance DECIMAL(10,2) DEFAULT 0,
    other_allowances JSONB DEFAULT '{}',
    
    pf_employer_contribution_pct DECIMAL(5,2) DEFAULT 12.00,
    esi_employer_contribution_pct DECIMAL(5,2) DEFAULT 3.25,
    
    is_current BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hr_ss_emp ON hr_salary_structures(employee_id);
CREATE UNIQUE INDEX idx_hr_ss_current ON hr_salary_structures(employee_id) WHERE is_current = TRUE;

-- 2. Pay Runs
CREATE TABLE pay_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'processing', 'computed', 'approved', 'paid', 'cancelled')),
    total_gross DECIMAL(15,2) DEFAULT 0,
    total_deductions DECIMAL(15,2) DEFAULT 0,
    total_net DECIMAL(15,2) DEFAULT 0,
    employee_count INTEGER DEFAULT 0,
    run_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, month, year)
);

-- 3. Pay Slips
CREATE TABLE pay_slips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    pay_run_id UUID NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    working_days INTEGER NOT NULL,
    present_days DECIMAL(4,1) NOT NULL,
    loss_of_pay_days DECIMAL(4,1) DEFAULT 0,
    earnings JSONB NOT NULL DEFAULT '{}',
    deductions JSONB NOT NULL DEFAULT '{}',
    gross DECIMAL(12,2) NOT NULL,
    total_deductions DECIMAL(12,2) NOT NULL,
    net_pay DECIMAL(12,2) NOT NULL,
    status TEXT DEFAULT 'computed' CHECK (status IN ('computed', 'approved', 'paid')),
    bank_account JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pay_slips_run ON pay_slips(pay_run_id);
CREATE INDEX idx_pay_slips_emp ON pay_slips(employee_id);
CREATE UNIQUE INDEX idx_pay_slips_unique ON pay_slips(employee_id, month, year);

-- 4. PF Records
CREATE TABLE pay_pf_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    pay_slip_id UUID REFERENCES pay_slips(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    employee_contribution DECIMAL(10,2) NOT NULL,
    employer_contribution DECIMAL(10,2) NOT NULL,
    eps_contribution DECIMAL(10,2) NOT NULL,        -- 8.33% of basic, max ₹1,250/mo
    edli_contribution DECIMAL(10,2) DEFAULT 0,
    admin_charges DECIMAL(10,2) DEFAULT 0,
    uan VARCHAR(12),
    pf_number VARCHAR(22),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pf_records_emp ON pay_pf_records(employee_id, year);

-- 5. ESI Records (applicable only if gross <= ₹21,000/month)
CREATE TABLE pay_esi_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    pay_slip_id UUID REFERENCES pay_slips(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    employee_contribution DECIMAL(10,2) NOT NULL,   -- 0.75% of gross
    employer_contribution DECIMAL(10,2) NOT NULL,   -- 3.25% of gross
    ip_number VARCHAR(17),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TDS Records
CREATE TABLE pay_tds_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    pay_slip_id UUID REFERENCES pay_slips(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    taxable_income_ytd DECIMAL(12,2) NOT NULL,
    tax_computed_ytd DECIMAL(12,2) NOT NULL,
    tax_deducted_this_month DECIMAL(12,2) NOT NULL,
    regime TEXT NOT NULL CHECK (regime IN ('old', 'new')),
    declarations_considered JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. IT Declarations
CREATE TABLE pay_it_declarations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    fiscal_year VARCHAR(7) NOT NULL,
    regime TEXT NOT NULL DEFAULT 'new' CHECK (regime IN ('old', 'new')),
    declarations JSONB DEFAULT '{}',
    proof_status TEXT DEFAULT 'pending' CHECK (proof_status IN ('pending', 'submitted', 'verified')),
    submitted_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id),
    UNIQUE(employee_id, fiscal_year)
);

-- 8. Loans
CREATE TABLE pay_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    type TEXT NOT NULL CHECK (type IN ('salary_advance', 'personal_loan')),
    principal DECIMAL(12,2) NOT NULL,
    interest_rate DECIMAL(5,2) DEFAULT 0,
    emi DECIMAL(10,2) NOT NULL,
    tenure_months INTEGER NOT NULL,
    disbursed_date DATE NOT NULL,
    outstanding DECIMAL(12,2) NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    deduction_start_month DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pay_loans_emp ON pay_loans(employee_id, status);

-- 9. Professional Tax (state-wise slabs)
CREATE TABLE pay_professional_tax (
    id SERIAL PRIMARY KEY,
    state_code VARCHAR(2) NOT NULL,
    state_name TEXT NOT NULL,
    slab_from DECIMAL(10,2) NOT NULL,
    slab_to DECIMAL(10,2),
    monthly_tax DECIMAL(8,2) NOT NULL,
    effective_from DATE DEFAULT '2024-04-01'
);

INSERT INTO pay_professional_tax (state_code, state_name, slab_from, slab_to, monthly_tax) VALUES
('27', 'Maharashtra', 0, 7500, 0),
('27', 'Maharashtra', 7501, 10000, 175),
('27', 'Maharashtra', 10001, NULL, 200),
('24', 'Gujarat', 0, 5999, 0),
('24', 'Gujarat', 6000, 8999, 80),
('24', 'Gujarat', 9000, 11999, 150),
('24', 'Gujarat', 12000, NULL, 200),
('29', 'Karnataka', 0, 14999, 0),
('29', 'Karnataka', 15000, NULL, 200);

-- 10. RLS
ALTER TABLE hr_salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_pf_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_esi_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_tds_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_it_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY ss_org ON hr_salary_structures USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY pr_org ON pay_runs USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY ps_org ON pay_slips USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY pf_org ON pay_pf_records USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY esi_org ON pay_esi_records USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY tds_org ON pay_tds_records USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY itd_org ON pay_it_declarations USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY loan_org ON pay_loans USING (org_id = current_setting('app.current_org_id')::uuid);
```

---

## 2. Backend — FastAPI Router

Create `backend/routers/payroll.py`:

```python
"""
Payroll & Compliance Router
Pay runs, payslips, PF/ESI/TDS computation, IT declarations, loans
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel
from ..dependencies import get_current_user, get_db
from ..middleware.subscription import require_module

router = APIRouter(
    prefix="/api/v1/payroll",
    tags=["Payroll"],
    dependencies=[Depends(require_module("payroll"))]
)


# ── Pydantic Models ──────────────────────────────────────────

class PayRunCreate(BaseModel):
    month: int
    year: int

class LoanCreate(BaseModel):
    employee_id: UUID
    type: str
    principal: Decimal
    interest_rate: Decimal = 0
    emi: Decimal
    tenure_months: int
    disbursed_date: date
    deduction_start_month: date

class ITDeclarationSubmit(BaseModel):
    fiscal_year: str
    regime: str = "new"
    declarations: dict = {}


# ── Pay Runs ─────────────────────────────────────────────────

@router.post("/runs")
async def create_pay_run(body: PayRunCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Create a new pay run for a month/year."""
    existing = db.table("pay_runs").select("id").eq("org_id", str(user.org_id)).eq("month", body.month).eq("year", body.year).execute()
    if existing.data:
        raise HTTPException(400, f"Pay run exists for {body.month}/{body.year}")
    data = {"org_id": str(user.org_id), "month": body.month, "year": body.year, "status": "draft", "run_by": str(user.id)}
    return db.table("pay_runs").insert(data).execute().data[0]


@router.post("/runs/{run_id}/compute")
async def compute_pay_run(run_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    """Compute all payslips for a pay run."""
    run = db.table("pay_runs").select("*").eq("id", str(run_id)).eq("org_id", str(user.org_id)).single().execute()
    if run.data["status"] not in ("draft", "computed"):
        raise HTTPException(400, "Cannot recompute in current status")
    
    db.table("pay_runs").update({"status": "processing"}).eq("id", str(run_id)).execute()
    
    employees = db.table("hr_employees").select("*").eq("org_id", str(user.org_id)).eq("status", "active").execute()
    
    total_gross = total_deductions = total_net = 0
    count = 0
    
    for emp in employees.data:
        slip = await compute_payslip(emp, run.data["month"], run.data["year"], run_id, user.org_id, db)
        if slip:
            total_gross += slip["gross"]
            total_deductions += slip["total_deductions"]
            total_net += slip["net_pay"]
            count += 1
    
    db.table("pay_runs").update({
        "status": "computed", "total_gross": total_gross,
        "total_deductions": total_deductions, "total_net": total_net,
        "employee_count": count
    }).eq("id", str(run_id)).execute()
    
    return {"status": "computed", "employee_count": count, "total_net": total_net}


@router.get("/runs/{run_id}")
async def get_pay_run(run_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    run = db.table("pay_runs").select("*").eq("id", str(run_id)).eq("org_id", str(user.org_id)).single().execute()
    slips = db.table("pay_slips").select("*, hr_employees(first_name, last_name, employee_code, department)").eq("pay_run_id", str(run_id)).execute()
    return {**run.data, "slips": slips.data}


@router.patch("/runs/{run_id}/approve")
async def approve_pay_run(run_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    run = db.table("pay_runs").select("status").eq("id", str(run_id)).single().execute()
    if run.data["status"] != "computed":
        raise HTTPException(400, "Must be computed before approval")
    db.table("pay_runs").update({"status": "approved", "approved_by": str(user.id), "approved_at": datetime.utcnow().isoformat()}).eq("id", str(run_id)).execute()
    db.table("pay_slips").update({"status": "approved"}).eq("pay_run_id", str(run_id)).execute()
    return {"status": "approved"}


@router.patch("/runs/{run_id}/mark-paid")
async def mark_paid(run_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    run = db.table("pay_runs").select("status").eq("id", str(run_id)).single().execute()
    if run.data["status"] != "approved":
        raise HTTPException(400, "Must be approved before marking paid")
    db.table("pay_runs").update({"status": "paid", "paid_at": datetime.utcnow().isoformat()}).eq("id", str(run_id)).execute()
    db.table("pay_slips").update({"status": "paid"}).eq("pay_run_id", str(run_id)).execute()
    await _process_loan_deductions(run_id, db)
    return {"status": "paid"}


# ── Core Computation Engine ──────────────────────────────────

async def compute_payslip(emp: dict, month: int, year: int, run_id: UUID, org_id: UUID, db) -> dict:
    """
    Compute one employee's payslip.
    
    1. Get salary structure
    2. Calculate working/present days from hr_attendance
    3. Pro-rate salary for LOP days
    4. PF: 12% of basic, capped at ₹15,000 basic
    5. ESI: 0.75% EE + 3.25% ER if gross ≤ ₹21,000
    6. Professional Tax: state-wise slabs
    7. TDS: regime-based, YTD projection
    8. Loan EMI deduction
    """
    # 1. Salary structure
    ss = db.table("hr_salary_structures").select("*").eq("employee_id", emp["id"]).eq("is_current", True).execute()
    if not ss.data:
        return None
    ss = ss.data[0]
    
    ctc_monthly = float(emp.get("ctc") or 0) / 12
    if ctc_monthly == 0:
        return None
    
    basic_full = ctc_monthly * float(ss["basic_pct"]) / 100
    hra_full = basic_full * float(ss["hra_pct"]) / 100
    
    # 2. Attendance
    from_dt = date(year, month, 1)
    next_m = month + 1 if month < 12 else 1
    next_y = year if month < 12 else year + 1
    to_dt = date(next_y, next_m, 1)
    
    att = db.table("hr_attendance").select("status").eq("employee_id", emp["id"]).gte("date", from_dt.isoformat()).lt("date", to_dt.isoformat()).execute()
    
    working_days = sum(1 for a in att.data if a["status"] not in ("holiday", "week_off"))
    present = sum(1 for a in att.data if a["status"] in ("present", "on_leave"))
    half = sum(1 for a in att.data if a["status"] == "half_day")
    present += half * 0.5
    working_days = working_days or 26
    lop = max(0, working_days - present)
    
    # 3. Pro-rate
    ratio = 1 - (lop / working_days)
    basic = round(basic_full * ratio, 2)
    hra = round(hra_full * ratio, 2)
    conv = round(float(ss["conveyance"]) * ratio, 2)
    med = round(float(ss["medical"]) * ratio, 2)
    special = round(float(ss["special_allowance"]) * ratio, 2)
    
    gross = basic + hra + conv + med + special
    earnings = {"basic": basic, "hra": hra, "conveyance": conv, "medical": med, "special_allowance": special}
    deductions = {}
    
    # 4. PF
    pf_basic = min(basic, 15000)
    pf_ee = round(pf_basic * 0.12, 2)
    pf_er = round(pf_basic * 0.12, 2)
    eps = min(round(pf_basic * 0.0833, 2), 1250)
    deductions["pf_employee"] = pf_ee
    deductions["pf_employer"] = pf_er
    
    # 5. ESI
    esi_ee = esi_er = 0
    if gross <= 21000:
        esi_ee = round(gross * 0.0075, 2)
        esi_er = round(gross * 0.0325, 2)
    deductions["esi_employee"] = esi_ee
    deductions["esi_employer"] = esi_er
    
    # 6. Professional Tax
    state_code = "27"  # from org settings
    pt_slabs = db.table("pay_professional_tax").select("monthly_tax").eq("state_code", state_code).lte("slab_from", gross).execute()
    pt = max((float(s["monthly_tax"]) for s in pt_slabs.data), default=0)
    deductions["professional_tax"] = pt
    
    # 7. TDS
    tds = await _compute_tds(emp, gross * 12, month, year, org_id, db)
    deductions["tds"] = tds
    
    # 8. Loan EMI
    loans = db.table("pay_loans").select("emi").eq("employee_id", emp["id"]).eq("status", "active").execute()
    loan_ded = sum(float(l["emi"]) for l in loans.data)
    deductions["loan_deduction"] = loan_ded
    
    total_ded = pf_ee + esi_ee + pt + tds + loan_ded
    net = gross - total_ded
    
    slip_data = {
        "org_id": str(org_id), "pay_run_id": str(run_id),
        "employee_id": emp["id"], "month": month, "year": year,
        "working_days": working_days, "present_days": present,
        "loss_of_pay_days": lop, "earnings": earnings, "deductions": deductions,
        "gross": gross, "total_deductions": total_ded, "net_pay": net,
        "status": "computed", "bank_account": emp.get("bank_account")
    }
    
    existing = db.table("pay_slips").select("id").eq("employee_id", emp["id"]).eq("month", month).eq("year", year).execute()
    if existing.data:
        db.table("pay_slips").update(slip_data).eq("id", existing.data[0]["id"]).execute()
        slip_data["id"] = existing.data[0]["id"]
    else:
        result = db.table("pay_slips").insert(slip_data).execute()
        slip_data["id"] = result.data[0]["id"]
    
    # Insert PF record
    db.table("pay_pf_records").upsert({
        "org_id": str(org_id), "pay_slip_id": slip_data["id"],
        "employee_id": emp["id"], "month": month, "year": year,
        "employee_contribution": pf_ee, "employer_contribution": pf_er,
        "eps_contribution": eps,
        "edli_contribution": round(min(pf_basic * 0.005, 75), 2),
        "admin_charges": round(pf_basic * 0.005, 2),
        "uan": emp.get("uan"), "pf_number": emp.get("pf_number")
    }).execute()
    
    # Insert ESI record if applicable
    if gross <= 21000:
        db.table("pay_esi_records").upsert({
            "org_id": str(org_id), "pay_slip_id": slip_data["id"],
            "employee_id": emp["id"], "month": month, "year": year,
            "employee_contribution": esi_ee, "employer_contribution": esi_er,
            "ip_number": emp.get("esi_number")
        }).execute()
    
    return slip_data


async def _compute_tds(emp, annual_gross, month, year, org_id, db):
    """Monthly TDS based on regime. New regime default."""
    fy = f"{year}-{str(year+1)[-2:]}" if month >= 4 else f"{year-1}-{str(year)[-2:]}"
    decl = db.table("pay_it_declarations").select("*").eq("employee_id", emp["id"]).eq("fiscal_year", fy).execute()
    
    regime = decl.data[0]["regime"] if decl.data else "new"
    taxable = annual_gross - 75000  # standard deduction
    
    if regime == "old" and decl.data:
        d = decl.data[0].get("declarations", {})
        taxable -= min(d.get("section_80c", 0), 150000)
        taxable -= min(d.get("section_80d", 0), 25000)
        taxable -= d.get("hra_exemption", 0)
        taxable -= min(d.get("nps_80ccd", 0), 50000)
        taxable -= min(d.get("home_loan_interest", 0), 200000)
    
    taxable = max(0, taxable)
    tax = _new_regime_tax(taxable) if regime == "new" else _old_regime_tax(taxable)
    tax *= 1.04  # 4% cess
    return round(tax / 12, 2)


def _new_regime_tax(taxable):
    """New regime slabs (FY 2025-26+): 0-3L:0%, 3-7L:5%, 7-10L:10%, 10-12L:15%, 12-15L:20%, >15L:30%"""
    slabs = [(300000, 0), (400000, 0.05), (300000, 0.10), (200000, 0.15), (300000, 0.20), (float('inf'), 0.30)]
    tax, rem = 0, taxable
    for amt, rate in slabs:
        if rem <= 0: break
        tax += min(rem, amt) * rate
        rem -= amt
    return 0 if taxable <= 700000 else tax  # rebate u/s 87A


def _old_regime_tax(taxable):
    slabs = [(250000, 0), (250000, 0.05), (500000, 0.20), (float('inf'), 0.30)]
    tax, rem = 0, taxable
    for amt, rate in slabs:
        if rem <= 0: break
        tax += min(rem, amt) * rate
        rem -= amt
    return 0 if taxable <= 500000 else tax


async def _process_loan_deductions(run_id, db):
    """After pay run paid, reduce loan outstanding. Close if fully repaid."""
    slips = db.table("pay_slips").select("employee_id, deductions").eq("pay_run_id", str(run_id)).execute()
    for slip in slips.data:
        if slip["deductions"].get("loan_deduction", 0) > 0:
            loans = db.table("pay_loans").select("id, outstanding, emi").eq("employee_id", slip["employee_id"]).eq("status", "active").execute()
            for loan in loans.data:
                new_out = float(loan["outstanding"]) - float(loan["emi"])
                if new_out <= 0:
                    db.table("pay_loans").update({"outstanding": 0, "status": "closed"}).eq("id", loan["id"]).execute()
                else:
                    db.table("pay_loans").update({"outstanding": new_out}).eq("id", loan["id"]).execute()


# ── Payslips ─────────────────────────────────────────────────

@router.get("/slips/{employee_id}")
async def employee_payslips(employee_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    return {"data": db.table("pay_slips").select("*").eq("employee_id", str(employee_id)).eq("org_id", str(user.org_id)).order("year", desc=True).order("month", desc=True).execute().data}

@router.get("/slips/{slip_id}/pdf")
async def payslip_pdf(slip_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    # TODO: Generate PDF via weasyprint, upload to R2
    return {"pdf_url": f"https://r2.kartavaya.com/payslips/{slip_id}.pdf"}


# ── IT Declarations ──────────────────────────────────────────

@router.get("/declarations")
async def get_declarations(employee_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    return {"data": db.table("pay_it_declarations").select("*").eq("employee_id", str(employee_id)).execute().data}

@router.post("/declarations")
async def submit_declaration(body: ITDeclarationSubmit, user=Depends(get_current_user), db=Depends(get_db)):
    emp = db.table("hr_employees").select("id").eq("user_id", str(user.id)).single().execute()
    return db.table("pay_it_declarations").upsert({
        "org_id": str(user.org_id), "employee_id": emp.data["id"],
        "fiscal_year": body.fiscal_year, "regime": body.regime,
        "declarations": body.declarations, "proof_status": "pending",
        "submitted_at": datetime.utcnow().isoformat()
    }).execute().data[0]


# ── Loans ────────────────────────────────────────────────────

@router.post("/loans")
async def create_loan(body: LoanCreate, user=Depends(get_current_user), db=Depends(get_db)):
    data = body.model_dump()
    data["org_id"] = str(user.org_id)
    data["outstanding"] = float(body.principal)
    return db.table("pay_loans").insert(data).execute().data[0]


# ── Reports ──────────────────────────────────────────────────

@router.get("/reports/pf-ecr")
async def pf_ecr(month: int, year: int, user=Depends(get_current_user), db=Depends(get_db)):
    """PF ECR file for EPFO upload."""
    records = db.table("pay_pf_records").select("*, hr_employees(first_name, last_name, uan)").eq("org_id", str(user.org_id)).eq("month", month).eq("year", year).execute()
    lines = []
    for r in records.data:
        e = r["hr_employees"]
        lines.append(f"{e['uan']}#{e['first_name']} {e.get('last_name','')}#0#{r['employee_contribution']}#{r['employer_contribution']}#{r['eps_contribution']}")
    return {"ecr_text": "\n".join(lines), "count": len(lines)}

@router.get("/reports/form130")
async def form130(employee_id: UUID, fiscal_year: str, user=Depends(get_current_user), db=Depends(get_db)):
    """Form 130 (replaces Form 16 under Labour Code 2026)."""
    fy_start = int(fiscal_year[:4])
    slips = db.table("pay_slips").select("*").eq("employee_id", str(employee_id)).eq("org_id", str(user.org_id)).execute()
    fy_slips = [s for s in slips.data if (s["year"] == fy_start and s["month"] >= 4) or (s["year"] == fy_start + 1 and s["month"] <= 3)]
    return {
        "fiscal_year": fiscal_year,
        "total_gross": sum(s["gross"] for s in fy_slips),
        "total_tds": sum(s["deductions"].get("tds", 0) for s in fy_slips),
        "total_pf": sum(s["deductions"].get("pf_employee", 0) for s in fy_slips),
        "monthly_breakdown": fy_slips
    }
```

---

## 3. Frontend — React Components

```
src/
  pages/
    PayrollPage.jsx             # Tabs: Pay Runs | Structures | Declarations | Loans
  components/
    payroll/
      PayRunList.jsx            # All pay runs with status badges
      PayRunWizard.jsx          # Select Month → Preview → Compute → Review → Approve → Pay
      PaySlipView.jsx           # Earnings/deductions breakdown for one employee
      PaySlipTable.jsx          # All slips in a pay run
      SalaryStructureForm.jsx   # Basic%, HRA%, allowances editor
      ITDeclarationForm.jsx     # Regime picker + 80C/80D/HRA sections
      LoanManager.jsx           # Create loans, EMI schedule, active/closed
      PayrollDashboard.jsx      # Monthly cost trend (Recharts)
      PFESISummary.jsx          # PF/ESI totals for compliance
      Form130Viewer.jsx         # Form 130 preview + PDF download
  hooks/
    usePayroll.js               # React Query hooks
```

### `usePayroll.js`

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';

export const usePayRuns = () =>
  useQuery(['pay-runs'], () => api.get('/api/v1/payroll/runs'));

export const useCreatePayRun = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/payroll/runs', data), {
    onSuccess: () => qc.invalidateQueries(['pay-runs']),
  });
};

export const useComputePayRun = () => {
  const qc = useQueryClient();
  return useMutation(runId => api.post(`/api/v1/payroll/runs/${runId}/compute`), {
    onSuccess: () => qc.invalidateQueries(['pay-runs']),
  });
};

export const useApprovePayRun = () => {
  const qc = useQueryClient();
  return useMutation(runId => api.patch(`/api/v1/payroll/runs/${runId}/approve`), {
    onSuccess: () => qc.invalidateQueries(['pay-runs']),
  });
};

export const usePaySlips = (employeeId) =>
  useQuery(['pay-slips', employeeId], () => api.get(`/api/v1/payroll/slips/${employeeId}`));
```

---

## 4. Compliance Rules

| Rule | Detail |
|------|--------|
| Basic ≥ 50% CTC | Labour Code 2026. DB constraint enforces. |
| PF basic cap | Contributions on min(basic, ₹15,000). Voluntary higher allowed. |
| EPS cap | 8.33% of basic, max ₹1,250/month |
| ESI threshold | Only if gross ≤ ₹21,000. EE: 0.75%, ER: 3.25% |
| Professional Tax | State-wise. MH: ₹200/mo (₹300 Feb). Max ₹2,500/yr |
| TDS | New regime default. Std deduction ₹75K. Rebate ≤ ₹7L |
| Form 130 | Replaces Form 16. Annual tax cert for employees |

---

## 5. Implementation Steps

1. `git checkout -b feature/payroll-module`
2. Run `012_payroll_module.sql` (depends on 011)
3. Seed PT slabs for MH, GJ, KA
4. Create salary structures for existing employees
5. Build `compute_payslip()` engine with PF/ESI/PT/TDS
6. Build `PayRunWizard` UI
7. IT Declarations form with regime comparison
8. PF ECR export + Form 130 generation
9. Payslip PDF via weasyprint → R2
10. Tests

---

## 6. Test Cases

```python
# tests/test_payroll.py

async def test_basic_50pct_enforcement():
    """Verify basic_pct < 50 raises DB constraint error."""

async def test_pf_at_cap():
    """Basic ₹25,000 → PF computed on ₹15,000. EE PF = ₹1,800."""

async def test_pf_below_cap():
    """Basic ₹12,000 → PF on ₹12,000. EE PF = ₹1,440."""

async def test_eps_max_1250():
    """EPS capped at ₹1,250/month regardless of basic."""

async def test_esi_above_threshold():
    """Gross ₹25,000 → ESI = 0."""

async def test_esi_below_threshold():
    """Gross ₹18,000 → ESI EE = ₹135, ER = ₹585."""

async def test_pt_maharashtra():
    """Gross ₹15,000, state MH → PT = ₹200."""

async def test_lop_proration():
    """26 working days, 4 LOP → salary * 22/26."""

async def test_tds_new_regime_under_7l():
    """Annual ₹6.5L - ₹75K std ded = ₹5.75L → rebate → TDS = 0."""

async def test_tds_old_regime_with_80c():
    """Annual ₹12L, 80C ₹1.5L, 80D ₹25K → lower TDS."""

async def test_loan_emi_deduction():
    """Active loan EMI ₹5,000 → deducted from net."""

async def test_loan_auto_close():
    """Outstanding ₹3,000, EMI ₹5,000 → status=closed after pay run."""

async def test_ecr_format():
    """ECR output matches EPFO format."""

async def test_form130_aggregation():
    """Form 130 sums 12 months correctly."""
```
