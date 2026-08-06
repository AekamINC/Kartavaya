-- 113_pahchan_notice_acknowledgements.sql
--
-- A NOTICE YOU CANNOT PROVE YOU SERVED IS A NOTICE YOU DID NOT SERVE.
-- The DPDP attendance notice ("Attendance — what we record" / "उपस्थिति — हम
-- क्या दर्ज करते हैं") is served before a face photograph is ever captured.
-- This is the row that records that it was.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/113_pahchan_notice_acknowledgements.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 6 August 2026. Measured against the live catalogue
-- (`to_regclass('staging.pahchan_notice_acknowledgements')` → NULL, project
-- toacecaewujfxjfrjwco), deliberately not run.
--
-- ── THE MEASUREMENT THAT DECIDED THE PRIMARY KEY ────────────────────────────
--
-- The obvious key is `employee_id`. It is wrong today, and the reason is a
-- number:
--
--     SELECT count(*), count(user_id) FROM staging.manav_employees;
--     → 81 employees, 0 with a user_id     (6 August 2026)
--
-- `routers/pahchan.py:258-263` `_employee_for` resolves the caller by
-- `manav_employees.user_id = $2`. With zero linked rows it returns NULL FOR
-- EVERY CALLER, and `GET /v1/pahchan/me` therefore answers
-- `{"employee": null, ...}` to everybody on this database right now. A table
-- keyed on employee_id could not accept a single acknowledgement from a single
-- person, and the gate above the camera would either block every punch forever
-- or have to be waved through — which is the notice not existing, with extra
-- steps.
--
-- So the subject is the ACCOUNT (`user_id TEXT`), which always resolves because
-- it is who signed in, and `employee_id` is recorded ALONGSIDE it when it
-- happens to be resolvable. The HR-side question ("has this employee been
-- served?") gets better automatically the day employees are linked to accounts;
-- the compliance question ("was this person told before we photographed them?")
-- is answerable from day one either way.
--
-- ── TWO CLOCKS, BECAUSE THE PHONE IS OFFLINE ───────────────────────────────
--
-- The mobile gate must clear WITHOUT A NETWORK — a site worker in a basement
-- who cannot acknowledge cannot clock in, and a blocked punch is the exact
-- failure `07 §2` exists to prevent. So the tap happens locally, is held in
-- MMKV against the version string, and syncs later. That means the moment of
-- acknowledgement and the moment of recording are different moments and both
-- matter:
--
--   acknowledged_at  when the PERSON tapped, from the DEVICE clock. This is the
--                    legally interesting instant — it is what must precede the
--                    first photograph.
--   recorded_at      when the SERVER wrote the row. Trustworthy, monotonic,
--                    and the one to sort by.
--
-- There is deliberately NO CHECK that acknowledged_at <= recorded_at. A device
-- clock running twelve hours fast is common and is not the worker's fault;
-- refusing that row means refusing the sync, which means the gate never clears,
-- which means the blocked punch again. The database records what it was told
-- and keeps the server's own timestamp beside it so the discrepancy is VISIBLE
-- rather than resolved by discarding evidence. Clamp in code if you must clamp;
-- do not clamp by rejecting.
--
-- ── WHY THERE IS NO append-only TRIGGER, ALTHOUGH IT IS APPEND-ONLY ────────
--
-- A trigger refusing UPDATE and DELETE is the obvious way to make "append-only"
-- real rather than aspirational. It is not written here, for one concrete
-- reason: `employee_id` and `org_id` both carry ON DELETE actions, and a
-- DELETE-refusing trigger would break the org cascade — an organisation being
-- removed, or an employee exercising erasure, would fail on a compliance record
-- that exists to protect them. Erasure losing to an audit trail is the wrong
-- way round.
--
-- What enforces the shape instead:
--   · the UNIQUE index — one row per person per version, so an "update" has
--     nowhere to go except a second version, which is a different row;
--   · there being no mutable column. Every column is a fact about one instant.
--     An UPDATE here has no honest purpose, and a review that sees one should
--     ask why.
--
-- ── ERASURE ─────────────────────────────────────────────────────────────────
--
-- `employee_id` is ON DELETE SET NULL and NOT cascade. When an employee record
-- is deleted the proof that a notice was served survives as an account-keyed
-- row with no employee attached: the org keeps its compliance record, and the
-- person's link into the HR roster is gone. `org_id` IS cascade — when the
-- tenant goes, everything of theirs goes.
--
-- ── EVERY DEFAULT, CHOSEN AS IF NOBODY EVER OPENS THE SCREEN ───────────────
--
-- This table has no preference columns, so the 106 trap is mostly absent — but
-- it has the sharper version of the same problem: THE ABSENCE OF A ROW MUST
-- MEAN "NOT ACKNOWLEDGED". There is no `acknowledged BOOLEAN DEFAULT ...` and
-- there must never be one. A boolean column with a default is a way for a row
-- to exist saying yes on somebody's behalf. The only way to say yes here is to
-- insert a row, and the only thing that inserts one is a person tapping.
--
-- Correspondingly: `notice_version` has NO default. A row that does not say
-- WHICH wording was read proves nothing, and a default would let one be written
-- by omission.
--
-- ── THE VERSION STRING COVERS THE WORDING, NOT THE NUMBERS ─────────────────
--
-- `PAHCHAN_NOTICE_VERSION` (e.g. '2026-08-06.1') changes when the six lines,
-- the title or the legal footer change. It does NOT change when an org shortens
-- its retention window, because line 4 renders the figures LIVE from
-- `staging.pahchan_policy` (`punch_photo_retention_days`,
-- `reference_photo_grace_days`, `record_retention_years` — all three columns
-- exist and are already read by `GET /v1/pahchan/me`). The sentence is the same
-- sentence; only the number in it moved. A retention change that minted a new
-- version would re-gate every worker in the country every time an admin edited
-- a policy field.
--
-- There is deliberately NO CHECK constraining `notice_version` to a known list.
-- Such a CHECK would make a copy edit a database migration, which guarantees
-- that one day the copy ships and the CHECK does not.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One CREATE TABLE and three CREATE INDEX. Nothing is ALTERed. The FKs take
-- ShareRowExclusiveLock on `organisations` (3 rows) and `manav_employees`
-- (81 rows) for a catalogue write — writes blocked, reads not, microseconds.
-- No data is rewritten, so no wrong-database guard.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── GUARD 0 · both parents ──────────────────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION 'staging.organisations does not exist.';
    END IF;
    IF to_regclass('staging.manav_employees') IS NULL THEN
        RAISE EXCEPTION
            'staging.manav_employees does not exist. The notice is served to a '
            'person on the attendance roster; without the roster there is no '
            'employee_id to record.';
    END IF;
END $$;

-- ── GUARD 1 · the retention figures the notice renders ──────────────────────
--
-- Not decoration. Line 4 of the notice ("How long") is a FUNCTION of these
-- three columns, not a constant — `mobile/src/screens/pahchan/MyBiometrics.tsx`
-- makes the argument itself: "a retention promise displayed from a constant is
-- a promise about a different system." If they are absent, the notice cannot
-- state its fourth line truthfully, and a notice with an invented retention
-- figure is worse than no notice.
DO $$
DECLARE missing text;
BEGIN
    SELECT string_agg(c, ', ') INTO missing
      FROM unnest(ARRAY['punch_photo_retention_days',
                        'reference_photo_grace_days',
                        'record_retention_years']) AS c
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='staging' AND table_name='pahchan_policy'
           AND column_name = c);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            'staging.pahchan_policy is missing %. The notice renders its '
            'retention line from these columns, live, per org. Apply the '
            'Pahchan policy migration first.', missing;
    END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The acknowledgement
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.pahchan_notice_acknowledgements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id          UUID NOT NULL
                    REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- THE SUBJECT. The account, because that is the thing that always resolves
    -- — see the header. TEXT and not UUID: `user_549c9cac35aa`.
    user_id         TEXT NOT NULL,

    -- Recorded when resolvable, which is never on this database today (0 of 81
    -- employees carry a user_id). SET NULL on delete so erasure of the HR record
    -- does not destroy the org's proof that a notice was served.
    employee_id     UUID
                    REFERENCES staging.manav_employees(id) ON DELETE SET NULL,

    -- WHICH WORDING. No default: a row that does not say what was read proves
    -- nothing. No CHECK: a copy edit must not be a migration.
    notice_version  TEXT NOT NULL CHECK (length(btrim(notice_version)) > 0),

    -- The device clock. See "TWO CLOCKS" above. NOT NULL and NO default: the
    -- client states when the person tapped; the server does not invent it.
    acknowledged_at TIMESTAMPTZ NOT NULL,

    -- The server clock. This is the trustworthy one and the one to sort by.
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Which surface served it. `mobile` is the gate above the camera; `web` is
    -- the "What we record" tab, where there is no punch surface and so no gate.
    source          TEXT NOT NULL
                    CHECK (source IN ('web', 'mobile')),

    -- Whether the row arrived late, i.e. was held on the device and synced.
    -- Derived at write time by the client, not inferred here from the two
    -- timestamps: a phone with a wrong clock would make that inference lie in
    -- both directions.
    was_offline     BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE staging.pahchan_notice_acknowledgements IS
    'One row per PERSON per notice VERSION. Append-only by construction: every '
    'column is a fact about one instant and there is nothing an UPDATE could '
    'honestly change. No append-only trigger, deliberately — it would break the '
    'org cascade and the employee ON DELETE SET NULL, and erasure must not lose '
    'to an audit trail. THE ABSENCE OF A ROW MEANS NOT ACKNOWLEDGED; there is '
    'no boolean column and there must never be one, because a boolean with a '
    'default is a way to record consent nobody gave.';

COMMENT ON COLUMN staging.pahchan_notice_acknowledgements.user_id IS
    'The signed-in account. This is the key, not employee_id, because '
    'manav_employees.user_id is NULL on all 81 rows (measured 6 August 2026) so '
    'routers/pahchan.py:_employee_for resolves nobody, and a table keyed on the '
    'employee could not accept one acknowledgement from one person.';

COMMENT ON COLUMN staging.pahchan_notice_acknowledgements.acknowledged_at IS
    'DEVICE clock — when the person tapped. May precede recorded_at by days '
    '(offline sync) and may exceed it (clock skew). NOT validated against '
    'recorded_at on purpose: refusing a skewed row means refusing the sync, '
    'which means the gate never clears, which means a blocked punch. Record it, '
    'keep the server clock beside it, and let the discrepancy be visible.';

COMMENT ON COLUMN staging.pahchan_notice_acknowledgements.notice_version IS
    'The wording that was read. Changes when the six lines, the title or the '
    'legal footer change — NOT when an org edits its retention days, because '
    'the notice renders those figures live from staging.pahchan_policy. No '
    'CHECK against a known list: that would make a copy edit a migration, and '
    'one day the copy would ship without it.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Indexes
-- ═════════════════════════════════════════════════════════════════════════════

-- ONE ROW PER PERSON PER VERSION, as an index rather than as a code path. This
-- is also the idempotency guarantee the offline sync needs: a phone that
-- retries a queued acknowledgement three times writes it once. The endpoint
-- INSERTs with ON CONFLICT DO NOTHING and returns 200 either way — a retry is
-- not an error, and the FIRST acknowledged_at is kept, which is the one that
-- actually preceded the photograph.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pahchan_notice_ack_person_version
    ON staging.pahchan_notice_acknowledgements (org_id, user_id, notice_version);

-- The gate's own question, asked on every app open: "has this account
-- acknowledged the current version?"
CREATE INDEX IF NOT EXISTS idx_pahchan_notice_ack_lookup
    ON staging.pahchan_notice_acknowledgements (user_id, notice_version);

-- The HR-side question: "who on my roster has been served, and who has not?"
-- Partial, because a row with no employee_id cannot answer it and there will be
-- many of those until accounts and employees are linked.
CREATE INDEX IF NOT EXISTS idx_pahchan_notice_ack_by_employee
    ON staging.pahchan_notice_acknowledgements (org_id, employee_id)
    WHERE employee_id IS NOT NULL;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The table exists and is empty.
--      SELECT to_regclass('staging.pahchan_notice_acknowledgements') AS tbl,
--             (SELECT count(*) FROM staging.pahchan_notice_acknowledgements) AS rows;

-- 2. NOBODY IS RECORDED AS HAVING AGREED TO ANYTHING. Zero. If this is ever
--    non-zero immediately after an apply, something inserted on somebody's
--    behalf and the whole point of the table is gone.

-- 3. The uniqueness holds and a retry is a no-op, not an error, and does NOT
--    overwrite the original instant.
--      BEGIN;
--        INSERT INTO staging.pahchan_notice_acknowledgements
--          (org_id, user_id, notice_version, acknowledged_at, source)
--          SELECT id, 'user_probe', '2026-08-06.1', NOW() - interval '2 days', 'mobile'
--            FROM staging.organisations LIMIT 1;
--        INSERT INTO staging.pahchan_notice_acknowledgements
--          (org_id, user_id, notice_version, acknowledged_at, source)
--          SELECT id, 'user_probe', '2026-08-06.1', NOW(), 'mobile'
--            FROM staging.organisations LIMIT 1
--          ON CONFLICT DO NOTHING;
--        SELECT count(*), min(acknowledged_at) FROM staging.pahchan_notice_acknowledgements
--         WHERE user_id='user_probe';
--        -- expect 1 row, and the timestamp from TWO DAYS AGO — the first tap
--      ROLLBACK;

-- 4. A SKEWED DEVICE CLOCK IS ACCEPTED. This must SUCCEED. A failure here means
--    somebody added the CHECK the header argues against, and the consequence is
--    a worker who cannot clock in.
--      BEGIN;
--        INSERT INTO staging.pahchan_notice_acknowledgements
--          (org_id, user_id, notice_version, acknowledged_at, source, was_offline)
--          SELECT id, 'user_probe_skew', '2026-08-06.1',
--                 NOW() + interval '12 hours', 'mobile', TRUE
--            FROM staging.organisations LIMIT 1;
--        -- expect: 1 row inserted, no error
--      ROLLBACK;

-- 5. A NEW VERSION RE-GATES. The same person acknowledging a different wording
--    is a different row, not a conflict.
--      BEGIN;
--        INSERT INTO staging.pahchan_notice_acknowledgements
--          (org_id, user_id, notice_version, acknowledged_at, source)
--          SELECT id, 'user_probe', '2026-08-06.1', NOW(), 'mobile'
--            FROM staging.organisations LIMIT 1;
--        INSERT INTO staging.pahchan_notice_acknowledgements
--          (org_id, user_id, notice_version, acknowledged_at, source)
--          SELECT id, 'user_probe', '2026-09-01.1', NOW(), 'web'
--            FROM staging.organisations LIMIT 1;
--        SELECT notice_version, source FROM staging.pahchan_notice_acknowledgements
--         WHERE user_id='user_probe' ORDER BY notice_version;   -- expect 2 rows
--      ROLLBACK;

-- 6. A row with no version is refused.
--      BEGIN;
--        INSERT INTO staging.pahchan_notice_acknowledgements
--          (org_id, user_id, notice_version, acknowledged_at, source)
--          SELECT id, 'user_probe', '   ', NOW(), 'mobile'
--            FROM staging.organisations LIMIT 1;
--        -- expect: violates pahchan_notice_acknowledgements_notice_version_check
--      ROLLBACK;

-- 7. The retention figures the notice renders are readable per org. Line 4 of
--    the notice is built from exactly this row, live:
--      SELECT o.name, p.punch_photo_retention_days, p.reference_photo_grace_days,
--             p.record_retention_years
--        FROM staging.organisations o
--        LEFT JOIN staging.pahchan_policy p ON p.org_id = o.id
--       ORDER BY o.name;


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS staging.pahchan_notice_acknowledgements;
--
-- Safe while nothing reads it. AFTER the gate ships, dropping this table drops
-- the org's only evidence that its workers were told what is being recorded
-- about their faces, and that evidence cannot be reconstructed.


-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
--
-- THE GATE MUST CLEAR WITHOUT THIS TABLE. The mobile gate's local MMKV entry,
-- keyed on the version string, is the authority for whether to show the notice
-- again on that device. The server row is the ORG'S EVIDENCE, not the device's
-- permission slip. If this migration is unapplied, or the POST 404s, or the
-- phone is in a basement, the tap still clears the gate and the punch still
-- happens — a compliance record that can block attendance has become an
-- availability incident wearing a compliance costume.
--
-- NO COLUMN FOR THE NOTICE TEXT. The six lines live in
-- `frontend/src/lib/pahchanNotice.js` and `mobile/src/screens/pahchan/
-- noticeCopy.ts`, and the version string is the join between them. Storing the
-- prose here would make every copy edit a data migration and would still not
-- prove which bytes were on the screen.
--
-- NO CONSENT SEMANTICS ANYWHERE. The footer says it out loud: this is a notice,
-- not a consent form, and attendance is processed as a legitimate use for
-- employment. No column here is named `consent`, `agreed` or `opted_in`, and
-- none should be — a schema that says "consent" invites a screen that asks for
-- it, and a person who can say no to a notice they are legally owed is being
-- offered a choice that does not exist. The whole record is: this wording, this
-- person, this instant.
--
-- NOT A LEGAL OPINION. `07 §8` asks that counsel confirm the six lines before
-- launch. Nothing in this file is that confirmation.
