"""A monthly skill must fire on its day, and a dead run must not say 'running'.

── The two defects ───────────────────────────────────────────────────────────

`/cron/skills` understood exactly one schedule: `last_run_at + interval_minutes
<= now()`. Every statutory obligation this product exists to serve is anchored
to a calendar date — GSTR-1 on the 11th, GSTR-3B on the 20th, PF and ESI on the
15th — and an interval is not a date. A "monthly" skill enabled on the 12th
fires on the 9th by month four and after the 20th by month ten, which is to say
the reminder for a deadline eventually arrives after the deadline. Nobody would
notice, because it would still be firing.

Separately, the string 'running' was written in exactly one place per run table
— the INSERT that starts a run — and nothing ever transitioned it on the failure
path. No timeout, no `wait_for`, no reaper. On the live database that left 38
rows in `staging.hub_org_skill_runs` stuck since 17 July 2026, still presented to
the customer as work in progress a month later.

── Why these assertions are structural ───────────────────────────────────────

The logic lives in SQL, and the unit suite has no database. The calendar
behaviour was therefore verified directly against Postgres — all sixteen cases,
including the one that matters most, `day_of_month: 31` in February — by
`scratchpad/probe_due_predicate.py`, which executes the predicate verbatim out of
this module against synthetic clocks. What is asserted here is that the
properties that verification depended on are still present, so the predicate
cannot quietly lose them between runs of that probe.
"""
import re
from pathlib import Path

import pytest

SCHEDULER = Path(__file__).resolve().parents[1] / "routers" / "scheduler.py"
SRC = SCHEDULER.read_text(encoding="utf-8-sig")
PREDICATE = re.search(r'_DUE_PREDICATE = """(.*?)"""', SRC, re.S).group(1)


# ── The schedule understands a calendar ──────────────────────────────────────

def test_a_skill_can_be_anchored_to_a_day_of_the_month():
    assert "day_of_month" in PREDICATE, (
        "the skills cron understands only interval_minutes again. Every statutory "
        "skill in the catalogue is anchored to a date, and an interval drifts "
        "backwards through the month until the reminder lands after the deadline."
    )


def test_the_interval_branch_still_works():
    """Anchoring must not break the schedules that already exist."""
    assert "interval_minutes" in PREDICATE, (
        "the interval branch was removed; existing schedules would stop firing"
    )


def test_the_day_is_clamped_to_the_length_of_the_month():
    """`day_of_month: 31` must fire on 28 February, not never.

    A skill that silently skips February — and April, June, September and
    November — is worse than one that fires a day early, because the months it
    skips are invisible.
    """
    assert "LEAST(" in PREDICATE and "1 month - 1 day" in PREDICATE, (
        "day_of_month is no longer clamped to the length of the month. Set 31 and "
        "the skill will never fire in February."
    )


def test_an_anchored_skill_fires_once_a_day_at_most():
    """The cron ticks every 15 minutes; without this it would run 96 times."""
    assert "date_trunc('day'" in PREDICATE, (
        "the anchored branch has no once-a-day guard. The cron runs every 15 "
        "minutes, so on its due date the skill would dispatch 96 times."
    )


def test_the_predicate_does_not_use_the_bare_question_mark_operator():
    """`?` is jsonb key-exists in Postgres and a placeholder to everything else.

    asyncpg binds with $N so `?` is safe here today, but it reads as a parameter
    to every human and every tool that later touches this SQL.
    """
    assert "jsonb_exists" in PREDICATE, "use jsonb_exists(), not the ? operator"
    assert not re.search(r"trigger_config\s*\?", PREDICATE), (
        "the ? operator is back; write jsonb_exists(trigger_config, 'key')"
    )


@pytest.mark.parametrize("token", ["{last_run}"])
def test_the_predicate_is_parameterised_by_the_last_run_column(token):
    """One predicate, reusable across run tables, rather than two that drift."""
    assert token in PREDICATE, (
        "the predicate hardcodes a column again; it must take {last_run} so the "
        "same schedule logic serves every table that has one"
    )


# ── A dead run stops claiming to be alive ────────────────────────────────────

def test_there_is_a_reaper():
    assert "_reap_abandoned_runs" in SRC, (
        "nothing transitions a run that died mid-flight. Those rows stay "
        "'running' for ever and the customer is told work is still happening."
    )


def test_the_reaper_covers_both_run_tables():
    """There are two, and the 38 live tombstones are in the one easily missed."""
    body = SRC[SRC.index("async def _reap_abandoned_runs"):SRC.index("@router.post(\"/cron/skills\"")]
    for table in ("hub_skill_runs", "hub_org_skill_runs"):
        assert table in body, (
            f"the reaper does not cover staging.{table}. The 38 abandoned runs on "
            f"the live database are in hub_org_skill_runs — the one a reaper "
            f"written against the client path would miss."
        )


def test_the_reaper_runs_even_when_nothing_is_due():
    """Tombstones are cleared on every tick, not only on a busy one."""
    body = SRC[SRC.index("await _verify_cron"):SRC.index("if not rows:")]
    assert "_reap_abandoned_runs" in body, (
        "the reaper is called after the due-work check, so on a quiet cron tick "
        "the tombstones are never cleared — and a quiet tick is the normal case"
    )


def test_the_reaper_explains_itself_to_the_customer():
    """The row it writes is read by a person, so it must say what happened."""
    body = SRC[SRC.index("async def _reap_abandoned_runs"):SRC.index("@router.post(\"/cron/skills\"")]
    assert "error_message" in body and "Run it again" in body, (
        "a reaped run must carry a sentence saying no result was recorded and "
        "what to do. 'failed' with an empty message is the same silence in a "
        "different column."
    )


def test_the_reaper_does_not_overwrite_a_real_error():
    """A run that recorded why it failed keeps its own words."""
    body = SRC[SRC.index("async def _reap_abandoned_runs"):SRC.index("@router.post(\"/cron/skills\"")]
    assert "COALESCE(NULLIF(error_message" in body, (
        "the reaper clobbers error_message unconditionally, destroying the real "
        "reason a run failed and replacing it with a generic one"
    )
