-- 144_niyam_engine_tick.sql
--
-- ONE ROW THAT ANSWERS TWO QUESTIONS: "is a tick running?" and "when did one
-- last finish?"
--
-- ── WHY THIS EXISTS BEFORE THE CRON DOES ────────────────────────────────────
--
-- `/api/internal/niyam/status` currently returns events_unprocessed, rules_armed
-- and runs_last_24h, and NO timestamp of its own. So this reading:
--
--     events_unprocessed: 0, runs_last_24h: 0
--
-- is simultaneously what "healthy and quiet", "the drain dropped a batch" and
-- "the cron has not fired since Tuesday" look like. status()'s own docstring
-- promises to answer "why is nothing happening" and cannot, and this estate has
-- the receipts: cron-hourly's config lists three paths and its running container
-- has only ever executed two, so /api/internal/cron/leads has never once run and
-- the cron has been green throughout.
--
-- A heartbeat is the difference between "nothing happened" and "nothing ran".
--
-- ── WHY IT IS ALSO THE OVERLAP GUARD, AND NOT AN ADVISORY LOCK ──────────────
--
-- The obvious primitive is pg_try_advisory_lock. It would be an outage here.
-- The DSN is Supabase's TRANSACTION-mode pooler on 6543 — `db.py` sets
-- `statement_cache_size=0` for exactly that reason. A session-scoped advisory
-- lock is taken on whatever server connection PgBouncer hands out, cannot be
-- reliably released, and survives in the pool: every later tick would skip, for
-- ever. The transaction-scoped variant cannot span a tick() that makes many
-- separate `pool.acquire()` calls. There is no advisory lock anywhere in this
-- codebase to establish otherwise.
--
-- A claimed ROW works under transaction pooling because it is just a row: the
-- claim commits, the release commits, and a claim abandoned by a dead process
-- ages out on a wall clock rather than on a connection's lifetime.
--
-- ── SIDE EFFECTS ────────────────────────────────────────────────────────────
--
-- Creates one table and inserts one row. Touches no existing table, takes no
-- lock anything else contends for, and reads nothing. Production runs `main`,
-- which contains no reference to this table, so it is inert there even though
-- the database is shared. Reversible with DROP TABLE.

CREATE TABLE IF NOT EXISTS staging.niyam_engine_tick (
    -- The single-row idiom: a boolean primary key with a CHECK that it is TRUE
    -- makes a second row impossible at the schema level rather than by
    -- convention. A guard table that can grow a second row is not a guard.
    id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

    -- Non-NULL means a tick claims to be running. Cleared in a `finally`, and
    -- aged out by the claim query so a killed process cannot wedge the engine.
    tick_started_at TIMESTAMPTZ,

    -- The heartbeat proper: when a tick last COMPLETED. A tick that starts and
    -- dies never sets this, which is the distinction the whole table is for.
    tick_ended_at   TIMESTAMPTZ,

    -- The last completed tick's counts, verbatim. `/status` can then answer
    -- "what did the last run actually do" without anyone opening Railway's log
    -- viewer — and the counts, not the status code, are the signal (sweep.py's
    -- header says why at length).
    last_result     JSONB
);

INSERT INTO staging.niyam_engine_tick (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;
