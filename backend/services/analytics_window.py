"""analytics_window.py — the date range every analytic is read through.

Phase D1 of proposal 62. Before this, exactly one Dristi read accepted a date
range (`POST /query`); `/overview` and `/sales` took no time parameter at all,
`/revenue` took a `months` count, and the exports took nothing. "Last quarter"
was not expressible anywhere in the reporting module, and neither was any
year-on-year comparison.

Two decisions are worth stating, because they are the difference between a
retrofit and a breaking change.

**Absent means unchanged.** With neither bound supplied `parse()` returns None
and every caller runs precisely the query it ran before. Defaulting to "last 30
days" would have been friendlier and would also have silently changed what
`/overview` means for every existing client and every scheduled report already
in flight — a headcount of 40 becoming "3 people joined in the last 30 days" is
not a smaller number, it is a different question. The window is opt-in per
request; the frontend supplies one, so the user sees a range without the API
inventing one.

**A window applies to flows, not to stocks.** Invoiced value, orders placed and
payroll disbursed all happened *during* a period. Headcount, open tasks and
pipeline value are true *as at* an instant and have no meaningful intersection
with a date range — filtering them by `created_at` would answer a question
nobody asked and label it with the name of the one they did. So each endpoint
declares which blocks the window reached and which are current-state, and says
so in the response, rather than leaving the reader to assume the whole screen
moved.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import HTTPException

#: A range longer than this is refused rather than served slowly. Five years of
#: daily invoice rows is already past the point where the export path needs to
#: page, and an unbounded range is how a reporting query becomes an outage.
MAX_SPAN_DAYS = 1827          # 5 years, allowing for leap days

#: What one supplied bound implies about the other. Chosen so that `?to=` alone
#: reads as "the 30 days ending then", which is what every UI that sends one
#: bound means by it.
IMPLIED_SPAN_DAYS = 30


@dataclass(frozen=True)
class Window:
    """An inclusive [start, end] range of dates, both bounds always present."""

    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def previous(self) -> "Window":
        """The equally long range immediately before this one.

        Used for period-on-period comparison. It abuts rather than overlaps:
        a 30-day window compares against the 30 days ending the day before it
        starts, so no row is counted on both sides.
        """
        return Window(self.start - timedelta(days=self.days), self.start - timedelta(days=1))

    def as_dict(self) -> dict:
        return {"from": self.start.isoformat(), "to": self.end.isoformat(), "days": self.days}


def _parse_one(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        # The offending value is echoed back because the caller is usually a
        # query string assembled by hand, and "invalid date" without saying
        # which one costs a round of guessing.
        raise HTTPException(400, f"{field} must be an ISO date (YYYY-MM-DD), got {value!r}")


def parse(date_from: str | None, date_to: str | None) -> Window | None:
    """Build a Window from two optional ISO date strings.

    Returns None when neither bound is given — the caller must then run its
    original, unwindowed query. Raises 400 on anything malformed or inverted.
    """
    raw_from = (date_from or "").strip()
    raw_to = (date_to or "").strip()

    if not raw_from and not raw_to:
        return None

    if raw_from and raw_to:
        start, end = _parse_one(raw_from, "date_from"), _parse_one(raw_to, "date_to")
    elif raw_from:
        start = _parse_one(raw_from, "date_from")
        end = start + timedelta(days=IMPLIED_SPAN_DAYS - 1)
    else:
        end = _parse_one(raw_to, "date_to")
        start = end - timedelta(days=IMPLIED_SPAN_DAYS - 1)

    if end < start:
        raise HTTPException(
            400, f"date_to ({end.isoformat()}) is before date_from ({start.isoformat()})")

    span = (end - start).days + 1
    if span > MAX_SPAN_DAYS:
        raise HTTPException(
            400,
            f"range of {span} days exceeds the {MAX_SPAN_DAYS}-day maximum — "
            "narrow the window, or export month by month",
        )

    # A future end date is deliberately allowed: invoices and orders are
    # routinely dated ahead, and clamping to today would quietly drop rows the
    # client can see in the list page.
    return Window(start, end)


def months_between(win: Window, cap: int = 24) -> list[str]:
    """The YYYY-MM labels the window touches, oldest first.

    Trend endpoints label their own buckets rather than deriving them from the
    returned rows, so that a month with no invoices appears as a zero instead
    of vanishing from the series and shortening the line.
    """
    labels: list[str] = []
    y, m = win.start.year, win.start.month
    while (y, m) <= (win.end.year, win.end.month) and len(labels) < cap:
        labels.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return labels


def describe(win: Window | None, *, windowed: list[str], as_at: list[str]) -> dict | None:
    """The `window` block an endpoint returns beside its data.

    `windowed` names the blocks the range actually filtered; `as_at` names the
    current-state blocks it did not touch, so the UI can label those "as of
    today" instead of letting a date picker imply an authority it does not have.
    """
    if win is None:
        return None
    out = win.as_dict()
    out["windowed"] = sorted(windowed)
    out["as_at"] = sorted(as_at)
    return out
