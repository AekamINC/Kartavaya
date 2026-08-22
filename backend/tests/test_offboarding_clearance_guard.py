"""The clearance guard that has never fired.

`POST /v1/manav/offboarding/{id}/complete` refuses to close an exit while
clearance is outstanding. Its own docstring states the reason: "what it cannot
do is close silently and discover next quarter that a laptop was never
returned." It read the column like this:

    pending = [c.get("item") for c in clearance
               if isinstance(c, dict) and not c.get("done")]

correct for the ARRAY `_DEFAULT_CLEARANCE` writes — six `{item, owner, done}`
objects — and silently vacuous for anything else. Iterating a jsonb OBJECT
yields its KEYS; every key is a string; `isinstance("hr", dict)` is False;
`pending` comes back empty; the refusal passes.

MEASURED LIVE, 2026-08-22, `staging.manav_offboarding` (11 rows):

    array    1 row     the shape 083 and `_DEFAULT_CLEARANCE` specify
    object  10 rows    {"hr": false, "finance": false, "it_assets": true}
                       — 8 still open, and 2 ALREADY CLOSED this way

So ten of the eleven exits in the product could be completed with an unreturned
laptop on them, and two already were. `ExitsTab.jsx`'s `asClearance()` returned
`[]` for the object shape too, so the screen showed an empty checklist rather
than a half-ticked one — which is why nobody looked.

The ten object rows are NOT repaired here. They are somebody's real clearance
state, and rewriting a customer's data to suit our newer shape is a different
decision from reading what is there; it is in `docs/OWNER-ACTIONS.md`. The guard
does not wait for that answer — it reads both shapes.
"""
import pytest

from routers.manav import _pending_clearance


# ── The array shape, which always worked ────────────────────────────────────

def test_an_array_with_an_unticked_item_is_outstanding():
    assert _pending_clearance([
        {"item": "Laptop returned", "owner": "IT", "done": True},
        {"item": "ID card returned", "owner": "Admin", "done": False},
    ]) == ["ID card returned"]


def test_a_fully_ticked_array_is_clear():
    assert _pending_clearance([
        {"item": "Laptop returned", "done": True},
        {"item": "ID card returned", "done": True},
    ]) == []


# ── The object shape, which is 10 of the 11 live rows ───────────────────────

def test_the_object_shape_is_no_longer_read_as_nothing_outstanding():
    """The whole bug, in one assertion."""
    pending = _pending_clearance({"hr": False, "finance": False, "it_assets": True})
    assert pending, "an object-shaped checklist still reports nothing outstanding"
    assert set(pending) == {"hr", "finance"}


def test_the_object_shape_names_items_a_person_recognises():
    """Underscores read as spaces — the refusal is shown to a human."""
    assert _pending_clearance({"it_assets": False}) == ["it assets"]


def test_a_fully_ticked_object_is_clear():
    assert _pending_clearance({"hr": True, "finance": True, "it_assets": True}) == []


# ── The shapes that are neither ─────────────────────────────────────────────

def test_an_empty_checklist_is_clear_and_not_an_error():
    """An exit created with `clearance: []` said so on purpose;
    `_DEFAULT_CLEARANCE` is what fills an OMISSION."""
    assert _pending_clearance([]) == []
    assert _pending_clearance(None) == []
    assert _pending_clearance({}) == []


@pytest.mark.parametrize("value", ["not json at all", 7, "{broken", True])
def test_an_unreadable_checklist_is_one_outstanding_item_not_none(value):
    """An unreadable checklist is not a completed one.

    The refusal is recoverable — amending the checklist is a control the screen
    already offers. A silent close is not.
    """
    assert _pending_clearance(value) == ["the clearance checklist could not be read"]


def test_a_json_string_is_parsed_into_whichever_shape_it_holds():
    """asyncpg hands jsonb back as a str on some paths."""
    assert _pending_clearance('[{"item": "Laptop", "done": false}]') == ["Laptop"]
    assert _pending_clearance('{"hr": false}') == ["hr"]


# ── The handler actually uses it ────────────────────────────────────────────

def test_complete_offboarding_reads_the_checklist_through_this_helper():
    import inspect

    from routers.manav import complete_offboarding

    src = inspect.getsource(complete_offboarding)
    assert "_pending_clearance(" in src
    # And no second copy of the old comprehension has been left behind.
    assert 'isinstance(c, dict) and not c.get("done")' not in src
