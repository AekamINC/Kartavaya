"""invoice_pdf.py — PDF (WeasyPrint) generation for Ganit invoices.

Two letterhead variants sharing one layout:
  - GST Tax Invoice (default) — CGST/SGST or IGST breakdown, HSN/SAC codes,
    amount in words (Indian lakh/crore grouping).
  - Export Invoice (invoice["is_export"]) — zero-rated declaration in place
    of the GST breakdown, foreign currency, no amount-in-words (recipient's
    numbering convention is unknown).

Statutory completeness is checked BEFORE rendering, in `services.doc_validation`.
A tax invoice missing a mandatory Rule 46 particular raises `DocumentIncomplete`
and no PDF is produced. Advisory gaps render, marked in red. See that module for
which is which and why.
"""
import base64
import html
import logging

from services.doc_fonts import DISPLAY_STACK, deva_span, font_face_css, group_indian
from services.doc_validation import DocumentCheck, validate_tax_invoice

_INK      = "#1A2230"
_INK2     = "#4A5468"
_INK3     = "#6E7B91"
_RULE     = "#E2DCC9"
_RULE_SOFT= "#EFE9D8"
_BG_SOFT  = "#F0ECDF"
_SURFACE  = "#FCFAF5"
_TEAL     = "#05b7aa"
_DEEP     = "#0082c6"
_DANGER   = "#C0392B"

# Font stacks. The spec family is named FIRST, then a chain that degrades onto
# faces the render image actually ships.
#
# Georgia, Times New Roman, Helvetica Neue, Arial and Courier New — what these
# stacks named before — are installed in NO build of this image. Every name
# missed and each stack fell through to its generic, so every invoice PDF was
# silently DejaVu. Newsreader is now vendored (`services/doc_fonts.py`) and
# declared with `@font-face`, so the first name resolves; the rest is fallback.
_FONT_DISP = DISPLAY_STACK
_FONT_UI   = 'Inter, "Noto Sans", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif'
_FONT_MONO = '"JetBrains Mono", "Noto Sans Mono", "DejaVu Sans Mono", "Courier New", monospace'

_CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED ", "SGD": "S$"}

log = logging.getLogger(__name__)

_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
         "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
         "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two_digit_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (f" {_ONES[n % 10]}" if n % 10 else "")).strip()


def _three_digit_words(n: int) -> str:
    if n >= 100:
        rest = n % 100
        return f"{_ONES[n // 100]} Hundred" + (f" {_two_digit_words(rest)}" if rest else "")
    return _two_digit_words(n)


def amount_in_words_inr(amount: float) -> str:
    """Indian numbering (lakh/crore) amount-in-words, e.g. 'Rupees Two Lakh Thirty Four Thousand Only'.

    The split is done ONCE, in paise, and then divided. The obvious form —
    `rupees = int(round(amount))` followed by `paise = round((amount - rupees) *
    100)` — rounds the rupees to NEAREST rather than truncating, so any amount
    whose paise part is half a rupee or more rounds the rupees UP and leaves the
    paise NEGATIVE. That produced three separate failures on a field GST
    requires on the face of every tax invoice:

        1234.56   -> IndexError, crashing PDF generation outright
        999.99    -> "Rupees One Thousand and Nineteen Paise Only"
        250000.80 -> "Rupees Two Lakh Fifty Thousand One and  Paise Only"

    Two of those are silent: a wrong amount in words on a document that has the
    right amount in figures, which is exactly the discrepancy the words exist to
    catch. `services/payslip_pdf.py` shares this function, so the same crash
    applied to any net pay ending in 50 paise or more.
    """
    # Negative totals are legitimate on a credit note; divmod on a negative
    # would otherwise borrow and report the complement.
    sign = "Minus " if amount < 0 else ""
    total_paise = int(round(abs(amount) * 100))
    rupees, paise = divmod(total_paise, 100)
    if rupees == 0 and paise == 0:
        return "Rupees Zero Only"

    crore, rem = divmod(rupees, 10_000_000)
    lakh, rem = divmod(rem, 100_000)
    thousand, rem = divmod(rem, 1000)
    hundred = rem

    parts = []
    if crore:
        parts.append(f"{_three_digit_words(crore)} Crore")
    if lakh:
        parts.append(f"{_three_digit_words(lakh)} Lakh")
    if thousand:
        parts.append(f"{_three_digit_words(thousand)} Thousand")
    if hundred:
        parts.append(_three_digit_words(hundred))

    words = sign + ("Rupees " + " ".join(parts) if parts else "Rupees Zero")
    if paise:
        words += f" and {_two_digit_words(paise)} Paise"
    return words + " Only"


def _fmt_addr(addr: dict) -> str:
    if not isinstance(addr, dict):
        return ""
    fields = [addr.get(k, "") for k in ("line1", "line2", "city", "state", "pincode", "country")]
    return ", ".join(f for f in fields if f)


def _fmt_amount(amount, currency: str) -> str:
    """Rupees group 2,2,3 (5,48,652.00), foreign currency groups 3,3,3.

    `18-documents.md` §Numbers requires `toLocaleString('en-IN')` grouping on
    every rupee figure. `f"{n:,.2f}"` is the Western short scale and reads wrong
    on an Indian document — 548,652.00 where 5,48,652.00 belongs.
    """
    sym = _CURRENCY_SYMBOLS.get(currency, currency + " ")
    if currency == "INR":
        return f"{sym}{group_indian(amount)}"
    return f"{sym}{float(amount or 0):,.2f}"


def _embed_logo(logo_url: str) -> str:
    """Fetch the org logo and inline it as a base64 data URI — WeasyPrint runs
    without a browser sandbox, so a bare <img src> to a remote URL is fragile
    (redirects, auth, timeouts all silently blank the header)."""
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
        log.warning("invoice_pdf: logo fetch failed for %s: %s", logo_url, e)
        return ""


# Document types that are a tax document under GST and therefore MUST carry the
# supplier's GSTIN. A quotation or proforma is an offer, not a tax document, and
# is perfectly valid without one.
_GSTIN_REQUIRED_TYPES = {"tax_invoice", "credit_note", "debit_note"}


def _org_gstin_line(org_gstin: str, org_pan: str, invoice_type: str) -> str:
    """The supplier identity line, which must not silently disappear.

    The previous version rendered this line only `if org_gstin or org_pan`, so
    an organisation with neither produced a tax invoice with no supplier GSTIN
    anywhere on it — a document that looks complete and is not. Under GST the
    supplier's GSTIN is mandatory on a tax invoice, credit note and debit note,
    so its absence is a defect in the document, not a formatting question.

    Marked in red rather than filled with a placeholder: an invented number is
    worse than a missing one, and the mark has to be unpleasant enough that
    nobody sends the document without noticing.

    The RECIPIENT's GSTIN is deliberately not treated this way — a B2C sale to
    an unregistered buyer legitimately has none, and flagging it would put a red
    warning on every consumer invoice.
    """
    if org_gstin:
        pan = f' · PAN: {org_pan}' if org_pan else ''
        return f'<div class="pdf__org-line">GSTIN: {org_gstin}{pan}</div>'

    if invoice_type in _GSTIN_REQUIRED_TYPES:
        pan = f' · PAN: {org_pan}' if org_pan else ''
        return (
            '<div class="pdf__org-line">'
            '<span class="pdf__unset">GSTIN NOT SET</span>'
            f'{pan}</div>'
        )

    # Not a tax document: a missing GSTIN is unremarkable, show PAN if present.
    return f'<div class="pdf__org-line">PAN: {org_pan}</div>' if org_pan else ''


def _unset(label: str) -> str:
    """The red, deliberately ugly marker for a field that is absent.

    `18-documents.md`: "an unset field renders a visible red warning, not a
    placeholder ... the red is deliberately ugly because it must never survive
    to a customer."
    """
    return f'<span class="pdf__unset">{html.escape(label)} NOT SET</span>'


def _advisory_note(check: DocumentCheck) -> str:
    """The `.gap-note` strip listing every advisory gap, by name.

    Advisory gaps do not block, but they are never silent — the same honesty
    rule the GSTR-3B working paper applies when it names the invoices it held
    back instead of quietly excluding them.
    """
    if not check.advisory:
        return ""
    items = "".join(f"<li>{html.escape(g.label)} — {html.escape(g.reason)}</li>" for g in check.advisory)
    return (
        '<div class="pdf__gap-note">'
        "<b>Incomplete organisation details.</b> This document is issuable, but "
        "the fields below are not on file and nothing has been invented to fill them."
        f"<ul>{items}</ul></div>"
    )


def _build_html(invoice: dict, org: dict, contact: dict, check: DocumentCheck | None = None) -> str:
    check = check or DocumentCheck(document="invoice")
    is_export = bool(invoice.get("is_export"))
    currency = invoice.get("currency") or "INR"
    line_items = invoice.get("line_items") or []

    org_name = html.escape(org.get("name") or "")
    org_gstin = html.escape(org.get("gstin") or "")
    org_pan = html.escape(org.get("pan") or "")
    org_addr = html.escape(_fmt_addr(org.get("billing_address") or {}))
    org_contact_line = html.escape(" · ".join(
        f for f in [org.get("email", ""), org.get("phone", ""), org.get("website", "")] if f
    ))
    logo_html = _embed_logo(org.get("logo_url") or "")

    contact_name = html.escape(contact.get("name") or "") if contact else ""
    contact_company = html.escape(contact.get("company") or "") if contact else ""
    contact_gstin = html.escape(contact.get("gstin") or "") if contact else ""
    contact_addr = html.escape(_fmt_addr(contact.get("billing_address") or {})) if contact else ""
    contact_email = html.escape(contact.get("email") or "") if contact else ""

    inv_type_labels = {
        "tax_invoice": "Tax Invoice", "proforma": "Proforma Invoice",
        "credit_note": "Credit Note", "debit_note": "Debit Note", "quotation": "Quotation",
    }
    doc_title = "Export Invoice" if is_export else inv_type_labels.get(invoice.get("invoice_type"), "Invoice")

    rows = ""
    for i, li in enumerate(line_items, 1):
        # An em-dash here used to stand in for a missing HSN/SAC, which reads as
        # "no code applies" rather than "the mandatory code is absent". Rule
        # 46(g) requires one per line; on a tax document a missing code now
        # blocks generation outright, so this marker is what a proforma or
        # quotation shows.
        raw_code = li.get("hsn_code") or li.get("sac_code")
        code_cell = html.escape(str(raw_code)) if raw_code else _unset("HSN/SAC")
        rows += f"""
        <tr>
          <td class="mono">{i}</td>
          <td>{html.escape(str(li.get("description", "")))}</td>
          <td class="mono">{code_cell}</td>
          <td class="num">{li.get("quantity", 0)} {html.escape(str(li.get("unit", "")))}</td>
          <td class="num">{_fmt_amount(li.get("rate", 0), currency)}</td>
          {'' if is_export else f'<td class="num">{li.get("gst_rate", 0)}%</td>'}
          <td class="num strong">{_fmt_amount(li.get("line_total", 0), currency)}</td>
        </tr>"""

    if is_export:
        tax_rows = f"""
        <div class="pdf__row"><span>Subtotal</span><span>{_fmt_amount(invoice.get("subtotal"), currency)}</span></div>
        <div class="pdf__row pdf__export-note">SUPPLY MEANT FOR EXPORT UNDER LUT WITHOUT PAYMENT OF INTEGRATED TAX</div>"""
    elif invoice.get("is_igst"):
        tax_rows = f"""
        <div class="pdf__row"><span>Subtotal</span><span>{_fmt_amount(invoice.get("subtotal"), currency)}</span></div>
        <div class="pdf__row"><span>IGST</span><span>{_fmt_amount(invoice.get("igst"), currency)}</span></div>"""
    else:
        tax_rows = f"""
        <div class="pdf__row"><span>Subtotal</span><span>{_fmt_amount(invoice.get("subtotal"), currency)}</span></div>
        <div class="pdf__row"><span>CGST</span><span>{_fmt_amount(invoice.get("cgst"), currency)}</span></div>
        <div class="pdf__row"><span>SGST</span><span>{_fmt_amount(invoice.get("sgst"), currency)}</span></div>"""

    discount_row = ""
    if float(invoice.get("discount") or 0) > 0:
        discount_row = f'<div class="pdf__row" style="color:{_DANGER};"><span>Discount</span><span>-{_fmt_amount(invoice.get("discount"), currency)}</span></div>'

    words_html = ""
    if currency == "INR" and not is_export:
        words_html = f'<div class="pdf__words">{html.escape(amount_in_words_inr(float(invoice.get("total") or 0)))}</div>'

    bank = org.get("bank_details") or {}
    bank_html = ""
    if isinstance(bank, dict) and any(bank.values()):
        bank_rows = "".join(
            f'<div class="pdf__bank-row"><span>{html.escape(label)}</span><span>{html.escape(str(bank.get(key, "")))}</span></div>'
            for label, key in [
                ("Account name", "account_name"), ("Account number", "account_number"),
                ("IFSC", "ifsc"), ("Bank", "bank_name"), ("Branch", "branch"), ("UPI", "upi_id"),
            ] if bank.get(key)
        )
        bank_html = f"""
        <div class="pdf__bank">
          <div class="pdf__bank-h">Payment details</div>
          {bank_rows}
        </div>"""

    footer_note = html.escape(org.get("invoice_note") or "") or "Thank you for your business."
    terms = html.escape(invoice.get("terms") or "")

    # Signature block. `Tax Invoice.html` renders "For {org} / Authorised signatory /
    # {name}, {designation}" followed by the Rule 46 declaration — the sentence that
    # is what makes an unsigned computer-generated invoice valid. Both columns have
    # existed on `organisations` all along and were simply never read, so the whole
    # block was missing from every document the product has ever produced.
    sig_name = html.escape(org.get("authorized_signatory_name") or "")
    sig_role = html.escape(org.get("authorized_signatory_designation") or "")
    sig_line = f"{sig_name}{f', {sig_role}' if sig_role else ''}" if sig_name else ""
    rule46 = (
        "Computer-generated tax invoice · valid without physical signature under "
        "Rule 46 of the CGST Rules, 2017."
    )
    signature_html = f"""
    <div class="pdf__sign">
      <div class="pdf__sign-for">For {org_name}</div>
      {f'<div class="pdf__sign-name">{sig_line}</div>' if sig_line else
       '<div class="pdf__sign-name pdf__unset">Authorised signatory not set</div>'}
      <div class="pdf__sign-label">Authorised signatory</div>
    </div>"""

    body = f"""
<div class="pdf">
  <div class="pdf__head">
    <div class="pdf__brand">
      {logo_html}
      <div>
        <div class="pdf__org-name">{org_name}</div>
        {_org_gstin_line(org_gstin, org_pan, invoice.get("invoice_type") or "")}
        {f'<div class="pdf__org-line">{org_addr}</div>' if org_addr else ''}
        {f'<div class="pdf__org-line">{org_contact_line}</div>' if org_contact_line else ''}
      </div>
    </div>
    <div class="pdf__doc-meta">
      <div class="pdf__doc-title">{doc_title}</div>
      <div class="pdf__meta-row"><span>No.</span><b>{html.escape(invoice.get("invoice_number", ""))}</b></div>
      <div class="pdf__meta-row"><span>Date</span><b>{invoice.get("invoice_date", "")}</b></div>
      {f'<div class="pdf__meta-row"><span>Due</span><b>{invoice.get("due_date", "")}</b></div>' if invoice.get("due_date") else ''}
      {f'<div class="pdf__meta-row"><span>Place of supply</span><b>{html.escape(invoice.get("place_of_supply", ""))}</b></div>' if invoice.get("place_of_supply") and not is_export else ''}
    </div>
  </div>

  <div class="pdf__bill-to">
    <div class="pdf__bill-h">Bill To</div>
    <div class="pdf__bill-name">{contact_name}{f' — {contact_company}' if contact_company else ''}</div>
    {f'<div class="pdf__bill-line">{contact_addr}</div>' if contact_addr else ''}
    {f'<div class="pdf__bill-line">GSTIN: {contact_gstin}</div>' if contact_gstin and not is_export else ''}
    {f'<div class="pdf__bill-line">{contact_email}</div>' if contact_email else ''}
  </div>

  <table class="pdf__table">
    <thead>
      <tr>
        <th style="width:28px;">#</th>
        <th>Description</th>
        <th style="width:70px;">HSN/SAC</th>
        <th class="num" style="width:70px;">Qty</th>
        <th class="num" style="width:90px;">Rate</th>
        {'' if is_export else '<th class="num" style="width:50px;">GST</th>'}
        <th class="num" style="width:100px;">Amount</th>
      </tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>

  <div class="pdf__totals-wrap">
    <div class="pdf__totals">
      {tax_rows}
      {discount_row}
      <div class="pdf__row pdf__row--total"><span>Total</span><span>{_fmt_amount(invoice.get("total"), currency)}</span></div>
      {f'<div class="pdf__row" style="color:{_TEAL};"><span>Paid</span><span>{_fmt_amount(invoice.get("amount_paid"), currency)}</span></div>' if float(invoice.get("amount_paid") or 0) > 0 else ''}
      {f'<div class="pdf__row" style="color:{_DANGER};font-weight:700;"><span>Balance due</span><span>{_fmt_amount(invoice.get("balance_due"), currency)}</span></div>' if float(invoice.get("balance_due") or 0) > 0 else ''}
    </div>
  </div>

  {words_html}

  <div class="pdf__foot-grid">
    {bank_html}
    <div class="pdf__terms">
      {f'<div class="pdf__terms-h">Terms</div><p>{terms}</p>' if terms else ''}
      <p class="pdf__thankyou">{footer_note}</p>
    </div>
    {signature_html}
  </div>

  <div class="pdf__rule46">{rule46}</div>
  {_advisory_note(check)}

  <div class="pdf__colophon">Generated by Kartavaya · {deva_span("कर्तव्य", "Kartavya")} — by Aekam Inc</div>
</div>"""

    css = f"""
{font_face_css()}
*{{ box-sizing:border-box; margin:0; padding:0; }}
body{{ background:{_SURFACE}; font-family:{_FONT_UI}; color:{_INK}; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
@page{{ size:A4; margin:0; }}
.pdf{{ width:210mm; min-height:297mm; background:{_SURFACE}; padding:40px 48px; display:flex; flex-direction:column; gap:18px; }}
.pdf::before{{ content:none; }}

.pdf__head{{ display:flex; justify-content:space-between; gap:24px; padding-bottom:16px; border-bottom:2px solid {_INK}; }}
.pdf__brand{{ display:flex; gap:14px; align-items:flex-start; }}
.pdf__logo{{ width:56px; height:56px; object-fit:contain; }}
.pdf__org-name{{ font-family:{_FONT_DISP}; font-size:20px; font-weight:700; color:{_INK}; }}
.pdf__org-line{{ font-size:10.5px; color:{_INK3}; margin-top:2px; }}
/* Deliberately ugly. A missing supplier GSTIN must never survive to a
   customer, so it is marked rather than omitted — see _gstin_line(). */
.pdf__unset{{ color:#B42318; border-bottom:1px dashed #B42318; font-weight:600; }}
.pdf__doc-meta{{ text-align:right; }}
.pdf__doc-title{{ font-family:{_FONT_DISP}; font-size:22px; font-weight:700; color:{_DEEP}; letter-spacing:-0.01em; margin-bottom:6px; }}
.pdf__meta-row{{ font-size:11px; color:{_INK3}; display:flex; justify-content:flex-end; gap:8px; }}
.pdf__meta-row b{{ color:{_INK}; min-width:90px; text-align:right; }}

.pdf__bill-to{{ background:{_BG_SOFT}; border:1px solid {_RULE}; border-radius:8px; padding:12px 16px; }}
.pdf__bill-h{{ font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:{_INK3}; font-weight:700; margin-bottom:4px; }}
.pdf__bill-name{{ font-size:14px; font-weight:700; color:{_INK}; }}
.pdf__bill-line{{ font-size:11px; color:{_INK2}; margin-top:2px; }}

.pdf__table{{ width:100%; border-collapse:collapse; font-size:11.5px; }}
.pdf__table th{{ text-align:left; font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:#fff; background:{_INK}; font-weight:700; padding:8px 8px; }}
.pdf__table th.num{{ text-align:right; }}
.pdf__table td{{ padding:8px; border-bottom:1px solid {_RULE_SOFT}; vertical-align:top; }}
.pdf__table td.num{{ text-align:right; }}
.pdf__table td.mono{{ font-family:{_FONT_MONO}; font-size:10.5px; color:{_INK3}; }}
.pdf__table td.strong{{ font-weight:700; }}

.pdf__totals-wrap{{ display:flex; justify-content:flex-end; }}
.pdf__totals{{ width:260px; }}
.pdf__row{{ display:flex; justify-content:space-between; font-size:12px; padding:4px 0; color:{_INK2}; }}
.pdf__row--total{{ border-top:2px solid {_INK}; margin-top:4px; padding-top:8px; font-size:15px; font-weight:700; color:{_INK}; }}
.pdf__export-note{{ font-size:9.5px; color:{_DEEP}; font-weight:700; text-align:right; letter-spacing:0.02em; }}

.pdf__words{{ font-size:11px; font-style:italic; color:{_INK2}; border-top:1px dashed {_RULE}; padding-top:10px; }}

.pdf__foot-grid{{ display:grid; grid-template-columns:1fr 1fr auto; gap:20px; margin-top:auto; padding-top:14px; }}
.pdf__sign{{ text-align:right; display:flex; flex-direction:column; justify-content:flex-end; min-width:150px; }}
.pdf__sign-for{{ font-size:10.5px; color:{_INK2}; }}
.pdf__sign-name{{ font-family:{_FONT_DISP}; font-size:12px; font-weight:600; color:{_INK}; margin-top:34px; }}
.pdf__sign-label{{ font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:{_INK3}; font-weight:700; border-top:1px solid {_RULE}; padding-top:4px; margin-top:3px; }}
.pdf__rule46{{ font-size:8.5px; color:{_INK3}; text-align:center; padding-top:10px; }}
.pdf__bank-h, .pdf__terms-h{{ font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:{_INK3}; font-weight:700; margin-bottom:6px; }}
.pdf__bank-row{{ display:flex; justify-content:space-between; font-size:11px; color:{_INK2}; padding:2px 0; max-width:280px; }}
.pdf__bank-row span:first-child{{ color:{_INK3}; }}
.pdf__terms p{{ font-size:10.5px; color:{_INK3}; line-height:1.5; }}
.pdf__thankyou{{ margin-top:8px; font-style:italic; }}

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


def generate_invoice_pdf(invoice: dict, org: dict, contact: dict = None) -> bytes:
    """Render an invoice to a PDF byte string via WeasyPrint.

    Raises `services.doc_validation.DocumentIncomplete` — before WeasyPrint is
    even imported — when the document is missing a mandatory particular. The
    check runs here rather than in the router so that every caller is covered,
    not only the download endpoint.
    """
    invoice, org, contact = invoice or {}, org or {}, contact or {}
    check = validate_tax_invoice(invoice, org, contact)
    check.raise_if_incomplete()

    try:
        from weasyprint import HTML
    except (ImportError, OSError) as e:
        # OSError, not just ImportError: WeasyPrint imports fine and then fails
        # to dlopen libgobject/libpango, which is what a machine or image
        # without the native stack actually does. Catching only ImportError let
        # that surface as a raw OSError and a 500 with a stack trace.
        raise RuntimeError("WeasyPrint is not available on this server") from e
    html_str = _build_html(invoice, org, contact, check)
    return HTML(string=html_str, base_url=None).write_pdf()
