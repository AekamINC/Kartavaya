"""The 1961-Act quarterly statements are dated, and TCS is NOT on the TDS day.

── THE DISTINCTION THIS FILE EXISTS TO HOLD ─────────────────────────────────
Under the Income-tax Act 1961 the two quarterly statements fall on different
days, because Notification 30/2016 moved rule 31A to the 31st and never touched
rule 31AA:

    TDS  24Q / 26Q / 27Q   rule 31A    31 Jul · 31 Oct · 31 Jan · 31 May
    TCS  27EQ              rule 31AA   15 Jul · 15 Oct · 15 Jan · 15 May

The first web search run while researching migration 268 returned a summary
asserting the 31st dates "apply to Form 24Q, 26Q, 27Q, and 27EQ equally". It is
wrong, and believing it would have put every TCS statement sixteen days late
beside a rule citation. Rule 31AA was then checked on its own and three sources
agreed on the 15th. **The assertions below are what stops that summary being
believed again by someone re-seeding this table.**

Only the 2025 Act put TCS on the TDS calendar — Form 143 IS on the 31st — so
"TCS is the 15th" and "TCS is the 31st" are both true, of different decades, and
the whole point of `statute_calendar` is that a date decides which.

── THE OTHER HALF: WHAT IS DELIBERATELY STILL UNDATED ───────────────────────
Only 1 June 2016 onwards is seeded. Before that the dates differed by deductor
type (government vs other), which one row cannot express, and it was not
researched. A quarter ending in 2015 must therefore still come back with no
date — asserted here, because "we date everything now" is the regression that
would print a plausible wrong day for an old period.
"""
from __future__ import annotations

import asyncio
import os
from datetime import date

import pytest

from services.statute import due_date_from


# ══════════════════════════════════════════════════════════════════════════════
#  The rows as migration 268 writes them
# ══════════════════════════════════════════════════════════════════════════════

TDS_1961 = {
    "obligation_key": "tds.statement.nonsalary",
    "form_number": "26Q",
    "due_day": 31, "due_month": None, "due_month_offset": 1,
    "due_overrides": {"3": {"month_offset": 2}},
}

TCS_1961 = {
    "obligation_key": "tcs.statement",
    "form_number": "27EQ",
    "due_day": 15, "due_month": None, "due_month_offset": 1,
    "due_overrides": {"3": {"month_offset": 2}},
}


# ══════════════════════════════════════════════════════════════════════════════
#  Rule 31A — the TDS statements
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("quarter,period_end,due", [
    ("Q1 FY2016-17", date(2016, 6, 30), date(2016, 7, 31)),
    ("Q2", date(2025, 9, 30), date(2025, 10, 31)),
    ("Q3", date(2025, 12, 31), date(2026, 1, 31)),
    ("Q4 FY2025-26", date(2026, 3, 31), date(2026, 5, 31)),
])
def test_tds_statement_dates(quarter, period_end, due):
    """Q1 FY2016-17 is the source's own headline example — "last date for filing
    TDS returns for Q1 FY 2016-17: 31st July" — so it doubles as a check that the
    2016-06-01 window boundary is in the right place.

    Q4 FY2025-26 is the live one: it fell before the repeal, so it resolves
    against a 1961-Act row, and it was due three months before this was written.
    """
    got = due_date_from(TDS_1961, period_end)
    assert got == due, (
        f"{quarter} ending {period_end} resolved to {got}, rule 31A(2) as "
        f"substituted by Notification 30/2016 says {due}"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Rule 31AA — the TCS statement, sixteen days earlier
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("quarter,period_end,due", [
    ("Q1", date(2025, 6, 30), date(2025, 7, 15)),
    ("Q2", date(2025, 9, 30), date(2025, 10, 15)),
    ("Q3", date(2025, 12, 31), date(2026, 1, 15)),
    ("Q4", date(2026, 3, 31), date(2026, 5, 15)),
])
def test_tcs_statement_dates(quarter, period_end, due):
    got = due_date_from(TCS_1961, period_end)
    assert got == due, (
        f"TCS {quarter} ending {period_end} resolved to {got}, rule 31AA says {due}"
    )


@pytest.mark.parametrize("period_end", [
    date(2025, 6, 30), date(2025, 9, 30), date(2025, 12, 31), date(2026, 3, 31),
])
def test_tcs_is_never_on_the_tds_day(period_end):
    """THE ASSERTION AGAINST THE WRONG SUMMARY.

    Stated as a difference rather than as two absolute dates, so it fails if
    somebody "harmonises" the two rules — which is what the first source
    consulted for 268 said to do, and what the 2025 Act genuinely did do later.
    """
    tds = due_date_from(TDS_1961, period_end)
    tcs = due_date_from(TCS_1961, period_end)
    assert tcs != tds, (
        f"TCS and TDS both resolved to {tds} for the quarter ended {period_end}. "
        "Under the 1961 Act rule 31AA is the 15th and rule 31A is the 31st: "
        "Notification 30/2016 moved rule 31A and did not touch rule 31AA. Only "
        "the 2025 Act put them on the same day."
    )
    assert tcs.day == 15 and tds.day in (31, 30, 28, 29)
    assert tcs.month == tds.month, "same month, different day — only the day moved"


def test_the_q4_exception_applies_to_tcs_too():
    """TCS Q4 is 15 MAY, not 15 April — the +2 months applies to both rules.

    Without the override the row would resolve to 15 April, so this shows the
    exception is doing the work here and not just on the TDS row.
    """
    plain = due_date_from({**TCS_1961, "due_overrides": None}, date(2026, 3, 31))
    assert plain == date(2026, 4, 15)
    assert due_date_from(TCS_1961, date(2026, 3, 31)) == date(2026, 5, 15)


# ══════════════════════════════════════════════════════════════════════════════
#  LIVE — the calendar carries two versions, and the older one stays undated
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"


def _live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return dsn if dsn and dsn != _PLACEHOLDER_DSN else None


def test_the_calendar_dates_recent_quarters_and_refuses_old_ones():
    """Resolved through the real read API against the real table.

    Everything above is true of rows written by this file. This is the half that
    can fail when the table does not match them — including the case the offline
    tests structurally cannot reach: `obligation()` picking the WRONG VERSION.
    A period in 2015 must select the undated row and a period in 2025 the dated
    one, and only the live table has both.
    """
    dsn = _live_dsn()
    if not dsn:
        pytest.skip(
            "no live database. Run it with:" + chr(10) +
            "    railway run -e production -s Kartavaya -- env REDIS_URL= "
            "python -m pytest tests/test_1961_quarterly_statements.py -q"
        )

    import json as _json

    import asyncpg

    from services.statute import obligation

    async def run():
        conn = await asyncpg.connect(dsn, statement_cache_size=0)
        try:
            await conn.set_type_codec(
                "jsonb", encoder=_json.dumps, decoder=_json.loads,
                schema="pg_catalog", format="text")

            class _P:
                async def fetch(self, sql, *a):
                    return await conn.fetch(sql, *a)

            cases = [
                # key,                      period end,          expected
                ("tds.statement.salary",    date(2025, 12, 31), date(2026, 1, 31)),
                ("tds.statement.nonsalary", date(2025, 12, 31), date(2026, 1, 31)),
                ("tds.statement.nonresident", date(2026, 3, 31), date(2026, 5, 31)),
                ("tds.statement.nonsalary", date(2026, 3, 31), date(2026, 5, 31)),
                ("tcs.statement",           date(2025, 12, 31), date(2026, 1, 15)),
                ("tcs.statement",           date(2026, 3, 31), date(2026, 5, 15)),
                # Before 1 June 2016 — the window nobody researched. Undated.
                ("tds.statement.nonsalary", date(2015, 12, 31), None),
                ("tcs.statement",           date(2015, 12, 31), None),
                # After the repeal — the 2025-Act row, seeded by 267.
                ("tds.statement.nonsalary", date(2026, 6, 30), date(2026, 7, 31)),
                ("tcs.statement",           date(2027, 3, 31), date(2027, 5, 31)),
            ]
            out = []
            for key, period_end, expected in cases:
                row = await obligation(_P(), key, as_of=period_end)
                assert row, f"no {key} in force on {period_end}"
                out.append((key, period_end, row.get("form_number"),
                            due_date_from(row, period_end), expected))
            return out
        finally:
            await conn.close()

    results = asyncio.run(run())
    wrong = [r for r in results if r[3] != r[4]]
    assert not wrong, chr(10).join(
        f"{k}: quarter ended {p} (form {f}) resolved to {got}, expected {want}"
        for k, p, f, got, want in wrong
    )

    # And the forms must have moved with the statute — 27EQ before the repeal,
    # 143 after. A right date on the wrong form is still a rejected return.
    by_case = {(k, p): f for k, p, f, _, _ in results}
    assert by_case[("tcs.statement", date(2026, 3, 31))] == "27EQ"
    assert by_case[("tcs.statement", date(2027, 3, 31))] == "143"
