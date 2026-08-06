-- 116_onboarding_complete.sql
--
-- THE ONBOARDING WIZARD HAS A GATE AND NOTHING TO READ. THIS IS THE COLUMN.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change, as 093-098, 105 and 110 all say. Apply by
-- hand, in a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/116_onboarding_complete.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- Additive only. THREE new columns on one existing table, plus comments. No
-- DROP, no data destroyed, no trigger, no index. Every statement is
-- `IF NOT EXISTS`, so the file is replayable: run it twice and the second run
-- does nothing.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- `frontend/src/components/layout/Protected.jsx` has implemented the redirect
-- 12-auth-onboarding.md §5 asks for since the wizard was routed:
--
--     user?.org?.onboarding_complete === false  ->  <Navigate to="/onboarding">
--
-- and `onboarding_complete` exists nowhere in the backend. Verified three ways
-- on 2026-08-06: zero hits across every `.py`; zero column-creating hits across
-- `backend/migrations/`; and against the LIVE Supabase catalogue rather than
-- the migration ledger --
--     SELECT table_schema, table_name, column_name FROM information_schema.columns
--      WHERE column_name ILIKE '%onboard%';
-- returns nothing, in `staging` and in `public`. `/auth/me` also returns no
-- `org` object at all, so BOTH halves of that disjunction are permanently
-- undefined and the gate has never fired for anyone.
--
-- The wizard therefore renders, is routed, and is reachable by exactly nobody
-- who has not typed `/onboarding` into the address bar.
--
-- ── WHY THE COLUMN IS ON THE ORG AND NOT ON THE USER ────────────────────────
--
-- Every one of the five steps configures an ORGANISATION: its record, its
-- module set, its invitations, its first project. AUTH-SPEC.md:145 puts
-- onboarding immediately after org creation. A per-user flag would re-run the
-- wizard for every colleague of an org that is already set up -- which is
-- precisely the invite-only case that must never be gated.
--
-- It is a real BOOLEAN and not a key inside `organisations.settings` jsonb: the
-- gate runs on every authenticated page load, and an untyped, unindexable jsonb
-- probe is the wrong shape for a read on that path.
--
-- ══════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE CHANGING THE TWO STATEMENTS BELOW. THE ORDER IS THE POINT.
-- ══════════════════════════════════════════════════════════════════════════
--
-- The column is ADDED with `DEFAULT TRUE` and then its default is IMMEDIATELY
-- changed to FALSE. That is not indecision -- it is the only ordering that gets
-- both halves right, and it is written this way because the same mistake has
-- already shipped once in this product:
--
--   · `pahchan_policy` shipped with column defaults of TRUE, and every org that
--     had never opened the screen was shown three ticked boxes it never agreed
--     to. Migration 106 exists to undo that. The default is not a formality; it
--     is the answer given on behalf of every org that has not answered.
--
-- Here the equivalent mistake is the mirror image. `ADD COLUMN ... DEFAULT
-- FALSE` backfills EVERY EXISTING ORGANISATION as "has not finished setup", and
-- the very next page load throws every one of their users -- people who have
-- been using the product for months -- into a five-step wizard, with no way out
-- except finishing or skipping it. A migration that interrupts every live user
-- of the product is worse than the gap it closes.
--
-- So:
--   statement 1: ADD COLUMN ... NOT NULL DEFAULT TRUE
--                -> the backfill writes TRUE into every existing row. Every org
--                   that exists today is, by definition, past onboarding: it was
--                   created by hand by Aekam and is in use.
--   statement 2: ALTER COLUMN ... SET DEFAULT FALSE
--                -> every org created AFTER this lands starts life needing
--                   onboarding, which is what AUTH-SPEC.md:145 asks for.
--
-- Running the two in the other order, or collapsing them into one, gets exactly
-- one of those two right.
--
-- ── THE READ PATH SURVIVES THIS FILE NOT BEING APPLIED ──────────────────────
--
-- `auth_router._org_for()` probes `information_schema` for the column (the same
-- pattern `routers/org_profile.py::_available_columns` uses for PROPOSED_068)
-- and reports `onboarding_complete: true` while it is absent. So until somebody
-- runs this file the gate is inert and nobody is redirected anywhere -- which is
-- the correct behaviour for an unapplied migration, and is covered by
-- `backend/tests/test_onboarding_gate.py::test_me_reports_complete_when_the_column_is_absent`.
--
-- ── VERIFICATION ────────────────────────────────────────────────────────────
--
-- After applying, expect: every existing org TRUE, the column default FALSE.
--     SELECT onboarding_complete, COUNT(*) FROM staging.organisations
--      GROUP BY 1;                       -- expect one row: t | <all of them>
--     SELECT column_default FROM information_schema.columns
--      WHERE table_schema='staging' AND table_name='organisations'
--        AND column_name='onboarding_complete';   -- expect: false
--
-- If the first query returns any `f`, statements 1 and 2 ran in the wrong order
-- and every user of those orgs is about to be sent to /onboarding. Fix with:
--     UPDATE staging.organisations SET onboarding_complete = TRUE
--      WHERE onboarding_complete = FALSE AND created_at < NOW() - INTERVAL '1 day';

BEGIN;

-- GUARD 0 · the table this file alters. A missing-relation error further down
-- sends people looking for a typo in a name that is spelled correctly.
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION
            'staging.organisations does not exist. This file alters it; nothing was changed.';
    END IF;
END $$;

-- ── 1 · the flag ────────────────────────────────────────────────────────────
-- DEFAULT TRUE for the backfill. See the block above before touching this.
ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT TRUE;

-- DEFAULT FALSE from here on, so new orgs are gated and existing ones are not.
ALTER TABLE staging.organisations
    ALTER COLUMN onboarding_complete SET DEFAULT FALSE;

-- ── 2 · when, and whether it was actually done ──────────────────────────────
--
-- `onboarding_skipped` is not decoration and it is not the same question as
-- `onboarding_complete`. StepDone.jsx already draws three distinct endings --
-- something landed on the server, answers were held locally, or setup was
-- skipped outright -- and its own docblock argues that "claiming setup is
-- complete when it was skipped is a lie the user will discover on the empty
-- dashboard".
--
-- A skip MUST set `onboarding_complete = TRUE`, or "Skip setup entirely" is a
-- button that returns the user to the screen they pressed it on: the gate would
-- redirect them straight back. But it must not also assert that the org was
-- configured. Two columns keep those two facts apart, so a later "finish
-- setting up" prompt can find the orgs that skipped without re-trapping them.
--
-- NULL `onboarding_completed_at` on a TRUE row means "backfilled by this
-- migration" -- an org that predates the flag. That is a real and useful third
-- state, so the column is nullable and has no default.
ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS onboarding_skipped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN staging.organisations.onboarding_complete IS
    'FALSE only for an org created after migration 116 whose owner has not yet '
    'finished or skipped the setup wizard. Read by GET /api/auth/me, which '
    'reports TRUE while the column is absent; written by '
    'POST /api/v1/org/profile/onboarding-complete. Every org existing when 116 '
    'was applied was backfilled TRUE deliberately -- see the file header.';

COMMENT ON COLUMN staging.organisations.onboarding_completed_at IS
    'When the wizard was finished or skipped. NULL on a complete row means the '
    'org predates migration 116 and was backfilled.';

COMMENT ON COLUMN staging.organisations.onboarding_skipped IS
    'TRUE when the owner pressed "Skip setup entirely" rather than walking the '
    'steps. The org is still complete -- the gate must let them out -- but '
    'nothing was configured, so this is what a later prompt keys on.';

COMMIT;
