"""
Unit tests for ganit.py — GST Invoicing endpoints.

Coverage:
  GET    /api/v1/ganit/products            — list products
  POST   /api/v1/ganit/products            — create product
  PATCH  /api/v1/ganit/products/{id}       — update
  DELETE /api/v1/ganit/products/{id}       — soft-delete
  GET    /api/v1/ganit/invoices            — list, filter by type/status
  POST   /api/v1/ganit/invoices            — create with GST computation
  GET    /api/v1/ganit/invoices/{id}       — detail with payments
  POST   /api/v1/ganit/invoices/{id}/cancel — cancel
  POST   /api/v1/ganit/invoices/{id}/payments — record payment, balance update
  GET    /api/v1/ganit/stats               — dashboard aggregates
  _compute_invoice                         — pure function: CGST/SGST, IGST, discount
"""

import pytest
from routers.ganit import _compute_invoice, LineItem

PRODUCT_ROW = {
    "id": "pr000000-0000-0000-0000-000000000001",
    "name": "Web Hosting",
    "hsn_code": "",
    "sac_code": "998315",
    "unit": "NOS",
    "price": 5000,
    "gst_rate": 18.0,
    "description": "Annual hosting",
    "is_service": True,
    "created_at": "2026-01-01T00:00:00Z",
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.ganit import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── _compute_invoice (pure function) ───────────────────────────

def test_compute_intrastate_gst():
    items = [LineItem(description="Item A", quantity=2, rate=1000, gst_rate=18)]
    result = _compute_invoice(items, is_igst=False)
    assert result["subtotal"] == 2000
    assert result["cgst"] == 180
    assert result["sgst"] == 180
    assert result["igst"] == 0
    assert result["total"] == 2360


def test_compute_interstate_gst():
    items = [LineItem(description="Item A", quantity=1, rate=1000, gst_rate=18)]
    result = _compute_invoice(items, is_igst=True)
    assert result["cgst"] == 0
    assert result["sgst"] == 0
    assert result["igst"] == 180
    assert result["total"] == 1180


def test_compute_with_discount():
    items = [LineItem(description="Item A", quantity=1, rate=1000, gst_rate=18)]
    result = _compute_invoice(items, is_igst=False, flat_discount=100)
    assert result["discount"] == 100
    assert result["total"] == 1080  # 1000 + 90 + 90 - 100


def test_compute_line_discount_pct():
    items = [LineItem(description="Item A", quantity=1, rate=1000, gst_rate=18, discount_pct=10)]
    result = _compute_invoice(items, is_igst=False)
    assert result["subtotal"] == 900
    assert result["cgst"] == 81
    assert result["sgst"] == 81
    assert result["total"] == 1062


def test_compute_zero_gst():
    items = [LineItem(description="Exempt", quantity=1, rate=500, gst_rate=0)]
    result = _compute_invoice(items, is_igst=False)
    assert result["cgst"] == 0
    assert result["sgst"] == 0
    assert result["total"] == 500


def test_compute_multiple_items():
    items = [
        LineItem(description="A", quantity=2, rate=500, gst_rate=18),
        LineItem(description="B", quantity=1, rate=1000, gst_rate=12),
    ]
    result = _compute_invoice(items, is_igst=False)
    assert result["subtotal"] == 2000
    assert len(result["line_items"]) == 2


# ── Products ─────────────────────────────────────────────────────

async def test_list_products(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [PRODUCT_ROW]
    resp = await api_client.get("/api/v1/ganit/products")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


async def test_create_product(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {"id": "pr001", "name": "Widget"}
    resp = await api_client.post("/api/v1/ganit/products", json={
        "name": "Widget",
        "price": 999,
        "gst_rate": 18,
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"


async def test_update_product(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/ganit/products/00000000-0000-0000-0000-000000000001",
        json={"price": 1200},
    )
    assert resp.status_code == 200


async def test_delete_product(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.delete(
        "/api/v1/ganit/products/00000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 200


# ── Invoices ─────────────────────────────────────────────────────

async def test_list_invoices(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/ganit/invoices")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


async def test_create_invoice_no_items(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.post("/api/v1/ganit/invoices", json={
        "invoice_type": "tax_invoice",
        "line_items": [],
    })
    assert resp.status_code == 400
    assert "line item" in resp.json()["detail"].lower()


async def test_create_invoice_invalid_type(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.post("/api/v1/ganit/invoices", json={
        "invoice_type": "fake_type",
        "line_items": [{"description": "X", "quantity": 1, "rate": 100}],
    })
    assert resp.status_code == 400


async def test_create_invoice_success(api_client, mock_pool, as_admin, with_org_id):
    """A COMPLIANT tax invoice is created.

    The payload carries what Rule 46 requires and this route now checks before
    spending a serial: a recipient, an HSN/SAC on every line, and — because it
    is marked inter-State — a place of supply. It used to carry none of those
    and still return 200, which is exactly how an invoice could be created that
    its own PDF endpoint then refused to render.

    `fetchrow` is sequenced rather than fixed: the completeness check reads the
    org and then the contact before the INSERT returns the new row.
    """
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.side_effect = [
        {"name": "Aekam Inc", "gstin": "27AAACE1234E1Z5", "pan": "AAACE1234E",
         "billing_address": {"line1": "1 Test Road", "city": "Mumbai"}},
        {"name": "Sharma Textiles", "company": "Sharma Textiles", "gstin": "24AAACS1234E1Z5"},
        {"id": "inv001", "invoice_number": "INV-2026-0001", "total": 1180},
    ]
    resp = await api_client.post("/api/v1/ganit/invoices", json={
        "invoice_type": "tax_invoice",
        "is_igst": True,
        "contact_id": "c0000000-0000-0000-0000-000000000001",
        "place_of_supply": "Gujarat",
        "line_items": [
            {"description": "Service", "hsn_code": "998231", "quantity": 1, "rate": 1000, "gst_rate": 18},
        ],
    })
    assert resp.status_code == 200
    assert resp.json()["invoice_number"] == "INV-2026-0001"


async def test_creating_a_final_tax_invoice_refuses_a_rule_46_gap(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The gap this route used to leave open.

    A tax invoice defaults to doc_status='final', so it is issuable the moment
    it exists. Creating one with no recipient and no HSN produced a document
    `GET /invoices/{id}/pdf` then refused under Rule 46(e)/(g) — the user found
    out at download time. It is refused here instead, in the same
    `document_incomplete` shape the PDF route answers with, and BEFORE a
    consecutive serial is consumed.
    """
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.side_effect = [
        {"name": "Aekam Inc", "gstin": "27AAACE1234E1Z5", "pan": "AAACE1234E",
         "billing_address": {"line1": "1 Test Road", "city": "Mumbai"}},
    ]
    resp = await api_client.post("/api/v1/ganit/invoices", json={
        "invoice_type": "tax_invoice",
        "line_items": [{"description": "Service", "quantity": 1, "rate": 1000, "gst_rate": 18}],
    })

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["error"] == "document_incomplete"
    fields = {g["field"] for g in detail["blocking"]}
    assert "contact.name" in fields
    assert "invoice.line_items.hsn_code" in fields


async def test_a_draft_may_still_be_saved_incomplete(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Drafts stay permissive on purpose: an incomplete draft is the workflow —
    it is what the user is editing towards. Only issuing is gated."""
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.return_value = {
        "id": "inv002", "invoice_number": "INV-2026-0002", "total": 1180,
    }
    resp = await api_client.post("/api/v1/ganit/invoices", json={
        "invoice_type": "tax_invoice",
        "doc_status": "draft",
        "line_items": [{"description": "Service", "quantity": 1, "rate": 1000, "gst_rate": 18}],
    })
    assert resp.status_code == 200


# ── Editing is bounded by ISSUANCE, not by doc_status ────────────────────
#
# `doc_status` DEFAULTS to 'final', so reading 'final' as "issued" hid Edit from
# every invoice the product creates by default. Measured live 2026-08-03: all
# six of Aekam Inc's invoices were 'final', five never sent/viewed/paid, four
# incomplete under Rule 46 — unissuable by the PDF and uncorrectable by Edit at
# the same time, while the PDF's own message pointed at Edit.

EDIT_BODY = {
    "invoice_type": "tax_invoice",
    "line_items": [{"description": "Service", "hsn_code": "998231",
                    "quantity": 1, "rate": 1000, "gst_rate": 18}],
}


async def test_a_final_invoice_never_sent_is_still_editable(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The case that was stuck: born 'final' by the column default, never
    delivered to anybody, so there is no recipient copy a credit note would
    reconcile against."""
    mock_pool.fetchrow.side_effect = [
        {"invoice_number": "INV-2026-0004", "doc_status": "final", "total": 1180,
         "balance_due": 1180, "is_active": True, "sent_at": None, "viewed_at": None},
        {"id": "inv004", "invoice_number": "INV-2026-0004", "total": 1180, "doc_status": "final"},
    ]
    resp = await api_client.patch(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000004", json=EDIT_BODY,
    )
    assert resp.status_code == 200


async def test_a_sent_but_unpaid_invoice_can_still_be_amended(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Owner's ruling: "any invoice created and unpaid can be amended and
    resent". Sending a copy does not freeze it — an unpaid invoice the customer
    has queried is exactly the one that needs correcting and re-sending."""
    mock_pool.fetchrow.side_effect = [
        {"invoice_number": "INV-2026-0009", "doc_status": "sent", "total": 1180,
         "balance_due": 1180, "is_active": True,
         "sent_at": "2026-08-01T10:00:00+00:00", "viewed_at": None},
        {"id": "inv009", "invoice_number": "INV-2026-0009", "total": 1180, "doc_status": "sent"},
    ]
    resp = await api_client.patch(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000009", json=EDIT_BODY,
    )
    assert resp.status_code == 200


async def test_a_paid_invoice_is_refused_even_if_it_was_never_sent(
    api_client, mock_pool, as_admin, with_org_id,
):
    """A receipt was matched against these figures, so they must not move
    underneath it — regardless of how the document was delivered."""
    mock_pool.fetchrow.return_value = {
        "invoice_number": "INV-2026-0003", "doc_status": "final", "total": 88500,
        "balance_due": 0, "is_active": True, "sent_at": None, "viewed_at": None,
    }
    resp = await api_client.patch(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000003", json=EDIT_BODY,
    )
    assert resp.status_code == 409
    assert "payment" in resp.json()["detail"].lower() or "credit note" in resp.json()["detail"].lower()


async def test_invoice_detail_reports_gaps_for_the_drawer(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The document stays clean, so the gaps have to surface SOMEWHERE — the
    firm needs to know what is missing before it sends. `document_check` is
    that channel, and it carries both what would refuse the PDF (blocking) and
    what it would render anyway (advisory)."""
    mock_pool.fetchrow.side_effect = [
        {"id": "inv001", "invoice_number": "INV-2026-0001", "invoice_type": "tax_invoice",
         "invoice_date": "2026-08-01", "doc_status": "final", "is_igst": False, "is_export": False,
         "place_of_supply": "", "line_items": [{"description": "X", "line_total": 1}],
         "cgst": 0, "sgst": 0, "igst": 0, "total": 1, "balance_due": 1,
         "contact_name": "Sharma Textiles", "contact_email": None, "contact_phone": None,
         "contact_company": None, "contact_gstin": None, "contact_billing_address": None},
        {"name": "Aekam Inc", "gstin": "", "pan": "AAACE1234E", "billing_address": {"city": "Mumbai"}},
    ]
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001")

    assert resp.status_code == 200
    check = resp.json()["document_check"]
    # No HSN on the only line -> blocks the PDF.
    assert {g["field"] for g in check["blocking"]} >= {"invoice.line_items.hsn_code"}
    # No supplier GSTIN -> renders fine, but the firm should know.
    assert {g["field"] for g in check["advisory"]} >= {"org.gstin"}
    assert check["ok"] is False


async def test_get_invoice_not_found(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 404


async def test_cancel_invoice(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/cancel",
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


# ── Payments ─────────────────────────────────────────────────────

async def test_record_payment_not_found(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/payments",
        json={"amount": 500},
    )
    assert resp.status_code == 404


async def test_record_payment_already_paid(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {
        "total": 1000,
        "amount_paid": 1000,
        "payment_status": "paid",
    }
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/payments",
        json={"amount": 100},
    )
    assert resp.status_code == 400


async def test_record_payment_partial(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {
        "total": 1000,
        "amount_paid": 0,
        "payment_status": "unpaid",
    }
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/payments",
        json={"amount": 500},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "partial"
    assert data["amount_paid"] == 500
    assert data["balance_due"] == 500


async def test_record_payment_full(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {
        "total": 1000,
        "amount_paid": 500,
        "payment_status": "partial",
    }
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/payments",
        json={"amount": 500},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "paid"


# ── Stats ────────────────────────────────────────────────────────

async def test_invoice_stats(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {
        "unpaid_count": 3,
        "total_outstanding": 50000,
        "total_collected": 100000,
        "overdue_count": 1,
        "total_invoices": 10,
    }
    resp = await api_client.get("/api/v1/ganit/stats")
    assert resp.status_code == 200
    assert resp.json()["total_invoices"] == 10


# ── Cash position ────────────────────────────────────────────────
#
# Today's "Cash position" card. Three things are worth asserting and none of
# them need a database:
#   · the range whitelist, because both accepted values are interpolated into
#     the SQL string and a third one must never reach it;
#   · the three footer totals, because that footer is the only place the
#     numbers appear together, and a bucket dropped from the series is
#     invisible in a bar chart but visible in the sum;
#   · that net is inflow MINUS outflow and is allowed to be negative — a period
#     that spent more than it collected has to read as a loss.

async def test_cash_position_rejects_unknown_range(api_client, as_admin, with_org_id):
    resp = await api_client.get("/api/v1/ganit/cash-position", params={"range": "year"})
    assert resp.status_code == 400


async def test_cash_position_totals(api_client, mock_pool, as_admin, with_org_id):
    from datetime import date
    mock_pool.fetch.return_value = [
        {"idx": 1, "start_date": date(2026, 7, 1), "inflow": 100, "outflow": 40},
        {"idx": 2, "start_date": date(2026, 7, 4), "inflow": 250, "outflow": 60},
    ]
    resp = await api_client.get("/api/v1/ganit/cash-position", params={"range": "30d"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["range"] == "30d"
    assert len(body["series"]) == 2
    assert body["series"][0]["start"] == "2026-07-01"
    assert body["inflow"] == 350
    assert body["outflow"] == 100
    assert body["net"] == 250


async def test_cash_position_net_can_be_negative(api_client, mock_pool, as_admin, with_org_id):
    from datetime import date
    mock_pool.fetch.return_value = [
        {"idx": 1, "start_date": date(2026, 7, 1), "inflow": 10, "outflow": 260},
    ]
    resp = await api_client.get("/api/v1/ganit/cash-position", params={"range": "quarter"})
    assert resp.json()["net"] == -250


async def test_cash_position_empty_org(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/ganit/cash-position")
    assert resp.status_code == 200
    body = resp.json()
    assert body["series"] == []
    assert body["inflow"] == 0 and body["outflow"] == 0 and body["net"] == 0
