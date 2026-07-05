# HRMS Module — Implementation Guide

> **Target**: Q3 2026 | **Dependencies**: Core Platform | **Merges**: AekamSentinel
> **Stack**: FastAPI, Supabase PostgreSQL, React 19, Cloudflare R2
> **Branch**: `feature/hrms-module`

---

## 1. Database Migration

Create `backend/migrations/011_hrms_module.sql`:

```sql
-- ============================================================
-- Migration 011: HRMS Module (merges AekamSentinel)
-- ============================================================

-- 1. Employees
CREATE TABLE hr_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    employee_code VARCHAR(20) NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    date_of_birth DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    date_of_joining DATE NOT NULL,
    date_of_exit DATE,
    department TEXT,
    designation TEXT,
    reporting_to UUID REFERENCES hr_employees(id),
    employment_type TEXT NOT NULL DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'on_notice', 'exited')),
    
    -- Statutory
    pf_number VARCHAR(22),
    esi_number VARCHAR(17),
    uan VARCHAR(12),
    pan VARCHAR(10),
    aadhaar_hash VARCHAR(64),       -- SHA-256 hash only (DPDP Act compliance)
    
    -- Compensation
    bank_account JSONB,             -- {account_no, ifsc, bank_name, branch}
    ctc DECIMAL(12,2),
    basic_salary DECIMAL(12,2),
    
    -- Flexible
    custom_fields JSONB DEFAULT '{}',
    profile_photo_url TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_hr_emp_code ON hr_employees(org_id, employee_code);
CREATE INDEX idx_hr_emp_org ON hr_employees(org_id);
CREATE INDEX idx_hr_emp_dept ON hr_employees(org_id, department);
CREATE INDEX idx_hr_emp_status ON hr_employees(org_id, status);
CREATE INDEX idx_hr_emp_reporting ON hr_employees(reporting_to);

-- 2. Shifts
CREATE TABLE hr_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    grace_minutes INTEGER DEFAULT 15,
    is_night_shift BOOLEAN DEFAULT FALSE,
    break_minutes INTEGER DEFAULT 30,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hr_shifts_org ON hr_shifts(org_id);

-- 3. Attendance (core of AekamSentinel merge)
CREATE TABLE hr_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift_id UUID REFERENCES hr_shifts(id),
    
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    
    status TEXT NOT NULL DEFAULT 'absent'
        CHECK (status IN ('present', 'absent', 'half_day', 'on_leave', 'holiday', 'week_off')),
    
    -- Verification (4 methods from AekamSentinel)
    verification_method TEXT
        CHECK (verification_method IN ('facial', 'fingerprint', 'geo_photo', 'pin_gps')),
    verification_data JSONB,
    -- facial:      {photo_url, confidence_score, model_version}
    -- fingerprint: {device_id, template_hash, match_score}
    -- geo_photo:   {photo_url, lat, lng, accuracy_meters, distance_from_office}
    -- pin_gps:     {lat, lng, accuracy_meters, distance_from_office}
    
    hours_worked DECIMAL(4,2),
    overtime_hours DECIMAL(4,2) DEFAULT 0,
    late_by_minutes INTEGER DEFAULT 0,
    early_exit_minutes INTEGER DEFAULT 0,
    
    -- Regularization
    regularization_status TEXT DEFAULT 'none'
        CHECK (regularization_status IN ('none', 'pending', 'approved', 'rejected')),
    regularization_reason TEXT,
    regularized_by UUID REFERENCES users(id),
    regularized_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_hr_att_emp_date ON hr_attendance(employee_id, date);
CREATE INDEX idx_hr_att_org_date ON hr_attendance(org_id, date);
CREATE INDEX idx_hr_att_status ON hr_attendance(org_id, date, status);

-- 4. Leave Types
CREATE TABLE hr_leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code VARCHAR(10) NOT NULL,          -- CL, SL, PL, ML, etc.
    is_paid BOOLEAN DEFAULT TRUE,
    annual_quota INTEGER NOT NULL,
    carry_forward BOOLEAN DEFAULT FALSE,
    max_carry_forward INTEGER DEFAULT 0,
    encashable BOOLEAN DEFAULT FALSE,
    applicable_to JSONB DEFAULT '{}',   -- {gender: ["female"], employment_type: ["full_time"]}
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_hr_lt_code ON hr_leave_types(org_id, code);

-- 5. Leave Requests
CREATE TABLE hr_leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    leave_type_id UUID NOT NULL REFERENCES hr_leave_types(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days DECIMAL(3,1) NOT NULL,         -- supports half-day (0.5)
    reason TEXT,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hr_leave_emp ON hr_leave_requests(employee_id);
CREATE INDEX idx_hr_leave_status ON hr_leave_requests(org_id, status);
CREATE INDEX idx_hr_leave_dates ON hr_leave_requests(from_date, to_date);

-- 6. Leave Balances
CREATE TABLE hr_leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    leave_type_id UUID NOT NULL REFERENCES hr_leave_types(id),
    year INTEGER NOT NULL,
    opening DECIMAL(4,1) DEFAULT 0,
    accrued DECIMAL(4,1) DEFAULT 0,
    taken DECIMAL(4,1) DEFAULT 0,
    balance DECIMAL(4,1) GENERATED ALWAYS AS (opening + accrued - taken) STORED,
    
    UNIQUE(employee_id, leave_type_id, year)
);

CREATE INDEX idx_hr_lb_emp ON hr_leave_balances(employee_id, year);

-- 7. Documents
CREATE TABLE hr_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr_employees(id),
    type TEXT NOT NULL
        CHECK (type IN ('offer_letter', 'appointment', 'payslip', 'form16', 'form130',
                        'id_proof', 'address_proof', 'experience_letter', 'other')),
    name TEXT NOT NULL,
    file_url TEXT NOT NULL,             -- R2 URL
    file_size INTEGER,
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hr_docs_emp ON hr_documents(employee_id);

-- 8. Holidays
CREATE TABLE hr_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    name TEXT NOT NULL,
    is_optional BOOLEAN DEFAULT FALSE,
    year INTEGER NOT NULL,
    UNIQUE(org_id, date)
);

CREATE INDEX idx_hr_holidays_year ON hr_holidays(org_id, year);

-- 9. Office Locations (for geo-fence verification)
CREATE TABLE hr_office_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    radius_meters INTEGER DEFAULT 200,
    is_active BOOLEAN DEFAULT TRUE
);

-- 10. RLS Policies
ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_office_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_employees_org ON hr_employees USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_shifts_org ON hr_shifts USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_attendance_org ON hr_attendance USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_leave_types_org ON hr_leave_types USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_leave_requests_org ON hr_leave_requests USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_leave_balances_org ON hr_leave_balances USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_documents_org ON hr_documents USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_holidays_org ON hr_holidays USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY hr_office_org ON hr_office_locations USING (org_id = current_setting('app.current_org_id')::uuid);

-- 11. Auto-calculate late/early/hours on check-in/check-out
CREATE OR REPLACE FUNCTION hr_calculate_attendance_metrics()
RETURNS TRIGGER AS $$
DECLARE
    v_shift RECORD;
    v_expected_start TIMESTAMPTZ;
BEGIN
    IF NEW.check_in IS NOT NULL AND NEW.shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM hr_shifts WHERE id = NEW.shift_id;
        v_expected_start := NEW.date + v_shift.start_time;
        
        IF NEW.check_in > (v_expected_start + (v_shift.grace_minutes || ' minutes')::interval) THEN
            NEW.late_by_minutes := EXTRACT(EPOCH FROM (NEW.check_in - v_expected_start)) / 60;
        END IF;
        NEW.status := 'present';
    END IF;
    
    IF NEW.check_in IS NOT NULL AND NEW.check_out IS NOT NULL THEN
        NEW.hours_worked := EXTRACT(EPOCH FROM (NEW.check_out - NEW.check_in)) / 3600;
        IF NEW.hours_worked > 9 THEN
            NEW.overtime_hours := NEW.hours_worked - 9;
        END IF;
        IF NEW.hours_worked < 4 THEN
            NEW.status := 'half_day';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_metrics
    BEFORE INSERT OR UPDATE ON hr_attendance
    FOR EACH ROW EXECUTE FUNCTION hr_calculate_attendance_metrics();

-- 12. Leave balance deduction helper
CREATE OR REPLACE FUNCTION hr_deduct_leave_balance(
    p_employee_id UUID, p_leave_type_id UUID, p_year INTEGER, p_days DECIMAL
) RETURNS VOID AS $$
BEGIN
    UPDATE hr_leave_balances
    SET taken = taken + p_days
    WHERE employee_id = p_employee_id
      AND leave_type_id = p_leave_type_id
      AND year = p_year;
END;
$$ LANGUAGE plpgsql;
```

---

## 2. Backend — FastAPI Router

Create `backend/routers/hrms.py`:

```python
"""
HRMS Module Router
Employees, Attendance (AekamSentinel), Leave Management, Documents
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional
from uuid import UUID
from datetime import date, datetime, time
from decimal import Decimal
from math import radians, sin, cos, sqrt, atan2
from pydantic import BaseModel, Field
from ..dependencies import get_current_user, get_db
from ..middleware.subscription import require_module

router = APIRouter(
    prefix="/api/v1/hrms",
    tags=["HRMS"],
    dependencies=[Depends(require_module("hrms"))]
)


# ── Pydantic Models ──────────────────────────────────────────

class EmployeeCreate(BaseModel):
    employee_code: str
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    date_of_joining: date
    department: Optional[str] = None
    designation: Optional[str] = None
    reporting_to: Optional[UUID] = None
    employment_type: str = "full_time"
    pf_number: Optional[str] = None
    esi_number: Optional[str] = None
    uan: Optional[str] = None
    pan: Optional[str] = None
    bank_account: Optional[dict] = None
    ctc: Optional[Decimal] = None
    basic_salary: Optional[Decimal] = None
    custom_fields: dict = {}

class EmployeeUpdate(BaseModel):
    department: Optional[str] = None
    designation: Optional[str] = None
    reporting_to: Optional[UUID] = None
    status: Optional[str] = None
    date_of_exit: Optional[date] = None
    bank_account: Optional[dict] = None
    ctc: Optional[Decimal] = None
    basic_salary: Optional[Decimal] = None

class CheckInRequest(BaseModel):
    employee_id: UUID
    verification_method: str          # facial, fingerprint, geo_photo, pin_gps
    verification_data: dict           # method-specific payload
    shift_id: Optional[UUID] = None

class CheckOutRequest(BaseModel):
    employee_id: UUID
    verification_method: Optional[str] = None
    verification_data: Optional[dict] = None

class RegularizationRequest(BaseModel):
    reason: str

class RegularizationAction(BaseModel):
    approved: bool

class LeaveApply(BaseModel):
    leave_type_id: UUID
    from_date: date
    to_date: date
    days: Decimal
    reason: Optional[str] = None

class LeaveAction(BaseModel):
    status: str                       # approved or rejected
    rejection_reason: Optional[str] = None


# ── Employees ────────────────────────────────────────────────

@router.get("/employees")
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    status: str = "active",
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    """List employees with search and filters."""
    query = db.table("hr_employees").select("*").eq("org_id", str(user.org_id)).eq("status", status)
    if search:
        query = query.or_(f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,employee_code.ilike.%{search}%")
    if department:
        query = query.eq("department", department)
    query = query.order("first_name").range((page-1)*limit, page*limit - 1)
    return {"data": query.execute().data}


@router.post("/employees")
async def create_employee(body: EmployeeCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Create a new employee record."""
    data = body.model_dump()
    data["org_id"] = str(user.org_id)
    result = db.table("hr_employees").insert(data).execute()
    return result.data[0]


@router.get("/employees/{employee_id}")
async def get_employee(employee_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
    """Employee detail with reporting chain."""
    emp = db.table("hr_employees").select("*").eq("id", str(employee_id)).eq("org_id", str(user.org_id)).single().execute()
    return emp.data


@router.patch("/employees/{employee_id}")
async def update_employee(employee_id: UUID, body: EmployeeUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    """Update employee fields."""
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    data["updated_at"] = datetime.utcnow().isoformat()
    result = db.table("hr_employees").update(data).eq("id", str(employee_id)).eq("org_id", str(user.org_id)).execute()
    return result.data[0]


# ── Attendance (AekamSentinel) ───────────────────────────────

@router.post("/attendance/check-in")
async def check_in(body: CheckInRequest, user=Depends(get_current_user), db=Depends(get_db)):
    """
    Record check-in with verification.
    Methods: facial (KBY-AI), fingerprint (Mantra MFS100), geo_photo, pin_gps
    """
    today = date.today()
    
    existing = db.table("hr_attendance").select("id").eq("employee_id", str(body.employee_id)).eq("date", today.isoformat()).execute()
    if existing.data:
        raise HTTPException(400, "Already checked in today")
    
    verified = await _verify_attendance(body.verification_method, body.verification_data, user.org_id, db)
    if not verified:
        raise HTTPException(400, "Verification failed")
    
    shift_id = body.shift_id
    if not shift_id:
        default_shift = db.table("hr_shifts").select("id").eq("org_id", str(user.org_id)).eq("is_default", True).execute()
        shift_id = default_shift.data[0]["id"] if default_shift.data else None
    
    data = {
        "org_id": str(user.org_id),
        "employee_id": str(body.employee_id),
        "date": today.isoformat(),
        "shift_id": str(shift_id) if shift_id else None,
        "check_in": datetime.utcnow().isoformat(),
        "status": "present",
        "verification_method": body.verification_method,
        "verification_data": body.verification_data
    }
    result = db.table("hr_attendance").insert(data).execute()
    return result.data[0]


@router.post("/attendance/check-out")
async def check_out(body: CheckOutRequest, user=Depends(get_current_user), db=Depends(get_db)):
    """Record check-out. Hours calculated by DB trigger."""
    today = date.today()
    record = db.table("hr_attendance").select("*").eq("employee_id", str(body.employee_id)).eq("date", today.isoformat()).single().execute()
    
    if not record.data:
        raise HTTPException(400, "No check-in found for today")
    if record.data.get("check_out"):
        raise HTTPException(400, "Already checked out")
    
    result = db.table("hr_attendance").update({
        "check_out": datetime.utcnow().isoformat()
    }).eq("id", record.data["id"]).execute()
    return result.data[0]


@router.get("/attendance")
async def list_attendance(
    employee_id: Optional[UUID] = None,
    department: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    """List attendance records with filters."""
    query = (db.table("hr_attendance")
        .select("*, hr_employees(first_name, last_name, employee_code, department)")
        .eq("org_id", str(user.org_id)))
    if employee_id:
        query = query.eq("employee_id", str(employee_id))
    if from_date:
        query = query.gte("date", from_date.isoformat())
    if to_date:
        query = query.lte("date", to_date.isoformat())
    if status:
        query = query.eq("status", status)
    query = query.order("date", desc=True)
    return {"data": query.execute().data}


@router.post("/attendance/{attendance_id}/regularize")
async def request_regularization(
    attendance_id: UUID, body: RegularizationRequest,
    user=Depends(get_current_user), db=Depends(get_db)
):
    """Employee requests attendance regularization."""
    result = db.table("hr_attendance").update({
        "regularization_status": "pending",
        "regularization_reason": body.reason
    }).eq("id", str(attendance_id)).eq("org_id", str(user.org_id)).execute()
    return result.data[0]


@router.patch("/attendance/{attendance_id}/regularize")
async def approve_regularization(
    attendance_id: UUID, body: RegularizationAction,
    user=Depends(get_current_user), db=Depends(get_db)
):
    """Manager approves/rejects regularization."""
    update = {
        "regularization_status": "approved" if body.approved else "rejected",
        "regularized_by": str(user.id),
        "regularized_at": datetime.utcnow().isoformat()
    }
    if body.approved:
        update["status"] = "present"
    result = db.table("hr_attendance").update(update).eq("id", str(attendance_id)).execute()
    return result.data[0]


@router.get("/attendance/report")
async def attendance_report(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    employee_id: Optional[UUID] = None,
    user=Depends(get_current_user),
    db=Depends(get_db)
):
    """Monthly attendance summary: present, absent, late, overtime, avg hours."""
    from_date = date(year, month, 1)
    next_month = month + 1 if month < 12 else 1
    next_year = year if month < 12 else year + 1
    to_date = date(next_year, next_month, 1)
    
    query = (db.table("hr_attendance").select("*")
        .eq("org_id", str(user.org_id))
        .gte("date", from_date.isoformat())
        .lt("date", to_date.isoformat()))
    if employee_id:
        query = query.eq("employee_id", str(employee_id))
    
    records = query.execute().data
    
    summary = {}
    for r in records:
        eid = r["employee_id"]
        if eid not in summary:
            summary[eid] = {
                "present_days": 0, "absent_days": 0, "half_days": 0,
                "late_count": 0, "total_hours": 0, "overtime_hours": 0
            }
        s = summary[eid]
        if r["status"] == "present": s["present_days"] += 1
        elif r["status"] == "absent": s["absent_days"] += 1
        elif r["status"] == "half_day": s["half_days"] += 1
        if (r.get("late_by_minutes") or 0) > 0: s["late_count"] += 1
        s["total_hours"] += r.get("hours_worked") or 0
        s["overtime_hours"] += r.get("overtime_hours") or 0
    
    for eid in summary:
        days = summary[eid]["present_days"] + summary[eid]["half_days"]
        summary[eid]["avg_hours"] = round(summary[eid]["total_hours"] / max(days, 1), 2)
    
    return {"month": month, "year": year, "employees": summary}


# ── Leave Management ────────────────────────────────────────

@router.get("/leave-types")
async def list_leave_types(user=Depends(get_current_user), db=Depends(get_db)):
    return {"data": db.table("hr_leave_types").select("*").eq("org_id", str(user.org_id)).eq("is_active", True).execute().data}

@router.post("/leave-types")
async def create_leave_type(body: dict, user=Depends(get_current_user), db=Depends(get_db)):
    body["org_id"] = str(user.org_id)
    return db.table("hr_leave_types").insert(body).execute().data[0]

@router.post("/leave/apply")
async def apply_leave(body: LeaveApply, user=Depends(get_current_user), db=Depends(get_db)):
    """Apply for leave. Checks balance first."""
    emp = db.table("hr_employees").select("id").eq("user_id", str(user.id)).eq("org_id", str(user.org_id)).single().execute()
    employee_id = emp.data["id"]
    
    year = body.from_date.year
    balance = (db.table("hr_leave_balances").select("balance")
        .eq("employee_id", employee_id)
        .eq("leave_type_id", str(body.leave_type_id))
        .eq("year", year).single().execute())
    
    if balance.data and balance.data["balance"] < float(body.days):
        raise HTTPException(400, f"Insufficient balance. Available: {balance.data['balance']}")
    
    data = body.model_dump()
    data["org_id"] = str(user.org_id)
    data["employee_id"] = employee_id
    data["status"] = "pending"
    return db.table("hr_leave_requests").insert(data).execute().data[0]


@router.patch("/leave/{leave_id}/approve")
async def approve_leave(leave_id: UUID, body: LeaveAction, user=Depends(get_current_user), db=Depends(get_db)):
    """Approve/reject leave. Updates balance on approval."""
    leave = db.table("hr_leave_requests").select("*").eq("id", str(leave_id)).eq("org_id", str(user.org_id)).single().execute()
    
    if leave.data["status"] != "pending":
        raise HTTPException(400, "Leave request is not pending")
    
    update = {
        "status": body.status,
        "approved_by": str(user.id),
        "approved_at": datetime.utcnow().isoformat()
    }
    if body.status == "rejected":
        update["rejection_reason"] = body.rejection_reason
    
    db.table("hr_leave_requests").update(update).eq("id", str(leave_id)).execute()
    
    if body.status == "approved":
        year = int(leave.data["from_date"][:4])
        db.rpc("hr_deduct_leave_balance", {
            "p_employee_id": leave.data["employee_id"],
            "p_leave_type_id": leave.data["leave_type_id"],
            "p_year": year,
            "p_days": float(leave.data["days"])
        }).execute()
    
    return {"status": "ok"}


@router.get("/leave/balance/{employee_id}")
async def get_leave_balance(employee_id: UUID, year: Optional[int] = None, user=Depends(get_current_user), db=Depends(get_db)):
    if not year:
        year = date.today().year
    return {"data": db.table("hr_leave_balances").select("*, hr_leave_types(name, code)").eq("employee_id", str(employee_id)).eq("year", year).execute().data}


# ── Verification Helpers ─────────────────────────────────────

async def _verify_attendance(method: str, data: dict, org_id: UUID, db) -> bool:
    """Verify attendance based on method."""
    if method == "facial":
        # KBY-AI SDK: compare captured face against stored reference
        # data = {photo_base64: "...", employee_ref_photo_url: "..."}
        # Returns confidence_score (0-1)
        return data.get("confidence_score", 0) >= 0.85
    
    elif method == "fingerprint":
        # Mantra MFS100 via WebUSB
        # data = {template_hash: "...", device_id: "..."}
        return data.get("match_score", 0) >= 0.90
    
    elif method in ("geo_photo", "pin_gps"):
        lat, lng = data.get("lat"), data.get("lng")
        if not lat or not lng:
            return False
        offices = db.table("hr_office_locations").select("*").eq("org_id", str(org_id)).eq("is_active", True).execute()
        for office in offices.data:
            dist = _haversine(lat, lng, float(office["latitude"]), float(office["longitude"]))
            if dist <= office["radius_meters"]:
                data["distance_from_office"] = round(dist, 2)
                return True
        return False
    
    return False


def _haversine(lat1, lon1, lat2, lon2) -> float:
    """Distance in meters between two GPS coordinates."""
    R = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))
```

Register in `backend/main.py`:
```python
from .routers import hrms
app.include_router(hrms.router)
```

---

## 3. Frontend — React Components

### File tree

```
src/
  pages/
    HRMSPage.jsx              # Tab nav: Directory | Attendance | Leave | Documents
  components/
    hrms/
      EmployeeDirectory.jsx    # Searchable employee grid/list
      EmployeeCard.jsx         # Avatar, name, dept, designation card
      EmployeeForm.jsx         # Create/edit employee form
      EmployeeDetail.jsx       # Full profile with sub-tabs
      AttendanceBoard.jsx      # Daily grid (all employees x status)
      AttendanceCalendar.jsx   # Monthly heatmap for one employee
      CheckInWidget.jsx        # Self-service check-in with method selector
      RegularizationQueue.jsx  # Manager: pending regularization requests
      LeaveApply.jsx           # Leave application form + balance display
      LeaveApprovalQueue.jsx   # Manager: pending leave requests
      LeaveBalanceSummary.jsx  # Visual balance cards per leave type
      DocumentUploader.jsx     # Upload to R2 with type selector
      ShiftManager.jsx         # CRUD for shift configurations
      OrgChart.jsx             # Reporting hierarchy tree view
  hooks/
    useHRMS.js                 # Employee CRUD hooks
    useAttendance.js           # Attendance hooks + Realtime subscription
    useLeave.js                # Leave hooks
```

### Key component: `CheckInWidget.jsx`

```jsx
import { useState } from 'react';
import { useCheckIn, useCheckOut } from '../../hooks/useAttendance';

export default function CheckInWidget({ employeeId }) {
  const [method, setMethod] = useState('geo_photo');
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();

  const methodLabels = {
    facial: 'Face ID', fingerprint: 'Fingerprint',
    geo_photo: 'Photo + GPS', pin_gps: 'PIN + GPS'
  };

  const handleCheckIn = async () => {
    let verificationData = {};
    
    switch (method) {
      case 'facial':
        const photo = await capturePhoto();
        const aiResult = await kbyAIVerify(photo, employeeId);
        verificationData = { photo_url: photo.url, confidence_score: aiResult.score };
        break;
      case 'fingerprint':
        const fp = await readMantraMFS100();
        verificationData = { template_hash: fp.hash, device_id: fp.deviceId, match_score: fp.score };
        break;
      case 'geo_photo':
        const [gp, pos] = await Promise.all([capturePhoto(), getGPS()]);
        verificationData = { photo_url: gp.url, lat: pos.latitude, lng: pos.longitude, accuracy_meters: pos.accuracy };
        break;
      case 'pin_gps':
        const pin = await promptPIN();
        const gps = await getGPS();
        verificationData = { pin, lat: gps.latitude, lng: gps.longitude };
        break;
    }
    
    checkIn.mutate({ employee_id: employeeId, verification_method: method, verification_data: verificationData });
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Mark Attendance</h3>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {Object.entries(methodLabels).map(([key, label]) => (
          <button key={key} onClick={() => setMethod(key)}
            className={`p-3 rounded-lg border text-center text-xs font-medium
              ${method === key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <button onClick={handleCheckIn}
        className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700">
        Check In
      </button>
    </div>
  );
}
```

### Hooks: `useAttendance.js`

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../utils/supabase';
import api from '../utils/api';

export const useAttendance = (filters = {}) =>
  useQuery(['attendance', filters], () => api.get('/api/v1/hrms/attendance', { params: filters }));

export const useCheckIn = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/hrms/attendance/check-in', data), {
    onSuccess: () => qc.invalidateQueries(['attendance']),
  });
};

export const useCheckOut = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/hrms/attendance/check-out', data), {
    onSuccess: () => qc.invalidateQueries(['attendance']),
  });
};

// Supabase Realtime subscription for live attendance board
export const useAttendanceRealtime = (orgId, targetDate) => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`attendance-${targetDate}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'hr_attendance',
        filter: `org_id=eq.${orgId}`
      }, () => qc.invalidateQueries(['attendance']))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [orgId, targetDate]);
};
```

---

## 4. Verification Methods — Integration Details

| Method | Hardware/SDK | Frontend API | Threshold | Stored Data |
|--------|-------------|-------------|-----------|-------------|
| Facial | KBY-AI Cloud SDK | `navigator.mediaDevices.getUserMedia` | confidence ≥ 0.85 | photo_url, confidence_score |
| Fingerprint | Mantra MFS100 USB | WebUSB API | match_score ≥ 0.90 | template_hash, device_id |
| Geo Photo | Phone camera + GPS | MediaDevices + Geolocation API | Within radius_meters | photo_url, lat, lng |
| PIN + GPS | On-screen PIN pad + GPS | Geolocation API | PIN match + within radius | lat, lng |

---

## 5. Indian Compliance Notes

- **Labour Code 2026**: Form 130 replaces Form 16; basic pay must be ≥ 50% of CTC
- **PF**: Employees with basic ≤ ₹15,000/mo must be enrolled. UAN is mandatory.
- **ESI**: Employees with gross ≤ ₹21,000/mo. IP number tracked.
- **DPDP Act 2023**: Aadhaar stored as SHA-256 hash only. Biometric templates as hashes. Photo storage with 90-day retention policy. Employee consent before collection.
- **Shops & Establishments Act**: Weekly off rules, max working hours (48/week), overtime caps vary by state.

---

## 6. Implementation Steps

1. **Create branch**: `git checkout -b feature/hrms-module`
2. **Run migration**: `011_hrms_module.sql` on staging Supabase
3. **Seed shifts**: Insert "General Shift" (09:00-18:00, grace 15 min) per org
4. **Seed leave types**: CL (12/yr), SL (7/yr), PL/EL (15/yr), ML (182 days, female only)
5. **Seed holidays**: National holidays for current year
6. **Build backend**: `hrms.py` router → register in `main.py`
7. **Build frontend**: `HRMSPage` → `EmployeeDirectory` → `AttendanceBoard` → `CheckInWidget`
8. **AekamSentinel port**: Move verification logic into `_verify_attendance()`
9. **R2 integration**: Photo uploads for facial + geo_photo methods
10. **Realtime**: Enable on `hr_attendance` for live attendance board
11. **Biometric add-on gate**: Fingerprint + facial behind `require_module("biometric")`
12. **Tests**: Full suite below

---

## 7. Test Cases

```python
# tests/test_hrms.py

async def test_employee_crud():
    """Create, read, update employee. Verify employee_code unique per org."""

async def test_check_in_geo_photo_within_fence():
    """Check-in at 100m from office (radius 200m). Expect success, status=present."""

async def test_check_in_outside_geofence():
    """Check-in at 500m from office (radius 200m). Expect 400."""

async def test_check_in_duplicate():
    """Second check-in same day. Expect 400."""

async def test_late_detection():
    """Shift 09:00, grace 15min, check-in 09:25. Expect late_by_minutes=25."""

async def test_hours_and_overtime():
    """Check-in 09:00, check-out 19:30. Expect hours_worked=10.5, overtime=1.5."""

async def test_half_day_detection():
    """Check-in 09:00, check-out 12:00. Expect status=half_day."""

async def test_leave_apply_sufficient_balance():
    """Apply 2 days CL with 12 balance. Expect success."""

async def test_leave_apply_insufficient():
    """Apply 15 days CL with 12 balance. Expect 400."""

async def test_leave_approval_updates_balance():
    """Approve 2-day leave. Verify taken increases by 2, balance decreases."""

async def test_regularization_workflow():
    """Request → approve → verify status changes to present."""

async def test_facial_below_threshold():
    """Facial verification with confidence 0.70. Expect 400."""

async def test_aadhaar_stored_as_hash():
    """Create employee. Verify aadhaar_hash is 64-char hex, not raw 12-digit."""
```
