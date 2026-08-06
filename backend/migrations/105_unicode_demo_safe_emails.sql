-- 105_unicode_demo_safe_emails.sql
--
-- EVERY ADDRESS IN THE UNICODE GROUP DEMO ORG BECOMES ONE THAT CANNOT COST US
-- QUOTA, REPUTATION, OR SOMEBODY'S GOODWILL.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. It rewrites data rather than schema, so
-- read the backup note at the bottom before running it.
--
-- ── WHY, AND WHY IT IS THREE PROBLEMS AND NOT ONE ───────────────────────────
--
-- Unicode Group is about to be exercised by the real-user Playwright suite,
-- which includes `campaign-send.spec.ts` — a spec that presses "Send now". Its
-- 18 addresses fall into three groups and every group is dangerous in a
-- different way:
--
--   8 employees @unicodegroup.com — a REAL, SES-VERIFIED domain with no mailbox
--       behind these names. SES accepts the send, charges the quota, attempts
--       delivery and takes a HARD BOUNCE. Verified-domain bounces are the worst
--       kind for reputation because they cannot be blamed on a typo'd stranger.
--
--   8 contacts on `.example` — a RESERVED TLD (RFC 2606) that is guaranteed
--       never to resolve. Every one is an immediate hard bounce.
--
--   2 contacts on real gmail — aekaminc1@gmail.com and bluvianahm@gmail.com are
--       LIVE MAILBOXES BELONGING TO PEOPLE. A campaign send reaches them. This
--       is the one that is not a metric problem.
--
-- The E2E test org never had the third category, which is why this exposure is
-- new: its contacts were all @example.com, so nobody could be mailed by
-- accident. Unicode Group was built to look real, and looking real is exactly
-- what makes it unsafe to point a send-suite at.
--
-- ── WHY THE SES MAILBOX SIMULATOR AND NOT resend.dev ────────────────────────
--
-- Both providers are configured. `email_service.py:25` prefers Resend when
-- RESEND_API_KEY is set — that is STAGING — and falls back to SES, which is
-- PRODUCTION, where OUTBOUND_MODE is unset and `outbound.py:148` reads that as
-- "live".
--
-- Neither provider has an address the other also treats as free, so this is a
-- choice and not a lookup:
--
--   `@simulator.amazonses.com` — AWS documents these as excluded from the
--       sending quota AND from bounce/complaint metrics. On Resend they are an
--       ordinary send to a real AWS domain that blackholes the message, so they
--       count against a Resend send-count but NEVER bounce.
--
--   `@resend.dev` — free on Resend, but on SES it is an ordinary send to a
--       domain that will not accept it, i.e. quota plus a bounce, in the
--       environment where reputation actually matters.
--
-- Bounces are the thing that costs the sending domain, and the sending domain
-- carries payslips, invoices and password resets. So the address is chosen to
-- be safe on the provider that can do lasting harm.
--
-- ── THE SHAPE OF THE REPLACEMENTS ───────────────────────────────────────────
--
-- Not all `success@`. The simulator offers distinct behaviours and a demo org
-- that only ever succeeds cannot exercise the paths a real list produces:
--
--   success@   delivers cleanly            — the majority
--   bounce@    a hard bounce               — one contact, so the bounce column
--                                            has something real in it
--   complaint@ a spam complaint            — one contact, same reason
--
-- The local part keeps the person's name (`success+priya.mehta@…`) so the
-- screens still read like a real firm: SES ignores everything after `+`, and a
-- demo where every row says "success@simulator" looks like test data, which is
-- the opposite of the point.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Guard: this file names ONE org by id on purpose. Running it against the wrong
-- database would rewrite a real customer's contact list.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM staging.organisations
                    WHERE id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
                      AND name = 'Unicode Group') THEN
        RAISE EXCEPTION
          'ABORT: fae87907-… is not Unicode Group on this database. This file '
          'rewrites contact and employee email addresses and must never run '
          'against an org it was not written for.';
    END IF;
END $$;

-- ── 1. EMPLOYEES ────────────────────────────────────────────────────────────
-- The local part is derived from the existing one, so Priya Mehta stays
-- recognisable on a payslip and in the HR directory.
UPDATE staging.manav_employees
   SET email = 'success+' || split_part(email, '@', 1) || '@simulator.amazonses.com'
 WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
   AND coalesce(email, '') <> ''
   AND email NOT LIKE '%@simulator.amazonses.com';

-- ── 2. CRM CONTACTS ─────────────────────────────────────────────────────────
-- Deterministic split by name so a re-run lands the same way: one bounce, one
-- complaint, the rest deliver. `ORDER BY id` inside the CTE, not `random()` —
-- a demo whose bounce moves every time this is applied is a demo nobody can
-- write a script against.
WITH ranked AS (
    SELECT id, email, row_number() OVER (ORDER BY id) AS rn
      FROM staging.graha_contacts
     WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
       AND coalesce(email, '') <> ''
       AND email NOT LIKE '%@simulator.amazonses.com'
)
UPDATE staging.graha_contacts c
   SET email = CASE
         WHEN r.rn = 1 THEN 'bounce+'    || split_part(r.email, '@', 1) || '@simulator.amazonses.com'
         WHEN r.rn = 2 THEN 'complaint+' || split_part(r.email, '@', 1) || '@simulator.amazonses.com'
         ELSE               'success+'   || split_part(r.email, '@', 1) || '@simulator.amazonses.com'
       END
  FROM ranked r
 WHERE c.id = r.id;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT AND READ IT WITH YOUR EYES.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. NOTHING addressable outside the simulator is left. Both counts must be 0.
--    This is the whole point of the file: a real mailbox in either column is a
--    person who can be mailed by a test run.
SELECT
  (SELECT count(*) FROM staging.manav_employees
    WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
      AND coalesce(email,'')<>'' AND email NOT LIKE '%@simulator.amazonses.com') AS employees_still_real,
  (SELECT count(*) FROM staging.graha_contacts
    WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
      AND coalesce(email,'')<>'' AND email NOT LIKE '%@simulator.amazonses.com') AS contacts_still_real;

-- 2. The mix — one bounce, one complaint, the rest delivering.
SELECT split_part(email,'+',1) AS behaviour, count(*)
  FROM staging.graha_contacts
 WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND coalesce(email,'')<>''
 GROUP BY 1 ORDER BY 2 DESC;

-- 3. Names survived, so the screens still read like a firm rather than a
--    fixture. Spot-check that these are recognisable people:
SELECT name, email FROM staging.manav_employees
 WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid ORDER BY name LIMIT 5;


-- ── NOT COVERED BY THIS FILE, AND DELIBERATELY ──────────────────────────────
--
-- The five LOGIN accounts keep their real gmail addresses. They have to: they
-- are how a person signs in to run the demo, and a password reset has to reach
-- somebody. They are not in any campaign audience — `prachar` builds its
-- audience from `graha_contacts`, not from `user_roles` — so a send cannot
-- reach them.
--
-- `organisations.email` (info@unicodegroup.com) also stays. It is the org's
-- point of contact and appears on the invoice letterhead; it is a FROM address
-- and a display value, not a recipient.
--
-- ── BEFORE YOU RUN IT ───────────────────────────────────────────────────────
--
-- This UPDATEs data and is NOT reversible from the file — the original
-- addresses are not recorded anywhere once overwritten. If they matter, take
-- them first:
--
--   CREATE TABLE staging.unicode_emails_backup_20260806 AS
--     SELECT 'employee' AS kind, id::text, name, email FROM staging.manav_employees
--      WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
--     UNION ALL
--     SELECT 'contact', id::text, name, email FROM staging.graha_contacts
--      WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid;
