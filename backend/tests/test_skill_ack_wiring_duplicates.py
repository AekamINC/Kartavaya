"""
check_duplicate_vendor_bills — the strongest case for an acknowledgement, and
the three ways its key could have been silently wrong.

This skill reports a PAIR that is *probably* one bill entered twice. The
commonest verdict a person reaches is "no — the supplier really did send two
identical invoices that week", and nothing records that verdict, so the pair
matches the same matchers next run and the run after. It is also the one list
whose whole job is to run BEFORE the payment run, so a firm that has stopped
opening it is a firm about to pay a duplicate.

The three traps, each pinned by name below:

  · the PLACEHOLDER. A bill with no supplier number renders as "(no supplier
    number recorded)" — the same string on every such row. Key on `bill_number`
    first and two unrelated unnumbered pairs share one finding_key.
  · the SWAP. `first` is the earlier bill by date, so correcting a mistyped
    date can exchange the two sides of an otherwise unchanged pair.
  · the STRINGIFIED AMOUNT. Sorting the two sides needs a comparable key, and
    the obvious way to get one — `str()` on every field — would defeat
    `_canon`'s Decimal normalisation and void every ack the day a handler
    returned a Decimal where it once returned a float.
"""
from __future__ import annotations

from decimal import Decimal

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

WIRING = ACK_WIRING["check_duplicate_vendor_bills"]


def _side(ref="VB-0001", number="INV-88", total=69030.0, paid=0.0,
          status="unpaid", bill_date="2026-07-04") -> dict:
    return {
        "bill_number": number,
        "internal_ref": ref,
        "bill_date": bill_date,
        "total": total,
        "already_paid": paid,
        "status": status,
    }


def _pair(first=None, second=None, **kw) -> dict:
    """One finding in exactly the shape `check_duplicate_vendor_bills` emits."""
    row = {
        "matcher": "same_supplier_invoice_number",
        "confidence": "near-certain — the supplier's own invoice number …",
        "vendor": "Sharma Traders",
        "days_apart": 3,
        "amount": 69030.0,
        "currency": "INR",
        "first": first or _side(ref="VB-0001"),
        "second": second or _side(ref="VB-0002", bill_date="2026-07-07"),
    }
    row.update(kw)
    return row


def _out(pairs) -> dict:
    """The handler's return shape, with the counts it really computes."""
    pairs = list(pairs)
    by_matcher: dict[str, int] = {}
    at_risk = 0.0
    for p in pairs:
        by_matcher[p["matcher"]] = by_matcher.get(p["matcher"], 0) + 1
        at_risk += max(
            0.0,
            float(p["first"]["total"]) - float(p["first"]["already_paid"]),
            float(p["second"]["total"]) - float(p["second"]["already_paid"]),
        )
    return {
        "as_at": "2026-08-23",
        "windows": {"same_amount_days_apart": 7,
                    "same_amount_different_numbers": 45,
                    "bills_considered_from": "2026-06-01"},
        "pairs": pairs,
        "counts": {
            "pairs": len(pairs),
            "by_matcher": by_matcher,
            "amount_at_risk_if_every_pair_is_a_duplicate": round(at_risk, 2),
        },
        "blind_spots": {"vendors_sharing_a_name": []},
        "limitations": ["All three matchers group on the vendor RECORD."],
        "caveats": [],
    }


def _ack_for(pair: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(WIRING.identity_of(pair))
    state = skill_ack.state_hash(WIRING.material_of(pair))
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", **kw)}


# ── 1 · it works at all ─────────────────────────────────────────────────────

def test_an_acknowledged_pair_stops_being_reported():
    p = _pair()
    out = apply_wiring("check_duplicate_vendor_bills", _out([p]), _ack_for(p))
    assert out["pairs"] == []
    assert out["acknowledged"]["count"] == 1
    assert out["acknowledged"]["items"][0]["label"] == "VB-0001 / VB-0002 — Sharma Traders"


def test_no_ack_set_means_no_reshape():
    out = apply_wiring("check_duplicate_vendor_bills", _out([_pair()]), {})
    assert len(out["pairs"]) == 1
    assert "acknowledged" not in out


# ── 2 · THE PLACEHOLDER ─────────────────────────────────────────────────────

def test_two_unnumbered_pairs_do_not_share_one_key():
    """A bill with no supplier number renders as "(no supplier number
    recorded)" — the SAME string on every such row. Prefer `bill_number` over
    `internal_ref` in the key and the first acknowledgement hides the second
    pair, which is a duplicate payment nobody was shown."""
    missing = "(no supplier number recorded)"
    one = _pair(first=_side(ref="VB-0001", number=missing),
                second=_side(ref="VB-0002", number=missing))
    two = _pair(first=_side(ref="VB-0031", number=missing),
                second=_side(ref="VB-0032", number=missing))

    out = apply_wiring("check_duplicate_vendor_bills", _out([one, two]), _ack_for(one))
    assert len(out["pairs"]) == 1
    assert out["pairs"][0]["first"]["internal_ref"] == "VB-0031"


# ── 3 · THE SWAP ────────────────────────────────────────────────────────────

def test_correcting_a_bill_date_swaps_the_sides_and_keeps_the_acknowledgement():
    """`first` is the earlier bill by date. Correcting a mistyped date can
    exchange the two sides of an otherwise unchanged pair; keyed positionally
    that edit mints a new finding_key and orphans the ack, so the finding
    returns as though nobody ever touched it."""
    before = _pair(first=_side(ref="VB-0001", bill_date="2026-07-04"),
                   second=_side(ref="VB-0002", bill_date="2026-07-07"))
    acks = _ack_for(before)

    after = _pair(first=_side(ref="VB-0002", bill_date="2026-07-02"),
                  second=_side(ref="VB-0001", bill_date="2026-07-04"))
    out = apply_wiring("check_duplicate_vendor_bills", _out([after]), acks)
    assert out["pairs"] == [], (
        "the acknowledgement was orphaned by a date correction — identity_of "
        "must sort the pair rather than key on first/second positionally"
    )


# ── 4 · what must NOT re-key or void it ─────────────────────────────────────

def test_promoting_the_matcher_does_not_orphan_the_acknowledgement():
    """The matcher is a CLASSIFICATION of the pair and it moves on its own:
    filling in a missing supplier number promotes a pair from matcher 2 to
    matcher 1 without changing either bill's amount."""
    acks = _ack_for(_pair(matcher="same_amount_days_apart"))
    out = apply_wiring("check_duplicate_vendor_bills",
                       _out([_pair(matcher="same_supplier_invoice_number")]), acks)
    assert out["pairs"] == []


def test_a_renamed_vendor_does_not_orphan_the_acknowledgement():
    acks = _ack_for(_pair(vendor="Sharma Traders"))
    out = apply_wiring("check_duplicate_vendor_bills",
                       _out([_pair(vendor="Sharma Traders Pvt Ltd")]), acks)
    assert out["pairs"] == []


def test_the_wiring_reads_no_time_derived_field():
    """`days_apart` is the distance between two fixed dates and does not tick,
    but it is not in either bucket, and neither is `bill_date`. Asserted over
    the values the lambdas actually return, not over their source."""
    identity = WIRING.identity_of(_pair())
    material = WIRING.material_of(_pair())
    assert set(identity) == {"pair"}
    assert set(material) == {"sides"}
    for side in material["sides"]:
        assert set(side) == {"ref", "total", "already_paid", "status"}


# ── 5 · THE STRINGIFIED AMOUNT ──────────────────────────────────────────────

def test_the_same_money_spelled_three_ways_is_one_state():
    """`_canon` puts every number through `Decimal`, so 69030, 69030.0 and
    Decimal("69030.00") hash alike. Sorting the two sides needed a comparable
    key and the obvious way to get one — `str()` on every field — would defeat
    that, and void every acknowledgement this skill holds the day a handler
    returned a Decimal where it once returned a float."""
    ints = _pair(first=_side(ref="VB-0001", total=69030, paid=0),
                 second=_side(ref="VB-0002", total=69030, paid=0))
    decs = _pair(first=_side(ref="VB-0001", total=Decimal("69030.00"), paid=Decimal("0.00")),
                 second=_side(ref="VB-0002", total=69030.0, paid=0.0))
    assert (skill_ack.state_hash(WIRING.material_of(ints))
            == skill_ack.state_hash(WIRING.material_of(decs)))


# ── 6 · what MUST bring it back ─────────────────────────────────────────────

def test_a_pair_whose_amount_moves_comes_back():
    """69,030 twice was acknowledged. One side becoming 138,060 is a new
    situation wearing an old pair of references."""
    acks = _ack_for(_pair())
    grown = _pair(first=_side(ref="VB-0001", total=138060.0),
                  second=_side(ref="VB-0002"))
    out = apply_wiring("check_duplicate_vendor_bills", _out([grown]), acks)
    assert len(out["pairs"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_part_payment_on_either_side_brings_it_back():
    """There is no `balance_due` in this shape, so both `total` and
    `already_paid` are in MATERIAL. Money leaving against a pair somebody
    declared innocent is precisely the movement worth resurfacing."""
    acks = _ack_for(_pair())
    paid = _pair(first=_side(ref="VB-0001", paid=30000.0),
                 second=_side(ref="VB-0002"))
    assert len(apply_wiring("check_duplicate_vendor_bills", _out([paid]), acks)["pairs"]) == 1


def test_voiding_one_side_brings_it_back():
    acks = _ack_for(_pair())
    voided = _pair(first=_side(ref="VB-0001", status="cancelled"),
                   second=_side(ref="VB-0002"))
    assert len(apply_wiring("check_duplicate_vendor_bills", _out([voided]), acks)["pairs"]) == 1


# ── 7 · THE EXPOSURE MUST NOT LIE ───────────────────────────────────────────

def test_the_exposure_matches_the_pairs_actually_shown():
    """`amount_at_risk_if_every_pair_is_a_duplicate` is the number a reader
    acts on. Suppress a pair and leave it alone and the skill reports an
    exposure for pairs it is not showing."""
    keep = _pair(first=_side(ref="A1", total=1000.0), second=_side(ref="A2", total=1000.0))
    hide = _pair(first=_side(ref="B1", total=9000.0), second=_side(ref="B2", total=9000.0))
    out = apply_wiring("check_duplicate_vendor_bills", _out([keep, hide]), _ack_for(hide))

    assert [p["first"]["internal_ref"] for p in out["pairs"]] == ["A1"]
    assert out["counts"]["pairs"] == 1
    assert out["counts"]["amount_at_risk_if_every_pair_is_a_duplicate"] == 1000.0


def test_the_exposure_takes_the_larger_unpaid_side_and_never_both():
    """The handler's own rule, restated by the rebuild rather than re-derived:
    if a pair really is one bill entered twice, one of the two is genuinely
    owed and only the other is money leaving for nothing. Taking "the second"
    returned 0.00 on the live data's commonest shape — a paid bill and its
    unpaid twin."""
    settled_and_twin = _pair(
        first=_side(ref="C1", total=69030.0, paid=69030.0, status="paid"),
        second=_side(ref="C2", total=69030.0, paid=0.0))
    out = apply_wiring("check_duplicate_vendor_bills",
                       _out([settled_and_twin, _pair()]), _ack_for(_pair()))
    assert out["counts"]["amount_at_risk_if_every_pair_is_a_duplicate"] == 69030.0


def test_the_matcher_split_is_rebuilt_not_left_stale():
    a = _pair(matcher="same_supplier_invoice_number",
              first=_side(ref="A1"), second=_side(ref="A2"))
    b = _pair(matcher="same_amount_days_apart",
              first=_side(ref="B1"), second=_side(ref="B2"))
    out = apply_wiring("check_duplicate_vendor_bills", _out([a, b]), _ack_for(b))
    assert out["counts"]["by_matcher"] == {"same_supplier_invoice_number": 1}


def test_acknowledging_everything_leaves_a_zero_exposure_not_a_stale_one():
    p = _pair()
    out = apply_wiring("check_duplicate_vendor_bills", _out([p]), _ack_for(p))
    assert out["counts"]["pairs"] == 0
    assert out["counts"]["by_matcher"] == {}
    assert out["counts"]["amount_at_risk_if_every_pair_is_a_duplicate"] == 0.0


def test_the_blind_spots_are_left_alone():
    """`blind_spots` names vendors sharing one name — a measurement of what the
    matchers CANNOT see. It is not a sum over the findings and rebuilding it
    from them would delete the handler's own denominator."""
    p = _pair()
    data = _out([p])
    data["blind_spots"] = {"vendors_sharing_a_name": [{"name": "Sharma", "records": 2}]}
    out = apply_wiring("check_duplicate_vendor_bills", data, _ack_for(p))
    assert out["blind_spots"]["vendors_sharing_a_name"][0]["records"] == 2


# ── 8 · the degenerate shapes ───────────────────────────────────────────────

def test_a_pair_with_a_missing_side_does_not_raise():
    """A shape change is not an exception. The finding degrades to a key
    nothing was filed under and is shown."""
    acks = _ack_for(_pair())
    data = _out([])
    data["pairs"] = [{"matcher": "x", "vendor": "V",
                      "first": _side(ref="Z1"), "second": None}]
    out = apply_wiring("check_duplicate_vendor_bills", data, acks)
    assert len(out["pairs"]) == 1
    # And the rebuild survived the malformed side rather than failing the run:
    # the ack layer falls back to the UNFILTERED findings on any exception,
    # which would show every acknowledged pair again.
    assert out["counts"]["amount_at_risk_if_every_pair_is_a_duplicate"] == 69030.0


def test_a_shape_change_fails_open_not_closed():
    data = {"duplicates": [_pair()], "counts": {"pairs": 1}}
    out = apply_wiring("check_duplicate_vendor_bills", data, _ack_for(_pair()))
    assert len(out["duplicates"]) == 1
    assert out["counts"]["pairs"] == 1
    assert "acknowledged" not in out


def test_the_handed_back_key_round_trips():
    first = apply_wiring("check_duplicate_vendor_bills", _out([_pair()]),
                         {"x": skill_ack.Ack("x")})
    f = first["pairs"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring("check_duplicate_vendor_bills", _out([_pair()]), acks)["pairs"] == []
