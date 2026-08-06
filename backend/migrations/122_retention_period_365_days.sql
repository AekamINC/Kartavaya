-- 122_retention_period_365_days.sql
--
-- APPLIED 2026-08-06, superseding 121 the same day.
--
-- Owner: "increase 365 days for data ... we don't have to worry about data as of
-- now. we will worry when it comes to go full product to actual users."
--
-- ONE window now, 365 days, for every table the function touches. 121 had
-- collapsed two windows (90 and 180) into one at 180; this raises that to 365.
-- Two windows in one function is how a reader ends up believing the shorter one
-- applies to everything, which is why they stay collapsed.
--
-- COUNTED BEFORE APPLYING, 2026-08-06:
--     window   staging.graha_activities rows deleted
--     180        175 of 283
--     270        109
--     365         62   <- this file
--   Every other table the function touches counted ZERO at every window:
--   hub_ai_logs (251 rows), hub_chat_messages (148), sign_audit_log (134),
--   hub_org_credit_transactions (171), hub_scraper_runs (33), crm_activities (0).
--
-- Applying this deletes nothing. The function only executes when something calls
-- POST /api/internal/cron/retention.
--
-- STILL TRUE, AND THE REAL BLOCKER: CRON_SECRET IS NOT SET ON THE STAGING
-- SERVICE. utils.secret_matches returns False when either side is empty, on
-- purpose, so an unset variable can never be matched by an omitted one. Every
-- one of the thirteen endpoints in routers/scheduler.py therefore answers 403
-- on staging and always has. Set CRON_SECRET before expecting any cron to work.

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
    EXECUTE format('DELETE FROM %s WHERE created_at < NOW() - INTERVAL ''365 days''', r.tbl);
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
    EXECUTE format('DELETE FROM %s WHERE created_at < NOW() - INTERVAL ''365 days''', r.tbl);
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN
      table_name := r.tbl;
      rows_deleted := cnt;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Completed scraper runs, results already in R2. Was 90 days until 121.
  DELETE FROM staging.hub_scraper_runs
  WHERE created_at < NOW() - INTERVAL '365 days'
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
