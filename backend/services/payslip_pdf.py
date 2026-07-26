"""payslip_pdf.py — PDF (WeasyPrint) generation for Vetana payslips.

Indian-format payslip with earnings/deductions breakdown,
attendance summary, and statutory details.

Statutory completeness is checked BEFORE rendering, in `services.doc_validation`.
A payslip whose figures do not reconcile, or which records a PF/ESI/TDS
deduction the employee has no identifier for, raises `DocumentIncomplete` and no
PDF is produced.
"""
import base64
import html
import logging

from services.doc_fonts import deva_span, font_face_css, group_indian
from services.doc_validation import DocumentCheck, validate_payslip
from services.invoice_pdf import amount_in_words_inr

_INK      = "#1A2230"
_INK2     = "#4A5468"
_INK3     = "#6E7B91"
_RULE     = "#E2DCC9"
_RULE_SOFT= "#EFE9D8"
_BG_SOFT  = "#F0ECDF"
_SURFACE  = "#FCFAF5"
_TEAL     = "#05b7aa"
_DEEP     = "#0082c6"

_FONT_DISP = 'Georgia, "Times New Roman", serif'
_FONT_UI   = '"Helvetica Neue", Arial, sans-serif'
_FONT_MONO = '"Courier New", monospace'

log = logging.getLogger(__name__)


def _embed_logo(logo_url: str) -> str:
    if not logo_url:
        return ""
    try:
        import httpx
        resp = httpx.get(logo_url, timeout=8)
        resp.raise_for_status()
        mime = resp.headers.get("content-type", "image/png").split(";")[0]
        b64 = base64.b64encode(resp.content).decode("ascii")
        return f'<img src="data:{mime};base64,{b64}" class="pdf__logo" />'
    except Exception as e:
        log.warning("payslip_pdf: logo fetch failed for %s: %s", logo_url, e)
        return ""


def _fmt(val) -> str:
    """Indian 2,2,3 grouping — `18-documents.md` §Numbers."""
    return f"₹{group_indian(val)}"


def _esc(val) -> str:
    return html.escape(str(val or ""))


def _fmt_addr(addr) -> str:
    if not isinstance(addr, dict):
        return ""
    fields = [addr.get(k, "") for k in ("line1", "line2", "city", "state", "pincode", "country")]
    return ", ".join(f for f in fields if f)


def _month_label(month_str: str) -> str:
    """Convert 'YYYY-MM' to 'July 2026'."""
    try:
        from datetime import datetime
        dt = datetime.strptime(month_str, "%Y-%m")
        return dt.strftime("%B %Y")
    except Exception:
        return month_str or ""


def _advisory_note(check: DocumentCheck) -> str:
    """Advisory gaps, named in the document rather than left silent."""
    if not check.advisory:
        return ""
    items = "".join(f"<li>{html.escape(g.label)} — {html.escape(g.reason)}</li>" for g in check.advisory)
    return (
        '<div class="pdf__gap-note">'
        "<b>Incomplete details.</b> This payslip is issuable, but the fields below "
        "are not on file and nothing has been invented to fill them."
        f"<ul>{items}</ul></div>"
    )


def _build_html(payslip: dict, employee: dict, org: dict, check: DocumentCheck | None = None) -> str:
    check = check or DocumentCheck(document="payslip")
    org_name = _esc(org.get("name"))
    org_gstin = _esc(org.get("gstin"))
    org_pan = _esc(org.get("pan"))
    org_addr = _esc(_fmt_addr(org.get("billing_address") or {}))
    org_contact_line = _esc(" · ".join(
        f for f in [org.get("email", ""), org.get("phone", ""), org.get("website", "")] if f
    ))
    logo_html = _embed_logo(org.get("logo_url") or "")

    month_label = _month_label(payslip.get("month", ""))
    ps_number = _esc(payslip.get("payslip_number"))

    # Employee details
    emp_name = _esc(employee.get("name"))
    emp_id = _esc(employee.get("employee_id") or employee.get("code") or employee.get("employee_code"))
    emp_dept = _esc(employee.get("department_name") or employee.get("department"))
    emp_desg = _esc(employee.get("designation"))
    emp_pan = _esc(employee.get("pan"))
    emp_uan = _esc(employee.get("uan"))
    # The design spec's "Statutory" block is UAN + PF A/c + ESI
    # (`docs/Payslip.html`, `18-documents.md` §Payslip). The ESI number column
    # exists on `staging.manav_employees` and was simply never rendered.
    # `pf_number` has no column at all — see the field audit in the swarm report.
    emp_esi = _esc(employee.get("esi_number"))
    emp_pf_no = _esc(employee.get("pf_number"))
    emp_bank = _esc(employee.get("bank_account"))
    emp_bank_name = _esc(employee.get("bank_name"))

    # Earnings rows
    earnings = [
        ("Basic", payslip.get("basic")),
        ("HRA", payslip.get("hra")),
        ("DA", payslip.get("da")),
        ("Special Allowance", payslip.get("special_allowance")),
        ("Conveyance", payslip.get("conveyance")),
        ("Medical", payslip.get("medical")),
        ("Overtime Pay", payslip.get("overtime_pay")),
        ("Reimbursements", payslip.get("reimbursements")),
    ]
    earnings_rows = ""
    for label, val in earnings:
        if float(val or 0) > 0:
            earnings_rows += f'<tr><td>{label}</td><td class="num">{_fmt(val)}</td></tr>'
    earnings_rows += f'<tr class="total-row"><td>Total Earnings</td><td class="num">{_fmt(payslip.get("gross"))}</td></tr>'

    # Deductions rows
    deductions = [
        ("PF (Employee)", payslip.get("pf_employee")),
        ("ESI (Employee)", payslip.get("esi_employee")),
        ("Professional Tax", payslip.get("professional_tax")),
        ("TDS", payslip.get("tds")),
        ("Loan Deduction", payslip.get("loan_deduction")),
    ]
    deductions_rows = ""
    for label, val in deductions:
        if float(val or 0) > 0:
            deductions_rows += f'<tr><td>{label}</td><td class="num">{_fmt(val)}</td></tr>'
    deductions_rows += f'<tr class="total-row"><td>Total Deductions</td><td class="num">{_fmt(payslip.get("total_deductions"))}</td></tr>'

    net_pay = float(payslip.get("net_pay") or 0)
    words = amount_in_words_inr(net_pay)

    sig_name = _esc(org.get("authorized_signatory_name") or "")
    sig_desg = _esc(org.get("authorized_signatory_designation") or "")

    body = f"""
<div class="pdf">
  <div class="pdf__head">
    <div class="pdf__brand">
      {logo_html}
      <div>
        <div class="pdf__org-name">{org_name}</div>
        {f'<div class="pdf__org-line">GSTIN: {org_gstin}{" · PAN: " + org_pan if org_pan else ""}</div>' if org_gstin or org_pan else ''}
        {f'<div class="pdf__org-line">{org_addr}</div>' if org_addr else ''}
        {f'<div class="pdf__org-line">{org_contact_line}</div>' if org_contact_line else ''}
      </div>
    </div>
    <div class="pdf__doc-meta">
      <div class="pdf__doc-title">Payslip</div>
      <div class="pdf__meta-row"><span>No.</span><b>{ps_number}</b></div>
      <div class="pdf__meta-row"><span>Month</span><b>{month_label}</b></div>
      <div class="pdf__meta-row"><span>Pay Period</span><b>{month_label}</b></div>
    </div>
  </div>

  <div class="pdf__emp-card">
    <div class="pdf__emp-h">Employee Details</div>
    <div class="pdf__emp-grid">
      <div class="pdf__emp-field"><span>Name</span><b>{emp_name}</b></div>
      <div class="pdf__emp-field"><span>Employee ID</span><b>{emp_id}</b></div>
      <div class="pdf__emp-field"><span>Department</span><b>{emp_dept}</b></div>
      <div class="pdf__emp-field"><span>Designation</span><b>{emp_desg}</b></div>
      {f'<div class="pdf__emp-field"><span>PAN</span><b>{emp_pan}</b></div>' if emp_pan else ''}
      {f'<div class="pdf__emp-field"><span>UAN</span><b>{emp_uan}</b></div>' if emp_uan else ''}
      {f'<div class="pdf__emp-field"><span>PF A/c</span><b>{emp_pf_no}</b></div>' if emp_pf_no else ''}
      {f'<div class="pdf__emp-field"><span>ESI no.</span><b>{emp_esi}</b></div>' if emp_esi else ''}
      {f'<div class="pdf__emp-field"><span>Bank</span><b>{emp_bank_name}</b></div>' if emp_bank_name else ''}
      {f'<div class="pdf__emp-field"><span>Account</span><b>{emp_bank}</b></div>' if emp_bank else ''}
    </div>
  </div>

  <div class="pdf__tables">
    <div class="pdf__half">
      <table class="pdf__table">
        <thead><tr><th colspan="2">Earnings</th></tr></thead>
        <tbody>{earnings_rows}</tbody>
      </table>
    </div>
    <div class="pdf__half">
      <table class="pdf__table">
        <thead><tr><th colspan="2">Deductions</th></tr></thead>
        <tbody>{deductions_rows}</tbody>
      </table>
    </div>
  </div>

  <div class="pdf__net">
    <div class="pdf__net-row">
      <span class="pdf__net-label">Net Pay</span>
      <span class="pdf__net-value">{_fmt(net_pay)}</span>
    </div>
    <div class="pdf__words">{html.escape(words)}</div>
  </div>

  <div class="pdf__attendance">
    <div class="pdf__att-h">Attendance Summary</div>
    <div class="pdf__att-grid">
      <div class="pdf__att-item"><span>Working Days</span><b>{payslip.get("working_days", 0)}</b></div>
      <div class="pdf__att-item"><span>Present Days</span><b>{payslip.get("present_days", 0)}</b></div>
      <div class="pdf__att-item"><span>Paid Leaves</span><b>{payslip.get("leaves_paid", 0)}</b></div>
      <div class="pdf__att-item"><span>Unpaid Leaves</span><b>{payslip.get("leaves_unpaid", 0)}</b></div>
    </div>
  </div>

  <div class="pdf__employer-note">
    <span>Employer Contributions — PF: {_fmt(payslip.get("pf_employer"))} · ESI: {_fmt(payslip.get("esi_employer"))}</span>
  </div>

  <div class="pdf__footer">
    <div class="pdf__sig">
      <div class="pdf__sig-line"></div>
      <div class="pdf__sig-name">{sig_name}</div>
      {f'<div class="pdf__sig-desg">{sig_desg}</div>' if sig_desg else ''}
      <div class="pdf__sig-label">Authorized Signatory</div>
    </div>
    <div class="pdf__computer-note">This is a computer-generated document and does not require a physical signature.</div>
  </div>

  {_advisory_note(check)}

  <div class="pdf__colophon">Generated by Kartavaya · {deva_span("कर्तव्य", "Kartavya")} — by Aekam Inc</div>
</div>"""

    css = f"""
{font_face_css()}
*{{ box-sizing:border-box; margin:0; padding:0; }}
body{{ background:{_SURFACE}; font-family:{_FONT_UI}; color:{_INK}; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
@page{{ size:A4; margin:0; }}
.pdf{{ width:210mm; min-height:297mm; background:{_SURFACE}; padding:40px 48px; display:flex; flex-direction:column; gap:16px; }}

.pdf__head{{ display:flex; justify-content:space-between; gap:24px; padding-bottom:16px; border-bottom:2px solid {_INK}; }}
.pdf__brand{{ display:flex; gap:14px; align-items:flex-start; }}
.pdf__logo{{ width:56px; height:56px; object-fit:contain; }}
.pdf__org-name{{ font-family:{_FONT_DISP}; font-size:20px; font-weight:700; color:{_INK}; }}
.pdf__org-line{{ font-size:10.5px; color:{_INK3}; margin-top:2px; }}
.pdf__doc-meta{{ text-align:right; }}
.pdf__doc-title{{ font-family:{_FONT_DISP}; font-size:22px; font-weight:700; color:{_DEEP}; letter-spacing:-0.01em; margin-bottom:6px; }}
.pdf__meta-row{{ font-size:11px; color:{_INK3}; display:flex; justify-content:flex-end; gap:8px; }}
.pdf__meta-row b{{ color:{_INK}; min-width:90px; text-align:right; }}

.pdf__emp-card{{ background:{_BG_SOFT}; border:1px solid {_RULE}; border-radius:8px; padding:12px 16px; }}
.pdf__emp-h{{ font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:{_INK3}; font-weight:700; margin-bottom:8px; }}
.pdf__emp-grid{{ display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:6px 16px; }}
.pdf__emp-field{{ font-size:10.5px; }}
.pdf__emp-field span{{ color:{_INK3}; display:block; font-size:9px; }}
.pdf__emp-field b{{ color:{_INK}; font-weight:600; }}

.pdf__tables{{ display:flex; gap:20px; }}
.pdf__half{{ flex:1; }}
.pdf__table{{ width:100%; border-collapse:collapse; font-size:11.5px; }}
.pdf__table th{{ text-align:left; font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:#fff; background:{_INK}; font-weight:700; padding:8px; }}
.pdf__table td{{ padding:7px 8px; border-bottom:1px solid {_RULE_SOFT}; }}
.pdf__table td.num{{ text-align:right; font-family:{_FONT_MONO}; font-size:10.5px; }}
.pdf__table .total-row td{{ border-top:2px solid {_RULE}; font-weight:700; background:{_BG_SOFT}; }}

.pdf__net{{ background:{_INK}; color:#fff; border-radius:8px; padding:14px 20px; }}
.pdf__net-row{{ display:flex; justify-content:space-between; align-items:center; }}
.pdf__net-label{{ font-size:14px; font-weight:700; letter-spacing:0.02em; }}
.pdf__net-value{{ font-family:{_FONT_MONO}; font-size:20px; font-weight:700; color:{_TEAL}; }}
.pdf__words{{ font-size:10.5px; color:rgba(255,255,255,0.7); font-style:italic; margin-top:4px; }}

.pdf__attendance{{ background:{_BG_SOFT}; border:1px solid {_RULE}; border-radius:8px; padding:10px 16px; }}
.pdf__att-h{{ font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:{_INK3}; font-weight:700; margin-bottom:6px; }}
.pdf__att-grid{{ display:flex; gap:32px; }}
.pdf__att-item{{ font-size:11px; color:{_INK2}; }}
.pdf__att-item b{{ color:{_INK}; margin-left:4px; }}

.pdf__employer-note{{ font-size:10px; color:{_INK3}; font-style:italic; }}

.pdf__footer{{ margin-top:auto; padding-top:14px; display:flex; justify-content:space-between; align-items:flex-end; }}
.pdf__sig{{ text-align:center; min-width:180px; }}
.pdf__sig-line{{ border-bottom:1px solid {_INK3}; width:160px; margin:0 auto 6px; }}
.pdf__sig-name{{ font-size:12px; font-weight:700; color:{_INK}; }}
.pdf__sig-desg{{ font-size:10px; color:{_INK3}; }}
.pdf__sig-label{{ font-size:9px; color:{_INK3}; letter-spacing:0.1em; text-transform:uppercase; margin-top:2px; }}
.pdf__computer-note{{ font-size:9px; color:{_INK3}; font-style:italic; max-width:260px; text-align:right; }}

.pdf__colophon{{ text-align:center; font-size:9px; color:{_INK3}; border-top:1px solid {_RULE_SOFT}; padding-top:10px; }}

.pdf__gap-note{{ background:#FADAD6; border-radius:6px; padding:9px 12px; font-size:10px; color:#7A1B12; line-height:1.5; }}
.pdf__gap-note b{{ display:block; font-size:10.5px; }}
.pdf__gap-note ul{{ margin:4px 0 0 16px; }}
"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>{css}</style></head>
<body>{body}</body>
</html>"""


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

    try:
        from weasyprint import HTML
    except ImportError as e:
        raise RuntimeError("WeasyPrint is not available on this server") from e
    html_str = _build_html(payslip, employee, org, check)
    return HTML(string=html_str, base_url=None).write_pdf()
