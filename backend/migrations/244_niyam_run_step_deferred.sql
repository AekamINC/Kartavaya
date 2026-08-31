-- 244 — `niyam_run_steps.outcome` admits 'deferred'.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  1. WHAT THIS DOES, AND WHY IT IS NEEDED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One CHECK constraint is replaced, gaining one value:
--
--   before  CHECK (outcome = ANY (ARRAY['ok','refused','failed','skipped','dry']))
--   after   CHECK (outcome = ANY (ARRAY['ok','deferred','refused','failed','skipped','dry']))
--
-- It goes with the engine change that makes a notification suppressed by quiet
-- hours WAIT instead of being destroyed.
--
-- Suite 16.14 measured the defect as "no run deferred, and none can":
-- `send.deliver` returned a flat `refused`, `NotifySend.run` turned that into a
-- refused ActionResult, and `run_pipeline` recorded the step and called
-- `_finish` — which stamps `finished_at` and NULLs `wake_at`. Nothing re-queued
-- it and no later sweep retried it. The message was gone.
--
-- The loss is not hypothetical. `send.INTERRUPTING`'s own comment records the
-- first armed rule in this product matching at 01:15 IST and the notification
-- it existed to send simply never happening.
--
-- `prefs_verdict` has always drawn the distinction the fix needs:
--
--     "A PREFERENCE is a decision: this person said they do not want this. It
--      is final, and re-asking later gives the same answer. QUIET HOURS are a
--      clock: this person does not want to be INTERRUPTED right now. It says
--      nothing about whether they want the message."
--
-- Nothing acted on it. A 'deferred' step row is that distinction made durable:
-- the run sleeps on `wake_at` (the same mechanism the `wait` step uses) and its
-- history says WHY, rather than leaving an unexplained sleeping run.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  2. WRITE-PATH SIDE EFFECTS — STATED BEFORE RUNNING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DDL only: one CHECK dropped, one added. No row is read, written or deleted
-- by this migration.
--
-- ⚠ WITHOUT IT THE ENGINE RAISES. `_record` runs OUTSIDE `run_pipeline`'s
-- try/except, so a 23514 on the first deferral would propagate and kill the
-- whole drain tick — not just that rule. This migration must land BEFORE or
-- WITH the deploy that can write the value; it is not optional and it is not
-- an optimisation.
--
-- What changes in behaviour once both are live: a rule whose every recipient is
-- inside their quiet window records a 'deferred' step, sets `wake_at` to the
-- end of the earliest window, and re-runs that step when a later sweep wakes
-- it. Runs that previously finished as 'refused' at 01:15 will instead deliver
-- at 07:00.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  3. BLAST RADIUS — MEASURED, NOT ESTIMATED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WIDENING a CHECK cannot invalidate an existing row: every value the old
-- constraint admitted, the new one admits. Postgres still validates the table
-- on ADD CONSTRAINT, so the statement itself proves that rather than assuming
-- it — and a table this size validates instantly.
--
-- Read live 2026-08-31 before running this file:
--
--     outcome    rows
--     ok          194
--     dry          90
--     refused      39
--                 ---
--                 323     0 of them 'deferred'
--
-- No view, index or foreign key depends on the constraint. ('skipped' is
-- declared and unused — the engine has never written one.)
--
-- ═══════════════════════════════════════════════════════════════════════════
--  4. REVERSAL
-- ═══════════════════════════════════════════════════════════════════════════
--
--   ALTER TABLE public.niyam_run_steps
--     DROP CONSTRAINT niyam_run_steps_outcome_ck;
--   ALTER TABLE public.niyam_run_steps
--     ADD CONSTRAINT niyam_run_steps_outcome_ck
--     CHECK (outcome = ANY (ARRAY['ok','refused','failed','skipped','dry']));
--
-- ⚠ THE REVERSAL FAILS IF ANY 'deferred' ROW EXISTS, which is correct: it
-- would be narrowing a constraint against live data. Delete or re-outcome
-- those rows first, and understand that doing so abandons the sends they are
-- holding.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  5. VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The assertion below raises unless the new constraint is present AND admits
-- 'deferred'. It tests the VALUE rather than the constraint's text, because a
-- constraint that exists and refuses the one value it was widened for is the
-- failure this is guarding against.
--
-- Held forward by `backend/tests/test_niyam_defers_quiet_hours.py`.

BEGIN;

ALTER TABLE public.niyam_run_steps
  DROP CONSTRAINT IF EXISTS niyam_run_steps_outcome_ck;

ALTER TABLE public.niyam_run_steps
  ADD CONSTRAINT niyam_run_steps_outcome_ck
  CHECK (outcome = ANY (ARRAY['ok'::text, 'deferred'::text, 'refused'::text,
                              'failed'::text, 'skipped'::text, 'dry'::text]));

DO $$
BEGIN
    -- Prove the value is admitted, then roll the probe back. A savepoint
    -- rather than a trial INSERT left behind: the check must not create a run
    -- step for a run that does not exist.
    BEGIN
        INSERT INTO public.niyam_run_steps (run_step_id, run_id, step_no, outcome)
        VALUES ('rs_migration_244_probe', 'run_migration_244_probe', 0, 'deferred');
        RAISE EXCEPTION 'probe_ok';
    EXCEPTION
        WHEN check_violation THEN
            RAISE EXCEPTION
              'migration 244: niyam_run_steps still refuses outcome=''deferred'' '
              '— the engine would 23514 on the first quiet-hours deferral and '
              'kill the drain tick';
        WHEN foreign_key_violation THEN
            -- The CHECK passed and the FK to niyam_runs refused the fake id,
            -- which is the outcome this probe wants: the value is admitted.
            NULL;
        WHEN OTHERS THEN
            IF SQLERRM = 'probe_ok' THEN
                RAISE EXCEPTION
                  'migration 244: the probe row was accepted and would have been '
                  'left behind — no foreign key refused run_migration_244_probe';
            END IF;
            RAISE;
    END;
END $$;

COMMIT;
