"""Wiring for the six document download endpoints.

`tests/test_document_set.py` covers the renderers and the validators. This file
covers the part between them and the database: tenancy, the refusal a caller
actually receives, and the two derivations the routes do rather than the
renderers — the GSTR-3B hold-back and the statement's opening balance.

Nothing here renders a PDF, so it runs without WeasyPrint's native stack. No
email, push or WhatsApp is reachable on any path; `conftest` pins
`OUTBOUND_MODE=dry` before the app is imported in any case.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

pytestmark = pytest.mark.anyio

DOCS = "/api/v1/documents"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def gate_open(app):
    """Open the Ganit module gate.

    These routes carry the same `require_module("ganit")` gate as
    `ganit.download_invoice_pdf`; entitlement is exercised by
    `test_module_grant_enforcement.py` and is not re-litigated here.
    """
    from middleware.subscription import require_module
    from routers import documents

    app.dependency_overrides[documents._ganit] = lambda: True
    yield
    app.dependency_overrides.pop(documents._ganit, None)


# ══════════════════════════════════════════════════════════════════════════════
# Tenancy — every route is scoped to the caller's org
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_quotation_from_another_org_is_not_found(
    api_client, as_admin, with_org_id, gate_open, mock_pool
):
    """`fetchrow` returning None IS the cross-org case: the query carries
    `org_id=$2::uuid`, so another org's row simply does not match."""
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.get(f"{DOCS}/quotations/00000000-0000-0000-0000-0000000000aa/pdf")
    assert r.status_code == 404


@pytest.mark.parametrize("path,method", [
    ("/quotations/00000000-0000-0000-0000-0000000000aa/pdf", "get"),
    ("/contacts/00000000-0000-0000-0000-0000000000aa/statement/pdf"
     "?period_start=2026-04-01&period_end=2026-07-25", "get"),
    ("/gst/gstr3b/2026-07/pdf", "post"),
    ("/contracts/00000000-0000-0000-0000-0000000000aa/agreement/pdf", "post"),
])
async def test_every_route_requires_authentication(api_client, path, method):
    r = await getattr(api_client, method)(f"{DOCS}{path}")
    assert r.status_code in (401, 403), (path, r.status_code)


# ══════════════════════════════════════════════════════════════════════════════
# The quotation route
# ══════════════════════════════════════════════════════════════════════════════

def _invoice_row(**over) -> dict:
    row = {
        "id": "00000000-0000-0000-0000-0000000000aa",
        "invoice_number": "QT-118",
        "invoice_type": "quotation",
        "invoice_date": "2026-07-21",
        "due_date": "2026-08-15",
        "line_items": json.dumps([
            {"description": "Retainer", "quantity": 12, "unit": "mo",
             "rate": 100000, "line_total": 1200000},
        ]),
        "subtotal": 1200000, "discount": 0, "is_igst": True,
        "igst": 216000, "cgst": 0, "sgst": 0, "currency": "INR",
        "notes": "RFQ/DEMO/114", "terms": "Compliance retainer.",
        "is_active": True,
        "contact_name": "Meera Joshi", "contact_email": "m@example.invalid",
        "contact_company": "Vendor Demo Limited", "contact_gstin": "27AAACT2727Q1ZW",
        "contact_designation": "Procurement Head",
        "contact_billing_address": json.dumps({"line1": "1 Demo Street", "city": "Mumbai"}),
    }
    row.update(over)
    return row


async def test_a_tax_invoice_is_refused_by_the_quotation_route(
    api_client, as_admin, with_org_id, gate_open, mock_pool
):
    """409, not 404: the record exists, it is simply not an offer. Rendering a
    tax invoice through the quotation template would drop the Rule 46
    particulars that make it a tax document."""
    mock_pool.fetchrow = AsyncMock(return_value=_invoice_row(invoice_type="tax_invoice"))
    r = await api_client.get(f"{DOCS}/quotations/00000000-0000-0000-0000-0000000000aa/pdf")
    assert r.status_code == 409
    assert "not a quotation" in r.json()["detail"]


async def test_the_invoice_route_hands_a_quotation_to_its_own_renderer(monkeypatch):
    """The substantive fix. A quotation previously rendered through
    `invoice_pdf.py` with the word "Quotation" in the title; the route now
    dispatches so every existing caller and saved link gets the right document.

    Asserted at the function level rather than over HTTP, because what matters
    is which generator the invoice route reaches — not the bytes, which
    `test_document_set.py` already covers.
    """
    from routers import documents, ganit

    called: dict = {}

    async def _fake_quotation(invoice_id, user, org_id, _g):
        called["invoice_id"] = str(invoice_id)
        called["org_id"] = org_id
        return "quotation-pdf"

    monkeypatch.setattr(documents, "download_quotation_pdf", _fake_quotation)

    class _Pool:
        async def fetchrow(self, *_a, **_k):
            return _invoice_row()

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(ganit, "get_pool", _get_pool)

    result = await ganit.download_invoice_pdf(
        invoice_id="00000000-0000-0000-0000-0000000000aa",
        user={"user_id": "u1"},
        org_id="00000000-0000-0000-0000-000000000001",
        _g=None,
    )
    assert result == "quotation-pdf"
    assert called["invoice_id"] == "00000000-0000-0000-0000-0000000000aa"


# ══════════════════════════════════════════════════════════════════════════════
# The GSTR-3B route — the hold-back is the point of the document
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("bad", ["2026", "2026-13-01", "July", ""])
async def test_a_malformed_period_is_rejected(
    api_client, as_admin, with_org_id, gate_open, bad
):
    r = await api_client.post(f"{DOCS}/gst/gstr3b/{bad}/pdf", json={})
    assert r.status_code in (400, 404, 422), bad


async def test_an_invoice_missing_hsn_is_held_back_and_named(
    api_client, as_admin, with_org_id, gate_open, mock_pool, monkeypatch
):
    """Rule 46(g). `doc_validation`'s docstring cites the design for exactly this
    behaviour — the working paper NAMES what it excluded rather than quietly
    dropping it, because a silent exclusion understates the liability and the
    preparer never learns why the books do not tie."""
    from routers import documents

    good = {
        "invoice_number": "INV-1", "invoice_type": "tax_invoice",
        "is_igst": False, "is_export": False,
        "line_items": json.dumps([{"description": "Audit", "hsn_code": "998221"}]),
        "subtotal": 100000, "cgst": 9000, "sgst": 9000, "igst": 0, "cess": 0,
        "total": 118000,
    }
    bad = {
        "invoice_number": "INV-2", "invoice_type": "tax_invoice",
        "is_igst": False, "is_export": False,
        "line_items": json.dumps([{"description": "Advisory"}]),  # no HSN, no SAC
        "subtotal": 50000, "cgst": 4500, "sgst": 4500, "igst": 0, "cess": 0,
        "total": 59000,
    }

    async def _fetch(query, *args):
        if "ganit_invoices" in query:
            return [good, bad]
        if "ganit_vendor_bills" in query:
            return [{"igst": 0, "cgst": 0, "sgst": 0, "n": 0}]
        return []

    mock_pool.fetch = AsyncMock(side_effect=_fetch)
    mock_pool.fetchrow = AsyncMock(return_value={
        "name": "Aekam Inc", "gstin": "27AAACA1234M1Z8", "pan": "AAACA1234M",
        "billing_address": json.dumps({"city": "Mumbai", "state": "Maharashtra"}),
        "logo_url": "", "logo_key": "", "email": "", "phone": "", "website": "",
        "bank_details": "{}", "invoice_note": "", "settings": "{}",
        "authorized_signatory_name": "Keval Shah",
        "authorized_signatory_designation": "Partner",
    })

    captured: dict = {}

    def _fake_generate(gstr, org):
        captured.update(gstr)
        return b"%PDF-1.7 fake"

    monkeypatch.setattr(
        "services.gstr3b_pdf.generate_gstr3b_pdf", _fake_generate
    )

    r = await api_client.post(f"{DOCS}/gst/gstr3b/2026-07/pdf", json={})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"

    held = captured["held_back"]
    assert len(held) == 1, "exactly one invoice should be held back"
    assert held[0]["party"] == "INV-2"
    assert "HSN" in held[0]["reason"]
    # The held-back invoice's tax must NOT be in 3.1(a).
    assert captured["outward_taxable"]["cgst"] == 9000
    assert captured["outward_count"] == 1


async def test_a_credit_note_is_netted_off_rather_than_added(
    api_client, as_admin, with_org_id, gate_open, mock_pool, monkeypatch
):
    """A credit note reduces the outward supply and its tax. Adding it would
    overstate both the turnover and the liability."""
    invoice = {
        "invoice_number": "INV-1", "invoice_type": "tax_invoice",
        "is_igst": False, "is_export": False,
        "line_items": json.dumps([{"description": "Audit", "sac_code": "998221"}]),
        "subtotal": 100000, "cgst": 9000, "sgst": 9000, "igst": 0, "cess": 0,
        "total": 118000,
    }
    credit = {**invoice, "invoice_number": "CN-1", "invoice_type": "credit_note",
              "subtotal": 20000, "cgst": 1800, "sgst": 1800}

    async def _fetch(query, *args):
        if "ganit_invoices" in query:
            return [invoice, credit]
        if "ganit_vendor_bills" in query:
            return [{"igst": 0, "cgst": 0, "sgst": 0, "n": 0}]
        return []

    mock_pool.fetch = AsyncMock(side_effect=_fetch)
    mock_pool.fetchrow = AsyncMock(return_value={
        "name": "Aekam Inc", "gstin": "27AAACA1234M1Z8", "pan": "AAACA1234M",
        "billing_address": "{}", "logo_url": "", "logo_key": "", "email": "",
        "phone": "", "website": "", "bank_details": "{}", "invoice_note": "",
        "settings": "{}", "authorized_signatory_name": "",
        "authorized_signatory_designation": "",
    })

    captured: dict = {}
    monkeypatch.setattr(
        "services.gstr3b_pdf.generate_gstr3b_pdf",
        lambda gstr, org: (captured.update(gstr), b"%PDF-1.7 fake")[1],
    )

    r = await api_client.post(f"{DOCS}/gst/gstr3b/2026-07/pdf", json={})
    assert r.status_code == 200, r.text
    assert captured["outward_taxable"]["taxable"] == 80000
    assert captured["outward_taxable"]["cgst"] == 7200


# ══════════════════════════════════════════════════════════════════════════════
# The statement route — the opening balance is the thing most easily got wrong
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_statement_period_is_validated(
    api_client, as_admin, with_org_id, gate_open
):
    r = await api_client.get(
        f"{DOCS}/contacts/00000000-0000-0000-0000-0000000000aa/statement/pdf"
        "?period_start=2026-07-25&period_end=2026-04-01"
    )
    assert r.status_code == 400
    assert "after" in r.json()["detail"]


async def test_the_opening_balance_carries_history_from_before_the_window(
    api_client, as_admin, with_org_id, gate_open, mock_pool, monkeypatch
):
    """A statement that assumes an opening balance of zero understates the debt,
    which is the single most common way this document misleads. The route
    computes it from everything dated before `period_start`."""
    from routers import documents

    async def _fetchrow(query, *args):
        if "graha_contacts" in query:
            return {"name": "Meera Joshi", "company": "Vendor Demo Limited",
                    "email": "", "gstin": "", "billing_address": "{}"}
        return {
            "name": "Aekam Inc", "gstin": "27AAACA1234M1Z8", "pan": "AAACA1234M",
            "billing_address": "{}", "logo_url": "", "logo_key": "", "email": "",
            "phone": "", "website": "", "bank_details": "{}", "invoice_note": "",
            "settings": "{}", "authorized_signatory_name": "",
            "authorized_signatory_designation": "",
        }

    # 5,00,000 invoiced, 1,00,000 credit-noted and 1,50,000 paid before the
    # window -> opening 2,50,000.
    values = iter([500000, 100000, 150000])

    async def _fetchval(query, *args):
        try:
            return next(values)
        except StopIteration:
            return 0

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)
    mock_pool.fetchval = AsyncMock(side_effect=_fetchval)
    mock_pool.fetch = AsyncMock(return_value=[])

    captured: dict = {}
    monkeypatch.setattr(
        "services.statement_pdf.generate_statement_pdf",
        lambda st, org, contact: (captured.update(st), b"%PDF-1.7 fake")[1],
    )

    r = await api_client.get(
        f"{DOCS}/contacts/00000000-0000-0000-0000-0000000000aa/statement/pdf"
        "?period_start=2026-04-01&period_end=2026-07-25"
    )
    assert r.status_code == 200, r.text
    assert captured["opening_balance"] == 250000


# ══════════════════════════════════════════════════════════════════════════════
# The TDS route — the 192B line is derived, nothing else is
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_salary_line_is_derived_from_vetana(
    api_client, as_admin, with_org_id, gate_open, mock_pool, monkeypatch
):
    """The one part of the challan Kartavaya actually holds. The rate column
    stays empty: section 192(1) deducts at the employee's own average rate, so
    any single percentage would be wrong for every employee."""
    async def _fetchrow(query, *args):
        if "vetana_payslips" in query:
            return {"tds": 30000, "gross": 1200000, "n": 6}
        return {
            "name": "Aekam Inc", "gstin": "", "pan": "AAACA1234M",
            "billing_address": "{}", "logo_url": "", "logo_key": "", "email": "",
            "phone": "", "website": "", "bank_details": "{}", "invoice_note": "",
            "settings": json.dumps({"tan": "MUMA12345B"}),
            "authorized_signatory_name": "", "authorized_signatory_designation": "",
        }

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)

    captured: dict = {}
    monkeypatch.setattr(
        "services.tds_challan_pdf.generate_tds_challan_pdf",
        lambda ch, org: (captured.update(ch), b"%PDF-1.7 fake")[1],
    )

    r = await api_client.post(f"{DOCS}/tds/challan/2026-07/pdf", json={
        "deposit_date": "2026-08-07", "major_head": "0021", "payment_type": "200",
        "bsr_code": "0510308", "challan_serial": "04412",
        "challan_number": "CHL-0442", "bank_name": "Demo Bank",
    })
    assert r.status_code == 200, r.text

    salary = [d for d in captured["deductions"] if d["section"] == "192B"]
    assert len(salary) == 1
    assert salary[0]["tds"] == 30000
    assert salary[0]["count"] == 6
    assert salary[0]["rate"] is None, "192B must show no section rate"
    # With nothing else stated, the income-tax head defaults to the line total,
    # so the breakdown reconciles without the caller restating it.
    assert captured["amounts"]["income_tax"] == 30000


async def test_the_tan_is_read_from_settings_until_a_column_exists(
    api_client, as_admin, with_org_id, gate_open, mock_pool, monkeypatch
):
    """`staging.organisations` has no `tan` column. Rather than block the
    document outright, the loader reads one an org has put in `settings`; the
    validator still refuses when there is none, so nothing is invented."""
    from routers.documents import _load_org

    class _Pool:
        async def fetchrow(self, *_a, **_k):
            return {
                "name": "Aekam Inc", "gstin": "", "pan": "", "billing_address": "{}",
                "logo_url": "", "logo_key": "", "email": "", "phone": "", "website": "",
                "bank_details": "{}", "invoice_note": "",
                "settings": json.dumps({"tan": "muma12345b"}),
                "authorized_signatory_name": "", "authorized_signatory_designation": "",
            }

    org = await _load_org(_Pool(), "00000000-0000-0000-0000-000000000001")
    assert org["tan"] == "MUMA12345B", "normalised to upper case for the TAN check"


async def test_a_challan_with_no_tan_anywhere_is_refused_with_422(
    api_client, as_admin, with_org_id, gate_open, mock_pool
):
    """The refusal a caller actually receives, with every missing field named so
    the UI can point at the setting that fixes it."""
    async def _fetchrow(query, *args):
        if "vetana_payslips" in query:
            return {"tds": 30000, "gross": 1200000, "n": 6}
        return {
            "name": "Aekam Inc", "gstin": "", "pan": "", "billing_address": "{}",
            "logo_url": "", "logo_key": "", "email": "", "phone": "", "website": "",
            "bank_details": "{}", "invoice_note": "", "settings": "{}",
            "authorized_signatory_name": "", "authorized_signatory_designation": "",
        }

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)

    r = await api_client.post(f"{DOCS}/tds/challan/2026-07/pdf", json={
        "deposit_date": "2026-08-07", "major_head": "0021", "payment_type": "200",
        "bsr_code": "0510308", "challan_serial": "04412",
    })
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["error"] == "document_incomplete"
    assert "org.tan" in {g["field"] for g in detail["blocking"]}
    # And it must say where to fix it, not merely that it is missing.
    assert all(g["fix"] for g in detail["blocking"])
