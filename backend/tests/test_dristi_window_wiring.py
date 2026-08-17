"""The window reaches the SQL, and its absence leaves the SQL alone.

These drive the handlers against a recording pool, so they prove *wiring*:
which queries gained a BETWEEN, what got bound to it, and that the stock blocks
were left alone. They do NOT prove the SQL is valid — a fake pool accepts any
string. The new predicates were probed against the live database separately;
see the D1 note in the session log.

The important assertion is the negative one. Every "unwindowed" test compares
the emitted SQL against the query as it stood before D1: a retrofit that
quietly changes what an existing caller receives is not a retrofit.
"""
import asyncio
from datetime import date

import pytest

from routers import dristi


class RecordingPool:
    """Captures (sql, args) and replays canned rows in call order."""

    def __init__(self, rows=None, row=None):
        self.calls = []
        self._rows = rows or {}
        self._row = row or {}

    def _record(self, sql, args):
        self.calls.append((" ".join(sql.split()), list(args)))

    async def fetch(self, sql, *args):
        self._record(sql, args)
        return self._rows.get(len(self.calls), [])

    async def fetchrow(self, sql, *args):
        self._record(sql, args)
        return self._row.get(len(self.calls))

    async def fetchval(self, sql, *args):
        self._record(sql, args)
        return 0

    # what the handlers ask of it beyond querying
    def sql_containing(self, needle):
        return [c for c in self.calls if needle in c[0]]


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(dristi, "get_pool", _get_pool)

    async def _reachable(_pool, _user, _org, mods):
        return set(mods)          # every module reachable; entitlement is tested elsewhere

    monkeypatch.setattr(dristi, "reachable_modules", _reachable)
    return p


USER = {"user_id": "11111111-1111-1111-1111-111111111111"}
ORG = "22222222-2222-2222-2222-222222222222"
FROM, TO = "2026-04-01", "2026-06-30"
DATES = [date(2026, 4, 1), date(2026, 6, 30)]


def run(coro):
    # asyncio.run, not get_event_loop: Python 3.12+ raises rather than creating
    # an implicit loop on the main thread.
    return asyncio.run(coro)


# ── /overview ─────────────────────────────────────────────────────────────────

def test_overview_without_a_window_binds_only_the_org(pool):
    out = run(dristi.overview(user=USER, org_id=ORG))
    assert out["window"] is None
    assert not pool.sql_containing("BETWEEN"), "no query should have gained a range"
    # the payroll query keeps its year-to-date LIKE, exactly as before
    assert pool.sql_containing("month LIKE $2")


def test_overview_windows_the_flows_and_leaves_the_stocks_alone(pool):
    out = run(dristi.overview(date_from=FROM, date_to=TO, user=USER, org_id=ORG))

    assert out["window"]["from"] == FROM and out["window"]["to"] == TO
    assert out["window"]["windowed"] == ["orders", "payroll", "revenue"]
    assert out["window"]["as_at"] == ["crm", "deals", "hr", "tasks"]

    invoices = pool.sql_containing("ganit_invoices")[0]
    assert "invoice_date BETWEEN $2::date AND $3::date" in invoices[0]
    assert invoices[1][1:] == DATES

    orders = pool.sql_containing("vikray_orders")[0]
    assert "order_date BETWEEN $2::date AND $3::date" in orders[0]

    # headcount, contacts and open tasks are current-state and must not be filtered
    for stock in ("manav_employees", "graha_contacts", "FROM tasks"):
        found = pool.sql_containing(stock)
        assert found, f"expected a {stock} query"
        assert "BETWEEN" not in found[0][0], f"{stock} is a stock, not a flow"


def test_overview_payroll_window_is_month_text_not_dates(pool):
    run(dristi.overview(date_from=FROM, date_to=TO, user=USER, org_id=ORG))
    payroll = pool.sql_containing("vetana_payroll_runs")[0]
    assert "month BETWEEN $2 AND $3" in payroll[0]
    # TEXT 'YYYY-MM', zero-padded, so lexicographic order is chronological order
    assert payroll[1][1:] == ["2026-04", "2026-06"]


# ── /revenue ──────────────────────────────────────────────────────────────────

def test_revenue_without_a_window_keeps_the_one_year_lookback(pool):
    out = run(dristi.revenue_trends(user=USER, org_id=ORG))
    assert out["window"] is None
    assert pool.sql_containing("INTERVAL '1 year'")
    assert len(out["labels"]) == 6          # the months= default, untouched


def test_revenue_window_supersedes_months_and_labels_the_range(pool):
    out = run(dristi.revenue_trends(months=6, date_from=FROM, date_to=TO,
                                    user=USER, org_id=ORG))
    assert out["labels"] == ["2026-04", "2026-05", "2026-06"]
    assert not pool.sql_containing("INTERVAL '1 year'")
    for c in pool.calls:
        assert "BETWEEN $2::date AND $3::date" in c[0]
        assert c[1][1:] == DATES


# ── /pipeline ─────────────────────────────────────────────────────────────────

def test_pipeline_windows_resolution_not_the_standing_pipeline(pool):
    out = run(dristi.pipeline_analytics(date_from=FROM, date_to=TO, user=USER, org_id=ORG))
    assert out["window"]["windowed"] == ["top_contacts", "won_trend"]
    assert out["window"]["as_at"] == ["conversion", "stages"]

    # a deal sitting in Negotiation is there today, whatever dates were asked for
    stages = pool.calls[0]
    assert "GROUP BY stage" in stages[0] and "BETWEEN" not in stages[0]

    won = pool.sql_containing("stage='Won' AND updated_at::date BETWEEN")
    assert won and won[0][1][1:] == DATES


# ── /hr ───────────────────────────────────────────────────────────────────────

def test_hr_without_a_window_keeps_its_original_spans(pool):
    out = run(dristi.hr_analytics(user=USER, org_id=ORG))
    assert out["window"] is None
    assert pool.sql_containing("DATE_TRUNC('year', CURRENT_DATE)")   # leave stats
    assert pool.sql_containing("INTERVAL '30 days'")                 # attendance


def test_hr_windows_payroll_leave_and_attendance_but_not_departments(pool):
    out = run(dristi.hr_analytics(date_from=FROM, date_to=TO, user=USER, org_id=ORG))
    assert out["window"]["as_at"] == ["departments"]

    depts = pool.sql_containing("GROUP BY e.department")
    assert depts and "BETWEEN" not in depts[0][0]

    assert pool.sql_containing("start_date BETWEEN $2::date AND $3::date")
    assert pool.sql_containing("date BETWEEN $2::date AND $3::date")
    assert pool.sql_containing("month BETWEEN $2 AND $3")


# ── /sales ────────────────────────────────────────────────────────────────────

def test_sales_windows_the_trend_and_never_the_leaderboard(pool):
    out = run(dristi.sales_analytics(date_from=FROM, date_to=TO, user=USER, org_id=ORG))
    assert out["window"]["windowed"] == ["order_trend"]

    trend = pool.sql_containing("TO_CHAR(order_date")
    assert trend and "order_date BETWEEN $2::date AND $3::date" in trend[0][0]

    # each target carries its own period; a second window over it would score
    # attainment against a target nobody set for those dates
    board = pool.sql_containing("vikray_targets")
    assert board and "BETWEEN $2::date" not in board[0][0]


# ── exports ───────────────────────────────────────────────────────────────────

def test_export_fetch_without_a_window_is_the_old_query(pool):
    run(dristi._fetch_report_data(pool, ORG, "revenue"))
    assert pool.calls[0][1] == [ORG]
    assert "BETWEEN" not in pool.calls[0][0]


def test_export_fetch_binds_the_window(pool):
    from services import analytics_window as aw
    win = aw.parse(FROM, TO)
    run(dristi._fetch_report_data(pool, ORG, "revenue", win))
    assert "invoice_date BETWEEN $2::date AND $3::date" in pool.calls[0][0]
    assert pool.calls[0][1] == [ORG, *DATES]


def test_export_fetch_leaves_headcount_alone(pool):
    from services import analytics_window as aw
    run(dristi._fetch_report_data(pool, ORG, "hr", aw.parse(FROM, TO)))
    # headcount is a stock; there is no date column to window and none invented
    assert "BETWEEN" not in pool.calls[0][0]
    assert pool.calls[0][1] == [ORG]
