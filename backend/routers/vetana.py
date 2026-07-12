"""
vetana.py — Vetana · वेतन (Payroll) Router
Salary structures, payroll processing, payslips, statutory compliance.
Reads Manav (HRMS) for employees, attendance, leaves.
"""
import calendar
import json
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from utils import next_doc_number

router = APIRouter(prefix="/api/v1/vetana", tags=["vetana-payroll"])

_gate = require_module("vetana")


# ── Pydantic Models ──────────────────────────────────────────

class SalaryStructureCreate(BaseModel):
    employee_id: str
    effective_from: str = ""
    ctc_annual: float = 0
    basic: float = 0
    hra: float = 0
    da: float = 0
    special_allowance: float = 0
    conveyance: float = 0
    medical: float = 0
    other_allowances: list[dict] = []
    pf_enabled: bool = True
    esi_enabled: bool = False
    pt_applicable: bool = True
    tds_regime: str = "new"
    notes: str = ""


class SalaryStructureUpdate(BaseModel):
    ctc_annual: float | None = None
    basic: float | None = None
    hra: float | None = None
    da: float | None = None
    special_allowance: float | None = None
    conveyance: float | None = None
    medical: float | None = None
    other_allowances: list[dict] | None = None
    pf_enabled: bool | None = None
    esi_enabled: bool | None = None
    pt_applicable: bool | None = None
    tds_regime: str | None = None
    notes: str | None = None


class PayrollProcessRequest(BaseModel):
    month: str  # YYYY-MM


# ── Salary Structures CRUD ───────────────────────────────────

@router.get("/salary-structures")
async def list_structures(
    employee_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT s.*, "
        "e.name AS employee_name, "
        "e.employee_code "
        "FROM staging.vetana_salary_structures s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "WHERE s.org_id=$1::uuid AND s.is_active=TRUE"
    )
    params: list = [org_id]
    if employee_id:
        params.append(employee_id)
        q += f" AND s.employee_id=${len(params)}::uuid"
    q += " ORDER BY s.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/salary-structures")
async def create_structure(
    body: SalaryStructureCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.vetana_salary_structures "
        "(org_id, employee_id, effective_from, ctc_annual, basic, hra, da, "
        "special_allowance, conveyance, medical, other_allowances, "
        "pf_enabled, esi_enabled, pt_applicable, tds_regime, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, COALESCE(NULLIF($3,'')::date, CURRENT_DATE), "
        "$4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17) "
        "RETURNING *",
        org_id, body.employee_id, body.effective_from,
        body.ctc_annual, body.basic, body.hra, body.da,
        body.special_allowance, body.conveyance, body.medical,
        json.dumps(body.other_allowances),
        body.pf_enabled, body.esi_enabled, body.pt_applicable,
        body.tds_regime, body.notes, user["user_id"],
    )
    return dict(row)


@router.get("/salary-structures/{sid}")
async def get_structure(
    sid: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT s.*, "
        "e.name AS employee_name "
        "FROM staging.vetana_salary_structures s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "WHERE s.id=$1::uuid AND s.org_id=$2::uuid",
        sid, org_id,
    )
    if not row:
        raise HTTPException(404, "Salary structure not found")
    return dict(row)


@router.patch("/salary-structures/{sid}")
async def update_structure(
    sid: str,
    body: SalaryStructureUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("ctc_annual", "basic", "hra", "da", "special_allowance",
                  "conveyance", "medical", "pf_enabled", "esi_enabled",
                  "pt_applicable", "tds_regime", "notes"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            updates.append(f"{field}=${len(vals)}")
    if body.other_allowances is not None:
        vals.append(json.dumps(body.other_allowances))
        updates.append(f"other_allowances=${len(vals)}::jsonb")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append(f"updated_at=NOW()")
    vals += [sid, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.vetana_salary_structures SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Salary structure not found")
    return dict(row)


@router.delete("/salary-structures/{sid}")
async def delete_structure(
    sid: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.vetana_salary_structures SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        sid, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Salary structure not found")
    return {"ok": True}


# ── Payroll Processing ───────────────────────────────────────

def _compute_statutory(basic_payable: float, gross: float, structure: dict):
    pf_emp = min(basic_payable * 0.12, 1800) if structure["pf_enabled"] else 0
    pf_emr = min(basic_payable * 0.12, 1800) if structure["pf_enabled"] else 0

    esi_emp = gross * 0.0075 if structure["esi_enabled"] and gross <= 21000 else 0
    esi_emr = gross * 0.0325 if structure["esi_enabled"] and gross <= 21000 else 0

    pt = 200 if structure["pt_applicable"] and gross > 15000 else 0

    # Simplified TDS: estimate annual taxable, divide by 12
    annual_taxable = max(gross * 12 - 50000, 0)  # standard deduction
    if structure["tds_regime"] == "new":
        # New regime 2026 slabs (simplified)
        if annual_taxable <= 300000:
            tax = 0
        elif annual_taxable <= 700000:
            tax = (annual_taxable - 300000) * 0.05
        elif annual_taxable <= 1000000:
            tax = 20000 + (annual_taxable - 700000) * 0.10
        elif annual_taxable <= 1200000:
            tax = 50000 + (annual_taxable - 1000000) * 0.15
        elif annual_taxable <= 1500000:
            tax = 80000 + (annual_taxable - 1200000) * 0.20
        else:
            tax = 140000 + (annual_taxable - 1500000) * 0.30
    else:
        if annual_taxable <= 250000:
            tax = 0
        elif annual_taxable <= 500000:
            tax = (annual_taxable - 250000) * 0.05
        elif annual_taxable <= 1000000:
            tax = 12500 + (annual_taxable - 500000) * 0.20
        else:
            tax = 112500 + (annual_taxable - 1000000) * 0.30
    tds = round(tax / 12, 2)

    return {
        "pf_employee": round(pf_emp, 2),
        "pf_employer": round(pf_emr, 2),
        "esi_employee": round(esi_emp, 2),
        "esi_employer": round(esi_emr, 2),
        "professional_tax": round(pt, 2),
        "tds": tds,
    }


@router.post("/payroll/process")
async def process_payroll(
    body: PayrollProcessRequest,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    month = body.month  # YYYY-MM
    parts = month.split("-")
    if len(parts) != 2:
        raise HTTPException(400, "Month must be YYYY-MM format")
    year, mon = int(parts[0]), int(parts[1])
    _, days_in_month = calendar.monthrange(year, mon)
    month_start = date(year, mon, 1)
    month_end = date(year, mon, days_in_month)

    existing = await pool.fetchrow(
        "SELECT id, status FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid AND month=$2",
        org_id, month,
    )
    if existing and existing["status"] not in ("draft",):
        raise HTTPException(400, f"Payroll for {month} is already {existing['status']}")

    run_id = existing["id"] if existing else None
    if existing:
        await pool.execute(
            "DELETE FROM staging.vetana_payslips WHERE run_id=$1::uuid", run_id
        )
    else:
        run_row = await pool.fetchrow(
            "INSERT INTO staging.vetana_payroll_runs (org_id, month, created_by) "
            "VALUES ($1::uuid, $2, $3) RETURNING id",
            org_id, month, user["user_id"],
        )
        run_id = run_row["id"]

    structures = await pool.fetch(
        "SELECT s.* FROM staging.vetana_salary_structures s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id AND e.is_active=TRUE "
        "WHERE s.org_id=$1::uuid AND s.is_active=TRUE "
        "AND s.effective_from <= $2 "
        "ORDER BY s.employee_id, s.effective_from DESC",
        org_id, month_end,
    )

    seen_employees = set()
    unique_structures = []
    for s in structures:
        eid = str(s["employee_id"])
        if eid not in seen_employees:
            seen_employees.add(eid)
            unique_structures.append(s)

    totals = {
        "gross": 0, "deductions": 0, "net": 0,
        "pf": 0, "esi": 0, "pt": 0, "tds": 0,
    }
    working_days = days_in_month  # simplified: all calendar days minus Sundays
    sundays = sum(1 for d in range(1, days_in_month + 1) if date(year, mon, d).weekday() == 6)
    working_days = days_in_month - sundays

    for s in unique_structures:
        emp_id = str(s["employee_id"])

        att = await pool.fetchrow(
            "SELECT COUNT(*) FILTER (WHERE status='present') AS present, "
            "COUNT(*) FILTER (WHERE status='absent') AS absent, "
            "COALESCE(SUM(overtime_hours),0) AS ot "
            "FROM staging.manav_attendance "
            "WHERE org_id=$1::uuid AND employee_id=$2::uuid "
            "AND date >= $3 AND date <= $4",
            org_id, emp_id, month_start, month_end,
        )
        present_days = att["present"] if att else working_days
        ot_hours = float(att["ot"]) if att else 0

        paid_leaves = await pool.fetchval(
            "SELECT COUNT(*) FROM staging.manav_leave_requests "
            "WHERE org_id=$1::uuid AND employee_id=$2::uuid "
            "AND status='approved' "
            "AND start_date <= $4 AND end_date >= $3 "
            "AND leave_type_id IN ("
            "  SELECT id FROM staging.manav_leave_types WHERE org_id=$1::uuid AND is_paid=TRUE"
            ")",
            org_id, emp_id, month_start, month_end,
        ) or 0

        unpaid_leaves = await pool.fetchval(
            "SELECT COUNT(*) FROM staging.manav_leave_requests "
            "WHERE org_id=$1::uuid AND employee_id=$2::uuid "
            "AND status='approved' "
            "AND start_date <= $4 AND end_date >= $3 "
            "AND leave_type_id IN ("
            "  SELECT id FROM staging.manav_leave_types WHERE org_id=$1::uuid AND is_paid=FALSE"
            ")",
            org_id, emp_id, month_start, month_end,
        ) or 0

        payable_days = present_days + paid_leaves
        if payable_days > working_days:
            payable_days = working_days
        ratio = payable_days / working_days if working_days > 0 else 1

        basic_pay = float(s["basic"]) * ratio
        hra_pay = float(s["hra"] or 0) * ratio
        da_pay = float(s["da"] or 0) * ratio
        special_pay = float(s["special_allowance"] or 0) * ratio
        conveyance_pay = float(s["conveyance"] or 0) * ratio
        medical_pay = float(s["medical"] or 0) * ratio

        ot_pay = 0
        if ot_hours > 0 and working_days > 0:
            hourly = float(s["basic"]) / (working_days * 8)
            ot_pay = round(ot_hours * hourly * 2, 2)

        gross = round(basic_pay + hra_pay + da_pay + special_pay + conveyance_pay + medical_pay + ot_pay, 2)

        stat = _compute_statutory(basic_pay, gross, dict(s))
        total_ded = stat["pf_employee"] + stat["esi_employee"] + stat["professional_tax"] + stat["tds"]
        net = round(gross - total_ded, 2)

        ps_number = await next_doc_number(pool, org_id, "vetana_payslips", "payslip_number", "PS")

        await pool.execute(
            "INSERT INTO staging.vetana_payslips "
            "(org_id, run_id, employee_id, payslip_number, month, "
            "working_days, present_days, leaves_paid, leaves_unpaid, overtime_hours, "
            "basic, hra, da, special_allowance, conveyance, medical, overtime_pay, gross, "
            "pf_employee, pf_employer, esi_employee, esi_employer, "
            "professional_tax, tds, total_deductions, net_pay) "
            "VALUES ($1::uuid, $2, $3::uuid, $4, $5, "
            "$6, $7, $8, $9, $10, "
            "$11, $12, $13, $14, $15, $16, $17, $18, "
            "$19, $20, $21, $22, $23, $24, $25, $26)",
            org_id, run_id, emp_id, ps_number, month,
            working_days, present_days, paid_leaves, unpaid_leaves, ot_hours,
            round(basic_pay, 2), round(hra_pay, 2), round(da_pay, 2),
            round(special_pay, 2), round(conveyance_pay, 2), round(medical_pay, 2),
            ot_pay, gross,
            stat["pf_employee"], stat["pf_employer"],
            stat["esi_employee"], stat["esi_employer"],
            stat["professional_tax"], stat["tds"], round(total_ded, 2), net,
        )

        totals["gross"] += gross
        totals["deductions"] += total_ded
        totals["net"] += net
        totals["pf"] += stat["pf_employee"] + stat["pf_employer"]
        totals["esi"] += stat["esi_employee"] + stat["esi_employer"]
        totals["pt"] += stat["professional_tax"]
        totals["tds"] += stat["tds"]

    await pool.execute(
        "UPDATE staging.vetana_payroll_runs SET "
        "status='processed', total_gross=$1, total_deductions=$2, total_net=$3, "
        "total_pf=$4, total_esi=$5, total_pt=$6, total_tds=$7, "
        "employee_count=$8, processed_at=NOW() "
        "WHERE id=$9",
        round(totals["gross"], 2), round(totals["deductions"], 2), round(totals["net"], 2),
        round(totals["pf"], 2), round(totals["esi"], 2), round(totals["pt"], 2),
        round(totals["tds"], 2), len(unique_structures), run_id,
    )

    return {
        "ok": True,
        "run_id": str(run_id),
        "employee_count": len(unique_structures),
        "total_gross": round(totals["gross"], 2),
        "total_net": round(totals["net"], 2),
    }


# ── Payroll Runs ─────────────────────────────────────────────

@router.get("/payroll/runs")
async def list_runs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid ORDER BY month DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/payroll/runs/{run_id}")
async def get_run(
    run_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    run = await pool.fetchrow(
        "SELECT * FROM staging.vetana_payroll_runs "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        run_id, org_id,
    )
    if not run:
        raise HTTPException(404, "Payroll run not found")
    payslips = await pool.fetch(
        "SELECT p.*, "
        "e.name AS employee_name, "
        "e.employee_code "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "WHERE p.run_id=$1::uuid ORDER BY employee_name",
        run_id,
    )
    return {**dict(run), "payslips": [dict(p) for p in payslips]}


@router.patch("/payroll/runs/{run_id}/approve")
async def approve_run(
    run_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    run = await pool.fetchrow(
        "SELECT status FROM staging.vetana_payroll_runs "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        run_id, org_id,
    )
    if not run:
        raise HTTPException(404, "Payroll run not found")
    if run["status"] != "processed":
        raise HTTPException(400, f"Cannot approve a '{run['status']}' payroll run")
    await pool.execute(
        "UPDATE staging.vetana_payroll_runs SET status='approved', "
        "approved_by=$1, approved_at=NOW() WHERE id=$2::uuid",
        user["user_id"], run_id,
    )
    await pool.execute(
        "UPDATE staging.vetana_payslips SET status='approved' WHERE run_id=$1::uuid",
        run_id,
    )
    return {"ok": True}


@router.patch("/payroll/runs/{run_id}/revert")
async def revert_run(
    run_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    run = await pool.fetchrow(
        "SELECT status FROM staging.vetana_payroll_runs "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        run_id, org_id,
    )
    if not run:
        raise HTTPException(404, "Payroll run not found")
    if run["status"] not in ("processed",):
        raise HTTPException(400, "Can only revert a processed (not yet approved) payroll run")
    await pool.execute(
        "UPDATE staging.vetana_payroll_runs SET status='draft', "
        "processed_at=NULL WHERE id=$1::uuid",
        run_id,
    )
    return {"ok": True}


# ── Payslips ─────────────────────────────────────────────────

@router.get("/payslips")
async def list_payslips(
    employee_id: str = "",
    month: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT p.*, "
        "e.name AS employee_name, "
        "e.employee_code "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "WHERE p.org_id=$1::uuid AND p.is_active=TRUE"
    )
    params: list = [org_id]
    if employee_id:
        params.append(employee_id)
        q += f" AND p.employee_id=${len(params)}::uuid"
    if month:
        params.append(month)
        q += f" AND p.month=${len(params)}"
    q += " ORDER BY p.month DESC, employee_name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.get("/payslips/{payslip_id}")
async def get_payslip(
    payslip_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT p.*, "
        "e.name AS employee_name, "
        "e.employee_code, e.pan, e.uan, e.bank_details "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "WHERE p.id=$1::uuid AND p.org_id=$2::uuid",
        payslip_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Payslip not found")
    return dict(row)


@router.patch("/payslips/{payslip_id}/disburse")
async def disburse_payslip(
    payslip_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    ps = await pool.fetchrow(
        "SELECT status, run_id FROM staging.vetana_payslips "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        payslip_id, org_id,
    )
    if not ps:
        raise HTTPException(404, "Payslip not found")
    if ps["status"] != "approved":
        raise HTTPException(400, "Payslip must be approved before disbursement")
    await pool.execute(
        "UPDATE staging.vetana_payslips SET status='disbursed', disbursed_at=NOW() "
        "WHERE id=$1::uuid",
        payslip_id,
    )
    undisbursed = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.vetana_payslips "
        "WHERE run_id=$1 AND status != 'disbursed'",
        ps["run_id"],
    )
    if undisbursed == 0:
        await pool.execute(
            "UPDATE staging.vetana_payroll_runs SET status='disbursed' WHERE id=$1",
            ps["run_id"],
        )
    return {"ok": True}


# ── Dashboard ────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    latest_run = await pool.fetchrow(
        "SELECT * FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid ORDER BY month DESC LIMIT 1",
        org_id,
    )
    headcount = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    ytd = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_gross),0) AS ytd_gross, "
        "COALESCE(SUM(total_net),0) AS ytd_net, "
        "COALESCE(SUM(total_pf),0) AS ytd_pf, "
        "COALESCE(SUM(total_esi),0) AS ytd_esi, "
        "COALESCE(SUM(total_tds),0) AS ytd_tds "
        "FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid AND month LIKE $2",
        org_id, f"{date.today().year}-%",
    )
    dept_split = await pool.fetch(
        "SELECT COALESCE(e.department, 'Unassigned') AS department, "
        "COUNT(DISTINCT p.employee_id) AS employees, "
        "COALESCE(SUM(p.gross),0) AS dept_gross, COALESCE(SUM(p.net_pay),0) AS dept_net "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "WHERE p.org_id=$1::uuid AND p.month=$2 "
        "GROUP BY e.department ORDER BY dept_gross DESC",
        org_id, latest_run["month"] if latest_run else "",
    )
    return {
        "latest_run": dict(latest_run) if latest_run else None,
        "headcount": headcount,
        "ytd": dict(ytd) if ytd else {},
        "department_split": [dict(r) for r in dept_split],
    }


@router.get("/statutory-summary")
async def statutory_summary(
    month: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not month:
        month = f"{date.today().year}-{date.today().month:02d}"
    rows = await pool.fetch(
        "SELECT p.payslip_number, "
        "e.name AS employee_name, "
        "e.employee_code, e.pan, e.uan, "
        "p.basic, p.gross, p.pf_employee, p.pf_employer, "
        "p.esi_employee, p.esi_employer, p.professional_tax, p.tds "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "WHERE p.org_id=$1::uuid AND p.month=$2 "
        "ORDER BY employee_name",
        org_id, month,
    )
    totals = await pool.fetchrow(
        "SELECT COALESCE(SUM(pf_employee),0) AS total_pf_employee, "
        "COALESCE(SUM(pf_employer),0) AS total_pf_employer, "
        "COALESCE(SUM(esi_employee),0) AS total_esi_employee, "
        "COALESCE(SUM(esi_employer),0) AS total_esi_employer, "
        "COALESCE(SUM(professional_tax),0) AS total_pt, "
        "COALESCE(SUM(tds),0) AS total_tds "
        "FROM staging.vetana_payslips WHERE org_id=$1::uuid AND month=$2",
        org_id, month,
    )
    return {
        "month": month,
        "employees": [dict(r) for r in rows],
        "totals": dict(totals) if totals else {},
    }
