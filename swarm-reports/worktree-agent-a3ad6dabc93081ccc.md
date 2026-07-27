# Dashboard and Tasks — motion and interaction

Branch: `worktree-agent-a3ad6dabc93081ccc`, cut from `origin/staging` @ `e9134b2`.
Surface: `frontend/src/pages/DashboardPage.jsx` (TodayPage), `frontend/src/pages/TasksListPage.jsx`,
`frontend/src/styles/animations.css`. Lens: **behaviour and time only** — two siblings own
structure and pixels.

Written incrementally.

---

## 0 · The worktree was cut from `main`, not `staging`

`_COORDINATION.md` §1 warned about this and it applied here: `git merge-base --is-ancestor
origin/main HEAD` was true, HEAD was `1aa4985` (main's tip), **507 commits behind staging**, and none
of `design-reference/`, `swarm-reports/`, `frontend/scripts/check-*.mjs`, `pages/today/`,
`hooks/useDismiss.js` or the current `animations.css` existed in it. Reset to `staging`; all 13
commits it carried are reachable from `main`, so nothing was lost.

**Everything below was measured against staging's tree.** Had I not checked, every "this is missing"
in this report would have been a 507-commit-stale reading of code that had already been fixed.

---

## 1 · How this was measured

Two harnesses, because the two halves of the brief need different things.

**A · CSS probe** — `frontend/public/__ref/probe.html` (gitignored, not committed), served by a
static server from `frontend/`, loading the app's real cascade in `App.jsx:18-26` order
(`App.css → styles/index.css` + its 13 `@import`s `→ kartavaya-design.css → editorial.css →
settings.css`, plus `a11y.css` and `today.css`) with the real class names from both pages. Read with
`document.getAnimations()` (which reports live `Animation` objects including pseudo-elements) and
`getComputedStyle`, under `page.emulateMedia({ reducedMotion })`.

**B · The real app** — the whole build running from THIS worktree on its own vite server
(port 5301, its own `cacheDir`; the shared 5173 server serves the main checkout, which siblings are
editing live and which is not my tree), with `/api/**` intercepted by Playwright and the session
faked in `localStorage`. That is what makes claims about failure states, optimistic writes and
skeleton timing measurements rather than readings.

Reading the CSS was wrong twice, exactly as the brief predicted:

- `.k-trow` has **no** `transition` in `editorial.css`, where its layout and every one of its states
  live. It has one in `kartavaya-design.css:867`, a second declaration of the same selector in a
  different file. Grepping `editorial.css` says "no transition"; the computed style says `0.1s`.
- `.k-col-resize` computed to no transition at all — because the transition is on its `::after`,
  which `getComputedStyle(el)` does not report. The grip hover is fine; my first note said it was
  missing.

---

## 2 · Measured before/after — Dashboard and Tasks

Every row read from `getComputedStyle` on the live element in the running app, `--ix: 1`.
`--dur-instant` 90ms · `--dur-fast` 140ms · `--dur-base` 220ms · `--dur-slow` 360ms.
`--ease-standard` = `cubic-bezier(.2, 0, 0, 1)`.

| Element | Property | BEFORE | AFTER |
|---|---|---|---|
| `.k-trow` (Tasks row hover) | `background` | `0.1s` `ease` | `0.14s` `cubic-bezier(.2,0,0,1)` |
| `.k-row-action` (archive reveal) | `opacity` | `0.15s` `ease` | `0.14s` `cubic-bezier(.2,0,0,1)` |
| `.k-col-resize::after` (grip) | `background` | `0.15s` `ease` | `0.14s` `cubic-bezier(.2,0,0,1)` |
| `.k-segctrl__btn` (filter tabs) | — | **none — `0s`** | `background-color, color` `0.09s` `cubic-bezier(.2,0,0,1)` |
| `.k-taskrow` (Today, main col) | `background` | `0.14s` `ease` | `0.14s` `cubic-bezier(.2,0,0,1)` |
| `.k-upcoming__row` (Today, side col) | — | **none — `0s`** | `background` `0.14s` `cubic-bezier(.2,0,0,1)` |
| `.k-trow__tick` (quick-complete) | 4 props | **did not exist** | `0.14s` `cubic-bezier(.2,0,0,1)` ×4 |
| `.k-trow.is-pending` | `opacity` | **did not exist** | `.6` + `cursor: progress` |
| `.k-trow.is-just` | `kTrowJust` | **did not exist** | `540ms` `cubic-bezier(.4,0,1,1)`, 1 iteration |
| Tasks empty state | entrance | **none** (`.pb__loading`, a text line) | `ixFadeUp` `0.22s` `cubic-bezier(0,0,.2,1)` |

`540ms` = `calc(var(--dur-slow) * 1.5)`, and `cubic-bezier(.4,0,1,1)` is `--ease-exit` — the same
pair as reference `motion.css` `@keyframes kbJust` and the board's `bcJust`, so the settle flash is
one animation across list and board rather than two that nearly match.

Two easings were the browser default `ease` rather than one of the six tokens. That is not cosmetic
pedantry on a hover: `ease` is `cubic-bezier(.25,.1,.25,1)`, which starts slowly, and
`--ease-standard` starts immediately — on a 140ms row hover the difference is the whole feel of the
gesture, and the Today row and the Tasks row were using different ones.

---

## 3 · What was actually broken, and what it cost

### 3.1 A failed fetch rendered as an empty board — **the defect named in the brief, still live on Tasks**

The dashboard had been fixed. Tasks had not, and it is the page the fix was written for.

`TasksListPage.load()` caught every rejection into a single `pushToast({ title: 'Could not load
tasks' })` and left `tasks` at `[]`. The table then drew its own zero state — **"No tasks match this
filter"** — under four filter tabs all reading `0`. The toast is gone in four seconds; the sentence
stays. A user whose request 500'd is told, in the product's own voice, that they have no work.

Measured against a mocked `500`:

| | before | after |
|---|---|---|
| `.k-err` panel | absent | present |
| panel text | — | "Something broke on our side, not yours" |
| "No tasks match this filter" in the body | **present** | absent |
| rows | 0 | 0 |

`errorKind` separates offline / 403 / 404 / 5xx, so the panel says which failure it was — the toast
said the same eleven words to a user in a train tunnel and a user without a grant. The toast is now
gone: one failure gets one report, and the panel is the one that can name it and offer a retry.

**Also fixed, same function:** `/tasks`, `/teams` and `/categories` were one `Promise.all`, so all
three were fatal together. `/teams` and `/categories` decorate a row with a project chip and a
category chip. A `/categories` 500 blanked a list of tasks that had arrived intact. They are now
fired together and awaited apart; only `/tasks` is fatal.

**Verified unchanged and still holding on Today:** a 500 renders `ErrorState`, prints neither "The
board is clear" nor "Nothing is assigned to you", and renders **zero** stat tiles rather than four
reading 0.

### 3.2 Every quick action on Tasks was silent for its whole round trip

Archive and restore `await`ed the PATCH, then removed the row. For the entire request the row was
unchanged — no dim, no spinner, nothing. A slow archive looks like a dead button, and the response
to a dead button is to press it again.

Now: the row stays put and dims to `opacity .6` with `cursor: progress` (MOTION-SPEC §7.1), and only
leaves once the server has agreed. Deliberately **not** the other optimistic shape — removing the row
first and re-inserting it on a 4xx means the failure toast points at something no longer on screen,
and the row reappears from nowhere.

### 3.3 Quick-complete did not exist — IxViews 9.4

The catalogue's "today" note: *"marking something done takes three clicks through the drawer"*. True
of the list as well as the board. The board grew a tick (`KanbanView.toggleComplete`); the list had
none, so the same task took one click on one screen and three on the other.

Added with the board's exact contract — same tokens, same `@media (hover: none)` rule that keeps it
permanently visible on touch (MOTION-SPEC §7.7), same `--on-ok` rather than `#fff` (`--ok` inverts to
a light mint in dark, where white measures 1.79:1).

Measured end to end with a 700ms mocked PATCH:

```
during write   class "k-trow k-trow--resizable is-pending"   opacity 0.6   cursor progress
on ack         class "k-trow k-trow--resizable is-just"      opacity 1
flash          kTrowJust  540ms  cubic-bezier(0.4, 0, 1, 1)  1 iteration
after flash    row leaves the list
on a 500       row count unchanged, first row unchanged, toast "Could not update that task"
```

**The subtlety that made all of it invisible, found only by running it.** The first attempt measured
`is-pending` as absent and the flash as never firing. The default filter is "All open" — `status !==
'done'` — so the optimistic write flipped the row out of the predicate and React unmounted it *in the
same commit*. None of the feedback above could ever be seen, and on failure the row reappeared with
no explanation. A row that is pending or just-flashed is now **held** in the filtered list; it leaves
after the flash, which is what IxViews 9.4 describes ("ticking runs the checkbox animation, THEN the
card moves").

### 3.4 The skeleton flashed on every re-fetch — MOTION-SPEC §7.4

*"Hold the previous page if the fetch resolves under 120ms — a flashed skeleton is worse than none."*
Neither page did. Both re-fetch on a control, not only on mount: Tasks reloads the whole list on the
Archived toggle, Today reloads on Retry. Against a warm request that is a full table replaced by a
skeleton and restored inside one frame, on a control the user pressed expecting a small change.

`hooks/useSkeletonGate.js` — 120ms before a skeleton mounts, and a 220ms (`--dur-base`) minimum once
it has. The second half is not optional: without it a fetch landing at 125ms shows a 5ms skeleton,
which is the flash the first half exists to prevent, moved five milliseconds later.

Per-frame trace (`requestAnimationFrame` sampler, Tasks):

```
first load,   900ms response   -@183ms   SKEL@6130ms   ROWS@6917ms
refetch,       25ms response   ROWS only — no skeleton frame at all
refetch,      900ms response   ROWS   SKEL@+120ms   ROWS@+1101ms
```

(The 6s to first paint is vite's cold dev server fetching modules, not the app.)

`canHold` is the guard that stops this inventing a second empty-state lie. On a first load there is
nothing to hold — `tasks` is `[]` — so holding would print the zero state for 120ms before the
skeleton arrived. On Today it would print **"The board is clear"**, the exact sentence §3.1 exists to
prevent. So the flag is "has a load ever SUCCEEDED", not "is there no error": a retry after a failure
also has nothing to hold, and correctly shows its skeleton immediately (measured).

### 3.5 The empty state was styled as a loading state

`groups.length === 0` rendered a bare line of text in `.pb__loading` — the **project board's loading
class**, borrowed onto a different page. The one moment the table has nothing to say was dressed as
"still fetching", and it replaced eight rows in a single frame with no entrance.

Now `EmptyState`, entering on `ixFadeUp` `--dur-base` `--ease-enter` (measured: `0.22s`,
`cubic-bezier(0, 0, .2, 1)`), with three different sentences because they have three different exits:
narrowed by filter or search (recoverable — offers "Clear filter and search"), archived view (nothing
filed away), and genuinely empty (offers "New task").

### 3.6 The row was a `<button>` full of `<button>`s

React logged **"In HTML, `<button>` cannot be a descendant of `<button>`"** for every row on every
render — `k-row-action` was already nested, and the tick made two. Not a style complaint: nested
button activation is undefined, and the inner controls were unreachable in keyboard order.

The row is now `role="button" tabIndex={0}` with Enter/Space, guarded on `e.target ===
e.currentTarget` so Space on the tick does not also open the drawer behind it. The reference row is a
plain element with real buttons inside it (`.tv__acts`, IxViews §10) for the same reason. Measured: 0
such errors after the change. `.k-trow:focus-visible` takes `outline-offset: -2px` so the app-wide
ring does not paint over the neighbouring rows' borders.

---

## 4 · Reduced motion — the strobe rule, verified on my surface

Measured under `page.emulateMedia({ reducedMotion: 'reduce' })`, reading live `Animation` objects
rather than CSS.

Resolved: `--ix: .001`, `--motion-scale: 0`.

| | live animations |
|---|---|
| no preference | `k-shimmer` ×2 @ 1700ms · `ixShimmer` ×2 @ 1700ms · `ixPulse` ×2 @ 2000ms · `tstIn` @ 220ms |
| **reduce** | **`tstIn` only (finished). Every infinite decorative animation STOPPED — no `Animation` object at all.** |

**Nothing on Dashboard or Tasks runs under reduce, and nothing is accelerated into a strobe.** The
earlier fix holds and I have not regressed it.

The one animation I added, `kTrowJust`, is **finite** (1 iteration), so collapsing to 0.54ms under
`--ix: .001` is correct and is what the ladder is for — the rule the spec gets wrong applies to
`infinite` animations, which must be *stopped* rather than sped up. I added no infinite animation.

**Both confirmed spec defects left alone, as instructed:**

- `16-animations.md:44` / reference `motion.css:117` mandate `animation: dmSpin calc(.7s * var(--ix))
  linear infinite` — a 0.7ms spinner under reduce. Not followed. Nothing I wrote multiplies an
  infinite duration by `--ix`.
- `--motion-scale` is kept as the build has it: `--ix` scales duration and bottoms at `.001` so
  `animationend` still fires; `--motion-scale` scales distance and bottoms at `0`. The split is not
  corrected toward the reference, which does not have it.

### Final sweep — both pages, both states, loading and loaded

`document.getAnimations()` filtered to `playState === 'running'`, on the real pages:

| State | no preference | reduce |
|---|---|---|
| Tasks, **loading** | 48 × `k-shimmer` @ 1700ms + `k-onboard-slide-up` @ 250ms ×1 | **`[]` — nothing running** |
| Tasks, loaded | `[]` | `[]` |
| Today, loaded | `[]` | `[]` |

`--ix` resolves `1 → .001` and `--motion-scale` `1 → 0`. **Lowest running duration anywhere on this
surface: 1700ms. Nothing under 640ms. Nothing accelerated.**

---

## 5 · The toast had an entrance and no exit

Not strictly a Dashboard/Tasks file, but it is the confirmation surface for every write on both of
them and "toast behaviour" is on this brief, so it is measured and fixed here.

`tstIn` slides a toast 16px in over `--dur-base`. `dismiss()` removed the node in the same frame.
Every other overlay in the reconciled table is a pair; this one shipped with half — so the one toast
a user actively reached for and clicked was the only one that vanished without warning, and a
four-second auto-dismiss ended as a disappearance rather than a departure.

| | BEFORE | AFTER |
|---|---|---|
| entrance | `tstIn` `0.22s` `--ease-emph` | unchanged |
| exit | **none — removed in one frame** | `tstOut` `0.14s` `cubic-bezier(.4,0,1,1)` (`--dur-fast` `--ease-exit`) |
| exit travel | — | `translateX(12px)` — less than the 16px entrance (§7.3) |
| pointer events during exit | — | `none` |
| unmount trigger | — | `animationend`, not a JS timer |

Measured 60ms after the click: class `tst tst--ok is-out`, one live `Animation` at 140ms, gone by
300ms. Four variants follow the corner the stack sits in and the mobile full-width case, exactly as
the entrance already does.

**Under reduced motion `animationend: tstOut` still fires and the node is gone inside 120ms.** That
is the first demonstration in this build that `--ix` bottoming at `.001` rather than `0` is
load-bearing rather than argued: at `0` the event never fires and every dismissed toast leaks its
node. `animations.css` §8 states the reason; this measures it.

Two traps, both found by measuring:

- The mobile `@media` block sets `animation-name` on `[data-toast-pos] .tst`. `@media` adds no
  specificity, so that beats `.tst.is-out` declared outside it purely on source order — a mobile
  toast in a left corner would have "exited" by replaying its **entrance** keyframe. The `.is-out`
  rules are restated inside the block. Identical to the trap `animations.css` §9/§10 documents.
- `pause()` on hover read the exit's safety-net timer entry as a dismiss timer and stored
  `remaining: NaN`, so the resume on mouse-out fired immediately — a hover that made the toast leave
  *faster*, which is the opposite of what hover-to-pause is for.

---

## 6 · Cover list, item by item

| Brief item | State |
|---|---|
| skeleton / loading treatment | **Fixed** — 120ms gate + 220ms floor, both pages, frame-traced |
| row hover | **Fixed** — Tasks, Today main and Today side column, all on `--dur-fast` `--ease-standard` |
| sort transitions | **Nothing to transition — the Tasks table has no sort at all.** See §7 |
| filter transitions | **Fixed** — segmented control on `--dur-instant`; compound filter chips do not exist, §7 |
| empty-state entrance | **Fixed** — `EmptyState` on `ixFadeUp` `--dur-base`, three distinct states |
| toast behaviour | **Fixed** — exit pair added, §5 |
| optimistic-update feedback | **Fixed** — `.6` pending + rollback on archive, restore and complete |
| quick-complete | **Added** — IxViews 9.4, board-identical contract |
| failed fetch ≠ empty state | **Fixed on Tasks, verified still holding on Today** |
| no regression under `reduce` | **Verified** — nothing running, nothing under 640ms |

---

## 7 · Not mine — for whoever owns structure and features

1. **`.k-trow` is declared in two stylesheets.** `kartavaya-design.css:865` and `editorial.css:1287`,
   both full rule blocks for the same class. It is the same class of defect as the duplicate
   `@keyframes k-shimmer` and `dmPop` already reported: the later file silently wins per-property,
   and reading either one alone gives the wrong answer. The transition lived in the file with none of
   the row's layout, which is why "`.k-trow` has no transition" was my first, wrong reading.

2. **The visible task id is fake AND duplicated.** `TasksListPage` renders
   `KAR-{String(idx + 100)}` where `idx` is the index **within its group**, so the first row of every
   group reads `KAR-100`. Two rows on one screen carrying the same identifier is worse than no
   identifier: it is the string a user reads out on a phone call. The dashboard's `#{task_id.slice(-6)}`
   is at least unique. Neither is a real key.

3. **IxViews §10 is three-quarters unbuilt on the Tasks table** — no sort (10.1, wants three-state
   plus `aria-sort`), no bulk selection (10.2), no inline cell edit (10.3), no compound filter chips
   (10.4). All feature work, not motion. **One motion constraint if anyone builds sort:** 10.1 is
   explicit that rows reorder with **no animation** — "animating a 40-row reorder is nausea, not
   polish."

4. **`--ease-emph` diverges from the spec.** Build: `cubic-bezier(.16, 1, .3, 1)`. `MOTION-SPEC.md`
   §2 and reference `motion.css:31`: `cubic-bezier(.2, 0, 0, 1)` — which the build declares as
   `--ease-standard`. So the build has the spec's `--ease-emph` under a different name and an
   expo-out curve under the real one. Everything is internally consistent, so this is a decision for
   the token owner, not a defect I should have silently "corrected".

5. **`.k-stackbar__seg` transitions `flex` over `--dur-slow`** (Today, Project status). `flex-grow`
   is a layout property: every frame re-runs layout for the whole bar. `animations.css`'s own
   performance note says nothing here animates width, height, top or left for exactly this reason.
   Same visual is reachable with `transform: scaleX` on a track, or by accepting an instant change.

6. **Undo-over-confirm is still unbuilt** (MOTION-SPEC §7.2). Archive is reversible and gets no undo;
   the toast has no action slot to put one in. Adding a slot is a `toast.jsx` API change with app-wide
   reach, so it wants one owner rather than the page that noticed.

---

## 8 · Claims from the brief, adjudicated

| Claim | Verdict | Evidence |
|---|---|---|
| "A failed fetch must not render as an empty state — that defect shipped repeatedly here" | **HELD, and still live on Tasks** | mocked 500 rendered "No tasks match this filter" under four tabs reading 0 |
| Same defect on the dashboard | **already fixed by a sibling, verified still holding** | 500 → ErrorState, no "board is clear", 0 stat tiles |
| "nothing under 640ms now — do not regress it" | **not regressed** | lowest running duration on this surface is 1700ms; under reduce, nothing runs |
| `16-animations.md:44` mandates the reduced-motion strobe | **HELD, not followed** | no infinite duration on this surface is multiplied by `--ix` |
| `--motion-scale` is a build invention and better than the reference | **HELD, kept** | the split is what lets amplitude collapse while `animationend` still fires — now demonstrated by the toast exit under reduce |
| Reading CSS gives the wrong answer here | **HELD, twice** | `.k-trow`'s transition is in a different file from its rules; `.k-col-resize`'s is on a pseudo-element |
| The reference HTML files are runnable harnesses | **HELD** | rendered; `IxViews.jsx` §9–10 is the source for the tick, the settle flash and the pending state |

---

## 9 · What I did not do

- **Did not add sort, bulk selection, inline cell edit or the filter builder.** All four are
  structure and feature work owned by a sibling; my lens is behaviour and time. Recorded in §7 with
  the one motion constraint that applies to them.
- **Did not touch `--ease-emph`.** It diverges from the spec but is internally consistent, and a
  token change reaches every surface in the product. §7.4.
- **Did not add an undo toast.** It needs an action slot in `toast.jsx`, which is an API change with
  app-wide reach. §7.6.
- **Did not renumber or fix the fake `KAR-` id.** Structure. §7.2.
- The probe (`frontend/public/__ref/probe.html`) and the isolated vite config are **not committed** —
  `frontend/public/__ref/` is gitignored, per the brief.
