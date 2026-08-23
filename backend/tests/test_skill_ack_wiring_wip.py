"""
check_wip_ageing — the first wiring on a dotted path, and a census that must
survive the filter.

A time entry leaves this list when it is INVOICED. The commonest reason one sits
there for months is a decision the product cannot record: a fixed-fee engagement
where the time will never be billed, or a write-off waiting for a partner. Both
read as "still unbilled" for ever.

The two properties that carry the risk:
  · the rows are a CAPPED SAMPLE. `escalated.entries` and
    `counts.past_escalation_threshold` are the true number past the threshold and
    already exceed `len(rows)` on a capped run — rebuilding either from the
    survivors destroys the one figure that tells a reader the list is a sample.
  · `billable` is a TRI-STATE, and `False` must not collide with `None`.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

SKILL = "check_wip_ageing"
W = ACK_WIRING[SKILL]


def _e(entry_id="e-1", hours=6.5, billable=None, age=91, **kw) -> dict:
    row = {
        "entry_id": entry_id,
        "task_id": "t-4",
        "task": "Draft the tax computation",
        "task_status": "done",
        "engagement": "Sharma audit",
        "person": "Priya Nair",
        "worked_on": "2026-05-24",
        "age_days": age,
        "hours": hours,
        "billable": billable,
        "billability": ("not recorded" if billable is None
                        else "billable" if billable else "write-off"),
        "rate_per_hour": 2500.0,
        "note": "reviewed the ledgers",
    }
    row.update(kw)
    return row


def _out(rows, entries=91) -> dict:
    rows = list(rows)
    return {
        "as_at": "2026-08-23",
        "escalate_after_days": 30,
        "counts": {
            "unbilled_entries": 412,
            "past_escalation_threshold": entries,
            "past_threshold_and_confirmed_billable": 12,
            "past_threshold_and_unclassified": 79,
            "engagements_listed": 9,
            "people_listed": 6,
            "escalated_rows_listed": len(rows),
            "capped_at": 200,
            "was_capped": False,
        },
        "coverage": [{"of": 12, "in": 91}],
        "hours": {"unbilled_total": 980.5, "confirmed_billable": 61.0,
                  "wip_at_least": 152500.0, "wip_at_most": 2451250.0},
        "rupees": {"status": "a range"},
        "ageing_bands": [{"band": "over 90", "hours": 410.0}],
        "escalated": {
            "threshold_days": 30,
            # THE CENSUS. Already larger than `rows` whenever the list is capped.
            "entries": entries,
            "hours": 410.0,
            "rows": rows,
        },
        "by_engagement": [{"engagement": "Sharma audit", "entries": 41}],
        "by_person": [{"person": "Priya Nair", "entries": 22}],
        "could_not_check": [],
        "limitations": ["Nothing here is invoiced by this skill."],
    }


def _ack(f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(W.identity_of(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_entry_stops_being_reported():
    f = _e()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["escalated"]["rows"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Sharma audit — Priya Nair"


def test_the_findings_are_read_through_the_nesting():
    assert W.findings_at == "escalated.rows"
    keep, hide = _e(entry_id="e-1"), _e(entry_id="e-2")
    out = apply_wiring(SKILL, _out([keep, hide]), _ack(hide))
    assert [r["entry_id"] for r in out["escalated"]["rows"]] == ["e-1"]


def test_the_age_ticking_does_not_void_the_acknowledgement():
    """`age_days` IS in `_DRIFT_FIELDS`, so putting it in either bucket would
    raise rather than fail silently — but the behaviour is pinned anyway."""
    acks = _ack(_e(age=91))
    assert apply_wiring(SKILL, _out([_e(age=210)]), acks)["escalated"]["rows"] == []


def test_a_corrected_duration_brings_it_back():
    acks = _ack(_e(hours=2.0))
    out = apply_wiring(SKILL, _out([_e(hours=20.0)]), acks)
    assert len(out["escalated"]["rows"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_recording_the_billability_brings_it_back_once():
    """`billable` is the DECISION the acknowledgement stands in for. A firm that
    acknowledges an old entry and then marks it a write-off has answered the
    question properly, and the finding should return once so the reader sees
    that it did."""
    acks = _ack(_e(billable=None))
    out = apply_wiring(SKILL, _out([_e(billable=False)]), acks)
    assert len(out["escalated"]["rows"]) == 1


def test_not_recorded_and_write_off_are_two_states():
    """A tri-state: True, False, and None for "not recorded". `_canon` tags the
    boolean and the None separately, so `False` cannot collide with `None` —
    which would make marking an entry a write-off invisible."""
    states = {skill_ack.state_hash(W.material_of(_e(billable=b)))
              for b in (True, False, None)}
    assert len(states) == 3


def test_the_task_closing_does_not_orphan_the_acknowledgement():
    """A task can close while its time stays unbilled. `task_status` and the
    prose `billability` are incidental."""
    acks = _ack(_e(task_status="in_progress"))
    out = apply_wiring(SKILL, _out([_e(task_status="done", note="reworded")]), acks)
    assert out["escalated"]["rows"] == []


def test_two_entries_on_one_task_are_two_findings():
    """The fact being acknowledged is one person's one stretch of work, so the
    key is `entry_id` and not `task_id`."""
    one, two = _e(entry_id="e-1"), _e(entry_id="e-2")
    out = apply_wiring(SKILL, _out([one, two]), _ack(one))
    assert [r["entry_id"] for r in out["escalated"]["rows"]] == ["e-2"]


# ── the census must survive ─────────────────────────────────────────────────

def test_the_census_is_not_rebuilt_from_the_sample():
    """`escalated.entries` and `past_escalation_threshold` are the true number
    past the threshold and already exceed `len(rows)` on a capped run.
    Rebuilding either from the survivors destroys the one figure that tells a
    reader the list is a sample."""
    f = _e()
    out = apply_wiring(SKILL, _out([f], entries=91), _ack(f))
    assert out["escalated"]["entries"] == 91
    assert out["counts"]["past_escalation_threshold"] == 91
    assert out["escalated"]["rows"] == []


def test_only_the_listed_row_count_is_rebuilt():
    keep, hide = _e(entry_id="e-1"), _e(entry_id="e-2")
    out = apply_wiring(SKILL, _out([keep, hide]), _ack(hide))
    assert out["counts"]["escalated_rows_listed"] == 1
    assert out["counts"]["past_escalation_threshold"] == 91


def test_the_hours_and_rupees_are_left_alone():
    """The handler is at pains that `rupees` is a RANGE because so much is
    unclassified. A filter has no business narrowing it."""
    f = _e()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["hours"]["unbilled_total"] == 980.5
    assert out["hours"]["wip_at_most"] == 2451250.0
    assert out["escalated"]["hours"] == 410.0
    assert out["ageing_bands"] == [{"band": "over 90", "hours": 410.0}]
    assert out["coverage"] == [{"of": 12, "in": 91}]


def test_the_aggregation_lists_are_untouched():
    """`by_engagement` and `by_person` are aggregations of the same time, not
    findings. Acknowledging a summary line would silence a heading while the
    entries under it carried on being reported."""
    f = _e()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["by_engagement"] == [{"engagement": "Sharma audit", "entries": 41}]
    assert out["by_person"] == [{"person": "Priya Nair", "entries": 22}]
    assert out["counts"]["engagements_listed"] == 9
    assert out["counts"]["people_listed"] == 6


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_an_entry_with_no_id_does_not_raise():
    out = apply_wiring(SKILL, _out([_e(entry_id=None)]), _ack(_e()))
    assert len(out["escalated"]["rows"]) == 1


def test_a_missing_nesting_fails_open():
    f = _e()
    data = {"rows": [f], "counts": {"escalated_rows_listed": 1}}
    out = apply_wiring(SKILL, data, _ack(f))
    assert len(out["rows"]) == 1
    assert "acknowledged" not in out


def test_the_wip_key_round_trips():
    first = apply_wiring(SKILL, _out([_e()]), {"x": skill_ack.Ack("x")})
    f = first["escalated"]["rows"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out([_e()]), acks)["escalated"]["rows"] == []
