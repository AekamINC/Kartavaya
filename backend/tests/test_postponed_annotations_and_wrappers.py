"""A router may not combine postponed annotations with a wrapping decorator.

── THE BUG THIS EXISTS TO STOP ───────────────────────────────────────────────

`routers/custody.py` carried `from __future__ import annotations` and decorated
three handlers with `@limiter.limit(...)`. Postponed annotations make every
parameter annotation a STRING, which FastAPI resolves against the handler's
`__globals__` — and a `functools.wraps` wrapper carries the DECORATOR's globals,
not the decorated module's. `CustodyLine` is not resolvable from inside slowapi,
so FastAPI gave up on the body parameter and treated it as a query parameter:

    {"type":"missing","loc":["query","body"],"msg":"Field required"}

`POST /offboarding/{employee_id}/lines` answered **422 on every call**, for as
long as the router had existed. Nobody could record a custody line.

── WHY IT WAS INVISIBLE ──────────────────────────────────────────────────────

It did not reproduce on this machine. Python 3.14 resolves these through PEP
649's `__annotate__` closure and gets the right answer; the container pins
**3.13**, which goes through `__globals__` and does not. The local suite was
green — 14,519 passing — while CI failed eleven tests with
`PydanticUserError: TypeAdapter[Annotated[ForwardRef('CustodyLine'), Query(...)]]
is not fully defined`.

`memory/backend_suite_27_failures_at_head` already records the general form:
*"27 is a Python-3.14 number; the container pins 3.13 and a green suite hid a
live 422."* This is that, again, with a different 422.

── WHY THE CHECK IS ON THE SOURCE ────────────────────────────────────────────

The runtime symptom only appears under 3.13, so a test that builds the app and
asserts on the route would pass here and fail there — useless as a guard on the
machine where the code is written. The COMBINATION is visible in any Python, so
that is what is asserted.

It is deliberately narrow: postponed annotations are fine, and `@limiter.limit`
is fine — it is on everything auth-shaped, by policy. Only together, in a module
whose handlers take a Pydantic model, do they break.
"""
from __future__ import annotations

import ast
import pathlib

_ROUTERS = pathlib.Path(__file__).resolve().parent.parent / "routers"

#: Decorators that WRAP the handler and therefore replace `__globals__`.
#: `@router.get`/`@router.post` do not — they register the function and return
#: it unchanged — so they are not the hazard and are not listed.
_WRAPPING = ("limiter.limit",)


def _decorator_names(node: ast.AST) -> list[str]:
    out = []
    for d in getattr(node, "decorator_list", []):
        target = d.func if isinstance(d, ast.Call) else d
        parts = []
        while isinstance(target, ast.Attribute):
            parts.append(target.attr)
            target = target.value
        if isinstance(target, ast.Name):
            parts.append(target.id)
        out.append(".".join(reversed(parts)))
    return out


def _has_postponed_annotations(tree: ast.Module) -> bool:
    return any(
        isinstance(n, ast.ImportFrom) and n.module == "__future__"
        and any(a.name == "annotations" for a in n.names)
        for n in tree.body
    )


def _model_names(tree: ast.Module) -> set[str]:
    """Pydantic models defined in this module — the names that must resolve."""
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and any(
            (isinstance(b, ast.Name) and b.id == "BaseModel")
            or (isinstance(b, ast.Attribute) and b.attr == "BaseModel")
            for b in node.bases
        ):
            out.add(node.name)
    return out


def test_no_router_wraps_a_handler_whose_annotations_are_strings():
    """The rule, stated as the pair that breaks rather than either half."""
    offenders: list[str] = []
    for path in sorted(_ROUTERS.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
        except SyntaxError:  # pragma: no cover — a broken file fails elsewhere
            continue
        if not _has_postponed_annotations(tree):
            continue
        models = _model_names(tree)
        if not models:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            names = _decorator_names(node)
            if not any(w in names for w in _WRAPPING):
                continue
            takes_model = any(
                isinstance(a.annotation, ast.Name) and a.annotation.id in models
                for a in list(node.args.args) + list(node.args.kwonlyargs)
                if a.annotation is not None
            )
            if takes_model:
                offenders.append(f"{path.name}::{node.name}")

    assert not offenders, (
        "these handlers take a Pydantic model, are wrapped by a decorator, and "
        "sit in a module with `from __future__ import annotations`:\n  "
        + "\n  ".join(offenders)
        + "\n\nThe wrapper carries the DECORATOR's globals, so FastAPI cannot "
          "resolve the model name and degrades the body to a query parameter — "
          "a 422 on every call, visible on Python 3.13 and NOT on 3.14. Drop "
          "the `__future__` import from that module; nothing in this codebase "
          "needs it, and 3.13 supports `X | None` natively."
    )


def test_custody_specifically_has_no_postponed_annotations():
    """Named, because the general rule passing is not the same as the reported
    fault being fixed — and this one shipped and answered 422 to real callers."""
    src = (_ROUTERS / "custody.py").read_text(encoding="utf-8", errors="ignore")
    # PARSED, NOT GREPPED. The file explains at length why the import is absent,
    # and that explanation necessarily contains the words — the same reason
    # `test_platform_privacy._literals` reads literals rather than raw source.
    # A substring check here failed on the comment that documents the fix.
    assert not _has_postponed_annotations(ast.parse(src)), (
        "custody.py has postponed annotations again. Its three `@limiter.limit` "
        "handlers take Pydantic bodies, and on Python 3.13 — which the container "
        "pins — that combination makes every one of them 422."
    )
    # And the limiter is still there. Removing IT would also fix the symptom,
    # by taking the rate limit off an endpoint that writes.
    assert "limiter.limit" in src, (
        "the rate limits are gone from custody.py. If that was the fix for the "
        "422, it is the wrong one: these handlers write."
    )
