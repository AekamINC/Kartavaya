"""
services/proration.py — Proration math for billing.

Proposal 86, phase P2.  Pure functions that calculate proportional charges
when a service starts or ends mid-cycle.  Used by:
  - admin_set_plan (plan upgrade/downgrade mid-cycle)
  - module activation (co-termination)
  - client billing (P5, already built — can call these directly)

All functions are deterministic and take dates, never query the database.
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

_CENT = Decimal("0.01")

PRORATION_WAIVE_THRESHOLD = 3


def days_in_period(start: date, end: date) -> int:
    """Total calendar days in a billing period (end exclusive)."""
    return (end - start).days


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

    if direction == "elapsed":
        active_days = (event_date - period_start).days
    else:
        active_days = (period_end - event_date).days

    active_days = max(0, min(active_days, total_days))

    amt = Decimal(str(amount)) * Decimal(str(active_days)) / Decimal(str(total_days))
    return amt.quantize(_CENT, rounding=ROUND_HALF_UP)


def should_waive(
    period_end: date,
    event_date: date,
    threshold: int = PRORATION_WAIVE_THRESHOLD,
) -> bool:
    """If remaining days <= threshold, waive the micro-charge."""
    remaining = (period_end - event_date).days
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
      - credit for unused days at the old rate (negative conceptually, but
        stored as a one_off with description mentioning 'credit')
      - charge for remaining days at the new rate

    Waives micro-charges when remaining days <= PRORATION_WAIVE_THRESHOLD.
    """
    if change_date <= period_start or change_date >= period_end:
        return []

    lines = []

    if should_waive(period_end, change_date):
        return []

    old_credit = prorate(old_rate, period_start, period_end, change_date, direction="remaining")
    new_charge = prorate(new_rate, period_start, period_end, change_date, direction="remaining")

    if old_credit > 0 and float(old_rate) > 0:
        lines.append({
            "kind": "setup",
            "description": f"Plan change credit: unused {(period_end - change_date).days} days at ₹{old_rate}/mo",
            "amount": old_credit,
            "cadence": "one_off",
        })

    if new_charge > 0 and float(new_rate) > 0:
        lines.append({
            "kind": "setup",
            "description": f"Plan change charge: {(period_end - change_date).days} days at ₹{new_rate}/mo",
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

    remaining = (period_end - activation_date).days
    return {
        "kind": "setup",
        "description": f"Module activation: prorated {remaining} days at ₹{module_rate}/mo",
        "amount": charge,
        "cadence": "one_off",
    }
