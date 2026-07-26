-- PROPOSED_077_org_id_backfill.sql
-- Phase 2 of 6 — multi-tenancy cutover. See swarm-reports/audit-tenancy-org-id-cutover.md
-- REQUIRES: PROPOSED_076 applied.
--
-- ############################################################################
-- ##  PROPOSAL ONLY — NOT APPLIED, NOT SCHEDULED.                           ##
-- ##  Writes to LIVE ROWS in the same Supabase project production uses.     ##
-- ##  Take a snapshot first. This is the first phase that mutates data.     ##
-- ############################################################################
--
-- WHAT
--   Populates `public.*.org_id` by walking the join path to `teams.org_id`,
--   in dependency order (teams -> 1-hop -> 2-hop -> 3-hop).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   It does not invent an org for rows that have no path to one. Every
--   statement is written as `WHERE t.org_id IS NOT NULL`, so a row hanging off
--   an org-less team is LEFT NULL rather than guessed. Guessing here would be
--   silently mis-attributing one customer's data to another, and Phase 4 would
--   then lock that mistake in behind a constraint.
--
-- MEASURED RESIDUE (live counts at audit time — re-measure before running)
--
--   table                  total   resolvable   residue   cause
--   ---------------------- -----   ----------   -------   -------------------
--   teams                     39           31         8   org_id IS NULL
--   tasks                    200          165        35   team_id IS NULL
--   team_members             186          170        16   on org-less teams
--   project_assignments       58           42        16   on org-less teams
--   notifications            748          652        96   75 team_id IS NULL
--   task_reminders           235          186        49   parent task no team
--   task_comments             23           19         4   parent task no team
--   activity_events          506          506         0   clean
--
--   Seven of eight leave residue. That is expected and is why Phase 4 uses a
--   conditional CHECK rather than SET NOT NULL. Two decisions are owed before
--   Phase 4 (report §5.2) and NEITHER is a schema decision:
--
--     1. The 8 org-less teams must be assigned to an organisation by someone
--        who knows which customer they belong to, or retired. Only 2 orgs
--        exist, so this is short — but it is a data-ownership judgement.
--     2. Team-less tasks/notifications need a product answer: does a personal
--        task belong to an org, or is it genuinely user-global? If it belongs
--        to the user's org, uncomment the OPTIONAL block at the bottom.
--
-- LOCK DURATION
--   UPDATE takes ROW EXCLUSIVE — it does not block concurrent reads, and
--   blocks only writers touching the same rows. Every row touched is rewritten
--   (a new heap tuple), so cost scales with rows changed, not table size.
--   At today's volumes the largest statement is 652 rows: sub-second.
--
--   The batching loop below is therefore NOT needed today. It is written in
--   because this same file will be re-run after these tables have grown, and a
--   backfill that only works while the table is small is a trap. At scale, an
--   unbatched UPDATE of millions of rows holds a single transaction open long
--   enough to bloat the table and stall autovacuum.
--
--   Do NOT wrap the whole file in one transaction. Each statement stands alone
--   and is independently re-runnable (all are idempotent: `WHERE org_id IS NULL`).
--
-- RISK: MEDIUM.
--   Writes live rows. If a join path is wrong the org_id is wrong, and Phase 4
--   then ENFORCES the wrong value. This is exactly why PROPOSED_078 (verify)
--   is a separate, read-only, mandatory gate between this file and Phase 4.
--   Correctable at zero cost while nothing reads the column — which is true
--   until Phase 6.

SET lock_timeout = '3s';
SET statement_timeout = '300s';

-- ── Tier 1: one hop — child.team_id -> teams.org_id ────────────────────────

UPDATE public.tasks c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.team_members c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.project_assignments c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.activity_events c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.notifications c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.approvals c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.boards c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.project_columns c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.saved_views c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.automations c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.task_templates c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.field_definitions c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.report_schedules c SET org_id = t.org_id
  FROM public.teams t
 WHERE t.team_id = c.team_id AND t.org_id IS NOT NULL AND c.org_id IS NULL;

-- ── Tier 2: two hops — must run AFTER tier 1 populated tasks/boards ────────
--
-- These read `tasks.org_id`, not `tasks.team_id -> teams.org_id`. Reading the
-- already-backfilled parent keeps parent and child consistent by construction:
-- a child can never disagree with its parent about which org it is in, even if
-- tier 1 is later corrected and these are re-run.

UPDATE public.task_comments c SET org_id = k.org_id
  FROM public.tasks k
 WHERE k.task_id = c.task_id AND k.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.task_reminders c SET org_id = k.org_id
  FROM public.tasks k
 WHERE k.task_id = c.task_id AND k.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.time_entries c SET org_id = k.org_id
  FROM public.tasks k
 WHERE k.task_id = c.task_id AND k.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.task_clients c SET org_id = k.org_id
  FROM public.tasks k
 WHERE k.task_id = c.task_id AND k.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.field_values c SET org_id = k.org_id
  FROM public.tasks k
 WHERE k.task_id = c.task_id AND k.org_id IS NOT NULL AND c.org_id IS NULL;

UPDATE public.board_columns c SET org_id = b.org_id
  FROM public.boards b
 WHERE b.board_id = c.board_id AND b.org_id IS NOT NULL AND c.org_id IS NULL;

-- ── Tier 3: three hops — AFTER tier 2 populated task_comments ──────────────

UPDATE public.mentions c SET org_id = tc.org_id
  FROM public.task_comments tc
 WHERE tc.comment_id = c.comment_id AND tc.org_id IS NOT NULL AND c.org_id IS NULL;

-- ── Batched form, for when these tables are no longer small ────────────────
--
-- Swap any statement above for this shape once a table exceeds ~1M rows.
-- Each batch is its own transaction: bounded lock hold, bounded WAL, and
-- autovacuum gets a window between batches. Re-run until it reports 0.
--
-- DO $$
-- DECLARE moved integer;
-- BEGIN
--   LOOP
--     WITH batch AS (
--       SELECT c.task_id
--         FROM public.task_comments c
--         JOIN public.tasks k ON k.task_id = c.task_id
--        WHERE c.org_id IS NULL AND k.org_id IS NOT NULL
--        LIMIT 10000
--        FOR UPDATE OF c SKIP LOCKED
--     )
--     UPDATE public.task_comments c SET org_id = k.org_id
--       FROM public.tasks k, batch
--      WHERE c.task_id = batch.task_id AND k.task_id = c.task_id;
--     GET DIAGNOSTICS moved = ROW_COUNT;
--     EXIT WHEN moved = 0;
--     COMMIT;
--     PERFORM pg_sleep(0.1);
--   END LOOP;
-- END $$;

-- ── OPTIONAL: user-derived fallback for team-less rows ─────────────────────
--
-- DO NOT RUN without the product decision in §5.2 decision 2.
--
-- This attributes a personal (team-less) task to its owner's org via
-- staging.user_roles. It is only correct if the product answer is "a personal
-- task belongs to the user's org". If the answer is "personal tasks are
-- user-global", leave these NULL and keep Phase 4's conditional CHECK.
--
-- Note the `LIMIT 1` problem: a user may hold org-scoped roles in more than one
-- org (the header-based org switcher exists precisely because that is allowed).
-- Picking the earliest grant is a guess. If any user has two org roles, this
-- block must not run unattended. Check first:
--
--   SELECT user_id, count(*) FROM staging.user_roles
--    WHERE org_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--
-- UPDATE public.tasks c SET org_id = (
--          SELECT r.org_id FROM staging.user_roles r
--           WHERE r.user_id = c.created_by_user_id AND r.org_id IS NOT NULL
--           ORDER BY r.granted_at LIMIT 1)
--  WHERE c.org_id IS NULL AND c.team_id IS NULL;
--
-- UPDATE public.notifications c SET org_id = (
--          SELECT r.org_id FROM staging.user_roles r
--           WHERE r.user_id = c.user_id AND r.org_id IS NOT NULL
--           ORDER BY r.granted_at LIMIT 1)
--  WHERE c.org_id IS NULL AND c.team_id IS NULL;

-- ── NEXT ───────────────────────────────────────────────────────────────────
--   Run PROPOSED_078 (read-only) and read its output before Phase 4.
--   Do not proceed to PROPOSED_079 on an unexamined residue.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Safe and complete WHILE NO CONSTRAINT EXISTS and nothing reads the column —
-- true until PROPOSED_079. After Phase 4, drop the constraints first.
--
-- Reverting to NULL loses nothing: the values are derived, and re-running this
-- file reproduces them exactly.
--
-- SET lock_timeout = '3s';
--
-- UPDATE public.mentions            SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.board_columns       SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.field_values        SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.task_clients        SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.time_entries        SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.task_reminders      SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.task_comments       SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.report_schedules    SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.field_definitions   SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.task_templates      SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.automations         SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.saved_views         SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.project_columns     SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.boards              SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.approvals           SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.notifications       SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.activity_events     SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.project_assignments SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.team_members        SET org_id = NULL WHERE org_id IS NOT NULL;
-- UPDATE public.tasks               SET org_id = NULL WHERE org_id IS NOT NULL;
