-- PROPOSED_079_org_id_constrain.sql
-- Phase 4 of 6 — multi-tenancy cutover. See swarm-reports/audit-tenancy-org-id-cutover.md
-- REQUIRES: PROPOSED_076, 077 applied, and PROPOSED_078 output READ BY A HUMAN.
--
-- ############################################################################
-- ##  PROPOSAL ONLY — NOT APPLIED, NOT SCHEDULED.                           ##
-- ##  FIRST PHASE THAT CAN REJECT WRITES. Any insert path that does not     ##
-- ##  set org_id starts failing the moment a constraint is VALIDATED.       ##
-- ############################################################################
--
-- ── READ THIS FIRST: staging.user_roles IS EXCLUDED, DELIBERATELY ─────────
--
--   Do NOT extend this file to `staging.user_roles.org_id`. Do not add
--   NOT NULL to it. Do not "finish the job" by sweeping the staging schema.
--
--   `org_id IS NULL` in `staging.user_roles` MEANS "platform scope". It is not
--   a missing value. Live distribution at audit time:
--
--       platform_admin    org_id IS NULL   4 rows
--       platform_staff    org_id IS NULL   4 rows
--       platform_manager  org_id IS NULL   2 rows
--       org_admin         org_id set       4 rows
--       org_member        org_id set       6 rows
--       org_owner         org_id set       1 row
--
--   Those 10 NULLs are how every platform guard in the system identifies staff.
--   The predicate `WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY(...)`
--   appears at 12 sites: middleware/roles.py:41,73,108,133,140,169;
--   middleware/org_resolver.py:35; middleware/subscription.py:77;
--   routers/activity.py:34; routers/admin_orgs.py:757; auth_router.py:220.
--
--   Constraining that column invalidates all 10 rows at once. Every platform
--   console — spend analytics, billing, org admin, ROLE ASSIGNMENT — stops
--   matching anyone simultaneously. It fails CLOSED, so it is a total lockout
--   rather than a leak; but the god-mode accounts needed to undo it are
--   themselves the accounts locked out.
--
--   (Underlying weakness, noted not fixed: `org_id IS NULL` is doing double
--   duty as both "platform-wide scope" and "value not set". A `scope` column
--   with CHECK ((scope='platform') = (org_id IS NULL)) would separate the two
--   facts and make NOT NULL safe to reason about. That is a schema redesign,
--   not a cutover step.)
--
-- ── WHY CHECK ... NOT VALID INSTEAD OF SET NOT NULL ───────────────────────
--
--   `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` performs a FULL TABLE SCAN
--   while holding ACCESS EXCLUSIVE. Reads and writes both block for the whole
--   scan. On today's tables (largest 480 kB) that is imperceptible; on a table
--   of any real size it is a hard outage, and this file is meant to still be
--   correct then.
--
--   `ADD CONSTRAINT ... CHECK (...) NOT VALID` takes ACCESS EXCLUSIVE only
--   momentarily to write the catalog entry — no scan. It immediately enforces
--   the predicate on all new INSERTs and UPDATEs; it simply does not assert
--   anything about rows already present.
--
--   `VALIDATE CONSTRAINT` then scans the table under SHARE UPDATE EXCLUSIVE,
--   which blocks neither reads nor writes (only DDL and VACUUM). It can run
--   for as long as it needs without an outage, and can be cancelled and
--   retried freely.
--
--   Net effect: the column stays nullable in the catalog forever, and the
--   constraint does the work — with no window where the table is locked
--   against traffic.
--
-- ── THE CONDITIONAL SHAPE, AND THE DECISION IT ENCODES ────────────────────
--
--   `tasks` and `notifications` use `org_id IS NOT NULL OR team_id IS NULL`
--   rather than a bare NOT NULL. That encodes a specific product claim:
--
--       "A record with no project is legitimately user-global, and has no org.
--        A record WITH a project must know its org."
--
--   It rejects the failure this whole exercise is about (a project-scoped row
--   with no tenant) while permitting the 35 team-less tasks and 75 team-less
--   notifications that exist today.
--
--   If the product answer is instead that personal records belong to the
--   owner's org, then: run the OPTIONAL block in PROPOSED_077 first, confirm
--   residue is zero in PROPOSED_078 Q1, and replace these two constraints with
--   the unconditional form given at the bottom of this file.
--
-- LOCK DURATION
--   ADD CONSTRAINT NOT VALID : catalog write, sub-millisecond, ACCESS EXCLUSIVE
--                              (subject to the same acquisition queueing as
--                              Phase 1 — lock_timeout bounds it)
--   VALIDATE CONSTRAINT      : one sequential scan, SHARE UPDATE EXCLUSIVE,
--                              non-blocking for reads and writes.
--                              Today: milliseconds. Safe at any future size.
--
-- RISK: MEDIUM-HIGH.
--   The moment a constraint exists (even NOT VALID), writes that omit org_id
--   fail. As of this audit NO backend code sets `public.*.org_id` on insert —
--   the column does not exist yet in the application's world. Therefore:
--
--     >> THE APPLICATION MUST BE WRITING org_id BEFORE THIS FILE RUNS. <<
--
--   Otherwise every task creation, comment, notification and activity event
--   starts failing immediately. Sequence is: 076 -> 077 -> 078 -> ship the
--   application change that populates org_id on insert -> re-run 077 to catch
--   rows created in between -> 078 again -> only then 079.

SET lock_timeout = '3s';
SET statement_timeout = '300s';

-- ── Step 1: declare the constraints (fast, no scan) ────────────────────────

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_org_id_present
  CHECK (org_id IS NOT NULL OR team_id IS NULL) NOT VALID;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_org_id_present
  CHECK (org_id IS NOT NULL OR team_id IS NULL) NOT VALID;

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.project_assignments
  ADD CONSTRAINT project_assignments_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.boards
  ADD CONSTRAINT boards_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.project_columns
  ADD CONSTRAINT project_columns_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.saved_views
  ADD CONSTRAINT saved_views_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.field_definitions
  ADD CONSTRAINT field_definitions_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.report_schedules
  ADD CONSTRAINT report_schedules_org_id_present
  CHECK (org_id IS NOT NULL) NOT VALID;

-- Tier-2 children inherit the conditional shape from `tasks`: if the parent
-- task is user-global, so is the child. Expressing that as a CHECK on the
-- child alone is impossible (a CHECK cannot reference another table), so these
-- stay unconditional and depend on the OPTIONAL block in 077 having run, OR on
-- the orphans having been cleaned. PROPOSED_078 Q6 tells you which.
--
-- Left commented until Q6 reports zero violations for them.
--
-- ALTER TABLE public.task_comments
--   ADD CONSTRAINT task_comments_org_id_present  CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.task_reminders
--   ADD CONSTRAINT task_reminders_org_id_present CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.time_entries
--   ADD CONSTRAINT time_entries_org_id_present   CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.task_clients
--   ADD CONSTRAINT task_clients_org_id_present   CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.field_values
--   ADD CONSTRAINT field_values_org_id_present   CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.board_columns
--   ADD CONSTRAINT board_columns_org_id_present  CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.mentions
--   ADD CONSTRAINT mentions_org_id_present       CHECK (org_id IS NOT NULL) NOT VALID;

-- ── Step 2: validate (non-blocking scan) ──────────────────────────────────
--
-- Run these ONE AT A TIME and stop on the first failure. A failure names the
-- table but not the rows — find them with the matching query from
-- PROPOSED_078 Q6, fix, then re-run just that VALIDATE.
--
-- These are separated from Step 1 on purpose: if a VALIDATE fails, the NOT
-- VALID constraint from Step 1 is still in place and still protecting new
-- writes. You are not forced to roll back the whole phase to fix one table.

ALTER TABLE public.tasks               VALIDATE CONSTRAINT tasks_org_id_present;
ALTER TABLE public.notifications       VALIDATE CONSTRAINT notifications_org_id_present;
ALTER TABLE public.team_members        VALIDATE CONSTRAINT team_members_org_id_present;
ALTER TABLE public.project_assignments VALIDATE CONSTRAINT project_assignments_org_id_present;
ALTER TABLE public.activity_events     VALIDATE CONSTRAINT activity_events_org_id_present;
ALTER TABLE public.approvals           VALIDATE CONSTRAINT approvals_org_id_present;
ALTER TABLE public.boards              VALIDATE CONSTRAINT boards_org_id_present;
ALTER TABLE public.project_columns     VALIDATE CONSTRAINT project_columns_org_id_present;
ALTER TABLE public.saved_views         VALIDATE CONSTRAINT saved_views_org_id_present;
ALTER TABLE public.automations         VALIDATE CONSTRAINT automations_org_id_present;
ALTER TABLE public.task_templates      VALIDATE CONSTRAINT task_templates_org_id_present;
ALTER TABLE public.field_definitions   VALIDATE CONSTRAINT field_definitions_org_id_present;
ALTER TABLE public.report_schedules    VALIDATE CONSTRAINT report_schedules_org_id_present;

-- ── Unconditional variant, IF the product decision goes the other way ─────
--
-- Only after PROPOSED_077's OPTIONAL user-derived block has run and
-- PROPOSED_078 Q1 reports zero residue on both tables:
--
-- ALTER TABLE public.tasks         DROP CONSTRAINT tasks_org_id_present;
-- ALTER TABLE public.notifications DROP CONSTRAINT notifications_org_id_present;
-- ALTER TABLE public.tasks
--   ADD CONSTRAINT tasks_org_id_present         CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.notifications
--   ADD CONSTRAINT notifications_org_id_present CHECK (org_id IS NOT NULL) NOT VALID;
-- ALTER TABLE public.tasks         VALIDATE CONSTRAINT tasks_org_id_present;
-- ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_org_id_present;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- One statement per table, each instantaneous (catalog-only, ACCESS EXCLUSIVE
-- held momentarily). Dropping the constraint restores write availability
-- immediately and loses no data — the org_id values stay.
--
-- If production is rejecting writes RIGHT NOW, this is the fix, and it is safe
-- to run all of it without diagnosis first.
--
-- SET lock_timeout = '3s';
--
-- ALTER TABLE public.tasks               DROP CONSTRAINT IF EXISTS tasks_org_id_present;
-- ALTER TABLE public.notifications       DROP CONSTRAINT IF EXISTS notifications_org_id_present;
-- ALTER TABLE public.team_members        DROP CONSTRAINT IF EXISTS team_members_org_id_present;
-- ALTER TABLE public.project_assignments DROP CONSTRAINT IF EXISTS project_assignments_org_id_present;
-- ALTER TABLE public.activity_events     DROP CONSTRAINT IF EXISTS activity_events_org_id_present;
-- ALTER TABLE public.approvals           DROP CONSTRAINT IF EXISTS approvals_org_id_present;
-- ALTER TABLE public.boards              DROP CONSTRAINT IF EXISTS boards_org_id_present;
-- ALTER TABLE public.project_columns     DROP CONSTRAINT IF EXISTS project_columns_org_id_present;
-- ALTER TABLE public.saved_views         DROP CONSTRAINT IF EXISTS saved_views_org_id_present;
-- ALTER TABLE public.automations         DROP CONSTRAINT IF EXISTS automations_org_id_present;
-- ALTER TABLE public.task_templates      DROP CONSTRAINT IF EXISTS task_templates_org_id_present;
-- ALTER TABLE public.field_definitions   DROP CONSTRAINT IF EXISTS field_definitions_org_id_present;
-- ALTER TABLE public.report_schedules    DROP CONSTRAINT IF EXISTS report_schedules_org_id_present;
-- ALTER TABLE public.task_comments       DROP CONSTRAINT IF EXISTS task_comments_org_id_present;
-- ALTER TABLE public.task_reminders      DROP CONSTRAINT IF EXISTS task_reminders_org_id_present;
-- ALTER TABLE public.time_entries        DROP CONSTRAINT IF EXISTS time_entries_org_id_present;
-- ALTER TABLE public.task_clients        DROP CONSTRAINT IF EXISTS task_clients_org_id_present;
-- ALTER TABLE public.field_values        DROP CONSTRAINT IF EXISTS field_values_org_id_present;
-- ALTER TABLE public.board_columns       DROP CONSTRAINT IF EXISTS board_columns_org_id_present;
-- ALTER TABLE public.mentions            DROP CONSTRAINT IF EXISTS mentions_org_id_present;
--
-- To confirm nothing is left enforcing:
--   SELECT conrelid::regclass AS tbl, conname, convalidated
--     FROM pg_constraint WHERE conname LIKE '%_org_id_present';
