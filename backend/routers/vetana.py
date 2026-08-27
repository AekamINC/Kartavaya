"""
vetana.py — Vetana · वेतन (Payroll) Router
Salary structures, payroll processing, payslips, statutory compliance.
Reads Manav (HRMS) for employees, attendance, leaves.
"""
import asyncio
import calendar
import json
from datetime import date, datetime, timedelta, timezone
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
# The commission arithmetic, imported rather than reimplemented. Every figure
# it returns is a Decimal and every absence it returns is a REASON rather than
# a zero — which is the whole reason payroll reaches for it instead of
# multiplying a rate by a SUM here. See services/commission.py.
from services import commission as C
from services.niyam.subjects import payroll_published, payslip_disbursed
# THE state codelist, not a second copy of it. '27', 27, 'MH', 'mh' and
# 'Maharashtra' collapse onto one canonical numeric code, which is what makes
# an employee's state comparable to a `pay_professional_tax` slab row when the
# two were written in different conventions. `routers/manav.py:51` and
# `services/skills/action/attendance_auto_mark.py` import the same helper for
# the same reason — see `_state_keys`.
from services.gst_states import norm_state as _norm_state
from services.on_the_rolls import still_on_the_rolls
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


# ── The professional-tax ladder, as something a person can set ──────────────
#
# Until now NOTHING in this product could write `staging.pay_professional_tax`.
# Every reference in `backend/` was a read, and the nine rows existed because a
# migration put them there — so a state nobody seeded, a rate change, or
# Maharashtra's different February figure could only be fixed by shipping
# another migration. That is the same shape as every Phase-1 defect: a column
# with no write path.
#
# TWO RULES DECIDE EVERYTHING BELOW.
#
# 1. A SHARED ROW IS READ BY EVERYONE AND EDITABLE BY NOBODY. `org_id IS NULL`
#    is national reference data; letting one firm PATCH it would change every
#    other firm's deductions from inside their own settings screen. So the write
#    endpoints are scoped `org_id = $1::uuid` with no NULL branch, and an
#    organisation that wants a different figure ADDS ITS OWN ROW, which outranks
#    the shared one for the same state and band (`is_own` in `_pt_from_slabs`).
#    A 404 on somebody else's row is the same answer a row that does not exist
#    gets, which is the only answer that does not confirm it is there.
#
# 2. NOTHING HERE IS REQUIRED AND NOTHING HERE BLOCKS A RUN. Owner's rule,
#    2026-08-26: like GSTIN, PAN and TAN, this is optional. An org that sets
#    nothing keeps the shared ladder; an org that sets a partial ladder falls
#    back through it; an org that matches no band at all deducts zero, which is
#    the owner's existing decision. The validation below refuses an
#    UNINTERPRETABLE BAND at the moment somebody types it — a `slab_to` beneath
#    its own `slab_from` can never match anything — and that is a refusal to
#    SAVE, never a refusal to run payroll.


class PtSlabCreate(BaseModel):
    state_code: str
    state_name: str = ""
    slab_from: float = 0
    slab_to: Optional[float] = None
    monthly_tax: float = 0
    effective_from: str = ""
    #: 1-12, or None for EVERY month — which is what all nine seeded rows are.
    #: Professional tax is not flat everywhere; Maharashtra charges a different
    #: figure in February (migration 221).
    month: Optional[int] = None


class PtSlabUpdate(BaseModel):
    state_code: Optional[str] = None
    state_name: Optional[str] = None
    slab_from: Optional[float] = None
    slab_to: Optional[float] = None
    monthly_tax: Optional[float] = None
    effective_from: Optional[str] = None
    month: Optional[int] = None


def _check_band(slab_from, slab_to, month) -> None:
    """Refuse a band that could never match anything. Save-time only."""
    if slab_from is not None and float(slab_from) < 0:
        raise HTTPException(400, "A band cannot start below zero.")
    if slab_to is not None and slab_from is not None and float(slab_to) < float(slab_from):
        raise HTTPException(
            400,
            "This band ends below where it starts, so no salary could ever fall "
            "inside it. Leave the upper figure blank for 'and above'.",
        )
    if month is not None and not (1 <= int(month) <= 12):
        raise HTTPException(
            400,
            "A month must be between 1 and 12, or left blank to mean every month.",
        )


@router.get("/pt-slabs")
async def list_pt_slabs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The whole ladder this org resolves against — its own rows AND the shared
    ones, each flagged, because a screen showing only the org's own rows would
    present an empty ladder as "nothing is deducted" while nine shared bands
    were in fact doing the work.

    Not gated to ADMIN: seeing which rate applies to you is not privileged, and
    `_gate` already scopes this to people who have Vetana at all.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, state_code, state_name, slab_from, slab_to, monthly_tax, "
        "       effective_from, month, (org_id IS NOT NULL) AS is_own "
        "  FROM staging.pay_professional_tax "
        " WHERE org_id = $1::uuid OR org_id IS NULL "
        " ORDER BY state_code, month NULLS FIRST, slab_from",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/pt-slabs")
async def create_pt_slab(
    body: PtSlabCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Add a band to THIS organisation's ladder. Never touches a shared row."""
    pool = await get_pool()
    _require(levels, ADMIN)
    _check_band(body.slab_from, body.slab_to, body.month)
    row = await pool.fetchrow(
        "INSERT INTO staging.pay_professional_tax "
        "(org_id, state_code, state_name, slab_from, slab_to, monthly_tax, "
        " effective_from, month) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, "
        # `::text::date`, never a bare `::date` on an ISO string — that bind is
        # the asyncpg DataError this repo has already paid for twice.
        "        NULLIF($7,'')::text::date, $8) "
        "RETURNING id, state_code, state_name, slab_from, slab_to, monthly_tax, "
        "          effective_from, month, TRUE AS is_own",
        org_id,
        str(body.state_code or "").strip(),
        str(body.state_name or "").strip(),
        body.slab_from, body.slab_to, body.monthly_tax,
        body.effective_from or "", body.month,
    )
    return dict(row)


@router.patch("/pt-slabs/{slab_id}")
async def update_pt_slab(
    slab_id: int,
    body: PtSlabUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Amend one of THIS organisation's own bands.

    `model_fields_set` rather than a truthiness test, so a figure entered by
    mistake can be cleared back: `monthly_tax = 0` is a real answer — a band a
    state levies nothing on — and must stay distinguishable from "not
    mentioned". The pattern `billing.py:1187` documents.
    """
    pool = await get_pool()
    _require(levels, ADMIN)
    named = getattr(body, "model_fields_set", set())
    if not named:
        raise HTTPException(400, "Nothing to change.")

    current = await pool.fetchrow(
        "SELECT slab_from, slab_to, month FROM staging.pay_professional_tax "
        " WHERE id=$1 AND org_id=$2::uuid",
        slab_id, org_id,
    )
    # 404, not 403 — the same answer a row that does not exist gets, because a
    # distinct refusal would confirm somebody else's row is there.
    if not current:
        raise HTTPException(404, "Professional-tax band not found")
    _check_band(
        body.slab_from if "slab_from" in named else current["slab_from"],
        body.slab_to if "slab_to" in named else current["slab_to"],
        body.month if "month" in named else current["month"],
    )

    sets, params = [], []
    for col in ("state_code", "state_name", "slab_from", "slab_to",
                "monthly_tax", "month"):
        if col in named:
            params.append(getattr(body, col))
            sets.append(col + "=$" + str(len(params)))
    if "effective_from" in named:
        params.append(body.effective_from or "")
        sets.append("effective_from=NULLIF($" + str(len(params)) + ",'')::text::date")
    if not sets:
        raise HTTPException(400, "Nothing to change.")

    params.extend([slab_id, org_id])
    row = await pool.fetchrow(
        "UPDATE staging.pay_professional_tax SET " + ", ".join(sets) +
        " WHERE id=$" + str(len(params) - 1) +
        " AND org_id=$" + str(len(params)) + "::uuid "
        "RETURNING id, state_code, state_name, slab_from, slab_to, monthly_tax, "
        "          effective_from, month, TRUE AS is_own",
        *params,
    )
    if not row:
        raise HTTPException(404, "Professional-tax band not found")
    return dict(row)


@router.delete("/pt-slabs/{slab_id}")
async def delete_pt_slab(
    slab_id: int,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Remove one of THIS organisation's own bands.

    A hard delete, because the table carries no `is_active` and a soft-deleted
    slab that `_pt_slabs` still read would deduct money nobody could see a
    reason for. Removing an org's band does not remove the shared one beneath
    it — the ladder falls back, which is the whole design.
    """
    pool = await get_pool()
    _require(levels, ADMIN)
    result = await pool.execute(
        "DELETE FROM staging.pay_professional_tax WHERE id=$1 AND org_id=$2::uuid",
        slab_id, org_id,
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Professional-tax band not found")
    return {"ok": True}


# ── Payroll Processing ───────────────────────────────────────

# ── The statutory switches, and what an UNANSWERED one means ─────────────────
#
# OWNER, 2026-08-21: "in general PF, ESI etc as well for all employee keep it as
# optional please we dont know how company operates so we dont block."
#
# THE BUG THIS TABLE FIXES. Every guard here used to read
# `if structure["pf_enabled"]`. asyncpg returns None for a NULL column, None is
# falsy, so a NULL read as OFF — while the column's DEFAULT is TRUE. A
# structure created through a path that named the column got PF; one that left
# it NULL silently did not, and nobody was told. Statutory deductions must not
# hinge on Python truthiness.
#
# So an unanswered flag is read AT ITS COLUMN'S OWN DEFAULT, which is stated
# here beside the name and matches the DDL exactly. No NULL exists in any of
# these today (measured read-only 2026-08-21: 94 structures, NULL=0 on all
# four of the pre-existing flags), so this removes a trap rather than repairing
# damage.
#
# NOTHING BELOW BLOCKS A RUN. There is no validation anywhere that refuses to
# compute payroll because a firm has not ticked something — an unanswered flag
# is read at its default and THE PAYSLIP RECORDS THAT IT WAS.
_FLAG_WHEN_UNSET = {
    # Already on the table before migration 190. Defaults copied from the DDL.
    "pf_enabled": True,             # DEFAULT true   — 91 of 94 on
    "esi_enabled": False,           # DEFAULT false  — 3 of 94 on
    "pt_applicable": True,          # DEFAULT true   — 94 of 94 on
    # NEW in migration 190. TDS previously had NO off switch at all: the slab
    # table ran unconditionally and `tds_regime` only chose which table. TRUE
    # because it matches its neighbours AND because it is behaviour-preserving
    # — 871 of 1,095 existing payslips carry a TDS figure, and a migration must
    # not stop deducting anybody's tax.
    "tds_applicable": True,         # DEFAULT true
    # NEW in migration 190. FALSE IS A CHOICE, not a neutral position: unticked
    # means the component does not attract the deduction. Chosen because it
    # preserves exactly what payroll did before commission and bonus existed.
    "commission_in_pf_base": False,
    "commission_in_esi_base": False,
    "bonus_in_pf_base": False,
    "bonus_in_esi_base": False,
}


def _flag(structure: dict, name: str) -> tuple:
    """(value, was_unanswered) for one statutory switch.

    A MISSING KEY IS ALSO UNANSWERED, and that is deliberate: this code deploys
    before migration 190 is applied, so `SELECT s.*` returns a row without the
    five new columns. Reading them at their stated defaults means the deploy
    changes nothing and the migration changes nothing — the behaviour only
    moves when a firm ticks a box.
    """
    default = _FLAG_WHEN_UNSET[name]
    raw = structure.get(name)
    if raw is None:
        return default, True
    return bool(raw), False


# ── PROFESSIONAL TAX IS A STATE LEVY, AND THIS FILE USED TO CHARGE ONE RATE ──
#
# `pt = 200 if pt_on and gross > 15000 else 0` charged every employee in the
# country the same ₹200 — including states that levy nothing at all. Measured
# read-only on the live database 2026-08-25: 1,105 of 1,112 payslips carry
# exactly 200.00 and the other 7 carry 0.00, which is that one line and nothing
# else. Meanwhile `staging.pay_professional_tax` holds a real nine-row slab
# ladder that NOTHING in the product reads.
#
# THE SLAB TABLE, AS IT ACTUALLY IS (measured, not guessed):
#
#   id              integer  NOT NULL  serial
#   state_code      varchar  NOT NULL  the NUMERIC GST code — '24','27','29'
#   state_name      text     NOT NULL  'Gujarat','Maharashtra','Karnataka'
#   slab_from       numeric  NOT NULL  inclusive lower bound of the gross band
#   slab_to         numeric  NULL      inclusive upper bound; NULL = open-ended
#   monthly_tax     numeric  NOT NULL  what the band charges per month
#   effective_from  date     NULL      DEFAULT '2024-04-01'
#   org_id          uuid     NULL      IT IS PER-ORG SEED DATA, NOT A SHARED
#                                      REFERENCE SET — all nine live rows belong
#                                      to one org, so an org that has not seeded
#                                      it has no slabs rather than a national
#                                      default.
#
# NOTHING HERE BLOCKS A RUN, which is the same rule the statutory switches
# above follow. No state, no slab, no match, an unreadable figure — every one
# of those yields ZERO professional tax and the run continues. Deducting a tax
# nobody can justify is the fault being fixed; refusing to pay somebody because
# a slab is missing would be a worse one.

#: The employee column that names a state, most-preferred first.
#: `migrations/220_employee_state.sql` adds `manav_employees.state` (Phase 1.5)
#: and its COMMENT settles the convention: the NUMERIC GST code, '27', the same
#: form `pay_professional_tax.state_code` holds. `state_code` is admitted second
#: only because `manav_holidays` took that spelling in migration 175/180 and
#: this is not the file to lose a payroll run over which name won.
#:
#: ⚠ 220 IS NOT APPLIED. Confirmed read-only against the live database
#: 2026-08-25: `manav_employees` carries neither column, only an `address`
#: jsonb. Until it is applied, `_employee_state_column` returns None, the slab
#: table is never read, and professional tax is exactly what it was.
#:
#: THIS TUPLE IS THE ALLOWLIST. The column name is interpolated into SQL, so it
#: may only ever be one of these AND must have been confirmed by the server's
#: own catalogue first. No runtime value reaches it.
_PT_STATE_COLUMNS = ("state", "state_code")


async def _employee_state_column(pool) -> str | None:
    """Which column on `manav_employees` names the state, or None if none does.

    Asked of the catalogue rather than assumed, for the reason the
    `statutory_treatment` probe below is: code deploys here before migrations
    are applied, and a payroll run that 500s on an unknown column would be
    exactly the blocking the owner ruled out. While the answer is None the
    slab table is not consulted at all and professional tax is computed exactly
    as it was before this change — the deploy is a no-op until Phase 1.5 lands.
    """
    name = await pool.fetchval(
        "SELECT column_name FROM information_schema.columns "
        " WHERE table_schema = 'staging' AND table_name = 'manav_employees' "
        "   AND column_name = ANY($1::text[]) "
        " ORDER BY array_position($1::text[], column_name) "
        " LIMIT 1",
        list(_PT_STATE_COLUMNS))
    # Belt and braces over the allowlist: the value is interpolated into SQL.
    return name if name in _PT_STATE_COLUMNS else None


def _working_days_between(start: date, end: date) -> int:
    """Working days in the inclusive range, on THIS module's definition of one.

    The payroll run's `working_days` is "every calendar day of the month that is
    not a Sunday" — a deliberate simplification, stated as such where it is
    computed. This counts the same thing over an arbitrary range, so a partial
    month is measured on the identical basis as the full one it is divided by.
    Two different definitions either side of that division would quietly change
    everybody's pay, which is why this reads Sundays out rather than reaching
    for a holiday calendar it does not share.

    Returns 0 when the range is empty or inverted — someone whose last working
    day precedes the month is not in the run at all (the structures query drops
    them), and an inverted window must never produce a negative day count that
    a ratio could turn into a negative payslip.
    """
    if end < start:
        return 0
    return sum(
        1
        for i in range((end - start).days + 1)
        if (start + timedelta(days=i)).weekday() != 6
    )


def _employed_working_days(month_start: date, month_end: date,
                           doj, last_day) -> int:
    """How many of this month's working days the person was actually on the rolls.

    Clamps the employment window to the month and counts it on the same basis
    the month itself is counted. A missing joining date means "already here"; a
    missing last working day means "still here" — both are the safe reading, and
    both match how the rest of this module treats a NULL date: an absent fact is
    never evidence against somebody's pay.

    Pulled out as a function rather than left inline SO THAT A TEST CAN CALL THE
    THING THE RUN CALLS. The arithmetic that decides a payslip must not be
    testable only by re-implementing it in the test — that is a check which
    passes whatever the product does.
    """
    start = max(month_start, doj) if doj else month_start
    end = min(month_end, last_day) if last_day else month_end
    return _working_days_between(start, end)


async def _esi_ceiling(pool, as_of: date) -> float | None:
    """The ESI wage ceiling in force on `as_of`, from the dated law store.

    PHASE 5.1, AND THE FIRST PAYROLL CONSTANT TO COME OUT OF A LITERAL.
    `staging.statute_calendar` is read by eight skill modules and by no engine,
    so the thing proposal 79 calls the best idea in the product protects nothing
    a customer is billed on. `services/statute.py` already resolves a key at a
    date correctly — half-open intervals, ranked supersession, `as_of`
    mandatory — it was simply never called from here.

    IT CHANGES NOTHING TODAY, WHICH IS THE POINT. The live row is
    `esi.wage_ceiling` = 21,000 effective 2017-01-01, verified 2026-08-20
    against ESI (Central) Rules 1950 rule 50 — the same number the literal
    carried. So the mechanism lands without moving a payslip, and the next
    ceiling change becomes a dated row instead of a deploy.

    RETURNS None WHEN THE STORE CANNOT ANSWER, and the caller keeps the
    statutory literal. That asymmetry is deliberate and is NOT the choice made
    for professional tax: an absent PT slab means "this state levies nothing",
    a defensible zero, whereas an absent ESI ceiling would mean "no ceiling" and
    charge ESI to people the Act exempts. A missing row must never widen a
    deduction.
    """
    try:
        from services import statute
        row = await statute.obligation(pool, "esi.wage_ceiling", as_of=as_of)
    except Exception:
        # A payroll run must not stop because the law store is unreadable.
        logging.getLogger(__name__).warning(
            "esi.wage_ceiling could not be read for %s; keeping the statutory "
            "literal", as_of, exc_info=True)
        return None
    if not row or row.get("threshold_amount") is None:
        return None
    try:
        return float(row["threshold_amount"])
    except (TypeError, ValueError):
        return None


async def _epf_terms(pool, as_of: date) -> tuple:
    """(employee rate %, employer rate %, wage ceiling) in force on `as_of`.

    PHASE 5.1, SECOND CONSTANT OUT OF A LITERAL. `_compute_statutory` carried
    `min(pf_base * 0.12, 1800)`, which hardcodes TWO statutory facts at once —
    the 12% rate and the ₹15,000 ceiling that makes 1,800 the cap — and neither
    could change without a deploy or say when it started.

    THE STORE COULD NOT ANSWER UNTIL TODAY, and that is why this was still a
    literal after 5.1's first pass. `epf.remittance` exists and is a DUE-DATE
    row: its `rate_percent` and `threshold_amount` are both NULL. Of the 45
    rows in `statute_calendar`, exactly one carried a payroll figure —
    `esi.wage_ceiling`. Migration 228 seeds the three that were missing, cited.

    IT MOVES NO PAYSLIP. 12% of ₹15,000 is ₹1,800, the same cap the literal
    carried, so every payslip in both in-scope orgs computes what it computed
    yesterday. The mechanism lands without moving money.

    EACH TERM FALLS BACK ON ITS OWN, and the fallback is the statutory literal
    rather than zero — the same asymmetry `_esi_ceiling` argues for and the
    OPPOSITE of the professional-tax choice. An absent PT slab means "this state
    levies nothing", a defensible zero. An absent PF rate does not mean "no
    provident fund": it means the store cannot answer, and answering 0% would
    under-remit somebody's retirement contribution and breach s.6 quietly, on
    the employer's behalf. A missing row must never shrink a statutory
    contribution any more than it may widen one.
    """
    from services import statute

    async def _one(key: str, column: str):
        try:
            row = await statute.obligation(pool, key, as_of=as_of)
        except Exception:
            # A payroll run must not stop because the law store is unreadable.
            logging.getLogger(__name__).warning(
                "%s could not be read for %s; keeping the statutory literal",
                key, as_of, exc_info=True)
            return None
        if not row or row.get(column) is None:
            return None
        try:
            return float(row[column])
        except (TypeError, ValueError):
            return None

    return (
        await _one("epf.rate.employee", "rate_percent"),
        await _one("epf.rate.employer", "rate_percent"),
        await _one("epf.wage_ceiling", "threshold_amount"),
    )


async def _terminal_benefit_terms(pool, as_of: date) -> dict:
    """Gratuity and statutory-bonus terms in force on `as_of`, from dated law.

    PHASE 5.2. Migration 229 seeds seven keys that did not exist in any form —
    `grep gratuity backend/` found ONE file before it, `services/compliance_settings.py`,
    where gratuity is a rule a firm can tick rather than a rate anything computes.

    ── WHAT READS THIS TODAY, STATED PLAINLY ───────────────────────────────────

    **Nothing in payroll does, because there is no full-and-final settlement
    path.** `process_payroll` says so in its own words a few hundred lines below
    — "no full-and-final settlement path exists anywhere in the codebase
    (searched: settlement, fnf, final_settlement — no hits)" — and threads a
    `final_settlement` flag through for a feature that has not been built.

    So this is a reader placed AHEAD of its caller, on purpose and against this
    repo's usual instinct, for one reason: when F&F is built it must inherit
    dated law rather than invent constants, and the way to guarantee that is for
    the constants to have nowhere to be invented from. The keys are also live to
    the skill shelf the moment they land — `statute_calendar` is read by eight
    skill modules — so they are not inert either.

    ── THE TWO TRAPS IN THE VALUES IT RETURNS ──────────────────────────────────

    · `gratuity_qualifying_years` is YEARS. `threshold_amount` is an unqualified
      NUMERIC that every other row in the table uses for rupees. A caller that
      assumes rupees reads five rupees.
    · `bonus_calculation_ceiling` is a FLOOR, not the answer. s.12 says ₹7,000
      **or the minimum wage for the scheduled employment, whichever is higher**,
      and the second limb is a state-by-state figure this product does not hold.

    Both are repeated in the rows' own `notes`, because a caller reading the
    database directly will not have this docstring in front of them.

    Returns a dict with None for anything the store cannot answer. It never
    raises: a payroll run must not stop because the law store is unreadable.
    """
    from services import statute

    async def _one(key: str, column: str):
        try:
            row = await statute.obligation(pool, key, as_of=as_of)
        except Exception:
            logging.getLogger(__name__).warning(
                "%s could not be read for %s", key, as_of, exc_info=True)
            return None
        if not row or row.get(column) is None:
            return None
        try:
            return float(row[column])
        except (TypeError, ValueError):
            return None

    return {
        "gratuity_ceiling": await _one("gratuity.ceiling", "threshold_amount"),
        "gratuity_rate_per_completed_year":
            await _one("gratuity.rate.per_completed_year", "rate_percent"),
        "gratuity_qualifying_years":
            await _one("gratuity.qualifying_years", "threshold_amount"),
        "bonus_rate_minimum": await _one("bonus.rate.minimum", "rate_percent"),
        "bonus_rate_maximum": await _one("bonus.rate.maximum", "rate_percent"),
        "bonus_eligibility_ceiling":
            await _one("bonus.eligibility_ceiling", "threshold_amount"),
        "bonus_calculation_ceiling":
            await _one("bonus.calculation_ceiling", "threshold_amount"),
    }


async def _pt_slabs(pool, org_id: str, as_at: date) -> list:
    """This org's professional-tax ladder as it stood at `as_at`.

    Scoped to the org, because an unscoped read would charge one firm another
    firm's rates — but a row with NO `org_id` is a SHARED ladder and is read
    by everybody, since that column is nullable and national reference data
    is the obvious thing to seed once. Where both exist for one state, the
    org's own row wins (`is_own`, ranked first in `_pt_from_slabs`).

    Rows with a future `effective_from` are excluded so re-running an old
    month uses the rates that applied to it; a NULL `effective_from` is
    admitted because the column is nullable and a slab nobody dated is still
    the slab they entered.

    Returns a LIST, and an empty one is a real answer meaning "this org has
    seeded no slabs". It is never None — see `_compute_statutory` for why that
    distinction carries the whole behaviour.
    """
    return list(await pool.fetch(
        "SELECT state_code, state_name, slab_from, slab_to, monthly_tax, "
        "       effective_from, month, (org_id IS NOT NULL) AS is_own "
        "  FROM staging.pay_professional_tax "
        # A NULL `org_id` IS A SHARED LADDER, NOT A ROW TO IGNORE. The
        # column is nullable, and a professional-tax ladder is national
        # reference data — so seeding one row-set for every org, with no
        # org_id, is the obvious reading and the one a careful person
        # takes. Scoped strictly to `org_id = $1` it matched nothing,
        # `_pt_from_slabs` returned 0.0, and every payslip in the product
        # deducted NO professional tax — with no error, no log line and
        # nothing to distinguish it from a state that levies none. That
        # trap is live right now: the ~20-state seed is still owed, and
        # the flat-200 fallback that used to mask it has been removed.
        # An org that seeds its own rows still wins — see `is_own`, which
        # outranks a shared row for the same state in `_pt_from_slabs`.
        " WHERE (org_id = $1::uuid OR org_id IS NULL) "
        "   AND (effective_from IS NULL OR effective_from <= $2::date) "
        # A NULL `month` IS EVERY MONTH — the same reading a NULL
        # `org_id` gets three lines above, and for the same reason:
        # the column is nullable and the unset state must be the
        # useful one. Professional tax is not flat everywhere;
        # Maharashtra charges a different figure in February. A
        # month-specific row is admitted only for the month being
        # run, so anything this query returns with a month set IS
        # this month, and `_pt_from_slabs` can rank on that alone.
        # An org that has set no month rows sees exactly the ladder
        # it saw before: nine rows, all NULL, all admitted.
        "   AND (month IS NULL OR month = EXTRACT(MONTH FROM $2::date)) "
        " ORDER BY state_code, slab_from",
        org_id, as_at))


def _state_keys(*values) -> set:
    """Every spelling of a state these values could match on.

    THE CODELIST IS NOT RE-TYPED HERE. `_norm_state` collapses '27', 27, 'MH',
    'mh' and 'Maharashtra' onto one canonical numeric code, and it is imported
    for exactly the reason `routers/manav.py:51` gives for importing it: a
    second copy is a second thing to drift.

    Both sides of the match go through it because this database holds TWO
    incompatible state conventions and migration 180's header records the
    decision to accept both rather than pick. `pay_professional_tax.state_code`
    is numeric ('27'), and `manav_employees_state_ck` (migration 220) still
    admits the alphabetic form so an importer cannot be refused — so an
    employee stored as 'MH' and a slab stored as '27' must still meet.
    Comparing the raw strings would silently never match, and a professional-tax
    lookup that never matches charges everybody nothing.

    The raw lower-cased text is kept alongside the canonical code, so a state
    the GST codelist has never heard of still matches a slab row spelled the
    same way rather than matching nothing at all.
    """
    keys = set()
    for value in values:
        text = str(value if value is not None else "").strip().lower()
        if not text:
            continue
        keys.add(text)
        canonical = _norm_state(value)
        if canonical:
            keys.add(canonical)
    return keys


def _pt_from_slabs(slabs, state, gross: float) -> tuple:
    """(monthly professional tax, the slab it came from) — or (0.0, None).

    ZERO IS THE ANSWER TO EVERY QUESTION THIS CANNOT ANSWER: no state on the
    employee, no slab for that state, a gross that falls in no band, a figure
    that will not read as a number. None of them raises, because a payroll run
    must not stop for a missing rate.

    Where more than one band matches — two generations of the ladder both dated
    in the past — the most recently effective wins, then the most specific
    (highest `slab_from`).
    """
    keys = _state_keys(state)
    if not keys or not slabs:
        return 0.0, None

    best = None
    for row in slabs:
        try:
            if not keys & _state_keys(row["state_code"], row["state_name"]):
                continue
            low = float(row["slab_from"] if row["slab_from"] is not None else 0)
            high = row["slab_to"]
            if gross < low:
                continue
            if high is not None and gross > float(high):
                continue
            # An org's OWN slab outranks a shared one for the same state and
            # band, whatever their dates: a firm that has entered its own
            # ladder has said something more specific than the national
            # default, and a later-dated shared row must not overrule it.
            # MOST SPECIFIC WINS, AND EVERY STEP FALLS BACK RATHER THAN
            # REFUSING:
            #
            #   org + this month -> org + every month
            #                    -> shared + this month
            #                    -> shared + every month -> 0
            #
            # `_pt_slabs` has already dropped any month that is not the
            # one being run, so a row with a month set is a row FOR this
            # month and outranks the every-month row for the same state
            # and band. Nothing an organisation fails to configure can
            # block a run — the last step is the owner's existing 0.
            # READ INSIDE THE BLOCK, which is what the comment below has always
            # claimed and what this line makes true. `monthly_tax` used to be
            # read after the loop, so a row whose rate will not parse could WIN
            # the ranking and then return 0.00 — shadowing a perfectly good row
            # for the same state and band that would otherwise have matched.
            # Never-blocking is satisfied either way; the difference is whether
            # the fallback is the right ladder or nothing at all.
            tax = round(float(row["monthly_tax"]), 2)
            rank = (1 if row.get("is_own") else 0,
                    1 if row.get("month") is not None else 0,
                    row["effective_from"] or date.min, low)
            if best is None or rank > best[0]:
                best = (rank, row, tax)
        except (KeyError, TypeError, ValueError):
            # An unreadable slab row — or one missing a column entirely — is
            # skipped, not fatal. See above. Reading every field the caller
            # will later need INSIDE this block is deliberate: it means the row
            # this function returns is known to carry all of them.
            continue

    if best is None:
        return 0.0, None
    # No second `try` here: the rate was parsed in the loop, on the same row,
    # under the same guard. A row that reaches this line is known to carry every
    # field the caller needs.
    return best[2], best[1]


def _compute_statutory(basic_payable: float, gross: float, structure: dict,
                       commission: float = 0.0, bonus: float = 0.0,
                       pt_slabs=None, employee_state=None,
                       esi_ceiling: float | None = None,
                       epf_terms: tuple | None = None):
    """PF, ESI, PT and TDS — WHETHER each is computed, and on WHAT BASE.

    NO PF, ESI OR TDS RATE, CEILING OR THRESHOLD IN THIS FUNCTION HAS CHANGED.
    PF at 12% capped at ₹1,800, ESI at 0.75% and 3.25% under the ₹21,000
    ceiling, the ₹50,000 standard deduction and both income-tax slab tables are
    law and are exactly as they were. What is new is (a) TDS can be switched
    off, which it could not be before, and (b) commission and bonus can be
    included in the PF and ESI bases, per four independent flags, because a
    firm treats the two components differently and the product must not decide.

    ── PROFESSIONAL TAX, AND THE ONE THING `pt_slabs` MEANS ─────────────────

    `pt_slabs=None` and `pt_slabs=[]` ARE DIFFERENT ANSWERS and the difference
    is the whole behaviour:

      None  the slab table was NOT CONSULTED, because nothing on the employee
            says which state they work in — `manav_employees` has no state
            column until Phase 1.5 adds one. The flat ₹200-over-₹15,000 rule
            that this file has always applied is kept, so deploying this change
            before 1.5 alters not one payslip.
      []    the slab table WAS consulted and this org has seeded no slabs, or
            none that match. Professional tax is ZERO. `pay_professional_tax`
            is per-org seed data, so "no slabs" is a real and common state and
            the owner still owes roughly twenty states of it (Phase 0.24).

    A caller that consults the table therefore gets a rate that differs by
    state — Gujarat, Maharashtra and Karnataka all charge differently at the
    same gross on the live ladder — and gets ZERO wherever the ladder is silent.

    PT AND TDS STILL COMPUTE ON THE FIXED SALARY. Widening those two bases was
    not asked for and is not done unasked; it is stated as owed in migration
    190's header rather than slipped in here.

    Returns the six figures the payslip has always carried, plus `treatment` —
    the record of which switches were applied and on what bases — which the
    caller freezes onto the payslip. A payslip is filed, disputed and audited
    years later, and "was commission in the PF base that month?" must be
    answerable from the payslip rather than from whatever the checkbox says
    today.
    """
    unanswered = []

    def flag(name):
        value, was_unset = _flag(structure, name)
        if was_unset:
            unanswered.append(name)
        return value

    pf_on = flag("pf_enabled")
    esi_on = flag("esi_enabled")
    pt_on = flag("pt_applicable")
    tds_on = flag("tds_applicable")
    comm_pf = flag("commission_in_pf_base")
    comm_esi = flag("commission_in_esi_base")
    bonus_pf = flag("bonus_in_pf_base")
    bonus_esi = flag("bonus_in_esi_base")

    commission = float(commission or 0.0)
    bonus = float(bonus or 0.0)

    # THE BASES. PF has always been computed on the payable BASIC and ESI on
    # the gross; those subjects are unchanged and only what they INCLUDE moves.
    pf_base = basic_payable + (commission if comm_pf else 0.0) \
        + (bonus if bonus_pf else 0.0)
    # The ₹21,000 figure is a ceiling on the ESI base, so it is tested against
    # the base — the same number the charge is computed on. That is applying
    # the base consistently, not moving the ceiling.
    esi_base = gross + (commission if comm_esi else 0.0) \
        + (bonus if bonus_esi else 0.0)

    # PHASE 5.1 — the rate and the ceiling come from `statute_calendar` at the
    # run's period end (`_epf_terms`), and each falls back to its own statutory
    # literal when the store cannot answer. 12% of 15,000 is 1,800: the cap the
    # literal carried, so no payslip moves. See `_epf_terms` on why the fallback
    # is the literal and not zero.
    _pf_emp_rate, _pf_emr_rate, _pf_ceiling = (epf_terms or (None, None, None))
    _pf_emp_rate = 12.0 if _pf_emp_rate is None else _pf_emp_rate
    _pf_emr_rate = 12.0 if _pf_emr_rate is None else _pf_emr_rate
    _pf_ceiling = 15000.0 if _pf_ceiling is None else _pf_ceiling
    _pf_wage = min(pf_base, _pf_ceiling)
    pf_emp = round(_pf_wage * _pf_emp_rate / 100, 2) if pf_on else 0
    pf_emr = round(_pf_wage * _pf_emr_rate / 100, 2) if pf_on else 0

    # THE CEILING IS DATED NOW; THE RATES ARE NOT. 0.75% and 3.25% stay literal
    # because `statute_calendar` holds no key for them — `epf.remittance` and the
    # ESI rows carry due dates, and only `esi.wage_ceiling` carries a figure. A
    # constant with nowhere to read it from is not improved by pretending
    # otherwise. `_esi_ceiling` returns None when the store cannot answer, and
    # the statutory 21,000 stands: a missing row must never widen a deduction.
    _ceiling = 21000.0 if esi_ceiling is None else esi_ceiling
    esi_emp = esi_base * 0.0075 if esi_on and esi_base <= _ceiling else 0
    esi_emr = esi_base * 0.0325 if esi_on and esi_base <= _ceiling else 0

    # PROFESSIONAL TAX — from the state's slab where one can be read, and from
    # the pre-slab flat rule only where the slab table was never consulted.
    # See the `pt_slabs` paragraph above: None is "not asked", [] is "asked and
    # there is nothing", and only the first keeps the flat rate.
    pt_slab = None
    if pt_slabs is None:
        pt = 200 if pt_on and gross > 15000 else 0
    elif pt_on:
        pt, pt_slab = _pt_from_slabs(pt_slabs, employee_state, gross)
    else:
        pt = 0

    # Simplified TDS: estimate annual taxable, divide by 12
    annual_taxable = max(gross * 12 - 50000, 0)  # standard deduction
    if not tds_on:
        # THE SWITCH THAT DID NOT EXIST. Before migration 190 the slab table
        # ran for everybody, so a firm that does not operate TDS on salary had
        # tax deducted from every payslip and no way to say otherwise.
        tax = 0
    elif structure.get("tds_regime") == "new":
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
        # WHAT THIS PAYSLIP WAS COMPUTED UNDER, frozen. Stored on the payslip
        # so that somebody ticking a box in March cannot silently restate
        # January — the switches as they stood, the two bases the deductions
        # were actually taken on, and which flags nobody had answered.
        "treatment": {
            "pf_enabled": pf_on,
            "esi_enabled": esi_on,
            "pt_applicable": pt_on,
            "tds_applicable": tds_on,
            "tds_regime": str(structure.get("tds_regime") or "new"),
            "commission_in_pf_base": comm_pf,
            "commission_in_esi_base": comm_esi,
            "bonus_in_pf_base": bonus_pf,
            "bonus_in_esi_base": bonus_esi,
            "pf_base": round(pf_base, 2),
            "esi_base": round(esi_base, 2),
            "commission": round(commission, 2),
            "bonus": round(bonus, 2),
            # WHICH RULE PRODUCED THE PROFESSIONAL TAX, and off what state.
            # "flat" is the pre-slab ₹200 rule and means nothing on the
            # employee said which state they work in; "slab" means the state's
            # own ladder was read, and `pt_state` plus the band say which row.
            # A PT figure is disputed by an employee and audited by a state
            # authority, and "why ₹150?" must be answerable from the payslip.
            "pt_basis": "flat" if pt_slabs is None else "slab",
            "pt_state": (str(employee_state) if employee_state else None),
            "pt_slab": ({
                "state_code": str(pt_slab["state_code"]),
                "state_name": str(pt_slab["state_name"]),
                "slab_from": float(pt_slab["slab_from"] or 0),
                "slab_to": (None if pt_slab["slab_to"] is None
                            else float(pt_slab["slab_to"])),
                "effective_from": (None if pt_slab["effective_from"] is None
                                   else str(pt_slab["effective_from"])),
            } if pt_slab is not None else None),
            # Flags nobody has answered, read at the default stated in
            # _FLAG_WHEN_UNSET. Recorded rather than hidden: "nobody had said"
            # and "the firm said yes" are different facts about a deduction.
            "unanswered": unanswered,
        },
    }


# ── Commission and bonus, the two VARIABLE earnings ──────────────────────────
#
# Both land in `vetana_payslips.other_earnings` — a jsonb array of
# {label, amount} that already exists and is already summed by
# services/skills/data/payroll_statutory.py. NO PAYSLIP COLUMN IS ADDED for
# either of them.
#
# WHAT THEY DO TO THE PAYSLIP, stated once, here:
#
#   gross  += the total of these lines
#   net    += the same amount
#   every deduction is UNCHANGED
#
# `_compute_statutory` is called on the FIXED salary exactly as it was before
# any of this existed, and the loan recovery floor is still computed on the
# fixed gross. That is deliberate and it is NOT a claim that commission and
# bonus are outside PF, ESI, PT or TDS — it is a refusal to decide. Whether a
# commission attracts provident fund, and whether a bonus pushes somebody over
# the ₹21,000 ESI ceiling, are questions with statutory answers and firm-level
# consequences that the owner has not been asked. Until he is, this code
# CANNOT REDUCE ANYBODY'S TAKE-HOME: the only thing it can do is add money.
#
# WHY A LINE IS SOMETIMES ABSENT, AND WHY THAT IS NOT A ZERO. A commission
# that cannot be computed writes NO line. It does not write ₹0.00, because a
# zero beside the word "Commission" on a payslip is a statement that the person
# earned none — and today the truth for every person in this database is that
# no invoice has ever recorded who sold it (`manav_employees.user_id` is filled
# on 0 of 98 rows, `salesperson_id` on 0 of 788 invoices). A missing line makes
# no claim. A zero makes a false one.

#: One SETTLEMENT PERIOD'S turnover and cost, for whatever the scheme measures.
#:
#: ONE template with one substitution, so the four guards
#: (`ganit.sales_register`'s, in the same order) are written once and a
#: commission can never disagree with the register it is checked against.
#: Credit notes negated; drafts, cancellations, proformas and quotations
#: excluded.
#:
#: The join through `manav_employees` is what turns an attributed document into
#: a DEPARTMENT's document: a document reaches a department through the
#: employee row of its salesperson, so a department's figure is exactly the sum
#: of its members' attributed figures and cannot double count. Both halves are
#: org-scoped — joining an employee on user_id alone can surface another org's
#: row, which is the shape of the graha_clients leak.
_FIGURES_SQL = (
    "WITH doc AS ("
    "  SELECT i.line_items, "
    "         CASE WHEN i.invoice_type = 'credit_note' "
    "              THEN -(COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "              ELSE  (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "         END AS taxable "
    "    FROM staging.ganit_invoices i "
    "    JOIN ("
    "       SELECT me.user_id AS user_id, "
    "              NULLIF(btrim(COALESCE(me.department, '')), '') AS department "
    "         FROM staging.manav_employees me "
    "        WHERE me.org_id = $1::uuid "
    "          AND me.user_id IS NOT NULL AND btrim(me.user_id) <> ''"
    "    ) de ON de.user_id = i.salesperson_id "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.salesperson_id IS NOT NULL "
    "     AND {match} = $2 "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($5::text[])) "
    "     AND i.invoice_date BETWEEN $3::date AND $4::date"
    ") "
    "SELECT (SELECT COUNT(*) FROM doc)::int AS docs, "
    "       (SELECT COALESCE(SUM(taxable), 0) FROM doc) AS turnover, "
    "       (SELECT COUNT(*) FROM doc, jsonb_array_elements(doc.line_items) li "
    "         WHERE li ? 'cost_price' "
    "           AND jsonb_typeof(li->'cost_price') = 'number')::int "
    "           AS lines_costed, "
    "       (SELECT SUM((li->>'cost_price')::numeric * {qty}) "
    "          FROM doc, jsonb_array_elements(doc.line_items) li "
    "         WHERE li ? 'cost_price' "
    "           AND jsonb_typeof(li->'cost_price') = 'number') AS cost"
)

#: The ONLY two things `{match}` may ever be. A server-side allowlist keyed on
#: the scheme's own `revenue_scope`, never a value that reached us from a
#: request — the identifier half of a query is not a place for user input.
_SCOPE_MATCH = {
    "own": "de.user_id",
    "department": "de.department",
}

#: How many of the org's documents in the period record WHO SOLD THEM. The
#: distinction this whole feature turns on is drawn per org per period, exactly
#: as `core.consultant_pnl` draws it: if nothing in the period is attributed,
#: nobody's turnover is computable and no commission line may be written. If
#: SOME documents are attributed, a person with none of them genuinely sold
#: nothing, and a commission of ₹0 is a true answer — which still writes no
#: line, because there is no money to pay.
_ATTRIBUTED_SQL = (
    "SELECT COUNT(*) FILTER (WHERE i.salesperson_id IS NOT NULL)::int "
    "  FROM staging.ganit_invoices i "
    " WHERE i.org_id = $1::uuid "
    "   AND i.is_active = TRUE "
    "   AND i.doc_status <> 'draft' "
    "   AND i.cancelled_at IS NULL "
    "   AND i.payment_status <> 'cancelled' "
    "   AND NOT (i.invoice_type = ANY($4::text[])) "
    "   AND i.invoice_date BETWEEN $2::date AND $3::date"
)


async def _variable_earnings(pool, org_id: str, employee_id: str,
                             user_id, department, month: str,
                             month_end: date, attributed_cache: dict) -> dict:
    """The `other_earnings` lines for one person on one payroll run.

    Returns {"lines": [...], "commission": float, "bonus": float}. Bonuses come
    first (a decision somebody made), then commission (a figure somebody
    computed). An empty list is the normal answer today and means nothing is
    owed beyond salary.

    WHICH SCHEMES PAY THIS MONTH. Payroll runs monthly; a scheme settles
    monthly, quarterly or annually. A scheme is paid in the payroll month whose
    last day IS the last day of its own settlement period —
    `commission.settles_on` — so a monthly scheme pays every month on that
    month's figures, a quarterly one in June/September/December/March, and an
    annual one in March on the whole financial year. In March a person on a
    monthly-own and an annual-department scheme is paid by both, over two
    different windows and two different sets of revenue, which is the owner's
    own example and is NOT double counting: each scheme is computed over its
    own period and each period ends exactly once.
    """
    # Imported here rather than at module scope: services.report_defs registers
    # every report definition on import, and payroll has no business dragging
    # the whole report registry in to read two constants. They are IMPORTED and
    # not copied because a second spelling of "what counts as turnover" is how
    # a commission comes to disagree with the sales register.
    from services.report_defs.commission_reports import OFFER_TYPES, QTY_SQL

    out = {"lines": [], "commission": 0.0, "bonus": 0.0}

    # ── 1 · bonus: a decision, not a computation ─────────────────────────────
    #
    # Selected BY MONTH and never by payslip id: process_payroll deletes and
    # re-inserts a month's payslips on a re-run, so an award stamped with a
    # payslip id would silently vanish from the pay the second time. Keyed on
    # the month, a re-run produces exactly the same payslip.
    #
    # `bonus_eligible` on the employee is NOT re-checked here. It gates who may
    # be AWARDED one (routers/manav.py); once an award exists, a decision has
    # been made and payroll pays it. Withdrawing a bonus is an act somebody
    # performs on the award, with their name on it — not a side effect of a
    # checkbox changing later.
    try:
        awards = await pool.fetch(
            "SELECT amount, reason, pay_period "
            "  FROM staging.manav_bonus_awards "
            " WHERE org_id = $1::uuid AND employee_id = $2::uuid "
            "   AND pay_period = $3 "
            " ORDER BY awarded_at, id",
            org_id, employee_id, month,
        )
    except Exception:
        # Migration 190 has not been applied yet. Payroll must still run — the
        # owner's rule is "we dont block" — and a firm with no bonus table has
        # awarded no bonuses, so the honest answer is no lines.
        logging.warning(
            "vetana: staging.manav_bonus_awards is unreadable (migration 190 "
            "not applied?) — no bonus lines written for %s", month)
        awards = []

    for a in awards:
        award = C.award_from_row(a)
        line = C.earning_line(C.bonus_line_label(award), award.amount)
        if line:
            out["lines"].append(line)
            out["bonus"] += line["amount"]

    # ── 2 · commission ───────────────────────────────────────────────────────
    try:
        schemes = await pool.fetch(
            "SELECT eligible, basis, period, revenue_scope, "
            "       effective_from, effective_to, id "
            "  FROM staging.manav_commission_schemes "
            " WHERE org_id = $1::uuid AND employee_id = $2::uuid "
            "   AND eligible IS TRUE "
            "   AND effective_from <= $3::date "
            "   AND (effective_to IS NULL OR effective_to > $3::date)",
            org_id, employee_id, month_end,
        )
    except Exception:
        logging.warning(
            "vetana: commission schemes unreadable (migration 190 not "
            "applied?) — no commission lines written for %s", month)
        return out

    for s in schemes:
        if not C.settles_on(str(s["period"]), month_end):
            continue
        bands = await pool.fetch(
            "SELECT from_amount, rate_percent "
            "  FROM staging.manav_commission_bands "
            " WHERE org_id = $1::uuid AND scheme_id = $2::uuid "
            " ORDER BY from_amount",
            org_id, s["id"],
        )
        try:
            scheme = C.from_row(s, bands=bands)
        except ValueError:
            # A stored arrangement this code cannot read is a reason to pay
            # NOTHING and let somebody look, never a reason to guess. The
            # database refuses these shapes (migration 190's trigger), so
            # reaching here means the row predates it or was written around it.
            logging.exception(
                "vetana: unreadable commission scheme for employee %s in "
                "org %s — no commission line written", employee_id, org_id)
            continue

        # WHOSE REVENUE. Resolved from the scheme and from an allowlist, and
        # the two failure modes are kept apart:
        #
        #   'own' with no login linked       the person's revenue is not
        #                                    reachable at all (manav_employees
        #                                    .user_id is filled on 0 of 98).
        #   'department' with no department  the TEAM cannot be identified —
        #                                    11 of 98 employees. Paying a team
        #                                    leader nothing because nobody
        #                                    filled in a column is the failure
        #                                    this product keeps almost making.
        #
        # NEITHER writes a ₹0 line. A missing line makes no claim; a zero makes
        # a false one.
        subject = department if scheme.measures_department else user_id
        if not str(subject or "").strip():
            logging.info(
                "vetana: %s-scoped commission not computable for employee %s "
                "(%s) — no line written", scheme.revenue_scope, employee_id,
                C.DEPARTMENT_NOT_SET if scheme.measures_department
                else C.NOT_ATTRIBUTABLE)
            continue

        p_start, p_end = C.period_bounds(scheme.period, month_end)

        key = (p_start, p_end)
        if key not in attributed_cache:
            attributed_cache[key] = await pool.fetchval(
                _ATTRIBUTED_SQL, org_id, p_start, p_end, list(OFFER_TYPES))
        if not attributed_cache[key]:
            # Not one document in the settlement period says who sold it, so no
            # figure can be assigned to anybody or to any department. No line.
            continue

        sql = _FIGURES_SQL.format(match=_SCOPE_MATCH[scheme.revenue_scope],
                                  qty=QTY_SQL)
        m = await pool.fetchrow(sql, org_id, str(subject), p_start, p_end,
                                list(OFFER_TYPES))
        lines_costed = int(m["lines_costed"] or 0)
        f = C.figures(
            m["turnover"],
            m["cost"] if lines_costed else None,
            cost_reason=C.NOT_RECORDED,
        )
        due = C.commission_due(scheme, f)
        line = C.earning_line(
            C.commission_line_label(scheme, p_start, p_end), due.amount)
        if line:
            out["lines"].append(line)
            out["commission"] += line["amount"]

    return out


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
    # Nothing sets this yet, and **no full-and-final settlement path exists
    # anywhere in the codebase** (searched: settlement, fnf, final_settlement —
    # no hits; `manav.py:626` only flips `is_active` and `status`). The flag is
    # threaded through here so that feature has the recovery rule it needs
    # already written and tested, rather than reimplementing it and diverging.
    #
    # THIS NOTE USED TO SAY that `e.is_active=TRUE` excluded an offboarded
    # employee from the monthly run "entirely". IT DID NOT, and believing it is
    # how payroll came to pay leavers: `is_active` is a flag somebody has to
    # remember to clear, and ten live employees with a past last working day
    # still carried it. The structures query below now excludes them on the
    # EXIT DATE, which is a fact somebody recorded rather than a flag somebody
    # forgot. Someone who leaves mid-month is still paid, pro-rated.
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

    # WHICH COLUMN NAMES THE EMPLOYEE'S STATE — asked, not assumed, ONCE per
    # run, and the answer decides whether professional tax is read from the
    # slab table at all. See `_employee_state_column` and `_PT_STATE_COLUMNS`.
    state_col = await _employee_state_column(pool)
    if not state_col:
        logging.warning(
            "vetana: manav_employees carries no state column (migration 220 "
            "not applied?) — professional tax for %s falls back to the flat "
            "200-over-15000 rule for every employee instead of the state's "
            "slab. staging.pay_professional_tax is not read.", month)

    # `e.user_id` comes along because commission attributes to a LOGIN
    # (ganit_invoices.salesperson_id) while the scheme is recorded against an
    # EMPLOYEE, and `_variable_earnings` needs both ends of that bridge. It is
    # read here rather than in a second per-employee query for the same reason
    # the structures are: one round trip per run, not one per person.
    #
    # ── PAYROLL DOES NOT PAY PEOPLE WHO HAVE ALREADY LEFT ────────────────────
    #
    # `e.is_active=TRUE` was the only guard, and it is not one. Measured
    # read-only on the live database 2026-08-25: TEN employees hold a
    # non-cancelled `manav_offboarding` row whose `last_working_day` is in the
    # past AND are still `is_active` — and all ten carry an active salary
    # structure, so every monthly run wrote them a payslip. `is_active` is a
    # flag somebody has to remember to clear; the exit date is a fact somebody
    # already recorded.
    #
    # THE SHAPE IS THE HR PATH'S, NOT A NEW ONE.
    # `analytics/metrics/manav.py:_headcount_asat` (:65-84) reconstructs who was
    # on the rolls at a date as
    #
    #     e.is_active = TRUE OR EXISTS (
    #         SELECT 1 FROM staging.manav_offboarding x
    #          WHERE x.org_id = e.org_id AND x.employee_id = e.id
    #            AND x.status <> 'cancelled'
    #            AND x.last_working_day > <date>)
    #
    # i.e. still here, or holding a live exit dated after the date in question.
    # Payroll needs the same fact at the START of the month it is paying, so
    # this is that predicate negated: keep `is_active`, and drop anyone whose
    # live exit is dated BEFORE the month began. Same table, same org+employee
    # scoping (there is no composite FK — that predicate is the only thing
    # stopping another org's exit row naming this org's employee), same
    # `status <> 'cancelled'` — which is the vocabulary migration 083's CHECK
    # defines and the same predicate its `one_live_per_employee` unique index
    # uses, so a mistaken exit that was cancelled and redone still gets paid.
    #
    # NULL `last_working_day` KEEPS SOMEBODY IN THE RUN. The column is nullable
    # (083), `NULL < date` is NULL, and NOT EXISTS therefore admits them. An
    # exit that has been started but not dated is not evidence that a person
    # has gone, and payroll must not stop paying somebody on a guess.
    #
    # Somebody who leaves DURING the month is still paid, and pro-rated by the
    # attendance arithmetic below exactly as they were before. Only a last
    # working day strictly before `month_start` removes a person from the run.
    structures = await pool.fetch(
        "SELECT s.*, e.user_id AS employee_user_id, "
        "       e.date_of_joining AS employee_doj, "
        "       (SELECT max(x.last_working_day) FROM staging.manav_offboarding x "
        "         WHERE x.org_id = e.org_id AND x.employee_id = e.id "
        "           AND x.status <> 'cancelled') AS employee_last_day, "
        "       NULLIF(btrim(COALESCE(e.department, '')), '') AS employee_department"
        + (f", NULLIF(btrim(COALESCE(e.{state_col}::text, '')), '') AS employee_state "
           if state_col else " ")
        + "FROM staging.vetana_salary_structures s "
        "JOIN staging.manav_employees e ON e.id = s.employee_id AND e.is_active=TRUE "
        "WHERE s.org_id=$1::uuid AND s.is_active=TRUE "
        "AND s.effective_from <= $2 "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM staging.manav_offboarding x "
        "  WHERE x.org_id = e.org_id AND x.employee_id = e.id "
        "  AND x.status <> 'cancelled' "
        "  AND x.last_working_day < $3::date) "
        "ORDER BY s.employee_id, s.effective_from DESC",
        org_id, month_end, month_start,
    )

    # THE SLAB TABLE, READ ONCE PER RUN. `None` is not `[]` here and the
    # difference decides the arithmetic — see `_compute_statutory`.
    pt_slabs = await _pt_slabs(pool, org_id, month_end) if state_col else None

    # THE DATED LAW, READ ONCE PER RUN. `month_end` is the date the obligation
    # arises — the last day of the period being paid — not the date somebody
    # happens to press the button, which is what `services/statute.py` means by
    # `as_of` and why it refuses to default it. Re-running an old month
    # therefore uses the ceiling that applied to THAT month, which is the whole
    # acceptance criterion for Phase 5.1.
    esi_ceiling = await _esi_ceiling(pool, month_end)
    # Same date, same reason — see `_epf_terms`. Read ONCE per run, not
    # once per employee: the law does not change between two payslips of
    # the same month, and a query per employee would be 83 of them.
    epf_terms = await _epf_terms(pool, month_end)

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
    # One org-wide "does anything in this period record who sold it" answer per
    # settlement period, shared across every employee in the run. Asked once
    # per period rather than once per person: the answer cannot differ between
    # two people and asking twice invites the two questions to be asked over
    # different filters.
    attributed_cache: dict = {}

    # Can a payslip record which statutory treatment it was computed under?
    #
    # Asked rather than assumed, ONCE per run. Code deploys before migrations
    # are applied here, and a payroll run that 500s on an unknown column would
    # be exactly the blocking the owner ruled out ("so we dont block"). Where
    # the column is absent the run proceeds and the treatment is not recorded;
    # where it is present every payslip carries it.
    payslip_records_treatment = bool(await pool.fetchval(
        "SELECT 1 FROM information_schema.columns "
        " WHERE table_schema = 'staging' AND table_name = 'vetana_payslips' "
        "   AND column_name = 'statutory_treatment'"))
    if not payslip_records_treatment:
        logging.warning(
            "vetana: vetana_payslips.statutory_treatment is absent (migration "
            "190 not applied?) — payroll for %s will run, but the payslips "
            "will not record which statutory treatment they were computed "
            "under.", month)
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

        # ── THE PART OF THE MONTH THIS PERSON WAS ACTUALLY EMPLOYED FOR ──────
        #
        # `has_attendance` is False whenever nobody has marked anyone present or
        # absent, and then `present_days` fell back to the WHOLE month. That
        # fallback is deliberate and stays: "nobody has said" must never
        # silently dock somebody's pay, and it is the same rule
        # `attendance_auto_mark.py` follows in the other direction.
        #
        # But it was the whole month for EVERYBODY, including someone who left
        # on the 3rd. The comment at :1240 promises a mid-month leaver "is still
        # paid, and pro-rated by the attendance arithmetic below" — and live, in
        # both organisations, ZERO August rows carry a status in
        # (present, late, half_day, absent), so that arithmetic returns a full
        # month for every single person and the promise was never kept.
        #
        # The fix is not to distrust the fallback. It is that the employment
        # window is a FACT THE SYSTEM ALREADY HOLDS — a joining date and a
        # recorded last working day — and it does not depend on anyone
        # remembering to mark a register. So the fallback stays, bounded by the
        # days the person was actually on the rolls.
        #
        # Note what this does NOT change: somebody employed all month still has
        # `employed_days == working_days`, so their ratio stays exactly 1 and
        # not a paisa of their pay moves. Measured before the change, month
        # 2026-08: of 51 payable in E2E, 0 joined mid-month and 1 left
        # mid-month; Unicode 24, none partial. One payslip moves, and it is the
        # one that was wrong.
        employed_days = _employed_working_days(
            month_start, month_end, s["employee_doj"], s["employee_last_day"],
        )

        present_days = (att["present"] + att["half_day"] * 0.5) if has_attendance else employed_days
        # A cap as well as a fallback: a marked register can also overstate the
        # window — `attendance_auto_mark` has been writing weekend rows for
        # leavers three weeks past their exit — and no arithmetic should pay
        # somebody for days they were not employed.
        if present_days > employed_days:
            present_days = employed_days
        ot_hours = float(att["ot"]) if att else 0

        # DAYS, not requests — and only the days that fall inside THIS month.
        #
        # Both of these were `SELECT COUNT(*)`, which counted leave REQUESTS. One
        # approved five-day leave counted as 1, and `payable_days` below is
        # `present_days + paid_leaves`, so the error landed straight on pay.
        # Measured on the live database: 151 approved requests against 292 actual
        # days, so leave was understated by roughly half.
        #
        # `days` is the authority rather than the calendar span, because it is
        # what the approver agreed and it carries half-days (it is numeric, and
        # differs from the span on 7 of 151 rows). But `days` is the total for the
        # WHOLE request, and the predicate below matches any leave OVERLAPPING the
        # month — 6 of 151 approved requests cross a month boundary — so charging
        # the full `days` to both months would double-count them.
        #
        # So: pro-rate `days` by the share of the request's span that lies inside
        # the month. Exact whenever `days` equals the span, and proportional when
        # it does not, which is the only defensible split without a per-day table.
        # NULLIF guards a zero span defensively; end_date >= start_date should
        # make it impossible, and a division-by-zero here would take payroll down.
        leave_days_sql = (
            "SELECT COALESCE(SUM("
            "  lr.days * ("
            "    ((LEAST(lr.end_date, $4::date) - GREATEST(lr.start_date, $3::date)) + 1)::numeric"
            "    / NULLIF((lr.end_date - lr.start_date) + 1, 0)"
            "  )"
            "), 0) FROM staging.manav_leave_requests lr "
            "WHERE lr.org_id=$1::uuid AND lr.employee_id=$2::uuid "
            "AND lr.status='approved' "
            "AND lr.start_date <= $4 AND lr.end_date >= $3 "
            "AND lr.leave_type_id IN ("
            "  SELECT id FROM staging.manav_leave_types "
            "  WHERE org_id=$1::uuid AND is_paid={is_paid}"
            ")"
        )

        paid_leaves = float(await pool.fetchval(
            leave_days_sql.format(is_paid="TRUE"),
            org_id, emp_id, month_start, month_end,
        ) or 0)

        unpaid_leaves = float(await pool.fetchval(
            leave_days_sql.format(is_paid="FALSE"),
            org_id, emp_id, month_start, month_end,
        ) or 0)

        payable_days = present_days + paid_leaves
        # Capped by the EMPLOYMENT window, not the calendar month. Leave cannot
        # extend past a last working day either.
        if payable_days > employed_days:
            payable_days = employed_days
        # The denominator stays the full month on purpose: somebody employed for
        # three of twenty-six working days earns three twenty-sixths of a
        # month's salary, not a full one.
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

        # THE FIXED SALARY. Named `gross_fixed` rather than `gross` because
        # commission and bonus are added to the gross further down and every
        # statutory input above that point must keep reading the fixed figure —
        # see the note above `_variable_earnings`.
        gross_fixed = round(basic_pay + hra_pay + da_pay + special_pay + conveyance_pay + medical_pay + ot_pay, 2)

        # ── The variable half: commission and bonus ─────────────────────────
        #
        # An empty list is the normal answer and means nothing is owed beyond
        # salary. It is NOT the same as a zero, and nothing below writes one.
        variable = await _variable_earnings(
            pool, org_id, emp_id, s["employee_user_id"],
            s["employee_department"], month, month_end, attributed_cache,
        )
        other_earnings = variable["lines"]
        commission_total = round(variable["commission"], 2)
        bonus_total = round(variable["bonus"], 2)
        variable_total = round(commission_total + bonus_total, 2)

        # STATUTORY, ON THE FIXED SALARY PLUS WHATEVER THE FIRM HAS SAID
        # BELONGS IN EACH BASE.
        #
        # Commission and bonus are passed in SEPARATELY rather than folded into
        # `gross_fixed`, because the four switches are independent: a firm may
        # put commission in the PF base and keep a bonus out of it, and one
        # combined number could not express that. With every switch unset — the
        # state of every structure in the database today — the figures below
        # are identical to what payroll produced before commission existed.
        #
        # `employee_state` is read off the row ONLY when the run consulted the
        # slab table, because that is exactly when the column was selected.
        # Tying the two to the same `pt_slabs is not None` test means the two
        # can never disagree and a KeyError can never reach a payroll run.
        stat = _compute_statutory(basic_pay, gross_fixed, dict(s),
                                  commission=commission_total,
                                  bonus=bonus_total,
                                  pt_slabs=pt_slabs,
                                  esi_ceiling=esi_ceiling,
                                  epf_terms=epf_terms,
                                  employee_state=(s["employee_state"]
                                                  if pt_slabs is not None
                                                  else None))
        # WHICH TREATMENT THIS PAYSLIP WAS COMPUTED UNDER, frozen onto the
        # payslip below. A payslip is filed, disputed and audited years later,
        # and somebody ticking a checkbox in March must not silently restate
        # January.
        treatment = stat.pop("treatment")

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
        #
        # The floor and the capacity are computed on the FIXED gross, not on
        # the gross including commission and bonus. Recovering more of a loan
        # because somebody earned a bonus is a real question — and it is the
        # firm's, not this file's. Keeping it on the fixed figure means adding
        # a bonus can never increase what is taken out of somebody's pay.
        floor = 0.0 if final_settlement else round(gross_fixed * _NET_PAY_FLOOR_PCT, 2)
        loan_capacity = max(0.0, gross_fixed + reimbursement_total - statutory - floor)

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

        # WHAT COMMISSION AND BONUS DO TO THE PAYSLIP, in two lines: gross goes
        # up by exactly their total, and so does net. No deduction moves.
        # `payroll_statutory.py` reads `other_earnings` on the understanding
        # that `gross` already includes it — the same contract arrears have
        # always had — so adding it here and nowhere else keeps the salary
        # certificate annexure correct without touching it.
        gross = round(gross_fixed + variable_total, 2)

        net = round(gross - total_ded + reimbursement_total, 2)
        # Belt and braces. `loan_capacity` already floors this at zero for the
        # loan path; this catches the remaining case where statutory alone
        # exceeds earnings, which must surface as a zero payslip to be
        # investigated rather than as a negative one to be emailed.
        if net < 0:
            net = 0.0

        ps_number = await next_doc_number(pool, org_id, "vetana_payslips", "payslip_number", "PS")

        payslip_values = [
            org_id, run_id, emp_id, ps_number, month,
            working_days, present_days, paid_leaves, unpaid_leaves, ot_hours,
            round(basic_pay, 2), round(hra_pay, 2), round(da_pay, 2),
            round(special_pay, 2), round(conveyance_pay, 2), round(medical_pay, 2),
            ot_pay, gross,
            stat["pf_employee"], stat["pf_employer"],
            stat["esi_employee"], stat["esi_employer"],
            stat["professional_tax"], stat["tds"], round(loan_total, 2),
            json.dumps(loan_deductions),
            round(reimbursement_total, 2), round(total_ded, 2), net,
            json.dumps(other_earnings),
        ]
        treat_col, treat_val = "", ""
        if payslip_records_treatment:
            treat_col, treat_val = ", statutory_treatment", ", $31::text::jsonb"
            payslip_values.append(json.dumps(treatment))

        payslip_row = await pool.fetchrow(
            "INSERT INTO staging.vetana_payslips "
            "(org_id, run_id, employee_id, payslip_number, month, "
            "working_days, present_days, leaves_paid, leaves_unpaid, overtime_hours, "
            "basic, hra, da, special_allowance, conveyance, medical, overtime_pay, gross, "
            "pf_employee, pf_employer, esi_employee, esi_employer, "
            "professional_tax, tds, loan_deduction, loan_deductions, reimbursements, total_deductions, net_pay, "
            # Commission and bonus. An ARRAY of {label, amount} — the column
            # already existed and already carries arrears in exactly this
            # shape, so nothing here is a new payslip column. An empty array
            # means no variable earning, which is not the same as a zero one
            # and prints nothing at all.
            "other_earnings" + treat_col + ") "
            "VALUES ($1::uuid, $2, $3::uuid, $4, $5, "
            "$6, $7, $8, $9, $10, "
            "$11, $12, $13, $14, $15, $16, $17, $18, "
            # `$26::text::jsonb` — `db.py` registers a jsonb codec whose encoder
            # IS `json.dumps`, so binding an already-dumped string to a `::jsonb`
            # parameter encodes it twice and the column holds a JSON *string*.
            # Measured live: `loan_deductions` came back as `"[{...}]"` rather
            # than an array, the same defect that crashed Graha's Documents tab.
            "$19, $20, $21, $22, $23, $24, $25, $26::text::jsonb, $27, $28, $29, "
            "$30::text::jsonb" + treat_val + ") RETURNING id",
            *payslip_values,
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
    # HEADCOUNT IS A STOCK, AND IT IS RENDERED BESIDE THE RUN THAT PAYS IT.
    # `is_active=TRUE` alone answered 83 for E2E on 2026-08-26 while
    # `process_payroll` above paid 73 of them — the page contradicting its own
    # payroll run, on one screen, because ten people hold a non-cancelled
    # `manav_offboarding` row dated in the past and still carry the flag.
    #
    # THE FLAG IS NOT STALE DATA. `routers/manav.py:1958` records that
    # offboarding used to clear it, which dropped the person out of payroll the
    # same day and left an outstanding salary advance unrecoverable — so a
    # leaver keeps it until settlement, deliberately (two of the ten carry
    # advances totalling 1,15,000). The read was asking the wrong question.
    #
    # The predicate is IMPORTED and not written out again: twenty-five
    # hand-written copies is the failure `services/on_the_rolls.py` exists to
    # prevent, and a copy that drifts disagrees with payroll silently. The
    # table is aliased `e` for it — inlining a variant against no alias is how
    # the copies started.
    #
    # THE TILE STILL WILL NOT EQUAL THE LATEST RUN, and that is right. This is
    # a stock as at today, so it bounds on today; the run is paying a MONTH, so
    # it bounds on the first of that month and still pays somebody who left on
    # the 3rd for the three days they worked. Making the two bounds agree
    # breaks whichever one you move.
    headcount = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.manav_employees e "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE"
        + still_on_the_rolls("e"),
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
