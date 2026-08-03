"""
ganit.py — Ganit · गणित (GST Invoicing) Router
GST-compliant invoicing with HSN/SAC codes, CGST/SGST/IGST calculations.
Depends on Graha (CRM) for contacts.
"""
import json
import logging
import math
import traceback
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from auth_router import require_user
from db import get_pool
from middleware.module_levels import require_level
from middleware.org_resolver import get_org_id
from middleware.role_tiers import APPROVER
from middleware.subscription import require_module
from services.gstin import GSTINError, requires_supplier_gstin
from services.gstin import validate as validate_gstin
from utils import next_doc_number

router = APIRouter(prefix="/api/v1/ganit", tags=["ganit-invoicing"])

_gate = require_module("ganit")

# F4 (b). Shared with graha.py rather than re-implemented: two copies of a
# response contract is how one of them ends up reporting a total the other does
# not, and the whole point of this key is that a client can trust it.
from routers.graha import _listed  # noqa: E402

#: Ganit is a SEPARATED-DUTY module: administering the books and releasing money
#: against them are different authorities, and holding `admin` does not confer
#: `approver`. See middleware/role_tiers.py and middleware/module_levels.py.
#:
#: Applied to the two actions that are unambiguously "release money" or "destroy
#: a legal document" rather than ordinary bookkeeping:
#:   · paying a vendor bill  — money leaves the company
#:   · cancelling an invoice — voids a tax document already issued
#:
#: Ordinary writes are deliberately NOT raised to `editor` yet. Every existing
#: grant predates the level column or defaults to `viewer`, so enforcing editor
#: today would revoke ordinary bookkeeping from real users with no migration to
#: restore it. That tightening needs a grant-level backfill first.
_approver = require_level("ganit", APPROVER)


# ── Pydantic Models ──────────────────────────────────────────

class LineItem(BaseModel):
    product_id: str = ""
    description: str
    hsn_code: str = ""
    sac_code: str = ""
    quantity: float = 1
    unit: str = "NOS"
    rate: float = 0
    gst_rate: float = 18.0
    discount_pct: float = 0


class ProductCreate(BaseModel):
    name: str
    hsn_code: str = ""
    sac_code: str = ""
    unit: str = "NOS"
    price: float = 0
    gst_rate: float = 18.0
    description: str = ""
    is_service: bool = False


class ProductUpdate(BaseModel):
    name: str | None = None
    hsn_code: str | None = None
    sac_code: str | None = None
    unit: str | None = None
    price: float | None = None
    gst_rate: float | None = None
    description: str | None = None
    is_service: bool | None = None


class InvoiceCreate(BaseModel):
    contact_id: str = ""
    deal_id: str = ""
    invoice_type: str = "tax_invoice"
    invoice_date: str = ""
    due_date: str = ""
    place_of_supply: str = ""
    is_igst: bool = False
    is_export: bool = False
    currency: str = "INR"
    line_items: list[LineItem]
    discount: float = 0
    notes: str = ""
    terms: str = ""
    doc_status: str = ""


class PaymentRecord(BaseModel):
    amount: float
    payment_date: str = ""
    payment_method: str = "bank_transfer"
    reference: str = ""
    notes: str = ""


class VendorCreate(BaseModel):
    name: str
    gstin: str = ""
    email: str = ""
    phone: str = ""
    address: dict = {}


class VendorUpdate(BaseModel):
    name: str | None = None
    gstin: str | None = None
    email: str | None = None
    phone: str | None = None
    address: dict | None = None


class VendorBillCreate(BaseModel):
    vendor_id: str
    bill_number: str = ""
    bill_date: str = ""
    due_date: str = ""
    is_igst: bool = False
    line_items: list[LineItem]
    notes: str = ""
    attachment_url: str = ""


class VendorBillPayment(BaseModel):
    amount: float
    payment_date: str = ""
    method: str = "bank_transfer"
    reference: str = ""


class ExpenseCreate(BaseModel):
    title: str
    category: str = "Miscellaneous"
    amount: float = 0
    tax_amount: float = 0
    total: float = 0
    expense_date: str = ""
    vendor: str = ""
    reference: str = ""
    notes: str = ""
    receipt_urls: list[str] = []
    is_billable: bool = False
    contact_id: str = ""
    project_id: str = ""


class ExpenseUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    amount: float | None = None
    tax_amount: float | None = None
    total: float | None = None
    expense_date: str | None = None
    vendor: str | None = None
    reference: str | None = None
    notes: str | None = None
    receipt_urls: list[str] | None = None
    is_billable: bool | None = None
    contact_id: str | None = None
    project_id: str | None = None


class ExpenseCategoryCreate(BaseModel):
    name: str
    icon: str = ""


class ContractCreate(BaseModel):
    title: str
    description: str = ""
    contract_value: float = 0
    start_date: str = ""
    end_date: str = ""
    contact_id: str = ""
    renewal_reminder_days: int = 30
    notes: str = ""


class ContractUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    contract_value: float | None = None
    start_date: str | None = None
    end_date: str | None = None
    contact_id: str | None = None
    status: str | None = None
    renewal_reminder_days: int | None = None
    file_url: str | None = None
    file_key: str | None = None
    notes: str | None = None


class RecurringCreate(BaseModel):
    contact_id: str = ""
    template_items: list[dict] = []
    subtotal: float = 0
    gst_rate: float = 18.0
    is_igst: bool = False
    frequency: str = "monthly"
    next_date: str
    end_date: str = ""
    auto_send: bool = False
    notes: str = ""
    terms: str = ""


class DocStatusUpdate(BaseModel):
    doc_status: str


# ── Helper: compute GST breakdown ───────────────────────────

def _compute_invoice(items: list[LineItem], is_igst: bool, flat_discount: float = 0):
    subtotal = 0
    cgst = 0
    sgst = 0
    igst = 0
    computed_items = []

    for item in items:
        line_total = item.quantity * item.rate
        if item.discount_pct > 0:
            line_total *= (1 - item.discount_pct / 100)
        line_total = round(line_total, 2)

        gst_amount = round(line_total * item.gst_rate / 100, 2)
        if is_igst:
            igst += gst_amount
        else:
            cgst += round(gst_amount / 2, 2)
            sgst += round(gst_amount / 2, 2)

        subtotal += line_total
        computed_items.append({
            "description": item.description,
            "product_id": item.product_id,
            "hsn_code": item.hsn_code,
            "sac_code": item.sac_code,
            "quantity": item.quantity,
            "unit": item.unit,
            "rate": item.rate,
            "gst_rate": item.gst_rate,
            "discount_pct": item.discount_pct,
            "line_total": line_total,
            "gst_amount": gst_amount,
        })

    total = round(subtotal + cgst + sgst + igst - flat_discount, 2)
    return {
        "line_items": computed_items,
        "subtotal": round(subtotal, 2),
        "cgst": round(cgst, 2),
        "sgst": round(sgst, 2),
        "igst": round(igst, 2),
        "discount": round(flat_discount, 2),
        "total": total,
    }


async def _refuse_final_if_incomplete(pool, org_id: str, invoice: dict, contact_id: str | None):
    """Rule 46 gate, applied where FINAL begins rather than where the PDF ends.

    The PDF generator has always refused a legally incomplete tax document
    (`doc_validation.validate_tax_invoice`), but `create_invoice` defaults a
    tax invoice to doc_status='final' with no check at all — so the form could
    mint a "final" invoice its own PDF endpoint then refuses, and the user
    found out at download time. Measured live 2026-08-02: an invoice created
    through InvoiceForm with no customer and no HSN 422'd on GET .../pdf.

    Same validator, same 422 payload shape as the PDF route, so the client can
    render one gap list for both. Drafts stay deliberately permissive — an
    incomplete draft is the workflow, an incomplete FINAL is a lie.
    """
    from services.doc_validation import TAX_DOCUMENT_TYPES, validate_tax_invoice

    if (invoice.get("invoice_type") or "") not in TAX_DOCUMENT_TYPES:
        return

    org = await pool.fetchrow(
        "SELECT name, gstin, pan, billing_address FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    org_d = dict(org) if org else {}
    if isinstance(org_d.get("billing_address"), str):
        try:
            org_d["billing_address"] = json.loads(org_d["billing_address"])
        except (TypeError, ValueError):
            pass

    contact = None
    if contact_id:
        contact = await pool.fetchrow(
            "SELECT name, company, gstin FROM staging.graha_contacts "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(contact_id), org_id,
        )

    check = validate_tax_invoice(invoice, org_d, dict(contact) if contact else None)
    if not check.ok:
        raise HTTPException(422, check.as_payload())


# ── Invoice Number Generation ───────────────────────────────

async def _next_invoice_number(pool, org_id: str, prefix: str = "INV") -> str:
    return await next_doc_number(pool, org_id, "ganit_invoices", "invoice_number", prefix)


# ── Products / Services ─────────────────────────────────────

@router.get("/products")
async def list_products(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, hsn_code, sac_code, unit, price, gst_rate, "
        "description, is_service, created_at "
        "FROM staging.ganit_products WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/products")
async def create_product(
    body: ProductCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_products "
        "(org_id, name, hsn_code, sac_code, unit, price, gst_rate, description, is_service) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name",
        org_id, body.name, body.hsn_code, body.sac_code, body.unit,
        body.price, body.gst_rate, body.description, body.is_service,
    )
    return {"status": "created", **dict(row)}


@router.patch("/products/{product_id}")
async def update_product(
    product_id: UUID,
    body: ProductUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    sets = []
    params = [str(product_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.ganit_products SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.ganit_products SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        str(product_id), org_id,
    )
    return {"status": "deleted"}


# ── Invoices ─────────────────────────────────────────────────

@router.get("/invoices")
async def list_invoices(
    invoice_type: Optional[str] = None,
    payment_status: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.due_date, "
        "i.subtotal, i.cgst, i.sgst, i.igst, i.total, i.amount_paid, i.balance_due, "
        "i.payment_status, i.created_at, "
        "c.name as contact_name, c.company as contact_company, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.org_id=$1::uuid AND i.is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if invoice_type:
        query += f"AND i.invoice_type=${idx} "
        params.append(invoice_type)
        idx += 1

    if payment_status:
        query += f"AND i.payment_status=${idx} "
        params.append(payment_status)
        idx += 1

    query += "ORDER BY i.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return _listed(rows, limit=200)


@router.post("/invoices")
async def create_invoice(
    body: InvoiceCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    if not body.line_items:
        raise HTTPException(400, "At least one line item is required")

    valid_types = ("tax_invoice", "proforma", "credit_note", "debit_note", "quotation")
    if body.invoice_type not in valid_types:
        raise HTTPException(400, f"invoice_type must be one of: {', '.join(valid_types)}")

    computed = _compute_invoice(body.line_items, body.is_igst, body.discount)

    inv_date = date.fromisoformat(body.invoice_date) if body.invoice_date else date.today()
    due = date.fromisoformat(body.due_date) if body.due_date else None

    if body.doc_status and body.doc_status in ("draft", "final"):
        doc_status = body.doc_status
    elif body.invoice_type == "quotation":
        doc_status = "draft"
    else:
        doc_status = "final"

    # Validate BEFORE the serial is consumed: Rule 46(b) numbers are
    # consecutive, and a refused create must not burn one. The number is about
    # to be assigned, so the placeholder only exempts the serial check itself.
    if doc_status == "final":
        await _refuse_final_if_incomplete(pool, org_id, {
            "invoice_number": "(assigned on save)",
            "invoice_type": body.invoice_type,
            "invoice_date": inv_date.isoformat(),
            "is_igst": body.is_igst,
            "is_export": body.is_export,
            "place_of_supply": body.place_of_supply,
            "line_items": computed["line_items"],
            "cgst": computed["cgst"], "sgst": computed["sgst"], "igst": computed["igst"],
        }, body.contact_id)

    prefix_map = {"tax_invoice": "INV", "proforma": "PI", "credit_note": "CN",
                  "debit_note": "DN", "quotation": "QTN"}
    inv_number = await _next_invoice_number(pool, org_id, prefix_map.get(body.invoice_type, "INV"))

    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_invoices "
        "(org_id, contact_id, deal_id, invoice_number, invoice_type, invoice_date, due_date, "
        " place_of_supply, is_igst, is_export, currency, line_items, subtotal, cgst, sgst, igst, discount, total, "
        " balance_due, notes, terms, created_by, doc_status) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6::date, $7::date, "
        " $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $18, $19, $20, $21, $22) "
        "RETURNING id, invoice_number, total, doc_status",
        org_id, body.contact_id, body.deal_id, inv_number, body.invoice_type,
        inv_date, due, body.place_of_supply, body.is_igst, body.is_export, body.currency or "INR",
        json.dumps(computed["line_items"]),
        computed["subtotal"], computed["cgst"], computed["sgst"], computed["igst"],
        computed["discount"], computed["total"],
        body.notes, body.terms, user["user_id"], doc_status,
    )
    return {"status": "created", **dict(row)}


@router.patch("/invoices/{invoice_id}")
async def update_invoice(
    invoice_id: UUID,
    body: InvoiceCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Correct a DRAFT invoice. Totals are recomputed, never taken from the client.

    ── Why this exists ──────────────────────────────────────────────────────
    There was no way to change an invoice after creating one. Measured live on
    2026-07-28: `INV-2026-0005` was a draft whose only line had no HSN, so
    `GET /invoices/{id}/pdf` refused it under Rule 46(g) — correctly — and the
    refusal told the user to "Set it in Ganit → the invoice → Edit". No such
    control existed anywhere. The invoice could therefore never acquire its HSN,
    never be issued as a PDF, and stayed permanently held back from the Tally
    and GSTR-1 exports. Create worked; correct did not.

    ── The boundary is PAYMENT, not status ──────────────────────────────────
    Owner's ruling, 2026-08-03: "any invoice created and unpaid can be amended
    and resent, same goes for quote." That is the rule this enforces, and it is
    both simpler and more permissive than what stood here before.

    The old boundary was `doc_status == 'draft'`, which read "final" as
    "issued". That inference is false and it produced a dead end. `doc_status`
    DEFAULTS to 'final' (migration 019), so every invoice this product creates
    through any path except an explicit draft — including one converted from a
    Vikray order — is born "final" without anybody choosing it. Measured live on
    2026-08-03: all six of Aekam Inc's invoices were 'final', five with no
    payment against them, four incomplete under Rule 46. The PDF refused them,
    Edit was not offered on them, and the PDF's own message told the reader to
    fix it in "Ganit → the invoice → Edit" — the very control the status hid.
    Unissuable and uncorrectable at once.

      no payment recorded    editable, whatever its doc_status, and re-sendable
      any payment recorded   refused — the figures a receipt was matched
                             against must not move underneath it, and the
                             remedy is the credit note this module supports

    Sending a copy does not freeze it: an unpaid invoice a customer has queried
    is exactly the one a firm needs to correct and re-send. Money changing hands
    is what makes the document final in the sense that matters.

    The `is_active` guard keeps a cancelled document out too. The invoice NUMBER
    is never reassigned by an edit, so a serial already spent stays with its
    document (Rule 46(b)).

    Totals, tax split and per-line amounts all come from `_compute_invoice`,
    exactly as on create, so an edited invoice cannot end up with figures a
    created one could not have. The invoice NUMBER is never reassigned: a
    document number that changes is a different document.
    """
    pool = await get_pool()

    if not body.line_items:
        raise HTTPException(400, "At least one line item is required")

    existing = await pool.fetchrow(
        "SELECT invoice_number, doc_status, total, balance_due, is_active, "
        "       sent_at, viewed_at "
        "FROM staging.ganit_invoices WHERE id=$1::uuid AND org_id=$2::uuid",
        str(invoice_id), org_id,
    )
    if not existing or not existing["is_active"]:
        raise HTTPException(404, "Invoice not found")

    # Payment is the only thing that freezes a document. See the docstring.
    paid = float(existing["total"] or 0) - float(existing["balance_due"] or 0)
    if paid > 0:
        raise HTTPException(
            409,
            f"{existing['invoice_number']} has ₹{paid:,.2f} recorded against it "
            "and cannot be edited. Reverse the payment first, or issue a credit "
            "note.",
        )

    computed = _compute_invoice(body.line_items, body.is_igst, body.discount)
    inv_date = date.fromisoformat(body.invoice_date) if body.invoice_date else date.today()
    due = date.fromisoformat(body.due_date) if body.due_date else None

    row = await pool.fetchrow(
        "UPDATE staging.ganit_invoices SET "
        " contact_id=NULLIF($1,'')::uuid, invoice_date=$2::date, due_date=$3::date,"
        " place_of_supply=$4, is_igst=$5, is_export=$6, currency=$7,"
        " line_items=$8, subtotal=$9, cgst=$10, sgst=$11, igst=$12,"
        " discount=$13, total=$14, balance_due=$14, notes=$15, terms=$16,"
        " updated_at=NOW() "
        "WHERE id=$17::uuid AND org_id=$18::uuid "
        "RETURNING id, invoice_number, total, doc_status",
        body.contact_id, inv_date, due, body.place_of_supply, body.is_igst,
        body.is_export, body.currency or "INR",
        computed["line_items"],
        computed["subtotal"], computed["cgst"], computed["sgst"], computed["igst"],
        computed["discount"], computed["total"],
        body.notes, body.terms, str(invoice_id), org_id,
    )
    return {"status": "updated", **dict(row)}


@router.get("/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        # `c.phone` is here so the detail screen can offer "Send on WhatsApp"
        # without a second round trip. It is the contact's own number and
        # goes no further than the browser that asked for this invoice.
        "SELECT i.*, c.name as contact_name, c.email as contact_email, "
        "c.phone as contact_phone, "
        "c.company as contact_company, c.gstin as contact_gstin, "
        "c.billing_address as contact_billing_address "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.id=$1::uuid AND i.org_id=$2::uuid",
        str(invoice_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Invoice not found")

    payments = await pool.fetch(
        "SELECT id, amount, payment_date, payment_method, reference, notes, created_at "
        "FROM staging.ganit_payments WHERE invoice_id=$1::uuid ORDER BY payment_date",
        str(invoice_id),
    )

    # ── The completeness gaps, for the DRAWER only ───────────────────────────
    # Owner's ruling 2026-08-03: the document itself stays clean — no red
    # "NOT SET" markers on something a customer reads — but the firm still has
    # to know what is missing BEFORE they send it. So the same
    # `validate_tax_invoice` the PDF route runs is reported here, and the drawer
    # shows it internally.
    #
    # `blocking` is what `GET .../pdf` would refuse with; `advisory` is what it
    # would render anyway. Both travel; neither reaches the document.
    inv = dict(row)
    contact = {
        "name": inv.get("contact_name"), "company": inv.get("contact_company"),
        "gstin": inv.get("contact_gstin"),
    }
    org = await pool.fetchrow(
        "SELECT name, gstin, pan, billing_address FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    org_d = dict(org) if org else {}
    if isinstance(org_d.get("billing_address"), str):
        try:
            org_d["billing_address"] = json.loads(org_d["billing_address"])
        except (TypeError, ValueError):
            pass
    items = inv.get("line_items")
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except (TypeError, ValueError):
            items = []
    from services.doc_validation import validate_tax_invoice
    check = validate_tax_invoice(
        {**inv, "line_items": items if isinstance(items, list) else [],
         "invoice_date": str(inv.get("invoice_date") or "")},
        org_d, contact,
    )

    return {
        "invoice": inv,
        "payments": [dict(p) for p in payments],
        "document_check": {
            "ok": check.ok,
            "blocking": [g.as_dict() for g in check.blocking],
            "advisory": [g.as_dict() for g in check.advisory],
        },
    }


@router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    from services.doc_validation import DocumentIncomplete
    from services.invoice_pdf import generate_invoice_pdf

    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT i.*, c.name as contact_name, c.email as contact_email, c.company as contact_company, "
        "c.gstin as contact_gstin, c.billing_address as contact_billing_address "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.id=$1::uuid AND i.org_id=$2::uuid",
        str(invoice_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Invoice not found")

    # A quotation is NOT an invoice, and rendering it through this template made
    # it look like one: `docs/Quotation.html` has `Prepared for` and a scope
    # summary where the invoice has `Bill To`, no HSN column, a validity date, a
    # payment schedule, numbered terms, and — the substantive difference — an
    # ACCEPTANCE block for the client to counter-sign rather than the supplier's
    # own signature. Previously the only difference was the words in the title.
    #
    # Dispatched here rather than only on the new route so that every existing
    # caller and every saved link gets the right document; the quotation route
    # in `routers/documents.py` is the same generator by a name that says so.
    if (row["invoice_type"] or "") == "quotation":
        from routers.documents import download_quotation_pdf
        return await download_quotation_pdf(
            invoice_id=invoice_id, user=user, org_id=org_id, _g=None
        )

    # `authorized_signatory_name` / `_designation` have existed on organisations
    # since the org-profile migration and were simply never selected, so the
    # signature block the Tax Invoice design specifies rendered as nothing at all.
    org = await pool.fetchrow(
        "SELECT name, gstin, pan, billing_address, logo_url, logo_key, email, phone, website, "
        "bank_details, invoice_note, authorized_signatory_name, "
        "authorized_signatory_designation FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )

    invoice = dict(row)
    for jsonb_field in ("line_items",):
        if isinstance(invoice.get(jsonb_field), str):
            invoice[jsonb_field] = json.loads(invoice[jsonb_field])

    contact = {
        "name": invoice.pop("contact_name", None),
        "email": invoice.pop("contact_email", None),
        "company": invoice.pop("contact_company", None),
        "gstin": invoice.pop("contact_gstin", None),
        "billing_address": invoice.pop("contact_billing_address", None),
    }
    if isinstance(contact.get("billing_address"), str):
        contact["billing_address"] = json.loads(contact["billing_address"] or "{}")

    org_dict = dict(org) if org else {}

    # A tax invoice, credit note or debit note without the supplier's GSTIN is
    # not an incomplete document — it is an INVALID one. It fails e-invoice
    # validation and blocks the recipient's input tax credit, and neither
    # failure is visible to whoever sent it until the recipient complains.
    #
    # The renderer marks the gap in red, which stops it looking complete. That
    # is not enough on its own: the file still downloads, still attaches to an
    # email, and still reaches a customer. `Tax Invoice.html` in the design
    # reference is unambiguous about the intended behaviour — "This document
    # cannot be issued." — so the endpoint refuses rather than rendering.
    #
    # 409 rather than 400: the request is well-formed, the ORG is in the wrong
    # state, and the fix is a settings change rather than a different request.
    if requires_supplier_gstin(invoice.get("invoice_type") or "") and not org_dict.get("gstin"):
        raise HTTPException(
            409,
            f"This {invoice.get('invoice_type', 'document').replace('_', ' ')} "
            "cannot be issued: your organisation has no GSTIN on its company "
            "profile. A tax invoice without a supplier GSTIN fails e-invoice "
            "validation and blocks the recipient's input tax credit. Add it "
            "under Settings → Organisation → Company Profile.",
        )

    for jsonb_field in ("billing_address", "bank_details"):
        if isinstance(org_dict.get(jsonb_field), str):
            org_dict[jsonb_field] = json.loads(org_dict[jsonb_field] or "{}")
    if org_dict.get("logo_key"):
        from services.storage import sign_key
        org_dict["logo_url"] = await sign_key(org_id, org_dict["logo_key"]) or org_dict.get("logo_url", "")

    try:
        pdf_bytes = generate_invoice_pdf(invoice, org_dict, contact)
    except DocumentIncomplete as e:
        # Not a server failure — the document is legally incomplete and we
        # refuse to emit one that looks finished. 422 with every missing field
        # named, so the UI can point at the setting that fixes it.
        logger.info("invoice PDF refused as incomplete: invoice=%s org=%s missing=%s",
                    invoice_id, org_id, [g.field for g in e.check.blocking])
        raise HTTPException(422, detail=e.as_payload())
    except Exception as e:
        logger.error("invoice PDF generation failed: invoice=%s org=%s err=%s\n%s",
                     invoice_id, org_id, e, traceback.format_exc())
        raise HTTPException(500, "Failed to generate invoice PDF — please try again.")

    filename = f"{invoice.get('invoice_number', 'invoice')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/invoices/{invoice_id}/cancel")
async def cancel_invoice(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _a=Depends(_approver),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.ganit_invoices SET payment_status='cancelled', "
        "cancelled_at=NOW(), updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND payment_status NOT IN ('paid','cancelled')",
        str(invoice_id), org_id,
    )
    return {"status": "cancelled"}


# ── Payments ─────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/payments")
async def record_payment(
    invoice_id: UUID,
    body: PaymentRecord,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    inv = await pool.fetchrow(
        "SELECT total, amount_paid, payment_status FROM staging.ganit_invoices "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(invoice_id), org_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["payment_status"] in ("paid", "cancelled"):
        raise HTTPException(400, f"Cannot record payment: invoice is {inv['payment_status']}")

    pay_date = date.fromisoformat(body.payment_date) if body.payment_date else date.today()

    await pool.execute(
        "INSERT INTO staging.ganit_payments "
        "(org_id, invoice_id, amount, payment_date, payment_method, reference, notes, recorded_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $6, $7, $8)",
        org_id, str(invoice_id), body.amount, pay_date,
        body.payment_method, body.reference, body.notes, user["user_id"],
    )

    new_paid = float(inv["amount_paid"]) + body.amount
    new_balance = float(inv["total"]) - new_paid
    new_status = "paid" if new_balance <= 0 else "partial"

    await pool.execute(
        "UPDATE staging.ganit_invoices SET amount_paid=$1, balance_due=$2, "
        "payment_status=$3, updated_at=NOW() WHERE id=$4::uuid AND org_id=$5::uuid",
        round(new_paid, 2), round(max(new_balance, 0), 2), new_status, str(invoice_id), org_id,
    )
    return {"status": new_status, "amount_paid": round(new_paid, 2), "balance_due": round(max(new_balance, 0), 2)}


# ── Dashboard Stats ──────────────────────────────────────────

@router.get("/stats")
async def invoice_stats(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    totals = await pool.fetchrow(
        "SELECT "
        "  COUNT(*) FILTER (WHERE payment_status='unpaid') as unpaid_count, "
        "  COALESCE(SUM(balance_due) FILTER (WHERE payment_status IN ('unpaid','partial','overdue')),0) as total_outstanding, "
        "  COALESCE(SUM(total) FILTER (WHERE payment_status='paid'),0) as total_collected, "
        "  COUNT(*) FILTER (WHERE payment_status='overdue') as overdue_count, "
        "  COUNT(*) as total_invoices "
        "FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND invoice_type='tax_invoice'",
        org_id,
    )
    return dict(totals)


#: The two windows the Today "Cash position" card offers, as (bucket count,
#: PostgreSQL interval per bucket). 30d is twelve buckets so the chart geometry
#: is the same in both modes — the reference draws twelve bars either way.
_CASH_RANGES = {
    "30d":     (12, "3 days"),
    "quarter": (12, "8 days"),
}


@router.get("/cash-position")
async def cash_position(
    range: str = "30d",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Money in and money out, bucketed over a window — Today's Cash position card.

    Inflow is `ganit_payments`: cash actually RECEIVED, not invoiced. A card
    called "cash position" that summed invoice totals would count money the org
    has not been paid, which is the specific thing a receivables-heavy business
    must not be told.

    Outflow is `ganit_expenses` (booked on `expense_date`) plus
    `ganit_vendor_payments` (money actually sent against a bill). Vendor BILLS
    are excluded for the same reason invoices are: an unpaid bill has not left
    the bank.

    Read-only. No table is written and no migration is needed — every column
    used here has existed since `018_graha_ganit_manav.sql`,
    `019_crm_enhancements.sql` and `035_vendor_bills.sql`.
    """
    if range not in _CASH_RANGES:
        raise HTTPException(400, f"range must be one of: {', '.join(_CASH_RANGES)}")
    buckets, step = _CASH_RANGES[range]

    pool = await get_pool()

    # One series query per direction, both bucketed by the same generated
    # calendar so a period with inflow but no outflow still yields a bar rather
    # than shifting every later bucket left by one.
    rows = await pool.fetch(
        f"""
        WITH periods AS (
            SELECT
                gs                                   AS bucket_start,
                gs + INTERVAL '{step}'               AS bucket_end,
                ROW_NUMBER() OVER (ORDER BY gs)      AS idx
            -- Ends on a bucket that CONTAINS today: the last bucket is
            -- [tomorrow - step, tomorrow), so money received this morning is on
            -- the chart. Ending at CURRENT_DATE instead would silently drop it.
            FROM generate_series(
                (CURRENT_DATE + 1 - INTERVAL '{step}' * {buckets})::date,
                (CURRENT_DATE + 1 - INTERVAL '{step}')::date,
                INTERVAL '{step}'
            ) AS gs
        ),
        inflow AS (
            SELECT p.idx, COALESCE(SUM(pay.amount), 0) AS amt
            FROM periods p
            LEFT JOIN staging.ganit_payments pay
                   ON pay.org_id = $1::uuid
                  AND pay.payment_date >= p.bucket_start
                  AND pay.payment_date <  p.bucket_end
            GROUP BY p.idx
        ),
        outflow AS (
            SELECT p.idx, COALESCE(SUM(o.amt), 0) AS amt
            FROM periods p
            LEFT JOIN (
                SELECT expense_date::date AS d, total AS amt
                FROM staging.ganit_expenses
                WHERE org_id = $1::uuid AND is_active = TRUE
                UNION ALL
                SELECT payment_date::date AS d, amount AS amt
                FROM staging.ganit_vendor_payments
                WHERE org_id = $1::uuid
            ) o ON o.d >= p.bucket_start AND o.d < p.bucket_end
            GROUP BY p.idx
        )
        SELECT p.idx,
               p.bucket_start::date AS start_date,
               i.amt                AS inflow,
               f.amt                AS outflow
        FROM periods p
        JOIN inflow  i ON i.idx = p.idx
        JOIN outflow f ON f.idx = p.idx
        ORDER BY p.idx
        """,
        org_id,
    )

    series = [
        {
            "start": r["start_date"].isoformat(),
            "inflow": float(r["inflow"] or 0),
            "outflow": float(r["outflow"] or 0),
        }
        for r in rows
    ]
    total_in = sum(b["inflow"] for b in series)
    total_out = sum(b["outflow"] for b in series)
    return {
        "range": range,
        "series": series,
        "inflow": round(total_in, 2),
        "outflow": round(total_out, 2),
        "net": round(total_in - total_out, 2),
    }


# ── Invoice Lifecycle ───────────────────────────────────────

@router.patch("/invoices/{invoice_id}/status")
async def update_invoice_status(
    invoice_id: UUID,
    body: DocStatusUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid = ("draft", "final", "sent", "viewed")
    if body.doc_status not in valid:
        raise HTTPException(400, f"doc_status must be one of: {', '.join(valid)}")

    inv = await pool.fetchrow(
        "SELECT doc_status FROM staging.ganit_invoices "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(invoice_id), org_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")

    allowed_transitions = {
        "draft": ("final",),
        "final": ("sent",),
        "sent": ("viewed",),
        "viewed": (),
    }
    current = inv["doc_status"] or "draft"
    if body.doc_status not in allowed_transitions.get(current, ()):
        raise HTTPException(400, f"Cannot transition from '{current}' to '{body.doc_status}'")

    # Marking a draft final is where it becomes a statutory document — the same
    # Rule 46 gate as create-as-final and the PDF, so a draft can be saved with
    # gaps but can never LEAVE draft with them.
    if body.doc_status == "final":
        row = await pool.fetchrow(
            "SELECT invoice_number, invoice_type, invoice_date, is_igst, is_export, "
            "place_of_supply, line_items, cgst, sgst, igst, contact_id "
            "FROM staging.ganit_invoices WHERE id=$1::uuid AND org_id=$2::uuid",
            str(invoice_id), org_id,
        )
        items = row["line_items"]
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except (TypeError, ValueError):
                items = []
        await _refuse_final_if_incomplete(pool, org_id, {
            "invoice_number": row["invoice_number"],
            "invoice_type": row["invoice_type"],
            "invoice_date": str(row["invoice_date"] or ""),
            "is_igst": row["is_igst"],
            "is_export": row["is_export"],
            "place_of_supply": row["place_of_supply"],
            "line_items": items if isinstance(items, list) else [],
            "cgst": row["cgst"], "sgst": row["sgst"], "igst": row["igst"],
        }, str(row["contact_id"]) if row["contact_id"] else None)

    extras = ""
    if body.doc_status == "sent":
        extras = ", sent_at=NOW()"
    elif body.doc_status == "viewed":
        extras = ", viewed_at=NOW()"

    await pool.execute(
        f"UPDATE staging.ganit_invoices SET doc_status=$1{extras}, updated_at=NOW() "
        f"WHERE id=$2::uuid AND org_id=$3::uuid",
        body.doc_status, str(invoice_id), org_id,
    )
    return {"status": "updated", "doc_status": body.doc_status}


# ── Estimate Workflow ───────────────────────────────────────

@router.post("/invoices/{invoice_id}/accept-estimate")
async def accept_estimate(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    inv = await pool.fetchrow(
        "SELECT invoice_type, estimate_status FROM staging.ganit_invoices "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(invoice_id), org_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["invoice_type"] != "quotation":
        raise HTTPException(400, "Only quotations can be accepted as estimates")
    if inv["estimate_status"] == "converted":
        raise HTTPException(400, "Estimate already converted to invoice")

    await pool.execute(
        "UPDATE staging.ganit_invoices SET estimate_status='accepted', updated_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(invoice_id), org_id,
    )
    return {"status": "accepted"}


@router.post("/invoices/{invoice_id}/convert-to-invoice")
async def convert_to_invoice(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    inv = await pool.fetchrow(
        "SELECT * FROM staging.ganit_invoices "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(invoice_id), org_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["invoice_type"] != "quotation":
        raise HTTPException(400, "Only quotations can be converted to invoices")
    if inv["estimate_status"] == "converted":
        raise HTTPException(400, "Estimate already converted")
    if inv["estimate_status"] != "accepted":
        raise HTTPException(400, "Estimate must be accepted before converting to invoice")

    inv_date = date.today()
    # Converting mints a FINAL tax invoice, so it is gated exactly like creating
    # one by hand. An estimate is not a tax document and needs no HSN; the
    # invoice it becomes does, and without this the conversion produced a
    # document `GET /invoices/{id}/pdf` then refused.
    _items = inv["line_items"]
    if isinstance(_items, str):
        try:
            _items = json.loads(_items)
        except (TypeError, ValueError):
            _items = []
    await _refuse_final_if_incomplete(pool, org_id, {
        "invoice_number": "(assigned on save)",
        "invoice_type": "tax_invoice",
        "invoice_date": inv_date.isoformat(),
        "is_igst": inv["is_igst"],
        "place_of_supply": inv["place_of_supply"],
        "line_items": _items if isinstance(_items, list) else [],
        "cgst": inv["cgst"], "sgst": inv["sgst"], "igst": inv["igst"],
    }, inv["contact_id"])

    inv_number = await _next_invoice_number(pool, org_id, "INV")

    new_row = await pool.fetchrow(
        "INSERT INTO staging.ganit_invoices "
        "(org_id, contact_id, deal_id, invoice_number, invoice_type, invoice_date, due_date, "
        " place_of_supply, is_igst, line_items, subtotal, cgst, sgst, igst, discount, total, "
        " balance_due, notes, terms, created_by, doc_status) "
        "VALUES ($1::uuid, $2, $3, $4, 'tax_invoice', $5::date, $6, "
        " $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18, 'final') "
        "RETURNING id, invoice_number, total",
        org_id, inv["contact_id"], inv["deal_id"], inv_number,
        inv_date, inv["due_date"],
        inv["place_of_supply"], inv["is_igst"], inv["line_items"],
        inv["subtotal"], inv["cgst"], inv["sgst"], inv["igst"],
        inv["discount"], inv["total"],
        inv["notes"], inv["terms"], user["user_id"],
    )

    await pool.execute(
        "UPDATE staging.ganit_invoices SET estimate_status='converted', "
        "converted_invoice_id=$1::uuid, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid",
        str(new_row["id"]), str(invoice_id), org_id,
    )
    return {"status": "converted", **dict(new_row)}


# ── Expenses ────────────────────────────────────────────────

@router.get("/expenses")
async def list_expenses(
    category: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    is_billable: Optional[bool] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT e.id, e.title, e.category, e.amount, e.tax_amount, e.total, "
        "e.expense_date, e.vendor, e.reference, e.notes, e.receipt_urls, "
        "e.is_billable, e.contact_id, e.project_id, e.created_at, "
        "c.name as contact_name, COUNT(*) OVER() AS _total "
        "FROM staging.ganit_expenses e "
        "LEFT JOIN staging.graha_contacts c ON c.id = e.contact_id "
        "WHERE e.org_id=$1::uuid AND e.is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if category:
        query += f"AND e.category=${idx} "
        params.append(category)
        idx += 1

    if from_date:
        query += f"AND e.expense_date >= ${idx}::date "
        params.append(date.fromisoformat(from_date))
        idx += 1

    if to_date:
        query += f"AND e.expense_date <= ${idx}::date "
        params.append(date.fromisoformat(to_date))
        idx += 1

    if is_billable is not None:
        query += f"AND e.is_billable=${idx} "
        params.append(is_billable)
        idx += 1

    query += "ORDER BY e.expense_date DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return _listed(rows, limit=200)


@router.post("/expenses")
async def create_expense(
    body: ExpenseCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    exp_date = date.fromisoformat(body.expense_date) if body.expense_date else date.today()

    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_expenses "
        "(org_id, title, category, amount, tax_amount, total, expense_date, "
        " vendor, reference, notes, receipt_urls, is_billable, contact_id, project_id, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::date, "
        " $8, $9, $10, $11, $12, NULLIF($13,'')::uuid, NULLIF($14,'')::uuid, $15) "
        "RETURNING id, title, total",
        org_id, body.title, body.category, body.amount, body.tax_amount, body.total,
        exp_date, body.vendor, body.reference, body.notes,
        body.receipt_urls, body.is_billable, body.contact_id, body.project_id,
        user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/expenses/{expense_id}")
async def update_expense(
    expense_id: UUID,
    body: ExpenseUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    sets = []
    params = [str(expense_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("contact_id", "project_id"):
            sets.append(f"{k}=NULLIF(${idx},'')::uuid")
            params.append(v)
        elif k == "expense_date":
            sets.append(f"{k}=${idx}::date")
            params.append(date.fromisoformat(v) if v else None)
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.ganit_expenses SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/expenses/{expense_id}")
async def delete_expense(
    expense_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.ganit_expenses SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        str(expense_id), org_id,
    )
    return {"status": "deleted"}


# ── Expense Categories ──────────────────────────────────────

_DEFAULT_EXPENSE_CATEGORIES = [
    ("Travel", "✈️"), ("Office Supplies", "📎"), ("Meals", "🍽️"),
    ("Software", "💻"), ("Communication", "📞"), ("Rent", "🏢"),
    ("Utilities", "💡"), ("Marketing", "📣"), ("Professional Fees", "⚖️"),
    ("Miscellaneous", "📁"),
]


@router.get("/expense-categories")
async def list_expense_categories(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, icon, created_at "
        "FROM staging.ganit_expense_categories WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY name",
        org_id,
    )

    if not rows:
        for name, icon in _DEFAULT_EXPENSE_CATEGORIES:
            await pool.execute(
                "INSERT INTO staging.ganit_expense_categories (org_id, name, icon) "
                "VALUES ($1::uuid, $2, $3) ON CONFLICT (org_id, name) DO NOTHING",
                org_id, name, icon,
            )
        rows = await pool.fetch(
            "SELECT id, name, icon, created_at "
            "FROM staging.ganit_expense_categories WHERE org_id=$1::uuid AND is_active=TRUE "
            "ORDER BY name",
            org_id,
        )

    return {"data": [dict(r) for r in rows]}


@router.post("/expense-categories")
async def create_expense_category(
    body: ExpenseCategoryCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    icon = body.icon or "📁"
    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_expense_categories (org_id, name, icon) "
        "VALUES ($1::uuid, $2, $3) "
        "ON CONFLICT (org_id, name) DO UPDATE SET is_active=TRUE, icon=EXCLUDED.icon "
        "RETURNING id, name, icon",
        org_id, body.name, icon,
    )
    return {"status": "created", **dict(row)}


# ── Contracts ───────────────────────────────────────────────

@router.get("/contracts")
async def list_contracts(
    status: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT ct.id, ct.title, ct.description, ct.contract_value, "
        "ct.start_date, ct.end_date, ct.status, ct.renewal_reminder_days, "
        "ct.file_url, ct.notes, ct.created_at, "
        "c.name as contact_name, COUNT(*) OVER() AS _total "
        "FROM staging.ganit_contracts ct "
        "LEFT JOIN staging.graha_contacts c ON c.id = ct.contact_id "
        "WHERE ct.org_id=$1::uuid AND ct.is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if status:
        query += f"AND ct.status=${idx} "
        params.append(status)
        idx += 1

    query += "ORDER BY ct.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    from services.storage import sign_key
    # This list post-processes each row to mint a signed file URL, so it cannot
    # hand `rows` straight to `_listed`. The envelope is assembled by hand from
    # the same `_total` window column, and `_total` is popped inside the loop so
    # it cannot ride out on a document the frontend maps over.
    total = int(dict(rows[0]).get("_total", len(rows))) if rows else 0
    docs = []
    for r in rows:
        d = dict(r)
        d.pop("_total", None)
        if d.get("file_key"):
            d["file_url"] = await sign_key(org_id, d["file_key"]) or d.get("file_url", "")
        docs.append(d)
    return {"data": docs, "total": total, "limit": 200, "truncated": total > 200}


@router.post("/contracts")
async def create_contract(
    body: ContractCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    start = date.fromisoformat(body.start_date) if body.start_date else None
    end = date.fromisoformat(body.end_date) if body.end_date else None

    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_contracts "
        "(org_id, contact_id, title, description, contract_value, start_date, end_date, "
        " renewal_reminder_days, notes, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, $3, $4, $5, $6::date, $7::date, $8, $9, $10) "
        "RETURNING id, title, status",
        org_id, body.contact_id, body.title, body.description, body.contract_value,
        start, end, body.renewal_reminder_days, body.notes, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/contracts/{contract_id}")
async def update_contract(
    contract_id: UUID,
    body: ContractUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "status" in updates:
        valid_statuses = ("draft", "active", "expired", "cancelled", "renewed")
        if updates["status"] not in valid_statuses:
            raise HTTPException(400, f"status must be one of: {', '.join(valid_statuses)}")

    sets = []
    params = [str(contract_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k == "contact_id":
            sets.append(f"{k}=NULLIF(${idx},'')::uuid")
            params.append(v)
        elif k in ("start_date", "end_date"):
            sets.append(f"{k}=${idx}::date")
            params.append(date.fromisoformat(v) if v else None)
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")

    await pool.execute(
        f"UPDATE staging.ganit_contracts SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.get("/contracts/{contract_id}")
async def get_contract(
    contract_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT ct.*, c.name as contact_name, c.email as contact_email, "
        "c.company as contact_company "
        "FROM staging.ganit_contracts ct "
        "LEFT JOIN staging.graha_contacts c ON c.id = ct.contact_id "
        "WHERE ct.id=$1::uuid AND ct.org_id=$2::uuid",
        str(contract_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contract not found")

    invoices = []
    if row["contact_id"]:
        inv_rows = await pool.fetch(
            "SELECT id, invoice_number, invoice_type, invoice_date, total, payment_status "
            "FROM staging.ganit_invoices "
            "WHERE org_id=$1::uuid AND contact_id=$2::uuid AND is_active=TRUE "
            "ORDER BY invoice_date DESC LIMIT 50",
            org_id, str(row["contact_id"]),
        )
        invoices = [dict(r) for r in inv_rows]

    return {"contract": dict(row), "invoices": invoices}


# ── E-Signature ─────────────────────────────────────────────

class SendForSignature(BaseModel):
    signers: list[dict]


class VerifyOTP(BaseModel):
    otp: str


class SubmitSignature(BaseModel):
    signature_data_url: str
    consent_text: str = "I intend to sign and be bound by this document."


@router.post("/contracts/{contract_id}/send-for-signature")
async def send_for_signature(
    contract_id: UUID,
    body: SendForSignature,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    from services.esign_service import send_for_signature as _send
    pool = await get_pool()
    ct = await pool.fetchval(
        "SELECT id FROM staging.ganit_contracts WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contract_id), org_id,
    )
    if not ct:
        raise HTTPException(404, "Contract not found")
    if not body.signers:
        raise HTTPException(400, "At least one signer is required")
    for s in body.signers:
        if not s.get("name") or not s.get("email"):
            raise HTTPException(400, "Each signer must have name and email")
    result, failed = await _send(pool, str(contract_id), body.signers, org_id, user["user_id"])
    # `status` used to be the literal "sent" whatever happened, while every send
    # was in fact raising and being swallowed. The signer rows and their links
    # are valid either way, so a partial failure is not an error — but it must
    # be visible, or the firm never learns the client was not written to.
    return {
        "status": "sent" if not failed else "partial",
        "signers": result,
        "email_failed": failed,
    }


@router.get("/sign/{token}")
async def get_signing_page(token: str, request: Request):
    """Public endpoint — no auth required. Returns contract info for signing."""
    from services.esign_service import get_signer_by_token
    pool = await get_pool()
    signer = await get_signer_by_token(pool, token)
    if not signer:
        raise HTTPException(404, "Signing link expired or invalid")
    contract_url = signer.get("contract_file_url")
    if signer.get("contract_file_key") and signer.get("contract_org_id"):
        from services.storage import sign_key
        contract_url = await sign_key(str(signer["contract_org_id"]), signer["contract_file_key"]) or contract_url
    return {
        "signer_name": signer["name"],
        "signer_email": signer["email"],
        "contract_title": signer["contract_title"],
        "contract_description": signer["contract_description"],
        "contract_file_url": contract_url,
        "contract_value": float(signer["contract_value"]) if signer.get("contract_value") else 0,
        "status": signer["status"],
        "otp_verified": signer.get("otp_verified_at") is not None,
    }


@router.post("/sign/{token}/otp")
async def issue_otp(token: str, request: Request):
    """Public — issue OTP to signer's email."""
    from services.esign_service import issue_otp as _issue
    pool = await get_pool()
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    ok = await _issue(pool, token, ip, ua)
    if not ok:
        raise HTTPException(400, "Unable to send OTP. Link may be expired or locked.")
    return {"status": "otp_sent"}


@router.post("/sign/{token}/verify")
async def verify_otp_endpoint(token: str, body: VerifyOTP, request: Request):
    """Public — verify OTP."""
    from services.esign_service import verify_otp as _verify
    pool = await get_pool()
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    ok = await _verify(pool, token, body.otp, ip, ua)
    if not ok:
        raise HTTPException(400, "Invalid or expired OTP")
    return {"status": "verified"}


@router.post("/sign/{token}/submit")
async def submit_signature_endpoint(token: str, body: SubmitSignature, request: Request):
    """Public — submit signature after OTP verification."""
    from services.esign_service import submit_signature as _submit
    pool = await get_pool()
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    result = await _submit(pool, token, body.signature_data_url, body.consent_text, ip, ua)
    if not result:
        raise HTTPException(400, "Unable to submit signature. OTP verification required.")
    return result


@router.get("/contracts/{contract_id}/signature-status")
async def get_signature_status(
    contract_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    ct = await pool.fetchrow(
        "SELECT signature_status, signed_at FROM staging.ganit_contracts "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contract_id), org_id,
    )
    if not ct:
        raise HTTPException(404, "Contract not found")
    signers = await pool.fetch(
        "SELECT id, name, email, signing_order, status, sent_at, viewed_at, "
        "signed_at, declined_at FROM staging.ganit_contract_signers "
        "WHERE contract_id=$1::uuid ORDER BY signing_order",
        str(contract_id),
    )
    return {
        "signature_status": ct["signature_status"],
        "signed_at": ct["signed_at"],
        "signers": [dict(s) for s in signers],
    }


@router.post("/contracts/{contract_id}/cancel-signature")
async def cancel_sig(
    contract_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    from services.esign_service import cancel_signature as _cancel
    pool = await get_pool()
    await _cancel(pool, str(contract_id), org_id, user["user_id"])
    return {"status": "cancelled"}


@router.get("/contracts/{contract_id}/audit-trail")
async def get_audit_trail_endpoint(
    contract_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    from services.esign_service import get_audit_trail
    pool = await get_pool()
    # The trail carries signer names, emails, IP addresses and user agents.
    # `ganit_contract_audit_trail` is keyed on contract_id alone, so this
    # returned another org's signing evidence for any contract id.
    if not await pool.fetchval(
        "SELECT 1 FROM staging.ganit_contracts WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contract_id), org_id,
    ):
        raise HTTPException(404, "Contract not found")
    trail = await get_audit_trail(pool, str(contract_id))
    return {"audit_trail": trail}


# ── Recurring Invoices ──────────────────────────────────────

@router.get("/recurring")
async def list_recurring(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT r.id, r.contact_id, r.template_items, r.subtotal, r.gst_rate, "
        "r.is_igst, r.frequency, r.next_date, r.end_date, r.auto_send, "
        "r.notes, r.terms, r.is_active, r.created_at, "
        "c.name as contact_name "
        "FROM staging.ganit_recurring r "
        "LEFT JOIN staging.graha_contacts c ON c.id = r.contact_id "
        "WHERE r.org_id=$1::uuid AND r.is_active=TRUE "
        "ORDER BY r.next_date",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/recurring")
async def create_recurring(
    body: RecurringCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid_freq = ("weekly", "monthly", "quarterly", "yearly")
    if body.frequency not in valid_freq:
        raise HTTPException(400, f"frequency must be one of: {', '.join(valid_freq)}")

    end = date.fromisoformat(body.end_date) if body.end_date else None
    next_dt = date.fromisoformat(body.next_date) if body.next_date else date.today()

    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_recurring "
        "(org_id, contact_id, template_items, subtotal, gst_rate, is_igst, "
        " frequency, next_date, end_date, auto_send, notes, terms, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, $3::jsonb, $4, $5, $6, "
        " $7, $8::date, $9::date, $10, $11, $12, $13) "
        "RETURNING id, frequency, next_date",
        org_id, body.contact_id, json.dumps(body.template_items),
        body.subtotal, body.gst_rate, body.is_igst,
        body.frequency, next_dt, end,
        body.auto_send, body.notes, body.terms, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.post("/recurring/{recurring_id}/generate")
async def generate_recurring_invoice(
    recurring_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rec = await pool.fetchrow(
        "SELECT * FROM staging.ganit_recurring "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(recurring_id), org_id,
    )
    if not rec:
        raise HTTPException(404, "Recurring invoice not found")

    items = rec["template_items"] if isinstance(rec["template_items"], list) else json.loads(rec["template_items"])
    subtotal = float(rec["subtotal"])
    gst_rate = float(rec["gst_rate"])
    is_igst = rec["is_igst"]
    gst_total = round(subtotal * gst_rate / 100, 2)

    if is_igst:
        cgst, sgst, igst = 0, 0, gst_total
    else:
        half = round(gst_total / 2, 2)
        cgst, sgst, igst = half, gst_total - half, 0

    total = round(subtotal + gst_total, 2)
    inv_date = date.today()
    due_date = date.today()
    # A recurring profile generates FINAL tax invoices, month after month, and
    # is the path a firm's retainer billing actually runs through. A profile
    # saved without an HSN on a line therefore minted an un-issuable invoice
    # EVERY period, and nothing said so until someone tried to download one.
    # Gated here, before the serial is spent, so the profile is fixed once
    # rather than the invoices being cleaned up repeatedly.
    await _refuse_final_if_incomplete(pool, org_id, {
        "invoice_number": "(assigned on save)",
        "invoice_type": "tax_invoice",
        "invoice_date": inv_date.isoformat(),
        "is_igst": is_igst,
        "place_of_supply": rec["place_of_supply"] if "place_of_supply" in rec else "",
        "line_items": items if isinstance(items, list) else [],
        "cgst": cgst, "sgst": sgst, "igst": igst,
    }, str(rec["contact_id"]) if rec["contact_id"] else None)

    inv_number = await _next_invoice_number(pool, org_id, "INV")

    for li in items:
        qty = float(li.get("quantity", 1))
        rate = float(li.get("rate", 0))
        li_gst = float(li.get("gst_rate", gst_rate))
        taxable = qty * rate
        li["line_total"] = round(taxable + taxable * li_gst / 100, 2)

    new_inv = await pool.fetchrow(
        "INSERT INTO staging.ganit_invoices "
        "(org_id, contact_id, invoice_number, invoice_type, invoice_date, due_date, "
        " is_igst, line_items, subtotal, cgst, sgst, igst, total, balance_due, "
        " notes, terms, recurring_id, doc_status, created_by) "
        "VALUES ($1::uuid, $2, $3, 'tax_invoice', $4::date, $5::date, "
        " $6, $7::jsonb, $8, $9, $10, $11, $12, $12, $13, $14, $15::uuid, 'final', $16) "
        "RETURNING id, invoice_number, total",
        org_id, str(rec["contact_id"]) if rec["contact_id"] else None,
        inv_number, inv_date, due_date,
        is_igst, json.dumps(items), subtotal, cgst, sgst, igst, total,
        rec["notes"], rec["terms"], str(recurring_id), user["user_id"],
    )

    freq_map = {"weekly": 7, "monthly": 1, "quarterly": 3, "yearly": 12}
    freq = rec["frequency"]
    next_dt = rec["next_date"]
    if freq == "weekly":
        from datetime import timedelta
        new_next = next_dt + timedelta(days=7)
    else:
        month_add = freq_map.get(freq, 1)
        new_month = next_dt.month + month_add
        new_year = next_dt.year + (new_month - 1) // 12
        new_month = ((new_month - 1) % 12) + 1
        new_day = min(next_dt.day, 28)
        new_next = date(new_year, new_month, new_day)

    if rec["end_date"] and new_next > rec["end_date"]:
        await pool.execute(
            "UPDATE staging.ganit_recurring SET is_active=FALSE, next_date=$3::date "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(recurring_id), org_id, new_next,
        )
    else:
        await pool.execute(
            "UPDATE staging.ganit_recurring SET next_date=$3::date "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(recurring_id), org_id, new_next,
        )

    return {"status": "generated", **dict(new_inv)}


@router.delete("/recurring/{recurring_id}")
async def delete_recurring(
    recurring_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.ganit_recurring SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(recurring_id), org_id,
    )
    return {"status": "deleted"}


# ── Expense Stats ───────────────────────────────────────────

@router.get("/expense-stats")
async def expense_stats(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    cat_query = (
        "SELECT category, COUNT(*) as count, "
        "COALESCE(SUM(amount),0) as total_amount, "
        "COALESCE(SUM(tax_amount),0) as total_tax, "
        "COALESCE(SUM(total),0) as total "
        "FROM staging.ganit_expenses "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    idx = 2

    if from_date:
        cat_query += f"AND expense_date >= ${idx}::date "
        params.append(date.fromisoformat(from_date))
        idx += 1

    if to_date:
        cat_query += f"AND expense_date <= ${idx}::date "
        params.append(date.fromisoformat(to_date))
        idx += 1

    cat_query += "GROUP BY category ORDER BY total DESC"
    cat_rows = await pool.fetch(cat_query, *params)

    total_expenses = sum(float(r["total"]) for r in cat_rows)
    total_tax = sum(float(r["total_tax"]) for r in cat_rows)
    total_count = sum(r["count"] for r in cat_rows)

    return {
        "by_category": [dict(r) for r in cat_rows],
        "total_expenses": round(total_expenses, 2),
        "total_tax": round(total_tax, 2),
        "count": total_count,
    }


# ── Create Invoice from Deal ──────────────────────────────

@router.post("/invoices/from-deal/{deal_id}")
async def create_invoice_from_deal(
    deal_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    try:
        deal = await pool.fetchrow(
            "SELECT id, title, value, contact_id FROM staging.graha_deals "
            "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
            str(deal_id), org_id,
        )
        if not deal:
            raise HTTPException(404, "Deal not found")

        existing = await pool.fetchrow(
            "SELECT id FROM staging.ganit_invoices WHERE deal_id=$1::uuid AND org_id=$2::uuid LIMIT 1",
            str(deal_id), org_id,
        )
        if existing:
            return {"status": "exists", "invoice_id": str(existing["id"])}

        inv_num = await next_doc_number(pool, org_id, "ganit_invoices", "invoice_number", "INV")
        computed = _compute_invoice(
            [LineItem(description=deal["title"] or "Deal", quantity=1, rate=float(deal["value"] or 0))],
            is_igst=False,
        )

        row = await pool.fetchrow(
            "INSERT INTO staging.ganit_invoices "
            "(org_id, contact_id, deal_id, invoice_number, line_items, subtotal, "
            " cgst, sgst, total, balance_due, doc_status, created_by) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6, $7, $7, $8, $8, 'draft', $9) "
            "RETURNING id",
            org_id, str(deal["contact_id"]) if deal["contact_id"] else None,
            str(deal_id), inv_num, json.dumps(computed["line_items"]),
            computed["subtotal"], computed["cgst"], computed["total"], user["user_id"],
        )

        return {"status": "created", "invoice_id": str(row["id"]), "invoice_number": inv_num}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("create_invoice_from_deal failed: deal=%s org=%s err=%s\n%s",
                     deal_id, org_id, e, traceback.format_exc())
        raise HTTPException(500, "Failed to create invoice — please try again or contact support.")


# ── Vendors & Vendor Bills (Accounts Payable) ────────────────

def _checked_gstin(raw: str | None) -> str:
    """Validate a vendor GSTIN, or raise 400 naming the specific fault.

    A vendor GSTIN was previously stored exactly as typed — "abc" was accepted,
    and so was a real number with two characters transposed. The GSTIN carries a
    check digit so that a typo is catchable at entry; not checking it means the
    error surfaces months later as a refused input tax credit on a filed return.

    Blank stays legal: an unregistered supplier genuinely has no GSTIN, and
    demanding one would make small vendors unrecordable.
    """
    if not raw or not raw.strip():
        return ""
    try:
        return validate_gstin(raw)
    except GSTINError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/vendors")
async def list_vendors(
    search: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = "SELECT * FROM staging.ganit_vendors WHERE org_id=$1::uuid AND is_active=TRUE"
    params: list = [org_id]
    if search:
        params.append(search)
        q += f" AND name ILIKE '%' || ${len(params)} || '%'"
    q += " ORDER BY name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/vendors")
async def create_vendor(
    body: VendorCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    gstin = _checked_gstin(body.gstin)
    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_vendors (org_id, name, gstin, email, phone, address) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb) RETURNING *",
        org_id, body.name, gstin, body.email, body.phone, json.dumps(body.address),
    )
    return dict(row)


@router.patch("/vendors/{vendor_id}")
async def update_vendor(
    vendor_id: UUID,
    body: VendorUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("name", "gstin", "email", "phone"):
        val = getattr(body, field)
        if val is not None:
            if field == "gstin":
                val = _checked_gstin(val)
            vals.append(val)
            updates.append(f"{field}=${len(vals)}")
    if body.address is not None:
        vals.append(json.dumps(body.address))
        updates.append(f"address=${len(vals)}::jsonb")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    vals += [str(vendor_id), org_id]
    row = await pool.fetchrow(
        f"UPDATE staging.ganit_vendors SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Vendor not found")
    return dict(row)


@router.get("/vendor-bills")
async def list_vendor_bills(
    status: str = "",
    vendor_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT b.*, v.name AS vendor_name, COUNT(*) OVER() AS _total "
        "FROM staging.ganit_vendor_bills b "
        "JOIN staging.ganit_vendors v ON v.id = b.vendor_id "
        "WHERE b.org_id=$1::uuid AND b.is_active=TRUE"
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND b.status=${len(params)}"
    if vendor_id:
        params.append(vendor_id)
        q += f" AND b.vendor_id=${len(params)}::uuid"
    q += " ORDER BY b.bill_date DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=200)


@router.get("/payables-summary")
async def payables_summary(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    totals = await pool.fetchrow(
        "SELECT COALESCE(SUM(total - amount_paid), 0) AS outstanding, "
        "COALESCE(SUM(total - amount_paid) FILTER (WHERE due_date < CURRENT_DATE), 0) AS overdue, "
        "COUNT(*) FILTER (WHERE status != 'paid' AND status != 'cancelled') AS open_bills "
        "FROM staging.ganit_vendor_bills WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    aging = await pool.fetch(
        "SELECT CASE "
        "  WHEN due_date IS NULL OR due_date >= CURRENT_DATE THEN 'current' "
        "  WHEN CURRENT_DATE - due_date <= 30 THEN '1-30' "
        "  WHEN CURRENT_DATE - due_date <= 60 THEN '31-60' "
        "  WHEN CURRENT_DATE - due_date <= 90 THEN '61-90' "
        "  ELSE '90+' END AS bucket, "
        "COALESCE(SUM(total - amount_paid), 0) AS amount "
        "FROM staging.ganit_vendor_bills "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND status NOT IN ('paid', 'cancelled') "
        "GROUP BY bucket",
        org_id,
    )
    return {**dict(totals), "aging": [dict(r) for r in aging]}


@router.get("/vendor-bills/{bill_id}")
async def get_vendor_bill(
    bill_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT b.*, v.name AS vendor_name, v.gstin AS vendor_gstin "
        "FROM staging.ganit_vendor_bills b "
        "JOIN staging.ganit_vendors v ON v.id = b.vendor_id "
        "WHERE b.id=$1::uuid AND b.org_id=$2::uuid",
        str(bill_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Vendor bill not found")
    payments = await pool.fetch(
        "SELECT * FROM staging.ganit_vendor_payments WHERE bill_id=$1::uuid ORDER BY payment_date",
        str(bill_id),
    )
    return {**dict(row), "payments": [dict(p) for p in payments]}


@router.post("/vendor-bills")
async def create_vendor_bill(
    body: VendorBillCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not body.line_items:
        raise HTTPException(400, "At least one line item is required")

    vendor = await pool.fetchrow(
        "SELECT id FROM staging.ganit_vendors WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        body.vendor_id, org_id,
    )
    if not vendor:
        raise HTTPException(404, "Vendor not found")

    computed = _compute_invoice(body.line_items, body.is_igst, 0)
    internal_ref = await next_doc_number(pool, org_id, "ganit_vendor_bills", "internal_ref", "VB")

    bill_date = date.fromisoformat(body.bill_date) if body.bill_date else date.today()
    due = date.fromisoformat(body.due_date) if body.due_date else None

    row = await pool.fetchrow(
        "INSERT INTO staging.ganit_vendor_bills "
        "(org_id, vendor_id, bill_number, internal_ref, bill_date, due_date, line_items, "
        " subtotal, cgst, sgst, igst, total, attachment_url, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5::date, $6::date, $7::jsonb, "
        " $8, $9, $10, $11, $12, $13, $14, $15) "
        "RETURNING *",
        org_id, body.vendor_id, body.bill_number, internal_ref, bill_date, due,
        json.dumps(computed["line_items"]), computed["subtotal"], computed["cgst"],
        computed["sgst"], computed["igst"], computed["total"],
        body.attachment_url, body.notes, user["user_id"],
    )
    return dict(row)


@router.post("/vendor-bills/{bill_id}/payments")
async def record_vendor_payment(
    bill_id: UUID,
    body: VendorBillPayment,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _a=Depends(_approver),
):
    pool = await get_pool()
    bill = await pool.fetchrow(
        "SELECT total, amount_paid FROM staging.ganit_vendor_bills "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(bill_id), org_id,
    )
    if not bill:
        raise HTTPException(404, "Vendor bill not found")
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    pay_date = date.fromisoformat(body.payment_date) if body.payment_date else date.today()
    await pool.execute(
        "INSERT INTO staging.ganit_vendor_payments (org_id, bill_id, amount, payment_date, method, reference, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $6, $7)",
        org_id, str(bill_id), body.amount, pay_date, body.method, body.reference, user["user_id"],
    )
    new_paid = round(float(bill["amount_paid"]) + body.amount, 2)
    new_status = "paid" if new_paid >= float(bill["total"]) else "partially_paid"
    await pool.execute(
        "UPDATE staging.ganit_vendor_bills SET amount_paid=$1, status=$2 WHERE id=$3::uuid AND org_id=$4::uuid",
        new_paid, new_status, str(bill_id), org_id,
    )
    return {"ok": True, "amount_paid": new_paid, "status": new_status}


# ── Bank Reconciliation ────────────────────────────────────

class BankStatementLine(BaseModel):
    statement_date: str
    description: str = ""
    reference: str = ""
    amount: float = 0
    running_balance: float | None = None


class BankStatementImport(BaseModel):
    lines: list[BankStatementLine]
    batch_label: str = ""


@router.post("/bank-statements/import")
async def import_bank_statement(
    body: BankStatementImport,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not body.lines:
        raise HTTPException(400, "No lines to import")

    batch_id = f"BSI-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    imported = 0
    for line in body.lines:
        stmt_date = date.fromisoformat(line.statement_date)
        await pool.execute(
            "INSERT INTO staging.ganit_bank_statement_lines "
            "(org_id, statement_date, description, reference, amount, running_balance, batch_id) "
            "VALUES ($1::uuid, $2::date, $3, $4, $5, $6, $7)",
            org_id, stmt_date, line.description, line.reference,
            line.amount, line.running_balance, batch_id,
        )
        imported += 1

    auto_matched = 0
    unmatched = await pool.fetch(
        "SELECT id, amount, statement_date, reference FROM staging.ganit_bank_statement_lines "
        "WHERE org_id=$1::uuid AND batch_id=$2 AND is_reconciled=FALSE",
        org_id, batch_id,
    )
    for row in unmatched:
        payment = await pool.fetchrow(
            "SELECT id FROM staging.ganit_payments "
            "WHERE org_id=$1::uuid AND amount=$2 AND payment_date=$3::date "
            "AND id NOT IN (SELECT matched_payment_id FROM staging.ganit_bank_statement_lines "
            "WHERE org_id=$1::uuid AND matched_payment_id IS NOT NULL) "
            "LIMIT 1",
            org_id, row["amount"], row["statement_date"],
        )
        if payment:
            await pool.execute(
                "UPDATE staging.ganit_bank_statement_lines "
                "SET matched_payment_id=$1, matched_type='auto', is_reconciled=TRUE "
                "WHERE id=$2::uuid",
                payment["id"], row["id"],
            )
            auto_matched += 1

    return {"ok": True, "imported": imported, "auto_matched": auto_matched, "batch_id": batch_id}


@router.get("/bank-statements")
async def list_bank_statements(
    reconciled: str = "",
    batch_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = ("SELECT *, COUNT(*) OVER() AS _total "
         "FROM staging.ganit_bank_statement_lines WHERE org_id=$1::uuid")
    params: list = [org_id]
    if reconciled == "true":
        q += " AND is_reconciled=TRUE"
    elif reconciled == "false":
        q += " AND is_reconciled=FALSE"
    if batch_id:
        params.append(batch_id)
        q += f" AND batch_id=${len(params)}"
    q += " ORDER BY statement_date DESC, created_at DESC LIMIT 500"
    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=500)


@router.post("/bank-statements/{line_id}/match")
async def match_bank_line(
    line_id: str,
    payment_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    line = await pool.fetchrow(
        "SELECT id FROM staging.ganit_bank_statement_lines "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        line_id, org_id,
    )
    if not line:
        raise HTTPException(404, "Statement line not found")
    payment = await pool.fetchrow(
        "SELECT id FROM staging.ganit_payments WHERE id=$1::uuid AND org_id=$2::uuid",
        payment_id, org_id,
    )
    if not payment:
        raise HTTPException(404, "Payment not found")
    await pool.execute(
        "UPDATE staging.ganit_bank_statement_lines "
        "SET matched_payment_id=$1::uuid, matched_type='manual', is_reconciled=TRUE "
        "WHERE id=$2::uuid",
        payment_id, line_id,
    )
    return {"ok": True}


@router.post("/bank-statements/{line_id}/unmatch")
async def unmatch_bank_line(
    line_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE staging.ganit_bank_statement_lines "
        "SET matched_payment_id=NULL, matched_type=NULL, is_reconciled=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        line_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Statement line not found")
    return {"ok": True}


@router.get("/bank-statements/stats")
async def bank_reconciliation_stats(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT "
        "COUNT(*) AS total_lines, "
        "COUNT(*) FILTER (WHERE is_reconciled=TRUE) AS matched, "
        "COUNT(*) FILTER (WHERE is_reconciled=FALSE) AS unmatched, "
        "COALESCE(SUM(amount) FILTER (WHERE is_reconciled=TRUE), 0) AS matched_amount, "
        "COALESCE(SUM(amount) FILTER (WHERE is_reconciled=FALSE), 0) AS unmatched_amount "
        "FROM staging.ganit_bank_statement_lines WHERE org_id=$1::uuid",
        org_id,
    )
    return dict(row) if row else {}


# ── Timesheet → Invoice Bridge ─────────────────────────────

class TimesheetInvoiceCreate(BaseModel):
    employee_ids: list[str] = []
    date_from: str = ""
    date_to: str = ""
    contact_id: str = ""
    is_igst: bool = False
    #: SAC for the billed time. Rule 46(g) requires a code on every line of a
    #: tax invoice, and billed hours are a SERVICE, so it is a SAC rather than an
    #: HSN. Optional and never guessed — 9983 ("other professional, technical and
    #: business services") fits most firms and is wrong for some, and a wrong
    #: code on a filed invoice is the firm's problem, not ours. Supplied → the
    #: draft is complete and one click from final. Omitted → the draft carries
    #: the gap and says so.
    sac_code: str = ""


@router.post("/invoices/from-time-entries")
async def create_invoice_from_time_entries(
    body: TimesheetInvoiceCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # `time_entries` is a production-schema table with no org_id, so its scoping
    # has to come through a join to a parent that has one. Two things were wrong
    # with how that was done.
    #
    # 1. The only parent joined was `manav_employees`, on user_id — which scopes
    #    by WHO LOGGED the entry, not by which org the WORK belongs to. A
    #    contractor who is an employee row in two orgs had every entry they ever
    #    logged, in either org, swept into whichever org billed first.
    #
    # 2. The entry's real parent is the task, and through it the team and the
    #    org. That path was not joined at all, so nothing tied the entry to the
    #    billing org's work.
    #
    # Both parents are now required: the entry must belong to a task in one of
    # this org's teams AND be logged by someone this org employs.
    q = (
        "SELECT te.entry_id, te.task_id, te.minutes, te.description, te.user_id, "
        "e.name AS employee_name, e.hourly_rate "
        "FROM time_entries te "
        "JOIN tasks tk ON tk.task_id = te.task_id "
        "JOIN teams tm ON tm.team_id = tk.team_id "
        "JOIN staging.manav_employees e "
        "  ON e.user_id::text = te.user_id AND e.org_id = tm.org_id "
        "WHERE tm.org_id=$1::uuid AND te.is_billed=FALSE "
        "AND te.minutes IS NOT NULL AND te.minutes > 0"
    )
    params: list = [org_id]

    if body.employee_ids:
        employee_clause = ", ".join(f"${i+2}::uuid" for i in range(len(body.employee_ids)))
        params.extend(body.employee_ids)
        q += f" AND e.id IN ({employee_clause})"

    if body.date_from:
        params.append(body.date_from)
        q += f" AND te.started_at >= ${len(params)}::date"
    if body.date_to:
        params.append(body.date_to)
        q += f" AND te.started_at <= ${len(params)}::date + INTERVAL '1 day'"

    entries = await pool.fetch(q, *params)
    if not entries:
        raise HTTPException(400, "No unbilled time entries found")

    line_items = []
    entry_ids = []
    for e in entries:
        hours = round(e["minutes"] / 60, 2)
        rate = float(e["hourly_rate"]) if e["hourly_rate"] else 0
        desc = f"{e['employee_name']}: {e['description'] or 'Time entry'} ({hours}h)"
        line_items.append(LineItem(
            description=desc,
            hsn_code=body.sac_code,
            sac_code=body.sac_code,
            quantity=hours,
            rate=rate,
            gst_rate=18.0,
        ))
        entry_ids.append(e["entry_id"])

    computed = _compute_invoice(line_items, body.is_igst, 0)
    inv_number = await _next_invoice_number(pool, org_id, "INV")
    inv_date = date.today()

    # This one is written as a DRAFT rather than gated, and the distinction is
    # the point. The other tax-invoice routes are gated because they are handed
    # a complete document and can refuse an incomplete one. This route ASSEMBLES
    # a document out of hours worked, and two Rule 46 fields simply are not in
    # the timesheet: the SAC for the service (unless the caller supplied one
    # above) and, often, the customer to bill. Gating would refuse every call
    # and the feature would be dead; defaulting the SAC would put a guessed tax
    # code on a filed return.
    #
    # A draft is the honest third option: nothing is invented, no serial is
    # burned on a lie, and the existing draft-to-final gate on PATCH /status
    # catches the gaps at the moment the firm actually issues the document —
    # with the invoice open in front of them, which is where the fields get
    # filled anyway. Same choice `from-deal` already makes.

    async with pool.acquire() as conn:
        async with conn.transaction():
            inv = await conn.fetchrow(
                "INSERT INTO staging.ganit_invoices "
                "(org_id, contact_id, invoice_number, invoice_type, invoice_date, "
                "is_igst, line_items, subtotal, cgst, sgst, igst, discount, total, "
                "balance_due, doc_status, notes, created_by) "
                "VALUES ($1::uuid, NULLIF($2,'')::uuid, $3, 'tax_invoice', $4::date, "
                "$5, $6::jsonb, $7, $8, $9, $10, 0, $11, $11, 'draft', "
                "'Generated from time entries', $12) "
                "RETURNING id, invoice_number, total",
                org_id, body.contact_id, inv_number, inv_date, body.is_igst,
                json.dumps(computed["line_items"]),
                computed["subtotal"], computed["cgst"], computed["sgst"], computed["igst"],
                computed["total"], user["user_id"],
            )

            # `staging.time_entries` does not exist and never has — the table is
            # `time_entries` in the production schema (migration 007, 042). The
            # UPDATE therefore raised UndefinedTable inside the transaction and
            # rolled the invoice back with it, so this endpoint returned 500 on
            # every call and had never once billed anything.
            #
            # Fixing the name is what makes the is_billed flag real, and that
            # flag is the only thing standing between this endpoint and billing
            # the same hours twice.
            for eid in entry_ids:
                await conn.execute(
                    "UPDATE time_entries SET is_billed=TRUE, invoice_id=$1 WHERE entry_id=$2",
                    inv["id"], eid,
                )

    return {
        "ok": True,
        "invoice_id": str(inv["id"]),
        "invoice_number": inv["invoice_number"],
        "total": float(inv["total"]),
        "entries_billed": len(entry_ids),
    }
