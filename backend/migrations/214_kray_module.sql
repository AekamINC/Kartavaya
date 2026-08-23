-- Migration 214: Register the kray (procurement) module
-- ALREADY APPLIED via Supabase MCP on 2026-08-23.
--
-- Additive only: inserts entitlement rows so that every org and member who
-- currently holds ganit also holds kray. No existing behaviour changes.
--
-- RISK: if the backend deploys with require_module("kray") BEFORE this
-- migration runs, every procurement route 403s for everyone. Apply first.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ── Step 1: Give kray to every org that holds ganit ─────────────────────────
INSERT INTO staging.module_subscriptions (org_id, module_code, is_active, activated_at)
SELECT org_id, 'kray', TRUE, NOW()
FROM staging.module_subscriptions
WHERE module_code = 'ganit' AND is_active = TRUE
ON CONFLICT DO NOTHING;

-- ── Step 2: Copy member-level grants ────────────────────────────────────────
-- Everyone who can see Finance can see Procurement on day one, at the same
-- role they already hold.
INSERT INTO staging.org_member_modules (org_id, user_id, module_code, role, granted_by, granted_at)
SELECT org_id, user_id, 'kray', role, granted_by, NOW()
FROM staging.org_member_modules
WHERE module_code = 'ganit'
ON CONFLICT DO NOTHING;
