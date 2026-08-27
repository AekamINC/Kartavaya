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

One brand layer, not two
------------------------
This module used to carry its OWN stylesheet — its own palette, its own type
scale, its own `.pdf__*` class vocabulary — while the six documents built later
share `services/doc_render.py` (brand.css plus the `<doc-page>` translation).
The result was that a firm sending a client an invoice and a statement in the
same email sent two visibly different documents. That was the largest remaining
conformance gap in the set, and it is closed here: every rule this document is
painted with now comes from `doc_render`, and nothing about the document's
CONTENT changed with it.

Two behaviours that look cosmetic are load-bearing and are preserved verbatim:

  * `_org_gstin_line` still decides whether a missing supplier GSTIN is marked,
    because that turns on whether the document is a tax document. `doc_render`
    marks by default and takes this line as an override — see its `gstin_html`
    argument, which exists for exactly this one case.
  * The palette is `doc_render`'s, which is brand.css's. The retired brand blue
    `#0082c6` is not reintroduced by the move; the accent is the documented
    Kartavaya teal fallback, as before.
"""
import logging

from services import doc_render as R
from services.doc_fonts import group_indian
from services.doc_validation import DocumentCheck, validate_tax_invoice

# The palette, the type scale and the page geometry all live in
# `services/doc_render.py` now — it resolves brand.css's `--doc-*` tokens once,
# for every document in the set. The near-miss values this file used to carry
# (--doc-ink as #1A2230 against a specified #14171A, --doc-rule #E2DCC9 against
# #D9D5CA) and the retired brand blue #0082c6 are gone with it, and cannot drift
# back in independently of the other seven documents.

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
    """One line, comma separated, in `doc_render.ADDRESS_ORDER`.

    The order was a literal here and a DIFFERENT literal in
    `doc_render.fmt_addr` — `city, state, pincode` against `city, pincode,
    state` — so the same client's address read one way on its tax invoice and
    the other on the letterhead of the agreement attached to it. It is now the
    one tuple, and `tests/test_address_order.py` fails if either renderer
    reintroduces a literal. The reasoning for which order won is on the tuple.

    The one-line join stays this renderer's own: this string lands in a `<td>`
    in the party block, where `fmt_addr`'s `<br>` would break the row height.
    """
    return ", ".join(R.addr_parts(addr))


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


# `_embed_logo` is now `doc_render.embed_logo`, which applies the same policy
# (inline as a data URI, degrade to the initial mark on failure) plus a size cap.

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

    This is now the `.lh__ids` line of `doc_render.letterhead`, passed in as
    `ids_html`. The MARKUP is brand.css's — `GSTIN <b>…</b> · PAN <b>…</b>`,
    with `.unset` for the absent case — and the DECISION about when to mark is
    still this function's, because it is a statutory one.
    """
    if org_gstin:
        pan = f' &middot; PAN <b>{org_pan}</b>' if org_pan else ''
        return f'GSTIN <b>{org_gstin}</b>{pan}'

    # ── No GSTIN: say nothing on the document ────────────────────────────────
    # Owner's ruling 2026-08-03: "no advisory on invoice pdf ... i want invoice
    # to be clean." A supplier below the registration threshold has no GSTIN
    # legitimately, so an absent one is not a defect to shout about on a
    # document a customer reads — printing "⚠ GSTIN NOT SET" on their invoice
    # advertises a gap that is frequently not a gap at all.
    #
    # It is still REPORTED, just not here: `validate_tax_invoice` returns it as
    # an advisory and `GET /invoices/{id}` hands that to the drawer, so staff
    # see it internally before the document ever goes out. The line simply
    # omits what does not exist rather than inventing or flagging it.
    return f'PAN <b>{org_pan}</b>' if org_pan else ''


# ── On the red `.unset` marker, removed 2026-08-03 ──────────────────────────
#
# `18-documents.md` specified a red "⚠ FIELD NOT SET" marker for absent fields,
# on the reasoning that "the red is deliberately ugly because it must never
# survive to a customer". The owner's ruling replaces that: the invoice stays
# clean, and the gaps are shown INTERNALLY in the invoice drawer instead.
#
# The two remaining `R.unset(...)` calls below are for invoice DATE and
# RECIPIENT, which are BLOCKING gaps — `validate_tax_invoice` refuses to
# generate at all when either is absent, so neither can reach a document. They
# stay as a defensive net for a bypassed check, not as a customer-facing mark.


def _build_html(invoice: dict, org: dict, contact: dict, check: DocumentCheck | None = None) -> str:
    check = check or DocumentCheck(document="invoice")
    invoice, org, contact = invoice or {}, org or {}, contact or {}
    is_export = bool(invoice.get("is_export"))
    currency = invoice.get("currency") or "INR"
    line_items = invoice.get("line_items") or []

    inv_type = invoice.get("invoice_type") or ""
    inv_type_labels = {
        "tax_invoice": "Tax Invoice", "proforma": "Proforma Invoice",
        "credit_note": "Credit Note", "debit_note": "Debit Note", "quotation": "Quotation",
    }
    doc_title = "Export Invoice" if is_export else inv_type_labels.get(inv_type, "Invoice")

    # ── letterhead ───────────────────────────────────────────────────────────
    # `.lh__kind-hi` (the design sets a Devanagari kind beside "Tax Invoice")
    # is deliberately NOT added here. This change is the brand LAYER, not a
    # redesign, and a Devanagari kind would be new content on the face of the
    # document. Recorded in the report as a remaining conformance gap.
    head = R.letterhead(
        org,
        kind_en=doc_title,
        kind_hi="",
        doc_no=invoice.get("invoice_number") or "",
        ids_html=_org_gstin_line(
            R.esc(org.get("gstin") or ""), R.esc(org.get("pan") or ""), inv_type
        ),
    )

    # ── meta strip ───────────────────────────────────────────────────────────
    # Place of supply is omitted on an export: the concept does not apply, and
    # printing it would be wrong rather than merely redundant.
    # `R.date_label` for the same reason `R.money` groups 2,2,3: this is the
    # document the client actually receives, and it was the only one in the set
    # printing the database's `2026-07-08` where the quotation, statement,
    # agreement and project report all print `08 Jul 2026`. A value that does
    # not parse as a date is passed through unchanged, so a caller storing
    # anything other than an ISO date still gets it on the page.
    meta_cells = [
        ("Invoice date",
         R.esc(R.date_label(invoice.get("invoice_date") or "")) or R.unset("Invoice date")),
        ("Due date", R.esc(R.date_label(invoice.get("due_date") or "")) or "&mdash;"),
    ]
    if is_export:
        meta_cells.append(("Currency", R.esc(currency)))
    else:
        meta_cells.append((
            "Place of supply",
            R.esc(invoice.get("place_of_supply") or "") or "&mdash;",
        ))
    meta = R.meta_strip(meta_cells)

    # ── parties ──────────────────────────────────────────────────────────────
    billed_name = R.esc(contact.get("name") or "")
    if contact.get("company"):
        billed_name = f'{billed_name} &mdash; {R.esc(contact["company"])}' if billed_name \
            else R.esc(contact["company"])
    id_bits = []
    # The recipient's GSTIN is never marked when absent — a B2C sale to an
    # unregistered buyer legitimately has none. It is simply not shown, and it
    # is not shown at all on an export.
    if contact.get("gstin") and not is_export:
        id_bits.append(f'GSTIN {R.esc(contact["gstin"])}')
    if contact.get("email"):
        id_bits.append(R.esc(contact["email"]))

    party_block = R.parties(
        R.party(
            "Billed to",
            name=billed_name or R.unset("Recipient"),
            addr_html=R.fmt_addr(contact.get("billing_address") or {}),
            id_html=" &middot; ".join(id_bits),
        ),
        "",
    )

    # ── lines ────────────────────────────────────────────────────────────────
    rows = []
    for i, li in enumerate(line_items, 1):
        li = li or {}
        # Rule 46(g) requires an HSN or SAC per line, and on a TAX document a
        # missing code blocks generation outright in `validate_tax_invoice` —
        # so this cell is only ever reached by a proforma or quotation, which
        # is an offer and needs no code. Blank, not a red marker: owner's
        # ruling 2026-08-03 that the document stays clean, and a quotation was
        # the one document that could legitimately carry the warning to a
        # customer.
        raw_code = li.get("hsn_code") or li.get("sac_code")
        code_cell = R.esc(str(raw_code)) if raw_code else ""
        qty = f'{li.get("quantity", 0)} {R.esc(str(li.get("unit") or ""))}'.strip()
        gst_cell = "" if is_export else f'<td class="num">{R.esc(li.get("gst_rate", 0))}%</td>'
        rows.append(
            f'<tr><td class="num num--left">{i}</td>'
            f'<td>{R.cell_desc(str(li.get("description", "")))}</td>'
            f'<td class="num">{code_cell}</td>'
            f'<td class="num">{qty}</td>'
            f'<td class="num">{_fmt_amount(li.get("rate", 0), currency)}</td>'
            f'{gst_cell}'
            f'<td class="num">{_fmt_amount(li.get("line_total", 0), currency)}</td></tr>'
        )
    if not rows:
        colspan = 6 if is_export else 7
        rows.append(f'<tr><td colspan="{colspan}" class="lines__mute">No lines on this document.</td></tr>')

    headers = [("#", "", "26px"), ("Description", "", ""), ("HSN/SAC", "num", "62px"),
               ("Qty", "num", "48px"), ("Rate", "num", "78px")]
    if not is_export:
        headers.append(("GST", "num", "48px"))
    headers.append(("Amount", "num", "88px"))
    lines_table = R.table(headers, rows)

    # ── totals ───────────────────────────────────────────────────────────────
    total_rows = [("Subtotal", _fmt_amount(invoice.get("subtotal"), currency))]
    if is_export:
        pass  # the zero-rated declaration replaces the tax breakdown, below
    elif invoice.get("is_igst"):
        total_rows.append(("IGST", _fmt_amount(invoice.get("igst"), currency)))
    else:
        total_rows.append(("CGST", _fmt_amount(invoice.get("cgst"), currency)))
        total_rows.append(("SGST", _fmt_amount(invoice.get("sgst"), currency)))
    if float(invoice.get("discount") or 0) > 0:
        total_rows.append(("Discount", f'&minus;{_fmt_amount(invoice.get("discount"), currency)}'))

    # The grand row is what is actually OWED, which is the balance whenever one
    # is recorded. `.totals__row--grand` is the one figure a reader looks for,
    # so it must not be a number they no longer have to pay. Total and Paid
    # stay as ordinary rows above it, which is the order this document has
    # always printed them in.
    paid = float(invoice.get("amount_paid") or 0)
    balance = float(invoice.get("balance_due") or 0)
    if paid > 0 or balance > 0:
        total_rows.append(("Total", _fmt_amount(invoice.get("total"), currency)))
    if paid > 0:
        total_rows.append(("Paid", f'&minus;{_fmt_amount(invoice.get("amount_paid"), currency)}'))
    grand = ("Balance due", _fmt_amount(invoice.get("balance_due"), currency)) if balance > 0 \
        else ("Total", _fmt_amount(invoice.get("total"), currency))
    totals_html = R.totals(total_rows, grand=grand)

    export_note = ""
    if is_export:
        export_note = R.words_line(
            "SUPPLY MEANT FOR EXPORT UNDER LUT WITHOUT PAYMENT OF INTEGRATED TAX"
        )

    # No amount in words for an export: the recipient's numbering convention is
    # unknown, so a lakh/crore rendering would be worse than none.
    words_html = ""
    if currency == "INR" and not is_export:
        words_html = R.words_line(
            f'Amount in words &mdash; <b>{R.esc(amount_in_words_inr(float(invoice.get("total") or 0)))}</b>'
        )

    # ── bank, terms, signature ───────────────────────────────────────────────
    bank = org.get("bank_details") or {}
    bank_html = ""
    if isinstance(bank, dict) and any(bank.values()):
        bank_lines = "<br>".join(
            f'{R.esc(label)} <span class="num num--left">{R.esc(bank.get(key))}</span>'
            for label, key in [
                ("Account name", "account_name"), ("Account number", "account_number"),
                ("IFSC", "ifsc"), ("Bank", "bank_name"), ("Branch", "branch"), ("UPI", "upi_id"),
            ] if bank.get(key)
        )
        bank_html = R.block(
            "Payment details",
            f'<div class="party__a">{bank_lines}</div>',
            top="0" if not bank_html else "12px",
        )

    note_items = []
    if invoice.get("terms"):
        note_items.append(R.esc(invoice["terms"]))
    note_items.append(R.esc(org.get("invoice_note") or "") or "Thank you for your business.")
    terms_html = R.block("Terms", R.terms_list(note_items), top="12px" if bank_html else "0")

    sign = R.sign_block(
        f'For {R.esc(org.get("name") or "")}'.strip() if org.get("name") else "Authorised signatory",
        org.get("authorized_signatory_name") or "",
        org.get("authorized_signatory_designation") or "",
    )

    page = "".join([
        head, meta, party_block, lines_table,
        totals_html, export_note, words_html,
        R.parties(bank_html + terms_html, sign, flush=True),
        R.gap_note(check),
        R.foot(
            "Computer-generated tax invoice &middot; valid without physical "
            "signature under Rule 46 of the CGST Rules, 2017."
        ),
    ])
    return R.document(
        [page], org, title=f"{doc_title} — Kartavaya",
        running=R.running_id(doc_title, org, invoice.get("invoice_number") or ""),
    )


def generate_invoice_pdf(
    invoice: dict, org: dict, contact: dict = None,
    compliance_states: dict = None,
) -> bytes:
    """Render an invoice to a PDF byte string via WeasyPrint.

    Raises `services.doc_validation.DocumentIncomplete` — before WeasyPrint is
    even imported — when the document is missing a mandatory particular. The
    check runs here rather than in the router so that every caller is covered,
    not only the download endpoint.

    `compliance_states` is the org's resolved `ganit` compliance settings
    (`services/compliance_settings.py::resolve_states`) — optional, and
    unchanged (GSTIN/HSN gaps always advisory) for any caller that omits it,
    which today is `recurring_invoice_generator.py` and
    `scripts/render_documents.py`. `routers/ganit.py`'s download route
    resolves and passes it.
    """
    invoice, org, contact = invoice or {}, org or {}, contact or {}
    check = validate_tax_invoice(invoice, org, contact, compliance_states=compliance_states)
    check.raise_if_incomplete()
    # `doc_render.render_pdf` is the single PDF path for the whole set. It
    # catches OSError as well as ImportError, because WeasyPrint imports fine
    # and then fails to dlopen libgobject/libpango on an image without the
    # native stack — catching only ImportError let that surface as a 500 with a
    # stack trace.
    return R.render_pdf(_build_html(invoice, org, contact, check))
