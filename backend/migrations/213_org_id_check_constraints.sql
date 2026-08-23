-- Migration 213: CHECK constraints enforcing org_id on 13 public-schema tables
-- ALREADY APPLIED via Supabase MCP on 2026-08-23.
-- This file is the record; DO NOT re-run.
--
-- Phase 079 of tenancy cutover: enforce org_id presence on all tables where
-- the column was added (migration 212) and all INSERT paths updated (78e13f00).
--
-- Pre-apply fixes (same session):
--   - 1 task with team_id='' (empty string) → set to NULL
--   - 21 notifications referencing deleted team → team_id set to NULL
--
-- Tier-2 tables (task_comments, task_reminders, time_entries, task_clients,
-- field_values, board_columns, mentions) are NOT constrained here: their NULL
-- org_id rows belong to personal tasks (team_id IS NULL on the parent), and
-- these tables have no team_id column of their own to express the conditional.
-- Protection comes from the parent task's constraint + application code.

SET lock_timeout = '3s';
SET statement_timeout = '300s';

-- ── Step 1: ADD CONSTRAINT NOT VALID (catalog-only, sub-ms) ───────────────

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

-- ── Step 2: VALIDATE (non-blocking scan, SHARE UPDATE EXCLUSIVE) ──────────

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
