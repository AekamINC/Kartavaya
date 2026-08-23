"""
The multi-list mechanism, tested on a synthetic wiring rather than a real skill.

`findings_at` took a single string because that is the shape the first wiring
happened to need. Nine real skills return several lists, and wiring only the
first list of such a skill is worse than not wiring it: the button appears, half
the findings answer to it, and the other half repeat for ever under a feature
that looks finished.

The wiring under test here is DELIBERATELY not a real skill. This file is about
the mechanism — cross-list identity, the recompute's argument, the all-or-
nothing shape check — and pinning it to a real handler's fields would mean a
change to that handler could fail these tests for reasons that have nothing to
do with the mechanism.

The property that matters most is the third block: the same subject appearing in
two lists must not share one key. Getting it wrong means acknowledging the mild
finding silences the severe one, silently.
"""
from __future__ import annotations

import pytest

from services import skill_ack
from services.skill_ack_wiring import (ACK_WIRING, AckWiring, _buckets_of,
                                       _identity_for, apply_wiring)

SKILL = "_test_two_list_skill"


def _recompute(out: dict, surviving) -> None:
    """An aggregate that SPANS both lists — the case the mapping exists for."""
    out["seen"] = surviving                      # what the mechanism handed over
    out["counts"] = {
        "blockers": len(surviving["blockers"]),
        "warnings": len(surviving["warnings"]),
        "total": len(surviving["blockers"]) + len(surviving["warnings"]),
    }


@pytest.fixture
def wired():
    """Register a two-list wiring for the duration of one test."""
    ACK_WIRING[SKILL] = AckWiring(
        findings_at=("blockers", "warnings"),
        identity_of=lambda f: {"check": f.get("check"), "who": f.get("who")},
        material_of=lambda f: {"amount": f.get("amount")},
        recompute=_recompute,
        label_of=lambda f: f"{f.get('check')} — {f.get('who')}",
    )
    try:
        yield ACK_WIRING[SKILL]
    finally:
        del ACK_WIRING[SKILL]


def _f(check="no_salary_structure", who="EMP-1", amount=None) -> dict:
    return {"check": check, "who": who, "amount": amount, "detail": "…"}


def _out(blockers=(), warnings=()) -> dict:
    blockers, warnings = list(blockers), list(warnings)
    return {
        "month": "2026-08",
        "blockers": blockers,
        "warnings": warnings,
        "counts": {"blockers": len(blockers), "warnings": len(warnings),
                   "total": len(blockers) + len(warnings)},
    }


def _ack_for(wiring, bucket: str, finding: dict, **kw) -> dict[str, skill_ack.Ack]:
    """An ack recorded exactly as the endpoint records it — through the same
    identity function the filter will use, bucket name and all."""
    identity_of = _identity_for(wiring, bucket)
    key = skill_ack.finding_key(identity_of(finding))
    state = (skill_ack.state_hash(wiring.material_of(finding))
             if wiring.material_of else None)
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", **kw)}


# ── 1 · the single-key form is untouched ────────────────────────────────────

def test_a_single_key_wiring_still_declares_one_bucket():
    assert _buckets_of(ACK_WIRING["propose_payment_run"]) == ("bills",)


def test_a_single_key_wiring_gets_its_own_identity_function_back():
    """Not a wrapper. Every key already computed by `propose_payment_run` and
    the nine that followed it stays byte-identical, so no acknowledgement
    recorded before this change is orphaned by it."""
    wiring = ACK_WIRING["propose_payment_run"]
    assert _identity_for(wiring, "bills") is wiring.identity_of


def test_a_single_key_recompute_is_still_handed_a_plain_list():
    """The compatibility promise, asserted rather than assumed: not one
    existing entry had to be rewritten to suit a shape it does not have."""
    seen = {}

    ACK_WIRING["_test_one_list"] = AckWiring(
        findings_at="rows",
        identity_of=lambda f: {"id": f.get("id")},
        material_of=None,
        recompute=lambda out, surviving: seen.update(kind=type(surviving)),
        label_of=lambda f: str(f.get("id")),
    )
    try:
        apply_wiring("_test_one_list", {"rows": [{"id": 1}]},
                     {"x": skill_ack.Ack("x")})
    finally:
        del ACK_WIRING["_test_one_list"]

    assert seen["kind"] is list


# ── 2 · both lists are actually filtered ────────────────────────────────────

def test_a_finding_in_the_second_list_can_be_acknowledged(wired):
    """The whole point. Wiring only the first list would leave these repeating
    for ever under a feature that looks finished."""
    w = _f(check="outstanding_advance", who="EMP-9", amount=4200.0)
    out = apply_wiring(SKILL, _out(warnings=[w]), _ack_for(wired, "warnings", w))
    assert out["warnings"] == []
    assert out["acknowledged"]["count"] == 1


def test_a_finding_in_the_first_list_can_be_acknowledged(wired):
    b = _f()
    out = apply_wiring(SKILL, _out(blockers=[b]), _ack_for(wired, "blockers", b))
    assert out["blockers"] == []


def test_the_acknowledged_block_counts_across_both_lists(wired):
    b, w = _f(who="EMP-1"), _f(check="outstanding_advance", who="EMP-2")
    acks = {**_ack_for(wired, "blockers", b), **_ack_for(wired, "warnings", w)}
    out = apply_wiring(SKILL, _out(blockers=[b], warnings=[w]), acks)
    assert out["acknowledged"]["count"] == 2
    assert sorted(i["label"] for i in out["acknowledged"]["items"]) == [
        "no_salary_structure — EMP-1", "outstanding_advance — EMP-2"]


# ── 3 · THE ONE THAT MATTERS · identity is unique ACROSS the lists ──────────

def test_acknowledging_a_warning_does_not_silence_the_blocker(wired):
    """The same subject can appear in both lists in one run — an employee with
    no salary structure (they are not paid at all) who also has an advance
    whose recovery will be capped. If both hash to one key, acknowledging the
    mild one silences the severe one, silently, in the direction that costs
    somebody their salary.

    The wiring's own `identity_of` reads only `check` and `who`, so this
    property comes from the MECHANISM folding the list name in — which is
    exactly where it belongs, because a per-wiring guarantee is one every
    future entry has to remember and none of them will fail loudly if they
    forget.
    """
    same = _f(check="same_code", who="EMP-1")
    out = apply_wiring(SKILL, _out(blockers=[same], warnings=[same]),
                       _ack_for(wired, "warnings", same))
    assert out["warnings"] == [], "the warning should have been suppressed"
    assert len(out["blockers"]) == 1, (
        "acknowledging the WARNING suppressed the BLOCKER — identity is not "
        "unique across the lists"
    )


def test_the_two_lists_produce_two_different_keys(wired):
    """The static form of the case above, straight off the identity
    functions, so a refactor that stopped folding the bucket name fails here
    and not only through behaviour."""
    same = _f(check="same_code", who="EMP-1")
    blocker_key = skill_ack.finding_key(_identity_for(wired, "blockers")(same))
    warning_key = skill_ack.finding_key(_identity_for(wired, "warnings")(same))
    assert blocker_key != warning_key


def test_a_finding_that_moves_between_lists_is_orphaned_on_purpose(wired):
    """A warning that becomes a blocker is a different, more severe finding.
    Orphaning the acknowledgement is the correct outcome: somebody should look
    at it again."""
    f = _f(check="unapproved_leave", who="EMP-4")
    acks = _ack_for(wired, "warnings", f)
    out = apply_wiring(SKILL, _out(blockers=[f]), acks)
    assert len(out["blockers"]) == 1


def test_the_handed_back_key_round_trips_from_the_second_list(wired):
    """`_ack_key` must be computed with the SAME folded identity the filter
    uses, or the endpoint files the ack under a key nothing ever looks up — an
    acknowledgement that appears to work and suppresses nothing, for ever."""
    first = apply_wiring(SKILL, _out(warnings=[_f()]), {"x": skill_ack.Ack("x")})
    f = first["warnings"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(warnings=[_f()]), acks)["warnings"] == []


# ── 4 · the material bucket still voids, in either list ─────────────────────

def test_an_amount_that_moves_brings_a_warning_back(wired):
    acks = _ack_for(wired, "warnings", _f(amount=4200.0))
    out = apply_wiring(SKILL, _out(warnings=[_f(amount=8400.0)]), acks)
    assert len(out["warnings"]) == 1
    assert out["acknowledged"]["count"] == 0


# ── 5 · the recompute sees every list ───────────────────────────────────────

def test_the_recompute_is_handed_a_mapping_of_all_the_lists(wired):
    """An aggregate can span the lists. A recompute called once per list could
    only ever rebuild such a total from half its inputs — the reports-page
    defect arrived at through the back door."""
    b, w = _f(who="EMP-1"), _f(check="outstanding_advance", who="EMP-2")
    out = apply_wiring(SKILL, _out(blockers=[b], warnings=[w]),
                       _ack_for(wired, "blockers", b))
    assert set(out["seen"]) == {"blockers", "warnings"}
    assert out["seen"]["blockers"] == []
    assert len(out["seen"]["warnings"]) == 1


def test_a_total_that_spans_both_lists_is_rebuilt_from_both(wired):
    b, w = _f(who="EMP-1"), _f(check="outstanding_advance", who="EMP-2")
    out = apply_wiring(SKILL, _out(blockers=[b], warnings=[w]),
                       _ack_for(wired, "blockers", b))
    assert out["counts"] == {"blockers": 0, "warnings": 1, "total": 1}
    assert out["counts"]["total"] == len(out["blockers"]) + len(out["warnings"])


# ── 6 · the shape check is all-or-nothing ───────────────────────────────────

def test_one_missing_list_leaves_everything_unfiltered(wired):
    """Filtering the lists that survived a handler's shape change while
    recomputing a total across the shape it no longer has is the one outcome
    worse than not filtering at all."""
    b = _f()
    data = {"blockers": [b], "counts": {"blockers": 1, "warnings": 0, "total": 1}}
    out = apply_wiring(SKILL, data, _ack_for(wired, "blockers", b))
    assert len(out["blockers"]) == 1
    assert "acknowledged" not in out
    assert out["counts"]["total"] == 1


def test_a_list_that_became_something_else_leaves_everything_unfiltered(wired):
    b = _f()
    data = _out(blockers=[b])
    data["warnings"] = {"count": 0}          # a dict where a list was
    out = apply_wiring(SKILL, data, _ack_for(wired, "blockers", b))
    assert len(out["blockers"]) == 1
    assert "acknowledged" not in out


def test_no_ack_set_is_still_a_no_op(wired):
    out = apply_wiring(SKILL, _out(blockers=[_f()]), {})
    assert "acknowledged" not in out
    assert "seen" not in out


# ── 7 · every wiring declares a shape the mechanism understands ─────────────

def test_every_wiring_names_at_least_one_bucket():
    for name, w in ACK_WIRING.items():
        buckets = _buckets_of(w)
        assert buckets, f"{name} names no findings list"
        assert all(isinstance(b, str) and b for b in buckets), name
        assert len(set(buckets)) == len(buckets), (
            f"{name} names the same list twice, which would filter it once and "
            f"then filter the already-filtered result again")


# ── 8 · when the lists are ONE POPULATION, folding is wrong ─────────────────

@pytest.fixture
def partitioned():
    """A wiring whose lists partition one population, as `check_chase_ladder`'s
    four do: an item is in exactly one of them and moves between them as the
    clock runs."""
    ACK_WIRING[SKILL] = AckWiring(
        findings_at=("due_now", "not_yet"),
        identity_of=lambda f: {"entity_id": f.get("entity_id")},
        material_of=None,
        recompute=None,
        label_of=lambda f: str(f.get("entity_id")),
        lists_are_one_population=True,
    )
    try:
        yield ACK_WIRING[SKILL]
    finally:
        del ACK_WIRING[SKILL]


def test_a_partitioned_wiring_keeps_one_key_across_its_lists(partitioned):
    """The case folding gets wrong. An item that moves from `not_yet` to
    `due_now` because a day passed has not become a different item — and a
    ladder moves each of its items several times, so folding would cost the
    user three acknowledgements of one task in a fortnight."""
    item = {"entity_id": "task-1"}
    acks = _ack_for(partitioned, "not_yet", item)
    out = apply_wiring(SKILL, {"due_now": [item], "not_yet": []}, acks)
    assert out["due_now"] == [], (
        "the acknowledgement was orphaned by the item moving between lists — "
        "lists_are_one_population=True must switch the folding off")


def test_a_partitioned_wiring_gets_its_own_identity_function_back(partitioned):
    assert _identity_for(partitioned, "due_now") is partitioned.identity_of
    assert _identity_for(partitioned, "not_yet") is partitioned.identity_of


def test_the_flag_defaults_to_folding(wired):
    """The safe answer stays the default: a wiring that says nothing gets the
    guarantee, and only a wiring that CLAIMS its lists partition one population
    gives it up."""
    assert wired.lists_are_one_population is False
    same = _f(check="same_code", who="EMP-1")
    assert (skill_ack.finding_key(_identity_for(wired, "blockers")(same))
            != skill_ack.finding_key(_identity_for(wired, "warnings")(same)))


def test_every_existing_wiring_states_which_shape_it_is():
    """A single-list wiring cannot be either, and the flag must not be set on
    one — it would read as a claim about lists that do not exist."""
    for name, w in ACK_WIRING.items():
        if isinstance(w.findings_at, str):
            assert w.lists_are_one_population is False, (
                f"{name} names one list; lists_are_one_population is a claim "
                f"about several")
