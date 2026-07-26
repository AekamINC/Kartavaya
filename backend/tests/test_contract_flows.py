"""End-to-end backend contract, through the real router stack.

The rest of the suite tests routes one at a time, usually with `require_user`
replaced via `dependency_overrides`. That is the right tool for asserting what a
handler does, but it means the authentication layer itself is never on the path
— the tests would pass with `require_user` deleted.

These exercise whole flows against a mocked pool with NO auth override: the token
is minted by logging in, carried the way a browser carries it, and the protected
read either works or does not. Where a route is the subject, its own gates stay
in place; only unrelated module/subscription gates are bypassed.

Nothing here reaches a network, a database, or an outbound channel.
"""

import json

import pytest
from httpx import ASGITransport, AsyncClient

from helpers import TEST_PASSWORD, make_task_row

MEMBER_UID = "user_mem001"
CLIENT_UID = "user_client001"
OTHER_UID = "user_someone_else"


# ══════════════════════════════════════════════════════════════════════════════
# 1. Login → session cookie → an authenticated read
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
async def https_client(app):
    """The session cookie is `Secure`, so a client on `http://` will not send it
    back — correctly, and the shared `api_client` fixture is on http.

    Using https here is not a workaround for the flag; it is the point. The
    round trip only means something if it runs under the scheme production
    runs under.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test"
    ) as client:
        yield client


def _login_pool(mock_pool, user_row):
    """Route by query text: login reads `SELECT *`, require_user reads a column
    list. Ordering by call index would couple the fixture to handler internals."""
    async def _fetchrow(query, *args):
        return user_row

    async def _fetch(query, *args):
        return []          # no platform rows, no org rows

    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetch.side_effect = _fetch


async def test_login_then_reach_a_protected_route_with_the_cookie_alone(
    https_client, mock_pool, member_user,
):
    """The whole session contract in one path.

    Every other test of `/api/me` presents a hand-minted bearer token, so the
    thing that actually keeps users logged in — the httponly cookie set by
    `/login` and read back by `require_user` — was never exercised end to end.
    """
    _login_pool(mock_pool, member_user)

    login = await https_client.post(
        "/api/auth/login",
        json={"email": member_user["email"], "password": TEST_PASSWORD},
    )
    assert login.status_code == 200, login.text
    assert login.json()["token"]

    cookie = login.cookies.get("session_token")
    assert cookie, "login did not set a session cookie"

    # No Authorization header. The cookie alone must carry the session.
    me = await https_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user_id"] == member_user["user_id"]


async def test_the_session_cookie_is_not_readable_by_script(
    https_client, mock_pool, member_user,
):
    """A session token in a JS-readable cookie is an XSS away from account
    takeover. Asserted on the raw Set-Cookie header, because httpx exposes the
    value either way."""
    _login_pool(mock_pool, member_user)

    login = await https_client.post(
        "/api/auth/login",
        json={"email": member_user["email"], "password": TEST_PASSWORD},
    )
    raw = login.headers.get("set-cookie", "").lower()
    assert "httponly" in raw
    assert "samesite" in raw
    # Secure, so the session never crosses a plaintext hop. This is also why the
    # flow above needs an https client at all.
    assert "secure" in raw


async def test_a_wrong_password_yields_no_session_at_all(
    https_client, mock_pool, member_user,
):
    """The contrast. Without it the flow above passes on a login that admits
    everyone."""
    _login_pool(mock_pool, member_user)

    login = await https_client.post(
        "/api/auth/login",
        json={"email": member_user["email"], "password": "not-the-password"},
    )
    assert login.status_code == 401
    assert not login.cookies.get("session_token")

    me = await https_client.get("/api/auth/me")
    assert me.status_code == 401


async def test_logout_ends_the_session(https_client, mock_pool, member_user):
    _login_pool(mock_pool, member_user)
    await https_client.post(
        "/api/auth/login",
        json={"email": member_user["email"], "password": TEST_PASSWORD},
    )
    assert (await https_client.get("/api/auth/me")).status_code == 200

    await https_client.post("/api/auth/logout")
    assert (await https_client.get("/api/auth/me")).status_code == 401


async def test_a_tampered_token_is_refused(https_client, mock_pool, member_user):
    """The signature is the only thing standing between a user id in a cookie
    and impersonation."""
    _login_pool(mock_pool, member_user)
    login = await https_client.post(
        "/api/auth/login",
        json={"email": member_user["email"], "password": TEST_PASSWORD},
    )
    good = login.json()["token"]
    forged = good[:-6] + ("aaaaaa" if not good.endswith("aaaaaa") else "bbbbbb")

    resp = await https_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {forged}"}
    )
    assert resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# 2. Attachment privacy holds on EVERY route that returns a task
# ══════════════════════════════════════════════════════════════════════════════
#
# test_task_attachment_privacy.py asserts this per route. This asserts it as a
# property of the surface: whichever route you reach a task through, a private
# file you are not on does not come back. A fourth task read added later that
# forgets to filter is the failure mode, and it is invisible to a per-route test
# because there is no test for a route nobody has written yet.

_MIXED = json.dumps([
    {"name": "public.pdf", "url": "https://r2.example/public",
     "key": "org/a/public.pdf", "is_private": False},
    {"name": "private.pdf", "url": "https://r2.example/private",
     "key": "org/a/private.pdf", "is_private": True,
     "visible_to": ["user_partner_only"]},
])


@pytest.fixture(autouse=True)
def _no_org_lookup(mock_pool):
    """No org resolves from the team, so `_refresh_task_attachments` returns
    before it reaches storage. Nothing signs a real R2 URL in this file."""
    import server
    server._team_org_cache.clear()
    yield
    server._team_org_cache.clear()


def _task_visible_to_member(mock_pool, task_row):
    async def _fetch(query, *args):
        if "team_id FROM teams" in query or "team_members" in query:
            return [{"team_id": "team_001"}]
        if "project_assignments" in query:
            return [{"team_id": "team_001"}]
        if "task_reminders" in query:
            return []
        return [task_row]

    async def _fetchrow(query, *args):
        if "org_id FROM teams" in query:
            return None
        return task_row

    mock_pool.fetch.side_effect = _fetch
    mock_pool.fetchrow.side_effect = _fetchrow


@pytest.mark.parametrize("path", ["/api/tasks", "/api/tasks/task_shared"])
async def test_no_task_read_hands_a_private_file_to_a_non_recipient(
    api_client, mock_pool, as_member, path,
):
    """Neither the name nor the URL. The URL is the severe half — the response
    carries a freshly signed R2 credential, not merely a filename."""
    _task_visible_to_member(mock_pool, make_task_row(
        task_id="task_shared",
        created_by_user_id=OTHER_UID,
        user_id=OTHER_UID,
        attachments=_MIXED,
    ))

    resp = await api_client.get(path)
    assert resp.status_code == 200
    assert "private.pdf" not in resp.text, path
    assert "r2.example/private" not in resp.text, path
    # The public file still comes through, so this cannot pass on an empty body.
    assert "public.pdf" in resp.text, path


@pytest.mark.parametrize("path", ["/api/tasks", "/api/tasks/task_shared"])
async def test_the_creator_still_receives_their_own_private_file(
    api_client, mock_pool, as_member, path,
):
    _task_visible_to_member(mock_pool, make_task_row(
        task_id="task_shared",
        created_by_user_id=MEMBER_UID,
        user_id=MEMBER_UID,
        attachments=_MIXED,
    ))

    resp = await api_client.get(path)
    assert resp.status_code == 200
    assert "private.pdf" in resp.text, path


async def test_a_client_reaching_the_same_task_gets_neither(
    api_client, mock_pool, as_client_user,
):
    """The client portal is the third read and the one with an external party on
    the other end."""
    mock_pool.fetch.return_value = [make_task_row(
        task_id="task_shared",
        created_by_user_id=OTHER_UID,
        attachments=_MIXED,
    )]
    mock_pool.fetchrow.return_value = None

    resp = await api_client.get("/api/client/tasks")
    assert resp.status_code == 200
    assert "private.pdf" not in resp.text
    assert "r2.example/private" not in resp.text


# ══════════════════════════════════════════════════════════════════════════════
# 3. A client receives their own approvals, not the firm's queue
# ══════════════════════════════════════════════════════════════════════════════

async def test_client_approvals_are_scoped_to_the_caller_in_the_query(
    api_client, mock_pool, as_client_user,
):
    """`test_client_portal_shape.py` pins the SHAPE — which fields may cross.
    This pins the SET — which rows may. They are separate failures: the original
    defect returned the firm's own pending queue for a project the client was
    assigned to, and a perfect allow-list shape would still have shipped it, just
    with fewer columns.

    A route scoped by nothing would also return an empty list against this mock,
    so the assertion is on the query rather than on the response.
    """
    seen = []

    async def _fetch(query, *args):
        seen.append((query, args))
        return []

    mock_pool.fetch.side_effect = _fetch
    resp = await api_client.get("/api/client/approvals")
    assert resp.status_code == 200

    assert seen, "no query ran"
    for query, args in seen:
        assert CLIENT_UID in args, (
            "an approvals query ran without the caller's id — it is scoped by "
            "something other than who is asking"
        )
        # Scoped to rows the client raised or that sit on a task shared with
        # them. `project_assignments` alone is what leaked the firm's queue.
        assert "task_clients" in query or "requested_by = $1" in query, query


async def test_client_approvals_carry_no_staff_email_even_when_the_row_has_one(
    api_client, mock_pool, as_client_user,
):
    """Checked as raw text, not by key: an address can ride inside a value such
    as a review note."""
    mock_pool.fetch.return_value = [{
        "approval_id": "appr_001",
        "task_id": "task_c1",
        "task_title": "Sign off Q2 filing",
        "request_data": json.dumps({"title": "Sign off", "description": "Please confirm."}),
        "created_at": None,
        "requested_by_name": "A Partner",
        "requested_by_email": "partner@firm.example",
        "review_notes": "chase senior@firm.example on Friday",
        "reviewed_by": "user_staff_reviewer",
        "status": "pending",
    }]

    resp = await api_client.get("/api/client/approvals")
    assert resp.status_code == 200
    assert "@firm.example" not in resp.text
    assert "user_staff_reviewer" not in resp.text
    assert "chase senior" not in resp.text


# ══════════════════════════════════════════════════════════════════════════════
# 4. Payroll self-scoping, with the module gate genuinely on the path
# ══════════════════════════════════════════════════════════════════════════════

async def test_payslips_are_self_scoped_without_an_org_role(
    app, api_client, mock_pool, as_member,
):
    """A Vetana grant is a tab, not the salary register. Someone with the module
    and no org role sees their own payslips and nobody else's — the query must
    carry their employee row, not just the org."""
    from middleware.org_resolver import get_org_id
    from routers.vetana import _gate
    app.dependency_overrides[_gate] = lambda: None
    app.dependency_overrides[get_org_id] = lambda: "00000000-0000-0000-0000-00000000000a"

    async def _not_admin(user_id, org_id=None):
        return False

    import routers.vetana as vetana
    original = vetana.is_org_admin
    vetana.is_org_admin = _not_admin
    try:
        seen = []

        async def _fetch(query, *args):
            seen.append((query, args))
            return []

        async def _fetchval(query, *args):
            # The caller's own employee row.
            return "e0000000-0000-0000-0000-00000000005e"

        mock_pool.fetch.side_effect = _fetch
        mock_pool.fetchval.side_effect = _fetchval

        resp = await api_client.get("/api/v1/vetana/payslips")
        assert resp.status_code == 200

        payslip_queries = [q for q, _ in seen if "payslip" in q.lower()]
        assert payslip_queries, "no payslip query ran"
        for query in payslip_queries:
            assert "employee_id" in query, (
                "the payslip list is not narrowed to an employee row: "
                + query
            )
    finally:
        vetana.is_org_admin = original
        app.dependency_overrides.pop(_gate, None)
        app.dependency_overrides.pop(get_org_id, None)
