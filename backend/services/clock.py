"""clock.py — the timezone this business runs in, and the periods derived from it.

Every customer of this product is an Indian firm, every operator sits in India,
and every period boundary a person here can name — a billing month, a daily
email cap, a financial year — is an IST boundary. The servers are UTC. That gap
is 5 hours 30 minutes wide, which means the two clocks disagree about which DAY
it is from 00:00 to 05:30 IST, and about which MONTH it is for those same hours
on the 1st.

── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
`IST` was already defined twice, byte-identically, in `services/esign_signed_doc.py`
and `services/push_service.py`, and inlined a third time in `outbound.py` as
`datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)`. That third form
produces the right wall-clock string and a datetime whose `tzinfo` LIES — it
claims UTC while holding IST — which is fine for the `strftime` it feeds and a
trap for the next person who does arithmetic on it.

A fourth copy was about to be written for the billing period. One definition,
importable by name, instead.

── WHY A FIXED OFFSET AND NOT `ZoneInfo("Asia/Kolkata")` ────────────────────
India has observed UTC+05:30 with no daylight saving since 1945, nationwide, and
there is no proposal to change it. A fixed offset needs no `tzdata` on the host
— which Windows does not ship — cannot be silently wrong if a container's tz
database is stale, and matches the three definitions this replaces. If India
ever adopts DST or a second zone, this constant is the one place to change.

── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
`utc_now()` in `services/skills/timeutil.py` stays UTC and must. It exists to
compare against `timestamptz` columns asyncpg returns as aware UTC datetimes,
and a stored instant has no timezone opinion. THE RULE IS: an INSTANT is UTC, a
PERIOD A PERSON NAMES is IST. Reading a row's `created_at` is the first; deciding
which month that row is billed in is the second.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

#: Indian Standard Time. See the module docstring for why this is a fixed offset.
IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def now_ist(now: datetime | None = None) -> datetime:
    """Now, as an aware datetime on the IST clock.

    Aware, and genuinely tagged IST — not a UTC datetime with 5:30 added, which
    is what `outbound._today_keys` used to build. The difference is invisible
    until somebody subtracts two of them or compares one to a column.
    """
    return (now or datetime.now(timezone.utc)).astimezone(IST)


def today_ist(now: datetime | None = None) -> date:
    """The calendar date it is in India right now.

    Differs from `utc_now().date()` between 00:00 and 05:30 IST every day, and
    that window is the whole reason this is spelled out: a UTC container asked
    for "today" at 02:00 IST answers yesterday.
    """
    return now_ist(now).date()


def month_start_ist(now: datetime | None = None) -> date:
    """The first day of the month it is in India right now.

    ⚠ THIS IS THE BILLING PERIOD, and `credits.current_period()` is its one
    caller of record. It moved from UTC to IST on 2026-09-04, because a product
    whose users are all in IST was rolling its billing month over at 05:30 IST:
    a charge incurred at 02:00 on the 1st was booked to the month before, and on
    1 April to the previous FINANCIAL YEAR — which, in a product Indian
    chartered accountants use to close their own books, is not a rounding error.

    The rest of the product already agreed. `outbound._today_keys` has always
    computed its daily and monthly email caps "in IST for period boundaries";
    billing was the outlier.

    Measured before the change: 8 rows across `org_billing_lines` and
    `invoice_billing_lines`, ZERO whose stored `period_start` disagreed with
    what IST would have given. Nothing was re-dated, and nothing needed to be —
    this is forward-only.
    """
    ist = now_ist(now)
    return date(ist.year, ist.month, 1)
