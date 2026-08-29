"""
test_roles_org_scope.py — a platform row is not a membership.

WHAT THIS PINS

`middleware/roles.py` had two gates that answered a question about ONE
organisation by looking at a row that named NO organisation:

  · `require_org_role` returned the user on a god-mode hit BEFORE the org-scoped
    lookup ran, so god mode passed every org-role gate in every org — org member
    removal, org role changes, module grants, the Manav PII reveal.
  · `is_org_admin(user_id, org_id)` answered True for a platform row held
    anywhere, which is what let `DELETE /api/tasks/bulk` skip its per-id
    project-role check against another org's tasks.

The rules below are written out LITERALLY rather than derived. A test that
computes "everything except the allowed set" cannot notice the allowed set
widening, and a test that greps source cannot tell code from the comment
explaining it — both traps were caught in this repository this week, so the
truth table here is enumerated by hand and the source assertion strips comments
first.

THE POOL IS MOCKED and resolves whatever query it is handed, so the decision
itself is tested as a pure function (`may_act_in_org`) and the two dependencies
are tested only for WHICH questions they ask and WHAT they do with the answers.
"""
import re

import pytest
from unittest.mock import AsyncMock

from fastapi import HTTPException

from middleware.roles import is_org_admin, may_act_in_org, require_org_role
from middleware.role_tiers import (
    GOD_MODE_ROLES,
    ORG_MANAGEMENT_ROLES,
    ORG_ROLES,
)

pytestmark = pytest.mark.anyio

ORG_A = "11111111-1111-1111-1111-111111111111"   # the org being acted on
ORG_B = "22222222-2222-2222-2222-222222222222"   # somebody else's company


# ── the decision, as a table ─────────────────────────────────────────────────
#
# Eight rows because three booleans have eight combinations. Every one is
# spelled out: the pair that changed is (platform, not-a-member), and it is only
# visible next to the pair that did not.

@pytest.mark.parametrize(
    "holds_org_role,holds_platform_role,belongs_to_org,expected",
    [
        # the org's own admin, with and without a platform row
        (True,  False, True,  True),
        (True,  True,  True,  True),
        # god mode inside an org it belongs to — a member, but with a weaker org
        # row than the gate asks for. This is bhoomi@ on an owner-only surface,
        # and keval@ on every owner-only surface in all three orgs.
        (False, True,  True,  True),
        # ── THE FINDING ── god mode in an org it has no row in.
        (False, True,  False, False),
        # an ordinary member with no admin row
        (False, False, True,  False),
        # nobody at all
        (False, False, False, False),
        # holds_org_role implies membership, but the function must not depend on
        # the caller having noticed that.
        (True,  False, False, True),
        (True,  True,  False, True),
    ],
)
async def test_the_decision_table(
    holds_org_role, holds_platform_role, belongs_to_org, expected
):
    assert may_act_in_org(
        holds_org_role=holds_org_role,
        holds_platform_role=holds_platform_role,
        belongs_to_org=belongs_to_org,
    ) is expected


async def test_the_new_rule_never_admits_anyone_the_old_rule_refused():
    """A guard layer may refuse more than it did. It may never allow more.

    The old rule was `platform or org_role`. Enumerated rather than argued,
    because "strictly narrower" is the property that makes this safe to deploy
    into a file every router imports from.
    """
    for org in (False, True):
        for platform in (False, True):
            for member in (False, True):
                old = platform or org
                new = may_act_in_org(
                    holds_org_role=org,
                    holds_platform_role=platform,
                    belongs_to_org=member,
                )
                assert not (new and not old), (org, platform, member)


# ── require_org_role ─────────────────────────────────────────────────────────


def _pool(monkeypatch, *, god, org_role, member):
    """A pool that answers the three questions this dependency asks.

    Routed on SQL text, and the routing is the reason the membership probe is
    written `SELECT 1` while the role lookup is written `SELECT role_code`: with
    both spelled the same way, no test could tell the product apart from a
    product that never asked the third question at all.
    """
    asked = []

    async def _fetchval(sql, *args):
        s = " ".join(str(sql).split())
        asked.append((s, args))
        if "org_id IS NULL" in s:
            return 1 if god else None
        if "SELECT 1 FROM public.user_roles" in s:
            return 1 if member else None
        return org_role

    pool = AsyncMock()
    pool.fetchval = AsyncMock(side_effect=_fetchval)

    async def _get_pool():
        return pool

    monkeypatch.setattr("middleware.roles.get_pool", _get_pool)
    return asked


def _membership_probes(asked):
    """The org-scoped `SELECT 1`. The platform probe is also a `SELECT 1`, and
    what tells THEM apart is `org_id IS NULL` — the three questions are pairwise
    distinguishable, which is the property these tests need and the reason the
    membership probe was not written as a second `SELECT role_code`."""
    return [
        (s, a) for s, a in asked
        if "SELECT 1 FROM public.user_roles" in s and "org_id IS NULL" not in s
    ]


async def test_god_mode_is_refused_in_an_org_it_has_no_row_in(monkeypatch):
    """sid@aekaminc.com: platform_admin, member of no organisation.

    This is the finding. Before the fix this returned the user."""
    _pool(monkeypatch, god=True, org_role=None, member=False)

    check = require_org_role(*ORG_MANAGEMENT_ROLES)
    with pytest.raises(HTTPException) as exc:
        await check(user={"user_id": "u_god"}, org_id=ORG_B)
    assert exc.value.status_code == 403


async def test_god_mode_passes_in_an_org_it_belongs_to(monkeypatch):
    """The other half, and the one that keeps the console working.

    A god-mode holder whose only row in this org is `org_member` still passes an
    owner-only gate. Unicode Group has no org_owner at all on the live database,
    so a stricter rule would have left it with nobody who could switch a module
    on."""
    _pool(monkeypatch, god=True, org_role=None, member=True)

    check = require_org_role("org_owner")
    user = await check(user={"user_id": "u_god"}, org_id=ORG_A)
    assert user["user_id"] == "u_god"


async def test_the_orgs_own_admin_is_unaffected_and_pays_nothing_extra(monkeypatch):
    """The ordinary path: two queries, exactly as before the change.

    The membership probe must not fire for a caller the org-scoped lookup has
    already answered — this dependency is on the hot path of every org surface
    in the product."""
    asked = _pool(monkeypatch, god=False, org_role="org_admin", member=True)

    check = require_org_role(*ORG_MANAGEMENT_ROLES)
    user = await check(user={"user_id": "u_admin"}, org_id=ORG_A)

    assert user["user_id"] == "u_admin"
    assert len(asked) == 2
    assert not _membership_probes(asked)


async def test_an_ordinary_member_is_still_refused(monkeypatch):
    """Without this, every test above would pass on a gate that refuses
    everyone, which is a different bug."""
    _pool(monkeypatch, god=False, org_role=None, member=True)

    check = require_org_role(*ORG_MANAGEMENT_ROLES)
    with pytest.raises(HTTPException) as exc:
        await check(user={"user_id": "u_member"}, org_id=ORG_A)
    assert exc.value.status_code == 403


async def test_the_membership_probe_asks_about_every_tier_2_role(monkeypatch):
    """"Part of it" means any org row, not an admin row.

    Pinned to `ORG_ROLES` rather than to three literals: role_tiers exists so
    that adding a Tier-2 code is one edit, and a literal here would be the copy
    somebody forgets."""
    asked = _pool(monkeypatch, god=True, org_role=None, member=True)

    check = require_org_role(*ORG_MANAGEMENT_ROLES)
    await check(user={"user_id": "u_god"}, org_id=ORG_A)

    probe = _membership_probes(asked)
    assert probe, "the membership probe was never issued"
    args = probe[0][1]
    assert set(args[-1]) == set(ORG_ROLES)
    assert args[1] == ORG_A, "the probe must name the org being acted on"


async def test_the_platform_probe_is_still_the_whole_god_mode_set(monkeypatch):
    """The legacy `platform_admin` rows and the `platform_owner` they migrate to
    must both be honoured, or the rename is a simultaneous lockout of every
    god-mode account. Unchanged by this fix, and pinned so it stays that way."""
    asked = _pool(monkeypatch, god=False, org_role=None, member=False)

    check = require_org_role(*ORG_MANAGEMENT_ROLES)
    with pytest.raises(HTTPException):
        await check(user={"user_id": "u"}, org_id=ORG_A)

    probe = [a for s, a in asked if "org_id IS NULL" in s]
    assert set(probe[0][-1]) == set(GOD_MODE_ROLES)


# ── is_org_admin ─────────────────────────────────────────────────────────────


def _admin_pool(monkeypatch, *, platform, org_role):
    asked = []

    async def _fetchval(sql, *args):
        s = " ".join(str(sql).split())
        asked.append((s, args))
        if "org_id IS NULL" in s:
            return 1 if platform else None
        return org_role

    pool = AsyncMock()
    pool.fetchval = AsyncMock(side_effect=_fetchval)

    async def _get_pool():
        return pool

    monkeypatch.setattr("middleware.roles.get_pool", _get_pool)
    return asked


async def test_a_platform_account_is_not_an_admin_of_an_org_it_is_not_in(monkeypatch):
    """The `DELETE /api/tasks/bulk` chain: `tasks_bulk.py:418` skips its per-id
    project-role check on a True from here."""
    asked = _admin_pool(monkeypatch, platform=True, org_role=None)

    assert await is_org_admin("u_platform", ORG_B) is False
    assert not any("org_id IS NULL" in s for s, _ in asked), (
        "a non-member must be refused without the platform probe even being run"
    )


async def test_a_platform_account_is_an_admin_of_an_org_it_belongs_to(monkeypatch):
    _admin_pool(monkeypatch, platform=True, org_role="org_member")
    assert await is_org_admin("u_platform", ORG_A) is True


async def test_a_bare_member_with_no_platform_row_is_not_an_admin(monkeypatch):
    _admin_pool(monkeypatch, platform=False, org_role="org_member")
    assert await is_org_admin("u_member", ORG_A) is False


async def test_the_orgs_own_admin_needs_no_platform_probe(monkeypatch):
    asked = _admin_pool(monkeypatch, platform=False, org_role="org_admin")
    assert await is_org_admin("u_admin", ORG_A) is True
    assert len(asked) == 1


async def test_the_unscoped_answer_is_untouched(monkeypatch):
    """`server.py:433 get_visible_team_ids` (965d0e82) pairs a True from this
    with a None from `admin_org_id` to mean "platform account with no org-scoped
    admin row → fall through to ordinary membership". That fix breaks silently
    if the one-argument answer moves, so it must stay one query and the same
    query."""
    asked = _admin_pool(monkeypatch, platform=True, org_role=None)

    assert await is_org_admin("u_platform") is True
    assert len(asked) == 1
    sql = asked[0][0]
    assert "org_id IS NULL AND role_code = ANY" in sql
    assert "org_id IS NOT NULL AND role_code IN ('org_owner','org_admin')" in sql


async def test_management_roles_are_the_two_the_scoped_branch_shortcuts_on():
    """`is_org_admin` returns early for these two without asking anything else,
    so what is in this tuple is what "admin of this org" means."""
    assert set(ORG_MANAGEMENT_ROLES) == {"org_owner", "org_admin"}
    assert set(ORG_ROLES) == {"org_owner", "org_admin", "org_member"}


# ── the source tripwire ──────────────────────────────────────────────────────


def _code_only(path: str) -> str:
    """The file with docstrings and comments stripped.

    A check that reads raw source passes on its own explanation: this file is
    full of prose containing the exact words `return user` and `is_platform`,
    and a grep would find them in the paragraph saying they are gone."""
    src = open(path, encoding="utf-8").read()
    src = re.sub(r'"""(?:.|\n)*?"""', "", src)
    src = re.sub(r"^\s*#.*$", "", src, flags=re.MULTILINE)
    return src


async def test_the_unconditional_god_mode_return_is_gone_from_the_code():
    """The shape of the bug, not its wording: a `return user` whose only
    condition is the platform probe."""
    code = _code_only("middleware/roles.py")
    assert not re.search(r"if is_platform:\s*\n\s*return user", code), (
        "require_org_role returns on the platform probe alone again"
    )
    assert "may_act_in_org(" in code, "the decision moved out of the pure function"
