"""
The Dristi scheduled-report sweep: when a schedule is due, and that it is inert.

`staging.dristi_scheduled_reports` holds 7 rows (1 active), the screen collects
frequency/day/time, and until now nothing walked the table — every send it has
ever recorded came from the manual Run-now button, last on 2026-07-28.

These tests are on the PURE functions in `services/report_schedule_window.py`,
not on queries. `conftest` swaps `db._pool` for a MagicMock that resolves any
table name it is handed and returns whatever the test told it to, so a test that
asked the pool "is this due?" would be asserting on its own fixture. The
arithmetic is the thing that can be wrong, so the arithmetic is what is tested.

THE DAY-OF-WEEK TRIPWIRE IS WRITTEN OUT LITERALLY, day by day, rather than as a
loop over a conversion helper. A test that computes the expected weekday with
the same conversion as the code passes when both are wrong together, which is
exactly the state `routers/reports.py:_next_run` is in today: it compares this
column against `datetime.weekday()` and its comment calls 1 "Monday", when 1 is
Tuesday on that scale.
"""

import ast
import os
from datetime import datetime, time as _time, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.report_schedule_window import (
    blocked_reason,
    is_due,
    js_weekday,
    previous_slot,
)

UTC = timezone.utc


def _dt(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=UTC)


# ── The convention: 0 = Sunday, because that is what both UIs submit ──────────

# frontend/src/pages/dristi/ReportsTab.jsx:33 and ReportsPage.jsx:70 both build
# the picker from an array starting at Sunday and submit the ARRAY INDEX. These
# names are spelled out so that changing the convention breaks this list, not
# just a helper that the assertion also calls.
UI_DAY_NAMES = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
}


@pytest.mark.parametrize("stored,expected_name", sorted(UI_DAY_NAMES.items()))
def test_weekly_slot_lands_on_the_day_the_user_picked(stored, expected_name):
    """day_of_week=1 means Monday — the day the UI labelled 1, not Python's 1."""
    # A Thursday, deliberately mid-week so every target is reachable in both
    # directions and no answer is right by accident.
    now = _dt(2026, 8, 6, 12, 0)
    assert now.strftime("%A") == "Thursday"

    slot = previous_slot(now, "weekly", stored, None, _time(8, 0))
    assert slot is not None
    assert slot.strftime("%A") == expected_name, (
        f"day_of_week={stored} should be {expected_name}; got {slot.strftime('%A')}"
    )
    assert slot <= now
    assert (now - slot) < timedelta(days=7)


def test_python_weekday_would_have_given_a_different_day():
    """The bug this convention avoids, stated as an assertion rather than prose.

    `routers/reports.py:_next_run` does `(day_of_week - now.weekday()) % 7`. On
    the stored scale that is off by one for every day. If someone "simplifies"
    `js_weekday` into `datetime.weekday`, this fails.
    """
    monday = _dt(2026, 8, 3, 12, 0)
    assert monday.strftime("%A") == "Monday"
    assert js_weekday(monday) == 1          # the UI's Monday
    assert monday.weekday() == 0            # Python's Monday
    assert js_weekday(monday) != monday.weekday()


# ── previous_slot ────────────────────────────────────────────────────────────

def test_daily_slot_is_today_when_the_hour_has_passed():
    now = _dt(2026, 8, 6, 12, 0)
    assert previous_slot(now, "daily", None, None, _time(8, 0)) == _dt(2026, 8, 6, 8, 0)


def test_daily_slot_is_yesterday_when_the_hour_has_not_arrived():
    now = _dt(2026, 8, 6, 6, 0)
    assert previous_slot(now, "daily", None, None, _time(8, 0)) == _dt(2026, 8, 5, 8, 0)


def test_weekly_slot_is_a_week_back_when_today_is_the_day_but_too_early():
    # Monday 06:00, schedule is Monday 08:00 — the last firing was last Monday.
    now = _dt(2026, 8, 3, 6, 0)
    assert now.strftime("%A") == "Monday"
    assert previous_slot(now, "weekly", 1, None, _time(8, 0)) == _dt(2026, 7, 27, 8, 0)


def test_weekly_day_of_week_null_defaults_to_monday():
    """One of the seven live rows has day_of_week NULL and frequency weekly."""
    now = _dt(2026, 8, 6, 12, 0)
    slot = previous_slot(now, "weekly", None, None, _time(8, 0))
    assert slot.strftime("%A") == "Monday"


def test_monthly_day_31_clamps_to_the_real_end_of_a_short_month():
    """April has 30 days. `min(dom, 28)` — what reports.py does — says the 28th."""
    now = _dt(2026, 4, 30, 23, 0)
    slot = previous_slot(now, "monthly", None, 31, _time(8, 0))
    assert slot == _dt(2026, 4, 30, 8, 0)


def test_monthly_falls_back_across_a_year_boundary():
    now = _dt(2026, 1, 5, 12, 0)
    slot = previous_slot(now, "monthly", None, 20, _time(8, 0))
    assert slot == _dt(2025, 12, 20, 8, 0)


def test_unknown_frequency_is_not_guessed_at():
    """`frequency` is free text with no CHECK constraint. Guessing mails a report."""
    assert previous_slot(_dt(2026, 8, 6, 12), "fortnightly", 1, None, _time(8, 0)) is None
    assert previous_slot(_dt(2026, 8, 6, 12), "", 1, None, _time(8, 0)) is None


@pytest.mark.parametrize("value", ["08:00", "08:00:00", _time(8, 0), None])
def test_time_utc_is_accepted_in_every_shape_it_arrives_in(value):
    now = _dt(2026, 8, 6, 12, 0)
    assert previous_slot(now, "daily", None, None, value) == _dt(2026, 8, 6, 8, 0)


def test_a_slot_is_never_in_the_future():
    now = _dt(2026, 8, 6, 3, 15)
    for freq, dow, dom in (("daily", None, None), ("weekly", 4, None), ("monthly", None, 28)):
        slot = previous_slot(now, freq, dow, dom, _time(23, 59))
        assert slot is not None and slot <= now, (freq, slot)


# ── is_due ───────────────────────────────────────────────────────────────────

BASE = dict(
    is_active=True,
    frequency="weekly",
    day_of_week=1,          # Monday, on the UI's scale
    day_of_month=None,
    time_utc=_time(8, 0),
)


def test_due_when_the_slot_has_passed_since_the_last_send():
    # Slot: Monday 2026-08-03 08:00. Last send was the Monday before.
    assert is_due(
        _dt(2026, 8, 6, 12), **BASE,
        last_sent_at=_dt(2026, 7, 27, 8, 5), created_at=_dt(2026, 7, 1),
    ) is True


def test_not_due_twice_for_the_same_slot():
    """Idempotence. The sweep runs hourly; a slot owes exactly one send."""
    assert is_due(
        _dt(2026, 8, 6, 12), **BASE,
        last_sent_at=_dt(2026, 8, 3, 8, 5), created_at=_dt(2026, 7, 1),
    ) is False


def test_a_new_schedule_does_not_fire_for_a_slot_that_predates_it():
    """Created Tuesday for 'every Monday' — last Monday is not owed.

    Six of the seven live rows have last_sent_at NULL. Without the created_at
    floor every one of them is due the moment a sweep first runs.
    """
    assert is_due(
        _dt(2026, 8, 4, 12), **BASE,
        last_sent_at=None, created_at=_dt(2026, 8, 4, 9, 0),
    ) is False


def test_a_new_schedule_fires_at_its_first_real_slot():
    # Same row as above, one week later: Monday 2026-08-10 08:00 has passed.
    assert is_due(
        _dt(2026, 8, 10, 12), **BASE,
        last_sent_at=None, created_at=_dt(2026, 8, 4, 9, 0),
    ) is True


def test_inactive_is_never_due():
    """Six of the seven live rows are is_active=false and must stay silent."""
    args = {**BASE, "is_active": False}
    assert is_due(_dt(2026, 8, 6, 12), **args,
                  last_sent_at=None, created_at=_dt(2020, 1, 1)) is False


def test_no_anchor_at_all_means_do_not_send():
    assert is_due(_dt(2026, 8, 6, 12), **BASE,
                  last_sent_at=None, created_at=None) is False


def test_naive_timestamps_are_read_as_utc_not_crashed_on():
    assert is_due(
        _dt(2026, 8, 6, 12), **BASE,
        last_sent_at=datetime(2026, 7, 27, 8, 5), created_at=datetime(2026, 7, 1),
    ) is True


def test_the_live_active_row_is_due_and_would_not_be_sent_twice():
    """The one is_active row on staging, by its real values.

    id 92bf808a, 'QA weekly pipeline report', weekly, day_of_week NULL,
    time_utc 08:00, created 2026-07-28 15:16:05Z, last_sent_at 2026-07-28
    15:16:15Z (the manual Run-now).
    """
    row = dict(is_active=True, frequency="weekly", day_of_week=None,
               day_of_month=None, time_utc=_time(8, 0),
               created_at=_dt(2026, 7, 28, 15, 16),
               last_sent_at=_dt(2026, 7, 28, 15, 16))
    # Monday 2026-08-03 08:00 has passed and is after the manual run.
    assert is_due(_dt(2026, 8, 6, 12), **row) is True
    # Immediately after a send, the same tick's slot is settled.
    row["last_sent_at"] = _dt(2026, 8, 6, 12, 1)
    assert is_due(_dt(2026, 8, 6, 12, 2), **row) is False


# ── Entitlement ──────────────────────────────────────────────────────────────

def test_a_schedule_with_no_owner_is_blocked():
    assert blocked_reason("revenue", None, {"ganit"}, {"ganit"}) is not None
    assert blocked_reason("revenue", "", {"ganit"}, {"ganit"}) is not None


def test_an_owner_who_lost_the_module_is_blocked():
    reason = blocked_reason("revenue", "user_f1a0a472b98f", {"ganit"}, set())
    assert reason and "ganit" in reason


def test_a_partial_reach_is_still_blocked():
    """'overview' reads two modules and a half-export of the books is an export."""
    reason = blocked_reason("overview", "user_x", {"graha", "ganit"}, {"graha"})
    assert reason and "ganit" in reason and "graha" not in reason


def test_a_fully_entitled_owner_is_not_blocked():
    assert blocked_reason("overview", "user_x", {"graha", "ganit"}, {"graha", "ganit"}) is None


def test_report_source_modules_map_is_exactly_this():
    """Tripwire, written out literally.

    A check of the form `forbidden = ALL - ALLOWED` cannot notice ALLOWED
    getting wider, which is the direction that leaks. Adding a report type
    without a source-module entry gives it `set()` in `_REPORT_SOURCE_MODULES`,
    which means `blocked_reason` requires nothing of it and the cron will mail
    it to anyone — so the map is pinned here by value.
    """
    from routers.dristi import _REPORT_SOURCE_MODULES

    assert _REPORT_SOURCE_MODULES == {
        "overview": {"graha", "ganit"},
        "revenue": {"ganit"},
        "pipeline": {"graha"},
        "hr": {"manav"},
        "sales": {"vikray"},
    }


# ── The clock the job reads ──────────────────────────────────────────────────

def _code_without_comments_or_docstrings(path: str) -> str:
    """Source with every comment and docstring removed.

    This repo has shipped four checks that were satisfied by their own
    commentary — `inspect.getsource` returns the comments, so a grep for a
    forbidden call matches the sentence explaining why it is forbidden. The
    module under test here has "date.today()" in its own docstring twice.
    `ast.unparse` of a parsed tree contains no comments at all, and the
    docstrings are stripped explicitly below.
    """
    with open(path, "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read())

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            node.body = body[1:] or [ast.Pass()]

    return ast.unparse(tree)


def test_the_comment_stripper_actually_strips():
    """The check above is worthless if this returns the file verbatim."""
    import services.report_schedule_window as mod

    raw = open(mod.__file__, "r", encoding="utf-8").read()
    stripped = _code_without_comments_or_docstrings(mod.__file__)
    # A phrase that exists ONLY in prose in that file.
    assert "battle-tested" in raw
    assert "battle-tested" not in stripped


def test_the_due_rule_never_reads_the_clock_itself():
    """`now` is a parameter. A module-clock read is the UTC-date trap.

    `date.today()` is the process clock in UTC. The owner's business day is IST
    (UTC+5:30), so a job running in a 19:00-22:00 UTC slot would date everything
    one day before the Indian business date. The rule cannot make that mistake
    if it cannot see a clock.
    """
    import services.report_schedule_window as mod

    code = _code_without_comments_or_docstrings(mod.__file__)
    for forbidden in ("date.today()", "datetime.now(", "datetime.utcnow(",
                      "time.time(", "date.fromtimestamp("):
        assert forbidden not in code, f"{forbidden} in report_schedule_window"


def test_the_sweep_captures_one_instant_and_never_reads_a_local_date():
    import inspect

    from routers.dristi import dispatch_scheduled_reports

    src = inspect.getsource(dispatch_scheduled_reports)
    tree = ast.parse(src)
    fn = tree.body[0]
    if (fn.body and isinstance(fn.body[0], ast.Expr)
            and isinstance(fn.body[0].value, ast.Constant)):
        fn.body = fn.body[1:]
    code = ast.unparse(tree)

    assert "date.today()" not in code
    assert code.count("datetime.now(") == 1, "capture `now` once, thread it through"
    assert "datetime.now(timezone.utc)" in code


# ── Inertness ────────────────────────────────────────────────────────────────

def _row(**over):
    base = dict(
        id="92bf808a-2af0-4899-8a95-6d750f2d1537",
        org_id="045b76ad-654b-42dd-b4b1-731700efc6c3",
        name="QA weekly pipeline report",
        report_type="pipeline",
        frequency="weekly",
        day_of_week=None,
        day_of_month=None,
        time_utc=_time(8, 0),
        recipients=["kevalvshah03@gmail.com"],
        is_active=True,
        last_sent_at=_dt(2026, 7, 28, 15, 16),
        created_at=_dt(2026, 7, 28, 15, 16),
        created_by="user_f798947b8a2e",
    )
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_unarmed_sweep_sends_nothing_and_writes_nothing(monkeypatch):
    """The whole point: complete, correct, and switched off.

    OUTBOUND_MODE is unset in production and `outbound.py` defaults to "live",
    so an armed first tick is real mail. Arming is the owner's call.
    """
    monkeypatch.setenv("CRON_SECRET", "unit-test-cron-secret-0123456789")
    monkeypatch.delenv("DRISTI_REPORT_SWEEP_ARMED", raising=False)

    from routers import dristi as d

    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[_row()])
    pool.execute = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=None)

    sent_mail = []
    with patch.object(d, "get_pool", AsyncMock(return_value=pool)), \
         patch.object(d, "reachable_modules", AsyncMock(return_value={"graha"})), \
         patch("email_service.send_email", side_effect=lambda **kw: sent_mail.append(kw)):
        out = await d.dispatch_scheduled_reports(
            x_cron_secret="unit-test-cron-secret-0123456789")

    assert out["armed"] is False
    assert out["sent"] == 0
    assert [w["name"] for w in out["would_send"]] == ["QA weekly pipeline report"]
    assert sent_mail == [], "an unarmed sweep must not send"
    pool.execute.assert_not_awaited()   # no log row, no last_sent_at


@pytest.mark.asyncio
async def test_sweep_rejects_a_wrong_or_absent_cron_secret(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "unit-test-cron-secret-0123456789")
    from fastapi import HTTPException

    from routers import dristi as d

    for bad in ("", "nope", "unit-test-cron-secret-012345678"):
        with pytest.raises(HTTPException) as ei:
            await d.dispatch_scheduled_reports(x_cron_secret=bad)
        assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_sweep_skips_a_schedule_whose_owner_lost_the_module(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "unit-test-cron-secret-0123456789")
    monkeypatch.delenv("DRISTI_REPORT_SWEEP_ARMED", raising=False)

    from routers import dristi as d

    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[_row(report_type="revenue")])
    pool.execute = AsyncMock()

    with patch.object(d, "get_pool", AsyncMock(return_value=pool)), \
         patch.object(d, "reachable_modules", AsyncMock(return_value=set())):
        out = await d.dispatch_scheduled_reports(
            x_cron_secret="unit-test-cron-secret-0123456789")

    assert out["would_send"] == []
    assert len(out["skipped"]) == 1
    assert "ganit" in out["skipped"][0]["reason"]


@pytest.mark.asyncio
async def test_armed_sweep_is_still_gated_on_the_arming_variable(monkeypatch):
    """Armed, it sends — proving the inert path above is the flag and not a stub."""
    monkeypatch.setenv("CRON_SECRET", "unit-test-cron-secret-0123456789")
    monkeypatch.setenv("DRISTI_REPORT_SWEEP_ARMED", "true")

    from routers import dristi as d

    pool = MagicMock()

    # Delivery now runs the one report spine (services/module_report): it
    # resolves the module arrangement, cuts recipients to MEMBERS, and
    # renders the letterhead document — so the fake pool answers by query
    # rather than with one row for everything. The recipient must read as a
    # member or the send correctly refuses.
    async def _fetch(q, *a):
        if "FROM public.users" in q:
            return [{"email": "kevalvshah03@gmail.com"}]
        if "FROM staging.analytics_views" in q:
            return []
        if "FROM staging.dristi_scheduled_reports" in q:
            return [_row()]
        return []

    pool.fetch = AsyncMock(side_effect=_fetch)
    pool.fetchrow = AsyncMock(return_value=_row())
    pool.execute = AsyncMock()
    pool.fetchval = AsyncMock(return_value=0)

    sent_mail = []
    with patch.object(d, "get_pool", AsyncMock(return_value=pool)), \
         patch.object(d, "reachable_modules", AsyncMock(return_value={"graha"})), \
         patch.object(d, "_fetch_report_data", AsyncMock(return_value={"stages": []})), \
         patch("email_service.send_email", side_effect=lambda **kw: sent_mail.append(kw)):
        out = await d.dispatch_scheduled_reports(
            x_cron_secret="unit-test-cron-secret-0123456789")

    assert out["armed"] is True
    assert out["sent"] == 1
    assert [m["to_email"] for m in sent_mail] == ["kevalvshah03@gmail.com"]
    # The body is the letterhead document, not the old JSON dump.
    assert "<pre>" not in sent_mail[0]["html_content"]
    # last_sent_at advanced, so the next tick is a no-op for this slot.
    assert any("last_sent_at" in str(c) for c in pool.execute.await_args_list)


@pytest.mark.asyncio
async def test_preview_forces_the_dry_listing_even_when_armed(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "unit-test-cron-secret-0123456789")
    monkeypatch.setenv("DRISTI_REPORT_SWEEP_ARMED", "true")

    from routers import dristi as d

    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[_row()])
    pool.execute = AsyncMock()

    sent_mail = []
    with patch.object(d, "get_pool", AsyncMock(return_value=pool)), \
         patch.object(d, "reachable_modules", AsyncMock(return_value={"graha"})), \
         patch("email_service.send_email", side_effect=lambda **kw: sent_mail.append(kw)):
        out = await d.dispatch_scheduled_reports(
            x_cron_secret="unit-test-cron-secret-0123456789", preview=True)

    assert out["armed"] is True and out["sent"] == 0
    assert sent_mail == []
    pool.execute.assert_not_awaited()
