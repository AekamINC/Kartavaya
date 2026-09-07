"""
A status the bridge invents must never reach a column that refuses it.

`services/attendance_bridge.py` is a pure function and answers `incomplete` for
a day it cannot price: one punch and no pair, or an out before an in. That is
the honest answer, and `public.manav_attendance.status` has no such value —
`manav_attendance_status_check` admits exactly

    present, absent, half_day, late, on_leave, holiday, weekend

read from the live catalogue 2026-09-07 and confirmed write-free
(`SELECT 'incomplete' = ANY(ARRAY[...])` → false).

Until 2026-09-07 `routers/pahchan_attendance.py` looped over EVERY record the
bridge returned and inserted it. A single-punch day — somebody clocked in and
forgot to clock out, the most ordinary attendance exception there is — sent
`status='incomplete'` into that CHECK and 500'd the whole publish. **It had
never fired because `pahchan_punches` holds zero rows**: the empty table was
hiding a defect downstream of it, not merely an unexercised path.

These tests pin the two halves:

  · the bridge still produces `incomplete` for the days it cannot price, because
    that is the conservatism the rest of the file exists to protect; and
  · `incomplete` is NOT in `WRITABLE_STATUSES`, so the membership filter in the
    publish route cannot pass it to the INSERT.

No database and no I/O, for the same reason the sibling file says: the logic is
pure, and a mock could be wrong in the same direction as the code.
"""

from datetime import date, datetime, timedelta, timezone

from services.attendance_bridge import (
    STATUS_INCOMPLETE,
    STATUS_PRESENT,
    WRITABLE_STATUSES,
    Punch,
    build_day_records,
)

DAY = date(2026, 7, 20)
EMP = "emp-1"


def at(hour, minute=0):
    return datetime(DAY.year, DAY.month, DAY.day, hour, minute, tzinfo=timezone.utc)


def punch(direction, when, verdict="ok"):
    return Punch(
        employee_id=EMP,
        direction=direction,
        captured_at=when,
        flags=(),
        review_verdict=verdict,
    )


# ── The constant itself ──────────────────────────────────────────────────────

def test_incomplete_is_not_a_writable_status():
    """The whole defect in one assertion.

    If this ever passes the other way, the publish route will hand the database
    a value its CHECK refuses and the endpoint will 500 on the first real month.
    """
    assert STATUS_INCOMPLETE not in WRITABLE_STATUSES


def test_writable_statuses_match_the_database_check_exactly():
    """Pinned against the live catalogue, not against a migration file.

    A migration can be unapplied; the catalogue is what refuses the write. If
    someone widens the CHECK, this test is the place that has to be updated —
    which is the point, because widening it is a decision about what a
    half-recorded day MEANS to payroll.
    """
    assert WRITABLE_STATUSES == {
        "present", "absent", "half_day", "late", "on_leave", "holiday", "weekend",
    }


def test_present_is_writable():
    """A negative control for the two above: the set is not simply empty."""
    assert STATUS_PRESENT in WRITABLE_STATUSES


# ── The days that produce it ─────────────────────────────────────────────────

def test_a_single_punch_day_is_not_writable():
    """Clocked in, never out. The ordinary case that would have 500'd."""
    result = build_day_records([punch("in", at(9))], [], policy=None)
    recs = [r for r in result.records if r.day == DAY]
    assert len(recs) == 1
    assert recs[0].status == STATUS_INCOMPLETE
    assert recs[0].work_hours is None
    assert recs[0].status not in WRITABLE_STATUSES


def test_out_before_in_is_not_writable():
    """A broken pair, not a short day — and not a negative number for payroll."""
    result = build_day_records(
        [punch("in", at(17)), punch("out", at(9))], [], policy=None,
    )
    recs = [r for r in result.records if r.day == DAY]
    assert len(recs) == 1
    assert recs[0].status == STATUS_INCOMPLETE
    assert recs[0].work_hours is None
    assert recs[0].status not in WRITABLE_STATUSES


def test_a_complete_day_is_writable():
    """The other negative control: the filter must not withhold everything."""
    result = build_day_records(
        [punch("in", at(9)), punch("out", at(17))], [], policy=None,
    )
    recs = [r for r in result.records if r.day == DAY]
    assert len(recs) == 1
    assert recs[0].status == STATUS_PRESENT
    assert recs[0].status in WRITABLE_STATUSES
    assert recs[0].work_hours == 8.0


def test_every_status_the_bridge_emits_is_either_writable_or_withheld():
    """The invariant stated over the bridge's whole output, not one case.

    Whatever mix of punches goes in, every record is either writable — and so
    admitted by the CHECK — or excluded by the membership filter. There is no
    third outcome in which a record reaches the INSERT with a status the column
    refuses, which is precisely what happened before.
    """
    mixed = [
        punch("in", at(9)), punch("out", at(17)),          # complete
        punch("in", at(9) + timedelta(days=1)),            # single punch
        punch("in", at(17) + timedelta(days=2)),           # out before in
        punch("out", at(9) + timedelta(days=2)),
    ]
    result = build_day_records(mixed, [], policy=None)
    assert result.records, "the fixture must produce records or this proves nothing"
    for rec in result.records:
        assert (rec.status in WRITABLE_STATUSES) or (rec.status == STATUS_INCOMPLETE), (
            f"{rec.day}: status {rec.status!r} is neither writable nor the known "
            "withheld value — it would reach the INSERT and violate the CHECK"
        )


# ── The split the publish route actually performs ────────────────────────────
# `partition_for_write` exists so these run against the REAL filter rather than
# a re-implementation of it. A filter written inline in the route is invisible
# to a test with no database, and invisible is how the original defect survived.

def test_partition_sends_only_writable_records_to_the_insert():
    from services.attendance_bridge import partition_for_write

    result = build_day_records(
        [
            punch("in", at(9)), punch("out", at(17)),        # complete
            punch("in", at(9) + timedelta(days=1)),          # single punch
        ],
        [], policy=None,
    )
    writable, withheld = partition_for_write(result.records)

    assert [r.status for r in writable] == [STATUS_PRESENT]
    assert [r.status for r in withheld] == [STATUS_INCOMPLETE]
    for rec in writable:
        assert rec.status in WRITABLE_STATUSES, (
            "this record is handed straight to the INSERT; a status outside the "
            "CHECK here is the 500 the whole file is about"
        )


def test_partition_loses_nothing():
    """Every record lands in exactly one side. A day silently dropped by the
    filter is a day payroll never hears about and nobody is told to fix."""
    from services.attendance_bridge import partition_for_write

    result = build_day_records(
        [
            punch("in", at(9)), punch("out", at(17)),
            punch("in", at(9) + timedelta(days=1)),
            punch("in", at(17) + timedelta(days=2)),
            punch("out", at(9) + timedelta(days=2)),
        ],
        [], policy=None,
    )
    writable, withheld = partition_for_write(result.records)
    assert len(writable) + len(withheld) == len(result.records)
    assert not (set(id(r) for r in writable) & set(id(r) for r in withheld))
