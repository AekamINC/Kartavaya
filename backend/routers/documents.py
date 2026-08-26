"""documents.py — download endpoints for the generated document set.

`design-reference/Kartavaya Redesign/docs/` specifies nine documents. The tax
invoice and the payslip already have endpoints, on the modules that own their
data (`ganit.download_invoice_pdf`, `vetana.download_payslip_pdf`). These are
the other five, plus the project report.

Every route follows those two exactly: `require_user` for auth, the module gate
for entitlement, `get_org_id` for tenancy, and `DocumentIncomplete` translated
to a 422 that names every missing field so the UI can point at the setting that
fixes it. Nothing here writes, and nothing here sends: a document is generated
as bytes and returned on the response. Emailing one is a separate action on a
separate path, and `OUTBOUND_MODE` gates that path, not this one.

They live in one module rather than being spread across `ganit.py` because
three of them draw on more than one module's tables — the statement joins
invoices to payments and contacts, the challan joins Ganit to Vetana, and the
project report joins boards and time entries to invoices.

Data that does not exist
------------------------
**Re-verified against the live catalog 2026-07-27, after the migration landed.**
Read this section sceptically: an earlier version of it said `statement_pdf.py`
and `tds_challan_pdf.py` were "NOT BUILT" when both existed, and that stale
sentence is the likeliest reason nothing called them for weeks. Check the
catalog before believing any claim here, including this one.

`PROPOSED_documents.sql` **HAS been applied** — in `documents_tan_and_challans`
and `documents_supply_flags_and_org_fields`. So these now EXIST:
`organisations.tan`, `ganit_tds_challans`, `ganit_vendor_bills.cess` and
`.is_reverse_charge`, `ganit_invoices.supply_nature` and the quotation columns,
`project_milestones`, `project_risks`, `project_baselines`.

What that does and does not change:

  * **TDS challan** — the store now exists, but **nothing reads or writes
    `ganit_tds_challans` yet**. The route still takes the bank's particulars in
    the request body, which is where they come from anyway (off the counterfoil
    the bank issues), and still derives only the 192B salary line from
    `staging.vetana_payslips`. TAN reads the column, falling back to
    `organisations.settings` for orgs recorded before the column existed.
  * **GSTR-3B** — the flag columns exist but no UI writes them, so reverse
    charge, nil/exempt, non-GST and the ITC reversal rows are still accepted as
    request overrides and still default to nil. The document STATES that rather
    than printing ₹0, because a zero asserts no such liability arose.
  * **Project report** — `project_milestones`, `project_risks` and
    `project_baselines` exist and **are not read yet**, so the report still
    prints its "no milestone store" advisory. There is still no `projects`
    table; two files under `services/skills/data/` join one that does not exist.

Staging and production share one Supabase project, so every one of those
statements is about production too.
"""

from __future__ import annotations
import asyncio

import json
import logging
import traceback
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.doc_validation import DocumentIncomplete

# The GSTR-3B working paper, its pre-filing checks and the org loader now live
# in services/gst_period.py. They moved because a SKILL handler needs them and
# a skill cannot import from a router — that drags HTTPException and the whole
# request stack into a path that has no request. Imported back under their
# original private names so every call site below is unchanged, and so there
# stays exactly ONE implementation of Table 3.1.
from services.gst_period import (  # noqa: E402
    Gstr3bOverrides,
    _ORG_COLS,
    assemble_gstr3b as _assemble_gstr3b,
    load_org as _load_org,
    period_bounds as _period_bounds,
    prefiling_checks as _prefiling_checks,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

_ganit = require_module("ganit")





def _parse_contact(row: dict, prefix: str = "contact_") -> dict:
    contact = {
        key[len(prefix):]: row.pop(key)
        for key in list(row)
        if key.startswith(prefix)
    }
    if isinstance(contact.get("billing_address"), str):
        try:
            contact["billing_address"] = json.loads(contact["billing_address"] or "{}")
        except json.JSONDecodeError:
            contact["billing_address"] = {}
    return contact


def _pdf_response(pdf_bytes: bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _refuse(document: str, exc: DocumentIncomplete, **ctx) -> HTTPException:
    """422, naming every missing field.

    Not a server failure: the document is incomplete and we refuse to emit one
    that looks finished. The same reasoning and the same status
    `download_invoice_pdf` uses.
    """
    logger.info(
        "%s PDF refused as incomplete: %s missing=%s",
        document, ctx, [g.field for g in exc.check.blocking],
    )
    return HTTPException(422, detail=exc.as_payload())


def _failed(document: str, exc: Exception, **ctx) -> HTTPException:
    logger.error(
        "%s PDF generation failed: %s err=%s\n%s",
        document, ctx, exc, traceback.format_exc(),
    )
    return HTTPException(500, f"Failed to generate the {document} PDF — please try again.")


# ══════════════════════════════════════════════════════════════════════════════
# Quotation
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/quotations/{invoice_id}/pdf")
async def download_quotation_pdf(
    invoice_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """A quotation rendered against its OWN specification.

    Previously a quotation went through `invoice_pdf.py` with the word
    "Quotation" swapped into the title, which produced a tax invoice wearing
    another name — an HSN column no offer needs, no validity date, no payment
    schedule, and the SUPPLIER's signature where the design has the client's
    acceptance block. `services/quotation_pdf.py` records the full list.
    """
    from services.quotation_pdf import generate_quotation_pdf

    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT i.*, c.name AS contact_name, c.email AS contact_email, "
        "c.company AS contact_company, c.gstin AS contact_gstin, "
        "c.designation AS contact_designation, "
        "c.billing_address AS contact_billing_address "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.id=$1::uuid AND i.org_id=$2::uuid AND i.is_active",
        str(invoice_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Quotation not found")

    invoice = dict(row)
    if (invoice.get("invoice_type") or "") not in ("quotation", "proforma"):
        # 409 rather than 404: the record exists, it is simply not an offer, and
        # rendering a tax invoice through the quotation template would drop the
        # Rule 46 particulars that make it a tax document.
        raise HTTPException(
            409,
            f"{invoice.get('invoice_number', 'This document')} is a "
            f"{(invoice.get('invoice_type') or 'document').replace('_', ' ')}, not a "
            "quotation. Download it from the invoice route so the tax-invoice "
            "particulars are rendered.",
        )

    if isinstance(invoice.get("line_items"), str):
        invoice["line_items"] = json.loads(invoice["line_items"] or "[]")
    contact = _parse_contact(invoice)

    for li in invoice.get("line_items") or []:
        # `line_total` is what the design's Amount column prints. Older rows
        # stored `amount`; neither is recomputed here, because a quotation that
        # has been SENT must render the figures it was sent with.
        if li.get("line_total") is None:
            li["line_total"] = li.get("amount") or 0

    quote = {
        "quote_number": invoice.get("invoice_number"),
        "quote_date": invoice.get("invoice_date"),
        "valid_until": invoice.get("due_date"),
        "reference": invoice.get("notes") or "",
        "scope_summary": invoice.get("terms") or "",
        "line_items": invoice.get("line_items") or [],
        "subtotal": invoice.get("subtotal"),
        "discount": invoice.get("discount"),
        "is_igst": invoice.get("is_igst"),
        "igst": invoice.get("igst"),
        "cgst": invoice.get("cgst"),
        "sgst": invoice.get("sgst"),
        "currency": invoice.get("currency") or "INR",
        # `prepared_by`, the payment schedule and the numbered terms have no
        # columns. The validator raises an advisory naming each rather than the
        # renderer inventing a schedule a client might rely on.
        "prepared_by": "",
        "payment_schedule": [],
        "terms": [],
    }

    org = await _load_org(pool, org_id)
    try:
        pdf = generate_quotation_pdf(quote, org, contact)
    except DocumentIncomplete as e:
        raise _refuse("quotation", e, invoice_id=str(invoice_id), org=org_id) from e
    except Exception as e:
        raise _failed("quotation", e, invoice_id=str(invoice_id), org=org_id) from e

    return _pdf_response(pdf, f"{quote['quote_number'] or 'quotation'}.pdf")


# ══════════════════════════════════════════════════════════════════════════════
# Statement of account
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/contacts/{contact_id}/statement/pdf")
async def download_statement_pdf(
    contact_id: UUID,
    period_start: str = Query(..., description="ISO date, inclusive"),
    period_end: str = Query(..., description="ISO date, inclusive"),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """The ledger for one account over one period, with ageing.

    The opening balance is computed from everything BEFORE `period_start`, so
    the statement ties to the account's whole history rather than only to the
    window it prints. A statement whose opening balance is assumed to be zero
    understates the debt and is the single most common way this document
    misleads.
    """
    from services.statement_pdf import age_receivables, generate_statement_pdf

    for label, value in (("period_start", period_start), ("period_end", period_end)):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise HTTPException(400, f"{label} must be an ISO date (YYYY-MM-DD)")
    if period_start > period_end:
        raise HTTPException(400, "period_start is after period_end")

    pool = await get_pool()
    contact_row = await pool.fetchrow(
        "SELECT name, company, email, gstin, billing_address "
        "FROM staging.graha_contacts WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contact_id), org_id,
    )
    if not contact_row:
        raise HTTPException(404, "Contact not found")
    contact = dict(contact_row)
    if isinstance(contact.get("billing_address"), str):
        contact["billing_address"] = json.loads(contact["billing_address"] or "{}")

    # ── WHY EVERY QUERY BELOW EXCLUDES DRAFTS ────────────────────────────────
    # A draft invoice is a document that has NOT been issued to anybody. This
    # statement is the one document in the product that goes TO the customer
    # and asks them for money, so a draft printed here dunned a client for a
    # sum they were never billed. Measured live 2026-08-25 across the whole
    # table: 79 draft rows, Rs 1,16,41,312.46, all of them `tax_invoice`.
    #
    # `COALESCE(doc_status, '')` and not `doc_status <> 'draft'` — the canonical
    # form from `services/gst_period.py`. The column is nullable and
    # NULL <> 'draft' is NULL, which would drop every invoice predating the
    # column: the same bug pointed the other way. Live today there are zero
    # NULL rows, so the two forms agree on every existing row and the COALESCE
    # is the guard for the ones that do not exist yet.
    #
    # It goes on ALL FIVE reads, not only the entry list, because a statement
    # has to tie. Excluding a draft from the debits while its payment stayed a
    # credit would show the client a credit balance they do not hold — live
    # there are 2 such payments on the statement path, Rs 2,07,090. Removing
    # the document removes its whole ledger footprint or it removes nothing.
    _NOT_DRAFT = "AND COALESCE(doc_status, '') <> 'draft' "
    _NOT_DRAFT_I = "AND COALESCE(i.doc_status, '') <> 'draft' "

    # ── AND WHY EVERY DATE IS CAST TWICE: `$3::text::date` ───────────────────
    # `period_start` and `period_end` arrive as ISO STRINGS off the query
    # string. A bare `$3::date` makes Postgres infer the parameter as `date`,
    # and asyncpg then refuses the bind outright:
    #
    #   DataError: invalid input for query argument $3: '2026-01-01'
    #              ('str' object has no attribute 'toordinal')
    #
    # So this route raised on its FIRST query and had never rendered a
    # statement at all — measured live 2026-08-25 against the query as it then
    # stood. The draft leak below it was real but unreachable, which is exactly
    # why a filter fix alone could not be demonstrated.
    #
    # `::text::date` makes the parameter infer as `text` and casts server-side,
    # which is what `_tally_rows`, `_build_gstr1` and every query in
    # `services/gst_period.py` already do. Nothing about the comparison changes.

    # Opening balance: invoices raised less payments received, both strictly
    # before the window. Cancelled invoices are excluded — a cancelled tax
    # document is not a receivable.
    opening_invoiced = await pool.fetchval(
        "SELECT COALESCE(SUM(total), 0) FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND contact_id=$2::uuid AND is_active "
        "AND cancelled_at IS NULL AND invoice_type IN ('tax_invoice','debit_note') "
        + _NOT_DRAFT +
        "AND invoice_date < $3::text::date",
        org_id, str(contact_id), period_start,
    ) or 0
    opening_credited = await pool.fetchval(
        "SELECT COALESCE(SUM(total), 0) FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND contact_id=$2::uuid AND is_active "
        "AND cancelled_at IS NULL AND invoice_type = 'credit_note' "
        + _NOT_DRAFT +
        "AND invoice_date < $3::text::date",
        org_id, str(contact_id), period_start,
    ) or 0
    opening_paid = await pool.fetchval(
        "SELECT COALESCE(SUM(p.amount), 0) FROM staging.ganit_payments p "
        "JOIN staging.ganit_invoices i ON i.id = p.invoice_id "
        "WHERE p.org_id=$1::uuid AND i.contact_id=$2::uuid "
        + _NOT_DRAFT_I +
        "AND p.payment_date < $3::text::date",
        org_id, str(contact_id), period_start,
    ) or 0
    opening = float(opening_invoiced) - float(opening_credited) - float(opening_paid)

    invoices = await pool.fetch(
        "SELECT invoice_number, invoice_type, invoice_date, due_date, total, "
        "balance_due, notes FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND contact_id=$2::uuid AND is_active "
        "AND cancelled_at IS NULL "
        + _NOT_DRAFT +
        "AND invoice_date BETWEEN $3::text::date AND $4::text::date "
        "ORDER BY invoice_date, invoice_number",
        org_id, str(contact_id), period_start, period_end,
    )
    payments = await pool.fetch(
        "SELECT p.payment_date, p.amount, p.payment_method, p.reference, "
        "i.invoice_number FROM staging.ganit_payments p "
        "JOIN staging.ganit_invoices i ON i.id = p.invoice_id "
        "WHERE p.org_id=$1::uuid AND i.contact_id=$2::uuid "
        + _NOT_DRAFT_I +
        "AND p.payment_date BETWEEN $3::text::date AND $4::text::date "
        "ORDER BY p.payment_date",
        org_id, str(contact_id), period_start, period_end,
    )

    entries = []
    for inv in invoices:
        # A credit note reduces the receivable, so it is a CREDIT on the
        # statement even though it is an outward document.
        is_credit = (inv["invoice_type"] or "") == "credit_note"
        entries.append({
            "date": inv["invoice_date"],
            "document": inv["invoice_number"],
            "particulars": inv["notes"] or {
                "credit_note": "Credit note", "debit_note": "Debit note",
            }.get(inv["invoice_type"] or "", "Invoice"),
            "credit" if is_credit else "debit": float(inv["total"] or 0),
        })
    for pay in payments:
        method = (pay["payment_method"] or "").strip()
        entries.append({
            "date": pay["payment_date"],
            "document": pay["reference"] or pay["invoice_number"],
            "particulars": "Payment received" + (f" — {method}" if method else ""),
            "credit": float(pay["amount"] or 0),
        })
    entries.sort(key=lambda e: (str(e["date"]), str(e.get("document") or "")))

    open_items = [
        {"balance_due": float(i["balance_due"] or 0), "due_date": i["due_date"],
         "date": i["invoice_date"]}
        for i in invoices if (i["invoice_type"] or "") != "credit_note"
    ]
    ageing = age_receivables(open_items, as_at=period_end)

    org = await _load_org(pool, org_id)
    settings = org.get("settings") or {}
    statement = {
        "statement_number": f"SOA-{str(contact_id)[:8].upper()}-{period_end.replace('-', '')}",
        "period_start": period_start,
        "period_end": period_end,
        "opening_balance": opening,
        "entries": entries,
        "ageing": ageing,
        "currency": "INR",
        # A claim about the issuer's own registration, made on a document that
        # lands in a buyer's tax file. Never assumed — see `statement_pdf`.
        "msme_registered": bool(isinstance(settings, dict) and settings.get("msme_registered")),
    }

    try:
        pdf = generate_statement_pdf(statement, org, contact)
    except DocumentIncomplete as e:
        raise _refuse("statement", e, contact_id=str(contact_id), org=org_id) from e
    except Exception as e:
        raise _failed("statement", e, contact_id=str(contact_id), org=org_id) from e

    return _pdf_response(pdf, f"{statement['statement_number']}.pdf")


# ══════════════════════════════════════════════════════════════════════════════
# GSTR-3B working paper
# ══════════════════════════════════════════════════════════════════════════════





@router.post("/gst/gstr3b/{period}/pdf")
async def download_gstr3b_pdf(
    period: str,
    overrides: Gstr3bOverrides = Body(default_factory=Gstr3bOverrides),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """The GSTR-3B working paper for one tax period.

    POST rather than GET because the rows the schema cannot supply come in the
    body. Nothing is written; the verb reflects the payload, not a side effect.

    Table 3.1(a) and (b) are computed from `ganit_invoices`, and 4(A) "all other
    ITC" from `ganit_vendor_bills`. Everything else has no column and arrives as
    an override. Invoices missing an HSN or SAC on any line are HELD BACK and
    named on the face of the paper — the behaviour `doc_validation`'s docstring
    cites the design for, and the reason this document is worth generating at
    all for a CA firm.
    """
    from services.gstr3b_pdf import generate_gstr3b_pdf

    try:
        datetime.strptime(period, "%Y-%m")
    except (ValueError, TypeError):
        raise HTTPException(400, "period must be YYYY-MM")

    pool = await get_pool()
    gstr, org = await _assemble_gstr3b(pool, org_id, period, overrides)

    try:
        pdf = await asyncio.to_thread(generate_gstr3b_pdf, gstr, org)
    except DocumentIncomplete as e:
        raise _refuse("GSTR-3B", e, period=period, org=org_id) from e
    except Exception as e:
        raise _failed("GSTR-3B", e, period=period, org=org_id) from e

    return _pdf_response(pdf, f"GSTR-3B-{period}.pdf")




@router.get("/gst/gstr3b/{period}")
async def gstr3b_summary(
    period: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """The working paper's figures as JSON, for the filing screen.

    A GET sibling of the POST above, reading the same `_assemble_gstr3b` and the
    same `gstr3b_pdf.compute`, so the screen and the document can never state
    different tax. Nothing is written and nothing is sent.

    The override rows stay at their defaults here because a GET carries no body.
    That is not a silent nil: `not_recorded` names every row Kartavaya has no
    store for, so the screen can say the row is unrecorded rather than paint a
    confident zero. Reverse charge, nil/exempt, non-GST and every ITC reversal
    are in that list — see `Gstr3bOverrides`.
    """
    from services.gstr3b_pdf import HEADS, compute, statutory_due_date

    try:
        datetime.strptime(period, "%Y-%m")
    except (ValueError, TypeError):
        raise HTTPException(400, "period must be YYYY-MM")

    pool = await get_pool()
    gstr, org = await _assemble_gstr3b(pool, org_id, period, Gstr3bOverrides())
    computed = compute(gstr)
    checks = await _prefiling_checks(pool, org_id, period, gstr, org)

    def _tax(block: dict) -> int:
        return sum(int(round(float(block.get(h) or 0))) for h in HEADS)

    return {
        "period": period,
        "due_date": statutory_due_date(period),
        "state_label": gstr.get("state_label") or "",
        "gstin": org.get("gstin") or "",
        "outward_count": gstr.get("outward_count", 0),
        "inward_count": gstr.get("inward_count", 0),
        # The four rows the design's summary panel prints, each as
        # {taxable, tax}. `taxable` is nil where the row carries no value.
        "rows": [
            {"key": "outward_taxable", "label": "Outward taxable supplies",
             "taxable": int(round(float(gstr["outward_taxable"].get("taxable") or 0))),
             "tax": _tax(gstr["outward_taxable"]), "recorded": True},
            {"key": "outward_zero_rated", "label": "Zero-rated supplies (exports)",
             "taxable": int(round(float(gstr["outward_zero_rated"].get("taxable") or 0))),
             "tax": _tax(gstr["outward_zero_rated"]), "recorded": True},
            {"key": "inward_reverse_charge", "label": "Inward supplies (reverse charge)",
             "taxable": int(round(float((gstr.get("inward_reverse_charge") or {}).get("taxable") or 0))),
             "tax": _tax(gstr.get("inward_reverse_charge") or {}), "recorded": False},
            {"key": "net_itc", "label": "Eligible ITC",
             "taxable": None, "tax": sum(computed["net_itc"][h] for h in HEADS),
             "recorded": True},
            {"key": "total_cash", "label": "Net tax payable in cash",
             "taxable": None, "tax": computed["total_cash"], "recorded": True},
        ],
        "totals": {
            "payable": computed["total_payable"],
            "via_itc": computed["total_itc"],
            "in_cash": computed["total_cash"],
        },
        #: Rows with no column anywhere in Kartavaya. The screen states these as
        #: unrecorded; it must never render them as a confident zero.
        "not_recorded": [
            "Inward supplies liable to reverse charge",
            "Nil-rated, exempt and non-GST outward supplies",
            "ITC on imports, ISD credit and reverse charge",
            "ITC reversals (rules 38/42/43 and section 17(5))",
        ],
        "checks": checks,
    }


# ══════════════════════════════════════════════════════════════════════════════
# TDS challan (ITNS-281)
# ══════════════════════════════════════════════════════════════════════════════

class TdsDeductionLine(BaseModel):
    section: str
    nature: str
    count: int = 0
    amount_paid: float = 0
    rate: float | None = None
    tds: float = 0
    note: str = ""


class TdsChallanBody(BaseModel):
    """The bank's own challan particulars.

    None of these has a column. They are transcribed off the counterfoil the
    bank issues, which is where a preparer gets them from in any case. See
    `PROPOSED_documents.sql` for the table that would let this become a GET.
    """

    challan_number: str = ""
    deposit_date: str
    major_head: str
    payment_type: str
    bsr_code: str
    challan_serial: str
    tender_date: str = ""
    bank_name: str = ""
    payment_method: str = ""
    #: Non-salary deductions (194C, 194J, 194I, 194H …). No store exists.
    deductions: list[TdsDeductionLine] = Field(default_factory=list)
    #: Set false to exclude the derived 192B salary line.
    include_salary_tds: bool = True
    amounts: dict = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


@router.post("/tds/challan/{period}/pdf")
async def download_tds_challan_pdf(
    period: str,
    body: TdsChallanBody,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """The ITNS-281 counterfoil for one deduction period.

    The 192B salary line is DERIVED from `staging.vetana_payslips` — the one
    part of this document Kartavaya actually holds. Everything else is supplied,
    because nothing stores it.

    The salary line reads the aggregate `tds` column only. It never reads an
    employee's PAN, name or bank details, so this route needs none of the
    unmasked-identity gating `vetana.download_payslip_pdf` applies: a period
    total is a book figure, not an identity document.
    """
    from services.tds_challan_pdf import generate_tds_challan_pdf

    try:
        datetime.strptime(period, "%Y-%m")
    except (ValueError, TypeError):
        raise HTTPException(400, "period must be YYYY-MM")

    pool = await get_pool()
    deductions = [d.model_dump() for d in body.deductions]

    if body.include_salary_tds:
        salary = await pool.fetchrow(
            "SELECT COALESCE(SUM(tds), 0) AS tds, COALESCE(SUM(gross), 0) AS gross, "
            "COUNT(*) AS n FROM staging.vetana_payslips "
            "WHERE org_id=$1::uuid AND month=$2 AND is_active AND tds > 0",
            org_id, period,
        )
        if salary and float(salary["tds"] or 0) > 0:
            deductions.append({
                "section": "192B",
                "nature": "Salary — non-government employees",
                "note": f"{int(salary['n'])} employees, computed in Vetana",
                "count": int(salary["n"]),
                "amount_paid": float(salary["gross"] or 0),
                # Section 192(1) — deducted at the employee's own average rate,
                # not at a section rate. A single percentage here would be wrong
                # for every employee, so the column stays empty.
                "rate": None,
                "tds": float(salary["tds"] or 0),
            })

    amounts = dict(body.amounts or {})
    if not amounts:
        # Default the income-tax head to what the lines total, so a challan with
        # no surcharge, cess, interest or penalty reconciles without the caller
        # restating a figure the lines already carry. Anything else must be
        # stated — the validator refuses a breakdown that does not tie.
        amounts = {"income_tax": sum(float(d.get("tds") or 0) for d in deductions)}

    challan = {
        "period": period,
        "challan_number": body.challan_number,
        "deposit_date": body.deposit_date,
        "major_head": body.major_head,
        "payment_type": body.payment_type,
        "bsr_code": body.bsr_code,
        "challan_serial": body.challan_serial,
        "tender_date": body.tender_date or body.deposit_date,
        "bank_name": body.bank_name,
        "payment_method": body.payment_method,
        "deductions": deductions,
        "amounts": amounts,
        "notes": body.notes,
    }

    org = await _load_org(pool, org_id)
    try:
        pdf = generate_tds_challan_pdf(challan, org)
    except DocumentIncomplete as e:
        raise _refuse("TDS challan", e, period=period, org=org_id) from e
    except Exception as e:
        raise _failed("TDS challan", e, period=period, org=org_id) from e

    return _pdf_response(pdf, f"TDS-{body.challan_number or period}.pdf")


# ══════════════════════════════════════════════════════════════════════════════
# Service agreement
# ══════════════════════════════════════════════════════════════════════════════

class AgreementBody(BaseModel):
    """Clause values `staging.ganit_contracts` has no columns for.

    The contract row carries a title, a value, dates and a status. The design's
    clause set needs a scope, a milestone schedule, a governing seat and the
    notice periods. Those are supplied rather than defaulted: a generator that
    guessed an arbitration seat would send a dispute to the wrong forum.
    """

    scope: list[str] = Field(default_factory=list)
    client_obligations: list[str] = Field(default_factory=list)
    milestones: list[dict] = Field(default_factory=list)
    governing_law: str = ""
    governing_seat: str = ""
    place_of_supply: str = ""
    is_igst: bool = False
    gst_rate: float = 18
    payment_days: int = 30
    notice_days: int = 30
    cure_days: int = 15
    term_months: int | None = None
    provider_is_msme: bool = False
    tds_section: str = ""
    tds_rate: float | None = None
    project_ref: str = ""
    status_note: str = ""


@router.post("/contracts/{contract_id}/agreement/pdf")
async def download_agreement_pdf(
    contract_id: UUID,
    body: AgreementBody = Body(default_factory=AgreementBody),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """The two-page execution copy for a Ganit contract."""
    from services.agreement_pdf import generate_agreement_pdf

    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT k.*, c.name AS contact_name, c.company AS contact_company, "
        "c.gstin AS contact_gstin, c.designation AS contact_designation, "
        "c.billing_address AS contact_billing_address "
        "FROM staging.ganit_contracts k "
        "LEFT JOIN staging.graha_contacts c ON c.id = k.contact_id "
        "WHERE k.id=$1::uuid AND k.org_id=$2::uuid AND k.is_active",
        str(contract_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contract not found")

    contract = dict(row)
    contact = _parse_contact(contract)

    term_months = body.term_months
    if term_months is None and contract.get("start_date") and contract.get("end_date"):
        delta = contract["end_date"] - contract["start_date"]
        term_months = max(1, round(delta.days / 30.44))

    agreement = {
        "agreement_number": contract.get("title") and f"AGR-{str(contract_id)[:8].upper()}",
        "effective_date": contract.get("start_date"),
        "term_months": term_months or 12,
        "fee": contract.get("contract_value"),
        "scope": body.scope or ([contract["description"]] if contract.get("description") else []),
        "client_obligations": body.client_obligations or None,
        "milestones": body.milestones,
        "governing_law": body.governing_law,
        "governing_seat": body.governing_seat,
        "place_of_supply": body.place_of_supply,
        "is_igst": body.is_igst,
        "gst_rate": body.gst_rate,
        "payment_days": body.payment_days,
        "notice_days": body.notice_days,
        "cure_days": body.cure_days,
        "provider_is_msme": body.provider_is_msme,
        "tds_section": body.tds_section,
        "tds_rate": body.tds_rate,
        "project_ref": body.project_ref,
        "status_note": body.status_note or "",
    }
    if agreement["client_obligations"] is None:
        agreement.pop("client_obligations")

    org = await _load_org(pool, org_id)
    try:
        pdf = await asyncio.to_thread(generate_agreement_pdf, agreement, org, contact)
    except DocumentIncomplete as e:
        raise _refuse("service agreement", e, contract_id=str(contract_id), org=org_id) from e
    except Exception as e:
        raise _failed("service agreement", e, contract_id=str(contract_id), org=org_id) from e

    return _pdf_response(pdf, f"{agreement['agreement_number'] or 'agreement'}.pdf")


# ══════════════════════════════════════════════════════════════════════════════
# Project report
# ══════════════════════════════════════════════════════════════════════════════

class ProjectReportBody(BaseModel):
    """What no table holds: the plan side of every measure, the milestone
    schedule and the risk register. See the module docstring."""

    headline: str = ""
    prepared_by: str = ""
    overall_state: str = ""
    planned_hours: float | None = None
    planned_fee: float | None = None
    milestones: list[dict] = Field(default_factory=list)
    risks: list[dict] = Field(default_factory=list)
    decisions: list[dict] = Field(default_factory=list)
    milestone_note: str = ""
    client_contact_id: str = ""


@router.post("/projects/{board_id}/report/pdf")
async def download_project_report_pdf(
    board_id: str,
    period_start: str = Query(..., description="ISO date, inclusive"),
    period_end: str = Query(..., description="ISO date, inclusive"),
    body: ProjectReportBody = Body(default_factory=ProjectReportBody),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """A status report for one board over one period.

    No module gate: boards and tasks are core, not an add-on module, so gating
    this on Ganit would deny the report to an org that pays for tasks alone. It
    is still org-scoped — the board must belong to this org's team, which is the
    check that matters for tenancy.

    Measures are computed where a store exists (tasks, logged hours, fee
    invoiced) and the PLAN side of each comes from the body, because no baseline
    is recorded anywhere. A measure with no plan is reported as actual-only
    rather than against a plan of zero, which would show every project as
    catastrophically over.
    """
    from services.project_report_pdf import generate_project_report_pdf

    for label, value in (("period_start", period_start), ("period_end", period_end)):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except (ValueError, TypeError):
            raise HTTPException(400, f"{label} must be an ISO date (YYYY-MM-DD)")

    pool = await get_pool()
    team_id = await pool.fetchval(
        "SELECT team_id FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    if not team_id:
        raise HTTPException(404, "Organisation has no team")

    board = await pool.fetchrow(
        "SELECT board_id, name FROM public.boards WHERE board_id=$1 AND team_id=$2",
        board_id, team_id,
    )
    if not board:
        raise HTTPException(404, "Project board not found")

    open_tasks = await pool.fetchval(
        "SELECT COUNT(*) FROM public.tasks WHERE board_id=$1 AND team_id=$2 "
        "AND archived_at IS NULL AND status <> 'done'",
        board_id, team_id,
    ) or 0
    overdue_tasks = await pool.fetchval(
        "SELECT COUNT(*) FROM public.tasks WHERE board_id=$1 AND team_id=$2 "
        "AND archived_at IS NULL AND status <> 'done' AND due_at < NOW()",
        board_id, team_id,
    ) or 0
    minutes = await pool.fetchval(
        "SELECT COALESCE(SUM(t.minutes), 0) FROM staging.time_entries t "
        "JOIN public.tasks k ON k.task_id = t.task_id "
        "WHERE t.org_id=$1::uuid AND k.board_id=$2 "
        "AND t.started_at >= $3::text::date AND t.started_at < ($4::text::date + 1)",
        org_id, board_id, period_start, period_end,
    ) or 0
    hours = round(float(minutes) / 60, 1)

    client = {}
    fee_invoiced = 0.0
    if body.client_contact_id:
        contact_row = await pool.fetchrow(
            "SELECT name, company, designation FROM staging.graha_contacts "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            body.client_contact_id, org_id,
        )
        if contact_row:
            client = dict(contact_row)
            # Drafts excluded, and dated with the double cast, for the two
            # reasons written out in `download_statement_pdf` above: this is a
            # CLIENT-FACING measure ("Fee invoiced to date", printed beside the
            # planned fee), and the same 79 rows / Rs 1,16,41,312.46 matched
            # this predicate live on 2026-08-25.
            fee_invoiced = float(await pool.fetchval(
                "SELECT COALESCE(SUM(total), 0) FROM staging.ganit_invoices "
                "WHERE org_id=$1::uuid AND contact_id=$2::uuid AND is_active "
                "AND cancelled_at IS NULL AND invoice_type='tax_invoice' "
                "AND COALESCE(doc_status, '') <> 'draft' "
                "AND invoice_date <= $3::text::date",
                org_id, body.client_contact_id, period_end,
            ) or 0)

    def _measure(label: str, plan, actual, state: str, sub: str = "", unit: str = "") -> dict:
        # No baseline recorded -> report the actual alone. A plan of zero would
        # show every project as infinitely over.
        if plan is None:
            return {"label": label, "sub": sub, "numeric": False,
                    "plan": "—", "actual": actual, "variance": "—", "state": state}
        return {"label": label, "sub": sub, "numeric": True, "unit": unit,
                "plan": plan, "actual": actual, "variance": actual - plan, "state": state}

    measures = [
        _measure("Fee invoiced to date", body.planned_fee, fee_invoiced,
                 "On plan" if body.planned_fee in (None, fee_invoiced) else "Watch"),
        _measure("Hours consumed", body.planned_hours, hours,
                 "Over" if body.planned_hours is not None and hours > body.planned_hours
                 else "On plan", sub="Logged in Kartavya", unit="h"),
        _measure("Open tasks", None, open_tasks, "Watch" if open_tasks else "On plan"),
        _measure("Overdue tasks", None, overdue_tasks, "Late" if overdue_tasks else "On plan"),
    ]

    org = await _load_org(pool, org_id)
    report = {
        "report_number": f"RPT-{board_id[:8].upper()}",
        "project_name": board["name"],
        "period_start": period_start,
        "period_end": period_end,
        "as_at": period_end,
        "prepared_by": body.prepared_by,
        "prepared_on": date.today().isoformat(),
        "board_ref": board_id,
        "overall_state": body.overall_state,
        "headline": body.headline,
        "measures": measures,
        "milestones": body.milestones,
        "milestone_note": body.milestone_note,
        "risks": body.risks,
        "decisions": body.decisions,
    }

    try:
        pdf = generate_project_report_pdf(report, org, client)
    except DocumentIncomplete as e:
        raise _refuse("project report", e, board_id=board_id, org=org_id) from e
    except Exception as e:
        raise _failed("project report", e, board_id=board_id, org=org_id) from e

    return _pdf_response(pdf, f"{report['report_number']}.pdf")


# ══════════════════════════════════════════════════════════════════════════════
# Data exports — Tally XML and GSTR-1 JSON
# ══════════════════════════════════════════════════════════════════════════════
#
# These two are EXPORTS, not documents. The distinction matters and is the whole
# reason they exist in this shape:
#
#   · A document above is something the firm ISSUES — an invoice, a challan, a
#     statement — and `doc_validation` refuses to emit one that is legally
#     incomplete.
#   · An export is the firm's own data, handed to the firm's own software. It
#     asserts nothing. It is not a return, it is not a filing, and it does not
#     compute a liability anyone should rely on. Kartavaya is not a GSP; nothing
#     on either path contacts the GSTN, the IRP or any portal.
#
# Both are GET. An export READS — `middleware/subscription._is_write` treats GET
# as a read unconditionally, so a viewer entitled to see these figures can
# download them without being told to ask for Editor. Making either a POST would
# have needed an entry in `READ_SHAPED_POSTS`; not needing one is better.
#
# Both carry `_ganit` — the same `require_module("ganit")` gate as every route
# above — and both scope every query with `org_id=$1::uuid`. They join
# `graha_contacts` and `ganit_vendors` for the counterparty NAME and GSTIN,
# which is invoice data and the same join `download_invoice_pdf` and
# `_prefiling_checks` already make behind this gate.



def _refuse_export(kind: str, message: str, **detail) -> HTTPException:
    """422 for an export that would otherwise be an empty or misleading file.

    NOT `document_incomplete`: nothing here is being issued, and borrowing that
    payload would put "this document cannot be issued" in front of a user who
    asked for a data file. `describeDocumentError` renders `detail.message`
    under the caller's own title, which is the right shape for this.

    422 rather than 404 or 204: the request was understood and the range is real
    — there is simply nothing that can honestly be written, and a zero-byte or
    empty-envelope download is the one outcome this task exists to prevent.
    """
    return HTTPException(422, detail={"error": kind, "message": message, **detail})


# ── Tally ─────────────────────────────────────────────────────────────────────

_TALLY_INVOICE_COLS = (
    "i.invoice_number, i.invoice_type, i.invoice_date, i.is_igst, i.line_items, "
    "i.subtotal, i.cgst, i.sgst, i.igst, i.cess, i.discount, i.total, i.currency, "
    "c.name AS contact_name, c.company AS contact_company, c.gstin AS contact_gstin"
)

#: NO `b.is_igst` — **that column does not exist on `ganit_vendor_bills`**.
#: `VendorBillCreate` carries an `is_igst` field, but it is an input to
#: `_compute_invoice` that decides how the tax is split and is then discarded;
#: the row keeps only the resulting cgst/sgst/igst figures. Selecting it here
#: would raise `UndefinedColumnError` on every request. Checked against
#: `information_schema`, which is the only thing that actually knows.
_TALLY_BILL_COLS = (
    "b.bill_number, b.internal_ref, b.bill_date, b.line_items, "
    "b.subtotal, b.cgst, b.sgst, b.igst, b.cess, b.total, b.currency, "
    "b.is_reverse_charge, v.name AS vendor_name, v.gstin AS vendor_gstin"
)


async def _tally_rows(pool, org_id: str, start: str, end: str):
    """Sales-side and purchase-side rows for one date range.

    Drafts, cancellations and soft-deleted rows are excluded HERE rather than in
    the service, because they are a question about the store — is this row a
    document at all — and the service's job starts once it is. Quotations and
    proformas are excluded by the type filter: an offer is not a transaction.
    """
    invoices = await pool.fetch(
        f"SELECT {_TALLY_INVOICE_COLS} "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.org_id=$1::uuid AND i.is_active AND i.cancelled_at IS NULL "
        "AND COALESCE(i.payment_status, '') <> 'cancelled' "
        "AND COALESCE(i.doc_status, '') <> 'draft' "
        "AND i.invoice_type IN ('tax_invoice','credit_note','debit_note') "
        "AND i.invoice_date >= $2::text::date AND i.invoice_date < $3::text::date "
        "ORDER BY i.invoice_date, i.invoice_number",
        org_id, start, end,
    )
    bills = await pool.fetch(
        f"SELECT {_TALLY_BILL_COLS} "
        "FROM staging.ganit_vendor_bills b "
        "JOIN staging.ganit_vendors v ON v.id = b.vendor_id "
        "WHERE b.org_id=$1::uuid AND b.is_active "
        "AND COALESCE(b.status, '') <> 'cancelled' "
        "AND b.bill_date >= $2::text::date AND b.bill_date < $3::text::date "
        "ORDER BY b.bill_date, b.internal_ref",
        org_id, start, end,
    )
    return [dict(r) for r in invoices], [dict(r) for r in bills]


async def _build_tally(pool, org_id: str, period: str):
    from services.tally_xml import build_tally_xml

    start, end = _period_bounds(period)
    invoices, bills = await _tally_rows(pool, org_id, start, end)
    org = await _load_org(pool, org_id)
    return build_tally_xml(
        invoices, bills, org,
        period_from=start, period_to=end,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    )


@router.get("/tally/{period}/preview")
async def tally_export_preview(
    period: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """What the Tally file would contain, without producing it.

    Reads the SAME `build_tally_xml` the download does, so the screen cannot
    claim a voucher count the file does not have. The XML is built and dropped;
    a period is at most a few hundred vouchers, and a second build is cheaper
    than a second implementation that can disagree with the first.
    """
    pool = await get_pool()
    _xml, manifest = await _build_tally(pool, org_id, period)
    return manifest


@router.get("/tally/{period}")
async def download_tally_xml(
    period: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """Sales, credit note, debit note and purchase vouchers as Tally import XML.

    Refuses with 422 when the period produces no voucher. An export that answers
    200 with an empty `<REQUESTDATA/>` looks like a successful export of a month
    with no trade, and a firm that imports it learns nothing until the books do
    not tie.
    """
    pool = await get_pool()
    try:
        xml, manifest = await _build_tally(pool, org_id, period)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("tally export failed: period=%s org=%s err=%s\n%s",
                     period, org_id, e, traceback.format_exc())
        raise HTTPException(500, "Failed to build the Tally export — please try again.")

    if not manifest["voucher_count"]:
        held = manifest.get("held_back") or []
        detail = (
            f"{len(held)} document(s) in this period could not be exported: "
            + "; ".join(f"{h['document']} — {h['reason']}" for h in held[:5])
            if held else
            "There are no issued invoices or vendor bills in this period. Drafts, "
            "quotations, proformas and cancelled documents are never exported."
        )
        raise _refuse_export("export_empty",
                             f"Nothing to export for {period}. {detail}",
                             held_back=held)

    return Response(
        content=xml.encode("utf-8"),
        media_type="application/xml; charset=utf-8",
        headers={
            "Content-Disposition":
                f'attachment; filename="Kartavaya-Tally-{period}.xml"',
            # So a caller that only downloads still learns what was left out,
            # without parsing the comment block.
            "X-Kartavaya-Voucher-Count": str(manifest["voucher_count"]),
            "X-Kartavaya-Held-Back": str(len(manifest.get("held_back") or [])),
        },
    )


# ── GSTR-1 ────────────────────────────────────────────────────────────────────

_GSTR1_COLS = (
    "i.invoice_number, i.invoice_type, i.invoice_date, i.is_igst, i.is_export, "
    "i.place_of_supply, i.supply_nature, i.currency, i.line_items, "
    "i.subtotal, i.cgst, i.sgst, i.igst, i.cess, i.total, "
    "i.doc_status, i.payment_status, i.cancelled_at, i.is_active, "
    "c.gstin AS contact_gstin"
)


async def _build_gstr1(pool, org_id: str, period: str):
    """The GSTR-1 payload and its manifest for one period.

    EVERY document type in the period is fetched, including cancelled ones and
    drafts, because `doc_issue` reports the number SERIES — a series that
    silently skipped its cancelled numbers would read as full of holes, and the
    `cancel` column exists precisely to report them. The supply sections apply
    their own exclusions inside `build_gstr1`, which is also what produces the
    named list of what was left out.
    """
    from services.gstr1_json import build_gstr1

    start, end = _period_bounds(period)
    rows = await pool.fetch(
        f"SELECT {_GSTR1_COLS} "
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
        "WHERE i.org_id=$1::uuid AND i.is_active "
        "AND i.invoice_date >= $2::text::date AND i.invoice_date < $3::text::date "
        "ORDER BY i.invoice_date, i.invoice_number",
        org_id, start, end,
    )
    org = await _load_org(pool, org_id)

    # A GSTR-1 is data about supplies made under ONE registration. Without the
    # supplier's GSTIN there is no registration to attribute them to, and `gstin`
    # is the first field of the schema. Refused rather than emitted with an empty
    # string, which the offline utility would take and mis-file.
    if not str(org.get("gstin") or "").strip():
        raise _refuse_export(
            "supplier_gstin_missing",
            "Your organisation has no GSTIN on its company profile. GSTR-1 data "
            "is reported under one registration, so there is nothing to attribute "
            "these supplies to. Add it under Settings → Organisation → Company "
            "Profile, then export again.",
            fix="Settings → Organisation → Company Profile",
        )

    return build_gstr1([dict(r) for r in rows], org, period)


@router.get("/gst/gstr1/{period}/preview")
async def gstr1_export_preview(
    period: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """Which sections the file would carry, what was held back, and the tie-out.

    The same `build_gstr1` the download uses. The screen shows the omitted
    sections and their reasons from here rather than repeating them in JSX,
    because a reason that lives in two places is a reason that will eventually
    say two things.
    """
    pool = await get_pool()
    _payload, manifest = await _build_gstr1(pool, org_id, period)
    return manifest


@router.get("/gst/gstr1/{period}/json")
async def download_gstr1_json(
    period: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_ganit),
):
    """Outward-supply data in the GSTN offline-utility shape.

    NOT a return and not a filing. It is the firm's own invoice data in the
    layout its own GSTR-1 software reads; the firm prepares, checks and files
    from that software. Nothing here is uploaded and no liability is asserted.

    Refuses with 422 when no section can be filled — an export that answers 200
    with `{"gstin": "…", "fp": "072026"}` and nothing else is a file that says
    "this month had no outward supplies", which is a statement, and one nobody
    made.

    The body is the strict GSTN payload with NO Kartavaya keys added. A
    government utility validates what it is given, and an unrecognised top-level
    key is a risk taken with someone else's filing rather than ours — so the
    provenance rides on the filename and the response headers instead. That
    trade-off is deliberate and is recorded in the export report.
    """
    pool = await get_pool()
    try:
        payload, manifest = await _build_gstr1(pool, org_id, period)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("gstr1 export failed: period=%s org=%s err=%s\n%s",
                     period, org_id, e, traceback.format_exc())
        raise HTTPException(500, "Failed to build the GSTR-1 export — please try again.")

    if not manifest["sections_emitted"]:
        held = manifest.get("held_back") or []
        detail = (
            f"{len(held)} document(s) could not be reported: "
            + "; ".join(f"{h['document']} — {h['reason']}" for h in held[:5])
            if held else
            "No issued tax invoice in this period could be placed in a section "
            "this export carries."
        )
        raise _refuse_export("export_empty",
                             f"No GSTR-1 section can be filled for {period}. {detail}",
                             held_back=held)

    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition":
                f'attachment; filename="Kartavaya-GSTR1-data-{manifest["fp"]}.json"',
            "X-Kartavaya-Sections": ",".join(manifest["sections_emitted"]),
            "X-Kartavaya-Held-Back": str(len(manifest.get("held_back") or [])),
        },
    )
