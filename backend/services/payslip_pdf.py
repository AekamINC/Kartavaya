"""payslip_pdf.py — PDF (WeasyPrint) generation for Vetana payslips.

Indian-format payslip with earnings/deductions breakdown,
attendance summary, and statutory details.

Statutory completeness is checked BEFORE rendering, in `services.doc_validation`.
A payslip whose figures do not reconcile, or which records a PF/ESI/TDS
deduction the employee has no identifier for, raises `DocumentIncomplete` and no
PDF is produced.

One brand layer, not two
------------------------
This module used to carry its OWN stylesheet, as `invoice_pdf.py` did, and its
palette had drifted furthest of the whole set: `--doc-ink` as #1A2230 against a
specified #14171A, `--doc-rule` as #E2DCC9 against #D9D5CA, a cream #FCFAF5
sheet where brand.css says #fff, and the RETIRED brand blue #0082c6 still
setting the "Payslip" heading. Every one of those is gone: the document is now
painted from `services/doc_render.py`, which resolves brand.css once for all
eight documents. Nothing about the CONTENT changed with the move — the same
fields, the same figures, the same reconciliation.

The layout follows `design-reference/Kartavaya Redesign/docs/Payslip.html`:
letterhead, meta strip, Employee / Statutory parties, Earnings and Deductions
two-up, the net-pay totals block, the words line, and the colophon.
"""
import logging

from services import doc_render as R
from services.doc_fonts import group_indian
from services.doc_validation import DocumentCheck, validate_payslip
from services.invoice_pdf import amount_in_words_inr

log = logging.getLogger(__name__)


def _fmt(val) -> str:
    """Indian 2,2,3 grouping — `18-documents.md` §Numbers."""
    return f"₹{group_indian(val)}"


def _month_label(month_str: str) -> str:
    """Convert 'YYYY-MM' to 'July 2026'."""
    try:
        from datetime import datetime
        dt = datetime.strptime(month_str, "%Y-%m")
        return dt.strftime("%B %Y")
    except Exception:
        return month_str or ""


def _mono(value) -> str:
    """A statutory identifier, in the mono face brand.css gives them."""
    return f'<span class="num num--left">{R.esc(value)}</span>'


def _amount_rows(pairs) -> list[str]:
    """`.lines` rows for a two-column money table, non-zero entries only."""
    rows = []
    for label, val in pairs:
        try:
            amount = float(val or 0)
        except (TypeError, ValueError):
            amount = 0.0
        if amount > 0:
            rows.append(
                f'<tr><td>{R.esc(label)}</td>'
                f'<td class="num">{group_indian(amount, decimals=0)}</td></tr>'
            )
    return rows


def _build_html(payslip: dict, employee: dict, org: dict, check: DocumentCheck | None = None) -> str:
    check = check or DocumentCheck(document="payslip")
    payslip, employee, org = payslip or {}, employee or {}, org or {}

    month_label = _month_label(payslip.get("month", ""))

    # ── letterhead ───────────────────────────────────────────────────────────
    # `.lh__kind-hi` is deliberately not added — see `invoice_pdf._build_html`.
    head = R.letterhead(
        org,
        kind_en="Payslip",
        kind_hi="",
        doc_no=payslip.get("payslip_number") or "",
    )

    working = payslip.get("working_days", 0) or 0
    present = payslip.get("present_days", 0) or 0
    meta = R.meta_strip([
        ("Pay period", R.esc(month_label) or R.unset("Pay period")),
        ("Payable days", f"{R.esc(present)} of {R.esc(working)}" if working else "&mdash;"),
        ("Paid leaves", R.esc(payslip.get("leaves_paid", 0) or 0)),
        ("Unpaid leaves", R.esc(payslip.get("leaves_unpaid", 0) or 0)),
    ])

    # ── Employee / Statutory ─────────────────────────────────────────────────
    role_bits = [str(employee.get(k) or "").strip()
                 for k in ("designation", "department_name", "department")]
    role = " &middot; ".join(R.esc(b) for b in dict.fromkeys(b for b in role_bits if b))

    emp_id = employee.get("employee_id") or employee.get("code") or employee.get("employee_code")
    id_bits = []
    if emp_id:
        id_bits.append(f"Emp ID {R.esc(emp_id)}")
    if employee.get("pan"):
        id_bits.append(f'PAN {R.esc(employee["pan"])}')

    # The design's "Statutory" column is UAN + PF A/c + ESI. Each is shown only
    # when the employee HAS one: `validate_payslip` already refuses a slip that
    # deducts PF/ESI/TDS from someone with no matching identifier, so an absent
    # line here means the deduction is absent too, not that it is unrecorded.
    statutory = []
    for label, key in (("UAN", "uan"), ("PF A/c", "pf_number"), ("ESI", "esi_number")):
        if employee.get(key):
            statutory.append(f"{label} {_mono(employee[key])}")
    for label, key in (("Bank", "bank_name"), ("A/c", "bank_account")):
        if employee.get(key):
            statutory.append(f"{label} {_mono(employee[key])}")

    party_block = R.parties(
        R.party(
            "Employee",
            name=R.esc(employee.get("name")) if employee.get("name") else R.unset("Employee name"),
            addr_html=role,
            id_html=" &middot; ".join(id_bits),
        ),
        R.party(
            "Statutory",
            body_html="<br>".join(statutory) or '<span class="lines__mute">None recorded.</span>',
        ),
    )

    # ── Earnings / Deductions ────────────────────────────────────────────────
    earnings = _amount_rows([
        ("Basic", payslip.get("basic")),
        ("HRA", payslip.get("hra")),
        ("DA", payslip.get("da")),
        ("Special allowance", payslip.get("special_allowance")),
        ("Conveyance", payslip.get("conveyance")),
        ("Medical", payslip.get("medical")),
        ("Overtime pay", payslip.get("overtime_pay")),
        ("Reimbursements", payslip.get("reimbursements")),
    ])
    earnings.append(
        f'<tr class="lines__foot"><td>Gross earnings</td>'
        f'<td class="num">{group_indian(payslip.get("gross") or 0, decimals=0)}</td></tr>'
    )
    deductions = _amount_rows([
        ("PF (employee)", payslip.get("pf_employee")),
        ("ESI (employee)", payslip.get("esi_employee")),
        ("Professional tax", payslip.get("professional_tax")),
        ("TDS (section 192)", payslip.get("tds")),
        ("Loan deduction", payslip.get("loan_deduction")),
    ])
    deductions.append(
        f'<tr class="lines__foot"><td>Total deductions</td>'
        f'<td class="num">{group_indian(payslip.get("total_deductions") or 0, decimals=0)}</td></tr>'
    )

    two_up = R.parties(
        R.block("Earnings", R.table([("Component", "", ""), ("Amount", "num", "92px")], earnings), top="0"),
        R.block("Deductions", R.table([("Component", "", ""), ("Amount", "num", "92px")], deductions), top="0"),
    )

    # ── net pay ──────────────────────────────────────────────────────────────
    net_pay = float(payslip.get("net_pay") or 0)
    totals_html = R.totals(
        [
            ("Gross earnings", _fmt(payslip.get("gross"))),
            ("Less deductions", f'&minus;{_fmt(payslip.get("total_deductions"))}'),
        ],
        grand=("Net pay", _fmt(net_pay)),
    )
    words = R.words_line(
        f"Net pay in words &mdash; <b>{R.esc(amount_in_words_inr(net_pay))}</b>"
    )

    # ── employer contributions and signature ─────────────────────────────────
    # Employer PF/ESI are not part of net pay and are stated separately so they
    # cannot be read as a deduction from the employee.
    employer = R.block(
        "Employer contributions",
        R.terms_list([
            f'Provident fund {_fmt(payslip.get("pf_employer"))}',
            f'ESI {_fmt(payslip.get("esi_employer"))}',
            "Employer contributions are not deducted from net pay.",
        ]),
        top="0",
    )
    sign = R.sign_block(
        "Authorised signatory",
        org.get("authorized_signatory_name") or "",
        org.get("authorized_signatory_designation") or "",
    )

    page = "".join([
        head, meta, party_block, two_up,
        totals_html, words,
        R.parties(employer, sign, flush=True),
        R.gap_note(check),
        R.foot(
            "Confidential &middot; computer-generated payslip, valid without a "
            "physical signature &middot; figures in Indian rupees"
        ),
    ])
    return R.document(
        [page], org, title="Payslip — Kartavaya",
        running=R.running_id(
            "Payslip", org,
            " · ".join(p for p in (payslip.get("payslip_number") or "", month_label) if p),
        ),
    )


def generate_payslip_pdf(payslip: dict, employee: dict, org: dict) -> bytes:
    """Render a payslip to a PDF byte string via WeasyPrint.

    Raises `services.doc_validation.DocumentIncomplete` when the slip is missing
    a mandatory particular or its figures do not reconcile. Checked here rather
    than in the router so the payroll-run email path is covered too — that path
    swallows exceptions and mails the slip with no attachment, which is the
    right failure (no document) but must not become a silently wrong one.
    """
    payslip, employee, org = payslip or {}, employee or {}, org or {}
    check = validate_payslip(payslip, employee, org)
    check.raise_if_incomplete()
    # `doc_render.render_pdf` is the single PDF path for the whole set, and
    # catches the OSError a missing libgobject/libpango raises from dlopen as
    # well as ImportError.
    return R.render_pdf(_build_html(payslip, employee, org, check))
