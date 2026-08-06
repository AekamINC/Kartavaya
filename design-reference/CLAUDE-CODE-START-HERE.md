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
3. **`design-handover/01`–`31`** — one file per surface. `28`–`30` were written last and are the three surfaces with no prior handover file: messaging, the assistant and skills. Each states its prerequisites, gives exact CSS, the component tree, new file paths, API endpoints, and a **before → after table for the staging files it changes**.
4. **The six specs** — referenced by the handover files, never restated by them. `RESEARCH.md` (market and competitor grounding), `RBAC-SPEC.md`, `MESSAGING-ATTENDANCE-SPEC.md`, `AUTH-SPEC.md`, `SETTINGS-ADMIN-SPEC.md`, `MOTION-SPEC.md`.

---

## Build order

The numbered files are organised by surface, not by sequence. This is the sequence. Each phase assumes the one above it landed — the dependencies are real, not preferences.

| # | Phase | Files | Why here |
|---|---|---|---|
| 0 | **Instrumentation** | `25` | Two CI scripts, day one. Eight defects in this set were one bug class — a token referenced everywhere and declared nowhere — and every one was invisible to reading and instant to a script. Do not start without them |
| 1 | **Tokens** | `00`, `14` | Light and dark together. Dark is a token mapping, not a later pass — splitting them is what produced eight disagreeing status-colour maps |
| 2 | **Component vocabulary** | `02`, `26`, `16` | Everything downstream is assembled from these. `26` supersedes `02`'s state guidance where they differ |
| 3 | **Chrome** | `01`, `20`, `21` | Nav, org switcher, palette, notifications. Three components own notification state independently today — collapse that here, not per page |
| 4 | **Work surfaces** | `03`, `04`, `05` | Drawer, boards, Today. One `DueChip`; delete the other two due-date implementations on the way through |
| 5 | **Modules** | `13`, `27`, `18` | Fifteen module pages on shared chrome. **Split Graha, Manav and Ganit before restyling them** — 408 KB between three files |
| 6 | **The three new surfaces** | `28`, `29`, `30` | Last: each needs the component vocabulary, and each carries a dependency that is not design work — below |
| 7 | **Access and administration** | `08`, `10`, `11`, `09` | RBAC, org settings, the platform console, customization |
| 8 | **Public and auth** | `12`, `22`, `19` | Login, onboarding, landing, client portal |
| 9 | **Cross-cutting passes** | `15`, `23`, `24` | Responsive, accessibility, bilingual. Each is a sweep over everything above, and each has items that cannot be retrofitted cheaply — **read them before phase 4**, apply them here |
| 10 | **Mobile app** | `17`, `31` | A new Expo app. `tokens.ts` is rewritten from `00` before any screen work. **Read `31` before laying out a single screen** — it decides the navigation shell, and retrofitting a rail and a pane host onto twenty finished phone screens is the expensive order |

**Phase 6 does not start clean.** One thing gates it, and it is not styling:

- **`28` needs `include_reply_counts`** on `GET /v1/messaging/channels/:id/messages`. Inline threads are a *data* change before they are a UI change — `list_messages` filters `parent_message_id IS NULL`, so a reply is never in the log to render. Do the query first, or the surface has nothing to show.

The other two gates are settled — see below. `29` still owes a contrast pass on cream and dark before it ships, and `30` owes the request endpoint, but both are now build work rather than open questions.

### Sanvaad and Sahayak are pixel work, not interpretation

`28` and `29` are the two surfaces where the prototype stylesheet is the specification. **Match `messaging.css` and `sahayak.css` exactly** — spacing, radii, the two-step shadows, type scale, both themes. Where the prose in `28`/`29` and the stylesheet disagree, the stylesheet is right; the prose exists to say *why*, not to restate values. Do not substitute the nearest existing component: the bubbles, the answer blocks and the record cards are new and are meant to be.

**One thing on these two surfaces is an addition rather than a match:** a sixth conversation ground called `kamal`, drawn from the lotus. `28` §6 carries the constraints — rosette course only (`LOTUS_COURSES[0]`, ten lobes r34–r70, plus the r32 eye), one pen, one colour, rotated off-axis with alternate rows offset so it cannot grid up into a watermark, two tiles for light and dark, legible at both 44px and 96px. `lotusLobe()` already returns the path; do not redraw it.

---

## The five ship-blockers have been adjudicated — read this before acting on any of them

This table previously said all five were "verified against the branch rather than quoted from a grep." **That was not true, and the implementer checked each one individually.** Two were real, two were stale, one was false. Both real ones are now fixed on `staging`.

| | Claim | Verdict |
|---|---|---|
| 1 | `addToast` does not exist; `SanvaadPage.jsx` destructures it in three places | **Stale** — the identifier does not appear in the file at all. Fixed in `d9638ae` |
| 2 | Sanvaad scrollback is `#94a3b8` on `#0f172a`, 2.9:1 | **Stale** — the file contains exactly one hex, `#4FC3F7`, the correct read tick. Neither quoted colour appears; all text is on tokens |
| 3 | `FocusTrap` cleanup calls `previous?.focus?.()` with no `isConnected` check | **Real**, at `FocusTrap.jsx:67`. Fixed — restores to a connected element, falling back to `[data-focus-fallback]` or `main` |
| 4 | Kanban drag does not work on touch at all — HTML5 drag API | **False.** `KanbanView.jsx` imports `@hello-pangea/dnd`; the card renders inside `<Draggable>` with `dragHandleProps` on the wrapper and `draggable` is never passed, so the HTML5 attributes on it are inert. The library implements its own touch sensor |
| 5 | `TargetsTab` is rendered and defined nowhere | **Real, and newly introduced** by `cae0e0a`. Fixed — the 135-line component was recovered from `cae0e0a^` rather than rewritten |

**What is actually left of this section: nothing.** Start at `00-tokens.md`, which is shipped, then follow the sequencing in `design-handover/README.md`.

### Why this keeps happening, and what it costs

Five separate claims in this handover have now failed a check against source: `ConfirmDialog`'s missing `role`, the focus-trap grep, the Kanban touch mechanism, the GST split, and `/v1/vikray/targets` being listed as an endpoint that does not exist. Each one read as confident and specific. The pattern is always the same — **a grep for an identifier name standing in for a test of behaviour.**

The two false focus claims are the instructive case, because they concealed a real defect in the same file. `FocusTrap.jsx` exists, is imported by `Modal` and `ConfirmDialog`, and is careful work: `preventScroll` on both focus calls, the focusable list rebuilt per keypress and filtered on `offsetParent`, the trigger captured before focus moves inward. `ConfirmDialog` carries `role="alertdialog"`, `aria-modal`, `aria-labelledby` and `aria-describedby`, with `useId`. What was broken was subtler than either claim: the captured trigger could be **unmounted** by the time the overlay closed, so the restore was a silent no-op on precisely the destructive paths `ConfirmDialog` guards.

**Treat every defect claim in this set as a line-quote, not a behavioural test.** Confirm against the branch before acting on one.

---

## Three things that are true of the whole codebase

**There are three token vocabularies shipping, and two never received the design system.** Tailwind utilities in `ui/*.js`, `--ink`/`--rule`/`--k-primary` in the drawer, and the redesign's own set. `mobile/src/theme/tokens.ts` is a fourth — iOS grey with M3 teal. `00-tokens.md` is the single source; everything else is migration.

**Status colour is defined in eight independent places that disagree.** A `done` task renders `#16a34a` green in the drawer and `#05b7aa` teal in the list. `requested` is purple in one view and amber in another. `--k-danger` and `--danger` both appear, so some "red" buttons are not red. Fixed by aliasing to `--st-*` / `--ap-*` / `--pr-*` (`00` §9), which is also why one contrast fix propagated to every chip.

**Due-date logic exists three times with three different outputs.** The same task reads "Today, 4:30 pm", "Due today, 4:30 pm", or "Jul 25" depending on the view. One `DueChip.jsx`.

---

## Decisions already settled — do not re-open

1. **Invite-only.** No open signup. The landing page's "Start free" must not ship pointing at nothing; both paths are designed in `12`.
2. **Sensitive modules (Vetana, Ganit, Manav) default to no access**, by role, not by opt-out.
3. **The mobile app is a new app**, not a restyle — `tokens.ts` is rewritten before any screen work (`17`), and it is a tablet app as well as a phone app from the first commit (`31`).
4. **Org deletion is queued for 7 days**, not executed.
5. **Support access is never silent.** Impersonation writes to the customer's own audit log and emails the owner.
6. **The SOC 2 badge on the landing page must be removed or qualified.** It is an unaudited claim made to the one audience that will check.
7. **WhatsApp is its own tab, not a row type in a unified list.** Reversed after review, and the reason is safety rather than filing: a customer thread is metered, template-gated and inside a 24-hour window, and it must not sit one click from an internal channel (`28` §1).
8. **Skills are requested, not installed.** `assign_skill_to_org` is guarded by `OPERATIONS_CONSOLE_ROLES`, which holds no org-tier role. Design for the rule rather than changing it, and **do not build a self-serve install path behind a feature flag** — a button that 403s is worse than a button that is honest (`30` §1).

## Two decisions settled 2026-08-06 — phase 6 is unblocked

1. **Sahayak ships on cream, matching the prototype exactly.** Remove `k-surface-theme` from `.sh` and let every token resolve to the product palette — that is the whole change, because nothing in the prototype's `sahayak.css` carries a literal colour. **The cost is a contrast re-measurement**, and it is not optional: the existing upstream file was measured by hand against Slate and indigo specifically, and `check-contrast.mjs` cannot see scope. `29` opens with the pairs to re-check first.
2. **`POST /v1/hub/skills/:id/request` is in scope.** Body is a free-text note; the caller is the requester; idempotent per org and skill while a request is open; lands as a lead for the account contact and emails them. State reads back through `GET /v1/hub/org/skills`, not a second endpoint. Full shape in `30` §11.

What still gates phase 6 is the messaging query change, and only that: `28` needs `include_reply_counts` on `GET /v1/messaging/channels/:id/messages` before inline threads have anything to render.

---

## Where the design files are

`Kartavaya Redesign/` — 15 HTML prototypes. Open `Start Here.html` first; it links the rest.

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
| `Messaging v2.html` | **New.** Sanvaad + Varta as one module and two tabs. Inline threads, records embedded in the bubble, the conversation ground, distinct sent/delivered/read. `28` |
| `Sahayak.html` | **New.** The assistant, renamed from Srijan — answer-first, every claim cited, the refusal block, named work steps, the lotus as the only waiting state. `29` |
| `Skills Marketplace.html` | **New.** A catalogue you request from rather than install from, with the reads/changes list, live cost, and blockers stated on the card. `30` |
| `Tablet.html` | **New.** Six tablets from 7-inch Android to iPad Pro 13", portrait and landscape, app and browser, with Split View and Slide Over. `31` |
| `docs/Document Kit.html` | 8 tenant-branded print documents (invoice, payslip, GSTR-3B, TDS challan, quotation, SoA, agreement, project report) |

Support files sit alongside: `tokens.css`, `app.css`, `motion.css` and the per-surface CSS are the real stylesheets the handover quotes. `*.jsx` files are prototype code — read for structure, don't port.

---

## Two scope caveats, stated honestly

`13-module-pages.md` was written **without reading Graha, Manav and Ganit in full** — 408 KB between them. `08-rbac-screens.md` was written without reading `AdminPage.jsx` in full. Their structural guidance holds; expect line-level surprises inside those four files.

**Vikray** is now covered by `27-vikray.md`, written against the source.

That file also found a claim in this handover that was already stale — commit `cae0e0a` had removed the private colour map the ledger attributed to Vikray. Read `25-qa-acceptance.md` §3 before acting on any defect claim here.

**Vikray's ship-blocker is fixed upstream**, and `27`'s claim that `/v1/vikray/targets` "does not exist" was wrong — the endpoint family and `staging.vikray_targets` were both already there. What remains in `27` is the restyle: the split into `vikray/`, one `LineItemEditor`, detail into a drawer, `ConfirmDialog` on cancel.

---

## Run the checks before you trust anything

`25-qa-acceptance.md` was written last, deliberately, and its first section is two CI scripts. Add them on day one.

**Eight defects in this handover were the same bug**: a token or class referenced everywhere and declared nowhere. An unresolved `var()` returns an empty string and CSS drops the declaration silently — no console warning, no visible error, just a component that renders without its shadow, its status colour, or its Devanagari font. Every one survived multiple careful reads and would have died instantly to `check-tokens.mjs`.

`25` also carries the measurement traps, which cost more time than the defects did: `color(srgb 0.93 0.90 0.84)` uses 0–1 values; `rgba(255,255,255,.12)` composited as opaque white makes a translucent chip read exactly 1.00; toggling `data-theme` leaves `color` resolved on already-styled nodes until a forced restyle; and `element.focus()` does not fire React's `onFocus` when the document itself is unfocused. **A broken instrument is worse than none — it reports confident failures on a clean page.**
