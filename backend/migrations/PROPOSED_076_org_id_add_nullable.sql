-- PROPOSED_076_org_id_add_nullable.sql
-- Phase 1 of 6 — multi-tenancy cutover. See swarm-reports/audit-tenancy-org-id-cutover.md
--
-- ############################################################################
-- ##  PROPOSAL ONLY — NOT APPLIED, NOT SCHEDULED.                           ##
-- ##  `staging` and `public` are two schemas in ONE Supabase project, the   ##
-- ##  same project production uses. Running this touches production.       ##
-- ############################################################################
--
-- WHAT
--   Adds a nullable `org_id uuid` to the 21 `public` tables that carry live
--   tenant data and currently have no org column, plus a supporting index on
--   each. Nothing is backfilled and nothing is constrained here — this phase
--   is purely additive and is a no-op for every existing query.
--
-- WHY NULLABLE, WHY SEPARATE FROM THE BACKFILL
--   Seven of the eight tables measured leave residue that cannot be resolved
--   from the join path (see §5.2 of the report): 8 of 39 teams have
--   `org_id IS NULL`, 35 of 200 tasks have `team_id IS NULL`, 75 of 748
--   notifications have no team. A combined add+backfill+constrain migration
--   fails at the constrain step on all seven. Splitting the phases means a
--   failure is diagnosable and each step is separately reversible.
--
-- LOCK DURATION
--   `ADD COLUMN ... NULL` with no DEFAULT has been a catalog-only operation
--   since PostgreSQL 11 — no table rewrite, at any size. Execution is
--   sub-millisecond on every table here (largest is notifications at 480 kB).
--
--   The real cost is not execution, it is ACQUISITION. `ALTER TABLE` takes
--   ACCESS EXCLUSIVE; while it waits for that lock it queues behind every
--   other lock request on the table, and everything arriving after it queues
--   behind IT. One slow SELECT on `notifications` at the wrong moment stalls
--   all traffic to `notifications` for that query's duration. `lock_timeout`
--   below bounds that to 3 seconds: the ALTER fails rather than convoys, and
--   you retry. A failed ALTER here costs nothing.
--
--   `CREATE INDEX CONCURRENTLY` takes two table scans and CANNOT run inside a
--   transaction block. Run this file statement-by-statement, NOT wrapped in
--   BEGIN/COMMIT. If a CONCURRENTLY build fails it leaves an INVALID index
--   behind — drop it and re-run that one statement (see ROLLBACK).
--
-- RISK: LOW.
--   Additive. No existing query names `org_id` on these tables. `SELECT *`
--   consumers gain a column; the one that matters, `row_to_task()` in
--   `backend/utils.py`, maps fields explicitly and tolerates this.
--
-- PRE-FLIGHT
--   Confirm none of these tables already has the column (an earlier partial
--   run, or another agent's proposal, may have added some):
--
--     SELECT c.relname
--       FROM pg_class c
--       JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE n.nspname = 'public' AND c.relkind = 'r'
--        AND EXISTS (SELECT 1 FROM pg_attribute a
--                     WHERE a.attrelid = c.oid AND a.attname = 'org_id'
--                       AND a.attnum > 0 AND NOT a.attisdropped);
--
--   Expected before this phase: exactly `teams` and `channels`.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ── Tier 1: one hop from teams (scope column already present: team_id) ──────

ALTER TABLE public.tasks               ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.team_members        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.project_assignments ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.activity_events     ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.notifications       ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.approvals           ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.boards              ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.project_columns     ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.saved_views         ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.automations         ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_templates      ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.field_definitions   ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.report_schedules    ADD COLUMN IF NOT EXISTS org_id uuid;

-- ── Tier 2: two hops (via tasks or boards) ─────────────────────────────────

ALTER TABLE public.task_comments       ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_reminders      ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.time_entries        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_clients        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.field_values        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.board_columns       ADD COLUMN IF NOT EXISTS org_id uuid;

-- ── Tier 3: three hops (mentions -> task_comments -> tasks -> teams) ───────

ALTER TABLE public.mentions            ADD COLUMN IF NOT EXISTS org_id uuid;

-- ── Structural: no scoping path exists today (report §3.1, G-14/G-15) ─────
--
-- These four have NO path to an org at all — not a long path, no path. Adding
-- the column is the only way they can ever be scoped, but the column cannot be
-- backfilled in Phase 2 because there is nothing to derive it from. They are
-- deliberately EXCLUDED from Phases 2 and 4 and need a product decision first:
--
--   public.invites            -- keyed by email; does not record its org
--   public.whatsapp_sessions  -- keyed by phone; no org linkage
--   public.project_templates  -- global pool: a template authored in one
--                                customer is visible to every other
--   public.org_settings       -- named for per-org config, stores bare
--                                (key, value); its staging twin HAS org_id
--                                and is empty
--
-- Uncomment only alongside a decision on how each gets populated.
--
-- ALTER TABLE public.invites           ADD COLUMN IF NOT EXISTS org_id uuid;
-- ALTER TABLE public.whatsapp_sessions ADD COLUMN IF NOT EXISTS org_id uuid;
-- ALTER TABLE public.project_templates ADD COLUMN IF NOT EXISTS org_id uuid;
-- ALTER TABLE public.org_settings      ADD COLUMN IF NOT EXISTS org_id uuid;

-- ── Indexes ────────────────────────────────────────────────────────────────
--
-- CONCURRENTLY: no exclusive lock, two scans, cannot be in a transaction.
-- Every one of these is the index an `org_id = $1` predicate will need the
-- moment Phase 6 makes RLS evaluate it on every row.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_org_id               ON public.tasks(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_members_org_id        ON public.team_members(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_assignments_org_id ON public.project_assignments(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_org_id     ON public.activity_events(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_org_id       ON public.notifications(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approvals_org_id           ON public.approvals(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boards_org_id              ON public.boards(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_columns_org_id     ON public.project_columns(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saved_views_org_id         ON public.saved_views(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automations_org_id         ON public.automations(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_templates_org_id      ON public.task_templates(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_definitions_org_id   ON public.field_definitions(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_schedules_org_id    ON public.report_schedules(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_comments_org_id       ON public.task_comments(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_reminders_org_id      ON public.task_reminders(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_time_entries_org_id        ON public.time_entries(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_clients_org_id        ON public.task_clients(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_values_org_id        ON public.field_values(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_columns_org_id       ON public.board_columns(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_org_id            ON public.mentions(org_id);

-- ── Deliberately NOT DONE in this phase ────────────────────────────────────
--
-- 1. NO foreign key to staging.organisations(id). A cross-schema FK on 21
--    tables adds a referential check to every INSERT before a single row has
--    a value, and would have to be validated against residue that Phase 2 is
--    known to leave behind. Reconsider after Phase 4 validates clean.
--
-- 2. NO change to any `staging.*` table. In particular NOT
--    `staging.user_roles` — see PROPOSED_079 and report §7. `org_id IS NULL`
--    there means "platform scope" and is load-bearing for every platform
--    guard, including the spend-analytics gate.
--
-- 3. NO change to the 13 shadowed `staging` twins (report §1.2). They already
--    have `org_id` and are empty; the live rows are in `public`. Touching them
--    creates the illusion of progress and moves nothing.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Clean and complete: nothing reads the column at this phase, so dropping it
-- cannot lose data that anything depends on. Drop indexes first.
--
-- SET lock_timeout = '3s';
--
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_tasks_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_team_members_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_project_assignments_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_activity_events_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_approvals_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_boards_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_project_columns_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_saved_views_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_automations_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_task_templates_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_field_definitions_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_report_schedules_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_task_comments_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_task_reminders_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_time_entries_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_task_clients_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_field_values_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_columns_org_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_mentions_org_id;
--
-- ALTER TABLE public.tasks               DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.team_members        DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.project_assignments DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.activity_events     DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.notifications       DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.approvals           DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.boards              DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.project_columns     DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.saved_views         DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.automations         DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.task_templates      DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.field_definitions   DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.report_schedules    DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.task_comments       DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.task_reminders      DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.time_entries        DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.task_clients        DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.field_values        DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.board_columns       DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.mentions            DROP COLUMN IF EXISTS org_id;
--
-- If a CONCURRENTLY build was interrupted it leaves an INVALID index. Find and
-- drop those before retrying:
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE NOT i.indisvalid AND c.relname LIKE 'idx_%_org_id';
