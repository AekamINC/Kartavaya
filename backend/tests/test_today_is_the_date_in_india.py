""""Today" is the date in India, and so is the date of any instant.

── WHAT THIS IS PROTECTING ──────────────────────────────────────────────────
Fifty-four handlers wrote `today = utc_now().date()`. A UTC container asked what
day it is at 02:00 IST answers YESTERDAY, so for five and a half hours out of
every twenty-four — 23% of the day — every "days overdue", every default month,
and every `as_of` handed to the statute calendar was a day behind.

`as_date` had the same fault from the other end: it took the UTC calendar date of
a `timestamptz`, so a row created at 02:00 IST was dated to the previous day.

⚠ THE TWO HAD TO MOVE TOGETHER AND THAT IS THE LOAD-BEARING PART. Ages are
computed as `days_between(today, as_date(row["created_at"]))` in fourteen places.
Moving one clock and not the other would not have half-fixed the count — it would
have subtracted two different calendars from each other, which is wrong in a NEW
way and wrong at a different hour.

`return_period` is the sharpest of the three because its answer is STATUTORY. It
returns "the month you have left" for a GST filing, derived from today. On the
UTC clock at 02:00 IST on 1 September it returned JULY — two months before the
one the preparer was about to file, on a screen that names sections and due dates.

── ⚠ WHY THIS FILE EXISTS AT ALL, WHEN 4,941 TESTS ALREADY PASSED ───────────
They passed BEFORE the change and after it, and proved nothing either way. Every
frozen-clock fixture in the suite freezes at `datetime(2026, 8, 20, 6, 0, utc)` —
06:00 UTC is 11:30 IST, the middle of the Indian working day, where the two
clocks agree about everything. The entire existing suite is blind to this by
construction.

So every assertion below freezes INSIDE the window and states its answer as a
difference from what UTC gives. Anything else is a test that cannot fail.
"""
from __future__ import annotations

import ast
import pathlib
import re
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skills.timeutil import (
    as_date, coming_week_start, days_between, return_period, today_ist, utc_now,
)


def _utc(y, m, d, hh, mm) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


#: Instants inside the 00:00-05:30 IST window, where the two clocks disagree
#: about which DAY it is. The label is what a person in India would call it.
IN_WINDOW = [
    (_utc(2026, 9, 3, 18, 30), date(2026, 9, 4), "00:00 IST on 4 September"),
    (_utc(2026, 9, 3, 20, 0),  date(2026, 9, 4), "01:30 IST on 4 September"),
    (_utc(2026, 9, 3, 23, 59), date(2026, 9, 4), "05:29 IST on 4 September"),
    (_utc(2026, 8, 31, 20, 0), date(2026, 9, 1), "01:30 IST on 1 September"),
    (_utc(2026, 3, 31, 20, 0), date(2026, 4, 1), "01:30 IST on 1 April"),
]


# ══════════════════════════════════════════════════════════════════════════════
#  today, and the date of an instant
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("moment,expected,when", IN_WINDOW,
                         ids=[c[2] for c in IN_WINDOW])
def test_today_is_the_indian_day(moment, expected, when):
    assert today_ist(moment) == expected, f"at {when}"
    assert today_ist(moment) != moment.date(), (
        f"at {when} the Indian date must differ from the UTC one "
        f"({moment.date()}) — otherwise this case proves nothing"
    )


@pytest.mark.parametrize("moment,expected,when", IN_WINDOW,
                         ids=[c[2] for c in IN_WINDOW])
def test_the_date_of_an_instant_is_its_indian_date(moment, expected, when):
    assert as_date(moment) == expected, f"at {when}"
    assert as_date(moment) != moment.date()


def test_a_date_column_is_passed_through_untouched():
    """asyncpg hands a DATE column back as `datetime.date` with no instant behind
    it, so there is no timezone question to answer and inventing one would move
    every invoice date in the product by a day."""
    assert as_date(date(2026, 9, 4)) == date(2026, 9, 4)
    assert as_date(date(2026, 1, 1)) == date(2026, 1, 1)
    assert as_date(None) is None
    assert as_date("2026-09-04") is None


def test_a_naive_datetime_is_still_read_as_utc_first():
    """`as_utc` treats a naive value as UTC — a small bug upstream, but better
    than raising mid-run — and the IST conversion happens AFTER that, so the two
    steps compose rather than fighting."""
    naive = datetime(2026, 9, 3, 20, 0)
    assert as_date(naive) == date(2026, 9, 4)


# ══════════════════════════════════════════════════════════════════════════════
#  The half that made this one change rather than two
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("moment,expected,when", IN_WINDOW,
                         ids=[c[2] for c in IN_WINDOW])
def test_an_age_computed_across_the_boundary_uses_ONE_calendar(
        moment, expected, when):
    """THE ASSERTION THAT WOULD HAVE CAUGHT A HALF-DONE CHANGE.

    A row created at the same instant the report runs is zero days old. That is
    true on any single clock and false on two: with `today` on IST and
    `as_date` still on UTC it would read as 1, and with the pair swapped, -1.

    Fourteen handlers compute exactly this shape, so it is asserted directly.
    """
    today = today_ist(moment)
    assert days_between(today, as_date(moment)) == 0, f"at {when}"

    a_day_earlier = moment - timedelta(days=1)
    assert days_between(today, as_date(a_day_earlier)) == 1, f"at {when}"


def test_an_age_is_counted_in_whole_indian_days():
    """A bill raised at 23:00 IST and read at 01:00 IST the next night is one
    day old, not two and not zero — the calendar turned once between them."""
    raised = _utc(2026, 9, 3, 17, 30)      # 23:00 IST on 3 September
    reading = _utc(2026, 9, 4, 19, 30)     # 01:00 IST on 5 September
    assert as_date(raised) == date(2026, 9, 3)
    assert today_ist(reading) == date(2026, 9, 5)
    assert days_between(today_ist(reading), as_date(raised)) == 2


# ══════════════════════════════════════════════════════════════════════════════
#  The statutory one
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("moment,expected,utc_would_say,when", [
    (_utc(2026, 8, 31, 20, 0), "2026-08", "2026-07", "01:30 IST on 1 September"),
    (_utc(2026, 3, 31, 20, 0), "2026-03", "2026-02", "01:30 IST on 1 April"),
    (_utc(2025, 12, 31, 19, 0), "2025-12", "2025-11", "00:30 IST on 1 January"),
])
def test_the_gst_return_period_is_the_month_the_preparer_just_left(
        moment, expected, utc_would_say, when):
    """⚠ THE SHARPEST OF THE THREE, BECAUSE THE ANSWER IS STATUTORY.

    `return_period` is "the month you have left" — the one a preparer is filing.
    On the UTC clock, opening a GST screen inside the window took the month back
    twice: once because the clock said yesterday, and once because this helper
    then subtracts a month. Two months before the right one, beside a section
    reference and a due date.
    """
    assert return_period(moment) == expected, f"at {when}"
    assert return_period(moment) != utc_would_say, (
        f"at {when} the old UTC clock returned {utc_would_say} — two months "
        f"before the one being filed"
    )


def test_the_january_rollover_still_crosses_the_year():
    """December is the previous month of January, and the YEAR goes back with
    it. Unrelated to the timezone and asserted here because the IST change
    rewrote the line that does it."""
    assert return_period(_utc(2026, 1, 15, 12, 0)) == "2025-12"
    assert return_period(_utc(2026, 2, 15, 12, 0)) == "2026-01"


# ══════════════════════════════════════════════════════════════════════════════
#  The rota, which was off by a WEEK rather than a day
# ══════════════════════════════════════════════════════════════════════════════

def test_the_coming_week_is_not_a_week_out_at_the_monday_boundary():
    """`coming_week_start` looks ahead to the Monday of the week being staffed.

    At 01:30 IST on a Monday the UTC clock still says Sunday, and Sunday's
    "coming Monday" is TOMORROW — the week that has already begun — while
    Monday's is seven days out. Not a day's error: a whole week's.
    """
    monday_0130_ist = _utc(2026, 9, 6, 20, 0)   # 01:30 IST, Monday 7 September
    assert today_ist(monday_0130_ist) == date(2026, 9, 7)
    assert monday_0130_ist.date() == date(2026, 9, 6)   # UTC still says Sunday
    assert coming_week_start(monday_0130_ist) == date(2026, 9, 14)

    # And mid-week it is unremarkable, which is why nobody noticed.
    assert coming_week_start(_utc(2026, 9, 9, 12, 0)) == date(2026, 9, 14)


# ══════════════════════════════════════════════════════════════════════════════
#  What did NOT move
# ══════════════════════════════════════════════════════════════════════════════

def test_utc_now_is_still_utc():
    """The instant clock does not move and must not. It exists to compare
    against `timestamptz` columns asyncpg returns as aware UTC datetimes. AN
    INSTANT IS UTC; A CALENDAR DATE BELONGS TO THE READER."""
    assert utc_now().utcoffset() == timedelta(0)


def test_hours_between_is_untouched_by_any_of_this():
    """Elapsed hours are the same number on every clock, so this helper had
    nothing to fix — asserted so a future sweep does not 'fix' it anyway."""
    from services.skills.timeutil import hours_between

    a = _utc(2026, 9, 3, 20, 0)
    b = _utc(2026, 9, 3, 14, 0)
    assert hours_between(a, b) == 6.0


# ══════════════════════════════════════════════════════════════════════════════
#  The ratchet
# ══════════════════════════════════════════════════════════════════════════════

def _code_without_prose(src: str) -> str | None:
    """Source with every comment and docstring dropped, via the AST.

    Asserted on code and never on prose — the notes added by this change NAME
    `utc_now().date()` to explain what was removed, and a text search matches
    the explanation. The same trap took two earlier ratchets green.
    """
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = node.body
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            node.body = body[1:] or [ast.Pass()]
    return ast.unparse(ast.fix_missing_locations(tree))


def test_no_handler_takes_the_utc_date_of_an_instant_again():
    """Walks `services/` and reads the SOURCE.

    Two spellings are refused, because both were in the tree: `utc_now().date()`
    — 54 of those — and `as_utc(x).date()`, which is the same mistake reached by
    a different route and was the last one left, in `wip_and_quotes._as_of_date`.
    """
    root = pathlib.Path(__file__).resolve().parent.parent / "services"
    assert root.is_dir(), f"{root} is not a directory — the search would be vacuous"

    canonical = root / "skills" / "timeutil.py"
    assert canonical.is_file(), "services/skills/timeutil.py is gone"

    scanned, offenders = 0, []
    for path in root.rglob("*.py"):
        if path == canonical:
            continue          # it is where the one conversion legitimately lives
        scanned += 1
        code = _code_without_prose(path.read_text(encoding="utf-8-sig",
                                                  errors="replace"))
        if code is None:
            continue
        for pattern, what in (
            (r"utc_now\(\)\.date\(\)", "utc_now().date()"),
            (r"as_utc\([^)]*\)\.date\(\)", "as_utc(...).date()"),
        ):
            if re.search(pattern, code):
                offenders.append(f"{path.relative_to(root.parent)}  {what}")

    assert scanned > 50, f"only {scanned} python files under {root} — walk is broken"
    assert not offenders, (
        "these take the UTC calendar date of an instant instead of the Indian "
        "one:\n  " + "\n  ".join(offenders) +
        "\n\nUse `today_ist(utc_now())` for today, or `as_date(value)` for the "
        "date of a row. Both are IST, because every reader of these handlers is."
    )


def test_the_frozen_clock_still_reaches_the_date_helpers():
    """⚠ THE SEAM, AND WHY THE CALL SITES READ `today_ist(utc_now())`.

    Every frozen-clock fixture in this suite patches the HANDLER MODULE's
    `utc_now`. Written as a bare `today_ist()` the handlers would have read the
    real clock straight past those patches — 18 tests went red proving it, and
    the ones that stayed green were worse, because they had silently stopped
    freezing anything at all.

    Passing the instant keeps one seam for both clocks. This asserts the shape
    holds rather than trusting a convention.
    """
    from services.skills.data import wip_and_quotes as wq

    frozen = _utc(2026, 9, 3, 20, 0)            # 01:30 IST on 4 September
    assert wq.today_ist(frozen) == date(2026, 9, 4)

    src = (pathlib.Path(wq.__file__)).read_text(encoding="utf-8-sig")
    code = _code_without_prose(src)
    assert "today_ist(utc_now())" in code, (
        "wip_and_quotes calls today_ist() without the instant, so a fixture "
        "patching utc_now no longer freezes it"
    )
    assert not re.search(r"(?<![\w.])today_ist\(\)", code), (
        "a bare today_ist() reads the real clock past every frozen fixture"
    )
