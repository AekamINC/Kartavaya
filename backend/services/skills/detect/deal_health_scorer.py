import logging
from services.skills.timeutil import utc_now, days_between

log = logging.getLogger(__name__)

# Weights for risk factors
STALE_DAYS = 14          # no activity in this many days
PAST_CLOSE_PENALTY = 30  # points lost if past expected close


async def score_deals(pool, org_id: str) -> list:
    """Score open deals by health.

    Returns list of {deal_id, title, value, health, days_in_stage, risk_factors}.
    health: 'good' | 'at_risk' | 'critical'
    """
    now = utc_now()

    rows = await pool.fetch(
        """
        SELECT d.id, d.title, d.value, d.stage, d.updated_at,
               d.expected_close_date, d.probability,
               (SELECT MAX(a.created_at)
                FROM staging.graha_activities a
                WHERE a.deal_id = d.id) AS last_activity
        FROM staging.graha_deals d
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

        # Stale deal
        last_touch = r["last_activity"] or r["updated_at"]
        days_since_activity = days_between(now, last_touch)
        if days_since_activity > STALE_DAYS:
            score -= 30
            risk_factors.append(f"no_activity_{days_since_activity}d")

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

        health = "good" if score >= 70 else ("at_risk" if score >= 40 else "critical")

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
