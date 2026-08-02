"""
kpi_aggregator — the org's headline numbers, and the honest gaps in them.

Two things were wrong, one of them fatal.

FATAL: the tasks arm joined `staging.tasks` to `staging.projects` on
`t.project_id`. `staging.tasks` DOES NOT EXIST — tasks are `public.tasks` — and
`public.tasks` has no `project_id` either, so there was no version of that join
that could have worked. Any call raised UndefinedTable before returning
anything. Since `aggregate_kpis` is wired as the `kpis` context source
(`services/skills/context.py`), that means the source has never once produced a
figure: every template naming it rendered "unavailable".

SILENT: a single failing arm took the whole set down, and the alternative
everyone reaches for — `except: return 0` — is worse. A zero for revenue and a
zero for "we could not read revenue" are the same number on the page, and the
model will write a confident sentence about a business that earned nothing. Each
arm now fails independently, its value becomes None rather than 0, and its name
goes into `unavailable` so the reader is told which figures are missing.

── On entitlement ─────────────────────────────────────────────────────────────

This function reads Ganit, Graha AND Manav. It is NOT filtered per-block here:
`services/skills/modules.py` declares all three modules against it and the run is
refused up front unless the caller holds every one. Refuse-not-omit was the
owner's decision, and splitting the decision across two layers is how one of
them ends up wrong. A per-block entitlement-filtered brief is a different skill
and will need its own handler.
"""
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}

#: Tasks are team-scoped and teams are org-scoped; `public.tasks` carries no
#: org_id of its own. Same clause `find_overdue` and `dristi.py:187` use.
_TASK_ORG_SCOPE = (
    "team_id IN (SELECT team_id FROM teams "
    "WHERE org_id = $1::uuid AND deleted_at IS NULL)"
)


async def aggregate_kpis(pool, org_id: str, period: str = "30d") -> dict:
    """Aggregate cross-module KPIs for an org over a rolling period.

    Returns the figures plus `unavailable`, naming every arm that could not be
    read. A key present with None means "not known", never "zero".
    """
    days = _PERIOD_DAYS.get(period, 30)
    # Aware. `utcnow()` is naive and this value is compared against timestamptz
    # columns; the same confusion cost `find_overdue` every one of its calls.
    since = datetime.now(timezone.utc) - timedelta(days=days)

    unavailable: list[str] = []

    async def _one(name: str, sql: str, *args):
        """Run one arm. A failure is recorded and named, never zeroed."""
        try:
            return await pool.fetchrow(sql, *args)
        except Exception as exc:                       # noqa: BLE001 — reported
            log.warning("KPI arm %s failed for org %s: %s", name, org_id, exc)
            unavailable.append(name)
            return None

    revenue = await _one(
        "revenue",
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM staging.ganit_payments
        WHERE org_id = $1::uuid AND payment_date >= $2
        """,
        org_id, since,
    )

    deals = await _one(
        "deals",
        """
        SELECT
            COUNT(*) FILTER (WHERE won_at IS NOT NULL AND won_at >= $2) AS won,
            COUNT(*) FILTER (WHERE lost_at IS NOT NULL AND lost_at >= $2) AS lost
        FROM staging.graha_deals
        WHERE org_id = $1::uuid AND is_active = true
        """,
        org_id, since,
    )

    # Was `staging.tasks JOIN staging.projects ON p.id = t.project_id`. Neither
    # the table nor the column exists. Scoped through the team, like every other
    # reader of this table.
    tasks_closed = await _one(
        "tasks_closed",
        f"""
        SELECT COUNT(*) AS cnt
        FROM public.tasks
        WHERE {_TASK_ORG_SCOPE}
          AND status = 'done'
          AND updated_at >= $2
        """,
        org_id, since,
    )

    invoices_sent = await _one(
        "invoices_sent",
        """
        SELECT COUNT(*) AS cnt
        FROM staging.ganit_invoices
        WHERE org_id = $1::uuid AND sent_at >= $2
          AND invoice_type = 'tax_invoice' AND is_active = true
        """,
        org_id, since,
    )

    new_leads = await _one(
        "new_leads",
        """
        SELECT COUNT(*) AS cnt
        FROM staging.graha_contacts
        WHERE org_id = $1::uuid AND contact_type = 'lead'
          AND created_at >= $2 AND is_active = true
        """,
        org_id, since,
    )

    expenses = await _one(
        "expenses",
        """
        SELECT COALESCE(SUM(total), 0) AS total
        FROM staging.ganit_expenses
        WHERE org_id = $1::uuid AND expense_date >= $2 AND is_active = true
        """,
        org_id, since,
    )

    employees = await _one(
        "employees_active",
        """
        SELECT COUNT(*) AS cnt
        FROM staging.manav_employees
        WHERE org_id = $1::uuid AND status = 'active' AND is_active = true
        """,
        org_id,
    )

    def _num(row, key, cast=int):
        return None if row is None else cast(row[key])

    out = {
        "period": period,
        "revenue": _num(revenue, "total", float),
        "deals_won": _num(deals, "won"),
        "deals_lost": _num(deals, "lost"),
        "tasks_closed": _num(tasks_closed, "cnt"),
        "invoices_sent": _num(invoices_sent, "cnt"),
        "new_leads": _num(new_leads, "cnt"),
        "expenses_total": _num(expenses, "total", float),
        "employees_active": _num(employees, "cnt"),
    }
    if unavailable:
        # Named, so a reader is told what is missing rather than shown a zero.
        out["unavailable"] = unavailable
        out["note"] = (
            "These figures could not be read: "
            + ", ".join(unavailable)
            + ". Treat them as unknown, not as zero, and do not estimate them."
        )
    return out
