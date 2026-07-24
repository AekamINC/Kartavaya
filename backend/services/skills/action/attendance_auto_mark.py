import logging
import uuid
from datetime import date

log = logging.getLogger(__name__)


async def mark_holidays_weekends(pool, org_id: str, target_date: date = None) -> dict:
    """Auto-mark attendance as 'holiday' or 'weekend' for all active employees on the given date.

    Returns {marked: int}.
    """
    target_date = target_date or date.today()
    weekday = target_date.weekday()  # 0=Mon, 6=Sun

    # Check if it's a declared holiday
    holiday = await pool.fetchrow(
        """
        SELECT id, name FROM staging.manav_holidays
        WHERE org_id = $1::uuid AND date = $2 AND is_active = true
        """,
        org_id, target_date,
    )

    is_weekend = weekday in (5, 6)  # Saturday, Sunday

    if not holiday and not is_weekend:
        return {"marked": 0}

    status = "holiday" if holiday else "weekend"

    employees = await pool.fetch(
        """
        SELECT id FROM staging.manav_employees
        WHERE org_id = $1::uuid AND status = 'active' AND is_active = true
        """,
        org_id,
    )

    marked = 0
    for emp in employees:
        # Skip if attendance already exists
        existing = await pool.fetchrow(
            "SELECT 1 FROM staging.manav_attendance WHERE employee_id = $1::uuid AND date = $2",
            emp["id"], target_date,
        )
        if existing:
            continue

        await pool.execute(
            """
            INSERT INTO staging.manav_attendance
                (id, org_id, employee_id, date, status, work_hours, overtime_hours, marked_by)
            VALUES ($1, $2::uuid, $3::uuid, $4, $5, 0, 0, 'system')
            """,
            uuid.uuid4(), org_id, emp["id"], target_date, status,
        )
        marked += 1

    return {"marked": marked}
