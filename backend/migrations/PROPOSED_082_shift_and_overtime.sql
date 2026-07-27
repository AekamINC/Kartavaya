-- PROPOSED — the shift definition, and overtime. Review before running.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `services/attendance_bridge.py` refuses to compute overtime, and says why:
-- there is no shift definition anywhere in this product. `pahchan_policy` holds
-- geofence radius, grace minutes and retention periods — no start time, no
-- expected hours, no threshold. Deriving overtime without one means inventing a
-- standard day, and an invented number that reaches a payslip is worse than an
-- absent one, because it looks authoritative and nobody re-derives it.
--
-- This is that missing definition. It is also what resolves the overnight-shift
-- problem the bridge flagged: a punch at 01:00 belongs to the shift that started
-- at 22:00 the previous day, and nothing in the schema could express that.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFAULTS ARE STATUTORY, NOT INVENTED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Factories Act 1948 — the frame most Indian employers work inside:
--
--   §54  no more than NINE hours in any day
--   §51  no more than FORTY-EIGHT hours in any week
--   §59  work beyond either is paid at TWICE the ordinary rate of wages
--
-- So `overtime_daily_threshold_hours` is 9 and not 8: the ninth hour is ordinary
-- time under the Act, and paying it at 2x would be as wrong as not paying the
-- tenth. `standard_hours_per_day` is separate at 8 because it is the contracted
-- day, which is what an absence or a half-day is measured against — two
-- different facts that get conflated precisely because they are usually equal.
--
-- State Shops & Establishments Acts differ, which is why every one of these is
-- a per-org column and not a constant.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OVERTIME IS OFF BY DEFAULT, DELIBERATELY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `overtime_enabled` defaults FALSE. Every existing org already has attendance
-- flowing to payroll with `overtime_hours` untouched; switching this on by
-- default would change what people are paid, retroactively, on the strength of
-- a migration nobody asked for. An org turns it on when its policy is set.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Purely additive: nine columns, all NOT NULL with defaults, on a table with one
-- row per org (2 rows today). No existing column is read or modified, and no
-- code that runs today selects any of them. `ADD COLUMN ... DEFAULT` does not
-- rewrite the table on PostgreSQL 11+, so the lock is momentary.
--
-- Production safety: `main` has no Pahchan code at all, so production cannot be
-- affected whether or not this runs.

BEGIN;

ALTER TABLE staging.pahchan_policy
    -- The contracted day. What a half-day or an absence is measured against.
    ADD COLUMN IF NOT EXISTS standard_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8.00
        CHECK (standard_hours_per_day > 0 AND standard_hours_per_day <= 24),

    -- Factories Act §54. Beyond this in a single day is overtime.
    ADD COLUMN IF NOT EXISTS overtime_daily_threshold_hours NUMERIC(4,2) NOT NULL DEFAULT 9.00
        CHECK (overtime_daily_threshold_hours > 0 AND overtime_daily_threshold_hours <= 24),

    -- Factories Act §51. Beyond this in a week is overtime even if no single
    -- day crossed the daily threshold.
    ADD COLUMN IF NOT EXISTS overtime_weekly_threshold_hours NUMERIC(5,2) NOT NULL DEFAULT 48.00
        CHECK (overtime_weekly_threshold_hours > 0 AND overtime_weekly_threshold_hours <= 168),

    -- Factories Act §59. Stored because it varies by state and by contract, and
    -- because a rate applied in code is a rate nobody can audit.
    ADD COLUMN IF NOT EXISTS overtime_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.00
        CHECK (overtime_multiplier >= 1),

    -- Off until an org sets its policy. See above.
    ADD COLUMN IF NOT EXISTS overtime_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    -- ISO-8601 numbering: 1 = Monday … 7 = Sunday. The weekly threshold is
    -- meaningless without knowing where the week starts, and the answer differs
    -- by employer.
    ADD COLUMN IF NOT EXISTS week_starts_on SMALLINT NOT NULL DEFAULT 1
        CHECK (week_starts_on BETWEEN 1 AND 7),

    -- The shift window. Nullable as a pair: an org with no fixed shift leaves
    -- both NULL and every day is bounded by its own punches, which is exactly
    -- today's behaviour.
    ADD COLUMN IF NOT EXISTS shift_start_time TIME,
    ADD COLUMN IF NOT EXISTS shift_end_time   TIME,

    -- When the shift crosses midnight, a punch after midnight belongs to the
    -- PREVIOUS day's shift. Without this the bridge splits one night into two
    -- half-days, and both look like someone forgot to clock out.
    ADD COLUMN IF NOT EXISTS overnight_shift BOOLEAN NOT NULL DEFAULT FALSE;

-- A shift is a window or it is nothing. One end without the other cannot bound
-- a day, and an overnight flag with no window has nothing to shift.
ALTER TABLE staging.pahchan_policy
    DROP CONSTRAINT IF EXISTS pahchan_policy_shift_window_complete;
ALTER TABLE staging.pahchan_policy
    ADD CONSTRAINT pahchan_policy_shift_window_complete
    CHECK (
        (shift_start_time IS NULL AND shift_end_time IS NULL)
        OR (shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL)
    );

ALTER TABLE staging.pahchan_policy
    DROP CONSTRAINT IF EXISTS pahchan_policy_overnight_needs_window;
ALTER TABLE staging.pahchan_policy
    ADD CONSTRAINT pahchan_policy_overnight_needs_window
    CHECK (overnight_shift IS FALSE OR shift_start_time IS NOT NULL);

-- The daily threshold below the contracted day would mean every ordinary day
-- earns overtime — always a misconfiguration, never an intent.
ALTER TABLE staging.pahchan_policy
    DROP CONSTRAINT IF EXISTS pahchan_policy_ot_threshold_sane;
ALTER TABLE staging.pahchan_policy
    ADD CONSTRAINT pahchan_policy_ot_threshold_sane
    CHECK (overtime_daily_threshold_hours >= standard_hours_per_day);

COMMENT ON COLUMN staging.pahchan_policy.overtime_daily_threshold_hours IS
    'Factories Act 1948 §54 — nine hours. Hours beyond this in one day are '
    'overtime. Distinct from standard_hours_per_day, which is the contracted '
    'day; the ninth hour is ordinary time under the Act.';

COMMENT ON COLUMN staging.pahchan_policy.overtime_enabled IS
    'FALSE until the org sets its policy. Enabling it changes what people are '
    'paid, so it is never switched on by a migration.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT org_id, standard_hours_per_day, overtime_daily_threshold_hours,
--          overtime_weekly_threshold_hours, overtime_multiplier,
--          overtime_enabled, week_starts_on, shift_start_time, shift_end_time,
--          overnight_shift
--     FROM staging.pahchan_policy;
--
-- Every org should show 8.00 / 9.00 / 48.00 / 2.00 / false / 1 / NULL / NULL /
-- false. Nobody's pay has changed, because overtime_enabled is false everywhere.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Safe while no org has enabled overtime. If one has, its published attendance
-- carries overtime_hours that this rollback makes underivable — the numbers
-- survive in manav_attendance but nothing can reproduce them.
--
--   SELECT count(*) FROM staging.pahchan_policy WHERE overtime_enabled;  -- 0
--
--   BEGIN;
--   ALTER TABLE staging.pahchan_policy
--       DROP CONSTRAINT IF EXISTS pahchan_policy_ot_threshold_sane,
--       DROP CONSTRAINT IF EXISTS pahchan_policy_overnight_needs_window,
--       DROP CONSTRAINT IF EXISTS pahchan_policy_shift_window_complete,
--       DROP COLUMN IF EXISTS overnight_shift,
--       DROP COLUMN IF EXISTS shift_end_time,
--       DROP COLUMN IF EXISTS shift_start_time,
--       DROP COLUMN IF EXISTS week_starts_on,
--       DROP COLUMN IF EXISTS overtime_enabled,
--       DROP COLUMN IF EXISTS overtime_multiplier,
--       DROP COLUMN IF EXISTS overtime_weekly_threshold_hours,
--       DROP COLUMN IF EXISTS overtime_daily_threshold_hours,
--       DROP COLUMN IF EXISTS standard_hours_per_day;
--   COMMIT;
