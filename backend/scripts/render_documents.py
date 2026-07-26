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
DOCUMENTS = {
    "Tax Invoice.html": (True, "Ganit — GET /api/ganit/invoices/{id}/pdf"),
    "Payslip.html": (True, "Vetana — GET /api/vetana/payslips/{id}/pdf"),
    "Quotation.html": (False, "Ganit — invoice_type='quotation' renders through the invoice layout, not this one"),
    "Statement of Account.html": (False, "not built"),
    "GSTR-3B Summary.html": (False, "not built"),
    "TDS Challan.html": (False, "not built"),
    "Service Agreement.html": (False, "not built — eSign has a signing flow, not this document"),
    "Project Report.html": (False, "not built — report_generator.py emits an internal team report, not this client-facing one"),
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
    """Representative data, including the cases that must be refused."""
    org_complete = {
        "name": "Aekam Inc", "gstin": "27AAACA1234M1Z8", "pan": "AAACA1234M",
        "email": "accounts@aekam.co", "phone": "+91 22 6142 8800", "website": "aekaminc.com",
        "billing_address": {"line1": "Unit 402, Meridien Tower", "line2": "Bandra Kurla Complex",
                            "city": "Mumbai", "state": "Maharashtra", "pincode": "400051", "country": "India"},
        "bank_details": {"account_name": "Aekam Inc", "account_number": "50200041824821",
                         "ifsc": "HDFC0000521", "bank_name": "HDFC Bank", "branch": "Bandra Kurla Complex",
                         "upi_id": "aekam@hdfcbank"},
        "invoice_note": "Thank you for your business.",
        "authorized_signatory_name": "Keval Shah", "authorized_signatory_designation": "Director",
    }
    # The tenant from the design spec that has no GSTIN. Its whole purpose is to
    # prove the document is refused rather than quietly issued.
    org_no_gstin = {**org_complete, "name": "Nirmal Exports", "gstin": ""}

    contact = {"name": "Tata Steel Limited", "company": "Tata Steel Limited",
               "gstin": "27AAACT2727Q1ZW",
               "billing_address": {"line1": "Bombay House, 24 Homi Mody Street", "city": "Mumbai",
                                   "state": "Maharashtra", "pincode": "400001", "country": "India"},
               "email": "ap@tatasteel.com"}

    invoice = {
        "invoice_type": "tax_invoice", "invoice_number": "INV-2607", "invoice_date": "2026-07-08",
        "due_date": "2026-07-23", "place_of_supply": "Maharashtra (27)", "is_igst": False,
        "currency": "INR",
        "line_items": [
            {"description": "Office fit-out — Phase 2 design & execution", "hsn_code": "995461",
             "quantity": 1, "unit": "", "rate": 325000, "gst_rate": 18, "line_total": 325000},
            {"description": "Site supervision & project management", "sac_code": "998399",
             "quantity": 42, "unit": "hr", "rate": 2380, "gst_rate": 18, "line_total": 99960},
            {"description": "Statutory drawings & municipal filing", "hsn_code": "998321",
             "quantity": 1, "unit": "", "rate": 40000, "gst_rate": 18, "line_total": 40000},
        ],
        "subtotal": 464960, "cgst": 41846.4, "sgst": 41846.4, "igst": 0,
        "total": 548652.8, "amount_paid": 0, "balance_due": 548652.8,
        "terms": "Payment due within 15 days. MSME registered supplier — Section 43B(h) applies.",
    }
    invoice_no_hsn = {**invoice, "invoice_number": "INV-2608",
                      "line_items": [{**invoice["line_items"][0], "hsn_code": ""},
                                     invoice["line_items"][1]]}

    employee = {"name": "Aanya Mehta", "employee_code": "KV-0042", "employee_id": "KV-0042",
                "department_name": "Finance", "designation": "Manager — Finance",
                "pan": "BQZPM4417L", "uan": "101234567890", "esi_number": "3101234567",
                "bank_account": "50100244174417", "bank_name": "HDFC Bank"}

    payslip = {"payslip_number": "PS-2607-004", "month": "2026-07",
               "working_days": 31, "present_days": 31, "leaves_paid": 0, "leaves_unpaid": 0,
               "basic": 72500, "hra": 29000, "conveyance": 4800, "special_allowance": 31200,
               "gross": 145000, "pf_employee": 8700, "pf_employer": 8700,
               "esi_employee": 1088, "esi_employer": 4712, "professional_tax": 200,
               "tds": 10312, "total_deductions": 20300, "net_pay": 124700}

    return {
        "tax-invoice--complete": ("invoice", invoice, org_complete, contact),
        "tax-invoice--no-supplier-gstin": ("invoice", invoice, org_no_gstin, contact),
        "tax-invoice--missing-hsn": ("invoice", invoice_no_hsn, org_complete, contact),
        "tax-invoice--b2c-no-recipient-gstin": ("invoice", invoice, org_complete, {"name": "Walk-in buyer"}),
        "quotation--no-gstin-is-fine": ("invoice", {**invoice, "invoice_type": "quotation"}, org_no_gstin, contact),
        "payslip--complete": ("payslip", payslip, employee, org_complete),
        "payslip--pf-deducted-no-uan": ("payslip", payslip, {**employee, "uan": ""}, org_complete),
        "payslip--figures-do-not-reconcile": ("payslip", {**payslip, "net_pay": 99999}, employee, org_complete),
    }


def run_part_b(out_dir: Path) -> dict[str, str]:
    sys.path.insert(0, str(BACKEND))
    try:
        from services.doc_validation import DocumentIncomplete
        from services.invoice_pdf import generate_invoice_pdf
        from services.payslip_pdf import generate_payslip_pdf
    except Exception as e:  # pragma: no cover - environment-dependent
        print(f"  ! cannot import the generators: {e}", file=sys.stderr)
        return {}

    results: dict[str, str] = {}
    for name, (kind, a, b, c) in fixtures().items():
        try:
            pdf = generate_invoice_pdf(a, b, c) if kind == "invoice" else generate_payslip_pdf(a, b, c)
            (out_dir / f"{name}.pdf").write_bytes(pdf)
            results[name] = f"{name}.pdf"
            print(f"  {name} -> PDF ({len(pdf):,} bytes)")
        except DocumentIncomplete as e:
            payload = e.as_payload()
            lines = [payload["message"], "", "BLOCKING:"]
            lines += [f"  - {g['label']} ({g['field']})\n      {g['reason']}\n      fix: {g['fix']}"
                      for g in payload["blocking"]]
            if payload["advisory"]:
                lines += ["", "ADVISORY (renders, marked in red):"]
                lines += [f"  - {g['label']} ({g['field']})" for g in payload["advisory"]]
            out = f"{name}.REFUSED.txt"
            (out_dir / out).write_text("\n".join(lines), encoding="utf-8")
            results[name] = out
            print(f"  {name} -> REFUSED ({len(payload['blocking'])} blocking)")
        except RuntimeError as e:
            # No native WeasyPrint stack (pango/cairo). Expected on a developer
            # machine; the validation half of Part B still ran and produced the
            # .REFUSED.txt artefacts above, which is the half worth inspecting
            # without a renderer.
            print(f"  - {name}: skipped ({e})")
            results[name] = ""
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

    live_rows = "".join(
        f'<tr><td>{k}</td><td>{"<a href=\'%s\'>%s</a>" % (v, v) if v else "<em>not produced</em>"}</td></tr>'
        for k, v in live.items()
    ) or "<tr><td colspan='2'><em>Part B skipped — WeasyPrint or its native stack is unavailable.</em></td></tr>"

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
per tenant with the switcher removed. Open one and print it to PDF from the browser.
<b>Nirmal Exports has no GSTIN</b> — on a tax document it must show the red blocker, never a
plausible-looking invoice.</p>
<table><tr><th>Document</th><th>Status</th><th>Tenants</th></tr>{"".join(rows)}</table>

<h2>B · What the product actually generates today</h2>
<p>Server-side WeasyPrint, from fixtures. Cases that are <b>refused</b> write a
<code>.REFUSED.txt</code> naming every blocking field — that file is the artefact to inspect.
Six of the eight documents above have no generator at all.</p>
<table><tr><th>Case</th><th>Output</th></tr>{live_rows}</table>
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
