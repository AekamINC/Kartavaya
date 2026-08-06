-- ============================================================
-- Migration 119: the Sahayak answer contract, and skill feedback provenance
--
-- NOT APPLIED. One `staging` schema exists and PRODUCTION WRITES TO IT TOO, so
-- applying this is a production change and is the owner's call, not an agent's.
-- Both endpoints added alongside it WORK WITHOUT IT — that is not a courtesy,
-- it is the actual state of production, and `routers/hub.py` catches
-- `asyncpg.UndefinedColumnError` on both inserts and falls back to the columns
-- that already exist. What is lost while this is unapplied is stated per column
-- below; nothing is lost from the response a caller receives.
--
-- Cost: four ADD COLUMNs, all nullable, all with no default. In Postgres 11+ a
-- nullable ADD COLUMN with no default is a catalogue-only change — it does not
-- rewrite the table and it does not scan it. It takes ACCESS EXCLUSIVE for the
-- duration of the catalogue update, which is microseconds on an idle table and
-- unbounded behind a long-running reader, so run it when nothing is holding a
-- lock on these two tables. `lock_timeout` below makes a blocked run fail fast
-- rather than queue behind a reader and block every writer behind itself.
--
-- Reversible: see the DOWN block at the foot. Dropping these columns loses the
-- structured half of stored answers and the feedback provenance; it loses no
-- message, no answer text and no feedback signal.
-- ============================================================

SET lock_timeout = '3s';

-- ── 1 · the structured half of an answer ──────────────────────────────────
--
-- `hub_chat_messages` has carried `content` (the prose) and `sources` (jsonb,
-- since 017) and nothing else. The Sahayak screen also draws the work steps,
-- the attributable figures, the evidence table and the refusal block — the
-- prototype's `work`, `figs`, `ev` and `none`. `POST /api/v1/hub/chat` returns
-- all of them; without this column they are returned and not stored, so they
-- are on screen for the reply that produced them and gone when the conversation
-- is reloaded.
--
-- One jsonb column rather than four, deliberately: it holds the whole answer
-- payload as it was returned, so a reload replays exactly what was shown rather
-- than a reconstruction from parts. Nothing queries inside it, so it needs no
-- index; if that ever changes, a GIN index on `answer` is the addition, not a
-- set of promoted columns.
ALTER TABLE staging.hub_chat_messages
  ADD COLUMN IF NOT EXISTS answer jsonb;

COMMENT ON COLUMN staging.hub_chat_messages.answer IS
  'The structured answer payload as returned by POST /api/v1/hub/chat: '
  'work, figs, evidence, refusal, refusal_detail, read. Prose stays in '
  '`content` and citations stay in `sources`; this is what the screen needs '
  'to redraw a past answer as it was first shown.';

-- ── 2 · where a piece of feedback came from ───────────────────────────────
--
-- `hub_skill_feedback` (migration 059) records skill_template_id, org_id,
-- input_hash, predicted, corrected and accepted — enough for
-- `skill_dispatcher._get_feedback_corrections` to find a correction, and not
-- enough for a human to find out what the reader was looking at when they gave
-- it. Nothing has ever written to this table; there was no endpoint until now.
--
-- No foreign keys, on purpose:
--   run_id      references staging.hub_org_skill_runs, which exists in the
--               cloud database but in NO migration file in this repo (it
--               arrived through the 081 catch-up). A constraint against a table
--               this repo cannot prove the shape of is a migration that fails
--               on one environment and not the other.
--   message_id  references staging.hub_chat_messages, which does exist here —
--               but the row it points at is deleted by CASCADE when a session
--               goes, and a feedback row should outlive the answer it was
--               about. A dangling id reads correctly as "the answer is gone";
--               ON DELETE CASCADE would silently delete the signal with it.
-- Both are verified in the endpoint against the caller's own org before a row
-- is written, which is the check that actually matters — a database constraint
-- would confirm the id exists, never that it is theirs.
ALTER TABLE staging.hub_skill_feedback
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS message_id uuid,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_by text;

COMMENT ON COLUMN staging.hub_skill_feedback.run_id IS
  'staging.hub_org_skill_runs.id this feedback is about. No FK — see migration '
  '119. Verified against the caller''s org at write time.';
COMMENT ON COLUMN staging.hub_skill_feedback.message_id IS
  'staging.hub_chat_messages.id this feedback is about, for feedback on a '
  'Sahayak answer rather than on a skill run. No FK — a feedback row outlives '
  'the answer.';
COMMENT ON COLUMN staging.hub_skill_feedback.created_by IS
  'user_id of whoever gave the feedback. TEXT, matching hub_chat_sessions.'
  'created_by and every other user reference in the hub tables.';

-- Reading feedback back for one org, newest first, is the only query anyone
-- will run on this table by hand. The 059 index is keyed on
-- (skill_template_id, org_id, created_at) and cannot serve it, because feedback
-- on a chat answer has no template.
CREATE INDEX IF NOT EXISTS idx_skill_feedback_org_recent
  ON staging.hub_skill_feedback (org_id, created_at DESC);

RESET lock_timeout;

-- ============================================================
-- DOWN
-- ============================================================
-- DROP INDEX IF EXISTS staging.idx_skill_feedback_org_recent;
-- ALTER TABLE staging.hub_skill_feedback
--   DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS note,
--   DROP COLUMN IF EXISTS message_id,
--   DROP COLUMN IF EXISTS run_id;
-- ALTER TABLE staging.hub_chat_messages DROP COLUMN IF EXISTS answer;
