"""statutory_ids.py — format rules for the employee identifiers payroll deducts against.

Why this module exists
----------------------
Vetana deducts provident fund and ESI, prints both on the payslip, and
`services/doc_validation.py` attaches an advisory telling the admin to set the
missing identifier at "Manav → Employees → the employee's record". Until now
that instruction was false: `manav_employees` HAS `uan`, `esi_number` and
`bank_details` columns, `EmployeeCreate`/`EmployeeUpdate` HAVE the fields, and
the form in `frontend/src/pages/manav/EmployeesTab.jsx` had no input for any of
them. Measured on the shared database 2026-08-05: 0 of 81 employees carried a
UAN, 0 carried an ESI number, 1 carried a bank account, and 720 payslips were
marked disbursed against employees with no account on file.

Two halves fix that. The form is the other half. This is the half that decides
what may be stored.

The rule this module follows
----------------------------
REFUSE, never coerce. These identifiers end up on an EPFO ECR, an ESIC
contribution return and a bank payment file, and every one of those is a filing
made in the employer's name. A malformed UAN attributes a real contribution to
a real member account that is not the employee's; a missing one attributes it
to nobody and is fixed by typing it in. The missing one is recoverable and the
wrong one is not, so every function here raises rather than storing a value it
cannot vouch for. Blank always passes — "not on file" is a legitimate state for
an employee below the PF or ESI threshold, and `validate_payslip` already
reports it as an advisory gap rather than a blocker.

The formats, and where each comes from
--------------------------------------
Checked before being asserted, because the brief that commissioned this work
carried one of them wrong and the wrong one would have refused every real value.

  · **UAN — 12 digits.** The EPFO Universal Account Number: one lifetime number
    per member, quoted on Form 11 and on every ECR upload.

  · **ESI insurance number — 10 digits.** This is the EMPLOYEE-side identifier,
    the "IP number" printed on the Pehchan card, and it is what
    `manav_employees.esi_number` holds: `doc_validation.validate_payslip` says
    of it "the contribution cannot be credited to their ESIC record", which is
    the employee's record, and `payslip_pdf._build_html` prints it in the
    employee's Statutory column beside their own UAN.

    The 17-digit number is a DIFFERENT identifier — the ESIC *employer* code,
    one per establishment. This repo already says so in its own words:
    `migrations/PROPOSED_090_statutory_document_identifiers.sql` comments
    `organisations.esi_employer_code` as "ESIC employer code, 17 digits. The
    employer half of the payslip statutory block; the employee half is
    manav_employees.esi_number." Asserting 17 here would have rejected every
    genuine insurance number an admin could type.

  · **IFSC — 11 characters, `AAAA0BBBBBB`.** Four letters for the bank, then a
    literal `0` that the RBI reserves for future use, then six alphanumerics for
    the branch. The alphanumeric tail is why this is not `[0-9]{6}`: a minority
    of branch codes carry letters, and a digits-only rule refuses them.

  · **Bank account number — 6 to 18 digits.** Indian account numbers are numeric
    and their length is a per-bank choice; the range spans what the scheduled
    banks issue. The FLOOR is 6 rather than the 9 that is often quoted, and that
    is not a guess: the one account already on this database is 8 digits, so a
    9-digit floor would have refused live data on the first edit of that record.
    The CEILING refuses; it never truncates. Silently keeping the first 18
    characters of a longer string produces an account number that looks whole,
    passes every later check, and pays a stranger.

  · **PAN — `AAAAA9999A`.** Five letters, four digits, a letter. The fourth
    character is the holder-type code and only ten letters are valid there;
    anything else is definitively not a PAN. That check is deliberately NOT
    narrowed to `P` (individual) even though an employee's PAN always is one —
    the shape check catches typing errors, and guessing at the taxonomy would
    start refusing values the Income Tax Department issued.

What is deliberately not checked
--------------------------------
No checksum on the UAN or the ESI number. Neither carries a published check
digit, and a validator that invents one refuses valid numbers — the exact
failure this module is written to avoid. The PAN's fifth character encodes the
holder's surname initial and is not checked against the employee's name either:
it is the surname as it appears on the PAN application, which is routinely not
the name in an HR record.
"""

from __future__ import annotations

import re

# The masking glyph `services/pii.py` writes. See `clean_account_number`.
MASK_GLYPH = "•"

_UAN_RE = re.compile(r"^[0-9]{12}$")
_ESI_RE = re.compile(r"^[0-9]{10}$")
_IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
_ACCOUNT_RE = re.compile(r"^[0-9]{6,18}$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")

#: Valid fourth characters of a PAN — the holder type. P individual, C company,
#: H Hindu undivided family, F firm, A association of persons, T trust,
#: B body of individuals, L local authority, J artificial juridical person,
#: G government.
_PAN_HOLDER_TYPES = set("PCHFATBLJG")

ACCOUNT_MIN_DIGITS = 6
ACCOUNT_MAX_DIGITS = 18


class StatutoryValueError(ValueError):
    """One or more identifiers were malformed. Carries every problem at once.

    All of them, not the first: an admin filling in a payroll record types the
    UAN, the ESI number and the account together, and a validator that reports
    one problem per round trip turns a single correction into three.
    """

    def __init__(self, problems: list[dict]):
        self.problems = problems
        super().__init__("; ".join(p["message"] for p in problems))

    def as_payload(self) -> dict:
        return {
            "error": "statutory_identifier_invalid",
            "message": (
                f"{len(self.problems)} identifier(s) were not stored because they "
                "are not in the format the statutory filing requires. Nothing was "
                "saved for them — a wrong number on a return is worse than a "
                "missing one."
            ),
            "problems": self.problems,
        }


def _problem(field: str, label: str, message: str, example: str) -> dict:
    return {"field": field, "label": label, "message": message, "example": example}


def _text(value) -> str:
    """A trimmed string, from whatever the JSON body produced."""
    return "" if value is None else str(value).strip()


# ── the identifiers, one function each ───────────────────────────────────────
#
# Each returns the value in its canonical stored form, or raises with the one
# problem it found. Blank in, blank out — "not on file" is allowed everywhere.


def clean_uan(value) -> str:
    """EPFO Universal Account Number. 12 digits.

    Spaces and hyphens are stripped before the check because the number is
    routinely written in groups when it is copied off a passbook or a Form 11,
    and refusing `1001 2345 6789` would be refusing the right number for being
    typed the way it is printed.
    """
    raw = _text(value)
    if not raw:
        return ""
    digits = re.sub(r"[\s-]", "", raw)
    if not _UAN_RE.match(digits):
        found = len(re.sub(r"\D", "", digits))
        raise StatutoryValueError([_problem(
            "uan", "UAN",
            f"A UAN is exactly 12 digits; this has {found} digit(s)"
            + ("" if digits.isdigit() else " and non-digit characters")
            + ". The contribution is attributed to whichever member account the "
              "number names, so a wrong one credits somebody else.",
            "100123456789",
        )])
    return digits


def clean_esi_number(value) -> str:
    """ESIC insurance number (the employee's IP number). 10 digits.

    NOT 17 — that is the employer's establishment code, which lives on the
    organisation. See the module docstring; the distinction is the difference
    between a rule that works and one that refuses every real value.
    """
    raw = _text(value)
    if not raw:
        return ""
    digits = re.sub(r"[\s-]", "", raw)
    if not _ESI_RE.match(digits):
        found = len(re.sub(r"\D", "", digits))
        hint = ""
        if found == 17:
            hint = (
                " A 17-digit number is the ESIC EMPLOYER code for the "
                "establishment, not this employee's insurance number."
            )
        raise StatutoryValueError([_problem(
            "esi_number", "ESI insurance number",
            f"An ESIC insurance number is exactly 10 digits; this has {found} "
            f"digit(s)"
            + ("" if digits.isdigit() else " and non-digit characters")
            + f".{hint}",
            "3100123456",
        )])
    return digits


def clean_pan(value) -> str:
    """Permanent Account Number. Five letters, four digits, a letter.

    Upper-cased before the check — a PAN is issued in capitals and nobody types
    it that way.
    """
    raw = _text(value)
    if not raw:
        return ""
    pan = re.sub(r"[\s-]", "", raw).upper()
    if not _PAN_RE.match(pan):
        raise StatutoryValueError([_problem(
            "pan", "PAN",
            f"'{pan}' is not a PAN. The format is five letters, four digits and "
            "one letter. Section 206AA charges TDS at the higher rate when the "
            "deductee's PAN is absent or invalid.",
            "ABCPD1234E",
        )])
    if pan[3] not in _PAN_HOLDER_TYPES:
        raise StatutoryValueError([_problem(
            "pan", "PAN",
            f"'{pan}' has '{pan[3]}' as its fourth character. That position is "
            "the holder type and only "
            f"{', '.join(sorted(_PAN_HOLDER_TYPES))} are issued — an employee's "
            "PAN carries 'P'. The number as typed does not exist.",
            "ABCPD1234E",
        )])
    return pan


def clean_ifsc(value) -> str:
    """Indian Financial System Code. Four letters, a zero, six alphanumerics."""
    raw = _text(value)
    if not raw:
        return ""
    ifsc = re.sub(r"[\s-]", "", raw).upper()
    if not _IFSC_RE.match(ifsc):
        detail = "The format is four letters, then the digit 0, then six characters."
        if len(ifsc) == 11 and ifsc[4] != "0":
            detail = (
                f"The fifth character is '{ifsc[4]}'. The RBI reserves that "
                "position and it is always the digit 0."
            )
        elif len(ifsc) != 11:
            detail = f"An IFSC is 11 characters; this is {len(ifsc)}."
        raise StatutoryValueError([_problem(
            "bank_details.ifsc", "IFSC",
            f"'{ifsc}' is not an IFSC. {detail} A salary credited on a wrong "
            "IFSC is routed to a different branch.",
            "HDFC0001234",
        )])
    return ifsc


def clean_account_number(value) -> str:
    """A bank account number. 6–18 digits, never truncated.

    Two refusals here rather than one, and the second is the interesting one.

    The MASKED value is refused explicitly. `GET /v1/manav/employees/{id}`
    returns the account as `••••4821`, and an edit form that pre-fills from that
    read and PATCHes it straight back would write the mask over the number —
    destroying the only copy, in a way that looks like a successful save and
    surfaces months later as a failed salary credit. The router merges rather
    than replaces `bank_details` so a partial update cannot wipe the field, and
    this check is the second lock on the same door: a value carrying the mask
    glyph is never account data, whatever path produced it.
    """
    raw = _text(value)
    if not raw:
        return ""
    if MASK_GLYPH in raw:
        raise StatutoryValueError([_problem(
            "bank_details.account_number", "Account number",
            "That is the masked account number as it is displayed, not the "
            "account number itself. Storing it would overwrite the real one. "
            "Leave the field blank to keep the account already on file.",
            "50200041824821",
        )])
    digits = re.sub(r"[\s-]", "", raw)
    if not _ACCOUNT_RE.match(digits):
        if digits.isdigit() and len(digits) > ACCOUNT_MAX_DIGITS:
            message = (
                f"This is {len(digits)} digits. No Indian bank issues an account "
                f"number longer than {ACCOUNT_MAX_DIGITS}, and it has NOT been "
                "shortened to fit — a truncated account number is a valid-looking "
                "number belonging to somebody else. Check the number and re-enter it."
            )
        elif digits.isdigit():
            message = (
                f"This is {len(digits)} digits. An account number is at least "
                f"{ACCOUNT_MIN_DIGITS}."
            )
        else:
            message = (
                "An account number is digits only. Enter it exactly as the bank "
                "issued it, without the branch name or the IFSC."
            )
        raise StatutoryValueError([_problem(
            "bank_details.account_number", "Account number", message,
            "50200041824821",
        )])
    return digits


def clean_bank_details(details) -> dict:
    """Normalise the bank sub-document, collecting every problem in it.

    Unknown keys are preserved untouched. `bank_details` is a jsonb bag shared
    with the organisation profile's version of the same field, which carries
    `account_name`, `branch` and `upi_id`; a normaliser that dropped what it did
    not recognise would quietly delete them.
    """
    if not details:
        return {}
    if not isinstance(details, dict):
        raise StatutoryValueError([_problem(
            "bank_details", "Bank details",
            "The bank details must be an object with account_number, ifsc and "
            "bank_name keys.",
            '{"account_number": "50200041824821", "ifsc": "HDFC0001234"}',
        )])

    out = dict(details)
    problems: list[dict] = []
    for key, fn in (("account_number", clean_account_number), ("ifsc", clean_ifsc)):
        if key not in out:
            continue
        try:
            out[key] = fn(out[key])
        except StatutoryValueError as e:
            problems.extend(e.problems)
    if "bank_name" in out:
        out["bank_name"] = _text(out["bank_name"])[:120]
    if problems:
        raise StatutoryValueError(problems)
    return out


# ── the one entry point a router calls ───────────────────────────────────────

#: Payload key → cleaner, for the flat identifier columns.
_FLAT_CLEANERS = {"uan": clean_uan, "esi_number": clean_esi_number, "pan": clean_pan}


def clean_employee_identifiers(payload: dict, *, aadhaar: str = "") -> dict:
    """A copy of `payload` with every identifier it carries normalised.

    Keys that are absent are left absent, so this is safe on a PATCH body built
    with `exclude_unset`. Every problem across every field is raised together.

    `aadhaar` is the employee's Aadhaar in PLAINTEXT, passed by the caller when
    it has one. It exists for a single check, and that check is worth its
    awkwardness: an Aadhaar and a UAN are both twelve digits, they sit two
    fields apart on the same form, and pasting the first into the second is the
    one data-entry error that produces a *well-formed* wrong UAN. Every other
    rule here catches a value that is obviously broken; this one catches the
    value that passes and is still wrong.
    """
    out = dict(payload)
    problems: list[dict] = []

    for key, fn in _FLAT_CLEANERS.items():
        if key not in out:
            continue
        try:
            out[key] = fn(out[key])
        except StatutoryValueError as e:
            problems.extend(e.problems)

    if "bank_details" in out:
        try:
            out["bank_details"] = clean_bank_details(out["bank_details"])
        except StatutoryValueError as e:
            problems.extend(e.problems)

    # Only when the UAN itself was accepted — telling someone their 11-digit UAN
    # is also their Aadhaar would be two complaints about one typo.
    uan = out.get("uan") or ""
    aadhaar_digits = re.sub(r"\D", "", _text(aadhaar))
    if uan and aadhaar_digits and uan == aadhaar_digits:
        problems.append(_problem(
            "uan", "UAN",
            "This is the employee's Aadhaar number, not their UAN. Both are "
            "twelve digits, so nothing later in the chain would catch it: the "
            "provident fund contribution would be filed against a number EPFO "
            "does not know.",
            "100123456789",
        ))

    if problems:
        raise StatutoryValueError(problems)
    return out
