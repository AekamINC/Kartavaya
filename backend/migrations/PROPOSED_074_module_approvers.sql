-- ═════════════════════════════════════════════════════════════════════════════
-- PROPOSED 074 — somewhere to record a separated-duty approver
--
-- STATUS: PROPOSAL. Not applied. staging and production share ONE Supabase
-- project, so nothing here runs until the owner decides it runs.
--
-- Number chosen after surveying every branch: 056 and 063–069 are taken
-- (agents have already collided on 067). 074 leaves room either side.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `role_tiers.SEPARATED_DUTY_MODULES = {vetana, ganit}` and `level_satisfies()`
-- say that in those two modules ADMIN DOES NOT SATISFY APPROVER. Whoever
-- defines what people are paid must not also release the money; whoever owns
-- the chart of accounts must not also close the period.
--
-- That rule could not be enforced, and not because a check was forgotten.
-- PROPOSED_065 states the other standing rule:
--
--     Vetana, Ganit and Manav must have NO per-member grant row at all.
--     Access is a function of the org role.
--
-- Both rules are right, and together they leave the approver with no home:
--
--   · `org_member_modules` — forbidden for ganit/vetana by 065's CHECK.
--   · `user_roles`         — carries org_owner / org_admin / org_member only.
--
-- So there is no row anyone can write that means "Priya may approve payment
-- runs in Ganit, and nothing else". Separated duty was not merely unenforced;
-- it was NOT REPRESENTABLE. This table is the missing noun.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why a separate table rather than relaxing 065's CHECK
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Widening `org_member_modules` to admit ganit/vetana rows would re-open the
-- exact hole 065 closed: a grant row on a sensitive module would once again
-- confer REACH. An approver grant must confer DEPTH ONLY — it says what you may
-- do once you are already inside, never that you may get in. Keeping it in its
-- own table makes that structural instead of a convention, and makes revocation
-- a single targeted delete that cannot accidentally remove someone's read
-- access to the books.
--
-- It also gives the grant its own audit surface: granted_by, granted_at,
-- revoked_by, revoked_at. "One user can have both FYI but auditable" — the
-- auditable half needs columns.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.org_module_approvers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL,

    granted_by  TEXT,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_by  TEXT,
    revoked_at  TIMESTAMPTZ,
    note        TEXT,

    -- Only the separated-duty modules have an approver rung worth naming. The
    -- other nine are a plain hierarchy where admin already covers approver, so
    -- a row here for `graha` would be a grant that silently does nothing.
    CONSTRAINT org_module_approvers_module_check
        CHECK (module_code IN ('ganit', 'vetana'))
);

-- One LIVE approver row per user/org/module. Revoked rows are kept — the point
-- of the table is the trail — so the uniqueness is partial rather than a plain
-- UNIQUE, which would make a re-grant after revocation impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_module_approvers_live
    ON staging.org_module_approvers (user_id, org_id, module_code)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_module_approvers_lookup
    ON staging.org_module_approvers (org_id, module_code)
    WHERE revoked_at IS NULL;

COMMIT;


-- ═════════════════════════════════════════════════════════════════════════════
-- SEEDING — read this before applying, it decides whether anyone is locked out
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `middleware/module_levels.py` probes for this table and turns enforcement on
-- BY ITSELF the moment it exists. That is intentional — it puts the cutover in
-- the migration author's hands rather than a deploy's — but it means that
-- between CREATE TABLE and the first INSERT, **no one in any org can cancel an
-- invoice or release a vendor payment**.
--
-- Do not apply the DDL alone. Decide the seed first.
--
-- Option A — preserve today's behaviour exactly, then tighten deliberately.
--   Every current org_owner becomes an approver, so nothing breaks on the day,
--   and the firm narrows it afterwards from the members screen. Recommended for
--   a shared staging/production project where a lockout is a customer incident.
--
--     INSERT INTO staging.org_module_approvers (user_id, org_id, module_code, granted_by, note)
--     SELECT ur.user_id, ur.org_id, m.code, 'migration_074',
--            'Seeded from org_owner at cutover — review and narrow.'
--     FROM staging.user_roles ur
--     CROSS JOIN (VALUES ('ganit'), ('vetana')) AS m(code)
--     WHERE ur.org_id IS NOT NULL
--       AND ur.role_code = 'org_owner'
--     ON CONFLICT DO NOTHING;
--
--   Verify before committing:
--     SELECT o.name, a.module_code, COUNT(*) AS approvers
--     FROM staging.org_module_approvers a
--     JOIN staging.organisations o ON o.id = a.org_id
--     WHERE a.revoked_at IS NULL GROUP BY 1,2 ORDER BY 1,2;
--   Any org showing 0 for a module its plan includes is a lockout. Fix it in
--   the same transaction.
--
-- Option B — no seed. Separation is real from the first second and every org
--   must nominate an approver before it can release money again. Correct in
--   principle, and an outage for every customer who has not been told. Only
--   with prior notice and a support window.
--
-- Whichever is chosen, run it INSIDE the same transaction as the CREATE TABLE
-- so there is no window where the table exists unseeded.
--
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Dropping the table is a complete rollback of behaviour as well as schema:
-- the resolver's probe goes back to false and org_owner/org_admin regain the
-- access they have today. No router change and no deploy are needed.
--
-- The running processes cache the probe result, so a drop needs a restart (or
-- a call to reset_approver_table_cache()) before it takes effect. Plan for the
-- restart rather than being surprised by it.
--
--   BEGIN;
--   DROP INDEX IF EXISTS staging.idx_org_module_approvers_lookup;
--   DROP INDEX IF EXISTS staging.uq_org_module_approvers_live;
--   DROP TABLE IF EXISTS staging.org_module_approvers;
--   COMMIT;
--
-- Rollback DESTROYS the grant history — who was made an approver, by whom, and
-- when. If the trail matters for an audit, copy it out first:
--
--   CREATE TABLE staging._archive_074_approvers AS
--     SELECT * FROM staging.org_module_approvers;
--
--
-- ═════════════════════════════════════════════════════════════════════════════
-- RISKS
-- ═════════════════════════════════════════════════════════════════════════════
--
-- 1. LOCKOUT ON APPLY — the headline risk. See SEEDING. Applying the DDL with
--    no seed silently removes the ability to cancel an invoice or pay a vendor
--    bill from every user in every org, including sole traders who have nobody
--    to grant it to them.
--
-- 2. SHARED PROJECT — staging and production are ONE Supabase project. This
--    table appears in production the instant it is applied, and the resolver
--    in production picks it up on its next probe. There is no staging-only
--    rehearsal available. Treat apply as a production change.
--
-- 3. CACHED PROBE — `_approver_table_exists` is process-local and latches. A
--    long-running worker started before the apply keeps the OLD behaviour until
--    it restarts, so two processes can disagree for the length of a deploy.
--    Restart the API after applying rather than relying on drift-out.
--
-- 4. NOT A MAKER-CHECKER CONTROL — this records WHO MAY approve. It does not
--    stop the same person creating a vendor bill and then approving their own
--    payment of it. That is a different control and needs a different change;
--    do not let this table be mistaken for it in an audit.
--
-- 5. `manav` and `pahchan` are deliberately NOT in the CHECK. They are
--    sensitive but not separated-duty — nothing in them is approved in the
--    money sense. Adding them later means widening the CHECK, not a new table.
