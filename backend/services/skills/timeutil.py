"""
timeutil — one clock for every skill handler.

`datetime.utcnow()` returns a NAIVE datetime that claims to be UTC. asyncpg
returns AWARE datetimes for every `timestamptz` column, which is most of them.
Subtracting one from the other raises:

    TypeError: can't subtract offset-naive and offset-aware datetimes

That is not a theoretical hazard. It was the live failure in `find_overdue`
across all five of its modules, and it was still live in `score_deals` when the
first real skill run went through on 2026-08-02 — observed in the run record:

    {"step": 1, "status": "failed", "skill_function": "score_deals",
     "error": "TypeError: can't subtract offset-naive and offset-aware datetimes"}

Same bug, two files, found weeks apart, because each handler reached for
`utcnow()` independently. Hence one helper and a test that fails if anybody
reaches for it again.

The DATE case is the other half. `ganit_invoices.due_date` is a DATE, so asyncpg
hands back a `datetime.date`, and `datetime - date` is its own TypeError. Both
shapes go through `days_between`.
"""
from datetime import date, datetime, timezone


def utc_now() -> datetime:
    """Now, timezone-aware, always.

    Use this instead of `datetime.utcnow()` anywhere a value from the database
    might be involved — which in a skill handler is everywhere.
    """
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """Force a datetime aware, assuming UTC when it is not.

    A naive value reaching here is already a small bug — something built it
    without a timezone — but treating it as UTC is strictly better than raising,
    because the alternative kills a whole skill run over one column.
    """
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def as_date(value) -> date | None:
    """Reduce a date, an aware datetime or a naive datetime to a calendar date.

    Returns None for anything else — including None itself — so a NULL column
    does not become an exception three lines later.
    """
    if isinstance(value, datetime):
        return as_utc(value).date()
    if isinstance(value, date):
        return value
    return None


def days_between(later, earlier) -> int:
    """Whole calendar days from `earlier` to `later`, whatever types they are.

    Calendar days rather than elapsed hours, deliberately. "3 days overdue" is a
    statement about days; carrying hours into it makes the answer flip at
    midnight for a row that has not changed, and an IST due time late in the
    Indian day would read as a day early against a UTC clock.

    Returns 0 rather than raising when either side is missing — a handler
    computing an age for a row with no date should skip it, not take the run
    down with it.
    """
    a, b = as_date(later), as_date(earlier)
    if a is None or b is None:
        return 0
    return (a - b).days


def hours_between(later, earlier) -> float:
    """Elapsed hours, for the cases where the hour genuinely matters.

    `scan_upcoming_deadlines` reports "hours left" on a 48-hour horizon, where
    rounding to days would erase the whole signal.
    """
    if not isinstance(later, datetime) or not isinstance(earlier, datetime):
        return 0.0
    return (as_utc(later) - as_utc(earlier)).total_seconds() / 3600
