# App shell & navigation — MOTION AND INTERACTION

Surface: `frontend/src/components/layout/**`, `frontend/src/styles/animations.css`,
`frontend/src/styles/editorial.css`.
Lens: behaviour and time. What moves, how far, how long, on what curve, and what
happens under `prefers-reduced-motion`.

Two siblings own structure and pixels; nothing below changes either.

---

## How these numbers were obtained

Not by reading CSS. A sibling already proved reading gives the wrong answer here —
`@media` blocks add no specificity, so a later declaration of the same selector wins
on source order and the reduce block silently loses.

Everything below is **measured in a browser**:

- Own headless Chrome driven by `playwright-core` — the shared MCP browser was being
  navigated out from under this agent by sibling agents mid-measurement, so tab-based
  probing was abandoned after it returned another agent's page twice.
- `browser.newContext({ reducedMotion })`, which is `emulateMedia` — both states
  measured on every surface.
- `getComputedStyle` for the resolved cascade, `element.getAnimations()` and
  `document.getAnimations()` sampled **mid-interaction** for what actually runs.
- The reference is the RENDERED harness — `Kartavaya Redesign.html` served through
  Vite and driven: rail toggled, nav hovered and clicked, Appearance popover opened
  and closed, viewport dropped to 390px.
- The build is measured through a temporary harness that mounts the real
  `Sidebar` / `Topbar` / `MobileDrawer` / `MobileNav` with the real stylesheets and no
  backend. It is not committed.

No DB writes. The probe's backend URL points at a dead local port so an accidental
request fails locally rather than reaching anything real.

---

## 1 · Token layer — measured, both media states

| Token | Reference (rendered) | Build (rendered) | Verdict |
|---|---|---|---|
| `--ix` normal | `1` | `1` | match |
| `--ix` reduce | `.001` | `.001` | match |
| `--motion-scale` normal | *absent* | `1` | build-only, keep |
| `--motion-scale` reduce | *absent* | `0` | build-only, keep |
| `--ix-user` | *absent* | `1` (unchanged by OS reduce) | build-only, correct |
| `--dur-instant` | 90ms | 90ms | match |
| `--dur-fast` | 140ms | 140ms | match |
| `--dur-base` | 220ms | 220ms | match |
| `--dur-slow` | 360ms | 360ms | match |
| `--dur-xslow` | 520ms | 520ms | match |
| `--ease-emph` | `cubic-bezier(.2,0,0,1)` | `cubic-bezier(.16,1,.3,1)` | **deliberate divergence — left alone** |
| `--ease-enter` | `cubic-bezier(0,0,.2,1)` | same | match |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | same | match |
| `--ease-emph-in` | `cubic-bezier(.05,.7,.1,1)` | same | match |
| `--ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | same | match |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | same | match |

**`--ease-emph` is NOT a defect and was not "fixed".** In the reference,
`--ease-emph` and `--ease-standard` are the same curve — two names for one value.
`00-tokens.md:133` states the divergence and its reason: M3's emphasised easing has
no single-cubic form, so the build makes `--ease-emph` an expo-out that is genuinely
distinct from standard. That is the same class of decision as `--motion-scale`:
absent from the reference and better than it. Changing it would collapse two tokens
back into one and remove the distinction the build deliberately bought.

**`--motion-scale` confirmed absent from the reference.** Measured, not assumed:
`getPropertyValue('--motion-scale')` returns empty string on the rendered reference
in both media states. The split the build invented is real — `--ix` scales duration
and bottoms at `.001` so `animationend` still fires; `--motion-scale` scales distance
and bottoms at `0` so amplitude can actually collapse. Kept.

---

## 2 · The reference's reduced-motion mechanism is the defect, restated with numbers

Measured on the rendered reference under `reducedMotion: 'reduce'`:

| Reference surface | Normal | Under reduce |
|---|---|---|
| `.side` width | 220ms | **0.22ms** |
| `.side__item` background/color | 140ms | **0.14ms** |
| `.pop` `pop-in` | 220ms | **0.22ms** |
| `.side__toggle` | 140ms | **0.14ms** |

For these one-shot transitions a sub-millisecond duration is harmless — it reads as
"no animation". The mechanism only becomes a strobe on an **infinite** animation, and
**the reference chrome has none**: `document.getAnimations()` and a full sweep of
every element plus `::before`/`::after` for `animation-iteration-count: infinite`
returned **zero** in both media states. The strobe defect named in the brief lives in
`motion.css` on decorative loops elsewhere, not in the chrome.

The build's chrome was swept the same way: **zero infinite animations**, both media
states, desktop and mobile. Nothing in the shell strobes, and nothing here regresses
the earlier fix.

---

## 3 · Sidebar rail collapse / expand

Driven: clicked `.side__toggle`, sampled `document.getAnimations()` on the next tick.

| | Reference (measured) | Build BEFORE (measured) |
|---|---|---|
| Property animated | `width` | `width` |
| Wide → rail | 252px → 72px | 252px → 72px |
| Duration | **220ms** (`--dur-base`) | **220ms** (`--dur-base`) |
| Curve | `cubic-bezier(0.2, 0, 0, 1)` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Returns to | 252px | 252px |
| Chevron rotation | none — glyph swaps (`I.chevR`/`I.chevL`) | `transform` **140ms** `cubic-bezier(0.2,0,0,1)`, 180° |
| Under reduce | 0.22ms | 0.22ms |

Duration and travel match exactly. The curve differs only because of the deliberate
`--ease-emph` divergence in §1.

The build's rotating chevron is an improvement over the reference's glyph swap — the
same 180° rotation `editorial.css` was already written for, on `--dur-fast`, and it
collapses correctly under reduce. Kept.

**Side effect worth naming (not a defect):** collapsing to rail retriggers
`grid-template-rows` on **all seven** `.side__sec-items` simultaneously, measured at
220ms each, because `Sidebar.jsx:146` forces `expanded = true` in rail mode. Seven
concurrent grid transitions land on the same frame as the width transition. It is
visually consistent — rail shows every icon — and it is on the token ladder, so it
collapses under reduce with everything else. Noted for the structure sibling rather
than changed here.

---

## 4 · Nav item hover and active

| | Reference (measured) | Build BEFORE (measured) |
|---|---|---|
| Properties | `background`, `color` | `background`, `color` |
| Duration | **140ms** (`--dur-fast`) | **140ms** (`--dur-fast`) |
| Curve | `ease` (browser default — no token) | `cubic-bezier(0.2,0,0,1)` (`--ease-standard`) |
| Hover background | `rgba(255,255,255,.08)` | `rgba(255,255,255,.08)` |
| Active `::before` bar | not transitioned | not transitioned |
| Under reduce | 0.14ms | 0.14ms |

Duration matches. The build names a curve where the reference left the default —
that is the build being more correct, not less: MOTION-SPEC §1 says never write a
literal, and `ease` is what you get when you omit the token. No change.

Activating an item produced **no** additional animation in either implementation —
the active state is the same 140ms colour transition plus a static 3px bar. Matched.

---

## 5 · Breadcrumb on navigation

| | Reference (measured) | Build BEFORE (measured) |
|---|---|---|
| `.bar__crumb` / `.crumb` transition | `all 0s` | `all 0s` |
| animation | `none` | `none` |
| Content region on view change | `none` | `none` |
| Text swap | `ग्रह / CRM` → `मानव / HRMS` | `योजना / Projects` → `क्रिया / Activity` |
| Animations running during nav | only the sidebar's 140ms colour transitions | none |

**Exact fidelity. Nothing to do.** The breadcrumb swaps instantly in both. This is
deliberate in the reference and matched in the build; a crumb that animates on every
navigation is latency the user pays for on every click.

---

## 6 · The Appearance popover

The reference's `AppearancePop` hangs off a sun/moon `.icobtn` in the toolbar.
**The build has no equivalent in the chrome** — appearance lives on the Customize
settings page. That absence is structure, and belongs to the sibling who owns it.

What is measurable on the timing question:

| | Reference `.pop` (measured) | Build `.k-notif` (measured) |
|---|---|---|
| Enter animation | `pop-in` **220ms** `cubic-bezier(0.34,1.36,0.64,1)` | **none** |
| Enter keyframe | `translateY(-6px) scale(.97) opacity 0` → identity | — |
| Mid-flight sample | `opacity .698`, `scale .991` — confirmed running | — |
| Exit animation | **none** — unmounts | **none** — unmounts |
| Present 400ms after close | — | `false` |
| Under reduce | 0.22ms | n/a |

**Answer to "does the exit actually play before unmount": no — in neither.** The
reference renders `{pop && <AppearancePop/>}` and the build renders
`if (!open) return null`. Both drop the node on the same tick as the state change,
so an exit animation could not play even if one were declared.

`animations.css:41` already reconciles this: popover → `dmPop --dur-base --ease-enter`
in, `dmPopOut --dur-fast --ease-exit` out, with the file's own instruction to
"pair every `.ix-enter-*` with its `.ix-exit-*` and unmount on `animationend`".
The chrome's only popover does neither.

`.k-notif` lives in `styles/layout.css` and `NotificationsModal.jsx` is outside this
agent's build surface — **reported, not changed.**

---

## 7 · Mobile drawer — the substantive finding

At 390px: `.kv__side` goes `display:none`, `.kv__mobbar` becomes `flex`, `.mnav`
becomes `flex` at ≤767px, and `MobileDrawer` is the replacement surface.

| | animations.css's own table | Build BEFORE (measured) |
|---|---|---|
| Scrim in | `dmFade` `--dur-base` `--ease-enter` | **none** — `animation-name: none`, `transition-duration: 0s` |
| Scrim out | `dmFadeOut` `--dur-fast` `--ease-exit` | **none** |
| Drawer in | `dmDrawerIn` `--dur-slow` `--ease-emph-in` | `kv-drawer-in` **220ms** `cubic-bezier(0.16,1,0.3,1)` |
| Drawer out | `dmDrawerOut` `--dur-base` `--ease-exit` | **none** |
| Travel | amplitude on `--motion-scale` | fixed `translateX(-100%)` |
| Node present 400ms after close | after the exit | **`false` — gone on the same tick** |
| Animations sampled during close | the exit | **`[]` — empty** |

Five defects, all on this agent's surface:

1. **The scrim has no fade at all** — it snaps to full opacity on open and vanishes
   on close. Measured `animationName: none`, `transitionDuration: 0s`.
2. **The drawer has no exit** — `duringClose: []`, node absent immediately.
3. **The drawer's enter is on `--dur-base`** where the file's own reconciled table
   says `--dur-slow` `--ease-emph-in` for a drawer.
4. **The travel is a fixed `-100%`**, not `calc(-100% * var(--motion-scale, 1))`.
   Under reduce the duration collapses to 0.22ms but the *distance* does not — which
   is exactly the amplitude collapse `--motion-scale` exists to provide, unused by
   the chrome.
5. `kv-drawer-in` is a bespoke keyframe beside a `dm*` registry that already has the
   fade pair.

**Focus trap: PASSES.** Measured, not assumed — 40 consecutive `Tab` presses from
drawer-open, checking `document.activeElement` containment against `.kv__drawer` on
every step. Focus never left the drawer (`escapedTrap: false`), and it lands inside
on open (`button.side__sec`). `FocusTrap` wraps the panel, not the scrim, which is
that component's contract. No change needed.

---

## 8 · Out-of-surface findings — reported, not changed

- **`.k-iconbtn` is off the token ladder.** `kartavaya-design.css:572` —
  `transition: color calc(.12s * var(--ix)), background calc(.12s * var(--ix)),
  border-color calc(.12s * var(--ix))`. Measured **120ms**, curve `ease`.
  The reference's `.icobtn` is `--dur-fast` (140ms). It is reduce-safe (scaled by
  `--ix`) but MOTION-SPEC §1 says never write a literal duration, and this is a
  20ms drift from the token it should be using. Three literals in one declaration.
- **`.mnav__i` has no transition of any kind** (measured `all 0s`), so the active
  state snaps. The reference gives the bottom-nav icon a pill holder,
  `.mnav__ic { transition: background var(--dur-base) var(--ease-emph) }` — 220ms.
  The build has no `.mnav__ic` element at all. The missing pill is structure;
  the missing duration is fixed below.
- **`.top__search` has no transition** (`all 0s`) — the palette trigger has no
  hover timing.
- **`.k-notif` popover has neither enter nor exit** — see §6.
