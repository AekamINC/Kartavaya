-- PROPOSED — NOT APPLIED. Staging and production share one database, so this
-- hits production the moment it runs. Raise it with the owner first.
--
-- ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
--
-- Owner, 2026-08-09: a deal that reaches Won or Lost should leave the board
-- seven days later, by itself. Today it sits in the Won column for ever and the
-- board's last two columns grow without limit.
--
-- ── WHY A NEW COLUMN AND NOT `is_active` ────────────────────────────────────
--
-- `is_active=FALSE` is what DELETE does to a deal (`routers/graha.py`, the
-- delete handler). Reusing it for archiving would make a closed deal
-- indistinguishable from a deleted one, and every won-value figure in Dristi
-- and in the CRM report — all of which filter on `is_active` — would silently
-- drop the archived wins. A won deal is the firm's record of revenue. It must
-- stay countable.
--
-- So archiving is its own nullable timestamp, exactly as projects do it
-- (migration 104). No default and no NOT NULL: a default archives every deal in
-- the product on the day it runs.

ALTER TABLE staging.graha_deals
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- The sweep asks for closed, unarchived deals whose closing date has passed the
-- window. Partial, because the archived ones are the majority it never needs to
-- look at.
CREATE INDEX IF NOT EXISTS graha_deals_archive_sweep
  ON staging.graha_deals (org_id, stage, archived_at)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN staging.graha_deals.archived_at IS
  'Set seven days after the deal reached Won or Lost, by /cron/crm. NOT a '
  'delete: archived deals still count in every revenue figure. NULL means live '
  'on the board.';
