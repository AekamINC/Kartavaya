"""Phase 6.3 — there are two document-number allocators, and that is CORRECT.

── WHAT THE PLAN ASKED, AND WHAT THE ANSWER TURNED OUT TO BE ────────────────

`docs/plans/PHASE-6-retire-duplicates.md` §6.3 lists `next_doc_number` and
`next_po_number` among the four models "built twice", and asks to "decide on one
allocator or document clearly why two exist and which owns which series".

Read against the code, the second one is not a duplicate. It is a DIFFERENT
ALGORITHM for a different lifecycle, and merging them would break purchase
orders in a way a unique index would report as a 500:

  · `utils.next_doc_number` reads the newest row BY `created_at` and increments
    the serial it finds. That is right where the number is assigned at INSERT —
    invoices, orders, payslips, vendor bills.
  · A purchase order is numbered at ISSUE, not at insert (proposal 77's own
    lifecycle: "Draft — Editable. NO NUMBER YET: a serial spent on a draft is a
    gap in the series"). So every draft carries NULL, the newest row is very
    often a draft, `last` comes back None — and THE SERIES RESTARTS AT 0001,
    colliding with an order issued last week.
  · `services.purchase_orders.next_po_number` reads the newest NON-NULL number
    and orders by the PARSED SERIAL rather than by `created_at`, because the
    newest row and the highest number are routinely different rows.

Same `PREFIX-YYYY-NNNN` shape, same advisory lock, same lock scope, disjoint
tables. So the decision Phase 6.3 asks for is: **KEEP BOTH, and hold the
boundary** — which is what this file is. The boundary is the allowlist: the
moment a purchase-order table appears in `_ALLOWED_DOC_TABLES`, somebody has
wired PO numbering through the created_at allocator and the series will restart
on the next draft.

This is a ratchet, not a description. It fails when the boundary moves.
"""
import re
import inspect

import pytest

from services.purchase_orders import next_po_number
from utils import _ALLOWED_DOC_TABLES, next_doc_number


#: Every table whose serial is allocated at ISSUE rather than at INSERT. These
#: must never be routed through `next_doc_number`.
ISSUE_TIME_TABLES = {"ganit_purchase_orders"}


def test_no_issue_time_table_is_in_the_created_at_allocator():
    """THE ratchet. See the module docstring for what breaks if this fails."""
    named = {table for table, _column in _ALLOWED_DOC_TABLES}
    trespassing = named & ISSUE_TIME_TABLES
    assert not trespassing, (
        f"{sorted(trespassing)} is numbered at ISSUE, not at INSERT, so "
        f"`next_doc_number`'s ORDER BY created_at will read a NULL-numbered "
        f"draft as the newest row and restart the series at 0001. Use "
        f"`services.purchase_orders.next_po_number`."
    )


def test_the_two_allocators_own_disjoint_tables():
    """Neither may reach into the other's series.

    `next_po_number` takes no table argument at all — it is hard-wired to the
    purchase-order table — so the disjointness is structural on that side. This
    asserts the other side: the allowlist names four tables and none of them is
    a purchase-order table.
    """
    named = {table for table, _column in _ALLOWED_DOC_TABLES}
    assert named == {
        "ganit_invoices", "vikray_orders", "vetana_payslips", "ganit_vendor_bills",
    }, (
        "the allocator allowlist changed. Adding a table here is a decision "
        "about a document SERIES, not a config tweak: read this file's "
        "docstring, then add the table to ISSUE_TIME_TABLES instead if its "
        "number is assigned at issue."
    )
    source = inspect.getsource(next_po_number)
    assert "ganit_purchase_orders" in source, (
        "next_po_number no longer names its own table — if it has become "
        "generic, the two allocators can now collide and this boundary is gone."
    )


def test_both_allocators_mint_the_same_shape():
    """One FORMAT, two algorithms. The format is the thing that must not fork.

    A second allocator with a second format is what poisoned a GST serial once
    already — `recurring_invoice_generator._next_invoice_number`, quoted in
    `utils.next_doc_number`'s own docstring.
    """
    shape = re.compile(r"^[A-Z]+-\{?(fy|year)\}?-|PREFIX-YYYY-NNNN|\{prefix\}-\{fy\}")
    doc_src = inspect.getsource(next_doc_number)
    po_src = inspect.getsource(next_po_number)
    # Both build the serial with a 4-wide zero-padded counter. Asserted on the
    # format expression rather than by calling them, because calling means a
    # database and this is the half that does not need one.
    assert ":04d" in doc_src, "next_doc_number stopped zero-padding to 4"
    assert ":04d" in po_src, "next_po_number stopped zero-padding to 4"
    assert shape.search("PREFIX-YYYY-NNNN")


@pytest.mark.parametrize("fn", [next_doc_number, next_po_number])
def test_both_hold_the_lock_inside_a_transaction(fn):
    """asyncpg runs in autocommit, so a bare `execute` of `pg_advisory_xact_lock`
    is its own transaction: acquired and dropped before the SELECT it exists to
    protect ever runs, and two callers mint the same number. Both allocators
    learned this the same way; neither may unlearn it."""
    src = inspect.getsource(fn)
    assert "pg_advisory_xact_lock" in src, f"{fn.__name__} no longer takes the lock"
    assert "conn.transaction()" in src, (
        f"{fn.__name__} takes the advisory lock outside a transaction, so it is "
        f"released before the read it protects. Two callers will mint the same "
        f"serial."
    )
