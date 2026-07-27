-- README.md documents the apply method as `psql "$DATABASE_URL" -f <file>`.
-- Without ON_ERROR_STOP, psql reports the guard's error and then CARRIES ON to
-- the next statement, which is exactly the failure this guard exists to prevent.
\set ON_ERROR_STOP on

-- ═════════════════════════════════════════════════════════════════════════════
-- ⛔ STOP — THIS FILE MUST NOT BE RUN AS WRITTEN. HARD GUARD BELOW.
--
-- Added by the migrations-consolidation agent after verifying this file against
-- the LIVE schema. Three of its statements are already satisfied, one is
-- actively harmful in the current order, and one is blocked on an unmade
-- product decision. Running it top-to-bottom now would damage the Tier-4 model.
--
-- VERIFIED LIVE (project toacecaewujfxjfrjwco, read-only):
--
--   §2 ADD COLUMN role ... DEFAULT 'admin'   → ALREADY EXISTS, DEFAULT 'viewer'.
--        PROPOSED_066 created it first. `IF NOT EXISTS` makes this line a NO-OP
--        THAT REPORTS SUCCESS — the 'admin' default silently does not happen.
--        Had the order been reversed, every grant would default to full control
--        and `role_tiers.DEFAULT_GRANT_LEVEL = VIEWER` would disagree with the
--        column backing it. THIS LINE MUST BE DELETED, not reordered: it cannot
--        do anything except mislead the next reader.
--
--   §2 org_member_modules_role_check          → ALREADY APPLIED, identical text.
--
--   §2 org_member_modules_not_sensitive       → NOT applied, and BLOCKED.
--        Forbids grant rows on vetana/ganit/manav/pahchan. `vetana` and `ganit`
--        are exactly `role_tiers.SEPARATED_DUTY_MODULES` — the only two modules
--        where admin does not satisfy approver, and therefore the ONLY two where
--        a distinct approver grant means anything. Applying this AFTER 066
--        keeps the four-level ladder and simultaneously forbids any grant row on
--        the two modules the ladder exists for. Tier 4 survives as a column that
--        can never be exercised where it matters.
--        This is mutually exclusive with PROPOSED_075. See §5 of that file.
--
--   §3 platform_support_sessions              → NOT applied. INDEPENDENT AND SAFE
--        in any position. This is the only section that can go today.
--
--   §1's claim "the CHECK has never heard of platform_support" → STALE. The live
--        user_roles_role_code_check already admits platform_owner,
--        platform_manager, platform_staff AND platform_support.
--
-- WHAT TO DO: split this file. Take §3 as its own migration. Delete §2's
-- ADD COLUMN and role_check (both already true). Hold §2's not_sensitive until
-- the owner resolves the RBAC-SPEC self-contradiction recorded in
-- swarm-reports/_COORDINATION.md §5 — and if it loses, DELETE it rather than
-- leaving it here to be applied later by someone reading numbers.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE EXCEPTION
        'PROPOSED_065 must not be applied as written. Its ADD COLUMN is a silent '
        'no-op (066 already created the column with a DIFFERENT default), its '
        'role_check is already applied, and its not_sensitive CHECK forbids grant '
        'rows on vetana/ganit — the only two separated-duty modules — which '
        'removes the Tier-4 approver rung entirely. Split the file: section 3 is '
        'safe alone. See the header, and swarm-reports/_COORDINATION.md section 5.';
END $$;

-- PROPOSED — NOT APPLIED. Needs a product decision first (see §1 and §5).
--
-- Filename deliberately carries no runnable sequence number. Migrations in this
-- directory are applied by hand — `_run_startup_migrations()` in server.py holds
-- inline SQL only and early-returns on an existing database, so nothing here
-- auto-applies. Rename to `065_module_role_levels.sql` when a decision is made.
--
-- Context: this is the storage half of the RBAC audit. The code half — closing
-- the cross-tenant leaks, restricting `account_manager`, tiering Vetana and
-- masking payroll PII — is shipped and needs no schema change. What is below is
-- what the code CANNOT express today because the columns do not exist.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The finding: Tier 4 does not exist in the database
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `PLAN_RBAC.md` describes four tiers, the fourth being a role level on each
-- module grant: viewer / editor / approver / admin. `RBAC-SPEC.md` restates it
-- and adds the rule that Approver and Admin are not a hierarchy — "whoever
-- defines what people are paid must not also be the one who releases the
-- money".
--
-- `staging.org_member_modules` (migration 025) is:
--
--     id, user_id, org_id, module_code, granted_by, granted_at
--
-- There is no `role` column. So `require_module()` can only answer "does this
-- user have the module, yes or no", and every grant is effectively `admin`.
-- A "viewer" is a concept that exists in three specification documents and in
-- the frontend's vocabulary, and nowhere in the schema.
--
-- Consequence, before the code changes shipped alongside this file: the lowest
-- tier of access to Vetana could approve a payroll run, because there was no
-- lower tier. Those endpoints are now gated on the ORG role (org_owner /
-- org_admin) instead, which is the coarser control the schema can actually
-- support today. §5 explains why that is not the end state.
--
-- Second finding, same table: `PLAN_RBAC.md` §DB-3 and `RBAC-SPEC.md` both say
-- `account_manager` is REMOVED and replaced by `platform_support` with an
-- approval flow. Neither has happened. The live CHECK constraint (migration
-- 025) still admits `account_manager` and has never heard of `platform_support`:
--
--     CHECK (role_code IN ('platform_admin', 'account_manager',
--                          'account_finance', 'developer', 'srijan_admin',
--                          'org_admin', 'org_member', 'org_owner'))
--
-- `platform_support_sessions` does not exist either. So the entire time-limited,
-- module-scoped, audited support-access flow described in `08-rbac-screens.md`
-- has no storage behind it. Today the only way to give an Aekam person access
-- to a customer org is to make them `platform_admin` or `account_manager` —
-- both of which are permanent, unscoped and (until this change) silent.

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Add the role level to module grants
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Additive and forward-compatible. Existing rows become 'admin', which is
-- exactly what they mean today, so nothing changes behaviour on the day it is
-- applied. The behaviour change comes later, when routers start reading it.

ALTER TABLE staging.org_member_modules
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';

ALTER TABLE staging.org_member_modules
    DROP CONSTRAINT IF EXISTS org_member_modules_role_check;

ALTER TABLE staging.org_member_modules
    ADD CONSTRAINT org_member_modules_role_check
    CHECK (role IN ('viewer', 'editor', 'approver', 'admin'));

-- Sensitive modules are role-derived, not granted (RBAC-SPEC, decided
-- 25 Jul 2026): Vetana, Ganit and Manav must have NO per-member grant row at
-- all. Access is a function of the org role. A grant row naming one of them is
-- invalid input, and the constraint says so rather than leaving it to the UI —
-- "enforce this in the resolver, not the UI: a direct API call cannot do what
-- the locked cell prevents".
--
-- `pahchan` is included because it holds biometric-adjacent data (face-match
-- scores and selfies against a named employee) and the same argument applies.
-- It is NOT named in RBAC-SPEC, which predates the Pahchan build — flagging
-- that as an extension of the rule rather than a quote of it.

ALTER TABLE staging.org_member_modules
    DROP CONSTRAINT IF EXISTS org_member_modules_not_sensitive;

ALTER TABLE staging.org_member_modules
    ADD CONSTRAINT org_member_modules_not_sensitive
    CHECK (module_code NOT IN ('vetana', 'ganit', 'manav', 'pahchan'));

-- ↑ THIS ONE WILL FAIL IF SUCH ROWS EXIST. Check first, and decide what to do
-- with them, rather than letting the ALTER decide:
--
--   SELECT module_code, COUNT(*), array_agg(DISTINCT org_id)
--   FROM staging.org_member_modules
--   WHERE module_code IN ('vetana','ganit','manav','pahchan')
--   GROUP BY module_code;
--
-- If rows exist, every one of them is a person who has HR or payroll access
-- today and would lose it. That is a conversation with the customer, not a
-- DELETE. See §5.

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Time-limited, audited support access
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Schema per PLAN_RBAC.md §"Support approval flow". Nothing reads this table
-- yet; it is the prerequisite for retiring the permanent-god-mode approach.

CREATE TABLE IF NOT EXISTS staging.platform_support_sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    modules      TEXT[] NOT NULL DEFAULT '{}',
    access_level TEXT NOT NULL DEFAULT 'viewer'
                 CHECK (access_level IN ('viewer', 'editor')),
    reason       TEXT NOT NULL,
    granted_by   TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_at   TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pss_org_active
    ON staging.platform_support_sessions (org_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pss_user
    ON staging.platform_support_sessions (user_id);

-- `access_level` admits only viewer and editor — the spec caps a support agent
-- below admin, and the constraint is the enforcement point. `reason` is NOT
-- NULL because it is shown verbatim to the customer; a nullable column would
-- make "no reason given" representable, and it must not be.
--
-- `modules` deliberately has no CHECK against the sensitive list. Whether a
-- customer may grant a support agent temporary payroll access is a decision
-- for that customer's admin, not something to forbid in DDL. The default of
-- '{}' means a row created without an explicit scope grants nothing.

-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · The role_code enum — NOT changed here, on purpose
-- ═════════════════════════════════════════════════════════════════════════════
--
-- PLAN_RBAC.md §DB-3 asks for `account_manager` to be dropped from the enum and
-- `platform_support` added. That SQL is written out below but NOT executed,
-- because dropping a role_code while rows still carry it fails, and migrating
-- those rows changes who can do what for real people on a shared database.
--
-- The code changes shipped alongside this file already remove the dangerous
-- half of `account_manager` without touching a row: it no longer bypasses
-- `require_module` for sensitive modules, and it no longer passes
-- `require_org_role`. It keeps its commercial surfaces in `admin_orgs.py`. So
-- the enum change is now a tidying step rather than a security fix, and can
-- wait for the support-approval UI that gives it somewhere to land.
--
-- When that UI exists, in this order:
--
--   -- 4a. who is affected — run and read before anything else
--   -- SELECT ur.user_id, u.email, ur.role_code
--   -- FROM staging.user_roles ur JOIN users u ON u.user_id = ur.user_id
--   -- WHERE ur.role_code = 'account_manager';
--
--   -- 4b. widen the enum first, so both values are legal during the migration
--   -- ALTER TABLE staging.user_roles DROP CONSTRAINT user_roles_role_code_check;
--   -- ALTER TABLE staging.user_roles ADD CONSTRAINT user_roles_role_code_check
--   --   CHECK (role_code IN ('platform_admin', 'platform_support',
--   --                        'account_manager', 'account_finance', 'developer',
--   --                        'srijan_admin', 'org_owner', 'org_admin',
--   --                        'org_member'));
--
--   -- 4c. move the rows
--   -- UPDATE staging.user_roles SET role_code = 'platform_support'
--   -- WHERE role_code = 'account_manager';
--
--   -- 4d. narrow the enum, only once 4c returns 0 remaining
--   -- ALTER TABLE staging.user_roles DROP CONSTRAINT user_roles_role_code_check;
--   -- ALTER TABLE staging.user_roles ADD CONSTRAINT user_roles_role_code_check
--   --   CHECK (role_code IN ('platform_admin', 'platform_support',
--   --                        'account_finance', 'developer', 'srijan_admin',
--   --                        'org_owner', 'org_admin', 'org_member'));
--
-- Note the ordering: PLAN_RBAC.md §DB-3 gives 4b and 4d as a single statement
-- that drops and re-adds the constraint without `account_manager` — which fails
-- if any row still holds it. Widen, migrate, narrow.
--
-- Also note PLAN_RBAC.md §DB-5's migration script excludes the three god-mode
-- emails from demotion by looking them up in `staging.users`. Verify that
-- table resolves before running it: no migration in this repo creates it, and
-- every user lookup in the backend except one uses the UNQUALIFIED `users`
-- (auth_router.py, approvals_router.py, invite_router.py, server.py). The sole
-- exception is `routers/messaging.py`, which joins `staging.users` in four
-- places. Either that object exists and was created outside this directory, or
-- those four Sanvaad queries are broken — worth resolving on its own account,
-- not just for this script.
--
-- RESOLVED (read-only check against the live catalogue): `staging.users` does
-- NOT exist — `to_regclass('staging.users')` is NULL. It was six join sites,
-- not four, and `u.avatar_url` did not exist either (public.users has
-- `avatar`). Every Sanvaad read endpoint was answering 500. `messaging.py` now
-- joins the unqualified `users` like the rest of the backend; see its header.
-- For THIS script the consequence is the one flagged above: §DB-5's god-mode
-- exclusion must look the three emails up in `users`, not `staging.users`, or
-- it will abort.

-- ═════════════════════════════════════════════════════════════════════════════
-- 5 · Product decisions this file cannot make
-- ═════════════════════════════════════════════════════════════════════════════
--
-- (a) Does Vetana / Ganit / Manav access really follow the ORG role only?
--     RBAC-SPEC says yes: org_owner and org_admin get admin, everyone else
--     none. Taken literally that means a payroll clerk who is not an org admin
--     cannot run payroll, and a bookkeeper cannot post a journal entry. For a
--     20-person firm that is probably right. For a 200-person firm it forces
--     every finance hire to be an org admin, which is worse than what it
--     replaced. The shipped code implements the spec as written. If that proves
--     too blunt, the answer is a `payroll_admin` / `accounts_admin` org role,
--     not a grant row — which is why §2 forbids the grant row.
--
-- (b) Approver ≠ Admin. RBAC-SPEC is explicit that "Admin cannot approve a
--     payroll run" — separation of duty between defining pay and releasing it.
--     The `role` column added in §2 can express it; nothing enforces it yet,
--     and the shipped code does NOT (org admins can both edit structures and
--     approve runs). Closing that needs the column to be populated and the
--     Vetana routes to read it. Flagged rather than half-done.
--
-- (c) Rows that would violate the §2 sensitive-module constraint. If the query
--     under §2 returns anything, those people have HR or payroll access today
--     and the constraint takes it away. Decide per person, with the customer.
--
-- (d) Whether the non-sensitive `require_module` platform bypass should be
--     audited too. It currently is not — it guards roughly 400 endpoints and a
--     row per request is a volume decision. The sensitive-module bypass IS
--     audited, which is where the standing "support access is never silent"
--     rule actually bites.

-- ═════════════════════════════════════════════════════════════════════════════
-- 6 · Risk assessment
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SHARED DATABASE. Staging and production are two schemas in ONE Supabase
-- project (`toacecaewujfxjfrjwco`). Every statement above targets `staging.*`
-- explicitly. `public.*` is untouched. Verify the schema qualifier on every
-- line before running anything.
--
-- §2 `ADD COLUMN role ... DEFAULT 'admin'`
--   Risk: none at apply time. Postgres 11+ does not rewrite the table for a
--   non-volatile default. Existing rows keep their current meaning. Nothing
--   reads the column until a router is changed to.
--
-- §2 `org_member_modules_not_sensitive`
--   Risk: HIGH IF ROWS EXIST — the ALTER fails, and if it is forced through by
--   deleting rows first, real people lose HR/payroll access with no notice.
--   Run the SELECT above first. This is the one statement in this file that
--   can cause a support call.
--   Rollback: ALTER TABLE staging.org_member_modules
--             DROP CONSTRAINT org_member_modules_not_sensitive;
--
-- §3 `platform_support_sessions`
--   Risk: none. New table, nothing reads or writes it, no foreign keys point
--   at it. `ON DELETE CASCADE` from organisations matches every other child
--   table in the schema.
--   Rollback: DROP TABLE staging.platform_support_sessions;
--
-- §4 is commented out and does nothing.
--
-- ROLLBACK, whole file:
--   ALTER TABLE staging.org_member_modules DROP CONSTRAINT IF EXISTS
--       org_member_modules_not_sensitive;
--   ALTER TABLE staging.org_member_modules DROP CONSTRAINT IF EXISTS
--       org_member_modules_role_check;
--   ALTER TABLE staging.org_member_modules DROP COLUMN IF EXISTS role;
--   DROP TABLE IF EXISTS staging.platform_support_sessions;
--
-- Fully reversible — no data is destroyed by any statement in §2 or §3, and
-- nothing in the running application depends on either.
