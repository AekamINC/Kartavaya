"""
vetana.py — Vetana · वेतन (Payroll) Router
Salary structures, payroll processing, payslips, statutory compliance.
Reads Manav (HRMS) for employees, attendance, leaves.
"""
import asyncio
import calendar
import json
from datetime import date, datetime, timezone
from typing import Optional

import traceback
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import is_platform_staff
from middleware.role_tiers import (
    ADMIN, APPROVER, EDITOR, any_level_satisfies, require_module_or_self,
)
from services.audit import emit as audit
from services.niyam.subjects import payroll_published, payslip_disbursed
from services.pii import decrypt_bank, mask_bank, mask_tail
from utils import next_doc_number

router = APIRouter(prefix="/api/v1/vetana", tags=["vetana-payroll"])

MODULE = "vetana"

#: The gate AND the answer. Its value is the caller's Tier-4 level set, so every
#: route below writes `levels=Depends(_gate)` and resolves once per request.
#: An EMPTY set is admitted deliberately — see SELF_SCOPED_MODULES.
_gate = require_module_or_self(MODULE)

# ── Who may see what in payroll ───────────────────────────────────────────────
#
# Three rules, and they are the whole file.
#
# 0 · VIEWER ON VETANA IS SCOPED TO SELF — IT IS NOT A KEY TO THE REGISTER
#
#     RBAC-SPEC.md says it twice, and the second time in as many words:
#
#       "Vetana (Payroll) | Viewer: **View own payslips**"
#       "**Viewer on Vetana is scoped to self**, not to the org. It is the only
#        module where viewer means 'my own record'."
#
#     So the bar for reading ANOTHER person's pay — the register, the runs, the
#     dashboard, the statutory summary, a colleague's structure or loan — is
#     `editor`, the level the same matrix defines as "prepare payroll runs".
#     Viewer and no-grant land in the same place here, which is the one module
#     where that is the correct answer rather than a bug.
#
#     This is deliberately NOT how the rest of the file's ladder reads, and it
#     is deliberately NOT `viewer`. An earlier pass set these to `viewer` on the
#     reasoning that a grant must mean more than no grant; the spec had already
#     answered that, and on the most sensitive table in the product the spec's
#     answer is also the safe one. Nobody is locked out by it: org_owner and
#     org_admin resolve to `admin`, and admin satisfies editor.
#
# 1 · SELF SCOPE, NO GRANT (role_tiers.SELF_SCOPED_MODULES)
#
#     "Every employee gets read access to THEIR OWN record with no grant at all
#      — own payslip, own profile, own attendance. Anything beyond their own row
#      needs a grant."
#
#     So an employee holding nothing reads their own payslips, their own salary
#     structure and their own loans, and reaches nothing else. It is a query
#     filter (`WHERE employee_id = me`), not a grant row: a row per employee
#     would be ~200 identical rows per org and would break the moment one was
#     deleted (PROPOSED_066 §4).
#
#     Self scope is READ-ONLY. There is no write path in this file that an empty
#     level set reaches — an employee reads their payslip, they do not edit it.
#
# 2 · SEPARATED DUTY: ADMIN DOES NOT SATISFY APPROVER HERE
#
#     Vetana is in role_tiers.SEPARATED_DUTY_MODULES. Admin is breadth — salary
#     structures, statutory config, loans. Approver is depth — approve the run,
#     revert it, release the payment. Whoever defines what people are paid must
#     not be the one who releases the money.
#
#     Every check goes through `any_level_satisfies(...)`, which delegates to
#     `level_satisfies(held, required, module_code)`. Levels are NEVER compared
#     by hand in this file: `LEVELS.index(held) >= LEVELS.index(required)` is
#     true for admin/approver and is exactly the bug the separation exists to
#     prevent.
#
#     Consequence worth stating plainly: an org_owner or org_admin resolves to
#     `admin`, and admin alone CANNOT approve a payroll run. Approving needs an
#     explicit `approver` grant on vetana — a second, visible, auditable row.
#     One person may hold both; it is then a deliberate act rather than
#     something admin quietly included.
#
# PAN, UAN and account numbers are masked in every JSON response regardless of
# level. The one place full values survive is the payslip PDF, which is a
# statutory document the employee is entitled to — and anyone pulling someone
# else's needs `admin` and is audited.


#: The rung demanded by the three routes that RELEASE MONEY — approve a run,
#: revert an approval, mark a payslip disbursed.
#:
#: `APPROVER`, which is the owner's rule: admin defines what people are paid and
#: does not release the money. `level_satisfies` refuses admin at this rung on
#: vetana and ganit by design.
#:
#: ── The blocking condition below is SATISFIED. Verified 2026-07-27. ────────
#: This carried a DO NOT MERGE until
#: `backend/migrations/PROPOSED_071_vetana_approver_backfill.sql` had run, because
#: `staging.org_member_modules` held ZERO rows when it was written: with no row
#: anywhere, `held_module_levels` resolved org_owner and org_admin to exactly
#: `{admin}`, nobody held `approver`, and this line would not have narrowed the
#: set of people who can approve a payroll run — it would have emptied it, and
#: payroll would have stopped company-wide.
#:
#: Ran that verification against the live catalog rather than the ledger. Every
#: org with Vetana active now holds at least one approver:
#:
#:     Aekam Inc      1 approver,  0 payslips
#:     QA Test Corp   1 approver, 37 payslips
#:
#: The warning is kept rather than deleted because the CONDITION still binds:
#: an org onboarded without a Vetana approver cannot approve payroll, and it
#: fails closed, so the symptom is a 403 rather than anything louder. Re-run
#: the query in the backfill migration before adding an org.
#:
#: Note the asymmetry with Ganit, which is deliberate and not a bug: Ganit
#: resolves approvers from `org_module_approvers` and FALLS BACK to org role
#: when that table is absent (`middleware/module_levels.py:188`) — and it is
#: absent. Vetana has no such fallback. So Ganit approval works today through
#: the fallback while Vetana works through real grants.
_RELEASE_LEVEL = APPROVER

#: The share of gross an employee keeps regardless of what a loan would recover.
#: Owner's decision, 2026-07-29: 50%. Loan recovery stops at this line and the
#: remainder carries forward in `balance_remaining`; statutory deductions are
#: not subject to it. A full and final settlement ignores it — see
#: `process_payroll`.
_NET_PAY_FLOOR_PCT = 0.50


def _can(levels, required: str) -> bool:
    """Does this caller's level set satisfy `required` on Vetana?

    Always via role_tiers, never by comparing levels here — see rule 2 above.
    """
    return any_level_satisfies(levels, required, MODULE)


def _require(levels, required: str) -> None:
    if _can(levels, required):
        return
    if required == APPROVER:
        raise HTTPException(
            403,
            "Approving or releasing payroll needs an explicit approver grant on "
            "Vetana. Admin on Vetana is not the same authority: whoever defines "
            "what people are paid does not release the money.",
        )
    raise HTTPException(
        403,
        f"This action needs '{required}' on Vetana. Without a grant you can see "
        "your own payroll records and nothing else.",
    )


async def _own_employee_id(pool, user, org_id: str) -> str | None:
    """The caller's own employee row in this org, if they have one."""
    return await pool.fetchval(
        "SELECT id::text FROM staging.manav_employees "
        "WHERE user_id=$1 AND org_id=$2::uuid AND is_active=TRUE LIMIT 1",
        user["user_id"], org_id,
    )


def _mask_payslip_row(row: dict) -> dict:
    """Mask the identity documents a payslip join drags in from the employee
    row. `bank_details` arrives as JSONB; `bank_account` as a flat column on
    older rows. Both are handled, and absent keys are left absent."""
    out = dict(row)
    for key in ("pan", "emp_pan"):
        if key in out:
            out[key] = mask_tail(out[key], 4)
    if "uan" in out:
        out["uan"] = mask_tail(out["uan"], 4)
    if "bank_account" in out:
        out["bank_account"] = mask_tail(out["bank_account"], 4)
    if "bank_details" in out:
        # Decrypt BEFORE masking. `mask_bank` deliberately refuses to mask
        # ciphertext — the last four characters of a Fernet token would render
        # as an account tail and be indistinguishable from a real one — so a
        # register that skipped this step would show every row as unreadable
        # rather than as "••••4821".
        out["bank_details"] = mask_bank(decrypt_bank(out["bank_details"]))
    out["_pii_masked"] = True
    return out


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
    #: Full and final settlement — recover the whole outstanding advance rather
    #: than stopping at the take-home floor. There is no next month to carry a
    #: balance into. See the note in `process_payroll`; nothing sets this yet.
    final_settlement: bool = False


class LoanCreate(BaseModel):
    employee_id: str
    principal_amount: float
    emi_amount: float
    disbursed_date: str = ""
    notes: str = ""


class LoanUpdate(BaseModel):
    emi_amount: float | None = None
    status: str | None = None
    notes: str | None = None


# ── Salary Structures CRUD ───────────────────────────────────

@router.get("/salary-structures")
async def list_structures(
    employee_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
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

    # A salary structure is what someone is paid. Reading anyone else's is a
    # grant; with no grant the filter narrows to the caller's own row, and if
    # they have no employee row it narrows to nothing.
    if not _can(levels, EDITOR):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own salary structure")
        employee_id = own

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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Defining what someone is paid is the admin half of the separated duty.
    _require(levels, ADMIN)
    # The employee must be in THIS org. Without it the row references a foreign
    # employee id — the same cross-tenant hole already closed on /loans.
    if not await pool.fetchval(
        "SELECT 1 FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        body.employee_id, org_id,
    ):
        raise HTTPException(404, "Employee not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.vetana_salary_structures "
        "(org_id, employee_id, effective_from, ctc_annual, basic, hra, da, "
        "special_allowance, conveyance, medical, other_allowances, "
        "pf_enabled, esi_enabled, pt_applicable, tds_regime, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, COALESCE(NULLIF($3,'')::date, CURRENT_DATE), "
        # `::text::jsonb`, not `::jsonb` — see the payslip INSERT below.
        "$4, $5, $6, $7, $8, $9, $10, $11::text::jsonb, $12, $13, $14, $15, $16, $17) "
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT s.*, "
        "e.name AS employee_name, e.user_id AS employee_user_id "
        "FROM staging.vetana_salary_structures s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id "
        "WHERE s.id=$1::uuid AND s.org_id=$2::uuid",
        sid, org_id,
    )
    if not row:
        raise HTTPException(404, "Salary structure not found")
    out = dict(row)
    # Someone else's structure is someone else's salary. 404 rather than 403 so
    # the response does not confirm that a structure exists for that person.
    if out.pop("employee_user_id", None) != user["user_id"]:
        if not _can(levels, EDITOR):
            raise HTTPException(404, "Salary structure not found")
    return out


@router.patch("/salary-structures/{sid}")
async def update_structure(
    sid: str,
    body: SalaryStructureUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
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
        updates.append(f"other_allowances=${len(vals)}::text::jsonb")
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Processing computes the run from the structures. It does not release money
    # — approving does — so this is the admin half, not the approver half.
    _require(levels, ADMIN)

    # A monthly run always applies the take-home floor. A FULL AND FINAL
    # SETTLEMENT does not: on exit the whole outstanding advance comes out of
    # what is due, which is the owner's instruction and standard practice —
    # there is no next month to carry a balance into.
    #
    # Nothing sets this yet. `process_payroll` selects structures joined on
    # `e.is_active=TRUE`, so an offboarded employee is excluded from the monthly
    # run entirely, and **no full-and-final settlement path exists anywhere in
    # the codebase** (searched: settlement, fnf, final_settlement — no hits;
    # `manav.py:626` only flips `is_active` and `status`). The flag is threaded
    # through here so that feature has the recovery rule it needs already
    # written and tested, rather than reimplementing it and diverging.
    final_settlement = bool(getattr(body, "final_settlement", False))

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
            "SELECT COUNT(*) FILTER (WHERE status IN ('present','late')) AS present, "
            "COUNT(*) FILTER (WHERE status='half_day') AS half_day, "
            "COUNT(*) FILTER (WHERE status='absent') AS absent, "
            "COALESCE(SUM(overtime_hours),0) AS ot "
            "FROM staging.manav_attendance "
            "WHERE org_id=$1::uuid AND employee_id=$2::uuid "
            "AND date >= $3 AND date <= $4",
            org_id, emp_id, month_start, month_end,
        )
        has_attendance = att["present"] + att["half_day"] + att["absent"] > 0
        present_days = (att["present"] + att["half_day"] * 0.5) if has_attendance else working_days
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

        active_loans = await pool.fetch(
            "SELECT id, emi_amount, balance_remaining FROM staging.vetana_loans "
            "WHERE org_id=$1::uuid AND employee_id=$2::uuid AND status='active' "
            "ORDER BY disbursed_date",
            org_id, emp_id,
        )
        approved_claims = await pool.fetch(
            "SELECT id, amount FROM staging.manav_expense_claims "
            "WHERE org_id=$1::uuid AND employee_id=$2::uuid "
            "AND status='approved' AND payslip_id IS NULL",
            org_id, emp_id,
        )
        reimbursement_total = sum(float(c["amount"]) for c in approved_claims)
        claim_ids = [str(c["id"]) for c in approved_claims]

        # ── Loan recovery, CAPPED AT WHAT THE SALARY CAN BEAR ────────────────
        #
        # This used to be `min(emi_amount, balance_remaining)` — capped against
        # the LOAN and never against the pay. An employee on ₹15,000 gross with a
        # ₹25,000 EMI produced `total_deductions 26,800` and
        # **`net_pay -6,800`**, and the payslip was written, marked "generated"
        # and queued to be emailed to them. Seven of the thirty-seven payslips in
        # the QA org were negative when this was found.
        #
        # Net pay cannot be negative. A payslip is a statement of what is being
        # PAID; an employer does not pay a negative amount, and a recovery that
        # would exceed earnings is deferred, not inverted.
        #
        # Statutory deductions come first and are never trimmed — PF, ESI, PT and
        # TDS are owed to the state regardless of what is left for the lender.
        # Loans take whatever remains, in disbursement order (the query above is
        # `ORDER BY disbursed_date`), so the oldest loan recovers first and the
        # shortfall simply stays in `balance_remaining` for the next run.
        statutory = (
            stat["pf_employee"] + stat["esi_employee"]
            + stat["professional_tax"] + stat["tds"]
        )

        # ── The take-home floor ──────────────────────────────────────────────
        #
        # Capping loan recovery at "whatever is left after statutory" stops net
        # pay going NEGATIVE, but it still lets it reach exactly ZERO — and it
        # did, on all seven payslips repaired on 2026-07-28. A payslip that pays
        # nothing at all is a grievance and a retention problem, and several
        # states cap total deductions by statute regardless.
        #
        # Owner's decision, 2026-07-29: recover a loan only down to **50% of
        # gross**, and carry the rest forward. No new plumbing is needed for the
        # carry-forward — an amount not recovered simply stays in
        # `balance_remaining` and the next run takes it.
        #
        # Statutory deductions are NOT subject to the floor. PF, ESI, PT and TDS
        # are owed to the state whatever is left for a lender, so the floor
        # governs the discretionary recovery only. Where statutory alone already
        # takes pay below 50%, `max(0.0, …)` simply yields no loan recovery at
        # all rather than a negative capacity.
        floor = 0.0 if final_settlement else round(gross * _NET_PAY_FLOOR_PCT, 2)
        loan_capacity = max(0.0, gross + reimbursement_total - statutory - floor)

        loan_deductions = []
        loan_total = 0.0
        for loan in active_loans:
            if loan_capacity <= 0:
                break
            amt = min(
                float(loan["emi_amount"]),
                float(loan["balance_remaining"]),
                loan_capacity,
            )
            if amt > 0:
                loan_deductions.append({"loan_id": str(loan["id"]), "amount": round(amt, 2)})
                loan_total += amt
                loan_capacity -= amt

        total_ded = statutory + loan_total

        net = round(gross - total_ded + reimbursement_total, 2)
        # Belt and braces. `loan_capacity` already floors this at zero for the
        # loan path; this catches the remaining case where statutory alone
        # exceeds earnings, which must surface as a zero payslip to be
        # investigated rather than as a negative one to be emailed.
        if net < 0:
            net = 0.0

        ps_number = await next_doc_number(pool, org_id, "vetana_payslips", "payslip_number", "PS")

        payslip_row = await pool.fetchrow(
            "INSERT INTO staging.vetana_payslips "
            "(org_id, run_id, employee_id, payslip_number, month, "
            "working_days, present_days, leaves_paid, leaves_unpaid, overtime_hours, "
            "basic, hra, da, special_allowance, conveyance, medical, overtime_pay, gross, "
            "pf_employee, pf_employer, esi_employee, esi_employer, "
            "professional_tax, tds, loan_deduction, loan_deductions, reimbursements, total_deductions, net_pay) "
            "VALUES ($1::uuid, $2, $3::uuid, $4, $5, "
            "$6, $7, $8, $9, $10, "
            "$11, $12, $13, $14, $15, $16, $17, $18, "
            # `$26::text::jsonb` — `db.py` registers a jsonb codec whose encoder
            # IS `json.dumps`, so binding an already-dumped string to a `::jsonb`
            # parameter encodes it twice and the column holds a JSON *string*.
            # Measured live: `loan_deductions` came back as `"[{...}]"` rather
            # than an array, the same defect that crashed Graha's Documents tab.
            "$19, $20, $21, $22, $23, $24, $25, $26::text::jsonb, $27, $28, $29) RETURNING id",
            org_id, run_id, emp_id, ps_number, month,
            working_days, present_days, paid_leaves, unpaid_leaves, ot_hours,
            round(basic_pay, 2), round(hra_pay, 2), round(da_pay, 2),
            round(special_pay, 2), round(conveyance_pay, 2), round(medical_pay, 2),
            ot_pay, gross,
            stat["pf_employee"], stat["pf_employer"],
            stat["esi_employee"], stat["esi_employer"],
            stat["professional_tax"], stat["tds"], round(loan_total, 2), json.dumps(loan_deductions),
            round(reimbursement_total, 2), round(total_ded, 2), net,
        )
        if claim_ids:
            await pool.execute(
                "UPDATE staging.manav_expense_claims SET payslip_id=$1::uuid "
                "WHERE id = ANY($2::uuid[])",
                payslip_row["id"], claim_ids,
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

    # ── Notify employees about payslips (with PDF attachment) ──
    # `e.employee_id`, `e.bank_account` and `e.bank_name` DO NOT EXIST on
    # staging.manav_employees — the columns are `employee_code` and a single
    # `bank_details` jsonb. The old list raised UndefinedColumnError, so every
    # payroll run 500'd here AFTER the payslips had been written and the run
    # marked processed. Verified against the live schema, 2026-07-26.
    payslip_rows = await pool.fetch(
        # `esi_number` added alongside: the column exists on manav_employees and
        # was never selected, so the payslip could not show the identifier for an
        # ESI deduction it was already printing.
        "SELECT p.*, e.name AS employee_name, e.email, e.employee_code AS emp_code, "
        "e.pan, e.uan, e.esi_number, e.bank_details, e.designation, "
        # `e.department`, not a join on `e.department_id`. No migration adds
        # `department_id`, manav.py's INSERT (:292) writes `department` as a NAME,
        # and its department roster counts members with `WHERE department = d.name`
        # (:450). The failure modes are asymmetric: if `department_id` is absent
        # the join makes this a hard UndefinedColumnError, whereas `e.department`
        # is a column that exists either way and at worst reads empty.
        "COALESCE(e.department, '') AS department_name "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "AND e.org_id = p.org_id "
        "WHERE p.run_id=$1::uuid AND e.email IS NOT NULL AND e.email != ''",
        run_id,
    )
    if payslip_rows:
        org_row = await pool.fetchrow(
            "SELECT name, gstin, pan, billing_address, logo_url, logo_key, email, phone, website, "
            "COALESCE(authorized_signatory_name, '') AS authorized_signatory_name, "
            "COALESCE(authorized_signatory_designation, '') AS authorized_signatory_designation "
            "FROM staging.organisations WHERE id=$1::uuid", org_id,
        )
        org_dict = dict(org_row) if org_row else {}
        if org_dict.get("logo_key"):
            from services.storage import sign_key
            org_dict["logo_url"] = await sign_key(org_id, org_dict["logo_key"]) or org_dict.get("logo_url", "")
        from services.doc_validation import DocumentIncomplete
        from services.payslip_pdf import generate_payslip_pdf
        from services.employee_email import send_payslip_email
        for ps in payslip_rows:
            ps_dict = dict(ps)
            # `decrypt_bank` handles the string-vs-object case itself, which is
            # why the json.loads dance that used to be here is gone rather than
            # duplicated: `manav_employees.bank_details` is jsonb but older rows
            # hold a JSON *string*, and one implementation of that rule beats
            # two. The account number is ciphertext at rest since the entry
            # form was built — see services/pii.py — and the payslip needs the
            # real number, so it is unwrapped before the PDF is built.
            emp_bank = decrypt_bank(ps_dict.pop("bank_details", None)) or {}
            emp_dict = {
                "name": ps["employee_name"], "employee_id": ps_dict.get("emp_code", ""),
                "employee_code": ps_dict.get("emp_code", ""),
                "department_name": ps_dict.get("department_name", ""),
                "designation": ps_dict.get("designation", ""),
                "pan": ps_dict.get("pan", ""), "uan": ps_dict.get("uan", ""),
                "esi_number": ps_dict.get("esi_number", ""),
                "bank_account": emp_bank.get("account_number", ""),
                "bank_name": emp_bank.get("bank_name", ""),
                "email": ps["email"],
            }
            try:
                pdf_bytes = await asyncio.to_thread(generate_payslip_pdf, ps_dict, emp_dict, org_dict)
            except DocumentIncomplete as e:
                # Mail the notification without the slip rather than attach an
                # incomplete one. Logged by field name so an admin can see WHY
                # a run went out with no attachments; no employee PII in the log.
                logging.getLogger(__name__).warning(
                    "payslip PDF refused as incomplete during payroll run: "
                    "run=%s payslip=%s missing=%s",
                    run_id, ps.get("payslip_number", ""), [g.field for g in e.check.blocking],
                )
                pdf_bytes = None
            except Exception:
                pdf_bytes = None
            send_payslip_email(
                ps["email"], ps["employee_name"], str(ps["month"]),
                float(ps["gross"]), float(ps["net_pay"]), ps["payslip_number"],
                pdf_bytes=pdf_bytes,
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # A payroll run carries the org's total gross, net, PF, ESI and TDS — the
    # whole salary bill. Reading it is what a Vetana grant is FOR, so `viewer`
    # is the right bar now that a grant carries a level; before Tier 4 landed a
    # grant was levelless and this had to be gated on the org role instead.
    # There is no self-scoped view of an org-wide total, so no fallback here.
    _require(levels, EDITOR)
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Returns every payslip in the run — the entire org's pay in one response.
    _require(levels, EDITOR)
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
        "AND e.org_id = p.org_id "
        "WHERE p.run_id=$1::uuid ORDER BY employee_name",
        run_id,
    )
    return {**dict(run), "payslips": [dict(p) for p in payslips]}


@router.patch("/payroll/runs/{run_id}/approve")
async def approve_run(
    run_id: str,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # THE separated-duty check. Approving a run is the moment salaries become
    # payable, and `level_satisfies` refuses admin at the approver rung by
    # design — the person who wrote the salary structures does not get to
    # release the money because they also hold the module's admin level.
    # Held at ADMIN until PROPOSED_071 backfills an approver; see _RELEASE_LEVEL.
    _require(levels, _RELEASE_LEVEL)
    run = await pool.fetchrow(
        "SELECT status, created_by FROM staging.vetana_payroll_runs "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        run_id, org_id,
    )
    if not run:
        raise HTTPException(404, "Payroll run not found")
    if run["status"] != "processed":
        raise HTTPException(400, f"Cannot approve a '{run['status']}' payroll run")

    # ── FOUR EYES ────────────────────────────────────────────────────────────
    # The level check above asks "does this person hold approver?". It cannot
    # ask the other half — "is this the same person who ran it?" — because both
    # authorities can legitimately sit on one account: a sensitive module
    # derives `admin` from the org role, so an org_admin who is also granted
    # approver holds both rungs at once. Measured live 2026-08-03 in the E2E
    # org: one user processed a run and then approved it, and every level check
    # passed, correctly, the whole way. `docs/modules/vetana.md` promises the
    # opposite — "The role that runs payroll cannot approve it."
    #
    # So the control that actually separates the duty is about PEOPLE, not
    # levels. It is deliberately independent of the unresolved
    # RBAC-SPEC-vs-Tier-4 question (`separated-duty.test.jsx` header): it does
    # not care HOW approver is held, only that a SECOND HUMAN holds it.
    #
    # ── Why this is conditional rather than absolute ─────────────────────────
    # Counted against the live catalog before writing it, the same way
    # `_RELEASE_LEVEL` was: EVERY org has exactly ONE Vetana approver today
    # (Aekam Inc 1, QA Test Corp 1). An unconditional rule would therefore not
    # separate the duty — it would stop payroll company-wide on the next run,
    # which is the precise failure the note above this function was written to
    # avoid.
    #
    # So it binds where it can bind: when a second approver exists, the person
    # who ran the payroll cannot release it. Where the org has only one, the
    # release still goes through and is written to the audit log as a
    # self-approval — the owner's rule was "one user can have both FYI but
    # auditable", and this is the "auditable" half made real. Granting a second
    # approver turns the control on for that org with no code change.
    processed_by = run["created_by"] if "created_by" in run else None
    if processed_by and processed_by == user["user_id"]:
        other_approvers = await pool.fetchval(
            "SELECT count(DISTINCT user_id) FROM staging.org_member_modules "
            "WHERE org_id=$1::uuid AND module_code=$2 AND role=$3 AND user_id <> $4",
            org_id, MODULE, APPROVER, user["user_id"],
        ) or 0
        if other_approvers:
            raise HTTPException(
                403,
                "You processed this payroll run, so you cannot also approve it. "
                "Releasing salaries needs a second pair of eyes: ask another "
                "Vetana approver to review and approve it.",
            )
        audit(
            "vetana.payroll_self_approved",
            request,
            org_id=org_id,
            user_id=user["user_id"],
            resource_type="vetana_payroll_run",
            resource_id=str(run_id),
            detail={
                "reason": "sole_approver",
                "processed_by": processed_by,
                "note": (
                    "Processed and approved by the same person because this org "
                    "has no second Vetana approver. Grant one to enforce four eyes."
                ),
            },
            severity="warn",
        )
    # ── THE APPROVAL IS AN EVENT — AND SALARY FIGURES NEVER RIDE ────────────
    # `payroll.published` fires from the write that makes salaries payable,
    # inside that write's own transaction, so the event exists if and only if
    # the approval committed. The emitter (`subjects.payroll_published`) keeps
    # the payload to month, headcount and who published — the run row's seven
    # money columns are handed over on the row and deliberately not read by
    # it, and nothing is passed here beyond the row the UPDATE returned.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # `AND status='processed'`: the pre-check above read the pool
            # BEFORE this transaction, so two overlapping approvals both
            # passed it. The transition in the WHERE makes the second one
            # match zero rows — no write, no event, a 409 in words. This is
            # the same idiom cancel_invoice uses.
            _run_row = await _conn.fetchrow(
                "UPDATE staging.vetana_payroll_runs SET status='approved', "
                "approved_by=$1, approved_at=NOW() "
                "WHERE id=$2::uuid AND org_id=$3::uuid AND status='processed' "
                "RETURNING *",
                user["user_id"], run_id, org_id,
            )
            if _run_row is None:
                raise HTTPException(
                    409, "This run was approved by someone else a moment ago.")
            await _conn.execute(
                "UPDATE staging.vetana_payslips SET status='approved' WHERE run_id=$1::uuid",
                run_id,
            )
            await payroll_published(
                _conn, org_id=org_id, actor_id=user["user_id"],
                run_id=run_id, row=dict(_run_row),
            )

    payslip_loans = await pool.fetch(
        "SELECT loan_deductions FROM staging.vetana_payslips "
        "WHERE run_id=$1::uuid AND loan_deductions != '[]'::jsonb",
        run_id,
    )
    for row in payslip_loans:
        for entry in (row["loan_deductions"] or []):
            loan_id, amt = entry["loan_id"], entry["amount"]
            await pool.execute(
                "UPDATE staging.vetana_loans SET balance_remaining = GREATEST(balance_remaining - $1, 0), "
                "status = CASE WHEN balance_remaining - $1 <= 0 THEN 'closed' ELSE status END "
                "WHERE id=$2::uuid AND org_id=$3::uuid",
                amt, loan_id, org_id,
            )

    await pool.execute(
        "UPDATE staging.manav_expense_claims SET status='paid' "
        "WHERE org_id=$1::uuid AND status='approved' AND payslip_id IN "
        "(SELECT id FROM staging.vetana_payslips WHERE run_id=$2::uuid)",
        org_id, run_id,
    )
    return {"ok": True}


@router.patch("/payroll/runs/{run_id}/revert")
async def revert_run(
    run_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Reverting takes an APPROVED run back to draft — it un-does an approval, so
    # it is the approver's authority, not the admin's. See _RELEASE_LEVEL.
    _require(levels, _RELEASE_LEVEL)
    run = await pool.fetchrow(
        "SELECT status FROM staging.vetana_payroll_runs "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        run_id, org_id,
    )
    if not run:
        raise HTTPException(404, "Payroll run not found")
    if run["status"] not in ("processed", "approved"):
        raise HTTPException(400, "Can only revert a processed or approved payroll run")
    await pool.execute(
        "UPDATE staging.vetana_payroll_runs SET status='draft', "
        "processed_at=NULL WHERE id=$1::uuid AND org_id=$2::uuid",
        run_id, org_id,
    )
    return {"ok": True}


# ── Payslips ─────────────────────────────────────────────────

@router.get("/payslips")
async def list_payslips(
    employee_id: str = "",
    month: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT p.*, "
        "e.name AS employee_name, "
        "e.employee_code "
        "FROM staging.vetana_payslips p "
        # `AND e.org_id = p.org_id` matches the tightening applied to
        # `vikray.py:648`. The payslip is already org-filtered, so this changes
        # nothing while referential integrity holds; it means a payslip whose
        # `employee_id` ever pointed across a tenant boundary yields no row
        # rather than another org's employee name and code.
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "AND e.org_id = p.org_id "
        "WHERE p.org_id=$1::uuid AND p.is_active=TRUE"
    )
    params: list = [org_id]

    # No grant → own payslips only, which is what SELF_SCOPED_MODULES promises
    # every employee without one. A grant at viewer or above reads the register.
    if not _can(levels, EDITOR):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own payslips")
        employee_id = own

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
    levels=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT p.*, "
        "e.name AS employee_name, "
        "e.employee_code, e.pan, e.uan, e.bank_details, "
        "e.user_id AS employee_user_id "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "AND e.org_id = p.org_id "
        "WHERE p.id=$1::uuid AND p.org_id=$2::uuid",
        payslip_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Payslip not found")

    out = dict(row)
    # This endpoint returned a colleague's PAN, UAN and full bank account to
    # anyone holding a Vetana grant — the same failure closed for
    # `manav_employees` in 4f10b6c, still open here because the payslip join
    # pulls the identity columns off that very table. Own payslip or not, the
    # JSON is masked; the PDF is where an employee gets their real figures.
    if out.pop("employee_user_id", None) != user["user_id"]:
        if not _can(levels, EDITOR):
            raise HTTPException(404, "Payslip not found")
    return _mask_payslip_row(out)


@router.patch("/payslips/{payslip_id}/disburse")
async def disburse_payslip(
    payslip_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # Marking a salary disbursed IS the release of money. Approver, not admin —
    # see _RELEASE_LEVEL for why this is still held at admin today.
    _require(levels, _RELEASE_LEVEL)
    ps = await pool.fetchrow(
        "SELECT status, run_id FROM staging.vetana_payslips "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        payslip_id, org_id,
    )
    if not ps:
        raise HTTPException(404, "Payslip not found")
    if ps["status"] != "approved":
        raise HTTPException(400, "Payslip must be approved before disbursement")
    # ── ONE EVENT PER RUN, AT THE MOMENT THE RUN FINISHES DISBURSING ────────
    # `payslip.disbursed` deliberately never fires per payslip: a per-payslip
    # event is a per-person salary fact with a name attached, which the
    # payroll payload rule exists to keep out of a log every rule author can
    # read. It fires once — when the LAST approved payslip flips and the run
    # itself goes 'disbursed' — and `employee_count` is counted inside the
    # same transaction as that flip, so it is the number of payslips actually
    # disbursed rather than the run row's planned counter. `month` is read
    # off the run row the flip returned, the column's own text shape.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # FOR UPDATE on the run serializes the two disbursement races the
            # review named: two clicks on the SAME final payslip both passing
            # the stale pre-check (double payslip.disbursed), and two
            # DIFFERENT final payslips in flight where each transaction's
            # count missed the other's uncommitted flip, so neither flipped
            # the run and the event never fired. The lock makes the second
            # transaction wait and see the first's commit.
            await _conn.fetchrow(
                "SELECT id FROM staging.vetana_payroll_runs "
                "WHERE id=$1::uuid FOR UPDATE",
                ps["run_id"],
            )
            _slip = await _conn.fetchrow(
                "UPDATE staging.vetana_payslips SET status='disbursed', disbursed_at=NOW() "
                "WHERE id=$1::uuid AND org_id=$2::uuid AND status='approved' "
                "RETURNING id",
                payslip_id, org_id,
            )
            if _slip is None:
                raise HTTPException(
                    409, "This payslip was disbursed by someone else a moment ago.")
            undisbursed = await _conn.fetchval(
                "SELECT COUNT(*) FROM staging.vetana_payslips "
                "WHERE run_id=$1 AND status != 'disbursed'",
                ps["run_id"],
            )
            if undisbursed == 0:
                _run_row = await _conn.fetchrow(
                    "UPDATE staging.vetana_payroll_runs SET status='disbursed' "
                    "WHERE id=$1 AND status != 'disbursed' "
                    "RETURNING *",
                    ps["run_id"],
                )
                _flipped = await _conn.fetchval(
                    "SELECT COUNT(*) FROM staging.vetana_payslips "
                    "WHERE run_id=$1 AND status='disbursed'",
                    ps["run_id"],
                )
                if _run_row is not None:
                    await payslip_disbursed(
                        _conn, org_id=org_id, actor_id=user["user_id"],
                        run_id=ps["run_id"], month=_run_row.get("month"),
                        employee_count=_flipped,
                    )
    return {"ok": True}


@router.get("/payslips/{payslip_id}/pdf")
async def download_payslip_pdf(
    payslip_id: str,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    from services.doc_validation import DocumentIncomplete
    from services.payslip_pdf import generate_payslip_pdf

    logger = logging.getLogger(__name__)
    pool = await get_pool()

    # `date_of_joining` and `esi_number` are here because the payslip
    # specification asks for them — `design-reference/Kartavaya Redesign/docs/
    # Payslip.html` prints "Joined 14 Mar 2023" in the employee block and
    # "ESI 3101234567" in the statutory block. Both columns already exist on
    # `staging.manav_employees` (they are in manav's `_EMP_SAFE_COLS`); nothing
    # was selecting them, so the renderer could not have shown them even once it
    # is rewritten to. See the payslip gap list in the swarm report for the two
    # fields that have no column at all yet.
    row = await pool.fetchrow(
        "SELECT p.*, "
        "e.name AS employee_name, e.employee_code, e.designation, "
        "e.pan AS emp_pan, e.uan, e.esi_number, e.date_of_joining, "
        "e.bank_details, e.email AS emp_email, "
        "e.user_id AS employee_user_id, e.id AS emp_row_id, "
        # See the payroll-run query above for why this reads `e.department`
        # rather than joining `staging.manav_departments` on `e.department_id`.
        "COALESCE(e.department, '') AS department_name "
        "FROM staging.vetana_payslips p "
        "JOIN staging.manav_employees e ON e.id = p.employee_id "
        "AND e.org_id = p.org_id "
        "WHERE p.id=$1::uuid AND p.org_id=$2::uuid",
        payslip_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Payslip not found")

    # The PDF is the one place full PAN, UAN and account number still appear —
    # it is a statutory document and an employee is entitled to their own with
    # real figures on it, with no grant at all. Anyone else pulling it needs
    # ADMIN, not viewer: a viewer reads the register with the identifiers
    # masked, and an unmasked identity document is a higher bar than reading a
    # figure. Every such read is audited — this is the payroll equivalent of
    # Manav's /employees/{id}/sensitive and must not be quieter than that one.
    payslip = dict(row)
    is_own = payslip.pop("employee_user_id", None) == user["user_id"]
    if not is_own:
        _require(levels, ADMIN)
        audit(
            "vetana.payslip_pdf_downloaded",
            request,
            org_id=org_id,
            user_id=user["user_id"],
            resource_type="vetana_payslip",
            resource_id=str(payslip_id),
            detail={
                "fields": ["pan", "uan", "bank_account"],
                "employee": payslip.get("employee_name", ""),
                "via": "platform_bypass" if await is_platform_staff(user["user_id"]) else "org_admin",
            },
            severity="warn",
        )

    org = await pool.fetchrow(
        "SELECT name, gstin, pan, billing_address, logo_url, logo_key, email, phone, website, "
        "COALESCE(authorized_signatory_name, '') AS authorized_signatory_name, "
        "COALESCE(authorized_signatory_designation, '') AS authorized_signatory_designation "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )

    # Decrypted, not raw: the account number is ciphertext at rest and the PDF
    # prints "A/c ending 4417" from its last four digits. Taking the last four
    # characters of a Fernet token would print four random characters that look
    # exactly like an account tail. See services/pii.py.
    bank_details = decrypt_bank(payslip.pop("bank_details", None)) or {}

    # The leave-balance table is part of the payslip specification — four
    # columns, Type / Opening / Taken / Balance. `manav_leave_balances` already
    # holds all four (opening is allocated + carried_forward); nothing was
    # reading them here.
    emp_row_id = payslip.pop("emp_row_id", None)
    leave_rows = await pool.fetch(
        "SELECT lt.name AS leave_name, lb.allocated, lb.used, lb.carried_forward "
        "FROM staging.manav_leave_balances lb "
        "JOIN staging.manav_leave_types lt ON lt.id = lb.leave_type_id "
        "WHERE lb.employee_id=$1::uuid "
        "AND lb.year=EXTRACT(YEAR FROM CURRENT_DATE)::int "
        "ORDER BY lt.name",
        str(emp_row_id),
    ) if emp_row_id else []

    account_number = bank_details.get("account_number", "") or ""

    employee = {
        "name": payslip.pop("employee_name", ""),
        "employee_code": payslip.pop("employee_code", ""),
        "department_name": payslip.pop("department_name", ""),
        "designation": payslip.pop("designation", ""),
        "pan": payslip.pop("emp_pan", ""),
        "uan": payslip.pop("uan", ""),
        "esi_number": payslip.pop("esi_number", "") or "",
        "date_of_joining": payslip.pop("date_of_joining", None),
        "bank_account": account_number,
        # The specification prints "A/c ending 4417", not the whole number — the
        # payslip is a document that gets forwarded and filed, and the last four
        # are all it needs to identify the account. Supplied separately so the
        # renderer can move to it without this endpoint changing again.
        "bank_account_last4": account_number[-4:] if account_number else "",
        "bank_name": bank_details.get("bank_name", ""),
        "email": payslip.pop("emp_email", ""),
        "leave_balances": [
            {
                "name": r["leave_name"],
                "opening": float(r["allocated"] or 0) + float(r["carried_forward"] or 0),
                "taken": float(r["used"] or 0),
                "balance": (
                    float(r["allocated"] or 0)
                    + float(r["carried_forward"] or 0)
                    - float(r["used"] or 0)
                ),
            }
            for r in leave_rows
        ],
    }

    org_dict = dict(org) if org else {}
    if isinstance(org_dict.get("billing_address"), str):
        org_dict["billing_address"] = json.loads(org_dict["billing_address"] or "{}")
    if org_dict.get("logo_key"):
        from services.storage import sign_key
        org_dict["logo_url"] = await sign_key(org_id, org_dict["logo_key"]) or org_dict.get("logo_url", "")

    try:
        pdf_bytes = await asyncio.to_thread(generate_payslip_pdf, payslip, employee, org_dict)
    except DocumentIncomplete as e:
        # The slip is missing a statutory identifier for a deduction it records,
        # or its figures do not reconcile. Refuse rather than issue a wage record
        # the employee cannot verify. No employee PII goes in the log line.
        logger.info("payslip PDF refused as incomplete: payslip=%s org=%s missing=%s",
                    payslip_id, org_id, [g.field for g in e.check.blocking])
        raise HTTPException(422, detail=e.as_payload())
    except Exception as e:
        logger.error("payslip PDF generation failed: payslip=%s org=%s err=%s\n%s",
                     payslip_id, org_id, e, traceback.format_exc())
        raise HTTPException(500, "Failed to generate payslip PDF — please try again.")

    filename = f"Payslip-{payslip.get('payslip_number', 'payslip')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Dashboard ────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    # YTD gross, net and a per-department salary split. Org-level financials —
    # a read, so viewer, but there is no own-row version of an org total and no
    # self-scoped fallback.
    _require(levels, EDITOR)
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
        "AND e.org_id = p.org_id "
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
    levels=Depends(_gate),
):
    pool = await get_pool()
    # A PF/ESI/PT/TDS register for the whole org, carrying everyone's PAN and
    # UAN. A read of the register, so viewer — and PAN and UAN stay masked at
    # every level: nothing here needs the full number on screen, and the figures
    # are what the filing is for.
    _require(levels, EDITOR)
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
        "AND e.org_id = p.org_id "
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
        "employees": [_mask_payslip_row(dict(r)) for r in rows],
        "totals": dict(totals) if totals else {},
    }


# ── Loans & Salary Advances ──────────────────────────────────

@router.get("/loans")
async def list_loans(
    employee_id: str = "",
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT l.*, e.name AS employee_name, e.employee_code "
        "FROM staging.vetana_loans l "
        "JOIN staging.manav_employees e ON e.id = l.employee_id "
        "WHERE l.org_id=$1::uuid"
    )
    params: list = [org_id]

    # A loan against salary is a personal financial record. Same rule as the
    # payslip: your own with no grant, anyone else's needs one.
    if not _can(levels, EDITOR):
        own = await _own_employee_id(pool, user, org_id)
        if not own:
            return {"data": []}
        if employee_id and employee_id != own:
            raise HTTPException(403, "You can only view your own loans")
        employee_id = own

    if employee_id:
        params.append(employee_id)
        q += f" AND l.employee_id=${len(params)}::uuid"
    if status:
        params.append(status)
        q += f" AND l.status=${len(params)}"
    q += " ORDER BY l.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/loans")
async def create_loan(
    body: LoanCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    if body.principal_amount <= 0 or body.emi_amount <= 0:
        raise HTTPException(400, "Principal and EMI amounts must be positive")
    pool = await get_pool()
    # A loan changes what someone takes home. Breadth, so admin.
    _require(levels, ADMIN)
    # The employee must be in this org. Without this the row would reference a
    # foreign employee and the notification below would email a stranger.
    if not await pool.fetchval(
        "SELECT 1 FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        body.employee_id, org_id,
    ):
        raise HTTPException(404, "Employee not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.vetana_loans "
        "(org_id, employee_id, principal_amount, emi_amount, balance_remaining, "
        "disbursed_date, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $3, "
        "COALESCE(NULLIF($5,'')::date, CURRENT_DATE), $6, $7) "
        "RETURNING *",
        org_id, body.employee_id, body.principal_amount, body.emi_amount,
        body.disbursed_date, body.notes, user["user_id"],
    )
    # ── Notify employee ──
    emp = await pool.fetchrow(
        "SELECT name, email FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        body.employee_id, org_id,
    )
    if emp and emp.get("email"):
        from services.employee_email import send_loan_email
        send_loan_email(
            emp["email"], emp["name"], "Employee Loan",
            float(body.principal_amount), float(body.emi_amount), "approved",
        )
    return dict(row)


@router.patch("/loans/{loan_id}")
async def update_loan(
    loan_id: str,
    body: LoanUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    pool = await get_pool()
    _require(levels, ADMIN)
    updates, vals = [], []
    for field in ("emi_amount", "status", "notes"):
        val = getattr(body, field)
        if val is not None:
            vals.append(val)
            updates.append(f"{field}=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    vals += [loan_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.vetana_loans SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Loan not found")
    return dict(row)
