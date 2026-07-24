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
