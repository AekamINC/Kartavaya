"""
check_approvals_that_sit — the skill whose own limitation asks for this feature.

In the handler's words: "Run daily, this names the same approvals every day
until they are decided." It cannot subtract what was already sent, because
`staging.reminders.entity_id` is a uuid and `public.approvals.approval_id` is
text, so no approval chase can ever be recorded and every row reports
`chases_delivered: 0` for ever.

That defect is also why this is one of the few wirings whose `material_of=None`
is FORCED rather than chosen: the only field that could carry movement is a
constant.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_approvals_that_sit"
W = ACK_WIRING[SKILL]


def _a(approval_id="ap-1", action="ping the approver", days=9, waiting_on=("Priya",),
       aged=False, deleted=False, project="Sharma audit", **kw) -> dict:
    row = {
        "kind": "approval",
        "approval_id": approval_id,
        "task_ref": "t-9",
        "project": project,
        "project_deleted": deleted,
        "what": "Leave request",
        "request_type": "leave",
        "requested_by": "Rahul",
        "raised_on": "2026-08-14",
        "days_waiting": days,
        "chases_delivered": 0,
        "chase_history_available": False,
        "rung_the_age_alone_would_reach": 3 if aged else 1,
        "aged_past_escalation": aged,
        "waiting_on": list(waiting_on) if waiting_on else None,
        "escalate_to": ["Keval"],
        "escalation_is_a_role_not_a_manager": True,
        "action": action,
        "rung": 1,
        "direction": "inward",
        "why": f"{days} day(s) waiting",
    }
    row.update(kw)
    return row


def _out(ping=(), copy=(), esc=(), quiet=(), orphaned=()) -> dict:
    ping, copy, esc = list(ping), list(copy), list(esc)
    quiet, orphaned = list(quiet), list(orphaned)
    live = ping + copy + esc + quiet
    return {
        "as_at": "2026-08-23",
        "ladder": [{"days_waiting": 3, "action": "ping the approver",
                    "direction": "inward"}],
        "escalates_to": ["Keval"],
        "counts": {
            "pending": len(live) + len(orphaned),
            "on_a_live_project": len(live),
            "on_a_deleted_project": len(orphaned),
            "action_due_now": len(ping) + len(copy) + len(esc),
            "ping_the_approver": len(ping),
            "copy_the_requester": len(copy),
            "escalations_due": len(esc),
            "aged_past_escalation": sum(1 for i in live if i["aged_past_escalation"]),
            "with_no_approver_to_ping": sum(1 for i in live if not i["waiting_on"]),
            "nothing_due_yet": len(quiet),
            # A status census over the WHOLE table, not a sum over these lists.
            "approvals_all_statuses": 412,
            "decided": 398,
            "capped_at": 200,
            "was_capped": False,
        },
        "by_status": {"pending": 14, "approved": 380, "rejected": 18},
        "ping_the_approver": ping,
        "copy_the_requester": copy,
        "escalations_due": esc,
        "waiting_but_nothing_due": quiet,
        "on_a_deleted_project": orphaned,
        "limitations": ["IT NEVER SENDS AND NEVER WRITES."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key, state_hash=None,
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_approval_stops_being_reported():
    f = _a()
    out = apply_wiring(SKILL, _out(ping=[f]), _ack("ping_the_approver", f))
    assert out["ping_the_approver"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Leave request — Sharma audit"


def test_climbing_the_ladder_does_not_orphan_the_acknowledgement():
    """The five lists partition the pending approvals by what to do next, and
    an approval moves between them as the days pass. Folded, the ack would be
    orphaned at every move."""
    acks = _ack("ping_the_approver", _a(days=9))
    out = apply_wiring(SKILL, _out(esc=[_a(action="escalate inside the firm", days=30)]),
                       acks)
    assert out["escalations_due"] == []


def test_a_deleted_project_does_not_orphan_the_acknowledgement():
    """An approval whose project is deleted moves to its own list. It is the
    same request; nobody can act on it either way."""
    acks = _ack("ping_the_approver", _a())
    gone = _a(deleted=True, action="cannot be chased — the project was deleted")
    assert apply_wiring(SKILL, _out(orphaned=[gone]), acks)["on_a_deleted_project"] == []


def test_two_approvals_are_two_findings():
    one, two = _a(approval_id="ap-1"), _a(approval_id="ap-2")
    out = apply_wiring(SKILL, _out(ping=[one, two]), _ack("ping_the_approver", one))
    assert [f["approval_id"] for f in out["ping_the_approver"]] == ["ap-2"]


def test_moving_or_retitling_the_request_does_not_orphan_it():
    acks = _ack("ping_the_approver", _a(project="Sharma audit"))
    out = apply_wiring(SKILL, _out(ping=[
        _a(project="Sharma tax", what="Leave request (revised)",
           requested_by="Aisha")]), acks)
    assert out["ping_the_approver"] == []


def test_the_acknowledgement_is_unconditional_because_nothing_can_move():
    """`material_of=None` is FORCED here, not chosen: `chases_delivered` is
    pinned at 0 on every row for ever and `rung` at one, so a constant is the
    only thing that could have carried movement. The two fields that DO move —
    `rung_the_age_alone_would_reach` and `aged_past_escalation` — move with the
    calendar alone, which is why they are in neither bucket."""
    assert W.material_of is None
    acks = _ack("ping_the_approver", _a(days=9, aged=False))
    aged = _a(days=99, aged=True, rung_the_age_alone_would_reach=3)
    assert apply_wiring(SKILL, _out(ping=[aged]), acks)["ping_the_approver"] == []
    first = apply_wiring(SKILL, _out(ping=[_a()]), {"x": skill_ack.Ack("x")})
    assert first["ping_the_approver"][0]["_ack_state"] is None


# ── the counts ──────────────────────────────────────────────────────────────

def test_every_count_that_sums_the_lists_is_rebuilt():
    keep = _a(approval_id="ap-1")
    hide = _a(approval_id="ap-2")
    esc = _a(approval_id="ap-3", action="escalate inside the firm")
    orph = _a(approval_id="ap-4", deleted=True)
    out = apply_wiring(SKILL, _out(ping=[keep, hide], esc=[esc], orphaned=[orph]),
                       _ack("ping_the_approver", hide))
    c = out["counts"]
    assert c["ping_the_approver"] == 1
    assert c["escalations_due"] == 1
    assert c["action_due_now"] == 2
    assert c["on_a_live_project"] == 2
    assert c["on_a_deleted_project"] == 1
    assert c["pending"] == 3


def test_the_two_counts_a_limitation_quotes_are_rebuilt():
    """A paragraph saying "4 pending approval(s) have nobody to ping" above a
    list of one is the reports-page defect in prose."""
    nobody = _a(approval_id="ap-1", waiting_on=None)
    somebody = _a(approval_id="ap-2", aged=True)
    out = apply_wiring(SKILL, _out(ping=[nobody, somebody]),
                       _ack("ping_the_approver", nobody))
    assert out["counts"]["with_no_approver_to_ping"] == 0
    assert out["counts"]["aged_past_escalation"] == 1


def test_the_status_census_is_left_alone():
    """`approvals_all_statuses`, `decided` and `by_status` count the whole
    table. An org that acknowledged every pending approval has not decided any
    of them."""
    f = _a()
    out = apply_wiring(SKILL, _out(ping=[f]), _ack("ping_the_approver", f))
    assert out["counts"]["approvals_all_statuses"] == 412
    assert out["counts"]["decided"] == 398
    assert out["by_status"] == {"pending": 14, "approved": 380, "rejected": 18}
    assert out["counts"]["capped_at"] == 200


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_an_approval_with_no_id_does_not_raise():
    out = apply_wiring(SKILL, _out(ping=[_a(approval_id=None)]),
                       _ack("ping_the_approver", _a()))
    assert len(out["ping_the_approver"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _a()
    data = _out(ping=[f])
    del data["on_a_deleted_project"]
    out = apply_wiring(SKILL, data, _ack("ping_the_approver", f))
    assert len(out["ping_the_approver"]) == 1
    assert "acknowledged" not in out


def test_the_approvals_key_round_trips_across_lists():
    first = apply_wiring(SKILL, _out(ping=[_a()]), {"x": skill_ack.Ack("x")})
    f = first["ping_the_approver"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    again = apply_wiring(SKILL, _out(esc=[_a(action="escalate inside the firm")]), acks)
    assert again["escalations_due"] == []
