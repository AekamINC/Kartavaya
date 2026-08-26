"""Three things `routers/ganit.py` let through, found by reconciling live rows
against the rules the product already states elsewhere.

Each one was proposed to me as a DATA cleanup — delete the bad payment, fix the
bad total — and each is really a CODE gap. Deleting the rows would have left the
door open and removed the only live evidence it was ever open. So the rows stay
and the door closes.

1. **`invoice_stats` counted drafts.** `routers/dristi.py:158-165` already
   filters `COALESCE(doc_status,'') <> 'draft'` and its own comment says why —
   an unissued document has not been sent to anybody, so it cannot be
   outstanding, overdue, or collected. This KPI strip sat beside those figures
   disagreeing with them.

2. **`record_payment` accepted a receipt against a CREDIT NOTE.** A credit note
   is money owed the other way. Recording a receipt against one says the
   customer paid you for a refund you owe them, and the arithmetic then reports
   it as collected revenue. It was reachable: the unpaid list returns credit
   notes and the pay screen offered them. Live at the time of writing, E2E holds
   exactly one such payment, against CN-2026-0148.

3. **`record_payment` accepted a receipt against a DRAFT.** Nobody has been
   asked for that money, so the receipt reconciles to nothing the customer ever
   saw, and it makes the document read as settled while still unsent. Live: four
   such payments across the two organisations, one of them Rs 2,06,500.

Why the tests are shaped like this: `routers/messaging.py:30-41` records what a
mocked pool is worth — a fake cursor resolves any table handed to it, so an HTTP
test proves the handler ASKED, never that the database could answer. So these
assert what HTTP can: which SQL was issued, and which status came back.
"""
import pytest

pytestmark = pytest.mark.asyncio

INVOICE = {
    "total": 1180.0, "amount_paid": 0.0, "payment_status": "unpaid",
    "invoice_type": "tax_invoice", "doc_status": "final",
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Two gates, because vendors are shared with Kray: `_gate` guards the
    invoice paths and `_payables_gate` (`require_any_module("ganit","kray")`)
    guards the vendor ones. Who may reach either is `test_ganit_security.py`'s
    subject, not this file's."""
    from routers.ganit import _gate, _payables_gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    app.dependency_overrides[_payables_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)
    app.dependency_overrides.pop(_payables_gate, None)


class TestTheKpiStripDoesNotCountDrafts:

    async def test_invoice_stats_filters_drafts(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = {
            "unpaid_count": 0, "total_outstanding": 0, "total_collected": 0,
            "overdue_count": 0, "overdue_amount": 0, "total_invoices": 0,
        }
        r = await api_client.get("/api/v1/ganit/stats")
        assert r.status_code == 200, r.text
        sql = mock_pool.fetchrow.call_args[0][0]
        assert "doc_status" in sql, (
            "the receivables KPI strip still counts unissued documents as "
            "outstanding, overdue and collected:\n" + sql
        )
        # Nullable-safe, or every legacy row predating the column drops out.
        assert "COALESCE(doc_status, '')" in sql, sql


class TestAReceiptGoesAgainstTheDocumentTheMoneyBelongsTo:

    async def test_a_credit_note_refuses_a_receipt(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = {**INVOICE, "invoice_type": "credit_note"}
        r = await api_client.post(
            "/api/v1/ganit/invoices/11111111-1111-1111-1111-111111111111/payments",
            json={"amount": 590, "method": "upi"},
        )
        assert r.status_code == 400, r.text
        assert "credit note" in r.text.lower()

    async def test_a_draft_refuses_a_receipt(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = {**INVOICE, "doc_status": "draft"}
        r = await api_client.post(
            "/api/v1/ganit/invoices/11111111-1111-1111-1111-111111111111/payments",
            json={"amount": 590, "method": "upi"},
        )
        assert r.status_code == 400, r.text
        assert "draft" in r.text.lower()

    async def test_an_ordinary_invoice_still_takes_one(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """THE REGRESSION GUARD. Two refusals were added to a path every
        customer receipt goes through; the ordinary case must be untouched."""
        mock_pool.fetchrow.return_value = INVOICE
        r = await api_client.post(
            "/api/v1/ganit/invoices/11111111-1111-1111-1111-111111111111/payments",
            json={"amount": 590, "method": "upi"},
        )
        assert r.status_code < 400, r.text

    async def test_the_read_actually_fetches_what_the_guards_test(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """Both guards read a column the SELECT did not previously return.
        Without this, a future edit could narrow the SELECT back and the guards
        would silently compare against None — refusing nothing, forever."""
        mock_pool.fetchrow.return_value = INVOICE
        await api_client.post(
            "/api/v1/ganit/invoices/11111111-1111-1111-1111-111111111111/payments",
            json={"amount": 590, "method": "upi"},
        )
        sql = mock_pool.fetchrow.call_args_list[0][0][0]
        assert "invoice_type" in sql, sql
        assert "doc_status" in sql, sql


class TestAComplianceFactRecordsWhenItWasEntered:

    async def test_update_vendor_stamps_updated_at(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """`ganit_vendors.updated_at` has no DEFAULT and no trigger, and this
        was the only writer that never set it — NULL on all 80 live rows. These
        are the compliance facts a 43B(h) position is argued from; when they
        were entered is part of the fact."""
        mock_pool.fetchrow.return_value = {"id": "v1", "name": "Acme"}
        r = await api_client.patch(
            "/api/v1/ganit/vendors/11111111-1111-1111-1111-111111111111",
            json={"tds_section": "194C"},
        )
        assert r.status_code < 400, r.text
        sql = mock_pool.fetchrow.call_args[0][0]
        assert "updated_at=NOW()" in sql, (
            "a vendor's compliance facts can be changed with no record of "
            "when:\n" + sql
        )

    async def test_an_empty_update_still_refuses(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The timestamp is appended AFTER the "nothing to update" guard, so a
        PATCH that names no field is still a 400 rather than a write that bumps
        a timestamp and nothing else."""
        r = await api_client.patch(
            "/api/v1/ganit/vendors/11111111-1111-1111-1111-111111111111", json={},
        )
        assert r.status_code == 400, r.text
