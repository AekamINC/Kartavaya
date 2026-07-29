"""
manav.py — Manav · मानव (HRMS) Router
Employee directory, departments, attendance, leave management, holidays.
"""
import json
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import is_org_admin, is_platform_staff, require_org_role
from middleware.role_tiers import (
    ADMIN, APPROVER, EDITOR, ORG_MANAGEMENT_ROLES, VIEWER,
    any_level_satisfies, require_module_or_self,
)
from services.audit import emit as audit
from services.encryption import decrypt, encrypt, is_encrypted
from services.pii import mask_bank, mask_tail

router = APIRouter(prefix="/api/v1/manav", tags=["manav-hrms"])

MODULE = "manav"

#: The gate AND the answer: its value is the caller's Tier-4 level set, resolved
#: once per request. An EMPTY set is admitted deliberately — Manav is in
#: role_tiers.SELF_SCOPED_MODULES, so an employee with no grant at all still
#: reads their own profile, attendance, leave and claims.
_gate = require_module_or_self(MODULE)

# F4 (b) — shared, not re-implemented. See graha.py's docstring: two copies of a
# response contract is how one ends up reporting a total the other does not.
from routers.graha import _listed  # noqa: E402

# Reading an identity document needs more than module membership. Declared here
# rather than inline so tests can override it, same as `_gate`. The role names
# come from role_tiers, not from two string literals written out here.
_pii_gate = require_org_role(*ORG_MANAGEMENT_ROLES)

# ── Who may see what in HR ────────────────────────────────────────────────────
#
# SELF SCOPE (role_tiers.SELF_SCOPED_MODULES): "every employee gets read access
# to THEIR OWN record with no grant at all — own payslip, own profile, own
# attendance. Anything beyond their own row needs a grant."
#
# So an empty level set reads the caller's own employee row, own attendance, own
# leave, own claims, own schedule, own assets — and nothing about anybody else.
# It is a query filter, not a grant row.
#
# Self scope is READ-ONLY over records the employer owns. It does NOT extend to
# editing a personnel file, marking attendance, or actioning anything. The one
# category of write it does reach is the employee's OWN SUBMISSIONS — their leave
# request, their expense claim, their availability, their shift-bid application —
# each of which resolves the employee id from the caller and never from the body.
# Those are the employee authoring their own request, not editing an HR record;
# submitting a leave request has never been an HR permission and requiring an
# editor grant for it would mean every employee also gets to edit everyone's
# attendance.
#
# Manav is NOT a separated-duty module (only vetana and ganit are), so admin does
# satisfy approver here. That is still resolved through
# `any_level_satisfies(...)` rather than assumed, so the day Manav is added to
# SEPARATED_DUTY_MODULES this file changes behaviour without changing code.
#
# Reference data with no employee in it — leave types, holidays, announcements,
# shift definitions, open shift bids — is readable at self scope. An employee has
# to know the holiday calendar and the leave types to make a request about their
# own record. Everything that names another person needs viewer.

from datetime import time as _dt_time

# ── Employee PII ──────────────────────────────────────────────────────────────
# `manav_employees` holds an identity kit: Aadhaar number, PAN, and bank
# details on the same row as the name. `require_module("manav")` grants on
# module membership with no role level, so a module *viewer* passes it — which
# means the full row must never be reachable through the ordinary detail
# endpoint. Two rules, both enforced below:
#
#   1. The detail endpoint selects an explicit column list and masks what it
#      returns. It never emits a full Aadhaar, PAN or account number.
#   2. Full values come only from GET /employees/{id}/sensitive, which requires
#      an org owner or admin and writes an audit row on every single read.
#
# `SELECT *` is banned on this table for exactly this reason: a column added
# later would start leaking the day it was added, with no code change to review.

# Everything on the row that is NOT part of the identity kit. Kept as one
# string so the detail and list endpoints cannot drift apart silently.
_EMP_SAFE_COLS = (
    "id, org_id, user_id, employee_code, name, email, phone, department, "
    "designation, date_of_joining, date_of_birth, gender, blood_group, "
    "emergency_contact, address, uan, esi_number, employment_type, status, "
    "reporting_to, shift, created_by, is_active, created_at, updated_at, "
    "hourly_rate"
)

_SENSITIVE_COLS = ("aadhaar", "pan", "bank_details")

#: Columns held as ciphertext in the database.
#:
#: `aadhaar` only, deliberately. It is the field that turns an employee record
#: into an identity kit, and the owner's decision was to keep the column rather
#: than drop it (see the header of PROPOSED_063_employee_pii.sql) — so the
#: remaining lever is what it costs when the row leaks.
#:
#: `pan` and `bank_details` are masked on read like aadhaar but are NOT
#: encrypted, for one reason: Vetana reads both off this table when it builds a
#: payslip, so encrypting them means finding and fixing every reader. Aadhaar
#: has no reader at all, which is what makes it safe to do alone and first.
#: Adding a column here is one entry plus a backfill for that column.
_ENCRYPTED_COLS = ("aadhaar",)


def _decrypt_cols(row: dict) -> dict:
    """Plaintext copy of a row read from the database.

    Called at the point of read so everything downstream — masking, the audited
    reveal, the payslip builder — keeps seeing plaintext and needs no knowledge
    of how the column is stored.

    A value that is still marked after `decrypt()` did not open: the key
    changed. Serving that to a caller would put `enc::gAAAA…` where an Aadhaar
    number belongs, and the masker would happily render its last four
    characters as though they meant something. Fail instead.
    """
    out = dict(row)
    for col in _ENCRYPTED_COLS:
        value = out.get(col)
        if not value:
            continue
        plain = decrypt(value)
        if is_encrypted(plain):
            raise HTTPException(
                500,
                f"Stored {col} could not be decrypted. FIELD_ENCRYPTION_KEY has "
                "changed or is not the key this row was written under.",
            )
        out[col] = plain
    return out


def _encrypt_cols(values: dict) -> dict:
    """Copy of a write payload with the encrypted columns enciphered.

    `encrypt()` is idempotent and returns empty/None untouched, so this is safe
    on partial updates and on rows that carry no aadhaar at all.
    """
    out = dict(values)
    for col in _ENCRYPTED_COLS:
        if out.get(col):
            out[col] = encrypt(out[col])
    return out


# The masking rules now live in services/pii.py, because Vetana reads the same
# PAN / UAN / bank_details columns off this table when it builds a payslip and
# was returning them unmasked. Aliased here so the names used throughout this
# file — and asserted by test_manav.py — keep working.
_mask_tail = mask_tail
_mask_bank = mask_bank


def _mask_employee_pii(row: dict) -> dict:
    """Return a copy carrying masked identifiers. Aadhaar is grouped 4-4-4
    because that is how it is printed and how people check it."""
    out = dict(row)
    if "aadhaar" in out:
        out["aadhaar"] = _mask_tail(out["aadhaar"], 4, group=4)
    if "pan" in out:
        out["pan"] = _mask_tail(out["pan"], 4)
    if "bank_details" in out:
        out["bank_details"] = _mask_bank(out["bank_details"])
    out["_pii_masked"] = True
    return out


def _can(levels, required: str) -> bool:
    """Does this caller's level set satisfy `required` on Manav?

    Always through role_tiers — never `LEVELS.index(a) >= LEVELS.index(b)` at a
    call site, which is the comparison that quietly lets admin approve on a
    separated-duty module.
    """
    return any_level_satisfies(levels, required, MODULE)


def _require(levels, required: str) -> None:
    if _can(levels, required):
        return
    raise HTTPException(
        403,
        f"This action needs '{required}' on Manav. Without a grant you can see "
        "your own HR record and nothing else.",
    )


async def _own_employee_id(pool, user, org_id: str) -> str | None:
    """The caller's own employee row in this org, if they have one.

    None is a real answer and it means NO ACCESS, not unrestricted access: a
    caller with no grant and no employee row has no own-row to be scoped to.
    """
    return await pool.fetchval(
        "SELECT id::text FROM staging.manav_employees "
        "WHERE user_id=$1 AND org_id=$2::uuid AND is_active=TRUE LIMIT 1",
        user["user_id"], org_id,
    )


def _parse_date(s: str) -> date:
    return date.fromisoformat(s)


def _parse_time(s: str) -> _dt_time:
    parts = s.split(":")
    return _dt_time(int(parts[0]), int(parts[1]))


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
    employee_id: str = ""
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


class ExpenseClaimCreate(BaseModel):
    employee_id: str = ""
    category: str = "other"
    expense_date: str
    amount: float
    description: str = ""
    receipt_urls: list[str] = []


class ExpenseClaimAction(BaseModel):
    status: str
    rejection_reason: str = ""


class JobOpeningCreate(BaseModel):
    title: str
    department_id: str = ""
    description: str = ""


class JobOpeningUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None


class CandidateCreate(BaseModel):
    job_opening_id: str
    full_name: str
    email: str = ""
    phone: str = ""
    resume_url: str = ""
    notes: str = ""


class CandidateStageUpdate(BaseModel):
    stage: str
    rejection_reason: str = ""


# ── Employees ────────────────────────────────────────────────

@router.get("/employees")
async def list_employees(
    department: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT id, employee_code, name, email, phone, department, designation, "
        "employment_type, status, date_of_joining, shift, created_at, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    # The employee directory is other people. Without a grant the "directory" is
    # one row long — the caller's own — and empty if they have no employee row.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            # Same envelope as the populated path below. A caller reading
            # `total` must not get `undefined` here just because the list is
            # empty for a permissions reason rather than a data one — that is
            # how a "showing N of M" strip ends up rendering "showing 0 of".
            return {"data": [], "total": 0, "limit": 500, "truncated": False}
        query += f"AND id=${idx}::uuid "
        params.append(own)
        idx += 1

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
    return _listed(rows, limit=500)


@router.post("/employees")
async def create_employee(
    body: EmployeeCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # A personnel file carries Aadhaar, PAN and bank details.
    _require(levels, ADMIN)

    valid_types = ("full_time", "part_time", "contract", "intern", "consultant")
    if body.employment_type not in valid_types:
        raise HTTPException(400, f"employment_type must be one of: {', '.join(valid_types)}")

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_employees "
        "(org_id, user_id, employee_code, name, email, phone, department, designation, "
        " date_of_joining, date_of_birth, gender, blood_group, emergency_contact, "
        " address, bank_details, pan, aadhaar, uan, esi_number, employment_type, "
        " reporting_to, shift, created_by) "
        "VALUES ($1::uuid, NULLIF($2,''), NULLIF($3,''), $4, $5, $6, $7, $8, "
        " NULLIF($9,'')::date, NULLIF($10,'')::date, NULLIF($11,''), $12, $13, $14, $15, "
        " $16, $17, $18, $19, $20, NULLIF($21,''), $22, $23) "
        "RETURNING id, name, employee_code",
        org_id, body.user_id, body.employee_code, body.name, body.email, body.phone,
        body.department, body.designation, body.date_of_joining, body.date_of_birth,
        # `body.address` and `body.bank_details` are passed as DICTS, exactly
        # like `body.emergency_contact` beside them — NOT through `json.dumps`.
        #
        # `db.py` registers a jsonb codec whose encoder IS `json.dumps`, so
        # dumping first encodes twice and the column ends up holding a JSON
        # *string* rather than an object. This one INSERT is the cleanest proof
        # of it in the codebase: three jsonb columns, written side by side, and
        # the only one that stored correctly was the one passed as a dict —
        # measured live, `emergency_contact` came back `object` while `address`
        # and `bank_details` both came back `string`.
        #
        # The consequence was not cosmetic. `_mask_employee_pii` calls
        # `_mask_bank(row["bank_details"])`, which expects a mapping, so
        # **`GET /v1/manav/employees/{id}` returned 500 for every employee in
        # the org** — the whole employee detail view was dead, and the failure
        # reached the browser as a CORS error because the exception escaped
        # before `CORSMiddleware` attached its headers.
        body.gender or None, body.blood_group, body.emergency_contact, body.address,
        body.bank_details, body.pan, encrypt(body.aadhaar), body.uan, body.esi_number,
        body.employment_type, body.reporting_to, body.shift, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.get("/employees/{employee_id}")
async def get_employee(
    employee_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Explicit column list, never SELECT *. The identity-kit columns are fetched
    # separately and masked, so a column added to the table later cannot start
    # leaking without someone editing this list.
    row = await pool.fetchrow(
        f"SELECT {_EMP_SAFE_COLS}, aadhaar, pan, bank_details "
        "FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Employee not found")

    # Own profile with no grant at all — the SELF_SCOPED_MODULES promise. Anyone
    # else's needs viewer. 404 rather than 403 so the answer does not confirm
    # that an employee with that id exists in this org.
    if row["user_id"] != user["user_id"] and not _can(levels, VIEWER):
        raise HTTPException(404, "Employee not found")

    leave_balances = await pool.fetch(
        "SELECT lb.*, lt.name as leave_name, lt.code as leave_code "
        "FROM staging.manav_leave_balances lb "
        "JOIN staging.manav_leave_types lt ON lt.id = lb.leave_type_id "
        "WHERE lb.employee_id=$1::uuid AND lb.year=EXTRACT(YEAR FROM CURRENT_DATE)::int",
        str(employee_id),
    )
    return {
        # Decrypt BEFORE masking. Masking ciphertext would render the last four
        # characters of a Fernet token and present them as the last four digits
        # of an Aadhaar number.
        "employee": _mask_employee_pii(_decrypt_cols(dict(row))),
        "leave_balances": [dict(lb) for lb in leave_balances],
    }


@router.get("/employees/{employee_id}/sensitive")
async def get_employee_sensitive(
    employee_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
    _r=Depends(_pii_gate),
):
    """Full Aadhaar, PAN and bank account for one employee.

    Separate from the detail endpoint on purpose: module membership is not
    sufficient authority to read an identity document, so this requires an org
    owner or admin. Every read is audited, including reads by platform staff —
    `require_org_role` passes them unconditionally, so without the audit row
    below their access would be silent, which the project's standing rule
    forbids.

    BOTH gates, deliberately. `_pii_gate` is the org role and `admin` is the
    module level; an unmasked Aadhaar is the highest bar in this file and it
    keeps whichever of the two is stricter. There is no self-scoped path here on
    purpose — an employee reading their OWN Aadhaar back from the server is not
    a flow the product has, and adding it would make this endpoint reachable by
    everyone in the org.
    """
    _require(levels, ADMIN)
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, employee_code, aadhaar, pan, bank_details "
        "FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(employee_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Employee not found")

    via_platform = await is_platform_staff(user["user_id"])
    audit(
        "manav.employee_pii_revealed",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="manav_employee",
        resource_id=str(employee_id),
        detail={
            "fields": list(_SENSITIVE_COLS),
            "via": "platform_bypass" if via_platform else "org_admin",
        },
        severity="warn",
    )
    return {"employee": _decrypt_cols(dict(row)), "audited": True}


@router.patch("/employees/{employee_id}")
async def update_employee(
    employee_id: UUID,
    body: EmployeeUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Same row, same identity kit.
    _require(levels, ADMIN)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    # Before the SET list is built below, so the generic column loop never sees
    # a plaintext aadhaar and cannot write one simply by not knowing about it.
    updates = _encrypt_cols(updates)

    sets = []
    params = [str(employee_id), org_id]
    idx = 3
    jsonb_fields = {"address", "bank_details"}
    for k, v in updates.items():
        if k in jsonb_fields:
            # `::text::jsonb`, not `::jsonb` — see the INSERT above. Binding an
            # already-dumped string to a jsonb parameter runs it through the
            # codec's `json.dumps` a second time and stores a JSON string.
            sets.append(f"{k}=${idx}::text::jsonb")
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Terminating someone is not an editor's call.
    _require(levels, ADMIN)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Names a department head, so it names a person.
    _require(levels, VIEWER)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_departments (org_id, name, head_employee_id) "
        "VALUES ($1::uuid, $2, NULLIF($3,'')::uuid) RETURNING id, name",
        org_id, body.name, body.head_employee_id,
    )
    return {"status": "created", **dict(row)}


@router.patch("/departments/{dept_id}")
async def update_department(
    dept_id: str,
    body: DepartmentCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "UPDATE staging.manav_departments SET name=$3, head_employee_id=NULLIF($4,'')::uuid "
        "WHERE id=$1::uuid AND org_id=$2::uuid RETURNING id, name",
        dept_id, org_id, body.name, body.head_employee_id,
    )
    if not row:
        raise HTTPException(404, "Department not found")
    return {"status": "updated", **dict(row)}


@router.delete("/departments/{dept_id}")
async def delete_department(
    dept_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    emp_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees e "
        "JOIN staging.manav_departments d ON d.name = e.department AND d.org_id = e.org_id "
        "WHERE d.id=$1::uuid AND d.org_id=$2::uuid AND e.is_active=TRUE",
        dept_id, org_id,
    )
    if emp_count and emp_count > 0:
        raise HTTPException(400, f"Cannot delete — {emp_count} active employee(s) in this department")
    await pool.execute(
        "UPDATE staging.manav_departments SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        dept_id, org_id,
    )
    return {"status": "deleted"}


# ── Attendance ───────────────────────────────────────────────

@router.get("/attendance")
async def list_attendance(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    d_from = date.fromisoformat(date_from) if date_from else date.today()
    d_to = date.fromisoformat(date_to) if date_to else d_from

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

    # Own attendance with no grant; anyone else's needs viewer. Asking for a
    # colleague's employee_id from self scope is refused rather than silently
    # rewritten, so the caller is not told an empty list means "no records".
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own attendance")
        employee_id = own

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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Marks attendance for ANY employee — never reachable at self scope.
    _require(levels, EDITOR)
    att_date = date.fromisoformat(body.date) if body.date else date.today()

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
    levels=Depends(_gate),
):
    pool = await get_pool()
    if month:
        year, mo = month.split("-")
    else:
        today = date.today()
        year, mo = str(today.year), f"{today.month:02d}"

    start = _parse_date(f"{year}-{mo}-01")
    if int(mo) < 12:
        end = _parse_date(f"{year}-{int(mo)+1:02d}-01")
    else:
        end = _parse_date(f"{int(year)+1}-01-01")

    query = (
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
        "  AND a.date >= $2 AND a.date < $3 "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE "
    )
    params: list = [org_id, start, end]

    # The monthly summary is one row per employee. At self scope it is one row.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": [], "month": f"{year}-{mo}"}
        params.append(own)
        query += f"AND e.id=${len(params)}::uuid "

    query += "GROUP BY e.id, e.name, e.employee_code ORDER BY e.name"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows], "month": f"{year}-{mo}"}


# ── Leave Types ──────────────────────────────────────────────

@router.get("/leave-types")
async def list_leave_types(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Reference data with no employee in it. Readable at self scope: an employee
    # cannot request leave against their own record without knowing the types.
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Leave policy is org configuration.
    _require(levels, ADMIN)
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
    levels=Depends(_gate),
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

    # A leave request carries a reason, which is routinely medical or personal.
    # Own only without a grant.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own leave requests")
        employee_id = own

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
    levels=Depends(_gate),
):
    pool = await get_pool()

    # Submitting YOUR OWN leave request is reachable at self scope: the employee
    # id comes from the caller's own row, never from the body, so this is the
    # employee authoring their own request rather than editing an HR record.
    # Filing one FOR SOMEONE ELSE is an HR action and needs an editor grant.
    if body.employee_id:
        _require(levels, EDITOR)
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            body.employee_id, org_id,
        )
        if not emp:
            raise HTTPException(404, "Employee not found")
    else:
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees "
            "WHERE org_id=$1::uuid AND user_id=$2 AND is_active=TRUE",
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
        date.fromisoformat(body.start_date), date.fromisoformat(body.end_date),
        body.days, body.reason,
    )
    return {"status": "submitted", "id": str(row["id"])}


@router.patch("/leaves/{leave_id}/action")
async def action_leave_request(
    leave_id: UUID,
    body: LeaveAction,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Approving leave is the approver rung. Manav is hierarchical, so
    # admin satisfies it — decided by level_satisfies, not assumed here.
    _require(levels, APPROVER)
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "Status must be 'approved' or 'rejected'")

    lr = await pool.fetchrow(
        "SELECT employee_id, leave_type_id, days, status, start_date, end_date FROM staging.manav_leave_requests "
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

    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", str(lr["employee_id"]),
    )
    if emp and emp.get("email"):
        lt_row = await pool.fetchrow(
            "SELECT name FROM staging.manav_leave_types WHERE id=$1::uuid", str(lr["leave_type_id"]),
        )
        from services.employee_email import send_leave_decision_email
        send_leave_decision_email(
            emp["email"], emp["name"],
            lt_row["name"] if lt_row else "Leave",
            str(lr["start_date"]), str(lr["end_date"]),
            body.status, user.get("name", "Admin"),
        )

    return {"status": body.status}


# ── Holidays ─────────────────────────────────────────────────

@router.get("/holidays")
async def list_holidays(
    year: Optional[int] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # The holiday calendar names nobody. Readable at self scope.
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_holidays (org_id, name, date, is_optional) "
        "VALUES ($1::uuid, $2, $3, $4) RETURNING id, name, date",
        org_id, body.name, _parse_date(body.date), body.is_optional,
    )
    return {"status": "created", **dict(row)}


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(
    holiday_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Org-wide headcount and today's attendance.
    _require(levels, VIEWER)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Announcements are broadcast to the whole org by design — every employee is
    # already emailed one when it is posted. Readable at self scope.
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Emails every active employee in the org.
    _require(levels, EDITOR)

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
    # ── Notify all active employees ──
    employees = await pool.fetch(
        "SELECT name, email FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND email IS NOT NULL AND email != ''",
        org_id,
    )
    if employees:
        from services.employee_email import send_announcement_email
        for e in employees:
            send_announcement_email(e["email"], e["name"], body.title, body.body)

    return {"status": "created", **dict(row)}


@router.patch("/announcements/{announcement_id}")
async def update_announcement(
    announcement_id: UUID,
    body: AnnouncementUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Returns colleagues' leave dates by department.
    _require(levels, VIEWER)

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
        "AND lr.start_date <= $5 AND lr.end_date >= $4 "
        "ORDER BY lr.start_date",
        org_id, emp["department"], employee_id, _parse_date(start_date), _parse_date(end_date),
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Per-employee attendance for the whole org.
    _require(levels, VIEWER)

    today = date.today()
    if not from_date:
        from_date = date(today.year, today.month, 1)
    else:
        from_date = date.fromisoformat(from_date)
    if not to_date:
        to_date = today
    else:
        to_date = date.fromisoformat(to_date)

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


@router.get("/shifts")
async def list_shifts(user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Shift definitions name nobody — they are the org's shift catalogue, and an
    # employee needs them to read their own roster. Readable at self scope.
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_shift_definitions "
        "WHERE org_id=$1::uuid ORDER BY start_time",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/shifts")
async def create_shift(body: ShiftCreate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Shift definitions are org configuration.
    _require(levels, ADMIN)
    st, et = _parse_time(body.start_time), _parse_time(body.end_time)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_definitions "
        "(org_id, name, start_time, end_time, break_minutes, color) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6) "
        "ON CONFLICT (org_id, name) DO UPDATE SET "
        "start_time=$3, end_time=$4, break_minutes=$5, color=$6, is_active=TRUE "
        "RETURNING id, name",
        org_id, body.name, st, et, body.break_minutes, body.color,
    )
    return {"status": "created", **dict(row)}


@router.patch("/shifts/{shift_id}")
async def update_shift(shift_id: UUID, body: ShiftUpdate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    _require(levels, ADMIN)
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets, params = [], [str(shift_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("start_time", "end_time"):
            sets.append(f"{k}=${idx}")
            v = _parse_time(v)
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


@router.get("/schedules")
async def list_schedules(
    date_from: str | None = None,
    date_to: str | None = None,
    employee_id: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
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

    # Own roster at self scope; the whole rota needs viewer.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own schedule")
        employee_id = own

    if date_from:
        query += f"AND s.date >= ${idx} "
        params.append(_parse_date(date_from))
        idx += 1
    if date_to:
        query += f"AND s.date <= ${idx} "
        params.append(_parse_date(date_to))
        idx += 1
    if employee_id:
        query += f"AND s.employee_id = ${idx}::uuid "
        params.append(employee_id)
        idx += 1
    query += "ORDER BY s.date, sd.start_time LIMIT 500"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/schedules")
async def assign_schedule(body: ScheduleAssign, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Rosters someone else's day.
    _require(levels, EDITOR)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_schedules "
        "(org_id, employee_id, shift_id, date, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "shift_id=$3::uuid, notes=$5, status='scheduled' "
        "RETURNING id",
        org_id, body.employee_id, body.shift_id, _parse_date(body.date), body.notes, user["user_id"],
    )
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", body.employee_id,
    )
    shift = await pool.fetchrow(
        "SELECT name, start_time, end_time FROM staging.manav_shift_definitions WHERE id=$1::uuid", body.shift_id,
    )
    if emp and emp.get("email") and shift:
        from services.employee_email import send_shift_schedule_email
        send_shift_schedule_email(
            emp["email"], emp["name"], shift["name"],
            body.date, str(shift["start_time"]), str(shift["end_time"]),
        )

    return {"status": "assigned", "id": str(row["id"])}


@router.post("/schedules/bulk")
async def bulk_assign(body: ScheduleBulkAssign, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    _require(levels, EDITOR)
    created = 0
    for a in body.assignments:
        await pool.execute(
            "INSERT INTO staging.manav_schedules "
            "(org_id, employee_id, shift_id, date, notes, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) "
            "ON CONFLICT (employee_id, date) DO UPDATE SET "
            "shift_id=$3::uuid, notes=$5, status='scheduled'",
            org_id, a.employee_id, a.shift_id, _parse_date(a.date), a.notes, user["user_id"],
        )
        created += 1
    return {"status": "assigned", "count": created}


@router.get("/schedules/coverage")
async def schedule_coverage(
    date_from: str,
    date_to: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, VIEWER)
    rows = await pool.fetch(
        "SELECT s.date, sd.name AS shift_name, sd.id AS shift_id, "
        "COUNT(s.id) AS assigned_count "
        "FROM staging.manav_schedules s "
        "JOIN staging.manav_shift_definitions sd ON sd.id = s.shift_id "
        "WHERE s.org_id=$1::uuid AND s.date >= $2 AND s.date <= $3 "
        "GROUP BY s.date, sd.id, sd.name ORDER BY s.date, sd.name",
        org_id, _parse_date(date_from), _parse_date(date_to),
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


@router.get("/availability")
async def list_availability(
    employee_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    query = "SELECT a.*, e.name AS employee_name FROM staging.manav_availability a " \
            "JOIN staging.manav_employees e ON e.id = a.employee_id " \
            "WHERE a.org_id=$1::uuid "
    params: list = [org_id]
    idx = 2

    # Own availability at self scope; everyone's needs viewer.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own availability")
        employee_id = own

    if employee_id:
        query += f"AND a.employee_id=${idx}::uuid "
        params.append(employee_id)
        idx += 1
    if date_from:
        query += f"AND a.date >= ${idx} "
        params.append(_parse_date(date_from))
        idx += 1
    if date_to:
        query += f"AND a.date <= ${idx} "
        params.append(_parse_date(date_to))
        idx += 1
    query += "ORDER BY a.date LIMIT 500"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/availability")
async def set_availability(body: AvailabilitySet, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Self-service, and only ever for yourself: the employee id comes from the
    # caller's own row and the body has no field to override it. Reachable at
    # self scope for that reason.
    emp = await pool.fetchval(
        "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(404, "Employee record not found for your account")
    await pool.execute(
        "INSERT INTO staging.manav_availability "
        "(org_id, employee_id, date, is_available, preferred_shift_id, notes) "
        "VALUES ($1::uuid, $2, $3, $4, NULLIF($5,'')::uuid, $6) "
        "ON CONFLICT (employee_id, date) DO UPDATE SET "
        "is_available=$4, preferred_shift_id=NULLIF($5,'')::uuid, notes=$6",
        org_id, emp, _parse_date(body.date), body.is_available,
        body.preferred_shift_id or "", body.notes,
    )
    return {"status": "saved"}


# ── Shift Bids ──────────────────────────────────────────────

class ShiftBidCreate(BaseModel):
    shift_id: str
    date: str
    slots_needed: int = 1


@router.get("/shift-bids")
async def list_bids(
    status: str = "open",
    user=Depends(require_user),
    org_id=Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # An open bid is a shift offered to everyone; the row names no employee, only
    # a response count. Readable at self scope so an employee can apply.
    rows = await pool.fetch(
        "SELECT b.*, sd.name AS shift_name, sd.start_time, sd.end_time, sd.color, "
        "(SELECT COUNT(*) FROM staging.manav_shift_bid_responses WHERE bid_id=b.id) AS responses "
        "FROM staging.manav_shift_bids b "
        "JOIN staging.manav_shift_definitions sd ON sd.id = b.shift_id "
        "WHERE b.org_id=$1::uuid AND b.status=$2 ORDER BY b.date",
        org_id, status,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/shift-bids")
async def create_bid(body: ShiftBidCreate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Opens a shift to the whole org.
    _require(levels, EDITOR)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_bids "
        "(org_id, shift_id, date, slots_needed, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id",
        org_id, body.shift_id, _parse_date(body.date), body.slots_needed, user["user_id"],
    )
    return {"status": "created", "id": str(row["id"])}


@router.post("/shift-bids/{bid_id}/apply")
async def apply_to_bid(bid_id: UUID, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Applying is the employee volunteering for themselves — employee id from the
    # caller's own row, never from the path. Reachable at self scope.
    emp = await pool.fetchval(
        "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2",
        org_id, user["user_id"],
    )
    if not emp:
        raise HTTPException(404, "Employee record not found")
    # The bid must belong to this org. Without it a response row could be
    # attached to another tenant's bid by guessing a uuid.
    if not await pool.fetchval(
        "SELECT 1 FROM staging.manav_shift_bids WHERE id=$1::uuid AND org_id=$2::uuid",
        str(bid_id), org_id,
    ):
        raise HTTPException(404, "Bid not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_shift_bid_responses (bid_id, employee_id) "
        "VALUES ($1::uuid, $2) "
        "ON CONFLICT (bid_id, employee_id) DO NOTHING RETURNING id",
        str(bid_id), emp,
    )
    return {"status": "applied" if row else "already_applied"}


@router.post("/shift-bids/{bid_id}/accept/{employee_id}")
async def accept_bid(bid_id: UUID, employee_id: UUID, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Awards the shift and writes the schedule row.
    _require(levels, EDITOR)
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


@router.post("/swaps")
async def create_swap(body: SwapCreate, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Asking to give away YOUR OWN shift is self-service, so it is reachable at
    # self scope — but only for a shift that is actually yours. Offering someone
    # else's shift is rostering, which is the editor's job.
    #
    # The schedule must also be in this org. Without that check a uuid from
    # another tenant could be attached to a row here, and `GET /swaps` joins
    # through it and would print that tenant's employee name.
    sched = await pool.fetchrow(
        "SELECT s.id, e.user_id FROM staging.manav_schedules s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "WHERE s.id=$1::uuid AND s.org_id=$2::uuid",
        body.requester_schedule_id, org_id,
    )
    if not sched:
        raise HTTPException(404, "Schedule not found")
    if sched["user_id"] != user["user_id"]:
        _require(levels, EDITOR)
    if body.target_employee_id and not await pool.fetchval(
        "SELECT 1 FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        body.target_employee_id, org_id,
    ):
        raise HTTPException(404, "Employee not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_swap_requests "
        "(org_id, requester_schedule_id, target_employee_id, reason) "
        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4) RETURNING id",
        org_id, body.requester_schedule_id,
        body.target_employee_id, body.reason,
    )
    return {"status": "requested", "id": str(row["id"])}


@router.get("/swaps")
async def list_swaps(status: str = "pending", user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    pool = await get_pool()
    # Names both sides of every swap.
    _require(levels, VIEWER)
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


@router.patch("/swaps/{swap_id}")
async def action_swap(swap_id: UUID, action: str, user=Depends(require_user), org_id=Depends(get_org_id), levels=Depends(_gate)):
    if action not in ("approved", "rejected"):
        raise HTTPException(400, "action must be 'approved' or 'rejected'")
    pool = await get_pool()
    # Approving a swap moves two people's shifts.
    _require(levels, APPROVER)
    await pool.execute(
        "UPDATE staging.manav_swap_requests SET status=$1, approved_by=$2 "
        "WHERE id=$3::uuid AND org_id=$4::uuid",
        action, user["user_id"], str(swap_id), org_id,
    )
    if action == "approved":
        swap = await pool.fetchrow(
            "SELECT * FROM staging.manav_swap_requests WHERE id=$1::uuid AND org_id=$2::uuid", str(swap_id), org_id
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


# ── Expense Claims & Reimbursement ───────────────────────────

async def _is_org_admin(pool, user, org_id) -> bool:
    """Kept as a thin wrapper so the existing call sites don't all change.

    `pool` is now unused — middleware.roles owns the connection.
    """
    return await is_org_admin(user["user_id"], org_id)


@router.get("/expense-claims")
async def list_expense_claims(
    employee_id: str = "",
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    is_admin = await _is_org_admin(pool, user, org_id)
    q = (
        "SELECT c.*, e.name AS employee_name, e.employee_code "
        "FROM staging.manav_expense_claims c "
        "JOIN staging.manav_employees e ON e.id = c.employee_id "
        "WHERE c.org_id=$1::uuid AND c.is_active=TRUE"
    )
    params: list = [org_id]
    if not is_admin:
        params.append(user["user_id"])
        q += f" AND e.user_id=${len(params)}"
    elif employee_id:
        params.append(employee_id)
        q += f" AND c.employee_id=${len(params)}::uuid"
    if status:
        params.append(status)
        q += f" AND c.status=${len(params)}"
    q += " ORDER BY c.created_at DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.get("/expense-claims/pending-count")
async def expense_claims_pending_count(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # An org-wide count.
    _require(levels, VIEWER)
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_expense_claims "
        "WHERE org_id=$1::uuid AND status='pending' AND is_active=TRUE",
        org_id,
    )
    return {"count": count}


@router.post("/expense-claims")
async def create_expense_claim(
    body: ExpenseClaimCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    if body.employee_id:
        if not await _is_org_admin(pool, user, org_id):
            raise HTTPException(403, "Only admins can submit claims for other employees")
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            body.employee_id, org_id,
        )
    else:
        emp = await pool.fetchrow(
            "SELECT id FROM staging.manav_employees WHERE org_id=$1::uuid AND user_id=$2 AND is_active=TRUE",
            org_id, user["user_id"],
        )
    if not emp:
        raise HTTPException(404, "Employee record not found")

    row = await pool.fetchrow(
        "INSERT INTO staging.manav_expense_claims "
        "(org_id, employee_id, category, expense_date, amount, description, receipt_urls) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $6, $7::jsonb) RETURNING *",
        org_id, str(emp["id"]), body.category,
        date.fromisoformat(body.expense_date), body.amount, body.description,
        json.dumps(body.receipt_urls),
    )
    return dict(row)


@router.patch("/expense-claims/{claim_id}/approve")
async def approve_expense_claim(
    claim_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    if not await _is_org_admin(pool, user, org_id):
        raise HTTPException(403, "Only admins can approve expense claims")
    row = await pool.fetchrow(
        "UPDATE staging.manav_expense_claims SET status='approved', approved_by=$1, approved_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid AND status='pending' RETURNING *",
        user["user_id"], str(claim_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Pending claim not found")
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", str(row["employee_id"]),
    )
    if emp and emp.get("email"):
        from services.employee_email import send_expense_decision_email
        send_expense_decision_email(
            emp["email"], emp["name"], row.get("category", "Expense"),
            float(row["amount"]), "approved", user.get("name", "Admin"),
        )
    return dict(row)


@router.patch("/expense-claims/{claim_id}/reject")
async def reject_expense_claim(
    claim_id: UUID,
    body: ExpenseClaimAction,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    if not await _is_org_admin(pool, user, org_id):
        raise HTTPException(403, "Only admins can reject expense claims")
    row = await pool.fetchrow(
        "UPDATE staging.manav_expense_claims SET status='rejected', approved_by=$1, approved_at=NOW(), "
        "rejection_reason=$2 WHERE id=$3::uuid AND org_id=$4::uuid AND status='pending' RETURNING *",
        user["user_id"], body.rejection_reason, str(claim_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Pending claim not found")
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", str(row["employee_id"]),
    )
    if emp and emp.get("email"):
        from services.employee_email import send_expense_decision_email
        send_expense_decision_email(
            emp["email"], emp["name"], row.get("category", "Expense"),
            float(row["amount"]), "rejected", user.get("name", "Admin"),
        )
    return dict(row)


# ── Recruitment / Applicant Tracking ─────────────────────────

@router.get("/job-openings")
async def list_job_openings(
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Recruitment is not employee self-service.
    _require(levels, VIEWER)
    q = (
        "SELECT j.*, d.name AS department_name, "
        "(SELECT COUNT(*) FROM staging.manav_candidates c WHERE c.job_opening_id = j.id) AS candidate_count "
        "FROM staging.manav_job_openings j "
        "LEFT JOIN staging.manav_departments d ON d.id = j.department_id "
        "WHERE j.org_id=$1::uuid"
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND j.status=${len(params)}"
    q += " ORDER BY j.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/job-openings")
async def create_job_opening(
    body: JobOpeningCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_job_openings (org_id, title, department_id, description, created_by) "
        "VALUES ($1::uuid, $2, NULLIF($3,'')::uuid, $4, $5) RETURNING *",
        org_id, body.title, body.department_id, body.description, user["user_id"],
    )
    return dict(row)


@router.patch("/job-openings/{opening_id}")
async def update_job_opening(
    opening_id: UUID,
    body: JobOpeningUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    updates, vals = [], []
    for field in ("title", "description", "status"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            updates.append(f"{field}=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    vals += [str(opening_id), org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.manav_job_openings SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Job opening not found")
    return dict(row)


@router.get("/candidates")
async def list_candidates(
    job_opening_id: str = "",
    stage: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Candidate name, email, phone and resume — outsiders' PII.
    _require(levels, VIEWER)
    q = "SELECT * FROM staging.manav_candidates WHERE org_id=$1::uuid"
    params: list = [org_id]
    if job_opening_id:
        params.append(job_opening_id)
        q += f" AND job_opening_id=${len(params)}::uuid"
    if stage:
        params.append(stage)
        q += f" AND stage=${len(params)}"
    q += " ORDER BY created_at DESC"
    rows = await pool.fetch(q, *params)
    from services.storage import sign_key
    candidates = []
    for r in rows:
        d = dict(r)
        if d.get("resume_key"):
            d["resume_url"] = await sign_key(org_id, d["resume_key"]) or d.get("resume_url", "")
        candidates.append(d)
    return {"data": candidates}


@router.post("/candidates")
async def create_candidate(
    body: CandidateCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    opening = await pool.fetchrow(
        "SELECT id FROM staging.manav_job_openings WHERE id=$1::uuid AND org_id=$2::uuid",
        body.job_opening_id, org_id,
    )
    if not opening:
        raise HTTPException(404, "Job opening not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_candidates "
        "(org_id, job_opening_id, full_name, email, phone, resume_url, notes) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7) RETURNING *",
        org_id, body.job_opening_id, body.full_name, body.email, body.phone,
        body.resume_url, body.notes,
    )
    return dict(row)


@router.patch("/candidates/{candidate_id}/stage")
async def update_candidate_stage(
    candidate_id: UUID,
    body: CandidateStageUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    valid_stages = ("applied", "screening", "interview", "offer", "hired", "rejected")
    if body.stage not in valid_stages:
        raise HTTPException(400, f"stage must be one of: {', '.join(valid_stages)}")
    row = await pool.fetchrow(
        "UPDATE staging.manav_candidates SET stage=$1, rejection_reason=$2, updated_at=NOW() "
        "WHERE id=$3::uuid AND org_id=$4::uuid RETURNING *",
        body.stage, body.rejection_reason if body.stage == "rejected" else None,
        str(candidate_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Candidate not found")
    return dict(row)


@router.post("/candidates/{candidate_id}/hire")
async def hire_candidate(
    candidate_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Creates a personnel record.
    _require(levels, ADMIN)
    candidate = await pool.fetchrow(
        "SELECT * FROM staging.manav_candidates WHERE id=$1::uuid AND org_id=$2::uuid",
        str(candidate_id), org_id,
    )
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate["converted_employee_id"]:
        raise HTTPException(400, "Candidate has already been converted to an employee")

    emp = await pool.fetchrow(
        "INSERT INTO staging.manav_employees "
        "(org_id, name, email, phone, date_of_joining, employment_type, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, CURRENT_DATE, 'full_time', $5) "
        "RETURNING id, name, employee_code",
        org_id, candidate["full_name"], candidate["email"], candidate["phone"], user["user_id"],
    )
    await pool.execute(
        "UPDATE staging.manav_candidates SET stage='hired', converted_employee_id=$1, updated_at=NOW() "
        "WHERE id=$2::uuid",
        emp["id"], str(candidate_id),
    )
    return {"ok": True, "employee_id": str(emp["id"])}


# ── Asset Tracking ──────────────────────────────────────────

class AssetCreate(BaseModel):
    asset_tag: str
    name: str
    category: str = "other"
    serial_number: str = ""
    purchase_date: str = ""
    purchase_cost: float = 0
    condition: str = "good"
    notes: str = ""


class AssetUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    serial_number: str | None = None
    purchase_date: str | None = None
    purchase_cost: float | None = None
    condition: str | None = None
    notes: str | None = None


class AssetAssign(BaseModel):
    employee_id: str


@router.get("/assets")
async def list_assets(
    category: str = "",
    assigned: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Names the employee each asset is issued to.
    _require(levels, VIEWER)
    q = (
        "SELECT a.*, e.name AS employee_name "
        "FROM staging.manav_assets a "
        "LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
        "WHERE a.org_id=$1::uuid AND a.is_active=TRUE"
    )
    params: list = [org_id]
    if category:
        params.append(category)
        q += f" AND a.category=${len(params)}"
    if assigned == "yes":
        q += " AND a.assigned_to IS NOT NULL"
    elif assigned == "no":
        q += " AND a.assigned_to IS NULL"
    q += " ORDER BY a.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/assets")
async def create_asset(
    body: AssetCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    valid_cats = ("laptop", "phone", "tablet", "vehicle", "furniture", "other")
    if body.category not in valid_cats:
        raise HTTPException(400, f"category must be one of: {', '.join(valid_cats)}")
    valid_cond = ("new", "good", "fair", "poor", "disposed")
    if body.condition not in valid_cond:
        raise HTTPException(400, f"condition must be one of: {', '.join(valid_cond)}")
    p_date = date.fromisoformat(body.purchase_date) if body.purchase_date else None
    row = await pool.fetchrow(
        "INSERT INTO staging.manav_assets "
        "(org_id, asset_tag, name, category, serial_number, purchase_date, "
        "purchase_cost, condition, notes, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, $8, $9, $10) RETURNING *",
        org_id, body.asset_tag, body.name, body.category, body.serial_number,
        p_date, body.purchase_cost, body.condition, body.notes, user["user_id"],
    )
    return dict(row)


@router.get("/assets/{asset_id}")
async def get_asset(
    asset_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, VIEWER)
    row = await pool.fetchrow(
        "SELECT a.*, e.name AS employee_name "
        "FROM staging.manav_assets a "
        "LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
        "WHERE a.id=$1::uuid AND a.org_id=$2::uuid AND a.is_active=TRUE",
        asset_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    return dict(row)


@router.patch("/assets/{asset_id}")
async def update_asset(
    asset_id: str,
    body: AssetUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    updates, vals = [], []
    for field in ("name", "serial_number", "notes"):
        v = getattr(body, field)
        if v is not None:
            vals.append(v); updates.append(f"{field}=${len(vals)}")
    if body.category is not None:
        valid = ("laptop", "phone", "tablet", "vehicle", "furniture", "other")
        if body.category not in valid:
            raise HTTPException(400, "Invalid category")
        vals.append(body.category); updates.append(f"category=${len(vals)}")
    if body.condition is not None:
        valid = ("new", "good", "fair", "poor", "disposed")
        if body.condition not in valid:
            raise HTTPException(400, "Invalid condition")
        vals.append(body.condition); updates.append(f"condition=${len(vals)}")
    if body.purchase_cost is not None:
        vals.append(body.purchase_cost); updates.append(f"purchase_cost=${len(vals)}")
    if body.purchase_date is not None:
        vals.append(date.fromisoformat(body.purchase_date)); updates.append(f"purchase_date=${len(vals)}::date")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [asset_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.manav_assets SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid AND is_active=TRUE RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    return dict(row)


@router.delete("/assets/{asset_id}")
async def delete_asset(
    asset_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    result = await pool.execute(
        "UPDATE staging.manav_assets SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        asset_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Asset not found")
    return {"ok": True}


@router.post("/assets/{asset_id}/assign")
async def assign_asset(
    asset_id: str,
    body: AssetAssign,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    emp = await pool.fetchrow(
        "SELECT id FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        body.employee_id, org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")
    row = await pool.fetchrow(
        "UPDATE staging.manav_assets SET assigned_to=$1::uuid, assigned_date=CURRENT_DATE, "
        "returned_date=NULL, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid AND is_active=TRUE RETURNING *",
        body.employee_id, asset_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    # ── Notify employee ──
    emp_info = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees WHERE id=$1::uuid", body.employee_id,
    )
    if emp_info and emp_info.get("email"):
        from services.employee_email import send_asset_email
        send_asset_email(
            emp_info["email"], emp_info["name"],
            row.get("name", "Asset"), row.get("asset_type", ""), "assigned",
        )
    return dict(row)


@router.post("/assets/{asset_id}/return")
async def return_asset(
    asset_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, EDITOR)
    # Fetch current assignee before clearing
    prev = await pool.fetchrow(
        "SELECT a.assigned_to, a.name AS asset_name, a.asset_type, e.name, e.email "
        "FROM staging.manav_assets a LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
        "WHERE a.id=$1::uuid AND a.org_id=$2::uuid AND a.is_active=TRUE",
        asset_id, org_id,
    )
    row = await pool.fetchrow(
        "UPDATE staging.manav_assets SET assigned_to=NULL, returned_date=CURRENT_DATE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE RETURNING *",
        asset_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Asset not found")
    # ── Notify employee ──
    if prev and prev.get("email"):
        from services.employee_email import send_asset_email
        send_asset_email(
            prev["email"], prev["name"],
            prev.get("asset_name", "Asset"), prev.get("asset_type", ""), "returned",
        )
    return dict(row)


@router.get("/employees/{employee_id}/assets")
async def employee_assets(
    employee_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Every other asset route requires viewer because the rows name the employee
    # they are issued to. This one takes the employee id in the path, so without
    # a filter it is the same disclosure with an extra step. Own kit at self
    # scope, anybody else's needs viewer.
    if not _can(levels, VIEWER):
        own = await _own_employee_id(pool, user, org_id)
        if not own or str(employee_id) != own:
            raise HTTPException(403, "You can only view your own assets")
    rows = await pool.fetch(
        "SELECT * FROM staging.manav_assets "
        "WHERE org_id=$1::uuid AND assigned_to=$2::uuid AND is_active=TRUE ORDER BY assigned_date DESC",
        org_id, employee_id,
    )
    return {"data": [dict(r) for r in rows]}
