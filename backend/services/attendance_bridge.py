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

**Overtime is computed only from a policy the org actually set.**
Migration 082 added the shift definition this file used to say was missing.
Without a policy — or with `overtime_enabled` false, which is the default —
`overtime_hours` is left untouched, exactly as before. Nothing starts earning
overtime because a migration ran.

The thresholds are statutory rather than invented. Factories Act 1948 §54 caps a
day at nine hours and §51 caps a week at forty-eight; §59 prices work beyond
either at twice the ordinary rate. So the daily threshold defaults to 9, NOT to
the eight-hour contracted day — the ninth hour is ordinary time under the Act,
and paying it at 2x would be as wrong as not paying the tenth.

**An hour is overtime once.** A day can breach the daily cap, the weekly cap, or
both, and counting it twice inflates a payslip. Per day the answer is
`max(daily_excess, weekly_excess)`, where the weekly figure is the part of THAT
day falling beyond the weekly threshold once the week's hours are accumulated in
order. That places the 49th hour of the week on the day it was actually worked,
rather than on whichever day the report happens to sort last.

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
from datetime import date as _date, datetime, timedelta
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
class ShiftPolicy:
    """The org's shift definition — migration 082.

    Defaults mirror the column defaults so an org with no policy row behaves
    identically to one that has accepted every default: overtime OFF.
    """
    overtime_enabled: bool = False
    standard_hours_per_day: float = 8.0
    overtime_daily_threshold_hours: float = 9.0      # Factories Act §54
    overtime_weekly_threshold_hours: float = 48.0    # Factories Act §51
    overtime_multiplier: float = 2.0                 # Factories Act §59
    week_starts_on: int = 1                          # ISO: 1 = Monday
    shift_start_time: Optional[object] = None        # datetime.time
    shift_end_time: Optional[object] = None
    overnight_shift: bool = False

    def week_key(self, day: _date) -> _date:
        """The date the containing week starts on.

        `isoweekday()` is 1..7 Mon..Sun, matching `week_starts_on`, so the offset
        is the distance back to the configured first day.
        """
        offset = (day.isoweekday() - self.week_starts_on) % 7
        return day - timedelta(days=offset)


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
    #: None means "not computed" — no policy, or overtime disabled. Distinct
    #: from 0.0, which means "computed, and there was none".
    overtime_hours: Optional[float] = None
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


def _day_of(dt: datetime, policy: Optional[ShiftPolicy] = None) -> _date:
    """The day a punch belongs to — which is the SHIFT's day, not the clock's.

    For a normal shift these are the same. For an overnight shift they are not:
    a punch at 01:00 belongs to the shift that started at 22:00 yesterday, and
    treating it as today's splits one night into two half-days that both look
    like somebody forgot to clock out.

    A punch is attributed to the previous day when the shift runs overnight and
    the punch falls before the shift's END time — i.e. it is still inside the
    window that opened yesterday. Migration 082's CHECK guarantees an overnight
    policy has a window, so `shift_end_time` is present whenever this matters.
    """
    if policy and policy.overnight_shift and policy.shift_end_time is not None:
        # `<=`, not `<`. The overnight tail runs from midnight to the shift's end
        # INCLUSIVE: someone clocking out at exactly 06:00 is finishing the night
        # that began at 22:00, not starting a new day. An exclusive bound put
        # that punch on the following day and split one night into two half-days,
        # each looking like a missed clock-out.
        if dt.timetz().replace(tzinfo=None) <= policy.shift_end_time:
            return (dt - timedelta(days=1)).date()
    return dt.date()


def _apply_overtime(records: list, policy: Optional[ShiftPolicy]) -> None:
    """Fill `overtime_hours`, in place, once per hour worked.

    Left as None when there is no policy or overtime is switched off — None is
    "not computed", which the caller must be able to tell apart from a computed
    zero. A day with no hours at all is skipped for the same reason: an
    incomplete day has unknown overtime, not none.

    Weekly overtime is accumulated in date order so the hours beyond the weekly
    threshold land on the day they were actually worked. Taking `max` of the two
    figures rather than their sum is what keeps a day that breaches both caps
    from being paid twice for the same hour.
    """
    if not policy or not policy.overtime_enabled:
        return

    by_person_week: dict[tuple[str, _date], float] = {}

    for rec in sorted(records, key=lambda r: (r.employee_id, r.day)):
        if rec.work_hours is None:
            continue

        daily_excess = max(0.0, rec.work_hours - policy.overtime_daily_threshold_hours)

        key = (rec.employee_id, policy.week_key(rec.day))
        before = by_person_week.get(key, 0.0)
        after = before + rec.work_hours
        by_person_week[key] = after

        # The slice of THIS day that sits beyond the weekly cap.
        weekly_excess = max(
            0.0,
            min(rec.work_hours, after - policy.overtime_weekly_threshold_hours),
        )

        rec.overtime_hours = round(max(daily_excess, weekly_excess), 2)


def build_day_records(
    punches: Iterable[Punch],
    regularisations: Iterable[Regularisation] = (),
    policy: Optional[ShiftPolicy] = None,
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
        buckets.setdefault((p.employee_id, _day_of(p.captured_at, policy)), []).append(p)

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

        result.records.append(rec)

    _apply_overtime(result.records, policy)
    return result
