-- PROPOSED_078_org_id_verify.sql
-- Phase 3 of 6 — multi-tenancy cutover. See swarm-reports/audit-tenancy-org-id-cutover.md
-- REQUIRES: PROPOSED_076 and PROPOSED_077 applied.
--
-- ############################################################################
-- ##  READ-ONLY. SELECT statements only — no DDL, no DML, no side effects.  ##
-- ##  Safe to run against production at any time, including right now,      ##
-- ##  before any other phase (it will simply report the pre-state).         ##
-- ############################################################################
--
-- WHY THIS IS A PHASE AND NOT A COMMENT
--   Phase 4 turns whatever Phase 2 produced into an enforced invariant. If the
--   backfill mis-attributed a row, Phase 4 makes that permanent and invisible.
--   This file is the gate between "derived" and "enforced", and its output is
--   meant to be READ by a person, not just exited 0 on.
--
--   There is no automated pass/fail here on purpose. Query 1 will show residue
--   — that is expected, not a failure. The judgement is whether the residue is
--   the residue you expect, and only a human who knows the customers can say.
--
-- HOW TO READ THE OUTPUT
--   Q1  Residue per table. Compare against the measured baseline in
--       PROPOSED_077's header. Numbers materially HIGHER than baseline mean a
--       join path did not fire. Numbers LOWER mean rows were resolved that the
--       audit could not resolve — investigate before being pleased.
--   Q2  Parent/child disagreement. MUST be zero on every row. Any non-zero
--       value is a child attributed to a different org than its parent, which
--       is the exact shape of a cross-tenant mis-attribution. STOP if non-zero.
--   Q3  Orphan classification: distinguishes "no parent" from "parent has no
--       org". Only the second kind is fixed by assigning the 8 org-less teams.
--   Q4  Every org_id written must exist in staging.organisations. MUST be zero.
--   Q5  The two org-less anchors, listed so decision 1 can actually be made.
--   Q6  Phase 4 readiness: for each table, would the conditional CHECK pass?

\echo '=== Q1: residue per table (expected non-zero — compare to baseline) ==='

SELECT 'tasks'               AS tbl, count(*) AS total, count(org_id) AS with_org, count(*) - count(org_id) AS residue FROM public.tasks
UNION ALL SELECT 'team_members',        count(*), count(org_id), count(*) - count(org_id) FROM public.team_members
UNION ALL SELECT 'project_assignments', count(*), count(org_id), count(*) - count(org_id) FROM public.project_assignments
UNION ALL SELECT 'activity_events',     count(*), count(org_id), count(*) - count(org_id) FROM public.activity_events
UNION ALL SELECT 'notifications',       count(*), count(org_id), count(*) - count(org_id) FROM public.notifications
UNION ALL SELECT 'approvals',           count(*), count(org_id), count(*) - count(org_id) FROM public.approvals
UNION ALL SELECT 'boards',              count(*), count(org_id), count(*) - count(org_id) FROM public.boards
UNION ALL SELECT 'project_columns',     count(*), count(org_id), count(*) - count(org_id) FROM public.project_columns
UNION ALL SELECT 'saved_views',         count(*), count(org_id), count(*) - count(org_id) FROM public.saved_views
UNION ALL SELECT 'automations',         count(*), count(org_id), count(*) - count(org_id) FROM public.automations
UNION ALL SELECT 'task_templates',      count(*), count(org_id), count(*) - count(org_id) FROM public.task_templates
UNION ALL SELECT 'field_definitions',   count(*), count(org_id), count(*) - count(org_id) FROM public.field_definitions
UNION ALL SELECT 'report_schedules',    count(*), count(org_id), count(*) - count(org_id) FROM public.report_schedules
UNION ALL SELECT 'task_comments',       count(*), count(org_id), count(*) - count(org_id) FROM public.task_comments
UNION ALL SELECT 'task_reminders',      count(*), count(org_id), count(*) - count(org_id) FROM public.task_reminders
UNION ALL SELECT 'time_entries',        count(*), count(org_id), count(*) - count(org_id) FROM public.time_entries
UNION ALL SELECT 'task_clients',        count(*), count(org_id), count(*) - count(org_id) FROM public.task_clients
UNION ALL SELECT 'field_values',        count(*), count(org_id), count(*) - count(org_id) FROM public.field_values
UNION ALL SELECT 'board_columns',       count(*), count(org_id), count(*) - count(org_id) FROM public.board_columns
UNION ALL SELECT 'mentions',            count(*), count(org_id), count(*) - count(org_id) FROM public.mentions
ORDER BY residue DESC, tbl;

\echo ''
\echo '=== Q2: parent/child org disagreement — MUST BE ZERO ON EVERY ROW ==='
\echo '=== any non-zero value is a cross-tenant mis-attribution. STOP.     ==='

SELECT 'tasks vs teams' AS rel, count(*) AS mismatches
  FROM public.tasks c JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NOT NULL AND t.org_id IS NOT NULL AND c.org_id <> t.org_id
UNION ALL
SELECT 'team_members vs teams', count(*)
  FROM public.team_members c JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NOT NULL AND t.org_id IS NOT NULL AND c.org_id <> t.org_id
UNION ALL
SELECT 'project_assignments vs teams', count(*)
  FROM public.project_assignments c JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NOT NULL AND t.org_id IS NOT NULL AND c.org_id <> t.org_id
UNION ALL
SELECT 'activity_events vs teams', count(*)
  FROM public.activity_events c JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NOT NULL AND t.org_id IS NOT NULL AND c.org_id <> t.org_id
UNION ALL
SELECT 'notifications vs teams', count(*)
  FROM public.notifications c JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NOT NULL AND t.org_id IS NOT NULL AND c.org_id <> t.org_id
UNION ALL
SELECT 'approvals vs teams', count(*)
  FROM public.approvals c JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NOT NULL AND t.org_id IS NOT NULL AND c.org_id <> t.org_id
UNION ALL
SELECT 'task_comments vs tasks', count(*)
  FROM public.task_comments c JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NOT NULL AND k.org_id IS NOT NULL AND c.org_id <> k.org_id
UNION ALL
SELECT 'task_reminders vs tasks', count(*)
  FROM public.task_reminders c JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NOT NULL AND k.org_id IS NOT NULL AND c.org_id <> k.org_id
UNION ALL
SELECT 'time_entries vs tasks', count(*)
  FROM public.time_entries c JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NOT NULL AND k.org_id IS NOT NULL AND c.org_id <> k.org_id
UNION ALL
SELECT 'field_values vs tasks', count(*)
  FROM public.field_values c JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NOT NULL AND k.org_id IS NOT NULL AND c.org_id <> k.org_id
UNION ALL
SELECT 'task_clients vs tasks', count(*)
  FROM public.task_clients c JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NOT NULL AND k.org_id IS NOT NULL AND c.org_id <> k.org_id
UNION ALL
SELECT 'board_columns vs boards', count(*)
  FROM public.board_columns c JOIN public.boards b ON b.board_id = c.board_id
 WHERE c.org_id IS NOT NULL AND b.org_id IS NOT NULL AND c.org_id <> b.org_id
UNION ALL
SELECT 'mentions vs task_comments', count(*)
  FROM public.mentions c JOIN public.task_comments tc ON tc.comment_id = c.comment_id
 WHERE c.org_id IS NOT NULL AND tc.org_id IS NOT NULL AND c.org_id <> tc.org_id
ORDER BY mismatches DESC;

\echo ''
\echo '=== Q3: why is each residual row unresolved? ==='
\echo '=== "no parent" needs a data-integrity fix; "parent has no org"     ==='
\echo '=== is fixed by assigning the org-less teams in Q5.                 ==='

SELECT 'tasks' AS tbl,
       count(*) FILTER (WHERE c.team_id IS NULL)                       AS no_parent_ref,
       count(*) FILTER (WHERE c.team_id IS NOT NULL AND t.team_id IS NULL)  AS dangling_ref,
       count(*) FILTER (WHERE t.team_id IS NOT NULL AND t.org_id IS NULL)   AS parent_has_no_org
  FROM public.tasks c LEFT JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NULL
UNION ALL
SELECT 'notifications',
       count(*) FILTER (WHERE c.team_id IS NULL),
       count(*) FILTER (WHERE c.team_id IS NOT NULL AND t.team_id IS NULL),
       count(*) FILTER (WHERE t.team_id IS NOT NULL AND t.org_id IS NULL)
  FROM public.notifications c LEFT JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NULL
UNION ALL
SELECT 'team_members',
       count(*) FILTER (WHERE c.team_id IS NULL),
       count(*) FILTER (WHERE c.team_id IS NOT NULL AND t.team_id IS NULL),
       count(*) FILTER (WHERE t.team_id IS NOT NULL AND t.org_id IS NULL)
  FROM public.team_members c LEFT JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NULL
UNION ALL
SELECT 'project_assignments',
       count(*) FILTER (WHERE c.team_id IS NULL),
       count(*) FILTER (WHERE c.team_id IS NOT NULL AND t.team_id IS NULL),
       count(*) FILTER (WHERE t.team_id IS NOT NULL AND t.org_id IS NULL)
  FROM public.project_assignments c LEFT JOIN public.teams t ON t.team_id = c.team_id
 WHERE c.org_id IS NULL
UNION ALL
SELECT 'task_reminders',
       count(*) FILTER (WHERE c.task_id IS NULL),
       count(*) FILTER (WHERE c.task_id IS NOT NULL AND k.task_id IS NULL),
       count(*) FILTER (WHERE k.task_id IS NOT NULL AND k.org_id IS NULL)
  FROM public.task_reminders c LEFT JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NULL
UNION ALL
SELECT 'task_comments',
       count(*) FILTER (WHERE c.task_id IS NULL),
       count(*) FILTER (WHERE c.task_id IS NOT NULL AND k.task_id IS NULL),
       count(*) FILTER (WHERE k.task_id IS NOT NULL AND k.org_id IS NULL)
  FROM public.task_comments c LEFT JOIN public.tasks k ON k.task_id = c.task_id
 WHERE c.org_id IS NULL;

\echo ''
\echo '=== Q4: referential sanity — every org_id must exist. MUST BE ZERO. ==='

SELECT 'tasks' AS tbl, count(*) AS orphan_org_ids
  FROM public.tasks c
 WHERE c.org_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM staging.organisations o WHERE o.id = c.org_id)
UNION ALL
SELECT 'team_members', count(*) FROM public.team_members c
 WHERE c.org_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM staging.organisations o WHERE o.id = c.org_id)
UNION ALL
SELECT 'notifications', count(*) FROM public.notifications c
 WHERE c.org_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM staging.organisations o WHERE o.id = c.org_id)
UNION ALL
SELECT 'activity_events', count(*) FROM public.activity_events c
 WHERE c.org_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM staging.organisations o WHERE o.id = c.org_id)
ORDER BY orphan_org_ids DESC;

\echo ''
\echo '=== Q5: the org-less teams — decision 1 needs this list ==='
\echo '=== assign each to an organisation, or retire it.       ==='

SELECT t.team_id, t.name, t.created_at, t.deleted_at,
       (SELECT count(*) FROM public.tasks        x WHERE x.team_id = t.team_id) AS tasks,
       (SELECT count(*) FROM public.team_members x WHERE x.team_id = t.team_id) AS members,
       (SELECT count(*) FROM public.activity_events x WHERE x.team_id = t.team_id) AS events
  FROM public.teams t
 WHERE t.org_id IS NULL
 ORDER BY t.created_at;

\echo ''
\echo '=== Q6: Phase 4 readiness — would the conditional CHECK pass today? ==='
\echo '=== violations > 0 means PROPOSED_079 VALIDATE will fail on it.     ==='

SELECT 'tasks (org_id IS NOT NULL OR team_id IS NULL)' AS constraint_shape,
       count(*) FILTER (WHERE org_id IS NULL AND team_id IS NOT NULL) AS violations
  FROM public.tasks
UNION ALL
SELECT 'notifications (org_id IS NOT NULL OR team_id IS NULL)',
       count(*) FILTER (WHERE org_id IS NULL AND team_id IS NOT NULL)
  FROM public.notifications
UNION ALL
SELECT 'team_members (org_id IS NOT NULL)',
       count(*) FILTER (WHERE org_id IS NULL)
  FROM public.team_members
UNION ALL
SELECT 'project_assignments (org_id IS NOT NULL)',
       count(*) FILTER (WHERE org_id IS NULL)
  FROM public.project_assignments
UNION ALL
SELECT 'activity_events (org_id IS NOT NULL)',
       count(*) FILTER (WHERE org_id IS NULL)
  FROM public.activity_events
UNION ALL
SELECT 'task_comments (org_id IS NOT NULL OR parent task has no team)',
       (SELECT count(*) FROM public.task_comments c
          JOIN public.tasks k ON k.task_id = c.task_id
         WHERE c.org_id IS NULL AND k.team_id IS NOT NULL)
UNION ALL
SELECT 'task_reminders (org_id IS NOT NULL OR parent task has no team)',
       (SELECT count(*) FROM public.task_reminders c
          JOIN public.tasks k ON k.task_id = c.task_id
         WHERE c.org_id IS NULL AND k.team_id IS NOT NULL)
ORDER BY violations DESC;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- None required. This file only reads.
--
-- The `\echo` directives are psql meta-commands. Running this through a driver
-- that does not understand them (asyncpg, any non-psql client) will error on
-- the first one — strip the \echo lines and run the SELECTs individually.
