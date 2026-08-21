"""
invoice_email.py — the invoice, as an email: the PDF attached and the pay link
in the body.

P5. The third of the four send options, and the one that matters most for a
customer who does not use WhatsApp for business.

── Both halves, deliberately ────────────────────────────────────────────────

The ATTACHMENT is the document. It is what an accounts department files, what
their auditor asks for, and what they will not accept a link in place of.

The LINK is how it gets paid. A PDF cannot be tapped; a customer holding only a
PDF has to open it, read a UPI ID off it and type that into an app by hand, and
every one of those steps is somewhere the payment stops.

Sending one without the other loses half the point, which is why this is one
message and not a choice between two.

── The link is built here, not passed in ───────────────────────────────────

`routers/pay.py` refuses anything that is not final/sent/viewed and anything
already settled. Deciding that in the caller would be a fourth copy of the rule
— `fields.py` was a fourth copy of the project-access rule and it cost a day —
so an unshareable invoice simply gets no link and the mail still carries the
document.
"""
from html import escape as _h

from email_service import (
    PAY_URL, _INK3, _base, _body_text, _cta_row, _info_card, _safe_subject,
)

#: The states `routers/pay.py` will serve. Kept beside the link builder so the
#: two cannot drift into offering a URL that answers 404.
_SHAREABLE_DOC = ("final", "sent", "viewed")
_SHAREABLE_PAY = ("unpaid", "partial")


def pay_link(invoice: dict) -> str | None:
    """The public URL for this invoice, or None when it must not be shared."""
    token = (invoice.get("pay_token") or "").strip()
    if not token:
        return None
    if (invoice.get("doc_status") or "") not in _SHAREABLE_DOC:
        return None
    if (invoice.get("payment_status") or "") not in _SHAREABLE_PAY:
        return None
    # `pay.kartavaya.com` now resolves and serves this route, so the invoice
    # link goes to the invoice host rather than to the app. The recipient is the
    # customer's customer: they have no account here, and a link into the app
    # asks them to make sense of a product they are not a user of.
    return f"{PAY_URL}/i/{token}"


def _money(v) -> str:
    try:
        return f"₹{float(v):,.2f}"
    except (TypeError, ValueError):
        return "—"


def send_invoice_email(
    *,
    to_email: str,
    contact_name: str,
    invoice: dict,
    org_name: str,
    pdf_bytes: bytes,
) -> bool:
    """Send it. Returns whether a message was handed off at all.

    False means there was no address to send to — the caller turns that into a
    refusal the user can act on, rather than a success toast over nothing.
    """
    if not (to_email or "").strip():
        return False

    number = str(invoice.get("invoice_number") or "")
    kind = (invoice.get("invoice_type") or "invoice").replace("_", " ").title()
    due = invoice.get("balance_due")
    if due is None or float(due or 0) <= 0:
        due = invoice.get("total")
    link = pay_link(invoice)

    rows = [("Invoice", number), ("Amount due", _money(due))]
    if invoice.get("invoice_date"):
        rows.append(("Date", str(invoice["invoice_date"])))
    if invoice.get("due_date"):
        rows.append(("Payable by", str(invoice["due_date"])))

    body = _info_card(rows)
    body += _body_text(
        f'<span style="font-size:13px;color:{_INK3};">'
        f'The {_h(kind.lower())} is attached to this email as a PDF.</span>'
    )
    if link:
        body += _cta_row(link, "View and pay online")
        # Written out as well as linked. A button is invisible to a client that
        # blocks remote content, and this one is the only route to paying.
        body += _body_text(
            f'<span style="font-size:12.5px;color:{_INK3};">'
            f'Or open this link: {_h(link)}</span>'
        )
        # There is no gateway and no callback, so a receipt does not appear by
        # itself. Saying so here costs one line and saves the "I paid, why does
        # it still say unpaid" exchange.
        body += _body_text(
            f'<span style="font-size:12.5px;color:{_INK3};">'
            'Payments are confirmed against our bank statement, so the status '
            'may take a day to update after you pay.</span>'
        )

    html = _base(
        preheader=f"{kind} {number} from {org_name} — {_money(due)}",
        kicker="INVOICE · बीजक",
        headline=f"{kind} {number}",
        sanskrit="बीजक",
        lede=(f"Hi {_h(contact_name or 'there')}, here is your {_h(kind.lower())} "
              f"from {_h(org_name)}."),
        body_rows=body,
    )

    from services.pdf_email import send_pdf_email
    send_pdf_email(
        to_email=to_email.strip(),
        subject=_safe_subject(f"{kind} {number} from {org_name}"),
        html_content=html,
        pdf_bytes=pdf_bytes,
        filename=f"{number or 'invoice'}.pdf",
        # `invoice` is one of the nine sender buckets, so an org that has set a
        # billing From address sends this from it rather than from the default.
        purpose="invoice",
        ref=f"invoice:{number}",
        label="Invoice email",
    )
    return True
