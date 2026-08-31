"""The /api/v1/analytics contract, driven against a recording pool.

Same method as test_dristi_window_wiring.py: these prove WIRING — which gate
ran, what was refused, what got bound — not SQL validity, which the live
probes own. The two assertions that matter most are negative ones: the ganit
metric MUST pass through require_module (subscription state + the sensitive-
module audit row live only there), and the core metric MUST NOT (core PM is
the deliberately ungated surface — role_tiers.py).
"""
import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from routers import analytics as ax


class RecordingPool:
    def __init__(self, rows=None):
        self.calls = []
        self._rows = rows if rows is not None else []

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._rows

    async def fetchrow(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return None

    async def fetchval(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return 0


class FakeRequest:
    """Just enough request for require_module's recorded double."""

    class _State:
        _auth_user = {"user_id": "u-1"}

    state = _State()
    method = "GET"


USER = {"user_id": "11111111-1111-1111-1111-111111111111"}
ORG = "22222222-2222-2222-2222-222222222222"
FROM, TO = "2026-04-01", "2026-06-30"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(ax, "get_pool", _get_pool)
    return p


@pytest.fixture
def gate(monkeypatch):
    """require_module recorded: gate.calls collects module codes checked."""
    calls = []

    def _require_module(code):
        async def _check(request, org_id):
            calls.append(code)
        return _check

    monkeypatch.setattr(ax, "require_module", _require_module)

    class G:
        pass

    g = G()
    g.calls = calls
    return g


# ── refusals ─────────────────────────────────────────────────────────────────

def test_unknown_metric_is_404(pool, gate):
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="nope.nothing", user=USER, org_id=ORG))
    assert e.value.status_code == 404


def test_declared_absent_is_422_with_the_reason(pool, gate):
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="ganit.tds_by_section",
                   date_from=FROM, date_to=TO, user=USER, org_id=ORG))
    assert e.value.status_code == 422
    assert "section column" in e.value.detail["absent"]


def test_flow_without_a_window_is_400(pool, gate):
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="ganit.invoiced", user=USER, org_id=ORG))
    assert e.value.status_code == 400
    assert "date_from" in e.value.detail


def test_unknown_format_is_400_never_a_silent_json(pool, gate):
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
                   date_to=TO, format="yaml", user=USER, org_id=ORG))
    assert e.value.status_code == 400
    assert "format" in e.value.detail


def test_bad_group_by_is_400(pool, gate):
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
                   date_to=TO, group_by="drop table", user=USER, org_id=ORG))
    assert e.value.status_code == 400


def test_bad_bucket_is_400(pool, gate):
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
                   date_to=TO, bucket="fortnight", user=USER, org_id=ORG))
    assert e.value.status_code == 400


# ── the gate ─────────────────────────────────────────────────────────────────

def test_a_ganit_metric_passes_through_require_module(pool, gate):
    run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
               date_to=TO, user=USER, org_id=ORG))
    assert gate.calls == ["ganit"]


def test_a_core_metric_never_touches_require_module(pool, gate):
    """core is not a module code — require_module('core') would refuse every
    org its own task counts. Membership, already proven, is the entitlement."""
    run(ax.run(FakeRequest(), metric="core.tasks_by_status", user=USER, org_id=ORG))
    assert gate.calls == []


def test_the_gate_runs_before_validation(pool, gate, monkeypatch):
    """A caller without the module must not learn which parameters are valid —
    the gate's refusal wins over the 400s."""
    def _refusing(code):
        async def _check(request, org_id):
            raise HTTPException(403, "no")
        return _check
    monkeypatch.setattr(ax, "require_module", _refusing)
    with pytest.raises(HTTPException) as e:
        run(ax.run(FakeRequest(), metric="ganit.invoiced", format="yaml",
                   user=USER, org_id=ORG))
    assert e.value.status_code == 403


# ── flows, stocks, compare ───────────────────────────────────────────────────

def test_a_flow_binds_its_window_and_says_so(pool, gate):
    out = run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
                     date_to=TO, user=USER, org_id=ORG))
    sql, args = pool.calls[0]
    assert args[1] == date(2026, 4, 1) and args[2] == date(2026, 6, 30)
    assert out["window"]["from"] == FROM and out["window"]["to"] == TO
    assert out["window"]["windowed"] == ["ganit.invoiced"]


def test_a_stock_ignores_the_bounds_and_answers_as_at(pool, gate):
    out = run(ax.run(FakeRequest(), metric="core.tasks_by_status",
                     date_from=FROM, date_to=TO, user=USER, org_id=ORG))
    sql, args = pool.calls[0]
    assert len(args) == 1, "a stock bound a window it claims to ignore"
    assert out["window"]["as_at"] == date.today().isoformat()
    assert "ignored" in out["window"]["note"]


def test_compare_previous_period_abuts(pool, gate):
    run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
               date_to=TO, compare="previous_period", user=USER, org_id=ORG))
    assert len(pool.calls) == 2
    _, cargs = pool.calls[1]
    # 91-day window: the previous one ends the day before it starts.
    assert cargs[2] == date(2026, 3, 31)
    assert cargs[1] == date(2026, 3, 31) - (date(2026, 6, 30) - date(2026, 4, 1))


def test_compare_previous_year_holds_the_dates(pool, gate):
    run(ax.run(FakeRequest(), metric="ganit.invoiced", date_from=FROM,
               date_to=TO, compare="previous_year", user=USER, org_id=ORG))
    _, cargs = pool.calls[1]
    assert cargs[1] == date(2025, 4, 1) and cargs[2] == date(2025, 6, 30)


# ── the catalogue ────────────────────────────────────────────────────────────

#: The catalogue now asks BOTH halves of the module gate — the person's grant
#: (`held_level`) and the org's subscription (`org_module_refusal`). These two
#: tests are about the metric list's SHAPE, so the org half is answered "active"
#: and the person half is what each one varies. The org half has its own file:
#: `test_catalogue_offers_only_what_run_answers.py`.
def _org_says_active(monkeypatch):
    async def _ok(pool_, org_id, code):
        return None
    monkeypatch.setattr(ax, "org_module_refusal", _ok)


def test_catalogue_intersects_reachable_modules(pool, monkeypatch):
    async def _held(pool_, user_id, org_id, code):
        return None  # no module reachable

    monkeypatch.setattr(ax, "held_level", _held)
    _org_says_active(monkeypatch)
    out = run(ax.catalogue(user=USER, org_id=ORG))
    listed = {m["module"] for m in out["metrics"]}
    # core survives — it is ungated by design; everything else is withheld
    # and COUNTED, the same honesty line /widget-types draws.
    assert listed == {"core"}
    assert out["withheld_count"] == len(ax.REGISTRY) - len(out["metrics"])


def test_catalogue_lists_absent_metrics_with_reasons(pool, monkeypatch):
    async def _held(pool_, user_id, org_id, code):
        return "admin"

    monkeypatch.setattr(ax, "held_level", _held)
    _org_says_active(monkeypatch)
    out = run(ax.catalogue(user=USER, org_id=ORG))
    absent = {m["key"]: m for m in out["metrics"] if m.get("absent")}
    assert "ganit.tds_by_section" in absent
    assert "core.project_margin" in absent
