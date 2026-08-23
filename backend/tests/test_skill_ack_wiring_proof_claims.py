"""
check_payment_proof_claims — the one skill where the ack table stands in for a
table the product has not got.

The handler's third limitation: "There is nowhere to FILE a claim. No table
records one ... A claims store is owed before this can be more than a screen."
So a claim somebody has already confirmed on the reconciliation screen comes
back tomorrow looking exactly like one nobody has touched.

That makes the acknowledgement the only place the decision can live today — and
it is the reason this wiring should be REVISITED rather than kept once a claims
store exists.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

SKILL = "check_payment_proof_claims"
W = ACK_WIRING[SKILL]

NO_LINK = "nothing links this proof to an open invoice"
BY_NUMBER = "the message text names this invoice"


def _c(claim_id="c-1", kind="image", basis=NO_LINK, invoices=(), **kw) -> dict:
    row = {
        "claim_id": claim_id,
        "status": "claimed",
        "confirmed": False,
        "received_at": "2026-08-04T11:02:00+00:00",
        "sender": "+91 98765 43210",
        "customer": "Sharma Traders",
        "message_text": "paid sir",
        "attachment_kind": kind,
        "likely_invoices": list(invoices),
        "likely_invoices_basis": basis,
        "likely_invoices_not_shown": 0,
        "statement_rows_to_confirm_against": [],
        "statement_rows_not_shown": 0,
        "what_a_person_does": "confirm this claim against one of the statement rows",
    }
    row.update(kw)
    return row


def _out(claims) -> dict:
    claims = list(claims)
    return {
        "as_at": "2026-08-23",
        "window_from": "2026-02-24",
        "window_days": 180,
        "blocked": False,
        "blocker": "",
        "refusals": ["A screenshot cannot be verified by anything in this product."],
        "counts": {
            "whatsapp_business_accounts": 1,
            "whatsapp_business_accounts_active": 1,
            "inbound_messages_examined": 412,
            "inbound_messages_with_an_attachment": len(claims),
            "claims": len(claims),
            # A LITERAL. There is nowhere to record a confirmation.
            "claims_confirmed": 0,
            "capped_at": 200,
            "was_capped": False,
        },
        "claims": claims,
        "limitations": ["Every row here is a CLAIM."],
    }


def _ack(f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(W.identity_of(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_claim_stops_being_reported():
    f = _c()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["claims"] == []
    assert out["acknowledged"]["items"][0]["label"] == "payment proof — Sharma Traders"


def test_two_claims_are_two_findings():
    one, two = _c(claim_id="c-1"), _c(claim_id="c-2")
    out = apply_wiring(SKILL, _out([one, two]), _ack(one))
    assert [f["claim_id"] for f in out["claims"]] == ["c-2"]


def test_the_sender_and_the_customer_are_not_in_the_key():
    """A phone number and a name. The claim IS the inbound message row."""
    acks = _ack(_c(sender="+91 98765 43210", customer="Sharma Traders"))
    out = apply_wiring(SKILL, _out([_c(sender="+91 90000 00000",
                                       customer="Sharma Traders Pvt Ltd")]), acks)
    assert out["claims"] == []


def test_somebody_elses_paperwork_does_not_void_the_acknowledgement():
    """`likely_invoices` is a SUGGESTION list rebuilt every run "on two weak
    grounds", capped at five, and it moves whenever ANY unrelated invoice is
    raised or settled. Hashing it would void the ack on somebody else's
    paperwork."""
    acks = _ack(_c(invoices=[{"invoice_id": "i-1", "balance_due": 42000.0}]))
    out = apply_wiring(SKILL, _out([_c(
        invoices=[{"invoice_id": "i-2", "balance_due": 9.0},
                  {"invoice_id": "i-3", "balance_due": 1.0}],
        likely_invoices_not_shown=3)]), acks)
    assert out["claims"] == []


def test_a_claim_that_gains_a_basis_comes_back():
    """A claim that went from "nothing links this proof to an open invoice" to
    a real basis is a genuinely different position."""
    acks = _ack(_c(basis=NO_LINK))
    out = apply_wiring(SKILL, _out([_c(basis=BY_NUMBER)]), acks)
    assert len(out["claims"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_different_attachment_kind_comes_back():
    acks = _ack(_c(kind="image"))
    out = apply_wiring(SKILL, _out([_c(kind="document")]), acks)
    assert len(out["claims"]) == 1


def test_the_two_literal_fields_are_not_hashed():
    """`confirmed` is written False on every row and `claims_confirmed` is
    written 0, because there is nowhere to record a confirmation. A constant is
    not a state, and hashing one would suggest the field means something."""
    assert set(W.material_of(_c())) == {"attachment_kind", "likely_invoices_basis"}
    acks = _ack(_c(confirmed=False, status="claimed"))
    out = apply_wiring(SKILL, _out([_c(confirmed=True, status="confirmed")]), acks)
    assert out["claims"] == []


def test_the_arrival_time_is_not_hashed():
    acks = _ack(_c(received_at="2026-08-04T11:02:00+00:00"))
    out = apply_wiring(SKILL, _out([_c(received_at="2026-08-04T11:03:00+00:00")]), acks)
    assert out["claims"] == []


# ── the aggregates ──────────────────────────────────────────────────────────

def test_the_claim_count_is_rebuilt():
    keep, hide = _c(claim_id="c-1"), _c(claim_id="c-2")
    out = apply_wiring(SKILL, _out([keep, hide]), _ack(hide))
    assert out["counts"]["claims"] == 1


def test_the_rebuild_rests_on_the_list_and_the_cap_being_the_same_size():
    """`claims` is sliced to the same `cap` the query uses, so the count and
    the list differ only when an org has more than two hundred proofs in the
    window — against zero inbound media in every live org today. If that
    assumption ever breaks, this is where to look."""
    f = _c()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["counts"]["capped_at"] == 200
    assert out["counts"]["was_capped"] is False


def test_the_confirmed_count_and_the_denominators_are_left_alone():
    """The inbound numbers are what the handler uses to say "a measured absence
    over a stated denominator and not a clean result"."""
    f = _c()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["counts"]["claims_confirmed"] == 0
    assert out["counts"]["inbound_messages_examined"] == 412
    assert out["counts"]["whatsapp_business_accounts_active"] == 1
    assert out["refusals"] == ["A screenshot cannot be verified by anything in this product."]


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_claim_with_no_id_does_not_raise():
    out = apply_wiring(SKILL, _out([_c(claim_id=None)]), _ack(_c()))
    assert len(out["claims"]) == 1


def test_a_shape_change_fails_open():
    f = _c()
    data = {"proofs": [f], "counts": {"claims": 1}}
    out = apply_wiring(SKILL, data, _ack(f))
    assert len(out["proofs"]) == 1
    assert "acknowledged" not in out


def test_the_claim_key_round_trips():
    first = apply_wiring(SKILL, _out([_c()]), {"x": skill_ack.Ack("x")})
    f = first["claims"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out([_c()]), acks)["claims"] == []
