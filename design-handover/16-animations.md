# 16 · Animations

**Read `MOTION-SPEC.md` first.** It holds the durations, easings, in/out pairs, one-shot confirmations, dimensions per surface, colour-by-meaning and the ten behaviour rules. This file does not restate them — it covers only how they get wired into the app: the token mechanism, the keyframe registry, the accessibility contract, and what changes in existing files.

Design source: `motion.css`, `Interaction Catalogue.html` (42 live demos across 12 sections).

---

## 1 · The mechanism: one scale variable

Every duration in the app is a multiple of `--ix`, declared once in `motion.css`, which loads **after** `tokens.css`:

```css
:root{
  --ix:1;
  --dur-instant:calc(90ms * var(--ix));
  --dur-fast:calc(140ms * var(--ix));
  --dur-base:calc(220ms * var(--ix));
  --dur-slow:calc(360ms * var(--ix));
  --dur-xslow:calc(520ms * var(--ix));

  --ease-enter:cubic-bezier(0,0,.2,1);
  --ease-exit:cubic-bezier(.4,0,1,1);
  --ease-emph-in:cubic-bezier(.05,.7,.1,1);
  --ease-emph-out:cubic-bezier(.3,0,.8,.15);
  --ease-spring-soft:cubic-bezier(.32,1.14,.68,1);
}
```

Because the durations are *expressions*, changing `--ix` retimes every animation in the app at once — including ones already written in `app.css` that know nothing about the mechanism. This is what makes the review slow-motion toggle and the user-facing animation setting one line each:

```css
[data-slowmo="1"]{--ix:4}                        /* review tool, 4× slower */
[data-anim="reduced"]{--ix:.5}                    /* user setting */
[data-anim="none"]{--ix:.001}
@media (prefers-reduced-motion:reduce){
  :root{--ix:.001}
  [data-slowmo="1"]{--ix:1}
}
```

Three rules that make this safe:

1. **Never hardcode a duration.** `transition: background .2s` is invisible to the scale and will keep animating when a user has asked it not to. Always `var(--dur-*)` or `calc(… * var(--ix))` for one-offs like the spinner: `animation: dmSpin calc(.7s * var(--ix)) linear infinite`.
2. **`--ix: .001`, not `0`.** Zero-duration animations don't fire `animationend`/`transitionend`, so any handler that removes an element on exit-complete never runs and the node leaks. `.001` completes in under a frame and still fires.
3. **`prefers-reduced-motion` wins over the user setting** — except that it does not disable the review toggle, so motion remains inspectable on a machine that has reduced motion on.

`--motion-scale` is the same idea for transform distances; a spring at `anim: reduced` should travel less, not just travel faster.

---

## 2 · Keyframe registry

All in `motion.css`. Every entry has a paired exit; the exit is faster and uses `--ease-exit`, per `MOTION-SPEC.md` §in/out pairs.

| Name | In | Out | Used by |
|---|---|---|---|
| `dmFade` | `opacity 0→1`, `--dur-base` `--ease-enter` | `reverse forwards`, `--dur-fast` `--ease-exit` | scrims, save badges, toasts |
| `dmDrawerIn` / `dmDrawerOut` | `translateX(28px)`, `opacity .3` | `translateX(16px)`, `opacity 0` | task drawer |
| `dmSheetIn` / `dmSheetOut` | `translateY(100%)` | `translateY(100%)` | bottom sheets |
| `dmPop` / `dmPopOut` | `scale(.97) translateY(-4px)`, `opacity 0` | `scale(.98)`, `opacity 0` | menus, popovers, pickers |
| `dmTip` | `opacity 0`, `scale(.94)` centred | — (tooltips just unmount) | tooltips |
| `dmSpin` | `rotate(360deg)` linear infinite | — | spinners |
| `ixflash` | `--primary 34%` → transparent, `--dur-slow × 1.4` | — | one-shot "this just changed" |

**The exit is not the reverse of the entrance.** A drawer enters from 28px and leaves to 16px — leaving covers less distance so it feels decisive rather than reluctant. Popovers enter with a slight rise and leave with a pure scale. Do not collapse these into `animation-direction: reverse` for the sake of tidiness; the asymmetry is the point.

`transform-origin` matters on `dmPop`: set it per placement (top-left for a below-right menu, bottom-left for above-right) or the menu appears to grow from the wrong corner.

---

## 3 · Where the handlers live

Exit animations need JS, because an element must stay mounted while it animates out.

```
hooks/useExitAnimation.js     open → mounted; close → .out class, unmount on animationend
hooks/useDismissable.js       Escape + click-outside + focus return
hooks/useDrag.js              pointer capture, 3px threshold, lift transform
hooks/useLongPress.js         480ms, cancels on 8px move
hooks/useReducedMotion.js     reads the media query for JS-driven animation
```

`useExitAnimation` is the one that must exist before anything else. Without it every overlay in the app either pops out with no exit or leaks a node:

```js
const {mounted, closing, close} = useExitAnimation(open, onClose);
// render only when `mounted`; add className={closing ? 'out' : ''}
```

**The 3px drag threshold in `useDrag` is load-bearing.** Kanban cards are both draggable and clickable; without a threshold every attempted drag that moves 1px also opens the drawer. Measured from pointerdown, in CSS px, on both axes.

---

## 4 · New files

```
frontend/src/styles/motion.css        the token block + keyframe registry
frontend/src/hooks/useExitAnimation.js
frontend/src/hooks/useDismissable.js
frontend/src/hooks/useDrag.js
frontend/src/hooks/useLongPress.js
frontend/src/hooks/useReducedMotion.js
```

`motion.css` must be imported **after** `editorial.css` in `main.jsx` — it re-declares `--dur-*` and needs to win on document order.

---

## 5 · Endpoints

None. One preference write, covered in `09-customization.md`:

```
PATCH /v1/me/preferences  { anim: 'full' | 'reduced' | 'none' }
```

---

## 6 · What changes in existing files

| File | Change |
|---|---|
| `main.jsx` | Import `motion.css` after `editorial.css` |
| `editorial.css` | Replace every literal duration with `var(--dur-*)`. Audit for `.15s`, `.2s`, `.3s`, `300ms` — each one is a place the animation setting silently fails |
| `components/layout/Sidebar.jsx` | Two inline literals: `transition:'max-height .2s ease'` and the chevron's `transition:'transform .15s'`. Both → tokens. The `maxHeight: items.length * 44` calculation is a separate bug — see `01-navigation.md` |
| `components/ui/modal.jsx` | Add `useExitAnimation`; currently unmounts immediately, so there is no exit at all |
| `components/ui/toast.jsx` | Same. Also needs the stack-shift transition when one toast in a stack dismisses |
| `components/ui/Tooltip.jsx` | Add 400ms in / 0ms out. Instant tooltips fire on every incidental pass of the cursor |
| `components/ui/ConfirmDialog.jsx` | Add exit animation + focus return to the trigger |
| `components/views/KanbanView.jsx` | Replace whatever drag handling exists with `useDrag`; add the 3px threshold and the column-highlight transition |
| `components/CustomizePanel.jsx` | `applyPrefs` writes `data-anim`; also fix the `--font-ui` bug documented in `SETTINGS-ADMIN-SPEC.md` |
| `index.html` | Nothing — do **not** add a global `* { transition: … }` reset. It animates layout properties on elements that should snap, and it is the usual cause of a first-paint flash |

### Audit before you ship

Grep for hardcoded timings: `grep -nE '[^-a-z](\.[0-9]+s|[0-9]+ms)' src/**/*.{jsx,js,css}`. Every hit is either a legitimate `calc(… * var(--ix))` or a bug. There is no third case.
