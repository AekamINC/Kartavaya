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


# ── the orphan-module presets (Sanvaad / Niyam / Pay — owner, 2026-08-18) ────
#
# These three modules get NO analytics tab of their own; their figures live on
# the cross-module surface as presets, and each module's chrome carries an
# "Analytics ↗" door deep-linking here. The declarations below are the doors'
# contract: the preset exists, names only live metrics, and survives (or dies
# whole) under the entitlement cut.

ORPHAN_PRESETS = {
    "communication": ("sanvaad", "varta"),
    "automation": ("core",),
    "payments": ("ganit",),
}


def test_orphan_presets_exist_and_name_only_live_metrics():
    for key, modules in ORPHAN_PRESETS.items():
        p = PRESETS[key]
        assert tuple(p["modules"]) == modules, key
        assert 4 <= len(p["layout"]) <= 8, key
        for w in p["layout"]:
            m = REGISTRY[w["metric"]]
            assert m.absent is None, (
                f"{key}: {w['metric']} is declared absent — a preset must not "
                f"open on a card that says 'Not yet measurable'")


def test_orphan_presets_never_become_the_resolution_floor():
    # The resolver's floor is the FIRST surviving preset (list_views), so the
    # role presets must keep that seat and these three must trail them.
    keys = list(PRESETS)
    assert keys[0] == "founder"
    assert set(ORPHAN_PRESETS) <= set(keys[-3:])


def test_communication_degrades_without_varta_and_dies_without_sanvaad():
    # Sanvaad held, WhatsApp not: the preset survives as its sanvaad half.
    cut = {p["key"]: p
           for p in ax._presets_for(ax.CROSS_MODULE, {"core", "sanvaad"})}
    assert "communication" in cut
    assert {REGISTRY[w["metric"]].module
            for w in cut["communication"]["layout"]} == {"sanvaad"}
    # Neither module held: omitted entirely, never served as a husk.
    bare = {p["key"] for p in ax._presets_for(ax.CROSS_MODULE, {"core"})}
    assert "communication" not in bare
    assert "payments" not in bare     # pay is a Ganit capability, ganit-gated
    assert "automation" in bare       # niyam is core.*: reaches every org


def test_payments_survives_only_with_ganit():
    keys = {p["key"] for p in ax._presets_for(ax.CROSS_MODULE, {"core", "ganit"})}
    assert "payments" in keys


# ── the save-time whitelist ──────────────────────────────────────────────────

def test_an_unregistered_metric_is_unwritable_and_named():
    with pytest.raises(HTTPException) as e:
        ax._clean_layout([{"metric": "ganit.nonsense", "viz": "kpi", "w": 1}])
    assert e.value.status_code == 422
    assert "ganit.nonsense" in str(e.value.detail)


@pytest.mark.parametrize("bad,expect", [
    ({"metric": "ganit.dso", "viz": "hologram", "w": 1}, "hologram"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": 0}, "grid columns"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": 13}, "grid columns"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": "2"}, "grid columns"),
    ({"metric": "ganit.dso", "viz": "kpi", "w": True}, "grid columns"),
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


# ── free arrangement (proposal 67): optional x/y/h ────────────────────────────────────────

def test_geometry_is_echoed_back_on_save(monkeypatch, pool, all_reachable):
    """x/y/h reach the row exactly as sent — the arrangement a person drags
    is the arrangement every device reads back."""
    pool._row = _view_row("v1", USER["user_id"], "arranged")
    run(ax.create_view(
        ax.ViewCreate(module="ganit", name="arranged", layout=[
            {"metric": "ganit.dso", "viz": "trend", "w": 6, "x": 3, "y": 2, "h": 4},
        ]),
        user=USER, org_id=ORG))
    insert = next(c for c in pool.calls
                  if "INSERT INTO public.analytics_views" in c[0])
    assert json.loads(insert[1][4]) == [
        {"metric": "ganit.dso", "viz": "trend", "w": 6, "x": 3, "y": 2, "h": 4}]


def test_a_legacy_widget_rebuilds_byte_identical():
    """No geometry in → none out. A v1 row (w 1–3, no x/y/h) must round-trip
    byte-identical, or every re-save silently rewrites views it never saw."""
    legacy = [{"metric": "ganit.dso", "viz": "kpi", "w": 2}]
    assert json.dumps(ax._clean_layout(legacy)) == json.dumps(legacy)


def test_w12_without_geometry_is_accepted():
    out = ax._clean_layout([{"metric": "ganit.dso", "viz": "table", "w": 12}])
    assert out == [{"metric": "ganit.dso", "viz": "table", "w": 12}]


def test_partial_geometry_keeps_only_what_was_sent():
    # x=0 is falsy and REAL — presence, not truthiness, decides what rides.
    out = ax._clean_layout([{"metric": "ganit.dso", "viz": "kpi", "w": 4, "x": 0}])
    assert out == [{"metric": "ganit.dso", "viz": "kpi", "w": 4, "x": 0}]


def test_junk_keys_are_stripped_while_geometry_survives():
    out = ax._clean_layout([{
        "metric": "ganit.dso", "viz": "kpi", "w": 4, "x": 1, "y": 0, "h": 2,
        "z": 99, "onclick": "alert(1)",
    }])
    assert out == [{"metric": "ganit.dso", "viz": "kpi", "w": 4,
                    "x": 1, "y": 0, "h": 2}]


def test_the_grids_right_edge_itself_fits():
    # 8+4 == 12: flush against the rim is a fit, not an overflow — and every
    # ceiling is inside its bound (x 11 with w 1, y 999, h 8).
    out = ax._clean_layout([
        {"metric": "ganit.dso", "viz": "kpi", "w": 4, "x": 8},
        {"metric": "ganit.dso", "viz": "kpi", "w": 1, "x": 11, "y": 999, "h": 8},
    ])
    assert [w.get("x") for w in out] == [8, 11]


def test_x_plus_w_past_the_grid_names_the_offending_widget():
    with pytest.raises(HTTPException) as e:
        ax._clean_layout([
            {"metric": "ganit.dso", "viz": "kpi", "w": 1},
            {"metric": "ganit.dso", "viz": "kpi", "w": 6, "x": 8},
        ])
    assert e.value.status_code == 422
    assert "widget 1" in str(e.value.detail)
    assert "12-column grid" in str(e.value.detail)


@pytest.mark.parametrize("geom,expect", [
    ({"x": -1}, "x must be an int, 0 to 11"),
    ({"x": 12}, "x must be an int, 0 to 11"),
    ({"x": "2"}, "x must be an int, 0 to 11"),
    ({"x": 2.0}, "x must be an int, 0 to 11"),
    ({"x": True}, "x must be an int, 0 to 11"),
    ({"y": -1}, "y must be an int, 0 to 999"),
    ({"y": 1000}, "y must be an int, 0 to 999"),
    ({"y": "0"}, "y must be an int, 0 to 999"),
    ({"h": 0}, "h must be an int, 1 to 8"),
    ({"h": 9}, "h must be an int, 1 to 8"),
    ({"h": "3"}, "h must be an int, 1 to 8"),
    ({"h": False}, "h must be an int, 1 to 8"),
])
def test_geometry_out_of_bounds_or_untyped_is_refused(geom, expect):
    """The refusal names WHICH widget, WHICH key and that key's OWN bounds —
    'widget 0: x must be an int, 0 to 11' — pinned per key, so a message that
    blames the wrong field or quotes another key's bounds fails here."""
    with pytest.raises(HTTPException) as e:
        ax._clean_layout([{"metric": "ganit.dso", "viz": "kpi", "w": 1, **geom}])
    assert e.value.status_code == 422
    detail = str(e.value.detail)
    assert "widget 0" in detail
    assert expect in detail


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
