import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

LATE_THRESHOLD = 5      # days late in period = chronic
OT_THRESHOLD_HRS = 20   # total OT hours in period = excessive
ABSENT_THRESHOLD = 5    # absences in period


async def detect_patterns(pool, org_id: str, lookback_days: int = 30) -> dict:
    """Detect attendance patterns: chronic lateness, excessive OT, absenteeism.

    Returns {chronic_late: [...], excessive_ot: [...], absenteeism: [...]}.
    """
    since = datetime.utcnow() - timedelta(days=lookback_days)

    chronic_late = await pool.fetch(
        """
        SELECT a.employee_id, e.name, COUNT(*) AS late_days
        FROM staging.manav_attendance a
        JOIN staging.manav_employees e ON e.id = a.employee_id
        WHERE a.org_id = $1::uuid AND a.date >= $2::date
          AND a.status = 'late'
        GROUP BY a.employee_id, e.name
        HAVING COUNT(*) >= $3
        ORDER BY late_days DESC
        """,
        org_id, since, LATE_THRESHOLD,
    )

    excessive_ot = await pool.fetch(
        """
        SELECT a.employee_id, e.name,
               COALESCE(SUM(a.overtime_hours), 0) AS total_ot
        FROM staging.manav_attendance a
        JOIN staging.manav_employees e ON e.id = a.employee_id
        WHERE a.org_id = $1::uuid AND a.date >= $2::date
          AND a.overtime_hours > 0
        GROUP BY a.employee_id, e.name
        HAVING SUM(a.overtime_hours) >= $3
        ORDER BY total_ot DESC
        """,
        org_id, since, OT_THRESHOLD_HRS,
    )

    absenteeism = await pool.fetch(
        """
        SELECT a.employee_id, e.name, COUNT(*) AS absent_days
        FROM staging.manav_attendance a
        JOIN staging.manav_employees e ON e.id = a.employee_id
        WHERE a.org_id = $1::uuid AND a.date >= $2::date
          AND a.status = 'absent'
        GROUP BY a.employee_id, e.name
        HAVING COUNT(*) >= $3
        ORDER BY absent_days DESC
        """,
        org_id, since, ABSENT_THRESHOLD,
    )

    def _fmt(rows, val_key):
        return [
            {"employee_id": str(r["employee_id"]), "name": r["name"], val_key: r[val_key]}
            for r in rows
        ]

    return {
        "chronic_late": _fmt(chronic_late, "late_days"),
        "excessive_ot": _fmt(excessive_ot, "total_ot"),
        "absenteeism": _fmt(absenteeism, "absent_days"),
    }
