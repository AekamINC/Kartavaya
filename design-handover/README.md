# Kartavaya design handover

27 files, `00`–`26`. Read them in order — each states its own prerequisites.

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
| `27-vikray.md` | Sales — orders, stock, targets. **Contains a ship-blocker** |

**All 28 written.** `25` was parked until implementation started and is now unparked; its first section is two CI scripts, because eight defects in this handover were the same bug class and every one was invisible to reading and obvious to a script.

**Treat every defect claim here as a line-quote, not a behavioural test.** Two of the five ship-blockers in `CLAUDE-CODE-START-HERE.md` were false — produced by grepping identifier names rather than reading behaviour — and they concealed a real defect in the same file. `25` §3 has the method.

`22` is the landing page. Empty/loading/error never became its own file: `Skeleton.jsx` already lives in `02-common-components.md`, so the four error states and the offline banner were folded in there as a revision.

## Corrections applied after review

`00-tokens.md` is the source of truth for every value. Seven conflicts were found and resolved:

1. **`14` and `15`/`17` quoted a different palette** — `#F7F4ED`/`#14171A` and a different semantic set. Reissued against `00`.
2. **`--shadow-4` was used in `03`, `04`, `11` and `15` but never defined.** Now in both palettes in `00` §7–8.
3. **The retired legacy blue `#0082c6` had reappeared** in `--st-in-progress`, `--pr-medium` and `--tick-read`. Removed.
4. **Status colours now flip with the theme** — the old "never flips" rule was wrong and contradicted `02`. No single mid-tone hex is legible on both `#FAF7F0` and `#12151A`. Three of the six statuses now reuse `--ok`/`--warn`/`--danger`.
5. **The read tick is `#4FC3F7`** — WhatsApp's own blue, not the retired brand blue.
6. **The type scale is `calc()`-derived** off `--font-size-base`, so the Text size slider works on more than raw body copy. `--radius-base` default moved 12px → **10px**, which is actually one of its own options.
7. **`applyPrefs` writes `--ix-user`, never `--ix`** — an inline style outranks a media query, so the previous version silently defeated OS reduced-motion. Also: `--ease-emph` and `--ease-standard` were the identical curve, and `--primary-hover` was lighter than `--primary` in light mode.

Two files carry a scope caveat, stated in the file itself: `13-module-pages.md` was written without reading `GrahaPage.jsx`, `ManavPage.jsx` or `GanitPage.jsx` in full (150 KB, 133 KB, 125 KB), and `08-rbac-screens.md` was written without reading `AdminPage.jsx` in full (36 KB). Their file-structure guidance holds; expect line-level surprises inside those four.

## The defects found while writing this

Not a design list — things that are broken in staging today, each recorded in the file that covers it:

| Severity | Defect | File |
|---|---|---|
| Ship-blocking | `addToast` doesn't exist — `useToast()` returns `pushToast`. Creating a Sanvaad channel succeeds server-side then throws in the UI | `06` |
| Ship-blocking | You cannot read message scrollback — the 5s poll plus an unconditional autoscroll yanks you to the bottom every five seconds | `06` |
| High | `/admin/billing` has no `org_id` on any call — it administers the operator's own org, not the customer's | `11` |
| High | Threads are write-only: you can reply into one, and the replies are unreachable | `06` |
| High | Task IDs on the dashboard are fabricated from the array index, so two tasks can share an ID | `05` |
| High | The onboarding checklist can never complete — three of five steps are hardcoded `false` | `05` |
| High | Kanban drag uses the HTML5 drag API, which does not fire on touch | `04` |
| Medium | `delivered` and `read` are the same `'✓✓'` string — you can't tell if a customer saw your message | `06` |
| Medium | `var(--k-danger)` and `var(--danger)` in the same file, so one reject button isn't red | `08` |
| Medium | GST is a single 18% column — cannot represent a compliant intra-state CGST+SGST invoice | `11`, `18` |
| Medium | Recording a payment has no date or amount: partials impossible, last week's payment records as today | `11` |
| Medium | `--font-ui` is set to the display font in both arms of its own check — picking a serif turns the whole UI serif | `09` |
| Medium | `/v1/subscription/plans` is fetched on every load and never rendered — there is no upgrade path | `10` |
| Medium | `PageHeader` is called with four different prop signatures; at least one page silently drops its subtitle | `08`, `09` |
| Medium | "Approved today" is counted by filtering a truncated page of history | `08` |
| Low | Eight independent status-colour maps, all light-only | `14` |
| Low | `${c}18` hex-alpha concatenation breaks the moment a token is substituted | `10` |
| Low | Shift+Enter is dead code — the composer is an `<input>`, which can't hold a newline | `06` |

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
| 19 | **Nothing traps focus anywhere.** Zero matches for `focusTrap`/`focusLock` across 158 files. Tab out of the open task drawer and focus walks into the board behind the scrim. | `23` |
| 20 | **`ConfirmDialog` has `aria-modal="true"` and no `role`.** `aria-modal` is ignored without `role="dialog"`, so the component guarding every destructive action never announces itself. Its `cd-title` id is also hardcoded. | `23` |
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
| 28 | **`TargetsTab` is rendered and does not exist.** `VikrayPage.jsx` has `'targets'` in `TABS` and renders `<TargetsTab />`; the component is not defined in the file and not exported anywhere in `frontend/src`. Clicking the fourth tab is an uncaught `ReferenceError`. | `27` |
| 29 | **Four different shapes for one bilingual label** (`{en,hi,gu}`, `{en,hi}`, `{label,hi}`, `{label,sans}`) and Gujarati exists in only one of them — so a Gujarati user sees three scripts on one screen. | `24` |

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
