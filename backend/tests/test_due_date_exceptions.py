"""A due date may have a period exception, and the exception must be the reason.

── WHAT THIS IS PROTECTING ──────────────────────────────────────────────────
The quarterly TDS/TCS statement is due one month after the quarter for Q1–Q3
and TWO months after it for Q4 — 31 July, 31 October, 31 January, 31 MAY. One
`due_month_offset` cannot say both, so migration 266 refused to give those rows
a due day at all and shipped a guard against anyone seeding one. Four filings
printed a form number and no date.

`due_overrides` (migration 267) is what lets them be dated, and the risk it
carries is precise: an override that is present, well-formed, and NOT ACTUALLY
READ leaves Q4 printing 30 April beside a statute citation, which is worse than
the blank it replaced. So the assertions below are written to fail if the
override stops being consulted — several of them by asserting the SAME row
without its override gives the wrong answer, which is the only way to show the
override is what produced the right one.

── THE OFFLINE/LIVE SPLIT ───────────────────────────────────────────────────
The resolution is pure and is tested offline against rows written here. The
LIVE half then asserts that the rows in the production calendar are the shape
these tests assume — because a resolver that handles overrides correctly and a
table with no overrides in it is still four undated filings, and nothing else
in the suite would notice.
"""
from __future__ import annotations

import asyncio
import os
from datetime import date

import pytest

from services.statute import _COLS, due_date_from


# ══════════════════════════════════════════════════════════════════════════════
#  The rows, written the way migration 267 writes them
# ══════════════════════════════════════════════════════════════════════════════

#: The quarterly TDS/TCS statement: +1 month, except a quarter ending in March,
#: which is +2. Form 138/140/143/144 under s.397(3)(b), rule 219.
STATEMENT = {
    "obligation_key": "tds.statement.nonsalary",
    "due_day": 31,
    "due_month": None,
    "due_month_offset": 1,
    "due_overrides": {"3": {"month_offset": 2}},
}

#: The monthly deposit: the 7th of the following month, except March's, which is
#: deposited by 30 April. Rule 218. This exception is INHERITED — the 1961 row
#: had the same shape and was a month early for March since it was seeded.
DEPOSIT = {
    "obligation_key": "tds.deposit.monthly",
    "due_day": 7,
    "due_month": None,
    "due_month_offset": 1,
    "due_overrides": {"3": {"day": 30}},
}


def _without_override(row: dict) -> dict:
    """The same row as it was before 267 — the thing being compared against."""
    return {**row, "due_overrides": None}


# ══════════════════════════════════════════════════════════════════════════════
#  The four quarters
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("quarter,period_end,due", [
    ("Q1", date(2026, 6, 30), date(2026, 7, 31)),
    ("Q2", date(2026, 9, 30), date(2026, 10, 31)),
    ("Q3", date(2026, 12, 31), date(2027, 1, 31)),
    ("Q4", date(2027, 3, 31), date(2027, 5, 31)),
])
def test_every_quarterly_statement_is_dated(quarter, period_end, due):
    """All four, and Q4 is the one that could not be expressed before.

    Q3 crosses a calendar year (31 Dec -> 31 Jan) and Q4 crosses both a year
    boundary and the override, so between them the two arithmetic paths that
    could go wrong are both exercised.
    """
    got = due_date_from(STATEMENT, period_end)
    assert got == due, (
        f"{quarter} ending {period_end} resolved to {got}, statute says {due} "
        f"(s.397(3)(b) read with rule 219)"
    )


def test_q4_is_a_month_early_without_the_override():
    """THE ANTI-VACUITY ASSERTION, and the reason the column exists.

    Without `due_overrides` this row is exactly what migration 266 refused to
    write: day 31, offset 1. It resolves Q4 to 30 April against a law that says
    31 May. If this stops being true — if the plain row somehow starts giving
    31 May — then the test above is passing for a reason that has nothing to do
    with the override, and the override could be deleted without a red test.
    """
    plain = due_date_from(_without_override(STATEMENT), date(2027, 3, 31))
    assert plain == date(2027, 4, 30), (
        "the un-overridden row no longer resolves Q4 to 30 April, so the test "
        "above no longer demonstrates that the override is what fixes it"
    )
    assert due_date_from(STATEMENT, date(2027, 3, 31)) != plain


@pytest.mark.parametrize("period_end", [
    date(2026, 6, 30), date(2026, 9, 30), date(2026, 12, 31),
])
def test_the_other_three_quarters_are_untouched_by_the_override(period_end):
    """An exception keyed on March must change nothing in June, September or
    December. A rule that fires on every period is not an exception."""
    assert (due_date_from(STATEMENT, period_end)
            == due_date_from(_without_override(STATEMENT), period_end))


# ══════════════════════════════════════════════════════════════════════════════
#  The monthly deposit, whose exception moves the DAY rather than the month
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("period_end,due", [
    (date(2026, 4, 30), date(2026, 5, 7)),
    (date(2026, 8, 31), date(2026, 9, 7)),
    (date(2027, 2, 28), date(2027, 3, 7)),
    (date(2027, 3, 31), date(2027, 4, 30)),   # the exception
])
def test_the_deposit_is_the_seventh_except_for_march(period_end, due):
    got = due_date_from(DEPOSIT, period_end)
    assert got == due, (
        f"deduction in {period_end:%B %Y} resolved to {got}, rule 218 says {due}"
    )


def test_march_deposit_was_three_weeks_early_before_the_override():
    """The inherited defect, stated so its repair cannot regress silently.

    TDS deducted in March is payable by 30 April for a non-government deductor.
    The row said 7 April, and had since it was first seeded under the 1961 Act.
    """
    assert due_date_from(_without_override(DEPOSIT), date(2027, 3, 31)) \
        == date(2027, 4, 7)


def test_a_day_override_does_not_disturb_the_month():
    """`{"day": 30}` moves the day only. If it also cleared the offset, March's
    deposit would land on 30 March — before the deduction period even ends."""
    got = due_date_from(DEPOSIT, date(2027, 3, 31))
    assert got.month == 4 and got.year == 2027, f"{got} is not in April 2027"


# ══════════════════════════════════════════════════════════════════════════════
#  What the override may and may not do
# ══════════════════════════════════════════════════════════════════════════════

def test_an_absolute_month_override_clears_the_offset():
    """Otherwise `due_month` would never be reached — the offset branch runs
    first and wins, so an override naming a month would be silently ignored."""
    row = {"due_day": 20, "due_month_offset": 1, "due_month": None,
           "due_overrides": {"6": {"month": 11}}}
    assert due_date_from(row, date(2026, 6, 30)) == date(2026, 11, 20)


def test_an_offset_override_beats_an_absolute_month_on_the_row():
    """The other direction, stated as what it IS rather than what it looked like.

    This was first written as "an offset override CLEARS the absolute month",
    with a line in `_apply_override` doing exactly that. Mutation testing found
    the assertion green with that line deleted: the offset branch is tried first
    and wins regardless, so the clearing was unobservable and the test was
    satisfied by its own shape. The line is gone; this asserts the behaviour
    that is actually load-bearing.
    """
    row = {"due_day": 15, "due_month_offset": None, "due_month": 12,
           "due_overrides": {"3": {"month_offset": 2}}}
    assert due_date_from(row, date(2026, 3, 31)) == date(2026, 5, 15)
    # And without the override the row's own absolute month is what applies —
    # so the override is demonstrably the thing that changed the answer.
    assert due_date_from(_without_override(row), date(2026, 3, 31))         == date(2026, 12, 15)


def test_a_row_with_no_day_stays_undated_whatever_the_override_says():
    """An override refines a dated rule; it does not invent one. A calendar row
    nobody has researched must keep saying so — that honesty is what the four
    statement rows printed for the whole of 266's life."""
    row = {"due_day": None, "due_month_offset": 1, "due_month": None,
           "due_overrides": {"3": {"month_offset": 2}}}
    assert due_date_from(row, date(2027, 3, 31)) is None


@pytest.mark.parametrize("junk", [
    "not json at all", "[]", '{"3": "sometime in May"}', '{"3": null}',
    "", 0, [], {"3": []},
])
def test_a_malformed_override_falls_back_to_the_row(junk):
    """This resolves dates inside an unattended cron sweep. A skill that dies
    mid-report is worse than one that answers with the rule it can read, and the
    fallback is the sourced value in the row itself, not a guess."""
    row = {**STATEMENT, "due_overrides": junk}
    assert due_date_from(row, date(2027, 3, 31)) == date(2027, 4, 30)


def test_jsonb_arriving_as_a_string_is_still_read():
    """`db.py` registers a jsonb codec, so this is normally a dict — but that
    registration is retried three times and gives up with a warning under
    PgBouncer. A date is not worth losing to that."""
    row = {**STATEMENT, "due_overrides": '{"3": {"month_offset": 2}}'}
    assert due_date_from(row, date(2027, 3, 31)) == date(2027, 5, 31)


def test_the_column_is_readable():
    """`_COLS` is an explicit list, so a column the table has and the SELECT
    does not is a column that is always None at the caller — which would make
    every assertion above pass offline and change nothing in production."""
    assert "due_overrides" in _COLS


# ══════════════════════════════════════════════════════════════════════════════
#  The rules that were already right
# ══════════════════════════════════════════════════════════════════════════════

def test_gstr9_still_reads_the_absolute_month():
    """The bug that HAPPENED: the offset branch ran, `due_month` was never
    looked at, and GSTR-9 for FY 2025-26 printed as 31 March 2026 — nine months
    early, beside a statute citation. Restated here because this file is now
    the only implementation of that rule."""
    gstr9 = {"due_day": 31, "due_month": 12, "due_month_offset": None,
             "due_overrides": None}
    assert due_date_from(gstr9, date(2026, 3, 31)) == date(2026, 12, 31)


def test_gstr1_still_resolves_by_offset():
    gstr1 = {"due_day": 11, "due_month": None, "due_month_offset": 1,
             "due_overrides": None}
    assert due_date_from(gstr1, date(2026, 8, 31)) == date(2026, 9, 11)


def test_a_day_of_31_clamps_to_the_last_day_of_a_short_month():
    """`due_day 31` with a February landing is the calendar saying "the last
    day", not a data error."""
    row = {"due_day": 31, "due_month": None, "due_month_offset": 1,
           "due_overrides": None}
    assert due_date_from(row, date(2027, 1, 31)) == date(2027, 2, 28)


def test_no_module_defines_its_own_due_date_resolver():
    """THE TEST THAT HAS TO SEARCH, BECAUSE THE ENUMERATING VERSION MISSED ONE.

    Written first as `test_there_is_exactly_one_resolver`, naming gst_year,
    client_register and delta_and_provenance and asserting each was the same
    object. It passed. It could not have failed: those were the three modules
    already known and already fixed, so the assertion only restated the work
    rather than checking it. `firm_flow` held a fourth copy the whole time, and
    it was found by grepping the tree a day later, not by this suite.

    That copy was already wrong when it was found. Migration 267 gave
    `tds.deposit.monthly` a March exception in `due_overrides`, which the copy
    did not read — so the firm flow and the client filing calendar printed
    different dates for the same obligation in the same month.

    So this walks `services/` and reads the SOURCE. A module may import the
    resolver or alias it; a module may not define its own `def _due_date_from`.
    A fifth copy fails here without anybody having to remember it exists.
    """
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parent.parent / "services"
    assert root.is_dir(), f"{root} is not a directory — the search would be vacuous"

    canonical = root / "statute.py"          # where it is SUPPOSED to be defined
    assert canonical.is_file(), "services/statute.py is gone — check this test"

    scanned, offenders = 0, []
    for path in root.rglob("*.py"):
        if path == canonical:
            continue
        scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"^def\s+_?due_date_from\s*\(", text, re.M):
            offenders.append(str(path.relative_to(root.parent)))

    # Anti-vacuity: if the walk finds no files, every assertion below is empty.
    assert scanned > 50, f"only {scanned} python files under {root} — walk is broken"

    assert not offenders, (
        "these modules define their own due-date resolver instead of importing "
        "`services.statute.due_date_from`:\n  " + "\n  ".join(offenders) +
        "\n\nThe rule read `due_month_offset` and never `due_month` once, and "
        "printed GSTR-9 nine months early beside a statute citation. Every extra "
        "copy is another chance to make that bug, and one of them silently "
        "missed the `due_overrides` March exception."
    )


def test_every_caller_shares_the_one_resolver():
    """The other half: importing it is not enough if the name is then rebound."""
    from services.skills.data import (
        client_register, delta_and_provenance, firm_flow, gst_year,
    )
    for mod in (gst_year, client_register, delta_and_provenance, firm_flow):
        assert mod._due_date_from is due_date_from, (
            f"{mod.__name__}._due_date_from is not services.statute.due_date_from"
        )


# ══════════════════════════════════════════════════════════════════════════════
#  LIVE — the calendar must actually carry the overrides
# ══════════════════════════════════════════════════════════════════════════════

#: `conftest.py` sets DATABASE_URL to this so the offline suite has something
#: to import against. Same convention as `test_client_obligations_screen.py` —
#: and read inside the test rather than at module scope, because conftest sets
#: it after this module is imported.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"


def _live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return dsn if dsn and dsn != _PLACEHOLDER_DSN else None


def test_the_production_calendar_dates_all_four_quarters():
    """Everything above is true of rows written by this file. This asserts the
    same of the rows in the database, resolved through the real read API.

    Without it, a resolver that handles overrides perfectly and a table with no
    overrides in it would be indistinguishable from a fix — and the visible
    result would be the four undated filings 266 already shipped.
    """
    dsn = _live_dsn()
    if not dsn:
        pytest.skip(
            "no live database. This half reads the real statute calendar and "
            "cannot be done offline — every row above was written by this file. "
            "Run it with:" + chr(10) +
            "    railway run -s Kartavya -- python -m pytest "
            "tests/test_due_date_exceptions.py -q"
        )

    import asyncpg
    from services.statute import obligation

    async def run():
        conn = await asyncpg.connect(dsn, statement_cache_size=0)
        try:
            import json as _json
            await conn.set_type_codec(
                "jsonb", encoder=_json.dumps, decoder=_json.loads,
                schema="pg_catalog", format="text")

            class _P:
                async def fetch(self, sql, *a):
                    return await conn.fetch(sql, *a)

            keys = ["tds.statement.salary", "tds.statement.nonsalary",
                    "tds.statement.nonresident", "tcs.statement"]
            quarters = [(date(2026, 6, 30), date(2026, 7, 31)),
                        (date(2026, 9, 30), date(2026, 10, 31)),
                        (date(2026, 12, 31), date(2027, 1, 31)),
                        (date(2027, 3, 31), date(2027, 5, 31))]
            out = []
            for key in keys:
                for period_end, expected in quarters:
                    row = await obligation(_P(), key, as_of=period_end)
                    assert row, f"no {key} in force on {period_end}"
                    out.append((key, period_end,
                                due_date_from(row, period_end), expected))

            deposit_end = date(2027, 3, 31)
            dep = await obligation(_P(), "tds.deposit.monthly", as_of=deposit_end)
            assert dep, "no tds.deposit.monthly in force on 2027-03-31"
            out.append(("tds.deposit.monthly", deposit_end,
                        due_date_from(dep, deposit_end), date(2027, 4, 30)))
            return out
        finally:
            await conn.close()

    results = asyncio.run(run())
    assert len(results) == 17, f"expected 17 resolutions, got {len(results)}"
    wrong = [r for r in results if r[2] != r[3]]
    assert not wrong, "\n".join(
        f"{k}: period ending {p} resolved to {got}, statute says {want}"
        for k, p, got, want in wrong
    )
