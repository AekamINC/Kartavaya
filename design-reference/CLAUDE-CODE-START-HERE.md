# Start here — Kartavaya redesign implementation

You are implementing a completed design into an existing codebase. **Read this file, then `design-handover/README.md`, then the numbered files in order.**

---

## What this bundle is

A **hi-fi** redesign of Kartavaya — a bilingual (English + Devanagari) practice-management platform for Indian CA firms and SMEs, plus Aekam, the platform-operator console above it.

The HTML files are **design references, not production code.** They are prototypes that show intended look, behaviour and motion. Do not copy them into the app. Recreate them in the existing codebase using its patterns.

The target stack is already known and the design was built against it:

- **Frontend** — Vite + React, **JSX not TSX, no TypeScript**, plain CSS custom properties, no component library, no Tailwind.
- **Mobile** — Expo 51 + React Native, **TypeScript** (`.tsx`) — the one place TS applies.
- **Backend** — FastAPI + Supabase Postgres.

Because the prototypes use the same CSS-custom-property approach the real app uses, most CSS in the handover files transfers close to verbatim. The React is not transferable — it is single-file prototype code with inline data.

---

## Read in this order

1. **`design-handover/README.md`** — the map, and the **defect table**: 18 findings ranked by severity, each pointing at the file that covers it.
2. **`design-handover/00-tokens.md`** — every colour, type, space, radius, shadow and motion token, with measured contrast. Nothing else makes sense before this.
3. **`design-handover/01`–`27`** — one file per surface. Each states its prerequisites, gives exact CSS, the component tree, new file paths, API endpoints, and a **before → after table for the staging files it changes**.
4. **The six specs** — referenced by the handover files, never restated by them. `RESEARCH.md` (market and competitor grounding), `RBAC-SPEC.md`, `MESSAGING-ATTENDANCE-SPEC.md`, `AUTH-SPEC.md`, `SETTINGS-ADMIN-SPEC.md`, `MOTION-SPEC.md`.

---

## Fix these before building anything

From the defect table. All five are in staging today, and all five are verified against the branch rather than quoted from a grep.

| | Defect | File |
|---|---|---|
| 1 | **`addToast` does not exist.** `useToast()` returns `{pushToast, error, success, warning, info}`; `SanvaadPage.jsx` destructures `addToast` in three places — creating a channel succeeds server-side then throws in the UI | `06` |
| 2 | **Sanvaad scrollback is unreadable** — `#94a3b8` on `#0f172a`, 2.9:1 | `06` |
| 3 | **Focus restore fails after destructive actions.** `FocusTrap` cleanup calls `previous?.focus?.()` with no `isConnected` check. Delete a task and the row holding the trigger unmounts, so the restore is a silent no-op and the user lands on `<body>` — losing keyboard position exactly where `ConfirmDialog` is used most | `23` |
| 4 | **Kanban drag does not work on touch at all** — HTML5 drag API, which does not fire on touch devices | `04` |
| 5 | **`TargetsTab` is rendered and does not exist.** `VikrayPage.jsx` has `'targets'` in `TABS` and renders `<TargetsTab />`; the component is defined nowhere in `frontend/src`. Clicking the fourth tab is an uncaught `ReferenceError` | `27` |

### Two entries were removed from this table because they were false

They claimed no focus trap existed anywhere and that `ConfirmDialog` had `aria-modal` with no `role`. Both were produced by grepping for identifier names rather than reading behaviour. `FocusTrap.jsx` exists, is imported by `Modal` and `ConfirmDialog`, and is careful work — `preventScroll` on both focus calls, the focusable list rebuilt per keypress and filtered on `offsetParent`, the trigger captured before focus moves inward. `ConfirmDialog` carries `role="alertdialog"`, `aria-modal`, `aria-labelledby` and `aria-describedby`, with `useId` to survive two dialogs at once.

**Treat every defect claim in the handover as a line-quote, not a behavioural test.** Confirm against the branch before acting on one. The real defect above was found only by reading the file the false claims pointed at.

---

## Three things that are true of the whole codebase

**There are three token vocabularies shipping, and two never received the design system.** Tailwind utilities in `ui/*.js`, `--ink`/`--rule`/`--k-primary` in the drawer, and the redesign's own set. `mobile/src/theme/tokens.ts` is a fourth — iOS grey with M3 teal. `00-tokens.md` is the single source; everything else is migration.

**Status colour is defined in eight independent places that disagree.** A `done` task renders `#16a34a` green in the drawer and `#05b7aa` teal in the list. `requested` is purple in one view and amber in another. `--k-danger` and `--danger` both appear, so some "red" buttons are not red. Fixed by aliasing to `--st-*` / `--ap-*` / `--pr-*` (`00` §9), which is also why one contrast fix propagated to every chip.

**Due-date logic exists three times with three different outputs.** The same task reads "Today, 4:30 pm", "Due today, 4:30 pm", or "Jul 25" depending on the view. One `DueChip.jsx`.

---

## Decisions already settled — do not re-open

1. **Invite-only.** No open signup. The landing page's "Start free" must not ship pointing at nothing; both paths are designed in `12`.
2. **Sensitive modules (Vetana, Ganit, Manav) default to no access**, by role, not by opt-out.
3. **The mobile app is a new app**, not a restyle — `tokens.ts` is rewritten before any screen work (`17`).
4. **Org deletion is queued for 7 days**, not executed.
5. **Support access is never silent.** Impersonation writes to the customer's own audit log and emails the owner.
6. **The SOC 2 badge on the landing page must be removed or qualified.** It is an unaudited claim made to the one audience that will check.

---

## Where the design files are

`Kartavaya Redesign/` — 11 HTML prototypes. Open `Start Here.html` first; it links the rest.

| File | What it shows |
|---|---|
| `Kartavaya Redesign.html` | The app — shell, 15 modules, thin-module second screens, RBAC states, Pahchan, platform console, all three settings hubs |
| `Interaction Catalogue.html` | 42 interactions across 12 sections, live. **The behavioural source of truth** — `MOTION-SPEC.md` is its written form |
| `System Blueprint.html` | The system behind the pixels — five state machines with guards, the entity map, real-time channels, offline replay, permissions, open questions. Read this before designing tables |
| `Mobile App.html` | 19 React Native screens on iPhone 15 Pro / SE / Pixel 8, light + dark, with an offline toggle |
| `Pahchan v1.html` | Attendance v1 — the punch flow, the review register, enrollment, the audit trail. **v1 is human review, not face matching**; `07` explains why that ordering is deliberate and what v1 must capture so v2 is possible |
| `Component Inventory.html` | Every component in every state. The button grid enumerates itself from the stylesheet rather than being typed |
| `Auth Screens.html` · `Auth Emails.html` | 8 auth states · 4 send-ready email templates |
| `Onboarding.html` | 5-step first-run, with the honest skip ending |
| `Settings.html` | Customization · Organisation · Aekam admin |
| `Landing Page.html` | Public marketing page |
| `docs/Document Kit.html` | 8 tenant-branded print documents (invoice, payslip, GSTR-3B, TDS challan, quotation, SoA, agreement, project report) |

Support files sit alongside: `tokens.css`, `app.css`, `motion.css` and the per-surface CSS are the real stylesheets the handover quotes. `*.jsx` files are prototype code — read for structure, don't port.

---

## Two scope caveats, stated honestly

`13-module-pages.md` was written **without reading Graha, Manav and Ganit in full** — 408 KB between them. `08-rbac-screens.md` was written without reading `AdminPage.jsx` in full. Their structural guidance holds; expect line-level surprises inside those four files.

**Vikray** is now covered by `27-vikray.md`, written against the source. It carries a sixth ship-blocker: `TargetsTab` is rendered by `VikrayPage.jsx` and is defined nowhere, so the fourth tab throws.

That file also found a claim in this handover that was already stale — commit `cae0e0a` had removed the private colour map the ledger attributed to Vikray. Read `25-qa-acceptance.md` §3 before acting on any defect claim here.

---

## Run the checks before you trust anything

`25-qa-acceptance.md` was written last, deliberately, and its first section is two CI scripts. Add them on day one.

**Eight defects in this handover were the same bug**: a token or class referenced everywhere and declared nowhere. An unresolved `var()` returns an empty string and CSS drops the declaration silently — no console warning, no visible error, just a component that renders without its shadow, its status colour, or its Devanagari font. Every one survived multiple careful reads and would have died instantly to `check-tokens.mjs`.

`25` also carries the measurement traps, which cost more time than the defects did: `color(srgb 0.93 0.90 0.84)` uses 0–1 values; `rgba(255,255,255,.12)` composited as opaque white makes a translucent chip read exactly 1.00; toggling `data-theme` leaves `color` resolved on already-styled nodes until a forced restyle; and `element.focus()` does not fire React's `onFocus` when the document itself is unfocused. **A broken instrument is worse than none — it reports confident failures on a clean page.**
