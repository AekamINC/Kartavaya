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
    mock_pool.fetchrow = AsyncMock(return_value={"id": ACCOUNT_ID})
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
    mock_pool.fetchrow = AsyncMock(return_value={
        "id": ACCOUNT_ID,
        "org_id": TEST_ORG_ID,
        "phone_number": "+919876543210",
        "display_name": "Test Biz",
        "waba_id": "waba_123",
        "phone_number_id": "pn_456",
        "status": "active",
    })

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

    # Inspect what was passed to the INSERT query
    insert_call = mock_pool.fetchrow.call_args
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
