# Gap register — the approved design vs what exists

**Measured 2026-07-27. Ship date 15 August — 19 days.**

> **Updated after the conversion round: 3,215 → 613 real inline styles.**
> srijan/hub 830→8 · graha 648→9 · manav 609→14 · ganit 548→7, all verified on
> the tab directory and all survivors the permitted `--c` custom-property form.
> Two agents now running on the remainder (top-level workflow pages, and
> pahchan/org/marketing); the documents agent is still running.
>
> **This does NOT mean pixel-perfect.** Converting inline styles to tokens makes
> a page themeable and density-aware; it does not prove it matches the mockup.
> Every one of the four agents failed to get a browser tab — the pane was at its
> cap with every tab held by a peer — so **visual fidelity remains unverified
> across all four modules**. That gap closes only with the owner's eye or a real
> e2e pass.

This is the document that should have existed before any agent ran. Every gap
the owner has found by opening a page is in here, plus the ones nobody has
opened yet. Regenerate every number; never transcribe.

---

## 1. PRINT DOCUMENTS — the largest undiscovered gap

`design-reference/Kartavaya Redesign/docs/` is the approved specification for
every PDF this product generates. **Nine documents are specified. Two are
built.**

| document | spec file | generator | state |
|---|---|---|---|
| Tax Invoice | `Tax Invoice.html` | `services/invoice_pdf.py` | **built** |
| Payslip | `Payslip.html` | `services/payslip_pdf.py` | **built** |
| Quotation | `Quotation.html` | `invoice_pdf.py` doc_type label only | **partial — renders through the invoice generator, not matched to its own spec** |
| Statement of Account | `Statement of Account.html` | — | **MISSING** |
| GSTR-3B Summary | `GSTR-3B Summary.html` | — | **MISSING** |
| TDS Challan | `TDS Challan.html` | — | **MISSING** |
| Service Agreement | `Service Agreement.html` | — | **MISSING** |
| Project Report | `Project Report.html` | — | **MISSING** |
| Document Kit | `Document Kit.html` | — | **MISSING** (cover/index for the set) |

**Why this is the top item.** The two waiting clients are Indian accounting
firms. **GSTR-3B and TDS Challan are not nice-to-haves for that buyer — they are
the daily work.** A CA firm evaluating this product will look for them first.
Five missing documents is backend work, and the owner has authorised building
backend where it is missing.

`services/doc_validation.py` validates only `validate_tax_invoice` and
`validate_payslip`, so the five new documents need validators too, not just
renderers.

---

## 2. SCREENS — route coverage is complete, page completeness is not

All 18 reference screens have a route in `App.jsx`. Nothing is unrouted. The
problem is not missing pages — it is that pages are **one tab deep**.

Reference screens, all present as routes: `ScreenDash`, `ScreenBoards`,
`ScreenTasks`, `ScreenApprovals`, `ScreenGraha`, `ScreenGanit`, `ScreenManav`,
`ScreenVetana`, `ScreenVikray`, `ScreenDristi`, `ScreenPrachar`, `ScreenSrijan`,
`ScreenHub`, `ScreenEsign`, `ScreenSanvaad`, `ScreenPahchan`, `ScreenRoles`,
`ScreenPlatform`.

### Inline-style debt, which is the proxy for "not converted"

**3,215 real inline styles** (comments excluded) across the page tree. Every one
ignores the theme, the density control and the corner-radius control, so a page
carrying a hundred cannot look like the design and cannot respond to any
preference the customer sets.

| area | files | inline | state |
|---|---|---|---|
| (top-level pages) | 42 | **1,187** | Srijan/Hub ≈830 of it — **agent running** |
| graha tabs | 20 | **648** | **agent running** |
| manav tabs | 16 | **609** | **agent running** |
| ganit tabs | 11 | **548** | **agent running** |
| pahchan | 7 | 120 | not started |
| org | 12 | 26 | near done |
| marketing | 8 | 23 | near done |
| customize | 6 | 10 | near done |
| prachar / dristi / vetana / vikray | 33 | **16** | **DONE, verified** |
| inbox, sanvaad, esign, today, onboarding | 37 | 28 | near done |
| admin, client | 12 | 0 | done |

Four agents are running against the four largest rows — **2,635 of the 3,215**.
After they land, the remaining material gap is **pahchan (120)** and the
long tail of top-level pages outside Srijan/Hub (≈357).

---

## 3. MOBILE

Reference: `Mobile.jsx`, `MobileModules.jsx`, `MobileMore.jsx`, `MobileBoard.jsx`,
`MobileTask.jsx` + `Mobile App.html`.

The app has screens for Today, Tasks, Boards, Messages/Chat, Inbox, Approvals,
More, Settings, Reminders, Me, Client Portal, Pahchan (5 screens) and 7 module
screens. **Route coverage looks broadly complete; per-screen fidelity against
the reference has NOT been checked.** Nobody has done a screen-by-screen mobile
pass. Flagged, not measured — do not report mobile as done.

---

## 4. EMAIL

`design-reference/Kartavaya Redesign/Auth Emails.html` and `Email System.html`
are the spec. `backend/email_service.py` plus `services/employee_email.py` send
mail; there are **no HTML templates on disk** in the backend, so the markup is
inline in Python. **Fidelity against the email spec has not been checked.**

`backend/scripts/preview_emails.py` exists and is the way to check this without
sending anything.

---

## 5. CONFIRMED DEFECTS ALREADY FIXED THIS RUN

Kept because they show the class of bug that the styling metric cannot see, and
because each was live in a module that looked finished:

- **Vikray — stock never moved.** `fillFromProduct` dropped `product_id`, so
  confirming an order deducted nothing, forever. The Stock tab read zero for
  every product. It looked *empty* rather than *wrong*, which is why it survived.
- **Vetana — a failed request rendered "No payroll runs"**, which on a payroll
  screen asserts that nobody is owed anything, and is pixel-identical to a
  company with no employees. Six `catch {}` blocks each followed by a
  `length === 0` check.
- **Vetana — `process_payroll` emailed every employee** their payslip, re-sending
  on any re-run, and fired on one unconfirmed click.
- **Prachar — five of eight tabs could not render**; every ad spend figure showed
  `0`; the reference's scheduling calendar did not exist at all.
- **Dristi — every saved dashboard and scheduled report was invisible**; all five
  export buttons dead; `/pipeline` and `/sales` had no source-module check, so a
  Dristi grant alone read the full CRM pipeline and every salesperson's numbers.
- **All six module pages dropped the tab-panel key**, so the panel never
  re-entered and the motion the hook exists to produce never happened.

---

## 6. WHAT IS NOT VERIFIED, STATED PLAINLY

Do not let any of these read as done:

1. **No real end-to-end test exists.** Every verification so far is
   component-level or one agent's own browser against stubbed fixtures. The
   owner named Playwright e2e as a priority; it has not started.
2. **Mobile fidelity** — not checked screen by screen.
3. **Email fidelity** — not checked against the spec.
4. **Pahchan (120 inline)** — no agent has run on it.
5. **The 5 missing print documents** — not started.
6. The `_COVERAGE.md` metric counts `style={{` textually; files containing prose
   about inline styles overstate themselves. Numbers here exclude comments.

---

## 7. RECOMMENDED ORDER FOR 19 DAYS

1. **The 5 missing print documents** (GSTR-3B, TDS Challan, Statement of Account,
   Service Agreement, Project Report) — backend work, buyer-critical for a CA
   firm, and nothing else depends on it so it can run fully in parallel.
2. **Finish the four running conversions**, then pahchan and the top-level tail.
3. **Real Playwright e2e** across the ten module pages, both failure states and
   the RBAC gate — this is what replaces "an agent said it works".
4. **Mobile and email fidelity passes** — cheapest to leave last, but they must
   not ship unchecked.

## The rule this register exists to enforce

A thing is done when it has been measured on the artefact the customer sees —
the tab directory, the generated PDF, the sent email — never on the file that
routes to it.

---

## 8. The page-overrun question, settled by measurement

Measured in a real browser with `doc-page.js` actually running (WeasyPrint cannot
render these — the component is JS, so a WeasyPrint measurement of the spec HTML
is meaningless and an earlier one of mine was). Each authored `.page` forced to
A4 print dimensions, then `scrollHeight` compared to the sheet:

| document | authored pages | content | vs 297mm | |
|---|---|---:|---:|---|
| Tax Invoice | 1 | 297.1mm | +0.1 | fits |
| Payslip | 1 | 297.1mm | +0.1 | fits |
| Quotation | 1 | 297.1mm | +0.1 | fits |
| Statement of Account | 1 | 297.1mm | +0.1 | fits |
| Service Agreement | 2 | 297.1mm each | +0.1 | fits |
| **TDS Challan** | 1 | **327.0mm** | **+30** | **clips** |
| **Project Report** | 1 | **380.2mm** | **+83** | **clips** |
| **GSTR-3B Summary** | 1 | **406.7mm** | **+110** | **clips** |

**Five of eight are designed to fill the sheet to within 0.1mm.** That is careful
work, and it means the design is not casually broken — three documents are
genuinely over, and the rest are precise.

`doc-page.js` states its own contract: each `.page` prints as one full-bleed
sheet "with overflow hidden. Nothing scrolls and nothing reflows onto a next
sheet: content that misses the box is CLIPPED." So on GSTR-3B roughly **37% of
the document would be silently deleted**, and it is the BOTTOM that goes — the
6.1 payment table, the totals, and the signature.

**Decision: paginate. This is not a deviation to tolerate, it is the only
correct behaviour.** Clipping is right for a poster and wrong for a paper a
chartered accountant signs. Our generators paginate, and GSTR-3B's second page
carries real content (payment tail, "before you file", the missing-detail panel,
the signature) rather than an orphaned colophon.

Two corrections to the earlier agent report this supersedes:
- It listed **Quotation** as overrunning at 344mm. Measured in the browser it is
  **297.1mm — it fits.** Its number came from a WeasyPrint render that never ran
  the component.
- Its magnitudes (362/380/347) differ from these (406.7/327/380.2) for the same
  reason. **The three documents it identified are the right three.**

One thing it got right that would otherwise have shipped broken: `doc-page.js`
defaults to **US Letter (279mm)** and no spec document sets `size="a4"`. On
letter the GSTR-3B overflow is +127mm. Our generators pin A4, matching the two
pre-existing ones.

### Reproducing this
`.claude/launch.json` now has a `design-docs` entry serving the spec documents
over HTTP, because `file://` is blocked in the browser pane. Start it, open a
document, and force the print box:

```js
const page = document.querySelector('.page'), toPx = m => m * 96 / 25.4;
page.setAttribute('style', `width:${toPx(210)}px!important;height:${toPx(297)}px!important;aspect-ratio:auto!important;container-type:size;overflow:visible;box-sizing:border-box;`);
page.scrollHeight * 25.4 / 96;   // content height in mm, against a 297mm sheet
```

### Correction: `#0082c6` is not a retired colour

Two reports called it "the retired brand blue" and flagged
`doc_render.ACCENT2_DEFAULT` as a loaded gun. It is neither. `brand.css:31`
defines the aekam tenant as `--org-accent: #04837A; --org-accent-2: #0082c6`, and
the logo mark is `linear-gradient(140deg, var(--org-accent-2), var(--org-accent))`
— so the blue is the live SECONDARY accent.

The real defect on the invoice and payslip was narrower and still real: the
secondary was used where the PRIMARY belongs. `brand.css` closes the letterhead
with `2px solid var(--org-accent)`, so a document-kind heading is `#04837A`.

Checked, and left alone deliberately:
- `doc_render.py:122-123` — `accent or #04837A` / `accent_2 or #0082c6`. Mirrors
  `brand.css` exactly. **Correct.**
- `report_generator.py` — pairs `_TEAL` with `_DEEP` in gradients, which is what
  the design does for the logo mark. **Correct.**
- `cost_report_pdf.py:88,234` — secondary on a heading, where `brand.css` uses
  the primary. This is the only questionable use left, and it is the internal
  admin cost report, which is **not one of the nine specified documents**. There
  is no spec to conform it to, so changing it days before delivery would be
  inventing a design decision. Flagged, not changed.

---

## 9. The verification round — closed 2026-07-27

Seven agents, one verdict per file, ~470 files. **This is the first time anyone
looked at this product against its design.** Every earlier agent was blocked
from a browser tab and had to declare visual fidelity unverified.

Three of them solved that independently, and the pattern is worth keeping: **own
vite on a private port, a LOCAL stub API, and a gitignored `.env.local` pointing
every backend and Supabase URL at loopback** so the shared database is
*physically unreachable* rather than merely untouched. One mounted the real
components inside the real `AppShell` with the real stylesheet graph and swapped
`api.defaults.adapter` before mount. No session was ever taken against real
data.

**Screenshots failed all session** ("the Browser pane is not displayed, so the
page is not compositing frames"). Everything below is therefore measured layout
— `getComputedStyle`, `getBoundingClientRect`, `scrollWidth` — not images. That
is stronger evidence for structure and weaker for aesthetics, and the aesthetic
half remains the owner's to judge.

### The two owner complaints, answered

**"tab in crm is few only visible and rest is under more section."** The build
matches the design. The reference `TabBar` is `max = 6`; measured Graha
6 + `More +11`, Ganit 6 + `More +4`, Manav 6 + `More +5`, popover reading
`All tabs · 17` at the reference's own 230/340px. **This is a design
disagreement, not a fidelity bug**, and `max` is already a prop — one line
whenever the owner wants more inline.

**"only tab is done not the whole page."** Not reproduced across 26 module tabs.
Two genuine instances were found and one is fixed: `graha/ActivitiesTab` now
renders the list over an endpoint that had existed all along. **`ganit/
TimesheetTab` is still a form only** — no list of the entries being billed, and
unlike ActivitiesTab there is no ready GET; the unbilled-entries query lives
inside the POST. **Backend work, still open.**

### The false-empty class is dead

All 43 module tab-states driven to a real 500: **none printed an empty state.**
"No invoices", "no employees", "No payroll runs" never appear over a failure.
Manav's `useList` holds `items` at null whenever `error` is set, so a call site
cannot collapse the two.

Fixed in this round, each an empty state making a claim the failure falsified:
"No channels yet" to a member of nine; "No approved templates yet" on the only
path that reaches a customer after the WhatsApp 24-hour window closes; "No
transactions yet" over a spending wallet; a confident **"0h"** on Time Report
over a failed request; and on mobile **"All clear! No tasks for this filter."**
on the first screen a user opens each morning.

### Defects that were not styling

- **A throw in any tab blanked the entire product.** `ErrorBoundary` existed
  once, at the root. Fixed: `AppShell` wraps `<Outlet>` at `scope="page"`, keyed
  on pathname so the latch clears on navigation.
- **`srijan/DataCatalogTab` unmounted the whole module** when `input_schema`
  arrived as a JSON string. `routers/scrapers.py:160` explicitly handles that
  shape, which is the evidence it happens.
- **The Ganit e-sign flow could never send** — four faults under one
  `except Exception`, answering `{"status": "sent"}` with nothing sent. Fixing
  the import alone would have given every signer the same token.
- **Pahchan retakes never reset** — after three failures, every later punch sent
  `retry_count: 3` and was flagged for a manager forever.
- **Both public pages had 2.13:1 Devanagari in dark mode** — the page a client's
  own customer uses to approve work.
- **The primary button was 2.51:1 in LIGHT** on 145 uses, because `--k-grad` ran
  to `--primary-vivid`. The design's ordinary button is flat.

### Discipline worth keeping

Three agents nearly filed **twelve false defects between them**, all their own
fixtures serving wrong field names — one unanchored `/tasks$` was swallowing
`/templates/tasks`. Each verified against the backend and recorded the finding
as **disproved** rather than reporting it. That is why these reports can be
trusted: they say what they could not verify.

### Still open after this round

1. **`ganit/TimesheetTab`** — a form with no list. Backend work.
2. **Payload-shape agreement with the live backend is unproven.** Every pass ran
   against stubs, and agents hit real field-name mismatches in their own
   fixtures. One run against a real staging session would settle it.
3. **Mobile was never rendered** — no simulator. Gestures, haptics, camera,
   sheet presentation, dark mode and touch targets are unverified.
4. **Seven mobile files have zero accessibility attributes**, including
   `BoardScreen` (734 loc) and `NewTaskSheet` (659 loc).
5. **The landing page's primary CTA has no destination** — `VITE_LEAD_CTA_HREF`
   is unset and the page says so to visitors.
6. **Aesthetic fidelity.** Measured layout is not a look. Nobody has seen these
   pages side by side with the mockups.
