-- 199 · Tenancy phase 3 — `staging.user_org_context` stops reading `team_members`.
--
-- Step 3 of the retirement sequence in `PROPOSED_080_team_members_retire`:
-- "Replace staging.user_org_context with a user_roles-based definition." It is
-- the last thing standing between phase 2 (the code, done) and step 4 (the
-- rename), because a rename breaks a view that names the renamed table
-- immediately.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE VIEW ACTUALLY WAS — narrower than anybody thought
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The definition, read off the live catalogue on 2026-08-22:
--
--   SELECT u.user_id, u.email, u.name, tm.team_id, tm.role,
--          o.id AS org_id, o.name AS org_name
--     FROM users u
--     JOIN team_members tm ON tm.user_id = u.user_id
--     JOIN staging.organisations o ON o.team_id = tm.team_id
--    WHERE tm.status = 'active';
--
-- The join is `organisations.team_id = team_members.team_id` — the org's
-- FOUNDING team and no other. So the view has never described "who is in this
-- organisation"; it describes "who is on the one team the organisation was
-- created around". Measured: **12 rows**, across 3 orgs and 35 users.
--
-- That is also the second, undocumented org path `PROPOSED_080` flags in
-- passing: `staging.organisations.team_id` runs opposite to `public.teams.org_id`.
-- Two directions for one relationship. This file settles it — `teams.org_id` is
-- canonical, because it is the one `get_visible_team_ids` and `POST /teams` both
-- use, and the one that can describe an org with more than one project.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NOT THE user_roles-ONLY REPLACEMENT PROPOSED_080 SKETCHES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Because it loses two live people, and the view's only job is to put a NAME on
-- a user id. Measured against the two definitions:
--
--   current view                                    12 rows
--   user_roles only                                 28 rows
--   in the CURRENT view but NOT in user_roles        2   ← Devang Bhatt and
--                                                          Rohan Kasti, both
--                                                          Aekam Inc
--
-- Those two sit on Aekam's founding team and hold no `staging.user_roles` row
-- for it. Under a user_roles-only view their names would silently stop
-- resolving — and both consumers of this view are name resolvers, so the effect
-- is a task list that says who three of five assignees are. Giving them
-- `user_roles` rows instead would be writing membership into a customer's
-- organisation to make a view convenient, which is not a migration's decision.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES INSTEAD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The UNION of the two paths that survive the retirement:
--
--   · org membership   — `staging.user_roles`, the sole tenant path
--   · project membership — `public.project_assignments` + `public.teams.org_id`,
--     which is the table migration 195 reconciled `team_members` into and the
--     one every call site now reads
--
-- Neither names `team_members`, which is the whole requirement. Measured:
--
--   union                                           35 rows
--   in the current view but NOT in the union         0   ← nobody is lost
--   users given two different names in one org       0
--   system (Niyam) accounts named                    0
--
-- 23 people gain a resolvable name who did not have one, which is a
-- straightforward improvement for a view whose consumers are
-- `services/skills/data/deadline_scanner.py` (assignee names on a deadline
-- list) and `workload_calculator.py` (a name beside a workload count).
--
-- ── `team_id` AND `role` ARE DROPPED, and that is checked, not assumed ─────
--
-- `PROPOSED_080` warns that its replacement drops `team_id` and says to check
-- consumers first. Both were grepped across backend, frontend and mobile:
-- the only two callers select `user_id`, `name` and `org_id`. Nothing reads
-- `team_id` or `role` off this view, and they cannot be carried anyway — a
-- person on three projects would become three rows and `string_agg(DISTINCT
-- c.name)` would still be right while a workload LEFT JOIN would triple-count.
-- One row per (user, org) is the correct shape for a name lookup.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `CREATE OR REPLACE VIEW` cannot change or drop an existing column, so this
-- has to DROP and CREATE. That is a moment — measured in milliseconds — where
-- the view does not exist. Both consumers are Sahayak skills, not request-path
-- code, and a skill that runs in that window fails and is retried. Wrapped in a
-- transaction so no reader ever sees a half-built definition.
--
-- Staging and production share one Supabase database, so this IS a production
-- change. No table is touched, no row is written, and nothing on `main` reads
-- this view either — production last moved 2026-07-24.
--
-- Nothing else in the catalogue depends on it (`pg_depend` over `pg_rewrite`:
-- zero dependents).

BEGIN;

DROP VIEW IF EXISTS staging.user_org_context;

CREATE VIEW staging.user_org_context AS
  --  Org membership: the sole tenant path.
  SELECT u.user_id,
         u.email,
         u.name,
         r.org_id,
         o.name AS org_name
    FROM public.users u
    JOIN staging.user_roles r    ON r.user_id = u.user_id
    JOIN staging.organisations o ON o.id = r.org_id
   WHERE r.org_id IS NOT NULL
     AND o.is_active = TRUE

  UNION

  --  Project membership: the table 195 reconciled team_members into. This leg
  --  is what keeps the two Aekam Inc names above resolving, and it is why this
  --  is a UNION rather than the user_roles-only sketch.
  SELECT u.user_id,
         u.email,
         u.name,
         t.org_id,
         o.name AS org_name
    FROM public.users u
    JOIN public.project_assignments pa ON pa.user_id = u.user_id
    JOIN public.teams t                ON t.team_id  = pa.team_id
    JOIN staging.organisations o       ON o.id       = t.org_id
   WHERE t.org_id IS NOT NULL
     AND o.is_active = TRUE;

COMMENT ON VIEW staging.user_org_context IS
    'Which people a given organisation can put a NAME to. Union of org '
    'membership (staging.user_roles) and project membership '
    '(public.project_assignments + public.teams.org_id). Reads no '
    'team_members — see migration 199 and PROPOSED_080 step 3. One row per '
    '(user, org); team_id and role were dropped because no consumer read them '
    'and carrying them would multiply a person by their projects.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   -- expect FALSE
--   SELECT definition ILIKE '%team_members%'
--     FROM pg_views WHERE schemaname='staging' AND viewname='user_org_context';
--
--   -- expect 35, and 35
--   SELECT count(*) FROM staging.user_org_context;
--   SELECT count(*) FROM (SELECT DISTINCT user_id, org_id
--                           FROM staging.user_org_context) x;
--
--   -- expect 0 — no person carries two names in one org
--   SELECT count(*) FROM (SELECT user_id, org_id FROM staging.user_org_context
--                          GROUP BY 1,2 HAVING count(*) > 1) x;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The definition as it stood, restored verbatim. Only meaningful BEFORE step 4:
-- once `team_members` is renamed this will not create.
--
--   BEGIN;
--   DROP VIEW IF EXISTS staging.user_org_context;
--   CREATE VIEW staging.user_org_context AS
--     SELECT u.user_id, u.email, u.name, tm.team_id, tm.role,
--            o.id AS org_id, o.name AS org_name
--       FROM public.users u
--       JOIN public.team_members tm ON tm.user_id = u.user_id
--       JOIN staging.organisations o ON o.team_id = tm.team_id
--      WHERE tm.status = 'active';
--   COMMIT;
