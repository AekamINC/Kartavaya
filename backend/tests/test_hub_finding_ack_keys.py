"""The handle a finding carries so somebody can dismiss it.

`skill_ack_wiring.apply_wiring` attaches `_ack_key` and `_ack_state` to every
surviving finding — and returns the handler's output UNTOUCHED when the org
holds no acknowledgements. It is right to: an `acknowledged: {count: 0}` block
on a list nobody has ever acknowledged anything in would have every screen
render "0 acknowledged" for ever.

The cost was that no org had ever held an acknowledgement, so no finding had
ever carried a key, so no client could ask for the first one. `skill_finding_ack`
held zero rows on 2026-08-27 and the door was locked from the inside.

`routers/hub.py:_with_ack_keys` separates the KEY from the FILTER: the handle
goes on every finding of a wired skill whether or not anything is hidden, and
`apply_wiring` keeps sole charge of hiding. Everything below is a property that,
if it broke, would break silently:

  §1  THE KEY IS THE SAME KEY. If it drifts from what `apply_wiring` computes,
      the acknowledgement is filed under something the filter never looks up —
      an ack that appears to work and suppresses nothing, for ever, with a
      healthy-looking table to prove it. This is the whole reason the private
      helpers are imported rather than re-derived.
  §2  IT RETURNS A COPY. `data` also becomes `prior_facts`, the text a later AI
      step is grounded on. Annotating in place spends a third of a 4,000-char
      prompt window on digests no model can use.
  §3  IT NEVER RAISES and FAILS OPEN. A skill that ran and found something must
      not become a failed step because a wiring tripped over a row.
  §4  NO ID IS LEAKED. The key is a digest precisely so a row's raw UUID can be
      a stable INPUT without ever becoming an output.
"""
import json

import pytest

from routers.hub import _with_ack_keys
from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring


def _bill(**over):
    return {
        "bill": "INV-2291", "vendor": "Sharma Traders",
        "balance_due": 42000, "status": "approved",
        "days_past_due": 63, "ageing": "61-90",
        **over,
    }


# ── §1 · The key is the key the filter will look up ────────────────────────

def test_the_key_matches_what_the_filter_computes():
    """The one property everything else rests on.

    Recorded under one key and filtered under another is the silent failure
    `services/skill_ack.py` is written against, and no runtime symptom of it
    looks like anything other than the feature working.
    """
    data = {"bills": [_bill()], "total_due": 42000, "by_bucket": {}}
    row = _with_ack_keys("propose_payment_run", data)["bills"][0]

    ack = skill_ack.Ack(row["_ack_key"], state_hash=row["_ack_state"])
    out = apply_wiring("propose_payment_run", json.loads(json.dumps(data)),
                       {row["_ack_key"]: ack})
    assert out["bills"] == []
    assert out["acknowledged"]["count"] == 1


def test_a_finding_in_two_lists_gets_two_keys():
    """`check_payroll_readiness` reports one employee as a BLOCKER (they are not
    paid at all) and as a WARNING (an advance whose recovery is capped). Sharing
    a key would mean acknowledging the mild one silences the severe one — in the
    direction that costs somebody their salary."""
    same = {"employee": "Priya Nair", "check": "no_salary_structure", "amount": 42000}
    out = _with_ack_keys("check_payroll_readiness",
                         {"blockers": [dict(same)], "warnings": [dict(same)]})
    assert out["blockers"][0]["_ack_key"] != out["warnings"][0]["_ack_key"]


def test_lists_that_are_one_population_share_a_key():
    """`check_chase_ladder` moves an item between four lists purely with the
    calendar, so folding the list name in would orphan its acknowledgement up to
    three times as the clock pushed it up the ladder."""
    assert ACK_WIRING["check_chase_ladder"].lists_are_one_population is True
    item = {"kind": "task", "task_ref": "task_1f59", "what": "File GSTR-1",
            "entity_type": "tasks", "rung": 1, "action": "first nudge",
            "days_past_due": 55}
    a = _with_ack_keys("check_chase_ladder", {"nudges_due": [dict(item)],
                                              "escalations_due": [],
                                              "expired_and_must_be_reissued": [],
                                              "waiting_but_nothing_due": []})
    b = _with_ack_keys("check_chase_ladder", {"nudges_due": [],
                                              "escalations_due": [dict(item)],
                                              "expired_and_must_be_reissued": [],
                                              "waiting_but_nothing_due": []})
    assert a["nudges_due"][0]["_ack_key"] == b["escalations_due"][0]["_ack_key"]


def test_the_day_counter_ticking_does_not_change_the_key():
    """`days_past_due` and `ageing` move with the calendar and nothing else. In
    the key they mint a fresh handle every midnight; in the state they void
    every acknowledgement every midnight. Both are silent."""
    today = _with_ack_keys("propose_payment_run", {"bills": [_bill()]})["bills"][0]
    tomorrow = _with_ack_keys(
        "propose_payment_run",
        {"bills": [_bill(days_past_due=64, ageing="61-90")]})["bills"][0]
    assert today["_ack_key"] == tomorrow["_ack_key"]
    assert today["_ack_state"] == tomorrow["_ack_state"]


def test_the_state_moves_when_the_money_moves():
    """Somebody acknowledged a bill of 42,000, not one of 84,000."""
    a = _with_ack_keys("propose_payment_run", {"bills": [_bill()]})["bills"][0]
    b = _with_ack_keys("propose_payment_run",
                       {"bills": [_bill(balance_due=84000)]})["bills"][0]
    assert a["_ack_key"] == b["_ack_key"]
    assert a["_ack_state"] != b["_ack_state"]


def test_a_wiring_with_no_material_records_an_unconditional_state():
    """`None` is a real value on the way to the endpoint — it says "suppress
    this however the numbers move" — and it must be present rather than absent,
    or the client cannot tell it from a field the server forgot."""
    unconditional = [k for k, w in ACK_WIRING.items() if w.material_of is None]
    if not unconditional:
        pytest.skip("every wiring currently declares material fields")
    name = unconditional[0]
    wiring = ACK_WIRING[name]
    bucket = wiring.findings_at if isinstance(wiring.findings_at, str) \
        else list(wiring.findings_at)[0]
    out = _with_ack_keys(name, {b: [] for b in (
        [wiring.findings_at] if isinstance(wiring.findings_at, str)
        else list(wiring.findings_at))} | {bucket: [{}]})
    assert out[bucket][0]["_ack_state"] is None
    assert "_ack_state" in out[bucket][0]


# ── §2 · It returns a copy ─────────────────────────────────────────────────

def test_the_original_is_not_annotated():
    """`data` becomes `prior_facts`, which grounds a later AI step's prompt. Two
    32-character digests per row is a third of `check_chase_ladder`'s window
    spent on hashes."""
    data = {"bills": [_bill()]}
    before = json.dumps(data, sort_keys=True, default=str)
    _with_ack_keys("propose_payment_run", data)
    assert json.dumps(data, sort_keys=True, default=str) == before


def test_a_dotted_bucket_does_not_leak_through_the_shallow_copy():
    """`check_wip_ageing` keeps its rows at `escalated.rows`, beside the
    threshold they are a sample of. A shallow copy of the top level shares that
    inner dict, so writing through it would annotate the original after all."""
    data = {"escalated": {"threshold": 90, "rows": [
        {"entity": {"id": "e-1"}, "client": "Trilok", "hours": 12,
         "wip_at_most": 42000},
    ]}}
    before = json.dumps(data, sort_keys=True, default=str)
    out = _with_ack_keys("check_wip_ageing", data)
    assert json.dumps(data, sort_keys=True, default=str) == before
    assert out["escalated"]["rows"][0]["_ack_key"]
    assert out["escalated"]["threshold"] == 90


# ── §3 · It never raises, and fails open ───────────────────────────────────

def test_an_unwired_skill_gets_the_same_object_back():
    """46 of the 78 are unwired. The identity must be the SAME OBJECT, because
    the caller skips a second serialisation on that check."""
    data = {"rows": [{"a": 1}]}
    assert _with_ack_keys("aggregate_kpis", data) is data


def test_a_handler_that_changed_shape_is_returned_untouched():
    """Showing a finding that was acknowledged is a nuisance; losing one that
    was not is a missed payment. Unfiltered is the safe direction."""
    data = {"rows": [{"a": 1}]}                      # wiring names `bills`
    assert _with_ack_keys("propose_payment_run", data) is data
    assert _with_ack_keys("propose_payment_run", {"bills": "not a list"}) \
        == {"bills": "not a list"}
    assert _with_ack_keys("propose_payment_run", ["not a dict"]) == ["not a dict"]


def test_a_wiring_that_raises_costs_the_control_and_not_the_finding(monkeypatch):
    """A skill that ran and found four unfillable orders must not become a
    failed step because `label_of` tripped over one of them."""
    wiring = ACK_WIRING["propose_payment_run"]
    monkeypatch.setattr(
        type(wiring), "label_of",
        property(lambda self: (_ for _ in ()).throw(RuntimeError("boom"))),
        raising=False,
    )
    data = {"bills": [_bill()]}
    out = _with_ack_keys("propose_payment_run", data)
    assert out["bills"][0]["bill"] == "INV-2291"
    assert "_ack_key" not in out["bills"][0]


def test_a_list_of_strings_under_a_wired_key_is_carried_through():
    out = _with_ack_keys("check_impossible_stock", {"findings": ["a bare string"]})
    assert out["findings"] == ["a bare string"]


# ── §4 · Nothing renderable leaks ──────────────────────────────────────────

def test_no_handle_can_ever_be_a_uuid():
    """Some findings key on a raw row id — an excellent stable INPUT and an
    unacceptable output. Migration 159's CHECK is `^[0-9a-f]{16,128}$`, which
    structurally refuses a dashed UUID; this asserts the values that reach it."""
    data = {"escalated": {"rows": [
        {"entity": {"id": "3f6b1e2a-0c11-4a4b-9d2e-6a1f2b3c4d5e"},
         "client": "Trilok", "hours": 12, "wip_at_most": 42000},
    ]}}
    row = _with_ack_keys("check_wip_ageing", data)["escalated"]["rows"][0]
    for field in ("_ack_key", "_ack_state"):
        assert "-" not in row[field], field
        assert row[field] == row[field].lower()


def test_the_label_is_stripped_of_contact_details():
    """Aekam staff read this table across orgs, so a customer's email address in
    a label leaks it through a support screen that is otherwise correctly
    scoped. Stripped rather than rejected: losing the acknowledgement is worse
    than losing the wording."""
    row = _with_ack_keys(
        "propose_payment_run",
        {"bills": [_bill(vendor="Sharma Traders accounts@sharma.co.in")]},
    )["bills"][0]
    assert "@" not in row["_ack_label"]
    assert "INV-2291" in row["_ack_label"]
