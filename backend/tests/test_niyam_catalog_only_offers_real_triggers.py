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
APP_DIRS = ("routers", "services")
APP_FILES = ("server.py",)


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
