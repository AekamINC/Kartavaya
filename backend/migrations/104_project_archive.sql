-- 104_project_archive.sql
--
-- ARCHIVING A FINISHED PROJECT, WHICH IS NOT THE SAME AS DELETING IT.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/104_project_archive.sql
--
-- ── WHY deleted_at IS NOT ARCHIVING ─────────────────────────────────────────
--
-- `public.teams` already has `deleted_at` / `deleted_by`, and the endpoints
-- behind them are explicit about what they mean: `delete_team` says "Soft-delete:
-- move project to bin. Hard-purged after 30 days", `restore_team` refuses once
-- `deleted_at < NOW() - INTERVAL '30 days'`, and `purge_team` erases the rows.
--
-- So the existing state is a THIRTY-DAY COUNTDOWN TO ERASURE. That is the right
-- behaviour for "this project was a mistake" and the wrong behaviour for "this
-- engagement finished". A completed audit is the firm's record: it must stop
-- cluttering the project list and must NOT acquire a deletion date.
--
-- Archiving is therefore a THIRD state and not a re-use of the second:
--
--     live      deleted_at IS NULL      AND archived_at IS NULL
--     archived  deleted_at IS NULL      AND archived_at IS NOT NULL
--     in bin    deleted_at IS NOT NULL  -- 30 days, then gone
--
-- A project can be archived and later deleted, which is why both columns exist
-- independently rather than one status column: the bin's countdown has to keep
-- working on a project that was archived first.
--
-- ── WHAT MUST KEEP COUNTING IT ──────────────────────────────────────────────
--
-- The reason this is a column and not a filter someone adds to a list query:
-- ARCHIVED PROJECTS MUST STILL APPEAR IN REPORTS. Revenue, hours, invoices and
-- payroll for a finished engagement are exactly the numbers a firm looks back
-- at, and a year-end total that silently drops every completed project is worse
-- than no total. So the rule is deliberately asymmetric and the code says so at
-- each site:
--
--   HIDE archived   — the project switcher, the project list, task boards,
--                     anywhere a person is choosing what to work on now.
--   COUNT archived  — every report, every analytics aggregate, every export.
--
-- `deleted_at IS NULL` stays on BOTH: a project in the bin is on its way out and
-- is not evidence of anything.
--
-- ── EFFECT ON EXISTING ROWS ─────────────────────────────────────────────────
--
-- None. Nullable, no default, no backfill: every one of the 44 existing teams is
-- live or in the bin, and NULL is exactly what "not archived" means. Replayable
-- — `IF NOT EXISTS` throughout, so a second run does nothing.

BEGIN;

-- Fail fast rather than queue in front of every project reader. `teams` is read
-- by the switcher on essentially every page load.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
    IF to_regclass('public.teams') IS NULL THEN
        RAISE EXCEPTION 'ABORT: public.teams does not exist. Wrong database, or a '
                        'branch where the projects table was never created.';
    END IF;
END $$;

-- Nullable with no default: metadata-only in PG11+, so no table rewrite and the
-- AccessExclusiveLock is held for a catalog update rather than a scan.
ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by text;

COMMENT ON COLUMN public.teams.archived_at IS
    'When this project was archived — finished, not deleted. NULL means live. '
    'Archived projects are HIDDEN from pickers, lists and boards, and are still '
    'COUNTED by every report and export: a finished engagement is the firm''s '
    'record. Independent of deleted_at, which is a 30-day countdown to erasure.';
COMMENT ON COLUMN public.teams.archived_by IS
    'The user_id who archived it. TEXT, matching deleted_by and users.user_id.';

-- Partial: the overwhelming majority of rows are live and carry NULL here, and
-- the only query that wants this column asks for the ones that do not.
CREATE INDEX IF NOT EXISTS teams_archived_idx
    ON public.teams (org_id, archived_at)
    WHERE archived_at IS NOT NULL;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT AND READ IT WITH YOUR EYES.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Both columns exist, nullable, no default. A default here would archive
--    every project in the product.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='teams'
   AND column_name IN ('archived_at','archived_by');

-- 2. Nothing was archived by the migration itself. This must be 0.
SELECT count(*) AS archived_by_the_migration
  FROM public.teams WHERE archived_at IS NOT NULL;

-- 3. The three states, after the feature has been used. No row should be both
--    archived and in the bin unless somebody deliberately did that, and the
--    countdown still applies to it if so:
SELECT count(*) FILTER (WHERE deleted_at IS NULL AND archived_at IS NULL)     AS live,
       count(*) FILTER (WHERE deleted_at IS NULL AND archived_at IS NOT NULL) AS archived,
       count(*) FILTER (WHERE deleted_at IS NOT NULL)                         AS in_bin
  FROM public.teams;
