"""The Overdue tile counted a status nothing in this product ever writes.

`GET /api/v1/ganit/stats` computed `overdue_count` as
`COUNT(*) FILTER (WHERE payment_status='overdue')`. Measured against the live
table: 712 invoices, paid 329, unpaid 237, partial 146 — and, in the product's
whole life, ZERO rows with 'overdue'. There is no writer for it. The only two
writers of the column are `cancel_invoice` ('cancelled') and `record_payment`
('paid'/'partial'); the one INSERT path hardcodes 'unpaid'. No trigger, no
pg_cron, and the job that was meant to set it imports a module that does not
exist and answers 200.

So the count was structurally zero, on two screens:
  · Ganit's KPI strip
  · the Today dashboard, via ReceivablesKPI

Both read "Overdue: 0 · nothing past due" while the correct predicate returned
189 invoices for one org and 10 — worth Rs 2,98,068 — for a real customer. The
tile also shows its MSME 43B(h) warning only when the count is non-zero, so a
firm with genuine 43B(h) exposure was told the opposite.

── WHY THESE TESTS ASSERT ON SQL

`test_ganit.test_invoice_stats` exists and passes. It sets
`mock_pool.fetchrow.return_value = {..., "overdue_count": 1, ...}` and asserts
`total_invoices == 10` — it proves the endpoint returns the dict the mock handed
it, which was true before this fix and after it. A mocked cursor resolves any
predicate you write, so the ONLY thing a test can prove here is which predicate
the handler asks for. That is what these assert.
"""
import re

import pytest


def _code_of(fn) -> str:
    """A handler's EXECUTABLE source, comments stripped, whitespace normalised.

    Stripping comments is not tidiness. `inspect.getsource` returns them, and
    this file's own explanation quotes `payment_status='overdue'` verbatim — so
    the first version of these tests asserted against MY commentary and failed
    on prose. That is the same defect this repository has shipped three times in
    the other direction, where a check PASSED because a comment satisfied it.
    Assert on what runs.
    """
    import inspect
    src = inspect.getsource(fn)
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    return " ".join(code.split())


def _stats_sql() -> str:
    """The SQL `invoice_stats` issues, read from source rather than executed."""
    from routers import ganit
    return _code_of(ganit.invoice_stats)


def test_overdue_is_derived_from_the_due_date():
    sql = _stats_sql()
    assert "due_date < CURRENT_DATE" in sql, \
        "overdue is a date, not a status — nothing writes payment_status='overdue'"


def test_overdue_no_longer_counts_the_status_nothing_writes():
    sql = _stats_sql()
    assert "payment_status='overdue'" not in sql.replace(" ", ""), \
        "the handler still counts a value no code path in this product ever sets"


def test_a_settled_invoice_is_not_overdue_however_old_it_is():
    """The date predicate alone would call every paid invoice from last year late."""
    sql = _stats_sql()
    window = sql[sql.index("due_date < CURRENT_DATE"):][:220]
    assert "payment_status IN ('unpaid','partial')" in window, \
        "overdue must exclude paid and cancelled invoices"


def test_the_dead_status_is_gone_from_the_outstanding_total_too():
    """
    `total_outstanding` filtered on IN ('unpaid','partial','overdue'). The third
    never matched a row, and a dead value left in an IN list is how the next
    reader concludes the status is real.
    """
    sql = _stats_sql()
    assert "'overdue'" not in sql, "a dead status is still referenced in this handler"


def test_the_amount_is_returned_and_not_only_the_count():
    """
    "10 invoices are late" and "Rs 2,98,068 is late" are different sentences, and
    the second is the one a finance user acts on. The payables half of the same
    screen has always returned both.
    """
    assert "overdue_amount" in _stats_sql()


def test_receivables_and_payables_agree_on_what_overdue_means():
    """
    This was a disagreement INSIDE one feature, not a design choice: the payables
    half of the same KPI strip has always used the date. If the two ever diverge
    again, one side of the screen is lying about the same word.
    """
    from routers import ganit
    payables = _code_of(ganit.payables_summary)
    assert "due_date < CURRENT_DATE" in payables
    assert "due_date < CURRENT_DATE" in _stats_sql()


def test_no_handler_anywhere_in_ganit_counts_the_dead_status():
    """
    A sweep, because the same mistake in a second place would be just as
    invisible — silently zero, on a screen about money.
    """
    import pathlib
    src = (pathlib.Path(__file__).resolve().parent.parent / "routers" / "ganit.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    hits = re.findall(r"payment_status\s*=\s*'overdue'", code.replace(" ", ""))
    assert not hits, f"{len(hits)} handler(s) still filter on payment_status='overdue'"
