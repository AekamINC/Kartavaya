"""Saved views (D3) and presets (D6): validated on save, resolved in order.

Same method as test_analytics_run.py — a recording pool proves WIRING (what
was refused, what got bound, which SQL shape ran); the live migration owns
the table. The assertions that matter most:

  · a layout that names an unregistered metric is UNWRITABLE (422 naming it),
    the same save-time promise validate_steps makes for Niyam rules;
  · the resolution order is personal > org > preset, applied server-side so
    every surface agrees on it;
  · a foreign personal view answers 404 — not 403 — because a view's
    existence is not another user's to probe.
"""
import asyncio
import json

import pytest
from fastapi import HTTPException

from analytics.presets import PRESETS, VIZ_TYPES
from analytics.registry import REGISTRY
from routers import analytics as ax

USER = {"user_id": "user_aaa111"}
ORG = "22222222-2222-2222-2222-222222222222"


def run(coro):
    return asyncio.run(coro)


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

    async def execute(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return "OK"


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(ax, "get_pool", _get_pool)
    return p


@pytest.fixture
def all_reachable(monkeypatch):
    async def _held(pool, user_id, org_id, code):
        return "editor"

    monkeypatch.setattr(ax, "held_level", _held)


# ── presets are declarations the registry must honour ────────────────────────

def test_every_preset_widget_names_a_registered_metric():
    for key, p in PRESETS.items():
        for w in p["layout"]:
            assert w["metric"] in REGISTRY, f"{key}: {w['metric']}"
            assert w["viz"] in VIZ_TYPES, f"{key}: {w['viz']}"
            assert w["w"] in (1, 2, 3), f"{key}: w={w['w']}"


def test_every_preset_explains_itself_and_names_its_modules():
    for key, p in PRESETS.items():
        assert len(p["why"]) > 40, key
        used = {REGISTRY[w["metric"]].module for w in p["layout"]}
        assert used <= set(p["modules"]), \
            f"{key} draws on {used - set(p['modules'])} without declaring it"


def test_preset_cut_to_a_module_tab_keeps_only_that_module():
    cut = ax._presets_for("ganit", {"ganit", "core"})
    assert cut, "no preset survives a ganit cut"
    for p in cut:
        for w in p["layout"]:
            assert REGISTRY[w["metric"]].module == "ganit"


def test_preset_cut_on_the_cross_surface_respects_entitlement():
    cut = ax._presets_for(ax.CROSS_MODULE, {"core"})   # org without ganit
    for p in cut:
        for w in p["layout"]:
            assert REGISTRY[w["metric"]].module == "core"
    # finance is ganit-only: with core alone it must be omitted, not a husk
    assert "finance" not in {p["key"] for p in cut}


# ── the save-time whitelist ──────────────────────────────────────────────────

def test_an_unregistered_metric_is_unwritable_and_named():
    with pytest.raises(HTTPException) as e:
        ax._clean_layout([{"metric": "ganit.nonsense", "viz": "kpi", "w": 1}])
    assert e.value.status_code == 422
    assert "ganit.nonsense" in str(e.value.detail)


@pytest.mark.parametrize("bad,expect", [
    ({"metric": "ganit.dso", "viz": "hologram", "w": 1}, "hologram"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": 9}, "grid columns"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": 1, "group_by": "moon"}, "moon"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": 1, "columns": ["x"]}, "table"),
])
def test_malformed_widgets_are_refused_with_the_offence(bad, expect):
    with pytest.raises(HTTPException) as e:
        ax._clean_layout([bad])
    assert e.value.status_code == 422
    assert expect in str(e.value.detail)


def test_the_layout_is_rebuilt_not_stored_verbatim():
    """A whitelist: junk keys a client smuggles in never reach the row."""
    out = ax._clean_layout([{
        "metric": "ganit.dso", "viz": "kpi", "w": 1,
        "onclick": "alert(1)", "style": "position:fixed",
    }])
    assert out == [{"metric": "ganit.dso", "viz": "kpi", "w": 1}]


def test_a_view_holds_at_most_the_ceiling():
    with pytest.raises(HTTPException) as e:
        ax._clean_layout(
            [{"metric": "ganit.dso", "viz": "kpi", "w": 1}] * (ax.MAX_WIDGETS + 1))
    assert e.value.status_code == 422


# ── resolution: personal > org > preset ──────────────────────────────────────

def _view_row(vid, user_id, name, default=False):
    import datetime
    return {"id": vid, "user_id": user_id, "name": name,
            "layout": json.dumps([{"metric": "ganit.dso", "viz": "kpi", "w": 1}]),
            "is_default": default,
            "updated_at": datetime.datetime(2026, 8, 18)}


def test_personal_default_wins(monkeypatch, pool, all_reachable):
    pool._rows = [
        _view_row("v1", USER["user_id"], "mine", default=True),
        _view_row("v2", None, "org one", default=True),
    ]
    out = run(ax.list_views(module="ganit", user=USER, org_id=ORG))
    assert out["resolved"]["source"] == "personal"
    assert out["resolved"]["name"] == "mine"


def test_org_default_wins_when_nothing_personal_is_default(
        monkeypatch, pool, all_reachable):
    pool._rows = [
        _view_row("v1", USER["user_id"], "mine", default=False),
        _view_row("v2", None, "org one", default=True),
    ]
    out = run(ax.list_views(module="ganit", user=USER, org_id=ORG))
    assert out["resolved"]["source"] == "org"


def test_preset_is_the_floor(monkeypatch, pool, all_reachable):
    pool._rows = []
    out = run(ax.list_views(module="ganit", user=USER, org_id=ORG))
    assert out["resolved"]["source"].startswith("preset:")
    assert out["resolved"]["layout"], "the preset floor must carry widgets"


def test_an_unknown_module_is_404(pool, all_reachable):
    with pytest.raises(HTTPException) as e:
        run(ax.list_views(module="astrology", user=USER, org_id=ORG))
    assert e.value.status_code == 404


def test_an_unreachable_module_is_403(monkeypatch, pool):
    async def _held(pool, user_id, org_id, code):
        return None

    monkeypatch.setattr(ax, "held_level", _held)
    with pytest.raises(HTTPException) as e:
        run(ax.list_views(module="ganit", user=USER, org_id=ORG))
    assert e.value.status_code == 403


# ── writes ───────────────────────────────────────────────────────────────────

def test_org_scope_needs_an_org_admin(monkeypatch, pool, all_reachable):
    import middleware.roles as roles

    async def _no(user_id, org_id=None):
        return None

    monkeypatch.setattr(roles, "admin_org_id", _no)
    with pytest.raises(HTTPException) as e:
        run(ax.create_view(
            ax.ViewCreate(module="ganit", name="Org view", scope="org",
                          layout=[{"metric": "ganit.dso", "viz": "kpi", "w": 1}]),
            user=USER, org_id=ORG))
    assert e.value.status_code == 403


def test_setting_a_default_clears_the_same_scope_first(
        monkeypatch, pool, all_reachable):
    pool._row = _view_row("v9", USER["user_id"], "mine", default=True)
    run(ax.create_view(
        ax.ViewCreate(module="ganit", name="mine", scope="personal",
                      is_default=True,
                      layout=[{"metric": "ganit.dso", "viz": "kpi", "w": 1}]),
        user=USER, org_id=ORG))
    cleared = [c for c in pool.calls if "SET is_default = FALSE" in c[0]]
    assert len(cleared) == 1
    # scoped to (org, module, owner) — IS NOT DISTINCT FROM so the org scope
    # (NULL owner) clears org defaults, never personal ones
    assert "IS NOT DISTINCT FROM" in cleared[0][0]


def test_a_foreign_personal_view_is_a_404_not_a_403(
        monkeypatch, pool, all_reachable):
    pool._row = _view_row("v1", "user_somebody_else", "theirs")
    with pytest.raises(HTTPException) as e:
        run(ax.delete_view("11111111-0000-0000-0000-000000000000",
                           user=USER, org_id=ORG))
    assert e.value.status_code == 404
