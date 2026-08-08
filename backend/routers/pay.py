"""
pay.py — the ONE unauthenticated route in this product that returns invoice data.

    GET /api/v1/pay/{token}

P2 of the shared invoice link. `pay.kartavaya.com/i/{token}` renders from this
and nothing else.

── The threat model, because "public endpoint" is doing a lot of work here ────

The token is a bearer capability in a URL that gets FORWARDED — into a WhatsApp
thread, an email, a group chat. Three consequences shape everything below:

1. **The response may contain nothing that is not already on the paper
   invoice.** The customer was sent that document; the link cannot leak more
   than the PDF they already hold. That is why this route builds its payload
   field by field from an allow-list and never `SELECT *` into a dict. A future
   column added to `ganit_invoices` must not silently join the public response —
   which is exactly what `dict(row)` would do.

2. **It is an oracle for token guessing.** 96 bits makes guessing hopeless, but
   the rate limit is per IP anyway: without it this is also a cheap way to
   enumerate whether a token is live, and to scrape once one leaks.

3. **A refusal must not distinguish "no such token" from "that invoice is
   settled".** Both are 404. A 403 on a real token confirms the token is real,
   which is the one bit an attacker actually wants.

── What is deliberately NOT here ─────────────────────────────────────────────

No payment history — who paid what and when is the org's business, not the
recipient's, and a partially-paid invoice forwarded to a third party would
otherwise disclose the customer's payment behaviour. `amount_due` is a single
number, which is all anyone needs in order to pay.

No `org_id`, no `client_id`, no `contact_id`, no invoice UUID. The doorstep in
`37-final-flow.html` shows sender, number, due date, amount and billed-to; the
line items sit behind a tap. This returns both because the page needs both, but
it returns no identifier that addresses another API.

── There is no payment gateway, and there will not be one ────────────────────

`payable.vpa` is the ORG's own UPI address. Money moves from the customer
straight to the firm; Kartavaya never holds it and takes on no PCI scope. The
cost is real and is stated in the payload rather than hidden: there is no
callback, so `status` here can only ever be what bank reconciliation last said.
Nothing built on this may promise an instant receipt.
"""
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

from db import get_pool
from limiter import limiter

router = APIRouter(prefix="/api/v1/pay", tags=["pay"])


#: Reachable states. A `draft` has not been issued to anybody — publishing one
#: would make a working link out of a document the firm has not finished — and a
#: settled or cancelled invoice must not present a Pay button. Kept as an
#: allow-list rather than a list of refusals so a doc_status invented later is
#: unreachable until someone decides it should be public.
_PUBLIC_DOC_STATUS = ("final", "sent", "viewed")

#: `paid` is settled. `partial` stays reachable on purpose: the balance is still
#: owed and the whole point of the link is to collect it.
_PUBLIC_PAYMENT_STATUS = ("unpaid", "partial")


def _money(v: Any) -> float:
    """Decimal -> float, for JSON.

    Rupees with two decimals inside float range; the arithmetic already happened
    in Postgres and this only transports the result.
    """
    return float(v if isinstance(v, Decimal) else (v or 0))


def _line(li: dict) -> dict:
    """One line item, allow-listed.

    Stored line items are free-form JSON and have accumulated keys over time —
    product ids and internal costing among them. Only what the paper invoice
    prints comes out.
    """
    return {
        "description": li.get("description") or "",
        "hsn_code": li.get("hsn_code") or "",
        "quantity": _money(li.get("quantity")),
        "rate": _money(li.get("rate")),
        "gst_rate": _money(li.get("gst_rate")),
        "amount": _money(li.get("amount") or li.get("taxable")),
    }


@router.get("/{token}")
@limiter.limit("30/minute")
async def public_invoice(request: Request, token: str) -> dict:
    """Everything `pay.kartavaya.com/i/{token}` renders, and nothing else.

    `request` is not decoration — slowapi resolves the client address off it and
    raises at import time for a decorated handler that omits it.
    """
    # Cheap shape check before touching the database, so a scan of junk paths
    # costs a string comparison rather than a query. Length and alphabet are
    # fixed by migration 128.
    if len(token) != 16 or not all(c.isalnum() or c in "-_" for c in token):
        raise HTTPException(404, "Not found")

    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT i.invoice_number, i.invoice_type, i.invoice_date, i.due_date,
               i.line_items, i.subtotal, i.cgst, i.sgst, i.igst, i.cess,
               i.discount, i.total, i.balance_due,
               i.payment_status, i.doc_status, i.cancelled_at,
               i.currency, i.notes, i.terms, i.place_of_supply,
               o.name           AS org_name,
               o.gstin          AS org_gstin,
               o.logo_url       AS org_logo_url,
               o.upi_vpa        AS org_upi_vpa,
               o.upi_payee_name AS org_upi_payee_name,
               c.name           AS billed_to_name
        FROM staging.ganit_invoices i
        JOIN staging.organisations o ON o.id = i.org_id
        LEFT JOIN staging.graha_clients c ON c.id = i.client_id
        WHERE i.pay_token = $1 AND i.is_active = TRUE
        """,
        token,
    )

    # ONE refusal for every reason. "No such token", "that one is settled" and
    # "that one was cancelled" are the same 404 with the same body: any of them
    # answering differently confirms a real token to someone holding a guess.
    if (
        row is None
        or row["cancelled_at"] is not None
        or row["doc_status"] not in _PUBLIC_DOC_STATUS
        or row["payment_status"] not in _PUBLIC_PAYMENT_STATUS
    ):
        raise HTTPException(404, "This invoice link is not available")

    items = row["line_items"]
    if isinstance(items, str):
        import json as _json
        items = _json.loads(items)

    vpa = (row["org_upi_vpa"] or "").strip()

    return {
        "invoice": {
            "number": row["invoice_number"],
            "type": row["invoice_type"],
            "date": _iso(row["invoice_date"]),
            "due_date": _iso(row["due_date"]),
            "currency": row["currency"] or "INR",
            "place_of_supply": row["place_of_supply"] or "",
            "notes": row["notes"] or "",
            "terms": row["terms"] or "",
        },
        "payee": {
            "name": row["org_name"],
            "gstin": row["org_gstin"] or "",
            "logo_url": row["org_logo_url"] or None,
        },
        "billed_to": {"name": row["billed_to_name"] or ""},
        "lines": [_line(li) for li in (items or []) if isinstance(li, dict)],
        "totals": {
            "subtotal": _money(row["subtotal"]),
            "cgst": _money(row["cgst"]),
            "sgst": _money(row["sgst"]),
            "igst": _money(row["igst"]),
            "cess": _money(row["cess"]),
            "discount": _money(row["discount"]),
            "total": _money(row["total"]),
            "amount_due": _money(row["balance_due"]),
        },
        # Status, and the honesty that has to travel with it. There is no
        # gateway and so no callback: this is what bank reconciliation last
        # said, and the page must not imply a receipt will appear by itself.
        "status": row["payment_status"],
        "settlement": {
            "instant_confirmation": False,
            "note": "Payment is confirmed against the bank statement, not automatically.",
        },
        # `payable` is absent, not empty, when the org has set no UPI address.
        # Zero organisations have one today, so this is the NORMAL case at the
        # moment and the page must render a "pay by bank transfer" fallback
        # rather than a dead QR. An empty string here would have been drawn as
        # a valid, unscannable code.
        "payable": (
            {
                "vpa": vpa,
                "payee_name": (row["org_upi_payee_name"] or row["org_name"]),
                "amount": _money(row["balance_due"]),
            }
            if vpa
            else None
        ),
    }


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d is not None else None
