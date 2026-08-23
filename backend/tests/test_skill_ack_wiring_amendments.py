"""
check_amendments_before_filing — a list that can never clear itself.

The handler's first limitation: "NOTHING RECORDS THAT A PERIOD WAS FILED. There
is no filed_at, no ARN and no return log anywhere in this product." A firm that
HAS amended, or that filed early and included the document all along, sees the
same list next run and for ever after, because the period's due date will never
stop having passed.

The trap on this entry is `last_edited`: it is the field the
`edited_after_the_due_date` list is computed FROM, and it also moves when
somebody opens and saves a document without changing a figure. The handler
cannot tell those apart, so the amount is the honest proxy for "something
changed that matters".
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_amendments_before_filing"
W = ACK_WIRING[SKILL]


def _d(invoice_id="i-1", document="INV-1042", amount=42000.0, status="final",
       invoice_date="2026-07-14", edited="2026-08-15", why="created after the due date",
       **kw) -> dict:
    row = {
        "invoice_id": invoice_id,
        "document": document,
        "kind": "tax_invoice",
        "customer": "Sharma Traders",
        "invoice_date": invoice_date,
        "amount": amount,
        "doc_status": status,
        "created_on": "2026-08-15",
        "last_edited": edited,
        "why": why,
    }
    row.update(kw)
    return row


def _out(created=(), edited=(), in_period=214) -> dict:
    created, edited = list(created), list(edited)
    return {
        "as_at": "2026-08-23",
        "period": "2026-07",
        "period_from": "2026-07-01",
        "period_to": "2026-07-31",
        "gstr1_due_on": "2026-08-11",
        "due_date_is_inferred_cutoff": True,
        "statute": "GSTR-1 due date",
        "amendment_route": "GSTR-1A",
        "counts": {
            # The denominator: every invoice in the period, most of them fine.
            "documents_in_period": in_period,
            "created_after_the_due_date": len(created),
            "edited_after_the_due_date": len(edited),
            "capped_at": 200,
            "was_capped": False,
        },
        "created_after_the_due_date": created,
        "edited_after_the_due_date": edited,
        "limitations": ["NOTHING RECORDS THAT A PERIOD WAS FILED."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_document_stops_being_reported():
    f = _d()
    out = apply_wiring(SKILL, _out(created=[f]), _ack("created_after_the_due_date", f))
    assert out["created_after_the_due_date"] == []
    assert out["acknowledged"]["items"][0]["label"] == "INV-1042 — Sharma Traders"


def test_the_two_lists_say_different_things_to_a_filer():
    """One document is missing from the return, the other is in it with the
    wrong figures. The handler's `elif` makes them exclusive, and moving
    between them is a re-creation rather than a clock."""
    f = _d(invoice_id="i-1")
    created_key = skill_ack.finding_key(
        _identity_for(W, "created_after_the_due_date")(f))
    edited_key = skill_ack.finding_key(
        _identity_for(W, "edited_after_the_due_date")(f))
    assert created_key != edited_key


def test_correcting_the_document_number_does_not_orphan_the_acknowledgement():
    acks = _ack("created_after_the_due_date", _d(document="INV-1042"))
    out = apply_wiring(SKILL, _out(created=[_d(document="INV-1042-A",
                                               customer="Sharma Traders Pvt")]), acks)
    assert out["created_after_the_due_date"] == []


def test_redating_an_invoice_into_another_month_is_a_new_finding():
    """The period is derived from the invoice date, and a document re-dated
    into another month genuinely becomes a different filing's problem."""
    acks = _ack("created_after_the_due_date", _d(invoice_date="2026-07-14"))
    out = apply_wiring(SKILL, _out(created=[_d(invoice_date="2026-08-02")]), acks)
    assert len(out["created_after_the_due_date"]) == 1


def test_an_amended_amount_brings_it_back():
    """A document amended from 42,000 to 84,000 after the return has gone is a
    different amendment."""
    acks = _ack("created_after_the_due_date", _d(amount=42000.0))
    out = apply_wiring(SKILL, _out(created=[_d(amount=84000.0)]), acks)
    assert len(out["created_after_the_due_date"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_doc_status_move_brings_it_back():
    """`doc_status` defaults to 'final', so a move away from that default is
    deliberate and worth surfacing."""
    acks = _ack("created_after_the_due_date", _d(status="final"))
    out = apply_wiring(SKILL, _out(created=[_d(status="cancelled")]), acks)
    assert len(out["created_after_the_due_date"]) == 1


def test_opening_and_saving_a_document_does_not_void_the_acknowledgement():
    """THE TRAP. `last_edited` is what the `edited_after_the_due_date` list is
    computed FROM, and it also moves when somebody opens and saves without
    changing a figure. The handler cannot tell those apart, so the amount is
    the honest proxy for "something changed that matters"."""
    acks = _ack("edited_after_the_due_date", _d(edited="2026-08-15",
                                                why="edited after the due date"))
    out = apply_wiring(SKILL, _out(edited=[_d(edited="2026-08-22",
                                              why="edited after the due date")]), acks)
    assert out["edited_after_the_due_date"] == []
    assert set(W.material_of(_d())) == {"amount", "doc_status"}


def test_the_creation_date_is_not_hashed():
    """It never moves, so it can only add noise."""
    assert "created_on" not in W.identity_of(_d())
    assert "created_on" not in W.material_of(_d())


# ── the aggregates ──────────────────────────────────────────────────────────

def test_the_two_list_counts_are_rebuilt():
    keep = _d(invoice_id="i-1")
    hide = _d(invoice_id="i-2")
    ed = _d(invoice_id="i-3", why="edited after the due date")
    out = apply_wiring(SKILL, _out(created=[keep, hide], edited=[ed]),
                       _ack("created_after_the_due_date", hide))
    assert out["counts"]["created_after_the_due_date"] == 1
    assert out["counts"]["edited_after_the_due_date"] == 1


def test_the_period_denominator_is_left_alone():
    """`documents_in_period` is every invoice in the period, most of them
    perfectly fine — it is what stops two zeroes reading as a clean result."""
    f = _d()
    out = apply_wiring(SKILL, _out(created=[f], in_period=214), _ack(
        "created_after_the_due_date", f))
    assert out["counts"]["documents_in_period"] == 214


def test_the_statute_facts_are_left_alone():
    f = _d()
    out = apply_wiring(SKILL, _out(created=[f]), _ack("created_after_the_due_date", f))
    assert out["gstr1_due_on"] == "2026-08-11"
    assert out["amendment_route"] == "GSTR-1A"
    assert out["due_date_is_inferred_cutoff"] is True


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_no_invoice_id_does_not_raise():
    out = apply_wiring(SKILL, _out(created=[_d(invoice_id=None)]),
                       _ack("created_after_the_due_date", _d()))
    assert len(out["created_after_the_due_date"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _d()
    data = {"created_after_the_due_date": [f], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("created_after_the_due_date", f))
    assert len(out["created_after_the_due_date"]) == 1
    assert "acknowledged" not in out


def test_the_amendment_key_round_trips():
    first = apply_wiring(SKILL, _out(created=[_d()]), {"x": skill_ack.Ack("x")})
    f = first["created_after_the_due_date"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(created=[_d()]),
                        acks)["created_after_the_due_date"] == []
