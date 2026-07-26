"""
Seat allowance, and the guard sets on the platform console.

── Seats ────────────────────────────────────────────────────────────────────

The owner's rule is that Aekam types an org's maximum users in by hand when the
org is created; there is no self-serve seat purchase. So `max_users` is a
commercial term, and there are THREE code paths that write an org membership row:

    POST /api/v1/org/members                     org console   — counted seats
    POST /api/v1/admin/orgs/{id}/members         platform      — did NOT
    POST /api/v1/admin/orgs/roles/assign         platform      — did NOT

A cap enforced on one of three paths is worse than no cap: `/v1/subscription/usage`
renders `max_users` to the customer, so the number was displayed as binding while
two paths walked around it.

── Guard sets ───────────────────────────────────────────────────────────────

`platform_staff` is the operating set — CRM, sales, marketing, Srijan, analytics
(role_tiers.py:36-38). It was reaching two things it has no business in:
crediting an org's wallet, and setting what a customer is charged.
"""

import pytest

from middleware.role_tiers import (
    BILLING_CONSOLE_ROLES, GOD_MODE_ROLES, SRIJAN_COMMERCIAL_ROLES, STAFF_ROLES,
)

GOD = GOD_MODE_ROLES[0]
STAFF = STAFF_ROLES[0]
ORG = "00000000-0000-0000-0000-0000000000aa"
TARGET = "user_seat001"


def _console(mock_pool, caller_role, *, limit=None, seats_used=0, already_in=False,
             role_row=None, god_mode_left=1):
    """Wire the mock for a platform-console request.

    Dispatches on query text because these routes issue several fetchvals in a
    fixed order and asserting on order would break the moment a query is added.
    """
    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query and "role_code = ANY" in query:
            if "COUNT(DISTINCT user_id)" in query:
                return god_mode_left
            allowed = args[1] if len(args) > 1 else []
            return caller_role if caller_role in allowed else None
        if "COALESCE(o.max_users, p.max_users)" in query:
            return limit
        if "COUNT(DISTINCT user_id)" in query and "staging.user_roles" in query:
            return seats_used
        if "staging.user_roles" in query and "org_id=$2::uuid" in query:
            return 1 if already_in else None
        if "FROM users WHERE user_id" in query:
            return 1
        if "FROM staging.organisations" in query:
            return ORG
        return None

    async def fetchrow(query, *args):
        if "markup_pct" in query and "FROM staging.organisations" in query:
            # The read-back at the end of update_org_settings.
            return {"markup_pct": 0.25, "monthly_credits": 0, "monthly_price": 0}
        if "FROM staging.organisations" in query:
            return {"id": ORG, "team_id": "team_001"}
        if "FROM users" in query:
            return {"user_id": TARGET, "email": "seat@test.com"}
        if "FROM staging.user_roles WHERE id" in query:
            return role_row
        return None

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []
    return mock_pool


@pytest.fixture
def as_platform(app, member_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


# ── Seats: the platform add-member path ──────────────────────────────────────

async def test_platform_add_member_refuses_when_the_org_is_at_its_allowance(
    api_client, as_platform, mock_pool
):
    _console(mock_pool, GOD, limit=5, seats_used=5)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "seat@test.com", "roles": ["org_member"]},
    )
    assert r.status_code == 403
    assert "seats" in r.json()["detail"]


async def test_platform_add_member_allows_the_last_seat(
    api_client, as_platform, mock_pool
):
    """Off-by-one guard: 4 of 5 used must still admit the fifth."""
    _console(mock_pool, GOD, limit=5, seats_used=4)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "seat@test.com", "roles": ["org_member"]},
    )
    assert r.status_code == 200, r.text


async def test_a_null_allowance_means_unlimited_not_zero(
    api_client, as_platform, mock_pool
):
    """COALESCE(org, plan) is NULL for the tiers not sold per user. That must
    not collapse to a cap of zero and lock every such org out of hiring."""
    _console(mock_pool, GOD, limit=None, seats_used=900)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "seat@test.com", "roles": ["org_member"]},
    )
    assert r.status_code == 200, r.text


async def test_an_existing_member_does_not_consume_a_second_seat(
    api_client, as_platform, mock_pool
):
    """Re-adding someone already in the org — to change their role — must not be
    refused because the org is full. They are already counted."""
    _console(mock_pool, GOD, limit=5, seats_used=5, already_in=True)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "seat@test.com", "roles": ["org_admin"]},
    )
    assert r.status_code == 200, r.text


# ── Seats: the role-assign path ──────────────────────────────────────────────

async def test_assign_role_respects_the_seat_allowance(
    api_client, as_platform, mock_pool
):
    """The third door into an org, and the one nobody was counting."""
    _console(mock_pool, GOD, limit=5, seats_used=5)
    r = await api_client.post(
        "/api/v1/admin/orgs/roles/assign",
        json={"user_id": TARGET, "role_code": "org_member", "org_id": ORG},
    )
    assert r.status_code == 403
    assert "seats" in r.json()["detail"]


async def test_assign_role_does_not_count_seats_for_a_platform_role(
    api_client, as_platform, mock_pool
):
    """A platform role is org_id IS NULL — it occupies no customer seat."""
    _console(mock_pool, GOD, limit=5, seats_used=5)
    r = await api_client.post(
        "/api/v1/admin/orgs/roles/assign",
        json={"user_id": TARGET, "role_code": "account_finance"},
    )
    assert r.status_code == 200, r.text


async def test_developer_is_no_longer_an_assignable_role(
    api_client, as_platform, mock_pool
):
    """It appears nowhere in role_tiers, so it granted nothing while looking
    granted on the roles screen."""
    _console(mock_pool, GOD)
    r = await api_client.post(
        "/api/v1/admin/orgs/roles/assign",
        json={"user_id": TARGET, "role_code": "developer"},
    )
    assert r.status_code == 400


# ── Guard sets: what platform_staff may not reach ────────────────────────────

async def test_platform_staff_cannot_top_up_an_orgs_credits(
    api_client, as_platform, mock_pool
):
    assert STAFF not in SRIJAN_COMMERCIAL_ROLES
    _console(mock_pool, STAFF)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/credits/topup", json={"amount": 100000}
    )
    assert r.status_code == 403


async def test_platform_staff_cannot_rewrite_an_orgs_commercial_terms(
    api_client, as_platform, mock_pool
):
    assert STAFF not in BILLING_CONSOLE_ROLES
    _console(mock_pool, STAFF)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/settings", json={"markup_pct": 0.0}
    )
    assert r.status_code == 403


async def test_god_mode_may_still_do_both(api_client, as_platform, mock_pool):
    """The narrowing must not have taken the console with it."""
    _console(mock_pool, GOD)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/settings", json={"markup_pct": 0.25}
    )
    assert r.status_code != 403, r.text


# ── The last god-mode row is not revocable ───────────────────────────────────

async def test_revoking_the_last_god_mode_role_is_refused(
    api_client, as_platform, mock_pool
):
    """No endpoint can grant a platform role except one that is itself god-mode
    only, so the last revocation cannot be undone through the application."""
    role_id = "11111111-1111-1111-1111-111111111111"
    _console(mock_pool, GOD,
             role_row={"user_id": "user_last", "role_code": GOD},
             god_mode_left=0)
    r = await api_client.delete(f"/api/v1/admin/orgs/roles/{role_id}")
    assert r.status_code == 409
    assert "last platform owner" in r.json()["detail"]


async def test_revoking_god_mode_is_fine_while_another_holder_remains(
    api_client, as_platform, mock_pool
):
    role_id = "11111111-1111-1111-1111-111111111111"
    _console(mock_pool, GOD,
             role_row={"user_id": "user_one", "role_code": GOD},
             god_mode_left=2)
    r = await api_client.delete(f"/api/v1/admin/orgs/roles/{role_id}")
    assert r.status_code == 200, r.text


async def test_revoking_a_non_god_role_is_unaffected(
    api_client, as_platform, mock_pool
):
    role_id = "11111111-1111-1111-1111-111111111111"
    _console(mock_pool, GOD,
             role_row={"user_id": "user_two", "role_code": "org_member"},
             god_mode_left=0)
    r = await api_client.delete(f"/api/v1/admin/orgs/roles/{role_id}")
    assert r.status_code == 200, r.text
