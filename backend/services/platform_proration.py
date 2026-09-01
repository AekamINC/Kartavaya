"""platform_proration.py — what an org owes when a change lands mid-period.

── THE REQUIREMENT ──────────────────────────────────────────────────────────

The owner's words: "Rest org > can be defined by aekam what will billing period
and charge and also it needs flexibility to change in midterm or around monthly.
also pro-rata way as well."

`org_billing_lines` already carries the amount, the cadence and the period, and
`services/billing_lines.py` already ends a line by setting `period_end` rather
than deleting it — so the history of what an org was charged is intact. What
there was no way to express is a period somebody joined, left, or changed price
in the MIDDLE of. Every such month billed as a whole one.

── DECIMAL, NOT FLOAT, AND THAT IS NOT A STYLE PREFERENCE ───────────────────

`0.1 + 0.2 != 0.3` in binary floating point, and this module divides money by
day counts. A float pro-rata produces amounts like 5806.451612903226 that then
round inconsistently depending on which order they were summed in. Every value
here is `Decimal`, quantised once, at the end.

── THE PROPERTY THAT MATTERS MOST ───────────────────────────────────────────

⚠ THE PARTS OF A SPLIT PERIOD MUST SUM TO THE WHOLE PERIOD, EXACTLY.

A price change on the 15th produces two part-charges. Rounding each of them
independently loses or gains a paisa about half the time, and the org's invoice
then disagrees with the ledger by an amount too small for anybody to notice and
too persistent to ever reconcile. `split_period` therefore computes the FIRST
part and derives the second by subtraction, so the two always add up to the
figure a whole period would have cost. This is the one behaviour here that is
worth more than the arithmetic.

── DAY COUNT IS ACTUAL DAYS, INCLUSIVE ──────────────────────────────────────

February is 28 days and July is 31, and a customer who joins on the 15th of each
pays 14/28 and 17/31 respectively — not 15/30 of a notional month. Actual days
is what an Indian SaaS contract normally means by pro-rata, and it is the only
basis under which twelve monthly part-periods sum to a year without a fudge.

Both ends are INCLUSIVE: a period of 1–31 July is 31 days, and a customer
present on the 31st is charged for the 31st.
"""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

#: Money is quantised to paise, once, at the boundary of this module.
PAISE = Decimal("0.01")

_ONE_DAY = timedelta(days=1)

#: The cadences `org_billing_lines.cadence` may hold, and how long one is.
#: `one_off` is deliberately absent — a one-off charge has no period to
#: apportion, and asking this module to pro-rate one is a caller bug rather
#: than a value to guess at.
CADENCE_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}


def money(value) -> Decimal:
    """A Decimal rounded to paise, half-up.

    ROUND_HALF_UP and not banker's rounding: an invoice a customer checks by
    hand should round the way they were taught at school. ROUND_HALF_EVEN would
    turn ₹0.125 into ₹0.12 and ₹0.135 into ₹0.14, which is correct on average
    and indefensible line by line.
    """
    return Decimal(str(value)).quantize(PAISE, rounding=ROUND_HALF_UP)


def add_months(day: date, months: int) -> date:
    """`day` advanced by whole months, clamped to the end of the target month.

    31 January + 1 month is 28 February, not 3 March. A billing anchor on the
    31st must not walk forward through the year, which is what naive day
    arithmetic does to every short month.
    """
    total = day.month - 1 + months
    year = day.year + total // 12
    month = total % 12 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def period_bounds(start: date, cadence: str) -> tuple[date, date]:
    """The inclusive `(start, end)` of one whole period beginning at `start`."""
    months = CADENCE_MONTHS.get(cadence)
    if not months:
        raise ValueError(f"{cadence!r} has no period to apportion")
    # One day before the same anchor next cycle, so periods tile without
    # overlapping and without leaving a day unbilled between them.
    return start, add_months(start, months) - _ONE_DAY


def days_in(start: date, end: date) -> int:
    """Inclusive day count. Zero when the range is empty (end before start)."""
    return max(0, (end - start).days + 1)


def prorate(
    amount,
    period_start: date,
    period_end: date,
    active_from: Optional[date] = None,
    active_to: Optional[date] = None,
) -> Decimal:
    """The share of `amount` earned for the part of the period actually served.

    `active_from` / `active_to` clamp INTO the period; a value outside it means
    the org was present for the whole of that end, not that it was present
    before the period began. Passing neither returns the full amount, which is
    the ordinary case and must not be a special path.

    Returns 0 when the overlap is empty — an org that left before the period
    started owes nothing, and that is a real answer rather than an error.
    """
    full = Decimal(str(amount))
    total_days = days_in(period_start, period_end)
    if total_days == 0:
        return money(0)

    served_from = max(period_start, active_from) if active_from else period_start
    served_to = min(period_end, active_to) if active_to else period_end
    served = days_in(served_from, served_to)

    if served >= total_days:
        # The whole period. Returned as the stated amount rather than as
        # amount * days/days, so a full month is never off by a rounding step.
        return money(full)
    if served == 0:
        return money(0)
    return money(full * Decimal(served) / Decimal(total_days))


@dataclass(frozen=True)
class Split:
    """One period cut in two by a change landing inside it."""
    before_amount: Decimal
    after_amount: Decimal
    before_days: int
    after_days: int
    change_on: date

    @property
    def total(self) -> Decimal:
        return self.before_amount + self.after_amount


def split_period(
    old_amount,
    new_amount,
    period_start: date,
    period_end: date,
    change_on: date,
) -> Split:
    """A price change on `change_on`, apportioned across one period.

    `change_on` is the first day billed at the NEW amount. A change on the 1st
    is therefore not a split at all — it is simply the new price for the whole
    period, and this returns exactly that rather than a zero-day part.

    ⚠ THE SECOND PART IS DERIVED BY SUBTRACTION FROM THE WHOLE. See the module
    docstring: rounding both halves independently makes them fail to sum to what
    a whole period costs, by a paisa, about half the time. Here `before` is
    rounded and `after` is whatever is left of the total, so the two always
    reconcile against the ledger.
    """
    if change_on <= period_start:
        return Split(money(0), money(new_amount), 0,
                     days_in(period_start, period_end), change_on)
    if change_on > period_end:
        return Split(money(old_amount), money(0),
                     days_in(period_start, period_end), 0, change_on)

    before_days = days_in(period_start, change_on - _ONE_DAY)
    after_days = days_in(change_on, period_end)
    total_days = days_in(period_start, period_end)

    # ⚠ EXACT FIRST, QUANTISE ONCE. An earlier version of this rounded each
    # half with `prorate()` and then added them, which is the very thing the
    # docstring above says not to do — the total was the sum of two rounded
    # figures rather than the rounded figure of the true total, and it drifted
    # by a paisa on real dates in October and December.
    #
    # The order here is the whole fix: the TOTAL is quantised from the exact
    # apportionment, `before` is quantised on its own, and `after` is whatever
    # is left. So `before + after == total == money(exact)` by construction, for
    # every day of every month, and the invoice can never disagree with the
    # ledger.
    before_exact = Decimal(str(old_amount)) * before_days / total_days
    after_exact = Decimal(str(new_amount)) * after_days / total_days

    total = money(before_exact + after_exact)
    before = money(before_exact)
    after = total - before

    return Split(before, after, before_days, after_days, change_on)
