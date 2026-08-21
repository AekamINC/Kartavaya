"""
schedule_gap_finder — the shifts nobody has been put on yet.

── WHY THIS FILE WAS REWRITTEN ────────────────────────────────────────────────

It selected `sd.min_staff` from `staging.manav_shift_definitions`. THAT COLUMN
HAS NEVER EXISTED. Migration 027 created that table with a name, a start and
end time, a break, a colour and an is_active flag — and no staffing requirement
of any kind. Every run of this handler since it was registered raised
`UndefinedColumnError`, and nothing noticed for the same reason the whole
skills shelf went untested: no template had ever carried a function step, and
the offline suite hands every handler a MagicMock pool that answers `[]` to
valid and invalid SQL alike. See `tests/test_skill_sql_is_valid.py`, which
parses this query against the live catalogue without executing it.

── WHERE A STAFFING REQUIREMENT ACTUALLY LIVES ────────────────────────────────

In `staging.manav_shift_bids`. A bid is the product's only expression of "this
shift, on this date, needs this many people": a manager opens one with
`slots_needed`, employees apply, and `POST /shift-bids/{id}/accept/{employee}`
awards a slot AND writes the roster row. When the last slot goes the bid is
marked `filled`, so an OPEN bid is precisely an unmet requirement.

That makes the honest question this handler can answer:

    of the shifts this firm has asked to be covered in the coming week,
    which still have fewer people rostered than were asked for?

It is narrower than the question the old query pretended to answer — there is
no per-shift minimum in this product, so "every shift that is understaffed"
cannot be computed at all — and it is the one the data supports. A handler that
invented a minimum would report gaps that no manager had ever asked for.

── THE SECOND BUG IN THE SAME QUERY ───────────────────────────────────────────

`filled` counted only schedules with `status = 'confirmed'`. Nothing in this
product ever writes that value: `manav_schedules.status` defaults to
'scheduled', the award route inserts without naming a status and its ON
CONFLICT sets 'scheduled' explicitly. So even against a table with the missing
column added, every shift would have counted as zero-filled and every one would
have been reported as a gap. Coverage now counts everyone on the roster who is
not recorded as absent or swapped out.
"""
import logging
from datetime import date, timedelta

from services.skills.timeutil import coming_week_start

log = logging.getLogger(__name__)

#: Roster rows that do NOT cover a shift. 027's CHECK allows five values;
#: 'scheduled', 'confirmed' and 'completed' are all somebody being there.
#: Named as an exclusion rather than an inclusion so that a sixth status added
#: later counts as coverage by default — over-reporting a gap sends a manager
#: to look at a shift that is fine, while under-reporting one leaves it
#: uncovered.
_NOT_COVERING = ("absent", "swapped")


async def find_coverage_gaps(pool, org_id: str, week_start: date | None = None) -> list:
    """Shifts asked to be covered in a week, with fewer people rostered.

    *week_start* defaults to the Monday of the coming week — coverage is a
    forward question, and without a default this handler could not run
    unattended at all: the dispatcher refuses any skill declaring a
    parameter with no default that nothing supplied.

    Returns list of {date, shift, slots_needed, slots_filled} where
    slots_filled < slots_needed.
    """
    week_start = week_start or coming_week_start()
    week_end = week_start + timedelta(days=6)

    rows = await pool.fetch(
        """
        WITH asked AS (
            -- Several bids may be opened on the same shift and day; they are
            -- separate requests for people and the requirement is their sum.
            SELECT b.shift_id, b.date AS sdate,
                   SUM(b.slots_needed)::int AS slots_needed
            FROM staging.manav_shift_bids b
            WHERE b.org_id = $1::uuid
              AND b.date BETWEEN $2::date AND $3::date
              AND b.status = 'open'
            GROUP BY b.shift_id, b.date
        ),
        rostered AS (
            SELECT s.shift_id, s.date AS sdate, COUNT(*)::int AS cnt
            FROM staging.manav_schedules s
            WHERE s.org_id = $1::uuid
              AND s.date BETWEEN $2::date AND $3::date
              AND s.status <> ALL($4::text[])
            GROUP BY s.shift_id, s.date
        )
        SELECT a.sdate,
               sd.name AS shift_name,
               a.slots_needed,
               COALESCE(r.cnt, 0) AS filled
        FROM asked a
        -- The shift definition is joined on the org as well as the id: the bid
        -- carries its own org_id, and re-stating it here means a shift name
        -- from another tenant cannot be printed even if a bid row were ever
        -- written pointing at one.
        JOIN staging.manav_shift_definitions sd
          ON sd.id = a.shift_id AND sd.org_id = $1::uuid
        LEFT JOIN rostered r
          ON r.shift_id = a.shift_id AND r.sdate = a.sdate
        WHERE COALESCE(r.cnt, 0) < a.slots_needed
        ORDER BY a.sdate, sd.name
        LIMIT 200
        """,
        org_id, week_start, week_end, list(_NOT_COVERING),
    )

    return [
        {
            "date": str(r["sdate"]),
            "shift": r["shift_name"],
            "slots_needed": r["slots_needed"],
            "slots_filled": r["filled"],
        }
        for r in rows
    ]
