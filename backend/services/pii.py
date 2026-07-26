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
"""
from typing import Optional


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


def mask_bank(details: Optional[dict]) -> Optional[dict]:
    """Mask the account number only. Returns a copy — never mutates the input."""
    if not details:
        return details
    out = dict(details)
    if out.get("account_number"):
        out["account_number"] = mask_tail(out["account_number"], 4)
    return out
