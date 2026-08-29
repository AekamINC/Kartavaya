"""
Privilege escalation through the invite and platform-admin paths.

The invite path is how a person first gets an account on this platform — there
is no public registration — and `/api/admin/*` is how that account is given
away. Both were reachable by every role in `CONSOLE_ROLES`, which includes
`platform_staff` (CRM, marketing, Sahayak) and `account_manager` (commercial).

Four escalations these tests pin down:

1. `GET /api/admin/invites` served the raw redemption token for every unclaimed
   invite on the platform. `POST /api/auth/accept-invite` asks for nothing else,
   so the listing was a set of live credentials.
2. `POST /api/admin/invites` accepted `role: "admin"` from anyone on the
   console. `users.role == 'admin'` is still read by `approvals_router.py` and
   `server.py`, so that is a real grant, not a legacy no-op.
3. The same for `PUT /users/{id}/role` and `PATCH /users/{id}`.
4. `DELETE /users/{id}` would delete a platform_owner's account for a caller
   holding platform_staff.

The suite mocks the pool, so it asserts on the guard, not on the database.
"""

import pytest

from middleware.role_tiers import GOD_MODE_ROLES, STAFF_ROLES


GOD = GOD_MODE_ROLES[0]          # platform_owner
STAFF = STAFF_ROLES[0]           # platform_staff
TARGET = "user_target001"


def _platform_role_pool(mock_pool, caller_role, target_role=None):
    """Wire the mock so `require_platform_role` and the new ceiling helpers see
    `caller_role` for the acting user and `target_role` for TARGET.

    `require_platform_role` uses fetchval; the ceiling helpers use fetch, because
    a user may hold several platform rows and the strongest has to win.
    """
    async def fetchval(query, *args):
        if "public.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return caller_role if caller_role in allowed else None
        return 0

    async def fetch(query, *args):
        # The TENANCY query first, because it also names `staging.user_roles` and
        # the platform-role matcher below would otherwise answer it with a
        # `role_code` row and no `org_id` key at all.
        #
        # Everyone is org-less here on purpose. These tests are about the
        # SENIORITY ceilings — who outranks whom — and the org check that now
        # precedes them admits an org-less target (see `may_reach_user`), so it
        # falls through and leaves each ceiling below as the thing under test.
        # Tenancy has its own tests in `test_admin_console_org_scope.py`.
        if "org_id IS NOT NULL" in query:
            return []
        if "public.user_roles" in query and "org_id IS NULL" in query:
            user_id = args[0]
            role = target_role if user_id == TARGET else caller_role
            return [{"role_code": role}] if role else []
        return []

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = fetch
    return mock_pool


@pytest.fixture
def as_platform(app, member_user, mock_pool):
    """Run requests as a user whose platform role the test chooses."""
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


# ── 1. The invite listing must never carry a redemption token ────────────────

async def test_invite_listing_never_returns_a_token_or_link(
    api_client, as_platform, mock_pool
):
    _platform_role_pool(mock_pool, GOD)

    from datetime import datetime, timezone
    row = {
        "invite_id": "inv_abc123", "email": "new@test.com", "role": "member",
        "token": "SUPER-SECRET-REDEMPTION-TOKEN",
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc),
        "accepted_at": None, "full_name": None, "member_role": None,
        "receives_approval_emails": True, "invited_by_name": "Someone",
    }

    async def fetch(query, *args):
        # Tenancy first — see the note in `_platform_role_pool`. This test owns
        # its own `fetch`, so it needs the same ordering.
        if "org_id IS NOT NULL" in query:
            return []
        if "public.user_roles" in query:
            return [{"role_code": GOD}]
        if "FROM public.invites" in query:
            # The route must not even ASK for the token.
            assert "i.token" not in query, "list_invites still selects the token"
            return [row]
        return []

    mock_pool.fetch.side_effect = fetch

    r = await api_client.get("/api/admin/invites")
    assert r.status_code == 200
    body = r.text
    assert "SUPER-SECRET-REDEMPTION-TOKEN" not in body
    assert "invite_link" not in body
    assert "accept-invite?token=" not in body


# ── 2. The account-type ceiling on invites ───────────────────────────────────

async def test_platform_staff_cannot_invite_an_admin(api_client, as_platform, mock_pool):
    _platform_role_pool(mock_pool, STAFF)
    r = await api_client.post(
        "/api/admin/invites", json={"email": "esc@test.com", "role": "admin"}
    )
    assert r.status_code == 403
    assert "platform owner" in r.json()["detail"]


@pytest.mark.parametrize("account_type", ["member", "client"])
async def test_platform_staff_may_still_invite_a_member_or_client(
    api_client, as_platform, mock_pool, account_type
):
    """The ceiling must not become a wall — the console still has to work."""
    _platform_role_pool(mock_pool, STAFF)
    mock_pool.fetchrow.return_value = None      # no existing user with that email
    r = await api_client.post(
        "/api/admin/invites", json={"email": "ok@test.com", "role": account_type}
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == account_type


async def test_platform_owner_may_invite_an_admin(api_client, as_platform, mock_pool):
    _platform_role_pool(mock_pool, GOD)
    mock_pool.fetchrow.return_value = None
    r = await api_client.post(
        "/api/admin/invites", json={"email": "boss@test.com", "role": "admin"}
    )
    assert r.status_code == 200, r.text


async def test_an_unknown_account_type_is_still_rejected(api_client, as_platform, mock_pool):
    _platform_role_pool(mock_pool, GOD)
    r = await api_client.post(
        "/api/admin/invites", json={"email": "x@test.com", "role": "platform_owner"}
    )
    assert r.status_code == 400


# ── 3. The same ceiling on the two role-change routes ────────────────────────

async def test_platform_staff_cannot_promote_a_user_to_admin(
    api_client, as_platform, mock_pool
):
    _platform_role_pool(mock_pool, STAFF)
    r = await api_client.put(f"/api/admin/users/{TARGET}/role", json={"role": "admin"})
    assert r.status_code == 403


async def test_platform_staff_cannot_patch_a_user_up_to_admin(
    api_client, as_platform, mock_pool
):
    _platform_role_pool(mock_pool, STAFF)
    r = await api_client.patch(f"/api/admin/users/{TARGET}", json={"role": "admin"})
    assert r.status_code == 403


# ── 4. A platform-role holder is not a normal target ─────────────────────────

async def test_platform_staff_cannot_delete_a_platform_owners_account(
    api_client, as_platform, mock_pool
):
    """The lateral move: rather than escalate, delete the person above you."""
    _platform_role_pool(mock_pool, STAFF, target_role=GOD)
    r = await api_client.delete(f"/api/admin/users/{TARGET}")
    assert r.status_code == 403
    assert GOD in r.json()["detail"]


async def test_platform_staff_cannot_edit_a_platform_owners_profile(
    api_client, as_platform, mock_pool
):
    _platform_role_pool(mock_pool, STAFF, target_role=GOD)
    r = await api_client.patch(f"/api/admin/users/{TARGET}", json={"full_name": "Hijacked"})
    assert r.status_code == 403


async def test_platform_owner_may_still_delete_an_ordinary_user(
    api_client, as_platform, mock_pool
):
    _platform_role_pool(mock_pool, GOD, target_role=None)
    r = await api_client.delete(f"/api/admin/users/{TARGET}")
    assert r.status_code == 200, r.text


# ── 5. No route in this file may be reached without a platform role ──────────

@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/admin/users", None),
    ("get", "/api/admin/invites", None),
    ("post", "/api/admin/invites", {"email": "x@test.com", "role": "member"}),
    ("put", f"/api/admin/users/{TARGET}/role", {"role": "member"}),
    ("delete", f"/api/admin/users/{TARGET}", None),
])
async def test_a_user_with_no_platform_role_is_refused(
    api_client, as_platform, mock_pool, method, path, body
):
    _platform_role_pool(mock_pool, None)
    r = await getattr(api_client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 403
