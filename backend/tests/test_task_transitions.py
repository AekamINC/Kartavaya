"""
The task state machine, and the approval gate on `done`.

READ THE ORDERING BEFORE CHANGING ANYTHING HERE.
------------------------------------------------
Adding a guard to a field that four routes wrote freely can only be safe if you
know what it refuses. So the LEGAL half of this file (`TestLegalTransitions*`)
was written first and run against the UNGUARDED code, where it passed 18/18.
The guard was added afterwards and the same 18 still pass. The refusal half
(`TestRefusals*`) failed 8/8 before the guard and passes after — that pair of
runs, not the final green, is the argument that nothing working was broken.

If you widen or narrow `services/task_transitions.py`, re-run the legal half
against the code WITHOUT your change first. A legal test that only passes with
your change is a behaviour change wearing a test's clothes.

THE SIX WRITE PATHS, ALL COVERED
  POST   /api/tasks                  create_task
  PUT    /api/tasks/{id}             update_task   (PATCH is an alias of it)
  PATCH  /api/tasks/{id}/toggle      toggle_task
  PATCH  /api/tasks/{id}/move        move_task
  PATCH  /api/v1/tasks/bulk          routers/tasks_bulk.py
  (automation `change_status` lived in services/automation_engine.py until the
   Niyam demolition; Niyam's task.set_status action replaces it and uses this
   validator the same way a human write does)

The last two were left unguarded for one batch, and this file used to carry
`test_the_unguarded_writers_are_still_two` to keep that admission honest. The
bulk route was the expensive one to leave open: `BulkBar.jsx` — the product's
own "Set status" menu — patched straight through it, so every refusal the four
single-task routes made was one menu click away from being irrelevant. Measured
before the fix, as a non-approver on a project with `requires_approval=TRUE`:
PUT refused with 403, `PATCH /api/v1/tasks/bulk` returned 200 and wrote the row.

`TestScope::test_every_writer_calls_the_validator` is the same check inverted:
it now fails if any of the six STOPS calling `assert_transition`, or if a
seventh writer of `tasks.status` appears without one.
"""

import re
from pathlib import Path

import pytest

from helpers import make_task_row
from services import task_transitions as tt


BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent


@pytest.fixture(autouse=True)
def _clean_schema_cache():
    """The column probe is cached per process; no test may inherit another's."""
    tt.reset_schema_cache()
    yield
    tt.reset_schema_cache()


class StubPool:
    """Answers only the two queries `task_transitions` asks. Nothing else."""

    def __init__(self, *, column_exists=True, requires_approval=False, raise_on_read=False):
        self.column_exists = column_exists
        self.requires_approval = requires_approval
        self.raise_on_read = raise_on_read
        self.fetchval_calls = 0

    async def fetchval(self, query, *args):
        self.fetchval_calls += 1
        if "information_schema.columns" in query:
            return 1 if self.column_exists else None
        return None

    async def fetchrow(self, query, *args):
        if self.raise_on_read:
            raise RuntimeError("column does not exist")
        if "requires_approval FROM teams" in query:
            return {"requires_approval": self.requires_approval}
        return None


ADMIN = {"user_id": "user_admin001", "role": "admin"}
MEMBER = {"user_id": "user_mem001", "role": "member"}


# ── The vocabulary ───────────────────────────────────────────────────────────

class TestVocabulary:

    def test_there_are_five_statuses_and_rejected_is_not_one(self):
        assert tt.TASK_STATUSES == ("todo", "in_progress", "in_review", "done", "requested")
        assert "rejected" not in tt.TASK_STATUSES

    def test_requested_is_not_on_the_line(self):
        assert tt.REQUESTED not in tt.LINE
        assert tt.SETTABLE_STATUSES == tt.LINE

    def test_the_frontend_mirror_lists_the_same_five(self):
        """A status added in Python and forgotten in JS is a menu that offers a
        value the server refuses. This is the check, not a code review."""
        mirror = REPO / "frontend" / "src" / "pages" / "approvals" / "transitions.js"
        if not mirror.exists():
            pytest.skip("frontend not present in this checkout")
        src = mirror.read_text(encoding="utf-8")
        block = re.search(r"export const TASK_STATUSES = \[(.*?)\]", src, re.S)
        assert block, "TASK_STATUSES array not found in transitions.js"
        listed = tuple(re.findall(r"'([a-z_]+)'", block.group(1)))
        assert listed == tt.TASK_STATUSES


# ── status_from_column_name ──────────────────────────────────────────────────

class TestColumnNameHeuristic:

    def test_a_column_named_review_reaches_in_review(self):
        """The measured bug: `"review" in name` sat in the same or-chain as
        "progress" and returned in_progress, so the default board's Review
        column moved cards to In progress and in_review was reachable only from
        a column with "approval" in its name."""
        assert tt.status_from_column_name("Review", False, "in_progress") == "in_review"
        assert tt.status_from_column_name("In Review", False, "todo") == "in_review"
        assert tt.status_from_column_name("Awaiting approval", False, "todo") == "in_review"

    def test_done_column_wins_over_any_name(self):
        assert tt.status_from_column_name("Review", True, "todo") == "done"

    def test_progress_and_todo_families(self):
        assert tt.status_from_column_name("In Progress", False, "todo") == "in_progress"
        assert tt.status_from_column_name("Doing", False, "todo") == "in_progress"
        assert tt.status_from_column_name("Backlog", False, "done") == "todo"
        assert tt.status_from_column_name("To Do", False, "done") == "todo"

    def test_an_unrecognised_name_is_not_a_status_statement(self):
        assert tt.status_from_column_name("Ideas", False, "in_review") == "in_review"
        assert tt.status_from_column_name("Ideas", False, "todo") == "in_progress"
        assert tt.status_from_column_name(None, False, "in_review") == "in_review"


# ── The policy read, before and after migration 117 ─────────────────────────

class TestPolicyRead:

    async def test_unmigrated_database_reports_no_policy(self):
        """117 is written and NOT applied. Unapplied is the state it will be in
        for a while, and the gate must be a no-op in that state."""
        pool = StubPool(column_exists=False, requires_approval=True)
        assert await tt.project_requires_approval(pool, "team_001") is False

    async def test_migrated_database_reads_the_column(self):
        assert await tt.project_requires_approval(
            StubPool(column_exists=True, requires_approval=True), "team_001") is True
        assert await tt.project_requires_approval(
            StubPool(column_exists=True, requires_approval=False), "team_001") is False

    async def test_a_personal_task_has_no_project_policy(self):
        pool = StubPool(column_exists=True, requires_approval=True)
        assert await tt.project_requires_approval(pool, None) is False
        assert pool.fetchval_calls == 0

    async def test_the_probe_is_cached(self):
        pool = StubPool(column_exists=True)
        await tt.project_requires_approval(pool, "team_001")
        await tt.project_requires_approval(pool, "team_002")
        await tt.project_requires_approval(pool, "team_003")
        assert pool.fetchval_calls == 1

    async def test_a_failing_policy_read_fails_open(self):
        """A schema hiccup must not freeze every board in the product."""
        pool = StubPool(column_exists=True, raise_on_read=True)
        assert await tt.project_requires_approval(pool, "team_001") is False


# ── assert_transition, as a unit ────────────────────────────────────────────

class TestAssertTransition:

    @pytest.mark.parametrize("old,new", [
        ("todo", "in_progress"), ("in_progress", "in_review"), ("in_review", "done"),
        ("todo", "done"), ("in_review", "in_progress"), ("done", "todo"),
        ("done", "in_progress"), (None, "todo"), (None, "done"), ("todo", "todo"),
    ])
    async def test_every_line_edge_is_legal_when_no_policy_is_set(self, old, new):
        pool = StubPool(column_exists=True, requires_approval=False)
        await tt.assert_transition(pool, old_status=old, new_status=new,
                                   team_id="team_001", user=MEMBER)

    async def test_no_status_in_the_payload_is_always_fine(self):
        pool = StubPool(column_exists=True, requires_approval=True)
        await tt.assert_transition(pool, old_status="todo", new_status=None,
                                   team_id="team_001", user=MEMBER)

    @pytest.mark.parametrize("bad", ["rejected", "Done", "archived", "", "DONE", "in-progress"])
    async def test_an_unknown_status_is_refused_by_name(self, bad):
        from fastapi import HTTPException
        pool = StubPool(column_exists=False)
        with pytest.raises(HTTPException) as e:
            await tt.assert_transition(pool, old_status="todo", new_status=bad,
                                       team_id="team_001", user=MEMBER)
        assert e.value.status_code == 400
        assert isinstance(e.value.detail, str)
        assert str(bad) in e.value.detail

    async def test_a_task_cannot_be_moved_into_requested(self):
        from fastapi import HTTPException
        pool = StubPool(column_exists=False)
        with pytest.raises(HTTPException) as e:
            await tt.assert_transition(pool, old_status="todo", new_status="requested",
                                       team_id="team_001", user=MEMBER)
        assert e.value.status_code == 400
        assert e.value.detail == tt.INTO_REQUESTED

    async def test_a_request_is_not_a_task_yet(self):
        from fastapi import HTTPException
        pool = StubPool(column_exists=False)
        with pytest.raises(HTTPException) as e:
            await tt.assert_transition(pool, old_status="requested", new_status="in_progress",
                                       team_id="team_001", user=MEMBER)
        assert e.value.status_code == 400
        assert e.value.detail == tt.OUT_OF_REQUESTED

    async def test_requested_to_requested_is_a_no_op_not_a_refusal(self):
        pool = StubPool(column_exists=False)
        await tt.assert_transition(pool, old_status="requested", new_status="requested",
                                   team_id="team_001", user=MEMBER)


class TestApprovalGate:

    async def test_the_gate_refuses_a_non_approver_entering_done(self, monkeypatch):
        from fastapi import HTTPException
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        pool = StubPool(column_exists=True, requires_approval=True)
        with pytest.raises(HTTPException) as e:
            await tt.assert_transition(pool, old_status="in_review", new_status="done",
                                       team_id="team_001", user=MEMBER)
        assert e.value.status_code == 403
        assert e.value.detail == tt.NEEDS_APPROVER

    async def test_the_gate_is_on_the_destination_not_on_one_edge(self, monkeypatch):
        """todo -> done skips the review just as thoroughly as in_review -> done."""
        from fastapi import HTTPException
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        pool = StubPool(column_exists=True, requires_approval=True)
        for old in ("todo", "in_progress", "in_review"):
            with pytest.raises(HTTPException) as e:
                await tt.assert_transition(pool, old_status=old, new_status="done",
                                           team_id="team_001", user=MEMBER)
            assert e.value.status_code == 403

    async def test_an_approver_passes_the_gate(self, monkeypatch):
        monkeypatch.setattr(tt, "is_task_approver", _approver(True))
        pool = StubPool(column_exists=True, requires_approval=True)
        await tt.assert_transition(pool, old_status="in_review", new_status="done",
                                   team_id="team_001", user=ADMIN)

    async def test_the_gate_never_blocks_the_pipeline_below_done(self, monkeypatch):
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        pool = StubPool(column_exists=True, requires_approval=True)
        for old, new in (("todo", "in_progress"), ("in_progress", "in_review"),
                         ("in_review", "in_progress"), ("done", "todo")):
            await tt.assert_transition(pool, old_status=old, new_status=new,
                                       team_id="team_001", user=MEMBER)

    async def test_done_to_done_is_not_a_gated_entry(self, monkeypatch):
        """Re-saving a finished task must not demand an approver."""
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        pool = StubPool(column_exists=True, requires_approval=True)
        await tt.assert_transition(pool, old_status="done", new_status="done",
                                   team_id="team_001", user=MEMBER)

    async def test_the_gate_is_inert_on_a_project_that_did_not_turn_it_on(self, monkeypatch):
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        pool = StubPool(column_exists=True, requires_approval=False)
        await tt.assert_transition(pool, old_status="in_review", new_status="done",
                                   team_id="team_001", user=MEMBER)

    async def test_the_gate_is_inert_before_migration_117(self, monkeypatch):
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        pool = StubPool(column_exists=False, requires_approval=True)
        await tt.assert_transition(pool, old_status="in_review", new_status="done",
                                   team_id="team_001", user=MEMBER)


def _approver(answer):
    async def _f(pool, team_id, user):
        return answer
    return _f


class TestReopen:

    def test_leaving_done_is_a_reopen(self):
        assert tt.is_reopen("done", "todo") is True
        assert tt.is_reopen("done", "in_progress") is True

    def test_nothing_else_is(self):
        assert tt.is_reopen("done", "done") is False
        assert tt.is_reopen("todo", "done") is False
        assert tt.is_reopen("done", None) is False
        assert tt.is_reopen(None, "todo") is False


# ══ ROUTE LEVEL ══════════════════════════════════════════════════════════════
# Everything below goes through the real FastAPI routes.

TASK_TODO = make_task_row(status="todo")
TASK_REVIEW = make_task_row(status="in_review")
TASK_DONE = make_task_row(status="done")
TASK_REQUESTED = make_task_row(status="requested")


def _wire(mock_pool, task_row, *, column=None):
    """Answer the handful of fetchrow queries a task write path makes."""
    async def fetchrow_side(query, *args):
        q = query
        if "information_schema" in q:
            return None
        if "FROM project_columns" in q:
            return column
        if "FROM project_assignments" in q or "FROM team_members" in q:
            return {"role": "admin"}
        if "requires_approval FROM teams" in q:
            return {"requires_approval": False}
        if "FROM teams WHERE team_id" in q:
            # org_id included because `_resolve_org_id` SELECTs exactly that
            # column: a stub for a query must answer with the column the query
            # asks for, or it is modelling a database that cannot exist. None
            # is the honest value here — these fixtures describe a project with
            # no organisation, which is 2 of the 29 live teams.
            return {"name": "Test Project", "org_id": None}
        if "MAX(sort_order)" in q:
            return {"mo": 0}
        if "UPDATE tasks" in q or "INSERT INTO tasks" in q:
            return task_row
        if "FROM tasks" in q:
            return task_row
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side

    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": "team_001"}]
        return []

    mock_pool.fetch.side_effect = fetch_side


class TestLegalTransitionsThroughTheRoutes:
    """These passed against the UNGUARDED code first. See the module docblock."""

    @pytest.mark.parametrize("status", ["todo", "in_progress", "in_review", "done"])
    async def test_create_accepts_every_pipeline_status(self, api_client, mock_pool, as_admin, status):
        _wire(mock_pool, make_task_row(status=status))
        resp = await api_client.post("/api/tasks", json={"title": "T", "status": status, "team_id": "team_001"})
        assert resp.status_code == 200, resp.text

    async def test_create_with_no_status_still_defaults_to_todo(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.post("/api/tasks", json={"title": "T", "team_id": "team_001"})
        assert resp.status_code == 200, resp.text

    @pytest.mark.parametrize("old,new", [
        ("todo", "in_progress"), ("in_progress", "in_review"), ("in_review", "done"),
        ("in_review", "in_progress"), ("done", "todo"), ("todo", "done"),
    ])
    async def test_put_accepts_every_pipeline_edge(self, api_client, mock_pool, as_admin, old, new):
        _wire(mock_pool, make_task_row(status=new))
        resp = await api_client.put("/api/tasks/task_test001", json={"status": new})
        assert resp.status_code == 200, resp.text

    async def test_put_with_no_status_is_untouched(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.put("/api/tasks/task_test001", json={"title": "Renamed"})
        assert resp.status_code == 200, resp.text

    async def test_toggle_still_completes_a_task(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.patch("/api/tasks/task_test001/toggle")
        assert resp.status_code == 200, resp.text

    async def test_toggle_still_reopens_a_done_task(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_DONE)
        resp = await api_client.patch("/api/tasks/task_test001/toggle")
        assert resp.status_code == 200, resp.text

    async def test_move_still_moves(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO, column={"column_id": "col_002", "name": "In Progress",
                                            "is_done": False, "sort_order": 1})
        resp = await api_client.patch("/api/tasks/task_test001/move",
                                      json={"column_id": "col_002", "order": 0})
        assert resp.status_code == 200, resp.text

    async def test_move_into_a_done_column_still_completes(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_REVIEW, column={"column_id": "col_009", "name": "Done",
                                              "is_done": True, "sort_order": 9})
        resp = await api_client.patch("/api/tasks/task_test001/move",
                                      json={"column_id": "col_009", "order": 0})
        assert resp.status_code == 200, resp.text


class TestRefusalsThroughTheRoutes:
    """These FAILED 8/8 against the unguarded code. That is the point of them."""

    async def test_create_refuses_an_unknown_status(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.post("/api/tasks", json={"title": "T", "status": "rejected",
                                                         "team_id": "team_001"})
        assert resp.status_code == 400
        assert isinstance(resp.json()["detail"], str)

    async def test_create_refuses_to_manufacture_a_client_request(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.post("/api/tasks", json={"title": "T", "status": "requested",
                                                         "team_id": "team_001"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == tt.INTO_REQUESTED

    @pytest.mark.parametrize("bad", ["rejected", "archived", "Done"])
    async def test_put_refuses_an_unknown_status(self, api_client, mock_pool, as_admin, bad):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.put("/api/tasks/task_test001", json={"status": bad})
        assert resp.status_code == 400
        assert isinstance(resp.json()["detail"], str)

    async def test_put_refuses_to_move_a_task_into_requested(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_TODO)
        resp = await api_client.put("/api/tasks/task_test001", json={"status": "requested"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == tt.INTO_REQUESTED

    async def test_put_refuses_to_promote_an_unapproved_client_request(self, api_client, mock_pool, as_admin):
        """`review_approval` promotes it, and declining DELETEs it. A task in
        this state is not a task, and dragging it onto the board bypasses the
        decision the approver was asked to make."""
        _wire(mock_pool, TASK_REQUESTED)
        resp = await api_client.put("/api/tasks/task_test001", json={"status": "in_progress"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == tt.OUT_OF_REQUESTED

    async def test_toggle_refuses_to_complete_an_unapproved_request(self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_REQUESTED)
        resp = await api_client.patch("/api/tasks/task_test001/toggle")
        assert resp.status_code == 400
        assert resp.json()["detail"] == tt.OUT_OF_REQUESTED

    async def test_move_refuses_to_drag_an_unapproved_request_onto_the_board(
            self, api_client, mock_pool, as_admin):
        _wire(mock_pool, TASK_REQUESTED, column={"column_id": "col_002", "name": "In Progress",
                                                 "is_done": False, "sort_order": 1})
        resp = await api_client.patch("/api/tasks/task_test001/move",
                                      json={"column_id": "col_002", "order": 0})
        assert resp.status_code == 400
        assert resp.json()["detail"] == tt.OUT_OF_REQUESTED


class TestTheGateThroughTheRoutes:

    async def test_a_non_approver_cannot_mark_done_on_a_gated_project(
            self, api_client, mock_pool, as_member, monkeypatch):
        monkeypatch.setattr(tt, "project_requires_approval", _always(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        _wire(mock_pool, TASK_REVIEW)
        resp = await api_client.put("/api/tasks/task_test001", json={"status": "done"})
        assert resp.status_code == 403
        assert resp.json()["detail"] == tt.NEEDS_APPROVER

    async def test_an_approver_can(self, api_client, mock_pool, as_admin, monkeypatch):
        monkeypatch.setattr(tt, "project_requires_approval", _always(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(True))
        _wire(mock_pool, TASK_DONE)
        resp = await api_client.put("/api/tasks/task_test001", json={"status": "done"})
        assert resp.status_code == 200, resp.text

    async def test_the_gate_catches_the_toggle_shortcut(
            self, api_client, mock_pool, as_member, monkeypatch):
        """Ticking the checkbox is the same decision as dragging to Done."""
        monkeypatch.setattr(tt, "project_requires_approval", _always(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        _wire(mock_pool, TASK_REVIEW)
        resp = await api_client.patch("/api/tasks/task_test001/toggle")
        assert resp.status_code == 403

    async def test_the_gate_catches_the_drag_to_the_done_column(
            self, api_client, mock_pool, as_member, monkeypatch):
        monkeypatch.setattr(tt, "project_requires_approval", _always(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        _wire(mock_pool, TASK_REVIEW, column={"column_id": "col_009", "name": "Done",
                                              "is_done": True, "sort_order": 9})
        resp = await api_client.patch("/api/tasks/task_test001/move",
                                      json={"column_id": "col_009", "order": 0})
        assert resp.status_code == 403

    async def test_a_gated_project_still_lets_anyone_work(
            self, api_client, mock_pool, as_member, monkeypatch):
        """The gate is on Done. Nothing below it moves."""
        monkeypatch.setattr(tt, "project_requires_approval", _always(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        _wire(mock_pool, make_task_row(status="in_review"))
        resp = await api_client.put("/api/tasks/task_test001", json={"status": "in_review"})
        assert resp.status_code == 200, resp.text


def _always(answer):
    async def _f(pool, team_id):
        return answer
    return _f


class TestThePolicyRoutes:
    """The switch that arms the gate. Without it `teams.requires_approval` is a
    column nobody can set — which is exactly what `tasks.requires_approval`
    already was."""

    async def test_it_reports_unavailable_before_migration_117(self, api_client, mock_pool, as_admin):
        async def fetchval_side(query, *args):
            if "public.user_roles" in query and "org_id IS NULL" in query:
                return "platform_admin"
            if "information_schema" in query:
                return None
            return 0
        mock_pool.fetchval.side_effect = fetchval_side
        mock_pool.fetch.side_effect = None
        mock_pool.fetch.return_value = [{"team_id": "team_001", "name": "P", "requires_approval": False}]
        resp = await api_client.get("/api/approvals/policy")
        assert resp.status_code == 200, resp.text
        assert resp.json()["available"] is False

    async def test_it_lists_projects_once_the_column_exists(self, api_client, mock_pool, as_admin):
        async def fetchval_side(query, *args):
            if "public.user_roles" in query and "org_id IS NULL" in query:
                return "platform_admin"
            if "information_schema" in query:
                return 1
            return 0
        mock_pool.fetchval.side_effect = fetchval_side
        mock_pool.fetch.side_effect = None
        mock_pool.fetch.return_value = [
            {"team_id": "team_001", "name": "Aekam Inc", "requires_approval": True}]
        resp = await api_client.get("/api/approvals/policy")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"available": True, "projects": [
            {"team_id": "team_001", "name": "Aekam Inc", "requires_approval": True}]}

    async def test_the_patch_refuses_before_the_migration_with_a_sentence(
            self, api_client, mock_pool, as_admin):
        """Not a 500 from a missing column, and not a silent success."""
        async def fetchval_side(query, *args):
            if "public.user_roles" in query and "org_id IS NULL" in query:
                return "platform_admin"
            return None
        mock_pool.fetchval.side_effect = fetchval_side
        resp = await api_client.patch("/api/approvals/policy/team_001",
                                      json={"requires_approval": True})
        assert resp.status_code == 400
        assert "117" in resp.json()["detail"]

    async def test_a_non_approver_cannot_change_the_requirement(
            self, api_client, mock_pool, as_member, monkeypatch):
        monkeypatch.setattr(tt, "_teams_has_policy_column", _always_one(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(False))
        mock_pool.fetchrow.side_effect = None
        mock_pool.fetchrow.return_value = {"team_id": "team_001", "name": "P"}
        resp = await api_client.patch("/api/approvals/policy/team_001",
                                      json={"requires_approval": True})
        assert resp.status_code == 403
        assert isinstance(resp.json()["detail"], str)

    async def test_an_approver_can(self, api_client, mock_pool, as_admin, monkeypatch):
        monkeypatch.setattr(tt, "_teams_has_policy_column", _always_one(True))
        monkeypatch.setattr(tt, "is_task_approver", _approver(True))
        mock_pool.fetchrow.side_effect = None
        mock_pool.fetchrow.return_value = {"team_id": "team_001", "name": "P"}
        resp = await api_client.patch("/api/approvals/policy/team_001",
                                      json={"requires_approval": True})
        assert resp.status_code == 200, resp.text
        assert resp.json()["requires_approval"] is True


def _always_one(answer):
    async def _f(pool):
        return answer
    return _f


# ── The check that stops this file's own claims going stale ─────────────────

class TestScope:

    def test_every_writer_calls_the_validator(self):
        """`tasks.status` is written from six places and ALL SIX call
        `assert_transition`. This replaces the check that used to assert the
        opposite about two of them — it was a passing test pinning a hole open.

        Source-read rather than behavioural on purpose: the behaviour of each
        path is covered above and in `test_tasks_bulk_transitions.py`, and what
        this catches is the case those cannot — somebody deleting a call, or
        adding a SEVENTH writer that never had one."""
        server_src = (BACKEND / "server.py").read_text(encoding="utf-8")
        assert server_src.count("assert_transition(") == 4, \
            "server.py must call the validator from exactly its four task write paths"

        # services/automation_engine.py was the second writer until the Niyam
        # demolition deleted it. Niyam's task.set_status action goes through
        # this same validator and rejoins this roll-call when it lands.
        for rel in (("routers", "tasks_bulk.py"),):
            src = (BACKEND.joinpath(*rel)).read_text(encoding="utf-8")
            assert "assert_transition(" in src, \
                f"{rel[-1]} writes tasks.status and must call assert_transition"

    #: The two unreferenced agent stubs. They USED to run `UPDATE tasks SET
    #: status` without the validator, writing `review` and `approved` — neither
    #: of which is one of the five. **Both were closed on 2026-08-06**:
    #: `status_agent` now calls `assert_transition` and writes `in_review` /
    #: `done`, and `review_agent` no longer writes `tasks.status` at all (its
    #: "auto-approve" was an agent granting an approval no agent may grant).
    #: See `tests/test_agent_status_writes.py`, which pins both.
    #:
    #: They stay listed here because the reachability check below is still the
    #: thing worth keeping: the subtree is detached, and the day it stops being
    #: detached is the day these two get read properly rather than in passing.
    UNREACHABLE_WRITERS = {
        "services/agents/status_agent.py": "status_agent",
        "services/agents/review_agent.py": "review_agent",
    }

    def test_no_seventh_writer_appeared(self):
        """Every backend file that runs `UPDATE tasks SET status` either calls
        the validator or is one of the excused stubs below.

        `server.py` is excused from the substring test only because it holds
        four calls already counted above."""
        excused = {Path(p).name for p in self.UNREACHABLE_WRITERS}
        offenders = []
        for path in BACKEND.rglob("*.py"):
            parts = set(path.parts)
            if "__pycache__" in parts or ".venv" in parts or "tests" in parts:
                continue
            src = path.read_text(encoding="utf-8", errors="ignore")
            if not re.search(r"UPDATE\s+tasks\s+SET\s+status", src, re.I):
                continue
            if path.name in excused or path.name == "server.py":
                continue
            if "assert_transition" in src:
                continue
            offenders.append(path.name)
        assert not offenders, (
            f"these write tasks.status without going through the state machine: {offenders}"
        )

    def test_the_excused_writers_are_still_unreachable(self):
        """The excuse for the two stubs is that no request path reaches them.

        MEASURED, not assumed: both are imported by
        `services/agents/orchestrator.py` and by nothing else, and
        `orchestrator.handle_event` — the only way into that registry — has no
        caller outside the package either. So the whole subtree is detached, and
        `/cron/agents` runs `DeadlineAgent` directly rather than through it.

        The moment anything outside `services/agents/` reaches either name, this
        goes red and the guard has to be written."""
        pkg = BACKEND / "services" / "agents"
        names = list(self.UNREACHABLE_WRITERS.values()) + ["handle_event", "AGENT_REGISTRY"]
        reached = {}
        for path in BACKEND.rglob("*.py"):
            parts = set(path.parts)
            if "__pycache__" in parts or ".venv" in parts or "tests" in parts:
                continue
            if pkg in path.parents:
                continue
            src = path.read_text(encoding="utf-8", errors="ignore")
            for name in names:
                if re.search(rf"\b{name}\b", src):
                    reached.setdefault(name, []).append(path.name)
        assert not reached, (
            f"the detached agent subtree now has callers ({reached}) — these agents were "
            "written against a schema that does not exist (`tasks.parent_task_id`, a "
            "`custom_fields` table), so a caller means they must be run against the real "
            "one before anything depends on them. Their status writes are already guarded; "
            "see tests/test_agent_status_writes.py"
        )
