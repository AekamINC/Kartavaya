-- 193 · Altitude on a site, and on the punch that is measured against it.
--
-- WHY
-- A horizontal geofence is a circle drawn on a map, so it covers the whole
-- footprint of a building. An office on the 10th floor shares that circle with
-- the ground-floor shops, the car park and the pavement. Every one of those
-- currently reads as "at the site".
--
-- WHAT ALTITUDE CAN AND CANNOT DO — read this before setting a tolerance.
-- GNSS vertical error runs roughly 1.5-3x the horizontal error: commonly
-- +/-10-20 m outdoors and worse indoors, which is exactly where an office is.
-- A storey is about 3 m. So this CANNOT distinguish floor 10 from floor 9, and
-- a tolerance tight enough to try will flag honest punches all day.
-- It CAN distinguish a 10th floor (~30-35 m up) from street level, because that
-- separation is larger than the noise. Set `altitude_tolerance_m` accordingly:
-- half the building's height above the floor below you is a sane starting
-- point, and 15 m is the smallest value that is not mostly noise.
--
-- NULL means "do not check". A site with no altitude behaves exactly as it does
-- today, which is why this migration changes no existing behaviour.
--
-- SIDE EFFECTS ON THE WRITE PATH
-- None. Four nullable columns, no default, no backfill, no constraint on
-- existing rows. Every current INSERT names its columns explicitly and keeps
-- working. Staging and production share this database, and both read the same
-- 9 site rows and 1,659 punch rows — after this migration all four columns are
-- NULL on every one of them, so no punch changes verdict and no report moves.
--
-- REVERSIBLE
-- Yes, in full: the DOWN block drops four columns that nothing else references.

BEGIN;

-- ── The site: where the floor is, and how much slack to allow ────────────────
ALTER TABLE staging.pahchan_sites
  ADD COLUMN IF NOT EXISTS altitude_m           numeric,
  ADD COLUMN IF NOT EXISTS altitude_tolerance_m integer;

COMMENT ON COLUMN staging.pahchan_sites.altitude_m IS
  'Metres above sea level of the site floor. NULL = altitude is not checked here.';
COMMENT ON COLUMN staging.pahchan_sites.altitude_tolerance_m IS
  'Permitted vertical difference in metres. NULL = not checked. Below ~15 m is '
  'smaller than GNSS vertical noise and will flag honest punches.';

-- A tolerance without an altitude is meaningless, and an altitude below sea
-- level or above the tallest building is a typo rather than a site. Both are
-- written as NOT VALID so the 9 existing rows are not re-checked; they are all
-- NULL and would pass anyway, but this keeps the migration non-blocking.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'pahchan_sites_altitude_pair_ck') THEN
    ALTER TABLE staging.pahchan_sites
      ADD CONSTRAINT pahchan_sites_altitude_pair_ck
      CHECK (altitude_tolerance_m IS NULL OR altitude_m IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'pahchan_sites_altitude_sane_ck') THEN
    ALTER TABLE staging.pahchan_sites
      ADD CONSTRAINT pahchan_sites_altitude_sane_ck
      CHECK (altitude_m IS NULL OR (altitude_m > -500 AND altitude_m < 9000)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'pahchan_sites_altitude_tolerance_positive_ck') THEN
    ALTER TABLE staging.pahchan_sites
      ADD CONSTRAINT pahchan_sites_altitude_tolerance_positive_ck
      CHECK (altitude_tolerance_m IS NULL OR altitude_tolerance_m > 0) NOT VALID;
  END IF;
END $$;

-- ── The punch: what the device reported, and how sure it was ─────────────────
-- Both nullable and never defaulted to 0. A device that does not report
-- altitude must stay distinguishable from one that reports sea level, exactly
-- as `accuracy_m` already is — 0 would read as a perfect fix at the shoreline.
ALTER TABLE staging.pahchan_punches
  ADD COLUMN IF NOT EXISTS altitude_m          numeric,
  ADD COLUMN IF NOT EXISTS altitude_accuracy_m numeric;

COMMENT ON COLUMN staging.pahchan_punches.altitude_m IS
  'Metres above sea level reported by the device. NULL = not reported. Never 0 as a default.';
COMMENT ON COLUMN staging.pahchan_punches.altitude_accuracy_m IS
  'The device''s own vertical confidence in metres. NULL = not reported.';

COMMIT;

-- ── DOWN ─────────────────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE staging.pahchan_sites
--   DROP CONSTRAINT IF EXISTS pahchan_sites_altitude_pair_ck,
--   DROP CONSTRAINT IF EXISTS pahchan_sites_altitude_sane_ck,
--   DROP CONSTRAINT IF EXISTS pahchan_sites_altitude_tolerance_positive_ck;
-- ALTER TABLE staging.pahchan_sites
--   DROP COLUMN IF EXISTS altitude_m,
--   DROP COLUMN IF EXISTS altitude_tolerance_m;
-- ALTER TABLE staging.pahchan_punches
--   DROP COLUMN IF EXISTS altitude_m,
--   DROP COLUMN IF EXISTS altitude_accuracy_m;
-- COMMIT;
