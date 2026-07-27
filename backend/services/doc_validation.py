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

import re
from dataclasses import dataclass, field
from typing import Any

# Document types that are tax documents under GST and therefore carry the full
# Rule 46 particulars. A quotation or proforma is an offer, not a tax document.
TAX_DOCUMENT_TYPES = {"tax_invoice", "credit_note", "debit_note"}

_ORG_PROFILE_FIX = "Settings → Organisation → Company Profile"
_EMPLOYEE_FIX = "Manav → Employees → the employee's record"
_INVOICE_FIX = "Ganit → the invoice → Edit"
_QUOTE_FIX = "Ganit → the quotation → Edit"
_CHALLAN_FIX = "Ganit → TDS → the challan"
_RETURN_FIX = "Ganit → GST → the return period"
_CONTACT_FIX = "Graha → the contact record"
_CONTRACT_FIX = "Ganit → Contracts → the agreement"
_BOARD_FIX = "the project board"


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


# ── GSTR-3B working paper ────────────────────────────────────────────────────
#
# The paper is not the return, so nothing here enforces the portal's own
# validations. What it does enforce is that the paper is INTERNALLY honest: it
# names the registered person, it states which period it covers, and its three
# tables reconcile to its four totals. A working paper whose columns do not sum
# is worse than no working paper — a preparer will trust it and file from it.

def validate_gstr3b(gstr: dict, org: dict, computed: dict | None = None) -> DocumentCheck:
    gstr = gstr or {}
    org = org or {}
    computed = computed or {}

    chk = DocumentCheck(document="GSTR-3B working paper")

    if _blank(org.get("gstin")):
        chk.blocking.append(Gap(
            "org.gstin", "Supplier GSTIN",
            "A GSTR-3B is filed against a GSTIN. Without one the paper does not "
            "identify which registration it summarises, and a working paper that "
            "could belong to any registration belongs to none.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Registered person",
            "The paper must name the registered person it is prepared for.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(gstr.get("period")):
        chk.blocking.append(Gap(
            "gstr3b.period", "Return period",
            "Section 39(1) — a return is for a tax period. Figures with no period "
            "cannot be reconciled to the books or to a portal filing.",
            _RETURN_FIX,
        ))

    # The set-off must reconcile. `gstr3b_pdf.compute` derives Table 6.1 and the
    # totals from Tables 3.1 and 4, so a failure here means the computation and
    # the printed totals have diverged — which is a bug, not a data gap, and
    # must never reach a PDF.
    if computed:
        set_off = computed.get("set_off") or {}
        for head, s in set_off.items():
            if s["via_itc"] + s["in_cash"] != s["payable"]:
                chk.blocking.append(Gap(
                    f"gstr3b.set_off.{head}", f"{head.upper()} set-off",
                    f"Tax payable ({s['payable']:,}) does not equal credit utilised "
                    f"({s['via_itc']:,}) plus cash ({s['in_cash']:,}). The payment "
                    "table does not discharge the liability it states.",
                    _RETURN_FIX,
                ))
        # Table 4 must reconcile: 4(C) = 4(A) − [4(B)(1) + 4(B)(2)].
        #
        # Circular 170/02/2022-GST para 4.3(D) states the formula in exactly
        # that shape, and its Annexure works an example that obeys it. Table
        # 4(D) is DELIBERATELY not in the identity: para 4.2 makes 4(C) the
        # figure credited to the electronic credit ledger, and 4(D) is
        # disclosure. A (D) row that leaked into (C) would either overstate a
        # firm's claimable credit or understate the cash it must deposit, and
        # both are errors the portal will not catch for it.
        available = computed.get("itc_available") or {}
        reversed_total = computed.get("itc_reversed") or {}
        net_itc = computed.get("net_itc") or {}
        for head in ("igst", "cgst", "sgst", "cess"):
            if head not in net_itc:
                continue
            expected = available.get(head, 0) - reversed_total.get(head, 0)
            if net_itc[head] != expected:
                chk.blocking.append(Gap(
                    f"gstr3b.net_itc.{head}", f"{head.upper()} Table 4(C)",
                    f"Net ITC of {net_itc[head]:,} does not equal 4(A) "
                    f"({available.get(head, 0):,}) less 4(B) "
                    f"({reversed_total.get(head, 0):,}) = {expected:,}. Table 4 "
                    "does not reconcile, so the credit carried into Table 6.1 is "
                    "not the credit Table 4 states.",
                    _RETURN_FIX,
                ))

        # 4(D)(1) is a BREAK-UP of credit already availed inside 4(A)(5), not a
        # sixth availment row — GSTN advisory of 02.09.2022, note 3(II).
        # Reclaimed credit exceeding "all other ITC" is therefore an internal
        # contradiction: the paper discloses more reclaimed credit than the row
        # it was supposedly reclaimed in. Blocking, because a preparer who
        # trusts it will claim the same credit twice.
        reclaimed = computed.get("itc_reclaimed") or {}
        all_other = gstr.get("itc_all_other") or {}
        for head in ("igst", "cgst", "sgst", "cess"):
            claimed = reclaimed.get(head, 0)
            if not claimed:
                continue
            try:
                other = int(round(float((all_other or {}).get(head) or 0)))
            except (TypeError, ValueError):
                other = 0
            if claimed > other:
                chk.blocking.append(Gap(
                    f"gstr3b.reclaimed.{head}", f"{head.upper()} ITC reclaimed",
                    f"Table 4(D)(1) discloses {claimed:,} of reclaimed {head.upper()} "
                    f"credit but 4(A)(5) avails only {other:,}. 4(D)(1) is the "
                    "break-up of credit taken within 4(A)(5), so it cannot exceed "
                    "it — one of the two rows is wrong.",
                    _RETURN_FIX,
                ))

        # Credit can never be utilised beyond what Table 4(C) makes available.
        #
        # The comparison is per CREDIT head, not per LIABILITY head, and the two
        # are not the same thing. `set_off[h]["via_itc"]` is credit that
        # discharged the liability of head `h` FROM ANY POOL — rule 88A requires
        # IGST credit to be exhausted first and lets it pay CGST and SGST — so a
        # CGST liability can legitimately be discharged with more credit than
        # the CGST pool holds. Comparing those two figures directly refuses a
        # correct return, and does so precisely for the common case of an
        # importer or inter-State buyer whose IGST credit exceeds its IGST
        # liability. What must hold is that each POOL is not overdrawn, which
        # `credit_left` states directly.
        for head, s in set_off.items():
            available = net_itc.get(head, 0)
            # A caller that supplies no `credit_left` is asserting the simple
            # case — the head's own pool paid its own liability — so fall back
            # to that reading rather than skipping the check entirely.
            consumed = available - s["credit_left"] if "credit_left" in s else s["via_itc"]
            if consumed > max(0, available):
                chk.blocking.append(Gap(
                    f"gstr3b.itc.{head}", f"{head.upper()} credit utilisation",
                    f"The paper draws {consumed:,} from the {head.upper()} credit pool "
                    f"but Table 4(C) makes only {available:,} available. "
                    "Utilising credit that does not exist overstates the ledger.",
                    _RETURN_FIX,
                ))
            elif consumed < 0:
                chk.blocking.append(Gap(
                    f"gstr3b.itc.{head}", f"{head.upper()} credit utilisation",
                    f"The {head.upper()} credit pool ends with more credit than it "
                    "started with. A set-off may consume credit, never create it.",
                    _RETURN_FIX,
                ))

        # Credit consumed from the pools must equal credit applied to the
        # liabilities. This is the invariant that survives cross-utilisation:
        # it says nothing about WHICH pool paid which head, only that the two
        # sides balance, so it catches credit conjured between them.
        if all("credit_left" in s for s in set_off.values()) and set_off:
            applied = sum(s["via_itc"] for s in set_off.values())
            drawn = sum(net_itc.get(h, 0) - s["credit_left"] for h, s in set_off.items())
            if applied != drawn:
                chk.blocking.append(Gap(
                    "gstr3b.itc.balance", "Credit ledger balance",
                    f"{applied:,} of credit is applied against the liabilities but "
                    f"{drawn:,} is drawn from the pools. The set-off does not balance.",
                    _RETURN_FIX,
                ))
        # Reverse-charge liability may not be discharged from the credit ledger —
        # section 49(4) with rule 85(4). This asserts the renderer honoured it.
        rcm = gstr.get("inward_reverse_charge") or {}
        for head in ("igst", "cgst", "sgst", "cess"):
            s = set_off.get(head)
            if not s:
                continue
            try:
                rcm_head = int(round(float(rcm.get(head) or 0)))
            except (TypeError, ValueError):
                rcm_head = 0
            if rcm_head and s["in_cash"] < rcm_head:
                chk.blocking.append(Gap(
                    f"gstr3b.rcm.{head}", f"{head.upper()} reverse charge",
                    f"Reverse-charge {head.upper()} of {rcm_head:,} must be paid in "
                    f"cash (section 49(4), rule 85(4)) but the cash column shows "
                    f"only {s['in_cash']:,}.",
                    _RETURN_FIX,
                ))

    # ── advisory ────────────────────────────────────────────────────────────
    # A negative 4(C) is legitimate — reversals in a period can exceed availment
    # — and `compute_set_off` correctly utilises nothing from a negative
    # balance. But it means credit must be made good in cash, which is the sort
    # of thing a preparer should be told rather than left to infer from a minus
    # sign in a table. Advisory, not blocking: the figure is not wrong.
    for head, value in (computed.get("net_itc") or {}).items():
        if value < 0:
            chk.advisory.append(Gap(
                f"gstr3b.net_itc_negative.{head}", f"{head.upper()} Net ITC is negative",
                f"Table 4(C) shows {value:,} of {head.upper()} credit — reversals in "
                "this period exceed availment. No credit is utilised from a negative "
                "balance, so the whole liability on this head falls into cash.",
                _RETURN_FIX,
            ))

    if _blank(gstr.get("arn")):
        chk.advisory.append(Gap(
            "gstr3b.arn", "ARN",
            "No acknowledgement number exists until the return is submitted on the "
            "GST portal. The paper is a working, and says so on its face.",
            _RETURN_FIX,
        ))
    if _blank(gstr.get("gstr2b_date")):
        chk.advisory.append(Gap(
            "gstr3b.gstr2b_date", "GSTR-2B reconciliation date",
            "Input tax credit in Table 4 is claimable only to the extent it appears "
            "in GSTR-2B (section 16(2)(aa)). Nothing records that a reconciliation "
            "was done, so the ITC figures are unreconciled book figures.",
            _RETURN_FIX,
        ))
    if _blank(gstr.get("filing_scheme")):
        chk.advisory.append(Gap(
            "gstr3b.filing_scheme", "Filing scheme",
            "The due date shown is the monthly filer's — the 20th of the following "
            "month. A QRMP filer's date is the 22nd or 24th by State group, and "
            "nothing on the organisation records which scheme applies.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(org.get("authorized_signatory_name")):
        chk.advisory.append(Gap(
            "org.authorized_signatory_name", "Authorised signatory",
            "The paper carries a signature block; without a name it signs for nobody.",
            _ORG_PROFILE_FIX,
        ))
    if gstr.get("held_back"):
        n = len(gstr["held_back"])
        chk.advisory.append(Gap(
            "gstr3b.held_back", "Records held back",
            f"{n} record(s) are excluded from this working and are named on the face "
            "of the document. Their input tax credit is not claimed here.",
            _INVOICE_FIX,
        ))

    return chk


# ── TDS challan (ITNS-281) ───────────────────────────────────────────────────
#
# Everything blocking here is a particular the challan cannot be tied to a real
# bank deposit without. The counterfoil's whole job is to be reconcilable
# against the bank's challan and quotable on a 26Q; a counterfoil that is
# neither is a plausible-looking document that evidences nothing.

_TAN_RE = re.compile(r"^[A-Z]{4}[0-9]{5}[A-Z]$")
_BSR_RE = re.compile(r"^[0-9]{7}$")
_SERIAL_RE = re.compile(r"^[0-9]{5}$")
_TENDER_RE = re.compile(r"^[0-9]{8}$")

_VALID_MAJOR_HEADS = {"0020", "0021"}
_VALID_PAYMENT_TYPES = {"200", "400"}


def validate_tds_challan(challan: dict, org: dict, computed: dict | None = None) -> DocumentCheck:
    challan = challan or {}
    org = org or {}
    computed = computed or {}

    chk = DocumentCheck(document="TDS challan")

    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Deductor name",
            "ITNS-281 names the deductor. A challan naming nobody evidences nothing.",
            _ORG_PROFILE_FIX,
        ))

    # TAN — section 203A. The PAN does not substitute for it.
    tan = str(org.get("tan") or "").strip().upper()
    if not tan:
        chk.blocking.append(Gap(
            "org.tan", "TAN",
            "Section 203A — the Tax Deduction Account Number is the deductor's "
            "identifier on ITNS-281 and on every quarterly return that quotes this "
            "challan. The PAN is not a substitute. NOTE: staging.organisations has "
            "no `tan` column at all today — see backend/migrations/PROPOSED_documents.sql §1.",
            _ORG_PROFILE_FIX,
        ))
    elif not _TAN_RE.match(tan):
        chk.blocking.append(Gap(
            "org.tan", "TAN format",
            f"'{tan}' is not a TAN. The format is four letters, five digits and one "
            "letter (e.g. MUMA12345B). A malformed TAN fails the portal outright.",
            _ORG_PROFILE_FIX,
        ))

    if _blank(challan.get("period")):
        chk.blocking.append(Gap(
            "challan.period", "Deduction period",
            "Rule 30 fixes the deposit due date by the month of deduction. Without "
            "the period neither the due date nor the assessment year is determinable.",
            _CHALLAN_FIX,
        ))
    if _blank(challan.get("deposit_date")):
        chk.blocking.append(Gap(
            "challan.deposit_date", "Deposit date",
            "The date the tax reached the government. It fixes whether interest "
            "under section 201(1A) runs.",
            _CHALLAN_FIX,
        ))

    # Major head and type of payment are stated, never inferred. The major head
    # is a property of the DEDUCTEE (0020 company / 0021 non-company), so it
    # cannot be derived from the deductor's own constitution.
    major = str(challan.get("major_head") or "").strip()
    if major not in _VALID_MAJOR_HEADS:
        chk.blocking.append(Gap(
            "challan.major_head", "Major head",
            "ITNS-281 requires 0020 (deductee is a company) or 0021 (deductee is "
            f"not). {'Nothing is recorded' if not major else repr(major) + ' is neither'}. "
            "It is a property of the deductee and is never inferred from the deductor.",
            _CHALLAN_FIX,
        ))
    ptype = str(challan.get("payment_type") or "").strip()
    if ptype not in _VALID_PAYMENT_TYPES:
        chk.blocking.append(Gap(
            "challan.payment_type", "Type of payment",
            "ITNS-281 requires 200 (TDS payable by taxpayer) or 400 (TDS on regular "
            f"assessment). {'Nothing is recorded' if not ptype else repr(ptype) + ' is neither'}.",
            _CHALLAN_FIX,
        ))

    # ── the CIN triple ──────────────────────────────────────────────────────
    bsr = str(challan.get("bsr_code") or "").strip()
    if not _BSR_RE.match(bsr):
        chk.blocking.append(Gap(
            "challan.bsr_code", "BSR code",
            "The BSR code of the collecting branch is the first element of the CIN "
            "and is seven digits. Without a valid one the deposit cannot be traced "
            "on OLTAS and the 26Q that quotes it will be rejected.",
            _CHALLAN_FIX,
        ))
    serial = str(challan.get("challan_serial") or "").strip()
    if not _SERIAL_RE.match(serial):
        chk.blocking.append(Gap(
            "challan.challan_serial", "Challan serial",
            "The challan serial number is the third element of the CIN and is five "
            "digits. An invented serial is worse than a missing one.",
            _CHALLAN_FIX,
        ))
    tender = str(challan.get("tender_date_ddmmyyyy") or "").strip()
    if tender and not _TENDER_RE.match(tender):
        chk.blocking.append(Gap(
            "challan.tender_date", "Tender date",
            "The CIN's tender date is eight digits, DDMMYYYY, with no separator.",
            _CHALLAN_FIX,
        ))

    # ── the arithmetic ──────────────────────────────────────────────────────
    if computed:
        total_tds = computed.get("total_tds", 0)
        tax_component = computed.get("tax_component", 0)
        deposited = computed.get("total_deposited", 0)
        if not computed.get("lines"):
            chk.blocking.append(Gap(
                "challan.deductions", "Deduction detail",
                "A challan with no deduction lines states no deduction. The section, "
                "nature of payment and amount are what a 26Q is built from.",
                _CHALLAN_FIX,
            ))
        elif total_tds != tax_component:
            chk.blocking.append(Gap(
                "challan.reconciliation", "Deposit reconciliation",
                f"The deduction lines total {total_tds:,} but the amount breakdown's "
                f"tax component (income tax + surcharge + cess) is {tax_component:,}. "
                "What was withheld and what was deposited do not agree, and the "
                "difference will surface as a short-deduction default on the 26Q.",
                _CHALLAN_FIX,
            ))
        if deposited <= 0:
            chk.blocking.append(Gap(
                "challan.total_deposited", "Amount deposited",
                "A challan that deposits nothing is not a challan.",
                _CHALLAN_FIX,
            ))

    # ── advisory ────────────────────────────────────────────────────────────
    if _blank(org.get("pan")):
        chk.advisory.append(Gap(
            "org.pan", "Deductor PAN",
            "Printed alongside the TAN on the counterfoil. Not a substitute for the "
            "TAN, but expected on the face of the document.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(challan.get("bank_name")):
        chk.advisory.append(Gap(
            "challan.bank_name", "Collecting bank",
            "The branch that accepted the deposit. The BSR code identifies it, but "
            "the name is what a reader checks against their own bank statement.",
            _CHALLAN_FIX,
        ))
    if _blank(org.get("authorized_signatory_name")):
        chk.advisory.append(Gap(
            "org.authorized_signatory_name", "Authorised signatory",
            "The counterfoil carries a signature block; without a name it signs for nobody.",
            _ORG_PROFILE_FIX,
        ))

    return chk


# ── Statement of account ─────────────────────────────────────────────────────
#
# Not a statutory document — no rule prescribes its form. It is nevertheless the
# document a client disputes a balance against, so the one thing it must do is
# reconcile: opening plus debits less credits must equal the closing balance
# printed in the meta strip, and the ageing buckets must sum to the amount
# outstanding. A statement whose running balance does not tie is worse than none.

def validate_statement(statement: dict, org: dict, contact: dict | None = None) -> DocumentCheck:
    statement = statement or {}
    org = org or {}
    contact = contact or {}

    chk = DocumentCheck(document="statement of account")

    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Issuer name",
            "A statement that does not name who issued it cannot be acted on.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(contact.get("name")) and _blank(contact.get("company")):
        chk.blocking.append(Gap(
            "contact.name", "Account holder",
            "The statement must name the account it states.",
            _CONTACT_FIX,
        ))
    if _blank(statement.get("period_start")) or _blank(statement.get("period_end")):
        chk.blocking.append(Gap(
            "statement.period", "Statement period",
            "A statement without a period states a balance as at no date, which "
            "cannot be reconciled against the recipient's own ledger.",
            _CONTACT_FIX,
        ))

    entries = statement.get("entries") or []
    opening = _num(statement.get("opening_balance"))
    debits = sum(_num(e.get("debit")) for e in entries)
    credits = sum(_num(e.get("credit")) for e in entries)
    closing = _num(statement.get("closing_balance"))
    if abs((opening + debits - credits) - closing) > 1.0:
        chk.blocking.append(Gap(
            "statement.closing_balance", "Balance reconciliation",
            f"Opening ({opening:,.2f}) plus debits ({debits:,.2f}) less credits "
            f"({credits:,.2f}) is {opening + debits - credits:,.2f}, but the closing "
            f"balance is stated as {closing:,.2f}. The ledger does not tie.",
            _CONTACT_FIX,
        ))

    ageing = statement.get("ageing") or {}
    if ageing:
        bucket_total = sum(_num(v) for v in ageing.values())
        # Ageing analyses the RECEIVABLE, so it ties to the closing balance only
        # when that balance is a debit. A credit balance (client in advance) has
        # nothing to age, which is why this is scoped rather than blanket.
        if closing > 0 and abs(bucket_total - closing) > 1.0:
            chk.blocking.append(Gap(
                "statement.ageing", "Ageing reconciliation",
                f"The ageing buckets total {bucket_total:,.2f} against a closing "
                f"balance of {closing:,.2f}. Buckets that do not sum to the "
                "outstanding amount mis-state how overdue the account is.",
                _CONTACT_FIX,
            ))

    if _blank(statement.get("statement_number")):
        chk.advisory.append(Gap(
            "statement.statement_number", "Statement number",
            "The statement's own identifier; without it a disputed statement cannot "
            "be cited by reference.",
            _CONTACT_FIX,
        ))
    bank = org.get("bank_details") or {}
    if not (isinstance(bank, dict) and bank.get("upi_id")):
        chk.advisory.append(Gap(
            "org.bank_details.upi_id", "UPI ID",
            "The statement offers a pay-by-UPI route. Without a UPI ID the block "
            "asks the reader to scan a code that settles nowhere.",
            _ORG_PROFILE_FIX,
        ))

    return chk


# ── Quotation ────────────────────────────────────────────────────────────────
#
# An offer, not a tax document. `validate_tax_invoice` already exempts quotations
# from the Rule 46 particulars and that reservation is preserved here: a
# quotation legitimately has no GSTIN, no HSN and no place of supply. What it
# must have is the things that make an offer capable of acceptance — a price, a
# validity date and an identifiable offeree.

def validate_quotation(quote: dict, org: dict, contact: dict | None = None) -> DocumentCheck:
    quote = quote or {}
    org = org or {}
    contact = contact or {}

    chk = DocumentCheck(document="quotation")

    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Offeror name",
            "An offer must name who is making it.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(contact.get("name")) and _blank(contact.get("company")):
        chk.blocking.append(Gap(
            "contact.name", "Prepared for",
            "An offer must name who it is open to.",
            _CONTACT_FIX,
        ))
    if _blank(quote.get("quote_number")):
        chk.blocking.append(Gap(
            "quote.quote_number", "Quotation number",
            "Acceptance is recorded against the number. Without one the accepted "
            "document cannot be identified.",
            _QUOTE_FIX,
        ))
    if _blank(quote.get("quote_date")):
        chk.blocking.append(Gap(
            "quote.quote_date", "Quote date",
            "The date the offer was made; validity runs from it.",
            _QUOTE_FIX,
        ))
    if not (quote.get("line_items") or []):
        chk.blocking.append(Gap(
            "quote.line_items", "Line items",
            "A quotation with no lines quotes for nothing.",
            _QUOTE_FIX,
        ))

    # The totals on the face of the document must agree with the lines. A
    # quotation is capable of acceptance; a wrong total is a wrong contract.
    lines_total = sum(_num(li.get("line_total")) for li in (quote.get("line_items") or []))
    subtotal = _num(quote.get("subtotal"))
    if quote.get("line_items") and abs(lines_total - subtotal) > 1.0:
        chk.blocking.append(Gap(
            "quote.subtotal", "Subtotal reconciliation",
            f"The lines total {lines_total:,.2f} but the subtotal is stated as "
            f"{subtotal:,.2f}. The figure a client would accept is not the figure "
            "the lines support.",
            _QUOTE_FIX,
        ))

    # Tax treatment must not contradict itself — the same reservation
    # `validate_tax_invoice` makes, applied to the offer.
    igst, cgst, sgst = _num(quote.get("igst")), _num(quote.get("cgst")), _num(quote.get("sgst"))
    if quote.get("is_igst") and (cgst > 0 or sgst > 0):
        chk.blocking.append(Gap(
            "quote.tax_split", "Tax split",
            "The quotation is marked inter-State (IGST) but carries CGST/SGST. One "
            "supply cannot be quoted both ways.",
            _QUOTE_FIX,
        ))
    if not quote.get("is_igst") and igst > 0:
        chk.blocking.append(Gap(
            "quote.tax_split", "Tax split",
            "The quotation is marked intra-State (CGST/SGST) but carries IGST.",
            _QUOTE_FIX,
        ))

    if _blank(quote.get("valid_until")):
        chk.advisory.append(Gap(
            "quote.valid_until", "Valid until",
            "An offer with no expiry stays open indefinitely and can be accepted "
            "long after the rates behind it have moved.",
            _QUOTE_FIX,
        ))
    if not (quote.get("payment_schedule") or []):
        chk.advisory.append(Gap(
            "quote.payment_schedule", "Payment schedule",
            "The approved design prints a milestone payment schedule. No column "
            "records one — see backend/migrations/PROPOSED_documents.sql §6.",
            _QUOTE_FIX,
        ))
    if not (quote.get("terms") or []):
        # Worded precisely, because the renderer DOES print a default set and an
        # advisory saying "no terms" beside four printed terms reads as a bug.
        # The gap is that they are Kartavaya's, not this firm's.
        chk.advisory.append(Gap(
            "quote.terms", "Terms",
            "No terms are recorded against this quotation, so it carries the "
            "default set — validity, exclusions and what starts the engagement. "
            "Those are the terms a client would be accepting.",
            _QUOTE_FIX,
        ))

    return chk


# ── Service agreement ────────────────────────────────────────────────────────
#
# A contract, and the specification is explicit that what it renders is an
# execution copy pending legal review, not advice. The blocking set is
# correspondingly narrow: the things without which the document is not a
# contract at all — two identified parties, an effective date, a scope, and a
# consideration.

def validate_service_agreement(agreement: dict, org: dict, contact: dict | None = None) -> DocumentCheck:
    agreement = agreement or {}
    org = org or {}
    contact = contact or {}

    chk = DocumentCheck(document="service agreement")

    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Service provider",
            "A contract must identify both parties. This one identifies neither "
            "side if the provider is unnamed.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(contact.get("name")) and _blank(contact.get("company")):
        chk.blocking.append(Gap(
            "contact.name", "Client",
            "A contract must identify both parties.",
            _CONTACT_FIX,
        ))
    if _blank(agreement.get("agreement_number")):
        chk.blocking.append(Gap(
            "agreement.agreement_number", "Agreement number",
            "Every clause, change request and invoice cites it.",
            _CONTRACT_FIX,
        ))
    if _blank(agreement.get("effective_date")):
        chk.blocking.append(Gap(
            "agreement.effective_date", "Effective date",
            "The term runs from it and the obligations start on it.",
            _CONTRACT_FIX,
        ))
    if not (agreement.get("scope") or []):
        chk.blocking.append(Gap(
            "agreement.scope", "Scope of services",
            "An agreement to provide unspecified services is unenforceable in its "
            "central obligation.",
            _CONTRACT_FIX,
        ))
    if _num(agreement.get("fee")) <= 0:
        chk.blocking.append(Gap(
            "agreement.fee", "Professional fee",
            "The consideration. An agreement stating no fee states no bargain.",
            _CONTRACT_FIX,
        ))

    # If milestones are given they must apportion the whole fee. A schedule that
    # invoices to 90% leaves the last tranche uninvoiceable.
    milestones = agreement.get("milestones") or []
    if milestones:
        share = sum(_num(m.get("share_pct")) for m in milestones)
        if abs(share - 100.0) > 0.5:
            chk.blocking.append(Gap(
                "agreement.milestones", "Milestone shares",
                f"The milestone shares total {share:.1f}%, not 100%. The schedule "
                "either over- or under-invoices the agreed fee.",
                _CONTRACT_FIX,
            ))
        fee_sum = sum(_num(m.get("fee")) for m in milestones)
        if abs(fee_sum - _num(agreement.get("fee"))) > 1.0:
            chk.blocking.append(Gap(
                "agreement.milestones", "Milestone fees",
                f"The milestone fees total {fee_sum:,.2f} against an agreed fee of "
                f"{_num(agreement.get('fee')):,.2f}.",
                _CONTRACT_FIX,
            ))

    if _blank(agreement.get("governing_law")):
        chk.advisory.append(Gap(
            "agreement.governing_law", "Governing law and seat",
            "The dispute-resolution clause names a seat, a venue and a jurisdiction. "
            "Left blank the clause resolves nothing.",
            _CONTRACT_FIX,
        ))
    if _blank(contact.get("gstin")):
        chk.advisory.append(Gap(
            "contact.gstin", "Client GSTIN",
            "The fees clause states the GST treatment and the place of supply. "
            "Without the client's GSTIN neither is verifiable from the face of the "
            "agreement.",
            _CONTACT_FIX,
        ))
    if _blank(org.get("authorized_signatory_name")):
        chk.advisory.append(Gap(
            "org.authorized_signatory_name", "Authorised signatory",
            "The execution block signs for nobody without a named representative.",
            _ORG_PROFILE_FIX,
        ))

    return chk


# ── Project report ───────────────────────────────────────────────────────────
#
# The only document in the set with no statutory content at all. It still
# refuses on one thing: a report that names a period it does not cover, or
# states a variance without both sides of the comparison, misleads a client
# more efficiently than no report.

def validate_project_report(report: dict, org: dict, client: dict | None = None) -> DocumentCheck:
    report = report or {}
    org = org or {}
    client = client or {}

    chk = DocumentCheck(document="project report")

    if _blank(org.get("name")):
        chk.blocking.append(Gap(
            "org.name", "Reporting organisation",
            "A report that does not name its author cannot be relied on.",
            _ORG_PROFILE_FIX,
        ))
    if _blank(report.get("project_name")):
        chk.blocking.append(Gap(
            "report.project_name", "Project",
            "The report must name the project it reports on.",
            _BOARD_FIX,
        ))
    if _blank(report.get("period_start")) or _blank(report.get("period_end")):
        chk.blocking.append(Gap(
            "report.period", "Reporting period",
            "Every figure in the report is 'as at' a date. Without the period the "
            "reader cannot tell whether the position is current.",
            _BOARD_FIX,
        ))

    # A measure row states plan, actual and variance. Variance that does not
    # equal actual less plan is a number the reader will act on and cannot check.
    for i, m in enumerate(report.get("measures") or [], 1):
        if not m.get("numeric"):
            continue
        plan, actual = _num(m.get("plan")), _num(m.get("actual"))
        variance = _num(m.get("variance"))
        if abs((actual - plan) - variance) > 0.5:
            chk.blocking.append(Gap(
                f"report.measures.{i}", f"Measure '{m.get('label', i)}'",
                f"Actual ({actual:,.2f}) less plan ({plan:,.2f}) is "
                f"{actual - plan:,.2f}, but the variance column states "
                f"{variance:,.2f}.",
                _BOARD_FIX,
            ))

    if not (report.get("milestones") or []):
        chk.advisory.append(Gap(
            "report.milestones", "Milestones",
            "The approved design prints a milestone table with target, forecast and "
            "state. No milestone store exists — see backend/migrations/PROPOSED_documents.sql §7.",
            _BOARD_FIX,
        ))
    if not (report.get("risks") or []):
        chk.advisory.append(Gap(
            "report.risks", "Risk register",
            "The design prints severity, risk, mitigation and owner. No risk store "
            "exists — see backend/migrations/PROPOSED_documents.sql §7.",
            _BOARD_FIX,
        ))
    if _blank(report.get("prepared_by")):
        chk.advisory.append(Gap(
            "report.prepared_by", "Prepared by",
            "The report carries a 'Prepared by' signature line.",
            _BOARD_FIX,
        ))
    if _blank(client.get("name")) and _blank(client.get("company")):
        chk.advisory.append(Gap(
            "client.name", "Prepared for",
            "An internal report is legitimate, but the design's 'Prepared for' block "
            "is then empty rather than addressed.",
            _CONTACT_FIX,
        ))

    return chk
