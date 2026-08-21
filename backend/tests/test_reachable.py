"""A finding that names somebody must say how to reach them.

The owner ran a read-only skill, got a list of names, and said the only true
thing about it: "not just two name but its number or point of contact". Twenty
four skills named a person or a company and gave no way to contact them.

This file guards the fix in two directions:

  · `reachable()` itself -- the empty-string rule, the no-bare-id rule, and the
    refusal to invent keys for data that is not there.
  · The handlers that were changed -- a source check that each still calls it.
    A behavioural check would run against the mock pool, which echoes whatever
    the fixture says; the fixture is the thing most likely to be edited when
    somebody removes the columns, so it cannot be the guard.
"""
import ast
import io
from pathlib import Path

import pytest

from services.skills.reachable import _ROUTES, reachable

DATA = Path(__file__).resolve().parents[1] / "services" / "skills" / "data"

#: Every handler file changed so its findings carry a contact. Adding a module
#: here without wiring `reachable` into it fails, which is the point: the list
#: is the promise and the source is the evidence.
WIRED = [
    "payroll_readiness.py", "payroll_statutory.py", "people_checks.py",
    "gst_cliffs.py", "itc_reversal.py", "vendor_compliance.py",
    "recon_rules.py", "inbox_triage.py", "overdue_finder.py",
    "blocked_and_downgraded.py", "ganit_ops.py", "stock_and_crm.py",
]


# ── the helper ──────────────────────────────────────────────────────────────

def test_an_empty_string_is_not_a_contact():
    """`manav_employees.phone` is non-NULL on all 98 rows and BLANK on eleven.

    A blank rendered as a phone number is worse than an absent one, because it
    looks like somebody checked and the answer was nothing.
    """
    out = reachable({"employee": "Aadhya Nair"}, kind="employee",
                    entity_id=None, email="   ", phone="")
    assert out == {"employee": "Aadhya Nair"}
    assert "phone" not in out and "email" not in out


def test_the_string_none_is_not_a_contact_either():
    """asyncpg gives None, but a `::text` cast of a NULL through a COALESCE
    ladder can arrive as the four characters n-o-n-e."""
    out = reachable({"x": 1}, kind="employee", entity_id=None,
                    email="None", phone=None)
    assert "email" not in out


def test_a_bare_id_never_leaves_the_helper():
    """people_checks.py already carried the rule in a comment: "a member UUID
    must not appear in any output". The id belongs in the href and nowhere
    else, so an unroutable kind gets NO link rather than a naked id."""
    out = reachable({"who": "Tara Mehta"}, kind="not_a_real_kind",
                    entity_id="11111111-1111-1111-1111-111111111111")
    assert out == {"who": "Tara Mehta"}
    assert "11111111" not in str(out)


def test_a_routed_kind_gets_a_link_and_only_a_link():
    out = reachable({"employee": "Tara Mehta"}, kind="employee",
                    entity_id="11111111-1111-1111-1111-111111111111")
    assert out["link"] == "/manav/employees/11111111-1111-1111-1111-111111111111"
    assert "employee_id" not in out
    assert len([k for k in out if k != "employee"]) == 1


def test_it_returns_the_same_object_so_it_can_wrap_a_literal():
    row = {"a": 1}
    assert reachable(row, kind="employee", entity_id=None) is row


@pytest.mark.parametrize("kind", sorted(_ROUTES))
def test_every_route_is_absolute_and_takes_exactly_one_id(kind):
    route = _ROUTES[kind]
    assert route.startswith("/"), kind
    assert route.count("%s") == 1, kind
    assert not route.endswith("/"), kind


# ── the handlers ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("filename", WIRED)
def test_the_handler_still_asks_who_to_contact(filename):
    """Read the source, not the output.

    The pool these handlers are tested against is a mock that returns the
    fixture. A test asserting "the row has a phone" proves the fixture has a
    phone. This proves the CALL is still there.
    """
    path = DATA / filename
    tree = ast.parse(io.open(path, encoding="utf-8").read())

    imported = any(
        isinstance(n, ast.ImportFrom)
        and n.module == "services.skills.reachable"
        and any(a.name == "reachable" for a in n.names)
        for n in ast.walk(tree)
    )
    assert imported, "%s no longer imports reachable" % filename

    calls = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        and n.func.id == "reachable"
    ]
    assert calls, "%s imports reachable and never calls it" % filename

    # Every call must pass a `kind`, or the link is silently dropped and the
    # finding quietly loses its click-through with nothing failing.
    for call in calls:
        kws = {k.arg for k in call.keywords}
        assert "kind" in kws, (
            "%s calls reachable() with no kind=; the link would be dropped "
            "silently" % filename)
        assert kws & {"email", "phone", "entity_id"}, (
            "%s calls reachable() with nothing to attach" % filename)
