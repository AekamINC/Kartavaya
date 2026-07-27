"""
encryption.py — Field-level encryption for sensitive data at rest.
Uses Fernet (AES-128-CBC + HMAC-SHA256) from the cryptography library.

Key comes from FIELD_ENCRYPTION_KEY, falling back to JWT_SECRET.

WHAT THIS PROTECTS AGAINST, stated plainly: a database dump, a leaked
read-only connection string, and Supabase support access. The key lives in an
environment variable, so it sits beside the data in any compromise that reads
env. That is a real improvement over plaintext and it is NOT a KMS. Do not
describe a column protected by this as "encrypted" without that qualification.
"""
import base64
import hashlib
import logging
import os

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

PREFIX = "enc::"

_fernet: Fernet | None = None
_key_source: str | None = None


def _get_fernet() -> Fernet:
    """Resolve the key on first use, not at import.

    Lazy on purpose. At import time this module used to do

        _KEY_ENV = os.getenv("FIELD_ENCRYPTION_KEY", "") or os.getenv("JWT_SECRET", "")

    which has two failure modes that both end in silent data loss:

      1. With NEITHER variable set, `_KEY_ENV` is "" and the key becomes
         sha256("") — a fixed, publicly derivable value. Every field would be
         "encrypted" under a key anyone can reproduce, with no error anywhere.
         That is worse than plaintext, because it reads as protected.
      2. Import order decided the key. Anything importing this before the
         environment was populated silently got a different key than a later
         importer, and the mismatch only shows up as an unreadable field.

    Resolving on first call fixes both, and lets tests set the environment
    whenever they like.
    """
    global _fernet, _key_source
    if _fernet is not None:
        return _fernet

    explicit = os.getenv("FIELD_ENCRYPTION_KEY", "")
    fallback = os.getenv("JWT_SECRET", "")
    raw = explicit or fallback

    if not raw:
        raise RuntimeError(
            "Neither FIELD_ENCRYPTION_KEY nor JWT_SECRET is set. Refusing to "
            "derive an encryption key from an empty string — that key is "
            "sha256(\"\"), which is public knowledge, and data written under it "
            "is not protected at all."
        )

    if not explicit:
        # Loud, because the consequence is delayed and looks like corruption.
        # Rotating JWT_SECRET re-keys every encrypted field at once; nothing
        # fails at rotation time, and the damage surfaces later as unreadable
        # values. Every field encrypted under this fallback shares its fate
        # with the auth secret.
        logger.warning(
            "FIELD_ENCRYPTION_KEY is not set — falling back to JWT_SECRET. "
            "Rotating JWT_SECRET will make every encrypted field permanently "
            "unreadable. Set FIELD_ENCRYPTION_KEY explicitly."
        )

    _key_source = "FIELD_ENCRYPTION_KEY" if explicit else "JWT_SECRET"
    _fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()))
    return _fernet


def key_source() -> str:
    """Which variable the live key came from. For diagnostics and for the
    backfill's pre-flight check, which must not run under the fallback."""
    _get_fernet()
    return _key_source or "unknown"


def is_encrypted(value) -> bool:
    """Does this value carry the ciphertext marker?

    Useful after `decrypt()`, which returns its input unchanged when the token
    will not open. A value that is still marked after a decrypt attempt was NOT
    decrypted, and handing it to a caller as though it were the real thing is
    the failure this predicate exists to catch.
    """
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(plaintext: str) -> str:
    if not plaintext or plaintext.startswith(PREFIX):
        return plaintext
    return PREFIX + _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    if not ciphertext or not ciphertext.startswith(PREFIX):
        return ciphertext
    try:
        return _get_fernet().decrypt(ciphertext[len(PREFIX):].encode()).decode()
    except InvalidToken:
        # Pass-through is deliberate and load-bearing: callers hold a mix of
        # legacy plaintext and ciphertext, and raising here would break reads
        # of rows written before encryption. But an UNOPENABLE token is not
        # data — it means the key changed — so say so. Callers that must not
        # serve ciphertext should test the result with `is_encrypted()`.
        logger.error(
            "decrypt failed: token did not open under the current key (source: "
            "%s). The key has changed, or the value was written under a "
            "different one. Returning the ciphertext unchanged.",
            _key_source,
        )
        return ciphertext


def _reset_for_tests() -> None:
    """Drop the cached key so a test can change the environment and re-resolve."""
    global _fernet, _key_source
    _fernet = None
    _key_source = None
