"""
test_2fa_is_actually_enforced.py — the 2FA gate FAILS OPEN, and this pins where.

WHY THIS FILE EXISTS
────────────────────────────────────────────────────────────────────────────────
`auth_router.login()` decides whether to demand a second factor by asking the
database a question about ITSELF:

    _totp_present = bool(await pool.fetchval("SELECT to_regclass('user_totp')"))

Everything two-factor hangs off that one boolean. If it is falsy:

  · the enrolment lookup never runs, so an ENROLLED user is treated as not
    enrolled and is handed a full session instead of an MFA challenge;
  · the `tfa_enforced` lookup never runs, so an org that has switched the
    control ON does not get its 403;
  · `_finish_login` mints a real session JWT and sets the session cookie;
  · the ONLY audit record written is `auth.login` — byte-identical to an
    ordinary, untroubled sign-in. Nothing logs that 2FA was skipped.

`to_regclass` resolves against `search_path`, so this is not a hypothetical.
The `staging` → `public` consolidation moves the table this probe names, and a
probe that stops resolving turns the whole control off SILENTLY. Its sibling
`routers/org_security.py::_totp_store()` has the same shape (`TOTP_TABLES` fed
to `SELECT to_regclass($1)`) and the same failure mode.

WHY THIS FILE DOES NOT USE THE SHARED MOCK POOL
────────────────────────────────────────────────────────────────────────────────
`tests/conftest.py::make_pool()` hands every test a `MagicMock` whose `fetchval`
answers `0` to every query ever asked. `0` is falsy, so under that mock the 2FA
block is ALWAYS skipped and a naive test of this route passes whether the code
is right or wrong — the mock, not the code, decides the outcome.

So this file overrides the `mock_pool` fixture with `RecordingPool`, which

  · answers PER QUERY, from state the test set deliberately,
  · RECORDS every statement so a test can assert which gates the code actually
    reached, and
  · RAISES on a query it was not told how to answer, so a code path that starts
    asking something new fails loudly instead of silently getting `0`.

WHY THE QUERY ROUTING NEVER MATCHES A SCHEMA NAME
────────────────────────────────────────────────────────────────────────────────
MEASURED ON THIS BRANCH, 2026-08-29, mid-consolidation:
`tests/test_ganit_separated_duty.py` routed its fake answers with
`if "staging.user_roles" in query` while `middleware/module_levels.py` had
already moved to `public.user_roles`. Those branches stopped matching, the stub
fell through to `return 0` for every role probe, and the run was:

    FAILED test_before_migration_org_owner_may_still_cancel   (expected 200, got 403)

— while `test_platform_admin_cannot_approve_without_an_explicit_grant` stayed
GREEN for a reason that was no longer the reason it claimed: the platform probe
was answering 0 for everybody, so its 403 proved nothing about platform staff.
A security test that keeps passing after its stub goes blind is the worst
outcome of the two.

Those stubs have since been repaired — by re-pinning them to `public.`, which
re-arms exactly the same trap for the next move.

A test harness must not be pinned to the identifier a migration moves. Every
predicate below keys on something no schema change touches — `to_regclass`,
`tfa_enforced`, `org_id IS NULL` — and `RecordingPool` RAISES on an unmatched
query, so going blind is a failure here rather than a silent `0`.

NO DATABASE. `ci.yml` runs the backend suite with DATABASE_URL deliberately
absent; nothing here opens a socket, and there is no module- or fixture-scope
`except Exception: pytest.skip(...)` for this file to go dark behind.
"""

import pytest

import auth_router
from auth_router import _decode_claims
from helpers import TEST_PASSWORD, TEST_PASS_HASH, TEST_SALT

# `pytest.ini` sets `asyncio_mode = auto`, so a bare `async def test_` runs.

USER_ID = "user_totp_enrolled_001"
EMAIL = "finance@example.com"
ENFORCING_ORG = "Unicode Traders Pvt Ltd"


def _user_row() -> dict:
    """A real-shaped `users` row whose password is the suite's TEST_PASSWORD.

    The salt and hash are the shared ones so the login path runs the GENUINE
    PBKDF2 verification — the 2FA block is only reached after the password has
    actually been proven, and a test that faked that would be testing a branch
    the product does not have.
    """
    return {
        "user_id": USER_ID,
        "email": EMAIL,
        "name": "Finance Lead",
        "role": "member",
        "avatar": None,
        "salt": TEST_SALT,
        "password_hash": TEST_PASS_HASH,
    }


class UnmodelledQuery(AssertionError):
    """Raised when the code asks something this test did not describe.

    This is the whole point of the class. A MagicMock would answer `0` and the
    test would pass over a code path nobody has thought about.
    """


class RecordingPool:
    """A pool that answers per query and remembers what it was asked."""

    def __init__(self):
        #: Does `SELECT to_regclass('user_totp')` resolve? The single boolean
        #: the entire 2FA block hangs off.
        self.totp_table_resolves = True
        #: Is this user enrolled in TOTP, as a fact about the WORLD — not about
        #: whether the code manages to look.
        self.enrolled = False
        #: Name of an org of this user's that has `tfa_enforced = TRUE`, or None.
        self.tfa_enforcing_org = None
        self.user_row = _user_row()
        #: Every (normalised_query, args) pair, in order.
        self.seen: list[tuple[str, tuple]] = []

    # ── recording ────────────────────────────────────────────────────────────
    def _record(self, query, args) -> str:
        q = " ".join(str(query).split())
        self.seen.append((q, args))
        return q

    def asked(self, fragment: str) -> int:
        """How many statements contained `fragment`."""
        return sum(1 for q, _ in self.seen if fragment in q)

    # ── answers ──────────────────────────────────────────────────────────────
    async def fetchval(self, query, *args):
        q = self._record(query, args)
        if "to_regclass" in q and "user_totp" in q:
            # asyncpg returns the regclass name (or None); the caller bools it.
            return "user_totp" if self.totp_table_resolves else None
        if "user_totp" in q:
            return 1 if self.enrolled else None
        if "tfa_enforced" in q:
            return self.tfa_enforcing_org
        raise UnmodelledQuery(
            f"login() issued a fetchval this test does not model: {q!r}. "
            "Describe it in RecordingPool rather than letting it answer 0."
        )

    async def fetchrow(self, query, *args):
        q = self._record(query, args)
        if "FROM users WHERE email" in q:
            return self.user_row
        raise UnmodelledQuery(
            f"login() issued a fetchrow this test does not model: {q!r}"
        )

    async def fetch(self, query, *args):
        q = self._record(query, args)
        if "user_roles" in q:
            # No platform rows and no org rows: this account's ONLY interesting
            # property is its second factor, so nothing else can explain the
            # outcome of a test in this file.
            return []
        raise UnmodelledQuery(
            f"login() issued a fetch this test does not model: {q!r}"
        )

    async def execute(self, query, *args):  # pragma: no cover — nothing writes here
        self._record(query, args)
        return "OK"


@pytest.fixture
def mock_pool():
    """Override conftest's MagicMock pool for every test in this file.

    `conftest.inject_pool` is autouse and takes `mock_pool`, so redefining the
    fixture here puts RecordingPool behind `db.get_pool()` for this module only.
    """
    return RecordingPool()


@pytest.fixture
def audit_log(monkeypatch):
    """Capture what the login path writes to the audit trail.

    `auth_router.audit` is looked up as a module global at call time, so
    replacing the attribute intercepts every emit. It also stops
    `services.audit.emit` scheduling a real background write against the fake
    pool, which would otherwise raise UnmodelledQuery from a detached task.
    """
    entries: list[tuple[str, dict]] = []

    def _capture(action, request=None, **kw):
        entries.append((action, kw))

    monkeypatch.setattr(auth_router, "audit", _capture)
    return entries


@pytest.fixture(autouse=True)
def no_pulse(monkeypatch):
    """Silence the fire-and-forget login pulse.

    `_spawn_login_pulse` looks `record_login_pulse` up at call time precisely so
    tests can do this (its docstring says so). Left alone it would issue an
    unmodelled INSERT from a task the response does not await.
    """
    async def _noop(*a, **kw):
        return None

    monkeypatch.setattr(auth_router, "record_login_pulse", _noop)


async def _login(api_client, remember: bool = False):
    return await api_client.post(
        "/api/auth/login",
        json={"email": EMAIL, "password": TEST_PASSWORD, "remember": remember},
    )


# ══════════════════════════════════════════════════════════════════════════════
# 1 — an enrolled user must be CHALLENGED, never handed a session
# ══════════════════════════════════════════════════════════════════════════════

async def test_an_enrolled_user_gets_an_mfa_challenge_not_a_session(
    api_client, mock_pool, audit_log,
):
    mock_pool.totp_table_resolves = True
    mock_pool.enrolled = True

    resp = await _login(api_client)
    body = resp.json()

    assert resp.status_code == 200, resp.text
    assert body.get("mfa_required") is True, (
        "An account with TOTP enrolled completed sign-in in ONE step. "
        f"Response body: {body!r}"
    )
    assert "token" not in body, (
        "The login response carried a session token to an account that still "
        "owes a second factor. That token is a full session — the challenge is "
        "decoration."
    )

    claims = _decode_claims(body["mfa_token"])
    assert claims is not None, "The mfa_token is not a token this service signed."
    assert claims.get("purpose") == "2fa_pending", (
        "The interim token is missing purpose='2fa_pending'. `require_user` "
        "refuses a token ONLY on that claim, so without it this is an ordinary "
        f"session that skipped 2FA. Claims: {claims!r}"
    )

    assert "session_token" not in resp.headers.get("set-cookie", ""), (
        "The session cookie was set before the second factor was supplied."
    )

    # The decision must have been REACHED, not defaulted into. If the code never
    # asked the enrolment question, a passing assertion above proves nothing.
    assert mock_pool.asked("user_totp") >= 2, (
        "login() never looked up this user's TOTP enrolment. Statements it did "
        f"issue: {[q for q, _ in mock_pool.seen]!r}"
    )

    actions = [a for a, _ in audit_log]
    assert actions == ["auth.login_password_ok_2fa_pending"], (
        f"Expected exactly the 2FA-pending audit record, got {actions!r}"
    )
    assert "auth.login" not in actions, (
        "A login SUCCESS was audited for a sign-in that has not finished."
    )


# ══════════════════════════════════════════════════════════════════════════════
# 2 — an org with tfa_enforced must refuse an account with no second factor
# ══════════════════════════════════════════════════════════════════════════════

async def test_an_org_enforcing_2fa_refuses_an_account_without_it(
    api_client, mock_pool, audit_log,
):
    mock_pool.totp_table_resolves = True
    mock_pool.enrolled = False
    mock_pool.tfa_enforcing_org = ENFORCING_ORG

    resp = await _login(api_client)
    body = resp.json()

    assert resp.status_code == 403, (
        "An org with tfa_enforced = TRUE admitted a member who has no second "
        f"factor. Status {resp.status_code}, body {body!r}"
    )
    assert ENFORCING_ORG in body["detail"], (
        "The refusal does not name the organisation that is enforcing, so the "
        f"user cannot tell who to ask. detail={body['detail']!r}"
    )
    assert "token" not in body and "mfa_token" not in body, (
        "A refused login still handed out a token."
    )
    assert "session_token" not in resp.headers.get("set-cookie", ""), (
        "A 403 still set the session cookie."
    )

    assert mock_pool.asked("tfa_enforced") == 1, (
        "login() never asked whether any of this user's orgs enforces 2FA."
    )

    actions = [a for a, _ in audit_log]
    assert actions == ["auth.login_blocked_2fa_required"], (
        f"Expected the blocked-for-2FA audit record, got {actions!r}"
    )


# ══════════════════════════════════════════════════════════════════════════════
# 3 — the CONTROL. Table resolves, nobody owes anything: an ordinary session.
#     Without this, the 200 in test 4 would be indistinguishable from "this
#     route returns 200 no matter what".
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_user_who_owes_no_second_factor_signs_in_normally(
    api_client, mock_pool, audit_log,
):
    mock_pool.totp_table_resolves = True
    mock_pool.enrolled = False
    mock_pool.tfa_enforcing_org = None

    resp = await _login(api_client)
    body = resp.json()

    assert resp.status_code == 200, resp.text
    assert "token" in body, f"An unencumbered login got no session: {body!r}"
    assert body.get("mfa_required") is not True
    assert _decode_claims(body["token"]).get("purpose") is None, (
        "A completed login must mint a full session, not an interim token."
    )
    assert [a for a, _ in audit_log] == ["auth.login"]

    # Both gates were consulted and both said "nothing owed".
    assert mock_pool.asked("user_totp") >= 2
    assert mock_pool.asked("tfa_enforced") == 1


# ══════════════════════════════════════════════════════════════════════════════
# 4 — THE FAIL-OPEN, ENCODED AS THE CURRENT BEHAVIOUR
#
#     ⚠ THIS TEST DOCUMENTS A DEFECT, IT DOES NOT ENDORSE ONE.
#
#     Everything below is what `auth_router.py` (the `_totp_present` probe just
#     above the `if enrolled:` branch) does TODAY when the probe cannot resolve
#     `user_totp` — for example because the table moved schema and `search_path`
#     no longer reaches it. The user IS enrolled and their org IS enforcing;
#     the code cannot see either, and signs them in.
#
#     WHEN SOMEONE FIXES THIS — by failing closed, or by resolving the table
#     from an explicit schema list the way `routers/org_security.py::TOTP_TABLES`
#     enumerates — THIS TEST WILL GO RED. That is intended. Delete it and keep
#     tests 1 and 2, which state the rule that should hold.
# ══════════════════════════════════════════════════════════════════════════════

async def test_when_the_totp_probe_cannot_resolve_2fa_is_skipped_entirely(
    api_client, mock_pool, audit_log,
):
    mock_pool.totp_table_resolves = False   # the probe is the only thing that changed
    mock_pool.enrolled = True               # …the user really is enrolled…
    mock_pool.tfa_enforcing_org = ENFORCING_ORG  # …and their org really enforces it.

    resp = await _login(api_client)
    body = resp.json()

    assert resp.status_code == 200, (
        "CURRENT BEHAVIOUR CHANGED. The 2FA fail-open documented in this test "
        f"no longer issues a session (status {resp.status_code}). If you have "
        "fixed the probe, delete this test — tests 1 and 2 already state the "
        "rule that should hold."
    )
    assert "token" in body, (
        "CURRENT BEHAVIOUR CHANGED — see the message above. Body: %r" % (body,)
    )
    assert body.get("mfa_required") is not True

    claims = _decode_claims(body["token"])
    assert claims.get("purpose") is None and claims.get("sub") == USER_ID, (
        "The fail-open issues a FULL SESSION JWT, not an interim token: this is "
        "the token `require_user` accepts everywhere in the product. "
        f"Claims: {claims!r}"
    )
    assert "session_token" in resp.headers.get("set-cookie", ""), (
        "The session cookie is set too — the fail-open is a complete sign-in."
    )

    # Both gates were skipped WITHOUT BEING ASKED. This is what makes the
    # failure silent: there is no query, so there is no error and no log line.
    assert mock_pool.asked("user_totp") == 1, (
        "Only the to_regclass probe should have run; the enrolment lookup is "
        f"inside the skipped branch. Statements: {[q for q, _ in mock_pool.seen]!r}"
    )
    assert mock_pool.asked("tfa_enforced") == 0, (
        "The tfa_enforced check is inside the same skipped branch."
    )

    actions = [a for a, _ in audit_log]
    assert actions == ["auth.login"], (
        "The audit trail of a bypassed second factor must be recorded as the "
        f"ordinary success it is indistinguishable from. Got {actions!r}"
    )


async def test_the_fail_open_is_indistinguishable_from_an_ordinary_login(
    api_client, mock_pool, audit_log,
):
    """The forensic half of the defect, stated on its own.

    An operator reading the audit trail after the probe stops resolving sees
    `auth.login` — the same action, with the same fields, as the untroubled
    sign-in in test 3. There is nothing in the record to review.
    """
    mock_pool.totp_table_resolves = False
    mock_pool.enrolled = True
    mock_pool.tfa_enforcing_org = ENFORCING_ORG
    await _login(api_client)
    bypassed = list(audit_log)

    audit_log.clear()
    mock_pool.seen.clear()
    mock_pool.totp_table_resolves = True
    mock_pool.enrolled = False
    mock_pool.tfa_enforcing_org = None
    await _login(api_client)
    ordinary = list(audit_log)

    assert bypassed == ordinary, (
        "CURRENT BEHAVIOUR CHANGED — the bypass is now distinguishable in the "
        f"audit trail. Bypassed: {bypassed!r}  Ordinary: {ordinary!r}. If you "
        "added a record for the skipped check, update this test to assert the "
        "new one instead."
    )
    assert [a for a, _ in bypassed] == ["auth.login"]


# ══════════════════════════════════════════════════════════════════════════════
# 5 — the probe is load-bearing, and that is the entire finding
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "probe_resolves, expected_mfa_required",
    [(True, True), (False, None)],
    ids=["probe-resolves", "probe-returns-null"],
)
async def test_one_boolean_decides_whether_2fa_exists_at_all(
    api_client, mock_pool, audit_log, probe_resolves, expected_mfa_required,
):
    """Identical account, identical request; only `to_regclass` differs.

    Enrolment, org enforcement and credentials are held constant across both
    parameters, so the outcome cannot be attributed to anything but the probe.
    """
    mock_pool.enrolled = True
    mock_pool.tfa_enforcing_org = ENFORCING_ORG
    mock_pool.totp_table_resolves = probe_resolves

    body = (await _login(api_client)).json()
    assert body.get("mfa_required") is expected_mfa_required, (
        "The second factor is decided by one to_regclass() call and nothing "
        f"else. probe={probe_resolves} produced {body!r}"
    )
