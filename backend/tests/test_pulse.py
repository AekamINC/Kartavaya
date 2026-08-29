"""Pulse (proposal 68): the platform-console gate on every route, an audit
row per catalog fetch and per export, the tenant /run envelope key for key,
and the SHARED layout validator — imported, never inlined.

Same method as test_analytics_views.py / test_tab_prefs.py — a recording
pool proves WIRING; migration 155 owns the table, and every registry query
was live-probed read-only against the real database before this file was
written (a mock pool hides bad SQL — the credits `$1+$2` untyped parse error
500'd every spend and no suite noticed). The assertions that matter most:

  · every route stands behind THE console gate — admin_orgs' CONSOLE_ROLES
    through require_platform_role, asserted by dependency identity, so a
    mutant that invents its own role list is visible;
  · `_clean_pulse_layout` delegates geometry to routers.analytics'
    _clean_layout by MODULE IDENTITY — a mutant that inlines a copy fails
    here even if its behaviour matches today;
  · Pulse metrics are NOT in the shared tenant registry — held_level
    answers 'admin' to org admins for any module code, so a shared entry
    would surface platform metrics in tenant catalogues (the tenancy
    boundary services/pulse.py documents);
  · org NAMES, never ids: every org-listing metric labels rows o.name.
"""
import asyncio
import datetime
import inspect
import json
import pathlib
import re

import pytest
from fastapi import HTTPException
from fastapi.params import Depends as DependsParam

from analytics.registry import REGISTRY as TENANT_REGISTRY, MetricRequest
from routers import admin_orgs
from routers import analytics as ax
from routers import pulse as pr
from services.analytics_window import Window
from services.pulse import DEFAULT_LAYOUT, PULSE_REGISTRY, pulse_catalogue

USER = {"user_id": "user_aaa111"}
WIN_FROM, WIN_TO = "2026-07-19", "2026-08-18"


def run(coro):
    return asyncio.run(coro)


class FakeRequest:
    headers: dict = {}
    client = None


REQ = FakeRequest()


class RecordingPool:
    def __init__(self, rows=None, row=None):
        self.calls = []
        self._rows = rows or []
        self._row = row

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._rows

    async def fetchrow(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._row

    async def fetchval(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return None

    async def execute(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return "OK"


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(pr, "get_pool", _get_pool)
    return p


@pytest.fixture
def audit(monkeypatch):
    calls = []

    def _emit(action, request=None, **kw):
        calls.append({"action": action, **kw})

    monkeypatch.setattr(pr, "audit_emit", _emit)
    return calls


# ── the gate ─────────────────────────────────────────────────────────────────

def test_the_gate_is_the_consoles_own_not_an_invention():
    """The role list is admin_orgs' CONSOLE_ROLES by identity, through the
    house require_platform_role — a pulse-only role list would pass every
    behavioural test today and drift tomorrow."""
    import middleware.roles as roles

    assert pr.CONSOLE_ROLES is admin_orgs.CONSOLE_ROLES
    assert pr.require_platform_role is roles.require_platform_role


def test_the_gates_configured_role_set_is_console_roles_exactly():
    """The identity checks above pin the NAMES `pr` holds — not what
    `_pulse_gate` was BUILT with. A mutant that rebuilds the gate as
    `require_platform_role("platform_support")` leaves both identities
    intact and passes every behavioural test that stubs the dependency, so
    the role set is read back out of the gate's own closure and pinned to
    admin_orgs' CONSOLE_ROLES element for element."""
    closure = dict(zip(pr._pulse_gate.__code__.co_freevars,
                       (c.cell_contents
                        for c in (pr._pulse_gate.__closure__ or ()))))
    assert "allowed_roles" in closure, (
        "require_platform_role no longer closes over `allowed_roles` — "
        "re-pin this test to however the gate now carries its role set"
    )
    assert tuple(closure["allowed_roles"]) == tuple(admin_orgs.CONSOLE_ROLES), (
        "_pulse_gate was built with a role set that is not the console's "
        "CONSOLE_ROLES — the Pulse surface is gated wider or narrower than "
        "the platform console it belongs to"
    )


def test_every_route_stands_behind_the_gate():
    for route in pr.router.routes:
        deps = [p.default.dependency
                for p in inspect.signature(route.endpoint).parameters.values()
                if isinstance(p.default, DependsParam)]
        assert pr._pulse_gate in deps, f"{route.path} is not gated"


def test_a_non_platform_caller_is_403_in_the_house_voice(monkeypatch):
    """Through the REAL dependency: no platform row in staging.user_roles
    (fetchval None) refuses with the same sentence every console route
    speaks."""
    import middleware.roles as roles

    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(roles, "get_pool", _get_pool)
    with pytest.raises(HTTPException) as e:
        run(pr._pulse_gate(user=USER))
    assert e.value.status_code == 403
    assert "This action requires one of" in str(e.value.detail)
    # and the probe asked the platform-row question (org_id IS NULL)
    assert any("org_id IS NULL" in c[0] for c in p.calls)


# ── the registry stays out of the tenant registry ────────────────────────────

def test_pulse_metrics_never_reach_the_tenant_registry():
    """held_level answers 'admin' to any org admin for ANY module code, so a
    'pulse' entry in the shared dict would list platform-wide metrics in
    tenant catalogues and let tenants arm alerts on them."""
    assert not any(k.startswith("pulse.") for k in TENANT_REGISTRY)
    assert "pulse" not in {m.module for m in TENANT_REGISTRY.values()}


def test_the_catalogue_shape_is_the_tenant_meta_plus_viz():
    metas = pulse_catalogue()
    assert len(metas) == 19          # eighteen measured + one stated absence
    for m in metas:
        assert m["module"] == "pulse"
        assert m["key"].startswith("pulse.")
        assert m["grain"] in ("flow", "stock")
        assert m["viz"] in ("kpi", "trend", "bars", "table")
        assert set(m) >= {"key", "module", "label", "unit", "grain",
                          "dimensions", "sensitivity", "drill", "description"}
    absent = [m for m in metas if "absent" in m]
    assert [m["key"] for m in absent] == ["pulse.api_health"]
    assert "Railway and Sentry" in absent[0]["absent"]


def test_the_default_board_names_only_registered_measurable_metrics():
    for w in DEFAULT_LAYOUT:
        m = PULSE_REGISTRY.get(w["metric"])
        assert m is not None, w["metric"]
        assert m.absent is None, f"{w['metric']} is absent yet on the board"


def test_every_query_is_schema_qualified_and_every_bind_is_cast():
    """The shadow-tables lesson (142) and the PgBouncer cast rule, walked
    over every builder: each FROM/JOIN target is staging./public. or a CTE,
    and a flow's window binds are $n::date."""
    win = Window(datetime.date(2026, 7, 19), datetime.date(2026, 8, 18))
    ctes = {"acts", "last", "f", "d", "dau", "w", "spend"}
    for key, m in PULSE_REGISTRY.items():
        if m.absent:
            continue
        sql, params = m.sql(MetricRequest(
            org_id="", window=win if m.grain == "flow" else None, bucket="day"))
        for target in re.findall(r"(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)", sql):
            assert target.startswith(("staging.", "public.")) or target in ctes, \
                f"{key}: unqualified table {target!r}"
        if params:
            assert params == [win.start, win.end], key
            assert "$1::date" in sql and "$2::date" in sql, key


def test_org_metrics_label_rows_with_names_never_ids():
    win = Window(datetime.date(2026, 7, 19), datetime.date(2026, 8, 18))
    for key in ("pulse.quiet_orgs", "pulse.top_orgs", "pulse.churn_risk",
                "pulse.credit_burn", "pulse.storage"):
        m = PULSE_REGISTRY[key]
        sql, _ = m.sql(MetricRequest(
            org_id="", window=win if m.grain == "flow" else None, bucket="day"))
        assert "o.name AS label" in sql, key
        # No id column may leave a query as an OUTPUT alias.
        assert not re.search(r"AS\s+(?:org_id|user_id|uid)\b", sql), key


# ── /catalog ─────────────────────────────────────────────────────────────────

def test_catalog_answers_and_writes_the_audit_row(audit):
    out = run(pr.catalog(REQ, user=USER))
    assert [m["module"] for m in out["metrics"]] == ["pulse"] * 19
    assert set(out) == {"metrics", "buckets", "compare_modes", "formats"}
    assert [c["action"] for c in audit] == [pr.AUDIT_ACCESS]
    assert audit[0]["user_id"] == USER["user_id"]


# ── /run: the tenant envelope, key for key ───────────────────────────────────

def test_a_flow_answers_in_the_tenant_run_envelope(pool, audit):
    pool._rows = [{"period": datetime.date(2026, 7, 20), "value": 24, "punchers": 12}]
    out = run(pr.run(REQ, metric="pulse.clockins", date_from=WIN_FROM,
                     date_to=WIN_TO, bucket="day", user=USER))
    assert set(out) == {"metric", "label", "unit", "grain", "group_by",
                        "bucket", "window", "as_of", "data", "compare"}
    assert out["grain"] == "flow" and out["bucket"] == "day"
    assert out["window"]["windowed"] == ["pulse.clockins"]
    assert out["window"]["from"] == WIN_FROM and out["window"]["to"] == WIN_TO
    assert out["data"][0]["value"] == 24
    assert audit == []               # a json read is not an export


def test_a_stock_ignores_the_window_and_says_so(pool):
    pool._rows = [{"value": 7}]
    out = run(pr.run(REQ, metric="pulse.active_users_week",
                     date_from=WIN_FROM, date_to=WIN_TO, user=USER))
    assert out["bucket"] is None
    assert out["window"]["windowed"] == []
    assert "ignored" in out["window"]["note"]
    # and the query itself was bound with nothing — stocks take no params
    assert pool.calls[0][1] == []


def test_a_flow_without_a_window_is_400_in_words(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.run(REQ, metric="pulse.active_users", user=USER))
    assert e.value.status_code == 400
    assert "date_from" in str(e.value.detail)
    assert pool.calls == []


def test_the_absent_metric_refuses_to_run_in_words(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.run(REQ, metric="pulse.api_health", user=USER))
    assert e.value.status_code == 422
    assert e.value.detail["absent"] == \
        "measured in Railway and Sentry — linked, not queried"
    assert pool.calls == []


def test_an_unknown_metric_is_404(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.run(REQ, metric="pulse.astrology", user=USER))
    assert e.value.status_code == 404


def test_a_csv_export_writes_the_audit_row(pool, audit):
    pool._rows = [{"period": datetime.date(2026, 7, 20), "value": 24, "punchers": 12}]
    resp = run(pr.run(REQ, metric="pulse.clockins", date_from=WIN_FROM,
                      date_to=WIN_TO, bucket="day", format="csv", user=USER))
    assert resp.media_type.startswith("text/csv")
    assert [c["action"] for c in audit] == [pr.AUDIT_EXPORT]
    assert audit[0]["detail"]["format"] == "csv"


def test_an_unknown_format_is_400_not_a_silent_json(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.run(REQ, metric="pulse.clockins", date_from=WIN_FROM,
                   date_to=WIN_TO, format="parquet", user=USER))
    assert e.value.status_code == 400


# ── the board: shared validator, personal row, code floor ────────────────────

def test_the_geometry_validator_is_the_tenant_one_by_identity():
    """Import, never copy — a mutant that inlines a lookalike fails on
    module identity even while its behaviour still matches."""
    assert pr._clean_layout is ax._clean_layout
    assert inspect.getmodule(pr._clean_layout).__name__ == "routers.analytics"


def test_put_view_accepts_geometry_and_upserts_one_row(pool):
    pool._row = {"updated_at": datetime.datetime(2026, 8, 18)}
    layout = [{"metric": "pulse.active_users", "viz": "trend",
               "w": 6, "x": 3, "y": 2, "h": 4, "onclick": "alert(1)"}]
    out = run(pr.put_view(pr.PulseViewPut(layout=layout), user=USER))
    # junk keys stripped by the shared whitelist; geometry and the REAL
    # pulse key survive the proxy round-trip
    assert out["layout"] == [{"metric": "pulse.active_users", "viz": "trend",
                              "w": 6, "x": 3, "y": 2, "h": 4}]
    sql, args = pool.calls[0]
    assert "public.pulse_views" in sql
    assert "ON CONFLICT (user_id)" in sql
    assert args[0] == USER["user_id"]
    assert json.loads(args[1]) == out["layout"]


def test_put_view_refuses_past_the_grid_rim_via_the_shared_rule(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.put_view(pr.PulseViewPut(layout=[
            {"metric": "pulse.active_users", "viz": "kpi", "w": 6, "x": 8},
        ]), user=USER))
    assert e.value.status_code == 422
    assert "12-column grid" in str(e.value.detail)
    assert pool.calls == []          # a refused layout never reaches SQL


def test_put_view_refuses_a_non_pulse_metric_by_name(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.put_view(pr.PulseViewPut(layout=[
            {"metric": "ganit.dso", "viz": "kpi", "w": 1},
        ]), user=USER))
    assert e.value.status_code == 422
    assert "ganit.dso" in str(e.value.detail)
    assert pool.calls == []


def test_get_view_falls_back_to_the_code_default(pool):
    out = run(pr.get_view(user=USER))
    assert out["source"] == "default"
    assert out["layout"] is DEFAULT_LAYOUT
    assert out["updated_at"] is None


def test_get_view_returns_the_saved_personal_row(pool):
    saved = [{"metric": "pulse.storage", "viz": "table", "w": 12}]
    pool._row = {"layout": json.dumps(saved),
                 "updated_at": datetime.datetime(2026, 8, 18)}
    out = run(pr.get_view(user=USER))
    assert out["source"] == "personal"
    assert out["layout"] == saved


# ── /report: the whole board, one document, audited ──────────────────────────

def test_report_runs_the_board_and_states_absences(pool, audit):
    pool._row = {"layout": json.dumps([
        {"metric": "pulse.api_health", "viz": "kpi", "w": 3},
        {"metric": "pulse.retired_key", "viz": "kpi", "w": 3},
    ])}
    out = run(pr.report(REQ, date_from=WIN_FROM, date_to=WIN_TO, user=USER))
    assert out["module"] == "pulse" and out["source"] == "personal"
    absents = [w["absent"] for w in out["widgets"]]
    assert "Railway and Sentry" in absents[0]
    assert "no longer measured" in absents[1]
    assert [c["action"] for c in audit] == [pr.AUDIT_EXPORT]
    assert audit[0]["detail"] == {"format": "json", "widgets": 2}


def test_report_without_a_window_is_400(pool):
    with pytest.raises(HTTPException) as e:
        run(pr.report(REQ, user=USER))
    assert e.value.status_code == 400
    assert "period" in str(e.value.detail)


def test_report_csv_carries_the_neutral_identity_not_an_org(pool, audit):
    resp = run(pr.report(REQ, date_from=WIN_FROM, date_to=WIN_TO,
                         format="csv", user=USER))
    text = resp.body.decode("utf-8")
    assert "Kartavaya — Pulse" in text
    assert [c["action"] for c in audit] == [pr.AUDIT_EXPORT]


# ── migration 155: additive only, the reviewed contract ──────────────────────

def test_migration_155_is_additive_and_names_the_contract():
    path = pathlib.Path(__file__).resolve().parents[1] / "migrations" / "155_pulse_views.sql"
    sql = path.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS staging.pulse_views" in sql
    assert re.search(r"user_id\s+TEXT\s+PRIMARY\s+KEY", sql)
    assert re.search(r"layout\s+JSONB\s+NOT\s+NULL", sql)
    assert "BEGIN;" in sql and "COMMIT;" in sql
    # Shared database: nothing existing may be touched. The DOWN block is
    # commentary; every executable line must be additive.
    live = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
    for verb in ("ALTER ", "DROP ", "UPDATE ", "DELETE ", "INSERT "):
        assert verb not in live.upper(), f"{verb.strip()} in a 155 executable line"
    assert "share" in sql.lower()    # the shared-DB note is stated, like 154
