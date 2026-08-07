-- 127_connector_credentials.sql — where a network's app credentials live.
--
-- ── WHY THIS TABLE DID NOT EXIST ────────────────────────────────────────────
--
-- Every OAuth connector in `routers/hub_publish.py` reads its app id and secret
-- from an ENVIRONMENT VARIABLE — `META_APP_ID`, `LINKEDIN_CLIENT_SECRET`, and so
-- on. Measured on staging 2026-08-07: not one of them is set, so no OAuth flow
-- in the product can complete. There is no screen to set them either, because
-- there is nowhere to put them: `staging.hub_social_accounts` holds CONNECTED
-- ACCOUNTS and their tokens, which is the other end of the flow entirely.
--
-- That also fixes the whole platform to ONE app per network. An agency running
-- its own Meta app on behalf of a client that has its own cannot express it.
--
-- ── BOTH LEVELS, AND THE ORDER BETWEEN THEM ─────────────────────────────────
--
-- The owner's decision: Aekam-level defaults AND a per-client override. So a row
-- is identified by (org_id, client_id, platform) with client_id NULLABLE:
--
--     client_id IS NOT NULL   this client's own app for this network
--     client_id IS NULL       the org's default for this network
--
-- Resolution is per-client, then org, then the environment variable — see
-- `services/connector_credentials.resolve`. The env var stays LAST rather than
-- being deleted, so nothing that works today stops working the day this ships.
--
-- Two partial unique indexes rather than one constraint, because `UNIQUE (org_id,
-- client_id, platform)` does not constrain the org-level row at all: NULL is not
-- equal to NULL in a unique index, so an org could accumulate any number of
-- "defaults" for one platform and the resolver would pick whichever came back
-- first.
--
-- ── SECRETS ─────────────────────────────────────────────────────────────────
--
-- `secrets_encrypted` is one Fernet-encrypted JSON object, written by
-- `services/encryption.encrypt`, holding EVERY secret field for the platform —
-- a client secret, an app secret, a permanent token, whatever that network's
-- form declares. One column rather than one per field, because the fields differ
-- per platform and a schema that enumerated them would need a migration every
-- time a network changed its console.
--
-- It is never selected by any list endpoint and never returned to a browser. The
-- API returns `has_secret` and the last four characters, which is enough for an
-- operator to tell whether the value on screen is the one in their console.
--
-- `public_fields` is plain JSONB and deliberately NOT encrypted: an app id, a
-- WhatsApp phone-number id, a page id. Encrypting a value the network prints on
-- its own dashboard buys nothing and makes it unsearchable.
--
-- ── STAGING AND PRODUCTION SHARE THIS SCHEMA ────────────────────────────────
--
-- Applying this applies it to production. It is additive — one new table, no
-- column dropped, no existing row touched, no default that rewrites anything —
-- so the blast radius is a table nothing reads until the code that reads it
-- deploys. Approved by the owner 2026-08-07.

CREATE TABLE IF NOT EXISTS staging.hub_connector_credentials (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id            UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    -- NULL = the org's default for this platform. Set = one client's override.
    client_id         UUID REFERENCES staging.hub_clients(id) ON DELETE CASCADE,

    platform          TEXT NOT NULL,

    -- App ids, page ids, phone number ids. Printed on the network's own console.
    public_fields     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- One Fernet token over a JSON object. NULL until a secret is saved.
    secrets_encrypted TEXT,
    -- The last four characters of the primary secret, in clear, so the screen can
    -- say "…4f2a" without the value ever leaving the server. Never enough to use.
    secret_hint       TEXT NOT NULL DEFAULT '',

    -- Off by default. A half-filled form must not start being used the moment
    -- somebody saves the first field of it.
    is_active         BOOLEAN NOT NULL DEFAULT FALSE,

    -- What the last "Test connection" said, and when. Stored rather than derived
    -- so the card is honest on first paint instead of blank until someone presses
    -- the button again.
    last_tested_at    TIMESTAMPTZ,
    last_test_ok      BOOLEAN,
    last_test_detail  TEXT NOT NULL DEFAULT '',

    created_by        TEXT,
    updated_by        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One override per (client, platform).
CREATE UNIQUE INDEX IF NOT EXISTS hub_connector_credentials_client_uq
    ON staging.hub_connector_credentials (client_id, platform)
    WHERE client_id IS NOT NULL;

-- One default per (org, platform). Partial and NULL-aware — see the note above.
CREATE UNIQUE INDEX IF NOT EXISTS hub_connector_credentials_org_uq
    ON staging.hub_connector_credentials (org_id, platform)
    WHERE client_id IS NULL;

-- The resolver's read: every candidate row for one org, one platform, both
-- levels, in one query.
CREATE INDEX IF NOT EXISTS hub_connector_credentials_lookup
    ON staging.hub_connector_credentials (org_id, platform, client_id);
