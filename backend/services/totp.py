"""
totp.py — TOTP (RFC 6238) two-factor authentication.

Secret generation/provisioning-URI, code verification with a replay guard,
and hashed single-use recovery codes. Used by `routers/totp.py` (self-service
enrolment) and `auth_router.py` (the login challenge). Kept separate from
both so neither has to import the other — `auth_router.py` is imported very
early and a circular import here would be a hard failure, not a warning.

WHY A SEPARATE MODULE FOR RECOVERY-CODE HASHING RATHER THAN REUSING PASSWORD
HASHING: `auth_router._hash_password` runs 260,000 PBKDF2 iterations because a
password is chosen by a human and the stretching defends a low-entropy input
against offline guessing. A recovery code here is `secrets.choice` over a
32-symbol alphabet at length 10 — about 50 bits, closer to a session token
than a password — so a keyed hash (HMAC-SHA256 under JWT_SECRET) is the right
cost: it is not brute-forceable at that entropy either way, and PBKDF2 would
only add latency to something already unguessable. It is HMAC and not bare
SHA-256 so a database dump alone (without JWT_SECRET) cannot even attempt a
dictionary check.
"""
import hashlib
import hmac
import logging
import os
import secrets
import time

import pyotp

from services.encryption import decrypt, encrypt

logger = logging.getLogger(__name__)

ISSUER = "Kartavaya"

STEP_SECONDS = 30
#: How many steps either side of "now" a submitted code is accepted from —
#: the standard clock-skew tolerance. Combined with the replay guard
#: (`last_used_step`), a code is usable exactly once, within roughly a
#: 90-second window of when it was generated.
VALID_WINDOW = 1

RECOVERY_CODE_COUNT = 10
#: No 0/O/1/I/L — the four pairs a human misreads or mistypes most often in a
#: code they are about to hand-copy into a text box.
RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
RECOVERY_CODE_LENGTH = 10  # log2(32) * 10 ≈ 50 bits


def generate_secret() -> str:
    """A fresh base32 TOTP secret. Caller encrypts before persisting."""
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_email: str) -> str:
    """`otpauth://` URI for a QR code — what an authenticator app scans."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=account_email, issuer_name=ISSUER
    )


def current_step() -> int:
    return int(time.time() // STEP_SECONDS)


def verify_code(secret: str, code: str, last_used_step: int | None) -> tuple[bool, int | None]:
    """Check a 6-digit code against `secret`.

    Returns `(True, step)` on success — `step` is what the caller must
    persist as the new `last_used_step` — or `(False, None)`.

    REPLAY GUARD: a step at or before `last_used_step` is skipped even if the
    code computed for it is correct. Without this, the same 6 digits work
    for the whole ~90-second window they are valid in, which is a genuine
    login already succeeded once with them — this is a "step already spent"
    check, not just a formatting one.
    """
    text = (code or "").strip()
    if not text or not text.isdigit() or len(text) != 6:
        return False, None
    totp = pyotp.totp.TOTP(secret)
    now_step = current_step()
    for offset in range(-VALID_WINDOW, VALID_WINDOW + 1):
        step = now_step + offset
        if last_used_step is not None and step <= last_used_step:
            continue
        candidate = totp.at(step * STEP_SECONDS)
        if hmac.compare_digest(candidate, text):
            return True, step
    return False, None


def encrypt_secret(secret: str) -> str:
    return encrypt(secret)


def decrypt_secret(stored: str) -> str:
    return decrypt(stored)


def generate_recovery_codes(n: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Plaintext codes for one-time display. Never persisted as returned —
    the caller hashes each with `hash_recovery_code` before storage."""
    return [
        "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(RECOVERY_CODE_LENGTH))
        for _ in range(n)
    ]


def format_recovery_code(code: str) -> str:
    """`ABCDEFGHJK` -> `ABCDE-FGHJK`, for display only. Hashing normalises
    the dash back out, so a user pasting either form still matches."""
    return f"{code[:5]}-{code[5:]}" if len(code) == RECOVERY_CODE_LENGTH else code


def _normalise_recovery_code(code: str) -> str:
    return (code or "").strip().upper().replace("-", "").replace(" ", "")


def _pepper() -> bytes:
    key = os.environ.get("JWT_SECRET", "")
    if not key:
        raise RuntimeError(
            "JWT_SECRET must be set to hash recovery codes — refusing to key "
            "a security-relevant HMAC off an empty string."
        )
    return key.encode()


def hash_recovery_code(code: str) -> str:
    normalised = _normalise_recovery_code(code)
    return hmac.new(_pepper(), normalised.encode(), hashlib.sha256).hexdigest()


def recovery_code_matches(code: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_recovery_code(code), stored_hash)


def looks_like_recovery_code(code: str) -> bool:
    """True if `code` is shaped like a recovery code rather than a 6-digit
    TOTP — used by /verify-2fa to route to the right check without trying
    both against every attempt (which would double the timing surface).

    Length alone is the correct and sufficient test: a TOTP code is always
    exactly 6 digits and a recovery code is always exactly 10 characters, so
    the two shapes never overlap — checking character content too would only
    risk misrouting the rare recovery code that happens to land on all
    digits (the alphabet includes 2-9)."""
    return len(_normalise_recovery_code(code)) == RECOVERY_CODE_LENGTH
