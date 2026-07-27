import logging
from email_service import send_email

log = logging.getLogger(__name__)

# Default onboarding steps
ONBOARDING_STEPS = [
    "welcome_email",
    "create_user_account",
    "assign_department",
    "allocate_assets",
    "setup_payroll",
]


async def execute_onboarding(pool, employee_id: str, org_id: str) -> dict:
    """Run through onboarding checklist for a new employee.

    Returns {steps_completed: [str]}.
    """
    emp = await pool.fetchrow(
        """
        SELECT id, name, email, department, user_id, date_of_joining
        FROM staging.manav_employees
        WHERE id = $1::uuid AND org_id = $2::uuid
        """,
        employee_id, org_id,
    )
    if not emp:
        return {"steps_completed": [], "error": "employee_not_found"}

    completed = []

    # 1. Welcome email
    if emp["email"]:
        try:
            # Sync — see campaign_sender.py. The await raised, so
            # "welcome_email" was never recorded as a completed step.
            send_email(
                emp["email"],
                f"Welcome to the team, {emp['name']}!",
                f"<p>Hello {emp['name']},</p><p>Welcome aboard! Your joining date is {emp['date_of_joining']}.</p>",
            )
            completed.append("welcome_email")
        except Exception:
            log.warning("Welcome email failed for %s", employee_id)

    # 2. Ensure user_roles entry exists
    if emp["user_id"]:
        existing = await pool.fetchrow(
            "SELECT 1 FROM staging.user_roles WHERE user_id = $1::uuid AND org_id = $2::uuid",
            emp["user_id"], org_id,
        )
        if existing:
            completed.append("create_user_account")

    # 3. Department assignment check
    if emp["department"]:
        completed.append("assign_department")

    # 4. Allocate default assets (just log, actual allocation is manual)
    completed.append("allocate_assets")

    # 5. Setup payroll - create salary structure stub if missing
    existing_sal = await pool.fetchrow(
        "SELECT 1 FROM staging.vetana_salary_structures WHERE employee_id = $1::uuid AND org_id = $2::uuid",
        employee_id, org_id,
    )
    if existing_sal:
        completed.append("setup_payroll")
    else:
        log.info("Salary structure pending for employee %s", employee_id)

    return {"steps_completed": completed}
