import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}


async def aggregate_kpis(pool, org_id: str, period: str = "30d") -> dict:
    """Aggregate cross-module KPIs for an org over a rolling period.

    Returns {revenue, deals_won, deals_lost, tasks_closed, invoices_sent,
             new_leads, expenses_total, employees_active}.
    """
    days = _PERIOD_DAYS.get(period, 30)
    since = datetime.utcnow() - timedelta(days=days)

    # Run all queries concurrently via asyncpg (sequential here for simplicity,
    # but each is a lightweight indexed query).

    revenue = await pool.fetchrow(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM staging.ganit_payments
        WHERE org_id = $1::uuid AND payment_date >= $2
        """,
        org_id, since,
    )

    deals = await pool.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE won_at IS NOT NULL AND won_at >= $2) AS won,
            COUNT(*) FILTER (WHERE lost_at IS NOT NULL AND lost_at >= $2) AS lost
        FROM staging.graha_deals
        WHERE org_id = $1::uuid AND is_active = true
        """,
        org_id, since,
    )

    tasks_closed = await pool.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM staging.tasks t
        JOIN staging.projects p ON p.id = t.project_id
        WHERE p.org_id = $1::uuid AND t.status = 'done'
          AND t.updated_at >= $2
        """,
        org_id, since,
    )

    invoices_sent = await pool.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM staging.ganit_invoices
        WHERE org_id = $1::uuid AND sent_at >= $2
          AND invoice_type = 'tax_invoice' AND is_active = true
        """,
        org_id, since,
    )

    new_leads = await pool.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM staging.graha_contacts
        WHERE org_id = $1::uuid AND contact_type = 'lead'
          AND created_at >= $2 AND is_active = true
        """,
        org_id, since,
    )

    expenses = await pool.fetchrow(
        """
        SELECT COALESCE(SUM(total), 0) AS total
        FROM staging.ganit_expenses
        WHERE org_id = $1::uuid AND expense_date >= $2 AND is_active = true
        """,
        org_id, since,
    )

    employees = await pool.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM staging.manav_employees
        WHERE org_id = $1::uuid AND status = 'active' AND is_active = true
        """,
        org_id,
    )

    return {
        "period": period,
        "revenue": float(revenue["total"]),
        "deals_won": deals["won"],
        "deals_lost": deals["lost"],
        "tasks_closed": tasks_closed["cnt"],
        "invoices_sent": invoices_sent["cnt"],
        "new_leads": new_leads["cnt"],
        "expenses_total": float(expenses["total"]),
        "employees_active": employees["cnt"],
    }
