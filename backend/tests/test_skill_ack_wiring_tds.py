"""
check_tds_thresholds — four of five lists wired, and the fifth left alone on
purpose.

Crossing a TDS threshold is a fact about the financial year: starting to deduct
does not un-cross it, so the finding never resolves itself. The handler is also
honest that it usually cannot answer at all — no live org has both a section on
the vendor and a threshold in the calendar — which makes `unattributed` the list
a firm actually works through, vendor by vendor, deciding "this one needs no
section".

`below_the_threshold` is NOT wired. It is the reassurance list: nothing in it
asks anybody to do anything, and an acknowledge button on it would invite
somebody to silence the evidence that the check ran.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _buckets_of, _identity_for, apply_wiring

SKILL = "check_tds_thresholds"
W = ACK_WIRING[SKILL]


def _v(vid="v-1", vendor="Sharma Traders", section="194C", taxable=1200000.0,
       no_tds=9, fy="2026-27", **kw) -> dict:
    row = {
        "vendor_id": vid,
        "financial_year": fy,
        "vendor": vendor,
        "section": section,
        "credited_taxable_value": taxable,
        "credited_including_tax": round(taxable * 1.18, 2),
        "paid_in_year": 0.0,
        "documents": 14,
        "tds_recorded": 0.0,
        "documents_with_no_tds_recorded": no_tds,
        "email": "orders@sharmatraders.example",
        "link": "/ganit/vendors/v-1",
    }
    row.update(kw)
    return row


def _out(crossed=(), near=(), below=(), no_threshold=(), unattributed=()) -> dict:
    crossed, near = list(crossed), list(near)
    below, no_threshold, unattributed = list(below), list(no_threshold), list(unattributed)
    return {
        "as_at": "2026-08-23",
        "verdict": "could_not_check",
        "financial_year": "2026-27",
        "year_from": "2026-04-01",
        "year_to": "2027-03-31",
        "near_threshold_at": 0.9,
        "counts": {
            "vendors_total": 80,
            "vendors_with_a_recorded_section": 6,
            "vendors_with_activity_this_year": 41,
            "vendors_with_no_section": len(unattributed),
            "crossed": len(crossed),
            "within_the_last_10_percent": len(near),
            "below": len(below),
            "section_recorded_but_no_threshold": len(no_threshold),
            "expenses_in_year": 512,
            "expenses_linked_to_a_vendor": 380,
            "tds_recorded_total": 0.0,
            "could_not_check": 74,
            "capped_at": 200,
            "was_capped": False,
        },
        "crossed": crossed,
        "within_the_last_10_percent": near,
        "below_the_threshold": below,
        "section_recorded_but_no_threshold": no_threshold,
        "unattributed": unattributed,
        "limitations": ["`paid_in_year` is near-empty BY CONSTRUCTION."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_the_reassurance_list_is_not_wired():
    """`below_the_threshold` is the denominator this handler exists to protect.
    Filtering it would let somebody silence the evidence that the check ran."""
    assert "below_the_threshold" not in _buckets_of(W)
    assert set(_buckets_of(W)) == {"crossed", "within_the_last_10_percent",
                                   "section_recorded_but_no_threshold",
                                   "unattributed"}


def test_an_acknowledged_crossing_stops_being_reported():
    f = _v()
    out = apply_wiring(SKILL, _out(crossed=[f]), _ack("crossed", f))
    assert out["crossed"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Sharma Traders — 194C"


def test_an_unattributed_vendor_can_be_closed_one_at_a_time():
    """The list a firm actually works through: "this vendor needs no section"."""
    f = _v(section=None, why="no nature-of-payment section is recorded")
    out = apply_wiring(SKILL, _out(unattributed=[f]), _ack("unattributed", f))
    assert out["unattributed"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Sharma Traders — no section"


def test_two_vendors_sharing_a_name_are_two_findings():
    one, two = _v(vid="v-1"), _v(vid="v-2")
    out = apply_wiring(SKILL, _out(crossed=[one, two]), _ack("crossed", one))
    assert [f["vendor_id"] for f in out["crossed"]] == ["v-2"]


def test_the_next_financial_year_brings_the_vendor_back():
    acks = _ack("crossed", _v(fy="2026-27"))
    out = apply_wiring(SKILL, _out(crossed=[_v(fy="2027-28")]), acks)
    assert len(out["crossed"]) == 1


def test_correcting_the_section_does_not_orphan_the_acknowledgement():
    """The section is recorded ON the vendor, and correcting 194J to 194C has
    not made this a different vendor. The correction shows up as the threshold
    moving, which the list split already reports."""
    acks = _ack("crossed", _v(section="194J"))
    out = apply_wiring(SKILL, _out(crossed=[_v(section="194C")]), acks)
    assert out["crossed"] == []


def test_a_vendor_moving_from_near_to_crossed_is_orphaned():
    f = _v(vid="v-1")
    acks = _ack("within_the_last_10_percent", f)
    out = apply_wiring(SKILL, _out(crossed=[f]), acks)
    assert len(out["crossed"]) == 1


def test_more_credited_value_brings_it_back():
    acks = _ack("crossed", _v(taxable=1200000.0))
    out = apply_wiring(SKILL, _out(crossed=[_v(taxable=2400000.0)]), acks)
    assert len(out["crossed"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_documents_gaining_tds_brings_it_back():
    """A vendor who crossed and now has every document carrying TDS is in a
    materially different position from one who crossed with nine documents and
    nothing deducted."""
    acks = _ack("crossed", _v(no_tds=9))
    out = apply_wiring(SKILL, _out(crossed=[_v(no_tds=0, tds_recorded=12000.0)]), acks)
    assert len(out["crossed"]) == 1


def test_the_gross_and_paid_columns_are_not_hashed():
    """`credited_including_tax` sits beside the taxable value for
    reconciliation and is NOT the figure a threshold is tested on. And
    `paid_in_year` is "near-empty BY CONSTRUCTION" per the handler's own
    limitation, so hashing it would tie every ack to a column about to change
    meaning the moment somebody fixes it."""
    acks = _ack("crossed", _v())
    moved = _v(credited_including_tax=9999999.0, paid_in_year=500000.0, documents=99)
    assert apply_wiring(SKILL, _out(crossed=[moved]), acks)["crossed"] == []
    assert set(W.material_of(_v())) == {"credited_taxable_value",
                                        "documents_with_no_tds_recorded"}


def test_the_four_filtered_counts_are_rebuilt():
    c, n, u = _v(vid="v-c"), _v(vid="v-n"), _v(vid="v-u", section=None)
    out = apply_wiring(SKILL, _out(crossed=[c], near=[n], unattributed=[u]),
                       {**_ack("crossed", c), **_ack("unattributed", u)})
    assert out["counts"]["crossed"] == 0
    assert out["counts"]["within_the_last_10_percent"] == 1
    assert out["counts"]["vendors_with_no_section"] == 0
    assert out["counts"]["section_recorded_but_no_threshold"] == 0


def test_the_below_count_is_left_alone_because_its_list_is():
    below = [_v(vid="v-b1"), _v(vid="v-b2")]
    f = _v()
    out = apply_wiring(SKILL, _out(crossed=[f], below=below), _ack("crossed", f))
    assert out["counts"]["below"] == 2
    assert len(out["below_the_threshold"]) == 2
    # And no annotation was added to a list this wiring does not filter.
    assert "_ack_key" not in out["below_the_threshold"][0]


def test_the_population_and_could_not_check_are_left_alone():
    """`could_not_check` is what stops a `crossed` count of zero reading as an
    all-clear in an org where no section is recorded at all."""
    f = _v()
    out = apply_wiring(SKILL, _out(crossed=[f]), _ack("crossed", f))
    assert out["counts"]["could_not_check"] == 74
    assert out["counts"]["vendors_total"] == 80
    assert out["counts"]["expenses_linked_to_a_vendor"] == 380
    assert out["verdict"] == "could_not_check"


def test_a_finding_with_no_vendor_id_does_not_raise():
    out = apply_wiring(SKILL, _out(crossed=[_v(vendor_id=None)]), _ack("crossed", _v()))
    assert len(out["crossed"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _v()
    data = {"crossed": [f], "unattributed": [], "counts": {"crossed": 1}}
    out = apply_wiring(SKILL, data, _ack("crossed", f))
    assert len(out["crossed"]) == 1
    assert "acknowledged" not in out


def test_the_tds_key_round_trips():
    first = apply_wiring(SKILL, _out(crossed=[_v()]), {"x": skill_ack.Ack("x")})
    f = first["crossed"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(crossed=[_v()]), acks)["crossed"] == []


def test_the_handler_emits_the_financial_year_on_every_entry():
    from pathlib import Path
    src = Path("services/skills/data/vendor_compliance.py").read_text(encoding="utf-8")
    assert '"financial_year": fy,' in src
