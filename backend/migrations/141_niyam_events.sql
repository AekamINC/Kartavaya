-- 141_niyam_events.sql — the automation event outbox.
--
-- Step N3 of the Niyam build (docs/proposals/55-niyam-automation.html §3).
-- N0 (the off switch) and N1 (the demolition) are already in. Nothing consumes
-- this table yet and nothing may: the engine is N4. This migration exists so
-- that a WEEK OF REAL EVENTS accumulates before the first rule is written
-- against them — the plan's exit condition for N3, and the only way to design
-- conditions against what the product actually emits rather than what its old
-- builder claimed it did.
--
-- ── WHY AN OUTBOX AND NOT A ROW TRIGGER ─────────────────────────────────────
--
-- The obvious implementation is an AFTER INSERT OR UPDATE trigger on each
-- business table. Two facts about THIS database rule it out, and both were
-- measured rather than assumed:
--
--  1. Staging and production share one Supabase Postgres, and production runs
--     `main` — over a thousand commits behind. A trigger is a property of the
--     TABLE, not of the deployment, so production would fire it too: blind, with
--     no actor, and from code that has never heard of Niyam. Events would arrive
--     that no rule author could explain and no reader could attribute.
--  2. PgBouncer runs transaction pooling on :6543. `SET LOCAL`, session GUCs and
--     `current_setting()` do not survive to a trigger — the app cannot hand a
--     trigger the actor even if it wanted to. `db.py` already treats its own
--     `SET search_path` as best-effort for this reason.
--
-- So events are written by the APPLICATION, in the same transaction as the
-- business write, with actor and source as ordinary columns the writer fills.
-- The event exists if and only if the change committed; no dual-write, no
-- reconciliation job, no "the row changed but the event is missing" class of
-- bug. `services/niyam/emit.py` is the only writer.
--
-- ── AND WHY NOT LISTEN/NOTIFY ───────────────────────────────────────────────
--
-- Same pooler. `NOTIFY` is documented as not working through transaction
-- pooling in three places in this codebase already (routers/messaging.py twice,
-- migration 093). The drain is a poll — `services/niyam/sweep.py` at N4 — which
-- is also what makes a redeploy mid-drain safe: unclaimed rows are simply still
-- there.
--
-- ── WHY THE FOREIGN KEY CROSSES SCHEMAS ─────────────────────────────────────
--
-- Verified against the live catalog on 2026-08-16, because it is not what you
-- would guess: the business tables are SPLIT across two schemas. `tasks`,
-- `teams`, `users` and `approvals` live in `public`; `organisations` and
-- `outbound_log` live in `staging`. So this table sits in `staging` beside the
-- other append-only log it is modelled on, and its FK points at
-- `staging.organisations` — which is the table `public.teams.org_id` already
-- resolves against (checked: 0 of 52 teams carry an org_id absent from it).
--
-- `emit.py` fully qualifies `staging.niyam_events` for this reason. Nothing
-- here may rely on `search_path`: `db.py` sets it best-effort only, because
-- PgBouncer's transaction pooling does not guarantee it survives to the
-- statement.
--
-- ── TEN PROJECTS EMIT NOTHING, AND THAT IS CORRECT FOR NOW ──────────────────
--
-- 10 of 52 teams have `org_id IS NULL` (same probe). An event with no org has
-- no tenant, so the emitters skip it rather than inventing one — those projects
-- are simply invisible to automation until the org backfill reaches them. Read
-- the week of N3 traffic with that in mind: it under-reports by about a fifth,
-- and the missing fifth is not random.

-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One CREATE TABLE and its indexes, all on a relation this transaction creates
-- and nothing else can see. The single contended statement is the foreign key,
-- which takes a ShareRowExclusiveLock on `staging.organisations` — blocking
-- writers, not readers, for a catalog update at three rows. `organisations` is
-- read on nearly every request, so `lock_timeout` turns "queued behind an open
-- transaction" into a clean rollback rather than a stall. Same reasoning as 098.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
--
-- Apply BEFORE the application change; it is the only possible order, since the
-- emitter cannot INSERT into a table that does not exist. Applying it early is
-- free: nothing reads it, nothing joins to it, and an emitter that is not yet
-- deployed simply writes nothing.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS staging.niyam_events (
    -- BIGINT IDENTITY, not UUID. This table takes an INSERT on every watched
    -- business write forever, and a random UUID scatters each insert to a
    -- different index page. It is also the DRAIN CURSOR: the sweep orders by
    -- this column, and "everything above N" is only a meaningful sentence for a
    -- monotonic key. Same choice, same reasons, as staging.outbound_log.
    event_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- Dotted and stable: `task.status_changed`, `deal.stage_changed`,
    -- `contact.created`. NOT constrained to a list. A CHECK here would mean a
    -- migration every time a module emits something new, and the failure mode
    -- of an unknown event type is benign — no rule matches it, so it drains and
    -- is ignored. Contrast `source` below, where the failure mode is not benign.
    event_type    TEXT NOT NULL,

    -- TEXT, not UUID, and this is deliberate rather than lazy: `tasks.task_id`
    -- is `task_<hex12>`, and `users.user_id` is `user_<hex12>`. Migrations 030
    -- and 092 both exist because someone assumed UUID here before.
    entity_type   TEXT,
    entity_id     TEXT,

    -- WHO. Explicit column, never session state — see the header. NULL is legal
    -- only for machine sources; the CHECK below is the production co-write
    -- defence, and it is a constraint rather than a convention precisely
    -- because the thing it defends against is another deployment we do not
    -- control writing to this same table.
    actor_id      TEXT,

    -- WHERE FROM. This one IS a closed list: an unrecognised source would be a
    -- rule silently matching events it was never meant to see, which is the
    -- opposite of benign. Server-side allowlist, the pattern CLAUDE.md mandates
    -- for every dynamic identifier in this codebase.
    --   app    — a person did something in the product
    --   import — a bulk load or a marketplace feed; no single actor
    --   sweep  — Niyam's own temporal predicates (overdue, stale, expiring)
    --   cron   — a scheduled job that is not the sweep
    source        TEXT NOT NULL,

    -- The typed before/after snapshot the conditions read. This is the fix for
    -- the defect that made the old engine's condition builder a lie: its
    -- callers passed `{task_id, team_id}` and nothing else, so every rule
    -- conditioned on priority or assignee was unevaluable — the engine refused
    -- to fire and wrote the reason to a log nobody reads, while the UI showed
    -- the rule as Active for ever.
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- When the BUSINESS thing happened, which is not always when the row was
    -- written: a sweep emitting "this invoice went overdue" is describing a
    -- boundary that passed at midnight.
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Windowed de-duplication for synthetic events. An invoice is overdue every
    -- minute of every day; without this the sweep would emit an event per tick
    -- and a dunning rule would mail the customer every tick. The writer sets a
    -- key like `invoice_overdue:<id>:2026-08-16` and the partial unique index
    -- below makes "once per window" an index rather than a code path.
    dedupe_key    TEXT,

    claimed_at    TIMESTAMPTZ,
    processed_at  TIMESTAMPTZ,

    -- An `app` event with no actor is not a fact about a person; it is an
    -- unattributable write, and the most likely author of one is the OTHER
    -- deployment against this shared database. Refuse it at the constraint so
    -- no code path — ours or theirs — can create one.
    CONSTRAINT niyam_events_actor_ck
        CHECK (source <> 'app' OR actor_id IS NOT NULL),

    CONSTRAINT niyam_events_source_ck
        CHECK (source IN ('app', 'import', 'sweep', 'cron'))
);

-- THE DRAIN. Partial, because the sweep only ever asks for unprocessed rows and
-- this table grows without bound: a full index would carry every row ever
-- emitted to answer a question that only concerns the newest few. Ordered by
-- the identity column so the scan is the cursor.
CREATE INDEX IF NOT EXISTS niyam_events_unprocessed_idx
    ON staging.niyam_events (event_id)
    WHERE processed_at IS NULL;

-- ONCE PER WINDOW, enforced rather than intended. Partial so the many rows with
-- no dedupe_key (every `app` event) cost nothing and cannot collide with each
-- other — a plain unique index would make NULLs distinct and still carry them.
CREATE UNIQUE INDEX IF NOT EXISTS niyam_events_dedupe_idx
    ON staging.niyam_events (org_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- Reading the estate back: "what has this org emitted", and the retention
-- sweep's `WHERE occurred_at < …`. BRIN rather than btree — this column is
-- naturally correlated with physical order on an append-only table, so BRIN
-- answers a month-wide range in kilobytes where a btree would take hundreds of
-- megabytes. Same choice as outbound_log's `ts`.
CREATE INDEX IF NOT EXISTS niyam_events_occurred_brin_idx
    ON staging.niyam_events USING BRIN (occurred_at);

COMMENT ON TABLE staging.niyam_events IS
  'Niyam automation event outbox. Written by services/niyam/emit.py in the same '
  'transaction as the business write; drained by the sweep. NOT written by any '
  'database trigger — production shares this database and would fire one blind. '
  'See migration 141 and docs/proposals/55-niyam-automation.html.';

COMMENT ON COLUMN staging.niyam_events.actor_id IS
  'TEXT (user_<hex12>), not UUID. NULL only for machine sources — enforced by '
  'niyam_events_actor_ck, which is the defence against the other deployment '
  'against this shared database writing unattributable events.';

COMMENT ON COLUMN staging.niyam_events.dedupe_key IS
  'Windowed de-duplication for synthetic sweep events, e.g. '
  'invoice_overdue:<id>:<date>. Enforced by the partial unique index, not by '
  'the caller remembering.';

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--
--   SELECT count(*) FROM staging.niyam_events;                  -- expect 0
--
--   -- the co-write defence actually refuses:
--   INSERT INTO staging.niyam_events (org_id, event_type, source)
--   VALUES ('<a real org uuid>', 'probe.test', 'app');
--   -- expect: new row violates check constraint "niyam_events_actor_ck"
--
--   -- and the same row with a machine source is accepted:
--   INSERT INTO staging.niyam_events (org_id, event_type, source)
--   VALUES ('<a real org uuid>', 'probe.test', 'sweep');        -- expect: 1 row
--   DELETE FROM staging.niyam_events WHERE event_type = 'probe.test';
--
-- RETENTION is deliberately NOT set up here. This table has no consumer yet, so
-- there is nothing to size a window against; N4 adds the DELETE to the existing
-- staging.cleanup_old_data() the retention cron already calls, once a week of
-- real traffic has shown what a week actually weighs. Note the warning recorded
-- in 098: that function is called by routers/scheduler.py and is defined in NO
-- migration in this repo.
