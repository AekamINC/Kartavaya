"""`require_org_role` takes VARARGS. Passing the tuple whole is a 500.

WHAT HAPPENED
-------------
`routers/niyam_rules.py` shipped ten call sites written

    Depends(require_org_role(ORG_SETTINGS_ROLES))

instead of

    Depends(require_org_role(*ORG_SETTINGS_ROLES))

`ORG_SETTINGS_ROLES` is `("org_admin", "org_owner")`, so `allowed_roles` became
a one-element tuple CONTAINING a tuple. The gate then binds `list(allowed_roles)`
to `$3::text[]`, asyncpg refuses to encode a tuple as a text element, and every
endpoint behind the gate answered 500 — the entire Automations page at once,
reported in the browser as a CORS error because a 500 carries no CORS headers.

WHY A RATCHET AND NOT A CODE REVIEW NOTE
----------------------------------------
Nothing catches it earlier. It imports cleanly, the app starts, the routes
register, and the whole test suite passes — because no test exercised the gate
with a real pool. It only fails when a person opens the page, and the error it
produces (CORS) names neither the gate nor the roles.

It is also easy to write: every other caller in the codebase splats, so the
shape is learned by copying — and a single missed asterisk reads as correct.

The check is positional, not textual: it asks the AST whether the argument is a
`Starred` node, so `require_org_role("org_owner", "org_admin")` — the literal
form `audit.py` uses — is fine, and only a bare NAME argument is refused.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent

#: Gates that take `*roles`. Add to this list, do not generalise it: a function
#: that takes a single collection argument would be a false positive, and the
#: point is to name the ones whose contract is varargs.
VARARG_GATES = ("require_org_role", "require_platform_role")


def _offences(path: Path) -> list[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError:
        return []

    bad = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = getattr(fn, "id", None) or getattr(fn, "attr", None)
        if name not in VARARG_GATES:
            continue
        for arg in node.args:
            # A splat is fine. A string literal is fine. A bare NAME is the bug:
            # it is almost always a module-level ROLES tuple passed whole.
            if isinstance(arg, ast.Starred):
                continue
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                continue
            if isinstance(arg, ast.Name):
                try:
                    where = path.relative_to(BACKEND)
                except ValueError:
                    where = path          # a tmp_path probe from the tests above
                bad.append(f"{where}:{node.lineno} — "
                           f"{name}({arg.id}) should be {name}(*{arg.id})")
    return bad


def _modules() -> list[Path]:
    skip = {".venv", "__pycache__", "migrations", "tests"}
    return [p for p in BACKEND.rglob("*.py")
            if not (skip & set(p.relative_to(BACKEND).parts))]


# ── the detector proves itself first ─────────────────────────────────────────

def _probe(src: str, tmp_path: Path) -> list[str]:
    f = tmp_path / "probe.py"
    f.write_text(src, encoding="utf-8")
    return _offences(f)


def test_detector_flags_an_unsplatted_tuple(tmp_path):
    assert _probe("x = Depends(require_org_role(ORG_SETTINGS_ROLES))", tmp_path)


def test_detector_accepts_a_splat(tmp_path):
    assert not _probe("x = Depends(require_org_role(*ORG_SETTINGS_ROLES))", tmp_path)


def test_detector_accepts_literal_roles(tmp_path):
    """`audit.py` writes `require_org_role("org_owner", "org_admin")` and is
    correct — the check must not punish the explicit form."""
    assert not _probe('r = require_org_role("org_owner", "org_admin")', tmp_path)


def test_detector_is_not_fooled_by_prose(tmp_path):
    """This file's own docstring contains the broken form."""
    assert not _probe('"""require_org_role(ORG_SETTINGS_ROLES) is wrong."""', tmp_path)


# ── and then the real tree ───────────────────────────────────────────────────

def test_every_role_gate_is_splatted():
    offences = sorted(o for p in _modules() for o in _offences(p))
    assert not offences, (
        "These gates take *roles. Passing the tuple whole binds a tuple inside "
        "a text[] parameter, which asyncpg refuses — every endpoint behind the "
        "gate answers 500, and the browser reports it as CORS.\n  "
        + "\n  ".join(offences))
