"""
check_chase_ladder — the wiring `lists_are_one_population` was added for.

The handler never sends and never writes: it says what is due and to whom. So
nothing it reports can be closed from inside it. An item chased by telephone, or
settled in a corridor, climbs the ladder anyway and arrives at "escalate to a
partner" about something dealt with a week ago.

Its four lists are ONE POPULATION partitioned by what to do next, and an item
moves between them on nothing but elapsed days. The two things this file pins:

  · the ladder walking does NOT orphan the acknowledgement — three acks of one
    task in a fortnight is how a person learns not to bother;
  · a chase actually DELIVERED does void it.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_chase_ladder"
W = ACK_WIRING[SKILL]


def _item(entity_id="t-1", entity_type="task", kind="task", action="first nudge",
          rung=1, sent=0, days=9, escalate_to="u-7", **kw) -> dict:
    row = {
        "kind": kind,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "what": "Furnish the bank statements",
        "due_on": "2026-08-14",
        "days_past_due": days,
        "chases_delivered": sent,
        "escalate_to": escalate_to,
        "waiting_on": "Sharma Traders",
        "action": action,
        "rung": rung,
        "direction": "outward",
        "why": f"{days} day(s) past due with {sent} chase(s) delivered",
    }
    row.update(kw)
    return row


def _out(nudges=(), escalations=(), expired=(), quiet=()) -> dict:
    nudges, escalations = list(nudges), list(escalations)
    expired, quiet = list(expired), list(quiet)
    everything = nudges + escalations + expired + quiet
    return {
        "as_at": "2026-08-23",
        "ladder": [{"days_past_due": 7, "action": "first nudge", "direction": "outward"}],
        "counts": {
            "waiting_on": len(everything),
            "tasks": sum(1 for i in everything if i["kind"] == "task"),
            "signatures": sum(1 for i in everything if i["kind"] == "signature"),
            "action_due_now": len(nudges) + len(escalations),
            "nudges_due": len(nudges),
            "escalations_due": len(escalations),
            "escalations_with_no_owner": sum(1 for i in escalations
                                             if not i.get("escalate_to")),
            "expired_signatures": len(expired),
            "nothing_due": len(quiet),
            "capped_at": 200,
            "was_capped": False,
        },
        "nudges_due": nudges,
        "escalations_due": escalations,
        "expired_and_must_be_reissued": expired,
        "waiting_but_nothing_due": quiet,
        "limitations": ["IT NEVER SENDS AND NEVER WRITES."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_item_stops_being_reported():
    f = _item()
    out = apply_wiring(SKILL, _out(nudges=[f]), _ack("nudges_due", f))
    assert out["nudges_due"] == []
    assert out["acknowledged"]["items"][0]["label"] == "task — Furnish the bank statements"


# ── THE ONE THE FLAG EXISTS FOR ─────────────────────────────────────────────

def test_climbing_the_ladder_does_not_orphan_the_acknowledgement():
    """An overdue task walks from first nudge to second nudge to escalation on
    nothing but elapsed days. With the list name folded into the key it would
    come back at every rung: ack on Monday, back on Thursday under a different
    heading, back again the week after."""
    monday = _item(action="first nudge", rung=1, days=9)
    acks = _ack("nudges_due", monday)

    a_fortnight_later = _item(action="escalate inside the firm", rung=3, days=23)
    out = apply_wiring(SKILL, _out(escalations=[a_fortnight_later]), acks)
    assert out["escalations_due"] == [], (
        "the acknowledgement was orphaned by the item climbing the ladder — "
        "check lists_are_one_population=True on this wiring")


def test_an_expiring_signature_does_not_orphan_the_acknowledgement():
    """Expiry moves a document into its own list, and it is one-way. The state
    change is visible because the population is partitioned, without being
    hashed anywhere."""
    doc = _item(entity_id="d-1", entity_type="esign_document", kind="signature")
    acks = _ack("nudges_due", doc)
    gone = _item(entity_id="d-1", entity_type="esign_document", kind="signature",
                 action="cannot be chased — it has expired", rung=0, expired=True)
    out = apply_wiring(SKILL, _out(expired=[gone]), acks)
    assert out["expired_and_must_be_reissued"] == []


def test_a_task_and_a_document_with_the_same_id_are_two_findings():
    """The ladder reads TASKS and SIGNATURE DOCUMENTS into one list and the two
    id spaces are separate tables, so `entity_type` has to be in the key."""
    t = _item(entity_id="same", entity_type="task", kind="task")
    d = _item(entity_id="same", entity_type="esign_document", kind="signature")
    out = apply_wiring(SKILL, _out(nudges=[t, d]), _ack("nudges_due", t))
    assert [f["kind"] for f in out["nudges_due"]] == ["signature"]


# ── what MUST bring it back ─────────────────────────────────────────────────

def test_a_delivered_chase_brings_it_back():
    """"We have chased this twice, leave it" should be shown again when a third
    chase actually goes out. The handler counts only DELIVERED reminders, never
    suppressed ones, so this is a real event."""
    acks = _ack("nudges_due", _item(sent=2))
    out = apply_wiring(SKILL, _out(nudges=[_item(sent=3)]), acks)
    assert len(out["nudges_due"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_the_rung_is_not_hashed():
    """`_rung_for(days, sent)` is a function of the DAY COUNT and the chase
    count. Hashing it would import the calendar into the material bucket by the
    back door and void every ack at a ladder threshold — the same midnight
    failure the folding was turned off to avoid, arriving by the other route.
    `action`, `direction` and `why` are derived from it and are out too."""
    assert set(W.material_of(_item())) == {"chases_delivered"}
    assert set(W.identity_of(_item())) == {"entity_type", "entity_id"}
    acks = _ack("nudges_due", _item(rung=1, action="first nudge", why="a"))
    moved = _item(rung=2, action="second nudge", why="b", direction="inward")
    assert apply_wiring(SKILL, _out(nudges=[moved]), acks)["nudges_due"] == []


# ── the counts ──────────────────────────────────────────────────────────────

def test_every_count_that_sums_the_lists_is_rebuilt():
    keep = _item(entity_id="t-1")
    hide = _item(entity_id="t-2")
    esc = _item(entity_id="t-3", action="escalate inside the firm", rung=3)
    doc = _item(entity_id="d-1", entity_type="esign_document", kind="signature",
                action="nothing yet", rung=0)
    out = apply_wiring(SKILL, _out(nudges=[keep, hide], escalations=[esc], quiet=[doc]),
                       _ack("nudges_due", hide))
    c = out["counts"]
    assert c["nudges_due"] == 1
    assert c["escalations_due"] == 1
    assert c["action_due_now"] == 2
    assert c["nothing_due"] == 1
    assert c["waiting_on"] == 3
    assert c["tasks"] == 2
    assert c["signatures"] == 1


def test_the_ownerless_escalation_count_is_rebuilt():
    """It is the number a limitation line quotes: "3 item(s) have reached the
    escalation rung and carry NO internal owner". A paragraph saying three
    above a list showing one is the reports-page defect in prose."""
    with_owner = _item(entity_id="t-1", escalate_to="u-7",
                       action="escalate inside the firm")
    without = _item(entity_id="t-2", escalate_to=None,
                    action="escalate inside the firm")
    out = apply_wiring(SKILL, _out(escalations=[with_owner, without]),
                       _ack("escalations_due", without))
    assert out["counts"]["escalations_with_no_owner"] == 0
    assert out["counts"]["escalations_due"] == 1


def test_the_query_shape_is_left_alone():
    f = _item()
    out = apply_wiring(SKILL, _out(nudges=[f]), _ack("nudges_due", f))
    assert out["counts"]["capped_at"] == 200
    assert out["counts"]["was_capped"] is False
    assert out["ladder"][0]["action"] == "first nudge"


def test_acknowledging_everything_empties_every_count():
    f = _item()
    out = apply_wiring(SKILL, _out(nudges=[f]), _ack("nudges_due", f))
    assert out["counts"]["waiting_on"] == 0
    assert out["counts"]["tasks"] == 0
    assert out["counts"]["nudges_due"] == 0


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_an_item_with_no_entity_id_does_not_raise():
    out = apply_wiring(SKILL, _out(nudges=[_item(entity_id=None)]),
                       _ack("nudges_due", _item()))
    assert len(out["nudges_due"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _item()
    data = {"nudges_due": [f], "escalations_due": [], "counts": {"nudges_due": 1}}
    out = apply_wiring(SKILL, data, _ack("nudges_due", f))
    assert len(out["nudges_due"]) == 1
    assert "acknowledged" not in out


def test_the_ladder_key_round_trips_from_any_list():
    first = apply_wiring(SKILL, _out(nudges=[_item()]), {"x": skill_ack.Ack("x")})
    f = first["nudges_due"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    # Handed back from `nudges_due`, applied while the item sits in a DIFFERENT
    # list — which is the whole point of the partition flag.
    again = apply_wiring(SKILL, _out(escalations=[_item()]), acks)
    assert again["escalations_due"] == []
