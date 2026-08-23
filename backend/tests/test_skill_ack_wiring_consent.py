"""
check_consent_ledger — a compliance list, which is the worst kind to train
somebody to skim.

The handler proves the finding cannot resolve itself: "No INSERT or UPDATE
anywhere in this backend sets staging.varta_contacts.opted_in. The column is a
promise the schema makes and cannot keep." Nothing on the inbound path reads a
STOP message and changes a flag, and nothing on the send path reads the flag. A
firm that has recorded a consent on paper, or honoured a stop by hand, reads the
identical list every run.

Two judgements pinned here:
  · `opt_in_recorded` is NOT wired — it is the list of people who are fine, and
    an acknowledge button on it would let somebody hide the evidence that
    consent was recorded at all;
  · the STOP MESSAGE is evidence, not identity: a contact who writes "STOP"
    twice has not created a second obligation.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _buckets_of, _identity_for, apply_wiring

SKILL = "check_consent_ledger"
W = ACK_WIRING[SKILL]


def _stop(contact_id="c-1", ledger_opted_in=True, said="STOP", **kw) -> dict:
    row = {
        "contact_id": contact_id,
        "who": "Rahul Menon",
        "company": "Sharma Traders",
        "phone_number": "+91 98765 43210",
        "said": said,
        "said_at": "2026-07-04T09:12:00+00:00",
        "matched": "exact",
        "confidence": "the whole message is a stop keyword",
        "ledger_still_says_opted_in": ledger_opted_in,
    }
    row.update(kw)
    return row


def _reach(contact_id="c-2", opted_in=False, stopped=False, **kw) -> dict:
    row = {
        "contact_id": contact_id,
        "who": "Priya Nair",
        "company": None,
        "phone_number": "+91 90000 00001",
        "opted_in_flag": opted_in,
        "asked_to_stop": stopped,
        "last_message_at": "2026-08-01T10:00:00+00:00",
        "why": "no opt-in is recorded, and the send route does not check",
    }
    row.update(kw)
    return row


def _opt_in(contact_id="c-9") -> dict:
    return {
        "contact_id": contact_id,
        "who": "Aisha Khan",
        "company": None,
        "phone_number": "+91 90000 00009",
        "opted_in_at": "2026-01-01T00:00:00+00:00",
        "age_days": 234,
        "notice_text_shown_at_opt_in": None,
        "notice_text_status": "not recorded — no column exists to hold it",
    }


def _out(stopped=(), reachable=(), opt_ins=()) -> dict:
    stopped, reachable, opt_ins = list(stopped), list(reachable), list(opt_ins)
    return {
        "as_at": "2026-08-23",
        "counts": {
            # CENSUS — the numbers a compliance reader needs whole.
            "whatsapp_contacts": 412,
            "flagged_opted_in": 61,
            "not_flagged": 351,
            "with_opt_in_timestamp": 61,
            "distinct_opt_in_timestamps": 1,
            "linked_to_a_crm_contact": 200,
            "opt_ins_with_notice_text": 0,
            "inbound_messages_examined": 1840,
            "contacts_who_wrote_in": 90,
            # Sums over the two wired lists.
            "asked_to_stop": len(stopped),
            "asked_to_stop_but_ledger_says_opted_in": sum(
                1 for s in stopped if s["ledger_still_says_opted_in"]),
            "reachable_without_a_recorded_opt_in": len(reachable),
            "whatsapp_business_accounts": 1,
            "whatsapp_business_accounts_connected": 1,
            "listed_rows_capped_at": 200,
            "was_capped": False,
        },
        "opt_in_recorded": opt_ins,
        "asked_to_stop": stopped,
        "reachable_without_a_recorded_opt_in": reachable,
        "opt_in_is_not_evidence": True,
        "send_refusal_in_force": False,
        "send_refusal_note": "A template send refuses nobody today.",
        "missing_write_path": {"verified": "No INSERT or UPDATE anywhere …"},
        "stop_vocabulary": ["stop", "unsubscribe"],
        "limitations": [],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_the_people_who_are_fine_are_not_wired():
    """`opt_in_recorded` is the reassurance list. An acknowledge button on it
    would let somebody hide the evidence that consent was recorded at all — on
    the one report a regulator would read."""
    assert set(_buckets_of(W)) == {"asked_to_stop",
                                   "reachable_without_a_recorded_opt_in"}


def test_an_acknowledged_stop_stops_being_reported():
    f = _stop()
    out = apply_wiring(SKILL, _out(stopped=[f]), _ack("asked_to_stop", f))
    assert out["asked_to_stop"] == []
    assert out["acknowledged"]["items"][0]["label"] == "consent — Rahul Menon"


def test_the_opt_in_list_is_never_annotated():
    f = _stop()
    out = apply_wiring(SKILL, _out(stopped=[f], opt_ins=[_opt_in()]),
                       _ack("asked_to_stop", f))
    assert out["opt_in_recorded"] == [_opt_in()]
    assert "_ack_key" not in out["opt_in_recorded"][0]


def test_one_contact_in_both_lists_carries_two_obligations():
    """Somebody who asked to stop is also reachable-without-consent, and those
    are two different duties: honour the stop, and record a basis for
    contacting them. Acknowledging one must not answer the other."""
    stop = _stop(contact_id="c-1")
    reach = _reach(contact_id="c-1", stopped=True)
    out = apply_wiring(SKILL, _out(stopped=[stop], reachable=[reach]),
                       _ack("asked_to_stop", stop))
    assert out["asked_to_stop"] == []
    assert len(out["reachable_without_a_recorded_opt_in"]) == 1


def test_the_phone_number_is_not_the_key():
    """The handler normalises phones to compare them precisely because the same
    person appears under different spellings, so a number is not a key — quite
    apart from it being a contact detail."""
    acks = _ack("asked_to_stop", _stop(phone_number="+91 98765 43210"))
    out = apply_wiring(SKILL, _out(stopped=[_stop(phone_number="9876543210",
                                                  who="R. Menon")]), acks)
    assert out["asked_to_stop"] == []
    assert set(W.identity_of(_stop())) == {"contact_id"}


def test_writing_stop_again_does_not_resurface_the_finding():
    """The message is the EVIDENCE for the finding, not the finding. A contact
    who writes "STOP" twice has not created a second obligation, and hashing
    the newest message would resurface it every time they wrote in."""
    acks = _ack("asked_to_stop", _stop(said="STOP", said_at="2026-07-04T09:12:00+00:00"))
    out = apply_wiring(SKILL, _out(stopped=[
        _stop(said="STOP SENDING ME THIS", said_at="2026-08-20T18:00:00+00:00",
              matched="phrase", confidence="a stop phrase appears inside a longer message")]),
        acks)
    assert out["asked_to_stop"] == []


def test_flipping_the_ledger_flag_brings_the_stop_back_once():
    """The flag can only move by hand, since no code path writes it. When it
    does, the contradiction the finding is about has genuinely changed."""
    acks = _ack("asked_to_stop", _stop(ledger_opted_in=True))
    out = apply_wiring(SKILL, _out(stopped=[_stop(ledger_opted_in=False)]), acks)
    assert len(out["asked_to_stop"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_recording_an_opt_in_brings_the_reachable_contact_back():
    acks = _ack("reachable_without_a_recorded_opt_in", _reach(opted_in=False))
    out = apply_wiring(SKILL, _out(reachable=[_reach(opted_in=True)]), acks)
    assert len(out["reachable_without_a_recorded_opt_in"]) == 1


# ── the aggregates ──────────────────────────────────────────────────────────

def test_the_three_derived_counts_are_rebuilt():
    keep = _stop(contact_id="c-1", ledger_opted_in=True)
    hide = _stop(contact_id="c-2", ledger_opted_in=True)
    out = apply_wiring(SKILL, _out(stopped=[keep, hide], reachable=[_reach()]),
                       _ack("asked_to_stop", hide))
    assert out["counts"]["asked_to_stop"] == 1
    assert out["counts"]["asked_to_stop_but_ledger_says_opted_in"] == 1
    assert out["counts"]["reachable_without_a_recorded_opt_in"] == 1


def test_the_contact_census_is_left_alone():
    """On a compliance report the census is the point.
    `distinct_opt_in_timestamps` in particular is what decides
    `opt_in_is_not_evidence` — a seed writes one timestamp for every row it
    touches — and rebuilding it from a filtered list would destroy the only
    signal the handler has for an opt-in it should not believe."""
    f = _stop()
    out = apply_wiring(SKILL, _out(stopped=[f]), _ack("asked_to_stop", f))
    assert out["counts"]["whatsapp_contacts"] == 412
    assert out["counts"]["flagged_opted_in"] == 61
    assert out["counts"]["distinct_opt_in_timestamps"] == 1
    assert out["counts"]["inbound_messages_examined"] == 1840
    assert out["opt_in_is_not_evidence"] is True


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_no_contact_id_does_not_raise():
    out = apply_wiring(SKILL, _out(stopped=[_stop(contact_id=None)]),
                       _ack("asked_to_stop", _stop()))
    assert len(out["asked_to_stop"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _stop()
    data = {"asked_to_stop": [f], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("asked_to_stop", f))
    assert len(out["asked_to_stop"]) == 1
    assert "acknowledged" not in out


def test_the_consent_key_round_trips():
    first = apply_wiring(SKILL, _out(stopped=[_stop()]), {"x": skill_ack.Ack("x")})
    f = first["asked_to_stop"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(stopped=[_stop()]), acks)["asked_to_stop"] == []


def test_the_label_carries_no_contact_detail():
    """`sanitise_label` would strip a phone number anyway, but a label built
    from one would arrive at the ack table as "[redacted]" and tell a reader
    nothing. The name is what a person recognises."""
    assert W.label_of(_stop()) == "consent — Rahul Menon"
    assert skill_ack.sanitise_label(W.label_of(_stop())) == "consent — Rahul Menon"
