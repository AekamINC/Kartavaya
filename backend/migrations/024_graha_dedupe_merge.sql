-- ============================================================
-- Migration 024: Graha contact dedupe + merge
-- Prerequisite for Sanvaad (WhatsApp), enrichment, and scan-capture —
-- every one of those adds a new inbound source that can create duplicates.
--
-- Ships three things:
--   1. Normalized match keys (email_norm, phone_norm) + indexes
--   2. merged_into_id on contacts (losers are soft-merged, never deleted)
--   3. graha_contact_merges — audit trail + undo payload
-- ============================================================

-- Trigram matching for fuzzy name/company comparison.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ═══════════════════════════════════════════════════════════
-- 1. Normalized match keys
-- ═══════════════════════════════════════════════════════════

-- Email: lowercased + trimmed; '' collapses to NULL so blanks never match.
ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS email_norm TEXT
    GENERATED ALWAYS AS (NULLIF(lower(trim(email)), '')) STORED;

-- Phone: strip every non-digit, keep the last 10.
-- India is a fixed 10-digit subscriber space, so this collapses
-- +91 98765 43210 / 0098765-43210 / 098765 43210 / 9876543210 to one key.
-- Guard on length >= 10 first: right('123', 10) returns '123', which would
-- make short/garbage numbers match each other.
ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS phone_norm TEXT
    GENERATED ALWAYS AS (
        CASE
            WHEN length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) >= 10
            THEN right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10)
            ELSE NULL
        END
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_graha_contacts_email_norm
    ON staging.graha_contacts(org_id, email_norm)
    WHERE email_norm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_graha_contacts_phone_norm
    ON staging.graha_contacts(org_id, phone_norm)
    WHERE phone_norm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_graha_contacts_name_trgm
    ON staging.graha_contacts USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_graha_contacts_company_trgm
    ON staging.graha_contacts USING gin (company gin_trgm_ops);


-- ═══════════════════════════════════════════════════════════
-- 2. Soft-merge pointer
-- ═══════════════════════════════════════════════════════════
-- A merged contact is NOT deleted. It keeps its row, gets is_active=FALSE
-- and merged_into_id set. That preserves the undo path and honours the
-- never-silently-destroy-data convention.

ALTER TABLE staging.graha_contacts
    ADD COLUMN IF NOT EXISTS merged_into_id UUID
    REFERENCES staging.graha_contacts(id);

CREATE INDEX IF NOT EXISTS idx_graha_contacts_merged_into
    ON staging.graha_contacts(merged_into_id)
    WHERE merged_into_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════
-- 3. Merge audit + undo
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.graha_contact_merges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    survivor_id UUID NOT NULL REFERENCES staging.graha_contacts(id),
    merged_id UUID NOT NULL REFERENCES staging.graha_contacts(id),

    -- {"staging.graha_deals": ["<uuid>", ...], ...} — rows re-pointed to the
    -- survivor, so undo knows exactly which to send back.
    moved_rows JSONB NOT NULL DEFAULT '{}',

    -- {"email": {"from": null, "to": "a@b.com"}, ...} — survivor fields
    -- backfilled from the loser, so undo can revert them.
    field_updates JSONB NOT NULL DEFAULT '{}',

    -- Rows deleted because re-pointing them would breach a unique constraint
    -- (e.g. both contacts carried the same label). Full row snapshots.
    dropped_rows JSONB NOT NULL DEFAULT '{}',

    actor_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by UUID
);

CREATE INDEX IF NOT EXISTS idx_graha_merges_org
    ON staging.graha_contact_merges(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_graha_merges_survivor
    ON staging.graha_contact_merges(survivor_id);


-- ═══════════════════════════════════════════════════════════
-- 4. Repair: drop the unique index 022 intended but never created
-- ═══════════════════════════════════════════════════════════
-- Migration 022 declared:
--     CREATE UNIQUE INDEX idx_graha_contacts_org_phone
--         ON staging.graha_contacts(org_id, phone) WHERE phone IS NOT NULL AND phone != '';
-- It is absent from the live DB, so the ON CONFLICT (org_id, phone) clause in
-- the /inbound-leads insert had no matching index and raised at plan time.
--
-- We deliberately do NOT create it. Hard-uniqueness on phone is wrong for a CRM:
--   * two people at one company legitimately share a landline;
--   * a soft-merged loser keeps its phone, so survivor+loser would collide;
--   * raw `phone` is unnormalized, so it would not have caught +91 variants anyway.
-- Duplicates are surfaced for human review instead of silently blocked.
-- The ON CONFLICT clause is removed from graha.py in this change.
DROP INDEX IF EXISTS staging.idx_graha_contacts_org_phone;
