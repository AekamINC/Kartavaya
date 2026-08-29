"""Deal health scoring — and the two ways it was lying.

On 2026-08-06 this scorer called **510 of Aekam's 512 open deals `at_risk`**, and
that looked like a broken score. Measured against the live database, it is not:
those 512 deals have **zero activity rows between them** and 510 are past their
expected close date. They are the old bulk seed, not a pipeline. Any honest score
flags them, and the arithmetic was reproduced in SQL exactly. That flag is
withdrawn.

The real defect ran the other way, and it is visible in the demo org:

    org                open  labelled "good"  …of those, STALE  worst
    Unicode Group        15               15                 10   203 days
    E2E Test             90               50                 33   141 days

A deal nobody had touched in **203 days** was shown as healthy. Two causes, both
fixed here:

1. **A single factor landed exactly on a band boundary.** Staleness cost a flat 30
   and `good` was `score >= 70`, so 100 − 30 = 70 = "good". The strongest signal in
   the model, on its own, produced the healthiest label — and it did so identically
   whether the deal had been quiet for 15 days or for seven months. The penalty now
   grows with the silence, and `good` is strictly above the boundary so a deal that
   has crossed the staleness line cannot be called healthy.

2. **"Never contacted" was reported as "contacted a long time ago."** `last_activity`
   falls back to `updated_at` when a deal has no activities, so a deal nobody has
   ever logged anything against produced `no_activity_203d` — which reads as "we
   spoke 203 days ago". 528 of 617 open deals across all three organisations have no
   activity row at all, so this was the common case, not the edge one. It is now its
   own factor, measured from `created_at`, which is the honest clock for "this has
   sat here since the day it was created".
"""
import logging
from services.skills.timeutil import utc_now, days_between

log = logging.getLogger(__name__)

# Weights for risk factors
STALE_DAYS = 14          # silence beyond this many days is a risk factor
STALE_BASE = 30          # cost of crossing that line at all
STALE_PER_WEEK = 5       # and a further cost for each additional full week
# Capped, but high enough that silence alone can reach `critical`. It crosses at
# nine weeks: a deal nobody has touched in two months is not merely at risk.
STALE_MAX = 70
PAST_CLOSE_PENALTY = 30  # points lost if past expected close
NEVER_CONTACTED = 15     # nobody has ever logged a single activity against it

# `good` is STRICTLY above this. 100 − STALE_BASE lands on it exactly, and a deal
# that has crossed the staleness line must not be labelled healthy — that is the
# bug this constant exists to prevent, so do not relax it back to >=.
GOOD_FLOOR = 70
AT_RISK_FLOOR = 40


def _staleness_penalty(days_quiet: int) -> int:
    """Flat 30 was the bug: 15 days quiet and 203 days quiet scored the same."""
    if days_quiet <= STALE_DAYS:
        return 0
    extra_weeks = (days_quiet - STALE_DAYS) // 7
    return min(STALE_MAX, STALE_BASE + STALE_PER_WEEK * extra_weeks)


async def score_deals(pool, org_id: str) -> list:
    """Score open deals by health.

    Returns list of {deal_id, title, value, health, days_in_stage, risk_factors}.
    health: 'good' | 'at_risk' | 'critical'
    """
    now = utc_now()

    rows = await pool.fetch(
        """
        SELECT d.id, d.title, d.value, d.stage, d.updated_at, d.created_at,
               d.expected_close_date, d.probability,
               (SELECT MAX(a.created_at)
                FROM public.graha_activities a
                WHERE a.deal_id = d.id) AS last_activity
        FROM public.graha_deals d
        WHERE d.org_id = $1::uuid
          AND d.is_active = true
          AND d.won_at IS NULL AND d.lost_at IS NULL
        ORDER BY d.value DESC NULLS LAST
        """,
        org_id,
    )

    results = []
    for r in rows:
        risk_factors = []
        score = 100

        # Days in current stage (since last update)
        days_in_stage = days_between(now, r["updated_at"])

        # How long has it been quiet, and is that silence or is it emptiness?
        #
        # `updated_at` is a machine timestamp — a background job touching the row
        # resets it — so it answers "when was this record last written", not "when
        # did we last talk to them". Where there is no activity at all, the honest
        # clock is created_at: the deal has sat there, uncontacted, since the day
        # somebody typed it in.
        if r["last_activity"] is None:
            days_quiet = days_between(now, r["created_at"] or r["updated_at"])
            score -= NEVER_CONTACTED
            risk_factors.append(f"never_contacted_{days_quiet}d")
        else:
            days_quiet = days_between(now, r["last_activity"])

        if days_quiet > STALE_DAYS:
            score -= _staleness_penalty(days_quiet)
            risk_factors.append(f"no_activity_{days_quiet}d")

        # Past expected close
        if r["expected_close_date"] and r["expected_close_date"] < now.date():
            days_past = days_between(now, r["expected_close_date"])
            score -= min(PAST_CLOSE_PENALTY, days_past)
            risk_factors.append(f"past_close_by_{days_past}d")

        # Low probability
        prob = r["probability"] or 0
        if prob < 20:
            score -= 20
            risk_factors.append("low_probability")

        # Stuck in early stage too long
        if days_in_stage > 30 and r["stage"] in ("New", "Qualified"):
            score -= 15
            risk_factors.append("stuck_early_stage")

        health = (
            "good" if score > GOOD_FLOOR
            else ("at_risk" if score >= AT_RISK_FLOOR else "critical")
        )

        results.append({
            "deal_id": str(r["id"]),
            "title": r["title"],
            "value": float(r["value"]) if r["value"] else 0,
            "health": health,
            "score": max(0, score),
            "days_in_stage": days_in_stage,
            "risk_factors": risk_factors,
        })

    return results
