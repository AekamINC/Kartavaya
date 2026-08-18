"""Metric threshold alerts — D7's bridge from the registry to the engine.

One evaluation path, deliberately: an alert runs THE METRIC'S OWN SQL from
the analytics registry, so the number that trips a threshold is the number
the dashboard shows, by construction. Re-implementing DSO here — even
correctly — would be the metric drift proposal 62 names as the programme's
failure mode.

WHAT A BREACH BECOMES: a `metric.threshold` temporal event, deduplicated to
once per alert per calendar day by the same partial unique index every sweep
event rides. Delivery is a RULE — the shipped template notifies the org
admins in-app — so quiet hours, preferences, arming and the runs ledger all
apply without this module knowing any of them exist.

WHAT AN ALERT'S VALUE IS: the metric over the alert's window (flows) or
as-at-now (stocks), reduced to ONE number the way the dashboard's KPI tiles
reduce it:

    one row            → its value
    many rows, not pct → the sum (a flow series sums to its window total)
    many rows, pct     → REFUSED, recorded — the mean of period rates is not
                         the period's rate, and most rate metrics (dso,
                         collection_rate, win_rate…) already answer as a
                         bucket-invariant single row precisely so this case
                         stays theoretical.

Failure polarity: an alert that cannot be evaluated (retired metric, absent
metric, refused reduction, SQL fault) is COUNTED AND LOGGED, and evaluation
continues — one broken alert must not silence an org's other alerts, and a
sweep tick must never die on configuration.
"""
from __future__ import annotations

import logging

from .subjects import METRIC_THRESHOLD, temporal

log = logging.getLogger(__name__)

#: Alerts one tick will evaluate. Each costs one metric query; a runaway
#: config table must not turn the sweep into a load test.
PER_TICK = 200


def _reduce(rows, unit: str):
    """(value, why_not). The KPI tile's reduction, stated once for alerts."""
    if not rows:
        return None, "the metric returned no rows for this window"
    if len(rows) == 1:
        v = dict(rows[0]).get("value")
        return (float(v), None) if v is not None else (None, "a null value")
    if unit == "pct":
        return None, ("a rate series cannot be reduced honestly — the mean "
                      "of period rates is not the period's rate")
    total = 0.0
    for r in rows:
        v = dict(r).get("value")
        if v is not None:
            total += float(v)
    return total, None


def _breached(value: float, operator: str, threshold: float) -> bool:
    return value > threshold if operator == "gt" else value < threshold


async def run_alerts(pool, *, now) -> dict:
    """Evaluate every active alert. Returns {checked, breached, emitted,
    deduped, skipped} — breached and emitted differ by the daily dedupe."""
    from datetime import timedelta

    from analytics.registry import REGISTRY, MetricRequest, load_all
    from services.analytics_window import Window

    load_all()
    async with pool.acquire() as conn:
        alerts = await conn.fetch(
            "SELECT id, org_id, metric, operator, threshold, window_days "
            "  FROM staging.analytics_alerts WHERE is_active "
            " ORDER BY created_at LIMIT $1::int", PER_TICK)

    checked = breached = emitted = deduped = skipped = 0
    for a in alerts:
        m = REGISTRY.get(a["metric"])
        if m is None or m.absent:
            skipped += 1
            log.warning("niyam alerts: %s names %r, which is %s — skipped",
                        a["id"], a["metric"],
                        "absent" if m else "not in the registry")
            continue
        today = now.date()
        win = (Window(today - timedelta(days=int(a["window_days"]) - 1), today)
               if m.grain == "flow" else None)
        req = MetricRequest(org_id=str(a["org_id"]), window=win, bucket="month")
        try:
            sql, params = m.sql(req)
            async with pool.acquire() as conn:
                rows = await conn.fetch(sql, *params)
        except Exception:
            skipped += 1
            log.exception("niyam alerts: %s (%s) could not be evaluated",
                          a["id"], a["metric"])
            continue
        value, why_not = _reduce(rows, m.unit)
        checked += 1
        if why_not is not None:
            skipped += 1
            log.warning("niyam alerts: %s (%s): %s", a["id"], a["metric"], why_not)
            continue
        if not _breached(value, a["operator"], float(a["threshold"])):
            continue
        breached += 1
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    event_id = await temporal(
                        conn,
                        org_id=str(a["org_id"]),
                        event_type=METRIC_THRESHOLD,
                        entity_type="metric_alert",
                        entity_id=f"alert:{a['id']}",
                        # once per alert per day while it stays breached: the
                        # date is IN the key, same shape as attendance_summary
                        dedupe_key=(f"metric_alert:{a['id']}:"
                                    f"{today.isoformat()}"),
                        after={
                            "metric": m.key,
                            "label": m.label,
                            "unit": m.unit,
                            "value": round(value, 4),
                            "threshold": float(a["threshold"]),
                            "operator": a["operator"],
                            "window_days": int(a["window_days"]),
                        })
            if event_id is None:
                deduped += 1
            else:
                emitted += 1
        except Exception:
            log.exception("niyam alerts: %s breached but could not emit", a["id"])

    return {"checked": checked, "breached": breached, "emitted": emitted,
            "deduped": deduped, "skipped": skipped}
