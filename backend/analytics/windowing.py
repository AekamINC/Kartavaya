"""Buckets and comparison windows, on top of D1's `services/analytics_window`.

D1's contract is load-bearing and is NOT touched here: `aw.parse` returns None
when neither bound is supplied, and every pre-D2 caller then runs its original
query. What D2 adds is orthogonal — how a window is CUT (bucket) and what it
is measured AGAINST (compare) — and both live beside `Window`, never inside
`parse`.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException

from services.analytics_window import Window

#: The buckets a series can be cut into. `bucket_expr` interpolates the bucket
#: NAME into SQL, so membership here is a security boundary, not a preference —
#: the same rule the pivot builder's column whitelist enforces.
BUCKETS = frozenset({"day", "week", "month", "quarter", "year"})

#: No fiscal bucket, deliberately. India's April-start FY is an explicit
#: from/to window the frontend sends (proposal 62: "presets are frontend
#: sugar"), not a truncation unit — a `fy` bucket would claim an authority
#: `date_trunc` does not have.


def bucket_expr(bucket: str, col: str) -> str:
    """The GROUP BY expression for a validated bucket.

    `::date` matters: the planner types bare `date_trunc('month', d)` as
    timestamptz even over a `date` column (measured on the live database,
    verify-db 2026-08-17), and a timestamptz in a JSON response drags a
    timezone into a column that never had one.
    """
    if bucket not in BUCKETS:
        raise HTTPException(400, f"bucket must be one of: {', '.join(sorted(BUCKETS))}")
    return f"date_trunc('{bucket}', {col})::date"


COMPARE_MODES = frozenset({"previous_period", "previous_year"})


def _shift_year(d: date) -> date:
    """One year earlier, clamped: 29 Feb maps to 28 Feb, not 1 Mar."""
    try:
        return d.replace(year=d.year - 1)
    except ValueError:
        return d.replace(year=d.year - 1, day=28)


def compare_window(win: Window, mode: str) -> Window:
    """The window the current one is measured against.

    `previous_period` abuts (`Window.previous` — no row counted on both
    sides); `previous_year` holds the calendar dates and moves the year,
    because "this quarter against the same quarter last year" compares like
    seasons, not adjacent spans.
    """
    if mode == "previous_period":
        return win.previous()
    if mode == "previous_year":
        return Window(_shift_year(win.start), _shift_year(win.end))
    raise HTTPException(400, f"compare must be one of: {', '.join(sorted(COMPARE_MODES))}")
