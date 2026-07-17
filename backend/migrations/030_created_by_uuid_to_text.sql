-- ============================================================
-- Migration 030: Change created_by/assigned_to/approved_by from UUID to TEXT
-- ============================================================
-- Production user_ids are text (e.g. "user_admin001"), not UUIDs.
-- Staging module tables had these columns as UUID, causing 500 errors
-- on every INSERT. Already applied manually via Supabase SQL tool.

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'graha_contacts', 'graha_deals', 'graha_activities', 'graha_follow_ups',
    'ganit_invoices', 'ganit_expenses', 'ganit_contracts', 'ganit_recurring',
    'manav_employees', 'manav_announcements',
    'vikray_orders', 'vikray_targets',
    'vetana_payroll_runs', 'vetana_salary_structures',
    'prachar_automations', 'prachar_campaigns', 'prachar_templates',
    'dristi_dashboards',
    'hub_content_items', 'hub_credit_transactions',
    'sales_playbooks', 'sales_proposal_templates', 'sales_proposals', 'sales_targets',
    'mkt_campaigns', 'mkt_email_templates', 'mkt_landing_pages', 'mkt_segments', 'mkt_web_forms'
  ];
  cols TEXT[] := ARRAY['created_by', 'approved_by', 'assigned_to', 'reporting_to', 'cancelled_by'];
  t TEXT;
  c TEXT;
  r RECORD;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR r IN
      SELECT tc.constraint_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'staging' AND tc.table_name = t
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = ANY(cols)
    LOOP
      EXECUTE format('ALTER TABLE staging.%I DROP CONSTRAINT IF EXISTS %I', t, r.constraint_name);
    END LOOP;

    FOREACH c IN ARRAY cols LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='staging' AND table_name=t AND column_name=c AND data_type='uuid'
      ) THEN
        EXECUTE format('ALTER TABLE staging.%I ALTER COLUMN %I TYPE TEXT USING %I::text', t, c, c);
      END IF;
    END LOOP;
  END LOOP;
END $$;
