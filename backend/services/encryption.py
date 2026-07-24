"""
encryption.py — Field-level encryption for sensitive data at rest.
Uses Fernet (AES-128-CBC + HMAC-SHA256) from the cryptography library.
Key derived from FIELD_ENCRYPTION_KEY env var, falling back to JWT_SECRET.
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_KEY_ENV = os.getenv("FIELD_ENCRYPTION_KEY", "") or os.getenv("JWT_SECRET", "")
_FERNET_KEY = base64.urlsafe_b64encode(hashlib.sha256(_KEY_ENV.encode()).digest())
_fernet = Fernet(_FERNET_KEY)

PREFIX = "enc::"


def encrypt(plaintext: str) -> str:
    if not plaintext or plaintext.startswith(PREFIX):
        return plaintext
    return PREFIX + _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    if not ciphertext or not ciphertext.startswith(PREFIX):
        return ciphertext
    try:
        return _fernet.decrypt(ciphertext[len(PREFIX):].encode()).decode()
    except InvalidToken:
        return ciphertext
