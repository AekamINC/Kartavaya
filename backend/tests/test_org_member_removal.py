"""Removing a member: the two rules that must never be provable by trying them.

`DELETE /v1/org/members/{id}` can lock a real person out of a real firm, so the
E2E suite deliberately does NOT aim one at a live target — an earlier draft
pointed it at the actual org owner, which would have removed the owner from a
live org in order to demonstrate that removing owners is possible.

The guards are asserted here instead, where the target can be fictional.
"""
import inspect
import re

import routers.org_members as om


def _src() -> str:
    return inspect.getsource(om.remove_member)


def test_only_an_admin_or_owner_may_remove_anyone():
    assert 'require_org_role("org_admin", "org_owner")' in _src(), \
        "member removal is no longer gated on an org role"


def test_you_cannot_remove_yourself():
    """Otherwise the last admin can walk out and lock the door behind them."""
    src = _src()
    assert 'target_user_id == user["user_id"]' in src
    assert "cannot remove yourself" in src.lower()


def test_you_cannot_remove_an_owner():
    """The clearest lock-out in the product: an org whose owner is gone has
    nobody who can grant anything back."""
    src = _src()
    assert "role_code='org_owner'" in src, \
        "the owner check no longer reads the owner role"
    assert re.search(r"if is_owner:\s*raise HTTPException\(\s*403", src), \
        "removing an org owner is no longer refused with a 403"


def test_the_owner_check_runs_before_the_delete():
    """A guard after the DELETE is not a guard."""
    src = _src()
    assert src.index("if is_owner:") < src.index("DELETE FROM staging.user_roles"), \
        "the owner check runs after the row has already been deleted"


def test_removal_also_clears_the_module_grants_and_team_row():
    """A member removed from user_roles but left in org_member_modules and
    team_members is removed from the screen and not from the product."""
    src = _src()
    assert "DELETE FROM staging.org_member_modules" in src
    assert "DELETE FROM team_members" in src
