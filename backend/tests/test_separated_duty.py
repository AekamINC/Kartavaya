"""
Separated duty and cross-tenant tests for approvals, activity and messaging.

Two things are pinned here.

**Separated duty.** In Vetana and Ganit, `admin` does NOT satisfy `approver`.
Whoever defines what people are paid must not also be the one who releases the
money. `level_satisfies` is the only place that rule exists in code today — it
has no call sites yet, because the `level` column it reads lives in
PROPOSED_065/066 and is not applied. That is exactly why it is tested here: the
rule is currently load-bearing for nothing, so nothing else would catch it being
"simplified" into a plain hierarchy before the enforcement lands.

**Cross-tenant.** `staging.user_roles` is the sole tenant path. Every test below
supplies an identifier belonging to another org and asserts the route refuses.
"""
import pytest
from unittest.mock import AsyncMock

from conftest import TEST_ORG_ID
from middleware.role_tiers import (
    ADMIN, APPROVER, EDITOR, VIEWER,
    HIERARCHICAL_MODULES, SEPARATED_DUTY_MODULES,
    level_satisfies, modules_for,
    COMMERCIAL_ONLY_ROLES, GOD_MODE_ROLES, MANAGER_ROLES, STAFF_ROLES,
)

OTHER_ORG_ID = "00000000-0000-0000-0000-000000000099"
CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
MESSAGE_ID = "11111111-2222-3333-4444-555555555555"
FOREIGN_USER = "user_from_another_org"


# ── Separated duty ────────────────────────────────────────────────


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_admin_does_not_satisfy_approver_in_separated_duty_modules(module):
    """The whole point. Admin is breadth, approver is depth."""
    assert level_satisfies(ADMIN, APPROVER, module) is False


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_approver_satisfies_approver_in_separated_duty_modules(module):
    """An explicit approver grant is the only thing that approves here."""
    assert level_satisfies(APPROVER, APPROVER, module) is True


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_weaker_levels_never_approve(module):
    for held in (VIEWER, EDITOR):
        assert level_satisfies(held, APPROVER, module) is False


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_separation_applies_only_to_the_approver_rung(module):
    """Admin is still the top of the ladder for everything that is not approval,
    so the separation cannot be mistaken for 'admin is weaker here'."""
    assert level_satisfies(ADMIN, ADMIN, module) is True
    assert level_satisfies(ADMIN, EDITOR, module) is True
    assert level_satisfies(ADMIN, VIEWER, module) is True


@pytest.mark.parametrize("module", sorted(HIERARCHICAL_MODULES))
def test_admin_does_satisfy_approver_where_the_ladder_is_a_hierarchy(module):
    """The mirror of the rule: everywhere that does not move money, admin can do
    everything an approver can. A blanket `held == required` would pass the
    tests above and break every one of these."""
    assert level_satisfies(ADMIN, APPROVER, module) is True


def test_vetana_and_ganit_are_the_separated_duty_set():
    """Pin the membership. Adding a money-moving module without adding it here
    silently gives its admins approval authority."""
    assert SEPARATED_DUTY_MODULES == {"vetana", "ganit"}


def test_separated_duty_and_hierarchical_sets_are_disjoint():
    assert not (SEPARATED_DUTY_MODULES & HIERARCHICAL_MODULES)


def test_unknown_level_never_satisfies():
    assert level_satisfies("superuser", APPROVER, "vetana") is False
    assert level_satisfies(None, VIEWER, "graha") is False


# ── Platform roles: who may cross into a customer's records ──────


@pytest.mark.parametrize("role", sorted(COMMERCIAL_ONLY_ROLES) + ["platform_support"])
def test_commercial_and_support_roles_reach_no_operational_module(role):
    """These four hold platform rows but reach nothing. The activity feed relies
    on this: it is what separates 'is Aekam staff' from 'may read a customer's
    operational record'."""
    assert modules_for(role) == frozenset()


@pytest.mark.parametrize("role", sorted(GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES))
def test_operational_platform_roles_reach_something(role):
    assert modules_for(role) != frozenset()


@pytest.mark.anyio
@pytest.mark.parametrize("role", sorted(COMMERCIAL_ONLY_ROLES) + ["platform_support"])
async def test_activity_bypass_refused_to_roles_without_operational_reach(role):
    """_platform_reach is the guard the activity router actually calls."""
    from routers.activity import _platform_reach

    pool = AsyncMock()
    pool.fetchval = AsyncMock(return_value=role)
    assert await _platform_reach(pool, "user_x") == (False, False)


@pytest.mark.anyio
async def test_only_god_mode_sees_every_org_in_activity():
    from routers.activity import _platform_reach

    pool = AsyncMock()
    for role in GOD_MODE_ROLES:
        pool.fetchval = AsyncMock(return_value=role)
        may_bypass, sees_every_org = await _platform_reach(pool, "user_x")
        assert may_bypass is True and sees_every_org is True

    for role in MANAGER_ROLES + STAFF_ROLES:
        pool.fetchval = AsyncMock(return_value=role)
        may_bypass, sees_every_org = await _platform_reach(pool, "user_x")
        assert may_bypass is True, f"{role} should still reach the module"
        assert sees_every_org is False, f"{role} must not read across orgs"


@pytest.mark.anyio
async def test_no_platform_row_gets_no_bypass():
    from routers.activity import _platform_reach

    pool = AsyncMock()
    pool.fetchval = AsyncMock(return_value=None)
    assert await _platform_reach(pool, "user_x") == (False, False)


# ── Messaging: cross-tenant and channel confidentiality ──────────


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.mark.anyio
async def test_thread_refused_to_non_member_of_private_channel(
    api_client, as_member, with_org_id, mock_pool
):
    """The leak this closes: the parent message was checked for org membership
    only, so any colleague could read the replies under a DM by passing its id."""
    mock_pool.fetchrow = AsyncMock(side_effect=[
        {"channel_id": CHANNEL_ID},   # message is in the caller's org
        {"type": "private"},          # ...but the channel is private
        None,                         # ...and the caller is not a member
    ])
    r = await api_client.get(f"/api/v1/messaging/messages/{MESSAGE_ID}/thread")
    assert r.status_code == 403


@pytest.mark.anyio
async def test_thread_refused_when_channel_belongs_to_another_org(
    api_client, as_member, with_org_id, mock_pool
):
    mock_pool.fetchrow = AsyncMock(side_effect=[
        {"channel_id": CHANNEL_ID},
        None,                         # channel not found under this org_id
    ])
    r = await api_client.get(f"/api/v1/messaging/messages/{MESSAGE_ID}/thread")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_reaction_refused_to_non_member_of_private_channel(
    api_client, as_member, with_org_id, mock_pool
):
    mock_pool.fetchrow = AsyncMock(side_effect=[
        {"channel_id": CHANNEL_ID},
        {"type": "private"},
        None,
    ])
    r = await api_client.post(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions",
        params={"emoji": "thumbsup"},
    )
    assert r.status_code == 403


# ── The editor gate now runs first, and these three tests predate it ──────────
#
# `_require_editor()` was added to every messaging write path (the spec's rule
# that `viewer` — the default level on every new grant — must not post). It reads
# `staging.org_member_modules`, and it runs BEFORE `_assert_same_org`.
#
# That broke three tests without breaking anything they protect. A blanket
# `fetchval -> None` now fails the editor gate first, so the refusal arrives as
# 403 instead of 404, and `call_args` — which is the LAST call — returns the
# editor gate's query rather than the tenancy one.
#
# The security property is unchanged: a foreign user still cannot be added, and
# `execute` is still never reached. These now let the editor gate PASS so the
# tenancy check is the thing actually under test, and search every recorded call
# for it rather than assuming it was the last. Asserting on "the last query" is
# what made a correct new gate look like a regression.
def _fetchval_editor_ok(same_org_answer=None):
    """Pass the editor gate, answer the tenancy check with `same_org_answer`."""
    async def _fv(query, *args):
        if "org_member_modules" in query:
            return "editor"
        return same_org_answer
    return AsyncMock(side_effect=_fv)


def _tenancy_calls(mock_pool):
    """Every fetchval that asked the tenant table, in order."""
    return [
        c.args for c in mock_pool.fetchval.call_args_list
        if c.args and "public.user_roles" in c.args[0]
    ]


@pytest.mark.anyio
async def test_cannot_add_a_user_from_another_org_to_a_channel(
    api_client, as_member, with_org_id, mock_pool
):
    """`user_id` is caller-supplied. Without the org check this wrote a
    membership row joining one org's channel to another org's user."""
    mock_pool.fetchrow = AsyncMock(side_effect=[
        {"type": "public"},           # channel exists in caller's org
        {"role": "member"},           # caller is a member, so may add others
    ])
    mock_pool.fetchval = _fetchval_editor_ok()  # target has no role in this org
    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/members",
        params={"user_id": FOREIGN_USER},
    )
    assert r.status_code == 404
    mock_pool.execute.assert_not_called()


@pytest.mark.anyio
async def test_cannot_open_a_dm_with_a_user_from_another_org(
    api_client, as_member, with_org_id, mock_pool
):
    mock_pool.fetchval = _fetchval_editor_ok()
    r = await api_client.post(
        "/api/v1/messaging/dm", params={"target_user_id": FOREIGN_USER}
    )
    assert r.status_code == 404


@pytest.mark.anyio
async def test_same_org_check_queries_user_roles_with_the_callers_org(
    api_client, as_member, with_org_id, mock_pool
):
    """The tenant path is staging.user_roles, and it must be asked about the
    caller's org — not an org id taken from the request body."""
    mock_pool.fetchval = _fetchval_editor_ok()
    await api_client.post(
        "/api/v1/messaging/dm", params={"target_user_id": FOREIGN_USER}
    )
    calls = _tenancy_calls(mock_pool)
    assert calls, "the tenant table was never asked — public.user_roles is the only tenant path"
    query, *args = calls[-1]
    assert "public.user_roles" in query
    assert args == [FOREIGN_USER, TEST_ORG_ID]
    assert OTHER_ORG_ID not in args
