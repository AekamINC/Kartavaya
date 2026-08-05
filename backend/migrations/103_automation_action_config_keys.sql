-- ============================================================================
-- 103_automation_action_config_keys.sql
--
-- DO NOT APPLY YET. Written to accompany the automation-engine key fix; see
-- "WHEN TO RUN THIS" at the bottom. 101 and 102 are proposed by other agents
-- and unapplied; the highest APPLIED migration is 100.
--
-- WHAT IT IS FOR
-- --------------
-- frontend/src/pages/AutomationsPage.jsx wrote action configs under keys that
-- backend/services/automation_engine.py never read. Five of the six actions
-- were affected. The builder now writes the engine's key names
-- (frontend/src/pages/automations/actionConfig.js), so any rule saved BEFORE
-- that deploy carries a config the engine cannot use — and, because a missing
-- key returned a default instead of an error, those rules look active and
-- report a rising run count while doing nothing.
--
-- THE MEASUREMENT THAT DECIDED THE DIRECTION OF THE FIX
-- ----------------------------------------------------
-- Counted on toacecaewujfxjfrjwco (the database staging and production share)
-- before any code was changed:
--
--     SELECT count(*), count(*) FILTER (WHERE enabled), sum(run_count)
--       FROM public.automations;
--     -> total 0, enabled 0, total_runs 0
--
-- ZERO ROWS. That is why the BUILDER was changed to speak the engine's
-- vocabulary rather than the engine being renamed to match the builder: no
-- stored rule was going to be orphaned either way, and the engine's key set is
-- the only one that can express the actions at all — `user_ids` is a list,
-- `set_field` needs an id AND a value, `send_email` needs an address. None of
-- those fit in the single string the old form collected, whatever it was
-- called. Renaming the engine would have produced a builder that still could
-- not describe four of the six actions.
--
-- SO THIS FILE IS A NO-OP TODAY, ON PURPOSE. It exists because the window
-- between now and the frontend deploy is not zero: a rule created in it would
-- carry the old keys and would be unreadable by the new engine with nothing to
-- say why. Everything below is idempotent and safe to run on an empty table.
--
-- ⚠ NOTE THE SCHEMA. `automations` lives in **public**, not in `staging`.
--   Nearly everything else in this product is in `staging`, and this table is
--   reached only because the backend's search_path falls through to public.
--   `staging.automations` does not exist; a script that assumes it will error
--   rather than silently miss rows, which is the one mercy here.
--
-- LOCKS: two UPDATEs on a table with 0 rows and no ALTER of any kind. Nothing
-- is rewritten, nothing is scanned that matters, no other table is touched.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 0. Say what we are about to touch ───────────────────────────────────────
-- Printed before and after so that applying this to a database that is NOT the
-- one measured above is obvious in the output rather than a surprise later.
DO $$
DECLARE n_total int; n_legacy int;
BEGIN
    SELECT count(*) INTO n_total FROM public.automations;
    SELECT count(*) INTO n_legacy
      FROM public.automations a, jsonb_array_elements(a.actions) act
     WHERE (act->>'type' = 'post_comment'  AND act->'config' ? 'message')
        OR (act->>'type' = 'send_email'    AND act->'config' ? 'message')
        OR (act->>'type' = 'assign_to'     AND act->'config' ? 'value')
        OR (act->>'type' = 'set_field'     AND NOT (act->'config' ? 'field_id'))
        OR (act->>'type' = 'send_notification' AND NOT (act->'config' ? 'user_ids'));
    RAISE NOTICE '103: % automation rows, % actions carrying legacy config keys', n_total, n_legacy;
END $$;


-- ── 1. Rewrite the keys that CAN be rewritten ───────────────────────────────
-- Only three of the five mismatches are repairable from the stored value alone.
-- The rest are missing information, not misfiled information, and section 2
-- deals with them.
--
--   post_comment : config.message -> config.body   (same string, right key)
--   send_email   : config.message -> config.html   (the old form's one text box
--                  was the body; the address was never collected at all, so
--                  this repairs the body and section 2 still disables the rule)
--   assign_to    : config.value (an email — the old placeholder was
--                  'name@example.com') -> config.user_ids, resolved against
--                  users.email. A list, because the column is an array.
--
-- Written as a single rebuild of the `actions` array rather than as three
-- UPDATEs so a rule with two actions cannot be half-migrated.
UPDATE public.automations a
   SET actions = rebuilt.actions
  FROM (
    SELECT a2.automation_id,
           jsonb_agg(
             CASE
               WHEN act->>'type' = 'post_comment' AND act->'config' ? 'message'
                    AND NOT (act->'config' ? 'body')
                 THEN jsonb_set(act, '{config}',
                        (act->'config') - 'message' || jsonb_build_object('body', act->'config'->>'message'))

               WHEN act->>'type' = 'send_email' AND act->'config' ? 'message'
                    AND NOT (act->'config' ? 'html')
                 THEN jsonb_set(act, '{config}',
                        (act->'config') - 'message' || jsonb_build_object('html', act->'config'->>'message'))

               WHEN act->>'type' = 'assign_to' AND act->'config' ? 'value'
                    AND NOT (act->'config' ? 'user_ids')
                    AND EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = lower(act->'config'->>'value'))
                 THEN jsonb_set(act, '{config}',
                        (act->'config') - 'value' || jsonb_build_object(
                          'user_ids',
                          -- public.users, qualified: `users` also exists in the
                          -- `auth` schema (Supabase's own), and which one an
                          -- unqualified name resolves to depends on the psql
                          -- session's search_path, not on this file.
                          (SELECT jsonb_agg(u.user_id) FROM public.users u
                            WHERE lower(u.email) = lower(act->'config'->>'value'))))

               ELSE act
             END
             ORDER BY ord
           ) AS actions
      FROM public.automations a2,
           LATERAL jsonb_array_elements(a2.actions) WITH ORDINALITY AS t(act, ord)
     GROUP BY a2.automation_id
  ) AS rebuilt
 WHERE a.automation_id = rebuilt.automation_id
   AND a.actions IS DISTINCT FROM rebuilt.actions;


-- ── 2. Pause what cannot be repaired, instead of leaving it looking alive ────
-- send_notification without `user_ids`, set_field without `field_id`, and
-- send_email without `to` are missing a value nobody ever typed. There is
-- nothing to migrate them FROM, and inventing a recipient or a field is worse
-- than admitting there isn't one.
--
-- They are paused rather than deleted: the rule's name, trigger and conditions
-- are real work the author did, and the page now renders "This rule does
-- nothing" against the stored config, so a paused rule with that banner is a
-- readable instruction to fix it. An ENABLED rule in that state would keep
-- incrementing run_count forever, which is the exact appearance of health this
-- whole change exists to remove.
UPDATE public.automations a
   SET enabled = FALSE
 WHERE a.enabled
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(a.actions) act
      WHERE (act->>'type' = 'send_email'        AND coalesce(act->'config'->>'to', '') = '')
         OR (act->>'type' = 'send_notification' AND coalesce(jsonb_array_length(
               CASE WHEN jsonb_typeof(act->'config'->'user_ids') = 'array'
                    THEN act->'config'->'user_ids' ELSE '[]'::jsonb END), 0) = 0)
         OR (act->>'type' = 'assign_to'         AND coalesce(jsonb_array_length(
               CASE WHEN jsonb_typeof(act->'config'->'user_ids') = 'array'
                    THEN act->'config'->'user_ids' ELSE '[]'::jsonb END), 0) = 0)
         OR (act->>'type' = 'set_field'         AND coalesce(act->'config'->>'field_id', '') = '')
         OR (act->>'type' = 'change_status'     AND coalesce(act->'config'->>'status', '') = '')
   );


-- ── 3. Report ───────────────────────────────────────────────────────────────
DO $$
DECLARE n_paused int; n_ok int;
BEGIN
    SELECT count(*) INTO n_paused FROM public.automations WHERE NOT enabled;
    SELECT count(*) INTO n_ok     FROM public.automations WHERE enabled;
    RAISE NOTICE '103: % rules enabled, % paused for unrepairable config', n_ok, n_paused;
END $$;

COMMIT;

-- ============================================================================
-- WHEN TO RUN THIS
--
--   1. Deploy the backend (services/automation_engine.py). It is safe ahead of
--      the frontend: it makes broken actions REPORT rather than silently
--      no-op, and it stops assign_to from wiping a task's assignees.
--   2. Deploy the frontend (AutomationsPage.jsx + pages/automations/*).
--   3. THEN run this file, which cleans up anything created in between.
--
-- Running it BEFORE step 2 is harmless but pointless — the old builder would
-- immediately write more legacy configs.
--
-- VERIFY (should return zero rows):
--   SELECT a.automation_id, a.name, act
--     FROM public.automations a, jsonb_array_elements(a.actions) act
--    WHERE a.enabled
--      AND (   (act->>'type'='post_comment'      AND coalesce(act->'config'->>'body','')='')
--           OR (act->>'type'='send_email'        AND coalesce(act->'config'->>'to','')='')
--           OR (act->>'type'='set_field'         AND coalesce(act->'config'->>'field_id','')='')
--           OR (act->>'type'='change_status'     AND coalesce(act->'config'->>'status','')='')
--           OR (act->>'type' IN ('assign_to','send_notification')
--               AND jsonb_typeof(act->'config'->'user_ids') IS DISTINCT FROM 'array'));
-- ============================================================================
