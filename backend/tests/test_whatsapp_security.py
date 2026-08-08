"""
Security tests for the Varta (WhatsApp Business) router.
Validates webhook signature verification, org-scoping, and token encryption.
"""
import hashlib
import hmac
import json
import os

import pytest
from unittest.mock import AsyncMock, patch

from conftest import TEST_ORG_ID


ACCOUNT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Skip the require_module('varta') subscription check for all tests."""
    from routers.whatsapp import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── Webhook signature verification ─────────────────────────────


def _make_webhook_payload() -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "12345",
                "changes": [
                    {
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {"phone_number_id": "111222"},
                            "messages": [
                                {
                                    "from": "919999999999",
                                    "id": "wamid.test",
                                    "type": "text",
                                    "text": {"body": "Hello"},
                                }
                            ],
                        },
                        "field": "messages",
                    }
                ],
            }
        ],
    }


@pytest.mark.anyio
async def test_webhook_rejects_invalid_signature(api_client, mock_pool):
    """POST /webhook with an invalid HMAC signature returns 403."""
    app_secret = "test_meta_app_secret_abc123"
    payload = json.dumps(_make_webhook_payload())

    with patch.dict(os.environ, {"META_APP_SECRET": app_secret}):
        r = await api_client.post(
            "/api/v1/whatsapp/webhook",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
            },
        )
    assert r.status_code == 403
    assert "signature" in r.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_webhook_accepts_valid_signature(api_client, mock_pool):
    """POST /webhook with a correctly computed HMAC signature succeeds."""
    app_secret = "test_meta_app_secret_abc123"
    payload_bytes = json.dumps(_make_webhook_payload()).encode()

    expected_sig = hmac.HMAC(app_secret.encode(), payload_bytes, hashlib.sha256).hexdigest()

    # The endpoint processes messages; account lookup returns None so it skips
    mock_pool.fetchrow = AsyncMock(return_value=None)

    with patch.dict(os.environ, {"META_APP_SECRET": app_secret}):
        r = await api_client.post(
            "/api/v1/whatsapp/webhook",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "x-hub-signature-256": f"sha256={expected_sig}",
            },
        )
    assert r.status_code == 200


@pytest.mark.anyio
async def test_webhook_rejects_missing_signature_header(api_client, mock_pool):
    """POST /webhook without x-hub-signature-256 returns 403 when secret is set."""
    app_secret = "test_meta_app_secret_abc123"
    payload = json.dumps(_make_webhook_payload())

    with patch.dict(os.environ, {"META_APP_SECRET": app_secret}):
        r = await api_client.post(
            "/api/v1/whatsapp/webhook",
            content=payload,
            headers={"Content-Type": "application/json"},
        )
    assert r.status_code == 403


# ── META_APP_SECRET not set — the webhook must REFUSE ──────────
#
# This block used to assert the opposite: that an empty META_APP_SECRET skipped
# signature verification and returned 200. That is the one state in which nothing
# is checking the caller at all, and the route is both unauthenticated and a
# WRITE — it creates rows in varta_contacts and varta_conversations for whichever
# org owns the phone_number_id in the body. Anyone who could guess or read a
# phone_number_id could inject messages into that org's inbox and invent contacts
# in it.
#
# `scheduler._verify_cron` has always refused when its own secret is missing.
# This now matches it.


@pytest.mark.anyio
@pytest.mark.parametrize("value", ["", "   "])
async def test_webhook_refuses_when_app_secret_is_unset(api_client, mock_pool, value):
    """An unset or blank META_APP_SECRET must fail CLOSED, not skip the check."""
    payload = json.dumps(_make_webhook_payload())
    mock_pool.fetchrow = AsyncMock(return_value=None)

    with patch.dict(os.environ, {"META_APP_SECRET": value}, clear=False):
        r = await api_client.post(
            "/api/v1/whatsapp/webhook",
            content=payload,
            headers={"Content-Type": "application/json"},
        )
    assert r.status_code == 503, (
        "an unconfigured webhook secret must refuse the request — this endpoint "
        "is unauthenticated and writes to varta_contacts/varta_conversations"
    )


@pytest.mark.anyio
async def test_webhook_refuses_forged_body_when_secret_is_unset(api_client, mock_pool):
    """The concrete attack: a forged inbound message with no signature at all."""
    mock_pool.fetchrow = AsyncMock(return_value=None)

    with patch.dict(os.environ, {"META_APP_SECRET": ""}, clear=False):
        r = await api_client.post(
            "/api/v1/whatsapp/webhook",
            content=json.dumps(_make_webhook_payload()),
            headers={"Content-Type": "application/json"},
        )
    assert r.status_code != 200


@pytest.mark.anyio
async def test_webhook_does_not_log_message_body_or_phone_number(
    api_client, mock_pool, caplog
):
    """The payload carries a customer's phone number and the text they sent.

    Logging it puts both in the application log, where they outlive the retention
    policy that governs the conversation itself.
    """
    import logging

    app_secret = "test_meta_app_secret_abc123"
    payload_bytes = json.dumps(_make_webhook_payload()).encode()
    expected_sig = hmac.new(
        app_secret.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()
    mock_pool.fetchrow = AsyncMock(return_value=None)

    with caplog.at_level(logging.INFO):
        with patch.dict(os.environ, {"META_APP_SECRET": app_secret}):
            await api_client.post(
                "/api/v1/whatsapp/webhook",
                content=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "x-hub-signature-256": f"sha256={expected_sig}",
                },
            )

    logged = caplog.text
    assert "919999999999" not in logged, "customer phone number written to the log"
    assert "Hello" not in logged, "message body written to the log"


# ── GET /webhook verify token ──────────────────────────────────


@pytest.mark.anyio
async def test_webhook_verify_rejects_invalid_token(api_client, mock_pool):
    """GET /webhook with an unrecognised verify_token returns 403."""
    mock_pool.fetchrow = AsyncMock(return_value=None)  # no matching account
    r = await api_client.get(
        "/api/v1/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong-token",
            "hub.challenge": "challenge123",
        },
    )
    assert r.status_code == 403


@pytest.mark.anyio
async def test_webhook_verify_accepts_valid_token(api_client, mock_pool):
    """GET /webhook returns the challenge when verify_token matches a stored account."""
    # `status` is now read too: a successful handshake promotes a `pending`
    # account to `active`, which is what makes the connect flow terminate.
    # See test_varta_window_and_connect.py for that transition specifically.
    mock_pool.fetchrow = AsyncMock(return_value={"id": ACCOUNT_ID, "status": "active"})
    r = await api_client.get(
        "/api/v1/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "my-verify-token",
            "hub.challenge": "challenge_abc",
        },
    )
    assert r.status_code == 200
    assert r.text == "challenge_abc"


# ── WABA accounts are org-scoped ───────────────────────────────


@pytest.mark.anyio
async def test_list_accounts_scoped_to_org(api_client, as_admin, with_org_id, mock_pool):
    """list_accounts query must include the org_id filter."""
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/whatsapp/accounts")
    assert r.status_code == 200

    call_args = mock_pool.fetch.call_args
    assert TEST_ORG_ID in call_args.args


@pytest.mark.anyio
async def test_list_accounts_requires_auth(api_client):
    r = await api_client.get("/api/v1/whatsapp/accounts")
    assert r.status_code in (401, 403)


# ── Access tokens encrypted before storage ─────────────────────


@pytest.mark.anyio
async def test_access_token_encrypted_on_create(api_client, as_admin, with_org_id, mock_pool):
    """When creating a WABA account, the access_token must be encrypted (enc:: prefix)."""
    # TWO queries now, so a single return_value is no longer the right shape:
    # create_account first checks whether this phone_number_id is already
    # connected to the org (a second row makes the webhook's account lookup
    # non-deterministic), and only then INSERTs. `None` is "no clash".
    mock_pool.fetchrow = AsyncMock(side_effect=[
        None,
        {
            "id": ACCOUNT_ID,
            "org_id": TEST_ORG_ID,
            "phone_number": "+919876543210",
            "display_name": "Test Biz",
            "waba_id": "waba_123",
            "phone_number_id": "pn_456",
            "status": "pending",
        },
    ])

    r = await api_client.post(
        "/api/v1/whatsapp/accounts",
        json={
            "phone_number": "+919876543210",
            "display_name": "Test Biz",
            "waba_id": "waba_123",
            "phone_number_id": "pn_456",
            "access_token": "EAAGm0PX4Zxyz_PLAINTEXT",
            "webhook_verify_token": "my-verify",
        },
    )
    assert r.status_code == 201

    # Inspect what was passed to the INSERT query — the LAST fetchrow, since the
    # duplicate pre-check is the first.
    insert_call = mock_pool.fetchrow.call_args_list[-1]
    # args[0] is the SQL string; $6 is the 6th query param = args[6]
    encrypted_token = insert_call.args[6]
    assert encrypted_token.startswith("enc::"), (
        "Access token must be encrypted before storage"
    )


def test_encrypt_decrypt_roundtrip():
    """Verify the encrypt/decrypt functions produce a recoverable ciphertext."""
    from services.encryption import encrypt, decrypt

    plaintext = "EAAGm0PX4Zxyz_PLAINTEXT_TOKEN"
    ciphertext = encrypt(plaintext)
    assert ciphertext.startswith("enc::")
    assert ciphertext != plaintext
    assert decrypt(ciphertext) == plaintext


def test_encrypt_idempotent():
    """Encrypting an already-encrypted value returns it unchanged."""
    from services.encryption import encrypt

    plaintext = "some_token"
    once = encrypt(plaintext)
    twice = encrypt(once)
    assert once == twice


# ── P7 · the outbound call to Meta ───────────────────────────────────────────
#
# Everything around this already worked — the 24-hour window, template approval,
# token decryption. What did not exist was the SEND: the row went in `pending`,
# the UI reported success, and the customer received nothing. These pin the
# behaviour that makes that impossible to reintroduce.

import pytest
from fastapi import HTTPException

from routers.whatsapp import _template_payload, _send_via_meta


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


class _Client:
    """Stands in for httpx.AsyncClient. Never reaches the network — a test that
    posted to Graph would send a real WhatsApp message to a real number."""

    def __init__(self, resp=None, raise_with=None):
        self.resp = resp
        self.raise_with = raise_with
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.raise_with:
            raise self.raise_with
        return self.resp


def _patch(monkeypatch, client):
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: client)


OK = _Resp(200, {"messages": [{"id": "wamid.ABC123"}]})


class TestTemplatePayload:
    def test_body_parameters_are_ordered_deterministically(self):
        """Meta matches `{{1}}`, `{{2}}` BY POSITION. The stored params are a
        JSON object, which has no inherent order — so an unstable order would
        put the amount where the invoice number belongs on some sends and not
        others, and only in front of a customer."""
        t = {"name": "invoice_due", "language": "en"}
        a = _template_payload(t, {"b_amount": "₹14,160", "a_number": "INV-1"})
        b = _template_payload(t, {"a_number": "INV-1", "b_amount": "₹14,160"})
        assert a == b
        assert [p["text"] for p in a["components"][0]["parameters"]] == ["INV-1", "₹14,160"]

    def test_a_template_with_no_parameters_sends_no_components(self):
        # Meta rejects an empty components array rather than ignoring it.
        assert "components" not in _template_payload({"name": "hi", "language": "en"}, {})

    def test_the_language_falls_back_rather_than_sending_null(self):
        assert _template_payload({"name": "hi", "language": None}, {})["language"]["code"] == "en"


class TestSend:
    async def test_it_returns_metas_id_so_delivery_receipts_can_match(self, monkeypatch):
        """`wa_message_id` is the ONLY thing the statuses webhook matches on. A
        message stored without it sits at `pending` for ever and every receipt
        for it is dropped."""
        c = _Client(OK)
        _patch(monkeypatch, c)
        wamid = await _send_via_meta(
            phone_number_id="123", token="tok", to="919820041120",
            text="hello", template=None, params={}, pool=None, account_id=None)
        assert wamid == "wamid.ABC123"

    async def test_a_link_never_renders_someone_elses_preview_card(self, monkeypatch):
        c = _Client(OK)
        _patch(monkeypatch, c)
        await _send_via_meta(phone_number_id="123", token="tok", to="91982",
                             text="pay here https://pay.kartavaya.com/i/x",
                             template=None, params={}, pool=None, account_id=None)
        assert c.calls[0]["json"]["text"]["preview_url"] is False

    async def test_the_token_travels_in_the_header_not_the_body(self, monkeypatch):
        c = _Client(OK)
        _patch(monkeypatch, c)
        await _send_via_meta(phone_number_id="123", token="secret-tok", to="91982",
                             text="hi", template=None, params={}, pool=None, account_id=None)
        assert c.calls[0]["headers"]["Authorization"] == "Bearer secret-tok"
        assert "secret-tok" not in str(c.calls[0]["json"])

    async def test_the_graph_version_is_pinned(self, monkeypatch):
        """`latest` breaks a working integration when Meta changes a payload
        shape — the lesson the Gemini models already taught, expensively."""
        c = _Client(OK)
        _patch(monkeypatch, c)
        await _send_via_meta(phone_number_id="123", token="t", to="91982",
                             text="hi", template=None, params={}, pool=None, account_id=None)
        assert "/v21.0/" in c.calls[0]["url"]

    async def test_a_2xx_with_no_id_is_a_failure_not_a_success(self, monkeypatch):
        """Accepted-with-no-id would store a row no receipt can ever match."""
        _patch(monkeypatch, _Client(_Resp(200, {"messages": []})))
        with pytest.raises(HTTPException) as e:
            await _send_via_meta(phone_number_id="1", token="t", to="9", text="x",
                                 template=None, params={}, pool=None, account_id=None)
        assert e.value.status_code == 502

    async def test_a_timeout_does_not_claim_the_message_was_sent(self, monkeypatch):
        """We do not know whether it went. Saying it did is the worse lie."""
        import httpx
        _patch(monkeypatch, _Client(raise_with=httpx.TimeoutException("slow")))
        with pytest.raises(HTTPException) as e:
            await _send_via_meta(phone_number_id="1", token="t", to="9", text="x",
                                 template=None, params={}, pool=None, account_id=None)
        assert e.value.status_code == 504
        assert "may or may not" in e.value.detail

    async def test_a_dead_token_marks_the_account_failed(self, monkeypatch):
        """A number that cannot send must stop looking connected, or every later
        send queues silently against it."""
        marked = []

        async def _fail(pool, account_id):
            marked.append(account_id)

        import routers.whatsapp as wa
        monkeypatch.setattr(wa, "_mark_account_failed", _fail)
        _patch(monkeypatch, _Client(_Resp(401, {"error": {"code": 190, "message": "bad token"}})))

        with pytest.raises(HTTPException) as e:
            await _send_via_meta(phone_number_id="1", token="t", to="9", text="x",
                                 template=None, params={}, pool=None, account_id="acc-1")
        assert e.value.status_code == 409
        assert marked == ["acc-1"]
        assert "Reconnect" in e.value.detail

    async def test_an_undeliverable_number_says_so_and_names_an_alternative(self, monkeypatch):
        _patch(monkeypatch, _Client(_Resp(400, {"error": {"code": 131026, "message": "x"}})))
        with pytest.raises(HTTPException) as e:
            await _send_via_meta(phone_number_id="1", token="t", to="9", text="x",
                                 template=None, params={}, pool=None, account_id=None)
        assert "not be on WhatsApp" in e.value.detail

    async def test_an_unknown_error_is_reported_verbatim(self, monkeypatch):
        """A wrong guess about an error we have not seen is worse than the raw
        text — the person reading it can at least search for that."""
        _patch(monkeypatch, _Client(_Resp(400, {"error": {"code": 999999, "message": "flux capacitor"}})))
        with pytest.raises(HTTPException) as e:
            await _send_via_meta(phone_number_id="1", token="t", to="9", text="x",
                                 template=None, params={}, pool=None, account_id=None)
        assert "flux capacitor" in e.value.detail
