import logging

log = logging.getLogger(__name__)


async def allocate_yearly(pool, org_id: str, year: int) -> dict:
    """Allocate annual leave balances for all active employees.

    Creates/resets leave_balances records for each (employee, leave_type) for the given year.

    Returns {created: int}.
    """
    # Get org leave types
    leave_types = await pool.fetch(
        """
        SELECT id, name, default_days
        FROM staging.manav_leave_types
        WHERE org_id = $1::uuid AND is_active = true
        """,
        org_id,
    )

    employees = await pool.fetch(
        """
        SELECT id FROM staging.manav_employees
        WHERE org_id = $1::uuid AND status = 'active' AND is_active = true
        """,
        org_id,
    )

    created = 0
    for emp in employees:
        for lt in leave_types:
            await pool.execute(
                """
                INSERT INTO staging.manav_leave_balances
                    (org_id, employee_id, leave_type_id, year, total, used, balance)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 0, $5)
                ON CONFLICT (employee_id, leave_type_id, year)
                DO UPDATE SET total = $5, balance = $5 - staging.manav_leave_balances.used,
                             updated_at = NOW()
                """,
                org_id, emp["id"], lt["id"], year, lt["default_days"],
            )
            created += 1

    return {"created": created}
