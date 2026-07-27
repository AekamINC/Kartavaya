# Verification — Graha / Ganit / Manav

**Branch** `verify/graha-ganit-manav`, cut fresh from `origin/staging` @ `0a69bef1`.
**Date** 2026-07-27. **Scope** 55 files: `GrahaPage.jsx` + `graha/` (20), `GanitPage.jsx` + `ganit/` (16), `ManavPage.jsx` + `manav/` (16).

## How this was verified

Every previous agent on these three modules failed to get a browser and signed off "visual fidelity unverified". This pass got one.

- Own Vite dev server on **:5612** from this worktree (`node_modules` junctioned from the main checkout after confirming `package.json` and `package-lock.json` hash-identical). `location.href` asserted on every read — never :5173.
- The routes are behind `Protected`. **No session was obtained and the database was never touched.** A local-only harness (`frontend/harness.html` + `src/harness.jsx`, deleted before commit, copy kept in scratchpad) mounted the three real page components under the real `CustomizeProvider`/`ToastProvider` and the real six stylesheets, with `api.defaults.adapter` replaced by a fixture adapter. `?state=ok|empty|error|loading` drives all four states.
- **Screenshots worked at first** (one captured, Graha at 510px) then the pane stopped compositing and every later attempt failed with "the Browser pane is not displayed". Evidence from that point on is **measured layout** — `getComputedStyle`, `getBoundingClientRect`, `scrollWidth > clientWidth`, DOM node identity across tab changes — which is stronger than a screenshot for everything except colour rendering.
- All 38 tabs walked in `ok` **and** `error`; detail drawers opened by click; widths 1280 and 393; `data-theme="dark"` re-checked; focus ring checked with a real `Tab` keypress.

### Fixture artifacts, not defects — read before trusting any "broken" claim

Six things looked broken and were my fixture using the wrong field name. Each was checked against the backend before being cleared, and none is a product defect:

| Symptom | Cause |
|---|---|
| `AutomationsTab` crashed the page | fixture omitted `action_type`; it is `NOT NULL` (migration 023) |
| Follow-up "Due: Invalid Date" | real column is `due_at`, not `due_date` (graha.py:534) |
| Reports "WIN RATE undefined%" | route returns `conversion_rate`; the tab reads it correctly (graha.py:2059) |
| Documents "All Folders ()" | folders route returns `{folder, count}` |
| Contact detail crashed the page | route returns `{contact, deals, …}` (graha.py:545), not the list envelope |
| Vendor bill drawer title empty | title is `internal_ref`, generated server-side (ganit.py:1852) |

Likewise **"SHIFT DEFINITIONSपारी"** is not a missing space — measured gap is exactly **8px** (`.k-section__title-hi { margin-left: 8px }`). It was an `innerText` concatenation artifact of my own reading.

## Headline findings

**1 · The tab overflow matches the reference exactly — the owner's complaint is a design disagreement, not a defect.**
`Data.jsx:153` `TabBar` is `max = 6`: first six inline, rest in a More popover, active tab promoted out of the tail. `ModuleTabs.jsx` reproduces this precisely. Measured: Graha 6 inline + `More +11` (17 total), Ganit 6 + `More +4` (10), Manav 6 + `More +5` (11). Popover reads `All tabs · 17`, `minWidth 230px`, `maxHeight 340px`, `overflowY auto`, both scripts per row — every value matching `Data.jsx:176-183`. **If the owner wants more tabs inline, raise the `max` prop; the build is not deviating from the design.**
Worth flagging separately: at **393px the strip scrolls with only ~2 of the 6 inline tabs visible**, on a strip with `scrollbar-width: none`. The four hidden ones are reachable only by swipe, hinted at by edge gradients. That is the same "present in the DOM, absent from the product" shape `ModuleTabs`' own docstring says it fixed for the *tail* — it is still true for the *head* on a phone.

**2 · "Loading / empty / error are three distinct states" — this holds across all 43 tab-states tested.**
This was the defect the brief expected me to find, and it is **not present**. Every tab in all three modules renders a distinct failure block with a retry under `state=error`; **none** printed an empty state. "No invoices" and "no employees" never appear over a failed fetch. Manav is the strongest of the three: `manav/_shared.jsx`'s `useList`/`Resource` makes `items` null whenever `error` is set, so a call site *cannot* collapse the two. Graha/Ganit use `ui/ErrorState` to the same effect.

**3 · `ManavPage.jsx` was the outlier on shared chrome — four defects, all fixed.** See below.

**4 · Emoji remain in `graha/_shared.jsx` — located, partly fixed, rest flagged.**
`07-pahchan.md:177` and `05-today-dashboard.md:81-88` both state the design system has no emoji, the latter naming this exact screen. Fixed `TodayTab`'s five section headers. **Not fixed:** `ACT_ICONS`, `TL_ICONS`, `TL_SUB_ICONS` and the 🔥/⏳ at `_shared.jsx:66`, rendered by `ActivitiesTab`, `TodayItem` and `ContactTimeline` — replacing them needs phone/calendar/envelope/briefcase glyphs that `navIcons.jsx` does not carry, and `navIcons.jsx` is outside these three directories.

## Changes made

| File | Change |
|---|---|
| `frontend/src/pages/ManavPage.jsx` | Added `useTabPanelMotion` + `ix-panel` + `key` (panel now remounts); added `kick="People · जन"`; `hi`/`sub`/`tone` on all 7 KPI tiles; `loading` passed so the strip shows a skeleton instead of nothing; lede matched to the reference |
| `frontend/src/pages/graha/TodayTab.jsx` | Five emoji section icons → `ICONS.time/activity/users/tasks/approvals`, tinted by the section colour |
| `frontend/src/styles/graha.css` | `.gr__tic` → `inline-flex` so the 16px SVG sits off the text baseline |

Verified after the change: panel `remounted: true`, `animation-name: ixPanelIn`, `--ix-dx` flipping ±1 by direction; KPI row carries all seven Devanagari labels and four tones; loading renders 7 shimmer tiles; TodayTab has zero emoji, 5 SVGs, all five headers a uniform 40px.

## Cross-cutting measurements (all three modules)

| Check | Result |
|---|---|
| `.mt__b` label gap — the 7px-vs-13px regression | **7px**, and `.mt__n` `margin-left: 0`. Measured en→hi 7.00px, hi→count 7.00px. Regression absent |
| Tokens resolving (21 sampled) | all resolve to real values, **0 fallbacks** |
| Dark mode `[data-theme="dark"]` | every token flips (`--bg #0C0E11`, `--warn #E8B45C`, `--danger #F2867A`…), tiles/borders/labels follow. 0 unresolved |
| Focus ring (real `Tab` keypress) | `:focus-visible` matches; `solid 1.6px rgb(0,137,127)` + offset. Global rule, `--accent-default` resolves |
| Horizontal overflow @393px | **none** on any module; 0 offending elements. KPI grid → 2 columns |
| Tab strip direction | `flex-direction: row` — the `boards.css` `.mt` name collision workaround holds |
| Console errors across all 38 tabs | **0** (after fixture correction) |

## Per-file verdicts

### GrahaPage + graha/ (21)

| File | Verdict | Notes · evidence |
|---|---|---|
| `GrahaPage.jsx` | **matches** | Kick/en/hi/lede, tabs-above-figures ordering (the reference's Graha-only exception), `mwarn` on the tab line. `panelKey` destructured not spread — remount confirmed by node identity |
| `graha/TodayTab.jsx` | **fixed** | Was 5 emoji; now stroke icons. 3 states present; 5 sections render with counts |
| `graha/TodayItem.jsx` | **differs** | Renders correctly (5 rows, values, badges) but shows `ACT_ICONS` emoji 📞 at `:55` |
| `graha/ClientsTab.jsx` | **matches** | Table, 3 states, error verified |
| `graha/ContactsTab.jsx` | **matches** | Table + full detail page (fields, labels, deals, follow-ups, activities, timeline); 3 states |
| `graha/ContactTimeline.jsx` | **differs** | Renders (3 rows); uses `TL_ICONS`/`TL_SUB_ICONS` emoji at `:61-62` |
| `graha/DealsTab.jsx` | **matches** | Stage filter, cards, inline stage moves; 3 states |
| `graha/KanbanTab.jsx` | **matches** | Six stage columns with counts and totals; 3 states |
| `graha/PipelineTab.jsx` | **matches** | Distinct "The pipeline did not load" error — not the empty state |
| `graha/FollowUpsTab.jsx` | **matches** | Status filter, rows, complete/delete; 3 states |
| `graha/LabelsTab.jsx` | **matches** | List + assign-to-contact; 3 states |
| `graha/ActivitiesTab.jsx` | **differs** | The "form + a sentence telling you to look elsewhere" is **fixed** — now a real table over `GET /activities` with type filter and complete action, 3 states. Remaining: `ACT_ICONS` emoji at `:178` |
| `graha/ReportsTab.jsx` | **matches** | 6 stat tiles + forecast/velocity/source/rep sections; period switch; 3 states |
| `graha/AutomationsTab.jsx` | **matches** | Rules + run logs, toggle/delete; 3 states. Logs failing degrades to a sentence, rules unaffected |
| `graha/TerritoriesTab.jsx` | **matches** | List + create/delete; 3 states |
| `graha/CustomFieldsTab.jsx` | **matches** | Grouped by entity; 3 states |
| `graha/WebFormsTab.jsx` | **matches** | Form list, public URL, embed code, submissions; 3 states |
| `graha/ApprovalsTab.jsx` | **matches** | Rules table + requests table, entity filter; 3 states |
| `graha/DocumentsTab.jsx` | **matches** | Folder filter, search, table; 3 states. Folder filter failing degrades to "All Folders" only |
| `graha/DedupeTab.jsx` | **matches** | Bilingual heading (द्वैतनिवारण), grouping explained, merge + undo; 3 states |
| `graha/_shared.jsx` | **differs** | Tokens/Badge correct. **13 emoji** at `:33-35` and `:66` — see finding 4 |

### GanitPage + ganit/ (17)

| File | Verdict | Notes · evidence |
|---|---|---|
| `GanitPage.jsx` | **matches** | "Finance / गणित" (not "Invoicing"), figures-above-tabs per the reference, `Promise.allSettled` so payables failing keeps receivables. Panel remounts. Minor: reference title is "Finance & GST"; build uses "Finance" — satisfies the brand constraint |
| `ganit/InvoicesTab.jsx` | **matches** | Type + status filters, table, 3 states |
| `ganit/InvoiceDetail.jsx` | **matches** | Drawer `role=dialog aria-modal=true`; line items, totals, payments, PDF/WhatsApp/record-payment; bilingual section labels |
| `ganit/InvoiceForm.jsx` | **matches** | 16 fields; customer is a **picker**, not a UUID box; IGST and export flags |
| `ganit/ProductsTab.jsx` | **matches** | HSN/SAC, price, GST, type; 3 states |
| `ganit/ExpensesTab.jsx` | **matches** | Totals strip + category manager + table. Totals failing says so and leaves entries alone |
| `ganit/PayablesTab.jsx` | **matches** | Outstanding/overdue/open strip, status filter, vendor + bill creation |
| `ganit/VendorBillDetail.jsx` | **matches** | Total/paid/balance, release-payment form, line items with an honest "This bill carries no lines." |
| `ganit/ContractsTab.jsx` | **matches** | Status filter, rows, create form; 3 states |
| `ganit/ContractDetail.jsx` | **matches** | Value/dates/reminder, five status actions, related invoices |
| `ganit/ESignTab.jsx` | **matches** | Lists contracts as the signable objects; 3 states. Note: the list shows contract status, not signature status — you cannot see at a glance which are awaiting signature |
| `ganit/SignatureDetail.jsx` | **matches** | Signers + audit trail both render — the `audit_trail` key fix is live. Send-for-signature is correctly suppressed when a request already exists, and is behind a confirm dialog (not triggered) |
| `ganit/RecurringTab.jsx` | **matches** | Frequency, next run, generate-now, deactivate; 3 states |
| `ganit/BankTab.jsx` | **matches** | Reconciliation counters, matched/unmatched filter, CSV import; totals failing is separated from the lines |
| `ganit/TimesheetTab.jsx` | **differs** | **The "only tab is done, not the whole page" shape, second instance.** It is a form only: a date range, a customer picker and "Generate invoice". It never lists the time entries, so the user cannot see which hours are unbilled, or how many, before creating an invoice from them. Unlike `ActivitiesTab` there is **no ready GET to call** — the unbilled-entries query is embedded inside `POST /invoices/from-time-entries` (ganit.py:2100). Fixing it needs a new backend endpoint, so it is flagged, not fixed |
| `ganit/StatsTab.jsx` | **matches** | Bilingual KPI tiles, MSME 43B(h) caption, cash position; 3 states |
| `ganit/_shared.jsx` | **matches** | Token maps and `Tag`. `'✓ Copied'` at `:138` is a typographic mark, not an emoji |

### ManavPage + manav/ (17)

| File | Verdict | Notes · evidence |
|---|---|---|
| `ManavPage.jsx` | **was broken → fixed** | Four defects, all measured: (1) **panel never remounted** — plain `<div>`, `sameNode: true`, `animation-name: none`, no `useTabPanelMotion` at all, the only one of the three pages with no panel motion; (2) **no `kick`** — reference has `People · जन`; (3) KPI tiles had **no `hi`, `sub` or `tone`** — seven bare numbers; (4) strip rendered only on `stats &&`, so **loading showed nothing**. All four fixed and re-measured |
| `manav/EmployeesTab.jsx` | **matches** | Directory table, filters, 3 states. `icon="👥"` at `:177` is a **dead prop** — `EmptyState` maps unknown icon strings to `GLYPHS.generic` SVG, so no emoji renders |
| `manav/AttendanceTab.jsx` | **matches** | Date range, monthly summary, mark-attendance, and the payroll-consequence note. 3 states |
| `manav/ShiftsTab.jsx` | **matches** | Sub-tab shell (Definitions/Schedules/Bids/Swaps); all four verified reachable |
| `manav/ShiftDefinitions.jsx` | **matches** | Heading gap measured at 8px (not the concatenation it looked like). Hex `DEFAULT_SHIFT_COLOR` is correct — `<input type=color>` accepts nothing else |
| `manav/ScheduleGrid.jsx` | **matches** | Correctly distinguishes an *idle* state ("Choose dates above and press Load") from empty |
| `manav/ShiftBids.jsx` | **matches** | Bilingual heading (बोली), empty copy explains the feature; 3 states |
| `manav/SwapRequests.jsx` | **matches** | Bilingual heading (अदला-बदली); 3 states |
| `manav/LeavesTab.jsx` | **matches** | Status filter, clash check, leave types, request form; 3 states |
| `manav/ExpensesTab.jsx` | **matches** | Claim status filter, submit; 3 states |
| `manav/RecruitmentTab.jsx` | **matches** | Opening selector + candidate pipeline; 3 states |
| `manav/AnnouncementsTab.jsx` | **matches** | Priority, timestamps, edit/delete; 3 states. Pinned-emoji already removed (comment at `:7`) |
| `manav/DepartmentsTab.jsx` | **matches** | Head + employee count; 3 states |
| `manav/HolidaysTab.jsx` | **matches** | Date/name/type table; 3 states |
| `manav/PerformanceTab.jsx` | **matches** | Month picker and an explicit note on how attendance % is computed; 3 states |
| `manav/AssetsTab.jsx` | **matches** | Category filter, condition, assignment; 3 states |
| `manav/_shared.jsx` | **matches** | The best three-state discipline in the three modules — `useList` keeps `items` null whenever `error` is set. All colours are tokens |

### Test files (not part of the 55, listed for completeness)

| File | Verdict |
|---|---|
| `graha/__tests__/grahaTabStates.test.jsx` | **matches** — passes |
| `graha/__tests__/kanbanTab.test.jsx` | **matches** — passes |
| `manav/__tests__/manavTabs.test.jsx` | **matches** — passes |

## NOT VERIFIED

- **Rendered colour fidelity against the mockup.** Screenshots stopped working after the first capture. Token *values* and computed colours were read numerically and are correct, but no side-by-side pixel comparison against the reference was made.
- **The rendered HTML harnesses** (`Kartavaya Redesign.html`) were not opened — they load JSX via a CDN Babel and the environment blocks external hosts. The reference JSX and CSS were read directly instead.
- **Write paths.** Nothing was created, updated or deleted: no invoice raised, no leave approved, no signature sent, no email or WhatsApp. Forms were opened and inspected, never submitted.
- **Real-data behaviour.** Everything ran against fixtures. Field-name mismatches of the kind listed above would not show up in a live session, and conversely a live session might surface shapes my fixtures did not model.
- **`ganit/ESignTab` signature-status in the list** — I verified the detail drawer shows status, but did not confirm what the list looks like when several contracts are at different signature stages.

## Out of scope, worth someone's attention

- **A throw inside any tab blanks the whole app.** `ErrorBoundary` wraps only the root (`App.jsx:296`). There is none around the tab panel, so one bad row in one tab takes the nav and header with it. Three separate crashes during this pass (all fixture-induced) produced `document.body.innerText.length === 0`. A boundary around `.ix-panel` would contain it to the panel.
- **`.mt` is still a name collision** with `boards.css`'s MyTasks strip, held apart only by `[role="tablist"]` and `.mt__b` scoping. `module.css:115-135` says so itself. Renaming one of the two is still the fix.

## Gates

From `frontend/`, on the committed tree:

```
node scripts/check-tokens.mjs   → 356 declared, 244 referenced, 0 missing
node scripts/check-classes.mjs  → 3499 selectors, 2690 classes used, 0 missing a rule
npx vite build                  → built in 18.16s
npx vitest run                  → EXIT: 0 · 41 files / 666 tests passed · unhandled: 0
```

Baseline was 41 files / 665 tests; the extra test came with `origin/staging`, not from this branch. `yarn.lock` untouched. The line-ending-only change Git produced on `visual-regression.test.jsx.snap` was reverted, not committed.
