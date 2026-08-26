"""
services/proration.py — Proration math for billing.

Proposal 86, phase P2.  Pure functions that calculate proportional charges
when a service starts or ends mid-cycle.  Used by:
  - admin_set_plan (plan upgrade/downgrade mid-cycle)
  - module activation (co-termination)
  - client billing (P5, already built — can call these directly)

All functions are deterministic and take dates, never query the database.

── ONE DAY-COUNT CONVENTION, AND IT IS PAYROLL'S ────────────────────────────

Owner decision 0.17, 2026-08-26: **calendar minus Sundays, everywhere.**

This module counted plain calendar days — 31 for August 2026 — while
`routers/vetana.py` prorates a part-month over every calendar day that is not
a Sunday (26 for the same month) and `routers/client_billing.py` counted
Monday-to-Friday (21). Three engines, three answers, one month: a plan change
credited a client for a fraction the payroll beside it could not reproduce.

Payroll keeps its convention because it has money flowing through it and a
six-day week is what Indian firms actually work. Saturday is a working day.
`_working_days` below is that rule, and it is the ONLY day counter in this
file — `prorate` and `should_waive` both go through it, so the fraction and
the waiver can never come to disagree about how long a month is.
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

_CENT = Decimal("0.01")

PRORATION_WAIVE_THRESHOLD = 3

#: `date.weekday()` for Sunday. The one day of the week that is not billed.
_SUNDAY = 6


def _working_days(start: date, end: date) -> int:
    """Days in [start, end) that are not Sundays. Never negative.

    A loop rather than arithmetic on whole weeks: the periods here are a month
    or a quarter, so it is a few dozen iterations, and the closed form for
    "weekdays between two dates excluding one weekday" is the kind of clever
    that gets an off-by-one in a leap February and is never noticed because
    nobody re-derives it by hand.
    """
    if end <= start:
        return 0
    days = 0
    d = start
    while d < end:
        if d.weekday() != _SUNDAY:
            days += 1
        d += timedelta(days=1)
    return days


def days_in_period(start: date, end: date) -> int:
    """Billable days in a period (end exclusive) — calendar minus Sundays.

    August 2026 is 26, not 31: the same figure `vetana.py` puts on a payslip
    as `working_days`, so a mid-cycle credit and the payroll for that month
    divide by the same denominator. See the module docstring, decision 0.17.
    """
    return _working_days(start, end)


def prorate(
    amount: float | Decimal,
    period_start: date,
    period_end: date,
    event_date: date,
    *,
    direction: str = "remaining",
) -> Decimal:
    """Calculate a prorated charge.

    direction="remaining": charge for event_date..period_end (upgrade charge)
    direction="elapsed":   charge for period_start..event_date (credit for old plan)

    Returns a Decimal quantised to 2dp.  Returns 0 if the event is outside
    the period or the period has zero length.
    """
    total_days = days_in_period(period_start, period_end)
    if total_days <= 0:
        return Decimal("0.00")

    # BOTH SIDES COUNT THE SAME WAY. The numerator was calendar days while the
    # denominator is now billable ones; mixing them would price 13 working days
    # of a 26-day August as 16/26 and overcharge by a fifth.
    if direction == "elapsed":
        active_days = _working_days(period_start, event_date)
    else:
        active_days = _working_days(event_date, period_end)

    active_days = max(0, min(active_days, total_days))

    amt = Decimal(str(amount)) * Decimal(str(active_days)) / Decimal(str(total_days))
    return amt.quantize(_CENT, rounding=ROUND_HALF_UP)


def should_waive(
    period_end: date,
    event_date: date,
    threshold: int = PRORATION_WAIVE_THRESHOLD,
) -> bool:
    """If the billable days left <= threshold, waive the micro-charge.

    Counted the same way the fraction is (decision 0.17), so a change made on
    the Friday before a Sunday-ended month is waived on the same arithmetic
    that would have priced it.
    """
    remaining = _working_days(event_date, period_end)
    return remaining <= threshold


def plan_change_lines(
    old_rate: float | Decimal,
    new_rate: float | Decimal,
    period_start: date,
    period_end: date,
    change_date: date,
) -> list[dict]:
    """Calculate the billing lines for a mid-cycle plan change.

    Returns a list of dicts with {kind, description, amount, cadence} ready
    to be written as org_billing_lines.  May return 0–2 entries:
      - `kind='credit'` for the unused days at the old rate
      - `kind='setup'`  for the remaining days at the new rate

    ── THE CREDIT IS A CREDIT NOW (migration 222) ───────────────────────────

    It used to be a `setup` line, which is a CHARGE, so a mid-cycle change
    raised two debits and the client was billed for the plan they left as well
    as the one they moved to. A downgrade from ₹8,000 to ₹3,000 halfway through
    August billed ₹5,500 instead of crediting ₹4,000 against ₹1,500.

    `amount` STAYS POSITIVE — it is a magnitude, `org_billing_lines.amount` is
    `CHECK (amount >= 0)`, and this module's neighbour argues correctly that a
    charge to be reversed is a credit note rather than a negative row. The
    KIND is what carries the sign, and exactly one function applies it:
    `services.billing_lines._signed_amount`. Nothing here negates anything.

    Waives micro-charges when the billable days left <= PRORATION_WAIVE_THRESHOLD.
    """
    if change_date <= period_start or change_date >= period_end:
        return []

    lines = []

    if should_waive(period_end, change_date):
        return []

    old_credit = prorate(old_rate, period_start, period_end, change_date, direction="remaining")
    new_charge = prorate(new_rate, period_start, period_end, change_date, direction="remaining")

    # The days the client is being credited or charged FOR — billable days, the
    # same ones the amount was divided by. It read the calendar difference,
    # which put "unused 16 days" next to a figure that was thirteen days' worth.
    remaining = _working_days(change_date, period_end)

    if old_credit > 0 and float(old_rate) > 0:
        lines.append({
            "kind": "credit",
            "description": f"Plan change credit: unused {remaining} days at ₹{old_rate}/mo",
            "amount": old_credit,
            "cadence": "one_off",
        })

    if new_charge > 0 and float(new_rate) > 0:
        lines.append({
            "kind": "setup",
            "description": f"Plan change charge: {remaining} days at ₹{new_rate}/mo",
            "amount": new_charge,
            "cadence": "one_off",
        })

    return lines


def module_cotermination(
    module_rate: float | Decimal,
    period_start: date,
    period_end: date,
    activation_date: date,
) -> dict | None:
    """Calculate the prorated charge for a module activated mid-cycle.

    Returns a billing line dict or None if waived.
    """
    if activation_date <= period_start:
        return None
    if activation_date >= period_end:
        return None
    if should_waive(period_end, activation_date):
        return None

    charge = prorate(module_rate, period_start, period_end, activation_date, direction="remaining")
    if charge <= 0:
        return None

    # Billable days, matching the divisor in `charge` — see `plan_change_lines`.
    remaining = _working_days(activation_date, period_end)
    return {
        "kind": "setup",
        "description": f"Module activation: prorated {remaining} days at ₹{module_rate}/mo",
        "amount": charge,
        "cadence": "one_off",
    }
