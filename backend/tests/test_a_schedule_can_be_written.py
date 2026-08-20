"""What the UI can author must be exactly what the cron can select.

── The gap this closes ───────────────────────────────────────────────────────

The scheduler was built, its predicate verified sixteen ways against live
Postgres, and the cron loop wired for both client and org grants — and none of it
could ever run, because nothing in the product could WRITE `trigger_config`.
`POST /skills/templates` did not accept the field, no endpoint existed to set it
afterwards, and no control in the UI mentioned a schedule. All nineteen templates
carried NULL, so `/cron/skills` matched nothing and every one of the 104 runs in
the product's history was a person pressing a button.

── The failure mode this file is really about ────────────────────────────────

Two descriptions of "a valid schedule" now exist: `_DUE_PREDICATE` in
`routers/scheduler.py`, which decides what RUNS, and `validate_trigger_config`,
which decides what can be SAVED. If they drift, the product accepts a schedule
that saves cleanly, renders on the card, and never fires — which reads as a
broken scheduler rather than a wrong schedule, and would be looked for in exactly
the wrong place.

So the last test here reads the SQL and asserts that every key the validator
emits is a key the predicate actually tests.
"""
import re
from pathlib import Path

import pytest

from services.skills.schedule import (
    MAX_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    ScheduleError,
    describe,
    validate_trigger_config,
)


# ── Unscheduled is a real, reachable state ───────────────────────────────────

@pytest.mark.parametrize("empty", [None, {}])
def test_no_schedule_is_valid_and_means_unscheduled(empty):
    """A control that can only ADD a schedule leaves a customer with a skill
    firing monthly and no way to stop it short of a database write."""
    assert validate_trigger_config(empty) is None


def test_the_unscheduled_description_says_what_does_happen():
    assert "presses Run" in describe(None)


# ── The two shapes the predicate understands ─────────────────────────────────

def test_an_interval_schedule_round_trips():
    assert validate_trigger_config({"type": "cron", "interval_minutes": 1440}) == {
        "type": "cron", "interval_minutes": 1440,
    }


def test_an_anchored_schedule_round_trips():
    got = validate_trigger_config(
        {"type": "cron", "day_of_month": 12, "hour_utc": 3, "months": [11, 10, 10]}
    )
    assert got == {"type": "cron", "day_of_month": 12, "hour_utc": 3, "months": [10, 11]}, (
        "months must be de-duplicated and sorted, so two configs meaning the "
        "same thing compare equal"
    )


# ── What must be refused, and why each one matters ───────────────────────────

def test_both_kinds_at_once_is_refused():
    """The SQL branches are ORed, so a config carrying both fires on each."""
    with pytest.raises(ScheduleError, match="not both"):
        validate_trigger_config(
            {"type": "cron", "interval_minutes": 1440, "day_of_month": 12}
        )


def test_a_schedule_with_neither_is_refused():
    with pytest.raises(ScheduleError, match="interval_minutes"):
        validate_trigger_config({"type": "cron"})


def test_an_unknown_field_is_named_not_ignored():
    """A typo'd key in a jsonb column is invisible: `day_of_month_` would store,
    display, and never fire."""
    with pytest.raises(ScheduleError, match="day_of_month_"):
        validate_trigger_config({"type": "cron", "day_of_month_": 12})


def test_a_non_cron_type_is_refused():
    with pytest.raises(ScheduleError, match="cron"):
        validate_trigger_config({"type": "event", "day_of_month": 12})


@pytest.mark.parametrize("mins", [1, 14, MAX_INTERVAL_MINUTES + 1])
def test_an_interval_the_cron_cannot_honour_is_refused(mins):
    """The cron ticks every fifteen minutes. Accepting five would promise a
    cadence the product cannot keep."""
    with pytest.raises(ScheduleError, match="interval_minutes"):
        validate_trigger_config({"type": "cron", "interval_minutes": mins})


def test_the_shortest_honourable_interval_is_accepted():
    assert validate_trigger_config(
        {"type": "cron", "interval_minutes": MIN_INTERVAL_MINUTES}
    )["interval_minutes"] == MIN_INTERVAL_MINUTES


@pytest.mark.parametrize("day", [0, 32, -1])
def test_an_impossible_day_is_refused(day):
    with pytest.raises(ScheduleError, match="day_of_month"):
        validate_trigger_config({"type": "cron", "day_of_month": day})


@pytest.mark.parametrize("hour", [-1, 24])
def test_an_impossible_hour_is_refused(hour):
    with pytest.raises(ScheduleError, match="hour_utc"):
        validate_trigger_config({"type": "cron", "day_of_month": 12, "hour_utc": hour})


@pytest.mark.parametrize("months", [[], [0], [13], "october"])
def test_an_impossible_month_set_is_refused(months):
    with pytest.raises(ScheduleError, match="months"):
        validate_trigger_config({"type": "cron", "day_of_month": 1, "months": months})


@pytest.mark.parametrize("field", ["hour_utc", "months"])
def test_anchored_only_fields_are_refused_on_an_interval(field):
    """The predicate never reads them on that branch, so storing one would be a
    setting that appears to take effect and does not."""
    cfg = {"type": "cron", "interval_minutes": 1440,
           field: 3 if field == "hour_utc" else [10]}
    with pytest.raises(ScheduleError, match=field):
        validate_trigger_config(cfg)


def test_a_boolean_is_not_a_number():
    """`isinstance(True, int)` is True in Python, so a JSON `true` would become
    interval_minutes = 1 — a skill firing every minute from a value that looks
    nothing like a number."""
    with pytest.raises(ScheduleError, match="interval_minutes"):
        validate_trigger_config({"type": "cron", "interval_minutes": True})


# ── The description is for a person deciding if it is what they meant ────────

@pytest.mark.parametrize("cfg,expected", [
    ({"type": "cron", "interval_minutes": 1440}, "every day"),
    ({"type": "cron", "interval_minutes": 60}, "every hour"),
    ({"type": "cron", "day_of_month": 12}, "the 12th of every month"),
    ({"type": "cron", "day_of_month": 1, "months": [10, 11]}, "October, November"),
    ({"type": "cron", "day_of_month": 3, "hour_utc": 9}, "after 09:00 UTC"),
])
def test_the_description_says_the_consequence(cfg, expected):
    assert expected in describe(validate_trigger_config(cfg))


def test_a_late_day_warns_about_short_months():
    """Somebody choosing 31 has not thought about February, and finding out in
    February is worse than being told now."""
    assert "last day" in describe(validate_trigger_config(
        {"type": "cron", "day_of_month": 31}
    ))


# ── And the one that stops the two halves drifting ───────────────────────────

def test_every_key_the_validator_emits_is_one_the_cron_selects_on():
    """The whole point of this file.

    A validator that merely resembled the predicate would let somebody author a
    schedule that saves, renders, and never fires — and the search for the fault
    would start at the scheduler, which would be working perfectly.
    """
    sql = (Path(__file__).resolve().parents[1] / "routers" / "scheduler.py").read_text(
        encoding="utf-8"
    )
    predicate = re.search(r'_DUE_PREDICATE = """(.*?)"""', sql, re.S).group(1)

    emitted = set()
    for cfg in (
        {"type": "cron", "interval_minutes": 1440},
        {"type": "cron", "day_of_month": 12, "hour_utc": 3, "months": [10]},
    ):
        emitted |= set(validate_trigger_config(cfg))

    for key in emitted:
        assert key in predicate, (
            f"validate_trigger_config emits {key!r}, which _DUE_PREDICATE never "
            f"reads. A schedule carrying it would save cleanly and never fire."
        )
