"""
The stock wirings — `check_impossible_stock` and `check_unfillable_orders`.

Both key on the product NAME, which is unusual in this codebase and was
measured rather than assumed: live 2026-08-23, 106 active products, ZERO blank
names, ZERO duplicate names per org even case-insensitively.

`check_impossible_stock` is a finding that cannot be closed by fixing it — the
handler refuses to correct a negative balance, because "a negative quantity is
evidence, and zeroing it destroys the evidence" — so an acknowledgement is the
only way it ever leaves the list.

`check_unfillable_orders` carries the subtler recompute in the file: two of its
three verdict counts are sums over the findings list and the third is NOT.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring


# ══════════════════════════════════════════════════════════════════════════
# check_impossible_stock
# ══════════════════════════════════════════════════════════════════════════

STOCK = ACK_WIRING["check_impossible_stock"]


def _s(check="negative_on_hand", product="Ledger Paper A4", on_hand=-4.0,
       ledger_net=-4.0, confidence="confirmed", **kw) -> dict:
    row = {
        "product": product,
        "unit": "ream",
        "is_service": False,
        "product_is_active": True,
        "on_hand": on_hand,
        "movement_ledger_net": ledger_net,
        "movements_recorded": 12,
        "first_movement": "2026-01-04",
        "last_movement": "2026-08-01",
        "implied_opening_balance": round(on_hand - ledger_net, 4),
        "movement_ledger_explains_the_balance": True,
        "check": check,
        "confidence": confidence,
        "detail": "-4 on hand. A balance below zero is not a low stock level.",
    }
    row.update(kw)
    return row


def _s_out(findings) -> dict:
    findings = list(findings)
    confirmed = sum(1 for f in findings if f["confidence"] == "confirmed")
    return {
        "what_this_is": "CONFIRMED means the movement ledger accounts …",
        "counts": {
            "negative_on_hand": sum(1 for f in findings if f["check"] == "negative_on_hand"),
            "went_negative": sum(1 for f in findings if f["check"] == "went_negative"),
            "never_received": sum(1 for f in findings if f["check"] == "never_received"),
            # NOT a sum over the list: every product the query examined.
            "products_flagged": 9,
            "findings": len(findings),
            "confirmed": confirmed,
            "unverified": len(findings) - confirmed,
        },
        "findings": findings,
        "coverage": {"stock_rows": 106, "movement_rows": 4120,
                     "products_whose_ledger_disagrees_with_their_balance": 3},
        "not_checked": ["Nothing here is valued."],
        "caveats": [],
    }


def _s_ack(f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(STOCK.identity_of(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(STOCK.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_impossible_balance_stops_being_reported():
    f = _s()
    out = apply_wiring("check_impossible_stock", _s_out([f]), _s_ack(f))
    assert out["findings"] == []
    assert out["acknowledged"]["items"][0]["label"] == "negative_on_hand — Ledger Paper A4"


def test_the_three_checks_about_one_product_are_three_decisions():
    """"I know this balance is negative, it is a data-loading artefact" must
    not silence "something was issued that was never received in"."""
    neg = _s(check="negative_on_hand")
    never = _s(check="never_received")
    out = apply_wiring("check_impossible_stock", _s_out([neg, never]), _s_ack(neg))
    assert [f["check"] for f in out["findings"]] == ["never_received"]


def test_a_deeper_negative_comes_back():
    """A balance of −4 acknowledged is not a balance of −400: the second is a
    different accident."""
    acks = _s_ack(_s(on_hand=-4.0, ledger_net=-4.0))
    out = apply_wiring("check_impossible_stock",
                       _s_out([_s(on_hand=-400.0, ledger_net=-400.0)]), acks)
    assert len(out["findings"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_backfilled_movement_does_not_void_the_acknowledgement():
    """`confidence` is derived from whether the ledger explains the balance and
    flips when an unrelated movement is backfilled — a classification moving
    under a finding that did not change. `first_movement`, `last_movement` and
    `detail` are incidental for the same reason."""
    acks = _s_ack(_s(confidence="confirmed"))
    out = apply_wiring("check_impossible_stock", _s_out([
        _s(confidence="unverified", last_movement="2026-08-22",
           movements_recorded=13, detail="reworded")]), acks)
    assert out["findings"] == []


def test_the_counts_and_the_split_are_rebuilt():
    keep = _s(product="A", check="went_negative", confidence="unverified")
    hide = _s(product="B", check="negative_on_hand", confidence="confirmed")
    out = apply_wiring("check_impossible_stock", _s_out([keep, hide]), _s_ack(hide))
    assert out["counts"]["negative_on_hand"] == 0
    assert out["counts"]["went_negative"] == 1
    assert out["counts"]["findings"] == 1
    assert out["counts"]["confirmed"] == 0
    assert out["counts"]["unverified"] == 1


def test_the_population_and_coverage_are_left_alone():
    """`products_flagged` is every product the query examined, not every
    product listed. An org that acknowledged every impossible balance has not
    stopped having a movement ledger that disagrees with its stock table."""
    f = _s()
    out = apply_wiring("check_impossible_stock", _s_out([f]), _s_ack(f))
    assert out["counts"]["products_flagged"] == 9
    assert out["coverage"]["products_whose_ledger_disagrees_with_their_balance"] == 3


def test_a_stock_finding_with_no_product_does_not_raise():
    out = apply_wiring("check_impossible_stock",
                       _s_out([_s(product=None)]), _s_ack(_s()))
    assert len(out["findings"]) == 1


def test_a_stock_shape_change_fails_open():
    data = {"rows": [_s()], "counts": {"findings": 1}}
    out = apply_wiring("check_impossible_stock", data, _s_ack(_s()))
    assert len(out["rows"]) == 1
    assert "acknowledged" not in out


def test_the_stock_key_round_trips():
    first = apply_wiring("check_impossible_stock", _s_out([_s()]),
                         {"x": skill_ack.Ack("x")})
    f = first["findings"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring("check_impossible_stock", _s_out([_s()]), acks)["findings"] == []
