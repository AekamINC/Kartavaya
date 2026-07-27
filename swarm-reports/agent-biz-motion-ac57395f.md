# CRM · Sales · Finance — motion and interaction

Branch `agent/biz-motion-ac57395f`, cut from `staging` (`e9134b2`).
Surface: `pages/GrahaPage.jsx`, `pages/graha/*`, `pages/VikrayPage.jsx`,
`pages/GanitPage.jsx`, `pages/ganit/*`, `styles/animations.css`.
Lens: **behaviour and time**. Two siblings own structure and pixels.

---

## 0 · How these numbers were obtained

Reading CSS gives the wrong answer here and the brief says so. Everything below
was measured in a real engine.

- Own Vite dev server on **:5291** serving **this worktree** (`node_modules`
  junctioned from the main checkout). The shared `preview_start` server on :5173
  serves `D:/Projects/Kartavya`, i.e. **staging's tree, not mine** — measuring
  "after" on it would have measured a sibling's branch. Anyone else on this run
  measuring "their" change on :5173 is measuring somebody else's.
- `frontend/public/__ref/motion-probe.html` (gitignored) imports the four app
  stylesheets **in `App.jsx`'s order** (`index.css` → `kartavaya-design.css` →
  `editorial.css` → `settings.css`) and instantiates every class this surface
  renders.
- Playwright `page.emulateMedia({ reducedMotion })` for both media states,
  `document.getAnimations()` for what is actually running, and
  `getComputedStyle` longhands for what actually resolved.

Why the media emulation matters, concretely: `@media` contributes **no
specificity**, so a reduced-motion stop only lands if it is the *last*
declaration of that selector in source order. `animations.css` already knows
this — §9 stops `.ix-skeleton`/`.ix-pulse`, and §10 has to repeat the same stop
for `.skeleton`/`.animate-pulse` at the foot of the file because those two are
declared later. Both were verified as landing, by measurement, not by reading.

One more trap worth writing down: `getAnimations()` returns only animations that
are running **or still filling**. A finished `backwards`-fill one-shot
(`.ix-fade-up`, `.ix-stagger > *`) and a no-fill one-shot (`.bc.just`,
`.ix-flash`) vanish from that list the moment they end. Their absence is not
evidence they do not exist — the first pass of this measurement nearly recorded
four false negatives on exactly that. Computed `animation-name` is the reliable
read.

---

## 1 · Reduced motion — measured, and CLEAN on this surface

Under `prefers-reduced-motion: reduce`, the **only** infinite animation still
running anywhere in the probe is:

| Animation | Element | Duration | Iterations | Verdict |
|---|---|---|---|---|
| `dmSpin` | `.spin` | **640 ms** | infinite | correct — fixed, not `--ix`-scaled |

Everything else stops or collapses:

| Thing | no-preference | reduce | Mechanism |
|---|---|---|---|
| `.ix-skeleton::after` (`ixShimmer`) | 1700 ms ∞ | `none`, `opacity 0` | animations.css §9 |
| `.skeleton::after` (`ixShimmer`) | 1700 ms ∞ | `none`, `opacity 0` | animations.css §10 repeat |
| `.ix-pulse` / `.animate-pulse` (`ixPulse`) | 2000 ms ∞ | `none` | §9 + §10 repeat |
| `.k-shimmer__tile` (`k-shimmer-tile`) | 1700 ms ∞ | `none` | editorial.css:2793 |
| `.ix-stagger > *` delay | 0 / 38 / 76 / 114 ms | **0 s for every child** | §9 |
| `--ix` | `1` | `.001` | kartavaya-design.css §5 |
| `--motion-scale` | `1` | `0` | kartavaya-design.css §5 |

**No strobe on this surface. Nothing under 640 ms runs infinitely.** The three
sites fixed earlier in this run have not regressed here, and I have added
nothing that could reintroduce one — every animation I add below is either a
one-shot or inherits an existing stop.

The `--ix` / `--motion-scale` split holds and I have not touched it: `--ix`
scales *duration* and bottoms at `.001` so `animationend` still fires;
`--motion-scale` scales *distance* and bottoms at `0`. The reduced-motion strobe
that `16-animations.md:44` mandates and reference `motion.css:117` implements is
**not** present in the build and I did not "correct" the build toward it.

---

## 2 · Baseline — measured before/after

All values `getComputedStyle` at `--ix: 1`. `—` means the property resolved to
`none` / `0s`, i.e. the change is instantaneous.

### 2.1 · Already correct before I started (siblings' work, verified not regressed)

| Surface | Enter | Exit | Measured |
|---|---|---|---|
| Toast `.tst` | `tstIn` **220 ms** `cubic-bezier(.16,1,.3,1)` `both` | — (unmounts) | ✅ |
| Modal scrim | `modalIn` **140 ms** `cubic-bezier(.2,0,0,1)` | — | ✅ |
| Modal panel | `modalPanelIn` **220 ms** `cubic-bezier(.16,1,.3,1)` **delay 42 ms** `backwards` | — | ✅ |
| Drawer `.dr` | `dmDrawerIn` **360 ms** `cubic-bezier(.16,1,.3,1)` | `dmDrawerOut` 220 ms | ✅ |
| Sheet `.sheet` | `dmSheetIn` **302.4 ms** `cubic-bezier(.05,.7,.1,1)` | `dmSheetOut` 220 ms | ✅ |
| Popover `.pop` | `dmPop` **140 ms** `cubic-bezier(.34,1.36,.64,1)` | `dmPopOut` 119 ms | ✅ |
| Tooltip `.tip` | `dmTip` **140 ms** `cubic-bezier(0,0,.2,1)` | — (no exit, by design) | ✅ |
| Board card `.bc` | `box-shadow/border/opacity 140 ms`, `transform 90 ms` | — | ✅ |
| `.bc.pending` | `opacity .6` (measured 0.6) | — | ✅ |
| `.bc.just` | `bcJust` **540 ms** `cubic-bezier(.4,0,1,1)` | — | ✅ |
| `.bc.fresh` | `bcIn` **220 ms** `cubic-bezier(.16,1,.3,1)` | — | ✅ |
| `.bd__col` / `.over` | `background,border-color 140 ms` `cubic-bezier(.2,0,0,1)` | — | ✅ |

Those are the bar. The three pages I own do not reach it.

### 2.2 · The gaps on CRM / Sales / Finance

| # | Interaction | Before (measured) | Target |
|---|---|---|---|
| G1 | Pipeline card **drag and drop** (`graha/KanbanTab`) | **does not exist** — stage change is a row of buttons | pangea DnD, as `KanbanView` already does |
| G2 | **Stage transition** feedback | `await PATCH` → `load()` refetches the whole board; card disappears and reappears | optimistic move, `opacity .6`, rollback, 540 ms land flash |
| G3 | **Optimistic feedback on save** | none anywhere on the surface | MOTION-SPEC §7.1 |
| G4 | **Tab switching** — indicator `.mt__b.on::after` | `animation none`, `transition none` → **snaps** | fades/grows on `--dur-base` |
| G5 | **Tab switching** — panel | no entrance at all | directional slide, `--dur-base` `--ease-emph` |
| G6 | **Failed fetch renders as an empty state** | every list tab: `catch { pushToast }`, state stays `[]`, empty state paints | `ErrorState` + retry |
| G7 | Loading state | `<p>Loading…</p>` centred text (13 graha/ganit tabs) | skeleton matching the real geometry |
| G8 | `ix-*` motion classes used on the surface | **0 occurrences** across 5 568 lines | applied where they earn it |

Measured detail for G4/G5:

| Element | `animation-name` | `animation-duration` | `transition-property` | `transition-duration` |
|---|---|---|---|---|
| `.mt__b` | `none` | `0s` | `color` | `0.14 s` |
| `.mt__b.on::after` | **`none`** | **`0s`** | **`all` (i.e. none)** | **`0s`** |
| tab panel wrapper | `none` | `0s` | `all` | `0s` |

---

## 3 · After — measured

Same probe, same method, same two media states. `—` still means "resolves to
`none` / `0s`".

### 3.1 · Tab switching

| Element | Before | After (measured) | Under `reduce` |
|---|---|---|---|
| `.mt__b.on::after` — indicator | `animation none`, `transition 0s` — **teleports** | `ixTabInd` **220 ms** `cubic-bezier(.16,1,.3,1)` `backwards` | `0.22 ms`, one-shot |
| tab panel | no entrance at all | `ixPanelIn` **220 ms** `cubic-bezier(.16,1,.3,1)` `backwards` | `0.22 ms`, travel `0px` |
| `.mt__b` label colour | `color 140 ms` `cubic-bezier(.2,0,0,1)` | unchanged | `0.14 ms` |

The panel is directional: `--ix-dx` is `1` moving to a later tab and `-1` moving
to an earlier one, and travel is `8px * var(--motion-scale)`, so Animations =
None leaves a pure cross-fade. Six tests lock the direction and the remount.

**The ordering fact, verified rather than assumed.** `.mt__b.on::after` is
declared in `module.css:141`; my rule is in `animations.css`. `index.css`
imports `module.css` at line 10 and `animations.css` at line 12, specificity is
equal, so source order decides and `animations.css` wins. Measured both ways:
`animation-name` resolves to `ixTabInd` with the rule present and to `none`
without it. If those two imports are ever reordered this rule goes silent — it
will not throw, the underline will just snap again.

### 3.2 · Drag and drop — the CRM deal board

There was no drag before. Nothing in this table has a "before" column because
none of it existed; the before is the row of five stage buttons printed on every
card.

| State | Measured at `--ix: 1` | Under `reduce` |
|---|---|---|
| `.ix-drag-card` idle | `box-shadow, border-color, opacity 140 ms`; `transform 90 ms`; all `cubic-bezier(.2,0,0,1)`; `cursor: grab` | durations `0.14 ms` / `0.09 ms` |
| `:hover` | border → `--primary` 46 % | same, instant |
| `:active` press | `scale(.985)` + `opacity .92`, 90 ms | **no scale** (`--motion-scale: 0`), opacity step retained |
| `.is-dragging` | `matrix(1.01994, .0106812, −.0106812, 1.01994, 0, 0)` = `scale(1.02) rotate(.6deg)`, `--shadow-2`, `cursor: grabbing` | **`matrix(1,0,0,1,0,0)`** — no transform; shadow and cursor retained |
| `.ix-pending` | `opacity 0.6`, `cursor: progress` | `opacity 0.6` retained |
| `.ix-landed` | `ixLanded` **540 ms** `cubic-bezier(.4,0,1,1)` | `0.54 ms` |
| `.ix-drop-target` | `background-color, box-shadow 140 ms` `cubic-bezier(.2,0,0,1)` | `0.14 ms` |
| `.ix-drop-target.is-over` | `--primary` 9 % tint + `inset 0 0 0 1px --primary/.48` | tint and keyline retained |

Every one of the four moving states degrades to a *static difference* rather
than to nothing: the lift keeps its shadow and its `grabbing` cursor, the press
keeps its opacity step, the drop target keeps its tint. That is the test I
applied to each — if `--motion-scale: 0` removes the only signal, the signal was
wrong.

The values are boards.css's, which are reference `motion.css` `.kb__card` /
`.kb__col`'s. The two boards in this product now confirm a drop identically.

### 3.3 · Optimistic feedback on save

| Interaction | Before | After |
|---|---|---|
| Kanban stage move | `await PATCH` → `load()` refetches the whole board | moves on release, `opacity .6` in flight, 540 ms flash on ack, whole-snapshot rollback, **no refetch** |
| Deals list stage select | `await PATCH` → `load()` | row optimistic at `opacity .6`, rollback restores the whole previous deal |

"Whole snapshot" and "whole previous deal" are not belt-and-braces. Restoring
`stage` alone leaves the card in the right column at the position it was dragged
to, and leaves the row half-committed and looking fine — `KanbanView.jsx` calls
out the same failure by name.

Not refetching on success is what makes a second move survive: the response
replaces the one card it is about, so a card moved while another write was in
flight is not thrown away. That is the common case on a board being tidied.

### 3.4 · Loading

| Surface | Before | After |
|---|---|---|
| graha Kanban | `<p>Loading…</p>` | `SkeletonBoard` inside `SkeletonRegion` (`role=status`, `aria-busy`) |
| graha Deals / Clients / Contacts | `<p>Loading…</p>` | `SkeletonList` |
| ganit Invoices | `<p>Loading…</p>` | `SkeletonTable rows=8 columns=5` |

MOTION-SPEC §7.4 and 26 §9: a skeleton beats a spinner when the shape is known,
and it must match the real geometry so nothing shifts on arrival.

---

## 4 · A failed fetch rendering as an empty state — verified, and it was everywhere

The brief says this has shipped here more than once. It had shipped
**twenty-three times** on this surface. Every list tab caught its load
rejection, fired a toast, and left the collection at `[]` — so the empty state
painted, and the sentence on screen was a confident wrong answer:

> "No deals yet — track your sales pipeline here."
> "No invoices yet — create your first invoice."
> "No orders yet — create your first sales order."
> "No stock records."

A user cannot tell any of those from the real thing, and the toast that says
otherwise is gone in four seconds. Two were worse than the pattern:

| Site | What it actually did |
|---|---|
| `VikrayPage` `DashboardTab:56` | `.catch(() => {})` with `if (!data) return <Shimmer count={8}/>` — on failure `data` stays `null` **forever** and the tab shows a loading shimmer that never resolves, with no toast at all. A skeleton that never finishes is a lie that never stops telling itself. |
| `VikrayPage` `TargetsTab:554` | `catch {}` — swallowed whole. A 500 rendered "No targets set. Set sales targets for your team" with **nothing anywhere on the page** saying the request had failed. |

### Fixed (9)

`graha/KanbanTab` · `graha/DealsTab` · `graha/ClientsTab` · `graha/ContactsTab` ·
`ganit/InvoicesTab` · `VikrayPage` DashboardTab · OrdersTab · StockTab ·
TargetsTab.

Each keeps its toast and adds `ErrorState` with `errorKind(err)`, so a train
tunnel is not reported as a server fault, plus a retry that re-issues the request
that failed. Eight tests cover the kanban case, including that the word
"No deals" never appears on a failed load and that an offline rejection
classifies as `offline` rather than `server`.

### Still carrying it (14) — the pattern is three lines each

`graha/`: `ApprovalsTab:32`, `AutomationsTab:21`, `CustomFieldsTab:16`,
`DedupeTab:25` and `:34`, `DocumentsTab:32`, `FollowUpsTab:26`, `LabelsTab:29`,
`PipelineTab:19`, `TerritoriesTab:17`, `WebFormsTab:18`, `ReportsTab:30`,
`TodayTab:13`, `ActivitiesTab:21`.

`ganit/` follows the same shape on `ExpensesTab`, `PayablesTab`, `BankTab`,
`ProductsTab`, `RecurringTab`, `ContractsTab`, `ESignTab` and `StatsTab`.

The three lines:

```jsx
const [err, setErr] = useState(null);
// in load(): setErr(null) first, `catch (e) { setErr(e); …existing toast… }`
if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;
```

`ReportsTab:30`, `TerritoriesTab:17`, `CustomFieldsTab:16`, `ActivitiesTab:21`,
`WebFormsTab:18` and `TodayTab:13` are `catch(() => {})` — the silent variety,
like the two Vikray tabs above: no toast, no state, no trace on screen that
anything failed. Confirmed by reading the catch, not inferred from the render.

---

## 5 · Left deliberately alone, with reasons

**Sorting must NOT animate.** IxViews 10.1: *"Rows reorder with no animation:
animating a 40-row reorder is nausea, not polish."* So `.ix-stagger` is not on
any table row on this surface, and that is a decision, not an omission. There is
a second reason to keep it off a sortable list: `.ix-stagger`'s per-item
`animation-delay` comes from `:nth-child`, so re-sorting changes the delay on
every row, and changing the delay of a finished animation can replay it. A
stagger on a sortable table is a re-animation on every sort.

**The one sliding indicator.** The reference moves a single `.dm-tabs__ind`
between tabs (`transition: left …, width …`). That needs one shared element and
a ref per tab inside `ModuleTabs`, which four other module families share and a
sibling owns. What shipped is the CSS-reachable half — the underline grows in on
the newly-selected tab. The remaining half is a `ModuleTabs` change, noted for
whoever owns it.

**The drop target's dashed border.** Reference `.kb__col` and boards.css both
use `1px dashed transparent` → `--primary 48%`, and boards.css argues the case:
solid reads as a card edge, dashed reads as a slot. The CRM column carries a
solid `--rule-soft` border as an **inline style**, and an inline shorthand
outranks any class, so changing it is a pixel decision in someone else's lane. I
expressed the same signal — 9 % tint, 48 % keyline — as an inset shadow, which
composes with whatever border is there. One line for whoever owns that file.

**`--motion-scale` kept as it is.** It is a build invention absent from the
reference and better than it: `--ix` scales duration and bottoms at `.001` so
`animationend` still fires; `--motion-scale` scales distance and bottoms at `0`.
Nothing here touches the split.

**The reduced-motion strobe was not reintroduced.** `16-animations.md:44`
mandates `animation: dmSpin calc(.7s * var(--ix)) linear infinite`, which is a
0.7 ms spinner under reduce, and reference `motion.css:117` implements it. The
build does not, and I added no infinite animation of any kind. Measured after
every change: the only infinite animation surviving an emulated reduce on this
surface is `dmSpin` at a **fixed 640 ms**.

---

## 6 · Findings handed on, not fixed

1. **The landing flash disappears under reduced motion, on BOTH boards.**
   `.bc.just` (boards.css) and `.ix-landed` (mine) are both
   `calc(var(--dur-slow) * 1.5)`, i.e. 540 ms → 0.54 ms under reduce. The flash
   is a *locator* — "here is the card you just moved" — which is information
   rather than decoration, and WCAG 2.3.3 governs non-essential animation only.
   I kept mine identical to boards.css deliberately: two boards that confirm a
   drop differently is the bug, and the fix belongs on both at once. The shape
   of the fix, if it is wanted: hold the ring as a static state for 540 ms via
   the JS timer that already exists, and let only the fade ride `--ix`. Same
   pattern I used for `.ix-rollback`, which is in this file already.

2. **`.k-modtable tr` is off the named ladder.** Measured
   `transition: background calc(.1s * var(--ix)) ease` — 100 ms `ease` where the
   ladder says `--dur-fast` (140 ms) `--ease-standard`. It DOES honour reduce
   (measured `0.0001s`), so this is an unladdered literal, not an escape.
   `editorial.css`, not my file. Same for `.k-modcard`
   (`border-color, box-shadow calc(.15s * var(--ix)) ease` — and it transitions
   `box-shadow`, which `animations.css`'s own header argues against on a card
   grid) and `.k-btn` (`.12s` / `.08s`, `ease`).

3. **No row on this surface has a hover transition except `.k-modtable tr`.**
   `.tbl__row`, `.k-err`, `.mk__c`, `.k-statuschip`, `.k-stat` and `.k-empty` all
   measure `transition-duration: 0s`. Structure/pixels lane.

4. **`@testing-library/dom` is not installed**, so `@testing-library/react`
   throws on import — `pageHeader.test.jsx` records the same thing. Every test
   here uses `react-dom` + `act` directly. Worth installing, but that means a
   lockfile change, which this run forbids.

5. **The shared `preview_start` server on :5173 serves `D:/Projects/Kartavya`,
   not your worktree.** Anyone measuring an "after" on it is measuring staging
   plus whatever a sibling has in the main checkout. I ran my own Vite on
   **:5291** with `node_modules` junctioned from the main checkout. This is worth
   checking for every agent in this run who reported a measured "after".

6. **`ModuleTabs` has half a roving tabindex, which is worse than none.**
   `ModuleTabs.jsx:26` sets `tabIndex={on ? 0 : -1}` — the roving *half* — and
   the file contains no `onKeyDown` at all (grepped: `tabIndex` is the only
   keyboard-related line). So every non-selected tab is `-1` and nothing moves
   focus between them: Tab enters the strip, Tab leaves it, and a keyboard user
   cannot reach sixteen of Graha's seventeen tabs. Without the `-1` they would at
   least all be tabbable. Shared component, not my lane, but the fix is the
   standard `ArrowLeft`/`ArrowRight`/`Home`/`End` handler and it unblocks four
   module families at once.

---

## 7 · What shipped

| Commit | |
|---|---|
| `docs(motion)` | the measured baseline above |
| `feat(motion)` | tab indicator + directional panel entrance on all three pages; `.ix-pending` and `.ix-rollback` primitives; `lib/tabPanelMotion.js` + 6 tests |
| `feat(crm)` | the deal board drags, optimistically, with a landing flash and an error state; 8 tests |
| `fix(biz)` | failed fetch ≠ empty state on the main list of each module |

Gates, from `frontend/`, unpiped: `check-tokens` 0 missing · `check-classes`
0 missing · `vite build` clean · `vitest` **23 files, 441 tests, all passing**
(was 22 files / 433 before my 14).

---

## 8 · Addendum — `--ease-emph` was retuned under me, mid-run

Between my "after" measurement and the merge, a sibling changed
`--ease-emph` from `cubic-bezier(.16, 1, .3, 1)` to `cubic-bezier(.2, 0, 0, 1)`,
making it identical to `--ease-standard`. **They are right and I have left it
alone.** `design-reference/Kartavaya Redesign/tokens.css:47-48` declares both as
`cubic-bezier(.2, 0, 0, 1)`, and MOTION-SPEC.md §2 gives the same pair — the two
names encode a ROLE, not two curves.

Every `--ease-emph` figure in §3 above was measured before that landed and is
now stale. Re-measured on the merged tree, this is the truth:

| | Measured now |
|---|---|
| `--ease-emph` | `cubic-bezier(.2, 0, 0, 1)` — identical to `--ease-standard` |
| `.mt__b.on::after` | `ixTabInd` 220 ms `cubic-bezier(.2,0,0,1)` |
| `.ix-panel` | `ixPanelIn` 220 ms `cubic-bezier(.2,0,0,1)` |
| `.ix-landed` | `ixLanded` 540 ms `cubic-bezier(.4,0,1,1)` — unchanged, it uses `--ease-exit` |
| toast `tstIn` | 220 ms `cubic-bezier(.2,0,0,1)` |
| `modalPanelIn` | 220 ms `cubic-bezier(.2,0,0,1)` |
| `dmDrawerIn` | 360 ms `cubic-bezier(.2,0,0,1)` |
| `dmSheetIn` | 302.4 ms `cubic-bezier(.05,.7,.1,1)` — `--ease-emph-in`, untouched |
| `dmPop` | 140 ms `cubic-bezier(.34,1.36,.64,1)` — `--ease-spring`, untouched |
| `dmTip` | 140 ms `cubic-bezier(0,0,.2,1)` — `--ease-enter`, untouched |

Durations are unaffected. Anything else in this run that quoted a
`--ease-emph` value before that commit is stale in exactly the same way, which
is the coordination file's point about half of all claims going stale within the
hour — including, now, half of mine.

Also landed immediately after my merge: a sibling's module-tab overflow menu,
which adds the `onKeyDown` roving-tabindex handler that §6 finding 6 asked for.
Re-measured after their change: `.mt__b.on::after` still resolves to `ixTabInd`,
so the indicator rule survived their `module.css` additions — verified, because
that rule depends on import order and would have gone silent without a sound.

---

One thing found on the way: `origin/staging` had moved past my worktree's base
and had already fixed a **build-breaking** JSX comment in `DristiPage.jsx:581` —
a `{/* … */}` in the consequent position of a ternary, which parses as an object
literal. My base could not build at all. Rebased onto `origin/staging`, then ran
the gates, then pushed — three separate commands, per the coordination file.

