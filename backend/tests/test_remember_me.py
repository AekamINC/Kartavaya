"""Remember me, and the revocation that makes a year-long token defensible.

Owner's decision, 2026-08-09: on mobile, "Remember me" should mean the app does
not sign you out. Unticked stays at the sliding seven days the web already has.
"""
import inspect
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

import auth_router as A


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        line for line in src.splitlines()
        if not line.strip().startswith("#")).split())


def _claims(token: str) -> dict:
    return jwt.decode(token, A.JWT_SECRET, algorithms=[A.JWT_ALGORITHM])


def test_the_default_is_unchanged():
    """The web does not send `remember`, and its session must not change."""
    assert A.LoginBody.model_fields["remember"].default is False
    c = _claims(A._create_token("user_x"))
    life = datetime.fromtimestamp(c["exp"], timezone.utc) - datetime.fromtimestamp(c["iat"], timezone.utc)
    assert life == timedelta(days=7)
    assert "rem" not in c


def test_remembered_is_a_year():
    c = _claims(A._create_token("user_x", remembered=True))
    life = datetime.fromtimestamp(c["exp"], timezone.utc) - datetime.fromtimestamp(c["iat"], timezone.utc)
    assert life == timedelta(days=A.JWT_REMEMBERED_DAYS)


def test_a_remembered_token_says_so_in_a_claim():
    """Without it, `refresh` cannot tell the two apart and would demote the
    session to seven days on the next app open — invisible for a week."""
    assert _claims(A._create_token("user_x", remembered=True))["rem"] is True


def test_refresh_carries_the_claim_forward():
    code = _code(A.refresh)
    assert '_auth_claims' in code and '"rem"' in code
    assert "remembered=remembered" in code


def test_require_user_stores_the_claims_for_it():
    assert "request.state._auth_claims = claims" in _code(A.require_user)


def test_login_passes_the_flag_through():
    """`login()` no longer calls `_create_token` directly — two-factor
    authentication (workstream L) inserted a branch between "password
    correct" and "session minted", so the token-creation tail moved into
    `_finish_login`, shared with `verify_2fa()`. The flag must still survive
    the whole trip: `login` passes `body.remember` into `_finish_login` (both
    on the plain path and packed into the interim 2FA-pending token), and
    `_finish_login` is what actually calls `_create_token`."""
    login_code = _code(A.login)
    assert "_finish_login(pool, request, user, body.remember)" in login_code
    assert "_create_mfa_pending_token(user[\"user_id\"], body.remember)" in login_code
    assert "remembered=remember" in _code(A._finish_login)


# ── revocation: the reason a year-long token is defensible ──────────────────

def test_sign_out_everywhere_stamps_the_cutoff():
    code = _code(A.sign_out_everywhere)
    assert "sessions_valid_from=$2" in code


def test_it_signs_out_the_caller_too():
    """A "sign out everywhere" that spares the device it was pressed on is not
    what it says — and on a stolen phone the thief is the one pressing it."""
    code = _code(A.sign_out_everywhere)
    assert "delete_cookie" in code


def test_the_cutoff_is_nudged_past_the_current_second():
    """PyJWT writes `iat` as integer seconds TRUNCATED DOWN, so a token minted in
    the same second as the cutoff survives the revocation that was just asked
    for — long enough for a client that immediately retries."""
    code = _code(A.sign_out_everywhere)
    assert "timedelta(seconds=1)" in code


def test_it_refuses_loudly_where_revocation_is_not_available():
    """Answering 200 while revoking nothing is the worst possible outcome for
    this particular button."""
    code = _code(A.sign_out_everywhere)
    assert "revocation_active()" in code and "503" in code


def test_a_revoked_token_is_refused_even_though_it_has_not_expired():
    """The whole safety argument for a 365-day token."""
    issued = datetime.now(timezone.utc) - timedelta(days=1)
    token = A._create_token("user_x", iat=issued, remembered=True)
    claims = jwt.decode(token, A.JWT_SECRET, algorithms=[A.JWT_ALGORITHM])
    assert A._session_is_revoked(
        claims, {"sessions_valid_from": datetime.now(timezone.utc)}) is True
    assert A._session_is_revoked(
        claims, {"sessions_valid_from": issued - timedelta(days=1)}) is False


def test_the_rate_limit_is_on_it():
    """It writes a column that signs a person out of every device they own."""
    assert "5/minute" in inspect.getsource(A).split("async def sign_out_everywhere")[0][-400:]
