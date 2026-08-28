"""Switching a module ON is `org_owner` only, and an org_admin must not reach it.

WHY THIS TEST EXISTS, AND WHY IT IS HERE RATHER THAN IN THE E2E SUITE
--------------------------------------------------------------------
Proposal 93's Suite 19 provisions modules from the platform console, and it
needs one thing to be true for that suite to have a reason to exist at all:
**the customer cannot do it themselves.** Suite 19 originally asserted that by
firing a real `PATCH /api/v1/org/modules` with an org-scoped credential and
expecting a refusal.

That assertion was correct and it was in the wrong layer. `check-e2e-no-bypass.mjs`
enforces proposal 93 rule 1 — *"nothing is posted straight to an API"* — and it
flagged the probe, rightly: the ratchet cannot tell a write that creates a row
from a write that is expected to be refused, and teaching it to would be
teaching it to ignore things. The gate was mine to break and mine not to weaken.

So the question moved to the layer that owns it. Whether an endpoint refuses a
role is a property of the endpoint, not of a user journey, and asserting it here
costs no browser and cannot rot into an exemption.

WHAT IS ACTUALLY AT STAKE
-------------------------
`routers/org_modules.py` states it in its own words, and it is a real
escalation rather than a tidiness rule:

    an org_admin could hand themselves Vetana — payroll — in one request,
    with no grant, no owner involved and no second step.

The mechanism is `middleware/subscription.py`: gate 2 short-circuits for BOTH
org roles, so an `org_admin` already reaches every ACTIVE module with no grant
row at all. Activation is therefore the only thing standing between an admin and
payroll, which is why enabling is `org_owner` only — and why disabling is too,
since it revokes payroll for the whole organisation at once.

WHY IT IS AN AST CHECK AND NOT A LIVE CALL
------------------------------------------
Same reasoning as `test_role_gate_is_splatted.py`: the failure this guards
against is someone *widening the tuple* — `ORG_SETTINGS_ROLES` instead of
`ORG_OWNER_ONLY` is a one-word edit that reads as correct, imports cleanly,
starts the app, and passes every test that does not name the roles out loud.

The expectation is written as a LITERAL, deliberately. A test that asserted
"the gate is whatever `ORG_OWNER_ONLY` happens to be" would keep passing if
someone added `org_admin` to that constant — the assertion would move with the
mistake. Naming `org_owner` here means widening the constant breaks a test that
says which role it just admitted.

⚠ `require_org_role` additionally admits `platform_admin` unconditionally — god
mode, existing behaviour across every org-scoped route. That is not asserted as
absent here, because it is not this gate's business; it is Suite 19's whole
premise, and Suite 19 proves the console path positively.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
ROUTER = BACKEND / "routers" / "org_modules.py"

#: The one role that may flip a module. Written out, not imported — see the
#: docstring: importing the constant would make the assertion move with the bug.
OWNER_ONLY = ("org_owner",)

#: The handlers that CHANGE a subscription, and must therefore be owner-only.
WRITE_HANDLERS = ("patch_modules",)


def _tree() -> ast.Module:
    return ast.parse(ROUTER.read_text(encoding="utf-8"), filename=str(ROUTER))


def _role_gate_of(fn: ast.AsyncFunctionDef | ast.FunctionDef) -> list[str] | None:
    """The role names in this handler's `require_org_role(...)` dependency.

    Returns None when the handler has no such dependency at all, which is a
    different and worse failure than having the wrong one — an ungated write.
    """
    for arg in list(fn.args.args) + list(fn.args.kwonlyargs):
        pass  # names are irrelevant; the gate lives in the DEFAULTS

    for default in list(fn.args.defaults) + list(fn.args.kw_defaults):
        if not isinstance(default, ast.Call):
            continue
        # Depends(require_org_role(*ORG_OWNER_ONLY))
        if not (isinstance(default.func, ast.Name) and default.func.id == "Depends"):
            continue
        if not default.args:
            continue
        inner = default.args[0]
        if not isinstance(inner, ast.Call):
            continue
        fname = inner.func.id if isinstance(inner.func, ast.Name) else None
        if fname != "require_org_role":
            continue

        roles: list[str] = []
        for a in inner.args:
            # `require_org_role(*ORG_OWNER_ONLY)` — resolve the starred NAME
            # against the module's own constant, which is what the code runs.
            if isinstance(a, ast.Starred) and isinstance(a.value, ast.Name):
                roles.extend(_resolve_constant(a.value.id))
            elif isinstance(a, ast.Constant) and isinstance(a.value, str):
                roles.append(a.value)
            elif isinstance(a, ast.Name):
                # A bare NAME is the `test_role_gate_is_splatted` bug — a tuple
                # passed whole. That test owns it; here it simply is not a role.
                roles.append(f"<unsplatted {a.value if hasattr(a, 'value') else a.id}>")
        return roles
    return None


def _resolve_constant(name: str) -> tuple[str, ...]:
    """Read a role tuple out of `middleware/role_tiers.py` by its literal value."""
    tiers = (BACKEND / "middleware" / "role_tiers.py").read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(tiers)):
        target = None
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target, value = node.target.id, node.value
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target, value = node.targets[0].id, node.value
        if target != name or value is None:
            continue
        if isinstance(value, ast.Tuple):
            return tuple(
                e.value for e in value.elts
                if isinstance(e, ast.Constant) and isinstance(e.value, str)
            )
    raise AssertionError(f"{name} is not a literal tuple in middleware/role_tiers.py")


@pytest.mark.parametrize("handler", WRITE_HANDLERS)
def test_changing_a_subscription_is_owner_only(handler: str) -> None:
    fns = [
        n for n in ast.walk(_tree())
        if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef)) and n.name == handler
    ]
    assert fns, f"{handler} no longer exists in routers/org_modules.py"

    roles = _role_gate_of(fns[0])
    assert roles is not None, (
        f"{handler} writes `module_subscriptions` and has NO require_org_role "
        "dependency. An ungated activation lets any caller switch payroll on."
    )
    assert tuple(roles) == OWNER_ONLY, (
        f"{handler} is gated on {tuple(roles)}, not {OWNER_ONLY}.\n"
        "  middleware/subscription.py gate 2 short-circuits for BOTH org roles, so an\n"
        "  org_admin already reaches every ACTIVE module with no grant row. If an\n"
        "  org_admin can also ACTIVATE, they can hand themselves Vetana — payroll —\n"
        "  in one request, with no grant, no owner involved and no second step.\n"
        "  Widen this deliberately or not at all."
    )


def test_the_owner_only_constant_still_means_one_role() -> None:
    """The gate above is only as strong as the tuple behind it.

    `ORG_OWNER_ONLY` is what `patch_modules` splats. If somebody adds
    `org_admin` to it, every assertion written as "the gate equals
    ORG_OWNER_ONLY" would follow the change and stay green. This names the
    membership out loud so that widening the constant fails here.
    """
    assert _resolve_constant("ORG_OWNER_ONLY") == OWNER_ONLY, (
        "ORG_OWNER_ONLY has changed. It gates switching a module on and org "
        "security; both are one-request escalations to payroll if an admin is "
        "admitted. See routers/org_modules.py's header."
    )
