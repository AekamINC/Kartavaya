"""
Unit tests for auth_router.py endpoints.

Coverage:
  POST /api/auth/login           — success, wrong password, unknown email, bad format
  GET  /api/auth/me              — authenticated, unauthenticated, invalid token
  POST /api/auth/logout          — always 200
  POST /api/auth/forgot-password — always 200 (no email enumeration)
  POST /api/auth/reset-password  — valid token, expired/missing token
  POST /api/auth/accept-invite   — valid invite, expired invite, duplicate account
"""

import pytest
from helpers import TEST_PASSWORD, make_token


# ── /api/auth/login ───────────────────────────────────────────────────────────

async def test_login_success(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"],
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == admin_user["email"]
    assert data["user"]["role"] == "admin"


async def test_login_wrong_password(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"],
        "password": "WrongPassword!",
    })
    assert resp.status_code == 401
    assert "Invalid" in resp.json()["detail"]


async def test_login_unknown_email(api_client, mock_pool):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post("/api/auth/login", json={
        "email": "nobody@test.com",
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 401


async def test_login_invalid_email_format(api_client):
    resp = await api_client.post("/api/auth/login", json={
        "email": "not-an-email",
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 422


async def test_login_missing_password(api_client):
    resp = await api_client.post("/api/auth/login", json={"email": "a@b.com"})
    assert resp.status_code == 422


# ── /api/auth/me ─────────────────────────────────────────────────────────────

async def test_me_authenticated(api_client, mock_pool, admin_user):
    """require_user fetches the user row from DB; should return sanitised fields."""
    token = make_token(admin_user["user_id"])
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == admin_user["email"]
    assert "password_hash" not in data
    assert "salt" not in data


async def test_me_unauthenticated(api_client):
    resp = await api_client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_me_invalid_token(api_client):
    resp = await api_client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer thisisnotavalidtoken"},
    )
    assert resp.status_code == 401


async def test_me_expired_token(api_client, mock_pool, admin_user):
    import jwt
    from datetime import datetime, timezone
    import os
    expired = jwt.encode(
        {"sub": admin_user["user_id"], "exp": datetime(2020, 1, 1, tzinfo=timezone.utc)},
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )
    resp = await api_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert resp.status_code == 401


# ── /api/auth/logout ─────────────────────────────────────────────────────────

async def test_logout_always_200(api_client):
    resp = await api_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── /api/auth/forgot-password ─────────────────────────────────────────────────

async def test_forgot_password_unknown_email_returns_200(api_client, mock_pool):
    """Always 200 to prevent email enumeration."""
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post(
        "/api/auth/forgot-password", json={"email": "ghost@test.com"}
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


async def test_forgot_password_known_user_updates_db(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = {
        "user_id": admin_user["user_id"],
        "name": admin_user["name"],
        "email": admin_user["email"],
    }
    resp = await api_client.post(
        "/api/auth/forgot-password", json={"email": admin_user["email"]}
    )
    assert resp.status_code == 200
    # Verify the DB UPDATE was called to store the reset token
    mock_pool.execute.assert_called()
    call_args = mock_pool.execute.call_args_list
    sql_calls = [str(c) for c in call_args]
    assert any("password_reset_token" in s for s in sql_calls)


# ── /api/auth/reset-password ──────────────────────────────────────────────────

async def test_reset_password_valid_token(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/reset-password", json={
        "token": "valid-reset-token",
        "password": "NewPassword456!",
    })
    assert resp.status_code == 200
    assert "token" in resp.json()


async def test_reset_password_invalid_token(api_client, mock_pool):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post("/api/auth/reset-password", json={
        "token": "expired-or-wrong-token",
        "password": "NewPassword456!",
    })
    assert resp.status_code == 400
    assert "invalid" in resp.json()["detail"].lower()


async def test_reset_password_too_short(api_client):
    resp = await api_client.post("/api/auth/reset-password", json={
        "token": "sometoken",
        "password": "short",
    })
    assert resp.status_code == 422


# ── /api/auth/accept-invite ───────────────────────────────────────────────────

async def _make_invite(email="new@test.com", accepted_at=None, expires_delta_days=7):
    from datetime import datetime, timezone, timedelta
    return {
        "token": "invite-token-xyz",
        "email": email,
        "role": "member",
        "full_name": None,
        "member_role": None,
        "receives_approval_emails": True,
        "accepted_at": accepted_at,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=expires_delta_days),
    }


async def test_accept_invite_success(api_client, mock_pool):
    invite = await _make_invite()
    call_count = 0

    async def fetchrow_side_effect(query, *args):
        nonlocal call_count
        call_count += 1
        if "invites WHERE token" in query:
            return invite
        if "users WHERE email" in query:
            return None  # no existing user
        if "users WHERE user_id" in query:
            return {
                "user_id": "user_newxxx",
                "email": invite["email"],
                "name": "New User",
                "full_name": "New User",
                "role": "member",
                "avatar": None,
            }
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    mock_pool.execute.return_value = "INSERT 1"
    resp = await api_client.post("/api/auth/accept-invite", json={
        "token": "invite-token-xyz",
        "name": "New User",
        "password": "NewPass123!",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == invite["email"]


async def test_accept_invite_already_accepted(api_client, mock_pool):
    from datetime import datetime, timezone
    invite = await _make_invite(accepted_at=datetime.now(timezone.utc))
    mock_pool.fetchrow.return_value = invite
    resp = await api_client.post("/api/auth/accept-invite", json={
        "token": "invite-token-xyz",
        "name": "User",
        "password": "SomePass123!",
    })
    assert resp.status_code == 400
    assert "already" in resp.json()["detail"].lower()


async def test_accept_invite_expired(api_client, mock_pool):
    invite = await _make_invite(expires_delta_days=-1)
    mock_pool.fetchrow.return_value = invite
    resp = await api_client.post("/api/auth/accept-invite", json={
        "token": "invite-token-xyz",
        "name": "User",
        "password": "SomePass123!",
    })
    assert resp.status_code == 400
    assert "expired" in resp.json()["detail"].lower()


async def test_accept_invite_duplicate_account(api_client, mock_pool, admin_user):
    invite = await _make_invite(email=admin_user["email"])

    async def fetchrow_side_effect(query, *args):
        if "invites WHERE token" in query:
            return invite
        if "users WHERE email" in query:
            return admin_user  # account already exists
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    resp = await api_client.post("/api/auth/accept-invite", json={
        "token": "invite-token-xyz",
        "name": "Admin",
        "password": "SomePass123!",
    })
    assert resp.status_code == 409


# ── Cookie behaviour ────────────────────────────────────────────────────────

async def test_login_sets_httponly_cookie(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"],
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 200
    cookie_header = resp.headers.get("set-cookie", "")
    assert "session_token=" in cookie_header
    assert "httponly" in cookie_header.lower()
    assert "samesite=lax" in cookie_header.lower()


async def test_accept_invite_sets_httponly_cookie(api_client, mock_pool):
    invite = await _make_invite()

    async def fetchrow_side_effect(query, *args):
        if "invites WHERE token" in query:
            return invite
        if "users WHERE email" in query:
            return None
        if "users WHERE user_id" in query:
            return {
                "user_id": "user_newxxx",
                "email": invite["email"],
                "name": "New User",
                "full_name": "New User",
                "role": "member",
                "avatar": None,
            }
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    mock_pool.execute.return_value = "INSERT 1"
    resp = await api_client.post("/api/auth/accept-invite", json={
        "token": "invite-token-xyz",
        "name": "New User",
        "password": "NewPass123!",
    })
    assert resp.status_code == 200
    cookie_header = resp.headers.get("set-cookie", "")
    assert "session_token=" in cookie_header
    assert "httponly" in cookie_header.lower()


async def test_reset_password_sets_httponly_cookie(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/reset-password", json={
        "token": "valid-reset-token",
        "password": "NewPassword456!",
    })
    assert resp.status_code == 200
    cookie_header = resp.headers.get("set-cookie", "")
    assert "session_token=" in cookie_header
    assert "httponly" in cookie_header.lower()


async def test_logout_clears_cookie(api_client):
    resp = await api_client.post("/api/auth/logout")
    assert resp.status_code == 200
    cookie_header = resp.headers.get("set-cookie", "")
    assert "session_token=" in cookie_header
    assert 'max-age=0' in cookie_header.lower() or '01 jan 1970' in cookie_header.lower() or '="";' in cookie_header


# ── Audit logging ────────────────────────────────────────────────────────────

from unittest.mock import patch


async def test_login_success_emits_audit(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    with patch("auth_router.audit") as mock_audit:
        resp = await api_client.post("/api/auth/login", json={
            "email": admin_user["email"],
            "password": TEST_PASSWORD,
        })
        assert resp.status_code == 200
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args
        assert call_args[0][0] == "auth.login"


async def test_login_failed_emits_audit_warn(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    with patch("auth_router.audit") as mock_audit, \
         patch("auth_router.limiter._check_request_limit", return_value=None):
        resp = await api_client.post("/api/auth/login", json={
            "email": admin_user["email"],
            "password": "WrongPassword!",
        })
        assert resp.status_code == 401
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args
        assert call_args[0][0] == "auth.login_failed"
        assert call_args[1].get("severity") == "warn"


async def test_reset_password_emits_audit(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    with patch("auth_router.audit") as mock_audit:
        resp = await api_client.post("/api/auth/reset-password", json={
            "token": "valid-reset-token",
            "password": "NewPassword456!",
        })
        assert resp.status_code == 200
        mock_audit.assert_called_once()
        call_args = mock_audit.call_args
        assert call_args[0][0] == "auth.password_reset"


# ── GET /api/auth/invite/{token} — the accept screen's context ───────────────
#
# The accept-invite screen showed a name field, a password field and nothing
# about what was being accepted. Every field it needed — org, inviter, role,
# module grants — was already on the invite row and unreadable. These tests pin
# the two properties that matter: it says what you are joining, and it will not
# tell you WHY a bad token is bad.

async def _org_invite(**over):
    """An org-scoped invite row, i.e. one written by routers/org_invites.py."""
    inv = await _make_invite(email="rohan@aekam.co")
    inv.update({
        "invited_by": "user_admin001",
        "org_id": "11111111-2222-3333-4444-555555555555",
        "member_role": "org_admin",
        "module_grants": '[{"code":"graha","role":"editor"},{"code":"ganit","role":"viewer"}]',
    })
    inv.update(over)
    return inv


async def test_preview_invite_returns_org_inviter_role_and_grants(api_client, mock_pool):
    invite = await _org_invite()

    async def fetchrow_side_effect(query, *args):
        return invite if "invites WHERE token" in query else None

    async def fetchval_side_effect(query, *args):
        if "organisations" in query:
            return "Aekam Inc"
        if "COUNT(DISTINCT user_id)" in query:
            return 6
        if "COALESCE(full_name, name, email)" in query:
            return "Keval Shah"
        return None

    async def fetch_side_effect(query, *args):
        if "module_subscriptions" in query:
            return [{"module_code": "graha"}, {"module_code": "ganit"}]
        return []

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    mock_pool.fetchval.side_effect = fetchval_side_effect
    mock_pool.fetch.side_effect = fetch_side_effect

    resp = await api_client.get("/api/auth/invite/invite-token-xyz")
    assert resp.status_code == 200
    data = resp.json()
    assert data["org_name"] == "Aekam Inc"
    assert data["org_members"] == 6
    assert data["org_role"] == "org_admin"
    assert data["invited_by_name"] == "Keval Shah"
    assert data["account_exists"] is False
    assert data["module_grants"] == [
        {"code": "graha", "role": "editor"},
        {"code": "ganit", "role": "viewer"},
    ]


async def test_preview_invite_drops_a_grant_the_org_no_longer_has(api_client, mock_pool):
    """An invite lives seven days; a module can be switched off inside that
    window. The screen must not promise access that `accept_invite` will then
    silently refuse to write — it re-validates against live subscriptions too."""
    invite = await _org_invite()

    async def fetchrow_side_effect(query, *args):
        return invite if "invites WHERE token" in query else None

    async def fetch_side_effect(query, *args):
        if "module_subscriptions" in query:
            return [{"module_code": "graha"}]      # ganit was deactivated
        return []

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    mock_pool.fetch.side_effect = fetch_side_effect
    mock_pool.fetchval.side_effect = None
    mock_pool.fetchval.return_value = None

    resp = await api_client.get("/api/auth/invite/invite-token-xyz")
    assert resp.status_code == 200
    assert [g["code"] for g in resp.json()["module_grants"]] == ["graha"]


async def test_preview_invite_is_one_answer_for_every_dead_token(api_client, mock_pool):
    """Unknown, expired and already-accepted must be indistinguishable, or the
    endpoint becomes a way to sweep for live tokens."""
    from datetime import datetime, timezone

    bodies = []
    for row in (
        None,
        await _make_invite(expires_delta_days=-1),
        await _make_invite(accepted_at=datetime.now(timezone.utc)),
    ):
        async def fetchrow_side_effect(query, *args, _r=row):
            return _r if "invites WHERE token" in query else None
        mock_pool.fetchrow.side_effect = fetchrow_side_effect
        resp = await api_client.get("/api/auth/invite/some-token")
        assert resp.status_code == 404
        bodies.append(resp.json()["detail"])

    assert len(set(bodies)) == 1, bodies


async def test_preview_invite_flags_an_address_that_now_has_an_account(api_client, mock_pool):
    invite = await _org_invite()

    async def fetchrow_side_effect(query, *args):
        return invite if "invites WHERE token" in query else None

    async def fetchval_side_effect(query, *args):
        if "FROM users WHERE LOWER(email)" in query:
            return 1
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    mock_pool.fetchval.side_effect = fetchval_side_effect
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/auth/invite/invite-token-xyz")
    assert resp.status_code == 200
    assert resp.json()["account_exists"] is True


# ── POST /api/auth/invite/{token}/decline ────────────────────────────────────

async def test_decline_invite_expires_the_row(api_client, mock_pool):
    async def fetchrow_side_effect(query, *args):
        if "UPDATE invites SET expires_at" in query:
            return {"invite_id": "inv_abc", "email": "rohan@aekam.co"}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side_effect
    resp = await api_client.post("/api/auth/invite/invite-token-xyz/decline")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_decline_of_a_dead_token_matches_the_preview_word_for_word(
    api_client, mock_pool,
):
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post("/api/auth/invite/already-declined/decline")
    assert resp.status_code == 404
    preview = await api_client.get("/api/auth/invite/already-declined")
    assert resp.json()["detail"] == preview.json()["detail"]


# ── POST /api/auth/refresh ───────────────────────────────────────────────────
#
# It slides a live session's window forward. It CANNOT revive an expired one —
# require_user rejects the token before the handler runs — and the test below
# pins that, because the whole point of adding the route was to stop the
# frontend guessing about it.

async def test_refresh_issues_a_new_token_and_cookie(api_client, mock_pool, admin_user, as_admin):
    resp = await api_client.post("/api/auth/refresh")
    assert resp.status_code == 200
    data = resp.json()
    assert data["token"]
    assert data["user"]["email"] == admin_user["email"]
    cookie_header = resp.headers.get("set-cookie", "")
    assert "session_token=" in cookie_header
    assert "httponly" in cookie_header.lower()


async def test_refresh_without_a_session_is_401(api_client, mock_pool):
    resp = await api_client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_rejects_an_expired_token(api_client, mock_pool, admin_user):
    """A sliding window, not a resurrection. If this ever starts passing an
    expired token through, the frontend's `expired → /login` path becomes a lie."""
    import jwt as _jwt
    from datetime import datetime, timedelta, timezone
    import auth_router as ar

    dead = _jwt.encode(
        {"sub": admin_user["user_id"],
         "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
         "iat": datetime.now(timezone.utc) - timedelta(days=8)},
        ar.JWT_SECRET, algorithm=ar.JWT_ALGORITHM,
    )
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post(
        "/api/auth/refresh", headers={"Authorization": f"Bearer {dead}"}
    )
    assert resp.status_code == 401


# ── Accepting an invitation ───────────────────────────────────────────────────
#
# The mocked pool below cannot catch what follows, and that is the point of
# writing it as a source check instead.

def test_the_project_assignment_sync_casts_its_one_placeholder():
    """`$1` is used against two columns of DIFFERENT types, so it must be cast.

    `accept_invite` syncs the new member into `project_assignments` with one
    statement that binds `$1` twice:

        INSERT INTO project_assignments (…, user_id, …)
        SELECT …, $1, …  FROM team_members WHERE user_id=$1

    `project_assignments.user_id` is `character varying`; `team_members.user_id`
    is `text`. Untyped, asyncpg has to deduce ONE type for `$1` from two columns
    that disagree, and refuses — so this raised on EVERY acceptance.

    What made it expensive is where it sits. The `users` INSERT and the
    `team_members` sync are separate autocommitted statements ABOVE it, so the
    account half-landed: the person existed, held a team row, and could not sign
    in to anything, because the request 500'd before a session came back. Trying
    again hit the already-used-invite guard. The product is invite-only, so this
    was the only way in.

    No test caught it: every test in this file drives a MagicMock pool, which
    binds anything to anything. Only Postgres deduces types, and the E2E suite
    skipped the step. Hence a source assertion — it is the only kind that can
    see this without a live database.

    The same fix and the same reasoning are already recorded in `server.py`'s
    approval update. Reconciling the two columns to one type is a migration on a
    schema production shares; the cast is what stops the 500 today.
    """
    import inspect
    import re

    import auth_router

    src = inspect.getsource(auth_router.accept_invite)
    stmt = re.search(r"INSERT INTO project_assignments.*?\"\"\"", src, re.S)
    assert stmt, "the project_assignments sync is no longer recognisable"

    body = stmt.group(0)
    bare = re.findall(r"\$1(?!::)", body)
    assert not bare, (
        f"{len(bare)} use(s) of $1 in the project_assignments sync carry no "
        "::text cast — asyncpg cannot deduce one type across "
        "project_assignments.user_id (varchar) and team_members.user_id (text), "
        "so accepting an invitation 500s after the account row is already "
        "committed"
    )
