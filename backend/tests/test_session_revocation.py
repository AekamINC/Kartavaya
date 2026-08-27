"""
Session revocation on password reset — backend/auth_router.py.

WHAT THIS FILE IS DEFENDING
───────────────────────────
The password-reset email has always said "Setting a new password signs out
every other device", and `AUTH-SPEC.md:134` requires that sentence of the
template. Until 2026-08-06 it was false: `reset_password` wrote the new hash
and revoked nothing, so a token stolen before the reset kept working for up to
seven days — surviving the password change that was made BECAUSE it was stolen.

It is now true, via `users.sessions_valid_from` (migration 118) plus a check in
`require_user` that costs zero extra queries.

Two failure modes are being locked down, and the SECOND ONE IS WORSE:

  1. The revocation stops working — the email goes back to lying.
  2. The revocation works too well and signs out the person who JUST reset
     their password. PyJWT writes `iat` as integer seconds TRUNCATED DOWN, so a
     cutoff of bare `NOW()` (microseconds) is ABOVE the `iat` of the
     replacement token minted milliseconds later, and every successful password
     reset ends in an immediate 401. `test_token_minted_by_reset_is_accepted`
     is the guard, and it is the most important test here.

These tests deliberately do NOT use the `as_admin` fixture. That fixture
overrides `require_user` with a stub, which is exactly the code under test.
They go through the real dependency with a real signed token.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import jwt
import pytest

import auth_router
from auth_router import JWT_ALGORITHM, JWT_SECRET, SESSION_REVOKED_DETAIL


# ── helpers ───────────────────────────────────────────────────────────────────

def _token(user_id: str, iat: datetime | None = None, omit_iat: bool = False) -> str:
    """Sign a token with an explicit issue time (or none at all)."""
    issued = iat or datetime.now(timezone.utc)
    claims: dict = {
        "sub": user_id,
        "exp": issued + timedelta(days=7),
    }
    if not omit_iat:
        claims["iat"] = issued
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def restore_revocation_flag():
    """`_revocation_column_present` is module-level and latches to False.

    A test that exercises the migration-not-applied path would otherwise
    silently disable revocation for every test that ran after it, in file
    order, and the suite would still be green.
    """
    original = auth_router._revocation_column_present
    yield
    auth_router._revocation_column_present = original


# ── the lockout guard — read this one first ──────────────────────────────────

async def _reset(api_client, mock_pool, admin_user):
    """Run a password reset. Returns (new_token, cutoff actually written)."""
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post("/api/auth/reset-password", json={
        "token": "valid-reset-token",
        "password": "BrandNewPass123!",
    })
    assert resp.status_code == 200
    written = [
        c[0] for c in mock_pool.execute.call_args_list
        if c[0] and "sessions_valid_from" in str(c[0][0])
    ]
    assert written, "reset_password did not write a revocation cutoff"
    return resp.json()["token"], written[-1][4]


async def test_the_token_a_reset_hands_back_is_accepted(api_client, mock_pool, admin_user):
    """THE LOCKOUT GUARD. The session a reset returns must survive its own cutoff.

    Get this wrong and every successful password reset ends in an immediate
    401 — the feature fails closed, on the person who used it correctly. Three
    things keep it right and this test exercises all three at once: the cutoff
    is truncated to whole seconds, `_session_is_revoked` floors both sides, and
    the replacement token is minted from the same instant as the cutoff.
    """
    new_token, cutoff = await _reset(api_client, mock_pool, admin_user)

    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": cutoff}
    me = await api_client.get("/api/auth/me", headers=_hdr(new_token))
    assert me.status_code == 200, (
        f"the token reset_password just returned was rejected: {me.json()}"
    )


async def test_the_cutoff_is_never_in_the_future(api_client, mock_pool, admin_user):
    """PyJWT REJECTS A FUTURE-DATED `iat` — `ImmatureSignatureError`.

    This is why the cutoff is `datetime.now()` in this process and NOT a
    database `NOW()`. A database clock even slightly ahead of the app would
    produce a replacement token that PyJWT refuses to decode at all — not
    merely revoked, undecodable, and the user is locked out until the app clock
    catches up. The first draft of this function took the cutoff from the
    database and this is the test that caught it.

    Anyone reintroducing a DB-side timestamp must make this pass first.
    """
    before = datetime.now(timezone.utc)
    new_token, cutoff = await _reset(api_client, mock_pool, admin_user)
    after = datetime.now(timezone.utc)

    assert cutoff <= after, "the revocation cutoff is in the future"
    assert cutoff >= before - timedelta(seconds=1)
    assert cutoff.microsecond == 0, "the cutoff must be truncated to whole seconds"

    # And the token must decode with iat validation ON, which is the default.
    claims = jwt.decode(new_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert claims["iat"] == int(cutoff.timestamp())


async def test_a_sub_second_cutoff_still_does_not_lock_anyone_out(
    api_client, mock_pool, admin_user,
):
    """Defence in depth: `_session_is_revoked` floors BOTH sides.

    If the truncation in `reset_password` is ever dropped, a cutoff carrying
    microseconds would sit above the `iat` of a token minted in the same
    instant — floor(iat) < cutoff — and revoke it. Flooring the cutoff in the
    comparison keeps the check correct in the units `iat` is actually written
    in, so that mistake cannot become a lockout.
    """
    now = datetime.now(timezone.utc)
    ragged = now.replace(microsecond=567891)
    token = _token(admin_user["user_id"], iat=now.replace(microsecond=0))
    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": ragged}

    resp = await api_client.get("/api/auth/me", headers=_hdr(token))
    assert resp.status_code == 200


async def test_reset_does_not_shorten_the_session_it_returns(
    api_client, mock_pool, admin_user,
):
    """The replacement token still gets a full TTL, measured from its own iat."""
    new_token, _ = await _reset(api_client, mock_pool, admin_user)
    claims = jwt.decode(new_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert claims["exp"] - claims["iat"] == 7 * 86400


# ── the revocation actually revokes ──────────────────────────────────────────

async def test_token_issued_before_cutoff_is_rejected(api_client, mock_pool, admin_user):
    cutoff = datetime.now(timezone.utc).replace(microsecond=0)
    stale = _token(admin_user["user_id"], iat=cutoff - timedelta(minutes=5))
    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": cutoff}

    resp = await api_client.get("/api/auth/me", headers=_hdr(stale))
    assert resp.status_code == 401
    # Its own detail string, not "Invalid or expired token": the clients must be
    # able to say WHY rather than implying the session merely lapsed.
    assert resp.json()["detail"] == SESSION_REVOKED_DETAIL


async def test_token_issued_after_cutoff_is_accepted(api_client, mock_pool, admin_user):
    cutoff = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=1)
    fresh = _token(admin_user["user_id"])
    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": cutoff}

    resp = await api_client.get("/api/auth/me", headers=_hdr(fresh))
    assert resp.status_code == 200


async def test_null_cutoff_signs_nobody_out(api_client, mock_pool, admin_user):
    """NULL = never revoked, which is every account the day 118 is applied.

    This is why the migration needs no grace window and applying it signs
    nobody out — the property PROPOSED_067's `jti` design could not offer.
    """
    old = _token(admin_user["user_id"], iat=datetime.now(timezone.utc) - timedelta(days=6))
    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": None}

    resp = await api_client.get("/api/auth/me", headers=_hdr(old))
    assert resp.status_code == 200


async def test_missing_iat_fails_closed(api_client, mock_pool, admin_user):
    """A revoked account plus a token with no `iat` must be refused.

    `_create_token` has always written `iat`, so such a token is not something
    this product issues. Treating "no issue time" as "issued recently" would be
    a revocation that a malformed token walks straight through.
    """
    cutoff = datetime.now(timezone.utc).replace(microsecond=0)
    weird = _token(admin_user["user_id"], omit_iat=True)
    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": cutoff}

    resp = await api_client.get("/api/auth/me", headers=_hdr(weird))
    assert resp.status_code == 401
    assert resp.json()["detail"] == SESSION_REVOKED_DETAIL


# ── the write ────────────────────────────────────────────────────────────────

async def test_the_cutoff_is_written_exactly_once(api_client, mock_pool, admin_user):
    """One UPDATE, not two.

    The migration-absent fallback below issues a second UPDATE without the
    column. If both paths ever ran, the password would be hashed and written
    twice — and PBKDF2 at 260k iterations costs about a second each time.
    """
    await _reset(api_client, mock_pool, admin_user)
    updates = [
        c for c in mock_pool.execute.call_args_list
        if c[0] and "password_hash" in str(c[0][0])
    ]
    assert len(updates) == 1, f"the password was written {len(updates)} times"


async def test_login_does_not_stamp_a_cutoff(api_client, mock_pool, admin_user):
    """Signing in must not sign your other devices out.

    Only `reset_password` may write the cutoff. If login stamped it, every
    sign-in would revoke every other sign-in — a plausible-looking mistake that
    no other test in this suite would catch.
    """
    from helpers import TEST_PASSWORD
    mock_pool.fetchrow.return_value = admin_user

    resp = await api_client.post("/api/auth/login", json={
        "email": admin_user["email"],
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 200

    written = " ".join(
        str(c[0][0])
        for c in list(mock_pool.execute.call_args_list) + list(mock_pool.fetchval.call_args_list)
        if c[0]
    )
    assert "sessions_valid_from" not in written


async def test_refresh_cannot_resurrect_a_revoked_session(
    api_client, mock_pool, admin_user,
):
    """`POST /api/auth/refresh` is the obvious escape hatch and must be shut.

    It mints a NEW token with a fresh `iat`. If it could be reached with a
    revoked one, anybody holding a stolen token could trade it for a clean one
    and the revocation would be worth nothing. It is safe because it depends on
    `require_user` — this pins that, so a future refactor that decodes the
    token itself, the way `/reports/dispatch` did, cannot reopen it silently.
    """
    cutoff = datetime.now(timezone.utc).replace(microsecond=0)
    stale = _token(admin_user["user_id"], iat=cutoff - timedelta(minutes=5))
    mock_pool.fetchrow.return_value = {**admin_user, "sessions_valid_from": cutoff}

    resp = await api_client.post("/api/auth/refresh", headers=_hdr(stale))
    assert resp.status_code == 401
    assert resp.json()["detail"] == SESSION_REVOKED_DETAIL


async def test_a_naive_cutoff_is_read_as_utc(admin_user):
    """A naive cutoff must not be interpreted in the server's local time zone.

    The column is TIMESTAMPTZ so asyncpg returns an aware datetime and this
    should never fire in production. It is pinned because the failure mode is
    silent and hours wide: local-time interpretation would revoke every recent
    token on a server west of UTC and nothing at all on one east of it.
    """
    from auth_router import _session_is_revoked

    now = datetime.now(timezone.utc).replace(microsecond=0)
    naive = now.replace(tzinfo=None)

    # Issued at the cutoff — not revoked, whatever the host's time zone is.
    assert _session_is_revoked(
        {"iat": int(now.timestamp())}, {"sessions_valid_from": naive},
    ) is False
    # Issued an hour before it — revoked.
    assert _session_is_revoked(
        {"iat": int(now.timestamp()) - 3600}, {"sessions_valid_from": naive},
    ) is True


# ── the bypass ───────────────────────────────────────────────────────────────

@pytest.fixture
def platform_staff(monkeypatch):
    """Make `is_platform_staff` say yes.

    WITHOUT THIS THE BYPASS TEST IS WORTHLESS and silently so: under the mock
    pool `is_platform_staff` returns False, so `/dispatch` answers 403 whether
    or not the revocation is checked, and the test passes against the very bug
    it exists to catch. Verified by injecting the bug — it went green.
    """
    import middleware.roles
    monkeypatch.setattr(
        middleware.roles, "is_platform_staff", AsyncMock(return_value=True),
    )


def test_the_one_authenticated_path_outside_require_user_is_gone():
    """`POST /api/reports/dispatch` WAS the single hole in session revocation.

    It was the one authenticated path in the product that did not run through
    `require_user`: it decoded the token itself for a platform-staff fallback,
    and a plain signature-and-expiry decode there would have accepted a token
    revoked by a password reset. That was closed by routing it through
    `resolve_token_user_id`, which reads the same cutoff `require_user` reads,
    and two tests here — a control and a revoked token — pinned it.

    The endpoint is DELETED. `public.report_schedules` was retired by the owner
    on 2026-08-27, so the fallback, its `REPORT_DISPATCH_SECRET` and the
    revocation hazard all went with it. The bypass is now closed by absence,
    which is stronger than closing it by correctness.

    THE OLD TESTS COULD NOT HAVE TOLD YOU THAT. The control asserted
    `status_code != 403` — a deleted route answers 404, so it kept passing
    against a route that no longer existed, describing a guarantee about
    nothing. This asserts the absence directly instead.

    If a second token-decoding path is ever added anywhere, it needs its own
    pair of tests like the ones this replaces; `require_user` is the only
    door that gets revocation for free.
    """
    from routers import reports

    assert not hasattr(reports, "dispatch_reports")
    # The import itself, not just the endpoint: `resolve_token_user_id` in a
    # router is the signature of a hand-rolled auth path.
    assert not hasattr(reports, "_auth_resolve"), (
        "routers/reports.py resolves tokens itself again — that is a second "
        "authentication path outside require_user and it needs its own "
        "revocation tests before it ships")
    paths = {r.path for r in reports.router.routes}
    assert "/api/reports/dispatch" not in paths


# ── code deployed ahead of the migration ─────────────────────────────────────

async def test_missing_column_degrades_instead_of_500(api_client, mock_pool, admin_user):
    """If 118 has not been applied, authentication must still work.

    Getting this wrong means deploying before applying the migration 500s every
    authenticated request in the product. Revocation being off is bad;
    a total authentication outage is worse.
    """
    class _UndefinedColumn(Exception):
        sqlstate = "42703"

    calls: list[str] = []

    async def _fetchrow(sql, *args):
        calls.append(sql)
        if "sessions_valid_from" in sql:
            raise _UndefinedColumn('column "sessions_valid_from" does not exist')
        return admin_user

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)

    resp = await api_client.get("/api/auth/me", headers=_hdr(_token(admin_user["user_id"])))
    assert resp.status_code == 200
    assert any("sessions_valid_from" in s for s in calls)
    assert any("sessions_valid_from" not in s for s in calls), "no fallback read was issued"
    assert auth_router.revocation_active() is False


async def test_a_real_db_error_is_not_swallowed(api_client, mock_pool, admin_user):
    """Only 42703 on our column may trigger the fallback.

    A blanket `except Exception` here would turn any transient database fault
    into "revocation quietly off, forever" — the flag latches for the life of
    the process.
    """
    class _Boom(Exception):
        sqlstate = "57014"  # query_canceled

    mock_pool.fetchrow = AsyncMock(side_effect=_Boom("statement timeout"))

    with pytest.raises(_Boom):
        await api_client.get("/api/auth/me", headers=_hdr(_token(admin_user["user_id"])))
    assert auth_router.revocation_active() is True


# ── the promise and the behaviour, tied together ─────────────────────────────

def test_the_email_promise_and_the_code_agree():
    """The sentence in the email and the code that honours it, in one test.

    Nothing asserted the sign-out sentence before — `test_email_plaintext.py`
    only exercises the preheader — so the email could have been changed to
    match a broken backend, or the backend gutted while the email kept
    promising. `AUTH-SPEC.md:134` requires the sentence, so if this fails the
    fix is to restore the REVOCATION, not to delete the sentence.
    """
    import inspect
    import email_service

    template = inspect.getsource(email_service.send_password_reset_email)
    assert "signs out every other device" in template

    reset = inspect.getsource(auth_router.reset_password)
    assert "sessions_valid_from" in reset, (
        "the reset email promises a sign-out that reset_password no longer performs"
    )


def test_me_sessions_does_not_claim_a_session_list():
    """Revocation is now supported; enumeration still is not.

    `GET /api/v1/me/sessions` reports them as two separate keys on purpose. The
    defect being closed was a screen asserting something untrue about sessions;
    letting a new capability imply a session list would only reverse its
    direction.
    """
    import inspect

    import routers.me as me_router

    src = inspect.getsource(me_router.list_sessions)
    assert '"other_sessions_known": False' in src
    assert "_revocation_active()" in src, (
        "revocation.supported is hard-coded; it must follow whether the column "
        "is actually present"
    )
