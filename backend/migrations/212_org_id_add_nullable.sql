-- Migration 212: Add nullable org_id to 20 public-schema child tables
-- ALREADY APPLIED via Supabase MCP on 2026-08-23.
-- This file is the record; DO NOT re-run.
--
-- Phase 076 of tenancy cutover: add the column, index it, backfill from
-- the parent's org_id (teams → 1-hop → 2-hop → 3-hop), then verify.

-- ── Column additions ────────────────────────────────────────────────────
ALTER TABLE public.team_members       ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.project_assignments ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.project_columns    ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.tasks              ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_comments      ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_clients       ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_reminders     ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.task_templates     ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.approvals          ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.notifications      ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.time_entries       ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.activity_events    ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.mentions           ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.saved_views        ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.field_definitions  ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.field_values       ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.report_schedules   ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.boards             ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.board_columns      ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.board_items        ADD COLUMN IF NOT EXISTS org_id uuid;

-- ── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_team_members_org       ON public.team_members (org_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_org ON public.project_assignments (org_id);
CREATE INDEX IF NOT EXISTS idx_project_columns_org    ON public.project_columns (org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org              ON public.tasks (org_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_org      ON public.task_comments (org_id);
CREATE INDEX IF NOT EXISTS idx_task_clients_org       ON public.task_clients (org_id);
CREATE INDEX IF NOT EXISTS idx_task_reminders_org     ON public.task_reminders (org_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_org     ON public.task_templates (org_id);
CREATE INDEX IF NOT EXISTS idx_approvals_org          ON public.approvals (org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org      ON public.notifications (org_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_org       ON public.time_entries (org_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_org    ON public.activity_events (org_id);
CREATE INDEX IF NOT EXISTS idx_mentions_org           ON public.mentions (org_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_org        ON public.saved_views (org_id);
CREATE INDEX IF NOT EXISTS idx_field_definitions_org  ON public.field_definitions (org_id);
CREATE INDEX IF NOT EXISTS idx_field_values_org       ON public.field_values (org_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_org   ON public.report_schedules (org_id);
CREATE INDEX IF NOT EXISTS idx_boards_org             ON public.boards (org_id);
CREATE INDEX IF NOT EXISTS idx_board_columns_org      ON public.board_columns (org_id);
CREATE INDEX IF NOT EXISTS idx_board_items_org        ON public.board_items (org_id);

-- ── Backfill (077) ──────────────────────────────────────────────────────
-- Tier 1: tables that join directly to teams
UPDATE public.team_members tm       SET org_id = t.org_id FROM public.teams t WHERE t.team_id = tm.team_id AND tm.org_id IS NULL;
UPDATE public.project_assignments pa SET org_id = t.org_id FROM public.teams t WHERE t.team_id = pa.team_id AND pa.org_id IS NULL;
UPDATE public.project_columns pc   SET org_id = t.org_id FROM public.teams t WHERE t.team_id = pc.team_id AND pc.org_id IS NULL;
UPDATE public.tasks tk             SET org_id = t.org_id FROM public.teams t WHERE t.team_id = tk.team_id AND tk.org_id IS NULL;
UPDATE public.approvals ap         SET org_id = t.org_id FROM public.teams t WHERE t.team_id = ap.team_id AND ap.org_id IS NULL;
UPDATE public.notifications n      SET org_id = t.org_id FROM public.teams t WHERE t.team_id = n.team_id AND n.org_id IS NULL;
UPDATE public.saved_views sv       SET org_id = t.org_id FROM public.teams t WHERE t.team_id = sv.team_id AND sv.org_id IS NULL;
UPDATE public.field_definitions fd SET org_id = t.org_id FROM public.teams t WHERE t.team_id = fd.team_id AND fd.org_id IS NULL;
UPDATE public.task_templates tt    SET org_id = t.org_id FROM public.teams t WHERE t.team_id = tt.team_id AND tt.org_id IS NULL;
UPDATE public.report_schedules rs  SET org_id = t.org_id FROM public.teams t WHERE t.team_id = rs.team_id AND rs.org_id IS NULL;
UPDATE public.activity_events ae   SET org_id = t.org_id FROM public.teams t WHERE t.team_id = ae.team_id AND ae.org_id IS NULL;
UPDATE public.boards b             SET org_id = t.org_id FROM public.teams t WHERE t.team_id = b.team_id AND b.org_id IS NULL;
UPDATE public.board_columns bc     SET org_id = b.org_id FROM public.boards b WHERE b.board_id = bc.board_id AND bc.org_id IS NULL;

-- Tier 2: tables that join to tasks or boards
UPDATE public.task_comments tc     SET org_id = tk.org_id FROM public.tasks tk WHERE tk.task_id = tc.task_id AND tc.org_id IS NULL;
UPDATE public.task_clients tcl     SET org_id = tk.org_id FROM public.tasks tk WHERE tk.task_id = tcl.task_id AND tcl.org_id IS NULL;
UPDATE public.task_reminders tr    SET org_id = tk.org_id FROM public.tasks tk WHERE tk.task_id = tr.task_id AND tr.org_id IS NULL;
UPDATE public.time_entries te      SET org_id = tk.org_id FROM public.tasks tk WHERE tk.task_id = te.task_id AND te.org_id IS NULL;
UPDATE public.field_values fv      SET org_id = tk.org_id FROM public.tasks tk WHERE tk.task_id = fv.task_id AND fv.org_id IS NULL;
UPDATE public.board_items bi       SET org_id = bc.org_id FROM public.board_columns bc WHERE bc.column_id = bi.column_id AND bi.org_id IS NULL;

-- Tier 3: tables that join to task_comments
UPDATE public.mentions m           SET org_id = tc.org_id FROM public.task_comments tc WHERE tc.comment_id = m.comment_id AND m.org_id IS NULL;
