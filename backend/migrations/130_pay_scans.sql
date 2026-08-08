-- 130_pay_scans.sql — P6. Who opened a payment link, and on what.
--
-- ── Why this table exists at all ────────────────────────────────────────────
--
-- There is no payment gateway in this product and there never will be, so
-- nothing tells the firm that a customer TRIED to pay. Today an unpaid invoice
-- and an unpaid invoice whose link was opened four times yesterday look
-- identical in the ledger. They are not the same thing: the second is a
-- customer who intended to pay and something stopped them, and it is the single
-- most useful signal a gateway-less flow can produce.
--
-- ── This is NOT payment confirmation and must never be shown as one ─────────
--
-- A scan means a code was rendered. It does not mean an app opened, money
-- moved, or a bank accepted anything. "Paid" comes only from bank
-- reconciliation. Any screen built on this says "opened" or "viewed", never
-- "paying" — a firm that stops chasing a debt because a row appeared here has
-- been actively misled.
--
-- ── DPDP ───────────────────────────────────────────────────────────────────
--
-- The subject is the org's CUSTOMER, who never signed up to this product and
-- cannot see what it stores. So:
--
--   · the IP is stored TRUNCATED FROM THE START — /24 for IPv4, /48 for IPv6.
--     The original is never written. The design note said "full IP for 30 days,
--     then truncate", and a retention job that has to run correctly for ever to
--     stay lawful is a worse design than one that never holds the data. A /24
--     supports the only real use ("is this the same office?") and identifies
--     nobody on its own.
--   · no cookie, no device id, no fingerprint. `device`, `os` and `browser` are
--     three coarse buckets parsed from the User-Agent, not the string itself.
--   · a `city` column exists but NOTHING WRITES IT — there is no geo-IP
--     provider wired up. It is here so the shape does not change later, and it
--     will read NULL until someone decides to add one, which is a DPDP decision
--     and not a code change.
--
-- Needs a line in the privacy notice before the first row is written.
--
-- ── Safety ─────────────────────────────────────────────────────────────────
-- Staging and production share ONE Supabase instance. Additive: one new table
-- and two nullable columns. Nothing deployed today writes or reads either.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS staging.ganit_pay_scans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The invoice, resolved server-side from the token. The TOKEN ITSELF IS
    -- NOT STORED: it is a bearer capability, and a copy of it in a second table
    -- is a second place it can leak from. The row already points at the invoice.
    invoice_id  UUID NOT NULL REFERENCES staging.ganit_invoices(id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- WHICH of the org's accounts the payer chose. Since migration 129 this is
    -- a fact rather than a guess: the customer pressed the PhonePe button, so
    -- the money — if it moves — lands in the PhonePe account. The old plan
    -- inferred the service from the payer's handle, which is wrong for anyone
    -- paying a PhonePe address from Google Pay.
    platform    TEXT CHECK (platform IS NULL OR platform IN
                    ('phonepe', 'gpay', 'paytm', 'bhim', 'amazonpay', 'other')),

    -- 'view'   the page was opened
    -- 'qr'     the QR was rendered (desktop)
    -- 'app'    a pay button was pressed and a UPI app was handed the request
    -- 'invoice' the line items were opened
    outcome     TEXT NOT NULL CHECK (outcome IN ('view', 'qr', 'app', 'invoice')),

    device      TEXT CHECK (device  IS NULL OR device  IN ('phone', 'tablet', 'desktop')),
    os          TEXT CHECK (os      IS NULL OR os      IN ('android', 'ios', 'windows', 'mac', 'other')),
    browser     TEXT CHECK (browser IS NULL OR browser IN ('chrome', 'safari', 'firefox', 'edge', 'other')),

    -- Already truncated when it arrives. See the DPDP note above.
    ip_prefix   TEXT,
    city        TEXT,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The Collections view asks "which unpaid invoices have been opened, and when
-- last" — one query per org over a date range, newest first.
CREATE INDEX IF NOT EXISTS ix_pay_scans_org_time
    ON staging.ganit_pay_scans (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_pay_scans_invoice
    ON staging.ganit_pay_scans (invoice_id, created_at DESC);

-- ── Attribution on the payment itself ───────────────────────────────────────
-- Filled in by whoever records the payment, from the bank statement. Both
-- nullable for ever: 505 payments already exist with neither, and a cash
-- payment has no UPI anything.
ALTER TABLE staging.ganit_payments
    -- Which of the org's own accounts received it. NOT the payer's handle:
    -- that identifies the customer's bank and belongs to them, not to us.
    ADD COLUMN IF NOT EXISTS received_on TEXT,
    -- 'link'      the customer used the shared invoice link
    -- 'manual'    entered by hand with no link involved
    -- 'inferred'  matched to a scan by amount and date — a GUESS, and named
    --             one, so a report can exclude it rather than quietly counting
    --             it as measured fact
    ADD COLUMN IF NOT EXISTS attribution TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='staging' AND table_name='ganit_payments'
                      AND column_name='attribution') THEN
        RAISE EXCEPTION 'ganit_payments.attribution was not added';
    END IF;
    IF to_regclass('staging.ganit_pay_scans') IS NULL THEN
        RAISE EXCEPTION 'ganit_pay_scans was not created';
    END IF;
    RAISE NOTICE 'pay scans ready; % existing payments carry no attribution, which is correct',
        (SELECT count(*) FROM staging.ganit_payments WHERE attribution IS NULL);
END $$;

COMMIT;
