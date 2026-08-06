-- 108_srijan_to_sahayak.sql
--
-- THE THIRD AND LAST PASS OF THE RENAME: the module code stored in the
-- database becomes `sahayak`, so the alias in the code can be deleted.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change.
--
-- ── THIS IS A FIX, NOT A TIDY-UP ────────────────────────────────────────────
--
-- Pass 1 (`middleware/role_tiers.py`) and pass 2 (the routers) shipped in
-- e5b566d9 and are LIVE. `require_module` folds its argument through
-- `MODULE_ALIASES` once at import time, so every Sahayak route now asks the
-- database for `sahayak`. The database answers `srijan`. Two gates therefore
-- refuse the module outright:
--
--   · `subscription.py:454` — `sahayak` is in BUNDLED_MODULES, so entitlement
--     is `plans.features.get('sahayak')` on a features JSON whose key is
--     `srijan`. Missing key → 403 "requires a paid plan".
--   · `subscription.py:404` — the per-user grant is
--     `org_member_modules WHERE module_code='sahayak'`, and the three grant
--     rows say `srijan`. No row → 403 "you don't have access".
--
-- The alias was written to make the rename survivable in three deploys. It
-- folds INBOUND only — code → the new name — so it covers a half-renamed
-- BACKEND, not a database still holding the old value. That asymmetry is why
-- this file is the fix and not the last step: nothing is renamed here for
-- neatness, all four statements below unbreak a screen.
--
-- ── WHAT IS DELIBERATELY LEFT SAYING `srijan` ───────────────────────────────
--
-- A scan of every text/jsonb column in the schema found the value in nine
-- places. Four are renamed below. Five are not, and each for its own reason:
--
--   `hub_content_items.image_url` (40) and `.image_key` (40) — R2 OBJECT KEYS.
--       The bytes live at `srijan/images/<uuid>.png` in the bucket. Renaming
--       the column renames the pointer and not the object, which is how you
--       get 40 broken images and no error anywhere. `ai_router.py` still
--       WRITES that folder for the same reason: one prefix that resolves beats
--       two that half-resolve. The path is invisible to users.
--
--   `hub_content_items.metadata` (34) — the same R2 URLs again, inside the
--       generation record. Same reason.
--
--   `subscription_events.metadata` (6) — an append-only event log. Those rows
--       record what was bought on the day it was bought, under the name it had
--       then. Rewriting an audit trail to make it consistent with the present
--       is the one edit that makes it worthless.
--
-- ── ORDER MATTERS ───────────────────────────────────────────────────────────
--
-- Apply this BEFORE deleting `MODULE_ALIASES`. With the alias in place both
-- spellings work in the code; with the database migrated and the alias still
-- present, everything works and nothing depends on it. Only then is it dead.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Guard: refuse to run twice into a half-state. If any org already holds a
-- `sahayak` row beside its `srijan` one, the UPDATEs below would collide with
-- the uniqueness these tables carry, and a partial rename is worse than none.
DO $$
DECLARE clash int;
BEGIN
    SELECT count(*) INTO clash FROM (
        SELECT org_id FROM staging.module_subscriptions
         WHERE module_code IN ('srijan','sahayak')
         GROUP BY org_id HAVING count(DISTINCT module_code) > 1
        UNION ALL
        SELECT org_id FROM staging.org_member_modules
         WHERE module_code IN ('srijan','sahayak')
         GROUP BY org_id, user_id HAVING count(DISTINCT module_code) > 1
    ) x;
    IF clash > 0 THEN
        RAISE EXCEPTION
          'ABORT: % subject(s) hold BOTH srijan and sahayak rows. Renaming '
          'would collide. Reconcile the duplicates by hand first.', clash;
    END IF;
END $$;

-- ── 1. The org's activation of the module ───────────────────────────────────
UPDATE staging.module_subscriptions
   SET module_code = 'sahayak'
 WHERE module_code = 'srijan';

-- ── 2. The per-user grant ───────────────────────────────────────────────────
UPDATE staging.org_member_modules
   SET module_code = 'sahayak'
 WHERE module_code = 'srijan';

-- ── 3. The plan's bundled-module flag, and its credit allowance ─────────────
-- Two keys, renamed in one pass so a plan can never carry one under each name.
-- `- 'srijan'` after the `||` so the old key is dropped only once the new one
-- holds its value; `jsonb_build_object` with `features->'srijan'` preserves
-- whatever the value is (boolean on 4 plans, a number on 3) rather than
-- assuming `true`.
UPDATE staging.plans
   SET features = (features - 'srijan') || jsonb_build_object('sahayak', features->'srijan')
 WHERE features ? 'srijan' AND NOT features ? 'sahayak';

UPDATE staging.plans
   SET features = (features - 'srijan_credits_monthly')
                  || jsonb_build_object('sahayak_credits_monthly', features->'srijan_credits_monthly')
 WHERE features ? 'srijan_credits_monthly' AND NOT features ? 'sahayak_credits_monthly';

-- ── 4. The purchasable add-on ───────────────────────────────────────────────
-- `is_active = FALSE`, so nothing can buy it today, but `org_modules.py:186`
-- reads the code and `subscription.py:581` validates against it. A dormant row
-- under the old name is a 403 waiting for the day somebody flips the flag.
UPDATE staging.add_on_modules
   SET code = 'sahayak',
       name = 'Sahayak · सहायक AI Marketing'
 WHERE code = 'srijan';

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Nothing addressable by the code says `srijan` any more. All four zero.
SELECT
  (SELECT count(*) FROM staging.module_subscriptions WHERE module_code='srijan') AS mod_subs,
  (SELECT count(*) FROM staging.org_member_modules  WHERE module_code='srijan') AS grants,
  (SELECT count(*) FROM staging.plans WHERE features ? 'srijan'
                                         OR features ? 'srijan_credits_monthly') AS plans,
  (SELECT count(*) FROM staging.add_on_modules WHERE code='srijan')             AS add_ons;

-- 2. And the new name is there in the same numbers — 3, 3, 4/3, 1. A rename
--    that dropped rows would pass check 1 too.
SELECT
  (SELECT count(*) FROM staging.module_subscriptions WHERE module_code='sahayak') AS mod_subs,
  (SELECT count(*) FROM staging.org_member_modules  WHERE module_code='sahayak') AS grants,
  (SELECT count(*) FROM staging.plans WHERE features ? 'sahayak')                 AS plans_flag,
  (SELECT count(*) FROM staging.plans WHERE features ? 'sahayak_credits_monthly') AS plans_credits,
  (SELECT count(*) FROM staging.add_on_modules WHERE code='sahayak')              AS add_ons;

-- 3. The allowance survived as a NUMBER and not as the string "true". The
--    whole point of building the object from `features->'srijan'` was this.
SELECT name, features->'sahayak' AS bundled, features->'sahayak_credits_monthly' AS credits
  FROM staging.plans WHERE features ? 'sahayak' ORDER BY name;
