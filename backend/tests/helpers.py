"""Shared test helpers — imported by conftest.py and individual test modules."""

import hashlib
import os
from datetime import datetime, timezone

import jwt

JWT_SECRET = os.environ.get("JWT_SECRET", "test-secret-minimum-32-chars-long-xxxx")
JWT_ALGO = "HS256"

# Computed once per test session — PBKDF2 at 260k iterations takes ~1 s
TEST_PASSWORD = "TestPass123!"
TEST_SALT = "tst_salt_deadbeef01234"
TEST_PASS_HASH = hashlib.pbkdf2_hmac(
    "sha256", TEST_PASSWORD.encode(), TEST_SALT.encode(), 260_000
).hex()


def make_token(user_id: str) -> str:
    from datetime import timedelta
    return jwt.encode(
        {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=1)},
        JWT_SECRET,
        algorithm=JWT_ALGO,
    )


def make_task_row(**overrides) -> dict:
    """Minimal valid dict that row_to_task() accepts without raising."""
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
        # ── DECODED, because that is what the driver actually hands back ──────
        #
        # These three are `jsonb`, and `db.py` registers codecs, so a pooled
        # connection returns a Python `list`/`dict` — NOT a string. This fixture
        # used to say `"[]"` and `"{}"`, which meant every test built on it
        # exercised the `isinstance(raw, str)` branch of `_pj` and NONE of them
        # exercised the branch the product actually takes.
        #
        # Measured 2026-08-27: of 485 live `tasks` rows, **431 hold `subtasks`
        # as a jsonb array and 54 as a jsonb string**. So the fixture was
        # modelling the 11% and calling it the default.
        #
        # The string shape is still REAL and still reached — those 54 rows, plus
        # any connection whose codec handshake PgBouncer killed (`_init_conn`
        # warns and hands the connection out anyway). It is covered explicitly by
        # `test_task_row_shapes.py` rather than by being everybody's default.
        "attachments": [],
        "custom_fields": {},
        "subtasks": [],
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
