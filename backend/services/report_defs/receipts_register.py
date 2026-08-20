"""Receipts register — one row per payment received.

The third book: money IN, in the order it arrived. `ganit.collected` already
returns the period's collections as one number; this is that number with the
receipts under it, so a clerk can tie the register to the bank.

Measured read-only against the live database on 2026-08-20. All-org counts;
the seeded E2E org holds 441 of the 506.

506 PAYMENTS, AND THE THREE COLUMNS THAT MATTER ARE 100% FILLED
───────────────────────────────────────────────────────────────
`payment_date`, `payment_method` and `reference` are non-null on all 506 rows
(11 references are the EMPTY STRING, which prints blank — a receipt recorded
without a UTR or cheque number is a real receipt). `invoice_id` resolves on
all 506, 0 orphans, and 0 payments point at an invoice belonging to a
different org.

TWO COLUMNS THAT LOOK USEFUL AND ARE NOT, BOTH VERIFIED EMPTY
─────────────────────────────────────────────────────────────
`received_on` (text) is NULL on all 506 rows and `attribution` is NULL on all
506. Neither is read here. They are named rather than passed over in silence,
because both look like exactly the column this register wants and a future
reader would otherwise try one and get a column of blanks.

THE FOUR RECEIPTS AGAINST DRAFT INVOICES ARE INCLUDED, DELIBERATELY
───────────────────────────────────────────────────────────────────
4 of the 506 payments sit against an invoice still at `doc_status = 'draft'`.
They are in the register. A receipt is money in the bank; whether the document
it was matched to has been finalised is a housekeeping question about the
document, not about the money. Excluding them would produce a register that
does not tie to the bank statement by exactly those four amounts, and there is
no worse failure for this particular page — this product has no payment
gateway and never will, so "paid" only ever comes from bank reconciliation and
the register must reconcile to it.

For the same reason there is no `is_active` guard on the payment: the payments
table has no such column, and a receipt is not soft-deleted, it is refunded —
which is its own row.

THE JOIN IS INNER, AND ORG-SCOPED ON BOTH SIDES
───────────────────────────────────────────────
INNER because `invoice_id` resolves on all 506 and the invoice is where the
party's name lives; a receipt with no document is a row this schema cannot
currently produce, and if it ever does, it must fail loudly by disappearing
from a register that is being tied to a bank statement rather than appear
under a blank party. Both `p.org_id` and `i.org_id` are bound, and the CRM
joins carry `AND x.org_id = i.org_id`: a join on `id` alone can surface
another org's customer name (graha_clients_join_leak).

The party is resolved with the same three-step chain the invoice document
itself prints (`services/invoice_pdf.py`): client name → contact company →
contact name → "Unlinked party". Live fill across the 506: 437 / 45 / 21 / 3.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import (
    ROW_CAP, capped, finish, money, window_or_raise)

KEY = "ganit.receipts_register"

#: Where the footer's label sits — the reference column, never the date.
LABEL_COLUMN = "Reference"

#: The footer.
TOTAL_ROW = "All receipts"

#: What a receipt whose invoice names nobody is called. 3 live rows.
UNLINKED = "Unlinked party"

#: Human names for `payment_method`. The CHECK admits six values and all six
#: are mapped; an unmapped seventh still prints readably.
METHOD_LABELS: dict[str, str] = {
    "cash": "Cash",
    "bank_transfer": "Bank transfer",
    "upi": "UPI",
    "cheque": "Cheque",
    "card": "Card",
    "other": "Other",
}

#: The money columns, in print order. The footer sums exactly these.
MONEY_COLUMNS = ("Amount",)

RECEIPTS_SQL = (
    "SELECT p.payment_date AS paid_on, "
    "       p.reference AS reference, "
    "       p.payment_method AS method, "
    "       i.invoice_number AS doc_number, "
    "       COALESCE(NULLIF(TRIM(cl.name), ''), "
    "                NULLIF(TRIM(ct.company), ''), "
    "                NULLIF(TRIM(ct.name), ''), "
    "                $4::text) AS party, "
    "       COALESCE(p.amount, 0)::float AS amount "
    "  FROM staging.ganit_payments p "
    "  JOIN staging.ganit_invoices i "
    "    ON i.id = p.invoice_id AND i.org_id = p.org_id "
    "  LEFT JOIN staging.graha_clients cl "
    "         ON cl.id = i.client_id AND cl.org_id = i.org_id "
    "  LEFT JOIN staging.graha_contacts ct "
    "         ON ct.id = i.contact_id AND ct.org_id = i.org_id "
    " WHERE p.org_id = $1::uuid "
    "   AND p.payment_date BETWEEN $2::date AND $3::date "
    # Chronological, then by document: the order a bank statement is read in.
    " ORDER BY p.payment_date, i.invoice_number "
    " LIMIT $5::int"
)


def method_label(raw) -> str:
    raw = str(raw or "").strip()
    return METHOD_LABELS.get(raw, raw.replace("_", " ").capitalize() or "")


def build_rows(receipts: list, dropped: int = 0) -> list:
    """The table. Pure, so the footer is testable without a database."""
    rows = [{
        "Date": r.get("paid_on"),
        # Blank on 11 live rows (empty-string references). A receipt recorded
        # without a UTR or cheque number is still a receipt.
        LABEL_COLUMN: str(r.get("reference") or "").strip(),
        "Method": method_label(r.get("method")),
        "Against": str(r.get("doc_number") or ""),
        "Party": str(r.get("party") or UNLINKED),
        "Amount": money(r.get("amount")),
    } for r in receipts]
    return finish(rows, LABEL_COLUMN, TOTAL_ROW, MONEY_COLUMNS, dropped)


@report_def(
    key=KEY,
    module="ganit",
    label="Receipts register",
    grain="flow",
    # The party's NAME is what ganit's own invoice document prints and what
    # `/ganit/collections` already serves under the ganit grant — the same
    # reasoning `receivables_ageing` states. No other CRM field is read.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description="Every payment received in the period, one row each, with the "
                "date, the reference, how it came in, the document it was "
                "matched to and the party who sent it. Receipts matched to a "
                "document that is still a draft ARE included — the money is "
                "in the bank either way, and this register is meant to tie to "
                "a bank statement. A blank reference means one was never "
                "recorded.",
)
async def receipts_register(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, KEY)
    rows = await pool.fetch(RECEIPTS_SQL, str(org_id), win.start, win.end,
                            UNLINKED, ROW_CAP + 1)
    receipts, dropped = capped([dict(r) for r in rows])
    return build_rows(receipts, dropped)
