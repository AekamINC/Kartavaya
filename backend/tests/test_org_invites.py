"""
An organisation invites its own people — and cannot invite around its own limits.

Before `routers/org_invites.py` an org could not add anyone: the only invite
endpoint was Aekam's platform console, and `add_member` refuses an email with no
account. Every new user at every customer went through Aekam personally.

The four properties worth pinning are the ones that are easy to get wrong and
silent when wrong:

  1. The list endpoint NEVER returns a token. `GET /api/admin/invites` used to
     return `i.token` plus a ready-made accept link for every pending invite on
     the platform — and `POST /auth/accept-invite` asks for nothing but that
     token before creating the account and setting its password. A listing that
     leaks one is a page of live credentials, not a convenience.

  2. Nobody invites above themselves. An org_admin minting an org_owner is
     privilege escalation with an email attached.

  3. An org_admin cannot grant `approver` on a separated-duty module. That would
     let the person who defines what people are paid create the person who
     releases the money — the precise pair the separation exists to keep apart.

  4. Pending invites consume seats. Counting only accepted members lets an org
     at its cap send unlimited invites and discover the ceiling only when people
     start bouncing off it, after the mail has gone out.

Nothing here touches a database; the pool is conftest's MagicMock.
"""

import json

import pytest

from conftest import TEST_ORG_ID

EMAIL = "newjoiner@test.com"


@pytest.fixture
def wired(mock_pool):
    """Answer every query these endpoints issue, keyed on a distinctive fragment.

    `state` lets a test steer the answers: the caller's org role, the seat cap,
    how many seats are used, which modules are active.
    """
    state = {
        "caller_role": "org_admin",
        "limit": None,
        "seats_used": 0,
        "pending": 0,
        "active_modules": ["ganit", "vetana", "graha"],
        "existing_user": None,
        "inserted": {},
    }

    async def fetchval_side(query, *args):
        if "role_code FROM staging.user_roles" in query:
            return state["caller_role"]
        if "COALESCE(o.max_users" in query:
            return state["limit"]
        if "COUNT(DISTINCT user_id)" in query:
            return state["seats_used"]
        if "COUNT(*) FROM invites" in query:
            return state["pending"]
        if "SELECT name FROM staging.organisations" in query:
            return "Test Org"
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return None          # not god-mode
        return None

    async def fetchrow_side(query, *args):
        if "FROM users WHERE LOWER(email)" in query:
            return state["existing_user"]
        if query.strip().upper().startswith("UPDATE INVITES"):
            return {"invite_id": args[0]} if state.get("revoke_hit", True) else None
        return None

    async def fetch_side(query, *args):
        if "module_subscriptions" in query:
            return [{"module_code": m} for m in state["active_modules"]]
        if "SELECT invite_id, email, member_role" in query:
            return [{
                "invite_id": "inv_abc123", "email": EMAIL, "member_role": "org_member",
                "full_name": "New Joiner",
                "module_grants": json.dumps([{"code": "ganit", "role": "editor"}]),
                "created_at": None, "expires_at": None, "invited_by": "user_admin001",
            }]
        return []

    async def execute_side(query, *args):
        if query.strip().upper().startswith("INSERT INTO INVITES"):
            state["inserted"] = {"args": args, "query": query}
        return "INSERT 0 1"

    mock_pool.fetchval.side_effect = fetchval_side
    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side
    mock_pool.execute.side_effect = execute_side
    return state


# ── Property 1: the token never leaves through the list ──────────────────────

async def test_list_never_returns_a_token(api_client, wired, with_org_id, as_admin):
    resp = await api_client.get("/api/v1/org/invites")
    assert resp.status_code == 200
    body = resp.json()
    assert body, "fixture should have returned one invite"

    serialised = json.dumps(body)
    assert "token" not in serialised, (
        "the list handed back a token — that is a working credential for "
        "POST /auth/accept-invite, which creates the account and sets its password"
    )
    assert "accept-invite?token=" not in serialised


# ── Property 2: nobody invites above themselves ──────────────────────────────

async def test_org_admin_cannot_invite_an_owner(api_client, wired, with_org_id, as_admin):
    wired["caller_role"] = "org_admin"
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_owner",
    })
    assert resp.status_code == 403, "an org_admin minted an org_owner"


async def test_org_owner_can_invite_an_owner(api_client, wired, with_org_id, as_admin):
    wired["caller_role"] = "org_owner"
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_owner",
    })
    assert resp.status_code == 200


# ── Property 3: separated duty survives the invite path ──────────────────────

async def test_org_admin_cannot_grant_approver_on_vetana(api_client, wired, with_org_id, as_admin):
    wired["caller_role"] = "org_admin"
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
        "module_grants": [{"code": "vetana", "role": "approver"}],
    })
    assert resp.status_code == 403, (
        "an org_admin created a payroll approver — administering a module and "
        "releasing money against it must stay separate"
    )


async def test_org_admin_may_still_grant_a_normal_level(api_client, wired, with_org_id, as_admin):
    """The guard must be narrow: it blocks the approver rung, not module access."""
    wired["caller_role"] = "org_admin"
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
        "module_grants": [{"code": "ganit", "role": "editor"}],
    })
    assert resp.status_code == 200


async def test_cannot_grant_a_module_the_org_does_not_have(api_client, wired, with_org_id, as_admin):
    wired["active_modules"] = ["graha"]
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
        "module_grants": [{"code": "ganit", "role": "editor"}],
    })
    assert resp.status_code == 400


# ── Property 4: pending invites consume seats ────────────────────────────────

async def test_pending_invites_count_against_the_seat_limit(api_client, wired, with_org_id, as_admin):
    wired["limit"] = 5
    wired["seats_used"] = 3
    wired["pending"] = 2          # 3 + 2 == 5, the cap
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
    })
    assert resp.status_code == 409, (
        "the org was allowed past its cap because only accepted members were "
        "counted — the invites had already been sent by the time anyone noticed"
    )


async def test_null_limit_means_unlimited_not_zero(api_client, wired, with_org_id, as_admin):
    """COALESCE(org, plan) NULL on both is unlimited. Collapsing it to 0 would
    lock every org on a plan with no seat count out of inviting anyone."""
    wired["limit"] = None
    wired["seats_used"] = 500
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
    })
    assert resp.status_code == 200


# ── The invite is written scoped to the caller's org ─────────────────────────

async def test_invite_is_written_with_the_callers_org_and_grants(api_client, wired, with_org_id, as_admin):
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
        "module_grants": [{"code": "ganit", "role": "editor"}],
    })
    assert resp.status_code == 200

    args = wired["inserted"]["args"]
    assert TEST_ORG_ID in [str(a) for a in args], "the invite was not scoped to the caller's org"
    grants_arg = next(a for a in args if isinstance(a, str) and a.startswith("["))
    assert json.loads(grants_arg) == [{"code": "ganit", "role": "editor"}]


async def test_existing_account_is_refused_with_a_useful_message(api_client, wired, with_org_id, as_admin):
    wired["existing_user"] = {"user_id": "user_already"}
    resp = await api_client.post("/api/v1/org/invites", json={
        "email": EMAIL, "org_role": "org_member",
    })
    assert resp.status_code == 409
    assert "Members tab" in resp.json()["detail"], "the error should say what to do instead"
