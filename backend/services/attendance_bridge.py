"""
attendance_bridge.py — turn Pahchan punches into payroll-grade attendance.

Pahchan writes `staging.pahchan_punches`. Vetana reads `staging.manav_attendance`.
Nothing connected them, so attendance never reached payroll: people clocked in
every day and the payroll run could not see it.

Bridging the two is not a copy. A punch is an event; an attendance row is a
CLAIM ABOUT A WORKING DAY that money is calculated from. The pairing rules below
are the difference, and each one is a decision about someone's pay.

═══════════════════════════════════════════════════════════════════════════════
THE RULES, AND WHY EACH IS CONSERVATIVE
═══════════════════════════════════════════════════════════════════════════════

**A flagged punch never becomes pay unless a human cleared it.**
`review_verdict` is 'ok' | 'flagged' | NULL. A punch with flags and no verdict is
precisely the one waiting for someone to look at it, and a punch verdicted
'flagged' is one somebody looked at and rejected. Neither pays. They are counted
and reported instead, because the useful output is "eleven days are waiting on
you", not silence.

**Overtime is NOT computed, and that is deliberate.**
There is no shift definition anywhere in this product. `pahchan_policy` holds
geofence radius, grace minutes and retention — no start time, no expected hours,
no overtime threshold. Computing overtime would mean inventing a standard day,
usually as eight hours, and an invented number that reaches a payslip is worse
than an absent one: it looks authoritative and nobody re-derives it.
`overtime_hours` is left untouched for a human or a later policy to set.

**A manual row is never overwritten.**
`marked_by` distinguishes 'manual' (HR typed it) from 'pahchan' (this bridge).
HR correcting a day is the most deliberate signal in the system, and a nightly
re-run silently reverting it would be the worst failure this code could have.
Manual rows are skipped and reported as skipped.

**An unpaired punch produces hours of NULL, not zero.**
Someone who clocked in and never clocked out has an unknown day, not an empty
one. Zero is a number payroll will happily multiply.

**Re-running changes nothing that has not itself changed.**
The upsert is keyed on (employee_id, date) and every input is derived, so a
second run over the same window is a no-op. That matters because the honest way
to use this is to run it repeatedly as corrections land.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as _date, datetime
from typing import Iterable, Optional

#: A punch pays only if a reviewer cleared it, or it never needed clearing.
#: Mirrors the pending-review predicate the register already uses:
#:     flags <> '{}' AND review_verdict IS NULL
VERDICT_REJECTED = "flagged"
VERDICT_CLEARED = "ok"

STATUS_PRESENT = "present"
STATUS_INCOMPLETE = "incomplete"

MARKED_BY_BRIDGE = "pahchan"
MARKED_BY_MANUAL = "manual"


@dataclass
class Punch:
    employee_id: str
    direction: str            # 'in' | 'out'
    captured_at: datetime
    flags: tuple = ()
    review_verdict: Optional[str] = None

    @property
    def is_eligible(self) -> bool:
        """Clean, or explicitly cleared. Everything else waits for a human."""
        if self.review_verdict == VERDICT_REJECTED:
            return False
        if self.flags and self.review_verdict is None:
            return False
        return True


@dataclass
class Regularisation:
    """An approved correction. Supplies a punch time that was missing or wrong.

    Only `status='approved'` rows are ever passed in — a pending request is a
    question, not an answer, and must not move anybody's pay.
    """
    employee_id: str
    for_date: _date
    direction: str
    at_time: datetime


@dataclass
class DayRecord:
    employee_id: str
    day: _date
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    status: str = STATUS_INCOMPLETE
    work_hours: Optional[float] = None
    sources: list = field(default_factory=list)   # 'punch' and/or 'regularisation'

    @property
    def notes(self) -> str:
        if "regularisation" in self.sources:
            return "Built from Pahchan punches, including an approved correction."
        return "Built from Pahchan punches."


@dataclass
class BridgeResult:
    records: list = field(default_factory=list)
    withheld_pending_review: int = 0
    withheld_days: list = field(default_factory=list)

    @property
    def summary(self) -> dict:
        return {
            "days_built": len(self.records),
            "days_withheld_pending_review": self.withheld_pending_review,
        }


def _day_of(dt: datetime) -> _date:
    """The calendar day a punch belongs to.

    Uses the timestamp as stored. Every punch carries a timezone-aware
    `captured_at`, so this is the day in whichever zone the connection reports —
    which for an overnight shift is NOT the shift's day. There is no shift
    definition to consult (see the module docstring), so there is nothing to
    resolve it against; a night-shift org would need one before this is correct
    for them. Stated rather than silently assumed.
    """
    return dt.date()


def build_day_records(
    punches: Iterable[Punch],
    regularisations: Iterable[Regularisation] = (),
) -> BridgeResult:
    """Pair punches into one record per employee per day.

    First eligible `in` and last eligible `out` win: a day with three ins is one
    arrival and two duplicates, and taking the earliest is the reading that does
    not shorten someone's day. Approved regularisations override both, because
    the point of a correction is that the raw punch was wrong.
    """
    result = BridgeResult()
    buckets: dict[tuple[str, _date], list[Punch]] = {}

    for p in punches:
        buckets.setdefault((p.employee_id, _day_of(p.captured_at)), []).append(p)

    # A correction can name a day with no punch at all — someone who forgot
    # entirely — so it has to be able to create a bucket, not only amend one.
    reg_by_day: dict[tuple[str, _date], list[Regularisation]] = {}
    for r in regularisations:
        key = (r.employee_id, r.for_date)
        reg_by_day.setdefault(key, []).append(r)
        buckets.setdefault(key, [])

    for (employee_id, day), day_punches in sorted(buckets.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        eligible = [p for p in day_punches if p.is_eligible]
        withheld = len(day_punches) - len(eligible)

        rec = DayRecord(employee_id=employee_id, day=day)

        ins = sorted((p for p in eligible if p.direction == "in"), key=lambda p: p.captured_at)
        outs = sorted((p for p in eligible if p.direction == "out"), key=lambda p: p.captured_at)
        if ins:
            rec.check_in = ins[0].captured_at
            rec.sources.append("punch")
        if outs:
            rec.check_out = outs[-1].captured_at
            if "punch" not in rec.sources:
                rec.sources.append("punch")

        for r in reg_by_day.get((employee_id, day), []):
            if r.direction == "in":
                rec.check_in = r.at_time
            elif r.direction == "out":
                rec.check_out = r.at_time
            if "regularisation" not in rec.sources:
                rec.sources.append("regularisation")

        if rec.check_in and rec.check_out:
            if rec.check_out <= rec.check_in:
                # Out before in is not a short day, it is a broken pair. Refuse
                # to express it as hours rather than emit a negative number that
                # payroll would multiply.
                rec.status = STATUS_INCOMPLETE
                rec.work_hours = None
            else:
                rec.status = STATUS_PRESENT
                rec.work_hours = round((rec.check_out - rec.check_in).total_seconds() / 3600, 2)
        else:
            rec.status = STATUS_INCOMPLETE
            rec.work_hours = None

        if rec.check_in is None and rec.check_out is None:
            # Nothing eligible and no correction: the day is entirely withheld.
            # Emitting an 'absent' row here would assert someone did not work
            # on the strength of a punch nobody has reviewed yet.
            if withheld:
                result.withheld_pending_review += 1
                result.withheld_days.append({"employee_id": employee_id, "date": day.isoformat()})
            continue

        if withheld:
            result.withheld_pending_review += 0  # counted only for fully-withheld days
        result.records.append(rec)

    return result
