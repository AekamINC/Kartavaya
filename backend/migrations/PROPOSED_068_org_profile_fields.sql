-- PROPOSED — the four company-profile fields TabProfile.jsx refuses to render.
-- Review before running. NOT APPLIED by whoever merges this.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY
-- ═════════════════════════════════════════════════════════════════════════════
-- `frontend/src/pages/org/TabProfile.jsx` deliberately omits `description`,
-- `industry`, `team_size` and `founded_year`, and says why in its header:
-- pydantic drops unknown keys silently, so a control for any of them would
-- report "saved" and lose the text on reload. `10-org-settings.md` §4 lists the
-- same four as the change needed on `PATCH /v1/org/profile`.
--
-- VERIFIED against the live database before writing this: `staging.organisations`
-- has 32 columns and none of them is any of these four.
--
-- `backend/routers/org_profile.py` now declares all four on `ProfileUpdate`. It
-- PROBES `information_schema` rather than assuming these columns exist, so the
-- router is safe to deploy before this runs — GET returns the four as NULL and
-- PATCH naming one returns 503 pointing at this file. Applying this switches
-- them on with no redeploy.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- RISK: LOW
-- ═════════════════════════════════════════════════════════════════════════════
--   Schema        : staging.organisations. NOT a `public.*` table, so it is off
--                   production's data path.
--   Rows affected : 0 rewritten. All four columns are nullable or carry a
--                   constant default, so Postgres 11+ stores the default in the
--                   catalogue and does NOT rewrite the table. No long lock.
--   Blocking      : ADD COLUMN takes ACCESS EXCLUSIVE briefly. The table is
--                   small (one row per organisation). Sub-second.
--   Reversible    : Yes, completely — see ROLLBACK. Nothing reads these columns
--                   except the router added alongside, and that router tolerates
--                   their absence, so dropping them cannot break a running API.
--   Data loss     : None on apply. Rollback DROPs the columns and therefore
--                   discards anything typed into them — take a copy first if
--                   anyone has saved a description.
--   Shared project: staging and production share one Supabase project. This
--                   file touches `staging.*` only. Do not retarget it.

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS description  TEXT     NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS industry     TEXT     NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS team_size    TEXT     NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS founded_year SMALLINT;

-- `founded_year` is the only one that is genuinely nullable: '' is a sensible
-- "not filled in" for text and 0 is not a sensible year. Every other profile
-- column added in 047 (`email`, `phone`, `website`, `invoice_note`) uses the
-- same NOT NULL DEFAULT '' shape, so this matches its neighbours.

COMMENT ON COLUMN staging.organisations.description IS
    'Free-text company blurb from organisation settings. Capped at 2000 '
    'characters by ProfileUpdate and by the CHECK below — the cap exists so an '
    'over-long paste is a 400 naming the field rather than a row-size surprise.';

COMMENT ON COLUMN staging.organisations.industry IS
    'Free text, not an enum. An enum here would need a list of Indian '
    'accounting-firm verticals that nobody has agreed, and a wrong enum '
    'rejects the customer''s own description of themselves.';

COMMENT ON COLUMN staging.organisations.team_size IS
    'TEXT, not INTEGER. The design says "team size" without saying whether the '
    'control is a count or a band; TEXT accepts "12" and "11-50", INTEGER '
    'rejects the band. Widening later is a migration, narrowing is data loss.';

COMMENT ON COLUMN staging.organisations.founded_year IS
    'Year the firm was founded. Range-checked in ProfileUpdate so a typo is a '
    '400; the CHECK below is defence in depth for direct SQL.';

-- Defence in depth. The router validates first and returns a 400 naming the
-- field, so these fire only for a write that bypassed it.
ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_description_len;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_description_len
    CHECK (char_length(description) <= 2000);

ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_industry_len;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_industry_len
    CHECK (char_length(industry) <= 120);

ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_team_size_len;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_team_size_len
    CHECK (char_length(team_size) <= 40);

-- NULL passes a CHECK, so "not filled in" stays legal without a special case.
ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_founded_year_range;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_founded_year_range
    CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2200);

-- 2200 rather than "this year + 1": a CHECK cannot reference now() and stay
-- IMMUTABLE, and a constraint that has to be rewritten every January is a
-- constraint that will be forgotten. The tight bound lives in ProfileUpdate,
-- which can compute it; this one only has to catch nonsense.

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═════════════════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema='staging' AND table_name='organisations'
--    AND column_name IN ('description','industry','team_size','founded_year');
-- Expect four rows. The router's probe picks them up on the next request.

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════════════════
-- Drops the columns and everything stored in them. The router keeps working:
-- its probe finds the columns gone and returns to NULL / 503.
--
-- ALTER TABLE staging.organisations
--     DROP CONSTRAINT IF EXISTS organisations_description_len,
--     DROP CONSTRAINT IF EXISTS organisations_industry_len,
--     DROP CONSTRAINT IF EXISTS organisations_team_size_len,
--     DROP CONSTRAINT IF EXISTS organisations_founded_year_range;
--
-- ALTER TABLE staging.organisations
--     DROP COLUMN IF EXISTS description,
--     DROP COLUMN IF EXISTS industry,
--     DROP COLUMN IF EXISTS team_size,
--     DROP COLUMN IF EXISTS founded_year;
