#!/usr/bin/env python
"""render_documents.py — render every document this product defines, to files.

    python backend/scripts/render_documents.py [--out DIR]

Writes to `backend/.doc-harness/` by default (gitignored). The harness is
committed; its output is not.

What it produces, and why in two parts
--------------------------------------
The eight print documents exist at two different levels of reality, and a
harness that blurred them would be worse than none — it would suggest the
product generates eight documents when it generates two.

**Part A — the specification, as authored.** The eight design documents in
`design-reference/Kartavaya Redesign/docs/` are self-contained HTML on the
vendored `<doc-page>` web component. Each is emitted once per tenant with the
tenant baked in and the switcher removed, so a human opens `index.html`, clicks
through, and prints any of them to PDF from the browser. This is the design
authority: what the documents are SUPPOSED to look like, including the
`Nirmal Exports` tenant that has no GSTIN and must show the red blocker.

**Part B — what the product actually generates today.** Two documents, both
server-side WeasyPrint: the Ganit tax invoice and the Vetana payslip. Rendered
from fixtures to real PDFs, including the deliberately-incomplete cases, so the
refusal path is inspectable rather than described. Where a document is REFUSED,
the harness writes the refusal as a text file naming every blocking field —
that file is the artefact to inspect.

Part B needs WeasyPrint and its native stack (pango/cairo). Without it Part B is
skipped with a clear note and Part A still runs, so the harness is useful on a
developer machine that has no cairo.

The gap between A and B is the deliverable
------------------------------------------
`index.html` states, per document, whether it is spec-only or live. Six of the
eight are spec-only. That is the real status of this area and the harness should
not flatter it.
"""

from __future__ import annotations

import argparse
import base64
import re
import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
DOCS = REPO / "design-reference" / "Kartavaya Redesign" / "docs"

# document file → (live?, which module owns it)
#
# All eight are built now. This table said six of them were "not built" long
# after they shipped, and because Part B below only ever exercised the two it
# named, the harness that exists to SHOW what the product emits was hiding six
# documents. Six generators nobody had rendered is how the tax invoice kept
# printing `2026-07-08` and the service agreement kept stamping itself
# "Placeholder execution copy" — both found on 2026-08-06 by rendering them for
# the first time.
DOCUMENTS = {
    "Tax Invoice.html": (True, "Ganit — GET /api/ganit/invoices/{id}/pdf"),
    "Payslip.html": (True, "Vetana — GET /api/vetana/payslips/{id}/pdf"),
    "Quotation.html": (True, "Ganit — GET /api/ganit/quotations/{id}/pdf (quotation_pdf.py)"),
    "Statement of Account.html": (True, "Ganit — GET /api/ganit/contacts/{id}/statement/pdf"),
    "GSTR-3B Summary.html": (True, "Ganit — POST /api/ganit/gst/gstr3b/{period}/pdf"),
    "TDS Challan.html": (True, "Ganit — POST /api/ganit/tds/challan/{period}/pdf"),
    "Service Agreement.html": (True, "eSign — POST /api/esign/contracts/{id}/agreement/pdf"),
    "Project Report.html": (True, "Projects — POST /api/projects/{board_id}/report/pdf"),
}

TENANTS = ["aekam", "saraswati", "nirmal"]
TENANT_LABEL = {"aekam": "Aekam Inc", "saraswati": "Saraswati Textiles", "nirmal": "Nirmal Exports (no GSTIN)"}


# ── Part A ───────────────────────────────────────────────────────────────────

def inline_spec_document(src: Path, tenant: str, out_dir: Path) -> str:
    """Emit one design document with the tenant applied and no switcher.

    `brand.css`, `doc-page.js` and the logo stay as sibling files in the output
    directory rather than being inlined — 8 documents x 3 tenants x a 423 KB
    font is 10 MB of duplication for no gain, and a browser caches the shared
    files anyway.
    """
    html = src.read_text(encoding="utf-8")

    # Bake the tenant in: the switcher is a screen-only affordance for the
    # design file, meaningless once the document is exported per tenant.
    html = html.replace('<html lang="en" data-org="aekam">', f'<html lang="en" data-org="{tenant}">')
    html = re.sub(r'<div class="switcher">.*?</div>\s*(?=<doc-page|<div class="wrap")',
                  "", html, flags=re.DOTALL)
    # The trailing `applyOrg('aekam')` call is what paints the tenant fields.
    html = html.replace("applyOrg('aekam');", f"applyOrg('{tenant}');")

    out_name = f"{src.stem.replace(' ', '-').lower()}--{tenant}.html"
    (out_dir / out_name).write_text(html, encoding="utf-8")
    return out_name


def run_part_a(out_dir: Path) -> dict[str, dict[str, str]]:
    assets = ["brand.css", "doc-page.js", "logo-aekam.png"]
    for name in assets:
        src = DOCS / name
        if src.is_file():
            shutil.copy2(src, out_dir / name)

    produced: dict[str, dict[str, str]] = {}
    for doc in DOCUMENTS:
        src = DOCS / doc
        if not src.is_file():
            print(f"  ! missing spec document: {doc}", file=sys.stderr)
            continue
        produced[doc] = {t: inline_spec_document(src, t, out_dir) for t in TENANTS}
        print(f"  {doc} -> {len(TENANTS)} tenants")
    return produced


# ── Part B ───────────────────────────────────────────────────────────────────

def fixtures():
    """Representative data for all eight documents, including what must be refused.

    Nothing here is anyone's real address, number or pricing. Addresses use the
    reserved ranges (`simulator.amazonses.com` for a counterparty,
    `unicodegroup.com` where it has to read as the firm's own) and phones use
    the reserved `+91 99999xxxxx` block, so a fixture that escapes into a send
    path cannot reach a person. The counterparty used to be a named real
    company with its real domain; it is a demo firm now.
    """
    org_complete = {
        "name": "Aekam Inc", "gstin": "27AAACA1234M1Z8", "pan": "AAACA1234M",
        "tan": "MUMA12345B",
        "email": "info+accounts@unicodegroup.com", "phone": "+91 99999 10001",
        "website": "kartavaya.com",
        "billing_address": {"line1": "Unit 402, Meridien Tower", "line2": "Bandra Kurla Complex",
                            "city": "Mumbai", "state": "Maharashtra", "pincode": "400051", "country": "India"},
        "bank_details": {"account_name": "Aekam Inc", "account_number": "50200041824821",
                         "ifsc": "HDFC0000521", "bank_name": "Demo Bank", "branch": "Bandra Kurla Complex",
                         "upi_id": "aekam@demobank"},
        "invoice_note": "Thank you for your business.",
        "authorized_signatory_name": "Keval Shah", "authorized_signatory_designation": "Director",
    }
    # The tenant from the design spec that has no GSTIN. Its whole purpose is to
    # prove the document is refused rather than quietly issued.
    org_no_gstin = {**org_complete, "name": "Nirmal Exports", "gstin": ""}

    contact = {"name": "Meera Joshi", "company": "Vendor Demo Limited",
               "designation": "Procurement Head",
               "gstin": "27AAACT2727Q1ZW",
               "billing_address": {"line1": "1 Demo Street", "city": "Mumbai",
                                   "state": "Maharashtra", "pincode": "400001", "country": "India"},
               "email": "success+vendor@simulator.amazonses.com"}

    invoice = {
        "invoice_type": "tax_invoice", "invoice_number": "INV-2607", "invoice_date": "2026-07-08",
        "due_date": "2026-07-23", "place_of_supply": "Maharashtra (27)", "is_igst": False,
        "currency": "INR",
        "line_items": [
            {"description": "Office fit-out \u2014 Phase 2 design & execution", "hsn_code": "995461",
             "quantity": 1, "unit": "", "rate": 325000, "gst_rate": 18, "line_total": 325000},
            {"description": "Site supervision & project management", "sac_code": "998399",
             "quantity": 42, "unit": "hr", "rate": 2380, "gst_rate": 18, "line_total": 99960},
            {"description": "Statutory drawings & municipal filing", "hsn_code": "998321",
             "quantity": 1, "unit": "", "rate": 40000, "gst_rate": 18, "line_total": 40000},
        ],
        "subtotal": 464960, "cgst": 41846.4, "sgst": 41846.4, "igst": 0,
        "total": 548652.8, "amount_paid": 0, "balance_due": 548652.8,
        "terms": "Payment due within 15 days. MSME registered supplier \u2014 Section 43B(h) applies.",
    }
    invoice_no_hsn = {**invoice, "invoice_number": "INV-2608",
                      "line_items": [{**invoice["line_items"][0], "hsn_code": ""},
                                     invoice["line_items"][1]]}

    employee = {"name": "Aanya Mehta", "employee_code": "KV-0042", "employee_id": "KV-0042",
                "department_name": "Finance", "designation": "Manager \u2014 Finance",
                "pan": "BQZPM4417L", "uan": "101234567890", "esi_number": "3101234567",
                "bank_account": "50100244174417", "bank_name": "Demo Bank"}

    payslip = {"payslip_number": "PS-2607-004", "month": "2026-07",
               "working_days": 31, "present_days": 31, "leaves_paid": 0, "leaves_unpaid": 0,
               "basic": 72500, "hra": 29000, "conveyance": 4800, "special_allowance": 31200,
               "gross": 145000, "pf_employee": 8700, "pf_employer": 8700,
               "esi_employee": 1088, "esi_employer": 4712, "professional_tax": 200,
               "tds": 10312, "total_deductions": 20300, "net_pay": 124700}

    quote = {
        "quote_number": "QT-118", "quote_date": "2026-07-21", "valid_until": "2026-08-15",
        "prepared_by": "Aanya Mehta", "reference": "RFQ/DEMO/2026/114",
        "scope_summary": "Quarterly compliance retainer covering three registrations.",
        "line_items": [
            {"description": "Monthly compliance retainer", "sub": "3 registrations",
             "quantity": 12, "unit": "mo", "rate": 100000, "line_total": 1200000},
            {"description": "Reconciliation and advisory", "quantity": 12, "unit": "mo",
             "rate": 50000, "line_total": 600000},
        ],
        "subtotal": 1800000, "discount": 0, "is_igst": True, "igst": 324000, "gst_rate": 18,
        "payment_schedule": [
            {"label": "30% on signing", "amount": 637200, "due": "on acceptance"},
            {"label": "40% at half-year", "amount": 849600, "due": "Jan 2027"},
            {"label": "30% on completion", "amount": 637200, "due": "Jul 2027"},
        ],
    }

    statement = {
        "statement_number": "SOA-2607", "period_start": "2026-04-01", "period_end": "2026-07-25",
        "opening_balance": 100000,
        "entries": [
            {"date": "2026-04-18", "document": "INV-2588", "particulars": "Retainer \u2014 April", "debit": 200000},
            {"date": "2026-05-02", "document": "RCPT-914", "particulars": "Payment received", "credit": 300000},
            {"date": "2026-07-08", "document": "INV-2607", "particulars": "Phase 2", "debit": 400000},
        ],
        "closing_balance": 400000,
        "ageing": {"current": 400000, "d1_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 0},
        "msme_registered": True,
    }

    agreement = {
        "agreement_number": "AGR-2026-018", "effective_date": "2026-08-01", "term_months": 12,
        "governing_law": "India \u00b7 Mumbai", "governing_seat": "Mumbai", "project_ref": "KAR-582",
        "fee": 1000000, "gst_rate": 18, "place_of_supply": "Maharashtra", "is_igst": False,
        "payment_days": 30, "provider_is_msme": True, "tds_section": "194C", "tds_rate": 2,
        "scope": ["Project management for the Client's Mumbai office.",
                  "Deliverables are the milestones listed in clause 3."],
        "milestones": [
            {"title": "Site measurement and signed layout", "target": "2026-08-15", "share_pct": 20, "fee": 200000},
            {"title": "Detailed drawings issued", "target": "2026-09-12", "share_pct": 30, "fee": 300000},
            {"title": "Works complete", "target": "2026-11-28", "share_pct": 30, "fee": 300000},
            {"title": "Handover and as-built documentation", "target": "2027-01-31", "share_pct": 20, "fee": 200000},
        ],
    }

    report = {
        "report_number": "RPT-0037", "project_name": "Mumbai fit-out",
        "period_start": "2026-07-01", "period_end": "2026-07-25",
        "prepared_by": "Rohan Iyer", "prepared_on": "2026-07-25", "board_ref": "KAR-582",
        "agreement_ref": "Agreement AGR-2026-018", "overall_state": "At risk",
        "headline": "Milestone 1 is complete. Milestone 2 is behind on drawings.",
        "measures": [
            {"label": "Fee invoiced to date", "numeric": True, "plan": 200000, "actual": 200000,
             "variance": 0, "state": "On plan"},
            {"label": "Hours consumed", "numeric": True, "plan": 184, "actual": 206,
             "variance": 22, "state": "Over", "unit": "h"},
            {"label": "Open tasks", "numeric": True, "plan": 0, "actual": 3, "variance": 3, "state": "Watch"},
        ],
        "decisions": [{"by": "2026-08-05", "text": "Confirm the outstanding dimension."}],
    }

    gstr3b = {
        "period": "2026-07",
        "outward_taxable": {"taxable": 4218600, "igst": 374220, "cgst": 190674, "sgst": 190674, "cess": 0},
        "outward_zero_rated": {"taxable": 640000}, "outward_nil_exempt": {"taxable": 112000},
        "inward_reverse_charge": {"taxable": 84000, "cgst": 7560, "sgst": 7560},
        "itc_import_goods": {"igst": 18400}, "itc_reverse_charge": {"cgst": 7560, "sgst": 7560},
        "itc_all_other": {"igst": 142180, "cgst": 96412, "sgst": 96412},
        "itc_reversed": {"cgst": 4820, "sgst": 4820}, "itc_blocked_17_5": {"cgst": 6240, "sgst": 6240},
        "outward_count": 47, "inward_count": 61, "gstr2b_date": "2026-07-14",
        "state_label": "Maharashtra (27)", "prepared_by": "Aanya Mehta", "prepared_on": "2026-07-25",
        "held_back": [{"party": "Demo Traders", "reason": "HSN code missing", "itc": 6000},
                      {"party": "Demo Packaging", "reason": "HSN code missing", "itc": 5240}],
    }

    challan = {
        "period": "2026-07", "challan_number": "CHL-0442", "deposit_date": "2026-08-07",
        "major_head": "0021", "payment_type": "200", "bsr_code": "0510308",
        "challan_serial": "04412", "bank_name": "Demo Bank \u2014 Demo Branch", "payment_method": "NEFT",
        "deductions": [
            {"section": "194C", "nature": "Payments to contractors", "count": 4,
             "amount_paid": 1000000, "rate": 2, "tds": 20000},
            {"section": "194J", "nature": "Professional / technical fees", "count": 3,
             "amount_paid": 500000, "rate": 10, "tds": 50000},
            {"section": "192B", "nature": "Salary \u2014 non-government employees", "count": 6,
             "amount_paid": 1200000, "rate": None, "tds": 30000},
        ],
        "amounts": {"income_tax": 100000},
    }

    return {
        "org_complete": org_complete, "org_no_gstin": org_no_gstin, "contact": contact,
        "invoice": invoice, "invoice_no_hsn": invoice_no_hsn,
        "employee": employee, "payslip": payslip, "quote": quote, "statement": statement,
        "agreement": agreement, "report": report, "gstr3b": gstr3b, "challan": challan,
    }


def cases():
    """Every case the harness renders, as (name, build_html, build_pdf).

    Both halves are returned per case because they fail INDEPENDENTLY. Building
    the markup needs nothing but Python; turning it into a PDF needs WeasyPrint's
    native stack, which no Windows developer machine here has. Splitting them is
    the whole point of this rewrite: the previous version produced a PDF or
    nothing, so on the machine where these documents are actually written the
    harness emitted no document at all, and six of the eight generators had
    never been looked at by the time they shipped.
    """
    f = fixtures()
    import services.doc_validation as V
    import services.agreement_pdf as ag
    import services.gstr3b_pdf as g3
    import services.invoice_pdf as inv
    import services.payslip_pdf as pay
    import services.project_report_pdf as pr
    import services.quotation_pdf as quo
    import services.statement_pdf as st
    import services.tds_challan_pdf as td

    org, org0, contact = f["org_complete"], f["org_no_gstin"], f["contact"]

    def invoice_case(name, invoice, o=None, c=None):
        o, c = o or org, contact if c is None else c
        return (name,
                lambda: inv._build_html(invoice, o, c, V.validate_tax_invoice(invoice, o, c)),
                lambda: inv.generate_invoice_pdf(invoice, o, c))

    def payslip_case(name, payslip, emp):
        return (name,
                lambda: pay._build_html(payslip, emp, org, V.validate_payslip(payslip, emp, org)),
                lambda: pay.generate_payslip_pdf(payslip, emp, org))

    quote, statement, agreement = f["quote"], f["statement"], f["agreement"]
    report, gstr3b, challan = f["report"], f["gstr3b"], f["challan"]

    return [
        invoice_case("tax-invoice--complete", f["invoice"]),
        invoice_case("tax-invoice--no-supplier-gstin", f["invoice"], org0),
        invoice_case("tax-invoice--missing-hsn", f["invoice_no_hsn"]),
        invoice_case("tax-invoice--b2c-no-recipient-gstin", f["invoice"], org, {"name": "Walk-in buyer"}),
        invoice_case("quotation--via-invoice-layout",
                     {**f["invoice"], "invoice_type": "quotation"}, org0),
        ("quotation--complete",
         lambda: quo._build_html(quote, org, contact, V.validate_quotation(
             {**quote, "subtotal": quo.compute(quote)["subtotal"]}, org, contact)),
         lambda: quo.generate_quotation_pdf(quote, org, contact)),
        payslip_case("payslip--complete", f["payslip"], f["employee"]),
        payslip_case("payslip--pf-deducted-no-uan", f["payslip"], {**f["employee"], "uan": ""}),
        payslip_case("payslip--figures-do-not-reconcile",
                     {**f["payslip"], "net_pay": 99999}, f["employee"]),
        ("statement-of-account",
         lambda: st._build_html(statement, org, contact, V.validate_statement(statement, org, contact)),
         lambda: st.generate_statement_pdf(statement, org, contact)),
        ("service-agreement",
         lambda: ag._build_html(agreement, org, contact,
                                V.validate_service_agreement(agreement, org, contact)),
         lambda: ag.generate_agreement_pdf(agreement, org, contact)),
        ("project-report",
         lambda: pr._build_html(report, org, contact, V.validate_project_report(report, org, contact)),
         lambda: pr.generate_project_report_pdf(report, org, contact)),
        ("gstr-3b-working",
         lambda: g3._build_html(gstr3b, org, V.validate_gstr3b(gstr3b, org, g3.compute(gstr3b))),
         lambda: g3.generate_gstr3b_pdf(gstr3b, org)),
        ("tds-challan",
         lambda: td._build_html(challan, org, V.validate_tds_challan(challan, org, td.compute(challan))),
         lambda: td.generate_tds_challan_pdf(challan, org)),
    ]


def run_part_b(out_dir: Path) -> dict[str, dict[str, str]]:
    sys.path.insert(0, str(BACKEND))
    try:
        from services.doc_validation import DocumentIncomplete
    except Exception as e:  # pragma: no cover - environment-dependent
        print(f"  ! cannot import the generators: {e}", file=sys.stderr)
        return {}

    try:
        built = cases()
    except Exception as e:  # pragma: no cover
        print(f"  ! cannot build the cases: {e}", file=sys.stderr)
        return {}

    results: dict[str, dict[str, str]] = {}
    for name, build_html, build_pdf in built:
        row: dict[str, str] = {"html": "", "pdf": "", "note": ""}

        # 1. Markup. Needs nothing but Python, so it is written even when the
        #    PDF cannot be. This is the artefact to open on a dev machine.
        try:
            html = build_html()
            (out_dir / f"{name}.html").write_text(html, encoding="utf-8")
            row["html"] = f"{name}.html"
        except DocumentIncomplete as e:
            payload = e.as_payload()
            lines = [payload["message"], "", "BLOCKING:"]
            lines += [f"  - {g['label']} ({g['field']})\n      {g['reason']}\n      fix: {g['fix']}"
                      for g in payload["blocking"]]
            if payload["advisory"]:
                lines += ["", "ADVISORY (renders, reported to the drawer not the reader):"]
                lines += [f"  - {g['label']} ({g['field']})" for g in payload["advisory"]]
            (out_dir / f"{name}.REFUSED.txt").write_text("\n".join(lines), encoding="utf-8")
            row["note"] = f"{name}.REFUSED.txt"
            print(f"  {name} -> REFUSED ({len(payload['blocking'])} blocking)")
            results[name] = row
            continue
        except Exception as e:  # pragma: no cover
            row["note"] = f"HTML FAILED: {type(e).__name__}: {e}"
            print(f"  ! {name}: HTML failed: {e}", file=sys.stderr)
            results[name] = row
            continue

        # 2. PDF. The validators already ran above, so a refusal has been
        #    reported; what is left here is the native stack and real bugs.
        try:
            pdf = build_pdf()
            (out_dir / f"{name}.pdf").write_bytes(pdf)
            row["pdf"] = f"{name}.pdf"
            print(f"  {name} -> HTML + PDF ({len(pdf):,} bytes)")
        except DocumentIncomplete:
            print(f"  {name} -> HTML (refused at the PDF entry point)")
        except RuntimeError as e:
            row["note"] = "no WeasyPrint native stack"
            print(f"  {name} -> HTML only ({e})")
        except Exception as e:  # pragma: no cover
            row["note"] = f"PDF FAILED: {type(e).__name__}: {e}"
            print(f"  ! {name}: PDF failed: {e}", file=sys.stderr)

        results[name] = row
    return results


# ── index ────────────────────────────────────────────────────────────────────

def write_index(out_dir: Path, spec: dict, live: dict) -> None:
    rows = []
    for doc, (is_live, note) in DOCUMENTS.items():
        links = " · ".join(
            f'<a href="{spec[doc][t]}">{TENANT_LABEL[t]}</a>' for t in TENANTS
        ) if doc in spec else "<em>spec file not found</em>"
        badge = ('<span class="b b--live">live</span>' if is_live
                 else '<span class="b b--spec">spec only</span>')
        rows.append(f"<tr><td><b>{doc[:-5]}</b><div class='n'>{note}</div></td>"
                    f"<td>{badge}</td><td>{links}</td></tr>")

    def cell(href: str) -> str:
        return f'<a href="{href}">{href.rsplit(".", 1)[-1].upper()}</a>' if href else "<em>—</em>"

    live_rows = "".join(
        f"<tr><td>{k}</td><td>{cell(v.get('html', ''))}</td><td>{cell(v.get('pdf', ''))}</td>"
        f"<td class='n'>{v.get('note') or ''}</td></tr>"
        for k, v in live.items()
    ) or "<tr><td colspan='4'><em>Part B produced nothing — the generators could not be imported.</em></td></tr>"

    (out_dir / "index.html").write_text(f"""<!doctype html>
<meta charset="utf-8"><title>Kartavaya document harness</title>
<style>
 body{{font:15px/1.6 system-ui,sans-serif;margin:0;padding:32px;max-width:none;color:#14171A;background:#EDEAE1}}
 h1{{font-size:28px;margin:0 0 4px}} h2{{font-size:19px;margin:34px 0 6px}}
 p{{margin:0 0 14px;max-width:78ch;color:#464B52}}
 table{{border-collapse:collapse;width:100%;background:#fff;border:1px solid #D9D5CA;border-radius:8px;overflow:hidden}}
 td,th{{padding:10px 12px;border-bottom:1px solid #EAE7DE;text-align:left;vertical-align:top}}
 th{{background:#F7F5EF;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6E747C}}
 .n{{font-size:12px;color:#6E747C;margin-top:2px}}
 .b{{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;white-space:nowrap}}
 .b--live{{background:#DCF0E4;color:#17603A}} .b--spec{{background:#FBE6C8;color:#8A5300}}
 a{{color:#04837A}}
</style>
<h1>Kartavaya — document harness</h1>
<p>Generated by <code>backend/scripts/render_documents.py</code>. Two parts, deliberately separate.</p>

<h2>A · The specification, as authored</h2>
<p>The eight design documents on the vendored <code>&lt;doc-page&gt;</code> component, each baked
per tenant with the switcher removed. Open one and print it to PDF from the browser.</p>
<p><b>Where the build deliberately departs from these files.</b> The <code>Nirmal Exports</code>
tenant has no GSTIN, and the design marks that with a red <code>.unset</code> blocker. The
product does not, and neither difference is a regression:
a missing GSTIN and a missing place of supply <b>never block</b> generation, and an absent field
prints a quiet em-dash rather than a red warning (owner's rulings, 2026-08-03). The reasoning is
that these documents are what goes OUT — to a client, an employee, a bank — and an internal
bookkeeping gap shouted at the one person who cannot fix it is both alarming and often not a gap
at all. The gaps are still reported: <code>validate_*</code> returns every one, and
<code>GET /invoices/{{id}}</code> carries them to the drawer, where the person who can fix them is
looking. Compare against Part B, not against these files, when judging the build.</p>
<table><tr><th>Document</th><th>Status</th><th>Tenants</th></tr>{"".join(rows)}</table>

<h2>B · What the product actually generates today</h2>
<p>All eight documents, from fixtures, as the product emits them. <b>HTML is written even when
the PDF cannot be</b> — the markup needs only Python, while the PDF needs WeasyPrint's native
pango/cairo stack that no Windows machine here has. Open the HTML: it is the same markup the
PDF is rendered from, and it is the artefact that shows what a client actually receives.</p>
<p>Cases that are <b>refused</b> write a <code>.REFUSED.txt</code> naming every blocking
field — that file is the artefact to inspect, and a refusal is a pass, not a failure.</p>
<table><tr><th>Case</th><th>HTML</th><th>PDF</th><th>Note</th></tr>{live_rows}</table>
""", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(BACKEND / ".doc-harness"))
    args = ap.parse_args()

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not DOCS.is_dir():
        print(f"design documents not found at {DOCS}", file=sys.stderr)
        return 1

    print("Part A — the eight design documents, per tenant:")
    spec = run_part_a(out_dir)
    print("\nPart B — what the product generates today:")
    live = run_part_b(out_dir)

    write_index(out_dir, spec, live)
    print(f"\nOpen {out_dir / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
