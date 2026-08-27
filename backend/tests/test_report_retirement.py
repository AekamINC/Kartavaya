"""`public.report_schedules` is retired, and the surviving sweep claims first.

── WHAT WAS MEASURED, 2026-08-27, LIVE ──────────────────────────────────────

    public.report_schedules            0 rows   dispatcher complete   CRON ARMED HOURLY
    staging.dristi_scheduled_reports   7 rows   dispatcher complete   never ran

An empty table was swept every hour while seven schedules real people had
configured had never dispatched once. The owner retired the empty one.

This file guards the two halves of that, because both have a silent failure
mode:

  1. THE RETIREMENT UNDOING ITSELF. `server.py` ran
     `CREATE TABLE IF NOT EXISTS public.report_schedules` on every startup. A
     DROP followed by a deploy would put the table straight back, empty — and
     an empty table is indistinguishable from a dropped one from the product
     side, so nobody would ever notice. Removing the endpoints without removing
     that DDL is the most likely way this change gets half-done.

  2. THE DUPLICATE SEND. The old dispatcher marked a schedule sent AFTER
     mailing; that was fixed by claiming the row first, and the fix is being
     deleted along with the dispatcher. The surviving sweep had the OLD shape.
     `OUTBOUND_MODE` has been `live` since 2026-08-18, so the bug mails real
     people twice.

Nothing here touches the database. These are source- and import-level
assertions about code that must not come back and an ordering that must not be
reversed — the same technique `test_register_door.py` used for the dispatcher
these replace, and for the same reason: the failure is in what the code DOES
NOT do, which no fixture can exercise.
"""
import ast
import inspect
import re

import invite_router
import server
from routers import dristi, reports


def _code_only(module) -> str:
    """A module's source with every docstring AND every comment removed.

    Both have to go for the "this name appears nowhere" assertions below to
    mean anything, and the reason is this change itself: the retirement is
    documented at length in the very modules it strips, so `reports.py`,
    `server.py` and `invite_router.py` all now say "report_schedules" in prose
    explaining why they no longer say it in SQL. Matching raw source would fail
    on the explanation and pass on a resurrection that arrived without one.

    Docstrings are removed structurally, via the AST, rather than by matching
    triple quotes — this repository has a documented incident from
    string-matching source (`docs`: the `.side` rule) and a regex here would
    eat a legitimate SQL string containing a quote.
    """
    tree = ast.parse(inspect.getsource(module))
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = node.body
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            # Replace, never delete: a function whose only statement is its
            # docstring becomes a syntax error with an empty body.
            body[0] = ast.Pass()
    return ast.unparse(tree)


def _uncommented(fn_or_src) -> str:
    """Source with comments stripped.

    The house style in this repository explains the REJECTED alternative by
    name, in a comment — `dristi.py` quotes "mails all three again" and
    "`NULL = NULL` is NULL" directly above the code that prevents them. Matching
    against raw source would let a comment satisfy an assertion about
    behaviour, which is a test that passes on prose.
    """
    src = fn_or_src if isinstance(fn_or_src, str) else inspect.getsource(fn_or_src)
    return "\n".join(
        line for line in src.splitlines()
        if not line.lstrip().startswith("#")
    )


# ══════════════════════════════════════════════════════════════════════════
# 1. the surface is gone
# ══════════════════════════════════════════════════════════════════════════

def test_the_schedules_crud_and_dispatcher_are_gone_from_the_router():
    for name in ("list_schedules", "create_schedule", "delete_schedule",
                 "dispatch_reports", "_next_run", "ScheduleCreate",
                 "_assert_project_owner", "DISPATCH_SECRET"):
        assert not hasattr(reports, name), (
            f"routers.reports.{name} is back — that is the retired "
            f"team-scoped report scheduler returning over a dropped table")


def test_no_route_in_the_reports_router_still_serves_schedules_or_dispatch():
    """Attribute checks alone would miss a route re-registered under a new
    function name. The ROUTE is the surface a browser and a cron can reach."""
    paths = {r.path for r in reports.router.routes}
    assert not [p for p in paths if "schedule" in p or "dispatch" in p], (
        f"the reports router still exposes {sorted(paths)}")


def test_nothing_in_the_reports_router_names_the_retired_table():
    src = _code_only(reports)
    assert "report_schedules" not in src, (
        "SQL against public.report_schedules survives in routers/reports.py; "
        "it will 42P01 the moment the table is dropped")


# ══════════════════════════════════════════════════════════════════════════
# 2. the table cannot rebuild itself on the next deploy
# ══════════════════════════════════════════════════════════════════════════

def test_startup_no_longer_recreates_the_retired_table():
    """THE STEP MOST LIKELY TO BE MISSED.

    `CREATE TABLE IF NOT EXISTS` in the startup path is not idempotent
    housekeeping once a table has been deliberately dropped — it is a
    resurrection, and it runs on every single deploy.
    """
    src = _code_only(server)
    assert "report_schedules" not in src, (
        "server.py still issues DDL for public.report_schedules; the DROP will "
        "be undone by the next deploy and the retirement will look done while "
        "the table quietly exists again")


# ══════════════════════════════════════════════════════════════════════════
# 3. user deletion no longer touches a table that is about to disappear
# ══════════════════════════════════════════════════════════════════════════

def test_user_deletion_does_not_query_the_retired_table():
    """`DELETE /api/org/users/{user_id}` ran `UPDATE report_schedules` and
    `DELETE FROM report_schedules` UNQUALIFIED — resolved through search_path
    ("$user", public, extensions, read live 2026-08-27) to
    `public.report_schedules`. After the DROP both raise 42P01 on every user
    deletion."""
    src = _code_only(invite_router)
    assert "report_schedules" not in src


def test_user_deletion_still_reassigns_and_still_deletes_the_user():
    """The removal must not have taken a neighbouring statement with it.

    The cleanup block is a sequence of independent statements in one function;
    an over-wide deletion here would silently stop reassigning tasks or, worse,
    stop deleting the user — and `run()` swallows every exception, so neither
    would raise.
    """
    src = _uncommented(inspect.getsource(invite_router.remove_user))
    # The reassign/orphan pairs on either side of the removed block.
    assert "UPDATE approvals SET requested_by=$1" in src
    assert "UPDATE automations SET created_by=$1" in src
    # And the statement the whole route exists for, which must be last and must
    # be the one that is NOT wrapped in the error-swallowing helper.
    assert "DELETE FROM users WHERE user_id=$1" in src
    assert src.index("UPDATE automations") < src.index("DELETE FROM users WHERE user_id=$1")


def test_the_final_user_delete_is_still_not_error_swallowed():
    """`run()` ignores every exception on purpose, so the one statement that
    must actually succeed deliberately does not go through it. If the final
    delete ever moves inside `run()`, a failed deletion returns {"ok": True}."""
    src = _uncommented(inspect.getsource(invite_router.remove_user))
    tail = src[src.index("DELETE FROM users WHERE user_id=$1") - 200:]
    assert "conn.execute(" in tail
    assert 'await run("DELETE FROM users' not in src


# ══════════════════════════════════════════════════════════════════════════
# 4. the surviving sweep claims the row before it mails it
# ══════════════════════════════════════════════════════════════════════════
#
# These are the assertions that used to live in
# `tests/test_report_dispatch_claim.py` against `reports.dispatch_reports`.
# The dispatcher was deleted; the lesson was not, and the timer it warned about
# is now pointed at this sweep instead.

def test_the_claim_happens_before_the_delivery_call():
    code = _uncommented(dristi.dispatch_scheduled_reports)
    claim = code.index("UPDATE staging.dristi_scheduled_reports")
    send = code.index("_deliver_scheduled_report(pool, full)")
    assert claim < send, (
        "the sweep still marks the schedule after delivering it — a failure on "
        "the second recipient re-mails the first on the next tick")


def test_the_claim_is_conditional_on_the_row_not_having_moved():
    """Not a bare UPDATE by id. Two overlapping ticks both read the same due
    row; only one may take it."""
    code = _uncommented(dristi.dispatch_scheduled_reports)
    claim = re.search(
        r"UPDATE staging\.dristi_scheduled_reports.{0,500}", code, re.S)
    assert claim, "the claim is no longer recognisable"
    assert "RETURNING id" in claim.group(0), (
        "the claim does not report whether it took the row, so it cannot fence "
        "off a concurrent tick")


def test_the_claim_uses_is_not_distinct_from_and_not_equals():
    """Six of the seven live rows have `last_sent_at` NULL. `NULL = NULL` is
    NULL, so `=` would claim nothing on exactly the rows that have never been
    sent — the sweep would look fenced and be wide open."""
    code = _uncommented(dristi.dispatch_scheduled_reports)
    claim = re.search(
        r"UPDATE staging\.dristi_scheduled_reports.{0,500}", code, re.S).group(0)
    assert "IS NOT DISTINCT FROM" in claim


def test_a_schedule_another_tick_claimed_is_skipped_and_not_mailed():
    code = _uncommented(dristi.dispatch_scheduled_reports)
    branch = code[code.index("if not claimed:"):]
    branch = branch[:branch.index("continue") + len("continue")]
    assert "_deliver_scheduled_report" not in branch, (
        "the skip branch still reaches the delivery call")


def test_the_row_is_fetched_before_it_is_claimed_so_the_window_stays_honest():
    """`_deliver_scheduled_report` computes the reporting period from
    `report["last_sent_at"]`. Claiming BEFORE the fetch would hand it a
    `last_sent_at` of NOW() and every report would cover a zero-length
    period — a document that is wrong rather than missing."""
    code = _uncommented(dristi.dispatch_scheduled_reports)
    assert (code.index("SELECT * FROM staging.dristi_scheduled_reports")
            < code.index("UPDATE staging.dristi_scheduled_reports"))


def test_one_schedule_failing_does_not_stop_the_other_orgs():
    """A sweep that aborts on the first bad schedule silently stops delivering
    everybody else's reports."""
    code = _uncommented(dristi.dispatch_scheduled_reports)
    assert "failed.append" in code
    assert "except Exception as e:" in code


def test_the_sweep_is_still_inert_until_it_is_armed():
    """Arming is a separate, deliberate act. `OUTBOUND_MODE` is live and
    production has it unset, so an unarmed-by-default sweep is the only thing
    standing between merging a dispatcher and mailing a backlog."""
    code = _uncommented(dristi.dispatch_scheduled_reports)
    assert "if preview or not armed:" in code
    unarmed = code[code.index("if preview or not armed:"):]
    unarmed = unarmed[:unarmed.index("sent, failed = 0, []")]
    assert "return" in unarmed
    assert "_deliver_scheduled_report" not in unarmed
    assert dristi._SWEEP_ARMED_VAR == "DRISTI_REPORT_SWEEP_ARMED"


def test_the_sweep_is_not_armed_by_an_unset_variable(monkeypatch):
    """A truthiness check on `os.getenv(...)` would arm on the string "false"."""
    for value in ("", "false", "no", "off", "0"):
        monkeypatch.setenv("DRISTI_REPORT_SWEEP_ARMED", value)
        assert dristi._sweep_armed() is False, f"{value!r} armed the sweep"
    monkeypatch.delenv("DRISTI_REPORT_SWEEP_ARMED", raising=False)
    assert dristi._sweep_armed() is False
    monkeypatch.setenv("DRISTI_REPORT_SWEEP_ARMED", "true")
    assert dristi._sweep_armed() is True
