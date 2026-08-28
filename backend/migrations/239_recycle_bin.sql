-- 239_recycle_bin.sql
--
-- Proposal 93 · B — THE TWO-STAGE RECYCLE BIN.
--
-- The number was read at the moment this file was written —
-- `ls backend/migrations/ | grep -oE '^[0-9]+' | sort -n | tail -1` answered
-- 238 — and it is never re-numbered afterwards.
--
-- Risk report, written BEFORE this ran and not afterwards to justify it:
--   docs/plans/93-B-RECYCLE-BIN-RISK-REPORT.md
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   CREATE TABLE  staging.deleted_files
--   CREATE INDEX  x 2
--   COMMENT       on the table and on the six columns that are not obvious
--
--   NOTHING ELSE. No ALTER, no DROP, no INSERT, no UPDATE, no DELETE, no
--   BACKFILL, no trigger, no view, no foreign key in either direction. Not one
--   existing row is read or written by this file.
--
--   That shape was chosen deliberately over the obvious alternative — adding
--   `deleted_at`/`deleted_by` to `graha_documents` and a shadow column to
--   `tasks`. Additive-into-a-new-table has a one-line reversal and cannot
--   collide with a live read path; ALTERing two tables that production serves
--   has neither property.
--
-- ── THE TABLE DOES NOT EXIST YET. MEASURED, IN BOTH PRODUCT SCHEMAS ──────────
--
-- Read live 2026-08-29 from `pg_class`, not inferred from the absence of a
-- migration file:
--
--   SELECT n.nspname, c.relname FROM pg_class c
--     JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE c.relkind='r' AND n.nspname IN ('staging','public')
--      AND (c.relname ILIKE '%recycle%' OR c.relname ILIKE '%deleted%'
--        OR c.relname ILIKE '%trash%'   OR c.relname ILIKE '%bin%'
--        OR c.relname ILIKE '%purge%'   OR c.relname ILIKE '%retention%');
--   -> 0 rows
--
-- ⚠ BOTH product schemas, because a schema-qualified negative is a fact about
-- THAT SCHEMA ONLY. `public.report_schedules` was declared missing on exactly
-- that mistake while it had a CRUD and an armed hourly cron behind it.
--
-- ── WHY THERE IS NO `stage` COLUMN ──────────────────────────────────────────
--
-- The stage is DERIVED at read time:
--
--   stage 2  when  stage2_at IS NOT NULL OR deleted_at < now() - 14 days
--   stage 1  otherwise
--
-- Migration 111 refuses a `status` column on support sessions and 182 refuses a
-- `closed_at`, both for one reason this file inherits: a stored answer is a
-- cache of an event, and its failure mode is staleness. A bin whose stage is
-- stored is a bin that lies to the customer for exactly as long as the sweeper
-- is late — and the sweeper here ships DISARMED, so "late" is the normal state.
--
-- But `stage2_at` IS a column, and that is not a contradiction. "Delete it from
-- stage 1" is a PERSON'S ACT, not the passage of time, and an age cannot
-- express it. So the act gets a timestamp, the age is the floor, and the read
-- takes whichever came first. Deriving from age alone would silently un-promote
-- everything a customer had deliberately cleared out.
--
-- ── WHY `source_id` IS text AND NOT uuid ────────────────────────────────────
--
-- Because the two sources genuinely disagree, read from the live catalogue:
--
--   public.tasks.task_id            text
--   staging.graha_documents.id      uuid
--
-- A uuid column would have made task attachments unstorable — and that is the
-- half of this feature with the live orphan in it (`server.py:5438` filters the
-- JSONB array and leaves the R2 object billed forever, unreachable by anyone
-- including Aekam). Widening to text costs an index-size nobody will measure
-- and keeps the bin able to hold the thing it exists for.
--
-- ── AND NO FOREIGN KEY, DELIBERATELY ────────────────────────────────────────
--
-- A bin row must OUTLIVE its source. `DELETE /api/tasks/{id}` hard-deletes the
-- task; its attachments are captured here first, and an FK to `tasks` would
-- either block that delete or cascade the bin row away with it — destroying the
-- only remaining pointer to a paid-for R2 object at the exact moment it becomes
-- unreachable by any other means.
--
-- `public.tasks` also carries no foreign keys at all (read from `pg_constraint`
-- — `server.py:1884` records the same), so there is no local convention this
-- departs from.

CREATE TABLE IF NOT EXISTS staging.deleted_files (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The tenant. Every read in the routers is scoped on this and the routes
    -- are gated on org_owner/org_admin, so a bin is never cross-org.
    org_id        uuid        NOT NULL,

    -- Only the two surfaces the owner wired delete to. Ganit invoices and eSign
    -- documents are ABSENT and must stay absent: books of account carry an
    -- 8-year Income Tax retention and GST records 72 months, and a customer who
    -- deletes a signed invoice finds out at assessment. The CHECK is the guard,
    -- so adding a third source is a deliberate migration rather than a caller
    -- passing a new string.
    source_kind   text        NOT NULL
                  CONSTRAINT deleted_files_source_kind
                  CHECK (source_kind IN ('task_attachment', 'graha_document')),

    -- text, not uuid — see the header. tasks.task_id is text.
    source_id     text        NOT NULL,

    file_name     text        NOT NULL,

    -- The R2 object key. This is the whole point of the row: without it the
    -- object is unreachable by anyone, including Aekam.
    r2_key        text        NOT NULL,
    file_url      text,

    -- Counted against the org's quota for as long as the row is unpurged.
    -- `storage_used_bytes` is decremented at purge and NOWHERE else — an org
    -- that could delete its way under its limit would sit permanently over it.
    size_bytes    bigint      NOT NULL DEFAULT 0,

    deleted_by    text        NOT NULL,
    deleted_at    timestamptz NOT NULL DEFAULT now(),

    -- Set ONLY when a person clears an item out of stage 1 early. NULL means
    -- "stage is whatever the age says".
    stage2_at     timestamptz,

    restored_at   timestamptz,

    -- The R2 object is gone. Terminal, and the only irreversible state here.
    purged_at     timestamptz,
    purge_error   text
);

-- The bin listing: one org, unpurged, unrestored, newest first. Partial,
-- because a purged row is never listed and there is no reason to index it.
CREATE INDEX IF NOT EXISTS deleted_files_org_live_idx
    ON staging.deleted_files (org_id, deleted_at DESC)
    WHERE purged_at IS NULL AND restored_at IS NULL;

-- The sweeper's own scan: everything old enough to purge, across all orgs.
-- Separate from the listing index because it is not org-scoped — the sweeper
-- runs for the platform, not for a tenant.
CREATE INDEX IF NOT EXISTS deleted_files_purge_due_idx
    ON staging.deleted_files (deleted_at)
    WHERE purged_at IS NULL AND restored_at IS NULL;

COMMENT ON TABLE staging.deleted_files IS
    'Two-stage recycle bin for task attachments and CRM documents. Stage 1 is '
    'days 0-14 and stage 2 is 14-90, both visible to org_owner/org_admin and '
    'both restorable; the R2 object is destroyed only at purge. Stage is '
    'DERIVED (stage2_at OR age), never stored - see migration 111 and 182 on '
    'why a stored status is a cache with a staleness failure mode.';

COMMENT ON COLUMN staging.deleted_files.source_kind IS
    'task_attachment | graha_document. Ganit invoices and eSign documents are '
    'deliberately absent - 8-year Income Tax retention, 72-month GST.';

COMMENT ON COLUMN staging.deleted_files.source_id IS
    'text because the two sources disagree: public.tasks.task_id is text, '
    'staging.graha_documents.id is uuid.';

COMMENT ON COLUMN staging.deleted_files.stage2_at IS
    'Set only when a PERSON clears an item out of stage 1 early. An age cannot '
    'express an act, so the act gets a timestamp and the age is the floor.';

COMMENT ON COLUMN staging.deleted_files.size_bytes IS
    'Counts against the org quota until purged. storage_used_bytes is '
    'decremented at purge and nowhere else.';

COMMENT ON COLUMN staging.deleted_files.r2_key IS
    'Without this the object is unreachable by anyone including Aekam, which '
    'is precisely the orphan this table exists to stop.';

COMMENT ON COLUMN staging.deleted_files.purged_at IS
    'The R2 object is gone. The only irreversible state in this feature, and '
    'the sweeper that sets it ships DISARMED.';
