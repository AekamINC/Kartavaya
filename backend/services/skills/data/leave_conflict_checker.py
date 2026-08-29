import logging
from datetime import date

from services.on_the_rolls import still_on_the_rolls

log = logging.getLogger(__name__)

COVERAGE_BLOCK_PCT = 50  # block if >=50% of dept is on leave


async def check_dept_coverage(
    pool, org_id: str, dept: str, start_date: date, end_date: date
) -> dict:
    """Check whether approving leave would breach department coverage limits.

    Returns {on_leave_count, total, pct, blocked}.

    ── BOTH HALVES COUNT THE SAME PEOPLE ────────────────────────────────────

    This is the automation engine's own denominator, and it is a STOCK: the
    question is who is on the rolls to cover the department over `start_date` to
    `end_date`, not who was ever on it. `is_active` alone does not answer that —
    it is a flag a leaver deliberately keeps until their exit is settled, so an
    ex-employee counts as cover they cannot give.

    An INFLATED DENOMINATOR UNDER-BLOCKS. Measured read-only on 2026-08-26 in
    E2E Test & Associates, Accounts and Payroll each held 8 on the flag and 6 on
    the fact; three people off is 37% against a true 50%, which is the difference
    between approving the leave and refusing it.

    The NUMERATOR carries the same guard, and that is not symmetry for its own
    sake: guarding only the denominator would let somebody who has left
    contribute to `on_leave` while being absent from `total`, and `pct` could
    then exceed 100 — a coverage figure that cannot exist reads as a bug in the
    engine rather than as the leaver it actually is.
    """
    total_row = await pool.fetchrow(
        f"""
        SELECT COUNT(*) AS cnt
        FROM public.manav_employees e
        WHERE e.org_id = $1::uuid AND e.department = $2
          AND e.status = 'active' AND e.is_active = true
          {still_on_the_rolls("e")}
        """,
        org_id, dept,
    )
    total = total_row["cnt"]

    if total == 0:
        return {"on_leave_count": 0, "total": 0, "pct": 0, "blocked": False}

    on_leave_row = await pool.fetchrow(
        # `e.org_id = lr.org_id` on the join, which was not there. The guard
        # qualifies `e.org_id`, so without it the offboarding lookup would be
        # anchored to whatever org the joined employee row turned out to belong
        # to — and joining a child on its id alone is precisely what the
        # `graha_clients` leak taught this repository not to do. Every other
        # employee join in the HR skills already reads
        # `ON e.id = a.employee_id AND e.org_id = a.org_id`; this one is now the
        # same shape.
        f"""
        SELECT COUNT(DISTINCT lr.employee_id) AS cnt
        FROM public.manav_leave_requests lr
        JOIN public.manav_employees e
          ON e.id = lr.employee_id AND e.org_id = lr.org_id
        WHERE lr.org_id = $1::uuid
          AND e.department = $2
          AND lr.status = 'approved'
          AND lr.start_date <= $4
          AND lr.end_date >= $3
          {still_on_the_rolls("e")}
        """,
        org_id, dept, start_date, end_date,
    )
    on_leave = on_leave_row["cnt"]
    pct = round(on_leave / total * 100)

    return {
        "on_leave_count": on_leave,
        "total": total,
        "pct": pct,
        "blocked": pct >= COVERAGE_BLOCK_PCT,
    }
