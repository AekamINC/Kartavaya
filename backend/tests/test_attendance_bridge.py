"""
Pairing punches into attendance is a decision about someone's pay.

Pahchan writes `pahchan_punches`; Vetana reads `manav_attendance`; nothing
joined them, so attendance never reached payroll. `services/attendance_bridge.py`
is that join, and every rule in it is conservative on purpose. These tests pin
the conservatism, because the failure mode is not a crash — it is a number that
looks plausible on a payslip.

The properties that matter, in the order they would hurt:

  · A punch nobody has reviewed must NOT become pay. It is exactly the punch a
    human is supposed to look at.
  · An unpaired punch yields NULL hours, never 0. Zero is a number payroll will
    multiply; unknown is not.
  · Out-before-in yields NULL, never a negative. Same reason, worse.
  · Overtime is never invented. No shift definition exists in this product, so
    there is nothing to derive it from.
  · An approved correction beats the raw punch — that is what a correction is.

No database and no I/O: `build_day_records` is deliberately pure so these run on
the logic itself rather than through a mock that could be wrong in the same
direction as the code.
"""

from datetime import date, datetime, timedelta, timezone

from services.attendance_bridge import (
    STATUS_INCOMPLETE,
    STATUS_PRESENT,
    Punch,
    Regularisation,
    build_day_records,
)

DAY = date(2026, 7, 20)
EMP = "emp-1"


def at(hour, minute=0):
    return datetime(2026, 7, 20, hour, minute, tzinfo=timezone.utc)


# ── The ordinary day ─────────────────────────────────────────────────────────

def test_a_clean_pair_becomes_a_present_day_with_hours():
    res = build_day_records([
        Punch(EMP, "in", at(9)),
        Punch(EMP, "out", at(17, 30)),
    ])
    assert len(res.records) == 1
    rec = res.records[0]
    assert rec.status == STATUS_PRESENT
    assert rec.work_hours == 8.5
    assert rec.check_in == at(9) and rec.check_out == at(17, 30)


def test_earliest_in_and_latest_out_win():
    """Three ins is one arrival and two duplicates. Taking the earliest in and
    the latest out is the reading that does not shorten someone's day."""
    res = build_day_records([
        Punch(EMP, "in", at(9)),
        Punch(EMP, "in", at(9, 5)),
        Punch(EMP, "out", at(13)),
        Punch(EMP, "out", at(18)),
    ])
    rec = res.records[0]
    assert rec.check_in == at(9)
    assert rec.check_out == at(18)
    assert rec.work_hours == 9.0


# ── Review gating: the highest-stakes rule ───────────────────────────────────

def test_a_flagged_unreviewed_punch_does_not_become_pay():
    res = build_day_records([
        Punch(EMP, "in", at(9), flags=("mock_location",), review_verdict=None),
        Punch(EMP, "out", at(17), flags=("mock_location",), review_verdict=None),
    ])
    assert res.records == [], (
        "a punch waiting for review was paid — that punch is flagged precisely "
        "because someone is supposed to look at it first"
    )
    assert res.withheld_pending_review == 1


def test_a_punch_a_reviewer_rejected_does_not_become_pay():
    res = build_day_records([
        Punch(EMP, "in", at(9), flags=("far",), review_verdict="flagged"),
        Punch(EMP, "out", at(17), flags=("far",), review_verdict="flagged"),
    ])
    assert res.records == []
    assert res.withheld_pending_review == 1


def test_a_reviewer_clearing_a_flagged_punch_lets_it_pay():
    """The gate must be a gate, not a wall: 'ok' is a human saying yes."""
    res = build_day_records([
        Punch(EMP, "in", at(9), flags=("far",), review_verdict="ok"),
        Punch(EMP, "out", at(17), flags=("far",), review_verdict="ok"),
    ])
    assert len(res.records) == 1
    assert res.records[0].status == STATUS_PRESENT
    assert res.records[0].work_hours == 8.0


# ── Unknown is not zero ──────────────────────────────────────────────────────

def test_an_in_with_no_out_yields_null_hours_not_zero():
    res = build_day_records([Punch(EMP, "in", at(9))])
    rec = res.records[0]
    assert rec.status == STATUS_INCOMPLETE
    assert rec.work_hours is None, (
        "an unfinished day was recorded as zero hours — zero is a number "
        "payroll will multiply, unknown is not"
    )


def test_out_before_in_yields_null_not_a_negative():
    res = build_day_records([
        Punch(EMP, "in", at(17)),
        Punch(EMP, "out", at(9)),
    ])
    rec = res.records[0]
    assert rec.status == STATUS_INCOMPLETE
    assert rec.work_hours is None, "a broken pair produced negative hours"


def test_identical_in_and_out_is_not_a_zero_hour_present_day():
    res = build_day_records([
        Punch(EMP, "in", at(9)),
        Punch(EMP, "out", at(9)),
    ])
    assert res.records[0].work_hours is None
    assert res.records[0].status == STATUS_INCOMPLETE


# ── Corrections ──────────────────────────────────────────────────────────────

def test_an_approved_correction_overrides_the_raw_punch():
    res = build_day_records(
        [Punch(EMP, "in", at(9)), Punch(EMP, "out", at(14))],
        [Regularisation(EMP, DAY, "out", at(18))],
    )
    rec = res.records[0]
    assert rec.check_out == at(18), "the correction did not win — that is what a correction is"
    assert rec.work_hours == 9.0
    assert "regularisation" in rec.sources


def test_a_correction_can_create_a_day_with_no_punches_at_all():
    """Someone who forgot to clock in entirely still has a correctable day."""
    res = build_day_records(
        [],
        [Regularisation(EMP, DAY, "in", at(9)), Regularisation(EMP, DAY, "out", at(17))],
    )
    assert len(res.records) == 1
    assert res.records[0].status == STATUS_PRESENT
    assert res.records[0].work_hours == 8.0


def test_a_correction_rescues_a_day_whose_punches_were_all_withheld():
    res = build_day_records(
        [Punch(EMP, "in", at(9), flags=("mock_location",), review_verdict="flagged")],
        [Regularisation(EMP, DAY, "in", at(9, 30)), Regularisation(EMP, DAY, "out", at(17, 30))],
    )
    assert len(res.records) == 1
    assert res.records[0].check_in == at(9, 30)
    assert res.records[0].work_hours == 8.0


# ── Overtime is never invented ───────────────────────────────────────────────

def test_overtime_is_never_derived():
    """There is no shift definition in this product — pahchan_policy holds
    geofence and retention settings and no expected hours. A twelve-hour day
    must not silently become four hours of overtime against an assumed eight."""
    res = build_day_records([Punch(EMP, "in", at(6)), Punch(EMP, "out", at(18))])
    rec = res.records[0]
    assert rec.work_hours == 12.0
    assert not hasattr(rec, "overtime_hours") or getattr(rec, "overtime_hours", None) is None


# ── Separation between people and days ───────────────────────────────────────

def test_two_employees_do_not_bleed_into_each_other():
    res = build_day_records([
        Punch("emp-a", "in", at(9)),
        Punch("emp-b", "in", at(10)),
        Punch("emp-a", "out", at(17)),
        Punch("emp-b", "out", at(19)),
    ])
    by_emp = {r.employee_id: r for r in res.records}
    assert by_emp["emp-a"].work_hours == 8.0
    assert by_emp["emp-b"].work_hours == 9.0


def test_days_are_kept_apart():
    d2 = datetime(2026, 7, 21, 9, tzinfo=timezone.utc)
    res = build_day_records([
        Punch(EMP, "in", at(9)), Punch(EMP, "out", at(17)),
        Punch(EMP, "in", d2), Punch(EMP, "out", d2 + timedelta(hours=7)),
    ])
    assert len(res.records) == 2
    assert {r.day for r in res.records} == {date(2026, 7, 20), date(2026, 7, 21)}


def test_rerunning_the_same_input_gives_the_same_output():
    """The intended use is to run it again as corrections land."""
    punches = [Punch(EMP, "in", at(9)), Punch(EMP, "out", at(17))]
    a = build_day_records(punches)
    b = build_day_records(punches)
    assert [(r.employee_id, r.day, r.work_hours, r.status) for r in a.records] == \
           [(r.employee_id, r.day, r.work_hours, r.status) for r in b.records]
