"""A preset layout holds TWO widget shapes, and one of them has no `metric`.

── The defect this pins, found 2026-08-30 by Suite 12 ─────────────────────────

`GET /v1/analytics/views` answered **500 for every module**. `_presets_for` read

    REGISTRY[w["metric"]].module

unconditionally, while a preset layout carries two shapes:

    {"metric": "ganit.revenue_this_month"}     a METRIC widget
    {"report": "ganit.member_activity"}        a REPORT widget — NO "metric" key

Three shipped presets carry a report widget — `founder`, `finance` and
`sales_head` (`analytics/presets.py:86,107,149`) — so the subscript raised
`KeyError: 'metric'`. And not merely for those modules: the loop walks EVERY
preset on EVERY call, so the first report widget it meets killed the request
whatever module was asked for.

⚠ THE CONSEQUENCE IS A CHAIN, and it is why this survived so long looking like
disinterest rather than breakage. No views bar renders → no preset chip renders
→ the alert bell lives on a preset KPI widget and never appears. Saved views and
metric alerts are unreachable through the product entirely. `analytics_views`
and `analytics_alerts` each hold **zero rows across the whole database, for all
time** — which reads on a status page as a feature nobody uses, and is a feature
nobody can.

── What these tests hold ──────────────────────────────────────────────────────

1. Every shipped preset widget resolves to a module — the shape assertion that
   fails the moment a third shape is introduced.
2. A report widget resolves by its own prefix, not by pretending it has a metric.
3. An unregistered metric is DROPPED AND LOGGED, never raised and never silent.
   That third one matters: swapping the old `REGISTRY[...]` for a bare `.get()`
   would trade a 500 for a preset quietly losing a widget, which is this
   codebase's dominant bug class on a screen whose whole job is to be believed.
"""
import logging

import pytest

from analytics.presets import PRESETS
from routers.analytics import _widget_module


def _all_widgets():
    return [(key, w) for key, p in PRESETS.items() for w in p["layout"]]


def test_every_shipped_preset_widget_resolves_to_a_module():
    """The assertion the 500 would have failed."""
    unresolved = [(k, w) for k, w in _all_widgets() if _widget_module(w) is None]
    assert not unresolved, (
        "these preset widgets resolve to no module, so they are dropped from every "
        f"layout and nobody will see them: {unresolved}"
    )


def test_a_report_widget_resolves_without_a_metric_key():
    """The exact shape that raised KeyError: 'metric'."""
    assert _widget_module({"report": "ganit.member_activity"}) == "ganit"
    assert _widget_module({"report": "graha.member_activity"}) == "graha"


def test_the_three_shipped_report_widgets_are_still_report_shaped():
    """Pinned by count, so this file notices if the shape is refactored away.

    If a later change gives report widgets a `metric` key, this fails and the
    fix is to delete this test — deliberately, with the reason — rather than to
    discover the shape changed by way of another 500.
    """
    report_shaped = [(k, w) for k, w in _all_widgets() if "metric" not in w]
    assert len(report_shaped) == 3, (
        f"expected the 3 known report widgets (founder, finance, sales_head); "
        f"found {len(report_shaped)}: {report_shaped}"
    )
    assert all("report" in w for _, w in report_shaped)


def test_an_unregistered_metric_is_dropped_AND_logged(caplog):
    """Never raised — and never silent either.

    A preset naming a metric that is not registered is a real defect (a rename
    that missed a caller). It must not take the endpoint down, and it must not
    vanish without trace.
    """
    with caplog.at_level(logging.WARNING):
        got = _widget_module({"metric": "nosuch.metric_that_is_not_registered"})
    assert got is None, "an unknown metric must not resolve to a module"
    assert any("unregistered metric" in r.message or "unregistered metric" in r.getMessage()
               for r in caplog.records), (
        "an unregistered metric was dropped with NO log line — that is the silent "
        "failure this fix exists to avoid, not a smaller version of the 500."
    )


def test_a_widget_with_neither_key_is_dropped_and_logged(caplog):
    with caplog.at_level(logging.WARNING):
        got = _widget_module({"something_else": 1})
    assert got is None
    assert any("neither" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("module", ["ganit", "graha", "manav", "vetana"])
def test_presets_for_never_raises_for_any_module(module):
    """The endpoint-level guarantee, module by module.

    `_presets_for` walks every preset on every call, so one bad widget in one
    preset used to break the request for a module that had nothing to do with it.
    """
    from routers.analytics import _presets_for
    _presets_for(module, set())      # must not raise
