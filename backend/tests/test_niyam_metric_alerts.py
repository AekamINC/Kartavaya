"""D7: a threshold on any metric raises a Niyam event — and nothing else.

The one design fact these tests protect: the alert evaluates THE METRIC'S OWN
registry SQL, reduced the way the dashboard's KPI tiles reduce it. There is
no second DSO formula to drift; the evaluator's honesty lives in what it
refuses to reduce (a rate series) and what it skips loudly (a retired or
absent metric) instead of erroring a sweep tick over configuration.
"""
from __future__ import annotations

import datetime

import pytest

from services.niyam.metric_alerts import _breached, _reduce, run_alerts

NOW = datetime.datetime(2026, 8, 18, 6, 0, tzinfo=datetime.timezone.utc)
ORG = "22222222-2222-2222-2222-222222222222"


# ── the reduction is the KPI tile's, stated once ─────────────────────────────

def test_one_row_is_its_value():
    assert _reduce([{"value": 47.2}], "days") == (47.2, None)


def test_a_flow_series_sums_to_its_window_total():
    v, why = _reduce([{"value": 10}, {"value": 5}, {"value": None}], "count")
    assert (v, why) == (15.0, None)


def test_a_rate_series_is_refused_never_averaged():
    v, why = _reduce([{"value": 50.0}, {"value": 60.0}], "pct")
    assert v is None
    assert "mean of period rates" in why


def test_no_rows_is_a_stated_reason_not_a_zero():
    v, why = _reduce([], "inr")
    assert v is None and "no rows" in why


def test_breach_directions():
    assert _breached(46, "gt", 45) and not _breached(45, "gt", 45)
    assert _breached(89, "lt", 90) and not _breached(90, "lt", 90)


# ── the pass over configured alerts ──────────────────────────────────────────

class _Conn:
    def __init__(self, parent):
        self.parent = parent

    async def fetch(self, sql, *args):
        if "FROM staging.analytics_alerts" in sql:
            return self.parent.alerts
        # the metric's own SQL — answer whatever the case queued
        return self.parent.metric_rows

    async def execute(self, sql, *args):
        self.parent.executed.append((sql, args))

    async def fetchval(self, sql, *args):
        # the emitter's dedupe insert path goes through subjects.temporal ->
        # emit_event; not exercised here (patched below)
        return None

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *a):
                return False
        return _T()


class _Pool:
    def __init__(self, alerts, metric_rows):
        self.alerts = alerts
        self.metric_rows = metric_rows
        self.executed = []

    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return _Conn(pool)

            async def __aexit__(_s, *a):
                return False
        return _A()


def _alert(metric="ganit.dso", operator="gt", threshold=45.0, days=30):
    return {"id": "aaaaaaaa-0000-0000-0000-000000000001", "org_id": ORG,
            "metric": metric, "operator": operator, "threshold": threshold,
            "window_days": days}


@pytest.fixture
def emitted(monkeypatch):
    calls = []

    async def _temporal(conn, **kw):
        calls.append(kw)
        return len(calls)          # a truthy event id

    import services.niyam.metric_alerts as MA
    monkeypatch.setattr(MA, "temporal", _temporal)
    return calls


async def test_a_breach_emits_the_dashboards_own_number(emitted):
    pool = _Pool([_alert()], [{"value": 61.4}])
    out = await run_alerts(pool, now=NOW)
    assert out["breached"] == 1 and out["emitted"] == 1
    [e] = emitted
    assert e["event_type"] == "metric.threshold"
    assert e["after"]["value"] == 61.4
    assert e["after"]["threshold"] == 45.0
    assert e["after"]["metric"] == "ganit.dso"
    assert e["after"]["label"], "the payload names the metric for humans"
    # once per alert per day: the DATE is in the key
    assert e["dedupe_key"].endswith(":2026-08-18")


async def test_no_breach_emits_nothing(emitted):
    pool = _Pool([_alert()], [{"value": 12.0}])
    out = await run_alerts(pool, now=NOW)
    assert out == {"checked": 1, "breached": 0, "emitted": 0,
                   "deduped": 0, "skipped": 0}
    assert emitted == []


async def test_a_retired_metric_is_skipped_loudly_not_an_error(emitted):
    pool = _Pool([_alert(metric="ganit.retired_forever")], [{"value": 1}])
    out = await run_alerts(pool, now=NOW)
    assert out["skipped"] == 1 and out["checked"] == 0
    assert emitted == []


async def test_an_absent_metric_cannot_alert(emitted):
    # manav.span_of_control is declared absent (unwritten reporting_to)
    pool = _Pool([_alert(metric="manav.span_of_control")], [{"value": 1}])
    out = await run_alerts(pool, now=NOW)
    assert out["skipped"] == 1
    assert emitted == []


async def test_one_broken_alert_does_not_silence_the_next(emitted):
    class _ExplodingPool(_Pool):
        def __init__(self):
            super().__init__(
                [_alert(metric="ganit.dso"), _alert(metric="ganit.outstanding")],
                [{"value": 99.0}])
            self.first = True

    pool = _ExplodingPool()
    real_rows = pool.metric_rows

    # first metric query raises, second answers
    orig_fetch = _Conn.fetch

    async def flaky(self, sql, *args):
        if "FROM staging.analytics_alerts" in sql:
            return self.parent.alerts
        if self.parent.first:
            self.parent.first = False
            raise RuntimeError("connection reset")
        return real_rows

    _Conn.fetch = flaky
    try:
        out = await run_alerts(pool, now=NOW)
    finally:
        _Conn.fetch = orig_fetch
    assert out["skipped"] == 1
    assert out["breached"] == 1, "the second alert still ran"


def test_the_template_delivers_to_the_admins():
    from services.niyam.templates import TEMPLATES
    from services.niyam.validate import validate_steps
    [t] = [t for t in TEMPLATES if t["id"] == "metric-threshold-tell-admins"]
    assert validate_steps(t["event_type"], t["steps"])
    [action] = [s["config"] for s in t["steps"] if s["kind"] == "action"]
    assert action["to"] == ["@org_admins"]


# ── the tick carries both passes — the regression that 500'd every sweep ─────

async def test_the_tick_reports_predicates_and_alerts_apart(monkeypatch):
    """2026-08-18: a blind edit turned the tick's result into
    `alerts["predicates"]` — a key run_alerts never returns — and every
    armed sweep answered 500 for forty minutes. The result shape is now a
    pinned contract: the predicate counts and the alert counts, SEPARATE,
    under their own names."""
    import services.niyam.sweep as SW

    async def _claim(pool):
        return True

    async def _release(pool, *, result=None):
        return None

    async def _run_all(pool, now):
        return {"predicates": {"tasks_overdue": {"found": 0}}, "errors": 0}

    async def _run_alerts(pool, now):
        return {"checked": 1, "breached": 0, "emitted": 0,
                "deduped": 0, "skipped": 0}

    async def _drain(pool, now=None):
        return {"events_drained": 0, "runs_started": 0, "errors": 0}

    async def _resume(pool, now=None):
        return {"waits_resumed": 0, "errors": 0}

    import services.niyam.predicates as P
    import services.niyam.metric_alerts as MA
    monkeypatch.setattr(SW, "_claim_tick", _claim)
    monkeypatch.setattr(SW, "_release_tick", _release, raising=False)
    monkeypatch.setattr(P, "run_all", _run_all)
    monkeypatch.setattr(MA, "run_alerts", _run_alerts)
    monkeypatch.setattr(SW, "drain", _drain)
    monkeypatch.setattr(SW, "resume_waits", _resume)

    out = await SW.tick(object())
    assert out["predicates"] == {"tasks_overdue": {"found": 0}}
    assert out["metric_alerts"]["checked"] == 1
    assert out["errors"] == 0
