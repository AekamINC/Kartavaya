-- ============================================================
-- Migration 124: the Tier-2 role codes the CHECK constraint refuses
--
-- NOT APPLIED. Staging and production share ONE `staging` schema, so running
-- this is a production change. It is written here and applied by hand.
--
-- ── WHAT IS ACTUALLY ON THE DATABASE ─────────────────────────────────────────
--
-- Read out of the live catalog on 2026-08-06 (read-only, pg_constraint):
--
--   CHECK (role_code = ANY (ARRAY[
--     'platform_owner','platform_admin','platform_manager','platform_staff',
--     'platform_support','account_manager','account_finance',
--     'srijan_admin','developer',
--     'org_owner','org_admin','org_member']))
--
-- The migration ledger does NOT say that. `025_org_member_modules.sql` is the
-- last numbered file that touches this constraint and it lists eight codes;
-- four more were added to the live database by some path that left no file.
-- Trust the catalog, never the ledger.
--
-- ── THE THREE NEW CODES ──────────────────────────────────────────────────────
--
--   hr_admin     Tier 2. The ORGANISATION's HR administrator: Manav and
--                Pahchan, in their own org, and nothing else. Consumes a seat.
--                Ceiling enforced in `middleware/subscription.require_module`
--                via `role_tiers.refuse_module_for_org_roles`.
--
--   org_client   Tier 2, PROJECT-ONLY. The customer's own client.
--   aekam_team   Tier 2, PROJECT-ONLY. Aekam's people on a customer project.
--
--                Both see projects, tasks, task approvals and notifications and
--                nothing else, and both consume NO seat. They reach ZERO
--                modules — `role_tiers.PROJECT_ONLY_MODULES` is the empty set —
--                which is what makes them free. Anything wider goes through a
--                support session (`platform_support_sessions`, 959eb031).
--
-- Two codes are different people with one permission set on purpose: an audit
-- that cannot tell "our client saw this" from "the vendor saw this" is not an
-- audit.
--
-- ── ONE CORRECTION CARRIED IN THE SAME STATEMENT ─────────────────────────────
--
-- `sahayak_admin` IS NOT IN THE LIVE CONSTRAINT. `srijan_admin` is — the
-- constraint was never migrated when the module was renamed in 108. So
-- `middleware/role_tiers.py` is wrong where it says of `sahayak_admin` that "it
-- already exists in the live CHECK constraint": assigning it today is a 23514
-- from Postgres on the INSERT, not a 400 from the API. Nobody has hit it
-- because the role has zero holders.
--
-- It is corrected here rather than in a file of its own because a CHECK
-- constraint cannot be amended — it is dropped and rebuilt from the full list,
-- so every code has to be retyped anyway, and leaving a known-broken one out of
-- that retype would be a decision to keep it broken.
--
-- `srijan_admin` and `developer` STAY. Both are refused by the application
-- (`role_tiers.modules_for` answers nothing for either) but dropping a code from
-- the constraint makes existing rows holding it unwritable, and this migration
-- is not the place to find out whether any exist.
--
-- ── ORDER, AND WHY THERE IS NO DATA CHANGE ───────────────────────────────────
--
-- Constraint first, application second. The backend already refuses to write
-- these codes anywhere the constraint would reject them — `assign_role`
-- validates against `role_tiers` before the INSERT — so this widening grants
-- nothing on its own and takes nothing away. It inserts no rows: who holds
-- `hr_admin` is a decision for a human at the console, not for a migration.
--
-- ROLLBACK: re-run the DROP and re-ADD with the twelve codes quoted at the top
-- of this file. Safe only while no row holds one of the three new codes —
--   SELECT COUNT(*) FROM staging.user_roles
--    WHERE role_code IN ('hr_admin','org_client','aekam_team');
-- must be 0 first, or the re-add fails and leaves the table unconstrained.
-- ============================================================

BEGIN;

ALTER TABLE staging.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_code_check;

ALTER TABLE staging.user_roles ADD CONSTRAINT user_roles_role_code_check
    CHECK (role_code IN (
        -- Tier 1 — platform. `platform_admin` is the legacy spelling of
        -- `platform_owner` and is retired by deleting rows, not code.
        'platform_owner', 'platform_admin', 'platform_manager', 'platform_staff',
        'platform_support', 'account_manager', 'account_finance',
        'sahayak_admin',
        -- Retained so existing rows stay writable. Both reach nothing.
        'srijan_admin', 'developer',
        -- Tier 2 — organisation.
        'org_owner', 'org_admin', 'org_member',
        -- Tier 2 — the HR administrator, and the two project-only roles.
        'hr_admin', 'org_client', 'aekam_team'
    ));

COMMIT;

-- Verify (read-only, after applying):
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'staging.user_roles'::regclass AND conname = 'user_roles_role_code_check';
--
--   SELECT role_code, org_id IS NULL AS platform_scope, COUNT(*)
--     FROM staging.user_roles GROUP BY 1, 2 ORDER BY 2 DESC, 3 DESC;
