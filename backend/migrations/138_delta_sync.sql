-- Delta sync: the two things every table needs before `?since=` can be honest.
--
-- APPLIED 2026-08-09, and the triggers were PROVEN rather than assumed: a task
-- was created and deleted inside a rolled-back transaction on the live
-- database. That proof caught a real defect before it shipped — the tombstone
-- named `tasks.id` (a uuid no client has ever seen) instead of `task_id`, so
-- deletions would have been broadcast under a key nothing could match.
--
-- Owner's decision, 2026-08-09: the mobile app syncs "the data since last
-- session" on every open, for real — not a refetch of whole lists.
--
-- A delta is a promise: "everything that changed since the timestamp you gave
-- me, and nothing else." Two things break that promise, and both were measured
-- against the live database before this file was written.
--
-- ── 1. TWO TABLES HAVE NO `updated_at` AT ALL ───────────────────────────────
--
-- `graha_activities` (224 rows) and `graha_follow_ups` (130 rows). A delta over
-- a table with no modification stamp cannot answer the question, and the
-- failure is SILENT: the device keeps showing the old text of an activity that
-- was edited a month ago and nothing anywhere reports a problem.
--
-- The column is maintained by a TRIGGER rather than by each writer, because
-- "remember to set updated_at" is a rule that holds until the next handler is
-- written. Every other synced table sets it in application code and mostly
-- gets it right — measured: 524 of 671 deals and 177 of 760 invoices carry an
-- updated_at later than their created_at, so those writers do work. These two
-- get the version that cannot be forgotten.
--
-- ── 2. HARD DELETES ARE INVISIBLE TO A DELTA ────────────────────────────────
--
-- THE bug every delta-sync implementation ships with once. `tasks` and
-- `graha_follow_ups` are DELETEd outright in seven places (`server.py:4172`,
-- `tasks_bulk.py:553`, `project_purge.py`, `graha.py:1307`, …). A device asking
-- "what changed since Tuesday" is told about edits and insertions and hears
-- NOTHING about the task that was deleted on Wednesday — so it keeps it, for
-- ever, and the user taps a task that does not exist.
--
-- `staging.sync_tombstones` is the answer, and it is a trigger rather than a
-- code change at each delete site for the same reason as above: seven sites
-- today, and the eighth written next month would be the one that leaks.
--
-- Soft-deleted tables (`is_active`, `deleted_at`) need no tombstone — the row
-- survives with a flag and the delta carries it, which is why the client must
-- be told to REMOVE rows it receives with is_active=false rather than to
-- display them.
--
-- ── RETENTION ───────────────────────────────────────────────────────────────
--
-- A tombstone is only useful until every device has seen it. They are pruned
-- after 30 days by the retention job; a device offline longer than that must
-- do a full resync, which the client decides by comparing `since` to the
-- server's `tombstone_horizon`. A delta that silently omits deletions older
-- than the retention window is the same bug this file exists to prevent, so
-- the horizon is REPORTED rather than assumed.

BEGIN;

-- ── 1. The missing modification stamps ──────────────────────────────────────

ALTER TABLE staging.graha_activities
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE staging.graha_follow_ups
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION staging.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_activities ON staging.graha_activities;
CREATE TRIGGER trg_touch_activities
    BEFORE UPDATE ON staging.graha_activities
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_follow_ups ON staging.graha_follow_ups;
CREATE TRIGGER trg_touch_follow_ups
    BEFORE UPDATE ON staging.graha_follow_ups
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

-- ── 2. Tombstones ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging.sync_tombstones (
    id          BIGSERIAL PRIMARY KEY,
    org_id      UUID,
    entity      TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    deleted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The sweep is always "this org, since this moment", so that is the index.
CREATE INDEX IF NOT EXISTS sync_tombstones_org_when
    ON staging.sync_tombstones (org_id, deleted_at);
-- And the pruner walks by age alone.
CREATE INDEX IF NOT EXISTS sync_tombstones_when
    ON staging.sync_tombstones (deleted_at);

COMMENT ON TABLE staging.sync_tombstones IS
    'One row per HARD-deleted record, so a delta sync can tell a device to '
    'forget it. Soft-deleted tables do not appear here: their rows survive with '
    'a flag and the delta carries them. Pruned after 30 days — a device offline '
    'longer must resync in full.';

CREATE OR REPLACE FUNCTION staging.write_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_org  UUID;
    v_id   TEXT;
BEGIN
    -- `org_id` is not on every table yet (tasks reaches it through its team),
    -- so it is read defensively and a NULL is acceptable: the reader falls back
    -- to filtering by the ids the device actually holds.
    BEGIN
        v_org := to_jsonb(OLD) ->> 'org_id';
    EXCEPTION WHEN others THEN
        v_org := NULL;
    END;
    -- TG_ARGV[1] FIRST, and that order is the whole correctness of this
    -- function. `tasks` carries BOTH a uuid `id` and the `task_id` the API and
    -- every client actually use; reading `id` first wrote a tombstone naming a
    -- key no device has ever seen, so the deletion would never be applied.
    -- Caught by the rolled-back proof in the apply script, not by reading.
    v_id := COALESCE(to_jsonb(OLD) ->> TG_ARGV[1], to_jsonb(OLD) ->> 'id');
    IF v_id IS NULL THEN
        RETURN OLD;
    END IF;
    INSERT INTO staging.sync_tombstones (org_id, entity, entity_id)
    VALUES (v_org, TG_ARGV[0], v_id);
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_tombstone_tasks ON public.tasks;
CREATE TRIGGER trg_tombstone_tasks
    AFTER DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION staging.write_tombstone('task', 'task_id');

DROP TRIGGER IF EXISTS trg_tombstone_follow_ups ON staging.graha_follow_ups;
CREATE TRIGGER trg_tombstone_follow_ups
    AFTER DELETE ON staging.graha_follow_ups
    FOR EACH ROW EXECUTE FUNCTION staging.write_tombstone('follow_up', 'id');

DROP TRIGGER IF EXISTS trg_tombstone_teams ON public.teams;
CREATE TRIGGER trg_tombstone_teams
    AFTER DELETE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION staging.write_tombstone('team', 'team_id');

-- ── 3. The indexes a delta actually reads ───────────────────────────────────
--
-- Without these, `WHERE org_id=? AND updated_at > ?` is a sequential scan on
-- every app open, on the tables that grow fastest. `tasks` has no org_id, so
-- its delta is scoped by team and indexed that way.

CREATE INDEX IF NOT EXISTS tasks_delta          ON public.tasks (team_id, updated_at);
CREATE INDEX IF NOT EXISTS graha_deals_delta    ON staging.graha_deals (org_id, updated_at);
CREATE INDEX IF NOT EXISTS graha_contacts_delta ON staging.graha_contacts (org_id, updated_at);
CREATE INDEX IF NOT EXISTS graha_clients_delta  ON staging.graha_clients (org_id, updated_at);
CREATE INDEX IF NOT EXISTS graha_activities_delta ON staging.graha_activities (org_id, updated_at);
CREATE INDEX IF NOT EXISTS graha_follow_ups_delta ON staging.graha_follow_ups (org_id, updated_at);
CREATE INDEX IF NOT EXISTS ganit_invoices_delta ON staging.ganit_invoices (org_id, updated_at);
CREATE INDEX IF NOT EXISTS vikray_orders_delta  ON staging.vikray_orders (org_id, updated_at);

COMMIT;
