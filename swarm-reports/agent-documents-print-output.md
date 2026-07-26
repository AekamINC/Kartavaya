# Documents & print output — agent report

Branch: `agent/documents-print-output` (rebased on `origin/staging`, gates green)
Predecessor refs: `worktree-agent-a8f4f5f6f463bae98`, `rescue/a8f4f5f6f463bae98`
Scope: every document this product generates as a PDF or print output.

Claims are marked **HELD** (verified against the code on this branch) or **STALE**.
Where I could not verify something without querying the shared database — which is
out of bounds — I say so explicitly rather than asserting it.

---

## 1. The decision that governs everything: `<doc-page>` vs. WeasyPrint

**Chosen: keep server-side WeasyPrint. Do not ship `<doc-page>` as the PDF engine.**

### What the repo actually has — HELD

| File | Purpose |
|---|---|
| `backend/services/invoice_pdf.py` | Ganit tax invoice / proforma / credit note / debit note / quotation / export invoice |
| `backend/services/payslip_pdf.py` | Vetana payslip |
| `backend/services/report_generator.py` | Scheduled team report, 5 pages, PDF + XLSX |
| `backend/services/cost_report_pdf.py` | Platform cost report |

Endpoints: `GET /api/ganit/invoices/{id}/pdf` (`ganit.py:458`),
`GET /api/vetana/payslips/{id}/pdf` (`vetana.py:857`), plus a payslip PDF built for
**email attachment** inside the payroll run (`vetana.py:584`), and the report at
`reports.py:298` / `:459`. `backend/Dockerfile` installs the full WeasyPrint native
stack explicitly "required by WeasyPrint". This is not incidental.

### Why `<doc-page>` cannot replace it

`<doc-page>` is a **browser** component. Its contract is `window.print()` in a real
browser: it injects `@page` into `document.head`, measures slot heights with
`requestAnimationFrame`, awaits `document.fonts.ready`, branches on
`navigator.vendor` for a WebKit thead-repeat bug, and uses shadow-DOM `::slotted()`
`!important` for print geometry.

Adopting it as the PDF engine means a headless-Chromium service: a second runtime
in the image (~400 MB on a ~200 MB `python:3.13-slim` base), an outbound HTTP hop
inside the payroll-run request that already sends mail, and two rendering systems
during any migration — which the brief forbids.

### What `<doc-page>` remains the authority for

1. **The brand layer contract** — `brand.css` tokens, the `.unset` red-warning rule,
   the letterhead / meta / parties / lines / totals / words / foot structure, the
   `data-org` tenant accent model. All of it is honoured on the WeasyPrint side.
2. **The harness** (§5), which renders the eight documents on the real vendored
   component so a human can diff spec against output.

The spec's own rule that matters most is honoured: `18-documents.md` says do not
create a second source of truth for page geometry. On the WeasyPrint path there is
exactly one — the `@page` rule in each `_build_html`. No `<doc-page>` is loaded, so
no conflict exists.

**Deliberate divergence, recorded:** `18-documents.md` §"New files" lists
`public/doc-page.js`, `frontend/src/components/docs/DocPage.jsx`,
`frontend/src/pages/docs/*.jsx` and a `<script src="/doc-page.js">` in `index.html`.
**None is created.** Adding them would stand up the second system the brief forbids.
Reversing this decision means budgeting a headless-browser service first.

---

## 2. THE FIELD AUDIT

For each document: every field it renders, the backend that would supply it, and
whether the data exists. This is the table `ganit` and `vetana` need.

Legend — **✅ exists** · **⚠️ exists but not wired** · **❌ no column anywhere** ·
**🔢 derived** (computable from data that exists, no column needed)

### Shared letterhead — every one of the eight documents

Source: `staging.organisations`, served by `GET /v1/org/profile` (`org_profile.py`).

| Field in spec | Column | Status |
|---|---|---|
| `data-org-name` | `organisations.name` | ✅ |
| `data-org-addr` | `organisations.billing_address` JSONB | ✅ |
| `data-org-gstin` | `organisations.gstin` | ✅ |
| `data-org-pan` | `organisations.pan` | ✅ |
| `data-org-email` / `-phone` / `-web` | `email`, `phone`, `website` | ✅ (047) |
| `data-org-logo` | `logo_url` + `logo_key` (signed at read) | ✅ |
| `data-org-bank` | `bank_details` JSONB | ✅ (047) |
| `data-org-note` | `invoice_note` | ✅ (047) |
| Authorised signatory | `authorized_signatory_name`, `..._designation` | ✅ (051) |
| **`--org-accent` brand colour** | — | ❌ **no column.** `brand.css:27-30` says so itself: "the staging `/v1/org/profile` schema has no colour field yet". Every tenant renders Kartavaya teal. |
| **`data-org-tan`** (TDS challan) | — | ❌ **no column.** See `PROPOSED_080`. |
| **PF establishment code** (payslip) | — | ❌ **no column.** `PROPOSED_080`. |
| **ESI employer code** (payslip) | — | ❌ **no column.** `PROPOSED_080`. |

### 2.1 Tax Invoice — LIVE

Source: `staging.ganit_invoices` + `staging.graha_contacts` + org.

| Field | Backing | Status |
|---|---|---|
| Invoice number, date, due date | `invoice_number`, `invoice_date`, `due_date` | ✅ |
| Place of supply | `place_of_supply` (`DEFAULT ''`) | ✅ but usually blank — see §3 |
| Reverse charge flag | — | ❌ no column; spec renders "Reverse charge: No" |
| Billed-to name / address / GSTIN | `graha_contacts.name/company/billing_address/gstin` | ✅ |
| **Shipped-to (separate consignee)** | — | ❌ no column. Spec renders a second party block. |
| Line: description, qty, rate, amount | `line_items` JSONB | ✅ |
| Line: **HSN/SAC** | `line_items[].hsn_code` / `.sac_code` | ✅ per-line in JSONB — **now blocking if absent** |
| Taxable value, CGST, SGST, IGST, cess | `subtotal`, `cgst`, `sgst`, `igst`, `cess` | ✅ — real split columns |
| Rounding line | — | 🔢 derivable |
| Total, paid, balance | `total`, `amount_paid`, `balance_due` | ✅ |
| Amount in words | — | 🔢 `amount_in_words_inr()` |
| **IRN / Ack no. / Ack date / QR** | — | ❌ **no columns.** The spec renders an e-invoice block and a verification QR. Nothing in the schema holds an IRN. |
| Bank details, terms, declaration | org `bank_details`, `invoices.terms` | ✅ |

**Correction to `18-documents.md` §Tax invoice — the open question is now answered.**
That file says the flat-18% defect it cites belongs to `AdminBillingPage.jsx` (Aekam's
own subscription invoices), and that "Ganit's invoice schema ... has not been audited.
Verify separately before scoping that work." Audited: **Ganit can represent CGST+SGST
correctly.** `018_graha_ganit_manav.sql:115` gives `cgst`, `sgst`, `igst` and `cess`
separate `DECIMAL(14,2)` columns plus an `is_igst` boolean. There is no merged `gst`
column here. **The concern does not apply to Ganit.** — HELD

### 2.2 Payslip — LIVE

Source: `staging.vetana_payslips` + `staging.manav_employees` + org.

| Field | Backing | Status |
|---|---|---|
| Payslip number, pay period | `payslip_number`, `month` | ✅ |
| **Pay date / disbursal date** | `disbursed_at` | ⚠️ column exists, **not selected or rendered** |
| Payable days | `working_days`, `present_days`, `leaves_paid/unpaid` | ✅ |
| **Payment mode** | — | ❌ no column; spec renders "Bank transfer" |
| Employee name, code, designation | `name`, `employee_code`, `designation` | ✅ |
| Department | `manav_employees.department` (TEXT **name**, not an id) | ✅ — see §3, this was queried wrongly |
| Date of joining | `date_of_joining` | ⚠️ exists, not selected |
| Employee PAN | `pan` | ✅ |
| **UAN** | `uan` | ✅ — **now blocking when PF deducted** |
| **ESI number** | `esi_number` | ✅ column existed, **was never selected or rendered** — now both |
| **PF account number** (`MH/BAN/12345/0042`) | — | ❌ **no column.** Not the UAN. `PROPOSED_080`. |
| Earnings: basic, HRA, DA, special, conveyance, medical, OT | all columns | ✅ |
| Deductions: PF, ESI, PT, TDS, loan | all columns | ✅ separate lines |
| Gross, total deductions, net pay | `gross`, `total_deductions`, `net_pay` | ✅ |
| Net pay in words | — | 🔢 |
| **Leave balance table** (opening/taken/balance by type) | `manav_leave_*` tables exist | ⚠️ **not joined** into the payslip |
| **Credited-to: bank, A/c last 4, UTR** | `bank_details` JSONB has account/bank | ⚠️ partial — **no UTR column** ❌ |
| **Attendance source line** ("from Manav, date") | — | ❌ no provenance column |
| Employer contributions PF/ESI | `pf_employer`, `esi_employer` | ✅ |

### 2.3 Quotation — PARTIALLY LIVE

`invoice_type='quotation'` exists and renders through the **invoice** layout, not the
quotation design.

| Field | Backing | Status |
|---|---|---|
| Quote number, date | `invoice_number`, `invoice_date` | ✅ |
| **Valid until** | — | ❌ no column (`due_date` is semantically wrong) |
| Prepared by | `created_by` | ⚠️ stored, not rendered |
| **Client reference / RFQ no.** | — | ❌ |
| Scope summary | `notes` | ⚠️ approximate |
| Lines, subtotal, discount, tax, total | as invoice | ✅ |
| **Staged payment schedule** (30/40/30 with dates) | — | ❌ **no structure at all.** This is the commercial heart of the document. |
| **Acceptance / signature block** | eSign module exists separately | ⚠️ not linked to a quotation |

### 2.4 Statement of Account — NOT BUILT

| Field | Backing | Status |
|---|---|---|
| Period, account, currency | 🔢 from query params + contact | 🔢 |
| Running ledger: date, doc, particulars, debit, credit, **balance** | `ganit_invoices` + `ganit_payments` | 🔢 **all source data exists** — running balance is a window function |
| Opening / closing balance | 🔢 | 🔢 |
| Ageing buckets (current/1-30/31-60/61-90/90+) | 🔢 from `due_date` + `balance_due` | 🔢 |
| **MSME 43B(h) 45-day threshold date** | — | ❌ needs an MSME-registration flag on the org and an acceptance date per invoice |
| UPI QR | `bank_details.upi_id` | ✅ data exists; QR is 🔢 |

**This is the cheapest of the six to build** — everything but the MSME notice is
derivable from data that already exists. Recommended first.

### 2.5 GSTR-3B Summary — NOT BUILT

| Field | Backing | Status |
|---|---|---|
| Return period, due date | 🔢 | 🔢 |
| 3.1(a) outward taxable + tax split | 🔢 aggregate `ganit_invoices` | 🔢 |
| 3.1(b) zero-rated | `is_export` | ✅ flag exists (047) |
| **3.1(c) nil-rated / exempt** | — | ❌ no way to mark a line exempt vs. zero-rated |
| **3.1(d) inward reverse-charge** | — | ❌ `035_vendor_bills` has no RCM flag |
| **Section 4 ITC — available / reversed / 17(5) ineligible** | — | ❌ **nothing models input tax credit** |
| 6.1 payment of tax | — | ❌ depends on §4 |
| **"Two invoices held back for missing HSN"** | 🔢 | 🔢 — `doc_validation.validate_tax_invoice` already computes exactly this |
| ARN | — | ❌ (correctly; the spec says "working paper, no ARN") |

**The largest gap of the eight.** ITC is a whole subsystem, not a field.

### 2.6 TDS Challan — NOT BUILT

| Field | Backing | Status |
|---|---|---|
| **Deductor TAN** | — | ❌ `PROPOSED_080`. **A challan is filed against a TAN** — blocks the document outright. |
| Assessment year, period, deposit date | 🔢 | 🔢 |
| Section-wise schedule (194C/194J/194I(b)/194H/192B) | — | ❌ no section code on vendor bills or payslips |
| 192B salary TDS | `vetana_payslips.tds` | ✅ aggregable |
| Amount breakdown (tax/surcharge/cess/interest/penalty/234E) | — | ❌ |
| **CIN triple — BSR code, tender date, serial** | — | ❌ no challan table at all |

### 2.7 Service Agreement — NOT BUILT

Two pages, explicit pagination. Milestone-linked payment schedule, confidentiality,
IP, liability cap, dual signature block. **No milestone or contract-clause structure
exists.** The eSign module (`esign.py`) provides a signing flow but not this document.
The load-bearing clause per the spec — a milestone is invoiceable on **completion**,
and sign-off not withheld in writing within seven working days is deemed given —
has no representation anywhere.

### 2.8 Project Report — NOT BUILT, and NOT what `report_generator.py` makes

**This is the finding the coordinator flagged, confirmed.** — HELD

`report_generator.py` produces a **5-page internal team-productivity report**: cover +
KPI tiles, task-status breakdown, team leaderboard with a "champion" callout, task
list, daily-throughput bar chart (docstring, `report_generator.py:1-9`).

`docs/Project Report.html` is a **1-page client-facing progress pack** on the tenant
letterhead with GSTIN, containing:

| Section | Backing | Status |
|---|---|---|
| Project, reporting period, prepared by, **board reference** | project + 🔢 | ⚠️ / ❌ board ref |
| Prepared for (client) + **headline narrative** | `graha_clients` | ⚠️ no narrative field |
| **Position at a glance — measure / plan / actual / variance / status** | — | ❌ **no plan-vs-actual baseline anywhere** |
| **Milestones — target vs forecast vs state** | — | ❌ no milestone table |
| **Risks — severity / risk / mitigation / owner** | — | ❌ no risk register |
| **Decisions needed from the client, by date** | — | ❌ |

They share a name and nothing else. Two different documents for two different
audiences. **Do not "upgrade" `report_generator.py` into this** — that would break the
existing internal report and still not produce the client one.

### 2.9 Document Kit

The index page. Superseded in practice by the harness `index.html` (§5), which
additionally states live-vs-spec status per document. No backing data needed.

---

## 3. Defects found and fixed

**1. A tax invoice with no supplier GSTIN rendered as if complete — HELD, now refused.**
The prior state already marked it red (`invoice_pdf._org_gstin_line`) but **still
emitted the PDF**. `services/doc_validation.py` now refuses: `DocumentIncomplete`
before WeasyPrint is imported, mapped to 422 with every missing field named.

**2. Every generated PDF rendered in DejaVu — HELD** (found by a sibling for the
report; the same bug was in `invoice_pdf.py` and `payslip_pdf.py`). Those two named
`Georgia`, `Times New Roman`, `Helvetica Neue`, `Courier New` — installed in no build
of this image. Fixed, and a test now fails if any `_FONT_*` names an uninstalled face
first.

**3. Missing HSN/SAC rendered as an em-dash — HELD, fixed.** `code = ... or "—"` reads
as "no code applies" rather than "the mandatory code is absent". Now blocks on a tax
document (Rule 46(g)) and marks red on a proforma.

**4. Western digit grouping on Indian statutory documents — HELD, fixed.**
`f"{n:,.2f}"` gives `548,652.00`; the correct Indian 2,2,3 grouping is `5,48,652.00`.
`18-documents.md` §Numbers requires it. `doc_fonts.group_indian()`.

**5. `esi_number` existed but was never selected or rendered — HELD, fixed.**

**6. `vetana.py` queried four columns that do not exist — HELD, fixed.** The most
serious find. `download_payslip_pdf` joined
`staging.manav_departments d ON d.id = e.department_id`; **`manav_employees` has no
`department_id`** — it holds the department as a NAME string, which is how `manav.py`'s
own roster counts members (`WHERE department = d.name`, `manav.py:450`), and its INSERT
(`manav.py:292`) lists `department` and no id. That join raises `UndefinedColumnError`,
so **every payslip PDF download was a 500** and the validation added alongside never
ran. The payroll-run email path had three more: `employee_id` (the column is
`employee_code`), `bank_account` and `bank_name` (both inside the `bank_details` JSONB,
which the *download* route reads correctly — the asymmetry between the two queries is
what gave it away).

*Evidence and its limit:* no migration adds any of the four; `manav.py`'s INSERT and
SELECT column lists prove the real set. I did **not** query the database to confirm —
that is out of bounds. Every replacement column is one `manav.py` demonstrably writes,
so the fix is correct whether or not the originals were ever added out of band.

**7. `except ImportError` around the WeasyPrint import — HELD, fixed.** A machine or
image without pango/cairo fails at `dlopen` with `OSError`, not `ImportError`, so the
intended "WeasyPrint is not available" message never fired and it surfaced as a 500
with a stack trace. Reproduced on this machine.

**8. The invoice download swallowed the error entirely — HELD, fixed.**
`catch { pushToast({title:'Failed to generate PDF'}) }` discarded the response body.
`frontend/src/lib/docErrors.js` now names the missing fields and where to set them.

---

## 4. Statutory rules now enforced

`backend/services/doc_validation.py`. Blocking = refuse; advisory = render, marked red.
Every gap cites the rule it rests on and names where the user fixes it.

**Tax invoice / credit note / debit note — BLOCKING:** supplier GSTIN (Rule 46(a));
invoice number and date (46(b)); supplier legal name (46(a)); recipient name (46(e));
at least one line; HSN/SAC on **every** line (46(g), names which line); place of supply
**when inter-state** (46(n)); and a self-contradictory tax split (`is_igst` with
CGST/SGST present, or the reverse) — `18-documents.md`: never a merged "GST".

**Payslip — BLOCKING:** employer name; employee name; wage period (Payment of Wages Act
s.4); payslip number; **figures that do not reconcile** (`|gross − deductions − net| > ₹1`);
PF deducted with no UAN; ESI deducted with no ESI number; TDS deducted with no PAN
(s.206AA — deduction cannot reach Form 26AS).

**Deliberately NOT blocking, each for a reason:**
- **Recipient GSTIN** — a B2C sale to an unregistered buyer legitimately has none.
  Blocking would put a hard error on every consumer invoice.
- **Place of supply on an intra-state supply** — Rule 46(n) scopes the requirement to
  inter-state. `place_of_supply` is `DEFAULT ''`, so a blanket rule would 422 every
  historical invoice: rigour that is actually a regression.
- **Quotations and proformas** — an offer is not a tax document.
- **`pf_number`** — advisory only, because **no column exists**. A blocking rule against
  an unrepresentable field would refuse every payslip in the system.

Each statutory identifier is conditional on the deduction actually being taken, so an
employee below the PF threshold is never blocked for having no UAN.

---

## 5. Bilingual in print

`backend/services/doc_fonts.py` + `backend/assets/fonts/` (SIL OFL, licences committed).

- **Tiro Devanagari Hindi** vendored and declared with `@font-face` by `file://` URL.
  Resolution no longer depends on fontconfig finding anything, and WeasyPrint subsets
  and embeds the face into the PDF. No network at render time (`base_url=None`).
- **Newsreader** — upstream publishes **only** a variable font. Selecting a weight off
  a variable axis is renderer-dependent, and a face that silently renders at the wrong
  weight is the same defect as the DejaVu fallback, one level subtler. So the three
  faces `brand.css` uses (400, 600, italic 400) are **pinned static instances**,
  generated reproducibly by `backend/scripts/vendor_document_fonts.py`.
- **No Dockerfile change is needed**, which is the point: a wrong apt package name
  breaks the production image build. Vendoring avoids that risk entirely. If a human
  prefers apt anyway, the packages would be `fonts-noto-core` (Devanagari) — Newsreader
  and Tiro are **not in Debian at all**, so apt cannot deliver pixel-correctness here.

**Conjuncts — verified, not assumed.** `कर्तव्य` is
`क + र + ्(virama) + त + व + ्(virama) + य`: `rphf` turns ra+virama into the repha
riding above the next consonant, `half`/`cjct` form the below-joined `व्य`.
`tests/test_document_statutory.py` reads the font binary directly and asserts:
- every codepoint in the **repertoire extracted from all eight design documents** is in
  the cmap (including U+094D virama and U+093C nukta for `दस्तावेज़`);
- GSUB declares Devanagari (`dev2`/`deva`);
- GSUB carries `nukt, akhn, rphf, blwf, half, pres, abvs, psts`, plus one spelling each
  of ra-kar (`rkrf`|`vatu`) and conjunct formation (`cjct`|`haln`).

*My first version of this test asserted the `deva` (v1) feature names and failed —
Tiro is a `dev2` font that spells the same work `rkrf`/`cjct`. The test was wrong, not
the font; corrected rather than relaxed.*

**Two shaping hazards, both guarded.** Tiro is single-weight 400, so (1) a `font-weight:700`
run would get a synthesised bold applied *after* shaping, smearing the ligature joins —
the `.deva` class pins 400 and sets `font-synthesis:none`; (2) `letter-spacing` is
applied between glyphs after shaping, so any tracking detaches the repha from its base —
`.deva` sets `letter-spacing:normal`. `brand.css` makes the same reservation itself
(`.lh__kind` sets `0.16em`, `.lh__kind-hi` resets to `0`). Tests assert both.

**Degradation.** `deva_span(text, fallback)` emits the Latin fallback when no Devanagari
face is present. A statutory document showing `▯▯▯▯` is a defect; the reader gets fewer
words, never broken ones.

---

## 6. The harness

`backend/scripts/render_documents.py` → `backend/.doc-harness/` (gitignored; the
harness is committed, the output is not).

**Part A — the specification as authored.** All eight documents on the real vendored
`<doc-page>`, emitted once per tenant (24 files) with the tenant baked in and the
switcher removed. Includes **Nirmal Exports, which has no GSTIN** and must show the red
blocker rather than a plausible invoice.

**Part B — what the product actually generates.** Eight fixture cases through the live
WeasyPrint path, including the ones that must be refused. A refused case writes a
`.REFUSED.txt` naming every blocking field — **that file is the artefact to inspect.**
Verified working: `tax-invoice--no-supplier-gstin`, `tax-invoice--missing-hsn`,
`payslip--pf-deducted-no-uan`, `payslip--figures-do-not-reconcile` all refuse correctly.
`quotation--no-gstin-is-fine` correctly does **not** refuse.

Part B's PDF rendering needs the native stack and is skipped with a clear note where
absent (as on this Windows machine); Part A and all refusal artefacts still run.

`index.html` states per document whether it is **live** or **spec only**. Six of eight
are spec only. The harness should not flatter that.

---

## 7. What I did not finish

- **Six documents have no generator** (§2.4–2.8). The audit is the input to building
  them; I did not build them, and several cannot be built without schema first.
- **`PROPOSED_080` is not applied** — proposals only, with rollback. Number surveyed
  across all refs first (079 was highest).
- **No live PDF was rendered to bytes by me.** No pango/cairo on this machine. The
  validation half is fully exercised by 64 tests; the *visual* output of the font work
  needs one run of the harness on a machine with the native stack. **This is the single
  highest-value thing for the next person to do.**
- **Brand accent per tenant** (§2) is still unbuilt — `brand.css` flags it itself.
- I did not verify the four missing `manav_employees` columns against the live
  database. Out of bounds. See §3.6 for exactly what the evidence is.

## 8. Handoffs

- **vetana** — §2.2 and §3.6. The payslip PDF route was returning 500; fixed here, but
  please confirm `department_id` really is absent when you next touch that schema.
  Leave balance and UTR are the two remaining payslip gaps.
- **ganit** — §2.1. Ganit's tax schema is **fine** for CGST+SGST; the `18-documents.md`
  worry does not apply. Real gaps are IRN/e-invoice fields and shipped-to.
  **Statement of Account is the cheapest document left to build** (§2.4).
- **whoever owns org settings** — `PROPOSED_080` adds TAN, PF establishment code and ESI
  employer code; the profile form needs controls for them, and `brand_color` remains
  unbuilt.
