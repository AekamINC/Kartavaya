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

from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.subscription import require_module
from services.audit import emit as audit
from services.niyam.subjects import correction_decided, correction_requested
from services.attendance_bridge import (
    MARKED_BY_BRIDGE,
    MARKED_BY_MANUAL,
    Punch,
    Regularisation,
    ShiftPolicy,
    build_day_records,
)

router = APIRouter(prefix="/api/v1/pahchan", tags=["pahchan-attendance"])

_gate = require_module("pahchan")
_review_gate = require_org_role("org_owner", "org_admin")


async def _name_employees(pool, org_id: str, *lists) -> None:
    """Stamp `employee_name` onto every row carrying an `employee_id`, in place.

    Added 2026-08-07 for the owner's rule that an id is never displayed. The
    publish result is built by `services/attendance_bridge`, which is pure and
    does no I/O, so its rows carry ids and nothing else — and `PublishPayroll`
    drew them raw under a column headed "Employee".

    One query for every list, keyed by id. `e.name`, not `e.full_name`:
    `staging.manav_employees` has no `full_name` column and a SELECT for one
    raises rather than returning null — the mistake this file already carries a
    note about thirty lines up.

    An employee row that has since been deleted names itself as such. It is not
    left blank, because a blank cell in an audit-shaped table reads as a
    rendering fault rather than as a missing record.
    """
    ids = {r["employee_id"] for lst in lists for r in lst if r.get("employee_id")}
    if not ids:
        return
    rows = await pool.fetch(
        "SELECT id::text AS id, name FROM public.manav_employees "
        "WHERE org_id=$1::uuid AND id = ANY($2::uuid[])",
        org_id, list(ids),
    )
    names = {r["id"]: (r["name"] or "").strip() for r in rows}
    for lst in lists:
        for row in lst:
            key = str(row.get("employee_id") or "")
            row["employee_name"] = names.get(key) or "A removed employee"


class RegularisationCreate(BaseModel):
    employee_id: str
    for_date: str
    requested_direction: str = Field(..., pattern="^(in|out)$")
    requested_at_time: str
    reason: str = Field(..., min_length=3, max_length=500)
    punch_id: Optional[str] = None
    evidence_key: Optional[str] = None


class RegularisationDecision(BaseModel):
    # `declined`, not `rejected`. Migration 064's CHECK is
    # `status IN ('pending','approved','declined')`, so every decline this
    # endpoint has ever accepted was refused by the database as a constraint
    # violation and surfaced as a 500. Approving worked; declining did not, and
    # nothing noticed because no screen called this.
    status: str = Field(..., pattern="^(approved|declined)$")
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
        "SELECT 1 FROM public.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND user_id=$3",
        body.employee_id, org_id, user["user_id"],
    )
    if not own:
        is_reviewer = await pool.fetchval(
            "SELECT 1 FROM public.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid "
            "AND role_code IN ('org_owner','org_admin')",
            user["user_id"], org_id,
        )
        if not is_reviewer:
            raise HTTPException(
                403, "You can only request a correction to your own attendance"
            )

    # ⚠ `$4::date` AND `$6::timestamptz` MAKE ASYNCPG INFER DATE/TIMESTAMP
    # PARAMETERS, so a `str` is refused with "'str' object has no attribute
    # 'toordinal'" and the endpoint 500s. **REQUESTING A CORRECTION HAS NEVER
    # ONCE WORKED** — `staging.pahchan_regularisations` holds 0 rows, and that
    # is the consequence rather than a coincidence beside it.
    #
    # THE IDENTICAL FAULT IS DOCUMENTED 200 LINES BELOW IN THIS FILE.
    # `publish_attendance_to_payroll` says it "did that on every call, for every
    # org, since it was written" and names the bank statement import (2b864aa8)
    # and the sales target (eae0b912) as the same family. That one was fixed by
    # parsing at the top of the handler; this one was left, in the same file,
    # under the same comment.
    #
    # Found by proposal 93 Suite 09, 2026-08-29, from the Railway deploy log.
    #
    # Parsed here, and a bad value is a 400 that QUOTES IT rather than an opaque
    # 500 — a date typed into an attendance correction is ordinary human input,
    # and the person who typed it is the one who can fix it.
    try:
        for_date = date.fromisoformat(body.for_date)
    except ValueError as exc:
        raise HTTPException(
            400,
            f"'{body.for_date}' is not a date this can read. Use YYYY-MM-DD.",
        ) from exc
    try:
        requested_at_time = datetime.fromisoformat(body.requested_at_time)
    except ValueError as exc:
        raise HTTPException(
            400,
            f"'{body.requested_at_time}' is not a time this can read. "
            "Use an ISO timestamp, for example 2026-08-18T09:30:00.",
        ) from exc

    # ── THE REQUEST IS AN EVENT — a date and a status, never the reason ─────
    # `correction.requested` rides the INSERT's own transaction. The emitter
    # (`subjects.correction_requested`) derives `reason_type` from whether
    # `punch_id` is set and carries `for_date` — the free-text reason, the
    # punch times and the evidence key all stay behind Pahchan's access rules.
    # `employee_user_id` is the LOGIN of the employee the correction is ABOUT,
    # read in the same transaction: requester and employee differ when a
    # reviewer files on someone's behalf, and rules notify the employee.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "INSERT INTO public.pahchan_regularisations "
                "    (org_id, employee_id, punch_id, for_date, requested_direction, "
                "     requested_at_time, reason, evidence_key, status) "
                "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4::date, $5, "
                "        $6::timestamptz, $7, $8, 'pending') "
                "RETURNING *",
                org_id, body.employee_id, body.punch_id or "", for_date,
                body.requested_direction, requested_at_time, body.reason,
                body.evidence_key,
            )
            _emp_user_id = await _conn.fetchval(
                "SELECT user_id FROM public.manav_employees "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                body.employee_id, org_id,
            )
            await correction_requested(
                _conn, org_id=org_id, actor_id=user["user_id"],
                regularisation_id=row["id"], row=dict(row),
                employee_user_id=_emp_user_id,
            )
    # `RETURNING *` above is for the emitter; the response keeps its
    # original shape.
    return {k: row[k] for k in
            ("id", "for_date", "requested_direction", "status", "created_at")}


@router.get("/regularisations")
async def list_regularisations(
    status: str = "pending",
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        # `e.name`, not `e.full_name`. `staging.manav_employees` has no
        # `full_name` column and never has — migration 018 names it `name`, and
        # `full_name` exists only on `manav_candidates` in the recruitment
        # tables. So this SELECT raised UndefinedColumnError and this endpoint
        # returned 500 on every call since it was written. Aliased to
        # `employee_name`, which is what every other join on this table in the
        # codebase calls it, including `/register` two files over.
        "SELECT r.id, r.employee_id, e.name AS employee_name, r.for_date, "
        "       r.requested_direction, r.requested_at_time, r.reason, "
        "       r.status, r.decided_by, r.decided_at, r.decision_note, r.created_at "
        "  FROM public.pahchan_regularisations r "
        "  LEFT JOIN public.manav_employees e ON e.id = r.employee_id "
        " WHERE r.org_id=$1::uuid AND ($2 = 'all' OR r.status = $2) "
        " ORDER BY r.created_at DESC",
        org_id, status,
    )
    return [dict(r) for r in rows]


@router.get("/regularisations/mine")
async def list_my_regularisations(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The corrections THIS person asked for, and what was decided.

    ── WHY THIS EXISTS ─────────────────────────────────────────────────────

    `GET /regularisations` is gated on `require_org_role('org_owner',
    'org_admin')` — correctly, because it is the reviewer's queue and shows
    every employee's requests. But that left an employee with no way to learn
    the outcome of their OWN request, and the mobile register said so in as many
    words: "This app cannot show you their answer."

    That sentence was true, and it is the wrong thing for a product to have to
    say. An employee whose clock-out is missing loses that day's pay; telling
    them the remedy exists and then that they cannot see whether it worked is
    worse than not offering it. They would ask a manager, which is the phone
    call the feature was built to remove.

    NO REVIEW GATE, and no employee_id parameter. The rows are selected by
    joining the caller's own user_id to their employee record, so there is
    nothing to pass and therefore nothing to tamper with — asking for somebody
    else's corrections is not a request this endpoint can express.

    `decision_note` is included deliberately. A refusal with no reason is the
    thing that generates the phone call this endpoint exists to prevent.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT r.id, r.for_date, r.requested_direction, r.requested_at_time, "
        "       r.reason, r.status, r.decided_at, r.decision_note, r.created_at "
        "  FROM public.pahchan_regularisations r "
        "  JOIN public.manav_employees e ON e.id = r.employee_id "
        " WHERE r.org_id=$1::uuid AND e.user_id=$2 "
        " ORDER BY r.created_at DESC LIMIT 50",
        org_id, user["user_id"],
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

    A decline is gated on a reason — 064's `pahchan_reg_decline_needs_reason`
    CHECK and `17-mobile-app.md`'s approval row both say so. Checked here as well
    so the caller gets that sentence rather than a constraint name inside a 500.
    """
    if body.status == "declined" and not (body.decision_note or "").strip():
        raise HTTPException(
            400,
            "A decline needs a reason. The employee is being told their record of a "
            "day is wrong, and 'declined' on its own is not something they can act on.",
        )

    pool = await get_pool()
    # ── THE DECISION IS AN EVENT — one event for both outcomes ──────────────
    # `correction.decided` rides the UPDATE's own transaction, so it exists if
    # and only if the decision committed — and it does not fire at all when
    # the WHERE finds no pending row, because refusing to re-decide a settled
    # request is the point of that predicate. The vocabulary is 'approved' or
    # 'declined' (064's CHECK — never 'rejected'), read off the row the write
    # returned; the mandatory decline note stays in the module with the rest
    # of the free text.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "UPDATE public.pahchan_regularisations "
                "   SET status=$1, decided_by=$2, decided_at=NOW(), decision_note=$3 "
                " WHERE id=$4::uuid AND org_id=$5::uuid AND status='pending' "
                "RETURNING *",
                body.status, user["user_id"], body.decision_note, str(reg_id), org_id,
            )
            if row is not None:
                _emp_user_id = await _conn.fetchval(
                    "SELECT user_id FROM public.manav_employees "
                    "WHERE id=$1::uuid AND org_id=$2::uuid",
                    row["employee_id"], org_id,
                )
                await correction_decided(
                    _conn, org_id=org_id, actor_id=user["user_id"],
                    regularisation_id=row["id"], row=dict(row),
                    decision=row["status"], employee_user_id=_emp_user_id,
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
    # `RETURNING *` above is for the emitter; the response keeps its
    # original shape.
    return {k: row[k] for k in
            ("id", "employee_id", "for_date", "requested_direction", "status")}


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
    # `$2::date` makes asyncpg infer a DATE parameter, so a str is refused with
    # "'str' object has no attribute 'toordinal'" and the endpoint 500s. It did
    # that on every call, for every org, since it was written — publishing
    # attendance to payroll has never once worked. Same family as the bank
    # statement import (2b864aa8) and the sales target (eae0b912): a type
    # mismatch in SQL, surfacing as an opaque "Internal server error".
    #
    # Parsed here, and a bad value is a 400 that quotes it rather than a 500. A
    # date typed into a payroll window is ordinary human input.
    try:
        from_date = date.fromisoformat(body.from_date)
        to_date = date.fromisoformat(body.to_date)
    except ValueError as exc:
        raise HTTPException(
            400,
            f"'{body.from_date}' to '{body.to_date}' is not a date range this can read. "
            "Use YYYY-MM-DD.",
        ) from exc

    # A window that runs backwards would quietly pair nothing and answer "no
    # attendance", which on a payroll input is the most dangerous possible
    # reply — indistinguishable from a fortnight nobody worked.
    if to_date < from_date:
        raise HTTPException(
            400,
            f"The window ends before it starts: {from_date} to {to_date}. "
            "Swap the dates.",
        )

    pool = await get_pool()

    punch_rows = await pool.fetch(
        "SELECT employee_id, direction, captured_at, flags, review_verdict "
        "  FROM public.pahchan_punches "
        " WHERE org_id=$1::uuid "
        "   AND captured_at >= $2::date "
        "   AND captured_at < ($3::date + INTERVAL '1 day') "
        " ORDER BY captured_at",
        org_id, from_date, to_date,
    )
    reg_rows = await pool.fetch(
        "SELECT employee_id, for_date, requested_direction, requested_at_time "
        "  FROM public.pahchan_regularisations "
        " WHERE org_id=$1::uuid AND status='approved' "
        "   AND for_date >= $2::date AND for_date <= $3::date",
        org_id, from_date, to_date,
    )

    # No policy row means every default, and the defaults have overtime OFF —
    # so an org that has never opened the settings screen gets exactly today's
    # behaviour rather than a surprise on the next payslip.
    pol = await pool.fetchrow(
        "SELECT overtime_enabled, standard_hours_per_day, "
        "       overtime_daily_threshold_hours, overtime_weekly_threshold_hours, "
        "       overtime_multiplier, week_starts_on, shift_start_time, "
        "       shift_end_time, overnight_shift "
        "  FROM public.pahchan_policy WHERE org_id=$1::uuid",
        org_id,
    )
    policy = ShiftPolicy(
        overtime_enabled=bool(pol["overtime_enabled"]),
        standard_hours_per_day=float(pol["standard_hours_per_day"]),
        overtime_daily_threshold_hours=float(pol["overtime_daily_threshold_hours"]),
        overtime_weekly_threshold_hours=float(pol["overtime_weekly_threshold_hours"]),
        overtime_multiplier=float(pol["overtime_multiplier"]),
        week_starts_on=int(pol["week_starts_on"]),
        shift_start_time=pol["shift_start_time"],
        shift_end_time=pol["shift_end_time"],
        overnight_shift=bool(pol["overnight_shift"]),
    ) if pol else ShiftPolicy()

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
        policy=policy,
    )

    written = 0
    skipped_manual = []

    if not body.dry_run:
        for rec in result.records:
            # The WHERE on the DO UPDATE is the guard: a row HR typed by hand
            # keeps its values and returns nothing, so it lands in
            # skipped_manual instead of being silently reverted by a re-run.
            row = await pool.fetchrow(
                "INSERT INTO public.manav_attendance "
                "    (org_id, employee_id, date, check_in, check_out, status, "
                "     work_hours, overtime_hours, notes, marked_by) "
                "VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, $9, $10) "
                "ON CONFLICT (employee_id, date) DO UPDATE SET "
                "    check_in   = EXCLUDED.check_in, "
                "    check_out  = EXCLUDED.check_out, "
                "    status     = EXCLUDED.status, "
                "    work_hours = EXCLUDED.work_hours, "
                # COALESCE, not a plain assignment: when overtime is not being
                # computed EXCLUDED carries NULL, and overwriting with it would
                # erase a figure somebody entered by hand. Not computed means
                # leave it alone, not set it to nothing.
                "    overtime_hours = COALESCE(EXCLUDED.overtime_hours, "
                "                              public.manav_attendance.overtime_hours), "
                "    notes      = EXCLUDED.notes, "
                "    marked_by  = EXCLUDED.marked_by "
                "  WHERE public.manav_attendance.marked_by IS DISTINCT FROM $11 "
                "RETURNING employee_id",
                org_id, rec.employee_id, rec.day, rec.check_in, rec.check_out,
                rec.status, rec.work_hours, rec.overtime_hours, rec.notes,
                MARKED_BY_BRIDGE, MARKED_BY_MANUAL,
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

    # `employee_name` on both lists. `attendance_bridge` is a pure function over
    # punches and knows only ids — correctly, it does no I/O — so the naming has
    # to happen here, and until it did, PublishPayroll drew a uuid under a column
    # headed "Employee". One query for both lists rather than a join inside the
    # bridge, because the bridge has no pool and should not acquire one.
    withheld = result.withheld_days[:50]
    manual = skipped_manual[:50]
    await _name_employees(pool, org_id, withheld, manual)

    return {
        "dry_run": body.dry_run,
        **result.summary,
        "rows_written": written,
        "skipped_manual_rows": len(skipped_manual),
        "skipped_manual": manual,
        "withheld_days": withheld,
        # Said plainly, because "0.0 overtime" and "overtime was never computed"
        # look identical on a payslip and mean opposite things.
        "overtime": {
            "computed": policy.overtime_enabled,
            "reason": None if policy.overtime_enabled else (
                "overtime_enabled is off for this organisation, so overtime_hours "
                "was left untouched. Set the shift policy to turn it on."
            ),
            "daily_threshold_hours": policy.overtime_daily_threshold_hours,
            "weekly_threshold_hours": policy.overtime_weekly_threshold_hours,
            "multiplier": policy.overtime_multiplier,
            "total_hours": round(
                sum(r.overtime_hours or 0 for r in result.records), 2
            ) if policy.overtime_enabled else None,
        },
    }
