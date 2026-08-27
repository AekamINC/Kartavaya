-- 236 — drop public.report_schedules, the retired team-scoped report scheduler.
--
-- OWNER'S DECISION, 2026-08-27 ("agree"). This is the 24th and last table of
-- the Phase 6 retirement list; 234 took twenty and 235 took three.
--
-- ── THE TABLE WAS NEVER THE RISK ─────────────────────────────────────────────
--
-- It has held 0 rows for its entire life. What made this dangerous was
-- everything AROUND it, and all of it had to go FIRST — this migration is the
-- last step, not the first:
--
--   * routers/reports.py held the CRUD and `dispatch_reports`  -> removed
--   * server.py recreated the table on EVERY STARTUP           -> removed
--   * invite_router.py ran two UNQUALIFIED statements on the
--     user-deletion path                                       -> removed
--   * an armed hourly Railway cron called the dispatcher       -> deleted
--
-- The startup recreate is the one that decides whether this migration means
-- anything. `CREATE TABLE IF NOT EXISTS public.report_schedules` ran on every
-- boot, so dropping the table before removing it would have brought it back
-- empty on the next deploy — and an empty table that has returned is
-- indistinguishable from one that was never dropped. `tests/
-- test_report_retirement.py` fails if any of the four ever comes back.
--
-- ── WHAT REPLACES IT ─────────────────────────────────────────────────────────
--
-- `staging.dristi_scheduled_reports` — per-org, 7 live rows, its own sweep at
-- POST /api/v1/dristi/scheduled-reports/dispatch. It is being armed in the same
-- change. There were two scheduled-report systems, two dispatchers and a timer
-- on the WRONG ONE: the empty table was swept hourly while seven schedules real
-- people configured had never dispatched once.
--
-- ── MEASURED LIVE BEFORE WRITING THIS, read-only, 2026-08-27 ─────────────────
--
--   public.report_schedules      0 rows  (count(*), never n_live_tup)
--   staging.report_schedules     does not exist  — checked, because a 42P01
--                                from one schema says nothing about the other,
--                                and THAT mistake is what made 6.4 look closed
--                                for a day
--   inbound foreign keys         none
--   triggers                     none
--   function bodies naming it    none   <- checked deliberately: a PL/pgSQL body
--                                is parsed when it RUNS, so Postgres records no
--                                dependency and a DROP would SUCCEED and leave a
--                                trigger raising 42P01. Migration 235 found
--                                exactly that on sales_targets.
--   views / matviews             none
--
-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
-- No migration ever created this table — it only ever existed because
-- server.py's startup made it — so the reversal is NOT recoverable from the
-- migration history. It is therefore written out here in full, read from
-- pg_catalog before the drop:
--
--   CREATE TABLE public.report_schedules (
--       schedule_id   TEXT PRIMARY KEY
--                     DEFAULT ('sched_' || substr(gen_random_uuid()::text, 1, 12)),
--       team_id       TEXT NOT NULL,
--       created_by    TEXT NOT NULL,
--       frequency     TEXT NOT NULL,
--       file_formats  TEXT[] NOT NULL DEFAULT '{pdf}'::text[],
--       recipients    TEXT[] NOT NULL DEFAULT '{}'::text[],
--       day_of_week   SMALLINT,
--       day_of_month  SMALLINT,
--       send_hour_utc SMALLINT NOT NULL DEFAULT 2,
--       is_active     BOOLEAN NOT NULL DEFAULT TRUE,
--       last_sent_at  TIMESTAMPTZ,
--       next_run_at   TIMESTAMPTZ,
--       created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
--       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
--       org_id        UUID
--   );
--   CREATE INDEX idx_report_sched_team ON public.report_schedules (team_id);
--   CREATE INDEX idx_report_sched_next ON public.report_schedules (next_run_at)
--       WHERE is_active = TRUE;
--   CREATE INDEX idx_report_schedules_org_id ON public.report_schedules (org_id);
--
-- There is no data to restore. The table has never held a row.

BEGIN;

DO $guard$
DECLARE
    n_rows   bigint;
    n_dep    bigint;
BEGIN
    -- Re-counted INSIDE the transaction, so a row created since the audit
    -- aborts the drop rather than being silently discarded with the table.
    SELECT count(*) INTO n_rows FROM public.report_schedules;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'public.report_schedules holds % row(s) — it held 0 when this was '
            'written. Somebody created a schedule. Do NOT drop it; find out who.',
            n_rows;
    END IF;

    -- A dependency Postgres DOES record.
    SELECT count(*) INTO n_dep
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace rns ON rns.oid = ref.relnamespace
     WHERE con.contype = 'f'
       AND rns.nspname = 'public' AND ref.relname = 'report_schedules';
    IF n_dep <> 0 THEN
        RAISE EXCEPTION 'inbound foreign key(s) to public.report_schedules: %', n_dep;
    END IF;

    -- And the one it does NOT record. Migration 235 hit exactly this: a
    -- PL/pgSQL body naming a table creates no catalogue dependency, so the
    -- DROP succeeds and leaves a trigger that 42P01s on the next write.
    SELECT count(*) INTO n_dep
      FROM pg_proc p
     WHERE p.prosrc ~ 'report_schedules'
       AND p.prosrc !~ 'dristi_scheduled_reports';
    IF n_dep <> 0 THEN
        RAISE EXCEPTION
            'a function body still names report_schedules (% found) — dropping '
            'would leave it raising 42P01 at runtime with no error here', n_dep;
    END IF;
END
$guard$;

-- NO CASCADE, deliberately and for the same reason as 234 and 235: if a
-- dependency exists that the guards above missed, this statement must FAIL and
-- leave the database as it was. CASCADE would remove it silently and the report
-- would read "it worked".
DROP TABLE public.report_schedules;

COMMIT;
