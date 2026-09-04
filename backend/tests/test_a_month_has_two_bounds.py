"""A month has two bounds, and which one you want is a fact about your column.

── WHAT THIS IS PROTECTING ──────────────────────────────────────────────────
Ten handlers in `services/skills/data/` declared their own month-bounds helper
until 2026-09-04 — seven called `_month_bounds`, three called `_period_bounds` —
under ONE NAME OVER TWO CONTRACTS:

    inclusive last day    client_register, firm_flow, payroll_statutory,
                          ganit_ops, people_checks, gst_year
    exclusive next-first  varta_consent, recon_rules, gst_cliffs, gst_readiness

`_period_bounds` alone was three files split two-to-one, so reading one handler
to learn another's bound gave the wrong answer. Every pairing was CORRECT when
they were collapsed — checked one call site at a time against the operator in
its SQL — so this is not a fix, and nothing about what any query asks for
changed. It removes the eleventh copy's chance to get it wrong.

Two named functions rather than `inclusive=False`, because a bare `False` in an
argument list says nothing about what it buys and picking it wrong does not
raise; it silently answers about a window one day off. The names do the work:

    start, last_day = month_days(period)     # ... AND d.invoice_date <= $3
    start, before   = month_window(period)   # ... AND d.created_at   <  $3

⚠ AGAINST A `timestamptz` COLUMN ONLY `month_window` IS CORRECT — `<= last_day`
drops everything after midnight on the last day, which is nearly all of it.
Against a `date` column both forms work and both are in use. That asymmetry is
the reason the pair exists, and `varta_consent` is the handler that reasoned it
out first; the test that pins it to `month_window` names it for that reason.
"""
from __future__ import annotations

import pathlib
import re
from datetime import date, timedelta

import pytest

from services.skills.timeutil import month_days, month_window


# ══════════════════════════════════════════════════════════════════════════════
#  The two contracts, and the relationship between them
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("month,first,last", [
    ("2026-08", date(2026, 8, 1), date(2026, 8, 31)),
    ("2026-02", date(2026, 2, 1), date(2026, 2, 28)),   # short month
    ("2028-02", date(2028, 2, 1), date(2028, 2, 29)),   # leap February
    ("2026-04", date(2026, 4, 1), date(2026, 4, 30)),   # 30-day month
    ("2026-12", date(2026, 12, 1), date(2026, 12, 31)),  # the year rolls
    ("2026-01", date(2026, 1, 1), date(2026, 1, 31)),
])
def test_month_days_is_inclusive_at_both_ends(month, first, last):
    assert month_days(month) == (first, last)


@pytest.mark.parametrize("month,first,before", [
    ("2026-08", date(2026, 8, 1), date(2026, 9, 1)),
    ("2026-02", date(2026, 2, 1), date(2026, 3, 1)),
    ("2028-02", date(2028, 2, 1), date(2028, 3, 1)),
    ("2026-12", date(2026, 12, 1), date(2027, 1, 1)),   # the year rolls
])
def test_month_window_is_half_open(month, first, before):
    assert month_window(month) == (first, before)


@pytest.mark.parametrize("month", [
    "2026-01", "2026-02", "2026-04", "2026-08", "2026-12", "2028-02", "2100-02",
])
def test_the_two_agree_about_the_month_and_differ_by_exactly_one_day(month):
    """THE ASSERTION EITHER FUNCTION DRIFTING CANNOT SURVIVE, and it needs no
    expected values — so it stays true for a month nobody thought to enumerate.

    They must name the same first day, and `month_window`'s exclusive bound must
    be the day AFTER `month_days`' inclusive one. Any other relationship means
    one of them is off by a day, which is precisely the failure that does not
    raise: a query simply covers a different window than its author believes.
    """
    d_start, last_day = month_days(month)
    w_start, before = month_window(month)
    assert d_start == w_start, "the two disagree about where the month starts"
    assert before == last_day + timedelta(days=1), (
        f"{month}: month_days ends {last_day}, month_window excludes from "
        f"{before} — they must be one day apart or one of them is wrong"
    )
    assert before.day == 1, "the exclusive bound is the FIRST of the next month"


def test_the_last_day_is_inside_the_month_and_the_bound_is_not():
    """Stated as the comparison a caller actually writes, in both forms."""
    last_day = month_days("2026-08")[1]
    before = month_window("2026-08")[1]
    end_of_august = date(2026, 8, 31)
    assert end_of_august <= last_day      # the `<=` pairing includes it
    assert end_of_august < before         # the `<` pairing includes it too
    assert not (date(2026, 9, 1) <= last_day)
    assert not (date(2026, 9, 1) < before)


# ══════════════════════════════════════════════════════════════════════════════
#  One error contract: raise, and name the input
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("junk", [
    "2026-13", "2026-00", "2026-7", "26-08", "2026/08", "2026-08-01",
    "", "  ", "July", None, 202608, ("2026", "08"),
])
@pytest.mark.parametrize("fn", [month_days, month_window])
def test_anything_that_is_not_a_month_raises(fn, junk):
    """ONE CONTRACT, WHERE THERE WERE THREE. Nine copies raised, `recon_rules`
    returned None, and `client_register` alone accepted a full date. A shared
    helper that sometimes returns None is a third contract nobody can hold in
    their head; the None-handling moved to the one call site that wanted it, and
    the date-leniency to the one that had it."""
    with pytest.raises((ValueError, TypeError)):
        fn(junk)


@pytest.mark.parametrize("junk", ["2026-13", "2026-00", "2026-8", "July"])
def test_the_refusal_names_the_input(junk):
    """`date()`'s own message is "month must be in 1..12" and names nothing, so
    a caller reading a log cannot see WHICH value was bad. That message is the
    whole reason the range check exists in `_month_parts` — see the note there
    about which of the eleven copies had a guard that was actually load-bearing.
    """
    with pytest.raises(ValueError) as exc:
        month_days(junk)
    assert repr(junk) in str(exc.value)


def test_month_zero_would_have_been_a_cutoff_in_the_wrong_year():
    """The one place the month-0 guard was REAL, kept as a regression test.

    `itc_reversal._period_end` computed only the END of a month, from
    `date(y, month + 1, 1)`, so month 0 never reached a bad `date()` call and
    `'2026-00'` came back as 2025-12-31 — a cutoff in the wrong YEAR, with every
    bill then bucketed against a period string that does not exist. It is
    `month_days(period)[1]` now, and this asserts the refusal survived the move.
    """
    from services.skills.data.itc_reversal import _period_end

    def without_the_guard(period: str) -> date:
        year, month = (int(p) for p in period.split("-", 1))
        nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        return date.fromordinal(nxt.toordinal() - 1)

    # Anti-vacuity: the bad answer really is reachable without a check.
    assert without_the_guard("2026-00") == date(2025, 12, 31)
    assert without_the_guard("2026-08") == date(2026, 8, 31)

    assert _period_end("2026-08") == date(2026, 8, 31)
    with pytest.raises(ValueError):
        _period_end("2026-00")


# ══════════════════════════════════════════════════════════════════════════════
#  One implementation each — the search, and the per-module decision
# ══════════════════════════════════════════════════════════════════════════════

#: Functions the walk below finds by name and which are NOT a month.
#:
#: THIS LIST IS TWO ENTRIES LONG AND MUST STAY THAT WAY. Both answer a different
#: question — "the whole settlement period of this CADENCE containing this
#: date" — and neither takes a `'YYYY-MM'`. They are exempted here, by name and
#: with their signature, rather than by narrowing the pattern: a narrower regex
#: would also stop finding real copies, and this walk finding three modules
#: nobody had enumerated is the only reason `gst_period` was collapsed at all.
NOT_A_MONTH = {
    # (period: str, anchor: date) -> the monthly/quarterly/annual settlement
    # period a commission scheme is tested over. Three branches, one of which
    # happens to be a calendar month.
    ("services/commission.py", "period_bounds"),
    # (start: date, cadence: str) -> one whole billing period from an arbitrary
    # anchor, so periods tile without overlapping. Not calendar-aligned at all.
    ("services/platform_proration.py", "period_bounds"),
}

#: Same question, different BOUNDARY — allowed to keep the name, required to
#: delegate. `gst_period.period_bounds` answers exactly what `month_window`
#: does, and both of its differences are load-bearing and documented: it returns
#: ISO STRINGS (callers bind `$n::text::date`, and `_build_tally` puts them
#: straight into XML) and it raises `HTTPException(400)` because it sits behind
#: a router, where a ValueError is a 500 that tells the preparer nothing.
#:
#: It held THREE copies of the rollover — the helper and two functions that
#: inlined it again, one of them ten lines below — and the walk above is what
#: found them. The check below is what stops a fourth: it may wrap the shared
#: arithmetic, it may not restate it.
ADAPTERS = {
    ("services/gst_period.py", "period_bounds"): "month_window",
}


def _calls(src: str, func: str, callee: str) -> bool:
    """Does `func` in this source actually CALL `callee`? Parsed, not grepped."""
    import ast

    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name != func:
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Call):
                fn = inner.func
                name = getattr(fn, "id", None) or getattr(fn, "attr", None)
                if name == callee:
                    return True
    return False


def test_no_module_defines_its_own_month_bounds():
    """Walks `services/` and reads the SOURCE, the way the due-date resolver's
    and the citation's ratchets do. A module may import either helper or alias
    it; a module may not define its own. An eleventh copy fails here without
    anybody remembering it exists."""
    backend = pathlib.Path(__file__).resolve().parent.parent
    # `routers/` TOO, not just `services/`. The deleted `gst_readiness` copy's
    # own docstring named `routers/documents.py` as where it did NOT want to
    # import from — that router today imports `gst_period.period_bounds`, which
    # is fine, but the next copy is as likely to appear on that side as this one.
    roots = [backend / "services", backend / "routers"]
    for r in roots:
        assert r.is_dir(), f"{r} is not a directory — the search would be vacuous"
    root = roots[0]

    canonical = root / "skills" / "timeutil.py"
    assert canonical.is_file(), "services/skills/timeutil.py is gone — check this test"
    text = canonical.read_text(encoding="utf-8", errors="replace")
    for name in ("month_days", "month_window"):
        assert re.search(rf"^def {name}\s*\(", text, re.M), (
            f"timeutil does not define {name} — this test would otherwise pass "
            f"by finding no copies of a function nobody has"
        )

    scanned, offenders = 0, []
    for path in (p for r in roots for p in r.rglob("*.py")):
        if path == canonical:
            continue
        scanned += 1
        src = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"^def\s+(_?(?:month_bounds|period_bounds))\s*\(([^)]*)\)",
                             src, re.M):
            rel = str(path.relative_to(root.parent)).replace("\\", "/")
            key = (rel, m.group(1))
            if key in NOT_A_MONTH:
                continue
            if key in ADAPTERS:
                # It may WRAP the shared arithmetic. It may not restate it.
                #
                # Checked as an ast.Call and NOT as `"month_window" in body`.
                # The substring version was written first and a mutation walked
                # straight through it: the function's own comment says "the
                # arithmetic is `timeutil.month_window`'s", so re-inlining the
                # rollover underneath left the assertion matching the PROSE
                # ABOUT the code while the code itself was a copy again. Same
                # trap `test_ganit_ops._sql_only` exists for.
                assert _calls(src, m.group(1), ADAPTERS[key]), (
                    f"{rel}:{m.group(1)} is allowed to keep its name only "
                    f"because it delegates to {ADAPTERS[key]} — it no longer "
                    f"calls it, so it is a copy again"
                )
                continue
            offenders.append(f"{rel}  def {m.group(1)}({m.group(2)})")

    assert scanned > 50, f"only {scanned} python files under {root} — walk is broken"
    assert not offenders, (
        "these modules define their own month bounds instead of importing "
        "`month_days` or `month_window` from `services.skills.timeutil`:\n  "
        + "\n  ".join(offenders) +
        "\n\nTen copies under one name held TWO contracts — six inclusive, four "
        "half-open — so reading one handler to learn another's bound gave the "
        "wrong answer. Pick the name that matches your comparison operator."
    )


#: Which convention each handler is on. This is a RECORD OF A DECISION, checked
#: against the SQL operator in each one at the time it was made — not a
#: preference. Changing a row here changes what a query covers by a day.
CONVENTION = {
    "client_register": month_days,      # register window, date column, `<=`
    "firm_flow": month_days,            # month_end also used as a period end
    "payroll_statutory": month_days,    # m_end is passed to obligation(as_of=)
    "ganit_ops": month_days,            # `invoice_date <= $end`, documented
    "people_checks": month_days,        # period_end resolves statutory facts
    "gst_year": month_days,             # `i.invoice_date <= $3::date`
    "varta_consent": month_window,      # ⚠ timestamptz — see the module docstring
    "recon_rules": month_window,        # half-open, `<`
    "gst_cliffs": month_window,         # `b.bill_date < $3::date`
    "gst_readiness": month_window,      # `i.invoice_date < $3`
}


@pytest.mark.parametrize("module,expected", sorted(
    CONVENTION.items(), key=lambda kv: kv[0]))
def test_each_handler_is_on_the_convention_its_queries_were_written_for(
        module, expected):
    """Importing a shared helper is not enough if the WRONG one is imported.

    A module that silently swaps `month_days` for `month_window` keeps compiling,
    keeps passing its own tests against fixture rows, and covers a window one day
    different from the one its SQL was written for. Nothing raises. This is the
    only place that disagreement is visible.
    """
    import importlib

    mod = importlib.import_module(f"services.skills.data.{module}")
    bound = getattr(mod, "_month_bounds", None) or getattr(mod, "_period_bounds", None)
    assert bound is not None, f"{module} binds neither name"
    assert bound is expected, (
        f"{module} is on {getattr(bound, '__name__', bound)}, but its queries "
        f"were written for {expected.__name__}. Changing this moves the window "
        f"by a day — change the SQL operator in the same commit or not at all."
    )


def test_varta_consent_cannot_go_inclusive():
    """Named separately because it is the one case where the choice is FORCED.

    Its window bounds a `timestamptz` column, and `<= last_day` drops everything
    that happened after midnight on the last day of the month — nearly the whole
    day, silently, every month. The other nine could take either form and be
    correct; this one cannot.
    """
    from services.skills.data import varta_consent

    assert varta_consent._month_bounds is month_window
    assert varta_consent._month_bounds is not month_days
