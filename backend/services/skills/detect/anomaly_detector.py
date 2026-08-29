import logging
from datetime import timedelta
from services.skills.timeutil import utc_now

log = logging.getLogger(__name__)

# Metric -> (table, value_col, date_col, extra_filter)
_METRIC_MAP = {
    "revenue": ("public.ganit_payments", "amount", "payment_date", ""),
    "expenses": ("public.ganit_expenses", "total", "expense_date", "AND is_active = true"),
    "deals_value": ("public.graha_deals", "value", "created_at", "AND is_active = true"),
    "new_leads": ("public.graha_contacts", "1", "created_at", "AND contact_type = 'lead' AND is_active = true"),
}

DEVIATION_THRESHOLD = 40  # flag if >40% deviation from mean


async def detect_anomalies(
    pool, org_id: str, metric: str, lookback_days: int = 90
) -> list:
    """Detect daily values that deviate significantly from the rolling average.

    Returns list of {date, value, expected, deviation_pct} for anomalous days.
    """
    spec = _METRIC_MAP.get(metric)
    if not spec:
        return []

    table, val_col, date_col, extra = spec
    since = utc_now() - timedelta(days=lookback_days)

    # Aggregate by day
    agg = "SUM" if val_col != "1" else "COUNT"
    query = f"""
        SELECT {date_col}::date AS d, {agg}({val_col}) AS val
        FROM {table}
        WHERE org_id = $1::uuid AND {date_col} >= $2
          {extra}
        GROUP BY d
        ORDER BY d
    """
    rows = await pool.fetch(query, org_id, since)

    if len(rows) < 7:
        return []

    values = [(r["d"], float(r["val"])) for r in rows]
    total = sum(v for _, v in values)
    mean = total / len(values)

    if mean == 0:
        return []

    anomalies = []
    for d, v in values:
        dev = abs(v - mean) / mean * 100
        if dev > DEVIATION_THRESHOLD:
            anomalies.append({
                "date": str(d),
                "value": v,
                "expected": round(mean, 2),
                "deviation_pct": round(dev, 1),
            })
    return anomalies
