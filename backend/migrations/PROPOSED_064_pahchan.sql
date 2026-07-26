-- PROPOSED — NOT APPLIED. Review before running.
--
-- No runnable sequence number, deliberately: migrations here are applied by hand
-- (`_run_startup_migrations()` in server.py holds inline SQL only and early-returns
-- on an existing database), and staging + production are two schemas in ONE
-- Supabase project, so every statement below is a write against live data.
--
-- Test path that does not touch Supabase: `backend/scripts/setup_local_db.py`
-- applies migrations to a local Postgres and seeds an org. Rename this file to
-- `064_pahchan.sql` once reviewed.
--
-- Spec: design-handover/07-pahchan.md. Contract in §4, retention in §5,
-- degraded-case behaviour in §2, platform visibility in §7.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · Sites (geofences)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.pahchan_sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    lat         NUMERIC(10, 7) NOT NULL,
    lng         NUMERIC(10, 7) NOT NULL,
    -- 07 §default: 150m. Tight enough to mean something, loose enough that a
    -- gate 60m from the pin does not flag every legitimate punch.
    radius_m    INT NOT NULL DEFAULT 150 CHECK (radius_m > 0),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pahchan_sites_org ON staging.pahchan_sites(org_id) WHERE is_active;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Punches
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.pahchan_punches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id   UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),

    -- 07 §4: captured_at and received_at are BOTH required and are NOT
    -- interchangeable. An offline punch captured 09:41 and synced 11:38 is a
    -- 09:41 punch; using receipt time silently rewrites attendance for anyone
    -- with poor signal. The gap between them is also the only honest place to
    -- spot a device clock that has been moved, which is why neither is derived
    -- from the other.
    captured_at   TIMESTAMPTZ NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at     TIMESTAMPTZ,

    -- Object-store key, never a URL. 07 §1 and the standing rule that a public
    -- URL for a face photo is a serious exposure: URLs are minted per request,
    -- short-lived and signed.
    photo_key     TEXT,

    lat           NUMERIC(10, 7),
    lng           NUMERIC(10, 7),
    -- 07 §4: never omitted and NEVER DEFAULTED TO 0. A missing accuracy is NULL
    -- and flags. Zero would read as a perfect fix, which is the opposite of the
    -- truth and would clear the accuracy check it should fail.
    accuracy_m    NUMERIC(8, 2),
    distance_m    NUMERIC(10, 2),
    geofence_id   UUID REFERENCES staging.pahchan_sites(id) ON DELETE SET NULL,

    source        TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'offline')),
    -- NULL means "not checked on this platform", which is different from FALSE
    -- meaning "checked, and clean". Collapsing them would let an unchecked
    -- platform look verified.
    mock_location BOOLEAN,

    -- 07 §2: every degraded case records and flags. Array rather than booleans
    -- because the set grows (late, geo, noref, accuracy, offline, overtime, mock)
    -- and a new flag should not be a migration.
    flags         TEXT[] NOT NULL DEFAULT '{}',

    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    review_verdict  TEXT CHECK (review_verdict IN ('ok', 'flagged')),

    -- Idempotency. Generated on the device at capture and never regenerated on
    -- retry, so a timeout-then-success cannot create two attendance records.
    -- Unique per org rather than globally: it is a client-generated value and two
    -- tenants must not be able to collide.
    client_punch_id TEXT NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pahchan_punches_client_id_unique UNIQUE (org_id, client_punch_id),
    -- A review verdict without a reviewer is unattributable, and a reviewer
    -- without a verdict is an open record pretending to be closed.
    CONSTRAINT pahchan_punches_review_complete CHECK (
        (reviewed_by IS NULL AND reviewed_at IS NULL AND review_verdict IS NULL)
        OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_verdict IS NOT NULL)
    )
);

-- The register is "today, this org, oldest first" — that is the only hot query.
CREATE INDEX IF NOT EXISTS idx_pahchan_punches_org_day
    ON staging.pahchan_punches(org_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_pahchan_punches_employee
    ON staging.pahchan_punches(employee_id, captured_at DESC);
-- The exceptions queue reads only flagged-and-unreviewed. Partial, so it stays
-- small as the table grows into years of clean punches.
CREATE INDEX IF NOT EXISTS idx_pahchan_punches_unreviewed
    ON staging.pahchan_punches(org_id, captured_at DESC)
    WHERE review_verdict IS NULL AND flags <> '{}';

COMMENT ON COLUMN staging.pahchan_punches.photo_key IS
    'Private object-store key. Deleted at the punch-selfie retention horizon '
    '(default 90 days) WITHOUT deleting this row — 07 §5: the three retention '
    'classes are independent, and the record outlives the photo by law.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Enrollment reference photos — exactly two per employee
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.pahchan_enrollment_photos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id   UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    -- Two, not one: 07 §0. Slot 1 frontal, slot 2 at an angle. One frontal photo
    -- gives a single embedding that fails on anyone who turns their head, and
    -- re-enrolling every client's workforce later is the migration that quietly
    -- kills v2.
    slot          SMALLINT NOT NULL CHECK (slot IN (1, 2)),
    object_key    TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('hr_upload', 'self_capture')),
    uploaded_by   TEXT,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL = pending. A self-captured photo is evidence nobody has vouched for
    -- until HR approves it.
    approved_by   TEXT,
    approved_at   TIMESTAMPTZ,
    -- Soft history. Swapping a reference photo to match a different face is the
    -- obvious attack, so a replacement must be visible rather than overwriting.
    replaced_at   TIMESTAMPTZ,
    replaced_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live photo per slot per employee. Replaced rows are excluded, so history
-- accumulates without ever colliding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pahchan_ref_live
    ON staging.pahchan_enrollment_photos(employee_id, slot)
    WHERE replaced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pahchan_ref_pending
    ON staging.pahchan_enrollment_photos(org_id)
    WHERE approved_at IS NULL AND replaced_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · Regularisations — the employee's remedy when a punch is missing or wrong
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.pahchan_regularisations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id   UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    -- NULL when the punch never existed — the 72-hour offline buffer expired, or
    -- the phone was flat. That is the case this table mostly exists for.
    punch_id      UUID REFERENCES staging.pahchan_punches(id) ON DELETE SET NULL,
    for_date      DATE NOT NULL,
    requested_direction TEXT CHECK (requested_direction IN ('in', 'out')),
    requested_at_time   TIMESTAMPTZ,
    reason        TEXT NOT NULL,
    evidence_key  TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'declined')),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    -- 07's approval pattern: a decline is gated on a reason. Enforced here as
    -- well as in the UI, because a UI-only gate is one API call from bypassed.
    decision_note TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pahchan_reg_decline_needs_reason CHECK (
        status <> 'declined' OR (decision_note IS NOT NULL AND length(trim(decision_note)) > 0)
    )
);
CREATE INDEX IF NOT EXISTS idx_pahchan_reg_pending
    ON staging.pahchan_regularisations(org_id, for_date DESC) WHERE status = 'pending';

-- ═════════════════════════════════════════════════════════════════════════════
-- 5 · Policy — one row per org
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.pahchan_policy (
    org_id                     UUID PRIMARY KEY
                               REFERENCES staging.organisations(id) ON DELETE CASCADE,
    default_radius_m           INT NOT NULL DEFAULT 150 CHECK (default_radius_m > 0),
    grace_minutes              INT NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
    -- 07 §2: outside the geofence records and flags, "configurable, default
    -- allow". Allowing by default is the whole point — a blocked punch at a
    -- client site becomes a payroll dispute a week later, and the employee is right.
    allow_outside_geofence     BOOLEAN NOT NULL DEFAULT TRUE,
    accuracy_flag_threshold_m  INT NOT NULL DEFAULT 100 CHECK (accuracy_flag_threshold_m > 0),

    -- 07 §5. Three independent classes; deleting a photo must not cascade to the
    -- record, and expiring a record must not orphan a photo. "Deleted means
    -- deleted, not archived to cold storage — a retention promise with an archive
    -- behind it is not a retention promise."
    punch_photo_retention_days      INT NOT NULL DEFAULT 90  CHECK (punch_photo_retention_days > 0),
    reference_photo_grace_days      INT NOT NULL DEFAULT 45  CHECK (reference_photo_grace_days > 0),
    record_retention_years          INT NOT NULL DEFAULT 3   CHECK (record_retention_years > 0),

    -- Daily / weekly / monthly reports go to these recipients. Reports carry no
    -- photographs (07 §6) — a mailbox is not a place retention can be enforced.
    report_recipients          JSONB NOT NULL DEFAULT '[]',
    report_daily               BOOLEAN NOT NULL DEFAULT TRUE,
    report_weekly              BOOLEAN NOT NULL DEFAULT TRUE,
    report_monthly             BOOLEAN NOT NULL DEFAULT TRUE,

    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 6 · Platform visibility — a scalar, enforced in the query
-- ═════════════════════════════════════════════════════════════════════════════
--
-- 07 §7: Aekam sees the COUNT of Pahchan users per organisation and nothing else.
-- No names, no photographs, no locations, no times.
--
-- "Enforce this in the query, not the view. A console endpoint that fetches the
-- roster and returns a length has already read the roster, and the first support
-- ticket asking 'which employee?' is one line away from being answerable."
--
-- Hence a view that cannot return a row per person even if someone selects * from
-- it. It aggregates before it leaves the database.

CREATE OR REPLACE VIEW staging.pahchan_org_usage AS
SELECT org_id,
       COUNT(DISTINCT employee_id) AS active_users,
       MAX(captured_at)            AS last_punch_at
  FROM staging.pahchan_punches
 WHERE captured_at > NOW() - INTERVAL '30 days'
 GROUP BY org_id;

COMMENT ON VIEW staging.pahchan_org_usage IS
    'Platform-surface aggregate. Deliberately has no employee_id column: 07 §7 '
    'limits Aekam to a count per org. Do not add identifying columns here — the '
    'platform console must not be able to answer "which employee?".';

-- ═════════════════════════════════════════════════════════════════════════════
-- 7 · Risk and rollback
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SHARED DATABASE. staging.* only; public.* untouched. Verify the schema
-- qualifier on every statement before running.
--
-- All CREATE IF NOT EXISTS, so re-running is a no-op. Nothing here alters or
-- drops an existing object, and no existing table is touched except by the two
-- foreign keys into organisations and manav_employees, which take a lock only
-- long enough to validate.
--
-- ROLLBACK, in dependency order:
--   DROP VIEW  IF EXISTS staging.pahchan_org_usage;
--   DROP TABLE IF EXISTS staging.pahchan_regularisations;
--   DROP TABLE IF EXISTS staging.pahchan_enrollment_photos;
--   DROP TABLE IF EXISTS staging.pahchan_punches;
--   DROP TABLE IF EXISTS staging.pahchan_policy;
--   DROP TABLE IF EXISTS staging.pahchan_sites;
--
-- Rollback is clean only while these tables hold no punches. Once a workforce
-- has clocked in, a punch is a payroll fact and dropping the table destroys pay
-- records — at that point the rollback is a restore, not a DROP.
--
-- ONE THING THIS MIGRATION DOES NOT DO: the retention jobs. Three independent
-- deletions (photo at 90 days, reference photo at employment + 45, record at
-- 3 years) need a scheduled task each. `retention-cron` already exists on Railway
-- and is where they belong. Creating the columns without the jobs means the
-- retention promise is documented and not kept, so those land in the same release
-- or the promise is not made to a client yet.
