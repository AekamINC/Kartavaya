-- 195 · Tenancy phase 1 — reconcile `team_members` into `project_assignments`.
--
-- This is STEP 1 of the retirement sequence that `PROPOSED_080_team_members_retire`
-- records and refuses to run: "Steps 1-3 of the retirement sequence below are NOT
-- DONE. Running this file today breaks authorization across 17 backend modules and
-- one live view."
--
-- Step 1 is this file. Step 2 is the 64 call sites, in code. Step 3 is
-- `staging.user_org_context`. Only then the rename, only then the drop.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS MUST COME FIRST
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Project membership answers "may this person open this project", and it is
-- answered by TWO tables that disagree. `get_visible_team_ids` UNIONs them, so
-- today a row in either one grants access. The moment a call site is switched to
-- read `project_assignments` alone, every person whose grant exists only in
-- `team_members` loses that project — silently, with a 403 and no clue why.
--
-- Measured against the live database on 2026-08-22 with the reconciliation
-- queries `PROPOSED_080` Step 0 specifies:
--
--   team_members, all status='active'                            198
--   project_assignments                                           92
--
--   A · active team_members with NO project_assignments row      127   ← this file
--         Aekam Inc          123 rows · 22 projects · 6 people
--         Unicode Group        3 rows ·  1 project  · 3 people
--         E2E Test org         1 row  ·  1 project  · 1 person
--   B · project_assignments with no active team_members row       21   ← left alone
--   C · rows where the two disagree on ROLE                        0
--
--   Every one of the 127 is role='member'. All name a user that exists and a
--   team that exists. NONE has a NULL user_id, so the "invited before they
--   registered" case `PROPOSED_080` warns about does not arise here.
--
-- C being ZERO is what makes this a pure INSERT. Had the two tables disagreed
-- about anybody's role, this would be a decision about somebody's permissions
-- rather than a reconciliation, and it would belong in `docs/OWNER-ACTIONS.md`
-- instead of in a migration.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NOTHING. Not one person can open one project after this that they could not
-- open before it. Every row inserted mirrors a `team_members` row that already
-- grants exactly that access through the UNION, at exactly that role. What
-- changes is that the SECOND table now agrees with the first, which is the
-- precondition for reading only the second.
--
-- The reverse direction — the 21 in (B) — is deliberately untouched. Those are
-- grants made through the newer path, and copying them backwards into a table
-- being retired is work in the wrong direction.
--
-- The 3 rows sitting on soft-deleted teams (`teams.deleted_at IS NOT NULL`) ARE
-- included. Whether a deleted project is visible is a question the READ queries
-- answer, and they already filter it; leaving those rows behind would make the
-- mirror inexact for no gain, and would quietly differ from today's behaviour
-- if a project is ever restored.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Staging and production share one Supabase database, so this IS a production
-- write. It is additive: 127 INSERTs, no UPDATE, no DELETE, no schema change.
--
--   · `project_assignments_team_user_unique (team_id, user_id)` — ON CONFLICT
--     DO NOTHING, so a row that already exists is left exactly as it is and a
--     re-run is a no-op.
--   · `project_assignments_role_check` allows owner/admin/member/client. All
--     127 are 'member', and the SELECT re-checks the value anyway rather than
--     trusting the measurement.
--   · `assignment_id` is the PK and has no default, so it is generated here in
--     the same shape every writer in `server.py` uses.
--   · `assigned_by` is left NULL and that is the truthful value: no person
--     made these assignments today, a reconciliation did. `assigned_at`
--     defaults to now() for the same reason — the original grant date lives in
--     `team_members.created_at`, which this file does not destroy.
--
-- BACKED UP FIRST. `tenancy_195_backup.project_assignments_before` holds the
-- table as it stood; the rollback at the foot of this file restores from it.
-- `team_members` itself is not touched, so the source of truth for every one of
-- these rows survives this migration intact — which is the real safety net.

BEGIN;

CREATE SCHEMA IF NOT EXISTS tenancy_195_backup;

CREATE TABLE IF NOT EXISTS tenancy_195_backup.project_assignments_before AS
  SELECT * FROM public.project_assignments;

CREATE TABLE IF NOT EXISTS tenancy_195_backup.team_members_before AS
  SELECT * FROM public.team_members;

-- The reconciliation itself.
INSERT INTO public.project_assignments
    (assignment_id, team_id, user_id, role, assigned_at, assigned_by,
     receives_approval_emails, full_name, position, company_name, member_role)
SELECT 'pa_' || substr(md5(random()::text || tm.team_id || tm.user_id), 1, 12),
       tm.team_id,
       tm.user_id,
       -- Re-checked rather than trusted. A role outside the CHECK would abort
       -- the whole migration on one row; 'member' is both the measured value
       -- for all 127 and the correct floor for anything unexpected.
       CASE WHEN tm.role IN ('owner', 'admin', 'member', 'client')
            THEN tm.role ELSE 'member' END,
       NOW(),
       NULL,
       tm.receives_approval_emails,
       tm.full_name,
       tm.position,
       tm.company_name,
       tm.member_role
  FROM public.team_members tm
  LEFT JOIN public.project_assignments pa
         ON pa.team_id = tm.team_id AND pa.user_id = tm.user_id
 WHERE tm.status = 'active'
   AND tm.user_id IS NOT NULL
   AND pa.user_id IS NULL
ON CONFLICT (team_id, user_id) DO NOTHING;

-- ── The check that makes this safe to run unattended ────────────────────────
--
-- After the INSERT there must be NO active team_members row without a
-- project_assignments equivalent. If there is, the reconciliation did not do
-- what this file says it does and the transaction is thrown away rather than
-- half-applied — the state `PROPOSED_080` exists to prevent.
DO $$
DECLARE missing bigint;
BEGIN
  SELECT count(*) INTO missing
    FROM public.team_members tm
    LEFT JOIN public.project_assignments pa
           ON pa.team_id = tm.team_id AND pa.user_id = tm.user_id
   WHERE tm.status = 'active' AND tm.user_id IS NOT NULL AND pa.user_id IS NULL;

  IF missing <> 0 THEN
    RAISE EXCEPTION
      '% active team_members row(s) still have no project_assignments equivalent. '
      'The reconciliation is incomplete; nothing has been committed.', missing;
  END IF;
END $$;

-- And nobody's role may have moved. This is the assertion that would catch a
-- reconciliation which quietly changed a permission level rather than adding
-- one, which is the failure mode that is worse than the outage because it is
-- silent.
DO $$
DECLARE drifted bigint;
BEGIN
  SELECT count(*) INTO drifted
    FROM public.team_members tm
    JOIN public.project_assignments pa
      ON pa.team_id = tm.team_id AND pa.user_id = tm.user_id
   WHERE tm.status = 'active' AND tm.role IS DISTINCT FROM pa.role;

  IF drifted <> 0 THEN
    RAISE EXCEPTION
      '% row(s) disagree on role between team_members and project_assignments. '
      'Measured as 0 before this ran; nothing has been committed.', drifted;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   -- expect 0
--   SELECT count(*) FROM public.team_members tm
--     LEFT JOIN public.project_assignments pa
--            ON pa.team_id = tm.team_id AND pa.user_id = tm.user_id
--    WHERE tm.status='active' AND pa.user_id IS NULL;
--
--   -- expect 92 + 127 = 219
--   SELECT count(*) FROM public.project_assignments;
--
--   -- expect 0 — no role moved
--   SELECT count(*) FROM public.team_members tm
--     JOIN public.project_assignments pa
--       ON pa.team_id = tm.team_id AND pa.user_id = tm.user_id
--    WHERE tm.status='active' AND tm.role IS DISTINCT FROM pa.role;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Only the rows this file inserted, identified by their NULL `assigned_by` and
-- their absence from the backup:
--
--   BEGIN;
--   DELETE FROM public.project_assignments pa
--    WHERE NOT EXISTS (
--      SELECT 1 FROM tenancy_195_backup.project_assignments_before b
--       WHERE b.team_id = pa.team_id AND b.user_id = pa.user_id);
--   COMMIT;
--
-- Or wholesale, if the table has not moved since:
--
--   BEGIN;
--   DELETE FROM public.project_assignments;
--   INSERT INTO public.project_assignments
--     SELECT * FROM tenancy_195_backup.project_assignments_before;
--   COMMIT;
--
-- Drop `tenancy_195_backup` only once the 64 call sites have been migrated and
-- a full business cycle has passed — it is the restore point for phases 1-3,
-- not just for this file.
