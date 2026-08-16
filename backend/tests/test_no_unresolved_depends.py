"""A function with `Depends(...)` defaults, called directly, must be passed them.

THE BUG THIS IS THE ANSWER TO
-----------------------------
`update_task` grew an `org=Depends(active_org_id)` parameter on 2026-08-06.
`patch_task` — a route handler that delegates to it with a plain Python call —
was written three months earlier and still passed four arguments. FastAPI
resolves dependencies for ROUTES; a direct call gets the parameter's DEFAULT,
which is the `Depends` sentinel object itself.

That object is truthy. So `get_visible_team_ids` took its org-scoped branch,
`is_org_admin` bound it as `$2::uuid`, and asyncpg raised

    invalid input for query argument $2: Depends(active_org_id)

Every `PATCH /api/tasks/{id}` — the client's "Mark as Reviewed" button — 500'd
for ten days. Nothing failed loudly at import, no test caught it, and the only
symptom was a generic 500.

WHY A CHECK AND NOT A CODE REVIEW
---------------------------------
The defect is invisible at both ends. The callee looks right, the caller looks
right, and they were written by different people three months apart. What is
wrong is the JOIN between them, which is exactly the kind of thing a person
does not re-verify when editing one side. Adding a parameter to a shared
handler is normal; remembering every direct caller is not.

NAME RESOLUTION IS THE WHOLE DIFFICULTY
---------------------------------------
The first draft of this check matched on the bare function name across the
tree and reported 409 offences, of which the true count was one. `create_task`
is also `asyncio.create_task`; `search` is also `re.search`; `register` is
half a dozen unrelated things. A check that cries wolf 408 times out of 409
gets deleted, and deleting it is the correct response.

So a call is only examined when the name actually RESOLVES to a
dependency-bearing function: either defined in the same module, or imported
into it by name from one that defines it. Attribute calls (`asyncio.create_task`)
are never ours, and a local rebinding of the name — a parameter, an assignment,
a nested def — disqualifies the whole module rather than risking a false
accusation.

WHAT IT DOES NOT COVER
----------------------
Calls that splat (`f(*args)` / `f(**kwargs)`) are skipped, because the argument
list is not knowable statically and guessing would produce false accusations.
Those are counted and reported so the blind spot has a size.
"""
from __future__ import annotations

import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]

#: Where the sweep looks. Tests are included deliberately: a test that omits a
#: dependency argument passes a `Depends` object into the function under test
#: and then asserts on the result, which is a green test proving nothing.
ROOTS = ("server.py", "routers", "services", "middleware", "tests")

SKIP_DIRS = {"__pycache__", ".venv", "venv", "node_modules", "migrations"}


def _py_files():
    for root in ROOTS:
        p = BACKEND / root
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in p.rglob("*.py"):
                if not any(part in SKIP_DIRS for part in f.parts):
                    yield f


def _is_depends(node) -> bool:
    """`Depends(x)` or `fastapi.Depends(x)`, and Security() which is a subclass."""
    if not isinstance(node, ast.Call):
        return False
    f = node.func
    name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
    return name in {"Depends", "Security"}


def _dependency_params(fn) -> list[tuple[str, int]]:
    """(name, positional index) for every parameter defaulting to Depends(...).

    Keyword-only parameters get index -1: they can only ever be passed by name.
    """
    out = []
    args = fn.args
    positional = args.posonlyargs + args.args
    # defaults align to the TAIL of the positional list
    offset = len(positional) - len(args.defaults)
    for i, d in enumerate(args.defaults):
        if _is_depends(d):
            out.append((positional[offset + i].arg, offset + i))
    for a, d in zip(args.kwonlyargs, args.kw_defaults):
        if d is not None and _is_depends(d):
            out.append((a.arg, -1))
    return out


def _module_defs(tree) -> dict[str, list]:
    """Dependency-bearing functions DEFINED in one module, by name."""
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            deps = _dependency_params(node)
            if deps:
                out[node.name] = deps
    return out


def _rebound_names(tree) -> set:
    """Names the module binds to something OTHER than a def or an import.

    A module that does `search = compile(...).search`, or takes `user` as a
    parameter, or defines a nested `def create_task`, has a name that no longer
    means what the registry thinks. Rather than track scopes, treat any such
    name as unexaminable in that module — the check is worth having only if it
    never accuses wrongly.
    """
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            out.add(node.id)
        elif isinstance(node, ast.arg):
            out.add(node.arg)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            pass
    return out


def _collect_registry():
    """{module stem: {fn name: deps}} for every backend module in scope."""
    reg = {}
    trees = {}
    for f in _py_files():
        try:
            tree = ast.parse(f.read_text(encoding="utf-8"))
        except SyntaxError:                     # pragma: no cover
            continue
        trees[f] = tree
        defs = _module_defs(tree)
        if defs:
            reg.setdefault(f.stem, {}).update(defs)
    return reg, trees


def _resolvable_here(tree, reg) -> dict[str, list]:
    """Names that, IN THIS MODULE, denote a dependency-bearing function."""
    here = _module_defs(tree)
    rebound = _rebound_names(tree)
    resolved = {n: d for n, d in here.items() if n not in rebound}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            stem = node.module.rsplit(".", 1)[-1]
            for alias in node.names:
                if alias.asname:                # renamed imports are not tracked
                    continue
                deps = reg.get(stem, {}).get(alias.name)
                if deps and alias.name not in rebound:
                    resolved[alias.name] = deps
    return resolved


def scan() -> tuple[list, int]:
    """(offences, count of calls too dynamic to examine). Importable so the
    proof below can run it against an arbitrary source string."""
    reg, trees = _collect_registry()
    offences, splatted = [], 0
    for f, tree in trees.items():
        resolved = _resolvable_here(tree, reg)
        if not resolved:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            deps = resolved.get(node.func.id)
            if not deps or _is_depends(node):
                continue
            if any(isinstance(a, ast.Starred) for a in node.args) or                any(k.arg is None for k in node.keywords):
                splatted += 1
                continue
            given = {k.arg for k in node.keywords}
            n_pos = len(node.args)
            for param, idx in deps:
                if param in given or (0 <= idx < n_pos):
                    continue
                offences.append(
                    f"{f.relative_to(BACKEND).as_posix()}:{node.lineno}: "
                    f"{node.func.id}(...) omits `{param}`, so it receives the "
                    f"unresolved Depends object — FastAPI does not resolve a "
                    f"plain call")
    return offences, splatted


def test_direct_calls_pass_every_dependency():
    reg, _ = _collect_registry()
    assert reg, "found no Depends-defaulted functions at all — the walk is broken"
    offences, splatted = scan()
    print(f"[depends] {sum(len(v) for v in reg.values())} dependency-bearing "
          f"functions; {splatted} splatted call(s) unexaminable")
    assert not offences, chr(10) + chr(10).join(sorted(offences))
