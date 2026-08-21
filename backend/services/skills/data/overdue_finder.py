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
        # NOT `user_id`. That column exists and is NULL on all 201 live task
        # rows — assignment is `assignee_user_ids`, a text[] populated on 181 of
        # them. Reading `user_id` returned a null owner for every overdue task
        # and looked like it had worked, which is the worst kind of wrong.
        # Arrays are 1-indexed; a task can have several assignees and this takes
        # the first, which `scan_upcoming_deadlines` reports in full.
        "owner_col": "assignee_user_ids[1]",
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

    # THE OWNER COMES BACK AS A NAME, NOT AN ID.
    #
    # This used to select the owner column raw and hand back
    # `"owner": str(r["owner_id"])`. Every consumer then had a user id and
    # nothing to print: the dock cannot render it (`check-rendered-ids`
    # forbids it, and rightly — a UUID tells a reader nothing), so the one
    # question a chase list exists to answer, WHO, could not be answered at
    # all. The owner said it plainly: "not giving the data is useless".
    #
    # LEFT JOIN, and the fallback ladder matters. `public.users.user_id` is
    # TEXT and every owner column here is text, so the join needs no cast.
    # A row whose owner is NULL, or points at a deleted account, keeps the
    # finding and loses only the name — an overdue follow-up nobody owns is
    # still overdue, and dropping it because of a missing join would hide
    # exactly the rows most likely to be forgotten.
    query = f"""
        SELECT e.id,
               e.{spec['label_col']} AS label,
               e.{spec['owner_col']} AS owner_id,
               coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.full_name), ''))
                   AS owner_name,
               e.{spec['date_col']}  AS due
        FROM {spec['table']} e
        LEFT JOIN public.users u ON u.user_id = e.{spec['owner_col']}
        WHERE {spec['org_clause'].replace('org_id', 'e.org_id')}
          AND e.{spec['date_col']} IS NOT NULL
          AND e.{spec['date_col']} < $2
          {spec['live_filter'].replace('AND is_active', 'AND e.is_active')}
          {spec['status_filter'].replace('AND ', 'AND e.')}
        ORDER BY e.{spec['date_col']}
        LIMIT 200
    """

    rows = await pool.fetch(query, org_id, cutoff)
    return [
        {
            "entity": {"id": str(r["id"]), "label": r["label"], "module": module},
            # `owner` stays an id because callers key on it — chase counts,
            # grouping, the ack key. It is NOT for printing.
            "owner": str(r["owner_id"]) if r["owner_id"] else None,
            # `owner_name` is the printable one, and it is deliberately a
            # SENTENCE-SHAPED absence rather than None: a reader seeing
            # "Unassigned" knows the follow-up has nobody on it, where a blank
            # reads as a rendering bug and an id reads as noise.
            "owner_name": r["owner_name"] or "Unassigned",
            "days_past": days_between(now, r["due"]),
        }
        for r in rows
    ]
