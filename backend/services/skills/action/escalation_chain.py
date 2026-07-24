import logging
from services.web_push_service import send_web_push
from email_service import send_email

log = logging.getLogger(__name__)

# Entity type -> (table, title_col)
_ENTITY_MAP = {
    "task": ("staging.tasks", "title"),
    "deal": ("staging.graha_deals", "title"),
    "invoice": ("staging.ganit_invoices", "invoice_number"),
    "ticket": ("staging.graha_tickets", "subject"),
    "leave_request": ("staging.manav_leave_requests", "reason"),
}


async def escalate(pool, entity_type: str, entity_id: str, level: int = 1) -> dict:
    """Escalate an entity to the next manager in the reporting chain.

    *level*: 1 = direct manager, 2 = skip-level, etc.

    Returns {notified: user_id, method: 'push+email' | 'email' | 'none'}.
    """
    spec = _ENTITY_MAP.get(entity_type)
    if not spec:
        return {"notified": None, "method": "none", "error": "unknown_entity_type"}

    table, title_col = spec

    # Get entity + owner
    entity = await pool.fetchrow(
        f"SELECT id, org_id, {title_col} AS label, assigned_to AS owner_id FROM {table} WHERE id = $1::uuid",
        entity_id,
    )
    if not entity:
        return {"notified": None, "method": "none", "error": "entity_not_found"}

    owner_id = entity["owner_id"]
    org_id = entity["org_id"]

    # Walk reporting chain
    target_id = owner_id
    for _ in range(level):
        if not target_id:
            break
        mgr = await pool.fetchrow(
            """
            SELECT reporting_to FROM staging.manav_employees
            WHERE user_id = $1::uuid AND org_id = $2::uuid AND is_active = true
            """,
            target_id, org_id,
        )
        if mgr and mgr["reporting_to"]:
            target_id = mgr["reporting_to"]
        else:
            break

    if not target_id or target_id == owner_id:
        return {"notified": None, "method": "none", "error": "no_manager_found"}

    # Get target user info
    target = await pool.fetchrow(
        "SELECT user_id, name, email FROM staging.manav_employees WHERE user_id = $1::uuid AND org_id = $2::uuid",
        target_id, org_id,
    )
    if not target:
        return {"notified": str(target_id), "method": "none", "error": "manager_not_in_employees"}

    label = entity["label"]
    subject = f"Escalation: {entity_type} - {label}"
    body = f"<p>A {entity_type} (<b>{label}</b>) has been escalated to you (level {level}).</p>"

    method = "email"
    try:
        await send_web_push(pool, str(target_id), subject, body[:200])
        method = "push+email"
    except Exception:
        log.warning("Push failed for escalation to %s", target_id)

    try:
        await send_email(target["email"], subject, body)
    except Exception:
        log.warning("Email failed for escalation to %s", target["email"])
        if method == "email":
            method = "none"

    return {"notified": str(target_id), "method": method}
