-- 107_prachar_seeded_engagement_zeroed.sql
--
-- A PAYING CUSTOMER'S DASHBOARD IS SHOWING INVENTED OPENS AND CLICKS.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/107_prachar_seeded_engagement_zeroed.sql
--
-- NOT APPLIED AS OF 6 August 2026. This one writes to customer rows, so it is
-- deliberately a file that a human runs after reading verification query 0
-- below and agreeing with what it selects.
--
-- ── WHAT IS WRONG ───────────────────────────────────────────────────────────
--
-- `staging.prachar_campaigns` carries four columns describing what a recipient
-- did: `total_opened`, `total_clicked`, `total_bounced`, `total_unsubscribed`.
-- NOTHING IN THIS PRODUCT HAS EVER WRITTEN ANY OF THEM. There is no Resend
-- webhook, no tracking pixel and no click redirect; the two statements that
-- touch a campaign after a send set `status`, `total_recipients` and
-- `updated_at`. See `backend/services/engagement_metrics.py` for the full
-- argument and for the code-side half of this fix.
--
-- So every non-zero value in those four columns arrived from something other
-- than a measurement. Measured 6 August 2026, there are eight such rows and
-- they are all in one org:
--
--   org fae87907 "Unicode Group"  8 campaigns  51 opens  29 clicks
--                                 1 bounce     2 unsubscribes
--
-- Every one stamped `updated_at = 2026-08-05 12:41:32.496118+00` — identical to
-- the microsecond across all eight — on campaigns dated 5 March to 11 July, in
-- an org whose marketing rows were seeded four months after those dates. Demo
-- seed, rendered by the dashboard as a delivery funnel with an open rate, a
-- click rate and a bounce cell that turns red above 5%.
--
-- ── WHY THE PREDICATE IS NOT `WHERE org_id = 'fae87907…'` ───────────────────
--
-- Because the rule is not "Unicode Group's numbers are wrong", it is "a column
-- nothing writes cannot hold a measurement". Selecting on the columns rather
-- than on the org states that rule in SQL, catches the next seed that does the
-- same thing, and cannot miss a row in an org nobody thought to check. If some
-- future run of this file selects zero rows, that is the correct outcome and
-- not a failed migration.
--
-- ── WHY THE CODE FIX IS NOT ENOUGH ON ITS OWN, AND WHY IT COMES FIRST ───────
--
-- `services/engagement_metrics.redact_engagement` already replaces these four
-- values with null in every Prachar response, so the fabricated figures stop
-- reaching a screen the moment that ships — WITHOUT this file. That ordering is
-- deliberate: the display is fixed by code that a test pins, and the data is
-- corrected separately by a human who can read what is about to change.
--
-- This file still matters. The values are also read by anything that queries
-- the table directly — an export, a support session, a future report, the next
-- person to run `SELECT * FROM staging.prachar_campaigns` — and a stored
-- fabrication outlives the screen that displayed it.
--
-- ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────────
--
--   * Sets the four unmeasured columns to 0 on rows where any of them is
--     non-zero. 0 is the column default and the only honest stored value while
--     nothing measures them; the product now renders them as "not measured"
--     regardless, from the code side, so the 0 is never displayed as a rate.
--   * DOES NOT TOUCH `total_recipients` OR `total_sent`. Both are written by
--     real code — `routers/prachar.py` on every send, and
--     `services/skills/action/campaign_sender.py` respectively — so they are
--     measurements and not this file's business, even on a seeded row.
--   * DOES NOT TOUCH `updated_at`. The identical microsecond across those eight
--     rows is the evidence that they were seeded. Overwriting it would destroy
--     the only forensic trace of how they got there.
--
-- Replayable: after one run the predicate matches nothing.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
    IF to_regclass('staging.prachar_campaigns') IS NULL THEN
        RAISE EXCEPTION 'ABORT: staging.prachar_campaigns does not exist.';
    END IF;
END $$;

UPDATE staging.prachar_campaigns
   SET total_opened       = 0,
       total_clicked      = 0,
       total_bounced      = 0,
       total_unsubscribed = 0
 WHERE COALESCE(total_opened, 0)       <> 0
    OR COALESCE(total_clicked, 0)      <> 0
    OR COALESCE(total_bounced, 0)      <> 0
    OR COALESCE(total_unsubscribed, 0) <> 0;

COMMENT ON COLUMN staging.prachar_campaigns.total_opened IS
    'Recipients who opened. NOTHING WRITES THIS — no webhook, no pixel. Any '
    'non-zero value here did not come from a measurement. Kept at 0 and served '
    'as null by services/engagement_metrics.py until a receiver exists.';
COMMENT ON COLUMN staging.prachar_campaigns.total_clicked IS
    'Recipients who clicked. See total_opened — nothing writes this.';
COMMENT ON COLUMN staging.prachar_campaigns.total_bounced IS
    'Undeliverable addresses. See total_opened — nothing writes this, which is '
    'also why a hard-bouncing address is never suppressed and is re-mailed on '
    'every campaign.';
COMMENT ON COLUMN staging.prachar_campaigns.total_unsubscribed IS
    'Opt-outs attributed to this campaign. See total_opened — nothing writes '
    'this. The suppression list itself (staging.prachar_unsubscribes) is real '
    'and is enforced on every send; this counter is not connected to it.';

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- 0. RUN THIS *BEFORE* THE MIGRATION, AND READ IT WITH YOUR EYES.
--    It is the same predicate the UPDATE uses. These are the rows that will
--    change. Expect 8, all in org fae87907, all with updated_at at
--    2026-08-05 12:41:32.496118+00.
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT org_id, id, name, status, sent_at, updated_at,
--        total_recipients, total_sent,
--        total_opened, total_clicked, total_bounced, total_unsubscribed
--   FROM staging.prachar_campaigns
--  WHERE COALESCE(total_opened, 0)       <> 0
--     OR COALESCE(total_clicked, 0)      <> 0
--     OR COALESCE(total_bounced, 0)      <> 0
--     OR COALESCE(total_unsubscribed, 0) <> 0
--  ORDER BY org_id, created_at;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT AND READ IT WITH YOUR EYES.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Nothing claims engagement any more. Both counts must be 0.
SELECT count(*) FILTER (WHERE COALESCE(total_opened,0)  <> 0
                          OR COALESCE(total_clicked,0) <> 0) AS still_engaged,
       count(*) FILTER (WHERE COALESCE(total_bounced,0) <> 0
                          OR COALESCE(total_unsubscribed,0) <> 0) AS still_bounced
  FROM staging.prachar_campaigns;

-- 2. The measured columns are untouched. Unicode Group must still show 66
--    recipients and 66 sent across its 8 sent campaigns — if either dropped to
--    0, the UPDATE hit a column it had no business touching.
SELECT org_id,
       count(*)                       AS sent_campaigns,
       COALESCE(SUM(total_recipients),0) AS recipients,
       COALESCE(SUM(total_sent),0)       AS sent
  FROM staging.prachar_campaigns
 WHERE status = 'sent'
 GROUP BY org_id
 ORDER BY org_id;
