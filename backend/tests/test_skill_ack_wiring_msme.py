"""
check_msme_payment_clock — three lists, money summed from only one of them, and
the entry where the drift guard would NOT have saved anybody.

A breach of the MSMED s.15 window costs the deduction and interest at three
times the bank rate. Nothing the firm does inside this product closes the
finding except paying, which this skill cannot record, so the same bills return
every run — including the ones already disputed, already scheduled, or already
settled by a route the ledger does not know about.

Two properties carry the risk:

  · `age_in_days` and `days_past_the_window` tick with the calendar and NEITHER
    SPELLING IS IN `skill_ack._DRIFT_FIELDS`. The exception would not fire. They
    are kept out of both hashes by reasoning, and pinned here, because the guard
    is a list of names somebody wrote down rather than a law of nature.
  · `amount_at_risk` is summed over `past_the_window` ALONE. Rebuilding it from
    all three surviving lists would add bills that are not in breach to a figure
    whose name says they are.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_msme_payment_clock"
W = ACK_WIRING[SKILL]


def _b(bill_id="b-1", bill="INV-2291", outstanding=69030.0, taxable=58500.0,
       status="unpaid", age=61, past=16, **kw) -> dict:
    row = {
        "bill_id": bill_id,
        "bill": bill,
        "vendor": "Sharma Traders",
        "enterprise_class": "small",
        "vendor_kind": "manufacturer",
        "udyam_number": "UDYAM-MH-01-0000001",
        "bill_date": "2026-06-01",
        "acceptance_date": None,
        "clock_started_from": "bill date",
        "clock_started_on": "2026-06-01",
        "age_in_days": age,
        "agreed_terms_days": None,
        "window_applied_days": 45,
        "leg": "no written agreement recorded",
        "pay_by": "2026-07-16",
        "days_past_the_window": past,
        "outstanding_including_tax": outstanding,
        "taxable_value": taxable,
        "status": status,
    }
    row.update(kw)
    return row


def _out(past=(), inside=(), unclassified=()) -> dict:
    past, inside, unclassified = list(past), list(inside), list(unclassified)
    return {
        "as_at": "2026-08-23",
        "verdict": "checked",
        "section": "MSMED s.15",
        "statute": "…",
        "counts": {
            "vendors_total": 80,
            "vendors_active": 80,
            "enterprise_class_recorded": 12,
            "open_bills_total": 189,
            "bills_in_scope": len(past) + len(inside) + len(unclassified),
            "bills_past_the_window": len(past),
            "bills_inside_the_window": len(inside),
            "bills_not_classified": len(unclassified),
            "could_not_check": 68,
            "capped_at": 200,
            "was_capped": False,
        },
        "amount_at_risk": {
            "outstanding_including_tax": round(
                sum(e["outstanding_including_tax"] for e in past), 2),
            "taxable_value_of_breached_bills": round(
                sum(e["taxable_value"] for e in past), 2),
            "basis": "a ceiling, not a computed add-back",
        },
        "past_the_window": past,
        "inside_the_window": inside,
        "not_classified": unclassified,
        "limitations": ["The window is a ceiling, not a computed add-back."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_breach_stops_being_reported():
    f = _b()
    out = apply_wiring(SKILL, _out(past=[f]), _ack("past_the_window", f))
    assert out["past_the_window"] == []
    assert out["acknowledged"]["items"][0]["label"] == "INV-2291 — Sharma Traders"


def test_a_bill_in_each_list_is_acknowledged_separately():
    p, i, u = _b(bill_id="b-p"), _b(bill_id="b-i"), _b(bill_id="b-u")
    out = apply_wiring(SKILL, _out(past=[p], inside=[i], unclassified=[u]),
                       _ack("inside_the_window", i))
    assert out["inside_the_window"] == []
    assert len(out["past_the_window"]) == 1
    assert len(out["not_classified"]) == 1


def test_the_window_closing_orphans_the_acknowledgement():
    """"I know, it is due next week" is not "I know, we are in breach". A bill
    moving from `inside_the_window` to `past_the_window` must come back."""
    b = _b(bill_id="b-1")
    acks = _ack("inside_the_window", b)
    out = apply_wiring(SKILL, _out(past=[b]), acks)
    assert len(out["past_the_window"]) == 1


# ── THE DRIFT GUARD WOULD NOT HAVE FIRED ────────────────────────────────────

def test_the_two_day_counters_are_in_neither_hash():
    """`age_in_days` and `days_past_the_window` are not in `_DRIFT_FIELDS` —
    that frozenset holds `age_days`, `days_past`, `days_past_due` and
    `days_overdue`, and these are none of them. Nothing would have raised."""
    assert "age_in_days" not in skill_ack._DRIFT_FIELDS
    assert "days_past_the_window" not in skill_ack._DRIFT_FIELDS
    assert set(W.identity_of(_b())) == {"bill_id"}
    assert set(W.material_of(_b())) == {"outstanding_including_tax", "status"}


def test_the_clock_ticking_does_not_void_the_acknowledgement():
    acks = _ack("past_the_window", _b(age=61, past=16))
    out = apply_wiring(SKILL, _out(past=[_b(age=104, past=59)]), acks)
    assert out["past_the_window"] == [], (
        "the acknowledgement died because the day counters ticked — check that "
        "age_in_days and days_past_the_window are in NEITHER hash")


def test_a_corrected_supplier_number_does_not_orphan_the_acknowledgement():
    """`bill` is the supplier's own number and can be corrected. The key is the
    bill ROW, which this handler has and `propose_payment_run` does not."""
    acks = _ack("past_the_window", _b(bill="INV-2291"))
    out = apply_wiring(SKILL, _out(past=[_b(bill="INV-2291-A")]), acks)
    assert out["past_the_window"] == []


def test_a_part_payment_brings_the_breach_back():
    acks = _ack("past_the_window", _b(outstanding=69030.0))
    out = apply_wiring(SKILL, _out(past=[_b(outstanding=30000.0)]), acks)
    assert len(out["past_the_window"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_status_change_brings_the_breach_back():
    acks = _ack("past_the_window", _b(status="unpaid"))
    out = apply_wiring(SKILL, _out(past=[_b(status="on_hold")]), acks)
    assert len(out["past_the_window"]) == 1


# ── the money comes from ONE list ───────────────────────────────────────────

def test_the_amount_at_risk_matches_the_breaches_actually_shown():
    keep = _b(bill_id="b-1", outstanding=1000.0, taxable=900.0)
    hide = _b(bill_id="b-2", outstanding=9000.0, taxable=8000.0)
    out = apply_wiring(SKILL, _out(past=[keep, hide]), _ack("past_the_window", hide))
    assert out["amount_at_risk"]["outstanding_including_tax"] == 1000.0
    assert out["amount_at_risk"]["taxable_value_of_breached_bills"] == 900.0
    assert out["counts"]["bills_past_the_window"] == 1


def test_bills_inside_the_window_never_reach_the_money_at_risk():
    """The asymmetry this recompute is written by hand for: a bill that is not
    in breach must not be added to a figure whose name says it is."""
    breach = _b(bill_id="b-1", outstanding=1000.0, taxable=900.0)
    inside = _b(bill_id="b-2", outstanding=500000.0, taxable=450000.0)
    out = apply_wiring(SKILL, _out(past=[breach], inside=[inside]),
                       _ack("not_classified", _b(bill_id="b-x")))
    assert out["amount_at_risk"]["outstanding_including_tax"] == 1000.0


def test_acknowledging_every_breach_leaves_zero_at_risk():
    f = _b()
    out = apply_wiring(SKILL, _out(past=[f]), _ack("past_the_window", f))
    assert out["amount_at_risk"]["outstanding_including_tax"] == 0.0
    assert out["amount_at_risk"]["taxable_value_of_breached_bills"] == 0.0
    assert out["amount_at_risk"]["basis"] == "a ceiling, not a computed add-back"


def test_the_vendor_population_and_could_not_check_are_left_alone():
    """`could_not_check` is the number the handler wrote a paragraph to defend:
    vendors never tested against the section at all."""
    f = _b()
    out = apply_wiring(SKILL, _out(past=[f]), _ack("past_the_window", f))
    assert out["counts"]["could_not_check"] == 68
    assert out["counts"]["vendors_total"] == 80
    assert out["counts"]["open_bills_total"] == 189


def test_a_malformed_amount_does_not_break_the_rebuild():
    good = _b(bill_id="b-1", outstanding=1000.0, taxable=900.0)
    bad = _b(bill_id="b-2", outstanding=None, taxable="x")
    data = _out(past=[good])
    data["past_the_window"] = [good, bad]
    out = apply_wiring(SKILL, data, _ack("past_the_window", _b(bill_id="b-z")))
    assert out["amount_at_risk"]["outstanding_including_tax"] == 1000.0


def test_a_finding_with_no_bill_id_does_not_raise():
    out = apply_wiring(SKILL, _out(past=[_b(bill_id=None)]), _ack("past_the_window", _b()))
    assert len(out["past_the_window"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _b()
    data = {"past_the_window": [f], "inside_the_window": [], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("past_the_window", f))
    assert len(out["past_the_window"]) == 1
    assert "acknowledged" not in out


def test_the_msme_key_round_trips():
    first = apply_wiring(SKILL, _out(past=[_b()]), {"x": skill_ack.Ack("x")})
    f = first["past_the_window"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(past=[_b()]), acks)["past_the_window"] == []
