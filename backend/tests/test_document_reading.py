"""The documents as the person who RECEIVES them reads them.

`test_document_generation.py` asserts the figures are right and
`test_document_pagination.py` asserts they fit on the sheet. Neither opens the
result and reads it as a client, an employee or a bank does, which is where this
file lives — every defect below was found by rendering the document and looking
at it, and each one produced a document that was arithmetically perfect and
still wrong to hand to somebody.

The assertions are cross-document invariants rather than per-document cases.
Nine generators are maintained separately and drift apart one document at a
time: the tax invoice printed `2026-07-08` for a year while the seven documents
written after it printed `08 Jul 2026`, and no per-document test could have
caught that because each one was self-consistent. A rule asserted over the whole
set catches the tenth document too.

No email, push or WhatsApp is on any path here, and no fixture carries a logo
URL, so `embed_logo` never reaches the network. Addresses follow the reserved
ranges (`simulator.amazonses.com`, `unicodegroup.com`, `+91 99999xxxxx`).
"""

from __future__ import annotations

import re

import pytest

from services import doc_validation as V

# ── fixtures ─────────────────────────────────────────────────────────────────

ORG = {
    "name": "Aekam Inc", "gstin": "27AAACA1234M1Z8", "pan": "AAACA1234M",
    "tan": "MUMA12345B",
    "email": "info+accounts@unicodegroup.com", "phone": "+91 99999 10001",
    "website": "kartavaya.com",
    "billing_address": {"line1": "Unit 402, Meridien Tower", "line2": "Bandra Kurla Complex",
                        "city": "Mumbai", "state": "Maharashtra", "pincode": "400051",
                        "country": "India"},
    "bank_details": {"account_name": "Aekam Inc", "account_number": "50200041824821",
                     "ifsc": "HDFC0000521", "bank_name": "HDFC Bank",
                     "branch": "Bandra Kurla Complex", "upi_id": "aekam@hdfcbank"},
    "authorized_signatory_name": "Keval Shah",
    "authorized_signatory_designation": "Director",
}

CONTACT = {
    "name": "Meera Joshi", "company": "Vendor Demo Limited",
    "designation": "Procurement Head", "gstin": "27AAACT2727Q1ZW",
    "email": "success+vendor@simulator.amazonses.com",
    "billing_address": {"line1": "1 Demo Street", "city": "Mumbai",
                        "state": "Maharashtra", "pincode": "400001"},
}

INVOICE = {
    "invoice_type": "tax_invoice", "invoice_number": "INV-2607",
    "invoice_date": "2026-07-08", "due_date": "2026-07-23",
    "place_of_supply": "Maharashtra (27)", "is_igst": False, "currency": "INR",
    "line_items": [
        {"description": "Office fit-out — Phase 2", "hsn_code": "995461",
         "quantity": 1, "unit": "", "rate": 325000, "gst_rate": 18, "line_total": 325000},
    ],
    "subtotal": 325000, "cgst": 29250, "sgst": 29250, "igst": 0,
    "total": 383500, "amount_paid": 0, "balance_due": 383500,
}

EMPLOYEE = {"name": "Aanya Mehta", "employee_code": "KV-0042", "employee_id": "KV-0042",
            "department_name": "Finance", "designation": "Manager — Finance",
            "pan": "BQZPM4417L", "uan": "101234567890", "esi_number": "3101234567",
            "bank_account": "50100244174417", "bank_name": "HDFC Bank"}

PAYSLIP = {"payslip_number": "PS-2607-004", "month": "2026-07",
           "working_days": 31, "present_days": 31, "leaves_paid": 0, "leaves_unpaid": 0,
           "basic": 72500, "hra": 29000, "conveyance": 4800, "special_allowance": 31200,
           "gross": 145000, "pf_employee": 8700, "pf_employer": 8700,
           "esi_employee": 1088, "esi_employer": 4712, "professional_tax": 200,
           "tds": 10312, "total_deductions": 20300, "net_pay": 124700}

QUOTE = {
    "quote_number": "QT-118", "quote_date": "2026-07-21", "valid_until": "2026-08-15",
    "prepared_by": "Aanya Mehta", "reference": "RFQ/DEMO/2026/114",
    "line_items": [{"description": "Monthly compliance retainer", "quantity": 12,
                    "unit": "mo", "rate": 100000, "line_total": 1200000}],
    "subtotal": 1200000, "discount": 0, "is_igst": True, "igst": 216000, "gst_rate": 18,
}

STATEMENT = {
    "statement_number": "SOA-2607", "period_start": "2026-04-01", "period_end": "2026-07-25",
    "opening_balance": 100000,
    "entries": [{"date": "2026-04-18", "document": "INV-2588",
                 "particulars": "Retainer — April", "debit": 200000}],
    "closing_balance": 300000,
    "ageing": {"current": 300000, "d1_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 0},
}

AGREEMENT = {
    "agreement_number": "AGR-2026-018", "effective_date": "2026-08-01", "term_months": 12,
    "governing_law": "India · Mumbai", "governing_seat": "Mumbai", "project_ref": "KAR-582",
    "fee": 1000000, "gst_rate": 18, "place_of_supply": "Maharashtra", "is_igst": False,
    "payment_days": 30, "provider_is_msme": True, "tds_section": "194C", "tds_rate": 2,
    "scope": ["Project management for the Client's Mumbai office."],
    "milestones": [{"title": "Site measurement", "target": "2026-08-15",
                    "share_pct": 100, "fee": 1000000}],
}

REPORT = {
    "report_number": "RPT-0037", "project_name": "Mumbai fit-out",
    "period_start": "2026-07-01", "period_end": "2026-07-25",
    "prepared_by": "Rohan Iyer", "prepared_on": "2026-07-25", "board_ref": "KAR-582",
    "overall_state": "At risk", "headline": "Milestone 1 is complete.",
    "measures": [{"label": "Fee invoiced to date", "numeric": True, "plan": 200000,
                  "actual": 200000, "variance": 0, "state": "On plan"}],
}


def _invoice_html():
    import services.invoice_pdf as m
    return m._build_html(INVOICE, ORG, CONTACT, V.validate_tax_invoice(INVOICE, ORG, CONTACT))


def _quotation_html():
    import services.quotation_pdf as m
    c = m.compute(QUOTE)
    return m._build_html(QUOTE, ORG, CONTACT,
                         V.validate_quotation({**QUOTE, "subtotal": c["subtotal"]}, ORG, CONTACT))


def _payslip_html():
    import services.payslip_pdf as m
    return m._build_html(PAYSLIP, EMPLOYEE, ORG, V.validate_payslip(PAYSLIP, EMPLOYEE, ORG))


def _statement_html():
    import services.statement_pdf as m
    return m._build_html(STATEMENT, ORG, CONTACT, V.validate_statement(STATEMENT, ORG, CONTACT))


def _agreement_html(agreement=None):
    import services.agreement_pdf as m
    a = agreement if agreement is not None else AGREEMENT
    return m._build_html(a, ORG, CONTACT, V.validate_service_agreement(a, ORG, CONTACT))


def _project_report_html():
    import services.project_report_pdf as m
    return m._build_html(REPORT, ORG, CONTACT, V.validate_project_report(REPORT, ORG, CONTACT))


# Every document that carries a date the reader is meant to act on.
DATED_DOCUMENTS = {
    "tax invoice": _invoice_html,
    "quotation": _quotation_html,
    "payslip": _payslip_html,
    "statement of account": _statement_html,
    "service agreement": _agreement_html,
    "project report": _project_report_html,
}

# `YYYY-MM-DD`, anywhere in the rendered document.
ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


# ══════════════════════════════════════════════════════════════════════════════
# 1 · A date is printed the way the reader writes one
# ══════════════════════════════════════════════════════════════════════════════

class TestDatesAreReadable:
    """No document hands a reader a raw `YYYY-MM-DD`.

    An Indian commercial document is dated `08 Jul 2026`. The ISO form is a
    storage format: it is what the column holds, not what a client reads, and
    printing it is the tell that a value went to the page without passing
    through the layer that formats it.

    Asserted over every dated document at once, because the drift is per
    document — the tax invoice was the odd one out for as long as it was the
    only one anybody had rendered.
    """

    @pytest.mark.parametrize("name", sorted(DATED_DOCUMENTS))
    def test_no_document_prints_a_raw_iso_date(self, name):
        html = DATED_DOCUMENTS[name]()
        found = sorted(set(ISO_DATE.findall(html)))
        assert not found, (
            f"{name} prints {found} as a raw ISO date. Every other document in "
            f"the set formats dates as '08 Jul 2026'; a reader of this one gets "
            f"the database's format instead."
        )

    def test_the_invoice_prints_its_dates_the_way_the_quotation_does(self):
        """The two documents a client receives from the same firm, side by side.

        Stated as a comparison rather than against a literal, so it keeps
        holding if the house date format is ever changed deliberately — it only
        fails when the two DISAGREE, which is the defect.
        """
        assert "08 Jul 2026" in _invoice_html(), (
            "the tax invoice does not print its invoice date as '08 Jul 2026', "
            "which is the form the quotation, statement, agreement and project "
            "report all use"
        )
        assert "23 Jul 2026" in _invoice_html(), "the due date is not formatted either"

    def test_the_project_report_period_is_not_half_formatted(self):
        """The reporting period is one field built from two dates.

        It read `2026-07-01 – 25 Jul 2026`: the start went through a strftime
        directive that raises on a non-glibc C library, the failure fell back to
        the raw value, and the end — which used a portable directive — formatted
        correctly. Two formats inside one field, on the page a client reads.
        """
        html = _project_report_html()
        assert "2026-07-01" not in html, (
            "the reporting period still prints its start date raw"
        )
        assert "01 Jul" in html or "1 Jul" in html


# ══════════════════════════════════════════════════════════════════════════════
# 2 · A document does not describe itself as unfinished
# ══════════════════════════════════════════════════════════════════════════════

class TestNoDraftMarkingsSurviveToTheReader:

    def test_an_agreement_with_no_status_note_is_not_stamped_a_placeholder(self):
        """The default must not be a draft marking.

        The design file labels its own mockup "Placeholder execution copy —
        legal review pending before signature", and the generator adopted that
        as the fallback for `status_note`. `POST /contracts/{id}/agreement/pdf`
        defaults the field to `""`, so the fallback is what every caller that
        does not know about the parameter actually gets: a service agreement
        that tells the client, on its face, that it is not the real one.

        A caller that DOES pass a note still gets it printed — that path is
        asserted below, so this fix cannot be read as removing the feature.
        """
        html = _agreement_html()
        assert "Placeholder" not in html, (
            "an agreement generated without an explicit status_note is stamped "
            "'Placeholder execution copy'"
        )
        assert "legal review pending" not in html

    def test_an_explicit_status_note_is_still_printed(self):
        note = "Draft for internal review — not for signature."
        html = _agreement_html({**AGREEMENT, "status_note": note})
        assert note in html, "an explicitly supplied status note must still print"

    def test_the_agreement_still_names_its_parties_and_date(self):
        """Guard against the fix above being made by deleting the sentence."""
        html = _agreement_html()
        assert "01 August 2026" in html
        assert "between the parties named above" in html


# ══════════════════════════════════════════════════════════════════════════════
# 3 · A document does not point at something that is not on it
# ══════════════════════════════════════════════════════════════════════════════

class TestTheDocumentDescribesWhatIsActuallyPrinted:

    def test_the_signature_page_claims_a_fingerprint_only_when_it_has_one(self):
        """The e-sign signature page is an evidentiary document.

        It states: "The document presented for signature has the SHA-256
        fingerprint below. Any alteration to it after signature produces a
        different fingerprint and is therefore detectable." When
        `sign_documents.file_hash` is empty the paragraph was printed anyway and
        the line under it rendered `R.unset("Fingerprint")` — an em-dash, since
        the 2026-08-03 ruling replaced the red marker.

        That ruling is right for a commercial document, where a blank field is a
        bookkeeping gap the reader cannot act on. It is wrong HERE, because this
        paragraph does not merely omit a value: it asserts that a fingerprint is
        present and that tampering is therefore detectable. With nothing under
        it the document tells a court something untrue about its own evidence.

        The claim and the value travel together or neither is printed.
        """
        from datetime import datetime, timezone

        from services.esign_signed_doc import build_signature_page_html

        signers = [{"name": "Keval Shah", "email": "info+keval@unicodegroup.com",
                    "signature_type": "typed", "signature_data": "Keval Shah",
                    "signed_at": datetime(2026, 8, 5, 10, 15, tzinfo=timezone.utc),
                    "signed_ip": "103.21.244.10", "otp_verified": True}]
        doc_no_hash = {"id": "8f14e45f-ceea-467a-9b2c-1d2a3b4c5d6e",
                       "title": "Service Agreement AGR-2026-018",
                       "completed_at": datetime(2026, 8, 5, 11, 32, tzinfo=timezone.utc)}

        html = build_signature_page_html(ORG, doc_no_hash, signers, True, "agreement.pdf")
        assert "SHA-256 fingerprint" not in html, (
            "the signature page asserts a SHA-256 fingerprint is printed below "
            "it, but the document has no file_hash and nothing is printed"
        )
        # The rest of the legal basis is unaffected — the fix must not delete it.
        assert "Information Technology Act, 2000" in html
        assert "machine-readable certificate" in html

    def test_the_signature_page_still_prints_a_fingerprint_when_there_is_one(self):
        from datetime import datetime, timezone

        from services.esign_signed_doc import build_signature_page_html

        digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        signers = [{"name": "Keval Shah", "signature_type": "typed",
                    "signature_data": "Keval Shah", "otp_verified": True,
                    "signed_at": datetime(2026, 8, 5, 10, 15, tzinfo=timezone.utc)}]
        doc = {"id": "8f14e45f-ceea-467a-9b2c-1d2a3b4c5d6e", "title": "Service Agreement",
               "file_hash": digest,
               "completed_at": datetime(2026, 8, 5, 11, 32, tzinfo=timezone.utc)}

        html = build_signature_page_html(ORG, doc, signers, True, "agreement.pdf")
        assert digest in html, "the fingerprint must still be printed when it exists"
        assert "SHA-256 fingerprint" in html, "and the claim must accompany it"

    def test_the_statement_does_not_promise_a_qr_it_does_not_draw(self):
        """`statement_pdf` deliberately draws a ₹ placeholder rather than a real
        UPI QR — a code that resolved to the wrong VPA would move a client's
        money to the wrong account, and that decision is not reopened here.

        What was wrong is the sentence beside it: "Scan the code, or transfer
        to …". There is no code to scan. The instruction has to match the box.
        """
        html = _statement_html()
        assert "aekam@hdfcbank" in html, "the VPA must still be printed to pay to"
        assert "Scan the code" not in html, (
            "the statement tells the reader to scan a code, but the QR box is a "
            "₹ placeholder — there is nothing to scan"
        )
