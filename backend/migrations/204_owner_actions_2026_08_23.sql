-- 204 · Three owner decisions, actioned 2026-08-23.
--
-- Each was measured and put to the owner in `docs/OWNER-ACTIONS.md`; each is
-- his answer, carried out. Nothing here was inferred.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · UNICODE GROUP GETS AN OWNER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Measured: Unicode Group held FIVE `org_admin` rows and ZERO `org_owner`.
-- `org_owner` is the only role that may switch an organisation's own modules on
-- and off (`ORG_OWNER_ONLY`), and the authority that appoints a payroll
-- approver — so that org could do neither, and until this session no endpoint
-- anywhere could give it one.
--
-- The owner named `kevalvshah03!@gmail.com`. THAT ADDRESS DOES NOT EXIST — the
-- `!` is a typo, confirmed by measurement: `SELECT count(*) … WHERE
-- email='kevalvshah03!@gmail.com'` returns 0. `kevalvshah03@gmail.com` does
-- exist, is KEVAL SHAH, and is ALREADY an `org_admin` of Unicode Group, which
-- is the precondition `admin_orgs.nominate_org_owner` enforces. So the
-- intention is unambiguous and this is the address used.
--
-- This does the same two writes that endpoint does, in the same order, and it
-- is an INSERT: the existing `org_admin` row is left exactly where it is,
-- because `org_owner` outranks it everywhere the two are compared and removing
-- the lower row would rewrite a live grant to achieve nothing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · THE TEN CLEARANCE ROWS, NORMALISED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `manav_offboarding.clearance` holds two shapes. One row is the ARRAY that
-- migration 083 and `_DEFAULT_CLEARANCE` specify; ten are an earlier OBJECT,
-- `{"hr": false, "finance": false, "it_assets": true}`. Iterating an object in
-- Python yields its KEYS, so `complete_offboarding`'s guard counted nothing
-- pending and TWO exits were closed with clearance untouched.
--
-- The guard was fixed in code first — it reads both shapes now — so this
-- migration is tidying, not a repair, and it is safe to run late.
--
-- THE TICK STATE IS CARRIED, NOT RESET. `it_assets: true` becomes an item with
-- `done: true`. Resetting them would silently un-tick work somebody actually
-- did, which is the opposite of the defect being closed. The three keys in use
-- across all ten rows are exactly `hr`, `finance` and `it_assets` — measured,
-- not assumed — so the mapping below is complete and nothing falls through.
--
-- `done_at` is left NULL rather than stamped with now(): these were ticked at
-- some earlier moment that was never recorded, and writing today's date would
-- assert a fact about when that is not true.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · THE TEN ORG-LESS PROJECTS, DELETED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Measured 2026-08-22/23 and put to the owner with the evidence:
--
--   8  soft-deleted "Solar Technocast" duplicates, created 18 Jul within 30
--      seconds of one another, `deleted_at` 25 Jul, ZERO tasks each
--   2  "FY 2026-27 Statutory Audit — Shah & Associates" / "…Shah and
--      Associates", created 28 Jul 43 seconds apart, ZERO tasks, only the five
--      default columns, created by the QA account evicted from every live org
--      on 22 August
--
-- Hanging off all ten: 0 tasks, 0 `team_members`, 20 `project_assignments`,
-- 50 `project_columns`. Nothing else.
--
-- CHILDREN BEFORE PARENTS, and that is not a style choice here: only
-- `task_reminders` declares a foreign key to `tasks`, so nine other tables
-- carrying a `team_id` orphan SILENTLY rather than raising. The order below is
-- the same one the 22 August cleanup used.
--
-- This is what unblocks `PROPOSED_079` (`teams.org_id NOT NULL`), which is
-- phase 4 of the tenancy cutover.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK, AND THE BACKUP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Staging and production share one Supabase database, so all three of these are
-- production writes. Two are additive; the third is a DELETE and is the only
-- irreversible thing in this file.
--
-- `owner_actions_20260823` holds a full copy of every row touched, taken BEFORE
-- anything is changed, and the restores are at the foot of this file. The
-- delete set is captured as a frozen table rather than recomputed at delete
-- time, so it cannot drift between the backup and the delete — which is the
-- property the 22 August cleanup was built around.

BEGIN;

CREATE SCHEMA IF NOT EXISTS owner_actions_20260823;

-- ── The frozen delete set, taken first ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_actions_20260823.teams_to_delete AS
  SELECT team_id FROM public.teams WHERE org_id IS NULL;

CREATE TABLE IF NOT EXISTS owner_actions_20260823.teams_before AS
  SELECT t.* FROM public.teams t
   WHERE t.team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

CREATE TABLE IF NOT EXISTS owner_actions_20260823.project_assignments_before AS
  SELECT pa.* FROM public.project_assignments pa
   WHERE pa.team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

CREATE TABLE IF NOT EXISTS owner_actions_20260823.project_columns_before AS
  SELECT pc.* FROM public.project_columns pc
   WHERE pc.team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

CREATE TABLE IF NOT EXISTS owner_actions_20260823.offboarding_before AS
  SELECT * FROM staging.manav_offboarding;

CREATE TABLE IF NOT EXISTS owner_actions_20260823.user_roles_before AS
  SELECT * FROM staging.user_roles
   WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid;

-- ── 3 · the owner ───────────────────────────────────────────────────────────
INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by)
SELECT u.user_id,
       'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid,
       'org_owner',
       u.user_id                       -- appointed by the platform owner himself
  FROM public.users u
 WHERE u.email = 'kevalvshah03@gmail.com'
ON CONFLICT DO NOTHING;

--  Fill-only, never overwrite: the column records the founder, and Unicode
--  Group's is NULL because it predates `create_org` seating one.
UPDATE staging.organisations o
   SET owner_user_id = (SELECT user_id FROM public.users
                         WHERE email = 'kevalvshah03@gmail.com'),
       updated_at = NOW()
 WHERE o.id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
   AND o.owner_user_id IS NULL;

-- ── 4 · the clearance rows ──────────────────────────────────────────────────
UPDATE staging.manav_offboarding o
   SET clearance = (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'item',  CASE k
                              WHEN 'hr'        THEN 'HR clearance'
                              WHEN 'finance'   THEN 'Finance clearance'
                              WHEN 'it_assets' THEN 'Company assets and IT access returned'
                              ELSE initcap(replace(k, '_', ' '))
                            END,
                   'owner', CASE k
                              WHEN 'hr'        THEN 'HR'
                              WHEN 'finance'   THEN 'Finance'
                              WHEN 'it_assets' THEN 'IT'
                              ELSE ''
                            END,
                   'done',  (o.clearance -> k)::text = 'true')
                 ORDER BY k)
          FROM jsonb_object_keys(o.clearance) AS k),
       updated_at = NOW()
 WHERE jsonb_typeof(o.clearance) = 'object';

-- ── 5 · the ten org-less projects, children first ───────────────────────────
DELETE FROM public.project_columns
 WHERE team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

DELETE FROM public.project_assignments
 WHERE team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

DELETE FROM public.team_members
 WHERE team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

DELETE FROM public.teams
 WHERE team_id IN (SELECT team_id FROM owner_actions_20260823.teams_to_delete);

-- ── The checks that make this safe to run unattended ────────────────────────
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM staging.user_roles
   WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
     AND role_code = 'org_owner';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Unicode Group has % owner rows, expected exactly 1', n;
  END IF;

  SELECT count(*) INTO n FROM staging.manav_offboarding
   WHERE jsonb_typeof(clearance) <> 'array';
  IF n <> 0 THEN
    RAISE EXCEPTION '% clearance value(s) are still not an array', n;
  END IF;

  SELECT count(*) INTO n FROM public.teams WHERE org_id IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% team(s) still carry no organisation', n;
  END IF;

  --  Nothing outside the frozen set may have been deleted.
  SELECT count(*) INTO n FROM public.teams;
  IF n <> 42 THEN
    RAISE EXCEPTION 'teams is % rows, expected 52 - 10 = 42', n;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT role_code, count(*) FROM staging.user_roles
--    WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' GROUP BY 1;
--        -- expect org_owner 1, org_admin 5, org_member 6
--
--   SELECT jsonb_typeof(clearance), count(*) FROM staging.manav_offboarding
--    GROUP BY 1;                       -- expect array 11, and nothing else
--
--   SELECT count(*) FROM public.teams WHERE org_id IS NULL;   -- expect 0
--   SELECT count(*) FROM public.teams;                        -- expect 42
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
--   BEGIN;
--   -- 5 · the projects, parents before children this time
--   INSERT INTO public.teams               SELECT * FROM owner_actions_20260823.teams_before;
--   INSERT INTO public.project_assignments SELECT * FROM owner_actions_20260823.project_assignments_before;
--   INSERT INTO public.project_columns     SELECT * FROM owner_actions_20260823.project_columns_before;
--   -- 4 · the clearance shapes
--   UPDATE staging.manav_offboarding o SET clearance = b.clearance
--     FROM owner_actions_20260823.offboarding_before b WHERE b.id = o.id;
--   -- 3 · the owner row
--   DELETE FROM staging.user_roles
--    WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND role_code='org_owner';
--   UPDATE staging.organisations SET owner_user_id = NULL
--    WHERE id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid;
--   COMMIT;
--
-- Drop `owner_actions_20260823` only once the owner confirms nothing is missing.
