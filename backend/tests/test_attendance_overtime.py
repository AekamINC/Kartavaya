"""
Overtime — computed from the org's policy, or not computed at all.

Until migration 082 there was no shift definition in this product, so the bridge
refused to derive overtime and said why. 082 supplies it, and the defaults are
statutory rather than invented:

    Factories Act 1948 §54   nine hours in a day
    Factories Act 1948 §51   forty-eight hours in a week
    Factories Act 1948 §59   twice the ordinary rate beyond either

The daily threshold is 9 and NOT the 8-hour contracted day. The ninth hour is
ordinary time under the Act; paying it at 2x is as wrong as not paying the tenth.
Those are two different facts that get conflated because they are usually equal,
so `standard_hours_per_day` and `overtime_daily_threshold_hours` are separate
columns and both are tested here.

The rule that is easiest to get wrong: AN HOUR IS OVERTIME ONCE. A day can breach
the daily cap, the weekly cap, or both. Adding the two figures pays the same hour
twice, which on a 2x multiplier is a real and invisible overcharge.
"""

from datetime import date, datetime, time, timedelta, timezone

from services.attendance_bridge import (
    Punch,
    ShiftPolicy,
    build_day_records,
)

EMP = "emp-1"
MONDAY = date(2026, 7, 20)          # a real Monday


def day_at(d: date, hour: float):
    h = int(hour)
    m = int(round((hour - h) * 60))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=timezone.utc)


def worked(d: date, hours: float):
    """A clean in/out pair of the given length, starting at 09:00."""
    return [
        Punch(EMP, "in", day_at(d, 9)),
        Punch(EMP, "out", day_at(d, 9 + hours)),
    ]


ON = ShiftPolicy(overtime_enabled=True)          # statutory defaults: 9 / 48 / 2x


# ── Not computed is not zero ─────────────────────────────────────────────────

def test_no_policy_leaves_overtime_uncomputed():
    res = build_day_records(worked(MONDAY, 12))
    assert res.records[0].work_hours == 12.0
    assert res.records[0].overtime_hours is None, (
        "overtime was computed with no policy to compute it from — the whole "
        "reason the bridge refused before 082"
    )


def test_policy_with_overtime_off_leaves_it_uncomputed():
    """The default. An org that never opens the settings screen must see exactly
    the behaviour it saw yesterday."""
    res = build_day_records(worked(MONDAY, 12), policy=ShiftPolicy(overtime_enabled=False))
    assert res.records[0].overtime_hours is None


def test_a_normal_day_computes_zero_not_none():
    """0.0 and None mean opposite things: 'there was none' vs 'nobody looked'."""
    res = build_day_records(worked(MONDAY, 8), policy=ON)
    assert res.records[0].overtime_hours == 0.0


# ── Daily threshold: the Act's ninth hour ────────────────────────────────────

def test_the_ninth_hour_is_ordinary_time():
    """§54 caps the day at nine. Nine hours exactly earns nothing — using the
    8-hour contracted day as the threshold would wrongly pay the ninth at 2x."""
    res = build_day_records(worked(MONDAY, 9), policy=ON)
    assert res.records[0].overtime_hours == 0.0


def test_the_tenth_hour_is_overtime():
    res = build_day_records(worked(MONDAY, 10), policy=ON)
    assert res.records[0].overtime_hours == 1.0


def test_the_daily_threshold_is_configurable():
    """State Shops & Establishments Acts differ from the Factories Act, which is
    why this is a column and not a constant."""
    pol = ShiftPolicy(overtime_enabled=True, standard_hours_per_day=8,
                      overtime_daily_threshold_hours=8)
    res = build_day_records(worked(MONDAY, 10), policy=pol)
    assert res.records[0].overtime_hours == 2.0


def test_an_incomplete_day_has_unknown_overtime_not_zero():
    res = build_day_records([Punch(EMP, "in", day_at(MONDAY, 9))], policy=ON)
    assert res.records[0].work_hours is None
    assert res.records[0].overtime_hours is None


# ── Weekly threshold: §51 ────────────────────────────────────────────────────

def test_weekly_overtime_lands_on_the_day_the_week_crossed_it():
    """Six days of 8.5 is 51 hours. No single day breaches the daily cap of 9,
    so a daily-only reading pays nothing — but §51 was crossed on day six."""
    punches = []
    for i in range(6):
        punches += worked(MONDAY + timedelta(days=i), 8.5)

    res = build_day_records(punches, policy=ON)
    ot = {r.day: r.overtime_hours for r in res.records}

    assert all(ot[MONDAY + timedelta(days=i)] == 0.0 for i in range(5)), (
        "overtime appeared before the weekly threshold was reached"
    )
    assert ot[MONDAY + timedelta(days=5)] == 3.0, (
        "the 49th, 50th and 51st hours of the week were not paid as overtime"
    )


def test_an_hour_is_overtime_once():
    """Six days of 10 hours: 60 in the week, each day one hour past the daily cap.

    Days 1-4 are 1h each on the daily rule while the week is still under 48.
    Day 5 runs from hour 41 to 50, so hours 49 and 50 are past the weekly cap —
    2h, which subsumes that day's 1h daily excess rather than adding to it.
    Day 6 is entirely past 48, so all 10h count.

    16h total. Summing the two rules instead of taking the greater would bill
    22h, and at a 2x multiplier that is a silent overcharge on every payslip.
    """
    punches = []
    for i in range(6):
        punches += worked(MONDAY + timedelta(days=i), 10)

    res = build_day_records(punches, policy=ON)
    ot = [r.overtime_hours for r in sorted(res.records, key=lambda r: r.day)]

    assert ot == [1.0, 1.0, 1.0, 1.0, 2.0, 10.0]
    assert sum(ot) == 16.0


def test_a_new_week_resets_the_weekly_count():
    punches = []
    for i in range(12):                       # two full six-day weeks of 8.5h
        punches += worked(MONDAY + timedelta(days=i), 8.5)

    res = build_day_records(punches, policy=ON)
    ot = {r.day: r.overtime_hours for r in res.records}

    # Day 8 is the Monday after: a fresh week, well under 48 again.
    assert ot[MONDAY + timedelta(days=7)] == 0.0, "the weekly total carried across weeks"


def test_week_start_day_is_respected():
    """An employer whose week starts Sunday splits these six days differently
    from one whose week starts Monday, and the same hours produce different
    overtime. That is why week_starts_on exists."""
    punches = []
    for i in range(6):
        punches += worked(MONDAY + timedelta(days=i), 8.5)

    sunday_start = ShiftPolicy(overtime_enabled=True, week_starts_on=7)
    res = build_day_records(punches, policy=sunday_start)
    total = sum(r.overtime_hours for r in res.records)

    # Mon-Sat all fall inside one Sunday-start week too, so the total matches —
    # what this pins is that a different start does not crash or silently
    # double-count.
    assert total == 3.0


def test_two_employees_have_independent_weeks():
    punches = []
    for i in range(6):
        d = MONDAY + timedelta(days=i)
        punches += [
            Punch("emp-a", "in", day_at(d, 9)), Punch("emp-a", "out", day_at(d, 17.5)),
            Punch("emp-b", "in", day_at(d, 9)), Punch("emp-b", "out", day_at(d, 13)),
        ]
    res = build_day_records(punches, policy=ON)
    by_emp = {}
    for r in res.records:
        by_emp.setdefault(r.employee_id, []).append(r.overtime_hours)

    assert sum(by_emp["emp-a"]) == 3.0      # 51h in the week
    assert sum(by_emp["emp-b"]) == 0.0      # 24h — one person's hours did not
                                            # push the other over the cap


# ── Overnight shifts: the other half of the missing definition ───────────────

def test_an_overnight_shift_belongs_to_the_day_it_started():
    """A punch at 02:00 belongs to the shift that opened at 22:00 yesterday.
    Without this, one night becomes two half-days that both look like somebody
    forgot to clock out."""
    pol = ShiftPolicy(
        overtime_enabled=True, overnight_shift=True,
        shift_start_time=time(22, 0), shift_end_time=time(6, 0),
    )
    punches = [
        Punch(EMP, "in", datetime(2026, 7, 20, 22, 0, tzinfo=timezone.utc)),
        Punch(EMP, "out", datetime(2026, 7, 21, 6, 0, tzinfo=timezone.utc)),
    ]
    res = build_day_records(punches, policy=pol)

    assert len(res.records) == 1, "one night was split across two days"
    rec = res.records[0]
    assert rec.day == date(2026, 7, 20), "the night was filed under the wrong day"
    assert rec.work_hours == 8.0


def test_without_the_overnight_flag_a_night_still_splits():
    """Pins the behaviour the flag exists to change, so the flag is provably
    doing the work rather than being decorative."""
    punches = [
        Punch(EMP, "in", datetime(2026, 7, 20, 22, 0, tzinfo=timezone.utc)),
        Punch(EMP, "out", datetime(2026, 7, 21, 6, 0, tzinfo=timezone.utc)),
    ]
    res = build_day_records(punches, policy=ON)
    assert len(res.records) == 2
    assert all(r.work_hours is None for r in res.records)
