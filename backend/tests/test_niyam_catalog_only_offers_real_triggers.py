"""The builder may only offer triggers the product actually emits.

THE DEFECT THIS PREVENTS, WHICH NIYAM EXISTED TO REMOVE
-------------------------------------------------------
The old Tasks builder offered eight triggers of which SIX were strings nothing
emitted. A person could build a rule, save it, and wait for ever. Niyam's whole
premise is "a broken rule is unwritable" — and it shipped offering
`contact.created` and `deal.stage_changed`, both fully defined in `subjects.py`,
both with no caller anywhere in the product.

The arming guard bounds it but does not remove it. A rule on an unemitted
trigger can never record a run, so arming is refused — with a message that says
"let it record a few dry runs first". That is a misdiagnosis: it tells the
author to wait for something that cannot happen.

WHAT MAKES THIS A RATCHET RATHER THAN A COMMENT
The test derives what is emitted FROM THE CODE — app call sites for event
triggers, predicate declarations for temporal ones — and compares it with what
the catalog offers. Wire an emitter and the test keeps passing once the name
leaves `UNWIRED`; offer a trigger with no emitter and it fails, whichever
direction the mistake comes from.
"""
from __future__ import annotations

import ast
import io
import pathlib

import pytest

from services.niyam import registry, subjects

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: Where a real emitter call site may live. Deliberately EXCLUDES
#: `services/niyam/` (defining a function is not calling it) and `tests/`
#: (a test that emits proves only that a test emits).
APP_DIRS = ("routers", "services", "middleware")
#: Root-level modules that mount routes. `server.py` alone missed
#: `approvals_router.py` and `invite_router.py` (both mounted) and
#: `auth_router.py` — so an emitter wired in any of them would have read as
#: "nothing emits this". Review found the gap; it could not produce a false PASS,
#: but it could have produced a false FAIL on correctly wired code.
APP_FILES = ("server.py", "auth_router.py", "approvals_router.py",
             "invite_router.py")


def _emitter_names() -> dict[str, str]:
    """`subjects.py` helper name -> the event type it emits.

    Read off the module rather than hardcoded, so renaming a helper cannot
    quietly empty this test.
    """
    src = io.open(ROOT / "services" / "niyam" / "subjects.py", encoding="utf-8").read()
    tree = ast.parse(src)
    consts = {n.targets[0].id: n.value.value
              for n in tree.body
              if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
              and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
    out = {}
    for fn in tree.body:
        if not isinstance(fn, ast.AsyncFunctionDef) or fn.name.startswith("_"):
            continue
        for node in ast.walk(fn):
            if isinstance(node, ast.keyword) and node.arg == "event_type":
                if isinstance(node.value, ast.Name) and node.value.id in consts:
                    out[fn.name] = consts[node.value.id]
    return out


def _called_in_the_app() -> set[str]:
    """Emitter helpers with at least one call site OUTSIDE services/niyam."""
    called = set()
    files = [ROOT / f for f in APP_FILES]
    for d in APP_DIRS:
        files += [p for p in (ROOT / d).rglob("*.py")
                  if "niyam" not in p.parts and "__pycache__" not in p.parts]
    names = set(_emitter_names())
    for path in files:
        try:
            tree = ast.parse(io.open(path, encoding="utf-8").read())
        except SyntaxError:                     # pragma: no cover
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", "")
                if name in names:
                    called.add(name)
    return called


def _temporal_event_types() -> set[str]:
    """Event types the sweep emits, read from the predicate declarations."""
    src = io.open(ROOT / "services" / "niyam" / "predicates.py", encoding="utf-8").read()
    tree = ast.parse(src)
    subj = io.open(ROOT / "services" / "niyam" / "subjects.py", encoding="utf-8").read()
    consts = {n.targets[0].id: n.value.value
              for n in ast.parse(subj).body
              if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
              and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg == "event_type":
            if isinstance(node.value, ast.Name) and node.value.id in consts:
                out.add(consts[node.value.id])
    return out


def _emitted_event_types() -> set[str]:
    by_name = _emitter_names()
    return {by_name[n] for n in _called_in_the_app() if n in by_name} | _temporal_event_types()


@pytest.mark.parametrize("event_type", registry.catalog_event_types())
def test_every_offered_trigger_is_actually_emitted(event_type):
    """The load-bearing one. If this fails, the builder is selling a rule that
    can never fire — and the author will be told to wait for a dry run that
    cannot arrive."""
    emitted = _emitted_event_types()
    assert event_type in emitted, (
        f"the builder offers {event_type!r} but nothing in the product emits it. "
        f"Either wire an emitter, or add it to registry.UNWIRED. "
        f"Emitted today: {sorted(emitted)}"
    )


def test_the_catalog_is_not_empty():
    """A guard on the guard.

    The load-bearing test is parametrised over `catalog_event_types()`, and
    pytest's default for an empty parameter set is SKIP, not fail. So emptying
    REGISTRY — or adding every event to UNWIRED — would silently retire the
    ratchet and leave this file green with nothing checked. Review found it.
    """
    offered = registry.catalog_event_types()
    assert len(offered) >= 6, (
        f"the builder offers only {len(offered)} triggers ({offered}); if that is "
        "intended, lower this floor deliberately — but the parametrised test "
        "above SKIPS rather than fails on an empty list, so something has to "
        "notice"
    )


def test_the_unwired_set_is_not_a_dumping_ground():
    """Every name in UNWIRED must be a real registry entry. A stale name there
    silently stops hiding anything and nobody would notice."""
    unknown = registry.UNWIRED - set(registry.REGISTRY)
    assert not unknown, f"UNWIRED names events that are not in REGISTRY: {unknown}"


def test_unwired_events_never_reach_the_catalog():
    assert not (set(registry.catalog_event_types()) & registry.UNWIRED)


def test_the_crm_emitters_still_exist_for_whoever_wires_them():
    """UNWIRED hides them from the builder; it must not become an excuse to
    delete the work. `subjects.py` keeps the emitters ready to call."""
    assert hasattr(subjects, "contact_created")
    assert hasattr(subjects, "deal_stage_changed")


def test_the_registry_still_knows_how_to_evaluate_them():
    """The engine's ability to evaluate an event is independent of the product's
    ability to emit one. Wiring an emitter must not also require rebuilding the
    field list."""
    for et in registry.UNWIRED:
        assert registry.fields_for(et), f"{et} lost its field definitions"


# ── THE WITHDRAWAL MUST BE ENFORCED, NOT MERELY DISPLAYED ────────────────────

def test_an_unwired_trigger_is_refused_by_the_validator_not_just_hidden():
    """Hiding it from `GET /catalog` fixed the builder and nothing else.

    Review proved the API still accepted it: `validate_event_type` gated on
    `REGISTRY`, which deliberately still holds both withdrawn types, so a client
    posting the event_type directly got a 201 — and the rule it saved can never
    fire, can never accumulate a run, and therefore can never be armed, with a
    422 telling its author to wait for dry runs that cannot happen.
    """
    from services.niyam.validate import RuleInvalid, validate_event_type

    for event_type in sorted(registry.UNWIRED):
        try:
            validate_event_type(event_type)
        except RuleInvalid:
            continue
        raise AssertionError(
            f"POST /rules would still accept {event_type!r}: the catalog hides "
            "it but the validator does not refuse it"
        )


def test_the_refusal_does_not_advertise_the_withdrawn_triggers():
    """The old message listed every REGISTRY key as a valid choice — including
    the two it was in the middle of refusing."""
    from services.niyam.validate import RuleInvalid, validate_event_type

    try:
        validate_event_type("nonsense.event")
    except RuleInvalid as exc:
        for withdrawn in registry.UNWIRED:
            assert withdrawn not in exc.message, (
                f"the 'choose one of' list still offers {withdrawn!r}, which "
                "nothing emits"
            )
        for offered in registry.catalog_event_types():
            assert offered in exc.message,                 f"the refusal should name {offered!r} as a real choice"
    else:
        raise AssertionError("an unknown event type was accepted")


def test_an_existing_rule_on_a_withdrawn_trigger_stays_editable():
    """Withdrawing a trigger must not strand a rule somebody already saved.

    `PATCH /rules/{id}` validates steps against the rule's STORED event_type and
    never re-checks the type, so a rule created before the withdrawal can still
    be renamed, disabled and deleted. If `validate_steps` ever starts calling
    `validate_event_type`, this breaks and the owner of that rule is locked out
    of their own automation.
    """
    from services.niyam.validate import validate_steps

    for event_type in sorted(registry.UNWIRED):
        steps = validate_steps(event_type, [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "contact_stale", "to": ["@creator"],
                        "title": "x", "body": "y"}},
        ])
        assert steps, f"an existing {event_type} rule can no longer be edited"
