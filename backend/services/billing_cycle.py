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
    import calendar
    if cycle == "quarterly":
        m = start.month + 3
        y = start.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        max_day = calendar.monthrange(y, m)[1]
        return date(y, m, min(start.day, max_day))
    # Monthly (default)
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
        "FROM public.subscriptions s "
        "JOIN public.organisations o ON o.id = s.org_id "
        "WHERE s.status = 'active' "
        # A DEACTIVATED ORGANISATION MUST NOT BE BILLED. `scheduler._for_each_org`
        # states this rule for every other cron in the product and filters on it;
        # this sweep joined `organisations` already — it had the row in hand and
        # simply never looked at the column.
        #
        # `IS NOT FALSE` rather than `= TRUE` so a NULL (a row predating the
        # column) is INCLUDED rather than silently dropped. That direction is
        # deliberate and is the same choice `_for_each_org` makes: getting this
        # backwards would stop billing every legacy org, which is a worse and
        # much quieter failure than the one being fixed.
        "  AND o.is_active IS NOT FALSE "
        "  AND s.current_period_end IS NOT NULL "
        "  AND s.current_period_end <= $1",
        today,
    )

    # ── ONE ORG'S FAILURE MUST NOT SILENTLY TRUNCATE THE SWEEP ──────────────
    #
    # This loop had no guard. A single raise — a bad anchor day, a lock timeout,
    # one malformed row — aborted the whole run, and because each UPDATE commits
    # on its own, the orgs already advanced STAYED advanced while every org after
    # the failure was silently not. The cron answered 500 with no record of how
    # far it got, and a re-run would advance the first group a SECOND time.
    #
    # Same shape as `scheduler._for_each_org`: isolate per org, keep going, and
    # fail the tick at the end so the failure is loud without being contagious.
    # The counts are returned either way, which is what makes a re-run decidable.
    advanced = 0
    failures: dict[str, str] = {}
    for r in rows:
        org_id = str(r["org_id"])
        try:
            anchor = r["billing_anchor_day"] or 1
            old_end = r["current_period_end"]
            new_start = next_anchor(anchor, old_end)
            new_end = period_end_for(new_start, r["billing_cycle"])

            await pool.execute(
                "UPDATE public.subscriptions SET "
                "  current_period_start = $2, "
                "  current_period_end   = $3, "
                "  next_billing_date    = $3, "
                "  updated_at           = NOW() "
                # Scoped to the ACTIVE subscription, not to the org. A UNIQUE
                # index on `org_id` means these select the same row today, so
                # this changes nothing now — it is here because the SELECT above
                # filters `status='active'` and the UPDATE did not, and the day
                # an org is allowed a second subscription row that difference
                # rewrites a cancelled plan's period dates with no error.
                "WHERE org_id = $1 AND status = 'active'",
                r["org_id"], new_start, new_end,
            )
            advanced += 1
            log.info(
                "Advanced billing period for org %s: %s → %s..%s",
                org_id, old_end, new_start, new_end,
            )
        except Exception as exc:                                    # noqa: BLE001
            log.exception("Billing cycle: could not advance org %s", org_id)
            failures[org_id] = f"{type(exc).__name__}: {exc}"

    out = {"advanced": advanced, "checked": len(rows)}
    if failures:
        # Reported, never swallowed. Returning a clean result here is the
        # failure mode this codebase names most often: the caller would see
        # {"advanced": 3} and read a partial sweep as a complete one.
        out["failed"] = failures
    return out


async def expire_trials(pool, today: date | None = None) -> dict:
    """Downgrade orgs whose trial has ended to the free plan."""
    today = today or date.today()

    free_plan = await pool.fetchval(
        "SELECT id FROM public.plans WHERE code = 'free' AND is_active = TRUE"
    )
    if not free_plan:
        log.warning("No active free plan found — skipping trial expiry")
        return {"expired": 0}

    result = await pool.execute(
        "UPDATE public.subscriptions SET "
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
