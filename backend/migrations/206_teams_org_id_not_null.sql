-- 206_teams_org_id_not_null.sql
-- Tenancy cutover, teams.org_id — the piece the handover called "PROPOSED_079"
-- but PROPOSED_079_org_id_constrain.sql does NOT touch public.teams at all;
-- it constrains 13 unrelated tables (tasks, notifications, team_members, ...)
-- whose org_id column does not exist yet in public (076/077/078 never applied).
-- That file is NOT ready to run. This one is a separate, much smaller fact:
-- public.teams itself is finally clean.
--
-- Precondition, measured live today (2026-08-23) before writing this file:
--   public.teams: 42 rows, 0 with org_id IS NULL, no existing org_id constraint.
--   The 10 rows that were NULL are the org-less projects deleted in migration
--   204 (owner-approved). Table is 480kB or smaller; a full-table ACCESS
--   EXCLUSIVE scan is microseconds, so SET NOT NULL directly (not the
--   NOT VALID + VALIDATE two-step 079 uses for larger/hotter tables) is safe
--   here and gives a real NOT NULL rather than an emulating CHECK.
--
-- Risk: LOW. teams.org_id is not written by any insert path today with a
-- NULL value — the only rows that were ever NULL are gone. No application
-- code path relies on teams.org_id being nullable (grepped: no `org_id is
-- null` / `org_id IS NULL` predicate against public.teams anywhere in
-- backend/). This does not touch staging.user_roles or any other table
-- where NULL org_id is a meaningful platform-scope value.

SET lock_timeout = '3s';

ALTER TABLE public.teams
  ALTER COLUMN org_id SET NOT NULL;

-- Verification:
--   SELECT is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='teams' AND column_name='org_id';
--   -- expect 'NO'

-- Rollback (instantaneous, catalog-only):
--   ALTER TABLE public.teams ALTER COLUMN org_id DROP NOT NULL;
