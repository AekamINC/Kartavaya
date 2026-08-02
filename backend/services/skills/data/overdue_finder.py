"""
overdue_finder — "what is past due", across the five things that can be.

Every one of the five module specs below was wrong against the live schema, in a
different way each time. Nothing caught it because no template has ever carried
a data step, so this file had never executed. Verified against the live catalog
2026-08-02 and corrected:

  invoices / vendor_bills  `due_date` is a DATE, and the result mapped
                           `datetime.utcnow() - row["due"]`, which is
                           `datetime - date` — TypeError, every call.
  follow_ups               filtered `is_done` and `is_active`. NEITHER COLUMN
                           EXISTS; the column is `is_completed`. UndefinedColumn.
  esign / contracts        `updated_at` is timestamptz, so the same subtraction
                           was naive-minus-aware — TypeError, every call.
  tasks                    pointed at `staging.tasks`, WHICH DOES NOT EXIST.
                           Tasks live in `public.tasks`, keyed `due_at`, with no
                           `org_id` and no `is_active` at all.

── Tenancy, and why tasks needed its own clause ────────────────────────────────

Four of the five carry `org_id` and filter on it directly. `public.tasks` does
not: tasks belong to a TEAM and teams belong to an org, so the scope is the
subquery `dristi.py:187` already uses. Getting this wrong is a cross-tenant read,
not a missing row, which is why it is spelled out per module rather than
assumed.
"""
import logging
from datetime import timedelta

from services.skills.timeutil import days_between, utc_now

log = logging.getLogger(__name__)

#: The clock moved to `services/skills/timeutil.py` after `score_deals` was
#: found carrying the identical naive-minus-aware bug on the first real skill
#: run — the same defect in two files, because each handler reached for
#: `datetime.utcnow()` on its own.
#:
#: NOTE the argument order. The local helper this replaced took `(due, now)` and
#: returned `now - due`; the shared one takes `(later, earlier)`. Aliasing one to
#: the other silently negated every age — caught by the tests, which is the only
#: reason it is not shipping as "-3 days overdue".
_utc_now = utc_now


#: One spec per module. Explicit rather than clever: every field here was a wrong
#: assumption at least once, so each is stated per module and none is defaulted.
#:
#:   date_is_date  the column is DATE, not timestamptz — the cutoff must be a
#:                 date or Postgres compares across types.
#:   org_clause    how a row is tied to the caller's organisation.
#:   live_filter   the module's own "not deleted" condition, or "" where it has
#:                 none. Was a hardcoded `is_active = true` for all five, and
#:                 two of the five have no such column.
_MODULE_MAP = {
    "invoices": {
        "table": "staging.ganit_invoices",
        "date_col": "due_date",
        "date_is_date": True,
        "owner_col": "created_by",
        "label_col": "invoice_number",
        "org_clause": "org_id = $1::uuid",
        "live_filter": "AND is_active = true",
        "status_filter": (
            "AND payment_status IN ('unpaid', 'partial', 'overdue') "
            "AND invoice_type = 'tax_invoice'"
        ),
    },
    "vendor_bills": {
        "table": "staging.ganit_vendor_bills",
        "date_col": "due_date",
        "date_is_date": True,
        "owner_col": "created_by",
        "label_col": "bill_number",
        "org_clause": "org_id = $1::uuid",
        "live_filter": "AND is_active = true",
        "status_filter": "AND status IN ('unpaid', 'partially_paid')",
    },
    "follow_ups": {
        "table": "staging.graha_follow_ups",
        "date_col": "due_at",
        "date_is_date": False,
        "owner_col": "assigned_to",
        "label_col": "title",
        "org_clause": "org_id = $1::uuid",
        # No is_active column on this table.
        "live_filter": "",
        "status_filter": "AND is_completed = false",
    },
    "esign": {
        "table": "staging.ganit_contracts",
        # No explicit due date; "untouched since" is the signal.
        "date_col": "updated_at",
        "date_is_date": False,
        "owner_col": "created_by",
        "label_col": "title",
        "org_clause": "org_id = $1::uuid",
        "live_filter": "AND is_active = true",
        "status_filter": "AND status = 'draft'",
    },
    "tasks": {
        "table": "public.tasks",
        "date_col": "due_at",
        "date_is_date": False,
        "owner_col": "user_id",
        "label_col": "title",
        # Tasks are team-scoped; teams are org-scoped. See the module docstring.
        "org_clause": (
            "team_id IN (SELECT team_id FROM teams "
            "WHERE org_id = $1::uuid AND deleted_at IS NULL)"
        ),
        "live_filter": "AND archived_at IS NULL",
        "status_filter": "AND status NOT IN ('done', 'cancelled')",
    },
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

    now = _utc_now()
    cutoff = now - timedelta(days=days_overdue)
    # A DATE column compared against a timestamptz makes Postgres cast one side;
    # passing the right type keeps the comparison — and any index on it — intact.
    if spec["date_is_date"]:
        cutoff = cutoff.date()

    query = f"""
        SELECT id,
               {spec['label_col']} AS label,
               {spec['owner_col']} AS owner_id,
               {spec['date_col']}  AS due
        FROM {spec['table']}
        WHERE {spec['org_clause']}
          AND {spec['date_col']} IS NOT NULL
          AND {spec['date_col']} < $2
          {spec['live_filter']}
          {spec['status_filter']}
        ORDER BY {spec['date_col']}
        LIMIT 200
    """

    rows = await pool.fetch(query, org_id, cutoff)
    return [
        {
            "entity": {"id": str(r["id"]), "label": r["label"], "module": module},
            "owner": str(r["owner_id"]) if r["owner_id"] else None,
            "days_past": days_between(now, r["due"]),
        }
        for r in rows
    ]
