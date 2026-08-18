-- 152 · public.push_tokens needs the UNIQUE(device_id) its upsert names.
--
-- Sentry PYTHON-FASTAPI-2 (2026-08-18, /api/me/push_tokens):
--
--     InvalidColumnReferenceError: there is no unique or exclusion
--     constraint matching the ON CONFLICT specification
--
-- `server.py`'s register_push_token upserts ON CONFLICT (device_id); the
-- live table carries only its primary key. The same defect class
-- PROPOSED_082 documents for push_web_subscriptions, on the mobile table.
--
-- MEASURED LIVE BEFORE THIS RAN: public.push_tokens exists in ONE schema,
-- holds ZERO rows, zero duplicate device_ids. The consequence of the gap is
-- therefore total, not partial: no mobile push token has EVER registered
-- through this route — every registration 500'd — which is why the table is
-- empty. Tonight's emulator login merely made the error visible in Sentry.
--
-- Zero rows also makes this migration trivial: no dedupe pass, no backup
-- beyond the statement above (there is nothing to back up), an instant DDL.
--
-- SHARED-DATABASE NOTE: production's code (main, 1aa49855) mounts no mobile
-- push route, so nothing in production writes or upserts this table; the
-- constraint changes no existing behaviour anywhere.

BEGIN;

ALTER TABLE public.push_tokens
    ADD CONSTRAINT push_tokens_device_id_key UNIQUE (device_id);

COMMIT;

-- DOWN (manual):
--   ALTER TABLE public.push_tokens DROP CONSTRAINT push_tokens_device_id_key;
