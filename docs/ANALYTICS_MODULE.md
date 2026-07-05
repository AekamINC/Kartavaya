# Analytics Module — Implementation Guide

**Platform**: Kartavya (Unified Modular Business Platform for Indian SMBs)
**Module Tier**: Add-on — Analytics Pro at Rs.19/user/mo
**Stack**: React 19 (CRA+CRACO+Tailwind) on Vercel | FastAPI Python 3.13 on Railway | Supabase PostgreSQL (project `efzzjcnpjigeffkiissb`) | Cloudflare R2 (bucket `aekaminc`)
**Repo**: `kevalvshah/Kartavya`
**Auth**: Supabase Auth with `org_id` RLS on every table

---

## 1. Database Migration

**File**: `backend/migrations/014_analytics_module.sql`

```sql
-- ============================================================
-- 014_analytics_module.sql
-- Analytics Module: dashboards, widgets, reports, cache
-- ============================================================

BEGIN;

-- ----------------------------------------------------------
-- 1.1 Core Tables
-- ----------------------------------------------------------

CREATE TABLE analytics_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    layout JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- layout schema: [{widget_id, x, y, w, h}]
    is_default BOOLEAN NOT NULL DEFAULT false,
    module TEXT NOT NULL CHECK (module IN ('crm', 'hrms', 'payroll', 'all')),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboards_org ON analytics_dashboards(org_id);
CREATE INDEX idx_dashboards_module ON analytics_dashboards(org_id, module);

ALTER TABLE analytics_dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_dashboards_org_isolation"
    ON analytics_dashboards
    USING (org_id = (current_setting('app.current_org_id'))::uuid);


CREATE TABLE analytics_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    dashboard_id UUID NOT NULL REFERENCES analytics_dashboards(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'metric_card', 'line_chart', 'bar_chart', 'pie_chart',
        'table', 'funnel', 'heatmap'
    )),
    title TEXT NOT NULL,
    data_source TEXT NOT NULL,
    -- data_source: table or view name, e.g. 'crm_deals', 'mv_crm_pipeline_summary'
    query_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- query_config schema:
    -- {
    --   "metrics": ["deal_count", "total_value"],
    --   "dimensions": ["stage", "owner"],
    --   "filters": [{"field": "created_at", "op": "gte", "value": "2026-01-01"}],
    --   "time_range": "last_30_days",
    --   "aggregation": "sum"   -- sum | avg | count | min | max
    -- }
    position JSONB NOT NULL DEFAULT '{"x":0,"y":0,"w":6,"h":4}'::jsonb,
    -- position schema: {x, y, w, h} for a 12-column grid
    refresh_interval_seconds INT NOT NULL DEFAULT 300,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_widgets_dashboard ON analytics_widgets(dashboard_id);
CREATE INDEX idx_widgets_org ON analytics_widgets(org_id);

ALTER TABLE analytics_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_widgets_org_isolation"
    ON analytics_widgets
    USING (org_id = (current_setting('app.current_org_id'))::uuid);


CREATE TABLE analytics_saved_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    module TEXT NOT NULL CHECK (module IN ('crm', 'hrms', 'payroll', 'all')),
    query_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    schedule TEXT NOT NULL DEFAULT 'none' CHECK (schedule IN ('none', 'daily', 'weekly', 'monthly')),
    recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- recipients: ["user-uuid-1", "user-uuid-2"] or ["email@example.com"]
    last_run_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_org ON analytics_saved_reports(org_id);
CREATE INDEX idx_reports_schedule ON analytics_saved_reports(schedule)
    WHERE schedule != 'none';

ALTER TABLE analytics_saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_reports_org_isolation"
    ON analytics_saved_reports
    USING (org_id = (current_setting('app.current_org_id'))::uuid);


CREATE TABLE analytics_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    cache_key TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (org_id, cache_key)
);

CREATE INDEX idx_cache_lookup ON analytics_cache(org_id, cache_key);
CREATE INDEX idx_cache_expiry ON analytics_cache(expires_at);

ALTER TABLE analytics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_cache_org_isolation"
    ON analytics_cache
    USING (org_id = (current_setting('app.current_org_id'))::uuid);


-- ----------------------------------------------------------
-- 1.2 Materialized Views
-- ----------------------------------------------------------

-- CRM Pipeline Summary
CREATE MATERIALIZED VIEW mv_crm_pipeline_summary AS
SELECT
    p.org_id,
    p.id AS pipeline_id,
    p.name AS pipeline_name,
    s.name AS stage,
    s.position AS stage_position,
    COUNT(d.id) AS deal_count,
    COALESCE(SUM(d.value), 0) AS total_value,
    COALESCE(AVG(d.value), 0) AS avg_deal_size,
    COALESCE(
        AVG(EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 86400),
        0
    ) AS avg_days_in_stage
FROM crm_pipelines p
JOIN crm_pipeline_stages s ON s.pipeline_id = p.id
LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.is_deleted = false
GROUP BY p.org_id, p.id, p.name, s.name, s.position;

CREATE UNIQUE INDEX idx_mv_crm_pipeline
    ON mv_crm_pipeline_summary(pipeline_id, stage);


-- Monthly Attendance Summary
CREATE MATERIALIZED VIEW mv_attendance_monthly AS
SELECT
    a.org_id,
    a.employee_id,
    EXTRACT(MONTH FROM a.date)::int AS month,
    EXTRACT(YEAR FROM a.date)::int AS year,
    COUNT(*) FILTER (WHERE a.status = 'present') AS present_days,
    COUNT(*) FILTER (WHERE a.status = 'absent') AS absent_days,
    COUNT(*) FILTER (WHERE a.check_in > a.expected_check_in + INTERVAL '15 minutes') AS late_count,
    COALESCE(
        AVG(EXTRACT(EPOCH FROM (a.check_out - a.check_in)) / 3600),
        0
    ) AS avg_hours,
    COALESCE(
        SUM(GREATEST(
            EXTRACT(EPOCH FROM (a.check_out - a.check_in)) / 3600 - 8,
            0
        )),
        0
    ) AS overtime_hours
FROM hrms_attendance a
GROUP BY a.org_id, a.employee_id,
         EXTRACT(MONTH FROM a.date), EXTRACT(YEAR FROM a.date);

CREATE UNIQUE INDEX idx_mv_attendance_monthly
    ON mv_attendance_monthly(org_id, employee_id, year, month);


-- Monthly Payroll Summary
CREATE MATERIALIZED VIEW mv_payroll_monthly AS
SELECT
    pr.org_id,
    EXTRACT(MONTH FROM pr.pay_period_start)::int AS month,
    EXTRACT(YEAR FROM pr.pay_period_start)::int AS year,
    SUM(pr.gross_salary) AS total_gross,
    SUM(pr.net_salary) AS total_net,
    SUM(pr.pf_amount) AS total_pf,
    SUM(pr.esi_amount) AS total_esi,
    SUM(pr.tds_amount) AS total_tds,
    COUNT(DISTINCT pr.employee_id) AS employee_count
FROM payroll_runs pr
WHERE pr.status = 'completed'
GROUP BY pr.org_id,
         EXTRACT(MONTH FROM pr.pay_period_start),
         EXTRACT(YEAR FROM pr.pay_period_start);

CREATE UNIQUE INDEX idx_mv_payroll_monthly
    ON mv_payroll_monthly(org_id, year, month);


-- Monthly Revenue Summary
CREATE MATERIALIZED VIEW mv_revenue_monthly AS
SELECT
    i.org_id,
    EXTRACT(MONTH FROM i.invoice_date)::int AS month,
    EXTRACT(YEAR FROM i.invoice_date)::int AS year,
    SUM(i.total_amount) AS invoiced_amount,
    SUM(i.paid_amount) AS collected_amount,
    SUM(i.total_amount - i.paid_amount) AS outstanding_amount
FROM invoices i
WHERE i.is_deleted = false
GROUP BY i.org_id,
         EXTRACT(MONTH FROM i.invoice_date),
         EXTRACT(YEAR FROM i.invoice_date);

CREATE UNIQUE INDEX idx_mv_revenue_monthly
    ON mv_revenue_monthly(org_id, year, month);


-- ----------------------------------------------------------
-- 1.3 Materialized View Refresh
-- ----------------------------------------------------------

-- Scheduled refresh function (call via pg_cron or Supabase cron)
CREATE OR REPLACE FUNCTION refresh_analytics_materialized_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_pipeline_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_attendance_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_payroll_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_monthly;
END;
$$;

-- Schedule via Supabase pg_cron (runs every 15 minutes)
-- Execute this in the Supabase SQL editor after enabling pg_cron:
--
--   SELECT cron.schedule(
--       'refresh-analytics-mvs',
--       '*/15 * * * *',
--       $$ SELECT refresh_analytics_materialized_views(); $$
--   );

-- On-demand refresh endpoint will also call this function directly.


-- ----------------------------------------------------------
-- 1.4 Updated-at Trigger
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dashboards_updated_at
    BEFORE UPDATE ON analytics_dashboards
    FOR EACH ROW EXECUTE FUNCTION analytics_set_updated_at();

CREATE TRIGGER trg_widgets_updated_at
    BEFORE UPDATE ON analytics_widgets
    FOR EACH ROW EXECUTE FUNCTION analytics_set_updated_at();

CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON analytics_saved_reports
    FOR EACH ROW EXECUTE FUNCTION analytics_set_updated_at();


-- ----------------------------------------------------------
-- 1.5 Cache Cleanup Function
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_cleanup_expired_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    DELETE FROM analytics_cache WHERE expires_at < now();
$$;

-- Schedule cache cleanup every hour:
--   SELECT cron.schedule('analytics-cache-cleanup', '0 * * * *',
--       $$ SELECT analytics_cleanup_expired_cache(); $$);

COMMIT;
```

---

## 2. Backend Router

**File**: `backend/routers/analytics.py`

### 2.1 Query Builder (Safe Ad-hoc Queries)

```python
# backend/services/analytics_query_builder.py

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel, field_validator


# --- Whitelist of allowed data sources and columns per module ---

ALLOWED_DATA_SOURCES: dict[str, dict[str, list[str]]] = {
    "crm": {
        "crm_deals": [
            "id", "name", "value", "stage_id", "owner_id", "status",
            "created_at", "updated_at", "closed_at", "expected_close_date",
            "lead_source", "probability",
        ],
        "crm_contacts": [
            "id", "name", "email", "phone", "company", "created_at",
        ],
        "crm_activities": [
            "id", "type", "deal_id", "contact_id", "user_id", "created_at",
        ],
        "mv_crm_pipeline_summary": [
            "pipeline_id", "pipeline_name", "stage", "stage_position",
            "deal_count", "total_value", "avg_deal_size", "avg_days_in_stage",
        ],
    },
    "hrms": {
        "hrms_employees": [
            "id", "name", "department_id", "designation", "status",
            "date_of_joining", "date_of_leaving",
        ],
        "hrms_attendance": [
            "id", "employee_id", "date", "status", "check_in", "check_out",
        ],
        "hrms_leave_requests": [
            "id", "employee_id", "leave_type", "start_date", "end_date",
            "status", "days",
        ],
        "mv_attendance_monthly": [
            "employee_id", "month", "year", "present_days", "absent_days",
            "late_count", "avg_hours", "overtime_hours",
        ],
    },
    "payroll": {
        "payroll_runs": [
            "id", "employee_id", "gross_salary", "net_salary", "pf_amount",
            "esi_amount", "tds_amount", "status", "pay_period_start",
            "pay_period_end",
        ],
        "mv_payroll_monthly": [
            "month", "year", "total_gross", "total_net", "total_pf",
            "total_esi", "total_tds", "employee_count",
        ],
        "mv_revenue_monthly": [
            "month", "year", "invoiced_amount", "collected_amount",
            "outstanding_amount",
        ],
    },
}

ALLOWED_OPERATORS = {"eq", "neq", "gt", "gte", "lt", "lte", "in", "like"}
ALLOWED_AGGREGATIONS = {"sum", "avg", "count", "min", "max"}

OPERATOR_SQL = {
    "eq": "=",
    "neq": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "like": "LIKE",
}

TIME_RANGE_MAP = {
    "today": 0,
    "last_7_days": 7,
    "last_30_days": 30,
    "last_90_days": 90,
    "last_365_days": 365,
    "this_month": "month",
    "this_quarter": "quarter",
    "this_year": "year",
}


class QueryFilter(BaseModel):
    field: str
    op: str
    value: Any

    @field_validator("op")
    @classmethod
    def validate_op(cls, v: str) -> str:
        if v not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator '{v}' not allowed. Use: {ALLOWED_OPERATORS}")
        return v


class QueryConfig(BaseModel):
    module: str
    data_source: str | None = None
    metrics: list[str] = []
    dimensions: list[str] = []
    filters: list[QueryFilter] = []
    time_range: str | None = None
    aggregation: str = "sum"
    limit: int = 1000
    offset: int = 0

    @field_validator("aggregation")
    @classmethod
    def validate_aggregation(cls, v: str) -> str:
        if v not in ALLOWED_AGGREGATIONS:
            raise ValueError(f"Aggregation '{v}' not allowed. Use: {ALLOWED_AGGREGATIONS}")
        return v

    @field_validator("limit")
    @classmethod
    def validate_limit(cls, v: int) -> int:
        return min(max(v, 1), 10000)


def _validate_identifier(name: str) -> str:
    """Reject anything that is not a plain column/table name."""
    if not re.match(r"^[a-z_][a-z0-9_]*$", name):
        raise ValueError(f"Invalid identifier: {name}")
    return name


def _resolve_data_source(config: QueryConfig) -> tuple[str, list[str]]:
    """Return (table_name, allowed_columns) for the query."""
    module_sources = ALLOWED_DATA_SOURCES.get(config.module)
    if module_sources is None:
        raise ValueError(f"Unknown module: {config.module}")

    if config.data_source:
        src = _validate_identifier(config.data_source)
        if src not in module_sources:
            raise ValueError(
                f"Data source '{src}' not allowed for module '{config.module}'"
            )
        return src, module_sources[src]

    # Default to the first table for the module
    first_src = next(iter(module_sources))
    return first_src, module_sources[first_src]


def _time_range_clause(
    time_range: str, time_col: str, params: dict[str, Any]
) -> str | None:
    """Return a WHERE clause fragment for the time range."""
    spec = TIME_RANGE_MAP.get(time_range)
    if spec is None:
        return None

    if isinstance(spec, int):
        params["__time_start"] = datetime.utcnow() - timedelta(days=spec)
        return f"{time_col} >= :__time_start"

    # 'month', 'quarter', 'year' — use date_trunc
    params["__time_start"] = datetime.utcnow()
    return f"{time_col} >= date_trunc('{spec}', CAST(:__time_start AS timestamptz))"


def build_query(config: QueryConfig, org_id: str) -> tuple[str, dict[str, Any]]:
    """
    Build a parameterized SQL query from a QueryConfig.

    Returns (sql_string_with_named_params, param_dict).
    All identifiers are validated against the whitelist.
    All values are parameterized — never interpolated.
    """
    table, allowed_cols = _resolve_data_source(config)

    # Validate requested columns
    for col in config.metrics + config.dimensions:
        col = _validate_identifier(col)
        if col not in allowed_cols:
            raise ValueError(f"Column '{col}' not allowed on '{table}'")

    params: dict[str, Any] = {"org_id": org_id}

    # SELECT clause
    select_parts: list[str] = []
    for dim in config.dimensions:
        select_parts.append(_validate_identifier(dim))
    for metric in config.metrics:
        m = _validate_identifier(metric)
        agg = config.aggregation.upper()
        select_parts.append(f"{agg}({m}) AS {m}")

    if not select_parts:
        select_parts = ["*"]

    select_clause = ", ".join(select_parts)

    # WHERE clause
    where_parts: list[str] = ["org_id = :org_id"]

    for i, f in enumerate(config.filters):
        col = _validate_identifier(f.field)
        if col not in allowed_cols:
            raise ValueError(f"Filter column '{col}' not allowed on '{table}'")

        param_key = f"__f{i}"

        if f.op == "in":
            if not isinstance(f.value, list):
                raise ValueError("'in' operator requires a list value")
            in_keys = []
            for j, v in enumerate(f.value):
                k = f"{param_key}_{j}"
                params[k] = v
                in_keys.append(f":{k}")
            where_parts.append(f"{col} IN ({', '.join(in_keys)})")
        else:
            params[param_key] = f.value
            sql_op = OPERATOR_SQL[f.op]
            where_parts.append(f"{col} {sql_op} :{param_key}")

    # Time range
    time_col = "created_at"  # default; override for MVs
    if table.startswith("mv_"):
        time_col = None  # MVs use month/year, not created_at
    if config.time_range and time_col:
        tr_clause = _time_range_clause(config.time_range, time_col, params)
        if tr_clause:
            where_parts.append(tr_clause)

    where_clause = " AND ".join(where_parts)

    # GROUP BY
    group_clause = ""
    if config.dimensions and config.metrics:
        group_clause = "GROUP BY " + ", ".join(
            _validate_identifier(d) for d in config.dimensions
        )

    # Assemble
    sql = f"""
        SELECT {select_clause}
        FROM {table}
        WHERE {where_clause}
        {group_clause}
        LIMIT :__limit OFFSET :__offset
    """.strip()

    params["__limit"] = config.limit
    params["__offset"] = config.offset

    return sql, params
```

### 2.2 Router

```python
# backend/routers/analytics.py

from __future__ import annotations

import csv
import io
import hashlib
import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from backend.auth import get_current_user, get_org_id
from backend.database import get_db
from backend.services.analytics_query_builder import QueryConfig, build_query
from backend.services.module_access import require_module

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


# ----- Pydantic Schemas -----

class DashboardCreate(BaseModel):
    name: str
    description: str | None = None
    layout: list[dict[str, Any]] = []
    is_default: bool = False
    module: str = "all"  # crm | hrms | payroll | all


class WidgetCreate(BaseModel):
    dashboard_id: UUID
    type: str  # metric_card | line_chart | bar_chart | pie_chart | table | funnel | heatmap
    title: str
    data_source: str
    query_config: dict[str, Any] = {}
    position: dict[str, int] = {"x": 0, "y": 0, "w": 6, "h": 4}
    refresh_interval_seconds: int = 300


class WidgetUpdate(BaseModel):
    title: str | None = None
    query_config: dict[str, Any] | None = None
    position: dict[str, int] | None = None
    refresh_interval_seconds: int | None = None


class AdHocQuery(BaseModel):
    module: str
    data_source: str | None = None
    metrics: list[str] = []
    dimensions: list[str] = []
    filters: list[dict[str, Any]] = []
    time_range: str | None = None
    aggregation: str = "sum"
    limit: int = 1000
    offset: int = 0


class ReportExport(BaseModel):
    report_id: UUID | None = None
    query_config: dict[str, Any] | None = None
    format: str = "csv"  # csv | xlsx | pdf


class ReportSchedule(BaseModel):
    name: str
    module: str
    query_config: dict[str, Any]
    schedule: str  # none | daily | weekly | monthly
    recipients: list[str]  # user_ids or email addresses


# ----- Helpers -----

def _cache_key(org_id: str, prefix: str, params: dict) -> str:
    raw = f"{org_id}:{prefix}:{json.dumps(params, sort_keys=True, default=str)}"
    return hashlib.sha256(raw.encode()).hexdigest()


async def _get_cached(db, org_id: str, key: str) -> dict | None:
    row = await db.fetchrow(
        """
        SELECT data FROM analytics_cache
        WHERE org_id = $1 AND cache_key = $2 AND expires_at > now()
        """,
        org_id, key,
    )
    return dict(row["data"]) if row else None


async def _set_cache(db, org_id: str, key: str, data: dict, ttl_seconds: int = 300):
    await db.execute(
        """
        INSERT INTO analytics_cache (org_id, cache_key, data, computed_at, expires_at)
        VALUES ($1, $2, $3, now(), now() + make_interval(secs => $4))
        ON CONFLICT (org_id, cache_key)
        DO UPDATE SET data = $3, computed_at = now(),
                      expires_at = now() + make_interval(secs => $4)
        """,
        org_id, key, json.dumps(data), ttl_seconds,
    )


# ----- Dashboard CRUD -----

@router.get("/dashboards")
async def list_dashboards(
    module: str | None = Query(None),
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    user=Depends(require_module("analytics")),
):
    """List all dashboards for the current org, optionally filtered by module."""
    query = "SELECT * FROM analytics_dashboards WHERE org_id = $1"
    args = [org_id]

    if module:
        query += " AND module = $2"
        args.append(module)

    query += " ORDER BY is_default DESC, created_at DESC"
    rows = await db.fetch(query, *args)
    return [dict(r) for r in rows]


@router.post("/dashboards", status_code=201)
async def create_dashboard(
    body: DashboardCreate,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    user=Depends(get_current_user),
    _=Depends(require_module("analytics")),
):
    """Create a custom dashboard."""
    row = await db.fetchrow(
        """
        INSERT INTO analytics_dashboards (org_id, name, description, layout, is_default, module, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        org_id, body.name, body.description, json.dumps(body.layout),
        body.is_default, body.module, user["id"],
    )
    return dict(row)


@router.get("/dashboards/{dashboard_id}")
async def get_dashboard(
    dashboard_id: UUID,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """Get a dashboard with all its widgets and their latest data."""
    dashboard = await db.fetchrow(
        "SELECT * FROM analytics_dashboards WHERE id = $1 AND org_id = $2",
        str(dashboard_id), org_id,
    )
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widgets = await db.fetch(
        "SELECT * FROM analytics_widgets WHERE dashboard_id = $1 AND org_id = $2 ORDER BY position->>'y', position->>'x'",
        str(dashboard_id), org_id,
    )

    widget_list = []
    for w in widgets:
        w_dict = dict(w)
        # Attempt to load cached data for each widget
        ck = _cache_key(org_id, f"widget:{w_dict['id']}", w_dict.get("query_config", {}))
        cached = await _get_cached(db, org_id, ck)
        w_dict["data"] = cached  # None if not cached; frontend will trigger fetch
        widget_list.append(w_dict)

    result = dict(dashboard)
    result["widgets"] = widget_list
    return result


# ----- Widget CRUD -----

@router.post("/widgets", status_code=201)
async def create_widget(
    body: WidgetCreate,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """Add a widget to a dashboard."""
    # Verify the dashboard belongs to this org
    dash = await db.fetchrow(
        "SELECT id FROM analytics_dashboards WHERE id = $1 AND org_id = $2",
        str(body.dashboard_id), org_id,
    )
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    row = await db.fetchrow(
        """
        INSERT INTO analytics_widgets
            (org_id, dashboard_id, type, title, data_source, query_config, position, refresh_interval_seconds)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        """,
        org_id, str(body.dashboard_id), body.type, body.title,
        body.data_source, json.dumps(body.query_config),
        json.dumps(body.position), body.refresh_interval_seconds,
    )
    return dict(row)


@router.patch("/widgets/{widget_id}")
async def update_widget(
    widget_id: UUID,
    body: WidgetUpdate,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """Update a widget's config, position, or refresh interval."""
    updates = []
    args = []
    idx = 3  # $1 = widget_id, $2 = org_id

    if body.title is not None:
        updates.append(f"title = ${idx}")
        args.append(body.title)
        idx += 1
    if body.query_config is not None:
        updates.append(f"query_config = ${idx}")
        args.append(json.dumps(body.query_config))
        idx += 1
    if body.position is not None:
        updates.append(f"position = ${idx}")
        args.append(json.dumps(body.position))
        idx += 1
    if body.refresh_interval_seconds is not None:
        updates.append(f"refresh_interval_seconds = ${idx}")
        args.append(body.refresh_interval_seconds)
        idx += 1

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    row = await db.fetchrow(
        f"""
        UPDATE analytics_widgets
        SET {', '.join(updates)}
        WHERE id = $1 AND org_id = $2
        RETURNING *
        """,
        str(widget_id), org_id, *args,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Widget not found")
    return dict(row)


# ----- Ad-hoc Query -----

@router.get("/query")
async def adhoc_query(
    module: str,
    metrics: str = Query("", description="Comma-separated metric columns"),
    dimensions: str = Query("", description="Comma-separated dimension columns"),
    filters: str = Query("[]", description="JSON array of filter objects"),
    time_range: str | None = None,
    aggregation: str = "sum",
    data_source: str | None = None,
    limit: int = 1000,
    offset: int = 0,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """
    Ad-hoc query endpoint. Accepts module, metrics, dimensions, filters,
    time_range and builds a safe parameterized SQL query.

    Example:
        GET /api/v1/analytics/query?module=crm&metrics=deal_count,total_value
            &dimensions=stage&time_range=last_30_days
    """
    config = QueryConfig(
        module=module,
        data_source=data_source,
        metrics=[m.strip() for m in metrics.split(",") if m.strip()],
        dimensions=[d.strip() for d in dimensions.split(",") if d.strip()],
        filters=json.loads(filters),
        time_range=time_range,
        aggregation=aggregation,
        limit=limit,
        offset=offset,
    )

    # Check cache first
    ck = _cache_key(org_id, "adhoc", config.model_dump())
    cached = await _get_cached(db, org_id, ck)
    if cached:
        return {"data": cached, "cached": True}

    sql, params = build_query(config, org_id)
    rows = await db.fetch(sql, *params.values())
    data = [dict(r) for r in rows]

    # Cache for 5 minutes
    await _set_cache(db, org_id, ck, data, ttl_seconds=300)

    return {"data": data, "cached": False}


# ----- Pre-built Reports -----

@router.get("/reports/crm-summary")
async def crm_summary(
    time_range: str = "last_30_days",
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """
    Pre-built CRM summary: pipeline value, conversion rates,
    top deals, activity metrics.
    """
    ck = _cache_key(org_id, "crm_summary", {"time_range": time_range})
    cached = await _get_cached(db, org_id, ck)
    if cached:
        return cached

    # Pipeline summary from materialized view
    pipeline = await db.fetch(
        "SELECT * FROM mv_crm_pipeline_summary WHERE org_id = $1 ORDER BY stage_position",
        org_id,
    )

    # Conversion rate: deals won / total deals
    conversion = await db.fetchrow(
        """
        SELECT
            COUNT(*) AS total_deals,
            COUNT(*) FILTER (WHERE status = 'won') AS won_deals,
            CASE WHEN COUNT(*) > 0
                THEN ROUND(COUNT(*) FILTER (WHERE status = 'won')::numeric / COUNT(*) * 100, 1)
                ELSE 0
            END AS conversion_rate
        FROM crm_deals
        WHERE org_id = $1 AND is_deleted = false
        """,
        org_id,
    )

    # Top 10 deals by value
    top_deals = await db.fetch(
        """
        SELECT id, name, value, status, created_at
        FROM crm_deals
        WHERE org_id = $1 AND is_deleted = false
        ORDER BY value DESC NULLS LAST
        LIMIT 10
        """,
        org_id,
    )

    # Activity counts by type
    activities = await db.fetch(
        """
        SELECT type, COUNT(*) AS count
        FROM crm_activities
        WHERE org_id = $1
        GROUP BY type
        ORDER BY count DESC
        """,
        org_id,
    )

    result = {
        "pipeline": [dict(r) for r in pipeline],
        "conversion": dict(conversion) if conversion else {},
        "top_deals": [dict(r) for r in top_deals],
        "activities": [dict(r) for r in activities],
    }

    await _set_cache(db, org_id, ck, result, ttl_seconds=600)
    return result


@router.get("/reports/hr-summary")
async def hr_summary(
    time_range: str = "this_month",
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """
    Pre-built HR summary: headcount, attendance rate, leave utilization,
    department breakdown.
    """
    ck = _cache_key(org_id, "hr_summary", {"time_range": time_range})
    cached = await _get_cached(db, org_id, ck)
    if cached:
        return cached

    headcount = await db.fetchrow(
        """
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'active') AS active,
            COUNT(*) FILTER (WHERE date_of_joining >= date_trunc('month', now())) AS new_this_month
        FROM hrms_employees WHERE org_id = $1
        """,
        org_id,
    )

    attendance = await db.fetch(
        """
        SELECT month, year,
               SUM(present_days) AS present, SUM(absent_days) AS absent,
               SUM(late_count) AS late, AVG(avg_hours) AS avg_hours
        FROM mv_attendance_monthly
        WHERE org_id = $1
        GROUP BY month, year
        ORDER BY year DESC, month DESC
        LIMIT 12
        """,
        org_id,
    )

    department_breakdown = await db.fetch(
        """
        SELECT d.name AS department, COUNT(e.id) AS count
        FROM hrms_employees e
        JOIN departments d ON d.id = e.department_id
        WHERE e.org_id = $1 AND e.status = 'active'
        GROUP BY d.name
        ORDER BY count DESC
        """,
        org_id,
    )

    leave_util = await db.fetch(
        """
        SELECT leave_type, COUNT(*) AS requests,
               SUM(days) AS total_days,
               COUNT(*) FILTER (WHERE status = 'approved') AS approved
        FROM hrms_leave_requests
        WHERE org_id = $1
        GROUP BY leave_type
        """,
        org_id,
    )

    result = {
        "headcount": dict(headcount) if headcount else {},
        "attendance_trend": [dict(r) for r in attendance],
        "department_breakdown": [dict(r) for r in department_breakdown],
        "leave_utilization": [dict(r) for r in leave_util],
    }

    await _set_cache(db, org_id, ck, result, ttl_seconds=600)
    return result


@router.get("/reports/payroll-summary")
async def payroll_summary(
    time_range: str = "this_month",
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """
    Pre-built Payroll summary: monthly cost, PF/ESI totals,
    department-wise cost.
    """
    ck = _cache_key(org_id, "payroll_summary", {"time_range": time_range})
    cached = await _get_cached(db, org_id, ck)
    if cached:
        return cached

    monthly = await db.fetch(
        """
        SELECT * FROM mv_payroll_monthly
        WHERE org_id = $1
        ORDER BY year DESC, month DESC
        LIMIT 12
        """,
        org_id,
    )

    dept_cost = await db.fetch(
        """
        SELECT d.name AS department,
               SUM(pr.gross_salary) AS gross,
               SUM(pr.net_salary) AS net,
               COUNT(DISTINCT pr.employee_id) AS headcount
        FROM payroll_runs pr
        JOIN hrms_employees e ON e.id = pr.employee_id
        JOIN departments d ON d.id = e.department_id
        WHERE pr.org_id = $1 AND pr.status = 'completed'
        GROUP BY d.name
        ORDER BY gross DESC
        """,
        org_id,
    )

    # CTC distribution for histogram
    ctc_dist = await db.fetch(
        """
        SELECT
            CASE
                WHEN gross_salary < 25000 THEN 'Under 25K'
                WHEN gross_salary < 50000 THEN '25K-50K'
                WHEN gross_salary < 100000 THEN '50K-1L'
                WHEN gross_salary < 200000 THEN '1L-2L'
                ELSE 'Above 2L'
            END AS bracket,
            COUNT(*) AS count
        FROM payroll_runs pr
        WHERE org_id = $1 AND status = 'completed'
            AND pay_period_start >= date_trunc('month', now())
        GROUP BY bracket
        ORDER BY MIN(gross_salary)
        """,
        org_id,
    )

    result = {
        "monthly_trend": [dict(r) for r in monthly],
        "department_cost": [dict(r) for r in dept_cost],
        "ctc_distribution": [dict(r) for r in ctc_dist],
    }

    await _set_cache(db, org_id, ck, result, ttl_seconds=600)
    return result


# ----- Export -----

@router.post("/reports/export")
async def export_report(
    body: ReportExport,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    _=Depends(require_module("analytics")),
):
    """Export report data as CSV, XLSX, or PDF."""
    # Resolve the data: either from a saved report or from an ad-hoc query_config
    if body.report_id:
        report = await db.fetchrow(
            "SELECT * FROM analytics_saved_reports WHERE id = $1 AND org_id = $2",
            str(body.report_id), org_id,
        )
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        config_raw = report["query_config"]
    elif body.query_config:
        config_raw = body.query_config
    else:
        raise HTTPException(status_code=400, detail="Provide report_id or query_config")

    config = QueryConfig(**config_raw)
    sql, params = build_query(config, org_id)
    rows = await db.fetch(sql, *params.values())
    data = [dict(r) for r in rows]

    if not data:
        raise HTTPException(status_code=404, detail="No data to export")

    if body.format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=report.csv"},
        )

    elif body.format == "xlsx":
        # Use openpyxl for Excel export
        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Report"

        headers = list(data[0].keys())
        ws.append(headers)
        for row in data:
            ws.append([row.get(h) for h in headers])

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=report.xlsx"},
        )

    elif body.format == "pdf":
        # Use reportlab for PDF export
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
        from reportlab.lib import colors

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4))
        headers = list(data[0].keys())
        table_data = [headers] + [[str(row.get(h, "")) for h in headers] for row in data]
        table = Table(table_data)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a56db")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
        ]))
        doc.build([table])
        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=report.pdf"},
        )

    raise HTTPException(status_code=400, detail=f"Unsupported format: {body.format}")


# ----- Report Scheduling -----

@router.post("/reports/schedule", status_code=201)
async def schedule_report(
    body: ReportSchedule,
    db=Depends(get_db),
    org_id: str = Depends(get_org_id),
    user=Depends(get_current_user),
    _=Depends(require_module("analytics")),
):
    """Schedule a recurring report to be emailed to recipients."""
    row = await db.fetchrow(
        """
        INSERT INTO analytics_saved_reports
            (org_id, name, module, query_config, schedule, recipients, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        org_id, body.name, body.module, json.dumps(body.query_config),
        body.schedule, json.dumps(body.recipients), user["id"],
    )
    return dict(row)
```

### 2.3 Report Runner (Background Worker)

```python
# backend/workers/report_scheduler.py

"""
Background worker that runs scheduled reports and emails results.
Deploy as a separate Railway service or use APScheduler within the main app.
"""

import asyncio
import json
from datetime import datetime

from backend.database import get_db_pool
from backend.services.analytics_query_builder import QueryConfig, build_query
from backend.services.email import send_email_with_attachment


async def run_due_reports():
    """Find and execute all reports that are due for delivery."""
    pool = await get_db_pool()
    async with pool.acquire() as db:
        # Daily reports: run every day
        # Weekly reports: run on Mondays
        # Monthly reports: run on the 1st
        now = datetime.utcnow()
        weekday = now.weekday()  # 0 = Monday
        day = now.day

        schedules = ["daily"]
        if weekday == 0:
            schedules.append("weekly")
        if day == 1:
            schedules.append("monthly")

        reports = await db.fetch(
            """
            SELECT * FROM analytics_saved_reports
            WHERE schedule = ANY($1)
              AND (last_run_at IS NULL OR last_run_at < date_trunc('day', now()))
            """,
            schedules,
        )

        for report in reports:
            try:
                config = QueryConfig(**report["query_config"])
                sql, params = build_query(config, str(report["org_id"]))
                rows = await db.fetch(sql, *params.values())
                data = [dict(r) for r in rows]

                # Generate CSV attachment
                if data:
                    import csv, io
                    buf = io.StringIO()
                    writer = csv.DictWriter(buf, fieldnames=data[0].keys())
                    writer.writeheader()
                    writer.writerows(data)
                    csv_content = buf.getvalue()
                else:
                    csv_content = "No data for this period."

                recipients = json.loads(report["recipients"]) if isinstance(report["recipients"], str) else report["recipients"]

                for recipient in recipients:
                    await send_email_with_attachment(
                        to=recipient,
                        subject=f"Kartavya Report: {report['name']}",
                        body=f"Attached is your scheduled report '{report['name']}' generated on {now.strftime('%d %b %Y')}.",
                        attachment_name=f"{report['name'].replace(' ', '_')}.csv",
                        attachment_content=csv_content,
                    )

                await db.execute(
                    "UPDATE analytics_saved_reports SET last_run_at = now() WHERE id = $1",
                    report["id"],
                )

            except Exception as e:
                print(f"Error running report {report['id']}: {e}")


if __name__ == "__main__":
    asyncio.run(run_due_reports())
```

Register the router in `backend/main.py`:

```python
from backend.routers import analytics

app.include_router(analytics.router)
```

---

## 3. Frontend Components

### 3.1 Hooks

```javascript
// src/hooks/useAnalytics.js

import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import api from '../lib/api';

export function useAnalytics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runQuery = useCallback(async (queryConfig) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        module: queryConfig.module,
        metrics: (queryConfig.metrics || []).join(','),
        dimensions: (queryConfig.dimensions || []).join(','),
        filters: JSON.stringify(queryConfig.filters || []),
        time_range: queryConfig.time_range || '',
        aggregation: queryConfig.aggregation || 'sum',
        ...(queryConfig.data_source && { data_source: queryConfig.data_source }),
      });
      const res = await api.get(`/analytics/query?${params}`);
      return res.data;
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getCrmSummary = useCallback(async (timeRange = 'last_30_days') => {
    const res = await api.get(`/analytics/reports/crm-summary?time_range=${timeRange}`);
    return res.data;
  }, []);

  const getHrSummary = useCallback(async (timeRange = 'this_month') => {
    const res = await api.get(`/analytics/reports/hr-summary?time_range=${timeRange}`);
    return res.data;
  }, []);

  const getPayrollSummary = useCallback(async (timeRange = 'this_month') => {
    const res = await api.get(`/analytics/reports/payroll-summary?time_range=${timeRange}`);
    return res.data;
  }, []);

  const exportReport = useCallback(async ({ reportId, queryConfig, format = 'csv' }) => {
    const res = await api.post('/analytics/reports/export', {
      report_id: reportId,
      query_config: queryConfig,
      format,
    }, { responseType: 'blob' });

    // Trigger browser download
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report.${format}`;
    a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const scheduleReport = useCallback(async (config) => {
    const res = await api.post('/analytics/reports/schedule', config);
    return res.data;
  }, []);

  return {
    loading, error,
    runQuery, getCrmSummary, getHrSummary, getPayrollSummary,
    exportReport, scheduleReport,
  };
}
```

```javascript
// src/hooks/useDashboard.js

import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

export function useDashboard(dashboardId) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async () => {
    if (!dashboardId) return;
    setLoading(true);
    try {
      const res = await api.get(`/analytics/dashboards/${dashboardId}`);
      setDashboard(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const updateWidgetPosition = useCallback(async (widgetId, position) => {
    await api.patch(`/analytics/widgets/${widgetId}`, { position });
    // Optimistic update
    setDashboard(prev => ({
      ...prev,
      widgets: prev.widgets.map(w =>
        w.id === widgetId ? { ...w, position } : w
      ),
    }));
  }, []);

  const addWidget = useCallback(async (widgetConfig) => {
    const res = await api.post('/analytics/widgets', {
      dashboard_id: dashboardId,
      ...widgetConfig,
    });
    setDashboard(prev => ({
      ...prev,
      widgets: [...prev.widgets, res.data],
    }));
    return res.data;
  }, [dashboardId]);

  const updateWidget = useCallback(async (widgetId, updates) => {
    const res = await api.patch(`/analytics/widgets/${widgetId}`, updates);
    setDashboard(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === widgetId ? res.data : w),
    }));
    return res.data;
  }, []);

  return {
    dashboard, loading, error,
    fetchDashboard, updateWidgetPosition, addWidget, updateWidget,
  };
}
```

### 3.2 Pages

```jsx
// src/pages/AnalyticsPage.jsx

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useDashboard } from '../hooks/useDashboard';
import DashboardGrid from '../components/analytics/DashboardGrid';
import ReportBuilder from '../components/analytics/ReportBuilder';
import ReportScheduler from '../components/analytics/ReportScheduler';

const TABS = [
  { key: 'dashboard', label: 'Dashboards' },
  { key: 'reports', label: 'Report Builder' },
  { key: 'scheduled', label: 'Scheduled Reports' },
];

export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'dashboard';
  const [dashboards, setDashboards] = useState([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState(null);
  const [moduleFilter, setModuleFilter] = useState('all');

  // Fetch dashboard list
  useEffect(() => {
    async function load() {
      const res = await api.get('/analytics/dashboards', {
        params: moduleFilter !== 'all' ? { module: moduleFilter } : {},
      });
      setDashboards(res.data);
      if (res.data.length > 0 && !selectedDashboardId) {
        const defaultDash = res.data.find(d => d.is_default) || res.data[0];
        setSelectedDashboardId(defaultDash.id);
      }
    }
    load();
  }, [moduleFilter]);

  const { dashboard, loading, updateWidgetPosition, addWidget, updateWidget } =
    useDashboard(selectedDashboardId);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <div className="flex items-center gap-3">
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="rounded-lg border-gray-300 text-sm"
            >
              <option value="all">All Modules</option>
              <option value="crm">CRM</option>
              <option value="hrms">HR & Attendance</option>
              <option value="payroll">Payroll</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setSearchParams({ tab: tab.key })}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'dashboard' && (
          <>
            {/* Dashboard selector */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {dashboards.map(d => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDashboardId(d.id)}
                  className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${
                    selectedDashboardId === d.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border hover:bg-gray-50'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : dashboard ? (
              <DashboardGrid
                dashboard={dashboard}
                onLayoutChange={updateWidgetPosition}
                onAddWidget={addWidget}
                onUpdateWidget={updateWidget}
              />
            ) : (
              <p className="text-gray-500 text-center py-20">
                No dashboard selected.
              </p>
            )}
          </>
        )}

        {activeTab === 'reports' && <ReportBuilder />}
        {activeTab === 'scheduled' && <ReportScheduler />}
      </div>
    </div>
  );
}
```

### 3.3 Dashboard Grid

```jsx
// src/components/analytics/DashboardGrid.jsx

import { useState, useCallback } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import WidgetRenderer from './WidgetRenderer';
import WidgetConfigDrawer from './WidgetConfigDrawer';
import { PlusIcon } from '@heroicons/react/24/outline';

const ResponsiveGrid = WidthProvider(Responsive);

export default function DashboardGrid({
  dashboard,
  onLayoutChange,
  onAddWidget,
  onUpdateWidget,
}) {
  const [configWidget, setConfigWidget] = useState(null); // widget being configured
  const [showAddDrawer, setShowAddDrawer] = useState(false);

  const widgets = dashboard?.widgets || [];

  const layout = widgets.map(w => ({
    i: w.id,
    x: w.position?.x || 0,
    y: w.position?.y || 0,
    w: w.position?.w || 6,
    h: w.position?.h || 4,
    minW: 3,
    minH: 2,
  }));

  const handleLayoutChange = useCallback((newLayout) => {
    newLayout.forEach(item => {
      const widget = widgets.find(w => w.id === item.i);
      if (!widget) return;
      const oldPos = widget.position || {};
      if (
        oldPos.x !== item.x || oldPos.y !== item.y ||
        oldPos.w !== item.w || oldPos.h !== item.h
      ) {
        onLayoutChange(item.i, { x: item.x, y: item.y, w: item.w, h: item.h });
      }
    });
  }, [widgets, onLayoutChange]);

  return (
    <div>
      {/* Add widget button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAddDrawer(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
        >
          <PlusIcon className="h-4 w-4" />
          Add Widget
        </button>
      </div>

      <ResponsiveGrid
        className="layout"
        layouts={{ lg: layout }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
        cols={{ lg: 12, md: 12, sm: 6, xs: 4 }}
        rowHeight={80}
        onLayoutChange={handleLayoutChange}
        isDraggable
        isResizable
        draggableHandle=".widget-drag-handle"
      >
        {widgets.map(widget => (
          <div key={widget.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <WidgetRenderer
              widget={widget}
              onConfigure={() => setConfigWidget(widget)}
            />
          </div>
        ))}
      </ResponsiveGrid>

      {/* Config drawer for existing widget */}
      {configWidget && (
        <WidgetConfigDrawer
          widget={configWidget}
          onSave={async (updates) => {
            await onUpdateWidget(configWidget.id, updates);
            setConfigWidget(null);
          }}
          onClose={() => setConfigWidget(null)}
        />
      )}

      {/* Config drawer for new widget */}
      {showAddDrawer && (
        <WidgetConfigDrawer
          widget={null}
          onSave={async (config) => {
            await onAddWidget(config);
            setShowAddDrawer(false);
          }}
          onClose={() => setShowAddDrawer(false)}
        />
      )}
    </div>
  );
}
```

### 3.4 Widget Renderer

```jsx
// src/components/analytics/WidgetRenderer.jsx

import { useEffect, useState } from 'react';
import { Cog6ToothIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import MetricCard from './MetricCard';
import ChartWidget from './ChartWidget';
import FunnelChart from './FunnelChart';
import HeatmapChart from './HeatmapChart';
import DataTableWidget from './DataTableWidget';
import { useAnalytics } from '../../hooks/useAnalytics';

const WIDGET_COMPONENTS = {
  metric_card: MetricCard,
  line_chart: ChartWidget,
  bar_chart: ChartWidget,
  pie_chart: ChartWidget,
  table: DataTableWidget,
  funnel: FunnelChart,
  heatmap: HeatmapChart,
};

export default function WidgetRenderer({ widget, onConfigure }) {
  const { runQuery } = useAnalytics();
  const [data, setData] = useState(widget.data || null);
  const [loading, setLoading] = useState(!widget.data);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = async () => {
    if (!widget.query_config?.module) return;
    setLoading(true);
    try {
      const result = await runQuery(widget.query_config);
      setData(result.data);
      setLastRefresh(new Date());
    } catch {
      // error is handled in useAnalytics
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!widget.data) fetchData();

    // Auto-refresh
    if (widget.refresh_interval_seconds > 0) {
      const interval = setInterval(fetchData, widget.refresh_interval_seconds * 1000);
      return () => clearInterval(interval);
    }
  }, [widget.id, widget.refresh_interval_seconds]);

  const Component = WIDGET_COMPONENTS[widget.type];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="widget-drag-handle flex items-center justify-between px-4 py-2 border-b bg-gray-50 cursor-move">
        <h3 className="text-sm font-semibold text-gray-700 truncate">
          {widget.title}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchData}
            className="p-1 text-gray-400 hover:text-gray-600"
            title="Refresh"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onConfigure}
            className="p-1 text-gray-400 hover:text-gray-600"
            title="Configure"
          >
            <Cog6ToothIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-4 overflow-auto">
        {loading && !data ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : Component ? (
          <Component widget={widget} data={data} />
        ) : (
          <p className="text-sm text-gray-500">Unknown widget type: {widget.type}</p>
        )}
      </div>
    </div>
  );
}
```

### 3.5 MetricCard

```jsx
// src/components/analytics/MetricCard.jsx

import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from '@heroicons/react/24/solid';

function formatNumber(value) {
  if (value === null || value === undefined) return '--';
  if (typeof value !== 'number') return String(value);
  if (value >= 10000000) return `${(value / 10000000).toFixed(1)} Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(1)} L`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} K`;
  return value.toLocaleString('en-IN');
}

export default function MetricCard({ widget, data }) {
  // data is expected as: { value: number, previous_value?: number, label?: string }
  // or as an array where we take the first row's first metric
  let value, previousValue;

  if (Array.isArray(data) && data.length > 0) {
    const row = data[0];
    const metricKey = widget.query_config?.metrics?.[0] || Object.keys(row)[0];
    value = row[metricKey];
    previousValue = data[1]?.[metricKey];
  } else if (data && typeof data === 'object') {
    value = data.value;
    previousValue = data.previous_value;
  }

  const change = previousValue
    ? ((value - previousValue) / previousValue) * 100
    : null;

  const TrendIcon = change > 0 ? ArrowUpIcon : change < 0 ? ArrowDownIcon : MinusIcon;
  const trendColor = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-400';

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <p className="text-3xl font-bold text-gray-900">{formatNumber(value)}</p>
      {change !== null && (
        <div className={`flex items-center gap-1 mt-2 text-sm ${trendColor}`}>
          <TrendIcon className="h-4 w-4" />
          <span>{Math.abs(change).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
```

### 3.6 ChartWidget

```jsx
// src/components/analytics/ChartWidget.jsx

import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export default function ChartWidget({ widget, data }) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <p className="text-sm text-gray-400 text-center">No data</p>;
  }

  const dimensions = widget.query_config?.dimensions || [];
  const metrics = widget.query_config?.metrics || [];
  const xKey = dimensions[0] || Object.keys(data[0])[0];

  if (widget.type === 'line_chart') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {metrics.map((m, i) => (
            <Line
              key={m}
              type="monotone"
              dataKey={m}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === 'bar_chart') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {metrics.map((m, i) => (
            <Bar key={m} dataKey={m} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === 'pie_chart') {
    const nameKey = xKey;
    const valueKey = metrics[0] || Object.keys(data[0]).find(k => k !== nameKey);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius="80%"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return <p className="text-sm text-gray-400">Unsupported chart type</p>;
}
```

### 3.7 FunnelChart

```jsx
// src/components/analytics/FunnelChart.jsx

export default function FunnelChart({ widget, data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400 text-center">No data</p>;
  }

  // Sort by stage_position if available, otherwise use array order
  const sorted = [...data].sort((a, b) => (a.stage_position ?? 0) - (b.stage_position ?? 0));
  const maxValue = Math.max(...sorted.map(d => d.deal_count || d.total_value || 0));

  const valueKey = widget.query_config?.metrics?.[0] || 'deal_count';
  const labelKey = widget.query_config?.dimensions?.[0] || 'stage';

  const colors = ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff'];

  return (
    <div className="flex flex-col gap-2 h-full justify-center">
      {sorted.map((item, i) => {
        const value = item[valueKey] || 0;
        const widthPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-gray-600 w-24 text-right truncate">
              {item[labelKey]}
            </span>
            <div className="flex-1 relative">
              <div
                className="h-8 rounded-r-lg flex items-center px-3 transition-all"
                style={{
                  width: `${Math.max(widthPct, 5)}%`,
                  backgroundColor: colors[i % colors.length],
                  marginLeft: `${(100 - Math.max(widthPct, 5)) / 2}%`,
                }}
              >
                <span className="text-xs font-semibold text-white">
                  {value.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### 3.8 HeatmapChart

```jsx
// src/components/analytics/HeatmapChart.jsx

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 12 }, (_, i) => `${i + 7}:00`); // 7 AM to 6 PM

function getColor(value, max) {
  if (value === 0) return '#f3f4f6';
  const intensity = Math.min(value / max, 1);
  if (intensity < 0.25) return '#dbeafe';
  if (intensity < 0.5) return '#93c5fd';
  if (intensity < 0.75) return '#3b82f6';
  return '#1d4ed8';
}

export default function HeatmapChart({ widget, data }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400 text-center">No data</p>;
  }

  // data: array of { day, hour, count } or { employee_id, date, late_count }
  // For attendance heatmap: rows = employees or days, cols = dates or hours
  const valueKey = widget.query_config?.metrics?.[0] || 'count';
  const maxVal = Math.max(...data.map(d => d[valueKey] || 0), 1);

  // Group into grid: assume data has 'row' and 'col' keys
  const rowKey = widget.query_config?.dimensions?.[0] || 'day';
  const colKey = widget.query_config?.dimensions?.[1] || 'hour';

  const rows = [...new Set(data.map(d => d[rowKey]))];
  const cols = [...new Set(data.map(d => d[colKey]))];

  const lookup = {};
  data.forEach(d => {
    lookup[`${d[rowKey]}-${d[colKey]}`] = d[valueKey] || 0;
  });

  return (
    <div className="overflow-auto h-full">
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-xs text-gray-500 p-1" />
            {cols.map(col => (
              <th key={col} className="text-xs text-gray-500 p-1 font-normal">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row}>
              <td className="text-xs text-gray-600 p-1 font-medium whitespace-nowrap">
                {row}
              </td>
              {cols.map(col => {
                const val = lookup[`${row}-${col}`] || 0;
                return (
                  <td key={col} className="p-1">
                    <div
                      className="w-full h-6 rounded-sm cursor-pointer"
                      style={{ backgroundColor: getColor(val, maxVal) }}
                      title={`${row}, ${col}: ${val}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 justify-center">
        <span className="text-xs text-gray-500">Less</span>
        {['#f3f4f6', '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'].map(c => (
          <div key={c} className="w-4 h-4 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span className="text-xs text-gray-500">More</span>
      </div>
    </div>
  );
}
```

### 3.9 DataTableWidget

```jsx
// src/components/analytics/DataTableWidget.jsx

import { useState, useMemo } from 'react';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/solid';

export default function DataTableWidget({ widget, data }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('');

  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400 text-center">No data</p>;
  }

  const columns = Object.keys(data[0]);

  const filteredData = useMemo(() => {
    if (!filter) return data;
    const lower = filter.toLowerCase();
    return data.filter(row =>
      columns.some(col => String(row[col] ?? '').toLowerCase().includes(lower))
    );
  }, [data, filter, columns]);

  const sortedData = useMemo(() => {
    if (!sortCol) return filteredData;
    return [...filteredData].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Filter */}
      <input
        type="text"
        placeholder="Filter..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="mb-2 px-3 py-1.5 border rounded-lg text-sm w-full"
      />

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="px-3 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                >
                  <span className="flex items-center gap-1">
                    {col.replace(/_/g, ' ')}
                    {sortCol === col && (
                      sortDir === 'asc'
                        ? <ChevronUpIcon className="h-3 w-3" />
                        : <ChevronDownIcon className="h-3 w-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.slice(0, 100).map((row, i) => (
              <tr key={i} className="border-t hover:bg-gray-50">
                {columns.map(col => (
                  <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {typeof row[col] === 'number'
                      ? row[col].toLocaleString('en-IN')
                      : String(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sortedData.length > 100 && (
          <p className="text-xs text-gray-400 text-center py-2">
            Showing 100 of {sortedData.length} rows
          </p>
        )}
      </div>
    </div>
  );
}
```

### 3.10 WidgetConfigDrawer

```jsx
// src/components/analytics/WidgetConfigDrawer.jsx

import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

const WIDGET_TYPES = [
  { value: 'metric_card', label: 'Metric Card' },
  { value: 'line_chart', label: 'Line Chart' },
  { value: 'bar_chart', label: 'Bar Chart' },
  { value: 'pie_chart', label: 'Pie Chart' },
  { value: 'table', label: 'Data Table' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'heatmap', label: 'Heatmap' },
];

const MODULE_SOURCES = {
  crm: ['crm_deals', 'crm_contacts', 'crm_activities', 'mv_crm_pipeline_summary'],
  hrms: ['hrms_employees', 'hrms_attendance', 'hrms_leave_requests', 'mv_attendance_monthly'],
  payroll: ['payroll_runs', 'mv_payroll_monthly', 'mv_revenue_monthly'],
};

const TIME_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'last_90_days', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
];

export default function WidgetConfigDrawer({ widget, onSave, onClose }) {
  const isNew = !widget;

  const [form, setForm] = useState({
    type: widget?.type || 'metric_card',
    title: widget?.title || '',
    data_source: widget?.data_source || '',
    module: widget?.query_config?.module || 'crm',
    metrics: (widget?.query_config?.metrics || []).join(', '),
    dimensions: (widget?.query_config?.dimensions || []).join(', '),
    time_range: widget?.query_config?.time_range || 'last_30_days',
    aggregation: widget?.query_config?.aggregation || 'sum',
    refresh_interval_seconds: widget?.refresh_interval_seconds || 300,
  });

  const handleSave = () => {
    const config = {
      type: form.type,
      title: form.title,
      data_source: form.data_source,
      query_config: {
        module: form.module,
        data_source: form.data_source,
        metrics: form.metrics.split(',').map(s => s.trim()).filter(Boolean),
        dimensions: form.dimensions.split(',').map(s => s.trim()).filter(Boolean),
        time_range: form.time_range,
        aggregation: form.aggregation,
      },
      refresh_interval_seconds: form.refresh_interval_seconds,
    };

    if (isNew) {
      config.position = { x: 0, y: 0, w: 6, h: 4 };
    }

    onSave(config);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-96 bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">
            {isNew ? 'Add Widget' : 'Configure Widget'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g., Monthly Revenue"
            />
          </div>

          {/* Widget Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chart Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              {WIDGET_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Module */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Module</label>
            <select
              value={form.module}
              onChange={e => setForm(f => ({ ...f, module: e.target.value, data_source: '' }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="crm">CRM</option>
              <option value="hrms">HR & Attendance</option>
              <option value="payroll">Payroll</option>
            </select>
          </div>

          {/* Data Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Source</label>
            <select
              value={form.data_source}
              onChange={e => setForm(f => ({ ...f, data_source: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select...</option>
              {(MODULE_SOURCES[form.module] || []).map(src => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </div>

          {/* Metrics */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Metrics (comma-separated)
            </label>
            <input
              type="text"
              value={form.metrics}
              onChange={e => setForm(f => ({ ...f, metrics: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="deal_count, total_value"
            />
          </div>

          {/* Dimensions */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dimensions (comma-separated)
            </label>
            <input
              type="text"
              value={form.dimensions}
              onChange={e => setForm(f => ({ ...f, dimensions: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="stage, owner"
            />
          </div>

          {/* Aggregation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aggregation</label>
            <select
              value={form.aggregation}
              onChange={e => setForm(f => ({ ...f, aggregation: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count</option>
              <option value="min">Min</option>
              <option value="max">Max</option>
            </select>
          </div>

          {/* Time Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time Range</label>
            <select
              value={form.time_range}
              onChange={e => setForm(f => ({ ...f, time_range: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              {TIME_RANGES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Refresh Interval */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Auto-refresh (seconds)
            </label>
            <input
              type="number"
              value={form.refresh_interval_seconds}
              onChange={e => setForm(f => ({ ...f, refresh_interval_seconds: parseInt(e.target.value) || 300 }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              min={0}
              step={60}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.title || !form.data_source}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {isNew ? 'Add Widget' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 3.11 ReportBuilder

```jsx
// src/components/analytics/ReportBuilder.jsx

import { useState } from 'react';
import { useAnalytics } from '../../hooks/useAnalytics';
import ChartWidget from './ChartWidget';
import DataTableWidget from './DataTableWidget';

export default function ReportBuilder() {
  const { runQuery, exportReport, loading } = useAnalytics();
  const [config, setConfig] = useState({
    module: 'crm',
    data_source: '',
    metrics: '',
    dimensions: '',
    filters: '[]',
    time_range: 'last_30_days',
    aggregation: 'sum',
  });
  const [result, setResult] = useState(null);
  const [viewType, setViewType] = useState('table'); // table | bar_chart | line_chart

  const handleRun = async () => {
    const queryConfig = {
      module: config.module,
      data_source: config.data_source || undefined,
      metrics: config.metrics.split(',').map(s => s.trim()).filter(Boolean),
      dimensions: config.dimensions.split(',').map(s => s.trim()).filter(Boolean),
      filters: JSON.parse(config.filters || '[]'),
      time_range: config.time_range,
      aggregation: config.aggregation,
    };
    const res = await runQuery(queryConfig);
    setResult(res);
  };

  const handleExport = async (format) => {
    const queryConfig = {
      module: config.module,
      data_source: config.data_source || undefined,
      metrics: config.metrics.split(',').map(s => s.trim()).filter(Boolean),
      dimensions: config.dimensions.split(',').map(s => s.trim()).filter(Boolean),
      filters: JSON.parse(config.filters || '[]'),
      time_range: config.time_range,
      aggregation: config.aggregation,
    };
    await exportReport({ queryConfig, format });
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Config Panel */}
      <div className="col-span-4 bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Report Configuration</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Module</label>
          <select
            value={config.module}
            onChange={e => setConfig(c => ({ ...c, module: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            <option value="crm">CRM</option>
            <option value="hrms">HR & Attendance</option>
            <option value="payroll">Payroll</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Data Source</label>
          <input
            type="text"
            value={config.data_source}
            onChange={e => setConfig(c => ({ ...c, data_source: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="crm_deals, mv_crm_pipeline_summary..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Metrics</label>
          <input
            type="text"
            value={config.metrics}
            onChange={e => setConfig(c => ({ ...c, metrics: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="deal_count, total_value"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Dimensions</label>
          <input
            type="text"
            value={config.dimensions}
            onChange={e => setConfig(c => ({ ...c, dimensions: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="stage, owner"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Filters (JSON)</label>
          <textarea
            value={config.filters}
            onChange={e => setConfig(c => ({ ...c, filters: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            rows={3}
            placeholder='[{"field":"status","op":"eq","value":"won"}]'
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time Range</label>
            <select
              value={config.time_range}
              onChange={e => setConfig(c => ({ ...c, time_range: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="last_90_days">Last 90 Days</option>
              <option value="this_month">This Month</option>
              <option value="this_quarter">This Quarter</option>
              <option value="this_year">This Year</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aggregation</label>
            <select
              value={config.aggregation}
              onChange={e => setConfig(c => ({ ...c, aggregation: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Query'}
        </button>

        {result && (
          <div className="flex gap-2">
            <button onClick={() => handleExport('csv')} className="flex-1 border py-2 rounded-lg text-sm hover:bg-gray-50">CSV</button>
            <button onClick={() => handleExport('xlsx')} className="flex-1 border py-2 rounded-lg text-sm hover:bg-gray-50">Excel</button>
            <button onClick={() => handleExport('pdf')} className="flex-1 border py-2 rounded-lg text-sm hover:bg-gray-50">PDF</button>
          </div>
        )}
      </div>

      {/* Result Panel */}
      <div className="col-span-8 bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Results</h2>
          {result && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {['table', 'bar_chart', 'line_chart'].map(v => (
                <button
                  key={v}
                  onClick={() => setViewType(v)}
                  className={`px-3 py-1 rounded-md text-sm ${
                    viewType === v ? 'bg-white shadow-sm font-medium' : 'text-gray-600'
                  }`}
                >
                  {v === 'table' ? 'Table' : v === 'bar_chart' ? 'Bar' : 'Line'}
                </button>
              ))}
            </div>
          )}
        </div>

        {!result ? (
          <p className="text-gray-400 text-center py-20">
            Configure and run a query to see results.
          </p>
        ) : viewType === 'table' ? (
          <div className="h-[500px]">
            <DataTableWidget
              widget={{ query_config: config }}
              data={result.data}
            />
          </div>
        ) : (
          <div className="h-[500px]">
            <ChartWidget
              widget={{
                type: viewType,
                query_config: {
                  metrics: config.metrics.split(',').map(s => s.trim()).filter(Boolean),
                  dimensions: config.dimensions.split(',').map(s => s.trim()).filter(Boolean),
                },
              }}
              data={result.data}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3.12 ReportScheduler

```jsx
// src/components/analytics/ReportScheduler.jsx

import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useAnalytics } from '../../hooks/useAnalytics';
import { ClockIcon, TrashIcon } from '@heroicons/react/24/outline';

export default function ReportScheduler() {
  const { scheduleReport } = useAnalytics();
  const [reports, setReports] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    module: 'crm',
    schedule: 'weekly',
    recipients: '',
    metrics: '',
    dimensions: '',
    time_range: 'last_30_days',
    aggregation: 'sum',
    data_source: '',
  });

  useEffect(() => {
    api.get('/analytics/reports/scheduled').then(res => setReports(res.data)).catch(() => {});
  }, []);

  const handleCreate = async () => {
    const config = {
      name: form.name,
      module: form.module,
      schedule: form.schedule,
      recipients: form.recipients.split(',').map(s => s.trim()).filter(Boolean),
      query_config: {
        module: form.module,
        data_source: form.data_source || undefined,
        metrics: form.metrics.split(',').map(s => s.trim()).filter(Boolean),
        dimensions: form.dimensions.split(',').map(s => s.trim()).filter(Boolean),
        time_range: form.time_range,
        aggregation: form.aggregation,
      },
    };
    const result = await scheduleReport(config);
    setReports(prev => [result, ...prev]);
    setShowForm(false);
    setForm({ name: '', module: 'crm', schedule: 'weekly', recipients: '', metrics: '', dimensions: '', time_range: 'last_30_days', aggregation: 'sum', data_source: '' });
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Scheduled Reports</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          Schedule New Report
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Name</label>
              <input
                type="text" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Weekly CRM Summary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (Mondays)</option>
                <option value="monthly">Monthly (1st)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipients (comma-separated emails)</label>
            <input
              type="text" value={form.recipients}
              onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="manager@company.com, cfo@company.com"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Module</label>
              <select value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="crm">CRM</option>
                <option value="hrms">HRMS</option>
                <option value="payroll">Payroll</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Metrics</label>
              <input type="text" value={form.metrics} onChange={e => setForm(f => ({ ...f, metrics: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="deal_count, total_value" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dimensions</label>
              <input type="text" value={form.dimensions} onChange={e => setForm(f => ({ ...f, dimensions: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="stage" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} disabled={!form.name || !form.recipients} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">Create Schedule</button>
            <button onClick={() => setShowForm(false)} className="border px-6 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* Existing scheduled reports */}
      <div className="space-y-3">
        {reports.length === 0 ? (
          <p className="text-gray-400 text-center py-10">No scheduled reports yet.</p>
        ) : reports.map(r => (
          <div key={r.id} className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">{r.name}</h3>
              <p className="text-sm text-gray-500 mt-1">
                <ClockIcon className="h-4 w-4 inline mr-1" />
                {r.schedule} &middot; {r.module.toUpperCase()} &middot;
                {Array.isArray(r.recipients) ? ` ${r.recipients.length} recipients` : ''}
              </p>
              {r.last_run_at && (
                <p className="text-xs text-gray-400 mt-1">
                  Last run: {new Date(r.last_run_at).toLocaleDateString('en-IN')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 4. Pre-built Dashboards

These dashboards and their widgets are created automatically when the Analytics module is activated for an organization. Implement this in a seed function called from the module activation flow.

```python
# backend/services/analytics_seed.py

"""
Creates default dashboards and widgets when Analytics Pro is activated.
Called from the module activation endpoint.
"""

import json
from uuid import uuid4

from backend.database import get_db


async def seed_analytics_dashboards(org_id: str, created_by: str):
    db = await get_db()

    dashboards = [
        {
            "name": "CRM Dashboard",
            "module": "crm",
            "is_default": True,
            "widgets": [
                {
                    "type": "funnel",
                    "title": "Pipeline Funnel",
                    "data_source": "mv_crm_pipeline_summary",
                    "query_config": {"module": "crm", "metrics": ["deal_count"], "dimensions": ["stage"]},
                    "position": {"x": 0, "y": 0, "w": 6, "h": 5},
                },
                {
                    "type": "line_chart",
                    "title": "Revenue Forecast",
                    "data_source": "mv_revenue_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_revenue_monthly", "metrics": ["invoiced_amount", "collected_amount"], "dimensions": ["month"], "time_range": "this_year"},
                    "position": {"x": 6, "y": 0, "w": 6, "h": 5},
                },
                {
                    "type": "metric_card",
                    "title": "Avg Deal Velocity (days)",
                    "data_source": "mv_crm_pipeline_summary",
                    "query_config": {"module": "crm", "metrics": ["avg_days_in_stage"], "aggregation": "avg"},
                    "position": {"x": 0, "y": 5, "w": 3, "h": 3},
                },
                {
                    "type": "table",
                    "title": "Top Deals",
                    "data_source": "crm_deals",
                    "query_config": {"module": "crm", "metrics": ["value"], "dimensions": ["name", "status"], "time_range": "last_90_days"},
                    "position": {"x": 3, "y": 5, "w": 5, "h": 5},
                },
                {
                    "type": "pie_chart",
                    "title": "Activity Breakdown",
                    "data_source": "crm_activities",
                    "query_config": {"module": "crm", "metrics": ["id"], "dimensions": ["type"], "aggregation": "count"},
                    "position": {"x": 8, "y": 5, "w": 4, "h": 5},
                },
                {
                    "type": "bar_chart",
                    "title": "Lead Source Distribution",
                    "data_source": "crm_deals",
                    "query_config": {"module": "crm", "metrics": ["id"], "dimensions": ["lead_source"], "aggregation": "count"},
                    "position": {"x": 0, "y": 10, "w": 6, "h": 4},
                },
            ],
        },
        {
            "name": "HR Dashboard",
            "module": "hrms",
            "is_default": False,
            "widgets": [
                {
                    "type": "line_chart",
                    "title": "Headcount Over Time",
                    "data_source": "hrms_employees",
                    "query_config": {"module": "hrms", "metrics": ["id"], "dimensions": ["date_of_joining"], "aggregation": "count"},
                    "position": {"x": 0, "y": 0, "w": 6, "h": 4},
                },
                {
                    "type": "line_chart",
                    "title": "Attendance Rate Trend",
                    "data_source": "mv_attendance_monthly",
                    "query_config": {"module": "hrms", "data_source": "mv_attendance_monthly", "metrics": ["present_days", "absent_days"], "dimensions": ["month"]},
                    "position": {"x": 6, "y": 0, "w": 6, "h": 4},
                },
                {
                    "type": "pie_chart",
                    "title": "Department Breakdown",
                    "data_source": "hrms_employees",
                    "query_config": {"module": "hrms", "metrics": ["id"], "dimensions": ["department_id"], "aggregation": "count"},
                    "position": {"x": 0, "y": 4, "w": 4, "h": 4},
                },
                {
                    "type": "bar_chart",
                    "title": "Leave Utilization",
                    "data_source": "hrms_leave_requests",
                    "query_config": {"module": "hrms", "metrics": ["days"], "dimensions": ["leave_type"], "aggregation": "sum"},
                    "position": {"x": 4, "y": 4, "w": 4, "h": 4},
                },
                {
                    "type": "heatmap",
                    "title": "Late Arrival Heatmap",
                    "data_source": "hrms_attendance",
                    "query_config": {"module": "hrms", "metrics": ["late_count"], "dimensions": ["employee_id", "date"]},
                    "position": {"x": 8, "y": 4, "w": 4, "h": 4},
                },
            ],
        },
        {
            "name": "Payroll Dashboard",
            "module": "payroll",
            "is_default": False,
            "widgets": [
                {
                    "type": "line_chart",
                    "title": "Monthly Payroll Cost",
                    "data_source": "mv_payroll_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_payroll_monthly", "metrics": ["total_gross", "total_net"], "dimensions": ["month"]},
                    "position": {"x": 0, "y": 0, "w": 8, "h": 4},
                },
                {
                    "type": "metric_card",
                    "title": "Employee Count",
                    "data_source": "mv_payroll_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_payroll_monthly", "metrics": ["employee_count"], "aggregation": "max"},
                    "position": {"x": 8, "y": 0, "w": 4, "h": 4},
                },
                {
                    "type": "bar_chart",
                    "title": "Department-wise Cost",
                    "data_source": "payroll_runs",
                    "query_config": {"module": "payroll", "metrics": ["gross_salary"], "dimensions": ["employee_id"], "aggregation": "sum"},
                    "position": {"x": 0, "y": 4, "w": 6, "h": 4},
                },
                {
                    "type": "pie_chart",
                    "title": "PF / ESI / TDS Breakdown",
                    "data_source": "mv_payroll_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_payroll_monthly", "metrics": ["total_pf", "total_esi", "total_tds"], "dimensions": ["month"]},
                    "position": {"x": 6, "y": 4, "w": 6, "h": 4},
                },
                {
                    "type": "bar_chart",
                    "title": "CTC Distribution",
                    "data_source": "payroll_runs",
                    "query_config": {"module": "payroll", "metrics": ["gross_salary"], "dimensions": ["employee_id"], "aggregation": "count"},
                    "position": {"x": 0, "y": 8, "w": 12, "h": 4},
                },
            ],
        },
        {
            "name": "Executive Dashboard",
            "module": "all",
            "is_default": False,
            "widgets": [
                {
                    "type": "line_chart",
                    "title": "Revenue vs Collections",
                    "data_source": "mv_revenue_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_revenue_monthly", "metrics": ["invoiced_amount", "collected_amount"], "dimensions": ["month"]},
                    "position": {"x": 0, "y": 0, "w": 6, "h": 4},
                },
                {
                    "type": "line_chart",
                    "title": "Headcount Growth",
                    "data_source": "hrms_employees",
                    "query_config": {"module": "hrms", "metrics": ["id"], "dimensions": ["date_of_joining"], "aggregation": "count"},
                    "position": {"x": 6, "y": 0, "w": 6, "h": 4},
                },
                {
                    "type": "line_chart",
                    "title": "Operational Costs",
                    "data_source": "mv_payroll_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_payroll_monthly", "metrics": ["total_gross"], "dimensions": ["month"]},
                    "position": {"x": 0, "y": 4, "w": 6, "h": 4},
                },
                {
                    "type": "metric_card",
                    "title": "Outstanding Amount",
                    "data_source": "mv_revenue_monthly",
                    "query_config": {"module": "payroll", "data_source": "mv_revenue_monthly", "metrics": ["outstanding_amount"], "aggregation": "sum"},
                    "position": {"x": 6, "y": 4, "w": 3, "h": 4},
                },
                {
                    "type": "metric_card",
                    "title": "Total Employees",
                    "data_source": "hrms_employees",
                    "query_config": {"module": "hrms", "metrics": ["id"], "aggregation": "count"},
                    "position": {"x": 9, "y": 4, "w": 3, "h": 4},
                },
            ],
        },
    ]

    for dash_config in dashboards:
        widgets = dash_config.pop("widgets")
        dash_id = str(uuid4())

        await db.execute(
            """
            INSERT INTO analytics_dashboards (id, org_id, name, module, is_default, layout, created_by)
            VALUES ($1, $2, $3, $4, $5, '[]', $6)
            """,
            dash_id, org_id, dash_config["name"], dash_config["module"],
            dash_config["is_default"], created_by,
        )

        for w in widgets:
            await db.execute(
                """
                INSERT INTO analytics_widgets
                    (org_id, dashboard_id, type, title, data_source, query_config, position)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                org_id, dash_id, w["type"], w["title"], w["data_source"],
                json.dumps(w["query_config"]), json.dumps(w["position"]),
            )
```

---

## 5. Implementation Steps

### Phase 1: Database (Day 1-2)
1. Write and review `014_analytics_module.sql`.
2. Run the migration against Supabase: `supabase db push` or execute via the SQL editor.
3. Enable `pg_cron` in Supabase and schedule the materialized view refresh (every 15 minutes) and cache cleanup (hourly).
4. Verify RLS policies work by testing with `SET app.current_org_id` in a direct query.

### Phase 2: Backend (Day 3-5)
1. Create `backend/services/analytics_query_builder.py` with the safe query builder.
2. Create `backend/routers/analytics.py` with all endpoints.
3. Create `backend/services/analytics_seed.py` for pre-built dashboard creation.
4. Create `backend/workers/report_scheduler.py` for scheduled report delivery.
5. Wire `analytics.router` into `backend/main.py`.
6. Add `require_module("analytics")` dependency to gate access behind the Analytics Pro subscription.
7. Add `openpyxl` and `reportlab` to `requirements.txt` for Excel and PDF export.

### Phase 3: Frontend (Day 6-9)
1. Install dependencies: `npm install react-grid-layout recharts @heroicons/react`.
2. Create hooks: `useAnalytics.js`, `useDashboard.js`.
3. Create the widget components: `MetricCard`, `ChartWidget`, `FunnelChart`, `HeatmapChart`, `DataTableWidget`.
4. Create `WidgetRenderer`, `WidgetConfigDrawer`.
5. Create `DashboardGrid` with react-grid-layout.
6. Create `ReportBuilder` and `ReportScheduler`.
7. Create `AnalyticsPage` and add it to the router in `App.jsx`.
8. Add "Analytics" to the sidebar navigation (conditionally visible when module is active).

### Phase 4: Integration (Day 10-11)
1. Hook the module activation flow to call `seed_analytics_dashboards()`.
2. Deploy the report scheduler as a Railway cron job (run `report_scheduler.py` daily at 07:00 IST).
3. Wire up email sending via the existing email service (Resend or SES).
4. Test the full flow: activate module, view pre-built dashboards, create custom widget, run ad-hoc query, export CSV, schedule a report.

### Phase 5: Polish (Day 12-13)
1. Add loading skeletons to all widget components.
2. Add empty states with illustration for no-data scenarios.
3. Add INR currency formatting across metric cards (using `en-IN` locale with Rs. symbol).
4. Add permission checks: only org admins can create/modify dashboards; all Analytics Pro users can view.
5. Mobile responsiveness: collapse grid to single column on small screens.

---

## 6. Test Cases

### 6.1 Widget Data Query

```python
# tests/test_analytics_query.py

import pytest
from backend.services.analytics_query_builder import QueryConfig, build_query


def test_basic_query_builds_valid_sql():
    config = QueryConfig(
        module="crm",
        data_source="crm_deals",
        metrics=["value"],
        dimensions=["status"],
        aggregation="sum",
    )
    sql, params = build_query(config, "org-123")
    assert "SUM(value)" in sql
    assert "FROM crm_deals" in sql
    assert "org_id = :org_id" in sql
    assert params["org_id"] == "org-123"


def test_query_with_filters():
    config = QueryConfig(
        module="crm",
        data_source="crm_deals",
        metrics=["value"],
        dimensions=["status"],
        filters=[{"field": "status", "op": "eq", "value": "won"}],
        aggregation="sum",
    )
    sql, params = build_query(config, "org-123")
    assert "status = :__f0" in sql
    assert params["__f0"] == "won"


def test_query_with_time_range():
    config = QueryConfig(
        module="crm",
        data_source="crm_deals",
        metrics=["value"],
        dimensions=[],
        time_range="last_30_days",
        aggregation="sum",
    )
    sql, params = build_query(config, "org-123")
    assert "created_at >= :__time_start" in sql
    assert "__time_start" in params


def test_rejects_invalid_column():
    config = QueryConfig(
        module="crm",
        data_source="crm_deals",
        metrics=["password_hash"],  # not in whitelist
        dimensions=[],
        aggregation="sum",
    )
    with pytest.raises(ValueError, match="not allowed"):
        build_query(config, "org-123")


def test_rejects_sql_injection_in_identifier():
    config = QueryConfig(
        module="crm",
        data_source="crm_deals",
        metrics=["value; DROP TABLE crm_deals;--"],
        dimensions=[],
        aggregation="sum",
    )
    with pytest.raises(ValueError, match="Invalid identifier"):
        build_query(config, "org-123")


def test_rejects_unknown_module():
    config = QueryConfig(
        module="banking",
        data_source="accounts",
        metrics=["balance"],
        dimensions=[],
        aggregation="sum",
    )
    with pytest.raises(ValueError, match="Unknown module"):
        build_query(config, "org-123")


def test_in_operator():
    config = QueryConfig(
        module="crm",
        data_source="crm_deals",
        metrics=["value"],
        dimensions=["status"],
        filters=[{"field": "status", "op": "in", "value": ["won", "lost"]}],
        aggregation="sum",
    )
    sql, params = build_query(config, "org-123")
    assert "status IN" in sql
    assert params["__f0_0"] == "won"
    assert params["__f0_1"] == "lost"
```

### 6.2 Dashboard CRUD

```python
# tests/test_analytics_dashboards.py

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_dashboard(client: AsyncClient, auth_headers, org_id):
    res = await client.post(
        "/api/v1/analytics/dashboards",
        json={"name": "Test Dashboard", "module": "crm"},
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Test Dashboard"
    assert data["module"] == "crm"
    assert data["org_id"] == org_id


@pytest.mark.asyncio
async def test_list_dashboards(client: AsyncClient, auth_headers):
    res = await client.get("/api/v1/analytics/dashboards", headers=auth_headers)
    assert res.status_code == 200
    assert isinstance(res.json(), list)


@pytest.mark.asyncio
async def test_get_dashboard_with_widgets(client: AsyncClient, auth_headers, dashboard_id):
    res = await client.get(
        f"/api/v1/analytics/dashboards/{dashboard_id}",
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert "widgets" in data
    assert isinstance(data["widgets"], list)


@pytest.mark.asyncio
async def test_dashboard_org_isolation(client: AsyncClient, other_org_headers, dashboard_id):
    """Dashboard from org A must not be visible to org B."""
    res = await client.get(
        f"/api/v1/analytics/dashboards/{dashboard_id}",
        headers=other_org_headers,
    )
    assert res.status_code == 404
```

### 6.3 Materialized View Refresh

```python
# tests/test_analytics_mv_refresh.py

import pytest


@pytest.mark.asyncio
async def test_mv_crm_pipeline_summary_exists(db):
    row = await db.fetchrow(
        "SELECT COUNT(*) AS cnt FROM pg_matviews WHERE matviewname = 'mv_crm_pipeline_summary'"
    )
    assert row["cnt"] == 1


@pytest.mark.asyncio
async def test_mv_refresh_function_runs(db):
    """Ensure the refresh function executes without error."""
    await db.execute("SELECT refresh_analytics_materialized_views()")
    # If it reaches here without exception, the function works.


@pytest.mark.asyncio
async def test_mv_crm_pipeline_returns_data(db, org_with_deals):
    """After seeding deals, the MV should return aggregated data."""
    await db.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_pipeline_summary")
    rows = await db.fetch(
        "SELECT * FROM mv_crm_pipeline_summary WHERE org_id = $1",
        org_with_deals,
    )
    assert len(rows) > 0
    assert all(r["deal_count"] >= 0 for r in rows)
```

### 6.4 Ad-hoc Query with Filters

```python
# tests/test_analytics_adhoc.py

import pytest
from httpx import AsyncClient
import json


@pytest.mark.asyncio
async def test_adhoc_query_basic(client: AsyncClient, auth_headers):
    res = await client.get(
        "/api/v1/analytics/query",
        params={
            "module": "crm",
            "metrics": "value",
            "dimensions": "status",
            "aggregation": "sum",
            "data_source": "crm_deals",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert "data" in data
    assert isinstance(data["data"], list)


@pytest.mark.asyncio
async def test_adhoc_query_with_filter(client: AsyncClient, auth_headers):
    filters = json.dumps([{"field": "status", "op": "eq", "value": "won"}])
    res = await client.get(
        "/api/v1/analytics/query",
        params={
            "module": "crm",
            "metrics": "value",
            "dimensions": "status",
            "data_source": "crm_deals",
            "filters": filters,
            "aggregation": "sum",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_adhoc_query_caches_results(client: AsyncClient, auth_headers):
    params = {
        "module": "crm",
        "metrics": "value",
        "dimensions": "status",
        "data_source": "crm_deals",
        "aggregation": "sum",
    }
    res1 = await client.get("/api/v1/analytics/query", params=params, headers=auth_headers)
    res2 = await client.get("/api/v1/analytics/query", params=params, headers=auth_headers)
    assert res1.status_code == 200
    assert res2.json().get("cached") is True
```

### 6.5 CSV Export

```python
# tests/test_analytics_export.py

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_export_csv(client: AsyncClient, auth_headers):
    res = await client.post(
        "/api/v1/analytics/reports/export",
        json={
            "query_config": {
                "module": "crm",
                "data_source": "crm_deals",
                "metrics": ["value"],
                "dimensions": ["status"],
                "aggregation": "sum",
            },
            "format": "csv",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/csv"
    assert "attachment" in res.headers["content-disposition"]
    # CSV should have a header row
    lines = res.text.strip().split("\n")
    assert len(lines) >= 1  # at least the header


@pytest.mark.asyncio
async def test_export_xlsx(client: AsyncClient, auth_headers):
    res = await client.post(
        "/api/v1/analytics/reports/export",
        json={
            "query_config": {
                "module": "crm",
                "data_source": "crm_deals",
                "metrics": ["value"],
                "dimensions": ["status"],
                "aggregation": "sum",
            },
            "format": "xlsx",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert "spreadsheetml" in res.headers["content-type"]
```

### 6.6 Report Scheduling

```python
# tests/test_analytics_scheduling.py

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_schedule_report(client: AsyncClient, auth_headers):
    res = await client.post(
        "/api/v1/analytics/reports/schedule",
        json={
            "name": "Weekly CRM Report",
            "module": "crm",
            "query_config": {
                "module": "crm",
                "data_source": "crm_deals",
                "metrics": ["value"],
                "dimensions": ["status"],
                "aggregation": "sum",
            },
            "schedule": "weekly",
            "recipients": ["manager@example.com"],
        },
        headers=auth_headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["schedule"] == "weekly"
    assert data["name"] == "Weekly CRM Report"


@pytest.mark.asyncio
async def test_schedule_validation_rejects_invalid_schedule(client: AsyncClient, auth_headers):
    res = await client.post(
        "/api/v1/analytics/reports/schedule",
        json={
            "name": "Bad Schedule",
            "module": "crm",
            "query_config": {"module": "crm"},
            "schedule": "every_5_minutes",  # invalid
            "recipients": ["a@b.com"],
        },
        headers=auth_headers,
    )
    assert res.status_code == 422  # validation error
```

---

## Dependencies

### Backend (add to requirements.txt)
```
openpyxl>=3.1.0
reportlab>=4.0
```

### Frontend (add to package.json)
```
react-grid-layout: ^1.4.4
recharts: ^2.12.0
@heroicons/react: ^2.1.0
```

---

## File Index

| File | Purpose |
|------|---------|
| `backend/migrations/014_analytics_module.sql` | Tables, MVs, RLS, cron functions |
| `backend/services/analytics_query_builder.py` | Safe parameterized query builder with whitelist |
| `backend/routers/analytics.py` | All REST endpoints |
| `backend/services/analytics_seed.py` | Pre-built dashboard creation on module activation |
| `backend/workers/report_scheduler.py` | Background worker for scheduled email reports |
| `src/hooks/useAnalytics.js` | Query, export, schedule hooks |
| `src/hooks/useDashboard.js` | Dashboard CRUD and widget management |
| `src/pages/AnalyticsPage.jsx` | Main page with tabs |
| `src/components/analytics/DashboardGrid.jsx` | Drag-drop widget grid |
| `src/components/analytics/WidgetRenderer.jsx` | Routes widget type to component |
| `src/components/analytics/MetricCard.jsx` | Big number with trend |
| `src/components/analytics/ChartWidget.jsx` | Line, Bar, Pie via Recharts |
| `src/components/analytics/FunnelChart.jsx` | Pipeline funnel visualization |
| `src/components/analytics/HeatmapChart.jsx` | Attendance heatmap |
| `src/components/analytics/DataTableWidget.jsx` | Sortable, filterable table |
| `src/components/analytics/WidgetConfigDrawer.jsx` | Widget configuration slide-over |
| `src/components/analytics/ReportBuilder.jsx` | Custom report query UI |
| `src/components/analytics/ReportScheduler.jsx` | Manage scheduled email reports |
| `tests/test_analytics_query.py` | Query builder unit tests |
| `tests/test_analytics_dashboards.py` | Dashboard CRUD integration tests |
| `tests/test_analytics_mv_refresh.py` | Materialized view tests |
| `tests/test_analytics_adhoc.py` | Ad-hoc query endpoint tests |
| `tests/test_analytics_export.py` | CSV/XLSX export tests |
| `tests/test_analytics_scheduling.py` | Report scheduling tests |
