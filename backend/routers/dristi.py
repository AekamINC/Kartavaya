"""
dristi.py — Dristi · दृष्टि (Analytics) Router
Cross-module KPIs, trends, and saved dashboards.
Reads from all modules: Graha, Ganit, Manav, Vikray, Vetana, tasks.
"""
import json
from datetime import date, datetime, time as _dt_time, timedelta, timezone


def _parse_time(s: str) -> _dt_time:
    parts = s.split(":")
    return _dt_time(int(parts[0]), int(parts[1]))

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from middleware.module_levels import held_level

router = APIRouter(prefix="/api/v1/dristi", tags=["dristi-analytics"])

_gate = require_module("dristi")


# ── Cross-module reach ───────────────────────────────────────────────────────
#
# Dristi reads from every other module by design — that is what an analytics
# module is. The problem is that it was gated on `dristi` ALONE, so the
# entitlement that governs the SOURCE data was never consulted.
#
# Concretely, before this: `GET /overview` returned payroll totals from
# `vetana_payroll_runs`, headcount from `manav_employees` and revenue from
# `ganit_invoices` to anyone holding a `dristi` grant. All three of those are
# SENSITIVE modules — withheld by default, audited on platform bypass. And
# `dristi` is in `STAFF_MODULES` while ganit, manav and vetana are deliberately
# not, so `platform_staff` — a role whose whole definition is "the operating
# set, excluding finance and all HR" — could read any customer's payroll and
# revenue through the analytics endpoint, with no audit row.
#
# The fix is per-source, not per-endpoint. Refusing the whole dashboard would
# break it for every legitimate user; instead each block is included only if the
# caller can reach the module it comes from, and the response says which were
# withheld so the UI can render an honest gap rather than a silent zero.

_OVERVIEW_SOURCES = {
    "crm": "graha",
    "deals": "graha",
    "revenue": "ganit",
    "hr": "manav",
    "orders": "vikray",
    "payroll": "vetana",
}


async def reachable_modules(pool, user_id: str, org_id: str, codes) -> set[str]:
    """Which of `codes` this caller may actually read, via the Tier-4 resolver.

    `held_level` returns None when the caller has no platform reach, no org
    admin role and no grant row — which is exactly "may not read this module".
    """
    reachable = set()
    for code in codes:
        if await held_level(pool, user_id, org_id, code) is not None:
            reachable.add(code)
    return reachable


# ── Pydantic Models ──────────────────────────────────────────

class DashboardCreate(BaseModel):
    name: str
    description: str = ""
    widgets: list[dict] = []
    is_default: bool = False


class DashboardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    widgets: list[dict] | None = None
    is_default: bool | None = None


# ── Helpers ──────────────────────────────────────────────────

def _month_range(months_back: int = 6):
    today = date.today()
    ranges = []
    for i in range(months_back - 1, -1, -1):
        y = today.year
        m = today.month - i
        while m <= 0:
            m += 12
            y -= 1
        label = f"{y}-{m:02d}"
        ranges.append(label)
    return ranges


#: Which module each exportable report reads. `_fetch_report_data` is reached by
#: `GET /exports/{type}` and by scheduled reports, and both bypassed every
#: source-module check the GET endpoints have — exporting "hr" returned the
#: employee register, and "revenue" the invoice ledger, behind `dristi` alone.
#: A report may read more than one, and ALL of them are required — a partial
#: export of the books is still an export of the books.
_REPORT_SOURCE_MODULES: dict[str, set[str]] = {
    "overview": {"graha", "ganit"},   # task counts, contact count, paid revenue
    "revenue": {"ganit"},
    "pipeline": {"graha"},
    "hr": {"manav"},
    "sales": {"vikray"},
}


async def _fetch_report_data(pool, org_id: str, report_type: str) -> dict:
    """Fetch report data by type, reusing the same queries as the GET endpoints."""
    today = date.today()
    month_ago = today - timedelta(days=30)

    if report_type == "overview":
        # `teams` has no `id` column — its primary key is `team_id` (TEXT), and
        # the forward tenancy path is `teams.org_id` (migration 028). The old
        # query joined `tm.id` twice, so it raised UndefinedColumn and this
        # branch 500'd every time: `GET /exports/overview` had never returned,
        # and neither had a scheduled report of type "overview".
        tasks = await pool.fetchval(
            "SELECT COUNT(*) FROM tasks t "
            "JOIN teams tm ON tm.team_id = t.team_id "
            "WHERE tm.org_id=$1::uuid AND tm.deleted_at IS NULL",
            org_id,
        )
        contacts = await pool.fetchval(
            "SELECT COUNT(*) FROM staging.graha_contacts WHERE org_id=$1::uuid AND is_active=TRUE", org_id)
        revenue = await pool.fetchval(
            "SELECT COALESCE(SUM(total),0) FROM staging.ganit_invoices "
            "WHERE org_id=$1::uuid AND payment_status='paid'", org_id) or 0
        return {"tasks": tasks, "contacts": contacts, "revenue": float(revenue)}
    elif report_type == "revenue":
        rows = await pool.fetch(
            "SELECT DATE_TRUNC('month', invoice_date) AS month, "
            "SUM(total) AS total, COUNT(*) AS count "
            "FROM staging.ganit_invoices WHERE org_id=$1::uuid AND is_active=TRUE "
            "GROUP BY 1 ORDER BY 1 DESC LIMIT 12", org_id)
        return {"monthly": [dict(r) for r in rows]}
    elif report_type == "pipeline":
        rows = await pool.fetch(
            "SELECT stage, COUNT(*) AS count, SUM(value) AS value "
            "FROM staging.graha_deals WHERE org_id=$1::uuid AND is_active=TRUE "
            "GROUP BY stage", org_id)
        return {"stages": [dict(r) for r in rows]}
    elif report_type == "hr":
        count = await pool.fetchval(
            "SELECT COUNT(*) FROM staging.manav_employees "
            "WHERE org_id=$1::uuid AND is_active=TRUE AND status='active'", org_id)
        return {"active_employees": count}
    elif report_type == "sales":
        rows = await pool.fetch(
            "SELECT status, COUNT(*) AS count, SUM(total) AS total "
            "FROM staging.vikray_orders WHERE org_id=$1::uuid "
            "GROUP BY status", org_id)
        return {"orders_by_status": [dict(r) for r in rows]}
    return {"report_type": report_type}


# ── Overview KPIs ────────────────────────────────────────────

@router.get("/overview")
async def overview(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    allowed = await reachable_modules(
        pool, user["user_id"], org_id, set(_OVERVIEW_SOURCES.values()),
    )

    tasks_stats = await pool.fetchrow(
        "SELECT COUNT(*) AS total_tasks, "
        "COUNT(*) FILTER (WHERE status='done') AS done_tasks, "
        "COUNT(*) FILTER (WHERE status='in_progress') AS active_tasks, "
        "COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue_tasks "
        "FROM tasks WHERE team_id IN ("
        "  SELECT team_id FROM teams WHERE org_id=$1::uuid AND deleted_at IS NULL"
        ") AND archived_at IS NULL",
        org_id,
    )

    crm = None
    if "graha" in allowed:
        crm = await pool.fetchrow(
        "SELECT COUNT(*) AS total_contacts, "
        "COUNT(*) FILTER (WHERE contact_type='lead') AS leads, "
        "COUNT(*) FILTER (WHERE contact_type='customer') AS customers "
        "FROM staging.graha_contacts WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    deals = None
    if "graha" in allowed:
        deals = await pool.fetchrow(
        "SELECT COUNT(*) AS total_deals, "
        "COALESCE(SUM(value),0) AS pipeline_value, "
        "COUNT(*) FILTER (WHERE stage='Won') AS won_deals, "
        "COALESCE(SUM(value) FILTER (WHERE stage='Won'),0) AS won_value, "
        "COUNT(*) FILTER (WHERE stage='Lost') AS lost_deals "
        "FROM staging.graha_deals WHERE org_id=$1::uuid",
        org_id,
    )

    revenue = None
    if "ganit" in allowed:
        revenue = await pool.fetchrow(
        "SELECT COALESCE(SUM(total),0) AS total_invoiced, "
        "COALESCE(SUM(amount_paid),0) AS total_collected, "
        "COALESCE(SUM(total - amount_paid) FILTER (WHERE payment_status NOT IN ('paid','cancelled')),0) AS outstanding "
        "FROM staging.ganit_invoices WHERE org_id=$1::uuid",
        org_id,
    )

    hr = None
    if "manav" in allowed:
        hr = await pool.fetchrow(
        "SELECT COUNT(*) AS headcount, "
        "COUNT(*) FILTER (WHERE department IS NOT NULL AND department != '') AS in_departments "
        "FROM staging.manav_employees WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    orders = None
    if "vikray" in allowed:
        orders = await pool.fetchrow(
        "SELECT COUNT(*) AS total_orders, "
        "COALESCE(SUM(total),0) AS order_value, "
        "COUNT(*) FILTER (WHERE status='delivered' OR status='closed') AS fulfilled "
        "FROM staging.vikray_orders WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    payroll = None
    if "vetana" in allowed:
        payroll = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_net),0) AS ytd_payroll, "
        "COALESCE(SUM(total_pf + total_esi + total_tds),0) AS ytd_statutory "
        "FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid AND month LIKE $2",
        org_id, f"{date.today().year}-%",
    )

    # `withheld` is named rather than left as an empty object so the UI can say
    # "you do not have access to payroll" instead of drawing a zero, which is
    # indistinguishable from a company that paid nobody this year.
    return {
        "tasks": dict(tasks_stats) if tasks_stats else {},
        "crm": dict(crm) if crm else {},
        "deals": dict(deals) if deals else {},
        "revenue": dict(revenue) if revenue else {},
        "hr": dict(hr) if hr else {},
        "orders": dict(orders) if orders else {},
        "payroll": dict(payroll) if payroll else {},
        "withheld": sorted({
            block for block, mod in _OVERVIEW_SOURCES.items() if mod not in allowed
        }),
    }


# ── Revenue Trends ───────────────────────────────────────────

@router.get("/revenue")
async def revenue_trends(
    months: int = 6,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # Every figure here is invoices and expenses — the ledger, not "analytics".
    # Ganit is a sensitive module and a `dristi` grant is not a grant to it.
    if not await reachable_modules(pool, user["user_id"], org_id, {"ganit"}):
        raise HTTPException(
            403,
            "Revenue analytics reads the accounting ledger. Ask your org admin "
            "for access to the Ganit module.",
        )

    labels = _month_range(min(months, 12))

    invoiced = await pool.fetch(
        "SELECT TO_CHAR(invoice_date, 'YYYY-MM') AS month, "
        "SUM(total) AS invoiced, SUM(amount_paid) AS collected, COUNT(*) AS count "
        "FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND invoice_date >= (CURRENT_DATE - INTERVAL '1 year') "
        "GROUP BY month ORDER BY month",
        org_id,
    )
    inv_map = {r["month"]: dict(r) for r in invoiced}

    expenses = await pool.fetch(
        "SELECT TO_CHAR(expense_date, 'YYYY-MM') AS month, "
        "SUM(total) AS total_expenses, COUNT(*) AS count "
        "FROM staging.ganit_expenses "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND expense_date >= (CURRENT_DATE - INTERVAL '1 year') "
        "GROUP BY month ORDER BY month",
        org_id,
    )
    exp_map = {r["month"]: dict(r) for r in expenses}

    trend = []
    for m in labels:
        inv = inv_map.get(m, {})
        exp = exp_map.get(m, {})
        trend.append({
            "month": m,
            "invoiced": float(inv.get("invoiced", 0)),
            "collected": float(inv.get("collected", 0)),
            "expenses": float(exp.get("total_expenses", 0)),
            "invoice_count": inv.get("count", 0),
            "profit": float(inv.get("collected", 0)) - float(exp.get("total_expenses", 0)),
        })

    return {"trend": trend, "labels": labels}


# ── Pipeline Analytics ───────────────────────────────────────

@router.get("/pipeline")
async def pipeline_analytics(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # Every block below is the CRM: deal values, win rates and named customers.
    # Same rule as /revenue and /hr — `dristi` is in STAFF_MODULES, `graha` is
    # reachable by fewer roles than that, and this endpoint was the one place
    # the pipeline could be read without holding it.
    if not await reachable_modules(pool, user["user_id"], org_id, {"graha"}):
        raise HTTPException(
            403,
            "Pipeline analytics reads CRM deals. Ask your org admin for access "
            "to the Graha module.",
        )

    stages = await pool.fetch(
        "SELECT stage, COUNT(*) AS count, COALESCE(SUM(value),0) AS value "
        "FROM staging.graha_deals WHERE org_id=$1::uuid "
        "GROUP BY stage ORDER BY CASE stage "
        "WHEN 'New' THEN 1 WHEN 'Qualified' THEN 2 WHEN 'Proposal' THEN 3 "
        "WHEN 'Negotiation' THEN 4 WHEN 'Won' THEN 5 WHEN 'Lost' THEN 6 ELSE 7 END",
        org_id,
    )

    won_trend = await pool.fetch(
        "SELECT TO_CHAR(updated_at, 'YYYY-MM') AS month, "
        "COUNT(*) AS deals_won, COALESCE(SUM(value),0) AS value_won "
        "FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND stage='Won' "
        "AND updated_at >= (CURRENT_DATE - INTERVAL '6 months') "
        "GROUP BY month ORDER BY month",
        org_id,
    )

    conversion = await pool.fetchrow(
        "SELECT "
        "COUNT(*) AS total, "
        "COUNT(*) FILTER (WHERE stage='Won') AS won, "
        "COUNT(*) FILTER (WHERE stage='Lost') AS lost, "
        "CASE WHEN COUNT(*) > 0 THEN "
        "  ROUND(COUNT(*) FILTER (WHERE stage='Won')::numeric / COUNT(*) * 100, 1) "
        "ELSE 0 END AS win_rate "
        "FROM staging.graha_deals WHERE org_id=$1::uuid",
        org_id,
    )

    top_contacts = await pool.fetch(
        "SELECT c.name, c.company, COUNT(d.id) AS deal_count, COALESCE(SUM(d.value),0) AS total_value "
        "FROM staging.graha_deals d "
        "JOIN staging.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.org_id=$1::uuid AND d.stage='Won' "
        "GROUP BY c.id, c.name, c.company "
        "ORDER BY total_value DESC LIMIT 10",
        org_id,
    )

    return {
        "stages": [dict(r) for r in stages],
        "won_trend": [dict(r) for r in won_trend],
        "conversion": dict(conversion) if conversion else {},
        "top_contacts": [dict(r) for r in top_contacts],
    }


# ── HR Analytics ─────────────────────────────────────────────

@router.get("/hr")
async def hr_analytics(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # Every block below is HR or payroll. Unlike /overview there is no
    # non-sensitive remainder worth returning, so this refuses outright rather
    # than serving an empty shell — a `dristi` grant is not a grant to the
    # salary register.
    allowed = await reachable_modules(pool, user["user_id"], org_id, {"manav", "vetana"})
    if "manav" not in allowed:
        raise HTTPException(
            403,
            "HR analytics reads employee records. Ask your org admin for access "
            "to the Manav module.",
        )

    dept_breakdown = await pool.fetch(
        "SELECT COALESCE(NULLIF(e.department,''), 'Unassigned') AS department, COUNT(*) AS count "
        "FROM staging.manav_employees e "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE "
        "GROUP BY e.department ORDER BY count DESC",
        org_id,
    )

    # Payroll is a separate entitlement from HR — reaching Manav does not mean
    # reaching what people are paid.
    payroll_trend = []
    if "vetana" in allowed:
        payroll_trend = await pool.fetch(
        "SELECT month, total_gross, total_net, total_pf, total_esi, total_tds, employee_count "
        "FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid ORDER BY month DESC LIMIT 12",
        org_id,
    )

    leave_stats = await pool.fetchrow(
        "SELECT COUNT(*) AS total_leaves, "
        "COUNT(*) FILTER (WHERE status='approved') AS approved, "
        "COUNT(*) FILTER (WHERE status='pending') AS pending, "
        "COUNT(*) FILTER (WHERE status='rejected') AS rejected "
        "FROM staging.manav_leave_requests WHERE org_id=$1::uuid "
        "AND start_date >= DATE_TRUNC('year', CURRENT_DATE)",
        org_id,
    )

    attendance = await pool.fetchrow(
        "SELECT COUNT(DISTINCT employee_id) AS tracked, "
        "COUNT(*) FILTER (WHERE status='present') AS present_days, "
        "COUNT(*) FILTER (WHERE status='absent') AS absent_days "
        "FROM staging.manav_attendance "
        "WHERE org_id=$1::uuid AND date >= (CURRENT_DATE - INTERVAL '30 days')",
        org_id,
    )

    return {
        "departments": [dict(r) for r in dept_breakdown],
        "payroll_trend": [dict(r) for r in payroll_trend],
        "leave_stats": dict(leave_stats) if leave_stats else {},
        "attendance_30d": dict(attendance) if attendance else {},
    }


# ── Sales Analytics ──────────────────────────────────────────

@router.get("/sales")
async def sales_analytics(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # Orders and targets are Vikray; the leaderboard additionally reads won
    # deals out of Graha. Refuse without Vikray — there is no non-sensitive
    # remainder — and drop the leaderboard alone when Graha is unreachable,
    # the same split /hr uses for payroll.
    allowed = await reachable_modules(pool, user["user_id"], org_id, {"vikray", "graha"})
    if "vikray" not in allowed:
        raise HTTPException(
            403,
            "Sales analytics reads the order book. Ask your org admin for "
            "access to the Vikray module.",
        )

    order_trend = await pool.fetch(
        "SELECT TO_CHAR(order_date, 'YYYY-MM') AS month, "
        "COUNT(*) AS orders, COALESCE(SUM(total),0) AS value "
        "FROM staging.vikray_orders "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
        "AND order_date >= (CURRENT_DATE - INTERVAL '6 months') "
        "GROUP BY month ORDER BY month",
        org_id,
    )

    status_split = await pool.fetch(
        "SELECT status, COUNT(*) AS count, COALESCE(SUM(total),0) AS value "
        "FROM staging.vikray_orders WHERE org_id=$1::uuid AND is_active=TRUE "
        "GROUP BY status",
        org_id,
    )

    leaderboard = []
    if "graha" in allowed:
        leaderboard = await pool.fetch(
        "SELECT t.salesperson_id, "
        "COALESCE(u.full_name, u.name, u.email) AS name, "
        "t.target_amount, "
        "COALESCE(d.won, 0) AS actual_amount, "
        "CASE WHEN t.target_amount > 0 "
        "  THEN ROUND(COALESCE(d.won,0) / t.target_amount * 100, 1) "
        "  ELSE 0 END AS pct "
        "FROM staging.vikray_targets t "
        "LEFT JOIN users u ON u.user_id = t.salesperson_id::text "
        "LEFT JOIN LATERAL ("
        "  SELECT COALESCE(SUM(value),0) AS won FROM staging.graha_deals "
        "  WHERE org_id=$1::uuid AND stage='Won' AND owner_id = t.salesperson_id "
        "  AND updated_at >= t.period_start AND updated_at < t.period_end + 1"
        ") d ON TRUE "
        "WHERE t.org_id=$1::uuid AND t.period_start <= CURRENT_DATE AND t.period_end >= CURRENT_DATE "
        "ORDER BY pct DESC",
        org_id,
    )

    return {
        "order_trend": [dict(r) for r in order_trend],
        "status_split": [dict(r) for r in status_split],
        "leaderboard": [dict(r) for r in leaderboard],
        # Named so the UI can say the leaderboard is withheld rather than draw
        # an empty board, which reads as "nobody sold anything".
        "withheld": [] if "graha" in allowed else ["leaderboard"],
    }


# ── Saved Dashboards CRUD ───────────────────────────────────

@router.get("/dashboards")
async def list_dashboards(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.dristi_dashboards "
        "WHERE org_id=$1::uuid AND is_active=TRUE ORDER BY is_default DESC, name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/dashboards")
async def create_dashboard(
    body: DashboardCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if body.is_default:
        await pool.execute(
            "UPDATE staging.dristi_dashboards SET is_default=FALSE WHERE org_id=$1::uuid",
            org_id,
        )
    row = await pool.fetchrow(
        "INSERT INTO staging.dristi_dashboards (org_id, name, description, widgets, is_default, created_by) "
        "VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6) RETURNING *",
        org_id, body.name, body.description, json.dumps(body.widgets), body.is_default, user["user_id"],
    )
    return dict(row)


@router.patch("/dashboards/{dash_id}")
async def update_dashboard(
    dash_id: str,
    body: DashboardUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    if body.name is not None:
        vals.append(body.name); updates.append(f"name=${len(vals)}")
    if body.description is not None:
        vals.append(body.description); updates.append(f"description=${len(vals)}")
    if body.widgets is not None:
        vals.append(json.dumps(body.widgets)); updates.append(f"widgets=${len(vals)}::jsonb")
    if body.is_default is not None:
        if body.is_default:
            await pool.execute("UPDATE staging.dristi_dashboards SET is_default=FALSE WHERE org_id=$1::uuid", org_id)
        vals.append(body.is_default); updates.append(f"is_default=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals += [dash_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.dristi_dashboards SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Dashboard not found")
    return dict(row)


@router.delete("/dashboards/{dash_id}")
async def delete_dashboard(
    dash_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.dristi_dashboards SET is_active=FALSE, updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        dash_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Dashboard not found")
    return {"ok": True}


# ── Scheduled Reports ───────────────────────────────────────

class ScheduledReportCreate(BaseModel):
    name: str
    report_type: str = "overview"
    frequency: str = "weekly"
    day_of_week: int | None = None
    day_of_month: int | None = None
    time_utc: str = "08:00"
    file_formats: list[str] = ["pdf"]
    recipients: list[str]
    dashboard_id: str | None = None
    filters: dict = {}


class ScheduledReportUpdate(BaseModel):
    name: str | None = None
    frequency: str | None = None
    day_of_week: int | None = None
    day_of_month: int | None = None
    time_utc: str | None = None
    file_formats: list[str] | None = None
    recipients: list[str] | None = None
    filters: dict | None = None
    is_active: bool | None = None


@router.get("/scheduled-reports", dependencies=[Depends(_gate)])
async def list_scheduled_reports(user=Depends(require_user), org_id=Depends(get_org_id)):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT sr.*, d.name AS dashboard_name "
        "FROM staging.dristi_scheduled_reports sr "
        "LEFT JOIN staging.dristi_dashboards d ON d.id = sr.dashboard_id "
        "WHERE sr.org_id=$1::uuid ORDER BY sr.created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/scheduled-reports", dependencies=[Depends(_gate)])
async def create_scheduled_report(
    body: ScheduledReportCreate,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    valid_types = ("overview", "revenue", "pipeline", "hr", "sales", "custom")
    if body.report_type not in valid_types:
        raise HTTPException(400, f"report_type must be one of: {', '.join(valid_types)}")
    valid_freq = ("daily", "weekly", "monthly")
    if body.frequency not in valid_freq:
        raise HTTPException(400, f"frequency must be one of: {', '.join(valid_freq)}")
    if not body.recipients:
        raise HTTPException(400, "At least one recipient is required")

    row = await pool.fetchrow(
        "INSERT INTO staging.dristi_scheduled_reports "
        "(org_id, dashboard_id, name, report_type, frequency, day_of_week, "
        " day_of_month, time_utc, file_formats, recipients, filters, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) "
        "RETURNING id, name",
        org_id, body.dashboard_id or "", body.name, body.report_type,
        body.frequency, body.day_of_week, body.day_of_month,
        _parse_time(body.time_utc), body.file_formats, body.recipients,
        json.dumps(body.filters), user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/scheduled-reports/{report_id}", dependencies=[Depends(_gate)])
async def update_scheduled_report(
    report_id: str,
    body: ScheduledReportUpdate,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets, params = [], [report_id, org_id]
    idx = 3
    for k, v in updates.items():
        if k == "time_utc":
            sets.append(f"{k}=${idx}::time")
        elif k == "filters":
            sets.append(f"{k}=${idx}::jsonb")
            v = json.dumps(v)
        elif k in ("file_formats", "recipients"):
            sets.append(f"{k}=${idx}")
        else:
            sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    await pool.execute(
        f"UPDATE staging.dristi_scheduled_reports SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/scheduled-reports/{report_id}", dependencies=[Depends(_gate)])
async def delete_scheduled_report(
    report_id: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.dristi_scheduled_reports "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        report_id, org_id,
    )
    return {"status": "deleted"}


@router.post("/scheduled-reports/{report_id}/run-now", dependencies=[Depends(_gate)])
async def run_report_now(
    report_id: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    report = await pool.fetchrow(
        "SELECT * FROM staging.dristi_scheduled_reports "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        report_id, org_id,
    )
    if not report:
        raise HTTPException(404, "Scheduled report not found")

    # Same source check as the export endpoint. Running a report on demand must
    # not reach further than reading it would.
    required = _REPORT_SOURCE_MODULES.get(report["report_type"], set())
    missing = required - await reachable_modules(pool, user["user_id"], org_id, required)
    if missing:
        raise HTTPException(
            403,
            f"This report reads {', '.join(sorted(missing))}, which you do not "
            f"have access to.",
        )

    try:
        data = await _fetch_report_data(pool, org_id, report["report_type"])

        # `services.email_service` does not exist — send_email lives in
        # `email_service` at the backend root. The ImportError was swallowed by
        # the except below, logged as a generic 'failed' report_log row and
        # returned as a 500, so run-now had never sent a report and the logs
        # said nothing about why.
        from email_service import send_email
        # send_email is sync (it threads internally) and its parameters are
        # to_email / subject / html_content. It was called as an awaitable with
        # to= and html=, so even a corrected import would have raised. It is
        # also the single choke point that honours OUTBOUND_MODE, so going
        # through it is what keeps dry runs dry.
        import html as _html

        safe_name = _html.escape(str(report["name"]))
        safe_type = _html.escape(str(report["report_type"]))
        safe_data = _html.escape(json.dumps(data, indent=2, default=str)[:5000])
        for recipient in report["recipients"]:
            send_email(
                to_email=recipient,
                subject=f"Report: {report['name']}",
                html_content=(
                    f"<p>Your scheduled report <strong>{safe_name}</strong> is ready.</p>"
                    f"<p>Report type: {safe_type}</p>"
                    f"<pre>{safe_data}</pre>"
                ),
            )

        await pool.execute(
            "INSERT INTO staging.dristi_report_logs "
            "(scheduled_report_id, status, recipients_count) VALUES ($1::uuid, 'sent', $2)",
            report_id, len(report["recipients"]),
        )
        await pool.execute(
            "UPDATE staging.dristi_scheduled_reports SET last_sent_at=NOW() WHERE id=$1::uuid",
            report_id,
        )
        return {"status": "sent", "recipients": len(report["recipients"])}
    except Exception as e:
        await pool.execute(
            "INSERT INTO staging.dristi_report_logs "
            "(scheduled_report_id, status, error) VALUES ($1::uuid, 'failed', $2)",
            report_id, str(e),
        )
        raise HTTPException(500, f"Report generation failed: {e}")


@router.get("/scheduled-reports/{report_id}/logs", dependencies=[Depends(_gate)])
async def get_report_logs(
    report_id: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    # Logs carry recipient addresses and failure reasons, and are keyed on the
    # report id alone — so any report id in any org returned its delivery history.
    if not await pool.fetchval(
        "SELECT 1 FROM staging.dristi_scheduled_reports WHERE id=$1::uuid AND org_id=$2::uuid",
        report_id, org_id,
    ):
        raise HTTPException(404, "Scheduled report not found")
    rows = await pool.fetch(
        "SELECT * FROM staging.dristi_report_logs "
        "WHERE scheduled_report_id=$1::uuid ORDER BY sent_at DESC LIMIT 50",
        report_id,
    )
    return {"logs": [dict(r) for r in rows]}


def _is_row_list(v) -> bool:
    """True for a list of dicts — the one shape that needs its own table."""
    return isinstance(v, list) and bool(v) and all(isinstance(r, dict) for r in v)


def _csv_cell(v):
    """A spreadsheet-safe scalar.

    asyncpg hands back `Decimal` and timezone-aware `datetime`, and csv falls
    back to `str()` for both. `str(Decimal('311671.60'))` is harmless, but the
    same fallback on a nested structure produced Python source in a cell, and
    `datetime.datetime(2026, 7, 1, 0, 0, tzinfo=...)` is not a date any
    spreadsheet will parse. Numbers go out as numbers and instants as ISO-8601,
    which Excel and Google Sheets both read.
    """
    from datetime import date, datetime
    from decimal import Decimal

    if v is None:
        return ""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (dict, list, tuple, set)):
        # Should be unreachable for a row value now that tables are split out,
        # but a nested blob must never silently become Python source again.
        import json
        return json.dumps(v, default=str)
    return v


@router.get("/exports/{report_type}", dependencies=[Depends(_gate)])
async def export_report(
    report_type: str,
    format: str = "json",
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    valid_types = ("overview", "revenue", "pipeline", "hr", "sales")
    if report_type not in valid_types:
        raise HTTPException(400, f"report_type must be one of: {', '.join(valid_types)}")

    required = _REPORT_SOURCE_MODULES.get(report_type, set())
    missing = required - await reachable_modules(pool, user["user_id"], org_id, required)
    if missing:
        raise HTTPException(
            403,
            f"This export reads {', '.join(sorted(missing))}, which you do not "
            f"have access to.",
        )

    data = await _fetch_report_data(pool, org_id, report_type)

    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        if isinstance(data, list) and data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows([{k: _csv_cell(v) for k, v in row.items()} for row in data])
        elif isinstance(data, dict):
            writer = csv.writer(output)
            # A value here is either a scalar or a list of rows, and the two
            # cannot share a shape. `writerow([k, v])` was used for both, so a
            # list of rows went through str() and landed in ONE cell as Python
            # source: measured live on staging, revenue_export.csv contained
            #   monthly,"[{'month': datetime.datetime(2026, 7, 1, 0, 0, ...),
            #              'total': Decimal('311671.60'), 'count': 6}]"
            # which is not openable as a spreadsheet in any useful sense.
            # pipeline and sales had the same shape; overview and hr looked
            # correct only because every value they carry is a scalar.
            scalars = [(k, v) for k, v in data.items() if not _is_row_list(v)]
            tables = [(k, v) for k, v in data.items() if _is_row_list(v)]
            for k, v in scalars:
                writer.writerow([k, _csv_cell(v)])
            for k, rows in tables:
                # Blank line then a titled block, so several tables can share
                # one file and still be readable. Excel keeps the sections
                # visually separate and a parser can split on the empty row.
                if output.getvalue():
                    writer.writerow([])
                writer.writerow([k])
                headers = list(rows[0].keys())
                writer.writerow(headers)
                for row in rows:
                    writer.writerow([_csv_cell(row.get(h)) for h in headers])
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={report_type}_export.csv"},
        )

    return {"data": data, "format": "json"}


# ── Custom Dashboard / Pivot Query Builder ──────────────────

# `module` is what the source belongs to, and is checked against the caller's
# entitlement before the query runs. Without it the pivot builder was a
# general-purpose reader over eight tables — including the invoice ledger and
# the employee register — behind the `dristi` grant alone.
#
# `soft_delete` records whether the table actually has an `is_active` column
# rather than inferring it. All eight do today, which is why the broken
# always-true check that preceded this never misfired; the next source added
# would have been the one to break.
_ALLOWED_QUERY_TABLES = {
    "invoices": {
        "table": "staging.ganit_invoices",
        "module": "ganit",
        "soft_delete": True,
        "columns": ["invoice_date", "invoice_type", "total", "subtotal", "amount_paid",
                     "payment_status", "currency", "created_at"],
        "date_col": "invoice_date",
    },
    "deals": {
        "table": "staging.graha_deals",
        "module": "graha",
        "soft_delete": True,
        "columns": ["stage", "value", "expected_close", "created_at", "updated_at"],
        "date_col": "created_at",
    },
    "contacts": {
        "table": "staging.graha_contacts",
        "module": "graha",
        "soft_delete": True,
        "columns": ["contact_type", "source", "company", "lead_score", "created_at"],
        "date_col": "created_at",
    },
    "orders": {
        "table": "staging.vikray_orders",
        "module": "vikray",
        "soft_delete": True,
        "columns": ["order_date", "status", "total", "subtotal", "created_at"],
        "date_col": "order_date",
    },
    "employees": {
        "table": "staging.manav_employees",
        "module": "manav",
        "soft_delete": True,
        "columns": ["department", "designation", "employment_type", "status",
                     "date_of_joining", "created_at"],
        "date_col": "date_of_joining",
    },
    "expenses": {
        "table": "staging.ganit_expenses",
        "module": "ganit",
        "soft_delete": True,
        "columns": ["category", "amount", "total", "expense_date", "status", "created_at"],
        "date_col": "expense_date",
    },
    "tickets": {
        "table": "staging.graha_tickets",
        "module": "graha",
        "soft_delete": True,
        "columns": ["priority", "status", "category", "created_at", "resolved_at"],
        "date_col": "created_at",
    },
    "events": {
        "table": "staging.prachar_events",
        "module": "prachar",
        "soft_delete": True,
        "columns": ["event_type", "status", "starts_at", "created_at"],
        "date_col": "starts_at",
    },
}


class PivotQuery(BaseModel):
    source: str
    group_by: str = ""
    #: The COLUMN dimension. A pivot is two-dimensional — the rendered reference
    #: (`ScreensThin.jsx`, `DristiPivot`) draws client × quarter with a total per
    #: row, per column and a grand total. With one dimension the "pivot" tab was
    #: a two-column list, which is what `/query` already served the chart cards.
    #: Validated against the same per-source column whitelist as `group_by`, so
    #: it is never a caller-supplied SQL fragment.
    group_by2: str = ""
    measure: str = "count"
    date_from: str = ""
    date_to: str = ""
    filters: dict = {}


@router.post("/query", dependencies=[Depends(_gate)])
async def run_pivot_query(
    body: PivotQuery,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    spec = _ALLOWED_QUERY_TABLES.get(body.source)
    if not spec:
        raise HTTPException(400, f"source must be one of: {', '.join(_ALLOWED_QUERY_TABLES)}")

    pool = await get_pool()
    source_module = spec["module"]
    if not await reachable_modules(pool, user["user_id"], org_id, {source_module}):
        raise HTTPException(
            403,
            f"'{body.source}' reads the {source_module} module, which you do not "
            f"have access to.",
        )

    table = spec["table"]
    allowed = spec["columns"]

    if body.group_by and body.group_by not in allowed:
        raise HTTPException(400, f"group_by must be one of: {', '.join(allowed)}")
    if body.group_by2 and body.group_by2 not in allowed:
        raise HTTPException(400, f"group_by2 must be one of: {', '.join(allowed)}")
    if body.group_by2 and not body.group_by:
        raise HTTPException(400, "group_by2 requires group_by — columns need rows.")
    if body.group_by2 and body.group_by2 == body.group_by:
        raise HTTPException(400, "group_by and group_by2 must differ.")

    measure_sql = "COUNT(*)"
    if body.measure == "sum" and "total" in allowed:
        measure_sql = "COALESCE(SUM(total),0)"
    elif body.measure == "sum" and "value" in allowed:
        measure_sql = "COALESCE(SUM(value),0)"
    elif body.measure == "avg" and "total" in allowed:
        measure_sql = "COALESCE(AVG(total),0)"
    elif body.measure == "avg" and "value" in allowed:
        measure_sql = "COALESCE(AVG(value),0)"

    where = ["org_id=$1::uuid"]
    params: list = [org_id]

    # This was:
    #     if "is_active" in [c for t in [spec] for c in ["is_active"]]:
    # which is a comprehension over the literal ["is_active"] and so is ALWAYS
    # true — `is_active=TRUE` was appended for every source, including the ones
    # whose table has no such column. The intent was plainly to check the
    # source's own column list, and it is declared per source now.
    if spec.get("soft_delete"):
        where.append("is_active=TRUE")

    date_col = spec.get("date_col", "created_at")
    if body.date_from:
        params.append(body.date_from)
        where.append(f"{date_col} >= ${len(params)}::date")
    if body.date_to:
        params.append(body.date_to)
        where.append(f"{date_col} <= ${len(params)}::date")

    for fk, fv in body.filters.items():
        if fk in allowed:
            params.append(str(fv))
            where.append(f"{fk} = ${len(params)}")

    where_clause = " AND ".join(where)

    if body.group_by and body.group_by2:
        # Both names are whitelist members, never caller text. The cap is on the
        # CELL count rather than the row count: 40 clients x 12 months is 480
        # rows the browser has to pivot, and a cross-tab that wide is unreadable
        # anyway. Ordered by label so the rendered grid is stable between runs.
        rows = await pool.fetch(
            f"SELECT {body.group_by} AS label, {body.group_by2} AS col, "
            f"{measure_sql} AS value "
            f"FROM {table} WHERE {where_clause} "
            f"GROUP BY {body.group_by}, {body.group_by2} "
            f"ORDER BY 1, 2 LIMIT 600",
            *params,
        )
        return {
            "data": [dict(r) for r in rows],
            "source": body.source,
            "measure": body.measure,
            "group_by": body.group_by,
            "group_by2": body.group_by2,
        }

    if body.group_by:
        rows = await pool.fetch(
            f"SELECT {body.group_by} AS label, {measure_sql} AS value "
            f"FROM {table} WHERE {where_clause} "
            f"GROUP BY {body.group_by} ORDER BY value DESC LIMIT 50",
            *params,
        )
        return {"data": [dict(r) for r in rows], "source": body.source, "measure": body.measure}
    else:
        row = await pool.fetchrow(
            f"SELECT {measure_sql} AS value, COUNT(*) AS count FROM {table} WHERE {where_clause}",
            *params,
        )
        return {"data": dict(row) if row else {}, "source": body.source, "measure": body.measure}


@router.get("/widget-types", dependencies=[Depends(_gate)])
async def widget_types(
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    """The pivot builder's vocabulary — only the sources this caller can read.

    Two things this endpoint did not do:

    · It listed every source regardless of entitlement, so the builder offered
      `invoices` and `employees` to someone who gets a 403 the moment they press
      Run. Offering an option that cannot succeed is worse than omitting it.
    · It returned no columns, so the frontend carried its OWN source->columns
      map. The two had already drifted — the copy in `DristiPage.jsx` was
      missing `subtotal`, `amount_paid` and every `created_at`, so those
      groupings were unreachable from the UI although the server allowed them,
      and a column added to the whitelist would never have appeared. The
      whitelist is the only correct source for this list.
    """
    pool = await get_pool()
    reachable = await reachable_modules(
        pool, user["user_id"], org_id,
        {spec["module"] for spec in _ALLOWED_QUERY_TABLES.values()},
    )
    sources = {
        name: {"columns": spec["columns"], "date_col": spec.get("date_col", "created_at")}
        for name, spec in _ALLOWED_QUERY_TABLES.items()
        if spec["module"] in reachable
    }
    return {
        "sources": list(sources.keys()),
        "source_meta": sources,
        "measures": ["count", "sum", "avg"],
        "widget_types": ["number", "bar", "pie", "line", "table"],
        # How many of the eight sources are hidden by entitlement. The builder
        # says so out loud rather than looking like the product only has three.
        "withheld_count": len(_ALLOWED_QUERY_TABLES) - len(sources),
    }
