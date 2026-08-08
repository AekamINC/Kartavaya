"""`GET /api/v1/pay/{token}` — the only unauthenticated route that returns
invoice data.

The happy path is the least interesting thing here. What these pin is the
behaviour that stops a forwarded link becoming a leak:

  · every refusal is the SAME 404, so a real token cannot be distinguished from
    a guess by the shape of the answer
  · the response is an ALLOW-LIST, so a column added to `ganit_invoices` later
    cannot join the public payload by accident
  · no identifier that addresses another API leaves the building
"""
import pytest

TOKEN = "dntsbrOISlW76ldv"  # 16 chars, base64url — the shape migration 128 mints

BASE_ROW = {
    # Selected so the payable addresses can be looked up, and deliberately NOT
    # returned to the caller — `test_response_carries_no_identifier…` pins that.
    "org_id": "045b76ad-0000-0000-0000-000000000000",
    # `to_regclass` for `org_upi_accounts` shares this fetchrow mock. FALSE here
    # keeps the default row on the pre-129 fallback path, so every test that is
    # not about P3b keeps testing what it was written to test.
    "ok": False,
    "invoice_number": "INV-2026-0087",
    "invoice_type": "tax_invoice",
    "invoice_date": None,
    "due_date": None,
    "line_items": [
        {"description": "Office fit-out", "hsn_code": "995461", "quantity": 1,
         "rate": 425000, "gst_rate": 18, "amount": 425000,
         # Keys that exist in stored line items and must NOT come out.
         "product_id": "prod_secret", "cost_price": 300000},
    ],
    "subtotal": 425000, "cgst": 38250, "sgst": 38250, "igst": 0,
    "cess": 0, "discount": 0, "total": 501500, "balance_due": 501500,
    "payment_status": "unpaid", "doc_status": "final", "cancelled_at": None,
    "currency": "INR", "notes": "", "terms": "", "place_of_supply": "Maharashtra",
    "org_name": "Aekam Inc", "org_gstin": "27AAACA1234M1Z8", "org_logo_url": None,
    "org_upi_vpa": "aekam@hdfcbank", "org_upi_payee_name": "Aekam Inc",
    "billed_to_name": "Tata Steel",
}


def _row(**over):
    return {**BASE_ROW, **over}


@pytest.fixture(autouse=True)
def _forget_the_migration_probe():
    """`pay._upi_table` caches TRUE for the process.

    That is right in production — the probe must not re-run per request — and
    wrong across tests, where one test proving the post-129 path would leave
    every later test on it. Cleared around each test rather than each test
    remembering to.
    """
    import routers.pay as pay
    pay._upi_table = False
    yield
    pay._upi_table = False


async def test_public_invoice_needs_no_authentication(api_client, mock_pool):
    """No token, no cookie, no org header — this is the whole point of P2."""
    mock_pool.fetchrow.return_value = _row()
    resp = await api_client.get(f"/api/v1/pay/{TOKEN}")
    assert resp.status_code == 200
    assert resp.json()["invoice"]["number"] == "INV-2026-0087"


async def test_response_carries_no_identifier_that_addresses_another_api(api_client, mock_pool):
    """A forwarded link must not hand anyone an id they can replay elsewhere."""
    mock_pool.fetchrow.return_value = _row()
    body = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()
    flat = str(body)
    for leaked in ("org_id", "client_id", "contact_id", "invoice_id",
                   "created_by", "prod_secret"):
        assert leaked not in flat, f"{leaked} reached the public payload"


async def test_line_items_are_allow_listed_not_passed_through(api_client, mock_pool):
    """Stored lines carry internal costing. Only what the paper invoice prints."""
    mock_pool.fetchrow.return_value = _row()
    line = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()["lines"][0]
    assert set(line) == {"description", "hsn_code", "quantity", "rate", "gst_rate", "amount"}
    assert "cost_price" not in line


async def test_no_payment_history_is_disclosed(api_client, mock_pool):
    """Who paid what and when is the firm's business, not the recipient's — a
    partially-paid invoice forwarded onward would otherwise disclose the
    customer's payment behaviour. One number: what is still owed."""
    mock_pool.fetchrow.return_value = _row(payment_status="partial", balance_due=100000)
    body = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()
    assert body["totals"]["amount_due"] == 100000
    assert "payments" not in body and "amount_paid" not in str(body)


async def test_partial_stays_reachable(api_client, mock_pool):
    """A balance is still owed, and collecting it is what the link is for."""
    mock_pool.fetchrow.return_value = _row(payment_status="partial")
    assert (await api_client.get(f"/api/v1/pay/{TOKEN}")).status_code == 200


@pytest.mark.parametrize("over", [
    {"payment_status": "paid"},                    # settled
    {"cancelled_at": "2026-08-01T00:00:00Z"},      # cancelled
    {"doc_status": "draft"},                       # never issued to anybody
])
async def test_unavailable_invoices_are_404(api_client, mock_pool, over):
    mock_pool.fetchrow.return_value = _row(**over)
    assert (await api_client.get(f"/api/v1/pay/{TOKEN}")).status_code == 404


async def test_unknown_token_and_settled_invoice_are_indistinguishable(api_client, mock_pool):
    """THE ONE THAT MATTERS. A 403 on a real token — or a different message —
    confirms the token is real, which is the single bit a guesser wants."""
    mock_pool.fetchrow.return_value = None
    unknown = await api_client.get(f"/api/v1/pay/{TOKEN}")

    mock_pool.fetchrow.return_value = _row(payment_status="paid")
    settled = await api_client.get(f"/api/v1/pay/{TOKEN}")

    assert unknown.status_code == settled.status_code == 404
    assert unknown.json() == settled.json()


@pytest.mark.parametrize("bad", [
    "short", "waytoolongtobeavalidtoken", "has spaces here!", "../../etc/passwd",
])
async def test_malformed_tokens_are_refused_without_a_query(api_client, mock_pool, bad):
    """A scan of junk paths must cost a string comparison, not a round trip."""
    mock_pool.fetchrow.reset_mock()
    resp = await api_client.get(f"/api/v1/pay/{bad}")
    assert resp.status_code == 404
    assert not mock_pool.fetchrow.called


async def test_payable_is_absent_when_the_org_set_no_upi_address(api_client, mock_pool):
    """Most organisations have no UPI address today, so this is a NORMAL case.
    Absent, not an empty string: an empty VPA would be drawn as a valid,
    unscannable QR code."""
    mock_pool.fetchrow.return_value = _row(org_upi_vpa=None)
    body = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()
    assert body["payable"] is None


# ── P3b: one receiving address PER PLATFORM ──────────────────────────────────
#
# The firm holds separate Paytm/PhonePe/GPay accounts, each settling separately.
# UPI's interoperability means the customer can pay any of them from any app; it
# does not mean the firm has one account. `payable` therefore carries a LIST,
# which is a breaking change to a contract P2 already shipped.

async def test_payable_lists_every_active_account_default_first(api_client, mock_pool):
    """Order IS the contract: the first entry is the org's default.

    Carrying the default as a separate field beside the list would give the page
    two things to believe and a way for them to disagree — and the disagreement
    would be "Other UPI app" paying an account the firm did not choose.
    """
    mock_pool.fetchrow.return_value = _row(ok=True)
    mock_pool.fetch.return_value = [
        {"platform": "phonepe", "vpa": "unicode@ybl", "payee_name": "Unicode Group"},
        {"platform": "paytm", "vpa": "9428251061@paytm", "payee_name": None},
    ]
    body = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()

    assert [a["platform"] for a in body["payable"]["accounts"]] == ["phonepe", "paytm"]
    assert body["payable"]["accounts"][0]["vpa"] == "unicode@ybl"
    # A row with no payee name falls back to the org's name at READ time, so a
    # firm that renames itself does not have to re-save every row.
    assert body["payable"]["accounts"][1]["payee_name"] == "Aekam Inc"
    assert body["payable"]["amount"] == 501500


async def test_pre_129_databases_still_offer_the_single_address(api_client, mock_pool):
    """The table may not exist yet — staging and production share one database
    and this code can reach the older schema. Losing the Pay button on a page
    that had one is not an acceptable way to discover that."""
    mock_pool.fetchrow.return_value = _row(ok=False)
    body = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()
    assert [a["vpa"] for a in body["payable"]["accounts"]] == ["aekam@hdfcbank"]


async def test_no_internal_account_fields_reach_the_payload(api_client, mock_pool):
    """The row carries `is_default`, `is_active` and `sort_order`. None of them
    are the customer's business, and an allow-list is what keeps a column added
    later from joining the public response on its own."""
    mock_pool.fetchrow.return_value = _row(ok=True)
    mock_pool.fetch.return_value = [
        {"platform": "gpay", "vpa": "unicode@okhdfcbank", "payee_name": "Unicode"},
    ]
    account = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()["payable"]["accounts"][0]
    assert set(account) == {"platform", "label", "vpa", "payee_name"}


async def test_the_response_never_promises_an_instant_receipt(api_client, mock_pool):
    """There is no gateway and so no callback. `status` is only ever what bank
    reconciliation last said, and the payload has to say so where the page can
    read it rather than in a comment nobody renders."""
    mock_pool.fetchrow.return_value = _row()
    body = (await api_client.get(f"/api/v1/pay/{TOKEN}")).json()
    assert body["settlement"]["instant_confirmation"] is False
    assert body["settlement"]["note"]
