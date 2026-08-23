"""
check_payroll_readiness — the skill `skill_ack.py`'s own docstring is written
around, and the first real wiring with two lists.

It was blocked until `findings_at` learned to take several keys: it returns
`blockers` (who does not get paid, or whether the run can happen at all) and
`warnings` (an amount somebody should decide deliberately), and wiring only the
first would have left every warning repeating for ever under a button that
looked finished.

Three properties carry the risk here, and payroll is the one process in this
product that is hard to undo:

  · a blocker and a warning about ONE PERSON must not share a key;
  · the NAME is not a key — ten names in the largest org are held by three
    active people each, and a blocker means somebody is not paid at all;
  · an acknowledgement must not outlive its MONTH, because next month's run
    omits the same employee again.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_payroll_readiness"
WIRING = ACK_WIRING[SKILL]


def _f(check="no_salary_structure", employee="Myra Bansal", code="EMP-0041",
       month="2026-08", amount=None, **kw) -> dict:
    """One finding in exactly the shape `check_payroll_readiness` emits."""
    row = {
        "month": month,
        "check": check,
        "employee": employee,
        "employee_code": code,
        "detail": "no active salary structure effective on or before month end",
        "email": "myra@example.com",
        "phone": "+91 98765 43210",
        "link": "/manav/employees/3f7c1a52-0b1e-4f8a-9d21-6a5b4c3d2e10",
    }
    if amount is not None:
        row["amount"] = amount
    row.update(kw)
    return row


def _out(blockers=(), warnings=()) -> dict:
    blockers, warnings = list(blockers), list(warnings)
    return {
        "month": "2026-08",
        "blockers": blockers,
        "warnings": warnings,
        "counts": {"blockers": len(blockers), "warnings": len(warnings)},
        "note": "Blockers change who gets paid or stop the run.",
    }


def _ack_for(bucket: str, finding: dict, **kw) -> dict[str, skill_ack.Ack]:
    identity_of = _identity_for(WIRING, bucket)
    key = skill_ack.finding_key(identity_of(finding))
    state = skill_ack.state_hash(WIRING.material_of(finding))
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", **kw)}


# ── 1 · both lists are filtered ─────────────────────────────────────────────

def test_an_acknowledged_blocker_stops_being_reported():
    b = _f()
    out = apply_wiring(SKILL, _out(blockers=[b]), _ack_for("blockers", b))
    assert out["blockers"] == []
    assert out["acknowledged"]["items"][0]["label"] == "no_salary_structure — Myra Bansal"


def test_an_acknowledged_warning_stops_being_reported():
    """The half that would have been left repeating had this skill been wired
    to one list."""
    w = _f(check="outstanding_advance", amount=5418.0)
    out = apply_wiring(SKILL, _out(warnings=[w]), _ack_for("warnings", w))
    assert out["warnings"] == []


def test_the_run_level_finding_is_labelled_without_a_person():
    """`run_already_locked` is about the run, not an employee: the handler
    returns a NULL name and no contact keys at all."""
    f = _f(check="run_already_locked", employee=None, code=None, amount=412000.0)
    out = apply_wiring(SKILL, _out(blockers=[f]), _ack_for("blockers", f))
    assert out["acknowledged"]["items"][0]["label"] == "run_already_locked — the run"


# ── 2 · a blocker and a warning are two decisions ───────────────────────────

def test_acknowledging_a_warning_never_silences_a_blocker():
    """One employee can be in both lists in one run: an advance whose recovery
    is capped AND no bank details. Acknowledging the mild one must not silence
    the severe one — that direction costs somebody their salary."""
    same = _f(check="shared_code", code="EMP-0041")
    out = apply_wiring(SKILL, _out(blockers=[same], warnings=[same]),
                       _ack_for("warnings", same))
    assert out["warnings"] == []
    assert len(out["blockers"]) == 1


# ── 3 · the name is not a key ───────────────────────────────────────────────

def test_two_colleagues_of_the_same_name_are_two_findings():
    """Measured live: ten names in the largest org are held by three active
    employees each. Keyed on `employee`, acknowledging one person's missing
    bank details would silence two colleagues' — and they would not be paid."""
    one = _f(employee="Myra Bansal", code="EMP-0041")
    two = _f(employee="Myra Bansal", code="EMP-0088")
    out = apply_wiring(SKILL, _out(blockers=[one, two]), _ack_for("blockers", one))
    assert [f["employee_code"] for f in out["blockers"]] == ["EMP-0088"]


def test_a_marriage_does_not_orphan_the_acknowledgement():
    acks = _ack_for("blockers", _f(employee="Myra Bansal"))
    out = apply_wiring(SKILL, _out(blockers=[_f(employee="Myra Iyer")]), acks)
    assert out["blockers"] == []


def test_rewording_the_detail_does_not_void_the_acknowledgement():
    """`detail` is prose and for four checks it embeds the very number already
    in `amount`. Hashing it would tie every ack to a sentence's wording and
    count one movement twice."""
    acks = _ack_for("blockers", _f())
    out = apply_wiring(SKILL, _out(blockers=[_f(detail="structure missing")]), acks)
    assert out["blockers"] == []


# ── 4 · the month is a new run, not a ticking clock ─────────────────────────

def test_next_month_brings_the_finding_back():
    """"Priya has no salary structure" acknowledged in August must not stay
    silenced in September: in September the run omits her again, which is a
    person not paid for a second month."""
    acks = _ack_for("blockers", _f(month="2026-08"))
    out = apply_wiring(SKILL, _out(blockers=[_f(month="2026-09")]), acks)
    assert len(out["blockers"]) == 1


def test_running_twice_in_one_month_resurrects_nothing():
    """The other half of the rule. If it did, the user would ack the same list
    daily and stop acking at all — the midnight failure at monthly granularity,
    which is exactly what `month` must NOT be."""
    acks = _ack_for("blockers", _f(month="2026-08"))
    out = apply_wiring(SKILL, _out(blockers=[_f(month="2026-08")]), acks)
    assert out["blockers"] == []


# ── 5 · the amount voids where there is one ─────────────────────────────────

def test_an_advance_that_grows_comes_back():
    acks = _ack_for("warnings", _f(check="outstanding_advance", amount=5418.0))
    out = apply_wiring(SKILL, _out(warnings=[
        _f(check="outstanding_advance", amount=54180.0)]), acks)
    assert len(out["warnings"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_check_with_no_amount_is_acknowledged_unconditionally():
    """Five of the nine checks are binary facts — an employee has a salary
    structure or has not — so the key is absent and the ack does not expire
    within its month. Filling the field in removes the finding anyway."""
    f = _f()
    assert "amount" not in f
    out = apply_wiring(SKILL, _out(blockers=[f]), _ack_for("blockers", f))
    assert out["blockers"] == []


def test_neither_bucket_reads_a_field_that_ticks():
    assert set(WIRING.identity_of(_f())) == {"month", "check", "employee_code"}
    assert set(WIRING.material_of(_f())) == {"amount"}


# ── 6 · the counts span both lists ──────────────────────────────────────────

def test_the_counts_are_rebuilt_from_both_lists():
    """The case the mapping form of `recompute` exists for. A payroll screen
    reporting four blockers above a list of two is the reports-page defect in
    front of somebody about to pay ninety-seven people."""
    b1, b2 = _f(code="EMP-1"), _f(code="EMP-2")
    w1 = _f(check="outstanding_advance", code="EMP-3", amount=100.0)
    out = apply_wiring(SKILL, _out(blockers=[b1, b2], warnings=[w1]),
                       {**_ack_for("blockers", b1), **_ack_for("warnings", w1)})
    assert out["counts"] == {"blockers": 1, "warnings": 0}
    assert out["counts"]["blockers"] == len(out["blockers"])
    assert out["counts"]["warnings"] == len(out["warnings"])


def test_acknowledging_everything_leaves_zeroes_not_stale_counts():
    b = _f()
    out = apply_wiring(SKILL, _out(blockers=[b]), _ack_for("blockers", b))
    assert out["counts"] == {"blockers": 0, "warnings": 0}


# ── 7 · degenerate shapes ───────────────────────────────────────────────────

def test_a_finding_with_no_employee_code_does_not_raise():
    """Zero live findings lack a code, and `run_already_locked` legitimately
    has none. Neither may raise: the finding degrades to a key of its own."""
    out = apply_wiring(SKILL, _out(blockers=[_f(code=None)]), _ack_for("blockers", _f()))
    assert len(out["blockers"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    b = _f()
    data = {"month": "2026-08", "blockers": [b], "counts": {"blockers": 1}}
    out = apply_wiring(SKILL, data, _ack_for("blockers", b))
    assert len(out["blockers"]) == 1
    assert "acknowledged" not in out


def test_the_handed_back_key_round_trips_from_either_list():
    first = apply_wiring(SKILL, _out(blockers=[_f()], warnings=[_f(check="w")]),
                         {"x": skill_ack.Ack("x")})
    for bucket in ("blockers", "warnings"):
        f = first[bucket][0]
        acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                             state_hash=f["_ack_state"],
                                             acknowledged_by="u1")}
        again = apply_wiring(SKILL, _out(blockers=[_f()], warnings=[_f(check="w")]), acks)
        assert again[bucket] == []


# ── 8 · the handler really emits what the wiring reads ──────────────────────

def test_the_handler_emits_the_identity_fields_it_is_keyed_on():
    """A source read, because the alternative is a mock pool — and a MagicMock
    echoes fixtures back over SQL that does not run. The live probe is in the
    commit message; this is the ratchet that keeps the fields there."""
    from pathlib import Path
    src = Path("services/skills/data/payroll_readiness.py").read_text(encoding="utf-8")
    assert '"month": month' in src
    assert '"employee_code": r["employee_code"]' in src
    assert "e2.employee_code" in src
