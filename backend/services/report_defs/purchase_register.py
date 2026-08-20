"""Purchase register — one row per vendor bill received.

The sales register's mirror, and the second book a firm opens. There is no
Dristi metric for purchases at all today, so this is the only place in the
product where the period's inward side can be read line by line.

Measured read-only against the live database on 2026-08-20. All-org counts;
the seeded E2E org holds 166 of the 189.

189 BILLS, AND EVERY ONE OF THEM RECONCILES
───────────────────────────────────────────
`subtotal + cgst + sgst + igst + cess` equals `total` on all 189 rows, 0
mismatches beyond a rupee, and all 189 carry a non-zero tax split. So the
register's own columns add across, which is the first check a reader makes.
`bill_number` and `bill_date` are filled on all 189 — there is no "undated
bill" row to design around — and `vendor_id` resolves on all 189, with 0 rows
lost when the join is org-scoped.

THE GSTIN COLUMN IS PARTLY BLANK, AND THE DESCRIPTION SAYS SO
─────────────────────────────────────────────────────────────
Only 51 of the 80 vendors carry a GSTIN, which leaves 16 of the 189 bills with
an empty GSTIN cell. That is not a defect to hide: GSTIN, PAN and TAN are
NON-MANDATORY in this product and block nothing (a settled product rule that
has drifted back more than once), so an unregistered vendor is a real vendor
and a blank cell is the true answer. Dropping the column would make the
register useless to the 51; dropping the rows would make it a lie. It prints
blank, and the section's description warns the reader before they open it.

THE GUARDS
──────────
· `is_active = TRUE` — soft delete, the ganit house guard.
· `status <> 'cancelled'` — the CHECK admits unpaid / partially_paid / paid /
  cancelled. A cancelled bill is not a purchase. Live: 0 rows, and the line is
  written now for the same reason the sales register writes its offer guard —
  the first cancelled bill must not land in the book.
· `bill_date BETWEEN` the window. The bill's own date, not the date it was
  entered: a register keyed on entry date reports March's purchases in
  whichever month somebody got round to typing them.

WHAT IS NOT HERE, AND WHY
─────────────────────────
· No reverse-charge column. `is_reverse_charge` exists and is FALSE on all 189
  live rows, so a column of 189 identical "No" cells would be noise. It is
  named here rather than silently ignored: the day reverse-charge bills exist,
  this register does not distinguish them and must gain a column.
· No form number, section or due date. This is the firm's own commercial
  register, not a return. `services/statute.py` is the only source of a
  statutory fact and this file asks it for nothing, because it needs nothing.
· The vendor join carries `AND v.org_id = b.org_id`. Joining on `id` alone is
  the latent cross-tenant leak this repo already found once in the CRM joins;
  it is not repeated here.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import (
    ROW_CAP, capped, finish, money, window_or_raise)

KEY = "ganit.purchase_register"

#: Where the footer's label sits — the bill number column, never the date.
LABEL_COLUMN = "Bill"

#: The footer.
TOTAL_ROW = "All bills"

#: What a bill whose vendor row has gone is called. 0 live rows: `vendor_id`
#: resolves on all 189 even with the org predicate applied. The label exists
#: so a future orphan prints a word instead of an empty cell or a UUID.
UNKNOWN_VENDOR = "Unknown vendor"

#: Human names for `status`. Unknown values fall back to a de-underscored
#: title so a value added to the CHECK still reads on day one.
STATUS_LABELS: dict[str, str] = {
    "unpaid": "Unpaid",
    "partially_paid": "Part paid",
    "paid": "Paid",
}

#: Excluded entirely — a cancelled bill is not a purchase. Bound, never
#: interpolated.
CANCELLED_STATUS = "cancelled"

#: The money columns, in print order. The footer sums exactly these.
MONEY_COLUMNS = ("Taxable value", "CGST", "SGST", "IGST", "Cess", "Total")

BILLS_SQL = (
    "SELECT b.bill_date AS bill_date, "
    "       b.bill_number AS bill_number, "
    "       COALESCE(NULLIF(TRIM(v.name), ''), $4::text) AS vendor, "
    "       v.gstin AS vendor_gstin, "
    "       b.status AS status, "
    "       COALESCE(b.subtotal, 0)::float AS taxable, "
    "       COALESCE(b.cgst, 0)::float AS cgst, "
    "       COALESCE(b.sgst, 0)::float AS sgst, "
    "       COALESCE(b.igst, 0)::float AS igst, "
    "       COALESCE(b.cess, 0)::float AS cess, "
    "       COALESCE(b.total, 0)::float AS total "
    "  FROM staging.ganit_vendor_bills b "
    # LEFT and org-scoped: a bill whose vendor row was deleted is still a
    # purchase, and a join on `id` alone can print another org's vendor name.
    "  LEFT JOIN staging.ganit_vendors v "
    "         ON v.id = b.vendor_id AND v.org_id = b.org_id "
    " WHERE b.org_id = $1::uuid "
    "   AND b.is_active = TRUE "
    "   AND b.status <> $5::text "
    "   AND b.bill_date BETWEEN $2::date AND $3::date "
    " ORDER BY b.bill_date, b.bill_number "
    " LIMIT $6::int"
)


def status_label(raw) -> str:
    raw = str(raw or "").strip()
    return STATUS_LABELS.get(raw, raw.replace("_", " ").capitalize() or "")


def build_rows(bills: list, dropped: int = 0) -> list:
    """The table. Pure, so the footer's reconciliation is testable without a
    database."""
    rows = [{
        "Date": b.get("bill_date"),
        LABEL_COLUMN: str(b.get("bill_number") or ""),
        "Vendor": str(b.get("vendor") or UNKNOWN_VENDOR),
        # Blank on 16 of 189 live bills and that is the true answer — GSTIN is
        # non-mandatory in this product and blocks nothing.
        "Vendor GSTIN": str(b.get("vendor_gstin") or "").strip(),
        "Status": status_label(b.get("status")),
        "Taxable value": money(b.get("taxable")),
        "CGST": money(b.get("cgst")),
        "SGST": money(b.get("sgst")),
        "IGST": money(b.get("igst")),
        "Cess": money(b.get("cess")),
        "Total": money(b.get("total")),
    } for b in bills]
    return finish(rows, LABEL_COLUMN, TOTAL_ROW, MONEY_COLUMNS, dropped)


@report_def(
    key=KEY,
    module="ganit",
    label="Purchase register",
    grain="flow",
    # Vendors are a ganit table (`staging.ganit_vendors`). Nothing outside
    # ganit is read, so nothing outside ganit is demanded.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description="Every vendor bill dated in the period, one row each, with "
                "the vendor, their GSTIN, the taxable value and the CGST / "
                "SGST / IGST / cess split. The GSTIN column is BLANK for "
                "unregistered vendors — GSTIN is not mandatory here and 29 of "
                "the 80 vendors on file carry none — so treat an empty cell "
                "as 'not registered', not as missing data. Cancelled bills "
                "are excluded and reverse-charge bills are not yet "
                "distinguished.",
)
async def purchase_register(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, KEY)
    rows = await pool.fetch(BILLS_SQL, str(org_id), win.start, win.end,
                            UNKNOWN_VENDOR, CANCELLED_STATUS, ROW_CAP + 1)
    bills, dropped = capped([dict(r) for r in rows])
    return build_rows(bills, dropped)
