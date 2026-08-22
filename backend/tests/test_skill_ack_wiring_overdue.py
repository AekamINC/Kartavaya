"""
The find_overdue family's wirings, and the ways each could be silently wrong.

Five registry names share one handler (`services/skills/data/overdue_finder.py`)
and therefore one return shape, so the shape-level properties are asserted once
per skill through a parametrised body rather than copied five times. What is NOT
shared is the judgement: each skill has its own ack set, and the test that
matters most here is that an acknowledgement in one ledger cannot silence a
finding in another.

Every failure mode below is silent in production.
"""
from __future__ import annotations

import pytest

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

#: The wired members of the family, with the `module` value their handler emits.
#: A name appears here in the commit that wires it and not before.
OVERDUE_SKILLS = {
    "find_overdue_invoices": "invoices",
    "find_overdue_vendor_bills": "vendor_bills",
}


def _finding(module: str, **kw) -> dict:
    """One finding in exactly the shape `find_overdue` emits.

    `reachable()` attaches `email`, `phone` and `link` where the row has them,
    so they are here: a wiring that read them would be reading contact details,
    not facts about the debt.
    """
    row = {
        "entity": {
            "id": "3f7c1a52-0b1e-4f8a-9d21-6a5b4c3d2e10",
            "label": "INV-1042",
            "module": module,
        },
        "owner": "user_7",
        "owner_name": "Priya Nair",
        "days_past": 12,
        "email": "priya@example.com",
        "phone": "+91 98765 43210",
        "link": "/vikray/invoices/3f7c1a52-0b1e-4f8a-9d21-6a5b4c3d2e10",
    }
    row.update(kw)
    return row


def _out(findings) -> dict:
    """What the dispatcher hands the ack layer.

    The handler returns a bare LIST; `_run_function_step` wraps a non-dict
    result as `{"result": ...}` before the ack block runs. If that wrapping ever
    stops, `findings_at="result"` finds nothing and the wiring fails open —
    which is the assertion in `test_a_shape_change_fails_open_not_closed`.
    """
    return {"result": list(findings)}


def _ack_for(skill: str, finding: dict, **kw) -> dict[str, skill_ack.Ack]:
    """An ack recorded against *finding* exactly as the endpoint records it."""
    wiring = ACK_WIRING[skill]
    key = skill_ack.finding_key(wiring.identity_of(finding))
    state = (skill_ack.state_hash(wiring.material_of(finding))
             if wiring.material_of else None)
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", **kw)}


# ── 1 · it works at all ─────────────────────────────────────────────────────

@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_an_acknowledged_row_stops_being_reported(skill, module):
    f = _finding(module)
    out = apply_wiring(skill, _out([f]), _ack_for(skill, f))
    assert out["result"] == []
    assert out["acknowledged"]["count"] == 1
    assert out["acknowledged"]["items"][0]["label"] == "INV-1042 — Priya Nair"


@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_no_ack_set_means_no_reshape(skill, module):
    out = apply_wiring(skill, _out([_finding(module)]), {})
    assert len(out["result"]) == 1
    # No `acknowledged` block, so no UI renders "0 acknowledged" on a list
    # nobody has ever acknowledged anything in.
    assert "acknowledged" not in out


# ── 2 · THE ONE THAT DECIDES WHETHER ANYONE USES THIS ───────────────────────

@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_the_day_counter_ticking_does_not_void_the_acknowledgement(skill, module):
    """`days_past` is the only field in this shape that moves on its own.

    In IDENTITY it would mint a fresh key every night, so no acknowledgement
    would ever match again. In MATERIAL it would void every acknowledgement at
    midnight. Both look identical to a user: they ack forty rows, come back
    tomorrow, find forty rows, and never ack anything again.
    """
    acks = _ack_for(skill, _finding(module, days_past=12))
    out = apply_wiring(skill, _out([_finding(module, days_past=97)]), acks)
    assert out["result"] == [], (
        "the acknowledgement died because the day count ticked — check that "
        "days_past is in NEITHER identity_of nor material_of"
    )


# ── 3 · identity survives everything that is not the row ────────────────────

@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_reassigning_the_row_does_not_orphan_the_acknowledgement(skill, module):
    """`owner` and `owner_name` say who to ring, not which row this is. A task
    handed to somebody else is the same late task; an employee who married and
    changed their name has not created a new finding."""
    acks = _ack_for(skill, _finding(module))
    out = apply_wiring(skill, _out([
        _finding(module, owner="user_9", owner_name="Aadhya Iyer")
    ]), acks)
    assert out["result"] == []


@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_relabelling_the_row_does_not_orphan_the_acknowledgement(skill, module):
    """A corrected invoice number or a renamed task is the same overdue thing.
    Had `label` been in IDENTITY, a typo fix would silently resurrect it."""
    acks = _ack_for(skill, _finding(module))
    f = _finding(module)
    f["entity"] = dict(f["entity"], label="INV-1042-A")
    assert apply_wiring(skill, _out([f]), acks)["result"] == []


@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_a_different_row_is_not_suppressed(skill, module):
    """The failure that would make this feature dangerous rather than useless:
    one ack silencing the whole list."""
    acks = _ack_for(skill, _finding(module))
    other = _finding(module)
    other["entity"] = dict(other["entity"], id="99999999-0000-4000-8000-000000000001")
    assert len(apply_wiring(skill, _out([other]), acks)["result"]) == 1


# ── 4 · the ledgers are separate ────────────────────────────────────────────

def test_an_ack_in_one_ledger_cannot_silence_another():
    """Five skills, one handler, one shape. `module` is in IDENTITY so that a
    key computed for an invoice cannot match a task even before the (org, skill)
    scoping of the ack table is taken into account — belt and braces, because
    the cost of getting it wrong is a hidden unpaid invoice."""
    invoice_key = skill_ack.finding_key(
        ACK_WIRING["find_overdue_invoices"].identity_of(_finding("invoices")))
    task_shaped = ACK_WIRING["find_overdue_invoices"].identity_of(_finding("tasks"))
    assert skill_ack.finding_key(task_shaped) != invoice_key


# ── 5 · the degenerate shapes must not blow up ──────────────────────────────

@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_a_finding_with_no_entity_does_not_raise(skill, module):
    """`entity.id` is a primary key and cannot be null, but a shape change is
    not an exception: the wiring degrades to a key nothing was ever filed under,
    so the finding survives and is shown."""
    acks = _ack_for(skill, _finding(module))
    out = apply_wiring(skill, _out([{"owner_name": "Unassigned", "days_past": 3}]), acks)
    assert len(out["result"]) == 1


@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_a_shape_change_fails_open_not_closed(skill, module):
    """If the dispatcher stopped wrapping the list, or the handler started
    returning a dict of its own, the findings are shown unfiltered. Showing an
    acknowledged invoice is a nuisance; hiding an unacknowledged one is a
    missed payment."""
    data = {"entities": [_finding(module)]}
    out = apply_wiring(skill, data, _ack_for(skill, _finding(module)))
    assert out["entities"] == [_finding(module)]
    assert "acknowledged" not in out


# ── 6 · the annotation the UI hands back ────────────────────────────────────

@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_the_handed_back_key_round_trips(skill, module):
    """The end-to-end property: run, take `_ack_key`/`_ack_state` off a finding,
    store them the way the endpoint does, run again, finding is gone.

    `_ack_state` is None for this family — the wiring records unconditional
    acknowledgements because the shape carries no amount and no status — and the
    round trip has to work with that None rather than in spite of it. Had the
    ack been stored WITH a state while the wiring filters without one,
    `partition_by_ack` would raise `MissingMaterialError` instead of silently
    suppressing nothing.
    """
    first = apply_wiring(skill, _out([_finding(module)]), {"x": skill_ack.Ack("x")})
    f = first["result"][0]
    assert f["_ack_state"] is None

    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(skill, _out([_finding(module)]), acks)["result"] == []


# ── 7 · nothing is derived, so nothing can go stale ─────────────────────────

@pytest.mark.parametrize("skill,module", sorted(OVERDUE_SKILLS.items()))
def test_recompute_is_none_because_there_is_nothing_to_rebuild(skill, module):
    """`recompute=None` is an assertion about the return shape, not a default:
    the dispatcher's wrapper is `{"result": [...]}` and carries no total, no
    count and no bucket split. If the handler ever grows one, this fails and the
    wiring must grow a recompute with it."""
    assert ACK_WIRING[skill].recompute is None
    out = apply_wiring(skill, _out([_finding(module)]), _ack_for(skill, _finding(module)))
    assert set(out) == {"result", "acknowledged"}


# ── 8 · the wiring is registered where the family says it is ────────────────

def test_every_wired_family_member_reads_the_dispatcher_wrapper_key():
    """`findings_at="result"` is not a key any handler writes — it is the name
    `_run_function_step` gives a non-dict result. A wiring that named a
    handler-side key would filter nothing, for ever, silently."""
    for skill in OVERDUE_SKILLS:
        assert ACK_WIRING[skill].findings_at == "result"
