import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

# Module -> (table, date_col, owner_col, label_col)
_MODULE_MAP = {
    "invoices": (
        "staging.ganit_invoices",
        "due_date",
        "created_by",
        "invoice_number",
    ),
    "follow_ups": (
        "staging.graha_follow_ups",
        "due_at",
        "assigned_to",
        "title",
    ),
    "esign": (
        "staging.ganit_contracts",
        "updated_at",  # no explicit due_date; use updated + threshold
        "created_by",
        "title",
    ),
    "tasks": (
        "staging.tasks",
        "due_date",
        "assigned_to",
        "title",
    ),
    "vendor_bills": (
        "staging.ganit_vendor_bills",
        "due_date",
        "created_by",
        "bill_number",
    ),
}


async def find_overdue(pool, org_id: str, module: str, days_overdue: int = 0) -> list:
    """Find overdue entities across modules.

    *module*: one of invoices, follow_ups, esign, tasks, vendor_bills.
    *days_overdue*: minimum days past due (0 = anything past due right now).

    Returns list of {entity, owner, days_past}.
    """
    spec = _MODULE_MAP.get(module)
    if not spec:
        return []

    table, date_col, owner_col, label_col = spec
    cutoff = datetime.utcnow() - timedelta(days=days_overdue)

    # Build status filter per module
    status_filter = ""
    if module == "invoices":
        status_filter = "AND payment_status IN ('unpaid', 'partial', 'overdue') AND invoice_type = 'tax_invoice'"
    elif module == "tasks":
        status_filter = "AND status NOT IN ('done', 'cancelled')"
    elif module == "vendor_bills":
        status_filter = "AND status IN ('unpaid', 'partially_paid')"
    elif module == "esign":
        status_filter = "AND status = 'draft'"
    elif module == "follow_ups":
        status_filter = "AND is_done = false"

    query = f"""
        SELECT id, {label_col} AS label, {owner_col} AS owner_id, {date_col} AS due
        FROM {table}
        WHERE org_id = $1::uuid
          AND {date_col} < $2
          AND is_active = true
          {status_filter}
        ORDER BY {date_col}
        LIMIT 200
    """

    rows = await pool.fetch(query, org_id, cutoff)
    now = datetime.utcnow()
    return [
        {
            "entity": {"id": str(r["id"]), "label": r["label"], "module": module},
            "owner": str(r["owner_id"]) if r["owner_id"] else None,
            "days_past": (now - r["due"]).days,
        }
        for r in rows
    ]
