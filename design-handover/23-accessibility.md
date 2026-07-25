# Accessibility

## Prerequisites
- `00-tokens.md` — the contrast floors in §12 are the obligations this file enforces
- `02-common-components.md` — `FocusTrap` lands beside the other primitives

## Files to modify
- `frontend/src/components/ui/ConfirmDialog.jsx` — add the missing `role`, drop the static id
- `frontend/src/components/ui/modal.jsx` — wrap in `FocusTrap`
- `frontend/src/components/layout/NotifToast.jsx` — add the live region
- `frontend/src/components/layout/AppShell.jsx` — skip link, `<main id="main">`
- `frontend/src/components/drawer/TaskDrawer.jsx` — focus trap, restore focus on close
- `frontend/src/components/CommandPalette.jsx` — `role="combobox"` + `aria-activedescendant`

## Files to create
- `frontend/src/components/ui/FocusTrap.jsx`
- `frontend/src/components/ui/SkipLink.jsx`
- `frontend/src/hooks/useRestoreFocus.js`

## Estimated scope
- 3 new files, 6 modified. No visual change on any screen — this is entirely behaviour and semantics.

---

## What staging already does right

Worth saying before the defects, because it is more than I expected:

- **Icon buttons carry `aria-label`.** `DrawerHeader` (restore/archive/delete/close), `DrawerComments`, `DrawerTimeEntries`, `FilesField`, `ColorTag`, `TemplatesPage`, `ProjectsPage`, `Sidebar` toggle, `AppShell` menu and bell. Not universal, but the habit is there.
- `modal.jsx` has `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` with a generated id.
- `StatusBar.jsx` has `role="group" aria-label="Status pipeline"` — correct, and not obvious.
- `Breadcrumbs.jsx` has `aria-label="Breadcrumb"` on the `<nav>`.
- `OnboardingChecklist` has `role="complementary"`.

The gaps are structural rather than a scattering of missing labels.

---

## Defect 1 · Nothing traps focus. Anywhere.

Zero matches for `focusTrap`, `focusLock`, or any equivalent across all 158 `frontend/src` files.

Consequence: open the task drawer, press Tab about fifteen times, and focus walks out of the drawer into the page behind it — the board still under the scrim. A keyboard user is now editing a row they cannot see, inside a modal they cannot tell they are still in. The same applies to every sheet, the command palette, and both slide-overs in `AdminPage.jsx`.

```jsx
// components/ui/FocusTrap.jsx
const SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function FocusTrap({ children, active = true, initialFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const prev = document.activeElement;
    const first = initialFocus?.current ?? root.querySelector(SELECTOR) ?? root;
    first.focus({ preventScroll: true });          // preventScroll matters — see below

    const onKey = e => {
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll(SELECTOR)].filter(el => el.offsetParent !== null);
      if (!items.length) return e.preventDefault();
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => { root.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
  }, [active, initialFocus]);
  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>;
}
```

Three details that are easy to get wrong:

- **`preventScroll: true`** on both focus calls. Without it, focusing an element inside a transformed drawer scrolls the page behind the scrim, and restoring focus on close jumps the board back to wherever the trigger was.
- **Filter on `offsetParent !== null`** at keypress time, not mount time. A drawer whose Comments tab is not the active tab still has focusable buttons in the DOM; tabbing to an invisible button is worse than not trapping.
- **Restore focus in the cleanup**, to the element that opened the thing. Closing the drawer with Escape must put focus back on the task row, not at the top of the document. That is the difference between a keyboard user losing their place once and losing it every time.

`display: contents` keeps the wrapper out of layout, so adding the trap cannot shift a pixel.

## Defect 2 · `ConfirmDialog` has `aria-modal` and no `role`

`ui/ConfirmDialog.jsx` line 73–74:

```jsx
aria-modal="true"
aria-labelledby="cd-title"
```

**`aria-modal` is ignored without `role="dialog"`.** A screen reader treats this as an ordinary `<div>`, keeps announcing the page behind it, and never says the dialog opened. This is the component that guards every destructive action in the product — delete task, remove member, delete organisation.

```diff
- aria-modal="true"
- aria-labelledby="cd-title"
+ role="alertdialog"
+ aria-modal="true"
+ aria-labelledby={titleId}
+ aria-describedby={bodyId}
```

`alertdialog`, not `dialog` — it carries a consequence the user must read before acting, which is exactly what the role is for.

`cd-title` is also a **hardcoded id**. Two confirm dialogs mounted simultaneously — a delete confirm opening from inside a slide-over — produce duplicate ids and `aria-labelledby` resolves to whichever the browser found first. Generate it with `useId()`, as `modal.jsx` already does.

## Defect 3 · Toasts are announced to nobody

`NotifToast.jsx` renders a positioned `<div>` with no `role` and no `aria-live`. Every toast in the product — "Task created", "Failed to send", "Approval requested" — is silent to a screen reader. A blind user gets no confirmation that anything happened, and no error reporting at all.

```jsx
// NotifToastContainer — one live region, not one per toast
<div role="region" aria-label="Notifications">
  <div aria-live="polite"   aria-atomic="false" className="sr-only" id="toast-polite" />
  <div aria-live="assertive" aria-atomic="false" className="sr-only" id="toast-assert" />
  {toasts.map(...)}
</div>
```

Errors go to `assertive`, everything else to `polite`. Never put `aria-live` on the toast element itself — a live region has to exist in the DOM *before* the content arrives, or the insertion is not announced. That is the single most common way this gets implemented wrong.

```css
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
```

## Defect 4 · No skip link

The sidebar is 15 module links plus a settings group. A keyboard user tabs through all of them on every page load before reaching content.

```jsx
<a href="#main" className="k-skip">Skip to content</a>
...
<main id="main" tabIndex={-1}>
```

```css
.k-skip{position:fixed;top:8px;left:8px;z-index:200;padding:9px 15px;border-radius:var(--r-sm);background:var(--surface);color:var(--on-surface);box-shadow:var(--shadow-3);transform:translateY(-160%);transition:transform var(--dur-fast) var(--ease-emph)}
.k-skip:focus{transform:none}
```

Visible on focus only. `tabIndex={-1}` on `<main>` is required or the jump moves the scroll without moving focus.

---

## Contrast — what §12 actually obliges

`00-tokens.md` §12 lists ratios. It did not say what they permit, which made the 4.1:1 row unusable as guidance. The obligation:

Ratios are against **`--bg`** `#F3EFE6`, the canvas most of the app paints on — not `--surface`, which is a card sitting on top of it and always the easier test. Three tokens passed against `--surface` and failed against `--bg`; they have been darkened in `00` §7.

| Token | on `--bg` | Permitted | Forbidden |
|---|---|---|---|
| `--on-surface` | 14.7:1 | anything | — |
| `--on-surface-2` | 7.4:1 | body, labels, table cells | — |
| `--on-surface-3` `#666A61` | 4.8:1 | metadata ≥12px: timestamps, counts, helper text | body copy below 12px |
| `--on-surface-faint` | **2.3:1** | non-text only: rules, ordinals, decorative watermarks | **any text a user must read** |
| `--ok` `#14743A` | 5.1:1 | chip labels, status text | — |
| `--warn` `#955806` | 4.9:1 | chip labels, status text, the offline banner | — |
| `--danger` `#B42318` | 5.8:1 | error text, destructive labels | — |
| `--on-primary` on `--primary` | 5.1:1 | filled button labels | — |

**Three tokens were failing before this pass**, all in light mode and all only on the canvas:

- `--on-surface-3` at `#74786F` — **3.9:1**. The worst of the three and by far the most used: it carries metadata on every screen in the product. Now `#666A61`, 4.8:1.
- `--warn` at `#A66207` — **4.2:1**. Now `#955806`, 4.9:1. This one also colours the offline banner, which is exactly the text you cannot afford to lose.
- `--ok` at `#16803F` — **4.4:1**. Now `#14743A`, 5.1:1.

Because `--st-done`, `--st-requested`, `--st-rejected`, the `--ap-*` set and `--pr-low` alias these tokens, every status chip and priority marker inherited the fix without a separate edit.

2.3:1 is not text. This was violated once already this session: the wayfinding hints on `Start Here.html` — the only copy telling a reader where Customization and Organisation live — were set in `--on-surface-faint` at 11.5px. Instructional copy is never decoration.

**Never encode state in colour alone.** Every status chip carries its label, every priority its name on hover, every overdue row a word as well as a red tint. Roughly 1 in 12 male users of a product sold to Indian SMEs cannot distinguish `--st-done` from `--st-rejected` reliably.

## Keyboard map

| Key | Context | Action |
|---|---|---|
| `Tab` / `Shift+Tab` | trapped in any overlay | next / previous |
| `Escape` | drawer, sheet, modal, palette, menu | close the topmost only |
| `⌘K` / `Ctrl+K` | global | command palette |
| `↑` `↓` | palette, menu, mention autocomplete | move selection |
| `Enter` | palette, menu | activate |
| `Space` | kanban card | pick up / drop — the keyboard path for drag |
| `←` `→` | kanban card held | move between columns |
| `G` then `I` | global | Inbox (already in `Topbar.jsx`) |

Escape closing **only the topmost** layer matters: a confirm dialog opened from inside the drawer must not dismiss both. Track depth in the overlay context, not per-component listeners.

**The kanban keyboard path is not optional.** `04-boards-table-views.md` records that drag uses the HTML5 API and does not work on touch at all; it also does not work from the keyboard. Space-to-lift plus arrows is the same handler the touch implementation needs.

## Devanagari and screen readers

```jsx
<span className="k-nav__hi" lang="hi">कार्य</span>
<span className="k-nav__gu" lang="gu">કાર્ય</span>
```

Without `lang`, a screen reader reads Devanagari with the English voice and produces noise. `24-bilingual-devanagari.md` covers where the labels come from; the `lang` attribute is the accessibility half.

Bilingual labels also double every announcement: "Tasks कार्य Tasks कार्य" as focus moves. Where English and Hindi are the same label in two scripts, mark the second `aria-hidden="true"` — it is a visual affordance, not additional information.

## Touch targets

44×44px minimum on every interactive element on mobile web and the app, per `15-mobile-web.md` and `17-mobile-app.md`. Where a control must look smaller, expand the hit area with padding or a pseudo-element rather than shrinking the target.

## Motion

Handled entirely by `00-tokens.md` §5 — the OS `prefers-reduced-motion` setting overrides the stored preference and cannot be overridden by it. No per-component work.

## Testing

Not a checklist for `25-qa-acceptance.md` to duplicate; these are the four that catch real defects:

1. **Unplug the mouse.** Reach every action on Today, a board, the drawer, and Sanvaad. If something is unreachable, that is a bug at the same severity as a crash.
2. **VoiceOver on Safari, NVDA on Windows.** Open the drawer, submit a comment, trigger an error. If the error is silent, defect 3 has regressed.
3. **200% browser zoom.** `calc()`-derived type (`00` §2) should hold; fixed-px leftovers will not.
4. **Windows High Contrast Mode.** `backdrop-filter` and `color-mix` both drop out. Every glass surface needs a solid fallback — `[data-platform="win"]` already supplies one (`01-navigation.md`).
