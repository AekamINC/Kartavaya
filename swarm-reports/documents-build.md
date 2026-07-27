# Print documents — build report

**Branch:** `worktree-agent-a1fbe9feb34c7f9db`, branched fresh from `origin/staging` @ `b6f6c31a`.
**Date:** 27 July 2026.
**Scope:** the six documents specified in `design-reference/Kartavaya Redesign/docs/` that had no generator, or the wrong one.

> The worktree was seeded from `1aa49855` — **738 commits behind** `origin/staging`, exactly as warned.
> It also carried **13 commits `origin/staging` does not have**. Every one of those 13 was confirmed
> reachable from `main` and `origin/main` (`git branch -a --contains` on the oldest and newest of them)
> before `git reset --hard origin/staging`. Nothing was lost. `main` was never touched.

---

## 1 · What was built

| Document | Spec | Generator | Validator | Endpoint |
|---|---|---|---|---|
| **GSTR-3B summary** | `GSTR-3B Summary.html` | `backend/services/gstr3b_pdf.py` | `validate_gstr3b` | `POST /api/v1/documents/gst/gstr3b/{period}/pdf` |
| **TDS challan (ITNS-281)** | `TDS Challan.html` | `backend/services/tds_challan_pdf.py` | `validate_tds_challan` | `POST /api/v1/documents/tds/challan/{period}/pdf` |
| **Statement of account** | `Statement of Account.html` | `backend/services/statement_pdf.py` | `validate_statement` | `GET /api/v1/documents/contacts/{contact_id}/statement/pdf` |
| **Quotation** | `Quotation.html` | `backend/services/quotation_pdf.py` | `validate_quotation` | `GET /api/v1/documents/quotations/{invoice_id}/pdf` — and the existing `GET /api/v1/ganit/invoices/{id}/pdf` now dispatches to it |
| **Service agreement** | `Service Agreement.html` | `backend/services/agreement_pdf.py` | `validate_service_agreement` | `POST /api/v1/documents/contracts/{contract_id}/agreement/pdf` |
| **Project report** | `Project Report.html` | `backend/services/project_report_pdf.py` | `validate_project_report` | `POST /api/v1/documents/projects/{board_id}/report/pdf` |

Shared: `backend/services/doc_render.py` — `brand.css` and the `<doc-page>` geometry translated for print.
Same toolchain as the two existing generators throughout: WeasyPrint, `services/doc_fonts.py`, `services/doc_validation.py`.
**No second PDF toolchain was introduced.**

**Document Kit was NOT built.** It is the cover/index for the set and was gated on the six above being done;
they are done, but it is the lowest-value item and the budget went into verifying the statutory two instead.

**No frontend file was touched.** `git status` is nine new backend files and three modified backend files
(`server.py` router registration, `ganit.py` quotation dispatch, `doc_validation.py` six new validators).
No download buttons were added — the endpoints exist and are unwired in the UI.

---

## 2 · The verification that matters: GSTR-3B against its own spec

Table 6.1 is what a CA firm checks first and the easiest thing to get quietly wrong.
`compute_set_off` implements two statutory rules rather than accepting a caller's arithmetic:

- **Order of utilisation** — s.49(5) with ss.49A/49B and rule 88A. IGST credit exhausted first, then it may
  pay CGST and SGST; CGST credit pays CGST then IGST; SGST credit pays SGST then IGST; CGST credit can never
  pay SGST and vice versa (s.49(5)(c),(d)); cess pays cess alone.
- **Reverse charge is cash-only** — s.49(4) with rule 85(4). The 3.1(d) tax is carved out of the ITC-payable
  base and added straight to the cash column.

Fed the specification's **Tables 3.1 and 4 only**, the implementation reproduces its printed **Table 6.1 and
all four totals to the rupee**. Regenerated for this report, not transcribed:

```
net ITC      igst 160580  cgst 99152  sgst 99152        (spec Table 4(C): same)
igst   payable 374220  via ITC 160580  cash 213640      (spec 6.1: same)
cgst   payable 198234  via ITC  99152  cash  99082      (spec 6.1: same)
sgst   payable 198234  via ITC  99152  cash  99082      (spec 6.1: same)
total payable 770688 · utilised 358884 · payable in cash 411804   (spec totals: same)
words: "Rupees Four Lakh Eleven Thousand Eight Hundred Four Only"
```

`tests/test_document_set.py::TestGstr3bAgainstSpec` asserts each of those cells individually, so a change to
the set-off fails against the approved design rather than against nothing. Three further tests construct
cases where each statutory constraint **bites** (credit far exceeding a reverse-charge liability;
CGST credit offered against an SGST liability; IGST credit exceeding the IGST head) — a set-off that ignored
the rules would pass a spec-replay test alone.

---

## 3 · Statutory divergences I did NOT silently correct

**These are the items to review before 15 August.**

### 3.1 GSTR-3B Table 4 is a subset of the notified form

The specification's Table 4 omits **(A)(2) import of services**, **(A)(4) inward supplies from an ISD**, and
**(D)(1) ITC reclaimed**. Its (D) row is labelled *"Ineligible ITC — section 17(5)"*; on the form notified from
July 2022, s.17(5) ineligible credit is reported as a **reversal under 4(B)(1)**, and 4(D)(2) covers
s.16(4) and place-of-supply restrictions instead.

I followed the spec's labels exactly, per the brief ("do not improvise field names"), and recorded the
divergence in `gstr3b_pdf._TABLE_4_DIVERGENCE`. It is tolerable **only** because the document is framed as a
working paper, not a return — the footer says *"not a filed return"*, the meta strip says *"Working — not
filed"* and *"ARN: Not generated"*. **A firm must not file from this paper without reconciling to the
portal's own form.** If you want the notified rows, that is a spec change, not a code change.

### 3.2 The GSTR-3B due date assumes a monthly filer

The 20th of the following month — s.39(7) with rule 61(1)(i). **A QRMP filer's date is the 22nd or 24th
depending on the State group,** and nothing on `organisations` records which scheme applies.
`validate_gstr3b` raises an advisory (`gstr3b.filing_scheme`) declaring the assumption on the face of the
document rather than hiding it. Column proposed in §5 of the SQL.

### 3.3 Fields I was unsure about and therefore did not derive

- **ITNS-281 major head (0020 / 0021).** It is a property of the **deductee**, not the deductor, so it cannot
  be inferred from the org's own constitution. The caller states it; the validator confirms it is one of the
  two and blocks otherwise.
- **Type of payment (200 / 400).** Same treatment.
- **192B rate column.** Left as an em-dash. s.192(1) deducts at the **employee's own average rate**, so any
  single percentage would be wrong for every employee. This matches the spec, which also shows `—`.
- **MSME status.** The statement's s.43B(h) notice and the agreement's s.15/16 MSMED interest clause are
  assertions about the **issuer's own registration**, made on a document that lands in a buyer's tax file.
  Both render only when the caller says the issuer is registered. Never assumed.
- **Arbitration seat.** Never defaulted — a guessed seat sends a dispute to the wrong forum. Renders as a red
  `.unset` marker.
- **UPI QR.** Drawn as the spec's placeholder, not a real code. Nothing in the schema produces a signed UPI
  intent string and a QR resolving to the wrong VPA moves a client's money to the wrong account.

---

## 4 · The approved design overruns its own page box

**This is a defect in the spec, found by measuring, and it changed how I built.**

`doc-page.js` gives a pre-paginated `.page` `overflow: hidden` — *"content that misses the box is CLIPPED"*.
Rendering the **specification's own HTML and `brand.css`** through WeasyPrint 68 and measuring the `.page`
section height against a 297 mm A4 sheet:

| Spec document | `.page` height | Over A4 by |
|---|---:|---:|
| `GSTR-3B Summary.html` | 362.2 mm | +65 mm |
| `TDS Challan.html` | 380.5 mm | +84 mm |
| `Project Report.html` | 347.4 mm | +50 mm |
| `Quotation.html` | 344.2 mm | +47 mm |
| `Service Agreement.html` (page 1) | 324.2 mm | +27 mm |
| `Statement of Account.html` | 237.0 mm | fits |

Honouring `overflow: hidden` would silently drop a GSTR-3B payment table or a challan's CIN. So
`doc_render` uses `min-height`, and these documents **paginate rather than clip**.

*Caveat, stated because it affects the numbers:* the measurement ran without network access, so `brand.css`'s
Google-Fonts `@import` did not resolve and the spec rendered in fallback faces. The absolute millimetres are
therefore approximate. The **margin** (27–84 mm) is far beyond font-substitution noise, and the conclusion —
five of six overrun — does not depend on the precision.

Consequent deliberate deviation, recorded in the stylesheet: **the colophon follows the content instead of
being pinned to the foot of the sheet.** `brand.css` pins it with `display: flex` + `margin-top: auto`;
WeasyPrint 68 does not implement that free-space distribution, and worse, the flex container fragments
wrongly — a TDS challan with 288.8 mm of content (comfortably inside a 297 mm sheet) was pushed onto a second
page carrying nothing but the colophon. I tried and rejected two alternatives: a fixed `height: 296mm` on the
flex box, and a `display: table` page with the colophon in a `table-footer-group` (reaches the foot of a
**full** sheet, sits at 40 mm on a short one). On a full sheet the result matches the design; on a short one
the colophon sits higher. **Cosmetic loss, taken knowingly, in exchange for pagination that never drops a
figure.**

Final page counts, regenerated:

```
gstr3b          34899 B   2 page(s)      tds_challan   27908 B   1 page(s)
statement       25371 B   1 page(s)      quotation     30540 B   1 page(s)
agreement       31668 B   2 page(s)      project_report 28203 B  1 page(s)
```

The agreement is 2 pages **by design**; GSTR-3B is 2 because its content is 386.5 mm.

---

## 5 · Schema gaps — nothing invented

Verified against the **live catalog** (`information_schema.columns`), not the migration ledger.
Proposed in `backend/migrations/PROPOSED_documents.sql`, with a rollback and a data-loss warning.
**NOT APPLIED.** Staging and production share `toacecaewujfxjfrjwco`.

| Gap | Document | Severity |
|---|---|---|
| `organisations.tan` does not exist | TDS challan | **Blocking.** s.203A; the PAN is not a substitute. |
| No challan table at all — BSR code, serial, tender date, deposit date, bank, major head, type of payment | TDS challan | **Blocking.** Taken in the request body meanwhile. |
| Non-salary TDS (194C/J/I/H) has no store — `ganit_vendor_bills` records no section, rate or TDS amount | TDS challan | Supplied in the body. Only **192B is derived**, from `vetana_payslips`. |
| No nil/exempt, non-GST or reverse-charge flags | GSTR-3B 3.1(c)(d)(e) | Overrides, defaulting to nil and **printed as nil**, not omitted. |
| No ITC-reversal or ineligible-ITC store | GSTR-3B 4(B), 4(D) | Same. |
| `ganit_vendor_bills` has **no `cess`** column (`ganit_invoices` does) | GSTR-3B 4 | Inward cess credit always nil. Understates credit for cess goods. |
| No GSTR-2B reconciliation record | GSTR-3B | Advisory: ITC is unreconciled book figures (s.16(2)(aa)). |
| No MSME registration column | statement, agreement | Caller-supplied. |
| No GST filing-scheme column | GSTR-3B due date | Advisory, §3.2 above. |
| No `prepared_by`, payment schedule or numbered terms | quotation | Advisory naming each. |
| **There is no `projects` table** | project report | `services/skills/data/kpi_aggregator.py` and `workload_calculator.py` both join `staging.projects`, which does not exist. Report keys on `public.boards`. |
| No milestone store, no risk register, no baseline for any measure | project report, agreement clause 3 | Report renders an **explicit empty state** — *"Read this as 'none captured', not 'none exist'"* — rather than a blank table that reads as "no risks". |

Interim, non-destructive accommodation: `routers/documents._load_org` reads a TAN out of
`organisations.settings` (JSONB) when present, so a firm can transact before the column lands.
`validate_tds_challan` still refuses when there is none. **Nothing is invented.**

---

## 6 · Test results — exact counts

| Run | Result |
|---|---|
| `cd backend && python -m pytest -q` (Windows) | **1404 passed, 31 skipped, 0 failed** |
| New files only, Windows | 138 passed, 31 skipped |
| `tests/test_document_set.py`, **WSL with real WeasyPrint 68.0** | **146 passed, 5 skipped, 0 failed** |

The 31 Windows skips are the real-PDF tests: this machine has WeasyPrint installed but not its native stack
(`OSError: cannot load library 'libgobject-2.0-0'`). Baseline before this work was 1266 tests, all passing;
169 were added (151 renderer/validator + 18 routing) and none were removed or weakened.

**Real PDF bytes were generated and asserted on**, in an Ubuntu WSL environment with WeasyPrint pinned to
**68.0 — the exact version in `requirements.txt`** — and the same native Pango/GObject stack
`backend/Dockerfile` installs. Every one of the six documents:

- starts `%PDF-`, ends `%%EOF`, exceeds 5 000 bytes;
- has its identifiers, figures, headings **and closing block** read back out with `pypdf` — so a page overrun
  that dropped content fails;
- embeds the Devanagari face. Confirmed via the PDF's **font resources**, not raw bytes:
  `/GJHCBD+Tiro-Devanagari-Hindi` with `/FontFile2`.

### Bugs the real-bytes requirement actually caught

Writing the tests against real PDFs rather than HTML found four things HTML assertions could not:

1. **Two documents silently spilled to a second page** carrying only the colophon (§4). Found by asserting
   page counts.
2. **`b"FontFile2" in pdf` is always False** — WeasyPrint writes compressed object streams. My first font
   test was a false negative that would have passed forever once "fixed" the wrong way.
3. **`text-transform: uppercase` reaches the text layer** — "Statement of Account" extracts as
   "STATEMENT OF ACCOUNT". Four content assertions were wrong, not the documents.
4. **The quotation's gap note contradicted the page**: it reported "Terms" missing while four default terms
   were printed beside it. Reworded to say the terms are the **default set, not this firm's** — which is the
   accurate gap.

### Visual comparison against the spec

I rendered every generated PDF to PNG (`pypdfium2`, 1.6×) and read them side by side against the spec HTML.
GSTR-3B, TDS challan, statement, quotation and project report were checked page by page; the agreement was
checked on both pages. Devanagari renders correctly with conjuncts intact — `मासिक विवरणी`, `कर चालान`,
`प्रस्ताव`, `लेखा विवरण`, `परियोजना रिपोर्ट`, `हस्ताक्षर`, and `कर्तव्य` in every colophon.
Indian 2,2,3 grouping throughout; a regex test asserts Western `1,234,567` grouping appears in no document.

**I did not do an automated pixel diff against the spec.** The spec pages are browser-rendered with
network-loaded Google Fonts and a JS web component; the generated pages are WeasyPrint with vendored faces.
A pixel diff would be noise. The comparison was structural and by eye.

---

## 7 · What I did NOT verify — read this

- **No endpoint was exercised against the real database.** The database was read-only throughout (catalog
  queries only). Routing tests use `conftest`'s mocked pool. **The SQL in `routers/documents.py` has never
  run against real rows.** The statement's opening-balance query and the GSTR-3B aggregation are the two most
  likely to need adjustment on live data.
- **No document was emailed, pushed or sent.** Nothing on these paths dispatches; `conftest` pins
  `OUTBOUND_MODE=dry` before the app imports. The email attachment path was not touched or tested.
- **The full suite was not run under real WeasyPrint** — only `test_document_set.py` was, because the WSL
  environment has WeasyPrint but not the project's other dependencies. The 31 skipped tests on Windows are
  the 25 real-PDF tests plus 5 agreement-only variants and 1 refusal test; **all 31 have been run for real in
  WSL** as part of that 146.
- **`PROPOSED_documents.sql` has never been executed**, not even against a scratch database. Its syntax is
  unverified.
- **No UI.** The endpoints have no download buttons.
- **Quotation fidelity is partial by data, not by design.** Payment schedule, numbered terms and "prepared
  by" have no columns; the document renders with an advisory naming each. The `Quotation.html` mock shows all
  three populated.
- **`invoice_pdf.py` and `payslip_pdf.py` were not migrated** to `doc_render`. They keep their own `pdf__*`
  stylesheet, which does not match `brand.css`. **The tax invoice and payslip therefore look different from
  the six documents built here.** That is a real inconsistency in the delivered set and the largest remaining
  design-conformance gap.

---

## 8 · Recommended order before 15 August

1. Apply **§1 and §2** of `PROPOSED_documents.sql` (TAN + challan table). Nothing else unblocks a document.
2. Decide **§3.1** — does GSTR-3B Table 4 stay at the spec's simplified rows, or move to the notified form?
3. Run the statement and GSTR-3B endpoints against one real org's data and check the opening balance and the
   hold-back list by hand.
4. Migrate `invoice_pdf.py` and `payslip_pdf.py` onto `doc_render` so all eight documents match (§7).
5. Document Kit last.
