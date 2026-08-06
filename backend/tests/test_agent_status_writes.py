"""
The two agent-service writers of `tasks.status`, closed.

WHAT WAS ACTUALLY WRONG — MEASURED, 2026-08-06
──────────────────────────────────────────────
`status_agent` wrote `'review'` or `'done'`; `review_agent` wrote `'approved'`.
Neither `review` nor `approved` is one of the five statuses
(`services/task_transitions.TASK_STATUSES`), and neither agent called
`assert_transition`. That much was true as reported.

Three things the report did NOT say, all measured before anything was changed:

  1. LIVE DATA IS CLEAN. `SELECT status, count(*) FROM public.tasks GROUP BY 1`
     against the shared database returns exactly four values —
     done 319 · todo 193 · in_progress 67 · in_review 54 (633 rows). Zero
     `review`, zero `approved`, zero `requested`. **No repair migration was
     written, because there is nothing to repair.**

  2. THE AGENTS CANNOT REACH THE UPDATE. `public.tasks` has 40 columns and
     `parent_task_id` is not one of them — the name appears in exactly two
     files in the whole backend, and both were these agents. Subtasks are the
     JSONB `tasks.subtasks` array (`server.py:3718`). `review_agent` also
     joined a `custom_fields` TABLE, which does not exist either (it is a JSONB
     column on tasks; the definitions live in `field_definitions`, which has no
     `required` column). Every run would have raised UndefinedColumnError on
     its first query.

  3. NOTHING CALLS THEM. `orchestrator.handle_event` has no caller outside
     `services/agents/`; `test_task_transitions.py::TestScope` already pins
     that and stays the tripwire.

So this was never a live data-integrity bug. The fix is precautionary, and the
tests below are what makes it stay fixed: dead code that writes illegal values
is one import away from being live code that writes illegal values, and the
crash-first accident is not a guard.

WHAT THE FIX DECIDED
────────────────────
The third vocabulary is MAPPED onto the two columns that already exist, not
added to them:
    review → in_review · complete/closed → done · approved → approval_status
`review_agent`'s auto-approval is DELETED rather than translated: an agent has
no person behind it, `is_task_approver(user=None)` is False by design, and a
robot stamping `approval_status='approved'` with no `approved_by` is the
approval gate being walked around from the inside.
"""

import re
from pathlib import Path

import pytest

from services import task_transitions as tt
from services.task_transitions import TASK_STATUSES
from services.agents import status_agent as sa
from services.agents import review_agent as ra
from services.agents.status_agent import StatusAgent
from services.agents.review_agent import ReviewAgent


BACKEND = Path(__file__).resolve().parents[1]
AGENTS = BACKEND / "services" / "agents"


@pytest.fixture(autouse=True)
def _clean_schema_cache():
    """`_HAS_POLICY_COLUMN` is cached per process; no test may inherit another's."""
    tt.reset_schema_cache()
    yield
    tt.reset_schema_cache()


class RecordingPool:
    """A pool that answers only what these agents ask, and remembers every write.

    `policy_column` is the dormant/applied switch for migration 117: production
    is the FALSE side today, so both sides are exercised.
    """

    def __init__(self, task_row=None, *, policy_column=False, requires_approval=False):
        self.task_row = task_row
        self.policy_column = policy_column
        self.requires_approval = requires_approval
        self.executed = []          # (sql, args)
        self.time_logged = 0

    async def fetchrow(self, query, *args):
        if "requires_approval FROM teams" in query:
            return {"requires_approval": self.requires_approval}
        if "FROM tasks" in query:
            return self.task_row
        return None

    async def fetchval(self, query, *args):
        if "information_schema.columns" in query:
            return 1 if self.policy_column else None
        if "time_entries" in query:
            return self.time_logged
        return None

    async def fetch(self, query, *args):
        return []

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"

    # ── read helpers ────────────────────────────────────────────────────────
    @property
    def status_writes(self):
        """Every value this agent tried to put in `tasks.status`."""
        out = []
        for sql, args in self.executed:
            if re.search(r"UPDATE\s+tasks\s+SET\s+status", sql, re.I):
                out.append(args[0])
        return out

    @property
    def comments(self):
        return [args for sql, args in self.executed if "task_comments" in sql]


def task_row(status="todo", *, ticked=1, total=1, approval_status=None,
             team_id="team_001", omit_approval_column=False):
    subtasks = [
        {"subtask_id": f"sub_{i}", "title": f"s{i}", "is_done": i < ticked, "order": i}
        for i in range(total)
    ]
    row = {"status": status, "team_id": team_id, "subtasks": subtasks}
    if not omit_approval_column:
        row["approval_status"] = approval_status
    return row


# ── status_agent: what it writes ─────────────────────────────────────────────

class TestStatusAgentWritesOnlyTheFive:

    async def test_a_finished_checklist_reaches_in_review_not_review(self):
        """`review` was the old value. `in_review` is the real one."""
        pool = RecordingPool(task_row("todo", ticked=3, total=3))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["in_review"]
        assert result["to"] == "in_review"

    async def test_done_is_reached_only_when_a_person_already_approved(self):
        """`approved` is not a status — it is `tasks.approval_status`, and the
        old code's second tier ("all approved → done") is preserved by reading
        that column rather than by inventing a sixth state."""
        pool = RecordingPool(task_row("in_review", ticked=2, total=2,
                                      approval_status="approved"))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["done"]
        assert result["to"] == "done"

    async def test_an_unapproved_task_stops_at_in_review(self):
        pool = RecordingPool(task_row("in_progress", ticked=2, total=2,
                                      approval_status="pending"))
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["in_review"]

    @pytest.mark.parametrize("start,approval", [
        ("todo", None), ("todo", "approved"),
        ("in_progress", None), ("in_progress", "approved"),
        ("in_review", None), ("in_review", "approved"),
        ("done", None), ("done", "approved"),
    ])
    async def test_every_value_it_can_ever_write_is_one_of_the_five(self, start, approval):
        """The check that would have caught this class of bug the first time."""
        pool = RecordingPool(task_row(start, ticked=2, total=2, approval_status=approval))
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        for written in pool.status_writes:
            assert written in TASK_STATUSES, f"{written!r} is not a task status"

    async def test_an_unticked_subtask_writes_nothing(self):
        pool = RecordingPool(task_row("todo", ticked=1, total=3))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["action"] == "none"

    async def test_a_finished_task_is_never_dragged_backwards(self):
        """Editing a checklist on a done task must not reopen it."""
        pool = RecordingPool(task_row("done", ticked=2, total=2))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["action"] == "none"

    async def test_no_subtasks_means_no_opinion(self):
        pool = RecordingPool(task_row("todo", ticked=0, total=0))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["skipped"] is True


# ── status_agent: the validator is not optional ──────────────────────────────

class TestTheWriteGoesThroughTheValidator:

    async def test_assert_transition_is_called_before_every_write(self, monkeypatch):
        seen = []

        async def spy(pool, **kw):
            seen.append(kw)

        monkeypatch.setattr(sa, "assert_transition", spy)
        pool = RecordingPool(task_row("todo", ticked=1, total=1))
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert len(seen) == 1
        assert seen[0]["new_status"] == "in_review"
        assert seen[0]["old_status"] == "todo"
        assert seen[0]["user"] is None, "an agent has no person behind it"
        assert pool.status_writes == ["in_review"]

    async def test_a_refusal_stops_the_write(self, monkeypatch):
        """If the validator says no, no row is touched — and the reason is
        returned rather than raised, because `BaseAgent.execute` would bury it
        as an unexplained agent error."""
        from fastapi import HTTPException

        async def refuse(pool, **kw):
            raise HTTPException(400, "nope")

        monkeypatch.setattr(sa, "assert_transition", refuse)
        pool = RecordingPool(task_row("todo", ticked=1, total=1))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["action"] == "refused"
        assert result["reason"] == "nope"

    async def test_the_approval_gate_refuses_the_agent(self):
        """Migration 117 APPLIED, project policy on: an agent is not an approver,
        so `done` is refused and nothing is written. Not monkeypatched — this is
        the real `assert_transition`."""
        pool = RecordingPool(
            task_row("in_review", ticked=1, total=1, approval_status="approved"),
            policy_column=True, requires_approval=True,
        )
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["action"] == "refused"
        assert result["reason"] == tt.NEEDS_APPROVER

    async def test_the_same_task_passes_when_the_project_has_no_policy(self):
        pool = RecordingPool(
            task_row("in_review", ticked=1, total=1, approval_status="approved"),
            policy_column=True, requires_approval=False,
        )
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["done"]

    async def test_a_task_request_is_refused_not_advanced(self):
        """`requested` is not on the line. Its only exits are Approvals."""
        pool = RecordingPool(task_row("requested", ticked=1, total=1))
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["action"] == "refused"
        assert result["reason"] == tt.OUT_OF_REQUESTED


# ── The dormant side of the schema, which is production's actual state ───────

class TestUnmigratedDatabase:

    async def test_policy_column_absent_means_the_gate_is_simply_off(self):
        """Migration 117 is written, not applied. On that side the gate is
        skipped and the legal write still happens."""
        pool = RecordingPool(
            task_row("in_review", ticked=1, total=1, approval_status="approved"),
            policy_column=False, requires_approval=True,
        )
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["done"]

    async def test_approval_status_column_absent_degrades_to_in_review(self):
        """A missing column must read as "not approved", never as a 500."""
        pool = RecordingPool(task_row("todo", ticked=1, total=1,
                                      omit_approval_column=True))
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["in_review"]

    async def test_subtasks_arriving_as_a_json_string_still_parse(self):
        """asyncpg hands JSONB back decoded or raw depending on the codec."""
        row = task_row("todo", ticked=2, total=2)
        import json as _json
        row["subtasks"] = _json.dumps(row["subtasks"])
        pool = RecordingPool(row)
        await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.status_writes == ["in_review"]

    async def test_unparseable_subtasks_are_no_opinion_not_a_crash(self):
        row = task_row("todo", ticked=1, total=1)
        row["subtasks"] = "{not json"
        pool = RecordingPool(row)
        result = await StatusAgent().run(pool, "org_1", {"task_id": "task_1"})
        assert pool.executed == []
        assert result["skipped"] is True


# ── review_agent: it reports, it does not decide ─────────────────────────────

class TestReviewAgentApprovesNothing:

    async def test_a_clean_task_gets_a_comment_and_nothing_else(self):
        """This is the line that used to read `SET status = 'approved'`."""
        pool = RecordingPool(task_row("done", ticked=2, total=2))
        pool.time_logged = 30
        result = await ReviewAgent().run(pool, "org_1", {"task_id": "task_1", "to": "done"})
        assert pool.status_writes == []
        assert not any("approval_status" in sql for sql, _ in pool.executed), \
            "an agent has no approved_by — it must never stamp an approval"
        assert len(pool.comments) == 1
        assert result["complete"] is True

    async def test_gaps_are_reported_in_one_comment(self):
        pool = RecordingPool(task_row("done", ticked=1, total=3))
        pool.time_logged = 0
        result = await ReviewAgent().run(pool, "org_1", {"task_id": "task_1", "to": "done"})
        assert result["complete"] is False
        assert "2 subtask(s) still open" in result["gaps"]
        assert "No time logged" in result["gaps"]
        assert pool.status_writes == []

    async def test_it_ignores_everything_that_is_not_a_done_transition(self):
        pool = RecordingPool(task_row("in_progress"))
        result = await ReviewAgent().run(pool, "org_1", {"task_id": "task_1", "to": "in_review"})
        assert pool.executed == []
        assert result["skipped"] is True

    async def test_a_missing_task_writes_nothing(self):
        pool = RecordingPool(None)
        result = await ReviewAgent().run(pool, "org_1", {"task_id": "gone", "to": "done"})
        assert pool.executed == []
        assert result["skipped"] is True


# ── Source checks: the claims above, pinned ──────────────────────────────────

class TestNoThirdVocabulary:

    AGENT_FILES = ("status_agent.py", "review_agent.py")

    @pytest.mark.parametrize("name", AGENT_FILES)
    def test_no_illegal_status_literal_survives(self, name):
        """Any `status = '<literal>'` in either file must be one of the five.

        Catches the exact regression this run closed: `'review'` and
        `'approved'` written straight into the column."""
        src = (AGENTS / name).read_text(encoding="utf-8")
        # Only SQL/assignment literals in code, not the docblock: strip the
        # module docstring first, since it quotes the old values on purpose.
        body = src.split('"""', 2)[-1]
        for value in re.findall(r"status\s*=\s*'([a-z_]+)'", body, re.I):
            assert value in TASK_STATUSES, \
                f"{name} writes status={value!r}, which is not one of the five"

    def test_status_agent_calls_the_validator(self):
        src = (AGENTS / "status_agent.py").read_text(encoding="utf-8")
        assert "assert_transition(" in src

    def test_review_agent_writes_no_status_at_all(self):
        """The safest guard is the write that no longer exists."""
        src = (AGENTS / "review_agent.py").read_text(encoding="utf-8")
        body = src.split('"""', 2)[-1]
        assert not re.search(r"UPDATE\s+tasks\s+SET", body, re.I), \
            "review_agent must not write to tasks — it reports, a person decides"

    @pytest.mark.parametrize("name", AGENT_FILES)
    def test_neither_agent_queries_a_column_that_has_never_existed(self, name):
        """`public.tasks` has no `parent_task_id` and there is no
        `custom_fields` TABLE — both measured against the live database on
        2026-08-06. Subtasks are the JSONB `tasks.subtasks` array."""
        body = (AGENTS / name).read_text(encoding="utf-8").split('"""', 2)[-1]
        assert "parent_task_id" not in body
        assert not re.search(r"\bFROM\s+custom_fields\b|\bJOIN\s+custom_fields\b", body, re.I)


# ── One TaskOut, not two ─────────────────────────────────────────────────────

class TestOneTaskShape:

    def test_utils_no_longer_carries_a_second_copy(self):
        """utils.py held a `TaskOut` and a `row_to_task` with ZERO importers
        that had ALREADY drifted from server.py's: no `reminders` field, and
        `assignee_names` declared but never populated. The module header says
        "import from here, not from server.py", which is what made the dead
        copy dangerous rather than merely untidy."""
        import utils
        assert not hasattr(utils, "TaskOut")
        assert not hasattr(utils, "row_to_task")

    def test_the_surviving_copy_is_the_one_the_api_serves(self):
        from server import TaskOut, row_to_task  # noqa: F401
        fields = TaskOut.model_fields
        assert "reminders" in fields, "the dead copy lacked this"
        assert "assignee_names" in fields

    def test_no_third_copy_appears(self):
        """Two was already one too many."""
        defs = []
        for path in BACKEND.rglob("*.py"):
            parts = set(path.parts)
            if "__pycache__" in parts or ".venv" in parts or "tests" in parts:
                continue
            src = path.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"^class TaskOut\b", src, re.M) or re.search(r"^def row_to_task\b", src, re.M):
                defs.append(path.name)
        assert defs == ["server.py"], f"TaskOut/row_to_task defined in {defs}"
