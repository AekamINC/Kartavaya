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
import io
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, Response

from db import get_pool
from limiter import limiter
from services import upi

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


def _well_formed(token: str) -> bool:
    """Shape check before any query, so a scan of junk paths costs a string
    comparison. Length and alphabet are fixed by migration 128."""
    return len(token) == 16 and all(c.isalnum() or c in "-_" for c in token)


async def _payable_row(token: str):
    """The one definition of "this invoice is publicly payable".

    Both public routes go through this. Two copies of a rule is how the JSON
    and the QR would come to disagree — and the disagreement that matters is
    the QR still rendering a payment code for an invoice the page has already
    stopped showing.

    Returns None for every reason: unknown token, inactive, cancelled, not
    issued, already settled. The caller turns all of them into the same 404.
    """
    if not _well_formed(token):
        return None
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT i.org_id,
               i.invoice_number, i.invoice_type, i.invoice_date, i.due_date,
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
    if (
        row is None
        or row["cancelled_at"] is not None
        or row["doc_status"] not in _PUBLIC_DOC_STATUS
        or row["payment_status"] not in _PUBLIC_PAYMENT_STATUS
    ):
        return None
    return row


#: Whether migration 129 has run. Cached only once TRUE — a cached FALSE would
#: keep every pay page on the single-address fallback until the next redeploy.
_upi_table: bool = False


async def _upi_accounts(org_id, org_name: str, fallback_vpa: str,
                        fallback_name: str) -> list[dict]:
    """This org's receiving addresses, one per platform, in display order.

    ── Why a list, when UPI is interoperable ─────────────────────────────────

    Because interoperability answers a different question. It means the customer
    can pay any of these from whichever app they have; it does not mean the firm
    holds one account. A firm with Paytm, PhonePe and Google Pay accounts
    settles and reconciles each separately, and which one receives is its
    decision, not ours.

    The payer-facing consequence is small (more buttons). The org-facing one is
    not: with a receiving address per platform, reconciliation no longer has to
    GUESS which service a credit came through — the address it arrived at names
    the account. There is no gateway anywhere in this flow, so that guess was
    otherwise the only thing attribution had.

    Falls back to `organisations.upi_vpa` when migration 129 has not run, so a
    page rendered against the older schema still offers exactly what it offered
    before rather than losing its Pay button.
    """
    global _upi_table
    pool = await get_pool()
    if not _upi_table:
        probe = await pool.fetchrow(
            "SELECT to_regclass('staging.org_upi_accounts') IS NOT NULL AS ok"
        )
        _upi_table = bool(probe and probe["ok"])

    rows = []
    if _upi_table:
        rows = await pool.fetch(
            "SELECT platform, vpa, payee_name FROM staging.org_upi_accounts "
            " WHERE org_id=$1 AND is_active "
            " ORDER BY is_default DESC, sort_order, platform",
            org_id,
        )

    if not rows:
        vpa = (fallback_vpa or "").strip()
        if not vpa:
            return []
        return [{
            "platform": "other",
            "label": upi.PLATFORM_LABELS["other"],
            "vpa": vpa,
            "payee_name": fallback_name or org_name,
        }]

    return [
        {
            "platform": r["platform"],
            "label": upi.PLATFORM_LABELS.get(r["platform"], r["platform"]),
            "vpa": r["vpa"],
            "payee_name": r["payee_name"] or org_name,
        }
        for r in rows
    ]


@router.get("/{token}")
@limiter.limit("30/minute")
async def public_invoice(request: Request, token: str) -> dict:
    """Everything `pay.kartavaya.com/i/{token}` renders, and nothing else.

    `request` is not decoration — slowapi resolves the client address off it and
    raises at import time for a decorated handler that omits it.
    """
    row = await _payable_row(token)

    # ONE refusal for every reason. "No such token", "that one is settled" and
    # "that one was cancelled" are the same 404 with the same body: any of them
    # answering differently confirms a real token to someone holding a guess.
    if row is None:
        raise HTTPException(404, "This invoice link is not available")

    items = row["line_items"]
    if isinstance(items, str):
        import json as _json
        items = _json.loads(items)

    accounts = await _upi_accounts(
        row["org_id"], row["org_name"],
        row["org_upi_vpa"] or "", row["org_upi_payee_name"] or "",
    )

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
        # `payable` is absent, not empty, when the org has set no UPI address
        # at all. Most organisations have none today, so this is still a normal
        # case and the page must render a "pay by bank transfer" fallback
        # rather than a dead QR. An empty string here would have been drawn as
        # a valid, unscannable code.
        #
        # `accounts` is a LIST and was an object until P3b. The change is
        # breaking and was made deliberately with its one consumer
        # (`PayPage.jsx`) in the same commit — see `_upi_accounts` for why the
        # firm's several accounts are a real distinction and not duplication.
        # The FIRST entry is the org's default: the ordering carries that, so
        # the page never has to hold a separate "which one" field that could
        # disagree with the list beside it.
        "payable": (
            {
                "accounts": accounts,
                "amount": _money(row["balance_due"]),
            }
            if accounts
            else None
        ),
    }


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d is not None else None


@router.get("/qr/svg")
@limiter.limit("30/minute")
async def pay_qr(request: Request, token: str, platform: str = "") -> Response:
    """The UPI QR for one invoice, as SVG.

    ── Why the server draws it, and why it takes a TOKEN not a string ─────────

    A QR generated in the browser needs a library, and the pay page runs under a
    strict CSP with no CDN allowance — a payment screen is the last place in
    this product to start executing a third party's script.

    More importantly this endpoint takes the invoice token and builds the UPI
    string ITSELF. The obvious design — `?data=<any string>` — is an open
    redirect in QR form: anyone could hand out a kartavaya.com URL that renders
    a code paying THEIR account, with our domain lending it credibility. The
    payee is therefore never an input. It is read from the same row the invoice
    came from, under the same rules, and an invoice that is not publicly
    payable has no QR either.

    ── One standard `upi://` string, not a branded scheme ────────────────────

    Every bank scanner and every UPI app reads `upi://pay?pa=…`. A `phonepe://`
    code is not a valid UPI QR — other apps and bank scanners reject it — so
    the branded buttons on the page are built from this same string rather than
    from codes of their own.

    ── `?platform=` selects WHICH of the org's accounts, and nothing else ─────

    Since P3b an org may hold an address per platform. The parameter names one
    of a closed set of platforms and is resolved against that org's own rows;
    an unknown or absent value falls back to their default. It is still never a
    string to encode, for the reason above.
    """
    row = await _payable_row(token)
    if row is None:
        raise HTTPException(404, "This invoice link is not available")

    accounts = await _upi_accounts(
        row["org_id"], row["org_name"],
        row["org_upi_vpa"] or "", row["org_upi_payee_name"] or "",
    )
    if not accounts:
        raise HTTPException(404, "This invoice link is not available")

    # `accounts[0]` is the default — the SQL orders by it. An unrecognised
    # platform is not an error the customer can act on, so it resolves to the
    # default rather than showing them a broken image on a payment screen.
    wanted = (platform or "").strip().lower()
    chosen = next((a for a in accounts if a["platform"] == wanted), accounts[0])

    import segno

    uri = upi.pay_uri(
        chosen["vpa"],
        chosen["payee_name"] or row["org_name"],
        _money(row["balance_due"]),
        f"{row['org_name']} {row['invoice_number']}",
    )

    buf = io.BytesIO()
    # `error='m'` (~15%) is the UPI convention: enough redundancy for a phone
    # camera at an angle without inflating the module count until it stops
    # scanning from a laptop screen.
    segno.make(uri, error="m").save(buf, kind="svg", scale=6, border=2)
    return Response(
        content=buf.getvalue(),
        media_type="image/svg+xml",
        # Safe to cache: the code is a pure function of the invoice, and the
        # invoice's amount cannot change once it is final. Private, because a
        # shared cache holding one customer's payment code is not something to
        # introduce for a few kilobytes.
        headers={"Cache-Control": "private, max-age=300"},
    )
