# Design conformance — Graha · Ganit · Manav

Compared 2026-07-28 against `design-reference/Kartavaya Redesign/` (authoritative) and `design-handover/13-module-pages.md`, `02-common-components.md`, `18-documents.md` (secondary). Read-only pass. GST **filing** automation excluded by owner decision; Tally + GSTR-1 **export** checked and present.

Reference tab source of truth: `design-reference/Kartavaya Redesign/Data.jsx:120-133` (`MODULE_TABS`). All three modules match the reference tab lists exactly — 17 / 10 / 11. No tab is missing, none is extra.

---

## 1 · Full tab tree

Leaf = a distinct screen state a tester must reach. Second-level tabs are marked **[tablist]** or **[toggle]**; forms/drawers/panels that replace or overlay the leaf body are listed under it.

### Graha · ग्रह — CRM (`pages/GrahaPage.jsx`, opens on `pipeline`)

17 top-level tabs, **0 second-level tablists**, 17 leaves.

- **today** — 5 fixed sections (`TodayTab.jsx:23-30`: overdue_followups, stale_deals, new_leads, todays_activities, recent_closures)
- **clients** — list + search · create/edit form · inline detail panel (Contacts, Deals sub-lists)
- **contacts** — list + search + type filter · create form · edit form · inline detail panel (Labels, Deals, Follow-ups, Activities, Statement of account)
- **deals** — list + stage filter · create form · inline edit
- **kanban** — drag board, stage columns
- **pipeline** — read-only stage board (`gpipe`/`gdeal`)
- **follow-ups** — list + status filter · create form
- **labels** — list · create form · assign-to-contact form
- **activities** — list + type filter · log-activity form
- **reports** — days selector + 5 blocks (conversion tiles, Revenue Forecast, Pipeline Velocity, Lead Source Analysis, Rep Performance)
- **automations** — list · create form · Recent Logs block
- **territories** — list · create form
- **fields** (Custom fields) — list · create form · per-entity groups
- **web-forms** — list · create form · per-form submissions
- **approvals** — Approval Rules section + Approval Requests section (status filter)
- **documents** — list + search · add form
- **dedupe** — Dedupe Review + Recent Merges

### Ganit · गणित — Finance (`pages/GanitPage.jsx`, opens on `invoices`)

10 top-level tabs, **0 second-level tablists**, 10 leaves. `stats` is relabelled "GST filing" in the UI (id unchanged).

- **invoices** — list + type filter + status filter · `InvoiceForm` · **drawer** `InvoiceDetail` (Billed to, Line items, Record payment, Payments, UPI block)
- **products** — list · create form · inline edit · ConfirmDialog delete
- **expenses** — list + category filter · By-category panel · New category form · Record expense form · inline edit · ConfirmDialog delete
- **payables** — bills list + status filter · Ageing panel · New vendor form · New vendor bill form (line items) · **drawer** `VendorBillDetail` (Release payment, Line items, Payments, Notes)
- **contracts** — list + status filter · New contract form · **drawer** `ContractDetail` (Description, Service agreement, Edit contract, Related invoices)
- **e-sign** — list · **drawer** `SignatureDetail` (Signers, Send for signature, Audit trail)
- **recurring** — list · create form · ConfirmDialog
- **bank** — statements list + filter · Import a bank statement (CSV paste)
- **timesheet** — Invoice-from-timesheets form · result block
- **stats / "GST filing"** — period selector + 6 panels: Pre-filing validation · GSTR-3B summary · File & share · Data exports (GSTR-1 JSON, Tally XML) · Reconciliation (declared unavailable) · TDS challan ITNS-281

### Manav · मानव — HRMS (`pages/ManavPage.jsx`, opens on `employees`)

11 top-level tabs, **1 real second-level tablist + 1 second-level toggle**, **15 leaves**.

- **employees** — list + search + dept filter · New employee form · **full-page** `EmployeeDetail` (+ Leave balances section)
- **attendance** — **[toggle]** 2 views
  - daily ledger (date range) — + Mark attendance form, Vetana bridge note
  - Monthly summary
- **shifts** — **[tablist]** `mn-sub`, 4 views (`ShiftsTab.jsx:14`)
  - definitions (`ShiftDefinitions`) — list · New shift form
  - schedules (`ScheduleGrid`) — grid · Assign shift form · Coverage section
  - bids (`ShiftBids`) — list · New shift bid form
  - swaps (`SwapRequests`) — list · New swap request form · ConfirmDialog
- **leaves** — list + status filter · 3 panels: Check clashes · New leave type · Request leave
- **expenses** — list · Submit expense claim form
- **recruitment** — openings + candidates pipeline · 3 panels: edit opening · new opening · add candidate
- **announcements** — list · New/Edit announcement form · ConfirmDialog
- **departments** — grid · form · ConfirmDialog
- **holidays** — table · form · ConfirmDialog
- **performance** — table (read-only)
- **assets** — list · New asset form · ConfirmDialog

**Leaf totals — Graha 17 · Ganit 10 · Manav 15 · total 42.**

---

## 2 · HIGH severity

| # | Spec | Implementation | Spec says | Code does | Sev |
|---|---|---|---|---|---|
| H1 | `02-common-components.md:11-25`, §1 `.btn`/`.inp`; `Kartavaya Redesign/app.css:99-110` | `pages/graha/*` (169 `k-btn`, 95 `k-input`), `pages/manav/*` (206 `k-btn`, 246 `k-formpanel`, 12 `k-input`) vs `pages/ganit/*` (63 `.btn .btn--*`, 95 `.inp`, 0 legacy) | "**Target: one system.** … Do not migrate half — a page that mixes the two is how the radius mismatch got shipped." | Ganit is fully on the reference vocabulary; **Graha and Manav are 100% on the legacy one**. `editorial.css:915-919` states the delta itself: "`.btn` is 8px/15px with gap 7 and a flat `--primary` fill, `.k-btn` is 8px/14px with gap 6 and a gradient fill". Radius differs too — `.btn` `--r-sm` (components.css:13) vs `.k-btn` `--r-md` (editorial.css:932); press feedback differs — `scale(.975)` vs `translateY(1px)`. `.k-btn` has 3 variants (primary/ghost/reject) against the spec's 7, so tonal/out/text do not exist on two of three modules. | HIGH |
| H2 | `02-common-components.md:201` `ui/ConfirmDialog.jsx danger · warn · neutral intents` | `graha/ApprovalsTab.jsx:65`, `AutomationsTab.jsx:72`, `ClientsTab.jsx:81`, `ContactsTab.jsx:133`, `CustomFieldsTab.jsx:54`, `DealsTab.jsx:94`, `DocumentsTab.jsx:78`, `FollowUpsTab.jsx:90`, `LabelsTab.jsx:60`, `TerritoriesTab.jsx:48`, `WebFormsTab.jsx:56` | A styled confirm dialog with intents | `if (!window.confirm('Delete this X? This cannot be undone.')) return;` — **all 11 destructive actions in Graha are native browser confirms**: unstyled, not theme-aware, not bilingual, no focus trap, no danger intent. Ganit and Manav already use `ConfirmDialog` (13 call sites), so the divergence is Graha-only and the fix pattern is in the repo. | HIGH |
| H3 | `02-common-components.md:204` `ui/Table.jsx Table · Head · Row · Cell · sort · resize · bulk`; `components/ui/Table.jsx:4` "three-state sort · bulk bar", `:55` `aria-sort` | `pages/graha`, `pages/ganit`, `pages/manav` | Sortable columns, `aria-sort`, bulk selection bar | **`components/ui/Table.jsx` has zero importers anywhere in the codebase.** No column sort, no row select, no bulk action, no pagination in any of the 42 leaves. The only pagination is a cursor "Load more" in `graha/ContactTimeline.jsx:83`. Every list is a single unpaginated GET — on the Ganit invoice ledger and the Manav employee register this is the first thing to break at scale. `components/views/BulkBar.jsx` is likewise unused by all three. | HIGH |
| H4 | `13-module-pages.md:134` "GST resolved from billing state: inter-state IGST, intra-state CGST+SGST"; `:163-167` `frontend/src/lib/gst.js` — "both rules are currently reimplemented per page, and both are the kind of thing that is wrong in one place and right in four" | `lib/gst.js` **does not exist**. `ganit/InvoiceForm.jsx:116-132`, `PayablesTab.jsx:234-236`, `RecurringTab.jsx:142-144`, `TimesheetTab.jsx:82-84` | IGST vs CGST+SGST derived from place of supply | `is_igst` is a **manual checkbox** the user ticks, in **four independent places**, none of which reads `place_of_supply`. `InvoiceForm.jsx:116` takes a free-text place of supply ("e.g. Maharashtra") and `:130` a separate unlinked checkbox — a user can type an intra-state place and tick IGST and get a wrong tax split on a tax document. The exact failure §3 was written to prevent, unfixed. `lib/inr.js` (the sibling) does exist. | HIGH |
| H5 | `13-module-pages.md:135` — Manav's one named constraint: "A leave crossing the payroll cut-off moves an unpaid day into that run — **stated at approval time**" | `pages/manav/LeavesTab.jsx:141-158` | The warning appears when the approver acts | **Absent.** Zero occurrences of `cut-off`/`cutoff`/`payroll`/`unpaid`/`Vetana` in `LeavesTab.jsx`. `actionLeave(lr.id,'approved')` posts straight through. The pattern exists two tabs away — `AttendanceTab.jsx:82-87` carries exactly this kind of Vetana bridge note — so it was built and not applied to the one screen the spec names. | HIGH |
| H6 | Brief: "`--primary` is a FILL, `--primary-text` is the TEXT variant — NOT interchangeable". `kartavaya-design.css:616` `--k-primary: var(--primary-vivid)`; `:304` `--primary-vivid: #05b7aa`; `:300` `--primary-text: #046B64` | `styles/graha.css:312` `.gr__more { color: var(--k-primary) }` (used at `ContactTimeline.jsx:83` "Load more…"), `:323` `.gr__kbco { color: var(--k-primary) }` (used at `KanbanTab.jsx:213`, `DealsTab.jsx:277` — the company name on every deal card) | Text uses `--primary-text` | Both paint **text** at `#05b7aa`. `02-common-components.md:962` already measured this exact value: "`--primary-vivid #05b7aa 2.51:1 FAIL`". Against the cream surface it is ~2.4:1 — under AA for normal text, in the default theme, on the company name of every Kanban card. Dark mode is fine (`kartavaya-design.css:410`); light is not. | HIGH |
| H7 | One class name, one component | `styles/graha.css:223` `.gr__chip`, `:233` `.gr__chips` **collide** with `styles/generate-report.css:160` `.gr__chip`, `:159` `.gr__chips`. Both imported by `styles/index.css` (generate-report line 14, graha line 22 → **graha wins**) | — | Consumer `pages/ReportsPage.jsx:615` renders `className={'gr__chip' + …' is-active'}` and sets `--c` on the **child** `.gr__chip-dot` (`:617`), never on `.gr__chip`. graha.css's rule therefore evaluates `color: var(--c)` and `color-mix(in srgb, var(--c) 9%, transparent)` with `--c` undefined — both invalid at computed-value time and silently dropped — while its `padding: 4px 12px` and `border-radius: var(--r-pill)` **do** override. The team-filter chips on Reports lose their border and background and shrink. Same defect class as the `.mt` / boards.css collision already documented at `module.css:115-135`, and this one has no scoping workaround. | HIGH |
| H8 | An active control must show it is active | `pages/manav/AttendanceTab.jsx:69-75` `className={`k-btn k-btn--ghost${view === 'summary' ? ' on' : ''}`}` | Second-level view switch reads as selected | **No `.k-btn … .on` rule exists in any stylesheet.** The `on` class is inert. "View" and "Monthly summary" look identical in both states, so Attendance's two sub-views give the user no indication which one they are in. Contrast `ShiftsTab.jsx:31-47`, which is a real `mn-sub` tablist with `aria-selected` — the correct pattern is one file away. | HIGH |

---

## 3 · MED severity

| # | Spec | Implementation | Spec says | Code does | Sev |
|---|---|---|---|---|---|
| M1 | `02-common-components.md:23` "the redesign uses **`--font-indic`** on any label that follows the user's language, and `--font-hindi` only on fixed decorative Devanagari" | `styles/module.css:500` `.mt__hi { font-family: var(--font-hindi) }`, `:554` `.mt__pop-hi { … var(--font-hindi) }` | `--font-indic` | The Hindi half of **every module tab label**, on all three pages (and the other six module pages), uses `--font-hindi`. `kartavaya-design.css:63` has `--font-indic: var(--font-hindi)` today, so it looks correct now and breaks the moment a user switches to Gujarati — the tab labels stay Devanagari while `.mh__hi` (`:82`), `.mk__hi` (`:213`) and `.gpipe__hi` (`:251`) on the same page follow the language. Weight 400, untracked, not uppercased — those parts are correct. | MED |
| M2 | `02-common-components.md:373-378` "Port `EmptyState` onto tokens and **delete** `ModuleUI.Empty`. Until then, new screens use `EmptyState`." | All 14 Manav tab files import `Empty` from `components/editorial`; `graha/PipelineTab.jsx:19` too. Ganit uses `EmptyState` throughout, Graha 12/17. | `EmptyState` with a chosen illustration | `ModuleUI.Empty` hardcodes `illustration="generic"` and forwards `icon` into a **3-entry** `GLYPHS` map (`EmptyState.jsx:9-28`). Manav passes emoji strings (`icon="📢"`, `"💻"`, `"📊"`, `"🏢"`, `"👥"`, `"🧾"`, `"📅"`, `"🏖️"`, `"📈"`, `"📋"`, `"🙋"`, `"🕐"`, `"🔄"` — 16 sites) which all miss and fall to `GLYPHS.generic`. Result: **every Manav empty state renders the same 34px generic glyph**, while Ganit/Graha get the 120×100 `contacts`/`invoice`/`search` artwork. *(The emoji themselves never render — see NG1.)* | MED |
| M3 | `02-common-components.md:286-309` four error kinds; "**`denied` must name the missing grant** … and offer to request it" | `pages/manav/_shared.jsx:171-182` `ErrorNote`; `graha/PipelineTab.jsx:113` | `ErrorState({kind, detail, onRetry, backTo})` | Manav rolls a private `note note--warn` block for every failure across all 11 tabs; Graha's pipeline uses a bare `<div className="note note--warn">`. Neither distinguishes offline / server / denied / missing, neither offers "Request access". `_shared.jsx:118` returns "You do not have access to this part of HR." — names no grant, offers no action. `ui/ErrorState` with `errorKind()` is what Ganit uses in all 10 tabs. | MED |
| M4 | `ScreensBiz.jsx:17-23` — five figures: Receivables, Overdue > 45d, **GST payable**, **ITC available**, Cash in bank | `pages/GanitPage.jsx:76-95` — four: Receivables, Overdue, Collected, Payables | The GST/ITC position is above the tab bar | The two figures that make this module *Finance & GST* rather than an AR list are absent from the strip. `StatsTab` already computes GST payable from `GET /v1/documents/gst/gstr3b/{period}`, so the number exists one tab away. | MED |
| M5 | `ScreensBiz.jsx:13` `<button className="btn btn--out btn--sm" onClick={() => open('scan')}>Scan bill</button>`; `:119-124` expenses/payables empty state "Scan a bill to start … HSN, GSTIN and tax split are read automatically" | `pages/GanitPage.jsx:124-132` (one action only); `ganit/ExpensesTab.jsx`, `PayablesTab.jsx` | Header carries Scan bill; expenses/payables lead with the scan empty state | No scan / OCR / receipt-capture surface exists anywhere in `pages/ganit/` (grep: 0 hits for scan\|ocr\|receipt\|camera). The header has only "+ Invoice". | MED |
| M6 | `ScreensCore.jsx:181` contacts open via `open('contact', c)`; `13-module-pages.md:37` prescribes `pages/graha/ContactDrawer.jsx` | `pages/graha/` — **0 occurrences of `dr__` in `graha.css`**, no drawer file. `ContactsTab.jsx:200-232`, `ClientsTab.jsx:103-160` render detail as an inline `gr__panel` that pushes the list down | A record opens in a drawer | Ganit built four drawers (`InvoiceDetail`, `VendorBillDetail`, `ContractDetail`, `SignatureDetail`, all on `dr__*`); Manav uses a full-page takeover with `BackButton`; Graha uses inline expansion. **Three different record-view idioms in one app.** | MED |
| M7 | `ScreensBiz.jsx:35-52` invoice table: No. · Party (+ MSME 45-day sub-label, `:46`) · **Place of supply** (+ `IGST` / `C+S` tag, `:49`) · Taxable · GST · Status | `ganit/InvoicesTab.jsx:118-127`: Invoice · Customer · Type · Date · Total · Paid · Due · Status | Place of supply and the tax-split tag are columns | Neither the place-of-supply column, the IGST/C+S tag, nor the MSME 45-day marker appears in the ledger. The taxable/GST split is collapsed into Total. The MSME/43B(h) point survives only in the KPI sub-label (`GanitPage.jsx:87`). | MED |
| M8 | `Card` in `Data.jsx:39-51` always pairs `title` with `hi`; `02-common-components.md:81-87` `.card__title` + `.card__hi` inline apposition | `pages/graha/*` — `gr__st`, `gr__ptitle`, `gr__eyebrow`, `gr__dsec`, none with a Hindi companion (only `DedupeTab.jsx:113,213` pairs) | Every section title carries its Devanagari apposition | Ganit pairs everywhere (`dr__lbl` + `dr__lbl-hi`), Manav pairs everywhere (`k-section__title` + `k-section__title-hi`). **Graha pairs on 2 of ~25 section titles.** | MED |
| M9 | Reference copy is sentence case throughout (`ScreensBiz.jsx:64,80,95,104`; `ScreensCore.jsx` "Quote to cash", "Send via", "Stalled") | `graha/ActivitiesTab.jsx:115` "Log Activity"; `ContactsTab.jsx:174,362` "Edit Contact"/"New Contact"; `:209` "Convert to Customer"; `ApprovalsTab.jsx:95,148` "Approval Rules"/"Approval Requests"; `AutomationsTab.jsx:85` "Sales Automations"; `CustomFieldsTab.jsx:67` "Custom Fields"; `WebFormsTab.jsx:78` "Web-to-Lead Forms"; `DealsTab.jsx:202,251`; `DocumentsTab.jsx:107`; `LabelsTab.jsx:95,111` | Sentence case | Graha is Title Case across ~15 headings and buttons. Ganit ("Record an expense", "New product or service", "Invoice from timesheets") and Manav ("Mark attendance", "New employee", "Request leave") are both sentence case. | MED |
| M10 | `graha/PipelineTab.jsx:99-109` own comment: "the card shows no owner rather than eight characters of a UUID, **which tells nobody anything**" | `graha/ContactsTab.jsx:222` `<strong>Assigned To:</strong> {c.assigned_to ? `${c.assigned_to.substring(0, 8)}…` : '—'}` | — | The contact detail panel prints a truncated UUID as user-facing text — the exact thing the sibling file refuses to do, in the same module. | MED |
| M11 | `02-common-components.md:97-100` `.tag`; `:92-96` `.chip` (with `.on`, hover, `[role=button]`) | `styles/graha.css:223` `.gr__chip`, `styles/ganit.css:469-479` `.gn-tag` | Use `.tag` / `.chip` | Two more private pills after three private `Badge`s were already consolidated onto `ui/Tag`. `.gr__chip` has no active, hover or focus state and no border, so a label chip cannot be a control; `.gn-tag` re-derives `--ok-container`/`--danger-container` variants that `.tag`'s `--c` already covers with one class. | MED |
| M12 | `13-module-pages.md:146` "Decline is gated on a reason" (Approvals); `manav/LeavesTab.jsx:137` already **displays** `lr.rejection_reason` | `manav/LeavesTab.jsx:51-55` `actionLeave(leaveId, status)` → `PATCH …/action` with `{ status }` only; `:153-155` Reject button | A decline collects a reason | The reject path sends no reason, so the field the list renders can only ever be empty for anything rejected through this UI. No confirmation step on a rejection either. | MED |
| M13 | `ScreensMore.jsx:75` `right={<button className="btn btn--fill btn--sm">+ Add employee</button>}`; `:82` `counts={{ employees: TEAM.length, leaves: 3 }}` | `pages/ManavPage.jsx:61-71` (no `actions` prop), `:104-109` (`tabs` built with no `count`) | Header action + tab counts | Manav's `ModuleHeader` carries **no action button** — Graha (`GrahaPage.jsx:134`) and Ganit (`GanitPage.jsx:125`) both do, and both wire it to the tab through a nonce. Manav's tabs also carry **no counts**, though `stats.total_employees` and `stats.pending_leaves` are already loaded at `:93,:99`. Third module, third header shape. | MED |
| M14 | `ScreensCore.jsx:150` `<button key={d.co} className="deal" onClick={() => open('deal', d)}>`; `:160` `<Av n={d.own} s={22} />` | `graha/PipelineTab.jsx:161` `<article className="gdeal…">`; `:175` `<div className="gdeal__own">{owner}</div>` | Deal card opens the deal; owner shown as an avatar | The card is a non-interactive `<article>` — the reference opens a drawer on click, which is a *view*, not an edit, so `PipelineTab.jsx:15-16`'s justification ("a forecast you can accidentally edit by clicking") does not cover it. Owner is plain text; no avatar anywhere in the board. | MED |
| M15 | `02-common-components.md:63-72` `.inp:focus` = "a 3px `box-shadow`, **not** `outline` — `outline` can't take a radius on all engines and clips against overflow parents" | `styles/editorial.css:3057` `.k-input:focus { border-color: color-mix(…); background: var(--surface); }` — no ring | 3px box-shadow ring at the field radius | Every field in Graha and Manav (107 `k-input` sites) falls back to the app-wide `:focus-visible { outline: 2px solid var(--primary) }` (`components.css:530`) — the exact construction the spec rejects, and it clips inside the scrolling panels these forms sit in. Ganit's `.inp` has the correct ring. | MED |
| M16 | `styles/manav.css:228,231` `.mn-sub__b.on { border-bottom-color: var(--k-primary) }`, `:focus-visible { outline: 2px solid var(--k-primary) }`; `:293`, `:327` likewise | vs `module.css:154` `.mt__b.on::after { background: var(--primary) }` | One accent | The second-level tab underline paints in `--primary-vivid` while the first-level underline directly above it paints in `--primary` — **two different teals stacked on the same screen**. Focus rings on `.mn-sub__b` and `.mn-chip` likewise diverge from the global `--primary` ring. | MED |
| M17 | `02-common-components.md:369-378`; `EmptyState` | `graha/ApprovalsTab.jsx:140-141,183`, `DocumentsTab.jsx:158-159` | An empty list uses the empty state | Renders `<tr><td className="gr__none" colSpan={5}>No approval rules defined.</td></tr>` — a bare table row, no illustration, no CTA, no bilingual title. `KanbanTab.jsx:240` (`<p className="gr__kbempty">No deals</p>`) and `TodayTab.jsx:23-30` (per-section `emptyMsg` strings) are the same shortcut. 4 of 17 Graha tabs never reach `EmptyState`. | MED |

---

## 4 · LOW severity

| # | Where | Finding |
|---|---|---|
| L1 | `ScreensBiz.jsx:10` `en="Finance & GST"` vs `GanitPage.jsx:120` `en="Finance"` | The reference page title is "Finance & GST"; the impl drops "& GST". `GanitPage.jsx:7-13` argues from the sidebar label, but the reference `PH` is the authority for the page heading. |
| L2 | `ScreensBiz.jsx:14,27` `<kbd className="kbd">N</kbd>` and `<button …>Shortcuts <kbd>?</kbd></button>`; file header "keyboard-first finance per research rule 9" | No `kbd`, shortcut hint or shortcuts dialog in any of the three modules (grep: 0 hits). |
| L3 | `manav/ShiftsTab.jsx:44` renders `{v}` only | The four sub-tabs carry no Devanagari companion, while every first-level tab does (`ModuleTabs.jsx:93`). |
| L4 | `styles/graha.css`, `manav.css` | 59 and 13 uses of legacy alias tokens (`--rule-soft` ×35, `--ink-3` ×25, `--ink-2` ×6, `--rule` ×5). All alias cleanly to `--outline-variant` / `--on-surface-*` (`kartavaya-design.css:552-601`), so visually identical — naming debt only. Ganit is down to 7, `module.css` to 0. |
| L5 | `styles/module.css:115-136` | The `.mt` / `.mt__n` name collision with `boards.css` §6 is still live; the fix in place is a `[role="tablist"]`-scoped override the file itself calls "a workaround for a name collision, not the fix". |
| L6 | `manav/_shared.jsx:185-191` `Shim` | Reimplements `k-shimmer` tiles instead of `ui/Skeleton`, which `02-common-components.md:206` specifies with per-page presets. Ganit uses `SkeletonRegion`/`SkeletonTable`/`SkeletonCardGrid` correctly. |
| L7 | `ganit/ExpensesTab.jsx:90` `catForm = { name: '', icon: '📁' }` | An emoji seed for a user-chosen category icon. Data, not chrome — but it does put an emoji on screen where `02:373` says the design system has none. |

---

## 5 · NOT A GAP — checked and correct, do not re-report

| | |
|---|---|
| **NG1 · Manav's 16 emoji `icon=` props** | They never render. `ModuleUI.Empty` forwards `icon` into `EmptyState`'s 3-entry `GLYPHS` map (`EmptyState.jsx:9-28,139`), and an unmatched string falls to `GLYPHS.generic` — an SVG. The emoji is dead string data. The *real* defect is the uniform generic glyph (M2), not the emoji. |
| **NG2 · Raw hex in `_shared.jsx` files** | Every `#0082c6` / `#8b5cf6` / `#ef4444` / `#f59e0b` in `graha/_shared.jsx:5-6`, `ganit/_shared.jsx:4`, `manav/_shared.jsx:4-5` is inside a **comment** recording the retired value. The live maps are all `var(--…)`. |
| **NG3 · `#6366f1` and `#3B82F6`** | `graha/LabelsTab.jsx:18` and `manav/_shared.jsx:241` are seeds for `<input type="color">`, which accepts only `#rrggbb` and silently resets a `var()` to `#000000`. Both are persisted user data with a matching backend default. Correctly kept as literals, and both files say why. |
| **NG4 · The `#2F6690`… block in `module.css:24-54`** | The per-module accent palette, with a full light **and** dark set. Equivalent to `lib/moduleColors.js`, which `13-module-pages.md:158` prescribes. |
| **NG5 · GSTR-2B reconciliation meter missing** | `ScreensBiz.jsx:104-114` draws "42 / 47 matched". There is no 2B store, table or endpoint. `StatsTab.jsx:562-582` renders the panel with an explicit "Unavailable" tag and explains why, rather than fabricating a figure on a tax screen. Correct call. |
| **NG6 · "Kartavaya is a registered GSP" note missing** | `ScreensBiz.jsx:101`. `StatsTab.jsx:28-31` deliberately removed it — it asserts a regulatory status the company does not hold. Correct. |
| **NG7 · Tally / GSTR-1 export** | Both present and wired: `StatsTab.jsx:517-532`, with a pre-download preview of what each file will and will not contain (`:152-216`). Matches `ScreensBiz.jsx:98,100`. |
| **NG8 · `.tbl` vs `.tb`** | `13-module-pages.md:92` says "reuses `.tb`". The reference uses `.tbl` / `.tbl__scroll` / `.tbl__row` (`ScreensBiz.jsx:33-41`). Reference wins; the impl's `.tbl` is right. The impl also upgrades the div-grid to a real `<table>` with `scope="col"`, which is strictly better for a11y. |
| **NG9 · Tailwind in new work** | None. Zero utility classes across all 42 leaves. `mn-grid` is a project class, not `grid`. |
| **NG10 · Dark mode** | `graha.css`, `ganit.css`, `manav.css` carry 0 `[data-theme="dark"]` blocks and need none: every colour is a semantic token or a `color-mix` over one, and both alias families flip at `kartavaya-design.css:552-616`. The only theme-specific case is H6, which fails in **light** only. |
| **NG11 · Loading / error / empty separation** | The invariant "a failed fetch must never render as an empty state" holds in all three modules and is pinned by tests (`graha/__tests__/grahaTabStates.test.jsx`, `manav/__tests__/manavTabs.test.jsx`, `graha/__tests__/kanbanTab.test.jsx`). Ganit additionally splits filtered-empty from truly-empty (`InvoicesTab.jsx:97-113`) — the distinction `02:378` asks for. |
| **NG12 · Module chrome CSS** | `module.css:61-304` matches `13-module-pages.md` §1 line for line, including the scroll-shadow edge fade §1 requires (`:102-113`) and the `--font-indic` / untracked-Devanagari rules on `.mh__kick-hi`, `.mh__hi`, `.mk__hi`. `ModuleTabs.jsx` is a faithful port of `Data.jsx:153-191`'s `TabBar` More-popover with `role="tab"`, roving tabindex and Escape added. |
| **NG13 · `.mempty` missing from `module.css`** | Deleted deliberately (`module.css:289-293`) in favour of the single `.empty` in `components.css`. Two classes for one concept was the problem. |

---

## 6 · Order to fix

1. **H8, H7, H6** — three one-line-scale defects that are visibly broken right now.
2. **H2** — 11 mechanical `window.confirm` → `ConfirmDialog` swaps; the pattern is already in `ganit/ProductsTab.jsx:206`.
3. **H5, H4, M12** — correctness on tax and pay. H4 needs `lib/gst.js` plus four call-site changes.
4. **H1** — the largest, and the one that makes the other three pages look like one app. ~470 call sites; `02:277` gives the order: Button → Field → Card → Tag.
5. **H3** — adopt `ui/Table.jsx`; it is written and tested and nothing imports it.
6. MED/LOW as capacity allows. M1 and M16 are single-token edits.
