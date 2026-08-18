"""task.create — the checklist verb (proposal 66 N10).

What these pin: an unfinished rule is unwritable (no title, no target team);
the one hop that could cross a tenant boundary is verified at RUN time (the
team must belong to the event's org, fail-closed); the author is the org's
system account; and — TaskSetStatus's precedent for robot writes — the verb
does NOT emit task.created, because an action that emitted would let one rule
trigger another, and a rule chain is a loop with extra steps.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.niyam.actions import ACTIONS, TaskCreateAction, system_actor_id
from services.niyam.validate import RuleInvalid, _validate_action

ORG = "22222222-2222-2222-2222-222222222222"
EVENT = {"org_id": ORG, "entity_id": "deal-1", "event_type": "deal.stage_changed"}


def _cfg(**over):
    cfg = {"verb": "task.create", "title": "Prepare the handover",
           "team_id": "team_abc123"}
    cfg.update(over)
    return cfg


# ── authoring-time refusals ──────────────────────────────────────────────────

def test_the_verb_is_in_the_allowlist():
    assert "task.create" in ACTIONS


def test_no_title_is_unwritable():
    with pytest.raises(RuleInvalid):
        _validate_action(_cfg(title="  "), step_no=0)


def test_no_team_is_unwritable():
    with pytest.raises(RuleInvalid):
        _validate_action(_cfg(team_id=""), step_no=0)


def test_a_novel_title_length_is_refused():
    with pytest.raises(RuleInvalid):
        _validate_action(_cfg(title="x" * 501), step_no=0)


def test_a_complete_config_validates():
    _validate_action(_cfg(), step_no=0)


# ── run-time behaviour ───────────────────────────────────────────────────────

class FakeConn:
    def __init__(self, team_org=ORG, team_exists=True):
        self.team_org = team_org
        self.team_exists = team_exists
        self.executed = []

    async def fetchrow(self, sql, *args):
        if "FROM public.teams" in sql:
            if not self.team_exists:
                return None
            return {"team_id": args[0], "org_id": self.team_org}
        return None

    async def fetchval(self, sql, *args):
        if "FROM public.users" in sql:
            return 1                      # system actor exists
        if "project_columns" in sql:
            return "col_first"
        return None

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))


async def test_a_foreign_team_is_refused_fail_closed():
    conn = FakeConn(team_org="99999999-9999-9999-9999-999999999999")
    out = await TaskCreateAction().run(conn, config=_cfg(), event=EVENT)
    assert out.outcome == "refused"
    assert not any("INSERT INTO public.tasks" in sql for sql, _ in conn.executed)


async def test_a_vanished_team_is_refused_not_failed():
    conn = FakeConn(team_exists=False)
    out = await TaskCreateAction().run(conn, config=_cfg(), event=EVENT)
    assert out.outcome == "refused"


async def test_the_task_is_authored_by_the_system_account():
    conn = FakeConn()
    out = await TaskCreateAction().run(conn, config=_cfg(), event=EVENT)
    assert out.outcome == "ok"
    [(sql, args)] = [(s, a) for s, a in conn.executed
                     if "INSERT INTO public.tasks" in s]
    assert system_actor_id(ORG) in args
    assert "'todo'" in sql
    assert out.detail["task_id"].startswith("task_")


def test_the_verb_never_emits_its_own_event():
    """The loop guard IS a structural fact: no emitter name appears anywhere
    in the action's source. TaskSetStatus's precedent, made unremovable."""
    src = (Path(__file__).resolve().parent.parent
           / "services" / "niyam" / "actions.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    [cls] = [n for n in ast.walk(tree)
             if isinstance(n, ast.ClassDef) and n.name == "TaskCreateAction"]
    called = {f.func.attr if isinstance(f.func, ast.Attribute)
              else getattr(f.func, "id", "")
              for f in ast.walk(cls) if isinstance(f, ast.Call)}
    assert "task_created" not in called
    assert "emit_event" not in called
