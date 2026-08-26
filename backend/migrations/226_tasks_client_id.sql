-- 226_tasks_client_id.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   ADD COLUMN public.tasks.client_id  × 1  (uuid, NULLABLE, no default)
--   INDEX      idx_tasks_org_client
--   COMMENT    on the new column
--
-- 483 tasks live (E2E 82, Unicode 141, the rest in the three out-of-scope
-- orgs). All 483 get NULL. Nothing is backfilled — see WHY NOT A BACKFILL.
-- Re-running is a no-op. Reversal is at the foot of this file.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Phase 0.22, owner's answer: "Add `tasks.client_id`. `public.tasks` has no such
-- column, which is exactly why client profitability reads 0%. It is a behaviour
-- change — every task then wants a client — so ship it as a feature, not a
-- silent migration."
--
-- Verified live 2026-08-27: `public.tasks` has 41 columns, `org_id` among them
-- and **no** `client_id` and no `project_id`. A firm can therefore record every
-- hour it works and never say WHICH CUSTOMER it worked for, so "what did this
-- client cost us" has no join to make and answers 0%.
--
-- ── WHAT `task_clients` IS, AND WHY IT IS NOT THIS ───────────────────────────
--
-- There is already a `public.task_clients` table, and it is NOT a customer
-- link. Its columns are (id, task_id, **user_id**, invited_by, org_id) and
-- `approvals_router.py:554` inserts a row when somebody is invited to approve —
-- it is a GRANT OF READ ACCESS to a person. The product rule is explicit that a
-- CRM client is the COMPANY: "Contacts are people who come and go; the customer
-- stays." Reusing that table would tie a firm's profitability to whoever
-- happened to be invited to a task, which is a different fact that changes for
-- different reasons.
--
-- So `client_id` points at `staging.graha_clients` — the company, the same row
-- `vikray_orders.client_id` and `client_billing_profiles.client_id` point at.
--
-- ── NO FOREIGN KEY, AND THAT IS THIS TABLE'S OWN PATTERN ─────────────────────
--
-- `public.tasks` carries NO foreign keys at all — read from `pg_constraint`,
-- not assumed: three CHECKs and nothing else. `org_id` is a bare uuid held to
-- its meaning by a CHECK and by the write path. A cross-schema FK from `public`
-- into `staging` would be the only one in the table and would couple two
-- schemas that this repo has otherwise kept apart (see the shadow-table
-- incident: `staging` and `public` have held twins of the same table before).
--
-- The integrity that matters here is TENANCY, and an FK does not provide it:
-- `graha_clients.id` alone can name another organisation's customer, which is
-- the documented "graha_clients join leak" — 9 joins in this repo scoped by id
-- alone. So the rule is enforced where it can be enforced properly, in the
-- write path: a task may only carry a client that belongs to the task's own
-- org, checked on the same statement that sets it.
--
-- ── WHY NOT A BACKFILL ───────────────────────────────────────────────────────
--
-- There is nothing to derive it from. A task names a team and a column, not a
-- customer; guessing from a title or a team name would put a customer's name on
-- somebody else's work and then bill against it. 483 NULLs is the honest state:
-- unknown, not unassigned. The column fills as people use the picker.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE from this file. Every existing SELECT is `SELECT *` or an explicit list;
-- an added nullable column changes no result. After the backend deploys, task
-- create and update accept an optional `client_id`, refuse one belonging to
-- another org, and the column is returned on the row.
--
-- ── DEPLOY ORDER — THIS FILE FIRST ───────────────────────────────────────────
--
-- The INSERT and UPDATE name the column. A backend deployed ahead of it raises
-- UndefinedColumnError on every task create — which is exactly how `gst_rate`
-- broke client billing. Migration, then deploy.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- ACCESS EXCLUSIVE on public.tasks for a catalog update. A NULLABLE column with
-- NO DEFAULT does not rewrite the table (PG 11+), so this is milliseconds at
-- 483 rows. CREATE INDEX (not CONCURRENTLY) takes a SHARE lock that blocks
-- WRITES to tasks while it builds — at 483 rows that is instants, and
-- CONCURRENTLY cannot run inside the migration runner's transaction.

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS client_id uuid;

-- (org_id, client_id) and not (client_id) alone: every read of this column is
-- already scoped by org — it has to be, per the join-leak rule — so the org
-- belongs in the leading position where it can serve both predicates.
CREATE INDEX IF NOT EXISTS idx_tasks_org_client
    ON public.tasks (org_id, client_id)
    WHERE client_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.client_id IS
    'The CUSTOMER COMPANY this task is worked for — staging.graha_clients.id, '
    'the same row vikray_orders.client_id and client_billing_profiles.client_id '
    'name. Optional: NULL means nobody has said, which is not the same as '
    '"internal", and no backfill invented one. Deliberately NOT a foreign key '
    '— public.tasks carries none, and the constraint that matters is tenancy, '
    'which is enforced on the write path: a client_id must belong to the '
    'task''s own org. Never join graha_clients on id alone.';

-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DROP INDEX IF EXISTS public.idx_tasks_org_client;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS client_id;
--
-- Restores exactly WHILE the column is still all NULL. Once people have set it,
-- the column holds facts nothing else records — which customer a piece of work
-- was for — and dropping it discards them with no backup. Back up to a restore
-- schema first at that point, with the drop condition written in the same
-- commit (the retention rule from 2026-08-26).
