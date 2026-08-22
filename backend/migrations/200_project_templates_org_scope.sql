-- 200 · `public.project_templates` learns which organisation it belongs to.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY — inbox item 8, verified
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `public.project_templates` has NO tenant column at all. Read off the live
-- catalogue on 2026-08-22, its whole shape is:
--
--   template_id, name, description, config, created_by, created_at
--
-- So `routers/templates.py` scoped it by the only column it had — the AUTHOR —
-- and the result was wrong in both directions at once:
--
--   · UPWARD. Platform staff got `SELECT * FROM project_templates` unfiltered:
--     every customer's board layout, custom fields and sample tasks, from one
--     endpoint, with nothing recording that it happened.
--   · SIDEWAYS. Everybody else saw only rows they had authored themselves, so a
--     template built by one colleague was invisible to the rest of their firm.
--     That is the other half of the owner's report — "needs more templates" —
--     and it is not a shortage: the whole database holds ONE project template
--     and FOUR task templates, and each of them is visible to one person.
--   · AND `POST /projects/{template_id}/apply` never checked the template at
--     all. It looked up the config by id and wrote columns, field definitions
--     and tasks from it into a project the caller does belong to. Any signed-in
--     user could name any template id in the product and read its contents
--     through the board it produced.
--
-- `task_templates` already carries `team_id` and is not in this fix. Its
-- org-less rows are a smaller version of the same problem and are handled in
-- the router by the team's org.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One nullable `org_id`, backfilled from the AUTHOR's organisation, and an
-- index. Nullable and not NOT NULL, deliberately:
--
--   · a template whose author has since left every organisation cannot be
--     attributed, and refusing the migration over it would be worse than
--     carrying it;
--   · NULL keeps the current behaviour for exactly those rows — the router
--     falls back to author-scoping for them — so nothing that works today
--     stops working, and nobody's template disappears.
--
-- The backfill takes the author's EARLIEST org grant, which is the same
-- resolution `middleware/org_resolver` falls back to when no `X-Org-Id` header
-- is sent. Using a later or arbitrary grant would file a template under an org
-- its author joined afterwards.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Staging and production share one Supabase database, so this IS a production
-- change. It is one ADD COLUMN (metadata-only on PostgreSQL 11+, no rewrite),
-- one index, and an UPDATE over a table holding ONE row.
--
-- WRITE-PATH SIDE EFFECTS: the UPDATE writes `org_id` on rows where it is NULL
-- and nowhere else. No existing column is read by any running query — nothing
-- on `staging` or `main` names `org_id` on this table until the router lands —
-- so no in-flight request can observe the change. `created_by` is not touched.
--
-- Backed up first: `dead_tables_20260822.project_templates_before_200` holds
-- the table as it stood, and the rollback restores from it.

BEGIN;

CREATE SCHEMA IF NOT EXISTS dead_tables_20260822;

CREATE TABLE IF NOT EXISTS dead_tables_20260822.project_templates_before_200 AS
  SELECT * FROM public.project_templates;

ALTER TABLE public.project_templates
    ADD COLUMN IF NOT EXISTS org_id uuid;

COMMENT ON COLUMN public.project_templates.org_id IS
    'The organisation this template belongs to. NULL = pre-200, unattributable '
    '(author holds no org grant); the router falls back to author-scoping for '
    'those rows so none of them disappears.';

--  The author's EARLIEST org grant — the same resolution `org_resolver` falls
--  back to with no X-Org-Id header. Only fills NULLs, so a re-run is a no-op
--  and a value set by the application is never overwritten by a backfill.
UPDATE public.project_templates t
   SET org_id = (
        SELECT r.org_id
          FROM staging.user_roles r
         WHERE r.user_id = t.created_by
           AND r.org_id IS NOT NULL
         ORDER BY r.granted_at
         LIMIT 1)
 WHERE t.org_id IS NULL
   AND t.created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_templates_org
    ON public.project_templates (org_id);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT count(*)                              AS total,
--          count(org_id)                         AS attributed,
--          count(*) FILTER (WHERE org_id IS NULL) AS unattributable
--     FROM public.project_templates;
--
--   -- every attributed row names an org that exists
--   SELECT count(*) FROM public.project_templates t
--     LEFT JOIN staging.organisations o ON o.id = t.org_id
--    WHERE t.org_id IS NOT NULL AND o.id IS NULL;      -- expect 0
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dropping the column returns every template to author-scoping, which is the
-- leak this migration exists to close — so only do this alongside reverting
-- `routers/templates.py`.
--
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_project_templates_org;
--   ALTER TABLE public.project_templates DROP COLUMN IF EXISTS org_id;
--   COMMIT;
--
-- The pre-migration table is in `dead_tables_20260822.project_templates_before_200`
-- if a row itself needs restoring.
