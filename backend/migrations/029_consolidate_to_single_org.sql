-- ============================================================
-- Migration 029: Consolidate all orgs into "Aekam Inc"
-- ============================================================
-- Keeps the "Aekam Inc" org, repoints all teams/projects to it,
-- and deactivates (not deletes) the rest. No project data is lost.

BEGIN;

DO $$
DECLARE
  keeper_id UUID;
BEGIN
  SELECT id INTO keeper_id
  FROM staging.organisations
  WHERE name = 'Aekam Inc'
  LIMIT 1;

  IF keeper_id IS NULL THEN
    RAISE EXCEPTION 'No org named "Aekam Inc" found — aborting';
  END IF;

  -- Repoint all teams to the keeper org
  UPDATE teams SET org_id = keeper_id WHERE org_id IS DISTINCT FROM keeper_id;

  -- hub_clients
  UPDATE staging.hub_clients SET org_id = keeper_id WHERE org_id != keeper_id;

  -- hub_social_accounts — org_id is UNIQUE, delete non-keeper dupes first
  DELETE FROM staging.hub_social_accounts WHERE org_id != keeper_id;

  -- subscriptions — org_id is PK, delete non-keeper rows (keeper keeps its sub)
  DELETE FROM staging.subscriptions WHERE org_id != keeper_id;

  -- module_subscriptions — UNIQUE(org_id, module_code)
  DELETE FROM staging.module_subscriptions WHERE org_id != keeper_id
    AND module_code IN (SELECT module_code FROM staging.module_subscriptions WHERE org_id = keeper_id);
  UPDATE staging.module_subscriptions SET org_id = keeper_id WHERE org_id != keeper_id;

  -- user_roles (org-scoped) — UNIQUE(user_id, org_id, role_code)
  DELETE FROM staging.user_roles WHERE org_id IS NOT NULL AND org_id != keeper_id
    AND (user_id, role_code) IN (SELECT user_id, role_code FROM staging.user_roles WHERE org_id = keeper_id);
  UPDATE staging.user_roles SET org_id = keeper_id WHERE org_id IS NOT NULL AND org_id != keeper_id;

  -- org_member_modules — UNIQUE(user_id, org_id, module_code)
  DELETE FROM staging.org_member_modules WHERE org_id != keeper_id
    AND (user_id, module_code) IN (SELECT user_id, module_code FROM staging.org_member_modules WHERE org_id = keeper_id);
  UPDATE staging.org_member_modules SET org_id = keeper_id WHERE org_id != keeper_id;

  -- graha
  UPDATE staging.graha_contacts SET org_id = keeper_id WHERE org_id != keeper_id;
  -- graha_pipelines — UNIQUE(org_id, name)
  DELETE FROM staging.graha_pipelines WHERE org_id != keeper_id
    AND name IN (SELECT name FROM staging.graha_pipelines WHERE org_id = keeper_id);
  UPDATE staging.graha_pipelines SET org_id = keeper_id WHERE org_id != keeper_id;
  UPDATE staging.graha_deals SET org_id = keeper_id WHERE org_id != keeper_id;

  -- ganit
  UPDATE staging.ganit_products SET org_id = keeper_id WHERE org_id != keeper_id;
  UPDATE staging.ganit_invoices SET org_id = keeper_id WHERE org_id != keeper_id;

  -- manav
  UPDATE staging.manav_employees SET org_id = keeper_id WHERE org_id != keeper_id;

  -- prachar — UNIQUE(org_id, platform, external_account_id)
  DELETE FROM staging.prachar_ad_accounts WHERE org_id != keeper_id
    AND (platform, external_account_id) IN (
      SELECT platform, external_account_id FROM staging.prachar_ad_accounts WHERE org_id = keeper_id);
  UPDATE staging.prachar_ad_accounts SET org_id = keeper_id WHERE org_id != keeper_id;

  -- subscription_invoices
  UPDATE staging.subscription_invoices SET org_id = keeper_id WHERE org_id != keeper_id;

  -- usage_tracking — UNIQUE(org_id, metric, recorded_at)
  DELETE FROM staging.usage_tracking WHERE org_id != keeper_id
    AND (metric, recorded_at) IN (SELECT metric, recorded_at FROM staging.usage_tracking WHERE org_id = keeper_id);
  UPDATE staging.usage_tracking SET org_id = keeper_id WHERE org_id != keeper_id;

  -- subscription_events
  UPDATE staging.subscription_events SET org_id = keeper_id WHERE org_id != keeper_id;

  -- vikray — UNIQUE(org_id, salesperson_id, period_start) and UNIQUE(org_id, employee_id, effective_from) and UNIQUE(org_id, month)
  -- These tables may not have data in other orgs, but handle safely
  DELETE FROM staging.vikray_commissions WHERE org_id != keeper_id;
  DELETE FROM staging.vetana_salary_structures WHERE org_id != keeper_id;
  DELETE FROM staging.vetana_payroll_runs WHERE org_id != keeper_id;

  -- esign/shifts/sequences/report_delivery — UNIQUE(org_id, name) on shifts
  DELETE FROM staging.ganit_esign_signers WHERE contract_id IN (
    SELECT id FROM staging.ganit_esign_contracts WHERE org_id != keeper_id);
  DELETE FROM staging.ganit_esign_contracts WHERE org_id != keeper_id;
  UPDATE staging.ganit_esign_contracts SET org_id = keeper_id WHERE org_id != keeper_id;

  DELETE FROM staging.manav_shift_schedules WHERE shift_id IN (
    SELECT id FROM staging.manav_shifts WHERE org_id != keeper_id);
  DELETE FROM staging.manav_shift_bids WHERE shift_id IN (
    SELECT id FROM staging.manav_shifts WHERE org_id != keeper_id);
  DELETE FROM staging.manav_shift_swaps WHERE org_id != keeper_id;
  DELETE FROM staging.manav_shifts WHERE org_id != keeper_id
    AND name IN (SELECT name FROM staging.manav_shifts WHERE org_id = keeper_id);
  UPDATE staging.manav_shifts SET org_id = keeper_id WHERE org_id != keeper_id;

  UPDATE staging.prachar_sequences SET org_id = keeper_id WHERE org_id != keeper_id;
  UPDATE staging.dristi_scheduled_reports SET org_id = keeper_id WHERE org_id != keeper_id;

  -- CRM enhancements — custom fields, web forms, lead scoring
  DELETE FROM staging.graha_custom_fields WHERE org_id != keeper_id
    AND (entity_type, field_name) IN (SELECT entity_type, field_name FROM staging.graha_custom_fields WHERE org_id = keeper_id);
  UPDATE staging.graha_custom_fields SET org_id = keeper_id WHERE org_id != keeper_id;
  DELETE FROM staging.graha_web_forms WHERE org_id != keeper_id
    AND slug IN (SELECT slug FROM staging.graha_web_forms WHERE org_id = keeper_id);
  UPDATE staging.graha_web_forms SET org_id = keeper_id WHERE org_id != keeper_id;
  DELETE FROM staging.graha_lead_score_rules WHERE org_id != keeper_id
    AND name IN (SELECT name FROM staging.graha_lead_score_rules WHERE org_id = keeper_id);
  UPDATE staging.graha_lead_score_rules SET org_id = keeper_id WHERE org_id != keeper_id;

  -- Deactivate all other orgs (no hard delete — data preserved)
  UPDATE staging.organisations SET is_active = FALSE WHERE id != keeper_id;

  RAISE NOTICE 'Consolidated everything into org % (Aekam Inc). Other orgs deactivated.', keeper_id;
END $$;

COMMIT;
