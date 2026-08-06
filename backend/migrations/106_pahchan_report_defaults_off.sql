-- 106_pahchan_report_defaults_off.sql
--
-- STOP PROMISING THREE ATTENDANCE SUMMARIES NOBODY SENDS.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/106_pahchan_report_defaults_off.sql
--
-- NOT APPLIED AS OF 6 August 2026. Written, verified against the live catalog,
-- deliberately not run — see the header of `105_unicode_demo_safe_emails.sql`
-- for why a migration in this repository is a file first and an act second.
--
-- ── WHAT IS WRONG ───────────────────────────────────────────────────────────
--
-- `staging.pahchan_policy` carries:
--
--     report_recipients  jsonb   DEFAULT '[]'
--     report_daily       boolean DEFAULT true
--     report_weekly      boolean DEFAULT true
--     report_monthly     boolean DEFAULT true
--
-- NO FUNCTION IN THE BACKEND READS ANY OF THEM. A grep of the whole of
-- `backend/` for those four names returns exactly three things: the Pydantic
-- model on `PolicyBody`, the defaults dict `DEFAULT_POLICY`, and the columns in
-- `upsert_policy`'s INSERT … ON CONFLICT. There is no sender, no template, no
-- cron, and nothing anywhere that opens `report_recipients` and mails it
-- something. The Pahchan attendance summary reports do not exist.
--
-- The defaults being TRUE is what turns that from dead configuration into a
-- promise. An org that has never opened the policy screen is shown three ticked
-- boxes labelled "Daily summary", "Weekly summary" and "Monthly summary", and
-- every row this table gains without an explicit choice is recorded as wanting
-- three reports that will never arrive.
--
-- The product's own precedent settles the direction. Migration 082 gave the
-- same table `overtime_enabled` and made it FALSE, with the reason written into
-- `routers/pahchan.py`: "an org that never opens this screen keeps exactly
-- today's behaviour — turning overtime on changes what people are paid and is
-- nobody's default." A default that changes what the product tells a customer
-- it will do is nobody's default either.
--
-- ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────────
--
-- Changes the DEFAULT on three columns. Nothing else. In particular:
--
--   * NO UPDATE. Existing rows are left exactly as they are. A stored `true` is
--     somebody's answer to a question the screen asked, and this migration is
--     not entitled to overrule it — it only stops the question being answered
--     "yes" on their behalf. `ALTER COLUMN … SET DEFAULT` does not touch a
--     single existing row and takes no rewrite.
--   * NO DROP. The columns and `report_recipients` stay. They are the shape the
--     preference has to have the day a sender is written, and dropping them
--     would make that day a migration instead of a feature.
--
-- ── EFFECT ON EXISTING ROWS ─────────────────────────────────────────────────
--
-- None, by construction. Measured 6 August 2026, `staging.pahchan_policy` holds
-- 2 rows:
--
--     E2E Test & Associates [TEST ORG]  daily f  weekly f  monthly f  recipients []
--     Unicode Group                     daily f  weekly t  monthly t  recipients
--                                                                     ["hr@unicodegroup.com"]
--
-- The Unicode Group row was written by the demo seed at 2026-08-05 12:39:35,
-- not by anyone at the customer — which is worth knowing before anybody reads
-- "a paying customer has asked for two of these". Both rows survive this file
-- unchanged.
--
-- Replayable: SET DEFAULT is idempotent, so a second run does nothing.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
    IF to_regclass('staging.pahchan_policy') IS NULL THEN
        RAISE EXCEPTION 'ABORT: staging.pahchan_policy does not exist. Wrong '
                        'database, or a branch where Pahchan was never created.';
    END IF;
END $$;

ALTER TABLE staging.pahchan_policy
    ALTER COLUMN report_daily   SET DEFAULT false,
    ALTER COLUMN report_weekly  SET DEFAULT false,
    ALTER COLUMN report_monthly SET DEFAULT false;

COMMENT ON COLUMN staging.pahchan_policy.report_daily IS
    'Whether this org wants a daily attendance summary emailed to '
    'report_recipients. NOTHING SENDS IT YET — no function in the backend reads '
    'this column. Defaults to false so an org that never opens the policy '
    'screen is not recorded as wanting a report the product cannot deliver.';
COMMENT ON COLUMN staging.pahchan_policy.report_weekly IS
    'Weekly attendance summary. See report_daily — no sender exists.';
COMMENT ON COLUMN staging.pahchan_policy.report_monthly IS
    'Monthly attendance summary. See report_daily — no sender exists.';


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT AND READ IT WITH YOUR EYES.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. All three defaults are now false. `report_recipients` is untouched.
SELECT column_name, column_default
  FROM information_schema.columns
 WHERE table_schema='staging' AND table_name='pahchan_policy'
   AND column_name IN ('report_daily','report_weekly','report_monthly',
                       'report_recipients')
 ORDER BY column_name;

-- 2. No existing row moved. Compare against the two rows described above —
--    this migration must not have changed either of them.
SELECT org_id, report_daily, report_weekly, report_monthly, report_recipients
  FROM staging.pahchan_policy
 ORDER BY created_at;
