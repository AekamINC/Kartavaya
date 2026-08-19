"""Receivables ageing by party — the first row-level report section.

The aggregate already exists: `analytics/metrics/ganit.py`'s
`ganit.receivables_ageing` returns four totals (0-30 / 31-60 / 61-90 / 90+)
and `ganit.outstanding` returns the one number those four split. Neither can
say WHO owes it — a MetricRequest has no entity filter and no row mode — and
"₹1.72 crore is over 90 days" is not a document anyone can act on. This
section is the same book, opened.

Three facts this file is built on, each verified against the live database on
2026-08-19 (read-only probe, E2E org 265 open invoices / ₹2,66,19,706.62):

1. AGE FROM THE DUE DATE, NEVER THE INVOICE DATE.
   `services/statement_pdf.age_receivables` already made this decision for
   the per-client statement, and it is imported here rather than reimplemented
   so the statement a client disputes and the org-wide report the firm chases
   from can never disagree by a bucket. An invoice on 30-day terms issued 40
   days ago is 10 days overdue, not 40. Measured cost of getting it wrong on
   the seeded org: ₹6,04,214.04 of balance moves INTO 90+ if the ageing
   anchors on invoice_date — money reported as three months late that is not.

2. `due_date` IS NULL ON 94 OF THE 265 OPEN INVOICES (35%).
   So the anchor is `COALESCE(due_date, invoice_date)`, the same COALESCE
   `ganit.receivables_ageing` and `ganit.top_debtors` use. Ageing on
   `due_date` alone would silently drop a third of the book off the page —
   and an ageing report that omits rows is worse than none, because it
   reconciles against nothing and still looks complete.

3. OUTSTANDING IS `total - COALESCE(amount_paid, 0)`, NEVER `balance_due`.
   The column exists and is NOT NULL, which is exactly why it is tempting.
   It has DRIFTED from the arithmetic on 2 of the 684 live non-draft rows
   (re-measured 2026-08-19; `analytics/metrics/ganit.py` found the same two).
   `age_receivables` reads its input under the key `balance_due`, so the SQL
   here computes the arithmetic and hands it over under that name — the
   bucketing is shared, the source of the number is not.

The remaining guards are the ganit house set, and dropping any one of them
changes the total: `is_active = TRUE` (soft delete); `doc_status <> 'draft'`,
NEVER `= 'final'` (live values are final/viewed/draft/sent — an equality test
silently drops 155 real invoices, and `doc_status` defaults to 'final' so it
never meant "locked" anyway); credit notes excluded (stored with POSITIVE
totals — summing them would ADD reversals to what a client owes).

AS AT TODAY, not the report window. This is a stock: the balance is what is
unpaid now. Ageing today's balance at a window-end date would print buckets
that do not sum to today's outstanding, and the total is the one figure a
reader cross-checks against `ganit.outstanding`.
"""
from __future__ import annotations

from datetime import date

from services.report_defs import report_def
from services.statement_pdf import AGEING_BUCKETS, age_receivables

#: The party column's header. The CRM client is the COMPANY — the customer
#: that stays — not the contact person, who comes and goes.
PARTY_COLUMN = "Party"

#: What an invoice with no linked client is called. 239 of 786 live rows have
#: `client_id IS NULL` (re-measured read-only 2026-08-19; ganit.py's "234 of
#: 781" is the same fact taken two days earlier), and they are real money
#: owed; they fold into one honest row rather than vanishing or printing a
#: UUID (names-not-ids).
UNLINKED = "Unlinked client"

#: The footer row. A person reading a page of parties needs the org figure,
#: and it must be visibly the sum of what is above it.
TOTAL_ROW = "All parties"

#: One open invoice per row: the party that owes it, the date it is aged
#: from, and the balance. Everything else — the bucketing, the party
#: subtotals — happens in Python against the SHARED ager, so this query has
#: no CASE ladder that could drift from the statement's.
OPEN_ITEMS_SQL = (
    "SELECT COALESCE(c.name, $2::text) AS party, "
    "       COALESCE(i.due_date, i.invoice_date) AS due_date, "
    "       (i.total - COALESCE(i.amount_paid, 0))::float AS balance_due "
    "  FROM staging.ganit_invoices i "
    # LEFT, not INNER: client_id is NULL on 239 live rows — 181 of them in the
    # seeded org — and an INNER JOIN would drop ₹42,34,873.20 of that org's
    # open book without a trace. Re-measured read-only 2026-08-19.
    "  LEFT JOIN staging.graha_clients c ON c.id = i.client_id "
    " WHERE i.org_id = $1::uuid "
    "   AND i.is_active = TRUE "
    "   AND i.doc_status <> 'draft' "
    "   AND i.invoice_type <> 'credit_note' "
    "   AND i.total - COALESCE(i.amount_paid, 0) > 0 "
    " ORDER BY party"
)


def _money(v) -> float:
    """Two decimals, once. Every printed cell is rounded HERE and the totals
    are summed from the rounded cells — so the row a reader adds up on paper
    is the row that ties. Summing raw floats and rounding the total is how a
    statement ends up one paisa off its own columns."""
    return round(float(v or 0.0), 2)


def build_rows(open_items: list, as_at) -> list:
    """The table: one row per party, one column per ageing bucket, plus the
    org total. Pure, so the reconciliation is testable without a database."""
    by_party: dict[str, list] = {}
    for item in open_items:
        by_party.setdefault(str(item["party"] or UNLINKED), []).append(item)

    rows, totals = [], {key: 0.0 for key, _, _, _ in AGEING_BUCKETS}
    for party, items in by_party.items():
        # THE shared ager — statement_pdf's, not a copy. It ages from
        # `due_date` and falls back to `date`; this caller always supplies
        # due_date, already COALESCEd in SQL.
        buckets = age_receivables(items, as_at)
        cells = {label: _money(buckets[key]) for key, label, _, _ in AGEING_BUCKETS}
        party_total = _money(sum(cells.values()))
        if party_total <= 0:
            # A party whose open items net to nothing owes nothing, and this
            # page is a CHASE LIST: a row of zeros against a real client name
            # reads as "we chased, they paid nothing" and a clerk rings a
            # customer who is square. `age_receivables` skips every item with
            # outstanding <= 0, so a party reaches here exactly when ALL of
            # its items were credit balances or overpayments and nothing
            # survived to age. The SQL's `total - amount_paid > 0` already
            # excludes those invoices, so on the live path this never fires —
            # it fires for any future caller that relaxes that WHERE clause,
            # which is the caller that would otherwise print the zero row.
            continue
        for key, label, _, _ in AGEING_BUCKETS:
            totals[key] += cells[label]
        rows.append({PARTY_COLUMN: party, **cells, "Total": party_total})

    # Biggest debtor first: this page exists to be worked down, and
    # alphabetical order buries the ₹61 lakh account under the ₹9 lakh one.
    rows.sort(key=lambda r: r["Total"], reverse=True)
    if rows:
        # No footer on an empty book — `render_report_html` prints "No rows
        # for this period" for an empty list, which is the honest page, and a
        # lone row of zeros reads as a report that ran and found nothing owed
        # when it may equally have found nothing at all.
        rows.append({PARTY_COLUMN: TOTAL_ROW,
                     **{label: _money(totals[key])
                        for key, label, _, _ in AGEING_BUCKETS},
                     "Total": _money(sum(totals.values()))})
    return rows


@report_def(
    key="ganit.receivables_ageing_by_party",
    module="ganit",
    label="Receivables ageing by party",
    grain="stock",
    # The client NAME on a ganit invoice is ganit's own data — the same LEFT
    # JOIN `ganit.top_debtors` already makes under the ganit grant. This
    # section reads no CRM field beyond that name, so it does not demand a
    # graha grant; adding one (a contact, a pipeline stage) means adding
    # 'graha' to this set in the same commit.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description="Every party with an open balance, aged from the DUE date "
                "into Current / 1–30 / 31–60 / 61–90 / 90+ days, as at "
                "today. The Total column and the All parties row reconcile "
                "to ganit.outstanding.",
)
async def receivables_ageing_by_party(pool, org_id: str, window=None) -> list:
    """`window` is None by contract (grain='stock') and is ignored: the
    balance is what is unpaid NOW."""
    rows = await pool.fetch(OPEN_ITEMS_SQL, str(org_id), UNLINKED)
    return build_rows([dict(r) for r in rows], date.today())
