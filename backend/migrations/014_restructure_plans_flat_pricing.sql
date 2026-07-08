-- ============================================================
-- Migration 014: Restructure plans — flat monthly pricing
-- Old per-user plans → flat INR tiers (10k/15k/20k).
-- Srijan is bundled into every paid plan (no separate activation).
-- Pricing is internal — never shown to clients.
-- ============================================================

-- Drop the restrictive CHECK constraint on plan codes
ALTER TABLE staging.plans DROP CONSTRAINT IF EXISTS plans_code_check;

-- Deactivate old per-user plans
UPDATE staging.plans SET is_active = FALSE
WHERE code IN ('free', 'professional', 'business', 'enterprise');

-- New flat monthly tiers
INSERT INTO staging.plans (name, code, price_monthly, price_annual, max_users, features, is_active)
VALUES
('Starter', 'starter', 10000, 108000, NULL,
 '{"tasks": true, "projects": true, "docs": true, "kanban": true, "srijan": true, "srijan_credits_monthly": 500, "max_clients": 5}',
 TRUE),
('Growth', 'growth', 15000, 162000, NULL,
 '{"tasks": true, "projects": true, "docs": true, "kanban": true, "srijan": true, "srijan_credits_monthly": 1500, "max_clients": 15, "priority_support": true}',
 TRUE),
('Scale', 'scale', 20000, 216000, NULL,
 '{"tasks": true, "projects": true, "docs": true, "kanban": true, "srijan": true, "srijan_credits_monthly": 5000, "max_clients": 50, "priority_support": true, "custom_branding": true, "api_access": true}',
 TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  price_annual = EXCLUDED.price_annual,
  max_users = EXCLUDED.max_users,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;

-- Srijan, Prachar, Vikray no longer separate add-ons
UPDATE staging.add_on_modules SET is_active = FALSE
WHERE code IN ('srijan', 'prachar', 'vikray');
