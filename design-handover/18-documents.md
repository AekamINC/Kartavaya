# 18 · Documents

Prereq: `00-tokens.md`. Eight print-ready documents with a shared tenant brand layer.

Design source: `docs/` — `Document Kit.html` (index), `Tax Invoice.html`, `Quotation.html`, `Statement of Account.html`, `Payslip.html`, `GSTR-3B Summary.html`, `TDS Challan.html`, `Service Agreement.html`, `Project Report.html`, `brand.css`, `doc-page.js`.

---

## The brand layer

One stylesheet, `brand.css`, sets the tenant's identity as custom properties on the document root. Switching tenant reflows all eight documents.

The important behaviour: **an unset field renders a visible red warning, not a placeholder.** Switching to Nirmal Exports — which has no GSTIN on file — shows a red `GSTIN NOT SET` where the number would go, rather than inventing one or silently omitting the line.

```css
.unset{color:var(--danger);border-bottom:1px dashed var(--danger);font-size:.9em}
```

A tax document that silently omits a GSTIN looks complete and is not. An invented one is worse. The red is deliberately ugly because it must never survive to a customer.

---

## Print geometry belongs to the component

`doc-page.js` owns paper size, margins, page breaks and the desk background. Do not write `@page` rules, page-break CSS, or fake page-card sheets around it.

Two modes, chosen up front:

- **Flowing** — content as one normal HTML flow inside `<doc-page>`; the print engine paginates onto the user's real paper. Used for GSTR-3B, statement of account, project report.
- **Explicitly paginated** — one `<section class="page">` per page, fixed page box, overflow hidden. Used for the payslip, TDS challan and the two-page service agreement.

Explicitly paginated pages must fill the box and fit **both** Letter and A4 without overlap — so no viewport units and no height assumptions.

### The phone reading layer, and the mistake worth recording

Making these readable on a phone took two attempts. The first drove `!important` widths from the outer document and clipped 426px of every table — hiding the tax columns and the totals block entirely. That was a regression, not a fix.

The component keeps its geometry in shadow DOM, where `::slotted(.page)` sets width and height with `!important`. **For slotted elements a shadow-tree `!important` beats an outer-document one**, so the override never applied. The correct approach is to drive the component's own variables on the host:

```css
@media(max-width:1023px){
  doc-page{--doc-page-w:100%;--doc-page-h:auto;--doc-page-ar:auto;--doc-page-margin:0}
}
```

Those inherit across the shadow boundary, so the component's own `!important` declaration resolves to the fluid value. `min-width: max-content`, `min-height: 100vh` and the desk padding are `:host` declarations, which an outer rule on the host outranks without `!important`.

Tables get horizontal scroll with **both** axes stated — authoring only `overflow-x` makes the other axis compute to `auto` and adds a spurious vertical scrollbar:

```css
.tbl__wrap{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
```

The tenant switcher converts from `fixed` to `sticky` at ≤1023px, not ≤767px. It must stop floating the moment the page loses its desk margins — a fixed pill permanently occluding a band of a document is wrong at any width, and on a long tenant name it sat directly over the org's own name in the letterhead.

---

## Document-specific requirements

### Tax invoice

A compliant Indian tax invoice needs: supplier GSTIN, recipient GSTIN, place of supply, HSN/SAC per line, taxable value, **IGST or CGST+SGST as separate lines** (never a merged "GST"), total in words, and a declaration. Resolve the split from the billing state via `lib/gst.js` (`13-module-pages.md`).

**Correction.** This paragraph previously cited `11-platform-admin.md` for "the single `gst` column in the current schema". Wrong table. Read in full: `11-platform-admin.md:47` describes `AdminBillingPage.jsx` — **Aekam's own subscription invoices to its client organisations**, a platform-side artefact. A tenant's tax invoice is Ganit's schema, which this file has not audited. The flat-18% defect is real where it was found; it says nothing about whether Ganit can represent CGST+SGST. Verify Ganit's invoice schema separately before scoping that work.

### GSTR-3B summary

Real return structure: 3.1 outward supplies with the tax split, section 4 eligible ITC including reversals and 17(5) ineligibles, 6.1 payment of tax, then cash payable in words. It states it is a **working paper with no ARN**, and names the two invoices held back for missing HSN rather than quietly excluding them — the same honesty rule as `excluded_count` in the Dristi pivot.

### TDS challan

ITNS-281 counterfoil with a section-wise schedule (194C, 194J, 194I(b), 194H, 192B), the amount breakdown as deposited, and the CIN triple — BSR code, tender date, serial.

### Payslip

Earnings and deductions with PF, ESI, PT and TDS as separate lines, net pay in words, and the statutory identifiers (UAN, PF number, ESI number).

### Service agreement

Two pages, explicit pagination. The commercially load-bearing clause: a milestone is invoiceable on **completion**, not on sign-off, and sign-off not withheld in writing within seven working days is deemed given. That clause is why the document exists.

### Project report

Position at a glance with plan / actual / variance, milestone forecast, ranked risks with owners, decisions requested by date. It says milestone 2 is nine days late, explains why milestone 3 hasn't moved yet, and states what date it would.

---

## Numbers

Every rupee figure: `toLocaleString('en-IN')` for 2,2,3 grouping and `font-variant-numeric: tabular-nums`. `lib/inr.js` (`13-module-pages.md`).

Amounts in words are required on tax documents and are not a `toLocaleString` output — they need an Indian-system converter (lakh, crore), not the Western short scale. `lib/amountInWords.js`.

---

## New files

```
frontend/src/lib/docBrand.js             tenant → brand custom properties
frontend/src/lib/amountInWords.js        Indian system
frontend/src/styles/doc.css
frontend/src/components/docs/DocPage.jsx  wraps <doc-page>
frontend/src/pages/docs/*.jsx             one per document
public/doc-page.js                        the web component, unmodified
```

`doc-page.js` is a vendored component — copy it in, don't fork it. Upgrading means recopying to the same path.

---

## What changes

| File | Change |
|---|---|
| `pages/GanitPage.jsx` | Invoice and quotation render through `docs/TaxInvoice.jsx` instead of ad-hoc markup |
| `pages/ManavPage.jsx` / Vetana | Payslip through `docs/Payslip.jsx` |
| `pages/OrgSettingsPage.jsx` | Profile fields feed `docBrand.js`; the logo's "where it appears" list includes invoice header |
| `index.html` | `<script src="/doc-page.js">` |

### Export

`<doc-page>` documents are print-ready — PDF export needs only the mechanical print copy, never a rebuild. Do not add `@page` CSS or a separate print stylesheet; the component owns print geometry, and adding a second source of truth is how a document that looked right on screen prints with a broken page break.
