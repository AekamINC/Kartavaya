"""commission.py — turnover, gross profit, margin and commission, computed.

Pure arithmetic over values a caller has already fetched. NOTHING in this
module opens a connection, reads a table, calls a model or writes anywhere.
Every function that concerns a period takes that period as explicit arguments;
not one of them reads the clock. `date.today()` appears nowhere in this file,
on purpose — a commission figure that changes because it was recomputed on a
different day is a figure nobody can check, and a test that has to be run
before midnight is a test that will fail in CI one morning for no reason.

WHY A SEPARATE MODULE, AND NOT SQL
──────────────────────────────────
The SQL half of this (services/report_defs/commission_reports.py) can sum a
period's documents. It cannot decide what an ABSENT number means, and that
decision is the entire product here. A SUM over zero attributed invoices
returns 0, and 0 rendered in a turnover column is a sentence: "this person
sold nothing". Today that sentence is false for every person in the database,
because no document has ever recorded who sold it. The truth is "nobody wrote
it down". Those two facts must not share a rendering, so every computation
below returns either a number or a REASON, never a zero standing in for an
absence.

THE FOUR ABSENCES, WHICH ARE DIFFERENT THINGS
─────────────────────────────────────────────
  NOT_ATTRIBUTABLE  no document in the period records who sold it, so no
                    figure can be assigned to any person. Migration 184 adds
                    the column; until the write paths fill it, this is the
                    answer for every consultant.
  NOT_RECORDED      the documents exist and are attributed, but carry no cost,
                    so gross profit and margin cannot be derived. A missing
                    cost is NOT a zero cost: zero cost is a claim of 100%
                    gross margin, which is the most flattering possible lie.
  NO_SCHEME         nobody has recorded whether this person is on commission.
                    Different from being recorded as not on commission.
  NOT_ON_COMMISSION a scheme exists and says no. A recorded fact, not a gap.

WHAT THIS FILE IS NOT
─────────────────────
It is not a ledger and it computes no profit and loss. Ganit has no
double-entry, no journal and no chart of accounts, so there is no overhead
here, no salary cost, no apportionment and no net profit. `gross_profit`
below is a CONTRIBUTION figure — revenue less the direct cost of what was
sold — and every caller must say so on the page. A column headed "profit"
against a consultant's name, in a product with no ledger behind it, will be
read as their profit to the firm, and it is not that.

It also computes no clawback. A period whose credit notes exceed its invoices
produces a negative turnover, and `commission_due` floors the commission at
zero rather than returning a negative payment. Recovering an overpayment from
a person is a payroll decision with notice periods and employment law behind
it; it is not arithmetic, and this module will not imply otherwise by
returning a negative number that something downstream might pay.

MONEY IS Decimal HERE
─────────────────────
The registers in services/report_defs/_shared.py round floats at the cell,
which is right for a document that is read and totted up. This module computes
an amount that is PAID TO A PERSON, and a rate applied to a crore-scale
turnover in binary floating point drifts in the paisa the payslip is checked
against. Decimal with ROUND_HALF_UP, quantized once at the end of the
calculation and not at every step. Callers converting to float for a report
cell do so after the rounding, so the printed figure and the computed figure
are the same number.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional

# ══════════════════════════════════════════════════════════════════════════
# the reasons — one spelling each, because a caller compares them
# ══════════════════════════════════════════════════════════════════════════

#: No document in the period records a salesperson. Migration 184's column
#: exists but nothing has written it.
NOT_ATTRIBUTABLE = "not attributable"

#: The documents are there; the cost is not. Never render this as zero.
NOT_RECORDED = "not recorded"

#: Nobody has said whether this person is on commission.
NO_SCHEME = "no scheme recorded"

#: A scheme exists and says this person is not on commission.
NOT_ON_COMMISSION = "not on commission"

#: Every absence this module can return, for a caller that wants to test
#: "is this cell a number or a word" without hardcoding four strings.
REASONS = frozenset({NOT_ATTRIBUTABLE, NOT_RECORDED, NO_SCHEME,
                     NOT_ON_COMMISSION})

#: What a scheme may be computed on. Mirrors the CHECK in migration 185; the
#: two are asserted equal by tests/test_commission.py so a value added to one
#: and not the other fails in CI rather than at a payslip.
BASES = ("turnover", "gross_profit")

#: How often the scheme settles. Mirrors migration 185's CHECK.
PERIODS = ("monthly", "quarterly", "annual")

#: Whether the rate applies to the amount ABOVE the threshold or to the whole
#: amount once the threshold is crossed. See `commission_due` — this is the
#: difference between two very different cheques and it must never be implied.
THRESHOLD_MODES = ("excess", "whole")

#: Two decimal places, the way money is paid.
_PAISA = Decimal("0.01")

#: Margin is a percentage and prints to two places. A separate quantum from
#: money so that changing one never silently changes the other.
_PCT = Decimal("0.01")


def to_decimal(v) -> Decimal:
    """Anything numeric -> Decimal, without going through binary float.

    `str(v)` and not `Decimal(v)`: asyncpg hands back Decimal already for a
    numeric column, but a float that reached here from a jsonb line item would
    otherwise be converted with its full binary error attached, and
    Decimal(0.1) is 0.1000000000000000055511151231257827021181583404541015625.
    """
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v if v is not None else 0))


def money(v: Decimal) -> Decimal:
    """Quantize to paisa, half up — the rounding a person expects."""
    return to_decimal(v).quantize(_PAISA, rounding=ROUND_HALF_UP)


# ══════════════════════════════════════════════════════════════════════════
# 1 · the scheme, and resolving it AT A DATE
# ══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Scheme:
    """One version of one person's commission arrangement.

    The window is HALF-OPEN — `[effective_from, effective_to)` — exactly as
    `staging.statute_calendar` models a dated statutory fact, and for the same
    reason. `effective_to` is the first day the scheme is NOT in force, never
    the last day it is. That is what makes a rate change expressible without
    an off-by-one argument: the old row ends on 2026-04-01 and the new row
    begins on 2026-04-01, one date written once, and 31 March answers the old
    rate while 1 April answers the new one. Written the other way, one day of
    a person's pay gets either two answers or none.
    """

    eligible: bool
    basis: str                       # 'turnover' | 'gross_profit'
    rate_percent: Decimal
    threshold_amount: Decimal
    threshold_mode: str              # 'excess' | 'whole'
    period: str                      # 'monthly' | 'quarterly' | 'annual'
    effective_from: date
    effective_to: Optional[date] = None   # EXCLUSIVE; None = still in force

    def __post_init__(self):
        if self.basis not in BASES:
            raise ValueError(f"basis must be one of {BASES}, got {self.basis!r}")
        if self.period not in PERIODS:
            raise ValueError(f"period must be one of {PERIODS}, got {self.period!r}")
        if self.threshold_mode not in THRESHOLD_MODES:
            raise ValueError(
                f"threshold_mode must be one of {THRESHOLD_MODES}, "
                f"got {self.threshold_mode!r}")
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError(
                f"effective_to ({self.effective_to}) is EXCLUSIVE and must be "
                f"after effective_from ({self.effective_from}); a scheme that "
                f"ends on the day it starts was in force for no days at all.")

    def covers(self, on: date) -> bool:
        """Is this version in force on `on`? Half-open, both ends stated."""
        if on < self.effective_from:
            return False
        return self.effective_to is None or on < self.effective_to


def from_row(row) -> Scheme:
    """A `staging.manav_commission_schemes` row -> `Scheme`.

    Kept here rather than in the report so that the column names appear in
    exactly one place: a rename in migration 185 breaks one function, loudly,
    instead of producing a scheme with a default rate somewhere downstream.
    """
    return Scheme(
        eligible=bool(row["eligible"]),
        basis=str(row["basis"]),
        rate_percent=to_decimal(row["rate_percent"]),
        threshold_amount=to_decimal(row["threshold_amount"]),
        threshold_mode=str(row["threshold_mode"]),
        period=str(row["period"]),
        effective_from=row["effective_from"],
        effective_to=row["effective_to"],
    )


def scheme_in_force(schemes: Iterable[Scheme], on: date) -> Optional[Scheme]:
    """The one version in force on `on`, or None.

    `on` is REQUIRED and there is no default. "What is this person's
    commission rate" is not a question that can be answered without "as of
    when", the same rule `services/statute.py` enforces for a form number —
    and for a stronger reason here, because last quarter's commission must
    still compute on last quarter's rate after the rate has changed.

    When more than one version claims the date — which migration 185's
    constraints make hard but not impossible across a re-seed — the LATEST
    `effective_from` wins, and the tie is resolved deterministically rather
    than by whatever order the rows arrived in. A commission figure that
    depends on row order is a commission figure that changes between two runs
    of the same report.
    """
    live = [s for s in schemes if s.covers(on)]
    if not live:
        return None
    return max(live, key=lambda s: (s.effective_from,
                                    s.effective_to or date.max))


# ══════════════════════════════════════════════════════════════════════════
# 2 · the periods — a UK consultancy's five, on the Indian financial year
# ══════════════════════════════════════════════════════════════════════════
#
# Every function takes the anchor date explicitly. "This month" is meaningless
# without saying which day you are standing on, and a reporting function that
# reads the clock cannot be asked about last month at all.

#: The Indian financial year starts here. 1 April, and every quarter below is
#: an FY quarter (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) — NOT a calendar
#: quarter. This is the quarter the TDS statements are filed on and the one a
#: firm here means by "Q1"; using calendar quarters would put the first
#: quarter of the year in the middle of the previous one.
FY_START_MONTH = 4


def financial_year_of(anchor: date) -> int:
    """The starting calendar year of the FY containing `anchor`.

    2026-03-31 -> 2025 (FY 2025-26). 2026-04-01 -> 2026 (FY 2026-27).
    """
    return anchor.year if anchor.month >= FY_START_MONTH else anchor.year - 1


def financial_year_label(anchor: date) -> str:
    """'2026-27' — the way a firm here writes it."""
    y = financial_year_of(anchor)
    return f"{y}-{(y + 1) % 100:02d}"


def week_to_date(anchor: date) -> tuple[date, date]:
    """Monday of `anchor`'s week, through `anchor`.

    ISO weeks, Monday-start. Not Sunday-start: `date.isoweekday()` and every
    other date computation in this codebase are ISO, and a week that starts on
    a different day from the one the rest of the system counts in produces two
    different "this week" figures on the same screen.
    """
    return anchor - timedelta(days=anchor.weekday()), anchor


def month_to_date(anchor: date) -> tuple[date, date]:
    return anchor.replace(day=1), anchor


def quarter_to_date(anchor: date) -> tuple[date, date]:
    """The FY quarter containing `anchor`, from its first day through
    `anchor`.

    Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. The Q4 case is the one
    that catches people: January, February and March belong to the financial
    year that STARTED IN THE PREVIOUS CALENDAR YEAR, but the quarter itself
    starts on 1 January of the anchor's own calendar year.
    """
    # 0-based index of the month within the financial year: April -> 0.
    idx = (anchor.month - FY_START_MONTH) % 12
    # Month within the calendar year that the quarter starts in. idx 0-2 -> 4,
    # 3-5 -> 7, 6-8 -> 10, 9-11 -> 13 which is January of the anchor's own
    # year — which is why the modulo, not a year adjustment, is the right fix:
    # a Jan-Mar anchor is already in the calendar year its quarter starts in.
    start_month = FY_START_MONTH + (idx // 3) * 3
    if start_month > 12:
        start_month -= 12
    return date(anchor.year, start_month, 1), anchor


def year_to_date(anchor: date) -> tuple[date, date]:
    """The financial year to date — 1 April through `anchor`.

    This is what "YTD" means to a firm here. A calendar YTD would restate
    every consultant's year on 1 January, three months out of step with the
    accounts, the TDS statements and every target the firm sets.
    """
    return date(financial_year_of(anchor), FY_START_MONTH, 1), anchor


def last_financial_year(anchor: date) -> tuple[date, date]:
    """The last COMPLETE financial year before the one `anchor` sits in.

    1 April to 31 March, both inclusive — `services/statute.py:fy_bounds`
    uses the same inclusive convention for the same object, and this returns
    the same pair of dates for the same year. (Inclusive here, exclusive on a
    scheme's `effective_to`: the two conventions sit side by side on purpose
    and are both stated, because silently mixing them is how a 1 April figure
    gets attributed to the previous year.)
    """
    y = financial_year_of(anchor) - 1
    return date(y, FY_START_MONTH, 1), date(y + 1, 3, 31)


def period_bounds(period: str, anchor: date) -> tuple[date, date]:
    """The COMPLETE settlement period containing `anchor`, for a scheme.

    Distinct from the `*_to_date` helpers above, and the distinction is the
    point. A scheme settles over a whole month, quarter or year — the
    threshold is tested against the whole of it — so a mid-period figure is a
    forecast, not a commission. This returns the whole period; the caller that
    reports mid-period must say that it is not yet due.
    """
    if period == "monthly":
        start = anchor.replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        return start, end
    if period == "quarterly":
        start, _ = quarter_to_date(anchor)
        # Three months on, minus a day. Built by walking to the first of the
        # month three times rather than by adding 92 days, which is wrong four
        # times a year.
        end = start
        for _ in range(3):
            end = (end + timedelta(days=32)).replace(day=1)
        return start, end - timedelta(days=1)
    if period == "annual":
        y = financial_year_of(anchor)
        return date(y, FY_START_MONTH, 1), date(y + 1, 3, 31)
    raise ValueError(f"period must be one of {PERIODS}, got {period!r}")


def period_is_complete(period: str, anchor: date, as_at: date) -> bool:
    """Has the settlement period containing `anchor` finished by `as_at`?

    Both dates explicit. A commission computed over a period that has not
    ended is a forecast, and the caller is expected to label it as one; this
    function exists so that the label is a computed fact rather than a
    judgement made somewhere in a template.
    """
    return period_bounds(period, anchor)[1] <= as_at


# ══════════════════════════════════════════════════════════════════════════
# 3 · the figures
# ══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Figures:
    """What a person (or an org) did over one period.

    Every money field is Decimal-or-None, and None is NEVER interchangeable
    with Decimal(0):

      turnover     None  = no document in the period records who sold it.
                   0.00  = documents ARE attributed in this period, and none
                           of them to this person. A real, checkable zero.
      cost         None  = no line in the attributed documents records a cost.
      gross_profit None  = follows from either of the above being None.
    """

    turnover: Optional[Decimal]
    cost: Optional[Decimal]
    #: Why a None above is None — one of the REASONS, or "" when nothing is
    #: missing. Carried on the value rather than recomputed by each renderer,
    #: so the page and the export cannot disagree about what happened.
    turnover_reason: str = ""
    cost_reason: str = ""

    @property
    def gross_profit(self) -> Optional[Decimal]:
        """Turnover less the direct cost of what was sold. A CONTRIBUTION
        figure — there is no ledger behind this product, so it is not profit
        in any accounting sense and no caller may label it as one."""
        if self.turnover is None or self.cost is None:
            return None
        return money(self.turnover - self.cost)

    @property
    def gross_profit_reason(self) -> str:
        """The first missing input, which is what a reader needs to know."""
        if self.turnover is None:
            return self.turnover_reason or NOT_ATTRIBUTABLE
        if self.cost is None:
            return self.cost_reason or NOT_RECORDED
        return ""

    @property
    def margin_pct(self) -> Optional[Decimal]:
        """Gross profit as a percentage of turnover.

        Zero turnover returns None, not zero and not an exception: a margin on
        nothing is undefined, and 0% would read as "sold at cost". A NEGATIVE
        turnover — a period whose credit notes exceed its invoices — also
        returns None, because a margin percentage computed on a negative
        denominator has the wrong sign and is worse than no answer.
        """
        gp = self.gross_profit
        if gp is None or self.turnover is None or self.turnover <= 0:
            return None
        return (gp / self.turnover * Decimal(100)).quantize(
            _PCT, rounding=ROUND_HALF_UP)

    @property
    def margin_reason(self) -> str:
        if self.gross_profit is None:
            return self.gross_profit_reason
        if self.turnover is not None and self.turnover <= 0:
            return "no turnover to measure against"
        return ""


def figures(turnover, cost, *, turnover_reason: str = "",
            cost_reason: str = "") -> Figures:
    """Build `Figures`, converting numerics without touching binary float.

    A None stays None. Anything else becomes a quantized Decimal — including
    a zero, which is a real answer and must survive.
    """
    return Figures(
        turnover=None if turnover is None else money(turnover),
        cost=None if cost is None else money(cost),
        turnover_reason=turnover_reason,
        cost_reason=cost_reason,
    )


# ══════════════════════════════════════════════════════════════════════════
# 4 · the commission
# ══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Commission:
    """What is due, or why it cannot be said.

    `amount is None` and `amount == 0` are different answers and a renderer
    must not collapse them. None means the question could not be answered;
    zero means it was answered and the answer is nothing — the threshold was
    not reached, which is a fact the person can check.
    """

    amount: Optional[Decimal]
    #: The figure the rate was applied to before the threshold was subtracted.
    basis_amount: Optional[Decimal]
    #: The part of `basis_amount` the rate actually applied to.
    commissionable: Optional[Decimal]
    threshold_met: Optional[bool]
    #: One of REASONS, or "" when `amount` is a number.
    reason: str = ""

    @property
    def computable(self) -> bool:
        return self.amount is not None


def commission_due(scheme: Optional[Scheme], f: Figures) -> Commission:
    """The commission a scheme produces from a period's figures.

    THE THRESHOLD, AND THE TWO CHEQUES IT COULD MEAN
    ────────────────────────────────────────────────
    "On commission above ₹10 lakh at 5%" is ambiguous in English and the two
    readings differ by ₹50,000 on the first rupee over the line:

      'excess'  the rate applies to the amount ABOVE the threshold. ₹12L at 5%
                over a ₹10L threshold pays 5% of ₹2L = ₹10,000.
      'whole'   crossing the threshold qualifies the WHOLE amount. The same
                figures pay 5% of ₹12L = ₹60,000.

    Neither is more correct; both are real arrangements. So the scheme carries
    `threshold_mode` and this function refuses to assume — because assuming
    'excess' and being wrong underpays a person quietly, every period, and
    assuming 'whole' and being wrong overpays the firm's money.

    The threshold test is `>=`: "commission from ₹10 lakh" includes ₹10 lakh.
    Under 'excess' this makes no difference (the excess is zero either way);
    under 'whole' it is the difference between the whole cheque and none of
    it, which is why the comparison is written once, here, and stated.

    NEGATIVE PERIODS FLOOR AT ZERO. A period whose credit notes exceed its
    invoices produces a negative basis; `commissionable` floors at zero and
    the commission is ₹0.00, never a negative number. Clawing back an earlier
    overpayment is an employment decision, not arithmetic — see the module
    docstring.
    """
    if scheme is None:
        return Commission(None, None, None, None, NO_SCHEME)
    if not scheme.eligible:
        return Commission(None, None, None, None, NOT_ON_COMMISSION)

    if scheme.basis == "turnover":
        basis_amount, reason = f.turnover, (f.turnover_reason or NOT_ATTRIBUTABLE)
    else:
        basis_amount, reason = f.gross_profit, f.gross_profit_reason

    if basis_amount is None:
        return Commission(None, None, None, None, reason or NOT_RECORDED)

    met = basis_amount >= scheme.threshold_amount
    if not met:
        # Answered, and the answer is nothing. A real zero.
        return Commission(money(0), basis_amount, money(0), False, "")

    base = (basis_amount - scheme.threshold_amount
            if scheme.threshold_mode == "excess" else basis_amount)
    if base < 0:
        base = Decimal(0)
    return Commission(
        amount=money(base * scheme.rate_percent / Decimal(100)),
        basis_amount=basis_amount,
        commissionable=money(base),
        threshold_met=True,
    )


# ══════════════════════════════════════════════════════════════════════════
# 5 · rendering — a number or a word, never a zero standing in for a word
# ══════════════════════════════════════════════════════════════════════════

def cell(value: Optional[Decimal], reason: str, *, blank: str = NOT_RECORDED):
    """The value for a report cell: a float when there is one, else the WORD.

    This is the single most important function in the file and it is four
    lines long. `render_report_html` / the csv writer / the xlsx writer all
    detect numerics per cell, so a string in a money column renders
    left-aligned and reads as prose — which is exactly right, because it IS
    prose. What must never happen is the alternative: `COALESCE(sum, 0)` in
    the SQL, a tidy right-aligned ₹0.00, and a page that claims a person sold
    nothing when the truth is that nobody recorded who sold anything.

    Returns float, not Decimal, because the export writers and the JSON
    encoder both handle float and neither handles Decimal — and the rounding
    has already happened, so the conversion cannot move the figure.
    """
    if value is None:
        return reason or blank
    return float(value)


def attribution_note(total_documents: int, attributed_documents: int,
                     total_value, attributed_value) -> str:
    """The sentence that goes IN the table, next to the numbers it explains.

    Not a footnote, not a line in a description nobody prints. A reader who
    adds up a per-person turnover column and compares it against the firm's
    own turnover needs to be told, on the page, how much of the book had no
    salesperson on it — otherwise they conclude the report is broken, or worse,
    that the difference is somebody's unrecorded sales.
    """
    total_documents = int(total_documents or 0)
    attributed_documents = int(attributed_documents or 0)
    tv, av = money(total_value or 0), money(attributed_value or 0)
    if total_documents == 0:
        return ("No documents were issued in this period, so there is nothing "
                "to attribute. Rows are alphabetical; this page does not rank "
                "anyone.")
    if attributed_documents == 0:
        return (f"NONE of the {total_documents:,} documents issued in this "
                f"period (₹{tv:,.2f}) records who sold it, so no turnover can "
                f"be attributed to any person and every figure below reads "
                f"'{NOT_ATTRIBUTABLE}'. That is not a fault in this report: "
                f"the salesperson has never been captured. It starts being "
                f"captured when the order and invoice screens write "
                f"salesperson_id. Rows are alphabetical; this page does not "
                f"rank anyone.")
    pct = (Decimal(attributed_documents) / Decimal(total_documents)
           * Decimal(100)).quantize(_PCT, rounding=ROUND_HALF_UP)
    unattributed = total_documents - attributed_documents
    return (f"{attributed_documents:,} of {total_documents:,} documents "
            f"({pct}%) record who sold them, covering ₹{av:,.2f} of "
            f"₹{tv:,.2f} issued. The remaining {unattributed:,} "
            f"(₹{money(tv - av):,.2f}) are on NOBODY'S line, so the column "
            f"below does not add up to the firm's turnover and must not be "
            f"read as if it did. Rows are alphabetical; this page does not "
            f"rank anyone.")


def cost_note(lines_total: int, lines_with_cost: int) -> str:
    """The same admission, for the cost half — and it is a separate sentence
    because the two absences have different fixes. Attribution is a column on
    the document; cost is a key on the line. A firm can fix one and still not
    have the other, and being told only about the one that was fixed is how a
    margin column gets believed."""
    lines_total = int(lines_total or 0)
    lines_with_cost = int(lines_with_cost or 0)
    if lines_total == 0:
        return ""
    if lines_with_cost == 0:
        return (f"NONE of the {lines_total:,} lines in this period records a "
                f"cost, so gross profit and margin cannot be computed for "
                f"anybody and read '{NOT_RECORDED}'. A missing cost is not a "
                f"zero cost — a zero would claim a 100% gross margin. Cost is "
                f"captured per line as `cost_price` when the line is written; "
                f"nothing writes it yet.")
    pct = (Decimal(lines_with_cost) / Decimal(lines_total)
           * Decimal(100)).quantize(_PCT, rounding=ROUND_HALF_UP)
    return (f"{lines_with_cost:,} of {lines_total:,} lines ({pct}%) record a "
            f"cost. Gross profit and margin below are computed over THOSE "
            f"lines only and understate the cost of every line without one, "
            f"so the margin shown is a CEILING, not the margin.")


def gross_profit_is_contribution() -> str:
    """The qualification the org-level report owes, in one place.

    There is no double-entry in this product: no journal, no chart of
    accounts, no overhead, no salary cost, no apportionment. Whatever this
    report shows, it is not a profit and loss account, and any page that
    implies otherwise is a page a firm might file something on.
    """
    return ("Gross profit here is a CONTRIBUTION figure — what was billed "
            "less the direct cost of what was billed. It is not a profit and "
            "loss account: this product keeps no double-entry ledger, no "
            "journal and no chart of accounts, so no overhead, salary, "
            "premises or tax cost is deducted anywhere in this table, and "
            "nothing below is a statutory figure or the basis for one.")


__all__ = [
    "NOT_ATTRIBUTABLE", "NOT_RECORDED", "NO_SCHEME", "NOT_ON_COMMISSION",
    "REASONS", "BASES", "PERIODS", "THRESHOLD_MODES",
    "Scheme", "Figures", "Commission",
    "to_decimal", "money", "from_row", "scheme_in_force",
    "financial_year_of", "financial_year_label",
    "week_to_date", "month_to_date", "quarter_to_date", "year_to_date",
    "last_financial_year", "period_bounds", "period_is_complete",
    "figures", "commission_due", "cell",
    "attribution_note", "cost_note", "gross_profit_is_contribution",
]
