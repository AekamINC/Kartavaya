"""
Unit tests for team / project endpoints in server.py.

Coverage:
  GET  /api/teams          — admin sees all, member sees own, empty list
  POST /api/teams          — admin creates, member blocked
  GET  /api/teams/{id}     — detail + member list
  DELETE /api/teams/{id}   — soft-delete (org admin or project owner/admin)
  GET  /api/teams/bin      — deleted teams list, scoped to visible projects
  POST /api/teams/{id}/members — add member to team
"""

from datetime import datetime, timezone

import pytest

import server

NOW = datetime.now(timezone.utc)

TEAM_ROW = {
    "team_id": "team_001",
    "name": "Test Project",
    "created_by": "user_admin001",
    "created_at": NOW,
    "updated_at": NOW,
    "deleted_at": None,
    "task_count": 0,
    "done_count": 0,
    "color": None,
}


# ── GET /api/teams ────────────────────────────────────────────────────────────

async def test_list_teams_admin_sees_all(api_client, mock_pool, as_admin):
    """Admin should get all teams, including those they weren't explicitly added to."""
    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}, {"team_id": "team_002"}]
        if "FROM teams" in query:
            return [TEAM_ROW]
        return []

    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/teams")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_list_teams_empty_for_user_with_no_teams(api_client, mock_pool, as_member):
    async def fetch_side(query, *args):
        if "role FROM users" in query or "SQL_USER_ROLE" in query:
            return [{"role": "member"}]
        # project_assignments + team_members UNION returns nothing
        return []

    mock_pool.fetchrow.return_value = {"role": "member"}
    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/teams")
    assert resp.status_code == 200
    assert resp.json() == []


# ── POST /api/teams ───────────────────────────────────────────────────────────

async def test_create_team_as_admin(api_client, mock_pool, as_admin):
    async def fetchrow_side(query, *args):
        if "INSERT INTO teams" in query:
            return TEAM_ROW
        # _ensure_default_owner lookups → return None so it bails early
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetchval.return_value = 0  # ensure_default_columns check
    mock_pool.execute.return_value = "INSERT 1"
    resp = await api_client.post("/api/teams", json={"name": "New Project"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == TEAM_ROW["name"]


async def test_create_team_any_member_can_create(api_client, mock_pool, as_member):
    """POST /api/teams only requires authentication, not admin — any member can create."""
    async def fetchrow_side(query, *args):
        if "INSERT INTO teams" in query:
            return TEAM_ROW
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetchval.return_value = 0
    mock_pool.execute.return_value = "INSERT 1"
    resp = await api_client.post("/api/teams", json={"name": "Member Project"})
    assert resp.status_code == 200


# ── GET /api/teams/{team_id} ──────────────────────────────────────────────────

async def test_get_team_detail(api_client, mock_pool, as_admin):
    async def fetchrow_side(query, *args):
        if "project_assignments" in query:
            return {"role": "admin"}
        if "team_members" in query and "SELECT role" in query:
            return None
        if "FROM teams WHERE team_id" in query:
            return TEAM_ROW
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = []  # members list
    resp = await api_client.get("/api/teams/team_001")
    assert resp.status_code == 200
    data = resp.json()
    assert "team" in data or "team_id" in data


async def test_get_team_not_found(api_client, mock_pool, as_admin, monkeypatch):
    """Both membership tables miss AND the team is not org-visible → 403."""
    import server

    async def no_teams(pool, user_id, *a, **kw):
        return []

    monkeypatch.setattr(server, "get_visible_team_ids", no_teams)
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get("/api/teams/team_missing")
    # endpoint returns 403 "Not a team member" when no membership found
    assert resp.status_code == 403


async def test_get_team_org_visible_without_membership_row(
    api_client, mock_pool, as_admin, monkeypatch
):
    """An org admin with no membership row still reads the team.

    Regression test for the live defect measured on staging 2026-07-28: GET
    /teams listed 24 teams and GET /teams/{id} refused 22 of them, because the
    list was org-scoped through user_roles and the detail was scoped to
    membership rows only. The two endpoints must answer the same question, so
    this asserts the detail honours the list's own visibility helper.
    """
    import server

    async def visible(pool, user_id, *a, **kw):
        return ["team_001"]

    monkeypatch.setattr(server, "get_visible_team_ids", visible)

    async def fetchrow_side(query, *args):
        # neither membership table has a row for this caller
        if "project_assignments" in query:
            return None
        if "team_members" in query and "SELECT role" in query:
            return None
        if "FROM teams WHERE team_id" in query:
            return TEAM_ROW
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/teams/team_001")
    assert resp.status_code == 200
    # org-level access reports the same synthetic role is_project_member uses,
    # so the frontend needs no new branch for it
    assert resp.json()["your_role"] == "admin"


async def test_get_team_membership_row_still_wins(
    api_client, mock_pool, as_admin, monkeypatch
):
    """A real membership row is used verbatim and does not consult visibility.

    Guards the ordering: if the visibility check ran first, every member would
    be reported as `admin` and the drawer would show owner-only controls to a
    client.
    """
    import server

    async def boom(pool, user_id, *a, **kw):
        raise AssertionError("visibility must not be consulted when a row exists")

    monkeypatch.setattr(server, "get_visible_team_ids", boom)

    async def fetchrow_side(query, *args):
        if "project_assignments" in query:
            return {"role": "client"}
        if "FROM teams WHERE team_id" in query:
            return TEAM_ROW
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/teams/team_001")
    assert resp.status_code == 200
    assert resp.json()["your_role"] == "client"


# ── DELETE /api/teams/{team_id} ───────────────────────────────────────────────

"""Deleting is no longer an Aekam-only act (2026-08-09).

`_require_admin` — a PLATFORM role — used to gate this, so the customer who
owned the project could not bin it. It is now `require_project_admin`: an org
admin of the project's org, or `owner`/`admin` on the project itself.
"""


async def test_delete_team_project_admin(api_client, mock_pool, as_member):
    """A project admin bins their own project. This is the case that used to
    answer 403 — the whole reason the owner reported delete as broken."""
    async def fetchrow_side(query, *args):
        if "project_assignments" in query:
            return {"role": "admin"}
        if "FROM teams WHERE team_id" in query:
            return {**TEAM_ROW, "org_id": None, "deleted_at": None}
        return None
    mock_pool.fetchrow.side_effect = fetchrow_side
    resp = await api_client.delete("/api/teams/team_001")
    assert resp.status_code == 200


async def test_delete_team_ordinary_member_blocked(api_client, mock_pool, as_member):
    """Being ON the project is not administering it."""
    async def fetchrow_side(query, *args):
        if "project_assignments" in query:
            return {"role": "member"}
        if "FROM teams WHERE team_id" in query:
            return {**TEAM_ROW, "org_id": None, "deleted_at": None}
        return None
    mock_pool.fetchrow.side_effect = fetchrow_side
    resp = await api_client.delete("/api/teams/team_001")
    assert resp.status_code == 403


# ── GET /api/teams/bin ────────────────────────────────────────────────────────

async def test_deleted_teams_bin_is_empty_when_nothing_is_visible(
        api_client, mock_pool, as_member, monkeypatch):
    """The bin is open to any signed-in caller now and scoped by what they can
    see. Someone with no visible projects gets an empty list, not a 403 —
    there is nothing to refuse them."""
    async def none_visible(*a, **k):
        return []
    monkeypatch.setattr(server, "get_visible_team_ids", none_visible)
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/teams/bin")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_deleted_teams_bin_is_scoped_to_visible_teams(
        api_client, mock_pool, as_member, monkeypatch):
    """THE PREDICATE THAT WAS MISSING. The query used to be `WHERE deleted_at
    IS NOT NULL` — every deleted project in the database, every organisation."""
    seen = {}

    async def visible(*a, **k):
        return ["team_001"]
    monkeypatch.setattr(server, "get_visible_team_ids", visible)

    async def fetch_side(query, *args):
        seen["query"] = query
        seen["args"] = args
        return []
    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/teams/bin")
    assert resp.status_code == 200
    assert "team_id = ANY" in seen["query"]
    assert seen["args"][0] == ["team_001"]


# ── POST /api/teams/{team_id}/members ─────────────────────────────────────────

async def test_add_member_to_team(api_client, mock_pool, as_admin):
    member_row = {
        "member_id": "mem_newxxx",
        "team_id": "team_001",
        "email": "newmember@test.com",
        "user_id": None,
        "role": "member",
        "status": "invited",
        "created_at": NOW,
        "updated_at": NOW,
    }

    async def fetchrow_side(query, *args):
        if "SELECT role FROM project_assignments" in query:
            return {"role": "admin"}
        if "FROM users WHERE email" in query:
            return None  # new user, not yet registered
        if "INSERT INTO team_members" in query:
            return member_row
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.return_value = "DELETE 0"
    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "newmember@test.com", "role": "member"},
    )
    assert resp.status_code == 200


# ── The response never carries an address the caller did not supply ──────────
#
# THESE PIN THE `("server.py", "add_team_member")` ENTRY IN `ALLOWED`, in
# `tests/test_platform_privacy.py`. That entry says the remaining `email`
# literals are the write and that nothing reaches the caller — and the ratchet
# itself cannot check the second half, because it reads SQL literals and the
# disclosure was a response model. Without these, the exemption is a sentence
# with nothing behind it, which is the failure mode that file spends forty lines
# warning about.
#
# The story they close: `GET /api/users` stopped returning addresses to platform
# staff, TeamsPage's add button went dead for want of one, and `79079e14`
# repaired it by accepting a `user_id` and resolving the address server-side —
# then returning it. Fifty live user rows, every one with an address, one call
# each.

async def test_a_user_id_add_answers_with_a_name_and_no_address(api_client, mock_pool, as_admin):
    """The platform-staff path. The INSERT's returned row DOES carry the
    address — that is the point of stubbing it here — and the response must
    not."""
    async def fetchval_side(query, *args):
        if "public.user_roles" in query:
            return 1          # a platform row: the bypass admits this caller
        return None           # teams.org_id

    async def fetchrow_side(query, *args):
        if "FROM users WHERE user_id" in query:
            return {"user_id": "user_p1", "email": "priya@unicodegroup.com",
                    "display_name": "Priya Sharma"}
        if "INSERT INTO team_members" in query:
            return {"member_id": "mem_aaa", "team_id": "team_001",
                    "email": "priya@unicodegroup.com", "user_id": "user_p1",
                    "role": "member", "status": "active",
                    "created_at": NOW, "updated_at": NOW}
        return None

    mock_pool.fetchval.side_effect = fetchval_side
    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.return_value = "DELETE 0"
    resp = await api_client.post(
        "/api/teams/team_001/members", json={"user_id": "user_p1", "role": "member"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] is None, (
        "POST /teams/{id}/members turned a user_id into an email address — the "
        "oracle that routed around the GET /api/users fix"
    )
    # And a name in its place, or the roster card falls back to '?'.
    assert body["display_name"] == "Priya Sharma"


async def test_an_address_the_caller_typed_comes_back(api_client, mock_pool, as_admin):
    """The other half, and why this is not keyed on the caller's role: an org
    admin invites BY the address, holds it already, and TeamsPage needs it back
    to keep the just-added person out of the picker."""
    async def fetchrow_side(query, *args):
        if "SELECT role FROM project_assignments" in query:
            return {"role": "admin"}
        if "FROM users WHERE email" in query:
            return None       # not registered — a pending invitation
        if "INSERT INTO team_members" in query:
            return {"member_id": "mem_bbb", "team_id": "team_001",
                    "email": "newmember@test.com", "user_id": None,
                    "role": "member", "status": "invited",
                    "created_at": NOW, "updated_at": NOW}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.return_value = "DELETE 0"
    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "newmember@test.com", "role": "member"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "newmember@test.com"
    # `get_team`'s roster LEFT JOINs and calls this person 'Unnamed member'.
    # The optimistically-spliced row has to agree with it or the card changes
    # under the user on the next refresh.
    assert body["display_name"] == "Unnamed member"


async def test_a_role_change_answers_with_a_name_and_no_address(api_client, mock_pool, as_admin):
    """PUT carries no address, so there is nothing to echo — even though
    `UPDATE … RETURNING *` hands the handler one. The privacy ratchet cannot
    see this route at all: every SQL literal in it is a role or a status."""
    async def fetchval_side(query, *args):
        if "public.user_roles" in query:
            return 1
        if "FROM users WHERE user_id" in query:
            return "Ravi Kumar"
        return None

    async def fetchrow_side(query, *args):
        if "UPDATE team_members" in query:
            return {"member_id": "mem_ccc", "team_id": "team_001",
                    "email": "ravi@unicodegroup.com", "user_id": "user_r1",
                    "role": "admin", "status": "active",
                    "created_at": NOW, "updated_at": NOW}
        return None

    mock_pool.fetchval.side_effect = fetchval_side
    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.return_value = "INSERT 0 1"
    resp = await api_client.put(
        "/api/teams/team_001/members/mem_ccc", json={"role": "admin"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] is None
    assert body["display_name"] == "Ravi Kumar"


async def test_add_member_non_admin_blocked(api_client, mock_pool, as_member):
    async def fetchrow_side(query, *args):
        if "project_assignments" in query:
            return {"role": "member"}  # not owner/admin
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "someone@test.com", "role": "member"},
    )
    assert resp.status_code == 403
