"""The door onto a single register — proposal 70's "one function" delivered.

── WHAT WAS ACTUALLY MISSING ────────────────────────────────────────────────

Proposal 70 found that /reports is not three reporting surfaces but SIX, and
that consolidating them needed one thing: a second PRODUCER of the widget
shape, so a row-level register could travel down the renderer, the PDF engine
and the three export branches that already exist.

`services/module_report.report_section` is that producer, and it shipped, and
`/report-sections` lists what a caller may see. What did NOT exist was a way to
ASK FOR ONE. A section could only be rendered by first saving it into a
module's layout — so the catalogue named documents that no request could open,
and the proposal's "net six to six" stayed true.

`/module-report?report=<key>` is that request. It swaps the LAYOUT and nothing
else, which is the whole point: no new route, no second copy of the gate, no
second window parser, and no new csv/xlsx/pdf branches for the six surfaces to
drift apart in.

These tests are structural — the suite is offline by design and the pool is a
MagicMock — so they pin the WIRING and the REFUSALS, which is where a door like
this goes wrong. The rows themselves are tested per definition
(`test_department_register.py`, `test_receivables_ageing.py`, …) and were run
against the live database before shipping.
"""
import inspect

import pytest

from routers import analytics, reports


SRC = inspect.getsource(analytics.module_report)


# ══════════════════════════════════════════════════════════════════════════
# the door itself
# ══════════════════════════════════════════════════════════════════════════

def test_the_named_register_replaces_the_layout_and_nothing_else():
    """The consolidation is a one-entry layout. If this ever grows its own
    renderer or its own format branch, the six surfaces have become seven."""
    assert 'layout, source = [{"report": report}]' in SRC
    assert "_svc_report_entry" in SRC, "the dispatcher must still do the work"
    # One set of format branches, shared with the module page.
    for fmt in ('if format == "csv"', 'if format == "xlsx"', 'if format == "json"'):
        assert SRC.count(fmt) == 1


def test_an_unknown_report_key_is_a_404_naming_where_to_look():
    assert "unknown report:" in SRC
    assert "/api/v1/analytics/report-sections" in SRC


def test_a_register_may_not_be_requested_under_another_modules_gate():
    """THE security property of this parameter.

    `report_section` skips its own module's gate on purpose — `/module-report`
    has already run `require_module` on the page's module, and asking again
    would double-count the sensitive-module audit row. That shortcut is safe
    only while the URL's module IS the section's module. Without this check,
    `?module=core&report=manav.department_register` would pass the ungated core
    gate and then skip manav's, handing out the employee register to a caller
    who holds no HR grant.
    """
    assert "section_def.module != module" in SRC
    assert "belongs to the" in SRC


def test_the_module_gate_still_runs_before_any_row_is_read():
    """Unchanged, and it has to stay before the arrangement is resolved."""
    gate_at = SRC.index("await require_module(module)(request, org_id)")
    rows_at = SRC.index("_svc_report_entry")
    assert gate_at < rows_at


def test_the_filename_identifies_the_register():
    """A register downloaded as `module-report_manav_…` is a file nobody can
    identify in a downloads folder six weeks later."""
    assert 'f"report_{report.replace' in SRC


def test_the_payload_says_it_is_a_section():
    """So a UI — and a support reader opening a saved file — can tell a
    register apart from a module page that happens to contain one."""
    assert 'f"section:{report}"' in SRC


def test_every_registered_section_is_reachable_through_this_door():
    """The catalogue and the door must not disagree.

    `sections_for` lists a definition by `reads`; this door resolves it by
    `module`. A definition whose key prefix and `module` disagreed would be
    listed and then refused — but `ReportDef.__post_init__` already requires
    `key == f'{module}.<name>'`, so this asserts the invariant holds across
    every definition rather than trusting one constructor.
    """
    from services.report_defs import REPORT_DEFS, load_all
    load_all()
    assert REPORT_DEFS, "no report definitions loaded"
    for key, d in REPORT_DEFS.items():
        assert key.split(".", 1)[0] == d.module
        assert d.module in d.reads


def test_the_new_department_register_is_in_the_catalogue():
    from services.report_defs import sections_for
    keys = [s["key"] for s in sections_for({"manav"})]
    assert "manav.department_register" in keys
    # And it is NOT offered to a caller without the HR grant.
    assert "manav.department_register" not in [
        s["key"] for s in sections_for({"core", "ganit", "graha"})]


# ══════════════════════════════════════════════════════════════════════════
# the dispatch cron, before it is armed
# ══════════════════════════════════════════════════════════════════════════
#
# `POST /api/reports/dispatch` is finished code that nothing calls. Arming it
# is safe — `public.report_schedules` holds 0 rows, verified live 2026-08-22,
# so the first run sends nothing — but a job that only starts working when
# somebody creates the first schedule is a trap, so these pin the two things
# that must be true BEFORE a Railway cron points at it.

DISPATCH_SRC = inspect.getsource(reports.dispatch_reports)

#: The same source with comments and the docstring stripped. Several assertions
#: below are about what the CODE does, and this function's comments quote the
#: very strings being ruled out ("not from `organisations.team_id`", "`==`
#: leaked how many leading bytes") — a house style that explains the rejected
#: alternative by name. Matching against the raw source tests the prose.
DISPATCH_CODE = chr(10).join(
    line for line in DISPATCH_SRC.splitlines()
    if not line.lstrip().startswith("#")
)


def test_every_dispatched_report_carries_the_org_it_was_sent_for():
    """A report mailed with no org attached is mail nobody can bill and
    nobody can trace.

    `outbound.begin()` reads a ContextVar that `middleware/org_resolver` sets
    from a REQUEST. This runs on a timer with no request behind it, so without
    an explicit scope every scheduled report lands in the outbound log under
    NULL — invisible on `/me/outbound` and on `/orgs/{id}/outbound`, for every
    org, for ever.

    The scope is opened INSIDE the per-schedule loop, not once around it: this
    cron walks every team in the product, and a scope set once would file every
    report after the first under the previous org — which is worse than the
    NULL it replaces, because it reads as a fact.
    """
    assert "org_scope(sched[\"team_org_id\"])" in DISPATCH_SRC
    loop_at = DISPATCH_SRC.index("for sched in due:")
    scope_at = DISPATCH_SRC.index("with org_scope(")
    send_at = DISPATCH_SRC.index("send_report_email(")
    assert loop_at < scope_at < send_at, (
        "the org scope must open inside the per-schedule loop and before the "
        "send, or one org's scope is applied to another org's report")


def test_the_org_comes_from_the_team_not_from_the_org_backlink():
    """An org has MANY teams and names one primary, so
    `organisations.team_id` answers a different question and is NULL for every
    other team. `teams.org_id` is the direction that resolves."""
    assert "t.org_id AS team_org_id" in DISPATCH_CODE
    assert "organisations" not in DISPATCH_CODE


def test_the_secret_is_compared_in_constant_time_and_preferred_in_the_header():
    """A secret in a query string is written to every access log, proxy log and
    platform request log the request passes through, and those outlive and
    out-scope the secret. The header is the documented cron form; the query
    parameter is kept working and deprecated."""
    assert "secret_matches(x_dispatch_secret, DISPATCH_SECRET)" in DISPATCH_CODE
    assert "==" not in DISPATCH_CODE.split("authorized = False")[1].split("else:")[0]


def test_a_failing_schedule_does_not_stop_the_rest_of_the_run():
    """An hourly job that aborts on the first bad schedule silently stops
    delivering everybody else's reports."""
    assert "errors.append" in DISPATCH_SRC
    assert "except Exception as exc:" in DISPATCH_SRC


@pytest.mark.parametrize("stub", ["/cron/reports", "/cron/esign"])
def test_the_501_stubs_are_not_what_gets_armed(stub):
    """Both are stubs. Arming one buys an hourly red light, not a feature —
    and `/cron/reports` is close enough in name to `/api/reports/dispatch`
    that somebody will eventually point a cron at the wrong one."""
    from routers import scheduler
    src = inspect.getsource(scheduler)
    idx = src.find(stub)
    assert idx != -1, f"{stub} has moved — re-check what it does before arming"
    assert "501" in src[idx:idx + 2000], (
        f"{stub} no longer looks like a 501 stub. If it was implemented, the "
        f"note in CLAUDE.md saying never to arm it needs revisiting.")
