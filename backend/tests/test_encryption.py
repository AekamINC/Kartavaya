"""
Unit tests for services/encryption.py — field-level Fernet encryption.

Coverage:
  encrypt()  — returns "enc::" prefix, idempotent, handles empty/None
  decrypt()  — round-trip, legacy plaintext passthrough, corrupted ciphertext
"""

import pytest
from services.encryption import encrypt, decrypt, PREFIX


# ── encrypt ──────────────────────────────────────────────────────────────────

async def test_encrypt_returns_prefixed_string():
    result = encrypt("hello world")
    assert result.startswith(PREFIX)


async def test_encrypt_decrypt_round_trip():
    original = "sensitive-data-12345"
    encrypted = encrypt(original)
    assert encrypted != original
    assert decrypt(encrypted) == original


async def test_encrypt_idempotent():
    """Already-encrypted strings pass through unchanged."""
    encrypted = encrypt("test value")
    double_encrypted = encrypt(encrypted)
    assert double_encrypted == encrypted


async def test_encrypt_empty_string():
    assert encrypt("") == ""


async def test_encrypt_none():
    assert encrypt(None) is None


# ── decrypt ──────────────────────────────────────────────────────────────────

async def test_decrypt_legacy_plaintext():
    """Strings without the enc:: prefix are returned as-is."""
    assert decrypt("plain text value") == "plain text value"


async def test_decrypt_empty_string():
    assert decrypt("") == ""


async def test_decrypt_none():
    assert decrypt(None) is None


async def test_decrypt_corrupted_ciphertext():
    """Corrupted ciphertext after the prefix returns the original string."""
    corrupted = PREFIX + "not-valid-fernet-token"
    assert decrypt(corrupted) == corrupted


async def test_round_trip_unicode():
    original = "नमस्ते दुनिया 🌍"
    assert decrypt(encrypt(original)) == original
