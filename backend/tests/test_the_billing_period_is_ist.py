"""The billing period is IST, because everyone this product bills is in India.

── WHAT THIS IS PROTECTING ──────────────────────────────────────────────────
`credits.current_period()` was UTC until 2026-09-04. Every customer of this
product is an Indian firm, so a UTC month boundary rolled the billing period
over at 05:30 IST — and for those five and a half hours on the 1st of a month, a
charge incurred in India was booked to the month that had already ended.

On 1 April that is the previous FINANCIAL YEAR. In a product Indian chartered
accountants use to close their own books, revenue landing in the wrong FY is not
a rounding error, and it is invisible: nothing raises, both months look
plausible, and the row simply appears on the wrong invoice.

The rest of the product already agreed. `outbound._today_keys` has always
computed its daily and monthly email caps "in IST for period boundaries".
Billing was the outlier, and this file is what stops it becoming one again.

── HOW THESE ASSERT ─────────────────────────────────────────────────────────
Every boundary test states the answer as a DIFFERENCE from what UTC would have
given, at an instant where the two disagree. An assertion that only said
"September" would stay green under a revert for all but 5.5 hours a month, which
is to say it would be green in CI essentially always and red only in production.

Nothing here mocks a clock. `now_ist`, `today_ist` and `month_start_ist` all take
an optional instant, so the boundary is exercised directly rather than patched.
"""
from __future__ import annotations

import ast
import pathlib
import re
from datetime import date, datetime, timedelta, timezone

import pytest

from services.clock import IST, month_start_ist, now_ist, today_ist
from services.credits import current_period


def _utc(y, m, d, hh, mm) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


def _utc_period(moment: datetime) -> date:
    """What the OLD implementation would have returned for this instant."""
    u = moment.astimezone(timezone.utc)
    return date(u.year, u.month, 1)


# ══════════════════════════════════════════════════════════════════════════════
#  The offset
# ══════════════════════════════════════════════════════════════════════════════

def test_ist_is_five_hours_thirty_ahead():
    assert IST.utcoffset(None) == timedelta(hours=5, minutes=30)


def test_now_ist_is_aware_and_actually_tagged_ist():
    """Aware AND tagged — not a UTC datetime with 5:30 added.

    `outbound._today_keys` used to build the second kind: right wall clock,
    lying `tzinfo`. It survives `strftime` and breaks the moment anyone
    subtracts two of them or compares one to a `timestamptz` column.
    """
    n = now_ist()
    assert n.tzinfo is not None
    assert n.utcoffset() == timedelta(hours=5, minutes=30)


# ══════════════════════════════════════════════════════════════════════════════
#  The boundary — stated as a DIFFERENCE from UTC
# ══════════════════════════════════════════════════════════════════════════════

#: Instants inside the window where the two clocks disagree about the month.
#: `id` names what a person in India would call that moment.
DISAGREE = [
    (_utc(2026, 8, 31, 18, 30), date(2026, 9, 1), "00:00 IST on 1 September"),
    (_utc(2026, 8, 31, 20, 0),  date(2026, 9, 1), "01:30 IST on 1 September"),
    (_utc(2026, 8, 31, 23, 59), date(2026, 9, 1), "05:29 IST on 1 September"),
    (_utc(2026, 3, 31, 18, 30), date(2026, 4, 1), "00:00 IST on 1 April — a NEW FY"),
    (_utc(2026, 3, 31, 20, 0),  date(2026, 4, 1), "01:30 IST on 1 April — a NEW FY"),
    (_utc(2025, 12, 31, 19, 0), date(2026, 1, 1), "00:30 IST on 1 January"),
]


@pytest.mark.parametrize("moment,expected,when", DISAGREE,
                         ids=[c[2] for c in DISAGREE])
def test_the_period_follows_india_not_the_server(moment, expected, when):
    """THE ASSERTION A REVERT TO UTC CANNOT SURVIVE.

    Each case asserts BOTH halves: the period is the one India is in, AND it is
    NOT the one UTC would have given. Without the second half this test would
    pass on the old implementation for all but 5.5 hours a month.
    """
    assert month_start_ist(moment) == expected, f"at {when}"
    assert month_start_ist(moment) != _utc_period(moment), (
        f"at {when} the IST period must differ from the UTC one "
        f"({_utc_period(moment)}) — otherwise this case proves nothing"
    )


def test_credits_current_period_calls_the_ist_clock():
    """⚠ ASSERTED STRUCTURALLY, BECAUSE THE OBVIOUS VERSION DOES NOT WORK.

    Written first as `assert current_period() == month_start_ist()`. It passed —
    and it passed just as happily with `current_period` reverted to
    `datetime.now(timezone.utc)`, because the two agree for every instant except
    the 5.5 hours a month this whole file exists for. Caught by mutation, which
    is the only thing that could have caught it: in CI, at any hour a human is
    likely to run the suite, the wrong implementation is indistinguishable.

    `current_period()` takes no argument — 18 call sites depend on that — so it
    cannot be handed a boundary instant. What CAN be checked is that it delegates
    to the function the boundary cases above pin.
    """
    import services.credits

    src = pathlib.Path(services.credits.__file__).read_text(encoding="utf-8-sig")
    assert _calls(src, "current_period", "month_start_ist"), (
        "credits.current_period no longer calls services.clock.month_start_ist. "
        "If it computes the period itself it is on its own clock again, and the "
        "billing month rolls over at 05:30 IST."
    )
    # And the value still agrees, which the structural check alone cannot say.
    assert current_period() == month_start_ist()


@pytest.mark.parametrize("moment", [
    _utc(2026, 8, 31, 18, 29),   # 23:59 IST 31 Aug — still August either way
    _utc(2026, 9, 1, 0, 0),      # 05:30 IST 1 Sep — September either way
    _utc(2026, 9, 15, 12, 0),    # mid-month, nowhere near a boundary
])
def test_outside_the_window_the_two_clocks_agree(moment):
    """Anti-vacuity for the tests above: the change is confined to the window.

    If IST and UTC disagreed everywhere, the boundary tests would prove nothing
    about WHEN the fix bites — and a change that moved every period would be a
    data migration, not a forward-only fix.
    """
    assert month_start_ist(moment) == _utc_period(moment)


def test_the_window_is_exactly_five_and_a_half_hours():
    """Measured by walking the boundary minute by minute rather than asserted.

    18:30 UTC on the last day of a month is 00:00 IST on the 1st; 00:00 UTC is
    05:30 IST. Every minute between is a minute where the two clocks name
    different months, and there are 330 of them.
    """
    start = _utc(2026, 8, 31, 18, 30)
    differing = 0
    for i in range(24 * 60):
        moment = start + timedelta(minutes=i)
        if month_start_ist(moment) != _utc_period(moment):
            differing += 1
    assert differing == 330, f"expected a 330-minute window, measured {differing}"


def test_today_moves_a_day_not_only_a_month():
    """The same 5.5 hours shift the DATE every day, not just the month on the
    1st. `today_ist` exists so a handler asking "what day is it in India" does
    not get yesterday's answer at 02:00."""
    moment = _utc(2026, 9, 3, 20, 0)          # 01:30 IST on 4 September
    assert today_ist(moment) == date(2026, 9, 4)
    assert moment.astimezone(timezone.utc).date() == date(2026, 9, 3)


# ══════════════════════════════════════════════════════════════════════════════
#  One IST, and one clock for the billing period
# ══════════════════════════════════════════════════════════════════════════════

def _calls(src: str, func: str, callee: str) -> bool:
    """Does `func` in this source actually CALL `callee`? Parsed, not grepped."""
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name != func:
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Call):
                name = (getattr(inner.func, "id", None)
                        or getattr(inner.func, "attr", None))
                if name == callee:
                    return True
    return False


def _without_docstrings(tree):
    """The same module with every docstring removed, ready for `ast.unparse`."""
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = node.body
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            node.body = body[1:] or [ast.Pass()]
    return ast.fix_missing_locations(tree)


def test_no_module_defines_its_own_ist_offset():
    """Walks the backend and reads the SOURCE.

    `IST = timezone(timedelta(hours=5, minutes=30))` existed twice —
    `esign_signed_doc` and `push_service` — and `outbound` inlined the same
    offset a third time. A fourth was about to be written for billing. One
    definition; a fifth fails here.
    """
    root = pathlib.Path(__file__).resolve().parent.parent
    canonical = root / "services" / "clock.py"
    assert canonical.is_file(), "services/clock.py is gone — check this test"
    assert re.search(r"^IST = timezone\(", canonical.read_text(encoding="utf-8"), re.M), (
        "services/clock.py does not define IST — this test would otherwise pass "
        "by finding no copies of a constant nobody has"
    )

    skip = {"tests", "__pycache__", ".venv", "venv", "migrations", "scripts"}
    scanned, offenders = 0, []
    for path in root.rglob("*.py"):
        if path == canonical or set(path.parts) & skip:
            continue
        scanned += 1
        src = path.read_text(encoding="utf-8-sig", errors="replace")
        # ASSERTED ON CODE, NEVER ON PROSE. `outbound._today_keys` documents the
        # offset it no longer builds, and a plain text search matched that
        # sentence and called the file an offender. Round-tripping through the
        # AST drops every comment and docstring, so only an expression that
        # actually constructs the offset survives to be matched. Written this
        # way because the identical trap took a duplicated-helper check green
        # the day before, on that function's own explanatory comment.
        try:
            code = ast.unparse(_without_docstrings(ast.parse(src)))
        except SyntaxError:
            continue
        if re.search(r"timedelta\(\s*hours\s*=\s*5\s*,\s*minutes\s*=\s*30\s*\)", code):
            offenders.append(str(path.relative_to(root)).replace("\\", "/"))

    assert scanned > 100, f"only {scanned} python files scanned — walk is broken"
    assert not offenders, (
        "these modules build their own IST offset instead of importing `IST` "
        "from `services.clock`:\n  " + "\n  ".join(offenders) +
        "\n\nOne timezone, one definition. If India ever changes it, this must "
        "be a one-line edit."
    )


def test_every_module_that_names_ist_means_the_same_object():
    """The source walk above matches a SPELLING; this matches the VALUE.

    Mutation walked straight through the walk by aliasing the import —
    `from datetime import timedelta as _td` then `_tz(_td(hours=5, minutes=30))`
    — which is not the text the regex looks for and is a perfectly good fifth
    definition. Identity cannot be spelled around: whatever a module calls `IST`,
    it must BE `services.clock.IST`.
    """
    import importlib

    import services.clock as clock

    named = ["services.esign_signed_doc", "services.push_service", "services.clock"]
    checked = 0
    for dotted in named:
        mod = importlib.import_module(dotted)
        if not hasattr(mod, "IST"):
            continue
        checked += 1
        assert mod.IST is clock.IST, (
            f"{dotted}.IST is a different object from services.clock.IST — "
            f"it has its own definition again"
        )
    assert checked == len(named), (
        f"only {checked} of {len(named)} modules still expose IST; if one was "
        f"renamed this test is quietly checking less than it says"
    )


def test_the_email_caps_and_the_billing_period_share_one_clock():
    """`outbound._today_keys` was already on IST and is the precedent billing
    followed. Two period boundaries in one product that disagree by 5.5 hours is
    worse than both being wrong the same way.

    Structural for the same reason as `current_period` above: comparing the two
    values at the current instant is green for every hour except the ones that
    matter, and mutation proved it — swapping `_today_keys` back to
    `datetime.now(timezone.utc)` left the value assertion untouched.
    """
    import outbound

    src = pathlib.Path(outbound.__file__).read_text(encoding="utf-8-sig")
    assert _calls(src, "_today_keys", "now_ist"), (
        "outbound._today_keys no longer reads the IST clock — the email caps "
        "and the billing period would roll over 5.5 hours apart"
    )
    day_key, month_key = outbound._today_keys()
    assert day_key == today_ist().isoformat()
    assert month_key == month_start_ist().strftime("%Y-%m")


def test_utc_now_is_deliberately_left_alone():
    """`skills.timeutil.utc_now` must NOT become IST, and this says so on purpose.

    It exists to compare against `timestamptz` columns that asyncpg returns as
    aware UTC datetimes. An INSTANT is UTC; a PERIOD A PERSON NAMES is IST.
    Moving the instant clock would break every `days_between` in the catalogue
    while fixing nothing, so the split is asserted rather than left to memory.
    """
    from services.skills.timeutil import utc_now

    assert utc_now().utcoffset() == timedelta(0)
    assert now_ist().utcoffset() == timedelta(hours=5, minutes=30)
