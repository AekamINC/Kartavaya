"""invoice_pdf.py — PDF (WeasyPrint) generation for Ganit invoices.

Two letterhead variants sharing one layout:
  - GST Tax Invoice (default) — CGST/SGST or IGST breakdown, HSN/SAC codes,
    amount in words (Indian lakh/crore grouping).
  - Export Invoice (invoice["is_export"]) — zero-rated declaration in place
    of the GST breakdown, foreign currency, no amount-in-words (recipient's
    numbering convention is unknown).
"""
import base64
import html
import logging

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

_FONT_DISP = 'Georgia, "Times New Roman", serif'
_FONT_UI   = '"Helvetica Neue", Arial, sans-serif'
_FONT_MONO = '"Courier New", monospace'

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
    """Indian numbering (lakh/crore) amount-in-words, e.g. 'Rupees Two Lakh Thirty Four Thousand Only'."""
    rupees = int(round(amount))
    paise = int(round((amount - rupees) * 100))
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

    words = "Rupees " + " ".join(parts) if parts else "Rupees Zero"
    if paise:
        words += f" and {_two_digit_words(paise)} Paise"
    return words + " Only"


def _fmt_addr(addr: dict) -> str:
    if not isinstance(addr, dict):
        return ""
    fields = [addr.get(k, "") for k in ("line1", "line2", "city", "state", "pincode", "country")]
    return ", ".join(f for f in fields if f)


def _fmt_amount(amount, currency: str) -> str:
    sym = _CURRENCY_SYMBOLS.get(currency, currency + " ")
    if currency == "INR":
        return f"{sym}{float(amount or 0):,.2f}"
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


def _build_html(invoice: dict, org: dict, contact: dict) -> str:
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
        code = li.get("hsn_code") or li.get("sac_code") or "—"
        rows += f"""
        <tr>
          <td class="mono">{i}</td>
          <td>{html.escape(str(li.get("description", "")))}</td>
          <td class="mono">{html.escape(str(code))}</td>
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
  </div>

  <div class="pdf__colophon">Generated by Kartavaya · कर्तव्य — by Aekam Inc</div>
</div>"""

    css = f"""
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

.pdf__foot-grid{{ display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:auto; padding-top:14px; }}
.pdf__bank-h, .pdf__terms-h{{ font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:{_INK3}; font-weight:700; margin-bottom:6px; }}
.pdf__bank-row{{ display:flex; justify-content:space-between; font-size:11px; color:{_INK2}; padding:2px 0; max-width:280px; }}
.pdf__bank-row span:first-child{{ color:{_INK3}; }}
.pdf__terms p{{ font-size:10.5px; color:{_INK3}; line-height:1.5; }}
.pdf__thankyou{{ margin-top:8px; font-style:italic; }}

.pdf__colophon{{ text-align:center; font-size:9px; color:{_INK3}; border-top:1px solid {_RULE_SOFT}; padding-top:10px; }}
"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>{css}</style></head>
<body>{body}</body>
</html>"""


def generate_invoice_pdf(invoice: dict, org: dict, contact: dict = None) -> bytes:
    """Render an invoice to a PDF byte string via WeasyPrint."""
    try:
        from weasyprint import HTML
    except ImportError as e:
        raise RuntimeError("WeasyPrint is not available on this server") from e
    html_str = _build_html(invoice, org or {}, contact or {})
    return HTML(string=html_str, base_url=None).write_pdf()
