"""
dristi.py — Dristi · दृष्टि (Analytics) Router
Cross-module KPIs, trends, and saved dashboards.
Reads from all modules: Graha, Ganit, Manav, Vikray, Vetana, tasks.
"""
import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

router = APIRouter(prefix="/api/v1/dristi", tags=["dristi-analytics"])

_gate = require_module("dristi")


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


async def _fetch_report_data(pool, org_id: str, report_type: str) -> dict:
    """Fetch report data by type, reusing the same queries as the GET endpoints."""
    today = date.today()
    month_ago = today - timedelta(days=30)

    if report_type == "overview":
        tasks = await pool.fetchval(
            "SELECT COUNT(*) FROM tasks t JOIN teams tm ON tm.id=t.team_id "
            "JOIN staging.organisations o ON o.team_id=tm.id WHERE o.id=$1::uuid",
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

    tasks_stats = await pool.fetchrow(
        "SELECT COUNT(*) AS total_tasks, "
        "COUNT(*) FILTER (WHERE status='done') AS done_tasks, "
        "COUNT(*) FILTER (WHERE status='in_progress') AS active_tasks, "
        "COUNT(*) FILTER (WHERE due_at < NOW() AND status != 'done') AS overdue_tasks "
        "FROM tasks WHERE team_id IN ("
        "  SELECT team_id FROM teams WHERE deleted_at IS NULL"
        ") AND archived_at IS NULL",
    )

    crm = await pool.fetchrow(
        "SELECT COUNT(*) AS total_contacts, "
        "COUNT(*) FILTER (WHERE contact_type='lead') AS leads, "
        "COUNT(*) FILTER (WHERE contact_type='customer') AS customers "
        "FROM staging.graha_contacts WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    deals = await pool.fetchrow(
        "SELECT COUNT(*) AS total_deals, "
        "COALESCE(SUM(value),0) AS pipeline_value, "
        "COUNT(*) FILTER (WHERE stage='Won') AS won_deals, "
        "COALESCE(SUM(value) FILTER (WHERE stage='Won'),0) AS won_value, "
        "COUNT(*) FILTER (WHERE stage='Lost') AS lost_deals "
        "FROM staging.graha_deals WHERE org_id=$1::uuid",
        org_id,
    )

    revenue = await pool.fetchrow(
        "SELECT COALESCE(SUM(total),0) AS total_invoiced, "
        "COALESCE(SUM(amount_paid),0) AS total_collected, "
        "COALESCE(SUM(total - amount_paid) FILTER (WHERE payment_status NOT IN ('paid','cancelled')),0) AS outstanding "
        "FROM staging.ganit_invoices WHERE org_id=$1::uuid",
        org_id,
    )

    hr = await pool.fetchrow(
        "SELECT COUNT(*) AS headcount, "
        "COUNT(*) FILTER (WHERE department IS NOT NULL AND department != '') AS in_departments "
        "FROM staging.manav_employees WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    orders = await pool.fetchrow(
        "SELECT COUNT(*) AS total_orders, "
        "COALESCE(SUM(total),0) AS order_value, "
        "COUNT(*) FILTER (WHERE status='delivered' OR status='closed') AS fulfilled "
        "FROM staging.vikray_orders WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )

    payroll = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_net),0) AS ytd_payroll, "
        "COALESCE(SUM(total_pf + total_esi + total_tds),0) AS ytd_statutory "
        "FROM staging.vetana_payroll_runs "
        "WHERE org_id=$1::uuid AND month LIKE $2",
        org_id, f"{date.today().year}-%",
    )

    return {
        "tasks": dict(tasks_stats) if tasks_stats else {},
        "crm": dict(crm) if crm else {},
        "deals": dict(deals) if deals else {},
        "revenue": dict(revenue) if revenue else {},
        "hr": dict(hr) if hr else {},
        "orders": dict(orders) if orders else {},
        "payroll": dict(payroll) if payroll else {},
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

    dept_breakdown = await pool.fetch(
        "SELECT COALESCE(NULLIF(e.department,''), 'Unassigned') AS department, COUNT(*) AS count "
        "FROM staging.manav_employees e "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE "
        "GROUP BY e.department ORDER BY count DESC",
        org_id,
    )

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
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7, $8::time, $9, $10, $11::jsonb, $12) "
        "RETURNING id, name",
        org_id, body.dashboard_id or "", body.name, body.report_type,
        body.frequency, body.day_of_week, body.day_of_month,
        body.time_utc, body.file_formats, body.recipients,
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

    try:
        data = await _fetch_report_data(pool, org_id, report["report_type"])

        from services.email_service import send_email
        for recipient in report["recipients"]:
            await send_email(
                to=recipient,
                subject=f"Report: {report['name']}",
                html=f"<p>Your scheduled report <strong>{report['name']}</strong> is ready.</p>"
                     f"<p>Report type: {report['report_type']}</p>"
                     f"<pre>{json.dumps(data, indent=2, default=str)[:5000]}</pre>",
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
    rows = await pool.fetch(
        "SELECT * FROM staging.dristi_report_logs "
        "WHERE scheduled_report_id=$1::uuid ORDER BY sent_at DESC LIMIT 50",
        report_id,
    )
    return {"logs": [dict(r) for r in rows]}


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

    data = await _fetch_report_data(pool, org_id, report_type)

    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        if isinstance(data, list) and data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        elif isinstance(data, dict):
            writer = csv.writer(output)
            for k, v in data.items():
                writer.writerow([k, v])
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={report_type}_export.csv"},
        )

    return {"data": data, "format": "json"}
