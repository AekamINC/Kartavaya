"""
Unit tests for task-related endpoints in server.py.

Coverage:
  GET  /api/tasks                        — list with team scoping
  GET  /api/tasks/{id}                   — single task, 404
  POST /api/tasks/{id}/comments          — add comment
  POST /api/tasks/{id}/subtasks          — add subtask, IDOR guard
  GET  /api/tasks/{id}/comments          — list comments
  DELETE /api/tasks/{id}/comments/{cid}  — own comment, other user blocked
  PATCH /api/tasks/{id}/toggle           — toggle done
  PATCH /api/tasks/{id}/archive          — archive task
"""

import json
from datetime import datetime, timezone

import pytest

from helpers import make_task_row

NOW = datetime.now(timezone.utc)

TASK_ROW = make_task_row()

COMMENT_ROW = {
    "comment_id": "cmt_001",
    "task_id": "task_test001",
    "user_id": "user_admin001",
    "user_name": "Test Admin",
    "body": "This is a comment",
    "created_at": NOW,
}


# ── GET /api/tasks ────────────────────────────────────────────────────────────

async def test_list_tasks_admin(api_client, mock_pool, as_admin):
    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}]
        # main tasks query
        return [TASK_ROW]

    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_list_tasks_with_status_filter(api_client, mock_pool, as_admin):
    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}]
        return [TASK_ROW]

    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/tasks?status=todo")
    assert resp.status_code == 200


async def test_list_tasks_with_pagination(api_client, mock_pool, as_admin):
    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}]
        return []

    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/tasks?limit=10&offset=0")
    assert resp.status_code == 200


async def test_list_tasks_member_only_sees_own_teams(api_client, mock_pool, as_member, member_user):
    call_count = 0

    async def fetch_side(query, *args):
        nonlocal call_count
        call_count += 1
        if "role FROM users" in query:
            return [{"role": "member"}]
        if "project_assignments" in query or "team_members" in query:
            return [{"team_id": "team_001"}]
        return []

    mock_pool.fetchrow.return_value = {"role": "member"}
    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200


# ── GET /api/tasks/{task_id} ──────────────────────────────────────────────────

async def test_get_task_by_id(api_client, mock_pool, as_admin):
    async def fetchrow_side(query, *args):
        if "FROM tasks" in query:
            return TASK_ROW
        return None

    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}]
        # reminders, comments, etc.
        return []

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.get("/api/tasks/task_test001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_id"] == "task_test001"


async def test_get_task_not_found(api_client, mock_pool, as_admin):
    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}]
        return []

    mock_pool.fetch.side_effect = fetch_side
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get("/api/tasks/task_missing")
    assert resp.status_code == 404


# ── POST /api/tasks/{task_id}/comments ───────────────────────────────────────

async def test_add_comment_success(api_client, mock_pool, as_admin):
    async def fetchrow_side(query, *args):
        if "INSERT INTO task_comments" in query:
            return COMMENT_ROW
        if "FROM tasks WHERE task_id" in query:
            return {
                "title": "Test Task",
                "team_id": "team_001",
                "created_by_user_id": "user_admin001",
                "assignee_user_ids": [],
            }
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = []  # task_clients
    mock_pool.execute.return_value = "INSERT 1"
    resp = await api_client.post(
        "/api/tasks/task_test001/comments",
        json={"body": "This is a comment"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["body"] == "This is a comment"
    assert "comment_id" in data


async def test_add_comment_empty_body_rejected(api_client, as_admin):
    resp = await api_client.post(
        "/api/tasks/task_test001/comments",
        json={"body": ""},
    )
    assert resp.status_code == 422


# ── GET /api/tasks/{task_id}/comments ────────────────────────────────────────

async def test_list_comments(api_client, mock_pool, as_admin):
    # THE TASK HAS TO EXIST NOW. This stubbed `fetch` alone and left `fetchrow`
    # answering None — a database in which `task_test001` is not there, while
    # asserting its comments. That passed only because `list_comments` looked
    # the task up for nothing: it had no tenancy gate at all, so a Unicode Group
    # administrator read Aekam Inc's threads by id (measured on staging
    # 2026-08-29; see `tests/test_task_comment_tenancy.py`). The gate resolves
    # the task first, so the fixture now describes one — created by this
    # caller, which is `get_task`'s first rung and the cheapest way in.
    async def fetchrow_side(query, *args):
        if "FROM tasks WHERE task_id" in query:
            return {
                "team_id": "team_001",
                "user_id": "user_admin001",
                "created_by_user_id": "user_admin001",
                "assignee_user_ids": [],
            }
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = [COMMENT_ROW]
    resp = await api_client.get("/api/tasks/task_test001/comments")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["body"] == "This is a comment"


# ── DELETE /api/tasks/{task_id}/comments/{comment_id} ────────────────────────

async def test_delete_own_comment(api_client, mock_pool, as_admin, admin_user):
    mock_pool.fetchrow.return_value = {
        "user_id": admin_user["user_id"],
    }
    resp = await api_client.delete("/api/tasks/task_test001/comments/cmt_001")
    assert resp.status_code == 200


async def test_delete_other_users_comment_blocked(api_client, mock_pool, as_member, member_user):
    mock_pool.fetchrow.return_value = {
        "user_id": "user_admin001",  # different from member
    }
    resp = await api_client.delete("/api/tasks/task_test001/comments/cmt_001")
    assert resp.status_code == 403


# ── POST /api/tasks/{task_id}/subtasks ───────────────────────────────────────

async def test_add_subtask_success(api_client, mock_pool, as_admin):
    """Adding a subtask should return the updated task."""
    updated_task = make_task_row(
        subtasks=json.dumps([
            {"subtask_id": "sub_001", "title": "Step 1", "is_done": False, "order": 0}
        ])
    )

    async def fetchrow_side(query, *args):
        # Dispatched on the QUERY, not on call ordering. It used to key the
        # first branch on `call_n == 1`, which silently assumed the handler
        # body issued the very first fetchrow of the request — no longer true
        # now that `active_org_id` resolves the caller's organisation as a
        # dependency, before any handler runs. A fixture that breaks when a
        # dependency is added is a fixture that will accuse the next change too.
        # `SET subtasks` is tested first because the update statement also
        # mentions `subtasks` and `team_id`, which is what the ordering guard
        # was standing in for.
        if "SET subtasks" in query:
            # _SQL_SET_SUBTASKS
            return updated_task
        if "subtasks" in query and "team_id" in query:
            # _SQL_GET_SUBTASKS
            return {"subtasks": "[]", "team_id": "team_001"}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = [{"team_id": "team_001"}]

    resp = await api_client.post(
        "/api/tasks/task_test001/subtasks",
        json={"title": "Step 1", "is_done": False},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["subtasks"]) == 1
    assert data["subtasks"][0]["title"] == "Step 1"


async def test_add_subtask_idor_task_not_in_team(api_client, mock_pool, as_member):
    """A task from a different team should return 404, not leak data."""
    async def fetchrow_side(query, *args):
        if "role FROM users" in query:
            return {"role": "member"}
        # subtask query — returns None since team_ids is empty / not matching
        return None

    async def fetch_side(query, *args):
        # project_assignments + team_members UNION → user has no teams
        return []

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side
    resp = await api_client.post(
        "/api/tasks/task_other_team/subtasks",
        json={"title": "Sneaky subtask"},
    )
    assert resp.status_code == 404


# ── PATCH /api/tasks/{task_id}/toggle ────────────────────────────────────────

async def test_toggle_task_done(api_client, mock_pool, as_admin):
    done_task = make_task_row(status="done", completed_at=NOW)

    async def fetchrow_side(query, *args):
        if "FROM tasks WHERE task_id" in query and "UPDATE" not in query:
            return TASK_ROW
        if "UPDATE tasks" in query:
            return done_task
        if "FROM project_assignments" in query or "FROM team_members" in query:
            return {"role": "admin"}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = [{"team_id": "team_001"}]
    resp = await api_client.patch("/api/tasks/task_test001/toggle")
    assert resp.status_code == 200


# ── PATCH /api/tasks/{task_id}/archive ───────────────────────────────────────

async def test_archive_task(api_client, mock_pool, as_admin):
    archived_task = make_task_row(archived_at=NOW)

    async def fetchrow_side(query, *args):
        if "SELECT * FROM tasks" in query or "FROM tasks WHERE task_id" in query:
            return TASK_ROW
        if "UPDATE tasks SET archived_at" in query:
            return archived_task
        return {"role": "admin"}

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = [{"team_id": "team_001"}]
    resp = await api_client.patch("/api/tasks/task_test001/archive")
    assert resp.status_code == 200
