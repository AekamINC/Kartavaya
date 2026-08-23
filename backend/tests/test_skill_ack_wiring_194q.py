"""
check_194q_approaching — two lists, an annual threshold, and a vendor name that
is measurably not unique.

A vendor who has crossed the Rs 50 lakh line stays crossed for the rest of the
financial year, so the finding cannot be resolved: the only thing a firm can do
is start deducting, and the product has no way to be told that they have.

The measurement behind the key: live 2026-08-23, 80 active vendors, TWO groups
sharing a name. That is the same blind spot `check_duplicate_vendor_bills`
reports rather than papers over, and 194Q failing means the DEDUCTOR bears the
tax — so a key that could silence a second vendor's position is not acceptable.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_194q_approaching"
W = ACK_WIRING[SKILL]
THRESHOLD = 5000000.0


def _v(vendor="Sharma Traders", vid="v-1", ytd=4600000.0, on_order=200000.0,
       fy="2026-04-01", **kw) -> dict:
    projected = round(ytd + on_order, 2)
    row = {
        "vendor_id": vid,
        "financial_year_from": fy,
        "vendor": vendor,
        "purchased_ytd": round(ytd, 2),
        "on_order": round(on_order, 2),
        "projected": projected,
        "threshold": THRESHOLD,
        "pct_of_threshold": round(projected / THRESHOLD * 100, 1),
        "crossed": ytd > THRESHOLD,
        "will_cross_on_current_orders": ytd <= THRESHOLD < projected,
        "indicative_tds": round(max(0.0, projected - THRESHOLD) * 0.001, 2),
        "basis": "purchase value including GST",
        "email": "orders@sharmatraders.example",
        "link": "/ganit/vendors/v-1",
    }
    row.update(kw)
    return row


def _out(past=(), approaching=()) -> dict:
    past, approaching = list(past), list(approaching)
    return {
        "as_at": "2026-08-23",
        "financial_year_from": "2026-04-01",
        "verdict": "checked",
        "threshold": THRESHOLD,
        "rate": 0.001,
        "basis": "purchase value including GST",
        "warn_from": 4000000.0,
        "counts": {
            "vendors_total": 80,
            "vendors_past_the_threshold": len(past),
            "vendors_approaching": len(approaching),
            "could_not_check": 12,
            "capped_at": 200,
            "was_capped": False,
        },
        "past_the_threshold": past,
        "approaching": approaching,
        "limitations": ["Nothing here asserts that the deduction applies."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_vendor_stops_being_reported():
    f = _v()
    out = apply_wiring(SKILL, _out(approaching=[f]), _ack("approaching", f))
    assert out["approaching"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Sharma Traders — 194Q"


def test_two_vendors_sharing_a_name_are_two_findings():
    """Measured live: two groups of active vendors share a name. Keyed on the
    name, one acknowledgement would silence a second vendor's 194Q position."""
    one, two = _v(vid="v-1"), _v(vid="v-2")
    out = apply_wiring(SKILL, _out(approaching=[one, two]), _ack("approaching", one))
    assert [f["vendor_id"] for f in out["approaching"]] == ["v-2"]


def test_a_renamed_vendor_does_not_orphan_the_acknowledgement():
    acks = _ack("approaching", _v(vendor="Sharma Traders"))
    out = apply_wiring(SKILL, _out(approaching=[_v(vendor="Sharma Traders Pvt Ltd")]), acks)
    assert out["approaching"] == []


def test_the_next_financial_year_brings_the_vendor_back():
    """The threshold is annual and every running total restarts on 1 April.
    Without the year in the key, an acknowledgement made in March would silence
    that vendor for the whole of the following year."""
    acks = _ack("approaching", _v(fy="2026-04-01"))
    out = apply_wiring(SKILL, _out(approaching=[_v(fy="2027-04-01")]), acks)
    assert len(out["approaching"]) == 1


def test_crossing_the_threshold_orphans_the_acknowledgement():
    """A vendor moves from `approaching` to `past_the_threshold` exactly once,
    and that is the one moment somebody must look again. The mechanism folds
    the list name into the key, so the crossing orphans the ack by itself."""
    approaching = _v(ytd=4600000.0)
    acks = _ack("approaching", approaching)
    crossed = _v(ytd=5200000.0, on_order=200000.0)
    out = apply_wiring(SKILL, _out(past=[crossed]), acks)
    assert len(out["past_the_threshold"]) == 1


def test_a_larger_projection_brings_it_back():
    acks = _ack("approaching", _v(ytd=4600000.0))
    out = apply_wiring(SKILL, _out(approaching=[_v(ytd=4900000.0)]), acks)
    assert len(out["approaching"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_turning_an_order_into_a_bill_does_not_void_the_acknowledgement():
    """`projected` is the only material field, and it is the right one on the
    statute: converting an order into a bill moves `purchased_ytd` and
    `on_order` in opposite directions and changes the exposure not at all.
    194Q does not care which of the two a rupee is sitting in."""
    acks = _ack("approaching", _v(ytd=4600000.0, on_order=200000.0))
    same_total = _v(ytd=4800000.0, on_order=0.0)
    assert apply_wiring(SKILL, _out(approaching=[same_total]), acks)["approaching"] == []


def test_neither_bucket_reads_a_derived_or_constant_field():
    identity = W.identity_of(_v())
    material = W.material_of(_v())
    assert set(identity) == {"vendor_id", "financial_year_from"}
    assert set(material) == {"projected"}


def test_the_two_counts_are_rebuilt_from_their_own_lists():
    p, a = _v(vid="v-p", ytd=5200000.0), _v(vid="v-a")
    out = apply_wiring(SKILL, _out(past=[p], approaching=[a]), _ack("approaching", a))
    assert out["counts"]["vendors_past_the_threshold"] == 1
    assert out["counts"]["vendors_approaching"] == 0


def test_the_vendor_population_is_left_alone():
    f = _v()
    out = apply_wiring(SKILL, _out(approaching=[f]), _ack("approaching", f))
    assert out["counts"]["vendors_total"] == 80
    assert out["counts"]["could_not_check"] == 12
    assert out["verdict"] == "checked"


def test_a_finding_with_no_vendor_id_does_not_raise():
    out = apply_wiring(SKILL, _out(approaching=[_v(vendor_id=None)]),
                       _ack("approaching", _v()))
    assert len(out["approaching"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _v()
    data = {"approaching": [f], "counts": {"vendors_approaching": 1}}
    out = apply_wiring(SKILL, data, _ack("approaching", f))
    assert len(out["approaching"]) == 1
    assert "acknowledged" not in out


def test_the_194q_key_round_trips():
    first = apply_wiring(SKILL, _out(approaching=[_v()]), {"x": skill_ack.Ack("x")})
    f = first["approaching"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(approaching=[_v()]), acks)["approaching"] == []


def test_the_handler_emits_the_identity_fields():
    from pathlib import Path
    src = Path("services/skills/data/procurement_ops.py").read_text(encoding="utf-8")
    assert 'entry["vendor_id"] = str(r["id"])' in src
    assert 'entry["financial_year_from"] = start.isoformat()' in src
