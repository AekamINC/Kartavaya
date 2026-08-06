-- 121_retention_period_180_days.sql
--
-- SUPERSEDED THE SAME DAY BY 122_retention_period_365_days.sql. DO NOT APPLY.
--
-- Applied 2026-08-06 and replaced within the hour: the owner raised the window
-- again, from 180 to 365, after seeing that 180 would delete 175 of 283
-- graha_activities rows. The live function is 365. This file is kept because it
-- records the 90-to-180 collapse and the counts that drove both decisions —
-- running it would silently take the window BACK DOWN to 180 and delete 113 more
-- rows than the current policy allows.
--
-- Original header follows.
--
-- Owner decision: the retention period is 180 days.
--
-- ── WHAT CHANGED ────────────────────────────────────────────────────────────
--
-- `staging.cleanup_old_data()` held two windows. The first group — hub_ai_logs,
-- hub_chat_messages, sign_audit_log, hub_org_credit_transactions — and the
-- completed-scraper-run sweep were on **90 days**. Both are now **180**. The
-- activity tables (crm_activities, graha_activities) were already 180 and are
-- untouched, so after this file every window in the function is the same number.
-- One number is the point: two windows in one function is how a reader ends up
-- believing the shorter one applies to everything.
--
-- This direction only ever deletes LESS. Nothing that survived a 90-day sweep
-- can be removed by a 180-day one.
--
-- ── APPLYING THIS DELETES NOTHING ───────────────────────────────────────────
--
-- The function does not run on a timer. It executes only when something calls
-- `POST /api/internal/cron/retention` (routers/scheduler.py), and as of today
-- nothing does — see below. Replacing the definition is inert.
--
-- ── THE COUNT THAT DECIDED THE CRON, measured 2026-08-06 ────────────────────
--
--   staging.graha_activities            175 of 283 rows would be deleted
--   staging.hub_ai_logs                   0 of 251
--   staging.hub_chat_messages             0 of 148
--   staging.sign_audit_log                0 of 134
--   staging.hub_org_credit_transactions   0 of 171
--   staging.hub_scraper_runs              0 of  33
--   staging.crm_activities                0 of   0
--
-- 175 rows is 62% of the CRM timeline, and it is seeded demo history for the
-- Unicode Group and E2E orgs — the oldest row dates to 2025-04-06. Deleting it
-- would empty the contact and deal timelines that make those demos look like a
-- real firm's year. Raising the window to 180 does NOT fix this, because the
-- activity tables were already at 180; the rows in question are simply older
-- than that.
--
-- Windows that were also counted, if the owner would rather keep the history:
--   270 days → 109 rows deleted
--   365 days →  62 rows deleted
--
-- ── WHY NO CRON IS ARMED ────────────────────────────────────────────────────
--
-- The `retention-cron` Railway service used to sit in the PRODUCTION
-- environment, in us-west2, calling
-- `https://kartavya-production.up.railway.app/api/internal/cron/retention`.
-- `backend/routers/scheduler.py` does not exist on `main`, which is the branch
-- production deploys, so that URL answered 404, curl exited non-zero and the
-- container was marked CRASHED every night at 03:00. Retention has therefore
-- NEVER run.
--
-- 2026-08-06 the service was moved to the STAGING environment, where the
-- endpoint exists. Its start command is deliberately an `echo` that explains
-- how to arm it and why it is not armed, rather than the curl. Arming it is a
-- one-line change once the question above is settled.
--
-- ── RELATED, AND WORTH KNOWING BEFORE TOUCHING ANY OF THIS ──────────────────
--
-- `routers/scheduler.py` defines THIRTEEN cron endpoints. Railway runs two
-- services. Eleven of those jobs — recurring invoices, marketing dispatch, deal
-- scoring, attendance fill, stock alerts, scheduled skills, the deadline agent,
-- reminders, publish — have never executed. Do not schedule them without
-- running each once by hand first.

CREATE OR REPLACE FUNCTION staging.cleanup_old_data()
 RETURNS TABLE(table_name text, rows_deleted bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r RECORD;
  cnt bigint;
BEGIN
  -- 180-day retention: AI logs, chat messages, e-sign audit, credit ledger.
  -- Was 90 days until migration 121.
  FOR r IN
    SELECT unnest(ARRAY[
      'staging.hub_ai_logs',
      'staging.hub_chat_messages',
      'staging.sign_audit_log',
      'staging.hub_org_credit_transactions'
    ]) AS tbl
  LOOP
    EXECUTE format('DELETE FROM %s WHERE created_at < NOW() - INTERVAL ''180 days''', r.tbl);
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN
      table_name := r.tbl;
      rows_deleted := cnt;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- 180-day retention: activity/event logs. Unchanged by 121.
  FOR r IN
    SELECT unnest(ARRAY[
      'staging.crm_activities',
      'staging.graha_activities'
    ]) AS tbl
  LOOP
    EXECUTE format('DELETE FROM %s WHERE created_at < NOW() - INTERVAL ''180 days''', r.tbl);
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN
      table_name := r.tbl;
      rows_deleted := cnt;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Completed scraper runs, results already in R2. Was 90 days until 121.
  DELETE FROM staging.hub_scraper_runs
  WHERE created_at < NOW() - INTERVAL '180 days'
    AND status IN ('succeeded', 'failed')
    AND (results_r2_key IS NOT NULL OR results IS NULL);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt > 0 THEN
    table_name := 'staging.hub_scraper_runs';
    rows_deleted := cnt;
    RETURN NEXT;
  END IF;

  RETURN;
END;
$function$;

COMMENT ON FUNCTION staging.cleanup_old_data() IS
  'Retention sweep, 180 days for every table it touches (migration 121 raised '
  'the AI-log/chat/audit/credit group and the scraper sweep from 90). Called '
  'only by POST /api/internal/cron/retention. Counted on 2026-08-06: at 180 '
  'days it would delete 175 of 283 staging.graha_activities rows and zero rows '
  'from every other table. That is why the retention-cron service is staged but '
  'not armed.';
