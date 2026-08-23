"""
check_books_moved_since_due — three buckets, three effects, and a net that must
be rebuilt from the right field.

The sizing skill beside `check_amendments_before_filing`: that one lists the
documents that moved after the GSTR-1 due date, this one says what they are
WORTH. It repeats for the same reason — nothing records that a period was filed,
so the due date will never stop having passed.

The sharp edge is in the rebuild. The handler's first cut summed `supply_value`
and "reported a cancelled invoice as value appearing after the filing, with the
sign inverted", so every total is summed from each row's own
`effect_on_the_return`. And `edited_value_ceiling` is summed from ABS(supply)
and stays OUT of the net, because the handler is emphatic that it "is a CEILING
on the exposure, it is not a delta".
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_books_moved_since_due"
W = ACK_WIRING[SKILL]


def _d(invoice_id="i-1", document="INV-1042", value=42000.0, supply=42000.0,
       effect=42000.0, status="final", invoice_date="2026-07-14", **kw) -> dict:
    row = {
        "invoice_id": invoice_id,
        "document": document,
        "kind": "tax_invoice",
        "customer": "Sharma Traders",
        "invoice_date": invoice_date,
        "value_now": value,
        "supply_value": supply,
        "doc_status": status,
        "created_on": "2026-08-15",
        "last_edited": "2026-08-15",
        "effect_on_the_return": effect,
        "why": "created after the due date",
    }
    row.update(kw)
    return row


def _out(added=(), edited=(), withdrawn=(), bulk=None, in_period=214) -> dict:
    added, edited, withdrawn = list(added), list(edited), list(withdrawn)
    added_net = round(sum(e["effect_on_the_return"] for e in added), 2)
    withdrawn_net = round(sum(e["effect_on_the_return"] for e in withdrawn), 2)
    ceiling = round(sum(abs(e["supply_value"]) for e in edited), 2)
    return {
        "as_at": "2026-08-23",
        "period": "2026-07",
        "gstr1_due_on": "2026-08-11",
        "due_date_is_an_inferred_cutoff": True,
        "statute": "GSTR-1 due date",
        "predicts_a_departmental_notice": False,
        "value_delta": {
            "added_net": added_net,
            "withdrawn_net": withdrawn_net,
            "net_known_delta": round(added_net + withdrawn_net, 2),
            "edited_value_ceiling": ceiling,
            "edited_value_is_a_ceiling_not_a_delta": True,
            "credit_notes_carry_a_minus": True,
        },
        "added_after_the_due_date": added,
        "edited_after_the_due_date": edited,
        "withdrawn_after_the_due_date": withdrawn,
        "bulk_touch": bulk,
        "neighbouring_skill": "check_amendments_before_filing (#18) …",
        "counts": {
            "documents_in_period": in_period,
            "added": len(added),
            "edited": len(edited),
            "withdrawn": len(withdrawn),
            "documents_checked_for_withdrawal": in_period,
            "capped_at": 200,
            "was_capped": False,
            "classified": True,
        },
        "limitations": ["THE RUPEE CHANGE MADE BY AN EDIT IS NOT KNOWABLE HERE."],
    }


def _edited(**kw) -> dict:
    return _d(effect=None, delta_unknown=True, why="edited after the due date", **kw)


def _withdrawn(supply=42000.0, **kw) -> dict:
    return _d(supply=supply, effect=-supply, why="cancelled after the due date",
              withdrawn_on="2026-08-20", **kw)


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_document_stops_being_reported():
    f = _d()
    out = apply_wiring(SKILL, _out(added=[f]), _ack("added_after_the_due_date", f))
    assert out["added_after_the_due_date"] == []
    assert out["acknowledged"]["items"][0]["label"] == "INV-1042 — Sharma Traders"


def test_the_three_buckets_are_three_effects():
    """A plus, an unknown and a minus. A document that was edited and is then
    cancelled has gone from "we cannot say what this changed" to "this is a
    known minus", and an acknowledgement of the first must not cover the
    second."""
    f = _d(invoice_id="i-1")
    keys = {b: skill_ack.finding_key(_identity_for(W, b)(f))
            for b in ("added_after_the_due_date", "edited_after_the_due_date",
                      "withdrawn_after_the_due_date")}
    assert len(set(keys.values())) == 3


def test_an_edited_document_that_is_then_cancelled_comes_back():
    acks = _ack("edited_after_the_due_date", _edited(invoice_id="i-1"))
    out = apply_wiring(SKILL, _out(withdrawn=[_withdrawn(invoice_id="i-1")]), acks)
    assert len(out["withdrawn_after_the_due_date"]) == 1


def test_a_revalued_document_comes_back():
    acks = _ack("added_after_the_due_date", _d(value=42000.0))
    out = apply_wiring(SKILL, _out(added=[_d(value=84000.0, supply=84000.0,
                                             effect=84000.0)]), acks)
    assert len(out["added_after_the_due_date"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_the_three_value_fields_are_not_all_hashed():
    """`supply_value` is `value_now` with a sign, and `effect_on_the_return` is
    `supply_value` with the bucket's sign. Hashing any two would count one
    movement twice."""
    assert set(W.material_of(_d())) == {"value_now", "doc_status"}


def test_the_delta_unknown_flag_is_not_hashed():
    """It is a constant True on every row of the edited bucket and absent
    everywhere else — the bucket wearing a field."""
    acks = _ack("edited_after_the_due_date", _edited(invoice_id="i-1"))
    same = _edited(invoice_id="i-1")
    same["delta_unknown"] = True
    out = apply_wiring(SKILL, _out(edited=[same]), acks)
    assert out["edited_after_the_due_date"] == []


def test_redating_a_document_is_a_new_finding():
    acks = _ack("added_after_the_due_date", _d(invoice_date="2026-07-14"))
    out = apply_wiring(SKILL, _out(added=[_d(invoice_date="2026-08-02")]), acks)
    assert len(out["added_after_the_due_date"]) == 1


# ── the value block ─────────────────────────────────────────────────────────

def test_the_net_is_rebuilt_from_the_effect_and_never_from_the_supply():
    """The handler's first cut summed `supply_value` and reported a cancelled
    invoice as value APPEARING after the filing, with the sign inverted. The
    rebuild must not repeat it."""
    keep = _withdrawn(invoice_id="i-1", supply=10000.0)
    hide = _withdrawn(invoice_id="i-2", supply=90000.0)
    out = apply_wiring(SKILL, _out(withdrawn=[keep, hide]),
                       _ack("withdrawn_after_the_due_date", hide))
    assert out["value_delta"]["withdrawn_net"] == -10000.0
    assert out["value_delta"]["net_known_delta"] == -10000.0


def test_the_added_net_matches_the_documents_actually_shown():
    keep = _d(invoice_id="i-1", value=1000.0, supply=1000.0, effect=1000.0)
    hide = _d(invoice_id="i-2", value=9000.0, supply=9000.0, effect=9000.0)
    out = apply_wiring(SKILL, _out(added=[keep, hide]),
                       _ack("added_after_the_due_date", hide))
    assert out["value_delta"]["added_net"] == 1000.0
    assert out["counts"]["added"] == 1


def test_the_edited_ceiling_is_rebuilt_and_stays_out_of_the_net():
    """The handler is emphatic: it "is a CEILING on the exposure, it is not a
    delta, and it is deliberately excluded from the net"."""
    keep = _edited(invoice_id="i-1", supply=5000.0)
    hide = _edited(invoice_id="i-2", supply=70000.0)
    add = _d(invoice_id="i-3", value=1000.0, supply=1000.0, effect=1000.0)
    out = apply_wiring(SKILL, _out(added=[add], edited=[keep, hide]),
                       _ack("edited_after_the_due_date", hide))
    assert out["value_delta"]["edited_value_ceiling"] == 5000.0
    assert out["value_delta"]["net_known_delta"] == 1000.0
    assert out["value_delta"]["edited_value_is_a_ceiling_not_a_delta"] is True


def test_acknowledging_everything_leaves_zeroes_not_stale_totals():
    f = _d()
    out = apply_wiring(SKILL, _out(added=[f]), _ack("added_after_the_due_date", f))
    assert out["value_delta"]["added_net"] == 0.0
    assert out["value_delta"]["net_known_delta"] == 0.0


def test_the_bulk_touch_flag_is_left_alone():
    """It is a judgement about whether one BACKFILL touched the books — "that
    is one operation, not N amendments" — and it is quoted into `limitations`
    as prose. Recomputing it from a filtered list could make a real backfill
    disappear because somebody acknowledged enough of it."""
    bulk = {"date": "2026-08-15", "documents": 61, "share_of_edited": 0.98,
            "why": "61 of 62 edited documents carry the same last-edited date."}
    f = _edited(invoice_id="i-1")
    out = apply_wiring(SKILL, _out(edited=[f], bulk=bulk),
                       _ack("edited_after_the_due_date", f))
    assert out["bulk_touch"] == bulk


def test_the_denominators_and_the_refusal_are_left_alone():
    f = _d()
    out = apply_wiring(SKILL, _out(added=[f], in_period=214),
                       _ack("added_after_the_due_date", f))
    assert out["counts"]["documents_in_period"] == 214
    assert out["counts"]["documents_checked_for_withdrawal"] == 214
    assert out["counts"]["classified"] is True
    assert out["predicts_a_departmental_notice"] is False


def test_a_malformed_effect_does_not_break_the_rebuild():
    good = _d(invoice_id="i-1", effect=1000.0)
    bad = _d(invoice_id="i-2", effect="x")
    data = _out(added=[good])
    data["added_after_the_due_date"] = [good, bad]
    out = apply_wiring(SKILL, data, _ack("added_after_the_due_date", _d(invoice_id="i-9")))
    assert out["value_delta"]["added_net"] == 1000.0


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_no_invoice_id_does_not_raise():
    out = apply_wiring(SKILL, _out(added=[_d(invoice_id=None)]),
                       _ack("added_after_the_due_date", _d()))
    assert len(out["added_after_the_due_date"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _d()
    data = {"added_after_the_due_date": [f], "counts": {}, "value_delta": {}}
    out = apply_wiring(SKILL, data, _ack("added_after_the_due_date", f))
    assert len(out["added_after_the_due_date"]) == 1
    assert "acknowledged" not in out


def test_the_books_moved_key_round_trips():
    first = apply_wiring(SKILL, _out(added=[_d()]), {"x": skill_ack.Ack("x")})
    f = first["added_after_the_due_date"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(added=[_d()]),
                        acks)["added_after_the_due_date"] == []
