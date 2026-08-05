"""
The automation engine's action config: what it runs, what it refuses, and what
it says when it refuses.

WHICH ENGINE. There are two functions called `fire_automations` in this repo.
This file covers services/automation_engine.py — TASK automations, the
`automations` table, fired from server.py and routers/tasks_bulk.py. The CRM one
in routers/graha.py has a different signature, a different table
(staging.graha_automations), a different action vocabulary and its own log
table; nothing here touches it.

WHAT WENT WRONG. frontend/src/pages/AutomationsPage.jsx collected ONE text box
per rule and filed it under `message`, `status` or `value`. The engine read
`to`, `user_ids`, `field_id`+`value`, `status`, `user_ids` and `body`. Only
change_status lined up. Every other action looked up a key that was not there,
took the default from `.get()`, did nothing (or something wrong), and appended
`ok: True`. A key mismatch is silent by construction: `.get("body", "")` cannot
tell "the author wanted an empty comment" apart from "nobody wrote this key".

The first test below pins the action that WORKED, because a fix to the other
five that breaks change_status is not a fix.

MUTATION-CHECKED. Each assertion was confirmed to go red by breaking the thing
it covers; the mutations are named on the tests themselves.
"""
import logging

import pytest

from services.automation_engine import (
    ACTION_CONFIG,
    config_problems,
    unread_config_keys,
    matches_filters,
    run_automation,
    fire_automations,
)
from conftest import make_pool


# ── helpers ───────────────────────────────────────────────────────────────────

def rule(action_type, config, **kw):
    return {"automation_id": "auto_test01", "name": "Test rule",
            "actions": [{"type": action_type, "config": config}], **kw}


CTX = {"task": {"task_id": "task_1", "team_id": "team_1"}, "team_id": "team_1"}


def statements(pool):
    """Every SQL string the engine handed to pool.execute, whitespace-normalised."""
    return [" ".join(str(c.args[0]).split()) for c in pool.execute.call_args_list if c.args]


def wrote_to(pool, table):
    """True if any statement inserted into or updated `table`."""
    t = table.lower()
    return any(
        s.lower().startswith(f"insert into {t} ") or s.lower().startswith(f"update {t} ")
        for s in statements(pool)
    )


# ── 1. THE ONE THAT WORKED ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_change_status_still_works():
    """
    change_status is the sixth action: the builder wrote `status` and the engine
    read `status`, so it has always worked. Pinned first and pinned hardest —
    the required-config gate added for the other five must not catch it.

    MUTATION: dropping "status" from ACTION_CONFIG["change_status"]["reads"]
    makes the gate report it as a stray key; renaming the branch's cfg["status"]
    raises KeyError. Both go red here.
    """
    pool = make_pool()
    out = await run_automation(rule("change_status", {"status": "done"}), CTX, pool)

    assert out["ok"] is True
    assert out["action_results"] == [{"action": "change_status", "ok": True}]
    sql = statements(pool)
    assert any(s.startswith("UPDATE tasks SET status=$1") for s in sql), sql
    # The value, not just the statement: a rule that fires the right SQL with
    # the wrong argument is the same defect one layer down.
    call = next(c for c in pool.execute.call_args_list if "UPDATE tasks SET status" in str(c.args[0]))
    assert call.args[1] == "done"
    assert call.args[2] == "task_1"


@pytest.mark.asyncio
async def test_change_status_tolerates_a_key_it_does_not_read():
    """
    A stray key must NOT stop a runnable action. This is the guard on the guard:
    refusing to run change_status because its config carries an extra note would
    be the fix breaking the only thing that was not broken.
    """
    pool = make_pool()
    out = await run_automation(rule("change_status", {"status": "done", "note": "x"}), CTX, pool)

    assert out["ok"] is True
    assert out["action_results"][0]["ignored"] == ["note"]     # reported…
    assert wrote_to(pool, "tasks")                              # …and still run


@pytest.mark.asyncio
async def test_change_status_no_longer_defaults_a_blank_to_todo():
    """
    The old branch was `cfg.get("status", "todo")`. A rule whose status was never
    filled in did not fail — it moved the task to `todo`, silently, and reported
    success. Deliberate behaviour change: now it refuses.
    """
    pool = make_pool()
    out = await run_automation(rule("change_status", {}), CTX, pool)

    assert out["ok"] is False
    assert "missing 'status'" in out["action_results"][0]["error"]
    assert not wrote_to(pool, "tasks")


# ── 2. THE FIVE THAT DID NOT ──────────────────────────────────────────────────
# Each is given the config the OLD BUILDER actually produced, verbatim.

@pytest.mark.asyncio
async def test_assign_to_with_legacy_config_does_not_unassign_everyone():
    """
    The worst of the six. The builder wrote {"value": "name@example.com"}; the
    engine read `cfg.get("user_ids", [])` and ran

        UPDATE tasks SET assignee_user_ids=$1 ... -- with []

    `assignee_user_ids` is an array column and that statement is an overwrite,
    so a misconfigured rule did not no-op: it UNASSIGNED EVERYONE on the task,
    on every matching event, and reported ok:True.

    MUTATION: restoring `cfg.get("user_ids", [])` in the branch and removing the
    gate makes `wrote_to(pool, "tasks")` true again — red.
    """
    pool = make_pool()
    out = await run_automation(rule("assign_to", {"value": "name@example.com"}), CTX, pool)

    assert out["ok"] is False
    assert not wrote_to(pool, "tasks"), "assign_to must not touch the task without recipients"
    assert "missing 'user_ids'" in out["action_results"][0]["error"]


@pytest.mark.asyncio
async def test_post_comment_with_legacy_config_posts_nothing():
    """Builder wrote `message`; engine read `cfg.get("body", "")` and inserted an
    empty comment on the task, reporting success."""
    pool = make_pool()
    out = await run_automation(rule("post_comment", {"message": "Nice work"}), CTX, pool)

    assert out["ok"] is False
    assert not wrote_to(pool, "task_comments")
    assert "missing 'body'" in out["action_results"][0]["error"]


@pytest.mark.asyncio
async def test_send_notification_with_legacy_config_notifies_nobody_and_says_so():
    """
    `message` was the one key that DID line up — and it made no difference,
    because the loop is over `cfg.get("user_ids") or []`. Zero iterations, zero
    notifications, ok:True. The most purely silent of the six.
    """
    pool = make_pool()
    out = await run_automation(rule("send_notification", {"message": "Nice work"}), CTX, pool)

    assert out["ok"] is False
    assert not wrote_to(pool, "notifications")
    assert "missing 'user_ids'" in out["action_results"][0]["error"]


@pytest.mark.asyncio
async def test_set_field_with_legacy_config_writes_nothing():
    """Builder wrote `value` only; `field_id` was never collected. The INSERT went
    out with field_id NULL against a NOT NULL column, so this one at least
    raised — into a warning log nobody reads, with the result discarded."""
    pool = make_pool()
    out = await run_automation(rule("set_field", {"value": "x"}), CTX, pool)

    assert out["ok"] is False
    assert not wrote_to(pool, "field_values")
    assert "missing 'field_id'" in out["action_results"][0]["error"]


@pytest.mark.asyncio
async def test_send_email_with_legacy_config_sends_nothing():
    pool = make_pool()
    out = await run_automation(rule("send_email", {"message": "hello"}), CTX, pool)

    assert out["ok"] is False
    assert "missing 'to'" in out["action_results"][0]["error"]


# ── 3. THE SAME FIVE, CONFIGURED THE WAY THE BUILDER NOW WRITES THEM ──────────

@pytest.mark.asyncio
async def test_assign_to_assigns_the_listed_users():
    pool = make_pool()
    out = await run_automation(rule("assign_to", {"user_ids": ["user_a", "user_b"]}), CTX, pool)

    assert out["ok"] is True
    call = next(c for c in pool.execute.call_args_list if "assignee_user_ids" in str(c.args[0]))
    assert call.args[1] == ["user_a", "user_b"]


@pytest.mark.asyncio
async def test_post_comment_posts_the_body():
    pool = make_pool()
    out = await run_automation(rule("post_comment", {"body": "Nice work"}), CTX, pool)

    assert out["ok"] is True
    call = next(c for c in pool.execute.call_args_list if "task_comments" in str(c.args[0]))
    assert call.args[3] == "Nice work"


@pytest.mark.asyncio
async def test_send_notification_inserts_one_row_per_recipient():
    pool = make_pool()
    out = await run_automation(
        rule("send_notification", {"user_ids": ["user_a", "user_b"], "message": "Nice work"}),
        CTX, pool,
    )

    assert out["ok"] is True
    assert out["action_results"][0]["count"] == 2
    rows = [c for c in pool.execute.call_args_list if "notifications" in str(c.args[0])]
    assert [c.args[2] for c in rows] == ["user_a", "user_b"]
    assert all(c.args[5] == "Nice work" for c in rows)


@pytest.mark.asyncio
async def test_set_field_writes_field_id_and_value():
    pool = make_pool()
    out = await run_automation(rule("set_field", {"field_id": "fld_1", "value": "x"}), CTX, pool)

    assert out["ok"] is True
    call = next(c for c in pool.execute.call_args_list if "field_values" in str(c.args[0]))
    assert call.args[2] == "fld_1"
    assert call.args[3] == '"x"'      # json.dumps


@pytest.mark.asyncio
async def test_set_field_accepts_a_falsy_value_it_was_actually_given():
    """
    `value` is required to be PRESENT, not to be truthy. Setting a numeric field
    to 0 or a checkbox to false is a real instruction, and a validator that
    rejects it has swapped one silent failure for a loud wrong one.

    MUTATION: moving "value" from `present` to `required` in ACTION_CONFIG makes
    this red while every other test stays green — which is the point of it.
    """
    pool = make_pool()
    out = await run_automation(rule("set_field", {"field_id": "fld_1", "value": 0}), CTX, pool)

    assert out["ok"] is True
    call = next(c for c in pool.execute.call_args_list if "field_values" in str(c.args[0]))
    assert call.args[3] == "0"


# ── 4. The pure config gate ───────────────────────────────────────────────────
# The pool is a MagicMock that resolves any table and any column, so behaviour
# proved against it proves little. The decision lives in these two functions.

def test_config_problems_names_every_missing_required_key():
    assert config_problems("send_email", {}) == ["missing 'to'"]
    assert config_problems("send_notification", {"user_ids": []}) == ["missing 'user_ids'"]
    assert config_problems("post_comment", {"body": "   x"}) == []
    assert config_problems("change_status", {"status": "done"}) == []


def test_config_problems_rejects_an_action_type_with_no_handler():
    """
    The original if/elif chain had no `else`, so an unrecognised action type
    produced NO result row — not a failure, not a success, no trace at all.
    VALID_ACTIONS in routers/automations.py guards creation, but the /run
    endpoint executes whatever is stored and rows predate validators.
    """
    assert config_problems("delete_everything", {}) == ["unknown action type 'delete_everything'"]


def test_config_problems_survives_a_config_that_is_not_an_object():
    assert config_problems("post_comment", "just a string")[0].startswith("config must be an object")
    assert config_problems("post_comment", None)[0].startswith("config must be an object")


def test_unread_config_keys_is_advisory_not_fatal():
    # Reported…
    assert unread_config_keys("post_comment", {"body": "x", "message": "x"}) == ["message"]
    # …but never a reason to refuse.
    assert config_problems("post_comment", {"body": "x", "message": "x"}) == []


def test_every_required_and_present_key_is_also_a_read_key():
    """
    A key required but never read would be a rule you must fill in for an action
    that then ignores it — the same disagreement, self-inflicted. Written as a
    loop over the literal table rather than as a set difference, because a
    difference against a set derived from the same table can only ever be empty.
    """
    for action_type, spec in ACTION_CONFIG.items():
        for key in tuple(spec["required"]) + tuple(spec["present"]):
            assert key in spec["reads"], f"{action_type}: '{key}' is demanded but not read"


# ── 5. Conditions ─────────────────────────────────────────────────────────────
# The same class of mismatch one level up: the builder's <select> emits
# 'equals' / 'not_equals', the engine tested for 'eq' / 'neq' / 'in' with bare
# sequential ifs and no else — so an unrecognised operator matched nothing, fell
# out of the bottom, and returned True. Every conditional rule fired on every
# event of its trigger type with its conditions ignored.

def test_the_builders_operator_is_understood():
    """MUTATION: delete the 'equals' entry from _OP_ALIASES → red."""
    ctx = {"task": {"task_id": "t", "status": "done"}}
    assert matches_filters([{"field": "status", "op": "equals", "value": "done"}], ctx) is True
    assert matches_filters([{"field": "status", "op": "equals", "value": "todo"}], ctx) is False
    assert matches_filters([{"field": "status", "op": "not_equals", "value": "done"}], ctx) is False


def test_an_unknown_operator_does_not_fire():
    """
    Refusing to act on a condition you cannot evaluate is recoverable; firing on
    every event because the condition parsed to nothing is what put unwanted
    comments and status changes on tasks.
    """
    ctx = {"task": {"task_id": "t", "status": "done"}}
    assert matches_filters([{"field": "status", "op": "sorta_like", "value": "done"}], ctx) is False


def test_status_is_read_from_the_status_the_task_moved_to():
    """
    server.py passes {"task": {...}, "from": old, "to": new} and does not re-read
    the task, so `task["status"]` is the value from BEFORE the update. On a
    status_changed event "status = done" can only mean the new one.
    """
    ctx = {"task": {"task_id": "t", "status": "in_progress"}, "from": "in_progress", "to": "done"}
    assert matches_filters([{"field": "status", "op": "equals", "value": "done"}], ctx) is True


def test_assignee_matches_membership_of_the_array_column():
    ctx = {"task": {"task_id": "t", "assignee_user_ids": ["user_a", "user_b"]}}
    assert matches_filters([{"field": "assignee", "op": "equals", "value": "user_a"}], ctx) is True
    assert matches_filters([{"field": "assignee", "op": "equals", "value": "user_z"}], ctx) is False
    assert matches_filters([{"field": "assignee", "op": "not_equals", "value": "user_a"}], ctx) is False


def test_no_conditions_still_means_fire():
    assert matches_filters([], {"task": {}}) is True
    assert matches_filters(None, {"task": {}}) is True


def test_a_condition_the_event_cannot_answer_does_not_fire_and_says_so(caplog):
    """
    The context the callers build is thin: server.py passes {"task_id",
    "team_id"} and tasks_bulk.py the same plus from/to. So a condition on
    `priority` — one of the three fields the builder offers — has nothing to
    read. Answering "not equal" silently would give a rule that never fires and
    never explains itself; this refuses AND names the field.

    MUTATION: return `task.get(field)` instead of `task.get(field, MISSING)`
    from _resolve_field → no warning, and the assertion on the log goes red.
    """
    ctx = {"task": {"task_id": "t", "team_id": "team_1"}, "team_id": "team_1", "to": "done"}
    with caplog.at_level(logging.WARNING, logger="services.automation_engine"):
        fired = matches_filters([{"field": "priority", "op": "equals", "value": "high"}], ctx)

    assert fired is False
    assert "priority" in caplog.text
    assert "cannot be evaluated" in caplog.text


def test_a_field_that_is_genuinely_null_is_not_confused_with_a_missing_one():
    """
    `assignee` present and empty is an answer — the task has nobody on it — and
    "assignee is not user_a" is TRUE of it. Only an absent field is unevaluable.
    """
    ctx = {"task": {"task_id": "t", "assignee_user_ids": []}}
    assert matches_filters([{"field": "assignee", "op": "not_equals", "value": "user_a"}], ctx) is True
    assert matches_filters([{"field": "assignee", "op": "equals", "value": "user_a"}], ctx) is False


# ── 6. The silence ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_rule_that_fires_and_does_nothing_says_so_in_the_log(caplog):
    """
    `fire_automations` used to call `asyncio.create_task(run_automation(...))`
    and keep no reference: every reason an action gave for failing died inside
    that orphan task. This is the line an operator can grep for.

    MUTATION: drop the `await asyncio.gather(...)` result and go back to
    create_task → no WARNING is emitted → red.
    """
    pool = make_pool()
    pool.fetch.return_value = [{
        "automation_id": "auto_x", "name": "Notify on done", "team_id": "team_1",
        "trigger": {"event": "status_changed", "filters": []},
        "actions": [{"type": "post_comment", "config": {"message": "hi"}}],
    }]

    with caplog.at_level(logging.WARNING, logger="services.automation_engine"):
        await fire_automations(pool, "status_changed", CTX)

    text = caplog.text
    assert "auto_x" in text and "Notify on done" in text
    assert "did nothing" in text
    assert "missing 'body'" in text


@pytest.mark.asyncio
async def test_a_rule_that_works_stays_quiet():
    """The counterpart: a WARNING on every successful fire would be noise, and
    noise is how the real one gets missed."""
    pool = make_pool()
    pool.fetch.return_value = [{
        "automation_id": "auto_ok", "name": "Move to done", "team_id": "team_1",
        "trigger": {"event": "status_changed", "filters": []},
        "actions": [{"type": "change_status", "config": {"status": "done"}}],
    }]

    records = []
    handler = logging.Handler()
    handler.emit = records.append
    log = logging.getLogger("services.automation_engine")
    log.addHandler(handler)
    try:
        await fire_automations(pool, "status_changed", CTX)
    finally:
        log.removeHandler(handler)

    assert [r for r in records if r.levelno >= logging.WARNING] == []


@pytest.mark.asyncio
async def test_run_automation_reports_a_failure_count_the_caller_can_act_on():
    """
    The /run endpoint hands this straight to the page. Before, the page got a
    200 and announced `"<name>" ran successfully` for a rule whose every action
    had found no config — the one tool built for checking a rule was the tool
    most confidently lying about it.
    """
    pool = make_pool()
    out = await run_automation(
        {"automation_id": "a", "name": "n", "actions": [
            {"type": "change_status", "config": {"status": "done"}},
            {"type": "post_comment", "config": {"message": "hi"}},
        ]},
        CTX, pool,
    )
    assert out["failed"] == 1
    assert out["ok"] is False
    assert [r["ok"] for r in out["action_results"]] == [True, False]


@pytest.mark.asyncio
async def test_an_action_with_no_task_in_context_refuses_instead_of_writing_null():
    """A manual /run posts whatever context the caller sends; the page sends
    {"team_id": ..., "_test": true} with no task at all."""
    pool = make_pool()
    out = await run_automation(rule("change_status", {"status": "done"}), {"team_id": "team_1"}, pool)

    assert out["ok"] is False
    assert out["action_results"][0]["error"] == "no task in event context"
    assert not wrote_to(pool, "tasks")
