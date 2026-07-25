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
3. **`design-handover/01`–`25`** — one file per surface. Each states its prerequisites, gives exact CSS, the component tree, new file paths, API endpoints, and a **before → after table for the staging files it changes**.
4. **The six specs** — referenced by the handover files, never restated by them. `RESEARCH.md` (market and competitor grounding), `RBAC-SPEC.md`, `MESSAGING-ATTENDANCE-SPEC.md`, `AUTH-SPEC.md`, `SETTINGS-ADMIN-SPEC.md`, `MOTION-SPEC.md`.

---

## Fix these before building anything

From the defect table. All five are in staging today.

| | Defect | File |
|---|---|---|
| 1 | **`addToast` does not exist.** `useToast()` returns `{pushToast, error, success, warning, info}`; `SanvaadPage.jsx` destructures `addToast` in three places — creating a channel succeeds server-side then throws in the UI | `06` |
| 2 | **Sanvaad scrollback is unreadable** — `#94a3b8` on `#0f172a`, 2.9:1 | `06` |
| 3 | **Nothing traps focus anywhere.** Zero `focusTrap`/`focusLock` matches across 158 files. Tab out of the open drawer and focus walks into the board behind the scrim | `23` |
| 4 | **`ConfirmDialog` sets `aria-modal` with no `role`** — so the component guarding every destructive action never announces itself | `23` |
| 5 | **Kanban drag does not work on touch at all** — HTML5 drag API, which does not fire on touch devices | `04` |

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

`Kartavaya Redesign/` — 9 HTML prototypes. Open `Start Here.html` first; it links the rest.

| File | What it shows |
|---|---|
| `Kartavaya Redesign.html` | The app — shell, 15 modules, thin-module second screens, RBAC states, Pahchan, platform console, all three settings hubs |
| `Interaction Catalogue.html` | 42 interactions across 12 sections, live. **The behavioural source of truth** — `MOTION-SPEC.md` is its written form |
| `Mobile App.html` | 19 React Native screens on iPhone 15 Pro / SE / Pixel 8, light + dark, with an offline toggle |
| `Auth Screens.html` · `Auth Emails.html` | 8 auth states · 4 send-ready email templates |
| `Onboarding.html` | 5-step first-run, with the honest skip ending |
| `Settings.html` | Customization · Organisation · Aekam admin |
| `Landing Page.html` | Public marketing page |
| `docs/Document Kit.html` | 8 tenant-branded print documents (invoice, payslip, GSTR-3B, TDS challan, quotation, SoA, agreement, project report) |

Support files sit alongside: `tokens.css`, `app.css`, `motion.css` and the per-surface CSS are the real stylesheets the handover quotes. `*.jsx` files are prototype code — read for structure, don't port.

---

## Two scope caveats, stated honestly

`13-module-pages.md` was written **without reading Graha, Manav and Ganit in full** — 408 KB between them. `08-rbac-screens.md` was written without reading `AdminPage.jsx` in full. Their structural guidance holds; expect line-level surprises inside those four files.

**Vikray (Sales · विक्रय)** has a page, a route and a palette entry in staging and appears in **no handover file**. It needs scoping before it can be planned.

---

## What is not written

`design-handover/25-qa-acceptance.md` is deliberately absent. It derives from the other 25 and would be stale before it was used — write it when implementation starts, against what was actually built.
