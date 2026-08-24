"""
billing_cycle.py — Billing period advancement, trial expiry, and anchor math.

Called by the daily cron (`/cron/billing`).  Pure functions are tested without
a database; the top-level `run_billing_cycle` sweeps every active org.
"""
import logging
from datetime import date, timedelta
from db import get_pool

log = logging.getLogger(__name__)


# ── Pure helpers ────────────────────────────────────────────────

def next_anchor(anchor_day: int, after: date) -> date:
    """Return the first date on or after `after` whose day == anchor_day.

    Clamps to the last day of the month when a short month cannot hold the
    anchor (e.g. anchor_day=31 → 28 in Feb, but we cap at 28 in the CHECK
    constraint so this only fires for 28-in-Feb in non-leap years — which is
    still the 28th, so no real clamp).
    """
    import calendar

    y, m = after.year, after.month
    max_day = calendar.monthrange(y, m)[1]
    day = min(anchor_day, max_day)
    candidate = date(y, m, day)
    if candidate >= after:
        return candidate
    # Move to next month
    if m == 12:
        y, m = y + 1, 1
    else:
        m += 1
    max_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(anchor_day, max_day))


def period_end_for(start: date, cycle: str) -> date:
    """Given a period start and billing cycle, return the period end."""
    if cycle == "annual":
        return date(start.year + 1, start.month, start.day)
    # Monthly: advance by one month
    import calendar
    if start.month == 12:
        y, m = start.year + 1, 1
    else:
        y, m = start.year, start.month + 1
    max_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(start.day, max_day))


# ── Database operations ────────────────────────────────────────

async def advance_periods(pool, today: date | None = None) -> dict:
    """Roll forward every subscription whose current_period_end <= today.

    Returns counts of advanced and skipped orgs.
    """
    today = today or date.today()
    rows = await pool.fetch(
        "SELECT s.org_id, s.billing_cycle, s.current_period_end, "
        "       o.billing_anchor_day "
        "FROM staging.subscriptions s "
        "JOIN staging.organisations o ON o.id = s.org_id "
        "WHERE s.status = 'active' "
        "  AND s.current_period_end IS NOT NULL "
        "  AND s.current_period_end <= $1",
        today,
    )

    advanced = 0
    for r in rows:
        anchor = r["billing_anchor_day"] or 1
        old_end = r["current_period_end"]
        new_start = next_anchor(anchor, old_end)
        new_end = period_end_for(new_start, r["billing_cycle"])

        await pool.execute(
            "UPDATE staging.subscriptions SET "
            "  current_period_start = $2, "
            "  current_period_end   = $3, "
            "  next_billing_date    = $3, "
            "  updated_at           = NOW() "
            "WHERE org_id = $1",
            r["org_id"], new_start, new_end,
        )
        advanced += 1
        log.info(
            "Advanced billing period for org %s: %s → %s..%s",
            r["org_id"], old_end, new_start, new_end,
        )

    return {"advanced": advanced, "checked": len(rows)}


async def expire_trials(pool, today: date | None = None) -> dict:
    """Downgrade orgs whose trial has ended to the free plan."""
    today = today or date.today()

    free_plan = await pool.fetchval(
        "SELECT id FROM staging.plans WHERE code = 'free' AND is_active = TRUE"
    )
    if not free_plan:
        log.warning("No active free plan found — skipping trial expiry")
        return {"expired": 0}

    result = await pool.execute(
        "UPDATE staging.subscriptions SET "
        "  plan_id  = $1, "
        "  status   = 'active', "
        "  updated_at = NOW() "
        "WHERE status = 'trialing' "
        "  AND trial_ends_at IS NOT NULL "
        "  AND trial_ends_at::date <= $2",
        free_plan, today,
    )
    count = int(result.split()[-1]) if result else 0
    if count:
        log.info("Expired %d trial subscription(s)", count)
    return {"expired": count}


async def run_billing_cycle(today: date | None = None) -> dict:
    """Top-level entry point for the daily billing cron."""
    pool = await get_pool()
    today = today or date.today()

    periods = await advance_periods(pool, today)
    trials = await expire_trials(pool, today)

    return {
        "date": str(today),
        "periods": periods,
        "trials": trials,
    }
