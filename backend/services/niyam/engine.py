"""Claiming an event, and running one rule's pipeline against it.

── WHY THE CLAIM IS ITS OWN TRANSACTION ────────────────────────────────────

Idempotency is claim-by-insert: `INSERT … ON CONFLICT (rule_id, event_id) DO
NOTHING RETURNING run_id`. One worker gets a row back, everyone else gets none
and moves on, and a redeploy mid-drain replays safely because the winner's row
is already there.

The part that is easy to get wrong: a LOSING claimant does not fail fast — it
BLOCKS on the winner's uncommitted row until that transaction ends. So if the
winner executes the rule's actions inside the same transaction that claimed it,
every other worker racing that pair sits holding a pooled server connection,
idle, for the whole duration of the actions. `db.py` runs `max_size=10` with
`command_timeout=60`, and PgBouncer pins a server connection for the life of a
transaction, so that is a small number of slots consumed by workers doing
nothing, and then a wave of timeouts.

So the claim COMMITS before any step runs. The run row exists, unfinished, and
the steps are written against it afterwards.

── WHY A RUN IS RECORDED EVEN WHEN NOTHING HAPPENS ─────────────────────────

A rule that evaluated and did not match is the normal case, and it is also the
single most-asked question about any automation product: "why did my rule not
fire?" The old engine answered it into a server log, on a rule the UI showed as
Active. Here every evaluation writes a run and a step carrying the values that
were compared, so the answer is a row.

── DRY IS A REAL RUN ───────────────────────────────────────────────────────

An unarmed rule is not skipped. It claims, evaluates its conditions for real
against a real event, and records `dry` for each action it would have taken.
That is the only way to see a rule before trusting it, and it is what makes the
first weeks of Niyam safe. `dry_run` is stamped on the RUN, not re-derived from
the flag later — the master switch can be flipped between one run and the next,
and "was this dry?" must stay answerable months afterwards.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Optional

from .actions import ACTIONS, ActionResult
from .conditions import evaluate
from .flags import rule_effective_mode

log = logging.getLogger(__name__)

#: How many events one tick may drain, and how many rules one event may fan out
#: to. Per-tick ceilings, oldest-first, next-tick-is-the-retry — the shape of
#: `/cron/marketing`, the one loop in the estate being replaced that was built
#: properly. A ceiling is what stops a stalled queue becoming a thundering herd
#: the moment it recovers.
DRAIN_LIMIT = 200
FANOUT_LIMIT = 25

_CLAIM = """
INSERT INTO staging.niyam_runs (run_id, rule_id, event_id, org_id, dry_run)
VALUES ($1::text, $2::text, $3::bigint, $4::uuid, $5::boolean)
ON CONFLICT (rule_id, event_id) DO NOTHING
RETURNING run_id
"""

_RECORD_STEP = """
INSERT INTO staging.niyam_run_steps
    (run_step_id, run_id, step_no, outcome, detail, outbound_id)
VALUES ($1::text, $2::text, $3::int, $4::text, $5::jsonb, $6::bigint)
ON CONFLICT (run_id, step_no) DO NOTHING
"""


def _rid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


async def rules_for(conn, *, org_id: str, event_type: str) -> list:
    """Enabled rules in this org that trigger on this event type.

    `enabled` only — arming is a per-rule property read later, because an
    unarmed rule still runs. Ordered so a fan-out ceiling cuts deterministically
    rather than arbitrarily.
    """
    return await conn.fetch(
        """
        SELECT rule_id, name, is_armed
          FROM staging.niyam_rules
         WHERE org_id = $1::uuid AND event_type = $2::text AND enabled
         ORDER BY created_at, rule_id
         LIMIT $3::int
        """,
        org_id, event_type, FANOUT_LIMIT,
    )


async def steps_for(conn, rule_id: str) -> list:
    return await conn.fetch(
        """
        SELECT step_no, kind, config
          FROM staging.niyam_rule_steps
         WHERE rule_id = $1::text
         ORDER BY step_no
        """,
        rule_id,
    )


async def claim(conn, *, rule_id: str, event_id: int, org_id: str,
                dry_run: bool) -> Optional[str]:
    """Win the right to run this rule against this event, or return None.

    MUST be called in its own short transaction — see the module header. None
    means somebody else has it, which is a normal outcome and not an error.
    """
    run_id = _rid("run")
    got = await conn.fetchval(_CLAIM, run_id, rule_id, event_id, org_id, dry_run)
    return got


async def _record(conn, *, run_id: str, step_no: int, outcome: str,
                  detail: dict, outbound_id: Optional[int] = None) -> None:
    await conn.execute(_RECORD_STEP, _rid("rs"), run_id, step_no, outcome,
                       json.dumps(_jsonable(detail)), outbound_id)


def _jsonable(d: Any) -> dict:
    """Render a verdict's detail for JSONB without letting it raise.

    A verdict carries whatever was compared, and that came from a payload, so it
    is already scalar — but a run step must never be the reason a drain tick
    dies, so anything surprising is stringified rather than trusted.
    """
    out = {}
    for k, v in (d or {}).items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, (list, tuple)):
            out[k] = [x if isinstance(x, (str, int, float, bool)) or x is None else str(x)
                      for x in v]
        else:
            out[k] = str(v)
    return out


async def cursor_for(conn, run_id: str) -> set:
    """Step numbers already recorded for this run.

    The resume cursor. It is only correct because `niyam_run_steps` carries
    `UNIQUE (run_id, step_no)` — deriving "the first step with no row" from a
    table where a step could produce two rows would silently double-count after
    a double-resume.
    """
    rows = await conn.fetch(
        "SELECT step_no FROM staging.niyam_run_steps WHERE run_id = $1::text",
        run_id,
    )
    return {r["step_no"] for r in rows}


async def run_pipeline(conn, *, run_id: str, rule_id: str, event: dict,
                       dry_run: bool, now=None) -> str:
    """Execute a rule's steps against one event. Returns why it stopped.

    Not transactional across steps, deliberately. Each step records its own
    outcome as it completes, so a process that dies mid-pipeline leaves a run
    that says exactly how far it got. Wrapping the pipeline in one transaction
    would roll the history back to nothing and lose precisely the information
    somebody would need to work out what happened.
    """
    payload = event.get("payload") or {}
    event_type = event.get("event_type")
    done = await cursor_for(conn, run_id)

    for step in await steps_for(conn, rule_id):
        step_no, kind, config = step["step_no"], step["kind"], step["config"]
        if step_no in done:
            continue                       # already ran, before a wait or a crash
        if isinstance(config, str):
            config = json.loads(config)    # asyncpg hands JSONB back either way

        if kind == "condition":
            v = evaluate(payload, event_type, config, now=now)
            await _record(conn, run_id=run_id, step_no=step_no,
                          outcome=v.outcome, detail={**v.detail, "reason": v.reason})
            if v.outcome != "ok":
                await _finish(conn, run_id)
                return v.outcome
            continue

        if kind == "wait":
            # A wait is a column on the run, not a table and not a sleep. The
            # engine stops here; the sweep resumes runs whose time has come.
            minutes = config.get("minutes")
            if not isinstance(minutes, (int, float)) or minutes <= 0:
                await _record(conn, run_id=run_id, step_no=step_no, outcome="failed",
                              detail={"reason": "a wait needs a positive `minutes`",
                                      "config": config})
                await _finish(conn, run_id)
                return "failed"
            await conn.execute(
                "UPDATE staging.niyam_runs SET wake_at = NOW() + ($1::int * INTERVAL '1 minute') "
                "WHERE run_id = $2::text",
                int(minutes), run_id)
            # NO run step row is written for the wait itself — the cursor is
            # "steps that have completed", and a wait that has not resumed has
            # not completed. Writing one here would make the resume skip it.
            return "waiting"

        if kind == "action":
            verb = (config or {}).get("verb")
            handler = ACTIONS.get(verb)
            if handler is None:
                # The allowlist is closed. An unknown verb is a rule referring
                # to something this build cannot do — a stored rule outliving
                # its action, or an action removed on purpose.
                await _record(conn, run_id=run_id, step_no=step_no, outcome="failed",
                              detail={"reason": f"`{verb}` is not an allowed action",
                                      "allowed": sorted(ACTIONS)})
                await _finish(conn, run_id)
                return "failed"

            if dry_run:
                # The whole point of an unarmed rule: say what WOULD have
                # happened, in the same shape as the real outcome, without
                # touching anything.
                preview = handler.describe(config, event)
                await _record(conn, run_id=run_id, step_no=step_no, outcome="dry",
                              detail={"verb": verb, "would": preview})
                continue

            try:
                result: ActionResult = await handler.run(conn, config=config, event=event)
            except Exception as exc:              # one bad action must not kill the drain
                log.exception("niyam: action %r failed in run %s", verb, run_id)
                await _record(conn, run_id=run_id, step_no=step_no, outcome="failed",
                              detail={"verb": verb, "error": f"{type(exc).__name__}: {exc}"})
                await _finish(conn, run_id)
                return "failed"

            await _record(conn, run_id=run_id, step_no=step_no,
                          outcome=result.outcome,
                          detail={"verb": verb, **result.detail},
                          outbound_id=result.outbound_id)
            if result.outcome == "failed":
                await _finish(conn, run_id)
                return "failed"
            continue

        await _record(conn, run_id=run_id, step_no=step_no, outcome="failed",
                      detail={"reason": f"unknown step kind `{kind}`"})
        await _finish(conn, run_id)
        return "failed"

    await _finish(conn, run_id)
    return "ok"


async def _finish(conn, run_id: str) -> None:
    await conn.execute(
        "UPDATE staging.niyam_runs SET finished_at = NOW(), wake_at = NULL "
        "WHERE run_id = $1::text AND finished_at IS NULL",
        run_id)


async def process_event(pool, event: dict, *, now=None) -> list:
    """Fan one event out to every rule that wants it. Returns per-rule outcomes.

    Errors are contained PER RULE. One org's broken rule must not stop another
    org's working one, and there is deliberately no transaction spanning rules —
    the same reasoning `scheduler.py`'s fan-out helpers record: the failure
    count is a signal to a human, not a transaction boundary.
    """
    out = []
    async with pool.acquire() as conn:
        rules = await rules_for(conn, org_id=str(event["org_id"]),
                                event_type=event["event_type"])

    for rule in rules:
        dry = rule_effective_mode(rule["is_armed"]) == "dry"
        try:
            # The claim, alone, committed before any step runs.
            async with pool.acquire() as conn:
                async with conn.transaction():
                    run_id = await claim(conn, rule_id=rule["rule_id"],
                                         event_id=event["event_id"],
                                         org_id=str(event["org_id"]), dry_run=dry)
            if run_id is None:
                out.append({"rule_id": rule["rule_id"], "result": "already_claimed"})
                continue

            async with pool.acquire() as conn:
                result = await run_pipeline(conn, run_id=run_id,
                                            rule_id=rule["rule_id"], event=event,
                                            dry_run=dry, now=now)
            out.append({"rule_id": rule["rule_id"], "run_id": run_id,
                        "result": result, "dry_run": dry})
        except Exception as exc:
            log.exception("niyam: rule %s failed on event %s",
                          rule["rule_id"], event.get("event_id"))
            out.append({"rule_id": rule["rule_id"], "result": "error",
                        "error": f"{type(exc).__name__}: {exc}"})
    return out
