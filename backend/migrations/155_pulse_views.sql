-- 155 · pulse_views — the personal Pulse board of one Aekam platform account
-- (proposal 68, "The pulse of Kartavaya").
--
-- Pulse is the Aekam-only product-usage surface in the Hub: org-level
-- aggregates and org names, never a member's name, email or per-person row.
-- This table holds only the ARRANGEMENT a platform account chose for its own
-- Pulse board — which metrics, drawn how, where on the grid. No metric data
-- is ever stored; every number is computed at read time by
-- services/pulse.py.
--
-- ONE ROW PER PERSON, no org column at all, deliberately: Pulse is a
-- platform surface with no tenant in it, so an org-default rung (the ladder
-- analytics_views and user_tab_prefs carry) has no meaning here. The floor
-- under the personal row is DEFAULT_LAYOUT in services/pulse.py — CODE, not
-- a row, for the same reason analytics presets are code (149): a default
-- that improves must not be frozen at whatever version existed when a staff
-- account first opened the tab.
--
-- `user_id` is TEXT with no FK, matching users.user_id (canonical
-- 'user_<12hex>') the same way 149 and 154 record it. `layout` is validated
-- ON SAVE by the SAME whitelist routers/analytics.py applies to tenant
-- views (imported, never copied — drift between the two validators is the
-- bug), so junk keys never reach the row.
--
-- SHARED-DATABASE NOTE: staging and production share this database. One new
-- empty table; nothing existing is altered, no existing row is written.
-- Production's code (main, 1aa49855) does not mount routers/pulse.py, so
-- nothing in production reads or writes it.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.pulse_views (
    user_id     TEXT PRIMARY KEY,
    layout      JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.pulse_views;
