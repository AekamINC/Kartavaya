"""
The procurement wirings, and the null that would have collapsed them.

`services/skills/data/procurement_ops.py` reads `staging.ganit_purchase_orders`,
whose `po_number` is NULLABLE by design — migration 197 leaves it NULL until the
order is ISSUED, because a serial spent on a draft is a gap in a numbered
series. An identity over a null number would give every draft the same
`finding_key`, and the first acknowledgement would hide all of them.

The wirings key on `purchase_order` anyway, and they are correct because the
handlers filter `status = ANY(OPEN_STATUSES)` and that frozenset contains no
draft. That is a correctness argument that lives in a different module, so it is
pinned here: widening `OPEN_STATUSES` fails this file rather than silently
hiding orders in production.
"""
from __future__ import annotations

import pytest

from services import skill_ack
from services.purchase_orders import OPEN_STATUSES
from services.skill_ack_wiring import ACK_WIRING, apply_wiring


# ── the constant these wirings depend on ────────────────────────────────────

def test_no_procurement_skill_can_ever_see_an_unnumbered_order():
    """`po_number` is NULL until issue. Both procurement wirings key on it, so
    a draft reaching either handler would collapse every draft into one
    finding_key. `OPEN_STATUSES` is what stops that, in another module."""
    assert "draft" not in OPEN_STATUSES
    assert OPEN_STATUSES == {"issued", "part_received", "received"}, (
        "OPEN_STATUSES changed. If an unnumbered status is now in scope, "
        "check_late_suppliers and check_received_not_invoiced key on a NULL "
        "po_number and one acknowledgement will hide every such order. See "
        "services/skill_ack_wiring.py."
    )


# ══════════════════════════════════════════════════════════════════════════
# check_late_suppliers
# ══════════════════════════════════════════════════════════════════════════

WIRING = ACK_WIRING["check_late_suppliers"]


def _late(**kw) -> dict:
    """One finding in exactly the shape `check_late_suppliers` emits."""
    row = {
        "purchase_order": "PO-2026-0031",
        "vendor": "Sharma Traders",
        "expected_on": "2026-08-01",
        "days_late": 22,
        "qty_outstanding": 3.0,
        "order_value": 40000.0,
        "currency": "INR",
        "email": "orders@sharmatraders.example",
        "phone": "+91 98765 43210",
        "link": "/ganit/vendors/3f7c1a52-0b1e-4f8a-9d21-6a5b4c3d2e10",
    }
    row.update(kw)
    return row


def _late_out(findings) -> dict:
    """The handler's return shape, with the counts it really computes.

    `orders_total`, `orders_open`, `open_without_an_expected_date` and
    `could_not_check` come from a SEPARATE count query over the whole
    population — they are not sums over this list, and the denominator rule
    this handler is built on depends on them staying that way.
    """
    findings = list(findings)
    return {
        "as_at": "2026-08-23",
        "verdict": "checked",
        "counts": {
            "orders_total": 40,
            "orders_open": 12,
            "orders_late": len(findings),
            "open_without_an_expected_date": 4,
            "could_not_check": 4,
            "capped_at": 200,
            "was_capped": False,
        },
        "late": findings,
        "limitations": ["Lateness is measured against the order's own expected date."],
    }


def _ack_for(finding: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(WIRING.identity_of(finding))
    state = skill_ack.state_hash(WIRING.material_of(finding))
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_order_stops_being_reported():
    f = _late()
    out = apply_wiring("check_late_suppliers", _late_out([f]), _ack_for(f))
    assert out["late"] == []
    assert out["acknowledged"]["count"] == 1
    assert out["acknowledged"]["items"][0]["label"] == "PO-2026-0031 — Sharma Traders"


def test_the_day_counter_ticking_does_not_void_the_acknowledgement():
    """`days_late` is the field this skill sorts on and it moves every night.
    In IDENTITY it would mint a new key daily; in MATERIAL it would void every
    ack at midnight. The user acks a supplier who promised next Tuesday and
    finds them back on Wednesday's list regardless."""
    acks = _ack_for(_late(days_late=22))
    out = apply_wiring("check_late_suppliers", _late_out([_late(days_late=51)]), acks)
    assert out["late"] == [], (
        "the acknowledgement died because days_late ticked — check that it is "
        "in NEITHER identity_of nor material_of"
    )


def test_more_goods_outstanding_brings_it_back():
    """Three units outstanding was acknowledged. Six is a new situation wearing
    an old number — a receipt reversed, or a line quantity raised."""
    acks = _ack_for(_late(qty_outstanding=3.0))
    out = apply_wiring("check_late_suppliers", _late_out([_late(qty_outstanding=6.0)]), acks)
    assert len(out["late"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_an_amended_order_value_brings_it_back():
    acks = _ack_for(_late(order_value=40000.0))
    out = apply_wiring("check_late_suppliers", _late_out([_late(order_value=90000.0)]), acks)
    assert len(out["late"]) == 1


def test_a_renamed_vendor_does_not_orphan_the_acknowledgement():
    """The vendor name is joined from `ganit_vendors`. Had it been in IDENTITY,
    renaming or replacing a vendor record would silently re-key every one of
    that vendor's orders — the trap `propose_payment_run` documents."""
    acks = _ack_for(_late(vendor="Sharma Traders"))
    out = apply_wiring("check_late_suppliers",
                       _late_out([_late(vendor="Sharma Traders Pvt Ltd")]), acks)
    assert out["late"] == []


def test_a_moved_expected_date_does_not_orphan_the_acknowledgement():
    """`expected_on` is INCIDENTAL, and deliberately: moving it forward removes
    the finding from the query altogether, and moving it backwards changes
    nothing about what is outstanding."""
    acks = _ack_for(_late(expected_on="2026-08-01"))
    out = apply_wiring("check_late_suppliers",
                       _late_out([_late(expected_on="2026-07-20")]), acks)
    assert out["late"] == []


# ── the count must not lie, and the denominators must not move ──────────────

def test_the_late_count_matches_the_orders_actually_shown():
    keep, hide = _late(purchase_order="PO-1"), _late(purchase_order="PO-2")
    out = apply_wiring("check_late_suppliers", _late_out([keep, hide]), _ack_for(hide))
    assert [o["purchase_order"] for o in out["late"]] == ["PO-1"]
    assert out["counts"]["orders_late"] == 1


def test_the_denominators_are_left_alone():
    """`could_not_check` and the population counts are measured against the
    whole book by a separate query. Rebuilding them from the surviving findings
    would turn the denominator rule this handler exists for into a lie — an org
    with no purchase orders is not an org with no late suppliers."""
    f = _late()
    out = apply_wiring("check_late_suppliers", _late_out([f]), _ack_for(f))
    assert out["counts"]["orders_total"] == 40
    assert out["counts"]["orders_open"] == 12
    assert out["counts"]["open_without_an_expected_date"] == 4
    assert out["counts"]["could_not_check"] == 4
    assert out["verdict"] == "checked"


def test_acknowledging_everything_leaves_a_zero_count_not_a_stale_one():
    f = _late()
    out = apply_wiring("check_late_suppliers", _late_out([f]), _ack_for(f))
    assert out["counts"]["orders_late"] == 0


def test_a_return_shape_with_no_counts_block_does_not_raise():
    """The recompute writes into `counts` and must survive a handler that stops
    returning one. Losing the count is a nuisance; losing the run is not."""
    f = _late()
    data = {"late": [f], "verdict": "checked"}
    out = apply_wiring("check_late_suppliers", data, _ack_for(f))
    assert out["late"] == []


# ── the degenerate shapes ───────────────────────────────────────────────────

def test_a_finding_with_no_order_number_does_not_raise():
    """It cannot happen — `OPEN_STATUSES` excludes drafts and only a draft
    lacks a number — but a shape change is not an exception. The finding
    survives and is shown."""
    acks = _ack_for(_late())
    out = apply_wiring("check_late_suppliers", _late_out([{"vendor": "X"}]), acks)
    assert len(out["late"]) == 1


def test_a_shape_change_fails_open_not_closed():
    f = _late()
    data = {"orders": [_late()], "counts": {"orders_late": 1}}
    out = apply_wiring("check_late_suppliers", data, _ack_for(f))
    assert len(out["orders"]) == 1
    assert "acknowledged" not in out
    assert out["counts"]["orders_late"] == 1


def test_the_handed_back_key_round_trips():
    first = apply_wiring("check_late_suppliers", _late_out([_late()]),
                         {"x": skill_ack.Ack("x")})
    f = first["late"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring("check_late_suppliers", _late_out([_late()]), acks)["late"] == []
