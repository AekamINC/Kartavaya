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

*(Continued below as the work lands.)*
