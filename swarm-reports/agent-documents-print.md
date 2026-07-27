# Documents & print output — agent report

Branch: `worktree-agent-a8f4f5f6f463bae98`
Base: `origin/staging` @ `666b0ea`
Scope: every document this product generates as a PDF or print output.

> Status: IN PROGRESS. This file is appended to as claims are confirmed.
> Every claim is marked **HELD** (re-verified against the code on this branch)
> or **STALE** (a prior report's claim that no longer matches the code).

---

## 0. Branch hygiene note (read first)

This worktree branch arrived carrying 13 commits that had nothing to do with
documents (R2 attachment signing, CORS spelling, PgBouncer retry). They were
**already on `origin/main`** (`git branch -r --contains 1aa4985` → `origin/main`),
i.e. shipped to production, and staging had simply diverged. The branch was reset
to `origin/staging` rather than rebased, so nothing unique was discarded. Verified
before resetting, not after.

---

## 1. The decision that governs everything else: `<doc-page>` vs. WeasyPrint

**Chosen: keep server-side WeasyPrint. Do not ship `<doc-page>` as the PDF engine.**

The task allowed either, and required that the two not run in parallel. Here is
the reconciliation.

### What the repo actually has (HELD)

PDF generation is **server-side WeasyPrint**, not browser print:

| File | Purpose |
|---|---|
| `backend/services/invoice_pdf.py` | Ganit tax invoice / proforma / credit note / debit note / quotation / export invoice |
| `backend/services/payslip_pdf.py` | Vetana payslip |
| `backend/services/cost_report_pdf.py` | Platform cost report |
| `backend/services/report_generator.py` | Scheduled report PDF + XLSX |

Endpoints:
- `GET /api/ganit/invoices/{invoice_id}/pdf` — `backend/routers/ganit.py:458`
- `GET /api/vetana/payslips/{payslip_id}/pdf` — `backend/routers/vetana.py:857`
- payslip PDF is also generated for **email attachment** at `backend/routers/vetana.py:584`
- report PDF at `backend/routers/reports.py:298` and `:459` (scheduled delivery)

`backend/Dockerfile` installs the full WeasyPrint native stack (pango, cairo,
harfbuzz, gdk-pixbuf) explicitly "required by WeasyPrint". This is not incidental.

### Why `<doc-page>` cannot replace it

`<doc-page>` is a **browser** component. Its entire contract is `window.print()`
in a real browser: it injects `@page` rules into `document.head`, measures slot
heights with `requestAnimationFrame`, reads `document.fonts.ready`, branches on
`navigator.vendor` for a WebKit print bug, and uses shadow DOM `::slotted()`
`!important` for print geometry.

Adopting it as *the* PDF engine means adding a headless-Chromium render service.
Concretely that means:

- a second runtime in the backend image (Chromium is ~400 MB on top of a
  `python:3.13-slim` base that is currently ~200 MB);
- the payslip email path (`vetana.py:584`) becomes an outbound HTTP hop inside a
  request that already sends mail;
- two rendering systems during any migration window, which the task forbids.

Against that, WeasyPrint already produces the *same class* of artefact and is
already deployed, already has native deps pinned, and already renders
`@page { size:A4; margin:0 }` fixed-layout pages.

### What `<doc-page>` is kept for

The spec is not discarded — it is the **design authority**, and it stays the
authority for two things this branch honours:

1. **The brand layer contract.** `brand.css` tokens, the `.unset` red-warning
   rule, the letterhead / meta / parties / lines / totals / words / foot
   structure, the tenant `data-org` accent model.
2. **The screen-side preview and the harness.** The harness (below) renders the
   eight design HTML files as authored, on the real vendored `doc-page.js`, so a
   human can inspect them and diff them against the WeasyPrint output.

The spec's own instruction is honoured on the point that matters most:
`18-documents.md` §"Print geometry belongs to the component" says do not write a
second source of truth for page geometry. In the WeasyPrint path there is exactly
one: the `@page` rule in each `_build_html`. No `<doc-page>` is loaded, so no
conflict exists. **`index.html` does NOT get `<script src="/doc-page.js">`** —
adding it would create the second system the task forbids.

**Recorded as a spec/implementation divergence, deliberately:**
`18-documents.md` §"New files" lists `public/doc-page.js`,
`frontend/src/components/docs/DocPage.jsx` and `frontend/src/pages/docs/*.jsx`.
Those are not created. The reason is above. Anyone reversing this decision needs
to budget for a headless-browser service first.

---

*(sections 2–6 appended as work completes)*
