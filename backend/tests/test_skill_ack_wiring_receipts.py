"""
check_unmatched_receipts — two populations, and two counts that are censuses
BEFORE any acknowledgement exists.

The handler "suggests; it never records a payment" — paid arrives from bank
reconciliation and from nothing else — so every credit it lists is there again
next run, including the ones a person has already looked at and rejected. A
false match by amount coincidence, which the handler itself calls "a
coincidence, not an identification", is proposed again every single day.

The recompute has to be selective for a reason that exists in the handler
already: `money_in_nothing_matches` and `invoices_whose_money_is_already_in` are
TRUNCATED to the cap while their counts stay the full lengths. Those counts are
larger than their lists on a capped run before any filtering, so rebuilding them
would replace a true number with a filtered one.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_unmatched_receipts"
W = ACK_WIRING[SKILL]


def _line(line_id="l-1", amount=42000.0, matched_on="amount", **kw) -> dict:
    row = {
        "line_id": line_id,
        "statement_date": "2026-08-04",
        "amount": amount,
        "reference": "NEFT/000112",
        "description": "SHARMA TRADERS",
        "matched_on": matched_on,
    }
    row.update(kw)
    return row


def _inv(invoice_id="i-1", balance=42000.0, status="unpaid", **kw) -> dict:
    row = {
        "invoice_id": invoice_id,
        "invoice_number": "INV-1042",
        "customer": "Sharma Traders",
        "invoice_date": "2026-07-01",
        "due_date": "2026-07-31",
        "total": 42000.0,
        "balance_due": balance,
        "payment_status": status,
    }
    row.update(kw)
    return row


def _out(settled=(), decide=(), unexplained=(), mirror=(),
         unexplained_census=None, mirror_census=None) -> dict:
    settled, decide = list(settled), list(decide)
    unexplained, mirror = list(unexplained), list(mirror)
    return {
        "as_at": "2026-08-23",
        "window_from": "2026-02-24",
        "window_days": 180,
        "counts": {
            "open_credits_examined": 214,
            "settled_by_one_invoice": len(settled),
            "need_a_decision": len(decide),
            # CENSUSES. The handler truncates the lists below to the cap while
            # these keep the full lengths.
            "money_in_nothing_matches": (unexplained_census
                                         if unexplained_census is not None
                                         else len(unexplained)),
            "invoices_whose_money_is_already_in": (mirror_census
                                                   if mirror_census is not None
                                                   else len(mirror)),
            "capped_at": 200,
            "was_capped": False,
        },
        "settled_by_one_invoice": settled,
        "need_a_decision": decide,
        "money_in_nothing_matches": unexplained,
        "invoices_whose_money_is_already_in": mirror,
        "limitations": ["This suggests; it never records a payment."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_suggestion_stops_being_reported():
    f = _line(matched_on="reference")
    out = apply_wiring(SKILL, _out(settled=[f]), _ack("settled_by_one_invoice", f))
    assert out["settled_by_one_invoice"] == []
    assert out["acknowledged"]["items"][0]["label"] == "credit 42000.0 on 2026-08-04"


def test_an_acknowledged_invoice_on_the_mirror_side_stops_being_reported():
    f = _inv()
    out = apply_wiring(SKILL, _out(mirror=[f]),
                       _ack("invoices_whose_money_is_already_in", f))
    assert out["invoices_whose_money_is_already_in"] == []
    assert out["acknowledged"]["items"][0]["label"] == "INV-1042 — Sharma Traders"


def test_a_line_and_an_invoice_cannot_share_a_key():
    line_key = skill_ack.finding_key(
        _identity_for(W, "settled_by_one_invoice")(_line(line_id="x")))
    inv_key = skill_ack.finding_key(
        _identity_for(W, "invoices_whose_money_is_already_in")(_inv(invoice_id="x")))
    assert line_key != inv_key


def test_a_credit_that_starts_matching_something_is_a_different_question():
    """A credit that matched nothing and now matches two invoices is not the
    same finding, so the folded list name orphans the acknowledgement."""
    f = _line(line_id="l-1")
    acks = _ack("money_in_nothing_matches", f)
    out = apply_wiring(SKILL, _out(decide=[f]), acks)
    assert len(out["need_a_decision"]) == 1


def test_the_bank_text_is_not_part_of_the_key():
    """`reference` and `description` are the bank's own text, and the handler
    is explicit that a payer is not recorded anywhere — so they identify
    nothing on their own."""
    acks = _ack("settled_by_one_invoice", _line(reference="NEFT/000112"))
    out = apply_wiring(SKILL, _out(settled=[
        _line(reference="NEFT/000112/CORR", description="SHARMA TRADERS PVT")]), acks)
    assert out["settled_by_one_invoice"] == []


def test_a_match_upgraded_from_a_coincidence_to_a_reference_comes_back():
    """"reference" and "amount" are different CLAIMS about the same credit, and
    only the first names an invoice. A suggestion accepted on a coincidence and
    now backed by a reference deserves to be seen again."""
    acks = _ack("settled_by_one_invoice", _line(matched_on="amount"))
    out = apply_wiring(SKILL, _out(settled=[_line(matched_on="reference")]), acks)
    assert len(out["settled_by_one_invoice"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_an_invoice_whose_balance_moves_comes_back():
    acks = _ack("invoices_whose_money_is_already_in", _inv(balance=42000.0))
    out = apply_wiring(SKILL, _out(mirror=[_inv(balance=20000.0, status="partial")]),
                       acks)
    assert len(out["invoices_whose_money_is_already_in"]) == 1


def test_the_statement_date_is_not_hashed():
    """It is fixed at import and never moves; nothing in this shape ticks."""
    assert set(W.identity_of(_line())) == {"line_id", "invoice_id"}
    assert set(W.material_of(_line())) == {"amount", "matched_on",
                                           "balance_due", "payment_status"}


# ── the recompute is selective, and the reason predates this wiring ─────────

def test_the_two_uncapped_counts_are_rebuilt():
    keep, hide = _line(line_id="l-1"), _line(line_id="l-2")
    out = apply_wiring(SKILL, _out(settled=[keep, hide]),
                       _ack("settled_by_one_invoice", hide))
    assert out["counts"]["settled_by_one_invoice"] == 1


def test_the_two_census_counts_are_left_alone():
    """`money_in_nothing_matches` and `invoices_whose_money_is_already_in` are
    truncated to the cap while their counts keep the full lengths — they are
    already larger than their lists on a capped run, before any acknowledgement
    exists. Rebuilding either would replace a true number with a filtered
    one."""
    f = _line(line_id="l-1")
    out = apply_wiring(SKILL, _out(unexplained=[f], unexplained_census=240,
                                   mirror=[_inv()], mirror_census=61),
                       _ack("money_in_nothing_matches", f))
    assert out["money_in_nothing_matches"] == []
    assert out["counts"]["money_in_nothing_matches"] == 240
    assert out["counts"]["invoices_whose_money_is_already_in"] == 61


def test_the_credit_population_is_left_alone():
    f = _line()
    out = apply_wiring(SKILL, _out(settled=[f]), _ack("settled_by_one_invoice", f))
    assert out["counts"]["open_credits_examined"] == 214
    assert out["counts"]["capped_at"] == 200


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_neither_id_does_not_raise():
    bare = {"amount": 1.0, "statement_date": "2026-08-04"}
    out = apply_wiring(SKILL, _out(settled=[bare]), _ack("settled_by_one_invoice", _line()))
    assert len(out["settled_by_one_invoice"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _line()
    data = {"settled_by_one_invoice": [f], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("settled_by_one_invoice", f))
    assert len(out["settled_by_one_invoice"]) == 1
    assert "acknowledged" not in out


def test_the_receipts_key_round_trips():
    first = apply_wiring(SKILL, _out(settled=[_line()]), {"x": skill_ack.Ack("x")})
    f = first["settled_by_one_invoice"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(settled=[_line()]), acks)["settled_by_one_invoice"] == []
