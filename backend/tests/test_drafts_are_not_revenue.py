"""An unissued document is not money — held at the three sites that forgot.

── THE RULE ───────────────────────────────────────────────────────────────────

A DRAFT invoice has not been sent to anybody. It is not revenue, it is not
outstanding, it cannot have been collected, and it is not turnover. A CREDIT
NOTE is a reduction of revenue, so summing it unfiltered adds where it should
subtract. A SOFT-DELETED row is not anything at all.

`ganit.invoice_stats` and `routers/dristi.py` each state this at length and each
filters correctly. Three other sites did not.

── WHAT WAS MEASURED, 2026-08-31, ON THE LIVE DATABASE ────────────────────────

`GET /v1/vikray/dashboard` reported **817,016.00** of "total revenue" where the
true figure is **257,696.00** — 7 draft invoices, and the number on the screen
was 3.2x reality. The same endpoint's `order_value`, computed twelve lines
earlier, already excluded drafts and already filtered `is_active`: the
contradiction was inside one response, and the dashboard printed both.

`check_thresholds_approaching` summed drafts into rolling twelve-month turnover,
which is the figure compared against GST registration and audit thresholds. Its
own docstring calls that figure a FLOOR; drafts push it UP, so a firm could be
told it is nearing a threshold on paper it never issued.

`payables_summary` summed `outstanding` over EVERY bill while the aging query
directly beneath it excluded `('paid','cancelled')` — two figures on one card,
computed over different row sets.

── WHY THESE ARE SOURCE-LEVEL ASSERTIONS ──────────────────────────────────────

Same reason `test_receivables_ageing.py` gives: these are guards inside SQL
strings, and the thing that goes wrong is a guard being dropped. A behavioural
test needs a database; a ratchet fails the moment the clause disappears, which
is the actual failure mode. Each assertion below names one guard and says what
the number does without it — a ratchet that cannot say that is decoration.

⚠ AND A RATCHET IS NOT COVERAGE. `check-rendered-ids` and `check-table-rows`
have each stayed green over a real violation in this repo. So the numbers above
were taken from the live database by executing the corrected SQL, not inferred
from the source — and the payables one is recorded as VACUOUS (0 cancelled
bills), because a check that passes for want of data is not a check that passed.
"""
import inspect
import re

import pytest

from routers import ganit, vikray
from services.skills.data import gst_year


def sql_of(fn):
    """The function's source with comments stripped, so a guard named only in a
    comment cannot satisfy an assertion about the query."""
    src = inspect.getsource(fn)
    return "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))


# ── 1 · the Vikray dashboard: 817,016 against a true 257,696 ────────────────

def test_dashboard_revenue_excludes_drafts():
    """Without this the headline was 3.2x the truth on the reference org."""
    assert re.search(r"COALESCE\(doc_status,\s*''\)\s*<>\s*'draft'", sql_of(vikray.dashboard)), (
        "the dashboard's revenue query counts DRAFT invoices as revenue; measured "
        "live it reported 817,016.00 where the issued total was 257,696.00"
    )


def test_dashboard_revenue_excludes_credit_notes():
    """A credit note REDUCES revenue. Summed unfiltered it increased it, so the
    error here is a sign error, not an over-count."""
    assert re.search(r"invoice_type,?\s*''?\)?\s*<>\s*'credit_note'", sql_of(vikray.dashboard)), (
        "credit notes are being added to revenue instead of reducing it"
    )


def test_dashboard_revenue_excludes_soft_deleted_invoices():
    q = sql_of(vikray.dashboard)
    revenue = q[q.index("total_revenue"):]
    assert "is_active" in revenue, "soft-deleted invoices are counted as revenue"


def test_the_draft_guard_is_nullable_safe():
    """`doc_status` is nullable. Bare `doc_status <> 'draft'` is NULL for a
    legacy row and drops it — trading an over-count for an under-count while
    looking like a fix. Every other site in this codebase uses the COALESCE
    form; this asserts nobody 'simplifies' it back."""
    q = sql_of(vikray.dashboard)
    assert not re.search(r"(?<!COALESCE\()\bdoc_status\s*<>\s*'draft'", q.replace("COALESCE(doc_status, '')", "X")), (
        "the draft guard is not nullable-safe; legacy rows with a NULL "
        "doc_status will be silently dropped from revenue"
    )


def test_the_dashboards_two_money_figures_use_the_same_rules():
    """`order_value` and `total_revenue` sit in one response. They read
    different tables, but both must exclude drafts and inactive rows — the
    original defect was precisely that one did and the other did not."""
    q = sql_of(vikray.dashboard)
    # `order_value` names its filter BEFORE the alias
    # (`SUM(total) FILTER (WHERE status NOT IN ('cancelled','draft')) AS order_value`)
    # while `total_revenue` names its filters after, in the WHERE clause. Slice
    # each around its own alias rather than assuming one shape for both.
    order_block = q[q.index("orders_stats"):q.index("pipeline =")]
    revenue_block = q[q.index("revenue ="):q.index("return {")]
    for name, block in (("order_value", order_block), ("total_revenue", revenue_block)):
        assert "draft" in block, f"{name} does not exclude drafts"
        assert "is_active" in block, f"{name} does not exclude soft-deleted rows"


# ── 2 · GST turnover against a statutory threshold ──────────────────────────

def test_threshold_turnover_excludes_drafts():
    """The figure this feeds is compared against GST registration and audit
    thresholds. Drafts inflate it, so the error tells a firm it is closer to a
    threshold than it is — on documents it never issued."""
    q = sql_of(gst_year.check_thresholds_approaching)
    assert re.search(r"COALESCE\(doc_status,\s*''\)\s*<>\s*'draft'", q), (
        "rolling twelve-month turnover counts DRAFT invoices, contradicting the "
        "floor its own docstring promises and erring toward a false alarm"
    )


def test_threshold_turnover_still_nets_off_credit_notes():
    """Pre-existing and correct — a credit note must reduce turnover. Pinned so
    the draft fix above cannot be applied in a way that disturbs it."""
    q = sql_of(gst_year.check_thresholds_approaching)
    assert "credit_note" in q and "credits" in q


# ── 3 · payables: a headline that disagreed with its own breakdown ──────────

@pytest.mark.parametrize("field", ["outstanding", "overdue"])
def test_payables_headline_excludes_cancelled_bills(field):
    """⚠ THIS ONE IS CURRENTLY VACUOUS IN THE DATA AND THAT IS THE POINT.

    Live 2026-08-31: 17 active bills, 0 cancelled — so the headline and the
    aging breakdown agree today by coincidence, and any test that compared the
    two live numbers would pass while the bug sat there. This asserts the GUARD
    instead. The first cancelled bill makes a cancelled amount appear in
    `outstanding` and in no bucket, with no error and no log line.
    """
    q = sql_of(ganit.payables_summary)
    block = q[q.index(f"AS {field}") - 300:q.index(f"AS {field}")]
    assert "NOT IN ('paid','cancelled')" in block.replace(" ", "").replace(
        "NOTIN('paid','cancelled')", "NOT IN ('paid','cancelled')"
    ) or "cancelled" in block, (
        f"`{field}` counts cancelled vendor bills as money owed, while the aging "
        f"query beneath it excludes them — the card cannot add up"
    )


def test_payables_headline_and_aging_share_one_row_set():
    """The two queries must name the same exclusions. This is the invariant; the
    two parametrised cases above are the instances."""
    q = sql_of(ganit.payables_summary)
    headline, aging = q.split("aging = await", 1)
    assert "cancelled" in headline, "the headline does not exclude cancelled bills"
    assert "cancelled" in aging, "the aging query no longer excludes cancelled bills"
