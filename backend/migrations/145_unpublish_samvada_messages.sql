-- 145_unpublish_samvada_messages.sql
--
-- REVERSES migration 058 line 83:
--     ALTER PUBLICATION supabase_realtime ADD TABLE staging.samvada_messages;
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- Measured on the live database, 2026-08-16:
--
--     in supabase_realtime : staging.samvada_messages, and NOTHING else
--     relrowsecurity       : false
--     policies             : 0
--     rows                 : 1,176, every one carrying org_id
--
-- Supabase Realtime authorises a `postgres_changes` subscription with the anon
-- key against ROW LEVEL SECURITY. A published table with RLS off and no policy
-- has nothing to authorise against, so publishing it offers every tenant's chat
-- messages to any browser holding the anon key. `migrations/007` enables RLS on
-- `public.*` only; no `staging.*` table has ever had it.
--
-- ── THE CODEBASE ALREADY KNEW ───────────────────────────────────────────────
--
-- `frontend/src/pages/sanvaad/useChannelMessages.js` refuses to subscribe and
-- names this exact reason in its header — "publishing a table whose rows the
-- anon role cannot be scoped to would be a cross-tenant leak, not a feature" —
-- and polls instead. Nobody reverted the publication itself, so the hazard
-- outlived the decision not to use it by eleven migrations.
--
-- ── WHY IT WAS LATENT AND NOT LIVE ──────────────────────────────────────────
--
-- The deployed bundle carries no `VITE_SUPABASE_URL` and no
-- `VITE_SUPABASE_ANON_KEY` — no committed env file sets them — so
-- `lib/supabase.js` builds a null client and no subscription can be opened at
-- all. `docs/CLOUDFLARE-OWNER-ACTIONS.md` step B3 sets that key in the new
-- Pages project, which is the moment this stops being latent. Fixing the
-- publication is the version that does not depend on remembering.
--
-- ── SIDE EFFECTS ────────────────────────────────────────────────────────────
--
-- Removes one table from one publication. No data is read, written or deleted;
-- the table, its rows and its indexes are untouched. Takes a brief
-- ShareUpdateExclusiveLock, which does not block reads or writes. Nothing in
-- the product subscribes, so there is no functional change to reverse.
--
-- Reversible: ALTER PUBLICATION supabase_realtime ADD TABLE staging.samvada_messages;
-- If realtime is ever genuinely wanted here, the prerequisite is RLS with a
-- policy that scopes rows to the caller's org — not this line.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'staging'
           AND tablename = 'samvada_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE staging.samvada_messages;
        RAISE NOTICE 'dropped staging.samvada_messages from supabase_realtime';
    ELSE
        RAISE NOTICE 'staging.samvada_messages is already unpublished — nothing to do';
    END IF;
END $$;
