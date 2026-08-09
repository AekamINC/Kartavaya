-- Custom fields on five CRM records, not two.
--
-- Owner, 2026-08-09: "needs more option not just contact and deals".
--
-- `graha_custom_fields.entity_type` is CHECKed against ('contact','deal'), so
-- the tab cannot even offer anything else. The three added here are the CRM
-- records a user actually fills in by hand:
--
--   client     — the company. The most-asked-for of the three: industry,
--                account manager, credit terms, onboarding date.
--   activity   — what was discussed. Call outcome, competitor named, sentiment.
--   follow_up  — the next step. Channel, blocker, promised-by.
--
-- NOT added: territory (org config, not a record a user fills in per row),
-- label (it is one word by definition), and web form (its fields ARE its
-- definition — a custom field on it would be a field on a field).
--
-- Each of the three needs the same `custom_data JSONB` that migration 023 gave
-- contacts and deals. The column is where the VALUES live; the definitions
-- stay in one table for all five.
--
-- NOT APPLIED. Staging and production share one database, so this runs only on
-- your say-so. Until it does, `create_custom_field` still refuses the three new
-- entity types — the router's list and this CHECK are deliberately the same
-- five names, so a mismatch fails loudly at the API rather than silently at the
-- database.

BEGIN;

ALTER TABLE staging.graha_custom_fields
    DROP CONSTRAINT IF EXISTS graha_custom_fields_entity_type_check;

ALTER TABLE staging.graha_custom_fields
    ADD CONSTRAINT graha_custom_fields_entity_type_check
    CHECK (entity_type IN ('contact', 'deal', 'client', 'activity', 'follow_up'));

ALTER TABLE staging.graha_clients
    ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

ALTER TABLE staging.graha_activities
    ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

ALTER TABLE staging.graha_follow_ups
    ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

COMMIT;
