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
os.environ.setdefault("JWT_SECRET", "test-secret-minimum-32-chars-long-xxxx")
os.environ.setdefault("REPORT_DISPATCH_SECRET", "test-dispatch-secret-min-32-xxxx")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")

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
    conn_mock.execute = AsyncMock()
    conn_mock.fetch = AsyncMock(return_value=[])
    conn_mock.transaction = MagicMock(return_value=conn_mock)
    pool.acquire = MagicMock(return_value=conn_mock)
    return pool


def make_task_row(**overrides) -> dict:
    """Minimal valid dict that row_to_task() accepts."""
    now = datetime.now(timezone.utc)
    base = {
        "task_id": "task_test001",
        "user_id": "user_admin001",
        "team_id": "team_001",
        "column_id": "col_001",
        "created_by_user_id": "user_admin001",
        "assigned_by_user_id": None,
        "completed_by_user_id": None,
        "title": "Test Task",
        "description": None,
        "status": "todo",
        "priority": "medium",
        "category_id": None,
        "tags": [],
        "assignee_user_ids": [],
        "assignee_emails": [],
        "assignee_names": [],
        "due_at": None,
        "reminder_at": None,
        "reminder_sent_at": None,
        "recurrence_rule": "none",
        "recurrence_interval": 1,
        "estimated_minutes": None,
        "attachments": "[]",
        "custom_fields": "{}",
        "subtasks": "[]",
        "sort_order": 0,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
        "approval_status": None,
        "approval_notes": None,
        "approved_by": None,
        "approval_requested_at": None,
        "approval_decided_at": None,
        "requires_approval": False,
        "created_by_name": "Test Admin",
        "archived_at": None,
        "column_name": None,
        "column_color": None,
    }
    base.update(overrides)
    return base


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
    Also patches the user_roles query so require_platform_role passes."""
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: admin_user

    original_fetchval = mock_pool.fetchval
    _orig_side = original_fetchval.side_effect

    async def _fetchval_with_platform_role(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return "platform_admin"
        if _orig_side:
            return await _orig_side(query, *args)
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
