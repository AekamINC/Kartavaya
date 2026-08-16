-- 142_drop_shadow_tables.sql — thirteen empty tables that were winning the lookup.
--
-- Prerequisite for Niyam N4 (migration 143), and a live bug fix in its own
-- right. Niyam's third standing rule is "no rule bypasses quiet hours", and
-- quiet hours are read from `notification_prefs`. That read currently resolves
-- to an EMPTY table whenever the search_path applies. A gated send built on top
-- of it would have honoured a default window for everybody, reported success,
-- and been wrong in the one direction the rule exists to prevent.
--
-- ── WHAT IS ACTUALLY WRONG ──────────────────────────────────────────────────
--
-- Thirteen names exist in BOTH schemas. The design note that prompted this
-- said "four shadow tables"; the live catalog says thirteen, and they are
-- exactly the thirteen unqualified `CREATE TABLE IF NOT EXISTS` statements in
-- `server.py:_run_startup_migrations()`. Counted 2026-08-16:
--
--     table                     public    staging
--     ---------------------------------------------
--     notifications               3643          1     <-- NOT empty
--     task_reminders               346          0
--     activity_events             1274          0
--     time_entries                 289          0
--     project_assignments           92          0
--     approvals                     58          0
--     push_web_subscriptions        14          0
--     notification_prefs             1          0
--     field_definitions              0          0
--     field_values                   0          0
--     org_settings                   0          0
--     push_tokens                    0          0
--     report_schedules               0          0
--
-- The data is in `public`. `db.py` sets `search_path TO staging, public`, so an
-- unqualified `SELECT … FROM notification_prefs` finds the EMPTY staging copy
-- first and returns nothing — for the one user who has actually configured
-- their preferences.
--
-- And it is worse than a constant wrong answer, because it is not constant.
-- `db.py:113` runs that SET inside a `try` that logs a warning and CARRIES ON,
-- and PgBouncer transaction pooling does not guarantee the setting reaches the
-- next statement anyway. So the same query resolves to `staging` on one
-- checkout and `public` on the next.
--
-- `staging.notifications` HAS A ROW, and that row is the proof. One
-- notification out of 3,644 was written while the search_path applied and the
-- other 3,643 were not. It is `notif_3bf6c707f9bf`, a `reminder` created
-- 2026-07-24, still unread, addressed to a user who still exists, and it has
-- never been visible to them. This is not a fossil of some old deployment. It
-- is the bug, caught in the act, once.
--
-- The same mechanism is the most likely mechanical explanation for the audit's
-- "331 of 331 reminders suppressed, none ever reached a human" and "94 due,
-- unsent since 2026-08-06": 346 reminder rows sitting in `public` while the
-- reader looks at an empty `staging`.
--
-- 49 call sites read these names unqualified. NONE qualifies a schema.
--
-- ── WHY DROP RATHER THAN QUALIFY THE CALL SITES ─────────────────────────────
--
-- Qualifying is a diff across the reminder service, the push service, the
-- custom-field endpoints, the activity log and the task router, where every
-- site must pick the right schema by hand and picking wrong is SILENT — which
-- is precisely how this was produced. Dropping the empty shadows makes the
-- fall-through find `public` every time, for every existing call site, with no
-- Python change and nothing to get wrong. Remove the ambiguity rather than
-- out-typing it.
--
-- Nothing outside the set references any of the thirteen: no foreign key from
-- any other table, and no view (checked `pg_constraint.confrelid` and
-- `pg_depend`/`pg_rewrite`). They are dropped in ONE statement so foreign keys
-- BETWEEN them (field_values → field_definitions) need no ordering.
--
-- ── WHY THEY CANNOT SIMPLY COME BACK ────────────────────────────────────────
--
-- `_run_startup_migrations()` is the creator, and an unqualified CREATE lands
-- in the first schema on the search_path — `staging`. It is already inert on
-- this database: its first act is
--
--     SELECT 1 FROM information_schema.tables
--      WHERE table_schema='public' AND table_name='notifications'
--
-- and it returns early when that is true, which it has been for a long time. So
-- this does not race the creator. The accompanying commit adds
-- `tests/test_no_unqualified_ddl.py`, an `ast`-based ratchet that fails the
-- build if application code issues an unqualified CREATE TABLE at all — because
-- the next person to add one will not know any of this, and the failure they
-- cause will not look like their change.
--
-- ── RISK ────────────────────────────────────────────────────────────────────
--
-- Production shares this database and reads these same names, so state the
-- effect plainly: production's reads currently land on whichever copy the
-- pooler happens to give it. Afterwards they land on `public` — the copy with
-- the data — every time. The change can only turn an empty or missing result
-- into a correct one.
--
-- Two consequences worth naming before they surprise somebody:
--
--  1. `notification_prefs` starts resolving to the real table, so the user who
--     set their preferences on 2026-07-28 will have them honoured and their
--     quiet window starts applying. That is the fix, not a side effect — but it
--     means "notifications stopped arriving overnight" is a CORRECT outcome
--     afterwards and not a regression.
--  2. `task_reminders` becomes visible: 346 rows, some of them months old, to
--     `routers/task_reminders.py:dispatch_reminders` — which claims EVERY due
--     row in one tick with no ceiling and then fans out push and email. So the
--     obvious fear is that this migration ends in a burst of stale
--     notifications to real people. It does not, and that was measured rather
--     than hoped:
--
--         unsent                                166
--         unsent AND due                        106   oldest 2026-06-23
--           ├─ task already 'done'              102
--           ├─ task archived, not done            4
--           ├─ task row missing                   0
--           └─ STILL LIVE                         0   <-- what would fire
--
--     The dispatcher's own `WHERE t.status <> 'done' AND t.archived_at IS NULL`
--     excludes all 106. The backlog is inert because the work it was reminding
--     anyone about was finished months ago. NOTHING FIRES.
--
--     This number is only true while it is true. If this migration is applied
--     long after it was written, RE-RUN the query in the VERIFY block below
--     first — a reminder on a task that is still open would fire on the next
--     tick, and the tick is not gated by NIYAM_ARMED or by anything else.
--
-- Reversal is `CREATE TABLE staging.<name> (LIKE public.<name> INCLUDING ALL)`,
-- which restores the broken state exactly. After the rescue below there is no
-- data in any dropped table, so nothing is lost either way.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One INSERT of a single row into `public.notifications`, then one DROP TABLE
-- taking ACCESS EXCLUSIVE on thirteen relations that nothing holds open and
-- nothing references. `lock_timeout` turns a queue into a clean rollback.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1. RESCUE THE ONE REAL ROW ──────────────────────────────────────────────
--
-- A user's notification that has never been visible to them. It is moved, not
-- discarded: deleting somebody's data because it is inconvenient to carry is
-- not a migration, it is a cover-up. `created_at` is PRESERVED, so it lands in
-- its true position three weeks back in the inbox rather than ambushing anyone
-- at the top of the list. `id` is omitted — `public.notifications` has that
-- extra column with a `uuid_generate_v4()` default, and `staging` never had it.
-- ON CONFLICT DO NOTHING makes a re-run a no-op.
INSERT INTO public.notifications
    (notification_id, user_id, team_id, type, title, message, task_id, url, read_at, created_at)
SELECT n.notification_id, n.user_id, n.team_id, n.type, n.title, n.message,
       n.task_id, n.url, n.read_at, n.created_at
FROM staging.notifications n
WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = n.user_id)
ON CONFLICT (notification_id) DO NOTHING;

-- ── 2. REFUSE IF ANYTHING ELSE IS IN THERE ──────────────────────────────────
--
-- Runs AFTER the rescue, so the notification handled above is legitimately
-- gone from the count. Anything still present means a shadow table is not a
-- shadow — it is a second store something is actively using, and dropping it
-- would be data loss. That case needs a human, not a migration.
DO $$
DECLARE
    t     TEXT;
    n     BIGINT;
    found TEXT := '';
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'activity_events', 'approvals', 'field_definitions', 'field_values',
        'notification_prefs', 'notifications', 'org_settings',
        'project_assignments', 'push_tokens', 'push_web_subscriptions',
        'report_schedules', 'task_reminders', 'time_entries']
    LOOP
        IF to_regclass('staging.' || t) IS NULL THEN
            CONTINUE;                       -- already gone; nothing to do
        END IF;

        IF t = 'notifications' THEN
            -- Only rows the rescue could NOT take are a problem. A row whose
            -- user no longer exists cannot be moved (the FK would refuse it)
            -- and must not silently block the migration forever either — but it
            -- is still somebody's data, so it stops us and gets a decision.
            EXECUTE 'SELECT count(*) FROM staging.notifications n
                      WHERE NOT EXISTS (SELECT 1 FROM public.notifications p
                                         WHERE p.notification_id = n.notification_id)'
              INTO n;
        ELSE
            EXECUTE format('SELECT count(*) FROM staging.%I', t) INTO n;
        END IF;

        IF n > 0 THEN
            found := found || format(' staging.%s=%s', t, n);
        END IF;
    END LOOP;

    IF found <> '' THEN
        RAISE EXCEPTION
            'REFUSING: shadow table(s) still hold unrescued rows —%. Something '
            'is writing to the staging copy. Reconcile by hand before dropping.',
            found;
    END IF;
END $$;

-- ── 3. DROP ─────────────────────────────────────────────────────────────────
--
-- One statement, so the foreign key between field_values and field_definitions
-- needs no ordering and no CASCADE. CASCADE is deliberately NOT used: it would
-- silently drop anything that turned out to depend on these, and "silently"
-- is the entire subject of this migration.
DROP TABLE IF EXISTS
    staging.activity_events,
    staging.approvals,
    staging.field_definitions,
    staging.field_values,
    staging.notification_prefs,
    staging.notifications,
    staging.org_settings,
    staging.project_assignments,
    staging.push_tokens,
    staging.push_web_subscriptions,
    staging.report_schedules,
    staging.task_reminders,
    staging.time_entries;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--
--   -- no name may exist in both schemas any more:
--   SELECT table_name, count(DISTINCT table_schema) AS schemas
--     FROM information_schema.tables
--    WHERE table_schema IN ('public','staging')
--    GROUP BY table_name HAVING count(DISTINCT table_schema) > 1;   -- expect 0 rows
--
--   -- the rescued notification arrived, with its original date:
--   SELECT notification_id, created_at, read_at
--     FROM public.notifications WHERE notification_id = 'notif_3bf6c707f9bf';
--
--   -- and the data is reachable through the fall-through:
--   SET search_path TO staging, public;
--   SELECT count(*) FROM task_reminders;        -- expect 346, was 0
--   SELECT count(*) FROM notification_prefs;    -- expect 1,   was 0
--   SELECT count(*) FROM notifications;         -- expect 3644, was 1
--
-- ── RUN THIS *BEFORE* APPLYING, EVERY TIME ──────────────────────────────────
--
-- How many reminders would the very next dispatch tick actually send? Must be
-- 0. It was 0 on 2026-08-16; a task reopened since then changes the answer, and
-- the dispatcher has no ceiling and no arming flag.
--
--   SELECT count(*)
--     FROM public.task_reminders tr
--     JOIN public.tasks t ON t.task_id = tr.task_id
--    WHERE tr.sent_at IS NULL AND tr.fire_at <= NOW()
--      AND t.status <> 'done' AND t.archived_at IS NULL;   -- expect 0
--
-- If it is not 0, do NOT apply this yet. Give the dispatcher a per-tick ceiling
-- first, or mark the stale backlog sent deliberately — either is a decision
-- someone should make on purpose, and neither belongs inside this migration.
