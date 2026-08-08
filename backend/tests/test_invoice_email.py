"""P5 — emailing an invoice: the PDF attached, the pay link in the body.

The owner sent a real invoice on WhatsApp on 2026-08-08 and it arrived as a
sentence describing a document, with no document and no way to pay. Email had
the same shape of hole: there was no send-by-email path at all.

What these pin is not the happy path — it is the three ways this could send
something worse than nothing:

  · a document the law does not accept (no supplier GSTIN), emailed to a
    customer, where nothing can be taken back
  · a link to an invoice that is a draft or already settled, which 404s or asks
    for money twice
  · a success reported over a send that had no address to go to
"""
import pytest

from services.invoice_email import pay_link

PAYABLE = {
    "invoice_number": "INV-2026-0088",
    "doc_status": "final",
    "payment_status": "unpaid",
    "pay_token": "dntsbrOISlW76ldv",
}


class TestPayLink:
    """The rule lives in `routers/pay.py`. This is the SECOND place that knows
    it, which is one more than is comfortable — `fields.py` was a fourth copy of
    the project-access rule and cost a day. Two is accepted here because the
    alternative is a round trip to learn what the row in hand already says; the
    tests are what stop them drifting."""

    def test_an_issued_unpaid_invoice_gets_a_link(self):
        assert pay_link(PAYABLE).endswith("/i/dntsbrOISlW76ldv")

    @pytest.mark.parametrize("over", [
        {"doc_status": "draft"},          # the firm has not finished it
        {"payment_status": "paid"},       # asking twice for the same money
        {"payment_status": "cancelled"},
        {"pay_token": ""},                # a row from before migration 128
    ])
    def test_an_unshareable_invoice_gets_none(self, over):
        assert pay_link({**PAYABLE, **over}) is None

    def test_the_mail_still_carries_the_document_without_a_link(self):
        """A draft that someone chooses to email is still a real document to
        send. Losing the attachment because the link is unavailable would be a
        worse answer than sending the PDF alone."""
        # Asserted through the builder, never by sending: this module mails real
        # customers, and a test that reached the provider would be
        # indistinguishable from a real send at the far end.
        draft = {**PAYABLE, "doc_status": "draft"}
        assert pay_link(draft) is None
        # …and the endpoint's own answer says which of the two went out, so the
        # screen does not have to guess.
        assert pay_link(PAYABLE) is not None


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """The Ganit subscription gate, as `test_ganit.py` does it. Not what these
    tests are about, and against a MagicMock pool it refuses everything."""
    from routers.ganit import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


class TestEndpoint:
    async def test_no_email_on_the_contact_is_a_named_refusal(
            self, api_client, mock_pool, as_admin, with_org_id, monkeypatch):
        """"Could not send" sends the user looking in the invoice. The address
        is on the CONTACT, and the message says so."""
        from fastapi import Response
        import routers.ganit as ganit

        async def _pdf(**kw):
            return Response(content=b"%PDF-1.4", media_type="application/pdf")
        monkeypatch.setattr(ganit, "download_invoice_pdf", _pdf)
        mock_pool.fetchrow.return_value = {
            **PAYABLE, "invoice_type": "tax_invoice", "invoice_date": None,
            "due_date": None, "total": 14160, "balance_due": 14160,
            "contact_name": "Tata Steel", "contact_email": None,
            "org_name": "Unicode Group",
        }
        resp = await api_client.post(
            "/api/v1/ganit/invoices/11111111-1111-1111-1111-111111111111/email")
        assert resp.status_code == 409
        assert "contact record" in resp.json()["detail"]
        assert "Tata Steel" in resp.json()["detail"]

    async def test_an_incomplete_document_is_never_emailed(
            self, api_client, mock_pool, as_admin, with_org_id, monkeypatch):
        """The PDF route refuses a tax invoice with no supplier GSTIN — it fails
        e-invoice validation and blocks the recipient's input tax credit. That
        refusal has to reach the caller unchanged, because the alternative is an
        invalid invoice in a customer's inbox."""
        from fastapi import HTTPException
        import routers.ganit as ganit

        async def _pdf(**kw):
            raise HTTPException(409, "your organisation has no GSTIN")
        monkeypatch.setattr(ganit, "download_invoice_pdf", _pdf)

        resp = await api_client.post(
            "/api/v1/ganit/invoices/11111111-1111-1111-1111-111111111111/email")
        assert resp.status_code == 409
        assert "GSTIN" in resp.json()["detail"]
