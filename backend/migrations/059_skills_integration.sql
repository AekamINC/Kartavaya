-- ============================================================
-- Migration 059: Srijan Skills Integration
-- Extends skill templates for automation/detection/analysis,
-- adds org-scoped skills, feedback loop for self-learning.
-- ============================================================

-- 1. Extend hub_skill_templates with skill_type, scope, module, trigger, system flag
ALTER TABLE staging.hub_skill_templates
  ADD COLUMN IF NOT EXISTS skill_type text NOT NULL DEFAULT 'content'
    CHECK (skill_type IN ('content', 'automation', 'detection', 'analysis')),
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'client'
    CHECK (scope IN ('client', 'org')),
  ADD COLUMN IF NOT EXISTS module text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_config jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_system bool DEFAULT FALSE;

-- 2. Allow org-scoped skills (client_id nullable, org_id added)
ALTER TABLE staging.hub_client_skills
  ADD COLUMN IF NOT EXISTS org_id uuid DEFAULT NULL;

ALTER TABLE staging.hub_client_skills
  ALTER COLUMN client_id DROP NOT NULL;

-- Add constraint only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_or_org'
  ) THEN
    ALTER TABLE staging.hub_client_skills
      ADD CONSTRAINT client_or_org CHECK (client_id IS NOT NULL OR org_id IS NOT NULL);
  END IF;
END $$;

-- Also relax unique constraint for org-level skills
ALTER TABLE staging.hub_client_skills
  DROP CONSTRAINT IF EXISTS hub_client_skills_client_id_template_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_client_skills_client_tpl
  ON staging.hub_client_skills(client_id, template_id) WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_client_skills_org_tpl
  ON staging.hub_client_skills(org_id, template_id) WHERE org_id IS NOT NULL AND client_id IS NULL;

-- Add last_run_at for cron scheduling
ALTER TABLE staging.hub_client_skills
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz DEFAULT NULL;

-- 3. Skill Feedback table for self-learning
CREATE TABLE IF NOT EXISTS staging.hub_skill_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_template_id uuid REFERENCES staging.hub_skill_templates(id),
  org_id uuid NOT NULL,
  input_hash text,
  predicted jsonb,
  corrected jsonb,
  accepted bool DEFAULT TRUE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_feedback_lookup
  ON staging.hub_skill_feedback(skill_template_id, org_id, created_at DESC);

-- 4. Seed 17 system skill templates
INSERT INTO staging.hub_skill_templates
  (name, description, skill_type, scope, module, category, trigger_config, steps, is_system, is_active)
VALUES
-- Ganit (Accounting)
(
  'Overdue Invoice Alert',
  'Detect invoices past due date and notify the assigned user',
  'detection', 'org', 'ganit', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "ganit_overdue_invoices", "params": {"days_overdue": 7}}]',
  TRUE, TRUE
),
(
  'Recurring Invoice Generator',
  'Automatically create invoices from recurring templates on schedule',
  'automation', 'org', 'ganit', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "ganit_recurring_invoices"}]',
  TRUE, TRUE
),
(
  'Expense Categorizer',
  'Auto-categorize uncategorized expenses using past patterns',
  'analysis', 'org', 'ganit', 'general',
  '{"type": "cron", "interval_minutes": 360}',
  '[{"order": 1, "skill_function": "ganit_categorize_expenses"}]',
  TRUE, TRUE
),
-- Manav (HRMS)
(
  'Attendance Auto-Mark',
  'Mark attendance for employees based on check-in device data',
  'automation', 'org', 'manav', 'general',
  '{"type": "cron", "interval_minutes": 60}',
  '[{"order": 1, "skill_function": "manav_auto_mark_attendance"}]',
  TRUE, TRUE
),
(
  'Leave Balance Sync',
  'Recalculate and sync leave balances at end of each day',
  'automation', 'org', 'manav', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "manav_sync_leave_balances"}]',
  TRUE, TRUE
),
(
  'Shift Scheduler',
  'Auto-assign employee shifts based on availability and policy rules',
  'automation', 'org', 'manav', 'general',
  '{"type": "cron", "interval_minutes": 10080}',
  '[{"order": 1, "skill_function": "manav_schedule_shifts"}]',
  TRUE, TRUE
),
(
  'Onboarding Checklist',
  'Create onboarding task checklists for newly added employees',
  'automation', 'org', 'manav', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "manav_onboarding_checklist"}]',
  TRUE, TRUE
),
-- Vetana (Payroll)
(
  'Payroll Trigger',
  'Trigger payroll processing on scheduled dates',
  'automation', 'org', 'vetana', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "vetana_trigger_payroll"}]',
  TRUE, TRUE
),
(
  'Payslip Delivery',
  'Generate and email payslips to employees after payroll run',
  'automation', 'org', 'vetana', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "vetana_deliver_payslips"}]',
  TRUE, TRUE
),
-- Vikray (Inventory)
(
  'Low Stock Alert',
  'Detect products below reorder level and alert the org admin',
  'detection', 'org', 'vikray', 'general',
  '{"type": "cron", "interval_minutes": 720}',
  '[{"order": 1, "skill_function": "vikray_low_stock_alert"}]',
  TRUE, TRUE
),
-- Graha (CRM)
(
  'Stale Deal Detector',
  'Flag deals that have not progressed for a configurable number of days',
  'detection', 'org', 'graha', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "graha_stale_deals", "params": {"stale_days": 14}}]',
  TRUE, TRUE
),
(
  'Follow-Up Reminder',
  'Create reminders for contacts with no recent activity',
  'detection', 'org', 'graha', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "graha_followup_reminders", "params": {"inactive_days": 30}}]',
  TRUE, TRUE
),
(
  'Contact Deduplication',
  'Scan for and flag duplicate contacts within the org',
  'analysis', 'org', 'graha', 'general',
  '{"type": "cron", "interval_minutes": 10080}',
  '[{"order": 1, "skill_function": "graha_contact_dedup"}]',
  TRUE, TRUE
),
-- PM (Project Management)
(
  'Deadline Escalation',
  'Escalate tasks past their deadline to the project manager',
  'detection', 'org', 'pm', 'general',
  '{"type": "cron", "interval_minutes": 720}',
  '[{"order": 1, "skill_function": "pm_deadline_escalation"}]',
  TRUE, TRUE
),
(
  'Auto-Archive Completed',
  'Archive projects and tasks completed more than 90 days ago',
  'automation', 'org', 'pm', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "pm_auto_archive", "params": {"days_completed": 90}}]',
  TRUE, TRUE
),
-- Dristi (Reports)
(
  'Report Scheduler',
  'Generate and email scheduled reports to configured recipients',
  'automation', 'org', 'dristi', 'general',
  '{"type": "cron", "interval_minutes": 1440}',
  '[{"order": 1, "skill_function": "dristi_scheduled_reports"}]',
  TRUE, TRUE
),
-- Prachar (Marketing / Srijan)
(
  'Campaign Scheduler',
  'Auto-publish scheduled marketing campaign content',
  'automation', 'org', 'prachar', 'general',
  '{"type": "cron", "interval_minutes": 60}',
  '[{"order": 1, "skill_function": "prachar_campaign_scheduler"}]',
  TRUE, TRUE
)
ON CONFLICT DO NOTHING;
