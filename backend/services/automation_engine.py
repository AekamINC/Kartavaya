"""
automation_engine.py — Evaluates automation rules on events (TASK automations).

Usage:
    from services.automation_engine import fire_automations
    await fire_automations(pool, event_type="status_changed", context={"task": task_dict, "from": old_status, "to": new_status})

THERE ARE TWO ENGINES IN THIS REPO WITH A FUNCTION CALLED `fire_automations`.
This is the one for TASK automations: it reads the `automations` table, is
called from server.py and routers/tasks_bulk.py, and is edited by
frontend/src/pages/AutomationsPage.jsx. The other one lives in
routers/graha.py — signature (pool, org_id, trigger_type, context), table
staging.graha_automations, edited by pages/graha/AutomationsTab.jsx. It shares
nothing with this file but the name. Changing one does not change the other,
and a fix applied to the wrong one looks exactly like a fix applied correctly.
"""
import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


# ── The config contract ──────────────────────────────────────────────────────
# This table is the whole point of this module's rewrite, so it is worth saying
# why it exists as DATA rather than as a spray of cfg.get() calls inside the
# action branches.
#
# The bug it closes: the builder wrote `config.message` for post_comment while
# this engine read `cfg.get("body", "")`. The lookup found nothing, the default
# supplied "", the INSERT succeeded with an empty body, and the action reported
# ok:True. Five of the six actions were mismatched this way. Nothing raised,
# nothing logged, and the rule sat in the list showing a rising run count
# forever. A key mismatch is silent BY CONSTRUCTION — `.get()` with a default
# cannot tell "the user asked for empty" apart from "nobody wrote this key" —
# so the only durable fix is to state, once, which keys each action reads and
# which of them it cannot run without, and to refuse to run otherwise.
#
#   reads    — every key this action consults. The parity test compares this
#              against the keys the builder actually emits, so a rename on
#              either side goes red instead of going quiet.
#   required — must be present AND non-empty. Missing one aborts the action
#              with a reported error rather than a defaulted no-op.
#   present  — the key must exist, but may hold a falsy value. `set_field`
#              setting a field to "" or 0 or false is a legitimate instruction;
#              set_field with no `value` key at all is a broken rule.
ACTION_CONFIG: dict[str, dict[str, tuple]] = {
    "send_email":        {"reads": ("to", "subject", "html"),        "required": ("to",),       "present": ()},
    "send_notification": {"reads": ("user_ids", "title", "message"), "required": ("user_ids",), "present": ()},
    "set_field":         {"reads": ("field_id", "value"),            "required": ("field_id",), "present": ("value",)},
    "change_status":     {"reads": ("status",),                      "required": ("status",),   "present": ()},
    "assign_to":         {"reads": ("user_ids",),                    "required": ("user_ids",), "present": ()},
    "post_comment":      {"reads": ("body",),                        "required": ("body",),     "present": ()},
}


def config_problems(action_type: str, cfg: Any) -> list[str]:
    """
    Pure. Returns a list of human-readable reasons this action CANNOT RUN, or
    [] when the config satisfies the contract above. A non-empty return aborts
    the action with a reported error.

    Pure and pool-free on purpose: the pool is a MagicMock in tests and will
    happily resolve any table name and any column, so an action's behaviour
    proved against it proves very little. This function is where the decision
    lives, and it is testable on its own.
    """
    spec = ACTION_CONFIG.get(action_type)
    if spec is None:
        return [f"unknown action type '{action_type}'"]
    if not isinstance(cfg, dict):
        return [f"config must be an object, got {type(cfg).__name__}"]

    problems: list[str] = []
    for key in spec["required"]:
        value = cfg.get(key)
        # 0 and False are not blank. `if not value` would reject them, and a
        # field legitimately set to 0 is not a misconfigured rule.
        blank = value is None or (isinstance(value, (str, list, tuple, dict)) and len(value) == 0)
        if blank:
            problems.append(f"missing '{key}'")
    for key in spec["present"]:
        if key not in cfg:
            problems.append(f"missing '{key}'")
    return problems


def unread_config_keys(action_type: str, cfg: Any) -> list[str]:
    """
    Pure. Keys the stored config carries that this action never reads.

    Advisory, NOT fatal, and the distinction is deliberate. A config carrying an
    unread key is the exact signature of the bug this module shipped with, so it
    must be visible — but a config can carry a stray key and still be perfectly
    runnable (`{"status": "done", "note": "x"}` has everything change_status
    needs). change_status is the one action that was never broken; refusing to
    run it over a key it happens to ignore would be this fix breaking the only
    thing that worked. So: reported on the result, logged, never fatal.
    """
    spec = ACTION_CONFIG.get(action_type)
    if spec is None or not isinstance(cfg, dict):
        return []
    return sorted(k for k in cfg if k not in spec["reads"])


# ── Filters ──────────────────────────────────────────────────────────────────
# The builder's <select> emits 'equals' / 'not_equals'. This engine's original
# filter loop tested for 'eq' / 'neq' / 'in' with plain sequential `if`s and no
# else, so an unrecognised operator matched NOTHING and fell out of the bottom
# returning True. Every conditional rule in the product therefore fired on
# every event of its trigger type, conditions ignored — the same class of
# silent key mismatch as the action configs, one level up.
_OP_ALIASES = {
    "equals": "eq", "eq": "eq", "is": "eq", "=": "eq",
    "not_equals": "neq", "neq": "neq", "ne": "neq", "is_not": "neq", "!=": "neq",
    "in": "in", "one_of": "in",
}


class _Missing:
    """
    'The event does not carry this field at all', which is NOT the same as 'the
    field is null'. Kept distinct because the two need different handling and
    conflating them is how the original filter bug read from the outside.
    """
    def __repr__(self):                       # pragma: no cover - debugging aid
        return "<not carried by this event>"


MISSING = _Missing()


def _resolve_field(field: str, context: dict) -> Any:
    """
    Pure. Maps a builder field name onto the event context. Returns MISSING when
    the event carries no such field.

    The builder offers status / priority / assignee. The context assembled by
    the callers is {"task": {...}, "team_id": ..., "from": old, "to": new} —
    so the original `context.get(field)` returned None for all three of them,
    every time. Fixing the operator vocabulary without fixing this would have
    turned "conditions never match anything" into "conditions never match
    anything" the other way round: rules that fire on nothing instead of on
    everything. Both are silent; only one is obviously wrong from the outside.

    ⚠ THE CONTEXT IS STILL THIN, and this function cannot widen it. server.py
    passes {"task_id", "team_id"} and nothing else; tasks_bulk.py the same plus
    from/to. So `status` resolves on a status_changed event (from `to`) and on
    nothing else, and `priority` resolves nowhere at all. A condition on
    priority is therefore unevaluable — MISSING — and matches_filters refuses to
    fire rather than guessing, with a WARNING naming the field. Making it work
    means the CALLERS passing a fuller task row; until then the rule says so out
    loud instead of quietly never firing.
    """
    task = context.get("task") or {}
    if field == "status" and context.get("to") is not None:
        # On status_changed the meaningful status is the one the task moved TO.
        # server.py passes from/to alongside a task dict it does not re-read,
        # so task["status"] is the value from before the update.
        return context["to"]
    if field in context and field != "task":
        return context[field]
    if field == "assignee":
        # Singular in the builder's wording, plural in the column.
        for key in ("assignee_user_ids", "assignee"):
            if key in task:
                return task[key]
        return MISSING
    return task.get(field, MISSING)


def matches_filters(filters: Any, context: dict) -> bool:
    """
    Pure. AND-only filter evaluation.

    An operator this function does not understand returns False — the rule does
    not fire. That is the deliberate direction: refusing to act on a condition
    you cannot evaluate is recoverable, acting on every event because the
    condition parsed to nothing is what put unwanted comments on tasks.
    """
    if not filters:
        return True
    if not isinstance(filters, list):
        logger.warning("automation filters must be a list, got %s — not firing", type(filters).__name__)
        return False

    for f in filters:
        if not isinstance(f, dict):
            logger.warning("automation filter must be an object, got %s — not firing", type(f).__name__)
            return False
        field = f.get("field")
        raw_op = f.get("op", "eq")
        op = _OP_ALIASES.get(raw_op)
        if op is None:
            logger.warning(
                "automation filter uses unknown operator %r (known: %s) — not firing",
                raw_op, sorted(set(_OP_ALIASES)),
            )
            return False
        want = f.get("value")
        actual = _resolve_field(field, context)

        if actual is MISSING:
            # Do not fire, and say why. Comparing MISSING to the wanted value
            # would silently answer "not equal" for every event — a rule that
            # never fires and never explains itself, which is the same defect
            # this module is being fixed for, pointing the other way.
            logger.warning(
                "automation condition on %r cannot be evaluated: this event carries "
                "no such field (context has %s) — not firing",
                field, sorted(k for k in context if k != "task") + sorted(
                    f"task.{k}" for k in (context.get("task") or {})),
            )
            return False

        if op == "in":
            if actual not in (want or []):
                return False
        elif isinstance(actual, (list, tuple)):
            # assignee_user_ids is an array column. "assignee equals X" can only
            # sensibly mean "X is one of the assignees".
            if op == "eq" and want not in actual:
                return False
            if op == "neq" and want in actual:
                return False
        else:
            if op == "eq" and actual != want:
                return False
            if op == "neq" and actual == want:
                return False
    return True


# Kept under the old private name so any caller that reached past the public
# surface still resolves. The behaviour is the corrected one.
_matches_filters = matches_filters


async def run_automation(automation: dict, context: dict, pool) -> dict:
    """
    Execute all actions of a single automation.

    Returns {"action_results": [...], "ok": bool, "failed": int} — the summary
    is new. `fire_automations` logs it and the /run endpoint hands it to the
    page, because an action that cannot find its config must not be able to
    look like one that worked.
    """
    results = []
    strays: list[list[str]] = []   # parallel to results; see the tail of this function
    for action in automation.get("actions", []) or []:
        action_type = action.get("type") if isinstance(action, dict) else None
        cfg = action.get("config", {}) if isinstance(action, dict) else None

        # THE GATE. Every branch below used to start by defaulting its way past
        # a missing key; none of them can any more.
        problems = config_problems(action_type, cfg)
        stray = unread_config_keys(action_type, cfg)
        strays.append(stray)
        if problems:
            reason = "; ".join(problems)
            logger.warning(
                "automation %s action %r did nothing: %s",
                automation.get("automation_id", "?"), action_type, reason,
            )
            results.append({"action": action_type, "ok": False, "error": reason})
            continue

        # Runnable, but carrying vocabulary this action does not speak. Say so
        # on the result and in the log; do not refuse to run.
        if stray:
            logger.warning(
                "automation %s action %r ignores config keys %s (it reads %s)",
                automation.get("automation_id", "?"), action_type,
                stray, list(ACTION_CONFIG[action_type]["reads"]),
            )

        try:
            if action_type == "send_email":
                to_addr = cfg["to"]
                # Validate recipient is a workspace member to prevent data exfiltration via automation.
                workspace_team = context.get("team_id") or (context.get("task") or {}).get("team_id")
                if workspace_team:
                    is_member = await pool.fetchval(
                        "SELECT 1 FROM users u "
                        "JOIN team_members tm ON tm.user_id = u.user_id "
                        "WHERE u.email=$1 AND tm.team_id=$2 AND tm.status='active'",
                        to_addr, workspace_team,
                    )
                    if not is_member:
                        logger.warning("automation send_email blocked: %s not in team %s", to_addr, workspace_team)
                        results.append({"action": action_type, "ok": False, "error": "recipient not in workspace"})
                        continue
                from email_service import send_email
                # An org-configured automation firing a notification. Named
                # so the row is not 'unclassified' and so it leaves from the
                # notifications address rather than the platform default.
                send_email(to_addr, cfg.get("subject", "Kartavaya notification"),
                           cfg.get("html", ""), purpose="automation")
                results.append({"action": action_type, "ok": True})

            elif action_type == "send_notification":
                import uuid
                task_id = (context.get("task") or {}).get("task_id")
                sent = 0
                for uid in cfg["user_ids"]:
                    await pool.execute(
                        "INSERT INTO notifications (notification_id, user_id, type, title, message, task_id) VALUES ($1,$2,$3,$4,$5,$6)",
                        f"notif_{uuid.uuid4().hex[:12]}", uid,
                        "automation", cfg.get("title", "Automation"),
                        cfg.get("message", ""), task_id
                    )
                    sent += 1
                results.append({"action": action_type, "ok": True, "count": sent})

            elif action_type == "set_field":
                task_id = (context.get("task") or {}).get("task_id")
                if not task_id:
                    results.append({"action": action_type, "ok": False, "error": "no task in event context"})
                    continue
                import json
                await pool.execute(
                    "INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3::jsonb) ON CONFLICT (task_id,field_id) DO UPDATE SET value=EXCLUDED.value",
                    task_id, cfg["field_id"], json.dumps(cfg["value"])
                )
                results.append({"action": action_type, "ok": True})

            elif action_type == "change_status":
                task_id = (context.get("task") or {}).get("task_id")
                if not task_id:
                    results.append({"action": action_type, "ok": False, "error": "no task in event context"})
                    continue
                await pool.execute("UPDATE tasks SET status=$1, updated_at=NOW() WHERE task_id=$2", cfg["status"], task_id)
                results.append({"action": action_type, "ok": True})

            elif action_type == "assign_to":
                task_id = (context.get("task") or {}).get("task_id")
                if not task_id:
                    results.append({"action": action_type, "ok": False, "error": "no task in event context"})
                    continue
                # cfg["user_ids"] is guaranteed non-empty by the gate above, and
                # that guarantee is the point: `assignee_user_ids` is an array
                # column and this statement is an overwrite, so the old
                # cfg.get("user_ids", []) turned a misconfigured rule into an
                # UPDATE that silently UNASSIGNED everyone on the task and then
                # reported success.
                await pool.execute("UPDATE tasks SET assignee_user_ids=$1, updated_at=NOW() WHERE task_id=$2", cfg["user_ids"], task_id)
                results.append({"action": action_type, "ok": True})

            elif action_type == "post_comment":
                import uuid
                task_id = (context.get("task") or {}).get("task_id")
                if not task_id:
                    results.append({"action": action_type, "ok": False, "error": "no task in event context"})
                    continue
                await pool.execute(
                    "INSERT INTO task_comments (comment_id, task_id, user_id, body) VALUES ($1,$2,'system',$3)",
                    f"cmt_{uuid.uuid4().hex[:12]}", task_id, cfg["body"]
                )
                results.append({"action": action_type, "ok": True})

            else:
                # Unreachable while ACTION_CONFIG and the branches agree, and
                # that is exactly why it is here: the original if/elif chain
                # ended without an else, so an action type it did not recognise
                # produced no result row at all — not a failure, not a success,
                # no trace. VALID_ACTIONS in routers/automations.py guards
                # creation, but rows predate validators and the /run endpoint
                # executes whatever is stored.
                results.append({"action": action_type, "ok": False, "error": "no handler for this action type"})

        except Exception as exc:
            logger.warning("automation action %s failed: %s", action_type, exc)
            results.append({"action": action_type, "ok": False, "error": str(exc)})

    # `ignored` is attached here rather than inside each branch because every
    # path above contributes exactly one result per action — including the ones
    # that `continue` — so the two lists line up, and no future branch can
    # forget to carry it. The length check is the seatbelt on that claim.
    if len(results) == len(strays):
        for res, stray in zip(results, strays):
            if stray:
                res["ignored"] = stray

    failed = sum(1 for r in results if not r.get("ok"))
    return {"action_results": results, "ok": failed == 0, "failed": failed}


async def fire_automations(pool, event_type: str, context: dict, _depth: int = 0):
    """
    Called from routers after mutations. Finds matching automations and runs them.
    Non-blocking: swallows all errors.
    _depth guards against infinite recursion when a change_status automation
    triggers another status_changed event (max 3 levels deep).
    """
    if _depth > 3:
        logger.warning("fire_automations: max recursion depth reached, aborting chain")
        return
    try:
        team_id = context.get("team_id") or (context.get("task") or {}).get("team_id")
        if not team_id:
            return
        automations = await pool.fetch(
            "SELECT * FROM automations WHERE team_id=$1 AND enabled=TRUE ORDER BY created_at ASC LIMIT 50",
            team_id
        )
        matched = []
        for auto in automations:
            auto = dict(auto)
            trigger = auto.get("trigger") or {}
            if trigger.get("event") != event_type:
                continue
            if not matches_filters(trigger.get("filters", []), context):
                continue
            matched.append(auto)
            await pool.execute(
                "UPDATE automations SET last_run_at=NOW(), run_count=run_count+1 WHERE automation_id=$1",
                auto["automation_id"]
            )

        if not matched:
            return

        # The results used to be thrown away: `asyncio.create_task(...)` with no
        # reference kept and nothing reading the return value. Every reason an
        # action gave for failing died inside that orphan task. gather() keeps
        # the concurrency — this whole coroutine is already detached by the
        # caller's _bg()/ensure_future, so nothing on a request path waits on it
        # — and gives us something to report.
        outcomes = await asyncio.gather(
            *(run_automation(auto, context, pool) for auto in matched),
            return_exceptions=True,
        )
        for auto, outcome in zip(matched, outcomes):
            if isinstance(outcome, BaseException):
                logger.warning(
                    "automation %s (%s) raised: %s",
                    auto.get("automation_id"), auto.get("name"), outcome,
                )
                continue
            if outcome.get("failed"):
                # WARNING, not DEBUG, and it names the rule: a rule that fires
                # and does nothing is indistinguishable from one that works
                # until someone can read this line.
                logger.warning(
                    "automation %s (%s) fired on %s and %d of %d actions did nothing: %s",
                    auto.get("automation_id"), auto.get("name"), event_type,
                    outcome["failed"], len(outcome["action_results"]),
                    "; ".join(
                        f"{r['action']}: {r['error']}"
                        for r in outcome["action_results"] if not r.get("ok")
                    ),
                )
    except Exception as exc:
        logger.warning("fire_automations swallowed: %s", exc)
