import logging
import uuid
from datetime import date, timedelta

log = logging.getLogger(__name__)


async def auto_schedule_week(pool, org_id: str, week_start: date) -> dict:
    """Auto-assign employees to shifts for a week based on availability.

    Simple round-robin: fill each shift's min_staff from available employees
    who haven't been assigned that day, respecting leave requests.

    Returns {assigned: int, gaps_remaining: int}.
    """
    week_end = week_start + timedelta(days=6)

    # Get shifts
    shifts = await pool.fetch(
        """
        SELECT id, name, min_staff
        FROM staging.manav_shift_definitions
        WHERE org_id = $1::uuid AND is_active = true
        ORDER BY name
        """,
        org_id,
    )

    # Get available employees (active, not on approved leave for the week)
    employees = await pool.fetch(
        """
        SELECT e.id, e.name
        FROM staging.manav_employees e
        WHERE e.org_id = $1::uuid AND e.status = 'active' AND e.is_active = true
          AND e.id NOT IN (
              SELECT lr.employee_id FROM staging.manav_leave_requests lr
              WHERE lr.org_id = $1::uuid AND lr.status = 'approved'
                AND lr.start_date <= $3 AND lr.end_date >= $2
          )
        """,
        org_id, week_start, week_end,
    )

    # Get already-assigned schedules for the week
    existing = await pool.fetch(
        """
        SELECT employee_id, shift_id, date
        FROM staging.manav_schedules
        WHERE org_id = $1::uuid AND date BETWEEN $2 AND $3
        """,
        org_id, week_start, week_end,
    )
    assigned_set = {(str(r["employee_id"]), str(r["shift_id"]), str(r["date"])) for r in existing}

    assigned = 0
    gaps = 0
    emp_list = [e["id"] for e in employees]
    emp_idx = 0

    for day_offset in range(7):
        current_date = week_start + timedelta(days=day_offset)
        daily_assigned = set()  # employees assigned today

        for shift in shifts:
            needed = shift["min_staff"] or 1
            filled = sum(1 for a in assigned_set if a[1] == str(shift["id"]) and a[2] == str(current_date))
            slots = needed - filled

            for _ in range(slots):
                # Find next available employee not yet assigned today
                found = False
                for attempt in range(len(emp_list)):
                    eid = emp_list[(emp_idx + attempt) % len(emp_list)]
                    key = (str(eid), str(shift["id"]), str(current_date))
                    if str(eid) not in daily_assigned and key not in assigned_set:
                        await pool.execute(
                            """
                            INSERT INTO staging.manav_schedules
                                (id, org_id, employee_id, shift_id, date, status)
                            VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, 'confirmed')
                            """,
                            uuid.uuid4(), org_id, eid, shift["id"], current_date,
                        )
                        daily_assigned.add(str(eid))
                        assigned_set.add(key)
                        assigned += 1
                        emp_idx = (emp_idx + attempt + 1) % len(emp_list)
                        found = True
                        break

                if not found:
                    gaps += 1

    return {"assigned": assigned, "gaps_remaining": gaps}
