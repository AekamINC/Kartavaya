-- 196 · Pahchan policy overrides — org → site → category → employee.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `staging.pahchan_policy` is keyed on `org_id` and nothing else, so a firm has
-- ONE attendance policy for everybody. Measured live 2026-08-22: 2 policy rows,
-- 9 sites, 1,659 punches.
--
-- One radius for every site is the clearest failure. A 150m fence is generous
-- around a city office and useless around a factory compound, and an org that
-- widens it for the compound has just widened it for the office too. The same
-- applies to every other figure in that row: a shift that starts at 09:00 for
-- staff and 07:00 for plant, a grace period that is ten minutes for salaried
-- people and zero for contractors on an hourly rate.
--
-- Four scopes, most specific wins:
--
--     org  →  site  →  category  →  employee
--
-- `category` is `manav_employees.employment_type` — the column that already
-- exists and already separates the people whose attendance rules genuinely
-- differ. It is NOT a new taxonomy: inventing one here would mean an HR admin
-- maintaining a second classification of the same people, which is how two
-- classifications come to disagree.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT, AND THE TWO DECISIONS INSIDE IT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── 1 · PARTIAL overrides, not a second copy of the policy row ─────────────
--
-- `overrides` is a jsonb object holding ONLY the keys this scope changes. The
-- alternative — a full policy row per scope — looks tidier and is wrong: a
-- site override written today would freeze every other setting at the value it
-- had today, so an org that later shortens its grace period across the firm
-- would find that one site silently kept the old one. Nobody would find that
-- for months, because the screen would show the new value and the punch would
-- be judged by the old.
--
-- ── 2 · NOT EVERY FIELD MAY BE OVERRIDDEN ─────────────────────────────────
--
-- Retention and reporting stay org-level, and the CHECK below enforces it:
--
--     punch_photo_retention_days, reference_photo_grace_days,
--     record_retention_years, report_recipients, report_daily,
--     report_weekly, report_monthly
--
-- Retention is a DPDP promise made to every person in the organisation, in one
-- notice, quoting one number. `GET /v1/pahchan/me` serves that number and
-- `_retention` exists precisely because a notice quoting a figure that is not
-- the one in force has already shipped once here. A per-employee retention
-- window would mean the notice is wrong for somebody by construction, and they
-- would be the last to know. Reporting is a commercial arrangement with the
-- org, not a fact about a site.
--
-- What MAY be overridden is everything that decides how a punch is judged and
-- what a working day is: radius, grace, geofence tolerance, accuracy
-- threshold, standard hours, the overtime block, week start and the shift.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Purely additive: ONE new table, two indexes, no ALTER, no DML. Staging and
-- production share one Supabase database, so this is a production schema
-- change — but nothing reads this table until the resolver ships, and an org
-- with no rows in it resolves exactly the policy it resolves today. That is
-- the migration's whole safety property: an empty table is the current
-- behaviour, byte for byte.
--
-- NO FOREIGN KEYS, deliberately, and this is not laziness. `scope_ref` holds
-- three different kinds of value depending on `scope_kind` — a site id, an
-- `employment_type` string, an employee id — so there is no single table to
-- point at. The resolver treats a row naming something that no longer exists
-- as a row that matches nothing, which is the correct behaviour for a deleted
-- site: it stops applying, rather than taking the punch with it.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.pahchan_policy_overrides (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL,

    --  'site'      → scope_ref is a staging.pahchan_sites.id
    --  'category'  → scope_ref is a manav_employees.employment_type value
    --  'employee'  → scope_ref is a staging.manav_employees.id
    scope_kind  text        NOT NULL,
    scope_ref   text        NOT NULL,

    overrides   jsonb       NOT NULL DEFAULT '{}'::jsonb,

    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    updated_by  text,

    CONSTRAINT pahchan_policy_overrides_scope_kind_ck
        CHECK (scope_kind IN ('site', 'category', 'employee')),

    --  A row that overrides nothing is a row that does nothing, and it would
    --  show on the screen as a scope with a policy of its own.
    CONSTRAINT pahchan_policy_overrides_not_empty_ck
        CHECK (jsonb_typeof(overrides) = 'object' AND overrides <> '{}'::jsonb),

    --  The keys retention and reporting are NOT among. See decision 2 above.
    CONSTRAINT pahchan_policy_overrides_allowed_keys_ck
        CHECK (NOT (overrides ?| ARRAY[
            'punch_photo_retention_days',
            'reference_photo_grace_days',
            'record_retention_years',
            'report_recipients',
            'report_daily',
            'report_weekly',
            'report_monthly'
        ])),

    --  One override per scope. Two rows for the same site would make "most
    --  specific wins" ambiguous at the level it is supposed to resolve.
    CONSTRAINT pahchan_policy_overrides_scope_uq
        UNIQUE (org_id, scope_kind, scope_ref)
);

COMMENT ON TABLE staging.pahchan_policy_overrides IS
    'Partial attendance-policy overrides. Resolution is org -> site -> category '
    '-> employee, most specific wins, key by key. Retention and reporting are '
    'org-level and refused by pahchan_policy_overrides_allowed_keys_ck: the DPDP '
    'notice quotes one retention figure to everybody.';

COMMENT ON COLUMN staging.pahchan_policy_overrides.overrides IS
    'ONLY the keys this scope changes. A full policy copy would freeze every '
    'other setting at the value it had when the override was written.';

--  The resolver reads every override for one org in one query and merges in
--  Python, so this is the index that matters.
CREATE INDEX IF NOT EXISTS idx_pahchan_policy_overrides_org
    ON staging.pahchan_policy_overrides (org_id);

--  And the one the settings screen uses to list a single scope.
CREATE INDEX IF NOT EXISTS idx_pahchan_policy_overrides_scope
    ON staging.pahchan_policy_overrides (org_id, scope_kind, scope_ref);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='staging' AND table_name='pahchan_policy_overrides'
--    ORDER BY ordinal_position;              -- expect 10 rows
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='staging.pahchan_policy_overrides'::regclass;
--                                            -- expect the 4 named above + pkey
--
--   SELECT count(*) FROM staging.pahchan_policy_overrides;   -- expect 0
--
-- Zero rows is the point: every org resolves exactly the policy it resolved
-- before this ran.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Safe while the table is empty. Once an org has written overrides, dropping it
-- silently returns every scope to the org-wide policy — which is a change to
-- how people's attendance is judged, so check first:
--
--   SELECT count(*) FROM staging.pahchan_policy_overrides;   -- must be 0
--
--   DROP TABLE staging.pahchan_policy_overrides;
