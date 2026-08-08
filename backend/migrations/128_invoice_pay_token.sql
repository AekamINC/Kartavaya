-- 128_invoice_pay_token.sql
--
-- P1 of the shared invoice link. Gives every invoice a short, opaque, random,
-- unique handle so `pay.kartavaya.com/i/{token}` can address one invoice
-- without exposing anything about it.
--
-- ── Why not the invoice UUID ────────────────────────────────────────────────
--
-- Because the link is FORWARDED. It goes into a WhatsApp thread, gets copied
-- into an email, and ends up in a group. The id in that URL is a permanent
-- capability, so it must be a value that exists for no other purpose: a UUID
-- primary key is already accepted by `GET /clients/{id}`-shaped routes all over
-- this API, and the day one of those loses a gate the leaked token is also a
-- valid object id. A token with exactly one meaning cannot be replayed against
-- anything else.
--
-- 12 random bytes, base64url, 16 characters. 96 bits: at 759 invoices today and
-- a million a long way off, a collision is not a thing that happens, and the
-- UNIQUE index below is the proof rather than the hope. Short enough to read
-- aloud down a phone, which is a real thing an accounts clerk in Mumbai will do.
--
-- ── Why the DEFAULT is on the column, not in Python ─────────────────────────
--
-- `ganit.py` is not the only writer — recurring invoices, the estimate→invoice
-- conversion and any future importer all INSERT here. A default in one code
-- path is a NULL token from every other, and a NULL token is an invoice that
-- cannot be sent. The database is the only place that covers all of them, and
-- the NOT NULL makes forgetting impossible rather than unlikely.
--
-- ── Order of operations, and why it is this order ───────────────────────────
--
-- `gen_random_bytes` is VOLATILE. Adding a column WITH a volatile default
-- rewrites the whole table and holds ACCESS EXCLUSIVE for the duration — on a
-- table every invoice screen reads. So:
--
--   1. ADD COLUMN with NO default        catalog only, no rewrite, microseconds
--   2. UPDATE to backfill                 759 rows, ordinary row locks
--   3. SET DEFAULT                        catalog only
--   4. SET NOT NULL + UNIQUE index        one scan of a 759-row table
--
-- Splitting it this way is the difference between a lock held for microseconds
-- and one held for a full table rewrite.
--
-- ── Blast radius ────────────────────────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Applying this reaches production
-- the moment it runs. It is additive only: no column is dropped, no existing
-- value is rewritten, no constraint is placed on anything that already exists.
-- Every current query keeps working untouched — nothing SELECTs `*` into a
-- fixed-width model here, and a new nullable-then-populated column is invisible
-- to `INSERT` statements that name their columns, which all of them do.
--
-- The one irreversible thing is the tokens themselves: re-running section 2
-- would MINT NEW TOKENS and silently break every link already sent. It is
-- guarded by `WHERE pay_token IS NULL` for exactly that reason. Do not remove
-- that predicate to "refresh" anything.
--
-- Rollback is `DROP COLUMN pay_token`, which loses every issued link.

BEGIN;

-- Inside the transaction: SET LOCAL outside one is a no-op with a warning, so
-- the protection it is here to give would silently not exist. Turns a queued
-- ACCESS EXCLUSIVE behind a long-running reader into a clean rollback instead
-- of a stall on every invoice screen in the product.
SET LOCAL lock_timeout = '5s';

-- ── 0. Guard ────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'staging' AND table_name = 'ganit_invoices'
    ) THEN
        RAISE EXCEPTION 'staging.ganit_invoices does not exist — wrong database?';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
        RAISE EXCEPTION 'pgcrypto is required for gen_random_bytes';
    END IF;
END $$;


-- ── 1. The generator ────────────────────────────────────────────────────────
--
-- base64url: `+` and `/` are not safe in a URL path segment. 12 bytes divides
-- by 3, so base64 emits no `=` padding and the result is exactly 16 characters
-- with no stripping needed — which is why 12 and not 10.
--
-- VOLATILE (the default) and deliberately not marked otherwise: it must return
-- a different value on every call, and labelling it IMMUTABLE to make it
-- index-eligible would license the planner to call it once.
CREATE OR REPLACE FUNCTION staging.gen_pay_token()
RETURNS TEXT
LANGUAGE SQL
AS $$
    SELECT translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_');
$$;

COMMENT ON FUNCTION staging.gen_pay_token() IS
    'Opaque 16-char base64url handle for a public pay link. Never derived from '
    'the invoice id — see migration 128.';


-- ── 2. The column, added cheaply then filled ────────────────────────────────
ALTER TABLE staging.ganit_invoices
    ADD COLUMN IF NOT EXISTS pay_token TEXT;

-- `WHERE pay_token IS NULL` is load-bearing, not defensive: without it a replay
-- re-mints every token and kills every link already sent to a customer.
UPDATE staging.ganit_invoices
SET    pay_token = staging.gen_pay_token()
WHERE  pay_token IS NULL;


-- ── 3. Make it automatic, and make it required ──────────────────────────────
ALTER TABLE staging.ganit_invoices
    ALTER COLUMN pay_token SET DEFAULT staging.gen_pay_token();

ALTER TABLE staging.ganit_invoices
    ALTER COLUMN pay_token SET NOT NULL;

-- UNIQUE is the collision proof. It is also the lookup index `GET /pay/{token}`
-- needs — one index, both jobs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ganit_invoices_pay_token
    ON staging.ganit_invoices (pay_token);

COMMENT ON COLUMN staging.ganit_invoices.pay_token IS
    'Public handle for pay.kartavaya.com/i/{token}. Opaque, unique, never the '
    'invoice id. Generated by DEFAULT so every writer gets one.';


-- ── 4. Verification — must print 759-and-rising, 0, 0 ───────────────────────
DO $$
DECLARE
    total   BIGINT;
    missing BIGINT;
    dupes   BIGINT;
    badlen  BIGINT;
BEGIN
    SELECT COUNT(*) INTO total   FROM staging.ganit_invoices;
    SELECT COUNT(*) INTO missing FROM staging.ganit_invoices WHERE pay_token IS NULL;
    SELECT COUNT(*) INTO dupes   FROM (
        SELECT pay_token FROM staging.ganit_invoices
        GROUP BY pay_token HAVING COUNT(*) > 1
    ) d;
    SELECT COUNT(*) INTO badlen  FROM staging.ganit_invoices
        WHERE length(pay_token) <> 16 OR pay_token ~ '[^A-Za-z0-9_-]';

    RAISE NOTICE 'ganit_invoices: % rows, % missing token, % duplicates, % malformed',
        total, missing, dupes, badlen;

    IF missing > 0 OR dupes > 0 OR badlen > 0 THEN
        RAISE EXCEPTION 'pay_token backfill failed verification — rolling back';
    END IF;
END $$;

COMMIT;
