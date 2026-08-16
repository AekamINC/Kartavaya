-- 146_niyam_retention.sql
--
-- Retention for `staging.niyam_events`, and the two things that make a plain
-- DELETE the wrong answer.
--
-- ── TRAP 1: DELETING A ROW RE-ARMS ITS DEDUPE KEY ───────────────────────────
--
-- `predicates.py` says so in its own header: "the dedupe index lives on
-- niyam_events, so once a row ages out under retention the same key can be
-- written again. `once` therefore means 'once per retention window', not 'once
-- ever'."
--
-- So a short retention turns every `window='once'` predicate into a recurring
-- one. Delete a 30-day-old `tasks_overdue:task_abc` row and the next sweep
-- happily emits it again — and if a rule is armed on it, somebody is notified a
-- second time about a task that went overdue last month. The floor is therefore
-- not a tidiness preference, it is a correctness bound:
--
--     >= max(max_age_days) across predicates .......... 90 days
--     >  MAX_WAIT_MINUTES (validate.py, 30 days) ....... 30 days
--
-- 180 days is comfortably clear of both and still bounded. Below 90 the `once`
-- predicates start repeating themselves.
--
-- ── TRAP 2: AN EVENT CAN BE DELETED OUT FROM UNDER A SLEEPING RUN ───────────
--
-- `sweep.resume_waits` reads the event a run was created from. If it is gone it
-- finishes the run honestly — but the run then ends with no step row for the
-- steps it never took, which reads afterwards as a rule that did nothing rather
-- than a rule whose evidence was collected. So events are only removed when no
-- unfinished run references them. That is the `NOT EXISTS` below, and it is the
-- reason this is a function and not a one-line DELETE in a cron.
--
-- ── SIDE EFFECTS ────────────────────────────────────────────────────────────
--
-- Creates one function. Runs NOTHING on its own — nothing calls it yet, by
-- design: it is armed deliberately once there is a week of real traffic to size
-- it against. Measured 2026-08-16: 122 rows at ~555 bytes, so ~10 rows/day.
-- Nothing is close to needing this yet, which is exactly why it should be
-- written now rather than in a hurry later.
--
-- Reversible: DROP FUNCTION staging.niyam_prune_events(int).

CREATE OR REPLACE FUNCTION staging.niyam_prune_events(keep_days INT DEFAULT 180)
RETURNS TABLE (deleted_events BIGINT, kept_for_runs BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
    floor_days CONSTANT INT := 90;   -- the largest predicate max_age_days
    n_deleted  BIGINT;
    n_held     BIGINT;
BEGIN
    -- A caller who asks for less than the floor gets an error, not a silent
    -- clamp. Silently overriding a number somebody typed is how the next
    -- person concludes the parameter does nothing.
    IF keep_days < floor_days THEN
        RAISE EXCEPTION
            'niyam_prune_events: keep_days=% is below the % day floor. Deleting '
            'an event re-arms its dedupe key, so a shorter window makes every '
            '''once'' predicate emit again and re-notify people about facts '
            'from last month.', keep_days, floor_days;
    END IF;

    SELECT count(*) INTO n_held
      FROM staging.niyam_events e
     WHERE e.occurred_at < NOW() - make_interval(days => keep_days)
       AND EXISTS (SELECT 1 FROM staging.niyam_runs r
                    WHERE r.event_id = e.event_id AND r.finished_at IS NULL);

    WITH gone AS (
        DELETE FROM staging.niyam_events e
         WHERE e.occurred_at < NOW() - make_interval(days => keep_days)
           -- Never remove an event a run is still living on. `niyam_runs` has
           -- no foreign key to `niyam_events` (migration 143's header explains
           -- why), so nothing at the schema level would have stopped this.
           AND NOT EXISTS (SELECT 1 FROM staging.niyam_runs r
                            WHERE r.event_id = e.event_id
                              AND r.finished_at IS NULL)
        RETURNING 1
    )
    SELECT count(*) INTO n_deleted FROM gone;

    RETURN QUERY SELECT n_deleted, n_held;
END;
$$;

COMMENT ON FUNCTION staging.niyam_prune_events(int) IS
    'Prunes staging.niyam_events older than keep_days (minimum 90 — below that, '
    'deleting a row re-arms its once-per-entity dedupe key). Never removes an '
    'event referenced by an unfinished run. Not scheduled; call deliberately.';
