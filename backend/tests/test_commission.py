"""Commission — the arithmetic, the dated scheme, and the ONE rule.

THE ONE RULE, WHICH IS WHAT MOST OF THIS FILE PINS
──────────────────────────────────────────────────
A zero is a claim. "Not attributable" is the truth.

`SUM(...)` over zero attributed invoices returns 0, and ₹0.00 under a turnover
heading beside a person's name is a sentence about that person: they sold
nothing. Measured live on 2026-08-21, that sentence is false for every person
in every organisation in this database, because no invoice has ever recorded
who sold it. So every test below that looks like it is about a string is
actually about a payslip.

The scans at the end are RATCHETS. They read this commit's own source and fail
if a later edit reintroduces `COALESCE(sum, 0)`, `date.today()`, a write, or a
sort by a figure. Each one is a mistake that produces a plausible-looking page
rather than an error, which is exactly the class of mistake a test has to
catch because a reader never will.

Every live count quoted here was measured read-only against the shared
database on 2026-08-21 before the code was written. Nothing in this file
touches a database.
"""
from __future__ import annotations

import ast
import asyncio
import inspect
import re
from datetime import date
from decimal import Decimal

import pytest

from services import commission as C
from services.report_defs import REPORT_DEFS, load_all
from services.report_defs import commission_reports as CR

ORG = "22222222-2222-2222-2222-222222222222"

#: A window ending on a Friday, mid-quarter, mid-financial-year. Every date in
#: this file is absolute: a test that computes its own "today" fails one
#: morning in CI for no reason and passes again by lunchtime.
ANCHOR = date(2026, 8, 21)          # Friday, FY 2026-27, Q2 (Jul-Sep)


def run(coro):
    return asyncio.run(coro)


def scheme(**over) -> C.Scheme:
    kw = dict(eligible=True, basis="turnover", rate_percent=Decimal("5"),
              threshold_amount=Decimal("1000000"), threshold_mode="excess",
              period="monthly", effective_from=date(2026, 4, 1),
              effective_to=None)
    kw.update(over)
    return C.Scheme(**kw)


def src(module) -> str:
    return inspect.getsource(module)


#: The three complete QUERIES this commit ships. Named explicitly, never
#: discovered by suffix: `QTY_SQL` is a reusable FRAGMENT with no FROM and no
#: parameters, and a sweep that swept it in would make every scan below assert
#: something meaningless about it — and then be loosened until it did.
QUERIES = ("PNL_SQL", "PNL_SPREAD_SQL", "FIGURES_SQL")

#: The queries that measure THE WHOLE BOOK rather than one person. Their
#: figures never appear against a name; they feed the note row, whose whole
#: job is to say how little is known.
DENOMINATOR_QUERIES = ("PNL_SPREAD_SQL", "FIGURES_SQL")


def sql_constants(module) -> dict:
    """Every complete query this commit ships, whitespace-flattened."""
    found = {n for n in dir(module) if n.endswith("_SQL")}
    unlisted = found - set(QUERIES) - {"QTY_SQL"}
    assert not unlisted, (
        f"unlisted SQL constant(s) {sorted(unlisted)} — add them to QUERIES so "
        f"every scan below covers them, or they ship unchecked")
    return {n: " ".join(getattr(module, n).split()) for n in QUERIES}


# ══════════════════════════════════════════════════════════════════════════
# 1 · the dated scheme — half-open, [from, to)
# ══════════════════════════════════════════════════════════════════════════

def test_effective_to_is_exclusive_so_one_date_written_once_splits_the_rates():
    """THE reason the window is half-open.

    The 4% version ends at 2026-04-01 and the 6% version begins at 2026-04-01
    — one date, written once. 31 March answers 4% and 1 April answers 6%.
    Written the other way (effective_to meaning "last valid day") one day of a
    person's pay gets either two answers or none, and which it gets depends on
    row order.
    """
    old = scheme(rate_percent=Decimal("4"), effective_from=date(2025, 4, 1),
                 effective_to=date(2026, 4, 1))
    new = scheme(rate_percent=Decimal("6"), effective_from=date(2026, 4, 1))
    both = [new, old]                       # deliberately not in date order

    assert C.scheme_in_force(both, date(2026, 3, 31)).rate_percent == Decimal("4")
    assert C.scheme_in_force(both, date(2026, 4, 1)).rate_percent == Decimal("6")
    # The boundary day belongs to exactly one version, never both.
    assert sum(1 for s in both if s.covers(date(2026, 4, 1))) == 1


def test_a_date_before_any_version_resolves_to_nothing_not_to_the_earliest():
    """Falling back to the earliest version would compute a commission on a
    rate that was not agreed yet — for a period predating the arrangement."""
    assert C.scheme_in_force([scheme(effective_from=date(2026, 4, 1))],
                             date(2026, 3, 31)) is None


def test_a_closed_version_stops_applying_after_it_closes():
    s = scheme(effective_from=date(2025, 4, 1), effective_to=date(2026, 4, 1))
    assert C.scheme_in_force([s], date(2026, 4, 1)) is None


def test_an_overlap_resolves_deterministically_and_not_by_row_order():
    """Migration 185's partial unique index makes at most one OPEN version per
    employee, but two CLOSED versions can still overlap (btree_gist is not
    installed, so there is no EXCLUDE constraint). A commission figure that
    changes between two runs of the same report is unauditable, so the tie is
    broken by the latest effective_from — the same way the LATERAL in
    `PNL_SQL` orders it."""
    a = scheme(rate_percent=Decimal("4"), effective_from=date(2026, 4, 1),
               effective_to=date(2026, 10, 1))
    b = scheme(rate_percent=Decimal("6"), effective_from=date(2026, 7, 1),
               effective_to=date(2027, 1, 1))
    assert C.scheme_in_force([a, b], ANCHOR).rate_percent == Decimal("6")
    assert C.scheme_in_force([b, a], ANCHOR).rate_percent == Decimal("6")


def test_a_scheme_that_ends_when_it_starts_is_refused_at_construction():
    with pytest.raises(ValueError, match="no days at all"):
        scheme(effective_from=date(2026, 4, 1), effective_to=date(2026, 4, 1))


@pytest.mark.parametrize("bad", [
    {"basis": "revenue"}, {"period": "weekly"}, {"threshold_mode": "gross"},
])
def test_a_value_the_migrations_check_refuses_is_refused_here_too(bad):
    with pytest.raises(ValueError):
        scheme(**bad)


def test_scheme_in_force_takes_the_date_and_never_invents_one():
    """`on` is positional and required. "What is this person's rate" is not a
    question that can be answered without "as of when" — statute.py's rule,
    and for a stronger reason here, because a settled period must still
    reproduce the figure on the payslip already issued."""
    sig = inspect.signature(C.scheme_in_force)
    assert sig.parameters["on"].default is inspect.Parameter.empty


# ══════════════════════════════════════════════════════════════════════════
# 2 · the periods — Indian FY, Monday weeks, no clock
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("anchor,expected", [
    (date(2026, 3, 31), 2025),      # FY 2025-26
    (date(2026, 4, 1), 2026),       # FY 2026-27, on the boundary
    (date(2026, 12, 31), 2026),
    (date(2027, 1, 1), 2026),       # January still belongs to FY 2026-27
])
def test_the_year_is_the_indian_financial_year(anchor, expected):
    assert C.financial_year_of(anchor) == expected


def test_the_financial_year_label_reads_the_way_a_firm_writes_it():
    assert C.financial_year_label(ANCHOR) == "2026-27"
    assert C.financial_year_label(date(2027, 3, 31)) == "2026-27"
    # A century boundary must not roll the label backwards.
    assert C.financial_year_label(date(2099, 12, 1)) == "2099-00"


@pytest.mark.parametrize("anchor,start", [
    (date(2026, 4, 15), date(2026, 4, 1)),      # Q1 Apr-Jun
    (date(2026, 8, 21), date(2026, 7, 1)),      # Q2 Jul-Sep
    (date(2026, 11, 3), date(2026, 10, 1)),     # Q3 Oct-Dec
    (date(2027, 2, 10), date(2027, 1, 1)),      # Q4 Jan-Mar — the tricky one
    (date(2027, 3, 31), date(2027, 1, 1)),
])
def test_quarters_are_financial_quarters_not_calendar_ones(anchor, start):
    """Q4 is the case that catches people: January, February and March belong
    to a financial year that STARTED IN THE PREVIOUS CALENDAR YEAR, but the
    quarter itself starts on 1 January of the anchor's own year. A calendar
    quarter would put the first quarter of the year in the middle of the
    previous one, and every TDS statement this firm files is on FY quarters."""
    assert C.quarter_to_date(anchor) == (start, anchor)


def test_year_to_date_starts_on_1_april_not_1_january():
    """A calendar YTD would restate every consultant's year on 1 January,
    three months out of step with the accounts and with every target set."""
    assert C.year_to_date(ANCHOR) == (date(2026, 4, 1), ANCHOR)
    assert C.year_to_date(date(2027, 2, 10)) == (date(2026, 4, 1), date(2027, 2, 10))


def test_last_financial_year_is_the_complete_one_before_this_one():
    assert C.last_financial_year(ANCHOR) == (date(2025, 4, 1), date(2026, 3, 31))


def test_last_financial_year_agrees_with_statute_fy_bounds():
    """Two modules compute the same object. If they ever disagree, one report
    attributes a 1 April figure to the wrong year — so they are asserted
    equal rather than trusted to stay so."""
    from services.statute import fy_bounds
    assert C.last_financial_year(ANCHOR) == fy_bounds("2025-26")


def test_weeks_start_on_monday():
    # 2026-08-21 is a Friday.
    assert ANCHOR.weekday() == 4
    assert C.week_to_date(ANCHOR) == (date(2026, 8, 17), ANCHOR)
    monday = date(2026, 8, 17)
    assert C.week_to_date(monday) == (monday, monday)


@pytest.mark.parametrize("period,anchor,expected", [
    ("monthly", date(2026, 2, 10), (date(2026, 2, 1), date(2026, 2, 28))),
    ("monthly", date(2028, 2, 10), (date(2028, 2, 1), date(2028, 2, 29))),
    ("monthly", date(2026, 12, 5), (date(2026, 12, 1), date(2026, 12, 31))),
    ("quarterly", ANCHOR, (date(2026, 7, 1), date(2026, 9, 30))),
    ("quarterly", date(2027, 2, 10), (date(2027, 1, 1), date(2027, 3, 31))),
    ("annual", ANCHOR, (date(2026, 4, 1), date(2027, 3, 31))),
])
def test_a_settlement_period_is_the_whole_period_leap_years_included(
        period, anchor, expected):
    """The threshold is tested against a WHOLE period, so the bounds must be
    exact. February is built by walking to the first of the next month, not by
    adding 30 days, and the leap case is pinned because a commission threshold
    tested over 28 days in a 29-day month is a threshold nobody agreed to."""
    assert C.period_bounds(period, anchor) == expected


def test_a_period_still_running_is_a_forecast_and_says_so():
    assert C.period_is_complete("monthly", ANCHOR, date(2026, 8, 31)) is True
    assert C.period_is_complete("monthly", ANCHOR, ANCHOR) is False
    assert C.period_is_complete("annual", ANCHOR, ANCHOR) is False


# ══════════════════════════════════════════════════════════════════════════
# 3 · the figures — None and zero are different answers
# ══════════════════════════════════════════════════════════════════════════

def test_a_missing_cost_is_not_a_zero_cost():
    """A zero cost is a claim of 100% gross margin, which is the most
    flattering possible lie. It must be impossible to produce by accident."""
    f = C.figures(Decimal("100000"), None, cost_reason=C.NOT_RECORDED)
    assert f.cost is None
    assert f.gross_profit is None
    assert f.margin_pct is None
    assert f.gross_profit_reason == C.NOT_RECORDED


def test_a_zero_cost_that_was_actually_recorded_survives():
    """The inverse ratchet: a real recorded zero must not be swallowed by the
    None handling. A firm that sells its own time genuinely has zero direct
    cost, and its 100% margin is true."""
    f = C.figures(Decimal("100000"), Decimal("0"))
    assert f.cost == Decimal("0.00")
    assert f.gross_profit == Decimal("100000.00")
    assert f.margin_pct == Decimal("100.00")


def test_an_unattributed_turnover_poisons_everything_downstream():
    f = C.figures(None, None, turnover_reason=C.NOT_ATTRIBUTABLE,
                  cost_reason=C.NOT_RECORDED)
    assert f.gross_profit is None
    assert f.gross_profit_reason == C.NOT_ATTRIBUTABLE   # the FIRST missing input
    assert f.margin_pct is None


def test_margin_on_zero_turnover_is_undefined_not_zero_percent():
    """0% would read as "sold at cost". Nothing was sold."""
    f = C.figures(Decimal("0"), Decimal("0"))
    assert f.gross_profit == Decimal("0.00")
    assert f.margin_pct is None
    assert "no turnover" in f.margin_reason


def test_margin_on_a_negative_turnover_is_refused():
    """A period whose credit notes exceed its invoices has a negative
    denominator; a percentage computed on it has the wrong sign and is worse
    than no answer."""
    f = C.figures(Decimal("-5000"), Decimal("1000"))
    assert f.gross_profit == Decimal("-6000.00")
    assert f.margin_pct is None


def test_money_does_not_go_through_binary_float():
    """0.1 as a binary float is 0.1000000000000000055…, and a rate applied to
    a crore-scale turnover drifts in the paisa the payslip is checked
    against."""
    assert C.to_decimal(0.1) == Decimal("0.1")
    assert C.money(2.675) == Decimal("2.68")        # half UP, not banker's


# ══════════════════════════════════════════════════════════════════════════
# 4 · the commission — the four absences, and the two cheques
# ══════════════════════════════════════════════════════════════════════════

def test_no_scheme_and_not_on_commission_are_different_answers():
    """One is a question for HR; the other is an answer from them. Collapsing
    them loses the distinction the `eligible` column exists to carry."""
    f = C.figures(Decimal("2000000"), Decimal("500000"))
    assert C.commission_due(None, f).reason == C.NO_SCHEME
    assert C.commission_due(scheme(eligible=False), f).reason == C.NOT_ON_COMMISSION
    assert C.commission_due(None, f).amount is None
    assert C.commission_due(scheme(eligible=False), f).amount is None


def test_the_threshold_mode_is_the_difference_between_two_cheques():
    """₹12L at 5% over a ₹10L threshold: ₹10,000 on excess, ₹60,000 on whole.
    The product must not pick one silently — assuming 'excess' underpays a
    person every period and assuming 'whole' spends the firm's money."""
    f = C.figures(Decimal("1200000"), None, cost_reason=C.NOT_RECORDED)
    excess = C.commission_due(scheme(threshold_mode="excess"), f)
    whole = C.commission_due(scheme(threshold_mode="whole"), f)
    assert excess.amount == Decimal("10000.00")
    assert whole.amount == Decimal("60000.00")
    assert excess.commissionable == Decimal("200000.00")
    assert whole.commissionable == Decimal("1200000.00")


def test_the_threshold_test_includes_the_threshold_itself():
    """"Commission from ₹10 lakh" includes ₹10 lakh. Under 'whole' this is the
    difference between the whole cheque and none of it."""
    f = C.figures(Decimal("1000000"), None, cost_reason=C.NOT_RECORDED)
    assert C.commission_due(scheme(threshold_mode="whole"), f).amount \
        == Decimal("50000.00")
    assert C.commission_due(scheme(threshold_mode="excess"), f).amount \
        == Decimal("0.00")


def test_below_the_threshold_is_a_real_zero_not_an_absence():
    """This is the one zero the page is allowed to print, and it is a fact the
    person can check: they sold ₹9L against a ₹10L threshold."""
    f = C.figures(Decimal("900000"), None, cost_reason=C.NOT_RECORDED)
    due = C.commission_due(scheme(), f)
    assert due.amount == Decimal("0.00")
    assert due.threshold_met is False
    assert due.reason == ""
    assert due.computable is True


def test_a_gross_profit_scheme_is_not_computable_without_a_cost():
    """The live case: a firm that pays on margin, and no line has ever
    recorded a cost. The answer is a reason, never a number."""
    f = C.figures(Decimal("5000000"), None, cost_reason=C.NOT_RECORDED)
    due = C.commission_due(scheme(basis="gross_profit", threshold_amount=Decimal("0")), f)
    assert due.amount is None
    assert due.reason == C.NOT_RECORDED


def test_a_turnover_scheme_is_not_computable_without_attribution():
    """The other live case, and today's answer for every person in the
    database: the invoices exist, and none of them says who sold them."""
    f = C.figures(None, None, turnover_reason=C.NOT_ATTRIBUTABLE,
                  cost_reason=C.NOT_RECORDED)
    due = C.commission_due(scheme(), f)
    assert due.amount is None
    assert due.reason == C.NOT_ATTRIBUTABLE


def test_a_negative_period_floors_at_zero_and_never_pays_backwards():
    """Recovering an overpayment is an employment decision with notice periods
    behind it, not arithmetic. Returning a negative number invites something
    downstream to pay it."""
    f = C.figures(Decimal("-300000"), None, cost_reason=C.NOT_RECORDED)
    due = C.commission_due(scheme(threshold_amount=Decimal("0"),
                                  threshold_mode="whole"), f)
    assert due.amount == Decimal("0.00")
    assert due.amount >= 0


def test_a_gross_profit_scheme_computes_when_the_cost_is_there():
    """The whole point, once the data exists: ₹50L billed, ₹30L cost, ₹20L
    contribution, 10% over a ₹5L threshold on the excess = ₹1.5L."""
    f = C.figures(Decimal("5000000"), Decimal("3000000"))
    assert f.gross_profit == Decimal("2000000.00")
    assert f.margin_pct == Decimal("40.00")
    due = C.commission_due(
        scheme(basis="gross_profit", rate_percent=Decimal("10"),
               threshold_amount=Decimal("500000")), f)
    assert due.amount == Decimal("150000.00")
    assert due.threshold_met is True


def test_the_bases_and_periods_match_the_migration_checks_exactly():
    """A value added to one side and not the other fails here rather than at a
    payslip. Parsed out of the migration FILE, so this tests the SQL that will
    be applied and not a constant somebody wrote to agree with Python."""
    sql = open("migrations/185_commission_schemes.sql", encoding="utf-8").read()
    for name, values in (("basis", C.BASES), ("period", C.PERIODS),
                         ("threshold_mode", C.THRESHOLD_MODES)):
        m = re.search(rf"CHECK \(\s*{name} IN \(([^)]*)\)", sql)
        assert m, f"no CHECK found for {name} in migration 185"
        in_sql = tuple(re.findall(r"'([a-z_]+)'", m.group(1)))
        assert in_sql == tuple(values), \
            f"{name}: migration says {in_sql}, commission.py says {tuple(values)}"


# ══════════════════════════════════════════════════════════════════════════
# 5 · the consultant page
# ══════════════════════════════════════════════════════════════════════════

#: The live state, as at 2026-08-21: documents exist, NONE names a
#: salesperson, NO line carries a cost, and every employee is unlinked.
TODAY_SPREAD = {"docs": 686, "docs_attributed": 0, "value": 115500000.0,
                "value_attributed": 0.0, "lines": 1342, "lines_costed": 0,
                "employees_unlinked": 98}

PEOPLE = [
    {"person": "Anita Desai", "turnover": None, "docs": None, "cost": None,
     "lines_costed": None, "has_employee": False, "basis": None,
     "effective_from": None},
    {"person": "Bhavesh Rao", "turnover": None, "docs": None, "cost": None,
     "lines_costed": None, "has_employee": False, "basis": None,
     "effective_from": None},
]


def cells(rows, column):
    return [r[column] for r in rows]


def test_todays_page_says_not_attributable_on_every_line_and_prints_no_zero():
    """THE test. With 686 documents in the period and not one recording who
    sold it, a `SUM` returns 0 for everybody and a tidy right-aligned ₹0.00
    would tell the firm that both of these people sold nothing. They may have
    sold everything; nobody wrote it down."""
    rows = CR.build_pnl_rows(PEOPLE, TODAY_SPREAD, ANCHOR)
    people = rows[:2]
    assert cells(people, "Turnover") == [C.NOT_ATTRIBUTABLE] * 2
    assert cells(people, "Cost") == [C.NOT_RECORDED] * 2
    assert cells(people, "Gross profit") == [C.NOT_ATTRIBUTABLE] * 2
    assert cells(people, "Commission") == [C.NO_SCHEME] * 2
    for r in people:
        for col in ("Turnover", "Cost", "Gross profit", "Margin %", "Commission"):
            assert r[col] != 0 and r[col] != 0.0, \
                f"{col} printed a zero where nothing is known"


def test_the_footer_repeats_the_columns_own_word_rather_than_a_total():
    """A footer that gives a different reason from every row above it reads as
    a second, unexplained failure — and `_shared.total_row` would have raised
    on the strings outright."""
    rows = CR.build_pnl_rows(PEOPLE, TODAY_SPREAD, ANCHOR)
    footer = rows[2]
    assert footer[CR.PERSON] == CR.ALL_PEOPLE
    assert footer["Turnover"] == C.NOT_ATTRIBUTABLE
    assert footer["Cost"] == C.NOT_RECORDED


def test_the_note_row_states_the_gap_inside_the_table():
    """Not a footnote and not a description nobody prints. A reader totting up
    the turnover column must be told, on the page, why it does not reach the
    firm's turnover."""
    rows = CR.build_pnl_rows(PEOPLE, TODAY_SPREAD, ANCHOR)
    notes = " ".join(str(r[CR.PERSON]) for r in rows[3:])
    assert "686" in notes and "NONE" in notes
    assert "1,342" in notes                       # the cost half
    assert "98 employee record" in notes          # the HR bridge
    assert "not a profit and loss" in notes.lower()
    assert "alphabetical" in notes.lower()


def test_a_person_with_no_sales_in_an_attributed_period_gets_a_real_zero():
    """The other side of the rule, and it matters as much. Once SOME documents
    name a salesperson, a person with none of them genuinely sold nothing in
    the period, and 0.00 is a true, checkable answer."""
    spread = {**TODAY_SPREAD, "docs_attributed": 400,
              "value_attributed": 90000000.0}
    rows = CR.build_pnl_rows(PEOPLE, spread, ANCHOR)
    assert cells(rows[:2], "Turnover") == [0.0, 0.0]
    # …and the note says the book is only partly attributed, so nobody reads
    # the column as the firm's turnover.
    notes = " ".join(str(r[CR.PERSON]) for r in rows[3:])
    assert "400 of 686" in notes and "NOBODY'S line" in notes


def test_a_person_with_no_costed_lines_is_not_given_a_zero_cost():
    """The per-person half of the cost rule, and the bug it was written after.

    Judging cost by an ORG-WIDE "did any line carry a cost" flag is not
    enough. Once one line anywhere carries one, a person NONE of whose lines
    do would fall through `None or 0.0` and print ₹0.00 cost — a claim of 100%
    gross margin against their name, produced by exactly the reflex this whole
    file exists to refuse. `lines_costed` is returned PER PERSON for this.
    """
    spread = {"docs": 100, "docs_attributed": 100, "value": 9000000.0,
              "value_attributed": 9000000.0, "lines": 200, "lines_costed": 40,
              "employees_unlinked": 0}
    costed = {"person": "Anita Desai", "turnover": 400000.0, "docs": 4,
              "cost": 250000.0, "lines_costed": 8, "has_employee": True,
              "basis": None, "effective_from": None}
    uncosted = {"person": "Bhavesh Rao", "turnover": 600000.0, "docs": 6,
                "cost": None, "lines_costed": 0, "has_employee": True,
                "basis": None, "effective_from": None}
    a, b = CR.build_pnl_rows([costed, uncosted], spread, ANCHOR)[:2]
    assert a["Cost"] == 250000.0 and a["Gross profit"] == 150000.0
    assert b["Turnover"] == 600000.0          # their sales ARE known
    assert b["Cost"] == C.NOT_RECORDED        # …their cost is not
    assert b["Gross profit"] == C.NOT_RECORDED
    assert b["Margin %"] == C.NOT_RECORDED
    # And the footer adds only the cost that exists, rather than treating the
    # missing one as zero and printing a total that looks complete.
    footer = CR.build_pnl_rows([costed, uncosted], spread, ANCHOR)[2]
    assert footer["Turnover"] == 1000000.0
    assert footer["Cost"] == 250000.0


def test_a_full_row_computes_end_to_end_once_the_data_exists():
    """What the page looks like the day both write paths ship: ₹50L billed,
    ₹30L cost, 40% margin, 10% of the excess over ₹5L = ₹1.5L."""
    spread = {"docs": 10, "docs_attributed": 10, "value": 5000000.0,
              "value_attributed": 5000000.0, "lines": 20, "lines_costed": 20,
              "employees_unlinked": 0}
    person = {"person": "Anita Desai", "turnover": 5000000.0, "docs": 10,
              "cost": 3000000.0, "lines_costed": 20, "has_employee": True,
              "eligible": True, "basis": "gross_profit",
              "rate_percent": Decimal("10"),
              "threshold_amount": Decimal("500000"),
              "threshold_mode": "excess", "period": "annual",
              "effective_from": date(2026, 4, 1), "effective_to": None}
    row = CR.build_pnl_rows([person], spread, ANCHOR)[0]
    assert row["Turnover"] == 5000000.0
    assert row["Gross profit"] == 2000000.0
    assert row["Margin %"] == 40.0
    assert row["Commission"] == 150000.0
    assert row["Commission basis"] == "Gross profit"
    assert row["Rate %"] == 10.0
    # The annual period has not finished on 21 August, so the figure is a
    # forecast and the page says so rather than implying it is payable.
    assert "forecast" in row["Status"]


def test_a_settled_period_is_marked_due_rather_than_forecast():
    spread = {"docs": 1, "docs_attributed": 1, "value": 100.0,
              "value_attributed": 100.0, "lines": 1, "lines_costed": 0,
              "employees_unlinked": 0}
    person = {"person": "Anita Desai", "turnover": 2000000.0, "docs": 1,
              "cost": None, "has_employee": True, "eligible": True,
              "basis": "turnover", "rate_percent": Decimal("5"),
              "threshold_amount": Decimal("1000000"),
              "threshold_mode": "excess", "period": "monthly",
              "effective_from": date(2026, 4, 1), "effective_to": None}
    # 31 August is the last day of the monthly settlement period.
    row = CR.build_pnl_rows([person], spread, date(2026, 8, 31))[0]
    assert row["Commission"] == 50000.0
    assert row["Status"] == "Due"


def test_an_unlinked_employee_is_named_as_such_not_shown_a_rate_of_zero():
    """A 0% rate against somebody's name reads as an arrangement paying
    nothing rather than as no arrangement at all."""
    rows = CR.build_pnl_rows(PEOPLE, TODAY_SPREAD, ANCHOR)
    assert cells(rows[:2], "Commission basis") == [CR.NO_LOGIN] * 2
    assert cells(rows[:2], "Rate %") == ["", ""]


def test_an_empty_org_prints_no_rows_rather_than_a_row_of_zeros():
    """`render_report_html` prints "No rows for this period" for an empty
    list, which is the honest page. A lone row of zeros reads as "these people
    sold nothing"."""
    assert CR.build_pnl_rows([], TODAY_SPREAD, ANCHOR) == []


def test_a_person_no_longer_on_record_prints_a_word_and_never_a_handle():
    orphan = [{**PEOPLE[0], "person": None}]
    row = CR.build_pnl_rows(orphan, TODAY_SPREAD, ANCHOR)[0]
    assert row[CR.PERSON] == CR.UNRECORDED_PERSON


# ══════════════════════════════════════════════════════════════════════════
# 6 · the org page
# ══════════════════════════════════════════════════════════════════════════

def measured(**over):
    m = {"docs": 0, "turnover": 0.0, "lines": 0, "lines_costed": 0, "cost": None}
    m.update(over)
    return m


def test_the_six_periods_are_anchored_on_the_window_end_and_not_on_today():
    """A report re-run for the same past period must give the same figures.
    Anchoring on the clock is how "month to date" silently becomes THIS month
    on a report about last April."""
    selected = (date(2026, 8, 1), ANCHOR)
    got = {label: CR.period_range(kind, ANCHOR, selected)
           for label, kind in CR.PERIOD_ROWS}
    assert got["Selected period"] == selected
    assert got["Week to date (from Monday)"] == (date(2026, 8, 17), ANCHOR)
    assert got["Month to date"] == (date(2026, 8, 1), ANCHOR)
    assert got["Quarter to date (financial)"] == (date(2026, 7, 1), ANCHOR)
    assert got["Year to date (financial)"] == (date(2026, 4, 1), ANCHOR)
    assert got["Last full financial year"] == (date(2025, 4, 1), date(2026, 3, 31))


def test_the_org_page_computes_turnover_today_but_not_cost_or_margin():
    """The asymmetry that IS the finding: the firm's OWN turnover needs no
    attribution and is computable right now; gross profit needs a cost on the
    line and is not."""
    rows = CR.build_figures_rows(
        [("Month to date", date(2026, 8, 1), ANCHOR,
          measured(docs=42, turnover=1550000.0, lines=90))], ANCHOR)
    r = rows[0]
    assert r["Turnover"] == 1550000.0
    assert r["Documents"] == 42
    assert r["Cost"] == C.NOT_RECORDED
    assert r["Gross profit"] == C.NOT_RECORDED
    assert r["Margin %"] == C.NOT_RECORDED


def test_a_period_with_no_documents_says_so_rather_than_printing_zero():
    rows = CR.build_figures_rows(
        [("Week to date", date(2026, 8, 17), ANCHOR, measured())], ANCHOR)
    assert rows[0]["Turnover"] == "no documents issued"


def test_the_org_page_prints_the_dates_of_every_period_it_measured():
    """A row headed "Quarter to date" with no range beside it is unverifiable
    — and the quarter here is a FINANCIAL quarter, which is not what half the
    readers of the phrase will assume."""
    rows = CR.build_figures_rows(
        [("Quarter to date (financial)", date(2026, 7, 1), ANCHOR, measured())],
        ANCHOR)
    assert rows[0]["From"] == date(2026, 7, 1)
    assert rows[0]["To"] == ANCHOR


def test_the_org_page_has_NO_footer_because_its_rows_overlap():
    """Month-to-date sits inside quarter-to-date sits inside the financial
    year. A Total under them would be a number with no meaning that somebody
    would nonetheless quote."""
    rows = CR.build_figures_rows(
        [(lbl, date(2026, 8, 1), ANCHOR, measured(docs=1, turnover=100.0))
         for lbl, _ in CR.PERIOD_ROWS], ANCHOR)
    labels = [str(r[CR.PERIOD]) for r in rows]
    assert not any(l.strip().lower().startswith("total") for l in labels)
    notes = " ".join(labels[len(CR.PERIOD_ROWS):])
    assert "OVERLAP" in notes
    assert ANCHOR.isoformat() in notes
    assert "FY 2026-27" in notes


def test_the_org_page_refuses_the_words_profit_and_loss_without_qualifying():
    """There is no double-entry in this product: no ledger, no journal, no
    chart of accounts, no overhead and no salary cost. A page that implies
    otherwise is a page a firm might file something on."""
    rows = CR.build_figures_rows(
        [("Selected period", date(2026, 8, 1), ANCHOR, measured())], ANCHOR)
    notes = " ".join(str(r[CR.PERIOD]) for r in rows)
    assert "CONTRIBUTION" in notes
    assert "not a profit and loss account" in notes
    assert "double-entry" in notes


# ══════════════════════════════════════════════════════════════════════════
# 7 · declaration and entitlement
# ══════════════════════════════════════════════════════════════════════════

def test_both_sections_are_declared_and_windowed():
    load_all()
    for key in (CR.PNL_KEY, CR.FIGURES_KEY):
        d = REPORT_DEFS[key]
        assert d.module == "core"
        assert d.grain == "flow"
        assert d.sensitivity == "financial"
        assert len(d.description) > 200, f"{key}: the description says too little"


def test_the_consultant_page_requires_finance_sales_AND_hr():
    """`core` is UNGATED (routers/analytics.UNGATED_MODULES), so the key alone
    gates nothing. The real gate is `reads`, and all of it is required: a
    caller holding only HR must not be offered the firm's turnover per head,
    and a caller holding only finance must not be offered anybody's commission
    rate. Declaring fewer modules is an entitlement bypass wearing a report's
    clothes."""
    load_all()
    assert REPORT_DEFS[CR.PNL_KEY].reads == \
        frozenset({"core", "ganit", "vikray", "manav"})


def test_the_org_page_does_not_require_hr_because_it_names_nobody():
    """It reads no employee row and prints no person, so requiring an HR grant
    would withhold the firm's own turnover for a reason that has nothing to do
    with the caller's entitlement."""
    load_all()
    assert "manav" not in REPORT_DEFS[CR.FIGURES_KEY].reads


def test_a_flow_section_handed_no_window_fails_loudly():
    """The two answers worse than raising are inventing a period (a report
    covering dates nobody asked for) and returning no rows (a report that says
    nothing happened). Neither is visible to the reader; this is."""
    for fn in (CR.consultant_pnl, CR.period_figures):
        with pytest.raises(ValueError, match="window"):
            run(fn(None, ORG, None))


# ══════════════════════════════════════════════════════════════════════════
# 8 · THE RATCHETS — scans over this commit's own source
#
# Each of these catches a mistake that produces a PLAUSIBLE PAGE rather than
# an error. A reader cannot catch any of them; a test has to.
# ══════════════════════════════════════════════════════════════════════════

def test_no_per_person_query_coalesces_a_sum_to_zero():
    """The one-line version of the whole task. `COALESCE(SUM(x), 0)` turns
    "nobody recorded this" into "this person sold nothing" — right-aligned,
    two decimal places, every appearance of being a measurement.

    Scoped to the PER-PERSON query, because that is where the sentence lands
    beside somebody's name. The denominator queries are covered next.
    """
    for name, sql in sql_constants(CR).items():
        if name in DENOMINATOR_QUERIES:
            continue
        assert "COALESCE(SUM(" not in sql.upper().replace(" ", ""), \
            f"{name}: COALESCE over a SUM turns an absence into a claim"


def test_a_denominator_may_coalesce_only_behind_a_count_that_gates_it():
    """The exception, stated so it cannot be widened by accident.

    The denominator queries total THE WHOLE BOOK, where zero genuinely means
    zero documents were issued. Both also return a `docs` count, and both
    builders use THAT count — never the sum — to decide whether a figure
    exists at all. So the coalesce cannot reach a cell as a zero standing in
    for an absence: with no documents the count is 0 and the builder returns
    the reason before the sum is looked at. The second half of this test
    proves that, rather than trusting the reading.
    """
    for name in DENOMINATOR_QUERIES:
        sql = " ".join(getattr(CR, name).split())
        if "COALESCE(SUM(" in sql.upper().replace(" ", ""):
            assert "AS docs" in sql, (
                f"{name} coalesces a sum but returns no document count, so "
                f"nothing downstream can tell a real zero from an absent one")
    empty = {"docs": 0, "turnover": 0.0, "lines": 0, "lines_costed": 0,
             "cost": None}
    row = CR.build_figures_rows(
        [("Selected period", date(2026, 8, 1), ANCHOR, empty)], ANCHOR)[0]
    assert isinstance(row["Turnover"], str) and row["Turnover"] != 0.0


def test_nothing_in_either_module_reads_the_clock():
    """A commission figure that changes because it was recomputed on a
    different day is a figure nobody can check — and a test that has to run
    before midnight fails one morning in CI for no reason."""
    for module in (C, CR):
        text = src(module)
        for banned in ("date.today(", "datetime.now(", "datetime.utcnow(",
                       "CURRENT_DATE", "NOW()"):
            # The word may appear inside a docstring saying it is banned.
            code = "\n".join(l for l in text.splitlines()
                             if not l.lstrip().startswith("#"))
            assert banned not in _strip_docstrings(code), \
                f"{module.__name__} reads the clock via {banned}"


def test_nothing_in_either_module_writes():
    """A report is a read. `services/commission.py` computes what a person is
    owed; if it could also record it, a preview would become a liability."""
    for module in (C, CR):
        body = _strip_docstrings(src(module)).upper()
        for verb in ("INSERT INTO", "UPDATE ", "DELETE FROM", "ALTER TABLE",
                     ".EXECUTE(", "CREATE TABLE"):
            assert verb not in body, f"{module.__name__} contains {verb!r}"


def test_no_result_is_ordered_by_a_figure():
    """This product already crowned a CHAMPION OF THE PERIOD on a lifetime
    total printed under a weekly heading, and removed it. A page that ranks
    colleagues by revenue is a different artefact from a page that reports
    their figures.

    EVERY ORDER BY is checked, not only the outer one — the LATERAL that
    resolves a scheme version orders by `effective_from DESC`, which is
    version resolution and not a ranking, and that is exactly the clause a
    looser test would have exempted by name and then forgotten about. So the
    rule is stated on the COLUMNS instead: no ordering anywhere may name a
    figure.
    """
    figures = ("TURNOVER", "COMMISSION", "MARGIN", "GROSS", "COST", "VALUE",
               "TOTAL", "SUBTOTAL", "DOCS", "RATE_PERCENT")
    for name, sql in sql_constants(CR).items():
        for m in re.finditer(r"ORDER BY (.+?)(?= LIMIT| \)|$)", sql, re.I):
            clause = m.group(1).upper()
            for word in figures:
                assert word not in clause, \
                    f"{name}: ORDER BY ranks on {word} — rows are alphabetical"
    # The consultant page's own ordering is the resolved NAME and nothing else.
    assert re.search(r"ORDER BY person LIMIT",
                     " ".join(CR.PNL_SQL.split()), re.I)


def test_no_row_this_module_builds_can_carry_a_uuid():
    """decision_names_not_ids. These rows are printed on a page the firm hands
    to somebody; `u.id` may appear in a GROUP BY and never in a column, and no
    builder may put an id in a cell."""
    uuid_re = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-", re.I)
    built = (CR.build_pnl_rows(PEOPLE, TODAY_SPREAD, ANCHOR)
             + CR.build_figures_rows(
                 [("Selected period", date(2026, 8, 1), ANCHOR,
                   measured(docs=3, turnover=10.0))], ANCHOR))
    for row in built:
        for k, v in row.items():
            assert not uuid_re.search(str(v)), f"{k} rendered an id: {v!r}"
        assert not any(k.lower().endswith("_id") for k in row), \
            f"a column is named for an id: {list(row)}"


#: Every `staging.<table> <alias>` a query names, however it is reached —
#: FROM, JOIN or a comma join. The alias is what the predicate has to mention.
_STAGING_REF_RE = re.compile(r"\b(staging\.\w+)\s+(\w+)\b", re.I)

#: `JOIN <schema>.<table> <alias> ON <predicate>`, predicate running to the
#: next clause keyword.
_JOIN_RE = re.compile(
    r"(?:LEFT |INNER )?JOIN\s+((?:staging|public)\.\w+)\s+(\w+)\s+ON\s+"
    r"(.+?)(?=\s+(?:LEFT |INNER )?JOIN\s|\s+WHERE\s|\s+GROUP\s|\s+ORDER\s"
    r"|\s*\)|$)", re.I)


def test_every_staging_table_a_query_touches_is_scoped_to_the_caller_org():
    """The substantive tenancy check, and it does not care HOW the table was
    reached.

    Most of the tables here are reached inside a CTE and joined by CTE name
    afterwards, so a scan that only looked at JOIN clauses would inspect one
    join in the whole commit and pass forever. Every `staging.x alias`
    reference is found instead, and each one must carry
    `alias.org_id = $1::uuid` somewhere in the same query — which is the
    predicate that stops another org's row surfacing (graha_clients_join_leak;
    no composite (id, org_id) key exists for a foreign key to refuse it).
    """
    seen = 0
    for name, sql in sql_constants(CR).items():
        assert "$1::uuid" in sql, f"{name} is not org-scoped"
        for table, alias in set(_STAGING_REF_RE.findall(sql)):
            seen += 1
            assert f"{alias}.org_id = $1::uuid" in sql, \
                f"{name}: {table} (as {alias}) is not scoped to the caller org"
    # A regex that stops matching turns this test green and useless. Five
    # distinct (table, alias) pairs across the three queries today.
    assert seen >= 5, f"the tenancy scan matched only {seen} refs — it rotted"


def test_the_one_schema_qualified_join_is_the_users_table_that_has_no_org():
    """`public.users` carries NO org_id column at all, so it is the single
    reference the scan above cannot apply to. It is safe for a reason worth
    writing down rather than assuming: every key reaching it came out of a row
    already scoped to $1, so the join can only NAME somebody this org's own
    data already points at — it cannot widen the scope. Any OTHER
    schema-qualified join must carry an org predicate, and this test is what
    notices when a second one appears.
    """
    for name, sql in sql_constants(CR).items():
        for table, alias, on in _JOIN_RE.findall(sql):
            if table.lower() == "public.users":
                continue
            assert f"{alias}.org_id" in on, \
                f"{name}: join to {table} carries no org predicate: {on!r}"


def test_the_lateral_scheme_lookup_is_org_scoped_too():
    """The LATERAL is a correlated subquery, not a JOIN, so the scan above
    cannot see it — and it reads the table holding everybody's commission
    rate. Checked on its own rather than left to a regex that would have to
    understand LATERAL in order to catch it."""
    sql = " ".join(CR.PNL_SQL.split())
    lateral = sql[sql.index("LEFT JOIN LATERAL"):]
    assert "sc.org_id = $1::uuid" in lateral
    assert "sc.employee_id = e.employee_id" in lateral


def test_every_ambiguous_parameter_is_cast():
    """PgBouncer turns an untyped parse error into an instant 500 — the
    credits incident, where every spend died sub-second on `$1 + $2`."""
    for name, sql in sql_constants(CR).items():
        for param in set(re.findall(r"\$\d+", sql)):
            uses = re.findall(re.escape(param) + r"(::\w+)?", sql)
            assert all(u for u in uses), f"{name}: {param} is used uncast"


def test_every_table_is_schema_qualified():
    """A shadow table has bitten this repo: `search_path` is not a guarantee,
    and migration 142 exists because two schemas held twins of the same table.

    Every name after FROM or JOIN must be schema-qualified, a CTE DEFINED IN
    THE SAME QUERY, or a set-returning function. The CTE names are PARSED OUT
    OF THE QUERY rather than listed here, so a CTE renamed tomorrow does not
    quietly become a standing exemption for an unqualified table.
    """
    for name, sql in sql_constants(CR).items():
        ctes = {c.lower() for c in
                re.findall(r"(?:WITH|,)\s+(\w+)\s+AS\s*\(", sql, re.I)}
        if " AS (" in sql:
            assert ctes, f"{name}: the CTE parse found nothing — it has rotted"
        for tbl in re.findall(r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)", sql, re.I):
            low = tbl.lower()
            if "." in low or low in ctes or low == "lateral":
                continue
            if low.startswith("jsonb_") or low.startswith("unnest"):
                continue
            raise AssertionError(
                f"{name}: {tbl!r} is neither schema-qualified nor a CTE of "
                f"this query (CTEs found: {sorted(ctes)})")


def _strip_docstrings(source: str) -> str:
    """Source with every docstring removed — so a rule STATED in prose does
    not trip the scan that enforces it."""
    tree = ast.parse(source)
    spans = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                             ast.AsyncFunctionDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc is not None and node.body:
                first = node.body[0]
                spans.append((first.lineno, first.end_lineno))
    lines = source.splitlines()
    for start, end in spans:
        for i in range(start - 1, min(end, len(lines))):
            lines[i] = ""
    return "\n".join(lines)
