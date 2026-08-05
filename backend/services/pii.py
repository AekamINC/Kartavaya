"""
pii.py — Masking helpers for identity documents and bank details.

Extracted from `routers/manav.py` so Vetana can apply the same rules. The two
modules read the *same* columns off `staging.manav_employees` — PAN, UAN and
`bank_details` appear on a payslip as well as on an employee record — so if the
masking lived in only one of them the other would keep leaking. One
implementation, imported by both.

Rules, unchanged from the Manav fix:

  - Mask all but the last four characters. The tail is what a human uses to
    confirm "yes, that is my account", and four is not enough to reconstruct.
  - NULL and '' pass through untouched, so the UI can still tell "not on file"
    from "hidden". A masked empty string would be a lie.
  - Only the account number is masked in a bank record. IFSC, bank name and
    branch are public routing information, and the holder's name is already on
    the row beside it.

Encryption at rest, added later
-------------------------------
The account number is also held as ciphertext, which the rest of this file's
history explains the absence of. `routers/manav.py` records why it was left in
plaintext: "`pan` and `bank_details` are masked on read like aadhaar but are
NOT encrypted, for one reason: Vetana reads both off this table when it builds
a payslip, so encrypting them means finding and fixing every reader." That
reason was a statement about unfinished work, not a decision that the field is
less sensitive than an Aadhaar — and the readers have now been enumerated.
There are five sites in three files, and four of them read the value:

  · `routers/manav.py:_decrypt_cols` — covers both the detail view and the
    audited reveal, which are the only two places that select the column there.
  · `routers/vetana.py:_mask_payslip_row` — the payslip register.
  · `routers/vetana.py` payroll-run — builds the PDF for the whole run.
  · `routers/vetana.py` payslip PDF — the single-slip download.

All four now go through `decrypt_bank` below. The fifth is
`services/skills/data/payroll_readiness.py`, which tests
`bank_details->>'account_number'` for EMPTINESS in SQL and never reads the
value; ciphertext is non-empty, so it keeps answering the same question
correctly and needed no change.

`encrypt`/`decrypt` pass plaintext through unchanged, so rows written before
this keep working and no backfill is required for the field to be readable. The
tradeoff is the one `services/encryption.py` states in its own header and it is
inherited whole: this defeats a database dump and a leaked read-only connection
string, it does not defeat anything that can read the environment, and rotating
the key without re-encrypting makes the column unreadable.
"""
import json
from typing import Optional

from services.encryption import decrypt, encrypt, is_encrypted


def mask_tail(value: Optional[str], keep: int = 4, group: Optional[int] = None) -> Optional[str]:
    """Mask all but the last `keep` characters.

    `group` inserts a space every `group` characters, which is how Aadhaar is
    printed (4-4-4) and therefore how people check it.
    """
    if not value:
        return value
    s = str(value).strip()
    if len(s) <= keep:
        return "•" * len(s)
    masked = "•" * (len(s) - keep) + s[-keep:]
    if group:
        return " ".join(masked[i:i + group] for i in range(0, len(masked), group))
    return masked


def _as_dict(details) -> Optional[dict]:
    """A mapping, from whatever the column produced. Shared by the three
    functions below so they cannot disagree about what a malformed value is.

    Accepts a STRING as well as a mapping, and that is not defensive
    programming for its own sake. `manav_employees.bank_details` is jsonb, and a
    write path that dumped before binding stored a JSON *string* instead of an
    object; `dict("{}")` raises, so **`GET /v1/manav/employees/{id}` returned
    500 for every employee in the org**. The write path is fixed and the rows
    repaired, but a masker that dies on a malformed value takes the whole record
    with it — one bad field should cost that field, not the endpoint.
    """
    if not details:
        return details
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except (ValueError, TypeError):
            return {}
    if not isinstance(details, dict):
        return {}
    return details


def mask_bank(details) -> Optional[dict]:
    """Mask the account number only. Returns a copy — never mutates the input.

    Ciphertext is NOT masked into a plausible-looking tail. Masking
    `enc::gAAAAAB…` would render the last four characters of a Fernet token in
    the place a human reads the last four digits of their account — a number
    that means nothing, presented as though it means something, with no way to
    tell the difference from the outside. A caller that reaches here without
    decrypting first gets a value that says so instead.
    """
    details = _as_dict(details)
    if not isinstance(details, dict):
        return details
    out = dict(details)
    account = out.get("account_number")
    if account:
        out["account_number"] = (
            "(encrypted — not decrypted for display)"
            if is_encrypted(account) else mask_tail(account, 4)
        )
    return out


def encrypt_bank(details) -> Optional[dict]:
    """Copy of a bank record with the account number enciphered.

    The account number ONLY, matching what `mask_bank` hides: the IFSC, bank
    name and branch are public routing information that identifies a branch
    rather than a person, and encrypting them would cost the ability to query
    them without buying anything.

    `encrypt()` is idempotent and returns blank values untouched, so this is
    safe to call on a partial update and on a record that carries no account.
    """
    details = _as_dict(details)
    if not isinstance(details, dict):
        return details
    out = dict(details)
    if out.get("account_number"):
        out["account_number"] = encrypt(str(out["account_number"]))
    return out


def decrypt_bank(details) -> Optional[dict]:
    """Copy of a bank record with the account number in plaintext.

    Call at the point of READ, before masking and before the payslip builder
    sees the record, so everything downstream keeps working in plaintext and
    needs no knowledge of how the column is stored — the same shape
    `routers/manav.py:_decrypt_cols` uses for the Aadhaar column.

    A value that is still marked after `decrypt()` did not open: the key
    changed. It is left marked rather than blanked, so `mask_bank` can refuse it
    and a caller can tell "the key is wrong" from "there is no account".
    """
    details = _as_dict(details)
    if not isinstance(details, dict):
        return details
    out = dict(details)
    if out.get("account_number"):
        out["account_number"] = decrypt(str(out["account_number"]))
    return out
