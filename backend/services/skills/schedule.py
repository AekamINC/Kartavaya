"""schedule.py — the one description of when a skill is due.

── Why this file exists ──────────────────────────────────────────────────────

`/cron/skills` decides what is due with a SQL predicate (`_DUE_PREDICATE` in
`routers/scheduler.py`). Until now nothing else in the product knew that
predicate's shape, and nothing could WRITE one: `POST /skills/templates` did not
accept `trigger_config`, there was no endpoint to set it afterwards, and no
control anywhere in the UI mentioned a schedule.

The visible consequence was that all nineteen marketplace templates carried
`trigger_config = NULL`, so the cron selected nothing and every skill run in the
product's history — all 104 — was a person pressing a button. The scheduler was
not neglected. There was never a way to reach it.

This module is the writing half, and it exists as its own file so there is
exactly one statement of what a valid schedule looks like. A validator that
merely resembled the predicate would let somebody author a schedule that saves
cleanly, appears on the card, and silently never fires — which is worse than the
refusal, because it looks like it worked.

── The shapes, which mirror the predicate exactly ───────────────────────────

    {"type": "cron", "interval_minutes": 1440}              every 24 hours
    {"type": "cron", "day_of_month": 12}                    the 12th, monthly
    {"type": "cron", "day_of_month": 12, "hour_utc": 3}     the 12th, after 03:00
    {"type": "cron", "day_of_month": 1, "months": [10, 11]} the 1st of Oct and Nov

`None` is valid and means unscheduled — the state every template is in today,
and the state a person must be able to return one to.

── What is deliberately refused ──────────────────────────────────────────────

An interval AND a day-of-month together. The SQL branches are `OR`ed, so such a
config fires on both, and whoever wrote it meant one. Refusing is the only
answer that cannot surprise them later.
"""
from __future__ import annotations

#: The cron ticks every fifteen minutes, so anything below that cannot be
#: honoured and would only mislead whoever set it.
MIN_INTERVAL_MINUTES = 15

#: A year. Longer is not a schedule, it is a reminder to set a schedule, and an
#: interval that long drifts by months (see the day_of_month note below).
MAX_INTERVAL_MINUTES = 60 * 24 * 366


class ScheduleError(ValueError):
    """A schedule that would save cleanly and never fire, refused at the door."""


def validate_trigger_config(cfg) -> dict | None:
    """Return a normalised trigger_config, or raise `ScheduleError`.

    `None`, `{}` and a missing value all mean UNSCHEDULED and come back as
    `None`, so a template can be taken off a schedule the same way it was put on
    one. That symmetry matters: a control that can only add a schedule leaves
    the customer with a skill firing monthly and no way to stop it short of a
    database write.

    Every message names what to do rather than what was wrong, because the
    person reading it is authoring a schedule and does not have this file open.
    """
    if cfg is None or cfg == {}:
        return None
    if not isinstance(cfg, dict):
        raise ScheduleError(
            "A schedule must be an object like "
            '{"type": "cron", "day_of_month": 12}, or empty for no schedule.'
        )

    unknown = set(cfg) - {"type", "interval_minutes", "day_of_month", "hour_utc", "months"}
    if unknown:
        # Named rather than ignored. A typo'd key in a jsonb column is invisible
        # — `{"day_of_month_": 12}` would store, display and never fire.
        raise ScheduleError(
            f"Unknown schedule field(s): {', '.join(sorted(unknown))}. "
            f"Allowed: type, interval_minutes, day_of_month, hour_utc, months."
        )

    if cfg.get("type") != "cron":
        raise ScheduleError('A schedule must set "type": "cron".')

    has_interval = "interval_minutes" in cfg
    has_day = "day_of_month" in cfg

    if has_interval and has_day:
        raise ScheduleError(
            "Choose either interval_minutes or day_of_month, not both — the cron "
            "treats them as alternatives, so a schedule carrying both fires on "
            "each of them."
        )
    if not has_interval and not has_day:
        raise ScheduleError(
            "A schedule needs either interval_minutes (every N minutes) or "
            "day_of_month (a date each month). Send no schedule at all to leave "
            "the skill unscheduled."
        )

    out: dict = {"type": "cron"}

    if has_interval:
        mins = _as_int(cfg["interval_minutes"], "interval_minutes")
        if not MIN_INTERVAL_MINUTES <= mins <= MAX_INTERVAL_MINUTES:
            raise ScheduleError(
                f"interval_minutes must be between {MIN_INTERVAL_MINUTES} and "
                f"{MAX_INTERVAL_MINUTES}. The cron ticks every "
                f"{MIN_INTERVAL_MINUTES} minutes, so anything shorter cannot be "
                f"honoured."
            )
        out["interval_minutes"] = mins
        # `hour_utc` and `months` only mean something on the anchored branch;
        # accepting them here would store a field the predicate never reads.
        for ignored in ("hour_utc", "months"):
            if ignored in cfg:
                raise ScheduleError(
                    f"{ignored} applies to a day_of_month schedule, not an "
                    f"interval one."
                )
        return out

    day = _as_int(cfg["day_of_month"], "day_of_month")
    if not 1 <= day <= 31:
        raise ScheduleError("day_of_month must be between 1 and 31.")
    out["day_of_month"] = day

    if "hour_utc" in cfg:
        hour = _as_int(cfg["hour_utc"], "hour_utc")
        if not 0 <= hour <= 23:
            raise ScheduleError("hour_utc must be between 0 and 23.")
        out["hour_utc"] = hour

    if "months" in cfg:
        months = cfg["months"]
        if not isinstance(months, (list, tuple)) or not months:
            raise ScheduleError(
                "months must be a non-empty list of month numbers, e.g. [10, 11] "
                "for October and November. Omit it for every month."
            )
        seen = []
        for m in months:
            n = _as_int(m, "months")
            if not 1 <= n <= 12:
                raise ScheduleError("Every entry in months must be between 1 and 12.")
            if n not in seen:
                seen.append(n)
        out["months"] = sorted(seen)

    return out


def describe(cfg) -> str:
    """One plain sentence for a card, a log line or a confirmation dialog.

    Written for somebody deciding whether the schedule is the one they meant, so
    it says the consequence rather than echoing the fields: "the 12th of every
    month" is checkable against a deadline; `{"day_of_month": 12}` is not.
    """
    if not cfg:
        return "Not scheduled — runs only when somebody presses Run."

    if "interval_minutes" in cfg:
        mins = cfg["interval_minutes"]
        if mins % 1440 == 0:
            days = mins // 1440
            every = "every day" if days == 1 else f"every {days} days"
        elif mins % 60 == 0:
            hours = mins // 60
            every = "every hour" if hours == 1 else f"every {hours} hours"
        else:
            every = f"every {mins} minutes"
        return f"Runs {every}."

    day = cfg.get("day_of_month")
    when = f"the {day}{_ordinal(day)}"
    if cfg.get("months"):
        names = ", ".join(_MONTHS[m - 1] for m in cfg["months"])
        where = f"of {names}"
    else:
        where = "of every month"
    hour = cfg.get("hour_utc")
    at = f", after {hour:02d}:00 UTC" if hour else ""
    # The clamp is stated because it is the surprising part: a person choosing
    # 31 has not thought about February, and finding out in February is worse.
    clamp = " (the last day, in shorter months)" if day and day > 28 else ""
    return f"Runs on {when} {where}{at}{clamp}."


_MONTHS = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")


def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _as_int(value, field: str) -> int:
    """Reject a bool, and reject a float that is not whole.

    `isinstance(True, int)` is True in Python, so a JSON `true` would otherwise
    become `interval_minutes = 1` — a skill firing every minute, from a value
    that looks nothing like a number.
    """
    if isinstance(value, bool):
        raise ScheduleError(f"{field} must be a number.")
    if isinstance(value, float):
        if value != int(value):
            raise ScheduleError(f"{field} must be a whole number.")
        value = int(value)
    if not isinstance(value, int):
        raise ScheduleError(f"{field} must be a number.")
    return value
