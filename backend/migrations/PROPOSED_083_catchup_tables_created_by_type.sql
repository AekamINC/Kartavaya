-- PROPOSED 083 — user-reference columns on the 081 catch-up tables are UUID,
-- but this application's user ids are not UUIDs.
--
-- NOT APPLIED. Needs the owner's decision and a maintenance window.
--
-- ── What is wrong ────────────────────────────────────────────────────────────
--
-- User ids in this system look like `user_f798947b8a2e` — a `user_` prefix and
-- 12 hex characters, 17 characters in total. They have never been UUIDs.
--
-- Migration 081 created nine catch-up tables on 2026-07-27 by applying
-- migrations 023 / 024 / 059 verbatim against cloud. Those files declare the
-- user-reference columns as UUID. The tables that already existed in cloud do
-- not — `graha_deals`, `graha_contacts` and `graha_activities` all accept
-- `user_...` in `created_by` today, which is why nobody had noticed that the
-- migration files disagree with the live schema. 081 faithfully reproduced a
-- declaration that had drifted out of truth some time ago.
--
-- ── Proven live on staging, 2026-07-28 ───────────────────────────────────────
--
-- POST /api/v1/graha/automations  → 500
--   asyncpg.exceptions.DataError: invalid input for query argument $7:
--   'user_f798947b8a2e' (invalid UUID: length must be between 32..36
--   characters, got 17)
--
--   The 500 reaches the browser as a CORS error, because the exception escapes
--   before CORSMiddleware attaches its headers. The console blames CORS; the
--   cause is this column.
--
-- POST /api/v1/graha/web-forms    → 409 "A form with this slug already exists"
--   against an EMPTY table. Same DataError, swallowed by a bare
--   `except Exception` at graha.py:2374 and relabelled. The message is worse
--   than the 500 because it sends you looking for a duplicate that cannot
--   exist. (That masking is fixed separately, in the router.)
--
-- POST /api/v1/graha/deals        → 200
--   The control. A pre-existing table, same binding, same user id, no error —
--   which is what isolates the fault to the tables 081 created.
--
-- ── Columns ──────────────────────────────────────────────────────────────────
--
-- Confirmed broken by live request:
--   graha_automations.created_by     023_crm_phase1_phase3.sql:71
--   graha_web_forms.created_by       023_crm_phase1_phase3.sql:139
--
-- Same declaration, same write path, not yet exercised — these fail the moment
-- the merge/undo flow is used:
--   graha_contact_merges.actor_id    024_graha_dedupe_merge.sql:93
--   graha_contact_merges.undone_by   024_graha_dedupe_merge.sql:96
--
-- Added 2026-07-28 review — same class, missed by the original sweep because
-- it is only reachable from an INSERT, not a live request during that pass:
--   graha_web_forms.auto_assign_to   023_crm_phase1_phase3.sql:134
-- `routers/graha.py` casts it `NULLIF($6,'')::uuid` from a plain `str` field
-- (`WebFormCreate.auto_assign_to`) that the app populates with a `user_...`
-- id whenever a form is set to auto-assign new leads to someone. Currently
-- dormant only because `frontend/src/pages/graha/WebFormsTab.jsx` never
-- surfaces the field — a direct API call with this field set 500s the same
-- way `created_by` did. Included in the ALTER below.
--
-- ── Why TEXT and not "make user ids UUIDs" ───────────────────────────────────
--
-- Because TEXT is already what the rest of the live schema uses for these
-- columns, and the id format is load-bearing across auth, tokens and every
-- existing row. Changing the id format to satisfy four columns would be the
-- larger and far riskier change. This aligns four outliers with the convention.
--
-- These columns hold no foreign key (they are plain UUID, not REFERENCES), so
-- there is no constraint to drop first and nothing referencing them.
--
-- ── Safety ───────────────────────────────────────────────────────────────────
--
-- All four tables are empty — they have never held a row, which is the entire
-- reason the fault went unseen. USING is therefore a formality and the rewrite
-- is instantaneous. Run it before the tables acquire data, not after.
--
-- Verify empty first. If any count is non-zero, STOP and re-read: the cast is
-- still safe (uuid → text is lossless) but the assumption behind this file no
-- longer holds and it deserves a fresh look.
--
--   SELECT 'graha_automations'   AS t, count(*) FROM staging.graha_automations
--   UNION ALL SELECT 'graha_web_forms',      count(*) FROM staging.graha_web_forms
--   UNION ALL SELECT 'graha_contact_merges', count(*) FROM staging.graha_contact_merges;
--
-- Rollback is `ALTER ... TYPE UUID USING NULLIF(col,'')::uuid`, which succeeds
-- only while every value is UUID-shaped or NULL — i.e. only before the first
-- real write. Supabase PITR is the rollback that holds after that.

BEGIN;

ALTER TABLE staging.graha_automations
    ALTER COLUMN created_by TYPE TEXT USING created_by::text;

ALTER TABLE staging.graha_web_forms
    ALTER COLUMN created_by     TYPE TEXT USING created_by::text,
    ALTER COLUMN auto_assign_to TYPE TEXT USING auto_assign_to::text;

ALTER TABLE staging.graha_contact_merges
    ALTER COLUMN actor_id   TYPE TEXT USING actor_id::text,
    ALTER COLUMN undone_by  TYPE TEXT USING undone_by::text;

COMMIT;

-- After applying, re-run the two writes that fail today:
--   POST /api/v1/graha/automations  {name, trigger_type, action_type}  → expect 200
--   POST /api/v1/graha/web-forms    {name, slug, fields}               → expect 200
-- A 409 on the second after this migration means a genuine duplicate slug,
-- which is the first time that message will have been true.
