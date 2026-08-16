"""The engine: claiming, running a pipeline, and stopping honestly.

Uses an in-memory stand-in for the four tables rather than the mock pool,
because what is under test IS the SQL's effect — which rows exist after a claim,
what a run step records, whether a wait writes one. A test that stubbed those
answers would be testing its own stubs.
"""
from __future__ import annotations

import json

import pytest

from services.niyam import engine as E
from services.niyam.actions import ActionResult
from services.niyam.subjects import TASK_STATUS_CHANGED

ORG = "11111111-1111-1111-1111-111111111111"


class FakeConn:
    """Enough of asyncpg to run the pipeline, with the constraints that matter.

    The two UNIQUE constraints are modelled explicitly — `(rule_id, event_id)`
    on runs and `(run_id, step_no)` on run steps — because both ARE the
    behaviour: the first is idempotency, the second is the resume cursor.
    """

    def __init__(self, rules=(), steps=(), tasks=()):
        self.rules = [dict(r) for r in rules]
        self.steps = [dict(s) for s in steps]
        self.tasks = {t["task_id"]: dict(t) for t in tasks}
        self.runs: dict = {}
        self.run_steps: list = []
        self.claims: set = set()

    def transaction(self):
        class _T:
            async def __aenter__(_s): return _s
            async def __aexit__(_s, *a): return False
        return _T()

    async def fetch(self, sql, *a):
        if "FROM staging.niyam_rules" in sql:
            return [r for r in self.rules if r.get("enabled", True)]
        if "FROM staging.niyam_rule_steps" in sql:
            return sorted([s for s in self.steps if s["rule_id"] == a[0]],
                          key=lambda s: s["step_no"])
        if "step_no FROM staging.niyam_run_steps" in sql:
            return [{"step_no": s["step_no"]} for s in self.run_steps
                    if s["run_id"] == a[0]]
        return []

    async def fetchrow(self, sql, *a):
        if "FROM public.tasks" in sql:
            t = self.tasks.get(a[0])
            return dict(t) if t else None
        return None

    async def fetchval(self, sql, *a):
        if "INSERT INTO staging.niyam_runs" in sql:
            run_id, rule_id, event_id = a[0], a[1], a[2]
            if (rule_id, event_id) in self.claims:
                return None                      # ON CONFLICT DO NOTHING
            self.claims.add((rule_id, event_id))
            self.runs[run_id] = {"run_id": run_id, "rule_id": rule_id,
                                 "event_id": event_id, "dry_run": a[4],
                                 "wake_at": None, "finished_at": None}
            return run_id
        return None

    async def execute(self, sql, *a):
        if "INSERT INTO staging.niyam_run_steps" in sql:
            run_id, step_no = a[1], a[2]
            if any(s["run_id"] == run_id and s["step_no"] == step_no
                   for s in self.run_steps):
                return "INSERT 0 0"              # ON CONFLICT DO NOTHING
            self.run_steps.append({"run_step_id": a[0], "run_id": run_id,
                                   "step_no": step_no, "outcome": a[3],
                                   "detail": json.loads(a[4]),
                                   "outbound_id": a[5]})
        elif "SET wake_at = NOW()" in sql:
            # setdefault, because a test may drive run_pipeline directly without
            # claiming first — the run row always exists in the real flow.
            self.runs.setdefault(a[1], {"run_id": a[1], "finished_at": None})["wake_at"] = "set"
        elif "SET finished_at = NOW()" in sql:
            r = self.runs.setdefault(a[0], {"run_id": a[0], "finished_at": None})
            if r["finished_at"] is None:
                r["finished_at"] = "set"
        elif "UPDATE public.tasks" in sql:
            self.tasks[a[2]]["status"] = a[0]
            self.tasks[a[2]]["completed_at"] = "set" if a[1] else None
        return "OK"

    # helpers
    def outcomes(self):
        return [(s["step_no"], s["outcome"]) for s in sorted(
            self.run_steps, key=lambda s: s["step_no"])]


def event(**over):
    base = {"event_id": 7, "org_id": ORG, "event_type": TASK_STATUS_CHANGED,
            "entity_type": "task", "entity_id": "task_abc",
            "payload": {"before": {"status": "todo"},
                        "after": {"status": "done", "priority": "high"}}}
    base.update(over)
    return base


def cond(step_no, field, operator, value):
    return {"rule_id": "rule_1", "step_no": step_no, "kind": "condition",
            "config": {"field": field, "operator": operator, "value": value}}


def action(step_no, verb, **cfg):
    return {"rule_id": "rule_1", "step_no": step_no, "kind": "action",
            "config": {"verb": verb, **cfg}}


# ── the claim ────────────────────────────────────────────────────────────────

async def test_a_second_claim_on_the_same_pair_returns_nothing():
    """The whole idempotency story. One worker wins; a redeploy mid-drain
    replays safely because the winner's row is already there."""
    conn = FakeConn()
    first = await E.claim(conn, rule_id="rule_1", event_id=7, org_id=ORG, dry_run=True)
    second = await E.claim(conn, rule_id="rule_1", event_id=7, org_id=ORG, dry_run=True)
    assert first is not None
    assert second is None


async def test_a_different_event_claims_freely():
    conn = FakeConn()
    assert await E.claim(conn, rule_id="rule_1", event_id=7, org_id=ORG, dry_run=True)
    assert await E.claim(conn, rule_id="rule_1", event_id=8, org_id=ORG, dry_run=True)


# ── dry runs ─────────────────────────────────────────────────────────────────

async def test_a_dry_run_records_what_it_WOULD_have_done_and_touches_nothing():
    """An unarmed rule is not skipped. It evaluates for real against a real
    event and records `dry` — the only way to see a rule before trusting it."""
    conn = FakeConn(steps=[cond(0, "status", "is", "done"),
                           action(1, "task.set_status", status="todo")],
                    tasks=[{"task_id": "task_abc", "team_id": "team_1", "status": "done"}])
    result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                  event=event(), dry_run=True)
    assert result == "ok"
    assert conn.outcomes() == [(0, "ok"), (1, "dry")]
    assert conn.tasks["task_abc"]["status"] == "done", "a dry run must not write"
    assert "would" in conn.run_steps[1]["detail"]


# ── conditions stop the pipeline ─────────────────────────────────────────────

async def test_a_refused_condition_stops_the_run_and_records_why():
    conn = FakeConn(steps=[cond(0, "priority", "is", "low"),
                           action(1, "task.set_status", status="todo")])
    result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                  event=event(), dry_run=True)
    assert result == "refused"
    assert conn.outcomes() == [(0, "refused")], "the action must not have run"
    detail = conn.run_steps[0]["detail"]
    assert detail["field"] == "priority" and detail["got"] == "high"


async def test_a_condition_on_a_field_the_event_lacks_is_failed_not_refused():
    """A permanently broken rule must be distinguishable from one that simply
    has not matched yet."""
    conn = FakeConn(steps=[cond(0, "due_at", "before", "2026-01-01T00:00:00+00:00")])
    result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                  event=event(), dry_run=True)
    assert result == "failed"
    assert conn.outcomes() == [(0, "failed")]


# ── the closed allowlist ─────────────────────────────────────────────────────

async def test_an_unknown_verb_fails_and_names_what_is_allowed():
    conn = FakeConn(steps=[action(0, "invoice.create", amount=100)])
    result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                  event=event(), dry_run=False)
    assert result == "failed"
    d = conn.run_steps[0]["detail"]
    assert "not an allowed action" in d["reason"]
    assert "invoice.create" not in d["allowed"]


async def test_the_allowlist_contains_no_money_verb():
    """'No rule moves money' is only a real promise if adding one is a reviewed
    code change rather than a config change."""
    from services.niyam.actions import ACTIONS
    for verb in ACTIONS:
        assert not any(w in verb for w in
                       ("invoice", "payment", "pay", "refund", "credit", "charge")), verb


# ── waits ────────────────────────────────────────────────────────────────────

async def test_a_wait_stamps_wake_at_and_writes_NO_step_row():
    """The cursor is 'steps that have completed'. A wait that has not resumed
    has not completed — writing a row here would make the resume skip it."""
    conn = FakeConn(steps=[{"rule_id": "rule_1", "step_no": 0, "kind": "wait",
                            "config": {"minutes": 30}},
                           action(1, "task.set_status", status="todo")])
    result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                  event=event(), dry_run=True)
    assert result == "waiting"
    assert conn.runs["run_1"]["wake_at"] == "set"
    assert conn.runs["run_1"]["finished_at"] is None, "a waiting run is not finished"
    assert conn.outcomes() == [], "a pending wait records no completed step"


async def test_a_wait_with_no_duration_fails_rather_than_sleeping_for_ever():
    conn = FakeConn(steps=[{"rule_id": "rule_1", "step_no": 0, "kind": "wait",
                            "config": {}}])
    assert await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                event=event(), dry_run=True) == "failed"


async def test_a_resumed_run_skips_the_steps_it_already_completed():
    """The cursor in action. Re-running the pipeline must not repeat step 0."""
    conn = FakeConn(steps=[cond(0, "status", "is", "done"),
                           action(1, "task.set_status", status="todo")],
                    tasks=[{"task_id": "task_abc", "team_id": "team_1", "status": "done"}])
    conn.run_steps.append({"run_step_id": "rs_x", "run_id": "run_1", "step_no": 0,
                           "outcome": "ok", "detail": {}, "outbound_id": None})
    await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                         event=event(), dry_run=True)
    assert conn.outcomes() == [(0, "ok"), (1, "dry")]
    assert len([s for s in conn.run_steps if s["step_no"] == 0]) == 1


# ── the armed path ───────────────────────────────────────────────────────────

async def test_an_armed_set_status_stamps_completed_at():
    """`update_task` — the route the edit form uses — does NOT stamp it. Copying
    the most central human path would have reproduced the exact defect this
    design blames on the old engine."""
    conn = FakeConn(steps=[action(0, "task.set_status", status="done")],
                    tasks=[{"task_id": "task_abc", "team_id": "team_1", "status": "todo"}])
    import services.task_transitions as T
    original = T.assert_transition

    async def _allow(*a, **k):
        return None
    T.assert_transition = _allow
    try:
        result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                      event=event(), dry_run=False)
    finally:
        T.assert_transition = original

    assert result == "ok"
    assert conn.outcomes() == [(0, "ok")]
    assert conn.tasks["task_abc"]["status"] == "done"
    assert conn.tasks["task_abc"]["completed_at"] == "set"


async def test_setting_a_status_a_task_already_has_is_skipped_not_ok():
    conn = FakeConn(steps=[action(0, "task.set_status", status="done")],
                    tasks=[{"task_id": "task_abc", "team_id": "team_1", "status": "done"}])
    await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                         event=event(), dry_run=False)
    assert conn.outcomes() == [(0, "skipped")]


async def test_a_deleted_task_is_refused_not_failed():
    """Deleted between the event and the run is normal under any delay, and
    emphatically not a fault of the rule."""
    conn = FakeConn(steps=[action(0, "task.set_status", status="done")])
    await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                         event=event(), dry_run=False)
    assert conn.outcomes() == [(0, "refused")]


async def test_an_action_that_raises_is_contained_and_recorded():
    """One bad action must not end a drain tick — the rest of the batch is
    already claimed and would otherwise sit processed-but-unrun."""
    from services.niyam.actions import ACTIONS

    class Boom:
        verb = "task.set_status"
        def describe(self, c, e): return "boom"
        async def run(self, conn, *, config, event): raise RuntimeError("kaboom")

    original = ACTIONS["task.set_status"]
    ACTIONS["task.set_status"] = Boom()
    try:
        conn = FakeConn(steps=[action(0, "task.set_status", status="done")])
        result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                      event=event(), dry_run=False)
    finally:
        ACTIONS["task.set_status"] = original

    assert result == "failed"
    assert "kaboom" in conn.run_steps[0]["detail"]["error"]


# ── the flag decides dry, per run ────────────────────────────────────────────

def test_both_gates_must_be_open(monkeypatch):
    from services.niyam.flags import ARMED_VAR, rule_effective_mode
    monkeypatch.delenv(ARMED_VAR, raising=False)
    assert rule_effective_mode(True) == "dry", "engine unarmed beats a rule armed"
    monkeypatch.setenv(ARMED_VAR, "1")
    assert rule_effective_mode(False) == "dry", "rule unarmed beats engine armed"
    assert rule_effective_mode(True) == "live"


def test_an_empty_armed_var_means_off(monkeypatch):
    """A deploy that CLEARS a variable must not arm anything — `os.environ.get`
    returns '' for set-but-empty."""
    from services.niyam.flags import ARMED_VAR, engine_armed
    monkeypatch.setenv(ARMED_VAR, "")
    assert engine_armed() is False


# ── who a rule notifies, resolved per event ──────────────────────────────────
#
# "Tell whoever asked for it" is the commonest thing anyone wants, and it is
# meaningless as a stored user id — the answer differs for every task. So the
# rule stores the QUESTION and the engine answers it against the event.

def test_creator_and_assignees_resolve_from_the_event():
    from services.niyam.actions import resolve_recipients
    e = event()
    e["payload"]["after"].update({"created_by": "user_c",
                                  "assignee_user_ids": ["user_a", "user_b"]})
    assert resolve_recipients(["@creator"], e) == ["user_c"]
    assert resolve_recipients(["@assignees"], e) == ["user_a", "user_b"]


def test_a_person_who_is_both_creator_and_assignee_is_notified_once():
    from services.niyam.actions import resolve_recipients
    e = event()
    e["payload"]["after"].update({"created_by": "user_a",
                                  "assignee_user_ids": ["user_a", "user_b"]})
    assert resolve_recipients(["@creator", "@assignees"], e) == ["user_a", "user_b"]


def test_a_literal_user_id_passes_through_and_may_be_mixed_with_a_token():
    from services.niyam.actions import resolve_recipients
    e = event()
    e["payload"]["after"].update({"assignee_user_ids": ["user_a"]})
    assert resolve_recipients(["@assignees", "user_z"], e) == ["user_a", "user_z"]


def test_a_token_that_resolves_to_nobody_yields_nothing_rather_than_a_null():
    """An unassigned task must produce an empty list, not [None] — which would
    become a send to a user id of None and fail somewhere much less obvious."""
    from services.niyam.actions import resolve_recipients
    e = event()
    e["payload"]["after"].update({"created_by": None, "assignee_user_ids": []})
    assert resolve_recipients(["@creator", "@assignees"], e) == []


async def test_notify_refuses_when_the_token_resolves_to_nobody():
    """Distinguished from 'the rule names nobody', which validation refuses at
    save time. This is a fact about THIS event, so it is a refusal."""
    conn = FakeConn(steps=[action(0, "notify.send", to=["@assignees"], title="t")])
    e = event()
    e["payload"]["after"]["assignee_user_ids"] = []
    result = await E.run_pipeline(conn, run_id="run_1", rule_id="rule_1",
                                  event=e, dry_run=False)
    assert conn.outcomes() == [(0, "refused")]
    assert "nobody to notify" in conn.run_steps[0]["detail"]["reason"]
