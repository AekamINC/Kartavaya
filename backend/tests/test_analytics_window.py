"""The date range every analytic is read through (proposal 62, phase D1).

The rule that matters most is the first one: with neither bound supplied the
parser returns None, and every caller then runs exactly the query it ran before
this existed. A default window would have silently redefined what `/overview`
means for every client and every scheduled report already in flight.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from services import analytics_window as aw


# ── absent means unchanged ────────────────────────────────────────────────────

@pytest.mark.parametrize("a,b", [(None, None), ("", ""), ("  ", ""), (None, "  ")])
def test_no_bounds_is_no_window(a, b):
    assert aw.parse(a, b) is None


# ── both bounds ───────────────────────────────────────────────────────────────

def test_both_bounds_are_inclusive():
    w = aw.parse("2026-04-01", "2026-06-30")
    assert (w.start, w.end) == (date(2026, 4, 1), date(2026, 6, 30))
    assert w.days == 91          # inclusive of both ends


def test_single_day_window_is_one_day_not_zero():
    assert aw.parse("2026-08-17", "2026-08-17").days == 1


# ── one bound implies the other ───────────────────────────────────────────────

def test_only_from_runs_forward_thirty_days():
    w = aw.parse("2026-08-01", "")
    assert (w.start, w.end) == (date(2026, 8, 1), date(2026, 8, 30))
    assert w.days == aw.IMPLIED_SPAN_DAYS


def test_only_to_is_the_thirty_days_ending_then():
    w = aw.parse("", "2026-08-30")
    assert (w.start, w.end) == (date(2026, 8, 1), date(2026, 8, 30))


# ── refusals ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["17-08-2026", "2026/08/17", "yesterday", "2026-13-01",
                                 "2026-02-30"])
def test_malformed_dates_are_refused_with_the_offending_value(bad):
    with pytest.raises(HTTPException) as e:
        aw.parse(bad, "2026-08-31")
    assert e.value.status_code == 400
    assert bad in e.value.detail          # so the caller knows WHICH bound


def test_compact_iso_is_accepted_because_python_accepts_it():
    # date.fromisoformat has taken the basic form since 3.11. Not documented in
    # the API, but not worth refusing either — it is unambiguously the same day.
    assert aw.parse("20260817", "20260831").start == date(2026, 8, 17)


def test_inverted_range_is_refused():
    with pytest.raises(HTTPException) as e:
        aw.parse("2026-08-31", "2026-08-01")
    assert e.value.status_code == 400
    assert "before" in e.value.detail


def test_absurd_span_is_refused_rather_than_served_slowly():
    with pytest.raises(HTTPException) as e:
        aw.parse("1998-01-01", "2026-08-17")
    assert e.value.status_code == 400
    assert str(aw.MAX_SPAN_DAYS) in e.value.detail


def test_the_span_cap_is_a_boundary_not_a_cliff():
    # exactly at the cap is fine; one day past it is not
    end = date(2020, 1, 1).fromordinal(date(2020, 1, 1).toordinal() + aw.MAX_SPAN_DAYS - 1)
    assert aw.parse("2020-01-01", end.isoformat()).days == aw.MAX_SPAN_DAYS
    with pytest.raises(HTTPException):
        aw.parse("2020-01-01", end.fromordinal(end.toordinal() + 1).isoformat())


def test_a_future_end_is_allowed():
    # invoices and orders are routinely dated ahead; clamping would drop rows
    # the client can already see in the list page.
    w = aw.parse("2026-08-01", "2030-01-01")
    assert w.end == date(2030, 1, 1)


# ── comparison window ─────────────────────────────────────────────────────────

def test_previous_period_abuts_and_never_overlaps():
    w = aw.parse("2026-08-01", "2026-08-30")
    p = w.previous()
    assert p.end == date(2026, 7, 31)         # the day before this window starts
    assert p.days == w.days                   # same length, so the totals compare
    assert p.end < w.start


# ── month labels ──────────────────────────────────────────────────────────────

def test_months_between_includes_both_ends():
    w = aw.parse("2026-04-15", "2026-07-02")
    assert aw.months_between(w) == ["2026-04", "2026-05", "2026-06", "2026-07"]


def test_months_between_crosses_a_year():
    w = aw.parse("2025-11-20", "2026-02-03")
    assert aw.months_between(w) == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_months_between_is_capped():
    w = aw.parse("2022-01-01", "2026-08-17")
    assert len(aw.months_between(w, cap=6)) == 6


def test_month_labels_are_zero_padded_so_text_comparison_is_chronological():
    # the payroll query compares TEXT months; that is only sound zero-padded
    labels = aw.months_between(aw.parse("2026-08-01", "2026-11-30"))
    assert labels == sorted(labels)
    assert all(len(m) == 7 for m in labels)


# ── the describe block ────────────────────────────────────────────────────────

def test_describe_is_none_without_a_window():
    assert aw.describe(None, windowed=["revenue"], as_at=["hr"]) is None


def test_describe_names_what_the_window_did_and_did_not_touch():
    d = aw.describe(aw.parse("2026-04-01", "2026-06-30"),
                    windowed=["revenue", "orders"], as_at=["hr", "tasks"])
    assert d["from"] == "2026-04-01" and d["to"] == "2026-06-30" and d["days"] == 91
    # sorted, so a UI can diff two responses without spurious churn
    assert d["windowed"] == ["orders", "revenue"]
    assert d["as_at"] == ["hr", "tasks"]
