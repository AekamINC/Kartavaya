-- PROPOSED — Vetana approver backfill. Review before running.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS MIGRATION MUST BE APPLIED **BEFORE** THE VETANA SEPARATED-DUTY
-- ENFORCEMENT REACHES STAGING, OR NOBODY CAN APPROVE A PAYROLL RUN.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--
-- `middleware/role_tiers.level_satisfies` refuses `admin` at the `approver`
-- rung on the two SEPARATED_DUTY_MODULES (vetana, ganit). That is the owner's
-- rule and it is correct: "whoever defines what people are paid must not also
-- be the one who releases the money."
--
-- `routers/vetana.py` now enforces it on the three routes that release money:
-- `PATCH /payroll/runs/{id}/approve`, `.../revert` and
-- `PATCH /payslips/{id}/disburse`.
--
-- The problem is not the rule. It is the DATA:
--
--   · `staging.org_member_modules` holds **ZERO rows** — verified against the
--     live catalog during this run, by two agents independently.
--   · `held_module_levels` therefore resolves org_owner and org_admin to
--     exactly `{admin}` and everybody else to `{}`.
--   · `level_satisfies('admin', 'approver', 'vetana')` is FALSE by design.
--
-- So on the day that enforcement deploys, the set of people who can approve a
-- payroll run in any organisation is EMPTY. Not narrowed — empty. Payroll
-- stops. That is a worse outcome than the gap it closes, which is why the
-- enforcement is being held on its branch until this runs.
--
-- WHAT IT DOES
--
-- Grants `approver` on `vetana` to the org_owner of every organisation that
-- has Vetana active. The owner is the one person guaranteed to exist and to
-- already hold full authority, so this grants nobody anything they did not
-- effectively have five minutes earlier — it makes the authority EXPLICIT and
-- AUDITABLE, which is the whole point of the separation.
--
-- It deliberately does NOT grant approver to org_admins. After this runs, an
-- org_admin can still do everything admin means (salary structures, statutory
-- config, loans, processing a run) and can no longer release the money. That
-- is the separation actually taking effect, and it is the intended behaviour
-- change. Any org that wants a second approver adds one deliberately — see
-- the template at the bottom.
--
-- WHY THE SPEC CONTRADICTION DOES NOT BLOCK THIS
--
-- `RBAC-SPEC.md:65` says sensitive modules have no per-member grant row at all
-- and that such a row "is invalid input and must be rejected". The live
-- database has already decided against that sentence:
--
--   · `PROPOSED_066` §1 IS APPLIED — `org_member_modules.role` exists,
--     `DEFAULT 'viewer'`, with `org_member_modules_role_check` (all four
--     levels) and `org_member_modules_level_is_meaningful`.
--   · `org_member_modules_level_is_meaningful` forbids `approver` only on
--     kartavya, dristi, srijan, samvada and esign. **Vetana is not in that
--     list**, so an approver grant on vetana is valid input today.
--   · `PROPOSED_065` §2 `org_member_modules_not_sensitive` — the constraint
--     that WOULD have enforced RBAC-SPEC:65 — is verified ABSENT. It was never
--     applied, and PROPOSED_066 explicitly drops it.
--
-- So the contradiction is settled by an applied migration rather than by
-- anyone's reading: the schema implements the Tier-4 model and does not
-- implement the prohibition. This migration adds rows the live CHECK
-- constraints already accept.

BEGIN;

INSERT INTO staging.org_member_modules (user_id, org_id, module_code, role, granted_by)
SELECT ur.user_id, ur.org_id, 'vetana', 'approver', 'PROPOSED_071_backfill'
FROM staging.user_roles ur
WHERE ur.role_code = 'org_owner'
  AND ur.org_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM staging.module_subscriptions ms
      WHERE ms.org_id = ur.org_id
        AND ms.module_code = 'vetana'
        AND ms.is_active = TRUE
  )
ON CONFLICT (user_id, org_id, module_code) DO NOTHING;

COMMIT;

-- ── Verify before deploying the enforcement ─────────────────────────────────
--
-- Every org with Vetana active must come back with at least one approver. If
-- any row shows 0, DO NOT DEPLOY — that org's payroll would freeze.
--
--   SELECT ms.org_id,
--          COUNT(omm.user_id) FILTER (WHERE omm.role = 'approver') AS approvers
--   FROM staging.module_subscriptions ms
--   LEFT JOIN staging.org_member_modules omm
--          ON omm.org_id = ms.org_id AND omm.module_code = 'vetana'
--   WHERE ms.module_code = 'vetana' AND ms.is_active = TRUE
--   GROUP BY ms.org_id
--   ORDER BY approvers;
--
-- An org whose owner row is missing from `staging.user_roles` gets nothing
-- from this migration and will show 0. Grant that org someone explicitly with
-- the template below rather than widening the INSERT — a missing org_owner row
-- is its own bug and should be seen, not papered over.

-- ── Granting a further approver, deliberately ───────────────────────────────
--
--   INSERT INTO staging.org_member_modules
--       (user_id, org_id, module_code, role, granted_by)
--   VALUES ('<user_id>', '<org_uuid>'::uuid, 'vetana', 'approver', '<granter>');
--
-- Note the UNIQUE (user_id, org_id, module_code) still in force today means one
-- person cannot yet hold BOTH admin and approver as two rows. PROPOSED_075
-- replaces that key and is what makes the owner's "one user can have both FYI
-- but auditable" actually storable. Until 075 lands, a person granted approver
-- here holds approver INSTEAD of a module admin row — org_owner/org_admin still
-- resolve to `admin` from their org role, so in practice they hold both anyway.

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--
-- Removes only the rows this migration created; a hand-granted approver is
-- left alone because `granted_by` distinguishes them.
--
--   BEGIN;
--   DELETE FROM staging.org_member_modules
--   WHERE module_code = 'vetana'
--     AND role = 'approver'
--     AND granted_by = 'PROPOSED_071_backfill';
--   COMMIT;
--
-- Rolling this back while the enforcement is deployed re-freezes payroll
-- approval. Roll the code back first, or together.
