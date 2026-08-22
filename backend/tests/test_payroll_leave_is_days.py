"""Payroll counts leave in DAYS, and only the days inside the month it is paying.

Both queries in the monthly salary computation were `SELECT COUNT(*)`, so they
counted leave REQUESTS. One approved five-day leave counted as 1. The line below
them is

    payable_days = present_days + paid_leaves

so the error landed straight on pay. Measured on the live database when this was
found: 151 approved requests against 292 actual days, understating leave by
roughly half.

Two things had to be true of the fix, and this file pins both.

  1. It counts `days`, not rows. `days` is the authority rather than the calendar
     span because it is what the approver agreed and it carries half-days — it is
     numeric, and differs from the span on 7 of 151 live rows.

  2. It charges a month only for the part of the leave that falls inside it. The
     predicate matches any leave OVERLAPPING the month, and 6 of 151 approved
     requests cross a month boundary, so charging the whole `days` to both months
     would double-count them.

These are asserted against the SQL the handler actually issues, because the
arithmetic lives in the query rather than in Python. A recording pool cannot
execute it, so the shape of the statement is the thing under test — a pool that
merely echoed a fixture back would prove nothing about a `COUNT(*)` regression.
"""
import re

import pytest

import routers.vetana as vetana


def _leave_sql() -> str:
    """The leave query as the module builds it, whitespace-normalised."""
    src = open(vetana.__file__, encoding="utf-8").read()
    m = re.search(r"leave_days_sql\s*=\s*\((.*?)\n        \)", src, re.S)
    assert m, "leave_days_sql is no longer built as one expression in vetana.py"
    parts = re.findall(r'"([^"]*)"', m.group(1))
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def test_leave_is_summed_in_days_not_counted_in_rows():
    sql = _leave_sql()
    assert "COUNT(*)" not in sql.upper(), (
        "payroll is counting leave REQUESTS again; one five-day leave becomes 1 "
        "and payable_days is short by four: %s" % sql)
    assert "SUM(" in sql.upper() and "lr.days" in sql, (
        "the leave total must come from SUM over the days column: %s" % sql)


def test_only_the_days_inside_this_month_are_charged():
    """A leave spanning two months must not be charged in full to both."""
    sql = _leave_sql()
    assert "LEAST(lr.end_date" in sql and "GREATEST(lr.start_date" in sql, (
        "the query does not clamp the leave to the month, so a leave crossing a "
        "month boundary is charged in full to both months: %s" % sql)
    assert "NULLIF(" in sql, (
        "the span divisor is unguarded; a zero span would divide by zero inside "
        "payroll: %s" % sql)


def test_the_paid_and_unpaid_arms_differ_only_by_the_is_paid_flag():
    """One expression, two uses — so a fix to one can never miss the other."""
    sql = _leave_sql()
    assert "{is_paid}" in sql, (
        "the paid and unpaid queries are no longer the same expression, which is "
        "how they drifted apart the first time: %s" % sql)
    src = open(vetana.__file__, encoding="utf-8").read()
    assert 'leave_days_sql.format(is_paid="TRUE")' in src
    assert 'leave_days_sql.format(is_paid="FALSE")' in src


def test_the_result_reaches_payable_days_as_a_number():
    """`payable_days = present_days + paid_leaves` must not add a Decimal to a float."""
    src = open(vetana.__file__, encoding="utf-8").read()
    assert "paid_leaves = float(" in src, (
        "SUM over a numeric column returns Decimal; added to a float present_days "
        "this raises inside payroll")
    assert "unpaid_leaves = float(" in src


@pytest.mark.parametrize("start,end,m_start,m_end,days,expected", [
    # wholly inside the month -> charged in full
    ("2026-08-10", "2026-08-14", "2026-08-01", "2026-08-31", 5, 5.0),
    # a single day
    ("2026-08-10", "2026-08-10", "2026-08-01", "2026-08-31", 1, 1.0),
    # half day, wholly inside
    ("2026-08-10", "2026-08-10", "2026-08-01", "2026-08-31", 0.5, 0.5),
    # crosses into September: 2 of 5 days belong to August
    ("2026-08-30", "2026-09-03", "2026-08-01", "2026-08-31", 5, 2.0),
    # ...and the other 3 belong to September
    ("2026-08-30", "2026-09-03", "2026-09-01", "2026-09-30", 5, 3.0),
])
def test_the_pro_rata_arithmetic_the_sql_encodes(start, end, m_start, m_end, days, expected):
    """The same expression in Python, so the intended numbers are written down.

    This does not execute the SQL — it states what the SQL must compute, so a
    future rewrite has a target rather than a description.
    """
    from datetime import date

    def d(s):
        return date.fromisoformat(s)

    overlap = (min(d(end), d(m_end)) - max(d(start), d(m_start))).days + 1
    span = (d(end) - d(start)).days + 1
    assert round(days * (overlap / span), 6) == expected
