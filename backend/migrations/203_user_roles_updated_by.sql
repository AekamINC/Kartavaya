-- 203 · WHO CHANGED A MEMBER'S ROLE — `updated_by` on `staging.user_roles`.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply it by hand.
--
-- Runs after 201/202 and depends on neither, except that it reuses the
-- `staging.touch_updated_at()` function 138 created.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY — AND THIS FILE REVERSES A DECISION 201 MADE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 201 excluded `staging.user_roles` by name, filed under "JOIN, COUNTER AND
-- PREFERENCE TABLES, where a row is a fact about a pair and not a record
-- anybody authored". That reasoning was wrong, and it is worth writing down HOW
-- it was wrong rather than quietly adding the column, because the same mistake
-- is available on every other table that looks like a join.
--
-- `user_roles` is not `(user_id, org_id)`. It is
-- `(user_id, org_id, ROLE_CODE)`, and `role_code` is a VALUE ON THE GRANT that
-- a person can change in place. `routers/org_members.py:544` does exactly that:
--
--     UPDATE staging.user_roles SET role_code=$1
--      WHERE user_id=$2 AND org_id=$3::uuid
--        AND role_code IN ('org_admin','org_member')
--
-- One statement, no author, no timestamp. A table with an UPDATE path that
-- changes a value is not a join table; it is a record. The test 201 states —
-- "is there a person who could amend this row, and is that a different fact
-- from who created it?" — was the right test and it was applied to the wrong
-- reading of the schema.
--
-- AND THIS IS THE MOST CONSEQUENTIAL COLUMN IN THE SET. `role_code` decides who
-- may appoint a payroll approver, who may reach a customer's console, who may
-- sign. `granted_by` already records who first CREATED a grant — every INSERT
-- in `admin_orgs.py` and `org_members.py` sets it. Nothing records who CHANGED
-- one. So the live database can say who made somebody an `org_member` in March
-- and cannot say who turned that into `org_admin` in August, which is the
-- question an auditor asks first and the only one that matters after an
-- incident.
--
-- Measured on the live catalogue 2026-08-23 before writing this:
--
--     staging.user_roles  38 rows
--     columns: id, user_id, org_id, role_code, granted_by, granted_at
--
-- No `updated_at`, no `updated_by`. `granted_at` is the CREATION time and is
-- not touched by this file — overloading it to mean "last changed" would
-- destroy the only record of when a grant began.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two nullable columns and one trigger, on one table.
--
-- `updated_by TEXT`, matching `granted_by` beside it and `public.users.user_id`
-- behind it. TEXT and not `uuid` — 030, 092, 097 and 202 are four separate
-- scars from forgetting that, and a fifth on the table that governs
-- authorisation would be the worst place yet to learn it again. No FK, so the
-- trail survives the removal of the account that made the change; no index,
-- because nothing queries a grant BY the person who last touched it.
--
-- `updated_at TIMESTAMPTZ` NULLABLE WITH NO DEFAULT, plus
-- `trg_touch_user_roles` calling the shared `staging.touch_updated_at()`. A
-- default would stamp today onto all 38 existing grants and assert that every
-- role in the product was changed on migration day. NULL says what is true:
-- this grant has not been amended since the column existed.
--
-- The trigger is what makes the timestamp honest whoever writes — including the
-- INSERT…ON CONFLICT paths and any future cron. `updated_by` gets NO trigger
-- and cannot have one: a trigger does not know who is holding the connection.
-- It is set by the write path, in the same UPDATE.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO BACKFILL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Who amended a grant before today was never recorded, so there is nothing to
-- backfill FROM. Copying `granted_by` across is the specific temptation here
-- and the specific thing not to do: it would name the person who ADMITTED
-- somebody to the org as the person who later made them an admin. On this
-- table that is not an approximation, it is an accusation — and it would read
-- as a fact, because the column's whole purpose is to be believed. A NULL is
-- visibly unknown; a wrong name is not.
--
-- Readable against what already exists:
--
--     updated_at IS NULL                          the grant is as it was made;
--                                                 `granted_by` is the whole story
--     updated_at IS NOT NULL, updated_by NULL     amended before this file
--     updated_by IS NOT NULL                      a person, and we know which
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two `ADD COLUMN IF NOT EXISTS`, both nullable with no default: catalog
-- updates with NO TABLE REWRITE (PG 11+). No DROP, no `ALTER … TYPE`, no
-- `SET NOT NULL`, no UPDATE of any row. Replayable end to end.
--
-- WRITE-PATH SIDE EFFECTS: none on existing rows. Nothing on `staging` or on
-- `main` names either column until the routers land, and every reader of this
-- table selects by name.
--
-- LOCKS — THE ONE THING TO WATCH. `staging.user_roles` IS THE SOLE TENANT PATH:
-- `middleware/org_resolver` reads it to resolve an org on essentially every
-- authenticated request. The `ALTER` needs ACCESS EXCLUSIVE, and while it
-- queues behind any open transaction on the table, every request arriving after
-- it queues behind IT — so the bad case is not a slow migration, it is a
-- product-wide stall. The work itself is microseconds at 38 rows.
-- `lock_timeout` turns that into a clean rollback after five seconds; a failed
-- run here costs nothing and is simply re-run. Run it when traffic is low.
--
-- APPLYING THIS FILE RECORDS NOTHING BY ITSELF. The columns stay NULL until
-- `org_members.update_member_role`, `admin_orgs.assign_role` and
-- `admin_orgs.nominate_org_owner` set them.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE staging.user_roles
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

DROP TRIGGER IF EXISTS trg_touch_user_roles ON staging.user_roles;
CREATE TRIGGER trg_touch_user_roles
    BEFORE UPDATE ON staging.user_roles
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

COMMENT ON COLUMN staging.user_roles.updated_by IS
    'public.users.user_id (TEXT) of the last person to CHANGE this grant — '
    'almost always a role_code change. NULL = never amended since 203, in which '
    'case granted_by/granted_at are the whole story. Never backfilled from '
    'granted_by: admitting somebody to an org is not the same act as promoting '
    'them, and on this table a wrong name is an accusation.';

COMMENT ON COLUMN staging.user_roles.updated_at IS
    'When this grant was last changed. NULL = unchanged since 203. Distinct '
    'from granted_at, which is when the grant BEGAN and is never overwritten.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — read the catalogue, never this file
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='staging' AND table_name='user_roles'
--      AND column_name IN ('updated_at','updated_by');
--   -- expect 2 rows, updated_by = text, both YES, both NULL default
--
--   SELECT t.tgname FROM pg_trigger t
--     JOIN pg_class c ON c.oid=t.tgrelid
--     JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='staging' AND c.relname='user_roles'
--      AND NOT t.tgisinternal;                       -- expect trg_touch_user_roles
--
--   -- NOTHING was backfilled, and granted_by is untouched.
--   SELECT count(*)              AS grants,
--          count(granted_by)     AS have_granter,
--          count(updated_by)     AS have_updater,   -- expect 0
--          count(updated_at)     AS have_updated_at -- expect 0
--     FROM staging.user_roles;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Safe while the routers still do not write these columns. After they do,
-- dropping them destroys the only record of who changed an authorisation, and
-- there is no second copy.
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_touch_user_roles ON staging.user_roles;
--   ALTER TABLE staging.user_roles DROP COLUMN IF EXISTS updated_at,
--                                  DROP COLUMN IF EXISTS updated_by;
--   COMMIT;
--
-- `staging.touch_updated_at()` is SHARED — 138, 139, 160, 201 and 202 attach it
-- to twenty-six other tables. Never drop the function.
