"""GST is charged on the value NET of a recorded discount — s.15(3)(a) CGST Act.

── The defect, found 2026-08-30 by a LIVE QUERY and by no test ────────────────

`_compute_order_totals` applied the per-line `discount_pct` before tax, but took
the flat ORDER-level discount off only at the end:

    total_tax += round(line_total * gst, 2)          # tax on the GROSS
    total = round(subtotal + total_tax - discount, 2) # discount applied after

Measured on two live rows in `public.vikray_orders`:

    SO-2026-0007   subtotal 30000   discount 5000   tax 5400   correct 4500
    SO-2026-0014                                    tax 2175   correct 1925

Excess output tax of ₹900 and ₹250 — money over-collected and over-remitted.

⚠ **SUITE 10 PASSED WHILE THIS WAS WRONG.** Nothing anywhere asserted the tax
BASE; the suite checked that totals were internally consistent, and they were —
consistently computed on the wrong value. That is why this file asserts the tax
figure against a hand-computed expectation rather than against the function's
own other outputs, which is the only way an arithmetic error of this shape can
be caught.

── The law ────────────────────────────────────────────────────────────────────

s.15(3)(a) CGST Act: the value of a supply "shall not include any discount which
is given before or at the time of the supply if such discount has been duly
recorded in the invoice issued in respect of such supply."

This discount IS recorded on the invoice — `OrderDetail` prints it and
`generate_invoice_from_order` copies it onto the tax invoice — so it reduces the
transaction value and tax is charged on the net.

── Why it is apportioned rather than deducted in one lump ─────────────────────

Lines may carry different `gst_rate`s. A single blended deduction moves value
between rate buckets and misstates the CGST/SGST/IGST split even when the total
happens to come out right — and the split is what a GSTR-1 return is filed on.
"""
import pytest

from routers.vikray import _compute_order_totals


def tax_of(items, discount, is_igst=False):
    _st, cgst, sgst, igst, _t = _compute_order_totals(items, discount, is_igst)
    return round(cgst + sgst + igst, 2)


ONE_LINE_18 = [{"quantity": 1, "rate": 30000, "gst_rate": 18}]


def test_the_live_row_that_found_this():
    """SO-2026-0007: 30000 gross, 5000 discount. Tax is 18% of 25000."""
    assert tax_of(ONE_LINE_18, 5000) == 4500.0, (
        "GST is being charged on the pre-discount value. s.15(3)(a) CGST Act "
        "excludes an invoice-recorded discount from the transaction value."
    )


def test_an_undiscounted_order_is_completely_unchanged():
    """The regression guard. Most orders carry no discount and must not move."""
    assert tax_of(ONE_LINE_18, 0) == 5400.0


def test_subtotal_stays_gross_and_the_totals_identity_holds():
    """`subtotal` is GROSS — every Ganit reader treats the column that way, and
    the totals block prints `subtotal + tax − discount = total`. Only the TAX
    figure moves, and only downwards."""
    subtotal, cgst, sgst, igst, total = _compute_order_totals(ONE_LINE_18, 5000, False)
    assert subtotal == 30000.0, "subtotal must remain GROSS"
    assert round(subtotal + cgst + sgst + igst - 5000, 2) == total


def test_a_flat_discount_is_apportioned_across_DIFFERENT_gst_rates():
    """The reason it is pro-rata and not a lump.

    10000 @ 18% + 10000 @ 5%, less 4000: each line nets to 8000, giving
    1440 + 400 = 1840. Deducting the 4000 from one bucket would total
    differently AND file the wrong split.
    """
    items = [{"quantity": 1, "rate": 10000, "gst_rate": 18},
             {"quantity": 1, "rate": 10000, "gst_rate": 5}]
    assert tax_of(items, 4000) == 1840.0


def test_the_cgst_sgst_split_still_halves_the_reduced_tax():
    subtotal, cgst, sgst, igst, _t = _compute_order_totals(ONE_LINE_18, 5000, False)
    assert igst == 0
    assert round(cgst + sgst, 2) == 4500.0
    assert abs(cgst - sgst) <= 0.01, "the split must stay even to the paisa"


def test_igst_is_taxed_on_the_same_reduced_value():
    """An inter-state supply values the discount identically — one Act."""
    _st, cgst, sgst, igst, _t = _compute_order_totals(ONE_LINE_18, 5000, True)
    assert (cgst, sgst) == (0, 0)
    assert igst == 4500.0


def test_a_per_line_discount_still_reduces_the_base_as_it_always_did():
    """This half was already correct and must not regress."""
    items = [{"quantity": 1, "rate": 10000, "gst_rate": 18, "discount_pct": 10}]
    assert tax_of(items, 0) == 1620.0        # 18% of 9000


def test_both_discounts_compose():
    """A line discount and an order discount on the same order.

    10000 less 10% = 9000 gross; less a 900 order discount = 8100 taxable;
    18% = 1458.
    """
    items = [{"quantity": 1, "rate": 10000, "gst_rate": 18, "discount_pct": 10}]
    assert tax_of(items, 900) == 1458.0


@pytest.mark.parametrize("discount", [99999, 30000])
def test_a_discount_at_or_beyond_the_order_value_never_taxes_negatively(discount):
    """A data-entry mistake must not mint a NEGATIVE taxable value, which would
    be a credit to the exchequer nobody intended."""
    assert tax_of(ONE_LINE_18, discount) == 0.0


def test_a_zero_value_order_does_not_divide_by_zero():
    assert tax_of([{"quantity": 1, "rate": 0, "gst_rate": 18}], 0) == 0.0
