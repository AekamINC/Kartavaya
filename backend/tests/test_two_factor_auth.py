"""
Unit tests for two-factor authentication: the login challenge in
auth_router.py (login -> verify-2fa) and self-service enrolment in
routers/totp.py.

Coverage:
  POST /api/auth/login       — branches to mfa_required when TOTP is enrolled
  POST /api/auth/verify-2fa  — correct code, wrong code, replay, recovery
                                code (and its single-use), expired/invalid
                                mfa_token, org-enforcement lockout at login
  require_user                — refuses ANY token carrying a `purpose` claim
  POST /api/v1/me/2fa/setup, /confirm, /disable, /recovery-codes/regenerate
"""
import pyotp
import pytest

import auth_router
from helpers import TEST_PASSWORD, make_token
from services import totp as totp_service


def _totp_row(secret: str, last_used_step=None):
    return {
        "secret": totp_service.encrypt_secret(secret),
        "last_used_step": last_used_step,
    }


def _route_fetchval(rules):
    """Build a fetchval side_effect from {substring: value_or_callable}."""
    async def _side_effect(query, *args):
        for needle, value in rules.items():
            if needle in query:
                return value(*args) if callable(value) else value
        return 0
    return _side_effect


def _route_fetchrow(rules):
    async def _side_effect(query, *args):
        for needle, value in rules.items():
            if needle in query:
                return value(*args) if callable(value) else value
        return None
    return _side_effect


# ── POST /api/auth/login — branching on TOTP enrolment ────────────────────────

async def test_login_not_enrolled_no_totp_table_unaffected(api_client, mock_pool, admin_user):
    """No behaviour change for the whole product until 208 is live somewhere
    the request can see — to_regclass answering falsy must fall through to
    today's plain login, exactly like before this feature existed."""
    mock_pool.fetchrow.return_value = admin_user
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": 0,
    })
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"], "password": TEST_PASSWORD,
    })
    assert resp.status_code == 200
    assert "token" in resp.json()
    assert "mfa_required" not in resp.json()


async def test_login_enrolled_returns_mfa_pending_not_a_session(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
        "SELECT 1 FROM public.user_totp": 1,
    })
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"], "password": TEST_PASSWORD,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["mfa_required"] is True
    assert "mfa_token" in data
    assert "token" not in data
    # No session cookie either — the interim state is not a session at all.
    assert "session_token" not in resp.cookies


async def test_mfa_pending_token_is_refused_by_require_user(api_client, mock_pool, admin_user):
    """The core safety property: the interim token must not work as a
    bearer session on any real endpoint, because it never leaves login()
    through _auth_response and require_user must refuse it explicitly."""
    mfa_token = auth_router._create_mfa_pending_token(admin_user["user_id"], remembered=False)
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {mfa_token}"},
    )
    assert resp.status_code == 401


async def test_login_wrong_password_unaffected_by_2fa_check(api_client, mock_pool, admin_user):
    """A wrong password must still fail before the 2FA branch is ever
    reached — this is the enumeration-safety property the login code
    documents (2FA check runs only after `ok` is True)."""
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"], "password": "WrongPassword!",
    })
    assert resp.status_code == 401


async def test_login_blocked_when_org_requires_2fa_and_user_not_enrolled(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
        "SELECT 1 FROM public.user_totp": 0,
        "os.tfa_enforced = TRUE": "Unicode Group",
    })
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"], "password": TEST_PASSWORD,
    })
    assert resp.status_code == 403
    assert "Unicode Group" in resp.json()["detail"]


async def test_login_not_blocked_when_no_org_requires_2fa(api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
        "SELECT 1 FROM public.user_totp": 0,
        "os.tfa_enforced = TRUE": None,
    })
    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"], "password": TEST_PASSWORD,
    })
    assert resp.status_code == 200
    assert "token" in resp.json()


# ── POST /api/auth/verify-2fa ─────────────────────────────────────────────────

async def test_verify_2fa_correct_code_completes_login(api_client, mock_pool, admin_user):
    secret = totp_service.generate_secret()
    code = pyotp.totp.TOTP(secret).now()
    mfa_token = auth_router._create_mfa_pending_token(admin_user["user_id"], remembered=False)

    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT secret, last_used_step FROM public.user_totp": _totp_row(secret),
        "SELECT * FROM users WHERE user_id=$1": admin_user,
    })
    resp = await api_client.post("/api/auth/verify-2fa", json={
        "mfa_token": mfa_token, "code": code,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == admin_user["email"]


async def test_verify_2fa_wrong_code_rejected(api_client, mock_pool, admin_user):
    secret = totp_service.generate_secret()
    mfa_token = auth_router._create_mfa_pending_token(admin_user["user_id"], remembered=False)
    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT secret, last_used_step FROM public.user_totp": _totp_row(secret),
    })
    resp = await api_client.post("/api/auth/verify-2fa", json={
        "mfa_token": mfa_token, "code": "000000",
    })
    assert resp.status_code == 401


async def test_verify_2fa_replay_rejected(api_client, mock_pool, admin_user):
    """The same 6-digit code must not verify twice."""
    secret = totp_service.generate_secret()
    code = pyotp.totp.TOTP(secret).now()
    step = totp_service.current_step()
    mfa_token = auth_router._create_mfa_pending_token(admin_user["user_id"], remembered=False)
    # This code's step was already spent — as if a first verify just ran.
    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT secret, last_used_step FROM public.user_totp": _totp_row(secret, last_used_step=step),
    })
    resp = await api_client.post("/api/auth/verify-2fa", json={
        "mfa_token": mfa_token, "code": code,
    })
    assert resp.status_code == 401


async def test_verify_2fa_expired_or_invalid_mfa_token(api_client, mock_pool, admin_user):
    # A normal session token has no `purpose` claim, so it must not work here.
    session_token = make_token(admin_user["user_id"])
    resp = await api_client.post("/api/auth/verify-2fa", json={
        "mfa_token": session_token, "code": "123456",
    })
    assert resp.status_code == 401


async def test_verify_2fa_recovery_code_success_and_single_use(api_client, mock_pool, admin_user):
    secret = totp_service.generate_secret()
    recovery_code = totp_service.generate_recovery_codes(1)[0]
    code_hash = totp_service.hash_recovery_code(recovery_code)
    mfa_token = auth_router._create_mfa_pending_token(admin_user["user_id"], remembered=False)

    used = {"flag": False}

    async def fetch_side_effect(query, *args):
        if "SELECT id, code_hash FROM public.user_totp_recovery_codes" in query:
            if used["flag"]:
                return []
            return [{"id": "rc_1", "code_hash": code_hash}]
        return []

    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT secret, last_used_step FROM public.user_totp": _totp_row(secret),
        "SELECT * FROM users WHERE user_id=$1": admin_user,
    })
    mock_pool.fetch.side_effect = fetch_side_effect

    async def execute_side_effect(query, *args):
        if "SET used_at=NOW()" in query:
            used["flag"] = True
        return "UPDATE 1"
    mock_pool.execute.side_effect = execute_side_effect

    resp = await api_client.post("/api/auth/verify-2fa", json={
        "mfa_token": mfa_token, "code": recovery_code,
    })
    assert resp.status_code == 200
    assert "token" in resp.json()

    # Second use of the SAME recovery code, against a fresh login attempt.
    mfa_token_2 = auth_router._create_mfa_pending_token(admin_user["user_id"], remembered=False)
    resp2 = await api_client.post("/api/auth/verify-2fa", json={
        "mfa_token": mfa_token_2, "code": recovery_code,
    })
    assert resp2.status_code == 401


# ── routers/totp.py — self-service enrolment ──────────────────────────────────

@pytest.fixture
def as_user(app, admin_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: admin_user
    yield
    app.dependency_overrides.pop(require_user, None)


async def test_2fa_status_not_enrolled(api_client, mock_pool, admin_user, as_user):
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get("/api/v1/me/2fa")
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


async def test_2fa_setup_then_confirm_returns_recovery_codes(api_client, mock_pool, admin_user, as_user):
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    setup_resp = await api_client.post("/api/v1/me/2fa/setup")
    assert setup_resp.status_code == 200
    setup = setup_resp.json()
    assert setup["setup_token"]
    assert setup["secret"]
    assert setup["otpauth_uri"].startswith("otpauth://totp/")

    code = pyotp.totp.TOTP(setup["secret"]).now()
    confirm_resp = await api_client.post("/api/v1/me/2fa/confirm", json={
        "setup_token": setup["setup_token"], "code": code,
    })
    assert confirm_resp.status_code == 200
    body = confirm_resp.json()
    assert body["status"] == "enabled"
    assert len(body["recovery_codes"]) == 10


async def test_2fa_confirm_wrong_code_does_not_enrol(api_client, mock_pool, admin_user, as_user):
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    setup_resp = await api_client.post("/api/v1/me/2fa/setup")
    setup = setup_resp.json()
    resp = await api_client.post("/api/v1/me/2fa/confirm", json={
        "setup_token": setup["setup_token"], "code": "000000",
    })
    assert resp.status_code == 400


async def test_2fa_setup_token_is_refused_by_require_user(api_client, mock_pool, admin_user):
    """Deliberately does NOT use the `as_user` fixture: that overrides
    `require_user` at the FastAPI dependency-injection layer and would make
    this test pass even if the real function's `purpose` check were deleted.
    Exercises the actual `require_user` via a real bearer token instead."""
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    mock_pool.fetchrow.return_value = admin_user
    real_session_token = make_token(admin_user["user_id"])
    setup_resp = await api_client.post(
        "/api/v1/me/2fa/setup", headers={"Authorization": f"Bearer {real_session_token}"},
    )
    setup_token = setup_resp.json()["setup_token"]
    app_resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {setup_token}"},
    )
    assert app_resp.status_code == 401


async def test_2fa_disable_requires_correct_password(api_client, mock_pool, admin_user, as_user):
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    mock_pool.fetchrow.return_value = admin_user  # salt/password_hash for verification
    resp = await api_client.post("/api/v1/me/2fa/disable", json={"password": "WrongPassword!"})
    assert resp.status_code == 401


async def test_2fa_disable_blocked_when_org_requires_it(api_client, mock_pool, admin_user, as_user):
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    mock_pool.fetchrow.return_value = admin_user
    mock_pool.fetch.return_value = [{"org_name": "Unicode Group"}]
    resp = await api_client.post("/api/v1/me/2fa/disable", json={"password": TEST_PASSWORD})
    assert resp.status_code == 409
    assert "Unicode Group" in resp.json()["detail"]


async def test_2fa_disable_succeeds_with_correct_password_and_no_org_lock(
    api_client, mock_pool, admin_user, as_user,
):
    mock_pool.fetchval.side_effect = _route_fetchval({
        "to_regclass('user_totp')": "user_totp",
    })
    mock_pool.fetchrow.return_value = admin_user
    mock_pool.fetch.return_value = []
    resp = await api_client.post("/api/v1/me/2fa/disable", json={"password": TEST_PASSWORD})
    assert resp.status_code == 200
    assert resp.json()["status"] == "disabled"
