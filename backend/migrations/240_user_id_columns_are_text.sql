-- 240_user_id_columns_are_text.sql
--
-- Four user-reference columns declared UUID, against ids that never were.
--
-- The number was read at the moment this file was written —
-- `ls backend/migrations/ | grep -oE '^[0-9]+' | sort -n | tail -1` answered
-- 239 — and it is never re-numbered afterwards.
--
-- Risk report, written BEFORE this ran and not afterwards to justify it:
--   docs/plans/93-C-CONTACT-MERGE-UUID-RISK-REPORT.md
--
-- ── HOW IT WAS FOUND ────────────────────────────────────────────────────────
--
-- Proposal 93 Suite 04 drove the real contact-merge control on 2026-08-29. The
-- screen is correct; the request is not. Railway deploy log, 01:31:38 UTC:
--
--   asyncpg.exceptions.InvalidTextRepresentationError:
--     invalid input syntax for type uuid: "user_21457956f010"
--
-- User ids are `user_` + 12 hex — 17 characters, and never UUIDs.
-- `024_graha_dedupe_merge.sql:93` declares `actor_id UUID`.
--
-- ⚠ `staging.graha_contact_merges` held ZERO ROWS AND ALWAYS HAD. That is not a
-- coincidence beside the bug, it is the bug's consequence: **contact merge has
-- never once worked in this product's life.**
--
-- ── IT SUPERSEDES PROPOSED_083, WHICH WAS WRITTEN 2026-07-28 AND NEVER RAN ──
--
-- That file names this exact column and says these tables "fail the moment the
-- merge/undo flow is used". They did. It was right for thirty-two days.
--
-- ⚠ AND IT LISTS FIVE COLUMNS WHERE THE CATALOGUE SAYS FOUR.
-- `graha_web_forms.created_by` is ALREADY `text` on the live database —
-- converted at some point without the proposal being updated. Applying that
-- file verbatim would have harmed nothing (`created_by::text` on a text column
-- is valid), but it would have been a statement written against a schema that
-- had moved. Migration 238 exists because a CHECK was live that two repo files
-- both declared "NOT APPLIED". **Read the catalogue, never the migration file.**
--
-- ── WHAT THIS TOUCHES ───────────────────────────────────────────────────────
--
--   ALTER COLUMN … TYPE TEXT  x 4
--   COMMENT                   x 1
--
--   NO table created or dropped. NO row written, read or backfilled. NO
--   constraint added or removed — these columns carry no foreign key
--   (`REFERENCES` was never declared), so there is nothing to drop first and
--   nothing pointing at them.
--
-- ── EXPOSURE, MEASURED BEFORE THE STATEMENT, IN BOTH PRODUCT SCHEMAS ────────
--
--   staging.graha_automations       0 rows
--   staging.graha_contact_merges    0 rows
--   staging.graha_web_forms         2 rows, auto_assign_to non-null on 0
--   public.graha_*                  none of the three exists
--
-- NOT ONE VALUE IS REWRITTEN. Every column cast is NULL on every row that
-- exists, so `USING` is a formality rather than a conversion — and the count is
-- what makes that a measurement instead of an assumption.
--
-- ⚠ PROPOSED_083's own precondition had moved: it says "verify empty first; if
-- any count is non-zero, STOP and re-read". `graha_web_forms` now holds 2 rows,
-- created by Suite 04 an hour before this ran. The premise changed; the
-- conclusion did not, because those rows' `auto_assign_to` is NULL and their
-- `created_by` is already text. Recorded rather than waved through.
--
-- ── WHY TEXT, AND NOT "MAKE USER IDS UUIDs" ────────────────────────────────
--
-- Because TEXT is what the rest of the live schema already uses for these
-- columns: `graha_deals`, `graha_contacts` and `graha_activities` all accept
-- `user_…` in `created_by` today. That is why the disagreement went unseen —
-- migration 081 created these tables on 2026-07-27 by replaying 023/024/059
-- verbatim, faithfully reproducing a declaration that had drifted out of truth
-- long before. The id format is load-bearing across auth, tokens and every
-- existing row; changing it to satisfy four columns would be the larger and far
-- riskier change. This aligns four outliers with the convention.
--
-- ── ⚠ THE REVERSAL EXPIRES, AND THAT IS THE ONE ASYMMETRY HERE ─────────────
--
--   ALTER TABLE staging.graha_automations
--       ALTER COLUMN created_by TYPE UUID USING NULLIF(created_by,'')::uuid;
--   ALTER TABLE staging.graha_web_forms
--       ALTER COLUMN auto_assign_to TYPE UUID USING NULLIF(auto_assign_to,'')::uuid;
--   ALTER TABLE staging.graha_contact_merges
--       ALTER COLUMN actor_id  TYPE UUID USING NULLIF(actor_id,'')::uuid,
--       ALTER COLUMN undone_by TYPE UUID USING NULLIF(undone_by,'')::uuid;
--
-- That succeeds only while every value is UUID-shaped or NULL — i.e. only until
-- the first real merge writes a `user_…` id. After that the honest rollback is
-- Supabase PITR, and reverting would mean DISCARDING MERGE HISTORY, because the
-- rows that block the cast are exactly the ones this fix exists to create.
--
-- Which is an argument for running it while the tables are empty, and is
-- PROPOSED_083's own argument: "run it before the tables acquire data."

ALTER TABLE staging.graha_automations
    ALTER COLUMN created_by TYPE TEXT USING created_by::text;

ALTER TABLE staging.graha_web_forms
    ALTER COLUMN auto_assign_to TYPE TEXT USING auto_assign_to::text;

ALTER TABLE staging.graha_contact_merges
    ALTER COLUMN actor_id  TYPE TEXT USING actor_id::text,
    ALTER COLUMN undone_by TYPE TEXT USING undone_by::text;

COMMENT ON COLUMN staging.graha_contact_merges.actor_id IS
    'TEXT, not UUID. User ids are user_<12hex> and never were UUIDs; this column being uuid is why contact merge 500d for its entire life and the table held 0 rows. See migration 240.';
