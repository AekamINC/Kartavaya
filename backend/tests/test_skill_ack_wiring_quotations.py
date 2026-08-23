"""
check_quotation_expiry — a ladder of beats, and a count that looks like a list
length and is not.

The handler drafts and does not send: no message goes out, no reminder row is
written, no status changes. So a quote chased by telephone, or one the customer
declined verbally, sits on the list until somebody marks it — which the handler
says out loud: "A quote accepted verbally and never marked accepted will still
be chased."

Two things pinned here:
  · `days_until_expiry` and `days_since_expiry` are NOT in `_DRIFT_FIELDS`, so
    nothing would have raised had they been hashed;
  · `open_without_a_validity_date` sits among three list-length counts and is a
    CENSUS figure, so the recompute must leave it alone.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_quotation_expiry"
W = ACK_WIRING[SKILL]


def _q(qid="q-1", number="QT-0031", amount=40000.0, status="sent",
       valid_until="2026-09-01", **kw) -> dict:
    row = {
        "quotation_id": qid,
        "quotation_number": number,
        "customer": "Sharma Traders",
        "deal": "Annual audit",
        "status": status,
        "amount": amount,
        "currency": "INR",
        "valid_until": valid_until,
    }
    row.update(kw)
    return row


def _out(due=(), not_yet=(), lapsed=(), no_validity=()) -> dict:
    due, not_yet = list(due), list(not_yet)
    lapsed, no_validity = list(lapsed), list(no_validity)
    return {
        "as_at": "2026-08-23",
        "beats": {"first_reminder_days_before_expiry": 14,
                  "second_press_days_before_expiry": 7,
                  "final_days_before_expiry": 2,
                  "basis": "practice convention, not statute"},
        "exits": {"on_conversion": "accepted",
                  "on_cancellation": ["rejected", "expired"],
                  "not_chased": ["draft"]},
        "counts": {
            # CENSUS figures — from a separate totals query, not list lengths.
            "quotations_recorded": 31,
            "open_and_sent_to_customer": 12,
            "drafts_never_sent": 4,
            "already_closed": 15,
            "open_without_a_validity_date": 3,
            # List lengths.
            "chase_due_now": len(due),
            "chase_not_yet_due": len(not_yet),
            "already_lapsed": len(lapsed),
            "capped_at": 200,
            "was_capped": False,
        },
        "coverage": [{"of": 9, "in": 12}],
        "chase_due_now": due,
        "chase_not_yet_due": not_yet,
        "already_lapsed": lapsed,
        "open_without_validity": no_validity,
        "drafts_never_sent_note": "4 quotations sit in draft.",
        "nothing_was_sent": True,
        "could_not_check": [],
        "limitations": ["NOTHING IN THE PRODUCT CREATES A QUOTATION."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_quotation_stops_being_reported():
    f = _q(beat=1, beat_name="remind", days_until_expiry=9)
    out = apply_wiring(SKILL, _out(due=[f]), _ack("chase_due_now", f))
    assert out["chase_due_now"] == []
    assert out["acknowledged"]["items"][0]["label"] == "QT-0031 — Sharma Traders"


def test_walking_the_beats_does_not_orphan_the_acknowledgement():
    """A quotation walks from `chase_not_yet_due` to `chase_due_now` to
    `already_lapsed` on the calendar alone. Folded, the ack would be orphaned
    twice on the way through."""
    acks = _ack("chase_not_yet_due", _q(days_until_expiry=30))
    due = _q(beat=1, beat_name="remind", days_until_expiry=9)
    assert apply_wiring(SKILL, _out(due=[due]), acks)["chase_due_now"] == []
    lapsed = _q(days_since_expiry=4, why="validity has already passed")
    assert apply_wiring(SKILL, _out(lapsed=[lapsed]), acks)["already_lapsed"] == []


def test_the_two_day_counters_are_in_neither_hash():
    """`days_until_expiry` and `days_since_expiry` are not in `_DRIFT_FIELDS` —
    it holds `days_until` and `days_left`, not these spellings. Nothing would
    have raised."""
    assert "days_until_expiry" not in skill_ack._DRIFT_FIELDS
    assert "days_since_expiry" not in skill_ack._DRIFT_FIELDS
    assert set(W.identity_of(_q())) == {"quotation_id"}
    assert set(W.material_of(_q())) == {"amount", "status"}


def test_extending_the_validity_does_not_void_the_acknowledgement():
    """Extending validity moves a quote back down the beats and makes the
    finding LESS urgent. Hashing `valid_until` would void the ack for it."""
    acks = _ack("chase_due_now", _q(valid_until="2026-09-01"))
    out = apply_wiring(SKILL, _out(not_yet=[_q(valid_until="2026-12-01")]), acks)
    assert out["chase_not_yet_due"] == []


def test_a_corrected_quotation_number_does_not_orphan_it():
    acks = _ack("chase_due_now", _q(number="QT-0031"))
    out = apply_wiring(SKILL, _out(due=[_q(number="QT-0031-A")]), acks)
    assert out["chase_due_now"] == []


def test_a_repriced_quote_comes_back():
    acks = _ack("chase_due_now", _q(amount=40000.0))
    out = apply_wiring(SKILL, _out(due=[_q(amount=90000.0)]), acks)
    assert len(out["chase_due_now"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_status_move_between_open_states_comes_back():
    acks = _ack("chase_due_now", _q(status="sent"))
    out = apply_wiring(SKILL, _out(due=[_q(status="negotiating")]), acks)
    assert len(out["chase_due_now"]) == 1


def test_two_quotations_are_two_findings():
    one, two = _q(qid="q-1"), _q(qid="q-2")
    out = apply_wiring(SKILL, _out(due=[one, two]), _ack("chase_due_now", one))
    assert [f["quotation_id"] for f in out["chase_due_now"]] == ["q-2"]


# ── the census must not be rebuilt ──────────────────────────────────────────

def test_the_three_beat_counts_are_rebuilt():
    keep, hide = _q(qid="q-1"), _q(qid="q-2")
    lap = _q(qid="q-3")
    out = apply_wiring(SKILL, _out(due=[keep, hide], lapsed=[lap]),
                       _ack("chase_due_now", hide))
    assert out["counts"]["chase_due_now"] == 1
    assert out["counts"]["already_lapsed"] == 1


def test_the_validity_count_is_a_census_and_is_left_alone():
    """THE TRAP. `open_without_a_validity_date` sits beside three list-length
    counts and reads like a fourth, but the handler takes it from the census
    query rather than from `len(no_validity)`. Rebuilding it from the surviving
    list would quietly convert a population figure into a filtered one."""
    f = _q(qid="q-9", why="no valid_until is recorded")
    out = apply_wiring(SKILL, _out(no_validity=[f]), _ack("open_without_validity", f))
    assert out["open_without_validity"] == []
    assert out["counts"]["open_without_a_validity_date"] == 3


def test_the_rest_of_the_census_is_left_alone():
    """On this skill the census IS the point: the table is empty in every live
    org, and an empty result must never read as "nothing is expiring"."""
    f = _q()
    out = apply_wiring(SKILL, _out(due=[f]), _ack("chase_due_now", f))
    assert out["counts"]["quotations_recorded"] == 31
    assert out["counts"]["open_and_sent_to_customer"] == 12
    assert out["counts"]["drafts_never_sent"] == 4
    assert out["coverage"] == [{"of": 9, "in": 12}]


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_quotation_with_no_id_does_not_raise():
    out = apply_wiring(SKILL, _out(due=[_q(quotation_id=None)]),
                       _ack("chase_due_now", _q()))
    assert len(out["chase_due_now"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _q()
    data = _out(due=[f])
    del data["already_lapsed"]
    out = apply_wiring(SKILL, data, _ack("chase_due_now", f))
    assert len(out["chase_due_now"]) == 1
    assert "acknowledged" not in out


def test_the_quotation_key_round_trips_across_lists():
    first = apply_wiring(SKILL, _out(due=[_q()]), {"x": skill_ack.Ack("x")})
    f = first["chase_due_now"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(lapsed=[_q()]), acks)["already_lapsed"] == []
