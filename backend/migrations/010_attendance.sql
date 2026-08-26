-- migration 010: attendance_entries — self-service clock in/out with geolocation
-- Run: psql $DATABASE_URL -f backend/migrations/010_attendance.sql
--
-- One row per (user, work_date). work_date is the IST calendar date, computed
-- server-side at clock-in so a shift is filed against the day the employee
-- actually started, regardless of the device clock or timezone.
--
-- Every timestamp is written with NOW() on the server. The client only ever
-- supplies geolocation; it never supplies the time.

CREATE TABLE IF NOT EXISTS public.attendance_entries (
  entry_id        TEXT PRIMARY KEY DEFAULT ('att_' || substr(gen_random_uuid()::text, 1, 12)),
  user_id         TEXT NOT NULL,
  work_date       DATE NOT NULL,

  clock_in_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_at    TIMESTAMPTZ,
  minutes         INTEGER,

  -- Geolocation captured by the browser at clock-in (W3C Geolocation API).
  -- All nullable: the employee may decline the permission, and a missing
  -- fix must never block someone from recording their shift.
  in_latitude          DOUBLE PRECISION,
  in_longitude         DOUBLE PRECISION,
  in_altitude          DOUBLE PRECISION,   -- metres above the WGS-84 ellipsoid
  in_accuracy_m        DOUBLE PRECISION,   -- horizontal accuracy, metres
  in_altitude_accuracy_m DOUBLE PRECISION, -- vertical accuracy, metres
  in_source            TEXT,               -- 'ios-pwa' | 'android-pwa' | 'browser' | 'app'

  out_latitude          DOUBLE PRECISION,
  out_longitude         DOUBLE PRECISION,
  out_altitude          DOUBLE PRECISION,
  out_accuracy_m        DOUBLE PRECISION,
  out_altitude_accuracy_m DOUBLE PRECISION,
  out_source            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT attendance_entries_user_date_uniq UNIQUE (user_id, work_date),
  CONSTRAINT attendance_entries_in_lat_range  CHECK (in_latitude  IS NULL OR in_latitude  BETWEEN  -90 AND  90),
  CONSTRAINT attendance_entries_in_lng_range  CHECK (in_longitude IS NULL OR in_longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_entries_out_lat_range CHECK (out_latitude  IS NULL OR out_latitude  BETWEEN  -90 AND  90),
  CONSTRAINT attendance_entries_out_lng_range CHECK (out_longitude IS NULL OR out_longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_entries_out_after_in  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

CREATE INDEX IF NOT EXISTS idx_attendance_entries_user_date
  ON public.attendance_entries(user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_entries_work_date
  ON public.attendance_entries(work_date DESC);
-- Partial index for "who is still clocked in right now"
CREATE INDEX IF NOT EXISTS idx_attendance_entries_open
  ON public.attendance_entries(user_id) WHERE clock_out_at IS NULL;

-- RLS: FastAPI connects as the service role, so these guard PostgREST only.
ALTER TABLE public.attendance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_entries_own_select"
  ON public.attendance_entries FOR SELECT
  USING (
    user_id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.user_id = (SELECT auth.uid()::text) AND u.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "attendance_entries_own_write"
  ON public.attendance_entries FOR ALL
  USING (user_id = (SELECT auth.uid()::text))
  WITH CHECK (user_id = (SELECT auth.uid()::text));
