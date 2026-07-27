"""
pahchan_attendance.py — correcting a day, and pushing it to payroll.

Two gaps closed here, and they are halves of the same one.

`staging.pahchan_regularisations` has existed since migration 064 and NO code
has ever touched it. The correction mechanism was a table and nothing else.

And nothing bridged Pahchan to payroll at all: Pahchan writes
`staging.pahchan_punches`, Vetana reads `staging.manav_attendance`, and no code
joined them. People clocked in every day and the payroll run could not see a
minute of it.

Correction without a push is a form nobody reads; a push without correction
sends raw punches to payroll. Both, or neither.

The pairing rules live in `services/attendance_bridge.py`, with the reasoning
for each. The two worth knowing before reading anything here: a punch awaiting
review never becomes pay, and a row HR typed by hand is never overwritten.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.subscription import require_module
from services.audit import emit as audit
from services.attendance_bridge import (
    MARKED_BY_BRIDGE,
    MARKED_BY_MANUAL,
    Punch,
    Regularisation,
    build_day_records,
)

router = APIRouter(prefix="/api/v1/pahchan", tags=["pahchan-attendance"])

_gate = require_module("pahchan")
_review_gate = require_org_role("org_owner", "org_admin")


class RegularisationCreate(BaseModel):
    employee_id: str
    for_date: str
    requested_direction: str = Field(..., pattern="^(in|out)$")
    requested_at_time: str
    reason: str = Field(..., min_length=3, max_length=500)
    punch_id: Optional[str] = None
    evidence_key: Optional[str] = None


class RegularisationDecision(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    decision_note: Optional[str] = Field(None, max_length=500)


class PublishBody(BaseModel):
    from_date: str
    to_date: str
    dry_run: bool = False


@router.post("/regularisations", status_code=201)
async def request_regularisation(
    body: RegularisationCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Ask for a day to be corrected.

    Anyone in the module may ask about their OWN record. Filing a correction
    against somebody else's attendance is a reviewer action, so a non-reviewer
    doing it is refused — otherwise any employee could rewrite a colleague's day
    and the only trace would be an approval nobody questioned.
    """
    pool = await get_pool()

    own = await pool.fetchval(
        "SELECT 1 FROM staging.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND user_id=$3",
        body.employee_id, org_id, user["user_id"],
    )
    if not own:
        is_reviewer = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid "
            "AND role_code IN ('org_owner','org_admin')",
            user["user_id"], org_id,
        )
        if not is_reviewer:
            raise HTTPException(
                403, "You can only request a correction to your own attendance"
            )

    row = await pool.fetchrow(
        "INSERT INTO staging.pahchan_regularisations "
        "    (org_id, employee_id, punch_id, for_date, requested_direction, "
        "     requested_at_time, reason, evidence_key, status) "
        "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4::date, $5, "
        "        $6::timestamptz, $7, $8, 'pending') "
        "RETURNING id, for_date, requested_direction, status, created_at",
        org_id, body.employee_id, body.punch_id or "", body.for_date,
        body.requested_direction, body.requested_at_time, body.reason,
        body.evidence_key,
    )
    return dict(row)


@router.get("/regularisations")
async def list_regularisations(
    status: str = "pending",
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT r.id, r.employee_id, e.full_name, r.for_date, "
        "       r.requested_direction, r.requested_at_time, r.reason, "
        "       r.status, r.decided_by, r.decided_at, r.decision_note, r.created_at "
        "  FROM staging.pahchan_regularisations r "
        "  LEFT JOIN staging.manav_employees e ON e.id = r.employee_id "
        " WHERE r.org_id=$1::uuid AND ($2 = 'all' OR r.status = $2) "
        " ORDER BY r.created_at DESC",
        org_id, status,
    )
    return [dict(r) for r in rows]


@router.patch("/regularisations/{reg_id}")
async def decide_regularisation(
    reg_id: UUID,
    body: RegularisationDecision,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Approve or reject a correction. Audited — this decides what somebody is
    paid for a day.

    Only a PENDING request can be decided. Allowing a settled one to be decided
    again would let a rejection be flipped to an approval afterwards, and the
    audit trail would carry only the second decision.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE staging.pahchan_regularisations "
        "   SET status=$1, decided_by=$2, decided_at=NOW(), decision_note=$3 "
        " WHERE id=$4::uuid AND org_id=$5::uuid AND status='pending' "
        "RETURNING id, employee_id, for_date, requested_direction, status",
        body.status, user["user_id"], body.decision_note, str(reg_id), org_id,
    )
    if not row:
        raise HTTPException(
            404, "No pending correction with that id in this organisation"
        )

    audit(
        "pahchan.regularisation_decided",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_regularisation",
        resource_id=str(reg_id),
        detail={"status": body.status, "for_date": str(row["for_date"])},
        severity="warn",
    )
    return dict(row)


@router.post("/attendance/publish")
async def publish_attendance_to_payroll(
    body: PublishBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Pair punches into attendance rows Vetana can price.

    `dry_run` returns exactly what would be written without writing it, because
    the first sensible thing to do with a payroll input is look at it.

    Re-running is safe and is the intended use: run it again as corrections land.
    Every value is derived and the upsert is keyed on (employee_id, date), so a
    second pass over an unchanged window changes nothing.
    """
    pool = await get_pool()

    punch_rows = await pool.fetch(
        "SELECT employee_id, direction, captured_at, flags, review_verdict "
        "  FROM staging.pahchan_punches "
        " WHERE org_id=$1::uuid "
        "   AND captured_at >= $2::date "
        "   AND captured_at < ($3::date + INTERVAL '1 day') "
        " ORDER BY captured_at",
        org_id, body.from_date, body.to_date,
    )
    reg_rows = await pool.fetch(
        "SELECT employee_id, for_date, requested_direction, requested_at_time "
        "  FROM staging.pahchan_regularisations "
        " WHERE org_id=$1::uuid AND status='approved' "
        "   AND for_date >= $2::date AND for_date <= $3::date",
        org_id, body.from_date, body.to_date,
    )

    result = build_day_records(
        [
            Punch(
                employee_id=str(r["employee_id"]),
                direction=r["direction"],
                captured_at=r["captured_at"],
                flags=tuple(r["flags"] or ()),
                review_verdict=r["review_verdict"],
            )
            for r in punch_rows
        ],
        [
            Regularisation(
                employee_id=str(r["employee_id"]),
                for_date=r["for_date"],
                direction=r["requested_direction"],
                at_time=r["requested_at_time"],
            )
            for r in reg_rows
        ],
    )

    written = 0
    skipped_manual = []

    if not body.dry_run:
        for rec in result.records:
            # The WHERE on the DO UPDATE is the guard: a row HR typed by hand
            # keeps its values and returns nothing, so it lands in
            # skipped_manual instead of being silently reverted by a re-run.
            row = await pool.fetchrow(
                "INSERT INTO staging.manav_attendance "
                "    (org_id, employee_id, date, check_in, check_out, status, "
                "     work_hours, notes, marked_by) "
                "VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, $9) "
                "ON CONFLICT (employee_id, date) DO UPDATE SET "
                "    check_in   = EXCLUDED.check_in, "
                "    check_out  = EXCLUDED.check_out, "
                "    status     = EXCLUDED.status, "
                "    work_hours = EXCLUDED.work_hours, "
                "    notes      = EXCLUDED.notes, "
                "    marked_by  = EXCLUDED.marked_by "
                "  WHERE staging.manav_attendance.marked_by IS DISTINCT FROM $10 "
                "RETURNING employee_id",
                org_id, rec.employee_id, rec.day, rec.check_in, rec.check_out,
                rec.status, rec.work_hours, rec.notes, MARKED_BY_BRIDGE,
                MARKED_BY_MANUAL,
            )
            if row:
                written += 1
            else:
                skipped_manual.append(
                    {"employee_id": rec.employee_id, "date": rec.day.isoformat()}
                )

        audit(
            "pahchan.attendance_published",
            request,
            org_id=org_id,
            user_id=user["user_id"],
            detail={
                "from": body.from_date,
                "to": body.to_date,
                "rows_written": written,
            },
            severity="warn",
        )

    return {
        "dry_run": body.dry_run,
        **result.summary,
        "rows_written": written,
        "skipped_manual_rows": len(skipped_manual),
        "skipped_manual": skipped_manual[:50],
        "withheld_days": result.withheld_days[:50],
        # Stated in the response rather than left to be discovered. There is no
        # shift definition anywhere in this product -- pahchan_policy holds
        # geofence radius, grace minutes and retention, no expected hours -- so
        # overtime cannot be derived and is deliberately not written.
        "overtime_hours": "not computed - no shift definition exists to derive it from",
    }
