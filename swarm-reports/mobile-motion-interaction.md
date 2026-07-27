# Mobile app — motion and interaction

Surface: `mobile/src/**`. Lens: behaviour and time. Two siblings own structure
and theming; nothing here changes a layout or a colour token except where a
colour *was* the missing state signal.

Reference read by **rendering** it, not by reading prose: `Mobile App.html` and
`Interaction Catalogue.html` served from `frontend/public/__ref/` and probed with
`getComputedStyle`. Every number below marked "measured" came out of the running
harness.

---

## The strobe, measured

`16-animations.md:44` mandates it and `motion.css:117` implements it. In the
rendered catalogue, with `--ix` set to `.001` — which is literally what
`motion.css:23` does under `prefers-reduced-motion` — `.dm-spin` computes to:

```
animationDuration        0.0007s
animationIterationCount  infinite
```

0.7ms per rotation. **≈1429 Hz**, for the user who just asked for less motion.
Not ported, as instructed.

The mobile stylesheet has the same defect in its milder form. `.mpulse` (2s) and
`.msk` (1.4s) are literals rather than `--ix` multiples, so they do **not**
strobe — measured at `--ix: .001` they are still `2s infinite` and `1.4s
infinite` — but they also do not stop, which contradicts MOTION-SPEC §4's own
"disabled under reduced motion".

`useLoop` in `mobile/src/theme/motion.ts` is the structural answer rather than a
conditional: the duration comes from a `LOOP` constant that never passes through
`duration()`, and when reduced motion is on the loop is never started. It is the
only caller of `Animated.loop` in the app.

## Verifying the sibling's split

`duration()` / `amplitude()` / `shouldLoop()` were already there and are
**faithful**. Computed against the rendered catalogue, the five durations and six
curves `motion.ts` declares are the same five and six the harness resolves:

| token | harness | motion.ts |
|---|---|---|
| `--dur-instant` | `calc(90ms * 1)` | `DUR.instant 90` |
| `--dur-fast` | `calc(140ms * 1)` | `DUR.fast 140` |
| `--dur-base` | `calc(220ms * 1)` | `DUR.base 220` |
| `--dur-slow` | `calc(360ms * 1)` | `DUR.slow 360` |
| `--dur-xslow` | `calc(520ms * 1)` | `DUR.xslow 520` |
| `--ease-emph` | `cubic-bezier(.2,0,0,1)` | `EASE.emph` |
| `--ease-enter` | `cubic-bezier(0,0,.2,1)` | `EASE.enter` |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | `EASE.exit` |
| `--ease-emph-in` | `cubic-bezier(.05,.7,.1,1)` | `EASE.emphIn` |
| `--ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | `EASE.spring` |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | `EASE.standard` |

Extended, not replaced: `DUR.sheet`, `LOOP`, `SHEET`, `TAB`, `PRESS`,
`scaleTo()`, `useLoop()`, `settle()`, `usePressScale()`.

---

## Measured before / after

Everything with a "before" of `—` had no animation at all.

### Sheets and dialogs — `components/Sheet.tsx`

| | before | after |
|---|---|---|
| scrim in | 0ms, no curve | **220ms** `ease-enter` |
| scrim out | 0ms, no curve | **140ms** `ease-exit` |
| sheet in | ~300ms fixed platform slide | **300ms** `ease-emph-in`, `translateY(panel height)` |
| sheet out | the entrance reversed | **220ms** `ease-exit` |
| dialog in | ~300ms fixed platform fade | **220ms** `ease-emph`, `scale .96→1`, `translateY 8px`, **42ms** after the scrim |
| dialog out | the entrance reversed | **140ms** `ease-exit`, `scale .98` |

Under reduced motion every duration → **0ms** and every travel → **0px**.

Eleven call sites converted; zero `<Modal animationType>` left in `src/`.

### Gestures

| | before | after |
|---|---|---|
| `SwipeRow` settle | `Animated.spring(friction 9, tension 90)` | **220ms** `ease-spring` (`mobile.css:72`) |
| threshold crossed | — | `selectionAsync` / 8ms vibrate, once per drag |
| commit | `impactAsync(Light)` / 12ms | unchanged |
| ＋ press | — | **90ms** `ease-emph`, `scale .94` |
| shutter press | instant snap, no reduced path | **90ms** `ease-emph`, `scale .96` |

### Navigation

| | before | after |
|---|---|---|
| tab scene | hard cut | **220ms** `ease-emph`, opacity + `translateX ±10px` signed by travel |
| tab indicator | absent | **220ms** `ease-emph` slide, Android only |
| screen push/pop | platform default, no reduced path | **360ms**; `fade` when reduced |
| TaskDetail sheet | `slide_from_bottom`, no reduced path | **300ms**; `fade` when reduced |

### Feedback

| | before | after |
|---|---|---|
| offline banner in | 0ms | **220ms** `ease-enter`, `translateY -16px` |
| offline banner out | 0ms | **180ms** `ease-exit` |
| notification toast in | spring from **-120px**, tension 80 / friction 12 | **220ms** `ease-emph`, `translateY -12px` (§3 says 12) |
| punch confirmation | — | **360ms** `ease-spring` to `scale 1.14`, **220ms** `ease-emph` back, held **900ms** |
| timer dot | absent | **2000ms** `ease-standard` infinite; **stopped**, not shortened, when reduced |

---

## Findings that were not motion

Things the interaction audit turned up that were bugs in their own right.

1. **`enqueueMutation` discarded `entity_type` and `entity_id`.** Both accepted
   since it was written, neither stored. So `TaskCard`'s `syncing` prop — the
   amber clock the reference draws at `Mobile.jsx:45` — had no way to know which
   task it applied to and was passed by nothing, anywhere. A swipe-completed row
   on a train rendered identically to one the server had accepted. §7.1's "never
   lie about state", in the most literal form available.

2. **`tintColor` is iOS-only.** All fourteen `RefreshControl` call sites set it
   and nothing else, so every pull-to-refresh spinner on Android has been
   Material's stock blue on a teal product. Five of them passed
   `onRefresh`/`refreshing` straight to the FlatList, which exposes no colour
   props at all. One `components/Refresher.tsx` now, setting `tintColor` **and**
   `colors` **and** `progressBackgroundColor`.

3. **A successful flush was silent.** `setBanner(null)` and nothing else, so a
   sync that worked and a sync that was cancelled looked the same.

4. **The 72-hour promise only existed in the past tense.** `PUNCH_RETENTION_MS`
   was enforced silently by `pruneExpired` and surfaced once, as an Alert *after*
   a punch had already aged out. `hoursLeft` is now shown while the window is
   still open, measured from `captured_at` against the same constant
   `pruneExpired` uses so display and enforcement cannot drift.

5. **`done` was terminal on ClockScreen.** The shutter is disabled for every
   phase but `idle`, so once a punch landed the screen could not take another
   until it was unmounted.

6. **Five different scrim opacities** for the same overlay — `.4`, `.4`, `.45`,
   `.45`, `.55`, `.55` — so which grey the room went depended on which sheet you
   opened.

7. **Queue counts were sampled once.** The offline banner was written when
   connectivity dropped and never updated as edits piled up behind it;
   ClockScreen's pending count refreshed on a `[phase]` effect, so it only moved
   when the employee happened to take another photo. `useQueueStatus` subscribes
   to MMKV instead.

## Reference defects, for whoever reads it next

- **`16-animations.md:44` / `motion.css:117`** — mandates the reduced-motion
  strobe. Measured at 0.7ms, ~1429 Hz. Do not port.
- **`mobile.css:63` / `:446`** — `.mpulse` and `.msk` keep looping under reduced
  motion, contradicting MOTION-SPEC §4.
- **`mobile.css:431`** — a second `.msheet` block shadows `mobile.css:279` and
  swaps the spec's `--ease-emph-in` for `--ease-emph`, changing the mobile sheet
  from 302.4ms to 360ms on the wrong curve. MOTION-SPEC §3, `motion.css:97` and
  `mobile.css:279` all say ~300ms emph-in, and `--ease-emph-in`'s own token
  comment reads "bottom sheets rising". Taken as 300 / emph-in, three to one.
- **`mobile.css:297`** — `.mnav2__ind` has no transition, so the reference's own
  tab indicator jumps. Its shared tabs primitive (`motion.css:185`) does it
  properly at 220ms `ease-emph`; that is the version taken.
- **`mobile.css:196`** — `.mcam__ring.ok` has no transition on `box-shadow`, so
  the reference's confirmation ring appears rather than arriving.

## Deliberately NOT collapsed under reduced motion

Worth stating so the next audit does not read these as misses.

- **`SwipeRow`'s `MAX_TRAVEL`.** Reduced motion suppresses motion the *system*
  starts, not the pixels under a finger. Collapsing it welds the row in place and
  makes the gesture undiscoverable. The *release* collapses.
- **`RefreshControl`'s spinner.** `UIRefreshControl` and `SwipeRefreshLayout`
  keep spinning under Reduce Motion because the OS classes them as progress
  indicators. A progress indicator that stops is a hang. This is the one
  indefinite animation in the app genuinely out of reach.
- **Scrim opacity, and the banner's fade.** No translation, no scale, no
  repetition — and it is the half carrying the information.

## Verification

`cd mobile && npm install && npx tsc --noEmit` — clean at every commit.
