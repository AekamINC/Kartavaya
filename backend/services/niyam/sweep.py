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
# Module level, not inside the functions that use it: a function-local `import
# time` cannot be monkeypatched, so the budget below would be untestable
# without sleeping in a test.
import time

from .engine import DRAIN_LIMIT, process_event, run_pipeline

log = logging.getLogger(__name__)

#: How long a tick may keep STARTING new work. Not a timeout — nothing is
#: interrupted mid-flight — it is the point after which the loop stops picking
#: up the next item and leaves the rest for the next tick, which is fifteen
#: minutes away.
#:
#: Nothing else in the stack bounds a tick. `command_timeout=60` is per
#: STATEMENT; gunicorn's `--timeout 120` does not kill an async request that is
#: awaiting; and uvicorn does not cancel on client disconnect. So a slow tick
#: runs to completion regardless, and the only thing the cron's `curl -m 600`
#: achieves is turning the job red while the work continues invisibly behind it.
#: A budget under that ceiling means a long tick ends by CHOOSING to, with its
#: counts intact and its remainder queued, rather than by being disowned.
TICK_BUDGET_SECONDS = 240

#: How many sleeping runs one tick may wake. Separate ceiling from the drain:
#: a backlog of waits and a backlog of events are different failures and should
#: not be able to starve each other.
RESUME_LIMIT = 100

#: How long a claim may be held before another tick may take the row back.
#: Longer than any plausible tick (the drain is bounded at DRAIN_LIMIT events,
#: each of which is bounded by FANOUT_LIMIT rules) and shorter than the cadence
#: matters less than it being FINITE: the whole point is that a process killed
#: mid-drain releases its claim on a wall clock rather than never.
STALE_CLAIM_MINUTES = 20

_CLAIM_EVENTS = """
SELECT event_id, org_id, event_type, entity_type, entity_id, actor_id, source, payload
  FROM public.niyam_events
 WHERE processed_at IS NULL
   AND (claimed_at IS NULL
        OR claimed_at < NOW() - make_interval(mins => $2::int))
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
UPDATE public.niyam_runs r
   SET wake_at = NULL
  FROM (
        SELECT run_id
          FROM public.niyam_runs
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

    ── CLAIMED IS NOT PROCESSED, AND THE DIFFERENCE IS THE WHOLE FUNCTION ──

    The first version of this stamped `processed_at` in the same transaction
    that selected the batch, and then ran the rules in a loop AFTER that
    transaction committed. Its docstring said that made a crash mid-batch leave
    the events "unclaimed rather than half-done". It did the exact opposite: a
    SIGTERM, redeploy, OOM or gunicorn timeout anywhere in the loop left up to
    DRAIN_LIMIT events marked processed with no run row, and `_CLAIM_EVENTS`
    filters `processed_at IS NULL`, so they could never come back. `/status`
    would then report `events_unprocessed: 0`, which is indistinguishable from
    health.

    The file's own header criticises the task-reminder dispatcher for marking
    "the whole batch sent before the first send is attempted". This function was
    written sixty lines below that sentence and did the same thing.

    So there are two marks now. `claimed_at` says a tick has taken the row and
    is trying; it is stamped in the claiming transaction and it EXPIRES, so a
    dead process releases its work. `processed_at` says a rule pipeline actually
    ran for that event, and it is stamped one event at a time, after the fact.
    A replay is safe because the run rows are idempotent on (rule_id, event_id).
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(_CLAIM_EVENTS, limit, STALE_CLAIM_MINUTES)
            if rows:
                # `claimed_at = NOW()` unconditionally, not COALESCE: re-claiming
                # a row whose previous holder died must restart ITS clock, or a
                # row claimed once at 09:00 stays permanently re-claimable and
                # two ticks can fight over it for ever.
                await conn.execute(
                    "UPDATE public.niyam_events SET claimed_at = NOW() "
                    "WHERE event_id = ANY($1::bigint[])",
                    [r["event_id"] for r in rows])
            events = [dict(r) for r in rows]

    deadline = time.monotonic() + TICK_BUDGET_SECONDS

    runs, errors, deferred = 0, 0, 0
    for i, event in enumerate(events):
        if time.monotonic() > deadline:
            # Claimed but not processed. `claimed_at` expires after
            # STALE_CLAIM_MINUTES, so these come back on their own — the same
            # path a killed process uses, which is one recovery mechanism rather
            # than two.
            #
            # `enumerate`, not `events.index(event)`: two events can compare
            # equal as dicts, and `.index` would return the FIRST of them and
            # over-count what was left undone.
            deferred = len(events) - i
            log.warning("niyam: tick budget spent — deferring %d event(s) to the "
                        "next tick", deferred)
            break
        payload = event.get("payload")
        if isinstance(payload, str):
            import json
            event["payload"] = json.loads(payload)
        try:
            results = await process_event(pool, event, now=now)
            runs += sum(1 for r in results if r.get("run_id"))
            errors += sum(1 for r in results if r.get("result") == "error")
        except Exception:
            # A single event must never end the tick. It is still marked
            # processed below: the failure is recorded, and replaying an event
            # whose rules already raised would raise again every tick for ever.
            log.exception("niyam: event %s could not be processed", event.get("event_id"))
            errors += 1
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE public.niyam_events SET processed_at = NOW() "
                "WHERE event_id = $1::bigint", event["event_id"])

    # `events_drained` counts what was actually PROCESSED, not what was claimed.
    # Reporting the claim would make a budget-limited tick look like a full one.
    return {"events_drained": len(events) - deferred, "runs_started": runs,
            "errors": errors, "events_deferred": deferred}


#: Runs that no path can reach. A run is normally either FINISHED
#: (finished_at set), ASLEEP (wake_at set, picked up by _RESUME), or in flight
#: inside a live process. The fourth state — finished_at NULL and wake_at NULL —
#: is a run whose process died between claiming it and completing it, and
#: nothing selects it: _RESUME requires `wake_at IS NOT NULL`, and a fresh claim
#: is refused by the UNIQUE (rule_id, event_id) constraint the claim relies on.
#:
#: It matters MORE now that the drain replays events properly. Without this, the
#: drain fix converts a lost event into a lost run: the event comes back, calls
#: claim(), collides with the half-finished run's own row, records
#: "already_claimed", and the pipeline never completes. The loss just moves.
#:
#: Resuming is safe with no extra machinery because `run_pipeline` reads
#: `cursor_for` and skips every step that already recorded an outcome — a
#: resume-from-cursor that was built for exactly this and had no caller.
_REAP_STRANDED = """
UPDATE public.niyam_runs r
   SET wake_at = NULL
  FROM (
        SELECT run_id
          FROM public.niyam_runs
         WHERE finished_at IS NULL
           AND wake_at IS NULL
           AND started_at < NOW() - make_interval(mins => $2::int)
         ORDER BY started_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1::int
       ) stuck
 WHERE r.run_id = stuck.run_id
RETURNING r.run_id, r.rule_id, r.event_id, r.dry_run
"""


async def resume_waits(pool, *, limit: int = RESUME_LIMIT, now=None) -> dict:
    """Wake runs whose wait has elapsed, and rescue runs nothing else can reach.

    Two selectors, one loop. The first is the ordinary wait: a run asked to sleep
    and its time has come. The second is a run that was in flight when its
    process died — see `_REAP_STRANDED`. They are processed identically because
    resuming is idempotent, so there is nothing to gain from telling them apart
    after the row is in hand.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            woken = [dict(r) for r in await conn.fetch(_RESUME, limit)]
        async with conn.transaction():
            stranded = [dict(r) for r in
                        await conn.fetch(_REAP_STRANDED, limit, STALE_CLAIM_MINUTES)]
    if stranded:
        # Loud, because this is the footprint of a process dying mid-pipeline.
        # One is a redeploy at the wrong moment; a steady trickle is a crash.
        log.warning("niyam: reaped %d run(s) stranded by a dead process", len(stranded))
    woken = woken + stranded

    deadline = time.monotonic() + TICK_BUDGET_SECONDS

    resumed, errors = 0, 0
    for run in woken:
        if time.monotonic() > deadline:
            # A run whose wake_at was cleared but which never ran is exactly the
            # stranded shape `_REAP_STRANDED` exists for, so it is recovered by
            # the reaper on a later tick rather than lost.
            log.warning("niyam: tick budget spent — %d run(s) left for the reaper",
                        len(woken) - resumed - errors)
            break
        try:
            async with pool.acquire() as conn:
                event = await conn.fetchrow(
                    "SELECT event_id, org_id, event_type, entity_type, entity_id, "
                    "       actor_id, source, payload "
                    "  FROM public.niyam_events WHERE event_id = $1::bigint",
                    run["event_id"])
                if event is None:
                    # The event aged out from under a long wait. The run is
                    # finished honestly rather than left asleep for ever.
                    await conn.execute(
                        "UPDATE public.niyam_runs SET finished_at = NOW() "
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

    return {"waits_resumed": resumed, "runs_reaped": len(stranded), "errors": errors}


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
            SELECT (SELECT count(*) FROM public.niyam_events)                        AS events_total,
                   (SELECT count(*) FROM public.niyam_events WHERE processed_at IS NULL)
                                                                                      AS events_unprocessed,
                   (SELECT max(occurred_at) FROM public.niyam_events)                AS last_event_at,
                   (SELECT count(*) FROM public.niyam_rules WHERE enabled)           AS rules_enabled,
                   (SELECT count(*) FROM public.niyam_rules WHERE enabled AND is_armed)
                                                                                      AS rules_armed,
                   (SELECT count(*) FROM public.niyam_runs
                     WHERE started_at > NOW() - INTERVAL '24 hours')                  AS runs_last_24h,
                   (SELECT count(*) FROM public.niyam_runs
                     WHERE wake_at IS NOT NULL AND finished_at IS NULL)               AS runs_waiting,
                   -- The heartbeat. Without it every count above reads the same
                   -- whether the engine is quiet or the cron has not fired in
                   -- three days.
                   (SELECT tick_ended_at   FROM public.niyam_engine_tick WHERE id)   AS last_tick_at,
                   (SELECT tick_started_at FROM public.niyam_engine_tick WHERE id)   AS tick_running_since,
                   (SELECT last_result     FROM public.niyam_engine_tick WHERE id)   AS last_tick_result,
                   -- Runs no path can reach. Should be 0; a non-zero that does
                   -- not fall is a process dying mid-pipeline every tick.
                   (SELECT count(*) FROM public.niyam_runs
                     WHERE finished_at IS NULL AND wake_at IS NULL
                       AND started_at < NOW() - INTERVAL '20 minutes')                AS runs_stranded
        """)
    out = dict(row) if row else {}
    out["flags"] = describe()
    # What the time triggers would find RIGHT NOW, so "no time rule has fired"
    # can be told apart from "no predicate matches anything". Names only; the
    # counts come from the last tick's report.
    from .predicates import PREDICATES
    out["predicates"] = [{"name": p.name, "label": p.label, "window": p.window,
                          "max_age_days": p.max_age_days} for p in PREDICATES]
    # Every timestamp, not just the first one somebody remembered. A datetime
    # left in here is a 500 from FastAPI's encoder at the moment an operator is
    # trying to find out why nothing is happening — the worst possible time.
    for key in ("last_event_at", "last_tick_at", "tick_running_since"):
        if out.get(key) is not None:
            out[key] = out[key].isoformat()
    if isinstance(out.get("last_tick_result"), str):
        import json
        try:
            out["last_tick_result"] = json.loads(out["last_tick_result"])
        except ValueError:                                  # pragma: no cover
            pass
    return out


async def tick(pool, *, now=None) -> dict:
    """One sweep: ASK, then drain, then resume. The order is deliberate.

    The temporal predicates run FIRST so that a boundary crossed since the last
    tick becomes an event and is drained in the same tick — otherwise every time
    rule is a full tick later than it needs to be, and at a 15-minute cadence
    that is a 15-minute lie in "notify me when a task goes overdue".

    Draining before resuming, for the mirror-image reason: an event that arrives
    and immediately hits a `wait` gets its wait started now, and a wait resumed
    first would not have seen events from this same tick anyway.
    """
    import datetime as _dt
    moment = now or _dt.datetime.now(_dt.timezone.utc)

    if not await _claim_tick(pool):
        # Not an error. Railway skips a cron run whose predecessor is still
        # going, but nothing stops a hand-run sweep landing on top of a
        # scheduled one, and a second concurrent tick would double the predicate
        # queries for no benefit. Answering 200 keeps the cron green, because
        # "somebody else is already doing it" is not a failure.
        log.info("niyam: a tick is already running — skipping this one")
        return {"skipped": "a tick was already running", "predicates": {},
                "metric_alerts": {},
                "events_drained": 0, "runs_started": 0, "waits_resumed": 0,
                "runs_reaped": 0, "errors": 0}

    result = None
    try:
        from .predicates import run_all
        asked = await run_all(pool, now=moment)
        # Metric alerts ask their question the same way the predicates ask
        # theirs, in the same tick, for the same reason: a breach crossed
        # since the last tick becomes an event drained in THIS tick. A
        # failure inside is counted, never raised — one broken alert must
        # not stop the sweep.
        try:
            from .metric_alerts import run_alerts
            alerts = await run_alerts(pool, now=moment)
        except Exception:
            log.exception("niyam: the metric-alert pass failed entirely")
            alerts = {"error": True}
        drained = await drain(pool, now=now)
        resumed = await resume_waits(pool, now=now)

        result = {
            # Reported separately and never summed. "Found 50, emitted 0" is CORRECT
            # once a window has already fired this period, and is indistinguishable
            # from a broken emitter unless the two are counted apart — which is the
            # whole lesson of 331 reminders that recorded `sent` and left nothing.
            "predicates": asked["predicates"], "metric_alerts": alerts,
            **drained,
            **{k: v for k, v in resumed.items() if k != "errors"},
            "errors": drained["errors"] + resumed["errors"] + asked["errors"],
        }
    finally:
        # In a `finally` so a raising tick releases its claim immediately rather
        # than blocking the engine for STALE_CLAIM_MINUTES. The expiry is the
        # backstop for a process that dies outright and never reaches here.
        await _release_tick(pool, result=result)
    return result


async def _claim_tick(pool) -> bool:
    """Take the single-row tick claim, or report that somebody else holds it.

    A claimed ROW, not `pg_try_advisory_lock`: migration 144's header explains
    why an advisory lock would eventually wedge this engine permanently under
    Supabase's transaction pooler.
    """
    async with pool.acquire() as conn:
        got = await conn.fetchval(
            """
            UPDATE public.niyam_engine_tick
               SET tick_started_at = NOW()
             WHERE id = TRUE
               AND (tick_started_at IS NULL
                    OR tick_started_at < NOW() - make_interval(mins => $1::int))
            RETURNING TRUE
            """, STALE_CLAIM_MINUTES)
    return bool(got)


async def _release_tick(pool, *, result=None) -> None:
    """Clear the claim and record the heartbeat. Never raises.

    `tick_ended_at` is the thing `/status` reports, and it is set only on a tick
    that got this far — which is exactly what makes "nothing happened" tell
    itself apart from "nothing ran".
    """
    import json
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE public.niyam_engine_tick
                   SET tick_started_at = NULL,
                       tick_ended_at   = NOW(),
                       last_result     = COALESCE($1::jsonb, last_result)
                 WHERE id = TRUE
                """, json.dumps(result) if result is not None else None)
    except Exception:
        # A failure here would strand the claim until it expires, which is
        # survivable; failing the whole tick over bookkeeping is not.
        log.exception("niyam: could not record the tick heartbeat")
