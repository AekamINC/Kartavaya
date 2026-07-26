-- PROPOSED_056_task_comment_client_visibility.sql
-- Kartavaya by Aekam Inc
--
-- STATUS: PROPOSED. NOT APPLIED. Do not run this without the owner's go-ahead.
--
-- WHY
-- ---
-- `19-client-portal.md`, "What a client must never see", opens with:
--
--     "Internal comments. Only comments explicitly marked client-visible."
--
-- There was no such mark. `task_comments` is (comment_id, task_id, user_id,
-- body, created_at, edited, updated_at) and nothing else, so
-- `GET /api/tasks/{task_id}/comments` had no way to tell an internal note from
-- one written for the client, and served a client every comment on any task
-- they could reach — the firm's internal discussion of that client's own file.
--
-- `backend/server.py` now fails closed WITHOUT this column: `list_comments`
-- probes for it once per process and, when it is absent, returns an EMPTY list
-- to a client caller rather than guessing. So the leak is already shut. This
-- migration is what turns the feature on — it lets the firm deliberately share
-- individual comments, instead of sharing none.
--
-- SHARED-DATABASE WARNING
-- -----------------------
-- Staging and production are the SAME Supabase project (toacecaewujfxjfrjwco).
-- Applying this affects production immediately. `server.py` is written to run
-- correctly on both the pre- and post-migration schema, so the column can be
-- added while the current build is live, in either order, with no redeploy.
--
-- SIDE EFFECTS
-- ------------
--  · DEFAULT FALSE + NOT NULL on an existing table. Postgres 11+ stores this
--    default in the catalog rather than rewriting every row, so it is fast and
--    takes only a brief ACCESS EXCLUSIVE lock. On a busy table run it with a
--    short `lock_timeout` and retry rather than letting it queue behind reads.
--  · Every EXISTING comment becomes NOT client-visible. That is the intended
--    outcome and the only safe backfill: these comments were written when the
--    author had no way to say "the client may read this", so no historical
--    comment may be inferred to be shareable. There is deliberately no
--    backfill UPDATE in this file.
--  · Once applied, `add_comment` starts persisting the flag, and a comment
--    authored by a user whose role is `client` is stored TRUE so the client can
--    read their own words back. Internal authors default to FALSE.
--  · No RLS policy change is needed: the existing `task_comments_select` policy
--    gates by task access, and client visibility is enforced in the API layer
--    on top of it. If comment reads are ever moved to direct PostgREST access,
--    this column MUST be added to that policy too.

BEGIN;

ALTER TABLE public.task_comments
    ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.task_comments.is_client_visible IS
    'True only when the author deliberately shared this comment with the '
    'client portal. Fail closed: default false, never backfilled true. '
    'Enforced in server.py:list_comments.';

-- Client reads always filter on this column, always scoped to one task.
CREATE INDEX IF NOT EXISTS idx_task_comments_task_client_visible
    ON public.task_comments (task_id)
    WHERE is_client_visible;

COMMIT;


-- ROLLBACK
-- --------
-- Safe to run at any time. `server.py`'s probe is cached per process, so after
-- a rollback the running workers must be restarted (or left to recycle) before
-- they stop selecting the dropped column — otherwise `list_comments` and
-- `add_comment` will error until they do. Roll back during a restart window.
--
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_task_comments_task_client_visible;
--   ALTER TABLE public.task_comments DROP COLUMN IF EXISTS is_client_visible;
--   COMMIT;
--
-- Dropping the column DESTROYS every sharing decision the firm has made. There
-- is no way to reconstruct which comments were shared. Export before dropping:
--
--   SELECT comment_id FROM public.task_comments WHERE is_client_visible;
