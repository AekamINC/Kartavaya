"""doc_validation.py — refuse to generate a statutory document that is incomplete.

The rule
--------
A silently incomplete statutory document is worse than an error. An invoice that
looks finished, carries a total, and is missing its supplier GSTIN will be sent,
booked, and only fail months later when the recipient cannot claim input tax
credit against it. An invented placeholder is worse still.

So generation **refuses**. `generate_invoice_pdf` / `generate_payslip_pdf` raise
`DocumentIncomplete` before a byte of PDF exists, and the caller turns that into
a 422 naming every missing field and where to set it.

Two severities
--------------
- **blocking** — the document is legally void, fails e-invoice validation, or
  states something untrue on its face. Generation refuses.
- **advisory** — the document is issuable but poorer for the gap. It renders,
  and the gap is marked in the document itself with the `.pdf__unset` red
  treatment (`18-documents.md`: "the red is deliberately ugly because it must
  never survive to a customer").

Where the blocking sets come from
---------------------------------
Two sources, and nothing else. Nothing here is invented:

1. **The design documents.**
   - `18-documents.md` §Tax invoice: "supplier GSTIN, recipient GSTIN, place of
     supply, HSN/SAC per line, taxable value, IGST or CGST+SGST as separate
     lines (never a merged 'GST'), total in words, and a declaration."
   - `18-documents.md` §Payslip: "PF, ESI, PT and TDS as separate lines, net pay
     in words, and the statutory identifiers (UAN, PF number, ESI number)."
   - `docs/Tax Invoice.html` renders a hard blocker banner for a missing GSTIN:
     "This document cannot be issued."
   - `docs/GSTR-3B Summary.html` names two invoices held back for missing HSN
     rather than quietly excluding them.

2. **The rules those documents are quoting.** Rule 46 of the CGST Rules 2017
   enumerates the particulars of a tax invoice; the clause is cited on each gap
   so a reader can check the claim rather than trust it.

What is deliberately NOT blocking, and why
------------------------------------------
- **Recipient GSTIN.** A B2C sale to an unregistered buyer legitimately has
  none. Blocking would put a hard error on every consumer invoice. This
  reservation already existed in `invoice_pdf.py` and is preserved.
- **Place of supply on an intra-state supply.** Rule 46(n) requires it "in the
  case of a supply in the course of inter-State trade or commerce". The column
  is `place_of_supply TEXT DEFAULT ''`, so every historical intra-state invoice
  would 422 on a blanket rule — a regression dressed as rigour. Blocking is
  scoped to `is_igst`.
- **Supplier address, PAN, bank details.** Advisory. Rule 46(a) wants the
  address, but a missing one does not invalidate the recipient's credit the way
  a missing GSTIN does, and these are the fields most likely to be blank on a
  freshly onboarded org.
- **Quotations and proformas.** Not tax documents. An offer needs no GSTIN.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Document types that are tax documents under GST and therefore carry the full
# Rule 46 particulars. A quotation or proforma is an offer, not a tax document.
TAX_DOCUMENT_TYPES = {"tax_invoice", "credit_note", "debit_note"}

_ORG_PROFILE_FIX = "Settings → Organisation → Company Profile"
_EMPLOYEE_FIX = "Manav → Employees → the employee's record"
_INVOICE_FIX = "Ganit → the invoice → Edit"


@dataclass(frozen=True)
class Gap:
    """One missing or incoherent field."""

    field: str        # machine key, e.g. "org.gstin"
    label: str        # human label, e.g. "Supplier GSTIN"
    reason: str       # why the document needs it
    fix: str          # where the user sets it

    def as_dict(self) -> dict[str, str]:
        return {"field": self.field, "label": self.label, "reason": self.reason, "fix": self.fix}


@dataclass
class DocumentCheck:
    document: str
    blocking: list[Gap] = field(default_factory=list)
    advisory: list[Gap] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.blocking

    def raise_if_incomplete(self) -> None:
        if self.blocking:
            raise DocumentIncomplete(self)

    def as_payload(self) -> dict[str, Any]:
        return {
            "error": "document_incomplete",
            "document": self.document,
            "message": (
                f"This {self.document} cannot be issued — "
                f"{len(self.blocking)} mandatory field(s) are missing or inconsistent. "
                "Nothing has been invented to fill the gap."
            ),
            "blocking": [g.as_dict() for g in self.blocking],
            "advisory": [g.as_dict() for g in self.advisory],
        }

    # Advisory gaps are what the renderer marks in red inside the document.
    def advisory_fields(self) -> set[str]:
        return {g.field for g in self.advisory}


class DocumentIncomplete(Exception):
    """Raised instead of emitting a legally incomplete statutory document."""

    def __init__(self, check: DocumentCheck):
        self.check = check
        super().__init__(check.as_payload()["message"])

    def as_payload(self) -> dict[str, Any]:
        return self.check.as_payload()


# ── helpers ──────────────────────────────────────────────────────────────────

def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _addr_blank(addr: Any) -> bool:
    if not isinstance(addr, dict):
        return True
    return not any(str(addr.get(k) or "").strip() for k in ("line1", "line2", "city", "state", "pincode"))


# ── Tax invoice ──────────────────────────────────────────────────────────────

def validate_tax_invoice(invoice: dict, org: dict, contact: dict | None = None) -> DocumentCheck:
    """Rule 46 particulars for a Ganit invoice.

    Applies the tax-document rules only to `tax_invoice` / `credit_note` /
    `debit_note`. A quotation or proforma gets the identity checks and nothing
    else, because it is not a tax document.
    """
    invoice = invoice or {}
    org = org or {}
    contact = contact or {}

    inv_type = (invoice.get("invoice_type") or "").strip()
    is_tax_doc = inv_type in TAX_DOCUMENT_TYPES
    is_export = bool(invoice.get("is_export"))
    label = {
        "tax_invoice": "tax invoice",
        "credit_note": "credit note",
        "debit_note": "debit note",
        "proforma": "proforma invoice",
        "quotation": "quotation",
    }.get(inv_type, "invoice")
    if is_export:
        label = "export invoice"

    chk = DocumentCheck(document=label)

    # ── identity of the document itself — every variant needs these ──────────
    if _blank(invoice.get("invoice_number")):
        chk.blocking.append(Gap(
            "invoice.invoice_number", "Invoice number",
            "Rule 46(b) — a consecutive serial number identifies the document. "
            "Without one it cannot be referenced in a return or a credit note.",
            _INVOICE_FIX,
        ))
    if _blank(invoice.get("invoice_date")):
        chk.blocking.append(Gap(
            "invoice.invoice_date", "Invoice date",
            "Rule 46(b) — the date of issue fixes the tax period the supply falls in.",
            _INVOICE_FIX,
        ))
    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Supplier legal name",
            "Rule 46(a) — the document must name the supplier. "
            "An unnamed invoice identifies no one.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(contact.get("name")) and _blank(contact.get("company")):
        chk.blocking.append(Gap(
            "contact.name", "Recipient name",
            "Rule 46(e) — the document must name the recipient.",
            "Graha → the contact record",
        ))

    if not (invoice.get("line_items") or []):
        chk.blocking.append(Gap(
            "invoice.line_items", "Line items",
            "An invoice with no lines states no supply. "
            "Rule 46(f)–(j) describe the particulars of each line.",
            _INVOICE_FIX,
        ))

    # ── tax-document particulars ────────────────────────────────────────────
    if is_tax_doc:
        if _blank(org.get("gstin")):
            chk.blocking.append(Gap(
                "org.gstin", "Supplier GSTIN",
                "Rule 46(a) — mandatory on a tax invoice. Without it the document "
                "fails e-invoice validation and blocks the recipient's input tax credit.",
                _ORG_PROFILE_FIX,
            ))

        # HSN/SAC per line. Rule 46(g). This is the same defect GSTR-3B is
        # designed to surface by name; the previous renderer printed an em-dash
        # in the column, which reads as "no code applies" rather than "missing".
        missing_hsn = [
            i for i, li in enumerate(invoice.get("line_items") or [], 1)
            if _blank((li or {}).get("hsn_code")) and _blank((li or {}).get("sac_code"))
        ]
        if missing_hsn:
            shown = ", ".join(str(i) for i in missing_hsn[:8])
            more = f" (+{len(missing_hsn) - 8} more)" if len(missing_hsn) > 8 else ""
            chk.blocking.append(Gap(
                "invoice.line_items.hsn_code", "HSN/SAC code",
                f"Rule 46(g) — every line needs an HSN or SAC code. "
                f"Line {shown}{more} has neither. An invoice missing HSN is held "
                f"back from the GSTR-3B working rather than filed.",
                _INVOICE_FIX,
            ))

        # The tax split must not contradict itself. `18-documents.md`: IGST or
        # CGST+SGST as separate lines, never a merged "GST".
        igst, cgst, sgst = _num(invoice.get("igst")), _num(invoice.get("cgst")), _num(invoice.get("sgst"))
        if not is_export:
            if invoice.get("is_igst") and (cgst > 0 or sgst > 0):
                chk.blocking.append(Gap(
                    "invoice.tax_split", "Tax split",
                    "The invoice is marked inter-State (IGST) but carries CGST/SGST "
                    "amounts. One supply cannot be taxed both ways; the document "
                    "would state a treatment it does not carry.",
                    _INVOICE_FIX,
                ))
            if not invoice.get("is_igst") and igst > 0:
                chk.blocking.append(Gap(
                    "invoice.tax_split", "Tax split",
                    "The invoice is marked intra-State (CGST/SGST) but carries an "
                    "IGST amount. One supply cannot be taxed both ways.",
                    _INVOICE_FIX,
                ))
            # Rule 46(n) — place of supply is required for an inter-State supply.
            if invoice.get("is_igst") and _blank(invoice.get("place_of_supply")):
                chk.blocking.append(Gap(
                    "invoice.place_of_supply", "Place of supply",
                    "Rule 46(n) — the place of supply with the State name is "
                    "mandatory on an inter-State supply. It is what makes IGST "
                    "the correct head rather than CGST+SGST.",
                    _INVOICE_FIX,
                ))
            elif _blank(invoice.get("place_of_supply")):
                chk.advisory.append(Gap(
                    "invoice.place_of_supply", "Place of supply",
                    "Not mandatory on an intra-State supply, but its absence makes "
                    "the CGST/SGST treatment unverifiable from the face of the document.",
                    _INVOICE_FIX,
                ))

        # Advisory identity fields.
        if _blank(org.get("pan")):
            chk.advisory.append(Gap(
                "org.pan", "Supplier PAN",
                "Shown alongside the GSTIN on the letterhead; expected on a tax document.",
                _ORG_PROFILE_FIX,
            ))
        if _addr_blank(org.get("billing_address")):
            chk.advisory.append(Gap(
                "org.billing_address", "Supplier address",
                "Rule 46(a) lists the supplier's address among the particulars.",
                _ORG_PROFILE_FIX,
            ))
        if _blank(contact.get("gstin")) and not is_export:
            # NOT blocking — see module docstring.
            chk.advisory.append(Gap(
                "contact.gstin", "Recipient GSTIN",
                "Absent on a B2C supply to an unregistered buyer, which is normal. "
                "If the buyer is registered, the credit cannot be claimed without it.",
                "Graha → the contact record",
            ))

    return chk


# ── Payslip ──────────────────────────────────────────────────────────────────
#
# India has no single statutory payslip *format*. The obligations are concrete
# even so, and each blocking rule below names the one it rests on. Where the
# obligation is conditional on a deduction actually being taken, so is the rule:
# an employee below the PF threshold has no UAN and must not be blocked for it.

def validate_payslip(payslip: dict, employee: dict, org: dict) -> DocumentCheck:
    payslip = payslip or {}
    employee = employee or {}
    org = org or {}

    chk = DocumentCheck(document="payslip")

    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Employer legal name",
            "A wage slip that does not name the employer evidences nothing. "
            "It is the employer's record of wages paid.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(employee.get("name")):
        chk.blocking.append(Gap(
            "employee.name", "Employee name",
            "The slip must identify whose wages it records.",
            _EMPLOYEE_FIX,
        ))
    if _blank(payslip.get("month")):
        chk.blocking.append(Gap(
            "payslip.month", "Wage period",
            "Payment of Wages Act 1936 s.4 — wages are fixed to a wage period, "
            "and the slip must state which one it settles.",
            "Vetana → the payroll run",
        ))
    if _blank(payslip.get("payslip_number")):
        chk.blocking.append(Gap(
            "payslip.payslip_number", "Payslip number",
            "The slip's own identifier; without it the record cannot be cited.",
            "Vetana → the payroll run",
        ))

    # The arithmetic on the face of the document must reconcile. A payslip whose
    # figures do not add up is not a formatting problem — the employee cannot
    # verify what they were paid, which is the entire purpose of the slip.
    gross = _num(payslip.get("gross"))
    deductions = _num(payslip.get("total_deductions"))
    net = _num(payslip.get("net_pay"))
    if abs(gross - deductions - net) > 1.0:
        chk.blocking.append(Gap(
            "payslip.net_pay", "Net pay reconciliation",
            f"Gross ({gross:,.2f}) less deductions ({deductions:,.2f}) is "
            f"{gross - deductions:,.2f}, but net pay is recorded as {net:,.2f}. "
            "The figures on the slip do not reconcile.",
            "Vetana → re-run payroll for this period",
        ))

    # Statutory identifiers, each conditional on the deduction being taken.
    if _num(payslip.get("pf_employee")) > 0 and _blank(employee.get("uan")):
        chk.blocking.append(Gap(
            "employee.uan", "UAN",
            "Provident fund has been deducted but the employee has no Universal "
            "Account Number on file. The contribution cannot be attributed to a "
            "member account, and the slip evidences a deduction the employee "
            "cannot trace.",
            _EMPLOYEE_FIX,
        ))
    if _num(payslip.get("esi_employee")) > 0 and _blank(employee.get("esi_number")):
        chk.blocking.append(Gap(
            "employee.esi_number", "ESI insurance number",
            "An ESI contribution has been deducted but the employee has no "
            "insurance number on file, so the contribution cannot be credited "
            "to their ESIC record.",
            _EMPLOYEE_FIX,
        ))
    if _num(payslip.get("tds")) > 0 and _blank(employee.get("pan")):
        chk.blocking.append(Gap(
            "employee.pan", "Employee PAN",
            "Tax has been deducted at source but the employee has no PAN on file. "
            "Section 206AA mandates deduction at the higher rate without one, and "
            "the deduction cannot appear in the employee's Form 26AS.",
            _EMPLOYEE_FIX,
        ))

    # Advisory.
    if _blank(employee.get("pf_number")) and _num(payslip.get("pf_employee")) > 0:
        chk.advisory.append(Gap(
            "employee.pf_number", "PF account number",
            "The member ID (e.g. MH/BAN/12345/0042) that the design spec places "
            "beside the UAN. No column exists for it yet — see the field audit.",
            _EMPLOYEE_FIX,
        ))
    if _blank(org.get("authorized_signatory_name")):
        chk.advisory.append(Gap(
            "org.authorized_signatory_name", "Authorised signatory",
            "The slip carries a signature block; without a name it signs for nobody.",
            _ORG_PROFILE_FIX,
        ))

    return chk
