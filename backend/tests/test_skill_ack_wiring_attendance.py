"""
check_attendance_exceptions — four checks, one list, and two identity fields the
handler did not emit until this wiring.

Three of the four findings are things a firm KNOWS about and cannot record: the
fitter who forgets to punch out, the founder whose leave nobody tracks, the site
where attendance is kept on paper. They are read and re-read until the list is
wallpaper, which is the whole case for an acknowledgement.

The pinned judgements:
  · the NAME is not a key — the handler identified an employee only by
    `employee` until now, and ten names in the largest org are held by three
    active people each;
  · `date` separates two exceptions about one person on two days;
  · `month` scopes the month-level check, so August's ack does not silence
    September's fifteen unverified days;
  · `last_missing` is `days_past` wearing a date, and is in neither hash.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

SKILL = "check_attendance_exceptions"
W = ACK_WIRING[SKILL]

CHECKS = ("unclosed_punch", "absent_without_approved_leave",
          "no_attendance_on_working_day", "leave_beyond_balance")


def _punch(date="2026-08-04", code="EMP-013", **kw) -> dict:
    row = {"check": "unclosed_punch", "month": "2026-08", "employee": "Myra Bansal",
           "employee_code": code, "department": "Audit", "date": date,
           "detail": "checked in and never checked out",
           "email": "m@example.com", "link": "/manav/employees/abc"}
    row.update(kw)
    return row


def _gap(missing=15, code="EMP-013", month="2026-08", **kw) -> dict:
    row = {"check": "no_attendance_on_working_day", "month": month,
           "employee": "Myra Bansal", "employee_code": code, "department": "Audit",
           "missing_days": missing, "first_missing": "2026-08-01",
           "last_missing": "2026-08-21",
           "detail": f"{missing} working day(s) with no attendance row"}
    row.update(kw)
    return row


def _leave(over=2.0, taken=14.0, code="EMP-013", **kw) -> dict:
    row = {"check": "leave_beyond_balance", "month": "2026-08",
           "employee": "Myra Bansal", "employee_code": code, "department": "Audit",
           "leave_type": "casual", "days_taken": taken, "entitlement": 12.0,
           "days_over": over, "detail": "14 day(s) of approved casual leave"}
    row.update(kw)
    return row


def _out(findings) -> dict:
    findings = list(findings)
    by_dept: dict[str, dict] = {}
    for f in findings:
        slot = by_dept.setdefault(f["department"],
                                  {"department": f["department"], "findings": 0})
        slot["findings"] += 1
        slot[f["check"]] = slot.get(f["check"], 0) + 1
    return {
        "month": "2026-08",
        "window": {"from": "2026-08-01", "to": "2026-08-23"},
        "findings": findings,
        "by_department": sorted(by_dept.values(),
                                key=lambda d: (-d["findings"], d["department"])),
        "counts": {c: sum(1 for f in findings if f["check"] == c) for c in CHECKS},
        "punch_data": {"attendance_rows_in_window": 1840, "rows_carrying_a_punch": 0},
        "overlap_with_payroll_readiness": "…",
        "caveats": [],
    }


def _ack(f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(W.identity_of(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


# ── 1 · it works ────────────────────────────────────────────────────────────

def test_an_acknowledged_exception_stops_being_reported():
    f = _punch()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["findings"] == []
    assert out["acknowledged"]["items"][0]["label"] == "unclosed_punch — Myra Bansal"


# ── 2 · the name is not a key ───────────────────────────────────────────────

def test_two_colleagues_of_the_same_name_are_two_findings():
    one, two = _punch(code="EMP-013"), _punch(code="EMP-088")
    out = apply_wiring(SKILL, _out([one, two]), _ack(one))
    assert [f["employee_code"] for f in out["findings"]] == ["EMP-088"]


def test_a_marriage_does_not_orphan_the_acknowledgement():
    acks = _ack(_punch(employee="Myra Bansal"))
    out = apply_wiring(SKILL, _out([_punch(employee="Myra Iyer", department="Tax")]), acks)
    assert out["findings"] == []


# ── 3 · the per-check discriminators ────────────────────────────────────────

def test_two_days_are_two_findings():
    """`unclosed_punch` is a fact about ONE DAY. Without `date` in the key,
    acknowledging Tuesday's missed punch-out would silence Wednesday's."""
    tue, wed = _punch(date="2026-08-04"), _punch(date="2026-08-05")
    out = apply_wiring(SKILL, _out([tue, wed]), _ack(tue))
    assert [f["date"] for f in out["findings"]] == ["2026-08-05"]


def test_two_leave_types_are_two_findings():
    casual = _leave()
    sick = _leave(leave_type="sick")
    out = apply_wiring(SKILL, _out([casual, sick]), _ack(casual))
    assert [f["leave_type"] for f in out["findings"]] == ["sick"]


def test_the_four_checks_about_one_person_are_four_decisions():
    p, g = _punch(), _gap()
    out = apply_wiring(SKILL, _out([p, g]), _ack(p))
    assert [f["check"] for f in out["findings"]] == ["no_attendance_on_working_day"]


# ── 4 · the month scopes the month-level check ──────────────────────────────

def test_next_month_brings_the_attendance_gap_back():
    """September's fifteen missing days are fifteen more days paid unverified.
    August's acknowledgement must not cover them."""
    acks = _ack(_gap(month="2026-08"))
    out = apply_wiring(SKILL, _out([_gap(month="2026-09")]), acks)
    assert len(out["findings"]) == 1


def test_running_twice_in_one_month_resurrects_nothing():
    acks = _ack(_gap(month="2026-08"))
    assert apply_wiring(SKILL, _out([_gap(month="2026-08")]), acks)["findings"] == []


# ── 5 · the date that ticks ─────────────────────────────────────────────────

def test_the_last_missing_day_advancing_does_not_void_the_acknowledgement():
    """`last_missing` advances every working day the gap persists — it is
    `days_past` wearing a date. In IDENTITY it would mint a new key each day; in
    MATERIAL it would void every ack. `missing_days` is the field that carries
    the severity, and it IS material."""
    acks = _ack(_gap(missing=15))
    same_size = _gap(missing=15, last_missing="2026-08-22", first_missing="2026-08-02")
    assert apply_wiring(SKILL, _out([same_size]), acks)["findings"] == []


def test_more_missing_days_brings_it_back():
    acks = _ack(_gap(missing=15))
    out = apply_wiring(SKILL, _out([_gap(missing=22)]), acks)
    assert len(out["findings"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_more_leave_beyond_the_balance_brings_it_back():
    acks = _ack(_leave(over=2.0, taken=14.0))
    out = apply_wiring(SKILL, _out([_leave(over=6.0, taken=18.0)]), acks)
    assert len(out["findings"]) == 1


def test_a_day_level_check_has_no_amount_and_is_acknowledged_unconditionally():
    """A punch is unclosed or it is not, and correcting it removes the row."""
    f = _punch()
    assert not any(k in f for k in ("missing_days", "days_over", "days_taken"))
    assert apply_wiring(SKILL, _out([f]), _ack(f))["findings"] == []


def test_rewording_the_detail_does_not_void_the_acknowledgement():
    acks = _ack(_gap())
    assert apply_wiring(SKILL, _out([_gap(detail="reworded")]), acks)["findings"] == []


# ── 6 · the aggregates ──────────────────────────────────────────────────────

def test_the_counts_and_departments_are_rebuilt():
    keep = _gap(code="EMP-1")
    hide = _punch(code="EMP-2", department="Tax")
    out = apply_wiring(SKILL, _out([keep, hide]), _ack(hide))
    assert out["counts"]["unclosed_punch"] == 0
    assert out["counts"]["no_attendance_on_working_day"] == 1
    assert out["by_department"] == [
        {"department": "Audit", "findings": 1, "no_attendance_on_working_day": 1}]


def test_every_check_code_survives_reaching_zero():
    f = _punch()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert set(out["counts"]) == set(CHECKS)
    assert out["counts"]["unclosed_punch"] == 0


def test_the_punch_data_is_left_alone():
    """It counts attendance rows in the window. An org that acknowledged every
    exception has not stopped having them — and this block is what says whether
    punch times are being recorded at all."""
    f = _punch()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["punch_data"] == {"attendance_rows_in_window": 1840,
                                 "rows_carrying_a_punch": 0}


# ── 7 · degenerate shapes ───────────────────────────────────────────────────

def test_a_finding_with_no_employee_code_does_not_raise():
    out = apply_wiring(SKILL, _out([_punch(code=None)]), _ack(_punch()))
    assert len(out["findings"]) == 1


def test_an_attendance_shape_change_fails_open():
    data = {"exceptions": [_punch()], "counts": {"unclosed_punch": 1}}
    out = apply_wiring(SKILL, data, _ack(_punch()))
    assert len(out["exceptions"]) == 1
    assert "acknowledged" not in out


def test_the_attendance_key_round_trips():
    first = apply_wiring(SKILL, _out([_gap()]), {"x": skill_ack.Ack("x")})
    f = first["findings"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out([_gap()]), acks)["findings"] == []


def test_the_handler_emits_the_identity_fields_it_is_keyed_on():
    from pathlib import Path
    src = Path("services/skills/data/people_checks.py").read_text(encoding="utf-8")
    seg = src[src.index("async def check_attendance_exceptions"):
              src.index("async def brief_unpaid_reimbursements")]
    assert seg.count('"employee_code": r["employee_code"]') >= 3
    assert seg.count('"month": month') >= 4
