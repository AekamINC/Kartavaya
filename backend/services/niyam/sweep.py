"""One tick: drain the outbox, then resume the waits whose time has come.

── WHY A POLL AND NOT LISTEN/NOTIFY ────────────────────────────────────────

PgBouncer transaction pooling. `NOTIFY` is documented as not working through it
in three places in this codebase already. A poll is also what makes a redeploy
mid-drain safe: unclaimed rows are simply still there.

── THE SHAPE IS COPIED DELIBERATELY ────────────────────────────────────────

Per-tick ceilings on rows and fan-out, oldest-first, next-tick-is-the-retry.
That is `/cron/marketing`, the only loop in the estate being replaced that was
built properly. The counter-example is in the same repo: the armed task-reminder
dispatcher claims EVERY due row with no LIMIT and no ORDER BY and marks the
whole batch sent before the first send is attempted, so one tick after a stall
fans out the entire backlog.

`FOR UPDATE SKIP LOCKED` in one transaction, so it works under transaction
pooling and two workers never take the same row.

── AN EMPTY TICK IS SUCCESS ────────────────────────────────────────────────

`scheduler.py`'s helpers make this explicit and it matters more here than
anywhere: "that is what distinguishes 'nothing to do' from 'could not do it',
and conflating them is how a real failure gets ignored". The Railway cron loops
turn any non-200 red, so a tick that drained nothing must answer 200 — and the
BODY must carry the counts, because a green cron over an empty queue is
indistinguishable from a green cron over a broken drain query. That is the
single most likely way this engine ships and silently does nothing, so the
counts are the thing to watch, not the status code.
"""
from __future__ import annotations

import logging

from .engine import DRAIN_LIMIT, process_event, run_pipeline

log = logging.getLogger(__name__)

#: How many sleeping runs one tick may wake. Separate ceiling from the drain:
#: a backlog of waits and a backlog of events are different failures and should
#: not be able to starve each other.
RESUME_LIMIT = 100

_CLAIM_EVENTS = """
SELECT event_id, org_id, event_type, entity_type, entity_id, actor_id, source, payload
  FROM staging.niyam_events
 WHERE processed_at IS NULL
 ORDER BY event_id
 FOR UPDATE SKIP LOCKED
 LIMIT $1::int
"""

#: Resume is a conditional UPDATE that clears `wake_at` in the SAME statement
#: that claims the run — NOT a second claim-by-insert. The (rule_id, event_id)
#: key is already consumed by the original claim, so an INSERT … ON CONFLICT DO
#: NOTHING would conflict with the run's own row, return nothing, and drop the
#: wait for ever.
#:
#: The `wake_at IS NOT NULL` in the outer WHERE is re-checked AFTER the row lock
#: is taken. That is what stops two ticks resuming one wait: the loser's row has
#: already had wake_at cleared by the time it gets the lock, so it updates
#: nothing.
_RESUME = """
UPDATE staging.niyam_runs r
   SET wake_at = NULL
  FROM (
        SELECT run_id
          FROM staging.niyam_runs
         WHERE wake_at IS NOT NULL AND wake_at <= NOW() AND finished_at IS NULL
         ORDER BY wake_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1::int
       ) due
 WHERE r.run_id = due.run_id AND r.wake_at IS NOT NULL
RETURNING r.run_id, r.rule_id, r.event_id, r.dry_run
"""


async def drain(pool, *, limit: int = DRAIN_LIMIT, now=None) -> dict:
    """Claim a batch of unprocessed events and run every rule that wants them.

    Events are marked processed in the SAME transaction that claims them, so a
    crash mid-batch leaves them unclaimed rather than half-done — and the run
    rows are idempotent by (rule_id, event_id) anyway, so a replay cannot
    double-fire.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(_CLAIM_EVENTS, limit)
            if rows:
                await conn.execute(
                    "UPDATE staging.niyam_events SET processed_at = NOW(), "
                    "claimed_at = COALESCE(claimed_at, NOW()) "
                    "WHERE event_id = ANY($1::bigint[])",
                    [r["event_id"] for r in rows])
            events = [dict(r) for r in rows]

    runs, errors = 0, 0
    for event in events:
        payload = event.get("payload")
        if isinstance(payload, str):
            import json
            event["payload"] = json.loads(payload)
        try:
            results = await process_event(pool, event, now=now)
            runs += sum(1 for r in results if r.get("run_id"))
            errors += sum(1 for r in results if r.get("result") == "error")
        except Exception:
            # A single event must never end the tick — the rest of the batch is
            # already claimed and would otherwise sit processed-but-unrun.
            log.exception("niyam: event %s could not be processed", event.get("event_id"))
            errors += 1

    return {"events_drained": len(events), "runs_started": runs, "errors": errors}


async def resume_waits(pool, *, limit: int = RESUME_LIMIT, now=None) -> dict:
    """Wake runs whose wait has elapsed and continue their pipelines."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            woken = [dict(r) for r in await conn.fetch(_RESUME, limit)]

    resumed, errors = 0, 0
    for run in woken:
        try:
            async with pool.acquire() as conn:
                event = await conn.fetchrow(
                    "SELECT event_id, org_id, event_type, entity_type, entity_id, "
                    "       actor_id, source, payload "
                    "  FROM staging.niyam_events WHERE event_id = $1::bigint",
                    run["event_id"])
                if event is None:
                    # The event aged out from under a long wait. The run is
                    # finished honestly rather than left asleep for ever.
                    await conn.execute(
                        "UPDATE staging.niyam_runs SET finished_at = NOW() "
                        "WHERE run_id = $1::text", run["run_id"])
                    continue
                ev = dict(event)
                if isinstance(ev.get("payload"), str):
                    import json
                    ev["payload"] = json.loads(ev["payload"])
                await run_pipeline(conn, run_id=run["run_id"],
                                   rule_id=run["rule_id"], event=ev,
                                   dry_run=run["dry_run"], now=now)
            resumed += 1
        except Exception:
            log.exception("niyam: run %s could not be resumed", run["run_id"])
            errors += 1

    return {"waits_resumed": resumed, "errors": errors}


async def status(pool) -> dict:
    """What the engine can see, for the endpoint a human reads at 2am.

    This exists because of a specific, named failure mode: a sweep draining an
    empty outbox returns 200, `flags.describe()` correctly reports "everything
    is dry", and zero run rows is exactly what a healthy unarmed engine looks
    like. Green cron plus correct-looking status plus nothing happening is
    INDISTINGUISHABLE from a drain query that never matches — which is the
    331-suppressed-reminders disease rebuilt on new tables.

    So the counts ship beside the flags. "Is it working?" is answered by
    `events_unprocessed` falling and `runs_last_24h` rising, never by a 200.
    """
    from .flags import describe
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT (SELECT count(*) FROM staging.niyam_events)                        AS events_total,
                   (SELECT count(*) FROM staging.niyam_events WHERE processed_at IS NULL)
                                                                                      AS events_unprocessed,
                   (SELECT max(occurred_at) FROM staging.niyam_events)                AS last_event_at,
                   (SELECT count(*) FROM staging.niyam_rules WHERE enabled)           AS rules_enabled,
                   (SELECT count(*) FROM staging.niyam_rules WHERE enabled AND is_armed)
                                                                                      AS rules_armed,
                   (SELECT count(*) FROM staging.niyam_runs
                     WHERE started_at > NOW() - INTERVAL '24 hours')                  AS runs_last_24h,
                   (SELECT count(*) FROM staging.niyam_runs
                     WHERE wake_at IS NOT NULL AND finished_at IS NULL)               AS runs_waiting
        """)
    out = dict(row) if row else {}
    out["flags"] = describe()
    if out.get("last_event_at") is not None:
        out["last_event_at"] = out["last_event_at"].isoformat()
    return out


async def tick(pool, *, now=None) -> dict:
    """One sweep. Drain, then resume — in that order, deliberately.

    Draining first means an event that arrives and immediately hits a `wait`
    gets its wait started this tick rather than next, and a wait resumed first
    would never see events that arrived during the same tick anyway.
    """
    drained = await drain(pool, now=now)
    resumed = await resume_waits(pool, now=now)
    return {**drained, **{k: v for k, v in resumed.items() if k != "errors"},
            "errors": drained["errors"] + resumed["errors"]}
