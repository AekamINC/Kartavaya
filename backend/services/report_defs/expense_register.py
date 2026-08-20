"""Expense register by category — what the firm spent, grouped by the label
somebody typed on it.

The fifth book. Vendor bills (`purchase_register`) are the formal inward side;
this is everything else — rent, travel, marketing, the software subscription
somebody expensed — and no metric or screen in the product lists it line by
line.

Measured read-only against the live database on 2026-08-20. All-org counts;
the seeded E2E org holds 319 of the 378.

378 ROWS, AND EVERY ONE OF THEM RECONCILES
──────────────────────────────────────────
`amount + tax_amount` equals `total` on all 378, 0 mismatches beyond a rupee,
so the register's columns add across. 367 of the 378 carry a non-zero tax
amount; the other 11 print an honest zero. Every row has a title and every row
has a category — there is no "Uncategorised" bucket to design around today,
and the fallback label below exists only so the first blank one prints a word.

`category` IS FREE TEXT WITH NO FOREIGN KEY — AND IT IS NOT JOINED
──────────────────────────────────────────────────────────────────
`staging.ganit_expense_categories` exists (47 rows) and looks exactly like the
table this column should point at. It does not. `ganit_expenses.category` is
plain text with no FK, and the two DISAGREE on the live data: of the 14
distinct category strings in use, 12 match a category row by name and 2 do not
("Miscellaneous" and "general" are the shape of the mismatch — one typed by
hand, one a default). An INNER join to the master would silently drop those
rows and understate spend; a LEFT join would add a column that is NULL for
them and invite the reader to think the row is broken. Neither is worth
anything, so this register never touches that table: it prints the string that
was recorded, exactly as recorded, and the description says so.

That also means the "by category" in the title is an ORDERING, not a
grouping key resolved against a master list. Rows are ordered by category,
then date, then title, so each category's spend reads as a block a person can
run their eye down and subtotal by hand.

`vendor` IS ALSO FREE TEXT, AND `vendor_id` IS EMPTY
────────────────────────────────────────────────────
`ganit_expenses.vendor_id` is NULL on all 378 rows — the column exists and
nothing populates it — so there is nothing to join to `ganit_vendors` and no
vendor GSTIN to print here. `ganit_expenses.vendor` (text) is filled on 341 of
the 378 and is what gets printed. Named rather than passed over in silence,
because `vendor_id` is exactly the column a future reader would reach for.

`tds_amount` IS ZERO ON ALL 378 ROWS
────────────────────────────────────
So there is no TDS column. It is named for the same reason: the column exists,
it is empty, and a column of 378 zeroes would read as "no tax was deducted"
rather than "nothing has ever been recorded here". If it ever fills, this
register gains a column — and the SECTION and RATE that go with it come from
`services/statute.py`, never from a literal in this file.

THE GUARDS
──────────
· `is_active = TRUE` — soft delete; all 378 live rows pass it.
· `expense_date BETWEEN` the window — the date the money was spent, not the
  date somebody typed it in.
· No cancellation guard: `ganit_expenses` has no cancelled/status column at
  all. Named so its absence is a measured fact rather than an oversight.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import (
    ROW_CAP, capped, finish, money, window_or_raise)

KEY = "ganit.expense_register_by_category"

#: Where the footer's label sits — the category column, never the date.
LABEL_COLUMN = "Category"

#: The footer.
TOTAL_ROW = "All expenses"

#: What an expense with no category typed on it is called. 0 live rows; the
#: label exists so the first blank one prints a word rather than an empty
#: cell that sorts to the top of the page and explains nothing.
UNCATEGORISED = "Uncategorised"

#: The money columns, in print order. The footer sums exactly these.
MONEY_COLUMNS = ("Amount", "Tax", "Total")

EXPENSES_SQL = (
    "SELECT e.expense_date AS spent_on, "
    # As recorded. `staging.ganit_expense_categories` is NOT joined — there is
    # no FK and the two disagree on live data (see the module docstring).
    "       COALESCE(NULLIF(TRIM(e.category), ''), $4::text) AS category, "
    "       e.title AS title, "
    "       e.vendor AS vendor, "
    "       COALESCE(e.amount, 0)::float AS amount, "
    "       COALESCE(e.tax_amount, 0)::float AS tax_amount, "
    "       COALESCE(e.total, 0)::float AS total "
    "  FROM staging.ganit_expenses e "
    " WHERE e.org_id = $1::uuid "
    "   AND e.is_active = TRUE "
    "   AND e.expense_date BETWEEN $2::date AND $3::date "
    # By category, then chronologically inside it: each category reads as one
    # block a person can subtotal by eye. The order is also what makes the
    # LIMIT below deterministic rather than an arbitrary cut.
    " ORDER BY category, e.expense_date, e.title "
    " LIMIT $5::int"
)


def build_rows(expenses: list, dropped: int = 0) -> list:
    """The table. Pure, so the footer is testable without a database."""
    rows = [{
        LABEL_COLUMN: str(e.get("category") or UNCATEGORISED),
        "Date": e.get("spent_on"),
        "Expense": str(e.get("title") or ""),
        # Free text, filled on 341 of 378. Blank is the true answer for the
        # rest — there is no vendor record to fall back to (`vendor_id` is
        # NULL on every row).
        "Vendor": str(e.get("vendor") or "").strip(),
        "Amount": money(e.get("amount")),
        "Tax": money(e.get("tax_amount")),
        "Total": money(e.get("total")),
    } for e in expenses]
    return finish(rows, LABEL_COLUMN, TOTAL_ROW, MONEY_COLUMNS, dropped)


@report_def(
    key=KEY,
    module="ganit",
    label="Expense register by category",
    grain="flow",
    # `ganit_expenses` is a ganit table and nothing else is read — in
    # particular `ganit_expense_categories` is deliberately NOT joined.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description="Every expense dated in the period, one row each, ordered by "
                "category so each category reads as a block. The category is "
                "FREE TEXT typed on the expense — it is printed exactly as "
                "recorded and is never matched against the category list, "
                "because the two disagree on real data and a join would "
                "silently drop the rows that do not match. Vendor is free "
                "text too, and blank where none was entered.",
)
async def expense_register_by_category(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, KEY)
    rows = await pool.fetch(EXPENSES_SQL, str(org_id), win.start, win.end,
                            UNCATEGORISED, ROW_CAP + 1)
    expenses, dropped = capped([dict(r) for r in rows])
    return build_rows(expenses, dropped)
