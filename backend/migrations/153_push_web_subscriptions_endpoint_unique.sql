-- 153 · public.push_web_subscriptions gets the UNIQUE(endpoint) its upsert names.
--
-- This IS PROPOSED_082, applied 2026-08-18 on the owner's instruction ("do
-- 082 also") — the analysis below is that file's, verbatim from its header:
-- web push registration 500s (wearing a CORS error's clothes) because
-- `save_subscription` upserts ON CONFLICT (endpoint) and the PUBLIC copy of
-- the table — which search_path fallback makes the real destination — has no
-- unique index on endpoint. staging's copy has it; public's does not.
--
-- Re-measured live before applying (2026-08-18): the staging.* twin 082's
-- header compares against NO LONGER EXISTS — migration 142 (shadow tables)
-- dropped the empty copies, which resolves 082's schema ambiguity in public's
-- favour and makes this index the only one that matters. public still holds
-- every row, no duplicate endpoints. Rows were backed up outside the repo
-- before the dedupe DELETE (a no-op on clean data, kept for safety). Same
-- defect class as migration 152 (push_tokens), fixed the same night.
--
BEGIN;

-- Keep the most recently updated row per endpoint. No-op on the current data.
DELETE FROM public.push_web_subscriptions a
USING public.push_web_subscriptions b
WHERE a.endpoint = b.endpoint
  AND a.id <> b.id
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS push_web_subscriptions_endpoint_key
    ON public.push_web_subscriptions (endpoint);

COMMIT;

-- Verify:
--   SELECT indexrelid::regclass, indisunique
--   FROM pg_index WHERE indrelid = 'public.push_web_subscriptions'::regclass;
-- then re-register for push in the browser and confirm the four CORS errors
-- are gone and a row appears.
