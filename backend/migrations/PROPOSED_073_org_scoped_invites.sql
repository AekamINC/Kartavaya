-- PROPOSED — org-scoped invites. Review before running.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- An organisation cannot bring in a new person. At all.
--
--   · The only invite endpoint is `POST /api/admin/invites`, behind
--     `_require_admin` — Aekam's platform console.
--   · `org_members.add_member` refuses anyone without an existing account
--     (404 "no user with that email").
--   · There is no public registration.
--
-- So every new user at every customer requires Aekam to act personally. That is
-- workable while onboarding is done by hand and stops being workable the moment
-- it isn't.
--
-- `public.invites` predates `backend/migrations/` and has no `org_id`, which is
-- why this was never built: an invite could not say which organisation it was
-- for. That is the whole blocker, and it is two columns.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `org_id`         — which organisation this invite joins. NULL keeps the
--                    existing platform-console behaviour exactly as it is, so
--                    every row written before today stays valid and every
--                    existing code path keeps working unchanged.
--
-- `module_grants`  — the access the invitee gets on acceptance, as
--                    `[{"code": "...", "role": "..."}]`. The owner's
--                    requirement is that an org grants access "as required or
--                    wished" at invite time, not in a second step someone
--                    forgets. Stored on the invite because the user row does
--                    not exist yet, so the grant has nowhere else to live until
--                    acceptance.
--
-- Deliberately NOT a foreign key to `staging.organisations`. `public.invites`
-- and `staging.organisations` are in different schemas, and a cross-schema FK
-- here would make the invites table undroppable independently and couple a
-- pre-org legacy table to the tenant model mid-cutover. The application
-- validates the org, and `PROPOSED_076`–`081` are the cutover that would make
-- an FK meaningful.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Purely additive. Two nullable columns (one with a default) and one partial
-- index. No existing row is read or modified. No existing query selects either
-- column, so nothing that runs today changes behaviour.
--
-- `public.invites` is small — this is a metadata-only ALTER, no table rewrite,
-- and the lock is held for microseconds. `ADD COLUMN ... DEFAULT` does not
-- rewrite the table on PostgreSQL 11+.
--
-- Production safety: `main` has no code that references either column, so
-- production is unaffected whether or not this runs. Staging and production
-- share one Supabase project, which is exactly why this is additive only.

BEGIN;

ALTER TABLE public.invites
    ADD COLUMN IF NOT EXISTS org_id UUID;

COMMENT ON COLUMN public.invites.org_id IS
    'Organisation this invite joins. NULL = platform-console invite with no org '
    'membership, which is the behaviour of every row written before 073.';

ALTER TABLE public.invites
    ADD COLUMN IF NOT EXISTS module_grants JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.invites.module_grants IS
    'Module access applied on acceptance: [{"code":"ganit","role":"editor"}]. '
    'Validated against the org active subscriptions at invite time AND re-checked '
    'at acceptance, because a module can be deactivated in between.';

-- Only pending invites are ever looked up by org, and they are a small subset.
CREATE INDEX IF NOT EXISTS idx_invites_org_pending
    ON public.invites (org_id)
    WHERE org_id IS NOT NULL AND accepted_at IS NULL;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='invites'
--     AND column_name IN ('org_id','module_grants');
--
-- Expect two rows. Every pre-existing invite should have org_id NULL and
-- module_grants '[]':
--
--   SELECT count(*) FILTER (WHERE org_id IS NULL)      AS legacy_rows,
--          count(*) FILTER (WHERE module_grants = '[]') AS empty_grants,
--          count(*)                                     AS total
--   FROM public.invites;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Safe only while no org-scoped invite is pending — dropping org_id turns a
-- pending org invite into a platform invite that grants no membership, and the
-- invitee would create an account belonging to nothing.
--
--   SELECT count(*) FROM public.invites
--    WHERE org_id IS NOT NULL AND accepted_at IS NULL;   -- must be 0
--
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_invites_org_pending;
--   ALTER TABLE public.invites DROP COLUMN IF EXISTS module_grants;
--   ALTER TABLE public.invites DROP COLUMN IF EXISTS org_id;
--   COMMIT;
--
-- Accepted rows lose their historical record of which org they joined; the
-- membership itself lives in `staging.user_roles` and is unaffected.
