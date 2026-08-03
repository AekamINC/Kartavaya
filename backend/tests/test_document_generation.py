"""Generated documents — invoices and payslips.

These are the artefacts that leave the building with a firm's name on them, and
until this file nothing tested them at all. A PDF that renders is not a PDF that
is correct: a tax invoice missing its supplier GSTIN rendered as if complete, and
the amount in words either crashed the render or printed a different number from
the one in the figures column.

Nothing here calls WeasyPrint. `generate_invoice_pdf` is a two-line wrapper —
`_build_html` then `HTML(...).write_pdf()` — so the HTML is where every
correctness question actually lives, and testing it needs no native libraries in
CI. `_embed_logo` is the one function that would reach the network, and it is
only invoked when a logo URL is supplied; none of these fixtures supply one.

No email, push or WhatsApp is involved on any path in this file.
"""

import html as html_mod

import pytest

from services.invoice_pdf import (
    _GSTIN_REQUIRED_TYPES,
    _build_html,
    _org_gstin_line,
    amount_in_words_inr,
)

ORG_WITH_GSTIN = {
    "name": "Sharma & Associates",
    "gstin": "24AAACS1234F1Z5",
    "pan": "AAACS1234F",
    "billing_address": {"line1": "12 MG Road", "city": "Ahmedabad", "state": "Gujarat"},
}

ORG_NO_GSTIN = {**ORG_WITH_GSTIN, "gstin": "", "pan": "AAACS1234F"}
ORG_NO_IDENTITY_AT_ALL = {**ORG_WITH_GSTIN, "gstin": "", "pan": ""}

CONTACT = {"name": "Patel Traders", "gstin": "24AAACP5678Q1Z9"}


def _invoice(**overrides) -> dict:
    base = {
        "invoice_number": "INV-2026-0001",
        "invoice_type": "tax_invoice",
        "currency": "INR",
        "total": 1234.56,
        "subtotal": 1046.24,
        "cgst": 94.16,
        "sgst": 94.16,
        "igst": 0,
        "place_of_supply": "Gujarat",
        "line_items": [
            {"description": "Statutory audit", "hsn_code": "998221",
             "quantity": 1, "rate": 1046.24, "amount": 1046.24},
        ],
    }
    base.update(overrides)
    return base


# ══════════════════════════════════════════════════════════════════════════════
# Amount in words — GST requires it on the face of the invoice
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("amount,expected", [
    (0,          "Rupees Zero Only"),
    (100,        "Rupees One Hundred Only"),
    (100.25,     "Rupees One Hundred and Twenty Five Paise Only"),
    (100.50,     "Rupees One Hundred and Fifty Paise Only"),
    # ── The regression. Every one of these used to be wrong ───────────────────
    # `rupees = int(round(amount))` rounds to NEAREST instead of truncating, so
    # a paise part of half a rupee or more carried into the rupees and left the
    # paise negative.
    (100.75,     "Rupees One Hundred and Seventy Five Paise Only"),
    (1234.56,    "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only"),
    (999.99,     "Rupees Nine Hundred Ninety Nine and Ninety Nine Paise Only"),
    (250000.80,  "Rupees Two Lakh Fifty Thousand and Eighty Paise Only"),
    # Indian numbering, which is the reason this function exists rather than a
    # library: 1,00,00,000 is one crore, not ten million.
    (100000,     "Rupees One Lakh Only"),
    (10000000,   "Rupees One Crore Only"),
    (12345678.90, "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only"),
])
def test_amount_in_words(amount, expected):
    assert amount_in_words_inr(amount) == expected


@pytest.mark.parametrize("paise", range(0, 100))
def test_no_paise_value_crashes_or_borrows(paise):
    """The whole paise range, because the old bug was a sign error that only
    appeared above 50 — a test sampling 0.25 and 0.50 passed while every invoice
    ending in 0.56 raised IndexError inside PDF generation."""
    words = amount_in_words_inr(1000 + paise / 100)
    assert words.startswith("Rupees One Thousand"), words
    assert "Minus" not in words
    if paise:
        assert words.endswith(" Paise Only")
        # The rupees must NOT have been rounded up by the paise.
        assert "One Thousand One " not in words


def test_a_credit_note_may_be_negative_and_says_so():
    """divmod on a negative borrows and reports the complement, so the sign is
    taken off before the split rather than after."""
    assert amount_in_words_inr(-500.25) == "Minus Rupees Five Hundred and Twenty Five Paise Only"


def test_the_words_agree_with_the_figures():
    """The reason the field exists at all is to catch a discrepancy with the
    figures column. A wrong words line is worse than none — it is a second,
    contradicting number on a legal document."""
    invoice = _invoice(total=250000.80)
    doc = _build_html(invoice, ORG_WITH_GSTIN, CONTACT)
    assert "Two Lakh Fifty Thousand and Eighty Paise" in doc
    # And specifically NOT the value the old rounding produced.
    assert "Fifty Thousand One" not in doc


# ══════════════════════════════════════════════════════════════════════════════
# Supplier GSTIN — mandatory on a tax document, absent is a defect not a blank
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("invoice_type", sorted(_GSTIN_REQUIRED_TYPES))
def test_a_tax_document_without_a_supplier_gstin_omits_it_cleanly(invoice_type):
    """Owner's ruling 2026-08-03: "no advisory on invoice pdf ... i want invoice
    to be clean."

    This used to render a red "⚠ GSTIN NOT SET". Registration is not mandatory
    below the turnover threshold, so an absent GSTIN is frequently not a defect
    at all — and printing the warning on a document a CUSTOMER reads advertises
    a gap that may not exist. It is omitted instead: nothing invented, nothing
    shouted. The gap is still reported internally through
    `GET /invoices/{id}` → `document_check`.
    """
    line = _org_gstin_line("", "", invoice_type)
    assert "NOT SET" not in line, invoice_type
    assert "GSTIN" not in line, "an absent GSTIN is omitted, not labelled"


@pytest.mark.parametrize("invoice_type", sorted(_GSTIN_REQUIRED_TYPES))
def test_the_rendered_document_carries_no_warning_markers(invoice_type):
    """Asserted on the whole document, not just the helper — the customer-facing
    artefact is what has to be clean."""
    # A date is supplied because a missing one is a BLOCKING gap — the PDF route
    # refuses such a document outright, so its marker is unreachable in life and
    # only appears here because this builds the HTML directly. What is being
    # asserted is the ADVISORY case: no supplier GSTIN, no PAN, renders clean.
    doc = _build_html(
        _invoice(invoice_type=invoice_type, invoice_date="2026-08-01"),
        ORG_NO_IDENTITY_AT_ALL, CONTACT,
    )
    assert "NOT SET" not in doc
    assert 'class="unset"' not in doc


@pytest.mark.parametrize("invoice_type", ["quotation", "proforma", "estimate", ""])
def test_a_non_tax_document_without_a_gstin_is_not_flagged(invoice_type):
    """The contrast that stops the test above being satisfiable by marking
    everything. A quotation is an offer, not a tax document, and is perfectly
    valid with no GSTIN — flagging it would put a red warning on correct
    paperwork and teach people to ignore the mark."""
    line = _org_gstin_line("", "", invoice_type)
    assert "GSTIN NOT SET" not in line


def test_a_present_gstin_renders_normally_with_pan():
    line = _org_gstin_line("24AAACS1234F1Z5", "AAACS1234F", "tax_invoice")
    assert "24AAACS1234F1Z5" in line
    assert "AAACS1234F" in line
    assert "NOT SET" not in line


def test_pan_still_shows_on_a_tax_document_that_has_no_gstin():
    """Dropping the PAN as a side effect of omitting the GSTIN would be a
    regression of its own — the identity line still carries what DOES exist."""
    line = _org_gstin_line("", "AAACS1234F", "tax_invoice")
    assert "NOT SET" not in line
    assert "AAACS1234F" in line


def test_a_missing_recipient_gstin_is_never_flagged():
    """Deliberately asymmetric. A B2C sale to an unregistered buyer legitimately
    has no recipient GSTIN; flagging it would mark every consumer invoice."""
    doc = _build_html(_invoice(), ORG_WITH_GSTIN, {"name": "Walk-in customer"})
    assert "NOT SET" not in doc


# ══════════════════════════════════════════════════════════════════════════════
# The document is built from data, and the data is escaped
# ══════════════════════════════════════════════════════════════════════════════

def test_the_invoice_carries_its_identifying_fields():
    """A shape test. Without it every assertion above could pass on a template
    that rendered an empty page."""
    doc = _build_html(_invoice(), ORG_WITH_GSTIN, CONTACT)
    for expected in (
        "INV-2026-0001",           # the number
        "Sharma &amp; Associates",  # supplier, escaped
        "24AAACS1234F1Z5",          # supplier GSTIN
        "Patel Traders",            # recipient
        "Statutory audit",          # the line item
        "998221",                   # HSN, which GST requires
    ):
        assert expected in doc, expected


def test_org_and_contact_names_are_escaped():
    """Names are user-supplied and land in an HTML template. `&` in a firm name
    is the common case and must survive as an entity, not break the markup."""
    doc = _build_html(
        _invoice(),
        {**ORG_WITH_GSTIN, "name": '<script>alert(1)</script>'},
        {**CONTACT, "name": 'Patel & Sons "Traders"'},
    )
    assert "<script>alert(1)</script>" not in doc
    assert html_mod.escape("<script>alert(1)</script>") in doc
    assert "Patel &amp; Sons" in doc


def test_an_export_invoice_omits_place_of_supply_and_recipient_gstin():
    """Neither applies to an export, and printing them would be wrong rather
    than merely redundant."""
    doc = _build_html(_invoice(is_export=True), ORG_WITH_GSTIN, CONTACT)
    assert "Place of supply" not in doc
    assert CONTACT["gstin"] not in doc


def test_a_document_with_no_line_items_still_renders():
    """An empty draft must not raise on the way to the screen."""
    doc = _build_html(_invoice(line_items=[], total=0), ORG_WITH_GSTIN, CONTACT)
    assert "INV-2026-0001" in doc
    assert "Rupees Zero Only" in doc


def test_missing_org_and_contact_do_not_raise():
    """`generate_invoice_pdf` passes `org or {}` / `contact or {}`, so the
    template has to tolerate both being empty."""
    doc = _build_html(_invoice(), {}, {})
    assert "INV-2026-0001" in doc


# ══════════════════════════════════════════════════════════════════════════════
# Payslips share the amount-in-words helper
# ══════════════════════════════════════════════════════════════════════════════

def test_payslip_uses_the_same_words_helper_and_no_longer_crashes():
    """`services/payslip_pdf.py` imports `amount_in_words_inr` for net pay, so
    the IndexError above applied to any salary ending in 50 paise or more —
    payroll being the one place a stray half-rupee is entirely routine."""
    from services import payslip_pdf
    assert payslip_pdf.amount_in_words_inr is amount_in_words_inr
    assert amount_in_words_inr(48750.75).endswith("Seventy Five Paise Only")
