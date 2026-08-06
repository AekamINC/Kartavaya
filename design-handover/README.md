# Kartavaya design handover

31 files, `00`–`30`. Read them in order — each states its own prerequisites.

**Three files added 2026-08-05**, covering messaging, the assistant and skills. Two things in them affect files you have already read:

- **Srijan is now Sahayak** (`29`). Route, tables and module key are unchanged; the name and the surface are not.
- **`29` settled its palette on 2026-08-06: Sahayak ships on the product's cream**, matching the prototype. Upstream's built `styles/sahayak.css` scopes `k-surface-theme` (Slate/indigo); removing that scope is the whole change, because the prototype carries no literal colours. The cost is a contrast re-measurement — the existing file was checked by hand against Slate specifically, and `check-contrast.mjs` cannot see scope. `29` names the pairs to re-check first.
- **`30`'s request endpoint is confirmed in scope.** `POST /v1/hub/skills/:id/request` — free-text note, idempotent per org and skill, lands as a lead and emails the account contact. Shape in `30` §11.

**Synced against `kevalvshah/Kartavya@staging` on 2026-08-05.** Verdicts on every defect claim below are the implementer's, checked against the branch. Read `_IMPLEMENTATION-LEDGER.md` in the repo for their full working — it is theirs, not ours, and this set does not reconcile against it.

**`26-component-inventory.md` supersedes the state guidance in `02`** and carries the six things the rest of the set left to inference: the state vocabulary, the spacing ramp with per-step assignment, form layout rules, the unified picker, concrete keyframe values, and the legacy-class policy. Its live counterpart is `Kartavaya Redesign/Component Inventory.html` — every component in every state, interactive.

**These files reference the six spec documents rather than restating them.** `RESEARCH.md`, `RBAC-SPEC.md`, `MESSAGING-ATTENDANCE-SPEC.md`, `AUTH-SPEC.md`, `SETTINGS-ADMIN-SPEC.md` and `MOTION-SPEC.md` hold the rules, rationale and product decisions. The handover files carry only what those don't: exact CSS, component trees, file paths, endpoints, and a before/after for every existing file that changes. Two documents, no duplicated content, one place to change each fact.

Every "what changes" table was written after reading the actual staging file at `kevalvshah/Kartavya@staging`. Byte sizes are quoted so you can tell whether a file has moved under you.

| File | Covers |
|---|---|
| `00-tokens.md` | Every CSS custom property, light + dark. **Do this first.** |
| `01-navigation.md` | Sidebar, topbar, rail, mobile nav, admin sidebar |
| `02-common-components.md` | Buttons, inputs, cards, chips, avatars, menus, tooltips, popovers, toasts, modals, confirm, date picker, stepper, tables, empty states, skeletons |
| `03-task-drawer.md` | Drawer header, meta, tabs, subtasks, comments, files, time, approval |
| `04-boards-table-views.md` | Kanban, table, filters, three-state sort, bulk, inline edit, column resize |
| `05-today-dashboard.md` | Today layout, hero, stats, activity, week strip, onboarding checklist |
| `06-sanvaad-varta.md` | Channels, messages, threads, reactions, DMs, WhatsApp, emoji picker |
| `07-pahchan.md` | **Rewritten for v1** — human comparison, camera-only, punch contract, retention |
| `08-rbac-screens.md` | Members, invite wizard, matrix, support access, audit log, denied + degraded states |
| `09-customization.md` | Appearance, typography, layout, language, notifications, data & privacy |
| `10-org-settings.md` | Org profile, members, billing, modules, security, danger zone |
| `11-platform-admin.md` | Platform dashboard, orgs, users, billing, costs, support sessions, system settings, admin nav |
| `12-auth-onboarding.md` | Login, signup, forgot/reset, accept invite, onboarding, email templates |
| `13-module-pages.md` | Shared module chrome + all 15 modules. **The three biggest pages must be split before restyling** |
| `14-dark-mode.md` | Dark token mapping + per-component overrides |
| `15-mobile-web.md` | Responsive web on a phone — breakpoints, sheets, bottom nav, hover fallbacks |
| `16-animations.md` | Durations, easings, entry/exit pairs, springs, scroll behaviour |
| `17-mobile-app.md` | React Native: 19 screens, `tokens.ts`, nav, offline queue |
| `18-documents.md` | The 8 tenant-branded documents, print geometry, brand layer |
| `19-client-portal.md` | The surface a customer's client sees |
| `20-search-palette.md` | Global search, command palette, scoping |
| `21-notifications-inbox.md` | Bell panel, inbox, the 8 kinds, in-app/push/email consistency |
| `22-landing-page.md` | Public marketing page |
| `23-accessibility.md` | Focus traps, ARIA, contrast obligations, keyboard nav |
| `24-bilingual-devanagari.md` | English/Hindi labels, font loading, the 6 language options |
| `25-qa-acceptance.md` | Two CI scripts, contrast method, per-screen checklist |
| `26-component-inventory.md` | Class vocabulary, state modifiers, the shared Picker |
| `27-vikray.md` | Sales — orders, stock, targets. Crash fixed upstream; the split is still open |
| `28-messaging-v2.md` | **Sanvaad + Varta as one module, two tabs.** Inline threads, embedded records, the conversation ground |
| `29-sahayak.md` | **Srijan is now Sahayak.** The assistant, its answer contract, and a palette divergence to settle |
| `30-skills-marketplace.md` | **Skills.** A catalogue you request from, the permission list, contextual discovery |

**All 31 written.** `25` was parked until implementation started and is now unparked; its first section is two CI scripts, because eight defects in this handover were the same bug class and every one was invisible to reading and obvious to a script.

**Implementation sequence lives in `CLAUDE-CODE-START-HERE.md`, not here.** These files are organised by surface; that one carries the eleven-phase build order and the three things that gate the last of the new surfaces.

**Treat every defect claim here as a line-quote, not a behavioural test.** This has now been measured twice, and the ratio held both times: **of the five ship-blockers in `CLAUDE-CODE-START-HERE.md`, two were real, two were stale and one was false.** The false ones were produced by grepping identifier names rather than reading behaviour, and they concealed a real defect in the same file. `25` §3 has the method.

Five separate claims in this set have now failed a check against source — `ConfirmDialog`'s missing `role`, the focus-trap grep, the Kanban touch mechanism, the GST split, and `/v1/vikray/targets`. Every one read as confident and specific. **Verify before acting, every time.**

`22` is the landing page. Empty/loading/error never became its own file: `Skeleton.jsx` already lives in `02-common-components.md`, so the four error states and the offline banner were folded in there as a revision.

## Corrections applied after review

`00-tokens.md` is the source of truth for every value. Seven conflicts were found and resolved:

1. **`14` and `15`/`17` quoted a different palette** — `#F7F4ED`/`#14171A` and a different semantic set. Reissued against `00`.
2. **`--shadow-4` was used in `03`, `04`, `11` and `15` but never defined.** Now in both palettes in `00` §7–8.
3. **The retired legacy blue `#0082c6` had reappeared** in `--st-in-progress`, `--pr-medium` and `--tick-read`. Removed.
4. **Status colours now flip with the theme** — the old "never flips" rule was wrong and contradicted `02`. No single mid-tone hex is legible on both `#FAF7F0` and `#12151A`. Three of the six statuses now reuse `--ok`/`--warn`/`--danger`.
5. **The read tick is `#4FC3F7`** — WhatsApp's own blue, not the retired brand blue.
6. **The type scale is `calc()`-derived** off `--font-size-base`, so the Text size slider works on more than raw body copy. `--radius-base` default moved 12px → **10px**, which is actually one of its own options. *(Corrected in `00` §2 at the time; the prototype `tokens.css` was not brought along until 2026-08-05 and shipped literals in the meantime. `SetCustomize.jsx` also wrote the slider value as a raw inherited `font-size` rather than to the token, and wrote `--ix` where §2 says `--ix-user` — both now fixed.)*
7. **`applyPrefs` writes `--ix-user`, never `--ix`** — an inline style outranks a media query, so the previous version silently defeated OS reduced-motion. Also: `--ease-emph` and `--ease-standard` were the identical curve, and `--primary-hover` was lighter than `--primary` in light mode.

Two files carry a scope caveat, stated in the file itself: `13-module-pages.md` was written without reading `GrahaPage.jsx`, `ManavPage.jsx` or `GanitPage.jsx` in full (150 KB, 133 KB, 125 KB), and `08-rbac-screens.md` was written without reading `AdminPage.jsx` in full (36 KB). Their file-structure guidance holds; expect line-level surprises inside those four.

## The defects found while writing this

Not a design list — things that are broken in staging today, each recorded in the file that covers it:

| Severity | Defect | File | Upstream as of 2026-08-05 |
|---|---|---|---|
| Ship-blocking | `addToast` doesn't exist — `useToast()` returns `pushToast`. Creating a Sanvaad channel succeeds server-side then throws in the UI | `06` | **Fixed** — `d9638ae`. The identifier no longer appears in `SanvaadPage.jsx` |
| Ship-blocking | You cannot read message scrollback — the 5s poll plus an unconditional autoscroll yanks you to the bottom every five seconds | `06` | **Open.** A separate claim that the scrollback was *also* 2.9:1 was stale — the file carries one hex, `#4FC3F7`, which is the correct read tick |
| High | `/admin/billing` has no `org_id` on any call — it administers the operator's own org, not the customer's | `11` | Open |
| High | Threads are write-only: you can reply into one, and the replies are unreachable | `06` | Open |
| High | Task IDs on the dashboard are fabricated from the array index, so two tasks can share an ID | `05` | Open |
| High | The onboarding checklist can never complete — three of five steps are hardcoded `false` | `05` | Open |
| High | Kanban drag uses the HTML5 drag API, which does not fire on touch | `04` | **False.** `KanbanView.jsx` imports `@hello-pangea/dnd`; the card renders inside `<Draggable>` and `draggable` is never passed, so the HTML5 attributes are inert. The library ships its own touch sensor |
| Medium | `delivered` and `read` are the same `'✓✓'` string — you can't tell if a customer saw your message | `06` | Open |
| Medium | `var(--k-danger)` and `var(--danger)` in the same file, so one reject button isn't red | `08` | Open |
| Medium | GST is a single 18% column — cannot represent a compliant intra-state CGST+SGST invoice | `11`, `18` | **Wrong premise, and two real items in its place** — see below |
| Medium | Recording a payment has no date or amount: partials impossible, last week's payment records as today | `11` | Open |
| Medium | `--font-ui` is set to the display font in both arms of its own check — picking a serif turns the whole UI serif | `09` | **Fixed** — the identical-arms branch is deleted |
| Medium | `/v1/subscription/plans` is fetched on every load and never rendered — there is no upgrade path | `10` | Open. Note the catalogue holds two plan generations with incompatible price units — filter on `is_active` |
| Medium | `PageHeader` is called with four different prop signatures; at least one page silently drops its subtitle | `08`, `09` | Open |
| Medium | "Approved today" is counted by filtering a truncated page of history | `08` | Open. List endpoints cap at 200 rows whatever limit is asked for — never reconcile a total by summing a list |
| Low | Eight independent status-colour maps, all light-only | `14` | **Fixed at token level.** `--st-*` aliases the semantic tokens, so one contrast pass corrected every chip. Do not re-expand an alias to a literal |
| Low | `${c}18` hex-alpha concatenation breaks the moment a token is substituted | `10` | Open — and now live, see #29 |
| Low | Shift+Enter is dead code — the composer is an `<input>`, which can't hold a newline | `06` | Open |

### The GST claim, corrected

The customer-facing tax invoice **is** split, and has been since `018_graha_ganit_manav.sql`. `staging.ganit_invoices` carries `place_of_supply`, `is_igst`, `cgst`, `sgst`, `igst` and `cess`, wired end to end — `_compute_invoice()` does the split, the PDF service renders IGST or CGST+SGST, and the invoices tab displays it. Same columns on quotations, Vikray orders and vendor bills. **`18-documents.md` was wrong to generalise this; `11-platform-admin.md` was right about its own table.** No shared GST helper is needed.

Two real items replace it, both smaller:

1. **`is_igst` is a manual checkbox and `place_of_supply` is free text** (placeholder `"e.g. Maharashtra"`). Inter-state versus intra-state is derivable — supplier state from the org GSTIN against the buyer's place of supply. A wrongly ticked box produces an invoice that looks correct and breaks the customer's input tax credit, which is worse than a missing feature. **Design change: a state dropdown carrying GST state codes, `is_igst` derived and shown as a read-only consequence, with a manual override for SEZ and exports.** Covered in `13`.
2. **Aekam's own subscription invoices are not GST-split.** Real, and `11`'s. Blast radius is 2 orgs and 2 subscriptions.

Three token systems ship today: web (warm-earthy), auth (cold blue `#f4fafd`/`#0a1628`), and the mobile app (iOS grey + M3 teal). Two of the three never received the design system.

Note: `04` is filed as `04-boards-table-views.md` and `05` as `05-today-dashboard.md` — the names follow the nav labels (Boards, Today) rather than the internal component names.

## Stack — applies to every file

Vite + **React with JSX (no TypeScript)** · plain CSS custom properties in `editorial.css` · FastAPI · Supabase Postgres.
**No Tailwind in new code. No component library.** Everything custom, using `k-*` classes.

Existing Tailwind class names appear in some staging components (`ui/modal.jsx`, `ui/Tabs.jsx`, `ui/StatusBar.jsx`, `ui/Tooltip.jsx`, `ui/CommandPalette.jsx`, `views/*`). Those are being replaced — when you touch one of those files, convert it to `k-*` classes rather than extending the Tailwind.

## Breakpoints — the only three

```css
/* mobile  */ @media (max-width: 767px)
/* tablet  */ @media (min-width: 768px) and (max-width: 1023px)
/* desktop */ @media (min-width: 1024px)
```

Do not introduce others. The prototype uses 1023px and 720px in places; normalise to the three above on implementation.

## Reference prototypes

| Prototype | Shows |
|---|---|
| `Kartavaya Redesign.html` | Shell + 15 module screens + RBAC + Pahchan + platform |
| `Interaction Catalogue.html` | 42 interactions as live demos with specs — **the source of truth for motion** |
| `Auth Screens.html` · `Onboarding.html` · `Auth Emails.html` · `Landing Page.html` | Public + auth surfaces |
| `Settings.html` | Customization, org settings, platform admin |
| `docs/*.html` | Tenant-branded documents |

## One rule that has broken three times

**Never hide a navigation surface by breakpoint without shipping its replacement in the same commit.** It happened with `.side`, `.adm__side` and the onboarding mobile surface; each time it left a screen with no way out. If a media query contains `display: none` on a nav, the same query must contain the burger, sheet or bottom bar that replaces it.


## Second review pass — additional findings

Sixteen more, from grounding files 19–24 in the staging source.

### Ship-blocking

| # | Finding | File |
|---|---|---|
| 19 | ~~**Nothing traps focus anywhere.**~~ **Partly false.** The grep for `focusTrap`/`focusLock` really does return zero, but it searched identifier names rather than behaviour: `FocusTrap.jsx` exists and `ConfirmDialog` had a working hand-rolled trap in its own `handleKeyDown`. What was genuinely untrapped: `modal.jsx`, the drawer, the palette and the sheets. **The real defect this concealed:** `FocusTrap` restored focus to a node that had already unmounted, dropping the user at `<body>` on exactly the destructive paths `ConfirmDialog` guards. Now fixed — it checks `isConnected` and falls back to `[data-focus-fallback]` or `main`. | `23` |
| 20 | ~~**`ConfirmDialog` has `aria-modal="true"` and no `role`.**~~ **False** — `role="alertdialog"` sits on the line directly above the two the claim quotes. The real half was the hardcoded `cd-title`/`cd-msg` ids, since fixed with `useId`. | `23` |
| 21 | **Toasts are announced to nobody.** `NotifToast` has no `role` and no `aria-live`; every success and every error in the product is silent to a screen reader. | `23` |
| 22 | **The command palette promises search and searches nothing.** Placeholder reads "Type a command or search…"; `ALL_ITEMS` is 30 hardcoded routes and actions. A user typing a client name gets "No results found" for data they have open in another tab. | `20` |
| 23 | **The language selector offers six languages and there is no translation layer.** No i18n library, no catalogue, no `t()`. Choosing हिन्दी gives Hindi nav labels and an otherwise entirely English interface. | `24` |

### High

| # | Finding | File |
|---|---|---|
| 24 | **Three components own notification state independently** — `AppShell` polls, `NotificationsModal` fetches, `InboxPage` fetches. Mark read in one and the others disagree. They also send two different shapes to the same `mark-read` endpoint. | `21` |
| 25 | **Two client portals ship**, and `ClientPagesImpl.jsx` labels one of them "legacy dark portal" in its own source — a **fourth** token vocabulary. | `19` |
| 26 | **The content-free toast.** `AppShell` manufactures "New notification / Open notifications to view" with no `url`, so it interrupts, costs a decision and returns nothing. | `21` |
| 27 | **`NotificationsSettingsPage` reads `Notification.permission` unguarded** — throws on iOS Safari < 16.4, embedded webviews, and any non-secure context. `AppShell` guards the same call correctly. | `21` |
| 29 | **`Badge` emits an invalid colour.** `background: \`${c}18\`` in `ModuleUI.jsx` — with `statusColors.js` now returning `var(--st-done)`, this evaluates to `"var(--st-done)18"` and is dropped. Every status badge renders with no background, including all six order states in Vikray. `mixAlpha` already exists for this. | `02` |
| 28 | **`TargetsTab` is rendered and does not exist.** `VikrayPage.jsx` has `'targets'` in `TABS` and renders `<TargetsTab />`; the component is not defined in the file and not exported anywhere in `frontend/src`. Clicking the fourth tab is an uncaught `ReferenceError`. **Fixed** — the 135-line component was recovered from `cae0e0a^`, not rewritten, with its tokens corrected on the way in. `/v1/vikray/targets` was there all along. | `27` |
| 35 | **Four different shapes for one bilingual label** (`{en,hi,gu}`, `{en,hi}`, `{label,hi}`, `{label,sans}`) and Gujarati exists in only one of them — so a Gujarati user sees three scripts on one screen. | `24` |

### Medium

| # | Finding | File |
|---|---|---|
| 30 | Palette fuzzy match is a subsequence test over a 40-char concatenation — 3 letters match nearly every item, in source order. | `20` |
| 31 | `scrollIntoView` on every arrow key in the palette — same call that breaks Sanvaad's scrollback. | `20` |
| 32 | The push permission prompt fires on a **4-second timer** on first load. Deny once and the browser blocks it permanently. | `21` |
| 33 | Palette "Actions" are navigations — "New Invoice" drops you on the invoice list to hunt for the button. Two entries (`srijan`, `scrapers`) share one route. | `20` |
| 34 | `InboxPage` is on the legacy `--ink-3`/`--bg-soft` palette. | `21` |

### Two things that must not ship as written

- **The landing page's SOC 2 badge.** Unaudited, and claimed to the one audience that will check. Remove it. (`22`)
- **"Start free" points at nothing.** Staging is invite-only with no signup route or endpoint. This is a business-model decision, not a broken link. (`22`, `12`)


## Shipped upstream since this handover — 2026-08-05

An end-to-end test programme ran against staging between 27 July and 3 August and found **nine defects that no amount of reading would have caught**, because each one only appears when a click reaches the database. Three were the same shape: a value of the wrong Python type handed to a typed Postgres column, surfacing as an opaque "Internal server error" with nothing on screen. E-sign produced no signed document at all. Order-generated invoices were born fully paid. Bank statement import and publishing attendance to payroll had each never once worked for any org since being written. 34 Srijan images were bought, stored and invisible.

None of those are design defects, and they are listed here for one reason: **they change what the surfaces in this set have to show.** An endpoint that has never succeeded has no error state anyone has seen, and the screens above were specified against the assumption that the happy path worked.

### New or changed since the handover was written

| What | Where it lands |
|---|---|
| **Org switcher shipped** (`165b2fd0`) — the resolver used to fall back to the user's oldest membership, so a member of two firms could only see one. Mechanism shipped, surface did not. **Now designed** | `01` |
| **Seats are enforced, not decorative** (`ca896ec`). `organisations.max_users` is entered by hand per org; a forty-worker client whose allowance was never set cannot create worker forty-one | `01`, `11` |
| **A Professional plan does exist**, as `is_active: false`. The "Upgrade to Professional or higher" string points at a *retired* tier, not a missing one. Two plan generations ship with incompatible price units | `11` |
| **`place_of_supply` needs to be a state dropdown with GST codes**, with `is_igst` derived rather than ticked by hand | `13` |
| **An expense cannot carry a receipt.** `ganit_expenses.receipt_urls` exists; the form has no file input | `13` |
| **No employee onboarding pack exists.** No PDF route in `routers/manav.py`, and none of the eight documents in `18` is an employee document | `18` |
| **Graha tab labels are `id.replace(/-/g,' ')`**, so the UI reads "follow ups" and "web forms" | `13` |
| **Required date fields that are not defaulted block submit silently** — expense date, follow-up `due_at`. The button looks dead rather than the field looking wrong | `02` |
| **`esign` and `srijan` are bundled modules**, gated on `plans.features` rather than `module_subscriptions`, and the gate caches for 5 minutes | `10` |
| **Two of three orgs have no R2 credentials**, so every uploaded file is stored as base64 in Postgres | `02`, `18` |
| **Pahchan API contract changed**: `selfie_key` required, `face_score` dropped, `device_id` advisory only. New `pahchan_enrollment_photos` table | `07` |

### Still ours, and not yet done

- **Ten hardcoded sub-11px literals** bypass the type scale, so they do not move with the Text size slider — a user on base 20px gets a 20px nav label above a 10px Devanagari sub-label. Fixed in `01` (three sites) and `03`; still outstanding in `02`, `05`, `07`, `13` and `24`.

  **Use the named token first: `var(--t-label-sm)` (11px floor) or `var(--t-label)` (11.5px).** They already carry the `max()` floor, so there is nothing to get wrong. Only where a file argued a ratio *below* the 11px floor — `.side__hi` and `.side__badge` at 10px, `.kbd` at 10.5px, `.dr__lbl` at 10px — write `max(<floor>, calc(var(--font-size-base) * <ratio>))` directly. Keep the ratio the file argued for, lose the literal.

  **A caution learned the hard way on 2026-08-05.** The first pass at this wrote the raw `calc()` form everywhere, including into three rules in `app.css` — and `Kartavaya Redesign/tokens.css` did not define `--font-size-base` at all. It shipped the type scale as fixed literals, despite correction #6 below asserting for two weeks that the scale was calc-derived. Every one of those declarations was silently dropped, so the metadata sub-line rendered at its inherited 13.3px instead of 11px and clipped the one value the spec calls load-bearing. **`00-tokens.md` §2 was right and the prototype stylesheet was the artifact that was behind** — now corrected, along with the density block, which was re-pointing `--t-body` to literals and would have broken the derivation in two of three densities. This is the eighth instance of the same bug: a token referenced everywhere and declared nowhere. `25`'s `check-tokens.mjs` catches it in a second.
- **`applyPrefs` must derive `--primary-text` per accent preset**, not just `--primary` and `--primary-hover`. Twelve presets ship; without it each one is an unmeasured text-contrast risk (`09`).
- **`14-dark-mode.md` carried a mangled sentence** from an earlier rewrite, reintroducing a caveat on `--ok` that `00` §7 removed when the token was darkened. Corrected.
