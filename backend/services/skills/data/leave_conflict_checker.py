import logging
from datetime import date

log = logging.getLogger(__name__)

COVERAGE_BLOCK_PCT = 50  # block if >=50% of dept is on leave


async def check_dept_coverage(
    pool, org_id: str, dept: str, start_date: date, end_date: date
) -> dict:
    """Check whether approving leave would breach department coverage limits.

    Returns {on_leave_count, total, pct, blocked}.
    """
    total_row = await pool.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM staging.manav_employees
        WHERE org_id = $1::uuid AND department = $2
          AND status = 'active' AND is_active = true
        """,
        org_id, dept,
    )
    total = total_row["cnt"]

    if total == 0:
        return {"on_leave_count": 0, "total": 0, "pct": 0, "blocked": False}

    on_leave_row = await pool.fetchrow(
        """
        SELECT COUNT(DISTINCT employee_id) AS cnt
        FROM staging.manav_leave_requests lr
        JOIN staging.manav_employees e ON e.id = lr.employee_id
        WHERE lr.org_id = $1::uuid
          AND e.department = $2
          AND lr.status = 'approved'
          AND lr.start_date <= $4
          AND lr.end_date >= $3
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
