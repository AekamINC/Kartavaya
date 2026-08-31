"""A notification suppressed by quiet hours is HELD, not destroyed.

── THE DEFECT, SUITE 16.14 ON 2026-08-31 ──────────────────────────────────

    Error: no run deferred, and none can. §10 asks that "one fired in quiet
    hours must defer then deliver" and this engine has no deferral for a
    suppressed send at all: `send.deliver` returns Delivery("refused", "it is
    quiet hours…"), `NotifySend.run` turns that into ActionResult("refused"),
    and `run_pipeline` records the step and calls `_finish`, which stamps
    `finished_at` and NULLs `wake_at`. Nothing re-queues it and no later sweep
    retries it — the message is gone.

The loss is not hypothetical. `send.INTERRUPTING`'s own comment records the
first armed rule in this product matching at 01:15 IST and the notification it
existed to send simply never happening.

── THE DISTINCTION THE CODE ALREADY DREW AND NOTHING ACTED ON ─────────────

`prefs_verdict`'s docstring:

    "A PREFERENCE is a decision: this person said they do not want this. It is
     final, and re-asking later gives the same answer. QUIET HOURS are a clock:
     this person does not want to be INTERRUPTED right now. It says nothing
     about whether they want the message."

Everything below is that sentence made executable. A clock that says "not now"
needs a "then when", so `push_service.quiet_until` answers it, `Delivery` and
`ActionResult` carry it, and the engine sleeps the run on `wake_at` — the same
mechanism the `wait` step uses, which 16.15 already proves works.

── THE FOUR PLACES IT COULD HAVE GONE WRONG, EACH PINNED BELOW ────────────

 1. deferring a PREFERENCE refusal, which would override a person's decision
    by re-delivering at 07:00.
 2. deferring by a fixed interval, which wakes the run inside the same window
    and defers again, hourly until morning.
 3. the resume cursor counting a deferred step as done — the run wakes, skips
    the send it woke for, and finishes. The original loss, one layer down.
 4. `ON CONFLICT DO NOTHING` keeping the deferral after the step really runs,
    so the send happens and the history says "deferred" for ever.

⚠ AND A FIFTH THAT IS NOT IN THIS FILE: `niyam_run_steps` had a CHECK
constraint admitting only ok/refused/failed/skipped/dry. `_record` runs OUTSIDE
`run_pipeline`'s try/except, so the first deferral would have raised 23514 and
killed the whole drain tick. Migration 244 widens it, and
`test_the_outcome_is_writable` holds that from this side.

MUTATION-PROVED 2026-08-31, five killers, named at each test.
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.push_service import IST, quiet_until


# ══════════════════════════════════════════════════════════════════════════
#  quiet_until — the clock
# ══════════════════════════════════════════════════════════════════════════

WRAP = ("22:00", "07:00")            # the default, and the interesting one
DAY = ("09:00", "17:00")


def ist(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


@pytest.mark.parametrize("window,now,expect_hour_ist", [
    (WRAP, ist(2026, 8, 31, 23, 30), 7),    # evening arc — ends TOMORROW 07:00
    (WRAP, ist(2026, 9, 1, 2, 15), 7),      # morning arc — ends TODAY 07:00
    (WRAP, ist(2026, 9, 1, 6, 59), 7),      # one minute before the edge
    (DAY,  ist(2026, 9, 1, 10, 0), 17),     # a plain daytime window
])
def test_it_is_the_END_of_the_window(window, now, expect_hour_ist):
    """⚠ NOT "an hour from now". A fixed interval wakes the run INSIDE the same
    window, which defers it again — once an hour until morning, looking like
    progress in the run log the whole time.

    RED with `now + 1 hour`: every case."""
    until = quiet_until(*window, now=now)
    assert until is not None
    assert until.astimezone(IST).hour == expect_hour_ist
    assert until > now, "a wake time in the past re-runs immediately, for ever"


@pytest.mark.parametrize("window,now", [
    (WRAP, ist(2026, 9, 1, 9, 0)),          # outside the window
    (("07:00", "07:00"), ist(2026, 9, 1, 3, 0)),   # zero-length = no quiet hours
    (("nonsense", "07:00"), ist(2026, 9, 1, 3, 0)),  # unparseable = no quiet hours
])
def test_it_is_None_when_it_is_not_quiet(window, now):
    """It must agree with `_in_quiet_hours` exactly, including on the two
    windows that function deliberately reads as "no quiet hours". A wake time
    invented for a window that does not exist would defer messages nobody asked
    to silence."""
    assert quiet_until(*window, now=now) is None


def test_the_evening_and_morning_arcs_land_on_the_SAME_moment():
    """One window, two arcs of the clock. 23:30 and 02:15 are inside the same
    quiet night and must both wake at that night's 07:00 — the wrap is where a
    naive implementation puts them a day apart."""
    a = quiet_until(*WRAP, now=ist(2026, 8, 31, 23, 30))
    b = quiet_until(*WRAP, now=ist(2026, 9, 1, 2, 15))
    assert a == b


def test_it_returns_UTC():
    """`niyam_runs.wake_at` is timestamptz and the engine compares against
    NOW(). A naive datetime binds as local and would wake the run 5h30m out."""
    until = quiet_until(*WRAP, now=ist(2026, 9, 1, 2, 0))
    assert until.tzinfo is not None
    assert until.utcoffset() == timedelta(0)


# ══════════════════════════════════════════════════════════════════════════
#  deliver — which refusals become deferrals
# ══════════════════════════════════════════════════════════════════════════

class Pool:
    def __init__(self, row):
        self.row = row
        self.executed = []

    async def fetchrow(self, sql, *a):
        return self.row

    async def fetch(self, sql, *a):
        return []

    async def fetchval(self, sql, *a):
        return None

    async def execute(self, sql, *a):
        self.executed.append(sql)
        return "INSERT 0 1"


NIGHT = {"prefs": {}, "quiet_start": "22:00", "quiet_end": "07:00"}
OFF_AT_NIGHT = {"prefs": {"task_done": "off"},
                "quiet_start": "22:00", "quiet_end": "07:00"}


@pytest.fixture
def at_night(monkeypatch):
    monkeypatch.setattr("services.push_service._in_quiet_hours",
                        lambda *a, **k: True)


@pytest.mark.asyncio
async def test_a_push_in_quiet_hours_is_deferred_with_a_time(at_night):
    """THE DEFECT. RED before the fix: `refused`, with no retry_after, and the
    engine then finished the run."""
    from services.niyam.send import deliver
    pool = Pool(NIGHT)
    r = await deliver(pool, user_id="u1", kind="task_done",
                      title="t", body="b", channel="push")
    assert r.outcome == "deferred", r.reason
    assert r.retry_after is not None
    assert not pool.executed, "the push was sent during quiet hours"


@pytest.mark.asyncio
async def test_a_PREFERENCE_refusal_is_still_final(at_night):
    """⚠ THE ONE THAT MUST NOT BE DEFERRED. Someone who turned this kind of
    notification off has made a DECISION, and re-delivering it at 07:00 would
    override them. RED with a deferral applied to every refusal."""
    from services.niyam.send import deliver
    pool = Pool(OFF_AT_NIGHT)
    r = await deliver(pool, user_id="u1", kind="task_done",
                      title="t", body="b", channel="push")
    assert r.outcome == "refused", (
        "a preference was turned into a deferral — the person's decision is "
        "now a message at 07:00")
    assert r.retry_after is None
    assert "turned off" in r.reason


@pytest.mark.asyncio
async def test_in_app_is_not_deferred_because_it_is_not_suppressed(at_night):
    """In-app does not interrupt, so quiet hours never apply to it — it is
    delivered, not held. Deferring it would postpone a row in a list nobody is
    being woken by."""
    from services.niyam.send import deliver
    pool = Pool(NIGHT)
    r = await deliver(pool, user_id="u1", kind="task_done",
                      title="t", body="b", channel="inapp")
    assert r.outcome == "ok", r.reason


# ══════════════════════════════════════════════════════════════════════════
#  the engine — asleep, and awake to the right step
# ══════════════════════════════════════════════════════════════════════════

def test_the_resume_cursor_does_NOT_skip_a_deferred_step():
    """⚠ THE FAILURE THAT WOULD LOOK LIKE A FIX. A deferred step has not run.
    Counting it as done wakes the run, skips the send it woke up for, and
    finishes — the original loss, one layer down and harder to see.

    Asserted on the SQL because that is where the predicate lives; the mirror
    is the `wait` step, which writes a completed row precisely SO the resume
    skips it.

    RED without the `outcome <> 'deferred'` clause."""
    import inspect
    from services.niyam import engine

    # ⚠ COMMENTS STRIPPED FIRST. This function EXPLAINS the predicate in a
    # `#:` block directly above it, so a raw substring test matched its own
    # documentation and stayed green with the predicate deleted from the SQL.
    # Caught by mutation: D3 survived until this line did that.
    src = inspect.getsource(engine.cursor_for)
    code = chr(10).join(l for l in src.splitlines()
                        if not l.strip().startswith("#"))
    assert "outcome <> 'deferred'" in code, (
        "the resume cursor counts a deferred step as completed — the run would "
        "wake, skip the send it woke up for, and finish")


def test_a_real_outcome_can_overwrite_a_deferral():
    """`ON CONFLICT DO NOTHING` is the idempotency guarantee this table exists
    for, and it must stay — for every outcome but the one that is a note rather
    than a result. Without the DO UPDATE the send happens and the run's history
    says "deferred" for ever.

    RED with a flat DO NOTHING."""
    from services.niyam import engine

    stmt = " ".join(engine._RECORD_STEP.split())
    assert "DO UPDATE" in stmt
    assert "niyam_run_steps.outcome = 'deferred'" in stmt, (
        "the overwrite is not narrowed to deferrals — a resumed run could "
        "rewrite a completed step")
    assert "EXCLUDED.outcome <> 'deferred'" in stmt, (
        "a deferral could overwrite a real outcome")


def test_the_engine_sleeps_instead_of_finishing():
    """The whole point: `_finish` NULLs `wake_at`, so reaching it is what
    destroyed the message. RED without the `deferred` branch."""
    import inspect
    from services.niyam import engine

    src = inspect.getsource(engine.run_pipeline)
    branch = src.split('if result.outcome == "deferred":', 1)
    assert len(branch) == 2, "run_pipeline has no deferred branch"
    body = branch[1].split("continue", 1)[0]
    # Comments stripped before the negative assertion: the branch EXPLAINS what
    # `_finish` would do, so a raw substring test matches its own documentation
    # and can never fail.
    code = chr(10).join(l for l in body.splitlines()
                        if not l.strip().startswith("#"))
    assert "wake_at" in code, "a deferral that sets no wake time never resumes"
    assert "_finish" not in code, (
        "the deferred branch finishes the run — `_finish` NULLs wake_at, which "
        "is the destruction this was written to stop")
    assert 'return "waiting"' in code


def test_the_wake_time_is_absolute_not_an_interval():
    """`+ INTERVAL '1 hour'` may appear ONLY as the fallback for a deferral
    that carried no time. As the primary it wakes the run inside the same
    window and defers again, hourly until morning."""
    import inspect
    from services.niyam import engine

    src = inspect.getsource(engine.run_pipeline)
    body = src.split('if result.outcome == "deferred":', 1)[1].split("continue", 1)[0]
    assert "$1::timestamptz" in body, "the retry time is not bound at all"
    assert "COALESCE" in body, (
        "no fallback: a deferral with no time would sleep for ever, and the "
        "reaper looks for `wake_at IS NULL` so it would never be found")


@pytest.mark.asyncio
async def test_the_outcome_is_writable(db_url_or_skip):
    """Migration 244, from this side. The CHECK constraint admitted only
    ok/refused/failed/skipped/dry, and `_record` runs OUTSIDE run_pipeline's
    try/except — so the first deferral would have raised 23514 and killed the
    whole drain tick, not just that rule.

    Skipped with no database; the migration carries its own assertion.
    """
    import asyncpg
    try:
        conn = await asyncpg.connect(db_url_or_skip, timeout=5)
    except Exception as exc:                                  # noqa: BLE001
        # A DATABASE_URL that does not connect is a fact about this machine,
        # not about the schema. Skipping is honest; failing would make every
        # local run red for a reason unrelated to what is being tested, and
        # the migration asserts the same thing where it actually matters.
        pytest.skip(f"DATABASE_URL does not connect here: {type(exc).__name__}")
    try:
        allowed = await conn.fetchval(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            " WHERE conrelid = 'public.niyam_run_steps'::regclass "
            "   AND conname = 'niyam_run_steps_outcome_ck'")
        assert allowed and "deferred" in allowed, (
            f"niyam_run_steps refuses outcome='deferred': {allowed}")
    finally:
        await conn.close()


@pytest.fixture
def db_url_or_skip():
    import os
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("no DATABASE_URL — the migration carries its own assertion")
    return url
