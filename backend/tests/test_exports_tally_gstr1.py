"""The two data exports — Tally voucher XML and GSTR-1 outward-supply JSON.

These are EXPORTS, not documents: the firm's own data handed to the firm's own
software. Nothing here files, uploads or asserts a tax liability, and there is
no test for a filing path because there is no filing path.

What is actually pinned:

  * **Tally vouchers balance to exactly zero.** Tally rejects the WHOLE file
    when one voucher is out by a paisa, so this is not a nicety — it is the
    difference between a firm importing a month and importing nothing. Tested
    on amounts chosen to force a rounding residue.
  * **Nothing is invented.** A document that cannot be exported truthfully is
    held back and NAMED, never folded into a neighbouring bucket where it would
    read as a smaller number rather than a missing one.
  * **A section that cannot be filled is absent, not empty.** `"cdnr": []`
    reads as "there were no credit notes" to whoever files from it.

Amounts are deliberately synthetic and obviously so.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from middleware.org_resolver import get_org_id
from services.gstin import compute_check_digit
from services.gstr1_json import build_gstr1, fp, parse_state_code, uqc
from services.tally_xml import ZERO, build_tally_xml, dec2, load_line_items

pytestmark = pytest.mark.anyio

DOCS = "/api/v1/documents"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _gstin(prefix: str) -> str:
    """A structurally valid GSTIN with a correct check digit, for fixtures."""
    return prefix + compute_check_digit(prefix)


BUYER_GJ = _gstin("24AAACM1234C1Z")     # Gujarat, registered
BUYER_MH = _gstin("27AAACN4321B1Z")     # Maharashtra, registered
SUPPLIER = _gstin("24AAACS5555S1Z")     # our org, Gujarat


def _lines(*specs, double_encode: bool = False) -> str:
    """Line items in the column's own shape.

    `double_encode=True` reproduces what the LIVE database actually holds: a
    jsonb STRING containing JSON rather than a jsonb array, on 10 of 10 rows.
    """
    items = [
        {"description": d, "hsn_code": hsn, "sac_code": "", "quantity": qty,
         "unit": unit, "rate": rate, "gst_rate": rate_pct, "discount_pct": 0,
         "line_total": total, "gst_amount": tax}
        for (d, hsn, qty, unit, rate, rate_pct, total, tax) in specs
    ]
    once = json.dumps(items)
    return json.dumps(once) if double_encode else once


def invoice(**over) -> dict:
    row = {
        "invoice_number": "INV-2026-0001", "invoice_type": "tax_invoice",
        "invoice_date": "2026-07-17", "is_igst": False, "is_export": False,
        "line_items": _lines(("Advisory", "998311", 1, "NOS", 1000, 18, 1000.00, 180.00)),
        "subtotal": Decimal("1000.00"), "cgst": Decimal("90.00"),
        "sgst": Decimal("90.00"), "igst": ZERO, "cess": ZERO,
        "discount": ZERO, "total": Decimal("1180.00"), "currency": "INR",
        "place_of_supply": "Gujarat", "supply_nature": "taxable",
        "doc_status": "final", "payment_status": "unpaid", "cancelled_at": None,
        "is_active": True, "contact_name": "A Buyer",
        "contact_company": "Buyer Traders LLP", "contact_gstin": BUYER_GJ,
    }
    row.update(over)
    return row


def bill(**over) -> dict:
    """A vendor bill row **as the table actually stores one**.

    Deliberately carries NO `is_igst` key: `staging.ganit_vendor_bills` has no
    such column. `VendorBillCreate` has the field, which is where the wrong
    assumption comes from — it is an input that decides the split and is then
    discarded.
    """
    row = {
        "bill_number": "SUP/1", "internal_ref": "VB-2026-0001",
        "bill_date": "2026-07-19",
        "line_items": _lines(("Print", "4911", 1, "BOX", 500, 12, 500.00, 60.00)),
        "subtotal": Decimal("500.00"), "cgst": ZERO, "sgst": ZERO,
        "igst": Decimal("60.00"), "cess": ZERO, "total": Decimal("560.00"),
        "currency": "INR", "is_reverse_charge": False,
        "vendor_name": "A Vendor Works", "vendor_gstin": BUYER_MH,
    }
    row.update(over)
    return row


ORG = {"name": "Test Advisory LLP", "gstin": SUPPLIER, "state_code": "24"}


def _vouchers(xml: str) -> list[ET.Element]:
    return list(ET.fromstring(xml).iter("VOUCHER"))


def _legs(voucher: ET.Element) -> list[tuple[str, Decimal, str]]:
    return [
        (e.findtext("LEDGERNAME"), Decimal(e.findtext("AMOUNT")),
         e.findtext("ISDEEMEDPOSITIVE"))
        for e in voucher.iter("ALLLEDGERENTRIES.LIST")
    ]


# ══════════════════════════════════════════════════════════════════════════════
# Tally — the balance property
# ══════════════════════════════════════════════════════════════════════════════

def test_the_file_is_well_formed_xml_with_the_import_envelope():
    xml, _ = build_tally_xml([invoice()], [bill()], ORG)
    root = ET.fromstring(xml)
    assert root.tag == "ENVELOPE"
    assert root.findtext("HEADER/TALLYREQUEST") == "Import Data"
    assert root.findtext("BODY/IMPORTDATA/REQUESTDESC/REPORTNAME") == "Vouchers"
    assert len(root.findall("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE")) == 2


@pytest.mark.parametrize("subtotal,cgst,sgst,discount,total", [
    # Clean.
    ("1000.00", "90.00", "90.00", "0", "1180.00"),
    # A header total that does NOT equal subtotal + tax - discount. Real rows
    # drift like this after an edit, and an exporter that trusted the arithmetic
    # would emit an unbalanced voucher and cost the firm the whole import.
    ("1000.00", "90.00", "90.00", "0", "1180.01"),
    ("333.33", "30.00", "30.00", "0.01", "393.32"),
    ("0.01", "0.00", "0.00", "0", "0.01"),
])
def test_every_sales_voucher_balances_to_exactly_zero(subtotal, cgst, sgst, discount, total):
    xml, manifest = build_tally_xml(
        [invoice(subtotal=Decimal(subtotal), cgst=Decimal(cgst), sgst=Decimal(sgst),
                 discount=Decimal(discount), total=Decimal(total))],
        [], ORG,
    )
    assert manifest["held_back"] == []
    for voucher in _vouchers(xml):
        assert sum((amount for _, amount, _ in _legs(voucher)), Decimal("0")) == Decimal("0")


def test_a_residue_is_booked_to_round_off_rather_than_dropped():
    """The paisa goes somewhere a reader can see, which is what Tally does too.

    The party is debited 1180.01 against 1180.00 of credits, so the balancing
    entry is a CREDIT of 0.01 — positive, under Tally's sign convention.
    """
    xml, _ = build_tally_xml([invoice(total=Decimal("1180.01"))], [], ORG)
    ledgers = {name: amount for name, amount, _ in _legs(_vouchers(xml)[0])}
    assert ledgers["Round Off"] == Decimal("0.01")

    # …and the mirror case, where the credits exceed the debit.
    xml, _ = build_tally_xml([invoice(total=Decimal("1179.99"))], [], ORG)
    ledgers = {name: amount for name, amount, _ in _legs(_vouchers(xml)[0])}
    assert ledgers["Round Off"] == Decimal("-0.01")


def test_purchase_vouchers_balance_and_debit_the_expense():
    xml, manifest = build_tally_xml([], [bill()], ORG)
    assert manifest["purchase_count"] == 1
    legs = _legs(_vouchers(xml)[0])
    assert sum((amount for _, amount, _ in legs), Decimal("0")) == Decimal("0")
    by_name = {name: (amount, deemed) for name, amount, deemed in legs}
    # Vendor credited, purchase and input tax debited.
    assert by_name["A Vendor Works"] == (Decimal("560.00"), "No")
    assert by_name["Purchase"] == (Decimal("-500.00"), "Yes")
    assert by_name["Input IGST"] == (Decimal("-60.00"), "Yes")


def test_a_bill_is_classified_by_the_tax_heads_it_carries_not_by_a_flag():
    """`ganit_vendor_bills` has NO `is_igst` column — verified, not assumed.

    The heads the bill actually carries are what the row records, so they are
    what decides the ledger pair. Nothing here may read `is_igst` off a bill.
    """
    intra = bill(cgst=Decimal("30.00"), sgst=Decimal("30.00"), igst=ZERO)
    xml, _ = build_tally_xml([], [intra], ORG)
    names = {name for name, _, _ in _legs(_vouchers(xml)[0])}
    assert {"Input CGST", "Input SGST"} <= names
    assert "Input IGST" not in names

    xml, _ = build_tally_xml([], [bill()], ORG)     # the default is IGST-only
    names = {name for name, _, _ in _legs(_vouchers(xml)[0])}
    assert "Input IGST" in names and "Input CGST" not in names


def test_a_bill_carrying_both_igst_and_state_tax_is_held_back():
    _xml, manifest = build_tally_xml(
        [], [bill(igst=Decimal("60.00"), cgst=Decimal("30.00"))], ORG,
    )
    assert manifest["voucher_count"] == 0
    assert "cannot be both" in manifest["held_back"][0]["reason"]


def test_the_vendor_bill_query_selects_no_column_the_table_lacks():
    """A guard for the failure that produced this test.

    `is_igst` looks like it should be on a vendor bill and is not, and a mocked
    pool will never notice — `mock_pool.fetch` returns whatever the test hands
    it, whatever the SELECT asked for. So the column list is asserted directly.
    """
    from routers.documents import _TALLY_BILL_COLS

    assert "is_igst" not in _TALLY_BILL_COLS
    # …and the sales query, whose table DOES have the column, still reads it.
    from routers.documents import _TALLY_INVOICE_COLS

    assert "i.is_igst" in _TALLY_INVOICE_COLS


def test_debit_is_negative_and_deemed_positive_yes():
    """Tally's convention, which is the opposite of the intuitive one."""
    xml, _ = build_tally_xml([invoice()], [], ORG)
    for _name, amount, deemed in _legs(_vouchers(xml)[0]):
        assert (deemed == "Yes") == (amount < 0), "ISDEEMEDPOSITIVE must track the sign"


# ══════════════════════════════════════════════════════════════════════════════
# Tally — what is and is not a voucher
# ══════════════════════════════════════════════════════════════════════════════

def test_a_credit_note_reverses_every_leg_of_a_sale():
    xml, manifest = build_tally_xml(
        [invoice(invoice_number="CN-2026-0001", invoice_type="credit_note")], [], ORG,
    )
    assert manifest["credit_note_count"] == 1
    voucher = _vouchers(xml)[0]
    assert voucher.findtext("VOUCHERTYPENAME") == "Credit Note"
    by_name = {name: amount for name, amount, _ in _legs(voucher)}
    assert by_name["Buyer Traders LLP"] > 0, "the party is CREDITED on a credit note"
    assert by_name["Sales"] < 0, "revenue is DEBITED back out"
    assert by_name["Output CGST"] < 0


@pytest.mark.parametrize("inv_type", ["quotation", "proforma"])
def test_an_offer_is_never_booked_as_a_transaction(inv_type):
    """A quotation in the ledger is revenue that was never invoiced."""
    xml, manifest = build_tally_xml([invoice(invoice_type=inv_type)], [], ORG)
    assert manifest["voucher_count"] == 0
    assert _vouchers(xml) == []


def test_an_invoice_with_no_party_is_held_back_and_named():
    _xml, manifest = build_tally_xml(
        [invoice(contact_name=None, contact_company=None)], [], ORG,
    )
    assert manifest["voucher_count"] == 0
    assert manifest["held_back"][0]["document"] == "INV-2026-0001"
    assert "party ledger" in manifest["held_back"][0]["reason"]


def test_tax_heads_that_contradict_the_igst_flag_hold_the_row_back():
    """An IGST invoice carrying CGST disagrees with itself.

    Booking it either way would move real tax to a head the invoice does not
    claim, so it is named instead.
    """
    _xml, manifest = build_tally_xml(
        [invoice(is_igst=True, igst=Decimal("180.00"),
                 cgst=Decimal("90.00"), sgst=ZERO)], [], ORG,
    )
    assert manifest["voucher_count"] == 0
    assert "disagrees with itself" in manifest["held_back"][0]["reason"]


def test_the_igst_flag_chooses_the_ledger_pair_and_is_not_re_derived():
    """Even when the place of supply says otherwise, the stored flag wins."""
    xml, _ = build_tally_xml(
        [invoice(is_igst=True, igst=Decimal("180.00"), cgst=ZERO, sgst=ZERO,
                 place_of_supply="Gujarat")], [], ORG,
    )
    names = {name for name, _, _ in _legs(_vouchers(xml)[0])}
    assert "Output IGST" in names
    assert "Output CGST" not in names and "Output SGST" not in names


def test_a_foreign_currency_document_is_held_back_not_booked_at_face_value():
    _xml, manifest = build_tally_xml([invoice(currency="USD")], [], ORG)
    assert manifest["voucher_count"] == 0
    assert "USD" in manifest["held_back"][0]["reason"]


def test_the_file_says_on_its_face_what_it_is():
    xml, _ = build_tally_xml([invoice()], [], ORG)
    head = xml[:xml.index("<ENVELOPE>")]
    assert "not a return" in head
    assert "not a GSP" in head
    assert "DATA EXPORTED FOR YOUR OWN ACCOUNTING SOFTWARE" in head
    # An unescaped `--` inside a comment is not well-formed XML.
    ET.fromstring(xml)


def test_held_back_documents_are_named_in_the_file_itself():
    xml, _ = build_tally_xml([invoice(contact_name=None, contact_company=None),
                              invoice(invoice_number="INV-2026-0002")], [], ORG)
    head = xml[:xml.index("<ENVELOPE>")]
    assert "HELD BACK" in head and "INV-2026-0001" in head


# ══════════════════════════════════════════════════════════════════════════════
# The double-encoded column
# ══════════════════════════════════════════════════════════════════════════════

def test_line_items_decode_whether_single_or_double_encoded():
    """The live column holds a jsonb STRING containing JSON, on every row.

    A single `json.loads` on that yields a STRING, and iterating it walks
    characters — producing a voucher with one leg per letter rather than an
    error anyone would notice.
    """
    spec = ("Advisory", "998311", 1, "NOS", 1000, 18, 1000.00, 180.00)
    for raw in (_lines(spec), _lines(spec, double_encode=True)):
        items = load_line_items(raw)
        assert isinstance(items, list) and len(items) == 1
        assert items[0]["description"] == "Advisory"

    assert load_line_items(None) == []
    assert load_line_items("not json") == []
    assert load_line_items('"[]"') == []


def test_a_double_encoded_row_still_produces_a_balanced_voucher():
    xml, manifest = build_tally_xml(
        [invoice(line_items=_lines(
            ("Advisory", "998311", 1, "NOS", 1000, 18, 1000.00, 180.00),
            double_encode=True))], [], ORG,
    )
    assert manifest["voucher_count"] == 1
    assert "Advisory" in _vouchers(xml)[0].findtext("NARRATION")


@pytest.mark.parametrize("raw,expected", [
    (None, "0.00"), ("", "0.00"), (Decimal("1.005"), "1.01"), (1.005, "1.01"),
    ("2.345", "2.35"), (7, "7.00"), ("nonsense", "0.00"), (float("nan"), "0.00"),
])
def test_rupees_are_rounded_once_half_up(raw, expected):
    assert dec2(raw) == Decimal(expected)


# ══════════════════════════════════════════════════════════════════════════════
# GSTR-1 — sections
# ══════════════════════════════════════════════════════════════════════════════

def test_a_registered_buyer_lands_in_b2b_with_the_recorded_place_of_supply():
    payload, manifest = build_gstr1([invoice()], ORG, "2026-07")
    assert payload["gstin"] == SUPPLIER
    assert payload["fp"] == "072026"
    entry = payload["b2b"][0]
    assert entry["ctin"] == BUYER_GJ
    inv = entry["inv"][0]
    assert inv["inum"] == "INV-2026-0001"
    assert inv["idt"] == "17-07-2026"
    assert inv["pos"] == "24"
    assert inv["itms"][0]["itm_det"] == {
        "rt": 18, "txval": 1000.0, "camt": 90.0, "samt": 90.0, "csamt": 0.0,
    }
    assert manifest["b2b_count"] == 1


def test_an_unregistered_buyer_is_aggregated_into_b2cs():
    payload, _ = build_gstr1([invoice(contact_gstin=None)], ORG, "2026-07")
    assert "b2b" not in payload
    row = payload["b2cs"][0]
    assert row["sply_ty"] == "INTRA" and row["pos"] == "24" and row["typ"] == "OE"
    assert row["txval"] == 1000.0 and row["camt"] == 90.0


def test_b2cl_takes_inter_state_unregistered_supplies_above_the_threshold():
    big = invoice(
        contact_gstin=None, is_igst=True, place_of_supply="Maharashtra (27)",
        line_items=_lines(("Advisory", "998311", 1, "NOS", 300000, 18, 300000.00, 54000.00)),
        subtotal=Decimal("300000.00"), cgst=ZERO, sgst=ZERO, igst=Decimal("54000.00"),
        total=Decimal("354000.00"),
    )
    payload, _ = build_gstr1([big], ORG, "2026-07")
    assert payload["b2cl"][0]["pos"] == "27"
    assert payload["b2cl"][0]["inv"][0]["val"] == 354000.0
    assert "b2cs" not in payload


def test_the_same_supply_below_the_threshold_is_b2cs_not_b2cl():
    small = invoice(contact_gstin=None, is_igst=True, place_of_supply="Maharashtra",
                    igst=Decimal("180.00"), cgst=ZERO, sgst=ZERO)
    payload, _ = build_gstr1([small], ORG, "2026-07")
    assert "b2cl" not in payload
    assert payload["b2cs"][0]["sply_ty"] == "INTER"
    assert payload["b2cs"][0]["iamt"] == 180.0


def test_sections_with_no_rows_are_absent_rather_than_empty():
    """`"cdnr": []` reads as 'there were no credit notes' to whoever files."""
    payload, manifest = build_gstr1([invoice()], ORG, "2026-07")
    for absent in ("b2cl", "b2cs", "cdnr", "cdnur", "exp", "nil", "at"):
        assert absent not in payload
    assert set(manifest["sections_emitted"]) == {"b2b", "hsn", "doc_issue"}


def test_cdnr_is_never_emitted_and_the_reason_travels_with_the_manifest():
    payload, manifest = build_gstr1(
        [invoice(invoice_number="CN-2026-0001", invoice_type="credit_note")], ORG, "2026-07",
    )
    assert "cdnr" not in payload
    reasons = {s["section"]: s["reason"] for s in manifest["sections_omitted"]}
    assert "cdnr" in reasons and "no link" in reasons["cdnr"].lower()


def test_a_credit_note_is_never_reported_as_a_positive_b2b_supply():
    """The one way omitting cdnr could become a wrong NUMBER instead of a gap."""
    payload, manifest = build_gstr1(
        [invoice(),
         invoice(invoice_number="CN-2026-0001", invoice_type="credit_note")],
        ORG, "2026-07",
    )
    assert len(payload["b2b"][0]["inv"]) == 1
    assert payload["b2b"][0]["inv"][0]["inum"] == "INV-2026-0001"
    assert manifest["credit_debit_notes_not_in_file"] == ["CN-2026-0001 (credit note)"]


def test_the_hsn_summary_carries_a_valid_uqc_and_reconciles():
    payload, _ = build_gstr1([invoice()], ORG, "2026-07")
    row = payload["hsn"]["data"][0]
    assert row["hsn_sc"] == "998311" and row["uqc"] == "NOS"
    assert row["txval"] == 1000.0 and row["camt"] == 90.0 and row["samt"] == 90.0


def test_doc_issue_reports_a_contiguous_series_and_holds_back_a_gapped_one():
    contiguous = [invoice(invoice_number=f"INV-2026-{n:04d}") for n in (1, 2, 3)]
    payload, _ = build_gstr1(contiguous, ORG, "2026-07")
    docs = payload["doc_issue"]["doc_det"][0]["docs"][0]
    assert docs == {"num": 1, "from": "INV-2026-0001", "to": "INV-2026-0003",
                    "totnum": 3, "cancel": 0, "net_issue": 3}

    gapped = [invoice(invoice_number=f"INV-2026-{n:04d}") for n in (1, 2, 9)]
    payload, manifest = build_gstr1(gapped, ORG, "2026-07")
    assert "doc_issue" not in payload
    assert any("series has gaps" in h["reason"] for h in manifest["held_back"])


def test_a_cancelled_number_is_counted_in_the_series_not_skipped():
    rows = [invoice(invoice_number=f"INV-2026-{n:04d}") for n in (1, 2)]
    rows[1]["cancelled_at"] = "2026-07-20T00:00:00+00:00"
    payload, _ = build_gstr1(rows, ORG, "2026-07")
    docs = payload["doc_issue"]["doc_det"][0]["docs"][0]
    assert docs["totnum"] == 2 and docs["cancel"] == 1 and docs["net_issue"] == 1


# ══════════════════════════════════════════════════════════════════════════════
# GSTR-1 — what is held back
# ══════════════════════════════════════════════════════════════════════════════

def test_a_counterparty_gstin_that_fails_its_check_digit_is_held_back():
    payload, manifest = build_gstr1(
        [invoice(contact_gstin="24AAACM1234C1Z9")], ORG, "2026-07",
    )
    assert "b2b" not in payload
    assert "check digit" in manifest["held_back"][0]["reason"]


def test_a_line_with_no_hsn_or_sac_holds_the_invoice_back():
    payload, manifest = build_gstr1(
        [invoice(line_items=_lines(("Advisory", "", 1, "NOS", 1000, 18, 1000.00, 180.00)))],
        ORG, "2026-07",
    )
    assert "b2b" not in payload
    assert "46(g)" in manifest["held_back"][0]["reason"]


def test_an_intra_state_supply_falls_back_to_the_suppliers_own_state():
    """`is_igst = false` MEANS supplied in the supplier's state; not a new rule."""
    payload, _ = build_gstr1([invoice(place_of_supply="")], ORG, "2026-07")
    assert payload["b2b"][0]["inv"][0]["pos"] == "24"


def test_an_inter_state_supply_with_no_place_of_supply_is_held_back():
    """The flag says 'elsewhere' and says nothing about where. Nothing to infer."""
    payload, manifest = build_gstr1(
        [invoice(place_of_supply="", is_igst=True, igst=Decimal("180.00"),
                 cgst=ZERO, sgst=ZERO)], ORG, "2026-07",
    )
    assert "b2b" not in payload
    assert "no place of supply" in manifest["held_back"][0]["reason"]


def test_lines_that_disagree_with_the_header_beyond_rounding_are_held_back():
    payload, manifest = build_gstr1(
        [invoice(cgst=Decimal("500.00"), sgst=Decimal("500.00"))], ORG, "2026-07",
    )
    assert "b2b" not in payload
    assert "more than rounding" in manifest["held_back"][0]["reason"]


def test_a_half_paisa_disagreement_is_tolerated_and_still_ties_out():
    payload, manifest = build_gstr1(
        [invoice(cgst=Decimal("90.30"), sgst=Decimal("90.00"))], ORG, "2026-07",
    )
    assert "b2b" in payload
    assert manifest["reconciliation"]["tax_difference"] == pytest.approx(-0.3)


@pytest.mark.parametrize("over,fragment", [
    ({"is_export": True}, "export"),
    ({"supply_nature": "nil_rated"}, "nil/exempt"),
    ({"doc_status": "draft"}, "draft"),
    ({"cancelled_at": "2026-07-20T00:00:00+00:00"}, "cancelled"),
])
def test_supplies_that_belong_in_a_section_this_file_omits_are_excluded_and_named(over, fragment):
    payload, manifest = build_gstr1([invoice(**over)], ORG, "2026-07")
    assert "b2b" not in payload
    assert any(fragment in e["reason"] for e in manifest["excluded"])


def test_a_foreign_currency_invoice_is_held_back():
    payload, manifest = build_gstr1([invoice(currency="USD")], ORG, "2026-07")
    assert "b2b" not in payload
    assert "USD" in manifest["held_back"][0]["reason"]


def test_cess_across_several_rates_is_held_back_rather_than_apportioned():
    row = invoice(
        cess=Decimal("50.00"),
        line_items=_lines(("A", "998311", 1, "NOS", 1000, 18, 1000.00, 180.00),
                          ("B", "998312", 1, "NOS", 1000, 12, 1000.00, 120.00)),
        subtotal=Decimal("2000.00"), cgst=Decimal("150.00"), sgst=Decimal("150.00"),
        total=Decimal("2350.00"),
    )
    payload, manifest = build_gstr1([row], ORG, "2026-07")
    assert "b2b" not in payload
    assert "cess" in manifest["held_back"][0]["reason"]


def test_the_reconciliation_ties_reported_figures_to_the_invoice_headers():
    rows = [invoice(invoice_number=f"INV-2026-{n:04d}") for n in (1, 2, 3)]
    _payload, manifest = build_gstr1(rows, ORG, "2026-07")
    rec = manifest["reconciliation"]
    assert rec["reported_taxable_value"] == 3000.0 == rec["source_taxable_value"]
    assert rec["reported_tax"] == 540.0 == rec["source_tax"]
    assert rec["taxable_value_difference"] == 0.0 and rec["tax_difference"] == 0.0


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("raw,expected", [
    ("Gujarat", "24"), ("gujarat", "24"), ("  GUJARAT ", "24"),
    ("Maharashtra (27)", "27"), ("27-Maharashtra", "27"), ("27", "27"),
    ("Tamil Nadu", "33"), ("Tamilnadu", "33"), ("Orissa", "21"), ("Odisha", "21"),
    ("Delhi", "07"), ("Andhra Pradesh", "37"),
    ("", ""), (None, ""), ("Atlantis", ""), ("77", ""),
])
def test_place_of_supply_resolves_to_a_state_code_or_to_nothing(raw, expected):
    assert parse_state_code(raw) == expected


@pytest.mark.parametrize("unit,expected", [
    ("NOS", "NOS"), ("nos", "NOS"), ("kg", "KGS"), ("BOX", "BOX"),
    ("hrs", "OTH"), ("", "OTH"), (None, "OTH"), ("furlong", "OTH"),
])
def test_free_text_units_map_to_a_gstn_uqc_or_to_others(unit, expected):
    assert uqc(unit) == expected


def test_the_return_period_is_mmyyyy():
    assert fp("2026-07") == "072026"
    assert fp("2026-12") == "122026"


# ══════════════════════════════════════════════════════════════════════════════
# Routes — auth, tenancy, gate, and the refusal a caller receives
# ══════════════════════════════════════════════════════════════════════════════

EXPORT_PATHS = [
    "/tally/2026-07",
    "/tally/2026-07/preview",
    "/gst/gstr1/2026-07/json",
    "/gst/gstr1/2026-07/preview",
]


@pytest.fixture
def gate_open(app):
    from routers import documents
    app.dependency_overrides[documents._ganit] = lambda: True
    yield
    app.dependency_overrides.pop(documents._ganit, None)


@pytest.mark.parametrize("path", EXPORT_PATHS)
async def test_every_export_requires_authentication(api_client, path):
    r = await api_client.get(f"{DOCS}{path}")
    assert r.status_code in (401, 403), (path, r.status_code)


#: The same four routes as templates, for the introspection tests below.
EXPORT_ROUTE_TEMPLATES = [
    "/api/v1/documents/tally/{period}",
    "/api/v1/documents/tally/{period}/preview",
    "/api/v1/documents/gst/gstr1/{period}/json",
    "/api/v1/documents/gst/gstr1/{period}/preview",
]


def _api_routes(router, found=None):
    """Every real `APIRoute` reachable on the app.

    FastAPI wraps each `include_router` in an `_IncludedRouter` that keeps the
    real router on `.original_router`, so a flat scan of `app.routes` sees only
    what was registered directly on the app. Same walk as
    `test_me_security._mounted_paths`, kept because a router committed and never
    included is a failure this codebase has actually shipped.
    """
    found = found if found is not None else []
    for r in getattr(router, "routes", []):
        if hasattr(r, "dependant") and getattr(r, "path", None):
            found.append(r)
        inner = getattr(r, "original_router", None)
        if inner is not None:
            _api_routes(inner, found)
        elif hasattr(r, "routes"):
            _api_routes(r, found)
    return found


@pytest.mark.parametrize("template", EXPORT_ROUTE_TEMPLATES)
def test_every_export_route_is_actually_mounted(app, template):
    assert any(r.path == template for r in _api_routes(app)), \
        f"{template} is not mounted — the export is dead code"


@pytest.mark.parametrize("template", EXPORT_ROUTE_TEMPLATES)
def test_every_export_carries_the_ganit_module_gate(app, template):
    """The gate is a DEPENDENCY on the route, not a check inside the handler.

    A peer found routes returning one module's data behind another's gate. This
    asserts the dependency is present on the route object and is Ganit's own
    gate, rather than trusting the handler body — a check inside a function can
    be edited out with no route-level signal.
    """
    from routers import documents

    routes = [r for r in _api_routes(app) if r.path == template]
    assert routes, f"{template} is not mounted"
    for route in routes:
        dependencies = [d.call for d in route.dependant.dependencies]
        assert documents._ganit in dependencies, f"{template} has no Ganit module gate"
        assert get_org_id in dependencies, f"{template} is not scoped to an org"


@pytest.mark.parametrize("path", EXPORT_PATHS)
async def test_an_export_is_a_read_so_a_viewer_is_not_refused(path):
    """`_is_write` must answer False, or a viewer entitled to the data is blocked."""
    from unittest.mock import MagicMock

    from middleware.subscription import _is_write

    request = MagicMock()
    request.method = "GET"
    request.url.path = f"/api/v1/documents{path}"
    assert _is_write(request) is False


@pytest.mark.parametrize("path", ["/tally/nonsense", "/gst/gstr1/nonsense/json"])
async def test_a_malformed_period_is_rejected(
    api_client, as_admin, with_org_id, gate_open, mock_pool, path,
):
    mock_pool.fetch = AsyncMock(return_value=[])
    mock_pool.fetchrow = AsyncMock(return_value={"name": "X", "gstin": SUPPLIER})
    r = await api_client.get(f"{DOCS}{path}")
    assert r.status_code == 400


async def test_an_empty_tally_period_refuses_rather_than_downloading_an_empty_file(
    api_client, as_admin, with_org_id, gate_open, mock_pool,
):
    mock_pool.fetch = AsyncMock(return_value=[])
    mock_pool.fetchrow = AsyncMock(return_value={"name": "Test LLP", "gstin": SUPPLIER})
    r = await api_client.get(f"{DOCS}/tally/2026-07")
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "export_empty"


async def test_gstr1_refuses_when_the_org_has_no_gstin_to_report_under(
    api_client, as_admin, with_org_id, gate_open, mock_pool,
):
    mock_pool.fetch = AsyncMock(return_value=[])
    mock_pool.fetchrow = AsyncMock(return_value={"name": "Test LLP", "gstin": ""})
    r = await api_client.get(f"{DOCS}/gst/gstr1/2026-07/json")
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error"] == "supplier_gstin_missing"
    assert "Company Profile" in detail["fix"]


async def test_a_tally_download_answers_xml_with_a_named_file(
    api_client, as_admin, with_org_id, gate_open, mock_pool,
):
    async def _fetch(query, *args):
        return [invoice()] if "ganit_invoices" in query else []

    mock_pool.fetch = AsyncMock(side_effect=_fetch)
    mock_pool.fetchrow = AsyncMock(return_value={"name": "Test LLP", "gstin": SUPPLIER})
    r = await api_client.get(f"{DOCS}/tally/2026-07")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    assert "Kartavaya-Tally-2026-07.xml" in r.headers["content-disposition"]
    assert r.headers["x-kartavaya-voucher-count"] == "1"
    ET.fromstring(r.text)


async def test_a_gstr1_download_answers_the_strict_payload_with_no_extra_keys(
    api_client, as_admin, with_org_id, gate_open, mock_pool,
):
    """No Kartavaya key is added to a file bound for a government utility."""
    mock_pool.fetch = AsyncMock(return_value=[invoice()])
    mock_pool.fetchrow = AsyncMock(return_value={"name": "Test LLP", "gstin": SUPPLIER})
    r = await api_client.get(f"{DOCS}/gst/gstr1/2026-07/json")
    assert r.status_code == 200
    payload = json.loads(r.text)
    assert set(payload) <= {"gstin", "fp", "b2b", "b2cl", "b2cs", "hsn", "doc_issue"}
    assert not [k for k in payload if k.startswith("_")]
    assert "Kartavaya-GSTR1-data-072026.json" in r.headers["content-disposition"]


async def test_the_preview_and_the_download_cannot_disagree(
    api_client, as_admin, with_org_id, gate_open, mock_pool,
):
    mock_pool.fetch = AsyncMock(return_value=[invoice()])
    mock_pool.fetchrow = AsyncMock(return_value={"name": "Test LLP", "gstin": SUPPLIER})

    preview = (await api_client.get(f"{DOCS}/gst/gstr1/2026-07/preview")).json()
    payload = json.loads((await api_client.get(f"{DOCS}/gst/gstr1/2026-07/json")).text)
    assert preview["sections_emitted"] == [k for k in payload if k not in ("gstin", "fp")]
