"""
report_schedule_window.py — when a stored schedule was last supposed to fire.

WHY THIS IS A SEPARATE, PURE MODULE
-----------------------------------
`staging.dristi_scheduled_reports` stores `frequency`, `day_of_week`,
`day_of_month` and `time_utc`, and it stores NO `next_run_at`. That is the
whole reason this file exists.

`public.report_schedules` — the OTHER scheduled-report table this product used
to have, retired by the owner on 2026-08-27 — DID have `next_run_at`, so its
dispatcher answered "is this due?" with a `WHERE next_run_at <= now` and
advanced the column afterwards. That table, that dispatcher and its hourly cron
are gone; this module is now the product's ONLY due-rule for a scheduled
report. Dristi cannot use the `next_run_at` approach: the column is not there,
and adding it means
a migration, and a migration that has not been applied yet is a dispatcher that
crashes on its first tick. So due-ness here is COMPUTED from what the row
already holds, and the computation lives in a pure function because the pool is
mocked in tests and will happily resolve any table name handed to it — a test
that goes through the pool proves nothing about this arithmetic.

`now` IS ALWAYS A PARAMETER. Never `date.today()`, never `datetime.now()`.
`date.today()` reads the process clock in UTC, and the owner's business day is
IST (UTC+5:30): a sweep running in a 19:00–22:00 UTC window would stamp every
report with yesterday's Indian date. Making the caller pass the instant means
the bug is impossible to write here and trivial to test for.

THE DAY-OF-WEEK CONVENTION IS NOT PYTHON'S
------------------------------------------
Both report UIs build their day picker from a literal array that starts at
Sunday and submit the ARRAY INDEX:

    frontend/src/pages/dristi/ReportsTab.jsx:33
        ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    frontend/src/pages/ReportsPage.jsx:70
        ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

So the stored integer is JavaScript `Date.getDay()`: 0 = Sunday … 6 = Saturday.

`datetime.weekday()` is 0 = MONDAY … 6 = Sunday. They are not the same scale and
they disagree about every single day of the week.

This matters beyond bookkeeping, and it is why the retired system is worth
describing here rather than forgetting. `routers/reports.py:_next_run` compared
the stored integer directly against `now.weekday()`, and its own comment called
`day_of_week = 1` the "Monday default" — under `weekday()`, 1 is Tuesday. A
schedule the user set to Monday would have fired on Tuesday, and one set to
Sunday on Monday. That defect was invisible only because
`public.report_schedules` held ZERO rows for its entire life, even while an
hourly Railway cron swept it. It is the concrete reason the Dristi sweep did
not simply import `_next_run` and reuse it: "reuse the battle-tested one" would
have shipped every Dristi weekly report exactly one day late, and "battle-
tested" meant "ran 24 times a day and found nothing".

Conversion, in one place, so there is one place to be wrong:
    js_dow = (dt.weekday() + 1) % 7        # Mon(0)->1 … Sun(6)->0
"""

from calendar import monthrange
from datetime import date, datetime, time as _time, timedelta, timezone

# The frequencies `routers/dristi.py:create_scheduled_report` will accept. Any
# other value is a row this module refuses to guess about — see `previous_slot`.
KNOWN_FREQUENCIES = ("daily", "weekly", "monthly")


def js_weekday(dt: datetime | date) -> int:
    """The 0=Sunday index the UI stores, for a Python date or datetime."""
    return (dt.weekday() + 1) % 7


def _as_time(value) -> _time:
    """`time_utc` as a `datetime.time`, whether it arrived from asyncpg or JSON.

    asyncpg hands back `datetime.time` for a `time without time zone` column,
    but the same value reaches this module as the string "08:00" from a request
    body and as "08:00:00" from a JSON round-trip. All three mean the same
    schedule and none of them should be the reason a report does not go out.
    """
    if isinstance(value, _time):
        return value
    if value is None:
        # The column default. Chosen by the schema, not invented here.
        return _time(8, 0)
    parts = str(value).split(":")
    hour = int(parts[0])
    minute = int(parts[1]) if len(parts) > 1 else 0
    second = int(float(parts[2])) if len(parts) > 2 else 0
    return _time(hour, minute, second)


def _at(day: date, t: _time) -> datetime:
    """That clock time on that date, in UTC. `time_utc` is UTC by its own name."""
    return datetime(day.year, day.month, day.day, t.hour, t.minute, t.second,
                    tzinfo=timezone.utc)


def _clamp_day(year: int, month: int, day_of_month: int) -> int:
    """`day_of_month` pinned inside the month it lands in.

    Deliberately the month's real last day and not `min(dom, 28)` — which is
    what `routers/reports.py:_next_run` does. A monthly report set to the 31st
    means "the end of the month" to the person who set it; silently rewriting
    that to the 28th moves it three days early in seven months of the year and
    is indistinguishable, in the row, from someone having chosen the 28th.
    """
    last = monthrange(year, month)[1]
    return max(1, min(int(day_of_month), last))


def previous_slot(
    now: datetime,
    frequency: str,
    day_of_week: int | None,
    day_of_month: int | None,
    time_utc,
) -> datetime | None:
    """The most recent instant at or before `now` when this schedule was due.

    Returns None for a frequency this module does not recognise. That is not
    defensive noise: `frequency` is a free `text` column with no CHECK
    constraint, so a row written by a migration, a fixture or a future endpoint
    can hold anything. Guessing "probably daily" for such a row would mail a
    report on a cadence nobody chose; returning None makes the caller skip it
    and say so.
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    t = _as_time(time_utc)
    today = now.date()

    if frequency == "daily":
        candidate = _at(today, t)
        if candidate > now:
            candidate -= timedelta(days=1)
        return candidate

    if frequency == "weekly":
        # `day_of_week` is nullable and one of the seven live rows has it NULL.
        # Monday is the default, written as the JS index 1 because that is the
        # scale this column is on — not because 1 is Monday in Python, where it
        # is not.
        target = 1 if day_of_week is None else int(day_of_week) % 7
        days_back = (js_weekday(today) - target) % 7
        candidate = _at(today - timedelta(days=days_back), t)
        if candidate > now:
            # Today IS the target day but the clock time has not arrived yet,
            # so the most recent firing was a week ago.
            candidate -= timedelta(days=7)
        return candidate

    if frequency == "monthly":
        dom = 1 if not day_of_month else int(day_of_month)
        candidate = _at(date(now.year, now.month, _clamp_day(now.year, now.month, dom)), t)
        if candidate > now:
            year, month = (now.year - 1, 12) if now.month == 1 else (now.year, now.month - 1)
            candidate = _at(date(year, month, _clamp_day(year, month, dom)), t)
        return candidate

    return None


def is_due(
    now: datetime,
    *,
    is_active: bool,
    frequency: str,
    day_of_week: int | None,
    day_of_month: int | None,
    time_utc,
    last_sent_at: datetime | None,
    created_at: datetime | None,
) -> bool:
    """Whether this schedule owes a send as of `now`.

    The rule is "the newest slot on or before now is newer than the last thing
    that happened to this row", where the last thing is `last_sent_at` and, when
    that is NULL, `created_at`.

    FALLING BACK TO `created_at` IS THE POINT, not a detail. Without it a
    schedule created on Tuesday for "every Monday 08:00" is due the instant it
    is saved, because last Monday 08:00 is in the past and nothing records that
    the row did not exist then. Six of the seven live rows have `last_sent_at`
    NULL; every one of them would have fired on the first tick. A schedule never
    owes a send for a slot that predates its own creation.

    Comparing against `last_sent_at` rather than advancing a stored cursor also
    makes the sweep IDEMPOTENT: running it twice in one hour, or re-running it
    after a crash halfway through the loop, sends each schedule at most once per
    slot, because the first send moved `last_sent_at` past the slot.
    """
    if not is_active:
        return False

    slot = previous_slot(now, frequency, day_of_week, day_of_month, time_utc)
    if slot is None:
        return False

    floor = last_sent_at or created_at
    if floor is None:
        # Neither timestamp — nothing anchors this row in time. `created_at`
        # has a NOT NULL-ish `now()` default so this is close to unreachable,
        # but "no anchor" must mean "do not send", never "send now".
        return False
    if floor.tzinfo is None:
        floor = floor.replace(tzinfo=timezone.utc)

    return slot > floor


def blocked_reason(report_type: str, created_by, required: set[str], reachable: set[str]) -> str | None:
    """Why this schedule must NOT be sent by a cron, or None if it may be.

    `routers/dristi.py:run_report_now` refuses to build a report whose source
    modules the CALLER cannot reach — a "revenue" report reads the invoice
    ledger, so it needs `ganit`. A sweep has no caller. Dropping the check
    because there is no request would turn the cron into the way to read a
    module you were refused, on a weekly repeat, with the answer mailed out.

    So the check runs against the schedule's OWNER (`created_by`) instead, and
    is re-evaluated on every tick rather than trusted from creation time: an
    employee who moves off the finance team should stop receiving the books,
    and the schedule they left behind is exactly how that would otherwise keep
    happening.

    A schedule with no owner is skipped, loudly. There is nobody whose access
    could authorise it.
    """
    if not created_by:
        return "schedule has no created_by, so no entitlement can be checked"
    missing = set(required) - set(reachable)
    if missing:
        return (
            f"owner {created_by} can no longer reach "
            f"{', '.join(sorted(missing))}, which report type "
            f"'{report_type}' reads"
        )
    return None
