"""
check_statutory_records_gate — the wiring whose identity was measured, not guessed.

The handler REPORTS and never blocks: UAN, ESI number and PAN are non-mandatory
fields here and always will be. That is exactly why the findings need
acknowledging — a firm whose contractor genuinely has no UAN cannot make the row
go away by doing the right thing, so it reads the same name every morning.

Two judgements are pinned below, and the first was settled against the live
database on 2026-08-23 rather than assumed:

  · the NAME IS NOT A KEY. The largest org carries three active employees called
    Myra Bansal, three called Tara Mehta, three called Navya Reddy — ten names
    duplicated three ways across 97 active employees. Keyed on the name, one
    acknowledgement would hide two colleagues' gaps.
  · `employee_code` IS a key. Same probe: 97 employees, zero blank codes, 97
    distinct (org, code) pairs.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

WIRING = ACK_WIRING["check_statutory_records_gate"]

CHECKS = ("pf_enabled_no_uan", "esi_enabled_no_number", "tds_deducted_no_pan")


def _finding(check="tds_deducted_no_pan", employee="Myra Bansal",
             code="EMP-0041", department="Audit", **kw) -> dict:
    """One finding in exactly the shape `check_statutory_records_gate` emits."""
    row = {
        "check": check,
        "employee": employee,
        "employee_code": code,
        "department": department,
        "detail": "tax of 4200 was deducted on the 2026-07 payslip and no PAN is on record",
        "email": "myra@example.com",
        "phone": "+91 98765 43210",
        "link": "/manav/employees/3f7c1a52-0b1e-4f8a-9d21-6a5b4c3d2e10",
    }
    if check == "tds_deducted_no_pan":
        row["payslip_month"] = "2026-07"
    row.update(kw)
    return row


def _out(findings) -> dict:
    """The handler's return shape, with the aggregates it really computes."""
    findings = list(findings)
    by_dept: dict[str, dict] = {}
    for f in findings:
        slot = by_dept.setdefault(f["department"],
                                  {"department": f["department"], "findings": 0})
        slot["findings"] += 1
        slot[f["check"]] = slot.get(f["check"], 0) + 1
    return {
        "as_at": "2026-08-23",
        "what_this_is": "Statutory identifiers missing for a deduction …",
        "findings": findings,
        "by_department": sorted(by_dept.values(),
                                key=lambda d: (-d["findings"], d["department"])),
        "counts": {c: sum(1 for f in findings if f["check"] == c) for c in CHECKS},
        # The denominators. "Found nothing" and "never ran" must not look alike.
        "coverage": {
            "active_employees": 97,
            "pf_enabled_checked": 71,
            "esi_enabled_checked": 40,
            "tds_deducted_checked": 59,
        },
        "why_the_pan_one_matters": "the deductor bears the shortfall",
        "caveats": [],
    }


def _ack_for(finding: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(WIRING.identity_of(finding))
    state = skill_ack.state_hash(WIRING.material_of(finding))
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", **kw)}


# ── 1 · it works at all ─────────────────────────────────────────────────────

def test_an_acknowledged_gap_stops_being_reported():
    f = _finding()
    out = apply_wiring("check_statutory_records_gate", _out([f]), _ack_for(f))
    assert out["findings"] == []
    assert out["acknowledged"]["items"][0]["label"] == "tds_deducted_no_pan — Myra Bansal"


# ── 2 · THE NAME IS NOT A KEY ───────────────────────────────────────────────

def test_two_colleagues_of_the_same_name_are_two_findings():
    """Measured live: three active employees share the name Myra Bansal in the
    largest org. Keyed on the name, acknowledging one person's missing PAN
    would hide the same gap for two colleagues — and the deductor bears the
    higher-rate shortfall for all three."""
    one = _finding(employee="Myra Bansal", code="EMP-0041")
    two = _finding(employee="Myra Bansal", code="EMP-0088")

    out = apply_wiring("check_statutory_records_gate", _out([one, two]), _ack_for(one))
    assert len(out["findings"]) == 1
    assert out["findings"][0]["employee_code"] == "EMP-0088"


def test_the_three_checks_about_one_person_are_three_decisions():
    """Acknowledging "this contractor has no UAN" must not also silence "tax
    was deducted and there is no PAN", which is the one that carries money."""
    uan = _finding(check="pf_enabled_no_uan")
    pan = _finding(check="tds_deducted_no_pan")
    out = apply_wiring("check_statutory_records_gate", _out([uan, pan]), _ack_for(uan))
    assert [f["check"] for f in out["findings"]] == ["tds_deducted_no_pan"]


def test_a_marriage_or_a_transfer_does_not_orphan_the_acknowledgement():
    """The printable name and the department are INCIDENTAL: a person who
    changes either has not changed what is missing from their record."""
    acks = _ack_for(_finding(employee="Myra Bansal", department="Audit"))
    out = apply_wiring("check_statutory_records_gate",
                       _out([_finding(employee="Myra Iyer", department="Tax")]), acks)
    assert out["findings"] == []


def test_rewording_the_detail_does_not_void_the_acknowledgement():
    """`detail` is prose and it embeds the deducted amount. Hashing it would
    tie every acknowledgement to a sentence's wording, so rephrasing one string
    in the SQL would void every ack every org holds."""
    acks = _ack_for(_finding())
    out = apply_wiring("check_statutory_records_gate",
                       _out([_finding(detail="no PAN on record; tax of 4200 deducted")]),
                       acks)
    assert out["findings"] == []


# ── 3 · the payslip month is an EVENT, not a clock ──────────────────────────

def test_a_later_payslip_brings_the_pan_gap_back():
    """`payslip_month` advances when a PAYROLL RUN HAPPENS, not with the
    calendar, and the event is exactly "more tax has been deducted at the
    higher rate since you acknowledged this". So an acknowledgement covers the
    month it was made about, and next month's run resurfaces it with real new
    money behind it."""
    acks = _ack_for(_finding(payslip_month="2026-07"))
    out = apply_wiring("check_statutory_records_gate",
                       _out([_finding(payslip_month="2026-08")]), acks)
    assert len(out["findings"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_the_same_payslip_month_keeps_the_acknowledgement():
    """The other half of the same rule: running the skill twice in one month
    must not resurrect anything. If it did, the user would ack the same list
    daily and stop acking at all."""
    acks = _ack_for(_finding(payslip_month="2026-07"))
    out = apply_wiring("check_statutory_records_gate",
                       _out([_finding(payslip_month="2026-07")]), acks)
    assert out["findings"] == []


def test_a_uan_gap_has_no_month_and_its_acknowledgement_is_permanent():
    """`payslip_month` is absent on the PF and ESI checks, so `material_of`
    hashes a None and the ack does not expire. Correct: a missing UAN is a
    static fact until somebody fills the field in, and filling it in removes
    the finding from the query entirely."""
    f = _finding(check="pf_enabled_no_uan")
    assert "payslip_month" not in f
    out = apply_wiring("check_statutory_records_gate", _out([f]), _ack_for(f))
    assert out["findings"] == []


def test_neither_bucket_reads_a_field_that_ticks():
    identity = WIRING.identity_of(_finding())
    material = WIRING.material_of(_finding())
    assert set(identity) == {"check", "employee_code"}
    assert set(material) == {"payslip_month"}


# ── 4 · the counts must not lie, the denominators must not move ─────────────

def test_the_counts_match_the_findings_actually_shown():
    keep = _finding(check="pf_enabled_no_uan", code="EMP-1")
    hide = _finding(check="tds_deducted_no_pan", code="EMP-2")
    out = apply_wiring("check_statutory_records_gate", _out([keep, hide]), _ack_for(hide))
    assert out["counts"] == {"pf_enabled_no_uan": 1, "esi_enabled_no_number": 0,
                             "tds_deducted_no_pan": 0}
    assert sum(out["counts"].values()) == len(out["findings"])


def test_every_check_code_survives_reaching_zero():
    """A count that dropped its key when the last finding was acknowledged
    would read as "this check was not run" — the same lie the coverage block
    exists to prevent."""
    f = _finding()
    out = apply_wiring("check_statutory_records_gate", _out([f]), _ack_for(f))
    assert set(out["counts"]) == set(CHECKS)
    assert out["counts"]["tds_deducted_no_pan"] == 0


def test_the_departmental_split_is_rebuilt():
    keep = _finding(code="EMP-1", department="Audit")
    hide = _finding(code="EMP-2", department="Tax")
    out = apply_wiring("check_statutory_records_gate", _out([keep, hide]), _ack_for(hide))
    assert out["by_department"] == [
        {"department": "Audit", "findings": 1, "tds_deducted_no_pan": 1}]


def test_acknowledging_everything_empties_the_split_rather_than_leaving_it():
    f = _finding()
    out = apply_wiring("check_statutory_records_gate", _out([f]), _ack_for(f))
    assert out["by_department"] == []


def test_the_coverage_denominators_are_left_alone():
    """`coverage` exists so that "found nothing" and "never ran" cannot look
    alike on a compliance page. An org that acknowledged every finding has not
    thereby stopped having 59 employees with tax deducted."""
    f = _finding()
    out = apply_wiring("check_statutory_records_gate", _out([f]), _ack_for(f))
    assert out["coverage"] == {"active_employees": 97, "pf_enabled_checked": 71,
                               "esi_enabled_checked": 40, "tds_deducted_checked": 59}


# ── 5 · the degenerate shapes ───────────────────────────────────────────────

def test_a_finding_with_no_employee_code_does_not_raise():
    """Zero live rows have a blank code, but a shape change is not an
    exception: the finding degrades to a key nothing was filed under."""
    acks = _ack_for(_finding())
    out = apply_wiring("check_statutory_records_gate",
                       _out([_finding(code=None, department="Audit")]), acks)
    assert len(out["findings"]) == 1


def test_a_shape_change_fails_open_not_closed():
    data = {"gaps": [_finding()], "counts": {"tds_deducted_no_pan": 1}}
    out = apply_wiring("check_statutory_records_gate", data, _ack_for(_finding()))
    assert len(out["gaps"]) == 1
    assert out["counts"]["tds_deducted_no_pan"] == 1
    assert "acknowledged" not in out


def test_the_handed_back_key_round_trips():
    first = apply_wiring("check_statutory_records_gate", _out([_finding()]),
                         {"x": skill_ack.Ack("x")})
    f = first["findings"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring("check_statutory_records_gate",
                        _out([_finding()]), acks)["findings"] == []
