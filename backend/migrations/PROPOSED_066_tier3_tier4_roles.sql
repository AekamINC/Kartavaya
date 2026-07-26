-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠️ THIS FILE HAS ALREADY BEEN APPLIED. The header below is out of date and is
-- kept only so the reasoning survives.
--
-- Verified against the LIVE schema (project toacecaewujfxjfrjwco, read-only) by
-- the migrations-consolidation agent:
--
--   §1 staging.org_member_modules.role            EXISTS, TEXT NOT NULL DEFAULT 'viewer'
--   §1 org_member_modules_role_check              APPLIED (viewer/editor/approver/admin)
--   §1 org_member_modules_level_is_meaningful     APPLIED — and it names `samvada`,
--        which is the spelling defect PROPOSED_070 fixes. Do not re-run this file
--        after 070 lands: §1 would re-create the CHECK with the OLD spelling and
--        silently undo it.
--   §2 public.team_members_role_check             APPLIED — live value is
--        (owner, admin, member, client), i.e. `admin` is already in production's
--        tenancy table.
--
-- §2 was the one statement this file flagged as touching a table `main` reads,
-- and it went in without the header ever being updated. THAT is how this
-- directory and the database diverged: the labels are not maintained, so only
-- the catalog can be trusted. Re-verify before believing any "PROPOSED" header.
--
-- DO NOT RE-RUN. It is close to idempotent, but the `level_is_meaningful`
-- re-creation is a genuine regression risk once 070 has landed.
-- ═════════════════════════════════════════════════════════════════════════════

-- PROPOSED — Tier 3 (project) and Tier 4 (module levels). Review before running.
--
-- Owner's decisions, 2026-07-26. Code already understands all of this
-- (middleware/role_tiers.py), so applying this opens no window where a value
-- exists that no gate can interpret — the same ordering used for the platform
-- roles.
--
-- WHY NOW: staging.org_member_modules holds ZERO rows today. Adding the `role`
-- column is free at zero rows and stops being free the moment anyone is granted
-- a module — at which point every existing grant has to be assigned a level, and
-- the safe default (viewer) silently demotes people who were effectively admin.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · Tier 4 — module levels
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE staging.org_member_modules
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer';

ALTER TABLE staging.org_member_modules
    DROP CONSTRAINT IF EXISTS org_member_modules_role_check;
ALTER TABLE staging.org_member_modules
    ADD CONSTRAINT org_member_modules_role_check
    CHECK (role IN ('viewer', 'editor', 'approver', 'admin'));

COMMENT ON COLUMN staging.org_member_modules.role IS
    'Tier 4. viewer < editor < approver < admin, EXCEPT vetana and ganit where '
    'admin does not satisfy approver — admin is breadth (salary structures, '
    'chart of accounts), approver is depth (release payments, close periods). '
    'One person may hold both; it is then an explicit second grant, and audited. '
    'Enforced in middleware/role_tiers.level_satisfies, not by hiding buttons.';

-- Default is viewer, NOT the spec's admin. RBAC exists here to give narrow roles
-- to specific users; a default of admin means every grant is full control and
-- the four levels never get used.

-- A grant only makes sense at a level the module actually has. Kartavya has no
-- viewer (everyone edits tasks); five modules have nothing to approve.
ALTER TABLE staging.org_member_modules
    DROP CONSTRAINT IF EXISTS org_member_modules_level_is_meaningful;
ALTER TABLE staging.org_member_modules
    ADD CONSTRAINT org_member_modules_level_is_meaningful
    CHECK (
        NOT (module_code = 'kartavya' AND role = 'viewer')
        AND NOT (module_code IN ('kartavya','dristi','srijan','samvada','esign')
                 AND role = 'approver')
    );

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Tier 3 — project roles
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Adds `admin`: runs a project without owning it. Approves work on EVERY project
-- they administer, and sees only those. Currently the only way to manage a
-- project is to own it, which forces ownership on people who just run the work.
--
-- `client` stays, with a changed meaning: a collaborator, not a reader. There are
-- flows where the client's sign-off is the gate. Still no time logging and no
-- deletion — those are the two things a guest must never do.

DO $$
DECLARE
    conname_found TEXT;
BEGIN
    SELECT conname INTO conname_found
      FROM pg_constraint
     WHERE conrelid = 'public.team_members'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%';

    IF conname_found IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.team_members DROP CONSTRAINT %I', conname_found);
    END IF;
END $$;

ALTER TABLE public.team_members
    ADD CONSTRAINT team_members_role_check
    CHECK (role IN ('owner', 'admin', 'member', 'client'));

COMMENT ON COLUMN public.team_members.role IS
    'Tier 3. owner = full incl. delete. admin = full except delete, approves on '
    'every project they administer, sees only those. member = tasks only. '
    'client = external collaborator: contributes and can be an approval gate, '
    'but never logs time and never deletes.';

-- ⚠️ public.team_members IS PRODUCTION'S TENANCY PATH.
--
-- This is the one statement in this file that touches a table `main` reads.
-- It only WIDENS the allowed set — every existing value ('owner', 'member',
-- 'client') stays valid, so no current row can be rejected and production's
-- behaviour is unchanged. Verify before running:
--     SELECT DISTINCT role FROM public.team_members;
-- Expect exactly: owner, member, client. Anything else and STOP — the widened
-- constraint would reject it on the next write to that row.

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Risk and rollback
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Section 1 is staging-only and additive. At zero rows there is nothing to
-- migrate and nothing to lose.
--
-- Section 2 touches public.*, shared with production. Widening a CHECK cannot
-- reject data that already passed the narrower one, so this is safe by
-- construction — but it is the reason this file is proposed rather than applied.
--
-- ROLLBACK:
--   ALTER TABLE staging.org_member_modules DROP CONSTRAINT IF EXISTS org_member_modules_level_is_meaningful;
--   ALTER TABLE staging.org_member_modules DROP CONSTRAINT IF EXISTS org_member_modules_role_check;
--   ALTER TABLE staging.org_member_modules DROP COLUMN IF EXISTS role;
--   ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
--   ALTER TABLE public.team_members ADD CONSTRAINT team_members_role_check
--     CHECK (role IN ('owner','member','client'));
--
-- Reverting section 2 fails if any row has been set to 'admin' by then. Demote
-- those first:
--   UPDATE public.team_members SET role='member' WHERE role='admin';
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · NOT in this migration, and deliberately
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Self-scoped access to Vetana, Manav and Pahchan — every employee reading their
-- own payslip, profile and attendance without a grant — is NOT a schema change.
-- It is a query filter (`WHERE employee_id = me`) and belongs in the routers.
-- Adding a grant row per employee to express "can see own record" would be
-- 200 rows per org saying the same thing, and would break the moment someone
-- deleted one.
--
-- Clock-in and shift changes routing to approval is likewise application logic:
-- the punch already records and flags (07 §2), and the approval queue is the
-- register, which exists.
