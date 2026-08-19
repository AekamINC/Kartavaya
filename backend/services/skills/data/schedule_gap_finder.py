import logging
from datetime import date, timedelta

from services.skills.timeutil import coming_week_start

log = logging.getLogger(__name__)


async def find_coverage_gaps(pool, org_id: str, week_start: date | None = None) -> list:
    """Find shift-scheduling gaps for a given week.

    *week_start* defaults to the Monday of the coming week — coverage is a
    forward question, and without a default this handler could not run
    unattended at all: the dispatcher refuses any skill declaring a
    parameter with no default that nothing supplied.

    Returns list of {date, shift, slots_needed, slots_filled} where slots_filled < slots_needed.
    """
    week_start = week_start or coming_week_start()
    week_end = week_start + timedelta(days=6)

    rows = await pool.fetch(
        """
        WITH shift_needs AS (
            SELECT sd.id AS shift_id, sd.name AS shift_name,
                   sd.min_staff,
                   d::date AS sdate
            FROM staging.manav_shift_definitions sd
            CROSS JOIN generate_series($2::date, $3::date, '1 day'::interval) d
            WHERE sd.org_id = $1::uuid AND sd.is_active = true
        ),
        filled AS (
            SELECT s.shift_id, s.date AS sdate, COUNT(*) AS cnt
            FROM staging.manav_schedules s
            WHERE s.org_id = $1::uuid
              AND s.date BETWEEN $2 AND $3
              AND s.status = 'confirmed'
            GROUP BY s.shift_id, s.date
        )
        SELECT sn.sdate, sn.shift_name, sn.min_staff,
               COALESCE(f.cnt, 0) AS filled
        FROM shift_needs sn
        LEFT JOIN filled f ON f.shift_id = sn.shift_id AND f.sdate = sn.sdate
        WHERE COALESCE(f.cnt, 0) < sn.min_staff
        ORDER BY sn.sdate, sn.shift_name
        """,
        org_id, week_start, week_end,
    )

    return [
        {
            "date": str(r["sdate"]),
            "shift": r["shift_name"],
            "slots_needed": r["min_staff"],
            "slots_filled": r["filled"],
        }
        for r in rows
    ]
