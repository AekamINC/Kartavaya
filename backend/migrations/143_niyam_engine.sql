-- 143_niyam_engine.sql — rules, steps, runs, run steps.
--
-- Step N4 of the Niyam build. `staging.niyam_events` is 141; the thirteen
-- shadow tables it would otherwise have collided with are 142. Nothing here is
-- reachable until a rule exists, and no rule can act until BOTH `NIYAM_ARMED`
-- and its own `is_armed` are true — see `services/niyam/flags.py`.
--
-- Four tables and not five: the design counts `niyam_events` among them, and it
-- already exists.
--
-- ── WHAT THE DESIGN SAID AND WHAT THE CATALOG SAID ──────────────────────────
--
-- Proposal 55 §4 specifies `niyam_run_steps.outbound_id` as a FOREIGN KEY into
-- `staging.outbound_log`, and makes that FK the whole of the fourth standing
-- rule: "nothing says sent unless it was sent — there is no boolean for the
-- engine to lie with". The foreign key is NOT CONSTRUCTIBLE against today's
-- writer, for three independent reasons, all verified in code:
--
--   1. The caller never learns the key. `outbound.begin()` returns an `Attempt`
--      whose `.id` is a process-local uuid4, documented as NOT the primary key.
--   2. The row does not exist when `begin()` returns — `outbound_log.write()`
--      buffers and returns None; the INSERT happens later on the event loop.
--   3. In the common case no attempt row is inserted at all, because the
--      outcome supersedes the open row in memory before the batch flushes.
--
-- And migration 098 chose deliberately that `outbound_log` is "referenced by
-- nothing", with a 400-day retention DELETE that any FK would fight.
--
-- So: `outbound_id BIGINT`, NULLABLE, WITH NO FOREIGN KEY. The column holds the
-- real primary key when `services/outbound_log.py` can hand one back, and NULL
-- when it cannot. That keeps the property the rule actually cares about — three
-- honestly representable states, and no boolean to lie with:
--
--     outbound_id IS NOT NULL   a row in outbound_log says what happened
--     outbound_id IS NULL
--       + outcome 'dry'         the engine was not armed; nothing was attempted
--       + outcome 'ok'          delivered by a channel outbound_log cannot
--                               represent — in-app is a `notifications` row,
--                               and `outbound_log_channel_ck` allows only
--                               email/push/whatsapp/social
--
-- What must NEVER appear here is a `sent BOOLEAN`. That is the column the old
-- estate had, and it is why 331 reminders recorded `status='sent'` while every
-- corresponding outbound row said `suppressed`.
--
-- ── WHY niyam_runs.event_id HAS NO FOREIGN KEY EITHER ───────────────────────
--
-- Two reasons, and the second is the one that would have hurt.
--
--   * RETENTION. N4 owes a retention DELETE on `niyam_events`. `ON DELETE
--     CASCADE` would erase the run history the moment the events aged out, and
--     run history is a product requirement with a different, longer window than
--     the events that caused it. Deleting the record of what the engine did, as
--     a side effect of pruning the log of what happened, is the worst possible
--     coupling.
--   * LOCKS. `emit_event` writes inside the USER'S BUSINESS TRANSACTION, so an
--     emit holds a RowExclusiveLock on `niyam_events` for the duration of a
--     task save. Adding an FK to that table takes a ShareRowExclusiveLock,
--     which conflicts — so applying this migration could stall live task saves,
--     and Postgres queues every later lock request behind the waiter.
--
-- `actor_id` in 141 carries no FK for a comparable reason. `lock_timeout` below
-- covers the remaining exposure.
--
-- ── AND WHY event_id IS NOT NULL ANYWAY ─────────────────────────────────────
--
-- `UNIQUE (rule_id, event_id)` is the entire idempotency story: one worker wins
-- the claim, a redeploy mid-drain replays safely. Postgres treats NULLs as
-- DISTINCT in a unique index, so a nullable `event_id` would silently stop
-- being a guarantee — every run without an event would insert a fresh row and
-- never conflict. It is achievable because the design leaves no run without an
-- event: temporal predicates emit synthetic events with `source='sweep'` and a
-- dedupe_key, so a "this invoice is overdue" run claims against a real row.
--
-- ── NO STATUS COLUMN ON A RUN ───────────────────────────────────────────────
--
-- A per-step OUTCOME is a fact about a completed act and is recorded. A per-run
-- lifecycle `status` maintained by a sweeper is not, and this codebase has
-- already litigated it: `test_a_support_session_has_no_stored_status` exists
-- because "a `status` column says active until something writes expired, and a
-- sweeper that is late, failed, was never deployed or got dropped in a refactor
-- leaves a session reading active three days after it ended". A run's state is
-- derivable from `started_at`, `finished_at` and `wake_at`.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- Four CREATE TABLEs and their indexes, all on relations this transaction
-- creates. The only contended statements are the foreign keys to
-- `staging.organisations` (ShareRowExclusiveLock, 3 rows) — the same shape 141
-- reasoned about. There is deliberately NO foreign key to `staging.niyam_events`
-- (above), which is what keeps this migration off the live write path.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── RULES ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.niyam_rules (
    rule_id       TEXT PRIMARY KEY,
    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    name          TEXT NOT NULL,

    -- The trigger. Matches `niyam_events.event_type` exactly; deliberately not
    -- constrained to a list, for the same reason 141 does not constrain the
    -- event type — a new module emitting something new must not need a
    -- migration, and an unmatched rule is inert rather than broken.
    event_type    TEXT NOT NULL,

    -- TWO INDEPENDENT GATES, both FALSE by default, and neither is redundant.
    --   enabled  — the author's switch: is this rule live at all?
    --   is_armed — may it ACT? A rule that is enabled and not armed still runs:
    --              conditions evaluate, a run and its steps are recorded, and
    --              every action resolves to a `dry` outcome.
    -- That split is the one production-grade idea in the estate being replaced
    -- (Prachar's draft-vs-scheduled), and it is what makes the first weeks safe.
    --
    -- BOTH DEFAULT FALSE. Migration 106 exists because `pahchan_policy` shipped
    -- three toggles defaulting TRUE with nothing behind them, and every org that
    -- never opened the screen was recorded as wanting summaries that did not
    -- exist. A default is a product promise; these two promise nothing.
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    is_armed      BOOLEAN NOT NULL DEFAULT FALSE,

    created_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT niyam_rules_name_ck CHECK (length(btrim(name)) > 0)
);

-- The drain's hot path: given an event, which rules care? Partial, because a
-- disabled rule is not a candidate and this index exists only to answer that
-- question.
CREATE INDEX IF NOT EXISTS niyam_rules_match_idx
    ON staging.niyam_rules (org_id, event_type)
    WHERE enabled;

-- ── RULE STEPS ──────────────────────────────────────────────────────────────
--
-- An ORDERED LINEAR PIPELINE, not a graph. No branching means no orphaned-node
-- class of bug, and no flow library — there is none in package.json, and a
-- canvas is weeks of drag, edge routing and layout persistence before a single
-- rule runs.

CREATE TABLE IF NOT EXISTS staging.niyam_rule_steps (
    step_id       TEXT PRIMARY KEY,
    rule_id       TEXT NOT NULL REFERENCES staging.niyam_rules(rule_id) ON DELETE CASCADE,

    -- Position in the pipeline. UNIQUE per rule so "step 3" names one thing.
    step_no       INTEGER NOT NULL,

    -- Closed list. Unlike `event_type`, an unrecognised value here is NOT
    -- benign — it is a step the engine cannot classify, sitting in a pipeline
    -- it will try to execute.
    kind          TEXT NOT NULL,

    -- For a condition: the field, operator and comparand. For an action: the
    -- verb and its arguments. For a wait: the duration. Validated in Python
    -- against the field registry and the action allowlist before it is stored —
    -- a condition the event cannot answer is refused at authoring time, which
    -- is the structural version of what the old engine did at runtime (refuse,
    -- then log to a file nobody reads, on a rule the UI showed as Active).
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT niyam_rule_steps_kind_ck
        CHECK (kind IN ('condition', 'action', 'wait')),
    CONSTRAINT niyam_rule_steps_no_ck
        CHECK (step_no >= 0),
    CONSTRAINT niyam_rule_steps_order_uq
        UNIQUE (rule_id, step_no)
);

CREATE INDEX IF NOT EXISTS niyam_rule_steps_rule_idx
    ON staging.niyam_rule_steps (rule_id, step_no);

-- ── RUNS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.niyam_runs (
    run_id        TEXT PRIMARY KEY,
    rule_id       TEXT NOT NULL REFERENCES staging.niyam_rules(rule_id) ON DELETE CASCADE,

    -- NOT NULL, and no foreign key. See the header for both halves.
    event_id      BIGINT NOT NULL,

    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- What the run DID, not what the rule was configured to do. Recorded per
    -- run because the master switch can be flipped between one run and the
    -- next, and "was this dry?" must be answerable from the run itself months
    -- later — not re-derived from a flag's current value.
    dry_run       BOOLEAN NOT NULL,

    -- A WAIT IS A COLUMN, NOT A TABLE. When a `wait` step is reached the engine
    -- stamps this and stops; the sweep resumes runs whose time has passed.
    --
    -- Resuming must be a conditional UPDATE that clears `wake_at` in the SAME
    -- statement that claims the run, with the `wake_at IS NOT NULL` re-checked
    -- after the row lock. It must NOT re-claim by insert: the (rule_id,
    -- event_id) key is already consumed by the original claim, so a second
    -- `INSERT … ON CONFLICT DO NOTHING` returns zero rows and the wait is
    -- silently dropped for ever.
    wake_at       TIMESTAMPTZ,

    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,

    -- THE IDEMPOTENCY GUARANTEE. Claim-by-insert: one worker wins, the losers
    -- get zero rows back and move on. A redeploy mid-drain replays safely
    -- because the winner's row is already there.
    CONSTRAINT niyam_runs_claim_uq UNIQUE (rule_id, event_id)
);

-- Resume: which runs are waiting, oldest first. Partial — a finished run is
-- never a candidate and this table grows without bound.
CREATE INDEX IF NOT EXISTS niyam_runs_wake_idx
    ON staging.niyam_runs (wake_at)
    WHERE wake_at IS NOT NULL;

-- "What has this rule done lately", the builder's history panel.
CREATE INDEX IF NOT EXISTS niyam_runs_rule_idx
    ON staging.niyam_runs (rule_id, started_at DESC);

CREATE INDEX IF NOT EXISTS niyam_runs_started_brin_idx
    ON staging.niyam_runs USING BRIN (started_at);

-- ── RUN STEPS ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.niyam_run_steps (
    run_step_id   TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL REFERENCES staging.niyam_runs(run_id) ON DELETE CASCADE,

    -- Mirrors `niyam_rule_steps.step_no` rather than referencing the step row:
    -- a rule may be edited after a run, and the history must keep saying what
    -- position ran, not follow the edit.
    step_no       INTEGER NOT NULL,

    outcome       TEXT NOT NULL,

    -- Why. For `refused`, the condition that failed and the values compared —
    -- this is what makes "why did my rule not fire" answerable, which is the
    -- single most common question about any automation product, and the one the
    -- old engine answered into a server log.
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- The delivery evidence. See the header: a real `staging.outbound_log.id`
    -- when one is obtainable, NULL otherwise, and NO foreign key.
    outbound_id   BIGINT,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT niyam_run_steps_outcome_ck
        CHECK (outcome IN ('ok', 'refused', 'failed', 'skipped', 'dry')),

    -- THE RESUME CURSOR. A resumed wait works out where to continue by asking
    -- which step numbers already have rows; that is only correct if a step can
    -- produce at most one row, which is a constraint and not a convention.
    -- Without it a double-resume writes two rows for one step and the history
    -- quietly double-counts.
    CONSTRAINT niyam_run_steps_order_uq UNIQUE (run_id, step_no)
);

CREATE INDEX IF NOT EXISTS niyam_run_steps_run_idx
    ON staging.niyam_run_steps (run_id, step_no);

COMMENT ON TABLE staging.niyam_rules IS
  'Niyam automation rules. `enabled` and `is_armed` are independent and both '
  'default FALSE; a rule may be enabled and unarmed, in which case it runs and '
  'records what it WOULD have done. See services/niyam/flags.py.';

COMMENT ON COLUMN staging.niyam_run_steps.outbound_id IS
  'staging.outbound_log.id when one can be obtained, NULL otherwise. NO foreign '
  'key: 098 made outbound_log referenced-by-nothing and gave it a 400-day '
  'retention DELETE. NULL + outcome ok means a channel outbound_log cannot '
  'represent (in-app). There is deliberately no `sent` boolean — that column is '
  'why 331 reminders read sent while every outbound row read suppressed.';

COMMENT ON COLUMN staging.niyam_runs.event_id IS
  'staging.niyam_events.event_id, NOT NULL and with NO foreign key. NOT NULL '
  'because Postgres treats NULLs as distinct in a UNIQUE index, which would '
  'silently void the claim. No FK because the events retention DELETE would '
  'CASCADE away the run history, and because an FK would lock a table that '
  'emit_event writes inside live business transactions.';

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--
--   SELECT count(*) FROM staging.niyam_rules;        -- expect 0
--
--   -- the claim is real (run twice; the second must return no row):
--   INSERT INTO staging.niyam_runs (run_id, rule_id, event_id, org_id, dry_run)
--   VALUES ('run_probe', '<a rule_id>', 1, '<an org uuid>', true)
--   ON CONFLICT (rule_id, event_id) DO NOTHING RETURNING run_id;
--
--   -- a bad outcome is refused:
--   INSERT INTO staging.niyam_run_steps (run_step_id, run_id, step_no, outcome)
--   VALUES ('rs_probe', 'run_probe', 0, 'sent');
--   -- expect: violates check constraint "niyam_run_steps_outcome_ck"
--
-- RETENTION for staging.niyam_events is still owed and is deliberately not here
-- — it belongs with the engine that produces the traffic to size it against.
-- Note 098's warning: `staging.cleanup_old_data()` is called nightly by an
-- armed cron and is defined in NO migration in this repo; its source lives only
-- in Postgres, so any change must start from `pg_get_functiondef`.
