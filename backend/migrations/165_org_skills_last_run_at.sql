-- 165_org_skills_last_run_at.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   staging.hub_org_skills   ADD COLUMN last_run_at timestamptz NULL
--
-- Nothing else. No data is written, no row is altered, no constraint is added,
-- nothing is dropped. Running it a second time is a no-op (IF NOT EXISTS).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- `staging.hub_org_skills` was read by `routers/hub.py` and by nothing else. No
-- cron ever selected from it, so the nineteen skills an organisation can be
-- granted had no scheduler at all — every one of the 104 runs in the product's
-- history was a person pressing the button on the Skills screen.
--
-- `/cron/skills` already schedules the CLIENT-scoped equivalent, and it does so
-- off `hub_client_skills.last_run_at`. The org table has no such column, so a
-- schedule had nowhere to record that it had fired. This adds the cursor and
-- nothing more; the loop itself is in `routers/scheduler.py`.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- Adding a nullable column with no default is metadata-only in PostgreSQL 11+:
-- no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE to update the
-- catalogue, instant on a table this size (11 rows live).
--
-- Every existing row gets NULL, which the scheduler reads as "never run" and
-- therefore "due now". THAT DOES NOT DISPATCH ANYTHING, because the due
-- predicate also requires `trigger_config` on the template, and all nineteen
-- templates currently have `trigger_config = NULL` — verified live on
-- 2026-08-19. Nothing becomes schedulable until somebody deliberately schedules
-- a template, which is a separate, deliberate write.
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. Production reads this table
-- through `SELECT os.*` in `run_org_skill`, and every consumer indexes the row
-- by name, so an extra column is inert there. Reversal is
-- `ALTER TABLE staging.hub_org_skills DROP COLUMN last_run_at;` and loses only
-- the cursor.

ALTER TABLE staging.hub_org_skills
    ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

COMMENT ON COLUMN staging.hub_org_skills.last_run_at IS
    'When the scheduler last dispatched this grant. NULL means never. Written by '
    '/cron/skills only; a run started from the Skills screen does not touch it, '
    'so pressing the button by hand never consumes the scheduled slot.';
