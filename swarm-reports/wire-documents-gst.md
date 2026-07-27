# Wiring the six built documents, and building the GST filing screen

Branch `wire-documents-gst`, cut fresh from `origin/staging` at `190fa73a`
(verified — the worktree seeded stale at `1aa49855`, exactly as warned).

**Rebased before hand-off** onto `0e9f8d75`, which eight peer commits added
while this work was in progress. The rebase was clean: **zero file overlap**
between their 30 files and my 15. `components/ui/ErrorState.jsx` and
`errorKind` changed underneath me and I depend on both, so every gate was
re-run against the new base — all green.

---

## 1 · The premise, re-verified

`grep -rn "v1/documents" frontend/src mobile` returns **nothing** on
`190fa73a`. All six endpoints had zero callers. Confirmed before touching
anything.

The stale peer report (`agent-documents-print-output.md` §2.4, §2.6) claiming
Statement of Account and TDS Challan are "NOT BUILT" is **wrong**:
`services/statement_pdf.py` and `services/tds_challan_pdf.py` both exist with
full validators in `doc_validation.py` (`validate_statement` at :811,
`validate_tds_challan` at :655). Both are wired below.

### The live catalogue, not the ledger

Re-read against Supabase `toacecaewujfxjfrjwco`, schema `staging` (read-only):

| claimed missing by `documents.py` docstring | actually present today |
|---|---|
| `organisations.tan` | **exists** (`character varying`) |
| challan table | **exists** — `ganit_tds_challans`, 24 columns incl. the full CIN triple |
| `ganit_vendor_bills.cess` | **exists** (`numeric`) |
| milestone / risk / baseline stores | **exist** — `project_milestones`, `project_risks`, `project_baselines` |

**The module docstring in `routers/documents.py` is now stale on all four
points.** I did not rewrite it — it is load-bearing prose that a peer agent may
be editing, and correcting it is not the same task as wiring the UI. Flagged
here as the follow-up. Note the routes still *work*: `_load_org` reads TAN from
`settings` as a fallback and the column is simply preferred once populated.

Still genuinely absent, confirmed by query: **no GSTR-2B store of any kind** —
no table matching `%2b%`, `%gstr%`, `%recon%`, `%itc%`. The only 2B artefact in
the codebase is `gstr2b_date`, a date the preparer asserts on the working paper.

---

## 2 · Which of the six are now reachable, and from where

| document | trigger | route |
|---|---|---|
| **Quotation** | `ganit/InvoiceDetail.jsx` — "Download quotation", shown only when `invoice_type` is `quotation`/`proforma` | `GET /v1/documents/quotations/{id}/pdf` |
| **Statement of account** | `graha/ContactsTab.jsx` — contact detail, own panel with a date range | `GET /v1/documents/contacts/{id}/statement/pdf` |
| **GSTR-3B working paper** | `ganit/StatsTab.jsx` — File & share panel | `POST /v1/documents/gst/gstr3b/{period}/pdf` |
| **TDS challan (ITNS-281)** | `ganit/StatsTab.jsx` — "Prepare counterfoil" form | `POST /v1/documents/tds/challan/{period}/pdf` |
| **Service agreement** | `ganit/ContractDetail.jsx` — own drawer section | `POST /v1/documents/contracts/{id}/agreement/pdf` |
| **Project report** | `ProjectBoardPage.jsx` — "Report" toggle in the header | `POST /v1/documents/projects/{board}/report/pdf` |

All six go through one helper, `lib/documents.js`, so the blob mechanics and the
refusal handling exist in exactly one place.

### Request bodies were read, not invented

- **GSTR-3B** — `{}`. Every `Gstr3bOverrides` field is a figure a preparer
  *ascertains* (imports, ISD credit, reversals). Sending a fabricated number
  would put it on a tax working paper.
- **TDS challan** — a real form. `deposit_date`, `major_head` (0020/0021),
  `payment_type` (200/400), `bsr_code` (7 digits), `challan_serial` (5 digits)
  are all **required with no default** on `TdsChallanBody`, so a button alone
  could never have worked. The form mirrors the server regexes client-side and
  disables the download until the CIN is complete — the server stays the
  authority, but a mistyped 6-digit BSR is caught at the field.
- **Service agreement** — only `governing_law` and `governing_seat`, the two
  the drawer actually collects. Both are *advisory* on the validator, so the
  document renders without them, but a dispute-resolution clause with an empty
  seat resolves nothing. Every other `AgreementBody` field keeps the router's
  considered default.
- **Project report** — `{}` plus the period query. The plan side, milestones
  and risks have no reachable API, and the route deliberately reports
  actual-only rather than a variance against a plan of zero.

### The 422 shape

`lib/docErrors.js` already existed on staging and **already handles the object
shape correctly** — the bug described in the brief ("read a 422 detail as a
string when it is an object") is fixed in that file. I built on it rather than
re-fixing it, and added the regression tests it had none of.

Failures render as an inline, persistent `role="alert"` block
(`components/ui/DocumentError.jsx`), **not** a toast. These refusals are
worklists — "this challan has no TAN", "this agreement names no client" — and
the user leaves the screen to act on them; a message that has faded by the time
they return has told them nothing. Tinted `--warn`, not `--danger`: nothing
broke, the backend declined to emit a document that would have *looked*
complete.

---

## 3 · The GST filing screen (`ScreensBiz.jsx:60–117`)

`StatsTab.jsx` was rewritten in place. The tab id stays `stats` (it is what
`Data.jsx:122` calls it); the visible **label is now "GST filing"**, because
"stats" sends a preparer looking for GSTR-3B everywhere except the tab holding
it.

What was removed and why nothing is lost:

- the five invoice tiles duplicated `KpiStrip` in `GanitPage.jsx`, rendered
  directly above them — in the reference those figures are the row *above* the
  tab bar (`ScreensBiz:17–23`), not this tab's body;
- the cash chart is the Dashboard's and already lives at
  `pages/today/CashPosition.jsx` (verified: two callers of `/cash-position`
  existed, this was the redundant one).

### What the screen shows

| panel | state |
|---|---|
| **Pre-filing validation** | **Real, computed.** Findings, not illustrations. |
| **GSTR-3B summary** | **Real, computed.** Same arithmetic as the PDF. |
| **File & share** | GSTR-3B export real; GSTR-1 JSON and Tally XML **honestly disabled**; share builds a URL and never dispatches. |
| **GSTR-2B reconciliation** | **Honest empty state.** No data exists. Not faked. |
| **TDS challan** | Real form → real document. |

### The JSON sibling (small, safe backend addition)

No JSON sibling existed. I extracted the assembly in `download_gstr3b_pdf` into
`_assemble_gstr3b()` and added **`GET /v1/documents/gst/gstr3b/{period}`**,
which reads that same helper and the same `gstr3b_pdf.compute()`. The screen and
the document therefore **cannot state different tax** — that was the whole point
of not re-deriving Table 3.1 in JavaScript. Nothing is written; the POST route is
byte-for-byte unchanged in behaviour.

Pre-filing checks are computed, not hard-coded. The design panel lists three
findings; two are checks this codebase can genuinely make:

1. **HSN/SAC missing** (rule 46(g)) — reuses the working paper's existing
   `held_back` list, so the screen names exactly the invoices the PDF excludes.
2. **Counterparty GSTIN fails its check digit** — `services/gstin.is_valid`
   over every party invoiced in the period. Named individually; "2 blockers"
   alone is not actionable.
3. **Supplier GSTIN missing** — `validate_gstr3b` blocks on this, so the screen
   says so up front instead of letting the user discover it via a 422.
4. **Place of supply not recorded** — reported as `info`, phrased as what the
   data says rather than the reference's illustrative sentence.

### What it does NOT show, deliberately

- **GSTR-2B match rate.** The reference draws "42 / 47 matched · 3 mismatched ·
  2 missing". There is no 2B store. The panel says so, and explains that the
  Eligible ITC figure is tax on *recorded* vendor bills — not confirmation the
  credit appears in the 2B, which is the most common notice a firm receives.
- **"Kartavaya is a registered GSP — invoices upload to the IRP directly. Last
  sync 14 min ago."** Kartavaya holds no such registration. The screen states
  the opposite, plainly. A false regulatory claim on the screen a firm files
  taxes from is the worst thing this file could have said.
- **Rows with no column** (reverse charge, nil/exempt, non-GST, ITC reversals)
  render **"not recorded"**, italic and in the body font — never `₹0`. A zero
  asserts that no such liability arose, which is a far stronger claim. The API
  returns `recorded: false` and a `not_recorded` list so the UI cannot
  accidentally paint a confident nil.

### Nothing is dispatched

"Share with your CA" builds a `mailto:` with **no recipient** and the summary in
the body. The user picks the address in their own client and presses send. No
send endpoint is called — asserted by test (`expect(get).toHaveBeenCalledTimes(1)`,
and that one call is the summary GET). `OUTBOUND_MODE` is not involved because
there is no outbound path here to gate. Same shape as the existing WhatsApp
control on the invoice drawer.

---

## 4 · Gates

Measured twice: on my original base `190fa73a`, and again after rebasing onto
`0e9f8d75`. The post-rebase numbers are higher on both suites because the eight
peer commits bring their own tests.

| gate | baseline (`190fa73a`) | mine, pre-rebase | **after rebase (`0e9f8d75`)** |
|---|---|---|---|
| `check-tokens.mjs` | 0 missing | 0 missing | **0 missing, exit 0** |
| `check-classes.mjs` | 0 missing a rule | 0 missing a rule | **0 missing a rule, exit 0** |
| `vite build` | ok | exit 0 | **exit 0** |
| `vitest run` | 43 files / 682 | 45 files / 701 | **46 files / 716, 0 failed, exit 0** |
| `pytest -q` | 1475 / 122 skip / 0 fail | 1482 / 122 / 0 | **1488 / 122 skip / 0 fail, exit 0** |

My contribution is +19 frontend tests and +7 backend tests. `grep -ci unhandled` = **0**, same as
baseline. Final run of both suites: **exit 0**.

**One flake worth knowing about:** `npx vitest run` intermittently exits **1
with every test passing** and nothing after the summary. I hit it twice — once
on the *clean tree before editing anything*, once mid-work — and the final run
exited 0. It is pre-existing and not deterministic, so a red CI here is worth
re-running before investigating. Test counts were identical on every run.

---

## 5 · Verification, and what I did NOT verify

**Verified in a real browser.** Screenshots and `navigate` both failed (a
`navigate` call timed out at 300s), but `javascript_tool` works. I rendered the
component's real DOM through vitest, then injected that markup plus the new CSS
into a live Kartavaya tab and measured with `getBoundingClientRect` /
`getComputedStyle`:

- 1280px → grid `616px 616px`, two genuine side-by-side columns (x=16, x=648), no overflow;
- 380px → collapses to one `348px` column, panels stack (y=16 → y=648), no overflow;
- blocking vs info findings resolve to visibly different containers
  (`rgb(85,32,27)` vs `rgb(20,67,42)` — the tab was dark theme, so both tokens
  flip correctly);
- "not recorded" computes to `italic` in Inter, not the mono figure font.

**NOT verified:**

- **No end-to-end run against a live backend.** The running dev server is bound
  to the main repo, not this worktree, and the app is behind a login I must not
  perform. Every route is exercised against a mocked pool in
  `tests/test_document_routes.py` (25 tests) and the frontend against a mocked
  `api`, but no document was generated from real org data in a browser.
- **No PDF was rendered.** The renderers need WeasyPrint's native stack; the
  route tests stub `generate_*_pdf`. I changed no renderer.
- **The four other triggers' visual layout** (quotation button, statement panel,
  agreement section, report panel) — asserted by class/token gates and build,
  but not measured in a browser like the GST screen was.
- **`ganit_tds_challans` is not read or written.** The table now exists but no
  endpoint touches it; the challan form still posts the CIN per-document. Saving
  a challan is a follow-up, and would need a write path I am not permitted.
- **`project_milestones` / `project_risks` are not read.** The report body
  accepts them and the tables now exist, but no API exposes them, so the report
  still prints the advisory "no milestone store" note. Follow-up.

---

## 6 · Files touched

**Backend (2)**
- `backend/routers/documents.py` — extracted `_assemble_gstr3b`, added
  `_prefiling_checks` and `GET /gst/gstr3b/{period}`. POST behaviour unchanged.
- `backend/tests/test_document_routes.py` — +7 tests.

**Frontend, new (4)**
- `frontend/src/lib/documents.js`
- `frontend/src/components/ui/DocumentError.jsx`
- `frontend/src/__tests__/documentDownload.test.js`
- `frontend/src/__tests__/ganitGstFiling.test.jsx`

**Frontend, modified (8)**
- `frontend/src/pages/ganit/StatsTab.jsx` — rewritten as the filing screen
- `frontend/src/pages/ganit/InvoiceDetail.jsx`
- `frontend/src/pages/ganit/ContractDetail.jsx`
- `frontend/src/pages/graha/ContactsTab.jsx`
- `frontend/src/pages/ProjectBoardPage.jsx`
- `frontend/src/pages/GanitPage.jsx` — tab label only
- `frontend/src/styles/ganit.css` — appended `.gn-gst*`, `.gn-tag*`, `.gn-chk__*`
- `frontend/src/styles/components.css` — appended `.docerr*`

No `yarn.lock` / `package-lock.json`. A line-ending-only change to
`visual-regression.test.jsx.snap` was reverted. `.claude/launch.json` was touched
during verification and restored — `git status` is clean of it.

Nothing was restyled that did not have to be. `StatsTab.jsx` is the one file
rewritten wholesale, and its pre-existing test
(`ganitErrorStates.test.jsx` — "StatsTab renders an error rather than nothing at
all") still passes unmodified against the new screen.

## 7 · Constraints honoured

- Database **read-only** — catalogue queries only, no writes, no migrations.
- **No email, WhatsApp or push** on any path added.
- **No pricing figures** anywhere, including comments. Test amounts are
  synthetic tax figures, not prices.
- Currency INR, brand **Kartavaya**, domain **kartavaya.com**.
- `ganit` separated duty untouched — no guard, role or gate was modified.
- Every read goes through `rows()` / `body()`; no hand-rolled `r.data.data`.
- Zero raw CSS property values in markup — no inline `style` was added at all.
- `main` never touched.
