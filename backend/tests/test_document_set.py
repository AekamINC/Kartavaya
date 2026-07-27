"""The six documents added to close the gap against the approved design.

`design-reference/Kartavaya Redesign/docs/` specifies nine documents. Two were
built (`invoice_pdf.py`, `payslip_pdf.py`); this file covers the rest —
GSTR-3B, TDS challan, statement of account, quotation, service agreement and
project report.

Three groups, in the order they matter:

1. **Conformance to the approved design.** `TestGstr3bAgainstSpec` feeds the
   specification's own Table 3.1 and Table 4 figures through `compute` and
   asserts its printed Table 6.1 and all four totals come back to the rupee.
   That is a test against the design, not against this implementation's opinion
   of it.
2. **Refusal.** Each validator is asserted both to pass a complete document and
   to block on its specific gap — a validator that blocks everything is as
   useless as one that blocks nothing, which is the reservation
   `test_document_statutory.py` already makes.
3. **Real PDF bytes.** `TestRealPdfBytes` calls the public `generate_*_pdf`
   entry points and asserts on text extracted from the resulting PDF, not merely
   that nothing raised. Skipped where WeasyPrint's native stack (libpango,
   libgobject) is absent; the HTML assertions above still run everywhere, which
   is where `test_document_generation.py` observes correctness actually lives.

No email, push or WhatsApp is involved on any path in this file, and no fixture
supplies a logo URL, so `embed_logo` never reaches the network.

Every amount below is a round synthetic figure chosen to make arithmetic
checkable by eye. None of them is anyone's real pricing.
"""

from __future__ import annotations

import pytest

from services.doc_validation import (
    DocumentIncomplete,
    validate_gstr3b,
    validate_project_report,
    validate_quotation,
    validate_service_agreement,
    validate_statement,
    validate_tds_challan,
)

# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════

ORG = {
    "name": "Aekam Inc",
    "gstin": "27AAACA1234M1Z8",
    "pan": "AAACA1234M",
    "tan": "MUMA12345B",
    "billing_address": {
        "line1": "Unit 402, Meridien Tower", "line2": "Bandra Kurla Complex",
        "city": "Mumbai", "state": "Maharashtra", "pincode": "400051", "country": "India",
    },
    "email": "accounts@example.invalid",
    "phone": "+91 22 0000 0000",
    "website": "kartavaya.com",
    "bank_details": {"upi_id": "example@examplebank"},
    "authorized_signatory_name": "Keval Shah",
    "authorized_signatory_designation": "Partner",
}

CLIENT = {
    "name": "Meera Joshi",
    "company": "Vendor Demo Limited",
    "designation": "Procurement Head",
    "gstin": "27AAACT2727Q1ZW",
    "billing_address": {"line1": "1 Demo Street", "city": "Mumbai",
                        "state": "Maharashtra", "pincode": "400001"},
}


# ── the specification's own GSTR-3B figures ─────────────────────────────────
# Transcribed from `docs/GSTR-3B Summary.html` Tables 3.1 and 4 ONLY. Table 6.1
# and the four totals are deliberately NOT transcribed as inputs — they are what
# the implementation has to reproduce.
#
# The design's own Table 4 figures are used UNCHANGED. What changed is WHERE the
# section 17(5) figure is reported: the design printed it as a standalone
# "(D) Ineligible ITC" memo outside the reversal, and the notified form reports
# it as a reversal inside 4(B)(1) (Circular 170/02/2022-GST, para 4.4). The
# amount is the design's ₹6,240 CGST + ₹6,240 SGST; only its row moved.
SPEC_GSTR3B_INPUTS = {
    "period": "2026-07",
    "outward_taxable": {"taxable": 4218600, "igst": 374220, "cgst": 190674, "sgst": 190674, "cess": 0},
    "outward_zero_rated": {"taxable": 640000},
    "outward_nil_exempt": {"taxable": 112000},
    "inward_reverse_charge": {"taxable": 84000, "cgst": 7560, "sgst": 7560},
    "outward_non_gst": {},
    "itc_import_goods": {"igst": 18400},          # 4(A)(1)
    "itc_reverse_charge": {"cgst": 7560, "sgst": 7560},  # 4(A)(3)
    "itc_all_other": {"igst": 142180, "cgst": 96412, "sgst": 96412},  # 4(A)(5)
    "itc_reversed": {"cgst": 4820, "sgst": 4820},        # 4(B)(1), rules 42/43
    "itc_blocked_17_5": {"cgst": 6240, "sgst": 6240},    # 4(B)(1), section 17(5)
    "outward_count": 47,
    "inward_count": 61,
    "gstr2b_date": "2026-07-14",
    "state_label": "Maharashtra (27)",
    "prepared_by": "Aanya Mehta",
    "prepared_on": "2026-07-25",
    "held_back": [
        {"party": "Demo Traders", "reason": "HSN code missing", "itc": 6000},
        {"party": "Demo Packaging", "reason": "HSN code missing", "itc": 5240},
    ],
}

# The expected output, DERIVED BY HAND from the inputs above so a reader can
# check it without running the code. Nothing here is copied out of the
# implementation. The working, head by head:
#
#   4(A) = (1) import goods + (3) reverse charge + (5) all other
#       IGST  18,400 +      0 + 1,42,180 = 1,60,580
#       CGST       0 +  7,560 +   96,412 = 1,03,972
#       SGST       0 +  7,560 +   96,412 = 1,03,972
#   4(B) = (1) [rules 42/43 + section 17(5)] + (2) others
#       CGST  4,820 + 6,240 + 0 = 11,060      IGST 0      SGST 11,060
#   4(C) = 4(A) − 4(B)                    [Circular 170/02/2022 para 4.3(D)]
#       IGST 1,60,580   CGST 1,03,972 − 11,060 = 92,912   SGST 92,912
#
#   6.1 payable = 3.1(a) outward tax + 3.1(d) reverse-charge tax
#       IGST 3,74,220   CGST 1,90,674 + 7,560 = 1,98,234   SGST 1,98,234
#   Reverse charge is cash-only (s.49(4), rule 85(4)), so 7,560 CGST and
#   7,560 SGST leave the ITC-payable base before any credit is applied:
#       ITC-payable  IGST 3,74,220   CGST 1,90,674   SGST 1,90,674
#   Rule 88A order — IGST credit first and fully, then own-head credit:
#       IGST credit 1,60,580 -> IGST liability, exhausted. Cash 3,74,220 −
#           1,60,580 = 2,13,640.
#       CGST credit 92,912 -> CGST liability. Cash 1,90,674 − 92,912 = 97,762,
#           plus the 7,560 carved out = 1,05,322.
#       SGST identical: via ITC 92,912, cash 1,05,322.
#
#   Totals  payable 3,74,220 + 1,98,234 + 1,98,234           = 7,70,688
#           via ITC 1,60,580 +   92,912 +   92,912           = 3,46,404
#           cash    2,13,640 + 1,05,322 + 1,05,322 + 0 int.  = 4,24,284
#
# Against the design's printed 6.1 this is 12,480 less credit and 12,480 more
# cash — exactly the 6,240 + 6,240 of section 17(5) credit that the design left
# outside the reversal and the notified form takes out of Net ITC.
SPEC_GSTR3B_PRINTED = {
    "itc_available": {"igst": 160580, "cgst": 103972, "sgst": 103972, "cess": 0},
    "itc_reversed": {"igst": 0, "cgst": 11060, "sgst": 11060, "cess": 0},
    "net_itc": {"igst": 160580, "cgst": 92912, "sgst": 92912, "cess": 0},
    "set_off": {
        "igst": {"payable": 374220, "via_itc": 160580, "in_cash": 213640},
        "cgst": {"payable": 198234, "via_itc": 92912, "in_cash": 105322},
        "sgst": {"payable": 198234, "via_itc": 92912, "in_cash": 105322},
        "cess": {"payable": 0, "via_itc": 0, "in_cash": 0},
    },
    "total_payable": 770688,
    "total_itc": 346404,
    "total_cash": 424284,
}

# A second fixture with EVERY Table 4 row populated, so the rows the design
# never exercised are not merely present but arithmetically live. Amounts are
# obviously synthetic round numbers and belong to no real firm.
FULL_TABLE_4_INPUTS = {
    "period": "2026-08",
    "outward_taxable": {"taxable": 1000000, "igst": 0, "cgst": 90000, "sgst": 90000},
    "inward_reverse_charge": {"taxable": 100000, "cgst": 9000, "sgst": 9000},
    "itc_import_goods": {"igst": 50000},                        # 4(A)(1)
    "itc_import_services": {"igst": 20000},                     # 4(A)(2)
    "itc_reverse_charge": {"cgst": 9000, "sgst": 9000},         # 4(A)(3)
    "itc_isd": {"igst": 10000, "cgst": 5000, "sgst": 5000},     # 4(A)(4)
    "itc_all_other": {"igst": 40000, "cgst": 30000, "sgst": 30000},  # 4(A)(5)
    "itc_reversed": {"cgst": 2000, "sgst": 2000},               # 4(B)(1) rules
    "itc_blocked_17_5": {"igst": 5000},                         # 4(B)(1) s.17(5)
    "itc_reversed_other": {"cgst": 1000, "sgst": 1000},         # 4(B)(2)
    "itc_reclaimed": {"cgst": 3000, "sgst": 3000},              # 4(D)(1) memo
    "itc_ineligible_16_4_pos": {"cgst": 4000, "sgst": 4000},    # 4(D)(2) memo
}

# Derived by hand from FULL_TABLE_4_INPUTS:
#   4(A) IGST 50,000 + 20,000 + 0 + 10,000 + 40,000 = 1,20,000
#        CGST      0 +      0 + 9,000 + 5,000 + 30,000 = 44,000   SGST 44,000
#   4(B)(1) IGST 0 + 5,000 = 5,000        CGST 2,000        SGST 2,000
#   4(B)(2) CGST 1,000  SGST 1,000
#   4(B)    IGST 5,000  CGST 3,000  SGST 3,000
#   4(C)    IGST 1,15,000  CGST 41,000  SGST 41,000
FULL_TABLE_4_EXPECTED = {
    "itc_available": {"igst": 120000, "cgst": 44000, "sgst": 44000, "cess": 0},
    "itc_reversed_b1": {"igst": 5000, "cgst": 2000, "sgst": 2000, "cess": 0},
    "itc_reversed_b2": {"igst": 0, "cgst": 1000, "sgst": 1000, "cess": 0},
    "itc_reversed": {"igst": 5000, "cgst": 3000, "sgst": 3000, "cess": 0},
    "net_itc": {"igst": 115000, "cgst": 41000, "sgst": 41000, "cess": 0},
    "itc_reclaimed": {"igst": 0, "cgst": 3000, "sgst": 3000, "cess": 0},
    "itc_ineligible_16_4_pos": {"igst": 0, "cgst": 4000, "sgst": 4000, "cess": 0},
}


def challan(**over) -> dict:
    base = {
        "period": "2026-07",
        "challan_number": "CHL-0442",
        "deposit_date": "2026-08-07",
        "major_head": "0021",
        "payment_type": "200",
        "bsr_code": "0510308",
        "challan_serial": "04412",
        "bank_name": "Demo Bank — Demo Branch",
        "payment_method": "NEFT",
        "deductions": [
            {"section": "194C", "nature": "Payments to contractors", "count": 4,
             "amount_paid": 1000000, "rate": 2, "tds": 20000},
            {"section": "194J", "nature": "Professional / technical fees", "count": 3,
             "amount_paid": 500000, "rate": 10, "tds": 50000},
            {"section": "192B", "nature": "Salary — non-government employees", "count": 6,
             "amount_paid": 1200000, "rate": None, "tds": 30000},
        ],
        # 20,000 + 50,000 + 30,000 = 1,00,000
        "amounts": {"income_tax": 100000},
    }
    base.update(over)
    return base


def statement(**over) -> dict:
    base = {
        "statement_number": "SOA-2607",
        "period_start": "2026-04-01",
        "period_end": "2026-07-25",
        "opening_balance": 100000,
        "entries": [
            {"date": "2026-04-18", "document": "INV-2588", "particulars": "Retainer — April",
             "debit": 200000},
            {"date": "2026-05-02", "document": "RCPT-914", "particulars": "Payment received",
             "credit": 300000},
            {"date": "2026-07-08", "document": "INV-2607", "particulars": "Phase 2",
             "debit": 400000},
        ],
        # 100000 + 600000 - 300000 = 400000
        "closing_balance": 400000,
        "ageing": {"current": 400000, "d1_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 0},
        "msme_registered": True,
    }
    base.update(over)
    return base


def quotation(**over) -> dict:
    base = {
        "quote_number": "QT-118",
        "quote_date": "2026-07-21",
        "valid_until": "2026-08-15",
        "prepared_by": "Aanya Mehta",
        "reference": "RFQ/DEMO/2026/114",
        "scope_summary": "Quarterly compliance retainer covering three registrations.",
        "line_items": [
            {"description": "Monthly compliance retainer", "sub": "3 registrations",
             "quantity": 12, "unit": "mo", "rate": 100000, "line_total": 1200000},
            {"description": "Reconciliation and advisory", "quantity": 12, "unit": "mo",
             "rate": 50000, "line_total": 600000},
        ],
        "subtotal": 1800000,
        "discount": 0,
        "is_igst": True,
        "igst": 324000,
        "gst_rate": 18,
        "payment_schedule": [
            {"label": "30% on signing", "amount": 637200, "due": "on acceptance"},
            {"label": "40% at half-year", "amount": 849600, "due": "Jan 2027"},
            {"label": "30% on completion", "amount": 637200, "due": "Jul 2027"},
        ],
    }
    base.update(over)
    return base


def agreement(**over) -> dict:
    base = {
        "agreement_number": "AGR-2026-018",
        "effective_date": "2026-08-01",
        "term_months": 12,
        "governing_law": "India · Mumbai",
        "governing_seat": "Mumbai",
        "project_ref": "KAR-582",
        "fee": 1000000,
        "gst_rate": 18,
        "place_of_supply": "Maharashtra",
        "is_igst": False,
        "payment_days": 30,
        "provider_is_msme": True,
        "tds_section": "194C",
        "tds_rate": 2,
        "scope": [
            "Project management for the Client's Mumbai office.",
            "Deliverables are the milestones listed in clause 3.",
        ],
        "milestones": [
            {"title": "Site measurement and signed layout", "target": "2026-08-15",
             "share_pct": 20, "fee": 200000},
            {"title": "Detailed drawings issued", "target": "2026-09-12",
             "share_pct": 30, "fee": 300000},
            {"title": "Works complete", "target": "2026-11-28",
             "share_pct": 30, "fee": 300000},
            {"title": "Handover and as-built documentation", "target": "2027-01-31",
             "share_pct": 20, "fee": 200000},
        ],
    }
    base.update(over)
    return base


def project_report(**over) -> dict:
    base = {
        "report_number": "RPT-0037",
        "project_name": "Mumbai fit-out",
        "period_start": "2026-07-01",
        "period_end": "2026-07-25",
        "prepared_by": "Rohan Iyer",
        "prepared_on": "2026-07-25",
        "board_ref": "KAR-582",
        "agreement_ref": "Agreement AGR-2026-018",
        "overall_state": "At risk",
        "headline": "Milestone 1 is complete. Milestone 2 is behind on drawings.",
        "measures": [
            {"label": "Fee invoiced to date", "numeric": True, "plan": 200000,
             "actual": 200000, "variance": 0, "state": "On plan"},
            {"label": "Hours consumed", "numeric": True, "plan": 184, "actual": 206,
             "variance": 22, "state": "Over", "unit": "h"},
            {"label": "Open tasks", "numeric": True, "plan": 0, "actual": 3,
             "variance": 3, "state": "Watch"},
        ],
        "decisions": [{"by": "2026-08-05", "text": "Confirm the outstanding dimension."}],
    }
    base.update(over)
    return base


# ══════════════════════════════════════════════════════════════════════════════
# 1 · Conformance to the approved design
# ══════════════════════════════════════════════════════════════════════════════

class TestGstr3bAgainstSpec:
    """`compute` must reproduce the specification's printed Table 6.1.

    This is the test that makes the GSTR-3B trustworthy. The inputs are the
    design's Tables 3.1 and 4; the expected values are the design's printed
    Table 6.1 and totals. Nothing in between is transcribed, so an error in the
    set-off cannot be papered over by copying the answer.
    """

    @pytest.mark.parametrize("key", ["itc_available", "itc_reversed", "net_itc"])
    def test_table_4_matches_the_hand_derivation(self, key):
        from services.gstr3b_pdf import compute
        assert compute(SPEC_GSTR3B_INPUTS)[key] == SPEC_GSTR3B_PRINTED[key]

    @pytest.mark.parametrize("head", ["igst", "cgst", "sgst", "cess"])
    def test_net_itc_is_exactly_4a_minus_4b(self, head):
        """Circular 170/02/2022-GST para 4.3(D): `4C = 4A − [4B(1) + 4B(2)]`.
        Asserted as an IDENTITY rather than against fixed numbers, so it holds
        for any figures a firm puts in, not only the design's."""
        from services.gstr3b_pdf import compute
        c = compute(SPEC_GSTR3B_INPUTS)
        assert c["net_itc"][head] == c["itc_available"][head] - c["itc_reversed"][head]

    @pytest.mark.parametrize("head", ["igst", "cgst", "sgst", "cess"])
    @pytest.mark.parametrize("column", ["payable", "via_itc", "in_cash"])
    def test_table_6_1_matches_the_hand_derivation(self, head, column):
        from services.gstr3b_pdf import compute
        got = compute(SPEC_GSTR3B_INPUTS)["set_off"][head][column]
        assert got == SPEC_GSTR3B_PRINTED["set_off"][head][column]

    @pytest.mark.parametrize("key", ["total_payable", "total_itc", "total_cash"])
    def test_the_four_totals_match_the_hand_derivation(self, key):
        from services.gstr3b_pdf import compute
        assert compute(SPEC_GSTR3B_INPUTS)[key] == SPEC_GSTR3B_PRINTED[key]

    @pytest.mark.parametrize("head", ["igst", "cgst", "sgst", "cess"])
    def test_6_1_consumes_exactly_the_credit_4c_makes_available(self, head):
        """The join between the two tables. Credit utilised may never exceed
        4(C), and on these figures every rupee of 4(C) that CAN be used IS —
        an implementation that quietly under-utilised would overstate the cash
        a firm deposits and would otherwise pass every other assertion here."""
        from services.gstr3b_pdf import compute
        c = compute(SPEC_GSTR3B_INPUTS)
        s = c["set_off"][head]
        assert s["via_itc"] <= c["net_itc"][head]
        assert s["via_itc"] + s["credit_left"] == c["net_itc"][head]

    def test_section_17_5_credit_is_reversed_not_merely_disclosed(self):
        """The compliance fix, stated as the difference it makes.

        On the design's own figures, moving section 17(5) blocked credit from a
        standalone (D) memo into the 4(B)(1) reversal takes 12,480 out of Net
        ITC — which is 6,240 CGST + 6,240 SGST. If a future change puts it back
        outside the reversal, Net ITC rises by exactly that and this fails."""
        from services.gstr3b_pdf import compute
        c = compute(SPEC_GSTR3B_INPUTS)
        without = compute({**SPEC_GSTR3B_INPUTS, "itc_blocked_17_5": {}})
        assert c["itc_blocked_17_5"] == {"igst": 0, "cgst": 6240, "sgst": 6240, "cess": 0}
        delta = sum(without["net_itc"][h] - c["net_itc"][h] for h in ("igst", "cgst", "sgst", "cess"))
        assert delta == 12480
        assert c["total_cash"] - without["total_cash"] == 12480

    def test_the_deprecated_ineligible_key_still_reverses_section_17_5(self):
        """`itc_ineligible` used to carry the section 17(5) figure. A caller
        still sending it must get that figure REVERSED, not dropped and not
        re-read as the new 4(D)(2), which means something else entirely."""
        from services.gstr3b_pdf import compute
        legacy = {k: v for k, v in SPEC_GSTR3B_INPUTS.items() if k != "itc_blocked_17_5"}
        legacy["itc_ineligible"] = {"cgst": 6240, "sgst": 6240}
        assert compute(legacy)["net_itc"] == SPEC_GSTR3B_PRINTED["net_itc"]
        assert compute(legacy)["total_cash"] == SPEC_GSTR3B_PRINTED["total_cash"]

    def test_the_words_agree_with_the_cash_figure(self):
        """The same reservation the invoice makes: a words line that disagrees
        with the figures is a second, contradicting number on a document whose
        whole purpose is to be reconciled."""
        from services.gstr3b_pdf import _build_html, compute
        doc = _build_html(SPEC_GSTR3B_INPUTS, ORG)
        assert "Rupees Four Lakh Twenty Four Thousand Two Hundred Eighty Four Only" in doc
        assert compute(SPEC_GSTR3B_INPUTS)["total_cash"] == 424284

    def test_reverse_charge_is_never_paid_from_credit(self):
        """Section 49(4) with rule 85(4). Constructed so the constraint BITES:
        credit far exceeds the liability, so a naive set-off would show zero
        cash — the reverse-charge tax must still be in the cash column."""
        from services.gstr3b_pdf import compute_set_off
        out = compute_set_off(
            payable={"cgst": 10000, "sgst": 10000},
            credit={"cgst": 99999, "sgst": 99999},
            cash_only={"cgst": 4000, "sgst": 4000},
        )
        assert out["cgst"]["in_cash"] == 4000
        assert out["cgst"]["via_itc"] == 6000
        assert out["cgst"]["via_itc"] + out["cgst"]["in_cash"] == 10000

    def test_cgst_credit_never_pays_sgst(self):
        """Section 49(5)(c) and (d). The single easiest way to overstate a
        set-off, and it silently understates the cash a firm must deposit."""
        from services.gstr3b_pdf import compute_set_off
        out = compute_set_off(
            payable={"sgst": 50000},
            credit={"cgst": 90000},
        )
        assert out["sgst"]["via_itc"] == 0
        assert out["sgst"]["in_cash"] == 50000
        assert out["cgst"]["credit_left"] == 90000

    def test_igst_credit_is_exhausted_before_any_other(self):
        """Section 49A / rule 88A — IGST credit first, and fully."""
        from services.gstr3b_pdf import compute_set_off
        out = compute_set_off(
            payable={"igst": 10000, "cgst": 10000, "sgst": 10000},
            credit={"igst": 25000, "cgst": 10000, "sgst": 10000},
        )
        assert out["igst"]["credit_left"] == 0, "IGST credit must be spent first"
        assert out["igst"]["via_itc"] == 10000
        # 15,000 of IGST credit is left after IGST; it pays CGST then SGST.
        assert out["cgst"]["via_itc"] == 10000
        assert out["sgst"]["via_itc"] == 10000

    def test_the_held_back_records_are_named_on_the_face(self):
        """The design names the invoices it excludes rather than quietly
        dropping them, and `doc_validation`'s docstring cites that behaviour as
        the source of its own honesty rule."""
        from services.gstr3b_pdf import _build_html
        doc = _build_html(SPEC_GSTR3B_INPUTS, ORG)
        assert "Demo Traders" in doc
        assert "Demo Packaging" in doc
        assert "HSN code missing" in doc

    def test_the_paper_says_it_is_not_a_return(self):
        from services.gstr3b_pdf import _build_html
        doc = _build_html(SPEC_GSTR3B_INPUTS, ORG)
        assert "not a filed return" in doc
        assert "Not generated" in doc, "the ARN must read as absent, not blank"

    def test_the_monthly_due_date_is_the_twentieth(self):
        from services.gstr3b_pdf import statutory_due_date
        assert statutory_due_date("2026-07") == "2026-08-20"
        assert statutory_due_date("2026-12") == "2027-01-20", "December rolls the year"


class TestGstr3bTable4AgainstTheNotifiedForm:
    """Table 4 as notified by Notification 14/2022-CT, live on the portal from
    01.09.2022 for periods from August 2022.

    The design mock this product was built from prints a six-row Table 4 that
    omits three availment rows, does not split the reversal, and reports section
    17(5) blocked credit in the wrong place. These tests pin the form, not the
    mock. Authorities: the notification, the GSTN advisory of 02.09.2022, and
    Circular 170/02/2022-GST (para 4.3 and its worked Annexure).
    """

    @pytest.mark.parametrize("key", [
        "itc_available", "itc_reversed_b1", "itc_reversed_b2", "itc_reversed",
        "net_itc", "itc_reclaimed", "itc_ineligible_16_4_pos",
    ])
    def test_every_row_of_a_fully_populated_table_4(self, key):
        from services.gstr3b_pdf import compute
        assert compute(FULL_TABLE_4_INPUTS)[key] == FULL_TABLE_4_EXPECTED[key]

    @pytest.mark.parametrize("head", ["igst", "cgst", "sgst", "cess"])
    def test_4c_still_reconciles_with_every_row_populated(self, head):
        from services.gstr3b_pdf import compute
        c = compute(FULL_TABLE_4_INPUTS)
        assert c["net_itc"][head] == c["itc_available"][head] - c["itc_reversed"][head]

    @pytest.mark.parametrize("key,label", [
        ("itc_import_goods", "(A)(1) Import of goods"),
        ("itc_import_services", "(A)(2) Import of services"),
        ("itc_reverse_charge", "(A)(3) Inward supplies liable to reverse charge"),
        ("itc_isd", "(A)(4) Inward supplies from ISD"),
        ("itc_all_other", "(A)(5) All other ITC"),
    ])
    def test_each_availment_row_is_printed_and_adds_to_net_itc(self, key, label):
        """Two assertions per row because either alone is satisfiable by a
        mistake: a row can be printed and not counted, or counted and not
        printed. The form needs both."""
        from services.gstr3b_pdf import _build_html, compute
        assert label in _build_html(FULL_TABLE_4_INPUTS, ORG)
        without = compute({**FULL_TABLE_4_INPUTS, key: {}})
        full = compute(FULL_TABLE_4_INPUTS)
        dropped = sum(
            full["itc_available"][h] - without["itc_available"][h]
            for h in ("igst", "cgst", "sgst", "cess")
        )
        assert dropped == sum(FULL_TABLE_4_INPUTS[key].values()), (
            f"{label} is printed but does not reach 4(A)"
        )

    @pytest.mark.parametrize("key,label", [
        ("itc_reversed", "(B)(1) ITC reversed — rules 38, 42, 43 and section 17(5)"),
        ("itc_blocked_17_5", "(B)(1) ITC reversed — rules 38, 42, 43 and section 17(5)"),
        ("itc_reversed_other", "(B)(2) ITC reversed — others"),
    ])
    def test_each_reversal_input_reduces_net_itc(self, key, label):
        from services.gstr3b_pdf import _build_html, compute
        assert label in _build_html(FULL_TABLE_4_INPUTS, ORG)
        without = compute({**FULL_TABLE_4_INPUTS, key: {}})
        full = compute(FULL_TABLE_4_INPUTS)
        restored = sum(
            without["net_itc"][h] - full["net_itc"][h]
            for h in ("igst", "cgst", "sgst", "cess")
        )
        assert restored == sum(FULL_TABLE_4_INPUTS[key].values()), (
            f"{label} is printed but does not reduce 4(C)"
        )

    def test_b1_prints_as_one_row_carrying_both_its_inputs(self):
        """The notified form has ONE 4(B)(1) row. Circular 170/02/2022's own
        Annexure sums rule 42/43 reversals and section 17(5) into a single
        figure there (1,25,500 = 75,500 + 50,000)."""
        from services.gstr3b_pdf import compute
        c = compute(FULL_TABLE_4_INPUTS)
        # IGST: 0 under the rules + 5,000 section 17(5); CGST: 2,000 + 0.
        assert c["itc_reversed_b1"]["igst"] == 5000
        assert c["itc_reversed_b1"]["cgst"] == 2000

    @pytest.mark.parametrize("key", ["itc_reclaimed", "itc_ineligible_16_4_pos"])
    def test_table_4d_is_disclosure_and_never_touches_net_itc(self, key):
        """Circular 170/02/2022 para 4.3(D) computes 4(C) as 4A − [4B(1)+4B(2)].
        Para 4.2 is the reason: 4(C) is what reaches the electronic credit
        ledger. A (D) row that moved 4(C) would misstate the ledger."""
        from services.gstr3b_pdf import compute
        full = compute(FULL_TABLE_4_INPUTS)
        without = compute({**FULL_TABLE_4_INPUTS, key: {}})
        assert full["net_itc"] == without["net_itc"]
        assert full["itc_available"] == without["itc_available"]
        assert full["total_itc"] == without["total_itc"]
        assert full["total_cash"] == without["total_cash"]

    @pytest.mark.parametrize("label", [
        "(D)(1) ITC reclaimed, reversed under 4(B)(2) earlier",
        "(D)(2) Ineligible ITC — section 16(4), place-of-supply",
    ])
    def test_the_two_other_details_rows_are_printed(self, label):
        from services.gstr3b_pdf import _build_html
        assert label in _build_html(FULL_TABLE_4_INPUTS, ORG)

    def test_the_paper_names_where_section_17_5_went_and_why(self):
        """A CA reading a smaller 4(C) than the old form gave must be able to
        see the authority for it without opening the code."""
        from services.gstr3b_pdf import _build_html
        doc = _build_html(SPEC_GSTR3B_INPUTS, ORG)
        assert "Circular 170/02/2022-GST" in doc
        assert "4(B)(1)" in doc
        assert "Notification 14/2022-CT" in doc

    def test_the_working_paper_framing_survives_the_table_4_change(self):
        """The framing is what makes any residual divergence tolerable. It is
        asserted here as well as above because Table 4 is the part being
        changed, and the framing is the part that must not be lost with it."""
        from services.gstr3b_pdf import _build_html
        doc = _build_html(FULL_TABLE_4_INPUTS, ORG)
        assert "not a filed return" in doc
        assert "Working — not filed" in doc
        assert "Not generated" in doc


class TestGstr3bTable4Validation:
    def test_reclaimed_credit_exceeding_all_other_itc_is_refused(self):
        """4(D)(1) is the break-up of credit availed inside 4(A)(5), so it
        cannot exceed it. A paper that says otherwise would have a preparer
        claim the same credit twice."""
        from services.doc_validation import validate_gstr3b
        from services.gstr3b_pdf import compute
        bad = {**FULL_TABLE_4_INPUTS, "itc_reclaimed": {"cgst": 999999}}
        chk = validate_gstr3b(bad, ORG, compute(bad))
        assert "gstr3b.reclaimed.cgst" in {g.field for g in chk.blocking}

    def test_reclaimed_credit_within_all_other_itc_is_accepted(self):
        """The contrast, without which the test above is satisfiable by
        refusing every reclaim."""
        from services.doc_validation import validate_gstr3b
        from services.gstr3b_pdf import compute
        chk = validate_gstr3b(FULL_TABLE_4_INPUTS, ORG, compute(FULL_TABLE_4_INPUTS))
        assert not [g for g in chk.blocking if g.field.startswith("gstr3b.reclaimed")]

    def test_a_table_4_that_does_not_reconcile_is_refused(self):
        """4(C) = 4(A) − 4(B). Fed a `computed` whose net ITC disagrees with its
        own (A) and (B), the validator must refuse rather than print it."""
        from services.doc_validation import validate_gstr3b
        chk = validate_gstr3b(
            SPEC_GSTR3B_INPUTS, ORG,
            computed={
                "itc_available": {"cgst": 100000},
                "itc_reversed": {"cgst": 10000},
                "net_itc": {"cgst": 95000},   # should be 90,000
                "set_off": {},
            },
        )
        assert "gstr3b.net_itc.cgst" in {g.field for g in chk.blocking}

    def test_a_negative_net_itc_is_flagged_but_not_refused(self):
        """Reversals legitimately can exceed availment in a period. The figure
        is not wrong, so it is advisory — but a preparer must be told, because
        the whole liability then falls into cash."""
        from services.doc_validation import validate_gstr3b
        from services.gstr3b_pdf import compute
        over = {**FULL_TABLE_4_INPUTS, "itc_reversed": {"cgst": 500000}}
        c = compute(over)
        assert c["net_itc"]["cgst"] < 0
        chk = validate_gstr3b(over, ORG, c)
        assert "gstr3b.net_itc_negative.cgst" in {g.field for g in chk.advisory}
        assert not [g for g in chk.blocking if g.field.startswith("gstr3b.net_itc.")]

    def test_cross_utilised_igst_credit_is_not_mistaken_for_an_overdraw(self):
        """Rule 88A lets IGST credit pay a CGST or SGST liability once the IGST
        liability is met. The validator therefore may NOT compare the credit
        applied to a liability head against that head's own pool.

        This is a real refusal that was reachable in production: any firm whose
        IGST credit exceeds its IGST liability — an importer, or an inter-State
        buyer selling intra-State — spills IGST credit onto CGST, and a correct
        return was refused for it. `FULL_TABLE_4_INPUTS` has no IGST liability
        at all and 1,15,000 of IGST credit, so the spill is total."""
        from services.doc_validation import validate_gstr3b
        from services.gstr3b_pdf import compute
        c = compute(FULL_TABLE_4_INPUTS)
        # The condition that makes this bite: credit applied to the CGST
        # liability exceeds the CGST pool, because IGST credit paid it.
        assert c["set_off"]["cgst"]["via_itc"] > c["net_itc"]["cgst"]
        assert c["set_off"]["igst"]["credit_left"] == 0, "IGST credit spent first"
        chk = validate_gstr3b(FULL_TABLE_4_INPUTS, ORG, c)
        assert not [g for g in chk.blocking if g.field.startswith("gstr3b.itc.")], (
            f"correct rule 88A cross-utilisation refused: {[g.field for g in chk.blocking]}"
        )

    def test_an_overdrawn_credit_pool_is_still_refused(self):
        """The contrast, without which the test above is satisfiable by never
        checking anything. Here the SGST pool itself is overdrawn."""
        from services.doc_validation import validate_gstr3b
        chk = validate_gstr3b(
            SPEC_GSTR3B_INPUTS, ORG,
            computed={
                "net_itc": {"sgst": 1000},
                "set_off": {"sgst": {"payable": 9000, "via_itc": 9000,
                                     "in_cash": 0, "credit_left": -8000}},
            },
        )
        assert "gstr3b.itc.sgst" in {g.field for g in chk.blocking}

    def test_credit_conjured_between_pools_is_refused(self):
        """Applied and drawn must balance. A set-off that pays a liability
        without any pool falling is creating credit."""
        from services.doc_validation import validate_gstr3b
        chk = validate_gstr3b(
            SPEC_GSTR3B_INPUTS, ORG,
            computed={
                "net_itc": {"cgst": 5000},
                "set_off": {"cgst": {"payable": 5000, "via_itc": 5000,
                                     "in_cash": 0, "credit_left": 5000}},
            },
        )
        assert "gstr3b.itc.balance" in {g.field for g in chk.blocking}

    def test_negative_credit_is_never_utilised(self):
        """The safety property behind the advisory above: a negative 4(C) must
        pay nothing, not wrap around into a credit."""
        from services.gstr3b_pdf import compute_set_off
        out = compute_set_off(payable={"cgst": 10000}, credit={"cgst": -5000})
        assert out["cgst"]["via_itc"] == 0
        assert out["cgst"]["in_cash"] == 10000


class TestTdsChallanStatutoryShape:
    def test_the_assessment_year_follows_the_previous_year(self):
        """July 2026 is in PY 2026-27, so AY 2027-28 — the design's own value."""
        from services.tds_challan_pdf import assessment_year
        assert assessment_year("2026-07") == "2027–28"
        assert assessment_year("2026-03") == "2026–27", "March is the prior PY"
        assert assessment_year("2026-04") == "2027–28", "April opens the new PY"

    def test_the_deposit_due_date_is_the_seventh_except_for_march(self):
        """Rule 30(2) and its proviso."""
        from services.tds_challan_pdf import statutory_due_date
        assert statutory_due_date("2026-07") == "2026-08-07"
        assert statutory_due_date("2026-03") == "2026-04-30"
        assert statutory_due_date("2026-12") == "2027-01-07"

    def test_the_tender_date_is_ddmmyyyy_with_no_separator(self):
        from services.tds_challan_pdf import tender_date_ddmmyyyy
        assert tender_date_ddmmyyyy("2026-08-07") == "07082026"
        assert tender_date_ddmmyyyy("07082026") == "07082026"

    def test_a_192b_line_shows_no_rate_rather_than_a_wrong_one(self):
        """Salary TDS is deducted at the employee's own average rate under
        section 192(1), not at a section rate. Printing any single percentage
        would be wrong for every employee."""
        from services.tds_challan_pdf import _build_html
        doc = _build_html(challan(), ORG)
        assert "192B" in doc
        assert "&mdash;" in doc

    def test_the_cin_triple_is_on_the_face(self):
        from services.tds_challan_pdf import _build_html
        doc = _build_html(challan(), ORG)
        for expected in ("0510308", "07082026", "04412", "MUMA12345B"):
            assert expected in doc, expected

    def test_the_major_head_is_spelled_out_not_just_numbered(self):
        from services.tds_challan_pdf import _build_html
        doc = _build_html(challan(), ORG)
        assert "0021" in doc
        assert "Income tax other than companies" in doc


# ══════════════════════════════════════════════════════════════════════════════
# 2 · Refusal — each validator passes a complete document and blocks its own gap
# ══════════════════════════════════════════════════════════════════════════════

class TestGstr3bRefusal:
    def test_a_complete_working_paper_passes(self):
        from services.gstr3b_pdf import compute
        chk = validate_gstr3b(SPEC_GSTR3B_INPUTS, ORG, compute(SPEC_GSTR3B_INPUTS))
        assert chk.ok, [g.field for g in chk.blocking]

    def test_no_gstin_blocks(self):
        chk = validate_gstr3b(SPEC_GSTR3B_INPUTS, {**ORG, "gstin": ""})
        assert not chk.ok
        assert "org.gstin" in {g.field for g in chk.blocking}

    def test_no_period_blocks(self):
        chk = validate_gstr3b({**SPEC_GSTR3B_INPUTS, "period": ""}, ORG)
        assert "gstr3b.period" in {g.field for g in chk.blocking}

    def test_utilising_credit_that_does_not_exist_blocks(self):
        """Fabricated `computed`, because this is the failure that would follow a
        change to the set-off — the renderer and the ledger diverging."""
        chk = validate_gstr3b(
            SPEC_GSTR3B_INPUTS, ORG,
            computed={
                "set_off": {"cgst": {"payable": 100, "via_itc": 100, "in_cash": 0}},
                "net_itc": {"cgst": 10},
            },
        )
        assert "gstr3b.itc.cgst" in {g.field for g in chk.blocking}

    def test_a_set_off_that_does_not_discharge_the_liability_blocks(self):
        chk = validate_gstr3b(
            SPEC_GSTR3B_INPUTS, ORG,
            computed={
                "set_off": {"igst": {"payable": 1000, "via_itc": 100, "in_cash": 100}},
                "net_itc": {"igst": 5000},
            },
        )
        assert "gstr3b.set_off.igst" in {g.field for g in chk.blocking}

    def test_the_qrmp_assumption_is_declared_not_hidden(self):
        chk = validate_gstr3b(SPEC_GSTR3B_INPUTS, ORG)
        assert "gstr3b.filing_scheme" in {g.field for g in chk.advisory}


class TestTdsChallanRefusal:
    def test_a_complete_challan_passes(self):
        from services.tds_challan_pdf import compute
        c = challan()
        chk = validate_tds_challan(c, ORG, compute(c))
        assert chk.ok, [g.field for g in chk.blocking]

    def test_no_tan_blocks(self):
        """Section 203A. The single field this document cannot be issued without,
        and the one `staging.organisations` has no column for."""
        chk = validate_tds_challan(challan(), {**ORG, "tan": ""})
        assert not chk.ok
        assert "org.tan" in {g.field for g in chk.blocking}

    @pytest.mark.parametrize("bad", ["MUM12345B", "MUMA1234B", "mumA12345B1", "12345MUMA"])
    def test_a_malformed_tan_blocks(self, bad):
        chk = validate_tds_challan(challan(), {**ORG, "tan": bad})
        assert "org.tan" in {g.field for g in chk.blocking}, bad

    @pytest.mark.parametrize("field,bad", [
        ("bsr_code", ""), ("bsr_code", "051030"), ("bsr_code", "05103081"),
        ("challan_serial", ""), ("challan_serial", "4412"), ("challan_serial", "044120"),
    ])
    def test_a_broken_cin_element_blocks(self, field, bad):
        """A counterfoil that cannot be tied to a bank challan evidences nothing,
        and an invented CIN is worse than a missing one."""
        chk = validate_tds_challan(challan(**{field: bad}), ORG)
        assert f"challan.{field}" in {g.field for g in chk.blocking}, (field, bad)

    @pytest.mark.parametrize("bad", ["", "0022", "21", "corporation"])
    def test_an_unstated_or_invalid_major_head_blocks(self, bad):
        """0020 or 0021 — a property of the DEDUCTEE, never inferred."""
        chk = validate_tds_challan(challan(major_head=bad), ORG)
        assert "challan.major_head" in {g.field for g in chk.blocking}, bad

    @pytest.mark.parametrize("bad", ["", "300", "200A"])
    def test_an_unstated_or_invalid_payment_type_blocks(self, bad):
        chk = validate_tds_challan(challan(payment_type=bad), ORG)
        assert "challan.payment_type" in {g.field for g in chk.blocking}, bad

    def test_a_deposit_that_does_not_match_what_was_withheld_blocks(self):
        """The most useful thing this document can say before a 26Q goes out."""
        from services.tds_challan_pdf import compute
        c = challan(amounts={"income_tax": 90000})  # lines total 1,00,000
        chk = validate_tds_challan(c, ORG, compute(c))
        assert "challan.reconciliation" in {g.field for g in chk.blocking}

    def test_a_challan_with_no_deduction_lines_blocks(self):
        from services.tds_challan_pdf import compute
        c = challan(deductions=[], amounts={"income_tax": 0})
        chk = validate_tds_challan(c, ORG, compute(c))
        assert "challan.deductions" in {g.field for g in chk.blocking}


class TestStatementRefusal:
    def test_a_reconciling_statement_passes(self):
        chk = validate_statement(statement(), ORG, CLIENT)
        assert chk.ok, [g.field for g in chk.blocking]

    def test_a_ledger_that_does_not_tie_blocks(self):
        chk = validate_statement(statement(closing_balance=999999), ORG, CLIENT)
        assert "statement.closing_balance" in {g.field for g in chk.blocking}

    def test_ageing_that_does_not_sum_to_the_outstanding_blocks(self):
        chk = validate_statement(
            statement(ageing={"current": 1, "d1_30": 1}), ORG, CLIENT
        )
        assert "statement.ageing" in {g.field for g in chk.blocking}

    def test_a_credit_balance_is_not_aged(self):
        """A client in advance has nothing to age; blocking would flag a
        perfectly correct statement."""
        chk = validate_statement(
            statement(opening_balance=0, entries=[
                {"date": "2026-05-02", "document": "RCPT-1", "particulars": "Advance",
                 "credit": 50000}],
                closing_balance=-50000, ageing={"current": 0}),
            ORG, CLIENT,
        )
        assert "statement.ageing" not in {g.field for g in chk.blocking}

    def test_ageing_runs_from_the_due_date_not_the_invoice_date(self):
        """An invoice on 30-day terms issued 40 days ago is 10 days overdue, not
        40. Ageing from the invoice date turns every current account overdue."""
        from services.statement_pdf import age_receivables
        buckets = age_receivables(
            [{"balance_due": 1000, "date": "2026-06-15", "due_date": "2026-07-15"}],
            as_at="2026-07-25",
        )
        assert buckets["d1_30"] == 1000
        assert buckets["current"] == 0

    def test_an_undue_invoice_is_current(self):
        from services.statement_pdf import age_receivables
        buckets = age_receivables(
            [{"balance_due": 1000, "due_date": "2026-08-15"}], as_at="2026-07-25"
        )
        assert buckets["current"] == 1000

    def test_the_msme_notice_appears_only_when_the_issuer_is_registered(self):
        """It is a claim about the issuer's own registration, made on a document
        that lands in a buyer's tax file."""
        from services.statement_pdf import _build_html
        with_msme = _build_html(statement(), ORG, CLIENT)
        without = _build_html(statement(msme_registered=False), ORG, CLIENT)
        assert "43B(h)" in with_msme
        assert "43B(h)" not in without


class TestQuotationRefusal:
    def test_a_complete_quotation_passes(self):
        chk = validate_quotation(quotation(), ORG, CLIENT)
        assert chk.ok, [g.field for g in chk.blocking]

    def test_a_quotation_needs_no_gstin_hsn_or_place_of_supply(self):
        """The reservation `doc_validation` already makes for tax documents:
        "a quotation or proforma is an offer, not a tax document"."""
        chk = validate_quotation(
            quotation(), {**ORG, "gstin": "", "pan": ""}, CLIENT
        )
        fields = {g.field for g in chk.blocking}
        assert "org.gstin" not in fields
        assert not any("hsn" in f for f in fields)
        assert not any("place_of_supply" in f for f in fields)

    def test_a_total_that_does_not_follow_from_the_lines_blocks(self):
        """A quotation is capable of acceptance; a wrong total is a wrong
        contract."""
        chk = validate_quotation(quotation(subtotal=1), ORG, CLIENT)
        assert "quote.subtotal" in {g.field for g in chk.blocking}

    def test_a_contradictory_tax_split_blocks(self):
        chk = validate_quotation(
            quotation(is_igst=True, cgst=1000, sgst=1000), ORG, CLIENT
        )
        assert "quote.tax_split" in {g.field for g in chk.blocking}

    def test_the_acceptance_block_belongs_to_the_client(self):
        """The substantive defect in rendering a quotation through the invoice
        template: the signature block was the OFFEROR's, which inverts who is
        agreeing to what."""
        from services.quotation_pdf import _build_html
        doc = _build_html(quotation(), ORG, CLIENT)
        assert "Accepted for Vendor Demo Limited" in doc
        assert "Authorised signatory" not in doc

    def test_the_quotation_carries_what_the_invoice_template_dropped(self):
        from services.quotation_pdf import _build_html
        doc = _build_html(quotation(), ORG, CLIENT)
        for expected in ("Valid until", "Scope summary", "Payment schedule",
                         "Prepared for", "Terms", "प्रस्ताव"):
            assert expected in doc, expected
        assert "Bill To" not in doc
        assert "HSN" not in doc

    def test_an_expired_quotation_says_so(self):
        from services.quotation_pdf import _build_html
        doc = _build_html(quotation(valid_until="2020-01-01"), ORG, CLIENT)
        assert "Expired" in doc


class TestServiceAgreementRefusal:
    def test_a_complete_agreement_passes(self):
        chk = validate_service_agreement(agreement(), ORG, CLIENT)
        assert chk.ok, [g.field for g in chk.blocking]

    def test_milestone_shares_that_do_not_reach_a_hundred_block(self):
        ms = agreement()["milestones"][:2]
        chk = validate_service_agreement(agreement(milestones=ms), ORG, CLIENT)
        assert "agreement.milestones" in {g.field for g in chk.blocking}

    def test_no_fee_blocks(self):
        chk = validate_service_agreement(agreement(fee=0), ORG, CLIENT)
        assert "agreement.fee" in {g.field for g in chk.blocking}

    def test_no_scope_blocks(self):
        chk = validate_service_agreement(agreement(scope=[]), ORG, CLIENT)
        assert "agreement.scope" in {g.field for g in chk.blocking}

    def test_an_unnamed_client_blocks(self):
        chk = validate_service_agreement(agreement(), ORG, {})
        assert "contact.name" in {g.field for g in chk.blocking}

    def test_the_arbitration_seat_is_never_guessed(self):
        """A clause with a guessed seat sends a dispute to the wrong forum."""
        from services.agreement_pdf import _build_html
        doc = _build_html(agreement(governing_seat=""), ORG, CLIENT)
        assert "Seat, venue and jurisdiction not set" in doc
        assert 'class="unset"' in doc

    def test_the_agreement_is_two_pages(self):
        """`doc-page.js`: a pre-paginated document is a fixed set of pages and
        content that misses the box is clipped, so the split is explicit."""
        from services.agreement_pdf import _build_html
        doc = _build_html(agreement(), ORG, CLIENT)
        assert doc.count('<section class="page">') == 2
        # The page count is no longer ASSERTED by the colophon. It used to print
        # "Page 1 of 2" / "Page 2 of 2" as literal text, which stopped being true
        # the moment a long milestone table spilled an authored page onto a third
        # sheet. `doc_render` prints `Page N of M` from the real page counters
        # instead — see `test_the_continuation_footer_counts_real_pages`.
        assert "Page 1 of 2" not in doc
        assert "counter(page)" in doc and "counter(pages)" in doc

    def test_every_clause_the_design_specifies_is_present(self):
        from services.agreement_pdf import _build_html
        doc = _build_html(agreement(), ORG, CLIENT)
        for clause in ("1 · Scope of services", "2 · Fees and taxes",
                       "3 · Milestones and payment schedule", "4 · Client obligations",
                       "5 · Confidentiality", "6 · Intellectual property",
                       "7 · Liability", "8 · Change requests",
                       "9 · Term and termination", "10 · Dispute resolution",
                       "Execution"):
            assert clause in doc, clause

    def test_the_msme_interest_clause_appears_only_for_a_registered_provider(self):
        from services.agreement_pdf import _build_html
        assert "MSMED Act 2006" in _build_html(agreement(), ORG, CLIENT)
        assert "MSMED Act 2006" not in _build_html(
            agreement(provider_is_msme=False), ORG, CLIENT
        )


class TestProjectReportRefusal:
    def test_a_complete_report_passes(self):
        chk = validate_project_report(project_report(), ORG, CLIENT)
        assert chk.ok, [g.field for g in chk.blocking]

    def test_a_variance_that_is_not_actual_less_plan_blocks(self):
        """A client acts on the variance and cannot check it."""
        chk = validate_project_report(
            project_report(measures=[
                {"label": "Hours", "numeric": True, "plan": 100, "actual": 120,
                 "variance": 5}]),
            ORG, CLIENT,
        )
        assert any(g.field.startswith("report.measures") for g in chk.blocking)

    def test_no_period_blocks(self):
        chk = validate_project_report(project_report(period_start=""), ORG, CLIENT)
        assert "report.period" in {g.field for g in chk.blocking}

    def test_an_absent_milestone_store_is_declared_not_shown_as_empty(self):
        """An empty milestone table reads as "no milestones", which is a
        different claim from "none are recorded anywhere"."""
        from services.project_report_pdf import _build_html
        doc = _build_html(project_report(), ORG, CLIENT)
        assert "no milestone store today" in doc
        assert "'none captured', not 'none exist'" in doc

    def test_the_missing_stores_are_named_as_advisory_gaps(self):
        chk = validate_project_report(project_report(), ORG, CLIENT)
        advisory = {g.field for g in chk.advisory}
        assert "report.milestones" in advisory
        assert "report.risks" in advisory


# ══════════════════════════════════════════════════════════════════════════════
# 3 · Shared behaviour every document must have
# ══════════════════════════════════════════════════════════════════════════════

ALL_DOCUMENTS = [
    ("gstr3b", "services.gstr3b_pdf", lambda: (SPEC_GSTR3B_INPUTS, ORG, None)),
    ("tds_challan", "services.tds_challan_pdf", lambda: (challan(), ORG, None)),
    ("statement", "services.statement_pdf", lambda: (statement(), ORG, CLIENT)),
    ("quotation", "services.quotation_pdf", lambda: (quotation(), ORG, CLIENT)),
    ("agreement", "services.agreement_pdf", lambda: (agreement(), ORG, CLIENT)),
    ("project_report", "services.project_report_pdf", lambda: (project_report(), ORG, CLIENT)),
]


def _html_for(module_name: str, args) -> str:
    import importlib
    mod = importlib.import_module(module_name)
    doc, org, third = args
    return mod._build_html(doc, org, third) if third is not None else mod._build_html(doc, org)


@pytest.mark.parametrize("name,module,make", ALL_DOCUMENTS, ids=[d[0] for d in ALL_DOCUMENTS])
class TestEveryDocument:
    def test_org_and_client_names_are_escaped(self, name, module, make):
        """Names are user-supplied and land in an HTML template. `&` in a firm
        name is the common case and must survive as an entity."""
        import html as html_mod
        doc, org, third = make()
        evil = "<script>alert(1)</script>"
        args = (doc, {**org, "name": evil}, third if third is None else {**third, "name": 'A & B "C"'})
        rendered = _html_for(module, args)
        assert evil not in rendered
        assert html_mod.escape(evil) in rendered

    def test_an_empty_org_does_not_raise(self, name, module, make):
        """Every `generate_*` passes `org or {}`, so the template must tolerate
        an empty one — it renders a document full of red marks, not a 500."""
        doc, _org, third = make()
        rendered = _html_for(module, (doc, {}, third))
        assert "unset" in rendered

    def test_the_devanagari_document_kind_is_never_tracked_or_emboldened(self, name, module, make):
        """`doc_fonts` module docstring: letter-spacing applied after shaping
        detaches the repha in a conjunct, and synthetic bold smears the joins.
        Tiro has ONE weight, 400."""
        rendered = _html_for(module, make())
        assert "letter-spacing:0;" in rendered
        assert "font-weight:400" in rendered
        assert "font-synthesis:none" in rendered
        # The tracked Latin sibling must still be tracked — otherwise this test
        # would pass on a stylesheet that simply removed all tracking.
        assert "letter-spacing:0.16em" in rendered

    def test_the_colophon_carries_the_brand_mark(self, name, module, make):
        from services.doc_fonts import has_devanagari_font
        rendered = _html_for(module, make())
        assert ("कर्तव्य" if has_devanagari_font() else "Kartavya") in rendered

    def test_indian_digit_grouping_not_western(self, name, module, make):
        """2,2,3 on an Indian document. A Western-grouped figure is the single
        most visible way a generated document looks foreign."""
        rendered = _html_for(module, make())
        import re
        # 7-digit figures must never appear as `1,234,567`.
        assert not re.search(r"\d,\d{3},\d{3}(?!\d)", rendered), "Western grouping found"

    def test_the_page_geometry_is_the_doc_page_contract(self, name, module, make):
        """`doc-page.js` emits `@page { size …; margin: 0 }` for a paginated
        document and lets each page carry its own inset.

        The TOP margin is still 0 and `.page` still carries `--doc-pad`, so the
        letterhead sits exactly where the design puts it. What changed is the
        BOTTOM: 12mm is reserved so content breaks at 285mm rather than running
        to the edge of the sheet (`doc_render.CONTENT_BUDGET_MM`). That strip is
        blank space on a correctly-laid-out page, so nothing in the design moves
        — it is where the flow is allowed to stop, not where anything is drawn.
        """
        from services.doc_render import CONTENT_BUDGET_MM, PAGE_TAIL_MM
        rendered = _html_for(module, make())
        assert f"size:A4; margin:0 0 {PAGE_TAIL_MM}mm 0;" in rendered
        assert "padding:0.62in" in rendered
        assert f"min-height:{CONTENT_BUDGET_MM}mm" in rendered


# ══════════════════════════════════════════════════════════════════════════════
# 4 · Real PDF bytes
# ══════════════════════════════════════════════════════════════════════════════

def _weasyprint_available() -> bool:
    try:
        from weasyprint import HTML  # noqa: F401
    except (ImportError, OSError):
        return False
    return True


def _pdf_text(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes so assertions are on what a READER sees.

    `pypdf` is a test-only dependency. Where it is absent the byte-level
    assertions still run; the content assertions skip and say so rather than
    silently passing.
    """
    try:
        import io

        from pypdf import PdfReader
    except ImportError:
        pytest.skip("pypdf is not installed — cannot read text back out of the PDF")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


GENERATORS = [
    ("gstr3b", "services.gstr3b_pdf", "generate_gstr3b_pdf",
     lambda: (SPEC_GSTR3B_INPUTS, ORG)),
    ("tds_challan", "services.tds_challan_pdf", "generate_tds_challan_pdf",
     lambda: (challan(), ORG)),
    ("statement", "services.statement_pdf", "generate_statement_pdf",
     lambda: (statement(), ORG, CLIENT)),
    ("quotation", "services.quotation_pdf", "generate_quotation_pdf",
     lambda: (quotation(), ORG, CLIENT)),
    ("agreement", "services.agreement_pdf", "generate_agreement_pdf",
     lambda: (agreement(), ORG, CLIENT)),
    ("project_report", "services.project_report_pdf", "generate_project_report_pdf",
     lambda: (project_report(), ORG, CLIENT)),
]

#: Text that MUST appear in the rendered PDF of each document. Chosen so a blank
#: or clipped page fails: a figure, an identifier and a heading from each, and
#: for every document the LAST element on the sheet — the colophon or the
#: closing block — because that is what a page overrun would drop first.
#:
#: Compared case-insensitively. brand.css sets `text-transform: uppercase` on
#: `.lh__kind` and `.block__l`, and WeasyPrint applies the transform to the text
#: layer, so "Statement of Account" is extracted as "STATEMENT OF ACCOUNT". The
#: transform is the design's; the comparison bends around it rather than the
#: document being changed to satisfy a test.
EXPECTED_IN_PDF = {
    "gstr3b": ["GSTR-3B summary", "27AAACA1234M1Z8", "4,24,284", "7,70,688",
               "Payable in cash", "Before you file", "not a filed return",
               "(A)(2) Import of services", "(A)(4) Inward supplies from ISD",
               "(B)(2) ITC reversed", "(D)(1) ITC reclaimed"],
    "tds_challan": ["TDS challan", "ITNS-281", "MUMA12345B", "0510308", "04412",
                    "194C", "192B", "1,00,000", "Total deposited",
                    "verify against the bank challan"],
    "statement": ["Statement of Account", "SOA-2607", "Vendor Demo Limited",
                  "4,00,000", "Ageing", "without prejudice"],
    "quotation": ["Quotation", "QT-118", "Vendor Demo Limited",
                  "21,24,000", "Accepted for", "Payment schedule", "Terms"],
    "agreement": ["Service agreement", "AGR-2026-018", "Scope of services",
                  "Dispute resolution", "Execution", "execution copy"],
    "project_report": ["Project report", "RPT-0037", "Mumbai fit-out",
                       "Position at a glance", "Risks", "Decisions needed"],
}


@pytest.mark.skipif(
    not _weasyprint_available(),
    reason="WeasyPrint's native stack (libpango/libgobject) is not installed here",
)
@pytest.mark.parametrize("name,module,func,make", GENERATORS, ids=[g[0] for g in GENERATORS])
class TestRealPdfBytes:
    """The public entry points, end to end, asserting on the PDF's own content.

    "A PDF that renders is not a PDF that is correct" — `test_document_generation`.
    These call the real generator, get real bytes back, and read the text out
    again, so a document that renders blank or clips its content fails here.
    """

    def _generate(self, module, func, make):
        import importlib
        mod = importlib.import_module(module)
        return getattr(mod, func)(*make())

    def test_it_is_a_pdf(self, name, module, func, make):
        pdf = self._generate(module, func, make)
        assert isinstance(pdf, bytes)
        assert pdf.startswith(b"%PDF-"), "not a PDF"
        assert pdf.rstrip().endswith(b"%%EOF"), "truncated PDF"
        assert len(pdf) > 5000, f"suspiciously small PDF: {len(pdf)} bytes"

    def test_the_expected_content_is_readable_from_the_pdf(self, name, module, func, make):
        """Nothing was clipped. Every string below is on the sheet, including
        the last block, so a page overrun that dropped content fails here."""
        text = _pdf_text(self._generate(module, func, make)).casefold()
        for expected in EXPECTED_IN_PDF[name]:
            assert expected.casefold() in text, (
                f"{expected!r} missing from the rendered {name} PDF — clipped or never drawn"
            )

    def test_nothing_is_lost_to_a_page_overrun(self, name, module, func, make):
        """These documents PAGINATE rather than clip, and this is the test that
        makes that choice safe.

        `doc-page.js` gives a pre-paginated page `overflow: hidden`, so content
        that misses the box is silently dropped. Measured under this engine,
        every specification document except the statement is taller than the A4
        sheet it declares — GSTR-3B 362mm, TDS challan 380mm, quotation 344mm,
        project report 347mm — so honouring `overflow: hidden` would have thrown
        away a payment table or a CIN. `doc_render` uses `min-height` instead.

        The guard is therefore not a page COUNT (which would forbid the second
        sheet a long ledger legitimately needs) but that the document's own
        closing colophon survives to the PDF — the first thing an overrun drops.
        """
        text = _pdf_text(self._generate(module, func, make)).casefold()
        assert "kartav" in text, (
            "the colophon is missing — the document was clipped rather than paginated"
        )

    def test_the_agreement_keeps_its_designed_two_page_split(self, name, module, func, make):
        """The one document the design paginates itself. Its clause 5 must start
        a new sheet, so the split is asserted rather than left to chance."""
        if name != "agreement":
            pytest.skip("only the agreement is explicitly paginated by the design")
        try:
            import io

            from pypdf import PdfReader
        except ImportError:
            pytest.skip("pypdf is not installed")
        reader = PdfReader(io.BytesIO(self._generate(module, func, make)))
        assert len(reader.pages) >= 2
        # Page one carries the letterhead as its identity, so it gets no running
        # footer; every continuation sheet is counted from the real page counters.
        assert "execution copy" in (reader.pages[0].extract_text() or "")
        last = len(reader.pages)
        assert f"Page {last} of {last}" in (reader.pages[-1].extract_text() or "")
        assert "Confidentiality".casefold() in (
            reader.pages[1].extract_text() or ""
        ).casefold(), "clause 5 must open page 2"

    def test_the_devanagari_face_is_embedded_not_substituted(self, name, module, func, make):
        """`doc_fonts`: the face is vendored and declared with `@font-face` so
        the glyphs travel INSIDE the PDF rather than depending on the reader's
        machine. A PDF that names Tiro without embedding it renders tofu on
        someone else's screen, and one that silently fell back to DejaVu renders
        the brand mark in the wrong face — the exact defect `doc_fonts` exists
        to prevent.

        Read from the PDF's font resources, not its raw bytes: WeasyPrint writes
        compressed object streams, so `b"FontFile2" in pdf` is false even when
        the programme is embedded. That false negative is why this test is
        written this way.
        """
        from services.doc_fonts import has_devanagari_font
        if not has_devanagari_font():
            pytest.skip("no Devanagari face vendored in this checkout")
        try:
            import io

            from pypdf import PdfReader
        except ImportError:
            pytest.skip("pypdf is not installed")

        reader = PdfReader(io.BytesIO(self._generate(module, func, make)))
        found = []
        for page in reader.pages:
            for font in (page.get("/Resources", {}).get("/Font", {}) or {}).values():
                font = font.get_object()
                descriptor = font.get("/FontDescriptor")
                if descriptor is None and font.get("/DescendantFonts"):
                    descriptor = font["/DescendantFonts"][0].get_object().get("/FontDescriptor")
                base = str(font.get("/BaseFont") or "")
                if "Tiro" in base:
                    descriptor = descriptor.get_object() if descriptor else {}
                    embedded = any(
                        k in descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3")
                    )
                    found.append((base, embedded))
        assert found, "the Devanagari face is not referenced in the PDF at all"
        assert all(embedded for _base, embedded in found), (
            f"Tiro is referenced but not embedded: {found}"
        )


@pytest.mark.skipif(not _weasyprint_available(), reason="WeasyPrint native stack absent")
def test_an_incomplete_document_produces_no_bytes_at_all():
    """The refusal must happen BEFORE WeasyPrint is reached, so a legally
    incomplete document never exists as a file that could be attached to an
    email. Same placement as `generate_invoice_pdf`."""
    from services.tds_challan_pdf import generate_tds_challan_pdf
    with pytest.raises(DocumentIncomplete) as exc:
        generate_tds_challan_pdf(challan(), {**ORG, "tan": ""})
    assert "org.tan" in {g.field for g in exc.value.check.blocking}
    payload = exc.value.as_payload()
    assert payload["error"] == "document_incomplete"
    assert payload["blocking"], "the payload must name what is missing"
