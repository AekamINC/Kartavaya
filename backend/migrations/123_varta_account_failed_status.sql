-- =====================================================================
-- 123_varta_account_failed_status.sql
--
-- NOT APPLIED. Written 2026-08-06 by the Varta connect-flow work and left
-- for whoever runs migrations. Read the whole header before applying it —
-- there is one `staging` schema and production writes to it too, so this
-- is a production change.
--
-- WHY
--   The Accounts tab has to show four states for a WhatsApp Business
--   number: not connected, pending, connected, failed.
--
--     not connected  the absence of a row
--     pending        the six values are stored, Meta has not yet completed
--                    the webhook handshake against the verify token
--     connected      status='active' — set by GET /whatsapp/webhook when
--                    Meta verifies the subscription
--     failed         the number is connected but cannot send
--
--   `staging.varta_business_accounts.status` (058_sanvaad_messaging.sql:99)
--   allows only ('pending','active','suspended'). There is nowhere to put
--   the fourth state, so `routers/whatsapp._mark_account_failed` currently
--   writes 'failed' and, if the CHECK rejects it, falls back to
--   'suspended' — which the UI already renders with the same "Connection
--   failed" chip and the same "Disconnect and reconnect" instruction.
--
--   That fallback is why the router is safe to deploy BEFORE this file is
--   applied, and why applying it is not urgent. What it buys is the
--   distinction between a number WE disabled (suspended, an operator
--   action that does not exist yet) and one that broke on its own
--   (failed) — a distinction support will want the first time an org says
--   "we didn't touch it".
--
-- WHAT IT DOES
--   Widens one CHECK constraint. It adds no column, drops nothing, and
--   rewrites no row. `varta_business_accounts` holds a handful of rows per
--   org, so the table scan Postgres does to re-validate the constraint is
--   instantaneous — but it does take an ACCESS EXCLUSIVE lock for the
--   duration, which on this table means microseconds.
--
-- RISK
--   Low, and one-directional: the new constraint is strictly weaker than
--   the old one, so every existing row already satisfies it and no
--   currently-legal value becomes illegal.
--
-- ROLLBACK
--   Safe only while no row holds 'failed'. Reverting with rows in that
--   state fails validation, which is the correct outcome — move them to
--   'suspended' first, deliberately:
--
--     UPDATE staging.varta_business_accounts
--        SET status='suspended' WHERE status='failed';
--     ALTER TABLE staging.varta_business_accounts
--       DROP CONSTRAINT varta_business_accounts_status_check;
--     ALTER TABLE staging.varta_business_accounts
--       ADD CONSTRAINT varta_business_accounts_status_check
--       CHECK (status IN ('pending','active','suspended'));
--
-- IDEMPOTENT
--   Re-running is a no-op: the DROP is IF EXISTS and the ADD is guarded on
--   the constraint not already being present.
-- =====================================================================

BEGIN;

ALTER TABLE staging.varta_business_accounts
  DROP CONSTRAINT IF EXISTS varta_business_accounts_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'varta_business_accounts_status_check'
      AND conrelid = 'staging.varta_business_accounts'::regclass
  ) THEN
    ALTER TABLE staging.varta_business_accounts
      ADD CONSTRAINT varta_business_accounts_status_check
      CHECK (status IN ('pending','active','suspended','failed'));
  END IF;
END $$;

COMMIT;
