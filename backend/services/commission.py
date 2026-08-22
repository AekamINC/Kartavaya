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

THE SEVEN ABSENCES, WHICH ARE DIFFERENT THINGS
──────────────────────────────────────────────
  NOT_ATTRIBUTABLE   no document in the period records who sold it, so no
                     figure can be assigned to any person. Migration 184 adds
                     the column; until the write paths fill it, this is the
                     answer for every consultant.
  NOT_RECORDED       the documents exist and are attributed, but carry no
                     cost, so gross profit and margin cannot be derived. A
                     missing cost is NOT a zero cost: zero cost is a claim of
                     100% gross margin, the most flattering possible lie.
  NO_SCHEME          nobody has recorded whether this person is on commission.
                     Different from being recorded as not on commission.
  NOT_ON_COMMISSION  a scheme exists and says no. A recorded fact, not a gap.
  NO_TERMS           a scheme exists, says yes, and states no bands. Migration
                     190's trigger makes this unstorable; the word exists so
                     that a row written around it pays nothing loudly.
  DEPARTMENT_NOT_SET a scheme measured on the person's DEPARTMENT, against an
                     employee who has none. 11 of 98 live employees. Paying a
                     team leader ₹0 because nobody filled in a column is the
                     failure this whole module exists to refuse.
  NO_BONUS_AWARDED   nobody has awarded this person a bonus. Not a ₹0 bonus,
                     which would say they were considered and given nothing.

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

#: What a scheme may be computed on. Mirrors the CHECK in migration 185; the
#: two are asserted equal by tests/test_commission.py so a value added to one
#: and not the other fails in CI rather than at a payslip.
BASES = ("turnover", "gross_profit")

#: A scheme with no bands is not a scheme. One spelling.
NO_TERMS = "terms not recorded"

#: A DEPARTMENT-scoped scheme against an employee with no department. The
#: scheme is real, the ladder is real, and the revenue it is measured on cannot
#: be identified — which is emphatically NOT ₹0 and not "sold nothing". Live
#: today: 11 of 98 employees have no department, and paying a team leader
#: nothing because nobody filled in a column is the failure this product keeps
#: almost making.
DEPARTMENT_NOT_SET = "department not set"

#: Nobody has awarded this person a bonus. NOT a zero — see `bonus_total`.
NO_BONUS_AWARDED = "no bonus awarded"

#: Every absence this module can return, for a caller that wants to test
#: "is this cell a number or a word" without hardcoding the strings. Defined
#: after all of them, so adding an absence and forgetting this set is a
#: NameError at import rather than a word that quietly fails an `in REASONS`
#: check somewhere downstream.
REASONS = frozenset({NOT_ATTRIBUTABLE, NOT_RECORDED, NO_SCHEME,
                     NOT_ON_COMMISSION, NO_TERMS, DEPARTMENT_NOT_SET,
                     NO_BONUS_AWARDED})

#: How often the scheme settles. Mirrors migration 185's CHECK.
#:
#: A PERSON MAY BE ON MORE THAN ONE AT ONCE. The owner's own example is a
#: monthly scheme and an annual scheme running side by side — 3% for clearing
#: ₹5L this month, plus 2% for clearing ₹20L over the year — and both pay.
#: Migration 190 makes the period part of a scheme's IDENTITY for exactly that
#: reason: at most one OPEN scheme per employee PER PERIOD, not per employee.
PERIODS = ("monthly", "quarterly", "annual")

#: WHOSE REVENUE a scheme measures. Mirrors migration 190's CHECK, asserted
#: equal by tests.
#:
#: The owner: "if person is leading a team he gets his own of what he do but he
#: gets yearly commission on total GP of his team, if it meets threshold" …
#: "but yes teams is department."
#:
#:   'own'         the person's own attributed revenue.
#:   'department'  their DEPARTMENT'S — everybody in it, added together.
#:
#: TEAM IS DEPARTMENT, and that is written down once here rather than made
#: configurable. `manav_employees.reporting_to` exists and is filled on 0 of 98
#: rows; nothing in this codebase reads it. `department` is filled on 87 of 98,
#: so ELEVEN PEOPLE have no department, and a department-scoped scheme for one
#: of them answers DEPARTMENT_NOT_SET rather than a number.
#:
#: There is no default. Whose revenue is measured decides the cheque exactly as
#: the rate does.
REVENUE_SCOPES = ("own", "department")

#: THE READING OF A LADDER, DECIDED — there is no setting for this.
#:
#: The owner, 2026-08-21: "3% above 1L, 4% above 5L, 7.5% above 10L : example
#: 3% from 1L to 5L, if company had agrees higher commission then company can
#: add more threshold 3.75% 5L to 7.5L and so on."
#:
#: So a band is a RANGE that pays its own rate on its own portion, income-tax
#: shaped. On ₹12,00,000 against 3% from ₹1L, 4% from ₹5L, 7.5% from ₹10L:
#:
#:     first ₹1,00,000                earns nothing
#:     ₹1L → ₹5L   at 3%                  = ₹12,000
#:     ₹5L → ₹10L  at 4%                  = ₹20,000
#:     above ₹10L  at 7.5%                = ₹15,000
#:                                          ───────
#:                                          ₹47,000
#:
#: The other reading — you land in a band and that single rate applies to
#: everything — would pay ₹90,000 on the same figures, nearly double. It is a
#: real arrangement elsewhere and it is NOT what this firm means, so it is not
#: built. Migration 185's `threshold_mode` ('excess' | 'whole') was the
#: two-value version of exactly this question; it is SUPERSEDED, still present
#: in the database, and read by nothing. A chooser here would be a question the
#: owner has already answered, put back on the screen.
SLAB_READING = (
    "Each band applies only to the part of the amount inside it — the slice "
    "from that band's own threshold up to the next band's, and the highest "
    "band applies to everything above it. The amount below the lowest band "
    "earns nothing.")

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

@dataclass(frozen=True, order=True)
class Band:
    """One rung of a ladder: an amount, and the rate that applies FROM it.

    There is no upper bound and there must never be one. A band runs to the
    next band's `from_amount`, or to infinity if it is the highest — so the
    edge between two neighbours is written ONCE and two bands cannot disagree
    about where one ends and the next begins. `staging.manav_commission_bands`
    is modelled the same way and for the same reason.

    `order=True` with `from_amount` first: sorting a ladder is the single most
    load-bearing operation in this file, and it sorts by the floor.
    """

    from_amount: Decimal
    rate_percent: Decimal

    def __post_init__(self):
        object.__setattr__(self, "from_amount", to_decimal(self.from_amount))
        object.__setattr__(self, "rate_percent", to_decimal(self.rate_percent))
        if self.from_amount < 0:
            raise ValueError(
                f"a band starts at {self.from_amount}, which is below zero. A "
                f"negative floor is not an arrangement.")
        if self.rate_percent <= 0:
            raise ValueError(
                f"a band's rate is {self.rate_percent}. A band's rate must be "
                f"stated and above zero — 'the first lakh earns nothing' is "
                f"said by the lowest band starting AT one lakh, not by a 0% "
                f"band, so a zero here is always an unfinished form. Mirrors "
                f"manav_commission_bands_rate_ck.")
        if self.rate_percent > 100:
            raise ValueError(
                f"a band's rate is {self.rate_percent}%, which pays more than "
                f"was sold. The odds that 500 means 5.00 are overwhelming and "
                f"the cost of being wrong is a wrong cheque.")


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

    THE TERMS ARE A LADDER AND NOTHING ELSE. Migration 185's `rate_percent`,
    `threshold_amount` and `threshold_mode` are SUPERSEDED — still in the
    database, read by nothing, and deliberately absent from this object so
    that no code path can pick one of two answers about what somebody is paid.

    AN ELIGIBLE SCHEME WITH NO BANDS CANNOT BE BUILT. Migration 189 made
    "on commission, terms unrecorded" unstorable and migration 190 keeps it
    unstorable across the child table; this constructor refuses it too, so a
    caller assembling a scheme by hand gets the same refusal as one writing to
    the database rather than an object that computes ₹0 in a test and 500s at
    the INSERT.
    """

    eligible: bool
    #: 'turnover' | 'gross_profit'. None means the firm has not said, which is
    #: only permissible on an INELIGIBLE scheme — exactly the rule
    #: `revenue_scope` below already follows. NO DEFAULT: turnover and gross
    #: profit are different numbers for the same sales, so this product does
    #: not pick one. `compute()` returns NOT_ON_COMMISSION before it reads
    #: this, so None can never reach the arithmetic.
    basis: Optional[str]
    #: 'monthly' | 'quarterly' | 'annual'. Same rule, and the more expensive
    #: of the two to guess: monthly and annual are the same agreed rate paid
    #: twelve times or once.
    period: Optional[str]
    effective_from: date
    #: One of REVENUE_SCOPES. None means the firm has not said whose revenue
    #: this measures, which is only permissible on an INELIGIBLE scheme. No
    #: default: 'own' and 'department' are different amounts of money.
    revenue_scope: Optional[str] = None
    #: The ladder, lowest first. Normalised and duplicate-checked below.
    bands: tuple = ()
    effective_to: Optional[date] = None   # EXCLUSIVE; None = still in force

    def __post_init__(self):
        if self.basis is not None and self.basis not in BASES:
            raise ValueError(f"basis must be one of {BASES}, got {self.basis!r}")
        if self.period is not None and self.period not in PERIODS:
            raise ValueError(f"period must be one of {PERIODS}, got {self.period!r}")
        # Required the moment somebody IS on commission, and not before. A
        # recorded "this person gets no commission" has no basis and no
        # settlement period to state, and demanding them would be asking a
        # firm to answer a question that does not apply to them.
        if self.eligible:
            if self.basis is None:
                raise ValueError(
                    "Say what the commission is measured on — turnover, or "
                    "gross profit. They are different numbers for the same "
                    "sales, and there is no default.")
            if self.period is None:
                raise ValueError(
                    "Say how often the commission settles — monthly, "
                    "quarterly or annual. The same agreed rate settles twelve "
                    "times a year or once, and there is no default.")
        if self.revenue_scope is not None and self.revenue_scope not in REVENUE_SCOPES:
            raise ValueError(
                f"revenue_scope must be one of {REVENUE_SCOPES}, got "
                f"{self.revenue_scope!r}. 'department' is what a TEAM means "
                f"here — manav_employees.department and nothing else.")

        # ── the ladder, sorted and de-duplicated HERE, once ──────────────────
        #
        # Two bands at one `from_amount` make the payout depend on which was
        # read first, under either reading. The database refuses it
        # (manav_commission_bands_one_per_threshold_uniq) and so does this, so
        # a caller building bands by hand cannot produce a figure the database
        # would never have stored.
        bands = tuple(sorted(
            b if isinstance(b, Band) else Band(*b) for b in (self.bands or ())))
        floors = [b.from_amount for b in bands]
        if len(set(floors)) != len(floors):
            dupes = sorted({f for f in floors if floors.count(f) > 1})
            raise ValueError(
                f"two bands start at the same amount ({', '.join(str(d) for d in dupes)}). "
                f"Which one pays would depend on row order, which is the "
                f"classic slab bug and the reason "
                f"manav_commission_bands_one_per_threshold_uniq exists.")
        object.__setattr__(self, "bands", bands)

        if self.eligible:
            if self.revenue_scope is None:
                raise ValueError(
                    "an ELIGIBLE scheme must say WHOSE REVENUE it measures — "
                    f"one of {REVENUE_SCOPES}. There is no default, because "
                    "the person's own sales and their whole department's are "
                    "different amounts of money and picking one for a firm is "
                    "the same fault as picking their rate.")
            if not bands:
                raise ValueError(
                    "an ELIGIBLE scheme states no terms — it has no bands. "
                    "That state reads as configured on every screen, computes "
                    "zero every period, and quietly owes somebody money. State "
                    "the ladder — at least one band — or set eligible=False. "
                    "Mirrors manav_commission_terms_stated().")

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

    def effective_bands(self) -> tuple:
        """The ladder, lowest band first.

        Kept as a method rather than read off `.bands` directly so that every
        caller goes through one accessor: a single flat rate is expressed as a
        one-band ladder and there is no second shape for terms anywhere.

        Returns () when no terms are recorded — only reachable on an
        ineligible scheme, which never gets as far as being computed.
        """
        return self.bands

    @property
    def entry_threshold(self) -> Optional[Decimal]:
        """The amount below which NOTHING is due — the lowest band's floor."""
        bands = self.effective_bands()
        return bands[0].from_amount if bands else None

    @property
    def measures_department(self) -> bool:
        """Is this scheme measured on the whole department rather than on the
        person? The caller must supply the matching figures; nothing in this
        module can fetch them, and nothing here may guess which was meant."""
        return self.revenue_scope == "department"


def _as_date(v):
    """A date, from a date or from an ISO string.

    A scheme that arrives through jsonb — one round trip instead of two —
    carries its dates as text, and `date.fromisoformat` is the only conversion
    permitted: no parsing of '01/04/2026', which is 1 April in this country and
    4 January in another, and no guessing.
    """
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def band_from_row(row) -> Band:
    """A `staging.manav_commission_bands` row -> `Band`."""
    return Band(from_amount=to_decimal(row["from_amount"]),
                rate_percent=to_decimal(row["rate_percent"]))


def bands_from_rows(rows) -> tuple:
    """Many band rows -> a sorted ladder. Order in, order out: `Scheme` sorts
    them again and refuses duplicates, so a query that forgets its ORDER BY
    cannot change what anybody is paid."""
    return tuple(sorted(band_from_row(r) for r in (rows or ())))


def from_row(row, bands=None) -> Scheme:
    """A `staging.manav_commission_schemes` row (+ its bands) -> `Scheme`.

    Kept here rather than in the report so that the column names appear in
    exactly one place: a rename in a migration breaks one function, loudly,
    instead of producing a scheme with an invented rate somewhere downstream.

    `bands` may be passed explicitly or carried on the row under the key
    'bands' — a `jsonb_agg` from one round trip, or a second fetch. Either way
    it is a list of mappings with `from_amount` and `rate_percent`.
    """
    if bands is None:
        try:
            bands = row["bands"]
        except (KeyError, TypeError, IndexError):
            bands = None
    scope = row["revenue_scope"]
    # `rate_percent`, `threshold_amount` and `threshold_mode` are NOT read.
    # Migration 190 supersedes all three and its trigger refuses a row that
    # states a rate beside a ladder, so there is nothing to fall back to and
    # nothing to reconcile.
    return Scheme(
        eligible=bool(row["eligible"]),
        basis=str(row["basis"]),
        period=str(row["period"]),
        effective_from=_as_date(row["effective_from"]),
        revenue_scope=None if scope is None else str(scope),
        bands=bands_from_rows(bands),
        effective_to=_as_date(row["effective_to"]),
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


def schemes_in_force(schemes: Iterable[Scheme], on: date) -> tuple:
    """EVERY arrangement in force on `on` — at most one per settlement period.

    THIS IS THE FUNCTION THAT LETS MONTHLY AND ANNUAL COEXIST, and it is
    separate from `scheme_in_force` rather than replacing it because the two
    answer different questions. "Which arrangement is this person on?" has no
    single answer any more: the owner's own example is a person on a monthly
    scheme AND an annual scheme, earning 3% for clearing ₹5L this month and 2%
    for clearing ₹20L over the year, and BOTH pay. A function that returned one
    of them would silently drop the other — which is precisely the failure
    migration 190's per-period index exists to make impossible in storage, and
    it would be pointless to make it impossible in the database and then
    reintroduce it here.

    One per period, resolved the same deterministic way `scheme_in_force`
    resolves a single one (latest `effective_from` wins), so a residual overlap
    inside one period picks the same row on every run rather than whichever
    arrived first. Returned in PERIODS order — monthly, quarterly, annual — so
    two runs of the same report list them the same way.
    """
    out = []
    for period in PERIODS:
        chosen = scheme_in_force([s for s in schemes if s.period == period], on)
        if chosen is not None:
            out.append(chosen)
    return tuple(out)


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


def settles_on(period: str, month_end: date) -> bool:
    """Does a scheme on `period` FINISH its settlement period on `month_end`?

    THIS IS THE RULE THAT LETS A MONTHLY AND AN ANNUAL SCHEME BOTH REACH
    PAYROLL WITHOUT EITHER PAYING TWICE. Payroll runs monthly. A scheme is paid
    in the payroll month whose last day is the last day of the scheme's own
    settlement period:

        monthly    every month, on that month's figures.
        quarterly  June, September, December, March — on the quarter's figures.
        annual     March only — on the whole financial year's figures.

    So in March a person on both is paid their March commission AND their
    annual one, computed over different windows, which is exactly the owner's
    example. In April they are paid only the monthly one. Nothing is counted
    twice, because each scheme is computed over its OWN period and each period
    ends once.

    `month_end` must be the last day of a payroll month; a mid-month date
    answers False for everything, which is the honest answer — no settlement
    period ends in the middle of a month.
    """
    return period_bounds(period, month_end)[1] == month_end


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
    #: The figure the ladder was applied to, before any threshold.
    basis_amount: Optional[Decimal]
    #: The part of `basis_amount` that earned anything at all.
    commissionable: Optional[Decimal]
    threshold_met: Optional[bool]
    #: One of REASONS, or "" when `amount` is a number.
    reason: str = ""
    #: The rate of the highest band the basis reached. Under
    #: 'top_band_on_the_whole_amount' this is THE rate that was applied; under
    #: 'each_band_on_its_own_slice' it is only the last one, and the figure was
    #: built from several. Carried so a payslip line can say which rung was
    #: reached without the reader re-deriving it — never as the whole story.
    top_rate_percent: Optional[Decimal] = None

    @property
    def computable(self) -> bool:
        return self.amount is not None


def commission_due(scheme: Optional[Scheme], f: Figures) -> Commission:
    """The commission a scheme's ladder produces from a period's figures.

    EACH BAND PAYS ON ITS OWN PORTION. THAT IS DECIDED, NOT CONFIGURED.
    ──────────────────────────────────────────────────────────────────
    The owner, 2026-08-21: "3% from 1L to 5L, if company had agrees higher
    commission then company can add more threshold 3.75% 5L to 7.5L and so on."

    So on ₹12,00,000 against 3% from ₹1L, 4% from ₹5L, 7.5% from ₹10L:

        first ₹1,00,000                      earns nothing
        ₹1L → ₹5L   = ₹4,00,000 at 3%            ₹12,000
        ₹5L → ₹10L  = ₹5,00,000 at 4%            ₹20,000
        above ₹10L  = ₹2,00,000 at 7.5%          ₹15,000
                                                 ───────
                                                 ₹47,000

    The other reading of the same English — you land in the 7.5% band and 7.5%
    applies to everything — pays ₹90,000, nearly double. It is a real
    arrangement elsewhere and it is not what this firm means, so there is no
    branch for it here and no column to select it. Migration 185's
    `threshold_mode` was the two-value version of this question; it is
    superseded and read by nothing.

    A band has no upper bound: it runs to the NEXT band's floor, or to the
    basis itself if it is the highest. The ladder is walked with its own
    successor rather than with a stored ceiling, so the slices cannot overlap
    or leave a gap.

    The threshold test is `>=`: "3% from ₹1 lakh" includes ₹1 lakh. At the
    entry band that makes no difference to the money (the slice is zero either
    way), and at every boundary above it, it decides which rate the next rupee
    earns. It is written once, here.

    ROUNDING HAPPENS ONCE, AT THE END. Each band's contribution is accumulated
    as an exact Decimal and only the total is quantized to paisa. Rounding band
    by band and adding the results would move the answer by up to half a paisa
    per band — small, wrong, and impossible for a person checking their payslip
    against the rates to reproduce.

    WHOSE REVENUE `f` MEASURES IS THE CALLER'S RESPONSIBILITY. A scheme scoped
    to 'department' must be handed the department's figures, and one scoped to
    'own' the person's. This function cannot fetch either and does not guess:
    handing it the wrong figures is not an error it can detect, which is why
    both callers resolve the scope explicitly and why a department that cannot
    be resolved arrives as `Figures(None, …, DEPARTMENT_NOT_SET)`.

    NEGATIVE PERIODS FLOOR AT ZERO. A period whose credit notes exceed its
    invoices produces a negative basis, which reaches no band's floor, so
    nothing is due and the answer is ₹0.00 — never a negative number. Clawing
    back an earlier overpayment is an employment decision, not arithmetic; see
    the module docstring.
    """
    if scheme is None:
        return Commission(None, None, None, None, NO_SCHEME)
    if not scheme.eligible:
        return Commission(None, None, None, None, NOT_ON_COMMISSION)

    bands = scheme.effective_bands()
    if not bands:
        # Unreachable through the constructor, which refuses an eligible
        # scheme with no terms. Answered anyway rather than dividing by an
        # assumption, because the alternative to an IndexError here is a
        # blank cheque.
        return Commission(None, None, None, None, NO_TERMS)

    if scheme.basis == "turnover":
        basis_amount, reason = f.turnover, (f.turnover_reason or NOT_ATTRIBUTABLE)
    else:
        basis_amount, reason = f.gross_profit, f.gross_profit_reason

    if basis_amount is None:
        return Commission(None, None, None, None, reason or NOT_RECORDED)

    entry = bands[0].from_amount
    if basis_amount < entry:
        # Answered, and the answer is nothing. A real zero the person can
        # check: they billed less than the ladder's lowest rung.
        return Commission(money(0), basis_amount, money(0), False, "")

    # The highest rung actually reached. `>=` at every edge, the same test as
    # the entry threshold.
    reached = [b for b in bands if basis_amount >= b.from_amount]
    top = reached[-1]

    exact = Decimal(0)
    for i, band in enumerate(reached):
        ceiling = (reached[i + 1].from_amount if i + 1 < len(reached)
                   else basis_amount)
        if ceiling > basis_amount:
            ceiling = basis_amount
        slice_amount = ceiling - band.from_amount
        if slice_amount <= 0:
            continue
        exact += slice_amount * band.rate_percent / Decimal(100)
    commissionable = basis_amount - entry

    if commissionable < 0:
        commissionable = Decimal(0)
    return Commission(
        amount=money(exact),            # quantized ONCE, here
        basis_amount=basis_amount,
        commissionable=money(commissionable),
        threshold_met=True,
        top_rate_percent=top.rate_percent,
    )


def commission_total(schemes: Iterable[Scheme], f: Figures) -> Optional[Decimal]:
    """What a set of schemes pays over ONE period's figures, added up.

    Every scheme handed in must settle over the period `f` was measured for —
    this function has no way to check that and will not pretend to. A monthly
    scheme and an annual scheme applied to the same figures would pay twice on
    one month's turnover; the caller decides which schemes settle now
    (`settles_on`) and hands in only those.

    Returns None when NOTHING was computable, which is different from ₹0: zero
    means every scheme was answered and none of them reached its ladder, and
    None means the question could not be answered at all. Schemes that could
    not be computed are skipped rather than counted as zero, so a person on two
    schemes of which one is computable is paid the one that is.
    """
    amounts = [c.amount for c in (commission_due(s, f) for s in schemes)
               if c.amount is not None]
    if not amounts:
        return None
    return money(sum(amounts, Decimal(0)))


# ══════════════════════════════════════════════════════════════════════════
# 5 · the bonus — decided by a person, derived from nothing
# ══════════════════════════════════════════════════════════════════════════
#
# A bonus is NOT a small commission and nothing in this module may compute one.
# No turnover, no threshold, no rate, no band, no period figure goes anywhere
# near it: somebody with the authority decided an amount and said why, and the
# only arithmetic this section performs is addition.

@dataclass(frozen=True)
class BonusAward:
    """One award, as `staging.manav_bonus_awards` records it."""

    amount: Decimal
    reason: str
    pay_period: str = ""          # 'YYYY-MM' — the payroll month it is paid in

    def __post_init__(self):
        object.__setattr__(self, "amount", to_decimal(self.amount))
        if self.amount <= 0:
            raise ValueError(
                f"a bonus of {self.amount} is not a bonus, it is an unfinished "
                f"form. Mirrors manav_bonus_awards_amount_ck.")
        if not str(self.reason or "").strip():
            raise ValueError(
                "a bonus must say why. A discretionary payment with no stated "
                "reason cannot be audited, defended, or explained to the person "
                "who did not get one. Mirrors manav_bonus_awards_reason_ck.")


def award_from_row(row) -> BonusAward:
    """A `staging.manav_bonus_awards` row -> `BonusAward`."""
    return BonusAward(amount=to_decimal(row["amount"]),
                      reason=str(row["reason"]),
                      pay_period=str(row["pay_period"]))


def bonus_total(awards: Iterable[BonusAward]) -> Optional[Decimal]:
    """What was awarded, or None if nothing was.

    NONE IS NOT ZERO AND THE DIFFERENCE IS THE WHOLE POINT. ₹0.00 under a bonus
    heading beside a person's name is a sentence about that person — they were
    considered and given nothing — and it is false whenever the truth is that
    nobody has awarded anything yet. Same rule as `Figures.turnover`, one level
    along.
    """
    total = Decimal(0)
    found = False
    for a in awards or ():
        total += to_decimal(getattr(a, "amount", a))
        found = True
    return money(total) if found else None


# ══════════════════════════════════════════════════════════════════════════
# 6 · what reaches a payslip
# ══════════════════════════════════════════════════════════════════════════
#
# `staging.vetana_payslips.other_earnings` is a jsonb ARRAY of {label, amount}
# and it already exists — no payslip column is added for any of this. These
# helpers build the entries and nothing else; the router writes them.
#
# A LINE IS ONLY EVER WRITTEN FOR MONEY THAT IS ACTUALLY PAID. A commission
# that could not be computed produces NO line, not a ₹0.00 one: a zero on a
# payslip is a statement that the person earned nothing, and today the truth
# for every person in this database is that no invoice records who sold it. A
# missing line says nothing, which is the only honest thing a payslip can say
# about a figure nobody has recorded.

def earning_line(label: str, amount: Optional[Decimal]) -> Optional[dict]:
    """One `other_earnings` entry, or None when there is nothing to pay.

    `float` because the column is jsonb and every reader of it — the payslip
    renderer, the export, `payroll_statutory`'s annexure — handles float and
    none of them handles Decimal. The rounding has already happened, so the
    conversion cannot move the figure.
    """
    if amount is None:
        return None
    amount = money(amount)
    if amount <= 0:
        return None
    return {"label": label, "amount": float(amount)}


def commission_line_label(scheme: Scheme, period_start: date,
                          period_end: date) -> str:
    """What the commission line CALLS itself on the payslip.

    It names the settlement period and its dates, because a person on a
    monthly and an annual scheme sees two commission lines on their March
    payslip and must be able to tell which is which without asking. A label of
    "Commission" twice is a payslip that looks like a duplicate.
    """
    return (f"Commission ({scheme.period}, "
            f"{period_start.isoformat()} to {period_end.isoformat()})")


def bonus_line_label(award: BonusAward) -> str:
    """What the bonus line calls itself. The firm's own words for why, because
    the reason is the only thing distinguishing two awards in one month."""
    reason = " ".join(str(award.reason).split())
    if len(reason) > 80:
        reason = reason[:77].rstrip() + "…"
    return f"Bonus — {reason}"


# ══════════════════════════════════════════════════════════════════════════
# 7 · rendering — a number or a word, never a zero standing in for a word
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


def describe_bands(scheme: Scheme) -> str:
    """The ladder, as RANGES, in words a person can check against their figures.

    "3% on ₹1,00,000–₹5,00,000; 4% on ₹5,00,000–₹10,00,000; 7.5% above
    ₹10,00,000" — which is how the owner described it and how it pays. Printing
    only the floors ("3% from ₹1L") is the phrasing that produced the
    ambiguity in the first place: it reads as though the 3% might apply to
    everything once ₹1L is passed.

    Amounts in full rather than abbreviated to "1L": a commission figure is
    checked against a bank statement, not skimmed.
    """
    bands = scheme.effective_bands()
    if not bands:
        return NO_TERMS
    parts = []
    for i, b in enumerate(bands):
        rate = f"{_trim(b.rate_percent)}%"
        if i + 1 < len(bands):
            parts.append(f"{rate} on ₹{b.from_amount:,.2f}–"
                         f"₹{bands[i + 1].from_amount:,.2f}")
        elif b.from_amount == 0:
            parts.append(f"{rate} on everything")
        else:
            parts.append(f"{rate} above ₹{b.from_amount:,.2f}")
    return "; ".join(parts)


def describe_scope(scheme: Scheme) -> str:
    """WHOSE revenue this scheme measures, said in full on every page it
    appears on. A ladder shown without saying whose sales it is applied to has
    told the reader nothing they can check: the same 3% on a person's own
    invoices and on their whole department's are wildly different cheques."""
    if scheme.revenue_scope == "department":
        return "their department's revenue, everybody in it"
    if scheme.revenue_scope == "own":
        return "their own attributed revenue"
    return "the firm has not said whose revenue this measures"


def _trim(d: Decimal) -> str:
    """7.500 -> '7.5', 3.000 -> '3'. A rate stored to three decimals should not
    print two zeros a person then has to interpret."""
    s = format(to_decimal(d).normalize(), "f")
    return s


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
    "NO_TERMS", "NO_BONUS_AWARDED",
    "DEPARTMENT_NOT_SET",
    "REASONS", "BASES", "PERIODS", "REVENUE_SCOPES", "SLAB_READING",
    "Band", "Scheme", "Figures", "Commission", "BonusAward",
    "to_decimal", "money", "from_row", "band_from_row", "bands_from_rows",
    "scheme_in_force", "schemes_in_force",
    "financial_year_of", "financial_year_label",
    "week_to_date", "month_to_date", "quarter_to_date", "year_to_date",
    "last_financial_year", "period_bounds", "period_is_complete", "settles_on",
    "figures", "commission_due", "commission_total", "cell",
    "award_from_row", "bonus_total",
    "earning_line", "commission_line_label", "bonus_line_label",
    "describe_bands", "describe_scope",
    "attribution_note", "cost_note", "gross_profit_is_contribution",
]
