-- 156 · pulse_usage — the two owner-approved Pulse collectors (proposal 68,
-- the "Where Kartavaya runs" and "App version adoption" cards).
--
-- The owner approved exactly TWO collections, and this migration holds
-- exactly their two tables. No IP, no geolocation, no cookie: the proposal's
-- states/cities cards were NOT approved and have no column here to land in.
--
-- pulse_logins is one row per successful login and NOTHING else:
-- (occurred_at, user_id, surface, os). `surface` and `os` are enums parsed
-- server-side by services/pulse.py:parse_user_agent — the raw User-Agent
-- string is never stored anywhere in Pulse; it is read, reduced to two
-- words, and discarded. surface is 'web' | 'app'; os is
-- 'windows' | 'macos' | 'linux' | 'other' for web and
-- 'android' | 'ios' | 'ipados' for the app — the Apple values are already
-- recognised by the parser so those rows light up the day that build ships.
-- TEXT columns with the vocabulary held in code, the same trade 149/154/155
-- make for user_id: the parser is the only writer, and a CHECK frozen at
-- today's list would refuse the first enum added later.
--
-- pulse_app_versions is ONE ROW PER PERSON — the latest version the phone
-- app stated in its X-App-Version header, upserted at login and on the
-- delta-sync path. A current-state table, not a history: "did the OTA land?"
-- is a question about now, and keeping only the latest value per person is
-- what keeps this table incapable of becoming a movement log.
--
-- `user_id` is TEXT with no FK, matching users.user_id (canonical
-- 'user_<12hex>') the same way 149, 154 and 155 record it.
--
-- Retention (13 months, then aggregates only) ships with the privacy-notice
-- clause, separately — nothing in this migration or its readers deletes.
--
-- SHARED-DATABASE NOTE: staging and production share this database. Two new
-- empty tables; nothing existing is altered, no existing row is written.
-- Production's code (main, 1aa49855) does not mount routers/pulse.py and its
-- auth/sync routers predate the collectors, so nothing in production reads
-- or writes either table.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.pulse_logins (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id     TEXT NOT NULL,
    surface     TEXT NOT NULL,
    os          TEXT NOT NULL
);

-- The surface/OS metric windows on occurred_at; this is its whole read path.
CREATE INDEX IF NOT EXISTS pulse_logins_occurred_at
    ON staging.pulse_logins (occurred_at);

CREATE TABLE IF NOT EXISTS staging.pulse_app_versions (
    user_id     TEXT PRIMARY KEY,
    version     TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;

-- DOWN (manual):
--   DROP TABLE staging.pulse_logins;
--   DROP TABLE staging.pulse_app_versions;
