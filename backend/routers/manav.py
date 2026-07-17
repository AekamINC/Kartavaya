"""
manav.py — Manav · मानव (HRMS) Router
Employee directory, departments, attendance, leave management, holidays.
"""
import json
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

router = APIRouter(prefix="/api/v1/manav", tags=["manav-hrms"])

_gate = require_module("manav")


# ── Pydantic Models ──────────────────────────────────────────

class EmployeeCreate(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    employee_code: str = ""
    department: str = ""
    designation: str = ""
    date_of_joining: str = ""
    date_of_birth: str = ""
    gender: str = ""
    blood_group: str = ""
    emergency_contact: dict = {}
    address: dict = {}
    bank_details: dict = {}
    pan: str = ""
    aadhaar: str = ""
    uan: str = ""
    esi_number: str = ""
    employment_type: str = "full_time"
    reporting_to: str = ""
    shift: str = "general"
    user_id: str = ""


class EmployeeUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    employee_code: str | None = None
    department: str | None = None
    designation: str | None = None
    date_of_joining: str | None = None
    date_of_birth: str | None = None
    gender: str | None = None
    blood_group: str | None = None
    emergency_contact: dict | None = None
    address: dict | None = None
    bank_details: dict | None = None
    pan: str | None = None
    aadhaar: str | None = None
    uan: str | None = None
    esi_number: str | None = None
    employment_type: str | None = None
    reporting_to: str | None = None
    shift: str | None = None
    status: str | None = None


class DepartmentCreate(BaseModel):
    name: str
    head_employee_id: str = ""


class AttendanceMark(BaseModel):
    employee_id: str
    date: str = ""
    check_in: str = ""
    check_out: str = ""
    status: str = "present"
    notes: str = ""


class LeaveTypeCreate(BaseModel):
    name: str
    code: str
    annual_quota: int = 0
    is_paid: bool = True
    carry_forward: bool = False
    max_carry_forward: int = 0


class LeaveRequest(BaseModel):
    leave_type_id: str
    start_date: str
    end_date: str
    days: float = 1
    reason: str = ""


class LeaveAction(BaseModel):
    status: str
    rejection_reason: str = ""


class HolidayCreate(BaseModel):
    name: str
    date: str
    is_optional: bool = False


class AnnouncementCreate(BaseModel):
    title: str
    body: str = ""
    priority: str = "normal"
    pinned: bool = False
    expires_at: str = ""


class AnnouncementUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    priority: str | None = None
    pinned: bool | None = None
    expires_at: str | None = None


# ── Employees ────────────────────────────────────────────────

@router.get("/employees")
async def list_employees(
    department: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT id, employee_code, name, email, phone, department, designation, "
        "employment_type, status, date_of_joining, shift, created_at "
        "FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if department:
        query += f"AND department=${idx} "
        params.append(department)
        idx += 1
    if status:
        query += f"AND status=${idx} "
        params.append(status)
        idx += 1
    if search:
        query += f"AND (name ILIKE '%' || ${idx} || '%' OR email ILIKE '%' || ${idx} || '%' OR employee_code ILIKE '%' || ${idx} || '%') "
        params.append(search)
        idx += 1

    query += "ORDER BY name LIMIT 500"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/employees")
async def create_employee(
    body: EmployeeCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    valid_types = ("full_time", "part_time", "contract", "intern", "consultant")
    if body.employment_type not in valid_types:
        raise HTTPException(400, f"employment_type must be one of: {', '.join(valid_types)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_employees "
        "(org_id, user_id, employee_code, name, email, phone, department, designation, "
        " date_of_joining, date_of_birth, gender, blood_group, emergency_contact, "
        " address, bank_details, pan, aadhaar, uan, esi_number, employment_type, "
        " reporting_to, shift, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,''), $4, $5, $6, $7, $8, "
        " NULLIF($9,'')::date, NULLIF($10,'')::date, NULLIF($11,''), $12, $13, $14, $15, "
        " $16, $17, $18, $19, $20, NULLIF($21,'')::uuid, $22, $23) "
        "RETURNING id, name, employee_code",
        org_id, body.user_id, body.employee_code, body.name, body.email, body.phone,
        body.department, body.designation, body.date_of_joining, body.date_of_birth,
        body.gender or None, body.blood_group, body.emergency_contact, json.dumps(body.address),
        json.dumps(body.bank_details), body.pan, body.aadhaar, body.uan, body.esi_number,
        body.employment_type, body.reporting_to, body.shift, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.get("/employees/{employee_id}")
async def get_employee(
    employee_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Employee not found")

    leave_balances = await pool.fetch(
        "SELECT lb.*, lt.name as leave_name, lt.code as leave_code "
        "FROM staging.manav_leave_balances lb "
        "JOIN staging.manav_leave_types lt ON lt.id = lb.leave_type_id "
        "WHERE lb.employee_id=$1::uuid AND lb.year=EXTRACT(YEAR FROM CURRENT_DATE)::int",
        str(employee_id),
    )
    return {"employee": dict(row), "leave_balances": [dict(lb) for lb in leave_balances]}


@router.patch("/employees/{employee_id}")
async def update_employee(
    employee_id: UUID,
    body: EmployeeUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    sets = []
    params = [str(employee_id), org_id]
    idx = 3
    jsonb_fields = {"address", "bank_details"}
    for k, v in updates.items():
        if k in jsonb_fields:
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v))
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.manav_employees SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/employees/{employee_id}")
async def deactivate_employee(
    employee_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.manav_employees SET is_active=FALSE, status='terminated', updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    return {"status": "deactivated"}


# ── Departments ──────────────────────────────────────────────

@router.get("/departments")
async def list_departments(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT d.id, d.name, d.created_at, e.name as head_name, "
        "(SELECT COUNT(*) FROM staging.manav_employees WHERE department=d.name AND org_id=d.org_id AND is_active=TRUE) as employee_count "
        "FROM staging.manav_departments d "
        "LEFT JOIN staging.manav_employees e ON e.id = d.head_employee_id "
        "WHERE d.org_id=$1::uuid AND d.is_active=TRUE ORDER BY d.name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/departments")
async def create_department(
    body: DepartmentCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_departments (org_id, name, head_employee_id) "
        "VALUES ($1::uuid, $2, NULLIF($3,'')::uuid) RETURNING id, name",
        org_id, body.name, body.head_employee_id,
    )
    return {"status": "created", **dict(row)}


# ── Attendance ───────────────────────────────────────────────

@router.get("/attendance")
async def list_attendance(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    d_from = date_from or date.today().isoformat()
    d_to = date_to or d_from

    query = (
        "SELECT a.id, a.date, a.check_in, a.check_out, a.status, "
        "a.work_hours, a.overtime_hours, a.marked_by, "
        "e.name as employee_name, e.employee_code "
        "FROM staging.manav_attendance a "
        "JOIN staging.manav_employees e ON e.id = a.employee_id "
        "WHERE a.org_id=$1::uuid AND a.date >= $2::date AND a.date <= $3::date "
    )
    params: list = [org_id, d_from, d_to]
    idx = 4

    if employee_id:
        query += f"AND a.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1

    query += "ORDER BY a.date DESC, e.name"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/attendance")
async def mark_attendance(
    body: AttendanceMark,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    att_date = body.date or date.today().isoformat()

    valid_statuses = ("present", "absent", "half_day", "late", "on_leave", "holiday", "weekend")
    if body.status not in valid_statuses:
        raise HTTPException(400, f"status must be one of: {', '.join(valid_statuses)}")

    work_hours = None
    if body.check_in and body.check_out:
        ci = datetime.fromisoformat(body.check_in)
        co = datetime.fromisoformat(body.check_out)
        work_hours = round((co - ci).total_seconds() / 3600, 2)

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_attendance "
        "(org_id, employee_id, date, check_in, check_out, status, work_hours, notes, marked_by) "
        "VALUES ($1::uuid, $2::uuid, $3::date, NULLIF($4,'')::timestamptz, "
        " NULLIF($5,'')::timestamptz, $6, $7, $8, 'manual') "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "check_in=COALESCE(NULLIF($4,'')::timestamptz, staging.manav_attendance.check_in), "
        "check_out=COALESCE(NULLIF($5,'')::timestamptz, staging.manav_attendance.check_out), "
        "status=$6, work_hours=COALESCE($7, staging.manav_attendance.work_hours), "
        "notes=$8, marked_by='manual' "
        "RETURNING id, status",
        org_id, body.employee_id, att_date, body.check_in, body.check_out,
        body.status, work_hours, body.notes,
    )
    return {"status": "marked", **dict(row)}


@router.get("/attendance/summary")
async def attendance_summary(
    month: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if month:
        year, mo = month.split("-")
    else:
        today = date.today()
        year, mo = str(today.year), f"{today.month:02d}"

    start = f"{year}-{mo}-01"
    if int(mo) < 12:
        end = f"{year}-{int(mo)+1:02d}-01"
    else:
        end = f"{int(year)+1}-01-01"

    rows = await pool.fetch(
        "SELECT e.id, e.name, e.employee_code, "
        "COUNT(*) FILTER (WHERE a.status='present') as present_days, "
        "COUNT(*) FILTER (WHERE a.status='absent') as absent_days, "
        "COUNT(*) FILTER (WHERE a.status='half_day') as half_days, "
        "COUNT(*) FILTER (WHERE a.status='late') as late_days, "
        "COUNT(*) FILTER (WHERE a.status='on_leave') as leave_days, "
        "COALESCE(SUM(a.work_hours),0) as total_hours, "
        "COALESCE(SUM(a.overtime_hours),0) as overtime_hours "
        "FROM staging.manav_employees e "
        "LEFT JOIN staging.manav_attendance a ON a.employee_id=e.id "
        "  AND a.date >= $2::date AND a.date < $3::date "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE "
        "GROUP BY e.id, e.name, e.employee_code ORDER BY e.name",
        org_id, start, end,
    )
    return {"data": [dict(r) for r in rows], "month": f"{year}-{mo}"}


# ── Leave Types ──────────────────────────────────────────────

@router.get("/leave-types")
async def list_leave_types(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_leave_types WHERE org_id=$1::uuid AND is_active=TRUE ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/leave-types")
async def create_leave_type(
    body: LeaveTypeCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_leave_types "
        "(org_id, name, code, annual_quota, is_paid, carry_forward, max_carry_forward) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) RETURNING id, name, code",
        org_id, body.name, body.code, body.annual_quota,
        body.is_paid, body.carry_forward, body.max_carry_forward,
    )
    return {"status": "created", **dict(row)}


# ── Leave Requests ───────────────────────────────────────────

@router.get("/leaves")
async def list_leave_requests(
    status: Optional[str] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT lr.id, lr.start_date, lr.end_date, lr.days, lr.reason, lr.status, "
        "lr.rejection_reason, lr.created_at, "
        "e.name as employee_name, e.employee_code, "
        "lt.name as leave_type_name, lt.code as leave_type_code "
        "FROM staging.manav_leave_requests lr "
        "JOIN staging.manav_employees e ON e.id = lr.employee_id "
        "JOIN staging.manav_leave_types lt ON lt.id = lr.leave_type_id "
        "WHERE lr.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2

    if status:
        query += f"AND lr.status=${idx} "
        params.append(status)
        idx += 1
    if employee_id:
        query += f"AND lr.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1

    query += "ORDER BY lr.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/leaves")
async def create_leave_request(
    body: LeaveRequest,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    emp = await pool.fetchrow(
        "SELECT id FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND user_id=$2::uuid AND is_active=TRUE",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(403, "No employee record found for your account")

    bal = await pool.fetchrow(
        "SELECT allocated, used, carried_forward FROM staging.manav_leave_balances "
        "WHERE employee_id=$1::uuid AND leave_type_id=$2::uuid AND year=EXTRACT(YEAR FROM CURRENT_DATE)::int",
        str(emp["id"]), body.leave_type_id,
    )
    if bal:
        available = (bal["allocated"] + bal["carried_forward"]) - bal["used"]
        if body.days > available:
            raise HTTPException(400, f"Insufficient leave balance. Available: {available}, requested: {body.days}")

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_leave_requests "
        "(org_id, employee_id, leave_type_id, start_date, end_date, days, reason) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date, $6, $7) RETURNING id",
        org_id, str(emp["id"]), body.leave_type_id,
        body.start_date, body.end_date, body.days, body.reason,
    )
    return {"status": "submitted", "id": str(row["id"])}


@router.patch("/leaves/{leave_id}/action")
async def action_leave_request(
    leave_id: UUID,
    body: LeaveAction,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "Status must be 'approved' or 'rejected'")

    lr = await pool.fetchrow(
        "SELECT employee_id, leave_type_id, days, status FROM staging.manav_leave_requests "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(leave_id), org_id,
    )
    if not lr:
        raise HTTPException(404, "Leave request not found")
    if lr["status"] != "pending":
        raise HTTPException(400, f"Cannot action: leave is already {lr['status']}")

    await pool.execute(
        "UPDATE staging.manav_leave_requests SET status=$1, approved_by=$2, "
        "approved_at=NOW(), rejection_reason=$3, updated_at=NOW() "
        "WHERE id=$4::uuid",
        body.status, user["user_id"], body.rejection_reason or None, str(leave_id),
    )

    if body.status == "approved":
        year = date.today().year
        existing = await pool.fetchrow(
            "SELECT id FROM staging.manav_leave_balances "
            "WHERE employee_id=$1::uuid AND leave_type_id=$2::uuid AND year=$3",
            str(lr["employee_id"]), str(lr["leave_type_id"]), year,
        )
        if existing:
            await pool.execute(
                "UPDATE staging.manav_leave_balances SET used=used+$1 "
                "WHERE id=$2::uuid",
                int(lr["days"]), existing["id"],
            )
        else:
            lt = await pool.fetchrow(
                "SELECT annual_quota FROM staging.manav_leave_types WHERE id=$1::uuid",
                str(lr["leave_type_id"]),
            )
            await pool.execute(
                "INSERT INTO staging.manav_leave_balances "
                "(org_id, employee_id, leave_type_id, year, allocated, used) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)",
                org_id, str(lr["employee_id"]), str(lr["leave_type_id"]),
                year, lt["annual_quota"] if lt else 0, int(lr["days"]),
            )

    return {"status": body.status}


# ── Holidays ─────────────────────────────────────────────────

@router.get("/holidays")
async def list_holidays(
    year: Optional[int] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    y = year or date.today().year
    rows = await pool.fetch(
        "SELECT id, name, date, is_optional FROM staging.manav_holidays "
        "WHERE org_id=$1::uuid AND EXTRACT(YEAR FROM date)=$2 ORDER BY date",
        org_id, y,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/holidays")
async def create_holiday(
    body: HolidayCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_holidays (org_id, name, date, is_optional) "
        "VALUES ($1::uuid, $2, $3::date, $4) RETURNING id, name, date",
        org_id, body.name, body.date, body.is_optional,
    )
    return {"status": "created", **dict(row)}


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(
    holiday_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.manav_holidays WHERE id=$1::uuid AND org_id=$2::uuid",
        str(holiday_id), org_id,
    )
    return {"status": "deleted"}


# ── Dashboard Stats ──────────────────────────────────────────

@router.get("/stats")
async def hrms_stats(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    emp_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees WHERE org_id=$1::uuid AND is_active=TRUE AND status='active'",
        org_id,
    )
    dept_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_departments WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    pending_leaves = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_leave_requests WHERE org_id=$1::uuid AND status='pending'",
        org_id,
    )
    today_present = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_attendance "
        "WHERE org_id=$1::uuid AND date=CURRENT_DATE AND status IN ('present','late')",
        org_id,
    )
    announcements_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_announcements "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
        "AND (expires_at IS NULL OR expires_at > NOW())",
        org_id,
    )
    pending_leaves_today = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_leave_requests "
        "WHERE org_id=$1::uuid AND status='pending' "
        "AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE",
        org_id,
    )
    clocked_in_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_attendance "
        "WHERE org_id=$1::uuid AND date=CURRENT_DATE "
        "AND check_in IS NOT NULL AND check_out IS NULL",
        org_id,
    )
    on_leave_today = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_leave_requests "
        "WHERE org_id=$1::uuid AND status='approved' "
        "AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE",
        org_id,
    )
    return {
        "total_employees": emp_count,
        "departments": dept_count,
        "pending_leaves": pending_leaves,
        "today_present": today_present,
        "announcements_count": announcements_count,
        "pending_leaves_today": pending_leaves_today,
        "clocked_in_count": clocked_in_count,
        "on_leave_today": on_leave_today,
    }


# ── Announcements ───────────────────────────────────────────

@router.get("/announcements")
async def list_announcements(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT a.id, a.title, a.body, a.priority, a.pinned, "
        "a.published_at, a.expires_at, a.created_at, "
        "e.name as creator_name "
        "FROM staging.manav_announcements a "
        "LEFT JOIN staging.manav_employees e ON e.user_id = a.created_by AND e.org_id = a.org_id "
        "WHERE a.org_id=$1::uuid AND a.is_active=TRUE "
        "AND (a.expires_at IS NULL OR a.expires_at > NOW()) "
        "ORDER BY a.pinned DESC, a.published_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/announcements")
async def create_announcement(
    body: AnnouncementCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    valid_priorities = ("low", "normal", "high", "urgent")
    if body.priority not in valid_priorities:
        raise HTTPException(400, f"priority must be one of: {', '.join(valid_priorities)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_announcements "
        "(org_id, title, body, priority, pinned, expires_at, published_at, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, NULLIF($6,'')::timestamptz, NOW(), $7) "
        "RETURNING id, title",
        org_id, body.title, body.body, body.priority,
        body.pinned, body.expires_at, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/announcements/{announcement_id}")
async def update_announcement(
    announcement_id: UUID,
    body: AnnouncementUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "priority" in updates:
        valid_priorities = ("low", "normal", "high", "urgent")
        if updates["priority"] not in valid_priorities:
            raise HTTPException(400, f"priority must be one of: {', '.join(valid_priorities)}")

    sets = []
    params = [str(announcement_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k == "expires_at":
            sets.append(f"expires_at=NULLIF(${idx},'')::timestamptz")
        else:
            sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1

    await pool.execute(
        f"UPDATE staging.manav_announcements SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        *params,
    )
    return {"status": "updated"}


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.manav_announcements SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(announcement_id), org_id,
    )
    return {"status": "deleted"}


# ── Leave Conflict Detection ────────────────────────────────

@router.get("/leaves/check-conflicts")
async def check_leave_conflicts(
    employee_id: str,
    start_date: str,
    end_date: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    emp = await pool.fetchrow(
        "SELECT id, department FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")
    if not emp["department"]:
        return {"conflicts": [], "conflict_count": 0, "department_size": 0, "exceeds_threshold": False}

    dept_size = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND department=$2 AND is_active=TRUE AND status='active'",
        org_id, emp["department"],
    )

    conflicts = await pool.fetch(
        "SELECT lr.id, lr.start_date, lr.end_date, lr.days, lr.status, "
        "e.name as employee_name, e.employee_code "
        "FROM staging.manav_leave_requests lr "
        "JOIN staging.manav_employees e ON e.id = lr.employee_id "
        "WHERE lr.org_id=$1::uuid AND lr.status IN ('approved','pending') "
        "AND e.department=$2 AND e.is_active=TRUE "
        "AND lr.employee_id != $3::uuid "
        "AND lr.start_date <= $5::date AND lr.end_date >= $4::date "
        "ORDER BY lr.start_date",
        org_id, emp["department"], employee_id, start_date, end_date,
    )

    conflict_count = len(conflicts)
    on_leave_count = conflict_count + 1
    exceeds_threshold = dept_size > 0 and (on_leave_count / dept_size) > 0.30

    return {
        "conflicts": [dict(r) for r in conflicts],
        "conflict_count": conflict_count,
        "department": emp["department"],
        "department_size": dept_size,
        "on_leave_count": on_leave_count,
        "exceeds_threshold": exceeds_threshold,
    }


# ── Team Performance Summary ────────────────────────────────

@router.get("/performance/summary")
async def performance_summary(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    today = date.today()
    if not from_date:
        from_date = f"{today.year}-{today.month:02d}-01"
    if not to_date:
        to_date = today.isoformat()

    rows = await pool.fetch(
        "SELECT e.id, e.name, e.department, "
        "COUNT(*) FILTER (WHERE a.status='present') as days_present, "
        "COUNT(*) FILTER (WHERE a.status='absent') as days_absent, "
        "COUNT(*) FILTER (WHERE a.status='late') as days_late, "
        "COALESCE(SUM(a.work_hours),0) as total_work_hours, "
        "COALESCE(ROUND(AVG(a.work_hours)::numeric,2),0) as avg_work_hours, "
        "COALESCE(SUM(a.overtime_hours),0) as overtime_hours, "
        "COALESCE(("
        "  SELECT SUM(lr.days) FROM staging.manav_leave_requests lr "
        "  WHERE lr.employee_id=e.id AND lr.status='approved' "
        "  AND lr.start_date >= $2::date AND lr.end_date <= $3::date"
        "),0) as leaves_taken "
        "FROM staging.manav_employees e "
        "LEFT JOIN staging.manav_attendance a ON a.employee_id=e.id "
        "  AND a.date >= $2::date AND a.date <= $3::date "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE AND e.status='active' "
        "GROUP BY e.id, e.name, e.department ORDER BY e.name",
        org_id, from_date, to_date,
    )
    return {"data": [dict(r) for r in rows], "from_date": from_date, "to_date": to_date}


# ── Shift Definitions ───────────────────────────────────────

class ShiftCreate(BaseModel):
    name: str
    start_time: str
    end_time: str
    break_minutes: int = 0
    color: str = "#3B82F6"


class ShiftUpdate(BaseModel):
    name: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    break_minutes: int | None = None
    color: str | None = None
    is_active: bool | None = None


@router.get("/shifts", dependencies=[Depends(_gate)])
async def list_shifts(user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_shift_definitions "
        "WHERE org_id=$1::uuid ORDER BY start_time",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/shifts", dependencies=[Depends(_gate)])
async def create_shift(body: ShiftCreate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_definitions "
        "(org_id, name, start_time, end_time, break_minutes, color) "
        "VALUES ($1::uuid, $2, $3::time, $4::time, $5, $6) "
        "ON CONFLICT (org_id, name) DO UPDATE SET "
        "start_time=$3::time, end_time=$4::time, break_minutes=$5, color=$6, is_active=TRUE "
        "RETURNING id, name",
        org_id, body.name, body.start_time, body.end_time, body.break_minutes, body.color,
    )
    return {"status": "created", **dict(row)}


@router.patch("/shifts/{shift_id}", dependencies=[Depends(_gate)])
async def update_shift(shift_id: UUID, body: ShiftUpdate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets, params = [], [str(shift_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("start_time", "end_time"):
            sets.append(f"{k}=${idx}::time")
        else:
            sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    await pool.execute(
        f"UPDATE staging.manav_shift_definitions SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


# ── Schedules ───────────────────────────────────────────────

class ScheduleAssign(BaseModel):
    employee_id: str
    shift_id: str
    date: str
    notes: str = ""


class ScheduleBulkAssign(BaseModel):
    assignments: list[ScheduleAssign]


@router.get("/schedules", dependencies=[Depends(_gate)])
async def list_schedules(
    date_from: str | None = None,
    date_to: str | None = None,
    employee_id: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    query = (
        "SELECT s.*, e.name AS employee_name, e.department, "
        "sd.name AS shift_name, sd.start_time, sd.end_time, sd.color "
        "FROM staging.manav_schedules s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s.shift_id "
        "WHERE s.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2
    if date_from:
        query += f"AND s.date >= ${idx}::date "
        params.append(date_from)
        idx += 1
    if date_to:
        query += f"AND s.date <= ${idx}::date "
        params.append(date_to)
        idx += 1
    if employee_id:
        query += f"AND s.employee_id = ${idx}::uuid "
        params.append(employee_id)
        idx += 1
    query += "ORDER BY s.date, sd.start_time LIMIT 500"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/schedules", dependencies=[Depends(_gate)])
async def assign_schedule(body: ScheduleAssign, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_schedules "
        "(org_id, employee_id, shift_id, date, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5, $6) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "shift_id=$3::uuid, notes=$5, status='scheduled' "
        "RETURNING id",
        org_id, body.employee_id, body.shift_id, body.date, body.notes, user["user_id"],
    )
    return {"status": "assigned", "id": str(row["id"])}


@router.post("/schedules/bulk", dependencies=[Depends(_gate)])
async def bulk_assign(body: ScheduleBulkAssign, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    created = 0
    for a in body.assignments:
        await pool.execute(
            "INSERT INTO staging.manav_schedules "
            "(org_id, employee_id, shift_id, date, notes, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5, $6) "
            "ON CONFLICT (employee_id, date) DO UPDATE SET "
            "shift_id=$3::uuid, notes=$5, status='scheduled'",
            org_id, a.employee_id, a.shift_id, a.date, a.notes, user["user_id"],
        )
        created += 1
    return {"status": "assigned", "count": created}


@router.get("/schedules/coverage", dependencies=[Depends(_gate)])
async def schedule_coverage(
    date_from: str,
    date_to: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT s.date, sd.name AS shift_name, sd.id AS shift_id, "
        "COUNT(s.id) AS assigned_count "
        "FROM staging.manav_schedules s "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s.shift_id "
        "WHERE s.org_id=$1::uuid AND s.date >= $2::date AND s.date <= $3::date "
        "GROUP BY s.date, sd.id, sd.name ORDER BY s.date, sd.name",
        org_id, date_from, date_to,
    )
    # Also get employee count for gap detection
    total_active = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND status='active'",
        org_id,
    )
    return {"coverage": [dict(r) for r in rows], "total_employees": total_active}


# ── Availability ────────────────────────────────────────────

class AvailabilitySet(BaseModel):
    date: str
    is_available: bool = True
    preferred_shift_id: str | None = None
    notes: str = ""


@router.get("/availability", dependencies=[Depends(_gate)])
async def list_availability(
    employee_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    query = "SELECT a.*, e.name AS employee_name FROM staging.manav_availability a " \
            "JOIN staging.manav_employees e ON e.id = a.employee_id " \
            "WHERE a.org_id=$1::uuid "
    params: list = [org_id]
    idx = 2
    if employee_id:
        query += f"AND a.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1
    if date_from:
        query += f"AND a.date >= ${idx}::date "
        params.append(date_from)
        idx += 1
    if date_to:
        query += f"AND a.date <= ${idx}::date "
        params.append(date_to)
        idx += 1
    query += "ORDER BY a.date LIMIT 500"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/availability", dependencies=[Depends(_gate)])
async def set_availability(body: AvailabilitySet, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    # Find employee by user_id
    emp = await pool.fetchval(
        "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(404, "Employee record not found for your account")
    await pool.execute(
        "INSERT INTO staging.manav_availability "
        "(org_id, employee_id, date, is_available, preferred_shift_id, notes) "
        "VALUES ($1::uuid, $2, $3::date, $4, NULLIF($5,'')::uuid, $6) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "is_available=$4, preferred_shift_id=NULLIF($5,'')::uuid, notes=$6",
        org_id, emp, body.date, body.is_available,
        body.preferred_shift_id or "", body.notes,
    )
    return {"status": "saved"}


# ── Shift Bids ──────────────────────────────────────────────

class ShiftBidCreate(BaseModel):
    shift_id: str
    date: str
    slots_needed: int = 1


@router.get("/shift-bids", dependencies=[Depends(_gate)])
async def list_bids(
    status: str = "open",
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT b.*, sd.name AS shift_name, sd.start_time, sd.end_time, sd.color, "
        "(SELECT COUNT(*) FROM staging.manav_shift_bid_responses WHERE bid_id=b.id) AS responses "
        "FROM staging.manav_shift_bids b "
        "JOIN staging.manav_shift_definitions sd ON sd.id = b.shift_id "
        "WHERE b.org_id=$1::uuid AND b.status=$2 ORDER BY b.date",
        org_id, status,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/shift-bids", dependencies=[Depends(_gate)])
async def create_bid(body: ShiftBidCreate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_bids "
        "(org_id, shift_id, date, slots_needed, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::date, $4, $5) RETURNING id",
        org_id, body.shift_id, body.date, body.slots_needed, user["user_id"],
    )
    return {"status": "created", "id": str(row["id"])}


@router.post("/shift-bids/{bid_id}/apply", dependencies=[Depends(_gate)])
async def apply_to_bid(bid_id: UUID, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    emp = await pool.fetchval(
        "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(404, "Employee record not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_bid_responses (bid_id, employee_id) "
        "VALUES ($1::uuid, $2) "
        "ON CONFLICT (bid_id, employee_id) DO NOTHING RETURNING id",
        str(bid_id), emp,
    )
    return {"status": "applied" if row else "already_applied"}


@router.post("/shift-bids/{bid_id}/accept/{employee_id}", dependencies=[Depends(_gate)])
async def accept_bid(bid_id: UUID, employee_id: UUID, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    bid = await pool.fetchrow(
        "SELECT * FROM staging.manav_shift_bids WHERE id=$1::uuid AND org_id=$2::uuid",
        str(bid_id), org_id,
    )
    if not bid:
        raise HTTPException(404, "Bid not found")
    await pool.execute(
        "UPDATE staging.manav_shift_bid_responses SET status='accepted' "
        "WHERE bid_id=$1::uuid AND employee_id=$2::uuid",
        str(bid_id), str(employee_id),
    )
    # Auto-create schedule
    await pool.execute(
        "INSERT INTO staging.manav_schedules "
        "(org_id, employee_id, shift_id, date, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET shift_id=$3, status='scheduled'",
        org_id, str(employee_id), bid["shift_id"], bid["date"], user["user_id"],
    )
    return {"status": "accepted"}


# ── Swap Requests ───────────────────────────────────────────

class SwapCreate(BaseModel):
    requester_schedule_id: str
    target_employee_id: str = ""
    reason: str = ""


@router.post("/swaps", dependencies=[Depends(_gate)])
async def create_swap(body: SwapCreate, user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_swap_requests "
        "(org_id, requester_schedule_id, target_employee_id, reason) "
        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4) RETURNING id",
        org_id, body.requester_schedule_id,
        body.target_employee_id, body.reason,
    )
    return {"status": "requested", "id": str(row["id"])}


@router.get("/swaps", dependencies=[Depends(_gate)])
async def list_swaps(status: str = "pending", user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT sw.*, "
        "e1.name AS requester_name, e2.name AS target_name, "
        "s1.date AS schedule_date, sd.name AS shift_name "
        "FROM staging.manav_swap_requests sw "
        "JOIN staging.manav_schedules s1 ON s1.id = sw.requester_schedule_id "
        "JOIN staging.manav_employees e1 ON e1.id = s1.employee_id "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s1.shift_id "
        "LEFT JOIN staging.manav_employees e2 ON e2.id = sw.target_employee_id "
        "WHERE sw.org_id=$1::uuid AND sw.status=$2 ORDER BY sw.created_at DESC",
        org_id, status,
    )
    return {"data": [dict(r) for r in rows]}


@router.patch("/swaps/{swap_id}", dependencies=[Depends(_gate)])
async def action_swap(swap_id: UUID, action: str, user=Depends(require_user), org_id=Depends(get_org_id)):
    if action not in ("approved", "rejected"):
        raise HTTPException(400, "action must be 'approved' or 'rejected'")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.manav_swap_requests SET status=$1, approved_by=$2 "
        "WHERE id=$3::uuid AND org_id=$4::uuid",
        action, user["user_id"], str(swap_id), org_id,
    )
    if action == "approved":
        swap = await pool.fetchrow(
            "SELECT * FROM staging.manav_swap_requests WHERE id=$1::uuid", str(swap_id)
        )
        if swap and swap["target_employee_id"]:
            sched = await pool.fetchrow(
                "SELECT * FROM staging.manav_schedules WHERE id=$1",
                swap["requester_schedule_id"],
            )
            if sched:
                # Swap shifts between requester and target
                target_sched = await pool.fetchrow(
                    "SELECT * FROM staging.manav_schedules "
                    "WHERE employee_id=$1 AND date=$2",
                    swap["target_employee_id"], sched["date"],
                )
                if target_sched:
                    await pool.execute(
                        "UPDATE staging.manav_schedules SET shift_id=$1, status='swapped' WHERE id=$2",
                        target_sched["shift_id"], sched["id"],
                    )
                    await pool.execute(
                        "UPDATE staging.manav_schedules SET shift_id=$1, status='swapped' WHERE id=$2",
                        sched["shift_id"], target_sched["id"],
                    )
    return {"status": action}
