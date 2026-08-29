"""
`PATCH /api/v1/tasks/bulk` and the task state machine.

WHY THIS FILE EXISTS
────────────────────
The bulk route was the fifth of six writers of `tasks.status` and the only one a
user could reach from a menu that shipped. `services/task_transitions.py` named
it as unguarded in its own docblock; `test_task_transitions.py` carried a
PASSING test asserting it stayed that way. Measured against the real routes
before the fix, as a non-approver on a project with `requires_approval=TRUE`:

    PUT   /api/tasks/task_test001  {"status":"done"}          → 403
    PATCH /api/v1/tasks/bulk       {"status":"done"}          → 200, row written
    PATCH /api/v1/tasks/bulk       {"status":"requested"}     → 200, row written
    PATCH /api/v1/tasks/bulk       {"column_id":"col_done"}   → 200, status='done'

Every refusal in this file failed before `assert_transition` was wired into
`routers/tasks_bulk.py`, and every acceptance passed before it. That pair is the
argument that a guard was added and nothing working was broken — the same
ordering `test_task_transitions.py` documents for the four single-task routes.

THE SHAPE OF A REFUSAL IS NOT A 4xx
───────────────────────────────────
This route answers 200 for a partially-applied batch: a savepoint rollback on
one id is not a failure of the other thirty-nine. So a refused id shows up as
`results[i].ok == false` with the status and the sentence the singular route
would have returned, and `updated` does not count it. A test that asserted
`resp.status_code == 403` here would be asserting the wrong contract and would
go green if the route started refusing whole batches.
"""

import re

import pytest

from conftest import TEST_ORG_ID
from helpers import make_task_row
from services import task_transitions as tt


@pytest.fixture(autouse=True)
def _clean_schema_cache():
    """`_HAS_POLICY_COLUMN` is cached per process; no test may inherit another's."""
    tt.reset_schema_cache()
    yield
    tt.reset_schema_cache()


def _wire(mock_pool, task_row, *, is_done_column=False):
    """Answer the queries one bulk PATCH makes, on the pool AND the connection.

    The route acquires a connection and works inside a transaction, so the
    per-id reads land on `conn`, not on the pool — wiring only `mock_pool` here
    produces a batch that reports every id as "Task not found" and looks exactly
    like a working guard.
    """
    async def pool_fetch(query, *args):
        if "FROM teams" in query or "team_id" in query:
            return [{"team_id": "team_001"}]
        return []

    async def pool_fetchrow(query, *args):
        # `get_org_id` falls back to user_roles when no X-Org-Id is sent; without
        # these two the route 403s on org membership and every assertion below
        # would be measuring the resolver instead of the state machine.
        if "FROM public.user_roles" in query:
            return {"org_id": TEST_ORG_ID}
        if "FROM public.organisations" in query:
            return {"id": TEST_ORG_ID}
        if "requires_approval FROM teams" in query:
            return {"requires_approval": False}
        return None

    mock_pool.fetch.side_effect = pool_fetch
    mock_pool.fetchrow.side_effect = pool_fetchrow

    conn = mock_pool.acquire.return_value

    async def conn_fetchrow(query, *args):
        if query.lstrip().startswith("UPDATE tasks"):
            # The status the row ends in — read out of the SET clause by
            # placeholder rather than guessed by position. `_build_update` puts
            # `status` first when the caller sent one and APPENDS it last when a
            # done-column forced it, so "args[0]" would be right in one case and
            # silently return a column id in the other.
            placeholder = re.search(r"status=\$(\d+)", query)
            status = args[int(placeholder.group(1)) - 1] if placeholder else task_row["status"]
            return {
                "task_id": task_row["task_id"],
                "team_id": task_row["team_id"],
                "status": status,
                "assignee_user_ids": [],
            }
        if "FROM tasks WHERE task_id" in query:
            return task_row
        if "requires_approval FROM teams" in query:
            return {"requires_approval": False}
        return None

    async def conn_fetchval(query, *args):
        if "is_done FROM project_columns" in query:
            return is_done_column
        if "information_schema" in query:
            return None      # migration 117 unapplied — the gate is off
        return None

    conn.fetchrow.side_effect = conn_fetchrow
    conn.fetchval.side_effect = conn_fetchval
    return conn


def _gated(monkeypatch, *, approver: bool):
    """Arm the approval gate for every project, with the caller as/not as approver."""
    async def _policy(pool, team_id):
        return True

    async def _approver(pool, team_id, user):
        return approver

    monkeypatch.setattr(tt, "project_requires_approval", _policy)
    monkeypatch.setattr(tt, "is_task_approver", _approver)


def _patch(api_client, patch, ids=("task_test001",)):
    return api_client.patch("/api/v1/tasks/bulk",
                            json={"task_ids": list(ids), "patch": patch})


def _only(resp):
    body = resp.json()
    assert body["results"], body
    return body["results"][0]


# ── The legal half. These passed BEFORE the guard. ───────────────────────────

class TestTheBarStillWorks:

    @pytest.mark.parametrize("status", ["todo", "in_progress", "in_review", "done"])
    async def test_every_pipeline_status_is_still_settable(
            self, api_client, mock_pool, as_admin, status):
        _wire(mock_pool, make_task_row(status="todo"))
        resp = await _patch(api_client, {"status": status})
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 1, resp.text

    async def test_a_patch_that_does_not_touch_status_is_untouched(
            self, api_client, mock_pool, as_admin):
        _wire(mock_pool, make_task_row(status="requested"))
        # Even on a row whose status may not be changed: the guard is on the
        # STATUS write, not on the row. Re-tagging a client request is fine.
        resp = await _patch(api_client, {"priority": "high"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 1, resp.text

    async def test_moving_into_a_done_column_still_completes(
            self, api_client, mock_pool, as_admin):
        _wire(mock_pool, make_task_row(status="in_review"), is_done_column=True)
        resp = await _patch(api_client, {"column_id": "col_009"})
        assert resp.status_code == 200, resp.text
        assert _only(resp)["status"] == "done"

    async def test_an_approver_may_bulk_complete_on_a_gated_project(
            self, api_client, mock_pool, as_admin, monkeypatch):
        _gated(monkeypatch, approver=True)
        _wire(mock_pool, make_task_row(status="in_review"))
        resp = await _patch(api_client, {"status": "done"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 1, resp.text

    async def test_a_gated_project_still_lets_anyone_work_below_done(
            self, api_client, mock_pool, as_member, monkeypatch):
        _gated(monkeypatch, approver=False)
        _wire(mock_pool, make_task_row(status="todo"))
        resp = await _patch(api_client, {"status": "in_review"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 1, resp.text


# ── The refusal half. Every one of these returned 200 + a write before. ──────

class TestTheHoleIsClosed:

    @pytest.mark.parametrize("bad", ["rejected", "archived", "Done", ""])
    async def test_an_unknown_status_is_refused(
            self, api_client, mock_pool, as_admin, bad):
        """`rejected` is the one BulkBar actually offered. It is not a task
        status — only `approval_status` is ever 'rejected' — and no code reads
        it, so a task set to it fell out of every board query's vocabulary."""
        _wire(mock_pool, make_task_row(status="todo"))
        resp = await _patch(api_client, {"status": bad})
        assert resp.status_code == 200, resp.text
        row = _only(resp)
        assert row["ok"] is False
        assert row["status"] == 400
        assert isinstance(row["error"], str) and row["error"]
        assert resp.json()["updated"] == 0

    async def test_a_task_cannot_be_bulk_set_to_requested(
            self, api_client, mock_pool, as_admin):
        """THE CORRUPTING ONE. `server.review_approval` declines a request with
        `DELETE FROM tasks WHERE task_id=$1 AND status='requested'`, so an
        ordinary task carrying that status is deleted by an approval decision
        that has nothing to do with it."""
        _wire(mock_pool, make_task_row(status="in_progress"))
        resp = await _patch(api_client, {"status": "requested"})
        row = _only(resp)
        assert row["ok"] is False
        assert row["error"] == tt.INTO_REQUESTED

    async def test_an_unapproved_client_request_cannot_be_dragged_onto_the_board(
            self, api_client, mock_pool, as_admin):
        _wire(mock_pool, make_task_row(status="requested"))
        resp = await _patch(api_client, {"status": "in_progress"})
        row = _only(resp)
        assert row["ok"] is False
        assert row["error"] == tt.OUT_OF_REQUESTED

    async def test_status_cannot_be_cleared(self, api_client, mock_pool, as_admin):
        """`{"status": null}` reached `_build_update` and wrote NULL — a value
        outside the vocabulary that the state machine reads as "not touching the
        status". The two disagreed; the request is refused with a sentence."""
        _wire(mock_pool, make_task_row(status="todo"))
        resp = await _patch(api_client, {"status": None})
        assert resp.status_code == 400
        assert isinstance(resp.json()["detail"], str)

    async def test_a_non_approver_cannot_bulk_complete_on_a_gated_project(
            self, api_client, mock_pool, as_member, monkeypatch):
        """The measured bypass: PUT said 403, this said 200 and wrote the row."""
        _gated(monkeypatch, approver=False)
        _wire(mock_pool, make_task_row(status="in_review"))
        resp = await _patch(api_client, {"status": "done"})
        assert resp.status_code == 200, resp.text
        row = _only(resp)
        assert row["ok"] is False
        assert row["status"] == 403
        assert row["error"] == tt.NEEDS_APPROVER
        assert resp.json()["updated"] == 0

    async def test_the_gate_catches_the_done_column_too(
            self, api_client, mock_pool, as_member, monkeypatch):
        """Setting `column_id` to a column flagged `is_done` forces
        `status='done'` a few lines below the guard. Gating only the submitted
        value would leave the drag-shaped half of the same move open — and the
        bar offers columns and statuses in ONE menu."""
        _gated(monkeypatch, approver=False)
        _wire(mock_pool, make_task_row(status="in_review"), is_done_column=True)
        resp = await _patch(api_client, {"column_id": "col_009"})
        row = _only(resp)
        assert row["ok"] is False
        assert row["status"] == 403
        assert row["error"] == tt.NEEDS_APPROVER

    async def test_a_non_done_column_is_not_gated(
            self, api_client, mock_pool, as_member, monkeypatch):
        """Narrowness check on the line above: only `is_done` columns imply the
        gated status, so moving to In progress on a gated project still works."""
        _gated(monkeypatch, approver=False)
        _wire(mock_pool, make_task_row(status="todo"), is_done_column=False)
        resp = await _patch(api_client, {"column_id": "col_002"})
        assert resp.json()["updated"] == 1, resp.text


class TestOneRefusalDoesNotPoisonTheBatch:

    async def test_a_refused_id_fails_alone(self, api_client, mock_pool, as_admin):
        """The savepoint model, applied to the new guard. Three ids, one patch
        the state machine refuses for all three — but the mechanism under test is
        that each id is reported individually rather than the batch 4xx-ing."""
        _wire(mock_pool, make_task_row(status="requested"))
        resp = await _patch(api_client, {"status": "done"},
                            ids=("task_a", "task_b", "task_c"))
        body = resp.json()
        assert resp.status_code == 200, resp.text
        assert body["requested"] == 3
        assert body["failed"] == 3
        assert [r["task_id"] for r in body["results"]] == ["task_a", "task_b", "task_c"]
        assert all(r["error"] == tt.OUT_OF_REQUESTED for r in body["results"])

    async def test_the_gate_is_read_once_per_project_not_once_per_id(
            self, api_client, mock_pool, as_admin, monkeypatch):
        """A selection is capped at 200 ids. Without the per-batch memo, moving a
        full board column to Done asks the same project the same two questions
        200 times inside one transaction."""
        calls = {"policy": 0, "approver": 0}

        async def _policy(pool, team_id):
            calls["policy"] += 1
            return True

        async def _approver(pool, team_id, user):
            calls["approver"] += 1
            return True

        monkeypatch.setattr(tt, "project_requires_approval", _policy)
        monkeypatch.setattr(tt, "is_task_approver", _approver)
        _wire(mock_pool, make_task_row(status="in_review"))

        resp = await _patch(api_client, {"status": "done"},
                            ids=tuple(f"task_{i:03d}" for i in range(25)))
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] == 25, resp.text
        assert calls == {"policy": 1, "approver": 1}, calls
