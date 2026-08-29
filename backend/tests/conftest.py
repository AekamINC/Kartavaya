"""
Shared fixtures for Kartavaya backend unit tests.

Strategy
--------
- db._pool is swapped for a MagicMock before every test (autouse).
  Because get_pool() short-circuits on `if _pool is not None`, every module
  that calls `await get_pool()` or `await get_db()` gets our mock — no
  monkeypatching of individual imports required.

- require_user / require_admin are injected via app.dependency_overrides,
  which FastAPI resolves at request time. Tests that need a specific role
  use the as_admin / as_member / as_client fixtures.

- The PBKDF2 hash for the shared test password is computed ONCE at import
  time so tests that exercise the real password-verification path don't
  incur 1 s per call.
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

# ── env vars before any app import ───────────────────────────────────────────
#
# SENTRY_DSN IS REMOVED, NOT DEFAULTED, AND IT MUST BE FIRST.
#
# `server.py` calls `sentry_sdk.init(...)` at import time whenever SENTRY_DSN is
# present. Locally it is absent and nothing happens — but the live-schema tests
# are run as `railway run -e staging -s Kartavya python -m pytest`, and
# `railway run` INJECTS THE REAL SERVICE ENVIRONMENT, DSN included. So every
# such run reported its failures into the production Sentry project as though
# users had hit them.
#
# That is not hypothetical: three PIN-boundary issues (`PYTHON-FASTAPI-13`,
# `-11`, `-12`) in the aekaminc org were raised by Phase 7.3's own tests on
# 2026-08-27, not by anybody using the product. Test runs in the error stream
# make real errors harder to see, which is the whole value of the error stream.
#
# `pop`, not `setdefault`: a fake DSN would still initialise the SDK and merely
# fail to deliver, and "the transport is failing" is a different and noisier
# state than "Sentry is off". Removed before the first app import, because the
# init happens at import time and a later fixture is already too late.
os.environ.pop("SENTRY_DSN", None)

os.environ.setdefault("JWT_SECRET", "test-secret-minimum-32-chars-long-xxxx")
os.environ.setdefault("REPORT_DISPATCH_SECRET", "test-dispatch-secret-min-32-xxxx")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")

# NOT setdefault, and not negotiable: the test suite must never be able to send.
# `outbound.MODE` is read ONCE at import time and defaults to "live", so without
# this line every sender's `suppressed()` gate returns False for the whole run.
# Nothing then stands between a test and a real Expo push, SES email or social
# post except whichever mock happens to return an empty list first — a mock that
# returns one plausible row turns a unit test into a real delivery. This must be
# set before `outbound` is imported, which is why it lives above the app imports.
os.environ["OUTBOUND_MODE"] = "dry"

# Add backend/ and backend/tests/ to sys.path so imports work
_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_TESTS = os.path.dirname(__file__)
for _p in (_BACKEND, _TESTS):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from helpers import TEST_PASSWORD, TEST_PASS_HASH, TEST_SALT, make_token, make_task_row  # noqa: E402


def make_pool() -> MagicMock:
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetch = AsyncMock(return_value=[])
    pool.execute = AsyncMock(return_value="UPDATE 1")
    pool.fetchval = AsyncMock(return_value=0)
    # Needed by normalize_orders which uses pool.acquire() as a context manager
    conn_mock = MagicMock()
    conn_mock.__aenter__ = AsyncMock(return_value=conn_mock)
    conn_mock.__aexit__ = AsyncMock(return_value=False)
    # `next_doc_number` (utils.py) takes a connection out of the pool and calls
    # fetchval on it to read the last document number. Without these two the
    # attribute resolves to a bare MagicMock, which is not awaitable, and every
    # test that creates an invoice, order or payslip dies with
    # "'MagicMock' object can't be awaited" — a harness gap that reads like a
    # product bug. fetchval returns None so numbering starts at 0001.
    conn_mock.fetchval = AsyncMock(return_value=None)
    # THE CONNECTION IS THE POOL'S CONNECTION, so it must answer the way the
    # test configured the pool. These three are the SAME AsyncMock objects, not
    # copies: a test that sets `mock_pool.fetchrow.side_effect` is describing
    # what the database returns, and it cannot know or care whether the code
    # under test read through the pool or through a connection it acquired.
    #
    # Niyam made this matter. Its writes run inside an explicit transaction —
    # `async with pool.acquire() as conn: async with conn.transaction():` — so
    # the business write moved from `pool.fetchrow` to `conn.fetchrow`, and
    # twenty-two tests began failing with 'NoneType is not subscriptable': the
    # separate mock answered None to a query the test had carefully stubbed.
    # That reads exactly like a product bug and is not one.
    #
    # ONLY `fetchrow` is shared. `fetch`, `execute` and `fetchval` stay
    # separate on purpose: `routers/tasks_bulk.py` holds a connection for a
    # whole batch and issues many statements through it, so sharing those
    # queues would let one caller consume another's `side_effect` sequence and
    # every bulk test would fail on an off-by-one nobody could read.
    # `next_doc_number` also needs conn.fetchval to answer None so document
    # numbering starts at 0001, while the pool's answers 0 for counts.
    # DELEGATES by default; a test may still override it.
    #
    # The connection out of a pool talks to the same database as the pool, so a
    # test that stubs `mock_pool.fetchrow` is describing what the database
    # returns and cannot be expected to know whether the code read through the
    # pool or through a connection it acquired. Niyam's writes run inside an
    # explicit transaction, so four task handlers moved from `pool.fetchrow` to
    # `conn.fetchrow` and twenty-two tests began failing on 'NoneType is not
    # subscriptable' — a harness gap that reads exactly like a product bug.
    #
    # Delegation rather than aliasing (`conn_mock.fetchrow = pool.fetchrow`),
    # because `routers/tasks_bulk.py` holds a connection for a whole batch and
    # its tests configure `conn.fetchrow.side_effect` SEPARATELY from the
    # pool's. Sharing one object let the second assignment silently replace the
    # first. Assigning a side_effect here replaces this delegate, so those
    # tests keep working unchanged and everything else inherits the pool.
    # `side_effect` beats `return_value` in unittest.mock, so a bare delegate
    # would SHADOW a test that says `conn.fetchrow.return_value = {...}` — which
    # several do. The sentinel makes the delegate yield to an explicit stub:
    # unset means "nobody configured me, ask the pool"; anything else is the
    # test's own answer and wins.
    _UNSET = object()

    async def _delegate_fetchrow(*a, **kw):
        rv = conn_mock.fetchrow.return_value
        if rv is not _UNSET:
            return rv
        return await pool.fetchrow(*a, **kw)

    conn_mock.fetchrow = AsyncMock(side_effect=_delegate_fetchrow, return_value=_UNSET)
    conn_mock.fetch = AsyncMock(return_value=[])
    conn_mock.execute = AsyncMock()
    conn_mock.transaction = MagicMock(return_value=conn_mock)
    pool.acquire = MagicMock(return_value=conn_mock)
    return pool


# ── user fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def admin_user():
    return {
        "user_id": "user_admin001",
        "email": "admin@test.com",
        "name": "Test Admin",
        "full_name": "Test Admin",
        "role": "admin",
        "avatar": None,
        "position": None,
        "company_name": None,
        "member_role": "manager",
        "receives_approval_emails": True,
        "password_hash": TEST_PASS_HASH,
        "salt": TEST_SALT,
    }


@pytest.fixture
def member_user():
    return {
        "user_id": "user_mem001",
        "email": "member@test.com",
        "name": "Test Member",
        "full_name": "Test Member",
        "role": "member",
        "avatar": None,
        "position": None,
        "company_name": None,
        "member_role": None,
        "receives_approval_emails": True,
        "password_hash": TEST_PASS_HASH,
        "salt": TEST_SALT,
    }


@pytest.fixture
def client_user():
    return {
        "user_id": "user_client001",
        "email": "client@test.com",
        "name": "Test Client",
        "full_name": "Test Client",
        "role": "client",
        "avatar": None,
        "position": None,
        "company_name": None,
        "member_role": None,
        "receives_approval_emails": False,
        "password_hash": TEST_PASS_HASH,
        "salt": TEST_SALT,
    }


@pytest.fixture
def admin_token(admin_user):
    return make_token(admin_user["user_id"])


@pytest.fixture
def member_token(member_user):
    return make_token(member_user["user_id"])


# ── DB pool ───────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_pool():
    return make_pool()


@pytest.fixture(autouse=True)
def inject_pool(mock_pool):
    """Swap db._pool for the mock before every test; restore after."""
    import db
    original = db._pool
    db._pool = mock_pool
    yield mock_pool
    db._pool = original


@pytest.fixture(autouse=True)
def reset_team_org_cache():
    """Clear `server._team_org_cache` before every test.

    It is a module-level dict that outlives any one test, and the team ids in
    this suite are shared fixtures — `team_001` appears in dozens of files with
    a different pool stub behind it each time. So the FIRST file to resolve it
    decided the answer for every later file in the same process, and the
    symptom landed somewhere else entirely: `test_attachment_privacy` failed
    because a task-transition test had already cached `team_001` as having no
    org, and `_refresh_task_attachments` returns the stale stored URL when the
    org is unknown. A test that passes alone and fails in the suite is this
    shape of bug until proven otherwise.

    The production half — never caching the negative — is fixed in
    `_resolve_org_id` itself. This clears the positive half too, because a test
    must not inherit another test's fixture data by way of a global.
    """
    import server
    server._team_org_cache.clear()
    yield
    server._team_org_cache.clear()


# ── Rate limiters ─────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Clear BOTH rate limiters before every test.

    There are two, they fail the same way, and they were found independently
    from opposite ends of the suite:

    1. `server._write_rate_buckets` — `global_write_rate_limit` counts
       POST/PUT/PATCH/DELETE per client IP in a module-level dict, 120 per
       wall-clock minute. Every test shares one IP under ASGITransport, so the
       whole suite drew on a single budget and adding tests anywhere pushed
       unrelated files over the edge.

    2. `limiter` (slowapi) — a module-level singleton keyed on remote address.
       `/api/auth/login` allows five a minute, so the sixth login ANYWHERE in
       the session got a 429. Adding auth tests to a second file was enough to
       start failing tests in the first.

    Both made a test's outcome depend on how many earlier tests happened to run,
    in what order, and how fast — and the 429 surfaces in whichever test ran
    last, which looks nothing like the assertion that fails. Cleared per test so
    a test's outcome depends only on that test, and a test that wants to prove a
    limiter works can spend its budget deliberately.
    """
    import server
    server._write_rate_buckets.clear()

    def _reset_slowapi():
        from limiter import limiter
        try:
            limiter.reset()
        except Exception:
            # Older slowapi storages have no reset(); clear the dict directly.
            storage = getattr(limiter, "_storage", None)
            if storage is not None and hasattr(storage, "storage"):
                storage.storage.clear()

    _reset_slowapi()
    yield
    server._write_rate_buckets.clear()


# ── FastAPI app + ASGI client ─────────────────────────────────────────────────

@pytest.fixture(scope="session")
def app():
    import server
    return server.app


@pytest.fixture
async def api_client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


# ── Role injection via dependency_overrides ───────────────────────────────────

@pytest.fixture
def as_admin(app, admin_user, mock_pool):
    """Override require_user so every request in this test runs as admin.
    Also patches the user_roles query so require_platform_role passes.

    AND an org row in the organisation under test. That second half is not
    padding: a platform row is no longer a membership
    (`middleware/roles.may_act_in_org`), so a fixture that grants only
    `org_id IS NULL` models an account belonging to NO organisation — which
    every org-scoped gate must now refuse, and did, turning five tests about
    GSTIN validation and merge scoping into 403s that had nothing to do with
    what they were testing.

    The real accounts this fixture stands for hold both: admin@aekaminc.com is
    platform_admin AND org_owner of Aekam Inc, bhoomi@ is platform_admin AND
    org_admin. A test that means "god mode from outside the org" must build its
    own pool and say so — `tests/test_roles_org_scope.py` does.

    `org_owner` rather than `org_admin` because this fixture is the STRONGEST
    caller the suite has, and the two differ: `ORG_OWNER_ONLY` gates (switching a
    module on, org security) and `org_invites._assert_may_grant_role` ("Only an
    organisation owner can invite another owner") both refuse an org_admin. A
    fixture that stops one rung short would make those routes untestable through
    it, which is how `test_org_owner_can_invite_an_owner` noticed.

    AND IT IS A FALLBACK, NOT AN OVERRIDE. This fixture is composed with a
    test's own `fetchval` routing and is instantiated AFTER it, so anything it
    answers outright it also takes away: `test_org_invites` sets
    `wired["caller_role"]` precisely to distinguish an org_admin from an
    org_owner, and an unconditional answer here silently replaced both. The org
    row is supplied only where the test said nothing.
    """
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: admin_user

    original_fetchval = mock_pool.fetchval
    _orig_side = original_fetchval.side_effect

    def _is_org_scoped_role_query(query: str) -> bool:
        return "public.user_roles" in query and "org_id=$2::uuid" in query

    async def _fetchval_with_platform_role(query, *args):
        if "public.user_roles" in query and "org_id IS NULL" in query:
            return "platform_admin"
        if _orig_side:
            answer = await _orig_side(query, *args)
            # 0 is `make_pool`'s "no opinion" default, not a role.
            if answer in (None, 0) and _is_org_scoped_role_query(query):
                return "org_owner"
            return answer
        if _is_org_scoped_role_query(query):
            return "org_owner"
        return 0

    mock_pool.fetchval.side_effect = _fetchval_with_platform_role
    yield
    mock_pool.fetchval.side_effect = _orig_side
    app.dependency_overrides.pop(require_user, None)


@pytest.fixture
def as_member(app, member_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield
    app.dependency_overrides.pop(require_user, None)


@pytest.fixture
def as_client_user(app, client_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: client_user
    yield
    app.dependency_overrides.pop(require_user, None)


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


TEST_ORG_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def with_org_id(app):
    """Override get_org_id to return a fixed org UUID for module tests."""
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: TEST_ORG_ID
    yield TEST_ORG_ID
    app.dependency_overrides.pop(get_org_id, None)
