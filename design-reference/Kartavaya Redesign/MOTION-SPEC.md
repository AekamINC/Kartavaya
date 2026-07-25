# Motion & interaction spec

The consolidated numbers behind `Interaction Catalogue.html` — 42 interactions across 12 sections.
Target stack: **Vite + React (JSX, no TypeScript) · plain CSS custom properties in `editorial.css` · FastAPI · Supabase Postgres · no component library.**

---

## 1 · Duration tokens

Never write a literal duration. Every value below is a token, which is what makes the catalogue's
4× slow-motion toggle possible — it scales `--ix` at the root and every animation in the app follows.

```css
:root {
  --ix: 1;                                  /* 4 in review mode, .001 for reduced motion */
  --dur-instant: calc( 90ms * var(--ix));   /* press feedback, tooltip fade-in */
  --dur-fast:    calc(140ms * var(--ix));   /* hover, focus, popover in */
  --dur-base:    calc(220ms * var(--ix));   /* the default — most state changes */
  --dur-slow:    calc(360ms * var(--ix));   /* drawers, sheets, spring settles */
  --dur-xslow:   calc(520ms * var(--ix));   /* scroll reveals, first-paint sweeps */
}
@media (prefers-reduced-motion: reduce) { :root { --ix: .001 } }
```

`prefers-reduced-motion` always wins over the user's Animations preference. The preference can
reduce motion further, never restore it.

## 2 · Easing

```css
--ease-emph:      cubic-bezier(.2, 0, 0, 1);      /* default. M3 emphasised */
--ease-enter:     cubic-bezier(0, 0, .2, 1);      /* decelerate — things arriving */
--ease-exit:      cubic-bezier(.4, 0, 1, 1);      /* accelerate — things leaving */
--ease-emph-in:   cubic-bezier(.05, .7, .1, 1);   /* bottom sheets rising */
--ease-spring:    cubic-bezier(.34, 1.36, .64, 1);/* overshoot: checks, pops, settles */
--ease-standard:  cubic-bezier(.2, 0, 0, 1);      /* pulses, shimmer */
```

**Two rules that decide most of it.** Entering elements decelerate; leaving elements accelerate —
which is why exits are also *shorter* than entrances (`180ms` out against `220–360ms` in). And spring
is for confirmation only: a checkbox, a card landing, a badge flashing. Never for a panel.

## 3 · The pairs

| Element | In | Out |
|---|---|---|
| Task drawer (desktop) | `translateX(28px)` + `opacity .3→1` · `--dur-slow` `--ease-emph` | `translateX(16px)` + fade · `--dur-base` `--ease-exit` |
| Bottom sheet | `translateY(100%)→0` · `300ms` `--ease-emph-in` | `translateY(100%)` · `--dur-base` `--ease-exit` |
| Modal | `scale(.96)→1` + `translateY(8px)` · `--dur-base`, `40ms` after the scrim | `scale(.98)` + fade · `--dur-fast` |
| Popover / menu | `scale(.97)→1` + fade · `--dur-fast` `--ease-spring` | `scale(.98)` + fade · `119ms` `--ease-exit` |
| Toast | `translateX(16px)` + fade · `--dur-base` (mobile: `translateY(12px)`) | `translateX(12px)` + fade · `180ms` |
| Command palette | `scale(.97)` + `translateY(-6px)` · `--dur-base`, scrim blurs `4px` | `scale(.98)` + fade · `160ms` |
| Tooltip | fade + `scale(.94)` · `--dur-instant`, after a `300ms` dwell | fade · `90ms` |
| Thread flexpane | slide from right, `324px` · `300ms` `--ease-emph` | slide out · `--dur-base` `--ease-exit` |
| Inline row (subtask, entry) | `translateY(-6px)` + fade · `--dur-base` | `max-height→0` + fade · `--dur-base` `--ease-exit` |
| Scroll reveal (landing) | `translateY(18px)` + fade · `--dur-xslow` | never — unobserve after firing |

## 4 · One-shot confirmations

| What | Animation |
|---|---|
| Checkbox complete | box fills `--dur-fast`; tick draws via `stroke-dashoffset` `--dur-base`; box overshoots to `scale(1.18)` over `--dur-slow` `--ease-spring` |
| Strikethrough | `transform: scaleX(0→1)` from left, `--dur-base` `--ease-emph` |
| Saved (badge, cell) | background `primary/34% → transparent` over `500ms` `--ease-exit` |
| Card landed (kanban) | `box-shadow: 0 0 0 2px --primary → transparent` over `540ms` |
| Danger dialog icon | one `scale(1.14)` pulse, `--dur-slow` `--ease-spring` |
| Form shake (auth) | `420ms cubic-bezier(.36,.07,.19,.97)`, ±4px |
| Timer dot | `opacity/scale` pulse on a `2s` `--ease-standard` loop |
| Skeleton shimmer | `1.7s` `--ease-standard` infinite, disabled under reduced motion |

## 5 · Dimensions

| Thing | Desktop | Touch |
|---|---|---|
| Task drawer | `min(560px, 92vw)` | sheet, snap `58%` / `94%` |
| Modal | `max 620px`, body `max-height 70vh` | full-width sheet, `max-height 90%` |
| Confirm dialog | `400px` — stays centred on mobile | centred, not a sheet |
| Popover (picker) | `176–268px` | bottom sheet |
| Toast | `328px`, max 3 | full width − 32px |
| Command palette | `560px` at `15vh` | full-screen |
| Menu | `min-width 194px`, rows `34px` | rows `48px` |
| Thread pane | `324px` | full-screen push |
| Notification panel | `316px` | full-screen page |
| Row height | `40px` (compact `38px`) | `44px` minimum |
| Checkbox / tick | `16–19px` | `20–22px`, `44px` hit area |
| Auth field | `56px` | `58px` |
| Primary button | `min-height 46px` | `50px` |

Radius is always `--r-*` derived from `--radius-base`, which the user can set to `4 / 10 / 20`.
Never hard-code a radius, or the Sharp and Pill settings break in that one spot.

## 6 · Colour by meaning

| Meaning | Token |
|---|---|
| Primary action, focus, selection | `--primary`, `--primary-container` |
| Success, complete, approved | `--ok`, `--ok-container` |
| Warning, overdue soon, quiet hours | `--warn`, `--warn-container` |
| Destructive, failed, sensitive | `--danger`, `--danger-container` |
| Platform (admin surface only) | `#6B4FBF` light / `#C0A9F5` dark, keyline `#7c5cbf` |
| Status pipeline | `STATUS_COLORS` from `drawer/constants.js` — never the accent |
| Priority | `PRIO` map — `#B42318 / #A66207 / #0082c6 / #74786F` |
| Read receipt tick | `#0082c6` — canonical, not a theme token |
| Tooltip ink | `#23262B` / inverted in dark — fixed, so it reads on any surface |

## 7 · Behaviour rules the animations exist to serve

1. **Never lie about state.** Optimistic UI renders at `opacity .6` until acknowledged, then goes solid. A failed write restores the old value and says so — it does not keep the new one on screen.
2. **Undo over confirm.** Reversible destructive actions get a 4-second undo toast with the delete deferred until it expires. Only irreversible actions get a dialog, and it states the consequence in numbers.
3. **Exits are faster than entrances.** Decisive out, gentle in.
4. **A skeleton beats a spinner** for anything with known shape, and it must match the real geometry so nothing shifts on arrival. Hold the previous page if the fetch resolves under `120ms` — a flashed skeleton is worse than none.
5. **Never `scrollIntoView`.** Use `scrollTop` arithmetic; `scrollIntoView` fights the page scroll and the host frame.
6. **Hidden beats disabled** for permissions — but a locked *action* stays visible and names the level that would unlock it. Absent for whole modules, explained for individual controls.
7. **Hover is not a surface.** Every hover affordance has a touch equivalent: long-press (`420ms`) for context, swipe-left for destructive, permanently visible for the primary one.
8. **Never hide a nav by width without shipping its replacement.** This shipped three times in this project — `.side`, `.adm__side`, `.ob--m` — and each time left a surface with no way out.
9. **One popover primitive, four uses.** Assignee, priority, date and category are the same component with different content. Divergence between them is the bug.
10. **State goes in the URL** when it is shareable: active tab, sort, filters, open record.

## 8 · Handlers

```
Drawer        onOpenTask(id) · onClose() → focus returns to the triggering row
Title/desc    onBlur|Enter → patchTask({field}) optimistic, rollback on 4xx
Pipeline      onStageClick(value) → patchTask({status})
Pickers       onToggle(id) → patch, debounced 400ms so five taps are one request
Subtasks      onAdd(title) · onToggle(id) · onReorder(from,to) fractional position
Comments      onSubmit(body) · onEdit(id,body) · delete deferred until the toast expires
Files         XMLHttpRequest.upload.onprogress — fetch cannot report progress
              keep the File handle in state so retry needs no re-pick
Timer         startTimer(taskId) writes server-side started_at — survives refresh
Approvals     POST /approve {note, forward_to_client_id} · reject requires a note server-side too
Kanban        onMove(cardId, toColumn, index) · 3px movement threshold separates click from drag
Table         sort + widths persist per user; filters serialise into the URL
Chat          parent_message_id = thread · metadata.quote_of = quote
              reactions are an upsert/delete on a unique (message,user,emoji)
              typing is a throttled realtime broadcast, never persisted
Shortcuts     one registry generates both the cheat sheet and the handlers
```

## 9 · What staging is missing, in one list

Read from `kevalvshah/Kartavya@staging`. Every item below is a gap the catalogue closes.

- **No entry or exit animation anywhere.** `modal.jsx`, `ConfirmDialog.jsx`, `CommandPalette.jsx` and `toast.jsx` all mount via `if (!open) return null`.
- **Toasts** are top-right, newest prepended, 3200ms, with no hover pause, no progress, no close button and no action slot — so Undo and Retry cannot be expressed.
- **No undo anywhere.** Every destructive action is a `window.confirm()`, including removing a comment.
- **`Tooltip.jsx`** has the 300ms delay but no edge auto-flip, so tooltips on the rightmost toolbar buttons render off-screen.
- **Only `ConfirmDialog` traps focus.** `modal.jsx` does not.
- **`CommandPalette`** ranks by plain `includes()` and calls `scrollIntoView`.
- **No mobile variant** on any overlay.
- **No progress on uploads**; a failed upload vanishes and has to be re-picked.
- **Timer lives in component state** — closing the drawer loses it.
- **No reactions, threads, typing indicator or in-channel search** in Sanvaad.
- **No bulk selection, inline edit, column resize or compound filters** in the table.
- **`PageLoader.jsx`** is one centred spinner for every route.
- **`KeyboardShortcuts.jsx`** registers handlers with no discoverable sheet.
- **Errors are raw `pushToast` of the server detail** — a 502 shows "Request failed with status code 502". No offline handling at all.

---

## Still open

- Section 11 covers Sanvaad's message mechanics; the WhatsApp/Varta side has its own states in `MESSAGING-ATTENDANCE-SPEC.md` and is not duplicated here.
- Calendar, timeline, workload and priority views (`views/*`) are not yet in the catalogue.
- Pahchan's camera clock-in has motion requirements of its own — low-end devices, light DOM — specified separately.
