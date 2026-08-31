-- 243 — the only two tables in `public` with RLS OFF get it turned on.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  1. WHAT THIS DOES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on exactly two tables:
--
--     public.report_schedules
--     public.task_requires_approval_legacy
--
-- No policies are added, which is the point. Every one of the other 269 tables
-- in `public` carries RLS with no policies — that deny-all is the ONLY working
-- tenancy control in this database, and it is why a holder of the anon key
-- reads nothing.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  2. HOW THIS WAS FOUND, AND WHY IT MATTERS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CLAUDE.md requires the Supabase security advisor after any DDL and says to
-- treat a new `rls_disabled_in_public` as a breach rather than a lint. Running
-- it after migration 242 returned TWO — neither of them new, and neither of
-- them mine:
--
--     rls_disabled_in_public | task_requires_approval_legacy | ERROR
--     rls_disabled_in_public | report_schedules              | ERROR
--
-- Confirmed directly rather than taken from the advisor. Read live 2026-08-31:
--
--     relname                        rls_on  anon_select  authed_select
--     report_schedules               false   true         true
--     task_requires_approval_legacy  false   true         true
--
-- `public` is exposed to PostgREST and the anon key is compiled into the
-- shipped browser bundle, so `SELECT` granted to `anon` with RLS off is a
-- direct read by anyone who opens the app and copies a key out of it. No API
-- route is involved and none of the backend's guards are in the path.
--
-- `report_schedules` is the one that would have hurt: its columns are
-- `team_id, created_by, frequency, file_formats, recipients, …` and
-- `recipients` is a list of email addresses. A cross-tenant read of who
-- receives which team's reports.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  3. BLAST RADIUS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ THE LEAK IS LATENT, NOT ACTIVE. Both tables hold ZERO rows, measured live
-- 2026-08-31 (`report_schedules` 0, `task_requires_approval_legacy` 0, 0
-- distinct teams in either). Nothing has been read because there is nothing to
-- read.
--
-- That is a reason to close it calmly and not a reason to leave it. The hole
-- opens the moment a row lands, it opens silently, and `report_schedules` has
-- a dispatcher in the repo's history that used to write to it.
--
-- Turning RLS on can only REMOVE access. No backend path reads either table —
-- `git grep` finds them in comments only (`reports.py`, `scheduler.py`,
-- `email_service.py`, `invite_router.py`, `dristi.py`, `client_billing.py`),
-- every one of them describing the table as retired. Both are also empty, so
-- even a reader that did exist would find what it finds now.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  4. REVERSAL
-- ═══════════════════════════════════════════════════════════════════════════
--
--     ALTER TABLE public.report_schedules              DISABLE ROW LEVEL SECURITY;
--     ALTER TABLE public.task_requires_approval_legacy DISABLE ROW LEVEL SECURITY;
--
-- No data is touched, so there is nothing else to restore.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  5. VERIFICATION, AND WHAT IS DELIBERATELY NOT DONE HERE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The assertion below raises unless BOTH tables come out with `relrowsecurity`
-- true. Re-run the advisor after this: `rls_disabled_in_public` must be empty.
--
-- ⚠ NOT DROPPED. `routers/reports.py` says in its own header that this table
-- "is being dropped" — migration 236 retired the router and the table outlived
-- it. Dropping it is the right end state and it is NOT done here: a DROP needs
-- the owner's approval BY NAME, and enabling RLS closes the hole today without
-- spending that approval. Raised as an owner action.

BEGIN;

ALTER TABLE public.report_schedules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_requires_approval_legacy ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE bad text;
BEGIN
    SELECT string_agg(c.relname, ', ') INTO bad
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relrowsecurity IS FALSE;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION
          'RLS is still off in public on: % — the anon key reads these', bad;
    END IF;
END $$;

COMMIT;
