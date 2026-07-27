# Responsive & accessibility sweep — branch `audit/responsive-a11y`

Branched fresh from `origin/staging` at **`190fa73a`** (verified with
`git log -1 --oneline origin/staging`; the seeded worktree was at `1aa49855`,
~758 commits stale, and was discarded).

Companion to `swarm-reports/a11y-responsive-audit.md`, which is a **contrast and
token** audit. This one is **geometry, keyboard reachability and semantics**.
They overlap in almost nothing; where both mention a component, neither
contradicts the other.

---

## 0 · Method, and what "verified" means here

Screenshots were unavailable all session ("Browser pane is not displayed"), so
nothing below rests on an image.

**Web — measured in a running browser.** A vite dev server was run from this
worktree on **:5341** (never :5173). A throwaway harness (`audit.html` +
`src/audit-main.jsx`, both deleted before commit, `.env.local` gitignored)
mounted the **real `<App/>`** with `api.defaults.adapter` stubbed and
`VITE_BACKEND_URL` pointed at a dead port (`127.0.0.1:9`), so:

* `Protected` was satisfied by a stubbed `/auth/me` — **no sign-in, no request
  ever left the machine, the shared Supabase project was never touched.**
* the full stylesheet cascade and a populated sidebar were present, which is the
  *faithful probe* `editorial.css:71` demands.

The overflow test used was deliberately strict, because a naive one lies:

> an element is a defect only if its right edge exceeds `documentElement.clientWidth`
> **and no ancestor is a real horizontal scroller** (`overflow-x: auto|scroll`
> with `scrollWidth > clientWidth`).

Without the ancestor walk, every correctly-scrolling table and tab strip reads as
a defect. With it, `/settings/roles` — which *looked* like a 557px overflow —
resolves correctly as an `.amx` scroller doing its job.

**A second trap worth recording:** at a 500–750ms settle the previous route's DOM
is still mounted, and `/hub` inherited `/settings/roles`' access-matrix table in
the first pass. Everything below was re-measured at **1900ms**. Any future sweep
should use that number.

**Mobile — NOT VERIFIED by rendering.** There is no simulator. Every mobile claim
is from source reading plus `npx tsc --noEmit`. Nothing about how a mobile screen
*looks* is asserted.

---

## 1 · Coverage

**48 routable surfaces. 47 reached. 1 not reached.**

| | |
|---|---|
| Reached and measured | 47 |
| **Not reached** | **1** — `/client/project/:projectId` (client-portal project detail). The portal harness run covered the other four portal routes; this one needs a project id that resolves inside the portal's own thin payload, and I ran out of budget to shape it. |
| Reached only in a degraded state | 3 — `/accept-invite` and `/reset-password` render their *token-missing* branch (the form branch needs a live token); `/sign/:token` renders its *unauthenticated* branch, because `SigningPage.jsx:47` builds its **own** axios instance (`const ax = axios.create(...)`) which `api.defaults.adapter` cannot reach. Layout was measured on the branch that rendered. |

The 247 files under `frontend/src/pages/` are not 247 pages — most are tab
bodies mounted inside a parent route. Coverage above is by **route**, and every
module page's tab strip was exercised where a tab was needed to reach a finding.

Widths: **393 was swept across all 47 routes.** 1280 and 820 were swept across
the routes that carry the shared chrome and every route that failed at 393
(dashboard, tasks, boards, projects/:id, inbox, approvals, graha, ganit, manav,
settings/roles, admin, the four portal routes, and the auth pages). 393 is the
binding constraint — every breakpoint in the product is `max-width` — so a route
clean at 393 and 1280 can only fail at 820 via a rule scoped to 768–1023, and the
only such rules are the nav ones, which were checked directly (§4).

---

## 2 · Dark mode — measured, not assumed

`dark-theme.css` contains **zero** layout-affecting declarations, and an `awk`
sweep of every `[data-theme="dark"]` / `prefers-color-scheme: dark` block across
all 5 stylesheets that carry one returned **zero** matches for `width`, `height`,
`display`, `grid-template`, `flex-direction`, `padding`, `margin`, `position`,
`font-size`, `gap`, `inset`, `min-width`, `max-width` or `transform`.

Confirmed live at 393px on `/dashboard`: toggling `data-theme` moved the canvas
from `rgb(243,239,230)` to `rgb(12,14,17)` while `.kv__content` stayed
**393×726** and `.k-hero` stayed **350×326** — byte-identical geometry,
`docOver` 0 in both.

**Therefore the dark column in §7 is geometrically identical to the light
column by construction, not by spot-check.** A dark sweep of `/tasks`,
`/boards`, `/graha`, `/admin` and `/settings/roles` was run anyway and was clean.

---

## 3 · Defects fixed

### 3.1 `/tasks` and `/activity` — the Archived toggle was off-screen and unreachable

The worst responsive finding in the sweep.

`.k-segctrl` is `inline-flex` + `flex-shrink: 0` + `white-space: nowrap`
(`editorial.css:1592`). Inside `.vtb__bar` that is fine, because `ViewToolbar`
wraps it in `.vtb__scroll` (`overflow-x: auto; max-width: 100%`,
`boards.css:467`). Inside `.k-filterbar` — `TasksListPage.jsx:350` and
`ActivityFeedPage.jsx:99` — **there is no wrapper**, and `.kv__content` is
`overflow-x: hidden`.

Measured on `/tasks` at 393px before the fix:

| | |
|---|---|
| `.k-segctrl` width | 480px, inside a 351px `.k-filterbar` |
| its right edge | **496** in a 394px viewport |
| `.k-segctrl__btn--archive` right edge | **492** — ~98px past the edge |
| scrollable ancestor | **none** |

So the Archived filter could not be reached by scrolling, dragging, or the
keyboard. A control that does not exist on a phone.

**Fix** — `mobile-responsive.css`: give the unwrapped case the *same* mechanism
`.vtb__scroll` already uses, rather than a second one. `.k-filterbar > .k-segctrl`
(0-2-0) is what beats the bare `.k-segctrl` in `editorial.css`, which loads later.

**Verified after:** `.k-segctrl` `overflow-x: auto`, clientW 348 / scrollW 478;
scrolling 130px puts `Archived` fully inside the viewport (right edge **362**);
`docOver` 0; nothing clipped anywhere on the route.

### 3.2 `.vtb__end` did not wrap — `/boards`, `/ganit`, `/projects/:id`

`.vtb__end` is a bare `display: flex` with `margin-left: auto` and no wrap, so
its three children (search pill 217px + a 96px toggle + a 50px count) ran past
their 351px track. `.vtb__count`'s right edge measured **396** in a 394px
viewport. Small, but the same class of bug and clipped the same way.

**Fix** — `.vtb__bar > .vtb__end { flex-wrap: wrap; row-gap: var(--sp-2) }` at
≤1023. **Verified after:** `flex-wrap: wrap`, `scrollWidth === clientWidth`
(350 === 350), nothing unreachable on any of the three routes.

### 3.3 `.row2` — the last two-up form grid with no query

Every sibling already collapses on a phone: `.form__row` (`components.css:641`),
`.gr__grid` (`graha.css:83`), `.k-modal__grid` (`editorial.css:2921`),
`.k-formpanel__grid--2` (`editorial.css:3417`), `.hcl-form` / `.tpl-grid2`
(`workflow.css:435`). `.row2` (`components.css:92`) was a hard `1fr 1fr` at every
width. It carries the stock-adjustment form (`vikray/StockTab.jsx:128`) and the
order edit row (`vikray/OrderDetail.jsx:322`) — a number input and a select at
~150px each on a 393px screen.

**Fix** — `.row2 { grid-template-columns: 1fr }` at ≤767, matching `.form__row`,
its neighbour in the same file.

> `.k-dr__props` (`editorial.css:2723`) and `.k-savetmpl` (`editorial.css:3450`)
> are also hard `1fr 1fr` with no query — but both are **dead CSS**, with no JSX
> user anywhere in the tree. Reported, not "fixed"; deleting them is a different
> change with a different owner.

### 3.4 `/admin` and `/admin/billing` crashed outright — `ui/Table.jsx`

Found because the audit could not open them: both fell into the `ErrorBoundary`.
Not a harness artefact.

`HeadCell` derived `dir` **before** its own guard:

```js
const dir = sort?.key === sortKey ? sort.dir : null;   // ← ran first
...
if (!sortKey || !onSort) return <th …>{children}</th>; // ← too late
```

A plain `<HeadCell>Status</HeadCell>` passes neither prop, so
`sort?.key === sortKey` compares `undefined` to `undefined` — **true** — and the
next expression reads `.dir` off `undefined` and throws. That shape is
`OrgTable.jsx:90` and **every** header in `AdminBillingPage.jsx` (lines 300–304,
394–401).

**Fix** — move the guard above the derivation. No behaviour change for the
sortable path. **Verified after:** `/admin`, `/admin/billing`, `/admin/orgs` and
`/admin/costs` all render, `docOver` 0, nothing unreachable, at 393 and 1280.

*Out of my stated remit (a crash, not responsive/a11y). Fixed because it blocked
four pages the deliverable is required to report on, and because the fix is one
reordering with zero visual effect. Flagged here so it is not mistaken for scope
creep.*

### 3.5 Keyboard-unreachable records — four tables and one card

A `<tr onClick>` is not focusable. Where the row was the **only** route into a
record, the record was mouse-only.

| File | Before | Fix |
|---|---|---|
| `pages/graha/ClientsTab.jsx:206` | `<tr onClick>`, **no focusable child at all** | name cell becomes a `.gr__link` button |
| `pages/graha/ContactsTab.jsx:352` | `<tr onClick>`; the only focusable child was **Delete** — the keyboard could reach the destructive action and not the record | name cell becomes a `.gr__link` button |
| `pages/prachar/CampaignsTab.jsx:381` | `<tr onClick>`, no focusable child | name cell becomes a shared `.btn--text` button |
| `components/views/TableView.jsx:262` | `<tr onClick>` opened the drawer; the checkbox and the custom-field editors were focusable, **the record was not** | title becomes a `.tb__ttlbtn` button (reset-only class, added to `boards.css`) |
| `components/editorial/ModuleUI.jsx` `ModCard` | `<div className="k-modcard" onClick>` — used with a handler by `vetana/PayrollTab`, `PayslipsTab`, `StructuresTab` | renders a `<button>` **when and only when** it has a handler; `.k-modcard--btn` supplies the four properties a button does not inherit |

This follows the convention already in the tree — `ganit/InvoicesTab.jsx:135`,
`graha/DealsTab.jsx:276` and `vikray/OrderRows.jsx:51` each did exactly this, and
each left a comment saying why. No new mechanism was invented.

**Verified live:** `ClientsTab` — 8 rows, each with a focusable `button.gr__link`;
focusing it and activating changed the view. `ContactsTab` — 8 rows, name button
focusable, Delete still present. `ModCard` — all 8 cards now `<button>`,
focusable, and computed style unchanged (width 350px, `text-align: left`,
padding `16px 20px`, border 1px, `display: flex`).

**NOT VERIFIED at runtime:** `TableView` (the fixture never populated
`board.filtered` — the view rendered "0 tasks / Loading board…") and
`CampaignsTab` (empty-state: "No campaigns on the channels you have selected").
Both compile, build, pass `check-classes` (`.tb__ttlbtn` has a rule, 0 missing)
and pass the 682-test suite — but **I did not see either render**, and say so.

### 3.6 Touch targets — the three that were safe to fix

Measured at 393px against the 44px floor (`15-mobile-web.md` §Hit targets):
`.k-segctrl__btn` **31px**, `.apv-seg__btn` **32px**, `.mwarn` **31px**. All
three are already wide enough; only height was deficient, so `min-height`
grows the one axis that is short and cannot re-space a row. Added to the
existing touch-target block. `.k-segctrl__btn--archive` **verified 31 → 44px**.

### 3.7 Mobile — the seven zero-coverage files, and six more

My brief named seven. The raw-attribute grep that produced that number **misses
`components/a11y.ts`**, a complete and well-built prop-factory module
(`a11yButton`, `a11yLink`, `a11yToggle`, `a11ySelected`, `a11yInput`,
`a11yHeading`, `a11yImage`, `a11yText`, plus `hitSlopTo`) that several files use
instead of raw attributes. Counting both, the true set of **interactive** files
with zero coverage was **13**, not 7:

the seven — `NewTaskSheet`, `BoardScreen`, `MeScreen`, `SettingsScreen`,
`InboxScreen`, `LoginScreen`, `ClientPortalScreen` — plus
`AttachmentSourceSheet`, `taskdetail/SafeHeader`, `SubtaskRow`, `CommentRow`,
`MoveModal`, `AssigneePickerModal`, `Section`.

All 13 now carry coverage, built **on the existing helpers** — no new mechanism.
Files with a11y coverage went **27 → 40**. Highlights:

* **`LoginScreen`** — email and password inputs had a visual `<Text>` label and
  no programmatic one; the eye toggle was icon-only and unnamed; and a failed
  sign-in rendered a banner with **no role and no live region**, so pressing
  SIGN IN and failing was *silent*. Now `role="alert"` +
  `accessibilityLiveRegion="assertive"`.
* **`CommentRow`** — comment actions were reachable **only by long-press**, which
  a screen reader cannot perform. Now also exposed via `accessibilityActions`,
  and the comment reads as one item instead of three.
* **`BoardScreen`** — view pills and column tabs carried "which is current" in
  the **fill colour alone**; now in `accessibilityState.selected`. Task cards get
  one composed label instead of six separate stops, with *overdue* and the
  approval state spelled out because on the card they are chip colours.
* **`InboxScreen`** — unread was a coloured bar and urgent a coloured border,
  both invisible to a screen reader; both are now in the row's label.
* **`SettingsScreen`** — the notification switches announced as unnamed toggles
  beside a row that said nothing about state; the row now owns the label and the
  checked state and the switch is hidden from the tree, so it is one stop, not two.

`npx tsc --noEmit` → **exit 0**.

---

## 4 · Confirmed correct — checked, and deliberately not touched

**The narrow-viewport tab clipping is NOT a defect. Confirmed, no mechanism
added.** Measured on `/graha` at 393px: `.mt` is `overflow-x: auto`, clientW 254
vs scrollW 668, and it **actually scrolled** (`scrollLeft` reached 413.6). Its
computed `background-image` is the four-layer gradient — the edge fade
`15-mobile-web.md:69` asks for — and `.mt__ovf` is a pinned sibling carrying a
**More +N** popover, so overflowing tabs are also enumerable without scrolling at
all. `/inbox`'s `.tabs__list` is the same shape (scrollW 710 vs clientW 351,
scrolled 358.4). Both fine.

> Worth flagging: `ModuleTabs.jsx:9-34` records that the *scroller* was the old
> defect and the **More menu** is the fix, and `module.css:502-509` documents the
> exact 13px double-fix regression my brief warned about — already resolved.
> Nothing in that area needed a change.

**`.kv` independent scrolling holds.** The faithful probe named at
`editorial.css:71` was run: all 11 stylesheets loaded, sidebar populated with 37
links, at 1280×500 so both axes overflow.

| | |
|---|---|
| `.kv` `grid-template-rows` | `500px 0px` — the **viewport**, not the 683px content |
| `.kv__content` | clientH 444 / scrollH 683 → scrolls |
| `.side__nav` | clientH 303 / scrollH 550 → scrolls, held at `scrollTop` 180 independently |
| document | did not scroll |

One trap for the next person: `.kv__content` has **`scroll-behavior: smooth`**,
so setting `scrollTop` and reading it back synchronously returns 0 and looks like
the regression. With `behavior: 'instant'` it scrolls to 150.4 and holds. I
nearly filed this as the regression returning; it is not.

**Nav is never hidden without its replacement.** At 820: `.kv__side` is
`display: none`, the burger (`aria-label="Open menu"`) is visible, and clicking
it opens the drawer with a scrim and a full nav. At 1280: sidebar visible and the
burger's parent `.kv__mobbar` collapses it to 0×0 — *not* a redundant control, as
a naive `display` check suggests.

**All four defects in `23-accessibility.md` are already fixed on staging.**
`components/ui/FocusTrap.jsx`, `SkipLink.jsx` and `hooks/useRestoreFocus.js` all
exist; `FocusTrap` is wired into **16** overlays; `ConfirmDialog` has
`role="alertdialog"` + `aria-modal` + `useId`; live regions exist in
`NotifToast.jsx:263-264` and `toast.jsx:185-186`; "Skip to content" renders.

Verified live, full cycle: `Ctrl+K` opens the palette → focus moves inside to
`.k-cmdk__input` → `role="dialog"` and `role="combobox"` both present → Escape
closes it → **focus is restored to the triggering button**. That is
`23-accessibility.md` §Defect 1's hardest requirement, working.

> `hooks/useRestoreFocus.js` has **no importer** — `FocusTrap`'s own cleanup does
> the restoring. Dead file, harmless, reported not deleted.

**Tables already scroll and freeze their first column.** `mobile-responsive.css`
:265-357 handles both populations, including a `:has(> table)` catch-all for the
~30 pages that render a bare `<table>`. The spec asks for a *visible edge fade*;
the implementation ships a **visible scrollbar track** instead and documents why
at :303-307 (a `background` fade is painted over by the table's own rows and
sticky header). **I did not add a fade** — that would be a second mechanism for a
concern already solved, which is the exact failure mode my brief warned about.
Recorded as a deliberate, documented divergence for the owner to accept or not.

---

## 5 · Found, NOT fixed — and why

### 5.1 Touch targets below 44px that need a rendered check (priority follow-up)

Measured at 393px. These need the **hit-area expansion** `23-accessibility.md`
§Touch targets describes (a pseudo-element, not a taller box), and doing that
blind is dangerous: a 44px overlay on controls that sit **28px apart in pairs**
would have each one swallowing its neighbour's taps — silently, and worse than a
small target.

| Control | Measured | Where |
|---|---|---|
| `.k-trow__tick` | **17×17** | mark-a-task-done, the primary row action on `/tasks` |
| `.k-notifbanner__x` | 24×24 | `/inbox` banner dismiss |
| `.k-approvals__act--yes` / `--no` | 28×26 each, adjacent | `/dashboard` approvals card |
| `.k-row-action--archive` | 28×18 | `/tasks` row |
| `.k-cash__segbtn` | 39×23 | `/dashboard` cash card |
| `.k-link` | 69×21 | "View all →", "4 more →" |
| `.apv-row__t--link` | 153×20 | `/approvals` row title |
| `.mt__b` / `.tabs__b` | 40 / 41 tall | 3–4px short; they also carry `::after` (the active underline, `module.css:152`), so an overlay would destroy it |

`.k-trow__tick` at 17px is the one I would fix first.

### 5.2 `OnboardingChecklist` crashes the whole app shell — hooks order

`components/OnboardingChecklist.jsx`: `if (dismissed) return null;` at **line 67**,
but there is a `useEffect` at **line 119**. When `dismissed` flips true the
component runs one fewer hook and React throws *"Rendered fewer hooks than
expected"*, which the `ErrorBoundary` catches — **taking the entire `AppShell`
with it.**

Live path: `allDone` (line 120) → `dismiss()` → `setDismissed(true)` → crash. So
a user who completes all four setup steps — create a project, invite a member,
create a task, name the org — loses the whole app on their next render. Which is
every new firm, shortly after onboarding.

I hit this immediately with real-shaped fixture data and had to work around it to
audit anything at all. **Not fixed: it is a hooks bug, not responsive or a11y,
and it is severe enough to deserve its own change with its own tests rather than
riding in an audit branch.** Flagged as a background task.

### 5.3 `.k-wday` — a false affordance

`kartavaya-design.css:867-879` gives `.k-wday` `cursor: pointer` and a `:hover`
background. `WeekStrip.jsx` renders it with **no handler** — nothing is
clickable. Not an a11y barrier (no function is unreachable, because there is no
function), but seven cells per dashboard invite a tap that does nothing. Cosmetic;
in shared CSS a peer may own; left alone.

---

## 6 · Files touched (24)

**Frontend (9)** — `components/ui/Table.jsx` · `components/editorial/ModuleUI.jsx` ·
`components/views/TableView.jsx` · `pages/graha/ClientsTab.jsx` ·
`pages/graha/ContactsTab.jsx` · `pages/prachar/CampaignsTab.jsx` ·
`styles/mobile-responsive.css` · `styles/boards.css` · `styles/editorial.css`

**Mobile (15)** — `components/NewTaskSheet.tsx` · `components/AttachmentSourceSheet.tsx` ·
`screens/BoardScreen.tsx` · `screens/MeScreen.tsx` · `screens/SettingsScreen.tsx` ·
`screens/InboxScreen.tsx` · `screens/LoginScreen.tsx` · `screens/ClientPortalScreen.tsx` ·
`screens/TaskDetailScreen.tsx` · `screens/taskdetail/SafeHeader.tsx` ·
`screens/taskdetail/SubtaskRow.tsx` · `screens/taskdetail/CommentRow.tsx` ·
`screens/taskdetail/MoveModal.tsx` · `screens/taskdetail/AssigneePickerModal.tsx` ·
`screens/taskdetail/Section.tsx`

Only 3 CSS files were touched, and every rule in them is either scoped to a
selector no other concern uses (`.row2`, `.tb__ttlbtn`, `.k-modcard--btn`) or
appended to a block that already existed for that purpose. Nothing was restyled
beyond a defect. No lockfile, no snapshot: the
`visual-regression.test.jsx.snap` diff this run produced was **line-ending only**
(`git diff --ignore-all-space` empty) and was reverted.

---

## 7 · Per-route matrix

`ovf` = unreachable horizontal overflow (the strict test in §0). Dark is
geometrically identical to light by §2. `a11y` verdict is for what this sweep
covers: real controls, accessible names, roles, focus.

| Route | file | 1280 | 820 | 393 | dark | a11y | evidence |
|---|---|---|---|---|---|---|---|
| `/dashboard` | `DashboardPage.jsx` | ok | ok | ok | ok | ok | ovf 0 all widths; skip link renders; palette traps + restores focus |
| `/boards` | `BoardsPage.jsx` | ok | ok | **fixed** | ok | ok | `.vtb__end` 29px → wraps; ovf 0 after |
| `/projects` | `ProjectsPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/projects/:id` | `ProjectBoardPage.jsx` | ok | ok | **fixed** | ok | ok | same `.vtb__end`; ovf 0 after |
| `/tasks` | `TasksListPage.jsx` | ok | ok | **fixed** | ok | ok | Archived was 98px off-screen; reachable after (right 362) |
| `/teams` | `TeamsPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/inbox` | `InboxPage.jsx` | ok | ok | ok | ok | ok | `.tabs__list` scrolls 358px — all 5 tabs reachable |
| `/approvals` | `ApprovalsPage.jsx` | ok | ok | ok | ok | ok | ovf 0; `.apv-seg__btn` 32 → 44px |
| `/templates` | `TemplatesPage.jsx` | ok | ok | ok | ok | ok | `.k-tmpl-tabs` 6px, within its own box |
| `/activity` | `ActivityFeedPage.jsx` | ok | ok | **fixed** | ok | ok | same `.k-filterbar > .k-segctrl` as `/tasks` |
| `/automations` | `AutomationsPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/time` | `TimeReportPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/reports` | `ReportsPage.jsx` | ok | ok | ok | ok | ok | `.gr__seg` 31px inside its own box |
| `/settings/categories` | `CategoriesPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/settings/customize` | `CustomizeSettingsPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/settings/organisation` | `OrgSettingsPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/settings/roles` | `RolesAccessPage.jsx` | ok | ok | ok | ok | ok | `.amx` scroller 350/968 — table reachable, not clipped |
| `/hub` | `HubDashboardPage.jsx` | ok | ok | ok | ok | ok | ovf 0 (first pass was stale DOM — see §0) |
| `/hub/clients` | `HubClientsPage.jsx` | ok | ok | ok | ok | ok | card→button already fixed on staging (file header) |
| `/hub/clients/:id` | `HubClientDetailPage.jsx` | — | ok | ok | ok | ok | ovf 0 |
| `/hub/clients/:id/skills` | `HubSkillsPage.jsx` | — | — | ok | ok | ok | ovf 0 |
| `/hub/org` | `OrgSrijanPage.jsx` | ok | ok | ok | ok | ok | `.sr-page` 8px inside its own box |
| `/graha` | `GrahaPage.jsx` | ok | ok | ok | ok | **fixed** | `.mt` scrolls 413px + fade; Clients/Contacts rows now keyboard-reachable |
| `/ganit` | `GanitPage.jsx` | ok | ok | **fixed** | ok | ok | `.vtb__end`; invoices already had the row button |
| `/manav` | `ManavPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/vikray` | `VikrayPage.jsx` | ok | ok | ok | ok | ok | ovf 0; `OrderRows` already buttons |
| `/pahchan` | `PahchanPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/vetana` | `VetanaPage.jsx` | ok | ok | ok | ok | **fixed** | 8 `ModCard`s → `<button>`, focusable, layout unchanged |
| `/dristi` | `DristiPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/prachar` | `PracharPage.jsx` | ok | ok | ok | ok | **fixed¹** | campaigns row button — ¹NOT VERIFIED rendering (empty state) |
| `/esign` | `EsignPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/sanvaad` | `SanvaadPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/admin` | `AdminPage.jsx` | ok | — | **fixed** | ok | ok | crashed before (`HeadCell`); renders after |
| `/admin/billing` | `AdminBillingPage.jsx` | — | — | **fixed** | ok | ok | crashed before; renders after |
| `/admin/orgs` | `AdminOrgsPage.jsx` | — | — | **fixed** | ok | ok | crashed before; renders after |
| `/admin/costs` | `AdminCostDashboardPage.jsx` | — | — | ok | ok | ok | ovf 0 |
| `/onboarding` | `onboarding/OnboardingPage.jsx` | — | — | ok | ok | ok | ovf 0 |
| `/login` | `LoginPage.jsx` | — | ok | ok | ok | ok | ovf 0 |
| `/forgot-password` | `auth` | — | ok | ok | ok | ok | ovf 0 |
| `/reset-password` | `auth` | — | ok | ok | ok | ok | token-missing branch only |
| `/accept-invite` | `auth` | — | ok | ok | ok | ok | token-missing branch only |
| `/approve` | `ApprovePage.jsx` | — | ok | ok | ok | ok | ovf 0 |
| `/sign/:token` | `SigningPage.jsx` | — | ok | ok | ok | ok | unauth branch only — own axios instance |
| `/client` | `client/ClientShell.jsx` | ok | ok | ok | ok | ok | ovf 0; **0 unnamed controls** |
| `/client/projects` | `ClientProjectsPage.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/client/approvals` | `client/ClientApprovals.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/client/files` | `client/ClientFiles.jsx` | ok | ok | ok | ok | ok | ovf 0 |
| `/client/project/:id` | `ClientBoardPage.jsx` | — | — | — | — | — | **NOT REACHED** |

`—` = not measured at that width (see §1 for the sweep rationale); it is not a
pass claim.

---

## 8 · Mobile screens

**Every rendering-dependent claim below is NOT VERIFIED — no simulator exists.**
Evidence is source reading plus `npx tsc --noEmit` (exit 0). "fixed" means the
file now carries accessible names/roles/state built on `components/a11y.ts`.

| Screen / component | a11y before | after | note |
|---|---|---|---|
| `screens/BoardScreen.tsx` (734 loc) | **zero** | **fixed** | back btn, project switcher, view pills + column tabs (`selected` state), task card composite label, picker rows, cancel |
| `components/NewTaskSheet.tsx` (659 loc) | **zero** | **fixed** | close, title input + error alert, project/status/priority chips, templates (`expanded`), due date, assignees, attachments, submit |
| `screens/MeScreen.tsx` (467) | **zero** | **fixed** | settings rows announce label+value, non-pressable rows no longer claim `button`, sync + sign out |
| `screens/SettingsScreen.tsx` (432) | **zero** | **fixed** | theme rows `selected`, notification rows own the toggle state, switches de-duplicated, TimeWheel `expanded`, sync, permissions, sign out |
| `screens/InboxScreen.tsx` (520) | **zero** | **fixed** | filter chips `selected`; unread + urgent moved out of colour into the row label |
| `screens/LoginScreen.tsx` (204) | **zero** | **fixed** | email/password names, eye toggle, **error banner now `role="alert"` + assertive**, submit busy/disabled |
| `screens/ClientPortalScreen.tsx` (204) | **zero** | **fixed** | back, comment input, post, sign out, task cards |
| `components/AttachmentSourceSheet.tsx` | **zero** | **fixed** | four source cards + cancel |
| `screens/taskdetail/SafeHeader.tsx` | **zero** | **fixed** | icon-only close named |
| `screens/taskdetail/SubtaskRow.tsx` | partial | **fixed** | delete button named, `hitSlopTo(14)` |
| `screens/taskdetail/CommentRow.tsx` | **zero** | **fixed** | long-press-only actions now exposed via `accessibilityActions` |
| `screens/taskdetail/MoveModal.tsx` | **zero** | **fixed** | column rows named; colour dot hidden |
| `screens/taskdetail/AssigneePickerModal.tsx` | **zero** | **fixed** | checkmark-only selection → `accessibilityState.checked` |
| `screens/taskdetail/Section.tsx` | **zero** | **fixed** | icon-only action takes a `label`; both call sites in `TaskDetailScreen` pass one |
| `ApprovalsScreen` · `ChatScreen` · `TasksScreen` · `TodayScreen` · `TimeScreen` · `MessagesScreen` · `MoreScreen` · `RemindersScreen` · `BoardsScreen` · `TaskDetailScreen` | present | unchanged | already carried coverage |
| `modules/{Dristi,Ganit,Graha,Manav,Prachar,Srijan,Vetana}Screen` · `ModuleShell` | partial | unchanged | `ModuleShell` and Dristi/Manav carry it; Ganit/Graha/Prachar/Srijan/Vetana screens are list renderers with text labels — no icon-only controls found |
| `pahchan/{ClockScreen,EnrollScreen,AttendanceHistory}` | present | unchanged | already covered |
| `pahchan/MyBiometrics` · `MyRegister` | none | unchanged | no interactive controls found |
| `nav/BottomBar` · `App` · `components/{Sheet,SwipeRow,TaskCard,ScreenState,NotificationBanner,PulseDot,Refresher}` · `taskdetail/{ApprovalBanner,ApprovalModal,Avatar,Divider}` · `theme/*` · `nav/{RootStack,TabScene}` · `context/NotificationContext` | n/a or present | unchanged | either already covered or non-interactive |

Files with a11y coverage: **27 → 40**.

---

## 9 · Gates

| Gate | Result |
|---|---|
| `node scripts/check-tokens.mjs` | 356 declared, 244 referenced, **0 missing** — exit 0 |
| `node scripts/check-classes.mjs` | 3519 selectors, 2709 classes, **0 missing a rule** — exit 0 |
| `npx vite build` | **exit 0**, built in 17.14s |
| `npx vitest run` | **43 files / 682 tests passed, exit 0**, `unhandled` count **0** — exactly baseline |
| `mobile/ npx tsc --noEmit` | **exit 0** |

Committed on branch **`audit/responsive-a11y`**. `main` untouched. Database never
read or written — the harness pointed at a dead port and no request left the
machine.
