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


# ══════════════════════════════════════════════════════════════════════════
# check_unfillable_orders — and the count that is NOT a sum over the findings
# ══════════════════════════════════════════════════════════════════════════

ORDERS = ACK_WIRING["check_unfillable_orders"]


def _line(order="SO-0031", verdict="short_now", qty=12.0) -> dict:
    return {
        "order": order,
        "status": "confirmed",
        "customer": "Sharma Traders",
        "order_date": "2026-08-01",
        "expected_delivery": "2026-08-20",
        "line": "Ledger Paper A4",
        "quantity_ordered": qty,
        "available_when_this_order_is_picked": 0.0,
        "verdict": verdict,
        "short_by": qty,
        "detail": "12 reams, and 0 left by the time this order is picked.",
    }


def _g(product="Ledger Paper A4", on_hand=0.0, shortfall=-12.0, lines=None) -> dict:
    return {
        "product": product,
        "unit": "ream",
        "is_service": False,
        "on_hand": on_hand,
        "stock_record_exists": True,
        "committed_on_open_orders": 12.0,
        "shortfall_after_all_open_orders": shortfall,
        "remaining_after_all_open_orders": shortfall,
        "lines": lines if lines is not None else [_line()],
    }


def _g_out(groups, fillable=37) -> dict:
    groups = list(groups)
    short_now = sum(1 for g in groups for l in g.get("lines", [])
                    if l["verdict"] == "short_now")
    short_after = sum(1 for g in groups for l in g.get("lines", [])
                      if l["verdict"] == "short_after_others")
    return {
        "what_this_is": "Open order lines measured against stock on hand.",
        "counts": {
            "short_now": short_now,
            "short_after_others": short_after,
            # Counted for EVERY line walked, including lines of products that
            # were never flagged. NOT a sum over `products`.
            "fillable": fillable,
            "products_short": len(groups),
            "open_orders": 44,
            "order_lines_examined": 210,
        },
        "products": groups,
        "coverage": {"open_order_lines": 214,
                     "lines_naming_a_catalogued_product": 210,
                     "lines_this_check_cannot_see": 4,
                     "lines_with_no_readable_quantity": 0,
                     "statuses_treated_as_open": ["draft", "confirmed"]},
        "excluded": {"lines_whose_stock_is_already_deducted": 6, "why": "..."},
        "caveats": [],
    }


def _g_ack(g: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(ORDERS.identity_of(g))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(ORDERS.material_of(g)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_short_product_stops_being_reported():
    g = _g()
    out = apply_wiring("check_unfillable_orders", _g_out([g]), _g_ack(g))
    assert out["products"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Ledger Paper A4 — short 12"


def test_a_new_order_deepening_the_shortfall_brings_it_back():
    """The line set is NOT in the key — a group is re-formed every run and the
    lines change whenever any order is raised, edited or fulfilled, so keying
    on them would orphan the ack on the first new order. The shortfall is where
    the order book gets its say: "I know we are short 12" must not silently
    cover being short 200."""
    acks = _g_ack(_g(shortfall=-12.0))
    out = apply_wiring("check_unfillable_orders",
                       _g_out([_g(shortfall=-200.0,
                                  lines=[_line(), _line(order="SO-0044")])]), acks)
    assert len(out["products"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_reordering_the_lines_alone_does_not_orphan_the_acknowledgement():
    acks = _g_ack(_g())
    out = apply_wiring("check_unfillable_orders",
                       _g_out([_g(lines=[_line(order="SO-0099")])]), acks)
    assert out["products"] == []


def test_the_two_shortage_counts_are_rebuilt():
    keep = _g(product="A", lines=[_line(verdict="short_after_others")])
    hide = _g(product="B", lines=[_line(), _line(order="SO-2")])
    out = apply_wiring("check_unfillable_orders", _g_out([keep, hide]), _g_ack(hide))
    assert out["counts"]["short_now"] == 0
    assert out["counts"]["short_after_others"] == 1
    assert out["counts"]["products_short"] == 1


def test_the_fillable_count_is_left_alone():
    """THE TRAP. `fillable` is counted for every line the handler walked,
    including lines of products never flagged. Rebuilding it from the survivors
    would silently redefine it as "fillable lines belonging to short products"
    — a different and much smaller number under an unchanged name."""
    g = _g()
    out = apply_wiring("check_unfillable_orders", _g_out([g], fillable=37), _g_ack(g))
    assert out["counts"]["fillable"] == 37


def test_the_order_denominators_are_left_alone():
    g = _g()
    out = apply_wiring("check_unfillable_orders", _g_out([g]), _g_ack(g))
    assert out["counts"]["open_orders"] == 44
    assert out["counts"]["order_lines_examined"] == 210
    assert out["coverage"]["lines_this_check_cannot_see"] == 4
    assert out["excluded"]["lines_whose_stock_is_already_deducted"] == 6


def test_a_group_with_no_lines_key_does_not_raise():
    bare = {"product": "A", "on_hand": 0.0, "shortfall_after_all_open_orders": -1.0}
    data = _g_out([_g(product="B")])
    data["products"] = [bare]
    out = apply_wiring("check_unfillable_orders", data, _g_ack(_g(product="B")))
    assert len(out["products"]) == 1
    assert out["counts"]["short_now"] == 0


def test_an_orders_shape_change_fails_open():
    data = {"groups": [_g()], "counts": {"products_short": 1}}
    out = apply_wiring("check_unfillable_orders", data, _g_ack(_g()))
    assert len(out["groups"]) == 1
    assert "acknowledged" not in out


def test_the_orders_key_round_trips():
    first = apply_wiring("check_unfillable_orders", _g_out([_g()]),
                         {"x": skill_ack.Ack("x")})
    f = first["products"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring("check_unfillable_orders", _g_out([_g()]), acks)["products"] == []
