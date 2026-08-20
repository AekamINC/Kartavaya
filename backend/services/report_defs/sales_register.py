"""Sales register — one row per document the firm ISSUED.

The book a firm actually opens. `ganit.invoiced` (analytics/metrics/ganit.py)
already returns the period's turnover as one number; nobody can file, audit or
argue with one number. This is the same figure with the documents under it, in
date order, with the tax split each one carries.

Every fact below was measured read-only against the live database on
2026-08-20. Counts are all-org unless a row says otherwise; the seeded E2E org
holds 595 of the 685.

WHAT COUNTS AS A SALE, AND THE FOUR GUARDS THAT DECIDE IT
─────────────────────────────────────────────────────────
685 documents pass all four. Each guard is stated because dropping any one of
them changes the total, and three of them exclude nothing TODAY — which is
exactly why they must be written now rather than after the first row appears.

1. `is_active = TRUE` — soft delete. The ganit house guard.

2. `doc_status <> 'draft'`, NEVER `= 'final'`. The live values are
   final / viewed / sent / draft, and `doc_status` DEFAULTS to 'final', so it
   never meant "locked" anyway. An equality test on 'final' silently drops the
   155 issued documents sitting at 'viewed' or 'sent' — 22.6% of the register.

3. `invoice_type NOT IN ('proforma', 'quotation')`. The CHECK constraint
   admits five types: tax_invoice, credit_note, debit_note, proforma,
   quotation. A proforma and a quotation are OFFERS — nothing was sold and no
   tax became payable — and a register that includes them overstates turnover
   with documents the firm may never issue. Live count today: 0. The day the
   quoting screen writes its first row through this table, this line is what
   stops it landing in the sales book.

4. NOT CANCELLED — `cancelled_at IS NULL` and `payment_status <> 'cancelled'`.
   Two columns record the same event and neither is authoritative on its own
   (`cancelled_at`/`cancel_reason` are the audit pair; 'cancelled' is one of
   the five payment_status values the CHECK admits). Live: 0 rows carry
   either, and 0 rows carry one without the other — so the pair is measured
   consistent and both are tested, because a cancelled document that reaches a
   sales register is turnover the firm did not have.

CREDIT NOTES ARE SIGNED, NOT DROPPED AND NOT ADDED
──────────────────────────────────────────────────
22 of the 685 are credit notes, and they are stored with POSITIVE totals. A
register that sums them as issued ADDS reversals to turnover; one that omits
them prints a turnover the ledger cannot reconcile to. `ganit.invoiced`
already resolved this with a CASE that negates them, and this file negates the
same set of columns, so the register's footer and the dashboard's figure move
together. Debit notes are NOT negated: a debit note increases what the
customer owes, the same direction as an invoice (live count: 0).

THE TAXABLE VALUE IS `subtotal - discount`, AND IT TIES
───────────────────────────────────────────────────────
Verified on all 685: `subtotal - discount + cgst + sgst + igst + cess` equals
`total` on every row, 0 mismatches beyond a rupee. So the register's own
columns add up across, which is the check a reader performs first. 678 of the
685 carry a non-zero tax split; the other 7 print honest zeroes.

THE PARTY IS A NAME, RESOLVED THE WAY THE INVOICE ITSELF RESOLVES IT
────────────────────────────────────────────────────────────────────
`client_id` is NULL on 189 of the 685 — a party column blank on 27% of a
register is not a register. The invoice DOCUMENT
(`services/invoice_pdf.py:256`) already prints the contact's name and company
when there is no client, so this file resolves the same three-step chain the
firm's own paper does: client name → contact company → contact name →
"Unlinked party". Live fill: 496 / 108 / 72 / 9. Nine documents in the whole
database name nobody, and they fold into one honest row rather than vanishing
or printing a UUID (decision_names_not_ids).

Neither CRM join filters `is_active`: a client archived last month was still
the party on last year's invoice, and re-writing history to "Unlinked" because
a CRM row was tidied is a register that changes when nothing changed.

Both joins carry `AND x.org_id = i.org_id`. Joining on `id` alone is a latent
cross-tenant leak — a client id from another org resolves and prints that
org's customer name onto this org's page. `receivables_ageing.py` carried
exactly that shape until it was scoped on 2026-08-20; there is now no join in
this package without an org predicate, and there must not be one again —
`ganit_invoices.client_id` has a plain FK to `graha_clients(id)` with no
composite `(id, org_id)` constraint, so the SCHEMA cannot refuse a foreign
company id and only the predicate can.

WHAT THIS REGISTER IS NOT
─────────────────────────
It is not a return, an annexure or any statutory filing, and it names no form
number, no section and no due date — `services/statute.py` is the only source
of those, and a commercial register needs none of them. It is also not
rate-wise or HSN-wise: `place_of_supply` is recorded inconsistently (253 rows
hold the state CODE '27', 76 hold the NAME 'Gujarat', 52 hold nothing at all),
so the column prints what was recorded and nothing here normalises it.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import (
    ROW_CAP, capped, finish, money, window_or_raise)

KEY = "ganit.sales_register"

#: The party column's header. "Party", not "Client": the CRM client is the
#: COMPANY — the customer that stays — and on 180 of the 685 issued documents
#: there is no client, only the person the invoice was addressed to. Calling
#: the column Client would make those rows read as clients they are not.
PARTY_COLUMN = "Party"

#: Where the footer's label sits. Never the Date column: "Total" written into
#: a date column is not a date any spreadsheet will parse.
LABEL_COLUMN = "Document"

#: What a document that names nobody is called. 9 live rows.
UNLINKED = "Unlinked party"

#: The footer.
TOTAL_ROW = "All documents"

#: Human names for `invoice_type`. The raw value is a database enum
#: (`credit_note`) and this page is handed to people. Unknown values fall back
#: to a de-underscored title, so a sixth type added to the CHECK prints
#: readably on day one instead of waiting for this map to be updated.
TYPE_LABELS: dict[str, str] = {
    "tax_invoice": "Tax invoice",
    "credit_note": "Credit note",
    "debit_note": "Debit note",
}

#: The types that REVERSE a sale, and are therefore negated. Only credit
#: notes: a debit note moves the same way an invoice does.
NEGATED_TYPES = frozenset({"credit_note"})

#: The types that are OFFERS, not sales — excluded entirely (see the module
#: docstring, guard 3). Bound as an array parameter, never interpolated.
OFFER_TYPES = ("proforma", "quotation")

#: The money columns, in print order. The footer sums exactly these.
MONEY_COLUMNS = ("Taxable value", "CGST", "SGST", "IGST", "Cess", "Total")

#: One issued document per row. The bucketing, the signing and the footer
#: happen in Python against `build_rows`, so this query has no CASE ladder
#: that could drift from `ganit.invoiced`'s.
DOCUMENTS_SQL = (
    "SELECT i.invoice_date AS doc_date, "
    "       i.invoice_number AS doc_number, "
    "       i.invoice_type AS doc_type, "
    "       COALESCE(NULLIF(TRIM(cl.name), ''), "
    "                NULLIF(TRIM(ct.company), ''), "
    "                NULLIF(TRIM(ct.name), ''), "
    "                $4::text) AS party, "
    "       i.place_of_supply AS place_of_supply, "
    "       (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0))::float AS taxable, "
    "       COALESCE(i.cgst, 0)::float AS cgst, "
    "       COALESCE(i.sgst, 0)::float AS sgst, "
    "       COALESCE(i.igst, 0)::float AS igst, "
    "       COALESCE(i.cess, 0)::float AS cess, "
    "       COALESCE(i.total, 0)::float AS total "
    "  FROM staging.ganit_invoices i "
    # LEFT, both of them, and both org-scoped on the JOIN: an INNER join drops
    # the 189 documents with no client, and a join on `id` alone can surface
    # another org's customer name (graha_clients_join_leak).
    "  LEFT JOIN staging.graha_clients cl "
    "         ON cl.id = i.client_id AND cl.org_id = i.org_id "
    "  LEFT JOIN staging.graha_contacts ct "
    "         ON ct.id = i.contact_id AND ct.org_id = i.org_id "
    " WHERE i.org_id = $1::uuid "
    "   AND i.is_active = TRUE "
    "   AND i.doc_status <> 'draft' "
    "   AND i.cancelled_at IS NULL "
    "   AND i.payment_status <> 'cancelled' "
    "   AND NOT (i.invoice_type = ANY($5::text[])) "
    "   AND i.invoice_date BETWEEN $2::date AND $3::date "
    # Chronological, then by number: a register is read down the page in the
    # order the documents were issued.
    " ORDER BY i.invoice_date, i.invoice_number "
    # ROW_CAP + 1, so the overflow is known without a second COUNT.
    " LIMIT $6::int"
)


def type_label(raw) -> str:
    """`credit_note` → `Credit note`, and an unmapped type still reads."""
    raw = str(raw or "").strip()
    return TYPE_LABELS.get(raw, raw.replace("_", " ").capitalize() or "Document")


def build_rows(documents: list, dropped: int = 0) -> list:
    """The table. Pure, so the signing and the footer are testable without a
    database — the reconciliation is the whole value of this document."""
    rows = []
    for d in documents:
        # -1 for a reversal, +1 for everything else. Applied to every money
        # column together: negating the total but not the tax split is how a
        # register's rows stop adding up across.
        sign = -1.0 if str(d.get("doc_type") or "") in NEGATED_TYPES else 1.0
        rows.append({
            "Date": d.get("doc_date"),
            LABEL_COLUMN: str(d.get("doc_number") or ""),
            "Type": type_label(d.get("doc_type")),
            PARTY_COLUMN: str(d.get("party") or UNLINKED),
            # As recorded. 52 live rows hold nothing, and the column prints
            # blank rather than guessing a state from an address.
            "Place of supply": str(d.get("place_of_supply") or "").strip(),
            "Taxable value": money(sign * (d.get("taxable") or 0.0)),
            "CGST": money(sign * (d.get("cgst") or 0.0)),
            "SGST": money(sign * (d.get("sgst") or 0.0)),
            "IGST": money(sign * (d.get("igst") or 0.0)),
            "Cess": money(sign * (d.get("cess") or 0.0)),
            "Total": money(sign * (d.get("total") or 0.0)),
        })
    return finish(rows, LABEL_COLUMN, TOTAL_ROW, MONEY_COLUMNS, dropped)


@report_def(
    key=KEY,
    module="ganit",
    label="Sales register",
    grain="flow",
    # The party's NAME is what ganit's own invoice document already prints
    # (services/invoice_pdf.py) and what `/ganit/collections` already serves
    # under the ganit grant — the same reasoning `receivables_ageing` states
    # for its client join. No other CRM field is read. Reading one (a contact
    # email, a pipeline stage, a territory) means adding 'graha' to this set
    # in the SAME commit, or the join is an entitlement bypass wearing a
    # report's clothes.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description="Every document issued in the period — invoices and credit "
                "notes — one row each, with the party, the taxable value and "
                "the CGST / SGST / IGST / cess split. Credit notes carry a "
                "negative sign, drafts, cancellations, proformas and "
                "quotations are excluded, and the columns add across to the "
                "Total. Place of supply prints exactly as it was recorded, "
                "which is a mix of state codes and state names and is blank "
                "on some documents. This is the firm's own commercial "
                "register, not a return or an annexure.",
)
async def sales_register(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, KEY)
    rows = await pool.fetch(DOCUMENTS_SQL, str(org_id), win.start, win.end,
                            UNLINKED, list(OFFER_TYPES), ROW_CAP + 1)
    docs, dropped = capped([dict(r) for r in rows])
    return build_rows(docs, dropped)
