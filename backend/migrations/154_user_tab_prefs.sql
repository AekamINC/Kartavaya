-- 154 · user_tab_prefs — the tab order a person chose per module, and the
-- tab that module opens on (proposal 67, demo 2: "Tabs you choose").
--
-- One personal row per person per module, and one org-default row per module
-- underneath it. The reader resolves
--
--     personal (user_id = viewer)  >  org default (user_id IS NULL)
--
-- and the page's built-in order is the floor below both — CODE in the
-- frontend, never a row, for the same reason analytics presets are code
-- (149): a default that improves must not be frozen at whatever version an
-- org signed up under.
--
-- The personal key is (user_id, module) with NO org in it, on purpose: an
-- arrangement of tabs is a habit of the hands, and the proposal promises it
-- follows you to any device — and to any org you switch into. `user_id` is
-- TEXT with no FK, matching users.user_id (canonical 'user_<12hex>') the
-- same way 149 records for analytics_views. `org_id` carries no FK either:
-- this DDL is the reviewed contract, and an org deleted from under its
-- default row leaves a preference nothing ever resolves again —
-- housekeeping, not integrity.
--
-- TWO PARTIAL UNIQUE INDEXES, not one constraint, because the two row shapes
-- key on different columns and NULL defeats every single spelling: a plain
-- UNIQUE (user_id, org_id, module) never collides two org defaults (their
-- NULL user_ids are distinct), and NULLS NOT DISTINCT over the triple would
-- weld a personal row to one org — exactly what the personal key must not
-- do. Each index is also its upsert's ON CONFLICT target, predicate and all;
-- routers/tab_prefs.py names them verbatim.
--
-- `tab_order` holds tab IDS THE FRONTEND OWNS (each module page's TABS
-- constant). The API pins the grammar — ^[a-z0-9_-]{1,40}$, at most 30,
-- unique, default_tab pointing inside the list — and deliberately not a
-- per-module catalogue: a tab shipped later lands in More and must not
-- invalidate an arrangement saved before it existed. Deep links beat
-- `default_tab` in the client; the server only stores the star.
--
-- SHARED-DATABASE NOTE: staging and production share this database. One new
-- empty table; nothing existing is altered, no existing row is written.
-- Production's code (main, 1aa49855) does not mount routers/tab_prefs.py,
-- so nothing in production reads or writes it.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.user_tab_prefs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = the org-default row every member falls back to; a value =
    -- personal. TEXT, no FK — see the header.
    user_id     TEXT,
    org_id      UUID,
    module      TEXT NOT NULL,
    tab_order   TEXT[] NOT NULL DEFAULT '{}',
    default_tab TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A row naming neither a person nor an org is a preference for nobody;
    -- the table refuses it rather than trusting every writer to.
    CHECK (user_id IS NOT NULL OR org_id IS NOT NULL)
);

-- One personal row per person per module (org-less by design) …
CREATE UNIQUE INDEX IF NOT EXISTS user_tab_prefs_personal_key
    ON staging.user_tab_prefs (user_id, module) WHERE user_id IS NOT NULL;

-- … and one org-default row per org per module.
CREATE UNIQUE INDEX IF NOT EXISTS user_tab_prefs_org_key
    ON staging.user_tab_prefs (org_id, module) WHERE user_id IS NULL;

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.user_tab_prefs;
