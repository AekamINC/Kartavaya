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
import re
from datetime import date, datetime, timedelta, timezone

from services.clock import IST, now_ist, today_ist as _clock_today_ist


def utc_now() -> datetime:
    """Now, timezone-aware, always.

    Use this instead of `datetime.utcnow()` anywhere a value from the database
    might be involved — which in a skill handler is everywhere.
    """
    return datetime.now(timezone.utc)


def return_period(now: datetime | None = None) -> str:
    """The GST return period a firm is working on today, as 'YYYY-MM'.

    That is the PREVIOUS month, not the current one, and the distinction is the
    whole point of this helper. GSTR-1 for August is due on 11 September and
    GSTR-3B for August on the 20th — so a person who opens either skill during
    September wants August. The current month is not fileable yet; defaulting
    to it would hand back a half-finished period and read as an empty return.

    `check_payroll_readiness` defaults the other way, to the current month, and
    is also right: payroll is run for the month you are in, and returns are
    filed for the month you have left. Two defaults, two clocks, on purpose —
    and "two clocks" there means two POSITIONS in the calendar, not two
    timezones. Both read IST.

    ⚠ IST SINCE 2026-09-04; THIS READ UTC BEFORE. It is the sharpest of the
    three clock fixes made that day, because the answer is STATUTORY. A preparer
    opening a GST screen at 02:00 IST on 1 September was offered JULY: the UTC
    clock still said 31 August, so "the month you have left" came out one
    further back. Two months before the one they were about to file, on a screen
    that names sections and due dates.
    """
    ist = now_ist(now)
    year, month = ist.year, ist.month
    return f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"


def coming_week_start(now: datetime | None = None) -> date:
    """The Monday of the week you are about to staff, as a `date`.

    Coverage is a forward question — you fix next week's holes this week — so
    this looks ahead rather than at the current week. On a Monday it still
    returns next Monday, because by then the week being asked about has already
    started and a gap in it is not a schedule any more, it is a shortage.

    IST, like `today_ist` and for the same reason: which week a rota belongs to
    is a question about the Indian calendar. On a UTC clock, a Monday between
    00:00 and 05:30 IST is still Sunday, so this returned the week that had just
    begun rather than the one being staffed — off by a whole week, not a day.
    """
    day = _clock_today_ist(now)
    return day + timedelta(days=7 - day.weekday())


def as_utc(value: datetime) -> datetime:
    """Force a datetime aware, assuming UTC when it is not.

    A naive value reaching here is already a small bug — something built it
    without a timezone — but treating it as UTC is strictly better than raising,
    because the alternative kills a whole skill run over one column.
    """
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def as_date(value) -> date | None:
    """Reduce a date, an aware datetime or a naive datetime to a calendar date.

    ⚠ THE DATE OF AN INSTANT IS ITS **IST** DATE, SINCE 2026-09-04. Everyone
    reading these handlers is in India, so "the day that row was created" means
    the day it was in India. This returned the UTC date until then, which is the
    day BEFORE for everything that happened between 00:00 and 05:30 IST — 23% of
    every day.

    THIS MOVED IN LOCKSTEP WITH `today()` AND IT HAD TO. Ages are computed as
    `days_between(today, as_date(row["created_at"]))`; moving one clock and not
    the other would not have half-fixed the count, it would have made it wrong in
    a NEW way — two calendars subtracted from each other. Fourteen call sites
    pair them exactly like that.

    A `date` column is passed through untouched: asyncpg hands those back as
    `datetime.date` with no instant behind them, so there is no timezone
    question to answer. Only a `timestamptz` is converted, which is the only
    case where the two clocks could ever have disagreed.

    Returns None for anything else — including None itself — so a NULL column
    does not become an exception three lines later.
    """
    if isinstance(value, datetime):
        return as_utc(value).astimezone(IST).date()
    if isinstance(value, date):
        return value
    return None


def today_ist(now: datetime | None = None) -> date:
    """The calendar date it is in India right now.

    ⚠ USE THIS, NOT `utc_now().date()`, WHICH IS WHAT 54 HANDLERS USED UNTIL
    2026-09-04. A UTC container asked "what day is it" at 02:00 IST answers
    yesterday, so every "days overdue", every default month, and every `as_of`
    handed to the statute calendar was a day behind for five and a half hours
    out of every twenty-four.

    `utc_now()` above stays UTC and must: it exists to compare against
    `timestamptz` columns, and an INSTANT has no timezone opinion. It is the
    calendar DATE of an instant that belongs to the reader, and the reader is in
    India.
    """
    return _clock_today_ist(now)


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


# ── A month, as two dates ────────────────────────────────────────────────────
#
# TWO FUNCTIONS, NOT ONE WITH A FLAG, AND THE NAMES ARE THE POINT.
#
#     start, last_day = month_days(period)     # ... AND d.invoice_date <= $3
#     start, before   = month_window(period)   # ... AND d.created_at   <  $3
#
# Crossing them reads wrong at the call site, which is the entire reason the
# pair is spelled out rather than hidden behind `inclusive=False`. A bare
# `False` in an argument list says nothing about what it buys, and picking it
# wrong does not raise — it silently answers about a window one day off.
#
# ⚠ AGAINST A `timestamptz` COLUMN, `month_window` IS THE ONLY CORRECT ONE.
# `created_at <= last_day` drops everything that happened after midnight on the
# last day of the month, which is nearly all of that day. Against a `date`
# column both forms are correct and both are in use here; against a timestamp
# only one is. That asymmetry is why the half-open form exists at all, and
# `varta_consent` is the handler that reasoned it out first.
#
# ── WHY THESE ARE HERE ───────────────────────────────────────────────────────
#
# Ten copies lived in `services/skills/data/` until 2026-09-04 — seven called
# `_month_bounds`, three called `_period_bounds` — under ONE NAME OVER TWO
# CONTRACTS. `_period_bounds` alone was three files split two-to-one, so reading
# one handler to understand another gave you the wrong bound. Every pairing was
# correct when they were collapsed, checked one call site at a time; nothing
# below changes what any query asks for. It removes the eleventh copy's chance
# to get it wrong.
#
# ⚠ AND IT CORRECTS THE REASON THREE OF THEM GAVE FOR EXISTING — WITHOUT
# THROWING AWAY THE ONE PLACE THE SAME REASON WAS TRUE. Three copies carried a
# paragraph each explaining that a month range-check was load-bearing because
# `date(y, 0 + 1, 1)` is a valid 1 January, so `'2026-00'` "would otherwise sail
# through and be answered about the wrong YEAR".
#
#   · In all TEN it was dead. Every one of them built the month's FIRST day from
#     the parsed month, so `date(y, 0, 1)` raised before the guard could matter.
#     Measured by executing each copy against the same inputs, not read.
#   · In `itc_reversal._period_end` it was REAL, and that function is an
#     eleventh copy in disguise — `month_days(period)[1]`. It computed only the
#     END, from `date(y, month + 1, 1)`, so nothing bad was ever constructed:
#     `'2026-00'` came back 2025-12-31, a cutoff in the wrong year. Verified by
#     running its body with the check removed.
#
# So `_month_parts` range-checks. For the two functions below the check only
# improves the message — `date()` would raise anyway, saying "month must be in
# 1..12" without naming the input — but for any caller taking only `[1]` it is
# the thing standing between a typo and an answer about another year.

_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")


def _month_parts(month) -> tuple[int, int]:
    """`'2026-08'` -> `(2026, 8)`. Raises ValueError naming the input otherwise.

    STRICT: `'2026-8'`, `'2026-08-01'` and `None` are all refused. One former
    copy (`client_register`) split on `-` and kept the first two fields, so it
    alone accepted a full date and answered about its month while the other nine
    raised. That leniency now sits at that one call site, where a reader can see
    it, rather than in the helper the other nine share.
    """
    m = _MONTH_RE.match(month) if isinstance(month, str) else None
    if not m:
        raise ValueError(f"{month!r} is not a month in the form 'YYYY-MM'")
    year, mon = int(m.group(1)), int(m.group(2))
    if not 1 <= mon <= 12:
        raise ValueError(f"{month!r} is not a month: {mon} is not 1-12")
    return year, mon


def month_days(month) -> tuple[date, date]:
    """`'2026-08'` -> `(2026-08-01, 2026-08-31)`. BOTH ENDS INCLUSIVE.

    For a `date` column, compared with `>=` and `<=`. For a `timestamptz`
    column, use `month_window` — see the note above.
    """
    year, mon = _month_parts(month)
    nxt = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    return date(year, mon, 1), nxt - timedelta(days=1)


def month_window(month) -> tuple[date, date]:
    """`'2026-08'` -> `(2026-08-01, 2026-09-01)`. THE SECOND BOUND IS EXCLUSIVE.

    For a half-open comparison, `>= start` and `< before`. Correct against a
    `date` column and the only correct form against a `timestamptz` one.
    """
    year, mon = _month_parts(month)
    return (date(year, mon, 1),
            date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1))
