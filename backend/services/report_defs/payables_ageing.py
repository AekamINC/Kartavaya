"""Payables ageing by bill — what the firm owes, bill by bill, as at today.

`receivables_ageing_by_party` opened the money owed TO the firm. This is the
other side, and it is deliberately a different shape: `/ganit/payables-summary`
already returns the bucket TOTALS, so a second page of bucket totals would add
nothing. What no surface in the product can answer today is WHICH BILL — and
"₹28.7 lakh is over 90 days late" is not a document anyone can pay from.

Measured read-only against the live database on 2026-08-20. All-org counts;
the seeded E2E org holds 80 of the 95 open bills.

AS AT TODAY, NOT THE REPORT WINDOW
──────────────────────────────────
This is a STOCK: what is unpaid NOW. `module_report.report_section` hands a
stock section None for the window and this builder ignores dates entirely,
because ageing today's balance at a period end prints buckets that do not sum
to today's payables — and the footer is the one figure a reader cross-checks.

AGE FROM THE DUE DATE, NEVER THE BILL DATE
──────────────────────────────────────────
The same decision `services/statement_pdf.age_receivables` made for the
receivable side, and the cost of getting it wrong is measured, not asserted:
anchoring on `bill_date` puts ₹33,02,025.16 in the 90+ bucket where the due
date puts ₹28,69,924.48 — ₹4,32,100.68 reported as three months late that is
not. A bill on 30-day terms raised 40 days ago is 10 days overdue.

`due_date` IS NULL ON 16 OF THE 95 OPEN BILLS (17%), so the anchor is
`COALESCE(due_date, bill_date)` — the same COALESCE the receivables side uses.
Ageing on `due_date` alone would silently drop a sixth of the payables off the
page, and a ledger that omits rows reconciles against nothing while still
looking complete.

Two columns that would appear to offer a better anchor were checked and are
EMPTY: `ganit_vendors.payment_terms_days` is NULL on all 80 vendors and
`ganit_vendors.is_msme` is NULL on all 80. So there are no vendor default
terms to derive a due date from, and no MSME column worth printing. They are
named here so the next reader does not re-discover them the slow way. Note
also that deriving a due date from a vendor default would print a due date
that is not written on the bill, which is a different and worse failure than
falling back to the bill's own date.

THE BUCKET IS NOT REIMPLEMENTED — IT IS ASKED
─────────────────────────────────────────────
`bucket_of` calls `age_receivables` with the single bill and reads back which
bucket received the money. That is slower than a CASE ladder by an
irrelevant amount (95 rows) and it makes drift IMPOSSIBLE rather than merely
tested: the payables page, the receivables page and the client statement all
bucket through one function, so they cannot disagree about what "61–90" means.

THE BALANCE IS ARITHMETIC, NOT A STATUS
───────────────────────────────────────
`total - COALESCE(amount_paid, 0)`. `ganit_vendor_bills` has no `balance_due`
column to be tempted by (the invoices table does, and it has drifted from the
arithmetic on 2 live rows — see `receivables_ageing.py`). The `status` column
is also not trusted to decide what is open: measured today it agrees on every
row (0 bills marked paid while still owing, 0 overpaid, 0 settled but
unmarked), and it is still not the source, because a status is a label
somebody sets and a balance is a subtraction.

Cancelled bills are excluded (`status <> 'cancelled'`); the firm does not owe
them. Live count of cancelled bills: 0.
"""
from __future__ import annotations

from datetime import date

from services.report_defs import report_def
from services.report_defs._shared import ROW_CAP, capped, finish, money
from services.statement_pdf import AGEING_BUCKETS, age_receivables

KEY = "ganit.payables_ageing_by_bill"

#: Where the footer's label sits — the vendor column.
LABEL_COLUMN = "Vendor"

#: The footer.
TOTAL_ROW = "All open bills"

#: What a bill whose vendor row has gone is called. 0 live rows.
UNKNOWN_VENDOR = "Unknown vendor"

#: Excluded entirely. Bound, never interpolated.
CANCELLED_STATUS = "cancelled"

#: The bucket printed when a bill with a positive balance somehow ages into
#: none of the ladder's buckets. `age_receivables` places every item with
#: `balance_due > 0`, and the SQL below returns only such rows, so this is
#: unreachable on the live path — it exists so a future caller that relaxes
#: the WHERE clause prints a word instead of raising inside the document loop.
UNAGED = "Not aged"

#: The money columns, in print order. The footer sums exactly these.
MONEY_COLUMNS = ("Bill total", "Paid", "Balance")

OPEN_BILLS_SQL = (
    "SELECT COALESCE(NULLIF(TRIM(v.name), ''), $2::text) AS vendor, "
    "       b.bill_number AS bill_number, "
    "       b.bill_date AS bill_date, "
    "       COALESCE(b.due_date, b.bill_date) AS due_date, "
    "       COALESCE(b.total, 0)::float AS bill_total, "
    "       COALESCE(b.amount_paid, 0)::float AS paid, "
    "       (COALESCE(b.total, 0) - COALESCE(b.amount_paid, 0))::float AS balance_due "
    "  FROM public.ganit_vendor_bills b "
    # LEFT and org-scoped: a bill whose vendor row was deleted is still owed,
    # and a join on `id` alone can print another org's vendor name.
    "  LEFT JOIN public.ganit_vendors v "
    "         ON v.id = b.vendor_id AND v.org_id = b.org_id "
    " WHERE b.org_id = $1::uuid "
    "   AND b.is_active = TRUE "
    "   AND b.status <> $3::text "
    "   AND b.total - COALESCE(b.amount_paid, 0) > 0 "
    # Oldest anchor first, biggest balance next. The PRINTED order is decided
    # in Python (below) over the computed days-overdue, but the SQL must still
    # order deterministically before LIMIT: an unordered LIMIT would cut an
    # ARBITRARY subset, so an overflowing org would be handed 5,000 random
    # bills and then sort those — a page that looks like the most overdue and
    # is not.
    " ORDER BY COALESCE(b.due_date, b.bill_date), "
    "          b.total - COALESCE(b.amount_paid, 0) DESC "
    " LIMIT $4::int"
)


def bucket_of(balance: float, due, as_at) -> str:
    """Which ageing bucket ONE bill falls in, decided by the SHARED ager.

    `age_receivables` reads its input under the keys `due_date` and
    `balance_due`, returns a bucket→amount map, and treats `days_overdue <= 0`
    as current — day zero is not day one, and a boundary that slips by one
    prints a vendor as late on the morning the payment is due.
    """
    buckets = age_receivables(
        [{"due_date": due, "balance_due": balance}], as_at)
    for key, label, _lo, _hi in AGEING_BUCKETS:
        if buckets[key]:
            return label
    return UNAGED


def days_overdue(due, as_at) -> int:
    """How many days past due, floored at zero.

    A bill not yet due reads 0, not a negative number: the column is headed
    "Days overdue" and -7 in it is not an overdue count, it is a different
    fact wearing the same header. How far away it is remains visible in the
    Due date column beside it. `as_at` and `due` are plain dates; a missing
    due date cannot reach here (the SQL COALESCEs it to the bill date).
    """
    if due is None:
        return 0
    return max(0, (as_at - due).days)


def build_rows(open_bills: list, as_at, dropped: int = 0) -> list:
    """The table. Pure, so the bucketing and the footer are testable without
    a database."""
    rows = []
    for b in open_bills:
        balance = money(b.get("balance_due"))
        due = b.get("due_date")
        rows.append({
            LABEL_COLUMN: str(b.get("vendor") or UNKNOWN_VENDOR),
            "Bill": str(b.get("bill_number") or ""),
            "Bill date": b.get("bill_date"),
            "Due date": due,
            "Bill total": money(b.get("bill_total")),
            "Paid": money(b.get("paid")),
            "Balance": balance,
            "Days overdue": days_overdue(due, as_at),
            "Ageing": bucket_of(balance, due, as_at),
        })
    # Most overdue first, then biggest: this page exists to be worked DOWN,
    # and a bill 400 days late for ₹9,000 is still the one a firm settles
    # before a ₹9 lakh bill that is not due until next week.
    rows.sort(key=lambda r: (r["Days overdue"], r["Balance"]), reverse=True)
    return finish(rows, LABEL_COLUMN, TOTAL_ROW, MONEY_COLUMNS, dropped)


@report_def(
    key=KEY,
    module="ganit",
    label="Payables ageing by bill",
    grain="stock",
    # Vendors and vendor bills are both ganit tables. Nothing outside ganit is
    # read, so nothing outside ganit is demanded.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description="Every vendor bill still carrying a balance, one row each, "
                "aged from the DUE date into Current / 1–30 / 31–60 / 61–90 / "
                "90+ days as at today — the rows behind the bucket totals the "
                "payables summary already gives. Most overdue first. The "
                "balance is the bill total minus what has been paid, not the "
                "bill's status flag, and bills with no due date are aged from "
                "the bill date.",
)
async def payables_ageing_by_bill(pool, org_id: str, window=None) -> list:
    """`window` is None by contract (grain='stock') and is ignored: what the
    firm owes is what is unpaid NOW."""
    rows = await pool.fetch(OPEN_BILLS_SQL, str(org_id), UNKNOWN_VENDOR,
                            CANCELLED_STATUS, ROW_CAP + 1)
    bills, dropped = capped([dict(r) for r in rows])
    return build_rows(bills, date.today(), dropped)
