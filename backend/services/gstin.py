"""
gstin.py — real GSTIN validation, and the rule about when one is mandatory.

Before this module the codebase accepted a GSTIN as `gstin: str = ""` and stored
whatever arrived. "abc" was a GSTIN. A number with a transposed digit was a
GSTIN. Nothing checked the length, the layout or the check digit, so the first
time a wrong number was noticed was when the recipient's input tax credit was
refused — months later, on a document already filed.

A GSTIN carries its own check digit precisely so that a typo can be caught at
entry. Not checking it throws away the one guarantee the format offers.

Layout — 15 characters:

    27  AAACA1234M  1     Z   8
    │   │           │     │   └── check digit, base-36 over the first 14
    │   │           │     └────── literal 'Z' (reserved)
    │   │           └──────────── registration count for that PAN within the state
    │   └──────────────────────── the holder's PAN
    └──────────────────────────── state code, 01–38 (plus 97 and 99)
"""
import re

#: Base-36 alphabet, in the order the checksum algorithm assigns values.
_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

#: 01–38 are the states and union territories. 97 is "Other Territory"
#: (offshore, used for supplies outside any state) and 99 is "Centre
#: Jurisdiction". Everything else is not a jurisdiction that can issue a GSTIN.
_VALID_STATE_CODES = frozenset(
    [f"{n:02d}" for n in range(1, 39)] + ["97", "99"]
)

#: Structure only — the check digit is verified separately, because a number
#: that matches the shape but fails the checksum needs a different message from
#: one that is the wrong shape entirely.
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


class GSTINError(ValueError):
    """Raised with a message intended to be shown to the person typing."""


def compute_check_digit(first_14: str) -> str:
    """
    The 15th character, per the GSTN algorithm.

    Each of the first 14 characters is weighted alternately 1, 2, 1, 2 …; the
    product is folded base-36 (quotient plus remainder) and summed; the check
    digit is whatever brings the total to a multiple of 36.
    """
    total = 0
    for i, ch in enumerate(first_14):
        value = _CHARSET.index(ch)
        factor = 2 if i % 2 else 1
        product = value * factor
        total += product // 36 + product % 36
    return _CHARSET[(36 - total % 36) % 36]


def normalise(raw: str) -> str:
    """Upper-cased, with spaces and hyphens removed. People paste both."""
    return re.sub(r"[\s-]", "", (raw or "")).upper()


def is_valid(raw: str) -> bool:
    """True if `raw` is a structurally valid GSTIN with a correct check digit."""
    try:
        validate(raw)
        return True
    except GSTINError:
        return False


def validate(raw: str) -> str:
    """
    Return the normalised GSTIN, or raise `GSTINError` explaining what is wrong.

    The messages name the specific failure. "Invalid GSTIN" tells someone with a
    transposed digit nothing about where to look.
    """
    gstin = normalise(raw)

    if not gstin:
        raise GSTINError("GSTIN is required.")

    if len(gstin) != 15:
        raise GSTINError(
            f"A GSTIN is 15 characters; this one is {len(gstin)}."
        )

    if gstin[:2] not in _VALID_STATE_CODES:
        raise GSTINError(
            f"'{gstin[:2]}' is not a valid GST state code. The first two "
            "characters are the state code, 01–38."
        )

    if not _GSTIN_RE.match(gstin):
        raise GSTINError(
            "GSTIN format is wrong. Expected 2 digits (state), 10-character "
            "PAN, 1 entity digit, 'Z', then the check digit — e.g. "
            "27AAACA1234M1Z8."
        )

    expected = compute_check_digit(gstin[:14])
    if gstin[14] != expected:
        raise GSTINError(
            "GSTIN check digit does not match — the number is mistyped. "
            "Check for transposed characters."
        )

    return gstin


def state_code(gstin: str) -> str:
    """The two-digit state code, for the 'State code 27' the invoice renders."""
    return normalise(gstin)[:2]


# ── When a supplier GSTIN is mandatory ───────────────────────────────────────

#: Document types that ARE a tax document under GST and therefore cannot be
#: issued without the supplier's GSTIN. A quotation or proforma is an offer, not
#: a tax document, and is perfectly valid without one.
#:
#: Kept in step with `services/invoice_pdf._GSTIN_REQUIRED_TYPES`, which marks
#: the same set in the rendered document.
GSTIN_REQUIRED_TYPES: frozenset[str] = frozenset(
    {"tax_invoice", "credit_note", "debit_note"}
)


def requires_supplier_gstin(invoice_type: str) -> bool:
    return invoice_type in GSTIN_REQUIRED_TYPES
