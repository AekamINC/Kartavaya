-- 082 · public.push_web_subscriptions needs the UNIQUE(endpoint) that staging has
--
-- PROPOSED. Not applied by the agent that wrote it: this is DDL on the database
-- that serves both staging and production, and that is the owner's call.
--
-- ── The defect, measured live on 2026-07-28 ────────────────────────────────
--
-- Registering for push notifications fails. The browser console shows four
-- CORS errors against `POST /api/push/subscribe`:
--
--     Access to XMLHttpRequest ... has been blocked by CORS policy:
--     No 'Access-Control-Allow-Origin' header is present
--
-- **It is not CORS.** `NEXT-SESSION.md` records this exact trap: an exception
-- inside the handler escapes before `CORSMiddleware` attaches its headers, so a
-- 500 reaches the browser wearing a CORS error's clothes. Proved by contrast on
-- the same route, same origin, same headers — only the payload differed:
--
--     POST {}                                    -> 422, headers present, body readable
--     POST {endpoint, keys:{p256dh, auth}}       -> request dies, no headers
--
-- An INVALID body returns cleanly, so CORS is configured correctly. Only a
-- VALID body — the one that reaches the database — fails. (The four repeats are
-- `lib/api.js` retrying a 5xx three more times, which is itself confirmation
-- that the client saw a server error rather than a rejected preflight.)
--
-- ── Why it fails ──────────────────────────────────────────────────────────
--
-- `services/web_push_service.save_subscription` upserts with:
--
--     INSERT INTO push_web_subscriptions (...) VALUES (...)
--     ON CONFLICT (endpoint) DO UPDATE SET ...
--
-- `ON CONFLICT (endpoint)` requires a unique index on that column. The two
-- schemas disagree:
--
--     staging.push_web_subscriptions   push_web_subscriptions_endpoint_key  UNIQUE(endpoint)  ✓
--     public.push_web_subscriptions    PK(id) and a NON-unique index on user_id  — nothing on endpoint  ✗
--
-- so in `public` Postgres raises
-- `there is no unique or exclusion constraint matching the ON CONFLICT
-- specification`, which is the 500.
--
-- ── Why `public` is reached at all ────────────────────────────────────────
--
-- The table name is unqualified, so it resolves through `search_path`. `db.py`
-- sets `SET search_path TO staging, public` per connection inside a try/except
-- that only WARNS on failure — the same warn-only fragility as the jsonb codec
-- three lines above it, and for the same reason (PgBouncer drops connections
-- mid-handshake). When that SET does not take, every unqualified name resolves
-- to `public`.
--
-- This is not theoretical. At the time of writing:
--
--     public.push_web_subscriptions    4 rows, 4 distinct endpoints
--     staging.push_web_subscriptions   0 rows
--
-- **Every subscription ever stored landed in `public`.** The rows are the
-- evidence that the fallback is the normal path here, not an edge case.
--
-- ── Safety ────────────────────────────────────────────────────────────────
--
-- 4 rows, 4 distinct endpoints — no duplicates, so the index builds without a
-- dedupe step. The DELETE below is a no-op today and exists only so this is
-- safe to run later, if rows accumulate before it is applied.
--
-- `CONCURRENTLY` is deliberately NOT used: it cannot run inside a transaction
-- block, and on a four-row table the exclusive lock is measured in microseconds.

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
