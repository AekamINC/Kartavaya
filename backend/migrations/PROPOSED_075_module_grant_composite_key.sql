-- ═════════════════════════════════════════════════════════════════════════════
-- PROPOSED 075 — make "admin AND approver on the same module" representable
--
-- STATUS: PROPOSAL. NOT APPLIED. `staging` and `public` are two schemas in ONE
-- Supabase project (`toacecaewujfxjfrjwco`) and that project is the one
-- production uses. Nothing in this file has been run.
--
-- Number chosen after surveying backend/migrations/ on every local and remote
-- ref: 056 and 063-070 and 074 are claimed. 071-073 are free; 075 is taken here
-- so that this file sorts AFTER 074, which it must be read against (see §5).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · WHAT THIS DOES, IN ONE LINE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Replaces `UNIQUE (user_id, org_id, module_code)` on
-- `staging.org_member_modules` with two PARTIAL unique indexes, so a user may
-- hold exactly one ladder grant (viewer/editor/admin) per module PLUS at most
-- one separate `approver` grant on that same module.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · WHY — the requirement is currently unrepresentable
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `middleware/role_tiers.py` states the rule and the owner's note verbatim:
--
--     SEPARATED_DUTY_MODULES = {"vetana", "ganit"}
--     "One person MAY hold both — that is allowed and sometimes necessary in a
--      small firm. The point is that it becomes an explicit, auditable second
--      grant rather than something admin quietly includes."
--
-- `level_satisfies()` implements it: for those two modules, `required ==
-- APPROVER` is satisfied ONLY by `held == APPROVER`. Admin does not climb into
-- that rung. So a person who both maintains the chart of accounts AND releases
-- payments needs TWO grants.
--
-- The live table cannot store the second one. Verified in the live database,
-- not read off a migration file:
--
--     org_member_modules_user_id_org_id_module_code_key
--         UNIQUE (user_id, org_id, module_code)
--
-- One row per user per module. The second grant is rejected by the index. This
-- was previously reported as implemented; it is not. `TabMembers.jsx` already
-- documents the gap in a comment and deliberately removed the sentence
-- promising "grant both if one person does both", because the screen could not
-- keep that promise.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · WHY THIS SHAPE, AND NOT THE OTHER TWO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The brief asked for a composite key, a separate grants table, or a role
-- array to be weighed against how the code actually queries this table. The
-- queries, all verified on `origin/staging`:
--
--   READ   org_members.py:93    SELECT module_code, role  → [{code, role}, ...]
--   READ   admin_orgs.py:913    SELECT module_code, granted_at
--   REACH  subscription.py:127  SELECT 1 ... WHERE user_id AND org_id AND module_code
--   WRITE  org_members.py:230   INSERT ... ON CONFLICT (user_id,org_id,module_code) DO NOTHING
--   WRITE  admin_orgs.py:700    INSERT ... ON CONFLICT (user_id,org_id,module_code) DO NOTHING
--   WRITE  org_members.py:337   DELETE all for (user,org) then INSERT each  [no ON CONFLICT]
--   WRITE  admin_orgs.py:884    DELETE all for (user,org) then INSERT each  [no ON CONFLICT]
--
-- ROLE ARRAY (`roles TEXT[]`) — REJECTED.
--   `granted_by` and `granted_at` are per-grant facts. Collapsing two grants
--   made by different admins on different days into one row with one
--   `granted_by` destroys exactly the auditability the requirement asks for:
--   "one user can have both FYI but auditable". The array keeps the first half
--   and throws away the second.
--   It also forces a rewrite of BOTH live CHECKs (`org_member_modules_role_check`
--   and `org_member_modules_level_is_meaningful`) into `= ANY(roles)` form, and
--   `level_is_meaningful` is being rewritten right now by PROPOSED_070 for the
--   spelling fix. Two agents rewriting the same predicate in the same window is
--   how a constraint ends up saying something neither intended.
--   And every read above returns `role` as a scalar into a `{code, role}` shape
--   the frontend consumes. All of it would change for no gain.
--
-- SEPARATE GRANTS TABLE — this is PROPOSED_074's shape, and it is NOT rejected;
--   it is an ALTERNATIVE that answers a DIFFERENT question. See §5. In short:
--   074 is correct if ganit/vetana reach comes from the ORG ROLE only (the
--   PROPOSED_065 model). This file is correct if reach continues to come from
--   a module grant. Both cannot be right, and the owner picks.
--
-- COMPOSITE KEY — CHOSEN, with one refinement.
--   A plain `UNIQUE (user_id, org_id, module_code, role)` would also permit
--   viewer + editor + approver + admin as FOUR simultaneous rows on one module.
--   Nothing wants that: the ladder position is single-valued, and the reach gate
--   at subscription.py:127 is an existence check that cannot tell four rows from
--   one. Two partial unique indexes say the intended thing exactly —
--   ONE ladder grant, PLUS at most ONE approver grant — and leave every read
--   above working unchanged, because `SELECT module_code, role` over two rows is
--   already the list shape `module_grants` is built from.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · THE ORDERING THAT MAKES THIS SAFE — DO NOT REORDER
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ THE SQL IN §4 MUST NOT RUN FIRST. It is step 2 of 2.
--
-- Dropping the UNIQUE breaks two INSERTs the moment it lands, before any deploy:
--
--     INSERT ... ON CONFLICT (user_id, org_id, module_code) DO NOTHING
--
-- An `ON CONFLICT` inference clause must match an existing unique index. After
-- the drop there is no index on exactly those three columns, so Postgres raises
--
--     SQLSTATE 42P10: there is no unique or exclusion constraint matching the
--     ON CONFLICT specification
--
-- — a hard 500 on "add a member" (org_members.py) and on the platform console's
-- member-add (admin_orgs.py). On a shared staging/production project that is a
-- customer-visible outage that begins at the instant of the ALTER and does not
-- end until a deploy ships.
--
-- STEP 1 — CODE, DEPLOYED FIRST. In both files replace the inference clause with
-- a bare `ON CONFLICT DO NOTHING`:
--
--     backend/routers/org_members.py  ~line 230
--     backend/routers/admin_orgs.py   ~line 700
--
--       -  "ON CONFLICT (user_id, org_id, module_code) DO NOTHING"
--       +  "ON CONFLICT DO NOTHING"
--
--   A bare `ON CONFLICT DO NOTHING` infers no index and is valid against BOTH
--   the current UNIQUE and the indexes created in §4. That is what makes step 1
--   safe to deploy on its own, days before §4 runs, with no window in which
--   either half is broken. Deploy it, confirm add-member still works, then and
--   only then run §4.
--
--   Note the semantic change is nil TODAY and small later: with the old UNIQUE
--   it swallowed a duplicate (user, org, module); afterwards it swallows a
--   duplicate (user, org, module, ladder-or-approver). Both mean "this grant is
--   already there, leave it".
--
-- STEP 2 — the SQL in §4.
--
-- STEP 3 — UI, afterwards and optional. `TabMembers.jsx` renders one
--   radio-style level picker per module (`onLevel(mod.code, l)` sets a single
--   value) and `list_members` builds `"modules": [m["module_code"] for m in
--   mods]`, which will now contain the same code twice for a dual grant and can
--   render a duplicate chip. Until the picker becomes a two-part control for
--   separated-duty modules, dual grants are settable by API and not by screen.
--   That is a smaller problem than the one this file fixes, and it is not a
--   reason to delay §4 — but `"modules"` should be de-duplicated
--   (`sorted(set(...))`) in the same deploy as step 1 so the chip list stays
--   honest.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · APPLY (step 2 of 2 — only after step 1 is deployed)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Guard. `staging.org_member_modules` held ZERO rows when this was written, and
-- that is what makes this change free. If it is no longer empty, the two
-- indexes below can still be created, but a pre-existing duplicate would abort
-- the transaction — and, more importantly, someone's live access is now in
-- scope. Stop and re-read §6 before overriding this.
DO $$
DECLARE
    n BIGINT;
BEGIN
    SELECT COUNT(*) INTO n FROM staging.org_member_modules;
    IF n <> 0 THEN
        RAISE EXCEPTION
            'org_member_modules holds % row(s); this migration was written and '
            'risk-assessed against an EMPTY table. Re-read section 6.', n;
    END IF;
END $$;

ALTER TABLE staging.org_member_modules
    DROP CONSTRAINT IF EXISTS org_member_modules_user_id_org_id_module_code_key;

-- One ladder position per user per module. viewer / editor / admin are mutually
-- exclusive: they are rungs, and a person stands on one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_omm_ladder_grant
    ON staging.org_member_modules (user_id, org_id, module_code)
    WHERE role <> 'approver';

-- Plus at most one approver grant on that same module. Separate index, so it is
-- a SEPARATE ROW with its own granted_by and granted_at — which is the whole
-- point of "an explicit, auditable second grant".
CREATE UNIQUE INDEX IF NOT EXISTS uq_omm_approver_grant
    ON staging.org_member_modules (user_id, org_id, module_code)
    WHERE role = 'approver';

COMMENT ON INDEX staging.uq_omm_ladder_grant IS
    'Tier 4. One of viewer/editor/admin per user per module — the ladder '
    'position is single-valued. Replaces UNIQUE (user_id, org_id, module_code), '
    'which also blocked the separate approver grant.';

COMMENT ON INDEX staging.uq_omm_approver_grant IS
    'Tier 4. The separated-duty approver grant, held ALONGSIDE a ladder grant. '
    'In vetana and ganit admin does not satisfy approver (role_tiers.'
    'level_satisfies), so one person doing both jobs holds two rows and the '
    'second one is visible, dated and attributable.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- §5 · RELATIONSHIP TO PROPOSED_074 — THE OWNER MUST PICK ONE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `PROPOSED_074_module_approvers.sql` (branch worktree-agent-a91ffbcdbce0c3ac0)
-- creates `staging.org_module_approvers` to hold the ganit/vetana approver in
-- its own table. It and this file solve the SAME requirement two ways, and
-- applying both leaves two places to look for one fact.
--
-- The fork is a product decision that is ALREADY OPEN — PROPOSED_065 §5(a)
-- raises it and does not settle it:
--
--   IF ganit/vetana access follows the ORG ROLE only (065's `not_sensitive`
--   CHECK forbids grant rows for vetana/ganit/manav/pahchan), then:
--       → 074 is REQUIRED, because the approver then has nowhere else to live.
--       → 075 is POINTLESS, because ganit and vetana are the ONLY separated-duty
--         modules, and for every other module admin already satisfies approver,
--         so a second row would say nothing new.
--
--   IF ganit/vetana access continues to come from a module grant (the model
--   PROPOSED_066 was written against, and the one live today — 065 is NOT
--   applied), then:
--       → 075 is REQUIRED and sufficient.
--       → 074 adds a second table, a second reach story, and a probe that
--         latches per process (074's own §3 risk).
--
-- RECOMMENDATION, on the evidence: apply 075, do not apply 065's
-- `not_sensitive` CHECK, and let 074 stand down. Reasons:
--   · 065's author flags the org-role-only model as possibly wrong at scale
--     ("forces every finance hire to be an org admin, which is worse than what
--     it replaced"). Building a table on an unmade decision is the expensive
--     order.
--   · 074 must be applied WITH a seed in the same transaction or it removes the
--     ability to release a vendor payment from every user in every org — its own
--     §"SEEDING" says so. 075 has no such cliff: at zero rows it changes nothing
--     until someone is granted something.
--   · One table means one reach gate. subscription.py:127 is an existence check
--     over org_member_modules; a second grants table needs its own gate, and a
--     permission split across two tables is how a gate gets forgotten.
--
-- This is a recommendation, not a decision. If the owner picks the 065 model,
-- DO NOT APPLY THIS FILE.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §6 · RISK IF THIS RUNS AGAINST PRODUCTION DATA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. SHARED PROJECT. `staging` and `public` are one Supabase project and it is
--    production's. Every statement in §4 is schema-qualified `staging.*` and
--    `public.*` is untouched — verify that on every line before running.
--
-- 2. AT ZERO ROWS: no data risk at all. No row can be rejected, no access
--    changes, nothing is deleted. Verified `COUNT(*) = 0` at the time of
--    writing, and §4 re-checks it and aborts rather than trusting this note.
--
-- 3. IF ROWS EXIST BY THEN: the guard aborts. That is deliberate. The two
--    indexes are strictly WEAKER than the constraint they replace, so no
--    existing row can violate them and a forced run would succeed — but the
--    reason to stop is not the index, it is that live grants mean the
--    `ON CONFLICT` change in step 1 is now load-bearing for real users and must
--    be confirmed deployed first. Re-run step 1's verification, then remove the
--    guard block deliberately.
--
-- 4. ORDERING WITH 070. PROPOSED_070 (sanvaad spelling, branch
--    verify/org-endpoints) rewrites `org_member_modules_level_is_meaningful` on
--    this same table and UPDATEs `module_code` on it. It touches a CHECK; this
--    file touches a UNIQUE. They do not overlap and either order works — but
--    BOTH are only cheap while the table is empty, so run them in the same
--    maintenance window. Recommended: 070 first (it is a smaller change and its
--    code half is already written), then 075.
--
-- 5. NOT A SECURITY FIX. This widens what can be STORED. It does not enforce
--    anything: `level_satisfies()` had zero call sites in the backend as of
--    `origin/staging`, so the `role` column is not yet read by any guard.
--    Enforcement is being added on branch worktree-agent-a91ffbcdbce0c3ac0.
--    Until that lands, a second grant row is documentation, not a control. Do
--    not let this file be recorded as "separated duty implemented".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- §7 · ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Complete and lossless WHILE no user holds two grants on one module. Run the
-- check first — if it returns any row, restoring the UNIQUE will FAIL, and the
-- fix is a product decision (which of the two grants does that person lose?),
-- never a blind DELETE.
--
--   SELECT user_id, org_id, module_code, COUNT(*)
--     FROM staging.org_member_modules
--    GROUP BY 1,2,3 HAVING COUNT(*) > 1;
--
-- Then:
--
--   BEGIN;
--   DROP INDEX IF EXISTS staging.uq_omm_approver_grant;
--   DROP INDEX IF EXISTS staging.uq_omm_ladder_grant;
--   ALTER TABLE staging.org_member_modules
--       ADD CONSTRAINT org_member_modules_user_id_org_id_module_code_key
--       UNIQUE (user_id, org_id, module_code);
--   COMMIT;
--
-- The step-1 code change does NOT need reverting: a bare `ON CONFLICT DO
-- NOTHING` is valid against the restored UNIQUE too. Leave it. Reverting it is
-- what would break, and only if §4 had not been rolled back with it.
