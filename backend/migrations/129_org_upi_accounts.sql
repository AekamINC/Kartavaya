-- 129_org_upi_accounts.sql — one receiving UPI address PER PLATFORM.
--
-- ── Why a table and not the column that already exists ──────────────────────
--
-- `staging.organisations.upi_vpa` (migration 096) holds ONE address. A firm
-- holds separate accounts with Paytm, PhonePe and Google Pay, each settling and
-- reporting separately, and picks which one receives. One column cannot express
-- that, in the same way `users.role` cannot express a per-org fact.
--
-- UPI's interoperability does not remove the need for this. It means anyone can
-- PAY you from any app; it says nothing about how many accounts you HOLD.
--
-- ── `organisations.upi_vpa` STAYS, as the default row's mirror ──────────────
--
-- Migration 096 demoted `monthly_price` the same way rather than dropping it,
-- and for the same reason: `routers/pay.py`, `admin_orgs.py` and
-- `subscription.py` all read the column today. Dropping it is a deploy where
-- the old code is briefly live against the new schema, and what breaks is the
-- payment page. The API writes both; the column is never the source of truth
-- again, and this file does not remove it.
--
-- ── Safety ─────────────────────────────────────────────────────────────────
--
-- Staging and production share ONE Supabase instance, so this reaches
-- production the moment it runs. It is additive: a new table plus a backfill
-- that only READS `organisations`. No existing row is modified and no existing
-- column is altered, so nothing deployed today can observe this.
--
-- Re-running is safe. The backfill is `ON CONFLICT DO NOTHING`, so a replay
-- cannot overwrite an address an org has since set through the screen — the
-- same trap `128`'s `WHERE pay_token IS NULL` was avoiding.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS staging.org_upi_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- Kept in step with `services/upi.py::PLATFORMS`. A CHECK rather than a
    -- lookup table: the list is short, closed, and changes with a code deploy
    -- that has to know about it anyway.
    platform    TEXT NOT NULL CHECK (platform IN
                    ('phonepe', 'gpay', 'paytm', 'bhim', 'amazonpay', 'other')),

    -- `identifier@handle`. Loose on purpose — handles are issued by dozens of
    -- PSPs and an allow-list of suffixes would reject working addresses. The
    -- real check is the org scanning its own QR, which the screen makes it do.
    vpa         TEXT NOT NULL CHECK (vpa ~ '^[a-zA-Z0-9._\-]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$'),

    -- What the payer sees in their app before confirming. Blank falls back to
    -- the organisation's name at read time rather than being copied in here,
    -- so a firm renaming itself does not have to re-save six rows.
    payee_name  TEXT CHECK (payee_name IS NULL OR length(payee_name) <= 60),

    -- OFF is not the same as absent. An org whose PhonePe account is temporarily
    -- out of use switches it off and keeps the address; deleting the row would
    -- lose it and invite a retype, which is where a wrong digit comes from.
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,

    -- The one used for "Other UPI app", for the desktop QR, and for anything
    -- that needs a single answer.
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,

    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One address per platform per org. Two rows for "PhonePe" is a form that
-- disagrees with itself, and whichever the page happened to read first would
-- silently win.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_upi_accounts_org_platform
    ON staging.org_upi_accounts (org_id, platform);

-- AT MOST ONE DEFAULT PER ORG, enforced here and not only in the API.
-- Two defaults means "Other UPI app" pays a different account depending on row
-- order — a bug that moves real money and would never reproduce on demand.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_upi_accounts_one_default
    ON staging.org_upi_accounts (org_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS ix_org_upi_accounts_org
    ON staging.org_upi_accounts (org_id) WHERE is_active;

-- ── Backfill: the existing single address becomes the default row ───────────
-- Filed under 'other' because the column never recorded WHICH platform it was.
-- Guessing from the handle suffix would be exactly the inference this whole
-- migration exists to stop doing.
INSERT INTO staging.org_upi_accounts (org_id, platform, vpa, payee_name, is_default, sort_order)
SELECT o.id, 'other', lower(trim(o.upi_vpa)), NULLIF(trim(o.upi_payee_name), ''), TRUE, 0
  FROM staging.organisations o
 WHERE o.upi_vpa IS NOT NULL
   AND trim(o.upi_vpa) <> ''
   AND lower(trim(o.upi_vpa)) ~ '^[a-zA-Z0-9._\-]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$'
ON CONFLICT (org_id, platform) DO NOTHING;

DO $$
DECLARE
    n_dupes INTEGER;
    n_bad   INTEGER;
BEGIN
    SELECT count(*) INTO n_dupes FROM (
        SELECT org_id FROM staging.org_upi_accounts
         WHERE is_default GROUP BY org_id HAVING count(*) > 1) d;
    IF n_dupes > 0 THEN
        RAISE EXCEPTION 'org_upi_accounts: % orgs have more than one default', n_dupes;
    END IF;

    SELECT count(*) INTO n_bad FROM staging.org_upi_accounts
     WHERE vpa <> lower(trim(vpa));
    IF n_bad > 0 THEN
        RAISE EXCEPTION 'org_upi_accounts: % rows are not normalised', n_bad;
    END IF;

    RAISE NOTICE 'org_upi_accounts: % rows',
        (SELECT count(*) FROM staging.org_upi_accounts);
END $$;

COMMIT;
