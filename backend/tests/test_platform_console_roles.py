"""
The platform console's role screens: granting, revoking, and what a grant COSTS.

`POST /api/v1/admin/orgs/roles/assign` could hand out exactly one org-scoped
code — `org_admin` — and it counted a seat for it unconditionally. Wave 3 adds
three Tier-2 codes to the console and two of them are FREE, which turns the seat
check from a rule into a decision:

    hr_admin     consumes a seat. They sign in and use the product.
    org_client   consumes NO seat.
    aekam_team   consumes NO seat.

So the two halves have to be pinned together. A free role that is refused
because the customer's allowance is full would mean a customer being asked to
buy a seat for the person they are doing the work FOR; a billed role that skips
the check is the seat cap walked around for the fourth time.

`GET /roles/catalogue` exists so the console can SAY which it is at the moment
of granting, from the server rather than from `pages/admin/platformRoles.js`,
which is a hand-maintained transcription — and a transcription of a billing fact
is a bill that disagrees with a screen the first time somebody edits one of them.
"""
import pytest

from middleware.role_tiers import GOD_MODE_ROLES, STAFF_ROLES

GOD = GOD_MODE_ROLES[0]
STAFF = STAFF_ROLES[0]
ORG = "00000000-0000-0000-0000-0000000000ab"
TARGET = "user_console001"


def _console(mock_pool, caller_role, *, limit=None, seats_used=0, org_rows=None):
    """Wire the mock for a platform-console role request.

    Dispatches on query TEXT, never on call order: these routes issue several
    reads in a fixed sequence today and asserting on that sequence would break
    the moment one is added, which is how a suite starts pinning its own mock.
    """
    async def fetchval(query, *args):
        q = " ".join(query.split())
        if "staging.user_roles" in q and "org_id IS NULL" in q and "role_code = ANY" in q:
            if "COUNT(DISTINCT user_id)" in q:
                return 2            # never the last god-mode row
            allowed = args[1] if len(args) > 1 else []
            return caller_role if caller_role in allowed else None
        if "COALESCE(o.max_users, p.max_users)" in q:
            return limit
        if "COUNT(DISTINCT user_id)" in q and "staging.user_roles" in q:
            return seats_used
        if "staging.user_roles" in q and "org_id=$2::uuid" in q:
            return None             # not already in the org
        if "FROM staging.organisations" in q:
            return ORG
        return None

    async def fetchrow(query, *args):
        q = " ".join(query.split())
        if "FROM users WHERE user_id" in q:
            return {"email": "success+console@simulator.amazonses.com"}
        if "FROM staging.user_roles WHERE id" in q:
            return {"user_id": TARGET, "role_code": "hr_admin"}
        if "FROM staging.organisations" in q:
            return {"id": ORG, "team_id": "team_console"}
        return None

    async def fetch(query, *args):
        return org_rows or []

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetch.side_effect = fetch
    return mock_pool


@pytest.fixture
def as_platform(app, member_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


async def _assign(api_client, role_code, org_id=ORG):
    body = {"user_id": TARGET, "role_code": role_code}
    if org_id:
        body["org_id"] = org_id
    return await api_client.post("/api/v1/admin/orgs/roles/assign", json=body)


# ── hr_admin: assignable, and billed ─────────────────────────────────────────

async def test_the_console_can_appoint_an_hr_admin(api_client, as_platform, mock_pool):
    """The role exists so a firm can appoint an HR administrator WITHOUT making
    them an org_admin, who reaches every active module including the books. If
    the console cannot grant the narrow one, "make them an org_admin" stays the
    only way to set up HR — which is the gap this role closes."""
    _console(mock_pool, GOD)
    r = await _assign(api_client, "hr_admin")
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "hr_admin"


async def test_appointing_an_hr_admin_costs_a_seat(api_client, as_platform, mock_pool):
    _console(mock_pool, GOD)
    r = await _assign(api_client, "hr_admin")
    assert r.json()["consumes_seat"] is True


async def test_an_hr_admin_is_refused_when_the_org_is_full(
    api_client, as_platform, mock_pool
):
    """The seat cap is the customer's contract, so it binds this door as it
    binds the other four."""
    _console(mock_pool, GOD, limit=5, seats_used=5)
    r = await _assign(api_client, "hr_admin")
    assert r.status_code == 409, r.text
    assert "seats" in r.json()["detail"]


# ── The two project-only roles: assignable, and free ─────────────────────────

@pytest.mark.parametrize("code", ["org_client", "aekam_team"])
async def test_a_project_only_role_costs_no_seat(
    api_client, as_platform, mock_pool, code
):
    _console(mock_pool, GOD)
    r = await _assign(api_client, code)
    assert r.status_code == 200, r.text
    assert r.json()["consumes_seat"] is False


@pytest.mark.parametrize("code", ["org_client", "aekam_team"])
async def test_a_project_only_role_is_granted_even_when_the_org_is_full(
    api_client, as_platform, mock_pool, code
):
    """THE POINT OF THE WHOLE SPLIT. Counting a seat for a client would mean
    asking a customer to buy a seat for the person they are doing the work for,
    and an agency at its allowance could not add the next client to the next
    project."""
    _console(mock_pool, GOD, limit=5, seats_used=5)
    r = await _assign(api_client, code)
    assert r.status_code == 200, r.text
    assert r.json()["consumes_seat"] is False


# ── What the console still may NOT hand out ──────────────────────────────────

@pytest.mark.parametrize("code", ["org_owner", "org_member"])
async def test_the_console_still_refuses_ownership_and_plain_membership(
    api_client, as_platform, mock_pool, code
):
    """Widening the console to three new codes must not widen it to the two it
    was deliberately narrowed away from. `org_owner` is the authority that
    appoints payroll approvers; `org_member` is ordinary membership and belongs
    to the organisation's own admin."""
    _console(mock_pool, GOD)
    r = await _assign(api_client, code)
    assert r.status_code == 400, r.text
    assert code in r.json()["detail"]


async def test_an_org_scoped_role_without_an_org_is_refused(
    api_client, as_platform, mock_pool
):
    _console(mock_pool, GOD)
    r = await _assign(api_client, "hr_admin", org_id=None)
    assert r.status_code == 400
    assert "org_id" in r.json()["detail"]


async def test_an_invented_role_code_is_refused(api_client, as_platform, mock_pool):
    """Fails closed. A code the model has never heard of must not fall through
    to the org branch and become a row the CHECK constraint then rejects with a
    23514 nobody can read."""
    _console(mock_pool, GOD)
    r = await _assign(api_client, "org_superuser")
    assert r.status_code == 400
    assert "Invalid role" in r.json()["detail"]


# ── The catalogue: the seat consequence, served rather than transcribed ──────

async def test_the_catalogue_states_the_seat_consequence_for_every_role(
    api_client, as_platform, mock_pool
):
    _console(mock_pool, GOD)
    r = await api_client.get("/api/v1/admin/orgs/roles/catalogue")
    assert r.status_code == 200, r.text
    body = r.json()
    by_code = {e["code"]: e for e in body["org"]}

    assert by_code["hr_admin"]["consumes_seat"] is True
    assert by_code["org_client"]["consumes_seat"] is False
    assert by_code["aekam_team"]["consumes_seat"] is False
    assert by_code["org_admin"]["consumes_seat"] is True

    # A platform role is Aekam's own staff and is never a seat in a customer's
    # allowance.
    for entry in body["platform"]:
        assert entry["consumes_seat"] is False


async def test_the_catalogue_says_hr_admin_reaches_manav_and_pahchan(
    api_client, as_platform, mock_pool
):
    _console(mock_pool, GOD)
    body = (await api_client.get("/api/v1/admin/orgs/roles/catalogue")).json()
    by_code = {e["code"]: e for e in body["org"]}
    assert by_code["hr_admin"]["modules"] == ["manav", "pahchan"]
    assert "vetana" not in by_code["hr_admin"]["modules"]
    assert "ganit" not in by_code["hr_admin"]["modules"]


async def test_the_catalogue_says_a_project_only_role_reaches_no_module(
    api_client, as_platform, mock_pool
):
    """The screen has to be able to say "this grants the project and nothing
    else" without the operator taking it on trust."""
    _console(mock_pool, GOD)
    body = (await api_client.get("/api/v1/admin/orgs/roles/catalogue")).json()
    by_code = {e["code"]: e for e in body["org"]}
    for code in ("org_client", "aekam_team"):
        assert by_code[code]["modules"] == []
        assert by_code[code]["project_only"] is True
        assert by_code[code]["surfaces"] == [
            "notifications", "projects", "task_approvals", "tasks",
        ]


async def test_the_catalogue_agrees_with_the_endpoint_about_what_is_assignable(
    api_client, as_platform, mock_pool
):
    """A screen offering a role the route refuses is a button that 400s, which
    is the failure `platformRoles.js` was rewritten to end."""
    _console(mock_pool, GOD)
    body = (await api_client.get("/api/v1/admin/orgs/roles/catalogue")).json()
    assert set(body["assignable_org_roles"]) == {
        "org_admin", "hr_admin", "org_client", "aekam_team",
    }
    for entry in body["org"]:
        assert entry["assignable"] == (entry["code"] in body["assignable_org_roles"])


# ── Who holds what, and in which org ─────────────────────────────────────────

async def test_the_org_role_listing_names_the_org_and_the_cost(
    api_client, as_platform, mock_pool
):
    """`/roles/platform` filters `org_id IS NULL`, so "who is the HR
    administrator of Unicode Group" had no endpoint and no screen — the only way
    to answer it was a query against the shared production database."""
    _console(mock_pool, GOD, org_rows=[{
        "id": "role-1", "user_id": TARGET, "role_code": "org_client",
        "granted_at": None, "org_id": ORG,
        "email": "info+client@unicodegroup.com", "full_name": "A Client",
        "org_name": "Unicode Group", "granted_by_email": "success+ops@simulator.amazonses.com",
    }])
    r = await api_client.get("/api/v1/admin/orgs/roles/org")
    assert r.status_code == 200, r.text
    row = r.json()[0]
    assert row["org_name"] == "Unicode Group"
    assert row["consumes_seat"] is False
    assert row["granted_by_email"]


# ── The guard. A role that can grant roles can grant itself anything ─────────

@pytest.mark.parametrize("path", [
    "/api/v1/admin/orgs/roles/catalogue",
    "/api/v1/admin/orgs/roles/org",
])
async def test_the_new_reads_are_god_mode_only(
    api_client, as_platform, mock_pool, path
):
    """Same guard as the three routes they sit beside. A list of every role and
    everything it reaches is a map of the product's authority model, and the
    org listing names people."""
    _console(mock_pool, STAFF)
    r = await api_client.get(path)
    assert r.status_code == 403, r.text


async def test_granting_a_free_role_is_still_god_mode_only(
    api_client, as_platform, mock_pool
):
    """Costing no seat does not make it a small grant: `aekam_team` puts an
    Aekam account inside a customer's project."""
    _console(mock_pool, STAFF)
    r = await _assign(api_client, "aekam_team")
    assert r.status_code == 403, r.text
