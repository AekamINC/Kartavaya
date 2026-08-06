-- 117_project_requires_approval.sql
--
-- APPROVAL IS A PROPERTY OF A PROJECT. IT WAS STORED ON THE TASK, WRITTEN BY
-- NOTHING, AND READ AS IF SOMEBODY HAD SET IT.
--
-- THERE IS ONLY ONE DATABASE AND PRODUCTION WRITES TO IT TOO. Applying this
-- file is a production change, as 093–098, 105 and 110 all say. Apply by hand,
-- in a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/117_project_requires_approval.sql
-- Nothing here is applied automatically and no application code applies it.
-- `services/task_transitions.py` is written to be CORRECT ON BOTH SIDES of this
-- file — see §5.
--
-- ⚠ THESE TABLES ARE IN `public`, NOT `staging`. Measured 2026-08-06 against
-- information_schema on project toacecaewujfxjfrjwco: `tasks`, `teams`,
-- `team_members` and `project_columns` exist ONLY in `public`; of the tables
-- this file touches, only `project_assignments` exists in both schemas and this
-- file does not touch it. Several neighbouring migrations say `staging.` and are
-- right about THEIR tables; copying that prefix here produces
-- "relation does not exist", so the schema is written out explicitly on every
-- statement below rather than left to search_path.
--
-- Additive and reversible. ONE new column (nullable-equivalent, defaulted),
-- ONE new table, TWO comments, ONE constraint added NOT VALID. No DROP, no
-- rewrite, no trigger, and — deliberately — NO BACKFILL. Every statement is
-- `IF NOT EXISTS` / `DO $$ … $$` guarded, so the file is replayable: run it
-- twice and the second run does nothing.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- `tasks.requires_approval` was created by 001_role_based_access.py:51 and has
-- been read in four places ever since — `TaskOut` (server.py, and a SECOND copy
-- in utils.py:336), `row_to_task` (server.py, and utils.py:418), and the board
-- query (server.py). It is written by ZERO code paths: not `TaskCreate`, not
-- `TaskUpdate`, not the PUT allowlist, not `BulkTaskPatch` (which is
-- `extra="forbid"`), not any `INSERT INTO tasks`, not any seed script.
--
-- A column nothing writes and four things read is the shape of a feature that
-- renders and does nothing. Every task in the product reported
-- `requires_approval: false` to every client, forever, and no screen could
-- change it.
--
-- The design blueprint puts the flag where it belongs — on the project
-- (`BlueprintData.jsx`: `project · org_id · name · requires_approval ·
-- archived`) — and `public.teams` has no such column. §1 adds it.
--
-- ── THE 41 ROWS, AND WHY THEY ARE NOT BACKFILLED ────────────────────────────
--
-- The column is not empty. Read-only SELECT against public.tasks, 2026-08-06:
--
--     total 633 · requires_approval TRUE 41
--     team_1682e055fd21  "E2E Test & Associates [TEST ORG]"   25 TRUE of 332
--     team_ea27e54c6dcb  "Keval To Do"                        16 TRUE of  39
--
--     (true,  approval_status IS NOT NULL)  41
--     (true,  approval_status IS NULL)       0     ← none, not few
--     (false, approval_status IS NOT NULL)   6
--     (false, approval_status IS NULL)     586
--
-- EVERY TRUE also carries an approval_status, and no TRUE exists without one.
-- So the flag is a derived echo of "this task went through the approval flow",
-- not a policy anybody set. It is also per-task and not project-uniform
-- (25 of 332, 16 of 39), so it is not a project setting mis-stored on the task
-- either.
--
-- Therefore `teams.requires_approval` starts FALSE for EVERY project, including
-- those two. The measurement is the whole argument: propagating them would flip
-- a 332-task project and the owner's own to-do list to approval-required, and
-- from that moment every non-approver marking work done in them would be
-- refused — a live behaviour change on the owner's own board, inferred from
-- data that was never a policy statement. Turning approval on for a project is
-- a two-click setting on the Approvals page. Silently inferring it from 41
-- derived rows is not recoverable by the person it surprises.
--
-- §2 preserves the 41 anyway, so the decision is reversible by someone who
-- disagrees with it and has the rows to act on.
--
-- ── SCOPE NOTE ──────────────────────────────────────────────────────────────
--
-- This began as four files (116–119). Migration numbers 116 and 118 were taken
-- by a concurrent run while this one was being written, so the four sections
-- are consolidated into this single number rather than racing for more. They
-- are one change in practice: §4's CHECK is the storage-level statement of the
-- same status vocabulary `services/task_transitions.py` enforces at the API,
-- and shipping the gate without the vocabulary would leave the two able to
-- disagree.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── GUARD 0 · the tables this file assumes ──────────────────────────────────
-- Named up front for the same reason 098 and 110 do it: a missing-relation
-- error six sections down sends people hunting for a typo in a table name that
-- is spelled correctly.

DO $$
BEGIN
    IF to_regclass('public.teams') IS NULL THEN
        RAISE EXCEPTION 'public.teams does not exist — wrong database or wrong schema';
    END IF;
    IF to_regclass('public.tasks') IS NULL THEN
        RAISE EXCEPTION 'public.tasks does not exist — wrong database or wrong schema';
    END IF;
END $$;


-- ── §1 · THE COLUMN THE GATE READS ──────────────────────────────────────────
--
-- `NOT NULL DEFAULT false` and not nullable-with-a-default: three-valued logic
-- here would mean "we do not know whether this project needs approval", and
-- there is no honest answer to that question — a project either requires it or
-- it does not. `services/task_transitions.project_requires_approval` coerces
-- anything else to False, so a NULL would be indistinguishable from FALSE at
-- the read anyway, and a column whose third state is invisible is a trap.
--
-- LOCK: ACCESS EXCLUSIVE on public.teams for a catalog update. The default is a
-- constant, so PG 11+ does NOT rewrite the table — microseconds of work on a
-- table with tens of rows. The risk is acquisition, not duration: it queues
-- behind any open transaction on `teams` and blocks everything that arrives
-- after it while queued. `lock_timeout` above turns that into a clean rollback.

ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.teams.requires_approval IS
    'When true, entering status=done on a task in this project requires a '
    'project approver (approvals_router.is_project_owner, or an org admin). '
    'Enforced in services/task_transitions.assert_transition, which is the ONLY '
    'place this is read. Where the blueprint puts it: BlueprintData.jsx, '
    'project row. Default false for every project including the two that held '
    'task-level requires_approval=TRUE — see migration 117 §2 for why those '
    'were not propagated.';


-- ── §2 · PRESERVE THE 41, ACT ON NONE ───────────────────────────────────────
--
-- Not an archive for its own sake. If someone later decides those two projects
-- really should be approval-gated, this table is the evidence they would need
-- and it cannot be reconstructed once §3's deprecation is followed by an
-- eventual DROP. It is written once, here, and read by nothing.

CREATE TABLE IF NOT EXISTS public.task_requires_approval_legacy (
    task_id         text PRIMARY KEY,
    team_id         text,
    approval_status text,
    captured_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_requires_approval_legacy IS
    'Snapshot of tasks.requires_approval=TRUE at the time migration 117 ran. '
    'Written once by that migration, read by no application code. Exists so the '
    'decision not to backfill teams.requires_approval stays reversible.';

INSERT INTO public.task_requires_approval_legacy (task_id, team_id, approval_status)
SELECT task_id, team_id, approval_status
FROM   public.tasks
WHERE  requires_approval
ON CONFLICT (task_id) DO NOTHING;

-- The count belongs in the apply log, not in a report somebody has to be sent.
-- Expected 41 on the database measured 2026-08-06. A materially different
-- number means the world moved between writing and applying, and §2's premise
-- ("all 41 are a derived echo") should be re-measured before §1 is trusted.
DO $$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM public.task_requires_approval_legacy;
    RAISE NOTICE '117 §2: preserved % task-level requires_approval rows (41 expected)', n;
END $$;


-- ── §3 · DEPRECATE THE OLD COLUMN. DO NOT DROP IT. ──────────────────────────
--
-- `TaskOut` still serialises `requires_approval` (server.py, and the duplicate
-- model in utils.py), `row_to_task` still reads it in BOTH files, the board
-- query still selects it, and the mobile bundle may decode it. There is ONE
-- database and production writes to it, so dropping the column while any pod
-- is still running an image that reads it turns every task read into a 500.
--
-- The DROP is a later migration, after the new read path has shipped AND been
-- observed. Until then this comment is the only marker, and it is enough:
-- nothing writes the column, so it cannot drift further.

COMMENT ON COLUMN public.tasks.requires_approval IS
    'DEPRECATED — written by no code path, ever. Read teams.requires_approval '
    'instead (migration 117 §1). Still serialised by TaskOut in both server.py '
    'and utils.py, so it must NOT be dropped until both read paths and any '
    'shipped mobile bundle have stopped decoding it. Historic TRUE values are '
    'preserved in public.task_requires_approval_legacy.';


-- ── §4 · THE STATUS VOCABULARY, AT THE STORAGE LAYER ────────────────────────
--
-- Five values. `rejected` is deliberately ABSENT: no backend path writes it
-- (only approval_status='rejected' is ever written), zero live rows hold it,
-- and BulkBar.jsx offering it in its "Set status" menu was the bug, not the
-- requirement. That menu now builds from `SETTABLE_STATUSES`
-- (frontend/src/pages/approvals/transitions.js) and every one of the six code
-- paths that writes `tasks.status` calls
-- `services/task_transitions.assert_transition` first, so this CHECK is a
-- BACKSTOP and not the enforcement.
--
-- `requested` IS present because the client task-request flow really does
-- insert rows in it — which is also why this constraint cannot be the guard:
-- `requested` is a legal value at the storage layer and an illegal one for a
-- person to set, and only the API can tell those apart. Before that guard
-- existed, `PATCH /api/v1/tasks/bulk` wrote it on request, and declining an
-- unrelated approval then ran
-- `DELETE FROM tasks WHERE task_id=$1 AND status='requested'` over the result.
--
-- Live distribution 2026-08-06: done 319 · todo 193 · in_progress 67 ·
-- in_review 54. Nothing else, no NULLs. So this constraint would validate
-- today — NOT VALID is chosen anyway, on purpose:
--
--   · it skips the full-table scan and the long ACCESS EXCLUSIVE hold;
--   · it still refuses every NEW bad value, which is the entire point;
--   · and it does not make this migration's success depend on a row somebody
--     inserted between the measurement and the apply.
--
-- The `VALIDATE CONSTRAINT` is a LATER migration, run once this has been
-- watched. It takes only SHARE UPDATE EXCLUSIVE and does not block reads or
-- writes, so there is no hurry and no excuse to skip it either.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname = 'tasks_status_valid'
          AND  conrelid = 'public.tasks'::regclass
    ) THEN
        ALTER TABLE public.tasks
            ADD CONSTRAINT tasks_status_valid
            CHECK (status IN ('todo','in_progress','in_review','done','requested'))
            NOT VALID;
        RAISE NOTICE '117 §4: tasks_status_valid added NOT VALID';
    ELSE
        RAISE NOTICE '117 §4: tasks_status_valid already present, left alone';
    END IF;
END $$;

COMMIT;


-- ── §5 · WHAT APPLYING THIS CHANGES, AND WHAT IT DOES NOT ───────────────────
--
-- APPLYING THIS FILE CHANGES NO BEHAVIOUR BY ITSELF, and that is the design.
--
-- `services/task_transitions._teams_has_policy_column()` probes
-- information_schema ONCE per process and caches the answer. Before this file
-- it reports false and the approval gate is skipped entirely; after this file
-- it reports true and reads `teams.requires_approval`, which is FALSE for every
-- project until a project owner turns it on. So:
--
--     unapplied           → gate off everywhere
--     applied, no toggle  → gate off everywhere   ← the state right after apply
--     applied + toggled   → gate on, for that one project
--
-- ⚠ THE PROBE IS CACHED FOR THE LIFE OF THE PROCESS. A running pod that probed
-- before the apply keeps reporting "no policy column" until it restarts. That
-- is safe (it fails toward the current behaviour, never toward refusing work)
-- but it means REDEPLOY AFTER APPLYING or the toggle will appear to do nothing
-- on the pods that were already up. Same footgun 098 documents for
-- outbound_log's `_dormant`.
--
-- ── VERIFICATION ────────────────────────────────────────────────────────────
--
--   -- 1. the column exists and every project starts false
--   SELECT count(*) FILTER (WHERE requires_approval) AS on_now, count(*) AS total
--   FROM public.teams;
--   -- expect on_now = 0
--
--   -- 2. the 41 were preserved
--   SELECT count(*) FROM public.task_requires_approval_legacy;   -- expect 41
--
--   -- 3. the constraint refuses a new bad value (transaction is rolled back)
--   BEGIN;
--     UPDATE public.tasks SET status='rejected'
--     WHERE task_id = (SELECT task_id FROM public.tasks LIMIT 1);
--   ROLLBACK;   -- expect: new row for relation "tasks" violates check constraint
--
--   -- 4. and that it did NOT validate old rows (so no scan happened)
--   SELECT convalidated FROM pg_constraint
--   WHERE conname='tasks_status_valid';   -- expect f
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_valid;
--   ALTER TABLE public.teams DROP COLUMN IF EXISTS requires_approval;
--   DROP TABLE IF EXISTS public.task_requires_approval_legacy;
--
-- Dropping the column is safe in the other direction too: the probe fails
-- closed to "no policy column", so a rolled-back schema puts the gate back to
-- off rather than to broken. Restart the pods afterwards for the same
-- cached-probe reason as above.
