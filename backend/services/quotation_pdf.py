"""quotation_pdf.py — the quotation.

Specification: `design-reference/Kartavaya Redesign/docs/Quotation.html`.
Pipeline, fonts and refusal semantics as `invoice_pdf.py`.

Why this exists separately from `invoice_pdf.py`
------------------------------------------------
It did not. A quotation rendered through the invoice template with the string
"Quotation" swapped into the title, which produced a tax invoice wearing another
name: a `Bill To` block where the design has `Prepared for` and a `Scope
summary`; an HSN/SAC column that no offer needs and that the invoice marks in
red when absent; no validity date, no payment schedule, no numbered terms, and
an `Authorised signatory` block where the design has an ACCEPTANCE block for the
client to counter-sign.

That last one is the substantive difference. A quotation is an offer capable of
acceptance, and the design's signature block belongs to the offeree, not the
offeror. Rendering the offeror's signature there inverts who is agreeing to
what.

What is deliberately NOT here
-----------------------------
No GSTIN blocker, no HSN blocker, no place-of-supply blocker. `doc_validation`
already reserves those for tax documents — "a quotation or proforma is an offer,
not a tax document" — and the reservation is preserved rather than re-argued.
The quotation still shows the supplier's GSTIN in the letterhead when there is
one, because a client comparing offers wants it.
"""

from __future__ import annotations

from datetime import date, datetime

from services import doc_render as R
from services.doc_validation import DocumentCheck, validate_quotation
from services.invoice_pdf import amount_in_words_inr

_CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED ", "SGD": "S$"}

#: The terms the specification prints when the quotation carries none of its
#: own. Each is a term the design states verbatim; the validity sentence takes
#: the document's real validity window rather than a fixed number of days.
_DEFAULT_TERMS = (
    "Rates are exclusive of statutory filing fees and government portal charges.",
    "Engagement begins on written acceptance or signature below.",
)


def _date_label(value) -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime("%d %b %Y")
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").strftime("%d %b %Y")
    except (ValueError, TypeError):
        return str(value or "")


def _as_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def validity_days(quote: dict) -> int | None:
    """How long the offer stays open, from its own two dates."""
    start, end = _as_date(quote.get("quote_date")), _as_date(quote.get("valid_until"))
    return (end - start).days if start and end else None


def compute(quote: dict) -> dict:
    """Subtotal, discount, taxable value, tax and total, from the lines.

    Recomputed rather than trusted: a quotation is capable of acceptance, so a
    total that does not follow from the lines is a contract for a figure nobody
    agreed to.
    """
    quote = quote or {}
    lines = quote.get("line_items") or []
    subtotal = sum(_num(li.get("line_total")) for li in lines)
    discount = _num(quote.get("discount"))
    taxable = subtotal - discount
    igst, cgst, sgst = _num(quote.get("igst")), _num(quote.get("cgst")), _num(quote.get("sgst"))
    tax = igst + cgst + sgst
    return {
        "lines": lines,
        "subtotal": subtotal,
        "discount": discount,
        "discount_pct": (discount / subtotal * 100) if subtotal else 0.0,
        "taxable": taxable,
        "igst": igst, "cgst": cgst, "sgst": sgst,
        "tax": tax,
        "total": taxable + tax,
    }


def _build_html(quote: dict, org: dict, contact: dict, check: DocumentCheck | None = None) -> str:
    quote, org, contact = quote or {}, org or {}, contact or {}
    check = check or DocumentCheck(document="quotation")
    c = compute(quote)

    currency = quote.get("currency") or "INR"
    symbol = _CURRENCY_SYMBOLS.get(currency, currency + " ")

    valid_until = quote.get("valid_until")
    expired = False
    vu = _as_date(valid_until)
    if vu:
        expired = vu < date.today()

    head = R.letterhead(
        org,
        kind_en="Quotation",
        kind_hi="प्रस्ताव",
        doc_no=R.esc(quote.get("quote_number") or ""),
        chip_html=(
            R.chip("Expired", "over") if expired
            else R.chip(f"Valid till {_date_label(valid_until)}", "due") if vu
            else ""
        ),
    )

    meta = R.meta_strip([
        ("Quote date", R.esc(_date_label(quote.get("quote_date"))) or R.unset("Quote date")),
        ("Valid until", R.esc(_date_label(valid_until)) if vu else R.unset("Valid until")),
        ("Prepared by", R.esc(quote.get("prepared_by") or "") or R.unset("Prepared by")),
        ("Reference", R.esc(quote.get("reference") or "—")),
    ], mono_labels=("Reference",))

    # `Prepared for` + `Scope summary` — the design's parties block. Note this
    # is NOT the invoice's `Bill To`: an offer is prepared for a person, and the
    # right-hand column carries what is being offered rather than an address.
    attn_bits = []
    if contact.get("gstin"):
        attn_bits.append(f"GSTIN {R.esc(contact['gstin'])}")
    if contact.get("name") and contact.get("company"):
        attn = R.esc(contact["name"])
        if contact.get("designation"):
            attn += f", {R.esc(contact['designation'])}"
        attn_bits.append(f"Attn {attn}")

    party_block = R.parties(
        R.party(
            "Prepared for",
            name=R.esc(contact.get("company") or contact.get("name")) or R.unset("Recipient"),
            addr_html=R.fmt_addr(contact.get("billing_address") or {}),
            id_html=" &middot; ".join(attn_bits),
        ),
        R.party(
            "Scope summary",
            body_html=R.esc(quote.get("scope_summary") or "") or (
                '<span class="lines__mute">No scope summary recorded.</span>'
            ),
        ),
    )

    # ── lines ────────────────────────────────────────────────────────────────
    rows = []
    for i, li in enumerate(c["lines"], 1):
        qty = f'{li.get("quantity", "")} {R.esc(li.get("unit") or "")}'.strip()
        rows.append(
            f'<tr><td class="num num--left">{i}</td>'
            f'<td>{R.cell_desc(li.get("description") or "", li.get("sub") or "")}</td>'
            f'<td class="num">{R.esc(qty)}</td>'
            f'<td class="num">{R.esc(R.group_indian(li.get("rate"), 0))}</td>'
            f'<td class="num">{R.esc(R.group_indian(li.get("line_total"), 0))}</td></tr>'
        )
    if not rows:
        rows.append('<tr><td colspan="5" class="lines__mute">No lines quoted.</td></tr>')
    lines_table = R.table(
        [("#", "", "26px"), ("Line", "", ""), ("Qty", "num", "52px"),
         ("Rate", "num", "88px"), ("Amount", "num", "92px")],
        rows,
    )

    # ── totals ───────────────────────────────────────────────────────────────
    total_rows = [("Subtotal", R.money0(c["subtotal"], symbol))]
    if c["discount"] > 0:
        total_rows.append((
            f"Discount ({c['discount_pct']:.1f}%)",
            f"&minus;{R.money0(c['discount'], symbol)}",
        ))
        total_rows.append(("Taxable value", R.money0(c["taxable"], symbol)))
    gst_rate = quote.get("gst_rate")
    rate_txt = f" @ {gst_rate}%" if gst_rate else ""
    if c["igst"] > 0:
        total_rows.append((
            f"IGST{rate_txt} (inter-state)", R.money0(c["igst"], symbol)))
    if c["cgst"] > 0 or c["sgst"] > 0:
        half = f" @ {float(gst_rate) / 2:g}%" if gst_rate else ""
        total_rows.append((f"CGST{half}", R.money0(c["cgst"], symbol)))
        total_rows.append((f"SGST{half}", R.money0(c["sgst"], symbol)))
    totals_html = R.totals(total_rows, grand=("Total", R.money0(c["total"], symbol)))

    words = ""
    if currency == "INR":
        words = R.words_line(
            f"Amount in words — <b>{R.esc(amount_in_words_inr(c['total']))}</b>"
        )

    # ── payment schedule ─────────────────────────────────────────────────────
    schedule = quote.get("payment_schedule") or []
    schedule_html = ""
    if schedule:
        cells = "".join(
            f"<div><b>{R.esc(s.get('label') or '')}</b><br>"
            f'<span style="color:{R.INK3}">{R.money0(s.get("amount"), symbol)}'
            + (f" &middot; {R.esc(s.get('due'))}" if s.get("due") else "")
            + "</span></div>"
            for s in schedule
        )
        schedule_html = (
            '<div class="panel"><div class="block__l block__l--accent">Payment schedule</div>'
            f'<div class="row" style="margin-top:6px;font-size:8.5pt">{cells}</div></div>'
        )

    # ── terms + acceptance ───────────────────────────────────────────────────
    terms = list(quote.get("terms") or [])
    if not terms:
        days = validity_days(quote)
        terms = ([f"This quotation is valid for {days} days from the date of issue."]
                 if days and days > 0 else []) + list(_DEFAULT_TERMS)
    terms_block = R.block("Terms", R.terms_list([R.esc(t) for t in terms], ordered=True), top="0")

    # The acceptance block belongs to the CLIENT. See the module docstring.
    accept_for = R.esc(contact.get("company") or contact.get("name") or "the client")
    accept_who = " &middot; ".join(filter(None, [
        f"<b>{R.esc(contact['name'])}</b>" if contact.get("name") else "",
        R.esc(contact.get("designation") or ""),
    ]))
    acceptance = (
        f'<div class="sign"><div class="block__l">Accepted for {accept_for}</div>'
        f'<div class="sign__line">Signature &amp; date<br>'
        f'<span class="sign__who">{accept_who or "&nbsp;"}</span></div></div>'
    )

    page = "".join([
        head, meta, party_block, lines_table, totals_html, words, schedule_html,
        f'<div style="display:flex;gap:24px;margin-top:14px">'
        f'<div style="flex:1.4 1 0">{terms_block}</div>'
        f'<div style="flex:1 1 0">{acceptance}</div></div>',
        R.gap_note(check),
        R.foot(
            "Sign electronically from the client portal — no printing required. "
            "Accepting this quote creates the engagement and its first invoice."
        ),
    ])
    return R.document([page], org, title="Quotation — Kartavaya")


def generate_quotation_pdf(quote: dict, org: dict, contact: dict = None) -> bytes:
    """Render a quotation to PDF bytes.

    Raises `DocumentIncomplete` when the offer cannot be accepted as it stands —
    no number, no date, no lines, or totals that do not follow from the lines.
    """
    quote, org, contact = quote or {}, org or {}, contact or {}
    computed = compute(quote)
    # Validate against the subtotal that will be PRINTED, for the same reason
    # `statement_pdf` does: a caller must not be able to satisfy the check with
    # a figure the document never shows.
    check = validate_quotation({**quote, "subtotal": computed["subtotal"]}, org, contact)
    check.raise_if_incomplete()
    return R.render_pdf(_build_html(quote, org, contact, check))
