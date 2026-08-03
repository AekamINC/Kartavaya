"""The last two routes that could mint a tax invoice nobody could issue.

Four of the six creation paths were gated on 2026-08-03 (d026d82f). These are
the other two, and each turned out to carry a defect the gate itself would not
have caught.

`vikray.generate_invoice_from_order` — TWO bugs, one symptom
------------------------------------------------------------
The owner reported "I created an invoice from an order and I cannot edit it".
The first cause was `ganit_invoices.doc_status` DEFAULT 'final', fixed earlier.
The second is here and is independent: this INSERT never wrote `balance_due`,
and the column DEFAULTS to 0. Every invoice generated from an order was
therefore born reading as FULLY PAID against a positive total —

  · invisible in receivables and ageing, so the firm could not see it was owed;
  · nothing for a payment to reduce;
  · and uneditable, because editing is bounded by payment.

An unpaid invoice must show its full total as outstanding. That is asserted on
the SQL this route executes, because it is the kind of omission that reads as
fine and is only visible in the money.

`ganit.create_invoice_from_time_entries` — a draft, deliberately
----------------------------------------------------------------
This route ASSEMBLES an invoice from hours worked rather than being handed one,
and two Rule 46 fields are not in a timesheet: the SAC for the service and,
often, the customer. Gating it would refuse every call; defaulting the SAC would
put a guessed tax code on a filed return. It writes a draft instead — nothing
invented, no serial spent on a lie, and the existing draft-to-final gate catches
the gaps when the firm actually issues the document.
"""
import inspect
import re

import routers.ganit as ganit
import routers.vikray as vikray


def _sql(fn) -> str:
    """The SQL text a route executes, with whitespace flattened."""
    return re.sub(r"\s+", " ", inspect.getsource(fn))


# ── vikray: the invisible receivable ──────────────────────────────────────────

def test_an_order_invoice_records_what_is_still_owed():
    sql = _sql(vikray.generate_invoice_from_order)
    assert "balance_due" in sql, \
        "balance_due DEFAULTs to 0 — an omitted column makes the invoice read as paid"
    # $11 is `total`, and balance_due is set from the same placeholder: the whole
    # amount is outstanding until a payment is recorded against it.
    assert "total, balance_due" in sql
    assert "$11, $11" in sql


def test_an_order_invoice_is_checked_before_the_serial_is_drawn():
    """A refusal after `next_doc_number` leaves a permanent gap in the invoice
    sequence, which is the thing a tax auditor asks about."""
    src = inspect.getsource(vikray.generate_invoice_from_order)
    gate = src.index("_refuse_final_if_incomplete")
    serial = src.index("next_doc_number(")
    assert gate < serial, "the Rule 46 check must run before a serial is spent"


def test_the_order_invoice_gate_is_the_same_one_the_other_routes_use():
    """Not a second implementation that can drift from the first."""
    assert "from routers.ganit import _refuse_final_if_incomplete" in \
        inspect.getsource(vikray.generate_invoice_from_order)


# ── ganit: the timesheet draft ────────────────────────────────────────────────

def test_a_timesheet_invoice_is_born_a_draft():
    sql = _sql(ganit.create_invoice_from_time_entries)
    assert "doc_status" in sql, \
        "without an explicit doc_status this rides DEFAULT 'final' and mints an un-issuable invoice"
    assert "'draft'" in sql


def test_the_sac_is_accepted_and_never_invented():
    """A guessed SAC ends up on a filed GST return."""
    fields = ganit.TimesheetInvoiceCreate.model_fields
    assert "sac_code" in fields
    assert fields["sac_code"].default == "", "no default code — the firm supplies it or it stays blank"

    src = inspect.getsource(ganit.create_invoice_from_time_entries)
    assert "hsn_code=body.sac_code" in src, "the supplied code must reach the line"
    assert "9983" not in src, "no hardcoded SAC anywhere on this path"


def test_the_timesheet_route_does_not_pretend_to_gate():
    """It writes a draft instead. If someone later adds the gate here without
    also solving the missing SAC, every call starts failing — this test is the
    note explaining why that would be wrong."""
    src = inspect.getsource(ganit.create_invoice_from_time_entries)
    assert "_refuse_final_if_incomplete" not in src


def test_every_tax_invoice_route_now_accounts_for_final():
    """The whole point of the sweep: no route may reach the DEFAULT by accident.

    Each of the six either runs the Rule 46 gate or writes an explicit
    doc_status. A new route that does neither fails here.
    """
    routes = [
        ganit.create_invoice,
        ganit.update_invoice_status,
        ganit.convert_to_invoice,
        ganit.create_invoice_from_time_entries,
        vikray.generate_invoice_from_order,
    ]
    for fn in routes:
        src = inspect.getsource(fn)
        assert "_refuse_final_if_incomplete" in src or "doc_status" in src, \
            f"{fn.__name__} can mint a 'final' tax invoice with no check at all"
